<?php
/**
 * Enqueue the built scripts.
 *
 * @package VocalStack
 */

namespace VocalStack\WP;

defined( 'ABSPATH' ) || exit;

/**
 * Loads `build/admin/{name}.js` with the dependencies wp-scripts recorded.
 */
final class Assets {

	/**
	 * Enqueue one entry point and its stylesheet, if it has one.
	 *
	 * @param string               $name Entry point: `settings`, `media-panel`, `editor` or `player`.
	 * @param array<string, mixed> $data Passed to the script as `window.vocalstack`.
	 */
	public static function enqueue( string $name, array $data = array() ): void {
		$handle = 'vocalstack-' . $name;
		if ( wp_script_is( $handle, 'enqueued' ) ) {
			return;
		}
		$asset_file = VOCALSTACK_DIR . "build/admin/{$name}.asset.php";
		if ( ! is_readable( $asset_file ) ) {
			return; // Not built: run `npm run build`.
		}
		$asset = require $asset_file;
		wp_enqueue_script( $handle, VOCALSTACK_URL . "build/admin/{$name}.js", $asset['dependencies'], $asset['version'], true );
		wp_set_script_translations( $handle, 'vocalstack' );
		if ( $data ) {
			wp_add_inline_script( $handle, 'window.vocalstack = ' . wp_json_encode( $data ) . ';', 'before' );
		}
		if ( is_readable( VOCALSTACK_DIR . "build/admin/{$name}.css" ) ) {
			$deps = in_array( 'wp-components', $asset['dependencies'], true ) ? array( 'wp-components' ) : array();
			wp_enqueue_style( $handle, VOCALSTACK_URL . "build/admin/{$name}.css", $deps, $asset['version'] );
		}
	}
}
