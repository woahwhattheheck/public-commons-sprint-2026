// MIT. Private versions around the original SF97 analyzer and native companion.
import { constants } from 'node:fs';
import { mkdir, open, lstat, realpath, readdir, rename, link, rm } from 'node:fs/promises';
import { isAbsolute, resolve, join, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { merchantRoutes, merchantTerms, analyze, createReport, readJson, liveSnapshot } from '../analyze.mjs';
import { normalizeTrafficHistoryReport } from '../../sf30-seller-sdk/operations/history.mjs';

const MAX_BYTES = 64 * 1024 * 1024;
const REVISION = /^[a-f0-9]{64}$/;
const VERSION = /^[a-f0-9-]{36}$/;
const SESSION = 'SESSION', PERIOD = 'DURABLE_HISTORY';
const SCHEMAS = {[SESSION]:'stellar-forge.seller-traffic.v1',[PERIOD]:'stellar-forge.seller-usage-history.v1'};
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
    if (bytes.length > MAX_BYTES) throw fault('SAVED_FILE_TOO_LARGE', 'Saved file exceeds 64 MiB.');
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
    observationKind:entry.value.observationKind ?? SESSION,
    sourceFile:entry.value.sourceFile ?? 'snapshot.json',
    observation:entry.value.observation ?? null, sourceSelection:entry.value.sourceSelection ?? null,
    overview:entry.value.overview, native:entry.value.native,
    files:Object.keys(entry.value.files)};
}

function observationMetadata(source) {
  const raw = source.normalized ?? source.value, period = source.kind === PERIOD;
  const modes = period ? raw.modes : [raw.mode];
  return {kind:source.kind,schema:raw.schema,sha256:source.hash,
    sessionId:period ? null : raw.sessionId,
    sessionIds:period ? raw.sessions.map(session => session.sessionId) : [raw.sessionId],
    mode:modes.length > 1 ? 'MIXED' : modes[0] ?? 'UNKNOWN',modes,
    capturedAt:period ? raw.generatedAt : raw.capturedAt,startedAt:period ? null : raw.startedAt,
    range:period ? raw.range : null,days:period ? raw.days : [],sessions:period ? raw.sessions : [],
    routes:raw.routes,storage:period ? raw.storage : null,
    retentionDays:period ? raw.retentionDays : null,semantics:period ? raw.semantics : null};
}
function savedObservation(source) {
  const observation = observationMetadata(source);
  // Coverage metadata belongs in the version index; detailed counters remain in
  // the exact original source and report, without duplicating them in each index.
  return {...observation,days:observation.days.map(({day,sessions}) => ({day,sessions})),
    sessions:observation.sessions.map(({retainedDays,...session}) => session),
    routes:observation.routes.map(({id,method,path,routeKey}) => ({id,method,path,routeKey}))};
}
function calendarDay(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value+'T00:00:00.000Z')) &&
    new Date(value+'T00:00:00.000Z').toISOString().slice(0,10) === value;
}

