#!/usr/bin/env node
import {invitedRunsAdmissionClosed,deployedInvitedRunsAdmissionClosed} from './invited-runs-gate.mjs';

const SHA40 = /^[a-f0-9]{40}$/;
const IMAGE = /^[A-Za-z0-9./:_-]+@sha256:[a-f0-9]{64}$/;
const GATES = ['M2_TURNS_ENABLED', 'M3_SERVICE_ENABLED', 'M3_PREVIEW_ENABLED', 'M4_SIMULATION_ENABLED'];
const R2_BINDINGS = ['WORKSPACE_CHECKPOINTS', 'MODEL_CONTENT'];
const check = (name, passed, detail) => ({ name, status: passed ? 'passed' : 'blocked', ...(passed || !detail ? {} : { detail }) });
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function configuredContainers(config) {
  const rows = config?.containers;
  return Array.isArray(rows) && rows.length === 5 && rows.every(row => object(row) && typeof row.class_name === 'string' && typeof row.name === 'string' && IMAGE.test(row.image) && row.instance_type === 'basic' && row.max_instances === 1) ? rows : null;
}

function versionBindings(version) {
  const rows = version?.resources?.bindings;
  return Array.isArray(rows) ? rows : null;
}

function versionPlainText(version, name) {
  return versionBindings(version)?.find(row => row?.type === 'plain_text' && row.name === name)?.text;
}

function validateInstances(input, appIds, requireInactive) {
  const groups = input?.apps;
  if (!Array.isArray(groups) || groups.length !== appIds.size || new Set(groups.map(group => group?.appId)).size !== appIds.size || groups.some(group => !appIds.has(group?.appId))) return { check: check('instances', false, 'complete-paginated-instance-read-required-for-each-container-app'), value: null };
  let rows = [], normalized = [];
  for (const group of groups) {
    const pages = group.pages;
    if (!Array.isArray(pages) || pages.length === 0) return { check: check('instances', false, 'instance-page-missing-for-container-app'), value: null };
    let expectedPageToken = null, appRows = []; const seenTokens = new Set();
    for (const [index, page] of pages.entries()) {
      const info = page?.result_info;
      if (!object(page) || !Array.isArray(page.instances) || !object(info) || !Object.hasOwn(info, 'page_token') || !Object.hasOwn(info, 'next_page_token')) return { check: check('instances', false, 'instance-page-result-info-missing'), value: null };
      if (info.page_token !== expectedPageToken || !(info.page_token === null || typeof info.page_token === 'string') || !(info.next_page_token === null || typeof info.next_page_token === 'string')) return { check: check('instances', false, 'instance-pagination-token-chain-invalid'), value: null };
      if (seenTokens.has(info.page_token) || (index < pages.length - 1 && info.next_page_token === null)) return { check: check('instances', false, 'instance-pagination-repeated-or-terminated'), value: null };
      seenTokens.add(info.page_token);
      if (!page.instances.every(row => object(row) && typeof row.state === 'string')) return { check: check('instances', false, 'instance-row-invalid'), value: null };
      appRows = appRows.concat(page.instances); expectedPageToken = info.next_page_token;
    }
    if (expectedPageToken !== null) return { check: check('instances', false, 'instance-pagination-incomplete'), value: null };
    rows = rows.concat(appRows); normalized.push({ appId: group.appId, pages: structuredClone(pages), rows: appRows, nonInactive: appRows.filter(row => row.state !== 'inactive').length });
  }
  const nonInactive = rows.filter(row => row.state !== 'inactive').length;
  if (requireInactive === true && nonInactive !== 0) return { check: check('instances', false, 'non-inactive-container-instance'), value: { apps: normalized, rows, nonInactive } };
  return { check: check('instances', true), value: { apps: normalized, rows, nonInactive } };
}

/** Validate a phase-one inventory read before or after deployment.
 * This is observational only: it does not query Cloudflare or mutate state.
 */
