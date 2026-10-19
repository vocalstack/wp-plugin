<?php
/**
 * Signed widget configuration.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Widgets;

defined( 'ABSPATH' ) || exit;

/**
 * A widget's configuration travels through the visitor's browser and back to
 * the public routes, so it is signed: `base64url(json) . "." . base64url(hmac)`.
 * The routes act on a verified configuration only; an edited one fails.
 */
final class Ticket {

	/**
	 * Sign a configuration.
	 *
	 * @param array<string, mixed> $config The widget's configuration.
	 */
	public static function sign( array $config ): string {
		$payload = self::b64( (string) wp_json_encode( $config ) );
		return $payload . '.' . self::b64( hash_hmac( 'sha256', $payload, self::secret(), true ) );
	}

	/**
	 * The configuration in a ticket, or null if it was changed or is not one.
	 *
	 * @param string $ticket A ticket from sign().
	 * @return array<string, mixed>|null
	 */
	public static function verify( string $ticket ): ?array {
		$parts = explode( '.', $ticket );
		if ( 2 !== count( $parts ) ) {
			return null;
		}
		$expected = self::b64( hash_hmac( 'sha256', $parts[0], self::secret(), true ) );
		if ( ! hash_equals( $expected, $parts[1] ) ) {
			return null;
		}
		$config = json_decode( (string) base64_decode( strtr( $parts[0], '-_', '+/' ), true ), true ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_decode -- Decoding our own signed payload.
		return is_array( $config ) ? $config : null;
	}

	/**
	 * The signing key: WordPress's auth salt, kept apart from other uses.
	 */
	private static function secret(): string {
		return wp_salt( 'auth' ) . '|vocalstack-widget';
	}

	/**
	 * URL-safe base64 without padding.
	 *
	 * @param string $bytes Bytes.
	 */
	private static function b64( string $bytes ): string {
		return rtrim( strtr( base64_encode( $bytes ), '+/', '-_' ), '=' ); // phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- A signed payload.
	}
}
