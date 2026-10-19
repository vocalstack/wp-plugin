/**
 * The VocalStack page's home: what is going on, at a glance, and a way into
 * every tab. It has no tab of its own; the VocalStack logo comes back here.
 */
import apiFetch from '@wordpress/api-fetch';
import { Button, Card, CardBody, CardHeader, Notice, Spinner } from '@wordpress/components';
import { useEffect, useState } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import { languageInfo, SPEAKER_OPTIONS, useLanguages } from '../lib/account';
import { vs, wp } from '../lib/api';
import { broadcastRow } from '../lib/broadcast';
import { when } from '../lib/format';
import { navigate } from '../lib/router';
import { txRow } from '../lib/tx';
import { Chip, RowIcon } from '../components/ui';

const STATUS_TONE = { transcribing: 'info', cropping: 'info', queued: 'neutral', failed: 'error', stopped: 'warning', recording: 'live' };
const RECENT = 5;
/** One page, as the Transcriptions tab loads: enough to count ("100+") and to see what's running. */
const PAGE = 100;

/** A Media Library count: the X-WP-Total of one page of the list. */
const mediaTotal = ( status ) =>
	apiFetch( { path: `/vocalstack/v1/media?per_page=1&status=${ status }`, parse: false } ).then(
		( r ) => Number( r.headers.get( 'X-WP-Total' ) ?? 0 ),
		() => null
	);

/** Load one thing; a failure leaves it empty rather than failing the page. */
const settle = ( promise ) => promise.then( ( v ) => v, () => null );

