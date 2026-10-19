/**
 * The player widget.
 *
 * - media: a Media Library file; its player and transcript are in the page.
 * - recording: a VocalStack recording; the audio URL (a media token, never
 *   the site's key) and transcript come from /widgets/player/source.
 * - broadcast: a public broadcast. While it is live, the transcript arrives
 *   over VocalStack's listener socket (and, on request, live audio); between
 *   recordings the broadcast's events socket says when the next one starts,
 *   and the last recording plays meanwhile.
 */
import { __, sprintf } from '@wordpress/i18n';
import { api, boot, part, sleep, status } from '../shared/dom';
import TranscriptView from '../shared/transcript';
import LiveAudio, { supported as liveAudioSupported } from '../shared/live-audio';
import languages from './language';
import { voiceFormat } from '../shared/voice-queue';
import './player.scss';

boot( 'player', ( root, config ) => {
	const transcriptEl = part( root, 'transcript' );
	const view = transcriptEl ? new TranscriptView( transcriptEl, { timestamps: config.timestamps, speakers: config.speakers, live: config.source === 'broadcast', announce: config.source === 'broadcast' ? part( root, 'announce' ) : null } ) : null;
	const media = part( root, 'media' );

	if ( config.source === 'media' ) {
		// The transcript is server-rendered; only link it.
		if ( view && media && transcriptEl.querySelector( '[data-start]' ) ) {
			view.link( media );
			transcriptEl.classList.add( 'is-linked' );
		}
		// Another language needs the file's VocalStack recording: a media token, asked for once.
		let token = null;
		languages( root, config, view, media, {
			token: async () => {
				token ??= api( config, 'widgets/player/source', { params: { ticket: config.ticket } } ).then( ( d ) => d.mediaToken || '' );
				return token;
			},
		} );
		return;
	}
	if ( config.source === 'recording' ) {
		recording( root, config, view, media );
	} else {
		broadcast( root, config, view, media );
	}
} );

async function recording( root, config, view, media ) {
	const line = part( root, 'status' );
	try {
		const data = await api( config, 'widgets/player/source', { params: { ticket: config.ticket } } );
		media.src = data.audioUrl;
		media.preload = 'metadata';
		media.hidden = false;
		if ( view ) {
			view.set( data.sentences );
			view.link( media );
		}
		line.hidden = true;
		languages( root, config, view, media, { token: () => data.mediaToken || '' } );
	} catch ( error ) {
		status( line, error.message, true );
	}
}

/**
 * Follow a public broadcast.
 *
 * @param {HTMLElement}      root   Widget root.
 * @param {Object}           config Widget configuration.
 * @param {TranscriptView}   view   The transcript, if shown.
 * @param {HTMLMediaElement} media  The player for finished recordings.
 */
