/**
 * Small pieces the screens share.
 */
import { Button, Icon, Modal, Notice, SearchControl, TextControl, Tooltip } from '@wordpress/components';
import { useCopyToClipboard } from '@wordpress/compose';
import { useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { audio, chevronRight, code, copy, language as languageIcon, video } from '@wordpress/icons';
import { languageInfo, useLanguages } from '../lib/account';
import { broadcastIcon, microphone, music, radio, youtube } from './icons';

const ROW_ICONS = { music, audio, video, mic: microphone, youtube, radio, rtmp: broadcastIcon, broadcast: broadcastIcon };

/** The round icon at the start of a row. */
export function RowIcon( { kind } ) {
	return (
		<span className={ `vsa-row-icon is-${ kind }` } aria-hidden="true">
			<Icon icon={ ROW_ICONS[ kind ] ?? music } size={ 20 } />
		</span>
	);
}

/** A small uppercase label: badges and status chips. */
export function Chip( { tone = 'neutral', icon, title, children } ) {
	const chip = (
		<span className={ `vsa-chip is-${ tone }` }>
			{ icon && <Icon icon={ icon } size={ 14 } /> }
			{ children }
		</span>
	);
	return title ? <Tooltip text={ title }>{ chip }</Tooltip> : chip;
}

export function ApiBadge() {
	return (
		<Chip icon={ code } title={ __( 'Created with an API key', 'vocalstack' ) }>
			{ __( 'API', 'vocalstack' ) }
		</Chip>
	);
}

/** "Auto detect", or a language's flag and name. */
export function LangLabel( { code: lang, native = false } ) {
	const languages = useLanguages();
	if ( ! lang ) {
		return (
			<span className="vsa-lang">
				<Icon icon={ languageIcon } size={ 18 } />
				{ __( 'Auto detect', 'vocalstack' ) }
			</span>
		);
	}
	const info = languageInfo( languages, lang );
	return (
		<span className="vsa-lang">
			{ info.flag ? <span aria-hidden="true">{ info.flag }</span> : <Icon icon={ languageIcon } size={ 18 } /> }
			{ native ? info.native || info.name : info.name }
		</span>
	);
}

export const Chevron = () => <Icon className="vsa-chevron" icon={ chevronRight } />;

/** The screen's title row. */
export function PageHeader( { title, subtitle, actions, back } ) {
	return (
		<div className="vsa-header">
			<div className="vsa-header__text">
				{ back }
				<h2 className="vsa-header__title">{ title }</h2>
				{ subtitle && <div className="vsa-header__subtitle">{ subtitle }</div> }
			</div>
			{ actions && <div className="vsa-header__actions">{ actions }</div> }
		</div>
	);
}

/** Search box above a list. */
export function ListSearch( { value, onChange, label } ) {
	return <SearchControl className="vsa-search" value={ value } onChange={ onChange } label={ label } placeholder={ label } __nextHasNoMarginBottom />;
}

/** "100+ TRANSCRIPTIONS" and the Select switch. */
export function ListBar( { label, selecting, onToggleSelect, info, children } ) {
	return (
		<div className="vsa-listbar">
			<span className="vsa-listbar__label">
				{ label }
				{ info }
			</span>
			<span className="vsa-listbar__actions">
				{ children }
				{ onToggleSelect && (
					<Button variant="tertiary" size="compact" onClick={ onToggleSelect } aria-pressed={ selecting }>
						{ selecting ? __( 'Done', 'vocalstack' ) : __( 'Select', 'vocalstack' ) }
					</Button>
				) }
			</span>
		</div>
	);
}

export function ErrorNotice( { error, onRemove } ) {
	if ( ! error ) return null;
	return (
		<Notice status="error" onRemove={ onRemove } isDismissible={ Boolean( onRemove ) }>
			{ error }
		</Notice>
	);
}

/** A field showing a value with a Copy button. */
export function CopyField( { value, label } ) {
	const [ copied, setCopied ] = useState( false );
	const ref = useCopyToClipboard( value, () => {
		setCopied( true );
		setTimeout( () => setCopied( false ), 1500 );
	} );
	return (
		<div className="vsa-copy">
			<code className="vsa-copy__value" aria-label={ label }>
				{ value }
			</code>
			<Button ref={ ref } icon={ copy } variant="secondary" size="compact">
				{ copied ? __( 'Copied', 'vocalstack' ) : __( 'Copy', 'vocalstack' ) }
			</Button>
		</div>
	);
}

/**
 * A permanent delete, behind typing a word: nothing is sent until it matches.
 */
export function PurgeModal( { what, count = 1, onConfirm, onClose } ) {
	const word = __( 'delete', 'vocalstack' );
	const [ typed, setTyped ] = useState( '' );
	const [ busy, setBusy ] = useState( false );
	const [ error, setError ] = useState( '' );
	const confirm = async () => {
		setBusy( true );
		setError( '' );
		try {
			await onConfirm();
			onClose();
		} catch ( e ) {
			setError( e?.message ?? String( e ) );
			setBusy( false );
		}
	};
	return (
		<Modal title={ __( 'Delete permanently', 'vocalstack' ) } onRequestClose={ onClose } size="small">
			<p>
				{ count > 1
					? /* translators: %d: number of items */ sprintf( __( 'This permanently deletes %d items from your VocalStack account: their audio, transcripts and share links. It can’t be undone.', 'vocalstack' ), count )
					: /* translators: %s: item name */ sprintf( __( 'This permanently deletes “%s” from your VocalStack account: its audio, transcript and share links. It can’t be undone.', 'vocalstack' ), what ) }
			</p>
			<TextControl
				/* translators: %s: the word to type */
				label={ sprintf( __( 'Type “%s” to confirm', 'vocalstack' ), word ) }
				value={ typed }
				onChange={ setTyped }
				autoComplete="off"
				__nextHasNoMarginBottom
			/>
			<ErrorNotice error={ error } />
			<div className="vsa-modal-actions">
				<Button variant="tertiary" onClick={ onClose }>
					{ __( 'Cancel', 'vocalstack' ) }
				</Button>
				<Button variant="primary" isDestructive disabled={ typed.trim().toLowerCase() !== word || busy } isBusy={ busy } onClick={ confirm }>
					{ __( 'Delete permanently', 'vocalstack' ) }
				</Button>
			</div>
		</Modal>
	);
}

/** A checkbox for select mode. */
export function SelectBox( { checked, onChange, label } ) {
	return (
		<input
			type="checkbox"
			className="vsa-select-box"
			checked={ checked }
			onChange={ ( e ) => onChange( e.target.checked ) }
			onClick={ ( e ) => e.stopPropagation() }
			aria-label={ label }
		/>
	);
}

/** Run `fn` on each id in turn, collecting failures. */
export async function eachInTurn( ids, fn ) {
	const failed = [];
	for ( const id of ids ) {
		try {
			await fn( id );
		} catch ( e ) {
			failed.push( e?.message ?? String( e ) );
		}
	}
	return failed;
}

export { audio, video };
