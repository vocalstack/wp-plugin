<?php
/**
 * Admin-only routes the pass-through can't serve.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Rest;

use VocalStack\Http\ConnectionException;
use VocalStack\VocalStackException;
use VocalStack\WP\Media;
use VocalStack\WP\Plugin;
use VocalStack\WP\Widgets\Policy;

defined( 'ABSPATH' ) || exit;

/**
 * - `GET links`: which VocalStack transcriptions this site made from Media
 *   Library files, so the Transcriptions list can link them (and offer the
 *   "From this site" filter beside the `createdByApiKeyId` marker).
 * - `GET|POST widget-policy`: the widgets' spending ceilings.
 * - `admin-post.php?action=vocalstack_export`: a transcript export (PDF, XLSX,
 *   SRT, JSON) as a file download; the pass-through only carries JSON.
 */
final class AdminRoutes {

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( 'rest_api_init', array( self::class, 'routes' ) );
		add_action( 'admin_post_vocalstack_export', array( self::class, 'export' ) );
	}

	/**
	 * Register the routes.
	 */
	public static function routes(): void {
		$manage = fn() => current_user_can( Proxy::CAPABILITY );
		register_rest_route(
			Routes::NS,
			'/links',
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'links' ),
				'permission_callback' => $manage,
			)
		);
		register_rest_route(
			Routes::NS,
			'/widget-policy',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( self::class, 'policy' ),
					'permission_callback' => $manage,
				),
				array(
					'methods'             => 'POST',
					'callback'            => array( self::class, 'update_policy' ),
					'permission_callback' => $manage,
				),
			)
		);
	}

	/**
	 * Transcription id → its Media Library file.
	 *
	 * @return array<string, array{attachmentId: int, title: string, editUrl: string}>
	 */
	public static function links(): array {
		$ids = get_posts(
			array(
				'post_type'      => 'attachment',
				'post_status'    => array( 'inherit', 'private' ),
				'fields'         => 'ids',
				'posts_per_page' => -1,
				'meta_key'       => Media::TRANSCRIPTION_ID, // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_key -- Only transcribed files carry it.
			)
		);
		$out = array();
		foreach ( $ids as $id ) {
			$out[ (string) get_post_meta( $id, Media::TRANSCRIPTION_ID, true ) ] = array(
				'attachmentId' => (int) $id,
				'title'        => get_the_title( $id ),
				'editUrl'      => (string) get_edit_post_link( $id, 'raw' ),
			);
		}
		return $out;
	}

	/**
	 * The ceilings and the roles to choose from.
	 *
	 * @return array<string, mixed>
	 */
	public static function policy(): array {
		$roles = array();
		foreach ( wp_roles()->get_names() as $slug => $name ) {
			$roles[] = array(
				'value' => $slug,
				'label' => translate_user_role( $name ),
			);
		}
		return array(
			'policy'        => Policy::ceilings(),
			'roles'         => $roles,
			'maxUploadSize' => (int) wp_max_upload_size(),
		);
	}

	/**
	 * Save the ceilings.
	 *
	 * @param \WP_REST_Request $request The request.
	 * @return array<string, mixed>
	 */
	public static function update_policy( \WP_REST_Request $request ): array {
		Policy::update( (array) $request->get_json_params() );
		return self::policy();
	}

	/**
	 * Stream an export as a download.
	 */
	public static function export(): void {
		check_admin_referer( 'vocalstack_export' );
		if ( ! current_user_can( Proxy::CAPABILITY ) ) {
			wp_die( esc_html__( 'You are not allowed to export transcripts.', 'vocalstack' ), 403 );
		}
		$recording = isset( $_GET['recording'] ) ? sanitize_text_field( wp_unslash( $_GET['recording'] ) ) : '';
		$format    = isset( $_GET['format'] ) ? sanitize_key( wp_unslash( $_GET['format'] ) ) : '';
		$name      = isset( $_GET['name'] ) ? sanitize_file_name( wp_unslash( $_GET['name'] ) ) : 'transcript';
		$types     = array(
			'pdf'  => 'application/pdf',
			'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
			'srt'  => 'application/x-subrip',
			'json' => 'application/json',
		);
		$vs        = Plugin::sdk();
		if ( ! preg_match( '/^[A-Za-z0-9_-]{1,64}$/', $recording ) || ! isset( $types[ $format ] ) || ! $vs ) {
			wp_die( esc_html__( 'This export is not available.', 'vocalstack' ), 400 );
		}
		try {
			$body = $vs->recordings->export( $recording, $format );
		} catch ( VocalStackException | ConnectionException $e ) {
			wp_die( esc_html( $e->getMessage() ), 502 );
		}
		nocache_headers();
		header( 'Content-Type: ' . $types[ $format ] );
		header( 'Content-Disposition: attachment; filename="' . ( '' !== $name ? $name : 'transcript' ) . '.' . $format . '"' );
		header( 'Content-Length: ' . strlen( $body ) );
		echo $body; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- A file download.
		exit;
	}
}
