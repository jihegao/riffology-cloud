import test from "node:test";
import assert from "node:assert/strict";
import { modelPayload } from "../../services/model-proxy/gaoagent-model-policy.mjs";
const valid = {
  model: "gpt-6-luna",
  input: [],
  tools: [{ type: "function", name: "knowledge_search" }],
  stream: true,
  store: false,
  max_output_tokens: 2048,
  reasoning: { effort: "low" },
};
test("broker policy fixes Luna and explicit caching without the old retention parameter", () => {
  const result = modelPayload(valid);
  assert.deepEqual(result.prompt_cache_options, { mode: "explicit" });
  assert.equal(result.prompt_cache_retention, undefined);
  assert.equal(modelPayload({ ...valid, model: "gpt-5.6-luna" }), null);
  assert.equal(
    modelPayload({ ...valid, prompt_cache_retention: "in_memory" }),
    null,
  );
});
test("broker policy rejects non-object payloads, hosted tools and project write authority", () => {
  for (const value of [
    null,
    [],
    { ...valid, tools: {} },
    { ...valid, tools: [{ type: "web_search" }] },
    { ...valid, tools: [{ type: "function", name: "project_bash" }] },
    { ...valid, base_url: "https://other.test" },
  ])
    assert.equal(modelPayload(value), null);
});
