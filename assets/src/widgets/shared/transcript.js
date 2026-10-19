/**
 * A transcript in a widget: sentences that arrive live or all at once, grouped
 * into paragraphs (a new one on a speaker change or a pause over 2.5 s),
 * optionally linked to a media element for click-to-seek and highlighting.
 *
 * The markup matches templates/transcript.php, so the server's rendering and
 * this one look the same and a theme styles both with the same classes.
 */
import { __, sprintf } from '@wordpress/i18n';
import { clock } from './dom';

const PAUSE = 2.5;

export default class TranscriptView {
	/**
	 * @param {HTMLElement} el      The transcript part.
	 * @param {Object}      options `timestamps`, `speakers` (show names), `live` (follow the newest line),
	 *                              `announce` (a polite live region: each finished sentence is read once).
	 */
	constructor( el, { timestamps = true, speakers = true, live = false, announce = null } = {} ) {
		this.el = el;
		this.options = { timestamps, speakers, live };
		this.announcer = announce;
		this.announced = new Set();
		this.sentences = new Map();
		this.draft = '';
		this.frame = 0;
		this.media = null;
		this.current = null;
		// Set while a spoken translation plays: a click asks for that line (id, start) instead of seeking the media.
		this.onPick = null;
		this.spokenId = null;
	}

	/**
	 * Replace every sentence.
	 *
	 * @param {Array} sentences `{id, start, end, speaker, text}`.
	 */
	set( sentences ) {
		this.sentences.clear();
		sentences.forEach( ( s, i ) => this.sentences.set( s.id ?? i, s ) );
		this.schedule();
	}

	/**
	 * Add or replace one sentence, by id; `dropped` removes it.
	 *
	 * @param {Object} sentence A sentence, with `sentenceId` or `id`.
	 */
	upsert( sentence ) {
		const id = sentence.sentenceId ?? sentence.id;
		if ( sentence.status === 'dropped' || ! String( sentence.text || '' ).trim() ) {
			this.sentences.delete( id );
		} else {
			this.sentences.set( id, { id, start: sentence.start ?? 0, end: sentence.end ?? 0, speaker: sentence.speaker ?? -1, text: sentence.text.trim() } );
			// Re-rendering the transcript would make a live region repeat itself: read each finished sentence once instead.
			if ( this.announcer && sentence.status === 'closed' && ! this.announced.has( id ) ) {
				this.announced.add( id );
				this.announcer.textContent = sentence.text.trim();
			}
		}
		this.schedule();
	}

	/**
	 * The words being heard but not settled yet.
	 *
	 * @param {string} text Draft text, or ''.
	 */
	setDraft( text ) {
		this.draft = ( text || '' ).trim();
		this.schedule();
	}

	get size() {
		return this.sentences.size;
	}

	/**
	 * Follow a media element: clicking a line seeks it, the line being heard is highlighted.
	 *
	 * @param {HTMLMediaElement} media The player.
	 */
	link( media ) {
		if ( this.media === media ) {
			return;
		}
		this.media = media;
		this.el.classList.add( 'is-linked' );
		if ( ! this.clicks ) {
			this.clicks = true;
			this.el.addEventListener( 'click', ( event ) => {
				const target = event.target.closest( '[data-start]' );
				if ( ! target || ! this.el.contains( target ) ) {
					return;
				}
				if ( this.onPick ) {
					const sentence = target.closest( '[data-id]' ) || target.parentElement?.querySelector( '[data-id]' );
					this.onPick( sentence ? Number( sentence.dataset.id ) : null, Number( target.dataset.start ) );
					return;
				}
				if ( ! this.media ) {
					return;
				}
				this.media.currentTime = Number( target.dataset.start );
				this.media.play?.().catch( () => {} );
			} );
		}
		media.addEventListener( 'timeupdate', () => {
			if ( ! this.onPick ) {
				this.highlight( media.currentTime );
			}
		} );
	}

