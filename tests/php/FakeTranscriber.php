<?php
/**
 * A Transcriber that answers from memory.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Tests;

use VocalStack\WP\Transcriber\Source;
use VocalStack\WP\Transcriber\Transcriber;
use VocalStack\WP\Transcriber\TranscriberError;

/**
 * Records calls; tests set `$job`, `$transcript` and `$fail` to steer it.
 */
final class FakeTranscriber implements Transcriber {

	/** @var list<array{0: string, 1: mixed}> Calls made, in order. */
	public array $calls = array();

	/** @var array<string, mixed> What job() answers. */
	public array $job = array( 'state' => 'queued', 'progress' => array( 'pct' => 0 ) );

	/** @var array<string, mixed> What transcript() answers. */
	public array $transcript = array(
		'lang'      => 'en',
		'sentences' => array(
			array( 'start' => 0.0, 'end' => 2.0, 'speaker' => 0, 'text' => 'Hello there.' ),
			array( 'start' => 2.1, 'end' => 4.0, 'speaker' => 0, 'text' => 'How are you?' ),
			array( 'start' => 4.2, 'end' => 6.0, 'speaker' => 1, 'text' => 'Fine, thanks.' ),
		),
	);

	/** @var TranscriberError|null Thrown by the next call. */
	public ?TranscriberError $fail = null;

	/**
	 * Throw the queued failure, once.
	 */
	private function maybe_fail(): void {
		if ( $this->fail ) {
			$e          = $this->fail;
			$this->fail = null;
			throw $e;
		}
	}

	public function account(): array {
		$this->calls[] = array( 'account', null );
		$this->maybe_fail();
		return array( 'organization' => array( 'name' => 'Acme' ) );
	}

	/** @var array<string, mixed> What billing() answers. */
	public array $billing = array(
		'enabled'        => true,
		'balance'        => 10.0,
		'rates'          => array(
			'filePerHour'    => 0.5,
			'livePerHour'    => 1.5,
			'minimumSeconds' => 300,
		),
		'plan'           => array(
			'id'   => 'payg',
			'name' => 'Pay as you go',
			'kind' => 'prepaid',
		),
		'canStart'       => true,
		'canStartLive'   => true,
		'startBlock'     => null,
		'startBlockLive' => null,
		'inGrace'        => false,
		'topUpUrl'       => 'https://app.vocalstack.com/billing',
	);

	public function billing(): array {
		$this->calls[] = array( 'billing', null );
		$this->maybe_fail();
		return $this->billing;
	}

	public function start( Source $source, string $name, string $idempotency_key, array $settings = array() ): array {
		$this->calls[] = array( 'start', compact( 'source', 'name', 'idempotency_key', 'settings' ) );
		$this->maybe_fail();
		return array(
			'recordingId'     => 'rec_1',
			'transcriptionId' => 'tr_1',
		);
	}

	public function job( string $recording_id ): array {
		$this->calls[] = array( 'job', $recording_id );
		$this->maybe_fail();
		return $this->job;
	}

	public function stop( string $recording_id ): void {
		$this->calls[] = array( 'stop', $recording_id );
		$this->maybe_fail();
	}

	public function transcript( string $recording_id ): array {
		$this->calls[] = array( 'transcript', $recording_id );
		$this->maybe_fail();
		return $this->transcript;
	}

	/**
	 * The names of the calls made.
	 *
	 * @return list<string>
	 */
	public function names(): array {
		return array_column( $this->calls, 0 );
	}
}
