/**
 * A VocalStack panel in the inspector of core Audio and Video blocks that
 * hold a Media Library file.
 */
import { InspectorControls } from '@wordpress/block-editor';
import { PanelBody } from '@wordpress/components';
import { createHigherOrderComponent } from '@wordpress/compose';
import { addFilter } from '@wordpress/hooks';
import { __ } from '@wordpress/i18n';
import TranscribePanel from '../shared/TranscribePanel';
import '../shared/panel.scss';

const BLOCKS = [ 'core/audio', 'core/video' ];

const withTranscribePanel = createHigherOrderComponent(
	( BlockEdit ) => ( props ) => {
		const id = props.attributes?.id;
		if ( ! BLOCKS.includes( props.name ) || ! id ) {
			return <BlockEdit { ...props } />;
		}
		return (
			<>
				<BlockEdit { ...props } />
				<InspectorControls>
					<PanelBody title={ __( 'VocalStack transcript', 'vocalstack' ) } initialOpen={ false }>
						<TranscribePanel id={ id } compact />
					</PanelBody>
				</InspectorControls>
			</>
		);
	},
	'withVocalStackTranscribePanel'
);

addFilter( 'editor.BlockEdit', 'vocalstack/transcribe-panel', withTranscribePanel );
