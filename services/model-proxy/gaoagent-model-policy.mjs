const fields = new Set([
  "model",
  "input",
  "instructions",
  "tools",
  "tool_choice",
  "parallel_tool_calls",
  "reasoning",
  "text",
  "stream",
  "store",
  "max_output_tokens",
  "include",
]);
export function modelPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).some((k) => !fields.has(k))) return null;
  if (
    value.model !== "gpt-6-luna" ||
    value.stream !== true ||
    value.store !== false ||
    value.max_output_tokens !== 2048 ||
    value.reasoning?.effort !== "low" ||
    !Array.isArray(value.input) ||
    !Array.isArray(value.tools)
  )
    return null;
  if (
    value.tools.some(
      (t) =>
        !t ||
        t.type !== "function" ||
        !["knowledge_search", "knowledge_get"].includes(t.name),
    )
  )
    return null;
  return {
    ...value,
    prompt_cache_options: { mode: "explicit" },
    service_tier: "default",
  };
}
