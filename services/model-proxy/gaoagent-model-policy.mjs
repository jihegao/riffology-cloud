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
  "max_tool_calls",
  "include",
]);
export function modelPayload(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (Object.keys(value).some((k) => !fields.has(k))) return null;
  if (
    value.model !== "gpt-6-luna" ||
    value.stream !== true ||
    value.store !== false ||
    ![2048, 8192].includes(value.max_output_tokens) ||
    value.reasoning?.effort !== "low" ||
    !Array.isArray(value.input) ||
    !Array.isArray(value.tools)
  )
    return null;
  const hostedSearch =
    value.tools.length === 1 && value.tools[0]?.type === "web_search";
  if (hostedSearch) {
    if (
      value.tool_choice !== "required" ||
      value.max_tool_calls !== 1 ||
      value.max_output_tokens !== 2048 ||
      value.instructions !==
        "Search the web and provide a concise factual summary with citations." ||
      !Array.isArray(value.input) ||
      value.input.length !== 1 ||
      value.input[0]?.role !== "user" ||
      typeof value.input[0]?.content !== "string" ||
      !value.input[0].content.trim() ||
      Object.keys(value.input[0]).some(
        (key) => !["role", "content"].includes(key),
      ) ||
      value.input[0].content.length > 500 ||
      Object.keys(value.tools[0]).length !== 1
    )
      return null;
  } else if (
    value.tools.some(
      (t) =>
        !t ||
        t.type !== "function" ||
        !["knowledge_search", "knowledge_get", "web_search"].includes(t.name),
    )
  )
    return null;
  if (!hostedSearch && value.max_tool_calls !== undefined) return null;
  return {
    ...value,
    prompt_cache_options: { mode: "explicit" },
    service_tier: "default",
  };
}
