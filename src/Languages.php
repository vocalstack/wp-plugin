<?php
/**
 * VocalStack's languages, and the ones a site offers its listeners.
 *
 * @package VocalStack
 */

namespace VocalStack\WP;

use VocalStack\Http\ConnectionException;
use VocalStack\VocalStack;
use VocalStack\VocalStackException;

defined( 'ABSPATH' ) || exit;

/**
 * `GET /v1/languages` (public) says which languages VocalStack translates into
 * and which it can speak. The site owner picks the listening languages a
 * player offers (Settings → Display, narrowed per widget), because a visitor's
 * pick is translated, and spoken, on the owner's account.
 */
final class Languages {

	const CACHE = 'vocalstack_languages';

	const REFRESH_HOOK = 'vocalstack_refresh_languages';

	/** Offered when the owner hasn't chosen. */
	const DEFAULT_OFFERED = array( 'en', 'es', 'fr', 'de', 'pt', 'zh' );

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( self::REFRESH_HOOK, array( self::class, 'all' ) );
		// The admin keeps the list warm, so pages rarely meet an empty cache.
		add_action( 'admin_init', fn() => self::all() );
	}

	/**
	 * Every language, by code: `name`, `native`, `flag`, `translation`, `voice`.
	 *
	 * @param bool $fetch Ask VocalStack when the cached list is gone. A page
	 *                    render passes false: it never waits on VocalStack, and
	 *                    a refresh is scheduled instead.
	 * @return array<string, array<string, mixed>>
	 */
	public static function all( bool $fetch = true ): array {
		$cached = get_transient( self::CACHE );
		if ( is_array( $cached ) && $cached ) {
			return $cached;
		}
		if ( ! $fetch ) {
			if ( ! wp_next_scheduled( self::REFRESH_HOOK ) ) {
				wp_schedule_single_event( time(), self::REFRESH_HOOK );
			}
			return array();
		}
		try {
			$lists = ( new VocalStack( apiKey: null, baseUrl: Settings::api_url(), maxRetries: 0, httpClient: Plugin::http_client() ) )->languages->list();
		} catch ( VocalStackException | ConnectionException $e ) {
			return array();
		}
		$translation = array_flip( (array) ( $lists['translation'] ?? array() ) );
		$voice       = array_flip( (array) ( $lists['voice'] ?? array() ) );
		$out         = array();
		foreach ( (array) ( $lists['languages'] ?? array() ) as $l ) {
			$code         = (string) ( $l['code'] ?? '' );
			$out[ $code ] = array(
				'code'        => $code,
				'name'        => (string) ( $l['name'] ?? $code ),
				'native'      => (string) ( $l['native'] ?? $l['name'] ?? $code ),
				'flag'        => (string) ( $l['flag'] ?? '' ),
				'translation' => isset( $translation[ $code ] ),
				'voice'       => isset( $voice[ $code ] ),
			);
		}
		if ( $out ) {
			set_transient( self::CACHE, $out, DAY_IN_SECONDS );
		}
		return $out;
	}

	/**
	 * The listening languages a widget offers: the site's list, narrowed by the
	 * widget's own `languages` option, kept to what VocalStack translates.
	 *
	 * @param array<string, mixed> $options The widget's options.
	 * @param bool                 $fetch   See all(); without the list, codes stand in for names.
	 * @return list<array<string, mixed>> Each: code, name, native, flag, voice.
	 */
	public static function offered( array $options = array(), bool $fetch = true ): array {
		$site = (array) Settings::get( 'languages' );
		$own  = array_filter( array_map( 'trim', explode( ',', (string) ( $options['languages'] ?? '' ) ) ) );
		$want = $own ? array_values( array_intersect( $own, $site ) ) : $site;
		$all  = self::all( $fetch );
		$out  = array();
		foreach ( $want as $code ) {
			if ( ! $all ) {
				$out[] = array(
					'code'   => $code,
					'name'   => strtoupper( $code ),
					'native' => strtoupper( $code ),
					'flag'   => '',
					'voice'  => false,
				);
			} elseif ( ! empty( $all[ $code ]['translation'] ) ) {
				$out[] = array_intersect_key( $all[ $code ], array_flip( array( 'code', 'name', 'native', 'flag', 'voice' ) ) );
			}
		}
		return $out;
	}

	/**
	 * Whether a widget offers this language.
	 *
	 * @param array<string, mixed> $options The widget's options.
	 * @param string               $code    Language code.
	 */
	public static function is_offered( array $options, string $code ): bool {
		return in_array( $code, array_column( self::offered( $options ), 'code' ), true );
	}
}
