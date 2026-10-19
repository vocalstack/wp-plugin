<?php
/**
 * The upload widget.
 *
 * Override: copy to yourtheme/vocalstack/upload.php. Keep the root's
 * attributes and the `data-part` attributes the script looks for: drop,
 * input, progress, progress-bar, progress-label, status, result, media,
 * transcript.
 *
 * @package VocalStack
 *
 * @var array<string, mixed> $args {
 *     @type string $attributes The root's attributes, escaped.
 *     @type array  $options    The widget's options (`title`, `label`, `transcript`, …).
 *     @type bool   $allowed    Whether the current visitor may upload.
 *     @type string $login      The login URL for a visitor, or ''.
 *     @type string $accept     The file input's `accept`.
 *     @type int    $max_bytes  The largest file accepted.
 * }
 */

defined( 'ABSPATH' ) || exit;

$vocalstack_label = '' !== (string) $args['options']['label'] ? (string) $args['options']['label'] : __( 'Choose a file', 'vocalstack' );
$vocalstack_id    = wp_unique_id( 'vocalstack-upload-' );
?>
<div <?php echo $args['attributes']; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Built and escaped by the renderer. ?>>
	<?php if ( '' !== (string) $args['options']['title'] ) : ?>
		<p class="vocalstack-upload__title"><?php echo esc_html( $args['options']['title'] ); ?></p>
	<?php endif; ?>

	<?php if ( empty( $args['allowed'] ) ) : ?>
		<p class="vocalstack-upload__notice">
			<?php if ( '' !== $args['login'] ) : ?>
				<?php
				printf(
					/* translators: %s: "log in" link */
					esc_html__( 'Please %s to upload.', 'vocalstack' ),
					'<a href="' . esc_url( $args['login'] ) . '">' . esc_html__( 'log in', 'vocalstack' ) . '</a>'
				);
				?>
			<?php else : ?>
				<?php esc_html_e( 'Uploading isn’t available for your account.', 'vocalstack' ); ?>
			<?php endif; ?>
		</p>
	<?php else : ?>
		<div class="vocalstack-upload__drop" data-part="drop">
			<input id="<?php echo esc_attr( $vocalstack_id ); ?>" class="vocalstack-upload__input" type="file" accept="<?php echo esc_attr( $args['accept'] ); ?>" data-part="input">
			<p class="vocalstack-upload__prompt">
				<span class="vocalstack-upload__icon" aria-hidden="true"></span>
				<span><?php esc_html_e( 'Drop an audio or video file here, or', 'vocalstack' ); ?></span>
				<label class="vocalstack-button vocalstack-upload__browse" for="<?php echo esc_attr( $vocalstack_id ); ?>"><?php echo esc_html( $vocalstack_label ); ?></label>
			</p>
			<p class="vocalstack-upload__hint">
				<?php
				/* translators: %s: size, such as 64 MB */
				echo esc_html( sprintf( __( 'Up to %s. It will be transcribed automatically.', 'vocalstack' ), size_format( $args['max_bytes'] ) ) );
				?>
			</p>
		</div>
		<div class="vocalstack-upload__progress" data-part="progress" hidden>
			<progress class="vocalstack-upload__bar" data-part="progress-bar" max="100" value="0"></progress>
			<span class="vocalstack-upload__progress-label" data-part="progress-label"></span>
		</div>
		<p class="vocalstack-upload__status" data-part="status" role="status" aria-live="polite"></p>
		<div class="vocalstack-upload__result" data-part="result" hidden>
			<div class="vocalstack-upload__media" data-part="media"></div>
			<?php if ( ! empty( $args['options']['transcript'] ) ) : ?>
				<div class="vocalstack-transcript vocalstack-upload__transcript" data-part="transcript" aria-label="<?php esc_attr_e( 'Transcript', 'vocalstack' ); ?>"></div>
			<?php endif; ?>
		</div>
	<?php endif; ?>
</div>
