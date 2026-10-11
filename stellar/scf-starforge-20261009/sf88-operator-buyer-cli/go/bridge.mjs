// MIT. Go applications call the selected original Node buyer through this adapter.
import { constants } from 'node:fs';
import { open, lstat, rename } from 'node:fs/promises';
import { resolve, dirname, join, isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';

const SCHEMA = 'stellar-forge.go-buyer-call.v1';
const MAX_REQUEST = 32 * 1024 * 1024;
const abort = new AbortController();
const stop = () => abort.abort();
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
process.stdout.on('error', stop);
let request;
let outputFile;

function need(condition, code) {
  if (!condition) throw Object.assign(new Error(code), {code});
}
function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function safeCode(error) {
  return typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,100}$/.test(error.code)
    ? error.code : 'GO_BRIDGE_OPERATION_FAILED';
}
async function input(path) {
  need(isAbsolute(path), 'ABSOLUTE_CALL_FILE_REQUIRED');
  const directory = await lstat(dirname(path));
  need(directory.isDirectory() && (directory.mode & 0o077) === 0, 'PRIVATE_CALL_DIRECTORY_REQUIRED');
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const stat = await file.stat();
    need(stat.isFile() && (stat.mode & 0o077) === 0 && stat.size <= MAX_REQUEST, 'PRIVATE_CALL_FILE_REQUIRED');
    const bytes = await file.readFile();
    need(bytes.length <= MAX_REQUEST, 'GO_CALL_SIZE_LIMIT');
    return JSON.parse(bytes.toString('utf8'));
  } finally { await file.close(); }
}
async function save(value) {
  const temporary = outputFile + '.pending';
  const file = await open(temporary, 'wx', 0o600);
  try { await file.writeFile(JSON.stringify(value) + '\n'); await file.sync(); }
  finally { await file.close(); }
  await rename(temporary, outputFile);
  const directory = await open(dirname(outputFile), 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}
async function write(bytes) {
  need(!abort.signal.aborted, 'GO_CALL_ABORTED');
  await new Promise((done, reject) => process.stdout.write(bytes, error => error ? reject(error) : done()));
}
function resultSummary(value) {
  return value === null ? null : {
    record: value.record, native: value.native, status: value.status,
    delivery: value.delivery, stream: value.stream, ok: value.ok,
  };
}
function objectSummary(value) {
  return {record: value.record, process: value.process, status: value.status,
    native: value.native, chunkPage: value.chunkPage, assemblyPage: value.assemblyPage};
}
function objectDelivery(value) {
  return {path: value.path, assembly: value.assembly, receiptRecorded: value.receiptRecorded,
    report: objectSummary(value.report)};
}
function operationSummary(value) {
  return {intentId: value.intentId, directory: value.directory};
}
function decodeBody(options) {
  const value = {...(options ?? {})};
  if (Object.hasOwn(value, 'bodyBase64')) {
    need(typeof value.bodyBase64 === 'string', 'GO_BODY_ENCODING_INVALID');
    const bytes = Buffer.from(value.bodyBase64, 'base64');
    need(bytes.toString('base64') === value.bodyBase64, 'GO_BODY_ENCODING_INVALID');
    value.body = bytes;
    delete value.bodyBase64;
  }
  return value;
}

async function dispatch(call) {
  need(call.schema === SCHEMA && typeof call.callId === 'string' && /^[A-Za-z0-9_-]+$/.test(call.callId),
    'GO_CALL_SCHEMA_INVALID');
  need(typeof call.action === 'string' && record(call.client), 'GO_CALL_FIELDS_INVALID');
  need(isAbsolute(call.client.runtimeDirectory) && isAbsolute(call.client.stateDirectory),
    'ABSOLUTE_BUYER_DIRECTORIES_REQUIRED');
  need(!abort.signal.aborted, 'GO_CALL_ABORTED');
  const entry = join(call.client.runtimeDirectory, 'node', 'index.mjs');
  need((await lstat(entry)).isFile(), 'ORIGINAL_NODE_BUYER_REQUIRED');
  const {Buyer, BuyerResult} = await import(pathToFileURL(entry).href);
  need(typeof Buyer === 'function', 'ORIGINAL_NODE_BUYER_REQUIRED');
  const buyer = new Buyer({...call.client, node: process.execPath});
  const args = call.arguments ?? {};
  need(record(args), 'GO_CALL_ARGUMENTS_INVALID');
  const signal = abort.signal;
  const options = {...(args.options ?? {}), signal};
  const operation = () => buyer.operation(call.id);
  const acquisition = () => buyer.object(call.id);
  const dataset = () => buyer.dataset(call.id);
  const inbox = () => buyer.inbox(args.directory);
  async function selectedFile() {
    const selection = args.selection;
    need(record(selection), 'GO_FILE_SELECTION_REQUIRED');
    if (selection.kind === 'response') {
      need(record(selection.record) && record(selection.responseFile), 'ORIGINAL_RESPONSE_FIELDS_REQUIRED');
      const value = new BuyerResult(selection.record, selection.responseFile, buyer.runtime.directory);
      return {file:value, metadata:value.delivery, result:value};
    }
    if (selection.kind === 'inbox') {
      const value = await buyer.inbox(selection.directory).response(selection.id, {signal});
      need(value !== null, 'ORIGINAL_RESULT_NOT_AVAILABLE');
      return {file:value, metadata:value.delivery, result:value};
    }
    if (selection.kind === 'operation') {
      const value = await buyer.operation(selection.id).recover();
      need(value !== null, 'ORIGINAL_RESULT_NOT_AVAILABLE');
      return {file: value, metadata: value.delivery, result: value};
    }
    if (selection.kind === 'object') {
      const value = await buyer.object(selection.id).delivery(selection.destination, {signal});
      return {file: value, metadata: {path:value.path, ...value.assembly}, object:value};
    }
    if (selection.kind === 'dataset') {
      const value = await buyer.dataset(selection.id).deliver(selection.destination, {signal});
      const file = value.file(selection.name);
      return {file, metadata:file.metadata, dataset:value};
    }
    throw Object.assign(new Error('GO_FILE_KIND_INVALID'), {code:'GO_FILE_KIND_INVALID'});
  }

  switch (call.action) {
    case 'buyer.ready':
      await buyer.ready();
      return {runtimeDirectory:buyer.runtime.directory, stateDirectory:buyer.stateDirectory,
        node:process.version, implementation:'ORIGINAL_NODE_BUYER'};
    case 'buyer.list': {
      const values = [];
      for await (const value of buyer.list()) values.push(operationSummary(value));
      return values;
    }
    case 'buyer.create':
      return operationSummary(await buyer.fromConfig(args.config ?? args.configFile, decodeBody(args.options)));
    case 'buyer.request': {
      const request = {...args.request};
      const supplied = decodeBody(args.options);
      if (Object.hasOwn(supplied, 'body')) { request.body = supplied.body; delete supplied.body; }
      return operationSummary(await buyer.fromRequest(request, supplied));
    }
    case 'buyer.discover':
      return buyer.discover(args.catalog, {destination:args.destination, signal});
    case 'buyer.prepare':
      return operationSummary(await buyer.prepare({...decodeBody(args), signal}));
    case 'buyer.import':
      return operationSummary(await buyer.fromOperationHandoff(args.file, {...args.options, signal}));
    case 'buyer.create-inbox': {
      const value = await buyer.createInbox({directory:args.directory, signal});
      return {directory:value.directory};
    }
    case 'buyer.inspect-handoff': return buyer.inspectOperationHandoff(args.file, options);
    case 'operation.review': return operation().review();
    case 'operation.inspect': return operation().inspect();
    case 'operation.execute': return resultSummary(await operation().execute({review:args.review, signal}));
    case 'operation.recover': return resultSummary(await operation().recover());

    case 'inbox.list': return inbox().list(options);
    case 'inbox.show': return inbox().show(call.id, options);
    case 'inbox.enqueue': return inbox().enqueue(operation(), options);
    case 'inbox.enqueue-config': return inbox().enqueueConfig(args.configFile, options);
    case 'inbox.review': return inbox().review(call.id, options);
    case 'inbox.execute': return inbox().execute(call.id, options);
    case 'inbox.cancel': return inbox().cancel(call.id, options);
    case 'inbox.recover': return inbox().recover(call.id, options);
    case 'inbox.finalize': return inbox().finalize(call.id, options);
    case 'inbox.report': return inbox().exportReport(args.destination, options);
    case 'inbox.response': {
      const value = await inbox().response(call.id, options);
      return value === null ? null : {job:value.job, native:value.native, status:value.status,
        delivery:value.delivery, stream:value.stream};
    }

    case 'object.create':
      return {id:(await buyer.createObject(args)).id};
    case 'object.attach':
      return {id:(await buyer.attachObject(args)).id};
    case 'object.list': {
      const values = [];
      for await (const value of buyer.listObjects()) values.push({id:value.id, directory:value.directory});
      return values;
    }
    case 'object.initialize': return objectSummary(await acquisition().initialize(options));
    case 'object.inspect': return objectSummary(await acquisition().inspect(options));
    case 'object.recover': return objectSummary(await acquisition().recover(options));
    case 'object.run': return objectSummary(await acquisition().run(options));
    case 'object.download': return objectDelivery(await acquisition().download(args.destination, options));
    case 'object.assemble': return objectDelivery(await acquisition().assemble(args.destination, options));
    case 'object.delivery': return objectDelivery(await acquisition().delivery(args.destination, options));
    case 'object.report':
      return objectSummary(await acquisition().exportReport(args.destination, {...options, format:args.format}));
    case 'object.accounting': return acquisition().accounting(options);
    case 'object.finalize': return acquisition().finalize(options);
    case 'object.recover-accounting': return acquisition().recoverAccounting(options);

    case 'dataset.create':
      return {id:(await buyer.createDataset(args)).id};
    case 'dataset.attach':
      return {id:(await buyer.attachDataset(args)).id};
    case 'dataset.list': {
      const values = [];
      for await (const value of buyer.listDatasets()) values.push({id:value.id, directory:value.directory});
      return values;
    }
    case 'dataset.initialize': return dataset().initialize(options);
    case 'dataset.inspect': return dataset().inspect(options);
    case 'dataset.recover': return dataset().recover(options);
    case 'dataset.run': return dataset().run(options);
    case 'dataset.deliver': {
      const value = await dataset().deliver(args.destination, options);
      return {report:value.report, manifest:value.manifest};
    }
    case 'dataset.manifest': return dataset().exportManifest(args.destination, options);
    case 'dataset.accounting': return dataset().accounting(options);
    case 'dataset.finalize': return dataset().finalize(options);
    case 'dataset.recover-accounting': return dataset().recoverAccounting(options);

    case 'file.verify':
    case 'file.copy':
    case 'file.bytes':
    case 'file.stream':
    case 'file.records': {
      const selected = await selectedFile();
      let bytes = 0, records = 0;
      if (call.action === 'file.verify') return {path:selected.metadata.path, ...await selected.file.verify({signal})};
      if (call.action === 'file.copy') {
        const destination = await selected.file.saveAs(args.destination, {signal});
        return {path:destination, ...await selected.file.verify({signal})};
      }
      if (call.action === 'file.bytes') {
        const value = await selected.file.bytes({limit:args.limit ?? 8388608, signal});
        await write(value);
        return {bytes:value.length, sha256:selected.metadata.sha256};
      }
      if (call.action === 'file.stream') {
        for await (const chunk of selected.file.chunks({...options, signal})) {
          await write(chunk); bytes += chunk.length;
        }
        return {bytes, sha256:selected.metadata.sha256};
      }
      let iterator;
      if (args.format === 'ndjson') {
        need(selected.result, 'ORIGINAL_RESPONSE_STREAM_REQUIRED');
        iterator = selected.result.ndjson(options);
      } else if (args.format === 'sse') {
        need(selected.result, 'ORIGINAL_RESPONSE_STREAM_REQUIRED');
        iterator = selected.result.events(options);
      } else if (args.format === 'csv') iterator = selected.file.csvRows(options);
      else if (args.format === 'dataset') {
        need(selected.dataset, 'ORIGINAL_DATASET_REQUIRED');
        iterator = selected.dataset.rows(options);
      } else throw Object.assign(new Error('GO_RECORD_FORMAT_INVALID'), {code:'GO_RECORD_FORMAT_INVALID'});
      for await (const value of iterator) {
        const encoded = Buffer.from(JSON.stringify(value) + '\n');
        await write(encoded); bytes += encoded.length; records++;
      }
      return {records, bytes, sha256:selected.metadata.sha256 ?? null};
    }
    default: throw Object.assign(new Error('GO_ACTION_UNKNOWN'), {code:'GO_ACTION_UNKNOWN'});
  }
}

try {
  need(process.argv.length === 3, 'GO_CALL_FILE_REQUIRED');
  const path = resolve(process.argv[2]);
  request = await input(path);
  outputFile = join(dirname(path), 'response.json');
  const result = await dispatch(request);
  await save({schema:SCHEMA, callId:request.callId, action:request.action,
    id:request.id ?? null, ok:true, result});
} catch (error) {
  if (outputFile && request) {
    const details = {code:safeCode(error)};
    if (Number.isInteger(error.exitCode)) details.exitCode = error.exitCode;
    if (error.progress?.record) details.progress = objectSummary(error.progress);
    try {
      await save({schema:SCHEMA, callId:request.callId, action:request.action,
        id:request.id ?? null, ok:false, error:details});
    } catch { process.exitCode = 2; }
  }
  process.exitCode ??= 1;
} finally {
  process.removeListener('SIGINT', stop);
  process.removeListener('SIGTERM', stop);
}

