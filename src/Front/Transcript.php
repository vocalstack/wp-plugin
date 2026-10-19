<?php
/**
 * Transcripts on the site: the `vocalstack/transcript` block and the
 * `[vocalstack_transcript]` shortcode.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Front;

use VocalStack\WP\Assets;
use VocalStack\WP\Media;
use VocalStack\WP\Text;

defined( 'ABSPATH' ) || exit;

/**
 * Both render through render(). With timed sentences each sentence carries its
 * start time, and the player script (assets/src/player) seeks the media on a
 * click and highlights the sentence being spoken. The media is the block's own
 * player when `player` is on, otherwise the audio or video on the page that
 * plays the same file.
 *
 * Shortcode: `[vocalstack_transcript id="123" player="1" timestamps="1" speakers="1"]`.
 * It also works in the Shortcode widget; block themes use the block.
 */
final class Transcript {

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_shortcode( 'vocalstack_transcript', array( self::class, 'shortcode' ) );
		add_action( 'init', array( self::class, 'register_block' ) );
	}

	/**
	 * Register the block from its built block.json.
	 */
	public static function register_block(): void {
		if ( is_readable( VOCALSTACK_DIR . 'build/blocks/transcript/block.json' ) ) {
			register_block_type( VOCALSTACK_DIR . 'build/blocks/transcript' );
		}
	}

	/**
	 * The shortcode.
	 *
	 * @param array<string, string>|string $atts Attributes.
	 */
	public static function shortcode( $atts ): string {
		$atts = shortcode_atts(
			array(
				'id'         => 0,
				'player'     => '0',
				'timestamps' => '1',
				'speakers'   => '1',
			),
			is_array( $atts ) ? $atts : array(),
			'vocalstack_transcript'
		);
		return self::render(
			array(
				'mediaId'        => (int) $atts['id'],
				'showPlayer'     => filter_var( $atts['player'], FILTER_VALIDATE_BOOLEAN ),
				'showTimestamps' => filter_var( $atts['timestamps'], FILTER_VALIDATE_BOOLEAN ),
				'showSpeakers'   => filter_var( $atts['speakers'], FILTER_VALIDATE_BOOLEAN ),
			)
		);
	}

	/**
	 * The transcript's HTML, or '' when there is none to show.
	 *
	 * @param array{mediaId?: int, showPlayer?: bool, showTimestamps?: bool, showSpeakers?: bool} $args What to show.
	 * @param string                                                                              $wrapper_attributes Extra attributes for the wrapper (from the block).
	 */
	public static function render( array $args, string $wrapper_attributes = '' ): string {
		$id = (int) ( $args['mediaId'] ?? 0 );
		if ( ! $id || ! Media::is_transcribable( $id ) || ! self::is_viewable( $id ) ) {
			return '';
		}
		$text = (string) get_post_meta( $id, Media::TRANSCRIPT, true );
		if ( '' === $text ) {
			return '';
		}
		$sentences = Media::sentences( $id );
		// An edited transcript no longer matches its timings, so it shows as plain text.
		$timed      = $sentences && Text::plain( $sentences ) === $text;
		$speakers   = ! empty( $args['showSpeakers'] ) && $timed && count( array_unique( array_column( $sentences, 'speaker' ) ) ) > 1;
		$timestamps = ! empty( $args['showTimestamps'] ) && $timed;
		$url        = (string) wp_get_attachment_url( $id );

		$html = '';
		if ( ! empty( $args['showPlayer'] ) ) {
			$tag   = str_starts_with( (string) get_post_mime_type( $id ), 'video/' ) ? 'video' : 'audio';
			$html .= sprintf( '<%1$s class="vocalstack-transcript__player" controls preload="metadata" src="%2$s"></%1$s>', $tag, esc_url( $url ) );
		}

		$html .= '<div class="vocalstack-transcript__body">';
		if ( $timed ) {
			$last = null;
			foreach ( Text::paragraphs( $sentences ) as $paragraph ) {
				$first = $paragraph[0];
				$html .= '<p class="vocalstack-transcript__paragraph">';
				// Name the speaker when it changes, not on every pause.
				if ( $speakers && $first['speaker'] !== $last ) {
					$html .= '<span class="vocalstack-transcript__speaker">' . esc_html( self::speaker_label( $first['speaker'], $id ) ) . '</span> ';
				}
				$last = $first['speaker'];
				if ( $timestamps ) {
					$html .= sprintf( '<button type="button" class="vocalstack-transcript__time" data-start="%s">%s</button> ', esc_attr( (string) $first['start'] ), esc_html( Text::clock( $first['start'] ) ) );
				}
				foreach ( $paragraph as $s ) {
					$html .= sprintf( '<span class="vocalstack-transcript__sentence" data-start="%s" data-end="%s">%s</span> ', esc_attr( (string) $s['start'] ), esc_attr( (string) $s['end'] ), esc_html( $s['text'] ) );
				}
				$html .= '</p>';
			}
		} else {
			$html .= wpautop( esc_html( $text ) );
		}
		$html .= '</div>';

		// The block's stylesheet; a shortcode needs it too.
		wp_enqueue_style( 'vocalstack-transcript-style' );
		if ( $timed ) {
			Assets::enqueue( 'player' );
		}
		return sprintf(
			'<div %s data-media="%d" data-src="%s">%s</div>',
			'' !== $wrapper_attributes ? $wrapper_attributes : 'class="vocalstack-transcript"',
			$id,
			esc_url( $url ),
			$html
		);
	}

	/**
	 * Whether visitors may see this attachment's transcript: the same rule as
	 * the attachment itself, which follows the post it is attached to.
	 *
	 * @param int $id Attachment ID.
	 */
	public static function is_viewable( int $id ): bool {
		if ( current_user_can( 'edit_post', $id ) ) {
			return true;
		}
		$parent = (int) wp_get_post_parent_id( $id );
		// Unattached media counts as published (get_post_status() reports `publish`).
		return is_post_publicly_viewable( $parent ? $parent : $id );
	}

	/**
	 * A speaker's name.
	 *
	 * @param int $speaker VocalStack's speaker number, from 0.
	 * @param int $id      Attachment ID.
	 */
	private static function speaker_label( int $speaker, int $id ): string {
		/* translators: %d: speaker number, from 1. */
		$label = sprintf( __( 'Speaker %d', 'vocalstack' ), $speaker + 1 );
		/**
		 * Filters a speaker's name in transcripts, to name the people speaking.
		 *
		 * @param string $label   `Speaker 1`, `Speaker 2`, ….
		 * @param int    $speaker VocalStack's speaker number, from 0.
		 * @param int    $id      Attachment ID.
		 */
		return (string) apply_filters( 'vocalstack_speaker_label', $label, $speaker, $id );
	}
}
