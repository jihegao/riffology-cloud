import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import type { Database, Statement } from '../../services/catalog/database.ts';

export class SqliteCatalog implements Database {
  readonly sqlite: DatabaseSync;
  failAt = -1;
  loseCommitResponse = false;
  constructor(path = ':memory:', migrate = true) {
    this.sqlite = new DatabaseSync(path);
    this.sqlite.exec('PRAGMA foreign_keys=ON');
    if (migrate) {
      this.sqlite.exec(readFileSync(new URL('../../services/catalog/migrations/0001_catalog.sql', import.meta.url), 'utf8'));
      this.sqlite.exec(readFileSync(new URL('../../services/catalog/migrations/0003_provisioning.sql', import.meta.url), 'utf8'));
      this.sqlite.exec(readFileSync(new URL('../../services/catalog/migrations/0004_operator_invitations.sql', import.meta.url), 'utf8'));
      this.sqlite.exec(readFileSync(new URL('../../services/catalog/migrations/0005_initial_operator.sql', import.meta.url), 'utf8'));
      this.sqlite.exec(readFileSync(new URL('../../services/catalog/migrations/0006_model_catalog.sql', import.meta.url), 'utf8'));
      this.sqlite.exec(readFileSync(new URL('../../services/catalog/migrations/0007_model_content_checks.sql', import.meta.url), 'utf8'));
      this.sqlite.exec(readFileSync(new URL('../../services/catalog/migrations/0010_project_budget_routes.sql', import.meta.url), 'utf8'));
      this.sqlite.exec(readFileSync(new URL('../../services/catalog/migrations/0012_project_archives.sql', import.meta.url), 'utf8'));
    }
  }
  async query<T>(s: Statement): Promise<T[]> { return this.sqlite.prepare(s.sql).all(...s.values) as T[]; }
  async batch(statements: Statement[]): Promise<void> {
    this.sqlite.exec('BEGIN IMMEDIATE');
    try {
      for (let i = 0; i < statements.length; i++) {
        if (i === this.failAt) throw new Error('injected SQL failure');
        const s = statements[i]; this.sqlite.prepare(s.sql).run(...s.values);
      }
      this.sqlite.exec('COMMIT');
    } catch (error) { this.sqlite.exec('ROLLBACK'); throw error; }
    if (this.loseCommitResponse) throw new Error('lost committed response');
  }
  seed(user: string) {
    const now = Date.now();
    this.sqlite.prepare(`INSERT INTO catalog_users(id,identity_issuer,identity_subject,normalized_email,created_at,updated_at) VALUES (?,'test-only',?,?,?,?)`).run(user,user,`${user}@example.test`,now,now);
    this.sqlite.prepare(`INSERT INTO catalog_tenants(id,owner_user_id,created_at,updated_at) VALUES (?,?,?,?)`).run(`tenant-${user}`,user,now,now);
    this.sqlite.prepare(`INSERT INTO catalog_memberships(tenant_id,user_id,created_at,updated_at) VALUES (?,?,?,?)`).run(`tenant-${user}`,user,now,now);
  }
  count(table: string) { return Number(this.sqlite.prepare(`SELECT count(*) AS n FROM ${table}`).get()!.n); }
}
