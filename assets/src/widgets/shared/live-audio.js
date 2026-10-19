/**
 * Live audio for a broadcast: the listener socket carries Ogg/Opus as binary
 * messages. This demuxes Ogg pages (whatever the message boundaries), decodes
 * the Opus packets with WebCodecs' AudioDecoder, and plays them through Web
 * Audio with a small jitter buffer.
 */

const CAPTURE = 0x4f676753; // "OggS"
const LEAD_S = 0.25; // how far ahead of "now" playback is scheduled.

/** Whether this browser can play live audio. */
export const supported = () => typeof window.AudioDecoder === 'function' && typeof window.AudioContext === 'function';

/**
 * Splits a byte stream into Ogg packets.
 */
class OggDemuxer {
	constructor( onPacket ) {
		this.onPacket = onPacket;
		this.buffer = new Uint8Array( 0 );
		this.partial = [];
	}

	push( bytes ) {
		const joined = new Uint8Array( this.buffer.length + bytes.length );
		joined.set( this.buffer );
		joined.set( bytes, this.buffer.length );
		this.buffer = joined;
		let offset = 0;
		while ( this.buffer.length - offset >= 27 ) {
			const view = new DataView( this.buffer.buffer, this.buffer.byteOffset + offset );
			if ( view.getUint32( 0 ) !== CAPTURE ) {
				// Lost sync: look for the next page.
				const next = this.find( offset + 1 );
				if ( next < 0 ) {
					offset = this.buffer.length - 3;
					break;
				}
				offset = next;
				continue;
			}
			const segments = this.buffer[ offset + 26 ];
			const headerLength = 27 + segments;
			if ( this.buffer.length - offset < headerLength ) {
				break;
			}
			const lacing = this.buffer.subarray( offset + 27, offset + headerLength );
			const bodyLength = lacing.reduce( ( a, b ) => a + b, 0 );
			if ( this.buffer.length - offset < headerLength + bodyLength ) {
				break;
			}
			let at = offset + headerLength;
			for ( let i = 0; i < segments; i++ ) {
				this.partial.push( this.buffer.subarray( at, at + lacing[ i ] ) );
				at += lacing[ i ];
				if ( lacing[ i ] < 255 ) {
					const size = this.partial.reduce( ( a, b ) => a + b.length, 0 );
					const packet = new Uint8Array( size );
					let p = 0;
					this.partial.forEach( ( piece ) => {
						packet.set( piece, p );
						p += piece.length;
					} );
					this.partial = [];
					this.onPacket( packet );
				}
			}
			offset += headerLength + bodyLength;
		}
		this.buffer = this.buffer.slice( Math.max( 0, offset ) );
	}

	find( from ) {
		for ( let i = from; i <= this.buffer.length - 4; i++ ) {
			if ( this.buffer[ i ] === 0x4f && this.buffer[ i + 1 ] === 0x67 && this.buffer[ i + 2 ] === 0x67 && this.buffer[ i + 3 ] === 0x53 ) {
				return i;
			}
		}
		return -1;
	}
}

/**
 * An Opus packet's length in microseconds, from its TOC byte (RFC 6716 §3.1).
 *
 * @param {Uint8Array} packet The packet.
 * @return {number} Microseconds.
 */
function packetDuration( packet ) {
	const config = packet[ 0 ] >> 3;
	let frameUs;
	if ( config < 12 ) {
		frameUs = [ 10000, 20000, 40000, 60000 ][ config % 4 ];
	} else if ( config < 16 ) {
		frameUs = [ 10000, 20000 ][ config % 2 ];
	} else {
		frameUs = [ 2500, 5000, 10000, 20000 ][ config % 4 ];
	}
	const code = packet[ 0 ] & 3;
	const frames = code === 0 ? 1 : code === 3 ? ( packet[ 1 ] || 0 ) & 0x3f : 2;
	return frameUs * Math.max( 1, frames );
}

export default class LiveAudio {
	constructor() {
		this.context = null;
		this.decoder = null;
		this.channels = 1;
		this.timestamp = 0;
		this.playAt = 0;
		this.headers = 0;
		this.demuxer = new OggDemuxer( ( packet ) => this.packet( packet ) );
	}

	/** Start playing (call from a click: browsers require a gesture for audio). */
	async start() {
		this.context = new window.AudioContext( { sampleRate: 48000, latencyHint: 'playback' } );
		await this.context.resume();
		this.configure( 1 );
	}

	configure( channels ) {
		this.decoder?.close?.();
		this.channels = channels;
		this.decoder = new window.AudioDecoder( {
			output: ( data ) => this.play( data ),
			error: () => this.configure( this.channels ),
		} );
		this.decoder.configure( { codec: 'opus', sampleRate: 48000, numberOfChannels: channels } );
	}

	/**
	 * Bytes from the socket.
	 *
	 * @param {ArrayBuffer} buffer A binary message.
	 */
	push( buffer ) {
		if ( this.decoder ) {
			this.demuxer.push( new Uint8Array( buffer ) );
		}
	}

	packet( packet ) {
		const head = String.fromCharCode( ...packet.subarray( 0, 8 ) );
		if ( head === 'OpusHead' ) {
			const channels = packet[ 9 ] || 1;
			if ( channels !== this.channels ) {
				this.configure( channels );
			}
			return;
		}
		if ( head === 'OpusTags' || ! packet.length || this.decoder.state !== 'configured' ) {
			return;
		}
		const duration = packetDuration( packet );
		this.decoder.decode( new window.EncodedAudioChunk( { type: 'key', timestamp: this.timestamp, duration, data: packet } ) );
		this.timestamp += duration;
	}

	play( data ) {
		const ctx = this.context;
		if ( ! ctx || ctx.state === 'closed' ) {
			data.close();
			return;
		}
		const buffer = ctx.createBuffer( data.numberOfChannels, data.numberOfFrames, data.sampleRate );
		for ( let c = 0; c < data.numberOfChannels; c++ ) {
			const plane = new Float32Array( data.numberOfFrames );
			data.copyTo( plane, { planeIndex: c, format: 'f32-planar' } );
			buffer.copyToChannel( plane, c );
		}
		data.close();
		const source = ctx.createBufferSource();
		source.buffer = buffer;
		source.connect( ctx.destination );
		// Fell behind (a gap in the stream): restart a little ahead of now.
		if ( this.playAt < ctx.currentTime + 0.02 ) {
			this.playAt = ctx.currentTime + LEAD_S;
		}
		source.start( this.playAt );
		this.playAt += buffer.duration;
	}

	stop() {
		try {
			this.decoder?.close();
		} catch {}
		this.decoder = null;
		this.context?.close();
		this.context = null;
		this.playAt = 0;
	}
}
