<?php
/**
 * The SDK adapter, with WordPress's HTTP API answering instead of VocalStack.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Tests;

use VocalStack\WP\Transcriber\SdkTranscriber;
use VocalStack\WP\Transcriber\Source;
use VocalStack\WP\Transcriber\TranscriberError;

final class SdkTranscriberTest extends \WP_UnitTestCase {

	/** @var list<array{method: string, url: string, headers: array<string, string>, body: mixed}> */
	private array $requests = array();

	/** @var list<array{0: int, 1: array<string, mixed>|null}> Answers, in order. */
	private array $answers = array();

	public function set_up(): void {
		parent::set_up();
		add_filter(
			'pre_http_request',
			function ( $pre, $args, $url ) {
				$this->requests[]        = array(
					'method'  => $args['method'],
					'url'     => $url,
					'headers' => $args['headers'],
					'body'    => $args['body'],
				);
				[ $status, $json ] = array_shift( $this->answers ) ?? array( 500, null );
				return array(
					'headers'  => array( 'content-type' => 'application/json' ),
					'body'     => null === $json ? '' : wp_json_encode( $json ),
					'response' => array(
						'code'    => $status,
						'message' => '',
					),
					'cookies'  => array(),
				);
			},
			10,
			3
		);
	}

	private function client(): SdkTranscriber {
		return new SdkTranscriber( 'vs_key_abc', 'https://api.example.test' );
	}

	public function test_account_sends_the_key(): void {
		$this->answers[] = array( 200, array( 'organization' => array( 'name' => 'Acme' ) ) );

		$me = $this->client()->account();

		$this->assertSame( 'Acme', $me['organization']['name'] );
		$this->assertSame( 'GET', $this->requests[0]['method'] );
		$this->assertSame( 'https://api.example.test/v1/me', $this->requests[0]['url'] );
		$this->assertSame( 'Bearer vs_key_abc', $this->requests[0]['headers']['authorization'] );
	}

	public function test_start_from_a_url(): void {
		$this->answers[] = array(
			201,
			array(
				'id'  => 'tr_9',
				'job' => array(
					'recordingId' => 'rec_9',
					'state'       => 'queued',
				),
			),
		);

		$started = $this->client()->start(
			Source::url( 'https://cdn.example.com/a.mp3' ),
			'Episode 1',
			'key-1',
			array(
				'spokenLanguage' => 'ro',
				'speakerLabels'  => 'auto',
			)
		);

		$this->assertSame(
			array(
				'recordingId'     => 'rec_9',
				'transcriptionId' => 'tr_9',
			),
			$started
		);
		$request = $this->requests[0];
		$this->assertSame( 'POST', $request['method'] );
		$this->assertSame( 'https://api.example.test/v1/transcriptions', $request['url'] );
		$this->assertSame( 'key-1', $request['headers']['idempotency-key'] );
		$body = json_decode( $request['body'], true );
		$this->assertSame( 'https://cdn.example.com/a.mp3', $body['url'] );
		$this->assertSame( 'Episode 1', $body['name'] );
		$this->assertSame( 'ro', $body['settings']['spokenLanguage'] );
		$this->assertSame( 'auto', $body['settings']['speakerLabels'] );
	}

	public function test_job_and_transcript_paths(): void {
		$this->answers[] = array( 200, array( 'state' => 'done' ) );
		$this->answers[] = array( 200, array( 'sentences' => array() ) );

		$this->client()->job( 'rec 1' );
		$this->client()->transcript( 'rec 1' );

		$this->assertSame( 'https://api.example.test/v1/recordings/rec%201/job', $this->requests[0]['url'] );
		$this->assertStringStartsWith( 'https://api.example.test/v1/recordings/rec%201/transcript', $this->requests[1]['url'] );
	}

	public function test_api_errors_become_transcriber_errors(): void {
		$this->answers[] = array(
			402,
			array(
				'code'    => 'insufficient_credit',
				'message' => 'Top up to keep transcribing.',
			),
		);
		try {
			$this->client()->account();
			$this->fail( 'Expected a TranscriberError.' );
		} catch ( TranscriberError $e ) {
			$this->assertSame( 'insufficient_credit', $e->error_code );
			$this->assertSame( 402, $e->http_status );
			$this->assertSame( 'Top up to keep transcribing.', $e->getMessage() );
		}
	}

	public function test_network_failures_become_transcriber_errors(): void {
		add_filter( 'pre_http_request', fn() => new \WP_Error( 'http_request_failed', 'cURL error 6: Could not resolve host' ), 20 );
		try {
			$this->client()->account();
			$this->fail( 'Expected a TranscriberError.' );
		} catch ( TranscriberError $e ) {
			$this->assertSame( 'connection_failed', $e->error_code );
			$this->assertSame( 0, $e->http_status );
		}
	}

	public function test_an_answer_without_a_job_is_an_error(): void {
		$this->answers[] = array( 201, array( 'id' => 'tr_9' ) );
		$this->expectException( TranscriberError::class );
		$this->client()->start( Source::url( 'https://cdn.example.com/a.mp3' ), 'x', 'k' );
	}
}
