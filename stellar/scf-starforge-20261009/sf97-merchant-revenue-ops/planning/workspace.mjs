// MIT. Saved commercial comparisons over the original SF97 review and analyzer.
import { constants } from 'node:fs';
import { mkdir, open, lstat, realpath, readdir, link, unlink } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createScenarioReview } from './scenarios.mjs';

const SCHEMA = 'stellar-forge.merchant-scenario-plan.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_BYTES = 8 * 1024 * 1024;
const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const digest = value => createHash('sha256').update(value).digest('hex');
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const fail = (code, message, status = 422) => Object.assign(new Error(message), {code, message, status});

async function privateDirectory(path, create = false) {
  if (create) await mkdir(path, {mode:0o700}).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const stat = await lstat(path);
  if (!stat.isDirectory() || stat.mode & 0o077 || await realpath(path) !== path)
    throw fail('PRIVATE_PLANNING_DIRECTORY_REQUIRED', 'Use the existing private merchant workspace.');
}
async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
function compactRow({report, ...row}) { return row; }
function compact(review) {
  return {...review, baseline:compactRow(review.baseline), scenarios:review.scenarios.map(compactRow)};
}
function summary(record) {
  return {planId:record.planId, label:record.label, savedAt:record.savedAt,
    version:record.version, sourceLabel:record.sourceLabel, selectedScenarioId:record.selectedScenarioId,
    scenarioCount:record.review.scenarios.length, reviewSha256:record.review.reviewSha256,
    source:record.source};
}

