<?php
/**
 * What the connected account has left.
 *
 * @package VocalStack
 */

namespace VocalStack\WP;

use VocalStack\WP\Transcriber\TranscriberError;

defined( 'ABSPATH' ) || exit;

/**
 * Turns `GET /v1/billing` into file and live minutes, the way the dashboard
 * does: the balance (monthly credit included) divided by each hourly rate.
 * Cached for a minute, so reloading the page does not call VocalStack each time.
 */
final class Balance {

	const CACHE = 'vocalstack_balance';

	/**
	 * The summary, from the cache unless `$fresh`.
	 *
	 * @param bool $fresh Ask VocalStack even when a cached answer exists.
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function get( bool $fresh = false ) {
		if ( '' === Settings::api_key() ) {
			return new \WP_Error( 'vocalstack_not_connected', __( 'No API key is set.', 'vocalstack' ), array( 'status' => 409 ) );
		}
		$cached = get_transient( self::CACHE );
		if ( ! $fresh && is_array( $cached ) ) {
			return $cached;
		}
		try {
			$summary = self::summarize( Plugin::transcriber()->billing() );
		} catch ( TranscriberError $e ) {
			$message = 403 === $e->http_status
				? __( 'This API key is not allowed to see the account’s balance.', 'vocalstack' )
				: $e->getMessage();
			return new \WP_Error( 'vocalstack_' . $e->error_code, $message, array( 'status' => 502 ) );
		}
		set_transient( self::CACHE, $summary, MINUTE_IN_SECONDS );
		return $summary;
	}

	/**
	 * Forget the cached answer (after the key changes).
	 */
	public static function forget(): void {
		delete_transient( self::CACHE );
	}

	/**
	 * The parts of a BillingView the page shows.
	 *
	 * @param array<string, mixed> $billing The answer.
	 * @return array<string, mixed> `fileMinutes`/`liveMinutes` are null when unlimited.
	 */
	public static function summarize( array $billing ): array {
		$enabled = (bool) ( $billing['enabled'] ?? true );
		$balance = (float) ( $billing['balance'] ?? 0 );
		$rates   = is_array( $billing['rates'] ?? null ) ? $billing['rates'] : array();
		$minutes = static function ( string $rate ) use ( $enabled, $balance, $rates ): ?int {
			$per_hour = (float) ( $rates[ $rate ] ?? 0 );
			if ( ! $enabled || $per_hour <= 0 ) {
				return null;
			}
			return (int) floor( max( 0, $balance ) / $per_hour * 60 );
		};
		return array(
			'enabled'        => $enabled,
			'balance'        => $balance,
			'fileMinutes'    => $minutes( 'filePerHour' ),
			'liveMinutes'    => $minutes( 'livePerHour' ),
			'minimumMinutes' => (int) round( ( (int) ( $rates['minimumSeconds'] ?? 0 ) ) / 60 ),
			'canStart'       => (bool) ( $billing['canStart'] ?? true ),
			'canStartLive'   => (bool) ( $billing['canStartLive'] ?? true ),
			'startBlock'     => $billing['startBlock'] ?? null,
			'inGrace'        => (bool) ( $billing['inGrace'] ?? false ),
			'plan'           => (string) ( $billing['plan']['name'] ?? '' ),
			'topUpUrl'       => (string) ( $billing['topUpUrl'] ?? Settings::dashboard_url() . '/billing' ),
			'fetchedAt'      => gmdate( 'c' ),
		);
	}
}
