<?php
/**
 * The public widgets: shortcodes, blocks, assets.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Front;

use VocalStack\WP\Settings;

use VocalStack\WP\Languages;

use VocalStack\WP\Media;
use VocalStack\WP\Text;
use VocalStack\WP\Widgets\PlayerRoutes;
use VocalStack\WP\Widgets\Policy;
use VocalStack\WP\Widgets\Templates;
use VocalStack\WP\Widgets\Widgets as Schema;

defined( 'ABSPATH' ) || exit;

/**
 * `[vocalstack_player]`, `[vocalstack_record]` and `[vocalstack_upload]`, and
 * the `vocalstack/player|record|upload` blocks, all render through render():
 * the options are normalised by the widget schema, signed into a ticket, and
 * handed to the widget's template (which a theme can override, see
 * Templates). The browser code reads its configuration from the root's
 * `data-vocalstack` attribute.
 *
 * Styles: one stylesheet per widget on top of a shared base, enqueued only
 * when a widget renders. Return false from `vocalstack_load_styles` to load
 * none and style the widgets from the theme.
 */
final class Widgets {

	const TYPES = array( 'player', 'record', 'upload' );

	/**
	 * Hooks.
	 */
	public static function register(): void {
		foreach ( self::TYPES as $type ) {
			add_shortcode( "vocalstack_{$type}", fn( $atts ) => self::shortcode( $type, $atts ) );
		}
		add_action( 'init', array( self::class, 'register_assets' ), 5 );
		add_action( 'init', array( self::class, 'register_blocks' ) );
	}

	/**
	 * Register the widgets' scripts and styles (enqueued when a widget renders).
	 */
	public static function register_assets(): void {
		$styles = self::styles_enabled();
		foreach ( array_merge( array( 'base' ), self::TYPES ) as $name ) {
			$asset_file = VOCALSTACK_DIR . "build/widgets/{$name}.asset.php";
			if ( ! is_readable( $asset_file ) ) {
				continue; // Not built: run `npm run build`.
			}
			$asset = require $asset_file;
			if ( 'base' !== $name ) {
				wp_register_script( "vocalstack-widget-{$name}", VOCALSTACK_URL . "build/widgets/{$name}.js", $asset['dependencies'], $asset['version'], array( 'strategy' => 'defer' ) );
				wp_set_script_translations( "vocalstack-widget-{$name}", 'vocalstack' );
			}
			if ( $styles && is_readable( VOCALSTACK_DIR . "build/widgets/{$name}.css" ) ) {
				wp_register_style( "vocalstack-widget-{$name}", VOCALSTACK_URL . "build/widgets/{$name}.css", 'base' === $name ? array() : array( 'vocalstack-widget-base' ), $asset['version'] );
				wp_style_add_data( "vocalstack-widget-{$name}", 'rtl', 'replace' );
			}
		}
	}

	/**
	 * Register the blocks from their built block.json files.
	 */
	public static function register_blocks(): void {
		foreach ( self::TYPES as $type ) {
			$dir = VOCALSTACK_DIR . "build/blocks/{$type}";
			if ( is_readable( "{$dir}/block.json" ) ) {
				register_block_type(
					$dir,
					array(
						'render_callback' => fn( $attributes ) => self::render( $type, (array) $attributes, get_block_wrapper_attributes( array( 'class' => "vocalstack-widget vocalstack-{$type}" ) ) ),
					)
				);
			}
		}
	}

	/**
	 * Whether the plugin's widget CSS loads.
	 */
	public static function styles_enabled(): bool {
		/**
		 * Filters whether the widgets' stylesheets load. Return false to style
		 * the widgets entirely from the theme.
		 *
		 * @param bool $load True by default.
		 */
		return (bool) apply_filters( 'vocalstack_load_styles', true );
	}

	/**
	 * A widget's shortcode.
	 *
	 * @param string                       $type Widget type.
	 * @param array<string, string>|string $atts Attributes.
	 */
	public static function shortcode( string $type, $atts ): string {
		$atts  = is_array( $atts ) ? $atts : array();
		$class = 'vocalstack-widget vocalstack-' . $type;
		if ( ! empty( $atts['style'] ) ) {
			$class .= ' is-style-' . sanitize_html_class( (string) $atts['style'] );
		}
		if ( ! empty( $atts['class'] ) ) {
			$class .= ' ' . implode( ' ', array_map( 'sanitize_html_class', explode( ' ', (string) $atts['class'] ) ) );
		}
		return self::render( $type, $atts, 'class="' . esc_attr( $class ) . '"' );
	}

