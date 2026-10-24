<?php
/**
 * Starting, following and stopping transcription jobs.
 *
 * @package VocalStack
 */

namespace VocalStack\WP;

use VocalStack\WP\Transcriber\TranscriberError;

defined( 'ABSPATH' ) || exit;

/**
 * Jobs run on VocalStack. The admin polls `status` every few seconds while it
 * is open, and WP-Cron polls once a minute so a job still lands when nobody is
 * watching. Both go through refresh().
 */
final class Jobs {

	const POLL_HOOK = 'vocalstack_poll';
	const AUTO_HOOK = 'vocalstack_auto_transcribe';

	/** Seconds between two checks of the same job, whoever asks. */
	const THROTTLE = 2;

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_filter( 'cron_schedules', array( self::class, 'cron_schedules' ) ); // phpcs:ignore WordPress.WP.CronInterval.CronSchedulesInterval -- A minute is the point.
		add_action( self::POLL_HOOK, array( self::class, 'poll' ) );
		add_action( self::AUTO_HOOK, array( self::class, 'auto_transcribe' ) );
		add_action( 'add_attachment', array( self::class, 'on_upload' ) );
	}

	/**
	 * Start transcribing an attachment.
	 *
	 * @param int                       $id       Attachment ID.
	 * @param array<string, mixed>|null $settings VocalStack settings by wire name; null for the site's.
	 * @return array<string, mixed>|\WP_Error The attachment's data, or why it did not start.
	 */
	public static function start( int $id, ?array $settings = null ) {
		if ( ! Media::is_transcribable( $id ) ) {
			return new \WP_Error( 'vocalstack_not_media', __( 'Only audio and video can be transcribed.', 'vocalstack' ), array( 'status' => 400 ) );
		}
		if ( '' === Settings::api_key() ) {
			return new \WP_Error( 'vocalstack_not_connected', __( 'Connect your account on the VocalStack page in the admin menu first.', 'vocalstack' ), array( 'status' => 409 ) );
		}
		if ( in_array( get_post_meta( $id, Media::STATE, true ), Media::PENDING, true ) ) {
			return Media::data( $id );
		}
		// Two clicks in quick succession start one job.
		$lock = 'start_' . $id;
		if ( ! Lock::acquire( $lock, 60 ) ) {
			return Media::data( $id );
		}
		// Another request may have started it between the check above and the lock.
		wp_cache_delete( $id, 'post_meta' );
		if ( in_array( get_post_meta( $id, Media::STATE, true ), Media::PENDING, true ) ) {
			Lock::release( $lock );
			return Media::data( $id );
		}

		$source = Media::source( $id );
		if ( ! $source ) {
			Lock::release( $lock );
			return new \WP_Error( 'vocalstack_no_file', __( 'The file for this attachment is missing.', 'vocalstack' ), array( 'status' => 404 ) );
		}

		$key      = wp_generate_uuid4();
		$name     = get_the_title( $id );
		$settings = $settings ?? Settings::transcription();
		try {
			$started = Plugin::transcriber()->start( $source, '' !== $name ? $name : wp_basename( (string) get_attached_file( $id ) ), $key, $settings );
		} catch ( TranscriberError $e ) {
			Lock::release( $lock );
			self::fail( $id, $e->getMessage(), $e->error_code );
			return new \WP_Error( 'vocalstack_' . $e->error_code, $e->getMessage(), array( 'status' => $e->http_status >= 400 && $e->http_status < 500 ? 400 : 502 ) );
		}

		update_post_meta(
			$id,
			Media::JOB,
			array(
				'recordingId'     => (string) $started['recordingId'],
				'transcriptionId' => (string) $started['transcriptionId'],
				'idempotencyKey'  => $key,
				// What was asked for: the API answers with the detected language either way.
				'spokenLanguage'  => $settings['spokenLanguage'] ?? '',
				'startedAt'       => time(),
				'progress'        => array( 'pct' => 0 ),
			)
		);
		update_post_meta( $id, Media::STATE, 'queued' );
		update_post_meta( $id, Media::TRANSCRIPTION_ID, (string) $started['transcriptionId'] );
		Lock::release( $lock );
		self::schedule_poll();
		return Media::data( $id );
	}

	/**
	 * Bring an attachment's job up to date with VocalStack, saving the
	 * transcript once it is done.
	 *
	 * @param int $id Attachment ID.
	 * @return array<string, mixed> The attachment's data.
	 */
	public static function refresh( int $id ): array {
		$job = get_post_meta( $id, Media::JOB, true );
		if ( ! in_array( get_post_meta( $id, Media::STATE, true ), Media::PENDING, true ) || ! is_array( $job ) || empty( $job['recordingId'] ) ) {
			return Media::data( $id );
		}
		$throttle = 'vocalstack_checked_' . $id;
		if ( get_transient( $throttle ) ) {
			return Media::data( $id );
		}
		set_transient( $throttle, 1, self::THROTTLE );

		$client = Plugin::transcriber();
		try {
			$remote = $client->job( $job['recordingId'] );
			$state  = (string) ( $remote['state'] ?? '' );
			if ( 'done' === $state ) {
				Media::save_transcript( $id, $client->transcript( $job['recordingId'] ), $job['spokenLanguage'] ?? null );
				$job['progress'] = array( 'pct' => 100 );
				$job['error']    = null;
				update_post_meta( $id, Media::JOB, $job );
				update_post_meta( $id, Media::STATE, 'done' );
			} elseif ( 'failed' === $state ) {
				if ( 'stopped' === ( $remote['errorCode'] ?? '' ) ) {
					self::revert( $id );
				} else {
					self::fail( $id, (string) ( $remote['error'] ?? __( 'Transcription failed.', 'vocalstack' ) ), (string) ( $remote['errorCode'] ?? 'failed' ) );
				}
			} elseif ( in_array( $state, Media::PENDING, true ) ) {
				$job['progress'] = $remote['progress'] ?? $job['progress'] ?? null;
				update_post_meta( $id, Media::JOB, $job );
				update_post_meta( $id, Media::STATE, $state );
			}
		} catch ( TranscriberError $e ) {
			// A 404 means the recording is gone; anything else may pass, so try again next time.
			if ( 404 === $e->http_status ) {
				self::fail( $id, $e->getMessage(), $e->error_code );
			}
		}
		return Media::data( $id );
	}

	/**
	 * Stop a running job. The attachment goes back to how it was; VocalStack
	 * keeps whatever it transcribed before the stop.
	 *
	 * @param int $id Attachment ID.
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function stop( int $id ) {
		$job = get_post_meta( $id, Media::JOB, true );
		if ( ! in_array( get_post_meta( $id, Media::STATE, true ), Media::PENDING, true ) || ! is_array( $job ) ) {
			return Media::data( $id );
		}
		try {
			Plugin::transcriber()->stop( $job['recordingId'] );
		} catch ( TranscriberError $e ) {
			// Already finished or gone: nothing left to stop.
			if ( 404 !== $e->http_status && 409 !== $e->http_status ) {
				return new \WP_Error( 'vocalstack_' . $e->error_code, $e->getMessage(), array( 'status' => 502 ) );
			}
		}
		self::revert( $id );
		return Media::data( $id );
	}

	/**
	 * Back to the last transcript, or to never transcribed.
	 *
	 * @param int $id Attachment ID.
	 */
	private static function revert( int $id ): void {
		delete_post_meta( $id, Media::JOB );
		$has_transcript = '' !== (string) get_post_meta( $id, Media::TRANSCRIPT, true );
		update_post_meta( $id, Media::STATE, $has_transcript ? 'done' : '' );
	}

	/**
	 * Record a failure; an earlier transcript stays.
	 *
	 * @param int    $id      Attachment ID.
	 * @param string $message Why.
	 * @param string $code    VocalStack's error code.
	 */
	private static function fail( int $id, string $message, string $code ): void {
		$job              = get_post_meta( $id, Media::JOB, true );
		$job              = is_array( $job ) ? $job : array();
		$job['error']     = $message;
		$job['errorCode'] = $code;
		update_post_meta( $id, Media::JOB, $job );
		update_post_meta( $id, Media::STATE, 'failed' );
	}

	/**
	 * Add a one-minute cron interval.
	 *
	 * @param array<string, array<string, mixed>> $schedules Known intervals.
	 * @return array<string, array<string, mixed>>
	 */
	public static function cron_schedules( array $schedules ): array {
		$schedules['vocalstack_minute'] = array(
			'interval' => MINUTE_IN_SECONDS,
			'display'  => __( 'Every minute (VocalStack)', 'vocalstack' ),
		);
		return $schedules;
	}

	/**
	 * Poll every minute while any job is unfinished.
	 */
	private static function schedule_poll(): void {
		if ( ! wp_next_scheduled( self::POLL_HOOK ) ) {
			wp_schedule_event( time() + MINUTE_IN_SECONDS, 'vocalstack_minute', self::POLL_HOOK );
		}
	}

	/**
	 * Cron: refresh unfinished jobs, and stop polling when there are none.
	 */
	public static function poll(): void {
		$ids = get_posts(
			array(
				'post_type'      => 'attachment',
				// Attachments are `inherit`, which `any` leaves out.
				'post_status'    => array( 'inherit', 'private' ),
				'fields'         => 'ids',
				'posts_per_page' => 25,
				'meta_key'       => Media::STATE, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- Few rows carry it.
				'meta_value'     => Media::PENDING, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_value
				'meta_compare'   => 'IN',
			)
		);
		foreach ( $ids as $id ) {
			self::refresh( (int) $id );
		}
		if ( ! $ids ) {
			wp_clear_scheduled_hook( self::POLL_HOOK );
		}
	}

	/**
	 * A new upload: transcribe it later if the site asks for that. Cron does
	 * the work, so the upload itself does not wait on VocalStack.
	 *
	 * @param int $id Attachment ID.
	 */
	public static function on_upload( int $id ): void {
		$auto = Settings::get( 'auto' );
		if ( 'off' === $auto || '' === Settings::api_key() || ! Media::is_transcribable( $id ) ) {
			return;
		}
		if ( 'audio' === $auto && ! str_starts_with( (string) get_post_mime_type( $id ), 'audio/' ) ) {
			return;
		}
		wp_schedule_single_event( time(), self::AUTO_HOOK, array( $id ) );
	}

	/**
	 * Cron: the delayed start for an automatic transcription.
	 *
	 * @param int $id Attachment ID.
	 */
	public static function auto_transcribe( int $id ): void {
		self::start( (int) $id );
	}
}
