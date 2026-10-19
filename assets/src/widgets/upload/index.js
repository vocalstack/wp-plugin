/**
 * The upload widget: a file goes to /widgets/upload (into the Media Library,
 * then to VocalStack), and /widgets/upload/status is polled until the
 * transcript is ready.
 */
import { __, sprintf } from '@wordpress/i18n';
import { api, boot, part, sleep, status } from '../shared/dom';
import TranscriptView from '../shared/transcript';
import './upload.scss';

const POLL_MS = 3000;
const PHASES = {
	queued: __( 'Waiting in line…', 'vocalstack' ),
	fetching: __( 'Preparing the file…', 'vocalstack' ),
	cropping: __( 'Preparing the file…', 'vocalstack' ),
	transcribing: __( 'Transcribing…', 'vocalstack' ),
};

boot( 'upload', ( root, config ) => {
	const drop = part( root, 'drop' );
	const input = part( root, 'input' );
	if ( ! drop || ! input ) {
		return; // The visitor may not upload: the template shows why.
	}
	const line = part( root, 'status' );
	const progress = part( root, 'progress' );
	const bar = part( root, 'progress-bar' );
	const barLabel = part( root, 'progress-label' );
	const result = part( root, 'result' );
	const mediaSlot = part( root, 'media' );
	const transcriptEl = part( root, 'transcript' );
	const view = transcriptEl ? new TranscriptView( transcriptEl, { timestamps: true, speakers: true } ) : null;
	let busy = false;

	const setProgress = ( pct, label ) => {
		progress.hidden = false;
		if ( pct === null ) {
			bar.removeAttribute( 'value' );
		} else {
			bar.value = pct;
		}
		barLabel.textContent = label;
	};

	const accepts = ( file ) => {
		const kinds = ( config.accept || 'audio/*,video/*' ).split( ',' ).map( ( a ) => a.trim().replace( '/*', '' ) );
		const kind = ( file.type || '' ).split( '/' )[ 0 ];
		// Some files have no type in the browser: let the server decide.
		return ! file.type || kinds.includes( kind );
	};

	const upload = ( file ) => {
		if ( busy ) {
			return;
		}
		if ( ! accepts( file ) ) {
			status( line, __( 'Choose an audio or video file.', 'vocalstack' ), true );
			return;
		}
		if ( config.maxBytes && file.size > config.maxBytes ) {
			/* translators: %s: size in megabytes */
			status( line, sprintf( __( 'This file is too large. The limit is %s MB.', 'vocalstack' ), Math.floor( config.maxBytes / 1048576 ) ), true );
			return;
		}
		busy = true;
		drop.classList.add( 'is-busy' );
		result.hidden = true;
		view?.set( [] );
		status( line, '' );
		/* translators: %s: file name */
		setProgress( 0, sprintf( __( 'Uploading %s…', 'vocalstack' ), file.name ) );

		const form = new FormData();
		form.append( 'ticket', config.ticket );
		form.append( 'file', file, file.name );
		const xhr = new window.XMLHttpRequest();
		xhr.open( 'POST', config.rest + 'widgets/upload' );
		xhr.setRequestHeader( 'X-WP-Nonce', config.nonce );
		xhr.responseType = 'json';
		xhr.upload.addEventListener( 'progress', ( event ) => {
			if ( event.lengthComputable ) {
				const pct = Math.round( ( event.loaded / event.total ) * 100 );
				/* translators: %d: percent */
				setProgress( pct, sprintf( __( 'Uploading… %d%%', 'vocalstack' ), pct ) );
			}
		} );
		xhr.addEventListener( 'load', () => {
			const data = xhr.response || {};
			if ( xhr.status >= 200 && xhr.status < 300 && data.session ) {
				follow( data.session, file );
			} else {
				finish( data.message || __( 'The upload failed. Try again.', 'vocalstack' ), true );
			}
		} );
		xhr.addEventListener( 'error', () => finish( __( 'The upload failed. Check your connection and try again.', 'vocalstack' ), true ) );
		xhr.send( form );
	};

	const finish = ( message, error = false ) => {
		busy = false;
		drop.classList.remove( 'is-busy' );
		progress.hidden = true;
		input.value = '';
		status( line, message, error );
	};

	const follow = async ( session, file ) => {
		setProgress( null, __( 'Uploaded. Transcribing…', 'vocalstack' ) );
		for ( ;; ) {
			let data;
			try {
				data = await api( config, 'widgets/upload/status', { params: { session } } );
			} catch ( error ) {
				finish( error.message, true );
				return;
			}
			if ( data.state === 'done' ) {
				show( data, file );
				finish( __( 'Done. Here is the transcript.', 'vocalstack' ) );
				return;
			}
			if ( data.state === 'failed' ) {
				finish( data.error || __( 'The transcription failed.', 'vocalstack' ), true );
				return;
			}
			const pct = Math.round( data.progress?.pct || 0 );
			setProgress( pct || null, pct ? `${ PHASES[ data.state ] || PHASES.transcribing } ${ pct }%` : PHASES[ data.state ] || PHASES.queued );
			await sleep( POLL_MS );
		}
	};

	const show = ( data, file ) => {
		const tag = ( file.type || '' ).startsWith( 'video/' ) ? 'video' : 'audio';
		const media = document.createElement( tag );
		media.controls = true;
		media.preload = 'metadata';
		media.src = data.url;
		mediaSlot.replaceChildren( media );
		result.hidden = false;
		if ( view ) {
			view.set( data.sentences || [] );
			view.link( media );
		}
	};

	input.addEventListener( 'change', () => input.files[ 0 ] && upload( input.files[ 0 ] ) );
	[ 'dragenter', 'dragover' ].forEach( ( type ) =>
		drop.addEventListener( type, ( event ) => {
			event.preventDefault();
			drop.classList.add( 'is-dragging' );
		} )
	);
	[ 'dragleave', 'drop' ].forEach( ( type ) =>
		drop.addEventListener( type, ( event ) => {
			event.preventDefault();
			drop.classList.remove( 'is-dragging' );
		} )
	);
	drop.addEventListener( 'drop', ( event ) => {
		const file = event.dataTransfer?.files?.[ 0 ];
		if ( file ) {
			upload( file );
		}
	} );
} );
