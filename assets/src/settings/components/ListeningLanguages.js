/**
 * The languages a site's players offer listeners: chips to remove, a search to
 * add. Marks which ones VocalStack can also speak.
 */
import { Button, ComboboxControl } from '@wordpress/components';
import { useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { languageInfo } from '../lib/account';

/**
 * @param {Object}   props
 * @param {string[]} props.value     Language codes, in the order offered.
 * @param {Function} props.onChange  Called with the new codes.
 * @param {Array}    props.languages VocalStack's languages (`code`, `name`, `native`, `flag`, `translation`, `voice`).
 */
export default function ListeningLanguages( { value, onChange, languages } ) {
	const [ adding, setAdding ] = useState( null );
	const chosen = value ?? [];
	const options = languages
		.filter( ( l ) => l.translation !== false && ! chosen.includes( l.code ) )
		.map( ( l ) => ( {
			value: l.code,
			label: `${ l.flag ? l.flag + ' ' : '' }${ l.name }${ l.native && l.native !== l.name ? ` (${ l.native })` : '' }${ l.voice ? '' : ` · ${ __( 'text only', 'vocalstack' ) }` }`,
		} ) )
		.sort( ( a, b ) => a.label.replace( /^\S+\s/, '' ).localeCompare( b.label.replace( /^\S+\s/, '' ) ) );

	return (
		<div className="vsa-languages">
			<ul className="vsa-languages__chosen" aria-label={ __( 'Offered languages', 'vocalstack' ) }>
				{ chosen.length === 0 && <li className="vsa-muted">{ __( 'None: players show only the original.', 'vocalstack' ) }</li> }
				{ chosen.map( ( code ) => {
					const l = languageInfo( languages, code );
					const voice = languages.find( ( x ) => x.code === code )?.voice;
					return (
						<li key={ code } className="vsa-languages__chip">
							<span>{ `${ l.flag ? l.flag + ' ' : '' }${ l.native || l.name }` }</span>
							<span className="vsa-languages__kind">{ voice ? __( 'spoken', 'vocalstack' ) : __( 'text', 'vocalstack' ) }</span>
							<Button
								icon="no-alt"
								size="small"
								label={ sprintf( /* translators: %s: language name */ __( 'Remove %s', 'vocalstack' ), l.name ) }
								onClick={ () => onChange( chosen.filter( ( c ) => c !== code ) ) }
							/>
						</li>
					);
				} ) }
			</ul>
			<ComboboxControl
				label={ __( 'Add a language', 'vocalstack' ) }
				value={ adding }
				options={ options }
				onChange={ ( code ) => {
					if ( code ) {
						onChange( [ ...chosen, code ] );
					}
					setAdding( null );
				} }
				__nextHasNoMarginBottom
			/>
		</div>
	);
}
