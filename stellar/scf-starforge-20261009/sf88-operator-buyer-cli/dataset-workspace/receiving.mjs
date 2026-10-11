// MIT. Original public seller offers -> original private SF88 dataset session.
import { randomUUID } from 'node:crypto';
import { lstat, link, unlink } from 'node:fs/promises';
import { join, dirname, basename } from 'node:path';
import { prepareReview } from '../prepare.mjs';
import { buyerTransport } from '../config.mjs';
import { validateDatasetQuery, canonical as nativeCanonical } from '../dataset-page.mjs';
import { createDatasetSession } from '../dataset-session.mjs';
import { initializeWorkspace, openWorkspace } from '../workspace.mjs';
import { validateNativeSignerConfiguration } from '../native-signer.mjs';
import { readBuyerOperatorPreset } from '../../buyer-runbook/handoff-intake.mjs';
import { absolute, privateDirectory, readPrivate, readJson, createFile, atomicJson,
  syncDirectory, bytes, digest, identity, object, fault } from '../../sf30-seller-sdk/postgres/publisher/files.mjs';

export const SCHEMA = 'stellar-forge.sf88.dataset-workspace.v1';
export const HASH = /^[a-f0-9]{64}$/;
export const ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export const CATALOG_LIMIT = 1048576;
export const check = (condition, code, message = code, status = 400) => {
  if (!condition) throw fault(code, message, status);
};
export const safeCode = error => /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'DATASET_WORKSPACE_FAILED';
export const optionalJson = async (path, maximum) => {
  try { return await readJson(path, maximum); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
};
export const decodeJSON = raw => {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw fault('DATASET_RECEIVED_JSON_INVALID', 'Choose the merchant’s original JSON offer file.'); }
};

async function present(path) {
  try { await lstat(path); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
export async function immutableFile(path, raw) {
  if (await present(path)) {
    check((await readPrivate(path, raw.length)).equals(raw), 'DATASET_SAVED_INPUT_CHANGED', 'The saved input differs from its original bytes.', 409);
    return;
  }
  const temporary = join(dirname(path), '.incoming-' + randomUUID());
  try {
    await createFile(temporary, raw);
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      await unlink(temporary);
      check((await readPrivate(path, raw.length)).equals(raw), 'DATASET_SAVED_INPUT_CHANGED', 'The saved input differs from its original bytes.', 409);
    }
  } finally { await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; }); }
  await syncDirectory(dirname(path));
}

export function nativeCatalog(raw) {
  check(raw.length > 0 && raw.length <= CATALOG_LIMIT, 'DATASET_CATALOG_SIZE', 'Offer files can contain up to 1 MiB.', 413);
  const value = decodeJSON(raw);
  const rows = Array.isArray(value) ? value : value?.schema === 'scf61-observed-native-page-v1'
    ? value.nativeProviderRows : value?.mode === 'ORIGINAL_UNSIGNED_CATALOG'
      ? value.originalListings : value?.resources ?? value?.items;
  check(Array.isArray(rows) && rows.length > 0 && rows.length <= 512,
    'DATASET_CATALOG_REQUIRED', 'Use the original saved discovery or seller offers JSON.');
  return { rows, native: bytes({ resources: rows }) };
}

export function catalogChoices(raw) {
  const { rows } = nativeCatalog(raw), choices = [];
  for (const [rowIndex, row] of rows.entries()) {
    const resource = typeof row?.resource === 'string' ? row.resource : row?.resource?.url;
    let url; try { url = new URL(resource); } catch { continue; }
    if (url.search || url.hash) continue;
    const query = row.extensions?.bazaar?.schema?.properties?.input?.properties?.queryParams;
    for (let acceptIndex = 0; acceptIndex < Math.min(row.accepts?.length ?? 0, 32); acceptIndex++) {
      try {
        const prepared = prepareReview(bytes({ resources: [row] }), {
          rowIndex: 0, acceptIndex, intentId: 'dataset-receiving-preview', method: 'GET', url: url.href,
        });
        if (prepared.draft.responseFile) continue;
        choices.push({ rowIndex, acceptIndex, resource: prepared.draft.operation.url,
          terms: prepared.draft.operation.expect, querySchema: object(query) ? query : null,
          description: typeof row.resource?.description === 'string' ? row.resource.description.slice(0, 1000) : '' });
      } catch { /* Unsupported offers stay in the retained original file. */ }
    }
  }
  return choices;
}

const amount = value => {
  check(typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n,
    'DATASET_BUDGET_INVALID', 'Use a positive integer amount in the selected asset’s atomic units.');
  return value;
};
const count = (value, minimum, maximum, label) => {
  check(Number.isSafeInteger(value) && value >= minimum && value <= maximum, 'DATASET_LIMIT_INVALID',
    `${label} must be an integer from ${minimum} through ${maximum}.`);
  return value;
};

