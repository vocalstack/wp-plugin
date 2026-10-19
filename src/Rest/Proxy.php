<?php
/**
 * The admin screens' way to the VocalStack API.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Rest;

use VocalStack\Http\ConnectionException;
use VocalStack\WP\Settings;
use VocalStack\WP\Transcriber\WpHttpClient;

defined( 'ABSPATH' ) || exit;

/**
 * `/wp-json/vocalstack/v1/api/<path>` forwards to `<api>/v1/<path>` with the
 * site's key, for users with `vocalstack_manage`. Only the method and path
 * pairs in ALLOW pass; everything else is refused before VocalStack is asked.
 * VocalStack's status and error envelope come back unchanged, so the admin
 * shows VocalStack's own messages.
 */
final class Proxy {

	const CAPABILITY = 'vocalstack_manage';

	const ID = '[A-Za-z0-9_-]+';

	/**
	 * Allowed requests: method => path patterns (after /v1/, `{id}` is one id segment).
	 *
	 * Not here on purpose: connect/*, billing writes (checkouts, subscriptions,
	 * payment methods), API keys, and anything that hands out account credentials.
	 */
	const ALLOW = array(
		'GET'    => array(
			'me',
			'billing',
			'languages',
			'realtime/capabilities',
			// The account's RTMP ingest, for the Live tab's streaming-software source.
			'rtmp',
			'transcriptions',
			'transcriptions/probe',
			'transcriptions/{id}',
			'transcriptions/{id}/recordings',
			'transcriptions/{id}/share-links',
			'broadcasts',
			'broadcasts/{id}',
			'broadcasts/{id}/recordings',
			'broadcasts/{id}/share-links',
			'broadcasts/{id}/audio-sources/{id}/check',
			'recordings/{id}',
			'recordings/{id}/transcript',
			'recordings/{id}/translation',
			'recordings/{id}/summary',
			'recordings/{id}/job',
			'recordings/{id}/events',
			'recordings/{id}/corrections',
			'recordings/{id}/voice',
			'recordings/{id}/export',
			'recordings/{id}/media-token',
		),
		'POST'   => array(
			'transcriptions',
			'transcriptions/live',
			'transcriptions/{id}/archive',
			'transcriptions/{id}/restore',
			'transcriptions/{id}/purge',
			'transcriptions/{id}/recordings',
			'transcriptions/{id}/share-links',
			'broadcasts',
			'broadcasts/{id}/archive',
			'broadcasts/{id}/restore',
			'broadcasts/{id}/purge',
			'broadcasts/{id}/recordings',
			'broadcasts/{id}/audio-sources',
			'broadcasts/{id}/share-links',
			'recordings/{id}/stop',
			'recordings/{id}/pause',
			'recordings/{id}/resume',
			'recordings/{id}/archive',
			'recordings/{id}/restore',
			'recordings/{id}/purge',
			'recordings/{id}/summarize',
			'recordings/{id}/job/retry',
			'recordings/{id}/job/start',
			'recordings/{id}/corrections',
			'recordings/{id}/retranscribe',
			'recordings/{id}/publish-token',
			'recordings/{id}/voice',
		),
		'PATCH'  => array(
			'transcriptions/{id}',
			'broadcasts/{id}',
			'recordings/{id}/settings',
			'share-links/{id}',
		),
		'PUT'    => array(
			'transcriptions/{id}/broadcasts/{id}',
			'recordings/{id}/speakers/{id}',
		),
		'DELETE' => array(
			'transcriptions/{id}/broadcasts/{id}',
			'broadcasts/{id}/audio-sources/{id}',
			'share-links/{id}',
		),
	);

