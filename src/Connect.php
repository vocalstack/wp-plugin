<?php
/**
 * One-click Connect: the site gets its own key without anyone pasting one.
 *
 * @package VocalStack
 */

namespace VocalStack\WP;

use VocalStack\Connect\Pkce;
use VocalStack\Http\ConnectionException;
use VocalStack\VocalStack;
use VocalStack\VocalStackException;
use VocalStack\WP\Admin\SettingsPage;
use VocalStack\WP\Rest\Routes;

defined( 'ABSPATH' ) || exit;

/**
 * OAuth 2.0 authorization code with PKCE, where the token is an API key:
 *
 * 1. `POST /wp-json/vocalstack/v1/connect` (administrators): a random state
 *    and a PKCE verifier are kept for ten minutes for that administrator, and
 *    the answer is the address of VocalStack's consent screen.
 * 2. The person signs in there, picks a workspace and clicks Authenticate;
 *    VocalStack sends the browser to `admin-post.php?action=vocalstack_connect`
 *    with `code` and `state` (or `error=access_denied` on Cancel).
 * 3. The callback checks the state, redeems the code with the verifier at
 *    `POST /v1/connect/token`, server to server, and stores the key it answers
 *    where a pasted key is stored. The key never passes through a browser.
 *
 * Connecting again (Change, next to the workspace) is the same flow: the key
 * in use is replaced only once the new one has been issued.
 */
final class Connect {

	const ACTION = 'vocalstack_connect';

