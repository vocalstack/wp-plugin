<?php
/**
 * Which attachments can be transcribed, and what is stored on them.
 *
 * @package VocalStack
 */

namespace VocalStack\WP;

use VocalStack\WP\Transcriber\Source;

defined( 'ABSPATH' ) || exit;

/**
 * A transcript lives on its attachment as post meta:
 *
 * - `_vocalstack_state`: '' (never transcribed), a job state (`queued`,
 *   `fetching`, `cropping`, `transcribing`), `done` or `failed`. Its own key
 *   so the poller can query unfinished jobs.
 * - `_vocalstack_job`: recordingId, transcriptionId, progress, error, errorCode,
 *   startedAt, idempotency key.
 * - `_vocalstack_transcript`: the text, which editors can change.
 * - `_vocalstack_sentences`: `[{ start, end, speaker, text }]`, in seconds.
 * - `_vocalstack_language` (the main detected language), `_vocalstack_languages`
 *   (every detected language, most spoken first), `_vocalstack_requested_language`
 *   ('' when auto-detect was on), `_vocalstack_speakers` (how many; '' when
 *   speakers were not identified) and `_vocalstack_transcribed_at`.
 *
 * A stopped or failed job leaves an earlier transcript in place.
 */
final class Media {

	const STATE            = '_vocalstack_state';
	const JOB              = '_vocalstack_job';
	const TRANSCRIPT       = '_vocalstack_transcript';
	const SENTENCES        = '_vocalstack_sentences';
	const LANGUAGE         = '_vocalstack_language';
	const LANGUAGES        = '_vocalstack_languages';
	const REQUESTED        = '_vocalstack_requested_language';
	const SPEAKERS         = '_vocalstack_speakers';
	const TRANSCRIPTION_ID = '_vocalstack_transcription_id';
	const TRANSCRIBED_AT   = '_vocalstack_transcribed_at';

	/** States of a job still running on VocalStack. */
	const PENDING = array( 'queued', 'fetching', 'cropping', 'transcribing' );

	/**
	 * Hooks.
	 */
	public static function register(): void {
		// Meta stays private (underscored); the plugin's own REST routes expose it.
		add_filter( 'wp_prepare_attachment_for_js', array( self::class, 'prepare_for_js' ), 10, 2 );
	}

	/**
	 * Whether an attachment is audio or video.
	 *
	 * @param int $id Attachment ID.
	 */
	public static function is_transcribable( int $id ): bool {
		if ( 'attachment' !== get_post_type( $id ) ) {
			return false;
		}
		$mime = (string) get_post_mime_type( $id );
		$ok   = str_starts_with( $mime, 'audio/' ) || str_starts_with( $mime, 'video/' );
		/**
		 * Filters whether an attachment gets the Transcribe button.
		 *
		 * @param bool $ok Audio or video.
		 * @param int  $id Attachment ID.
		 */
		return (bool) apply_filters( 'vocalstack_is_transcribable', $ok, $id );
	}

	/**
	 * Where VocalStack gets the attachment's audio: its public URL, or, when the
	 * site is not reachable from the internet (localhost, a private network),
	 * the file itself.
	 *
	 * @param int $id Attachment ID.
	 */
	public static function source( int $id ): ?Source {
		$url = (string) wp_get_attachment_url( $id );
		/**
		 * Filters the address VocalStack fetches the attachment from, such as a
		 * CDN or bucket URL. Return '' to upload the file instead.
		 *
		 * @param string $url The attachment's URL.
		 * @param int    $id  Attachment ID.
		 */
		$url = (string) apply_filters( 'vocalstack_file_url', $url, $id );
		if ( '' !== $url && self::is_public_url( $url ) ) {
			return Source::url( $url );
		}
		$path = get_attached_file( $id );
		if ( $path && is_readable( $path ) ) {
			return Source::file( $path, (string) get_post_mime_type( $id ) );
		}
		return null;
	}

