/**
 * One transcription: player and timed transcript, translation, summary, share
 * links, exports, settings, and archive / restore / delete.
 */
import { Button, Notice, SelectControl, Spinner, TabPanel, TextControl } from '@wordpress/components';
import { useCallback, useEffect, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { arrowLeft } from '@wordpress/icons';
import { languageOptions, SPEAKER_OPTIONS, useLanguages, useLinks } from '../lib/account';
import { errorMessage, seg, vs } from '../lib/api';
import { adminPostUrl, exportNonce } from '../lib/config';
import { bytes, clock, whenLong } from '../lib/format';
import { navigate } from '../lib/router';
import { isRecording, jobLength, RUNNING, sourceLineOf, statusOf, txRow } from '../lib/tx';
import { RecordingView } from '../components/Player';
import ShareLinks from '../components/ShareLinks';
import { ApiBadge, Chip, ErrorNotice, LangLabel, PageHeader, PurgeModal, RowIcon } from '../components/ui';

const POLL_MS = 5000;

export function BackLink( { to, children } ) {
	return (
		<Button className="vsa-back" variant="link" icon={ arrowLeft } onClick={ () => navigate( to ) }>
			{ children }
		</Button>
	);
}

/** The title, renamed in place. */
function Title( { value, onSave } ) {
	const [ editing, setEditing ] = useState( false );
	const [ draft, setDraft ] = useState( value );
	const [ busy, setBusy ] = useState( false );
	if ( ! editing ) {
		return (
			<span className="vsa-title-edit">
				{ value }
				<Button variant="link" onClick={ () => ( setDraft( value ), setEditing( true ) ) }>
					{ __( 'Rename', 'vocalstack' ) }
				</Button>
			</span>
		);
	}
	const save = async () => {
		setBusy( true );
		try {
			await onSave( draft.trim() );
			setEditing( false );
		} finally {
			setBusy( false );
		}
	};
	return (
		<span className="vsa-title-edit is-editing">
			<TextControl
				label={ __( 'Name', 'vocalstack' ) }
				hideLabelFromVision
				value={ draft }
				maxLength={ 80 }
				onChange={ setDraft }
				onKeyDown={ ( e ) => ( e.key === 'Enter' ? save() : e.key === 'Escape' && setEditing( false ) ) }
				__nextHasNoMarginBottom
			/>
			<Button variant="primary" size="compact" onClick={ save } isBusy={ busy } disabled={ ! draft.trim() || busy }>
				{ __( 'Save', 'vocalstack' ) }
			</Button>
			<Button variant="tertiary" size="compact" onClick={ () => setEditing( false ) }>
				{ __( 'Cancel', 'vocalstack' ) }
			</Button>
		</span>
	);
}

function Summary( { recordingId } ) {
	const [ summary, setSummary ] = useState( null );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState( '' );
	const load = useCallback( () => vs( `recordings/${ seg( recordingId ) }/summary` ).then( setSummary, ( e ) => setError( errorMessage( e ) ) ), [ recordingId ] );
	useEffect( () => {
		load();
	}, [ load ] );
	useEffect( () => {
		if ( summary?.state !== 'pending' ) return;
		const t = setTimeout( load, POLL_MS );
		return () => clearTimeout( t );
	}, [ summary, load ] );
	const request = async () => {
		setBusy( true );
		setError( '' );
		try {
			await vs( `recordings/${ seg( recordingId ) }/summarize`, { method: 'POST', idempotent: true } );
			await load();
		} catch ( e ) {
			setError( errorMessage( e ) );
		} finally {
			setBusy( false );
		}
	};
	if ( error ) return <ErrorNotice error={ error } />;
	if ( ! summary ) return <Spinner />;
	if ( summary.state === 'ready' ) {
		return (
			<div className="vsa-summary">
				{ summary.title && <h3>{ summary.title }</h3> }
				{ String( summary.summary ?? '' )
					.split( /\n{2,}/ )
					.map( ( p, i ) => (
						<p key={ i }>{ p }</p>
					) ) }
			</div>
		);
	}
	if ( summary.state === 'pending' ) {
		return (
			<p className="vsa-muted">
				<Spinner /> { __( 'Writing the summary…', 'vocalstack' ) }
			</p>
		);
	}
	return (
		<div>
			<p className="vsa-muted">{ __( 'No summary yet.', 'vocalstack' ) }</p>
			<Button variant="secondary" onClick={ request } isBusy={ busy } disabled={ busy }>
				{ __( 'Write a summary', 'vocalstack' ) }
			</Button>
		</div>
	);
}

function Exports( { recordingId, name } ) {
	const link = ( format ) =>
		`${ adminPostUrl }?${ new URLSearchParams( { action: 'vocalstack_export', recording: recordingId, format, name: name || 'transcript', _wpnonce: exportNonce } ) }`;
	const formats = [
		[ 'pdf', __( 'PDF document', 'vocalstack' ) ],
		[ 'xlsx', __( 'Excel spreadsheet', 'vocalstack' ) ],
		[ 'srt', __( 'SRT subtitles', 'vocalstack' ) ],
		[ 'json', __( 'JSON (sentences, words, timings)', 'vocalstack' ) ],
	];
	return (
		<ul className="vsa-exports">
			{ formats.map( ( [ format, label ] ) => (
				<li key={ format }>
					<Button variant="secondary" href={ link( format ) }>
						{ label }
					</Button>
				</li>
			) ) }
		</ul>
	);
}

function SettingsForm( { transcription, onSaved } ) {
	const languages = useLanguages();
	const [ language, setLanguage ] = useState( transcription.settings?.spokenLanguage ?? '' );
	const [ speakers, setSpeakers ] = useState( transcription.settings?.speakerLabels ?? 'off' );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState( '' );
	const [ saved, setSaved ] = useState( false );
	const save = async () => {
		setBusy( true );
		setError( '' );
		setSaved( false );
		try {
			const t = await vs( `transcriptions/${ seg( transcription.id ) }`, {
				method: 'PATCH',
				data: { settings: { spokenLanguage: language || null, speakerLabels: speakers } },
			} );
			onSaved( t );
			setSaved( true );
		} catch ( e ) {
			setError( errorMessage( e ) );
		} finally {
			setBusy( false );
		}
	};
	return (
		<div className="vsa-form vsa-narrow">
			<p className="vsa-muted">
				{ transcription.live
					? __( 'These apply to the next recordings of this live transcription.', 'vocalstack' )
					: __( 'These apply if the file is transcribed again. The current transcript keeps the settings it was made with.', 'vocalstack' ) }
			</p>
			<SelectControl label={ __( 'Spoken language', 'vocalstack' ) } value={ language } options={ languageOptions( languages ) } onChange={ setLanguage } __nextHasNoMarginBottom />
			<SelectControl label={ __( 'Speaker labels', 'vocalstack' ) } value={ speakers } options={ SPEAKER_OPTIONS } onChange={ setSpeakers } __nextHasNoMarginBottom />
			<ErrorNotice error={ error } />
			{ saved && <Notice status="success" onRemove={ () => setSaved( false ) }>{ __( 'Settings saved.', 'vocalstack' ) }</Notice> }
			<div>
				<Button variant="primary" onClick={ save } isBusy={ busy } disabled={ busy }>
					{ __( 'Save settings', 'vocalstack' ) }
				</Button>
			</div>
		</div>
	);
}

/** Pause / resume / stop for a live recording VocalStack is pulling. */
export function LiveControls( { recording, onChange } ) {
	const [ busy, setBusy ] = useState( '' );
	const [ error, setError ] = useState( '' );
	const act = async ( action ) => {
		setBusy( action );
		setError( '' );
		try {
			if ( action === 'stop' && recording.state === 'live' ) {
				// VocalStack stops a live recording only once it is paused.
				await vs( `recordings/${ seg( recording.recordingId ) }/pause`, { method: 'POST' } );
			}
			await vs( `recordings/${ seg( recording.recordingId ) }/${ action }`, { method: 'POST', data: action === 'stop' ? { reason: 'Stopped from WordPress' } : undefined } );
			onChange();
		} catch ( e ) {
			setError( errorMessage( e ) );
		} finally {
			setBusy( '' );
		}
	};
	return (
		<div className="vsa-live-controls">
			<Chip tone={ recording.state === 'live' ? 'live' : 'warning' }>{ recording.state === 'live' ? __( 'LIVE', 'vocalstack' ) : __( 'PAUSED', 'vocalstack' ) }</Chip>
			{ recording.state === 'live' ? (
				<Button variant="secondary" size="compact" onClick={ () => act( 'pause' ) } isBusy={ busy === 'pause' } disabled={ Boolean( busy ) }>
					{ __( 'Pause', 'vocalstack' ) }
				</Button>
			) : (
				<Button variant="secondary" size="compact" onClick={ () => act( 'resume' ) } isBusy={ busy === 'resume' } disabled={ Boolean( busy ) }>
					{ __( 'Resume', 'vocalstack' ) }
				</Button>
			) }
			<Button variant="secondary" size="compact" isDestructive onClick={ () => act( 'stop' ) } isBusy={ busy === 'stop' } disabled={ Boolean( busy ) }>
				{ __( 'Stop', 'vocalstack' ) }
			</Button>
			<ErrorNotice error={ error } />
		</div>
	);
}

/** A live transcription's recordings, newest first; picking one shows it. */
function RecordingsPicker( { transcriptionId, value, onChange } ) {
	const [ recordings, setRecordings ] = useState( null );
	useEffect( () => {
		vs( `transcriptions/${ seg( transcriptionId ) }/recordings`, { query: { limit: 50 } } ).then(
			( r ) => setRecordings( r.recordings ?? [] ),
			() => setRecordings( [] )
		);
	}, [ transcriptionId ] );
	if ( ! recordings?.length || recordings.length < 2 ) return null;
	return (
		<SelectControl
			label={ __( 'Recording', 'vocalstack' ) }
			value={ value ?? '' }
			options={ recordings.map( ( r ) => ( {
				value: r.id,
				label: `${ r.title || whenLong( r.startedAt ) }${ r.mediaDurationS ? ` · ${ clock( r.mediaDurationS ) }` : '' }`,
			} ) ) }
			onChange={ onChange }
			__nextHasNoMarginBottom
		/>
	);
}

export default function TranscriptionDetail( { id } ) {
	const languages = useLanguages();
	const links = useLinks();
	const [ t, setT ] = useState( null );
	const [ error, setError ] = useState( '' );
	const [ notice, setNotice ] = useState( '' );
	const [ recordingId, setRecordingId ] = useState( null );
	const [ lang, setLang ] = useState( '' );
	const [ busy, setBusy ] = useState( '' );
	const [ purging, setPurging ] = useState( false );

	const load = useCallback( async () => {
		try {
			const fresh = await vs( `transcriptions/${ seg( id ) }` );
			setT( fresh );
			setRecordingId( ( current ) => current ?? fresh.job?.recordingId ?? fresh.currentRecording?.recordingId ?? fresh.lastRecording?.recordingId ?? null );
		} catch ( e ) {
			setError( errorMessage( e ) );
		}
	}, [ id ] );

	useEffect( () => {
		setT( null );
		setRecordingId( null );
		load();
	}, [ load ] );

	const running = t && ( RUNNING.includes( t.job?.state ) || isRecording( t ) );
	useEffect( () => {
		if ( ! running ) return;
		const timer = setInterval( load, POLL_MS );
		return () => clearInterval( timer );
	}, [ running, load ] );

	const act = async ( action, after ) => {
		setBusy( action );
		setNotice( '' );
		try {
			await vs( `transcriptions/${ seg( id ) }/${ action }`, { method: 'POST' } );
			after ? after() : await load();
		} catch ( e ) {
			setNotice( errorMessage( e ) );
		} finally {
			setBusy( '' );
		}
	};

	const retry = async () => {
		setBusy( 'retry' );
		setNotice( '' );
		try {
			await vs( `recordings/${ seg( t.job.recordingId ) }/job/retry`, { method: 'POST' } );
			await load();
		} catch ( e ) {
			setNotice( errorMessage( e ) );
		} finally {
			setBusy( '' );
		}
	};

	const back = <BackLink to="/transcriptions">{ __( 'Transcriptions', 'vocalstack' ) }</BackLink>;

	if ( error ) {
		return (
			<div className="vsa-screen">
				{ back }
				<ErrorNotice error={ error } />
			</div>
		);
	}
	if ( ! t ) return <Spinner />;

	const row = txRow( t );
	const status = statusOf( t );
	const source = t.job?.source;
	const meta = [ sourceLineOf( t ), source?.format, source?.bytes ? bytes( source.bytes ) : null ].filter( Boolean ).join( ' · ' );
	const length = t.live ? ( t.lastRecording?.durationS ? clock( t.lastRecording.durationS ) : null ) : jobLength( t.job ) ? clock( jobLength( t.job ) ) : null;
	const archived = t.lifecycle === 'archived';
	const failed = t.job?.state === 'failed';
	const live = t.currentRecording && [ 'live', 'paused' ].includes( t.currentRecording.state ) ? t.currentRecording : null;
	const translatable = [ { value: '', label: __( 'Original', 'vocalstack' ) }, ...languageOptions( languages.filter( ( l ) => l.translation ), { auto: false } ) ];
	const link = links[ t.id ];

	const rename = async ( name ) => {
		const fresh = await vs( `transcriptions/${ seg( id ) }`, { method: 'PATCH', data: { name } } );
		setT( fresh );
	};

	const tabs = [
		{ name: 'transcript', title: __( 'Transcript', 'vocalstack' ) },
		{ name: 'summary', title: __( 'Summary', 'vocalstack' ) },
		{ name: 'share', title: __( 'Share', 'vocalstack' ) },
		{ name: 'export', title: __( 'Export', 'vocalstack' ) },
		{ name: 'settings', title: __( 'Settings', 'vocalstack' ) },
	];

	return (
		<div className="vsa-screen vsa-detail">
			<PageHeader
				back={ back }
				title={
					<span className="vsa-detail__title">
						<RowIcon kind={ row.icon } />
						<Title value={ row.title } onSave={ rename } />
						{ row.api && <ApiBadge /> }
						{ status && <Chip tone={ status.key === 'failed' ? 'error' : 'info' }>{ status.label }</Chip> }
						{ archived && <Chip tone="warning">{ __( 'Archived', 'vocalstack' ) }</Chip> }
					</span>
				}
				subtitle={
					<span className="vsa-detail__meta">
						<span>{ meta }</span>
						{ length && <span>{ length }</span> }
						<LangLabel code={ t.settings?.spokenLanguage } />
						{ link && (
							<a href={ link.editUrl }>
								{ __( 'Open in Media Library', 'vocalstack' ) }
							</a>
						) }
					</span>
				}
				actions={
					archived ? (
						<>
							<Button variant="secondary" onClick={ () => act( 'restore' ) } isBusy={ busy === 'restore' } disabled={ Boolean( busy ) }>
								{ __( 'Restore', 'vocalstack' ) }
							</Button>
							<Button variant="secondary" isDestructive onClick={ () => setPurging( true ) } disabled={ Boolean( busy ) }>
								{ __( 'Delete permanently', 'vocalstack' ) }
							</Button>
						</>
					) : (
						<Button
							variant="secondary"
							onClick={ () => act( 'archive', () => navigate( '/transcriptions' ) ) }
							isBusy={ busy === 'archive' }
							disabled={ Boolean( busy ) || Boolean( live ) }
							title={ live ? __( 'Stop the live recording before archiving.', 'vocalstack' ) : undefined }
						>
							{ __( 'Archive', 'vocalstack' ) }
						</Button>
					)
				}
			/>

			<ErrorNotice error={ notice } onRemove={ () => setNotice( '' ) } />

			{ failed && (
				<Notice status="error" isDismissible={ false }>
					<p>{ t.job.error || __( 'The transcription failed.', 'vocalstack' ) }</p>
					{ t.job.errorCode !== 'stopped' && (
						<Button variant="secondary" onClick={ retry } isBusy={ busy === 'retry' } disabled={ Boolean( busy ) }>
							{ __( 'Retry', 'vocalstack' ) }
						</Button>
					) }
				</Notice>
			) }

			{ status?.pct !== undefined && (
				<div className="vsa-progress">
					<progress max="100" value={ status.pct } />
					<span>{ status.label }</span>
				</div>
			) }

			{ live && <LiveControls recording={ live } onChange={ load } /> }

			<TabPanel className="vsa-tabs" tabs={ tabs }>
				{ ( tab ) => (
					<div className="vsa-tab">
						{ tab.name === 'transcript' &&
							( recordingId ? (
								<>
									<div className="vsa-toolbar">
										{ t.live && <RecordingsPicker transcriptionId={ t.id } value={ recordingId } onChange={ setRecordingId } /> }
										<SelectControl label={ __( 'Language', 'vocalstack' ) } value={ lang } options={ translatable } onChange={ setLang } __nextHasNoMarginBottom />
									</div>
									<RecordingView recordingId={ recordingId } lang={ lang || undefined } playable={ ! failed && ( t.job?.hasAudio ?? true ) } />
								</>
							) : (
								<p className="vsa-muted">{ __( 'Nothing recorded yet.', 'vocalstack' ) }</p>
							) ) }
						{ tab.name === 'summary' && ( recordingId ? <Summary recordingId={ recordingId } /> : <p className="vsa-muted">{ __( 'Nothing recorded yet.', 'vocalstack' ) }</p> ) }
						{ tab.name === 'share' && <ShareLinks parent="transcriptions" id={ t.id } /> }
						{ tab.name === 'export' &&
							( recordingId ? (
								<>
									<p className="vsa-muted">
										{ RUNNING.includes( t.job?.state ) ? __( 'The transcription is still running: an export now holds what is done so far.', 'vocalstack' ) : __( 'Download the transcript.', 'vocalstack' ) }
									</p>
									<Exports recordingId={ recordingId } name={ t.name } />
								</>
							) : (
								<p className="vsa-muted">{ __( 'Nothing recorded yet.', 'vocalstack' ) }</p>
							) ) }
						{ tab.name === 'settings' && <SettingsForm transcription={ t } onSaved={ setT } /> }
					</div>
				) }
			</TabPanel>

			{ purging && (
				<PurgeModal
					what={ row.title }
					onClose={ () => setPurging( false ) }
					onConfirm={ async () => {
						await vs( `transcriptions/${ seg( id ) }/purge`, { method: 'POST' } );
						navigate( '/transcriptions' );
					} }
				/>
			) }
		</div>
	);
}
