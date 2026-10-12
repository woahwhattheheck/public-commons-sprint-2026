// MIT. Private versions around the original SF97 analyzer and native companion.
import { constants } from 'node:fs';
import { mkdir, open, lstat, realpath, readdir, rename, link, rm } from 'node:fs/promises';
import { isAbsolute, resolve, join, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { merchantRoutes, merchantTerms, analyze, createReport, readJson, liveSnapshot } from '../analyze.mjs';
import { normalizeTrafficHistoryReport } from '../../sf30-seller-sdk/operations/history.mjs';
import { resolveSellerConfigPaths, validateSellerServiceConfig } from '../../sf30-seller-sdk/serve.mjs';
import { openEconomics } from '../economics/model.mjs';
import { requireCompletedRestore } from '../economics/archive.mjs';

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

export async function openWorkspace({config, directory, snapshot, history:historyFile, opsUrl, nativeOutbox,
  sourcePackage, releaseStore, releaseRuntime = {}, supplierUsage, accountingReport, expectedConfigSha256} = {}) {
  if (!isAbsolute(directory ?? '') || resolve(directory) !== directory || directory === '/')
    throw fault('ABSOLUTE_WORKSPACE_REQUIRED', 'Workspace must be an absolute, normalized private directory.');
  if (!config || !(snapshot || historyFile || opsUrl) || (opsUrl && (snapshot || historyFile)))
    throw fault('SOURCE_REQUIRED', 'Supply a seller configuration and original snapshot/history files, or one live operations URL.');
  const configPath = resolve(config);
  if (expectedConfigSha256 !== undefined &&
      (typeof expectedConfigSha256 !== 'string' || !REVISION.test(expectedConfigSha256)))
    throw fault('INVALID_CONFIG_SHA256', 'Use the reviewed seller configuration SHA-256.');
  if (releaseStore && !sourcePackage)
    throw fault('RELEASE_SOURCE_REQUIRED', 'Configure the original API merchant source package before staging price releases.');
  if (!releaseRuntime || typeof releaseRuntime !== 'object' || Array.isArray(releaseRuntime))
    throw fault('RELEASE_RUNTIME_REQUIRED', 'Use an original release runtime object.');
  const stageRuntime = structuredClone(releaseRuntime);
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
  const openedSeller = await seller();
  if (expectedConfigSha256 !== undefined && openedSeller.hash !== expectedConfigSha256)
    throw fault('SELLER_CHANGED', 'Seller configuration changed after application review. Review its current bytes before starting.',409);
  // This identity belongs to the initial original read. Later source refreshes
  // keep the same seller()/save semantics and do not inherit a permanent pin.
  const launch = Object.freeze({state:directory,configPath,configSha256:openedSeller.hash});
  await privateDirectory(directory, true);
  await requireCompletedRestore(directory);
  for (const name of ['versions','successors','pending','decisions','decision-successors','staged-releases'])
    await privateDirectory(join(directory,name), true);
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
      nativeAttached:Boolean(nativeOutbox), history:entries.slice(-100).reverse().map(summary),
      repricing:await repricingState()};
  }
  async function prepared(input, fixedObservation = null) {
    const source = await seller();
    if (input.sellerSha256 !== source.hash)
      throw fault('SELLER_CHANGED', 'Seller configuration changed. Refresh and review the current payment choices.', 409);
    const observed = fixedObservation ?? captures.get(input.snapshotSha256);
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
  async function save(input, costContext = null) {
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
    const {source,observed,termsBytes,report} = await prepared(input,costContext?.observed);
    const sourceFile = observed.kind === PERIOD ? 'history.json' : 'snapshot.json';
    const version = randomUUID(), pending = join(directory,'pending',version), final = join(directory,'versions',version);
    await privateDirectory(pending,true); let published = false, moved = false;
    try {
      for (const [name,bytes] of [['seller.json',source.bytes],[sourceFile,observed.bytes],['terms.json',termsBytes]])
        await writeOnce(join(pending,name),bytes);
      if (costContext) for (const [name,bytes] of Object.entries(costContext.files))
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
        native:result.native,...(costContext ? {costOrigin:costContext.binding} : {}),files};
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
  function decisionSummary(entry) {
    const value = entry.value;
    return {decision:value.decision,revision:entry.revision,requestId:value.requestId,label:value.label,savedAt:value.savedAt,
      sourceVersion:value.sourceVersion,sourceLabel:value.sourceLabel,sourceRevision:value.sourceRevision,
      sellerSha256:value.sellerSha256,proposedSellerSha256:value.proposedSellerSha256,
      reviewSha256:value.reviewSha256,changes:value.changes,sourcePackageAvailable:Boolean(value.sourcePackage),
      sourcePackage:value.sourcePackage,files:[...Object.keys(value.files),'manifest.json']};
  }
  async function decisionHistory() {
    const entries = []; let previous = null;
    for (;;) {
      let bytes;
      try { bytes = await privateBytes(join(directory,'decision-successors',(previous ?? 'root')+'.json')); }
      catch (error) { if (error.code === 'ENOENT') return entries; throw error; }
      const revision = digest(bytes), value = JSON.parse(bytes.toString('utf8'));
      if (value.schema !== 'stellar-forge.merchant-repricing-decision.v1' ||
          value.previousRevision !== previous || !VERSION.test(value.decision) ||
          !VERSION.test(value.sourceVersion) || !REVISION.test(value.reviewSha256) ||
          !value.files || typeof value.files !== 'object')
        throw fault('INVALID_PRICE_DECISION','A saved price decision has an invalid predecessor or manifest.');
      await privateDirectory(join(directory,'decisions',value.decision));
      const original = await privateBytes(join(directory,'decisions',value.decision,'manifest.json'));
      if (!original.equals(bytes)) throw fault('PRICE_MANIFEST_CHANGED','The saved price decision manifest has changed.');
      entries.push({revision,value}); previous = revision;
    }
  }
  async function decisionFile(entry,name) {
    const expected = entry.value.files[name];
    if (!expected || name.split('/').some(part => !part || part === '.' || part === '..'))
      throw fault('FILE_NOT_FOUND','This file is not part of the saved price decision.',404);
    const path = join(directory,'decisions',entry.value.decision,...name.split('/'));
    if (await realpath(path) !== path) throw fault('PRICE_FILE_CHANGED','Saved price decision path has changed.');
    const bytes = await privateBytes(path);
    if (bytes.length !== expected.bytes || digest(bytes) !== expected.sha256)
      throw fault('PRICE_FILE_CHANGED','Saved price decision bytes differ from its committed manifest.');
    return bytes;
  }
  async function stageReceipt(decision) {
    try { return JSON.parse((await privateBytes(join(directory,'staged-releases',decision+'.json'))).toString('utf8')); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function repricingState() {
    const entries = await decisionHistory();
    return {revision:entries.at(-1)?.revision ?? null,sourcePackageAvailable:Boolean(sourcePackage),
      releaseAvailable:Boolean(sourcePackage && releaseStore),
      history:await Promise.all(entries.slice(-100).reverse().map(async entry => {
        const {changes,...saved} = decisionSummary(entry);
        return {...saved,changedPaymentOptions:changes.length,
          changedRoutes:new Set(changes.map(change => change.routeId)).size,
          release:(await stageReceipt(entry.value.decision))?.release ?? null};
      }))};
  }
  async function originalPricing(version) {
    if (!VERSION.test(version)) throw fault('VERSION_NOT_FOUND','Choose a saved pricing review.',404);
    const entry = (await history()).find(item => item.value.version === version);
    if (!entry) throw fault('VERSION_NOT_FOUND','The selected saved pricing review is unavailable.',404);
    const [sellerBytes,termsBytes] = await Promise.all([savedFile(entry,'seller.json'),savedFile(entry,'terms.json')]);
    return {entry,sellerBytes,termsBytes,sellerValue:JSON.parse(sellerBytes.toString('utf8')),
      termsValue:JSON.parse(termsBytes.toString('utf8'))};
  }
  async function planningSource(version) {
    const [original,current] = await Promise.all([originalPricing(version),seller()]);
    const sourceFile = original.entry.value.sourceFile ?? 'snapshot.json';
    const observationBytes = await savedFile(original.entry,sourceFile);
    const observation = JSON.parse(observationBytes.toString('utf8'));
    const savedReport = JSON.parse((await savedFile(original.entry,'report/report.json')).toString('utf8'));
    const selectedRoutes = new Set(savedReport.routes.map(route => route.routeId));
    const routes = merchantRoutes(validateSellerServiceConfig(original.sellerValue)).filter(route => selectedRoutes.has(route.routeId));
    return {version,label:original.entry.value.label,savedAt:original.entry.value.savedAt,
      seller:original.sellerValue,terms:original.termsValue,observation,routes,
      commercial:commercialInputs(original.termsValue,routes),
      sellerChanged:current.hash !== digest(original.sellerBytes),
      observationSummary:original.entry.value.observation ?? {
        kind:original.entry.value.observationKind ?? SESSION,sessionId:observation.sessionId ?? null,
        range:observation.range ?? null},
      provenance:{seller:digest(original.sellerBytes),terms:digest(original.termsBytes),
        snapshot:digest(observationBytes),...(sourceFile === 'history.json' ? {history:digest(observationBytes)} : {})}};
  }
  async function repricingSource(version) {
    const [original,current,decisions] = await Promise.all([originalPricing(version),seller(),decisionHistory()]);
    const routes = merchantRoutes(validateSellerServiceConfig(original.sellerValue));
    return {version,label:original.entry.value.label,sellerSha256:digest(original.sellerBytes),routes,
      commercial:commercialInputs(original.termsValue,routes),
      sellerChanged:current.hash !== digest(original.sellerBytes),
      repricingRevision:decisions.at(-1)?.revision ?? null,sourcePackageAvailable:Boolean(sourcePackage),
      releaseAvailable:Boolean(sourcePackage && releaseStore)};
  }
  async function preparedRepricing(input) {
    if (!input || !REVISION.test(input.sellerSha256))
      throw fault('PRICE_SOURCE_REQUIRED','Choose the saved seller source before reviewing new prices.');
    const original = await originalPricing(input.version), current = await seller();
    const sellerSha256 = digest(original.sellerBytes);
    if (input.sellerSha256 !== sellerSha256 || current.hash !== sellerSha256)
      throw fault('SELLER_CHANGED','The configured seller differs from this saved pricing review. Save a review of its current configuration before preparing new prices.',409);
    const {createRepricingReview} = await import('./repricing.mjs');
    const core = createRepricingReview({seller:original.sellerValue,edits:input.edits});
    const proposedBytes = encode(core.proposedSeller);
    const launchBytes = encode(resolveSellerConfigPaths(structuredClone(core.proposedSeller),configPath));
    if (proposedBytes.length > 1024*1024 || launchBytes.length > 1024*1024)
      throw fault('SELLER_CONFIG_TOO_LARGE','The repriced seller exceeds its original 1 MiB configuration limit.');
    const termsBytes = encode(merchantTerms(core.proposedSeller,
      commercialInputs(original.termsValue,merchantRoutes(core.proposedSeller))));
    const source = sourcePackage
      ? await (await import('./repricing-source.mjs')).prepareRepricingSource(resolve(sourcePackage),core) : null;
    const review = {schema:'stellar-forge.merchant-repricing-preview.v1',sourceVersion:input.version,
      sourceRevision:original.entry.revision,sourceLabel:original.entry.value.label,
      sellerSha256,proposedSellerSha256:digest(proposedBytes),launchSellerSha256:digest(launchBytes),
      termsSha256:digest(termsBytes),edits:core.edits,changes:core.changes,routes:core.routes,
      changedRoutes:core.changedRoutes,changedPaymentOptions:core.changedPaymentOptions,
      sourcePackage:source?.review ?? null};
    return {original,core,proposedBytes,launchBytes,termsBytes,source,
      review:{...review,reviewSha256:digest(canonical(review))}};
  }
  async function previewRepricing(input) { return (await preparedRepricing(input)).review; }
  async function saveRepricing(input) {
    if (!input || !VERSION.test(input.requestId) || !REVISION.test(input.reviewSha256) ||
        !(input.expectedRevision === null || REVISION.test(input.expectedRevision)) ||
        typeof input.label !== 'string' || !input.label.trim() || input.label.length > 100)
      throw fault('PRICE_SAVE_DETAILS_REQUIRED','Use a decision name, reviewed changes, request ID and current price decision revision.');
    const requestSha256 = digest(canonical(input)), entries = await decisionHistory();
    const existing = entries.find(entry => entry.value.requestId === input.requestId);
    if (existing) {
      if (existing.value.requestSha256 !== requestSha256)
        throw fault('REQUEST_CHANGED','This price decision request was already used for different inputs.',409);
      return {status:'PRICE_DECISION_SAVED',...decisionSummary(existing),recovered:true};
    }
    if ((entries.at(-1)?.revision ?? null) !== input.expectedRevision)
      throw fault('PRICE_REVISION_CHANGED','Another tab saved a price decision. Reload the saved decisions and review your changes.',409);
    const prepared = await preparedRepricing(input);
    if (prepared.review.reviewSha256 !== input.reviewSha256)
      throw fault('PRICE_REVIEW_CHANGED','The selected prices or source package differ from the displayed review. Review them again before saving.',409);
    const {original,core,review,source} = prepared;
    const reportBytes = await savedFile(original.entry,'report/report.json');
    const decision = randomUUID(), pending = join(directory,'pending',decision), final = join(directory,'decisions',decision);
    await privateDirectory(pending,true); let published = false, moved = false;
    try {
      for (const [name,bytes] of [['seller.json',prepared.proposedBytes],['launch-seller.json',prepared.launchBytes],
        ['source-seller.json',original.sellerBytes],['terms.json',prepared.termsBytes],
        ['source-terms.json',original.termsBytes],['pricing-report.json',reportBytes],
        ['decision.json',encode({...review,coreReview:core})]]) await writeOnce(join(pending,name),bytes);
      if (source) await (await import('./repricing-source.mjs')).writeRepricingSource(source,pending,final);
      const files = await filesIn(pending);
      const value = {schema:'stellar-forge.merchant-repricing-decision.v1',decision,
        previousRevision:input.expectedRevision,requestId:input.requestId,requestSha256,
        label:input.label.trim(),savedAt:new Date().toISOString(),sourceVersion:input.version,
        sourceRevision:original.entry.revision,sourceLabel:original.entry.value.label,
        sellerSha256:review.sellerSha256,proposedSellerSha256:review.proposedSellerSha256,
        reviewSha256:review.reviewSha256,changes:review.changes,sourcePackage:source?.review ?? null,files};
      const manifest = encode(value), revision = digest(manifest);
      await writeOnce(join(pending,'manifest.json'),manifest); await syncDirectory(pending);
      await rename(pending,final); moved = true; await syncDirectory(join(directory,'decisions'));
      try { await link(join(final,'manifest.json'),join(directory,'decision-successors',(input.expectedRevision ?? 'root')+'.json')); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const winner = (await decisionHistory()).find(entry => entry.value.requestId === input.requestId);
        if (winner?.value.requestSha256 === requestSha256)
          return {status:'PRICE_DECISION_SAVED',...decisionSummary(winner),recovered:true};
        throw fault('PRICE_REVISION_CHANGED','Another price decision saved first. Reload the decisions and review your retained form.',409);
      }
      published = true; await syncDirectory(join(directory,'decision-successors'));
      return {status:'PRICE_DECISION_SAVED',...decisionSummary({revision,value}),recovered:false};
    } finally {
      if (!published) await rm(moved ? final : pending,{recursive:true,force:true}).catch(()=>{});
    }
  }
  async function findDecision(decision) {
    if (!VERSION.test(decision)) throw fault('PRICE_DECISION_NOT_FOUND','Saved price decision not found.',404);
    const entry = (await decisionHistory()).find(item => item.value.decision === decision);
    if (!entry) throw fault('PRICE_DECISION_NOT_FOUND','Saved price decision not found.',404);
    return entry;
  }
  async function downloadRepricing(decision,name) {
    const entry = await findDecision(decision);
    if (name === 'manifest.json') return encode(entry.value);
    return decisionFile(entry,name);
  }
  async function stageRepricing({decision,reviewSha256} = {}) {
    if (!releaseStore) throw fault('RELEASE_STORE_REQUIRED','Configure the original seller release store to stage this saved decision.');
    const entry = await findDecision(decision);
    if (!entry.value.sourcePackage) throw fault('RELEASE_SOURCE_REQUIRED','This decision has no retained original API merchant package.');
    if (reviewSha256 !== entry.value.reviewSha256)
      throw fault('PRICE_REVIEW_CHANGED','Reload the saved price decision before staging its release.',409);
    const previous = await stageReceipt(decision);
    if (previous && previous.releaseStore !== resolve(releaseStore))
      throw fault('STAGED_RELEASE_CHANGED','This saved decision is already staged in a different configured release store.',409);
    // Verify the committed package and its complete files before original SF82
    // reads it. Staging always uses this retained decision, never authoring paths.
    for (const name of Object.keys(entry.value.files)) await decisionFile(entry,name);
    const {stageRepricingSource} = await import('./repricing-source.mjs');
    const result = await stageRepricingSource({directory:join(directory,'decisions',decision),
      releaseStore:resolve(releaseStore),runtime:stageRuntime,id:'pricing-'+decision,label:entry.value.label});
    const value = {schema:'stellar-forge.merchant-repricing-stage.v1',decision,reviewSha256,
      releaseStore:resolve(releaseStore),release:result.release};
    if (previous) {
      if (canonical(previous) !== canonical(value))
        throw fault('STAGED_RELEASE_CHANGED','The retained staging result differs from this configured original release.',409);
      return {...result,recovered:true};
    }
    const pending = join(directory,'pending','stage-'+randomUUID()+'.json');
    try {
      await writeOnce(pending,encode(value));
      try { await link(pending,join(directory,'staged-releases',decision+'.json')); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (canonical(await stageReceipt(decision)) !== canonical(value))
          throw fault('STAGED_RELEASE_CHANGED','Another staging result is already retained for this decision.',409);
      }
      await syncDirectory(join(directory,'staged-releases'));
    } finally { await rm(pending,{force:true}).catch(()=>{}); }
    return result;
  }

  async function economicsSource(version) {
    const original=await originalPricing(version),entry=original.entry;
    const reportBytes=await savedFile(entry,'report/report.json'),current=await seller().catch(()=>null);
    return {version:entry.value.version,revision:entry.revision,label:entry.value.label,
      sellerSha256:entry.value.sellerSha256,sellerChanged:current?.hash!==entry.value.sellerSha256,
      reportBytes,report:JSON.parse(reportBytes.toString('utf8')),
      commercial:commercialInputs(original.termsValue,merchantRoutes(original.sellerValue)),
      files:{...entry.value.files,'manifest.json':{bytes:encode(entry.value).length,sha256:entry.revision}},
      readFile:name=>name==='manifest.json'?privateBytes(join(directory,'versions',version,'manifest.json')):savedFile(entry,name)};
  }
  async function fixedCostSource(sourceVersion) {
    const original=await originalPricing(sourceVersion),entry=original.entry,kind=entry.value.observationKind??SESSION;
    const bytes=await savedFile(entry,entry.value.sourceFile??'snapshot.json'),value=JSON.parse(bytes.toString('utf8'));
    const observed={bytes,value,hash:digest(bytes),kind,selection:entry.value.sourceSelection??{kind,from:null,to:null,routeId:null},
      normalized:kind===PERIOD?normalizeTrafficHistoryReport(value):null};
    observationMetadata(observed);return {original,observed};
  }
  async function previewCostPricing({sourceVersion,commercial}) {
    const {original,observed}=await fixedCostSource(sourceVersion);
    const terms=merchantTerms(original.sellerValue,commercial),termsBytes=encode(terms);
    return analyze(original.sellerValue,observed.value,terms,{seller:digest(original.sellerBytes),terms:digest(termsBytes),
      snapshot:observed.hash,...(observed.kind===PERIOD?{history:observed.hash}:{})});
  }
  async function saveCostPricing({sourceVersion,commercial,requestId,expectedRevision,label,costBinding,costFiles}) {
    const {original,observed}=await fixedCostSource(sourceVersion);
    return save({requestId,expectedRevision,label,sellerSha256:digest(original.sellerBytes),snapshotSha256:observed.hash,
      commercial,costProposal:costBinding},{observed,binding:costBinding,files:costFiles});
  }
  async function scenarioBackup() {
    const folder=join(directory,'scenario-plans');let names;
    try{await privateDirectory(folder);names=await readdir(folder);}
    catch(error){if(error.code==='ENOENT')return {files:[],plans:[]};throw error;}
    const {openPlanningWorkspace}=await import('../planning/workspace.mjs');
    const planning=await openPlanningWorkspace({model:{planningSource},directory}),files=[],plans=[];
    for(const name of names.filter(name=>name.endsWith('.json')&&VERSION.test(name.slice(0,-5))).sort()){
      const planId=name.slice(0,-5),record=await planning.load(planId),path=join(folder,name),bytes=await privateBytes(path);
      const envelope=JSON.parse(bytes.toString('utf8')),recordHash=digest(canonical(record));
      if(envelope.sha256!==recordHash||digest(canonical(envelope.record))!==recordHash)
        throw fault('SCENARIO_BACKUP_CHANGED','A saved comparison changed while its original record was captured.',409);
      const hash=digest(bytes);
      files.push({name:'scenario-plans/'+name,read:async()=>{
        const actual=await privateBytes(path);
        if(digest(actual)!==hash)throw fault('SCENARIO_BACKUP_CHANGED','A retained comparison differs from this backup snapshot.',409);
        return actual;
      }});
      plans.push({planId,version:record.version,sha256:hash});
    }
    return {files,plans};
  }
  async function pricingBackup() {
    // Capture independent immutable plans and decisions before the pricing prefix
    // so every selected original source can be included in the same backup.
    const scenario=await scenarioBackup(),files=[...scenario.files],decisions=await decisionHistory(),pricingEntries=await history();
    const versions=new Set(pricingEntries.map(entry=>entry.value.version));
    if(scenario.plans.some(plan=>!versions.has(plan.version)))
      throw fault('SCENARIO_BACKUP_SOURCE_MISSING','A saved comparison has no matching original pricing review.');
    for(const entry of pricingEntries){
      const version=entry.value.version;
      for(const name of Object.keys(entry.value.files))files.push({name:'versions/'+version+'/'+name,read:()=>savedFile(entry,name)});
      files.push({name:'versions/'+version+'/manifest.json',read:()=>privateBytes(join(directory,'versions',version,'manifest.json'))});
      const next=(entry.value.previousRevision??'root')+'.json';
      files.push({name:'successors/'+next,read:()=>privateBytes(join(directory,'successors',next))});
    }
    for(const entry of decisions){
      const decision=entry.value.decision;
      for(const name of Object.keys(entry.value.files))files.push({name:'decisions/'+decision+'/'+name,read:()=>decisionFile(entry,name)});
      files.push({name:'decisions/'+decision+'/manifest.json',read:()=>privateBytes(join(directory,'decisions',decision,'manifest.json'))});
      const next=(entry.value.previousRevision??'root')+'.json';
      files.push({name:'decision-successors/'+next,read:()=>privateBytes(join(directory,'decision-successors',next))});
      if(await stageReceipt(decision))files.push({name:'staged-releases/'+decision+'.json',
        read:()=>privateBytes(join(directory,'staged-releases',decision+'.json'))});
    }
    return {files,scenarioPlans:scenario.plans,pricingVersions:pricingEntries.map(entry=>entry.value.version),
      requiredCostEditions:pricingEntries.map(entry=>entry.value.costOrigin?.edition).filter(Boolean),
      pricingRevision:pricingEntries.at(-1)?.revision??null,decisionRevision:decisions.at(-1)?.revision??null};
  }
  const economics=await openEconomics({directory,pricingSource:economicsSource,
    listPricing:async()=>[...(await history())].reverse().map(summary),
    savePricing:saveCostPricing,previewPricing:previewCostPricing,pricingBackup,supplierUsage,accountingReport});
  return {launch,state,preview,save,download,loadVersion,compare,planningSource,repricingSource,previewRepricing,
    saveRepricing,downloadRepricing,stageRepricing,economics};
}
