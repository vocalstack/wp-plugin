<?php
/**
 * The job lifecycle against a fake VocalStack.
 *
 * @package VocalStack
 */

namespace VocalStack\WP\Tests;

use VocalStack\WP\Jobs;
use VocalStack\WP\Media;
use VocalStack\WP\Settings;
use VocalStack\WP\Transcriber\TranscriberError;
use VocalStack\WP\Workspace;

final class JobsTest extends TestCase {

	public function test_start_uploads_the_file_when_the_site_is_not_public(): void {
		add_filter( 'vocalstack_file_url', fn() => 'http://localhost:8888/wp-content/uploads/clip.mp3' );
		$id = $this->audio();

		$data = Jobs::start( $id );

		$this->assertSame( 'queued', $data['state'] );
		$this->assertArrayNotHasKey( 'recordingId', $data );
		$this->assertSame( 'tr_1', $data['transcriptionId'] );
		$source = $this->vs->calls[0][1]['source'];
		$this->assertTrue( $source->is_file() );
		$this->assertSame( get_attached_file( $id ), $source->path );
		$this->assertSame( 'Clip', $this->vs->calls[0][1]['name'] );
		$this->assertNotFalse( wp_next_scheduled( Jobs::POLL_HOOK ) );
	}

	public function test_start_sends_a_public_url(): void {
		add_filter( 'vocalstack_file_url', fn() => 'https://93.184.215.14/clip.mp3' );
		Jobs::start( $this->audio() );

		$source = $this->vs->calls[0][1]['source'];
		$this->assertFalse( $source->is_file() );
		$this->assertSame( 'https://93.184.215.14/clip.mp3', $source->url );
	}

	public function test_start_passes_the_language_setting(): void {
		Settings::update( array( 'language' => 'ro' ) );
		Jobs::start( $this->audio() );
		$this->assertSame(
			array(
				'speakerLabels'  => 'auto',
				'spokenLanguage' => 'ro',
			),
			$this->vs->calls[0][1]['settings']
		);
	}

	public function test_auto_detect_sends_no_language_and_is_remembered(): void {
		$id = $this->audio();
		Jobs::start( $id );
		$this->assertArrayNotHasKey( 'spokenLanguage', $this->vs->calls[0][1]['settings'] );

		$this->vs->job = array( 'state' => 'done' );
		Jobs::refresh( $id );

		$this->assertTrue( Media::auto_language( $id ) );
	}

	public function test_a_chosen_language_is_remembered(): void {
		Settings::update( array( 'language' => 'ro' ) );
		$id = $this->audio();
		Jobs::start( $id );
		$this->vs->job = array( 'state' => 'done' );
		Jobs::refresh( $id );
		$this->assertFalse( Media::auto_language( $id ) );
	}

	public function test_languages_and_speakers_are_saved(): void {
		$id                   = $this->audio();
		$this->vs->transcript = array(
			'lang'          => 'en',
			'speakerLabels' => 'auto',
			'speakers'      => array(),
			'sentences'     => array(
				array(
					'start'    => 0.0,
					'end'      => 1.0,
					'speaker'  => 0,
					'text'     => 'Hello.',
					'language' => 'en',
				),
				array(
					'start'    => 1.0,
					'end'      => 2.0,
					'speaker'  => 1,
					'text'     => 'Hola.',
					'language' => 'es',
				),
				array(
					'start'    => 2.0,
					'end'      => 3.0,
					'speaker'  => 0,
					'text'     => 'How are you?',
					'language' => 'en',
				),
			),
		);
		Jobs::start( $id );
		$this->vs->job = array( 'state' => 'done' );
		Jobs::refresh( $id );

		$this->assertSame( array( 'en', 'es' ), Media::languages( $id ) );
		$this->assertSame( 2, Media::row( $id )['speakers'] );
	}

	public function test_speakers_are_unknown_when_not_identified(): void {
		$id                   = $this->audio();
		$this->vs->transcript = array(
			'lang'          => 'en',
			'speakerLabels' => 'off',
			'sentences'     => array(
				array(
					'start'    => 0.0,
					'end'      => 1.0,
					'speaker'  => -1,
					'text'     => 'Hello.',
					'language' => 'en',
				),
			),
		);
		Jobs::start( $id );
		$this->vs->job = array( 'state' => 'done' );
		Jobs::refresh( $id );

		$this->assertNull( Media::row( $id )['speakers'] );
	}

