/** MIT. Retained reviewer control over the original grant packet and Buyer. */
import {mkdir, readdir} from 'node:fs/promises';
import {join, dirname, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID, createHash} from 'node:crypto';
import {MAX_PACKET_BYTES, inspectGrantDemo, receiveGrantDemo, inspectGrantDemoWorkspace,
  exportGrantDemo, startGrantDemo, nativeModules, readSourceFile, writeSourceFile} from './workspace.mjs';
import {operationLease, privateDirectory, operationId, canonical, processIdentity}
  from '../../../scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';

export const WORKBENCH_SCHEMA = 'stellar-forge.grant-reviewer-workbench.v1';
export const SELECTION_SCHEMA = 'stellar-forge.grant-reviewer-selection.v1';
export const ACTION_SCHEMA = 'stellar-forge.grant-reviewer-action.v1';
const bundled = fileURLToPath(new URL('./hpd-purchase.json', import.meta.url));
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const now = () => new Date().toISOString();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const encoded = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const fail = (code, message = code, status = 400) => { throw Object.assign(new Error(message), {code, status}); };
const need = (value, code, message, status) => { if (!value) fail(code, message, status); };
const decode = bytes => JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(bytes));
async function directory(path) {
  try { await mkdir(path, {mode:0o700}); }
  catch (e) { if (e.code !== 'EEXIST') throw e; }
  return privateDirectory(path);
}
async function read(path, optional = false) {
  try { return decode(await readSourceFile(path, {privateFile:true})); }
  catch (e) { if (optional && e.code === 'ENOENT') return null; throw e; }
}
async function save(path, value, replace = false) {
  return writeSourceFile(path, encoded(value), {replace});
}
async function retain(path, bytes) {
  try { await writeSourceFile(path, bytes); }
  catch (e) { if (e.code !== 'EEXIST') throw e;
    need((await readSourceFile(path, {privateFile:true})).equals(bytes), 'REVIEWER_RETAINED_INPUT_CHANGED'); }
}
function stableId(text) {
  const h = sha(text).slice(0, 32); return h.slice(0, 8) + '-' + h.slice(8, 12) + '-' +
    h.slice(12, 16) + '-' + h.slice(16, 20) + '-' + h.slice(20);
}
function titleText(value) {
  need(typeof value === 'string' && value.trim() && value.trim().length <= 180 &&
    !/[\x00-\x1f\x7f]/.test(value), 'REVIEWER_TITLE_REQUIRED');
  return value.trim();
}