	/** Seconds a started connection waits for the person to come back. */
	const TTL = 10 * MINUTE_IN_SECONDS;

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( 'rest_api_init', array( self::class, 'routes' ) );
		add_action( 'admin_post_' . self::ACTION, array( self::class, 'callback' ) );
		add_action( 'admin_post_nopriv_' . self::ACTION, array( self::class, 'signed_out' ) );
	}

	/**
	 * Register the route that starts a connection.
	 */
	public static function routes(): void {
		register_rest_route(
			Routes::NS,
			'/connect',
			array(
				'methods'             => 'POST',
				'callback'            => array( self::class, 'start' ),
				'permission_callback' => array( Routes::class, 'can_manage' ),
			)
		);
	}

	/**
	 * Where VocalStack sends the browser back to.
	 */
	public static function callback_url(): string {
		return admin_url( 'admin-post.php?action=' . self::ACTION );
	}

	/**
	 * Whether this site can use Connect: VocalStack only sends a code to an
	 * https address, or to http on localhost or 127.0.0.1.
	 */
	public static function available(): bool {
		$parts  = wp_parse_url( self::callback_url() );
		$scheme = strtolower( (string) ( $parts['scheme'] ?? '' ) );
		$host   = strtolower( (string) ( $parts['host'] ?? '' ) );
		return 'https' === $scheme || ( 'http' === $scheme && in_array( $host, array( 'localhost', '127.0.0.1' ), true ) );
	}

	/**
	 * Start a connection: keep a state and a verifier for this administrator
	 * and answer the consent screen's address.
	 *
	 * @return array{url: string}|\WP_Error
	 */
	public static function start() {
		if ( 'constant' === Settings::key_source() ) {
			return new \WP_Error( 'vocalstack_key_in_config', __( 'The key is set by VOCALSTACK_API_KEY in wp-config.php.', 'vocalstack' ), array( 'status' => 409 ) );
		}
		if ( ! self::available() ) {
			return new \WP_Error( 'vocalstack_connect_needs_https', __( 'One-click Connect needs a site served over https. Paste an API key instead.', 'vocalstack' ), array( 'status' => 400 ) );
		}
		$state    = Pkce::state();
		$verifier = Pkce::verifier();
		$redirect = self::callback_url();
		set_transient(
			self::pending_key(),
			array(
				'state'    => $state,
				'verifier' => $verifier,
				'redirect' => $redirect,
			),
			self::TTL
		);
		$query = array(
			'response_type'         => 'code',
			'client_name'           => self::client_name(),
			'redirect_uri'          => $redirect,
			'state'                 => $state,
			'code_challenge'        => Pkce::challenge( $verifier ),
			'code_challenge_method' => Pkce::METHOD,
			'scope'                 => 'read write',
			// The Transcriptions and Broadcasts tabs show everything in the workspace.
			'reach'                 => 'account',
		);
		return array( 'url' => Settings::dashboard_url() . '/connect?' . http_build_query( $query, '', '&', PHP_QUERY_RFC3986 ) );
	}

	/**
	 * Finish a connection with what VocalStack sent back.
	 *
	 * @param array<string, string> $query `state` with `code`, or with `error` and `error_description`.
	 * @return array{status: string, text: string} What to tell the administrator.
	 */
	public static function finish( array $query ): array {
		if ( ! current_user_can( 'manage_options' ) ) {
			return self::outcome( 'error', __( 'You are not allowed to change the VocalStack connection.', 'vocalstack' ) );
		}
		if ( 'constant' === Settings::key_source() ) {
			return self::outcome( 'error', __( 'The key is set by VOCALSTACK_API_KEY in wp-config.php.', 'vocalstack' ) );
		}
		$pending = get_transient( self::pending_key() );
		$state   = (string) ( $query['state'] ?? '' );
		if ( ! is_array( $pending ) || '' === $state || ! is_string( $pending['state'] ?? null ) || ! hash_equals( $pending['state'], $state ) ) {
			return self::outcome( 'error', __( 'This Connect link has expired. Start again from here.', 'vocalstack' ) );
		}
		// A state works once.
		delete_transient( self::pending_key() );

		$error = (string) ( $query['error'] ?? '' );
		if ( 'access_denied' === $error ) {
			return self::outcome( 'info', __( 'Connecting was cancelled. Nothing has changed.', 'vocalstack' ) );
		}
		if ( '' !== $error ) {
			$why = (string) ( $query['error_description'] ?? '' );
			/* translators: %s: what VocalStack said. */
			return self::outcome( 'error', sprintf( __( 'VocalStack did not connect this site: %s', 'vocalstack' ), '' !== $why ? $why : $error ) );
		}
		$code = (string) ( $query['code'] ?? '' );
		if ( '' === $code ) {
			return self::outcome( 'error', __( 'VocalStack sent no code back. Start again from here.', 'vocalstack' ) );
		}

		try {
			$client = new VocalStack( apiKey: null, baseUrl: Settings::api_url(), maxRetries: 0, httpClient: Plugin::http_client() );
			$token  = $client->connect->token( $code, (string) $pending['verifier'], (string) $pending['redirect'] );
		} catch ( VocalStackException $e ) {
			/* translators: %s: what VocalStack said. */
			return self::outcome( 'error', sprintf( __( 'VocalStack did not issue a key: %s', 'vocalstack' ), $e->getMessage() ) );
		} catch ( ConnectionException $e ) {
			/* translators: %s: the network error. */
			return self::outcome( 'error', sprintf( __( 'Could not reach VocalStack: %s', 'vocalstack' ), $e->getMessage() ) );
		}
		$key = is_array( $token ) && is_string( $token['access_token'] ?? null ) ? $token['access_token'] : '';
		if ( ! str_starts_with( $key, 'vs_key_' ) ) {
			return self::outcome( 'error', __( 'VocalStack did not issue a key. Start again from here.', 'vocalstack' ) );
		}

		// Only now does the key in use give way to the new one.
		Settings::set_api_key( $key );
		$name = $token['account']['name'] ?? '';
		update_option( 'vocalstack_account', sanitize_text_field( is_string( $name ) ? $name : '' ), false );
		Workspace::remember( $token );

		$workspace = Workspace::current();
		if ( $workspace && '' !== $workspace['name'] ) {
			/* translators: %s: the workspace's name. */
			return self::outcome( 'success', sprintf( __( 'Connected to the workspace %s.', 'vocalstack' ), $workspace['name'] ) );
		}
		return self::outcome( 'success', __( 'Connected.', 'vocalstack' ) );
	}

	/**
	 * The address VocalStack redirects to: finish, then back to Settings with
	 * the outcome.
	 */
	public static function callback(): void {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You are not allowed to change the VocalStack connection.', 'vocalstack' ), 403 );
		}
		$query = array();
		foreach ( array( 'state', 'code', 'error', 'error_description' ) as $name ) {
			// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- VocalStack's redirect carries no WordPress nonce; finish() checks its `state` against the one kept for this administrator.
			if ( isset( $_GET[ $name ] ) && is_string( $_GET[ $name ] ) ) {
				// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- As above.
				$query[ $name ] = sanitize_text_field( wp_unslash( $_GET[ $name ] ) );
			}
		}
		set_transient( self::notice_key(), self::finish( $query ), 5 * MINUTE_IN_SECONDS );
		wp_safe_redirect( SettingsPage::url() . '#/settings/account' );
		exit;
	}

	/**
	 * The callback without a WordPress session: sign in first, then land on it again.
	 */
	public static function signed_out(): void {
		auth_redirect();
		exit;
	}

	/**
	 * The outcome of the connection this administrator just came back from,
	 * once: `{ status: success|info|error, text }`, or null.
	 *
	 * @return array{status: string, text: string}|null
	 */
	public static function take_notice(): ?array {
		$notice = get_transient( self::notice_key() );
		if ( ! is_array( $notice ) || ! is_string( $notice['status'] ?? null ) || ! is_string( $notice['text'] ?? null ) ) {
			return null;
		}
		delete_transient( self::notice_key() );
		return array(
			'status' => in_array( $notice['status'], array( 'success', 'info', 'error' ), true ) ? $notice['status'] : 'info',
			'text'   => $notice['text'],
		);
	}

	/**
	 * The name on the consent screen and of the key: "Site name (WordPress)".
	 */
	private static function client_name(): string {
		$site = trim( wp_specialchars_decode( (string) get_bloginfo( 'name' ), ENT_QUOTES ) );
		if ( '' === $site ) {
			$site = (string) wp_parse_url( home_url(), PHP_URL_HOST );
		}
		// VocalStack takes at most 100 characters.
		return trim( mb_substr( $site, 0, 88 ) ) . ' (WordPress)';
	}

	/**
	 * An outcome.
	 *
	 * @param string $status `success`, `info` or `error`.
	 * @param string $text   The sentence shown.
	 * @return array{status: string, text: string}
	 */
	private static function outcome( string $status, string $text ): array {
		return array(
			'status' => $status,
			'text'   => $text,
		);
	}

	/**
	 * The transient holding this administrator's started connection.
	 */
	private static function pending_key(): string {
		return 'vocalstack_connect_' . get_current_user_id();
	}

	/**
	 * The transient holding this administrator's outcome.
	 */
	private static function notice_key(): string {
		return 'vocalstack_connected_' . get_current_user_id();
	}
}
