// MIT. Private merchant plans, exact snapshots, original Cube probes and native buyer preparation.
import { join, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createUpstreamHandlers } from '../../sf30-seller-sdk/upstream.mjs';
import { createCubePaidHandler } from '../adapter.mjs';
import { renderCubeQuery } from '../cube-template.mjs';
import { prepareReview } from '../../sf88-operator-buyer-cli/prepare.mjs';
import { inspectCubeMetadata, fail } from './metadata.mjs';
import { compileCubeMerchantPlan, compileCubeUpstream } from './plan.mjs';
import { absolute, privateDirectory, readBytes, writeNew, newDirectory, syncDirectory,
  parse, json, sha256, fileBinding, readBoundFiles, recordedFiles } from './files.mjs';

export const WORKSPACE_SCHEMA = 'stellar-forge.cube-merchant-workspace.v1';
const SOURCE_FILES = ['cube-meta.json', 'merchant-plan.json'];

export async function createCubeWorkspace({ directory, metadataPath, planPath }) {
  const [metadataBytes, planBytes] = await Promise.all([readBytes(metadataPath), readBytes(planPath, { max: 1024 * 1024 })]);
  const compiled = compileCubeMerchantPlan(parse(metadataBytes, metadataPath), parse(planBytes, planPath));
  const root = await newDirectory(directory), files = { 'cube-meta.json': metadataBytes, 'merchant-plan.json': planBytes };
  for (const name of ['exports', 'probes']) await newDirectory(join(root, name));
  for (const [name, data] of Object.entries(files)) await writeNew(join(root, name), data);
  const manifest = { schema: WORKSPACE_SCHEMA, id: randomUUID(), createdAt: new Date().toISOString(),
    metadataSource: 'OPERATOR_SUPPLIED_CUBE_META',
    files: Object.fromEntries(Object.entries(files).map(([name, data]) => [name, fileBinding(data)])) };
  await writeNew(join(root, 'workspace.json'), json(manifest));
  await syncDirectory(root); await syncDirectory(dirname(root));
  return workspaceView(root, manifest, compiled, [], []);
}

export async function openCubeWorkspace(directory) {
  const root = await privateDirectory(directory);
  const manifest = parse(await readBytes(join(root, 'workspace.json'), { max: 65536, privateFile: true }), 'workspace.json');
  if (manifest.schema !== WORKSPACE_SCHEMA || !/^[a-f0-9-]{36}$/.test(manifest.id ?? '') ||
      !Number.isFinite(Date.parse(manifest.createdAt))) fail('Invalid Cube workspace manifest');
  const files = await readBoundFiles(root, manifest, SOURCE_FILES);
  const compiled = compileCubeMerchantPlan(parse(files['cube-meta.json'], 'cube-meta.json'), parse(files['merchant-plan.json'], 'merchant-plan.json'));
  return { root, manifest, files, compiled };
}

function workspaceView(root, manifest, compiled, exports, probes) {
  return { schema: WORKSPACE_SCHEMA, status: 'PREPARED', directory: root, id: manifest.id, createdAt: manifest.createdAt,
    serviceName: compiled.serviceName, publicOrigin: compiled.publicOrigin,
    metadataSha256: manifest.files['cube-meta.json'].sha256, planSha256: manifest.files['merchant-plan.json'].sha256,
    metadataSource: manifest.metadataSource, metadata: compiled.source,
    upstream: { ...compiled.adapter, reports: undefined, allowLoopback: compiled.allowLoopback },
    reportCount: compiled.reports.length, reports: structuredClone(compiled.reports),
    exports: exports.map(receipt => ({ ...receipt, status: 'RECORDED', filesRevalidated: false })),
    probes: probes.map(receipt => ({ ...receipt, status: 'RECORDED', filesRevalidated: false })) };
}
export async function inspectCubeWorkspace(directory) {
  const saved = await openCubeWorkspace(directory);
  const [exports, probes] = await Promise.all([recordedFiles(join(saved.root, 'exports')), recordedFiles(join(saved.root, 'probes'))]);
  for (const receipt of [...exports, ...probes]) if (receipt.workspaceId !== saved.manifest.id ||
      receipt.metadataSha256 !== saved.manifest.files['cube-meta.json'].sha256 ||
      receipt.planSha256 !== saved.manifest.files['merchant-plan.json'].sha256) fail('Receipt is not bound to this merchant plan');
  return workspaceView(saved.root, saved.manifest, saved.compiled, exports, probes);
}

