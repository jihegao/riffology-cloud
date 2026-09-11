/** The executable Tool Ledger schema. Release evidence imports this same
 * object, so the reported version and digest describe the SQL used by the DO. */
export const TOOL_LEDGER_SCHEMA=Object.freeze({
  version:1,
  sql:`CREATE TABLE IF NOT EXISTS tool_commands (
      command_id TEXT PRIMARY KEY, turn_id TEXT NOT NULL, dispatch_id TEXT NOT NULL, scope_json TEXT NOT NULL,
      digest TEXT NOT NULL, deadline_at INTEGER NOT NULL, operation TEXT NOT NULL,
      command_json TEXT, status TEXT NOT NULL CHECK(status IN ('accepted','dispatched','unknown','completed','failed','cancelled')),
      effect_id TEXT UNIQUE, accepted_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      dispatched_at INTEGER, unknown_at INTEGER, last_observed_at INTEGER, finished_at INTEGER, outcome TEXT, error_code TEXT,
      result_json TEXT, receipt_digest TEXT,
      CHECK((status='accepted' AND effect_id IS NULL AND dispatched_at IS NULL) OR
            (status IN ('dispatched','unknown') AND effect_id IS NOT NULL) OR
            status IN ('completed','failed','cancelled')),
      CHECK((status IN ('completed','failed','cancelled') AND finished_at IS NOT NULL AND outcome=status AND command_json IS NULL AND result_json IS NOT NULL AND receipt_digest IS NOT NULL) OR
            (status NOT IN ('completed','failed','cancelled') AND finished_at IS NULL AND outcome IS NULL AND error_code IS NULL AND result_json IS NULL AND receipt_digest IS NULL AND command_json IS NOT NULL))
    ) STRICT;
    CREATE UNIQUE INDEX IF NOT EXISTS tool_one_active_per_turn ON tool_commands(turn_id) WHERE status IN ('accepted','dispatched','unknown');
    CREATE TABLE IF NOT EXISTS tool_command_intents (command_id TEXT PRIMARY KEY, intent_digest TEXT NOT NULL) STRICT;`,
});
