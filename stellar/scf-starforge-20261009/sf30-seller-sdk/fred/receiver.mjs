// MIT. One retained receiving operation over the original FRED project and SF88 Buyer.
import { join, resolve, dirname, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readdir } from 'node:fs/promises';
import { privateDirectory, atomicJson, readPrivateJson, withPrivateLock } from '../routescan/quota.mjs';
import { readBytes, writeBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { Buyer } from '../../sf88-operator-buyer-cli/node/index.mjs';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { need, canonical, operationId, projectionPolicy } from './model.mjs';
import { hash, digest, jsonBytes, optionalJson, validateCapture, sealFredPublicTable, sealFredPublicTables } from './source.mjs';
import { initializeFredProject, readFredProject, getFredCapture, importFredCapture, reviewFredCapture,
  publishFredReview, selectFredPublication, exportFredProject, receiveFredProject } from './project.mjs';
import { readFredMerchant, startFredMerchant, prepareFredPurchase, executeFredPurchase, recoverFredPurchase } from './merchant.mjs';

const SCHEMA = 'stellar-forge.fred-receiver.v1';
const CONFIG = 'stellar-forge.fred-receiver-config.v1';
const roles = ['page1', 'page2', 'source', 'csv'];
const files = { page1: 'page-1.json', page2: 'page-2.json', source: 'capture.json', csv: 'observations.csv' };
const now = () => new Date().toISOString();
const same = (a, b, message) => need(canonical(a) === canonical(b), message, 'FRED_RECEIVER_CHANGED', 409);
const publicError = error => ({ code: error.code ?? 'FRED_RECEIVER_INTERRUPTED', at: now() });

export async function retainReceiverFile(directory, name, bytes) {
  need(typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(name), 'Use one receiver artifact filename.');
  const destination = join(directory, name);
  try { await writeBytes(destination, bytes, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const retained = await readBytes(destination, Math.max(1, bytes.length));
    need(retained.equals(bytes), 'The original receiver artifact changed: ' + name, 'FRED_RECEIVER_ARTIFACT_CHANGED', 409);
  }
  return { path: destination, bytes: bytes.length, sha256: hash(bytes) };
}
async function inputJson(path, max = 128 * 1024 * 1024) {
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await readBytes(path, max)));
}
function absoluteInput(base, value, label) {
  need(typeof value === 'string' && value.length > 0 && !value.includes('\0'), label + ' is required.');
  return resolve(base, value);
}
async function configuration(file) {
  file = resolve(file);
  const input = await readPrivateJson(file, 131072), base = dirname(file);
  const keys = ['schema', 'id', 'title', 'sources', 'buyerConfig', 'paymentFile', 'payment', 'origin',
    'path', 'facilitator', 'allowLocalFacilitator', 'merchantPort', 'policy', 'note', 'publicationId',
    'query', 'intents', 'acceptIndex', 'browser'];
  need(input?.schema === CONFIG && Object.keys(input).every(key => keys.includes(key)), 'Use the FRED receiver configuration schema.');
  operationId(input.id); need(input.id.length <= 70, 'Keep the receiver ID within 70 characters.');
  const paths = input.sources ?? [fileURLToPath(new URL('./sources/unrate-20261012.public-table.json', import.meta.url))];
  need(Array.isArray(paths) && paths.length >= 1 && paths.length <= 50, 'Select one to fifty complete original source files.');
  const sources = [];
  for (const path of paths) sources.push(await inputJson(absoluteInput(base, path, 'Original source')));
  let capture;
  if (sources.length > 1) {
    need(sources.every(source => source.version === 'commons.retained-public-table.v1'), 'A source list combines complete original public tables.');
    capture = sealFredPublicTables({ version: 'commons.retained-public-table-set.v1', tables: sources });
  } else capture = sources[0].version === 'commons.retained-public-table.v1' ? sealFredPublicTable(sources[0])
    : sources[0].version === 'commons.retained-public-table-set.v1' ? sealFredPublicTables(sources[0]) : sources[0];
  const model = validateCapture(capture);
  const buyerConfig = absoluteInput(base, input.buyerConfig, 'The existing SF88 buyer configuration');
  const buyerSettings = await readPrivateJson(buyerConfig, 65536);
  need(isAbsolute(buyerSettings.stateDirectory ?? '') && isAbsolute(buyerSettings.runtimeDirectory ?? ''),
    'Keep the original absolute buyer state and runtime directories.');
  need(!(input.payment && input.paymentFile), 'Select the retained payment terms or their original file.');
  const payment = input.paymentFile ? await inputJson(absoluteInput(base, input.paymentFile, 'Public payment file'), 16384) : input.payment;
  need(payment && typeof payment === 'object' && !Array.isArray(payment), 'The existing merchant public payment terms are required.');
  const origin = new URL(input.origin);
  need(origin.protocol === 'https:' && !origin.username && !origin.password && !origin.search && !origin.hash && origin.pathname === '/',
    'Use the configured canonical merchant HTTPS origin.');
  need(typeof input.facilitator === 'string' && input.facilitator.length > 0, 'Use the existing configured native facilitator.');
  need(Number.isSafeInteger(input.merchantPort) && input.merchantPort >= 1 && input.merchantPort <= 65535,
    'Use the local merchant port already routed by the configured HTTPS ingress or buyer transport.');
  need(input.intents === undefined || input.intents && typeof input.intents === 'object' && !Array.isArray(input.intents) &&
    Object.keys(input.intents).every(key => roles.includes(key)), 'Select original intent IDs by receiver role.');
  for (const value of Object.values(input.intents ?? {})) operationId(value);
  const acceptIndex = input.acceptIndex ?? 0;
  need(Number.isSafeInteger(acceptIndex) && acceptIndex >= 0, 'Select the original payment alternative.');
  const policy = projectionPolicy(input.policy), note = input.note ?? '';
  need(typeof note === 'string' && note.length <= 8000, 'Use a saved review note within 8000 characters.');
  need(input.query === undefined || typeof input.query === 'string', 'The initial dataset query must be a string.');
  const query = input.query ?? 'limit=' + policy.defaultLimit;
  need(!new URLSearchParams(query).has('cursor'), 'The initial request precedes its actual returned cursor.');
  const plan = { id: input.id, title: input.title ?? 'UNRATE economic edition', captureId: capture.captureSha256,
    buyerConfig, buyerStateDirectory: buyerSettings.stateDirectory, buyerConfigSha256: digest(buyerSettings),
    payment, origin: new URL(input.origin).origin, path: input.path ?? '/economic-data',
    facilitator: input.facilitator, allowLocalFacilitator: input.allowLocalFacilitator === true,
    merchantPort: input.merchantPort, policy, note, publicationId: input.publicationId ?? null,
    query, explicitQuery: input.query !== undefined, intents: input.intents ?? {}, acceptIndex };
  if (plan.publicationId) need(/^[a-f0-9]{64}$/.test(plan.publicationId), 'Select the original retained publication.');
  return { plan, capture, model, buyerSettings, browser: input.browser, base, configFile: file };
}
function checkpointDirectory(directory, id) { return join(resolve(directory), 'receivers', operationId(id)); }
export async function readFredReceiver({ directory, id } = {}) {
  const root = checkpointDirectory(directory, id);
  const state = await readPrivateJson(join(root, 'receiver.json'), 4 * 1024 * 1024);
  need(state.schema === SCHEMA && state.id === id && state.planSha256 === digest(state.plan), 'The retained receiver identity changed.');
  return { ...state, directory: root };
}
function queryOf(value) {
  const query = value instanceof URLSearchParams ? new URLSearchParams(value) : new URLSearchParams(value);
  query.delete('snapshot'); query.sort(); return query.toString();
}
async function chooseCustomerPlan(directory, plan, prior) {
  if (prior) return prior;
  const names = await readdir(join(directory, 'customer-requests')).catch(error => { if (error.code === 'ENOENT') return []; throw error; });
  const saved = [];
  for (const name of names) {
    operationId(name);
    saved.push(await readPrivateJson(join(directory, 'customer-requests', name, 'prepared.json'), 131072));
  }
  let query = plan.query;
  const initial = saved.filter(item => item.file === null && item.previous === null);
  const matching = initial.filter(item => queryOf(new URL(item.url).searchParams) === queryOf(query));
  need(plan.intents.page1 || matching.length <= 1, 'Select the original first-page intent from its retained requests.', 'FRED_RECEIVER_REQUEST_SELECTION_REQUIRED', 409);
  let first = plan.intents.page1 ? initial.find(item => item.intentId === plan.intents.page1) : matching[0];
  if (!first && !plan.explicitQuery && initial.length === 1) { first = initial[0]; query = queryOf(new URL(first.url).searchParams); }
  need(first || initial.length === 0 || plan.intents.page1, 'Select the existing first-page intent in receiver configuration.', 'FRED_RECEIVER_REQUEST_SELECTION_REQUIRED', 409);
  const select = (role, candidates) => {
    if (plan.intents[role]) return plan.intents[role];
    need(candidates.length <= 1, 'Select the original ' + role + ' intent in receiver configuration.', 'FRED_RECEIVER_REQUEST_SELECTION_REQUIRED', 409);
    return candidates[0]?.intentId ?? plan.id + '-' + role;
  };
  const intents = {
    page1: select('page1', first ? [first] : []),
    page2: select('page2', saved.filter(item => item.file === null && item.previous !== null &&
      queryOf(new URL(item.url).searchParams).replace(/(?:^|&)cursor=[^&]*&?/, '').replace(/^&/, '') === queryOf(query))),
    source: select('source', saved.filter(item => item.file === 'capture.json')),
    csv: select('csv', saved.filter(item => item.file === 'observations.csv')),
  };
  need(new Set(Object.values(intents)).size === roles.length, 'Keep independent original intents for the four original requests.');
  return { query, intents, acceptIndex: plan.acceptIndex };
}

