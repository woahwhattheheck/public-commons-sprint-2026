// MIT. Browser authoring over the original Cube metadata, plans and immutable workspaces.
import { join, resolve, dirname, basename } from 'node:path';
import { readdir, unlink, rename, rm, realpath } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { inspectCubeMetadata } from '../onboarding/metadata.mjs';
import { compileCubeMerchantPlan, PLAN_SCHEMA } from '../onboarding/plan.mjs';
import { createCubeWorkspace, openCubeWorkspace, inspectCubeWorkspace,
  probeCubeReport } from '../onboarding/workspace.mjs';
import { exportCubePackage, openCubePackage, inspectCubePackage,
  prepareCubePackageBuyer } from '../onboarding/package.mjs';
import { privateDirectory, readBytes, writeNew, newDirectory, syncDirectory,
  parse, json, sha256, fileBinding, readBoundFiles } from '../onboarding/files.mjs';
import { openCubeEditions } from './editions.mjs';
import { acquirePrivateDirectoryWriter } from '../../sf30-seller-sdk/operations/history.mjs';

const SCHEMA = 'stellar-forge.cube-browser-workspace.v1';
const ID = /^[a-z][a-z0-9-]{0,79}$/;
const PUBLIC_FILES = new Set(['catalog.json', 'reports.json', 'openapi.json', 'BUYER.md']);
const PACKAGE_FILES = new Set([...PUBLIC_FILES, 'cube-meta.json', 'merchant-plan.json',
  'cube-adapter.json', 'seller-service.json', 'launch.mjs', 'README.md', 'package.json']);
const id = value => {
  if (typeof value !== 'string' || !ID.test(value)) throw new TypeError('Select an existing workspace item');
  return value;
};
const key = prefix => `${prefix}-${Date.now()}-${randomUUID()}`;
const emptyPlan = () => ({ schema: PLAN_SCHEMA, serviceName: '', publicOrigin: '', tags: ['analytics'],
  upstream: { origin: '', path: '/cubejs-api/v1/load', authEnv: 'CUBE_API_AUTHORIZATION',
    timeoutMs: 10000, maxResponseBytes: 262144, maxInFlight: 8, maxRows: 1000 },
  payment: { scheme: 'exact', network: 'stellar:testnet', asset: '', payTo: '', amount: '', maxTimeoutSeconds: 60 },
  reports: {} });

