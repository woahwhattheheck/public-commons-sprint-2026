// MIT. Retained HAR source intake in the original API merchant workspace.
import { constants as C } from 'node:fs';
import { open, mkdir, mkdtemp, lstat, readdir, rm, link, rename } from 'node:fs/promises';
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  prepare, openWorkspace, readRevision, readRegular, copyWorkspace, saveReview,
  writeReviewPage, inspectWorkspace, digest,
} from './store.mjs';
import {
  prepareRefresh, openRefresh, saveRefreshReview, writeRefreshPage, copyRefresh,
  packageRefresh, describeRefresh,
} from './refresh.mjs';
import { buildDocument, canonical } from './model.mjs';
import { renderReview } from './review.mjs';
import { saveHarMerchant } from './merchant.mjs';

export const HAR_UPLOAD_LIMIT = 128 * 1024 * 1024;
export const HAR_DECISION_LIMIT = 4 * 1024 * 1024;
const PAGE_LIMIT = 32 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const RECORD_SCHEMA = 'stellar.har-console-entry.v1';
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const json = bytes => JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes).replace(/^\uFEFF/, ''));
const fail = message => {throw new TypeError(message);};
const conflict = message => Object.assign(new Error(message), {status:409});

function selection(value, revisionRequired = false) {
  if (!plain(value) || !['capture','refresh'].includes(value.kind) || !HASH.test(value.id ?? '') ||
      Object.keys(value).some(key => !['kind','id','revision','sourceSha256','openApiSha256'].includes(key)))
    fail('Select one retained capture or refresh packet');
  if (value.revision !== undefined && value.revision !== null && !HASH.test(value.revision))
    fail('Select a complete saved review revision');
  if (revisionRequired && !HASH.test(value.revision ?? '')) fail('Choose a saved review first');
  return {kind:value.kind, id:value.id, ...(value.revision ? {revision:value.revision} : {})};
}
function label(value) {
  if (typeof value !== 'string' || !value.trim() || value.length > 160 || /[\u0000-\u001f\u007f]/.test(value))
    fail('Give the capture a label of 1–160 characters');
  return value.trim();
}
function absolute(value) {
  if (typeof value !== 'string' || !isAbsolute(value) || value.length > 4096 || value.includes('\0'))
    fail('Enter an absolute private directory path on this host');
  return resolve(value);
}
async function privateDirectory(path, create = false) {
  if (create) try {await mkdir(path, {mode:0o700});} catch (error) {if (error.code !== 'EEXIST') throw error;}
  const info = await lstat(path);
  if (!info.isDirectory() || info.isSymbolicLink() || (info.mode & 0o077))
    fail('Use an existing private nonsymlink directory: ' + path);
}
async function syncDirectory(path) {
  const fd = await open(path, C.O_RDONLY);
  try {await fd.sync();} finally {await fd.close();}
}
async function writeNew(path, bytes) {
  const fd = await open(path, C.O_CREAT | C.O_EXCL | C.O_WRONLY | C.O_NOFOLLOW, 0o600);
  try {await fd.writeFile(bytes); await fd.sync();} finally {await fd.close();}
}
async function exists(path) {
  try {await lstat(path); return true;} catch (error) {if (error.code === 'ENOENT') return false; throw error;}
}
function sameLineage(packet, review) {
  if (review.sourceSha256 !== packet.candidate.manifest.sourceSha256 ||
      canonical(review['x-har-refresh']) !== canonical(packet.manifest.lineage))
    fail('Choose decisions saved for this refresh packet');
}
function authoredDecision(row) {
  const result = structuredClone(row);
  for (const key of ['groups','reviewed','enabled','x-har-refresh-retained']) delete result[key];
  return result;
}
function seedOperations(document) {
  const rows = [];
  for (const [path, item] of Object.entries(document.paths)) for (const [method, operation] of Object.entries(item)) {
    const pathParams = {}, query = {};
    for (const parameter of operation.parameters ?? []) if (own(parameter, 'example')) {
      if (parameter.in === 'path') Object.defineProperty(pathParams, parameter.name,
        {value:structuredClone(parameter.example), enumerable:true, configurable:true, writable:true});
      if (parameter.in === 'query') Object.defineProperty(query, parameter.name,
        {value:structuredClone(parameter.example), enumerable:true, configurable:true, writable:true});
    }
    const requestExample = {};
    if (Object.keys(pathParams).length) requestExample.pathParams = pathParams;
    if (Object.keys(query).length) requestExample.query = query;
    const body = Object.values(operation.requestBody?.content ?? {})[0];
    if (body && own(body, 'example')) requestExample.body = structuredClone(body.example);
    const originalId = operation.operationId;
    const id = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(originalId ?? '') &&
      !['__proto__','constructor','prototype'].includes(originalId)
      ? originalId : 'har_' + digest(Buffer.from(method + ' ' + path)).slice(0,24);
    rows.push({method:method.toUpperCase(), path, id, amountAtomic:'', serverIndex:0,
      publicDescription:operation.summary ?? originalId,
      headerEnv:Object.fromEntries(operation['x-har-observation'].backendBindings.map(binding => [binding.name, binding.reference])),
      securityAlternative:0, responseMode:'json', responseValidation:'none',
      ...(Object.keys(requestExample).length && Buffer.byteLength(JSON.stringify(requestExample)) <= 8192
        ? {requestExample} : {})});
  }
  return rows;
}

