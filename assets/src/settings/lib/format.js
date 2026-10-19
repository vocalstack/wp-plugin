/**
 * Formatting shared by the lists and detail screens, following the VocalStack
 * dashboard's conventions.
 */
import { __, sprintf } from '@wordpress/i18n';

/** `mm:ss`, or `h:mm:ss` past an hour. */
export function clock( seconds ) {
	const s = Math.max( 0, Math.floor( Number( seconds ) || 0 ) );
	const h = Math.floor( s / 3600 );
	const m = Math.floor( ( s % 3600 ) / 60 );
	const r = String( s % 60 ).padStart( 2, '0' );
	return h ? `${ h }:${ String( m ).padStart( 2, '0' ) }:${ r }` : `${ String( m ).padStart( 2, '0' ) }:${ r }`;
}

const time = ( d ) => d.toLocaleTimeString( undefined, { hour: '2-digit', minute: '2-digit' } );
const sameDay = ( a, b ) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** "Today, 19:09", "Yesterday, 08:12", or "Oct 3" (local time). */
export function when( iso ) {
	if ( ! iso ) return '';
	const d = new Date( iso );
	if ( Number.isNaN( d.getTime() ) ) return '';
	const now = new Date();
	const yesterday = new Date( now );
	yesterday.setDate( now.getDate() - 1 );
	/* translators: %s: time of day */
	if ( sameDay( d, now ) ) return sprintf( __( 'Today, %s', 'vocalstack' ), time( d ) );
	/* translators: %s: time of day */
	if ( sameDay( d, yesterday ) ) return sprintf( __( 'Yesterday, %s', 'vocalstack' ), time( d ) );
	return d.toLocaleDateString( undefined, { month: 'short', day: 'numeric', ...( d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {} ) } );
}

/** "Oct 3, 09:38": a live recording's start. */
export function whenLong( iso ) {
	if ( ! iso ) return '';
	const d = new Date( iso );
	return `${ d.toLocaleDateString( undefined, { month: 'short', day: 'numeric' } ) }, ${ time( d ) }`;
}

/** A URL without its scheme and `www.`. */
export const bareUrl = ( url ) => String( url ?? '' ).replace( /^[a-z][a-z0-9+.-]*:\/\//i, '' ).replace( /^www\./, '' ).replace( /\/$/, '' );

/** A YouTube video id in a URL, or null. */
export function youtubeId( url ) {
	const m = String( url ?? '' ).match( /(?:youtube\.com\/(?:watch\?v=|live\/|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/ );
	return m ? m[ 1 ] : null;
}

const VIDEO_EXT = /\.(mp4|mov|mkv|webm|avi|m4v)(\?|$)/i;
const VIDEO_FORMAT = /^(mp4|mov|mkv|webm|avi|m4v)$/i;

/** Whether a job's source is video. */
export function isVideo( source ) {
	if ( ! source ) return false;
	return (
		String( source.mime ?? '' ).startsWith( 'video/' ) ||
		VIDEO_EXT.test( source.url ?? '' ) ||
		VIDEO_EXT.test( source.name ?? '' ) ||
		VIDEO_FORMAT.test( source.format ?? '' )
	);
}

/** A live source's class: mic, rtmp, youtube or radio. */
export function captureClass( source ) {
	const url = source?.url;
	if ( ! url ) return 'mic';
	if ( /^rtmps?:\/\//i.test( url ) ) return 'rtmp';
	if ( youtubeId( url ) ) return 'youtube';
	return 'radio';
}

export const CAPTURE_LABEL = {
	mic: __( 'Microphone', 'vocalstack' ),
	youtube: __( 'YouTube live', 'vocalstack' ),
	radio: __( 'Radio stream', 'vocalstack' ),
	rtmp: __( 'RTMP stream', 'vocalstack' ),
};

/** File size, "36.6 KB". */
export function bytes( n ) {
	const v = Number( n ) || 0;
	if ( v < 1024 ) return `${ v } B`;
	const units = [ 'KB', 'MB', 'GB' ];
	let i = -1;
	let x = v;
	do {
		x /= 1024;
		i++;
	} while ( x >= 1024 && i < units.length - 1 );
	return `${ x.toFixed( x < 10 ? 1 : 0 ) } ${ units[ i ] }`;
}

/** A URL slug, as the dashboard makes broadcast codes. */
export const slugify = ( s ) =>
	String( s ?? '' )
		.normalize( 'NFKD' )
		.replace( /[̀-ͯ]/g, '' )
		.toLowerCase()
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-+|-+$/g, '' )
		.slice( 0, 60 );
