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
