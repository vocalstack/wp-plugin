<?php
/**
 * Widget templates a theme can override.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Widgets;

defined( 'ABSPATH' ) || exit;

/**
 * A widget's HTML comes from `templates/<name>.php`. A theme overrides it by
 * copying the file to `vocalstack/<name>.php` in the child or parent theme.
 */
final class Templates {

	/**
	 * The file that renders a template: the theme's copy, else the plugin's.
	 *
	 * @param string $name Template name, such as `player`.
	 */
	public static function locate( string $name ): string {
		$name  = sanitize_file_name( $name );
		$theme = locate_template( array( "vocalstack/{$name}.php" ) );
		$file  = '' !== $theme ? $theme : VOCALSTACK_DIR . "templates/{$name}.php";
		/**
		 * Filters the file a widget template renders from.
		 *
		 * @param string $file The theme's override, or the plugin's template.
		 * @param string $name Template name.
		 */
		return (string) apply_filters( 'vocalstack_template', $file, $name );
	}

	/**
	 * Render a template to a string.
	 *
	 * @param string               $name Template name.
	 * @param array<string, mixed> $args Variables for the template, available as `$args`.
	 */
	public static function render( string $name, array $args ): string {
		$file = self::locate( $name );
		if ( ! is_readable( $file ) ) {
			return '';
		}
		ob_start();
		( static function ( string $vocalstack_file, array $args ): void { // phpcs:ignore Generic.CodeAnalysis.UnusedFunctionParameter.FoundAfterLastUsed -- $args is the template's.
			include $vocalstack_file;
		} )( $file, $args );
		return (string) ob_get_clean();
	}
}
