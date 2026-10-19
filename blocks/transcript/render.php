<?php
/**
 * Server render for vocalstack/transcript.
 *
 * @package VocalStack
 *
 * @var array<string, mixed> $attributes The block's attributes.
 */

defined( 'ABSPATH' ) || exit;

echo \VocalStack\WP\Front\Transcript::render( $attributes, get_block_wrapper_attributes( array( 'class' => 'vocalstack-transcript' ) ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- Escaped while built.
