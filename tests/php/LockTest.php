<?php
/**
 * Atomic locks.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Tests;

use VocalStack\WP\Lock;

final class LockTest extends \WP_UnitTestCase {

	private function expire( string $name ): void {
		global $wpdb;
		$wpdb->update( $wpdb->options, array( 'option_value' => (string) ( time() - 1 ) ), array( 'option_name' => Lock::PREFIX . $name ) );
	}

	public function test_only_one_request_gets_the_lock(): void {
		$this->assertTrue( Lock::acquire( 'a', 30 ) );
		$this->assertFalse( Lock::acquire( 'a', 30 ) );
		$this->assertTrue( Lock::acquire( 'b', 30 ) );
	}

	public function test_a_released_lock_can_be_taken_again(): void {
		Lock::acquire( 'a', 30 );
		Lock::release( 'a' );
		$this->assertTrue( Lock::acquire( 'a', 30 ) );
	}

	public function test_an_expired_lock_is_taken_over_once(): void {
		Lock::acquire( 'a', 30 );
		$this->expire( 'a' );
		$this->assertTrue( Lock::acquire( 'a', 30 ) );
		$this->assertFalse( Lock::acquire( 'a', 30 ) );
	}

	public function test_purge_removes_only_expired_locks(): void {
		global $wpdb;
		Lock::acquire( 'old', 30 );
		Lock::acquire( 'new', 30 );
		$this->expire( 'old' );

		Lock::purge();

		$names = $wpdb->get_col( $wpdb->prepare( "SELECT option_name FROM {$wpdb->options} WHERE option_name LIKE %s", $wpdb->esc_like( Lock::PREFIX ) . '%' ) );
		$this->assertSame( array( Lock::PREFIX . 'new' ), $names );
	}
}