	/** Request headers passed through to VocalStack. */
	const PASS_HEADERS = array( 'idempotency-key' );

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( 'rest_api_init', array( self::class, 'route' ) );
		add_filter( 'user_has_cap', array( self::class, 'grant_to_administrators' ) );
	}

	/**
	 * Whoever can manage options can manage VocalStack, unless a role editor
	 * set the capability explicitly.
	 *
	 * @param array<string, bool> $allcaps The user's capabilities.
	 * @return array<string, bool>
	 */
	public static function grant_to_administrators( array $allcaps ): array {
		if ( ! isset( $allcaps[ self::CAPABILITY ] ) && ! empty( $allcaps['manage_options'] ) ) {
			$allcaps[ self::CAPABILITY ] = true;
		}
		return $allcaps;
	}

	/**
	 * Register the route.
	 */
	public static function route(): void {
		register_rest_route(
			Routes::NS,
			'/api/(?P<path>[A-Za-z0-9_/-]+)',
			array(
				'methods'             => array( 'GET', 'POST', 'PATCH', 'PUT', 'DELETE' ),
				'callback'            => array( self::class, 'forward' ),
				'permission_callback' => fn() => current_user_can( self::CAPABILITY ),
			)
		);
	}

	/**
	 * Whether a method and path may pass.
	 *
	 * @param string $method HTTP method.
	 * @param string $path   Path after /v1/, without a query.
	 */
	public static function allowed( string $method, string $path ): bool {
		foreach ( self::ALLOW[ $method ] ?? array() as $pattern ) {
			$regex = '#^' . str_replace( array( '/', '\{id\}' ), array( '\/', self::ID ), preg_quote( $pattern, '#' ) ) . '$#';
			if ( preg_match( $regex, $path ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Forward one request.
	 *
	 * @param \WP_REST_Request $request The request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function forward( \WP_REST_Request $request ) {
		$method = $request->get_method();
		$path   = trim( (string) $request['path'], '/' );
		if ( ! self::allowed( $method, $path ) ) {
			return new \WP_Error( 'vocalstack_not_allowed', __( 'This VocalStack request is not available from WordPress.', 'vocalstack' ), array( 'status' => 403 ) );
		}
		$key = Settings::api_key();
		if ( '' === $key ) {
			return new \WP_Error( 'vocalstack_not_connected', __( 'Connect a VocalStack account first.', 'vocalstack' ), array( 'status' => 409 ) );
		}

		$query = $request->get_query_params();
		unset( $query['rest_route'], $query['_wpnonce'], $query['_locale'], $query['_envelope'], $query['_fields'] );
		$url = Settings::api_url() . '/v1/' . $path . ( $query ? '?' . http_build_query( $query ) : '' );

		$headers = array(
			'authorization' => 'Bearer ' . $key,
			'accept'        => 'application/json',
		);
		foreach ( self::PASS_HEADERS as $name ) {
			$value = $request->get_header( $name );
			if ( null !== $value && '' !== $value ) {
				$headers[ $name ] = $value;
			}
		}
		$body = null;
		if ( 'GET' !== $method ) {
			$body                    = $request->get_body();
			$body                    = '' === $body ? null : $body;
			$headers['content-type'] = 'application/json';
		}

		try {
			$response = ( new WpHttpClient() )->send( $method, $url, $headers, $body );
		} catch ( ConnectionException $e ) {
			/* translators: %s: the network error. */
			return new \WP_Error( 'vocalstack_unreachable', sprintf( __( 'Could not reach VocalStack: %s', 'vocalstack' ), $e->getMessage() ), array( 'status' => 502 ) );
		}

		$type = (string) $response->header( 'content-type' );
		$data = str_contains( $type, 'json' ) ? json_decode( $response->body, true ) : array(
			'contentType' => $type,
			'body'        => $response->body,
		);
		// 401 from VocalStack is the site's key, not the admin's session: don't let the browser read it as a logout.
		$status = 401 === $response->status ? 424 : $response->status;
		$out    = new \WP_REST_Response( $data, $status );
		foreach ( array( 'x-request-id', 'retry-after' ) as $name ) {
			if ( null !== $response->header( $name ) ) {
				$out->header( $name, (string) $response->header( $name ) );
			}
		}
		return $out;
	}
}
