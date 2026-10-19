/**
 * New broadcast: a name, its public link, language and access.
 */
import { Button, Modal, RadioControl, SelectControl, TextControl } from '@wordpress/components';
import { useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { languageOptions, SPEAKER_OPTIONS, useLanguages } from '../lib/account';
import { errorMessage, vs } from '../lib/api';
import { slugify } from '../lib/format';
import { ErrorNotice } from '../components/ui';

export const CODE_MIN = 6;

/** The fields a broadcast's settings share between create and edit. */
export function BroadcastFields( { values, onChange, creating = false } ) {
	const languages = useLanguages();
	const set = ( key ) => ( value ) => onChange( { ...values, [ key ]: value } );
	const codeError = values.code && values.code.length < CODE_MIN ? __( 'At least 6 characters.', 'vocalstack' ) : '';
	return (
		<div className="vsa-form">
			<TextControl
				label={ __( 'Name', 'vocalstack' ) }
				value={ values.name }
				onChange={ ( name ) => onChange( { ...values, name, ...( creating && ! values.codeTouched ? { code: slugify( name ) } : {} ) } ) }
				__nextHasNoMarginBottom
			/>
			<TextControl
				label={ __( 'Link', 'vocalstack' ) }
				value={ values.code }
				onChange={ ( code ) => onChange( { ...values, code: slugify( code ), codeTouched: true } ) }
				help={ codeError || `live.vocalstack.com/${ values.code || '…' }${ creating ? '' : ' · ' + __( 'Old links keep working after a change.', 'vocalstack' ) }` }
				__nextHasNoMarginBottom
			/>
			<div className="vsa-grid-2">
				<SelectControl label={ __( 'Spoken language', 'vocalstack' ) } value={ values.language } options={ languageOptions( languages ) } onChange={ set( 'language' ) } __nextHasNoMarginBottom />
				<SelectControl label={ __( 'Speaker labels', 'vocalstack' ) } value={ values.speakers } options={ SPEAKER_OPTIONS } onChange={ set( 'speakers' ) } __nextHasNoMarginBottom />
			</div>
			<RadioControl
				label={ __( 'Who can follow it', 'vocalstack' ) }
				selected={ values.access }
				options={ [
					{ value: 'public', label: __( 'Anyone with the link', 'vocalstack' ) },
					{ value: 'private', label: __( 'Only people with the password', 'vocalstack' ) },
				] }
				onChange={ set( 'access' ) }
			/>
			{ values.access === 'private' && (
				<TextControl
					label={ __( 'Password', 'vocalstack' ) }
					type="password"
					autoComplete="new-password"
					value={ values.password }
					onChange={ set( 'password' ) }
					help={ creating ? __( 'Listeners type it once on the broadcast page.', 'vocalstack' ) : __( 'Leave empty to keep the current password. A new one signs every listener out.', 'vocalstack' ) }
					__nextHasNoMarginBottom
				/>
			) }
			{ values.access === 'private' && (
				<p className="vsa-muted">{ __( 'Private broadcasts can’t be shown with the VocalStack player widget on your site; it follows public broadcasts only.', 'vocalstack' ) }</p>
			) }
		</div>
	);
}

/** The request body for the fields. */
export function broadcastBody( values, { creating = false } = {} ) {
	const body = {
		name: values.name.trim(),
		code: values.code,
		access: values.access,
		settings: { spokenLanguage: values.language || null, speakerLabels: values.speakers },
	};
	if ( values.access === 'private' && values.password ) body.password = values.password;
	if ( creating && ! body.code ) delete body.code;
	return body;
}

export default function NewBroadcast( { onClose, onCreated } ) {
	const [ values, setValues ] = useState( { name: '', code: '', language: '', speakers: 'auto', access: 'public', password: '' } );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState( '' );
	const invalid = ! values.name.trim() || ( values.code && values.code.length < CODE_MIN ) || ( values.access === 'private' && ! values.password );
	const create = async () => {
		setBusy( true );
		setError( '' );
		try {
			onCreated( await vs( 'broadcasts', { method: 'POST', idempotent: true, data: broadcastBody( values, { creating: true } ) } ) );
		} catch ( e ) {
			setError( errorMessage( e ) );
			setBusy( false );
		}
	};
	return (
		<Modal title={ __( 'New broadcast', 'vocalstack' ) } onRequestClose={ onClose } className="vsa-modal" size="medium">
			<BroadcastFields values={ values } onChange={ setValues } creating />
			<ErrorNotice error={ error } />
			<div className="vsa-modal-actions">
				<Button variant="tertiary" onClick={ onClose }>
					{ __( 'Cancel', 'vocalstack' ) }
				</Button>
				<Button variant="primary" onClick={ create } isBusy={ busy } disabled={ invalid || busy }>
					{ __( 'Create broadcast', 'vocalstack' ) }
				</Button>
			</div>
		</Modal>
	);
}
