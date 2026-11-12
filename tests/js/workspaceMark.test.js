/**
 * The dashboard's cases (app/src/lib/workspaceMark.test.ts), so the plugin
 * draws a workspace exactly as VocalStack does.
 */
import { workspaceHue, workspaceInitials } from '../../assets/src/settings/lib/workspaceMark';

describe( 'workspaceInitials', () => {
	it( 'shows the first letter of each of the first two words', () => {
		expect( workspaceInitials( 'Acme studio' ) ).toBe( 'AS' );
		expect( workspaceInitials( '  north   radio  live ' ) ).toBe( 'NR' );
	} );

	it( 'shows the first two letters of a one-word name', () => {
		expect( workspaceInitials( 'Podcast' ) ).toBe( 'PO' );
		expect( workspaceInitials( 'X' ) ).toBe( 'X' );
	} );

	it( 'skips punctuation and emoji-only words', () => {
		expect( workspaceInitials( '— Church & choir' ) ).toBe( 'CC' );
		expect( workspaceInitials( '"Évora" talks' ) ).toBe( 'ÉT' );
		expect( workspaceInitials( '   ' ) ).toBe( '?' );
		expect( workspaceInitials( undefined ) ).toBe( '?' );
	} );
} );

describe( 'workspaceHue', () => {
	it( 'gives the same workspace the same colour', () => {
		expect( workspaceHue( 'ws_1' ) ).toBe( workspaceHue( 'ws_1' ) );
		const seen = new Set( [ 'a', 'b', 'c', 'd', 'e', 'f', 'g', 'h' ].map( workspaceHue ) );
		expect( seen.size ).toBeGreaterThan( 2 );
	} );

	it( 'matches the dashboard for known ids', () => {
		// Values the dashboard's own workspaceHue gives.
		expect( workspaceHue( '' ) ).toBe( 330 );
		expect( workspaceHue( 'a' ) ).toBe( 330 );
		expect( workspaceHue( 'ws_1' ) ).toBe( 12 );
		expect( workspaceHue( '3f2b8c1e-7a4d-4e9b-9c55-0d1e2f3a4b5c' ) ).toBe( 12 );
	} );
} );
