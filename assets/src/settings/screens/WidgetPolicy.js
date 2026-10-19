/**
 * Settings → Widgets: the ceilings every record and upload widget stays under.
 */
import { Button, Card, CardBody, CardHeader, CheckboxControl, Notice, SelectControl, Spinner, TextControl } from '@wordpress/components';
import { useEffect, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { errorMessage, wp } from '../lib/api';
import { bytes } from '../lib/format';
import { ErrorNotice } from '../components/ui';

const NUMBERS = [
	[ 'maxRecordMinutes', __( 'Longest recording (minutes)', 'vocalstack' ), __( 'A recording stops by itself at this length. VocalStack bills live audio per minute.', 'vocalstack' ) ],
	[ 'userDailyMinutes', __( 'Recording minutes per person per day', 'vocalstack' ), __( 'Counted per logged-in user. A recording reserves its full length when it starts and gets back what it didn’t use when it stops.', 'vocalstack' ) ],
	[ 'siteDailyMinutes', __( 'Recording minutes per day, whole site', 'vocalstack' ), __( 'Caps what all record widgets together can spend in a day.', 'vocalstack' ) ],
	[ 'maxUploadMb', __( 'Largest upload (MB)', 'vocalstack' ), null ],
	[ 'userDailyUploads', __( 'Uploads per person per day', 'vocalstack' ), __( 'Counted per logged-in user, or per IP address for visitors.', 'vocalstack' ) ],
];

export default function WidgetPolicy() {
	const [ data, setData ] = useState( null );
	const [ policy, setPolicy ] = useState( null );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState( '' );
	const [ saved, setSaved ] = useState( false );

	useEffect( () => {
		wp( 'widget-policy' ).then(
			( r ) => {
				setData( r );
				setPolicy( r.policy );
			},
			( e ) => setError( errorMessage( e ) )
		);
	}, [] );

	if ( error && ! policy ) return <ErrorNotice error={ error } />;
	if ( ! policy ) return <Spinner />;

	const set = ( key, value ) => setPolicy( ( p ) => ( { ...p, [ key ]: value } ) );
	const save = async () => {
		setBusy( true );
		setError( '' );
		setSaved( false );
		try {
			const r = await wp( 'widget-policy', { method: 'POST', data: policy } );
			setData( r );
			setPolicy( r.policy );
			setSaved( true );
		} catch ( e ) {
			setError( errorMessage( e ) );
		} finally {
			setBusy( false );
		}
	};

	const uploadCap = data?.maxUploadSize ? bytes( data.maxUploadSize ) : '';

	return (
		<Card>
			<CardHeader>
				<h2>{ __( 'Record and upload widgets', 'vocalstack' ) }</h2>
			</CardHeader>
			<CardBody className="vsa-form vsa-narrow">
				<p className="vsa-muted">
					{ __( 'Everything recorded or uploaded through a widget is transcribed on your VocalStack account and billed to it. These limits apply to every widget on the site; a widget’s own options can only make them stricter. 0 means no limit.', 'vocalstack' ) }
				</p>
				<SelectControl
					label={ __( 'Who can use them', 'vocalstack' ) }
					value={ policy.access }
					options={ [
						{ value: 'everyone', label: __( 'Everyone, including visitors (uploads only)', 'vocalstack' ) },
						{ value: 'logged_in', label: __( 'Logged-in users', 'vocalstack' ) },
						{ value: 'roles', label: __( 'Users with chosen roles', 'vocalstack' ) },
						{ value: 'nobody', label: __( 'Nobody: turn the widgets off', 'vocalstack' ) },
					] }
					onChange={ ( v ) => set( 'access', v ) }
					help={ __( '“Everyone” applies to uploads only: recording always needs a logged-in user.', 'vocalstack' ) }
					__nextHasNoMarginBottom
				/>
				{ policy.access === 'roles' && (
					<fieldset className="vsa-fieldset">
						<legend>{ __( 'Roles', 'vocalstack' ) }</legend>
						{ ( data?.roles ?? [] ).map( ( role ) => (
							<CheckboxControl
								key={ role.value }
								label={ role.label }
								checked={ policy.roles.includes( role.value ) }
								onChange={ ( on ) => set( 'roles', on ? [ ...policy.roles, role.value ] : policy.roles.filter( ( r ) => r !== role.value ) ) }
								__nextHasNoMarginBottom
							/>
						) ) }
					</fieldset>
				) }
				{ NUMBERS.map( ( [ key, label, help ] ) => (
					<TextControl
						key={ key }
						label={ label }
						type="number"
						min={ 0 }
						value={ String( policy[ key ] ?? 0 ) }
						onChange={ ( v ) => set( key, Math.max( 0, parseInt( v, 10 ) || 0 ) ) }
						help={
							key === 'maxUploadMb' && uploadCap
								? /* translators: %s: size, such as 64 MB */ sprintf( __( 'This site’s server accepts uploads up to %s; larger limits here have no effect.', 'vocalstack' ), uploadCap )
								: help
						}
						__nextHasNoMarginBottom
					/>
				) ) }
				<ErrorNotice error={ error } />
				{ saved && <Notice status="success" onRemove={ () => setSaved( false ) }>{ __( 'Limits saved.', 'vocalstack' ) }</Notice> }
				<div>
					<Button variant="primary" onClick={ save } isBusy={ busy } disabled={ busy }>
						{ __( 'Save limits', 'vocalstack' ) }
					</Button>
				</div>
			</CardBody>
		</Card>
	);
}
