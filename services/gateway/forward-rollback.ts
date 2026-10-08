import gatewayHandler from './index.ts';
import {json} from './http.ts';
// Keep EVERY production Durable Object export, including EntryReplayGuard.
// This entrypoint does not delete, rename, migrate or initialize a namespace.
export * from './index.ts';
type Env=Parameters<typeof gatewayHandler.fetch>[1];
const ORIGINAL_APP_ORIGIN='https://m1.riff-demo.gaojihe.cn';
/** Forward rollback template. Actual namespace identity/migration history and
 * full bindings/assets must be frozen separately before any production use. */
export default {
  ...gatewayHandler,
  async fetch(request:Request,env:Env):Promise<Response>{
    if(env.APP_ORIGIN!==ORIGINAL_APP_ORIGIN||
      ['APP_TRANSPORT_ORIGIN','TWO_ACCOUNT_AUTH_MODE','LEGACY_RECOVERY_ORIGIN','LEGACY_RECOVERY_UNTIL'].some(name=>Object.hasOwn(env,name))||
      typeof env.ENTRY_REPLAY?.getByName!=='function')return json({error:'forward_rollback_configuration_incomplete'},503);
    // Use the original single-origin route/auth/assets behavior as configured.
    // Never rewrite the request URL/Origin or pretend a supplied namespace is
    // the frozen one; that identity is a required deployment-readback check.
    return await gatewayHandler.fetch(request,env);
  }
} satisfies ExportedHandler<Env>;
