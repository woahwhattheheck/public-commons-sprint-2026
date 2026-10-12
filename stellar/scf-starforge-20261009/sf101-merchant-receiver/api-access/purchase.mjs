// MIT — Purchased API customer workflow over original SF88 and SF101 products.
import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateHandoff } from '../checkout-config.mjs';
import { VerifiedFile } from '../../sf88-operator-buyer-cli/node/result.mjs';
import { absolute, intent, need, object, digest, now, exists, privateDirectory,
  readBytes, readJson, parseJson, jsonBytes, writeBytes, writeJson, syncDirectory,
  BuyerError, safeCode } from '../../sf88-operator-buyer-cli/node/store.mjs';

const SCHEMA = 'stellar-forge.sf101.api-purchase-customer.v1';
const client = fileURLToPath(new URL('./customer.py', import.meta.url));
const frozen = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) frozen(child);
    Object.freeze(value);
  }
  return value;
};
const canonical = value => Array.isArray(value) ? value.map(canonical) :
  value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort()
    .map(key => [key,canonical(value[key])])) : value;
const same = (left, right) => JSON.stringify(canonical(left)) === JSON.stringify(canonical(right));
function origin(value) {
  need(typeof value === 'string', 'API_GATEWAY_ORIGIN_REQUIRED');
  let url;
  try { url = new URL(value); } catch { throw new BuyerError('API_GATEWAY_ORIGIN_REQUIRED'); }
  need(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/' &&
    (url.protocol === 'https:' || url.protocol === 'http:' &&
      ['localhost','127.0.0.1','[::1]'].includes(url.hostname)), 'HTTPS_OR_LOOPBACK_GATEWAY_REQUIRED');
  return url.origin;
}
function claimName(value) {
  need(typeof value === 'string' && /^[A-Z][A-Z0-9_]{1,64}$/.test(value), 'INVALID_CLAIM_ENV');
  return value;
}
function requestId(value) {
  need(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value),
    'STABLE_REQUEST_ID_REQUIRED');
  return value;
}
function originalRequest(handoff, intentId, directory) {
  const payment = handoff.payment;
  const expect = {scheme:payment.scheme, network:payment.network, asset:payment.asset,
    payTo:payment.payTo, maxAtomic:payment.amount, maxTimeoutSeconds:payment.maxTimeoutSeconds};
  if (payment.extra?.paymentFlow !== undefined) expect.paymentFlow = payment.extra.paymentFlow;
  return {operation:{intentId:intent(intentId), url:handoff.purchaseUrl, method:'GET',
    orderReference:handoff.orderReference, expect},
    responseFile:{destination:join(directory,'purchase-response.bin'), maxBytes:16384,
      timeoutMs:30000, expectedContentType:'application/json'},
    requestTimeoutMs:180000};
}
function boundBuyer(buyer) {
  need(buyer && typeof buyer.fromWorkspace === 'function' && typeof buyer.inbox === 'function' &&
    typeof buyer.createInbox === 'function' && typeof buyer.operation === 'function',
    'ORIGINAL_BUYER_REQUIRED');
  return {buyerStateDirectory:absolute(buyer.stateDirectory),
    runtimeDirectory:absolute(buyer.runtime.directory)};
}

export class ApiAccessResult extends VerifiedFile {
  constructor(metadata) {
    super();
    need(object(metadata) && typeof metadata.orderRef === 'string' &&
      typeof metadata.requestId === 'string' && Number.isInteger(metadata.status) &&
      metadata.status >= 200 && metadata.status <= 599 &&
      Number.isSafeInteger(metadata.bytes) && metadata.bytes >= 0 &&
      metadata.bytes <= 4 * 1024 * 1024 && /^[a-f0-9]{64}$/.test(metadata.sha256) &&
      Number.isSafeInteger(metadata.units) && metadata.units > 0 &&
      typeof metadata.replayed === 'boolean', 'ORIGINAL_API_RESULT_INVALID');
    absolute(metadata.file);
    this.metadata = frozen(structuredClone(metadata));
  }
  get status() { return this.metadata.status; }
  get ok() { return this.status >= 200 && this.status < 300; }
  _metadata() {
    return {path:this.metadata.file, bytes:this.metadata.bytes, sha256:this.metadata.sha256};
  }
}

