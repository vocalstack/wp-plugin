/**
 * Record a live transcription from this browser: the microphone or a tab's
 * audio, with the transcript as it is spoken. Shares the capture and socket
 * code with the public Record widget.
 */
import { Button, Notice } from '@wordpress/components';
import { useEffect, useRef, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { capture } from '../../widgets/shared/capture';
import Publisher from '../../widgets/shared/publisher';
import { errorMessage, seg, vs } from '../lib/api';
import { clock } from '../lib/format';

const RETRIES = 7;

/**
 * @param {Object}      props
 * @param {MediaStream} props.stream       The audio to send, already allowed by the user.
 * @param {string}      props.recordingId  The recording to publish into.
 * @param {string}      props.streamUrl    Its socket URL.
 * @param {Function}    props.onFinished   Called when the recording has ended.
 * @param {boolean}     props.pausable     Offer Pause and Resume.
 */
export default function LiveRecorder( { stream, recordingId, streamUrl, onFinished, pausable = false } ) {
	const [ state, setState ] = useState( 'warming' );
	const [ sentences, setSentences ] = useState( [] );
	const [ draft, setDraft ] = useState( '' );
	const [ elapsed, setElapsed ] = useState( 0 );
	const [ level, setLevel ] = useState( 0 );
	const [ error, setError ] = useState( '' );
	const publisher = useRef( null );
	const capturer = useRef( null );
	const stateRef = useRef( state );
	stateRef.current = state;
	const [ paused, setPaused ] = useState( false );
	const pausedRef = useRef( false );
	const [ pausing, setPausing ] = useState( false );

	useEffect( () => {
		const started = performance.now();
		const tick = setInterval( () => setElapsed( ( performance.now() - started ) / 1000 ), 500 );

		const reconnect = async () => {
			setState( 'reconnecting' );
			for ( let attempt = 0; attempt < RETRIES; attempt++ ) {
				await new Promise( ( r ) => setTimeout( r, Math.min( 15000, 1000 * 2 ** attempt ) ) );
				if ( stateRef.current !== 'reconnecting' ) {
					return;
				}
				try {
					const grant = await vs( `recordings/${ seg( recordingId ) }/publish-token`, { method: 'POST', data: { takeover: true } } );
					if ( grant.streamUrl ) {
						publisher.current.connect( grant.streamUrl );
						setState( 'warming' );
						return;
					}
				} catch {}
			}
			setError( __( 'The connection was lost. What was recorded so far is kept.', 'vocalstack' ) );
			setState( 'done' );
		};

		const pub = new Publisher( {
			ready: () => setState( ( s ) => ( s === 'stopping' ? s : 'recording' ) ),
			sentence: ( s ) =>
				setSentences( ( list ) => {
					const rest = list.filter( ( x ) => x.sentenceId !== s.sentenceId );
					return s.status === 'dropped' ? rest : [ ...rest, s ].sort( ( a, b ) => a.start - b.start );
				} ),
			draft: setDraft,
			done: ( reason ) => {
				if ( reason === 'max_duration' ) {
					setError( __( 'The recording reached its time limit.', 'vocalstack' ) );
				}
			},
			error: ( frame ) => setError( frame.message || __( 'The recording failed.', 'vocalstack' ) ),
			dropped: () => {
				if ( [ 'warming', 'recording' ].includes( stateRef.current ) ) {
					reconnect();
				}
			},
		} );
		publisher.current = pub;

		capture( stream, {
			// While paused, the microphone keeps running but nothing is sent.
			chunk: ( samples ) => ! pausedRef.current && pub.send( samples ),
			level: ( l ) => setLevel( Math.min( 1, l * 1.6 ) ),
			ended: () => stop(),
		} ).then(
			( c ) => {
				capturer.current = c;
				pub.connect( streamUrl );
			},
			() => {
				setError( __( 'This browser can’t record audio here.', 'vocalstack' ) );
				setState( 'done' );
			}
		);

		return () => {
			clearInterval( tick );
			capturer.current?.stop();
			capturer.current = null;
			stream.getTracks().forEach( ( t ) => t.stop() );
			pub.close();
		};
		// The recording is set up once for this component's life.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [] );

	const stop = async () => {
		if ( [ 'stopping', 'done' ].includes( stateRef.current ) ) {
			return;
		}
		setState( 'stopping' );
		capturer.current?.stop();
		capturer.current = null;
		stream.getTracks().forEach( ( t ) => t.stop() );
		try {
			// eof ends the recording on VocalStack; the transcript is then finalised.
			await publisher.current?.finish();
		} catch ( e ) {
			setError( errorMessage( e ) );
		}
		setDraft( '' );
		setState( 'done' );
		onFinished();
	};

	const togglePause = async () => {
		setPausing( true );
		try {
			const next = ! pausedRef.current;
			await vs( `recordings/${ seg( recordingId ) }/${ next ? 'pause' : 'resume' }`, { method: 'POST' } );
			pausedRef.current = next;
			setPaused( next );
		} catch ( e ) {
			setError( errorMessage( e ) );
		} finally {
			setPausing( false );
		}
	};

	const labels = {
		warming: __( 'Getting ready… you can start speaking.', 'vocalstack' ),
		recording: __( 'Recording', 'vocalstack' ),
		reconnecting: __( 'Connection lost. Reconnecting…', 'vocalstack' ),
		stopping: __( 'Finishing the transcript…', 'vocalstack' ),
		done: __( 'Done', 'vocalstack' ),
	};

	return (
		<div className="vsa-live-recorder">
			<div className="vsa-live-recorder__bar">
				<span className={ `vsa-live-recorder__dot is-${ state }` } aria-hidden="true" />
				<strong role="status">{ paused && state === 'recording' ? __( 'Paused', 'vocalstack' ) : labels[ state ] }</strong>
				<span className="vsa-live-recorder__time">{ clock( elapsed ) }</span>
				<span className="vsa-live-recorder__meter" aria-hidden="true">
					<span style={ { transform: `scaleX(${ level })` } } />
				</span>
				{ pausable && (
					<Button variant="secondary" onClick={ togglePause } disabled={ pausing || ! [ 'recording', 'warming' ].includes( state ) } isBusy={ pausing }>
						{ paused ? __( 'Resume', 'vocalstack' ) : __( 'Pause', 'vocalstack' ) }
					</Button>
				) }
				<Button variant="primary" isDestructive onClick={ stop } disabled={ [ 'stopping', 'done' ].includes( state ) } isBusy={ state === 'stopping' }>
					{ __( 'Stop', 'vocalstack' ) }
				</Button>
			</div>
			{ error && (
				<Notice status="warning" isDismissible={ false }>
					{ error }
				</Notice>
			) }
			<div className="vsa-live-recorder__transcript" aria-live="polite">
				{ sentences.length === 0 && ! draft && <p className="vsa-muted">{ __( 'The transcript appears here as you speak.', 'vocalstack' ) }</p> }
				{ sentences.map( ( s ) => (
					<p key={ s.sentenceId }>{ s.text }</p>
				) ) }
				{ draft && <p className="vsa-muted">{ draft }</p> }
			</div>
		</div>
	);
}
