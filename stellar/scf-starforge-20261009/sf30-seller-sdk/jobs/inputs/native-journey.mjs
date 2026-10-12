// MIT. Two original files through the maintained Request, checkout, worker and library journey.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readJson, writeJson, jsonBytes, digest, exists, privateDirectory } from '../../../sf88-operator-buyer-cli/node/store.mjs';
import { openAllowedInput, planFromHandle } from './source.mjs';
import { readChunk } from './files.mjs';
import { CHUNK_BYTES, UPLOAD_PATH, uploadIdentity } from './protocol.mjs';
import { startJobsWorkspace } from '../workspace/server.mjs';
import { openJobInputWorkspace } from './workspace/model.mjs';

const repetitions = 1000;
const input = { reportName: 'Original invoice file receiving', maxExceptions: 20 };

export async function prepareInputFileFixture({ fixture, immutable }) {
  const root = join(fixture, 'input-originals');
  await privateDirectory(root);
  const application = await readFile(new URL('./example-application.mjs', import.meta.url));
  const prices = await readFile(new URL('./example-prices.json', import.meta.url));
  const template = (await readFile(new URL('./example-ledger.ndjson', import.meta.url), 'utf8'))
    .trim().split('\n').map(line => JSON.parse(line));
  const lines = [];
  // Expand the shipped example into distinct invoices. Every amount and SKU
  // remains explicit original fixture input; this is 6000 rows, not blank padding.
  for (let batch = 0; batch < repetitions; batch++)
    for (const row of template) lines.push(JSON.stringify({ ...row, invoiceId: row.invoiceId + ':' + batch }));
  const ledger = Buffer.from(lines.join('\n') + '\n');
  const paths = { ledger: join(root, 'invoice-ledger.ndjson'), prices: join(root, 'supplier-prices.json') };
  const applicationPath = join(fixture, 'file-application.mjs');
  await immutable(applicationPath, application);
  await immutable(paths.ledger, ledger);
  await immutable(paths.prices, prices);
  const configuration = JSON.parse(await readFile(new URL('./example-merchant.json', import.meta.url)));
  configuration.application = applicationPath;
  configuration.memoryLimitMb = 128;
  return { root, paths, applicationPath, applicationSha256: digest(application),
    configuration, input, repetitions,
    originals: { ledger: { bytes: ledger.length, sha256: digest(ledger) },
      prices: { bytes: prices.length, sha256: digest(prices) } } };
}

