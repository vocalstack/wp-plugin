/**
 * New transcription: upload a file (it goes into the Media Library), a link,
 * or a live stream VocalStack pulls.
 */
import apiFetch from '@wordpress/api-fetch';
import { Button, FormFileUpload, Modal, Notice, RadioControl, SelectControl, TextControl } from '@wordpress/components';
import { useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { languageOptions, loadLinks, SPEAKER_OPTIONS, useLanguages } from '../lib/account';
import { errorMessage, seg, vs, wp } from '../lib/api';
import { maxUploadSize } from '../lib/config';
import { navigate } from '../lib/router';
import { bytes } from '../lib/format';
import { ErrorNotice } from '../components/ui';
import LiveRecorder from '../components/LiveRecorder';
import { canCaptureTab, requestStream } from '../../widgets/shared/capture';

function settingsOf( language, speakers ) {
	const settings = { speakerLabels: speakers };
	if ( language ) settings.spokenLanguage = language;
	return settings;
}

export default function NewTranscription( { onClose, onCreated } ) {
	const languages = useLanguages();
	const [ kind, setKind ] = useState( 'upload' );
	const [ name, setName ] = useState( '' );
	const [ language, setLanguage ] = useState( '' );
	const [ speakers, setSpeakers ] = useState( 'auto' );
	const [ file, setFile ] = useState( null );
	const [ url, setUrl ] = useState( '' );
	const [ liveSource, setLiveSource ] = useState( 'mic' );
	const [ probe, setProbe ] = useState( null );
	const [ busy, setBusy ] = useState( '' );
	const [ error, setError ] = useState( '' );
	const [ recording, setRecording ] = useState( null );

	const tooBig = file && maxUploadSize && file.size > maxUploadSize;

	const upload = async () => {
		setBusy( 'upload' );
		setError( '' );
		try {
			const body = new window.FormData();
			body.append( 'file', file, file.name );
			if ( name ) body.append( 'title', name );
			const attachment = await apiFetch( { path: '/wp/v2/media', method: 'POST', body } );
			await wp( `media/${ attachment.id }/transcribe`, { method: 'POST', data: { language, speakers } } );
			const links = await loadLinks( true );
			const tid = Object.keys( links ).find( ( id ) => links[ id ].attachmentId === attachment.id );
			onCreated( tid );
		} catch ( e ) {
			setError( errorMessage( e ) );
			setBusy( '' );
		}
	};

	const checkLink = async () => {
		setBusy( 'probe' );
		setError( '' );
		setProbe( null );
		try {
			const r = await vs( 'transcriptions/probe', { query: { url: url.trim() } } );
			setProbe( r );
			if ( r?.kind === 'live' ) {
				setKind( 'live' );
				setLiveSource( 'stream' );
			}
		} catch ( e ) {
			// A link the probe can't read may still transcribe; let the create call decide.
			setProbe( { kind: 'unknown', error: errorMessage( e ) } );
		} finally {
			setBusy( '' );
		}
	};

	const fromLink = async () => {
		setBusy( 'link' );
		setError( '' );
		try {
			const urls = probe?.media?.length ? probe.media.map( ( m ) => m.url ?? m ) : [ url.trim() ];
			let first = null;
			for ( const u of urls ) {
				const t = await vs( 'transcriptions', {
					method: 'POST',
					idempotent: true,
					data: { url: u, ...( name ? { name } : {} ), settings: settingsOf( language, speakers ) },
				} );
				first ??= t.id;
			}
			onCreated( first );
		} catch ( e ) {
			setError( errorMessage( e ) );
			setBusy( '' );
		}
	};

	const live = async () => {
		setBusy( 'live' );
		setError( '' );
		const fromBrowser = liveSource !== 'stream';
		let stream = null;
		if ( fromBrowser ) {
			// Ask for the audio first, so a refusal leaves nothing behind on the account.
			try {
				stream = await requestStream( liveSource );
			} catch ( e ) {
				setError(
					e?.name === 'NoTabAudio'
						? __( 'That share had no sound. Share a browser tab and tick “Share tab audio”.', 'vocalstack' )
						: __( 'The browser did not allow the audio. Allow it from the address bar, then try again.', 'vocalstack' )
				);
				setBusy( '' );
				return;
			}
		}
		try {
			const t = await vs( 'transcriptions/live', {
				method: 'POST',
				idempotent: true,
				data: {
					name: name || __( 'Live transcription', 'vocalstack' ),
					source: fromBrowser ? { kind: 'mic' } : { kind: 'stream', url: url.trim() },
					settings: settingsOf( language, speakers ),
				},
			} );
			const grant = await vs( `transcriptions/${ seg( t.id ) }/recordings`, { method: 'POST', idempotent: true, data: {} } );
			if ( fromBrowser ) {
				setRecording( { stream, transcriptionId: t.id, recordingId: grant.recording?.id, streamUrl: grant.streamUrl } );
				setBusy( '' );
				return;
			}
			onCreated( t.id );
		} catch ( e ) {
			stream?.getTracks().forEach( ( track ) => track.stop() );
			setError( errorMessage( e ) );
			setBusy( '' );
		}
	};

	if ( recording ) {
		return (
			<Modal title={ name || __( 'Live transcription', 'vocalstack' ) } onRequestClose={ () => {} } isDismissible={ false } shouldCloseOnClickOutside={ false } shouldCloseOnEsc={ false } className="vsa-modal" size="medium">
				<LiveRecorder stream={ recording.stream } recordingId={ recording.recordingId } streamUrl={ recording.streamUrl } onFinished={ () => onCreated( recording.transcriptionId ) } />
			</Modal>
		);
	}

	const common = (
		<>
			<TextControl label={ __( 'Name', 'vocalstack' ) } value={ name } onChange={ setName } maxLength={ 80 } help={ __( 'Optional. VocalStack names it from the file or link otherwise.', 'vocalstack' ) } __nextHasNoMarginBottom />
			<div className="vsa-grid-2">
				<SelectControl label={ __( 'Spoken language', 'vocalstack' ) } value={ language } options={ languageOptions( languages ) } onChange={ setLanguage } __nextHasNoMarginBottom />
				<SelectControl label={ __( 'Speaker labels', 'vocalstack' ) } value={ speakers } options={ SPEAKER_OPTIONS } onChange={ setSpeakers } __nextHasNoMarginBottom />
			</div>
		</>
	);

	return (
		<Modal title={ __( 'New transcription', 'vocalstack' ) } onRequestClose={ onClose } className="vsa-modal" size="medium">
			<RadioControl
				className="vsa-segmented"
				label={ __( 'Source', 'vocalstack' ) }
				hideLabelFromVision
				selected={ kind }
				options={ [
					{ value: 'upload', label: __( 'Upload file', 'vocalstack' ) },
					{ value: 'link', label: __( 'From URL', 'vocalstack' ) },
					{ value: 'live', label: __( 'Live', 'vocalstack' ) },
				] }
				onChange={ ( v ) => {
					setKind( v );
					setError( '' );
				} }
			/>

			{ kind === 'upload' && (
				<div className="vsa-form">
					<p className="vsa-muted">{ __( 'The file is added to the Media Library and transcribed there, like any audio or video you upload.', 'vocalstack' ) }</p>
					<div className="vsa-file">
						<FormFileUpload accept="audio/*,video/*" onChange={ ( e ) => setFile( e.target.files?.[ 0 ] ?? null ) } render={ ( { openFileDialog } ) => (
							<Button variant="secondary" onClick={ openFileDialog }>
								{ file ? __( 'Choose another file', 'vocalstack' ) : __( 'Choose a file', 'vocalstack' ) }
							</Button>
						) } />
						{ file && <span>{ `${ file.name } · ${ bytes( file.size ) }` }</span> }
					</div>
					{ tooBig && (
						<Notice status="warning" isDismissible={ false }>
							{ /* translators: %s: size */ sprintf( __( 'This site accepts uploads up to %s.', 'vocalstack' ), bytes( maxUploadSize ) ) }
						</Notice>
					) }
					{ common }
				</div>
			) }

			{ kind === 'link' && (
				<div className="vsa-form">
					<div className="vsa-inline">
						<TextControl
							label={ __( 'Link to audio or video', 'vocalstack' ) }
							type="url"
							value={ url }
							onChange={ ( v ) => {
								setUrl( v );
								setProbe( null );
							} }
							placeholder="https://"
							help={ __( 'A file’s address, or a page VocalStack can read media from, such as YouTube.', 'vocalstack' ) }
							__nextHasNoMarginBottom
						/>
						<Button variant="secondary" onClick={ checkLink } disabled={ ! url.trim() || Boolean( busy ) } isBusy={ busy === 'probe' }>
							{ __( 'Check link', 'vocalstack' ) }
						</Button>
					</div>
					{ probe?.media?.length > 1 && (
						<Notice status="info" isDismissible={ false }>
							{ /* translators: %d: number of files */ sprintf( __( 'This link has %d media files; each becomes its own transcription.', 'vocalstack' ), probe.media.length ) }
						</Notice>
					) }
					{ probe?.error && <Notice status="warning" isDismissible={ false }>{ probe.error }</Notice> }
					{ common }
				</div>
			) }

			{ kind === 'live' && (
				<div className="vsa-form">
					<Notice status="info" isDismissible={ false }>
						{ __( 'To put a live recording on a broadcast, use the Live tab.', 'vocalstack' ) }{ ' ' }
						<Button variant="link" onClick={ () => { onClose(); navigate( '/live' ); } }>
							{ __( 'Open Live', 'vocalstack' ) }
						</Button>
					</Notice>
					{ probe?.kind === 'live' && <Notice status="info" isDismissible={ false }>{ __( 'This link is a live stream, so it is transcribed live.', 'vocalstack' ) }</Notice> }
					<RadioControl
						label={ __( 'Audio', 'vocalstack' ) }
						selected={ liveSource }
						options={ [
							{ value: 'mic', label: __( 'Microphone in this browser', 'vocalstack' ) },
							...( canCaptureTab() ? [ { value: 'tab', label: __( 'A browser tab’s sound (Chrome and Edge)', 'vocalstack' ) } ] : [] ),
							{ value: 'stream', label: __( 'A stream VocalStack pulls (YouTube live, Icecast, HLS, RTMP)', 'vocalstack' ) },
						] }
						onChange={ setLiveSource }
					/>
					{ liveSource === 'stream' && (
						<TextControl label={ __( 'Stream URL', 'vocalstack' ) } type="url" value={ url } onChange={ setUrl } placeholder="https://" __nextHasNoMarginBottom />
					) }
					<p className="vsa-muted">
							{ liveSource === 'stream'
								? __( 'Live audio is billed per minute while it records. Stop it from the transcription when you are done.', 'vocalstack' )
								: __( 'Live audio is billed per minute while it records. The transcript appears as you speak; press Stop when you are done.', 'vocalstack' ) }
						</p>
					{ common }
				</div>
			) }

			<ErrorNotice error={ error } />

			<div className="vsa-modal-actions">
				<Button variant="tertiary" onClick={ onClose }>
					{ __( 'Cancel', 'vocalstack' ) }
				</Button>
				{ kind === 'upload' && (
					<Button variant="primary" disabled={ ! file || tooBig || Boolean( busy ) } isBusy={ busy === 'upload' } onClick={ upload }>
						{ __( 'Upload and transcribe', 'vocalstack' ) }
					</Button>
				) }
				{ kind === 'link' && (
					<Button variant="primary" disabled={ ! url.trim() || Boolean( busy ) } isBusy={ busy === 'link' } onClick={ fromLink }>
						{ __( 'Transcribe', 'vocalstack' ) }
					</Button>
				) }
				{ kind === 'live' && (
					<Button variant="primary" disabled={ ( liveSource === 'stream' && ! url.trim() ) || Boolean( busy ) } isBusy={ busy === 'live' } onClick={ live }>
						{ liveSource === 'stream' ? __( 'Start live transcription', 'vocalstack' ) : __( 'Start recording', 'vocalstack' ) }
					</Button>
				) }
			</div>
		</Modal>
	);
}
