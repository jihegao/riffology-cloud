/** Minimal transaction port shared by D1 and SQL integration tests. */
export type SqlValue = string | number | null;
export interface Statement { sql: string; values: SqlValue[] }
export interface Database {
  query<T>(statement: Statement): Promise<T[]>;
  batch(statements: Statement[]): Promise<void>;
}
export function statement(sql: string, ...values: SqlValue[]): Statement { return { sql, values }; }

/** No read-replica session: every permission read must observe the primary. */
export function catalogDatabase(db: D1Database): Database {
  return {
    async query<T>(s: Statement) { return (await db.prepare(s.sql).bind(...s.values).all<T>()).results; },
    async batch(statements: Statement[]) {
      await db.batch(statements.map(s => db.prepare(s.sql).bind(...s.values)));
    },
  };
}