	public function test_start_refuses_without_a_key(): void {
		Settings::set_api_key( '' );
		$result = Jobs::start( $this->audio() );
		$this->assertWPError( $result );
		$this->assertSame( 'vocalstack_not_connected', $result->get_error_code() );
		$this->assertSame( array(), $this->vs->calls );
	}

	public function test_start_refuses_images(): void {
		$id = self::factory()->attachment->create_object(
			array(
				'file'           => 'a.jpg',
				'post_mime_type' => 'image/jpeg',
			)
		);
		$this->assertWPError( Jobs::start( $id ) );
	}

	public function test_a_running_job_is_not_started_twice(): void {
		$id = $this->audio();
		Jobs::start( $id );
		Jobs::start( $id );
		$this->assertSame( array( 'start' ), $this->vs->names() );
	}

	public function test_a_refused_start_is_recorded(): void {
		$this->vs->fail = new TranscriberError( 'Out of credit', 'insufficient_balance', 402 );
		$id             = $this->audio();

		$result = Jobs::start( $id );

		$this->assertWPError( $result );
		$this->assertSame( 'failed', get_post_meta( $id, Media::STATE, true ) );
		$this->assertSame( 'Out of credit', Media::data( $id )['error'] );
	}

	public function test_refresh_follows_progress_then_saves_the_transcript(): void {
		$id = $this->audio();
		Jobs::start( $id );

		$this->vs->job = array(
			'state'    => 'transcribing',
			'progress' => array( 'pct' => 40 ),
		);
		$data          = Jobs::refresh( $id );
		$this->assertSame( 'transcribing', $data['state'] );
		$this->assertSame( 40, $data['progress']['pct'] );

		$this->unthrottle( $id );
		$this->vs->job = array( 'state' => 'done' );
		$data          = Jobs::refresh( $id );

		$this->assertSame( 'done', $data['state'] );
		$this->assertSame( "Hello there. How are you?\n\nFine, thanks.", $data['transcript'] );
		$this->assertCount( 3, $data['sentences'] );
		$this->assertSame( 'en', $data['language'] );
	}

	public function test_refresh_and_stop_use_the_transcription_id(): void {
		$id = $this->audio();
		Jobs::start( $id );
		$this->vs->job = array( 'state' => 'transcribing' );
		Jobs::refresh( $id );
		Jobs::stop( $id );

		$this->assertSame( array( 'job', 'tr_1' ), $this->vs->calls[1] );
		$this->assertSame( array( 'stop', 'tr_1' ), $this->vs->calls[2] );
	}

	public function test_a_job_saved_with_a_recording_id_is_followed_by_its_transcription_id(): void {
		$id = $this->audio();
		update_post_meta(
			$id,
			Media::JOB,
			array(
				'recordingId'     => 'rec_old',
				'transcriptionId' => 'tr_old',
				'progress'        => array( 'pct' => 10 ),
			)
		);
		update_post_meta( $id, Media::STATE, 'transcribing' );
		$this->vs->job = array( 'state' => 'done' );

		$data = Jobs::refresh( $id );

		$this->assertSame( array( array( 'job', 'tr_old' ), array( 'transcript', 'tr_old' ) ), $this->vs->calls );
		$this->assertSame( 'done', $data['state'] );
	}

	public function test_refresh_is_throttled(): void {
		$id = $this->audio();
		Jobs::start( $id );
		Jobs::refresh( $id );
		Jobs::refresh( $id );
		$this->assertSame( array( 'start', 'job' ), $this->vs->names() );
	}

	public function test_a_failed_job_keeps_the_earlier_transcript(): void {
		$id = $this->audio();
		update_post_meta( $id, Media::TRANSCRIPT, 'Earlier.' );
		Jobs::start( $id );

		$this->vs->job = array(
			'state'     => 'failed',
			'error'     => 'Unreadable file',
			'errorCode' => 'bad_media',
		);
		$data          = Jobs::refresh( $id );

		$this->assertSame( 'failed', $data['state'] );
		$this->assertSame( 'Unreadable file', $data['error'] );
		$this->assertSame( 'Earlier.', $data['transcript'] );
	}