	/**
	 * Whether VocalStack can fetch a URL: http(s), and a host that does not
	 * resolve to a loopback, private or reserved address.
	 *
	 * @param string $url An absolute URL.
	 */
	public static function is_public_url( string $url ): bool {
		$parts = wp_parse_url( $url );
		if ( empty( $parts['host'] ) || ! in_array( $parts['scheme'] ?? '', array( 'http', 'https' ), true ) ) {
			return false;
		}
		$host = strtolower( trim( $parts['host'], '[]' ) );
		if ( 'localhost' === $host || str_ends_with( $host, '.localhost' ) || str_ends_with( $host, '.local' ) || str_ends_with( $host, '.test' ) ) {
			return false;
		}
		$ips = filter_var( $host, FILTER_VALIDATE_IP ) ? array( $host ) : (array) gethostbynamel( $host );
		if ( ! $ips ) {
			return false;
		}
		foreach ( $ips as $ip ) {
			if ( ! filter_var( $ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE ) ) {
				return false;
			}
		}
		return true;
	}

	/**
	 * The attachment's VocalStack data, for the admin UI.
	 *
	 * @param int $id Attachment ID.
	 * @return array<string, mixed>
	 */
	public static function data( int $id ): array {
		$job = get_post_meta( $id, self::JOB, true );
		$job = is_array( $job ) ? $job : array();
		return array(
			'id'              => $id,
			'transcribable'   => self::is_transcribable( $id ),
			'state'           => (string) get_post_meta( $id, self::STATE, true ),
			'progress'        => $job['progress'] ?? null,
			'error'           => $job['error'] ?? null,
			'errorCode'       => $job['errorCode'] ?? null,
			'recordingId'     => $job['recordingId'] ?? null,
			'transcriptionId' => (string) get_post_meta( $id, self::TRANSCRIPTION_ID, true ),
			'transcript'      => (string) get_post_meta( $id, self::TRANSCRIPT, true ),
			'sentences'       => self::sentences( $id ),
			'language'        => (string) get_post_meta( $id, self::LANGUAGE, true ),
			'transcribedAt'   => (string) get_post_meta( $id, self::TRANSCRIBED_AT, true ),
		);
	}

	/**
	 * One row of the media list: the attachment's VocalStack state without the
	 * transcript itself.
	 *
	 * @param int $id Attachment ID.
	 * @return array<string, mixed>
	 */
	public static function row( int $id ): array {
		$job        = get_post_meta( $id, self::JOB, true );
		$job        = is_array( $job ) ? $job : array();
		$meta       = wp_get_attachment_metadata( $id );
		$transcript = (string) get_post_meta( $id, self::TRANSCRIPT, true );
		$title      = get_the_title( $id );
		return array(
			'id'            => $id,
			'title'         => '' !== $title ? $title : wp_basename( (string) get_attached_file( $id ) ),
			'kind'          => str_starts_with( (string) get_post_mime_type( $id ), 'video/' ) ? 'video' : 'audio',
			'length'        => is_array( $meta ) && ! empty( $meta['length_formatted'] ) ? (string) $meta['length_formatted'] : '',
			'state'         => (string) get_post_meta( $id, self::STATE, true ),
			'progress'      => $job['progress'] ?? null,
			'error'         => $job['error'] ?? null,
			'words'         => '' === $transcript ? 0 : count( preg_split( '/\s+/u', trim( $transcript ) ) ),
			'languages'     => self::languages( $id ),
			'autoLanguage'  => self::auto_language( $id ),
			'speakers'      => '' === (string) get_post_meta( $id, self::SPEAKERS, true ) ? null : (int) get_post_meta( $id, self::SPEAKERS, true ),
			'url'           => (string) wp_get_attachment_url( $id ),
			'transcribedAt' => (string) get_post_meta( $id, self::TRANSCRIBED_AT, true ),
			'editUrl'       => (string) get_edit_post_link( $id, 'raw' ),
		);
	}

	/**
	 * Every language detected in the transcript, most spoken first.
	 *
	 * @param int $id Attachment ID.
	 * @return list<string>
	 */
	public static function languages( int $id ): array {
		$languages = get_post_meta( $id, self::LANGUAGES, true );
		if ( is_array( $languages ) && $languages ) {
			return array_values( $languages );
		}
		$main = (string) get_post_meta( $id, self::LANGUAGE, true );
		return '' === $main ? array() : array( $main );
	}

