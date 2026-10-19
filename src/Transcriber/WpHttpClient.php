<?php
/**
 * The SDK's HTTP client, on WordPress's HTTP API.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Transcriber;

use VocalStack\Http\ConnectionException;
use VocalStack\Http\CurlHttpClient;
use VocalStack\Http\HttpClient;
use VocalStack\Http\HttpResponse;
use VocalStack\Http\MultipartBody;

defined( 'ABSPATH' ) || exit;

/**
 * Requests go through wp_remote_request(), so they follow the site's proxy and
 * SSL settings and the `pre_http_request` filter. WordPress cannot stream a
 * request body, so file uploads go through the SDK's streaming cURL client
 * instead; without cURL, a file up to MAX_BUFFERED bytes is sent from memory.
 */
final class WpHttpClient implements HttpClient {

	/** The largest upload sent from memory when cURL is missing. */
	const MAX_BUFFERED = 64 * MB_IN_BYTES;

	/**
	 * Build the client.
	 *
	 * @param float $timeout        Seconds for an API call.
	 * @param float $upload_timeout Seconds for a file upload.
	 */
	public function __construct(
		private readonly float $timeout = 30.0,
		private readonly float $upload_timeout = 900.0,
	) {}

	/**
	 * Send one request; 4xx and 5xx are answers, not errors.
	 *
	 * @param string                    $method  HTTP method.
	 * @param string                    $url     Absolute URL.
	 * @param array<string, string>     $headers Lowercased names.
	 * @param string|MultipartBody|null $body    The body.
	 * @throws ConnectionException When no answer came.
	 */
	public function send( string $method, string $url, array $headers, string|MultipartBody|null $body ): HttpResponse {
		$timeout = $this->timeout;
		if ( $body instanceof MultipartBody ) {
			if ( function_exists( 'curl_init' ) ) {
				return ( new CurlHttpClient( $this->upload_timeout ) )->send( $method, $url, $headers, $body );
			}
			$length = $body->length();
			if ( null === $length || $length > self::MAX_BUFFERED ) {
				throw new ConnectionException( __( 'This file is too large to upload without the PHP cURL extension.', 'vocalstack' ) ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- Shown as text.
			}
			$body    = $body->contents();
			$timeout = $this->upload_timeout;
		}

		$response = wp_remote_request(
			$url,
			array(
				'method'      => $method,
				'headers'     => $headers,
				'body'        => $body,
				'timeout'     => $timeout,
				'redirection' => 0,
				'user-agent'  => 'VocalStack-WordPress/' . VOCALSTACK_VERSION . '; ' . home_url(),
			)
		);
		if ( is_wp_error( $response ) ) {
			throw new ConnectionException( $response->get_error_message() ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- Shown as text.
		}
		$response_headers = wp_remote_retrieve_headers( $response );
		return new HttpResponse(
			(int) wp_remote_retrieve_response_code( $response ),
			is_object( $response_headers ) && method_exists( $response_headers, 'getAll' ) ? $response_headers->getAll() : (array) $response_headers,
			(string) wp_remote_retrieve_body( $response )
		);
	}
}
