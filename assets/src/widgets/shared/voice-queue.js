/**
 * A spoken translation, played a sentence at a time.
 *
 * VocalStack speaks any line of a recording on demand in a language it has a
 * voice for: `GET /v1/recordings/{id}/voice/{sentence}?lang=` answers with
 * that line as audio (Ogg/Opus, or CAF for Apple's media stack). Its own
 * reader plays a recording in another language this way, one line after
 * another through one audio element, fetching the next lines ahead; this does
 * the same. A live broadcast delivers its clips over the socket instead
 * (`push`), and the queue plays them as they come.
 *
 * Long lines may be spoken in pieces (`clips.parts`); `clips.rev` changes when
 * a line is corrected, so a cached clip of the old words isn't replayed.
 */

const AHEAD = 2;
const SKIP_AFTER_MS = 1200;

/** The container this browser plays Opus in: CAF on Safari/iOS, Ogg elsewhere. */
export function voiceFormat() {
	try {
		return document.createElement( 'audio' ).canPlayType( 'audio/x-caf; codecs=opus' ) === 'probably' ? 'caf' : 'ogg';
	} catch {
		return 'ogg';
	}
}

export default class VoiceQueue {
	/**
	 * @param {Object}   on
	 * @param {Function} on.sentence Called with the line being spoken (or null).
	 * @param {Function} on.state    Called with `playing`, `waiting`, `paused` or `ended`.
	 */
	constructor( on = {} ) {
		this.on = on;
		this.el = new window.Audio();
		this.el.preload = 'auto';
		this.items = [];
		this.index = -1;
		this.finite = true;
		this.playingNow = false;
		this.starved = false; // Live: played everything so far, waiting for the next clip.
		this.warm = new Map();
		this.el.addEventListener( 'ended', () => this.next() );
		this.el.addEventListener( 'playing', () => this.on.state?.( 'playing' ) );
		this.el.addEventListener( 'waiting', () => this.on.state?.( 'waiting' ) );
		this.el.addEventListener( 'error', () => {
			// A line VocalStack won't speak (hidden as unclear, or not found): read on.
			if ( this.playingNow ) {
				setTimeout( () => this.next(), SKIP_AFTER_MS );
			}
		} );
	}

	/**
	 * A finished recording's lines, in reading order.
	 *
	 * @param {Object} reading
	 * @param {string} reading.api         API origin.
	 * @param {string} reading.recordingId Recording.
	 * @param {string} reading.lang        Language.
	 * @param {Array}  reading.sentences   `{id}` in reading order.
	 * @param {Object} reading.clips       `parts`, `rev` by sentence id.
	 * @param {string} reading.media       A media token, or '' (a public broadcast needs none).
	 */
	load( { api, recordingId, lang, sentences, clips = {}, media = '' } ) {
		this.stop();
		this.finite = true;
		const format = voiceFormat();
		this.items = sentences.flatMap( ( s ) => {
			const parts = Math.max( 1, Number( clips.parts?.[ s.id ] ?? 1 ) || 1 );
			return Array.from( { length: parts }, ( _, part ) => {
				const q = new URLSearchParams( { lang, format } );
				if ( part > 0 ) {
					q.set( 'part', String( part ) );
				}
				if ( clips.rev?.[ s.id ] ) {
					q.set( 'v', clips.rev[ s.id ] );
				}
				if ( media ) {
					q.set( 'media', media );
				}
				return { id: s.id, src: `${ api }/v1/recordings/${ encodeURIComponent( recordingId ) }/voice/${ s.id }?${ q }` };
			} );
		} );
	}

	/** Live: clips arrive as they are spoken; the queue plays them in order and waits for more. */
	live() {
		this.stop();
		this.finite = false;
		this.items = [];
	}

	/**
	 * A clip from the socket (`transcript.voice`).
	 *
	 * @param {Object} clip `id`, `src`.
	 */
	push( clip ) {
		this.items.push( clip );
		if ( this.playingNow && this.starved ) {
			this.starved = false;
			this.go( this.index + 1 );
		}
	}

	/**
	 * Speak from a line (the first, if none is given).
	 *
	 * @param {number|null} id Sentence id.
	 */
	playFrom( id = null ) {
		const at = id === null ? 0 : this.items.findIndex( ( item ) => item.id === id );
		this.playingNow = true;
		this.go( Math.max( 0, at ) );
	}

	resume() {
		if ( this.index < 0 ) {
			if ( ! this.finite && ! this.items.length ) {
				// Live, nothing spoken yet: start with the first clip that arrives.
				this.playingNow = true;
				this.starved = true;
				this.on.state?.( 'waiting' );
				return;
			}
			this.playFrom();
			return;
		}
		this.playingNow = true;
		this.el.play().catch( () => {} );
		this.on.state?.( 'playing' );
	}

	pause() {
		this.playingNow = false;
		this.el.pause();
		this.on.state?.( 'paused' );
	}

	get playing() {
		return this.playingNow;
	}

	/** The line being spoken, or null. */
	get current() {
		return this.items[ this.index ]?.id ?? null;
	}

	stop() {
		this.playingNow = false;
		this.starved = false;
		this.el.pause();
		this.el.removeAttribute( 'src' );
		this.index = -1;
		this.warm.clear();
		this.on.sentence?.( null );
	}

	next() {
		if ( ! this.playingNow ) {
			return;
		}
		if ( this.index + 1 >= this.items.length ) {
			if ( this.finite ) {
				this.playingNow = false;
				this.on.sentence?.( null );
				this.on.state?.( 'ended' );
			} else {
				// Live: the next clip to arrive plays (push).
				this.starved = true;
			}
			return;
		}
		this.go( this.index + 1 );
	}

	go( index ) {
		const item = this.items[ index ];
		if ( ! item ) {
			return;
		}
		const previous = this.items[ this.index ]?.id;
		this.index = index;
		this.el.src = item.src;
		this.el.play().catch( () => {} );
		if ( item.id !== previous ) {
			this.on.sentence?.( item.id );
		}
		this.on.state?.( 'waiting' );
		// Ask for the next lines now, so they are spoken by the time they're reached.
		for ( let i = index + 1; i <= index + AHEAD && i < this.items.length; i++ ) {
			const src = this.items[ i ].src;
			if ( ! this.warm.has( src ) ) {
				const ahead = new window.Audio();
				ahead.preload = 'auto';
				ahead.src = src;
				this.warm.set( src, ahead );
			}
		}
		if ( this.warm.size > 12 ) {
			[ ...this.warm.keys() ].slice( 0, this.warm.size - 12 ).forEach( ( k ) => this.warm.delete( k ) );
		}
	}
}
