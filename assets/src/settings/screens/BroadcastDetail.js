/**
 * One broadcast: its recordings, settings, audio sources and sharing.
 */
import { Button, Notice, Spinner, TabPanel, TextControl } from '@wordpress/components';
import { useCallback, useEffect, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { lock } from '@wordpress/icons';
import { errorMessage, seg, vs } from '../lib/api';
import { broadcastRow, INFO, liveRecordingOf } from '../lib/broadcast';
import { bareUrl, captureClass, CAPTURE_LABEL, clock, whenLong } from '../lib/format';
import { navigate } from '../lib/router';
import { RecordingView } from '../components/Player';
import ShareLinks from '../components/ShareLinks';
import { Chip, CopyField, ErrorNotice, LangLabel, PageHeader, PurgeModal, RowIcon } from '../components/ui';
import { BroadcastFields, broadcastBody, CODE_MIN } from './NewBroadcast';
import { BackLink, LiveControls } from './TranscriptionDetail';

const POLL_MS = 5000;

function Recordings( { broadcast } ) {
	const [ items, setItems ] = useState( null );
	const [ cursor, setCursor ] = useState( null );
	const [ open, setOpen ] = useState( null );
	const [ error, setError ] = useState( '' );

	const load = useCallback(
		async ( next = null ) => {
			try {
				const r = await vs( `broadcasts/${ seg( broadcast.id ) }/recordings`, { query: { limit: 25, cursor: next } } );
				setItems( ( prev ) => ( next ? [ ...( prev ?? [] ), ...( r.recordings ?? [] ) ] : r.recordings ?? [] ) );
				setCursor( r.nextCursor ?? null );
			} catch ( e ) {
				setError( errorMessage( e ) );
				setItems( [] );
			}
		},
		[ broadcast.id ]
	);

	useEffect( () => {
		load();
	}, [ load, broadcast.recordingCount ] );

	if ( error ) return <ErrorNotice error={ error } />;
	if ( ! items ) return <Spinner />;
	if ( ! items.length ) {
		return (
			<div className="vsa-howto">
				<p>{ __( 'Nothing recorded yet. To go live:', 'vocalstack' ) }</p>
				<ol>
					<li>{ __( 'Add an audio source on the Sources tab: a YouTube live, a radio or HLS stream, or an RTMP feed.', 'vocalstack' ) }</li>
					<li>{ __( 'Start a recording from that source.', 'vocalstack' ) }</li>
					{ /* translators: %s: the broadcast's link */ }
					<li>{ sprintf( __( 'Share %s: listeners follow the transcript live.', 'vocalstack' ), bareUrl( broadcast.shareUrl ) ) }</li>
				</ol>
			</div>
		);
	}
	return (
		<>
			<ul className="vsa-list is-compact">
				{ items.map( ( r ) => {
					const expanded = open === r.id;
					return (
						<li key={ r.id } className="vsa-row">
							<div className="vsa-row__main" role="button" tabIndex={ 0 } aria-expanded={ expanded } onClick={ () => setOpen( expanded ? null : r.id ) } onKeyDown={ ( e ) => ( e.key === 'Enter' || e.key === ' ' ) && ( e.preventDefault(), setOpen( expanded ? null : r.id ) ) }>
								<RowIcon kind={ r.kind === 'upload' ? 'music' : 'broadcast' } />
								<div className="vsa-row__text">
									<div className="vsa-row__title">
										<span className="vsa-row__name">{ r.title?.trim() || whenLong( r.startedAt ) }</span>
										{ [ 'live', 'paused' ].includes( r.state ) && <Chip tone="live">{ r.state === 'live' ? __( 'LIVE', 'vocalstack' ) : __( 'PAUSED', 'vocalstack' ) }</Chip> }
									</div>
									<div className="vsa-row__sub">{ whenLong( r.startedAt ) }</div>
								</div>
								<span className="vsa-row__len">{ r.mediaDurationS ? clock( r.mediaDurationS ) : '—' }</span>
								<Button
									variant="link"
									onClick={ ( e ) => {
										e.stopPropagation();
										navigate( `/transcriptions/${ r.transcriptionId }` );
									} }
								>
									{ __( 'Open transcription', 'vocalstack' ) }
								</Button>
							</div>
							{ expanded && (
								<div className="vsa-row__detail">
									<RecordingView recordingId={ r.id } playable={ [ 'ended', 'finalized' ].includes( r.state ) } />
								</div>
							) }
						</li>
					);
				} ) }
			</ul>
			{ cursor && (
				<Button variant="secondary" onClick={ () => load( cursor ) }>
					{ __( 'Load more', 'vocalstack' ) }
				</Button>
			) }
		</>
	);
}

function Sources( { broadcast, onChange } ) {
	const [ url, setUrl ] = useState( '' );
	const [ name, setName ] = useState( '' );
	const [ checks, setChecks ] = useState( {} );
	const [ busy, setBusy ] = useState( '' );
	const [ error, setError ] = useState( '' );
	const live = liveRecordingOf( broadcast );

	const run = async ( key, fn ) => {
		setBusy( key );
		setError( '' );
		try {
			await fn();
		} catch ( e ) {
			setError( errorMessage( e ) );
		} finally {
			setBusy( '' );
		}
	};

	const check = ( source ) =>
		run( `check:${ source.id }`, async () => {
			const r = await vs( `broadcasts/${ seg( broadcast.id ) }/audio-sources/${ seg( source.id ) }/check`, { query: { fresh: 1 } } );
			setChecks( ( c ) => ( { ...c, [ source.id ]: r } ) );
		} );

	return (
		<div className="vsa-sources">
			<p className="vsa-muted">{ __( 'An audio source is a stream VocalStack pulls and transcribes live: a YouTube live, an Icecast or HLS radio stream, or an RTMP feed.', 'vocalstack' ) }</p>
			<ErrorNotice error={ error } onRemove={ () => setError( '' ) } />
			{ live && <LiveControls recording={ live } onChange={ onChange } /> }
			<ul className="vsa-list is-compact">
				{ ( broadcast.audioSources ?? [] ).map( ( source ) => {
					const result = checks[ source.id ];
					const kind = captureClass( source );
					return (
						<li key={ source.id } className="vsa-row">
							<div className="vsa-row__main is-static">
								<RowIcon kind={ kind } />
								<div className="vsa-row__text">
									<div className="vsa-row__title">
										<span className="vsa-row__name">{ source.name || CAPTURE_LABEL[ kind ] }</span>
									</div>
									<div className="vsa-row__sub vsa-mono">{ bareUrl( source.url ) }</div>
								</div>
								<span className="vsa-row__actions">
									<Button variant="secondary" size="compact" onClick={ () => check( source ) } isBusy={ busy === `check:${ source.id }` } disabled={ Boolean( busy ) }>
										{ __( 'Check', 'vocalstack' ) }
									</Button>
									<Button
										variant="primary"
										size="compact"
										disabled={ Boolean( busy ) || Boolean( live ) }
										isBusy={ busy === `start:${ source.id }` }
										title={ live ? __( 'A recording is already on air.', 'vocalstack' ) : undefined }
										onClick={ () =>
											run( `start:${ source.id }`, async () => {
												await vs( `broadcasts/${ seg( broadcast.id ) }/recordings`, { method: 'POST', idempotent: true, data: { audioSource: source.id } } );
												onChange();
											} )
										}
									>
										{ __( 'Start recording', 'vocalstack' ) }
									</Button>
									<Button
										variant="tertiary"
										size="compact"
										isDestructive
										disabled={ Boolean( busy ) }
										onClick={ () =>
											run( `remove:${ source.id }`, async () => {
												await vs( `broadcasts/${ seg( broadcast.id ) }/audio-sources/${ seg( source.id ) }`, { method: 'DELETE' } );
												onChange();
											} )
										}
									>
										{ __( 'Remove', 'vocalstack' ) }
									</Button>
								</span>
							</div>
							{ result && (
								<div className="vsa-row__detail">
									<Notice status={ result.state === 'ready' ? 'success' : 'warning' } isDismissible={ false }>
										<p>{ result.state === 'ready' ? __( 'The stream is reachable.', 'vocalstack' ) : result.message || result.problem }</p>
										{ result.fix && <p>{ result.fix }</p> }
									</Notice>
								</div>
							) }
						</li>
					);
				} ) }
				{ ! broadcast.audioSources?.length && <li className="vsa-empty">{ __( 'No audio sources yet.', 'vocalstack' ) }</li> }
			</ul>
			<h3>{ __( 'Add a source', 'vocalstack' ) }</h3>
			<div className="vsa-inline">
				<TextControl label={ __( 'Stream URL', 'vocalstack' ) } type="url" value={ url } onChange={ setUrl } placeholder="https://" __nextHasNoMarginBottom />
				<TextControl label={ __( 'Name (optional)', 'vocalstack' ) } value={ name } onChange={ setName } __nextHasNoMarginBottom />
				<Button
					variant="secondary"
					disabled={ ! url.trim() || Boolean( busy ) }
					isBusy={ busy === 'add' }
					onClick={ () =>
						run( 'add', async () => {
							await vs( `broadcasts/${ seg( broadcast.id ) }/audio-sources`, { method: 'POST', data: { url: url.trim(), ...( name.trim() ? { name: name.trim() } : {} ) } } );
							setUrl( '' );
							setName( '' );
							onChange();
						} )
					}
				>
					{ __( 'Add source', 'vocalstack' ) }
				</Button>
			</div>
		</div>
	);
}

function Settings( { broadcast, onSaved } ) {
	const [ values, setValues ] = useState( {
		name: broadcast.name ?? '',
		code: broadcast.code ?? '',
		language: broadcast.settings?.spokenLanguage ?? '',
		speakers: broadcast.settings?.speakerLabels ?? 'auto',
		access: broadcast.access ?? 'public',
		password: '',
	} );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState( '' );
	const [ saved, setSaved ] = useState( false );
	const becomingPrivate = values.access === 'private' && broadcast.access !== 'private';
	const save = async () => {
		setBusy( true );
		setError( '' );
		setSaved( false );
		try {
			onSaved( await vs( `broadcasts/${ seg( broadcast.id ) }`, { method: 'PATCH', data: broadcastBody( values ) } ) );
			setSaved( true );
		} catch ( e ) {
			setError( errorMessage( e ) );
		} finally {
			setBusy( false );
		}
	};
	return (
		<div className="vsa-narrow">
			<BroadcastFields values={ values } onChange={ setValues } />
			<ErrorNotice error={ error } />
			{ saved && <Notice status="success" onRemove={ () => setSaved( false ) }>{ __( 'Broadcast saved.', 'vocalstack' ) }</Notice> }
			<Button variant="primary" onClick={ save } isBusy={ busy } disabled={ busy || ! values.name.trim() || values.code.length < CODE_MIN || ( becomingPrivate && ! values.password ) }>
				{ __( 'Save broadcast', 'vocalstack' ) }
			</Button>
		</div>
	);
}

export default function BroadcastDetail( { id } ) {
	const [ b, setB ] = useState( null );
	const [ error, setError ] = useState( '' );
	const [ notice, setNotice ] = useState( '' );
	const [ busy, setBusy ] = useState( '' );
	const [ purging, setPurging ] = useState( false );

	const load = useCallback( async () => {
		try {
			setB( await vs( `broadcasts/${ seg( id ) }` ) );
		} catch ( e ) {
			setError( errorMessage( e ) );
		}
	}, [ id ] );

	useEffect( () => {
		setB( null );
		load();
	}, [ load ] );

	const live = b ? liveRecordingOf( b ) : null;
	useEffect( () => {
		if ( ! live ) return;
		const timer = setInterval( load, POLL_MS );
		return () => clearInterval( timer );
	}, [ live, load ] );

	const act = async ( action, after ) => {
		setBusy( action );
		setNotice( '' );
		try {
			await vs( `broadcasts/${ seg( id ) }/${ action }`, { method: 'POST' } );
			after ? after() : await load();
		} catch ( e ) {
			setNotice( errorMessage( e ) );
		} finally {
			setBusy( '' );
		}
	};

	const back = <BackLink to="/broadcasts">{ __( 'Broadcasts', 'vocalstack' ) }</BackLink>;
	if ( error ) {
		return (
			<div className="vsa-screen">
				{ back }
				<ErrorNotice error={ error } />
			</div>
		);
	}
	if ( ! b ) return <Spinner />;

	const row = broadcastRow( b );
	const archived = b.lifecycle === 'archived';

	return (
		<div className="vsa-screen vsa-detail">
			<PageHeader
				back={ back }
				title={
					<span className="vsa-detail__title">
						{ row.name }
						{ row.liveState && <Chip tone="live">{ row.liveState === 'live' ? __( 'LIVE', 'vocalstack' ) : __( 'PAUSED', 'vocalstack' ) }</Chip> }
						{ row.private && <Chip icon={ lock }>{ __( 'Private', 'vocalstack' ) }</Chip> }
						{ archived && <Chip tone="warning">{ __( 'Archived', 'vocalstack' ) }</Chip> }
					</span>
				}
				subtitle={
					<span className="vsa-detail__meta">
						<a href={ b.shareUrl } target="_blank" rel="noreferrer" className="vsa-mono">
							{ row.url }
						</a>
						<LangLabel code={ row.lang } native />
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
						<>
							<Button variant="primary" onClick={ () => navigate( `/live/${ id }` ) } disabled={ Boolean( busy ) }>
								{ live ? __( 'Take over live', 'vocalstack' ) : __( 'Go live', 'vocalstack' ) }
							</Button>
						<Button variant="secondary" onClick={ () => act( 'archive', () => navigate( '/broadcasts' ) ) } isBusy={ busy === 'archive' } disabled={ Boolean( busy ) || Boolean( live ) } title={ live ? __( 'Stop the live recording before archiving.', 'vocalstack' ) : undefined }>
							{ __( 'Archive', 'vocalstack' ) }
						</Button>
						</>
					)
				}
			/>
			<ErrorNotice error={ notice } onRemove={ () => setNotice( '' ) } />
			{ live && <LiveControls recording={ live } onChange={ load } /> }
			<TabPanel
				className="vsa-tabs"
				tabs={ [
					{ name: 'recordings', title: __( 'Recordings', 'vocalstack' ) },
					{ name: 'sources', title: __( 'Sources', 'vocalstack' ) },
					{ name: 'settings', title: __( 'Settings', 'vocalstack' ) },
					{ name: 'share', title: __( 'Share', 'vocalstack' ) },
				] }
			>
				{ ( tab ) => (
					<div className="vsa-tab">
						{ tab.name === 'recordings' && <Recordings broadcast={ b } /> }
						{ tab.name === 'sources' && <Sources broadcast={ b } onChange={ load } /> }
						{ tab.name === 'settings' && <Settings broadcast={ b } onSaved={ setB } /> }
						{ tab.name === 'share' && (
							<div className="vsa-form">
								<p className="vsa-muted">{ INFO }</p>
								<CopyField value={ b.shareUrl } label={ __( 'Broadcast link', 'vocalstack' ) } />
								<p className="vsa-muted">
									{ b.access === 'private'
										? __( 'Private: listeners need the password. The VocalStack player widget can’t show private broadcasts on your site.', 'vocalstack' )
										: __( 'Public: anyone with the link can follow. Show it on your site with the VocalStack player widget (Widgets).', 'vocalstack' ) }
								</p>
								<h3>{ __( 'Share links', 'vocalstack' ) }</h3>
								<ShareLinks parent="broadcasts" id={ b.id } />
							</div>
						) }
					</div>
				) }
			</TabPanel>
			{ purging && (
				<PurgeModal
					what={ row.name }
					onClose={ () => setPurging( false ) }
					onConfirm={ async () => {
						await vs( `broadcasts/${ seg( id ) }/purge`, { method: 'POST' } );
						navigate( '/broadcasts' );
					} }
				/>
			) }
		</div>
	);
}
