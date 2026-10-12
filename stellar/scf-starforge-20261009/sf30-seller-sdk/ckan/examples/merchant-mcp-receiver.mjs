#!/usr/bin/env node
// MIT. One real retained CKAN source -> original merchant MCP -> receiver journey.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join, resolve, isAbsolute } from 'node:path';

const CAPTURE_SHA256 = 'cd035b97e42e71a41f2499298a528bcdbfb7288676b5a5511d8983336a84e3ca';
const CATALOG = 'https://ckan0.cf.opendata.inter.prod-toronto.ca';
const PACKAGE = 'f5aa9b07-da35-45e6-b31f-d6790eb9bd9b';
const RESOURCE = '7420a950-e62b-41da-826c-32d31c46e8f8';
const QUERY = 'where_physical_branch=1';
const PROJECTION = {
  record_id: { field: '_id', type: 'integer', nullable: false, encoding: 'native' },
  branch: { field: 'BranchName', type: 'string', nullable: false, encoding: 'native' },
  branch_code: { field: 'BranchCode', type: 'string', nullable: false, encoding: 'native' },
  physical_branch: { field: 'PhysicalBranch', type: 'integer', nullable: false, encoding: 'native' },
  service_tier: { field: 'Service Tier', type: 'string', nullable: false, encoding: 'native' },
  address: { field: 'Address', type: 'string', nullable: true, encoding: 'native' },
  ward: { field: 'WardName', type: 'string', nullable: true, encoding: 'native' },
};
const POLICY = { filters: ['physical_branch', 'service_tier'], ranges: [], sorts: ['branch', 'record_id'],
  defaultLimit: 20, maxLimit: 50, order: [{ column: 'record_id', direction: 'asc' }],
  maxRows: 5000, maxBytes: 16777216 };
const HELP = 'CKAN merchant MCP native receiver\n\n' +
  'node merchant-mcp-receiver.mjs --url MCP_LOOPBACK_URL --workspace ALIAS --input CAPTURE_ALIAS\n' +
  '  --out RECEIVING_DIRECTORY --release-id ORIGINAL_RELEASE_ID --intent-id ORIGINAL_BUYER_INTENT\n' +
  '  [--token-env MCP_ACCESS_TOKEN]\n\n' +
  'Use one dedicated existing CKAN project and the retained Toronto capture described in MCP_WORKFLOW.md.\n' +
  'The host binds its original release store, public onboarding terms and matching seller listener.\n' +
  'The same output directory resumes this same native case from its retained IDs.\n';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const stable = value => JSON.stringify(canonical(value));
const assert = (ok, message) => { if (!ok) throw new Error(message); };
const jsonBytes = value => JSON.stringify(value, null, 2) + '\n';
const sleep = ms => new Promise(done => setTimeout(done, ms));

