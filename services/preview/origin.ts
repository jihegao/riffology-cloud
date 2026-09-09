import {validatedPreviewOrigin} from './browser.ts';
/** Shared platform host derivation; callers must separately verify registration. */
export function previewHostOrigin(base:string,label:string,control:string):string{
 validatedPreviewOrigin(base);validatedPreviewOrigin(control);
 if(!/^p-[a-f0-9]{40}$/.test(label))throw Error('invalid-preview-host');
 const b=new URL(base),c=new URL(control);
 if(c.hostname===b.hostname||c.hostname.endsWith('.'+b.hostname))throw Error('invalid-preview-host');
 return validatedPreviewOrigin(`${b.protocol}//${label}.${b.host}`);
}
