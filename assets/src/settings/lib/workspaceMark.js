/**
 * A workspace's mark when it has no icon of its own, exactly as the VocalStack
 * dashboard draws it: its initials on a tile tinted with its colour.
 */

/**
 * Two letters for a workspace: the first letter of its first two words, or the
 * first two letters of its only word. Punctuation and emoji are skipped.
 *
 * @param {string} name The workspace's name.
 * @return {string} The initials, or '?'.
 */
export function workspaceInitials( name ) {
	const words = String( name ?? '' )
		.trim()
		.split( /\s+/ )
		.filter( ( w ) => /[\p{L}\p{N}]/u.test( w ) );
	const first = ( w ) => Array.from( w.replace( /^[^\p{L}\p{N}]+/u, '' ) )[ 0 ] ?? '';
	if ( words.length === 0 ) return '?';
	if ( words.length === 1 ) {
		return (
			Array.from( words[ 0 ].replace( /[^\p{L}\p{N}]/gu, '' ) )
				.slice( 0, 2 )
				.join( '' )
				.toUpperCase() || '?'
		);
	}
	return ( first( words[ 0 ] ) + first( words[ 1 ] ) ).toUpperCase();
}

const HUES = [ 252, 200, 160, 128, 85, 40, 12, 330, 296 ];

/**
 * The hue of a workspace's colour, from its id (FNV-1a over the dashboard's
 * nine hues), so every VocalStack tool tints a workspace the same way.
 *
 * @param {string} id The workspace's id.
 * @return {number} A hue in degrees.
 */
export function workspaceHue( id ) {
	const text = String( id ?? '' );
	let h = 2166136261;
	for ( let i = 0; i < text.length; i++ ) {
		h ^= text.charCodeAt( i );
		h = Math.imul( h, 16777619 );
	}
	return HUES[ ( h >>> 0 ) % HUES.length ];
}
