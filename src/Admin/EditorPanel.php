<?php
/**
 * A VocalStack panel on the core Audio and Video blocks.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Admin;

use VocalStack\WP\Assets;

defined( 'ABSPATH' ) || exit;

/**
 * Loads assets/src/editor, which adds the Transcribe panel to the block
 * inspector of Audio and Video blocks that hold a Media Library file.
 */
final class EditorPanel {

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( 'enqueue_block_editor_assets', fn() => Assets::enqueue( 'editor', MediaPanel::script_data() ) );
	}
}
