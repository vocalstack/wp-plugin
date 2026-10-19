<?php
/**
 * A failed VocalStack call.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Transcriber;

defined( 'ABSPATH' ) || exit;

/**
 * Carries VocalStack's HTTP status (0 when it was not reached) and error code.
 */
class TranscriberError extends \RuntimeException {

	/**
	 * Build the error.
	 *
	 * @param string $message     What went wrong, for the editor.
	 * @param string $error_code  VocalStack's code, such as `unauthorized`.
	 * @param int    $http_status The HTTP status, or 0.
	 */
	public function __construct(
		string $message,
		public readonly string $error_code = 'http_error',
		public readonly int $http_status = 0,
	) {
		parent::__construct( $message );
	}
}
