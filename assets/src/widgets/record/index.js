/**
 * The record widget.
 *
 * WordPress opens the recording (/widgets/record/start) and hands back a
 * socket URL for that one recording; the audio goes from the browser straight
 * to VocalStack over it, and the transcript comes back on the same socket.
 * A stream source has no socket here: VocalStack pulls the stream and this
 * polls /widgets/record/status for the transcript.
 *
 * States (on the root's data-state): idle, permission, connecting, warming,
 * recording, reconnecting, stopping, done, error.
 */
import { __ } from '@wordpress/i18n';
import { api, boot, clock, part, sleep, status } from '../shared/dom';
import TranscriptView from '../shared/transcript';
import { canCaptureTab, capture, microphones, requestStream } from '../shared/capture';
import Publisher from '../shared/publisher';
import './record.scss';

const RETRIES = 7;
const DONE_WAIT_MS = 15000;

boot( 'record', ( root, config ) => {
	const toggle = part( root, 'toggle' );
	if ( ! toggle ) {
		return; // The visitor may not record: the template shows why.
	}
	new Recorder( root, config ).init();
} );

class Recorder {
	constructor( root, config ) {
		this.root = root;
		this.config = config;
		this.toggle = part( root, 'toggle' );
		this.label = part( root, 'toggle-label' );
		this.sourceEl = part( root, 'source' );
		this.deviceField = part( root, 'device-field' );
		this.deviceEl = part( root, 'device' );
		this.timer = part( root, 'timer' );
		this.meter = part( root, 'meter' );
		this.line = part( root, 'status' );
		this.view = new TranscriptView( part( root, 'transcript' ), { timestamps: false, speakers: true, live: true, announce: part( root, 'announce' ) } );
		this.state = 'idle';
		this.reset();
	}

	reset() {
		this.session = null;
		this.publisher = null;
		this.started = 0;
		this.maxSeconds = 0;
		this.stopping = false;
		this.capturer = null;
	}

	init() {
		this.toggle.addEventListener( 'click', () => ( [ 'idle', 'done', 'error' ].includes( this.state ) ? this.start() : this.stop() ) );
		// Tab audio works only in Chromium on desktop: say so instead of failing.
		if ( this.sourceEl?.tagName === 'SELECT' ) {
			[ ...this.sourceEl.options ].forEach( ( option ) => {
				if ( option.dataset.kind === 'tab' && ! canCaptureTab() ) {
					option.disabled = true;
					option.textContent += ` (${ __( 'Chrome or Edge on a computer', 'vocalstack' ) })`;
					if ( option.selected ) {
						this.sourceEl.selectedIndex = [ ...this.sourceEl.options ].findIndex( ( o ) => ! o.disabled );
					}
				}
			} );
			this.sourceEl.addEventListener( 'change', () => this.showDevices() );
		}
		this.deviceEl?.addEventListener( 'change', () => {
			try {
				window.localStorage.setItem( 'vocalstack-mic', this.deviceEl.value );
			} catch {}
		} );
		this.set( 'idle' );
	}

	get source() {
		return this.sourceEl?.value || 'mic';
	}

	get kind() {
		const el = this.sourceEl?.tagName === 'SELECT' ? this.sourceEl.selectedOptions[ 0 ] : this.sourceEl;
		return el?.dataset.kind || 'mic';
	}

	set( state, message ) {
		this.state = state;
		this.root.dataset.state = state;
		const busy = [ 'permission', 'connecting', 'stopping' ].includes( state );
		const running = [ 'warming', 'recording', 'reconnecting' ].includes( state );
		this.toggle.disabled = busy;
		this.toggle.setAttribute( 'aria-pressed', String( running ) );
		this.label.textContent = running || state === 'stopping' ? __( 'Stop', 'vocalstack' ) : this.label.dataset.startLabel;
		if ( this.sourceEl ) {
			this.sourceEl.disabled = running || busy;
		}
		if ( this.deviceEl ) {
			this.deviceEl.disabled = running || busy;
		}
		this.meter.hidden = ! running || this.kind === 'stream';
		this.timer.hidden = ! running && state !== 'stopping';
		if ( message !== undefined ) {
			status( this.line, message, state === 'error' );
		}
	}

