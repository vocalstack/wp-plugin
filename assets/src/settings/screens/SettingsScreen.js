/**
 * Settings: the account and its connection, how transcription runs, display,
 * and the widgets' spending ceilings.
 */
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	ExternalLink,
	Notice,
	SelectControl,
	Spinner,
	TextControl,
	ToggleControl,
} from '@wordpress/components';
import { useEffect, useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import BalanceCard from '../BalanceCard';
import { languageOptions, useLanguages } from '../lib/account';
import { navigate } from '../lib/router';
import WidgetPolicy from './WidgetPolicy';
import ListeningLanguages from '../components/ListeningLanguages';

const LANGUAGES = [
	[ '', __( 'Detect automatically', 'vocalstack' ) ],
	[ 'en', 'English' ],
	[ 'es', 'Español' ],
	[ 'fr', 'Français' ],
	[ 'de', 'Deutsch' ],
	[ 'it', 'Italiano' ],
	[ 'pt', 'Português' ],
	[ 'nl', 'Nederlands' ],
	[ 'ro', 'Română' ],
	[ 'pl', 'Polski' ],
	[ 'sv', 'Svenska' ],
	[ 'tr', 'Türkçe' ],
	[ 'uk', 'Українська' ],
	[ 'ru', 'Русский' ],
	[ 'ar', 'العربية' ],
	[ 'hi', 'हिन्दी' ],
	[ 'ja', '日本語' ],
	[ 'ko', '한국어' ],
	[ 'zh', '中文' ],
].map( ( [ value, label ] ) => ( { value, label } ) );

export default function SettingsScreen( { section = 'account', onConnection } ) {
	const languages = useLanguages();
	const [ state, setState ] = useState( null );
	const [ key, setKey ] = useState( '' );
	const [ busy, setBusy ] = useState( '' );
	const [ notice, setNotice ] = useState( null );

	useEffect( () => {
		apiFetch( { path: '/vocalstack/v1/settings' } ).then( setState, ( e ) => setNotice( { status: 'error', text: e.message } ) );
	}, [] );

	const send = async ( what, request, success ) => {
		setBusy( what );
		setNotice( null );
		try {
			const next = await apiFetch( request );
			setState( next );
			onConnection?.( next.connection.source !== 'none' );
			if ( success ) setNotice( { status: 'success', text: success } );
			return true;
		} catch ( e ) {
			setNotice( { status: 'error', text: e.message } );
			return false;
		} finally {
			setBusy( '' );
		}
	};

	if ( ! state ) {
		return notice ? <Notice status="error" isDismissible={ false }>{ notice.text }</Notice> : <Spinner />;
	}

	const { connection, settings, dashboardUrl } = state;
	const connected = connection.source !== 'none';
	const setSetting = ( name, value ) => setState( { ...state, settings: { ...settings, [ name ]: value } } );

	const connect = async () => {
		if ( await send( 'connect', { path: '/vocalstack/v1/settings', method: 'POST', data: { apiKey: key } }, __( 'Connected.', 'vocalstack' ) ) ) {
			setKey( '' );
		}
	};

	const save = (
		<Button variant="primary" isBusy={ busy === 'save' } disabled={ !! busy } onClick={ () => send( 'save', { path: '/vocalstack/v1/settings', method: 'POST', data: { settings } }, __( 'Settings saved.', 'vocalstack' ) ) }>
			{ __( 'Save settings', 'vocalstack' ) }
		</Button>
	);

	const account = (
		<>
			{ connected && <BalanceCard key={ connection.keyHint } /> }
			<Card>
				<CardHeader>
					<h2>{ __( 'Connection', 'vocalstack' ) }</h2>
				</CardHeader>
				<CardBody>
					{ connected ? (
						<>
							<p>
								{ connection.account
									? sprintf( /* translators: 1: account name, 2: last characters of the key */ __( 'Connected to %1$s with the key ending %2$s.', 'vocalstack' ), connection.account, connection.keyHint )
									: sprintf( /* translators: %s: last characters of the key */ __( 'Connected with the key ending %s.', 'vocalstack' ), connection.keyHint ) }
							</p>
							{ ! connection.editable && <p className="description">{ __( 'The key is set by VOCALSTACK_API_KEY in wp-config.php.', 'vocalstack' ) }</p> }
							<div className="vocalstack-settings__row">
								<Button variant="secondary" isBusy={ busy === 'test' } disabled={ !! busy } onClick={ () => send( 'test', { path: '/vocalstack/v1/settings/test', method: 'POST' }, __( 'The connection works.', 'vocalstack' ) ) }>
									{ __( 'Test connection', 'vocalstack' ) }
								</Button>
								{ connection.editable && (
									<Button variant="tertiary" isDestructive disabled={ !! busy } onClick={ () => send( 'disconnect', { path: '/vocalstack/v1/settings', method: 'POST', data: { apiKey: '' } }, __( 'Disconnected.', 'vocalstack' ) ) }>
										{ __( 'Disconnect', 'vocalstack' ) }
									</Button>
								) }
								<ExternalLink href={ dashboardUrl }>{ __( 'VocalStack dashboard', 'vocalstack' ) }</ExternalLink>
							</div>
						</>
					) : (
						<>
							<p>
								{ __( 'Transcription runs on VocalStack and is billed to your VocalStack account.', 'vocalstack' ) }{ ' ' }
								<ExternalLink href={ `${ dashboardUrl }/developers/keys` }>{ __( 'Sign up or create an API key', 'vocalstack' ) }</ExternalLink>
							</p>
							<div className="vocalstack-settings__row has-field">
								<TextControl
									label={ __( 'API key', 'vocalstack' ) }
									type="password"
									autoComplete="off"
									placeholder="vs_key_…"
									value={ key }
									onChange={ setKey }
									__nextHasNoMarginBottom
								/>
								<Button variant="primary" isBusy={ busy === 'connect' } disabled={ ! key || !! busy } onClick={ connect }>
									{ __( 'Connect', 'vocalstack' ) }
								</Button>
							</div>
						</>
					) }
				</CardBody>
			</Card>
		</>
	);

	const transcription = (
		<Card>
			<CardBody>
				<SelectControl
					label={ __( 'Spoken language', 'vocalstack' ) }
					value={ settings.language }
					options={ languages.length ? languageOptions( languages ) : LANGUAGES }
					onChange={ ( v ) => setSetting( 'language', v ) }
					help={ __( 'Set it when all your media is in one language; detection can misjudge short clips.', 'vocalstack' ) }
					__nextHasNoMarginBottom
				/>
				<SelectControl
					label={ __( 'Transcribe new uploads automatically', 'vocalstack' ) }
					value={ settings.auto }
					options={ [
						{ value: 'off', label: __( 'No, only when I click Transcribe', 'vocalstack' ) },
						{ value: 'audio', label: __( 'Audio files', 'vocalstack' ) },
						{ value: 'all', label: __( 'Audio and video files', 'vocalstack' ) },
					] }
					onChange={ ( v ) => setSetting( 'auto', v ) }
					help={ __( 'Every automatic transcription is billed to your VocalStack account.', 'vocalstack' ) }
					__nextHasNoMarginBottom
				/>
				<SelectControl
					label={ __( 'Identify speakers', 'vocalstack' ) }
					value={ settings.speakers }
					options={ [
						{ value: 'auto', label: __( 'When a second speaker is heard', 'vocalstack' ) },
						{ value: 'on', label: __( 'Always', 'vocalstack' ) },
						{ value: 'off', label: __( 'No', 'vocalstack' ) },
					] }
					onChange={ ( v ) => setSetting( 'speakers', v ) }
					help={ __( 'Labels who is talking, so transcripts show speakers and break paragraphs where the speaker changes. Applies to new transcriptions.', 'vocalstack' ) }
					__nextHasNoMarginBottom
				/>
				{ save }
			</CardBody>
		</Card>
	);

	const display = (
		<>
			<Card>
				<CardHeader>
					<h2>{ __( 'Captions', 'vocalstack' ) }</h2>
				</CardHeader>
				<CardBody>
					<ToggleControl
						label={ __( 'Show transcripts as captions on videos', 'vocalstack' ) }
						checked={ settings.captions }
						onChange={ ( v ) => setSetting( 'captions', v ) }
						help={ __( 'Adds a captions track to Video blocks whose file has a transcript.', 'vocalstack' ) }
						__nextHasNoMarginBottom
					/>
					{ save }
				</CardBody>
			</Card>
			<Card>
				<CardHeader>
					<h2>{ __( 'Listen in any language', 'vocalstack' ) }</h2>
				</CardHeader>
				<CardBody>
					<p>
						{ __( 'Players show a “Listen in” menu with these languages. Listeners read the transcript in the language they choose and, where VocalStack has a voice for it, hear it spoken. Live broadcasts are translated as they happen.', 'vocalstack' ) }
					</p>
					<p className="vsa-muted">
						{ __( 'Translation and speech are billed to your VocalStack account when a listener chooses a language, so offer the ones your audience needs. A player can offer fewer with its own “languages” option.', 'vocalstack' ) }
					</p>
					<ListeningLanguages value={ settings.languages } onChange={ ( v ) => setSetting( 'languages', v ) } languages={ languages } />
					{ save }
				</CardBody>
			</Card>
			<Card>
				<CardHeader>
					<h2>{ __( 'Transcripts on your site', 'vocalstack' ) }</h2>
				</CardHeader>
				<CardBody>
					<p>
						{ __( 'In the block editor, add the VocalStack Transcript block and choose a file. Visitors can click any sentence to jump to that moment.', 'vocalstack' ) }
					</p>
					<p>{ __( 'Elsewhere, such as a classic editor or a Shortcode widget, use the shortcode:', 'vocalstack' ) }</p>
					<p>
						<code>[vocalstack_transcript id="123"]</code>
					</p>
					<table className="widefat striped vocalstack-settings__table">
						<thead>
							<tr>
								<th>{ __( 'Attribute', 'vocalstack' ) }</th>
								<th>{ __( 'What it does', 'vocalstack' ) }</th>
							</tr>
						</thead>
						<tbody>
							<tr>
								<td><code>id</code></td>
								<td>{ __( 'The file’s ID, shown on its Media Library page. Required.', 'vocalstack' ) }</td>
							</tr>
							<tr>
								<td><code>player="1"</code></td>
								<td>{ __( 'Show a player above the transcript. Without it, the transcript follows the same file’s player elsewhere on the page.', 'vocalstack' ) }</td>
							</tr>
							<tr>
								<td><code>timestamps="0"</code></td>
								<td>{ __( 'Hide the timestamps.', 'vocalstack' ) }</td>
							</tr>
							<tr>
								<td><code>speakers="0"</code></td>
								<td>{ __( 'Hide the speaker names.', 'vocalstack' ) }</td>
							</tr>
						</tbody>
					</table>
				</CardBody>
			</Card>
		</>
	);

	const sections = [
		[ 'account', __( 'Account', 'vocalstack' ) ],
		[ 'transcription', __( 'Transcription', 'vocalstack' ) ],
		[ 'display', __( 'Display', 'vocalstack' ) ],
		[ 'widgets', __( 'Widgets', 'vocalstack' ) ],
	];
	const content = { account, transcription, display, widgets: <WidgetPolicy /> }[ section ] ?? account;

	return (
		<div className="vocalstack-settings vsa-screen">
			<nav className="vsa-subnav" aria-label={ __( 'Settings sections', 'vocalstack' ) }>
				{ sections.map( ( [ name, label ] ) => (
					<Button key={ name } variant={ name === section ? 'primary' : 'tertiary' } size="compact" aria-current={ name === section ? 'page' : undefined } onClick={ () => navigate( `/settings/${ name }` ) }>
						{ label }
					</Button>
				) ) }
			</nav>
			{ notice && (
				<Notice status={ notice.status } onRemove={ () => setNotice( null ) }>
					{ notice.text }
				</Notice>
			) }
			<div className="vocalstack-settings__panel">{ content }</div>
		</div>
	);
}
