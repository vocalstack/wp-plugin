/**
 * A transcription's or broadcast's share links: create, toggle, revoke, copy.
 */
import { Button, CheckboxControl, Spinner, TextControl } from '@wordpress/components';
import { useCallback, useEffect, useState } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import { errorMessage, seg, vs } from '../lib/api';
import { when } from '../lib/format';
import { CopyField, ErrorNotice } from './ui';

const FLAGS = [
	[ 'allowDownload', __( 'Download audio', 'vocalstack' ) ],
	[ 'allowExport', __( 'Export transcript', 'vocalstack' ) ],
	[ 'allowTranslate', __( 'Translate', 'vocalstack' ) ],
];

export default function ShareLinks( { parent, id } ) {
	const [ links, setLinks ] = useState( null );
	const [ label, setLabel ] = useState( '' );
	const [ busy, setBusy ] = useState( '' );
	const [ error, setError ] = useState( '' );

	const load = useCallback( async () => {
		try {
			const r = await vs( `${ parent }/${ seg( id ) }/share-links` );
			setLinks( ( r.links ?? r ?? [] ).filter( ( l ) => ! l.revokedAt ) );
		} catch ( e ) {
			setError( errorMessage( e ) );
			setLinks( [] );
		}
	}, [ parent, id ] );

	useEffect( () => {
		load();
	}, [ load ] );

	const run = async ( key, fn ) => {
		setBusy( key );
		setError( '' );
		try {
			await fn();
			await load();
		} catch ( e ) {
			setError( errorMessage( e ) );
		} finally {
			setBusy( '' );
		}
	};

	const create = () =>
		run( 'create', async () => {
			await vs( `${ parent }/${ seg( id ) }/share-links`, { method: 'POST', data: { label: label.trim() || __( 'Shared link', 'vocalstack' ) } } );
			setLabel( '' );
		} );

	return (
		<div className="vsa-share">
			<p className="vsa-muted">
				{ __( 'Anyone with a share link can read the transcript and listen, without a VocalStack account. Revoke a link to stop it working.', 'vocalstack' ) }
			</p>
			<ErrorNotice error={ error } onRemove={ () => setError( '' ) } />
			{ links === null && <Spinner /> }
			{ links?.length === 0 && <p>{ __( 'No share links.', 'vocalstack' ) }</p> }
			<ul className="vsa-share__list">
				{ links?.map( ( link ) => (
					<li key={ link.id } className="vsa-card">
						<div className="vsa-share__head">
							<strong>{ link.label }</strong>
							<span className="vsa-muted">
								{ /* translators: %d: number of views */ sprintf( _n( '%d view', '%d views', link.views ?? 0, 'vocalstack' ), link.views ?? 0 ) }
								{ link.lastViewedAt ? ` · ${ when( link.lastViewedAt ) }` : '' }
							</span>
						</div>
						<CopyField value={ link.url } label={ __( 'Share link', 'vocalstack' ) } />
						<div className="vsa-share__flags">
							{ FLAGS.map( ( [ flag, text ] ) => (
								<CheckboxControl
									key={ flag }
									label={ text }
									checked={ link[ flag ] !== false }
									disabled={ Boolean( busy ) }
									onChange={ ( on ) => run( `${ link.id }:${ flag }`, () => vs( `share-links/${ seg( link.id ) }`, { method: 'PATCH', data: { [ flag ]: on } } ) ) }
									__nextHasNoMarginBottom
								/>
							) ) }
							<Button
								variant="tertiary"
								isDestructive
								size="compact"
								disabled={ Boolean( busy ) }
								isBusy={ busy === `${ link.id }:revoke` }
								onClick={ () => run( `${ link.id }:revoke`, () => vs( `share-links/${ seg( link.id ) }`, { method: 'DELETE' } ) ) }
							>
								{ __( 'Revoke', 'vocalstack' ) }
							</Button>
						</div>
					</li>
				) ) }
			</ul>
			<div className="vsa-inline">
				<TextControl label={ __( 'New link’s label', 'vocalstack' ) } value={ label } onChange={ setLabel } placeholder={ __( 'e.g. Newsletter', 'vocalstack' ) } __nextHasNoMarginBottom />
				<Button variant="secondary" onClick={ create } isBusy={ busy === 'create' } disabled={ Boolean( busy ) }>
					{ __( 'Create link', 'vocalstack' ) }
				</Button>
			</div>
		</div>
	);
}
