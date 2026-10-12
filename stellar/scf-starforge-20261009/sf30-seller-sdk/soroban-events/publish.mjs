// MIT. Retained Soroban editions composed with the original event merchant and buyer.
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { open, lstat, mkdir, readdir, link, unlink, rm } from 'node:fs/promises';
import { resolve, join, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openSorobanEventsWorkspace } from './engine.mjs';
import { EventFeedStore } from '../webhook-feed/store.mjs';
import { FeedError, isRecord, requireId, sourceDefinition, feedDefinition, eventData } from '../webhook-feed/model.mjs';
import { buildWebhookFeedService, prepareWebhookFeedRelease, startWebhookFeedMerchant } from '../webhook-feed/merchant.mjs';
import { createSnapshot, restoreSnapshot, fileIdentity } from '../webhook-feed/snapshots.mjs';

export const SOROBAN_PUBLICATION_SCHEMA = 'stellar-forge.soroban-event-publication.v1';
export const SOROBAN_PUBLICATION_EDITION_SCHEMA = 'stellar-forge.soroban-event-publication-edition.v1';
export const SOROBAN_PUBLICATION_RECOVERY_SCHEMA = 'stellar-forge.soroban-event-publication-recovery.v1';
export const SOROBAN_PUBLISHED_EVENT_SCHEMA = 'stellar-forge.soroban-published-event.v1';
const SECRET_ENV = 'SOROBAN_EVENT_PUBLICATION_KEY';
const HASH = /^[a-f0-9]{64}$/;
const IDENTITY = /^[a-f0-9]{32}$/;
const EDITION_FILE = /^[a-f0-9]{64}\.manifest\.json$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

