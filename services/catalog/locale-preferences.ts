import {CatalogError, type Principal} from './contracts.ts';
import {statement as sql, type Database} from './database.ts';

export const SUPPORTED_LOCALES=['zh-CN','en'] as const;
export type SupportedLocale=(typeof SUPPORTED_LOCALES)[number];
function locale(value:unknown):SupportedLocale { if(typeof value!=='string'||!SUPPORTED_LOCALES.includes(value as SupportedLocale))throw new CatalogError('invalid_input'); return value as SupportedLocale; }

/** Account-owned presentation metadata. It neither reads nor writes auth, Turns, or workspaces. */
export class LocalePreferences {
 private readonly db:Database;
 private readonly clock:()=>number;
 constructor(db:Database,clock:()=>number=Date.now){this.db=db;this.clock=clock;}
 async get(principal:Principal):Promise<{locale:SupportedLocale|null}>{
  const rows=await this.db.query<{locale:SupportedLocale}>(sql(`SELECT p.locale FROM catalog_user_locale_preferences p WHERE p.user_id=? AND EXISTS (SELECT 1 FROM catalog_users u WHERE u.id=? AND u.status='active' AND u.auth_version=?)`,principal.userId,principal.userId,principal.authVersion));
  return {locale:rows[0]?.locale??null};
 }
 async set(principal:Principal,raw:unknown):Promise<{locale:SupportedLocale}>{
  const selected=locale(raw),now=this.clock();
  await this.db.batch([sql(`INSERT INTO catalog_user_locale_preferences(user_id,locale,updated_at) SELECT ?,?,? WHERE EXISTS (SELECT 1 FROM catalog_users u WHERE u.id=? AND u.status='active' AND u.auth_version=?) ON CONFLICT(user_id) DO UPDATE SET locale=excluded.locale,updated_at=excluded.updated_at WHERE EXISTS (SELECT 1 FROM catalog_users u WHERE u.id=? AND u.status='active' AND u.auth_version=?)`,principal.userId,selected,now,principal.userId,principal.authVersion,principal.userId,principal.authVersion)]);
  const current=await this.get(principal);if(current.locale!==selected)throw new CatalogError('not_found');return {locale:selected};
 }
}
