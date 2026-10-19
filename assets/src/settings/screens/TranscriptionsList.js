/**
 * Every transcription on the VocalStack account, like the dashboard's list.
 */
import { Button, Icon, Spinner, ToggleControl } from '@wordpress/components';
import { useCallback, useEffect, useMemo, useRef, useState } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import { media as mediaIcon, plus } from '@wordpress/icons';
import { useLinks, useMe } from '../lib/account';
import { errorMessage, seg, vs } from '../lib/api';
import { when } from '../lib/format';
import { navigate } from '../lib/router';
import { txRow } from '../lib/tx';
import { ApiBadge, Chevron, Chip, ErrorNotice, LangLabel, ListBar, ListSearch, PageHeader, PurgeModal, RowIcon, SelectBox, eachInTurn } from '../components/ui';
import NewTranscription from './NewTranscription';

const PAGE = 100;
const POLL_MS = 5000;

const STATUS_TONE = { transcribing: 'info', cropping: 'info', queued: 'neutral', failed: 'error', stopped: 'warning', recording: 'live' };

function TxRow( { row, link, selecting, selected, onSelect } ) {
	const open = () => ( selecting ? onSelect( ! selected ) : navigate( `/transcriptions/${ row.id }` ) );
	return (
		<li className={ `vsa-row${ selected ? ' is-selected' : '' }` }>
			{ /* The whole row opens the transcription; the inner link to the Media Library file stays separately focusable. */ }
			<div
				className="vsa-row__main"
				role="button"
				tabIndex={ 0 }
				onClick={ open }
				onKeyDown={ ( e ) => ( e.key === 'Enter' || e.key === ' ' ) && ( e.preventDefault(), open() ) }
				aria-label={ row.title }
			>
				{ selecting && <SelectBox checked={ selected } onChange={ onSelect } label={ row.title } /> }
				{ row.thumb ? <img className="vsa-row-thumb" src={ row.thumb } alt="" loading="lazy" /> : <RowIcon kind={ row.icon } /> }
				<div className="vsa-row__text">
					<div className="vsa-row__title">
						<span className="vsa-row__name">{ row.title }</span>
						{ row.api && <ApiBadge /> }
						{ row.broadcasts &&
							( row.broadcasts.length ? (
								<Chip>{ row.broadcasts.map( ( b ) => b.name ).join( ' · ' ) }</Chip>
							) : (
								<Chip>{ __( 'Not broadcast', 'vocalstack' ) }</Chip>
							) ) }
					</div>
					<div className="vsa-row__sub">
						<span>{ row.sourceLine }</span>
						{ link && (
							<a className="vsa-row__wp" href={ link.editUrl } onClick={ ( e ) => e.stopPropagation() }>
								<Icon icon={ mediaIcon } size={ 16 } />
								{ __( 'Media Library', 'vocalstack' ) }
							</a>
						) }
					</div>
				</div>
				<span className="vsa-row__len">{ row.len }</span>
				<span className="vsa-row__lang">
					<LangLabel code={ row.lang } />
				</span>
				<span className="vsa-row__when">{ when( row.at ) }</span>
				<span className="vsa-row__status">{ row.status && <Chip tone={ STATUS_TONE[ row.status.key ] ?? 'neutral' }>{ row.status.label }</Chip> }</span>
				<Chevron />
			</div>
			{ row.status?.pct !== undefined && (
				<div className="vsa-row__bar" aria-hidden="true">
					<span style={ { width: `${ row.status.pct }%` } } />
				</div>
			) }
		</li>
	);
}

