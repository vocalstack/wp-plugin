<?php
/**
 * The plugin's options and the API key.
 *
 * @package VocalStack
 */

namespace VocalStack\WP;

defined( 'ABSPATH' ) || exit;

/**
 * Reads and writes settings. The key lives in its own option, never autoloaded
 * and never sent to a browser; `VOCALSTACK_API_KEY` in wp-config.php wins over it.
 */
final class Settings {

	const OPTION     = 'vocalstack_settings';
	const KEY_OPTION = 'vocalstack_api_key';

	const DEFAULT_API_URL       = 'https://api.vocalstack.com';
	const DEFAULT_DASHBOARD_URL = 'https://app.vocalstack.com';

	/**
	 * Every setting with its default.
	 *
	 * - `language`: a Whisper language code, '' to auto-detect.
	 * - `auto`: transcribe new uploads by themselves: `off`, `audio` or `all` (audio and video).
	 * - `speakers`: VocalStack's `speakerLabels`: `off`, `auto` (label speakers once a
	 *   second one is heard) or `on`.
	 * - `captions`: add the transcript as a captions track to core Video blocks.
	 * - `languages`: the listening languages players offer (translation and,
	 *   where VocalStack has a voice, speech), billed to this account.
	 *
	 * @return array{language: string, auto: string, speakers: string, captions: bool, languages: list<string>}
	 */
	public static function defaults(): array {
		return array(
			'language'  => '',
			'auto'      => 'off',
			'speakers'  => 'auto',
			'captions'  => true,
			'languages' => Languages::DEFAULT_OFFERED,
		);
	}

	/**
	 * The settings a new transcription starts with, by VocalStack's names.
	 *
	 * @return array<string, string>
	 */
	public static function transcription(): array {
		$settings = array( 'speakerLabels' => (string) self::get( 'speakers' ) );
		$language = (string) self::get( 'language' );
		if ( '' !== $language ) {
			$settings['spokenLanguage'] = $language;
		}
		return $settings;
	}

	/**
	 * The current settings, defaults filled in.
	 *
	 * @return array{language: string, auto: string, speakers: string, captions: bool, languages: list<string>}
	 */
	public static function all(): array {
		$saved = get_option( self::OPTION, array() );
		return array_merge( self::defaults(), is_array( $saved ) ? array_intersect_key( $saved, self::defaults() ) : array() );
	}

	/**
	 * One setting.
	 *
	 * @param string $name A key of defaults().
	 * @return mixed
	 */
	public static function get( string $name ) {
		return self::all()[ $name ] ?? null;
	}

	/**
	 * Save settings, keeping only known keys with valid values.
	 *
	 * @param array<string, mixed> $input New values.
	 */
	public static function update( array $input ): void {
		$next = self::all();
		if ( isset( $input['language'] ) ) {
			$next['language'] = preg_match( '/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/', (string) $input['language'] ) ? (string) $input['language'] : '';
		}
		if ( isset( $input['auto'] ) && in_array( $input['auto'], array( 'off', 'audio', 'all' ), true ) ) {
			$next['auto'] = $input['auto'];
		}
		if ( isset( $input['speakers'] ) && in_array( $input['speakers'], array( 'off', 'auto', 'on' ), true ) ) {
			$next['speakers'] = $input['speakers'];
		}
		if ( isset( $input['captions'] ) ) {
			$next['captions'] = (bool) $input['captions'];
		}
		if ( isset( $input['languages'] ) && is_array( $input['languages'] ) ) {
			$next['languages'] = array_values( array_unique( array_filter( array_map( 'strval', $input['languages'] ), fn( $c ) => (bool) preg_match( '/^[a-z]{2,3}(-[A-Za-z]{2,4})?$/', $c ) ) ) );
		}
		update_option( self::OPTION, $next );
	}

	/**
	 * The API key in use, or ''.
	 */
	public static function api_key(): string {
		if ( defined( 'VOCALSTACK_API_KEY' ) && is_string( VOCALSTACK_API_KEY ) && '' !== VOCALSTACK_API_KEY ) {
			return VOCALSTACK_API_KEY;
		}
		return (string) get_option( self::KEY_OPTION, '' );
	}

	/**
	 * Where the key comes from: `constant`, `option` or `none`.
	 */
	public static function key_source(): string {
		if ( defined( 'VOCALSTACK_API_KEY' ) && is_string( VOCALSTACK_API_KEY ) && '' !== VOCALSTACK_API_KEY ) {
			return 'constant';
		}
		return '' === (string) get_option( self::KEY_OPTION, '' ) ? 'none' : 'option';
	}

	/**
	 * Store a key, or forget it with ''.
	 *
	 * @param string $key A `vs_key_…` key.
	 */
	public static function set_api_key( string $key ): void {
		if ( '' === $key ) {
			delete_option( self::KEY_OPTION );
		} else {
			update_option( self::KEY_OPTION, $key, false );
		}
		Plugin::reset_transcriber();
		Balance::forget();
	}

	/**
	 * The API's base URL. `VOCALSTACK_API_URL` points the plugin at another
	 * environment, such as staging.
	 */
	public static function api_url(): string {
		return defined( 'VOCALSTACK_API_URL' ) ? untrailingslashit( (string) VOCALSTACK_API_URL ) : self::DEFAULT_API_URL;
	}

	/**
	 * The dashboard's base URL, for links and one-click connect.
	 */
	public static function dashboard_url(): string {
		return defined( 'VOCALSTACK_DASHBOARD_URL' ) ? untrailingslashit( (string) VOCALSTACK_DASHBOARD_URL ) : self::DEFAULT_DASHBOARD_URL;
	}
}