	public function test_a_passing_error_is_retried(): void {
		$id = $this->audio();
		Jobs::start( $id );
		$this->vs->fail = new TranscriberError( 'Timeout', 'http_error', 0 );
		$this->assertSame( 'queued', Jobs::refresh( $id )['state'] );
	}

	public function test_a_job_started_in_another_workspace_says_so_in_plain_words(): void {
		Workspace::remember(
			array(
				'workspace' => array(
					'id'   => 'ws_old',
					'name' => 'Old',
				),
			)
		);
		$id = $this->audio();
		Jobs::start( $id );
		$this->assertSame( 'ws_old', get_post_meta( $id, Media::JOB, true )['workspaceId'] );

		// Settings → Change: the site now holds a key of another workspace.
		Settings::set_api_key( 'vs_key_elsewhere' );
		Workspace::remember(
			array(
				'workspace' => array(
					'id'   => 'ws_new',
					'name' => 'New',
				),
			)
		);
		$this->vs->fail = new TranscriberError( 'not found', 'not_found', 404 );
		$this->unthrottle( $id );
		$data = Jobs::refresh( $id );

		$this->assertSame( 'failed', $data['state'] );
		$this->assertSame( 'not_found', $data['errorCode'] );
		$this->assertStringContainsString( 'belongs to another workspace', $data['error'] );
		$this->assertStringContainsString( 'Transcribe the file again', $data['error'] );
		$this->assertStringNotContainsString( 'not found', $data['error'] );
	}

	public function test_a_job_deleted_in_vocalstack_says_so(): void {
		Workspace::remember(
			array(
				'workspace' => array(
					'id'   => 'ws_1',
					'name' => 'Acme',
				),
			)
		);
		$id = $this->audio();
		Jobs::start( $id );
		$this->vs->fail = new TranscriberError( 'not found', 'not_found', 404 );
		$this->unthrottle( $id );

		$this->assertStringContainsString( 'no longer in VocalStack', Jobs::refresh( $id )['error'] );
	}

	public function test_a_missing_job_from_before_workspaces_names_both_reasons(): void {
		$id = $this->audio();
		Jobs::start( $id );
		$this->vs->fail = new TranscriberError( 'not found', 'not_found', 404 );
		$this->unthrottle( $id );

		$error = Jobs::refresh( $id )['error'];

		$this->assertStringContainsString( 'another workspace', $error );
		$this->assertStringContainsString( 'deleted in VocalStack', $error );
	}

	public function test_stop_goes_back_to_the_last_transcript(): void {
		$id = $this->audio();
		update_post_meta( $id, Media::TRANSCRIPT, 'Earlier.' );
		Jobs::start( $id );

		$data = Jobs::stop( $id );

		$this->assertSame( array( 'start', 'stop' ), $this->vs->names() );
		$this->assertSame( 'done', $data['state'] );
		$this->assertSame( 'Earlier.', $data['transcript'] );
	}

	public function test_stop_without_a_transcript_goes_back_to_never_transcribed(): void {
		$id = $this->audio();
		Jobs::start( $id );
		$this->assertSame( '', Jobs::stop( $id )['state'] );
	}

	public function test_cron_polls_unfinished_jobs_and_then_unschedules(): void {
		$id = $this->audio();
		Jobs::start( $id );
		$this->vs->job = array( 'state' => 'done' );

		Jobs::poll();
		$this->assertSame( 'done', get_post_meta( $id, Media::STATE, true ) );

		Jobs::poll();
		$this->assertFalse( wp_next_scheduled( Jobs::POLL_HOOK ) );
	}

	public function test_auto_transcribe_is_off_by_default(): void {
		$this->audio();
		$this->assertFalse( wp_next_scheduled( Jobs::AUTO_HOOK ) );
	}

	public function test_auto_transcribe_audio_skips_video(): void {
		Settings::update( array( 'auto' => 'audio' ) );
		$video = $this->audio( 'video/mp4' );
		$audio = $this->audio();
		$this->assertFalse( wp_next_scheduled( Jobs::AUTO_HOOK, array( $video ) ) );
		$this->assertNotFalse( wp_next_scheduled( Jobs::AUTO_HOOK, array( $audio ) ) );
	}
}
