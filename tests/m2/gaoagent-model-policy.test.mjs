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

test("hosted search is restricted to the fixed search request", () => {
  const search = {
    ...valid,
    input: [{ role: "user", content: "public news" }],
    tools: [{ type: "web_search" }],
    tool_choice: "required",
    max_tool_calls: 1,
    instructions:
      "Search the web and provide a concise factual summary with citations.",
  };
  assert.ok(modelPayload(search));
  assert.equal(modelPayload({ ...search, instructions: "different" }), null);
  assert.equal(modelPayload({ ...search, max_tool_calls: 2 }), null);
  assert.equal(modelPayload({ ...search, max_output_tokens: 8192 }), null);
  assert.equal(
    modelPayload({ ...search, input: [{ role: "user", content: "" }] }),
    null,
  );
  assert.equal(modelPayload({ ...valid, max_tool_calls: 1 }), null);
  assert.ok(modelPayload({ ...valid, max_output_tokens: 8192 }));
  assert.equal(modelPayload({ ...valid, max_output_tokens: 8193 }), null);
  assert.equal(
    modelPayload({ ...search, tools: [{ type: "web_search", filters: {} }] }),
    null,
  );
});