/** The original Python client owns HTTP, claim authentication and response capture. */
export class ApiAccessClient {
  constructor({baseUrl, orderReference, manifestSha256, claimEnv = 'SF101_CLAIM_TOKEN',
    python = process.env.STARFORGE_PYTHON || 'python3', environment = process.env}) {
    this.baseUrl = origin(baseUrl);
    need(typeof orderReference === 'string' && /^[A-Za-z0-9._:-]{1,80}$/.test(orderReference),
      'INVALID_ORDER_REFERENCE');
    need(typeof manifestSha256 === 'string' && /^[a-f0-9]{64}$/.test(manifestSha256),
      'ORIGINAL_MANIFEST_DIGEST_REQUIRED');
    need(typeof python === 'string' && python.length > 0 && !python.includes('\0'),
      'PYTHON_EXECUTABLE_REQUIRED');
    need(object(environment), 'CLIENT_ENVIRONMENT_REQUIRED');
    this.orderReference = orderReference;
    this.manifestSha256 = manifestSha256;
    this.claimEnv = claimName(claimEnv);
    this.python = python;
    Object.defineProperty(this, 'environment', {value:environment});
    Object.freeze(this);
  }
  async _command(action, args = [], {signal} = {}) {
    need(signal === undefined || signal instanceof AbortSignal, 'INVALID_ABORT_SIGNAL');
    need(!signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
    const supplied = this.environment[this.claimEnv];
    need(typeof supplied === 'string' && Buffer.byteLength(supplied) >= 32 &&
      Buffer.byteLength(supplied) <= 1024 && /^[\x20-\x7e]+$/.test(supplied), 'CLAIM_TOKEN_UNAVAILABLE');
    const environment = {};
    for (const key of ['PATH','LANG','LC_ALL','SYSTEMROOT','SSL_CERT_FILE','SSL_CERT_DIR'])
      if (this.environment[key] !== undefined) environment[key] = this.environment[key];
    environment[this.claimEnv] = supplied;
    return new Promise((resolve, reject) => {
      const child = spawn(this.python, [client, action, '--base-url',this.baseUrl,
        '--order='+this.orderReference,'--claim-env',this.claimEnv,...args],
      {env:environment, stdio:['ignore','pipe','pipe'], shell:false, windowsHide:true});
      const output = [], errors = [];
      let size = 0, errorSize = 0, interrupted = null, settled = false, forceTimer;
      const stop = code => {
        interrupted ??= code;
        child.kill('SIGTERM');
        forceTimer ??= setTimeout(() => child.kill('SIGKILL'), 5000);
        forceTimer.unref?.();
      };
      const abort = () => stop('API_REQUEST_INTERRUPTED_RECOVER_SAME_REQUEST_ID');
      const timer = setTimeout(() => stop('API_REQUEST_TIMEOUT_RECOVER_SAME_REQUEST_ID'), 180000);
      const cleanup = () => {
        clearTimeout(timer); clearTimeout(forceTimer); signal?.removeEventListener('abort', abort);
      };
      signal?.addEventListener('abort', abort, {once:true});
      if (signal?.aborted) abort();
      child.stdout.on('data', part => {
        size += part.length;
        if (size > 4 * 1024 * 1024) stop('API_CLIENT_OUTPUT_LIMIT');
        else output.push(part);
      });
      child.stderr.on('data', part => {
        errorSize += part.length;
        if (errorSize <= 32768) errors.push(part);
      });
      child.once('error', () => {
        if (settled) return; settled = true; cleanup();
        reject(new BuyerError('API_PASS_PYTHON_UNAVAILABLE'));
      });
      child.once('close', code => {
        if (settled) return; settled = true; cleanup();
        try {
          if (interrupted) throw new BuyerError(interrupted);
          if (code !== 0) {
            let value;
            try { value = JSON.parse(Buffer.concat(errors).toString('utf8')); } catch { value = null; }
            throw new BuyerError(safeCode(value?.error, 'API_CLIENT_COMMAND_FAILED'));
          }
          const value = parseJson(Buffer.concat(output));
          need(object(value), 'API_CLIENT_RESULT_INVALID');
          resolve(value);
        } catch (error) { reject(error); }
      });
    });
  }
  async inspect(options) {
    const value = await this._command('inspect', [], options);
    need(value.schema === 'stellar-forge.sf101.api-pass-detail.v1' &&
      value.orderRef === this.orderReference && value.manifestSha256 === this.manifestSha256,
      'PURCHASED_PLAN_BINDING_MISMATCH');
    return frozen(value);
  }
  async calls({after, limit = 100, signal} = {}) {
    need(Number.isInteger(limit) && limit >= 1 && limit <= 500, 'INVALID_PAGE_LIMIT');
    if (after !== undefined) requestId(after);
    await this.inspect({signal});
    return this._command('calls', ['--limit',String(limit),...(after === undefined ? [] : ['--after',after])], {signal});
  }
  async call({route, requestId: selected, method = 'GET', query = [], bodyFile,
    contentType = 'application/octet-stream', output, signal}) {
    requestId(selected);
    need(typeof route === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(route), 'ROUTE_REQUIRED');
    need(['GET','HEAD','POST','PUT','PATCH','DELETE'].includes(method), 'INVALID_API_METHOD');
    need(Array.isArray(query) && query.every(pair => Array.isArray(pair) && pair.length === 2 &&
      pair.every(value => typeof value === 'string')), 'QUERY_PAIRS_REQUIRED');
    need(typeof contentType === 'string' && contentType.length > 0 &&
      contentType.length <= 255 && /^[\x20-\x7e]+$/.test(contentType), 'INVALID_CONTENT_TYPE');
    const args = ['--route='+route,'--request-id',selected,'--method',method,
      '--content-type='+contentType,'--out',absolute(output)];
    if (bodyFile !== undefined) args.push('--body',absolute(bodyFile));
    if (query.length) args.push('--query-json='+JSON.stringify(query));
    await this.inspect({signal});
    return this._result(await this._command('call', args, {signal}), selected, output);
  }
  async recover(request, {output, signal}) {
    requestId(request);
    await this.inspect({signal});
    return this._result(await this._command('recover',
      ['--request-id',request,'--out',absolute(output)], {signal}), request, output);
  }
  async _result(value, selected, output) {
    need(value.orderRef === this.orderReference && value.requestId === selected &&
      absolute(value.file) === absolute(output), 'ORIGINAL_API_RESULT_BINDING_MISMATCH');
    const result = new ApiAccessResult(value);
    await result.verify();
    return result;
  }
}

/** Immutable product binding. Native attempts, signer policy and money stay in the original inbox. */
export class ApiAccessPurchase {
  constructor(directory, buyer, metadata, metadataSha256, handoff, options = {}) {
    this.directory = directory;
    this.buyer = buyer;
    this.metadata = frozen(metadata);
    this.metadataSha256 = metadataSha256;
    this.handoff = frozen(handoff);
    this.api = new ApiAccessClient({baseUrl:metadata.gatewayBaseUrl,
      orderReference:metadata.orderReference, manifestSha256:handoff.file.sha256,
      claimEnv:metadata.claimEnv, ...options});
    this.inbox = buyer.inbox(metadata.inboxDirectory);
  }
  get intentId() { return this.metadata.intentId; }
  get orderReference() { return this.metadata.orderReference; }
  async _bound() {
    await privateDirectory(this.directory, {create:false});
    const raw = await readBytes(join(this.directory,'customer.json'));
    need(digest(raw) === this.metadataSha256, 'API_PURCHASE_BINDING_CHANGED');
    const input = await readBytes(join(this.directory,'purchase.json'));
    const handoff = await readBytes(join(this.directory,'handoff.json'));
    need(digest(input) === this.metadata.configurationSha256 &&
      digest(handoff) === this.metadata.handoffSha256, 'API_PURCHASE_INPUT_CHANGED');
    const selected = boundBuyer(this.buyer);
    need(selected.buyerStateDirectory === this.metadata.buyerStateDirectory &&
      selected.runtimeDirectory === this.metadata.runtimeDirectory, 'ORIGINAL_BUYER_BINDING_MISMATCH');
    return parseJson(input);
  }
  async initialize({signal} = {}) {
    const expected = await this._bound();
    let operation = this.buyer.operation(this.intentId);
    if (!await exists(operation.directory))
      operation = await this.buyer.fromWorkspace(this.metadata.workspaceDirectory,
        {configuration:join(this.directory,'purchase.json'), responseFile:{maxBytes:16384},
          requestTimeoutMs:180000, signal});
    const bound = await operation._bound();
    need(bound.meta.nativeWorkspace === this.metadata.workspaceDirectory &&
      same(bound.config.operation, expected.operation), 'ORIGINAL_PURCHASE_OPERATION_MISMATCH');
    if (!await exists(join(this.metadata.inboxDirectory,'inbox.json')))
      this.inbox = await this.buyer.createInbox({directory:this.metadata.inboxDirectory, signal});
    return this.inbox.enqueue(operation, {signal});
  }
  async review(options) {
    await this.initialize(options);
    return this.inbox.review(this.intentId, options);
  }
  async execute({review, signal} = {}) {
    await this._bound();
    return this.inbox.execute(this.intentId,
      {review, workspaceDirectory:this.metadata.workspaceDirectory, signal});
  }
  async inspect(options) { await this._bound(); return this.inbox.show(this.intentId, options); }
  async recover(options) { await this._bound(); return this.inbox.recover(this.intentId, options); }
  async response(options) { await this._bound(); return this.inbox.response(this.intentId, options); }
  async finalize({outboxDirectory, signal} = {}) {
    await this._bound();
    return this.inbox.finalize(this.intentId, {workspaceDirectory:this.metadata.workspaceDirectory,
      ...(outboxDirectory === undefined ? {} : {outboxDirectory:absolute(outboxDirectory),
        merchantRoute:this.handoff.routeId}), signal});
  }
  async exportReport(destination, {signal} = {}) {
    await this._bound();
    return this.inbox.exportReport(destination,
      {workspaceDirectory:this.metadata.workspaceDirectory, signal});
  }
}

async function exactInput(path, bytes) {
  if (await exists(path)) {
    need(digest(await readBytes(path)) === digest(bytes), 'API_PURCHASE_PREPARATION_INPUT_CHANGED');
    return;
  }
  try { await writeBytes(path, bytes, {exclusive:true}); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    need(digest(await readBytes(path)) === digest(bytes), 'API_PURCHASE_PREPARATION_INPUT_CHANGED');
  }
}
const preparation = value => {
  const {createdAt,...binding} = value;
  return binding;
};

export async function createApiAccessPurchase({directory, buyer, workspaceDirectory,
  inboxDirectory, handoffFile, intentId, gatewayBaseUrl, claimEnv = 'SF101_CLAIM_TOKEN',
  python, environment, signal}) {
  const binding = boundBuyer(buyer);
  directory = absolute(directory);
  workspaceDirectory = absolute(workspaceDirectory);
  inboxDirectory = absolute(inboxDirectory);
  intentId = intent(intentId);
  const raw = await readBytes(absolute(handoffFile));
  const handoff = validateHandoff(parseJson(raw));
  const configuration = originalRequest(handoff, intentId, directory);
  const configurationBytes = jsonBytes(configuration);
  const proposed = {schema:SCHEMA, createdAt:now(), intentId,
    orderReference:handoff.orderReference, gatewayBaseUrl:origin(gatewayBaseUrl),
    claimEnv:claimName(claimEnv), workspaceDirectory, inboxDirectory, ...binding,
    handoffSha256:digest(raw), configurationSha256:digest(configurationBytes)};
  need(!signal?.aborted, 'OPERATION_ABORTED_BEFORE_START');
  try {
    await mkdir(directory, {mode:0o700});
    await syncDirectory(dirname(directory));
  } catch (error) { if (error.code !== 'EEXIST') throw error; }
  await privateDirectory(directory, {create:false});
  const creationPath = join(directory,'creation.json'), manifestPath = join(directory,'customer.json');
  let metadata = proposed;
  if (!await exists(creationPath)) {
    if (await exists(manifestPath)) {
      const published = await readJson(manifestPath);
      need(same(preparation(published), preparation(proposed)), 'API_PURCHASE_PREPARATION_INPUT_CHANGED');
      metadata = published;
    } else {
      const known = new Set(['handoff.json','purchase.json','customer.json','creation.json']);
      need((await readdir(directory)).every(name => known.has(name) ||
        /^\.write-[a-f0-9-]{36}$/.test(name)), 'API_PURCHASE_PREPARATION_DIRECTORY_IN_USE');
    }
    try { await writeJson(creationPath, metadata, {exclusive:true}); }
    catch (error) { if (error.code !== 'EEXIST') throw error; }
  }
  metadata = await readJson(creationPath);
  need(typeof metadata.createdAt === 'string' && Number.isFinite(Date.parse(metadata.createdAt)) &&
    same(preparation(metadata), preparation(proposed)), 'API_PURCHASE_PREPARATION_INPUT_CHANGED');
  // The creation binding is published first. Repeating the same preparation can
  // finish a missing prefix after storage interruption without changing inputs.
  await exactInput(join(directory,'handoff.json'), raw);
  await exactInput(join(directory,'purchase.json'), configurationBytes);
  await exactInput(manifestPath, jsonBytes(metadata));
  const purchase = await openApiAccessPurchase({directory, buyer, python, environment});
  await purchase.initialize({signal});
  return purchase;
}

export async function openApiAccessPurchase({directory, buyer, python, environment}) {
  directory = await privateDirectory(absolute(directory), {create:false});
  const raw = await readBytes(join(directory,'customer.json'));
  const metadata = parseJson(raw), binding = boundBuyer(buyer);
  need(metadata.schema === SCHEMA && metadata.buyerStateDirectory === binding.buyerStateDirectory &&
    metadata.runtimeDirectory === binding.runtimeDirectory &&
    metadata.intentId === intent(metadata.intentId) &&
    metadata.workspaceDirectory === absolute(metadata.workspaceDirectory) &&
    metadata.inboxDirectory === absolute(metadata.inboxDirectory), 'API_PURCHASE_MANIFEST_INVALID');
  const handoff = validateHandoff(await readJson(join(directory,'handoff.json')));
  need(handoff.orderReference === metadata.orderReference, 'API_PURCHASE_HANDOFF_MISMATCH');
  const options = {...(python === undefined ? {} : {python}),
    ...(environment === undefined ? {} : {environment})};
  const purchase = new ApiAccessPurchase(directory, buyer, metadata, digest(raw), handoff, options);
  const expected = originalRequest(handoff, metadata.intentId, directory);
  need(same(await purchase._bound(), expected), 'API_PURCHASE_CONFIGURATION_MISMATCH');
  return purchase;
}