	/**
	 * Whether the transcript's language was auto-detected; null when the
	 * transcript predates the plugin recording it.
	 *
	 * @param int $id Attachment ID.
	 */
	public static function auto_language( int $id ): ?bool {
		if ( ! metadata_exists( 'post', $id, self::REQUESTED ) ) {
			return null;
		}
		return '' === (string) get_post_meta( $id, self::REQUESTED, true );
	}

	/**
	 * The VocalStack recording behind the attachment's transcript, or ''.
	 *
	 * @param int $id Attachment ID.
	 */
	public static function recording_id( int $id ): string {
		$job = get_post_meta( $id, self::JOB, true );
		return is_array( $job ) ? (string) ( $job['recordingId'] ?? '' ) : '';
	}

	/**
	 * The timed sentences.
	 *
	 * @param int $id Attachment ID.
	 * @return list<array{start: float, end: float, speaker: int, text: string}>
	 */
	public static function sentences( int $id ): array {
		$sentences = get_post_meta( $id, self::SENTENCES, true );
		return is_array( $sentences ) ? $sentences : array();
	}

	/**
	 * Store a finished transcript from VocalStack's `/transcript` answer.
	 *
	 * @param int                  $id         Attachment ID.
	 * @param array<string, mixed> $transcript The answer.
	 * @param string|null          $requested  The language asked for ('' for auto-detect), or null if unknown.
	 */
	public static function save_transcript( int $id, array $transcript, ?string $requested = null ): void {
		$sentences = array();
		$languages = array();
		$speakers  = array();
		foreach ( (array) ( $transcript['sentences'] ?? array() ) as $s ) {
			if ( ! empty( $s['suppressed'] ) || '' === trim( (string) ( $s['text'] ?? '' ) ) ) {
				continue;
			}
			if ( ! empty( $s['language'] ) ) {
				$languages[ $s['language'] ] = ( $languages[ $s['language'] ] ?? 0 ) + 1;
			}
			// -1: speakers were not told apart.
			if ( (int) ( $s['speaker'] ?? -1 ) >= 0 ) {
				$speakers[ (int) $s['speaker'] ] = true;
			}
			$sentences[] = array(
				'start'   => round( (float) $s['start'], 2 ),
				'end'     => round( (float) $s['end'], 2 ),
				'speaker' => (int) ( $s['speaker'] ?? 0 ),
				'text'    => trim( (string) $s['text'] ),
			);
		}
		// wp_slash: update_post_meta unslashes, which would eat backslashes in the text.
		update_post_meta( $id, self::SENTENCES, wp_slash( $sentences ) );
		update_post_meta( $id, self::TRANSCRIPT, wp_slash( Text::plain( $sentences ) ) );
		arsort( $languages );
		$languages = array_keys( $languages );
		if ( ! $languages && ! empty( $transcript['lang'] ) ) {
			$languages = array( (string) $transcript['lang'] );
		}
		$labelled = 'off' !== ( $transcript['speakerLabels'] ?? 'off' ) || $speakers;
		$count    = ! empty( $transcript['speakers'] ) && is_array( $transcript['speakers'] ) ? count( $transcript['speakers'] ) : count( $speakers );
		update_post_meta( $id, self::LANGUAGE, (string) ( $transcript['lang'] ?? $languages[0] ?? '' ) );
		update_post_meta( $id, self::LANGUAGES, $languages );
		update_post_meta( $id, self::SPEAKERS, $labelled ? max( 1, $count ) : '' );
		if ( null !== $requested ) {
			update_post_meta( $id, self::REQUESTED, $requested );
		}
		update_post_meta( $id, self::TRANSCRIBED_AT, gmdate( 'c' ) );
	}

	/**
	 * Add VocalStack's state to attachments in the media modal.
	 *
	 * @param array<string, mixed> $response The attachment for JS.
	 * @param \WP_Post             $post     The attachment.
	 * @return array<string, mixed>
	 */
	public static function prepare_for_js( array $response, \WP_Post $post ): array {
		if ( self::is_transcribable( $post->ID ) ) {
			$response['vocalstack'] = array(
				'state'         => (string) get_post_meta( $post->ID, self::STATE, true ),
				'hasTranscript' => '' !== (string) get_post_meta( $post->ID, self::TRANSCRIPT, true ),
			);
		}
		return $response;
	}
}
