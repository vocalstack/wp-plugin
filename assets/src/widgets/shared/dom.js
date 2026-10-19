/**
 * Small helpers shared by the widgets: startup, configuration, parts, REST calls.
 */
import { __ } from '@wordpress/i18n';

/**
 * Run `init` on every widget of a type once the DOM is ready.
 *
 * @param {string}   type `player`, `record` or `upload`.
 * @param {Function} init Called with (root, config).
 */
export function boot( type, init ) {
	const run = () => {
		document.querySelectorAll( '[data-vocalstack]' ).forEach( ( root ) => {
			if ( root.dataset.vocalstackReady ) {
				return;
			}
			let config;
			try {
				config = JSON.parse( root.dataset.vocalstack );
			} catch {
				return;
			}
			if ( config.type !== type ) {
				return;
			}
			root.dataset.vocalstackReady = '1';
			init( root, config );
		} );
	};
	if ( document.readyState === 'loading' ) {
		document.addEventListener( 'DOMContentLoaded', run, { once: true } );
	} else {
		// After the calling module has finished evaluating (its classes exist).
		queueMicrotask( run );
	}
}

/**
 * The element with `data-part="name"` inside a widget.
 *
 * @param {Element} root Widget root.
 * @param {string}  name Part name.
 * @return {HTMLElement|null} The part.
 */
export const part = ( root, name ) => root.querySelector( `[data-part="${ name }"]` );

/**
 * Show a message in a widget's status line.
 *
 * @param {HTMLElement|null} el      The status part.
 * @param {string}           message Text.
 * @param {boolean}          error   Whether it is an error.
 */
export function status( el, message, error = false ) {
	if ( ! el ) {
		return;
	}
	el.textContent = message;
	el.classList.toggle( 'is-error', error );
}

/**
 * Call one of the plugin's REST routes.
 *
 * @param {Object} config  The widget's configuration.
 * @param {string} route   Route under vocalstack/v1/, such as `widgets/record/start`.
 * @param {Object} options `method`, `params` (query) and `body` (JSON or FormData).
 * @return {Promise<Object>} The decoded answer; rejects with an Error carrying `status` and `code`.
 */
export async function api( config, route, { method = 'GET', params, body } = {} ) {
	const url = new URL( config.rest + route, window.location.href );
	Object.entries( params || {} ).forEach( ( [ key, value ] ) => url.searchParams.set( key, value ) );
	const headers = { 'X-WP-Nonce': config.nonce };
	let payload = body;
	if ( body && ! ( body instanceof FormData ) ) {
		headers[ 'Content-Type' ] = 'application/json';
		payload = JSON.stringify( body );
	}
	let response;
	try {
		response = await fetch( url, { method, headers, body: payload, credentials: 'same-origin' } );
	} catch {
		throw Object.assign( new Error( __( 'The connection failed. Check your internet connection and try again.', 'vocalstack' ) ), { status: 0, code: 'network' } );
	}
	const data = await response.json().catch( () => ( {} ) );
	if ( ! response.ok ) {
		throw Object.assign( new Error( data.message || __( 'Something went wrong. Try again.', 'vocalstack' ) ), { status: response.status, code: data.code || 'error' } );
	}
	return data;
}

/**
 * `m:ss`, or `h:mm:ss` past an hour.
 *
 * @param {number} seconds Seconds.
 * @return {string} The clock time.
 */
export function clock( seconds ) {
	const s = Math.max( 0, Math.floor( seconds ) );
	const pad = ( n ) => String( n ).padStart( 2, '0' );
	return s >= 3600 ? `${ Math.floor( s / 3600 ) }:${ pad( Math.floor( ( s % 3600 ) / 60 ) ) }:${ pad( s % 60 ) }` : `${ Math.floor( s / 60 ) }:${ pad( s % 60 ) }`;
}

/**
 * Wait.
 *
 * @param {number} ms Milliseconds.
 * @return {Promise<void>} Resolves after `ms`.
 */
export const sleep = ( ms ) => new Promise( ( resolve ) => setTimeout( resolve, ms ) );
