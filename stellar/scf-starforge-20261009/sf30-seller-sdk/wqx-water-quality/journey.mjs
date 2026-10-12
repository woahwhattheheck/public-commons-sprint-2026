// MIT. Original WQX capture -> private sample review -> native SF30/SF88 customer journey.
// Commerce fixture methods are retained from ../usgs-water/journey.mjs,
// ../python/merchant.journey.mjs and ../../sf81-buyer-operator-bridge/acceptance.py.
import assert from 'node:assert/strict';
import { createServer as httpServer, request as httpRequest } from 'node:http';
import { createServer as httpsServer } from 'node:https';
import { connect as connectTcp } from 'node:net';
import { execFile as execFileCallback, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, writeFile, mkdir, rename, cp, chmod, realpath } from 'node:fs/promises';
import { join, resolve, dirname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { privateDirectory, atomicJson } from '../routescan/quota.mjs';
import { writeBytes as writeNativeBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { readCapture, retainedFiles, normalizeSelection, canonicalJson } from './provider.mjs';
import { joinCapture } from './samples.mjs';
import { openWaterQualityProject } from './project.mjs';
import { readQualityEdition, startQualityMerchant, qualityMerchantStatus, prepareQualityPurchase,
  purchaseQualityEdition, reopenQualityPurchase, exportQualityPurchase } from './merchant.mjs';
import { Buyer } from '../../sf88-operator-buyer-cli/node/client.mjs';

const execFile = promisify(execFileCallback);
const ORIGIN = 'https://wqx-journey.example';
const FIXTURE_TRANSACTION = 'LOCAL_CONTROLLED_NOT_A_TRANSACTION';
const NATIVE_BUYER_TIMEOUT_MS = 90000;
const EXPECTED_ROWS = 1035, EXPECTED_CAPTURE = 'cbb29504ab01598cddb21bde33c918ca92075aad7f53fdac4fb07581371d29d7';
const SELECTION = Object.freeze({ filters: { providers: ['NWIS'], siteid: ['USGS-01646580'], startDateLo: '01-01-2025', startDateHi: '03-31-2025' },
  profiles: ['Station', 'Activity', 'Result'], partition: 'none' });
const OPTIONS = Object.freeze({ window: { start: '2025-03-01', end: '2025-03-31' },
  baselineWindow: { start: '2025-01-01', end: '2025-01-31' }, includeEstimated: false, characteristics: [], siteIds: [], allowedQualifiers: [] });
const PAYMENT = Object.freeze({ scheme: 'exact', network: 'stellar:testnet', asset: 'C' + 'A'.repeat(55),
  payTo: 'G' + 'A'.repeat(55), amount: '7', maxTimeoutSeconds: 60 });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const equal = (a, b, label) => assert.equal(canonicalJson(a), canonicalJson(b), label);
const publicError = error => ({ code: error?.code ?? error?.name ?? 'WQX_JOURNEY_FAILED', message: String(error?.message ?? error).slice(0, 1400) });

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
    '-subj', '/CN=wqx-journey.example', '-addext', 'subjectAltName=DNS:wqx-journey.example',
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
    if (request.url !== 'wqx-journey.example:443') {
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


/** Receive the exact compressed native capture graph, with original private files. */
export async function receiveQualityCaptureBundle(file, directory) {
  directory = await privateDirectory(resolve(directory));
  const bytes = await readFile(resolve(file)), bundle = JSON.parse(bytes);
  assert.equal(bundle.schema, 'starforge.wqx-capture-bundle.v1');
  assert.equal(bundle.encoding, 'gzip+base64');
  const compressed = Buffer.from(bundle.content, 'base64');
  assert.equal(compressed.toString('base64'), bundle.content);
  if (bundle.compressedBytes !== undefined) assert.equal(compressed.length, bundle.compressedBytes);
  if (bundle.compressedSha256) assert.equal(sha(compressed), bundle.compressedSha256);
  const members = JSON.parse(gunzipSync(compressed, { maxOutputLength: 96 * 1024 * 1024 }));
  assert(Array.isArray(members) && members.length > 0 && members.length <= 4096);
  const paths = new Set(); let total = 0;
  for (const item of [...members].sort((a, b) => Number(a.path === 'capture.json') - Number(b.path === 'capture.json'))) {
    assert.equal(typeof item.path, 'string');
    assert(item.path && !item.path.includes('\\') && !item.path.includes('\0') && !item.path.split('/').some(part => !part || part === '.' || part === '..'));
    const target = resolve(directory, item.path); assert(target.startsWith(directory + sep)); assert(!paths.has(item.path)); paths.add(item.path);
    assert(Number.isSafeInteger(item.bytes) && item.bytes >= 0);
    total += item.bytes; assert(total <= 64 * 1024 * 1024);
    const content = Buffer.from(item.base64, 'base64'); assert.equal(content.toString('base64'), item.base64);
    assert.equal(content.length, item.bytes); assert.equal(sha(content), item.sha256);
    await privateDirectory(dirname(target));
    try { await writeNativeBytes(target, content, { exclusive: true }); }
    catch (error) { if (error.code !== 'EEXIST') throw error; assert.equal(await realpath(target), target); assert.deepEqual(await readFile(target), content); }
  }
  assert(paths.has('capture.json'));
  const capture = await readCapture(directory), files = await retainedFiles(capture);
  assert.equal(capture.captureSha256, bundle.captureSha256); assert.equal(capture.selectionSha256, bundle.selectionSha256);
  equal(files.map(item => item.path).sort(), [...paths].sort(), 'The carrier contains the complete original capture graph.');
  return { capture, sourceBundleSha256: sha(bytes), files: files.length, bytes: total };
}

/** One full cohort delivery, private review receiving, and original native recovery. */
export async function runWaterQualityJourney({ directory, sourceBundle, captureDirectory, python, pageSize = 25, browser = false, deferBrowser = false, playwrightModule, browserExecutable } = {}) {
  const root = await privateDirectory(resolve(directory));
  assert(Number.isSafeInteger(pageSize) && pageSize >= 1 && pageSize <= 100);
  const pythonPath = python ?? (await execFile('python3', ['-I', '-c', 'import sys; print(sys.executable)'])).stdout.trim();
  await atomicJson(root, 'journey-operation.json', { schema: 'starforge.wqx-water-quality-journey.v1', startedAt: new Date().toISOString(),
    selection: SELECTION, reviewOptions: OPTIONS, pageSize, browserRequested: browser || deferBrowser,
    commerce: 'ORIGINAL_LOCAL_PROTOCOL_FIXTURE' }, { exclusive: true });
  const exportsDirectory = await privateDirectory(join(root, 'exports')), fixtureDirectory = await privateDirectory(join(root, 'local-fixture'));
  let project, receiver, facilitator, merchant, transport, stage = 'retained-source', sourceRequests = 0;
  const originalOnly = { async request() { sourceRequests++; throw new Error('The retained complete capture attempted another source request.'); } };
  try {
    const receivedSource = captureDirectory ? { capture: await readCapture(resolve(captureDirectory)) } :
      await receiveQualityCaptureBundle(sourceBundle ?? fileURLToPath(new URL('./examples/potomac-2025-q1.source.json', import.meta.url)), join(root, 'upstream-capture'));
    const upstream = receivedSource.capture;
    assert.equal(upstream.status, 'COMPLETE'); assert.equal(upstream.captureSha256, EXPECTED_CAPTURE);
    equal(upstream.selection, normalizeSelection(SELECTION), 'Use the original Chain Bridge quarter selection.');
    project = await openWaterQualityProject(join(root, 'project'), { transport: originalOnly });
    const imported = await project.importCapture({ sourceDirectory: upstream.directory, title: 'Chain Bridge water quality — March review', expectedRevision: 0 });
    const saved = await project.read(), capture = await project.capture(imported.operationId), model = await joinCapture(capture), rows = model.rows;
    assert.equal(rows.length, EXPECTED_ROWS); assert.equal(model.activities.length, 13); assert.equal(model.stations.length, 1);
    assert.equal(model.issues.length, 0);
    const originalKey = row => JSON.stringify([row.id, row.source.sha256, row.source.index]);
    const expectedRows = new Map(rows.map(row => [originalKey(row), row])); assert.equal(expectedRows.size, rows.length);
    const reopened = await project.acquire({ operationId: imported.operationId, expectedRevision: saved.revision });
    assert.equal(reopened.captureSha256, capture.captureSha256); assert.equal(sourceRequests, 0);

    stage = 'scientific-review';
    const full = await project.analyze({ captureId: imported.operationId });
    assert.equal(full.analysis.inventory.selectedRows, EXPECTED_ROWS);
    assert.equal(full.analysis.inventory.censored, 452); assert.equal(full.analysis.inventory.qualified, 146);
    assert.equal(full.analysis.inventory.estimated, 10);
    const review = await project.saveReview({ reviewId: 'march-versus-january', captureId: imported.operationId, options: OPTIONS,
      note: 'Review March sample results against January within the original measurement groups. Keep reported detection limits and source qualifier codes beside each result. The edition contains the complete January–March captured cohort; this saved analysis uses the selected March window and January baseline.',
      expectedCaptureSha256: capture.captureSha256 });
    equal(await project.readReview(review.reviewId), review, 'The saved review reopens unchanged.');
    assert(review.analysis.inventory.selectedRows > 0 && review.analysis.inventory.selectedRows < EXPECTED_ROWS);
    const inspected = review.analysis.observations.find(row => row.analysis.censoring !== 'none' && row.limits.length);
    assert(inspected);
    const original = await project.readResult({ captureId: capture.operationId, resultId: inspected.id, sourceSha256: inspected.source.sha256,
      sourceIndex: inspected.source.index, expectedCaptureSha256: capture.captureSha256 });
    equal(original.record, expectedRows.get(originalKey(inspected)).record, 'The compact review opens its exact original result.');
    assert(original.stationRecords.length && original.activityRecords.length && original.limits.length);
    const reports = [];
    for (const format of ['html', 'json', 'csv', 'geojson']) {
      const output = await project.exportReview({ reviewId: review.reviewId, format });
      await sourceFile(join(exportsDirectory, output.filename), output.bytes);
      reports.push({ format, file: output.filename, bytes: output.bytes.length, sha256: sha(output.bytes) });
    }

    stage = 'private-review-receive';
    const packed = await project.exportReviewBundle({ reviewId: review.reviewId });
    await sourceFile(join(exportsDirectory, packed.filename), packed.bytes);
    receiver = await openWaterQualityProject(join(root, 'received-review'), { transport: originalOnly });
    const receivedReview = await receiver.receiveReviewBundle({ bundle: JSON.parse(packed.bytes) });
    equal(receivedReview.review, review, 'The complete private review opens with the original decision.');
    assert.equal((await receiver.capture(review.captureId)).captureSha256, capture.captureSha256);
    equal(await receiver.readResult({ captureId: capture.operationId, resultId: inspected.id, sourceSha256: inspected.source.sha256,
      sourceIndex: inspected.source.index, expectedCaptureSha256: capture.captureSha256 }), original, 'Original joined detail survives complete review receiving.');
    assert.equal((await receiver.receiveReviewBundle({ bundle: JSON.parse(packed.bytes) })).archiveSha256, receivedReview.archiveSha256);
    await receiver.close(); receiver = null;

    stage = 'native-edition';
    const edition = await project.prepareEdition({ editionId: 'potomac-q1-water-quality', reviewId: review.reviewId });
    assert.equal(edition.captureSha256, capture.captureSha256); assert.equal(edition.rowCount, EXPECTED_ROWS);
    await project.stageEdition({ editionId: 'potomac-q1-water-quality', origin: ORIGIN, path: '/water-quality', payment: PAYMENT });
    facilitator = await localFacilitator();
    merchant = await startQualityMerchant({ editionDirectory: edition.directory, port: 0, facilitator: facilitator.url, allowLocalFacilitator: true });
    const nativeMerchantStatus = await qualityMerchantStatus(edition.directory);
    transport = await localMerchantTransport(fixtureDirectory, merchant.url ?? merchant.merchantUrl);

    stage = 'native-customer';
    const policy = { schema: 'stellar-spend-governor/v1', assets: [{ network: PAYMENT.network, asset: PAYMENT.asset,
      max_single: '100', max_total: '10000', max_per_utc_day: '10000', max_per_actor_utc_day: '10000', max_per_service_utc_day: '10000' }] };
    const policyPath = join(fixtureDirectory, 'policy.json'), signerPath = join(fixtureDirectory, 'signer.mjs');
    await sourceFile(policyPath, json(policy));
    await sourceFile(signerPath, 'export async function sign({ challenge, accepted }) {\n' +
      '  return { x402Version: 2, resource: challenge.resource, accepted,\n' +
      '    payload: { transaction: ' + JSON.stringify(FIXTURE_TRANSACTION) + ' }, extensions: challenge.extensions };\n}\n');
    const keys = Object.fromEntries(['SF36_CONSENT_KEY_B64', 'SF36_AUDIT_KEY_B64', 'SF36_OPERATOR_KEY_B64'].map(name => [name, randomBytes(32).toString('base64')]));
    const buyerConfig = {
      runtimeDirectory: fileURLToPath(new URL('../../sf88-operator-buyer-cli/', import.meta.url)), stateDirectory: join(root, 'buyer'),
      operatorProfile: { operator: { python: pythonPath, actor: 'wqx-journey', service: 'wqx-water-quality', policy: policyPath, ledger: join(fixtureDirectory, 'ledger.sqlite') },
        signerModule: signerPath, buyerTransport: transport.buyerTransport },
      environment: { ...process.env, ...keys, NODE_EXTRA_CA_CERTS: transport.certFile }, timeoutMs: NATIVE_BUYER_TIMEOUT_MS
    };
    const buyer = await new Buyer(buyerConfig).ready();
    // Retain only the fixture-specific additions; ordinary runtime variables stay with their host.
    await sourceFile(join(fixtureDirectory, 'buyer-config.json'), json({ ...buyerConfig, environment: { ...keys, NODE_EXTRA_CA_CERTS: transport.certFile } }));
    const purchases = [], pages = [], delivered = new Map(); let previous = null, pageNumber = 0;
    do {
      pageNumber++;
      const prepared = await prepareQualityPurchase({ editionDirectory: edition.directory, intentId: 'wqx-journey-page-' + String(pageNumber).padStart(4, '0'),
        query: { limit: String(pageSize), sort: 'date', ...(previous ? { cursor: previous.nextCursor } : {}) }, previous });
      if (pageNumber === 1) {
        const target = new URL(prepared.url), unsigned = await fetch((merchant.url ?? merchant.merchantUrl) + target.pathname + target.search, { signal: AbortSignal.timeout(10000) });
        assert.equal(unsigned.status, 402);
        const challenge = JSON.parse(Buffer.from(unsigned.headers.get('payment-required'), 'base64'));
        assert.equal(challenge.x402Version, 2); assert.equal(challenge.accepts[0].network, PAYMENT.network); assert.equal(challenge.accepts[0].amount, PAYMENT.amount);
        await unsigned.arrayBuffer(); assert.equal(facilitator.counts.verified, 0);
        await sourceFile(join(exportsDirectory, 'unsigned-402.json'), json({ status: 402, challenge }));
      }
      const page = await purchaseQualityEdition({ buyer, prepared });
      assert.equal(page.metadata.snapshot, edition.snapshot); assert.equal(page.result.native.mode, 'ORIGINAL_OPERATOR_APPROVED_BUYER_ATTEMPT');
      const file = 'purchased-results-' + String(pageNumber).padStart(4, '0') + '.json'; await page.result.saveAs(join(exportsDirectory, file));
      for (const row of page.rows) {
        const source = JSON.parse(row.source_json), key = JSON.stringify([row.id, source.sha256, source.index]), original = expectedRows.get(key);
        assert(original && !delivered.has(key), 'Every original result is delivered exactly once.');
        const values = JSON.parse(row.values_json);
        for (const [name, value] of Object.entries(values)) equal(value, original[name] ?? null, 'Original normalized value ' + name);
        equal(JSON.parse(row.record_json), original.record, 'Every original Result field survives native delivery.');
        equal(JSON.parse(row.limits_json), original.limits, 'Every returned detection limit survives native delivery.');
        equal(JSON.parse(row.station_records_json), original.stationRecords, 'Original Station joins survive native delivery.');
        equal(JSON.parse(row.activity_records_json), original.activityRecords, 'Original Activity joins survive native delivery.');
        delivered.set(key, { id: row.id, source });
      }
      purchases.push(page); pages.push({ intentId: page.intentId, file, status: page.result.status, metadata: page.metadata,
        response: { sha256: page.result.delivery.sha256, bytes: page.result.delivery.bytes } });
      previous = page.metadata;
    } while (previous.nextCursor !== null);
    assert.equal(delivered.size, EXPECTED_ROWS);
    const resultResource = capture.resources.find(resource => resource.profile === 'Result' && resource.dataAvailable);
    const originalFile = edition.downloads.find(item => item.path === 'capture/' + resultResource.bodyFile); assert(originalFile);
    const sourcePurchase = await purchaseQualityEdition({ buyer, prepared: await prepareQualityPurchase({ editionDirectory: edition.directory,
      intentId: 'wqx-journey-original-csv', kind: 'source', file: originalFile.path }) });
    assert.equal(sourcePurchase.metadata.sha256, originalFile.sha256);
    assert.equal(sourcePurchase.metadata.contentType, originalFile.contentType);
    assert.deepEqual(await sourcePurchase.result.bytes({ limit: originalFile.bytes }), await readFile(join(edition.directory, originalFile.path)));
    await sourcePurchase.result.saveAs(join(exportsDirectory, 'purchased-original-result.csv')); purchases.push(sourcePurchase);
    const editionPurchase = await purchaseQualityEdition({ buyer, prepared: await prepareQualityPurchase({ editionDirectory: edition.directory, intentId: 'wqx-journey-edition', kind: 'edition' }) });
    assert.equal(editionPurchase.value.editionId, edition.editionId);
    await editionPurchase.result.saveAs(join(exportsDirectory, 'purchased-edition.json')); purchases.push(editionPurchase);
    assert.equal(facilitator.counts.settled, purchases.length);

    stage = 'portable-native-reopen';
    await project.close(); project = null;
    const relocatedCapture = join(root, 'relocated-source-capture'); await rename(capture.directory, relocatedCapture);
    const exportedEdition = join(exportsDirectory, 'water-quality-edition');
    await cp(edition.directory, exportedEdition, { recursive: true, force: false, errorOnExist: true, dereference: false });
    const portable = await readQualityEdition(exportedEdition); assert.equal(portable.editionId, edition.editionId); assert.equal(portable.snapshot, edition.snapshot);
    assert.equal((await readCapture(join(exportedEdition, 'capture'))).captureSha256, capture.captureSha256);
    const before = { requests: transport.counts.requests, settlements: facilitator.counts.settled };
    for (const purchase of purchases) {
      const retained = await reopenQualityPurchase({ buyer, intentId: purchase.intentId, editionDirectory: exportedEdition });
      assert.equal(retained.result.delivery.sha256, purchase.result.delivery.sha256);
      equal(retained.metadata, purchase.metadata, 'The original native delivery metadata reopens unchanged.');
    }
    const originalDownload = await exportQualityPurchase({ buyer, intentId: sourcePurchase.intentId, editionDirectory: exportedEdition });
    assert.equal(sha(originalDownload.bytes), originalFile.sha256);
    assert.equal(transport.counts.requests, before.requests); assert.equal(facilitator.counts.settled, before.settlements); assert.equal(sourceRequests, 0);
    await rename(relocatedCapture, capture.directory);
    const result = {
      schema: 'starforge.wqx-water-quality-journey.v1', status: 'PASS', completedAt: new Date().toISOString(), directory: root,
      sourceMode: 'RETAINED_ORIGINAL_WQX_CAPTURE', sourceBundleSha256: receivedSource.sourceBundleSha256 ?? null,
      source: { operationId: capture.operationId, captureSha256: capture.captureSha256, selection: capture.selection, observations: rows.length,
        stations: model.stations.length, activities: model.activities.length, limits: model.summary.embeddedDetectionLimits,
        captureDirectory: capture.directory, sourceRequests, authoringCaptureRestored: true,
        resources: capture.resources.map(resource => ({ profile: resource.profile, url: resource.url, status: resource.responseStatus,
          rows: resource.rowCount, bytes: resource.bytes, sha256: resource.sha256, receivedAt: resource.receivedAt })) },
      analysis: { reviewId: review.reviewId, reviewSha256: review.reviewSha256, wholeCaptureInventory: full.analysis.inventory,
        selectedReviewInventory: review.analysis.inventory, options: review.requestedOptions,
        comparableGroups: review.analysis.comparison.filter(value => value.comparable).length },
      privateReview: { archiveSha256: receivedReview.archiveSha256, files: receivedReview.files, bytes: receivedReview.bytes, directory: join(root, 'received-review') },
      edition: { editionId: edition.editionId, snapshot: edition.snapshot, rowCount: edition.rowCount, exportedDirectory: exportedEdition,
        memberBytes: edition.files.reduce((total, file) => total + file.bytes, 0),
        files: edition.files.map(({ path, role, sha256, bytes }) => ({ path, role, sha256, bytes })),
        directDownloadBytes: edition.downloads.reduce((total, file) => total + file.bytes, 0) },
      commerce: { mode: 'ORIGINAL_LOCAL_PROTOCOL_FIXTURE', nativeMerchantStatus, purchases: purchases.length, pages, deliveredResults: delivered.size,
        facilitator: { ...facilitator.counts }, transport: { ...transport.counts }, sourceFile: { path: originalFile.path, sha256: originalFile.sha256, bytes: originalFile.bytes },
        retainedBuyerReopenRequests: 0, retainedBuyerReopenSettlements: 0 }, reports, browser: null
    };
    stage = 'native-completion';
    const { writeWaterQualityNativeCheckpoint, resumeWaterQualityBrowser } = await import('./browser-resume.mjs');
    await writeWaterQualityNativeCheckpoint({ directory: root, result, projectSnapshot: saved });
    // The native PTY can exit before Chromium is launched. All browser calls reopen
    // this original Buyer journal; the local merchant/facilitator may be closed.
    if (deferBrowser) return result;
    if (browser) {
      stage = 'browser';
      await resumeWaterQualityBrowser({ directory: root, playwrightModule, browserExecutable });
      return JSON.parse(await readFile(join(root, 'result.json')));
    }
    await atomicJson(root, 'result.json', result); return result;
  } catch (error) {
    await atomicJson(root, 'failure.json', { status: 'FAILED', stage, at: new Date().toISOString(), ...publicError(error) }).catch(() => {}); throw error;
  } finally { await transport?.close(); await merchant?.close(); await facilitator?.close(); await receiver?.close(); await project?.close(); }
}

const PTY_DRIVER = [
  "# Original SF81 acceptance.py terminal method for this disposable local commerce fixture.",
  "import json, os, pty, re, select, signal, sys, time",
  "node, script, directory, options_json = sys.argv[1:5]",
  "options = json.loads(options_json)",
  "command = [node, script, '--fixture-tty-child', '--directory', directory, '--python', sys.executable, '--page-size', str(options['pageSize'])]",
  "for key, flag in [('sourceBundle','--source-bundle'),('captureDirectory','--capture'),('playwrightModule','--playwright-module'),('browserExecutable','--browser-executable')]:",
  "    if options.get(key): command += [flag, options[key]]",
  "if options.get('browser'): command += ['--defer-browser']",
  "approval_limit = (1035 + options['pageSize'] - 1) // options['pageSize'] + 2",
  "pid, fd = pty.fork()",
  "if pid == 0: os.execve(node, command, os.environ.copy())",
  "transcript = bytearray(); scanned = 0; approvals = 0; status = None",
  "prompt = re.compile(rb'To authorize ONE fresh reservation, type exactly: (APPROVE [0-9a-f]{16})')",
  "def terminate(_signal, _frame): raise InterruptedError('Local journey interrupted')",
  "signal.signal(signal.SIGTERM, terminate)",
  "try:",
  "    deadline = time.monotonic() + max(600, approval_limit * options['nativeOperationTimeoutMs'] / 1000 + 300)",
  "    while time.monotonic() < deadline:",
  "        ready, _, _ = select.select([fd], [], [], 0.1)",
  "        if ready:",
  "            try: chunk = os.read(fd, 65536)",
  "            except OSError: break",
  "            if not chunk: break",
  "            transcript.extend(chunk)",
  "            if len(transcript) > 16777216: raise RuntimeError('Local fixture transcript exceeded 16 MiB')",
  "            for match in prompt.finditer(transcript, scanned):",
  "                if approvals >= approval_limit: raise RuntimeError('Unexpected extra local fixture reservation')",
  "                os.write(fd, match.group(1) + b'\\n'); approvals += 1; scanned = match.end()",
  "        ended, value = os.waitpid(pid, os.WNOHANG)",
  "        if ended: status = value; break",
  "finally:",
  "    if status is None:",
  "        ended, value = os.waitpid(pid, os.WNOHANG)",
  "        if ended: status = value",
  "        else:",
  "            os.killpg(pid, signal.SIGTERM); ended, value = os.waitpid(pid, 0); status = value",
  "    os.close(fd)",
  "    output = os.open(os.path.join(directory, 'local-fixture-transcript.log'), os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)",
  "    with os.fdopen(output, 'wb') as file: file.write(transcript)",
  "sys.exit(os.waitstatus_to_exitcode(status))"
].join('\n');
function argumentsOf(args) {
  const result = { pageSize: 25 };
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (flag === '--help' || flag === '-h') { result.help = true; continue; }
    if (flag === '--fixture-tty-child') { result.child = true; continue; }
    if (flag === '--browser') { result.browser = true; continue; }
    if (flag === '--resume-browser') { result.resumeBrowser = true; continue; }
    if (flag === '--defer-browser') { result.deferBrowser = true; continue; }
    const key = { '--directory': 'directory', '--source-bundle': 'sourceBundle', '--capture': 'captureDirectory', '--python': 'python',
      '--page-size': 'pageSize', '--playwright-module': 'playwrightModule', '--browser-executable': 'browserExecutable' }[flag];
    if (!key || (key !== 'pageSize' && result[key] !== undefined) || !args[i + 1] || args[i + 1].startsWith('--'))
      throw new Error('Use --directory PATH, --source-bundle FILE or --capture DIRECTORY, optional --page-size N, and --browser.');
    result[key] = key === 'pageSize' ? Number(args[++i]) : args[++i];
  }
  assert(!(result.sourceBundle && result.captureDirectory), 'Choose one original retained source carrier.');
  assert(!result.deferBrowser || result.child, '--defer-browser is the original native child continuation.');
  assert(!result.resumeBrowser || !(result.child || result.sourceBundle || result.captureDirectory),
    '--resume-browser uses the existing directory and original buyer configuration.');
  assert(Number.isSafeInteger(result.pageSize) && result.pageSize >= 1 && result.pageSize <= 100);
  return result;
}
export async function main(args = process.argv.slice(2)) {
  const options = argumentsOf(args);
  if (options.help) { process.stdout.write('Usage: node journey.mjs --directory /absolute/new-wqx-journey [--source-bundle FILE | --capture DIRECTORY] [--page-size 25] [--browser --playwright-module PATH --browser-executable PATH]\nResume: node journey.mjs --resume-browser --directory /absolute/existing-wqx-journey [--playwright-module PATH --browser-executable PATH]\n'); return; }
  assert(options.directory, 'Choose a new retained journey directory.'); options.directory = resolve(options.directory);
  for (const key of ['sourceBundle', 'captureDirectory']) if (options[key]) options[key] = resolve(options[key]);
  if (options.child) { await runWaterQualityJourney(options); return; }
  if (options.resumeBrowser) {
    const { resumeWaterQualityBrowser } = await import('./browser-resume.mjs');
    const resumed = await resumeWaterQualityBrowser(options);
    process.stdout.write(json({ status: resumed.status, directory: options.directory,
      browserResult: resumed.browserResult, result: resumed.nativeResult, reused: resumed.reused,
      captureSha256: resumed.originalCaptureSha256, nativePurchases: resumed.nativePurchases }));
    return;
  }
  options.nativeOperationTimeoutMs = NATIVE_BUYER_TIMEOUT_MS;
  await mkdir(options.directory, { mode: 0o700 });
  const python = options.python ?? (await execFile('python3', ['-I', '-c', 'import sys; print(sys.executable)'])).stdout.trim();
  const child = spawn(python, ['-I', '-B', '-c', PTY_DRIVER, process.execPath, fileURLToPath(import.meta.url), options.directory, JSON.stringify(options)],
    { shell: false, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env } });
  let diagnostic = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { diagnostic = (diagnostic + bytes.toString('utf8')).slice(-8192); });
  const stop = () => child.kill('SIGTERM'); process.once('SIGTERM', stop); process.once('SIGINT', stop);
  let exit;
  try { exit = await new Promise((done, reject) => { child.once('error', reject); child.once('close', (code, signal) => done({ code, signal })); }); }
  finally { process.off('SIGTERM', stop); process.off('SIGINT', stop); }
  if (exit.code !== 0) {
    let failure = null; try { failure = JSON.parse(await readFile(join(options.directory, 'failure.json'))); } catch {}
    process.stdout.write(json({ status: 'FAILED', directory: options.directory, exitCode: exit.code, signal: exit.signal, failure, ...(failure ? {} : { diagnostic }) }));
    process.exitCode = 1; return;
  }
  if (options.browser) {
    const { resumeWaterQualityBrowser } = await import('./browser-resume.mjs');
    await resumeWaterQualityBrowser(options);
  }
  const result = JSON.parse(await readFile(join(options.directory, 'result.json'))); assert.equal(result.status, 'PASS');
  process.stdout.write(json({ status: result.status, result: join(options.directory, 'result.json'), sourceMode: result.sourceMode,
    observations: result.source.observations, captureSha256: result.source.captureSha256, editionId: result.edition.editionId,
    snapshot: result.edition.snapshot, nativePurchases: result.commerce.purchases, exportedEdition: result.edition.exportedDirectory,
    receivedReview: result.privateReview.directory, browser: result.browser?.status ?? null }));
}
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) main().catch(error => {
  process.stderr.write(json({ status: 'FAILED', ...publicError(error) })); process.exitCode = 1;
});