/** Caller serializes metadata changes with the original private workspace lock. */
export async function openDatasetReceiving({ directory, operatorSettings = null }) {
  await privateDirectory(absolute(directory), true);
  for (const name of ['sources', 'reviews', 'products']) await privateDirectory(join(directory, name), true);
  if (operatorSettings !== null) absolute(operatorSettings, 'operator settings file');
  const preset = async () => {
    check(operatorSettings !== null, 'DATASET_OPERATOR_SETTINGS_REQUIRED', 'Open this workspace with the operator’s existing settings file.');
    return readBuyerOperatorPreset(operatorSettings, { directory });
  };
  async function operatorView() {
    try { return { operator: (await preset()).view, error: null }; }
    catch (error) { return { operator: null, error: safeCode(error) }; }
  }
  async function source(id) {
    check(HASH.test(id ?? ''), 'DATASET_SOURCE_INVALID');
    const path = join(directory, 'sources', id), record = await readJson(join(path, 'source.json'));
    const raw = await readPrivate(join(path, 'offers.json'), CATALOG_LIMIT);
    check(record.schema === SCHEMA && record.id === id && digest(raw) === id,
      'DATASET_RECEIVED_SOURCE_CHANGED', 'The received offer file changed.', 409);
    return { record, raw };
  }
  async function receive({ name, base64 } = {}) {
    check(typeof name === 'string' && name.length > 0 && name.length <= 180 && !/[\x00-\x1f\x7f]/.test(name), 'DATASET_FILENAME_INVALID');
    check(typeof base64 === 'string' && base64.length <= 4 * Math.ceil(CATALOG_LIMIT / 3), 'DATASET_CATALOG_SIZE', 'Offer files can contain up to 1 MiB.', 413);
    const raw = Buffer.from(base64, 'base64');
    check(raw.toString('base64') === base64, 'DATASET_FILE_ENCODING_INVALID');
    const choices = catalogChoices(raw);
    check(choices.length > 0, 'DATASET_GET_OFFER_REQUIRED', 'This file has no supported original GET offers.');
    const id = digest(raw), path = join(directory, 'sources', id);
    await privateDirectory(path, true);
    await immutableFile(join(path, 'offers.json'), raw);
    if (!await optionalJson(join(path, 'source.json'))) await atomicJson(path, 'source.json', {
      schema: SCHEMA, id, name: basename(name), bytes: raw.length, receivedAt: new Date().toISOString(),
    });
    return { ...(await source(id)).record, choices };
  }
  async function describe(id) {
    const received = await source(id);
    return { ...received.record, choices: catalogChoices(received.raw) };
  }
  async function build(input, operator) {
    check(object(input) && HASH.test(input.sourceId ?? '') && ID.test(input.name ?? ''),
      'DATASET_SELECTION_REQUIRED', 'Choose an offer file and a session name beginning with a letter.');
    const received = await source(input.sourceId), catalog = nativeCatalog(received.raw);
    const rowIndex = count(input.rowIndex, 0, catalog.rows.length - 1, 'Offer row');
    const row = catalog.rows[rowIndex], target = typeof row?.resource === 'string' ? row.resource : row?.resource?.url;
    let url; try { url = new URL(target); } catch { throw fault('DATASET_RESOURCE_INVALID'); }
    check(!url.search && !url.hash && typeof input.query === 'string' && input.query.length <= 8192,
      'DATASET_QUERY_INVALID', 'Enter first-page query parameters for the selected original resource.');
    url.search = input.query;
    const query = validateDatasetQuery(url.href, { initial: true });
    const maxPages = count(input.maxPages, 1, 4096, 'Maximum pages');
    const maxRows = count(input.maxRows, 1, 1000000, 'Maximum rows');
    const maxPageBytes = count(input.maxPageBytes, 1024, 2097152, 'Maximum page bytes');
    const maxTotalAtomic = amount(input.maxTotalAtomic), dailyAtomic = amount(input.dailyAtomic);
    const prepared = prepareReview(catalog.native, { rowIndex, acceptIndex: input.acceptIndex,
      intentId: 'dataset:' + input.sourceId.slice(0, 24) + ':' + input.name, url: url.href, method: 'GET' });
    check(!prepared.draft.responseFile, 'DATASET_PAGED_OFFER_REQUIRED', 'Choose a paginated JSON dataset offer.');
    const terms = prepared.draft.operation.expect, single = BigInt(amount(terms.maxAtomic));
    const total = BigInt(maxTotalAtomic), daily = BigInt(dailyAtomic);
    check(single <= daily && daily <= total && total <= BigInt(operator.value.maxTotalAtomic) &&
      daily <= BigInt(operator.value.maxDailyAtomic), 'DATASET_OPERATOR_BUDGET_EXCEEDED',
      'The selected daily and total caps must fit the operator’s declared limits.');
    validateNativeSignerConfiguration({ ...terms, expectedPayer: operator.value.payer, rpcUrl: operator.value.rpc });
    const proof = { schema: SCHEMA, sourceId: input.sourceId, name: input.name, rowIndex,
      acceptIndex: input.acceptIndex, query: url.search.slice(1), maxPages, maxRows, maxPageBytes,
      maxTotalAtomic, dailyAtomic, settingsSha256: operator.sha256,
      configSha256: prepared.configSha256, sourceUrl: url.href, terms,
      expectedSnapshot: query.get('snapshot'), operator: operator.view };
    return { proof, prepared, reviewId: identity(proof),
      plannedPageCapAtomic: (single * BigInt(maxPages)).toString(),
      pagesWithinTotalCap: Number(total / single < BigInt(maxPages) ? total / single : BigInt(maxPages)) };
  }
  async function review(input) {
    const value = await build(input, await preset());
    await immutableFile(join(directory, 'reviews', value.reviewId + '.json'), bytes(value.proof));
    return { ...value.proof, reviewId: value.reviewId, plannedPageCapAtomic: value.plannedPageCapAtomic,
      pagesWithinTotalCap: value.pagesWithinTotalCap };
  }
  async function reviewed(reviewId) {
    check(HASH.test(reviewId ?? ''), 'DATASET_REVIEW_REQUIRED');
    const proof = await readJson(join(directory, 'reviews', reviewId + '.json'));
    check(proof.schema === SCHEMA && identity(proof) === reviewId, 'DATASET_REVIEW_CHANGED', 'The saved review changed.', 409);
    return proof;
  }
  async function prepared(reviewId, proof, ready) {
    const root = join(directory, 'products', reviewId);
    check(ready?.schema === SCHEMA && ready.reviewId === reviewId && Number.isSafeInteger(ready.generation) &&
      ready.generation >= 1 && ready.generation <= 64 && ready.session === join(root, 'session-' + ready.generation) &&
      ready.workspace === join(root, 'operator-' + ready.generation) && ready.room === join(root, 'data-room-' + ready.generation),
    'DATASET_PREPARATION_CHANGED');
    for (const name of ['operator.json', 'workspace.json', 'policy.json', 'signer.mjs'])
      check(digest(await readPrivate(join(ready.workspace, name))) === ready.files?.[name], 'DATASET_PREPARED_WORKSPACE_CHANGED', 'The original operator configuration changed.', 409);
    await openWorkspace(['--dir', ready.workspace]);
    const raw = await readPrivate(join(ready.session, 'session.json')), definition = decodeJSON(raw);
    check(definition.config.operation.intentId === ready.sessionId && definition.configurationSha256 === ready.configurationSha256 &&
      digest(nativeCanonical(definition.config)) === ready.configurationSha256 && digest(raw) === ready.definitionSha256,
    'DATASET_SESSION_CHANGED', 'The original session identity changed.', 409);
    return { ...ready, proof, reopened: true };
  }
  async function preflight(reviewId) {
    const proof = await reviewed(reviewId), built = await build(proof, await preset());
    check(built.reviewId === reviewId, 'DATASET_REVIEW_CHANGED', 'The reviewed source or operator settings changed.', 409);
    return prepared(reviewId, proof, await optionalJson(join(directory, 'products', reviewId, 'ready.json')));
  }
  async function provision(reviewId) {
    const proof = await reviewed(reviewId);
    const operator = await preset(), built = await build(proof, operator);
    check(built.reviewId === reviewId, 'DATASET_REVIEW_CHANGED', 'The offer, selected input or operator settings changed. Review again.', 409);
    const root = join(directory, 'products', reviewId); await privateDirectory(root, true);
    const ready = await optionalJson(join(root, 'ready.json'));
    if (ready) return prepared(reviewId, proof, ready);
    let attempt = await optionalJson(join(root, 'attempt.json'));
    if (!attempt || (await present(attempt.session) && !await present(join(attempt.session, 'session.json'))) ||
      (await present(attempt.workspace) && !await present(join(attempt.workspace, 'workspace.json')))) {
      const generation = (attempt?.generation ?? 0) + 1;
      check(generation <= 64, 'DATASET_PREPARATION_ATTEMPT_LIMIT');
      attempt = { reviewId, generation, workspace: join(root, 'operator-' + generation), session: join(root, 'session-' + generation) };
      await atomicJson(root, 'attempt.json', attempt);
    }
    check(attempt.reviewId === reviewId && Number.isSafeInteger(attempt.generation) && attempt.generation >= 1 && attempt.generation <= 64 &&
      attempt.workspace === join(root, 'operator-' + attempt.generation) && attempt.session === join(root, 'session-' + attempt.generation),
    'DATASET_PREPARATION_CHANGED');
    const input = join(root, 'review.json'); await immutableFile(input, built.prepared.data);
    if (!await present(join(attempt.workspace, 'workspace.json'))) {
      const value = operator.value, args = ['--config', input, '--dir', attempt.workspace,
        '--actor', value.actor, '--service', value.service, '--payer', value.payer, '--python', value.python,
        '--total-atomic', proof.maxTotalAtomic, '--daily-atomic', proof.dailyAtomic];
      for (const [key, flag] of [['secretEnv', '--secret-env'], ['signerProvider', '--signer-provider'], ['rpc', '--rpc'], ['httpsProxyEnv', '--https-proxy-env']])
        if (value[key] !== undefined) args.push(flag, value[key]);
      await initializeWorkspace(args);
    }
    const native = await openWorkspace(['--dir', attempt.workspace]), settings = operator.value, files = {};
    check(native.config.operation.url === proof.sourceUrl && native.config.operation.method === 'GET' &&
      nativeCanonical(native.config.operation.expect) === nativeCanonical(proof.terms) &&
      native.config.operation.intentId === built.prepared.draft.operation.intentId &&
      native.config.trustedPayer === operator.value.payer, 'DATASET_PREPARED_WORKSPACE_CHANGED');
    check(nativeCanonical(native.config.preparedFrom) === nativeCanonical(built.prepared.draft.preparedFrom) &&
      ['actor', 'service', 'python'].every(key => native.config.operator[key] === settings[key]), 'DATASET_PREPARED_WORKSPACE_CHANGED');
    const pins = validateNativeSignerConfiguration({ ...proof.terms, expectedPayer: settings.payer, rpcUrl: settings.rpc });
    check(native.manifest.signer.rpcUrl === pins.rpcUrl && native.manifest.signer.maxAtomic === proof.terms.maxAtomic &&
      native.manifest.signer.secretEnv === (settings.signerProvider === undefined ? settings.secretEnv ?? 'STELLAR_SECRET' : undefined) &&
      native.manifest.signer.signerProvider === settings.signerProvider, 'DATASET_PREPARED_SIGNER_CHANGED');
    const transport = buyerTransport({ operation: native.config.operation, ...(settings.httpsProxyEnv === undefined ? {} :
      { buyerTransport: { mode: 'explicit-connect', origin: new URL(proof.sourceUrl).origin, proxyEnv: settings.httpsProxyEnv } }) });
    check(nativeCanonical(buyerTransport(native.config)) === nativeCanonical(transport), 'DATASET_PREPARED_TRANSPORT_CHANGED');
    const policy = await readJson(join(attempt.workspace, 'policy.json')), limits = policy.assets?.[0];
    check(policy.assets?.length === 1 && limits.network === proof.terms.network && limits.asset === proof.terms.asset &&
      limits.max_single === proof.terms.maxAtomic && limits.max_total === proof.maxTotalAtomic &&
      ['max_per_utc_day', 'max_per_actor_utc_day', 'max_per_service_utc_day'].every(key => limits[key] === proof.dailyAtomic),
    'DATASET_PREPARED_BUDGET_CHANGED');
    for (const name of ['operator.json', 'workspace.json', 'policy.json', 'signer.mjs']) files[name] = digest(await readPrivate(join(attempt.workspace, name)));
    if (!await present(join(attempt.session, 'session.json'))) await createDatasetSession({
      directory: attempt.session, workspaceDirectory: attempt.workspace,
      maxPages: proof.maxPages, maxTotalAtomic: proof.maxTotalAtomic, maxRows: proof.maxRows,
      maxPageBytes: proof.maxPageBytes, expectedSnapshot: proof.expectedSnapshot,
    });
    const definitionRaw = await readPrivate(join(attempt.session, 'session.json')), definition = decodeJSON(definitionRaw);
    check(definition.workspaceDirectory === attempt.workspace && definition.config.operation.url === proof.sourceUrl &&
      definition.configurationSha256 === digest(nativeCanonical(native.config)) && definition.expectedSnapshot === proof.expectedSnapshot &&
      ['maxPages', 'maxTotalAtomic', 'maxRows', 'maxPageBytes'].every(key => definition.limits[key] === proof[key]), 'DATASET_SESSION_CHANGED');
    const result = { schema: SCHEMA, reviewId, name: proof.name, session: attempt.session,
      workspace: attempt.workspace, room: join(root, 'data-room-' + attempt.generation),
      sessionId: definition.config.operation.intentId, configurationSha256: definition.configurationSha256,
      generation: attempt.generation, definitionSha256: digest(definitionRaw), files,
      createdAt: new Date().toISOString() };
    await atomicJson(root, 'ready.json', result);
    return { ...result, proof, reopened: false };
  }
  return { operatorView, receive, describe, review, reviewed, provision, preflight };
}
