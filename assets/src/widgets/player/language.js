/**
 * "Listen in": hear and read a finished recording in another language.
 *
 * Choosing a language swaps the transcript for its translation and, where
 * VocalStack has a voice for the language, speaks it a sentence at a time
 * (VoiceQueue) from the line the listener was at. Original goes back to the
 * recording at the same place. A language with no voice keeps the original
 * audio under the translated text.
 *
 * The languages offered are the site owner's: each translation is billed to
 * the site's VocalStack account, so the server refuses any other.
 */
import { __, sprintf } from '@wordpress/i18n';
import { api, part, status } from '../shared/dom';
import VoiceQueue from '../shared/voice-queue';

/**
 * @param {HTMLElement}           root   Widget root.
 * @param {Object}                config Widget configuration.
 * @param {Object|null}           view   The transcript (TranscriptView).
 * @param {HTMLMediaElement|null} media  The recording's own player.
 * @param {Object}                source How to reach the recording: `token()` (a media token, or ''),
 *                                       `recording()` (the id, for a broadcast); for a live broadcast
 *                                       `isLive()` and `live(lang)`.
 * @return {{ reset: Function, lang: Function }|null} Controls, or null without a selector.
 */
export default function languages( root, config, view, media, source ) {
	const select = part( root, 'language' );
	if ( ! select ) {
		return null;
	}
	const speak = part( root, 'speak' );
	const line = part( root, 'language-status' );
	let original = null;
	let current = '';
	let request = 0;

	const label = ( playing ) => {
		speak.textContent = playing ? __( 'Pause', 'vocalstack' ) : __( 'Play', 'vocalstack' );
		speak.setAttribute( 'aria-pressed', String( playing ) );
	};
	const queue = new VoiceQueue( {
		sentence: ( id ) => view?.highlightId( id ),
		state: ( state ) => {
			label( state === 'playing' || state === 'waiting' );
			if ( state === 'waiting' ) {
				status( line, __( 'Speaking…', 'vocalstack' ) );
			} else if ( state === 'playing' ) {
				status( line, '' );
			} else if ( state === 'ended' ) {
				status( line, __( 'The end.', 'vocalstack' ) );
			}
		},
	} );
	const name = () => select.selectedOptions[ 0 ]?.textContent.trim() || '';

	/** The line being heard in the original, to carry the place across. */
	const lineAt = ( sentences ) => {
		if ( ! media || ! sentences?.length || ( media.paused && media.currentTime === 0 ) ) {
			return null;
		}
		const t = media.currentTime;
		const hit = sentences.find( ( s ) => t >= s.start && t < s.end ) || [ ...sentences ].reverse().find( ( s ) => s.start <= t );
		return hit ? hit.id : null;
	};

	const backToOriginal = () => {
		const spokenId = queue.current;
		const wasSpeaking = queue.playing;
		queue.stop();
		if ( view ) {
			view.onPick = null;
			view.highlightId( null );
			if ( original ) {
				view.set( original );
			}
		}
		speak.hidden = true;
		status( line, '' );
		if ( media ) {
			media.hidden = false;
			const s = original?.find( ( x ) => x.id === spokenId );
			if ( s ) {
				media.currentTime = s.start;
				if ( wasSpeaking ) {
					media.play().catch( () => {} );
				}
			}
		}
	};

	const choose = async ( lang ) => {
		const mine = ++request;
		current = lang;
		if ( source.isLive?.() ) {
			// A live broadcast translates over its socket; the broadcast code handles it.
			source.live( lang );
			return;
		}
		if ( ! lang ) {
			backToOriginal();
			return;
		}
		const wasPlaying = media && ! media.paused;
		status( line, sprintf( /* translators: %s: language name */ __( 'Translating into %s…', 'vocalstack' ), name() ) );
		select.disabled = true;
		let data;
		try {
			const recording = source.recording?.() || '';
			data = await api( config, 'widgets/player/translation', { params: { ticket: config.ticket, lang, recording } } );
		} catch ( error ) {
			if ( mine === request ) {
				status( line, error.message, true );
				select.value = '';
				current = '';
			}
			return;
		} finally {
			select.disabled = false;
		}
		if ( mine !== request ) {
			return; // Another language was chosen meanwhile.
		}
		original = data.sentences.map( ( s ) => ( { ...s, text: s.original } ) );
		const from = lineAt( original );
		view?.set( data.sentences );

		if ( ! data.voice ) {
			// No voice for this language: the original audio plays under the translated text.
			queue.stop();
			if ( view ) {
				view.onPick = null;
			}
			speak.hidden = true;
			if ( media ) {
				media.hidden = false;
			}
			status( line, sprintf( /* translators: %s: language name */ __( 'Reading in %s. VocalStack has no voice for it yet, so you hear the original.', 'vocalstack' ), name() ) );
			return;
		}

		let token = '';
		try {
			token = ( await source.token?.() ) || '';
		} catch {}
		queue.load( { api: config.api, recordingId: data.recordingId, lang, sentences: data.sentences, clips: data.clips || {}, media: token } );
		if ( media ) {
			media.pause();
			// A video stays in view (paused); an audio player gives way to the spoken translation.
			media.hidden = media.tagName === 'AUDIO';
		}
		if ( view ) {
			view.onPick = ( id ) => queue.playFrom( id );
		}
		speak.hidden = false;
		label( false );
		status( line, sprintf( /* translators: %s: language name */ __( 'Listening in %s. Press Play, or choose a line to start there.', 'vocalstack' ), name() ) );
		if ( wasPlaying ) {
			queue.playFrom( from );
		}
	};

	select.addEventListener( 'change', () => choose( select.value ) );
	speak.addEventListener( 'click', () => ( queue.playing ? queue.pause() : queue.resume() ) );

	return {
		/** A new recording (a broadcast moved on): back to the original. */
		reset: () => {
			original = null;
			if ( current ) {
				select.value = '';
				choose( '' );
			}
		},
		lang: () => current,
		voiced: ( lang ) => ( config.voices || [] ).includes( lang ),
		name,
		queue,
		speak,
		line,
	};
}
