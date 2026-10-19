<?php
/**
 * A working preview of one widget, for the admin's widget generator.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Admin;

use VocalStack\WP\Front\Transcript;
use VocalStack\WP\Front\Widgets as FrontWidgets;
use VocalStack\WP\Rest\Proxy;

defined( 'ABSPATH' ) || exit;

/**
 * `/?vocalstack_preview=1&type=<type>&atts=<json>&_wpnonce=` renders one widget
 * on an otherwise empty front-end page: the theme's styles, the widget's own
 * scripts, nothing else. The generator shows it in a frame, so the preview is
 * the real widget: it plays, and Record and Upload really record and upload.
 *
 * Only for users who can manage VocalStack, with a nonce.
 */
final class WidgetPreview {

	const ACTION = 'vocalstack_preview';

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( 'template_redirect', array( self::class, 'maybe_render' ), 0 );
	}

	/**
	 * The preview page's address, without the widget's type and options.
	 */
	public static function url(): string {
		return add_query_arg(
			array(
				self::ACTION => 1,
				'_wpnonce'   => wp_create_nonce( self::ACTION ),
			),
			home_url( '/' )
		);
	}

	/**
	 * Render the preview page when asked for, and stop.
	 */
	public static function maybe_render(): void {
		if ( empty( $_GET[ self::ACTION ] ) ) {
			return;
		}
		if ( ! current_user_can( Proxy::CAPABILITY ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_GET['_wpnonce'] ?? '' ) ), self::ACTION ) ) {
			wp_die( esc_html__( 'This preview has expired. Reload the Widgets page.', 'vocalstack' ), 403 );
		}
		$type = sanitize_key( wp_unslash( $_GET['type'] ?? '' ) );
		$atts = json_decode( wp_unslash( $_GET['atts'] ?? '{}' ), true ); // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- Decoded, then every value is coerced by the widget's option schema.
		$atts = is_array( $atts ) ? array_map( fn( $v ) => is_scalar( $v ) ? (string) $v : '', $atts ) : array();

		// Render first: the widget enqueues its scripts and styles as it renders.
		if ( 'transcript' === $type ) {
			$html = Transcript::shortcode( $atts );
		} elseif ( in_array( $type, FrontWidgets::TYPES, true ) ) {
			$html = FrontWidgets::shortcode( $type, $atts );
		} else {
			$html = '';
		}

		add_filter( 'show_admin_bar', '__return_false' );
		nocache_headers();
		header( 'X-Frame-Options: SAMEORIGIN' );
		?>
<!doctype html>
<html <?php language_attributes(); ?>>
<head>
<meta charset="<?php bloginfo( 'charset' ); ?>">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
		<?php wp_head(); ?>
<style>html,body{margin:0!important;padding:0;background:transparent}body{padding:4px}</style>
</head>
<body <?php body_class( 'vocalstack-widget-preview' ); ?>>
		<?php
		echo '' !== $html ? $html : '<p>' . esc_html__( 'Nothing to show with these options yet.', 'vocalstack' ) . '</p>'; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- The widget's own escaped template.
		wp_footer();
		?>
</body>
</html>
		<?php
		exit;
	}
}
