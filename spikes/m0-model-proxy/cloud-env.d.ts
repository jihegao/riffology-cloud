/* eslint-disable */
// Bindings for the existing staging fixture and the explicit go_live profile.
// No secret values are embedded; M0_GO_API_KEY is absent from fixture deployment.
interface __BaseEnv_M0ModelProxyEnv {
	M0_MODEL_MODE: "fixture-only" | "go-live-only";
	M0_CONTROL_ORIGIN: "https://riffology-m0-model-proxy-staging.jihe-gao.workers.dev" | "https://riffology-m0-model-proxy-go-live-staging.jihe-gao.workers.dev";
	PROTOCOL_VERSION: "m0-model-proxy-v1";
	M0_PROBE_TOKEN: string;
	M0_GO_API_KEY?: string;
	MODEL_RUNS: DurableObjectNamespace<import("./cloud").M0ModelProxyRun>;
}
declare namespace Cloudflare {
	interface GlobalProps {
		mainModule: typeof import("./cloud");
		durableNamespaces: "M0ModelProxyRun";
	}
	interface Env extends __BaseEnv_M0ModelProxyEnv {}
}
interface M0ModelProxyEnv extends __BaseEnv_M0ModelProxyEnv {}
