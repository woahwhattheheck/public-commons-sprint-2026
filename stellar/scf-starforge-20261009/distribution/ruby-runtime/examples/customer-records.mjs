// MIT. Original committed records through a complete stopped runtime archive and independent receiving.
import { open, link, unlink, rename } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { openRubyRuntime } from '../model.mjs';
import { directory, absolute, id, sha, operationId, operationLease, once, json, readJSON,
  regular, need, digest, hashObject, fingerprint, inventory, exists, syncParent, saveJSON } from '../files.mjs';

const SCHEMA = 'stellar-forge.ruby-runtime-records-customer.v1';
const NATIVE = 'stellar-forge.dataset-operator-records-journey.v1';
const pause = milliseconds => new Promise(accept => setTimeout(accept, milliseconds));
const PHASES = ['records', 'source-verify', 'export', 'receive', 'recipient-json', 'recipient-csv',
  'recipient-http', 'recipient-verify'];

async function receiveFile(core, key, name, target) {
  const source = await core.openFile({ operationId: key, name });
  let pending;
  try {
    if (await exists(target)) {
      const old = await fingerprint(target, { privateOnly: true });
      need(old.bytes === source.bytes && old.sha256 === source.sha256, 'RUBY_RECORDS_FILE_CHANGED');
      return { name: target.split('/').at(-1), ...old };
    }
    pending = target + '.pending-' + randomUUID();
    const output = await open(pending, 'wx', 0o600);
    let count = 0;
    const hash = createHash('sha256');
    try {
      for await (const bytes of source.handle.createReadStream({ start: 0, autoClose: false })) {
        hash.update(bytes); count += bytes.length;
        let at = 0;
        while (at < bytes.length) {
          const wrote = await output.write(bytes, at, bytes.length - at);
          need(wrote.bytesWritten > 0, 'RUBY_WRITE_FAILED'); at += wrote.bytesWritten;
        }
      }
      need(count === source.bytes && hash.digest('hex') === source.sha256, 'RUBY_RECORDS_FILE_CHANGED');
      await output.sync();
    } finally { await output.close(); }
    try { await link(pending, target); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const old = await fingerprint(target, { privateOnly: true });
      need(old.bytes === source.bytes && old.sha256 === source.sha256, 'RUBY_RECORDS_FILE_CHANGED');
    }
    await syncParent(target);
    return { name: target.split('/').at(-1), bytes: source.bytes, sha256: source.sha256 };
  } finally {
    await source.handle.close();
    if (pending) await unlink(pending).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}

export async function runRecordsCustomer({ managedDirectory, recipientPort } = {}) {
  const managedRoot = await directory(absolute(managedDirectory));
  need(Number.isInteger(recipientPort) && recipientPort >= 1 && recipientPort <= 65535,
    'RUBY_RECORDS_PORT');
  const originalRaw = await regular(join(managedRoot, 'selection.json'), 1024 * 1024);
  const original = JSON.parse(originalRaw.toString('utf8'));
  const managed = await readJSON(join(managedRoot, 'runtime-customer-result.json'));
  const { sha256: managedSha, ...managedBody } = managed;
  need(managed.schema === 'stellar-forge.ruby-runtime-customer.v1' && managed.state === 'COMPLETE' &&
    managedSha === hashObject(managedBody) && managed.selectionSha256 === digest(originalRaw),
    'RUBY_RECORDS_ORIGINAL_CUSTOMER_CHANGED');
  id(original.environmentId); id(original.applicationId); absolute(original.ruby);
  const root = await directory(join(managedRoot, 'committed-records'), true);
  const producer = join(managedRoot, 'producer'), parked = join(managedRoot, 'producer-records-unavailable');
  const recipient = join(root, 'recipient'), nativeRoot = join(root, 'native-records');
  const downloads = await directory(join(root, 'received-records'), true);
  const phaseRoot = await directory(join(root, 'phases'), true);
  const lease = await operationLease(join(root, 'journey.lock'));
  const selectedPath = join(root, 'selection.json'), resultPath = join(root, 'records-customer-result.json');
  const phase = name => join(phaseRoot, name + '.json');
  const retain = async (name, value) => { await once(phase(name), json(value)); return value; };
  const base = { schema: SCHEMA, managedResultSha256: managedSha, originalSelectionSha256: digest(originalRaw),
    environmentId: original.environmentId, applicationId: original.applicationId,
    ruby: original.ruby, bundlerVersion: original.bundlerVersion, recipientPort };
  let selected, keys, sourceCore, receiver, active = null, interrupted = false;
  const interrupt = () => { interrupted = true; };
  process.on('SIGINT', interrupt); process.on('SIGTERM', interrupt);
  async function restore() {
    if (await exists(parked)) {
      need(!await exists(producer), 'RUBY_RECORDS_PRODUCER_CONFLICT');
      await rename(parked, producer); await syncParent(producer);
    }
  }
  async function wait(core, key, ready = false) {
    active = { core, key };
    let offset = 0;
    try {
      while (true) {
        if (interrupted) {
          await core.cancel({ operationId: key });
          throw Object.assign(new Error('The original records operation was interrupted.'), { code: 'RUBY_RECORDS_INTERRUPTED' });
        }
        const value = await core.operation({ operationId: key });
        const log = await core.log({ operationId: key, offset }); offset = log.nextOffset;
        if (log.text) process.stderr.write(log.text);
        if (ready && value.active && value.url) return value;
        if (!value.active && ['SUCCEEDED', 'FAILED', 'CANCELLED', 'INTERRUPTED'].includes(value.phase)) {
          need(!ready && value.phase === 'SUCCEEDED', 'RUBY_RECORDS_NATIVE_FAILED',
            'Read the original operation ' + key + ' and its complete saved log.');
          return value;
        }
        await pause(300);
      }
    } finally { active = null; }
  }
  async function complete(name, core, begin) {
    const saved = await readJSON(phase(name), true);
    if (saved) {
      const actual = await core.operation({ operationId: keys[name] });
      need(actual.phase === 'SUCCEEDED' && !actual.active &&
        hashObject(actual.result) === hashObject(saved.result), 'RUBY_RECORDS_PHASE_CHANGED');
      return saved;
    }
    let value = await begin();
    if (!value.active && ['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(value.phase))
      value = await core.resume({ operationId: keys[name] });
    return retain(name, await wait(core, keys[name]));
  }
  async function sameFile(path, expected) {
    const actual = await fingerprint(path, { privateOnly: true });
    need(actual.bytes === expected.bytes && actual.sha256 === expected.sha256, 'RUBY_RECORDS_FILE_CHANGED');
    return actual;
  }
  async function stop(core, key) {
    const current = await core.operation({ operationId: key });
    if (!current.active && current.phase === 'SUCCEEDED') return current;
    await core.cancel({ operationId: key });
    return wait(core, key);
  }
  async function live(applicationId, capture, query) {
    const saved = await readJSON(phase('recipient-http'), true);
    if (saved) {
      await stop(receiver, saved.operationId); return saved;
    }
    const launchPath = phase('recipient-launches');
    let chosen = await readJSON(launchPath, true);
    if (!chosen) {
      await once(launchPath, json({ applicationId, port: recipientPort, operations: [keys['recipient-http']] }));
      chosen = await readJSON(launchPath);
    }
    need(chosen.applicationId === applicationId && chosen.port === recipientPort,
      'RUBY_RECORDS_APPLICATION_CHANGED');
    let key = chosen.operations.at(-1);
    let state = await receiver.launchApplication({ id: applicationId, operationId: key, port: recipientPort });
    if (!state.active && state.phase === 'SUCCEEDED') {
      key = randomUUID(); chosen = { ...chosen, operations: [...chosen.operations, key] };
      await saveJSON(launchPath, chosen, true);
      state = await receiver.launchApplication({ id: applicationId, operationId: key, port: recipientPort });
    } else if (!state.active && ['FAILED', 'INTERRUPTED', 'CANCELLED'].includes(state.phase))
      state = await receiver.resume({ operationId: key });
    state = await wait(receiver, key, true);
    const url = new URL(state.url), token = new URLSearchParams(url.hash.slice(1)).get('token');
    sha(token);
    need(url.protocol === 'http:' && url.hostname === '127.0.0.1' && Number(url.port || 80) === recipientPort,
      'RUBY_RECORDS_APPLICATION_URL');
    const session = await fetch(url.origin + '/managed-ruby/session', { method: 'POST',
      headers: { Origin: url.origin, 'X-Ruby-Application': token }, redirect: 'error',
      signal: AbortSignal.timeout(15000) });
    need(session.status === 204, 'RUBY_RECORDS_HTTP_SESSION');
    const cookie = session.headers.get('set-cookie')?.split(';')[0];
    need(cookie, 'RUBY_RECORDS_HTTP_SESSION');
    const screens = [];
    for (let page = 1; page <= query.pages; page++) {
      const target = new URL('/dataset_imports/' + capture.reviewId + '/records', url.origin);
      target.search = new URLSearchParams({ capture_id: capture.captureId, query_id: query.id, page: String(page) });
      const response = await fetch(target, { headers: { Cookie: cookie }, redirect: 'error',
        signal: AbortSignal.timeout(30000) });
      const raw = Buffer.from(await response.arrayBuffer());
      need(response.status === 200 && raw.length > 0, 'RUBY_RECORDS_HTTP_PAGE');
      const name = 'records-page-' + String(page).padStart(6, '0') + '.html';
      if (!await exists(join(downloads, name))) await once(join(downloads, name), raw);
      const actual = await fingerprint(join(downloads, name), { privateOnly: true });
      screens.push({ name, ...actual });
    }
    const observed = await retain('recipient-http', { operationId: key, applicationId,
      port: recipientPort, pages: query.pages, screens });
    await stop(receiver, key);
    return observed;
  }
  try {
    selected = await readJSON(selectedPath, true);
    if (selected) {
      need(hashObject(Object.fromEntries(Object.keys(base).map(key => [key, selected[key]]))) === hashObject(base),
        'RUBY_RECORDS_SELECTION_CHANGED');
    } else {
      need(!await exists(parked), 'RUBY_RECORDS_ORIGINAL_SELECTION_MISSING');
      sourceCore = await openRubyRuntime({ directory: producer });
      const app = await sourceCore.application({ id: original.applicationId });
      const environment = (await sourceCore.inspect()).environments.find(value => value.id === original.environmentId);
      need(environment?.phase === 'READY' && app.environmentId === original.environmentId &&
        ['READY', 'STOPPED'].includes(app.phase), 'RUBY_RECORDS_STOPPED_APPLICATION_REQUIRED');
      selected = { ...base, applicationSha256: app.selectionSha256,
        environmentSha256: environment.selectionSha256, applicationDirectory: app.directory,
        environmentDirectory: environment.directory };
      await once(selectedPath, json(selected));
    }
    let operations = await readJSON(join(root, 'operations.json'), true);
    if (!operations) {
      await once(join(root, 'operations.json'), json({ schema: SCHEMA, selectionSha256: hashObject(selected),
        keys: Object.fromEntries(PHASES.map(name => [name, randomUUID()])) }));
      operations = await readJSON(join(root, 'operations.json'));
    }
    need(operations.schema === SCHEMA && operations.selectionSha256 === hashObject(selected) &&
      Object.keys(operations.keys).sort().join(',') === [...PHASES].sort().join(','),
      'RUBY_RECORDS_OPERATION_CHANGED');
    keys = operations.keys; Object.values(keys).forEach(operationId);
    const completed = await readJSON(resultPath, true);
    if (completed) {
      const { sha256, ...body } = completed;
      need(body.schema === SCHEMA && body.state === 'COMPLETE' &&
        body.selectionSha256 === hashObject(selected) && sha256 === hashObject(body),
        'RUBY_RECORDS_RESULT_CHANGED');
      await sameFile(join(root, completed.archive.name), completed.archive);
      for (const file of [...completed.receivedFiles, ...completed.http.screens])
        await sameFile(join(downloads, file.name), file);
      receiver = await openRubyRuntime({ directory: recipient });
      const app = await receiver.application({ id: completed.application.id });
      need(app.selectionSha256 === completed.application.selectionSha256 && app.phase === 'STOPPED' &&
        hashObject(app.workingCapture) === hashObject(completed.workingCapture),
        'RUBY_RECORDS_RECEIVED_APPLICATION_CHANGED');
      const actual = await inventory(app.directory, { privateOnly: true, exclude: ['.ruby.lock'] });
      need(hashObject(actual) === completed.application.filesSha256 &&
        hashObject(actual) === hashObject(completed.application.files), 'RUBY_RECORDS_RECEIVED_FILES_CHANGED');
      return completed;
    }

    let native, archive, verifiedSource;
    if (await exists(parked)) {
      need(!await exists(producer), 'RUBY_RECORDS_PRODUCER_CONFLICT');
      native = await readJSON(join(root, 'records-result.json'));
      archive = await readJSON(phase('archive'));
      await sameFile(join(root, archive.name), archive);
      verifiedSource = await readJSON(phase('source-verify'));
    } else {
      sourceCore ??= await openRubyRuntime({ directory: producer });
      const app = await sourceCore.application({ id: selected.applicationId });
      const environment = (await sourceCore.inspect()).environments.find(value => value.id === selected.environmentId);
      need(app.selectionSha256 === selected.applicationSha256 && environment?.selectionSha256 === selected.environmentSha256 &&
        ['READY', 'STOPPED'].includes(app.phase), 'RUBY_RECORDS_ORIGINAL_APPLICATION_CHANGED');
      await complete('records', sourceCore, () => sourceCore.run({ id: selected.environmentId,
        operationId: keys.records, entry: 'dataset-records-lifecycle',
        argv: ['run', '--application', app.directory, '--runtime-source', join(environment.directory, 'support'),
          '--out', nativeRoot] }));
      await receiveFile(sourceCore, keys.records, 'customer-stdout.txt', join(root, 'records-result.json'));
      native = await readJSON(join(root, 'records-result.json'));
      need(native.schema === NATIVE && native.state === 'COMPLETE' && native.workingCapture,
        'RUBY_RECORDS_NATIVE_RESULT');
      verifiedSource = await complete('source-verify', sourceCore, () => sourceCore.start({
        id: selected.environmentId, applicationId: selected.applicationId, operationId: keys['source-verify'],
        action: 'verify', workingCapture: native.workingCapture }));
      need(hashObject(verifiedSource.result.application) === hashObject(native.snapshot.observation),
        'RUBY_RECORDS_NATIVE_OBSERVATION_CHANGED');
      await complete('export', sourceCore, () => sourceCore.start({ id: selected.environmentId,
        applicationId: selected.applicationId, operationId: keys.export, action: 'export',
        workingCapture: native.workingCapture }));
      archive = await receiveFile(sourceCore, keys.export, 'ruby-runtime.tar', join(root, 'ruby-runtime.tar'));
      await retain('archive', archive);
      need((await sourceCore.inspect()).operations.every(value => !value.active && value.phase !== 'QUEUED'),
        'RUBY_RECORDS_PRODUCER_BUSY', 'The original selected runtime has another active operation.');
      await sourceCore.close(); sourceCore = null;
      await rename(producer, parked); await syncParent(parked);
    }
    need(native.schema === NATIVE && native.state === 'COMPLETE' &&
      hashObject(verifiedSource.result.application) === hashObject(native.snapshot.observation),
      'RUBY_RECORDS_NATIVE_RESULT');
    const capture = native.workingCapture, expected = native.snapshot.observation;
    receiver = await openRubyRuntime({ directory: recipient, create: true });
    const received = await complete('receive', receiver, () => receiver.receive({
      id: 'record-received-customer', title: (original.title + ' working records').slice(0, 160),
      ruby: selected.ruby, bundlerVersion: selected.bundlerVersion, archive: join(root, archive.name),
      expectedSha256: archive.sha256, operationId: keys.receive }));
    need(hashObject(received.result.application.result) === hashObject(expected),
      'RUBY_RECORDS_RECEIVED_OBSERVATION_CHANGED');
    const application = await receiver.application({ id: received.result.application.id });
    need(hashObject(application.workingCapture) === hashObject(capture), 'RUBY_RECORDS_CAPTURE_CHANGED');
    const environment = (await receiver.inspect()).environments.find(value => value.id === 'record-received-customer');
    need(environment?.phase === 'READY', 'RUBY_RECORDS_RECEIVED_INSTALLATION');
    const outputs = [];
    for (const format of ['json', 'csv']) {
      const name = 'records.' + format, path = join(downloads, name);
      await complete('recipient-' + format, receiver, () => receiver.run({
        id: environment.id, operationId: keys['recipient-' + format], entry: 'dataset-records',
        argv: ['export', '--application', application.directory, '--runtime-source', join(environment.directory, 'support'),
          '--environment', environment.directory, '--review', capture.reviewId, '--capture', capture.captureId,
          '--query', native.observed.query_id, '--format', format, '--out', path] }));
      const originalFile = native.observed.exports.find(value => value.name === 'downloads/' + name);
      need(originalFile, 'RUBY_RECORDS_ORIGINAL_EXPORT');
      outputs.push({ name, ...await sameFile(path, originalFile) });
    }
    const http = await live(application.id, capture, native.observed.query);
    const verified = await complete('recipient-verify', receiver, () => receiver.start({
      id: environment.id, applicationId: application.id, operationId: keys['recipient-verify'], action: 'verify' }));
    need(hashObject(verified.result.application) === hashObject(expected), 'RUBY_RECORDS_FINAL_OBSERVATION_CHANGED');
    const current = await receiver.application({ id: application.id });
    need(current.phase === 'STOPPED', 'RUBY_RECORDS_STOP_PENDING');
    const files = await inventory(current.directory, { privateOnly: true, exclude: ['.ruby.lock'] });
    await receiver.close(); receiver = null;
    receiver = await openRubyRuntime({ directory: recipient });
    const reopened = await receiver.application({ id: current.id });
    need(reopened.selectionSha256 === current.selectionSha256 && reopened.phase === 'STOPPED' &&
      hashObject(await inventory(reopened.directory, { privateOnly: true, exclude: ['.ruby.lock'] })) === hashObject(files),
      'RUBY_RECORDS_REOPEN_CHANGED');
    const body = { schema: SCHEMA, state: 'COMPLETE', selectionSha256: hashObject(selected),
      originalManagedResultSha256: managedSha, operations: keys, workingCapture: capture,
      nativeRecordJourney: { schema: native.schema, observed: native.observed, snapshot: native.snapshot },
      archive, receivedFiles: outputs, observation: expected, http,
      application: { id: current.id, selectionSha256: current.selectionSha256,
        directory: 'recipient/applications/' + current.id + '/workspace', filesSha256: hashObject(files), files },
      producerUnavailableDuringReceiving: true, recipientReopened: true };
    const result = { ...body, sha256: hashObject(body) };
    await once(resultPath, json(result));
    return result;
  } finally {
    try {
      if (!receiver && await exists(parked) && await exists(join(recipient, 'ruby-runtime.json')))
        receiver = await openRubyRuntime({ directory: recipient });
      if (active) await active.core.cancel({ operationId: active.key });
      const launches = await readJSON(phase('recipient-launches'), true);
      const owned = new Set([...(keys ? Object.values(keys) : []), ...(launches?.operations ?? [])]);
      for (const core of [sourceCore, receiver]) if (core) {
        for (const key of owned) {
          let value = await core.operation({ operationId: key }).catch(error => {
            if (error.code === 'ENOENT') return null; throw error;
          });
          if (!value || !value.active && value.phase !== 'QUEUED') continue;
          await core.cancel({ operationId: key });
          const deadline = Date.now() + 30000;
          while ((value = await core.operation({ operationId: key })).active) {
            need(Date.now() < deadline, 'RUBY_RECORDS_STOP_PENDING',
              'The original worker is draining. Keep the selected producer parked until its lease closes.');
            await pause(200);
          }
        }
        await core.close();
      }
      await restore();
    } finally {
      process.off('SIGINT', interrupt); process.off('SIGTERM', interrupt);
      await lease.close();
    }
  }
}

export async function main(argv = process.argv.slice(2)) {
  need(argv.length === 4 && argv[0] === '--managed-directory' && argv[2] === '--recipient-port' &&
    /^[1-9][0-9]*$/.test(argv[3]), 'RUBY_RECORDS_CUSTOMER_OPTIONS',
    'Use --managed-directory ORIGINAL_COMPLETED_MANAGED_JOURNEY --recipient-port AVAILABLE_PORT.');
  return runRecordsCustomer({ managedDirectory: argv[1], recipientPort: Number(argv[3]) });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().then(value => process.stdout.write(JSON.stringify(value, null, 2) + '\n')).catch(error => {
    process.stderr.write(JSON.stringify({ error: { code: error.code ?? 'RUBY_RECORDS_CUSTOMER_FAILED',
      message: error.message } }) + '\n'); process.exitCode = 1;
  });
