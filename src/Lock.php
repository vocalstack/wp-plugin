<?php
/**
 * Atomic locks in the options table.
 *
 * @package VocalStack
 */

namespace VocalStack\WP;

defined( 'ABSPATH' ) || exit;

/**
 * A lock is a row in the options table whose value is when it expires. Taking
 * one is a single `INSERT IGNORE` (as core's `WP_Upgrader::create_lock()`
 * does), so of two requests at the same moment only one gets it; an expired
 * lock is taken over with a compare-and-swap. Transients can't do this: a
 * get-then-set lets both requests through, and an object cache keeps them out
 * of the database entirely.
 */
final class Lock {

	const PREFIX = 'vocalstack_lock_';

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( 'wp_scheduled_delete', array( self::class, 'purge' ) );
	}

	/**
	 * Take the lock, if nobody holds it.
	 *
	 * @param string $name A name unique to what it guards.
	 * @param int    $ttl  Seconds until it expires by itself.
	 * @return bool Whether this request has it now.
	 */
	public static function acquire( string $name, int $ttl ): bool {
		global $wpdb;
		$option  = self::PREFIX . $name;
		$expires = time() + $ttl;
		// phpcs:disable WordPress.DB.DirectDatabaseQuery -- An atomic insert; the options API's upsert can't tell who won.
		$inserted = $wpdb->query( $wpdb->prepare( "INSERT IGNORE INTO {$wpdb->options} (option_name, option_value, autoload) VALUES (%s, %s, 'off')", $option, (string) $expires ) );
		if ( 1 === $inserted ) {
			return true;
		}
		$held = $wpdb->get_var( $wpdb->prepare( "SELECT option_value FROM {$wpdb->options} WHERE option_name = %s", $option ) );
		if ( null === $held || (int) $held > time() ) {
			return false;
		}
		// Expired: whoever swaps the old value out first has it.
		$swapped = $wpdb->query( $wpdb->prepare( "UPDATE {$wpdb->options} SET option_value = %s WHERE option_name = %s AND option_value = %s", (string) $expires, $option, $held ) );
		// phpcs:enable
		return 1 === $swapped;
	}

	/**
	 * Let the lock go.
	 *
	 * @param string $name The name it was taken with.
	 */
	public static function release( string $name ): void {
		global $wpdb;
		$wpdb->delete( $wpdb->options, array( 'option_name' => self::PREFIX . $name ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- The lock's own row.
	}

	/**
	 * Remove expired locks (daily, with core's own clean-up).
	 */
	public static function purge(): void {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- Expired lock rows, which the options API doesn't know about.
		$wpdb->query( $wpdb->prepare( "DELETE FROM {$wpdb->options} WHERE option_name LIKE %s AND CAST(option_value AS UNSIGNED) < %d", $wpdb->esc_like( self::PREFIX ) . '%', time() ) );
	}
}
