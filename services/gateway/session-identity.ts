import type {VerifiedIdentity} from '../catalog/admission.ts';

type AuthSessionValue={user:{id:string;email:string;emailVerified:boolean};session:{id:string;expiresAt:Date;platformVersion:number}};
/** Called only with the server-side Better Auth result, never browser JSON. */
export function sessionIdentity(value:AuthSessionValue|null,now=Date.now()):VerifiedIdentity|null{
 if(!value)return null;
 const expiresAt=value.session.expiresAt instanceof Date?value.session.expiresAt.getTime():NaN;
 if(!/^[A-Za-z0-9_-]{1,128}$/.test(value.session.id)||!Number.isSafeInteger(expiresAt)||expiresAt<=now||
  !Number.isSafeInteger(value.session.platformVersion)||value.session.platformVersion<1) return null;
 return {subject:value.user.id,email:value.user.email,emailVerified:value.user.emailVerified,platformVersion:value.session.platformVersion,
  browserSession:{sessionId:value.session.id,expiresAt}};
}
