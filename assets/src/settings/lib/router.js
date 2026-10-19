/**
 * Hash routes: #/transcriptions, #/transcriptions/<id>, #/broadcasts/<id>, …
 * Old `&tab=` links land on the matching route.
 */
import { useEffect, useState } from '@wordpress/element';

const TAB_ROUTES = {
	media: '/media',
	account: '/settings/account',
	transcription: '/settings/transcription',
	display: '/settings/display',
	widgets: '/widgets',
};

export function parse( hash ) {
	const path = String( hash ?? '' ).replace( /^#/, '' ) || '';
	const [ , section = '', id = '', sub = '' ] = path.split( '/' ).map( decodeURIComponent );
	return { path, section, id, sub };
}

/** The route the page opens on, honouring an old `&tab=` link. */
export function initialPath( fallback ) {
	if ( window.location.hash.length > 1 ) return window.location.hash.slice( 1 );
	const tab = new URLSearchParams( window.location.search ).get( 'tab' );
	return TAB_ROUTES[ tab ] ?? fallback;
}

export function navigate( path ) {
	const next = `#${ path }`;
	if ( window.location.hash !== next ) window.location.hash = next;
}

/** The current route, following hash changes. */
export function useRoute( fallback ) {
	const [ route, setRoute ] = useState( () => parse( `#${ initialPath( fallback ) }` ) );
	useEffect( () => {
		if ( ! window.location.hash || window.location.hash === '#' ) {
			window.history.replaceState( null, '', `#${ initialPath( fallback ) }` );
		}
		const onChange = () => setRoute( parse( window.location.hash || `#${ fallback }` ) );
		window.addEventListener( 'hashchange', onChange );
		return () => window.removeEventListener( 'hashchange', onChange );
	}, [ fallback ] );
	return route;
}