export default function DashboardScreen( { connected } ) {
	const languages = useLanguages();
	const [ data, setData ] = useState( null );

	useEffect( () => {
		let live = true;
		Promise.all( [
			settle( wp( 'settings' ) ),
			connected ? settle( wp( 'balance' ) ) : null,
			connected ? settle( vs( 'transcriptions', { query: { limit: PAGE } } ) ) : null,
			connected ? settle( vs( 'broadcasts', { query: { lifecycle: 'active' } } ) ) : null,
			Promise.all( [ 'all', 'done', 'pending', 'none', 'failed' ].map( mediaTotal ) ),
			settle( wp( 'widget-policy' ) ),
		] ).then( ( [ settings, balance, transcriptions, broadcasts, media, policy ] ) => {
			if ( live ) {
				setData( { settings, balance, transcriptions, broadcasts: broadcasts?.broadcasts ?? null, media, policy } );
			}
		} );
		return () => {
			live = false;
		};
	}, [ connected ] );

	if ( ! data ) {
		return <Spinner />;
	}

	const connection = data.settings?.connection;
	const settings = data.settings?.settings ?? {};
	const all = ( data.transcriptions?.transcriptions ?? [] ).map( txRow );
	const rows = [ ...all ].sort( ( a, b ) => String( b.at ).localeCompare( String( a.at ) ) ).slice( 0, RECENT );
	const broadcasts = ( data.broadcasts ?? [] ).map( broadcastRow ).sort( ( a, b ) => ( b.liveState ? 1 : 0 ) - ( a.liveState ? 1 : 0 ) || String( b.sortAt ).localeCompare( String( a.sortAt ) ) );
	const onAir = broadcasts.filter( ( b ) => b.liveState );
	const running = all.filter( ( r ) => r.running ).length;
	const [ mediaAll, mediaDone, mediaPending, mediaNone, mediaFailed ] = data.media;
	const minutes = ( n ) => ( n === null || n === undefined ? __( 'Unlimited', 'vocalstack' ) : n.toLocaleString() );

	return (
		<div className="vsa-dash">
			<div className="vsa-dash__intro">
				<h2 className="vsa-header__title">{ __( 'Dashboard', 'vocalstack' ) }</h2>
				<div className="vsa-header__subtitle">
					{ connected
						? sprintf(
								/* translators: 1: account name, 2: plan */
								__( 'Connected to %1$s%2$s.', 'vocalstack' ),
								connection?.account || __( 'your VocalStack account', 'vocalstack' ),
								data.balance?.plan ? sprintf( /* translators: %s: plan name */ __( ' on the %s plan', 'vocalstack' ), data.balance.plan ) : ''
						  )
						: __( 'Transcribe, broadcast and translate your audio and video with VocalStack.', 'vocalstack' ) }
				</div>
			</div>

			{ ! connected && (
				<Notice status="warning" isDismissible={ false }>
					{ __( 'Connect a VocalStack account to transcribe, go live and see your transcriptions here.', 'vocalstack' ) }{ ' ' }
					<Button variant="primary" onClick={ () => navigate( '/settings/account' ) }>
						{ __( 'Connect an account', 'vocalstack' ) }
					</Button>
				</Notice>
			) }
			{ connected && data.balance && ! data.balance.canStart && (
				<Notice status="warning" isDismissible={ false }>
					{ __( 'New transcriptions are refused right now: your VocalStack account needs credit.', 'vocalstack' ) }{ ' ' }
					<Button variant="link" href={ data.balance.topUpUrl } target="_blank">
						{ __( 'Add credit', 'vocalstack' ) }
					</Button>
				</Notice>
			) }

			<div className="vsa-dash__stats">
				<Stat to="/settings/account" label={ __( 'File minutes left', 'vocalstack' ) } value={ connected && data.balance ? minutes( data.balance.fileMinutes ) : '—' } />
				<Stat to="/settings/account" label={ __( 'Live minutes left', 'vocalstack' ) } value={ connected && data.balance ? minutes( data.balance.liveMinutes ) : '—' } />
				<Stat
					to="/transcriptions"
					label={ __( 'Transcriptions', 'vocalstack' ) }
					value={ data.transcriptions ? `${ all.length }${ data.transcriptions.nextCursor ? '+' : '' }` : '—' }
					note={ running ? sprintf( /* translators: %d: count */ _n( '%d in progress', '%d in progress', running, 'vocalstack' ), running ) : '' }
				/>
				<Stat
					to="/broadcasts"
					label={ __( 'Broadcasts', 'vocalstack' ) }
					value={ data.broadcasts ? broadcasts.length.toLocaleString() : '—' }
					note={ onAir.length ? sprintf( /* translators: %d: count */ _n( '%d live now', '%d live now', onAir.length, 'vocalstack' ), onAir.length ) : '' }
					live={ onAir.length > 0 }
				/>
				<Stat
					to="/media"
					label={ __( 'Media Library', 'vocalstack' ) }
					value={ mediaAll === null ? '—' : sprintf( /* translators: 1: transcribed, 2: all */ __( '%1$s of %2$s', 'vocalstack' ), ( mediaDone ?? 0 ).toLocaleString(), mediaAll.toLocaleString() ) }
					note={ __( 'files transcribed', 'vocalstack' ) }
				/>
			</div>

			<div className="vsa-dash__grid">
				<Card className="vsa-dash__live">
					<CardHeader>
						<h3>{ __( 'Live', 'vocalstack' ) }</h3>
					</CardHeader>
					<CardBody>
						{ onAir.length > 0 ? (
							<ul className="vsa-dash__list">
								{ onAir.map( ( b ) => (
									<li key={ b.id }>
										<a href={ `#/broadcasts/${ b.id }` }>
											<Chip tone="live">{ b.liveState === 'paused' ? __( 'PAUSED', 'vocalstack' ) : __( 'LIVE', 'vocalstack' ) }</Chip>
											<strong>{ b.name }</strong>
											{ b.listeners !== null && <span className="vsa-muted">{ sprintf( /* translators: %d: listeners */ __( '%d listening', 'vocalstack' ), b.listeners ) }</span> }
										</a>
									</li>
								) ) }
							</ul>
						) : (
							<p className="vsa-muted">{ __( 'Nothing is live right now. Record from your microphone, a browser tab, a stream or OBS, and put it on a broadcast so listeners follow along in their language.', 'vocalstack' ) }</p>
						) }
						<Button variant="primary" onClick={ () => navigate( '/live' ) } disabled={ ! connected }>
							{ __( 'Go live', 'vocalstack' ) }
						</Button>
					</CardBody>
				</Card>

				<Card>
					<CardHeader>
						<h3>{ __( 'Recent transcriptions', 'vocalstack' ) }</h3>
						<a href="#/transcriptions">{ __( 'All transcriptions →', 'vocalstack' ) }</a>
					</CardHeader>
					<CardBody>
						{ rows.length ? (
							<ul className="vsa-dash__list">
								{ rows.map( ( r ) => (
									<li key={ r.id }>
										<a href={ `#/transcriptions/${ r.id }` }>
											<RowIcon kind={ r.icon } />
											<span className="vsa-dash__title">{ r.title }</span>
											{ r.status ? <Chip tone={ STATUS_TONE[ r.status.key ] ?? 'neutral' }>{ r.status.label }</Chip> : <span className="vsa-muted">{ r.len }</span> }
											<span className="vsa-muted vsa-dash__when">{ when( r.at ) }</span>
										</a>
									</li>
								) ) }
							</ul>
						) : (
							<p className="vsa-muted">{ connected ? __( 'No transcriptions yet.', 'vocalstack' ) : '—' }</p>
						) }
						<Button variant="secondary" onClick={ () => navigate( '/transcriptions/new' ) } disabled={ ! connected }>
							{ __( 'New transcription', 'vocalstack' ) }
						</Button>
					</CardBody>
				</Card>

				<Card>
					<CardHeader>
						<h3>{ __( 'Broadcasts', 'vocalstack' ) }</h3>
						<a href="#/broadcasts">{ __( 'All broadcasts →', 'vocalstack' ) }</a>
					</CardHeader>
					<CardBody>
						{ broadcasts.length ? (
							<ul className="vsa-dash__list">
								{ broadcasts.slice( 0, 4 ).map( ( b ) => (
									<li key={ b.id }>
										<a href={ `#/broadcasts/${ b.id }` }>
											<span className="vsa-dash__title">
												<strong>{ b.name }</strong>
												<span className="vsa-muted vsa-mono">{ b.url }</span>
											</span>
											{ b.liveState && <Chip tone="live">{ __( 'LIVE', 'vocalstack' ) }</Chip> }
										</a>
									</li>
								) ) }
							</ul>
						) : (
							<p className="vsa-muted">{ connected ? __( 'No broadcasts yet. A broadcast is one public link listeners open to follow you live.', 'vocalstack' ) : '—' }</p>
						) }
					</CardBody>
				</Card>

				<Card>
					<CardHeader>
						<h3>{ __( 'Media Library', 'vocalstack' ) }</h3>
						<a href="#/media">{ __( 'Open →', 'vocalstack' ) }</a>
					</CardHeader>
					<CardBody>
						<dl className="vsa-dash__facts">
							<Fact label={ __( 'Transcribed', 'vocalstack' ) } value={ mediaDone } />
							<Fact label={ __( 'In progress', 'vocalstack' ) } value={ mediaPending } />
							<Fact label={ __( 'Not transcribed', 'vocalstack' ) } value={ mediaNone } />
							<Fact label={ __( 'Failed', 'vocalstack' ) } value={ mediaFailed } warn={ mediaFailed > 0 } />
						</dl>
						<p className="vsa-muted">
							{ settings.auto && settings.auto !== 'off'
								? __( 'New uploads are transcribed automatically.', 'vocalstack' )
								: __( 'Files are transcribed when you click Transcribe.', 'vocalstack' ) }
						</p>
					</CardBody>
				</Card>

				<Card>
					<CardHeader>
						<h3>{ __( 'On your site', 'vocalstack' ) }</h3>
						<a href="#/widgets">{ __( 'Widgets →', 'vocalstack' ) }</a>
					</CardHeader>
					<CardBody>
						<p className="vsa-muted">{ __( 'Add players, record buttons and upload buttons to any page, as blocks or shortcodes.', 'vocalstack' ) }</p>
						<div className="vsa-dash__actions">
							<Button variant="secondary" onClick={ () => navigate( '/widgets' ) }>
								{ __( 'Make a widget', 'vocalstack' ) }
							</Button>
						</div>
						<dl className="vsa-dash__facts">
							<Fact
								label={ __( 'Listen in', 'vocalstack' ) }
								value={ ( settings.languages ?? [] ).length ? ( settings.languages ?? [] ).map( ( c ) => languageInfo( languages, c )?.native ?? c ).join( ', ' ) : __( 'Original only', 'vocalstack' ) }
							/>
							<Fact label={ __( 'Who can record', 'vocalstack' ) } value={ accessLabel( data.policy?.policy?.access, true ) } />
							<Fact label={ __( 'Who can upload', 'vocalstack' ) } value={ accessLabel( data.policy?.policy?.access ) } />
						</dl>
					</CardBody>
				</Card>

				<Card>
					<CardHeader>
						<h3>{ __( 'Settings', 'vocalstack' ) }</h3>
						<a href="#/settings/transcription">{ __( 'Change →', 'vocalstack' ) }</a>
					</CardHeader>
					<CardBody>
						<dl className="vsa-dash__facts">
							<Fact label={ __( 'Spoken language', 'vocalstack' ) } value={ settings.language ? languageInfo( languages, settings.language )?.name : __( 'Auto detect', 'vocalstack' ) } />
							<Fact label={ __( 'Speaker labels', 'vocalstack' ) } value={ SPEAKER_OPTIONS.find( ( o ) => o.value === settings.speakers )?.label ?? '—' } />
							<Fact label={ __( 'Captions on videos', 'vocalstack' ) } value={ settings.captions ? __( 'On', 'vocalstack' ) : __( 'Off', 'vocalstack' ) } />
							<Fact
								label={ __( 'Auto-transcribe uploads', 'vocalstack' ) }
								value={ { off: __( 'Off', 'vocalstack' ), audio: __( 'Audio', 'vocalstack' ), all: __( 'Audio and video', 'vocalstack' ) }[ settings.auto ] ?? '—' }
							/>
						</dl>
					</CardBody>
				</Card>
			</div>
		</div>
	);
}

function Stat( { to, label, value, note = '', live = false } ) {
	return (
		<a className={ `vsa-dash__stat${ live ? ' is-live' : '' }` } href={ `#${ to }` }>
			<span className="vsa-dash__stat-label">{ label }</span>
			<span className="vsa-dash__stat-value">{ value }</span>
			<span className="vsa-dash__stat-note">{ note || ' ' }</span>
		</a>
	);
}

function Fact( { label, value, warn = false } ) {
	return (
		<>
			<dt>{ label }</dt>
			<dd className={ warn ? 'is-warn' : '' }>{ value === null || value === undefined ? '—' : typeof value === 'number' ? value.toLocaleString() : value }</dd>
		</>
	);
}

/** Who may use the billable widgets; recording never goes below logged-in. */
function accessLabel( access, recording = false ) {
	const labels = {
		everyone: recording ? __( 'Logged-in users', 'vocalstack' ) : __( 'Everyone', 'vocalstack' ),
		logged_in: __( 'Logged-in users', 'vocalstack' ),
		roles: __( 'Chosen roles', 'vocalstack' ),
		nobody: __( 'Nobody', 'vocalstack' ),
	};
	return labels[ access ] ?? '—';
}