async function broadcast( root, config, view, media ) {
	const line = part( root, 'status' );
	const live = part( root, 'live' );
	const listen = part( root, 'listen' );
	const share = part( root, 'share' );
	let source;
	try {
		source = await api( config, 'widgets/player/source', { params: { ticket: config.ticket } } );
	} catch ( error ) {
		status( line, error.message, true );
		return;
	}
	if ( source.shareUrl ) {
		share.href = source.shareUrl;
		share.hidden = false;
		live.hidden = false;
	}

	let listener = null;
	let audio = null;
	let isLive = false;
	let liveId = null;
	// Live sentences as they came (with their segment seqs), and segment translations by seq.
	const raw = new Map();
	const segmentTranslations = new Map();
	let lc = null;

	/** A live sentence's text in the listener's language, once every segment of it is translated. */
	const shown = ( s ) => {
		const lang = lc?.lang();
		if ( ! lang ) {
			return s;
		}
		const own = s.translations?.[ lang ];
		if ( own ) {
			return { ...s, text: own };
		}
		const parts = ( s.seqs || [] ).map( ( seq ) => segmentTranslations.get( seq )?.[ lang ] );
		return parts.length && parts.every( Boolean ) ? { ...s, text: parts.join( ' ' ) } : s;
	};
	const upsertLive = ( s ) => {
		const id = s.sentenceId ?? s.id;
		raw.set( id, s );
		view?.upsert( shown( s ) );
	};
	const rerenderLive = () => raw.forEach( ( s ) => view?.upsert( shown( s ) ) );

	/** The listener chose a language while the broadcast is live. */
	const liveLanguage = ( lang ) => {
		listener?.send( { type: 'subscribe.update', lang: lang || null } );
		rerenderLive();
		lc.queue.stop();
		if ( lang && lc.voiced( lang ) ) {
			lc.queue.live();
			lc.speak.hidden = false;
			lc.speak.textContent = __( 'Listen', 'vocalstack' );
			lc.speak.setAttribute( 'aria-pressed', 'false' );
			status( lc.line, sprintf( /* translators: %s: language name */ __( 'Press Listen to hear it in %s.', 'vocalstack' ), lc.name() ) );
		} else {
			lc.speak.hidden = true;
			status( lc.line, lang ? sprintf( /* translators: %s: language name */ __( 'Reading in %s.', 'vocalstack' ), lc.name() ) : '' );
		}
	};

	const showLast = () => {
		isLive = false;
		live.querySelector( '.vocalstack-player__badge' )?.setAttribute( 'hidden', '' );
		listen.hidden = true;
		if ( view ) {
			// A finished recording reads from its start; only a live one follows the end.
			view.options.live = false;
		}
		if ( source.last?.recordingId ) {
			status( line, source.last.title ? `${ __( 'Last broadcast:', 'vocalstack' ) } ${ source.last.title }` : __( 'Not live right now. Here is the last broadcast.', 'vocalstack' ) );
			media.src = source.last.audioUrl;
			media.hidden = false;
			loadBacklog( source.last.recordingId );
		} else {
			status( line, __( 'Not live right now. The transcript appears here when the broadcast starts.', 'vocalstack' ) );
		}
	};

	const loadBacklog = async ( recordingId, after = 0 ) => {
		if ( ! view ) {
			return 0;
		}
		try {
			const data = await api( config, 'widgets/player/transcript', { params: { ticket: config.ticket, recording: recordingId, after, lang: isLive ? lc?.lang() || '' : '' } } );
			if ( isLive ) {
				data.sentences.forEach( ( s ) => upsertLive( s ) );
			} else if ( ! after ) {
				view.set( data.sentences );
			} else {
				data.sentences.forEach( ( s ) => view.upsert( s ) );
			}
			if ( ! after && media.src ) {
				view.link( media );
			}
			return data.lastSeq;
		} catch {
			return 0;
		}
	};

	const goLive = ( recordingId ) => {
		isLive = true;
		liveId = recordingId;
		raw.clear();
		segmentTranslations.clear();
		listener?.close();
		audio?.stop();
		audio = null;
		media.pause();
		media.hidden = true;
		media.removeAttribute( 'src' );
		if ( view ) {
			view.options.live = true;
		}
		view?.set( [] );
		live.hidden = false;
		live.querySelector( '.vocalstack-player__badge' )?.removeAttribute( 'hidden' );
		status( line, __( 'Live now. The transcript follows as it is spoken.', 'vocalstack' ) );
		listen.hidden = ! liveAudioSupported();
		listen.setAttribute( 'aria-pressed', 'false' );
		listen.textContent = __( 'Listen live', 'vocalstack' );
		listener = subscribe( config, source, recordingId, lc?.lang() || '', {
			ready: () => loadBacklog( recordingId ),
			sentence: ( s ) => upsertLive( s ),
			translated: ( frame ) => {
				segmentTranslations.set( frame.seq, { ...segmentTranslations.get( frame.seq ), ...frame.translations } );
				raw.forEach( ( s ) => {
					if ( ( s.seqs || [] ).includes( frame.seq ) ) {
						view?.upsert( shown( s ) );
					}
				} );
			},
			voice: ( frame ) => {
				if ( lc && frame.lang === lc.lang() && ( frame.url || frame.audio ) ) {
					const src = frame.url ? `${ config.api }${ frame.url }${ frame.url.includes( '?' ) ? '&' : '?' }format=${ voiceFormat() }` : `data:audio/ogg;base64,${ frame.audio }`;
					lc.queue.push( { id: frame.sentenceId, src } );
				}
			},
			draft: ( text ) => view?.setDraft( text ),
			audio: ( bytes ) => audio?.push( bytes ),
			ended: () => {
				isLive = false;
				view?.setDraft( '' );
				status( line, __( 'The broadcast has ended.', 'vocalstack' ) );
				listen.hidden = true;
				audio?.stop();
				audio = null;
			},
		} );
	};

	lc = languages( root, config, view, media, {
		recording: () => ( isLive ? liveId : source.last?.recordingId ) || '',
		isLive: () => isLive,
		live: liveLanguage,
	} );
	lc?.speak.addEventListener( 'click', () => {
		// Hearing the translation replaces hearing the original live audio.
		if ( isLive && audio ) {
			audio.stop();
			audio = null;
			listener?.send( { type: 'subscribe.update', audio: false } );
			listen.setAttribute( 'aria-pressed', 'false' );
			listen.textContent = __( 'Listen live', 'vocalstack' );
		}
	} );

	listen.addEventListener( 'click', async () => {
		if ( audio ) {
			audio.stop();
			audio = null;
			listener?.send( { type: 'subscribe.update', audio: false } );
			listen.setAttribute( 'aria-pressed', 'false' );
			listen.textContent = __( 'Listen live', 'vocalstack' );
			return;
		}
		audio = new LiveAudio();
		try {
			await audio.start();
		} catch {
			audio = null;
			status( line, __( 'This browser can’t play the live audio. The transcript still follows.', 'vocalstack' ), true );
			return;
		}
		listener?.send( { type: 'subscribe.update', audio: true } );
		listen.setAttribute( 'aria-pressed', 'true' );
		listen.textContent = __( 'Stop listening', 'vocalstack' );
	} );

	if ( source.live?.recordingId && [ 'live', 'paused', 'pending' ].includes( source.live.state ) ) {
		goLive( source.live.recordingId );
	} else {
		showLast();
	}

	// Recordings start and end on the broadcast: follow them.
	reconnecting( `${ config.socket }/v1/broadcasts/${ encodeURIComponent( source.broadcastId ) }/events`, {
		message: ( frame ) => {
			if ( frame.type === 'recording.started' && frame.recordingId ) {
				goLive( frame.recordingId );
			}
		},
	} );
}

