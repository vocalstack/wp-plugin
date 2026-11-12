/**
 * What the PHP page passes to the app (window.vocalstack).
 */
const config = window.vocalstack ?? {};

export const apiUrl = ( config.apiUrl ?? 'https://api.vocalstack.com' ).replace( /\/$/, '' );
export const adminPostUrl = config.adminPostUrl ?? '/wp-admin/admin-post.php';
export const exportNonce = config.exportNonce ?? '';
export const widgetSchema = config.schema ?? {};
export const dashboardUrl = ( config.dashboardUrl ?? 'https://app.vocalstack.com' ).replace( /\/$/, '' );
export const maxUploadSize = Number( config.maxUploadSize ?? 0 );
export const previewUrl = config.previewUrl ?? '/?vocalstack_preview=1';


let connectNotice = config.connectNotice ?? null;

/** The outcome of a one-click Connect the administrator just came back from, once. */
export function takeConnectNotice() {
	const notice = connectNotice;
	connectNotice = null;
	return notice && typeof notice.text === 'string' ? notice : null;
}

export default config;
