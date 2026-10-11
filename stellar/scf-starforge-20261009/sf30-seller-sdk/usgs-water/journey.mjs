// MIT. One maintained USGS -> hydrology workspace -> original SF30/SF61/SF82/SF88 journey.
// Source: live USGS responses or their exact retained byte carrier.
// Commerce fixture methods: ../python/merchant.journey.mjs and ../../sf81-buyer-operator-bridge/acceptance.py.
import assert from 'node:assert/strict';
import { createServer as httpServer, request as httpRequest } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { connect as connectTcp } from 'node:net';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, rename, cp, chmod } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { privateDirectory, atomicJson } from '../routescan/quota.mjs';
import { createUsgsTransport, captureRows, readCapture, buildQuery, canonicalJson } from './provider.mjs';
import { openWaterProject } from './project.mjs';
import { readWaterEdition, startWaterMerchant, waterMerchantStatus, prepareWaterPurchase,
  purchaseWaterEdition, reopenWaterPurchase } from './merchant.mjs';
import { Buyer } from '../../sf88-operator-buyer-cli/node/client.mjs';

const execFile = promisify(execFileCallback);
const here = dirname(fileURLToPath(import.meta.url));
const ORIGIN = 'https://water-journey.example';
const FIXTURE_TRANSACTION = 'LOCAL_CONTROLLED_NOT_A_TRANSACTION';
const SELECTION = Object.freeze({
  collection: 'daily', locationIds: ['USGS-01646500'], parameterCodes: ['00060'],
  statisticIds: ['00003'], time: { start: '2026-10-01', end: '2026-10-07' }, limit: 2,
});
const OPTIONS = Object.freeze({
  quality: 'all', window: { start: '2026-10-05', end: '2026-10-07' },
  baselineWindow: { start: '2026-10-01', end: '2026-10-03' },
});
const PAYMENT = Object.freeze({
  scheme: 'exact', network: 'stellar:testnet', asset: 'C' + 'A'.repeat(55),
  payTo: 'G' + 'A'.repeat(55), amount: '7', maxTimeoutSeconds: 60,
});
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const equal = (a, b, label) => assert.equal(canonicalJson(a), canonicalJson(b), label);
const publicError = error => ({ code: error?.code ?? error?.name ?? 'WATER_JOURNEY_FAILED',
  message: String(error?.message ?? error).slice(0, 1200) });

async function listen(server) {
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); done(); });
  });
  return 'http://127.0.0.1:' + server.address().port;
}
async function closeServer(server) {
  if (!server?.listening) return;
  server.closeAllConnections?.();
  await new Promise(done => server.close(done));
}

/** Use exact original bodies, HTTP metadata and next URLs from a connected source host. */
export async function retainedUsgsTransport(file) {
  const bytes = await readFile(resolve(file)), bundle = JSON.parse(bytes);
  assert.equal(bundle.schema, 'starforge.usgs-water-source-bundle.v1');
  assert.equal(bundle.initialUrl, buildQuery(SELECTION), 'Carrier must select this exact demonstration.');
  assert(Array.isArray(bundle.responses) && bundle.responses.length > 0);
  const responses = new Map();
  for (const row of bundle.responses) {
    assert.equal(row.status, 200, 'Retained source carrier needs the actual successful source responses.');
    assert.equal(typeof row.url, 'string');
    assert.equal(typeof row.receivedAt, 'string');
    assert(Number.isFinite(Date.parse(row.receivedAt)));
    assert.equal(typeof row.bodyBase64, 'string');
    const body = Buffer.from(row.bodyBase64, 'base64');
    assert.equal(body.toString('base64'), row.bodyBase64);
    assert.equal(body.length, row.bytes);
    assert.equal(sha(body), row.sha256);
    assert(!responses.has(row.url), 'Repeated source URL in carrier.');
    responses.set(row.url, { status: row.status, headers: row.headers, body,
      url: row.url, receivedAt: row.receivedAt });
  }
  return {
    mode: 'RETAINED_USGS_HTTP_RESPONSES', bundleSha256: sha(bytes), bytes, availablePages: responses.size,
    async request(url, { signal } = {}) {
      signal?.throwIfAborted();
      const original = responses.get(url);
      assert(original, 'The carrier lacks an original response for ' + url);
      return { ...original, body: Buffer.from(original.body) };
    },
    async close() {},
  };
}

