// MIT. The original managed customer through stdio, HTTP, complete-file reconnect,
// full archive upload and independently installed original Rails receiving.
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { runCustomerWorkspace } from '../../customer/examples/customer-workspace.mjs';
import { openRubyConnectedClient, connectRubyRuntime } from '../client.mjs';
import { downloadRubyFile } from '../receiving.mjs';
import { serveRubyHttp } from '../mcp.mjs';
import { directory, absolute, id, need, once, json, readJSON, regular, fingerprint,
  hashObject, digest, saveJSON } from '../../files.mjs';

const SCHEMA = 'stellar-forge.ruby-connected-customer-journey.v1';
const MCP = fileURLToPath(new URL('../mcp.mjs', import.meta.url));
const pause = ms => new Promise(accept => setTimeout(accept, ms));
const CUT = 'RUBY_CONNECTED_JOURNEY_RECONNECT';

export async function runConnectedCustomer({ managedDirectory, customerId, recipientPort } = {}) {
  const originalRoot = await directory(absolute(managedDirectory)), selectedId = id(customerId);
  need(Number.isInteger(recipientPort) && recipientPort >= 1 && recipientPort <= 65535,
    'RUBY_CONNECTED_JOURNEY_PORT', 'Select the original available loopback receiving port.');
  const originalCustomer = await runCustomerWorkspace({ managedDirectory: originalRoot, customerId: selectedId });
  const original = await readJSON(join(originalRoot, 'selection.json'));
  const managed = await readJSON(join(originalRoot, 'runtime-customer-result.json'));
  const root = await directory(join(originalRoot, 'connected-customer'), true);
  const producer = join(originalRoot, 'producer'), recipient = join(root, 'recipient');
  const selected = { schema: SCHEMA, managedDirectory: originalRoot, customerId: selectedId,
    managedResultSha256: managed.sha256, customerResultSha256: originalCustomer.sha256,
    originalCustomerOperationId: originalCustomer.customer.customerOperationId,
    originalRegistrationId: originalCustomer.customer.registrationId,
    originalApplicationId: originalCustomer.customer.applicationId,
    originalCustomerSelectionSha256: originalCustomer.customer.selectionSha256,
    archive: managed.archive, exportOperationId: managed.operations.export,
    ruby: original.ruby, bundlerVersion: original.bundlerVersion, recipientPort };
  await once(join(root, 'selection.json'), json(selected));
  let keys = await readJSON(join(root, 'operations.json'), true);
  if (!keys) {
    const value = { schema: SCHEMA, selectionSha256: hashObject(selected),
      keys: Object.fromEntries(['customerFile', 'archiveFile', 'receive', 'verify', 'serve']
        .map(name => [name, randomUUID()])) };
    await once(join(root, 'operations.json'), json(value)); keys = await readJSON(join(root, 'operations.json'));
  }
  need(keys.schema === SCHEMA && keys.selectionSha256 === hashObject(selected),
    'RUBY_CONNECTED_JOURNEY_SELECTION_CHANGED');
  keys = keys.keys;
  const phase = name => join(root, name + '.json');
  const retain = async (name, value) => { await once(phase(name), json(value)); return value; };
  async function sameBytes(path, expected) {
    const actual = await fingerprint(path, { privateOnly: true });
    need(actual.bytes === expected.bytes && actual.sha256 === expected.sha256,
      'RUBY_CONNECTED_JOURNEY_FILE_CHANGED');
    return actual;
  }
  function customerIdentity(value) {
    need(value.id === selectedId && value.phase === 'READY' && value.result &&
      value.selectionSha256 === selected.originalCustomerSelectionSha256 &&
      value.customerOperationId === selected.originalCustomerOperationId &&
      value.registrationId === selected.originalRegistrationId &&
      value.applicationId === selected.originalApplicationId,
      'RUBY_CONNECTED_JOURNEY_CUSTOMER_CHANGED');
  }
  const completed = await readJSON(phase('connected-result'), true);
  if (completed) {
    const { sha256, ...body } = completed;
    need(body.schema === SCHEMA && body.selectionSha256 === hashObject(selected) &&
      sha256 === hashObject(body), 'RUBY_CONNECTED_JOURNEY_RESULT_CHANGED');
    await sameBytes(completed.archive.path, selected.archive);
    await sameBytes(completed.customerFile.path, completed.customerFile);
    const client = await openRubyConnectedClient({ directory: recipient });
    try {
      const current = await client.application({ id: completed.application.id });
      need(current.selectionSha256 === completed.application.selectionSha256 && current.phase === 'STOPPED',
        'RUBY_CONNECTED_JOURNEY_APPLICATION_CHANGED');
      const verify = await client.operation({ operationId: keys.verify });
      need(verify.phase === 'SUCCEEDED' && !verify.active &&
        hashObject(verify.result.application) === hashObject(completed.observation),
        'RUBY_CONNECTED_JOURNEY_VERIFICATION_CHANGED');
      return completed;
    } finally { await client.close(); }
  }

  let stdio = null, producerHttp = null, sourceClient = null, recipientHttp = null, receiving = null;
  const activeListeners = new Set();
  async function openStdio() {
    return connectRubyRuntime({ command: process.execPath,
      args: [MCP, 'stdio', '--directory', producer], stderr: 'inherit' });
  }
  async function finishOperation(client, key, begin) {
    let value = await begin();
    if (!value.active && ['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(value.phase))
      value = await client.resume({ operationId: key });
    return client.waitOperation({ operationId: key, timeoutMs: 60 * 60 * 1000 });
  }
  async function ready(client, key) {
    const deadline = Date.now() + 60000;
    while (true) {
      const value = await client.operation({ operationId: key });
      if (value.active && value.url) return value;
      need(value.active || value.phase === 'QUEUED', 'RUBY_CONNECTED_JOURNEY_LISTENER_FAILED',
        'Read the original application operation ' + key + ' and its full log.');
      need(Date.now() < deadline, 'RUBY_CONNECTED_JOURNEY_LISTENER_TIMEOUT');
      await pause(250);
    }
  }
  try {
    if (!await readJSON(phase('stdio'), true)) {
      stdio = await openStdio();
      const value = await stdio.customer({ id: selectedId }); customerIdentity(value);
      const file = await stdio.downloadFile({ transferId: keys.customerFile,
        source: { kind: 'customer', id: selectedId, name: 'result.json' },
        directory: join(root, 'customer-file') });
      const inspected = await stdio.inspect();
      need(inspected.directory === producer, 'RUBY_CONNECTED_JOURNEY_ROOT_CHANGED');
      await retain('stdio', { tools: stdio.tools().map(tool => tool.name), customer: value, file,
        directory: inspected.directory, environmentIds: inspected.environments.map(value => value.id) });
    }
    if (!await readJSON(phase('download-connection'), true)) {
      stdio ??= await openStdio();
      let received = 0, interrupted = false;
      // Read a real first chunk and let the maintained receiver persist its
      // complete cursor. Disconnect before another read, then reopen over HTTP.
      const firstConnection = { ...stdio, async readTransfer(input, options) {
        if (received > 0) throw Object.assign(new Error('Continue the original saved download over HTTP.'), { code: CUT });
        const value = await stdio.readTransfer(input, options); received += value.bytes; return value;
      } };
      try {
        await downloadRubyFile(firstConnection, { transferId: keys.archiveFile,
          source: { kind: 'operation', operationId: selected.exportOperationId, name: 'ruby-runtime.tar' },
          expectedSha256: selected.archive.sha256, directory: join(root, 'archive') });
      } catch (error) { if (error.code !== CUT) throw error; interrupted = true; }
      const cursor = await readJSON(join(root, 'archive', 'cursor.json'));
      need(cursor.committedBytes > 0 && cursor.committedBytes <= selected.archive.bytes,
        'RUBY_CONNECTED_JOURNEY_DOWNLOAD_CURSOR');
      await retain('download-connection', { transferId: keys.archiveFile,
        interrupted, committedBytes: cursor.committedBytes, transport: 'stdio' });
    }
    if (stdio) { await stdio.close(); stdio = null; }
    producerHttp = await serveRubyHttp({ directory: producer, port: 0 });
    sourceClient = await connectRubyRuntime({ url: producerHttp.url, bearerToken: producerHttp.bearerToken });
    const sourceCustomer = await sourceClient.customer({ id: selectedId }); customerIdentity(sourceCustomer);
    const archive = await sourceClient.downloadFile({ transferId: keys.archiveFile,
      source: { kind: 'operation', operationId: selected.exportOperationId, name: 'ruby-runtime.tar' },
      expectedSha256: selected.archive.sha256, directory: join(root, 'archive') });
    await sameBytes(archive.path, selected.archive);
    await retain('http-download', archive);
    await sourceClient.close(); sourceClient = null;
    await producerHttp.close(); producerHttp = null;

    recipientHttp = await serveRubyHttp({ directory: recipient, create: true, port: 0 });
    receiving = await connectRubyRuntime({ url: recipientHttp.url, bearerToken: recipientHttp.bearerToken });
    let received = await readJSON(phase('receive'), true);
    if (!received) {
      received = await finishOperation(receiving, keys.receive, () => receiving.uploadFile({
        archive: archive.path, operationId: keys.receive, id: 'connected-received-customer',
        title: (original.title + ' connected receiving').slice(0, 160),
        ruby: selected.ruby, bundlerVersion: selected.bundlerVersion,
        expectedSha256: selected.archive.sha256, bytes: selected.archive.bytes }));
      await retain('receive', received);
    }
    need(received.phase === 'SUCCEEDED' && !received.active && received.result?.application?.id,
      'RUBY_CONNECTED_JOURNEY_RECEIVE_INCOMPLETE');
    const applicationId = received.result.application.id;
    let http = await readJSON(phase('rails-http'), true);
    if (!http) {
      let launches = await readJSON(phase('rails-launches'), true);
      if (!launches) {
        await retain('rails-launches', { applicationId, port: recipientPort, operations: [keys.serve] });
        launches = await readJSON(phase('rails-launches'));
      }
      need(launches.applicationId === applicationId && launches.port === recipientPort,
        'RUBY_CONNECTED_JOURNEY_LAUNCH_CHANGED');
      let key = launches.operations.at(-1);
      let state = await receiving.launchApplication({ id: applicationId, operationId: key, port: recipientPort });
      if (!state.active && state.phase === 'SUCCEEDED') {
        // A completed earlier server can precede a lost HTTP checkpoint.
        // Retain this explicit next listener generation before its first call.
        key = randomUUID();
        launches = { ...launches, operations: [...launches.operations, key] };
        await saveJSON(phase('rails-launches'), launches, true);
        state = await receiving.launchApplication({ id: applicationId, operationId: key, port: recipientPort });
      } else if (!state.active && ['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(state.phase))
        state = await receiving.resume({ operationId: key });
      activeListeners.add(key);
      state = await ready(receiving, key);
      const url = new URL(state.url), token = new URLSearchParams(url.hash.slice(1)).get('token');
      need(url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
        Number(url.port || 80) === recipientPort && /^[a-f0-9]{64}$/.test(token),
        'RUBY_CONNECTED_JOURNEY_APPLICATION_ADDRESS');
      const opening = await fetch(url.origin + '/managed-ruby/start', {
        redirect: 'error', signal: AbortSignal.timeout(15000) });
      need(opening.status === 200, 'RUBY_CONNECTED_JOURNEY_APPLICATION_HTTP'); await opening.arrayBuffer();
      const session = await fetch(url.origin + '/managed-ruby/session', {
        method: 'POST', headers: { Origin: url.origin, 'X-Ruby-Application': token },
        redirect: 'error', signal: AbortSignal.timeout(15000) });
      need(session.status === 204, 'RUBY_CONNECTED_JOURNEY_APPLICATION_SESSION');
      const cookie = session.headers.get('set-cookie')?.split(';')[0];
      need(cookie, 'RUBY_CONNECTED_JOURNEY_APPLICATION_SESSION');
      const page = await fetch(url.origin + '/dataset_imports', {
        headers: { Cookie: cookie }, redirect: 'error', signal: AbortSignal.timeout(30000) });
      const bytes = Buffer.from(await page.arrayBuffer());
      need(page.status === 200 && bytes.length > 0, 'RUBY_CONNECTED_JOURNEY_APPLICATION_HTTP');
      http = await retain('rails-http', { operationId: key, applicationId, port: recipientPort,
        status: page.status, bytes: bytes.length, sha256: digest(bytes) });
    }
    activeListeners.add(http.operationId);
    await receiving.cancel({ operationId: http.operationId });
    const stopDeadline = Date.now() + 30000;
    let stopped;
    do {
      stopped = await receiving.operation({ operationId: http.operationId });
      if (!stopped.active && ['SUCCEEDED', 'CANCELLED'].includes(stopped.phase)) break;
      need(stopped.active && Date.now() < stopDeadline, 'RUBY_CONNECTED_JOURNEY_STOP_PENDING');
      await pause(250);
    } while (true);
    activeListeners.delete(http.operationId);
    let verified = await readJSON(phase('verify'), true);
    if (!verified) {
      verified = await finishOperation(receiving, keys.verify, () => receiving.start({
        id: 'connected-received-customer', applicationId, operationId: keys.verify, action: 'verify' }));
      await retain('verify', verified);
    }
    const observation = verified.result?.application, originalObservation = managed.verification?.application;
    need(observation?.schema === 'stellar-forge.managed-ruby-application-observation.v1' &&
      originalObservation?.schema === observation.schema,
      'RUBY_CONNECTED_JOURNEY_ORIGINAL_OBSERVATION');
    for (const name of ['format', 'sourceKey', 'datasetManifestSha256', 'rows', 'editions', 'historySha256'])
      need(observation[name] === originalObservation[name], 'RUBY_CONNECTED_JOURNEY_ORIGINAL_DATA_CHANGED',
        'The independently received application differs in ' + name + '.');
    const application = await receiving.application({ id: applicationId });
    need(application.phase === 'STOPPED', 'RUBY_CONNECTED_JOURNEY_STOP_PENDING');
    await receiving.close(); receiving = null;
    await recipientHttp.close(); recipientHttp = null;
    receiving = await openRubyConnectedClient({ directory: recipient });
    const reopened = await receiving.application({ id: applicationId });
    need(reopened.selectionSha256 === application.selectionSha256 && reopened.phase === 'STOPPED',
      'RUBY_CONNECTED_JOURNEY_APPLICATION_CHANGED');
    const first = await readJSON(phase('stdio')), connection = await readJSON(phase('download-connection'));
    const body = { schema: SCHEMA, state: 'COMPLETE', selectionSha256: hashObject(selected),
      originalManagedResultSha256: managed.sha256, originalCustomerResultSha256: originalCustomer.sha256,
      originalCustomerOperationId: selected.originalCustomerOperationId,
      originalRegistrationId: selected.originalRegistrationId,
      transports: { stdio: { tools: first.tools, directory: first.directory },
        http: { originalCustomerSelectionSha256: sourceCustomer.selectionSha256 } },
      downloadConnection: connection, customerFile: first.file, archive,
      receivingOperationId: keys.receive, verificationOperationId: keys.verify,
      application: { id: applicationId, selectionSha256: application.selectionSha256, directory: application.directory },
      http, observation, reopened: true };
    const result = { ...body, sha256: hashObject(body) };
    await retain('connected-result', result);
    return result;
  } finally {
    if (receiving) {
      for (const operationId of activeListeners) {
        await receiving.cancel({ operationId }).catch(() => {});
        const deadline = Date.now() + 30000;
        while (Date.now() < deadline) {
          const state = await receiving.operation({ operationId }).catch(() => null);
          if (!state?.active) break;
          await pause(250);
        }
      }
    }
    const failures = [];
    for (const value of [stdio, sourceClient, producerHttp, receiving, recipientHttp])
      if (value) try { await value.close(); } catch (error) { failures.push(error); }
    if (failures.length) throw new AggregateError(failures, 'The original connected customer handles could not close completely.');
  }
}

export async function main(argv = process.argv.slice(2)) {
  need(argv.length === 6 && argv[0] === '--managed-directory' && argv[2] === '--customer-id' &&
    argv[4] === '--recipient-port' && /^[1-9][0-9]*$/.test(argv[5]),
    'RUBY_CONNECTED_JOURNEY_OPTIONS',
    'Use --managed-directory ORIGINAL_COMPLETED_MANAGED_JOURNEY --customer-id ORIGINAL_CUSTOMER_ID --recipient-port AVAILABLE_PORT.');
  return runConnectedCustomer({ managedDirectory: argv[1], customerId: argv[3], recipientPort: Number(argv[5]) });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(value => process.stdout.write(JSON.stringify(value, null, 2) + '\n')).catch(error => {
    process.stderr.write(JSON.stringify({ error: { code: error.code ?? 'RUBY_CONNECTED_JOURNEY_FAILED', message: error.message } }) + '\n');
    process.exitCode = 1;
  });
