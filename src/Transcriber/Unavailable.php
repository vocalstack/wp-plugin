<?php
/**
 * Stand-in until the SDK adapter exists.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Transcriber;

defined( 'ABSPATH' ) || exit;

/**
 * Refuses every call. Replaced by the vocalstack/sdk adapter.
 */
final class Unavailable implements Transcriber {

	/**
	 * The refusal every method throws.
	 */
	private function refuse(): TranscriberError {
		return new TranscriberError( __( 'The VocalStack client is not installed yet.', 'vocalstack' ), 'client_unavailable' );
	}

	/**
	 * Refuses.
	 *
	 * @throws TranscriberError Always.
	 */
	public function account(): array {
		throw $this->refuse();
	}

	/**
	 * Refuses.
	 *
	 * @throws TranscriberError Always.
	 */
	public function billing(): array {
		throw $this->refuse();
	}

	/**
	 * Refuses.
	 *
	 * @param Source               $source          Unused.
	 * @param string               $name            Unused.
	 * @param string               $idempotency_key Unused.
	 * @param array<string, mixed> $settings        Unused.
	 * @throws TranscriberError Always.
	 */
	public function start( Source $source, string $name, string $idempotency_key, array $settings = array() ): array {
		throw $this->refuse();
	}

	/**
	 * Refuses.
	 *
	 * @param string $recording_id Unused.
	 * @throws TranscriberError Always.
	 */
	public function job( string $recording_id ): array {
		throw $this->refuse();
	}

	/**
	 * Refuses.
	 *
	 * @param string $recording_id Unused.
	 * @throws TranscriberError Always.
	 */
	public function stop( string $recording_id ): void {
		throw $this->refuse();
	}

	/**
	 * Refuses.
	 *
	 * @param string $recording_id Unused.
	 * @throws TranscriberError Always.
	 */
	public function transcript( string $recording_id ): array {
		throw $this->refuse();
	}
}