	/**
	 * Mark the line being spoken by id (a spoken translation has no timeline of its own).
	 *
	 * @param {number|null} id Sentence id, or null.
	 */
	highlightId( id ) {
		this.spokenId = id;
		const next = id === null ? null : this.el.querySelector( `.vocalstack-transcript__sentence[data-id="${ id }"]` );
		if ( next === this.current ) {
			return;
		}
		this.current?.classList.remove( 'is-current' );
		next?.classList.add( 'is-current' );
		this.current = next;
		if ( next && this.el.scrollHeight > this.el.clientHeight ) {
			next.scrollIntoView( { block: 'nearest', behavior: window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches ? 'auto' : 'smooth' } );
		}
	}

	/**
	 * Mark the sentence at `time`.
	 *
	 * @param {number} time Seconds.
	 */
	highlight( time ) {
		const next = [ ...this.el.querySelectorAll( '.vocalstack-transcript__sentence' ) ].find(
			( s ) => time >= Number( s.dataset.start ) && time < Number( s.dataset.end )
		) || null;
		if ( next === this.current ) {
			return;
		}
		this.current?.classList.remove( 'is-current' );
		next?.classList.add( 'is-current' );
		this.current = next;
	}

	schedule() {
		if ( ! this.frame ) {
			this.frame = window.requestAnimationFrame( () => {
				this.frame = 0;
				this.render();
			} );
		}
	}

	render() {
		const follow = this.options.live && this.el.scrollHeight - this.el.scrollTop - this.el.clientHeight < 48;
		const list = [ ...this.sentences.values() ].sort( ( a, b ) => a.start - b.start );
		const labelled = this.options.speakers && new Set( list.filter( ( s ) => s.speaker >= 0 ).map( ( s ) => s.speaker ) ).size > 1;
		const fragment = document.createDocumentFragment();
		let paragraph = null;
		let prev = null;
		list.forEach( ( s ) => {
			if ( ! paragraph || s.speaker !== prev.speaker || s.start - prev.end > PAUSE ) {
				paragraph = document.createElement( 'p' );
				paragraph.className = 'vocalstack-transcript__paragraph';
				// Name the speaker when it changes, not on every pause.
				if ( labelled && s.speaker >= 0 && ( ! prev || s.speaker !== prev.speaker ) ) {
					const name = document.createElement( 'span' );
					name.className = 'vocalstack-transcript__speaker';
					/* translators: %d: speaker number, from 1. */
					name.textContent = sprintf( __( 'Speaker %d', 'vocalstack' ), s.speaker + 1 );
					paragraph.append( name );
				}
				if ( this.options.timestamps ) {
					const time = document.createElement( 'button' );
					time.type = 'button';
					time.className = 'vocalstack-transcript__time';
					time.dataset.part = 'time';
					time.dataset.start = String( s.start );
					time.textContent = clock( s.start );
					paragraph.append( time, ' ' );
				}
				fragment.append( paragraph );
			}
			const span = document.createElement( 'span' );
			span.className = 'vocalstack-transcript__sentence';
			span.dataset.start = String( s.start );
			span.dataset.end = String( s.end );
			span.dataset.id = String( s.id );
			span.textContent = s.text;
			paragraph.append( span, ' ' );
			prev = s;
		} );
		if ( this.draft ) {
			const draft = document.createElement( 'p' );
			draft.className = 'vocalstack-transcript__draft';
			draft.textContent = this.draft;
			fragment.append( draft );
		}
		this.el.replaceChildren( fragment );
		this.el.hidden = ! list.length && ! this.draft;
		this.current = null;
		if ( this.onPick ) {
			if ( this.spokenId !== null ) {
				this.highlightId( this.spokenId );
			}
		} else if ( this.media && ( this.media.currentTime > 0 || ! this.media.paused ) ) {
			// Only once something has played: a paused player at 0:00 highlights nothing.
			this.highlight( this.media.currentTime );
		}
		if ( follow ) {
			this.el.scrollTop = this.el.scrollHeight;
		}
	}
}