export function validatePhase1Inventory({ config, version, deployment, apps, instances, workerSha, gatesOpen, requireInactive = false }) {
  const checks = [];
  const containers = configuredContainers(config);
  checks.push(check('config-containers', containers !== null && new Set(containers.map(row => row.class_name)).size === 5 && containers.some(row => row.class_name === 'SimulationSandbox')));
  checks.push(check('worker-sha', SHA40.test(workerSha ?? '') && version?.annotations?.['workers/tag'] === `source-${workerSha}`));
  const versions = deployment?.versions;
  checks.push(check('deployment', Array.isArray(versions) && versions.length === 1 && versions[0]?.version_id === version?.id && versions[0]?.percentage === 100, 'require-one-unique-100-percent-version'));

  const expectedGate = gatesOpen === true ? 'true' : gatesOpen === false ? 'false' : null;
  checks.push(check('gates', expectedGate !== null && GATES.every(name => versionPlainText(version, name) === expectedGate), 'four-gate-values-must-match-gatesOpen'));
  const configuredRunPolicy=config?.vars?.INVITED_RUNS_POLICY_JSON;
  checks.push(check('invited-runs-admission-closed',invitedRunsAdmissionClosed(config?.vars)&&deployedInvitedRunsAdmissionClosed(versionBindings(version)??[])&&(configuredRunPolicy===undefined||versionPlainText(version,'INVITED_RUNS_POLICY_JSON')===configuredRunPolicy),'independent-run-admission-must-remain-closed-with-original-configured-policy'));
  const simulation = containers?.find(row => row.class_name === 'SimulationSandbox');
  checks.push(check('simulation-image', simulation !== undefined && versionPlainText(version, 'M4_SIMULATION_IMAGE') === simulation.image && IMAGE.test(simulation.image ?? '')));
  checks.push(check('quota', versionPlainText(version, 'TENANT_QUOTA_POLICY_VERSION') === 'phase1-preview-simulation-v1' && versionPlainText(version, 'TENANT_QUOTA_CAPACITY') === '2', 'phase1-quota-policy-and-capacity-mismatch'));

  const bindings = versionBindings(version);
  const simulationBinding = bindings?.filter(row => row?.name === 'SIMULATION_SANDBOX');
  const simulationExport = version?.resources?.script_runtime?.exports?.SimulationSandbox;
  checks.push(check('simulation-binding', simulationBinding?.length === 1 && simulationBinding[0].class_name === 'SimulationSandbox' && simulationExport?.type === 'durable-object' && simulationExport?.storage === 'sqlite' && simulationExport?.container === simulation?.name, 'simulation-binding-export-mismatch'));

  const r2 = config?.r2_buckets;
  const r2Valid = Array.isArray(r2) && R2_BINDINGS.every(name => r2.some(row => row?.binding === name && typeof row.bucket_name === 'string' && row.bucket_name.length > 0)) && new Set(r2.filter(row => R2_BINDINGS.includes(row?.binding)).map(row => row.bucket_name)).size === R2_BINDINGS.length;
  const versionR2Valid = r2Valid && R2_BINDINGS.every(name => {
    const expected = r2.find(row => row.binding === name);
    return versionBindings(version)?.some(row => row?.type === 'r2_bucket' && row.name === name && (row.bucket_name ?? row.bucketName) === expected.bucket_name);
  });
  checks.push(check('r2', versionR2Valid, 'workspace-checkpoint-and-model-content-r2-config-required'));

  const runtimeContainers = version?.resources?.script_runtime?.containers;
  const runtimeContainerValid = containers !== null && Array.isArray(runtimeContainers) && runtimeContainers.length === containers.length && containers.every(container => runtimeContainers.filter(row => row?.class_name === container.class_name && row?.name === container.name).length === 1);
  checks.push(check('version-containers', runtimeContainerValid, 'version-must-register-all-five-configured-containers'));

  const actualApps = Array.isArray(apps) ? apps : null;
  const appCheck = containers !== null && actualApps !== null && containers.every(container => {
    const matches = actualApps.filter(app => app?.name === container.name);
    return matches.length === 1 && typeof matches[0]?.id === 'string' && matches[0].id.length > 0 && matches[0].max_instances === 1 && matches[0].configuration?.image === container.image && matches[0].configuration.vcpu === 0.25 && matches[0].configuration.memory_mib === 1024 && matches[0].configuration.disk?.size_mb === 4000;
  }) && actualApps.length === containers.length;
  checks.push(check('container-apps', appCheck, 'each-configured-container-must-match-one-app-image-and-basic-resource-limits'));
  const appIds = new Set(actualApps?.map(app => app?.id).filter(value => typeof value === 'string') ?? []);
  const instanceResult = validateInstances(instances, appIds, requireInactive === true);
  checks.push(instanceResult.check);
  return { schemaVersion: 1, status: checks.every(row => row.status === 'passed') ? 'passed' : 'blocked', checks, instances: instanceResult.value };
}