function options(argv) {
  if (argv.includes('--help')) return null;
  const allowed = new Set(['--url', '--workspace', '--input', '--out', '--release-id', '--intent-id', '--token-env']);
  const found = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index], value = argv[index + 1];
    if (!allowed.has(name) || !value || Object.hasOwn(found, name)) throw new Error(HELP);
    found[name] = value;
  }
  for (const key of ['--url', '--workspace', '--input', '--out', '--release-id', '--intent-id'])
    if (!found[key]) throw new Error(HELP);
  const url = new URL(found['--url']);
  assert(url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port && !url.username &&
    !url.password && !url.hash, 'Use the original local merchant MCP listener URL.');
  assert(/^[A-Za-z0-9._:-]{1,128}$/.test(found['--intent-id']), 'Use the original stable SF88 intent ID.');
  for (const key of ['--workspace', '--input', '--release-id'])
    assert(/^[a-z0-9][a-z0-9_-]{0,63}$/.test(found[key]), 'Invalid original alias or release ID: ' + key);
  const tokenEnv = found['--token-env'] ?? 'MCP_ACCESS_TOKEN';
  assert(/^[A-Za-z_][A-Za-z0-9_]*$/.test(tokenEnv), 'Use an environment-variable name for the operator token.');
  const token = process.env[tokenEnv];
  assert(typeof token === 'string' && token.length >= 24, 'The original MCP operator access token is required.');
  return { url: url.href, workspace: found['--workspace'], input: found['--input'],
    directory: resolve(found['--out']), releaseId: found['--release-id'], intentId: found['--intent-id'], token };
}
async function optionalJson(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function member(name) {
  assert(typeof name === 'string' && name && !isAbsolute(name) && !name.includes('\\') &&
    !name.includes('\0') && name.split('/').every(part => part && part !== '.' && part !== '..'),
  'The original file list must contain relative package members.');
  return name;
}
const native = result => result.native ?? result;

async function receiveCase(config) {
  await mkdir(config.directory, { recursive: true, mode: 0o700 });
  const recordPath = join(config.directory, 'receiver-operation.json');
  const binding = { url: config.url, workspace: config.workspace, input: config.input,
    releaseId: config.releaseId, intentId: config.intentId, captureSha256: CAPTURE_SHA256 };
  let record = await optionalJson(recordPath);
  if (record) {
    assert(record.schema === 'stellar-forge.ckan-mcp-native-receiver.v1' &&
      stable(record.binding) === stable(binding), 'Resume this output with its original host, aliases and intended release.');
    if (record.state === 'COMPLETE') {
      process.stdout.write(JSON.stringify({ state: record.state, file: recordPath, ids: record.ids }) + '\n'); return;
    }
  } else record = { schema: 'stellar-forge.ckan-mcp-native-receiver.v1', binding, startedAt: new Date().toISOString(),
    state: 'RUNNING', ids: {}, calls: [], steps: [], files: [] };
  record.state = 'RUNNING'; delete record.error;
  let requestId = record.calls.length, workspaceInstance = null, sellerInstance = null;
  const persist = async () => {
    const temporary = recordPath + '.tmp';
    await writeFile(temporary, jsonBytes(record), { mode: 0o600 }); await rename(temporary, recordPath);
  };
  const checkpoint = async (step, value) => {
    record.steps.push({ step, at: new Date().toISOString(), value }); await persist();
    process.stdout.write(JSON.stringify({ step, value }) + '\n');
  };
  async function rpc(method, params) {
    const id = ++requestId;
    const response = await fetch(config.url, { method: 'POST', headers: {
      authorization: 'Bearer ' + config.token, 'content-type': 'application/json',
      accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2025-11-25',
    }, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }), signal: AbortSignal.timeout(150000) });
    const payload = await response.json();
    if (!response.ok || payload.error) throw Object.assign(new Error(payload.error?.message ?? 'MCP HTTP ' + response.status),
      { code: String(payload.error?.code ?? 'MCP_HTTP_ERROR') });
    if (payload.result?.isError) {
      const issue = payload.result.structuredContent ?? {};
      throw Object.assign(new Error(issue.reason ?? 'Original MCP operation failed.'), { code: issue.code ?? 'MCP_TOOL_ERROR' });
    }
    return payload.result;
  }
  async function tool(name, args = {}) {
    const startedAt = new Date().toISOString();
    try {
      const result = await rpc('tools/call', { name, arguments: args });
      const data = result.structuredContent ?? JSON.parse(result.content.find(item => item.type === 'text').text);
      record.calls.push({ name, startedAt, state: 'RETURNED' }); return data;
    } catch (error) { record.calls.push({ name, startedAt, state: 'ERROR', code: error.code ?? null }); throw error; }
  }
  const ck = (name, args = {}) => tool('merchant_ckan_' + name, { workspace: config.workspace, ...args });
  const status = () => ck('status', { limit: 100 });
  const operationId = state => state.native.operation?.id ?? null;
  async function finish(id) {
    const deadline = Date.now() + 150000;
    for (;;) {
      const state = await status(), operation = state.native.operation;
      assert(operation?.id === id, 'Another original operation replaced the selected action; reconcile current project state.');
      if (operation.state !== 'RUNNING') {
        assert(operation.state === 'COMPLETE', 'Original operation ' + id + ': ' + operation.state + ' ' + (operation.error?.code ?? ''));
        return operation.result;
      }
      assert(Date.now() < deadline, 'Follow the retained original operation ' + id + ' after this receiving deadline.');
      await sleep(500);
    }
  }
  async function change(name, args = {}) {
    const before = await status();
    assert(!before.native.active, 'The original project already has an active operation.');
    const accepted = await ck(name, { ...args, expectedOperationId: operationId(before) });
    assert(typeof accepted.operationId === 'string', 'The native bridge did not return its original operation ID.');
    record.currentNativeOperationId = accepted.operationId; await persist();
    const result = await finish(accepted.operationId);
    delete record.currentNativeOperationId; await persist(); return result;
  }
  async function receiveFiles(kind, itemId) {
    const listed = await ck('files', { kind, itemId });
    assert(Array.isArray(listed.files) && listed.files.length > 0 &&
      new Set(listed.files.map(file => file.file)).size === listed.files.length,
      'The original saved file set is empty or contains duplicate members.');
    if (kind === 'merchant') assert(listed.manifestSha256 === record.ids.manifestSha256 &&
      listed.files.some(file => file.file === 'merchant-manifest.json' && file.sha256 === listed.manifestSha256) &&
      listed.files.some(file => file.file === 'handlers.mjs'), 'Receive the complete selected original merchant package.');
    const received = [];
    for (const file of listed.files) {
      const name = member(file.file), target = join(config.directory, 'received', kind, itemId, name);
      let previous;
      try { previous = await readFile(target); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (previous && previous.length === file.bytes && sha256(previous) === file.sha256) {
        received.push({ kind, itemId, file: name, bytes: file.bytes, sha256: file.sha256 }); continue;
      }
      let readId, offset = 0, chunks = 0, metadata, complete = false;
      const parts = [];
      try {
        do {
          const part = await ck('file_read', { kind, itemId, file: name, expectedSha256: file.sha256,
            offset, limit: chunks === 0 ? 4096 : 196608, ...(readId ? { readId } : {}) });
          const bytes = Buffer.from(part.data, 'base64');
          assert(part.encoding === 'base64' && part.offset === offset && bytes.length === part.bytesRead &&
            part.file.sha256 === file.sha256 && part.file.bytes === file.bytes, 'Original retained chunk identity changed.');
          parts.push(bytes); chunks++; readId = part.readId; metadata = part.file;
          offset += bytes.length; complete = part.nextOffset === null;
          assert(complete ? offset === file.bytes : part.nextOffset === offset, 'Original file continuation offset changed.');
        } while (!complete);
      } finally { if (readId && !complete) await ck('file_release', { readId }).catch(() => {}); }
      const bytes = Buffer.concat(parts);
      assert(bytes.length === metadata.bytes && sha256(bytes) === metadata.sha256, 'Received original file SHA256 mismatch.');
      await mkdir(dirname(target), { recursive: true, mode: 0o700 }); await writeFile(target, bytes, { mode: 0o600 });
      received.push({ kind, itemId, file: name, bytes: bytes.length, sha256: metadata.sha256, chunks });
    }
    record.files = record.files.filter(file => file.kind !== kind || file.itemId !== itemId).concat(received);
    await checkpoint('received original ' + kind + ' files', received); return received;
  }
  try {
    const initialized = await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {},
      clientInfo: { name: 'ckan-original-native-receiver', version: '1' } });
    assert(initialized.protocolVersion === '2025-11-25', 'Original MCP protocol differs.');
    const listed = await rpc('tools/list', {});
    for (const name of ['merchant_ckan_open', 'merchant_ckan_source_save', 'merchant_ckan_publication_create',
      'merchant_ckan_publish', 'merchant_ckan_merchant_stage', 'merchant_ckan_file_read', 'merchant_activate', 'merchant_start'])
      assert(listed.tools.some(tool => tool.name === name), 'Original registered tool missing: ' + name);
    const opened = await ck('open'); workspaceInstance = opened.instanceId;
    assert(opened.releaseStoreMatches === true && opened.native.catalogOrigin === CATALOG,
      'Declare this CKAN source and the selected original project seller-releases store.');
    const projectIdentity = { catalogOrigin: opened.native.catalogOrigin, createdAt: opened.native.createdAt };
    if (record.project) assert(stable(record.project) === stable(projectIdentity), 'The alias now selects a different project.');
    else {
      assert(Object.values(opened.paging).every(page => page.total === 0),
        'Use a dedicated empty original CKAN project for this new MCP receiving case.');
      record.project = projectIdentity;
    }
    await checkpoint('opened original registered workbench', { instanceId: workspaceInstance,
      releaseStoreMatches: opened.releaseStoreMatches, project: record.project });
    // Read the borrowed original UI API through its existing private session.
    const browser = new URL(opened.browserUrl);
    const uiStatus = await fetch(browser.origin + '/api/status', { headers: { authorization: 'Bearer ' + browser.hash.slice(1) },
      signal: AbortSignal.timeout(10000) });
    const uiState = await uiStatus.json();
    assert(uiStatus.status === 200 && uiState.createdAt === record.project.createdAt &&
      uiState.catalogOrigin === CATALOG, 'Browser and MCP do not own the same original workbench.');

    let current = await status();
    if (current.native.active && current.native.active === record.currentNativeOperationId) {
      await finish(record.currentNativeOperationId);
      delete record.currentNativeOperationId; await persist(); current = await status();
    }
    assert(!current.native.active, 'Follow the original active operation before resuming this receiving case.');
    let edition = current.native.editions.find(item => item.manifestSha256 === CAPTURE_SHA256);
    if (!edition) {
      const input = await ck('inputs', { input: config.input });
      assert(input.file.sha256 === CAPTURE_SHA256, 'Select the exact retained Toronto reference capture.');
      edition = await change('import', { input: config.input, expectedSha256: input.file.sha256 });
    }
    record.ids.edition = edition.id;
    const inspected = native(await ck('edition', { editionId: edition.id }));
    assert(inspected.rowCount === 112 && inspected.pageCount === 3 &&
      inspected.resourceId === RESOURCE && inspected.packageId === PACKAGE, 'Retained source differs from the real reference edition.');
    await checkpoint('original retained provider edition', { id: edition.id, rows: inspected.rowCount,
      pages: inspected.pageCount, manifestSha256: inspected.manifestSha256 });

    current = await status();
    let source = current.native.sources.find(item => item.id === record.ids.source) ??
      current.native.sources.find(item => item.editionId === edition.id && item.query === 'branches' &&
        stable(item.projection) === stable(PROJECTION));
    if (!source) {
      const before = await status();
      record.sourceDispatch = { expectedOperationId: operationId(before), beforeCount: before.paging.sources.total };
      await persist();
      const accepted = await ck('source_save', { editionId: edition.id, expectedCaptureSha256: CAPTURE_SHA256,
        title: 'Toronto library branch data', query: 'branches', projection: PROJECTION,
        expectedOperationId: record.sourceDispatch.expectedOperationId });
      record.currentNativeOperationId = accepted.operationId; await persist();
      source = await finish(accepted.operationId);
      delete record.currentNativeOperationId; await persist();
    }
    record.ids.source = source.id;
    await checkpoint('reviewed seven original fields', { sourceId: source.id, sourceSha256: source.sha256, projection: PROJECTION });
    if (record.sourceDispatch && !record.oldBaselineChecked) {
      const before = await status(); let outcome;
      try { outcome = await ck('source_save', { editionId: edition.id, expectedCaptureSha256: CAPTURE_SHA256,
        title: 'Toronto library branch data', query: 'branches', projection: PROJECTION,
        expectedOperationId: record.sourceDispatch.expectedOperationId }); }
      catch (error) { outcome = { code: error.code ?? null }; }
      const after = await status();
      assert(outcome?.code === 'CKAN_OPERATION_CHANGED' && operationId(after) === operationId(before) &&
        after.paging.sources.total === record.sourceDispatch.beforeCount + 1,
      'An old source baseline created another native operation or duplicate source.');
      record.oldBaselineChecked = true;
      await checkpoint('old operation baseline retained one source', { sourceId: source.id,
        currentOperationId: operationId(after), sourceCount: after.paging.sources.total, response: outcome });
    }

    current = await status();
    let publication = current.native.publications.find(item => item.id === record.ids.publication) ??
      current.native.publications.find(item => item.sourceId === source.id);
    if (!publication) publication = await change('publication_create', { sourceId: source.id, ...POLICY });
    record.ids.publication = publication.id;
    let detail = native(await ck('publication', { publicationId: publication.id, query: QUERY }));
    assert(detail.run.data.candidate.dataset.rowCount === 112 && detail.detail.preview.page.total === 100 &&
      detail.detail.preview.rows.length === 20 && detail.detail.preview.rows.every(row => row.physical_branch === 1),
    'Original publication customer query differs from the retained source.');
    const candidate = detail.run.data.candidate; record.ids.candidateDigest = candidate.candidateDigest;
    record.ids.snapshot = candidate.dataset.snapshot;
    await checkpoint('original dataset query through MCP', { publicationId: publication.id, query: QUERY,
      snapshot: candidate.dataset.snapshot, candidateDigest: candidate.candidateDigest, matched: 100, displayed: 20 });
    if (detail.run.state === 'READY') {
      await change('publication_review', { publicationId: publication.id, expectedCandidateDigest: candidate.candidateDigest,
        reviewer: 'C271 merchant MCP native receiver',
        note: 'Reviewed the complete 112-row retained Toronto edition, explicit seven-field projection and original 100-branch query.' });
      detail = native(await ck('publication', { publicationId: publication.id, query: QUERY }));
    }
    if (detail.run.state !== 'PUBLISHED')
      await change('publish', { publicationId: publication.id, reviewId: detail.run.data.review.id });
    detail = native(await ck('publication', { publicationId: publication.id, query: QUERY }));
    assert(detail.run.state === 'PUBLISHED', 'Original dataset publication did not finish.');
    await checkpoint('published original dataset', { publicationId: publication.id, state: detail.run.state });
    await receiveFiles('source', source.id);

    current = await status();
    let exported = current.native.exports.find(item => item.id === record.ids.export) ??
      current.native.exports.find(item => item.publicationId === publication.id);
    if (!exported) exported = await change('merchant_export', { publicationId: publication.id,
      expectedCandidateDigest: candidate.candidateDigest });
    record.ids.export = exported.id; record.ids.manifestSha256 = exported.manifestSha256;
    await receiveFiles('merchant', exported.id);
    if (!exported.staged) exported = await change('merchant_stage', { exportId: exported.id,
      expectedManifestSha256: exported.manifestSha256, releaseId: config.releaseId, label: 'Toronto CKAN original MCP delivery' });
    const release = await tool('merchant_inspect', { id: config.releaseId });
    assert(release.id === config.releaseId && /^[a-f0-9]{64}$/.test(release.digest), 'CKAN stage did not join the original merchant store.');
    let merchant = await tool('merchant_status');
    if (merchant.state.active !== config.releaseId) {
      const comparison = await tool('merchant_compare', { to: config.releaseId });
      await tool('merchant_activate', { id: config.releaseId, expectedDigest: release.digest,
        expectedGeneration: comparison.generation, reason: 'Operate the reviewed retained Toronto CKAN edition' });
      merchant = await tool('merchant_status');
    }
    if (merchant.operator.managesRunningSeller) {
      assert(merchant.runtime.observed?.releaseId === config.releaseId &&
        record.ids.sellerInstance === merchant.operator.instanceId, 'Reconcile the already owned original seller before this receiving case.');
    } else merchant = await tool('merchant_start', { expectedGeneration: merchant.state.generation, expectedDigest: release.digest });
    sellerInstance = merchant.operator.instanceId; record.ids.sellerInstance = sellerInstance;
    assert(sellerInstance, 'Original merchant startup did not return its owned instance.');
    await persist();
    const catalog = await tool('merchant_catalog', { instanceId: sellerInstance });
    await checkpoint('original shared-store release and seller', { releaseId: config.releaseId, digest: release.digest,
      generation: merchant.state.generation, instanceId: sellerInstance, mode: catalog.health.mode });

    const offer = native(await ck('buyer_offer', { exportId: exported.id, query: QUERY }));
    assert(offer.snapshot === candidate.dataset.snapshot && /^[a-f0-9]{64}$/.test(offer.offerSha256),
      'Original seller offer does not select the published dataset.');
    const customerUrl = new URL(offer.url), challengeUrl = new URL(customerUrl.pathname + customerUrl.search, offer.seller);
    const challenge = await fetch(challengeUrl, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    const challengeBytes = Buffer.from(await challenge.arrayBuffer());
    assert(challenge.status === 402 && challengeBytes.length > 0, 'Original seller did not return its native payment challenge.');
    await writeFile(join(config.directory, 'seller-challenge.json'), challengeBytes, { mode: 0o600 });
    await writeFile(join(config.directory, 'seller-offer.json'), jsonBytes(offer), { mode: 0o600 });
    await checkpoint('actual original seller challenge and buyer offer', { status: challenge.status,
      bytes: challengeBytes.length, sha256: sha256(challengeBytes), offerSha256: offer.offerSha256, snapshot: offer.snapshot });

    current = await status();
    let buyer = current.native.buyerRequests.find(item => item.id === record.ids.buyer) ??
      current.native.buyerRequests.find(item => item.exportId === exported.id && item.snapshot === candidate.dataset.snapshot);
    if (!buyer) buyer = await change('buyer_prepare', { exportId: exported.id, query: QUERY,
      intentId: config.intentId, acceptIndex: 0, offerSha256: offer.offerSha256 });
    record.ids.buyer = buyer.id; record.ids.buyerConfigSha256 = buyer.configSha256;
    const buyerFiles = await receiveFiles('buyer', buyer.id);
    assert(buyerFiles.some(file => file.sha256 === buyer.configSha256), 'Received original SF88 configuration identity differs.');
    await tool('merchant_stop', { instanceId: sellerInstance }); sellerInstance = null;
    await ck('close', { instanceId: workspaceInstance }); workspaceInstance = null;
    const reopened = await ck('open'); workspaceInstance = reopened.instanceId;
    const final = native(await ck('publication', { publicationId: publication.id, query: QUERY }));
    assert(final.run.state === 'PUBLISHED' && final.detail.preview.page.total === 100 &&
      reopened.native.editions.some(item => item.id === edition.id && item.manifestSha256 === CAPTURE_SHA256) &&
      reopened.native.sources.some(item => item.id === source.id) &&
      reopened.native.exports.some(item => item.id === exported.id && item.manifestSha256 === record.ids.manifestSha256) &&
      reopened.native.buyerRequests.some(item => item.id === buyer.id && item.configSha256 === buyer.configSha256),
    'The reopened original model differs from the completed source/merchant/customer operation.');
    await checkpoint('reopened same original project and delivery', { ids: record.ids, state: final.run.state,
      matched: final.detail.preview.page.total, instanceId: workspaceInstance });
    await ck('close', { instanceId: workspaceInstance }); workspaceInstance = null;
    record.state = 'COMPLETE'; record.completedAt = new Date().toISOString(); await persist();
    process.stdout.write(JSON.stringify({ state: record.state, file: recordPath, ids: record.ids }) + '\n');
  } catch (error) {
    record.state = 'FAILED'; record.error = { code: error.code ?? null, message: error.message };
    await persist().catch(() => {}); throw error;
  } finally {
    const cleanup = [];
    if (sellerInstance) {
      try {
        const current = await tool('merchant_status');
        if (current.operator.instanceId === sellerInstance) {
          await tool('merchant_stop', { instanceId: sellerInstance });
          cleanup.push({ kind: 'seller', instanceId: sellerInstance, state: 'STOPPED' });
        } else cleanup.push({ kind: 'seller', instanceId: sellerInstance, state: 'OWNERSHIP_CHANGED' });
      } catch (error) { cleanup.push({ kind: 'seller', instanceId: sellerInstance, state: 'RECONCILE', code: error.code ?? null }); }
    }
    if (workspaceInstance) {
      try { await ck('close', { instanceId: workspaceInstance });
        cleanup.push({ kind: 'workspace', instanceId: workspaceInstance, state: 'CLOSED' }); }
      catch (error) { cleanup.push({ kind: 'workspace', instanceId: workspaceInstance, state: 'RECONCILE', code: error.code ?? null }); }
    }
    if (cleanup.length) { record.cleanup = cleanup; await persist().catch(() => {}); }
  }
}
try {
  const selected = options(process.argv.slice(2));
  if (!selected) process.stdout.write(HELP);
  else await receiveCase(selected);
} catch (error) {
  process.stderr.write((error.code ? error.code + ': ' : '') + error.message + '\n');
  process.exitCode = 1;
}
