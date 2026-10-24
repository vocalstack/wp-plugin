<?php
/**
 * Wires the plugin's parts into WordPress.
 *
 * @package VocalStack
 */

namespace VocalStack\WP;

defined( 'ABSPATH' ) || exit;

/**
 * Entry point, called on `plugins_loaded`.
 */
final class Plugin {

	/**
	 * The client in use, built on first need.
	 *
	 * @var Transcriber\Transcriber|null
	 */
	private static $client = null;

	/**
	 * Register every hook.
	 */
	public static function boot(): void {
		Media::register();
		Jobs::register();
		Lock::register();
		Rest\Routes::register();
		Rest\Proxy::register();
		Rest\AdminRoutes::register();
		Widgets\RecordRoutes::register();
		Widgets\UploadRoutes::register();
		Widgets\PlayerRoutes::register();
		Admin\SettingsPage::register();
		Admin\MediaPanel::register();
		Admin\EditorPanel::register();
		Admin\WidgetPreview::register();
		Languages::register();
		Front\Transcript::register();
		Front\Captions::register();
		Front\Widgets::register();
		add_action( 'admin_init', array( Widgets\Policy::class, 'install' ) );
		add_action( 'vocalstack_prune_usage', array( Widgets\Policy::class, 'prune' ) );
		if ( ! wp_next_scheduled( 'vocalstack_prune_usage' ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', 'vocalstack_prune_usage' );
		}
	}

	/**
	 * The client that talks to VocalStack.
	 */
	public static function transcriber(): Transcriber\Transcriber {
		if ( null === self::$client ) {
			/**
			 * Filters the client the plugin uses to reach VocalStack. Tests and
			 * other plugins can return their own Transcriber.
			 *
			 * @param Transcriber\Transcriber|null $client Null for the default.
			 */
			$client = apply_filters( 'vocalstack_transcriber', null );
			if ( ! $client instanceof Transcriber\Transcriber ) {
				$client = class_exists( \VocalStack\VocalStack::class )
					? new Transcriber\SdkTranscriber( Settings::api_key(), Settings::api_url(), self::http_client() )
					: new Transcriber\Unavailable();
			}
			self::$client = $client;
		}
		return self::$client;
	}

	/**
	 * Forget the clients, so the next call rebuilds them (after the key changes).
	 */
	public static function reset_transcriber(): void {
		self::$client = null;
		self::$sdk    = null;
	}

	/**
	 * The SDK client, built on first need.
	 *
	 * @var \VocalStack\VocalStack|null
	 */
	private static $sdk = null;

	/**
	 * The VocalStack SDK on WordPress's HTTP API, for the widgets' calls; null
	 * without a key.
	 */
	public static function sdk(): ?\VocalStack\VocalStack {
		if ( '' === Settings::api_key() ) {
			return null;
		}
		if ( null === self::$sdk ) {
			self::$sdk = new \VocalStack\VocalStack(
				apiKey: Settings::api_key(),
				baseUrl: Settings::api_url(),
				maxRetries: 1,
				httpClient: self::http_client(),
			);
		}
		return self::$sdk;
	}

	/**
	 * The HTTP client every SDK call goes through: WordPress's HTTP API.
	 */
	public static function http_client(): \VocalStack\Http\HttpClient {
		/**
		 * Filters the HTTP client the SDK sends through; tests return a fake.
		 *
		 * @param \VocalStack\Http\HttpClient $http WordPress's HTTP API.
		 */
		$http = apply_filters( 'vocalstack_http_client', new Transcriber\WpHttpClient() );
		return $http instanceof \VocalStack\Http\HttpClient ? $http : new Transcriber\WpHttpClient();
	}
}
