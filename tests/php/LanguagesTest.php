<?php
/**
 * "Listen in": offered languages, the translation route and the selector.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Tests;

use VocalStack\WP\Languages;
use VocalStack\WP\Media;
use VocalStack\WP\Plugin;
use VocalStack\WP\Settings;
use VocalStack\WP\Widgets\Widgets;

final class LanguagesTest extends \WP_UnitTestCase {

	private FakeHttp $http;

	public function set_up(): void {
		parent::set_up();
		$this->http = new FakeHttp();
		add_filter( 'vocalstack_http_client', fn() => $this->http );
		Settings::set_api_key( 'vs_key_lang' );
		Plugin::reset_transcriber();
		delete_transient( Languages::CACHE );
		$this->http->on(
			'GET',
			'/v1/languages',
			200,
			array(
				'languages'   => array(
					array( 'code' => 'en', 'name' => 'English', 'native' => 'English', 'flag' => '🇬🇧' ),
					array( 'code' => 'es', 'name' => 'Spanish', 'native' => 'Español', 'flag' => '🇪🇸' ),
					array( 'code' => 'am', 'name' => 'Amharic', 'native' => 'አማርኛ', 'flag' => '🇪🇹' ),
				),
				'translation' => array( 'en', 'es', 'am' ),
				'voice'       => array( 'en', 'es' ),
			)
		);
		Settings::update( array( 'languages' => array( 'es', 'am', 'xx' ) ) );
	}

	public function tear_down(): void {
		Plugin::reset_transcriber();
		parent::tear_down();
	}

	private function transcribed_file(): int {
		$id = self::factory()->attachment->create_object(
			array(
				'file'           => 'clip.mp3',
				'post_mime_type' => 'audio/mpeg',
				'post_title'     => 'Clip',
			)
		);
		update_post_meta( $id, Media::JOB, array( 'recordingId' => 'rec_9' ) );
		update_post_meta( $id, Media::STATE, 'done' );
		Media::save_transcript(
			$id,
			array(
				'sentences' => array(
					array( 'start' => 0, 'end' => 1, 'speaker' => 0, 'text' => 'Hello.' ),
				),
			)
		);
		return $id;
	}

	private function translate( array $widget, string $lang ): \WP_REST_Response {
		$request = new \WP_REST_Request( 'GET', '/vocalstack/v1/widgets/player/translation' );
		$request->set_param( 'ticket', Widgets::ticket( 'player', Widgets::options( 'player', $widget ) ) );
		$request->set_param( 'lang', $lang );
		return rest_get_server()->dispatch( $request );
	}

	public function test_offered_keeps_the_sites_order_and_what_vocalstack_translates(): void {
		$this->assertSame( array( 'es', 'am' ), array_column( Languages::offered(), 'code' ) );
		$this->assertTrue( Languages::offered()[0]['voice'] );
		$this->assertFalse( Languages::offered()[1]['voice'] );
		$this->assertSame( array( 'am' ), array_column( Languages::offered( array( 'languages' => 'am,fr' ) ), 'code' ), 'A widget narrows the list; it cannot add to it.' );
	}

	public function test_a_language_the_site_does_not_offer_is_refused_before_anything_is_billed(): void {
		$response = $this->translate(
			array(
				'source' => 'media',
				'id'     => $this->transcribed_file(),
			),
			'en'
		);
		$this->assertSame( 403, $response->get_status() );
		$this->assertSame( array( 'GET /v1/languages' ), $this->http->calls() );
	}

	public function test_translation_uses_what_vocalstack_holds_then_translates_the_rest(): void {
		$this->http
			->on(
				'GET',
				'/v1/recordings/rec_9/transcript',
				200,
				array(
					'sentences' => array(
						array( 'sentenceId' => 1, 'start' => 0, 'end' => 1, 'speaker' => 0, 'text' => 'Hello.', 'translations' => array( 'es' => 'Hola.' ) ),
						array( 'sentenceId' => 2, 'start' => 1, 'end' => 2, 'speaker' => 0, 'text' => 'Goodbye.' ),
						array( 'sentenceId' => 3, 'start' => 2, 'end' => 3, 'speaker' => 0, 'text' => '', 'suppressed' => true ),
					),
				)
			)
			->on( 'GET', '/v1/recordings/rec_9/translation', 200, array( 'lang' => 'es', 'translations' => array( '2' => 'Adiós.' ) ) )
			->on(
				'GET',
				'/v1/recordings/rec_9/voice',
				200,
				array(
					array( 'lang' => 'es', 'voiceKey' => '', 'state' => 'clips', 'clips' => array( 1 ), 'clipParts' => array( '2' => 2 ), 'clipRev' => array( '1' => 'r1' ) ),
				)
			);
		$widget = array(
			'source' => 'media',
			'id'     => $this->transcribed_file(),
		);

		$data = $this->translate( $widget, 'es' )->get_data();

		$this->assertSame( array( 'Hola.', 'Adiós.' ), array_column( $data['sentences'], 'text' ) );
		$this->assertSame( array( 'Hello.', 'Goodbye.' ), array_column( $data['sentences'], 'original' ) );
		$this->assertTrue( $data['voice'] );
		$this->assertSame( 2, (array) $data['clips'] === array() ? 0 : ( (array) $data['clips'] )['parts']['2'] );
		$translation = array_values( array_filter( $this->http->sent, fn( $r ) => str_ends_with( $r['path'], '/translation' ) ) )[0];
		$this->assertStringContainsString( 'sentences=2', $translation['query'], 'Only the missing sentence is translated.' );
		$this->assertStringContainsString( 'lang=es', $translation['query'] );

		$calls = count( $this->http->sent );
		$this->translate( $widget, 'es' );
		$this->assertCount( $calls, $this->http->sent, 'The second listener is answered from the cache.' );
	}

	public function test_a_text_only_language_says_so(): void {
		$this->http->on(
			'GET',
			'/v1/recordings/rec_9/transcript',
			200,
			array(
				'sentences' => array(
					array( 'sentenceId' => 1, 'start' => 0, 'end' => 1, 'speaker' => 0, 'text' => 'Hello.', 'translations' => array( 'am' => 'ሰላም' ) ),
				),
			)
		);
		$data = $this->translate(
			array(
				'source' => 'media',
				'id'     => $this->transcribed_file(),
			),
			'am'
		)->get_data();
		$this->assertFalse( $data['voice'] );
		$this->assertSame( 'ሰላም', $data['sentences'][0]['text'] );
	}

	public function test_the_player_shows_the_selector_for_a_transcribed_file(): void {
		Languages::all(); // Warm, as the admin keeps it.
		$html = do_shortcode( '[vocalstack_player id="' . $this->transcribed_file() . '"]' );
		$this->assertStringContainsString( 'data-part="language"', $html );
		$this->assertStringContainsString( '<option value="es" data-voice="1">', $html );
		$this->assertStringContainsString( 'data-voice="0"', $html );
		$this->assertStringNotContainsString( 'value="en"', $html );
	}

	public function test_a_page_never_waits_on_vocalstack_for_the_language_list(): void {
		$id   = $this->transcribed_file();
		$html = do_shortcode( "[vocalstack_player id=\"$id\"]" );

		$this->assertSame( array(), $this->http->sent, 'Rendering asked VocalStack nothing.' );
		$this->assertStringContainsString( '<option value="es" data-voice="0">', $html, 'Codes stand in until the list is cached.' );
		$this->assertNotFalse( wp_next_scheduled( Languages::REFRESH_HOOK ) );
	}

	public function test_no_selector_for_a_file_vocalstack_has_not_transcribed(): void {
		$id = self::factory()->attachment->create_object(
			array(
				'file'           => 'plain.mp3',
				'post_mime_type' => 'audio/mpeg',
			)
		);
		$this->assertStringNotContainsString( 'data-part="language"', do_shortcode( "[vocalstack_player id=\"$id\"]" ) );
	}

	public function test_the_live_backlog_comes_in_the_listeners_language(): void {
		$this->http->on(
			'GET',
			'/v1/recordings/rec_live/transcript',
			200,
			array(
				'lastSeq'   => 4,
				'sentences' => array(
					array( 'sentenceId' => 1, 'start' => 0, 'end' => 1, 'speaker' => 0, 'text' => 'Hello.', 'seqs' => array( 3, 4 ), 'translations' => array( 'es' => 'Hola.' ) ),
				),
			)
		);
		$request = new \WP_REST_Request( 'GET', '/vocalstack/v1/widgets/player/transcript' );
		$request->set_param(
			'ticket',
			Widgets::ticket(
				'player',
				Widgets::options(
					'player',
					array(
						'source' => 'broadcast',
						'id'     => 'b_1',
					)
				)
			)
		);
		$request->set_param( 'recording', 'rec_live' );
		$request->set_param( 'lang', 'es' );

		$data = rest_get_server()->dispatch( $request )->get_data();

		$this->assertSame( 'Hola.', $data['sentences'][0]['translations']['es'] );
		$this->assertSame( array( 3, 4 ), $data['sentences'][0]['seqs'] );
		$this->assertStringContainsString( 'lang=es', end( $this->http->sent )['query'] );
		$this->assertArrayNotHasKey( 'authorization', end( $this->http->sent )['headers'] );
	}
}