/** Capture only /meta using the maintained upstream transport and environment credential binding. */
export async function captureCubeMetadata({ upstream, destination, metaPath = '/cubejs-api/v1/meta', env = process.env, lookup }) {
  const checked = compileCubeUpstream(upstream);
  if (typeof metaPath !== 'string' || metaPath.includes(':')) fail('Cube metadata path must be fixed');
  const config = { schema: 'stellar-forge.seller-upstreams.v1', bindings: { cubeMeta: {
    origin: checked.config.origin, path: metaPath, method: 'GET', query: [],
    headerEnv: { Authorization: checked.config.authEnv }, responseMode: 'json',
    timeoutMs: checked.config.timeoutMs, maxResponseBytes: 1048576, maxInFlight: 1,
  } } };
  const handler = createUpstreamHandlers(config, { allowLoopback: checked.allowLoopback, env, ...(lookup ? { lookup } : {}) }).cubeMeta;
  const response = await handler({ method: 'GET', url: new URL('http://127.0.0.1/__cube_metadata'), query: {}, pathParams: {}, headers: {}, body: undefined });
  if (response.status !== 200) fail(`Cube metadata request returned ${response.status}`);
  const data = Buffer.from(response.body), metadata = inspectCubeMetadata(parse(data, 'Cube /meta response'));
  await writeNew(destination, data); await syncDirectory(dirname(absolute(destination)));
  return { schema: 'stellar-forge.cube-metadata-capture.v1', status: 'SAVED', destination: absolute(destination),
    sourceUrl: checked.config.origin + metaPath, capturedAt: new Date().toISOString(), ...fileBinding(data),
    cubeCount: metadata.cubeCount, memberCount: metadata.memberCount };
}

/** Merchant-owned backend read of one saved example; this never invokes a buyer or payment. */
export async function probeCubeReport({ directory, reportId, outputDirectory, env = process.env, lookup }) {
  const saved = await openCubeWorkspace(directory), report = saved.compiled.reports.find(value => value.id === reportId);
  if (!report) fail('Select a report ID from the saved merchant plan');
  const handler = createCubePaidHandler(saved.compiled.adapter, { allowLoopback: saved.compiled.allowLoopback, env, ...(lookup ? { lookup } : {}) });
  const out = await newDirectory(outputDirectory);
  const started = performance.now(), response = await handler({ method: 'GET', url: new URL(report.exampleUrl), query: report.queryParams });
  const body = Buffer.isBuffer(response.body) || response.body instanceof Uint8Array ? Buffer.from(response.body) : json(response.body);
  const receipt = { schema: 'stellar-forge.cube-merchant-probe.v1', id: randomUUID(),
    workspaceId: saved.manifest.id, metadataSha256: saved.manifest.files['cube-meta.json'].sha256,
    planSha256: saved.manifest.files['merchant-plan.json'].sha256, reportId,
    mode: 'MERCHANT_BACKEND_READ', completedAt: new Date().toISOString(),
    httpStatus: response.status, durationMs: Math.round(performance.now() - started),
    sourceUrl: saved.compiled.adapter.origin + saved.compiled.adapter.path,
    querySha256: sha256(json(report.renderedExample)), outputDirectory: out,
    response: { file: 'response.json', ...fileBinding(body) },
    ...(response.status === 200 ? { rowCount: parse(body, 'Cube result').data.length } : {}) };
  await writeNew(join(out, 'response.json'), body); await writeNew(join(out, 'probe.json'), json(receipt));
  await syncDirectory(out); await syncDirectory(dirname(out));
  await writeNew(join(saved.root, 'probes', receipt.id + '.json'), json(receipt));
  await syncDirectory(join(saved.root, 'probes'));
  return { ...receipt, status: response.status === 200 ? 'SUCCEEDED' : 'UPSTREAM_FAILED', filesRevalidated: true };
}

/** Reuse SF88's saved-catalog preparation with an explicit original payment option and intent. */
export async function prepareCubeBuyer({ compiled, catalogBytes, reportId, acceptIndex, intentId, inputs, destination }) {
  const rowIndex = compiled.reports.findIndex(value => value.id === reportId);
  if (rowIndex < 0) fail('Select a report ID from the package');
  const report = compiled.reports[rowIndex], query = inputs ?? report.queryParams;
  const url = new URL(report.path, compiled.publicOrigin);
  renderCubeQuery(compiled.catalog, { method: 'GET', url, query });
  for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
  const prepared = prepareReview(catalogBytes, { rowIndex, acceptIndex, intentId, url: url.href, method: 'GET' });
  await writeNew(destination, prepared.data); await syncDirectory(dirname(absolute(destination)));
  return { schema: 'stellar-forge.cube-buyer-preparation.v1', status: 'PREPARED', destination: absolute(destination),
    reportId, acceptIndex, intentId, requestUrl: url.href, configSha256: prepared.configSha256,
    acceptedTerms: prepared.draft.operation.expect, inputSource: inputs === undefined ? 'SAVED_MERCHANT_EXAMPLE' : 'OPERATOR_SUPPLIED_INPUTS' };
}
