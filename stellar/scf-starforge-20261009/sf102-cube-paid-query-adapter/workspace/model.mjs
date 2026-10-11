// MIT. Browser authoring over the original Cube metadata, plans and immutable workspaces.
import { join, resolve } from 'node:path';
import { readdir, unlink } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { inspectCubeMetadata } from '../onboarding/metadata.mjs';
import { compileCubeMerchantPlan, PLAN_SCHEMA } from '../onboarding/plan.mjs';
import { createCubeWorkspace, openCubeWorkspace, inspectCubeWorkspace,
  probeCubeReport } from '../onboarding/workspace.mjs';
import { exportCubePackage, openCubePackage, inspectCubePackage,
  prepareCubePackageBuyer } from '../onboarding/package.mjs';
import { privateDirectory, readBytes, writeNew, newDirectory, syncDirectory,
  parse, json, sha256, fileBinding, readBoundFiles } from '../onboarding/files.mjs';

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
  const root = resolve(directory);
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
    throw new TypeError('This workspace retains another metadata snapshot; use a new directory for changed metadata');
  if (planPath && sha256(await readBytes(resolve(planPath), { max: 1024 * 1024 })) !== manifest.files['initial-plan.json']?.sha256)
    throw new TypeError('This workspace already exists; import the changed plan in the browser');
  const metadata = parse(originals['cube-meta.json'], 'Cube metadata'), catalog = inspectCubeMetadata(metadata);
  const initialPlan = originals['initial-plan.json'] ? parse(originals['initial-plan.json'], 'Merchant plan') : emptyPlan();
  const members = catalog.cubes.flatMap(cube => [...cube.measures, ...cube.dimensions, ...cube.segments]);
  const versionPath = value => join(root, 'versions', id(value));
  const exportPath = value => join(root, 'exports', id(value));
  const probePath = value => join(root, 'probes', id(value));

  const preview = plan => {
    const compiled = compileCubeMerchantPlan(metadata, plan);
    return { serviceName: compiled.serviceName, publicOrigin: compiled.publicOrigin,
      metadata: compiled.source, upstream: { ...compiled.adapter, reports: undefined, allowLoopback: compiled.allowLoopback },
      reports: structuredClone(compiled.reports), reportCount: compiled.reports.length,
      openapi: compiled.openapi, offers: compiled.offers };
  };
  async function openVersion(value) {
    const path = versionPath(value), saved = await openCubeWorkspace(path);
    if (saved.manifest.files['cube-meta.json'].sha256 !== manifest.files['cube-meta.json'].sha256)
      throw new TypeError('Saved version belongs to another metadata snapshot');
    return { id: value, path, saved };
  }
  async function inspectVersion(value) {
    const item = await openVersion(value);
    return { id: value, plan: parse(item.saved.files['merchant-plan.json'], 'Saved merchant plan'),
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
        const { saved } = await openVersion(name);
        items.push({ id: name, createdAt: saved.manifest.createdAt, serviceName: saved.compiled.serviceName,
          reportCount: saved.compiled.reports.length, planSha256: saved.manifest.files['merchant-plan.json'].sha256,
          status: 'SAVED' });
      } catch (error) { items.push({ id: name, status: 'UNAVAILABLE', error: error.message }); }
    }
    return { items, next: names.length > page.length ? page.at(-1) : null };
  }
  async function save(plan) {
    preview(plan);
    const name = key('v'), temporary = join(root, key('plan') + '.json');
    await writeNew(temporary, json(plan));
    try {
      const view = await createCubeWorkspace({ directory: versionPath(name),
        metadataPath: join(root, 'cube-meta.json'), planPath: temporary });
      return { id: name, plan: structuredClone(plan), view };
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
    if (saved.manifest.metadataSha256 !== manifest.files['cube-meta.json'].sha256)
      throw new TypeError('Package belongs to another metadata snapshot');
    return { id: value, package: await inspectCubePackage(path), publicFiles: [...PUBLIC_FILES],
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
    } else if (kind === 'versions' && file === 'merchant-plan.json') {
      await openVersion(item); path = join(versionPath(item), file);
    } else if (kind === 'probes' && ['response.json', 'probe.json'].includes(file)) path = join(probePath(item), file);
    else if (kind === 'buyers' && file === 'review.json') path = join(root, 'buyers', item + '.json');
    else throw new TypeError('Select an exported workspace file');
    const bytes = await readBytes(path, { max: 16 * 1024 * 1024, privateFile: true });
    return { bytes, name: file, mime: file.endsWith('.json') ? 'application/json' :
      file.endsWith('.mjs') ? 'text/javascript; charset=utf-8' : 'text/markdown; charset=utf-8' };
  }
  return {
    root, manifest, preview, save, listVersions, inspectVersion, exportVersion, inspectExport, probe, buyer, download,
    bootstrap: () => ({ id: manifest.id, directory: root, metadataSha256: manifest.files['cube-meta.json'].sha256,
      source: { cubeCount: catalog.cubeCount, memberCount: catalog.memberCount, excludedMembers: catalog.excludedMembers },
      cubes: catalog.cubes.map(cube => ({ name: cube.name, title: cube.title, type: cube.type,
        measures: cube.measures.length, dimensions: cube.dimensions.length, segments: cube.segments.length })),
      plan: structuredClone(initialPlan) }),
    members: ({ query = '', kind = '', cube = '', offset = 0, limit = 100 } = {}) => {
      if (typeof query !== 'string' || query.length > 512 || typeof cube !== 'string' ||
          !['', 'measures', 'dimensions', 'segments'].includes(kind) || !Number.isInteger(offset) || offset < 0 ||
          !Number.isInteger(limit) || limit < 1 || limit > 200) throw new TypeError('Invalid member search');
      const needle = query.toLocaleLowerCase(), found = members.filter(member =>
        (!kind || member.kind === kind) && (!cube || member.cube === cube) &&
        (!needle || (member.name + ' ' + member.title).toLocaleLowerCase().includes(needle)));
      return { items: structuredClone(found.slice(offset, offset + limit)), total: found.length,
        next: offset + limit < found.length ? offset + limit : null };
    },
  };
}
