import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectCatalog } from '../../services/catalog/projects.ts';
import { SqliteCatalog } from '../m1/sqlite-database.ts';

const owner = { userId: 'alpha', authVersion: 1 };
const otherOwner = { userId: 'bravo', authVersion: 1 };
const body = { title: 'Maintenance fixture', starterVersion: 'blank-v1' };

function fixture() {
  const db = new SqliteCatalog();
  db.seed('alpha');
  db.seed('bravo');
  return { db, catalog: new ProjectCatalog(db, new Set(['blank-v1'])) };
}

test('maintenance resolves a non-ready workspace while ordinary turns remain gated', async () => {
  const { db, catalog } = fixture();
  try {
    const { project } = await catalog.create(owner, 'tenant-alpha', 'maintenance', body);
    await assert.rejects(catalog.workspace(owner, project.workspace_id), { message: 'not_ready' });
    assert.deepEqual(await catalog.maintenanceWorkspace(owner, project.workspace_id), {
      tenantId: 'tenant-alpha',
      projectId: project.id,
      workspaceId: project.workspace_id,
      workspaceGeneration: 1,
    });
  } finally {
    db.sqlite.close();
  }
});

test('maintenance scope keeps tenant, ownership, auth version, revocation, and generation fences', async () => {
  const { db, catalog } = fixture();
  try {
    const { project } = await catalog.create(owner, 'tenant-alpha', 'maintenance', body);
    await assert.rejects(catalog.maintenanceWorkspace(otherOwner, project.workspace_id), { message: 'not_found' });

    db.sqlite.exec("UPDATE catalog_users SET auth_version=2 WHERE id='alpha'");
    await assert.rejects(catalog.maintenanceWorkspace(owner, project.workspace_id), { message: 'not_found' });

    db.sqlite.exec("UPDATE catalog_memberships SET status='revoked' WHERE tenant_id='tenant-alpha' AND user_id='alpha'");
    await assert.rejects(catalog.maintenanceWorkspace({ userId: 'alpha', authVersion: 2 }, project.workspace_id), { message: 'not_found' });

    db.sqlite.exec("UPDATE catalog_memberships SET status='active' WHERE tenant_id='tenant-alpha' AND user_id='alpha'");
    db.sqlite.prepare("UPDATE catalog_projects SET generation=2 WHERE id=?").run(project.id);
    await assert.rejects(catalog.maintenanceWorkspace({ userId: 'alpha', authVersion: 2 }, project.workspace_id), { message: 'not_found' });
  } finally {
    db.sqlite.close();
  }
});
