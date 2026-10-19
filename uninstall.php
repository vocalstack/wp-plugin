<?php
/**
 * Deleting the plugin removes its settings, key and usage counters. Transcripts
 * stay on their attachments: they are the site's content, and a reinstall
 * shows them again. Nothing is deleted from the VocalStack account.
 *
 * @package VocalStack
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

delete_option( 'vocalstack_settings' );
delete_option( 'vocalstack_api_key' );
delete_option( 'vocalstack_account' );
delete_option( 'vocalstack_widget_policy' );
delete_option( 'vocalstack_db_version' );
wp_clear_scheduled_hook( 'vocalstack_poll' );
wp_clear_scheduled_hook( 'vocalstack_prune_usage' );

global $wpdb;
$wpdb->query( $wpdb->prepare( 'DROP TABLE IF EXISTS %i', $wpdb->prefix . 'vocalstack_usage' ) ); // phpcs:ignore WordPress.DB.DirectDatabaseQuery, WordPress.DB.DirectDatabaseQuery.SchemaChange -- Removing the plugin's own table on uninstall.