/** One kernel lease owns the workbench; original Buyer keeps its own store lease. */
export async function openReviewerWorkbench({directory: selected, sourceRoot, packetFile, expectedSha256} = {}) {
  need(typeof selected === 'string' && selected === resolve(selected), 'REVIEWER_ABSOLUTE_PATH_REQUIRED');
  await privateDirectory(dirname(selected));
  const root = await directory(selected);
  const lease = await operationLease(join(root, 'workbench.lock'));
  let currentBuyer = null, closing = false, closed = false, tail = Promise.resolve(), header, native;
  const instanceId = randomUUID(), processStart = await processIdentity();
  const selectionPath = id => join(root, 'selections', operationId(id) + '.json');
  const actionPath = id => join(root, 'operations', operationId(id) + '.json');
  const packetPath = selection => join(root, 'inputs', selection.packet.sha256 + '.json');
  const nativeDirectory = id => join(root, 'received', operationId(id));
  async function selection(id) {
    const value = await read(selectionPath(id));
    need(value.schema === SELECTION_SCHEMA && value.id === id && Number.isSafeInteger(value.revision),
      'REVIEWER_SELECTION_CHANGED');
    return value;
  }
  function serial(fn) {
    if (closing) return Promise.reject(Object.assign(new Error('The reviewer is closing.'), {code:'REVIEWER_CLOSING', status:409}));
    const task = tail.then(() => { need(!closing, 'REVIEWER_CLOSING', undefined, 409); return fn(); });
    tail = task.catch(() => {}); return task;
  }
  async function operation(kind, input, requestId, fn) {
    const id = operationId(requestId), inputHash = sha(JSON.stringify(canonical({kind, input})));
    let record = await read(actionPath(id), true);
    if (record) {
      need(record.kind === kind && record.inputHash === inputHash, 'REVIEWER_ACTION_ID_REUSED', undefined, 409);
      if (record.state === 'COMPLETED') return {...record.result, actionId:id, replayed:true};
    } else {
      record = {schema:ACTION_SCHEMA, id, kind, input, inputHash, createdAt:now(), state:'PREPARED', attempts:0};
      await save(actionPath(id), record);
    }
    record = {...record, attempts:record.attempts + 1, lastStartedAt:now(), state:'PREPARED'};
    delete record.error; await save(actionPath(id), record, true);
    try {
      const result = await fn(record);
      await save(actionPath(id), {...record, state:'COMPLETED', completedAt:now(), result}, true);
      return {...result, actionId:id, replayed:false};
    } catch (error) {
      try { await save(actionPath(id), {...record, state:'CONTINUATION_REQUIRED', failedAt:now(),
        error:{code:error.code ?? error.name, message:error.message}}, true); }
      catch { /* The original PREPARED intent remains authoritative when disk publication fails. */ }
      throw error;
    }
  }
  async function stopBuyer() {
    if (!currentBuyer) return;
    const original = currentBuyer;
    // close() drains original HTTP/broker work and releases the native quote writer.
    await original.application.close();
    if (currentBuyer === original) currentBuyer = null;
  }
  function buyerView() {
    return currentBuyer ? {active:true, selectionId:currentBuyer.selection.id, packetId:currentBuyer.application.packetId,
      consoleUrl:currentBuyer.application.consoleUrl, directory:currentBuyer.application.directory,
      instanceId:currentBuyer.instanceId} : {active:false};
  }
  async function checkedRevision(id, revision, ownAction, kind) {
    const value = await selection(id);
    need(value.revision === revision || ownAction && value[kind + 'ActionId'] === ownAction,
      'REVIEWER_SELECTION_REVISION_CHANGED', 'Refresh the selected packet before continuing.', 409);
    return value;
  }
  async function reviewBytes(bytes, title, requestId, origin) {
    need(bytes.length <= MAX_PACKET_BYTES, 'REVIEWER_PACKET_LIMIT');
    const digest = sha(bytes), inputPath = join(root, 'inputs', digest + '.json');
    await retain(inputPath, bytes);
    return operation('review', {sha256:digest, bytes:bytes.length, title, origin}, requestId, async action => {
      const packet = await inspectGrantDemo({packetFile:inputPath, expectedSha256:digest, sourceRoot:native.sourceRoot});
      let value = await read(selectionPath(action.id), true);
      if (value) need(value.packet.sha256 === digest && value.title === title, 'REVIEWER_SELECTION_CHANGED');
      else {
        value = {schema:SELECTION_SCHEMA, id:action.id, revision:1, title, state:'REVIEWED',
          createdAt:action.createdAt, reviewedAt:now(), origin, packet, reviewActionId:action.id};
        await save(selectionPath(action.id), value);
      }
      return {selection:value};
    });
  }
  const model = {
    directory:root, instanceId, processStart,
    get workbenchId() { return header.id; },
    get sourceRoot() { return native.sourceRoot; },
    snapshot() { return serial(async () => {
      const names = (await readdir(join(root, 'selections'))).filter(name => /^[a-f0-9-]{36}\.json$/.test(name));
      const selections = await Promise.all(names.map(name => selection(name.slice(0, -5))));
      selections.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
      const operations = await Promise.all((await readdir(join(root, 'operations'))).filter(name =>
        /^[a-f0-9-]{36}\.json$/.test(name)).map(name => read(join(root, 'operations', name))));
      operations.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
      return {...header, instanceId, directory:root, selections, selected:await read(join(root, 'selected.json'), true),
        buyer:buyerView(), operations, newPayments:0, signingConnected:false};
    }); },
    review(input) { return serial(async () => {
      need(plain(input), 'REVIEWER_REVIEW_REQUIRED');
      const title = titleText(input.title ?? 'Original public purchase');
      let bytes, origin;
      if (input.source === 'bundled') {
        bytes = await readSourceFile(bundled); origin = {kind:'bundled', filename:'hpd-purchase.json'};
      } else if (input.source === 'export') {
        const old = await read(actionPath(input.exportId));
        need(old.kind === 'export' && old.state === 'COMPLETED', 'REVIEWER_EXPORT_REQUIRED');
        bytes = await readSourceFile(old.result.export.path, {privateFile:true});
        need(sha(bytes) === old.result.export.sha256, 'REVIEWER_EXPORT_OUTPUT_CHANGED');
        origin = {kind:'export', actionId:old.id, sourcePacketId:old.result.export.sourcePacketId};
      } else {
        need(input.source === 'upload' && typeof input.base64 === 'string', 'REVIEWER_PACKET_REQUIRED');
        bytes = Buffer.from(input.base64, 'base64');
        need(bytes.toString('base64') === input.base64 && /^[a-f0-9]{64}$/.test(input.expectedSha256 ?? '') &&
          sha(bytes) === input.expectedSha256, 'REVIEWER_PACKET_CHANGED');
        origin = {kind:'upload', filename:title};
      }
      return reviewBytes(bytes, title, input.requestId, origin);
    }); },
    receive(input) { return serial(() => operation('receive', {selectionId:input.selectionId,
      expectedRevision:input.expectedRevision}, input.requestId, async action => {
      const value = await checkedRevision(input.selectionId, input.expectedRevision, action.id, 'receive');
      if (value.state === 'RECEIVED') return {selection:value, receipt:value.receipt};
      need(value.state === 'REVIEWED', 'REVIEWER_SELECTION_NOT_REVIEWED');
      await stopBuyer();
      const receipt = await receiveGrantDemo({directory:nativeDirectory(value.id), packetFile:packetPath(value),
        expectedSha256:value.packet.sha256, sourceRoot:native.sourceRoot});
      const retained = {...value, revision:value.revision + 1, state:'RECEIVED', receipt, receiveActionId:action.id};
      await save(selectionPath(value.id), retained, true);
      return {selection:retained, receipt};
    })); },
    openBuyer(input) { return serial(() => operation('open', {selectionId:input.selectionId,
      expectedRevision:input.expectedRevision}, input.requestId, async () => {
      const value = await checkedRevision(input.selectionId, input.expectedRevision);
      need(value.state === 'RECEIVED', 'REVIEWER_RECEIVE_FIRST');
      if (currentBuyer?.selection.id !== value.id) {
        await stopBuyer();
        await save(join(root, 'selected.json'), {selectionId:value.id, packetId:value.packet.packetId, selectedAt:now()}, true);
        need(!closing, 'REVIEWER_CLOSING');
        const application = await startGrantDemo({directory:nativeDirectory(value.id), sourceRoot:native.sourceRoot});
        currentBuyer = {selection:value, application, instanceId:randomUUID()};
      }
      return {buyer:buyerView()};
    })); },
    closeBuyer(input) { return serial(() => operation('close', {}, input.requestId, async () => {
      await stopBuyer(); return {buyer:buyerView()};
    })); },
    exportPacket(input) { return serial(() => operation('export', {selectionId:input.selectionId,
      expectedRevision:input.expectedRevision}, input.requestId, async action => {
      const value = await checkedRevision(input.selectionId, input.expectedRevision);
      need(value.state === 'RECEIVED', 'REVIEWER_RECEIVE_FIRST');
      await stopBuyer();
      const exported = await exportGrantDemo({directory:nativeDirectory(value.id),
        output:join(root, 'exports', action.id + '.json'), sourceRoot:native.sourceRoot,
        requestId:action.id, exportedAt:action.createdAt});
      return {export:exported, buyer:buyerView(), selectionId:value.id};
    })); },
    inspectSelection(id) { return serial(async () => {
      const value = await selection(id);
      const packet = await inspectGrantDemo({packetFile:packetPath(value), expectedSha256:value.packet.sha256,
        sourceRoot:native.sourceRoot});
      // A live Buyer is read through its original MCP API; closed native verification includes all transitions.
      const workspace = value.state === 'RECEIVED' && !currentBuyer ?
        await inspectGrantDemoWorkspace({directory:nativeDirectory(id), sourceRoot:native.sourceRoot}) : null;
      return {selection:value, packet, workspace};
    }); },
    document(id, index) { return serial(async () => {
      const value = await selection(id), bytes = await readSourceFile(packetPath(value), {privateFile:true});
      need(sha(bytes) === value.packet.sha256, 'REVIEWER_PACKET_CHANGED');
      const packet = decode(bytes), item = packet.documents[index];
      need(Number.isSafeInteger(index) && item, 'REVIEWER_DOCUMENT_REQUIRED', undefined, 404);
      const content = Buffer.from(item.data, 'base64');
      need(content.length === item.bytes && sha(content) === item.sha256, 'REVIEWER_DOCUMENT_CHANGED');
      return {bytes:content, filename:item.path.split('/').at(-1), sha256:item.sha256, contentType:item.contentType};
    }); },
    downloadExport(id) { return serial(async () => {
      const action = await read(actionPath(id));
      need(action.kind === 'export' && action.state === 'COMPLETED', 'REVIEWER_EXPORT_REQUIRED', undefined, 404);
      const result = action.result.export, bytes = await readSourceFile(result.path, {privateFile:true});
      need(bytes.length === result.bytes && sha(bytes) === result.sha256, 'REVIEWER_EXPORT_OUTPUT_CHANGED');
      return {bytes, filename:'grant-reviewer-' + id + '.json', sha256:result.sha256, contentType:'application/json'};
    }); },
    buyerCredential() { return serial(async () => {
      need(currentBuyer, 'REVIEWER_BUYER_NOT_OPEN', 'Open the received packet first.', 409);
      const application = currentBuyer.application;
      const saved = await read(application.connectionFile);
      need(saved.active === true && saved.pid === process.pid && saved.packetId === application.packetId &&
        saved.accessToken === application.accessToken && saved.consoleUrl === application.consoleUrl,
        'REVIEWER_BUYER_CONNECTION_CHANGED');
      return {consoleUrl:saved.consoleUrl, accessToken:saved.accessToken, instanceId:saved.instanceId,
        packetId:saved.packetId};
    }); },
    withBuyer(fn) { return serial(async () => {
      need(currentBuyer, 'REVIEWER_BUYER_NOT_OPEN', 'Open the received packet first.', 409);
      return fn(currentBuyer.application, currentBuyer.selection);
    }); },
    async close() {
      if (closed) return;
      closing = true;
      await tail;
      try { await stopBuyer(); }
      finally { closed = true; await lease.close(); }
    },
  };
  try {
    native = await nativeModules(sourceRoot);
    for (const name of ['inputs', 'selections', 'received', 'operations', 'exports']) await directory(join(root, name));
    header = await read(join(root, 'workbench.json'), true);
    if (!header) {
      header = {schema:WORKBENCH_SCHEMA, id:randomUUID(), createdAt:now()};
      await save(join(root, 'workbench.json'), header);
    }
    need(header.schema === WORKBENCH_SCHEMA && typeof header.id === 'string', 'REVIEWER_WORKBENCH_CHANGED');
    if (packetFile) {
      need(/^[a-f0-9]{64}$/.test(expectedSha256 ?? ''), 'REVIEWER_PACKET_DIGEST_REQUIRED');
      const bytes = await readSourceFile(resolve(packetFile));
      need(sha(bytes) === expectedSha256, 'REVIEWER_PACKET_CHANGED');
      await reviewBytes(bytes, 'Selected launch packet', stableId('launch:' + expectedSha256),
        {kind:'selected-file', filename:resolve(packetFile)});
    }
    return model;
  } catch (error) { await model.close(); throw error; }
}
