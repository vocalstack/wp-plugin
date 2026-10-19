<?php
/**
 * The VocalStack calls the plugin makes.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Transcriber;

defined( 'ABSPATH' ) || exit;

/**
 * What the plugin needs from VocalStack. The default implementation wraps the
 * vocalstack/sdk client; tests use a fake. Every method throws TranscriberError
 * when VocalStack refuses or cannot be reached.
 */
interface Transcriber {

	/**
	 * The connected account, from `GET /v1/me`.
	 *
	 * @return array<string, mixed>
	 */
	public function account(): array;

	/**
	 * The account's plan, rates and credit, `GET /v1/billing`.
	 *
	 * @return array<string, mixed> A BillingView.
	 */
	public function billing(): array;

	/**
	 * Start a transcription, `POST /v1/transcriptions`.
	 *
	 * @param Source               $source          Where the audio comes from.
	 * @param string               $name            The recording's name in VocalStack.
	 * @param string               $idempotency_key The same key never starts two jobs.
	 * @param array<string, mixed> $settings        VocalStack's transcription settings, by their wire
	 *                                              names: `spokenLanguage` (absent to auto-detect),
	 *                                              `speakerLabels` (`off`, `auto` or `on`).
	 * @return array{recordingId: string, transcriptionId: string}
	 */
	public function start( Source $source, string $name, string $idempotency_key, array $settings = array() ): array;

	/**
	 * The job's state, `GET /v1/recordings/{id}/job`.
	 *
	 * @param string $recording_id The recording.
	 * @return array{state: string, progress?: array<string, mixed>, error?: ?string, errorCode?: ?string}
	 */
	public function job( string $recording_id ): array;

	/**
	 * Stop a job before it finishes, `POST /v1/recordings/{id}/stop`.
	 *
	 * @param string $recording_id The recording.
	 */
	public function stop( string $recording_id ): void;

	/**
	 * The finished transcript, `GET /v1/recordings/{id}/transcript`.
	 *
	 * @param string $recording_id The recording.
	 * @return array{lang?: ?string, sentences: list<array<string, mixed>>, segments?: list<array<string, mixed>>}
	 */
	public function transcript( string $recording_id ): array;
}
