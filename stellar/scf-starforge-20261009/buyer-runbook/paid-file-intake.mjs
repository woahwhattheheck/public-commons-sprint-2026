// MIT. Receive SF101 orders into the original buyer runbook and transfer engine.
import { constants } from 'node:fs';
import { mkdir, open, lstat, realpath, readdir, link, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { isDeepStrictEqual as same } from 'node:util';
import { readBuyerOperatorPreset } from './handoff-intake.mjs';
import { acquireRunbookMetadataLease } from './runbook.mjs';
import { config as nativeConfig, execution, operation, buyerTransport, InputError } from '../sf88-operator-buyer-cli/config.mjs';
import { initializeWorkspace, openWorkspace } from '../sf88-operator-buyer-cli/workspace.mjs';
import { validateNativeSignerConfiguration } from '../sf88-operator-buyer-cli/native-signer.mjs';
import { validateHandoff } from '../sf101-merchant-receiver/checkout-config.mjs';
import { preparePurchase } from '../sf101-merchant-receiver/purchase.mjs';
import { verifyExistingDeliveryFile } from '../sf101-merchant-receiver/resumable-transfer.mjs';
import { readPurchaseInput, freezePurchase, inspectCommercePurchase,
  retrieveCommercePurchase, resetCommercePurchase } from '../sf66-demo-launcher/commerce-purchase.mjs';

const SCHEMA = 'stellar-forge.buyer-paid-file-intake.v1';
const ORDER = /^file-[a-f0-9]{64}$/;
const CONFIG = /^paid-file-[a-f0-9]{64}\.json$/;
const ENV = /^[A-Z][A-Z0-9_]{1,64}$/;
const MAX_BYTES = 131072;
const hash = value => createHash('sha256').update(value).digest('hex');
const encoded = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const now = () => new Date().toISOString();
const check = (ok, code, status = 422) => { if (!ok) throw Object.assign(new InputError(code), { status }); };
const codeOf = error => /^[A-Z0-9_]{1,120}$/.test(error?.code ?? '') ? error.code : 'PAID_FILE_INTAKE_FAILED';
function fields(value, allowed, required = allowed) {
  check(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).every(key => allowed.includes(key)) && required.every(key => Object.hasOwn(value, key)),
  'PAID_FILE_FIELDS_INVALID');
}
function canonical(path) {
  check(typeof path === 'string' && isAbsolute(path) && resolve(path) === path && path !== '/' && !path.includes('\0'),
    'PAID_FILE_CANONICAL_PATH_REQUIRED'); return path;
}
async function privateDirectory(path, create = false) {
  canonical(path);
  if (create) {
    check(await realpath(dirname(path)) === dirname(path), 'PAID_FILE_PARENT_CHANGED');
    await mkdir(path, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  }
  const info = await lstat(path);
  check(info.isDirectory() && !info.isSymbolicLink() && await realpath(path) === path &&
    (info.mode & 0o077) === 0 && (typeof process.getuid !== 'function' || info.uid === process.getuid()),
  'PAID_FILE_PRIVATE_DIRECTORY_REQUIRED');
}
async function bytes(path, limit = MAX_BYTES) {
  check(await realpath(path) === path, 'PAID_FILE_SOURCE_PATH_CHANGED');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const info = await file.stat();
    check(info.isFile() && (info.mode & 0o077) === 0 && info.size <= limit &&
      (typeof process.getuid !== 'function' || info.uid === process.getuid()), 'PAID_FILE_PRIVATE_FILE_REQUIRED');
    const buffer = Buffer.alloc(limit + 1); let offset = 0;
    while (offset < buffer.length) {
      const part = await file.read(buffer, offset, buffer.length - offset, offset);
      if (!part.bytesRead) break; offset += part.bytesRead;
    }
    check(offset <= limit, 'PAID_FILE_SOURCE_TOO_LARGE'); return buffer.subarray(0, offset);
  } finally { await file.close(); }
}
function parse(raw) {
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)); }
  catch { throw new InputError('PAID_FILE_JSON_INVALID'); }
}
const json = async path => parse(await bytes(path));
async function optional(path) {
  try { return await json(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function publish(path, value, raw = false) {
  const data = raw ? value : encoded(value), temporary = path + '.' + randomUUID() + '.tmp';
  const file = await open(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await file.writeFile(data); await file.sync(); await file.close();
    try { await link(temporary, path); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      check((await bytes(path, data.length)).equals(data), 'PAID_FILE_RETAINED_INPUT_CHANGED', 409);
    }
    const directory = await open(dirname(path), 'r');
    try { await directory.sync(); } finally { await directory.close(); }
  } finally { await file.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
}
function amount(value) {
  check(typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n,
    'PAID_FILE_BUDGET_INVALID'); return value;
}
function filename(value) {
  check(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value), 'PAID_FILE_NAME_INVALID'); return value;
}
function orderId(handoff) {
  // One original merchant order keeps one native intent, even when JSON whitespace
  // changes. A changed promise for this identity is a conflict, never a new buy.
  return 'file-' + hash(JSON.stringify([new URL(handoff.purchaseUrl).origin, handoff.orderReference]));
}
function reviewedOperation(id, handoff) {
  const p = handoff.payment;
  return operation({ intentId: 'paid-file:' + id.slice(5), url: handoff.purchaseUrl, method: 'GET',
    orderReference: handoff.orderReference,
    expect: { scheme: p.scheme, network: p.network, asset: p.asset, payTo: p.payTo,
      maxAtomic: p.amount, maxTimeoutSeconds: p.maxTimeoutSeconds,
      paymentFlow: p.extra?.paymentFlow ?? 'authorization' } });
}

/** Local launcher controls operator settings and the available claim environment
 * names. Received files supply only the existing SF101 public order promise. */
export async function openPaidFileIntake({ directory, configsDirectory, settingsFile,
  claimEnvs, environment = process.env } = {}) {
  await privateDirectory(directory, true); await privateDirectory(configsDirectory);
  check(typeof settingsFile === 'function', 'PAID_FILE_OPERATOR_SETTINGS_REQUIRED');
  if (claimEnvs !== undefined) check(Array.isArray(claimEnvs) && claimEnvs.length > 0 && claimEnvs.length <= 32 &&
    claimEnvs.every(name => ENV.test(name)) && new Set(claimEnvs).size === claimEnvs.length, 'PAID_FILE_CLAIM_ENVS_INVALID');
  let meta = await optional(join(directory, 'intake.json'));
  if (!meta) {
    meta = { schema: SCHEMA, directory, configsDirectory, claimEnvs: claimEnvs ?? ['SF101_CLAIM_TOKEN'] };
    await publish(join(directory, 'intake.json'), meta);
  }
  check(meta.schema === SCHEMA && meta.directory === directory && meta.configsDirectory === configsDirectory &&
    Array.isArray(meta.claimEnvs) && meta.claimEnvs.length > 0 && meta.claimEnvs.length <= 32 &&
    new Set(meta.claimEnvs).size === meta.claimEnvs.length && meta.claimEnvs.every(name => ENV.test(name)),
  'PAID_FILE_WORKSPACE_CHANGED');
  check(claimEnvs === undefined || same(claimEnvs, meta.claimEnvs), 'PAID_FILE_CLAIM_ENVS_CHANGED', 409);
  const root = id => { check(typeof id === 'string' && ORDER.test(id), 'PAID_FILE_ORDER_ID_INVALID'); return join(directory, id); };
  const source = id => join(root(id), 'merchant.handoff.json');
  const configName = id => 'paid-file-' + id.slice(5) + '.json';
  const preset = async () => readBuyerOperatorPreset(await settingsFile(), { directory });
  const claimAvailable = name => typeof environment[name] === 'string' && Buffer.byteLength(environment[name]) >= 32 &&
    Buffer.byteLength(environment[name]) <= 1024 && !/[\x00-\x20\x7f]/.test(environment[name]);
  async function lease(action) {
    // Share the original intake's lease, including original encrypted backups.
    const release = await acquireRunbookMetadataLease(dirname(directory));
    try { return await action(); } finally { await release(); }
  }
  async function record(id) {
    const value = await json(join(root(id), 'order.json')), raw = await bytes(source(id));
    const handoff = validateHandoff(parse(raw));
    check(value.schema === SCHEMA && value.id === id && value.handoffSha256 === hash(raw) && orderId(handoff) === id,
      'PAID_FILE_ORDER_CHANGED', 409);
    return { ...value, handoff };
  }
  async function reviewRecord(id, revision) {
    check(Number.isSafeInteger(revision) && revision > 0 && revision <= 10000, 'PAID_FILE_REVIEW_CHANGED', 409);
    const value = await json(join(root(id), 'reviews', 'r' + revision + '.json'));
    const { reviewSha256, reviewedAt, ...proof } = value;
    check(value.schema === SCHEMA && value.id === id && value.revision === revision && hash(encoded(proof)) === reviewSha256,
      'PAID_FILE_REVIEW_CHANGED', 409); return value;
  }
  async function latestReview(id) {
    const names = (await readdir(join(root(id), 'reviews'))).filter(name => /^r[1-9][0-9]*\.json$/.test(name));
    const revision = Math.max(0, ...names.map(name => Number(name.slice(1, -5))));
    return revision ? reviewRecord(id, revision) : null;
  }
  async function ready(id) {
    const saved = await optional(join(root(id), 'ready.json'));
    if (!saved) return null;
    const review = await reviewRecord(id, saved.reviewRevision);
    check(saved.schema === SCHEMA && saved.id === id && saved.reviewSha256 === review.reviewSha256 &&
      saved.operatorDirectory === join(root(id), 'operator') && saved.configName === configName(id) &&
      saved.configPath === join(configsDirectory, configName(id)) && /^[a-f0-9]{64}$/.test(saved.configSha256) &&
      saved.paidFile?.handoff === source(id) && saved.paidFile.handoffSha256 === review.handoffSha256 &&
      saved.paidFile.destination === join(root(id), 'downloads', review.filename) && saved.paidFile.claimEnv === review.claimEnv,
    'PAID_FILE_PREPARED_BINDING_CHANGED', 409); return saved;
  }
  async function get(id) {
    const item = await record(id), review = await latestReview(id), prepared = await ready(id);
    const preparing = await optional(join(root(id), 'preparing.json'));
    return { ...item, review: review ? publicReview(review) : null, prepared, preparing: Boolean(preparing),
      claimEnvs: meta.claimEnvs.map(name => ({ name, available: claimAvailable(name) })) };
  }
  function publicReview(review) { const { settings, ...publicFields } = review; return publicFields; }
  async function receive(input) {
    fields(input, ['filename', 'base64']);
    check(typeof input.filename === 'string' && input.filename.length > 0 && input.filename.length <= 180 &&
      !/[\x00-\x1f\x7f]/.test(input.filename), 'PAID_FILE_SOURCE_NAME_INVALID');
    check(typeof input.base64 === 'string' && input.base64.length <= 4 * Math.ceil(MAX_BYTES / 3), 'PAID_FILE_SOURCE_TOO_LARGE', 413);
    const raw = Buffer.from(input.base64, 'base64');
    check(raw.length > 0 && raw.length <= MAX_BYTES && raw.toString('base64') === input.base64, 'PAID_FILE_ENCODING_INVALID');
    const handoff = validateHandoff(parse(raw)), id = orderId(handoff), op = reviewedOperation(id, handoff);
    // The native preparePurchase query contract permits only its original order.
    check([...new URL(op.url).searchParams.keys()].every(name => name === 'sf98_order'), 'EXISTING_BUYER_QUERY_CONFLICT');
    const existing = await optional(join(root(id), 'order.json'));
    if (existing) {
      const retained = await record(id);
      check(same(retained.handoff, handoff), 'PAID_FILE_MERCHANT_ORDER_CHANGED', 409); return get(id);
    }
    await privateDirectory(root(id), true); await privateDirectory(join(root(id), 'reviews'), true);
    await privateDirectory(join(root(id), 'downloads'), true);
    await publish(source(id), raw, true);
    await publish(join(root(id), 'order.json'), { schema: SCHEMA, id, filename: basename(input.filename),
      createdAt: now(), handoffSha256: hash(raw), summary: { intentId: op.intentId, url: op.url,
        orderReference: handoff.orderReference, bytes: handoff.file.bytes, sha256: handoff.file.sha256 } });
    return get(id);
  }
  async function review(input) {
    fields(input, ['id', 'expectedRevision', 'totalAtomic', 'dailyAtomic', 'filename', 'claimEnv']);
    const item = await record(input.id), old = await latestReview(input.id), operator = await preset();
    check(!await ready(input.id) && !await optional(join(root(input.id), 'preparing.json')), 'PAID_FILE_ALREADY_PREPARING', 409);
    check(input.expectedRevision === (old?.revision ?? 0), 'PAID_FILE_REVIEW_CHANGED', 409);
    const total = amount(input.totalAtomic), daily = amount(input.dailyAtomic), op = reviewedOperation(input.id, item.handoff);
    check(BigInt(op.expect.maxAtomic) <= BigInt(daily) && BigInt(daily) <= BigInt(total) &&
      BigInt(total) <= BigInt(operator.value.maxTotalAtomic) && BigInt(daily) <= BigInt(operator.value.maxDailyAtomic),
    'REQUEST_BUDGET_OUTSIDE_OPERATOR_LIMITS');
    check(meta.claimEnvs.includes(input.claimEnv), 'PAID_FILE_CLAIM_ENV_NOT_DECLARED');
    validateNativeSignerConfiguration({ ...op.expect, expectedPayer: operator.value.payer, rpcUrl: operator.value.rpc });
    const proof = { schema: SCHEMA, id: input.id, revision: (old?.revision ?? 0) + 1,
      handoffSha256: item.handoffSha256, acceptedTerms: op.expect,
      settingsSha256: operator.sha256, settings: operator.value, operator: operator.view,
      totalAtomic: total, dailyAtomic: daily, filename: filename(input.filename), claimEnv: input.claimEnv };
    check(proof.revision <= 10000, 'PAID_FILE_REVIEW_LIMIT');
    await publish(join(root(input.id), 'reviews', 'r' + proof.revision + '.json'),
      { ...proof, reviewSha256: hash(encoded(proof)), reviewedAt: now() });
    return get(input.id);
  }
  async function verifyOperator(id, review, accounting = false) {
    const native = await openWorkspace(['--dir', join(root(id), 'operator')], { accounting });
    const item = await record(id), { op, owner } = execution(native.config), settings = review.settings;
    check(same(op, reviewedOperation(id, item.handoff)) && native.config.trustedPayer === settings.payer &&
      ['actor', 'service', 'python'].every(key => owner[key] === settings[key]), 'PAID_FILE_OPERATOR_CHANGED', 409);
    const expectedTransport = buyerTransport({ operation: op, ...(settings.httpsProxyEnv === undefined ? {} :
      { buyerTransport: { mode: 'explicit-connect', origin: new URL(op.url).origin, proxyEnv: settings.httpsProxyEnv } }) });
    check(same(buyerTransport(native.config), expectedTransport), 'PAID_FILE_TRANSPORT_CHANGED', 409);
    const pins = validateNativeSignerConfiguration({ ...op.expect, expectedPayer: settings.payer, rpcUrl: settings.rpc });
    check(native.manifest.signer.rpcUrl === pins.rpcUrl && native.manifest.signer.maxAtomic === op.expect.maxAtomic &&
      native.manifest.signer.secretEnv === (settings.signerProvider === undefined ? settings.secretEnv ?? 'STELLAR_SECRET' : undefined) &&
      native.manifest.signer.signerProvider === settings.signerProvider, 'PAID_FILE_SIGNER_CHANGED', 409);
    const policy = await json(owner.policy);
    check(policy.assets?.length === 1 && policy.assets[0].max_single === op.expect.maxAtomic &&
      policy.assets[0].max_total === review.totalAtomic && policy.assets[0].max_per_utc_day === review.dailyAtomic,
    'PAID_FILE_BUDGET_CHANGED', 409); return native;
  }
  async function provision(input) {
    fields(input, ['id', 'reviewSha256']);
    const item = await record(input.id), selected = await latestReview(input.id), existing = await ready(input.id);
    check(selected && selected.reviewSha256 === input.reviewSha256 && selected.handoffSha256 === item.handoffSha256,
      'PAID_FILE_REVIEW_CHANGED', 409);
    if (existing) {
      check(existing.reviewSha256 === input.reviewSha256, 'PAID_FILE_REVIEW_CHANGED', 409);
      const native = await verifyOperator(input.id, selected);
      check(hash(await bytes(existing.configPath, 65536)) === existing.configSha256 &&
        same(await nativeConfig(existing.configPath), native.config), 'PAID_FILE_OPERATOR_CHANGED', 409);
      return existing;
    }
    const old = await optional(join(root(input.id), 'preparing.json'));
    if (old) check(old.reviewSha256 === selected.reviewSha256, 'PAID_FILE_REVIEW_CHANGED', 409);
    else {
      check((await preset()).sha256 === selected.settingsSha256, 'REQUEST_OPERATOR_SETTINGS_CHANGED', 409);
      await publish(join(root(input.id), 'preparing.json'), { schema: SCHEMA, id: input.id,
        reviewSha256: selected.reviewSha256, startedAt: now() });
    }
    const reviewPath = join(root(input.id), 'buyer-review.json'), operatorDirectory = join(root(input.id), 'operator');
    await publish(reviewPath, { operation: reviewedOperation(input.id, item.handoff), captureBody: false });
    const settings = selected.settings;
    const args = ['--config', reviewPath, '--dir', operatorDirectory, '--actor', settings.actor,
      '--service', settings.service, '--payer', settings.payer, '--python', settings.python,
      '--total-atomic', selected.totalAtomic, '--daily-atomic', selected.dailyAtomic];
    for (const [name, flag] of [['secretEnv', '--secret-env'], ['signerProvider', '--signer-provider'],
      ['rpc', '--rpc'], ['httpsProxyEnv', '--https-proxy-env']]) if (settings[name] !== undefined) args.push(flag, settings[name]);
    // The native resume path owns every key, policy and ledger. Interrupted
    // initialization reuses those same bytes and never creates another operator.
    await initializeWorkspace(args, { environment, resume: true });
    const native = await verifyOperator(input.id, selected), target = join(configsDirectory, configName(input.id));
    const preparedPath = join(root(input.id), 'prepared-operator.json');
    if (!await optional(preparedPath)) {
      // The native writer owns preparation. Publish its complete original bytes
      // only after it closes, so an interruption can resume the same operator.
      const temporary = preparedPath + '.' + randomUUID() + '.tmp';
      try {
        await preparePurchase({ handoff: item.handoff, configuration: native.config, output: temporary });
        await publish(preparedPath, await bytes(temporary, 65536), true);
      } finally { await unlink(temporary).catch(() => {}); }
    }
    const prepared = await nativeConfig(preparedPath);
    check(same(prepared, native.config), 'PAID_FILE_OPERATOR_CHANGED', 409);
    const raw = await bytes(preparedPath, 65536);
    await publish(target, raw, true);
    const purchase = await readPurchaseInput({ handoff: source(input.id),
      destination: join(root(input.id), 'downloads', selected.filename), claimEnv: selected.claimEnv }, prepared.operation);
    const paidFile = await freezePurchase(purchase, source(input.id), { resume: true });
    const saved = { schema: SCHEMA, id: input.id, reviewSha256: selected.reviewSha256, reviewRevision: selected.revision,
      configName: configName(input.id), configPath: target, configSha256: hash(raw), operatorDirectory,
      intentId: prepared.operation.intentId, paidFile, createdAt: now() };
    await publish(join(root(input.id), 'ready.json'), saved); return saved;
  }
  function ownsOperation(row) {
    return typeof row.sourceConfig?.path === 'string' && dirname(row.sourceConfig.path) === configsDirectory &&
      CONFIG.test(basename(row.sourceConfig.path));
  }
  async function originalForOperation(row, accounting = false) {
    if (!ownsOperation(row)) return null;
    const id = 'file-' + basename(row.sourceConfig.path).slice(10, -5), saved = await ready(id);
    check(saved && saved.configPath === row.sourceConfig.path && saved.configSha256 === row.sourceConfig.sha256 &&
      hash(await bytes(saved.configPath, 65536)) === saved.configSha256, 'PAID_FILE_OPERATOR_CHANGED', 409);
    const native = await verifyOperator(id, await reviewRecord(id, saved.reviewRevision), accounting);
    check(same(await nativeConfig(saved.configPath), native.config), 'PAID_FILE_OPERATOR_CHANGED', 409);
    return { id, saved, native };
  }
  async function context(row, runDirectory) {
    const original = await originalForOperation(row);
    if (!original) return null;
    check(row.config.path === 'configs/' + row.id + '.json', 'PAID_FILE_RUNBOOK_CONFIG_CHANGED', 409);
    const raw = await bytes(join(canonical(runDirectory), row.config.path), 65536);
    check(hash(raw) === row.config.sha256, 'PAID_FILE_RUNBOOK_CONFIG_CHANGED', 409);
    const cfg = parse(raw), op = execution(cfg).op;
    check(same(op, original.native.config.operation), 'PAID_FILE_RUNBOOK_OPERATION_CHANGED', 409);
    // These are the original runbook's identifiers and dates, projected only for
    // the existing file viewer. Purchase execution remains entirely in runbook.mjs.
    const job = { id: row.id, operation: op, configSha256: row.config.sha256, state: row.state,
      evidencePath: row.result?.summary?.evidencePath ?? join(cfg.evidenceDir, hash(op.intentId) + '.json'),
      attempt: row.started ? { kind: 'EXECUTE', id: row.id, startedAt: row.started.at } : null };
    return { ...original, entry: { paidFile: original.saved.paidFile }, job };
  }
  async function view(row, runDirectory) {
    const original = await context(row, runDirectory); if (!original) return null;
    const result = await inspectCommercePurchase(original.entry, original.job);
    return { id: original.id, orderReference: result.orderReference, purchaseUrl: result.purchaseUrl,
      deliveryUrl: result.deliveryUrl, file: result.file, destination: result.destination,
      handoffSha256: result.handoffSha256, configSha256: row.config.sha256,
      delivery: result.delivery, transfer: result.transfer,
      claimEnv: original.saved.paidFile.claimEnv, claimAvailable: claimAvailable(original.saved.paidFile.claimEnv) };
  }
  async function transfer(row, runDirectory, { configSha256, handoffSha256, reset = false, signal, fetchImpl } = {}) {
    return lease(async () => {
      const original = await context(row, runDirectory);
      check(original && row.config.sha256 === configSha256 && original.saved.paidFile.handoffSha256 === handoffSha256,
        'PAID_FILE_SELECTED_REQUEST_CHANGED', 409);
      if (reset) return resetCommercePurchase(original.entry, original.job);
      return retrieveCommercePurchase(original.entry, original.job, { environment, signal, fetchImpl });
    });
  }
  async function download(row, runDirectory) {
    const original = await context(row, runDirectory);
    check(original, 'PAID_FILE_NOT_CONFIGURED', 404);
    const item = await record(original.id), destination = original.saved.paidFile.destination;
    check(await verifyExistingDeliveryFile(destination, item.handoff.file), 'PAID_FILE_NOT_RETRIEVED', 404);
    const file = await open(destination, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat(), digest = createHash('sha256'); let count = 0;
      for await (const chunk of file.createReadStream({ start: 0, autoClose: false })) { count += chunk.length; digest.update(chunk); }
      const after = await file.stat();
      check(info.isFile() && (info.mode & 0o077) === 0 && count === item.handoff.file.bytes &&
        digest.digest('hex') === item.handoff.file.sha256 &&
        ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(name => info[name] === after[name]), 'PAID_FILE_DOWNLOAD_CHANGED', 409);
      return { file, name: basename(destination), bytes: count, sha256: item.handoff.file.sha256 };
    } catch (error) { await file.close(); throw error; }
  }
  async function state() {
    const requests = [], errors = []; let operator = null, presetError = null;
    const path = await settingsFile();
    if (path) try { operator = (await preset()).view; } catch (error) { presetError = codeOf(error); }
    for (const id of (await readdir(directory)).filter(name => ORDER.test(name))) {
      try { const item = await record(id); const { handoff, ...brief } = item;
        requests.push({ ...brief, prepared: await ready(id) }); }
      catch (error) { errors.push({ id, code: codeOf(error) }); }
    }
    requests.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { requests, errors, operator, presetError, settingsFile: path, maxHandoffBytes: MAX_BYTES,
      claimEnvs: meta.claimEnvs.map(name => ({ name, available: claimAvailable(name) })) };
  }
  return { state, get, ownsOperation, view, transfer, download,
    async attachment(id) { await record(id); return { bytes: await bytes(source(id)), name: 'merchant-file.handoff.json' }; },
    async environmentForOperation(row) {
      const original = await originalForOperation(row, true);
      return original ? { ...environment, ...original.native.operatorEnvironment } : null;
    },
    async workspaceForOperation(row) { return (await originalForOperation(row))?.saved.operatorDirectory ?? null; },
    receive: input => lease(() => receive(input)), review: input => lease(() => review(input)),
    provision: input => lease(() => provision(input)) };
}