/** HTTP exposure of the original local protocol facilitator fixture. */
async function localFacilitator() {
  const counts = { supported: 0, verified: 0, settled: 0 };
  const original = {
    async getSupported() {
      counts.supported++;
      return { kinds: [{ x402Version: 2, scheme: 'exact', network: 'stellar:testnet' }],
        extensions: ['bazaar'], signers: {} };
    },
    async verify() { counts.verified++; return { isValid: true, payer: 'local-controlled-payer' }; },
    async settle() { counts.settled++; return { success: true, transaction: 'local-controlled-result', network: 'stellar:testnet' }; },
  };
  const server = httpServer(async (request, response) => {
    try {
      let size = 0;
      for await (const chunk of request) { size += chunk.length; if (size > 1048576) throw Error('Local fixture request exceeds 1 MiB.'); }
      const method = request.method;
      const call = method === 'GET' && request.url === '/supported' ? original.getSupported :
        method === 'POST' && request.url === '/verify' ? original.verify :
        method === 'POST' && request.url === '/settle' ? original.settle : null;
      const value = call ? await call() : { error: 'Unknown local fixture route.' };
      response.writeHead(call ? 200 : 404, { 'content-type': 'application/json' });
      response.end(JSON.stringify(value));
    } catch {
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end('{"error":"Local fixture request failed."}');
    }
  });
  const url = await listen(server);
  return { url, counts, close: () => closeServer(server) };
}

/** Keep original SF31/SF85 HTTPS validation through an explicit owned CONNECT endpoint.
 * The generated certificate is trusted only by the native SF88 child processes. */
async function localMerchantTransport(directory, merchantUrl) {
  const keyFile = join(directory, 'merchant-key.pem'), certFile = join(directory, 'merchant-cert.pem');
  await execFile('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=water-journey.example', '-addext', 'subjectAltName=DNS:water-journey.example',
    '-keyout', keyFile, '-out', certFile], { timeout: 30000, maxBuffer: 32768 });
  await Promise.all([chmod(keyFile, 0o600), chmod(certFile, 0o600)]);
  const counts = { tunnels: 0, requests: 0, signedRequests: 0 };
  const sockets = new Set();
  const local = new URL(merchantUrl);
  const gateway = httpsServer({ key: await readFile(keyFile), cert: await readFile(certFile) }, (request, response) => {
    counts.requests++; if (request.headers['payment-signature']) counts.signedRequests++;
    const upstream = httpRequest({
      hostname: '127.0.0.1', port: local.port, method: request.method, path: request.url,
      headers: { ...request.headers, host: new URL(ORIGIN).host },
    }, original => {
      response.writeHead(original.statusCode, original.headers);
      original.pipe(response);
      original.on('error', () => response.destroy());
    });
    upstream.on('error', () => { if (!response.headersSent) response.writeHead(502); response.end(); });
    request.on('aborted', () => upstream.destroy());
    response.on('close', () => { if (!response.writableEnded) upstream.destroy(); });
    request.pipe(upstream);
  });
  const proxy = httpServer((_request, response) => { response.writeHead(405); response.end(); });
  proxy.on('connect', (request, downstream, head) => {
    if (request.url !== 'water-journey.example:443') {
      downstream.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return;
    }
    counts.tunnels++;
    const upstream = connectTcp({ host: '127.0.0.1', port: gateway.address().port });
    for (const socket of [downstream, upstream]) {
      sockets.add(socket); socket.once('close', () => sockets.delete(socket));
      socket.once('error', () => { downstream.destroy(); upstream.destroy(); });
    }
    upstream.once('connect', () => {
      downstream.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      downstream.pipe(upstream); upstream.pipe(downstream);
    });
  });
  try {
    await listen(gateway);
    const proxyUrl = await listen(proxy);
    return { certFile, counts, buyerTransport: { mode: 'explicit-connect', origin: ORIGIN, proxyUrl },
      async close() { for (const socket of sockets) socket.destroy(); await closeServer(proxy); await closeServer(gateway); } };
  } catch (error) {
    for (const socket of sockets) socket.destroy();
    await closeServer(proxy); await closeServer(gateway); throw error;
  }
}

