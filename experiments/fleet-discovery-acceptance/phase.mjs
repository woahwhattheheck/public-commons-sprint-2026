// MIT. Complete original SDK fleet → tenant discovery → original buyer preparation.
// Selected by FLEET_CLIENT_DISCOVERY_PHASE after the SDK owner closes its handles.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, chmod, readFile, writeFile, open, rename, unlink, stat, readdir, cp } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const sha = value => createHash('sha256').update(value).digest('hex');
const run = promisify(execFile);
const stable = value => JSON.stringify(value);
const exists = async file => {
  try { await stat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
};
async function save(file, value) {
  const data = Buffer.isBuffer(value) ? value : Buffer.from(JSON.stringify(value, null, 2) + '\n');
  const temporary = file + '.' + randomUUID() + '.tmp'; let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(data); await handle.sync(); await handle.close(); handle = null;
    await rename(temporary, file);
    const folder = await open(dirname(file), 'r'); try { await folder.sync(); } finally { await folder.close(); }
  } finally {
    await handle?.close();
    await unlink(temporary).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
}
const waitFor = async (work, note, timeout = 30000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await work()) return; await new Promise(done => setTimeout(done, 80)); }
  throw new Error(note);
};
const absent = async url => {
  try { await fetch(url, { signal: AbortSignal.timeout(900) }); return false; } catch { return true; }
};
const listen = server => new Promise((done, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', done); });
const closeServer = server => new Promise((done, fail) => {
  if (!server?.listening) return done();
  server.close(error => error ? fail(error) : done()); server.closeIdleConnections();
});
const resourceURL = row => typeof row.resource === 'string' ? row.resource : row.resource?.url;
const originalAmount = row => row.payment?.[0]?.amount;
const query = value => new URLSearchParams(value).toString();

export async function runFleetDiscoveryPhase({ source, base, directory, planFile, receiptFile, receipt: sdkReceipt }) {
  source = resolve(source); base = resolve(base); directory = resolve(directory); planFile = resolve(planFile);
  assert.equal(sdkReceipt.state, 'PASS'); assert.equal(sdkReceipt.ownedProcessesClosed, true);
  const sdkBytes = await readFile(receiptFile), sdkReceiptSha256 = sha(sdkBytes), planBytes = await readFile(planFile);
  assert.deepEqual(JSON.parse(sdkBytes), sdkReceipt);
  const output = join(base, 'discovery'); await mkdir(output, { recursive: true, mode: 0o700 }); await chmod(output, 0o700);
  const outputReceipt = join(output, 'receipt.json');
  let receipt;
  try { receipt = JSON.parse(await readFile(outputReceipt, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    receipt = { schema: 'scratch.fleet-discovery-journey.v1', state: 'RUNNING', source, base, directory, planFile,
      sdkReceiptSha256, planFileSha256: sha(planBytes), milestones: [], browserErrors: [], providerReads: [], enrollments: {} };
  }
  assert.equal(receipt.sdkReceiptSha256, sdkReceiptSha256, 'Reuse the completed original SDK receipt.');
  assert.equal(receipt.planFileSha256, sha(planBytes), 'Keep the original fixed-store plan unchanged.');
  if (receipt.state === 'PASS' && receipt.ownedProcessesClosed) return structuredClone(receipt);
  receipt.state = 'RUNNING'; delete receipt.failure; receipt.ownedProcessesClosed = false; await save(outputReceipt, receipt);
  const record = async (id, values = {}) => {
    const item = { id, at: new Date().toISOString(), ...values };
    const previous = receipt.milestones.findIndex(row => row.id === id);
    if (previous < 0) receipt.milestones.push(item); else receipt.milestones[previous] = item;
    await save(outputReceipt, receipt); console.log(JSON.stringify({ discoveryPhase: id, ...values }));
  };
  const sdk = join(source, 'stellar/scf-starforge-20261009'), fleet = join(sdk, 'merchant-fleet-gateway');
  const { readFleetReleasePlan, openFleetReleaseOperator } = await import(pathToFileURL(join(fleet, 'release-operator.mjs')).href);
  const { startFleetWorkspace } = await import(pathToFileURL(join(fleet, 'workspace/server.mjs')).href);
  const { dispatchFleetCommand } = await import(pathToFileURL(join(fleet, 'release-cli.mjs')).href);
  const { stageRelease, inspectRelease, listReleases } = await import(pathToFileURL(join(sdk, 'sf82-seller-pilot/releases.mjs')).href);
  const { preparePythonRelease } = await import(pathToFileURL(join(sdk, 'sf82-seller-pilot/release-python.mjs')).href);
  const { prepareReview } = await import(pathToFileURL(join(sdk, 'sf88-operator-buyer-cli/prepare.mjs')).href);
  const { startMerchantMcp } = await import(pathToFileURL(join(source, 'stellar-forge/mcp-merchant-operator/serve.mjs')).href);
  const nativePlan = await readFleetReleasePlan(planFile);
  const pythonTenant = nativePlan.tenants.find(row => row.id === 'python');
  assert(pythonTenant?.slots.blue && pythonTenant?.slots.green);
  const require = createRequire(join(resolve(process.env.FLEET_CLIENT_NODE_MODULES ??
    process.env.CODEX_PRIMARY_RUNTIME_NODE_MODULES ?? join(source, 'node_modules')), 'runtime-loader.cjs'));
  const { chromium } = require('playwright');
  const pythonExecutable = process.env.FLEET_CLIENT_PYTHON ?? process.env.CODEX_PRIMARY_RUNTIME_PYTHON ?? 'python3';
  const rpcPlan = JSON.parse(await readFile(join(base, 'rpc-current/plan.json'), 'utf8'));
  const priorEndpoint = process.env[rpcPlan.endpointEnv];
  const provider = createServer(async (req, res) => {
    try {
      let body = ''; for await (const part of req) body += part;
      const input = JSON.parse(body); receipt.providerReads.push(input.method);
      assert.equal(req.url, '/rpc'); assert.equal(input.method, 'getNetwork'); assert.equal(input.id, 'sf30:getNetwork');
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: input.id,
        result: { passphrase: 'Test SDF Network ; September 2015', protocolVersion: 27 } }));
    } catch { res.writeHead(500); res.end(); }
  });
  let workspace, browser, cli, mcp, page, sessionKey, rpcId = 0, fatal;
  const bearer = randomBytes(32).toString('hex');
  const heldURLs = new Set();
  async function api(path, input, expected = 200) {
    const response = await fetch(workspace.url + '/api/' + path, {
      method: input === undefined ? 'GET' : 'POST',
      headers: { 'x-fleet-workspace': sessionKey, ...(input === undefined ? {} : { 'content-type': 'application/json' }) },
      ...(input === undefined ? {} : { body: JSON.stringify(input) }), signal: AbortSignal.timeout(45000),
    });
    const value = await response.json(); assert.equal(response.status, expected, JSON.stringify(value)); return value;
  }
  const discovery = (tenant, suffix = '', params = {}) => api('releases/discovery' + suffix + '?' + query({ tenant, ...params }));
  const selectedSlot = (value, tenant, name) =>
    (value.releaseStatus ?? value).tenants.find(row => row.id === tenant).slots.find(row => row.name === name);
  const rememberURLs = value => {
    if (value.discoveryOrigin) heldURLs.add(value.discoveryOrigin);
    if (value.consumer?.url) heldURLs.add(value.consumer.url);
    return value;
  };
  async function filesIn(path) {
    const rows = [];
    for (const name of (await readdir(path)).sort()) {
      const file = join(path, name), info = await stat(file);
      if (info.isFile()) rows.push({ name, bytes: info.size, sha256: sha(await readFile(file)) });
      else rows.push({ name, directory: true });
    }
    return rows;
  }
  async function prepareNativeChanges() {
    const target = join(output, 'python-replacement'), declarationFile = join(target, 'merchant.json');
    const original = JSON.parse(await readFile(join(base, 'python-current/merchant.json'), 'utf8'));
    assert(original.functions.summarize && original.functions.amortize);
    const declaration = structuredClone(original);
    delete declaration.functions.amortize; declaration.functions.summarize.payment.amount = '25000';
    if (!await exists(target)) await cp(join(base, 'python-current'), target, { recursive: true, errorOnExist: true, force: false });
    await chmod(target, 0o700);
    if (!receipt.upgrade) {
      await save(declarationFile, declaration);
      const prepared = await preparePythonRelease(declarationFile);
      receipt.upgrade = { releaseId: 'python-discovery-v2', originalReleaseId: 'python-v1',
        sourceSlot: 'blue', targetSlot: 'green', python: prepared.python,
        declarationSha256: sha(await readFile(declarationFile)), desiredAmount: '25000' };
      await save(outputReceipt, receipt);
    }
    const catalog = await listReleases(pythonTenant.slots.green.store);
    assert.deepEqual(catalog.errors, []);
    let release;
    if (catalog.releases.some(row => row.id === receipt.upgrade.releaseId))
      release = await inspectRelease(pythonTenant.slots.green.store, receipt.upgrade.releaseId);
    else {
      assert.equal(sha(await readFile(declarationFile)), receipt.upgrade.declarationSha256);
      release = await stageRelease(pythonTenant.slots.green.store, { id: receipt.upgrade.releaseId,
        label: 'Python catalog revision: summarize price and amortize retirement',
        python: declarationFile, runtime: { port: pythonTenant.slots.green.port } });
    }
    assert.deepEqual(release.python, receipt.upgrade.python);
    assert.equal(release.runtime.port, pythonTenant.slots.green.port);
    assert.equal(release.publicOrigin, 'https://' + pythonTenant.host);
    assert.deepEqual(release.routes.map(row => row.id), ['summarize']);
    if (receipt.upgrade.digest) assert.equal(release.digest, receipt.upgrade.digest);
    receipt.upgrade.digest = release.digest; await save(outputReceipt, receipt);
    await record('original-inactive-release-staged', { releaseId: release.id, digest: release.digest,
      removedRoute: 'amortize', remainingRoute: 'summarize', amount: '25000', planDigest: nativePlan.digest });
  }
  async function retainRealSetupInterruption() {
    const parent = join(directory, 'discovery'), target = join(parent, 'python');
    if (await exists(target)) {
      if (!receipt.recoveryAttempt) throw new Error('The selected Python discovery directory predates this owned journey.');
      if (!receipt.recoveryAttempt.files && !await exists(join(target, 'setup.json'))) {
        const files = await filesIn(target);
        assert(files.some(row => row.name === 'seller-key.pem' && row.bytes > 0));
        receipt.recoveryAttempt.files = files; await save(outputReceipt, receipt);
      }
      return;
    }
    await mkdir(parent, { recursive: true, mode: 0o700 }); await chmod(parent, 0o700);
    receipt.recoveryAttempt ??= { tenant: 'python', sellerId: 'e49-python-discovery', resource: 'RLIMIT_FSIZE',
      limitBytes: 256, releaseId: 'python-v1', dispatchedAt: new Date().toISOString() };
    await save(outputReceipt, receipt);
    const script = "process.on('SIGXFSZ',()=>{});const {createReleaseDiscoverySetup}=await import(" +
      JSON.stringify(pathToFileURL(join(sdk, 'sf82-seller-pilot/release-discovery-setup.mjs')).href) +
      ");try{await createReleaseDiscoverySetup(" + JSON.stringify(pythonTenant.slots.blue.store) +
      ",{directory:" + JSON.stringify(target) + ",releaseId:'python-v1',sellerId:'e49-python-discovery'});" +
      "console.log(JSON.stringify({unexpectedCompletion:true}));process.exitCode=2;}" +
      "catch(error){console.log(JSON.stringify({code:error.code,message:error.message}));if(error.code!=='EFBIG')process.exitCode=3;}";
    const launcher = "import os,resource,signal,sys\nresource.setrlimit(resource.RLIMIT_FSIZE,(256,256))\n" +
      "signal.signal(signal.SIGXFSZ,signal.SIG_IGN)\nos.execv(sys.argv[1],[sys.argv[1],'--input-type=module','-e',sys.argv[2]])";
    const completed = await run(pythonExecutable, ['-c', launcher, process.execPath, script],
      { timeout: 30000, maxBuffer: 32768, env: { ...process.env } });
    const native = JSON.parse(completed.stdout.trim()); assert.equal(native.code, 'EFBIG');
    const files = await filesIn(target);
    assert(files.some(row => row.name === 'seller-key.pem' && row.bytes > 0));
    assert(!files.some(row => row.name === 'setup.json'));
    receipt.recoveryAttempt.native = native; receipt.recoveryAttempt.files = files; await save(outputReceipt, receipt);
    await record('original-setup-file-limit-interruption', { nativeCode: native.code,
      files: files.map(({ name, bytes }) => ({ name, bytes })), limitBytes: 256 });
  }
  async function openBrowser() {
    workspace = await startFleetWorkspace({ releasePlan: planFile, releaseDirectory: directory, port: 0 });
    if (stopRequested) { await workspace.close(); workspace = null; assertRunning(); }
    heldURLs.add(workspace.url);
    sessionKey = (await (await fetch(workspace.url + '/api/session')).json()).session;
    browser = await chromium.launch({
      ...(process.env.FLEET_CLIENT_CHROMIUM ? { executablePath: process.env.FLEET_CLIENT_CHROMIUM } : {}),
      headless: true, args: ['--no-sandbox', '--disable-gpu', '--disable-background-networking', '--renderer-process-limit=1'],
    });
    if (stopRequested) { await browser.close(); browser = null; assertRunning(); }
    page = await browser.newPage({ viewport: { width: 1360, height: 1024 }, acceptDownloads: true });
    page.setDefaultTimeout(30000); page.on('pageerror', error => receipt.browserErrors.push(error.message));
    await page.goto(workspace.url); await page.waitForFunction(() => document.querySelector('#connection').textContent === 'Connected');
    await page.locator('#fleet-discovery').waitFor({ state: 'visible' }); await idle();
  }
  const idle = async () => page.waitForFunction(() =>
    document.querySelector('#connection').textContent === 'Connected' && !document.querySelector('#discovery-refresh').disabled);
  async function selectTenant(tenant) {
    await idle();
    if (await page.locator('#discovery-tenant').inputValue() !== tenant) {
      await page.locator('#discovery-tenant').selectOption(tenant); await idle();
    }
    const response = page.waitForResponse(r => r.request().method() === 'GET' &&
      new URL(r.url()).pathname === '/api/releases/discovery' && new URL(r.url()).searchParams.get('tenant') === tenant);
    await page.locator('#discovery-refresh').click();
    const result = await response; assert.equal(result.status(), 200); await idle();
    return rememberURLs(await result.json());
  }
  async function clickResponse(selector, path, expected = 200) {
    const pending = page.waitForResponse(r => new URL(r.url()).pathname === '/api/releases/discovery' + path &&
      r.request().method() === 'POST');
    await page.locator(selector).click(); const response = await pending;
    const value = await response.json(); assert.equal(response.status(), expected, JSON.stringify(value)); await idle(); return value;
  }
  async function applyReviewed(path) {
    await page.locator('#discovery-apply').click();
    await page.locator('#confirm').waitFor({ state: 'visible' });
    return clickResponse('#confirm-apply', path);
  }
  async function downloadJSON(selector, filename) {
    const pending = page.waitForEvent('download'); await page.locator(selector).click(); const download = await pending;
    const path = join(output, filename); await download.saveAs(path);
    assert.equal(await download.failure(), null);
    const bytes = await readFile(path); await idle();
    return { path, bytes, value: JSON.parse(bytes), sha256: sha(bytes) };
  }
  async function ensureEnrollment(tenant) {
    let state = await selectTenant(tenant);
    if (['NEW', 'INCOMPLETE'].includes(state.state)) {
      const sellerId = 'e49-' + tenant + '-discovery';
      await page.locator('#discovery-seller-id').fill(sellerId);
      const review = await clickResponse('#discovery-review-enrollment', '/enrollment/review');
      assert.equal(review.kind, 'enrollment'); assert.equal(review.enrollment.sellerId, sellerId);
      assert.equal(review.serving.tenant, tenant); assert.equal(review.serving.instanceId, state.serving.instanceId);
      if (state.state === 'INCOMPLETE') {
        assert.equal(review.recovery.inspectionId, state.recovery.inspectionId);
        assert(review.recovery.files.some(row => row.name === 'seller-key.pem'));
        await page.locator('#discovery-recovery').waitFor({ state: 'visible' });
      }
      const reviewed = await downloadJSON('#discovery-download-review', tenant + '-enrollment-review.json');
      assert.deepEqual(reviewed.value, review);
      if (review.recovery) {
        receipt.recoveryAttempt.inspectionId = review.recovery.inspectionId;
        await save(outputReceipt, receipt);
      }
      const created = await applyReviewed('/enrollment/create'); assert.equal(created.decision, 'ENROLLED');
      if (created.recovery) {
        assert(created.recovery.retainedSetupId);
        const retained = await filesIn(join(directory, 'discovery-recovery', created.recovery.retainedSetupId));
        assert.deepEqual(retained, receipt.recoveryAttempt.files, 'Preserve every original partial setup byte.');
        receipt.recoveryAttempt.retainedSetupId = created.recovery.retainedSetupId;
      }
      state = await selectTenant(tenant);
    }
    if (tenant === 'python' && receipt.recoveryAttempt?.inspectionId && !receipt.recoveryAttempt.retainedSetupId) {
      const prefix = 'python--' + receipt.recoveryAttempt.inspectionId.slice(0, 16) + '--';
      const recovered = (await readdir(join(directory, 'discovery-recovery'))).filter(name => name.startsWith(prefix));
      assert.equal(recovered.length, 1);
      assert.deepEqual(await filesIn(join(directory, 'discovery-recovery', recovered[0])), receipt.recoveryAttempt.files);
      receipt.recoveryAttempt.retainedSetupId = recovered[0]; await save(outputReceipt, receipt);
    }
    assert.equal(state.enrollment.sellerId, 'e49-' + tenant + '-discovery');
    const fingerprint = state.enrollment.publicKeySha256;
    if (receipt.enrollments[tenant]) assert.equal(fingerprint, receipt.enrollments[tenant].publicKeySha256);
    receipt.enrollments[tenant] = { sellerId: state.enrollment.sellerId, publicKeySha256: fingerprint,
      source: state.enrollment.source, permissions: state.enrollment.permissions };
    if (state.state !== 'RUNNING') state = rememberURLs(await clickResponse('#discovery-start', '/start'));
    assert.equal(state.state, 'RUNNING'); assert.equal(state.consumer.state, 'RUNNING');
    const publicEnrollment = await downloadJSON('#discovery-download-enrollment', tenant + '-public-enrollment.json');
    assert.equal(publicEnrollment.value.publicKeySha256, fingerprint);
    assert(!JSON.stringify(publicEnrollment.value).includes('PRIVATE KEY'));
    await save(outputReceipt, receipt); return state;
  }
  async function publishCurrent(tenant) {
    const state = await selectTenant(tenant);
    if (state.catalog.rows.some(row => row.state !== 'MATCHES')) {
      const review = await clickResponse('#discovery-review-publish', '/review');
      assert.equal(review.catalog.action, 'publish'); assert.equal(review.permissions.covered, true);
      const applied = await applyReviewed('/apply'); assert.equal(applied.result.decision, 'COMMITTED');
      assert.equal(applied.result.paymentCalls, 0);
    }
    const result = await discovery(tenant); assert(result.catalog.rows.every(row => row.state === 'MATCHES')); return result;
  }
  async function publicRead(selector) {
    const pending = page.waitForResponse(r => r.request().method() === 'GET' &&
      new URL(r.url()).pathname === '/api/releases/discovery/consume');
    await page.locator(selector).click(); const response = await pending;
    assert.equal(response.status(), 200); const value = await response.json(); await idle();
    const request = Object.fromEntries(new URL(response.url()).searchParams); delete request.tenant;
    return { value, request };
  }
  async function nativeBuyerHandover() {
    await selectTenant('python');
    await page.locator('#discovery-limit').fill('1');
    await page.locator('#discovery-network').selectOption('stellar:testnet');
    await page.locator('#discovery-type').selectOption('http');
    await page.locator('#discovery-scheme').fill('exact');
    await page.locator('#discovery-query').fill('');
    const first = await publicRead('#discovery-read-page');
    assert.equal(first.value.page.resources.length, 1); assert.equal(first.value.page.pagination.total, 2);
    const next = await publicRead('#discovery-page-next');
    assert.equal(next.request.offset, '1'); assert.equal(next.value.page.resources.length, 1);
    assert.notEqual(resourceURL(first.value.page.resources[0]), resourceURL(next.value.page.resources[0]));
    await page.locator('#discovery-query').fill('python.fleet.example');
    const searched = await publicRead('#discovery-read-page');
    assert.equal(searched.request.view, 'search');
    let observed = searched;
    if (typeof searched.value.page.pagination.cursor === 'string' && searched.value.page.pagination.cursor) {
      observed = await publicRead('#discovery-page-next');
      assert.equal(observed.request.cursor, searched.value.page.pagination.cursor);
      assert.notEqual(resourceURL(observed.value.page.resources[0]), resourceURL(searched.value.page.resources[0]));
      receipt.opaqueCursor = { supplied: searched.value.page.pagination.cursor, submitted: observed.request.cursor };
    }
    if (!observed.value.page.resources.length) {
      // Use the exact named original operation if the provider does not search origins.
      await page.locator('#discovery-query').fill('summarize'); observed = await publicRead('#discovery-read-page');
    }
    assert(observed.value.page.resources.length);
    const downloaded = await downloadJSON('#discovery-download-page', 'buyer-observed-page.json');
    assert.equal(downloaded.value.schema, 'scf61-observed-native-page-v1');
    assert.deepEqual(downloaded.value.nativeProviderRows, observed.value.page.resources);
    assert.deepEqual(downloaded.value.filterRequest, observed.request);
    assert.deepEqual(downloaded.value.pagination, observed.value.page.pagination);
    assert.equal(downloaded.value.sourceUrl, observed.value.page.sourceUrl);
    assert.equal(downloaded.value.readOnly, true); assert.equal(downloaded.value.paidOrSettled, false);
    const selected = downloaded.value.nativeProviderRows[0], method = selected.extensions?.bazaar?.info?.input?.method;
    assert(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(method));
    const selection = { rowIndex: 0, acceptIndex: 0, intentId: 'e49-discovery-retained-buyer',
      url: resourceURL(selected), method };
    const prepared = prepareReview(downloaded.bytes, selection);
    assert.equal(prepared.draft.preparedFrom.discoveryFileSha256, downloaded.sha256);
    assert.deepEqual(prepared.draft.preparedFrom.originalListing, selected);
    assert.equal(prepared.draft.operation.expect.maxAtomic, selected.accepts[0].amount);
    assert.equal(prepared.draft.operation.expect.payTo, selected.accepts[0].payTo);
    await save(join(output, 'buyer-discovery-review.json'), prepared.data);
    const state = await discovery('python'), popupPending = page.waitForEvent('popup');
    await page.locator('#discovery-buyer-link').click(); const buyer = await popupPending;
    try {
      await buyer.waitForLoadState('domcontentloaded'); assert.equal(buyer.url().replace(/\/$/, ''), state.consumer.url.replace(/\/$/, ''));
      assert((await buyer.locator('body').innerText()).length > 100);
    } finally { await buyer.close(); }
    receipt.buyer = { sourceFile: downloaded.path, sourceSha256: downloaded.sha256,
      configFile: join(output, 'buyer-discovery-review.json'), configSha256: prepared.configSha256,
      request: observed.request, method, amount: selected.accepts[0].amount, sourceUrl: downloaded.value.sourceUrl };
    await record('native-pages-to-original-buyer', { listResources: 2, limit: 1,
      originalOpaqueCursor: Boolean(receipt.opaqueCursor), sourceSha256: downloaded.sha256,
      configSha256: prepared.configSha256, method, amount: selected.accepts[0].amount });
  }
  async function upgradeServingPython() {
    let current = await discovery('python');
    if (current.serving.releaseId !== receipt.upgrade.releaseId) {
      assert.equal(current.serving.releaseId, 'python-v1');
      await selectTenant('python');
      await page.locator('#discovery-route').selectOption('amortize');
      await page.locator('#discovery-reason').fill('Superseded by the reviewed smaller Python service.');
      const obsolete = await clickResponse('#discovery-review-withdraw', '/review');
      assert.equal(obsolete.serving.revision, current.serving.revision);
      receipt.upgrade.obsoleteReview = { reviewId: obsolete.reviewId, serving: obsolete.serving };
      await save(outputReceipt, receipt);
      let status = await api('status'), candidate = status.releaseStatus.native.candidate;
      let candidateId, expectedRevision;
      if (candidate) {
        const selected = selectedSlot(status, 'python', 'green');
        assert(selected.candidate && selected.runningReleaseId === receipt.upgrade.releaseId,
          'Reconcile only the original candidate backed by this retained release.');
        assert.equal(candidate.merchants.find(row => row.id === 'python').upstreamPort, pythonTenant.slots.green.port);
        if (receipt.upgrade.candidate) assert.equal(receipt.upgrade.candidate.candidateId, candidate.id);
        candidateId = candidate.id; expectedRevision = status.releaseStatus.native.revision;
      } else {
        assert(!candidate, 'Use the same selected fleet candidate before preparing another.');
        const reviewed = (await api('releases/review', { tenant: 'python', slot: 'green', releaseId: receipt.upgrade.releaseId })).result;
        assert(reviewed.comparison.changes.some(row => row.state === 'REMOVED' && row.before.id === 'amortize'));
        const prepared = (await api('releases/prepare', { reviewId: reviewed.reviewId })).result;
        candidateId = prepared.candidateId; expectedRevision = prepared.expectedRevision;
        receipt.upgrade.candidate = { candidateId, expectedRevision }; await save(outputReceipt, receipt);
      }
      await api('activate', { candidateId, expectedRevision });
      await page.locator('#refresh').click(); await idle();
      await page.waitForFunction(() => document.querySelector('#discovery-review').hidden);
      const invalid = await api('releases/discovery/apply', { tenant: 'python', reviewId: obsolete.reviewId }, 409);
      assert.equal(invalid.error, 'FLEET_DISCOVERY_SERVING_CHANGED');
      current = await discovery('python');
      assert.equal(current.serving.releaseId, receipt.upgrade.releaseId);
      receipt.upgrade.reviewInvalidation = invalid.error;
    }
    assert.equal(current.serving.slot, 'green');
    assert.equal(current.enrollment.publicKeySha256, receipt.enrollments.python.publicKeySha256);
    receipt.upgrade.serving = current.serving; await save(outputReceipt, receipt);
    await record('native-source-replacement', { revision: current.serving.revision,
      slot: current.serving.slot, releaseId: current.serving.releaseId, digest: current.serving.releaseDigest,
      retainedSeller: current.enrollment.publicKeySha256, obsoleteReview: receipt.upgrade.reviewInvalidation ?? 'Recovered committed replacement' });
  }
  async function publishPriceWithLostResponse() {
    const current = await selectTenant('python');
    const changed = current.catalog.rows.find(row => row.routeId === 'summarize');
    assert(changed); assert.equal(originalAmount(changed), '25000');
    if (changed.state !== 'MATCHES') {
      assert.equal(changed.state, 'DIFFERS'); assert.equal(changed.before.payment[0].amount, '20000');
      const reviewed = await clickResponse('#discovery-review-publish', '/review');
      assert.equal(reviewed.catalog.changes.length, 1);
      assert.equal(reviewed.catalog.changes[0].before.payment[0].amount, '20000');
      assert.equal(reviewed.catalog.changes[0].payment[0].amount, '25000');
      const exported = await downloadJSON('#discovery-download-review', 'python-price-review.json');
      assert.deepEqual(exported.value, reviewed);
      receipt.pricePublication ??= { expectedAmount: '25000', attempts: [] };
      const attempt = { id: randomUUID(), reviewId: reviewed.reviewId,
        beforeHead: reviewed.catalog.catalog.journalHead, requests: [] };
      receipt.pricePublication.attempts.push(attempt); await save(outputReceipt, receipt);
      let settle, reject; const forwarded = new Promise((done, fail) => { settle = done; reject = fail; });
      const pattern = '**/api/releases/discovery/apply';
      const handler = async route => {
        try {
          const request = route.request().postDataJSON();
          assert.equal(request.tenant, 'python'); assert.equal(request.reviewId, reviewed.reviewId);
          attempt.requests.push(request); await save(outputReceipt, receipt);
          const response = await route.fetch();
          const result = await response.json(); assert.equal(response.status(), 200, JSON.stringify(result));
          assert.equal(result.result.decision, 'COMMITTED'); assert.equal(result.result.signaturesIssued, 1);
          assert.equal(result.result.paymentCalls, 0);
          receipt.pricePublication.committed = result; receipt.pricePublication.committedAttemptId = attempt.id;
          attempt.committed = true; await save(outputReceipt, receipt);
          await route.abort('failed'); settle(result);
        } catch (error) { await route.abort('failed').catch(() => {}); reject(error); }
      };
      await page.route(pattern, handler, { times: 1 });
      try {
        await page.locator('#discovery-apply').click(); await page.locator('#confirm-apply').click();
        await forwarded; await idle();
      } finally { await page.unroute(pattern, handler); }
      assert.equal(await page.locator('#discovery-review').isHidden(), true);
      assert.match(await page.locator('#discovery-notice').innerText(), /reconciled|Refresh the original state/i);
    }
    const reconciled = await discovery('python'), row = reconciled.catalog.rows.find(row => row.routeId === 'summarize');
    assert.equal(row.state, 'MATCHES'); assert.equal(row.before.payment[0].amount, '25000');
    const history = await discovery('python', '/history', { catalogKey: row.catalogKey });
    assert(history.history.length >= 2);
    if (receipt.pricePublication?.committed) {
      const committedAttempt = receipt.pricePublication.attempts.find(row => row.id === receipt.pricePublication.committedAttemptId);
      assert.equal(committedAttempt.requests.length, 1, 'Reconciliation must not automatically sign again.');
      assert.equal(reconciled.catalog.catalog.journalHead, receipt.pricePublication.committed.result.status.catalog.journalHead);
    }
    receipt.pricePublication = { ...receipt.pricePublication, catalogKey: row.catalogKey,
      finalHead: reconciled.catalog.catalog.journalHead, finalSequence: row.before.sequence };
    await save(join(output, 'python-price-history.json'), history);
    receipt.priceComplete = true; await save(outputReceipt, receipt);
    await record('signed-price-reconciled-after-lost-response', { sourceAmount: '25000', previousAmount: '20000',
      signaturesIssued: receipt.pricePublication.committed?.result.signaturesIssued ?? null,
      journalHead: reconciled.catalog.catalog.journalHead, historyEntries: history.history.length,
      nativeResponseRetained: Boolean(receipt.pricePublication.committed) });
  }
  async function withdrawRetainedRoute() {
    await selectTenant('python');
    const full = await api('status'), old = selectedSlot(full, 'python', 'blue');
    if (old.owned) {
      await api('releases/retire', { tenant: 'python', slot: 'blue', instanceId: old.instanceId,
        expectedRevision: full.releaseStatus.native.revision });
      await page.locator('#refresh').click(); await idle();
    }
    await page.locator('#discovery-source-mode').selectOption('retained'); await idle();
    await page.locator('#discovery-source-slot').selectOption('blue'); await idle();
    await page.locator('#discovery-source-release').selectOption('python-v1');
    const sourceResponse = page.waitForResponse(r => r.request().method() === 'GET' &&
      new URL(r.url()).pathname === '/api/releases/discovery/source');
    await page.locator('#discovery-read-source').click(); const response = await sourceResponse;
    assert.equal(response.status(), 200); const sourceView = await response.json(); await idle();
    assert.equal(sourceView.catalog.release.id, 'python-v1');
    assert.equal(sourceView.catalog.runtime.running, false);
    let removed = sourceView.catalog.rows.find(row => row.routeId === 'amortize');
    assert(removed && removed.before);
    const sourceDownload = await downloadJSON('#discovery-download-source', 'retired-python-source.json');
    assert.deepEqual(sourceDownload.value, sourceView);
    if (!removed.before.retired) {
      await page.locator('#discovery-route').selectOption('amortize');
      await page.locator('#discovery-reason').fill('The active Python release removes amortize; its retained listing is withdrawn.');
      const review = await clickResponse('#discovery-review-withdraw', '/review');
      assert.equal(review.serving.releaseId, receipt.upgrade.releaseId); assert.equal(review.serving.slot, 'green');
      assert.equal(review.catalog.release.id, 'python-v1'); assert.equal(review.catalog.action, 'withdraw');
      assert.equal(review.catalog.changes[0].routeId, 'amortize');
      const applied = await applyReviewed('/apply'); assert.equal(applied.result.signaturesIssued, 1);
      assert.equal(applied.result.decision, 'COMMITTED'); assert.equal(applied.result.paymentCalls, 0);
    }
    const checked = await discovery('python', '/source', { slot: 'blue', releaseId: 'python-v1' });
    removed = checked.catalog.rows.find(row => row.routeId === 'amortize');
    assert.equal(removed.state, 'WITHDRAWN'); assert.equal(removed.before.retired, true);
    await page.locator('#discovery-history-key').fill(removed.catalogKey);
    const historyPending = page.waitForResponse(r => r.request().method() === 'GET' &&
      new URL(r.url()).pathname === '/api/releases/discovery/history');
    await page.locator('#discovery-read-history').click(); const historyResponse = await historyPending;
    assert.equal(historyResponse.status(), 200); const history = await historyResponse.json(); await idle();
    assert(history.history.length >= 2);
    const downloaded = await downloadJSON('#discovery-download-history', 'retired-amortize-history.json');
    assert.deepEqual(downloaded.value, history);
    const nativePage = await discovery('python', '/consume', { view: 'list', limit: 10, offset: 0 });
    assert.equal(nativePage.page.resources.length, 1);
    assert.equal(resourceURL(nativePage.page.resources[0]), checked.catalog.rows.find(row => row.routeId === 'summarize').url);
    receipt.withdrawal = { catalogKey: removed.catalogKey, sourceSlot: 'blue', sourceReleaseId: 'python-v1',
      currentSlot: 'green', currentReleaseId: receipt.upgrade.releaseId,
      sequence: removed.before.sequence, journalHead: checked.catalog.catalog.journalHead, historySha256: downloaded.sha256 };
    receipt.withdrawalComplete = true; await save(outputReceipt, receipt);
    await record('removed-route-withdrawn-from-retired-source', { ...receipt.withdrawal, publicResources: 1 });
  }
  async function stopAndReopenBrowser() {
    const before = await selectTenant('python'); rememberURLs(before);
    await page.locator('#discovery-stop').click(); await page.locator('#confirm').waitFor({ state: 'visible' });
    const stopped = await clickResponse('#confirm-apply', '/stop');
    assert.equal(stopped.state, 'CONFIGURED'); assert.equal(await page.locator('#discovery-buyer-link').isHidden(), true);
    await waitFor(() => absent(before.consumer.url), 'Closed buyer explorer remained reachable.');
    await waitFor(() => absent(before.discoveryOrigin), 'Closed native catalog remained reachable.');
    const restarted = rememberURLs(await clickResponse('#discovery-start', '/start'));
    assert.equal(restarted.enrollment.publicKeySha256, before.enrollment.publicKeySha256);
    assert.notEqual(restarted.instanceId, before.instanceId);
    assert.equal(restarted.catalog.catalog.journalHead, before.catalog.catalog.journalHead);
    await page.locator('#discovery-source-mode').selectOption('current'); await idle();
    await page.locator('#discovery-read-source').click(); await idle();
    await page.locator('#discovery-query').fill('summarize'); await page.locator('#discovery-limit').fill('1');
    await publicRead('#discovery-read-page');
    await page.locator('#discovery-heading').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(output, 'fleet-discovery-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth), 390);
    await page.screenshot({ path: join(output, 'fleet-discovery-mobile.png'), fullPage: true });
    assert.deepEqual(receipt.browserErrors, []);
    receipt.browserComplete = true; receipt.finalBrowserServing = restarted.serving; await save(outputReceipt, receipt);
    await record('owned-browser-lifecycle-and-responsive-handover', { oldInstance: before.instanceId,
      newInstance: restarted.instanceId, retainedSeller: restarted.enrollment.publicKeySha256,
      journalHead: restarted.catalog.catalog.journalHead, desktop: '1360x1024', mobile: '390x844', browserErrors: 0 });
    await browser.close(); browser = null; page = null;
    const address = workspace.url; await workspace.close(); workspace = null;
    await waitFor(() => absent(address), 'Original managed workspace remained open after close.');
  }
  async function terminalPhase() {
    cli = await openFleetReleaseOperator({ planFile, directory });
    if (stopRequested) { await cli.close(); cli = null; assertRunning(); }
    const stopped = await dispatchFleetCommand(cli, 'discovery python');
    assert.equal(stopped.state, 'CONFIGURED'); assert.equal(stopped.serving.releaseId, receipt.upgrade.releaseId);
    const state = rememberURLs(await dispatchFleetCommand(cli, 'discovery-start python'));
    assert.equal(state.enrollment.publicKeySha256, receipt.enrollments.python.publicKeySha256);
    const enrollment = await dispatchFleetCommand(cli, 'discovery-enrollment python');
    assert.equal(enrollment.enrollment.publicKeySha256, receipt.enrollments.python.publicKeySha256);
    const retained = await dispatchFleetCommand(cli, 'discovery-source python blue python-v1');
    assert.equal(retained.catalog.runtime.running, false);
    assert.equal(retained.catalog.rows.find(row => row.routeId === 'amortize').state, 'WITHDRAWN');
    const history = await dispatchFleetCommand(cli, 'discovery-history python ' + JSON.stringify(receipt.withdrawal.catalogKey));
    assert.equal(history.journalHead, receipt.withdrawal.journalHead);
    assert(history.history.length >= 2);
    const observed = await dispatchFleetCommand(cli, 'discovery-consume python ' + JSON.stringify({ view: 'list', limit: 1, offset: 0 }));
    assert.equal(observed.page.resources.length, 1); assert.equal(observed.page.resources[0].accepts[0].amount, '25000');
    await dispatchFleetCommand(cli, 'discovery-stop python ' + state.instanceId);
    await waitFor(() => absent(state.consumer.url), 'CLI buyer explorer close did not release its listener.');
    await cli.close(); cli = null;
    receipt.terminalComplete = true; await save(outputReceipt, receipt);
    await record('original-terminal-reopened-retained-discovery', { seller: state.enrollment.publicKeySha256,
      sourceSlot: 'blue', sourceRelease: 'python-v1', historyEntries: history.history.length, journalHead: history.journalHead });
  }
  async function wire(method, params) {
    const response = await fetch(mcp.url, {
      method: 'POST', headers: { authorization: 'Bearer ' + bearer, 'content-type': 'application/json',
        accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }), signal: AbortSignal.timeout(45000),
    });
    assert.equal(response.status, 200); const value = await response.json(); assert.equal(value.error, undefined); return value.result;
  }
  async function mcpCall(name, args = {}, expectedError = false) {
    const value = await wire('tools/call', { name, arguments: args });
    assert.equal(Boolean(value.isError), expectedError, JSON.stringify(value.structuredContent)); return value.structuredContent;
  }
  async function mcpPhase() {
    assert(sdkReceipt.mcpConfiguration);
    mcp = await startMerchantMcp({ configPath: sdkReceipt.mcpConfiguration, port: 0,
      environment: { ...process.env, MCP_ACCESS_TOKEN: bearer } });
    if (stopRequested) { await mcp.close(); mcp = null; assertRunning(); }
    heldURLs.add(mcp.url);
    await wire('initialize', {});
    const definitions = (await wire('tools/list', {})).tools.filter(row => row.name.startsWith('merchant_fleet_discovery_'));
    assert.deepEqual(definitions.map(row => row.name).sort(), [
      'status', 'enrollment', 'enrollment_review', 'enroll', 'start', 'stop',
      'source', 'review', 'apply', 'history', 'consume',
    ].map(name => 'merchant_fleet_discovery_' + name).sort());
    const plan = await mcpCall('merchant_fleet_plan'); assert.equal(plan.digest, nativePlan.digest);
    const running = await mcpCall('merchant_fleet_start', { expectedPlanDigest: plan.digest });
    assert.equal(running.fleet.native.revision, receipt.upgrade.serving.revision);
    let state = await mcpCall('merchant_fleet_discovery_status', { tenant: 'python' });
    assert.equal(state.state, 'CONFIGURED'); assert.equal(state.enrollment.publicKeySha256, receipt.enrollments.python.publicKeySha256);
    state = rememberURLs(await mcpCall('merchant_fleet_discovery_start', { tenant: 'python' }));
    const history = await mcpCall('merchant_fleet_discovery_history', { tenant: 'python', catalogKey: receipt.withdrawal.catalogKey });
    assert.equal(history.journalHead, receipt.withdrawal.journalHead);
    const sourceView = await mcpCall('merchant_fleet_discovery_source', { tenant: 'python', slot: 'blue', releaseId: 'python-v1' });
    assert.equal(sourceView.catalog.rows.find(row => row.routeId === 'amortize').state, 'WITHDRAWN');
    const publicPage = await mcpCall('merchant_fleet_discovery_consume', { tenant: 'python', view: 'list', limit: 1, offset: 0 });
    assert.equal(publicPage.page.resources.length, 1); assert.equal(publicPage.page.resources[0].accepts[0].amount, '25000');
    const old = state;
    await mcpCall('merchant_fleet_discovery_stop', { tenant: 'python', instanceId: old.instanceId });
    await waitFor(() => absent(old.consumer.url), 'MCP original buyer explorer stayed reachable.');
    state = rememberURLs(await mcpCall('merchant_fleet_discovery_start', { tenant: 'python' }));
    assert.notEqual(state.instanceId, old.instanceId);
    assert.equal(state.catalog.catalog.journalHead, old.catalog.catalog.journalHead);
    assert.equal(state.enrollment.publicKeySha256, old.enrollment.publicKeySha256);
    await mcpCall('merchant_fleet_discovery_stop', { tenant: 'python', instanceId: old.instanceId }, true);
    const originalClient = await mcpCall('merchant_fleet_client_manifest', { tenant: 'rpc', slot: 'blue', exportId: 'shared-customer' });
    assert.equal(originalClient.manifestFile.sha256, sdkReceipt.exports['rpc/blue/shared-customer'].manifestSha256);
    const pythonClient = await mcpCall('merchant_fleet_client_manifest', { tenant: 'python', slot: 'blue', exportId: 'shared-customer' });
    assert.equal(pythonClient.manifestFile.sha256, sdkReceipt.exports['python/blue/shared-customer'].manifestSha256);
    await mcpCall('merchant_fleet_stop', { managerId: running.managerId });
    const oldURL = mcp.url; await mcp.close(); mcp = null;
    await waitFor(() => absent(oldURL), 'The owned MCP listener remained reachable after close.');
    receipt.mcpComplete = true; await save(outputReceipt, receipt);
    await record('original-mcp-reopened-seller-history-and-sdk-custody', { discoveryTools: definitions.length,
      retainedSeller: state.enrollment.publicKeySha256, journalHead: state.catalog.catalog.journalHead,
      customerManifests: [originalClient.manifestFile.sha256, pythonClient.manifestFile.sha256] });
  }
  let stopRequested = false, cleanupPromise;
  async function closeOwned() {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      const errors = [];
      for (const value of [browser, workspace, cli, mcp]) {
        try { await value?.close(); } catch (error) { errors.push(error.message); }
      }
      browser = null; workspace = null; cli = null; mcp = null; page = null;
      try { await closeServer(provider); } catch (error) { errors.push(error.message); }
      if (priorEndpoint === undefined) delete process.env[rpcPlan.endpointEnv];
      else process.env[rpcPlan.endpointEnv] = priorEndpoint;
      receipt.cleanupErrors = errors;
      receipt.ownedProcessesClosed = errors.length === 0;
      return errors;
    })();
    return cleanupPromise;
  }
  const onSignal = () => { stopRequested = true; void closeOwned().catch(() => {}); };
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, onSignal);
  const assertRunning = () => { if (stopRequested) throw new Error('The original discovery continuation was stopped.'); };
  try {
    await prepareNativeChanges(); assertRunning();
    if (!receipt.browserComplete) await retainRealSetupInterruption();
    assertRunning(); await listen(provider);
    if (stopRequested) { await closeServer(provider); assertRunning(); }
    process.env[rpcPlan.endpointEnv] = 'http://127.0.0.1:' + provider.address().port + '/rpc';
    if (!receipt.browserComplete) {
      await openBrowser(); assertRunning();
      await ensureEnrollment('rpc'); await ensureEnrollment('python');
      receipt.enrollmentsComplete = true; await save(outputReceipt, receipt);
      if (!receipt.baselineComplete) {
        const before = await discovery('python'); assert.equal(before.serving.releaseId, 'python-v1');
        const rpc = await publishCurrent('rpc'), python = await publishCurrent('python');
        assert.equal(rpc.catalog.rows[0].payment[0].amount, '23000');
        assert.equal(python.catalog.rows.length, 2); assert(python.catalog.rows.every(row => originalAmount(row) === '20000'));
        await nativeBuyerHandover();
        receipt.baseline = { rpcHead: rpc.catalog.catalog.journalHead, pythonHead: python.catalog.catalog.journalHead,
          resources: python.catalog.rows.map(row => ({ routeId: row.routeId, catalogKey: row.catalogKey, amount: originalAmount(row) })) };
        receipt.baselineComplete = true; await save(outputReceipt, receipt);
        await record('original-tenant-enrollment-and-publication', { rpcResources: 1, pythonResources: 2,
          recoveredFilesPreserved: Boolean(receipt.recoveryAttempt.retainedSetupId), planDigest: nativePlan.digest });
      }
      assertRunning(); await upgradeServingPython();
      if (!receipt.priceComplete) await publishPriceWithLostResponse();
      if (!receipt.withdrawalComplete) await withdrawRetainedRoute();
      assertRunning(); await stopAndReopenBrowser();
    }
    assertRunning(); if (!receipt.terminalComplete) await terminalPhase();
    assertRunning(); if (!receipt.mcpComplete) await mcpPhase();
    assert.equal(sha(await readFile(receiptFile)), sdkReceiptSha256, 'The original SDK acceptance receipt is immutable.');
    assert.equal(sha(await readFile(planFile)), receipt.planFileSha256);
    assert.deepEqual(receipt.browserErrors, []);
    receipt.state = 'PASS';
  } catch (error) {
    fatal = error; receipt.state = 'FAILED'; receipt.failure = { name: error.name, code: error.code ?? null,
      message: error.message, stack: error.stack };
  } finally {
    await closeOwned();
    for (const signal of ['SIGINT', 'SIGTERM']) process.removeListener(signal, onSignal);
    const paths = [
      'stellar/scf-starforge-20261009/merchant-fleet-gateway/release-discovery.mjs',
      'stellar/scf-starforge-20261009/merchant-fleet-gateway/release-operator.mjs',
      'stellar/scf-starforge-20261009/merchant-fleet-gateway/release-cli.mjs',
      'stellar/scf-starforge-20261009/merchant-fleet-gateway/workspace/discovery.mjs',
      'stellar/scf-starforge-20261009/merchant-fleet-gateway/workspace/server.mjs',
      'stellar/scf-starforge-20261009/merchant-fleet-gateway/workspace/browser.mjs',
      'stellar/scf-starforge-20261009/merchant-fleet-gateway/workspace/index.html',
      'stellar/scf-starforge-20261009/merchant-fleet-gateway/workspace/style.css',
      'stellar/scf-starforge-20261009/sf82-seller-pilot/release-discovery-setup.mjs',
      'stellar/scf-starforge-20261009/sf82-seller-pilot/release-catalog.mjs',
      'stellar/scf-starforge-20261009/sf88-operator-buyer-cli/prepare.mjs',
      'stellar-forge/mcp-merchant-operator/fleet.mjs',
    ];
    receipt.sourceHashes = Object.fromEntries(await Promise.all(paths.map(async path => [path, sha(await readFile(join(source, path)))])));
    receipt.closedListeners = [];
    if (receipt.ownedProcessesClosed) {
      for (const address of heldURLs) {
        const released = await absent(address); receipt.closedListeners.push({ address, released });
        if (!released) receipt.ownedProcessesClosed = false;
      }
    }
    receipt.sdkReceiptStillExact = sha(await readFile(receiptFile)) === sdkReceiptSha256;
    receipt.planFileStillExact = sha(await readFile(planFile)) === receipt.planFileSha256;
    receipt.finishedAt = new Date().toISOString();
    if (!receipt.ownedProcessesClosed || !receipt.sdkReceiptStillExact || !receipt.planFileStillExact) {
      receipt.state = 'FAILED';
      fatal ??= new Error('Original discovery cleanup or retained SDK custody did not complete.');
    }
    await save(outputReceipt, receipt);
    console.log(JSON.stringify({ discovery: receipt.state, receipt: outputReceipt, milestones: receipt.milestones.length,
      ownedProcessesClosed: receipt.ownedProcessesClosed, sdkReceiptStillExact: receipt.sdkReceiptStillExact,
      planFileStillExact: receipt.planFileStillExact, failure: receipt.failure ?? null }));
  }
  if (fatal) throw fatal;
  return structuredClone(receipt);
}
