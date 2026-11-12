<?php
/**
 * The VocalStack workspace the site's key belongs to.
 *
 * @package VocalStack
 */

namespace VocalStack\WP;

defined( 'ABSPATH' ) || exit;

/**
 * A key belongs to one workspace: everything it makes lands there and is
 * billed there. `GET /v1/me` and the answer of `POST /v1/connect/token` name
 * it as `workspace: { id, name, personal, iconUrl }`; an older API leaves it
 * out. What they said is kept with a fingerprint of the key it was said for,
 * and read again after an hour: the icon's link is signed for a limited time,
 * and the workspace can be renamed.
 */
final class Workspace {

	const OPTION = 'vocalstack_workspace';

	/** Seconds before the workspace is read from VocalStack again. */
	const FRESH = HOUR_IN_SECONDS;

	/** Seconds before another try after VocalStack could not be asked. */
	const RETRY = 5 * MINUTE_IN_SECONDS;

	/**
	 * The `workspace` of an answer, cleaned; null when it carries none.
	 *
	 * @param array<string, mixed> $answer `/v1/me` or the Connect token answer.
	 * @return array{id: string, name: string, personal: bool, iconUrl: string}|null
	 */
	public static function from( array $answer ): ?array {
		$w = $answer['workspace'] ?? null;
		if ( ! is_array( $w ) || ! is_string( $w['id'] ?? null ) || ! preg_match( '/^[A-Za-z0-9_-]{1,64}$/', $w['id'] ) ) {
			return null;
		}
		$icon = is_string( $w['iconUrl'] ?? null ) ? $w['iconUrl'] : '';
		// A link relative to the API's address; anything else is not shown.
		if ( ! preg_match( '#^/[^/\\\\\s][^\s\\\\]*$#', $icon ) ) {
			$icon = '';
		}
		return array(
			'id'       => $w['id'],
			'name'     => sanitize_text_field( is_string( $w['name'] ?? null ) ? $w['name'] : '' ),
			'personal' => ! empty( $w['personal'] ),
			'iconUrl'  => $icon,
		);
	}

	/**
	 * Keep what an answer says about the workspace of the key in use.
	 *
	 * @param array<string, mixed> $answer `/v1/me` or the Connect token answer.
	 */
	public static function remember( array $answer ): void {
		self::store( self::from( $answer ), time() );
	}

	/**
	 * VocalStack could not be asked: keep what is known for this key and try
	 * again in a few minutes.
	 */
	public static function postpone(): void {
		$saved = self::saved();
		self::store( $saved && '' !== $saved['id'] ? $saved : null, time() - self::FRESH + self::RETRY );
	}

	/**
	 * Forget the workspace (the site was disconnected).
	 */
	public static function forget(): void {
		delete_option( self::OPTION );
	}

	/**
	 * Whether VocalStack should be asked again: nothing is kept for the key in
	 * use, or it is older than an hour.
	 */
	public static function is_stale(): bool {
		$saved = self::saved();
		return ! $saved || time() - $saved['checkedAt'] >= self::FRESH;
	}

	/**
	 * The workspace of the key in use, for the admin: its icon as a full
	 * address the browser can load. Null when it is not known.
	 *
	 * @return array{id: string, name: string, personal: bool, iconUrl: ?string}|null
	 */
	public static function current(): ?array {
		$saved = self::saved();
		if ( ! $saved || '' === $saved['id'] ) {
			return null;
		}
		return array(
			'id'       => $saved['id'],
			'name'     => $saved['name'],
			'personal' => $saved['personal'],
			'iconUrl'  => '' === $saved['iconUrl'] ? null : Settings::api_url() . $saved['iconUrl'],
		);
	}

	/**
	 * The id of the workspace of the key in use, or ''.
	 */
	public static function id(): string {
		$saved = self::saved();
		return $saved ? $saved['id'] : '';
	}

	/**
	 * What is kept, when it was said for the key in use.
	 *
	 * @return array{id: string, name: string, personal: bool, iconUrl: string, checkedAt: int}|null
	 */
	private static function saved(): ?array {
		$saved = get_option( self::OPTION );
		$key   = Settings::api_key();
		if ( ! is_array( $saved ) || '' === $key || ! is_string( $saved['key'] ?? null ) || ! hash_equals( $saved['key'], self::fingerprint( $key ) ) ) {
			return null;
		}
		return array(
			'id'        => (string) ( $saved['id'] ?? '' ),
			'name'      => (string) ( $saved['name'] ?? '' ),
			'personal'  => ! empty( $saved['personal'] ),
			'iconUrl'   => (string) ( $saved['iconUrl'] ?? '' ),
			'checkedAt' => (int) ( $saved['checkedAt'] ?? 0 ),
		);
	}

	/**
	 * Write the option.
	 *
	 * @param array<string, mixed>|null $workspace The workspace, or null when the API named none.
	 * @param int                       $checked   When it was read.
	 */
	private static function store( ?array $workspace, int $checked ): void {
		$key = Settings::api_key();
		if ( '' === $key ) {
			self::forget();
			return;
		}
		update_option(
			self::OPTION,
			array(
				'id'        => (string) ( $workspace['id'] ?? '' ),
				'name'      => (string) ( $workspace['name'] ?? '' ),
				'personal'  => ! empty( $workspace['personal'] ),
				'iconUrl'   => (string) ( $workspace['iconUrl'] ?? '' ),
				'key'       => self::fingerprint( $key ),
				'checkedAt' => $checked,
			),
			false
		);
	}

	/**
	 * Tells one key from another without keeping the key twice.
	 *
	 * @param string $key The API key.
	 */
	private static function fingerprint( string $key ): string {
		return hash_hmac( 'sha256', $key, wp_salt( 'auth' ) );
	}
}