/** One lifecycle's pages, loaded by cursor. */
function useTranscriptions( lifecycle ) {
	const [ items, setItems ] = useState( null );
	const [ cursor, setCursor ] = useState( null );
	const [ loading, setLoading ] = useState( false );
	const [ error, setError ] = useState( '' );

	const load = useCallback(
		async ( next = null ) => {
			setLoading( true );
			setError( '' );
			try {
				const r = await vs( 'transcriptions', { query: { lifecycle, limit: PAGE, cursor: next } } );
				setItems( ( prev ) => ( next ? [ ...( prev ?? [] ), ...( r.transcriptions ?? [] ) ] : r.transcriptions ?? [] ) );
				setCursor( r.nextCursor ?? null );
			} catch ( e ) {
				setError( errorMessage( e ) );
				setItems( ( prev ) => prev ?? [] );
			} finally {
				setLoading( false );
			}
		},
		[ lifecycle ]
	);

	useEffect( () => {
		setItems( null );
		load();
	}, [ load ] );

	return { items, setItems, more: Boolean( cursor ), loadMore: () => load( cursor ), reload: () => load(), loading, error };
}

export default function TranscriptionsList( { startNew = false } ) {
	const [ lifecycle, setLifecycle ] = useState( 'active' );
	const { items, setItems, more, loadMore, reload, loading, error } = useTranscriptions( lifecycle );
	const me = useMe();
	const links = useLinks();
	const [ search, setSearch ] = useState( '' );
	const [ mine, setMine ] = useState( false );
	const [ selecting, setSelecting ] = useState( false );
	const [ selected, setSelected ] = useState( {} );
	const [ busy, setBusy ] = useState( false );
	const [ notice, setNotice ] = useState( '' );
	const [ creating, setCreating ] = useState( startNew );
	const [ purging, setPurging ] = useState( false );

	const rows = useMemo( () => {
		const needle = search.trim().toLowerCase();
		return ( items ?? [] )
			.map( txRow )
			.filter( ( r ) => ! mine || ( me.apiKeyId && r.raw.createdByApiKeyId === me.apiKeyId ) || links[ r.id ] )
			.filter( ( r ) => ! needle || `${ r.title } ${ r.raw.name } ${ r.lang ?? '' } ${ r.sourceLine }`.toLowerCase().includes( needle ) )
			.sort( ( a, b ) => String( b.at ?? '' ).localeCompare( String( a.at ?? '' ) ) );
	}, [ items, search, mine, me, links ] );

	// Follow running jobs and live recordings.
	const runningKey = rows
		.filter( ( r ) => r.running )
		.map( ( r ) => r.id )
		.join( ',' );
	const itemsRef = useRef( items );
	itemsRef.current = items;
	useEffect( () => {
		if ( ! runningKey ) return;
		const timer = setInterval( async () => {
			const fresh = await Promise.all( runningKey.split( ',' ).map( ( id ) => vs( `transcriptions/${ seg( id ) }` ).catch( () => null ) ) );
			setItems( ( prev ) => prev?.map( ( t ) => fresh.find( ( f ) => f?.id === t.id ) ?? t ) );
		}, POLL_MS );
		return () => clearInterval( timer );
	}, [ runningKey, setItems ] );

	const ids = Object.keys( selected ).filter( ( id ) => selected[ id ] );
	const toggleSelect = () => {
		setSelecting( ! selecting );
		setSelected( {} );
	};

	const bulk = async ( action ) => {
		setBusy( true );
		setNotice( '' );
		const failed = await eachInTurn( ids, ( id ) => vs( `transcriptions/${ seg( id ) }/${ action }`, { method: 'POST' } ) );
		setBusy( false );
		setSelected( {} );
		setSelecting( false );
		if ( failed.length ) setNotice( failed.join( ' ' ) );
		reload();
	};

	/* translators: %s: number, possibly with "+" */
	const count = items ? sprintf( _n( '%s transcription', '%s transcriptions', items.length, 'vocalstack' ), `${ items.length }${ more ? '+' : '' }` ) : '';

	return (
		<div className="vsa-screen">
			<PageHeader
				title={ lifecycle === 'active' ? __( 'Transcriptions', 'vocalstack' ) : __( 'Archived transcriptions', 'vocalstack' ) }
				subtitle={ count }
				actions={
					<>
						<Button variant="secondary" onClick={ () => setLifecycle( lifecycle === 'active' ? 'archived' : 'active' ) }>
							{ lifecycle === 'active' ? __( 'Archived', 'vocalstack' ) : __( 'Back to active', 'vocalstack' ) }
						</Button>
						{ lifecycle === 'active' && (
							<Button variant="primary" icon={ plus } onClick={ () => setCreating( true ) }>
								{ __( 'New transcription', 'vocalstack' ) }
							</Button>
						) }
					</>
				}
			/>

			<ListSearch value={ search } onChange={ setSearch } label={ __( 'Search transcriptions', 'vocalstack' ) } />
			<ErrorNotice error={ error || notice } onRemove={ notice ? () => setNotice( '' ) : undefined } />

			<ListBar label={ count } selecting={ selecting } onToggleSelect={ toggleSelect }>
				<ToggleControl label={ __( 'From this site', 'vocalstack' ) } checked={ mine } onChange={ setMine } __nextHasNoMarginBottom />
				{ selecting && (
					<>
						<Button
							variant="tertiary"
							size="compact"
							onClick={ () => setSelected( Object.fromEntries( rows.map( ( r ) => [ r.id, true ] ) ) ) }
						>
							{ __( 'Select all', 'vocalstack' ) }
						</Button>
						{ lifecycle === 'active' ? (
							<Button variant="secondary" size="compact" disabled={ ! ids.length || busy } isBusy={ busy } onClick={ () => bulk( 'archive' ) }>
								{ /* translators: %d: number selected */ sprintf( __( 'Archive %d', 'vocalstack' ), ids.length ) }
							</Button>
						) : (
							<>
								<Button variant="secondary" size="compact" disabled={ ! ids.length || busy } isBusy={ busy } onClick={ () => bulk( 'restore' ) }>
									{ /* translators: %d: number selected */ sprintf( __( 'Restore %d', 'vocalstack' ), ids.length ) }
								</Button>
								<Button variant="secondary" size="compact" isDestructive disabled={ ! ids.length || busy } onClick={ () => setPurging( true ) }>
									{ /* translators: %d: number selected */ sprintf( __( 'Delete %d', 'vocalstack' ), ids.length ) }
								</Button>
							</>
						) }
					</>
				) }
			</ListBar>

			{ items === null ? (
				<Spinner />
			) : (
				<ul className="vsa-list" aria-label={ __( 'Transcriptions', 'vocalstack' ) }>
					{ rows.length === 0 && (
						<li className="vsa-empty">
							{ search || mine
								? __( 'No transcriptions match.', 'vocalstack' )
								: lifecycle === 'active'
								? __( 'No transcriptions yet. Transcribe a file, a link or a live stream with New transcription.', 'vocalstack' )
								: __( 'Nothing archived.', 'vocalstack' ) }
						</li>
					) }
					{ rows.map( ( row ) => (
						<TxRow
							key={ row.id }
							row={ row }
							link={ links[ row.id ] }
							selecting={ selecting }
							selected={ Boolean( selected[ row.id ] ) }
							onSelect={ ( on ) => setSelected( ( s ) => ( { ...s, [ row.id ]: on } ) ) }
						/>
					) ) }
				</ul>
			) }

			{ more && (
				<div className="vsa-more">
					<Button variant="secondary" onClick={ loadMore } isBusy={ loading } disabled={ loading }>
						{ __( 'Load more', 'vocalstack' ) }
					</Button>
					{ search && <span className="vsa-muted">{ __( 'Search covers the transcriptions loaded so far.', 'vocalstack' ) }</span> }
				</div>
			) }

			{ creating && (
				<NewTranscription
					onClose={ () => setCreating( false ) }
					onCreated={ ( id ) => {
						setCreating( false );
						reload();
						if ( id ) navigate( `/transcriptions/${ id }` );
					} }
				/>
			) }
			{ purging && (
				<PurgeModal
					count={ ids.length }
					onClose={ () => setPurging( false ) }
					onConfirm={ async () => {
						const failed = await eachInTurn( ids, ( id ) => vs( `transcriptions/${ seg( id ) }/purge`, { method: 'POST' } ) );
						setSelected( {} );
						setSelecting( false );
						reload();
						if ( failed.length ) throw new Error( failed.join( ' ' ) );
					} }
				/>
			) }
		</div>
	);
}
