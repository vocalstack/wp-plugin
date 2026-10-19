/**
 * Every audio and video file in the Media Library with its transcript state:
 * transcribe or stop from the list, filter by state, search, page through.
 */
import apiFetch from '@wordpress/api-fetch';
import { Button, Card, CardBody, Notice, SearchControl, Spinner } from '@wordpress/components';
import { pause, play } from '@wordpress/icons';
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import { addQueryArgs } from '@wordpress/url';

const PENDING = [ 'queued', 'fetching', 'cropping', 'transcribing' ];
const PER_PAGE = 20;
const POLL_MS = 3000;

const FILTERS = [
	[ 'all', __( 'All', 'vocalstack' ) ],
	[ 'none', __( 'Not transcribed', 'vocalstack' ) ],
	[ 'pending', __( 'In progress', 'vocalstack' ) ],
	[ 'done', __( 'Transcribed', 'vocalstack' ) ],
	[ 'failed', __( 'Failed', 'vocalstack' ) ],
];

let languageNames;
try {
	languageNames = new Intl.DisplayNames( [ document.documentElement.lang || 'en' ], { type: 'language' } );
} catch {
	languageNames = null;
}

const languageName = ( code ) => {
	try {
		return languageNames?.of( code ) ?? code;
	} catch {
		return code;
	}
};

/** "English, Spanish (auto detect)": every detected language, most spoken first. */
function Languages( { row } ) {
	if ( ! row.languages?.length ) return '—';
	const names = row.languages.map( languageName ).join( ', ' );
	return row.autoLanguage ? `${ names } ${ __( '(auto detect)', 'vocalstack' ) }` : names;
}

function Status( { row } ) {
	if ( PENDING.includes( row.state ) ) {
		const pct = Math.round( row.progress?.pct ?? 0 );
		return (
			<span className="vocalstack-media__status is-pending">
				<progress max="100" value={ pct } /> { `${ pct }%` }
			</span>
		);
	}
	if ( row.state === 'done' ) {
		return (
			<span className="vocalstack-media__status is-done">
				{ sprintf( /* translators: %s: number of words */ _n( '%s word', '%s words', row.words, 'vocalstack' ), row.words.toLocaleString() ) }
			</span>
		);
	}
	if ( row.state === 'failed' ) {
		return (
			<span className="vocalstack-media__status is-failed" title={ row.error ?? '' }>
				{ __( 'Failed', 'vocalstack' ) }
			</span>
		);
	}
	return <span className="vocalstack-media__status">{ __( 'Not transcribed', 'vocalstack' ) }</span>;
}

