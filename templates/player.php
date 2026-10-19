<?php
/**
 * The player widget.
 *
 * Override: copy to yourtheme/vocalstack/player.php. Keep the root's
 * attributes (`$args['attributes']`) and the `data-part` attributes: the
 * script finds the media, status, live controls and transcript by them.
 *
 * @package VocalStack
 *
 * @var array<string, mixed> $args {
 *     @type string     $attributes The root's attributes, escaped.
 *     @type array      $options    The widget's options (`source`: media, recording or broadcast).
 *     @type string     $title      A heading, or ''.
 *     @type array|null $media      For a Media Library file: `url`, `tag` (audio or video), `mime`.
 *     @type array|null $transcript For a Media Library file: see transcript.php.
 *     @type array      $languages  Listening languages offered: `code`, `name`, `native`, `flag`, `voice`.
 * }
 */

defined( 'ABSPATH' ) || exit;

$vocalstack_source = (string) $args['options']['source'];
?>
<div <?php echo $args['attributes']; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Built and escaped by the renderer. ?>>
	<?php if ( '' !== (string) ( $args['title'] ?? '' ) ) : ?>
		<p class="vocalstack-player__title"><?php echo esc_html( $args['title'] ); ?></p>
	<?php endif; ?>

	<?php if ( 'media' === $vocalstack_source && ! empty( $args['media'] ) ) : ?>
		<?php if ( 'video' === $args['media']['tag'] ) : ?>
			<video class="vocalstack-player__media" data-part="media" controls preload="metadata" playsinline src="<?php echo esc_url( $args['media']['url'] ); ?>"></video>
		<?php else : ?>
			<audio class="vocalstack-player__media" data-part="media" controls preload="metadata" src="<?php echo esc_url( $args['media']['url'] ); ?>"></audio>
		<?php endif; ?>
	<?php else : ?>
		<p class="vocalstack-player__status" data-part="status" role="status"><?php esc_html_e( 'Loading…', 'vocalstack' ); ?></p>
		<?php if ( 'broadcast' === $vocalstack_source ) : ?>
			<div class="vocalstack-player__live" data-part="live" hidden>
				<span class="vocalstack-player__badge"><?php esc_html_e( 'Live', 'vocalstack' ); ?></span>
				<button type="button" class="vocalstack-button vocalstack-player__listen" data-part="listen" aria-pressed="false" hidden><?php esc_html_e( 'Listen live', 'vocalstack' ); ?></button>
				<a class="vocalstack-player__share" data-part="share" target="_blank" rel="noopener" hidden><?php esc_html_e( 'Open the live page', 'vocalstack' ); ?></a>
			</div>
		<?php endif; ?>
		<audio class="vocalstack-player__media" data-part="media" controls preload="none" hidden></audio>
	<?php endif; ?>

	<?php if ( ! empty( $args['languages'] ) ) : ?>
		<div class="vocalstack-player__languages" data-part="languages">
			<label class="vocalstack-player__language">
				<span class="vocalstack-player__language-label"><?php esc_html_e( 'Listen in', 'vocalstack' ); ?></span>
				<select class="vocalstack-player__language-select" data-part="language">
					<option value=""><?php esc_html_e( 'Original', 'vocalstack' ); ?></option>
					<?php foreach ( $args['languages'] as $vocalstack_language ) : ?>
						<option value="<?php echo esc_attr( $vocalstack_language['code'] ); ?>" data-voice="<?php echo $vocalstack_language['voice'] ? '1' : '0'; ?>">
							<?php echo esc_html( trim( $vocalstack_language['flag'] . ' ' . $vocalstack_language['native'] ) ); ?>
						</option>
					<?php endforeach; ?>
				</select>
			</label>
			<button type="button" class="vocalstack-button vocalstack-player__speak" data-part="speak" aria-pressed="false" hidden><?php esc_html_e( 'Play', 'vocalstack' ); ?></button>
			<span class="vocalstack-player__language-status" data-part="language-status" role="status"></span>
		</div>
	<?php endif; ?>

	<?php if ( ! empty( $args['options']['transcript'] ) ) : ?>
		<div class="vocalstack-transcript vocalstack-player__transcript" data-part="transcript" aria-label="<?php esc_attr_e( 'Transcript', 'vocalstack' ); ?>">
			<?php
			if ( ! empty( $args['transcript'] ) ) {
				echo \VocalStack\WP\Widgets\Templates::render( 'transcript', $args['transcript'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- The partial escapes.
			}
			?>
		</div>
		<p class="vocalstack-sr-only" data-part="announce" aria-live="polite"></p>
	<?php endif; ?>
</div>