export async function openPlanningWorkspace({model, directory}) {
  if (!isAbsolute(directory ?? '') || resolve(directory) !== directory || directory === '/')
    throw fail('PRIVATE_PLANNING_DIRECTORY_REQUIRED', 'Use an absolute private merchant workspace.');
  await privateDirectory(directory);
  const plans = join(directory, 'scenario-plans'), pending = join(plans, 'pending');
  await privateDirectory(plans, true); await privateDirectory(pending, true);

  async function read(planId) {
    if (!UUID.test(planId ?? '')) throw fail('PLAN_NOT_FOUND', 'Choose a saved scenario plan.', 404);
    const handle = await open(join(plans, planId + '.json'), constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.mode & 0o077 || stat.size > MAX_BYTES)
        throw fail('SAVED_PLAN_CHANGED', 'The saved comparison has changed type, permissions or size.');
      const bytes = await handle.readFile();
      if (bytes.length > MAX_BYTES) throw fail('SAVED_PLAN_CHANGED', 'The saved comparison exceeds its supported size.');
      const envelope = JSON.parse(bytes.toString('utf8')), record = envelope.record;
      if (!record || record.schema !== SCHEMA || record.planId !== planId ||
          !HASH.test(envelope.sha256 ?? '') || digest(canonical(record)) !== envelope.sha256 ||
          !UUID.test(record.version ?? '') || !Array.isArray(record.review?.scenarios))
        throw fail('SAVED_PLAN_CHANGED', 'The saved comparison differs from its committed record.');
      return record;
    } finally { await handle.close(); }
  }
  async function existing(planId) {
    try { return await read(planId); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  async function list() {
    const names = (await readdir(plans)).filter(name => UUID.test(name.slice(0, -5)) && name.endsWith('.json'));
    // Lists stay compact; every saved plan remains addressable by its original ID.
    const dated = [];
    for (const name of names) dated.push({name, date:(await lstat(join(plans,name))).mtimeMs});
    dated.sort((a,b) => b.date - a.date || a.name.localeCompare(b.name));
    const rows = [];
    for (const item of dated.slice(0,100)) rows.push(summary(await read(item.name.slice(0,-5))));
    rows.sort((a,b) => b.savedAt.localeCompare(a.savedAt) || a.planId.localeCompare(b.planId));
    return {total:names.length, plans:rows};
  }
  async function context(version) {
    if (!UUID.test(version ?? '')) throw fail('PRICING_REVIEW_REQUIRED', 'Choose a saved pricing review.');
    return model.planningSource(version);
  }
  async function source(version) {
    const value = await context(version);
    return {version:value.version,label:value.label,savedAt:value.savedAt,routes:value.routes,
      commercial:value.commercial,provenance:value.provenance,observation:value.observationSummary,
      sellerChanged:value.sellerChanged};
  }
  async function prepare(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input))
      throw fail('SCENARIO_INPUT_REQUIRED', 'Supply the selected review and commercial scenarios.');
    const value = await context(input.version);
    const review = createScenarioReview({seller:value.seller,observation:value.observation,terms:value.terms,
      scenarios:input.scenarios,provenance:value.provenance,includeReports:false});
    return {value,review:compact(review)};
  }
  async function preview(input) {
    const {value,review} = await prepare(input);
    return {version:value.version,sourceLabel:value.label,sellerChanged:value.sellerChanged,review};
  }
  async function save(input) {
    if (!input || !UUID.test(input.requestId ?? '') || typeof input.label !== 'string' ||
        !input.label.trim() || input.label.trim().length > 100 || !HASH.test(input.reviewSha256 ?? ''))
      throw fail('PLAN_SAVE_DETAILS_REQUIRED', 'Review the scenarios and give the comparison a name before saving.');
    const request = {version:input.version,scenarios:input.scenarios,label:input.label.trim(),
      selectedScenarioId:input.selectedScenarioId ?? null,reviewSha256:input.reviewSha256};
    const requestSha256 = digest(canonical(request)), previous = await existing(input.requestId);
    function recover(record) {
      if (record.requestSha256 !== requestSha256)
        throw fail('PLAN_REQUEST_CHANGED', 'This save request already belongs to different scenario inputs.',409);
      return {status:'SCENARIO_PLAN_SAVED',recovered:true,...summary(record),record};
    }
    if (previous) return recover(previous);
    const {value,review} = await prepare(input);
    if (review.reviewSha256 !== input.reviewSha256)
      throw fail('SCENARIO_REVIEW_CHANGED', 'Calculate the current scenario inputs again before saving.',409);
    if (request.selectedScenarioId !== null && !review.scenarios.some(row => row.id === request.selectedScenarioId))
      throw fail('SCENARIO_SELECTION_REQUIRED', 'Choose one of this comparison’s scenarios.');
    const record = {schema:SCHEMA,planId:input.requestId,label:request.label,savedAt:new Date().toISOString(),
      version:value.version,sourceLabel:value.label,source:value.provenance,selectedScenarioId:request.selectedScenarioId,
      requestSha256,inputs:{scenarios:input.scenarios},review};
    const bytes = encode({sha256:digest(canonical(record)),record});
    if (bytes.length > MAX_BYTES)
      throw fail('SCENARIO_PLAN_TOO_LARGE', 'Save fewer scenarios in this comparison; each plan supports up to 8 MiB.');
    const staging = join(pending,randomUUID()+'.json'), final = join(plans,input.requestId+'.json');
    const handle = await open(staging,'wx',0o600);
    try { await handle.writeFile(bytes); await handle.sync(); }
    catch (error) { await unlink(staging).catch(()=>{}); throw error; }
    finally { await handle.close(); }
    try {
      try { await link(staging,final); }
      catch (error) { if (error.code === 'EEXIST') return recover(await read(input.requestId)); throw error; }
      await syncDirectory(plans);
      return {status:'SCENARIO_PLAN_SAVED',recovered:false,...summary(record),record};
    } finally { await unlink(staging).catch(()=>{}); }
  }
  async function load(planId) { return read(planId); }
  async function selection({planId,scenarioId} = {}) {
    const record = await read(planId), row = record.review.scenarios.find(item => item.id === scenarioId);
    if (!row) throw fail('SCENARIO_NOT_FOUND', 'Choose a saved scenario from this comparison.',404);
    // Applying is a new draft in the existing workspace; its normal save keeps
    // the current capture and revision. A different seller requires a new plan.
    const current = await model.loadVersion(record.version);
    if (current.sellerSha256 !== record.source.seller)
      throw fail('SCENARIO_SELLER_CHANGED', 'The seller configuration changed. Save a current pricing review and create a new comparison before applying this plan.',409);
    return {planId,scenarioId,label:record.label,scenarioLabel:row.label,version:record.version,
      sellerSha256:current.sellerSha256,commercial:structuredClone(row.commercial),
      reviewSha256:record.review.reviewSha256};
  }
  async function download(planId, name) {
    const record = await read(planId);
    if (name === 'plan.json') return encode(record);
    if (name === 'comparison.csv') {
      const quote = value => '"'+String(value ?? '').replaceAll('"','""')+'"';
      const rows = [record.review.baseline,...record.review.scenarios];
      const data = [['Scenario','Planned paid requests','Gross USD','Variable cost USD','Contribution before fixed USD',
        'Fixed cost USD','Contribution after fixed USD','Margin after fixed percent','Source review'],
      ...rows.map(row => [/^[=+\-@\t\r]/.test(row.label) ? "'"+row.label : row.label,row.metrics.plannedPaidRequests,row.metrics.grossUsd,row.metrics.variableCostsUsd,
        row.metrics.contributionBeforeFixedUsd,row.metrics.sharedFixedUsd,row.metrics.contributionAfterFixedUsd,
        row.metrics.marginAfterFixedPct,record.version])];
      return Buffer.from('\uFEFF'+data.map(row => row.map(quote).join(',')).join('\r\n')+'\r\n');
    }
    const match = /^terms-([a-zA-Z0-9_-]+)\.json$/.exec(name);
    const row = match && record.review.scenarios.find(item => item.id === match[1]);
    if (row) return encode(row.terms);
    throw fail('PLAN_FILE_NOT_FOUND', 'Choose a file from this saved comparison.',404);
  }
  return {source,preview,save,load,selection,list,download};
}
