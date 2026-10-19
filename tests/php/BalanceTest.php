<?php
/**
 * Remaining minutes from the billing view.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Tests;

use VocalStack\WP\Balance;
use VocalStack\WP\Settings;
use VocalStack\WP\Transcriber\TranscriberError;

final class BalanceTest extends TestCase {

	public function test_minutes_are_the_balance_at_each_rate(): void {
		$summary = Balance::summarize( $this->vs->billing );
		// $10 at $0.50/h is 20 h; at $1.50/h it is 6 h 40 min.
		$this->assertSame( 1200, $summary['fileMinutes'] );
		$this->assertSame( 400, $summary['liveMinutes'] );
		$this->assertSame( 5, $summary['minimumMinutes'] );
		$this->assertSame( 'Pay as you go', $summary['plan'] );
	}

	public function test_a_negative_balance_leaves_no_minutes(): void {
		$billing            = $this->vs->billing;
		$billing['balance'] = -2.5;
		$this->assertSame( 0, Balance::summarize( $billing )['fileMinutes'] );
	}

	public function test_an_unbilled_server_is_unlimited(): void {
		$summary = Balance::summarize(
			array(
				'enabled' => false,
				'balance' => 0,
				'rates'   => null,
			)
		);
		$this->assertNull( $summary['fileMinutes'] );
		$this->assertNull( $summary['liveMinutes'] );
	}

	public function test_the_answer_is_cached_until_asked_fresh(): void {
		Balance::get();
		Balance::get();
		$this->assertSame( array( 'billing' ), $this->vs->names() );
		Balance::get( true );
		$this->assertSame( array( 'billing', 'billing' ), $this->vs->names() );
	}

	public function test_changing_the_key_forgets_the_cache(): void {
		Balance::get();
		Settings::set_api_key( 'vs_key_other' );
		Balance::get();
		$this->assertSame( array( 'billing', 'billing' ), $this->vs->names() );
	}

	public function test_a_key_without_billing_access_says_so(): void {
		$this->vs->fail = new TranscriberError( 'forbidden', 'forbidden', 403 );
		$result         = Balance::get();
		$this->assertWPError( $result );
		$this->assertStringContainsString( 'not allowed', $result->get_error_message() );
	}

	public function test_only_administrators_see_the_balance(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		$response = rest_get_server()->dispatch( new \WP_REST_Request( 'GET', '/vocalstack/v1/balance' ) );
		$this->assertSame( 403, $response->get_status() );

		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$response = rest_get_server()->dispatch( new \WP_REST_Request( 'GET', '/vocalstack/v1/balance' ) );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 1200, $response->get_data()['fileMinutes'] );
	}
}
