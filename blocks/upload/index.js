/**
 * VocalStack Upload block.
 */
import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps } from '@wordpress/block-editor';
import { __ } from '@wordpress/i18n';
import { AccessPanel, InspectorControls, PanelBody, Preview, SelectControl, TextControl, ToggleControl, TranscriptionPanel } from '../shared/controls';
import metadata from './block.json';

function Edit( { attributes, setAttributes } ) {
	return (
		<div { ...useBlockProps() }>
			<InspectorControls>
				<PanelBody title={ __( 'Upload', 'vocalstack' ) }>
					<TextControl label={ __( 'Heading', 'vocalstack' ) } value={ attributes.title } onChange={ ( title ) => setAttributes( { title } ) } __nextHasNoMarginBottom />
					<TextControl label={ __( 'Button label', 'vocalstack' ) } value={ attributes.label } placeholder={ __( 'Choose a file', 'vocalstack' ) } onChange={ ( label ) => setAttributes( { label } ) } __nextHasNoMarginBottom />
					<SelectControl
						label={ __( 'Accept', 'vocalstack' ) }
						value={ attributes.accept }
						options={ [
							{ value: 'audio,video', label: __( 'Audio and video', 'vocalstack' ) },
							{ value: 'audio', label: __( 'Audio only', 'vocalstack' ) },
							{ value: 'video', label: __( 'Video only', 'vocalstack' ) },
						] }
						onChange={ ( accept ) => setAttributes( { accept } ) }
						__nextHasNoMarginBottom
					/>
					<ToggleControl label={ __( 'Show the transcript when it’s ready', 'vocalstack' ) } checked={ attributes.transcript } onChange={ ( transcript ) => setAttributes( { transcript } ) } __nextHasNoMarginBottom />
				</PanelBody>
				<TranscriptionPanel attributes={ attributes } setAttributes={ setAttributes } />
				<AccessPanel
					attributes={ attributes }
					setAttributes={ setAttributes }
					everyone
					limit={ {
						key: 'maxUploadMb',
						label: __( 'Largest file (MB)', 'vocalstack' ),
						help: __( 'Leave empty for the site’s limit; a smaller number wins.', 'vocalstack' ),
					} }
				/>
			</InspectorControls>
			<Preview block={ metadata.name } attributes={ attributes } />
		</div>
	);
}

registerBlockType( metadata.name, { edit: Edit } );
