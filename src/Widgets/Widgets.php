<?php
/**
 * The public widgets' configuration: defaults, options, and what is signed.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Widgets;

use VocalStack\WP\Settings;

defined( 'ABSPATH' ) || exit;

/**
 * One description of each widget's options, shared by its shortcode, its
 * block, the admin shortcode generator and the signed ticket.
 *
 * Types: `player`, `record`, `upload` (and `transcript`, which predates them).
 */
final class Widgets {

	/**
	 * Each widget's options with their defaults and kinds (`bool`, `int`, `string`, `enum:a|b`).
	 *
	 * @return array<string, array<string, array{default: mixed, type: string}>>
	 */
	public static function schema(): array {
		$access = 'enum:|everyone|logged_in|roles|nobody';
		return array(
			'player' => array(
				'source'     => array(
					'default' => 'media',
					'type'    => 'enum:media|recording|broadcast',
				),
				'id'         => array(
					'default' => '',
					'type'    => 'string',
				),
				'transcript' => array(
					'default' => true,
					'type'    => 'bool',
				),
				'timestamps' => array(
					'default' => true,
					'type'    => 'bool',
				),
				'speakers'   => array(
					'default' => true,
					'type'    => 'bool',
				),
				'title'      => array(
					'default' => '',
					'type'    => 'string',
				),
				// Listening languages: '' offers the site's list; codes narrow it.
				'languages'  => array(
					'default' => '',
					'type'    => 'string',
				),
			),
			'record' => array(
				'sources'          => array(
					'default' => 'mic',
					'type'    => 'string',
				),
				'title'            => array(
					'default' => '',
					'type'    => 'string',
				),
				'language'         => array(
					'default' => '',
					'type'    => 'string',
				),
				'speakers'         => array(
					'default' => '',
					'type'    => 'enum:|off|auto|on',
				),
				'maxRecordMinutes' => array(
					'default' => 0,
					'type'    => 'int',
				),
				// Recording always needs a logged-in user.
				'access'           => array(
					'default' => '',
					'type'    => 'enum:|logged_in|roles|nobody',
				),
				'roles'            => array(
					'default' => '',
					'type'    => 'string',
				),
				'label'            => array(
					'default' => '',
					'type'    => 'string',
				),
			),
			'upload' => array(
				'title'       => array(
					'default' => '',
					'type'    => 'string',
				),
				'accept'      => array(
					'default' => 'audio,video',
					'type'    => 'string',
				),
				'language'    => array(
					'default' => '',
					'type'    => 'string',
				),
				'transcript'  => array(
					'default' => true,
					'type'    => 'bool',
				),
				'maxUploadMb' => array(
					'default' => 0,
					'type'    => 'int',
				),
				'access'      => array(
					'default' => '',
					'type'    => $access,
				),
				'roles'       => array(
					'default' => '',
					'type'    => 'string',
				),
				'label'       => array(
					'default' => '',
					'type'    => 'string',
				),
			),
		);
	}

	/**
	 * A widget's options, from shortcode or block attributes, with defaults filled
	 * in and every value coerced to its kind. Unknown keys are dropped.
	 *
	 * Attribute names are accepted in camelCase (blocks) or snake_case (shortcodes).
	 *
	 * @param string               $type  Widget type.
	 * @param array<string, mixed> $input Attributes.
	 * @return array<string, mixed>
	 */
	public static function options( string $type, array $input ): array {
		$schema = self::schema()[ $type ] ?? array();
		$normal = array();
		foreach ( $input as $key => $value ) {
			$normal[ lcfirst( str_replace( ' ', '', ucwords( str_replace( array( '_', '-' ), ' ', (string) $key ) ) ) ) ] = $value;
			$normal[ (string) $key ] = $value;
		}
		$out = array();
		foreach ( $schema as $key => $spec ) {
			$value = $normal[ $key ] ?? $normal[ strtolower( $key ) ] ?? $spec['default'];
			if ( 'bool' === $spec['type'] ) {
				$value = is_bool( $value ) ? $value : filter_var( $value, FILTER_VALIDATE_BOOLEAN );
			} elseif ( 'int' === $spec['type'] ) {
				$value = max( 0, (int) $value );
			} elseif ( str_starts_with( $spec['type'], 'enum:' ) ) {
				$allowed = explode( '|', substr( $spec['type'], 5 ) );
				$value   = in_array( (string) $value, $allowed, true ) ? (string) $value : $spec['default'];
			} else {
				$value = sanitize_text_field( (string) $value );
			}
			$out[ $key ] = $value;
		}
		if ( isset( $out['roles'] ) ) {
			$out['roles'] = array_values( array_filter( array_map( 'trim', explode( ',', (string) $out['roles'] ) ) ) );
		}
		if ( isset( $out['sources'] ) ) {
			$out['sources'] = self::record_sources( (string) $out['sources'] );
		}
		return $out;
	}

	/**
	 * The record widget's audio sources: `mic`, `tab`, and `stream:<url>` (the
	 * site owner's stream, which VocalStack pulls).
	 *
	 * @param string $value Comma-separated, such as `mic,tab`.
	 * @return list<string>
	 */
	public static function record_sources( string $value ): array {
		$out = array();
		foreach ( array_filter( array_map( 'trim', explode( ',', $value ) ) ) as $source ) {
			if ( in_array( $source, array( 'mic', 'tab' ), true ) ) {
				$out[] = $source;
			} elseif ( str_starts_with( $source, 'stream:' ) ) {
				// VocalStack's servers fetch the stream, not this site, so only its form is checked here.
				$url = esc_url_raw( substr( $source, 7 ), array( 'http', 'https', 'rtmp', 'rtmps' ) );
				if ( '' !== $url && filter_var( $url, FILTER_VALIDATE_URL ) ) {
					$out[] = 'stream:' . $url;
				}
			}
		}
		return $out ? array_values( array_unique( $out ) ) : array( 'mic' );
	}

	/**
	 * The ticket a widget's browser code sends back: its type and options, signed.
	 *
	 * @param string               $type    Widget type.
	 * @param array<string, mixed> $options From options().
	 */
	public static function ticket( string $type, array $options ): string {
		return Ticket::sign( array( 'type' => $type ) + $options );
	}

	/**
	 * VocalStack settings for a transcription a widget starts.
	 *
	 * @param array<string, mixed> $options The widget's options.
	 * @return array<string, mixed>
	 */
	public static function transcription_settings( array $options ): array {
		$settings = Settings::transcription();
		if ( ! empty( $options['language'] ) ) {
			$settings['spokenLanguage'] = (string) $options['language'];
		}
		if ( ! empty( $options['speakers'] ) ) {
			$settings['speakerLabels'] = (string) $options['speakers'];
		}
		return $settings;
	}
}
