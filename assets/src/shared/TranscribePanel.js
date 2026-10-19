/**
 * Transcribe, follow, stop and edit one attachment's transcript.
 * Used on the attachment edit screen and in the block editor's inspector.
 */
import apiFetch from '@wordpress/api-fetch';
import { Button, Notice, TextareaControl, Spinner } from '@wordpress/components';
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';

const PENDING = [ 'queued', 'fetching', 'cropping', 'transcribing' ];
const POLL_MS = 3000;

const PHASES = {
	queued: __( 'Queued', 'vocalstack' ),
	fetching: __( 'Fetching the file', 'vocalstack' ),
	cropping: __( 'Preparing the audio', 'vocalstack' ),
	transcribing: __( 'Transcribing', 'vocalstack' ),
};

const path = ( id, action = '' ) => `/vocalstack/v1/media/${ id }${ action ? `/${ action }` : '' }`;

export default function TranscribePanel( { id, compact = false } ) {
	const { connected, settingsUrl } = window.vocalstack ?? {};
	const [ data, setData ] = useState( null );
	const [ error, setError ] = useState( '' );
	const [ busy, setBusy ] = useState( false );
	const [ draft, setDraft ] = useState( null );
	const timer = useRef();

	const load = useCallback( async () => {
		try {
			setData( await apiFetch( { path: path( id ) } ) );
		} catch ( e ) {
			setError( e.message );
		}
	}, [ id ] );

	useEffect( () => {
		load();
	}, [ load ] );

	// Poll while a job runs; the server checks VocalStack at most every 2 s.
	const pending = PENDING.includes( data?.state );
	useEffect( () => {
		if ( ! pending ) return;
		timer.current = setInterval( load, POLL_MS );
		return () => clearInterval( timer.current );
	}, [ pending, load ] );

	const act = async ( action, options = {} ) => {
		setBusy( true );
		setError( '' );
		try {
			setData( await apiFetch( { path: path( id, action ), method: 'POST', ...options } ) );
			return true;
		} catch ( e ) {
			setError( e.message );
			load();
			return false;
		} finally {
			setBusy( false );
		}
	};

	const transcribe = () => {
		if (
			data?.transcript &&
			// eslint-disable-next-line no-alert
			! window.confirm( __( 'Transcribe again? This replaces the current transcript and is billed to your VocalStack account.', 'vocalstack' ) )
		) {
			return;
		}
		act( 'transcribe' );
	};

	const save = async () => {
		if ( await act( 'transcript', { data: { transcript: draft } } ) ) setDraft( null );
	};

	if ( ! data ) {
		return error ? <Notice status="error" isDismissible={ false }>{ error }</Notice> : <Spinner />;
	}

	if ( ! connected ) {
		return (
			<Notice status="warning" isDismissible={ false }>
				{ __( 'Connect a VocalStack account to transcribe.', 'vocalstack' ) }{ ' ' }
				{ settingsUrl && <a href={ settingsUrl }>{ __( 'Open settings', 'vocalstack' ) }</a> }
			</Notice>
		);
	}

	const pct = Math.round( data.progress?.pct ?? 0 );
	const edited = draft !== null && draft !== data.transcript;

	return (
		<div className={ `vocalstack-panel${ compact ? ' is-compact' : '' }` }>
			{ error && <Notice status="error" onRemove={ () => setError( '' ) }>{ error }</Notice> }
			{ data.state === 'failed' && data.error && (
				<Notice status="error" isDismissible={ false }>
					{ sprintf( /* translators: %s: error message */ __( 'Transcription failed: %s', 'vocalstack' ), data.error ) }
				</Notice>
			) }

			{ pending ? (
				<div className="vocalstack-panel__progress">
					<progress max="100" value={ pct } />
					<span>{ `${ PHASES[ data.state ] ?? data.state } · ${ pct }%` }</span>
					<Button variant="secondary" isDestructive onClick={ () => act( 'stop' ) } disabled={ busy }>
						{ __( 'Stop', 'vocalstack' ) }
					</Button>
				</div>
			) : (
				<Button variant={ data.transcript ? 'secondary' : 'primary' } onClick={ transcribe } isBusy={ busy } disabled={ busy }>
					{ data.transcript ? __( 'Transcribe again', 'vocalstack' ) : __( 'Transcribe', 'vocalstack' ) }
				</Button>
			) }

			{ data.transcript && ! compact && (
				<>
					<TextareaControl
						label={ __( 'Transcript', 'vocalstack' ) }
						value={ draft ?? data.transcript }
						onChange={ setDraft }
						rows={ 12 }
						help={ __( 'Editing the text turns off timestamps and click-to-seek on the site, since the text no longer matches the timings.', 'vocalstack' ) }
						__nextHasNoMarginBottom
					/>
					<div className="vocalstack-panel__actions">
						<Button variant="primary" onClick={ save } disabled={ ! edited || busy }>
							{ __( 'Save transcript', 'vocalstack' ) }
						</Button>
						{ edited && (
							<Button variant="tertiary" onClick={ () => setDraft( null ) }>
								{ __( 'Discard changes', 'vocalstack' ) }
							</Button>
						) }
					</div>
					<p className="description">
						{ __( 'Show it on your site with the VocalStack Transcript block, or this shortcode:', 'vocalstack' ) }{ ' ' }
						<code>{ `[vocalstack_transcript id="${ id }"]` }</code>
					</p>
				</>
			) }

			{ data.transcript && compact && (
				<p className="description">
					{ sprintf(
						/* translators: %d: number of words */
						__( 'Transcribed: %d words.', 'vocalstack' ),
						data.transcript.split( /\s+/ ).filter( Boolean ).length
					) }
				</p>
			) }
		</div>
	);
}
