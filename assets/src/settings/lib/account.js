/**
 * Account-wide data the screens share, fetched once per page: the language
 * list (names and flags) and which key this site uses.
 */
import { useEffect, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { vs, wp } from './api';

let languagesPromise = null;
let mePromise = null;
let linksPromise = null;

export function loadLanguages() {
	languagesPromise ??= vs( 'languages' )
		.then( ( r ) => r?.languages ?? [] )
		.catch( () => {
			languagesPromise = null;
			return [];
		} );
	return languagesPromise;
}

export function loadMe() {
	mePromise ??= vs( 'me' ).catch( () => {
		mePromise = null;
		return {};
	} );
	return mePromise;
}

/** Transcription id → Media Library file, for transcriptions this site made. */
export function loadLinks( fresh = false ) {
	if ( fresh ) linksPromise = null;
	linksPromise ??= wp( 'links' ).catch( () => {
		linksPromise = null;
		return {};
	} );
	return linksPromise;
}

function usePromise( load, initial ) {
	const [ value, setValue ] = useState( initial );
	useEffect( () => {
		let live = true;
		load().then( ( v ) => live && setValue( v ) );
		return () => {
			live = false;
		};
	}, [ load ] );
	return value;
}

export const useLanguages = () => usePromise( loadLanguages, [] );
export const useMe = () => usePromise( loadMe, {} );
export const useLinks = () => usePromise( loadLinks, {} );

/** Language code → { name, native, flag }. */
export function languageInfo( languages, code ) {
	if ( ! code ) return null;
	const base = String( code ).split( '-' )[ 0 ];
	return languages.find( ( l ) => l.code === code ) ?? languages.find( ( l ) => l.code === base ) ?? { code, name: String( code ).toUpperCase(), native: String( code ).toUpperCase(), flag: '' };
}

/** Select options: Auto detect, then every transcription language. */
export function languageOptions( languages, { auto = true } = {} ) {
	const list = languages
		.filter( ( l ) => l.transcription !== false )
		.map( ( l ) => ( { value: l.code, label: `${ l.flag ? l.flag + ' ' : '' }${ l.name }${ l.native && l.native !== l.name ? ` (${ l.native })` : '' }` } ) )
		.sort( ( a, b ) => a.label.replace( /^\S+\s/, '' ).localeCompare( b.label.replace( /^\S+\s/, '' ) ) );
	return auto ? [ { value: '', label: __( 'Auto detect', 'vocalstack' ) }, ...list ] : list;
}

export const SPEAKER_OPTIONS = [
	{ value: 'auto', label: __( 'When needed', 'vocalstack' ) },
	{ value: 'on', label: __( 'Always', 'vocalstack' ) },
	{ value: 'off', label: __( 'Off', 'vocalstack' ) },
];