	/**
	 * Render a widget.
	 *
	 * @param string               $type       `player`, `record` or `upload`.
	 * @param array<string, mixed> $attributes Shortcode or block attributes.
	 * @param string               $wrapper    The root's attributes (at least its class).
	 */
	public static function render( string $type, array $attributes, string $wrapper ): string {
		if ( ! in_array( $type, self::TYPES, true ) ) {
			return '';
		}
		$options = Schema::options( $type, $attributes );
		$config  = array(
			'type'   => $type,
			'ticket' => Schema::ticket( $type, $options ),
			'rest'   => esc_url_raw( rest_url( 'vocalstack/v1/' ) ),
			'nonce'  => wp_create_nonce( 'wp_rest' ),
			'socket' => PlayerRoutes::socket_base(),
		);
		$args    = array(
			'type'    => $type,
			'options' => $options,
		);

		if ( 'player' === $type ) {
			$args   += self::player_args( $options );
			$config += array(
				'source'     => $options['source'],
				'timestamps' => (bool) $options['timestamps'],
				'speakers'   => (bool) $options['speakers'],
				'transcript' => (bool) $options['transcript'],
			);
			if ( 'media' === $options['source'] && empty( $args['media'] ) ) {
				return '';
			}
			// Listening languages: a Media Library file needs its VocalStack transcript to be translated.
			$translatable      = 'media' !== $options['source'] || '' !== Media::recording_id( (int) $options['id'] );
			$args['languages'] = $translatable ? Languages::offered( $options, false ) : array();
			$config['api']     = Settings::api_url();
			$config['voices']  = array_values( array_column( array_filter( $args['languages'], fn( $l ) => ! empty( $l['voice'] ) ), 'code' ) );
		} else {
			$limits          = Policy::effective( array( 'type' => $type ) + $options );
			$args['allowed'] = Policy::may_use( $limits );
			$args['login']   = is_user_logged_in() ? '' : wp_login_url( (string) get_permalink() );
			if ( 'record' === $type ) {
				$args['sources']      = self::record_sources( (array) $options['sources'] );
				$args['max_minutes']  = (int) $limits['maxRecordMinutes'];
				$config['sources']    = array_column( $args['sources'], 'value' );
				$config['maxMinutes'] = (int) $limits['maxRecordMinutes'];
			} else {
				$ceiling              = (int) $limits['maxUploadMb'] * MB_IN_BYTES;
				$max                  = min( $ceiling > 0 ? $ceiling : PHP_INT_MAX, (int) wp_max_upload_size() );
				$args['max_bytes']    = $max;
				$args['accept']       = self::accept( (string) $options['accept'] );
				$config['maxBytes']   = $max;
				$config['accept']     = $args['accept'];
				$config['transcript'] = (bool) $options['transcript'];
			}
		}

		self::enqueue( $type );
		$args['attributes'] = $wrapper . ' data-vocalstack="' . esc_attr( (string) wp_json_encode( $config ) ) . '"';
		/**
		 * Filters a widget's template variables before it renders.
		 *
		 * @param array<string, mixed> $args The template's `$args`.
		 * @param string               $type Widget type.
		 */
		$args = (array) apply_filters( 'vocalstack_widget_args', $args, $type );
		return Templates::render( $type, $args );
	}

	/**
	 * Enqueue a widget's script and styles.
	 *
	 * @param string $type Widget type.
	 */
	public static function enqueue( string $type ): void {
		wp_enqueue_script( "vocalstack-widget-{$type}" );
		if ( self::styles_enabled() ) {
			wp_enqueue_style( "vocalstack-widget-{$type}" );
		}
	}

