<?php
/**
 * The admin pass-through, widget tickets, the spending policy and templates.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Tests;

use VocalStack\WP\Rest\Proxy;
use VocalStack\WP\Settings;
use VocalStack\WP\Widgets\Policy;
use VocalStack\WP\Widgets\Templates;
use VocalStack\WP\Widgets\Ticket;

final class FoundationsTest extends \WP_UnitTestCase {

	/** @var list<array{method: string, url: string, headers: array<string, string>}> */
	private array $sent = array();

	public function set_up(): void {
		parent::set_up();
		Settings::set_api_key( 'vs_key_proxy' );
		Policy::install();
		add_filter(
			'pre_http_request',
			function ( $pre, $args, $url ) {
				$this->sent[] = array(
					'method'  => $args['method'],
					'url'     => $url,
					'headers' => $args['headers'],
				);
				return array(
					'headers'  => array( 'content-type' => 'application/json' ),
					'body'     => '{"items":[]}',
					'response' => array( 'code' => 200 ),
					'cookies'  => array(),
				);
			},
			10,
			3
		);
	}

	private function admin(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
	}

	private function proxy( string $method, string $path ): \WP_REST_Response {
		return rest_get_server()->dispatch( new \WP_REST_Request( $method, '/vocalstack/v1/api/' . $path ) );
	}

	public function test_allowlist(): void {
		$this->assertTrue( Proxy::allowed( 'GET', 'transcriptions' ) );
		$this->assertTrue( Proxy::allowed( 'GET', 'recordings/01a15558-9dde/transcript' ) );
		$this->assertTrue( Proxy::allowed( 'POST', 'transcriptions/abc/purge' ) );
		$this->assertTrue( Proxy::allowed( 'GET', 'rtmp' ) );
		$this->assertFalse( Proxy::allowed( 'POST', 'rtmp' ) );
		$this->assertFalse( Proxy::allowed( 'POST', 'connect/token' ) );
		$this->assertFalse( Proxy::allowed( 'POST', 'billing/checkouts' ) );
		$this->assertFalse( Proxy::allowed( 'DELETE', 'transcriptions/abc' ) );
		$this->assertFalse( Proxy::allowed( 'GET', 'recordings/a/b/transcript' ) );
	}

	public function test_admins_reach_vocalstack_with_the_key(): void {
		$this->admin();
		$request = new \WP_REST_Request( 'GET', '/vocalstack/v1/api/transcriptions' );
		$request->set_query_params( array( 'lifecycle' => 'archived' ) );

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( 'items' => array() ), $response->get_data() );
		$this->assertSame( 'https://api.vocalstack.com/v1/transcriptions?lifecycle=archived', $this->sent[0]['url'] );
		$this->assertSame( 'Bearer vs_key_proxy', $this->sent[0]['headers']['authorization'] );
	}

	public function test_requests_off_the_list_never_leave_the_site(): void {
		$this->admin();
		$this->assertSame( 403, $this->proxy( 'POST', 'connect/token' )->get_status() );
		$this->assertSame( array(), $this->sent );
	}

	public function test_editors_cannot_use_the_pass_through(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		$this->assertSame( 403, $this->proxy( 'GET', 'transcriptions' )->get_status() );
		$this->assertSame( array(), $this->sent );
	}

	public function test_a_ticket_survives_the_round_trip_and_refuses_edits(): void {
		$ticket = Ticket::sign(
			array(
				'type'             => 'record',
				'maxRecordMinutes' => 5,
			)
		);
		$this->assertSame( 5, Ticket::verify( $ticket )['maxRecordMinutes'] );

		[ $payload, $signature ] = explode( '.', $ticket );
		$forged                  = rtrim( strtr( base64_encode( '{"type":"record","maxRecordMinutes":500}' ), '+/', '-_' ), '=' );
		$this->assertNull( Ticket::verify( $forged . '.' . $signature ) );
		$this->assertNull( Ticket::verify( 'garbage' ) );
	}

	public function test_a_widget_can_narrow_but_not_widen_the_ceilings(): void {
		Policy::update(
			array(
				'access'           => 'logged_in',
				'maxRecordMinutes' => 30,
			)
		);
		$wider = Policy::effective(
			array(
				'access'           => 'everyone',
				'maxRecordMinutes' => 120,
			)
		);
		$this->assertSame( 'logged_in', $wider['access'] );
		$this->assertSame( 30, $wider['maxRecordMinutes'] );

		$narrower = Policy::effective(
			array(
				'access'           => 'roles',
				'roles'            => array( 'editor' ),
				'maxRecordMinutes' => 5,
			)
		);
		$this->assertSame( 'roles', $narrower['access'] );
		$this->assertSame( array( 'editor' ), $narrower['roles'] );
		$this->assertSame( 5, $narrower['maxRecordMinutes'] );
	}

	public function test_access_levels(): void {
		$limits = Policy::effective( array() );
		$this->assertFalse( Policy::may_use( $limits ), 'Logged-in only by default.' );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$this->assertTrue( Policy::may_use( $limits ) );
		$this->assertFalse(
			Policy::may_use(
				array(
					'access' => 'roles',
					'roles'  => array( 'editor' ),
				)
			)
		);
	}

	public function test_daily_minutes_are_reserved_then_settled(): void {
		wp_set_current_user( self::factory()->user->create() );
		Policy::update( array( 'userDailyMinutes' => 10 ) );
		$limits = Policy::effective( array() );

		$this->assertTrue( Policy::reserve_minutes( $limits, 8 * 60 ) );
		$this->assertWPError( Policy::reserve_minutes( $limits, 5 * 60 ) );

		Policy::settle_minutes( Policy::visitor(), 8 * 60, 60 );
		$this->assertSame( 60, Policy::used( Policy::visitor(), 'record' )['seconds'] );
		$this->assertTrue( Policy::reserve_minutes( $limits, 5 * 60 ) );
	}

	public function test_uploads_are_limited_by_size_and_count(): void {
		wp_set_current_user( self::factory()->user->create() );
		Policy::update(
			array(
				'maxUploadMb'      => 1,
				'userDailyUploads' => 1,
			)
		);
		$limits = Policy::effective( array() );
		$this->assertWPError( Policy::allow_upload( $limits, 2 * MB_IN_BYTES ) );
		$this->assertTrue( Policy::allow_upload( $limits, 1000 ) );
		$this->assertWPError( Policy::allow_upload( $limits, 1000 ) );
	}

	public function test_a_theme_template_wins(): void {
		$dir = get_temp_dir() . 'vocalstack-theme-' . wp_generate_password( 6, false );
		wp_mkdir_p( "$dir/vocalstack" );
		file_put_contents( "$dir/vocalstack/probe.php", 'theme <?php echo esc_html( $args["x"] ); ?>' );
		$point = fn() => $dir;
		add_filter( 'stylesheet_directory', $point );
		add_filter( 'template_directory', $point );
		try {
			$this->assertSame( "$dir/vocalstack/probe.php", Templates::locate( 'probe' ) );
			$this->assertSame( 'theme 1', Templates::render( 'probe', array( 'x' => 1 ) ) );
		} finally {
			unlink( "$dir/vocalstack/probe.php" );
			rmdir( "$dir/vocalstack" );
			rmdir( $dir );
		}
	}

	public function test_without_an_override_the_plugin_template_is_used(): void {
		$this->assertSame( VOCALSTACK_DIR . 'templates/player.php', Templates::locate( 'player' ) );
	}
}
