/**
 * A broadcast as a list row, following the dashboard's rules.
 */
import { __, sprintf } from '@wordpress/i18n';
import { bareUrl, captureClass } from './format';

/** The recording on air now, if any. */
export const liveRecordingOf = ( b ) => ( [ 'live', 'paused', 'pending' ].includes( b?.currentRecording?.state ) ? b.currentRecording : null );

/** "Sat, 18 Oct · 09:38" */
function recordingWhen( iso ) {
	const d = new Date( iso );
	return `${ d.toLocaleDateString( undefined, { weekday: 'short', day: 'numeric', month: 'short' } ) } · ${ d.toLocaleTimeString( undefined, { hour: '2-digit', minute: '2-digit' } ) }`;
}

export function broadcastRow( b ) {
	const live = liveRecordingOf( b );
	const last = b.lastRecording ?? null;
	const tile = live ? new Date() : last?.startedAt ? new Date( last.startedAt ) : null;
	const fed = ( b.transcriptions ?? [] ).find( ( t ) => t.id === ( live ?? last )?.transcriptionId );
	let tileTitle = __( 'No recordings yet', 'vocalstack' );
	if ( live ) tileTitle = __( 'Recording now', 'vocalstack' );
	else if ( last?.startedAt ) {
		/* translators: %s: date and time */
		tileTitle = sprintf( __( 'Last recording · %s', 'vocalstack' ), recordingWhen( last.startedAt ) );
	}
	return {
		id: b.id,
		name: b.name,
		url: bareUrl( b.shareUrl ),
		shareUrl: b.shareUrl,
		private: b.access === 'private',
		lang: b.settings?.spokenLanguage ?? null,
		tile,
		tileTitle,
		liveState: live ? ( live.state === 'paused' ? 'paused' : 'live' ) : null,
		listeners: b.listenersNow ?? null,
		chip: last || live ? { icon: captureClass( fed?.source ?? b.source ), label: ( live ?? last ).title?.trim() || recordingWhen( ( live ?? last ).startedAt ) } : null,
		more: Math.max( 0, ( b.recordingCount ?? 0 ) - 1 ),
		sortAt: b.lastRecordedAt ?? b.createdAt,
		raw: b,
	};
}

export const INFO = __( 'A broadcast is one public link. Attach any number of live transcriptions to it — a radio stream and a YouTube live can share the same broadcast.', 'vocalstack' );
