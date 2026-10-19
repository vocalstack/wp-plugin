/**
 * Every broadcast on the account, like the dashboard's list.
 */
import { Button, Icon, Spinner, Tooltip } from '@wordpress/components';
import { useCallback, useEffect, useMemo, useState } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import { info as infoIcon, lock, people, plus } from '@wordpress/icons';
import { errorMessage, seg, vs } from '../lib/api';
import { broadcastRow, INFO } from '../lib/broadcast';
import { navigate } from '../lib/router';
import { Chevron, Chip, ErrorNotice, LangLabel, ListBar, ListSearch, PageHeader, PurgeModal, RowIcon, SelectBox, eachInTurn } from '../components/ui';
import NewBroadcast from './NewBroadcast';

function DateTile( { date, live, title } ) {
	return (
		<Tooltip text={ title }>
			<span className={ `vsa-caltile${ live ? ' is-live' : '' }` } aria-label={ title }>
				{ date ? (
					<>
						<span className="vsa-caltile__month">{ date.toLocaleDateString( undefined, { month: 'short' } ).toUpperCase() }</span>
						<span className="vsa-caltile__day">{ date.getDate() }</span>
					</>
				) : (
					<span className="vsa-caltile__day">–</span>
				) }
			</span>
		</Tooltip>
	);
}

function BroadcastRow( { row, selecting, selected, onSelect } ) {
	const open = () => ( selecting ? onSelect( ! selected ) : navigate( `/broadcasts/${ row.id }` ) );
	return (
		<li className={ `vsa-row${ selected ? ' is-selected' : '' }` }>
			<div className="vsa-row__main is-broadcast" role="button" tabIndex={ 0 } onClick={ open } onKeyDown={ ( e ) => ( e.key === 'Enter' || e.key === ' ' ) && ( e.preventDefault(), open() ) } aria-label={ row.name }>
				{ selecting && <SelectBox checked={ selected } onChange={ onSelect } label={ row.name } /> }
				<DateTile date={ row.tile } live={ Boolean( row.liveState ) } title={ row.tileTitle } />
				<div className="vsa-row__text">
					<div className="vsa-row__title">
						<span className="vsa-row__name">{ row.name }</span>
						{ row.liveState && <Chip tone={ row.liveState === 'live' ? 'live' : 'warning' }>{ row.liveState === 'live' ? __( 'LIVE', 'vocalstack' ) : __( 'PAUSED', 'vocalstack' ) }</Chip> }
						{ row.liveState && row.listeners !== null && (
							<Chip icon={ people }>
								{ /* translators: %d: number of listeners */ sprintf( _n( '%d listening', '%d listening', row.listeners, 'vocalstack' ), row.listeners ) }
							</Chip>
						) }
						{ row.private && <Chip icon={ lock }>{ __( 'Private', 'vocalstack' ) }</Chip> }
					</div>
					<div className="vsa-row__sub vsa-mono">{ row.url }</div>
				</div>
				<span className="vsa-row__lang">
					<LangLabel code={ row.lang } native />
				</span>
				<span className="vsa-row__chips">
					{ row.chip ? (
						<>
							<span className="vsa-pill">
								<RowIcon kind={ row.chip.icon } />
								<span className="vsa-pill__text">{ row.chip.label }</span>
							</span>
							{ row.more > 0 && <span className="vsa-pill is-count">{ `+ ${ row.more }` }</span> }
						</>
					) : (
						<span className="vsa-muted">{ __( 'No transcriptions yet', 'vocalstack' ) }</span>
					) }
				</span>
				<Chevron />
			</div>
		</li>
	);
}

