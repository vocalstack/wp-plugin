/**
 * A recording's audio and its timed transcript, kept in step: click a
 * sentence to seek, the sentence being spoken is highlighted.
 */
import { Button, Icon, Spinner, TextControl } from '@wordpress/components';
import { forwardRef, useCallback, useEffect, useMemo, useRef, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { check, close, pencil } from '@wordpress/icons';
import { seg, vs } from '../lib/api';
import { apiUrl } from '../lib/config';
import { clock } from '../lib/format';

/** A playable URL for a recording: its delivery audio, with a media token. */
export function useAudioUrl( recordingId, enabled = true ) {
	const [ url, setUrl ] = useState( null );
	const [ error, setError ] = useState( '' );
	useEffect( () => {
		setUrl( null );
		setError( '' );
		if ( ! recordingId || ! enabled ) return;
		let live = true;
		vs( `recordings/${ seg( recordingId ) }/media-token` ).then(
			( r ) => live && setUrl( `${ apiUrl }/v1/recordings/${ seg( recordingId ) }/audio?kind=delivery&format=mp3&media=${ encodeURIComponent( r.token ) }` ),
			( e ) => live && setError( e.message )
		);
		return () => {
			live = false;
		};
	}, [ recordingId, enabled ] );
	return { url, error };
}

export const AudioPlayer = forwardRef( function AudioPlayer( { src, onTime }, ref ) {
	if ( ! src ) return null;
	return (
		// eslint-disable-next-line jsx-a11y/media-has-caption -- The transcript below is the caption.
		<audio
			ref={ ref }
			className="vsa-audio"
			controls
			preload="metadata"
			src={ src }
			onTimeUpdate={ ( e ) => onTime?.( e.currentTarget.currentTime ) }
		/>
	);
} );

/** Sentences grouped into paragraphs: a new one per speaker or after a 2.5 s pause. */
export function paragraphs( sentences ) {
	const out = [];
	let prev = null;
	for ( const s of sentences ) {
		if ( ! prev || s.speaker !== prev.speaker || s.start - prev.end > 2.5 ) out.push( [] );
		out[ out.length - 1 ].push( s );
		prev = s;
	}
	return out;
}

function SpeakerName( { index, name, onRename } ) {
	const [ editing, setEditing ] = useState( false );
	const [ value, setValue ] = useState( name ?? '' );
	/* translators: %d: speaker number */
	const fallback = sprintf( __( 'Speaker %d', 'vocalstack' ), index + 1 );
	if ( ! onRename || ! editing ) {
		return (
			<span className="vsa-speaker">
				{ name || fallback }
				{ onRename && (
					<Button icon={ pencil } size="small" label={ __( 'Name this speaker', 'vocalstack' ) } onClick={ () => setEditing( true ) } />
				) }
			</span>
		);
	}
	const save = async () => {
		await onRename( index, value.trim() || null );
		setEditing( false );
	};
	return (
		<span className="vsa-speaker is-editing">
			<TextControl
				label={ __( 'Speaker name', 'vocalstack' ) }
				hideLabelFromVision
				value={ value }
				onChange={ setValue }
				onKeyDown={ ( e ) => e.key === 'Enter' && save() }
				__nextHasNoMarginBottom
			/>
			<Button icon={ check } size="small" label={ __( 'Save name', 'vocalstack' ) } onClick={ save } />
			<Button icon={ close } size="small" label={ __( 'Cancel', 'vocalstack' ) } onClick={ () => setEditing( false ) } />
		</span>
	);
}

/**
 * The timed transcript.
 *
 * @param {Object}   props
 * @param {Array}    props.sentences  [{ sentenceId, start, end, speaker, text }].
 * @param {boolean}  props.labelled   Speakers were identified.
 * @param {Object}   props.names      Speaker index → name.
 * @param {number}   props.time       The audio's current time.
 * @param {Function} props.onSeek     Seek the audio.
 * @param {Function} props.onRename   Name a speaker (index, name), or undefined.
 */
export function Transcript( { sentences, labelled, names = {}, time = 0, onSeek, onRename } ) {
	const groups = useMemo( () => paragraphs( sentences ), [ sentences ] );
	const current = useRef( null );
	const activeId = sentences.find( ( s ) => time >= s.start && time < s.end )?.sentenceId;
	useEffect( () => {
		current.current?.scrollIntoView?.( { block: 'nearest', behavior: 'smooth' } );
	}, [ activeId ] );
	if ( ! sentences.length ) {
		return <p className="vsa-muted">{ __( 'No transcript yet.', 'vocalstack' ) }</p>;
	}
	return (
		<div className="vsa-transcript">
			{ groups.map( ( group ) => {
				const first = group[ 0 ];
				return (
					<div className="vsa-transcript__para" key={ first.sentenceId }>
						<div className="vsa-transcript__meta">
							<button type="button" className="vsa-transcript__time" onClick={ () => onSeek?.( first.start ) }>
								{ clock( first.start ) }
							</button>
							{ labelled && first.speaker >= 0 && <SpeakerName index={ first.speaker } name={ names[ first.speaker ] } onRename={ onRename } /> }
						</div>
						<p>
							{ group.map( ( s ) => (
								<span
									key={ s.sentenceId }
									ref={ s.sentenceId === activeId ? current : undefined }
									className={ `vsa-transcript__sentence${ s.sentenceId === activeId ? ' is-current' : '' }` }
									role="button"
									tabIndex={ 0 }
									onClick={ () => onSeek?.( s.start ) }
									onKeyDown={ ( e ) => ( e.key === 'Enter' || e.key === ' ' ) && ( e.preventDefault(), onSeek?.( s.start ) ) }
								>
									{ s.text }{ ' ' }
								</span>
							) ) }
						</p>
					</div>
				);
			} ) }
		</div>
	);
}

/**
 * A recording's player and transcript, loading both. `lang` reads a translation.
 */
export function RecordingView( { recordingId, lang, canName = true, playable = true } ) {
	const audioRef = useRef();
	const [ time, setTime ] = useState( 0 );
	const [ data, setData ] = useState( null );
	const [ error, setError ] = useState( '' );
	const { url, error: audioError } = useAudioUrl( recordingId, playable );

	const load = useCallback( async () => {
		setError( '' );
		try {
			setData( await vs( `recordings/${ seg( recordingId ) }/transcript`, { query: { lang } } ) );
		} catch ( e ) {
			setError( e.message );
		}
	}, [ recordingId, lang ] );

	useEffect( () => {
		setData( null );
		load();
	}, [ load ] );

	const names = useMemo( () => Object.fromEntries( ( data?.speakers ?? [] ).map( ( s, i ) => [ s.index ?? s.speaker ?? i, s.name ] ) ), [ data ] );

	const rename = async ( index, name ) => {
		await vs( `recordings/${ seg( recordingId ) }/speakers/${ index }`, { method: 'PUT', data: { name } } );
		await load();
	};

	const seek = ( t ) => {
		if ( audioRef.current ) {
			audioRef.current.currentTime = t;
			audioRef.current.play?.().catch( () => {} );
		}
	};

	const sentences = ( data?.sentences ?? [] ).filter( ( s ) => s.status !== 'dropped' && ! s.suppressed && String( s.text ?? '' ).trim() );

	return (
		<div className="vsa-recording">
			{ playable && ( url ? <AudioPlayer ref={ audioRef } src={ url } onTime={ setTime } /> : ! audioError && <Spinner /> ) }
			{ audioError && <p className="vsa-muted">{ audioError }</p> }
			{ error && <p className="vsa-error">{ error }</p> }
			{ ! data && ! error && <Spinner /> }
			{ data && (
				<Transcript
					sentences={ sentences }
					labelled={ data.speakerLabels !== 'off' && sentences.some( ( s ) => s.speaker >= 0 ) }
					names={ names }
					time={ time }
					onSeek={ seek }
					onRename={ canName && ! lang ? rename : undefined }
				/>
			) }
		</div>
	);
}

export { Icon };
