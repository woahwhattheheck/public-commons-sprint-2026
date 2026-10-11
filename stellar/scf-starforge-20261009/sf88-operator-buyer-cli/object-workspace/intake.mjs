// MIT. Public merchant inputs join the ORIGINAL private object buyer workspace.
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, realpath, link, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { InputError, buyerTransport } from '../config.mjs';
import { prepareReview } from '../prepare.mjs';
import { selectObjectDescriptionBytes } from '../object-description.mjs';
import { initializeWorkspace, openWorkspace } from '../workspace.mjs';
import { validateNativeSignerConfiguration } from '../native-signer.mjs';
import { readBuyerOperatorPreset } from '../../buyer-runbook/handoff-intake.mjs';
import { acquireRunbookMetadataLease } from '../../buyer-runbook/runbook.mjs';

const SCHEMA = 'stellar-forge.sf88.object-receiving.v1';
const HASH = /^[a-f0-9]{64}$/;
const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const DESCRIPTION_LIMIT = 8 * 1048576, CATALOG_LIMIT = 1048576;
export const OBJECT_RECEIVING_REQUEST_LIMIT = 4 * Math.ceil((DESCRIPTION_LIMIT + CATALOG_LIMIT) / 3) + 4096;
const encode = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const hash = raw => createHash('sha256').update(raw).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const check = (ok, code, status = 400) => { if (!ok) throw Object.assign(new InputError(code), { status }); };
const code = error => /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'OBJECT_RECEIVING_FAILED';
const amount = value => {
  check(typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) &&
    BigInt(value) <= 9223372036854775807n, 'OBJECT_RECEIVING_BUDGET_INVALID');
  return value;
};
const canonical = path => {
  check(typeof path === 'string' && isAbsolute(path) && resolve(path) === path && !path.includes('\0'),
    'OBJECT_RECEIVING_CANONICAL_PATH_REQUIRED'); return path;
};
function parse(raw) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw new InputError('OBJECT_RECEIVING_JSON_INVALID'); }
}
async function privateDirectory(path, create = false) {
  canonical(path);
  if (create) {
    check(await realpath(dirname(path)) === dirname(path), 'OBJECT_RECEIVING_PARENT_CHANGED');
    await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  }
  const info = await lstat(path);
  check(info.isDirectory() && !info.isSymbolicLink() && await realpath(path) === path &&
    (info.mode & 0o077) === 0 && (typeof process.getuid !== 'function' || info.uid === process.getuid()),
    'OBJECT_RECEIVING_PRIVATE_DIRECTORY_REQUIRED');
}
async function read(path, limit = 65536) {
  canonical(path); check(await realpath(path) === path, 'OBJECT_RECEIVING_FILE_PATH_CHANGED');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = await file.stat({ bigint: true }), info = await file.stat();
    check(info.isFile() && info.nlink === 1 && info.size <= limit && (info.mode & 0o077) === 0 &&
      (typeof process.getuid !== 'function' || info.uid === process.getuid()), 'OBJECT_RECEIVING_PRIVATE_FILE_REQUIRED');
    const bytes = Buffer.alloc(Math.min(info.size + 1, limit + 1)); let length = 0;
    while (length < bytes.length) {
      const { bytesRead } = await file.read(bytes, length, bytes.length - length, length);
      if (!bytesRead) break; length += bytesRead;
    }
    const after = await file.stat({ bigint: true });
    check(length === info.size && length <= limit && ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']
      .every(key => before[key] === after[key]), 'OBJECT_RECEIVING_FILE_CHANGED', 409);
    return bytes.subarray(0, length);
  } finally { await file.close(); }
}
async function optional(path) {
  try { return parse(await read(path)); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function sync(path) { const file = await open(path, 'r'); try { await file.sync(); } finally { await file.close(); } }
async function publish(path, value, raw = false) {
  const data = raw ? value : encode(value), temporary = path + '.' + randomUUID() + '.tmp';
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await file.writeFile(data); await file.sync(); await file.close();
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Drop our temporary link before reading a previously published file.
      await unlink(temporary);
      check((await read(path, data.length)).equals(data), 'OBJECT_RECEIVING_SAVED_INPUT_CHANGED', 409);
    }
  } finally { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
  await sync(dirname(path));
}
function decoded(value, maximum) {
  check(typeof value === 'string' && value.length <= 4 * Math.ceil(maximum / 3), 'OBJECT_RECEIVING_FILE_TOO_LARGE', 413);
  const raw = Buffer.from(value, 'base64');
  check(raw.length > 0 && raw.length <= maximum && raw.toString('base64') === value,
    'OBJECT_RECEIVING_FILE_ENCODING_INVALID'); return raw;
}
function filename(value) {
  check(typeof value === 'string' && value.length > 0 && value.length <= 180 && !/[\x00-\x1f\x7f]/.test(value),
    'OBJECT_RECEIVING_FILENAME_INVALID'); return basename(value);
}
function catalog(raw) {
  const value = parse(raw);
  // The original seller returns an array. Retain those exact bytes and use the
  // native saved-discovery envelope for prepareReview, with unchanged rows.
  let originalRows = Array.isArray(value) ? value : null;
  if (value?.schema === 'stellar-forge.s3-seller-offers.v1') {
    check(Array.isArray(value.offers) && value.offers.every(item => object(item) && object(item.seller)),
      'OBJECT_RECEIVING_CATALOG_INVALID');
    originalRows = value.offers.map(item => item.seller);
  }
  const normalized = originalRows ? encode({ resources: originalRows }) : raw;
  const saved = originalRows ? { resources: originalRows } : value;
  check(object(saved), 'OBJECT_RECEIVING_CATALOG_INVALID');
  const rows = saved.schema === 'scf61-observed-native-page-v1' ? saved.nativeProviderRows :
    saved.mode === 'ORIGINAL_UNSIGNED_CATALOG' ? saved.originalListings : saved.resources ?? saved.items;
  check(Array.isArray(rows) && rows.length > 0 && rows.length <= 512 && normalized.length <= CATALOG_LIMIT,
    'OBJECT_RECEIVING_CATALOG_INVALID');
  return { raw: normalized, rows };
}
function objects(raw) {
  const value = parse(raw);
  check(object(value) && value.schema === 'stellar-forge.s3-description.v1' &&
    Array.isArray(value.objects) && value.objects.length > 0 && value.objects.length <= 512,
    'OBJECT_ORIGINAL_S3_DESCRIPTION_REQUIRED');
  const counts = new Map();
  for (const item of value.objects) counts.set(item?.id, (counts.get(item?.id) ?? 0) + 1);
  return value.objects.map(item => {
    try {
      check(counts.get(item?.id) === 1, 'OBJECT_DESCRIPTION_SELECTION_NOT_UNIQUE');
      // Validate each displayed row through the original selector without
      // reparsing a multi-megabyte catalog for every label. Review below binds
      // the full original bytes and their original description digest.
      const selected = selectObjectDescriptionBytes(encode({ schema: value.schema, objects: [item] }), { objectId: item?.id });
      return { id: selected.selection.objectId, name: selected.selection.filename, path: selected.selection.path,
        bytes: selected.bytes, chunkBytes: selected.chunkBytes, snapshot: selected.expectedSnapshot,
        expectedSha256: selected.expectedSha256, contentType: selected.expectedContentType };
    } catch (error) {
      return { id: typeof item?.id === 'string' ? item.id.slice(0,64) : '',
        name: typeof item?.filename === 'string' ? item.filename.slice(0,120) : 'Unavailable object', error: code(error) };
    }
  });
}

/** One original native workspace per reviewed receiving plan. No buyer runs here. */
export async function openObjectReceiving({ directory, operatorSettings } = {}) {
  await privateDirectory(directory, true);
  const sources = join(directory, 'sources'), reviews = join(directory, 'reviews'), products = join(directory, 'products');
  for (const path of [sources, reviews, products]) await privateDirectory(path, true);
  const settingsPath = join(directory, 'operator-settings.json');
  if (operatorSettings !== undefined) await publish(settingsPath, { path: canonical(operatorSettings) });
  const savedSettings = await optional(settingsPath), settingsFile = savedSettings?.path ?? null;
  if (settingsFile !== null) canonical(settingsFile);
  const preset = () => readBuyerOperatorPreset(settingsFile, { directory });
  const sourcePath = id => { check(HASH.test(id ?? ''), 'OBJECT_RECEIVING_SOURCE_INVALID'); return join(sources, id); };
  const planPath = id => { check(HASH.test(id ?? ''), 'OBJECT_RECEIVING_REVIEW_INVALID'); return join(products, id); };
  async function lease(action) {
    const release = await acquireRunbookMetadataLease(directory);
    try { return await action(); } finally { await release(); }
  }
  async function source(id) {
    const path = sourcePath(id), record = await optional(join(path, 'source.json'));
    check(record?.schema === SCHEMA && record.id === id, 'OBJECT_RECEIVING_SOURCE_NOT_FOUND', 404);
    const description = await read(join(path, 'objects.json'), DESCRIPTION_LIMIT), offers = await read(join(path, 'offers.json'), CATALOG_LIMIT);
    check(hash(description) === record.descriptionSha256 && hash(offers) === record.catalogSha256 &&
      hash(encode([record.descriptionSha256, record.catalogSha256])) === id, 'OBJECT_RECEIVING_SOURCE_CHANGED', 409);
    return { record, description, offers };
  }
  async function receive({ descriptionName, descriptionBase64, catalogName, catalogBase64 } = {}) {
    const description = decoded(descriptionBase64, DESCRIPTION_LIMIT), offers = decoded(catalogBase64, CATALOG_LIMIT);
    const selected = objects(description); catalog(offers);
    check(selected.some(item => !item.error), 'OBJECT_RECEIVING_CHUNK_OBJECT_REQUIRED');
    const descriptionSha256 = hash(description), catalogSha256 = hash(offers);
    const id = hash(encode([descriptionSha256, catalogSha256])), path = sourcePath(id);
    const names = { descriptionName: filename(descriptionName), catalogName: filename(catalogName) };
    await privateDirectory(path, true);
    await publish(join(path, 'objects.json'), description, true); await publish(join(path, 'offers.json'), offers, true);
    if (!await optional(join(path, 'source.json')))
      await publish(join(path, 'source.json'), { schema: SCHEMA, id, ...names, descriptionSha256, catalogSha256, receivedAt: new Date().toISOString() });
    const retained = await source(id);
    return { ...retained.record, objects: selected };
  }
  async function options(id, objectId) {
    const received = await source(id), selected = selectObjectDescriptionBytes(received.description, { objectId });
    const saved = catalog(received.offers), choices = [];
    for (const [rowIndex, row] of saved.rows.entries()) {
      const target = typeof row?.resource === 'string' ? row.resource : row?.resource?.url;
      let url; try { url = new URL(target); } catch { continue; }
      if (url.pathname !== selected.selection.path || url.search) continue;
      const accepts = Array.isArray(row?.accepts) ? row.accepts.length : 0;
      const displayedRow = encode({ resources: [row] });
      for (let acceptIndex = 0; acceptIndex < Math.min(accepts, 32); acceptIndex++) {
        try {
          const prepared = prepareReview(displayedRow, { rowIndex: 0, acceptIndex, intentId: 'object-source:' + id,
            url: url.href, method: 'GET' });
          check(!prepared.draft.responseFile, 'OBJECT_RECEIVING_CHUNK_OFFER_REQUIRED');
          choices.push({ rowIndex, acceptIndex, url: prepared.draft.operation.url, terms: prepared.draft.operation.expect });
        } catch (error) { choices.push({ rowIndex, acceptIndex, url: url.href, error: code(error) }); }
      }
    }
    return { id, objectId, choices };
  }
  async function build(input, operator) {
    const { id, objectId, rowIndex, acceptIndex, chunkBytes, sessionName, maxTotalAtomic, dailyAtomic } = input;
    check(ID.test(sessionName ?? ''), 'OBJECT_WORKSPACE_SESSION_NAME_INVALID');
    const received = await source(id), saved = catalog(received.offers);
    const selected = selectObjectDescriptionBytes(received.description, { objectId, chunkBytes });
    check(Number.isSafeInteger(rowIndex) && rowIndex >= 0 && rowIndex < saved.rows.length, 'DISCOVERY_ROW_NOT_FOUND');
    const row = saved.rows[rowIndex], target = typeof row?.resource === 'string' ? row.resource : row?.resource?.url;
    const prepared = prepareReview(saved.raw, { rowIndex, acceptIndex, intentId: 'object-source:' + id, url: target, method: 'GET' });
    const op = prepared.draft.operation, url = new URL(op.url);
    check(!url.search && url.pathname === selected.selection.path && !prepared.draft.responseFile,
      'OBJECT_DESCRIPTION_BUYER_ROUTE_MISMATCH');
    const count = Math.ceil(selected.bytes / selected.chunkBytes), single = BigInt(amount(op.expect.maxAtomic));
    validateNativeSignerConfiguration({ ...op.expect, expectedPayer: operator.value.payer, rpcUrl: operator.value.rpc });
    const total = BigInt(amount(maxTotalAtomic)), daily = BigInt(amount(dailyAtomic));
    check(count <= 100000 && single * BigInt(count) <= total, 'OBJECT_TOTAL_BUDGET_INSUFFICIENT');
    check(single <= daily && daily <= total && total <= BigInt(operator.value.maxTotalAtomic) &&
      daily <= BigInt(operator.value.maxDailyAtomic), 'OBJECT_RECEIVING_BUDGET_OUTSIDE_OPERATOR_LIMITS');
    const proof = { schema: SCHEMA, id, objectId, rowIndex, acceptIndex, chunkBytes: selected.chunkBytes,
      sessionName, maxTotalAtomic, dailyAtomic, settingsSha256: operator.sha256,
      descriptionSha256: received.record.descriptionSha256, catalogSha256: received.record.catalogSha256,
      configSha256: prepared.configSha256, selected, terms: op.expect, sourceUrl: op.url, operator: operator.view };
    return { proof, prepared, public: { ...proof, filename: selected.selection.filename, bytes: selected.bytes,
      chunkCount: count, plannedMaxAtomic: (single * BigInt(count)).toString(),
      firstRange: { offset: 0, length: Math.min(selected.chunkBytes, selected.bytes) },
      lastRange: { offset: (count - 1) * selected.chunkBytes, length: selected.bytes - (count - 1) * selected.chunkBytes } } };
  }
  async function review(input) {
    const built = await build(input, await preset()), reviewId = hash(encode(built.proof));
    await publish(join(reviews, reviewId + '.json'), built.proof);
    return { ...built.public, reviewId };
  }
  async function reviewed(id) {
    check(HASH.test(id ?? ''), 'OBJECT_RECEIVING_REVIEW_INVALID');
    const proof = await optional(join(reviews, id + '.json'));
    check(proof?.schema === SCHEMA && hash(encode(proof)) === id, 'OBJECT_RECEIVING_REVIEW_CHANGED', 409);
    return proof;
  }
  async function product(reviewId) {
    const path = planPath(reviewId), ready = await optional(join(path, 'ready.json'));
    if (!ready) return null;
    const review = await reviewed(reviewId);
    check(ready.schema === SCHEMA && ready.reviewId === reviewId && Number.isSafeInteger(ready.generation) &&
      ready.generation > 0 && ready.generation <= 64, 'OBJECT_RECEIVING_PRODUCT_CHANGED', 409);
    const workspace = join(path, 'operator-' + ready.generation);
    for (const name of ['operator.json', 'workspace.json', 'policy.json', 'signer.mjs'])
      check(hash(await read(join(workspace, name))) === ready.files?.[name], 'OBJECT_RECEIVING_OPERATOR_CHANGED', 409);
    await openWorkspace(['--dir', workspace]);
    return { id: 'received-' + reviewId.slice(0,48), label: review.selected.selection.filename,
      descriptionFile: join(sourcePath(review.id), 'objects.json'), objectId: review.objectId,
      configFile: join(workspace, 'operator.json'), workspace, receivedReview: reviewId };
  }
  async function provision({ reviewId } = {}) {
    const proof = await reviewed(reviewId), existing = await product(reviewId);
    if (existing) return { product: existing, review: proof, reopened: true };
    const operator = await preset();
    check(operator.sha256 === proof.settingsSha256, 'OBJECT_RECEIVING_PRESET_CHANGED', 409);
    const built = await build(proof, operator);
    check(hash(encode(built.proof)) === reviewId, 'OBJECT_RECEIVING_REVIEW_CHANGED', 409);
    const path = planPath(reviewId); await privateDirectory(path, true);
    const input = join(path, 'review.json'); await publish(input, built.prepared.data, true);
    const generations = (await readdir(path)).filter(name => /^attempt-[1-9][0-9]*\.json$/.test(name))
      .map(name => Number(name.slice(8,-5))).sort((a,b) => b-a);
    let generation, workspace;
    for (const value of generations) {
      const attempt = await optional(join(path, 'attempt-' + value + '.json'));
      check(attempt?.reviewId === reviewId && attempt.generation === value, 'OBJECT_RECEIVING_ATTEMPT_CHANGED', 409);
      const candidate = join(path, 'operator-' + value);
      if (await optional(join(candidate, 'workspace.json'))) { generation = value; workspace = candidate; break; }
    }
    if (!workspace) {
      generation = (generations[0] ?? 0) + 1; check(generation <= 64, 'OBJECT_RECEIVING_ATTEMPT_LIMIT');
      workspace = join(path, 'operator-' + generation);
      await publish(join(path, 'attempt-' + generation + '.json'), { reviewId, generation });
      const value = operator.value;
      const args = ['--config', input, '--dir', workspace, '--actor', value.actor, '--service', value.service,
        '--payer', value.payer, '--python', value.python, '--total-atomic', proof.maxTotalAtomic, '--daily-atomic', proof.dailyAtomic];
      for (const [key, flag] of [['secretEnv','--secret-env'],['signerProvider','--signer-provider'],['rpc','--rpc'],['httpsProxyEnv','--https-proxy-env']])
        if (value[key] !== undefined) args.push(flag, value[key]);
      await initializeWorkspace(args);
    }
    const native = await openWorkspace(['--dir', workspace]), files = {};
    const op = native.config.operation, settings = operator.value;
    check(op.url === proof.sourceUrl && op.method === 'GET' &&
      JSON.stringify(op.expect) === JSON.stringify(proof.terms) && native.config.trustedPayer === proof.operator.payer,
      'OBJECT_RECEIVING_OPERATOR_CHANGED', 409);
    check(op.intentId === built.prepared.draft.operation.intentId &&
      JSON.stringify(native.config.preparedFrom) === JSON.stringify(built.prepared.draft.preparedFrom) &&
      ['actor', 'service', 'python'].every(key => native.config.operator[key] === settings[key]),
      'OBJECT_RECEIVING_OPERATOR_CHANGED', 409);
    const pins = validateNativeSignerConfiguration({ ...proof.terms, expectedPayer: settings.payer, rpcUrl: settings.rpc });
    check(native.manifest.signer.rpcUrl === pins.rpcUrl && native.manifest.signer.maxAtomic === proof.terms.maxAtomic &&
      native.manifest.signer.secretEnv === (settings.signerProvider === undefined ? settings.secretEnv ?? 'STELLAR_SECRET' : undefined) &&
      native.manifest.signer.signerProvider === settings.signerProvider, 'OBJECT_RECEIVING_SIGNER_CHANGED', 409);
    const transport = buyerTransport({ operation: op, ...(settings.httpsProxyEnv === undefined ? {} :
      { buyerTransport: { mode: 'explicit-connect', origin: new URL(op.url).origin, proxyEnv: settings.httpsProxyEnv } }) });
    check(JSON.stringify(buyerTransport(native.config)) === JSON.stringify(transport), 'OBJECT_RECEIVING_TRANSPORT_CHANGED', 409);
    const policy = parse(await read(join(workspace, 'policy.json'))), limits = policy.assets?.[0];
    check(policy.assets?.length === 1 && limits.network === proof.terms.network && limits.asset === proof.terms.asset &&
      limits.max_single === proof.terms.maxAtomic && limits.max_total === proof.maxTotalAtomic &&
      ['max_per_utc_day','max_per_actor_utc_day','max_per_service_utc_day'].every(key => limits[key] === proof.dailyAtomic),
      'OBJECT_RECEIVING_BUDGET_CHANGED', 409);
    for (const name of ['operator.json', 'workspace.json', 'policy.json', 'signer.mjs']) files[name] = hash(await read(join(workspace, name)));
    await publish(join(path, 'ready.json'), { schema: SCHEMA, reviewId, generation, files });
    return { product: await product(reviewId), review: proof, reopened: false };
  }
  async function state() {
    let operator = null, presetError = null;
    if (settingsFile !== null) { try { operator = (await preset()).view; } catch (error) { presetError = code(error); } }
    const records = [];
    for (const id of (await readdir(sources)).filter(name => HASH.test(name))) {
      try { const value = await source(id); records.push({ ...value.record, objects: objects(value.description) }); }
      catch (error) { records.push({ id, error: code(error) }); }
    }
    return { operator, presetError, sources: records.sort((a,b) => (b.receivedAt ?? '').localeCompare(a.receivedAt ?? '')) };
  }
  async function preparedProducts() {
    const result = [];
    for (const id of (await readdir(products)).filter(name => HASH.test(name))) {
      try { const value = await product(id); if (value) result.push(value); }
      catch (error) { result.push({ id: 'received-' + id.slice(0,48), label: 'Received object', error: code(error) }); }
    }
    return result;
  }
  return { state, options, products: preparedProducts,
    receive: value => lease(() => receive(value)), review: value => lease(() => review(value)),
    provision: value => lease(() => provision(value)) };
}
