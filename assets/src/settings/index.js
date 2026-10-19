/**
 * The VocalStack admin page: the account's transcriptions and broadcasts (as
 * in the VocalStack dashboard), the Media Library's audio and video, the
 * widget generator, and settings.
 */
import apiFetch from '@wordpress/api-fetch';
import { Button, Notice, Spinner } from '@wordpress/components';
import domReady from '@wordpress/dom-ready';
import { createRoot, useEffect, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { navigate, useRoute } from './lib/router';
import MediaTab from './MediaTab';
import BroadcastDetail from './screens/BroadcastDetail';
import BroadcastsList from './screens/BroadcastsList';
import SettingsScreen from './screens/SettingsScreen';
import TranscriptionDetail from './screens/TranscriptionDetail';
import TranscriptionsList from './screens/TranscriptionsList';
import LiveScreen from './screens/LiveScreen';
import DashboardScreen from './screens/DashboardScreen';
import WidgetsScreen from './screens/WidgetsScreen';
import './settings.scss';
import './app.scss';

const NAV = [
	[ 'transcriptions', __( 'Transcriptions', 'vocalstack' ) ],
	[ 'broadcasts', __( 'Broadcasts', 'vocalstack' ) ],
	[ 'live', __( 'Live', 'vocalstack' ) ],
	[ 'media', __( 'Media Library', 'vocalstack' ) ],
	[ 'widgets', __( 'Widgets', 'vocalstack' ) ],
	[ 'settings', __( 'Settings', 'vocalstack' ) ],
];

/** Screens that read the VocalStack account need a connected key. */
const NEEDS_KEY = [ 'transcriptions', 'broadcasts', 'live' ];

function NotConnected() {
	return (
		<Notice status="warning" isDismissible={ false }>
			{ __( 'Connect a VocalStack account to see its transcriptions and broadcasts.', 'vocalstack' ) }{ ' ' }
			<Button variant="link" onClick={ () => navigate( '/settings/account' ) }>
				{ __( 'Connect an account', 'vocalstack' ) }
			</Button>
		</Notice>
	);
}

function Screen( { route, connected, onConnection } ) {
	if ( NEEDS_KEY.includes( route.section ) && ! connected ) return <NotConnected />;
	switch ( route.section ) {
		case '':
		case 'dashboard':
			return <DashboardScreen connected={ connected } />;
		case 'transcriptions':
			// #/transcriptions/new opens the list with New transcription open.
			return route.id && route.id !== 'new' ? <TranscriptionDetail key={ route.id } id={ route.id } /> : <TranscriptionsList key={ route.id } startNew={ route.id === 'new' } />;
		case 'broadcasts':
			return route.id ? <BroadcastDetail key={ route.id } id={ route.id } /> : <BroadcastsList />;
		case 'live':
			return <LiveScreen key={ route.id } broadcastId={ route.id } />;
		case 'media':
			return <MediaTab />;
		case 'widgets':
			return <WidgetsScreen />;
		default:
			return <SettingsScreen section={ route.id || 'account' } onConnection={ onConnection } />;
	}
}

function App( { connected: initiallyConnected } ) {
	const [ connected, setConnected ] = useState( initiallyConnected );
	// Home is the dashboard: no tab of its own; the VocalStack logo comes back to it.
	const route = useRoute( '/dashboard' );
	return (
		<div className="vsa-app">
			<nav className="nav-tab-wrapper vsa-nav" aria-label={ __( 'VocalStack', 'vocalstack' ) }>
				{ NAV.map( ( [ section, label ] ) => (
					<a
						key={ section }
						href={ `#/${ section }` }
						className={ `nav-tab${ route.section === section ? ' nav-tab-active' : '' }` }
						aria-current={ route.section === section ? 'page' : undefined }
					>
						{ label }
					</a>
				) ) }
			</nav>
			<Screen route={ route } connected={ connected } onConnection={ setConnected } />
		</div>
	);
}

function Boot() {
	const [ connected, setConnected ] = useState( null );
	useEffect( () => {
		apiFetch( { path: '/vocalstack/v1/settings' } ).then(
			( s ) => setConnected( s.connection.source !== 'none' ),
			() => setConnected( false )
		);
	}, [] );
	return connected === null ? <Spinner /> : <App connected={ connected } />;
}

domReady( () => {
	const root = document.getElementById( 'vocalstack-settings' );
	if ( root ) createRoot( root ).render( <Boot /> );
} );
