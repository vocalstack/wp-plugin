/**
 * VocalStack Player block.
 */
import { registerBlockType } from '@wordpress/blocks';
import { useBlockProps } from '@wordpress/block-editor';
import { Placeholder } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { InspectorControls, MediaPicker, PanelBody, Preview, SelectControl, TextControl, ToggleControl } from '../shared/controls';
import metadata from './block.json';

function Edit( { attributes, setAttributes } ) {
	const { source, id, transcript, timestamps, speakers, title } = attributes;
	const blockProps = useBlockProps();
	const idHelp = {
		recording: __( 'A transcription or recording id from the VocalStack page (Transcriptions).', 'vocalstack' ),
		broadcast: __( 'A public broadcast’s id from the VocalStack page (Broadcasts). Private broadcasts can’t be followed here.', 'vocalstack' ),
	};

	return (
		<div { ...blockProps }>
			<InspectorControls>
				<PanelBody title={ __( 'Source', 'vocalstack' ) }>
					<SelectControl
						label={ __( 'Play', 'vocalstack' ) }
						value={ source }
						options={ [
							{ value: 'media', label: __( 'A Media Library file', 'vocalstack' ) },
							{ value: 'recording', label: __( 'A VocalStack recording', 'vocalstack' ) },
							{ value: 'broadcast', label: __( 'A live broadcast', 'vocalstack' ) },
						] }
						onChange={ ( value ) => setAttributes( { source: value, id: '' } ) }
						__nextHasNoMarginBottom
					/>
					{ source === 'media' ? (
						<MediaPicker value={ id } onChange={ ( value ) => setAttributes( { id: value } ) } />
					) : (
						<TextControl label={ __( 'Id', 'vocalstack' ) } value={ id } onChange={ ( value ) => setAttributes( { id: value.trim() } ) } help={ idHelp[ source ] } __nextHasNoMarginBottom />
					) }
					<TextControl label={ __( 'Heading', 'vocalstack' ) } value={ title } onChange={ ( value ) => setAttributes( { title: value } ) } __nextHasNoMarginBottom />
				</PanelBody>
				<PanelBody title={ __( 'Transcript', 'vocalstack' ) }>
					<ToggleControl label={ __( 'Show the transcript', 'vocalstack' ) } checked={ transcript } onChange={ ( value ) => setAttributes( { transcript: value } ) } __nextHasNoMarginBottom />
					<ToggleControl label={ __( 'Show timestamps', 'vocalstack' ) } checked={ timestamps } disabled={ ! transcript } onChange={ ( value ) => setAttributes( { timestamps: value } ) } __nextHasNoMarginBottom />
					<ToggleControl label={ __( 'Show speakers', 'vocalstack' ) } checked={ speakers } disabled={ ! transcript } onChange={ ( value ) => setAttributes( { speakers: value } ) } __nextHasNoMarginBottom />
				</PanelBody>
			</InspectorControls>
			{ id ? (
				<Preview block={ metadata.name } attributes={ attributes } />
			) : (
				<Placeholder icon="controls-play" label={ __( 'VocalStack Player', 'vocalstack' ) } instructions={ source === 'media' ? __( 'Choose an audio or video file.', 'vocalstack' ) : idHelp[ source ] }>
					{ source === 'media' && <MediaPicker value={ id } onChange={ ( value ) => setAttributes( { id: value } ) } /> }
				</Placeholder>
			) }
		</div>
	);
}

registerBlockType( metadata.name, { edit: Edit } );