export default function BroadcastsList() {
	const [ all, setAll ] = useState( null );
	const [ error, setError ] = useState( '' );
	const [ notice, setNotice ] = useState( '' );
	const [ view, setView ] = useState( 'active' );
	const [ search, setSearch ] = useState( '' );
	const [ selecting, setSelecting ] = useState( false );
	const [ selected, setSelected ] = useState( {} );
	const [ busy, setBusy ] = useState( false );
	const [ creating, setCreating ] = useState( false );
	const [ purging, setPurging ] = useState( false );

	const load = useCallback( async () => {
		try {
			const r = await vs( 'broadcasts', { query: { lifecycle: 'all' } } );
			setAll( r.broadcasts ?? [] );
		} catch ( e ) {
			setError( errorMessage( e ) );
			setAll( [] );
		}
	}, [] );

	useEffect( () => {
		load();
	}, [ load ] );

	const active = ( all ?? [] ).filter( ( b ) => b.lifecycle !== 'archived' );
	const archived = ( all ?? [] ).filter( ( b ) => b.lifecycle === 'archived' );

	const rows = useMemo( () => {
		const needle = search.trim().toLowerCase();
		return ( view === 'active' ? active : archived )
			.map( broadcastRow )
			.filter( ( r ) => ! needle || `${ r.name } ${ r.raw.code }`.toLowerCase().includes( needle ) )
			.sort( ( a, b ) => ( b.liveState ? 1 : 0 ) - ( a.liveState ? 1 : 0 ) || String( b.sortAt ).localeCompare( String( a.sortAt ) ) );
		// eslint-disable-next-line react-hooks/exhaustive-deps -- active/archived derive from all.
	}, [ all, view, search ] );

	const ids = Object.keys( selected ).filter( ( id ) => selected[ id ] );
	const liveSelected = rows.filter( ( r ) => selected[ r.id ] && r.liveState );

	const bulk = async ( action ) => {
		setBusy( true );
		setNotice( '' );
		const failed = await eachInTurn( ids, ( id ) => vs( `broadcasts/${ seg( id ) }/${ action }`, { method: 'POST' } ) );
		setBusy( false );
		setSelected( {} );
		setSelecting( false );
		if ( failed.length ) setNotice( failed.join( ' ' ) );
		load();
	};

	/* translators: 1: active count, 2: archived count */
	const counts = all ? sprintf( __( '%1$d active · %2$d archived', 'vocalstack' ), active.length, archived.length ) : '';

	return (
		<div className="vsa-screen">
			<PageHeader
				title={ view === 'active' ? __( 'Broadcasts', 'vocalstack' ) : __( 'Archived broadcasts', 'vocalstack' ) }
				subtitle={ counts }
				actions={
					<>
						<Button variant="secondary" onClick={ () => ( setView( view === 'active' ? 'archived' : 'active' ), setSelected( {} ) ) }>
							{ view === 'active' ? __( 'Archived', 'vocalstack' ) : __( 'Back to active', 'vocalstack' ) }
						</Button>
						{ view === 'active' && (
							<Button variant="primary" icon={ plus } onClick={ () => setCreating( true ) }>
								{ __( 'New broadcast', 'vocalstack' ) }
							</Button>
						) }
					</>
				}
			/>
			<ListSearch value={ search } onChange={ setSearch } label={ __( 'Search your broadcasts', 'vocalstack' ) } />
			<ErrorNotice error={ error || notice } onRemove={ notice ? () => setNotice( '' ) : undefined } />
			<ListBar
				label={ view === 'active' ? __( 'Your broadcasts', 'vocalstack' ) : __( 'Archived', 'vocalstack' ) }
				info={
					<Tooltip text={ INFO }>
						<span className="vsa-info" tabIndex={ 0 } aria-label={ INFO }>
							<Icon icon={ infoIcon } size={ 18 } />
						</span>
					</Tooltip>
				}
				selecting={ selecting }
				onToggleSelect={ () => ( setSelecting( ! selecting ), setSelected( {} ) ) }
			>
				{ selecting &&
					( view === 'active' ? (
						<Button
							variant="secondary"
							size="compact"
							disabled={ ! ids.length || busy || liveSelected.length > 0 }
							isBusy={ busy }
							title={ liveSelected.length ? __( 'A broadcast on air can’t be archived.', 'vocalstack' ) : undefined }
							onClick={ () => bulk( 'archive' ) }
						>
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
					) ) }
			</ListBar>
			{ all === null ? (
				<Spinner />
			) : (
				<ul className="vsa-list" aria-label={ __( 'Broadcasts', 'vocalstack' ) }>
					{ rows.length === 0 && (
						<li className="vsa-empty">
							{ search ? __( 'No broadcasts match.', 'vocalstack' ) : view === 'active' ? __( 'No broadcasts yet. A broadcast gives your live transcriptions one public page.', 'vocalstack' ) : __( 'Nothing archived.', 'vocalstack' ) }
						</li>
					) }
					{ rows.map( ( row ) => (
						<BroadcastRow key={ row.id } row={ row } selecting={ selecting } selected={ Boolean( selected[ row.id ] ) } onSelect={ ( on ) => setSelected( ( s ) => ( { ...s, [ row.id ]: on } ) ) } />
					) ) }
				</ul>
			) }
			{ creating && (
				<NewBroadcast
					onClose={ () => setCreating( false ) }
					onCreated={ ( b ) => {
						setCreating( false );
						navigate( `/broadcasts/${ b.id }` );
					} }
				/>
			) }
			{ purging && (
				<PurgeModal
					count={ ids.length }
					onClose={ () => setPurging( false ) }
					onConfirm={ async () => {
						const failed = await eachInTurn( ids, ( id ) => vs( `broadcasts/${ seg( id ) }/purge`, { method: 'POST' } ) );
						setSelected( {} );
						setSelecting( false );
						load();
						if ( failed.length ) throw new Error( failed.join( ' ' ) );
					} }
				/>
			) }
		</div>
	);
}
