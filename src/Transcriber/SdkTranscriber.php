<?php
/**
 * The Transcriber on the vocalstack/sdk client.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Transcriber;

use VocalStack\Http\ConnectionException;
use VocalStack\Upload;
use VocalStack\VocalStack;
use VocalStack\VocalStackException;

defined( 'ABSPATH' ) || exit;

/**
 * Maps the plugin's calls onto the SDK and its exceptions onto TranscriberError.
 */
final class SdkTranscriber implements Transcriber {

	/**
	 * The SDK client.
	 *
	 * @var VocalStack
	 */
	private VocalStack $vs;

	/**
	 * Build the client.
	 *
	 * @param string                           $api_key  A `vs_key_…` key.
	 * @param string                           $base_url The API's base URL.
	 * @param \VocalStack\Http\HttpClient|null $http The HTTP client; WordPress's by default.
	 */
	public function __construct( string $api_key, string $base_url, ?\VocalStack\Http\HttpClient $http = null ) {
		$this->vs = new VocalStack(
			apiKey: $api_key,
			baseUrl: $base_url,
			// The SDK sleeps through Retry-After (up to 60 s); an admin request should not.
			maxRetries: 1,
			httpClient: $http ?? new WpHttpClient(),
		);
	}

	/**
	 * Run an SDK call, turning its failures into TranscriberError.
	 *
	 * @param callable $call The call.
	 * @return mixed
	 * @throws TranscriberError When VocalStack refused or was not reached.
	 */
	private function call( callable $call ) {
		try {
			return $call();
		} catch ( VocalStackException $e ) {
			throw new TranscriberError( $e->getMessage(), $e->errorCode(), (int) $e->status() ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- Sent as JSON, shown as text.
		} catch ( ConnectionException $e ) {
			/* translators: %s: the network error. */
			throw new TranscriberError( sprintf( __( 'Could not reach VocalStack: %s', 'vocalstack' ), $e->getMessage() ), 'connection_failed', 0 ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- Sent as JSON, shown as text.
		}
	}

	/**
	 * The connected account.
	 *
	 * @throws TranscriberError On failure.
	 */
	public function account(): array {
		return $this->call( fn() => $this->vs->me->get() );
	}

	/**
	 * The account's plan, rates and credit.
	 *
	 * @throws TranscriberError On failure.
	 */
	public function billing(): array {
		return $this->call( fn() => $this->vs->billing->get() );
	}

	/**
	 * Start a transcription from a URL, or by uploading the file.
	 *
	 * @param Source               $source          Where the audio comes from.
	 * @param string               $name            The recording's name.
	 * @param string               $idempotency_key The same key never starts two jobs.
	 * @param array<string, mixed> $settings        Transcription settings, by their wire names.
	 * @throws TranscriberError On failure, or when the answer carries no job.
	 */
	public function start( Source $source, string $name, string $idempotency_key, array $settings = array() ): array {
		$fields = array( 'name' => $name );
		if ( $settings ) {
			$fields['settings'] = $settings;
		}
		$created      = $this->call(
			fn() => $source->is_file()
				? $this->vs->transcriptions->create( $fields, Upload::path( $source->path, $source->file_name ), $source->file_name, $idempotency_key )
				: $this->vs->transcriptions->createFromUrl( $source->url, $fields, $idempotency_key )
		);
		$recording_id = (string) ( $created['job']['recordingId'] ?? '' );
		if ( '' === $recording_id ) {
			throw new TranscriberError( __( 'VocalStack did not start a job.', 'vocalstack' ), 'no_job' ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- Sent as JSON, shown as text.
		}
		return array(
			'recordingId'     => $recording_id,
			'transcriptionId' => (string) ( $created['id'] ?? $created['job']['transcriptionId'] ?? '' ),
		);
	}

	/**
	 * The job's state.
	 *
	 * @param string $recording_id The recording.
	 * @throws TranscriberError On failure.
	 */
	public function job( string $recording_id ): array {
		return $this->call( fn() => $this->vs->jobs->get( $recording_id ) );
	}

	/**
	 * Stop the job.
	 *
	 * @param string $recording_id The recording.
	 * @throws TranscriberError On failure.
	 */
	public function stop( string $recording_id ): void {
		$this->call( fn() => $this->vs->recordings->stop( $recording_id, 'Stopped from WordPress' ) );
	}

	/**
	 * The finished transcript.
	 *
	 * @param string $recording_id The recording.
	 * @throws TranscriberError On failure.
	 */
	public function transcript( string $recording_id ): array {
		return $this->call( fn() => $this->vs->recordings->transcript( $recording_id ) );
	}
}
