<?php
/**
 * Transcripts as WebVTT captions on videos.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Front;

use VocalStack\WP\Media;
use VocalStack\WP\Rest\Routes;
use VocalStack\WP\Settings;
use VocalStack\WP\Text;

defined( 'ABSPATH' ) || exit;

/**
 * `GET /wp-json/vocalstack/v1/captions/{id}` serves the captions; with the
 * `captions` setting on, core Video blocks get a `<track>` pointing at it.
 */
final class Captions {

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( 'rest_api_init', array( self::class, 'route' ) );
		add_filter( 'rest_pre_serve_request', array( self::class, 'serve' ), 10, 3 );
		add_filter( 'render_block_core/video', array( self::class, 'add_track' ), 10, 2 );
	}

	/**
	 * The captions route.
	 */
	public static function route(): void {
		register_rest_route(
			Routes::NS,
			'/captions/(?P<id>\d+)',
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'captions' ),
				'permission_callback' => fn( \WP_REST_Request $r ) => Transcript::is_viewable( (int) $r['id'] ),
				'args'                => array(
					'id' => array(
						'type'     => 'integer',
						'required' => true,
					),
				),
			)
		);
	}

	/**
	 * The captions, or a 404 without timed sentences.
	 *
	 * @param \WP_REST_Request $request The request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public static function captions( \WP_REST_Request $request ) {
		$sentences = Media::sentences( (int) $request['id'] );
		if ( ! $sentences ) {
			return new \WP_Error( 'vocalstack_no_captions', __( 'This file has no transcript.', 'vocalstack' ), array( 'status' => 404 ) );
		}
		$response = new \WP_REST_Response( Text::vtt( $sentences ) );
		$response->header( 'Content-Type', 'text/vtt; charset=utf-8' );
		return $response;
	}

	/**
	 * Send the captions as text, not as a JSON string.
	 *
	 * @param bool              $served  Whether the request was served.
	 * @param \WP_HTTP_Response $result  The response.
	 * @param \WP_REST_Request  $request The request.
	 * @return bool
	 */
	public static function serve( $served, $result, $request ) {
		if ( $served || ! str_starts_with( $request->get_route(), '/' . Routes::NS . '/captions/' ) || 200 !== $result->get_status() ) {
			return $served;
		}
		header( 'Content-Type: text/vtt; charset=utf-8' );
		echo $result->get_data(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- WebVTT, not HTML.
		return true;
	}

	/**
	 * Add a captions track to a core Video block holding a transcribed file.
	 *
	 * @param string               $html  The block's HTML.
	 * @param array<string, mixed> $block The block.
	 */
	public static function add_track( string $html, array $block ): string {
		$id = (int) ( $block['attrs']['id'] ?? 0 );
		if ( ! $id || ! Settings::get( 'captions' ) || ! Media::sentences( $id ) || str_contains( $html, '<track' ) || ! Transcript::is_viewable( $id ) ) {
			return $html;
		}
		$language = (string) get_post_meta( $id, Media::LANGUAGE, true );
		$track    = sprintf(
			'<track kind="captions" src="%s" srclang="%s" label="%s">',
			esc_url( rest_url( Routes::NS . '/captions/' . $id ) ),
			esc_attr( '' !== $language ? $language : 'en' ),
			esc_attr__( 'Captions', 'vocalstack' )
		);
		return preg_replace( '#</video>#', $track . '</video>', $html, 1 ) ?? $html;
	}
}