/** Executes once per original intent; repeated invocations recover the same native operation. */
export async function runFredReceiver({ directory, configFile, phase = 'run', signal, onProgress = () => {} } = {}) {
  need(['run', 'browser', 'status'].includes(phase), 'Receiver phase must be run, browser or status.');
  need(signal === undefined || signal instanceof AbortSignal, 'Use an original AbortSignal.');
  directory = await privateDirectory(resolve(directory));
  const config = await configuration(configFile), { plan, capture, model } = config;
  const root = await privateDirectory(checkpointDirectory(directory, plan.id));
  if (phase === 'status') return readFredReceiver({ directory, id: plan.id });
  return withPrivateLock(root, 'receiver.lock', async () => {
    let state = await optionalJson(join(root, 'receiver.json'), 4 * 1024 * 1024);
    if (state) {
      need(state.schema === SCHEMA && state.planSha256 === digest(state.plan), 'The retained receiver identity changed.');
      same(state.plan, plan, 'Continue with the original receiver settings, buyer state, source and intent selection.');
    } else {
      need(phase === 'run', 'Run or adopt the original native operation before browser continuation.');
      state = { schema: SCHEMA, id: plan.id, plan, planSha256: digest(plan), projectDirectory: directory,
        state: 'READY', phase: 'input', createdAt: now(), results: {}, customerPlan: null, lastError: null };
      await atomicJson(root, 'receiver.json', state, { exclusive: true });
    }
    const save = async () => { state.updatedAt = now(); await atomicJson(root, 'receiver.json', state); };
    const progress = () => onProgress({ id: state.id, state: state.state, phase: state.phase,
      checkpoint: join(root, 'receiver.json'), publicationId: state.results.publication?.publicationId ?? null });
    const step = async (name, work) => {
      if (state.results[name]) return state.results[name];
      need(!signal?.aborted, 'The receiver was interrupted; continue its original checkpoint.', 'FRED_RECEIVER_INTERRUPTED');
      state.state = 'RUNNING'; state.phase = name; state.lastError = null; await save(); await progress();
      const result = await work();
      state.results[name] = result; await save(); return result;
    };
    let merchant;
    try {
      if (phase === 'run' && !state.results.nativeComplete) {
        await step('input', async () => ({ ...(await retainReceiverFile(root, 'original-capture.json', jsonBytes(capture))),
          captureId: capture.captureSha256, rowCount: model.rowCount, missing: model.missing }));
        await step('project', async () => {
          const existing = await optionalJson(join(directory, 'project.json'), 8 * 1024 * 1024);
          const project = existing ? await readFredProject(directory) :
            await initializeFredProject({ directory, title: plan.title, selection: model.selection });
          return { projectId: project.id };
        });
        same((await readFredProject(directory)).id, state.results.project.projectId, 'The receiver belongs to its original project.');
        await step('capture', async () => {
          const project = await readFredProject(directory);
          if (project.captures.some(item => item.id === capture.captureSha256)) {
            await getFredCapture(directory, capture.captureSha256);
            return { captureId: capture.captureSha256, reused: true };
          }
          return importFredCapture({ directory, id: plan.id + '-import', expectedRevision: project.revision, capture });
        });
        const review = await step('review', async () => {
          const project = await readFredProject(directory);
          if (plan.publicationId) {
            const publication = project.publications.find(item => item.id === plan.publicationId);
            need(publication?.captureId === capture.captureSha256, 'The original publication uses another source.');
            const item = project.reviews.find(item => item.id === publication.reviewId);
            need(item, 'The original publication review is required.'); return { reviewId: item.id, reused: true };
          }
          const item = project.reviews.find(item => item.captureId === capture.captureSha256 &&
            canonical(item.policy) === canonical(plan.policy) && item.note === plan.note);
          return item ? { reviewId: item.id, reused: true } : reviewFredCapture({ directory, id: plan.id + '-review',
            expectedRevision: project.revision, captureId: capture.captureSha256, policy: plan.policy, note: plan.note });
        });
        const publication = await step('publication', async () => {
          const project = await readFredProject(directory);
          const id = plan.publicationId ?? digest({ reviewId: review.reviewId, origin: plan.origin, path: plan.path, payment: plan.payment });
          const item = project.publications.find(item => item.id === id);
          if (item) {
            const merchant = await readFredMerchant(await selectFredPublication(directory, id));
            same({ origin: merchant.plan.origin, path: merchant.plan.path, payment: merchant.plan.payment },
              { origin: plan.origin, path: plan.path, payment: plan.payment }, 'Keep the publication original payment terms.');
            return { ...item, publicationId: item.id, reused: true };
          }
          return publishFredReview({ directory, id: plan.id + '-publish', expectedRevision: project.revision,
            reviewId: review.reviewId, origin: plan.origin, path: plan.path, payment: plan.payment });
        });
        const publicationDirectory = await selectFredPublication(directory, publication.publicationId);
        const { edition, plan: merchantPlan } = await readFredMerchant(publicationDirectory);
        same(edition.captureSha256, capture.captureSha256, 'The original native edition source changed.');
        for (const name of ['capture.json', 'observations.csv'])
          need(merchantPlan.downloads.some(item => item.path === name), 'The selected original edition must advertise its complete ' + name + '.');
        state.customerPlan = await chooseCustomerPlan(publicationDirectory, plan, state.customerPlan); await save();
        const query = new URLSearchParams(state.customerPlan.query); query.delete('snapshot');
        const dataset = await loadDatasetConfig(join(publicationDirectory, 'dataset.json'));
        const admission = dataset.admit({ query });
        need(admission === true, admission?.body?.message ?? 'The original customer query needs correction.');
        const preview = dataset.handle({ query });
        need(preview.status === 200 && preview.body.page.nextCursor, 'Choose a first-page limit that leaves an original second page.');
        const buyer = await new Buyer(config.buyerSettings).ready();
        state.phase = 'merchant'; await save(); await progress();
        merchant = await startFredMerchant({ directory: publicationDirectory, port: plan.merchantPort,
          facilitator: plan.facilitator, allowLocalFacilitator: plan.allowLocalFacilitator });
        need(merchant.mode === 'NATIVE_SELLER', 'Start the configured original native merchant.');
        await atomicJson(root, 'merchant-session.json', { publicationId: publication.publicationId,
          resource: merchant.resource, localUrl: merchant.url, snapshot: merchant.snapshot, startedAt: now() });
        const deliveryDirectory = await privateDirectory(join(root, 'deliveries'));
        const deliver = async (role, request) => step(role, async () => {
          const intentId = state.customerPlan.intents[role];
          const purchase = await prepareFredPurchase({ directory: publicationDirectory, intentId,
            acceptIndex: state.customerPlan.acceptIndex, ...request });
          const delivered = await executeFredPurchase({ directory: publicationDirectory, buyer, purchase, signal });
          if (delivered.state !== 'DELIVERED') {
            state.state = delivered.state; state.phase = role;
            state.awaiting = { intentId, operationDirectory: buyer.operation(intentId).directory };
            await save(); throw Object.assign(new Error('Continue the original native result for ' + intentId + '.'), { code: 'FRED_NATIVE_RESULT_PENDING' });
          }
          const response = await retainReceiverFile(deliveryDirectory, files[role], await delivered.result.bytes({ limit: delivered.bytes, signal }));
          const native = await retainReceiverFile(deliveryDirectory, role + '-native-result.json', jsonBytes(delivered.result.record));
          return { state: delivered.state, intentId, editionId: delivered.editionId, metadata: delivered.metadata,
            response, native, purchaseSha256: purchase.purchaseSha256 };
        });
        const first = await deliver('page1', { query: new URLSearchParams(state.customerPlan.query) });
        need(first.metadata.nextCursor, 'The original first page must have a second page; choose the original smaller page limit before preparing any purchase.');
        const next = new URLSearchParams(state.customerPlan.query); next.set('cursor', first.metadata.nextCursor);
        await deliver('page2', { query: next, previous: first.metadata });
        await deliver('source', { file: 'capture.json' });
        await deliver('csv', { file: 'observations.csv' });
        await step('recovery', async () => {
          const reopenedBuyer = await new Buyer(config.buyerSettings).ready();
          const result = await recoverFredPurchase({ directory: publicationDirectory, buyer: reopenedBuyer, intentId: first.intentId });
          need(result.state === 'DELIVERED' && result.sha256 === first.response.sha256, 'Reopen the same original first-page delivery.');
          return { intentId: first.intentId, state: result.state, bytes: result.bytes, sha256: result.sha256 };
        });
        await merchant.close(); merchant = null;
        await step('export', async () => {
          const bundle = await exportFredProject({ directory });
          return { ...(await retainReceiverFile(root, 'project-bundle.json', jsonBytes(bundle))), bundleSha256: bundle.bundleSha256 };
        });
        await step('received', async () => {
          const bundle = await readPrivateJson(join(root, 'project-bundle.json'), 256 * 1024 * 1024);
          const receivedDirectory = join(root, 'received-project');
          const received = await receiveFredProject({ directory: receivedDirectory, bundle });
          const original = await readFredProject(directory), reopened = await readFredProject(receivedDirectory);
          same(reopened, bundle.state, 'The receiving project must retain the original complete project state.');
          same(original.id, reopened.id, 'The original and received project identities differ.');
          const receivedEdition = await readFredMerchant(await selectFredPublication(receivedDirectory, publication.publicationId));
          same(receivedEdition.edition.editionId, edition.editionId, 'The received edition identity changed.');
          same(receivedEdition.edition.snapshot, edition.snapshot, 'The received original dataset snapshot changed.');
          return { ...received, directory: receivedDirectory, captureId: capture.captureSha256,
            publicationId: publication.publicationId, editionId: edition.editionId, snapshot: edition.snapshot, rowCount: edition.rowCount };
        });
        await step('nativeComplete', async () => ({ completedAt: now(), projectId: state.results.project.projectId,
          captureId: capture.captureSha256, publicationId: publication.publicationId, snapshot: edition.snapshot,
          rowCount: edition.rowCount, missing: model.missing,
          intents: Object.fromEntries(roles.map(role => [role, state.results[role].intentId])) }));
      }
      need(state.results.nativeComplete, 'Continue the original native receiver before inspecting its complete delivery workspace.');
      if (config.browser) {
        await step('browser', async () => {
          const { inspectFredReceiverBrowser } = await import('./receiver-browser.mjs');
          return inspectFredReceiverBrowser({ directory, receiverDirectory: root, state, settings: config.browser,
            settingsDirectory: config.base, buyerConfig: plan.buyerConfig, signal });
        });
      } else need(phase !== 'browser', 'Add the existing browser module settings to the same receiver configuration.');
      state.state = state.results.browser ? 'COMPLETE' : 'NATIVE_COMPLETE_BROWSER_PENDING';
      state.phase = state.results.browser ? 'complete' : 'browser'; state.lastError = null; delete state.awaiting;
      await save(); await progress(); return { ...state, directory: root };
    } catch (error) {
      state.state = error.code === 'FRED_NATIVE_RESULT_PENDING' ? 'AWAITING_NATIVE_RESULT' : 'INTERRUPTED';
      state.lastError = publicError(error); await save(); await progress(); throw error;
    } finally { if (merchant) await merchant.close(); }
  });
}
