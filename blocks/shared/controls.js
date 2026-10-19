/**
 * Inspector controls shared by the widget blocks.
 */
import { InspectorControls, MediaUpload, MediaUploadCheck } from '@wordpress/block-editor';
import { Button, CheckboxControl, PanelBody, SelectControl, TextControl, ToggleControl, __experimentalNumberControl as NumberControl } from '@wordpress/components';
import ServerSideRender from '@wordpress/server-side-render';
import { __ } from '@wordpress/i18n';

export const LANGUAGES = [
	[ '', __( 'Site default', 'vocalstack' ) ],
	[ 'en', 'English' ],
	[ 'es', 'Español' ],
	[ 'fr', 'Français' ],
	[ 'de', 'Deutsch' ],
	[ 'it', 'Italiano' ],
	[ 'pt', 'Português' ],
	[ 'nl', 'Nederlands' ],
	[ 'ro', 'Română' ],
	[ 'pl', 'Polski' ],
	[ 'uk', 'Українська' ],
	[ 'ru', 'Русский' ],
	[ 'ar', 'العربية' ],
	[ 'hi', 'हिन्दी' ],
	[ 'ja', '日本語' ],
	[ 'ko', '한국어' ],
	[ 'zh', '中文' ],
].map( ( [ value, label ] ) => ( { value, label } ) );

export const SPEAKERS = [
	{ value: '', label: __( 'Site default', 'vocalstack' ) },
	{ value: 'auto', label: __( 'When a second speaker is heard', 'vocalstack' ) },
	{ value: 'on', label: __( 'Always', 'vocalstack' ) },
	{ value: 'off', label: __( 'No', 'vocalstack' ) },
];

/**
 * Who may use a billable widget. Live recording always needs a logged-in user.
 *
 * @param {boolean} everyone Whether "Everyone" may be offered.
 * @return {Array} Options.
 */
export const accessOptions = ( everyone ) => [
	{ value: '', label: __( 'Site setting', 'vocalstack' ) },
	...( everyone ? [ { value: 'everyone', label: __( 'Everyone, including visitors', 'vocalstack' ) } ] : [] ),
	{ value: 'logged_in', label: __( 'Logged-in users', 'vocalstack' ) },
	{ value: 'roles', label: __( 'Chosen roles', 'vocalstack' ) },
	{ value: 'nobody', label: __( 'Nobody (paused)', 'vocalstack' ) },
];

/**
 * Access and limit controls for the record and upload blocks.
 *
 * @param {Object}   props               Props.
 * @param {Object}   props.attributes    Block attributes.
 * @param {Function} props.setAttributes Setter.
 * @param {boolean}  props.everyone      Whether "Everyone" may be offered.
 * @param {Object}   props.limit         `{ key, label, help }` for the size or length limit.
 */
export function AccessPanel( { attributes, setAttributes, everyone, limit } ) {
	return (
		<PanelBody title={ __( 'Access and limits', 'vocalstack' ) } initialOpen={ false }>
			<SelectControl
				label={ __( 'Who can use it', 'vocalstack' ) }
				value={ attributes.access }
				options={ accessOptions( everyone ) }
				onChange={ ( access ) => setAttributes( { access } ) }
				help={ __( 'Can only be stricter than the site’s VocalStack settings. Each use is billed to the site’s VocalStack account.', 'vocalstack' ) }
				__nextHasNoMarginBottom
			/>
			{ attributes.access === 'roles' && (
				<TextControl
					label={ __( 'Roles', 'vocalstack' ) }
					value={ attributes.roles }
					onChange={ ( roles ) => setAttributes( { roles } ) }
					help={ __( 'Comma-separated role slugs, such as editor,author.', 'vocalstack' ) }
					__nextHasNoMarginBottom
				/>
			) }
			<NumberControl
				label={ limit.label }
				value={ attributes[ limit.key ] || '' }
				min={ 0 }
				onChange={ ( value ) => setAttributes( { [ limit.key ]: Math.max( 0, parseInt( value, 10 ) || 0 ) } ) }
				help={ limit.help }
			/>
		</PanelBody>
	);
}

/**
 * Transcription settings for the record and upload blocks.
 *
 * @param {Object}   props               Props.
 * @param {Object}   props.attributes    Block attributes.
 * @param {Function} props.setAttributes Setter.
 */
export function TranscriptionPanel( { attributes, setAttributes } ) {
	return (
		<PanelBody title={ __( 'Transcription', 'vocalstack' ) } initialOpen={ false }>
			<SelectControl
				label={ __( 'Spoken language', 'vocalstack' ) }
				value={ attributes.language }
				options={ LANGUAGES }
				onChange={ ( language ) => setAttributes( { language } ) }
				__nextHasNoMarginBottom
			/>
			{ 'speakers' in attributes && typeof attributes.speakers === 'string' && (
				<SelectControl
					label={ __( 'Identify speakers', 'vocalstack' ) }
					value={ attributes.speakers }
					options={ SPEAKERS }
					onChange={ ( speakers ) => setAttributes( { speakers } ) }
					__nextHasNoMarginBottom
				/>
			) }
		</PanelBody>
	);
}

/**
 * A live preview, rendered by the server like the page.
 *
 * @param {Object} props            Props.
 * @param {string} props.block      Block name.
 * @param {Object} props.attributes Block attributes.
 */
export function Preview( { block, attributes } ) {
	return <ServerSideRender block={ block } attributes={ attributes } skipBlockSupportAttributes />;
}

/**
 * The Media Library picker for the player.
 *
 * @param {Object}   props          Props.
 * @param {string}   props.value    Attachment id, as a string.
 * @param {Function} props.onChange Called with the new id.
 */
export function MediaPicker( { value, onChange } ) {
	return (
		<MediaUploadCheck>
			<MediaUpload
				allowedTypes={ [ 'audio', 'video' ] }
				value={ value ? Number( value ) : undefined }
				onSelect={ ( media ) => onChange( String( media.id ) ) }
				render={ ( { open } ) => (
					<Button variant="secondary" onClick={ open }>
						{ value ? __( 'Replace file', 'vocalstack' ) : __( 'Choose audio or video', 'vocalstack' ) }
					</Button>
				) }
			/>
		</MediaUploadCheck>
	);
}

export { InspectorControls, CheckboxControl, PanelBody, SelectControl, TextControl, ToggleControl };
