// MIT. Private versions around the original SF97 analyzer and native companion.
import { constants } from 'node:fs';
import { mkdir, open, lstat, realpath, readdir, rename, link, rm } from 'node:fs/promises';
import { isAbsolute, resolve, join, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { merchantRoutes, merchantTerms, analyze, createReport, readJson, liveSnapshot } from '../analyze.mjs';

const MAX_BYTES = 16 * 1024 * 1024;
const REVISION = /^[a-f0-9]{64}$/;
const VERSION = /^[a-f0-9-]{36}$/;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export function fault(code, message, status = 422) { return Object.assign(new Error(message), {code, status}); }

async function privateDirectory(path, create = false) {
  if (create) await mkdir(path, {mode:0o700}).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.mode & 0o077 || await realpath(path) !== path)
    throw fault('PRIVATE_WORKSPACE_REQUIRED', 'Use a real private directory with mode 0700.');
}
async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function writeOnce(path, bytes) {
  const handle = await open(path, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
}
async function privateBytes(path) {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.mode & 0o077 || stat.size > MAX_BYTES)
      throw fault('INVALID_SAVED_FILE', 'A saved workspace file has changed type, permissions or size.');
    const bytes = await handle.readFile();
    if (bytes.length > MAX_BYTES) throw fault('SAVED_FILE_TOO_LARGE', 'Saved file exceeds 16 MiB.');
    return bytes;
  } finally { await handle.close(); }
}
function commercialInputs(terms, routes) {
  return {merchantName:terms?.merchantName ?? '', sharedMonthlyFixedUsd:terms?.sharedMonthlyFixedUsd ?? null,
    routes:Object.fromEntries(routes.map(route => {
      const old = terms && Object.hasOwn(terms.routes, route.routeId) ? terms.routes[route.routeId] : null;
      return [route.routeId, {unitPriceUsd:old?.unitPriceUsd ?? '', priceBasis:old?.priceBasis ?? '',
        perFulfilledUsd:old?.perFulfilledUsd ?? null, perChallengeUsd:old?.perChallengeUsd ?? null,
        monthlyPaidTarget:old?.monthlyPaidTarget ?? 0}];
    }))};
}
function summary(entry) {
  return {revision:entry.revision, version:entry.value.version, label:entry.value.label,
    savedAt:entry.value.savedAt, sellerSha256:entry.value.sellerSha256,
    snapshotSha256:entry.value.snapshotSha256, sessionId:entry.value.sessionId,
    overview:entry.value.overview, native:entry.value.native,
    files:Object.keys(entry.value.files)};
}

