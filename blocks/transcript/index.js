/**
 * The VocalStack Transcript block: pick an audio or video file, show its transcript.
 */
import { registerBlockType } from '@wordpress/blocks';
import { BlockControls, InspectorControls, MediaPlaceholder, MediaReplaceFlow, useBlockProps } from '@wordpress/block-editor';
import { PanelBody, Placeholder, ToggleControl } from '@wordpress/components';
import ServerSideRender from '@wordpress/server-side-render';
import { __ } from '@wordpress/i18n';
import TranscribePanel from '../../assets/src/shared/TranscribePanel';
import metadata from './block.json';
import './style.scss';

const ALLOWED = [ 'audio', 'video' ];

function Edit( { attributes, setAttributes } ) {
	const { mediaId, showPlayer, showTimestamps, showSpeakers } = attributes;
	const blockProps = useBlockProps();
	const onSelect = ( media ) => setAttributes( { mediaId: media?.id ?? 0 } );

	if ( ! mediaId ) {
		return (
			<div { ...blockProps }>
				<MediaPlaceholder
					icon="media-text"
					labels={ {
						title: __( 'VocalStack Transcript', 'vocalstack' ),
						instructions: __( 'Choose an audio or video file from the Media Library.', 'vocalstack' ),
					} }
					allowedTypes={ ALLOWED }
					onSelect={ onSelect }
					disableDropZone
				/>
			</div>
		);
	}

	return (
		<div { ...blockProps }>
			<BlockControls group="other">
				<MediaReplaceFlow mediaId={ mediaId } allowedTypes={ ALLOWED } onSelect={ onSelect } name={ __( 'Replace file', 'vocalstack' ) } />
			</BlockControls>
			<InspectorControls>
				<PanelBody title={ __( 'Display', 'vocalstack' ) }>
					<ToggleControl label={ __( 'Show a player', 'vocalstack' ) } checked={ showPlayer } onChange={ ( v ) => setAttributes( { showPlayer: v } ) } help={ __( 'Otherwise the transcript follows the same file’s player elsewhere on the page.', 'vocalstack' ) } __nextHasNoMarginBottom />
					<ToggleControl label={ __( 'Show timestamps', 'vocalstack' ) } checked={ showTimestamps } onChange={ ( v ) => setAttributes( { showTimestamps: v } ) } __nextHasNoMarginBottom />
					<ToggleControl label={ __( 'Show speakers', 'vocalstack' ) } checked={ showSpeakers } onChange={ ( v ) => setAttributes( { showSpeakers: v } ) } __nextHasNoMarginBottom />
				</PanelBody>
				<PanelBody title={ __( 'Transcription', 'vocalstack' ) } initialOpen={ false }>
					<TranscribePanel id={ mediaId } compact />
				</PanelBody>
			</InspectorControls>
			<ServerSideRender
				block={ metadata.name }
				attributes={ attributes }
				skipBlockSupportAttributes
				EmptyResponsePlaceholder={ () => (
					<Placeholder icon="media-text" label={ __( 'VocalStack Transcript', 'vocalstack' ) }>
						{ __( 'This file has no transcript yet. Transcribe it from the block settings.', 'vocalstack' ) }
					</Placeholder>
				) }
			/>
		</div>
	);
}

registerBlockType( metadata.name, { edit: Edit } );