/** Create once from a real saved /meta response; reopen without the original input paths. */
export async function openCubeWorkbench({ directory, metadataPath, planPath } = {}) {
  if (typeof directory !== 'string' || !directory) throw new TypeError('Supply a private workspace directory');
  const requested = resolve(directory);
  const root = join(await realpath(dirname(requested)), basename(requested));
  // Own even a new target before reading or initializing its first snapshot.
  // Canonical parents collapse path aliases without changing the source format.
  const writerDirectory = join(dirname(root), '.cube-workbench-writer-' + sha256(Buffer.from(root)).slice(0, 32));
  try { await newDirectory(writerDirectory); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await privateDirectory(writerDirectory);
  const writer = await acquirePrivateDirectoryWriter(writerDirectory);
  try { return await openOwnedCubeWorkbench({ root, metadataPath, planPath, writer }); }
  catch (error) { await writer.release().catch(() => {}); throw error; }
}

async function openOwnedCubeWorkbench({ root, metadataPath, planPath, writer }) {
  let exists = true;
  try { await privateDirectory(root); }
  catch (error) { if (error.code !== 'ENOENT') throw error; exists = false; }
  if (!exists) {
    if (!metadataPath) throw new TypeError('A new workspace requires the actual Cube /meta JSON file');
    const metadataBytes = await readBytes(resolve(metadataPath));
    const metadata = parse(metadataBytes, 'Cube metadata');
    inspectCubeMetadata(metadata);
    const sourceFiles = { 'cube-meta.json': metadataBytes };
    if (planPath) {
      const planBytes = await readBytes(resolve(planPath), { max: 1024 * 1024 });
      compileCubeMerchantPlan(metadata, parse(planBytes, 'Merchant plan'));
      sourceFiles['initial-plan.json'] = planBytes;
    }
    await newDirectory(root);
    for (const name of ['versions', 'exports', 'probes', 'buyers']) await newDirectory(join(root, name));
    for (const [name, bytes] of Object.entries(sourceFiles)) await writeNew(join(root, name), bytes);
    await writeNew(join(root, 'workbench.json'), json({ schema: SCHEMA, id: randomUUID(),
      createdAt: new Date().toISOString(), files: Object.fromEntries(Object.entries(sourceFiles).map(([name, bytes]) => [name, fileBinding(bytes)])) }));
    await syncDirectory(root);
  }
  const manifest = parse(await readBytes(join(root, 'workbench.json'), { max: 65536, privateFile: true }), 'workbench.json');
  if (manifest.schema !== SCHEMA || !/^[a-f0-9-]{36}$/.test(manifest.id ?? '') ||
      !Number.isFinite(Date.parse(manifest.createdAt))) throw new TypeError('Invalid Cube browser workspace');
  const expected = ['cube-meta.json', ...(Object.hasOwn(manifest.files ?? {}, 'initial-plan.json') ? ['initial-plan.json'] : [])];
  const originals = await readBoundFiles(root, manifest, expected);
  for (const name of ['versions', 'exports', 'probes', 'buyers']) await privateDirectory(join(root, name));
  if (metadataPath && sha256(await readBytes(resolve(metadataPath))) !== manifest.files['cube-meta.json'].sha256)
    throw new TypeError('Reopen without --metadata, then import or capture the changed source in Schema refresh');
  if (planPath && sha256(await readBytes(resolve(planPath), { max: 1024 * 1024 })) !== manifest.files['initial-plan.json']?.sha256)
    throw new TypeError('This workspace already exists; import the changed plan in the browser');
  const metadata = parse(originals['cube-meta.json'], 'Cube metadata'), catalog = inspectCubeMetadata(metadata);
  const initialPlan = originals['initial-plan.json'] ? parse(originals['initial-plan.json'], 'Merchant plan') : emptyPlan();
  const members = catalog.cubes.flatMap(cube => [...cube.measures, ...cube.dimensions, ...cube.segments]);
  let editions, defaultId = 'original', defaultMetadata = metadata, defaultCatalog = catalog,
    defaultPlan = initialPlan, defaultVersion = null, defaultDigest = manifest.files['cube-meta.json'].sha256,
    busy = false, closing = false, drain = Promise.resolve(), closePromise;
  const mutate = async operation => {
    if (closing) throw Object.assign(new Error('This workspace writer has closed'), { status: 409 });
    if (busy) throw Object.assign(new Error('Another workspace change is still completing'), { status: 409 });
    busy = true;
    const pending = Promise.resolve().then(operation);
    drain = pending.catch(() => {});
    try { return await pending; } finally { busy = false; }
  };
  const close = () => closePromise ??= (async () => {
    closing = true;
    await drain;
    await writer.release();
  })();
  const versionPath = value => join(root, 'versions', id(value));
  const exportPath = value => join(root, 'exports', id(value));
  const probePath = value => join(root, 'probes', id(value));

  const previewUsing = (source, plan) => {
    const compiled = compileCubeMerchantPlan(source, plan);
    return { serviceName: compiled.serviceName, publicOrigin: compiled.publicOrigin,
      metadata: compiled.source, upstream: { ...compiled.adapter, reports: undefined, allowLoopback: compiled.allowLoopback },
      reports: structuredClone(compiled.reports), reportCount: compiled.reports.length,
      openapi: compiled.openapi, offers: compiled.offers };
  };
  const preview = plan => previewUsing(defaultMetadata, plan);
  async function previewFor(plan, metadataId = defaultId) { return previewUsing((await editions.metadata(metadataId)).raw, plan); }
  async function openVersion(value) {
    const path = versionPath(value), saved = await openCubeWorkspace(path);
    const metadataId = await editions.match(saved.manifest.files['cube-meta.json'].sha256);
    return { id: value, path, saved, metadataId };
  }
  async function inspectVersion(value) {
    const item = await openVersion(value);
    return { id: value, metadataId: item.metadataId, plan: parse(item.saved.files['merchant-plan.json'], 'Saved merchant plan'),
      view: await inspectCubeWorkspace(item.path) };
  }
  async function listVersions({ before = '', limit = 20 } = {}) {
    if (before) id(before);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new TypeError('Page size must be 1–100');
    const names = (await readdir(join(root, 'versions'), { withFileTypes: true }))
      .filter(entry => entry.isDirectory() && ID.test(entry.name)).map(entry => entry.name).sort().reverse()
      .filter(name => !before || name < before);
    const page = names.slice(0, limit), items = [];
    for (const name of page) {
      try {
        const { saved, metadataId } = await openVersion(name);
        items.push({ id: name, createdAt: saved.manifest.createdAt, serviceName: saved.compiled.serviceName,
          reportCount: saved.compiled.reports.length, planSha256: saved.manifest.files['merchant-plan.json'].sha256,
          metadataId, metadataSha256: saved.manifest.files['cube-meta.json'].sha256,
          status: 'SAVED' });
      } catch (error) { items.push({ id: name, status: 'UNAVAILABLE', error: error.message }); }
    }
    return { items, next: names.length > page.length ? page.at(-1) : null };
  }
  async function save(plan, { metadataId = defaultId } = {}) {
    const source = await editions.metadata(metadataId);
    previewUsing(source.raw, plan);
    const name = key('v'), temporary = join(root, key('plan') + '.json');
    await writeNew(temporary, json(plan));
    try {
      const view = await createCubeWorkspace({ directory: versionPath(name),
        metadataPath: source.path, planPath: temporary });
      return { id: name, metadataId, plan: structuredClone(plan), view };
    } finally { await unlink(temporary); }
  }
  async function exportVersion(value) {
    const version = await openVersion(value), name = key('package');
    const receipt = await exportCubePackage({ directory: version.path, destination: exportPath(name) });
    return { id: name, version: value, receipt, package: await inspectCubePackage(exportPath(name)),
      publicFiles: [...PUBLIC_FILES], privateFiles: [...PACKAGE_FILES].filter(file => !PUBLIC_FILES.has(file)) };
  }
  async function inspectExport(value) {
    const path = exportPath(value), saved = await openCubePackage(path);
    const metadataId = await editions.match(saved.manifest.metadataSha256);
    return { id: value, metadataId, package: await inspectCubePackage(path), publicFiles: [...PUBLIC_FILES],
      privateFiles: [...PACKAGE_FILES].filter(file => !PUBLIC_FILES.has(file)) };
  }
  async function probe(value, reportId) {
    const version = await openVersion(value), name = key('probe');
    const receipt = await probeCubeReport({ directory: version.path, reportId, outputDirectory: probePath(name) });
    const bytes = await readBytes(join(probePath(name), 'response.json'), { max: 1024 * 1024, privateFile: true });
    return { id: name, version: value, receipt,
      preview: bytes.subarray(0, 32768).toString('utf8'), previewTruncated: bytes.length > 32768 };
  }
  async function buyer(value, { reportId, acceptIndex, intentId, inputs } = {}) {
    await inspectExport(value);
    const name = key('buyer'), destination = join(root, 'buyers', name + '.json');
    const receipt = await prepareCubePackageBuyer({ directory: exportPath(value), reportId, acceptIndex, intentId,
      ...(inputs === undefined ? {} : { inputs }), destination });
    return { id: name, receipt };
  }
  async function download({ kind, item, file }) {
    id(item);
    let path;
    if (kind === 'exports' && PACKAGE_FILES.has(file)) {
      await inspectExport(item); path = join(exportPath(item), file);
    } else if (kind === 'versions' && ['merchant-plan.json', 'cube-meta.json'].includes(file)) {
      await openVersion(item); path = join(versionPath(item), file);
    } else if (kind === 'probes' && ['response.json', 'probe.json'].includes(file)) path = join(probePath(item), file);
    else if (kind === 'buyers' && file === 'review.json') path = join(root, 'buyers', item + '.json');
    else if (!['metadata', 'refreshes'].includes(kind)) throw new TypeError('Select an exported workspace file');
    const bytes = path ? await readBytes(path, { max: 16 * 1024 * 1024, privateFile: true }) : await editions.download({ kind, item, file });
    return { bytes, name: file, mime: file.endsWith('.json') ? 'application/json' :
      file.endsWith('.mjs') ? 'text/javascript; charset=utf-8' : 'text/markdown; charset=utf-8' };
  }
  async function createVersion(name, source, planPath, planSha256) {
    let existing = false;
    try { await privateDirectory(versionPath(name)); existing = true; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (!existing) {
      const staging = join(root, 'versions', '.staging-' + randomUUID());
      try {
        await createCubeWorkspace({ directory: staging, metadataPath: source.path, planPath });
        await rename(staging, versionPath(name)); await syncDirectory(join(root, 'versions'));
      } finally { await rm(staging, { recursive: true, force: true }); }
    }
    const saved = await inspectVersion(name);
    if (saved.view.metadataSha256 !== source.metadataSha256 || saved.view.planSha256 !== planSha256)
      throw new TypeError('The retained target version differs from this reviewed transition');
    return saved;
  }
  function searchMembers(values, { query = '', kind = '', cube = '', offset = 0, limit = 100 } = {}) {
    if (typeof query !== 'string' || query.length > 512 || typeof cube !== 'string' ||
        !['', 'measures', 'dimensions', 'segments'].includes(kind) || !Number.isInteger(offset) || offset < 0 ||
        !Number.isInteger(limit) || limit < 1 || limit > 200) throw new TypeError('Invalid member search');
    const needle = query.toLocaleLowerCase(), found = values.filter(member =>
      (!kind || member.kind === kind) && (!cube || member.cube === cube) &&
      (!needle || (member.name + ' ' + member.title).toLocaleLowerCase().includes(needle)));
    return { items: structuredClone(found.slice(offset, offset + limit)), total: found.length,
      next: offset + limit < found.length ? offset + limit : null };
  }
  const cubeView = source => source.cubes.map(cube => ({ name: cube.name, title: cube.title, type: cube.type,
    measures: cube.measures.length, dimensions: cube.dimensions.length, segments: cube.segments.length }));
  async function metadataInfo(value = defaultId) {
    const source = await editions.metadata(value);
    return { id: source.id, label: source.label, metadataSha256: source.metadataSha256, provenance: source.provenance,
      source: { cubeCount: source.cubeCount, memberCount: source.memberCount, excludedMembers: source.excludedMembers },
      cubes: cubeView(source.catalog) };
  }
  async function metadataMembers({ metadataId = defaultId, ...options } = {}) {
    const source = await editions.metadata(metadataId);
    return searchMembers(source.catalog.cubes.flatMap(cube => [...cube.measures, ...cube.dimensions, ...cube.segments]), options);
  }
  async function refreshDefault() {
    const active = editions.active();
    if (!active) return;
    const source = await editions.metadata(active.metadataId), version = await inspectVersion(active.version);
    defaultId = source.id; defaultMetadata = source.raw; defaultCatalog = source.catalog;
    defaultPlan = version.plan; defaultVersion = version.id; defaultDigest = source.metadataSha256;
  }
  editions = await openCubeEditions({ root, workbenchId: manifest.id, originalBytes: originals['cube-meta.json'],
    createdAt: manifest.createdAt, inspectVersion, createVersion });
  await editions.restoreActive(); await refreshDefault();
  return {
    root, manifest, close, preview, previewFor, listVersions, inspectVersion, inspectExport, download, metadataInfo, metadataMembers,
    save: (...args) => mutate(() => save(...args)), exportVersion: (...args) => mutate(() => exportVersion(...args)),
    probe: (...args) => mutate(() => probe(...args)), buyer: (...args) => mutate(() => buyer(...args)),
    listMetadata: editions.listMetadata, refreshImpact: editions.impact, inspectRefresh: editions.inspectReview,
    listRefreshes: editions.listReviews,
    importMetadata: input => mutate(() => editions.importMetadata(input)),
    captureMetadata: input => mutate(() => editions.captureMetadata(input)),
    reviewRefresh: input => mutate(() => editions.reviewRefresh(input)),
    applyRefresh: input => mutate(async () => { const result = await editions.applyRefresh(input); await refreshDefault(); return result; }),
    bootstrap: () => ({ id: manifest.id, directory: root, metadataId: defaultId,
      metadataSha256: defaultDigest, originalMetadataSha256: manifest.files['cube-meta.json'].sha256,
      source: { cubeCount: defaultCatalog.cubeCount, memberCount: defaultCatalog.memberCount, excludedMembers: defaultCatalog.excludedMembers },
      cubes: cubeView(defaultCatalog), plan: structuredClone(defaultPlan), version: defaultVersion, activeRefresh: editions.active() }),
    members: options => searchMembers(defaultId === 'original' ? members :
      defaultCatalog.cubes.flatMap(cube => [...cube.measures, ...cube.dimensions, ...cube.segments]), options),
  };
}
