import { readFile, mkdir, open, link, unlink, rename, realpath } from 'node:fs/promises';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { join, resolve, dirname, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const { values: args } = parseArgs({ options: {
  source: { type: 'string' }, 'source-manifest': { type: 'string' },
  'producer-record': { type: 'string' }, 'continuation-record': { type: 'string' }, output: { type: 'string' },
  playwright: { type: 'string' }, browser: { type: 'string' },
} });
for (const key of ['source', 'source-manifest', 'producer-record', 'continuation-record', 'output', 'playwright', 'browser'])
  if (!args[key]) throw Error('Missing --' + key);
const source = resolve(args.source), output = resolve(args.output), record = resolve(args['producer-record']);
const continuationRecord = resolve(args['continuation-record']);
const component = join(source, 'stellar/scf-starforge-20261009/sf30-seller-sdk/opencage');
const merchant = join(source, 'stellar-forge/mcp-merchant-operator');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(JSON.stringify(value, null, 2) + '\n');
const readJson = async path => JSON.parse(await readFile(path, 'utf8'));
const imp = path => import(pathToFileURL(path).href);
const requireValue = (value, message) => { if (!value) throw Error(message); };
await mkdir(output, { recursive: true, mode: 0o700 });
requireValue(await realpath(output) === output, 'Use a canonical private output directory');
async function atomic(path, bytes, { replace = false } = {}) {
  bytes = Buffer.isBuffer(bytes) ? bytes : jsonBytes(bytes);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  if (!replace) {
    try { requireValue((await readFile(path)).equals(bytes), 'Existing original file changed: ' + relative(output, path)); return; }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const temporary = path + '.next-' + randomUUID(), handle = await open(temporary, 'wx', 0o600);
  try {
    await handle.writeFile(bytes); await handle.sync(); await handle.close();
    if (replace) await rename(temporary, path);
    else { await link(temporary, path); await unlink(temporary); }
    const parent = await open(dirname(path), 'r'); try { await parent.sync(); } finally { await parent.close(); }
  } finally { await handle.close().catch(() => {}); await unlink(temporary).catch(() => {}); }
}
const report = { schema: 'commons.scf-opencage-mcp-receiving/v1', startedAt: new Date().toISOString(), stages: [] };
async function stage(name, details) {
  report.stages.push({ name, at: new Date().toISOString(), ...details });
  await atomic(join(output, 'journey.json'), report, { replace: true });
  console.log(JSON.stringify({ stage: name, ...details }));
}
let mcp, browser, client, activeWorkspace, activeBuyer, activeCustomer;
try {
  const closureBytes = await readFile(resolve(args['source-manifest'])), closure = JSON.parse(closureBytes);
  requireValue(digest(closureBytes) === 'be4e5afaf63ca73f8285b439abf3c42be0e81cdafd9a4223b2b6f7122826b290',
    'Use the exact retained receiving selection and published UI correction');
  requireValue(closure.sourceCommit === '5e323e89a92b8859eb851205d69c6cc420ff7020' && closure.sourceRoot === source,
    'Use the reviewed complete merchant MCP source selection');
  for (const file of closure.files) {
    const bytes = await readFile(join(source, file.path));
    requireValue(bytes.length === file.bytes && digest(bytes) === file.sha256, 'Installed module changed: ' + file.path);
  }
  async function nativeRecord(directory, outputOption) {
    const requestBytes = await readFile(join(directory, 'request.json')), request = JSON.parse(requestBytes);
    const resultBytes = await readFile(join(directory, 'result.json')), result = JSON.parse(resultBytes);
    const manifestBytes = await readFile(join(directory, 'artifacts.json')), manifest = JSON.parse(manifestBytes);
    const intent = request.intent, argv = intent.command;
    requireValue(Array.isArray(argv) && typeof intent.project === 'string', 'Use the original native command');
    const option = name => {
      const at = argv.indexOf(name);
      requireValue(at >= 0 && typeof argv[at + 1] === 'string', 'Original command omitted ' + name);
      return resolve(argv[at + 1]);
    };
    const root = option(outputOption), project = resolve(intent.project);
    requireValue(root === join(project, 'run') && await realpath(root) === root,
      'Original output no longer joins its canonical native project');
    const files = new Map(manifest.files.map(file => [file.path, file]));
    async function retained(name) {
      const path = join(root, name), key = relative(project, path).split('\\').join('/');
      requireValue(await realpath(path) === path && !key.startsWith('../'),
        'Retain the original declared artifact path');
      const bytes = await readFile(path), file = files.get(key);
      requireValue(file && file.bytes === bytes.length && file.sha256 === digest(bytes),
        'Original native artifact changed: ' + name);
      return bytes;
    }
    return { directory, request, result, manifest, intent, option, root, retained,
      binding: { operationId: intent.operation_id, record: directory,
        requestSha256: digest(requestBytes), resultSha256: digest(resultBytes), artifactsSha256: digest(manifestBytes) } };
  }
  const provider = await nativeRecord(record, '--work');
  requireValue(provider.result.state === 'failed' && provider.result.exit_code === 1,
    'Keep the original provider run and its retained later release-stage failure');
  const producer = provider.root, producerSource = provider.option('--source');
  const originalJourney = JSON.parse(await provider.retained('journey.json'));
  const sourceStages = new Set(originalJourney.stages.map(stage => stage.name));
  for (const name of ['native-provider', 'native-zero-result', 'browser-original-http-import', 'browser-candidate-delivery'])
    requireValue(sourceStages.has(name), 'Original source stage is missing: ' + name);
  const response = await provider.retained('native-response.json');
  const observationBytes = await provider.retained('native-http-observation.json'), observation = JSON.parse(observationBytes);
  requireValue(observation.response.status === 200 && observation.bodySha256 === digest(response) &&
    observation.bodyBytes === response.length, 'Original provider and HTTP observation bytes differ');
  const completion = await nativeRecord(continuationRecord, '--output');
  requireValue(completion.result.state === 'completed' && completion.result.exit_code === 0 && !completion.manifest.errors?.length,
    'The original retained-workspace and Buyer continuation must finish successfully');
  requireValue(completion.option('--provider-record') === record && completion.option('--source') === source &&
    completion.option('--source-manifest') === resolve(args['source-manifest']),
    'The continuation no longer joins this original provider and receiving source');
  const completedJourney = JSON.parse(await completion.retained('journey.json'));
  requireValue(completedJourney.outcome === 'COMPLETE' &&
    completedJourney.source.manifestSha256 === digest(closureBytes), 'Completed receiving source changed');
  for (const [key, value] of Object.entries(provider.binding))
    requireValue(completedJourney.provider[key] === value, 'The completion changed original provider ' + key);
  requireValue(completedJourney.provider.sourceRoot === producerSource &&
    completedJourney.provider.workspace === join(producer, 'workspace') &&
    completedJourney.provider.responseSha256 === digest(response) &&
    completedJourney.provider.responseBytes === response.length,
    'The completed workshare changed its provider source or saved workspace');
  const completedBinding = JSON.parse(await completion.retained('provider-binding.json'));
  requireValue(JSON.stringify(completedBinding) === JSON.stringify(completedJourney.provider),
    'The completed native binding differs from its own report');
  requireValue((await completion.retained('native-response.json')).equals(response) &&
    (await completion.retained('native-http-observation.json')).equals(observationBytes),
    'The completed receiver changed original provider bytes');
  const completeStages = new Set(completedJourney.stages.map(stage => stage.name));
  for (const name of ['browser-price-restart-and-rollback', 'original-customer-reopened', 'original-buyer-executed-and-recovered'])
    requireValue(completeStages.has(name), 'Completed workshare stage is missing: ' + name);
  const buyerRoot = join(completion.root, 'buyer');
  const buyerBytes = await completion.retained('buyer/buyer-complete.json'), buyerComplete = JSON.parse(buyerBytes);
  requireValue(completedJourney.buyer.directory === buyerRoot && completedJourney.buyer.reportSha256 === digest(buyerBytes) &&
    buyerComplete.httpStatus === 200 && buyerComplete.responseSha256 === digest(response) &&
    buyerComplete.responseBytes === response.length && buyerComplete.recoveredIntentId === buyerComplete.intentId,
    'Original completed Buyer no longer joins this response and retained native result');
  const nativeData = JSON.parse(response);
  requireValue(nativeData.results.length === 1 && Array.isArray(nativeData.licenses) && nativeData.licenses.length > 0,
    'Use the actual documented provider sample and returned licenses');
  report.producer = { ...provider.binding, sourceRoot: producerSource, outcome: provider.result.state,
    responseSha256: digest(response), responseBytes: response.length };
  report.continuation = { ...completion.binding, outcome: completion.result.state,
    output: completion.root, buyerRoot, buyerIntentId: buyerComplete.intentId, buyerReportSha256: digest(buyerBytes) };
  report.source = { commit: closure.sourceCommit, overlays: closure.overlays,
    files: closure.files.length, manifestSha256: digest(closureBytes) };
  await stage('original-operations-joined', { providerOperationId: provider.intent.operation_id,
    continuationOperationId: completion.intent.operation_id, responseSha256: digest(response),
    buyerIntentId: buyerComplete.intentId, installedFiles: closure.files.length });

  const [{ initializeOpenCageWorkspaceMerchant }, { startMerchantMcp }, { openMerchantFileClient },
    { GeocodeDelivery }, { relativeFile }] = await Promise.all([
    imp(join(merchant, 'config.mjs')), imp(join(merchant, 'serve.mjs')), imp(join(merchant, 'retained-download.mjs')),
    imp(join(component, 'customer.mjs')),
    imp(join(source, 'stellar/scf-starforge-20261009/sf30-seller-sdk/twelvedata/files.mjs')),
  ]);
  const buyerClientFile = join(output, 'original-buyer-client.json');
  await atomic(buyerClientFile, { runtimeDirectory: join(producerSource, 'stellar/scf-starforge-20261009/sf88-operator-buyer-cli'),
    stateDirectory: join(buyerRoot, 'buyer-state') });
  const connection = join(output, 'opencage-connection.json');
  await atomic(connection, { schema: 'stellar-forge.opencage-workspace-connection.v1', workspaces: {
    locations: { label: 'Original geocoding workshare', directory: join(producer, 'workspace'),
      imports: { observed: { observation: join(producer, 'native-http-observation.json'), response: join(producer, 'native-response.json') } } },
    customer: { label: 'Original recovered customer operation', directory: join(buyerRoot, 'buyer-merchant-workspace'),
      buyers: { retained: buyerClientFile } },
  } });
  const initialized = await initializeOpenCageWorkspaceMerchant({ directory: join(output, 'merchant-mcp'), connection });
  const reused = await initializeOpenCageWorkspaceMerchant({ directory: join(output, 'merchant-mcp'), connection });
  requireValue(reused.reused && reused.configuration === initialized.configuration, 'MCP initialization did not reopen the same configuration');
  const environment = { ...process.env, OPENCAGE_API_KEY: '6d0e711d72d74daeb2b0bfd2a5cdfdba',
    MCP_ACCESS_TOKEN: randomBytes(32).toString('base64url') };
  mcp = await startMerchantMcp({ configPath: initialized.configuration, port: 0, environment });
  client = await openMerchantFileClient({ url: mcp.url + '/mcp', environment, errorPrefix: 'OPENCAGE',
    clientName: 'starforge-opencage-native-receiving' });
  let calls = 0;
  const call = async (name, input = {}) => { const value = await client.call('merchant_opencage_' + name, input); calls++; return value; };
  const native = async (name, input) => (await call(name, input)).native;
  const declared = await call('workspaces');
  requireValue(declared.configured && declared.workspaces.length === 2, 'Original host aliases were not registered');
  activeWorkspace = await call('open', { workspace: 'locations' });
  const identity = activeWorkspace.native.identity;
  const status = async workspace => native('inspect', { workspace, view: 'status' });
  const input = observation.request.query;
  const review = await native('query_review', { workspace: 'locations', productId: 'reverse', input });
  const beforeReuse = (await status('locations')).native.source;
  const retainedCapture = await native('capture', { workspace: 'locations', id: 'native-reverse',
    productId: 'reverse', input, reviewSha256: review.reviewSha256 });
  const afterReuse = (await status('locations')).native.source;
  requireValue(retainedCapture.responseSha256 === digest(response) && beforeReuse.started === afterReuse.started,
    'Original same-ID capture did not reopen its retained response');
  await stage('mcp-original-capture-reopened', { workspaceIdentity: identity, reviewSha256: review.reviewSha256,
    requestId: retainedCapture.request.id, responseSha256: retainedCapture.responseSha256, sourceDispatches: afterReuse.started });

  const imported = await native('import_response', { workspace: 'locations', id: 'mcp-native-reverse',
    productId: 'reverse', input, source: 'observed' });
  requireValue(imported.responseSha256 === digest(response), 'MCP import changed original response');
  const first = await native('inspect', { workspace: 'locations', view: 'requests', limit: 1 });
  requireValue(first.total > 1 && first.nextOffset === 1, 'Original request collection did not retain existing work');
  const following = await native('inspect', { workspace: 'locations', view: 'requests', offset: first.nextOffset,
    limit: 100, expectedIndexSha256: first.indexSha256 });
  requireValue(following.indexSha256 === first.indexSha256 && following.rows.length + 1 === first.total,
    'Paged original request selection changed');
  const candidates = await native('inspect', { workspace: 'locations', view: 'candidates', id: 'mcp-native-reverse' });
  requireValue(candidates.total === 1, 'Native candidate order changed');
  let decision = imported;
  if (decision.decision.revision === 0) decision = await native('select', { workspace: 'locations', id: 'mcp-native-reverse',
    responseSha256: digest(response), expectedRevision: 0, index: 0,
    note: 'Reviewed the original provider-published sample address and native geometry.' });
  requireValue(decision.decision.revision === 1 && decision.decision.current.index === 0,
    'The current original decision differs from this receiving run');
  const exported = await native('export', { workspace: 'locations', id: 'mcp-native-reverse',
    responseSha256: digest(response), expectedRevision: 1 });
  const repeated = await native('export', { workspace: 'locations', id: 'mcp-native-reverse',
    responseSha256: digest(response), expectedRevision: 1 });
  requireValue(repeated.exportId === exported.exportId && repeated.manifest.identity === exported.manifest.identity,
    'Reviewed export did not reopen the same customer bundle');
  await stage('mcp-source-review-and-decision', { requestId: imported.request.id, candidates: candidates.total,
    decisionRevision: 1, exportId: exported.exportId, deliveryIdentity: exported.manifest.identity });

  let readCalls = 0, resumedFile = null;
  async function receiveFile(workspace, exportId, file, expected, { demonstrateResume = false } = {}) {
    let offset = 0, readId, known = expected, resumed = false; const parts = [];
    do {
      const chunk = await call('file_read', { workspace, kind: 'delivery', id: exportId, file,
        offset, limit: demonstrateResume && offset === 0 ? 128 : 65536, ...(known ? { expectedSha256: known.sha256 } : {}), ...(readId ? { readId } : {}) });
      readCalls++;
      const bytes = Buffer.from(chunk.data, 'base64');
      requireValue(chunk.encoding === 'base64' && bytes.toString('base64') === chunk.data &&
        chunk.offset === offset && chunk.bytesRead === bytes.length && chunk.file.name === file,
        'Original file chunk changed its selection or byte offset');
      if (!known) known = chunk.file;
      requireValue(chunk.file.bytes === known.bytes && chunk.file.sha256 === known.sha256,
        'Original file snapshot changed during receiving');
      parts.push(bytes); offset += bytes.length;
      requireValue(chunk.nextOffset === (offset < known.bytes ? offset : null), 'Original file continuation is not contiguous');
      readId = chunk.nextOffset === null ? undefined : chunk.readId;
      if (demonstrateResume && !resumed && readId) {
        await call('file_release', { workspace, readId }); readId = undefined; resumed = true;
      }
      if (chunk.nextOffset === null) break;
    } while (true);
    const complete = Buffer.concat(parts);
    requireValue(complete.length === known.bytes && digest(complete) === known.sha256, 'Received original file differs from its SHA256');
    if (resumed) resumedFile = { workspace, exportId, file, bytes: complete.length, sha256: known.sha256 };
    return complete;
  }
  async function receiveBundle(workspace, exported, name) {
    const root = join(output, name);
    const manifestBytes = await receiveFile(workspace, exported.exportId, 'manifest.json');
    const manifest = JSON.parse(manifestBytes);
    requireValue(JSON.stringify(manifest) === JSON.stringify(exported.manifest), 'Received export manifest differs from reviewed native export');
    for (const file of manifest.files) {
      const name = relativeFile(file.name);
      const body = await receiveFile(workspace, exported.exportId, name, file,
        { demonstrateResume: name === 'response.json' && workspace === 'locations' });
      await atomic(join(root, name), body);
    }
    await atomic(join(root, 'manifest.json'), manifestBytes);
    const delivery = await GeocodeDelivery.open(root);
    requireValue(delivery.bytes().equals(response), 'Reopened customer bundle changed native provider bytes');
    return { directory: root, identity: delivery.identity, responseSha256: delivery.responseSha256,
      files: manifest.files.length, bytes: manifest.files.reduce((n, file) => n + file.bytes, 0), manifestSha256: digest(manifestBytes) };
  }
  const received = await receiveBundle('locations', exported, 'received-main');
  requireValue(resumedFile, 'The original response did not exercise offset-resume');
  await stage('mcp-complete-customer-received', { ...received, resumedFile, readCalls });

  const { chromium } = await imp(args.playwright);
  browser = await chromium.launch({ executablePath: args.browser, headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1060 } }), pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto(activeWorkspace.browserUrl, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'mcp-native-reverse', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#review-id')?.textContent === 'mcp-native-reverse');
  requireValue(await page.locator('#candidate-list input[type=radio]').first().isChecked(),
    'Browser and MCP do not share the same saved candidate decision');
  await page.screenshot({ path: join(output, 'mcp-operator.png'), fullPage: true });
  activeCustomer = await native('customer', { workspace: 'locations', action: 'open', exportId: exported.exportId });
  const customer = await browser.newPage({ viewport: { width: 1440, height: 1060 } });
  customer.on('pageerror', error => pageErrors.push(error.message));
  await customer.goto(activeCustomer.browserUrl, { waitUntil: 'domcontentloaded' });
  await customer.waitForFunction(() => document.querySelector('#review-state')?.textContent === 'CANDIDATES');
  await customer.screenshot({ path: join(output, 'mcp-customer.png'), fullPage: true });
  requireValue(pageErrors.length === 0, 'Original operator/customer browser failed: ' + pageErrors.join('; '));
  await browser.close(); browser = null;
  await native('customer', { workspace: 'locations', action: 'close', exportId: exported.exportId, instanceId: activeCustomer.instanceId });
  activeCustomer = null;
  await stage('mcp-shared-operator-and-customer', { workspaceIdentity: identity, deliveryIdentity: exported.manifest.identity,
    decisionRevision: 1, browserErrors: pageErrors });

  activeBuyer = await call('open', { workspace: 'customer' });
  const packages = await native('inspect', { workspace: 'customer', view: 'packages', limit: 100 });
  const selected = packages.rows.find(row => row.identity === buyerComplete.selectedMerchant.packageIdentity);
  requireValue(selected, 'Original Buyer-selected merchant package is missing');
  const adopted = await native('adopt_buyer', { workspace: 'customer', id: 'mcp-native-buyer', productId: 'reverse',
    buyer: 'retained', intentId: buyerComplete.intentId, packageId: selected.packageId });
  requireValue(adopted.responseSha256 === digest(response) &&
    adopted.merchantSelection.packageIdentity === buyerComplete.selectedMerchant.packageIdentity &&
    adopted.merchantSelection.termsSha256 === buyerComplete.selectedMerchant.termsSha256,
    'MCP Buyer adoption changed the actual selected package or response');
  const buyerExport = await native('export', { workspace: 'customer', id: adopted.request.id,
    responseSha256: adopted.responseSha256, expectedRevision: adopted.decision.revision });
  const receivedBuyer = await receiveBundle('customer', buyerExport, 'received-buyer');
  requireValue(buyerExport.manifest.files.some(file => file.name === 'source/buyer-result.json'),
    'The complete Buyer delivery omitted its original native result');
  await stage('mcp-original-buyer-recovered', { intentId: buyerComplete.intentId, packageId: selected.packageId,
    packageIdentity: selected.identity, exportId: buyerExport.exportId, ...receivedBuyer });

  const terms = activeWorkspace.native.configuration.terms;
  const packageV1 = await native('package', { workspace: 'locations' });
  await native('release', { workspace: 'locations', action: 'stage', packageId: packageV1.packageId,
    id: 'mcp-geocode-v1', label: 'Reviewed original geocoding terms through MCP' });
  const currentState = async () => (await status('locations')).native.merchant.state;
  async function activate(id) {
    const state = await currentState();
    if (state.active !== id) await native('release', { workspace: 'locations', action: 'activate',
      id, expectedGeneration: state.generation, reason: 'Reviewed original package and explicit payment terms' });
    return currentState();
  }
  async function challenge(id, expectedAmount) {
    const state = await activate(id);
    const running = await native('release', { workspace: 'locations', action: 'start', expectedGeneration: state.generation });
    const url = new URL('/geocode/reverse', running.url);
    for (const [name, value] of Object.entries(input)) url.searchParams.set(name, value);
    const response = await fetch(url, { redirect: 'error' }), bytes = Buffer.from(await response.arrayBuffer());
    requireValue(response.status === 402, 'Original merchant did not return its payment challenge');
    const encoded = response.headers.get('payment-required');
    const document = encoded ? JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) : JSON.parse(bytes);
    requireValue(Array.isArray(document.accepts) && document.accepts.some(option =>
      String(option.amount ?? option.maxAmountRequired) === expectedAmount && option.asset === terms.paymentOptions[0].asset &&
      option.payTo === terms.paymentOptions[0].payTo && option.network === terms.paymentOptions[0].network),
      'Original payment challenge differs from the reviewed native terms');
    await atomic(join(output, id + '.json'), bytes);
    await native('release', { workspace: 'locations', action: 'stop' });
    return { releaseId: id, generation: state.generation, httpStatus: response.status, amount: expectedAmount,
      challengeSha256: digest(bytes), mode: running.mode };
  }
  const firstChallenge = await challenge('mcp-geocode-v1', terms.paymentOptions[0].amount);
  const proposed = structuredClone(terms); proposed.paymentOptions[0].amount = '35000';
  const packageV2 = await native('package', { workspace: 'locations', terms: proposed });
  await native('release', { workspace: 'locations', action: 'stage', packageId: packageV2.packageId,
    id: 'mcp-geocode-v2', label: 'Reviewed revised geocoding terms through MCP' });
  const diff = await native('inspect', { workspace: 'locations', view: 'release-diff', before: 'mcp-geocode-v1', after: 'mcp-geocode-v2' });
  requireValue(JSON.stringify(diff).includes('35000'), 'Original release diff omitted proposed atomic terms');
  const secondChallenge = await challenge('mcp-geocode-v2', proposed.paymentOptions[0].amount);
  const beforeRollback = await currentState();
  await native('release', { workspace: 'locations', action: 'rollback', expectedGeneration: beforeRollback.generation,
    reason: 'Return to the reviewed original merchant price' });
  const rolledBack = await currentState();
  requireValue(rolledBack.active === 'mcp-geocode-v1', 'Original release rollback selected a different merchant');
  await stage('mcp-native-release-and-price-recovery', { firstChallenge, secondChallenge, active: rolledBack.active,
    generation: rolledBack.generation, packageIdentity: packageV1.manifest.identity });

  await call('close', { workspace: 'customer', instanceId: activeBuyer.instanceId }); activeBuyer = null;
  await call('close', { workspace: 'locations', instanceId: activeWorkspace.instanceId }); activeWorkspace = null;
  const closed = await call('workspaces');
  requireValue(closed.workspaces.every(row => !row.open && !row.customers.length) && closed.activeFileReads === 0,
    'Owned browsers or file reads remained open');
  await mcp.close(); mcp = null;
  const readOnlyEnvironment = { MCP_ACCESS_TOKEN: randomBytes(32).toString('base64url') };
  mcp = await startMerchantMcp({ configPath: initialized.configuration, port: 0, environment: readOnlyEnvironment });
  client = await openMerchantFileClient({ url: mcp.url + '/mcp', environment: readOnlyEnvironment, errorPrefix: 'OPENCAGE' });
  activeWorkspace = await call('open', { workspace: 'locations' });
  const reopened = await native('inspect', { workspace: 'locations', view: 'request', id: 'mcp-native-reverse' });
  const reopenedDelivery = await native('inspect', { workspace: 'locations', view: 'delivery', id: exported.exportId });
  requireValue(activeWorkspace.native.identity === identity && reopened.responseSha256 === digest(response) &&
    reopened.decision.revision === 1 && reopenedDelivery.identity === exported.manifest.identity,
    'Restart changed the original workspace, decision or customer delivery');
  requireValue(activeWorkspace.native.source.transport.initialized === false, 'Saved workspace restart initialized a provider connection');
  await atomic(join(output, 'reopened-status.json'), { workspaceIdentity: identity, requestId: reopened.request.id,
    responseSha256: reopened.responseSha256, decisionRevision: reopened.decision.revision,
    exportId: exported.exportId, deliveryIdentity: reopenedDelivery.identity, sourceInitialized: false });
  await call('close', { workspace: 'locations', instanceId: activeWorkspace.instanceId }); activeWorkspace = null;
  await mcp.close(); mcp = null;
  await stage('mcp-installed-restart', { workspaceIdentity: identity, exportId: exported.exportId,
    deliveryIdentity: reopenedDelivery.identity, toolCalls: calls, fileReadCalls: readCalls, sourceInitialized: false });
  report.outcome = 'COMPLETE'; report.finishedAt = new Date().toISOString();
  await atomic(join(output, 'journey.json'), report, { replace: true });
  console.log(JSON.stringify({ outcome: report.outcome, stages: report.stages.length, report: join(output, 'journey.json') }));
} catch (error) {
  report.outcome = 'FAILED'; report.finishedAt = new Date().toISOString();
  report.error = { name: error.name, code: error.code, message: error.message };
  await atomic(join(output, 'journey.json'), report, { replace: true }).catch(() => {});
  console.error(error.stack); process.exitCode = 1;
} finally {
  await browser?.close().catch(() => {});
  await mcp?.close().catch(() => {});
}
