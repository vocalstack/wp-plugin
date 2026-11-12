<?php
/**
 * REST routes: permissions, settings and captions.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Tests;

use VocalStack\WP\Media;
use VocalStack\WP\Rest\Proxy;
use VocalStack\WP\Settings;
use VocalStack\WP\Transcriber\TranscriberError;
use VocalStack\WP\Workspace;

final class RestTest extends TestCase {

	private function call( string $method, string $route, array $body = array() ): \WP_REST_Response {
		$request = new \WP_REST_Request( $method, '/vocalstack/v1' . $route );
		if ( $body ) {
			$request->set_header( 'content-type', 'application/json' );
			$request->set_body( wp_json_encode( $body ) );
		}
		return rest_get_server()->dispatch( $request );
	}

	private function login( string $role ): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => $role ) ) );
	}

	public function test_visitors_cannot_transcribe(): void {
		$id = $this->audio();
		$this->assertSame( 401, $this->call( 'POST', "/media/$id/transcribe" )->get_status() );
		$this->assertSame( array(), $this->vs->calls );
	}

	public function test_subscribers_cannot_transcribe(): void {
		$this->login( 'subscriber' );
		$id = $this->audio();
		$this->assertSame( 403, $this->call( 'POST', "/media/$id/transcribe" )->get_status() );
	}

	public function test_editors_can_transcribe(): void {
		$this->login( 'editor' );
		$id       = $this->audio();
		$response = $this->call( 'POST', "/media/$id/transcribe" );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'queued', $response->get_data()['state'] );
	}

	public function test_managers_who_are_not_administrators_can_view_but_not_change_the_key(): void {
		$this->login( 'editor' );
		wp_get_current_user()->add_cap( 'vocalstack_manage' );
		$this->assertSame( 200, $this->call( 'GET', '/settings' )->get_status() );
		$this->assertSame( 403, $this->call( 'POST', '/settings', array( 'apiKey' => 'vs_key_mine' ) )->get_status() );
	}

	public function test_editors_cannot_change_settings(): void {
		$this->login( 'editor' );
		$this->assertSame( 403, $this->call( 'GET', '/settings' )->get_status() );
	}

	public function test_settings_never_return_the_key(): void {
		$this->login( 'administrator' );
		Settings::set_api_key( 'vs_key_secret1234' );
		$data = $this->call( 'GET', '/settings' )->get_data();
		$this->assertStringNotContainsString( 'secret', wp_json_encode( $data ) );
		$this->assertSame( '…1234', $data['connection']['keyHint'] );
	}

	public function test_connecting_checks_the_key_and_keeps_the_old_one_on_failure(): void {
		$this->login( 'administrator' );
		$this->vs->fail = new TranscriberError( 'Invalid key', 'unauthorized', 401 );

		$response = $this->call( 'POST', '/settings', array( 'apiKey' => 'vs_key_wrong' ) );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'vs_key_test', Settings::api_key() );
	}

	public function test_connecting_stores_the_account_name(): void {
		$this->login( 'administrator' );
		$data = $this->call( 'POST', '/settings', array( 'apiKey' => 'vs_key_new' ) )->get_data();
		$this->assertSame( 'vs_key_new', Settings::api_key() );
		$this->assertSame( 'Acme', $data['connection']['account'] );
	}

	private function in_workspace( string $id, string $name, bool $personal = false, ?string $icon = null ): void {
		$this->vs->account['workspace'] = array(
			'id'       => $id,
			'name'     => $name,
			'personal' => $personal,
			'iconUrl'  => $icon,
		);
	}

	public function test_the_connection_names_the_workspace_of_a_pasted_key(): void {
		$this->login( 'administrator' );
		$this->in_workspace( '3f2b8c1e-7a4d-4e9b-9c55-0d1e2f3a4b5c', 'Acme studio', false, '/workspace-icons/3f2b8c1e?v=2&exp=9&sig=abc' );

		$data = $this->call( 'POST', '/settings', array( 'apiKey' => 'vs_key_new' ) )->get_data();

		$this->assertSame(
			array(
				'id'       => '3f2b8c1e-7a4d-4e9b-9c55-0d1e2f3a4b5c',
				'name'     => 'Acme studio',
				'personal' => false,
				'iconUrl'  => 'https://api.vocalstack.com/workspace-icons/3f2b8c1e?v=2&exp=9&sig=abc',
			),
			$data['connection']['workspace']
		);
	}

	public function test_the_workspace_is_read_when_the_settings_load_and_then_kept_for_an_hour(): void {
		$this->login( 'administrator' );
		$this->in_workspace( 'ws_personal', 'Personal workspace', true );

		$first = $this->call( 'GET', '/settings' )->get_data();
		$this->call( 'GET', '/settings' );

		$this->assertSame( 'Personal workspace', $first['connection']['workspace']['name'] );
		$this->assertTrue( $first['connection']['workspace']['personal'] );
		$this->assertNull( $first['connection']['workspace']['iconUrl'] );
		$this->assertSame( array( 'account' ), $this->vs->names() );
	}

	public function test_a_renamed_workspace_shows_after_test_connection(): void {
		$this->login( 'administrator' );
		$this->in_workspace( 'ws_1', 'Acme' );
		$this->call( 'GET', '/settings' );
		$this->in_workspace( 'ws_1', 'Acme Radio' );

		$data = $this->call( 'POST', '/settings/test' )->get_data();

		$this->assertSame( 'Acme Radio', $data['connection']['workspace']['name'] );
	}

	public function test_an_older_api_without_a_workspace_keeps_the_account_name(): void {
		$this->login( 'administrator' );

		$data = $this->call( 'GET', '/settings' )->get_data();

		$this->assertNull( $data['connection']['workspace'] );
		$this->assertSame( 'Acme', $data['connection']['account'] );
	}

	public function test_another_key_never_shows_the_workspace_of_the_one_before(): void {
		$this->login( 'administrator' );
		$this->in_workspace( 'ws_1', 'Acme' );
		$this->call( 'GET', '/settings' );
		Settings::set_api_key( 'vs_key_other' );
		$this->vs->fail = new TranscriberError( 'Unavailable', 'unavailable', 503 );

		$data = $this->call( 'GET', '/settings' )->get_data();

		$this->assertNull( $data['connection']['workspace'] );
		$this->assertSame( '', Workspace::id() );
	}

	public function test_an_icon_that_is_not_a_path_on_the_api_is_not_shown(): void {
		$this->login( 'administrator' );
		$this->in_workspace( 'ws_1', 'Acme', false, '//evil.example/icon.png' );

		$data = $this->call( 'GET', '/settings' )->get_data();

		$this->assertNull( $data['connection']['workspace']['iconUrl'] );
	}

	public function test_disconnecting_forgets_the_workspace(): void {
		$this->login( 'administrator' );
		$this->in_workspace( 'ws_1', 'Acme' );
		$this->call( 'GET', '/settings' );

		$data = $this->call( 'POST', '/settings', array( 'apiKey' => '' ) )->get_data();

		$this->assertNull( $data['connection']['workspace'] );
		$this->assertFalse( get_option( Workspace::OPTION ) );
	}

	public function test_a_refused_key_keeps_the_workspace_in_use(): void {
		$this->login( 'administrator' );
		$this->in_workspace( 'ws_1', 'Acme' );
		$this->call( 'GET', '/settings' );
		$this->vs->fail = new TranscriberError( 'Invalid key', 'unauthorized', 401 );

		$this->assertSame( 400, $this->call( 'POST', '/settings', array( 'apiKey' => 'vs_key_wrong' ) )->get_status() );

		$this->assertSame( 'vs_key_test', Settings::api_key() );
		$this->assertSame( 'ws_1', Workspace::id() );
	}

	public function test_captions_for_a_transcribed_file(): void {
		$id = $this->audio( 'video/mp4' );
		Media::save_transcript( $id, $this->vs->transcript );

		$response = $this->call( 'GET', "/captions/$id" );

		$this->assertSame( 200, $response->get_status() );
		$this->assertStringStartsWith( "WEBVTT\n", $response->get_data() );
	}

	public function test_captions_follow_the_parent_post(): void {
		$draft = self::factory()->post->create( array( 'post_status' => 'draft' ) );
		$id    = $this->audio( 'video/mp4' );
		wp_update_post(
			array(
				'ID'          => $id,
				'post_parent' => $draft,
			)
		);
		Media::save_transcript( $id, $this->vs->transcript );

		$this->assertSame( 401, $this->call( 'GET', "/captions/$id" )->get_status() );
	}

	public function test_the_media_list_shows_audio_and_video_only(): void {
		$this->login( 'administrator' );
		$audio = $this->audio();
		$video = $this->audio( 'video/mp4' );
		self::factory()->attachment->create_object(
			array(
				'file'           => 'photo.jpg',
				'post_mime_type' => 'image/jpeg',
			)
		);

		$response = $this->call( 'GET', '/media' );

		$this->assertSame( 200, $response->get_status() );
		$ids = array_column( $response->get_data(), 'id' );
		sort( $ids );
		$this->assertSame( array( $audio, $video ), $ids );
		$this->assertSame( '2', $response->get_headers()['X-WP-Total'] );
		$this->assertArrayNotHasKey( 'sentences', $response->get_data()[0] );
	}

	public function test_the_media_list_filters_by_state(): void {
		$this->login( 'administrator' );
		$done = $this->audio();
		Media::save_transcript( $done, $this->vs->transcript );
		update_post_meta( $done, Media::STATE, 'done' );
		$none = $this->audio();

		$request = new \WP_REST_Request( 'GET', '/vocalstack/v1/media' );
		$request->set_param( 'status', 'done' );
		$rows = rest_get_server()->dispatch( $request )->get_data();
		$this->assertSame( array( $done ), array_column( $rows, 'id' ) );
		$this->assertSame( 7, $rows[0]['words'] ); // "Hello there. How are you? Fine, thanks."

		$request->set_param( 'status', 'none' );
		$this->assertSame( array( $none ), array_column( rest_get_server()->dispatch( $request )->get_data(), 'id' ) );
	}

	public function test_subscribers_cannot_list_media(): void {
		$this->login( 'subscriber' );
		$this->assertSame( 403, $this->call( 'GET', '/media' )->get_status() );
	}

	public function test_editors_without_the_vocalstack_capability_cannot_list_media(): void {
		$this->login( 'editor' );
		$this->assertSame( 403, $this->call( 'GET', '/media' )->get_status() );
	}

	public function test_the_media_list_holds_only_the_users_own_files_unless_they_can_edit_others(): void {
		$others = $this->audio();
		$author = self::factory()->user->create( array( 'role' => 'author' ) );
		get_userdata( $author )->add_cap( Proxy::CAPABILITY );
		wp_set_current_user( $author );
		$own = $this->audio();
		wp_update_post(
			array(
				'ID'          => $own,
				'post_author' => $author,
			)
		);

		$response = $this->call( 'GET', '/media' );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( $own ), array_column( $response->get_data(), 'id' ) );
		$this->assertNotContains( $others, array_column( $response->get_data(), 'id' ) );
		$this->assertSame( '1', $response->get_headers()['X-WP-Total'] );
	}
}