/** All source decoding, decisions, comparisons and package writes stay in their native owners. */
export async function openHarConsole({parent}) {
  const output = absolute(parent); await privateDirectory(output);
  const root = join(output, '.har-captures');
  await privateDirectory(root, true);
  for (const folder of ['capture','refresh','.temporary']) await privateDirectory(join(root, folder), true);

  async function temporary(work) {
    await privateDirectory(join(root, '.temporary'));
    const directory = await mkdtemp(join(root, '.temporary', 'operation-'));
    try {return await work(directory);} finally {await rm(directory, {recursive:true, force:true});}
  }
  async function ensureDirectory(directory, reopen, build) {
    if (!await exists(directory)) {await build(directory); return {reused:false,recovered:false};}
    try {await reopen(); return {reused:true,recovered:false};}
    catch (originalError) {
      // Finish only the original writer's still-empty reservation. Stage beside
      // that destination so a receiving directory can live on another volume.
      const reservation = await lstat(directory);
      if (!reservation.isDirectory() || reservation.isSymbolicLink() || (reservation.mode & 0o077) ||
          (await readdir(directory)).length) throw originalError;
      await privateDirectory(dirname(directory));
      const parent = await mkdtemp(join(dirname(directory),'.har-recovery-'));
      try {
        const stage = join(parent,'retained-source');
        await build(stage);
        const current = await lstat(directory);
        if (current.ino !== reservation.ino || current.dev !== reservation.dev ||
            (await readdir(directory)).length)
          throw conflict('This source completed in another operation. Refresh its retained entry.');
        await rename(stage,directory); await syncDirectory(dirname(directory));
        await reopen();
        return {reused:true,recovered:true};
      } finally {await rm(parent,{recursive:true,force:true});}
    }
  }
  async function ensureOriginal(selected, build) {
    const {directory} = await location(selected);
    return ensureDirectory(directory,() => opened(selected),build);
  }
  async function location(value) {
    const selected = selection(value);
    await privateDirectory(root); await privateDirectory(join(root, selected.kind));
    return {selected, directory:join(root, selected.kind, selected.id)};
  }
  async function opened(value, requireRevision = false) {
    const {selected, directory} = await location(selection(value, requireRevision));
    let packet, workspace;
    if (selected.kind === 'refresh') {
      packet = await openRefresh(directory);
      if (packet.manifest.operationId !== selected.id) fail('Retained refresh identity changed');
      workspace = packet.candidate;
    } else {
      workspace = await openWorkspace(directory);
      if (workspace.manifest.sourceSha256 !== selected.id) fail('Retained capture identity changed');
    }
    const saved = selected.revision ? await readRevision(workspace, selected.revision) : null;
    if (saved && packet) sameLineage(packet, saved.review);
    return {selected, directory, packet, workspace, saved};
  }
  async function readRecord(selected, directory) {
    const record = json(await readRegular(join(directory, 'console-entry.json'), 65536, true));
    if (record.schema !== RECORD_SCHEMA || record.kind !== selected.kind || record.id !== selected.id ||
        !HASH.test(record.sourceSha256 ?? '') || typeof record.createdAt !== 'string' ||
        !Number.isSafeInteger(record.groups) || !Number.isSafeInteger(record.totalEntries))
      fail('Retained capture label needs recovery from its original source');
    label(record.label); return record;
  }
  async function record(value, title) {
    const current = await opened(value);
    const entry = {schema:RECORD_SCHEMA, kind:current.selected.kind, id:current.selected.id,
      label:label(title), createdAt:new Date().toISOString(),
      sourceSha256:current.workspace.manifest.sourceSha256,
      sourceBytes:current.workspace.manifest.sourceBytes,
      groups:current.workspace.inventory.groups.length, totalEntries:current.workspace.inventory.totalEntries,
      rejectedEntries:current.workspace.inventory.rejected.length,
      ...(current.packet ? {lineage:current.packet.manifest.lineage, summary:current.packet.report.summary} : {})};
    const target = join(current.directory, 'console-entry.json');
    if (!await exists(target)) await temporary(async directory => {
      const stage = join(directory, 'entry.json'); await writeNew(stage, encode(entry));
      try {await link(stage, target); await syncDirectory(current.directory);}
      catch (error) {if (error.code !== 'EEXIST') throw error;}
    });
    const saved = await readRecord(current.selected, current.directory);
    if (saved.sourceSha256 !== entry.sourceSha256) fail('Retained capture label names another source');
    return saved;
  }
  async function selectedRevisions(current, after = '', limit = 25) {
    if (after && !HASH.test(after)) fail('Invalid review page cursor');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('Review page limit must be 1–100');
    const names = (await readdir(join(current.workspace.root, 'reviews')))
      .filter(name => /^[a-f0-9]{64}\.json$/.test(name)).map(name => name.slice(0,-5)).sort();
    const page = names.filter(revision => revision > after).slice(0, limit), reviews = [];
    for (const revision of page) {
      const saved = await readRevision(current.workspace, revision);
      let usable = true;
      if (current.packet) {
        try {sameLineage(current.packet, saved.review);} catch {usable = false;}
      }
      reviews.push({revision, title:saved.review.title, version:saved.review.version,
        operations:saved.review.operations.filter(row => row.enabled).map(row => row.id), usable});
    }
    return {reviews, totalReviews:names.length,
      next:page.length && names.some(revision => revision > page.at(-1)) ? page.at(-1) : null};
  }
  async function inspect(value, {after = '', limit = 25} = {}) {
    const current = await opened(value);
    let metadata;
    try {metadata = await readRecord(current.selected, current.directory);}
    catch (error) {if (error.code !== 'ENOENT') throw error;}
    return {selection:current.selected, label:metadata?.label ?? 'Retained ' + current.selected.kind,
      directory:current.directory, sourceSha256:current.workspace.manifest.sourceSha256,
      sourceBytes:current.workspace.manifest.sourceBytes, totalEntries:current.workspace.inventory.totalEntries,
      groups:current.workspace.inventory.groups.length, rejectedEntries:current.workspace.inventory.rejected.length,
      ...(current.packet ? {lineage:current.packet.manifest.lineage, summary:current.packet.report.summary,
        changes:current.packet.report.operations.map(row => ({operationId:row.operationId, method:row.method,
          path:row.path, status:row.status, sections:row.changes.map(change => change.label)})),
        ambiguousGroups:current.packet.report.ambiguous.length} : {}),
      ...await selectedRevisions(current, after, limit)};
  }
  async function entries({after = '', limit = 25} = {}) {
    if (after && !/^(capture|refresh):[a-f0-9]{64}$/.test(after)) fail('Invalid capture page cursor');
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail('Capture page limit must be 1–100');
    const keys = [];
    for (const kind of ['capture','refresh']) {
      await privateDirectory(join(root, kind));
      for (const entry of await readdir(join(root, kind), {withFileTypes:true}))
        if (entry.isDirectory() && HASH.test(entry.name)) keys.push(kind + ':' + entry.name);
    }
    keys.sort();
    const page = keys.filter(key => key > after).slice(0,limit), items = [];
    for (const key of page) {
      const [kind,id] = key.split(':'), selected = {kind,id}, directory = join(root,kind,id);
      try {
        await privateDirectory(directory);
        items.push({...await readRecord(selected,directory), selection:selected, available:true});
      } catch (error) {
        items.push({selection:selected, label:'Unfinished ' + kind, available:false,
          error:'Re-upload or adopt the same original to finish its retained label. ' + error.message});
      }
    }
    return {root, items, total:keys.length,
      next:page.length && keys.some(key => key > page.at(-1)) ? page.at(-1) : null};
  }
  async function receive(stream, {label:title, previous} = {}) {
    title = label(title);
    const before = previous ? await opened(previous, true) : null;
    return temporary(async directory => {
      const upload = join(directory, 'source.har'), fd = await open(upload, C.O_CREAT | C.O_EXCL | C.O_WRONLY | C.O_NOFOLLOW, 0o600);
      let size = 0;
      try {
        for await (const raw of stream) {
          const bytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw);
          size += bytes.length;
          if (size > HAR_UPLOAD_LIMIT) throw Object.assign(new Error('HAR capture exceeds 128 MiB'), {status:413});
          await fd.writeFile(bytes);
        }
        if (!size) fail('Choose a nonempty HAR capture');
        await fd.sync();
      } finally {await fd.close();}
      const sourceSha256 = digest(await readRegular(upload));
      let selected, publication;
      if (before) {
        const lineage = {schema:'stellar.har-refresh.v1',
          previousSourceSha256:before.workspace.manifest.sourceSha256,
          previousReviewSha256:before.saved.revision, candidateSourceSha256:sourceSha256};
        selected = {kind:'refresh', id:digest(Buffer.from(canonical(lineage)))};
        publication = await ensureOriginal(selected,destination => prepareRefresh({
          workspace:before.workspace.root,revision:before.saved.revision,harFile:upload,destination}));
      } else {
        selected = {kind:'capture', id:sourceSha256};
        publication = await ensureOriginal(selected,destination => prepare(upload,destination));
      }
      await record(selected, title);
      return {...await inspect(selected), ...publication};
    });
  }
  async function mergeReviews(from, to) {
    for (const name of (await readdir(join(from.root, 'reviews'))).filter(name => /^[a-f0-9]{64}\.json$/.test(name)).sort()) {
      const revision = name.slice(0,-5); await readRevision(from,revision);
      if (await exists(join(to.root,'reviews',name))) {await readRevision(to,revision); continue;}
      const saved = await saveReview(to.root,join(from.root,'reviews',name));
      if (saved.revision !== revision) fail('Original review bytes changed during source adoption');
    }
  }
  async function adopt({kind, directory, label:title}) {
    title = label(title); directory = absolute(directory);
    if (!['capture','refresh'].includes(kind)) fail('Choose an original capture workspace or refresh packet');
    const original = kind === 'capture' ? await openWorkspace(directory) : await openRefresh(directory);
    const selected = {kind, id:kind === 'capture' ? original.manifest.sourceSha256 : original.manifest.operationId};
    const publication = await ensureOriginal(selected,destination => kind==='capture'
      ? copyWorkspace(directory,destination) : copyRefresh(directory,destination));
    if (publication.reused) {
      const current = await opened(selected);
      if (kind === 'capture') await mergeReviews(original,current.workspace);
      else {
        if (canonical(original.manifest) !== canonical(current.packet.manifest)) fail('Existing refresh packet differs from the adopted original');
        await mergeReviews(original.previous,current.packet.previous);
        await mergeReviews(original.candidate,current.packet.candidate);
      }
    }
    await record(selected,title);
    return {...await inspect(selected),...publication};
  }
  async function saveDecisions(value, bytes) {
    const current = await opened(value);
    if (!Buffer.isBuffer(bytes) || bytes.length < 1 || bytes.length > HAR_DECISION_LIMIT)
      fail('Reviewed decision file must be 1 byte–4 MiB');
    return temporary(async directory => {
      const file = join(directory,'decisions.json'); await writeNew(file,bytes);
      const saved = current.packet ? await saveRefreshReview(current.directory,file)
        : await saveReview(current.workspace.root,file);
      return {...saved, selection:{...current.selected,revision:saved.revision}};
    });
  }
  async function reviewer(value) {
    const current = await opened(value);
    return temporary(async directory => {
      const page = join(directory,'review.html');
      if (current.packet) await writeRefreshPage(current.directory,page,current.selected.revision);
      else await writeReviewPage(current.workspace.root,page,renderReview,current.selected.revision);
      return {bytes:await readRegular(page,PAGE_LIMIT,true),
        filename:'har-' + current.selected.kind + '-' + current.selected.id.slice(0,12) + '-review.html',
        contentType:'text/html; charset=utf-8'};
    });
  }
  async function source(value) {
    const current = await opened(value,true), document = buildDocument(current.workspace.inventory,current.saved.review);
    document['x-starforge-har'].reviewSha256 = current.saved.revision;
    const specText = encode(document).toString('utf8');
    if (Buffer.byteLength(specText) > HAR_DECISION_LIMIT) fail('Reviewed OpenAPI exceeds the original 4 MiB source limit');
    const operations = seedOperations(document);
    const carry = [];
    if (current.packet) {
      const approved = new Map(current.saved.review.operations.filter(row => row.enabled).map(row => [row.id,row]));
      for (const row of current.packet.report.operations) {
        const next = approved.get(row.operationId);
        if (row.status === 'carried' && next &&
            canonical(authoredDecision(next)) === canonical(authoredDecision(row.previousDecisions)))
          carry.push({method:row.method, path:next.path, previousPath:row.path, operationId:next.id});
      }
    }
    return {specText, operations,
      capturedSource:{...current.selected,sourceSha256:current.workspace.manifest.sourceSha256,openApiSha256:digest(Buffer.from(specText))},
      ...(current.packet ? {previous:current.packet.manifest.lineage,carry} : {}),
      description:{title:current.saved.review.title,version:current.saved.review.version,
        sourceSha256:current.workspace.manifest.sourceSha256,revision:current.saved.revision,operations:operations.length}};
  }
  async function checkSource(value, specText, plan) {
    if (typeof specText !== 'string') fail('Select the reviewed capture source');
    const retained = await source(value);
    if (value.sourceSha256 !== retained.capturedSource.sourceSha256 ||
        value.openApiSha256 !== retained.capturedSource.openApiSha256 || specText !== retained.specText)
      throw conflict('The merchant source differs from the selected saved capture review. Use that review again.');
    if (plan !== undefined) {
      const expected = new Set(retained.operations.map(row => row.method + ' ' + row.path));
      if (!Array.isArray(plan?.operations) || plan.operations.length !== expected.size ||
          plan.operations.some(row => !expected.delete(String(row.method).toUpperCase() + ' ' + row.path)) || expected.size)
        fail('Keep exactly the reviewed capture routes selected, or save another capture review for a different selection');
    }
    return retained;
  }
  async function saveMerchant({capturedSource,specText,plan,name}) {
    await checkSource(capturedSource,specText,plan);
    const current = await opened(capturedSource,true), bytes = encode(plan);
    if (bytes.length > HAR_DECISION_LIMIT) fail('Merchant plan exceeds the original 4 MiB limit');
    return temporary(async directory => {
      const planFile = join(directory,'merchant-plan.json'); await writeNew(planFile,bytes);
      return current.packet
        ? packageRefresh({directory:current.directory,revision:current.saved.revision,planFile,parent:output,name})
        : saveHarMerchant({workspace:current.workspace.root,revision:current.saved.revision,planFile,parent:output,name});
    });
  }
  async function copy(value, destination) {
    const current = await opened(value); destination = absolute(destination);
    await privateDirectory(dirname(destination));
    const reopen = async () => {
      const target = current.packet ? await openRefresh(destination) : await openWorkspace(destination);
      if (canonical(target.manifest) !== canonical(current.packet?.manifest ?? current.workspace.manifest))
        throw conflict('The receiving directory contains another original source. Choose its original destination.');
      return target;
    };
    const publication = await ensureDirectory(destination,reopen,target => current.packet
      ? copyRefresh(current.directory,target) : copyWorkspace(current.workspace.root,target));
    const target = await reopen();
    // Equal original source remains reusable as its immutable reviews advance.
    // Add validated absent revisions through the native writer; existing
    // receiving-only reviews and both refresh members retain their ownership.
    if (current.packet) {
      await mergeReviews(current.packet.previous,target.previous);
      await mergeReviews(current.packet.candidate,target.candidate);
    } else await mergeReviews(current.workspace,target);
    const inspected = current.packet ? null : await inspectWorkspace(destination);
    const result = current.packet ? describeRefresh(target,publication.reused) : {
      workspace:destination,sourceSha256:target.manifest.sourceSha256,
      revisions:inspected.reviews.map(row => row.revision),
    };
    return {selection:current.selected,destination,result,...publication,
      receivingKind:current.packet?'refresh':'capture'};
  }
  async function locate(specText) {
    if (typeof specText !== 'string' || Buffer.byteLength(specText) > HAR_DECISION_LIMIT) return null;
    let document;
    try {document = JSON.parse(specText);} catch {return null;}
    const captured = document['x-starforge-har'];
    if (!captured || !HASH.test(captured.sourceSha256 ?? '') || !HASH.test(captured.reviewSha256 ?? '')) return null;
    const possible = [{kind:'capture',id:captured.sourceSha256,revision:captured.reviewSha256}];
    for (const name of (await readdir(join(root,'refresh'))).filter(name=>HASH.test(name)).sort()) {
      try {
        const record = await readRecord({kind:'refresh',id:name},join(root,'refresh',name));
        if (record.sourceSha256 === captured.sourceSha256)
          possible.push({kind:'refresh',id:name,revision:captured.reviewSha256});
      } catch (error) {if (error.code !== 'ENOENT') throw error;}
    }
    for (const selected of possible) {
      const {directory} = await location(selected);
      const reviews = join(directory,selected.kind==='refresh'?'candidate/reviews':'reviews');
      if (!await exists(join(reviews,selected.revision+'.json'))) continue;
      const retained = await source(selected);
      if (retained.specText === specText) return retained.capturedSource;
    }
    return null;
  }
  return {root, entries, inspect, receive, adopt, saveDecisions, reviewer, source, checkSource, saveMerchant, copy, locate};
}
