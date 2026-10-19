/**
 * Front end: click a sentence or timestamp to seek, and highlight the sentence
 * being spoken. A transcript follows its own player, or else the audio/video
 * on the page that plays the same file.
 */
import domReady from '@wordpress/dom-ready';

const mediaFor = ( transcript ) => {
	const own = transcript.querySelector( 'audio, video' );
	if ( own ) return own;
	const src = transcript.dataset.src;
	return [ ...document.querySelectorAll( 'audio, video' ) ].find(
		( m ) => m.currentSrc === src || m.src === src || m.querySelector( `source[src="${ CSS.escape( src ) }"]` )
	);
};

const follow = ( transcript ) => {
	const media = mediaFor( transcript );
	if ( ! media ) return;
	transcript.classList.add( 'is-linked' );
	const sentences = [ ...transcript.querySelectorAll( '.vocalstack-transcript__sentence' ) ];
	let current = null;

	transcript.addEventListener( 'click', ( event ) => {
		const target = event.target.closest( '[data-start]' );
		if ( ! target || ! transcript.contains( target ) ) return;
		media.currentTime = Number( target.dataset.start );
		media.play?.();
	} );

	media.addEventListener( 'timeupdate', () => {
		const t = media.currentTime;
		const next = sentences.find( ( s ) => t >= Number( s.dataset.start ) && t < Number( s.dataset.end ) ) ?? null;
		if ( next === current ) return;
		current?.classList.remove( 'is-current' );
		next?.classList.add( 'is-current' );
		current = next;
	} );
};

domReady( () => document.querySelectorAll( '.vocalstack-transcript' ).forEach( follow ) );