export async function openWorkspace({config, directory, snapshot, opsUrl, nativeOutbox} = {}) {
  if (!isAbsolute(directory ?? '') || resolve(directory) !== directory || directory === '/')
    throw fault('ABSOLUTE_WORKSPACE_REQUIRED', 'Workspace must be an absolute, normalized private directory.');
  if (!config || Boolean(snapshot) === Boolean(opsUrl))
    throw fault('SOURCE_REQUIRED', 'Supply a seller configuration and exactly one operations snapshot or live URL.');
  const configPath = resolve(config);
  let liveUrl;
  if (opsUrl) {
    const url = new URL(opsUrl);
    if (url.pathname === '/') url.pathname = '/api/snapshot';
    if (url.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(url.hostname) || !url.port ||
        url.username || url.password || url.search || url.hash || !['/api/snapshot','/export.json'].includes(url.pathname))
      throw fault('LOCAL_OPERATIONS_REQUIRED', 'Use the original loopback operations URL.');
    liveUrl = url.href;
  }
  async function seller() {
    const source = await readJson(configPath, 'seller config');
    return {...source, routes:merchantRoutes(source.value)};
  }
  await seller();
  await privateDirectory(directory, true);
  for (const name of ['versions','successors','pending']) await privateDirectory(join(directory,name), true);
  const captures = new Map();
  async function capture() {
    const result = snapshot ? await readJson(resolve(snapshot), 'operations snapshot') : await liveSnapshot(liveUrl);
    captures.delete(result.hash); captures.set(result.hash, result);
    while (captures.size > 16) captures.delete(captures.keys().next().value);
    return result;
  }

  // Every committed revision has one create-only successor. Publishing its hard
  // link is an atomic compare-and-swap, so processes/tabs cannot overwrite a save.
  // No PID lock survives a crash, and incomplete reports never become the head.
  async function history() {
    const entries = []; let previous = null;
    for (;;) {
      let bytes;
      try { bytes = await privateBytes(join(directory, 'successors', (previous ?? 'root') + '.json')); }
      catch (error) { if (error.code === 'ENOENT') return entries; throw error; }
      const revision = digest(bytes), value = JSON.parse(bytes.toString('utf8'));
      if (value.schema !== 'stellar-forge.merchant-pricing-version.v1' ||
          value.previousRevision !== previous || !VERSION.test(value.version) ||
          !value.files || typeof value.files !== 'object')
        throw fault('INVALID_SAVED_VERSION', 'A saved version has an invalid predecessor or manifest.');
      await privateDirectory(join(directory,'versions',value.version));
      const original = await privateBytes(join(directory,'versions',value.version,'manifest.json'));
      if (!original.equals(bytes)) throw fault('SAVED_MANIFEST_CHANGED', 'The saved manifest has changed.');
      entries.push({revision,value}); previous = revision;
    }
  }
  async function savedFile(entry, name) {
    const expected = entry.value.files[name];
    if (!expected || name.split('/').some(part => !part || part === '.' || part === '..'))
      throw fault('FILE_NOT_FOUND', 'This file is not part of the saved review.', 404);
    const path = join(directory,'versions',entry.value.version,...name.split('/'));
    if (await realpath(path) !== path) throw fault('SAVED_FILE_CHANGED', 'Saved file path has changed.');
    const bytes = await privateBytes(path);
    if (bytes.length !== expected.bytes || digest(bytes) !== expected.sha256)
      throw fault('SAVED_FILE_CHANGED', 'Saved review bytes differ from the committed version.');
    return bytes;
  }
  async function state() {
    const [source, entries] = await Promise.all([seller(), history()]);
    const latest = entries.at(-1);
    const terms = latest ? JSON.parse((await savedFile(latest,'terms.json')).toString('utf8')) : null;
    let observed = null, sourceError = null;
    try {
      const selected = await capture();
      observed = {sha256:selected.hash, sessionId:selected.value.sessionId,
        mode:selected.value.mode, capturedAt:selected.value.capturedAt, startedAt:selected.value.startedAt};
    } catch { sourceError = 'Operations snapshot is unavailable. Restore the configured source, then refresh operations.'; }
    return {schema:'stellar-forge.merchant-pricing-workspace.v1', revision:latest?.revision ?? null,
      seller:{name:basename(configPath),sha256:source.hash,routes:source.routes},
      sellerChanged:Boolean(latest && latest.value.sellerSha256 !== source.hash),
      commercial:commercialInputs(terms,source.routes), snapshot:observed, sourceError,
      nativeAttached:Boolean(nativeOutbox), history:entries.slice(-100).reverse().map(summary)};
  }
  async function prepared(input) {
    const source = await seller();
    if (input.sellerSha256 !== source.hash)
      throw fault('SELLER_CHANGED', 'Seller configuration changed. Refresh and review the current payment choices.', 409);
    const observed = captures.get(input.snapshotSha256);
    if (!observed) throw fault('SNAPSHOT_EXPIRED', 'Refresh operations to capture the original snapshot again.', 409);
    const terms = merchantTerms(source.value,input.commercial), termsBytes = encode(terms);
    const report = analyze(source.value,observed.value,terms,
      {seller:source.hash,terms:digest(termsBytes),snapshot:observed.hash});
    return {source,observed,terms,termsBytes,report};
  }
  async function preview(input) { return (await prepared(input)).report; }
  async function filesIn(folder, prefix = '') {
    const files = {};
    for (const item of await readdir(folder,{withFileTypes:true})) {
      const path = join(folder,item.name), name = prefix + item.name;
      if (item.isDirectory()) {
        await privateDirectory(path); Object.assign(files,await filesIn(path,name+'/'));
      } else if (item.isFile()) {
        const bytes = await privateBytes(path);
        const handle = await open(path,'r');
        try { await handle.sync(); } finally { await handle.close(); }
        files[name] = {bytes:bytes.length,sha256:digest(bytes)};
      } else throw fault('INVALID_REPORT_FILE', 'A report contains a non-regular file.');
    }
    await syncDirectory(folder);
    return files;
  }
  async function save(input) {
    if (!input || !VERSION.test(input.requestId) ||
        !(input.expectedRevision === null || REVISION.test(input.expectedRevision)) ||
        typeof input.label !== 'string' || !input.label.trim() || input.label.length > 100)
      throw fault('SAVE_DETAILS_REQUIRED', 'Use a review name, request ID and current workspace revision.');
    const requestSha256 = digest(canonical(input)), entries = await history();
    const existing = entries.find(entry => entry.value.requestId === input.requestId);
    if (existing) {
      if (existing.value.requestSha256 !== requestSha256)
        throw fault('REQUEST_CHANGED', 'This save request was already used for different inputs.', 409);
      return {status:'REVIEW_SAVED',...summary(existing),recovered:true};
    }
    if ((entries.at(-1)?.revision ?? null) !== input.expectedRevision)
      throw fault('REVISION_CHANGED', 'Another tab saved a review. Reload the saved version before replacing it.', 409);
    const {source,observed,termsBytes,report} = await prepared(input);
    const version = randomUUID(), pending = join(directory,'pending',version), final = join(directory,'versions',version);
    await privateDirectory(pending,true); let published = false, moved = false;
    try {
      for (const [name,bytes] of [['seller.json',source.bytes],['snapshot.json',observed.bytes],['terms.json',termsBytes]])
        await writeOnce(join(pending,name),bytes);
      const result = await createReport(['--config',join(pending,'seller.json'),'--terms',join(pending,'terms.json'),
        '--snapshot',join(pending,'snapshot.json'),'--output',join(pending,'report'),
        ...(nativeOutbox ? ['--native-outbox',resolve(nativeOutbox)] : [])]);
      const files = await filesIn(pending);
      const value = {schema:'stellar-forge.merchant-pricing-version.v1',version,
        previousRevision:input.expectedRevision,requestId:input.requestId,requestSha256,
        label:input.label.trim(),savedAt:new Date().toISOString(),sellerSha256:source.hash,
        snapshotSha256:observed.hash,sessionId:report.sessionId,overview:report.overview,
        native:result.native,files};
      const manifest = encode(value), revision = digest(manifest);
      await writeOnce(join(pending,'manifest.json'),manifest);
      await syncDirectory(pending);
      await rename(pending,final); moved = true;
      await syncDirectory(join(directory,'versions'));
      try { await link(join(final,'manifest.json'),join(directory,'successors',(input.expectedRevision ?? 'root')+'.json')); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const winner = (await history()).find(entry => entry.value.requestId === input.requestId);
        if (winner?.value.requestSha256 === requestSha256)
          return {status:'REVIEW_SAVED',...summary(winner),recovered:true};
        throw fault('REVISION_CHANGED', 'Another tab saved first. Your inputs remain in this form; reload the saved review.',409);
      }
      published = true;
      await syncDirectory(join(directory,'successors'));
      return {status:'REVIEW_SAVED',...summary({revision,value}),recovered:false};
    } finally {
      // Remove only this request's uncommitted staging. Committed history is immutable.
      if (!published) await rm(moved ? final : pending,{recursive:true,force:true}).catch(()=>{});
    }
  }
  async function download(version,name) {
    if (!VERSION.test(version)) throw fault('VERSION_NOT_FOUND','Saved review not found.',404);
    const entry = (await history()).find(item => item.value.version === version);
    if (!entry) throw fault('VERSION_NOT_FOUND','Saved review not found.',404);
    if (name === 'manifest.json') return encode(entry.value);
    return savedFile(entry,name);
  }
  async function loadVersion(version) {
    const terms = JSON.parse((await download(version,'terms.json')).toString('utf8'));
    const source = await seller();
    return {commercial:commercialInputs(terms,source.routes),sellerSha256:source.hash};
  }
  return {state,preview,save,download,loadVersion};
}
