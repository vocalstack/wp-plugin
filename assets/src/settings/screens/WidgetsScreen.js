/**
 * The widget generator: choose a widget and its options, copy the shortcode
 * (or use the block), and preview it.
 */
import apiFetch from '@wordpress/api-fetch';
import { Button, Card, CardBody, CardHeader, CheckboxControl, Notice, RadioControl, SelectControl, Spinner, TextControl, ToggleControl } from '@wordpress/components';
import { useEffect, useMemo, useRef, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { addQueryArgs } from '@wordpress/url';
import { languageOptions, useLanguages } from '../lib/account';
import { vs, wp } from '../lib/api';
import { previewUrl, widgetSchema } from '../lib/config';
import { CopyField, PageHeader } from '../components/ui';

/** The transcript widget predates the schema; its options, in the same form. */
const TRANSCRIPT_SCHEMA = {
	id: { default: '', type: 'string' },
	player: { default: false, type: 'bool' },
	timestamps: { default: true, type: 'bool' },
	speakers: { default: true, type: 'bool' },
};

const TYPES = [
	{ value: 'player', label: __( 'Audio player', 'vocalstack' ), help: __( 'Plays a Media Library file, a VocalStack recording or a live broadcast, with its transcript.', 'vocalstack' ) },
	{ value: 'record', label: __( 'Record button', 'vocalstack' ), help: __( 'Visitors record from their microphone or a browser tab, or start your stream, and see the transcript appear live. Billed to your VocalStack account.', 'vocalstack' ) },
	{ value: 'upload', label: __( 'Upload button', 'vocalstack' ), help: __( 'Visitors upload audio or video; it is saved in your Media Library and transcribed. Billed to your VocalStack account.', 'vocalstack' ) },
	{ value: 'transcript', label: __( 'Transcript', 'vocalstack' ), help: __( 'The transcript of a Media Library file, with click-to-seek.', 'vocalstack' ) },
];

const LABELS = {
	source: __( 'Plays', 'vocalstack' ),
	id: __( 'File, recording or broadcast', 'vocalstack' ),
	transcript: __( 'Show the transcript', 'vocalstack' ),
	timestamps: __( 'Show timestamps', 'vocalstack' ),
	speakers: __( 'Speakers', 'vocalstack' ),
	title: __( 'Title', 'vocalstack' ),
	sources: __( 'Audio sources', 'vocalstack' ),
	language: __( 'Spoken language', 'vocalstack' ),
	maxRecordMinutes: __( 'Longest recording (minutes)', 'vocalstack' ),
	access: __( 'Who can use it', 'vocalstack' ),
	roles: __( 'Roles', 'vocalstack' ),
	label: __( 'Button text', 'vocalstack' ),
	accept: __( 'Accepts', 'vocalstack' ),
	maxUploadMb: __( 'Largest file (MB)', 'vocalstack' ),
	player: __( 'Show a player', 'vocalstack' ),
	languages: __( 'Listening languages', 'vocalstack' ),
};

const ENUM_LABELS = {
	'': __( 'Site default', 'vocalstack' ),
	media: __( 'A Media Library file', 'vocalstack' ),
	recording: __( 'A VocalStack transcription', 'vocalstack' ),
	broadcast: __( 'A live broadcast (public)', 'vocalstack' ),
	everyone: __( 'Everyone', 'vocalstack' ),
	logged_in: __( 'Logged-in users', 'vocalstack' ),
	roles: __( 'Chosen roles', 'vocalstack' ),
	nobody: __( 'Nobody (turned off)', 'vocalstack' ),
	off: __( 'Off', 'vocalstack' ),
	auto: __( 'When needed', 'vocalstack' ),
	on: __( 'Always', 'vocalstack' ),
};

const HELP = {
	maxRecordMinutes: __( '0 uses the site’s ceiling (Settings → Widgets). A widget can only lower it.', 'vocalstack' ),
	maxUploadMb: __( '0 uses the site’s ceiling. A widget can only lower it.', 'vocalstack' ),
	languages: __( 'Empty offers the site’s languages (Settings → Display). To offer fewer, list their codes, such as es,fr.', 'vocalstack' ),
	access: __( 'A widget can only be stricter than the site’s setting. Recording always needs a logged-in user.', 'vocalstack' ),
};

const snake = ( key ) => key.replace( /[A-Z]/g, ( c ) => `_${ c.toLowerCase() }` );

export const schemaFor = ( type ) => ( type === 'transcript' ? TRANSCRIPT_SCHEMA : widgetSchema[ type ] ?? {} );

/** Defaults for a widget type. */
export function defaultsFor( type ) {
	return Object.fromEntries( Object.entries( schemaFor( type ) ).map( ( [ k, spec ] ) => [ k, spec.default ] ) );
}

const quote = ( v ) => String( v ).replace( /"/g, '&quot;' ).replace( /\]/g, '&#93;' );

/** A widget's shortcode attributes, with only the options that differ from the defaults. */
export function shortcodeAtts( type, values ) {
	const schema = schemaFor( type );
	return Object.fromEntries(
		Object.entries( values )
			.map( ( [ k, v ] ) => [ k, Array.isArray( v ) ? v.join( ',' ) : v ] )
			.filter( ( [ k, v ] ) => schema[ k ] && v !== schema[ k ].default && v !== '' )
			.map( ( [ k, v ] ) => [ snake( k ), typeof v === 'boolean' ? ( v ? '1' : '0' ) : String( v ) ] )
	);
}

/** The shortcode for a widget. */
export function shortcodeFor( type, values ) {
	const parts = Object.entries( shortcodeAtts( type, values ) ).map( ( [ k, v ] ) => `${ k }="${ quote( v ) }"` );
	return `[vocalstack_${ type }${ parts.length ? ' ' + parts.join( ' ' ) : '' }]`;
}

function MediaPicker( { value, onChange } ) {
	const [ title, setTitle ] = useState( '' );
	useEffect( () => {
		if ( ! value ) return setTitle( '' );
		apiFetch( { path: `/wp/v2/media/${ value }?_fields=title` } ).then(
			( m ) => setTitle( m?.title?.rendered ?? '' ),
			() => setTitle( '' )
		);
	}, [ value ] );
	const open = () => {
		const frame = window.wp?.media?.( { title: __( 'Choose audio or video', 'vocalstack' ), library: { type: [ 'audio', 'video' ] }, multiple: false } );
		if ( ! frame ) return;
		frame.on( 'select', () => onChange( String( frame.state().get( 'selection' ).first().id ) ) );
		frame.open();
	};
	return (
		<div className="vsa-picker">
			<span className="components-base-control__label">{ __( 'Media Library file', 'vocalstack' ) }</span>
			<div className="vsa-inline">
				<Button variant="secondary" onClick={ open } disabled={ ! window.wp?.media }>
					{ value ? __( 'Change file', 'vocalstack' ) : __( 'Choose file', 'vocalstack' ) }
				</Button>
				{ value && <span>{ title || `#${ value }` }</span> }
			</div>
		</div>
	);
}

function VocalStackPicker( { kind, value, onChange } ) {
	const [ options, setOptions ] = useState( null );
	useEffect( () => {
		setOptions( null );
		const load =
			kind === 'broadcast'
				? vs( 'broadcasts', { query: { lifecycle: 'active' } } ).then( ( r ) =>
						( r.broadcasts ?? [] ).map( ( b ) => ( {
							value: b.id,
							label: b.access === 'private' ? `${ b.name } (${ __( 'private: can’t be shown', 'vocalstack' ) })` : b.name,
							disabled: b.access === 'private',
						} ) )
				  )
				: vs( 'transcriptions', { query: { limit: 100 } } ).then( ( r ) =>
						( r.transcriptions ?? [] ).filter( ( t ) => ! t.live || t.lastRecording ).map( ( t ) => ( { value: t.id, label: ( t.live && t.lastRecording?.title ) || t.name } ) )
				  );
		load.then( setOptions, () => setOptions( [] ) );
	}, [ kind ] );
	if ( options === null ) return <Spinner />;
	return (
		<SelectControl
			label={ kind === 'broadcast' ? __( 'Broadcast', 'vocalstack' ) : __( 'Transcription', 'vocalstack' ) }
			value={ value }
			options={ [ { value: '', label: __( 'Choose…', 'vocalstack' ) }, ...options ] }
			onChange={ onChange }
			help={ kind === 'recording' ? __( 'The 100 most recent transcriptions on your account.', 'vocalstack' ) : undefined }
			__nextHasNoMarginBottom
		/>
	);
}

function SourcesField( { value, onChange } ) {
	const list = Array.isArray( value ) ? value : String( value || '' ).split( ',' ).filter( Boolean );
	const stream = list.find( ( s ) => s.startsWith( 'stream:' ) )?.slice( 7 ) ?? '';
	const has = ( s ) => list.includes( s );
	const set = ( next ) => onChange( next.length ? next : [ 'mic' ] );
	const toggle = ( s, on ) => set( on ? [ ...list, s ] : list.filter( ( x ) => x !== s ) );
	return (
		<fieldset className="vsa-fieldset">
			<legend>{ LABELS.sources }</legend>
			<CheckboxControl label={ __( 'Microphone', 'vocalstack' ) } checked={ has( 'mic' ) } onChange={ ( on ) => toggle( 'mic', on ) } __nextHasNoMarginBottom />
			<CheckboxControl
				label={ __( 'Browser tab or screen audio', 'vocalstack' ) }
				help={ __( 'Chrome and Edge only; other browsers hide this choice.', 'vocalstack' ) }
				checked={ has( 'tab' ) }
				onChange={ ( on ) => toggle( 'tab', on ) }
				__nextHasNoMarginBottom
			/>
			<TextControl
				label={ __( 'Your stream URL (optional)', 'vocalstack' ) }
				help={ __( 'A YouTube live, radio, HLS or RTMP stream VocalStack pulls when a visitor presses Record. Visitors can’t change it.', 'vocalstack' ) }
				type="url"
				value={ stream }
				onChange={ ( url ) => set( [ ...list.filter( ( s ) => ! s.startsWith( 'stream:' ) ), ...( url.trim() ? [ `stream:${ url.trim() }` ] : [] ) ] ) }
				__nextHasNoMarginBottom
			/>
		</fieldset>
	);
}

function Field( { type, name, spec, value, values, onChange, roles, languages } ) {
	const label = LABELS[ name ] ?? name;
	const help = HELP[ name ];
	if ( name === 'id' ) {
		if ( type === 'transcript' || values.source === 'media' ) return <MediaPicker value={ value } onChange={ onChange } />;
		return <VocalStackPicker kind={ values.source } value={ value } onChange={ onChange } />;
	}
	if ( name === 'sources' ) return <SourcesField value={ value } onChange={ onChange } />;
	if ( name === 'language' ) {
		return <SelectControl label={ label } value={ value } options={ languageOptions( languages ).map( ( o ) => ( o.value === '' ? { ...o, label: __( 'Site default', 'vocalstack' ) } : o ) ) } onChange={ onChange } __nextHasNoMarginBottom />;
	}
	if ( name === 'roles' ) {
		if ( values.access !== 'roles' ) return null;
		const list = Array.isArray( value ) ? value : String( value || '' ).split( ',' ).filter( Boolean );
		return (
			<fieldset className="vsa-fieldset">
				<legend>{ label }</legend>
				{ roles.map( ( r ) => (
					<CheckboxControl key={ r.value } label={ r.label } checked={ list.includes( r.value ) } onChange={ ( on ) => onChange( on ? [ ...list, r.value ] : list.filter( ( x ) => x !== r.value ) ) } __nextHasNoMarginBottom />
				) ) }
			</fieldset>
		);
	}
	if ( name === 'accept' ) {
		const list = String( value || '' ).split( ',' ).filter( Boolean );
		const toggle = ( kind, on ) => {
			const next = on ? [ ...new Set( [ ...list, kind ] ) ] : list.filter( ( x ) => x !== kind );
			onChange( ( next.length ? next : [ kind === 'audio' ? 'video' : 'audio' ] ).join( ',' ) );
		};
		return (
			<fieldset className="vsa-fieldset">
				<legend>{ label }</legend>
				<CheckboxControl label={ __( 'Audio', 'vocalstack' ) } checked={ list.includes( 'audio' ) } onChange={ ( on ) => toggle( 'audio', on ) } __nextHasNoMarginBottom />
				<CheckboxControl label={ __( 'Video', 'vocalstack' ) } checked={ list.includes( 'video' ) } onChange={ ( on ) => toggle( 'video', on ) } __nextHasNoMarginBottom />
			</fieldset>
		);
	}
	if ( spec.type === 'bool' ) return <ToggleControl label={ label } checked={ Boolean( value ) } onChange={ onChange } help={ help } __nextHasNoMarginBottom />;
	if ( spec.type === 'int' ) {
		return <TextControl label={ label } type="number" min={ 0 } value={ String( value ?? 0 ) } onChange={ ( v ) => onChange( Math.max( 0, parseInt( v, 10 ) || 0 ) ) } help={ help } __nextHasNoMarginBottom />;
	}
	if ( spec.type.startsWith( 'enum:' ) ) {
		const choices = spec.type.slice( 5 ).split( '|' );
		const options = choices.map( ( c ) => ( { value: c, label: ENUM_LABELS[ c ] ?? c } ) );
		if ( name === 'source' ) return <RadioControl label={ label } selected={ value } options={ options } onChange={ onChange } />;
		return <SelectControl label={ label } value={ value } options={ options } onChange={ onChange } help={ help } __nextHasNoMarginBottom />;
	}
	return <TextControl label={ label } value={ value ?? '' } onChange={ onChange } help={ help } __nextHasNoMarginBottom />;
}

/**
 * The real widget, working: an admin-only front-end page with the theme's
 * styles and the widget's scripts, in a frame that grows to fit it.
 */
function Preview( { type, values } ) {
	const needsId = ( type === 'player' || type === 'transcript' ) && ! values.id;
	const atts = JSON.stringify( shortcodeAtts( type, values ) );
	const [ src, setSrc ] = useState( '' );
	const [ height, setHeight ] = useState( 120 );
	const frame = useRef( null );

	// Changing a field reloads the preview after a pause, not on every key.
	useEffect( () => {
		if ( needsId ) {
			return;
		}
		const timer = setTimeout( () => setSrc( addQueryArgs( previewUrl, { type, atts } ) ), 400 );
		return () => clearTimeout( timer );
	}, [ type, atts, needsId ] );

	const fit = () => {
		const doc = frame.current?.contentDocument;
		if ( ! doc?.body ) {
			return;
		}
		const measure = () => setHeight( Math.max( 80, doc.documentElement.scrollHeight ) );
		measure();
		new window.ResizeObserver( measure ).observe( doc.body );
	};

	if ( needsId ) return <p className="vsa-muted">{ __( 'Choose what it plays to see a preview.', 'vocalstack' ) }</p>;
	if ( ! src ) return <Spinner />;
	return (
		<>
			{ ( type === 'record' || type === 'upload' ) && (
				<Notice status="warning" isDismissible={ false }>
					{ type === 'record'
						? __( 'This preview works: a recording made here is real and billed to your VocalStack account.', 'vocalstack' )
						: __( 'This preview works: a file uploaded here goes into the Media Library and is transcribed, billed to your VocalStack account.', 'vocalstack' ) }
				</Notice>
			) }
			<iframe
				ref={ frame }
				className="vsa-preview-frame"
				title={ __( 'Widget preview', 'vocalstack' ) }
				src={ src }
				style={ { height } }
				onLoad={ fit }
				allow="microphone; display-capture; autoplay"
			/>
		</>
	);
}

export default function WidgetsScreen() {
	const languages = useLanguages();
	const [ type, setType ] = useState( 'player' );
	const [ values, setValues ] = useState( () => defaultsFor( 'player' ) );
	const [ roles, setRoles ] = useState( [] );

	useEffect( () => {
		wp( 'widget-policy' ).then( ( r ) => setRoles( r.roles ?? [] ), () => setRoles( [] ) );
	}, [] );

	const choose = ( next ) => {
		setType( next );
		setValues( defaultsFor( next ) );
	};

	const schema = schemaFor( type );
	const shortcode = useMemo( () => shortcodeFor( type, values ), [ type, values ] );
	const info = TYPES.find( ( t ) => t.value === type );
	const missing = ! Object.keys( widgetSchema ).length;

	return (
		<div className="vsa-screen">
			<PageHeader title={ __( 'Widgets', 'vocalstack' ) } subtitle={ __( 'Add players, record buttons and upload buttons to your pages, as a block or a shortcode.', 'vocalstack' ) } />
			{ missing && <Notice status="warning" isDismissible={ false }>{ __( 'The widget options could not be loaded.', 'vocalstack' ) }</Notice> }
			<div className="vsa-widgets">
				<Card>
					<CardHeader>
						<h3>{ __( 'Widget', 'vocalstack' ) }</h3>
					</CardHeader>
					<CardBody className="vsa-form">
						<SelectControl label={ __( 'Type', 'vocalstack' ) } value={ type } options={ TYPES.map( ( { value, label } ) => ( { value, label } ) ) } onChange={ choose } help={ info?.help } __nextHasNoMarginBottom />
						{ Object.entries( schema ).map( ( [ name, spec ] ) => (
							<Field
								key={ `${ type }:${ name }` }
								type={ type }
								name={ name }
								spec={ spec }
								value={ values[ name ] }
								values={ values }
								roles={ roles }
								languages={ languages }
								onChange={ ( v ) => setValues( ( prev ) => ( { ...prev, [ name ]: v, ...( name === 'source' ? { id: '' } : {} ) } ) ) }
							/>
						) ) }
					</CardBody>
				</Card>
				<div className="vsa-widgets__side">
					<Card>
						<CardHeader>
							<h3>{ __( 'Shortcode', 'vocalstack' ) }</h3>
						</CardHeader>
						<CardBody>
							<CopyField value={ shortcode } label={ __( 'Shortcode', 'vocalstack' ) } />
							<p className="vsa-muted">
								{ /* translators: %s: block name */ sprintf( __( 'In the block editor, add the “%s” block instead and set the same options in its sidebar.', 'vocalstack' ), info?.label ) }
								{ ' ' }
								<code>{ `vocalstack/${ type }` }</code>
							</p>
						</CardBody>
					</Card>
					<Card>
						<CardHeader>
							<h3>{ __( 'Preview', 'vocalstack' ) }</h3>
						</CardHeader>
						<CardBody>
							<Preview type={ type } values={ values } />
						</CardBody>
					</Card>
					<Card>
						<CardHeader>
							<h3>{ __( 'Styling', 'vocalstack' ) }</h3>
						</CardHeader>
						<CardBody className="vsa-styling">
							<p>{ __( 'Widgets take your theme’s colours and fonts. To change them, override these custom properties in your theme’s CSS:', 'vocalstack' ) }</p>
							<pre>{ `.vocalstack-widget {
  --vocalstack-accent: #245b8f;
  --vocalstack-text: inherit;
  --vocalstack-surface: #fff;
  --vocalstack-border: #dcdcde;
  --vocalstack-radius: 8px;
  --vocalstack-font: inherit;
}` }</pre>
							<p>{ __( 'To change a widget’s HTML, copy its template from the plugin’s templates/ folder to yourtheme/vocalstack/<name>.php and edit the copy.', 'vocalstack' ) }</p>
							<p>{ __( 'As blocks, the widgets also follow theme.json and the Site Editor’s colour, typography, spacing and border settings.', 'vocalstack' ) }</p>
						</CardBody>
					</Card>
				</div>
			</div>
		</div>
	);
}