/**
 * The listener socket for one recording.
 *
 * @param {Object} config      Widget configuration.
 * @param {Object} source      The broadcast.
 * @param {string} recordingId Recording.
 * @param {Object} on          Handlers: ready, sentence, draft, audio, ended.
 * @return {{close: Function, send: Function}} Controls.
 */
function subscribe( config, source, recordingId, lang, on ) {
	let lastSeq = 0;
	let wantsAudio = false;
	let wantsLang = lang;
	// The listener's language rides on the address too, so a reconnect keeps it.
	const address = () => `${ config.socket }/v1/recordings/${ encodeURIComponent( recordingId ) }/subscribe?role=listener${ wantsLang ? `&lang=${ encodeURIComponent( wantsLang ) }` : '' }`;
	const url = address;
	const socket = reconnecting( url, {
		message: async ( frame ) => {
			switch ( frame.type ) {
				case 'subscribe.ready':
					lastSeq = frame.lastSeq || 0;
					await on.ready();
					if ( wantsAudio ) {
						socket.send( { type: 'subscribe.update', audio: true } );
					}
					break;
				case 'subscribe.gap':
					lastSeq = 0;
					await on.ready();
					break;
				case 'transcript.sentence':
					on.sentence( frame.sentence );
					break;
				case 'transcript.committed':
					// Sentences carry the text; committed segments only move the cursor.
					lastSeq = Math.max( lastSeq, frame.segment?.seq || 0 );
					break;
				case 'transcript.draft':
					on.draft( ( frame.segments || [] ).map( ( s ) => s.text ).join( ' ' ) );
					break;
				case 'transcript.translated':
					on.translated?.( frame );
					break;
				case 'transcript.voice':
					on.voice?.( frame );
					break;
				case 'recording.state':
					if ( [ 'ended', 'finalized' ].includes( frame.state ) ) {
						on.ended();
					}
					break;
			}
		},
		binary: ( data ) => on.audio( data ),
	} );
	return {
		close: () => socket.close(),
		send: ( frame ) => {
			if ( frame.type === 'subscribe.update' && 'audio' in frame ) {
				wantsAudio = frame.audio;
			}
			if ( frame.type === 'subscribe.update' && 'lang' in frame ) {
				wantsLang = frame.lang || '';
			}
			socket.send( frame );
		},
	};
}

/**
 * A WebSocket that reopens with backoff (1 s, 2 s, 4 s … 30 s) until closed.
 *
 * @param {string} url Socket URL.
 * @param {Object} on  `message(frame)` for JSON frames, `binary(ArrayBuffer)`.
 * @return {{close: Function, send: Function}} Controls.
 */
function reconnecting( url, on ) {
	let socket = null;
	let closed = false;
	let attempt = 0;
	const open = () => {
		socket = new window.WebSocket( typeof url === 'function' ? url() : url );
		socket.binaryType = 'arraybuffer';
		socket.addEventListener( 'open', () => {
			attempt = 0;
		} );
		socket.addEventListener( 'message', ( event ) => {
			if ( typeof event.data !== 'string' ) {
				on.binary?.( event.data );
				return;
			}
			try {
				on.message( JSON.parse( event.data ) );
			} catch {}
		} );
		socket.addEventListener( 'close', async () => {
			if ( closed ) {
				return;
			}
			await sleep( Math.min( 30000, 1000 * 2 ** attempt++ ) );
			if ( ! closed ) {
				open();
			}
		} );
	};
	open();
	return {
		close: () => {
			closed = true;
			socket?.close();
		},
		send: ( frame ) => {
			if ( socket?.readyState === window.WebSocket.OPEN ) {
				socket.send( JSON.stringify( frame ) );
			}
		},
	};
}