export function openInputFileJourney({ fixture, operation, origin, jobId, immutable, inputs,
  api, getModel, getHost, getMerchant, restartWorkspace, restartMerchant }) {
  const lostAckPath = join(fixture, 'input-chunk-lost-ack.json');
  const localRestartPath = join(fixture, 'input-local-restart.json');
  const merchantRestartPath = join(fixture, 'input-merchant-restart.json');
  const plans = {};
  let lostAck = null, requestId = null, lostAckInjected = false;

  async function raw(path, bytes) {
    const host = getHost();
    const response = await fetch(host.origin + path, { method: 'PUT',
      headers: { authorization: 'Bearer ' + host.token, origin: host.origin,
        'content-type': 'application/octet-stream' }, body: bytes });
    const value = await response.json();
    assert.equal(response.ok, true, JSON.stringify({ path, status: response.status, value }));
    return value;
  }
  function wrapTransport(original) {
    return async (url, options) => {
      const response = await original(url, options);
      const target = new URL(url);
      if (options?.method === 'PUT' && target.origin === origin &&
          new RegExp('^' + UPLOAD_PATH + '/[a-f0-9]{64}/chunks/0$').test(target.pathname) &&
          response.status === 200 && !await exists(lostAckPath)) {
        const body = Buffer.from(await response.arrayBuffer());
        lostAck = { operation, path: target.pathname, status: response.status, responseSha256: digest(body) };
        // The actual merchant already fsynced this chunk before returning 200.
        // Retain that real response identity, then interrupt only its delivery.
        await immutable(lostAckPath, jsonBytes(lostAck));
        lostAckInjected = true;
        throw Object.assign(new Error('INPUT_FILE_FIXTURE_LOST_CHUNK_ACK'), { code: 'INPUT_FILE_FIXTURE_LOST_CHUNK_ACK' });
      }
      return response;
    };
  }
  async function makePlan(slot, definition) {
    const source = await openAllowedInput(inputs.paths[slot], [inputs.root]);
    try {
      const result = await planFromHandle({ file: source.file, origin, reference: jobId,
        functionId: definition.id, slot, policy: definition.inputFiles,
        filename: slot === 'ledger' ? 'invoice-ledger.ndjson' : 'supplier-prices.json',
        contentType: slot === 'ledger' ? 'application/x-ndjson' : 'application/json' });
      plans[slot] = result.plan;
      await immutable(join(fixture, 'input-' + slot + '-plan.json'), jsonBytes(result.plan));
      return result.plan;
    } finally { await source.close(); }
  }
  async function stageLedger(path) {
    let current = await api(path);
    let state = (await api(path + '/files/begin',
      { plan: plans.ledger, expectedRevision: current.revision })).upload;
    const id = uploadIdentity(plans.ledger);
    const source = await openAllowedInput(inputs.paths.ledger, [inputs.root]);
    try {
      if (!await exists(localRestartPath)) {
        assert.ok(plans.ledger.chunks.length >= 3, 'The actual ledger must cross multiple chunk boundaries.');
        if (state.missing.includes(0))
          state = (await raw(path + '/files/' + id + '/chunks/0',
            await readChunk(source.file, CHUNK_BYTES, 0))).upload;
        assert.equal(state.missing.includes(0), false);
        await restartWorkspace();
        current = await api(path);
        state = (await api(path + '/files/begin',
          { plan: plans.ledger, expectedRevision: current.revision })).upload;
        assert.equal(state.missing.includes(0), false);
        await immutable(localRestartPath, jsonBytes({ operation, uploadId: id,
          resumedChunks: state.receivedChunks, requestId }));
      }
      for (const index of state.missing) {
        const length = Math.min(CHUNK_BYTES, plans.ledger.file.bytes - index * CHUNK_BYTES);
        state = (await raw(path + '/files/' + id + '/chunks/' + index,
          await readChunk(source.file, length, index * CHUNK_BYTES))).upload;
      }
      state = (await api(path + '/files/' + id + '/seal', {})).upload;
      assert.equal(state.state, 'SEALED');
      assert.equal(state.file.sha256, inputs.originals.ledger.sha256);
    } finally { await source.close(); }
  }
  async function recoverMerchantRestart() {
    if (!await exists(lostAckPath) || await exists(merchantRestartPath)) return;
    lostAck = await readJson(lostAckPath);
    assert.equal(lostAck.operation, operation);
    const retained = getMerchant().inputs.list().find(value => value.id === lostAck.path.split('/').at(-3));
    assert.ok(retained?.receivedChunks > 0);
    await restartWorkspace(false);
    await restartMerchant();
    await restartWorkspace(true);
    const reopened = getMerchant().inputs.list().find(value => value.id === retained.id);
    assert.equal(reopened.receivedChunks, retained.receivedChunks);
    await immutable(merchantRestartPath, jsonBytes({ operation, requestId,
      uploadId: retained.id, receivedChunks: reopened.receivedChunks }));
  }
  async function prepare({ catalog, definition }) {
    requestId = digest(JSON.stringify(['job-intake', origin, jobId]));
    const path = '/api/job-intake/requests/' + requestId;
    let row, reused = true;
    try { row = await api(path); }
    catch (error) {
      if (error.status !== 404) throw error;
      const draft = await api('/api/job-intake/draft', { catalog, functionId: definition.id,
        input, reference: jobId, label: 'Original supplier-file reconciliation' });
      row = draft.request; reused = draft.reused;
    }
    await makePlan('ledger', definition); await makePlan('prices', definition);
    if (row.requestAttempts === 0 && row.phase !== 'IMPORTED') {
      await stageLedger(path);
      row = await api(path);
      const prices = (await api(path + '/files/local', { path: inputs.paths.prices, slot: 'prices',
        contentType: 'application/json', filename: 'supplier-prices.json', expectedRevision: row.revision })).upload;
      assert.equal(prices.state, 'SEALED');
      assert.equal(prices.file.sha256, inputs.originals.prices.sha256);
    }
    await recoverMerchantRestart();
    row = await api(path);
    if (row.phase !== 'IMPORTED') {
      await api(path + '/start', { kind: 'prepare', expectedRevision: row.revision });
      row = await getModel().intake.wait(requestId);
      if (row.task.state !== 'COMPLETE') {
        assert.equal(lostAckInjected, true, JSON.stringify({ error: row.lastError }));
        assert.equal(row.requestAttempts, 0, 'A request cannot be sent before both merchant originals are sealed.');
        await recoverMerchantRestart();
        row = await api(path);
        await api(path + '/start', { kind: 'prepare', expectedRevision: row.revision });
        row = await getModel().intake.wait(requestId);
      }
      assert.equal(row.task.state, 'COMPLETE', JSON.stringify({ requestId, error: row.lastError }));
    }
    assert.equal(row.phase, 'IMPORTED');
    assertRequest(row);
    return { request: row, reused };
  }
  function assertRequest(row) {
    assert.equal(row.reference, jobId);
    assert.equal(row.input.reportName, input.reportName);
    assert.equal(row.input.maxExceptions, input.maxExceptions);
    for (const slot of ['ledger', 'prices']) assert.deepEqual(row.input.$files[slot], plans[slot].file);
    assert.equal(row.inputFiles.merchantReceived, true);
  }
  function verifyReport(value) {
    assert.equal(value.schema, 'supplier-invoice-reconciliation.v1');
    assert.equal(value.jobId, jobId);
    assert.equal(value.records, 6 * repetitions);
    assert.equal(value.invoices, 4 * repetitions);
    assert.deepEqual(value.counts, { MATCH: 2 * repetitions, OVERCHARGED: repetitions,
      UNDERCHARGED: repetitions, UNKNOWN_SKU: repetitions, CURRENCY_MISMATCH: repetitions });
    assert.equal(value.exceptionCount, 4 * repetitions);
    assert.equal(value.exceptions.length, input.maxExceptions);
    assert.equal(value.omittedExceptions, 4 * repetitions - input.maxExceptions);
    const usd = value.totals.find(row => row.currency === 'USD');
    assert.equal(usd.expectedMinor, String(1200 * repetitions));
    assert.equal(usd.pricedChargedMinor, String(1220 * repetitions));
    assert.equal(usd.varianceMinor, String(20 * repetitions));
    const eur = value.totals.find(row => row.currency === 'EUR');
    assert.equal(eur.expectedMinor, String(900 * repetitions));
    assert.equal(eur.pricedChargedMinor, String(900 * repetitions));
    assert.equal(eur.varianceMinor, '0');
    for (const { slot, ...file } of value.sourceFiles) assert.deepEqual(file, plans[slot].file);
    assert.equal(value.sourceFiles.length, 2);
    return true;
  }
  async function inspectReceivingDesk() {
    const resultPath = join(fixture, 'input-merchant-receiving.json');
    if (await exists(resultPath)) {
      const prior = await readJson(resultPath);
      assert.equal(prior.operation, operation); assert.equal(prior.jobId, jobId);
      assert.deepEqual(prior.originals, inputs.originals);
      return prior;
    }
    let operator, desk, outcome, primary;
    const files = [], outputs = join(fixture, 'merchant-input-downloads');
    await privateDirectory(outputs);
    const call = async (path, input) => {
      const response = await fetch(operator.origin + path, {
        method: input === undefined ? 'GET' : 'POST',
        headers: { authorization: 'Bearer ' + operator.token, origin: operator.origin,
          ...(input === undefined ? {} : { 'content-type': 'application/json' }) },
        ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
      const value = await response.json();
      if (!response.ok) throw Object.assign(new Error(value.code || value.message), { code: value.code, status: response.status });
      return value;
    };
    try {
      operator = await startJobsWorkspace({ model: getMerchant(), port: 0 });
      desk = openJobInputWorkspace({ model: getMerchant() });
      for (const path of ['/inputs/', '/job-inputs.mjs', '/job-inputs.css'])
        assert.equal((await fetch(operator.origin + path)).status, 200, path);
      const query = await call('/api/inputs/query', { reference: jobId });
      assert.equal(query.total, 2);
      for (const [slot, plan] of Object.entries(plans)) {
        const id = uploadIdentity(plan), path = '/api/inputs/' + id;
        const detail = await call(path);
        assert.deepEqual(detail.original, plan); assert.equal(detail.upload.state, 'SEALED');
        assert.equal(detail.job.id, jobId); assert.equal(detail.usesFile, true);
        assert.equal(detail.release.allowed, false);
        const preview = await call(path + '/preview', {});
        assert.equal(preview.sha256, plan.file.sha256); assert.equal(preview.bytes, plan.file.bytes);
        assert.equal(preview.truncated, plan.file.bytes > 262144);
        const ticket = await call(path + '/download', {});
        const downloadUrl = new URL(ticket.url, operator.origin);
        assert.equal(downloadUrl.origin, operator.origin);
        assert.match(downloadUrl.pathname, /^\/input-transfer\/[a-f0-9]{48}$/);
        const response = await fetch(downloadUrl);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get('x-content-sha256'), plan.file.sha256);
        const downloaded = Buffer.from(await response.arrayBuffer());
        assert.equal(downloaded.length, plan.file.bytes); assert.equal(digest(downloaded), plan.file.sha256);
        const destination = join(outputs, slot + '.original');
        if (!await exists(destination))
          await immutable(destination, downloaded.subarray(0, Math.min(8193, downloaded.length)));
        const saved = await desk.save(id, { path: destination, resume: true });
        assert.equal(saved.bytes, plan.file.bytes); assert.equal(saved.sha256, plan.file.sha256);
        await assert.rejects(call(path + '/discard', { expectedRevision: detail.upload.revision,
          reason: 'Check the completed original job retains the input used by its worker.', releaseOrphan: true }),
        error => error.status === 409 && error.code === 'JOB_INPUT_FILE_IN_USE');
        files.push({ id, slot, bytes: plan.file.bytes, sha256: plan.file.sha256,
          previewBytes: preview.previewBytes, truncated: preview.truncated, saved });
      }
      await operator.close(); operator = null;
      operator = await startJobsWorkspace({ model: getMerchant(), port: 0 });
      const reopened = await call('/api/inputs/query', { reference: jobId });
      assert.deepEqual(reopened.items.map(row => row.id).sort(), files.map(file => file.id).sort());
      assert.ok(reopened.items.every(row => row.job?.id === jobId && row.pinned));
      outcome = { operation, jobId, originals: inputs.originals, files, reopened: true };
    } catch (error) { primary = error; throw error; }
    finally {
      const results = await Promise.allSettled([operator?.close(), desk?.close()]);
      const failures = results.filter(value => value.status === 'rejected').map(value => value.reason);
      if (failures.length) throw new AggregateError([...(primary ? [primary] : []), ...failures], 'INPUT_RECEIVING_JOURNEY_CLOSE_FAILED');
    }
    await immutable(resultPath, jsonBytes(outcome));
    return outcome;
  }
  async function finish({ resourceId, claimToken }) {
    const merchantReceiving = await inspectReceivingDesk();
    const path = '/api/job-intake/requests/' + requestId;
    const before = await api(path);
    const cleanup = await api(path + '/files/cleanup', { expectedRevision: before.revision });
    const after = await api(path);
    assert.equal(after.inputSha256, before.inputSha256);
    assert.equal(after.handoffSha256, before.handoffSha256);
    assert.equal(after.inputFiles.merchantReceived, true);
    assert.equal(after.inputFiles.ready, true);
    assert.equal(after.inputFiles.capacity.reservedBytes, 0);
    const listed = await api('/api/job-intake/files/library?q=' + encodeURIComponent(resourceId));
    // Search indexes user-visible text; exact resources remain addressed by their
    // original ID, so confirm the retained verified result directly as well.
    assert.ok(Array.isArray(listed.items));
    assert.equal(getModel().library.resource(resourceId).status, 'VERIFIED');
    for (const plan of Object.values(plans)) {
      const id = uploadIdentity(plan), file = getMerchant().inputs.status(id, claimToken);
      assert.equal(file.state, 'SEALED'); assert.equal(file.pinned, true);
    }
    return { operation, requestId, originalInputFiles: inputs.originals,
      sourceApplication: { path: inputs.applicationPath, sha256: inputs.applicationSha256 },
      repetitions, records: 6 * repetitions, localRestart: await readJson(localRestartPath),
      merchantRestart: await readJson(merchantRestartPath), lostChunkAck: await readJson(lostAckPath),
      customerCopiesReleased: cleanup, merchantFiles: 2, merchantReceiving,
      canonicalInputSha256: after.inputSha256, handoffSha256: after.handoffSha256 };
  }
  return { wrapTransport, prepare, assertRequest, verifyReport, finish };
}