	/**
	 * The player's server-side data: a Media Library file and its transcript.
	 *
	 * @param array<string, mixed> $options The player's options.
	 * @return array<string, mixed>
	 */
	private static function player_args( array $options ): array {
		if ( 'media' !== $options['source'] ) {
			return array( 'title' => (string) $options['title'] );
		}
		$id = (int) $options['id'];
		if ( ! $id || ! Media::is_transcribable( $id ) || ! Transcript::is_viewable( $id ) ) {
			return array();
		}
		$sentences = Media::sentences( $id );
		$text      = (string) get_post_meta( $id, Media::TRANSCRIPT, true );
		$timed     = $sentences && Text::plain( $sentences ) === $text;
		$title     = (string) $options['title'];
		return array(
			'title'      => '' !== $title ? $title : get_the_title( $id ),
			'media'      => array(
				'id'   => $id,
				'url'  => (string) wp_get_attachment_url( $id ),
				'tag'  => str_starts_with( (string) get_post_mime_type( $id ), 'video/' ) ? 'video' : 'audio',
				'mime' => (string) get_post_mime_type( $id ),
			),
			'transcript' => $options['transcript'] ? array(
				'timed'      => $timed,
				'paragraphs' => $timed ? self::paragraphs( $sentences, $id, (bool) $options['speakers'] ) : array(),
				'text'       => $timed ? '' : $text,
				'timestamps' => (bool) $options['timestamps'],
			) : null,
		);
	}

	/**
	 * Timed sentences grouped into paragraphs, each with its speaker's name.
	 *
	 * @param list<array<string, mixed>> $sentences Timed sentences.
	 * @param int                        $id        Attachment ID.
	 * @param bool                       $speakers  Whether to name speakers.
	 * @return list<array{speaker: string, start: float, sentences: list<array<string, mixed>>}>
	 */
	public static function paragraphs( array $sentences, int $id, bool $speakers ): array {
		$named = $speakers && count( array_unique( array_column( $sentences, 'speaker' ) ) ) > 1;
		$out   = array();
		$last  = null;
		foreach ( Text::paragraphs( $sentences ) as $paragraph ) {
			$speaker = (int) $paragraph[0]['speaker'];
			// Name the speaker when it changes, not on every pause.
			$changed = $speaker !== $last;
			$last    = $speaker;
			/* translators: %d: speaker number, from 1. */
			$label = $named && $changed && $speaker >= 0 ? (string) apply_filters( 'vocalstack_speaker_label', sprintf( __( 'Speaker %d', 'vocalstack' ), $speaker + 1 ), $speaker, $id ) : '';
			$out[] = array(
				'speaker'   => $label,
				'start'     => (float) $paragraph[0]['start'],
				'sentences' => $paragraph,
			);
		}
		return $out;
	}

	/**
	 * The record widget's sources, labelled.
	 *
	 * @param array<int, string> $sources From the options.
	 * @return list<array{value: string, label: string, kind: string}>
	 */
	private static function record_sources( array $sources ): array {
		$out = array();
		foreach ( $sources as $source ) {
			if ( 'mic' === $source ) {
				$out[] = array(
					'value' => 'mic',
					'kind'  => 'mic',
					'label' => __( 'Microphone', 'vocalstack' ),
				);
			} elseif ( 'tab' === $source ) {
				$out[] = array(
					'value' => 'tab',
					'kind'  => 'tab',
					'label' => __( 'Browser tab or screen audio', 'vocalstack' ),
				);
			} elseif ( str_starts_with( $source, 'stream:' ) ) {
				$host  = (string) wp_parse_url( substr( $source, 7 ), PHP_URL_HOST );
				$out[] = array(
					'value' => $source,
					'kind'  => 'stream',
					/* translators: %s: the stream's host name */
					'label' => sprintf( __( 'Live stream (%s)', 'vocalstack' ), $host ),
				);
			}
		}
		return $out;
	}

	/**
	 * An `accept` attribute for the upload widget's file input.
	 *
	 * @param string $kinds `audio,video`, `audio` or `video`.
	 */
	private static function accept( string $kinds ): string {
		$out = array();
		foreach ( array_map( 'trim', explode( ',', $kinds ) ) as $kind ) {
			if ( in_array( $kind, array( 'audio', 'video' ), true ) ) {
				$out[] = $kind . '/*';
			}
		}
		return $out ? implode( ',', $out ) : 'audio/*,video/*';
	}
}
