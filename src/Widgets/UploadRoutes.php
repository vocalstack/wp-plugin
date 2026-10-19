<?php
/**
 * The upload widget's server side.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Widgets;

use VocalStack\WP\Jobs;
use VocalStack\WP\Media;
use VocalStack\WP\Rest\Routes;
use VocalStack\WP\Settings;

defined( 'ABSPATH' ) || exit;

/**
 * `POST widgets/upload` (multipart: `ticket`, `file`) saves the file in the
 * Media Library and starts its transcription; `GET widgets/upload/status?session=`
 * follows the job and returns the transcript when it is done.
 */
final class UploadRoutes {

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
		register_rest_route(
			Routes::NS,
			'/widgets/upload',
			array(
				'methods'             => 'POST',
				'callback'            => array( self::class, 'upload' ),
				'permission_callback' => '__return_true', // The callback checks the signed ticket and the policy.
				'args'                => array(
					'ticket' => array(
						'type'     => 'string',
						'required' => true,
					),
				),
			)
		);
		register_rest_route(
			Routes::NS,
			'/widgets/upload/status',
			array(
				'methods'             => 'GET',
				'callback'            => array( self::class, 'status' ),
				'permission_callback' => '__return_true',
				'args'                => array(
					'session' => array(
						'type'     => 'string',
						'required' => true,
					),
				),
			)
		);
	}

	/**
	 * Save and transcribe one file.
	 *
	 * @param \WP_REST_Request $request The request.
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function upload( \WP_REST_Request $request ) {
		$widget = Ticket::verify( (string) $request['ticket'] );
		if ( ! $widget || 'upload' !== ( $widget['type'] ?? '' ) ) {
			return new \WP_Error( 'vocalstack_bad_ticket', __( 'This upload form is out of date. Reload the page.', 'vocalstack' ), array( 'status' => 400 ) );
		}
		$limits = Policy::effective( $widget );
		if ( ! Policy::may_use( $limits ) ) {
			return new \WP_Error( 'vocalstack_forbidden', is_user_logged_in() ? __( 'Your account can’t upload here.', 'vocalstack' ) : __( 'Log in to upload.', 'vocalstack' ), array( 'status' => is_user_logged_in() ? 403 : 401 ) );
		}
		if ( '' === Settings::api_key() ) {
			return new \WP_Error( 'vocalstack_not_connected', __( 'Transcription is not set up on this site yet.', 'vocalstack' ), array( 'status' => 503 ) );
		}
		$file = $request->get_file_params()['file'] ?? null;
		if ( ! is_array( $file ) || UPLOAD_ERR_OK !== (int) ( $file['error'] ?? UPLOAD_ERR_NO_FILE ) ) {
			return new \WP_Error( 'vocalstack_no_file', self::upload_error( (int) ( $file['error'] ?? UPLOAD_ERR_NO_FILE ) ), array( 'status' => 400 ) );
		}
		$check = wp_check_filetype_and_ext( $file['tmp_name'], $file['name'] );
		$type  = (string) ( $check['type'] ?? '' );
		$kinds = array_map( 'trim', explode( ',', (string) ( $widget['accept'] ?? 'audio,video' ) ) );
		if ( '' === $type || ! in_array( strtok( $type, '/' ), $kinds, true ) || ! in_array( strtok( $type, '/' ), array( 'audio', 'video' ), true ) ) {
			return new \WP_Error( 'vocalstack_bad_type', __( 'Choose an audio or video file.', 'vocalstack' ), array( 'status' => 415 ) );
		}
		$allowed = Policy::allow_upload( $limits, (int) $file['size'] );
		if ( is_wp_error( $allowed ) ) {
			return $allowed;
		}

		require_once ABSPATH . 'wp-admin/includes/file.php';
		require_once ABSPATH . 'wp-admin/includes/media.php';
		require_once ABSPATH . 'wp-admin/includes/image.php';
		$title = trim( (string) ( $widget['title'] ?? '' ) );
		$id    = media_handle_sideload(
			array(
				'name'     => sanitize_file_name( $file['name'] ),
				'tmp_name' => $file['tmp_name'],
				'type'     => $type,
				'size'     => (int) $file['size'],
				'error'    => 0,
			),
			0,
			'' !== $title ? $title : null,
			array(
				'post_author' => get_current_user_id(),
				'meta_input'  => array( '_vocalstack_uploaded_by_widget' => 1 ),
			)
		);
		if ( is_wp_error( $id ) ) {
			return new \WP_Error( 'vocalstack_save_failed', $id->get_error_message(), array( 'status' => 500 ) );
		}

		$options = Widgets::transcription_settings( $widget );
		$started = Jobs::start( (int) $id, $options );
		if ( is_wp_error( $started ) ) {
			return $started;
		}
		return array(
			'session' => Ticket::sign(
				array(
					'kind' => 'upload-session',
					'id'   => (int) $id,
					'who'  => Policy::visitor(),
					'exp'  => time() + DAY_IN_SECONDS,
				)
			),
			'state'   => $started['state'],
		);
	}

	/**
	 * The transcription's progress, and the transcript once it is done.
	 *
	 * @param \WP_REST_Request $request The request.
	 * @return array<string, mixed>|\WP_Error
	 */
	public static function status( \WP_REST_Request $request ) {
		$session = Ticket::verify( (string) $request['session'] );
		if ( ! $session || 'upload-session' !== ( $session['kind'] ?? '' ) || (int) ( $session['exp'] ?? 0 ) < time() ) {
			return new \WP_Error( 'vocalstack_bad_session', __( 'This upload has expired.', 'vocalstack' ), array( 'status' => 400 ) );
		}
		if ( Policy::visitor() !== $session['who'] ) {
			return new \WP_Error( 'vocalstack_not_yours', __( 'This upload belongs to someone else.', 'vocalstack' ), array( 'status' => 403 ) );
		}
		$data = Jobs::refresh( (int) $session['id'] );
		return array(
			'state'     => $data['state'],
			'progress'  => $data['progress'],
			'error'     => $data['error'],
			'sentences' => 'done' === $data['state'] ? $data['sentences'] : array(),
			'url'       => (string) wp_get_attachment_url( (int) $session['id'] ),
		);
	}

	/**
	 * A readable reason for PHP's upload error code.
	 *
	 * @param int $code UPLOAD_ERR_*.
	 */
	private static function upload_error( int $code ): string {
		if ( UPLOAD_ERR_INI_SIZE === $code || UPLOAD_ERR_FORM_SIZE === $code ) {
			/* translators: %s: size, such as 64 MB */
			return sprintf( __( 'The file is larger than this site accepts (%s).', 'vocalstack' ), size_format( wp_max_upload_size() ) );
		}
		return __( 'No file was received. Try again.', 'vocalstack' );
	}
}
