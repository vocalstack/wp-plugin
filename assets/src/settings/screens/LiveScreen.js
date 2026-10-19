/**
 * Live: record a live transcription, as the VocalStack dashboard's "New live
 * transcription" does. Choose the audio (this browser's microphone or a tab's
 * sound, a stream VocalStack pulls, or RTMP from streaming software), then a
 * broadcast to put it on (one of the account's, a new one made on the spot,
 * or none), and start. The transcript appears as it is spoken; listeners
 * follow it, in their own language, on the broadcast's page.
 *
 * #/live opens the form; #/live/<broadcast id> opens it with that broadcast chosen.
 */
import { Button, Card, CardBody, CardHeader, ExternalLink, Notice, RadioControl, SelectControl, Spinner, TextControl } from '@wordpress/components';
import { useEffect, useRef, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { canCaptureTab, requestStream } from '../../widgets/shared/capture';
import LiveRecorder from '../components/LiveRecorder';
import { CopyField, ErrorNotice, PageHeader } from '../components/ui';
import { languageOptions, SPEAKER_OPTIONS, useLanguages } from '../lib/account';
import { errorMessage, seg, vs } from '../lib/api';
import { clock, slugify } from '../lib/format';
import { navigate } from '../lib/router';
import { CODE_MIN } from './NewBroadcast';

const NONE = '';
const NEW = '__new';

/** "Live — Oct 19, 19:42" */
const defaultName = () =>
	sprintf(
		/* translators: %s: date and time */
		__( 'Live — %s', 'vocalstack' ),
		new Date().toLocaleString( undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } )
	);