export default function MediaTab() {
	const [ rows, setRows ] = useState( null );
	const [ total, setTotal ] = useState( 0 );
	const [ pages, setPages ] = useState( 1 );
	const [ page, setPage ] = useState( 1 );
	const [ status, setStatus ] = useState( 'all' );
	const [ search, setSearch ] = useState( '' );
	const [ error, setError ] = useState( '' );
	const [ busy, setBusy ] = useState( {} );
	const searchTimer = useRef();
	const [ query, setQuery ] = useState( '' );

	// One audio element for the whole table: playing a row stops the one before.
	const audio = useRef( null );
	const [ playing, setPlaying ] = useState( null );
	useEffect( () => {
		const el = new window.Audio();
		el.preload = 'none';
		const stopped = () => setPlaying( null );
		el.addEventListener( 'ended', stopped );
		el.addEventListener( 'pause', stopped );
		el.addEventListener( 'error', stopped );
		audio.current = el;
		return () => {
			el.pause();
			el.removeAttribute( 'src' );
		};
	}, [] );

	const toggle = async ( row ) => {
		const el = audio.current;
		if ( playing === row.id ) {
			el.pause();
			return;
		}
		el.pause();
		if ( el.dataset.id !== String( row.id ) ) {
			el.src = row.url;
			el.dataset.id = String( row.id );
		}
		try {
			await el.play();
			setPlaying( row.id );
		} catch ( e ) {
			setError( `${ row.title }: ${ e.message }` );
		}
	};

	const load = useCallback( async () => {
		try {
			const response = await apiFetch( {
				path: addQueryArgs( '/vocalstack/v1/media', { page, per_page: PER_PAGE, status, search: query } ),
				parse: false,
			} );
			setRows( await response.json() );
			setTotal( Number( response.headers.get( 'X-WP-Total' ) ?? 0 ) );
			setPages( Math.max( 1, Number( response.headers.get( 'X-WP-TotalPages' ) ?? 1 ) ) );
		} catch ( e ) {
			setError( e.message ?? __( 'Could not load the media.', 'vocalstack' ) );
		}
	}, [ page, status, query ] );

	useEffect( () => {
		load();
	}, [ load ] );

	// Follow running jobs: each check also moves the job on server side.
	const pendingIds = ( rows ?? [] ).filter( ( r ) => PENDING.includes( r.state ) ).map( ( r ) => r.id );
	const pendingKey = pendingIds.join( ',' );
	useEffect( () => {
		if ( ! pendingKey ) return;
		const timer = setInterval( async () => {
			const updates = await Promise.all(
				pendingKey.split( ',' ).map( ( id ) => apiFetch( { path: `/vocalstack/v1/media/${ id }` } ).catch( () => null ) )
			);
			setRows( ( current ) =>
				current?.map( ( r ) => {
					const u = updates.find( ( x ) => x?.id === r.id );
					if ( ! u ) return r;
					const words = u.transcript ? u.transcript.split( /\s+/ ).filter( Boolean ).length : r.words;
					// Languages and speakers arrive with the transcript: reload the row's list data then.
					return { ...r, state: u.state, progress: u.progress, error: u.error, words, ...( u.state === 'done' && r.state !== 'done' ? { stale: true } : {} ) };
				} )
			);
		}, POLL_MS );
		return () => clearInterval( timer );
	}, [ pendingKey ] );

	const anyStale = ( rows ?? [] ).some( ( r ) => r.stale );
	useEffect( () => {
		if ( anyStale ) load();
	}, [ anyStale, load ] );

	const act = async ( row, action ) => {
		if (
			action === 'transcribe' &&
			row.state === 'done' &&
			// eslint-disable-next-line no-alert
			! window.confirm( __( 'Transcribe again? This replaces the current transcript and is billed to your VocalStack account.', 'vocalstack' ) )
		) {
			return;
		}
		setBusy( ( b ) => ( { ...b, [ row.id ]: true } ) );
		setError( '' );
		try {
			const u = await apiFetch( { path: `/vocalstack/v1/media/${ row.id }/${ action }`, method: 'POST' } );
			setRows( ( current ) => current.map( ( r ) => ( r.id === row.id ? { ...r, state: u.state, progress: u.progress, error: u.error } : r ) ) );
		} catch ( e ) {
			setError( `${ row.title }: ${ e.message }` );
		} finally {
			setBusy( ( b ) => ( { ...b, [ row.id ]: false } ) );
		}
	};

	const onSearch = ( value ) => {
		setSearch( value );
		clearTimeout( searchTimer.current );
		searchTimer.current = setTimeout( () => {
			setPage( 1 );
			setQuery( value );
		}, 300 );
	};

	return (
		<Card className="vocalstack-media">
			<CardBody>
				<div className="vocalstack-media__toolbar">
					<ul className="subsubsub">
						{ FILTERS.map( ( [ value, label ], i ) => (
							<li key={ value }>
								<a
									href={ `#${ value }` }
									className={ status === value ? 'current' : '' }
									aria-current={ status === value ? 'page' : undefined }
									onClick={ ( e ) => {
										e.preventDefault();
										setPage( 1 );
										setStatus( value );
									} }
								>
									{ label }
								</a>
								{ i < FILTERS.length - 1 && ' |' }
							</li>
						) ) }
					</ul>
					<SearchControl value={ search } onChange={ onSearch } label={ __( 'Search media', 'vocalstack' ) } __nextHasNoMarginBottom />
				</div>

				{ error && <Notice status="error" onRemove={ () => setError( '' ) }>{ error }</Notice> }

				{ rows === null ? (
					<Spinner />
				) : (
					<table className="widefat striped vocalstack-media__table">
						<thead>
							<tr>
								<th className="vocalstack-media__play-head">
									<span className="screen-reader-text">{ __( 'Play', 'vocalstack' ) }</span>
								</th>
								<th>{ __( 'File', 'vocalstack' ) }</th>
								<th>{ __( 'Type', 'vocalstack' ) }</th>
								<th>{ __( 'Length', 'vocalstack' ) }</th>
								<th>{ __( 'Language', 'vocalstack' ) }</th>
								<th>{ __( 'Speakers', 'vocalstack' ) }</th>
								<th>{ __( 'Transcript', 'vocalstack' ) }</th>
								<th className="vocalstack-media__actions-head">
									<span className="screen-reader-text">{ __( 'Actions', 'vocalstack' ) }</span>
								</th>
							</tr>
						</thead>
						<tbody>
							{ rows.length === 0 && (
								<tr>
									<td colSpan="8">
										{ status === 'all' && ! query
											? __( 'No audio or video in the Media Library yet.', 'vocalstack' )
											: __( 'No files match.', 'vocalstack' ) }
									</td>
								</tr>
							) }
							{ rows.map( ( row ) => {
								const pending = PENDING.includes( row.state );
								return (
									<tr key={ row.id } className={ playing === row.id ? 'is-playing' : '' }>
										<td className="vocalstack-media__play">
											<Button
												icon={ playing === row.id ? pause : play }
												label={ playing === row.id ? __( 'Pause', 'vocalstack' ) : __( 'Play', 'vocalstack' ) }
												size="compact"
												disabled={ ! row.url }
												onClick={ () => toggle( row ) }
											/>
										</td>
										<td>
											<a href={ row.editUrl }>
												<strong>{ row.title }</strong>
											</a>
										</td>
										<td>{ row.kind === 'video' ? __( 'Video', 'vocalstack' ) : __( 'Audio', 'vocalstack' ) }</td>
										<td>{ row.length || '—' }</td>
										<td>
											<Languages row={ row } />
										</td>
										<td title={ row.speakers === null && row.state === 'done' ? __( 'Speakers were not identified for this transcript.', 'vocalstack' ) : undefined }>
											{ row.speakers ?? '—' }
										</td>
										<td>
											<Status row={ row } />
										</td>
										<td className="vocalstack-media__actions">
											{ pending ? (
												<Button variant="secondary" size="compact" isDestructive disabled={ busy[ row.id ] } onClick={ () => act( row, 'stop' ) }>
													{ __( 'Stop', 'vocalstack' ) }
												</Button>
											) : (
												<Button
													variant={ row.state === 'done' ? 'tertiary' : 'secondary' }
													size="compact"
													isBusy={ busy[ row.id ] }
													disabled={ busy[ row.id ] }
													onClick={ () => act( row, 'transcribe' ) }
												>
													{ row.state === 'done' ? __( 'Transcribe again', 'vocalstack' ) : __( 'Transcribe', 'vocalstack' ) }
												</Button>
											) }
											{ row.state === 'done' && (
												<Button variant="link" href={ `${ row.editUrl }#vocalstack` }>
													{ __( 'View', 'vocalstack' ) }
												</Button>
											) }
										</td>
									</tr>
								);
							} ) }
						</tbody>
					</table>
				) }

				<div className="vocalstack-media__footer">
					<span>{ sprintf( /* translators: %s: number of files */ _n( '%s file', '%s files', total, 'vocalstack' ), total.toLocaleString() ) }</span>
					{ pages > 1 && (
						<span className="vocalstack-media__pager">
							<Button variant="secondary" size="compact" disabled={ page <= 1 } onClick={ () => setPage( page - 1 ) }>
								{ __( 'Previous', 'vocalstack' ) }
							</Button>
							<span>{ sprintf( /* translators: 1: page, 2: pages */ __( 'Page %1$d of %2$d', 'vocalstack' ), page, pages ) }</span>
							<Button variant="secondary" size="compact" disabled={ page >= pages } onClick={ () => setPage( page + 1 ) }>
								{ __( 'Next', 'vocalstack' ) }
							</Button>
						</span>
					) }
				</div>
			</CardBody>
		</Card>
	);
}
