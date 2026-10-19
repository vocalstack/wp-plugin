/**
 * Mounts the transcript panel in the attachment edit screen's meta box.
 */
import domReady from '@wordpress/dom-ready';
import { createRoot } from '@wordpress/element';
import TranscribePanel from '../shared/TranscribePanel';
import '../shared/panel.scss';

domReady( () => {
	document.querySelectorAll( '.vocalstack-media-panel' ).forEach( ( el ) => {
		createRoot( el ).render( <TranscribePanel id={ Number( el.dataset.id ) } /> );
	} );
} );
