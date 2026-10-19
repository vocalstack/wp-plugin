<?php
/**
 * Rendering the public widgets: tickets, options, templates, styles.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Tests;

use VocalStack\WP\Front\Widgets as Front;
use VocalStack\WP\Media;
use VocalStack\WP\Settings;
use VocalStack\WP\Widgets\Policy;
use VocalStack\WP\Widgets\Ticket;

final class WidgetsRenderTest extends TestCase {

	public function set_up(): void {
		parent::set_up();
		Policy::install();
		Front::register_assets();
	}

	public function tear_down(): void {
		foreach ( array( 'base', 'player', 'record', 'upload' ) as $name ) {
			wp_dequeue_style( "vocalstack-widget-{$name}" );
			wp_dequeue_script( "vocalstack-widget-{$name}" );
		}
		parent::tear_down();
	}

	/**
	 * The `data-vocalstack` configuration in a widget's HTML.
	 *
	 * @param string $html Rendered widget.
	 * @return array<string, mixed>
	 */
	private function config( string $html ): array {
		$this->assertMatchesRegularExpression( '/data-vocalstack="([^"]+)"/', $html );
		preg_match( '/data-vocalstack="([^"]+)"/', $html, $m );
		return json_decode( html_entity_decode( $m[1] ), true );
	}

	public function test_the_record_shortcode_signs_its_options(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );

		$html   = do_shortcode( '[vocalstack_record sources="mic,tab" max_record_minutes="5" language="ro" title="Tell us"]' );
		$config = $this->config( $html );

		$this->assertSame( 'record', $config['type'] );
		$this->assertSame( array( 'mic', 'tab' ), $config['sources'] );
		$this->assertSame( 5, $config['maxMinutes'] );
		$signed = Ticket::verify( $config['ticket'] );
		$this->assertSame( 'record', $signed['type'] );
		$this->assertSame( 'ro', $signed['language'] );
		$this->assertSame( 5, $signed['maxRecordMinutes'] );
		$this->assertStringContainsString( 'data-part="toggle"', $html );
		$this->assertStringContainsString( 'Tell us', $html );
		$this->assertStringNotContainsString( 'vs_key', $html );
	}

	public function test_a_visitor_sees_log_in_instead_of_a_record_button(): void {
		wp_set_current_user( 0 );
		Policy::update( array( 'access' => 'everyone' ) );

		$html = do_shortcode( '[vocalstack_record]' );

		$this->assertStringNotContainsString( 'data-part="toggle"', $html );
		$this->assertStringContainsString( 'wp-login.php', $html );
		$this->assertStringContainsString( 'log in', $html );
	}

	public function test_a_visitor_may_upload_when_the_site_allows_everyone(): void {
		wp_set_current_user( 0 );
		Policy::update(
			array(
				'access'      => 'everyone',
				'maxUploadMb' => 5,
			)
		);

		$html   = do_shortcode( '[vocalstack_upload accept="audio"]' );
		$config = $this->config( $html );

		$this->assertStringContainsString( 'data-part="input"', $html );
		$this->assertSame( 'audio/*', $config['accept'] );
		$this->assertLessThanOrEqual( 5 * MB_IN_BYTES, $config['maxBytes'] );
	}

	public function test_a_media_player_renders_the_file_and_its_timed_transcript(): void {
		$id = $this->audio();
		Media::save_transcript( $id, $this->vs->transcript );

		$html = do_shortcode( "[vocalstack_player id=\"$id\" style=\"card\"]" );

		$this->assertStringContainsString( 'is-style-card', $html );
		$this->assertMatchesRegularExpression( '/<audio[^>]+data-part="media"[^>]+src="[^"]+\.mp3"/', $html );
		$this->assertStringContainsString( 'data-start="2.1"', $html );
		$this->assertStringContainsString( 'Speaker 2', $html );
	}

	public function test_a_media_player_without_a_file_renders_nothing(): void {
		$this->assertSame( '', do_shortcode( '[vocalstack_player id="999999"]' ) );
	}

	public function test_a_recording_player_loads_its_source_in_the_browser(): void {
		$html   = do_shortcode( '[vocalstack_player source="recording" id="tr_1" timestamps="0"]' );
		$config = $this->config( $html );
		$this->assertSame( 'recording', $config['source'] );
		$this->assertFalse( $config['timestamps'] );
		$this->assertSame( 'tr_1', Ticket::verify( $config['ticket'] )['id'] );
		$this->assertStringContainsString( 'data-part="status"', $html );
	}

	public function test_styles_load_only_when_a_widget_renders(): void {
		$this->assertFalse( wp_style_is( 'vocalstack-widget-upload', 'enqueued' ) );
		do_shortcode( '[vocalstack_upload]' );
		$this->assertTrue( wp_style_is( 'vocalstack-widget-upload', 'enqueued' ) );
		$this->assertTrue( wp_script_is( 'vocalstack-widget-upload', 'enqueued' ) );
		$this->assertContains( 'vocalstack-widget-base', wp_styles()->registered['vocalstack-widget-upload']->deps );
	}

	public function test_the_filter_turns_the_styles_off(): void {
		add_filter( 'vocalstack_load_styles', '__return_false' );
		do_shortcode( '[vocalstack_upload]' );
		$this->assertFalse( wp_style_is( 'vocalstack-widget-upload', 'enqueued' ) );
		$this->assertTrue( wp_script_is( 'vocalstack-widget-upload', 'enqueued' ), 'The script still loads.' );
	}

	public function test_a_theme_can_override_a_widget_template(): void {
		$dir = get_temp_dir() . 'vocalstack-theme-' . wp_generate_password( 6, false );
		wp_mkdir_p( "$dir/vocalstack" );
		file_put_contents( "$dir/vocalstack/upload.php", '<section <?php echo $args["attributes"]; ?>>theme upload</section>' );
		$point = fn() => $dir;
		add_filter( 'stylesheet_directory', $point );
		add_filter( 'template_directory', $point );
		try {
			$html = do_shortcode( '[vocalstack_upload]' );
			$this->assertStringStartsWith( '<section class="vocalstack-widget vocalstack-upload"', $html );
			$this->assertStringContainsString( 'theme upload', $html );
			$this->assertSame( 'upload', $this->config( $html )['type'] );
		} finally {
			unlink( "$dir/vocalstack/upload.php" );
			rmdir( "$dir/vocalstack" );
			rmdir( $dir );
		}
	}

	public function test_blocks_render_through_the_same_renderer(): void {
		$html = do_blocks( '<!-- wp:vocalstack/upload {"title":"Send us audio","className":"is-style-minimal"} /-->' );
		$this->assertStringContainsString( 'wp-block-vocalstack-upload', $html );
		$this->assertStringContainsString( 'is-style-minimal', $html );
		$this->assertStringContainsString( 'Send us audio', $html );
		$this->assertSame( 'upload', $this->config( $html )['type'] );
	}

	public function test_block_attributes_in_camel_case_reach_the_ticket(): void {
		wp_set_current_user( self::factory()->user->create( array( 'role' => 'subscriber' ) ) );
		$html = do_blocks( '<!-- wp:vocalstack/record {"maxRecordMinutes":3,"sources":"mic"} /-->' );
		$this->assertSame( 3, Ticket::verify( $this->config( $html )['ticket'] )['maxRecordMinutes'] );
	}

	public function test_without_a_key_widgets_still_render(): void {
		Settings::set_api_key( '' );
		$this->assertStringContainsString( 'vocalstack-upload', do_shortcode( '[vocalstack_upload]' ) );
	}
}
