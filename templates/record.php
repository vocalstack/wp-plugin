<?php
/**
 * The record widget.
 *
 * Override: copy to yourtheme/vocalstack/record.php. Keep the root's
 * attributes and the `data-part` attributes the script looks for: source,
 * device, toggle, toggle-label, timer, meter, status, transcript.
 *
 * @package VocalStack
 *
 * @var array<string, mixed> $args {
 *     @type string $attributes  The root's attributes, escaped.
 *     @type array  $options     The widget's options (`title`, `label`, …).
 *     @type bool   $allowed     Whether the current visitor may record.
 *     @type string $login       The login URL for a visitor, or ''.
 *     @type array  $sources     Each: `value`, `kind` (mic, tab, stream), `label`.
 *     @type int    $max_minutes The longest recording, in minutes.
 * }
 */

defined( 'ABSPATH' ) || exit;

$vocalstack_label = '' !== (string) $args['options']['label'] ? (string) $args['options']['label'] : __( 'Start recording', 'vocalstack' );
$vocalstack_id    = wp_unique_id( 'vocalstack-record-' );
?>
<div <?php echo $args['attributes']; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Built and escaped by the renderer. ?>>
	<?php if ( '' !== (string) $args['options']['title'] ) : ?>
		<p class="vocalstack-record__title"><?php echo esc_html( $args['options']['title'] ); ?></p>
	<?php endif; ?>

	<?php if ( empty( $args['allowed'] ) ) : ?>
		<p class="vocalstack-record__notice">
			<?php if ( '' !== $args['login'] ) : ?>
				<?php
				printf(
					/* translators: %s: "log in" link */
					esc_html__( 'Please %s to record.', 'vocalstack' ),
					'<a href="' . esc_url( $args['login'] ) . '">' . esc_html__( 'log in', 'vocalstack' ) . '</a>'
				);
				?>
			<?php else : ?>
				<?php esc_html_e( 'Recording isn’t available for your account.', 'vocalstack' ); ?>
			<?php endif; ?>
		</p>
	<?php else : ?>
		<div class="vocalstack-record__controls">
			<?php if ( count( $args['sources'] ) > 1 ) : ?>
				<label class="vocalstack-record__field" for="<?php echo esc_attr( $vocalstack_id ); ?>-source">
					<span class="vocalstack-record__field-label"><?php esc_html_e( 'Audio source', 'vocalstack' ); ?></span>
					<select id="<?php echo esc_attr( $vocalstack_id ); ?>-source" class="vocalstack-record__select" data-part="source">
						<?php foreach ( $args['sources'] as $vocalstack_source ) : ?>
							<option value="<?php echo esc_attr( $vocalstack_source['value'] ); ?>" data-kind="<?php echo esc_attr( $vocalstack_source['kind'] ); ?>"><?php echo esc_html( $vocalstack_source['label'] ); ?></option>
						<?php endforeach; ?>
					</select>
				</label>
			<?php else : ?>
				<input type="hidden" data-part="source" value="<?php echo esc_attr( $args['sources'][0]['value'] ?? 'mic' ); ?>" data-kind="<?php echo esc_attr( $args['sources'][0]['kind'] ?? 'mic' ); ?>">
			<?php endif; ?>
			<label class="vocalstack-record__field" for="<?php echo esc_attr( $vocalstack_id ); ?>-device" data-part="device-field" hidden>
				<span class="vocalstack-record__field-label"><?php esc_html_e( 'Microphone', 'vocalstack' ); ?></span>
				<select id="<?php echo esc_attr( $vocalstack_id ); ?>-device" class="vocalstack-record__select" data-part="device"></select>
			</label>
			<button type="button" class="vocalstack-button vocalstack-button--record vocalstack-record__toggle" data-part="toggle" aria-pressed="false">
				<span class="vocalstack-record__dot" aria-hidden="true"></span>
				<span data-part="toggle-label" data-start-label="<?php echo esc_attr( $vocalstack_label ); ?>"><?php echo esc_html( $vocalstack_label ); ?></span>
			</button>
			<span class="vocalstack-record__timer" data-part="timer" hidden></span>
		</div>
		<div class="vocalstack-record__meter" data-part="meter" hidden><span class="vocalstack-record__level"></span></div>
		<p class="vocalstack-record__status" data-part="status" role="status" aria-live="polite">
			<?php
			if ( $args['max_minutes'] > 0 ) {
				/* translators: %d: minutes */
				echo esc_html( sprintf( _n( 'Record up to %d minute. The transcript appears as you speak.', 'Record up to %d minutes. The transcript appears as you speak.', $args['max_minutes'], 'vocalstack' ), $args['max_minutes'] ) );
			}
			?>
		</p>
		<div class="vocalstack-transcript vocalstack-record__transcript" data-part="transcript" aria-label="<?php esc_attr_e( 'Transcript', 'vocalstack' ); ?>" hidden></div>
		<p class="vocalstack-sr-only" data-part="announce" aria-live="polite"></p>
	<?php endif; ?>
</div>