	async showDevices() {
		if ( ! this.deviceField || this.kind !== 'mic' ) {
			if ( this.deviceField ) {
				this.deviceField.hidden = true;
			}
			return;
		}
		let list = [];
		try {
			list = await microphones();
		} catch {}
		if ( list.length < 2 ) {
			this.deviceField.hidden = true;
			return;
		}
		let saved = '';
		try {
			saved = window.localStorage.getItem( 'vocalstack-mic' ) || '';
		} catch {}
		this.deviceEl.replaceChildren(
			...list.map( ( d ) => {
				const option = document.createElement( 'option' );
				option.value = d.id;
				option.textContent = d.label;
				option.selected = d.id === saved;
				return option;
			} )
		);
		this.deviceField.hidden = false;
	}

	async start() {
		this.reset();
		this.view.set( [] );
		this.view.setDraft( '' );
		const kind = this.kind;
		let stream = null;

		if ( kind !== 'stream' ) {
			this.set( 'permission', kind === 'tab' ? __( 'Choose the tab to record, and tick “Share tab audio”.', 'vocalstack' ) : __( 'Allow the microphone when your browser asks.', 'vocalstack' ) );
			try {
				stream = await requestStream( kind, this.deviceEl && ! this.deviceField.hidden ? this.deviceEl.value : '' );
			} catch ( error ) {
				this.set( 'error', this.permissionMessage( error ) );
				return;
			}
			this.showDevices();
		}

		this.set( 'connecting', __( 'Connecting…', 'vocalstack' ) );
		let opened;
		try {
			opened = await api( this.config, 'widgets/record/start', { method: 'POST', body: { ticket: this.config.ticket, source: this.source } } );
		} catch ( error ) {
			stream?.getTracks().forEach( ( t ) => t.stop() );
			this.set( 'error', error.message );
			return;
		}
		this.session = opened.session;
		this.maxSeconds = opened.maxSeconds;
		this.started = performance.now();
		this.tick = setInterval( () => this.countdown(), 500 );

		if ( kind === 'stream' ) {
			this.set( 'recording', __( 'Connecting to the stream…', 'vocalstack' ) );
			this.pollStream();
			return;
		}

		this.publisher = this.publish();
		try {
			this.capturer = await capture( stream, {
				chunk: ( samples ) => this.publisher?.send( samples ),
				level: ( level ) => this.meter.style.setProperty( '--vocalstack-level', String( Math.min( 1, level * 1.6 ) ) ),
				ended: () => {
					if ( ! this.stopping ) {
						status( this.line, __( 'Sharing stopped.', 'vocalstack' ) );
						this.stop();
					}
				},
			} );
		} catch {
			stream.getTracks().forEach( ( t ) => t.stop() );
			this.set( 'error', __( 'This browser can’t record audio here.', 'vocalstack' ) );
			api( this.config, 'widgets/record/stop', { method: 'POST', body: { session: this.session } } ).catch( () => {} );
			return;
		}
		this.set( 'warming', __( 'Getting ready… you can start speaking.', 'vocalstack' ) );
		this.publisher.connect( opened.streamUrl );
	}

	permissionMessage( error ) {
		if ( error?.name === 'NoTabAudio' ) {
			return __( 'That share had no sound. Share a browser tab and tick “Share tab audio”.', 'vocalstack' );
		}
		if ( error?.name === 'NotAllowedError' || error?.name === 'SecurityError' ) {
			return this.kind === 'tab' ? __( 'Sharing was cancelled.', 'vocalstack' ) : __( 'Microphone access is blocked. Allow it from the address bar, then try again.', 'vocalstack' );
		}
		if ( error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError' ) {
			return __( 'No microphone was found.', 'vocalstack' );
		}
		if ( ! window.isSecureContext ) {
			return __( 'Recording needs a secure (https) page.', 'vocalstack' );
		}
		return __( 'The audio could not be started.', 'vocalstack' );
	}

	/** The socket to VocalStack, wired to this widget's states and transcript. */
	publish() {
		return new Publisher( {
			loading: () => {
				if ( this.state === 'warming' ) {
					status( this.line, __( 'Getting ready… you can start speaking.', 'vocalstack' ) );
				}
			},
			ready: () => {
				if ( ! this.stopping ) {
					this.set( 'recording', __( 'Recording. The transcript appears below as you speak.', 'vocalstack' ) );
				}
			},
			sentence: ( sentence ) => this.view.upsert( sentence ),
			draft: ( text ) => this.view.setDraft( text ),
			done: ( reason ) => {
				if ( reason === 'max_duration' && ! this.stopping ) {
					status( this.line, __( 'The time limit was reached.', 'vocalstack' ) );
					this.stop();
				}
			},
			error: ( frame ) => this.fail( frame.code === 'conflict' ? __( 'This recording was taken over on another device.', 'vocalstack' ) : frame.message || __( 'The recording failed.', 'vocalstack' ) ),
			dropped: () => {
				if ( ! this.stopping && [ 'warming', 'recording' ].includes( this.state ) ) {
					this.reconnect();
				}
			},
		} );
	}

