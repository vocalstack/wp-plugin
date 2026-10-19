/**
 * Calls to VocalStack (through the plugin's admin pass-through) and to the
 * plugin's own routes.
 */
import apiFetch from '@wordpress/api-fetch';
import { addQueryArgs } from '@wordpress/url';

const clean = ( query ) =>
	Object.fromEntries( Object.entries( query ?? {} ).filter( ( [ , v ] ) => v !== undefined && v !== null && v !== '' ) );

const uuid = () =>
	window.crypto?.randomUUID?.() ??
	'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace( /[xy]/g, ( c ) => {
		const r = ( Math.random() * 16 ) | 0;
		return ( c === 'x' ? r : ( r & 0x3 ) | 0x8 ).toString( 16 );
	} );

/**
 * A VocalStack API call: `vs( 'transcriptions', { query: { lifecycle } } )`.
 * Creates pass `idempotent: true` and get an idempotency key.
 *
 * @param {string} path                   Path after /v1/.
 * @param {Object} [options]
 * @param {string} [options.method]       HTTP method.
 * @param {Object} [options.query]        Query string values.
 * @param {Object} [options.data]         JSON body.
 * @param {boolean} [options.idempotent]  Send an idempotency key.
 */
export function vs( path, { method = 'GET', query, data, idempotent = false } = {} ) {
	const headers = idempotent ? { 'Idempotency-Key': uuid() } : undefined;
	return apiFetch( {
		path: addQueryArgs( `/vocalstack/v1/api/${ path.replace( /^\//, '' ) }`, clean( query ) ),
		method,
		data,
		headers,
	} );
}

/**
 * A call to the plugin's own routes under /vocalstack/v1/.
 *
 * @param {string} path      Route after /vocalstack/v1/.
 * @param {Object} [options] apiFetch options.
 */
export function wp( path, options = {} ) {
	const { query, ...rest } = options;
	return apiFetch( { path: addQueryArgs( `/vocalstack/v1/${ path.replace( /^\//, '' ) }`, clean( query ) ), ...rest } );
}

/** Path segments are VocalStack ids: keep them safe in a URL. */
export const seg = ( id ) => encodeURIComponent( String( id ) );

/**
 * A readable message from a failed call: VocalStack's own, else WordPress's.
 *
 * @param {Object|Error} error The rejection.
 */
export function errorMessage( error ) {
	if ( ! error ) return '';
	const suggestions = error?.data?.details?.suggestions;
	const base = error.message || error.code || String( error );
	return suggestions?.length ? `${ base } (${ suggestions.join( ', ' ) })` : base;
}

export { uuid };
