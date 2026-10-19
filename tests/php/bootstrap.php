<?php
/**
 * PHPUnit bootstrap: WordPress's test suite, as wp-env's tests-cli provides it.
 *
 * Run with `npm run test:php`.
 *
 * @package VocalStack
 */

$vocalstack_tests_dir = getenv( 'WP_TESTS_DIR' ) ? getenv( 'WP_TESTS_DIR' ) : '/wordpress-phpunit';
$vocalstack_root      = dirname( __DIR__, 2 );

require_once $vocalstack_root . '/vendor/yoast/phpunit-polyfills/phpunitpolyfills-autoload.php';
require_once $vocalstack_tests_dir . '/includes/functions.php';

tests_add_filter(
	'muplugins_loaded',
	static function () use ( $vocalstack_root ) {
		require $vocalstack_root . '/vocalstack.php';
	}
);

require $vocalstack_tests_dir . '/includes/bootstrap.php';

// Tests never reach VocalStack: a request no test answered fails loudly.
tests_add_filter(
	'pre_http_request',
	static function ( $pre, $args, $url ) {
		if ( false === $pre && str_contains( (string) wp_parse_url( $url, PHP_URL_HOST ), 'vocalstack.com' ) ) {
			throw new \RuntimeException( "A test tried to reach VocalStack: {$args['method']} {$url}" );
		}
		return $pre;
	},
	PHP_INT_MAX,
	3
);
require __DIR__ . '/FakeTranscriber.php';
require __DIR__ . '/FakeHttp.php';
require __DIR__ . '/TestCase.php';
