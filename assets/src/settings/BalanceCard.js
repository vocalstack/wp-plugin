/**
 * What the connected account has left: file and live minutes at its rates.
 */
import apiFetch from '@wordpress/api-fetch';
import { Button, Card, CardBody, CardHeader, Notice, Spinner } from '@wordpress/components';
import { useCallback, useEffect, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';

const BLOCKS = {
	no_credit: __( 'New transcriptions are refused until you add credit.', 'vocalstack' ),
	hourly_limit: __( 'This hour’s transcriptions are used up; new ones start again within the hour.', 'vocalstack' ),
	concurrency: __( 'Your plan’s transcriptions at once are all running.', 'vocalstack' ),
};

const number = ( n ) => n.toLocaleString();

function Stat( { label, minutes, help } ) {
	return (
		<div className="vocalstack-balance__stat">
			<div className="vocalstack-balance__label">{ label }</div>
			<div className="vocalstack-balance__value">
				{ minutes === null ? __( 'Unlimited', 'vocalstack' ) : number( minutes ) }
				{ minutes !== null && <span className="vocalstack-balance__unit">{ __( 'min', 'vocalstack' ) }</span> }
			</div>
			{ minutes !== null && minutes >= 120 && (
				<div className="vocalstack-balance__help">
					{ sprintf( /* translators: %s: hours */ __( 'about %s hours', 'vocalstack' ), number( Math.round( minutes / 6 ) / 10 ) ) }
				</div>
			) }
			{ help && <div className="vocalstack-balance__help">{ help }</div> }
		</div>
	);
}

export default function BalanceCard() {
	const [ data, setData ] = useState( null );
	const [ error, setError ] = useState( '' );
	const [ busy, setBusy ] = useState( false );

	const load = useCallback( async ( fresh = false ) => {
		setBusy( true );
		setError( '' );
		try {
			setData( await apiFetch( { path: `/vocalstack/v1/balance${ fresh ? '?fresh=1' : '' }` } ) );
		} catch ( e ) {
			setError( e.message );
		} finally {
			setBusy( false );
		}
	}, [] );

	useEffect( () => {
		load();
	}, [ load ] );

	const money = ( v ) => v.toLocaleString( undefined, { style: 'currency', currency: 'USD' } );

	return (
		<Card className="vocalstack-balance">
			<CardHeader>
				<h2>{ __( 'Remaining', 'vocalstack' ) }</h2>
				<Button variant="tertiary" size="small" onClick={ () => load( true ) } isBusy={ busy } disabled={ busy }>
					{ __( 'Refresh', 'vocalstack' ) }
				</Button>
			</CardHeader>
			<CardBody>
				{ error && <Notice status="error" isDismissible={ false }>{ error }</Notice> }
				{ ! data && ! error && <Spinner /> }
				{ data && (
					<>
						{ ! data.canStart && (
							<Notice status="warning" isDismissible={ false }>
								{ BLOCKS[ data.startBlock ] ?? __( 'New transcriptions are refused right now.', 'vocalstack' ) }
							</Notice>
						) }
						<div className="vocalstack-balance__stats">
							<Stat label={ __( 'File minutes', 'vocalstack' ) } minutes={ data.fileMinutes } help={ __( 'Media Library uploads and links', 'vocalstack' ) } />
							<Stat label={ __( 'Live minutes', 'vocalstack' ) } minutes={ data.liveMinutes } help={ __( 'Live transcription', 'vocalstack' ) } />
						</div>
						{ data.enabled && (
							<p className="description">
								{ sprintf(
									/* translators: 1: credit in dollars, 2: plan name */
									__( '%1$s of credit on the %2$s plan.', 'vocalstack' ),
									money( data.balance ),
									data.plan || __( 'current', 'vocalstack' )
								) }{ ' ' }
								{ data.fileMinutes === null && data.liveMinutes === null
									? __( 'Transcription is free on this plan.', 'vocalstack' )
									: __( 'File and live minutes come from the same credit: using one lowers the other.', 'vocalstack' ) }
								{ data.minimumMinutes > 0 &&
									' ' +
										sprintf(
											/* translators: %d: minutes */
											__( 'Each transcription is billed at least %d minutes.', 'vocalstack' ),
											data.minimumMinutes
										) }
							</p>
						) }
						{ data.enabled && (
							<Button variant={ data.canStart ? 'secondary' : 'primary' } href={ data.topUpUrl } target="_blank" rel="noreferrer">
								{ __( 'Add credit', 'vocalstack' ) }
							</Button>
						) }
					</>
				) }
			</CardBody>
		</Card>
	);
}
