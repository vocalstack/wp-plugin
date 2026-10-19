<?php
/**
 * The Transcribe panel on an attachment's edit screen, and a status line in the media modal.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Admin;

use VocalStack\WP\Assets;
use VocalStack\WP\Media;
use VocalStack\WP\Settings;

defined( 'ABSPATH' ) || exit;

/**
 * The panel is a React app (assets/src/media-panel) mounted in a meta box.
 */
final class MediaPanel {

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( 'add_meta_boxes_attachment', array( self::class, 'meta_box' ) );
		add_filter( 'attachment_fields_to_edit', array( self::class, 'modal_field' ), 10, 2 );
	}

	/**
	 * Add the meta box to audio and video attachments.
	 *
	 * @param \WP_Post $post The attachment.
	 */
	public static function meta_box( \WP_Post $post ): void {
		if ( ! Media::is_transcribable( $post->ID ) ) {
			return;
		}
		add_meta_box( 'vocalstack', __( 'VocalStack transcript', 'vocalstack' ), array( self::class, 'render' ), 'attachment', 'normal', 'high' );
		Assets::enqueue( 'media-panel', self::script_data() );
	}

	/**
	 * The React root.
	 *
	 * @param \WP_Post $post The attachment.
	 */
	public static function render( \WP_Post $post ): void {
		printf( '<div class="vocalstack-media-panel" data-id="%d"></div>', (int) $post->ID );
	}

	/**
	 * What the panel needs to know about the site.
	 *
	 * @return array<string, mixed>
	 */
	public static function script_data(): array {
		return array(
			'connected'   => '' !== Settings::api_key(),
			'settingsUrl' => current_user_can( 'manage_options' ) ? SettingsPage::url() : '',
		);
	}

	/**
	 * In the media modal: the transcript's state and a link to the edit screen.
	 *
	 * @param array<string, array<string, mixed>> $fields The modal's fields.
	 * @param \WP_Post                            $post   The attachment.
	 * @return array<string, array<string, mixed>>
	 */
	public static function modal_field( array $fields, \WP_Post $post ): array {
		if ( ! Media::is_transcribable( $post->ID ) || ! current_user_can( 'edit_post', $post->ID ) ) {
			return $fields;
		}
		$state  = (string) get_post_meta( $post->ID, Media::STATE, true );
		$labels = array(
			''       => __( 'Not transcribed', 'vocalstack' ),
			'done'   => __( 'Transcribed', 'vocalstack' ),
			'failed' => __( 'Failed', 'vocalstack' ),
		);
		$label  = $labels[ $state ] ?? __( 'Transcribing…', 'vocalstack' );
		$link   = '' === $state ? __( 'Transcribe', 'vocalstack' ) : __( 'Open transcript', 'vocalstack' );

		$fields['vocalstack'] = array(
			'label' => __( 'Transcript', 'vocalstack' ),
			'input' => 'html',
			'html'  => sprintf(
				'%s · <a href="%s">%s</a>',
				esc_html( $label ),
				esc_url( get_edit_post_link( $post->ID ) . '#vocalstack' ),
				esc_html( $link )
			),
		);
		return $fields;
	}
}
