// MIT. Tariff plans over the original merchant pricing and scenario workspaces.
import { constants } from 'node:fs';
import { mkdir, open, lstat, realpath, readdir, link, unlink } from 'node:fs/promises';
import { resolve, join, isAbsolute } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createTariffReview } from './model.mjs';
import { createScenarioReview } from '../planning/scenarios.mjs';
import { openPlanningWorkspace } from '../planning/workspace.mjs';

const PLAN = 'stellar-forge.merchant-tariff-plan.v1';
const BUNDLE = 'stellar-forge.merchant-tariff-portfolio.v1';
const SELECTION = 'stellar-forge.merchant-tariff-selection.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const MAX_FILE = 16 * 1024 * 1024;
const MAX_BUNDLE = 64 * 1024 * 1024;
const copy = value => structuredClone(value);
const object = value => value && typeof value === 'object' && !Array.isArray(value);
const canonical = value => JSON.stringify(value, (_, item) => object(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const hash = value => createHash('sha256').update(value).digest('hex');
const fingerprint = value => hash(canonical(value));
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const fault = (code, message, status = 422) => Object.assign(new Error(message), {code, status});
const absent = error => error.code === 'ENOENT';
function id(value, label = 'plan') {
  if (!UUID.test(value ?? '')) throw fault('TARIFF_ID_REQUIRED', 'Choose a valid ' + label + ' UUID.');
  return value;
}
async function privateDirectory(path, create = false) {
  if (create) await mkdir(path, {mode:0o700}).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const stat = await lstat(path);
  if (!stat.isDirectory() || (stat.mode & 0o077) || await realpath(path) !== path)
    throw fault('PRIVATE_TARIFF_DIRECTORY_REQUIRED', 'Use the existing private merchant pricing workspace.');
}
async function syncDirectory(path) {
  const handle = await open(path, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
function summary(record) {
  return {planId:record.planId, label:record.label, savedAt:record.savedAt, version:record.version,
    sourceLabel:record.sourceLabel, tariffReviewSha256:record.review.tariffReviewSha256,
    tariffCount:record.inputs.tariffs.length, comparisonCount:record.review.comparisons.length};
}
function stableReview(review) {
  const value = copy(review);
  delete value.generatedAt;
  return value;
}
function stableSelection(selection) {
  if (!object(selection)) throw fault('TARIFF_SELECTION_REQUIRED', 'Review one saved tariff comparison.');
  return {schema:selection.schema, planId:selection.planId, comparisonId:selection.comparisonId,
    tariffReviewSha256:selection.tariffReviewSha256, sourceSelection:selection.sourceSelection,
    scenarioPlanInput:selection.scenarioPlanInput, pricingInput:selection.pricingInput};
}

export async function openTariffWorkspace({model, directory} = {}) {
  if (!model || !isAbsolute(directory ?? '') || resolve(directory) !== directory || directory === '/')
    throw fault('PRIVATE_TARIFF_DIRECTORY_REQUIRED', 'Supply the original pricing model and absolute private workspace.');
  await privateDirectory(directory);
  const root = join(directory, 'tariff-plans'), pending = join(root, 'pending');
  const intents = join(root, 'selections'), results = join(root, 'selection-results');
  for (const path of [root, pending, intents, results]) await privateDirectory(path, true);
  const planning = await openPlanningWorkspace({model, directory});

  async function read(path) {
    const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || (stat.mode & 0o077) || stat.size > MAX_FILE)
        throw fault('TARIFF_RECORD_CHANGED', 'A saved tariff record changed type, permissions or size.');
      const bytes = await handle.readFile();
      if (bytes.length > MAX_FILE) throw fault('TARIFF_RECORD_CHANGED', 'The tariff record exceeds its supported size.');
      const envelope = JSON.parse(bytes.toString('utf8'));
      if (!HASH.test(envelope.sha256 ?? '') || fingerprint(envelope.record) !== envelope.sha256)
        throw fault('TARIFF_RECORD_CHANGED', 'The tariff record differs from its saved contents.');
      return envelope.record;
    } finally { await handle.close(); }
  }
  async function maybe(path) {
    try { return await read(path); } catch (error) { if (absent(error)) return null; throw error; }
  }
  async function writeOnce(path, record) {
    const bytes = encode({sha256:fingerprint(record), record});
    if (bytes.length > MAX_FILE) throw fault('TARIFF_RECORD_TOO_LARGE', 'Save a smaller tariff comparison.');
    const staging = join(pending, randomUUID() + '.json');
    const handle = await open(staging, 'wx', 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); }
    catch (error) { await unlink(staging).catch(() => {}); throw error; }
    finally { await handle.close(); }
    try {
      try { await link(staging, path); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        const before = await read(path);
        if (fingerprint(before) !== fingerprint(record))
          throw fault('TARIFF_REQUEST_CHANGED', 'This request already belongs to different saved inputs.', 409);
        return {record:before, recovered:true};
      }
      await syncDirectory(path.slice(0, path.lastIndexOf('/')));
      return {record, recovered:false};
    } finally { await unlink(staging).catch(() => {}); }
  }
  async function load(planId) {
    const record = await read(join(root, id(planId) + '.json')).catch(error => {
      if (absent(error)) throw fault('TARIFF_PLAN_NOT_FOUND', 'The saved tariff plan was not found.', 404);
      throw error;
    });
    if (record.schema !== PLAN || record.planId !== planId || !UUID.test(record.version ?? '') ||
        !object(record.inputs) || !Array.isArray(record.review?.comparisons))
      throw fault('TARIFF_RECORD_CHANGED', 'The saved tariff plan has an invalid shape.');
    return record;
  }
  async function allPlans() {
    const names = (await readdir(root)).filter(name => name.endsWith('.json') && UUID.test(name.slice(0, -5))).sort();
    const records = [];
    for (const name of names) records.push(await load(name.slice(0, -5)));
    return records;
  }
  async function selectionHistory() {
    const names = (await readdir(intents)).filter(name => name.endsWith('.json') && UUID.test(name.slice(0, -5)));
    const rows = [];
    for (const name of names) {
      const intent = await read(join(intents, name)), result = await maybe(join(results, name));
      rows.push({requestId:name.slice(0, -5), createdAt:intent.createdAt, planId:intent.selection.planId,
        comparisonId:intent.selection.comparisonId, status:result ? 'SAVED' : 'RESUME',
        request:intent.request, result});
    }
    return rows.sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
  }
  async function list() {
    const records = await allPlans();
    records.sort((a,b) => b.savedAt.localeCompare(a.savedAt) || a.planId.localeCompare(b.planId));
    return {total:records.length, plans:records.slice(0,100).map(summary), selections:await selectionHistory()};
  }
  async function state() {
    return {schema:'stellar-forge.merchant-tariff-workspace.v1', pricing:await model.state(), tariffs:await list()};
  }
  async function context(version) {
    id(version, 'pricing review');
    return model.planningSource(version);
  }
  async function source(version) {
    const value = await context(version);
    return {version:value.version, label:value.label, savedAt:value.savedAt, routes:value.routes,
      commercial:value.commercial, provenance:value.provenance, observation:value.observationSummary,
      sellerChanged:value.sellerChanged};
  }
  async function prepare(input) {
    if (!object(input)) throw fault('TARIFF_INPUT_REQUIRED', 'Supply a saved pricing review, tariffs and quantities.');
    const value = await context(input.version);
    const review = createTariffReview({seller:value.seller, observation:value.observation, terms:value.terms,
      tariffs:input.tariffs, volumes:input.volumes, provenance:value.provenance});
    return {value, review};
  }
  async function preview(input) {
    const {value, review} = await prepare(copy(input));
    return {version:value.version, sourceLabel:value.label, sellerChanged:value.sellerChanged, review};
  }
  async function save(raw) {
    const input = copy(raw);
    if (!object(input) || !UUID.test(input.requestId ?? '') || !HASH.test(input.tariffReviewSha256 ?? '') ||
        typeof input.label !== 'string' || !input.label.trim() || input.label.trim().length > 100)
      throw fault('TARIFF_SAVE_DETAILS_REQUIRED', 'Review the tariff comparison and give this plan a name.');
    const request = {version:input.version, tariffs:input.tariffs, volumes:input.volumes,
      label:input.label.trim(), tariffReviewSha256:input.tariffReviewSha256};
    const requestSha256 = fingerprint(request), path = join(root, input.requestId + '.json');
    const previous = await maybe(path);
    if (previous) {
      if (previous.requestSha256 !== requestSha256)
        throw fault('TARIFF_REQUEST_CHANGED', 'This save request already belongs to different tariff inputs.', 409);
      return {status:'TARIFF_PLAN_SAVED', recovered:true, ...summary(previous), record:previous};
    }
    const {value, review} = await prepare(input);
    if (review.tariffReviewSha256 !== input.tariffReviewSha256)
      throw fault('TARIFF_REVIEW_CHANGED', 'Calculate the current tariff inputs again before saving.', 409);
    const record = {schema:PLAN, planId:input.requestId, label:request.label, savedAt:new Date().toISOString(),
      version:value.version, sourceLabel:value.label, provenance:value.provenance, requestSha256,
      inputs:{tariffs:input.tariffs, volumes:input.volumes}, review};
    // A concurrent exact save may have a different wall-clock time; compare its request before returning it.
    try {
      await writeOnce(path, record);
      return {status:'TARIFF_PLAN_SAVED', recovered:false, ...summary(record), record};
    } catch (error) {
      if (error.code !== 'TARIFF_REQUEST_CHANGED') throw error;
      const winner = await load(input.requestId);
      if (winner.requestSha256 !== requestSha256) throw error;
      return {status:'TARIFF_PLAN_SAVED', recovered:true, ...summary(winner), record:winner};
    }
  }
  async function selected(planId, comparisonId) {
    const record = await load(planId), row = record.review.comparisons.find(item => item.id === comparisonId);
    if (!row?.scenario) throw fault('TARIFF_SELECTION_UNAVAILABLE', 'Choose a comparison with a positive monthly quantity.');
    const value = await context(record.version);
    if (value.sellerChanged || fingerprint(value.provenance) !== fingerprint(record.provenance))
      throw fault('TARIFF_SOURCE_CHANGED', 'The saved seller or pricing source changed. Review a current pricing source.', 409);
    const review = createScenarioReview({seller:value.seller, observation:value.observation, terms:value.terms,
      scenarios:[row.scenario], provenance:value.provenance, includeReports:false});
    return {record, row, value, review};
  }
  async function selection(raw) {
    const input = copy(raw), {record,row,review} = await selected(input.planId, input.comparisonId);
    const manifest = JSON.parse((await model.download(record.version, 'manifest.json')).toString('utf8'));
    const sourceSelection = manifest.sourceSelection ?? {kind:manifest.observationKind ?? 'SESSION',from:null,to:null,routeId:null};
    const current = await model.state(sourceSelection);
    if (!current.snapshot) throw fault('TARIFF_CAPTURE_REQUIRED', current.sourceError || 'Refresh the original operations source.');
    if (current.seller.sha256 !== record.provenance.seller)
      throw fault('TARIFF_SELLER_CHANGED', 'The current seller differs from this tariff plan.', 409);
    const label = (record.label + ' / ' + row.quantity + ' requests').slice(0,100);
    const scenarioPlanInput = {version:record.version, scenarios:[row.scenario], label,
      selectedScenarioId:row.scenario.id, reviewSha256:review.reviewSha256};
    const pricingInput = {expectedRevision:current.revision, label, sellerSha256:current.seller.sha256,
      snapshotSha256:current.snapshot.sha256, commercial:copy(review.scenarios[0].commercial)};
    const core = {schema:SELECTION, planId:record.planId, comparisonId:row.id,
      tariffReviewSha256:record.review.tariffReviewSha256, sourceSelection, scenarioPlanInput, pricingInput};
    return {...core, selectionSha256:fingerprint(core), comparison:row, scenarioReview:review,
      pricingPreview:await model.preview(pricingInput), observed:current.snapshot,
      currentPricing:{revision:current.revision,latest:current.history[0]??null,commercial:current.commercial}};
  }
  async function validateSelection(selection) {
    const core = stableSelection(selection);
    if (core.schema !== SELECTION || fingerprint(core) !== selection.selectionSha256)
      throw fault('TARIFF_SELECTION_CHANGED', 'Review the selected tariff again before saving.', 409);
    const {record,row,review} = await selected(core.planId, core.comparisonId);
    const expectedLabel = (record.label + ' / ' + row.quantity + ' requests').slice(0,100);
    const expectedPlan = {version:record.version,scenarios:[row.scenario],label:expectedLabel,
      selectedScenarioId:row.scenario.id,reviewSha256:review.reviewSha256};
    if (core.tariffReviewSha256 !== record.review.tariffReviewSha256 ||
        fingerprint(core.scenarioPlanInput) !== fingerprint(expectedPlan) ||
        fingerprint(core.pricingInput?.commercial) !== fingerprint(review.scenarios[0].commercial) ||
        core.pricingInput?.label !== expectedLabel || core.pricingInput?.sellerSha256 !== record.provenance.seller)
      throw fault('TARIFF_SELECTION_CHANGED', 'The selected fixed quote differs from its saved tariff.', 409);
    return core;
  }
  async function commitSelection(raw) {
    // Retain both complete native request bodies before either original writer runs.
    const input = copy(raw);
    id(input?.planRequestId, 'scenario request'); id(input?.pricingRequestId, 'pricing request');
    const supplied = stableSelection(input.selection);
    const request = {selection:{...supplied,selectionSha256:input.selection.selectionSha256},
      planRequestId:input.planRequestId,pricingRequestId:input.pricingRequestId};
    const requestSha256 = fingerprint(request), name = input.pricingRequestId + '.json';
    const previous = await maybe(join(intents, name)), completed = await maybe(join(results, name));
    if (previous && previous.requestSha256 !== requestSha256)
      throw fault('TARIFF_REQUEST_CHANGED', 'This pricing request already belongs to another selection.', 409);
    if (completed) return {...completed,recovered:true};
    let intent = previous;
    if (!intent) {
      const core = await validateSelection(input.selection);
      intent = {schema:'stellar-forge.merchant-tariff-selection-intent.v1',createdAt:new Date().toISOString(),
        requestSha256,request,selection:core,
        scenarioRequest:{...core.scenarioPlanInput,requestId:input.planRequestId},
        pricingRequest:{...core.pricingInput,requestId:input.pricingRequestId}};
      try { await writeOnce(join(intents,name),intent); }
      catch (error) {
        const winner = await maybe(join(intents,name));
        if (!winner || winner.requestSha256 !== requestSha256) throw error;
        intent = winner;
      }
    }
    const scenarioPlan = await planning.save(copy(intent.scenarioRequest));
    // Fresh application uses the original selection's seller check. Recovery
    // first lets the original pricing writer resolve an already-committed UUID.
    if (!previous) await planning.selection({planId:intent.scenarioRequest.requestId,
      scenarioId:intent.scenarioRequest.selectedScenarioId});
    let pricing;
    try { pricing = await model.save(copy(intent.pricingRequest)); }
    catch (error) {
      if (error.code !== 'SNAPSHOT_EXPIRED') throw error;
      const current = await model.state(intent.selection.sourceSelection);
      if (current.snapshot?.sha256 !== intent.pricingRequest.snapshotSha256)
        throw fault('TARIFF_CAPTURE_CHANGED',
          'The original operations capture changed before this pricing review saved. The scenario is retained; review a new pricing selection.',409);
      pricing = await model.save(copy(intent.pricingRequest));
    }
    const result = {status:'TARIFF_SELECTION_SAVED',planId:intent.selection.planId,
      comparisonId:intent.selection.comparisonId,scenarioPlan,pricing,recovered:false};
    await writeOnce(join(results,name),result).catch(async error => {
      const winner = await maybe(join(results,name));
      if (!winner || winner.pricing?.version !== pricing.version ||
          winner.scenarioPlan?.planId !== scenarioPlan.planId) throw error;
    });
    return result;
  }
  async function download(planId, name) {
    const record = await load(planId);
    if (name === 'plan.json') return encode(record);
    if (name === 'tariffs.json') return encode({version:record.version,...record.inputs});
    if (name !== 'comparison.csv') throw fault('TARIFF_FILE_NOT_FOUND','Choose plan.json, tariffs.json or comparison.csv.',404);
    const cell = value => {
      let text = String(value ?? '');
      if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
      return '"' + text.replaceAll('"','""') + '"';
    };
    const rows = [['Comparison','Tariff','Route','Monthly quantity','Tariff gross USD','Uniform quote USD',
      'Uniform gross USD','Rounding difference USD','Source review']];
    for (const row of record.review.comparisons) rows.push([row.id,row.tariffId,row.routeId,row.quantity,
      row.quote.totalUsd,row.quote.chosenUniformQuoteUsd,row.quote.uniformGrossUsd,row.quote.roundingDeltaUsd,record.version]);
    return Buffer.from('\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n');
  }
  async function bundle() {
    const records = await allPlans(), selections = [];
    for (const name of (await readdir(intents)).filter(name=>name.endsWith('.json')&&UUID.test(name.slice(0,-5))).sort())
      selections.push({id:name.slice(0,-5),intent:await read(join(intents,name)),result:await maybe(join(results,name))});
    const content = {schema:BUNDLE,plans:records,selections};
    const value = {...content,sha256:fingerprint(content)};
    if (encode(value).length > MAX_BUNDLE) throw fault('TARIFF_PORTFOLIO_TOO_LARGE','Export selected tariff plans separately.');
    return value;
  }
  async function receive(raw) {
    const input = copy(raw);
    if (!object(input) || input.schema !== BUNDLE || !Array.isArray(input.plans) || !Array.isArray(input.selections) ||
        !HASH.test(input.sha256 ?? '') || encode(input).length > MAX_BUNDLE ||
        fingerprint({schema:input.schema,plans:input.plans,selections:input.selections}) !== input.sha256)
      throw fault('TARIFF_PORTFOLIO_INVALID','Use the complete exported tariff portfolio.');

    const timestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) &&
      new Date(value).toISOString() === value;
    const invalid = message => fault('TARIFF_PORTFOLIO_INVALID', message);
    const sourceChanged = message => fault('TARIFF_PORTFOLIO_SOURCE_CHANGED', message, 409);
    const plans = new Map(), journals = [], requestBodies = new Map();

    async function inspectPlan(record) {
      id(record?.planId); id(record?.version, 'pricing review');
      if (record.schema !== PLAN || !object(record.inputs) ||
          Object.keys(record.inputs).some(key => !['tariffs','volumes'].includes(key)) ||
          typeof record.label !== 'string' || !record.label.trim() ||
          record.label !== record.label.trim() || record.label.length > 100 ||
          !timestamp(record.savedAt) || !timestamp(record.review?.generatedAt) ||
          !HASH.test(record.requestSha256 ?? '') || !HASH.test(record.review?.tariffReviewSha256 ?? ''))
        throw invalid('A tariff plan is incomplete or its saved request identity is invalid.');
      const request = {version:record.version,tariffs:record.inputs.tariffs,volumes:record.inputs.volumes,
        label:record.label,tariffReviewSha256:record.review.tariffReviewSha256};
      if (fingerprint(request) !== record.requestSha256)
        throw invalid('A tariff plan no longer matches its original save request.');
      const {value,review} = await prepare({version:record.version,...record.inputs});
      if (record.sourceLabel !== value.label || fingerprint(value.provenance) !== fingerprint(record.provenance) ||
          fingerprint(stableReview(review)) !== fingerprint(stableReview(record.review)))
        throw sourceChanged('Restore the matching original pricing backup before receiving these tariffs.');
      return {record,value};
    }

    // Preflight the complete incoming portfolio before registering any new plan
    // or resumable intent. Source reads use its immutable saved pricing versions.
    for (const record of input.plans) {
      id(record?.planId);
      if (plans.has(record.planId)) throw invalid('A tariff plan ID occurs more than once in this portfolio.');
      plans.set(record.planId, await inspectPlan(record));
      const previous = await maybe(join(root, record.planId + '.json'));
      if (previous && fingerprint(previous) !== fingerprint(record))
        throw fault('TARIFF_REQUEST_CHANGED','This plan ID already identifies another retained plan.',409);
    }

    async function originalPlan(planId) {
      id(planId);
      if (!plans.has(planId)) plans.set(planId, await inspectPlan(await load(planId)));
      const found = plans.get(planId);
      if (!found.manifest) found.manifest = JSON.parse((await model.download(found.record.version, 'manifest.json')).toString('utf8'));
      return found;
    }

    const selectionIds = new Set();
    for (const item of input.selections) {
      id(item?.id, 'pricing request');
      if (selectionIds.has(item.id)) throw invalid('A pricing request ID occurs more than once in this portfolio.');
      selectionIds.add(item.id);
      const intent = item.intent, request = intent?.request;
      if (!object(intent) || intent.schema !== 'stellar-forge.merchant-tariff-selection-intent.v1' ||
          !timestamp(intent.createdAt) || !object(request) || !object(intent.selection) ||
          !object(intent.scenarioRequest) || !object(intent.pricingRequest) ||
          (item.result !== null && !object(item.result)))
        throw invalid('A selection journal is incomplete.');
      id(request.planRequestId, 'scenario request'); id(request.pricingRequestId, 'pricing request');
      const core = stableSelection(request.selection);
      if (core.schema !== SELECTION || !object(core.scenarioPlanInput) || !object(core.pricingInput) ||
          !HASH.test(request.selection.selectionSha256 ?? '') ||
          fingerprint(core) !== request.selection.selectionSha256 ||
          !HASH.test(intent.requestSha256 ?? '') || fingerprint(request) !== intent.requestSha256 ||
          request.pricingRequestId !== item.id || fingerprint(intent.selection) !== fingerprint(core))
        throw invalid('A selection journal differs from its original selection and request IDs.');
      const normalizedRequest = {selection:{...core,selectionSha256:request.selection.selectionSha256},
        planRequestId:request.planRequestId,pricingRequestId:request.pricingRequestId};
      const scenarioRequest = {...core.scenarioPlanInput,requestId:request.planRequestId};
      const pricingRequest = {...core.pricingInput,requestId:request.pricingRequestId};
      if (fingerprint(request) !== fingerprint(normalizedRequest) ||
          fingerprint(intent.scenarioRequest) !== fingerprint(scenarioRequest) ||
          fingerprint(intent.pricingRequest) !== fingerprint(pricingRequest))
        throw invalid('The retained native request bodies do not belong to this tariff selection.');
      if (!(core.pricingInput.expectedRevision === null || HASH.test(core.pricingInput.expectedRevision ?? '')) ||
          !HASH.test(core.pricingInput.snapshotSha256 ?? '') || !HASH.test(core.pricingInput.sellerSha256 ?? ''))
        throw invalid('The selected native pricing revision or source capture is invalid.');

      const {record,value,manifest} = await originalPlan(core.planId);
      const row = record.review.comparisons.find(comparison => comparison.id === core.comparisonId);
      if (!row?.scenario) throw invalid('A selection journal does not identify an adoptable tariff comparison.');
      // Historical completed operations remain recoverable when today's seller
      // differs. These equations use the saved seller, terms and observations.
      const review = createScenarioReview({seller:value.seller,observation:value.observation,terms:value.terms,
        scenarios:[row.scenario],provenance:value.provenance,includeReports:false});
      const label = (record.label + ' / ' + row.quantity + ' requests').slice(0,100);
      const expectedPlan = {version:record.version,scenarios:[row.scenario],label,
        selectedScenarioId:row.scenario.id,reviewSha256:review.reviewSha256};
      const expectedPricing = {expectedRevision:core.pricingInput.expectedRevision,label,
        sellerSha256:record.provenance.seller,snapshotSha256:core.pricingInput.snapshotSha256,
        commercial:copy(review.scenarios[0].commercial)};
      const sourceSelection = manifest.sourceSelection ??
        {kind:manifest.observationKind ?? 'SESSION',from:null,to:null,routeId:null};
      if (core.tariffReviewSha256 !== record.review.tariffReviewSha256 ||
          fingerprint(core.sourceSelection) !== fingerprint(sourceSelection) ||
          fingerprint(core.scenarioPlanInput) !== fingerprint(expectedPlan) ||
          fingerprint(core.pricingInput) !== fingerprint(expectedPricing))
        throw invalid('A retained selection does not match its original tariff, scenario or merchant quote.');
      const normalizedScenarioRequest = {version:scenarioRequest.version,scenarios:scenarioRequest.scenarios,
        label:scenarioRequest.label.trim(),selectedScenarioId:scenarioRequest.selectedScenarioId ?? null,
        reviewSha256:scenarioRequest.reviewSha256};
      const scenarioRequestSha256 = fingerprint(normalizedScenarioRequest);
      if (requestBodies.has(request.planRequestId) && requestBodies.get(request.planRequestId) !== scenarioRequestSha256)
        throw invalid('One scenario request ID identifies different native scenario inputs.');
      requestBodies.set(request.planRequestId, scenarioRequestSha256);

      if (item.result !== null) {
        const result = item.result, actualPlan = await planning.load(request.planRequestId);
        const version = id(result.pricing?.version, 'pricing review');
        const nativeManifestBytes = await model.download(version, 'manifest.json');
        const nativeManifest = JSON.parse(nativeManifestBytes.toString('utf8'));
        if (result.status !== 'TARIFF_SELECTION_SAVED' || result.planId !== core.planId ||
            result.comparisonId !== core.comparisonId || actualPlan.planId !== request.planRequestId ||
            result.scenarioPlan?.planId !== actualPlan.planId ||
            actualPlan.requestSha256 !== scenarioRequestSha256 ||
            result.scenarioPlan?.reviewSha256 !== actualPlan.review.reviewSha256 ||
            result.scenarioPlan?.version !== actualPlan.version ||
            nativeManifest.version !== version || nativeManifest.requestId !== request.pricingRequestId ||
            nativeManifest.requestSha256 !== fingerprint(pricingRequest) ||
            result.pricing.revision !== hash(nativeManifestBytes))
          throw sourceChanged('Restore the exact original scenario and saved quote before receiving its completed selection.');
      }
      const previousIntent = await maybe(join(intents, item.id + '.json'));
      const previousResult = await maybe(join(results, item.id + '.json'));
      if (previousIntent && fingerprint(previousIntent) !== fingerprint(intent))
        throw fault('TARIFF_REQUEST_CHANGED','This pricing request already identifies another retained selection.',409);
      if (item.result !== null && previousResult && fingerprint(previousResult) !== fingerprint(item.result))
        throw fault('TARIFF_REQUEST_CHANGED','This pricing request already has a different retained result.',409);
      journals.push(item);
    }

    const received = [];
    for (const record of input.plans) {
      const result = await writeOnce(join(root,record.planId+'.json'),record);
      received.push({planId:record.planId,recovered:result.recovered});
    }
    for (const item of journals) {
      await writeOnce(join(intents,item.id+'.json'),item.intent);
      if (item.result !== null) await writeOnce(join(results,item.id+'.json'),item.result);
    }
    return {status:'TARIFF_PORTFOLIO_RECEIVED',plans:received,selections:journals.length};
  }
  return {state,source,preview,save,list,load,selection,commitSelection,download,bundle,receive,
    repricingSource:version=>model.repricingSource(version),
    downloadRepricing:(decision,name)=>model.downloadRepricing(decision,name),
    downloadPricing:(version,name)=>model.download(version,name),
    previewRepricing:input=>model.previewRepricing(copy(input)),
    saveRepricing:input=>model.saveRepricing(copy(input)),
    stageRepricing:input=>model.stageRepricing(copy(input))};
}