async function sourceFile(path, bytes) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, bytes, { mode: 0o600, flag: 'wx' });
}

/** Run in a controlling terminal. The CLI supplies the original local-fixture PTY method. */
export async function runWaterJourney({ directory, sourceBundle, python } = {}) {
  const root = await privateDirectory(resolve(directory));
  const pythonPath = python ?? (await execFile('python3', ['-I', '-c', 'import sys; print(sys.executable)'])).stdout.trim();
  await atomicJson(root, 'journey-operation.json', { schema: 'starforge.usgs-water-journey.v1',
    startedAt: new Date().toISOString(), selection: SELECTION, commerce: 'ORIGINAL_LOCAL_PROTOCOL_FIXTURE' }, { exclusive: true });
  const exportsDirectory = await privateDirectory(join(root, 'exports'));
  const fixtureDirectory = await privateDirectory(join(root, 'local-fixture'));
  let project, source, facilitator, merchant, transport, stage = 'source';
  let sourceRequests = 0;
  try {
    source = sourceBundle ? await retainedUsgsTransport(sourceBundle) : createUsgsTransport();
    if (source.bytes) await sourceFile(join(root, 'upstream-source.json'), source.bytes);
    const observedSource = { async request(url, options) { sourceRequests++; return source.request(url, options); } };
    project = await openWaterProject(join(root, 'project'), { transport: observedSource });
    const saved = await project.save({ title: 'Potomac daily discharge — October operations review',
      selection: SELECTION, expectedRevision: 0 });
    const acquired = await project.acquire({ operationId: 'usgs-october-01-07', expectedRevision: saved.revision });
    assert.equal(acquired.status, 'COMPLETE', json(acquired));
    const capture = await project.capture(acquired.operationId);
    assert(capture.pages.length > 1, 'The source journey must exercise the original next pages.');
    const rows = await captureRows(capture);
    assert.equal(rows.length, 7, 'The selected source series should return seven retained daily observations.');
    const expectedRows = new Map(rows.map(row => [row.feature_id, row]));
    assert.equal(expectedRows.size, rows.length);
    const requestsBeforeReopen = sourceRequests;
    const reopened = await project.acquire({ operationId: acquired.operationId, expectedRevision: saved.revision });
    assert.equal(reopened.captureSha256, capture.captureSha256);
    assert.equal(sourceRequests, requestsBeforeReopen, 'A complete capture reopens without another source request.');

    stage = 'analysis';
    const evaluated = await project.analyze({ captureId: acquired.operationId, options: OPTIONS });
    assert.equal(evaluated.analysis.counts.series, 1);
    assert.equal(evaluated.analysis.counts.conflictingFeatures, 0);
    const series = evaluated.analysis.series[0];
    assert.equal(series.current.observations, 3);
    assert.equal(series.baseline.observations, 3);
    assert.equal(series.unit, 'ft^3/s');
    const note = 'Compare 5–7 October mean daily discharge with the 1–3 October baseline. ' +
      'Keep the provider approval status and qualification on each observation. ' +
      'Current mean: ' + series.current.mean.value + ' ' + series.unit +
      '; baseline mean: ' + series.baseline.mean.value + ' ' + series.unit +
      '; change: ' + series.change.value + ' ' + series.unit + '. ' +
      'Retain this edition for the next operations review.';
    const review = await project.saveReview({ reviewId: 'october-operations', captureId: acquired.operationId,
      options: OPTIONS, note, expectedCaptureSha256: capture.captureSha256 });
    equal(await project.readReview(review.reviewId), review, 'Saved decision reopens unchanged.');
    const exportedReviews = [];
    for (const format of ['html', 'json', 'csv', 'geojson']) {
      const output = await project.exportReview({ reviewId: review.reviewId, format });
      await sourceFile(join(exportsDirectory, output.filename), output.bytes);
      exportedReviews.push({ format, file: output.filename, bytes: output.bytes.length, sha256: sha(output.bytes) });
    }

    stage = 'edition';
    const edition = await project.prepareEdition({ editionId: 'october-water', reviewId: review.reviewId });
    assert.equal(edition.captureSha256, capture.captureSha256);
    assert.equal(edition.rowCount, rows.length);
    await project.stageEdition({ editionId: 'october-water', origin: ORIGIN, path: '/water', payment: PAYMENT });
    facilitator = await localFacilitator();
    merchant = await startWaterMerchant({ editionDirectory: edition.directory, port: 0,
      facilitator: facilitator.url, allowLocalFacilitator: true });
    const merchantStatus = await waterMerchantStatus(edition.directory);
    transport = await localMerchantTransport(fixtureDirectory, merchant.url);

    stage = 'native-buyer';
    const policy = { schema: 'stellar-spend-governor/v1', assets: [{ network: PAYMENT.network, asset: PAYMENT.asset,
      max_single: '100', max_total: '100', max_per_utc_day: '100',
      max_per_actor_utc_day: '100', max_per_service_utc_day: '100' }] };
    const policyPath = join(fixtureDirectory, 'policy.json');
    const signerPath = join(fixtureDirectory, 'signer.mjs');
    await sourceFile(policyPath, json(policy));
    await sourceFile(signerPath, 'export async function sign({ challenge, accepted }) {\n' +
      '  return { x402Version: 2, resource: challenge.resource, accepted,\n' +
      '    payload: { transaction: ' + JSON.stringify(FIXTURE_TRANSACTION) + ' }, extensions: challenge.extensions };\n}\n');
    const keys = Object.fromEntries(['SF36_CONSENT_KEY_B64', 'SF36_AUDIT_KEY_B64', 'SF36_OPERATOR_KEY_B64']
      .map(name => [name, randomBytes(32).toString('base64')]));
    const buyer = await new Buyer({
      runtimeDirectory: fileURLToPath(new URL('../../sf88-operator-buyer-cli/', import.meta.url)),
      stateDirectory: join(root, 'buyer'),
      operatorProfile: {
        operator: { python: pythonPath, actor: 'water-journey', service: 'usgs-water',
          policy: policyPath, ledger: join(fixtureDirectory, 'ledger.sqlite') },
        signerModule: signerPath, buyerTransport: transport.buyerTransport,
      },
      environment: { ...process.env, ...keys, NODE_EXTRA_CA_CERTS: transport.certFile },
      timeoutMs: 90000,
    }).ready();
    const delivered = [], purchases = [], pageDeliveries = [];
    const baseQuery = { limit: '2', sort: 'local_date' };
    let previous = null, pageNumber = 0;
    do {
      pageNumber++;
      const prepared = await prepareWaterPurchase({ editionDirectory: edition.directory,
        intentId: 'water-journey-page-' + String(pageNumber).padStart(4, '0'),
        query: { ...baseQuery, ...(previous ? { cursor: previous.nextCursor } : {}) }, previous });
      if (pageNumber === 1) {
        const target = new URL(prepared.url);
        const unsigned = await fetch(merchant.url + target.pathname + target.search, { signal: AbortSignal.timeout(10000) });
        assert.equal(unsigned.status, 402);
        const challenge = JSON.parse(Buffer.from(unsigned.headers.get('payment-required'), 'base64'));
        assert.equal(challenge.x402Version, 2);
        assert.equal(challenge.accepts[0].network, PAYMENT.network);
        assert.equal(challenge.accepts[0].amount, PAYMENT.amount);
        await unsigned.arrayBuffer();
        assert.equal(facilitator.counts.verified, 0);
        await sourceFile(join(exportsDirectory, 'unsigned-402.json'), json({ status: 402, challenge }));
      }
      const acquiredPage = await purchaseWaterEdition({ buyer, prepared });
      assert.equal(acquiredPage.metadata.snapshot, edition.snapshot);
      assert.equal(acquiredPage.result.native.mode, 'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT');
      const file = 'purchased-observations-' + String(pageNumber).padStart(4, '0') + '.json';
      await acquiredPage.result.saveAs(join(exportsDirectory, file));
      delivered.push(...acquiredPage.rows);
      purchases.push(acquiredPage); pageDeliveries.push({ intentId: acquiredPage.intentId,
        status: acquiredPage.result.status, httpStatus: acquiredPage.result.native.httpStatus, file, metadata: acquiredPage.metadata,
        response: { sha256: acquiredPage.result.delivery.sha256, bytes: acquiredPage.result.delivery.bytes } });
      previous = acquiredPage.metadata;
    } while (previous.nextCursor !== null);
    assert.equal(delivered.length, rows.length);
    assert.equal(new Set(delivered.map(row => row.feature_id)).size, rows.length);
    for (const row of delivered) {
      const original = expectedRows.get(row.feature_id);
      assert(original);
      for (const field of ['time', 'value', 'unit_of_measure', 'approval_status', 'monitoring_location_id',
        'time_series_id', 'parameter_code', 'statistic_id', 'value_state'])
        assert.equal(row[field], original[field], 'Native projection changed ' + field);
      equal(JSON.parse(row.properties_json), original.properties, 'Native delivery preserves every original property.');
      equal(JSON.parse(row.geometry_json), original.geometry, 'Native delivery preserves the original geometry.');
    }
    const originalFile = edition.downloads.find(item => item.path.startsWith('capture/bodies/'));
    assert(originalFile);
    const sourcePurchase = await purchaseWaterEdition({ buyer, prepared: await prepareWaterPurchase({
      editionDirectory: edition.directory, intentId: 'water-journey-original-source', file: originalFile.path }) });
    assert.equal(sourcePurchase.metadata.sha256, originalFile.sha256);
    assert.deepEqual(await sourcePurchase.result.bytes(), await readFile(join(edition.directory, originalFile.path)));
    await sourcePurchase.result.saveAs(join(exportsDirectory, 'purchased-original-source.json'));
    purchases.push(sourcePurchase);
    const editionPurchase = await purchaseWaterEdition({ buyer, prepared: await prepareWaterPurchase({
      editionDirectory: edition.directory, intentId: 'water-journey-edition', kind: 'edition' }) });
    assert.equal(editionPurchase.value.editionId, edition.editionId);
    await editionPurchase.result.saveAs(join(exportsDirectory, 'purchased-edition.json'));
    purchases.push(editionPurchase);
    assert.equal(facilitator.counts.settled, purchases.length);

    stage = 'portable-reopen';
    await project.close(); project = null;
    const relocatedCapture = join(root, 'relocated-source-capture');
    await rename(capture.directory, relocatedCapture);
    const exportedEdition = join(exportsDirectory, 'water-edition');
    await cp(edition.directory, exportedEdition, { recursive: true, force: false, errorOnExist: true, dereference: false });
    const portable = await readWaterEdition(exportedEdition);
    assert.equal(portable.editionId, edition.editionId);
    assert.equal(portable.snapshot, edition.snapshot);
    const portableCapture = await readCapture(join(exportedEdition, 'capture'));
    assert.equal(portableCapture.captureSha256, capture.captureSha256);
    equal(await captureRows(portableCapture), (await captureRows(await readCapture(relocatedCapture))),
      'Portable edition reopens its original source graph.');
    const nativeRequestsBeforeReopen = transport.counts.requests;
    const nativeSettlementsBeforeReopen = facilitator.counts.settled;
    for (const purchase of purchases) {
      const retained = await reopenWaterPurchase({ buyer, intentId: purchase.intentId, editionDirectory: exportedEdition });
      assert.equal(retained.result.delivery.sha256, purchase.result.delivery.sha256);
      equal(retained.value, purchase.value, 'Original SF88 result reopens unchanged.');
    }
    assert.equal(transport.counts.requests, nativeRequestsBeforeReopen);
    assert.equal(facilitator.counts.settled, nativeSettlementsBeforeReopen);
    assert.equal(sourceRequests, requestsBeforeReopen);
    // Keep the authoring project usable after proving the exported edition is independent.
    await rename(relocatedCapture, capture.directory);
    const result = {
      schema: 'starforge.usgs-water-journey.v1', status: 'PASS', completedAt: new Date().toISOString(),
      directory: root, sourceMode: source.mode ?? 'USGS_HTTPS',
      ...(source.bundleSha256 ? { sourceBundleSha256: source.bundleSha256 } : {}),
      source: { operationId: capture.operationId, captureSha256: capture.captureSha256,
        selection: capture.selection, pages: capture.pages.length, observations: rows.length,
        sourceRequests, pageBodies: capture.pages.map(page => ({ url: page.url, receivedAt: page.receivedAt, sha256: page.sha256, bytes: page.bytes })),
        captureDirectory: capture.directory, authoringCaptureRestored: true, completeReopenRequests: 0 },
      analysis: { reviewId: review.reviewId, reviewSha256: review.reviewSha256,
        analysisSha256: review.analysis.analysisSha256, current: series.current, baseline: series.baseline, change: series.change },
      edition: { editionId: edition.editionId, snapshot: edition.snapshot, rowCount: edition.rowCount,
        exportedDirectory: exportedEdition, exportedCaptureDirectory: join(exportedEdition, 'capture') },
      commerce: { mode: 'ORIGINAL_LOCAL_PROTOCOL_FIXTURE', nativeMerchantMode: merchant.mode,
        nativePilotStatus: merchantStatus, facilitator: { ...facilitator.counts }, transport: { ...transport.counts },
        purchases: purchases.length, pages: pageDeliveries, deliveredObservations: delivered.length,
        sourceFile: { path: originalFile.path, sha256: sourcePurchase.metadata.sha256 },
        retainedBuyerReopenRequests: 0, retainedBuyerReopenSettlements: 0 },
      reports: exportedReviews,
    };
    await atomicJson(root, 'result.json', result);
    return result;
  } catch (error) {
    await atomicJson(root, 'failure.json', { status: 'FAILED', stage, at: new Date().toISOString(), ...publicError(error) }).catch(() => {});
    throw error;
  } finally {
    await transport?.close(); await merchant?.close(); await facilitator?.close();
    await project?.close(); await source?.close();
  }
}