export default function LiveScreen( { broadcastId = '' } ) {
	const languages = useLanguages();
	const [ source, setSource ] = useState( 'mic' );
	const [ url, setUrl ] = useState( '' );
	const [ name, setName ] = useState( '' );
	const [ language, setLanguage ] = useState( '' );
	const [ speakers, setSpeakers ] = useState( 'auto' );
	const [ broadcasts, setBroadcasts ] = useState( null );
	const [ feed, setFeed ] = useState( broadcastId || NONE );
	const [ fresh, setFresh ] = useState( { name: '', code: '', codeTouched: false, access: 'public', password: '' } );
	const [ suggestions, setSuggestions ] = useState( [] );
	const [ rtmp, setRtmp ] = useState( null );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState( '' );
	const [ session, setSession ] = useState( null );

	useEffect( () => {
		vs( 'broadcasts', { query: { lifecycle: 'active' } } ).then(
			( r ) => setBroadcasts( r?.broadcasts ?? [] ),
			( e ) => {
				setBroadcasts( [] );
				setError( errorMessage( e ) );
			}
		);
	}, [] );

	useEffect( () => {
		if ( source === 'rtmp' && ! rtmp ) {
			vs( 'rtmp' ).then( setRtmp, ( e ) => setError( errorMessage( e ) ) );
		}
	}, [ source, rtmp ] );

	if ( session ) {
		return <LiveSession session={ session } />;
	}

	const chosen = broadcasts?.find( ( b ) => b.id === feed );
	const sources = [
		{ value: 'mic', label: __( 'Microphone', 'vocalstack' ) },
		...( canCaptureTab() ? [ { value: 'tab', label: __( 'A browser tab’s sound (Chrome and Edge)', 'vocalstack' ) } ] : [] ),
		{ value: 'stream', label: __( 'A stream VocalStack pulls (YouTube live, radio, HLS)', 'vocalstack' ) },
		{ value: 'rtmp', label: __( 'Streaming software (OBS and others, over RTMP)', 'vocalstack' ) },
	];
	const freshInvalid = feed === NEW && ( ! fresh.name.trim() || ( fresh.code && fresh.code.length < CODE_MIN ) || ( fresh.access === 'private' && fresh.password.length < 4 ) );
	const invalid = ( source === 'stream' && ! url.trim() ) || ( source === 'rtmp' && ! rtmp?.serverUrl ) || freshInvalid;

	const start = async () => {
		setBusy( true );
		setError( '' );
		setSuggestions( [] );
		const fromBrowser = source === 'mic' || source === 'tab';
		let stream = null;
		if ( fromBrowser ) {
			// The audio first: a refusal leaves nothing behind on the account.
			try {
				stream = await requestStream( source );
			} catch ( e ) {
				setError(
					e?.name === 'NoTabAudio'
						? __( 'That share had no sound. Share a browser tab and tick “Share tab audio”.', 'vocalstack' )
						: __( 'The browser did not allow the audio. Allow it from the address bar, then try again.', 'vocalstack' )
				);
				setBusy( false );
				return;
			}
		}
		const settings = { speakerLabels: speakers, ...( language ? { spokenLanguage: language } : {} ) };
		try {
			let broadcast = chosen ?? null;
			if ( feed === NEW ) {
				// Made now, with this recording's language and speaker labels as its defaults (as the dashboard does).
				try {
					broadcast = await vs( 'broadcasts', {
						method: 'POST',
						idempotent: true,
						data: {
							name: fresh.name.trim().slice( 0, 120 ),
							...( fresh.code ? { code: fresh.code } : {} ),
							access: fresh.access,
							...( fresh.access === 'private' ? { password: fresh.password } : {} ),
							settings: { spokenLanguage: language || null, speakerLabels: speakers },
						},
					} );
				} catch ( e ) {
					setSuggestions( e?.data?.details?.suggestions ?? [] );
					throw e;
				}
				setBroadcasts( ( list ) => [ broadcast, ...( list ?? [] ) ] );
				setFeed( broadcast.id );
			}
			const audio = fromBrowser ? { kind: 'mic' } : { kind: 'stream', url: source === 'rtmp' ? rtmp.serverUrl : withScheme( url.trim() ) };
			const transcription = await vs( 'transcriptions/live', {
				method: 'POST',
				idempotent: true,
				data: { name: ( name.trim() || defaultName() ).slice( 0, 120 ), source: audio, settings, broadcasts: broadcast ? [ broadcast.id ] : [] },
			} );
			const grant = await vs( `transcriptions/${ seg( transcription.id ) }/recordings`, { method: 'POST', idempotent: true, data: {} } );
			setSession( {
				transcriptionId: transcription.id,
				name: transcription.name,
				recordingId: grant.recording?.id,
				streamUrl: grant.streamUrl,
				stream,
				pulled: ! fromBrowser,
				broadcast,
			} );
		} catch ( e ) {
			stream?.getTracks().forEach( ( t ) => t.stop() );
			setError( errorMessage( e ) );
		} finally {
			setBusy( false );
		}
	};

	return (
		<div className="vsa-live">
			<PageHeader title={ __( 'Live', 'vocalstack' ) } subtitle={ __( 'Transcribe as it is spoken. Put it on a broadcast and listeners follow along, in their own language, on its page.', 'vocalstack' ) } />
			<div className="vsa-live__grid">
				<Card>
					<CardHeader>
						<h2>{ __( 'Audio', 'vocalstack' ) }</h2>
					</CardHeader>
					<CardBody>
						<div className="vsa-form">
							<RadioControl label={ __( 'Record from', 'vocalstack' ) } hideLabelFromVision selected={ source } options={ sources } onChange={ setSource } />
							{ source === 'stream' && (
								<TextControl
									label={ __( 'Stream address', 'vocalstack' ) }
									type="url"
									value={ url }
									onChange={ setUrl }
									placeholder="https://youtube.com/live/…"
									help={ __( 'A YouTube live, an Icecast or Shoutcast radio stream, or an HLS (.m3u8) address. VocalStack listens to it from its servers.', 'vocalstack' ) }
									__nextHasNoMarginBottom
								/>
							) }
							{ source === 'rtmp' && (
								rtmp ? (
									<div className="vsa-form">
										<p className="vsa-muted">{ __( 'In your streaming software, stream to this server with this key, then press Start.', 'vocalstack' ) }</p>
										<CopyField label={ __( 'Server', 'vocalstack' ) } value={ rtmp.serverUrl } />
										{ rtmp.streamKey && <CopyField label={ __( 'Stream key', 'vocalstack' ) } value={ rtmp.streamKey } /> }
									</div>
								) : (
									<Spinner />
								)
							) }
							<TextControl label={ __( 'Name', 'vocalstack' ) } value={ name } onChange={ setName } placeholder={ defaultName() } maxLength={ 120 } __nextHasNoMarginBottom />
							<div className="vsa-grid-2">
								<SelectControl label={ __( 'Spoken language', 'vocalstack' ) } value={ language } options={ languageOptions( languages ) } onChange={ setLanguage } __nextHasNoMarginBottom />
								<SelectControl label={ __( 'Speaker labels', 'vocalstack' ) } value={ speakers } options={ SPEAKER_OPTIONS } onChange={ setSpeakers } __nextHasNoMarginBottom />
							</div>
						</div>
					</CardBody>
				</Card>

				<Card>
					<CardHeader>
						<h2>{ __( 'Broadcast', 'vocalstack' ) }</h2>
					</CardHeader>
					<CardBody>
						<div className="vsa-form">
							<p className="vsa-muted">{ __( 'A broadcast is one public link. Listeners open it to read, and hear, the transcript live in their language.', 'vocalstack' ) }</p>
							{ broadcasts === null ? (
								<Spinner />
							) : (
								<SelectControl
									label={ __( 'Put it on', 'vocalstack' ) }
									value={ feed }
									options={ [
										{ value: NONE, label: __( 'No broadcast (only you see it)', 'vocalstack' ) },
										...broadcasts.map( ( b ) => ( { value: b.id, label: `${ b.name } · ${ ( b.shareUrl || '' ).replace( /^https?:\/\//, '' ) }` } ) ),
										{ value: NEW, label: __( '+ New broadcast…', 'vocalstack' ) },
									] }
									onChange={ ( v ) => {
										setFeed( v );
										setSuggestions( [] );
									} }
									__nextHasNoMarginBottom
								/>
							) }
							{ chosen && (
								<p className="vsa-muted">
									{ chosen.currentRecording?.state === 'live'
										? __( 'This broadcast is live from another recording right now; starting takes it over.', 'vocalstack' )
										: sprintf( /* translators: %s: link */ __( 'Listeners follow it at %s.', 'vocalstack' ), ( chosen.shareUrl || '' ).replace( /^https?:\/\//, '' ) ) }
								</p>
							) }
							{ feed === NEW && (
								<div className="vsa-live__new">
									<TextControl
										label={ __( 'Broadcast name', 'vocalstack' ) }
										value={ fresh.name }
										onChange={ ( v ) => setFresh( { ...fresh, name: v, ...( fresh.codeTouched ? {} : { code: slugify( v ) } ) } ) }
										__nextHasNoMarginBottom
									/>
									<TextControl
										label={ __( 'Link', 'vocalstack' ) }
										value={ fresh.code }
										onChange={ ( v ) => setFresh( { ...fresh, code: slugify( v ), codeTouched: true } ) }
										help={ fresh.code && fresh.code.length < CODE_MIN ? __( 'At least 6 characters.', 'vocalstack' ) : `live.vocalstack.com/${ fresh.code || '…' }` }
										__nextHasNoMarginBottom
									/>
									{ suggestions.length > 0 && (
										<div className="vsa-live__suggestions">
											<span className="vsa-muted">{ __( 'That link is taken. Try:', 'vocalstack' ) }</span>
											{ suggestions.slice( 0, 4 ).map( ( s ) => (
												<Button key={ s } variant="secondary" size="small" onClick={ () => setFresh( { ...fresh, code: s, codeTouched: true } ) }>
													{ s }
												</Button>
											) ) }
										</div>
									) }
									<RadioControl
										label={ __( 'Who can follow it', 'vocalstack' ) }
										selected={ fresh.access }
										options={ [
											{ value: 'public', label: __( 'Anyone with the link', 'vocalstack' ) },
											{ value: 'private', label: __( 'Only people with the password', 'vocalstack' ) },
										] }
										onChange={ ( v ) => setFresh( { ...fresh, access: v } ) }
									/>
									{ fresh.access === 'private' && (
										<TextControl
											label={ __( 'Password', 'vocalstack' ) }
											type="password"
											autoComplete="new-password"
											value={ fresh.password }
											onChange={ ( v ) => setFresh( { ...fresh, password: v } ) }
											help={ __( 'At least four characters. Listeners type it once.', 'vocalstack' ) }
											__nextHasNoMarginBottom
										/>
									) }
								</div>
							) }
						</div>
					</CardBody>
				</Card>
			</div>

			<ErrorNotice error={ error } />
			<div className="vsa-live__start">
				<p className="vsa-muted">{ __( 'Live audio is billed per minute to your VocalStack account while it records.', 'vocalstack' ) }</p>
				<Button variant="primary" className="vsa-live__go" onClick={ start } disabled={ invalid || busy } isBusy={ busy }>
					{ source === 'mic' || source === 'tab' ? __( 'Start recording', 'vocalstack' ) : __( 'Start', 'vocalstack' ) }
				</Button>
			</div>
		</div>
	);
}

const withScheme = ( u ) => ( /^[a-z]+:\/\//i.test( u ) ? u : `https://${ u }` );

/** On air: the recorder (or the pulled stream's progress), the broadcast's link and its listeners. */
function LiveSession( { session } ) {
	const [ listeners, setListeners ] = useState( null );
	const done = () => navigate( `/transcriptions/${ session.transcriptionId }` );

	useEffect( () => {
		if ( ! session.broadcast ) {
			return;
		}
		const look = () =>
			vs( `broadcasts/${ seg( session.broadcast.id ) }` ).then(
				( b ) => setListeners( b?.listenersNow ?? null ),
				() => {}
			);
		look();
		const timer = setInterval( look, 15000 );
		return () => clearInterval( timer );
	}, [ session.broadcast ] );

	// Leaving the page would cut the microphone off mid-sentence.
	useEffect( () => {
		const warn = ( event ) => {
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener( 'beforeunload', warn );
		return () => window.removeEventListener( 'beforeunload', warn );
	}, [] );

	return (
		<div className="vsa-live">
			<PageHeader title={ session.name } subtitle={ session.broadcast ? sprintf( /* translators: %s: broadcast name */ __( 'On the broadcast “%s”', 'vocalstack' ), session.broadcast.name ) : __( 'Not on a broadcast', 'vocalstack' ) } />
			{ session.broadcast && (
				<Card className="vsa-live__share">
					<CardBody>
						<CopyField label={ __( 'Listeners follow it here', 'vocalstack' ) } value={ session.broadcast.shareUrl } />
						<div className="vsa-live__share-meta">
							<ExternalLink href={ session.broadcast.shareUrl }>{ __( 'Open the live page', 'vocalstack' ) }</ExternalLink>
							{ listeners !== null && (
								<span className="vsa-muted">
									{ sprintf( /* translators: %d: listeners */ __( '%d listening now', 'vocalstack' ), listeners ) }
								</span>
							) }
						</div>
					</CardBody>
				</Card>
			) }
			<Card>
				<CardBody>
					{ session.pulled ? (
						<PulledStream recordingId={ session.recordingId } onFinished={ done } />
					) : (
						<LiveRecorder stream={ session.stream } recordingId={ session.recordingId } streamUrl={ session.streamUrl } onFinished={ done } pausable />
					) }
				</CardBody>
			</Card>
		</div>
	);
}

/** A stream VocalStack pulls: its state and transcript, with pause, resume and stop. */
function PulledStream( { recordingId, onFinished } ) {
	const [ recording, setRecording ] = useState( null );
	const [ sentences, setSentences ] = useState( [] );
	const [ busy, setBusy ] = useState( '' );
	const [ error, setError ] = useState( '' );
	const started = useRef( Date.now() );
	const [ , tick ] = useState( 0 );

	useEffect( () => {
		let live = true;
		const poll = async () => {
			try {
				const [ r, t ] = await Promise.all( [ vs( `recordings/${ seg( recordingId ) }` ), vs( `recordings/${ seg( recordingId ) }/transcript` ) ] );
				if ( ! live ) return;
				setRecording( r );
				setSentences( ( t?.sentences ?? [] ).filter( ( s ) => s.status !== 'dropped' && s.text?.trim() ) );
				if ( [ 'ended', 'finalized' ].includes( r?.state ) ) {
					onFinished();
				}
			} catch {}
		};
		poll();
		const timer = setInterval( poll, 2500 );
		const clockTimer = setInterval( () => tick( ( n ) => n + 1 ), 1000 );
		return () => {
			live = false;
			clearInterval( timer );
			clearInterval( clockTimer );
		};
		// The recording is followed once for this component's life.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ recordingId ] );

	const act = async ( what ) => {
		setBusy( what );
		setError( '' );
		try {
			if ( what === 'stop' ) {
				// VocalStack stops a live recording only once it is paused.
				if ( recording?.state === 'live' ) {
					await vs( `recordings/${ seg( recordingId ) }/pause`, { method: 'POST' } );
				}
				await vs( `recordings/${ seg( recordingId ) }/stop`, { method: 'POST', data: { reason: 'Stopped from WordPress' } } );
				onFinished();
				return;
			}
			setRecording( await vs( `recordings/${ seg( recordingId ) }/${ what }`, { method: 'POST' } ) );
		} catch ( e ) {
			setError( errorMessage( e ) );
		} finally {
			setBusy( '' );
		}
	};

	const ingest = recording?.ingest?.state;
	const labels = {
		connecting: __( 'Connecting to the stream…', 'vocalstack' ),
		streaming: __( 'Recording the stream', 'vocalstack' ),
		reconnecting: __( 'The stream dropped. Reconnecting…', 'vocalstack' ),
		stopped: __( 'The stream stopped', 'vocalstack' ),
		failed: __( 'The stream could not be reached', 'vocalstack' ),
	};
	const paused = recording?.state === 'paused';

	return (
		<div className="vsa-live-recorder">
			<div className="vsa-live-recorder__bar">
				<span className={ `vsa-live-recorder__dot is-${ paused ? 'paused' : ingest === 'streaming' ? 'recording' : 'warming' }` } aria-hidden="true" />
				<strong role="status">{ paused ? __( 'Paused', 'vocalstack' ) : labels[ ingest ] ?? __( 'Starting…', 'vocalstack' ) }</strong>
				<span className="vsa-live-recorder__time">{ clock( ( Date.now() - started.current ) / 1000 ) }</span>
				<span className="vsa-live-recorder__spacer" />
				<Button variant="secondary" onClick={ () => act( paused ? 'resume' : 'pause' ) } disabled={ Boolean( busy ) } isBusy={ busy === 'pause' || busy === 'resume' }>
					{ paused ? __( 'Resume', 'vocalstack' ) : __( 'Pause', 'vocalstack' ) }
				</Button>
				<Button variant="primary" isDestructive onClick={ () => act( 'stop' ) } disabled={ Boolean( busy ) } isBusy={ busy === 'stop' }>
					{ __( 'Stop', 'vocalstack' ) }
				</Button>
			</div>
			{ error && (
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			) }
			<div className="vsa-live-recorder__transcript" aria-live="polite">
				{ sentences.length === 0 && <p className="vsa-muted">{ __( 'The transcript appears here as the stream is heard.', 'vocalstack' ) }</p> }
				{ sentences.map( ( s ) => (
					<p key={ s.sentenceId }>{ s.text }</p>
				) ) }
			</div>
		</div>
	);
}
