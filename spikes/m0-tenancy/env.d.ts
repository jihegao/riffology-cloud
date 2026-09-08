/* eslint-disable */
interface __BaseEnv_M0TenancyEnv {
  TENANCY: DurableObjectNamespace<import("./index").TenancyCoordinator>;
  CHECKPOINTS: R2Bucket;
  ENVIRONMENT: "staging";
  PROTOCOL_VERSION: "m0-v1";
  M0_PROBE_TOKEN: string;
}
declare namespace Cloudflare {
  interface GlobalProps {
    mainModule: typeof import("./index");
    durableNamespaces: "TenancyCoordinator";
  }
  interface Env extends __BaseEnv_M0TenancyEnv {}
}
interface M0TenancyEnv extends __BaseEnv_M0TenancyEnv {}
