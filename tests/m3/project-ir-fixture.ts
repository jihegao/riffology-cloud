import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { unzipSync } from 'fflate';

export type ProjectIrFixtureOptions = { runtimeSource: string; workerSource: string; pluginVersion?: string; runtimeVersion?: string; bundle?: Uint8Array };
export const projectIrFixtureSha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
/** Uses the committed compiler 0.1.0 B1 simpack, never a handwritten Plan or
 * expected-result interpreter. Callers supply the actual shared package assets. */
export async function projectIrFixture(options: ProjectIrFixtureOptions) {
  const bundle = options.bundle ?? await readFile(new URL('../fixtures/compiler-v01/model/model.simpack', import.meta.url));
  const members = unzipSync(bundle);
  const business = JSON.parse(Buffer.from(members['business.json']!).toString('utf8'));
  const plan = JSON.parse(Buffer.from(members['plan.json']!).toString('utf8'));
  const manifest = JSON.parse(Buffer.from(members['manifest.json']!).toString('utf8'));
  const modelBytes = Buffer.from(`${JSON.stringify(business, null, 2)}\n`);
  const modelRef = `.riffoid-ir/models/${projectIrFixtureSha(modelBytes)}/business.json`;
  const bundleRef = `.riffoid-ir/bundles/${projectIrFixtureSha(bundle)}/model.simpack`;
  const runtimeRef = `.riffoid-ir/runtimes/${projectIrFixtureSha(options.runtimeSource)}/runtime.js`;
  const toolchain = { plugin: options.pluginVersion ?? '0.3.0', domainPack: 'aircraft-support-pack/v0.1', compiler: '0.1.0', businessIr: business.version, planIr: plan.plan_version, profile: plan.semantic_profile, browserRuntime: options.runtimeVersion ?? 'aircraft-support-browser/0.3.0', runtimeSha256: projectIrFixtureSha(options.runtimeSource), compilerArtifact: { wheelSha256: 'e7bcd9271dd42106b78e87176e3485b290536f5291c0440872b814fc549858f7', mode: 'portable-compilation-sdk' }, manifest };
  const artifact = { version: 'riffoid-browser-artifact/v1', modelRef, bundleRef, runtimeRef, toolchain, businessFingerprint: manifest.identity.business_fingerprint, planFingerprint: manifest.identity.plan_fingerprint, defaultSeed: business.payload.sections.$root.properties.seed ?? 0, plan, lineage: JSON.parse(Buffer.from(members['lineage.json']!).toString('utf8')) };
  const artifactBytes = Buffer.from(`${JSON.stringify(artifact, null, 2)}\n`);
  const browserArtifactRef = `.riffoid-ir/artifacts/${projectIrFixtureSha(artifactBytes)}/browser.json`;
  const files = [
    { path: modelRef, bytes: modelBytes }, { path: bundleRef, bytes: bundle },
    { path: runtimeRef, bytes: Buffer.from(options.runtimeSource) }, { path: browserArtifactRef, bytes: artifactBytes },
  ].map(({ path, bytes }) => ({ path, base64: Buffer.from(bytes).toString('base64'), sha256: projectIrFixtureSha(bytes) }));
  const registration = { schema: 'riffoid-ir.registration/v1', files, state: { draft: `${JSON.stringify(business, null, 2)}\n`, modelMode: 'ir', currentModel: { type: 'ir', ref: 'model/business-ir.draft.json', fingerprint: business.fingerprint }, toolchain }, workerSource: options.workerSource };
  return { registration, browserArtifactRef, artifact, business, plan, bundle: Uint8Array.from(bundle), runtimeSource: options.runtimeSource, workerSource: options.workerSource };
}
