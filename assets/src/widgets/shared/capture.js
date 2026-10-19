/**
 * Audio capture for the record widget: a microphone or a shared tab's sound,
 * as VocalStack's realtime socket wants it: mono float32 PCM at 16 kHz, in
 * 0.25 s chunks (4000 samples, 16000 bytes).
 */

export const RATE = 16000;
export const CHUNK = 4000;

// Runs on the audio thread: mixes to mono, resamples to 16 kHz when the
// context runs at another rate, and posts full chunks plus a level now and then.
const WORKLET = `
class VocalStackCapture extends AudioWorkletProcessor {
	constructor() {
		super();
		this.ratio = sampleRate / ${ RATE };
		this.out = new Float32Array( ${ CHUNK } );
		this.fill = 0;
		this.t = 0;
		this.prev = 0;
		this.peak = 0;
		this.blocks = 0;
		this.stopped = false;
		this.port.onmessage = ( e ) => { if ( e.data === 'stop' ) this.stopped = true; };
	}
	emit( sample ) {
		this.out[ this.fill++ ] = sample;
		if ( this.fill === ${ CHUNK } ) {
			this.port.postMessage( this.out.buffer, [ this.out.buffer ] );
			this.out = new Float32Array( ${ CHUNK } );
			this.fill = 0;
		}
	}
	process( inputs ) {
		if ( this.stopped ) return false;
		const channels = inputs[ 0 ];
		if ( ! channels || ! channels.length ) return true;
		const frames = channels[ 0 ].length;
		const mono = new Float32Array( frames );
		for ( const channel of channels ) {
			for ( let i = 0; i < frames; i++ ) mono[ i ] += channel[ i ] / channels.length;
		}
		for ( let i = 0; i < frames; i++ ) this.peak = Math.max( this.peak, Math.abs( mono[ i ] ) );
		if ( this.ratio === 1 ) {
			for ( let i = 0; i < frames; i++ ) this.emit( mono[ i ] );
		} else {
			// Linear interpolation; index -1 is the last sample of the previous block.
			while ( this.t + 1 < frames ) {
				const i = Math.floor( this.t );
				const f = this.t - i;
				const a = i < 0 ? this.prev : mono[ i ];
				this.emit( a + ( mono[ i + 1 ] - a ) * f );
				this.t += this.ratio;
			}
			this.t -= frames;
			this.prev = mono[ frames - 1 ];
		}
		if ( ++this.blocks % 8 === 0 ) {
			this.port.postMessage( { level: this.peak } );
			this.peak = 0;
		}
		return true;
	}
}
registerProcessor( 'vocalstack-capture', VocalStackCapture );
`;

/** Whether the browser can share a tab's audio (Chromium on desktop). */
export function canCaptureTab() {
	const brands = navigator.userAgentData?.brands || [];
	const chromium = brands.some( ( b ) => /Chromium|Google Chrome|Microsoft Edge/.test( b.brand ) );
	return chromium && ! navigator.userAgentData?.mobile && typeof navigator.mediaDevices?.getDisplayMedia === 'function';
}

/**
 * Ask for an audio stream.
 *
 * @param {string} kind     `mic` or `tab`.
 * @param {string} deviceId A microphone, or ''.
 * @return {Promise<MediaStream>} The stream, with only audio tracks.
 */
export async function requestStream( kind, deviceId = '' ) {
	if ( kind === 'tab' ) {
		const stream = await navigator.mediaDevices.getDisplayMedia( {
			video: true,
			audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
			systemAudio: 'include',
			selfBrowserSurface: 'exclude',
		} );
		if ( ! stream.getAudioTracks().length ) {
			stream.getTracks().forEach( ( t ) => t.stop() );
			throw Object.assign( new Error( 'no-tab-audio' ), { name: 'NoTabAudio' } );
		}
		// Only the sound is sent; the picture is not needed.
		stream.getVideoTracks().forEach( ( t ) => {
			t.stop();
			stream.removeTrack( t );
		} );
		return stream;
	}
	return navigator.mediaDevices.getUserMedia( {
		audio: {
			...( deviceId ? { deviceId: { exact: deviceId } } : {} ),
			channelCount: 1,
			echoCancellation: true,
			noiseSuppression: true,
			autoGainControl: true,
		},
	} );
}

/**
 * The microphones the browser lists (names appear once permission is given).
 *
 * @return {Promise<Array<{id: string, label: string}>>} Inputs.
 */
export async function microphones() {
	const devices = await navigator.mediaDevices.enumerateDevices();
	return devices.filter( ( d ) => d.kind === 'audioinput' && d.deviceId ).map( ( d, i ) => ( { id: d.deviceId, label: d.label || `Microphone ${ i + 1 }` } ) );
}

/**
 * Turn a stream into 16 kHz chunks.
 *
 * @param {MediaStream} stream  Audio stream.
 * @param {Object}      handler `chunk(Float32Array)`, `level(0..1)`, `ended()`.
 * @return {Promise<{stop: Function}>} Stops capture and releases the stream.
 */
export async function capture( stream, handler ) {
	let context;
	let source;
	try {
		// Ask for 16 kHz directly; the browser resamples well.
		context = new window.AudioContext( { sampleRate: RATE } );
		source = context.createMediaStreamSource( stream );
	} catch {
		// Some browsers can't connect a stream to a context at another rate: resample ourselves.
		context?.close();
		context = new window.AudioContext();
		source = context.createMediaStreamSource( stream );
	}
	const url = URL.createObjectURL( new Blob( [ WORKLET ], { type: 'application/javascript' } ) );
	try {
		await context.audioWorklet.addModule( url );
	} finally {
		URL.revokeObjectURL( url );
	}
	const node = new window.AudioWorkletNode( context, 'vocalstack-capture', { numberOfOutputs: 1, outputChannelCount: [ 1 ] } );
	node.port.onmessage = ( event ) => {
		if ( event.data instanceof ArrayBuffer ) {
			handler.chunk( new Float32Array( event.data ) );
		} else if ( event.data?.level !== undefined ) {
			handler.level?.( Math.min( 1, event.data.level ) );
		}
	};
	// Keep the graph pulling without making a sound.
	const mute = context.createGain();
	mute.gain.value = 0;
	source.connect( node ).connect( mute ).connect( context.destination );
	await context.resume();

	const ended = () => handler.ended?.();
	stream.getAudioTracks().forEach( ( t ) => t.addEventListener( 'ended', ended ) );

	return {
		stop() {
			node.port.postMessage( 'stop' );
			node.port.onmessage = null;
			stream.getTracks().forEach( ( t ) => {
				t.removeEventListener( 'ended', ended );
				t.stop();
			} );
			source.disconnect();
			node.disconnect();
			context.close();
		},
	};
}
