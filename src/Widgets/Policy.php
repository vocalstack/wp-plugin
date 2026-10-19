<?php
/**
 * Who may use the billable widgets, and how much.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Widgets;

defined( 'ABSPATH' ) || exit;

/**
 * Administrators set ceilings in Settings → Widgets; a widget's own options can
 * only narrow them. Every billable request is checked here before VocalStack
 * is asked, and counted in the usage table.
 */
final class Policy {

	const OPTION = 'vocalstack_widget_policy';
	const TABLE  = 'vocalstack_usage';
	const DB_VER = 1;

	/** Access levels, least to most restrictive. */
	const ACCESS = array( 'everyone', 'logged_in', 'roles', 'nobody' );

	/**
	 * The ceilings and their defaults.
	 *
	 * - `access`: who may record or upload: everyone, logged_in, roles (then `roles`), nobody.
	 *   Recording never goes below logged_in: `everyone` applies to uploads only.
	 * - `maxRecordMinutes`: one recording's longest length.
	 * - `userDailyMinutes`: per signed-in user (or per visitor IP) per day.
	 * - `siteDailyMinutes`: across the whole site per day.
	 * - `maxUploadMb`: the largest upload.
	 * - `userDailyUploads`: uploads per user (or IP) per day.
	 *
	 * @return array<string, mixed>
	 */
	public static function defaults(): array {
		return array(
			'access'           => 'logged_in',
			'roles'            => array(),
			'maxRecordMinutes' => 30,
			'userDailyMinutes' => 60,
			'siteDailyMinutes' => 600,
			'maxUploadMb'      => 200,
			'userDailyUploads' => 10,
		);
	}

	/**
	 * The ceilings in force.
	 *
	 * @return array<string, mixed>
	 */
	public static function ceilings(): array {
		$saved = get_option( self::OPTION, array() );
		return array_merge( self::defaults(), is_array( $saved ) ? array_intersect_key( $saved, self::defaults() ) : array() );
	}

	/**
	 * Save ceilings, keeping only valid values.
	 *
	 * @param array<string, mixed> $input New values.
	 */
	public static function update( array $input ): void {
		$next = self::ceilings();
		if ( isset( $input['access'] ) && in_array( $input['access'], self::ACCESS, true ) ) {
			$next['access'] = $input['access'];
		}
		if ( isset( $input['roles'] ) && is_array( $input['roles'] ) ) {
			$next['roles'] = array_values( array_intersect( array_map( 'strval', $input['roles'] ), array_keys( wp_roles()->roles ) ) );
		}
		foreach ( array( 'maxRecordMinutes', 'userDailyMinutes', 'siteDailyMinutes', 'maxUploadMb', 'userDailyUploads' ) as $key ) {
			if ( isset( $input[ $key ] ) ) {
				$next[ $key ] = max( 0, (int) $input[ $key ] );
			}
		}
		update_option( self::OPTION, $next, false );
	}

	/**
	 * A widget's effective limits: the ceilings, narrowed by the widget's options.
	 *
	 * Live recording always needs a logged-in user, whatever the ceilings say.
	 *
	 * @param array<string, mixed> $widget The widget's signed config.
	 * @return array<string, mixed>
	 */
	public static function effective( array $widget ): array {
		$limits = self::ceilings();
		if ( 'record' === ( $widget['type'] ?? '' ) && 'everyone' === $limits['access'] ) {
			$limits['access'] = 'logged_in';
		}
		$wanted = (string) ( $widget['access'] ?? '' );
		if ( in_array( $wanted, self::ACCESS, true ) && array_search( $wanted, self::ACCESS, true ) > array_search( $limits['access'], self::ACCESS, true ) ) {
			$limits['access'] = $wanted;
			if ( 'roles' === $wanted ) {
				$limits['roles'] = array_map( 'strval', (array) ( $widget['roles'] ?? array() ) );
			}
		} elseif ( 'roles' === $wanted && 'roles' === $limits['access'] ) {
			$limits['roles'] = array_values( array_intersect( $limits['roles'], array_map( 'strval', (array) ( $widget['roles'] ?? array() ) ) ) );
		}
		foreach ( array( 'maxRecordMinutes', 'maxUploadMb' ) as $key ) {
			if ( isset( $widget[ $key ] ) && (int) $widget[ $key ] > 0 ) {
				$limits[ $key ] = min( $limits[ $key ], (int) $widget[ $key ] );
			}
		}
		return $limits;
	}

	/**
	 * Whether the current user may use a widget at all.
	 *
	 * @param array<string, mixed> $limits From effective().
	 */
	public static function may_use( array $limits ): bool {
		switch ( $limits['access'] ) {
			case 'everyone':
				return true;
			case 'logged_in':
				return is_user_logged_in();
			case 'roles':
				return is_user_logged_in() && (bool) array_intersect( (array) wp_get_current_user()->roles, (array) $limits['roles'] );
			default:
				return false;
		}
	}

	/**
	 * Check a recording of up to `$seconds` against the daily limits and, if it
	 * fits, reserve them. The reservation is settled with the real length later.
	 *
	 * @param array<string, mixed> $limits  From effective().
	 * @param int                  $seconds The most the recording may last.
	 * @return true|\WP_Error
	 */
	public static function reserve_minutes( array $limits, int $seconds ) {
		$who  = self::visitor();
		$user = self::used( $who, 'record' );
		$site = self::used( 'site', 'record' );
		if ( $limits['userDailyMinutes'] > 0 && $user['seconds'] + $seconds > $limits['userDailyMinutes'] * 60 ) {
			return new \WP_Error( 'vocalstack_daily_limit', __( 'You have used today’s recording time on this site. Try again tomorrow.', 'vocalstack' ), array( 'status' => 429 ) );
		}
		if ( $limits['siteDailyMinutes'] > 0 && $site['seconds'] + $seconds > $limits['siteDailyMinutes'] * 60 ) {
			return new \WP_Error( 'vocalstack_site_limit', __( 'This site has used today’s recording time. Try again tomorrow.', 'vocalstack' ), array( 'status' => 429 ) );
		}
		self::add( $who, 'record', $seconds );
		self::add( 'site', 'record', $seconds );
		return true;
	}

