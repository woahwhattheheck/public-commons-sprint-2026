/** MIT. Receive the original completed SCF demonstration through its native buyer. */
import {constants} from 'node:fs';
import {open, mkdir, lstat, realpath, readdir, link, rename, unlink} from 'node:fs/promises';
import {resolve, dirname, join, isAbsolute} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {createHash, randomBytes, randomUUID} from 'node:crypto';
import {isDeepStrictEqual as same} from 'node:util';

export const PACKET_SCHEMA = 'stellar-forge.grant-reviewer-packet.v1';
export const WORKSPACE_SCHEMA = 'stellar-forge.grant-reviewer-workspace.v1';
export const MAX_PACKET_BYTES = 8 * 1024 * 1024;
const bundledPacket = fileURLToPath(new URL('./hpd-purchase.json', import.meta.url));
const defaultSource = fileURLToPath(new URL('../../../../', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code, message = code) => { throw Object.assign(new Error(message), {code}); };
const need = (value, code, message) => { if (!value) fail(code, message); };
const owned = stat => (stat.mode & 0o077) === 0 &&
  (typeof process.getuid !== 'function' || stat.uid === process.getuid());
const stamp = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs].join(':');
const json = bytes => {
  try { return JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes)); }
  catch { fail('REVIEWER_JSON_INVALID'); }
};
const encoded = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');

export function packetIdentity(packet) {
  const value = {...packet}; delete value.packetId;
  return sha(JSON.stringify(value));
}

export async function readSourceFile(path, {privateFile = false, maxBytes = MAX_PACKET_BYTES} = {}) {
  need(typeof path === 'string' && isAbsolute(path), 'REVIEWER_ABSOLUTE_PATH_REQUIRED');
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await file.stat();
    need(before.isFile() && before.size <= maxBytes && (!privateFile || owned(before)),
      'REVIEWER_FILE_INVALID');
    const bytes = await file.readFile();
    need(bytes.length === before.size && stamp(await file.stat()) === stamp(before), 'REVIEWER_FILE_CHANGED');
    return bytes;
  } finally { await file.close(); }
}

async function privateDirectory(path, create = false) {
  if (create) try { await mkdir(path, {mode:0o700}); }
  catch (error) { if (error.code !== 'EEXIST') throw error; }
  const stat = await lstat(path);
  need(stat.isDirectory() && !stat.isSymbolicLink() && owned(stat), 'REVIEWER_PRIVATE_DIRECTORY_REQUIRED');
  need(await realpath(path) === resolve(path), 'REVIEWER_DIRECTORY_ALIAS');
  return path;
}

async function syncDirectory(path) {
  const file = await open(path, constants.O_RDONLY);
  try { await file.sync(); } finally { await file.close(); }
}

