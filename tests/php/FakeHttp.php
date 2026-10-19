<?php
/**
 * An HTTP client for the real SDK that answers from a table.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Tests;

use VocalStack\Http\HttpClient;
use VocalStack\Http\HttpResponse;
use VocalStack\Http\MultipartBody;

/**
 * `$http->on( 'POST', '/v1/transcriptions/live', 201, [...] )`; unmatched
 * requests answer 404. Every request is kept in `$sent`.
 */
final class FakeHttp implements HttpClient {

	/** @var array<string, list<array{0: int, 1: mixed, 2: array<string, string>}>> Answers by "METHOD /path", used in order (the last repeats). */
	private array $routes = array();

	/** @var list<array{method: string, path: string, query: string, headers: array<string, string>, body: mixed}> */
	public array $sent = array();

	public function on( string $method, string $path, int $status, $json = null, array $headers = array() ): self {
		$this->routes[ "$method $path" ][] = array( $status, $json, $headers );
		return $this;
	}

	public function send( string $method, string $url, array $headers, string|MultipartBody|null $body ): HttpResponse {
		$parts        = wp_parse_url( $url );
		$path         = $parts['path'] ?? '';
		$this->sent[] = array(
			'method'  => $method,
			'path'    => $path,
			'query'   => $parts['query'] ?? '',
			'headers' => $headers,
			'body'    => is_string( $body ) ? json_decode( $body, true ) : $body,
		);
		$key = "$method $path";
		if ( empty( $this->routes[ $key ] ) ) {
			return new HttpResponse( 404, array( 'content-type' => 'application/json' ), '{"code":"not_found","message":"not found"}' );
		}
		$answer = count( $this->routes[ $key ] ) > 1 ? array_shift( $this->routes[ $key ] ) : $this->routes[ $key ][0];
		return new HttpResponse( $answer[0], array( 'content-type' => 'application/json' ) + $answer[2], null === $answer[1] ? '' : (string) wp_json_encode( $answer[1] ) );
	}

	/**
	 * "METHOD /path" of each request, in order.
	 *
	 * @return list<string>
	 */
	public function calls(): array {
		return array_map( fn( $r ) => $r['method'] . ' ' . $r['path'], $this->sent );
	}
}
