<?php
/**
 * Where a transcription's audio comes from.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Transcriber;

defined( 'ABSPATH' ) || exit;

/**
 * Either a public URL VocalStack fetches, or a local file the plugin uploads.
 */
final class Source {

	/**
	 * Build a source; use url() or file().
	 *
	 * @param string $url       A public address, or ''.
	 * @param string $path      A local file, or ''.
	 * @param string $file_name The name to upload the file as.
	 * @param string $mime_type The file's type.
	 */
	private function __construct(
		public readonly string $url,
		public readonly string $path,
		public readonly string $file_name,
		public readonly string $mime_type,
	) {}

	/**
	 * VocalStack fetches the audio from this address.
	 *
	 * @param string $url A public http(s) address.
	 */
	public static function url( string $url ): self {
		return new self( $url, '', '', '' );
	}

	/**
	 * The plugin uploads this file.
	 *
	 * @param string $path      Absolute path on disk.
	 * @param string $mime_type The file's type.
	 */
	public static function file( string $path, string $mime_type ): self {
		return new self( '', $path, wp_basename( $path ), $mime_type );
	}

	/**
	 * Whether the plugin uploads the bytes.
	 */
	public function is_file(): bool {
		return '' !== $this->path;
	}
}
