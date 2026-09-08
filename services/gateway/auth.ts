import { betterAuth, type BetterAuthOptions } from 'better-auth';
import { statement as sql, type Database } from '../catalog/database.ts';
import { normalizedEmail } from '../catalog/admission.ts';

export interface AuthConfiguration {
  database: NonNullable<BetterAuthOptions['database']>;
  catalog: Database;
  origin: string;
  secret: string;
  googleClientId: string;
  googleClientSecret: string;
}
/** No email/password endpoint, public signup bypass, cookie session cache or account linking. */
export function authOptions(config: AuthConfiguration) {
  const url = new URL(config.origin);
  if (url.origin !== config.origin || (url.protocol !== 'https:' && !(url.protocol === 'http:' && url.hostname === '127.0.0.1')))
    throw Error('invalid-auth-origin');
  if (config.secret.length < 32 || !config.googleClientId || !config.googleClientSecret) throw Error('auth-config-missing');
  async function pending(email: string) {
    const rows=await config.catalog.query(sql(`SELECT 1 FROM catalog_invitations WHERE normalized_email=? AND state='pending' AND expires_at>? LIMIT 1`,normalizedEmail(email),Date.now()));
    return rows.length>0;
  }
  return {
    appName:'Riffology', database:config.database, secret:config.secret,
    baseURL:config.origin, basePath:'/api/auth', trustedOrigins:[config.origin],
    emailAndPassword:{enabled:false},
    socialProviders:{google:{clientId:config.googleClientId,clientSecret:config.googleClientSecret,accessType:'online' as const,includeGrantedScopes:false}},
    user:{modelName:'auth_user',changeEmail:{enabled:false},deleteUser:{enabled:false}},
    account:{modelName:'auth_account',accountLinking:{enabled:false},encryptOAuthTokens:true,storeStateStrategy:'database' as const},
    verification:{modelName:'auth_verification'},
    session:{modelName:'auth_session',expiresIn:60*60*8,updateAge:60*15,cookieCache:{enabled:false},
      additionalFields:{platformVersion:{type:'number' as const,required:true,defaultValue:1,input:false}}},
    rateLimit:{enabled:true,storage:'database' as const,modelName:'auth_rate_limit',window:60,max:30},
    advanced:{cookiePrefix:'riffology',useSecureCookies:url.protocol==='https:'},
    // Deliberately omit raw error logging; identity tokens/provider payloads are private.
    logger:{disabled:true},
    databaseHooks:{
      user:{create:{before:async(user:{email:string;emailVerified:boolean})=>user.emailVerified && await pending(user.email)}},
      session:{create:{before:async(session:{userId:string})=>{
        const users=await config.catalog.query<{email:string;emailVerified:number}>(sql('SELECT email,emailVerified FROM auth_user WHERE id=?',session.userId));
        if(!users[0]?.emailVerified)return false;
        const rows=await config.catalog.query<{status:string;auth_version:number}>(sql(`SELECT status,auth_version FROM catalog_users WHERE identity_issuer='better-auth' AND identity_subject=?`,session.userId));
        if(rows[0])return rows[0].status==='active'?{data:{...session,platformVersion:rows[0].auth_version}}:false;
        return await pending(users[0].email)?{data:{...session,platformVersion:1}}:false;
      }}},
    },
  } satisfies BetterAuthOptions;
}
export function createAuth(config: AuthConfiguration) { return betterAuth(authOptions(config)); }
