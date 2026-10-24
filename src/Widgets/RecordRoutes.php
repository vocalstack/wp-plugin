<?php
/**
 * The record widget's server side.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Widgets;

use VocalStack\Http\ConnectionException;
use VocalStack\VocalStackException;
use VocalStack\WP\Lock;
use VocalStack\WP\Plugin;
use VocalStack\WP\Rest\Routes;

defined( 'ABSPATH' ) || exit;

/**
 * A recording from the browser (microphone or tab audio) goes straight to
 * VocalStack over a WebSocket; WordPress only opens and closes it:
 *
 * 1. `POST widgets/record/start {ticket, source}` checks the widget's signed
 *    options and the site's limits, creates a live transcription, starts its
 *    recording and returns the socket URL. That URL works for one recording,
 *    must be opened within two minutes, and grants nothing else.
 * 2. `POST widgets/record/reconnect {session}` after a dropped socket.
 * 3. `POST widgets/record/stop {session}` ends it and settles the minutes.
 * 4. `GET widgets/record/status?session=`: state, and the transcript once it
 *    has one (a stream source has no socket of its own, so it polls this).
 *
 * `session` is a signed handle naming the recording and who started it, so one
 * visitor can't stop or reconnect to another's recording.
 */
final class RecordRoutes {

	/** How long a session handle stays usable after the longest recording. */
	const HANDLE_GRACE = HOUR_IN_SECONDS;

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( 'rest_api_init', array( self::class, 'routes' ) );
	}

	/**
	 * Register the routes.
	 */
	public static function routes(): void {
		$public = '__return_true'; // Each callback checks the signed ticket or session and the policy.
		register_rest_route(
			Routes::NS,
			'/widgets/record/start',
			array(
				'methods'             => 'POST',
				'callback'            => array( self::class, 'start' ),
				'permission_callback' => $public,
				'args'                => array(
					'ticket' => array(
						'type'     => 'string',
						'required' => true,
					),
					'source' => array(
						'type'    => 'string',
						'default' => 'mic',
					),
				),
			)
		);
		foreach ( array( 'reconnect', 'stop' ) as $action ) {
			register_rest_route(
				Routes::NS,
				'/widgets/record/' . $action,
				array(
					'methods'             => 'POST',
					'callback'            => array( self::class, $action ),
					'permission_callback' => $public,
					'args'                => array(
						'session' => array(
							'type'     => 'string',
							'required' => true,
						),
					),
				)
			);
		}
		register_rest_route(
			Routes::NS,
			'/widgets/record/status',
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'status' ),
				'permission_callback' => $public,
				'args'                => array(
					'session' => array(
						'type'     => 'string',
						'required' => true,
					),
				),
			)
		);
	}

	/**
	 * Start a recording.
	 *
	 * @param \WP_REST_Request $request The request.
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function start( \WP_REST_Request $request ) {
		$widget = Ticket::verify( (string) $request['ticket'] );
		if ( ! $widget || 'record' !== ( $widget['type'] ?? '' ) ) {
			return new \WP_Error( 'vocalstack_bad_ticket', __( 'This recorder is out of date. Reload the page.', 'vocalstack' ), array( 'status' => 400 ) );
		}
		$source  = (string) $request['source'];
		$sources = (array) ( $widget['sources'] ?? array( 'mic' ) );
		if ( ! in_array( $source, $sources, true ) ) {
			return new \WP_Error( 'vocalstack_bad_source', __( 'This recorder does not offer that audio source.', 'vocalstack' ), array( 'status' => 400 ) );
		}
		$limits = Policy::effective( $widget );
		if ( ! Policy::may_use( $limits ) ) {
			return new \WP_Error( 'vocalstack_forbidden', is_user_logged_in() ? __( 'Your account can’t record here.', 'vocalstack' ) : __( 'Log in to record.', 'vocalstack' ), array( 'status' => is_user_logged_in() ? 403 : 401 ) );
		}
		$vs = Plugin::sdk();
		if ( ! $vs ) {
			return new \WP_Error( 'vocalstack_not_connected', __( 'Recording is not set up on this site yet.', 'vocalstack' ), array( 'status' => 503 ) );
		}
		$max      = max( 60, (int) $limits['maxRecordMinutes'] * 60 );
		$reserved = Policy::reserve_minutes( $limits, $max );
		if ( is_wp_error( $reserved ) ) {
			return $reserved;
		}

		$settings = Widgets::transcription_settings( $widget ) + array(
			'maxDurationS' => $max,
			'voice'        => false,
		);
		$fields   = array(
			'name'     => self::name( $widget ),
			'settings' => $settings,
		);
		if ( str_starts_with( $source, 'stream:' ) ) {
			$fields['source'] = array(
				'kind' => 'stream',
				'url'  => substr( $source, 7 ),
			);
		}

		$who = Policy::visitor();
		try {
			$created = $vs->transcriptions->createLive( $fields, wp_generate_uuid4() );
			$grant   = $vs->transcriptions->startRecording( (string) $created['id'] );
		} catch ( VocalStackException | ConnectionException $e ) {
			Policy::settle_minutes( $who, $max, 0 );
			return self::error( $e );
		}

		$recording = (string) ( $grant['recording']['id'] ?? '' );
		return array(
			'session'     => Ticket::sign(
				array(
					'kind'     => 'record-session',
					'rec'      => $recording,
					'tr'       => (string) $created['id'],
					'who'      => $who,
					'reserved' => $max,
					'stream'   => isset( $fields['source'] ),
					'exp'      => time() + $max + self::HANDLE_GRACE,
				)
			),
			'recordingId' => $recording,
			'streamUrl'   => $grant['streamUrl'] ?? null,
			'maxSeconds'  => $max,
		);
	}

	/**
	 * A new socket URL for the same recording, after the connection dropped.
	 *
	 * @param \WP_REST_Request $request The request.
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function reconnect( \WP_REST_Request $request ) {
		$session = self::session( (string) $request['session'] );
		if ( is_wp_error( $session ) ) {
			return $session;
		}
		try {
			$grant = Plugin::sdk()->recordings->publishToken( $session['rec'], true );
		} catch ( VocalStackException | ConnectionException $e ) {
			return self::error( $e );
		}
		return array( 'streamUrl' => $grant['streamUrl'] ?? null );
	}

	/**
	 * End the recording (a stream source is paused, then stopped) and settle the
	 * minutes reserved for it against what was recorded.
	 *
	 * @param \WP_REST_Request $request The request.
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function stop( \WP_REST_Request $request ) {
		$session = self::session( (string) $request['session'] );
		if ( is_wp_error( $session ) ) {
			return $session;
		}
		$vs = Plugin::sdk();
		try {
			$recording = $vs->recordings->get( $session['rec'] );
			if ( in_array( $recording['state'] ?? '', array( 'live', 'paused', 'idle' ), true ) ) {
				// VocalStack refuses to stop a live recording that is not paused first.
				if ( 'live' === $recording['state'] ) {
					$vs->recordings->pause( $session['rec'] );
				}
				$recording = $vs->recordings->stop( $session['rec'], 'Stopped from the website' );
			}
		} catch ( VocalStackException $e ) {
			// Already ended (the browser sent eof): nothing left to stop.
			if ( ! in_array( $e->status(), array( 404, 409 ), true ) ) {
				return self::error( $e );
			}
			$recording = array();
		} catch ( ConnectionException $e ) {
			return self::error( $e );
		}
		self::settle( $session, $recording );
		return array( 'state' => (string) ( $recording['state'] ?? 'ended' ) );
	}

	/**
	 * The recording's state and, once it has one, its transcript.
	 *
	 * @param \WP_REST_Request $request The request.
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function status( \WP_REST_Request $request ) {
		$session = self::session( (string) $request['session'] );
		if ( is_wp_error( $session ) ) {
			return $session;
		}
		$vs = Plugin::sdk();
		try {
			$recording  = $vs->recordings->get( $session['rec'] );
			$transcript = $vs->recordings->transcript( $session['rec'] );
		} catch ( VocalStackException | ConnectionException $e ) {
			return self::error( $e );
		}
		if ( in_array( $recording['state'] ?? '', array( 'ended', 'finalized' ), true ) ) {
			self::settle( $session, $recording );
		}
		return array(
			'state'     => (string) ( $recording['state'] ?? '' ),
			'ingest'    => $recording['ingest']['state'] ?? null,
			'endReason' => $recording['endReason'] ?? null,
			'sentences' => self::sentences( $transcript ),
		);
	}

	/**
	 * Settle a recording's reservation once, with its real length.
	 *
	 * @param array<string, mixed> $session   The verified session.
	 * @param array<string, mixed> $recording The recording, as VocalStack has it.
	 */
	private static function settle( array $session, array $recording ): void {
		// Never released: it outlives the session, after which nothing can settle it again.
		if ( ! Lock::acquire( 'settled_' . md5( $session['rec'] ), max( DAY_IN_SECONDS, (int) $session['exp'] - time() ) ) ) {
			return;
		}
		$actual = (int) ceil( (float) ( $recording['mediaDurationS'] ?? $session['reserved'] ) );
		Policy::settle_minutes( (string) $session['who'], (int) $session['reserved'], $actual );
	}

	/**
	 * A verified session handle belonging to the current visitor.
	 *
	 * @param string $handle The handle from start().
	 * @return array<string, mixed>|\WP_Error
	 */
	private static function session( string $handle ) {
		$session = Ticket::verify( $handle );
		if ( ! $session || 'record-session' !== ( $session['kind'] ?? '' ) || (int) ( $session['exp'] ?? 0 ) < time() ) {
			return new \WP_Error( 'vocalstack_bad_session', __( 'This recording has expired. Reload the page.', 'vocalstack' ), array( 'status' => 400 ) );
		}
		if ( Policy::visitor() !== $session['who'] ) {
			return new \WP_Error( 'vocalstack_not_yours', __( 'This recording was started by someone else.', 'vocalstack' ), array( 'status' => 403 ) );
		}
		if ( ! Plugin::sdk() ) {
			return new \WP_Error( 'vocalstack_not_connected', __( 'Recording is not set up on this site.', 'vocalstack' ), array( 'status' => 503 ) );
		}
		return $session;
	}

	/**
	 * The transcript's sentences, as the widgets render them.
	 *
	 * @param array<string, mixed> $transcript VocalStack's transcript.
	 * @return list<array<string, mixed>>
	 */
	public static function sentences( array $transcript ): array {
		$out = array();
		foreach ( (array) ( $transcript['sentences'] ?? array() ) as $s ) {
			if ( 'dropped' === ( $s['status'] ?? '' ) || '' === trim( (string) ( $s['text'] ?? '' ) ) ) {
				continue;
			}
			$out[] = array(
				'id'       => (int) ( $s['sentenceId'] ?? count( $out ) ),
				'start'    => (float) ( $s['start'] ?? 0 ),
				'end'      => (float) ( $s['end'] ?? 0 ),
				'speaker'  => (int) ( $s['speaker'] ?? -1 ),
				'text'     => trim( (string) $s['text'] ),
				'language' => $s['language'] ?? null,
				// For a live listener: which segments it is made of, as live translations name them.
				'seqs'     => array_map( 'intval', (array) ( $s['seqs'] ?? array() ) ),
			);
		}
		return $out;
	}

	/**
	 * The name a widget's recording gets in VocalStack.
	 *
	 * @param array<string, mixed> $widget The widget's options.
	 */
	private static function name( array $widget ): string {
		$title = trim( (string) ( $widget['title'] ?? '' ) );
		/* translators: 1: site name, 2: date and time */
		return '' !== $title ? $title : sprintf( __( 'Recording on %1$s, %2$s', 'vocalstack' ), get_bloginfo( 'name' ), wp_date( get_option( 'date_format' ) . ' ' . get_option( 'time_format' ) ) );
	}

	/**
	 * A VocalStack failure as a REST error a visitor can read.
	 *
	 * @param \Throwable $e The failure.
	 */
	private static function error( \Throwable $e ): \WP_Error {
		if ( $e instanceof ConnectionException ) {
			return new \WP_Error( 'vocalstack_unreachable', __( 'The transcription service could not be reached. Try again in a moment.', 'vocalstack' ), array( 'status' => 502 ) );
		}
		$code     = $e instanceof VocalStackException ? $e->errorCode() : 'error';
		$messages = array(
			'insufficient_credit' => __( 'Recording is unavailable right now.', 'vocalstack' ),
			'quota_exceeded'      => __( 'Someone else is recording right now. Try again in a few minutes.', 'vocalstack' ),
			'conflict'            => __( 'Someone else is recording right now. Try again in a few minutes.', 'vocalstack' ),
			'capacity_exceeded'   => __( 'The transcription service is busy. Try again in a moment.', 'vocalstack' ),
		);
		/* translators: %s: the service's error message */
		$message = $messages[ $code ] ?? sprintf( __( 'Recording failed: %s', 'vocalstack' ), $e->getMessage() );
		$status  = $e instanceof VocalStackException && $e->status() >= 400 && $e->status() < 500 && 401 !== $e->status() ? 409 : 502;
		return new \WP_Error( 'vocalstack_' . $code, $message, array( 'status' => $status ) );
	}
}