	async reconnect() {
		this.set( 'reconnecting', __( 'Connection lost. Reconnecting…', 'vocalstack' ) );
		for ( let attempt = 0; attempt < RETRIES && this.state === 'reconnecting'; attempt++ ) {
			await sleep( Math.min( 15000, 1000 * 2 ** attempt ) );
			try {
				const grant = await api( this.config, 'widgets/record/reconnect', { method: 'POST', body: { session: this.session } } );
				if ( grant.streamUrl && this.state === 'reconnecting' ) {
					this.publisher.connect( grant.streamUrl );
					this.set( 'warming', __( 'Reconnected. Catching up…', 'vocalstack' ) );
					return;
				}
			} catch ( error ) {
				if ( error.status && error.status < 500 && error.status !== 409 ) {
					break;
				}
			}
		}
		if ( this.state === 'reconnecting' ) {
			this.fail( __( 'The connection was lost. What was recorded so far is kept.', 'vocalstack' ) );
		}
	}

	countdown() {
		const elapsed = ( performance.now() - this.started ) / 1000;
		this.timer.textContent = this.maxSeconds ? `${ clock( elapsed ) } / ${ clock( this.maxSeconds ) }` : clock( elapsed );
		if ( this.maxSeconds && elapsed >= this.maxSeconds + 2 && ! this.stopping ) {
			status( this.line, __( 'The time limit was reached.', 'vocalstack' ) );
			this.stop();
		}
	}

	async stop() {
		if ( this.stopping ) {
			return;
		}
		this.stopping = true;
		this.set( 'stopping', __( 'Finishing the transcript…', 'vocalstack' ) );
		this.capturer?.stop();
		this.capturer = null;

		await this.publisher?.finish( DONE_WAIT_MS );
		clearInterval( this.tick );

		try {
			await api( this.config, 'widgets/record/stop', { method: 'POST', body: { session: this.session } } );
		} catch {}
		await this.final();
		this.view.setDraft( '' );
		this.set(
			'done',
			this.view.size
				? __( 'Done. Here is the transcript.', 'vocalstack' )
				: __( 'Done. Nothing was heard.', 'vocalstack' )
		);
	}

	/** Read the finished transcript (it settles a few seconds after the end). */
	async final() {
		for ( let i = 0; i < 6; i++ ) {
			try {
				const data = await api( this.config, 'widgets/record/status', { params: { session: this.session } } );
				if ( data.sentences?.length ) {
					this.view.set( data.sentences );
				}
				if ( data.state === 'finalized' ) {
					return;
				}
			} catch {
				return;
			}
			await sleep( 2000 );
		}
	}

	async pollStream() {
		const labels = {
			connecting: __( 'Connecting to the stream…', 'vocalstack' ),
			streaming: __( 'Recording the stream. The transcript appears below.', 'vocalstack' ),
			reconnecting: __( 'The stream dropped. Reconnecting…', 'vocalstack' ),
			failed: __( 'The stream could not be reached.', 'vocalstack' ),
		};
		while ( this.state === 'recording' && ! this.stopping ) {
			try {
				const data = await api( this.config, 'widgets/record/status', { params: { session: this.session } } );
				this.view.set( data.sentences || [] );
				if ( [ 'ended', 'finalized' ].includes( data.state ) ) {
					clearInterval( this.tick );
					this.set( 'done', __( 'The recording has ended.', 'vocalstack' ) );
					return;
				}
				if ( data.ingest && labels[ data.ingest ] && ! this.stopping ) {
					status( this.line, labels[ data.ingest ], data.ingest === 'failed' );
				}
			} catch {}
			await sleep( 2000 );
		}
	}

	fail( message ) {
		this.stopping = true;
		this.capturer?.stop();
		this.capturer = null;
		this.publisher?.close();
		clearInterval( this.tick );
		if ( this.session ) {
			api( this.config, 'widgets/record/stop', { method: 'POST', body: { session: this.session } } ).catch( () => {} );
		}
		this.set( 'error', message );
	}
}
