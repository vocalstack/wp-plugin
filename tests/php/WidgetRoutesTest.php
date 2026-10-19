<?php
/**
 * The public widgets' routes, against a fake VocalStack under the real SDK.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Tests;

use VocalStack\WP\Media;
use VocalStack\WP\Plugin;
use VocalStack\WP\Settings;
use VocalStack\WP\Widgets\Policy;
use VocalStack\WP\Widgets\Ticket;
use VocalStack\WP\Widgets\Widgets;

final class WidgetRoutesTest extends \WP_UnitTestCase {

	private FakeHttp $http;

	public function set_up(): void {
		parent::set_up();
		$this->http = new FakeHttp();
		add_filter( 'vocalstack_http_client', fn() => $this->http );
		Settings::set_api_key( 'vs_key_widgets' );
		Plugin::reset_transcriber();
		Policy::install();
		Policy::update( array( 'access' => 'logged_in' ) );
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
	}

	public function tear_down(): void {
		Plugin::reset_transcriber();
		parent::tear_down();
	}

	private function call( string $method, string $route, array $params = array() ): \WP_REST_Response {
		$request = new \WP_REST_Request( $method, '/vocalstack/v1/' . $route );
		foreach ( $params as $k => $v ) {
			$request->set_param( $k, $v );
		}
		return rest_get_server()->dispatch( $request );
	}

	private function record_ticket( array $options = array() ): string {
		return Widgets::ticket( 'record', Widgets::options( 'record', $options ) );
	}

	private function vocalstack_starts_a_recording(): void {
		$this->http
			->on( 'POST', '/v1/transcriptions/live', 201, array( 'id' => 'tr_live' ) )
			->on(
				'POST',
				'/v1/transcriptions/tr_live/recordings',
				201,
				array(
					'recording' => array( 'id' => 'rec_live' ),
					'streamUrl' => 'wss://api.example/v1/realtime/sessions/tok/socket',
					'expiresAt' => '2026-10-19T20:00:00Z',
				)
			);
	}

	public function test_record_start_hands_the_browser_only_the_socket(): void {
		$this->vocalstack_starts_a_recording();

		$response = $this->call(
			'POST',
			'widgets/record/start',
			array(
				'ticket' => $this->record_ticket(
					array(
						'max_record_minutes' => 5,
						'language'           => 'ro',
					)
				),
			)
		);

		$this->assertSame( 200, $response->get_status(), wp_json_encode( $response->get_data() ) );
		$data = $response->get_data();
		$this->assertSame( 'wss://api.example/v1/realtime/sessions/tok/socket', $data['streamUrl'] );
		$this->assertSame( 300, $data['maxSeconds'] );
		$this->assertStringNotContainsString( 'vs_key', wp_json_encode( $data ) );

		$live = $this->http->sent[0]['body'];
		$this->assertSame( 300, $live['settings']['maxDurationS'] );
		$this->assertSame( 'ro', $live['settings']['spokenLanguage'] );
		$this->assertFalse( $live['settings']['voice'] );
		$this->assertArrayNotHasKey( 'source', $live );
		$this->assertSame( 300, Policy::used( Policy::visitor(), 'record' )['seconds'], 'The longest recording is reserved.' );
	}

	public function test_a_forged_ticket_starts_nothing(): void {
		$ticket                  = $this->record_ticket();
		[ , $signature ]         = explode( '.', $ticket );
		$forged                  = rtrim( strtr( base64_encode( '{"type":"record","sources":["mic"],"maxRecordMinutes":999}' ), '+/', '-_' ), '=' ) . '.' . $signature;
		$response                = $this->call( 'POST', 'widgets/record/start', array( 'ticket' => $forged ) );
		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( array(), $this->http->sent );
	}

	public function test_visitors_cannot_record_when_logged_in_is_required(): void {
		wp_set_current_user( 0 );
		$response = $this->call( 'POST', 'widgets/record/start', array( 'ticket' => $this->record_ticket() ) );
		$this->assertSame( 401, $response->get_status() );
		$this->assertSame( array(), $this->http->sent );
	}

	public function test_visitors_cannot_record_even_when_the_site_lets_everyone_use_widgets(): void {
		Policy::update( array( 'access' => 'everyone' ) );
		wp_set_current_user( 0 );
		$this->assertSame( 401, $this->call( 'POST', 'widgets/record/start', array( 'ticket' => $this->record_ticket() ) )->get_status() );
		$this->assertSame( array(), $this->http->sent );
	}

	public function test_a_record_widget_cannot_ask_for_everyone(): void {
		$this->assertSame( '', Widgets::options( 'record', array( 'access' => 'everyone' ) )['access'] );
	}

	public function test_a_source_the_widget_does_not_offer_is_refused(): void {
		$response = $this->call(
			'POST',
			'widgets/record/start',
			array(
				'ticket' => $this->record_ticket(),
				'source' => 'tab',
			)
		);
		$this->assertSame( 400, $response->get_status() );
	}

	public function test_a_stream_source_is_pulled_by_vocalstack(): void {
		$this->http
			->on( 'POST', '/v1/transcriptions/live', 201, array( 'id' => 'tr_live' ) )
			->on( 'POST', '/v1/transcriptions/tr_live/recordings', 201, array( 'recording' => array( 'id' => 'rec_live' ) ) );
		$response = $this->call(
			'POST',
			'widgets/record/start',
			array(
				'ticket' => $this->record_ticket( array( 'sources' => 'stream:https://radio.example/live.mp3' ) ),
				'source' => 'stream:https://radio.example/live.mp3',
			)
		);
		$this->assertSame( 200, $response->get_status() );
		$this->assertNull( $response->get_data()['streamUrl'] );
		$this->assertSame(
			array(
				'kind' => 'stream',
				'url'  => 'https://radio.example/live.mp3',
			),
			$this->http->sent[0]['body']['source']
		);
	}

	public function test_a_refused_start_gives_the_minutes_back(): void {
		$this->http->on( 'POST', '/v1/transcriptions/live', 429, array( 'code' => 'quota_exceeded', 'message' => 'one at a time' ) );
		$response = $this->call( 'POST', 'widgets/record/start', array( 'ticket' => $this->record_ticket() ) );
		$this->assertSame( 409, $response->get_status() );
		$this->assertStringContainsString( 'Someone else is recording', $response->get_data()['message'] );
		$this->assertSame( 0, Policy::used( Policy::visitor(), 'record' )['seconds'] );
	}

	public function test_stop_pauses_then_stops_and_settles_the_minutes(): void {
		$this->vocalstack_starts_a_recording();
		$session = $this->call( 'POST', 'widgets/record/start', array( 'ticket' => $this->record_ticket( array( 'max_record_minutes' => 10 ) ) ) )->get_data()['session'];
		$this->http
			->on( 'GET', '/v1/recordings/rec_live', 200, array( 'state' => 'live' ) )
			->on( 'POST', '/v1/recordings/rec_live/pause', 200, array( 'state' => 'paused' ) )
			->on(
				'POST',
				'/v1/recordings/rec_live/stop',
				200,
				array(
					'state'          => 'ended',
					'mediaDurationS' => 42.3,
				)
			);

		$response = $this->call( 'POST', 'widgets/record/stop', array( 'session' => $session ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( array( 'GET /v1/recordings/rec_live', 'POST /v1/recordings/rec_live/pause', 'POST /v1/recordings/rec_live/stop' ), array_slice( $this->http->calls(), 2 ) );
		$this->assertSame( 43, Policy::used( Policy::visitor(), 'record' )['seconds'] );
	}

	public function test_someone_else_cannot_stop_my_recording(): void {
		$this->vocalstack_starts_a_recording();
		$session = $this->call( 'POST', 'widgets/record/start', array( 'ticket' => $this->record_ticket() ) )->get_data()['session'];
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$this->assertSame( 403, $this->call( 'POST', 'widgets/record/stop', array( 'session' => $session ) )->get_status() );
	}

	public function test_upload_saves_to_the_media_library_and_transcribes(): void {
		$this->http->on(
			'POST',
			'/v1/transcriptions',
			201,
			array(
				'id'  => 'tr_up',
				'job' => array( 'recordingId' => 'rec_up' ),
			)
		);
		$tmp = wp_tempnam( 'clip.mp3' );
		copy( dirname( __DIR__ ) . '/fixtures/hello.mp3', $tmp );
		$request = new \WP_REST_Request( 'POST', '/vocalstack/v1/widgets/upload' );
		$request->set_param( 'ticket', Widgets::ticket( 'upload', Widgets::options( 'upload', array( 'title' => 'Visitor clip' ) ) ) );
		$request->set_file_params(
			array(
				'file' => array(
					'name'     => 'clip.mp3',
					'tmp_name' => $tmp,
					'size'     => filesize( $tmp ),
					'error'    => 0,
					'type'     => 'audio/mpeg',
				),
			)
		);

		$response = rest_get_server()->dispatch( $request );

		$this->assertSame( 200, $response->get_status(), wp_json_encode( $response->get_data() ) );
		$this->assertSame( 'queued', $response->get_data()['state'] );
		$attachment = get_posts(
			array(
				'post_type'   => 'attachment',
				'post_status' => 'inherit',
				'title'       => 'Visitor clip',
			)
		)[0];
		$this->assertSame( 'tr_up', get_post_meta( $attachment->ID, Media::TRANSCRIPTION_ID, true ) );
		$this->assertSame( 1, Policy::used( Policy::visitor(), 'upload' )['count'] );
	}

	public function test_player_source_for_a_recording_carries_a_media_token_not_the_key(): void {
		$this->http
			->on( 'GET', '/v1/transcriptions/tr_1', 200, array( 'job' => array( 'recordingId' => 'rec_1' ) ) )
			->on(
				'GET',
				'/v1/recordings/rec_1',
				200,
				array(
					'title'          => 'Sermon',
					'mediaDurationS' => 60,
				)
			)
			->on(
				'GET',
				'/v1/recordings/rec_1/media-token',
				200,
				array(
					'token'     => 'mt_abc',
					'expiresAt' => '2026-10-21T00:00:00Z',
				)
			)
			->on(
				'GET',
				'/v1/recordings/rec_1/transcript',
				200,
				array(
					'speakerLabels' => 'auto',
					'sentences'     => array(
						array(
							'sentenceId' => 0,
							'start'      => 0,
							'end'        => 1,
							'speaker'    => 0,
							'text'       => 'Hi.',
						),
					),
				)
			);
		$ticket = Widgets::ticket(
			'player',
			Widgets::options(
				'player',
				array(
					'source' => 'recording',
					'id'     => 'tr_1',
				)
			)
		);

		$data = $this->call( 'GET', 'widgets/player/source', array( 'ticket' => $ticket ) )->get_data();

		$this->assertSame( 'https://api.vocalstack.com/v1/recordings/rec_1/audio?kind=delivery&format=mp3&media=mt_abc', $data['audioUrl'] );
		$this->assertSame( 'Hi.', $data['sentences'][0]['text'] );
		$this->assertStringNotContainsString( 'vs_key', wp_json_encode( $data ) );
	}

	public function test_a_private_broadcast_cannot_be_followed(): void {
		$this->http->on(
			'GET',
			'/v1/broadcasts/b_1',
			200,
			array(
				'id'     => 'b_1',
				'access' => 'private',
			)
		);
		$ticket = Widgets::ticket(
			'player',
			Widgets::options(
				'player',
				array(
					'source' => 'broadcast',
					'id'     => 'b_1',
				)
			)
		);
		$this->assertSame( 403, $this->call( 'GET', 'widgets/player/source', array( 'ticket' => $ticket ) )->get_status() );
	}

	public function test_a_broadcast_transcript_is_read_without_the_key(): void {
		$this->http->on(
			'GET',
			'/v1/recordings/rec_b/transcript',
			200,
			array(
				'lastSeq'   => 9,
				'sentences' => array(),
			)
		);
		$ticket = Widgets::ticket(
			'player',
			Widgets::options(
				'player',
				array(
					'source' => 'broadcast',
					'id'     => 'b_1',
				)
			)
		);

		$data = $this->call(
			'GET',
			'widgets/player/transcript',
			array(
				'ticket'    => $ticket,
				'recording' => 'rec_b',
			)
		)->get_data();

		$this->assertSame( 9, $data['lastSeq'] );
		$this->assertArrayNotHasKey( 'authorization', $this->http->sent[0]['headers'] );
	}
}
