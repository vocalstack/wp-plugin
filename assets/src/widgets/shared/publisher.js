/**
 * Publishing audio into one VocalStack recording over its socket.
 *
 * The socket URL comes from WordPress (a widget's record/start, or the admin's
 * recordings call) and works for that recording only. Protocol:
 * - the server sends `session.loading` frames while an engine warms up, then
 *   `session.ready`; audio sent before that is refused, so chunks are held;
 * - audio goes as binary frames of 16 kHz mono float32 PCM, with a `clock`
 *   frame (cumulative samples, wall seconds) about every half second;
 * - transcript frames come back on the same socket: `transcript.sentence`
 *   (upsert by sentenceId), `transcript.draft` (the line being heard);
 * - `{"type":"eof"}` ends the recording; `session.done` confirms it.
 *
 * Used by the record widget and by the admin's live transcription.
 */

export const BUFFER_LIMIT = 400; // chunks held while the socket isn't ready: 100 s.

export default class Publisher {
	/**
	 * @param {Object}   handlers
	 * @param {Function} [handlers.loading]  The engine is warming up.
	 * @param {Function} [handlers.ready]    Audio is being accepted.
	 * @param {Function} [handlers.sentence] A sentence was added or changed: (sentence).
	 * @param {Function} [handlers.draft]    The line being heard: (text).
	 * @param {Function} [handlers.done]     The recording ended: (reason).
	 * @param {Function} [handlers.error]    A fatal error frame: ({ code, message }).
	 * @param {Function} [handlers.dropped]  The socket closed unexpectedly.
	 */
	constructor( handlers = {} ) {
		this.on = handlers;
		this.socket = null;
		this.ready = false;
		this.buffer = [];
		this.samples = 0;
		this.started = performance.now();
		this.lastClock = 0;
		this.finishing = false;
		this.finished = null;
	}

	/**
	 * Open (or reopen, after a drop) the recording's socket.
	 *
	 * @param {string} url The socket URL.
	 */
	connect( url ) {
		this.ready = false;
		const socket = new window.WebSocket( url );
		socket.binaryType = 'arraybuffer';
		this.socket = socket;
		socket.addEventListener( 'message', ( event ) => {
			if ( typeof event.data === 'string' ) {
				try {
					this.frame( JSON.parse( event.data ) );
				} catch {}
			}
		} );
		socket.addEventListener( 'close', () => {
			if ( this.socket === socket && ! this.finishing ) {
				this.on.dropped?.();
			}
			this.finished?.();
		} );
	}

	frame( frame ) {
		switch ( frame.type ) {
			case 'session.loading':
				this.on.loading?.();
				break;
			case 'session.ready':
				this.ready = true;
				this.flush();
				this.on.ready?.();
				break;
			case 'transcript.sentence':
				this.on.sentence?.( frame.sentence );
				break;
			case 'transcript.draft':
				this.on.draft?.( ( frame.segments || [] ).map( ( s ) => s.text ).join( ' ' ) );
				break;
			case 'session.done':
				this.on.draft?.( '' );
				this.on.done?.( frame.reason );
				this.finished?.();
				break;
			case 'error':
				if ( ! frame.retryable ) {
					this.on.error?.( frame );
				}
				break;
		}
	}

	/**
	 * A chunk of audio: send it, or hold it until the socket is ready.
	 *
	 * @param {Float32Array} samples 16 kHz mono samples.
	 */
	send( samples ) {
		this.samples += samples.length;
		this.buffer.push( samples );
		if ( this.buffer.length > BUFFER_LIMIT ) {
			this.buffer.shift();
		}
		this.flush();
	}

	flush() {
		const socket = this.socket;
		if ( ! this.ready || socket?.readyState !== window.WebSocket.OPEN ) {
			return;
		}
		while ( this.buffer.length ) {
			socket.send( this.buffer.shift().buffer );
		}
		const now = performance.now();
		if ( now - this.lastClock >= 500 ) {
			this.lastClock = now;
			socket.send( JSON.stringify( { type: 'clock', pcm: this.samples, wall: ( now - this.started ) / 1000 } ) );
		}
	}

	/**
	 * End the recording: send what is held, then eof, and wait (up to
	 * `timeout`) for the server to confirm before closing.
	 *
	 * @param {number} timeout Milliseconds to wait for `session.done`.
	 */
	async finish( timeout = 15000 ) {
		this.finishing = true;
		const socket = this.socket;
		if ( socket && socket.readyState === window.WebSocket.OPEN ) {
			this.flush();
			const finished = new Promise( ( resolve ) => {
				this.finished = resolve;
			} );
			socket.send( JSON.stringify( { type: 'eof' } ) );
			await Promise.race( [ finished, new Promise( ( resolve ) => setTimeout( resolve, timeout ) ) ] );
			socket.close();
		}
		this.socket = null;
	}

	/** Drop the socket without ending the recording on the server. */
	close() {
		this.finishing = true;
		this.socket?.close();
		this.socket = null;
	}
}
