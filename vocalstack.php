<?php
/**
 * Plugin Name:       VocalStack
 * Description:       Transcribe the audio and video in your Media Library with VocalStack, and show the transcripts and captions on your site.
 * Version:           0.1.0
 * Requires at least: 6.6
 * Requires PHP:      8.1
 * Author:            VocalStack
 * Author URI:        https://vocalstack.com
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       vocalstack
 *
 * @package VocalStack
 */

defined( 'ABSPATH' ) || exit;

define( 'VOCALSTACK_VERSION', '0.1.0' );
define( 'VOCALSTACK_FILE', __FILE__ );
define( 'VOCALSTACK_DIR', plugin_dir_path( __FILE__ ) );
define( 'VOCALSTACK_URL', plugin_dir_url( __FILE__ ) );

// A release bundles the SDK under its own namespace (vendor-prefixed, made by
// Strauss), so it can't clash with another plugin that ships it too.
if ( is_readable( VOCALSTACK_DIR . 'vendor-prefixed/autoload.php' ) ) {
	require_once VOCALSTACK_DIR . 'vendor-prefixed/autoload.php';
}
require_once VOCALSTACK_DIR . 'vendor/autoload.php';

add_action( 'plugins_loaded', array( \VocalStack\WP\Plugin::class, 'boot' ) );
register_activation_hook( __FILE__, array( \VocalStack\WP\Widgets\Policy::class, 'install' ) );
