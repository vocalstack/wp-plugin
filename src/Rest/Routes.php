<?php
/**
 * REST routes under /wp-json/vocalstack/v1.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Rest;

use VocalStack\WP\Balance;
use VocalStack\WP\Jobs;
use VocalStack\WP\Media;
use VocalStack\WP\Plugin;
use VocalStack\WP\Settings;
use VocalStack\WP\Transcriber\TranscriberError;

defined( 'ABSPATH' ) || exit;

/**
 * - `GET  media`: every audio and video file, with its transcript state, paged.
 * - `GET  media/{id}`: the attachment's state, brought up to date (the admin polls this).
 * - `POST media/{id}/transcribe`, `POST media/{id}/stop`.
 * - `POST media/{id}/transcript`: save an edited transcript.
 * - `GET|POST settings`, `POST settings/test`, `GET balance`: for administrators.
 */
final class Routes {

	const NS = 'vocalstack/v1';

	/**
	 * Hooks.
	 */
	public static function register(): void {
		add_action( 'rest_api_init', array( self::class, 'routes' ) );
	}

	/**
	 * Register the routes.
	 */
	public static function routes(): void {
		$id = array(
			'id' => array(
				'type'     => 'integer',
				'required' => true,
			),
		);

		register_rest_route(
			self::NS,
			'/media',
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'list_media' ),
				'permission_callback' => array( self::class, 'can_list_media' ),
				'args'                => array(
					'page'     => array(
						'type'    => 'integer',
						'default' => 1,
						'minimum' => 1,
					),
					'per_page' => array(
						'type'    => 'integer',
						'default' => 20,
						'minimum' => 1,
						'maximum' => 100,
					),
					'status'   => array(
						'type'    => 'string',
						'enum'    => array( 'all', 'none', 'pending', 'done', 'failed' ),
						'default' => 'all',
					),
					'search'   => array(
						'type'    => 'string',
						'default' => '',
					),
				),
			)
		);
		register_rest_route(
			self::NS,
			'/media/(?P<id>\d+)',
			array(
				'methods'             => 'GET',
				'callback'            => fn( \WP_REST_Request $r ) => Jobs::refresh( (int) $r['id'] ),
				'permission_callback' => array( self::class, 'can_edit_media' ),
				'args'                => $id,
			)
		);
		register_rest_route(
			self::NS,
			'/media/(?P<id>\d+)/transcribe',
			array(
				'methods'             => 'POST',
				'callback'            => array( self::class, 'transcribe' ),
				'permission_callback' => array( self::class, 'can_transcribe' ),
				'args'                => $id + array(
					'language' => array(
						'type'    => 'string',
						'pattern' => '^([a-z]{2,3}(-[A-Za-z]{2,4})?)?$',
					),
					'speakers' => array(
						'type' => 'string',
						'enum' => array( 'off', 'auto', 'on' ),
					),
				),
			)
		);
		register_rest_route(
			self::NS,
			'/media/(?P<id>\d+)/stop',
			array(
				'methods'             => 'POST',
				'callback'            => fn( \WP_REST_Request $r ) => Jobs::stop( (int) $r['id'] ),
				'permission_callback' => array( self::class, 'can_transcribe' ),
				'args'                => $id,
			)
		);
		register_rest_route(
			self::NS,
			'/media/(?P<id>\d+)/transcript',
			array(
				'methods'             => 'POST',
				'callback'            => array( self::class, 'save_transcript' ),
				'permission_callback' => array( self::class, 'can_edit_media' ),
				'args'                => $id + array(
					'transcript' => array(
						'type'     => 'string',
						'required' => true,
					),
				),
			)
		);

		register_rest_route(
			self::NS,
			'/settings',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( self::class, 'get_settings' ),
					'permission_callback' => array( self::class, 'can_view' ),
				),
				array(
					'methods'             => 'POST',
					'callback'            => array( self::class, 'update_settings' ),
					'permission_callback' => array( self::class, 'can_manage' ),
				),
			)
		);
		register_rest_route(
			self::NS,
			'/balance',
			array(
				'methods'             => 'GET',
				'callback'            => fn( \WP_REST_Request $r ) => Balance::get( (bool) $r['fresh'] ),
				'permission_callback' => array( self::class, 'can_view' ),
				'args'                => array(
					'fresh' => array(
						'type'    => 'boolean',
						'default' => false,
					),
				),
			)
		);
		register_rest_route(
			self::NS,
			'/settings/test',
			array(
				'methods'             => 'POST',
				'callback'            => array( self::class, 'test_connection' ),
				'permission_callback' => array( self::class, 'can_view' ),
			)
		);
	}

	/**
	 * The audio and video attachments the user may edit, newest first, filtered
	 * by transcript state.
	 *
	 * @param \WP_REST_Request $request The request.
	 */
	public static function list_media( \WP_REST_Request $request ): \WP_REST_Response {
		$args = array(
			'post_type'      => 'attachment',
			'post_status'    => current_user_can( 'read_private_posts' ) ? array( 'inherit', 'private' ) : array( 'inherit' ),
			'post_mime_type' => array( 'audio', 'video' ),
			'posts_per_page' => (int) $request['per_page'],
			'paged'          => (int) $request['page'],
			'orderby'        => 'date',
			'order'          => 'DESC',
			'fields'         => 'ids',
		);
		if ( ! current_user_can( 'edit_others_posts' ) ) {
			$args['author'] = get_current_user_id();
		}
		$search = trim( (string) $request['search'] );
		if ( '' !== $search ) {
			$args['s'] = $search;
		}
		$state = array(
			'pending' => array(
				'key'     => Media::STATE,
				'value'   => Media::PENDING,
				'compare' => 'IN',
			),
			'done'    => array(
				'key'   => Media::STATE,
				'value' => 'done',
			),
			'failed'  => array(
				'key'   => Media::STATE,
				'value' => 'failed',
			),
			'none'    => array(
				'relation' => 'OR',
				array(
					'key'     => Media::STATE,
					'compare' => 'NOT EXISTS',
				),
				array(
					'key'   => Media::STATE,
					'value' => '',
				),
			),
		);
		if ( isset( $state[ $request['status'] ] ) ) {
			$args['meta_query'] = array( $state[ $request['status'] ] ); // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query -- An admin list, paged.
		}
		$query    = new \WP_Query( $args );
		$ids      = array_filter( array_map( 'intval', $query->posts ), fn( int $id ) => Media::is_transcribable( $id ) && current_user_can( 'edit_post', $id ) );
		$response = new \WP_REST_Response( array_values( array_map( array( Media::class, 'row' ), $ids ) ) );
		$response->header( 'X-WP-Total', (string) $query->found_posts );
		$response->header( 'X-WP-TotalPages', (string) $query->max_num_pages );
		return $response;
	}

	/**
	 * Start a transcription, with the site's settings unless the request names
	 * a language (`''` for auto-detect) or speaker labelling.
	 *
	 * @param \WP_REST_Request $request The request.
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function transcribe( \WP_REST_Request $request ) {
		$settings = Settings::transcription();
		if ( $request->has_param( 'language' ) ) {
			unset( $settings['spokenLanguage'] );
			if ( '' !== (string) $request['language'] ) {
				$settings['spokenLanguage'] = (string) $request['language'];
			}
		}
		if ( $request->has_param( 'speakers' ) ) {
			$settings['speakerLabels'] = (string) $request['speakers'];
		}
		return Jobs::start( (int) $request['id'], $settings );
	}

	/**
	 * Whether the user may list media on the VocalStack page. The list holds
	 * only the attachments they may edit.
	 */
	public static function can_list_media(): bool {
		return current_user_can( Proxy::CAPABILITY ) && current_user_can( 'upload_files' );
	}

	/**
	 * Whether the user may edit this attachment.
	 *
	 * @param \WP_REST_Request $request The request.
	 */
	public static function can_edit_media( \WP_REST_Request $request ): bool {
		return current_user_can( 'edit_post', (int) $request['id'] );
	}

	/**
	 * Whether the user may spend the site's VocalStack balance on this attachment.
	 *
	 * @param \WP_REST_Request $request The request.
	 */
	public static function can_transcribe( \WP_REST_Request $request ): bool {
		$id = (int) $request['id'];
		/**
		 * Filters who may start and stop transcriptions. Transcribing is billed
		 * to the connected VocalStack account.
		 *
		 * @param bool $allowed Whether the user can edit the attachment.
		 * @param int  $id      Attachment ID.
		 */
		return (bool) apply_filters( 'vocalstack_can_transcribe', current_user_can( 'edit_post', $id ), $id );
	}

	/**
	 * Whether the user may change the connection and settings: administrators
	 * only, since the key decides whose account is billed.
	 */
	public static function can_manage(): bool {
		return current_user_can( 'manage_options' );
	}

	/**
	 * Whether the user may see the VocalStack page's account information.
	 */
	public static function can_view(): bool {
		return current_user_can( Proxy::CAPABILITY );
	}

	/**
	 * Save an edited transcript. The timed sentences stay as VocalStack returned them.
	 *
	 * @param \WP_REST_Request $request The request.
	 * @return array<string, mixed>
	 */
	public static function save_transcript( \WP_REST_Request $request ): array {
		$id = (int) $request['id'];
		update_post_meta( $id, Media::TRANSCRIPT, wp_slash( sanitize_textarea_field( (string) $request['transcript'] ) ) );
		return Media::data( $id );
	}

	/**
	 * The settings and the connection, without the key itself.
	 *
	 * @return array<string, mixed>
	 */
	public static function get_settings(): array {
		$key = Settings::api_key();
		return array(
			'settings'     => Settings::all(),
			'connection'   => array(
				'source'   => Settings::key_source(),
				'keyHint'  => '' === $key ? '' : '…' . substr( $key, -4 ),
				'account'  => get_option( 'vocalstack_account', '' ),
				'editable' => 'constant' !== Settings::key_source(),
			),
			'dashboardUrl' => Settings::dashboard_url(),
		);
	}

	/**
	 * Save settings; `apiKey` connects ('' disconnects), checked against VocalStack first.
	 *
	 * @param \WP_REST_Request $request The request.
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function update_settings( \WP_REST_Request $request ) {
		$body = (array) $request->get_json_params();
		if ( isset( $body['settings'] ) && is_array( $body['settings'] ) ) {
			Settings::update( $body['settings'] );
		}
		if ( array_key_exists( 'apiKey', $body ) && 'constant' !== Settings::key_source() ) {
			$key = trim( (string) $body['apiKey'] );
			if ( '' !== $key && ! str_starts_with( $key, 'vs_key_' ) ) {
				return new \WP_Error( 'vocalstack_bad_key', __( 'A VocalStack API key starts with vs_key_.', 'vocalstack' ), array( 'status' => 400 ) );
			}
			$previous = (string) get_option( Settings::KEY_OPTION, '' );
			Settings::set_api_key( $key );
			delete_option( 'vocalstack_account' );
			if ( '' !== $key ) {
				$checked = self::test_connection();
				if ( is_wp_error( $checked ) ) {
					Settings::set_api_key( $previous );
					return $checked;
				}
			}
		}
		return self::get_settings();
	}

	/**
	 * Check the key against `GET /v1/me` and remember the account's name.
	 *
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function test_connection() {
		if ( '' === Settings::api_key() ) {
			return new \WP_Error( 'vocalstack_not_connected', __( 'No API key is set.', 'vocalstack' ), array( 'status' => 409 ) );
		}
		try {
			$me = Plugin::transcriber()->account();
		} catch ( TranscriberError $e ) {
			$status = 401 === $e->http_status ? 400 : 502;
			return new \WP_Error( 'vocalstack_' . $e->error_code, $e->getMessage(), array( 'status' => $status ) );
		}
		update_option( 'vocalstack_account', self::account_label( $me ), false );
		return self::get_settings();
	}

	/**
	 * A short label for the account, from whatever `/v1/me` carries.
	 *
	 * @param array<string, mixed> $me The answer.
	 */
	private static function account_label( array $me ): string {
		$candidates = array(
			array( 'principal', 'name' ),
			array( 'principal', 'displayName' ),
			array( 'organization', 'name' ),
			array( 'user', 'email' ),
			array( 'user', 'name' ),
			array( 'displayName' ),
			array( 'email' ),
			array( 'name' ),
		);
		foreach ( $candidates as $path ) {
			$v = $me;
			foreach ( $path as $k ) {
				$v = is_array( $v ) ? ( $v[ $k ] ?? null ) : null;
			}
			if ( is_string( $v ) && '' !== $v ) {
				return $v;
			}
		}
		return '';
	}
}