	/**
	 * Replace a reservation with what was really recorded.
	 *
	 * @param string $who      The visitor key the reservation was made for.
	 * @param int    $reserved Seconds reserved.
	 * @param int    $actual   Seconds recorded.
	 */
	public static function settle_minutes( string $who, int $reserved, int $actual ): void {
		$refund = max( 0, $reserved - $actual );
		if ( $refund > 0 ) {
			self::add( $who, 'record', -$refund );
			self::add( 'site', 'record', -$refund );
		}
	}

	/**
	 * Check and count one upload.
	 *
	 * @param array<string, mixed> $limits From effective().
	 * @param int                  $bytes  The file's size.
	 * @return true|\WP_Error
	 */
	public static function allow_upload( array $limits, int $bytes ) {
		if ( $limits['maxUploadMb'] > 0 && $bytes > $limits['maxUploadMb'] * MB_IN_BYTES ) {
			/* translators: %d: megabytes */
			return new \WP_Error( 'vocalstack_too_large', sprintf( __( 'The file is larger than %d MB.', 'vocalstack' ), $limits['maxUploadMb'] ), array( 'status' => 413 ) );
		}
		$who = self::visitor();
		if ( $limits['userDailyUploads'] > 0 && self::used( $who, 'upload' )['count'] >= $limits['userDailyUploads'] ) {
			return new \WP_Error( 'vocalstack_daily_limit', __( 'You have reached today’s uploads on this site. Try again tomorrow.', 'vocalstack' ), array( 'status' => 429 ) );
		}
		self::add( $who, 'upload', 0 );
		return true;
	}

	/**
	 * Who is asking: `user:<id>`, or `ip:<hash>` for a visitor.
	 */
	public static function visitor(): string {
		if ( is_user_logged_in() ) {
			return 'user:' . get_current_user_id();
		}
		$ip = isset( $_SERVER['REMOTE_ADDR'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REMOTE_ADDR'] ) ) : '';
		/**
		 * Filters the visitor's IP address used for daily limits, for sites
		 * behind a proxy that passes the real address in a header.
		 *
		 * @param string $ip REMOTE_ADDR.
		 */
		$ip = (string) apply_filters( 'vocalstack_visitor_ip', $ip );
		return 'ip:' . substr( hash_hmac( 'sha256', $ip, wp_salt( 'nonce' ) ), 0, 32 );
	}

	/**
	 * Today's use.
	 *
	 * @param string $who  Visitor key, or `site`.
	 * @param string $kind `record` or `upload`.
	 * @return array{seconds: int, count: int}
	 */
	public static function used( string $who, string $kind ): array {
		global $wpdb;
		$row = $wpdb->get_row( // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- Our own counters table.
			$wpdb->prepare( 'SELECT seconds, uses FROM %i WHERE day = %s AND who = %s AND kind = %s', self::table(), gmdate( 'Y-m-d' ), $who, $kind ),
			ARRAY_A
		);
		return array(
			'seconds' => (int) ( $row['seconds'] ?? 0 ),
			'count'   => (int) ( $row['uses'] ?? 0 ),
		);
	}

	/**
	 * Add to today's counter.
	 *
	 * @param string $who     Visitor key, or `site`.
	 * @param string $kind    `record` or `upload`.
	 * @param int    $seconds Seconds to add (negative to refund); every positive add counts one use.
	 */
	private static function add( string $who, string $kind, int $seconds ): void {
		global $wpdb;
		$wpdb->query( // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- Our own counters table; an upsert keeps concurrent requests correct.
			$wpdb->prepare(
				'INSERT INTO %i (day, who, kind, seconds, uses) VALUES (%s, %s, %s, %d, %d) ON DUPLICATE KEY UPDATE seconds = GREATEST(0, seconds + VALUES(seconds)), uses = uses + VALUES(uses)',
				self::table(),
				gmdate( 'Y-m-d' ),
				$who,
				$kind,
				$seconds,
				$seconds >= 0 ? 1 : 0
			)
		);
	}

	/**
	 * The counters table's name.
	 */
	public static function table(): string {
		global $wpdb;
		return $wpdb->prefix . self::TABLE;
	}

	/**
	 * Create or update the counters table when the plugin's schema changed.
	 */
	public static function install(): void {
		if ( (int) get_option( 'vocalstack_db_version' ) === self::DB_VER ) {
			return;
		}
		global $wpdb;
		require_once ABSPATH . 'wp-admin/includes/upgrade.php';
		dbDelta(
			'CREATE TABLE ' . self::table() . " (
				day date NOT NULL,
				who varchar(64) NOT NULL,
				kind varchar(16) NOT NULL,
				seconds int NOT NULL DEFAULT 0,
				uses int unsigned NOT NULL DEFAULT 0,
				PRIMARY KEY  (day,who,kind)
			) {$wpdb->get_charset_collate()};"
		);
		update_option( 'vocalstack_db_version', self::DB_VER );
	}

	/**
	 * Forget counters older than a week (daily cron).
	 */
	public static function prune(): void {
		global $wpdb;
		$wpdb->query( $wpdb->prepare( 'DELETE FROM %i WHERE day < %s', self::table(), gmdate( 'Y-m-d', time() - WEEK_IN_SECONDS ) ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery -- Our own counters table.
	}
}
