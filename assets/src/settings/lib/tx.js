/**
 * A transcription as a list row, following the dashboard's rules: which icon,
 * source line, length, language, date and status it shows.
 */
import { __, sprintf } from '@wordpress/i18n';
import { bareUrl, captureClass, CAPTURE_LABEL, clock, isVideo, youtubeId } from './format';

export const RUNNING = [ 'queued', 'fetching', 'cropping', 'transcribing' ];

/** Whether a live transcription is recording now. */
export const isRecording = ( t ) => [ 'live', 'paused', 'pending' ].includes( t?.currentRecording?.state );

/** The audio length in seconds of a file or link job. */
export function jobLength( job ) {
	if ( ! job ) return 0;
	const total = job.crop?.endS ?? job.source?.durationS ?? job.progress?.totalS ?? 0;
	return Math.max( 0, total - ( job.crop?.startS ?? 0 ) );
}

/** The status chip: { key, label, pct } or null for a finished transcription. */
export function statusOf( t ) {
	if ( t.live ) {
		return isRecording( t ) ? { key: 'recording', label: __( 'RECORDING', 'vocalstack' ) } : null;
	}
	const job = t.job;
	switch ( job?.state ) {
		case undefined:
		case 'done':
			return null;
		case 'transcribing': {
			const pct = Math.round( job.progress?.pct ?? 0 );
			/* translators: %d: percent */
			return { key: 'transcribing', label: sprintf( __( 'TRANSCRIBING %d%%', 'vocalstack' ), pct ), pct };
		}
		case 'cropping':
			return { key: 'cropping', label: __( 'TRIMMING', 'vocalstack' ) };
		case 'failed':
			if ( job.errorCode === 'stopped' ) return { key: 'stopped', label: __( 'STOPPED', 'vocalstack' ) };
			if ( youtubeId( job.source?.url ) && /live stream/i.test( job.error ?? '' ) ) {
				return { key: 'failed', label: __( 'LIVE STREAM', 'vocalstack' ) };
			}
			return { key: 'failed', label: __( 'FAILED', 'vocalstack' ) };
		case 'stopped':
			return { key: 'stopped', label: __( 'STOPPED', 'vocalstack' ) };
		default:
			return { key: 'queued', label: __( 'QUEUED', 'vocalstack' ) };
	}
}

/** The row's icon kind: music, video, mic, youtube, radio, rtmp. */
export function iconOf( t ) {
	if ( t.live ) return captureClass( t.source );
	const source = t.job?.source;
	if ( source?.kind === 'url' && youtubeId( source.url ) ) return 'youtube';
	return isVideo( source ) ? 'video' : 'music';
}

/** "Uploaded file", "From URL · host/path", "Microphone", … */
export function sourceLineOf( t ) {
	if ( t.live ) {
		const kind = captureClass( t.source );
		return kind === 'youtube' || kind === 'radio' ? bareUrl( t.source.url ) : CAPTURE_LABEL[ kind ];
	}
	const source = t.job?.source;
	if ( source?.kind === 'url' ) {
		/* translators: %s: link without its scheme */
		return youtubeId( source.url ) ? bareUrl( source.url ) : sprintf( __( 'From URL · %s', 'vocalstack' ), bareUrl( source.url ?? source.name ) );
	}
	return __( 'Uploaded file', 'vocalstack' );
}

/** The date the row sorts and shows by. */
export function atOf( t ) {
	if ( t.live ) return t.currentRecording?.startedAt ?? t.lastRecording?.startedAt ?? t.lastRecordedAt ?? t.createdAt;
	return t.job?.createdAt ?? t.createdAt;
}

/** The recording a transcription's detail opens on. */
export const recordingIdOf = ( t ) => t?.job?.recordingId ?? t?.currentRecording?.recordingId ?? t?.lastRecording?.recordingId ?? null;

/** The row model. */
export function txRow( t ) {
	const recording = isRecording( t );
	let len;
	if ( t.live ) {
		len = recording ? __( 'LIVE', 'vocalstack' ) : t.lastRecording?.durationS ? clock( t.lastRecording.durationS ) : '—';
	} else {
		const s = jobLength( t.job );
		len = s ? clock( s ) : '—';
	}
	return {
		id: t.id,
		title: ( t.live && t.lastRecording?.title?.trim() ) || t.name || __( 'Untitled', 'vocalstack' ),
		icon: iconOf( t ),
		api: Boolean( t.createdByApiKeyId ),
		broadcasts: t.live ? ( t.broadcasts ?? [] ) : null,
		sourceLine: sourceLineOf( t ),
		len,
		lang: t.settings?.spokenLanguage ?? null,
		at: atOf( t ),
		status: statusOf( t ),
		running: RUNNING.includes( t.job?.state ) || recording,
		thumb: t.job?.source?.kind === 'url' && youtubeId( t.job.source.url ) ? `https://i.ytimg.com/vi/${ youtubeId( t.job.source.url ) }/mqdefault.jpg` : null,
		raw: t,
	};
}
