<?php
/**
 * The player widget's server side.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Widgets;

use VocalStack\Http\ConnectionException;
use VocalStack\VocalStack;
use VocalStack\VocalStackException;
use VocalStack\WP\Languages;
use VocalStack\WP\Media;
use VocalStack\WP\Plugin;
use VocalStack\WP\Rest\Routes;
use VocalStack\WP\Settings;

defined( 'ABSPATH' ) || exit;

/**
 * - `GET widgets/player/source?ticket=` for a VocalStack transcription: a playable
 *   audio URL (carrying a media token that reads only that transcription's audio)
 *   and its transcript; for a broadcast: what the browser needs to follow it
 *   live over VocalStack's sockets (ids, never a credential).
 * - `GET widgets/player/transcript?ticket=&transcription=&after=` for a broadcast's
 *   transcription: the transcript so far, asked for without the site's key, so
 *   VocalStack applies its public-listener rules. Browsers can't call that
 *   endpoint across origins themselves.
 *
 * Media Library files need neither: their URL and transcript are rendered
 * into the page.
 */
final class PlayerRoutes {

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
		register_rest_route(
			Routes::NS,
			'/widgets/player/source',
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'source' ),
				'permission_callback' => '__return_true', // The callback checks the signed ticket.
				'args'                => array(
					'ticket' => array(
						'type'     => 'string',
						'required' => true,
					),
				),
			)
		);
		register_rest_route(
			Routes::NS,
			'/widgets/player/translation',
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'translation' ),
				'permission_callback' => '__return_true', // The callback checks the signed ticket and the offered languages.
				'args'                => array(
					'ticket'        => array(
						'type'     => 'string',
						'required' => true,
					),
					'lang'          => array(
						'type'     => 'string',
						'required' => true,
						'pattern'  => '^[a-z]{2,3}(-[A-Za-z]{2,4})?$',
					),
					'transcription' => array(
						'type'    => 'string',
						'default' => '',
						'pattern' => '^[A-Za-z0-9_-]{0,64}$',
					),
				),
			)
		);
		register_rest_route(
			Routes::NS,
			'/widgets/player/transcript',
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'transcript' ),
				'permission_callback' => '__return_true',
				'args'                => array(
					'ticket'        => array(
						'type'     => 'string',
						'required' => true,
					),
					'transcription' => array(
						'type'     => 'string',
						'required' => true,
						'pattern'  => '^[A-Za-z0-9_-]{1,64}$',
					),
					'after'         => array(
						'type'    => 'integer',
						'default' => 0,
						'minimum' => 0,
					),
					'lang'          => array(
						'type'    => 'string',
						'default' => '',
						'pattern' => '^([a-z]{2,3}(-[A-Za-z]{2,4})?)?$',
					),
				),
			)
		);
	}

	/**
	 * What the player loads from.
	 *
	 * @param \WP_REST_Request $request The request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function source( \WP_REST_Request $request ) {
		$widget = Ticket::verify( (string) $request['ticket'] );
		if ( ! $widget || 'player' !== ( $widget['type'] ?? '' ) || '' === (string) ( $widget['id'] ?? '' ) ) {
			return new \WP_Error( 'vocalstack_bad_ticket', __( 'This player is out of date. Reload the page.', 'vocalstack' ), array( 'status' => 400 ) );
		}
		$vs = Plugin::sdk();
		if ( ! $vs ) {
			return new \WP_Error( 'vocalstack_not_connected', __( 'This player is not set up yet.', 'vocalstack' ), array( 'status' => 503 ) );
		}
		$id     = (string) $widget['id'];
		$source = (string) ( $widget['source'] ?? '' );
		try {
			if ( 'broadcast' === $source ) {
				$data = self::broadcast( $vs, $id );
			} elseif ( 'media' === $source ) {
				$data = self::media( $vs, (int) $id );
			} else {
				$data = self::transcription( $vs, $id );
			}
		} catch ( VocalStackException $e ) {
			$missing = in_array( $e->status(), array( 403, 404 ), true );
			return new \WP_Error( 'vocalstack_' . $e->errorCode(), $missing ? __( 'This transcription is no longer available.', 'vocalstack' ) : __( 'The player could not load. Try again later.', 'vocalstack' ), array( 'status' => $missing ? 404 : 502 ) );
		} catch ( ConnectionException $e ) {
			return new \WP_Error( 'vocalstack_unreachable', __( 'The player could not load. Try again later.', 'vocalstack' ), array( 'status' => 502 ) );
		}
		if ( is_wp_error( $data ) ) {
			return $data;
		}
		$data['languages'] = Languages::offered( $widget );
		$response          = new \WP_REST_Response( $data );
		// Pages may be cached; this answer carries a token that expires.
		$response->header( 'Cache-Control', 'private, max-age=60' );
		return $response;
	}

	/**
	 * A finished transcription: its audio URL and transcript. Cached a few minutes.
	 *
	 * A player saved before 0.4.0 may name a recording id: VocalStack no longer
	 * answers to those, so it reads as not found.
	 *
	 * @param VocalStack $vs The client.
	 * @param string     $id Transcription id.
	 * @return array<string, mixed>
	 */
	private static function transcription( VocalStack $vs, string $id ): array {
		$cache = 'vocalstack_player_' . md5( $id );
		$hit   = get_transient( $cache );
		if ( is_array( $hit ) ) {
			return $hit;
		}
		$transcription = $vs->transcriptions->get( $id );
		$id            = (string) ( $transcription['id'] ?? $id );
		$token         = $vs->transcriptions->mediaToken( $id );
		$transcript    = $vs->transcriptions->transcript( $id );
		$data          = array(
			'kind'            => 'transcription',
			'transcriptionId' => $id,
			'title'           => (string) ( $transcription['title'] ?? $transcription['name'] ?? '' ),
			'duration'        => (float) ( $transcription['durationS'] ?? 0 ),
			'audioUrl'        => add_query_arg(
				array(
					'kind'   => 'delivery',
					'format' => 'mp3',
					'media'  => rawurlencode( (string) $token['token'] ),
				),
				Settings::api_url() . '/v1/transcriptions/' . rawurlencode( $id ) . '/audio'
			),
			'mediaToken'      => (string) $token['token'],
			'sentences'       => RecordRoutes::sentences( $transcript ),
			'labelled'        => 'off' !== ( $transcript['speakerLabels'] ?? 'off' ),
		);
		// The media token lasts at least until the end of the next UTC day; refresh well before.
		set_transient( $cache, $data, 10 * MINUTE_IN_SECONDS );
		return $data;
	}

	/**
	 * A Media Library file: the VocalStack transcription behind its transcript,
	 * for listening in other languages. Its audio and transcript are in the page.
	 *
	 * @param VocalStack $vs The client.
	 * @param int        $id Attachment ID.
	 * @return array<string, mixed>|\WP_Error
	 */
	private static function media( VocalStack $vs, int $id ) {
		$transcription_id = Media::transcription_id( $id );
		if ( '' === $transcription_id || 'done' !== get_post_meta( $id, Media::STATE, true ) ) {
			return new \WP_Error( 'vocalstack_not_transcribed', __( 'This file has no VocalStack transcript to translate.', 'vocalstack' ), array( 'status' => 404 ) );
		}
		$cache = 'vocalstack_media_token_' . md5( $transcription_id );
		$token = get_transient( $cache );
		if ( ! is_string( $token ) || '' === $token ) {
			$token = (string) ( $vs->transcriptions->mediaToken( $transcription_id )['token'] ?? '' );
			set_transient( $cache, $token, HOUR_IN_SECONDS );
		}
		return array(
			'kind'            => 'media',
			'transcriptionId' => $transcription_id,
			'mediaToken'      => $token,
		);
	}

	/**
	 * A public broadcast: what the browser needs to follow it.
	 *
	 * @param VocalStack $vs The client.
	 * @param string     $id Broadcast id.
	 * @return array<string, mixed>|\WP_Error
	 */
	private static function broadcast( VocalStack $vs, string $id ) {
		$cache = 'vocalstack_broadcast_' . md5( $id );
		$hit   = get_transient( $cache );
		if ( ! is_array( $hit ) ) {
			$hit = $vs->broadcasts->get( $id );
			set_transient( $cache, $hit, 15 );
		}
		if ( 'public' !== ( $hit['access'] ?? 'public' ) ) {
			return new \WP_Error( 'vocalstack_private_broadcast', __( 'This broadcast is private and can’t be followed here.', 'vocalstack' ), array( 'status' => 403 ) );
		}
		$current = $hit['currentTranscription'] ?? null;
		$last    = $hit['lastTranscription'] ?? null;
		return array(
			'kind'        => 'broadcast',
			'broadcastId' => (string) $hit['id'],
			'name'        => (string) ( $hit['name'] ?? '' ),
			'shareUrl'    => (string) ( $hit['shareUrl'] ?? '' ),
			'socketBase'  => self::socket_base(),
			'live'        => is_array( $current ) ? array(
				'transcriptionId' => (string) ( $current['transcriptionId'] ?? '' ),
				'state'           => (string) ( $current['state'] ?? '' ),
			) : null,
			'last'        => is_array( $last ) ? array(
				'transcriptionId' => (string) ( $last['transcriptionId'] ?? '' ),
				'title'           => (string) ( $last['title'] ?? '' ),
				'startedAt'       => (string) ( $last['startedAt'] ?? '' ),
				'audioUrl'        => Settings::api_url() . '/v1/transcriptions/' . rawurlencode( (string) ( $last['transcriptionId'] ?? '' ) ) . '/audio?kind=delivery&format=mp3',
			) : null,
		);
	}

	/**
	 * The transcript of one of a public broadcast's transcriptions, as a listener sees it.
	 *
	 * @param \WP_REST_Request $request The request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function transcript( \WP_REST_Request $request ) {
		$widget = Ticket::verify( (string) $request['ticket'] );
		if ( ! $widget || 'player' !== ( $widget['type'] ?? '' ) || 'broadcast' !== ( $widget['source'] ?? '' ) ) {
			return new \WP_Error( 'vocalstack_bad_ticket', __( 'This player is out of date. Reload the page.', 'vocalstack' ), array( 'status' => 400 ) );
		}
		$transcription = (string) $request['transcription'];
		$after         = (int) $request['after'];
		$lang          = (string) $request['lang'];
		if ( '' !== $lang && ! Languages::is_offered( $widget, $lang ) ) {
			return new \WP_Error( 'vocalstack_language_not_offered', __( 'This language isn’t offered here.', 'vocalstack' ), array( 'status' => 403 ) );
		}
		$cache = 'vocalstack_listen_' . md5( $transcription . '|' . $after . '|' . $lang );
		$data  = get_transient( $cache );
		if ( ! is_array( $data ) ) {
			try {
				// No key: VocalStack answers only what any listener of a public broadcast may read.
				$listener   = new VocalStack( apiKey: null, baseUrl: Settings::api_url(), maxRetries: 0, httpClient: Plugin::http_client() );
				$transcript = $listener->transcriptions->transcript( $transcription, $after > 0 ? $after : null, '' !== $lang ? $lang : null );
			} catch ( VocalStackException $e ) {
				return new \WP_Error( 'vocalstack_' . $e->errorCode(), __( 'This transcript is not public.', 'vocalstack' ), array( 'status' => 404 ) );
			} catch ( ConnectionException $e ) {
				return new \WP_Error( 'vocalstack_unreachable', __( 'The transcript could not load.', 'vocalstack' ), array( 'status' => 502 ) );
			}
			$sentences = RecordRoutes::sentences( $transcript );
			if ( '' !== $lang ) {
				// What VocalStack has translated so far; the rest follows over the socket.
				$translated = array();
				foreach ( (array) ( $transcript['sentences'] ?? array() ) as $s ) {
					if ( isset( $s['translations'][ $lang ] ) ) {
						$translated[ (int) $s['sentenceId'] ] = (string) $s['translations'][ $lang ];
					}
				}
				foreach ( $sentences as &$s ) {
					if ( isset( $translated[ $s['id'] ] ) ) {
						$s['translations'] = array( $lang => $translated[ $s['id'] ] );
					}
				}
				unset( $s );
			}
			$data = array(
				'lastSeq'   => (int) ( $transcript['lastSeq'] ?? 0 ),
				'state'     => (string) ( $transcript['state'] ?? '' ),
				'sentences' => $sentences,
			);
			// Every visitor's request comes from this server's address: share answers briefly.
			set_transient( $cache, $data, 3 );
		}
		return new \WP_REST_Response( $data );
	}

	/**
	 * A transcription's transcript in another language, and what the browser needs
	 * to hear it spoken a sentence at a time (as VocalStack's own reader does:
	 * `GET /v1/transcriptions/{id}/voice/{sentence}?lang=` speaks a line on demand).
	 *
	 * Only languages the widget offers: each translation is billed to the site's
	 * account. A broadcast's transcription is asked for without the key, so
	 * VocalStack applies its public-listener rules. Answers are kept for a few
	 * hours, so repeat listeners don't translate the same lines again.
	 *
	 * @param \WP_REST_Request $request The request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function translation( \WP_REST_Request $request ) {
		$widget = Ticket::verify( (string) $request['ticket'] );
		if ( ! $widget || 'player' !== ( $widget['type'] ?? '' ) || '' === (string) ( $widget['id'] ?? '' ) ) {
			return new \WP_Error( 'vocalstack_bad_ticket', __( 'This player is out of date. Reload the page.', 'vocalstack' ), array( 'status' => 400 ) );
		}
		$lang = (string) $request['lang'];
		if ( ! Languages::is_offered( $widget, $lang ) ) {
			return new \WP_Error( 'vocalstack_language_not_offered', __( 'This language isn’t offered here.', 'vocalstack' ), array( 'status' => 403 ) );
		}
		$source = (string) ( $widget['source'] ?? '' );
		$vs     = Plugin::sdk();
		if ( ! $vs ) {
			return new \WP_Error( 'vocalstack_not_connected', __( 'This player is not set up yet.', 'vocalstack' ), array( 'status' => 503 ) );
		}
		try {
			if ( 'broadcast' === $source ) {
				$transcription_id = (string) $request['transcription'];
				$client           = new VocalStack( apiKey: null, baseUrl: Settings::api_url(), maxRetries: 0, httpClient: Plugin::http_client() );
			} else {
				$transcription_id = 'media' === $source ? Media::transcription_id( (int) $widget['id'] ) : (string) $widget['id'];
				$client           = $vs;
			}
			if ( '' === $transcription_id ) {
				return new \WP_Error( 'vocalstack_not_transcribed', __( 'This file has no VocalStack transcript to translate.', 'vocalstack' ), array( 'status' => 404 ) );
			}
			$cache = 'vocalstack_tr_' . md5( $transcription_id . '|' . $lang . '|' . ( 'broadcast' === $source ? 'listener' : 'owner' ) );
			$data  = get_transient( $cache );
			if ( ! is_array( $data ) ) {
				$data = self::translate( $client, $transcription_id, $lang );
				set_transient( $cache, $data, 6 * HOUR_IN_SECONDS );
			}
		} catch ( VocalStackException $e ) {
			return new \WP_Error( 'vocalstack_' . $e->errorCode(), __( 'This translation is not available right now.', 'vocalstack' ), array( 'status' => in_array( $e->status(), array( 403, 404 ), true ) ? 404 : 502 ) );
		} catch ( ConnectionException $e ) {
			return new \WP_Error( 'vocalstack_unreachable', __( 'This translation is not available right now.', 'vocalstack' ), array( 'status' => 502 ) );
		}
		return new \WP_REST_Response( $data );
	}

	/**
	 * Translate a transcription's sentences: the translations VocalStack already
	 * holds (`transcript?lang=`), then the rest in batches of 40.
	 *
	 * @param VocalStack $client           The client (the owner's, or a listener's).
	 * @param string     $transcription_id Transcription.
	 * @param string     $lang             Language code.
	 * @return array<string, mixed>
	 */
	private static function translate( VocalStack $client, string $transcription_id, string $lang ): array {
		$transcript = $client->transcriptions->transcript( $transcription_id, null, $lang );
		$sentences  = array();
		$missing    = array();
		foreach ( (array) ( $transcript['sentences'] ?? array() ) as $s ) {
			if ( 'dropped' === ( $s['status'] ?? '' ) || ! empty( $s['suppressed'] ) || '' === trim( (string) ( $s['text'] ?? '' ) ) ) {
				continue;
			}
			$id         = (int) ( $s['sentenceId'] ?? 0 );
			$text       = trim( (string) $s['text'] );
			$translated = $s['translations'][ $lang ] ?? ( ( $s['language'] ?? '' ) === $lang ? $text : null );
			if ( null === $translated ) {
				$missing[] = $id;
			}
			$sentences[ $id ] = array(
				'id'         => $id,
				'start'      => (float) ( $s['start'] ?? 0 ),
				'end'        => (float) ( $s['end'] ?? 0 ),
				'speaker'    => (int) ( $s['speaker'] ?? -1 ),
				'original'   => $text,
				'text'       => null === $translated ? $text : trim( (string) $translated ),
				'translated' => null !== $translated,
			);
		}
		foreach ( array_chunk( $missing, 40 ) as $chunk ) {
			$answer = $client->transcriptions->translation( $transcription_id, $lang, $chunk );
			foreach ( (array) ( $answer['translations'] ?? array() ) as $id => $text ) {
				if ( isset( $sentences[ (int) $id ] ) && '' !== trim( (string) $text ) ) {
					$sentences[ (int) $id ]['text']       = trim( (string) $text );
					$sentences[ (int) $id ]['translated'] = true;
				}
			}
		}
		usort( $sentences, fn( $a, $b ) => $a['start'] <=> $b['start'] );

		$voice = ! empty( Languages::all()[ $lang ]['voice'] );
		$clips = array();
		if ( $voice ) {
			// The default voice's row: which lines were spoken in pieces, and a digest per line for caching.
			foreach ( $client->transcriptions->voice( $transcription_id, $lang ) as $row ) {
				if ( ( $row['lang'] ?? '' ) === $lang && '' === (string) ( $row['voiceKey'] ?? '' ) ) {
					$clips = array(
						'parts' => (array) ( $row['clipParts'] ?? array() ),
						'rev'   => (array) ( $row['clipRev'] ?? array() ),
						'dur'   => (array) ( $row['clipDur'] ?? array() ),
					);
					break;
				}
			}
		}
		return array(
			'lang'            => $lang,
			'transcriptionId' => $transcription_id,
			'voice'           => $voice,
			'clips'           => (object) $clips,
			'sentences'       => array_values( $sentences ),
		);
	}

	/**
	 * The API's WebSocket base, `wss://api.vocalstack.com`.
	 */
	public static function socket_base(): string {
		return (string) preg_replace( '#^http#', 'ws', Settings::api_url() );
	}
}
