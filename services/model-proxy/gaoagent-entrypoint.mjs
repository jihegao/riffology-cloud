// Export GaoAgentModel from riffoid's existing gateway entrypoint. No public HTTP route.
// Bind the GaoAgent Worker's MODEL service specifically to this named entrypoint.
import { WorkerEntrypoint } from "cloudflare:workers";
import { modelPayload } from "./gaoagent-model-policy.mjs";
export class GaoAgentModel extends WorkerEntrypoint {
  async fetch(request) {
    if (this.env.GAOAGENT_MODEL_ENABLED !== "true")
      return Response.json(
        { error: "gaoagent_model_disabled" },
        { status: 503 },
      );
    if (
      request.method !== "POST" ||
      new URL(request.url).pathname !== "/v1/responses"
    )
      return new Response("Denied", { status: 403 });
    if (!request.body) return new Response("Invalid body", { status: 400 });
    const reader = request.body.getReader(),
      chunks = [];
    let n = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      n += value.length;
      if (n + 4096 > 12000) {
        await reader.cancel();
        return new Response("Too large", { status: 413 });
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(n);
    let offset = 0;
    for (const c of chunks) {
      bytes.set(c, offset);
      offset += c.length;
    }
    let p;
    try {
      p = JSON.parse(new TextDecoder().decode(bytes));
    } catch {
      return new Response("Invalid JSON", { status: 400 });
    }
    const approved = modelPayload(p);
    if (!approved) return new Response("Denied", { status: 403 });
    const profile = JSON.parse(this.env.PRODUCTION_MODEL_PROFILE_JSON),
      g = profile.gateway;
    if (
      !/^[a-f0-9]{32}$/.test(g.accountId) ||
      !/^[a-z0-9-]+$/.test(g.gatewayId)
    )
      return new Response("Unavailable", { status: 503 });
    const upstream = await fetch(
      `https://gateway.ai.cloudflare.com/v1/${g.accountId}/${g.gatewayId}/openai/responses`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.env.PRODUCTION_OPENAI_API_KEY}`,
          "cf-aig-authorization": `Bearer ${this.env.PRODUCTION_AI_GATEWAY_TOKEN}`,
          "cf-aig-skip-cache": "true",
          "cf-aig-collect-log-payload": "false",
          "cf-aig-max-attempts": "1",
        },
        body: JSON.stringify(approved),
        signal: AbortSignal.any([request.signal, AbortSignal.timeout(30000)]),
        redirect: "manual",
      },
    );
    if (upstream.status >= 300 && upstream.status < 400)
      return new Response("Upstream redirect denied", { status: 502 });
    return upstream;
  }
}
