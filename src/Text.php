<?php
/**
 * Transcript text: paragraphs, timestamps, WebVTT.
 *
 * @package VocalStack
 */

namespace VocalStack\WP;

defined( 'ABSPATH' ) || exit;

/**
 * A paragraph breaks on a speaker change or a pause longer than 2.5 seconds.
 */
final class Text {

	const PAUSE = 2.5;

	/**
	 * Sentences grouped into paragraphs.
	 *
	 * @param list<array{start: float, end: float, speaker: int, text: string}> $sentences Timed sentences.
	 * @return list<list<array{start: float, end: float, speaker: int, text: string}>>
	 */
	public static function paragraphs( array $sentences ): array {
		$out  = array();
		$prev = null;
		foreach ( $sentences as $s ) {
			if ( null === $prev || $s['speaker'] !== $prev['speaker'] || $s['start'] - $prev['end'] > self::PAUSE ) {
				$out[] = array();
			}
			$out[ count( $out ) - 1 ][] = $s;
			$prev                       = $s;
		}
		return $out;
	}

	/**
	 * The plain text: sentences joined, a blank line between paragraphs.
	 *
	 * @param list<array{start: float, end: float, speaker: int, text: string}> $sentences Timed sentences.
	 */
	public static function plain( array $sentences ): string {
		return implode(
			"\n\n",
			array_map( fn( $p ) => implode( ' ', array_column( $p, 'text' ) ), self::paragraphs( $sentences ) )
		);
	}

	/**
	 * A time as `m:ss`, or `h:mm:ss` past an hour.
	 *
	 * @param float $seconds Seconds.
	 */
	public static function clock( float $seconds ): string {
		$s = (int) floor( $seconds );
		return $s >= 3600
			? sprintf( '%d:%02d:%02d', intdiv( $s, 3600 ), intdiv( $s % 3600, 60 ), $s % 60 )
			: sprintf( '%d:%02d', intdiv( $s, 60 ), $s % 60 );
	}

	/**
	 * The sentences as a WebVTT captions file, one cue per sentence.
	 *
	 * @param list<array{start: float, end: float, speaker: int, text: string}> $sentences Timed sentences.
	 */
	public static function vtt( array $sentences ): string {
		$stamp = static function ( float $t ): string {
			$ms = (int) round( $t * 1000 );
			return sprintf( '%02d:%02d:%02d.%03d', intdiv( $ms, 3600000 ), intdiv( $ms % 3600000, 60000 ), intdiv( $ms % 60000, 1000 ), $ms % 1000 );
		};
		$out   = "WEBVTT\n";
		foreach ( $sentences as $i => $s ) {
			// A cue's text cannot hold a blank line or "-->".
			$text = str_replace( array( "\r", "\n\n", '-->' ), array( '', "\n", '→' ), $s['text'] );
			$out .= sprintf( "\n%d\n%s --> %s\n%s\n", $i + 1, $stamp( $s['start'] ), $stamp( max( $s['end'], $s['start'] + 0.5 ) ), $text );
		}
		return $out;
	}
}