/** Create-only payload publication; only this call's temporary file is removed. */
export async function writeSourceFile(path, bytes, {replace = false} = {}) {
  await privateDirectory(dirname(path));
  if (replace) try { await readSourceFile(path, {privateFile:true}); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const temporary = join(dirname(path), '.reviewer-' + randomUUID() + '.partial');
  let file;
  try {
    file = await open(temporary, 'wx', 0o600);
    await file.writeFile(bytes); await file.sync(); await file.close(); file = undefined;
    if (replace) await rename(temporary, path);
    else await link(temporary, path);
    await syncDirectory(dirname(path));
  } finally {
    await file?.close();
    try { await unlink(temporary); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return {path, bytes:bytes.length, sha256:sha(bytes)};
}

export async function nativeModules(sourceRoot = defaultSource) {
  need(typeof sourceRoot === 'string' && isAbsolute(sourceRoot), 'REVIEWER_SOURCE_ROOT_REQUIRED');
  const root = await realpath(sourceRoot);
  const from = name => import(pathToFileURL(join(root, 'stellar-forge/mcp-paid-agent', name)).href);
  const [quotes, results, server, protocol] = await Promise.all([
    from('quote-store.mjs'), from('result-store.mjs'), from('serve.mjs'), from('remote-mcp.mjs')
  ]);
  return {...quotes, ...results, ...server, ...protocol, sourceRoot:root};
}

export async function validatePacket(packet, native) {
  need(plain(packet) && packet.schema === PACKET_SCHEMA && /^[a-f0-9]{64}$/.test(packet.packetId ?? '') &&
    packetIdentity(packet) === packet.packetId, 'REVIEWER_PACKET_IDENTITY');
  need(plain(packet.source) && typeof packet.source.operationId === 'string' &&
    typeof packet.source.discoveryUrl === 'string' && typeof packet.primaryQuoteId === 'string',
    'REVIEWER_SOURCE_INVALID');
  const discovery = new URL(packet.source.discoveryUrl);
  need(['https:', 'http:'].includes(discovery.protocol) && !discovery.username && !discovery.password,
    'REVIEWER_DISCOVERY_INVALID');
  need(Array.isArray(packet.documents) && packet.documents.length > 0 && packet.documents.length <= 128 &&
    Array.isArray(packet.quotes) && packet.quotes.length > 0 && packet.quotes.length <= 20,
    'REVIEWER_PACKET_LIMIT');
  const files = new Map(); let total = 0;
  for (const entry of packet.documents) {
    need(plain(entry) && typeof entry.path === 'string' && entry.path.length <= 180 &&
      entry.path.split('/').every(part => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part)) &&
      !files.has(entry.path) && entry.encoding === 'base64' && typeof entry.data === 'string' &&
      Number.isSafeInteger(entry.bytes) && entry.bytes >= 0 && entry.bytes <= 2 * 1024 * 1024 &&
      /^[a-f0-9]{64}$/.test(entry.sha256 ?? '') && entry.contentType === 'application/json',
      'REVIEWER_DOCUMENT_INVALID');
    const bytes = Buffer.from(entry.data, 'base64');
    need(bytes.toString('base64') === entry.data && bytes.length === entry.bytes && sha(bytes) === entry.sha256,
      'REVIEWER_DOCUMENT_CHANGED');
    total += bytes.length; need(total <= MAX_PACKET_BYTES, 'REVIEWER_PACKET_LIMIT');
    files.set(entry.path, {entry, bytes, value:json(bytes)});
  }
  const ids = new Set();
  for (const item of packet.quotes) {
    const quote = item?.snapshot, file = files.get(item?.resultFile);
    need(plain(quote) && /^[a-f0-9-]{36}$/.test(quote.quoteId ?? '') && !ids.has(quote.quoteId) &&
      ['CONFIRMED_BY_SERVER', 'INDETERMINATE', 'FREE_SUCCESS', 'PROBE_REJECTED'].includes(quote.status) &&
      quote.phase === 'RESULT' && quote.method === 'tools/call' && quote.result?.protocol === 'mcp' &&
      quote.result.responseFile === undefined && Number.isSafeInteger(quote.attempts) &&
      quote.attempts >= 0 && quote.attempts <= 1 && file, 'REVIEWER_CLOSED_QUOTE_REQUIRED');
    native.validateMcpInvocation(quote.invocation);
    need(quote.url === quote.invocation.endpoint, 'REVIEWER_QUOTE_ENDPOINT_CHANGED');
    await native.validateMcpResult(file.value);
    const preview = native.mcpResultContent(file.value), original = quote.result.content;
    need(original?.omitted === true && original.bodyBytes === Buffer.byteLength(preview.body) &&
      original.bodySha256 === sha(preview.body) && original.truncated === preview.truncated &&
      native.serializeMcpResult(file.value).equals(file.bytes), 'REVIEWER_RESULT_CHANGED');
    ids.add(quote.quoteId);
  }
  need(ids.has(packet.primaryQuoteId) && files.has('source/mysql-source.json') &&
    files.has('source/customer-mcp.json') && files.has('source/quote-history.json') &&
    files.has('source/native-payment-inspection.json'), 'REVIEWER_SOURCE_INCOMPLETE');
  const inspection = files.get('source/native-payment-inspection.json').value;
  need(inspection.status === 'COMPLETED' && inspection.originalOperation === packet.source.operationId &&
    inspection.quoteCount === packet.quotes.length, 'REVIEWER_OBSERVATION_SOURCE_CHANGED');
  for (const {snapshot} of packet.quotes) {
    const original = inspection.observations.find(row => row.quoteId === snapshot.quoteId);
    need(original && original.originalStatus === snapshot.status && original.attempts === snapshot.attempts &&
      same(original.report, snapshot.result.reconciliation), 'REVIEWER_OBSERVATION_CHANGED');
  }
  return files;
}

async function input({packetFile, expectedSha256, sourceRoot} = {}, {requireDigest = false, privateFile = false} = {}) {
  if (requireDigest && packetFile) need(/^[a-f0-9]{64}$/.test(expectedSha256 ?? ''),
    'REVIEWER_PACKET_DIGEST_REQUIRED', 'Use the exact SHA-256 returned by inspect or export for a selected packet.');
  const path = packetFile ? resolve(packetFile) : bundledPacket;
  const bytes = await readSourceFile(path, {privateFile});
  const digest = sha(bytes);
  if (expectedSha256 !== undefined) need(digest === expectedSha256, 'REVIEWER_PACKET_CHANGED');
  const packet = json(bytes), native = await nativeModules(sourceRoot);
  const files = await validatePacket(packet, native);
  return {packet, bytes, sha256:digest, files, native};
}

function describe(value) {
  const {packet, files} = value;
  return {schema:PACKET_SCHEMA, packetId:packet.packetId, sha256:value.sha256, bytes:value.bytes.length,
    operationId:packet.source.operationId, primaryQuoteId:packet.primaryQuoteId,
    source:structuredClone(packet.source), documents:packet.documents.map(({data, encoding, ...rest}) => rest),
    query:files.get('source/mysql-source.json').value.queries,
    quotes:packet.quotes.map(({snapshot, resultFile}) => ({quoteId:snapshot.quoteId,
      invocation:snapshot.invocation, accepted:snapshot.accepted, status:snapshot.status,
      attempts:snapshot.attempts, observation:snapshot.result.reconciliation,
      result:{path:resultFile, bytes:files.get(resultFile).entry.bytes, sha256:files.get(resultFile).entry.sha256}}))};
}

export async function inspectGrantDemo(options = {}) { return describe(await input(options)); }

async function retainDocuments(root, value) {
  const retained = await privateDirectory(join(root, 'retained'), true);
  for (const {entry, bytes} of value.files.values()) {
    const parts = entry.path.split('/'); let parent = retained;
    for (const part of parts.slice(0, -1)) parent = await privateDirectory(join(parent, part), true);
    const destination = join(parent, parts.at(-1));
    try { await writeSourceFile(destination, bytes); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      need(sha(await readSourceFile(destination, {privateFile:true})) === entry.sha256,
        'REVIEWER_RETAINED_DOCUMENT_CHANGED');
    }
  }
}

function comparable(quote, native) {
  const value = native.quoteSnapshot(quote);
  delete value.updatedAt; delete value.result.responseFile;
  return value;
}

async function nativeState(root, value, {write = false, restore = false} = {}) {
  const {native, packet, files} = value;
  let quoteStore, resultStore;
  try {
    quoteStore = new native.SqliteQuoteStore({directory:join(root, 'buyer'), readOnly:!write});
    if (write) await privateDirectory(join(root, 'buyer/results'), true);
    resultStore = new native.McpResultStore({directory:join(root, 'buyer/results'), readOnly:!write});
    let current = quoteStore.load();
    need(current.every(row => packet.quotes.some(item => item.snapshot.quoteId === row.quoteId)),
      'REVIEWER_ADDITIONAL_QUOTES', 'Use the original customer backup for other work; this packet owns only its retained demonstration quotes.');
    for (const item of packet.quotes) {
      const expected = item.snapshot, bytes = files.get(item.resultFile).bytes;
      let quote = current.find(row => row.quoteId === expected.quoteId);
      if (!quote && restore) { quoteStore.save(expected); quote = quoteStore.load().find(row => row.quoteId === expected.quoteId); }
      need(quote && same(comparable(quote, native), comparable(expected, native)), 'REVIEWER_NATIVE_QUOTE_CHANGED');
      if (restore && quote.result.responseFile?.status !== 'SAVED') {
        const destination = join(root, 'buyer/results', quote.quoteId + '.json');
        let exists = true;
        try { await lstat(destination); } catch (error) { if (error.code === 'ENOENT') exists = false; else throw error; }
        if (exists) await native.recoverRetainedMcpResult({quoteStore, resultStore, quoteId:quote.quoteId});
        else await native.importRetainedMcpResult({quoteStore, resultStore, quoteId:quote.quoteId, bytes});
        quote = quoteStore.load().find(row => row.quoteId === expected.quoteId);
      }
      need(same(comparable(quote, native), comparable(expected, native)), 'REVIEWER_NATIVE_QUOTE_CHANGED');
      const file = resultStore.file(quote), actual = await file.bytes({limit:2 * 1024 * 1024});
      need(actual.equals(bytes), 'REVIEWER_NATIVE_RESULT_CHANGED');
    }
    current = quoteStore.load();
    return {quotes:current.map(quote => ({quoteId:quote.quoteId, status:quote.status, attempts:quote.attempts,
      signedRequestDispatched:quote.signedRequestDispatched, observation:quote.result.reconciliation.outcome,
      result:{bytes:quote.result.responseFile.bytes, sha256:quote.result.responseFile.sha256},
      checkpoints:quoteStore.transitions(quote.quoteId, 1000)}))};
  } finally { try { await resultStore?.close(); } finally { quoteStore?.close(); } }
}

async function retainedInput(directory, sourceRoot) {
  need(typeof directory === 'string' && isAbsolute(directory), 'REVIEWER_ABSOLUTE_PATH_REQUIRED');
  const root = await privateDirectory(resolve(directory));
  const value = await input({packetFile:join(root, 'packet.json'), sourceRoot}, {privateFile:true});
  for (const {entry} of value.files.values()) need(sha(await readSourceFile(join(root, 'retained', entry.path),
    {privateFile:true})) === entry.sha256, 'REVIEWER_RETAINED_DOCUMENT_CHANGED');
  return {root, value};
}

async function initialPacketDestination(root, expected) {
  for (const name of await readdir(root)) {
    need(/^\.reviewer-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\.partial$/.test(name),
      'REVIEWER_DESTINATION_NOT_EMPTY');
    const partial = await readSourceFile(join(root, name), {privateFile:true, maxBytes:expected.length});
    need(partial.equals(expected.subarray(0, partial.length)), 'REVIEWER_DIFFERENT_PARTIAL_PACKET');
  }
}

export async function receiveGrantDemo({directory, packetFile, expectedSha256, sourceRoot} = {}) {
  const value = await input({packetFile, expectedSha256, sourceRoot}, {requireDigest:true});
  need(typeof directory === 'string' && isAbsolute(directory), 'REVIEWER_ABSOLUTE_PATH_REQUIRED');
  const root = await privateDirectory(resolve(directory), true), packetPath = join(root, 'packet.json');
  let reused = false;
  try {
    const existing = await readSourceFile(packetPath, {privateFile:true});
    need(existing.equals(value.bytes), 'REVIEWER_DIFFERENT_PACKET'); reused = true;
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await initialPacketDestination(root, value.bytes);
    await writeSourceFile(packetPath, value.bytes);
  }
  await retainDocuments(root, value);
  const state = await nativeState(root, value, {write:true, restore:true});
  let receipt = {schema:WORKSPACE_SCHEMA, state:'READY', packetId:value.packet.packetId,
    packetSha256:value.sha256, operationId:value.packet.source.operationId,
    primaryQuoteId:value.packet.primaryQuoteId, receivedAt:new Date().toISOString(),
    originalQuoteIds:state.quotes.map(row => row.quoteId), newPayments:0};
  try { await writeSourceFile(join(root, 'received.json'), encoded(receipt)); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const existing = json(await readSourceFile(join(root, 'received.json'), {privateFile:true}));
    need(existing.schema === WORKSPACE_SCHEMA && existing.packetId === receipt.packetId &&
      existing.packetSha256 === receipt.packetSha256 && existing.state === 'READY', 'REVIEWER_RECEIPT_CHANGED');
    receipt = existing;
  }
  await writeSourceFile(join(root, 'review.html'), Buffer.from(renderReview(value)), {replace:true});
  return {...receipt, directory:root, reused, quotes:state.quotes};
}

export async function inspectGrantDemoWorkspace({directory, sourceRoot} = {}) {
  const {root, value} = await retainedInput(directory, sourceRoot);
  const receipt = json(await readSourceFile(join(root, 'received.json'), {privateFile:true}));
  need(receipt.schema === WORKSPACE_SCHEMA && receipt.state === 'READY' &&
    receipt.packetId === value.packet.packetId && receipt.packetSha256 === value.sha256, 'REVIEWER_RECEIPT_CHANGED');
  return {...describe(value), directory:root, receivedAt:receipt.receivedAt, ...await nativeState(root, value)};
}

/** Export the complete public receiving packet and current native import history. */
export async function exportGrantDemo({directory, output, sourceRoot, requestId, exportedAt: selectedAt} = {}) {
  need(typeof output === 'string' && isAbsolute(output), 'REVIEWER_ABSOLUTE_PATH_REQUIRED');
  const {root, value} = await retainedInput(directory, sourceRoot);
  // The original writer lease establishes a closed, coherent receiving view.
  // Its data and complete result files remain owned by the existing native stores.
  const state = await nativeState(root, value, {write:true});
  need((requestId === undefined) === (selectedAt === undefined), 'REVIEWER_EXPORT_IDENTITY_REQUIRED');
  if (requestId !== undefined) need(/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(requestId) &&
    typeof selectedAt === 'string' && Number.isFinite(Date.parse(selectedAt)) &&
    new Date(selectedAt).toISOString() === selectedAt, 'REVIEWER_EXPORT_IDENTITY_INVALID');
  const packet = structuredClone(value.packet), exportedAt = selectedAt ?? new Date().toISOString();
  const history = encoded({schema:'stellar-forge.grant-reviewer-native-history.v1', exportedAt,
    receivedPacketId:packet.packetId, sourceOperationId:packet.source.operationId, quotes:state.quotes});
  const path = 'receiving/history-' + (requestId ?? randomUUID()) + '.json';
  packet.documents.push({path, contentType:'application/json', bytes:history.length,
    sha256:sha(history), encoding:'base64', data:history.toString('base64')});
  packet.receivingHistory = [...(packet.receivingHistory ?? []), path];
  packet.packetId = packetIdentity(packet);
  await validatePacket(packet, value.native);
  const bytes = encoded(packet);
  need(bytes.length <= MAX_PACKET_BYTES, 'REVIEWER_PACKET_LIMIT');
  let saved, reused = false;
  try { saved = await writeSourceFile(resolve(output), bytes); }
  catch (error) {
    if (error.code !== 'EEXIST' || requestId === undefined) throw error;
    const existing = await readSourceFile(resolve(output), {privateFile:true});
    need(existing.equals(bytes), 'REVIEWER_EXPORT_OUTPUT_CHANGED');
    saved = {path:resolve(output), bytes:bytes.length, sha256:sha(bytes)}; reused = true;
  }
  return {schema:PACKET_SCHEMA, packetId:packet.packetId, sourcePacketId:value.packet.packetId,
    exportedAt, ...saved, quotes:state.quotes, ...(requestId !== undefined ? {requestId, reused} : {})};
}

const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
function renderReview(value, consoleUrl) {
  const {packet, files} = value;
  const queries = files.get('source/mysql-source.json').value.queries;
  const rows = packet.quotes.map(({snapshot:q, resultFile}) => `<tr><td>${escape(q.quoteId)}</td><td>${escape(q.status)}</td><td>${escape(q.result.reconciliation.outcome)}</td><td>${q.attempts}</td><td><a href="retained/${escape(resultFile)}">${files.get(resultFile).entry.bytes.toLocaleString('en-US')} bytes</a></td></tr>`).join('');
  const documents = packet.documents.map(entry => `<li><a href="retained/${escape(entry.path)}">${escape(entry.path)}</a> · ${entry.bytes.toLocaleString('en-US')} bytes</li>`).join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Stellar Forge · Original purchase review</title><style>body{font:16px/1.55 system-ui,sans-serif;color:#202124;background:#fafafa;margin:32px auto;padding:0 24px;max-width:1080px}h1,h2{line-height:1.2}a{color:#202124;text-underline-offset:3px}table{border-collapse:collapse;width:100%;font-size:14px}th,td{text-align:left;vertical-align:top;border:1px solid #c7c7c7;padding:10px;overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:white;border:1px solid #c7c7c7;padding:16px}section{margin:32px 0}.scroll{overflow-x:auto}code{font-family:ui-monospace,monospace}</style><body><header><p>SCF #46 · Received demonstration</p><h1>The original MySQL purchase</h1><p>Open the maintained Buyer console to inspect the saved terms, payment observation and complete result. This package reopens the two recorded operations; it creates no payment and connects no signer.</p>${consoleUrl ? `<p><strong><a href="${escape(consoleUrl)}">Open the Buyer console</a></strong> · use the access code in the terminal or private connection.json.</p>` : '<p>Start the console with <code>starforge grant-demo open --dir YOUR_RECEIVING_DIRECTORY</code>.</p>'}</header><section><h2>Review the recorded purchase</h2><ol><li>Connect in the original console, then choose <strong>Quote history</strong>.</li><li>Open quote <code>${escape(packet.primaryQuoteId)}</code>. Inspect <strong>Complete invocation and arguments</strong> and <strong>Stellar transaction observation</strong>.</li><li>Choose <strong>Read complete saved result</strong>. The Structured data tab contains 100 rows and 14 columns. Complete JSON and Download complete JSON preserve all 53,468 bytes.</li><li>Inspect the earlier indeterminate quote separately. Its retained transaction observation is FAILED; its seller status remains unchanged.</li><li>Stop the console, export this receiving packet, receive the export into another private directory, and open that directory with the same command.</li></ol><div class="scroll"><table><thead><tr><th>Original quote</th><th>Seller status</th><th>Retained observation</th><th>Attempts</th><th>Complete result</th></tr></thead><tbody>${rows}</tbody></table></div></section><section><h2>Source and query</h2><p>${escape(packet.source.description)}</p><p>These NYC HPD records describe building-in-project events. They do not measure current vacancies or distinct buildings. The saved query used Preservation and minimumUnits “20”, with a 100-row cap; the result’s truncated flag remains true. Source vintage: ${escape(packet.source.dataAsOf)}.</p><pre>${escape(JSON.stringify(queries, null, 2))}</pre><p>The original loopback merchant endpoints are historical source identity. This receiving workflow does not restart that merchant or refresh its data.</p></section><section><h2>Original files and export history</h2><p>Original source checkpoints are retained in source/quote-history.json. The native receiving store records its own local import checkpoints. Each exported receiving history below identifies that distinct stage.</p><ul>${documents}</ul><p><a href="packet.json">Complete portable packet</a> · <a href="${escape(packet.source.filmUrl)}">Original 3:32 presentation</a></p><pre>starforge grant-demo inspect-workspace --dir YOUR_RECEIVING_DIRECTORY\nstarforge grant-demo export --dir YOUR_RECEIVING_DIRECTORY --out /private/reviewer/received-purchase.json\nstarforge grant-demo receive --dir /private/reviewer/reopened --packet /private/reviewer/received-purchase.json --sha256 EXPORTED_SHA256\nstarforge grant-demo open --dir /private/reviewer/reopened</pre></section></body></html>`;
}

export async function startGrantDemo({directory, sourceRoot, port = 0, accessToken} = {}) {
  await inspectGrantDemoWorkspace({directory, sourceRoot});
  const {root, value} = await retainedInput(directory, sourceRoot);
  need(Number.isSafeInteger(port) && port >= 0 && port <= 65535, 'REVIEWER_PORT_INVALID');
  const token = accessToken ?? randomBytes(32).toString('base64url');
  need(typeof token === 'string' && token.length >= 24 && token.length <= 512 && !/[\x00-\x20\x7f]/.test(token),
    'REVIEWER_ACCESS_TOKEN_INVALID');
  // Explicit configuration deliberately imports no operator, OAuth or signing
  // module from either the packet or an inherited process environment.
  const workspace = await value.native.startMcpWorkspace({environment:{
    BAZAAR_DISCOVERY_URL:value.packet.source.discoveryUrl, MCP_ACCESS_TOKEN:token,
    MCP_STATE_DIR:join(root, 'buyer'), MCP_PORT:String(port),
    PAID_RESOURCE_ORIGINS:[...new Set(value.packet.quotes.map(({snapshot}) => new URL(snapshot.url).origin))].join(',')
  }});
  const instanceId = randomUUID(), connectionFile = join(root, 'connection.json');
  async function deactivateConnection() {
    let current;
    try { current = json(await readSourceFile(connectionFile, {privateFile:true})); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (current.instanceId !== instanceId) return;
    delete current.accessToken; current.active = false;
    try { await writeSourceFile(connectionFile, encoded(current), {replace:true}); }
    catch (error) {
      // The original native writer lease is still held. If replacing the small
      // record is impossible, remove only this instance's stale credential.
      const latest = json(await readSourceFile(connectionFile, {privateFile:true}));
      if (latest.instanceId === instanceId) {
        await unlink(connectionFile); await syncDirectory(root);
      } else throw error;
    }
  }
  try {
    need(workspace.paymentAdapterConnected === false && workspace.paymentReconciliationConnected === false,
      'REVIEWER_UNEXPECTED_OPERATOR');
    await writeSourceFile(connectionFile, encoded({schema:'stellar-forge.grant-reviewer-connection.v1',
      instanceId, pid:process.pid, active:true, consoleUrl:workspace.consoleUrl,
      accessToken:token, packetId:value.packet.packetId}), {replace:true});
    await writeSourceFile(join(root, 'review.html'), Buffer.from(renderReview(value, workspace.consoleUrl)), {replace:true});
  } catch (error) {
    try { await deactivateConnection(); }
    catch (cleanup) { error.connectionCleanupCode = cleanup.code ?? cleanup.name; }
    finally { await workspace.close(); }
    throw error;
  }
  let closing;
  return {...workspace, directory:root, packetId:value.packet.packetId, accessToken:token,
    connectionFile, reviewFile:join(root, 'review.html'),
    close() {
      if (closing) return closing;
      closing = (async () => {
        try { await deactivateConnection(); }
        finally { await workspace.close(); }
      })(); return closing;
    }};
}
