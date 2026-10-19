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

export default config;
