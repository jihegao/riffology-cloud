import {sha256Hex} from '../browser-preview/runtime/sha256.mjs';
import {PROJECT_VIEW_FRAME_HTML} from './frame-html.mjs';
export {PROJECT_VIEW_FRAME_HTML};
export const PROJECT_VIEW_FRAME_SHA256=sha256Hex(new TextEncoder().encode(PROJECT_VIEW_FRAME_HTML));
export const PROJECT_VIEW_FRAME_PATH='/project-views/'+PROJECT_VIEW_FRAME_SHA256+'/frame.html';
export function projectViewFrameHeaders(appOrigin){return {'content-type':'text/html; charset=utf-8','cache-control':'public, max-age=31536000, immutable','content-security-policy':`default-src 'none'; script-src 'unsafe-inline' blob:; style-src 'unsafe-inline' blob:; img-src blob: data:; media-src blob:; font-src blob:; connect-src 'none'; worker-src blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors ${appOrigin}; sandbox allow-scripts`,'permissions-policy':'camera=(), microphone=(), geolocation=(), usb=(), storage-access=()','referrer-policy':'no-referrer','x-content-type-options':'nosniff','cross-origin-resource-policy':'cross-origin'};}
