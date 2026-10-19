<?php
/**
 * Shared setup: a fake VocalStack, a key, an audio attachment.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Tests;

use VocalStack\WP\Plugin;
use VocalStack\WP\Settings;

/**
 * Every test gets a fresh FakeTranscriber in `$this->vs`.
 */
abstract class TestCase extends \WP_UnitTestCase {

	protected FakeTranscriber $vs;

	public function set_up(): void {
		parent::set_up();
		$this->vs = new FakeTranscriber();
		add_filter( 'vocalstack_transcriber', fn() => $this->vs );
		Plugin::reset_transcriber();
		Settings::set_api_key( 'vs_key_test' );
	}

	public function tear_down(): void {
		Plugin::reset_transcriber();
		parent::tear_down();
	}

	/**
	 * An audio attachment with a file on disk.
	 *
	 * @param string $mime Its type.
	 */
	protected function audio( string $mime = 'audio/mpeg' ): int {
		$upload = wp_upload_bits( 'clip-' . wp_generate_password( 6, false ) . '.mp3', null, 'ID3 fake audio' );
		return self::factory()->attachment->create_object(
			array(
				'file'           => $upload['file'],
				'post_mime_type' => $mime,
				'post_title'     => 'Clip',
			)
		);
	}

	/**
	 * Let refresh() call VocalStack again right away.
	 *
	 * @param int $id Attachment ID.
	 */
	protected function unthrottle( int $id ): void {
		delete_transient( 'vocalstack_checked_' . $id );
	}
}
