<?php
/**
 * One-click Connect: the start, and the callback VocalStack redirects to.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Tests;

use VocalStack\WP\Connect;
use VocalStack\WP\Settings;
use VocalStack\WP\Workspace;

final class ConnectTest extends TestCase {

	private FakeHttp $http;

	public function set_up(): void {
		parent::set_up();
		$this->http = new FakeHttp();
		add_filter( 'vocalstack_http_client', fn() => $this->http );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$this->site( 'https://shop.example' );
	}

	/**
	 * Serve wp-admin from another address.
	 *
	 * @param string $origin Scheme and host.
	 */
	private function site( string $origin ): void {
		remove_all_filters( 'admin_url' );
		add_filter( 'admin_url', fn( $url ) => preg_replace( '#^https?://[^/]+#', $origin, $url ) );
	}

	private function post( string $route, array $body = array() ): \WP_REST_Response {
		$request = new \WP_REST_Request( 'POST', '/vocalstack/v1' . $route );
		if ( $body ) {
			$request->set_header( 'content-type', 'application/json' );
			$request->set_body( wp_json_encode( $body ) );
		}
		return rest_get_server()->dispatch( $request );
	}

	/**
	 * Start a connection and return the consent link's parameters.
	 *
	 * @return array<string, string>
	 */
	private function start(): array {
		$response = $this->post( '/connect' );
		$this->assertSame( 200, $response->get_status() );
		parse_str( (string) wp_parse_url( $response->get_data()['url'], PHP_URL_QUERY ), $query );
		return $query;
	}

	private function pending(): array {
		return (array) get_transient( 'vocalstack_connect_' . get_current_user_id() );
	}

	private function vocalstack_issues( string $key, ?array $workspace ): void {
		$this->http->on(
			'POST',
			'/v1/connect/token',
			200,
			array_filter(
				array(
					'access_token' => $key,
					'token_type'   => 'api_key',
					'key_id'       => 'key_1',
					'scope'        => 'read write',
					'reach'        => 'account',
					'account'      => array( 'name' => 'Shop (WordPress)' ),
					'workspace'    => $workspace,
				)
			)
		);
	}

	public function test_start_keeps_a_state_and_a_verifier_and_builds_the_consent_link(): void {
		update_option( 'blogname', 'Tom &amp; Ann&#039;s Shop' );

		$response = $this->post( '/connect' );
		$url      = $response->get_data()['url'];
		parse_str( (string) wp_parse_url( $url, PHP_URL_QUERY ), $query );
		$pending = $this->pending();

		$this->assertStringStartsWith( 'https://app.vocalstack.com/connect?', $url );
		$this->assertMatchesRegularExpression( '/^[A-Za-z0-9._~-]{43,128}$/', $pending['verifier'] );
		$this->assertSame( $pending['state'], $query['state'] );
		$this->assertGreaterThanOrEqual( 20, strlen( $query['state'] ) );
		$this->assertSame( rtrim( strtr( base64_encode( hash( 'sha256', $pending['verifier'], true ) ), '+/', '-_' ), '=' ), $query['code_challenge'] );
		$this->assertSame( 'S256', $query['code_challenge_method'] );
		$this->assertSame( 'code', $query['response_type'] );
		$this->assertSame( "Tom & Ann's Shop (WordPress)", $query['client_name'] );
		$this->assertSame( 'https://shop.example/wp-admin/admin-post.php?action=vocalstack_connect', $query['redirect_uri'] );
		$this->assertSame( 'read write', $query['scope'] );
		$this->assertSame( 'account', $query['reach'] );
		$this->assertStringNotContainsString( $pending['verifier'], $url );
		$this->assertSame( array(), $this->http->sent );
	}

	public function test_start_names_the_connected_workspace(): void {
		$id = '0b6f3c1e-8a52-4d7b-9e10-3f2a6c5d4b7a';
		Workspace::remember(
			array(
				'workspace' => array(
					'id'   => $id,
					'name' => 'North Radio',
				),
			)
		);

		$response = $this->post( '/connect' );
		$url      = $response->get_data()['url'];
		parse_str( (string) wp_parse_url( $url, PHP_URL_QUERY ), $query );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( $id, $query['workspace'] );
		$this->assertStringContainsString( '&workspace=' . $id, $url );
		$this->assertSame( $this->pending()['state'], $query['state'] );
		$this->assertSame( array(), $this->http->sent );
	}

	public function test_start_names_no_workspace_when_none_is_kept(): void {
		$this->assertArrayNotHasKey( 'workspace', $this->start() );

		Workspace::remember( array( 'user' => array( 'id' => 'u_1' ) ) );
		$this->assertArrayNotHasKey( 'workspace', $this->start() );

		$this->assertSame( array(), $this->http->sent );
	}

	public function test_start_names_no_workspace_kept_for_another_key(): void {
		Workspace::remember( array( 'workspace' => array( 'id' => '0b6f3c1e-8a52-4d7b-9e10-3f2a6c5d4b7a' ) ) );
		Settings::set_api_key( 'vs_key_another' );

		$this->assertArrayNotHasKey( 'workspace', $this->start() );
	}

	public function test_start_names_no_workspace_whose_id_is_not_a_uuid(): void {
		$malformed = array(
			'ws_old',
			'0b6f3c1e8a524d7b9e103f2a6c5d4b7a',
			'0b6f3c1e-8a52-4d7b-9e10-3f2a6c5d4b7',
			'0b6f3c1e-8a52-4d7b-9e10-3f2a6c5d4b7a-x',
			'zb6f3c1e-8a52-4d7b-9e10-3f2a6c5d4b7a',
		);
		foreach ( $malformed as $id ) {
			Workspace::remember( array( 'workspace' => array( 'id' => $id ) ) );
			$this->assertSame( $id, Workspace::id() );
			$this->assertArrayNotHasKey( 'workspace', $this->start(), $id );
		}

		$option       = get_option( Workspace::OPTION );
		$option['id'] = "0b6f3c1e-8a52-4d7b-9e10-3f2a6c5d4b7a\n&reach=key";
		update_option( Workspace::OPTION, $option, false );
		$this->assertArrayNotHasKey( 'workspace', $this->start() );
		$this->assertSame( array(), $this->http->sent );
	}

	public function test_a_plain_http_public_site_cannot_use_connect(): void {
		$this->site( 'http://shop.example' );

		$response = $this->post( '/connect' );
		$settings = rest_get_server()->dispatch( new \WP_REST_Request( 'GET', '/vocalstack/v1/settings' ) )->get_data();

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'vocalstack_connect_needs_https', $response->get_data()['code'] );
		$this->assertSame( array( false ), $this->pending() );
		$this->assertFalse( $settings['connection']['connect'] );
	}

	public function test_http_on_this_computer_can_use_connect(): void {
		foreach ( array( 'http://localhost:8888', 'http://127.0.0.1' ) as $origin ) {
			$this->site( $origin );
			$this->assertTrue( Connect::available(), $origin );
		}
		$this->site( 'http://localhost.evil.example' );
		$this->assertFalse( Connect::available() );
	}

	public function test_only_administrators_start_a_connection(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'editor' ) ) );
		wp_get_current_user()->add_cap( 'vocalstack_manage' );

		$this->assertSame( 403, $this->post( '/connect' )->get_status() );
		$this->assertSame( 'error', Connect::finish( array( 'state' => 'x', 'code' => 'c' ) )['status'] );
		$this->assertSame( 'vs_key_test', Settings::api_key() );
	}

	public function test_a_good_code_stores_the_new_key_and_its_workspace(): void {
		$query = $this->start();
		$this->vocalstack_issues(
			'vs_key_fromconnect',
			array(
				'id'       => 'ws_new',
				'name'     => 'North Radio',
				'personal' => false,
				'iconUrl'  => '/workspace-icons/ws_new?v=1&exp=2&sig=3',
			)
		);

		$outcome = Connect::finish( array( 'state' => $query['state'], 'code' => 'code_1' ) );

		$this->assertSame( 'success', $outcome['status'] );
		$this->assertStringContainsString( 'North Radio', $outcome['text'] );
		$this->assertSame( 'vs_key_fromconnect', Settings::api_key() );
		$this->assertSame( 'vs_key_fromconnect', get_option( Settings::KEY_OPTION ) );
		$this->assertSame( 'ws_new', Workspace::id() );

		$sent = $this->http->sent[0];
		parse_str( (string) $sent['raw'], $form );
		$this->assertSame( 'POST /v1/connect/token', $sent['method'] . ' ' . $sent['path'] );
		$this->assertArrayNotHasKey( 'authorization', $sent['headers'] );
		$this->assertSame( 'application/x-www-form-urlencoded', $sent['headers']['content-type'] );
		$this->assertSame( 'authorization_code', $form['grant_type'] );
		$this->assertSame( 'code_1', $form['code'] );
		$this->assertSame( $query['redirect_uri'], $form['redirect_uri'] );
		$this->assertSame( $query['code_challenge'], rtrim( strtr( base64_encode( hash( 'sha256', $form['code_verifier'], true ) ), '+/', '-_' ), '=' ) );

		$connection = rest_get_server()->dispatch( new \WP_REST_Request( 'GET', '/vocalstack/v1/settings' ) )->get_data()['connection'];
		$this->assertSame( '…nect', $connection['keyHint'] );
		$this->assertSame( 'North Radio', $connection['workspace']['name'] );
		$this->assertSame( 'https://api.vocalstack.com/workspace-icons/ws_new?v=1&exp=2&sig=3', $connection['workspace']['iconUrl'] );
		$this->assertSame( 'Shop (WordPress)', $connection['account'] );
		$this->assertStringNotContainsString( 'vs_key_fromconnect', wp_json_encode( $connection ) );
	}

	public function test_a_state_works_once(): void {
		$query = $this->start();
		$this->vocalstack_issues( 'vs_key_fromconnect', null );
		Connect::finish( array( 'state' => $query['state'], 'code' => 'code_1' ) );

		$again = Connect::finish( array( 'state' => $query['state'], 'code' => 'code_2' ) );

		$this->assertSame( 'error', $again['status'] );
		$this->assertCount( 1, $this->http->sent );
	}

	public function test_a_state_that_does_not_match_is_refused(): void {
		$this->start();
		$this->vocalstack_issues( 'vs_key_stolen', null );

		$outcome = Connect::finish( array( 'state' => 'someone-elses-state', 'code' => 'code_1' ) );

		$this->assertSame( 'error', $outcome['status'] );
		$this->assertSame( array(), $this->http->sent );
		$this->assertSame( 'vs_key_test', Settings::api_key() );
	}

	public function test_a_callback_nobody_started_is_refused(): void {
		$this->vocalstack_issues( 'vs_key_stolen', null );

		$this->assertSame( 'error', Connect::finish( array( 'state' => '', 'code' => 'code_1' ) )['status'] );
		$this->assertSame( 'error', Connect::finish( array( 'code' => 'code_1' ) )['status'] );
		$this->assertSame( array(), $this->http->sent );
		$this->assertSame( 'vs_key_test', Settings::api_key() );
	}

	public function test_another_administrators_state_is_refused(): void {
		$query = $this->start();
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'administrator' ) ) );
		$this->vocalstack_issues( 'vs_key_stolen', null );

		$this->assertSame( 'error', Connect::finish( array( 'state' => $query['state'], 'code' => 'code_1' ) )['status'] );
		$this->assertSame( 'vs_key_test', Settings::api_key() );
	}

	public function test_cancel_keeps_the_key_in_use(): void {
		Workspace::remember( array( 'workspace' => array( 'id' => 'ws_old', 'name' => 'Old' ) ) );
		$query = $this->start();

		$outcome = Connect::finish( array( 'state' => $query['state'], 'error' => 'access_denied' ) );

		$this->assertSame( 'info', $outcome['status'] );
		$this->assertSame( array(), $this->http->sent );
		$this->assertSame( 'vs_key_test', Settings::api_key() );
		$this->assertSame( 'ws_old', Workspace::id() );
	}

	public function test_a_refused_code_keeps_the_key_in_use(): void {
		Workspace::remember( array( 'workspace' => array( 'id' => 'ws_old', 'name' => 'Old' ) ) );
		$query = $this->start();
		$this->http->on(
			'POST',
			'/v1/connect/token',
			400,
			array(
				'error'             => 'invalid_grant',
				'error_description' => 'This code has expired.',
			)
		);

		$outcome = Connect::finish( array( 'state' => $query['state'], 'code' => 'spent' ) );

		$this->assertSame( 'error', $outcome['status'] );
		$this->assertStringContainsString( 'This code has expired.', $outcome['text'] );
		$this->assertSame( 'vs_key_test', Settings::api_key() );
		$this->assertSame( 'ws_old', Workspace::id() );
	}

	public function test_an_answer_without_a_key_keeps_the_key_in_use(): void {
		$query = $this->start();
		$this->http->on( 'POST', '/v1/connect/token', 200, array( 'token_type' => 'api_key' ) );

		$this->assertSame( 'error', Connect::finish( array( 'state' => $query['state'], 'code' => 'code_1' ) )['status'] );
		$this->assertSame( 'vs_key_test', Settings::api_key() );
	}

	public function test_an_older_api_without_a_workspace_still_connects(): void {
		$query = $this->start();
		$this->vocalstack_issues( 'vs_key_fromconnect', null );

		$outcome = Connect::finish( array( 'state' => $query['state'], 'code' => 'code_1' ) );

		$this->assertSame( 'success', $outcome['status'] );
		$this->assertSame( 'vs_key_fromconnect', Settings::api_key() );
		$this->assertNull( Workspace::current() );
		$this->assertSame( 'Shop (WordPress)', get_option( 'vocalstack_account' ) );
	}

	public function test_the_outcome_is_shown_once(): void {
		$this->assertNull( Connect::take_notice() );
		set_transient(
			'vocalstack_connected_' . get_current_user_id(),
			array(
				'status' => 'success',
				'text'   => 'Connected.',
			),
			60
		);

		$this->assertSame( 'Connected.', Connect::take_notice()['text'] );
		$this->assertNull( Connect::take_notice() );
	}
}
