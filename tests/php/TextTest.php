<?php
/**
 * Paragraphs, clock times, WebVTT and public URLs.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Tests;

use VocalStack\WP\Media;
use VocalStack\WP\Text;

final class TextTest extends \WP_UnitTestCase {

	private function s( float $start, float $end, int $speaker, string $text ): array {
		return compact( 'start', 'end', 'speaker', 'text' );
	}

	public function test_paragraphs_break_on_speaker_change_and_long_pause(): void {
		$sentences = array(
			$this->s( 0, 1, 0, 'A.' ),
			$this->s( 1.2, 2, 0, 'B.' ),
			$this->s( 5, 6, 0, 'C.' ), // 3 s pause.
			$this->s( 6.1, 7, 1, 'D.' ), // New speaker.
		);
		$this->assertSame( "A. B.\n\nC.\n\nD.", Text::plain( $sentences ) );
	}

	public function test_clock(): void {
		$this->assertSame( '0:05', Text::clock( 5.9 ) );
		$this->assertSame( '12:01', Text::clock( 721 ) );
		$this->assertSame( '1:00:00', Text::clock( 3600 ) );
	}

	public function test_vtt(): void {
		$vtt = Text::vtt( array( $this->s( 1.5, 3.25, 0, 'Hi --> there' ) ) );
		$this->assertSame( "WEBVTT\n\n1\n00:00:01.500 --> 00:00:03.250\nHi → there\n", $vtt );
	}

	public function test_public_urls(): void {
		$this->assertFalse( Media::is_public_url( 'http://localhost:8888/a.mp3' ) );
		$this->assertFalse( Media::is_public_url( 'http://mysite.test/a.mp3' ) );
		$this->assertFalse( Media::is_public_url( 'http://192.168.1.10/a.mp3' ) );
		$this->assertFalse( Media::is_public_url( 'http://127.0.0.1/a.mp3' ) );
		$this->assertFalse( Media::is_public_url( 'ftp://93.184.215.14/a.mp3' ) );
		$this->assertTrue( Media::is_public_url( 'https://93.184.215.14/a.mp3' ) );
	}
}
