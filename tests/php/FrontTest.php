<?php
/**
 * The shortcode, the block and the captions track.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Tests;

use VocalStack\WP\Media;

final class FrontTest extends TestCase {

	public function test_shortcode_renders_timed_sentences_and_speakers(): void {
		$id = $this->audio();
		Media::save_transcript( $id, $this->vs->transcript );

		$html = do_shortcode( "[vocalstack_transcript id=\"$id\"]" );

		$this->assertStringContainsString( 'class="vocalstack-transcript"', $html );
		$this->assertStringContainsString( 'data-start="2.1"', $html );
		$this->assertStringContainsString( 'Speaker 2', $html );
		$this->assertStringNotContainsString( '<audio', $html );
	}

	public function test_shortcode_with_a_player(): void {
		$id = $this->audio();
		Media::save_transcript( $id, $this->vs->transcript );
		$this->assertStringContainsString( '<audio', do_shortcode( "[vocalstack_transcript id=\"$id\" player=\"1\"]" ) );
	}

	public function test_an_edited_transcript_renders_as_plain_text(): void {
		$id = $this->audio();
		Media::save_transcript( $id, $this->vs->transcript );
		update_post_meta( $id, Media::TRANSCRIPT, 'Edited <b>text</b>.' );

		$html = do_shortcode( "[vocalstack_transcript id=\"$id\"]" );

		$this->assertStringNotContainsString( 'data-start', $html );
		$this->assertStringContainsString( 'Edited &lt;b&gt;text&lt;/b&gt;.', $html );
	}

	public function test_nothing_renders_without_a_transcript(): void {
		$this->assertSame( '', do_shortcode( '[vocalstack_transcript id="' . $this->audio() . '"]' ) );
	}

	public function test_video_blocks_get_a_captions_track(): void {
		$id = $this->audio( 'video/mp4' );
		Media::save_transcript( $id, $this->vs->transcript );

		$html = do_blocks( '<!-- wp:video {"id":' . $id . '} --><figure class="wp-block-video"><video controls src="x.mp4"></video></figure><!-- /wp:video -->' );

		$this->assertMatchesRegularExpression( '#<track kind="captions" src="[^"]+/vocalstack/v1/captions/' . $id . '" srclang="en"#', $html );
	}

	public function test_a_speaker_is_named_once_until_someone_else_speaks(): void {
		$id = $this->audio();
		Media::save_transcript(
			$id,
			array(
				'sentences' => array(
					array( 'start' => 0.0, 'end' => 1.0, 'speaker' => 0, 'text' => 'One.' ),
					array( 'start' => 9.0, 'end' => 10.0, 'speaker' => 0, 'text' => 'After a pause.' ),
					array( 'start' => 10.5, 'end' => 11.0, 'speaker' => 1, 'text' => 'Two.' ),
				),
			)
		);

		$html = do_shortcode( "[vocalstack_transcript id=\"$id\"]" );

		$this->assertSame( 1, substr_count( $html, 'Speaker 1' ) );
		$this->assertSame( 1, substr_count( $html, 'Speaker 2' ) );
		$this->assertSame( 3, substr_count( $html, 'vocalstack-transcript__paragraph' ) );
	}
}
