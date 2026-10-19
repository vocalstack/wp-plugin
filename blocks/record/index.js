/**
 * VocalStack Record block.
 */
import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps } from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';
import { AccessPanel, CheckboxControl, InspectorControls, PanelBody, Preview, TextControl, TranscriptionPanel } from '../shared/controls';
import metadata from './block.json';

/**
 * `mic,tab,stream:<url>` as its parts, and back.
 *
 * @param {string} value Sources attribute.
 * @return {{mic: boolean, tab: boolean, stream: string}} Parts.
 */
const parse = ( value ) => {
	const list = ( value || '' ).split( ',' ).map( ( s ) => s.trim() );
	const stream = list.find( ( s ) => s.startsWith( 'stream:' ) );
	return { mic: list.includes( 'mic' ), tab: list.includes( 'tab' ), stream: stream ? stream.slice( 7 ) : '' };
};
const join = ( { mic, tab, stream } ) => [ mic && 'mic', tab && 'tab', stream && `stream:${ stream }` ].filter( Boolean ).join( ',' ) || 'mic';

function Edit( { attributes, setAttributes } ) {
	const sources = parse( attributes.sources );
	const setSource = ( change ) => setAttributes( { sources: join( { ...sources, ...change } ) } );

	return (
		<div { ...useBlockProps() }>
			<InspectorControls>
				<PanelBody title={ __( 'Recorder', 'vocalstack' ) }>
					<TextControl label={ __( 'Heading', 'vocalstack' ) } value={ attributes.title } onChange={ ( title ) => setAttributes( { title } ) } __nextHasNoMarginBottom />
					<TextControl label={ __( 'Button label', 'vocalstack' ) } value={ attributes.label } placeholder={ __( 'Start recording', 'vocalstack' ) } onChange={ ( label ) => setAttributes( { label } ) } __nextHasNoMarginBottom />
				</PanelBody>
				<PanelBody title={ __( 'Audio sources', 'vocalstack' ) }>
					<CheckboxControl label={ __( 'Microphone', 'vocalstack' ) } checked={ sources.mic } onChange={ ( mic ) => setSource( { mic } ) } __nextHasNoMarginBottom />
					<CheckboxControl
						label={ __( 'Browser tab or screen audio', 'vocalstack' ) }
						help={ __( 'Chrome and Edge on a computer only; others see it disabled.', 'vocalstack' ) }
						checked={ sources.tab }
						onChange={ ( tab ) => setSource( { tab } ) }
						__nextHasNoMarginBottom
					/>
					<TextControl
						label={ __( 'Your live stream URL', 'vocalstack' ) }
						value={ sources.stream }
						placeholder="https://"
						onChange={ ( stream ) => setSource( { stream: stream.trim() } ) }
						help={ __( 'A radio, HLS, Icecast or YouTube live address. VocalStack pulls it when someone presses Record; nobody needs a microphone.', 'vocalstack' ) }
						__nextHasNoMarginBottom
					/>
				</PanelBody>
				<TranscriptionPanel attributes={ attributes } setAttributes={ setAttributes } />
				<AccessPanel
					attributes={ attributes }
					setAttributes={ setAttributes }
					everyone={ false }
					limit={ {
						key: 'maxRecordMinutes',
						label: __( 'Longest recording (minutes)', 'vocalstack' ),
						help: __( 'Leave empty for the site’s limit; a smaller number wins. Recording always needs a logged-in user.', 'vocalstack' ),
					} }
				/>
			</InspectorControls>
			<Preview block={ metadata.name } attributes={ attributes } />
		</div>
	);
}

registerBlockType( metadata.name, { edit: Edit } );
