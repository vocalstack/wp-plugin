<?php
/**
 * The VocalStack admin menu and its settings page.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Admin;

use VocalStack\WP\Assets;
use VocalStack\WP\Rest\Proxy;
use VocalStack\WP\Settings;
use VocalStack\WP\Widgets\Widgets;

defined( 'ABSPATH' ) || exit;

/**
 * A top-level VocalStack menu, after the core menus. The page is a React app
 * (assets/src/settings) over the `settings` REST routes.
 */
final class SettingsPage {

	const SLUG = 'vocalstack';

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( 'admin_menu', array( self::class, 'menu' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( VOCALSTACK_FILE ), array( self::class, 'action_links' ) );
	}

	/**
	 * Add the menu.
	 */
	public static function menu(): void {
		$hook = add_menu_page( __( 'VocalStack', 'vocalstack' ), __( 'VocalStack', 'vocalstack' ), Proxy::CAPABILITY, self::SLUG, array( self::class, 'render' ), self::icon() );
		add_action( "load-{$hook}", fn() => add_action( 'admin_enqueue_scripts', array( self::class, 'enqueue' ) ) );
	}

	/**
	 * The admin app and what it needs to know.
	 */
	public static function enqueue(): void {
		wp_enqueue_media();
		Assets::enqueue(
			'settings',
			array(
				'apiUrl'        => Settings::api_url(),
				'dashboardUrl'  => Settings::dashboard_url(),
				'adminPostUrl'  => admin_url( 'admin-post.php' ),
				'exportNonce'   => wp_create_nonce( 'vocalstack_export' ),
				'schema'        => Widgets::schema(),
				'maxUploadSize' => (int) wp_max_upload_size(),
				'previewUrl'    => WidgetPreview::url(),
			)
		);
	}

	/**
	 * The VocalStack mark as a data URI. WordPress repaints SVG menu icons in
	 * the admin colour scheme, so it matches the other menu icons.
	 */
	private static function icon(): string {
		$svg = file_get_contents( VOCALSTACK_DIR . 'assets/images/mark-white.svg' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- A local file.
		return $svg ? 'data:image/svg+xml;base64,' . base64_encode( $svg ) : 'dashicons-microphone'; // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- The data URI WordPress expects for menu icons.
	}

	/**
	 * The React root.
	 */
	public static function render(): void {
		printf(
			'<div class="wrap vocalstack-page"><div class="vocalstack-page__header"><a class="vocalstack-page__home" href="#/dashboard" title="%4$s"><img class="vocalstack-page__logo" src="%1$s" alt="%2$s" width="220" height="32"></a></div><h1 class="screen-reader-text">%3$s</h1><hr class="wp-header-end"><div id="vocalstack-settings"></div></div>',
			esc_url( VOCALSTACK_URL . 'assets/images/logo-light.svg' ),
			esc_attr__( 'VocalStack', 'vocalstack' ),
			esc_html__( 'VocalStack', 'vocalstack' ),
			esc_attr__( 'VocalStack dashboard', 'vocalstack' )
		);
	}

	/**
	 * A Settings link on the Plugins screen.
	 *
	 * @param array<string> $links Existing links.
	 * @return array<string>
	 */
	public static function action_links( array $links ): array {
		array_unshift( $links, '<a href="' . esc_url( self::url() ) . '">' . esc_html__( 'Settings', 'vocalstack' ) . '</a>' );
		return $links;
	}

	/**
	 * The settings page URL.
	 */
	public static function url(): string {
		return admin_url( 'admin.php?page=' . self::SLUG );
	}
}
