<?php
/**
 * A transcript: paragraphs of timed sentences, or plain text.
 *
 * Override: copy to yourtheme/vocalstack/transcript.php. The widgets' scripts
 * find sentences by `data-start`/`data-end`, and timestamps by
 * `data-part="time"`; keep those attributes.
 *
 * @package VocalStack
 *
 * @var array<string, mixed> $args {
 *     @type bool   $timed      Whether the sentences carry timings.
 *     @type array  $paragraphs Each: `speaker` (name or ''), `start`, `sentences` (`start`, `end`, `text`).
 *     @type string $text       The plain text, when not timed.
 *     @type bool   $timestamps Whether to show a timestamp per paragraph.
 * }
 */

defined( 'ABSPATH' ) || exit;

if ( empty( $args['timed'] ) ) {
	echo wp_kses_post( wpautop( esc_html( (string) ( $args['text'] ?? '' ) ) ) );
	return;
}

foreach ( (array) $args['paragraphs'] as $vocalstack_paragraph ) : ?>
	<p class="vocalstack-transcript__paragraph">
		<?php if ( '' !== $vocalstack_paragraph['speaker'] ) : ?>
			<span class="vocalstack-transcript__speaker"><?php echo esc_html( $vocalstack_paragraph['speaker'] ); ?></span>
		<?php endif; ?>
		<?php if ( ! empty( $args['timestamps'] ) ) : ?>
			<button type="button" class="vocalstack-transcript__time" data-part="time" data-start="<?php echo esc_attr( (string) $vocalstack_paragraph['start'] ); ?>"><?php echo esc_html( \VocalStack\WP\Text::clock( (float) $vocalstack_paragraph['start'] ) ); ?></button>
		<?php endif; ?>
		<?php foreach ( $vocalstack_paragraph['sentences'] as $vocalstack_sentence ) : ?>
			<span class="vocalstack-transcript__sentence" data-start="<?php echo esc_attr( (string) $vocalstack_sentence['start'] ); ?>" data-end="<?php echo esc_attr( (string) $vocalstack_sentence['end'] ); ?>"><?php echo esc_html( $vocalstack_sentence['text'] ); ?></span>
		<?php endforeach; ?>
	</p>
	<?php
endforeach;