export async function openWorkspace({config, directory, snapshot, history:historyFile, opsUrl, nativeOutbox} = {}) {
  if (!isAbsolute(directory ?? '') || resolve(directory) !== directory || directory === '/')
    throw fault('ABSOLUTE_WORKSPACE_REQUIRED', 'Workspace must be an absolute, normalized private directory.');
  if (!config || !(snapshot || historyFile || opsUrl) || (opsUrl && (snapshot || historyFile)))
    throw fault('SOURCE_REQUIRED', 'Supply a seller configuration and original snapshot/history files, or one live operations URL.');
  const configPath = resolve(config);
  let liveOrigin, defaultSelection = {kind:snapshot ? SESSION : PERIOD,from:null,to:null,routeId:null};
  let sessionEndpoint = '/api/snapshot', historyEndpoint = '/api/history';
  if (opsUrl) {
    const url = new URL(opsUrl);
    if (url.pathname === '/') url.pathname = '/api/snapshot';
    if (url.protocol !== 'http:' || !['127.0.0.1','localhost'].includes(url.hostname) || !url.port ||
        url.username || url.password || url.hash ||
        !['/api/snapshot','/export.json','/api/history','/history.json'].includes(url.pathname))
      throw fault('LOCAL_OPERATIONS_REQUIRED', 'Use the original loopback operations URL.');
    const period = ['/api/history','/history.json'].includes(url.pathname);
    if ([...url.searchParams.keys()].some(key => !period || !['from','to','routeId'].includes(key) || url.searchParams.getAll(key).length !== 1))
      throw fault('ORIGINAL_HISTORY_QUERY_REQUIRED','Use only the original from, to and routeId history parameters.');
    liveOrigin = url.origin;
    if (period) historyEndpoint = url.pathname; else sessionEndpoint = url.pathname;
    defaultSelection = {kind:period ? PERIOD : SESSION,from:url.searchParams.get('from'),
      to:url.searchParams.get('to'),routeId:url.searchParams.get('routeId')};
  }
  const files = new Map([[SESSION,snapshot],[PERIOD,historyFile]].filter(([,path]) => path));
  const sourceCapabilities = {kinds:opsUrl ? [SESSION,PERIOD] : [...files.keys()],
    live:Boolean(opsUrl),periodEditable:Boolean(opsUrl)};
  function select(input = defaultSelection) {
    if (!input || typeof input !== 'object' || Array.isArray(input) ||
        Object.keys(input).some(key => !['kind','from','to','routeId'].includes(key)) ||
        !sourceCapabilities.kinds.includes(input.kind))
      throw fault('SOURCE_SELECTION_REQUIRED','Choose one of the configured original sources.');
    const selection = {kind:input.kind,from:input.from ?? null,to:input.to ?? null,routeId:input.routeId ?? null};
    if (selection.kind === SESSION || !opsUrl) {
      if ([selection.from,selection.to,selection.routeId].some(value => value !== null))
        throw fault('FIXED_SOURCE_RANGE','A saved export keeps its original range; date filters apply to live retained history.');
    } else {
      for (const value of [selection.from,selection.to]) if (value !== null && !calendarDay(value))
        throw fault('INVALID_PERIOD','Use actual UTC dates in YYYY-MM-DD form.');
      if (selection.from && selection.to && (selection.from > selection.to ||
          Date.parse(selection.to) - Date.parse(selection.from) > 365 * 86400000))
        throw fault('INVALID_PERIOD','Choose an ordered original history range no longer than 366 days.');
      if (selection.routeId !== null && !(typeof selection.routeId === 'string' &&
          (/^[A-Za-z0-9_-]{1,80}$/.test(selection.routeId) || ['@unmatched','@method','@invalid'].includes(selection.routeId))))
        throw fault('INVALID_ROUTE_FILTER','Use an original seller route ID.');
    }
    return selection;
  }
  defaultSelection = select(defaultSelection);
  async function seller() {
    const source = await readJson(configPath, 'seller config');
    return {...source, routes:merchantRoutes(source.value)};
  }
  await seller();
  await privateDirectory(directory, true);
  for (const name of ['versions','successors','pending']) await privateDirectory(join(directory,name), true);
  const captures = new Map();
  async function capture(selection) {
    let result;
    if (opsUrl) {
      const url = new URL(selection.kind === PERIOD ? historyEndpoint : sessionEndpoint,liveOrigin);
      if (selection.kind === PERIOD) for (const key of ['from','to','routeId'])
        if (selection[key] !== null) url.searchParams.set(key,selection[key]);
      result = await liveSnapshot(url.href);
    } else result = await readJson(resolve(files.get(selection.kind)),selection.kind === PERIOD ? 'original history' : 'operations snapshot');
    if (result.value?.schema !== SCHEMAS[selection.kind])
      throw fault('SOURCE_KIND_CHANGED','The configured source does not contain the selected original observation kind.');
    if (selection.kind === PERIOD && result.value.enabled === false)
      throw fault('HISTORY_UNAVAILABLE','Retained history is disabled on this operations listener. Enable its original history directory before selecting a period.');
    result = {...result,kind:selection.kind,selection,
      normalized:selection.kind === PERIOD ? normalizeTrafficHistoryReport(result.value) : null};
    observationMetadata(result); // Do not cache a source with unreadable original coverage metadata.
    captures.delete(result.hash); captures.set(result.hash, result);
    let retainedBytes = [...captures.values()].reduce((size,capture) => size+capture.bytes.length,0);
    while (captures.size > 1 && (captures.size > 16 || retainedBytes > MAX_BYTES)) {
      const first = captures.keys().next().value;
      retainedBytes -= captures.get(first).bytes.length; captures.delete(first);
    }
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
  async function state(input) {
    const selection = select(input);
    const [source, entries] = await Promise.all([seller(), history()]);
    const latest = entries.at(-1);
    const terms = latest ? JSON.parse((await savedFile(latest,'terms.json')).toString('utf8')) : null;
    let observed = null, sourceError = null;
    try {
      observed = observationMetadata(await capture(selection));
    } catch (error) { sourceError = error.status ? error.message :
      'The selected original operations source is unavailable. Restore it, then refresh operations.'; }
    return {schema:'stellar-forge.merchant-pricing-workspace.v1', revision:latest?.revision ?? null,
      seller:{name:basename(configPath),sha256:source.hash,routes:source.routes},
      sellerChanged:Boolean(latest && latest.value.sellerSha256 !== source.hash),
      commercial:commercialInputs(terms,source.routes), snapshot:observed, sourceError,
      sourceCapabilities,selection,
      nativeAttached:Boolean(nativeOutbox), history:entries.slice(-100).reverse().map(summary)};
  }
  async function prepared(input) {
    const source = await seller();
    if (input.sellerSha256 !== source.hash)
      throw fault('SELLER_CHANGED', 'Seller configuration changed. Refresh and review the current payment choices.', 409);
    const observed = captures.get(input.snapshotSha256);
    if (!observed) throw fault('SNAPSHOT_EXPIRED', 'Refresh operations to capture the selected original source again.', 409);
    const terms = merchantTerms(source.value,input.commercial), termsBytes = encode(terms);
    const report = analyze(source.value,observed.value,terms,
      {seller:source.hash,terms:digest(termsBytes),snapshot:observed.hash,
        ...(observed.kind === PERIOD ? {history:observed.hash} : {})});
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
    const sourceFile = observed.kind === PERIOD ? 'history.json' : 'snapshot.json';
    const version = randomUUID(), pending = join(directory,'pending',version), final = join(directory,'versions',version);
    await privateDirectory(pending,true); let published = false, moved = false;
    try {
      for (const [name,bytes] of [['seller.json',source.bytes],[sourceFile,observed.bytes],['terms.json',termsBytes]])
        await writeOnce(join(pending,name),bytes);
      const result = await createReport(['--config',join(pending,'seller.json'),'--terms',join(pending,'terms.json'),
        observed.kind === PERIOD ? '--history' : '--snapshot',join(pending,sourceFile),'--output',join(pending,'report'),
        ...(nativeOutbox ? ['--native-outbox',resolve(nativeOutbox)] : [])]);
      const files = await filesIn(pending);
      const value = {schema:'stellar-forge.merchant-pricing-version.v1',version,
        previousRevision:input.expectedRevision,requestId:input.requestId,requestSha256,
        label:input.label.trim(),savedAt:new Date().toISOString(),sellerSha256:source.hash,
        snapshotSha256:observed.hash,sessionId:report.sessionId,overview:report.overview,
        observationKind:observed.kind,sourceFile,sourceSelection:observed.selection,
        observation:savedObservation(observed),
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
  async function compare({leftVersion,rightVersion} = {}) {
    if (!VERSION.test(leftVersion) || !VERSION.test(rightVersion))
      throw fault('TWO_REVIEWS_REQUIRED','Choose two saved reviews to compare.');
    const entries = await history();
    async function review(version) {
      const entry = entries.find(item => item.value.version === version);
      if (!entry) throw fault('VERSION_NOT_FOUND','A selected saved review is unavailable.',404);
      const report = JSON.parse((await savedFile(entry,'report/report.json')).toString('utf8'));
      return {entry,value:{...summary(entry),report}};
    }
    const [left,right] = await Promise.all([review(leftVersion),review(rightVersion)]);
    const range = side => side.value.report.usageHistory?.range ?? side.value.observation?.range ??
      {from:side.value.report.observedFrom,to:side.value.report.observedUntil};
    return {left:left.value,right:right.value,compatibility:{
      sameSellerConfiguration:left.entry.value.sellerSha256 === right.entry.value.sellerSha256,
      sameCommercialTerms:left.entry.value.files['terms.json'].sha256 === right.entry.value.files['terms.json'].sha256,
      sameObservationKind:left.value.observationKind === right.value.observationKind,
      sameRange:canonical(range(left)) === canonical(range(right))}};
  }
  return {state,preview,save,download,loadVersion,compare};
}