const PTY_DRIVER = [
  "# Original SF81 acceptance.py PTY method, scoped to this six-purchase local fixture.",
  "import json, os, pty, re, select, signal, sys, time",
  "node, script, directory = sys.argv[1:4]",
  "source = sys.argv[4] if len(sys.argv) > 4 else None",
  "command = [node, script, '--fixture-tty-child', '--directory', directory, '--python', sys.executable]",
  "if source: command += ['--source-bundle', source]",
  "pid, fd = pty.fork()",
  "if pid == 0:",
  "    os.execve(node, command, os.environ.copy())",
  "transcript = bytearray()",
  "scanned = 0",
  "approvals = 0",
  "status = None",
  "prompt = re.compile(rb'To authorize ONE fresh reservation, type exactly: (APPROVE [0-9a-f]{16})')",
  "def terminate(_signal, _frame):",
  "    raise InterruptedError('Local journey interrupted')",
  "signal.signal(signal.SIGTERM, terminate)",
  "try:",
  "    deadline = time.monotonic() + 600",
  "    while time.monotonic() < deadline:",
  "        ready, _, _ = select.select([fd], [], [], 0.1)",
  "        if ready:",
  "            try: chunk = os.read(fd, 65536)",
  "            except OSError: break",
  "            if not chunk: break",
  "            transcript.extend(chunk)",
  "            if len(transcript) > 2097152:",
  "                raise RuntimeError('Local fixture transcript exceeded 2 MiB')",
  "            for match in prompt.finditer(transcript, scanned):",
  "                if approvals >= 6:",
  "                    raise RuntimeError('Unexpected extra local fixture reservation')",
  "                os.write(fd, match.group(1) + b'\\n')",
  "                approvals += 1",
  "                scanned = match.end()",
  "        ended, value = os.waitpid(pid, os.WNOHANG)",
  "        if ended:",
  "            status = value",
  "            break",
  "finally:",
  "    if status is None:",
  "        ended, value = os.waitpid(pid, os.WNOHANG)",
  "        if ended: status = value",
  "        else:",
  "            os.killpg(pid, signal.SIGTERM)",
  "            ended, value = os.waitpid(pid, 0)",
  "            status = value",
  "    os.close(fd)",
  "    output = os.open(os.path.join(directory, 'local-fixture-transcript.log'),",
  "                     os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)",
  "    with os.fdopen(output, 'wb') as file: file.write(transcript)",
  "sys.exit(os.waitstatus_to_exitcode(status))"
].join('\n');

