/**
 * A workspace's mark, as the VocalStack dashboard draws it: its own icon when
 * it has one; else, for the personal workspace, a person on a neutral tile;
 * else its initials on a tile tinted with its colour.
 */
import { useEffect, useState } from '@wordpress/element';
import { workspaceHue, workspaceInitials } from '../lib/workspaceMark';

/**
 * @param {Object}      props
 * @param {Object|null} props.workspace `{ id, name, personal, iconUrl }`; `iconUrl` is a full address or null.
 * @param {number}      [props.size]    Width and height in pixels.
 */
export default function WorkspaceMark( { workspace, size = 36 } ) {
	const iconUrl = workspace?.iconUrl || '';
	const [ broken, setBroken ] = useState( false );
	useEffect( () => setBroken( false ), [ iconUrl ] );

	const style = { width: size, height: size, borderRadius: Math.round( size * 0.29 ), fontSize: Math.round( size * 0.39 ) };
	if ( ! workspace ) return <span className="vsa-wsmark is-none" style={ style } aria-hidden="true" />;
	if ( iconUrl && ! broken ) {
		return (
			<span className="vsa-wsmark is-img" style={ style } aria-hidden="true">
				<img src={ iconUrl } alt="" draggable={ false } referrerPolicy="no-referrer" onError={ () => setBroken( true ) } />
			</span>
		);
	}
	if ( workspace.personal ) {
		const glyph = Math.round( size * 0.55 );
		return (
			<span className="vsa-wsmark is-me" style={ style } aria-hidden="true">
				<svg width={ glyph } height={ glyph } viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" focusable="false">
					<path d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
				</svg>
			</span>
		);
	}
	return (
		<span className="vsa-wsmark" style={ { ...style, '--vsa-ws-h': workspaceHue( workspace.id ) } } aria-hidden="true">
			{ workspaceInitials( workspace.name ) }
		</span>
	);
}