function need(condition, code, status = 422, details = {}) {
  if (!condition) throw new FeedError(code, status, details);
}
function text(value, field, maximum = 256) {
  need(typeof value === 'string' && value.length > 0 && value.length <= maximum &&
    !/[\u0000-\u001f\u007f]/.test(value), 'SOROBAN_PUBLICATION_ID_REQUIRED', 422, { field });
  return value;
}
function sorted(value) {
  if (Array.isArray(value)) return value.map(sorted);
  if (isRecord(value)) {
    const result = Object.create(null);
    for (const key of Object.keys(value).sort()) result[key] = sorted(value[key]);
    return result;
  }
  return value;
}
function canonical(value) { return JSON.stringify(sorted(value)); }
function same(left, right) { return canonical(left) === canonical(right); }
function below(directory, filename) {
  const base = resolve(directory), target = resolve(base, filename);
  need(typeof filename === 'string' && !isAbsolute(filename) && target.startsWith(base + sep),
    'SOROBAN_PUBLICATION_RELATIVE_PATH_REQUIRED');
  return target;
}
async function regularBytes(filename, { maximum = 512 * 1024 * 1024, privateFile = false } = {}) {
  const handle = await open(filename, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await handle.stat();
    need(info.isFile() && info.size <= maximum, 'SOROBAN_PUBLICATION_REGULAR_FILE_REQUIRED');
    if (privateFile) need((info.mode & 0o077) === 0, 'SOROBAN_PUBLICATION_PRIVATE_KEY_REQUIRED');
    const bytes = await handle.readFile();
    need(bytes.length <= maximum, 'SOROBAN_PUBLICATION_FILE_TOO_LARGE');
    return bytes;
  } finally { await handle.close(); }
}
async function readJson(filename, options) {
  const bytes = await regularBytes(filename, options);
  try { return { value: JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)), bytes }; }
  catch (error) {
    if (error instanceof FeedError) throw error;
    throw new FeedError('SOROBAN_PUBLICATION_JSON_INVALID', 422);
  }
}
async function writeNew(filename, bytes, { identical = true } = {}) {
  const temporary = filename + '.partial-' + randomBytes(12).toString('hex');
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(bytes); await handle.sync(); await handle.close(); handle = null;
    try { await link(temporary, filename); return true; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (identical) {
        const existing = await regularBytes(filename);
        need(existing.equals(bytes), 'SOROBAN_PUBLICATION_FILE_CONFLICT', 409, { file: filename });
      }
      return false;
    }
  } finally {
    await handle?.close().catch(() => {});
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
function scopeOf(workspaceId, edition) {
  workspaceId = edition?.receivedFrom?.workspaceId ?? workspaceId;
  text(workspaceId, 'workspaceId'); text(edition?.planId, 'planId');
  need(edition.network !== undefined && edition.network !== null &&
    (typeof edition.network === 'string' || isRecord(edition.network)), 'SOROBAN_PUBLICATION_NETWORK_REQUIRED');
  return { workspaceId, network: edition.network, planId: edition.planId };
}
function pathsFor(editionId) {
  const key = sha(text(editionId, 'editionId'));
  return { source: 'editions/' + key + '.source.json', manifest: 'editions/' + key + '.manifest.json' };
}
function sourceFor(id) {
  return sourceDefinition({ id, label: 'Soroban contract events', secretEnv: SECRET_ENV,
    typePointer: '/event/type', occurredAtPointer: null, enabled: true,
    maxEventBytes: 262144, toleranceSeconds: 300 });
}
function feedFor(id, sourceId, { label = 'Soroban contract events',
  description = 'Complete retained Stellar RPC event objects from the selected saved plan, with exact XDR values and source scope.' } = {}) {
  return feedDefinition({ id, label, description, sourceIds: [sourceId], types: [],
    projection: [{ name: 'event', pointer: '/event' }, { name: 'source', pointer: '/source' }],
    enabled: true, defaultPageSize: 50, maxPageSize: 100, maxPageBytes: 1048576 });
}
function eventEnvelope(event, scope) {
  need(isRecord(event) && /^[\x21-\x7e]{1,256}$/.test(event.id ?? ''),
    'SOROBAN_PUBLICATION_EVENT_ID_INVALID');
  const rawBody = Buffer.from(canonical({ schema: SOROBAN_PUBLISHED_EVENT_SCHEMA, source: scope, event }));
  need(rawBody.length <= 262144, 'SOROBAN_PUBLICATION_EVENT_TOO_LARGE', 413, { eventId: event.id });
  return { eventId: event.id, rawBody, sha256: sha(rawBody) };
}
function checkEvents(events, scope, source) {
  need(Array.isArray(events), 'SOROBAN_PUBLICATION_EVENT_ARRAY_REQUIRED');
  const seen = new Map();
  for (const event of events) {
    const envelope = eventEnvelope(event, scope);
    eventData(source, envelope.rawBody);
    need(!seen.has(envelope.eventId) || seen.get(envelope.eventId) === envelope.sha256,
      'SOROBAN_PUBLICATION_SOURCE_EVENT_CONFLICT', 409, { eventId: envelope.eventId });
    seen.set(envelope.eventId, envelope.sha256);
  }
  return { eventCount: events.length, uniqueEvents: seen.size };
}

async function selectEdition({ workspaceDirectory, editionId }) {
  need(workspaceDirectory, 'SOROBAN_SOURCE_WORKSPACE_REQUIRED');
  text(editionId, 'editionId');
  const workspace = await openSorobanEventsWorkspace({ directory: resolve(workspaceDirectory) });
  try {
    const selected = await workspace.edition({ editionId });
    const publisher = await workspace.publisherSource({ editionId });
    const edition = selected?.edition;
    need(isRecord(edition) && edition.id === editionId && publisher?.editionId === editionId &&
      publisher.workspaceId === selected.workspaceId && publisher.format === 'json-array' &&
      HASH.test(publisher.sha256 ?? '') && Number.isSafeInteger(publisher.bytes) &&
      publisher.bytes >= 0 && isAbsolute(publisher.file ?? ''),
      'SOROBAN_PUBLISHER_SOURCE_INVALID');
    const { value: events, bytes } = await readJson(publisher.file);
    need(bytes.length === publisher.bytes && sha(bytes) === publisher.sha256,
      'SOROBAN_PUBLISHER_SOURCE_CHANGED', 409);
    need(Array.isArray(events) && edition.eventCount === events.length,
      'SOROBAN_PUBLISHER_EVENT_COUNT_CHANGED', 409);
    const scope = scopeOf(selected.workspaceId, edition);
    const capture = await workspace.captureStatus({ captureId: edition.captureId });
    return { events, bytes, scope, edition,
      observation: { workspaceId: selected.workspaceId, revision: selected.revision,
        publisherRevision: publisher.revision, publisherSource: {
          editionId, sha256: publisher.sha256, bytes: publisher.bytes, format: publisher.format },
        capture } };
  } finally { await workspace.close(); }
}

async function readPublication(directory) {
  need(typeof directory === 'string' && directory.length > 0, 'SOROBAN_PUBLICATION_DIRECTORY_REQUIRED');
  const base = resolve(directory);
  const info = await lstat(base);
  need(info.isDirectory() && !info.isSymbolicLink(), 'SOROBAN_PUBLICATION_DIRECTORY_REQUIRED');
  const { value: publication } = await readJson(join(base, 'publication.json'), { maximum: 1048576 });
  need(isRecord(publication) && publication.schema === SOROBAN_PUBLICATION_SCHEMA &&
    IDENTITY.test(publication.storeId ?? '') && publication.stateDirectory === 'feed' &&
    publication.keyFile === 'source-key.json', 'SOROBAN_PUBLICATION_INVALID');
  requireId(publication.sourceId); requireId(publication.feedId);
  scopeOf(publication.scope?.workspaceId, publication.scope);
  need(isRecord(publication.source) && isRecord(publication.feed) &&
    publication.source.id === publication.sourceId && publication.source.secretEnv === SECRET_ENV &&
    publication.source.typePointer === '/event/type' && publication.source.occurredAtPointer === null &&
    publication.source.maxEventBytes === 262144 && publication.feed.id === publication.feedId &&
    same(publication.feed.sourceIds, [publication.sourceId]),
    'SOROBAN_PUBLICATION_DEFINITION_INVALID');
  sourceDefinition(publication.source); feedDefinition(publication.feed);
  return { directory: base, publication };
}
async function openPublicationStore(directory) {
  const state = await readPublication(directory);
  const { value: key } = await readJson(join(state.directory, 'source-key.json'), { maximum: 4096, privateFile: true });
  need(key?.schema === 'stellar-forge.soroban-publication-key.v1' &&
    /^whsec_[A-Za-z0-9+/]{43}=$/.test(key.value ?? ''), 'SOROBAN_PUBLICATION_KEY_INVALID');
  const database = await lstat(join(state.directory, 'feed/events.sqlite'));
  need(database.isFile() && !database.isSymbolicLink(), 'SOROBAN_PUBLICATION_STORE_REQUIRED');
  const store = new EventFeedStore(join(state.directory, 'feed'), {
    secretResolver: name => name === SECRET_ENV ? key.value : undefined });
  try {
    need(store.storeId === state.publication.storeId, 'SOROBAN_PUBLICATION_STORE_CHANGED', 409);
    const source = store.definition('source', state.publication.sourceId);
    const feed = store.definition('feed', state.publication.feedId);
    const body = value => Object.fromEntries(Object.entries(value).filter(([name]) => !['revision', 'updatedAt'].includes(name)));
    need(same(body(source), state.publication.source) && same(body(feed), state.publication.feed),
      'SOROBAN_PUBLICATION_DEFINITION_CHANGED', 409);
    return { ...state, store, key: key.value };
  } catch (error) { store.close(); throw error; }
}
async function readRetainedEdition(state, editionId) {
  const names = pathsFor(editionId);
  const { value: manifest } = await readJson(below(state.directory, names.manifest));
  need(manifest?.schema === SOROBAN_PUBLICATION_EDITION_SCHEMA &&
    manifest.editionId === editionId && manifest.edition?.id === editionId &&
    same(scopeOf(manifest.observation?.workspaceId, manifest.edition), state.publication.scope) &&
    same(manifest.scope, state.publication.scope) &&
    manifest.source?.path === names.source && HASH.test(manifest.source.sha256 ?? ''),
    'SOROBAN_PUBLICATION_EDITION_INVALID');
  const { value: events, bytes } = await readJson(below(state.directory, names.source));
  need(bytes.length === manifest.source.bytes && sha(bytes) === manifest.source.sha256 &&
    Array.isArray(events) && events.length === manifest.eventCount,
    'SOROBAN_PUBLICATION_RETAINED_SOURCE_CHANGED', 409);
  checkEvents(events, manifest.scope, state.publication.source);
  return { names, manifest, events, bytes };
}
async function editionNames(state) {
  const names = (await readdir(join(state.directory, 'editions'))).filter(name => EDITION_FILE.test(name)).sort();
  const result = [];
  for (const name of names) {
    const { value } = await readJson(join(state.directory, 'editions', name));
    need(value?.schema === SOROBAN_PUBLICATION_EDITION_SCHEMA && pathsFor(value.editionId).manifest === 'editions/' + name,
      'SOROBAN_PUBLICATION_EDITION_INVALID');
    result.push(value.editionId);
  }
  return result;
}
// Receiving provenance describes the local handover; all original edition fields stay immutable.
function editionIdentity(edition) {
  const { receivedFrom, ...identity } = edition;
  return identity;
}
async function retainEdition(state, selected) {
  need(same(selected.scope, state.publication.scope), 'SOROBAN_PUBLICATION_SOURCE_SCOPE_CHANGED', 409);
  const counts = checkEvents(selected.events, selected.scope, state.publication.source);
  const names = pathsFor(selected.edition.id);
  const record = { schema: SOROBAN_PUBLICATION_EDITION_SCHEMA, editionId: selected.edition.id,
    scope: selected.scope, edition: selected.edition, observation: selected.observation,
    retainedAt: new Date().toISOString(), ...counts,
    source: { path: names.source, bytes: selected.bytes.length, sha256: sha(selected.bytes), format: 'json-array' },
    eventRepresentation: 'Canonical sorted-key publication envelope; original events JSON bytes are retained separately.' };
  await writeNew(below(state.directory, names.source), selected.bytes);
  await writeNew(below(state.directory, names.manifest), json(record), { identical: false });
  const retained = await readRetainedEdition(state, selected.edition.id);
  need(retained.manifest.source.sha256 === record.source.sha256 &&
    retained.manifest.source.bytes === record.source.bytes &&
    same(editionIdentity(retained.manifest.edition), editionIdentity(selected.edition)),
    'SOROBAN_PUBLICATION_EDITION_CONFLICT', 409);
  return retained;
}
async function ingestRetained(state, retained, signal) {
  let accepted = 0, duplicates = 0, retainedEvents = 0, processed = 0;
  for (const event of retained.events) {
    if (signal?.aborted) throw new FeedError('SOROBAN_PUBLICATION_INGEST_INTERRUPTED', 409,
      { directory: state.directory, editionId: retained.manifest.editionId, processed });
    const envelope = eventEnvelope(event, state.publication.scope);
    const timestamp = String(Math.floor(state.store.now() / 1000));
    const signature = createHmac('sha256', Buffer.from(state.key.slice(6), 'base64'))
      .update(envelope.eventId + '.' + timestamp + '.').update(envelope.rawBody).digest('base64');
    const result = state.store.acceptWebhook(state.publication.sourceId, {
      'webhook-id': envelope.eventId, 'webhook-timestamp': timestamp, 'webhook-signature': 'v1,' + signature,
    }, envelope.rawBody);
    if (result.duplicate) duplicates++; else accepted++;
    if (result.retained) retainedEvents++;
    processed++;
    if (processed % 100 === 0) await new Promise(done => setImmediate(done));
  }
  return { editionId: retained.manifest.editionId, state: 'COMPLETE', processed,
    accepted, duplicates, retainedEvents, sourceSha256: retained.manifest.source.sha256 };
}

/** One stable workspace/network/plan namespace supports overlapping successive editions. */
export async function prepareSorobanPublication({ workspaceDirectory, editionId, directory,
  feedId, sourceId, label, description, signal } = {}) {
  need(directory, 'SOROBAN_PUBLICATION_NEW_DIRECTORY_REQUIRED');
  const selected = await selectEdition({ workspaceDirectory, editionId });
  const scopeKey = sha(canonical(selected.scope)).slice(0, 24);
  sourceId ??= 'soroban-' + scopeKey; feedId ??= 'soroban-events-' + scopeKey;
  requireId(sourceId); requireId(feedId);
  const source = sourceFor(sourceId), feed = feedFor(feedId, sourceId, { label, description });
  checkEvents(selected.events, selected.scope, source);
  const target = resolve(directory);
  await mkdir(target, { mode: 0o700 });
  let state, store, published = false;
  try {
    await mkdir(join(target, 'editions'), { mode: 0o700 });
    const key = 'whsec_' + randomBytes(32).toString('base64');
    await writeNew(join(target, 'source-key.json'), json({ schema: 'stellar-forge.soroban-publication-key.v1', value: key }));
    store = new EventFeedStore(join(target, 'feed'), { secretResolver: name => name === SECRET_ENV ? key : undefined });
    store.saveDefinition('source', source); store.saveDefinition('feed', feed);
    const publication = { schema: SOROBAN_PUBLICATION_SCHEMA, createdAt: new Date().toISOString(),
      scope: selected.scope, sourceId, feedId, storeId: store.storeId,
      stateDirectory: 'feed', keyFile: 'source-key.json', source, feed };
    await writeNew(join(target, 'publication.json'), json(publication)); published = true;
    state = { directory: target, publication, store, key };
    const retained = await retainEdition(state, selected);
    const ingestion = await ingestRetained(state, retained, signal);
    return { directory: target, publication, ingestion, feed: store.status() };
  } catch (error) {
    if (published) Object.assign(error, { publicationDirectory: target,
      recovery: 'append the same retained workspace edition, or replay its retained source' });
    else { store?.close(); store = null; await rm(target, { recursive: true, force: true }); }
    throw error;
  } finally { store?.close(); }
}

export async function appendSorobanEdition({ workspaceDirectory, editionId, directory, signal } = {}) {
  const selected = await selectEdition({ workspaceDirectory, editionId });
  const state = await openPublicationStore(directory);
  try {
    const retained = await retainEdition(state, selected);
    return { directory: state.directory, publication: state.publication,
      ingestion: await ingestRetained(state, retained, signal), feed: state.store.status() };
  } finally { state.store.close(); }
}

export async function replaySorobanPublication({ directory, editionId, signal } = {}) {
  const state = await openPublicationStore(directory);
  try {
    const selected = editionId ? [editionId] : await editionNames(state);
    const editions = [];
    for (const id of selected) editions.push(await ingestRetained(state, await readRetainedEdition(state, id), signal));
    return { directory: state.directory, state: 'COMPLETE', publication: state.publication,
      editions, feed: state.store.status() };
  } finally { state.store.close(); }
}

export async function inspectSorobanPublication({ directory } = {}) {
  const state = await openPublicationStore(directory);
  try {
    const editions = [];
    for (const id of await editionNames(state)) {
      const retained = await readRetainedEdition(state, id);
      editions.push({ editionId: id, edition: retained.manifest.edition, source: retained.manifest.source,
        eventCount: retained.manifest.eventCount, uniqueEvents: retained.manifest.uniqueEvents });
    }
    return { directory: state.directory, publication: state.publication, editions,
      feed: state.store.status(), merchant: state.store.merchantPlan() };
  } finally { state.store.close(); }
}

export async function previewSorobanPublication({ directory, cursor, limit } = {}) {
  const state = await openPublicationStore(directory);
  try { return state.store.readPage(state.publication.feedId,
    { ...(cursor !== undefined ? { cursor } : {}), ...(limit !== undefined ? { limit } : {}) }); }
  finally { state.store.close(); }
}

/** The complete original merchant plan supplies actual terms; this bridge creates no prices. */
export async function saveSorobanPublicationPlan({ directory, plan, expectedRevision = null } = {}) {
  const state = await openPublicationStore(directory);
  try {
    need(isRecord(plan) && Array.isArray(plan.feeds) && plan.feeds.length === 1 &&
      plan.feeds[0]?.feedId === state.publication.feedId, 'SOROBAN_PUBLICATION_PLAN_FEED_CHANGED', 409);
    buildWebhookFeedService({ store: state.store, plan });
    return state.store.saveMerchantPlan(plan, expectedRevision);
  } finally { state.store.close(); }
}

export async function prepareSorobanPublicationRelease({ directory, destination } = {}) {
  need(destination, 'SOROBAN_PUBLICATION_NEW_RELEASE_REQUIRED');
  const state = await openPublicationStore(directory);
  try {
    const plan = state.store.merchantPlan().plan;
    need(plan, 'SOROBAN_PUBLICATION_PAYMENT_PLAN_REQUIRED');
    return await prepareWebhookFeedRelease({ store: state.store, plan, directory: resolve(destination) });
  } finally { state.store.close(); }
}

export async function startSorobanPublication({ directory, port = 8492, nativeFactory = null, ...options } = {}) {
  const state = await openPublicationStore(directory);
  let merchant;
  try {
    const plan = state.store.merchantPlan().plan;
    need(plan, 'SOROBAN_PUBLICATION_PAYMENT_PLAN_REQUIRED');
    merchant = await startWebhookFeedMerchant({ store: state.store, plan, port, nativeFactory, ...options });
    let closing;
    return { directory: state.directory, publication: state.publication, url: merchant.url,
      mode: merchant.mode, feeds: merchant.feeds,
      close: () => closing ??= (async () => { try { await merchant.close(); } finally { state.store.close(); } })() };
  } catch (error) { await merchant?.close().catch(() => {}); state.store.close(); throw error; }
}

async function copyPinned(source, destination, expected) {
  const bytes = await regularBytes(source);
  need(bytes.length === expected.bytes && sha(bytes) === expected.sha256,
    'SOROBAN_PUBLICATION_RECOVERY_FILE_CHANGED', 409);
  await writeNew(destination, bytes);
}
function outside(directory, destination) {
  const base = resolve(directory), target = resolve(destination);
  need(target !== base && !target.startsWith(base + sep), 'SOROBAN_PUBLICATION_RECOVERY_OUTSIDE_SOURCE_REQUIRED');
  return target;
}

/** Capture the original feed first, then retain immutable source editions available at that cut. */
export async function snapshotSorobanPublication({ directory, destination } = {}) {
  need(destination, 'SOROBAN_PUBLICATION_NEW_SNAPSHOT_REQUIRED');
  const state = await openPublicationStore(directory);
  let target, created = false;
  try {
    target = outside(state.directory, destination);
    await mkdir(target, { mode: 0o700 }); created = true;
    const feed = await createSnapshot({ store: state.store, directory: join(target, 'feed') });
    await mkdir(join(target, 'editions'), { mode: 0o700 });
    const files = Object.create(null);
    for (const name of ['publication.json', 'source-key.json']) {
      files[name] = await fileIdentity(join(state.directory, name));
      await copyPinned(join(state.directory, name), join(target, name), files[name]);
    }
    const editions = [];
    for (const id of await editionNames(state)) {
      const retained = await readRetainedEdition(state, id);
      editions.push({ editionId: id, sourceSha256: retained.manifest.source.sha256 });
      for (const name of Object.values(retained.names)) {
        files[name] = await fileIdentity(below(state.directory, name));
        await copyPinned(below(state.directory, name), below(target, name), files[name]);
      }
    }
    for (const name of ['feed/events.sqlite', 'feed/snapshot.json'])
      files[name] = await fileIdentity(join(target, name));
    const manifest = { schema: SOROBAN_PUBLICATION_RECOVERY_SCHEMA, createdAt: new Date().toISOString(),
      storeId: state.publication.storeId, sourceId: state.publication.sourceId, feedId: state.publication.feedId,
      scope: state.publication.scope, originalFeed: { highWatermark: feed.highWatermark,
        retainedEvents: feed.retainedEvents, acceptedEvents: feed.acceptedEvents,
        purgedThroughSequence: feed.purgedThroughSequence }, editions, files };
    await writeNew(join(target, 'recovery.json'), json(manifest));
    return { directory: target, ...manifest };
  } catch (error) { if (created) await rm(target, { recursive: true, force: true }); throw error; }
  finally { state.store.close(); }
}

export async function restoreSorobanPublication({ directory, destination } = {}) {
  need(directory && destination, 'SOROBAN_PUBLICATION_SNAPSHOT_AND_DESTINATION_REQUIRED');
  const source = resolve(directory), target = outside(source, destination);
  const { value: manifest } = await readJson(join(source, 'recovery.json'), { maximum: 16 * 1024 * 1024 });
  need(manifest?.schema === SOROBAN_PUBLICATION_RECOVERY_SCHEMA && isRecord(manifest.files) &&
    IDENTITY.test(manifest.storeId ?? '') && Array.isArray(manifest.editions) && isRecord(manifest.originalFeed),
    'SOROBAN_PUBLICATION_RECOVERY_INVALID');
  const expectedNames = ['publication.json', 'source-key.json', 'feed/events.sqlite', 'feed/snapshot.json'];
  for (const item of manifest.editions) {
    need(isRecord(item) && HASH.test(item.sourceSha256 ?? ''), 'SOROBAN_PUBLICATION_RECOVERY_INVALID');
    expectedNames.push(...Object.values(pathsFor(item.editionId)));
  }
  need(new Set(expectedNames).size === expectedNames.length &&
    same(Object.keys(manifest.files).sort(), expectedNames.sort()),
    'SOROBAN_PUBLICATION_RECOVERY_INVENTORY_INVALID');
  for (const name of expectedNames) {
    const expected = manifest.files[name];
    need(isRecord(expected) && Number.isSafeInteger(expected.bytes) && expected.bytes >= 0 &&
      HASH.test(expected.sha256 ?? ''), 'SOROBAN_PUBLICATION_RECOVERY_INVENTORY_INVALID');
    const actual = await fileIdentity(below(source, name));
    need(actual.bytes === expected.bytes && actual.sha256 === expected.sha256,
      'SOROBAN_PUBLICATION_RECOVERY_FILE_CHANGED', 409, { file: name });
  }
  await mkdir(target, { mode: 0o700 });
  let state;
  try {
    await mkdir(join(target, 'editions'), { mode: 0o700 });
    for (const name of expectedNames.filter(name => !name.startsWith('feed/')))
      await copyPinned(below(source, name), below(target, name), manifest.files[name]);
    const restored = await restoreSnapshot({ directory: join(source, 'feed'), destination: join(target, 'feed') });
    const actual = await fileIdentity(join(target, 'feed/events.sqlite'));
    need(restored.storeId === manifest.storeId && actual.sha256 === manifest.files['feed/events.sqlite'].sha256 &&
      actual.bytes === manifest.files['feed/events.sqlite'].bytes,
      'SOROBAN_PUBLICATION_RESTORED_STORE_CHANGED', 409);
    state = await openPublicationStore(target);
    need(state.publication.sourceId === manifest.sourceId && state.publication.feedId === manifest.feedId &&
      same(state.publication.scope, manifest.scope), 'SOROBAN_PUBLICATION_RESTORED_SCOPE_CHANGED', 409);
    for (const item of manifest.editions) {
      const edition = await readRetainedEdition(state, item.editionId);
      need(edition.manifest.source.sha256 === item.sourceSha256,
        'SOROBAN_PUBLICATION_RESTORED_EDITION_CHANGED', 409);
    }
    const status = state.store.status();
    for (const [key, value] of Object.entries(manifest.originalFeed))
      need(status[key] === value, 'SOROBAN_PUBLICATION_RESTORED_FEED_CHANGED', 409);
    await writeNew(join(target, 'restored.json'), json({ schema: SOROBAN_PUBLICATION_RECOVERY_SCHEMA,
      restoredAt: new Date().toISOString(), sourceSnapshot: manifest, resumeCommand: 'replay' }));
    return { directory: target, state: 'RESTORED', publication: state.publication,
      feed: status, editions: manifest.editions };
  } catch (error) { state?.store.close(); state = null; await rm(target, { recursive: true, force: true }); throw error; }
  finally { state?.store.close(); }
}

/** Retain the existing buyer's subscription, payment policy, cursor and native execution. */
export async function createSorobanPublicationBuyer({ directory, buyerDirectory, config,
  runtimeDirectory, buyerStateDirectory, id, pageSize = 100 } = {}) {
  need(buyerDirectory && config, 'SOROBAN_PUBLICATION_BUYER_CONFIG_REQUIRED');
  const state = await openPublicationStore(directory);
  let configured;
  try {
    configured = (await readJson(resolve(config), { maximum: 65536 })).value;
    const plan = state.store.merchantPlan().plan;
    need(plan?.publicOrigin && configured?.operation?.url ===
      new URL('/feeds/' + state.publication.feedId, plan.publicOrigin).href,
      'SOROBAN_PUBLICATION_BUYER_ENDPOINT_CHANGED', 409);
  } finally { state.store.close(); }
  const { createSubscription } = await import('../../sf88-operator-buyer-cli/event-feed/subscriber.mjs');
  const subscription = await createSubscription({ directory: resolve(buyerDirectory), config: configured,
    runtimeDirectory: resolve(runtimeDirectory ?? fileURLToPath(new URL('../../sf88-operator-buyer-cli/', import.meta.url))),
    buyerStateDirectory: resolve(buyerStateDirectory ?? join(buyerDirectory, 'original-buyer')),
    id: id ?? state.publication.feedId, feedId: state.publication.feedId,
    pageSize, startCursor: null, afterSequence: 0 });
  try { return subscription.inspect({ limit: 20 }); }
  finally { subscription.close(); }
}