function argumentsOf(args) {
  const result = {};
  for (let index = 0; index < args.length; index++) {
    const key = args[index];
    if (key === '--help' || key === '-h') { result.help = true; continue; }
    if (key === '--fixture-tty-child') { result.child = true; continue; }
    const name = { '--directory': 'directory', '--source-bundle': 'sourceBundle', '--python': 'python' }[key];
    if (!name || result[name] !== undefined || !args[index + 1] || args[index + 1].startsWith('--'))
      throw new Error('Use --directory PATH, optional --source-bundle PATH, and optional --python ABSOLUTE_PATH.');
    result[name] = args[++index];
  }
  return result;
}

async function main(args) {
  const options = argumentsOf(args);
  if (options.help) {
    process.stdout.write('Usage: node journey.mjs --directory /absolute/new-journey [--source-bundle /absolute/original-source.json] [--python /absolute/python3]\n');
    return;
  }
  assert(options.directory, 'Choose a new retained journey directory.');
  options.directory = resolve(options.directory);
  if (options.sourceBundle) options.sourceBundle = resolve(options.sourceBundle);
  if (options.child) {
    await runWaterJourney(options);
    return;
  }
  await mkdir(options.directory, { mode: 0o700 });
  const python = options.python ?? (await execFile('python3', ['-I', '-c', 'import sys; print(sys.executable)'])).stdout.trim();
  const child = spawn(python, ['-I', '-B', '-c', PTY_DRIVER, process.execPath,
    fileURLToPath(import.meta.url), options.directory, ...(options.sourceBundle ? [options.sourceBundle] : [])],
  { shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
  let diagnostic = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => {
    diagnostic = (diagnostic + bytes.toString('utf8')).slice(-8192);
  });
  const stop = () => child.kill('SIGTERM');
  process.once('SIGTERM', stop); process.once('SIGINT', stop);
  let exit;
  try {
    exit = await new Promise((done, reject) => { child.once('error', reject); child.once('close', (code, signal) => done({ code, signal })); });
  } finally { process.off('SIGTERM', stop); process.off('SIGINT', stop); }
  if (exit.code !== 0) {
    let failure = null;
    try { failure = JSON.parse(await readFile(join(options.directory, 'failure.json'))); } catch {}
    process.stdout.write(json({ status: 'FAILED', directory: options.directory, exitCode: exit.code,
      signal: exit.signal, failure, ...(failure ? {} : { diagnostic }) }));
    process.exitCode = 1; return;
  }
  const result = JSON.parse(await readFile(join(options.directory, 'result.json')));
  assert.equal(result.status, 'PASS');
  process.stdout.write(json({ status: result.status, result: join(options.directory, 'result.json'),
    sourceMode: result.sourceMode, sourcePages: result.source.pages, observations: result.source.observations,
    captureSha256: result.source.captureSha256, editionId: result.edition.editionId,
    snapshot: result.edition.snapshot, nativePurchases: result.commerce.purchases,
    exportedEdition: result.edition.exportedDirectory, currentMean: result.analysis.current.mean.value,
    baselineMean: result.analysis.baseline.mean.value, meanChange: result.analysis.change.value }));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(json({ status: 'FAILED', ...publicError(error) })); process.exitCode = 1;
  });
}
