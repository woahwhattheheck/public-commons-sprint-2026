// MIT. One original merchant release → signed live catalog → retirement journey.
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initReleaseStore, stageRelease, inspectRelease } from './releases.mjs';
import { startReleaseConsole } from './release-console.mjs';
import { applyReleaseCatalog, reviewReleaseCatalog, readReleaseCatalogConfig, RELEASE_CATALOG_CONFIG } from './release-catalog.mjs';
import { openCatalogOperator, requestCatalogOperator, POLICY_SCHEMA } from '../sf60-durable-catalog-transaction/operator.mjs';

const work = await mkdtemp(join(tmpdir(), 'sf82-catalog-'));
const root = join(work, 'releases'), directory = join(work, 'catalog');
const policyFile = join(work, 'policy.json'), keyFile = join(work, 'seller.pem');
const configFile = join(work, 'connection.json');
const save = (path, value) => writeFile(path, JSON.stringify(value, null, 2) + '\n', { mode: 0o600 });
const example = name => readFile(new URL('./examples/' + name, import.meta.url), 'utf8').then(JSON.parse);
let catalog, consoleSession, quoteSignatures = 0, withdrawalSignatures = 0;
try {
  await initReleaseStore(root);
  const spec = await example('upstream-openapi.json');
  spec.paths['/archive'] = structuredClone(spec.paths['/dataset']);
  spec.paths['/archive'].get.operationId = 'archive';
  const selections = await example('upstream-selections.json');
  selections[0].accepts.push({ ...selections[0].accepts[0], amount: '40000', asset: 'DEMO_NONPAYABLE_ASSET_B' });
  selections.push({ ...structuredClone(selections[0]), path: '/archive' });
  const bindings = [{ method: 'GET', path: '/dataset', id: 'dataset', response: { rows: [] }, validateInput: true },
    { method: 'GET', path: '/archive', id: 'archive', response: { rows: [] }, validateInput: true }];
  const specFile = join(work, 'openapi.json'), selectionsFile = join(work, 'selections.json'), bindingsFile = join(work, 'bindings.json');
  await save(specFile, spec); await save(selectionsFile, selections); await save(bindingsFile, bindings);
  const inputs = { spec: specFile, config: selectionsFile, bindings: bindingsFile, runtime: { port: 0 } };
  await stageRelease(root, { ...inputs, id: 'first' });
  selections[0].accepts[0].amount = '25000'; selections[0].accepts[1].amount = '45000';
  await save(selectionsFile, [selections[0]]); await save(bindingsFile, [bindings[0]]);
  await stageRelease(root, { ...inputs, id: 'second' });

  // Compose the original OAuth declaration into a retained release without
  // configuring merchant credentials or contacting either source endpoint.
  const oauth = JSON.parse(await readFile(new URL('../sf30-seller-sdk/examples/upstreams-oauth.json', import.meta.url)));
  oauth.bindings.existingDataset.oauth2.clientIdEnv = 'SF82_CATALOG_JOURNEY_CLIENT_ID';
  oauth.bindings.existingDataset.oauth2.clientSecretEnv = 'SF82_CATALOG_JOURNEY_CLIENT_SECRET';
  const oauthFile = join(work, 'oauth-upstreams.json');
  await save(oauthFile, oauth);
  await save(bindingsFile, [{ method: 'GET', path: '/dataset', id: 'dataset', handler: 'existingDataset', validateInput: true }]);
  await stageRelease(root, { ...inputs, id: 'oauth-retained', upstreams: oauthFile });
  await save(oauthFile, { changedAfterStaging: true });
  const oauthRetained = await inspectRelease(root, 'oauth-retained');
  assert.deepEqual(oauthRetained.routes[0].upstream.oauth2, oauth.bindings.existingDataset.oauth2);

  const keys = generateKeyPairSync('ed25519');
  await save(policyFile, { schema: POLICY_SCHEMA, sellers: [{ sellerId: 'merchant-1',
    pinnedPublicKey: keys.publicKey.export({ format: 'pem', type: 'spki' }),
    allowedOrigins: ['https://dataset.example'], allowedRecipients: [selections[0].accepts[0].payTo],
    allowedNetworks: ['stellar:testnet'], allowedSchemes: ['exact'] }] });
  await save(configFile, { schema: RELEASE_CATALOG_CONFIG, directory: './catalog', sellerId: 'merchant-1',
    sourceURL: 'https://dataset.example/_seller/offers', keyFile: './seller.pem' });
  const config = await readReleaseCatalogConfig(configFile);
  catalog = await openCatalogOperator({ directory, policyFile, createEmpty: true, controlTransport: 'loopback' });
  consoleSession = await startReleaseConsole(root, { port: 0, catalogConfig: config });
  const call = async (path, input, extra = {}) => {
    const headers = { 'x-release-token': consoleSession.token, ...extra };
    const options = { headers, redirect: 'error' };
    if (input !== undefined) Object.assign(options, { method: 'POST', body: JSON.stringify(input),
      headers: { ...headers, origin: headers.origin ?? consoleSession.url, 'content-type': 'application/json' } });
    const response = await fetch(consoleSession.url + path, options);
    return { code: response.status, value: await response.json() };
  };
  const ok = async (path, input) => {
    const result = await call(path, input); assert.equal(result.code, 200, JSON.stringify(result.value)); return result.value;
  };
  const currentCatalog = () => requestCatalogOperator({ directory, operation: 'status' });
  const resources = async () => {
    const status = await currentCatalog();
    const response = await fetch(status.discoveryOrigin + '/discovery/resources?limit=20', { redirect: 'error' });
    assert.equal(response.status, 200); return response.json();
  };
  assert.equal((await fetch(consoleSession.url + '/api/catalog?id=first')).status, 401);
  assert.equal((await call('/api/catalog/review', { id: 'first' })).code, 409);
  await ok('/api/activate', { id: 'first', expectedGeneration: 0, reason: 'Original merchant release' });
  let state = await ok('/api/run', { expectedGeneration: 1 });
  const challenge = await fetch(state.runtime.observed.listener + '/api/dataset?region=north');
  assert.equal(challenge.status, 402); await challenge.arrayBuffer();
  const firstReview = await ok('/api/catalog/review', { id: 'first' });
  assert.equal(firstReview.changes.length, 2);
  assert.equal((await currentCatalog()).committedOperations, 0);
  // The configured private key did not exist while this complete review ran.
  await writeFile(keyFile, keys.privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600 });
  assert.equal((await call('/api/catalog/apply', { reviewId: firstReview.id }, { origin: 'https://other.example' })).code, 403);
  let result = await ok('/api/catalog/apply', { reviewId: firstReview.id });
  assert.equal(result.decision, 'COMMITTED'); quoteSignatures += result.signaturesIssued;
  assert.equal(result.signaturesIssued, 4);
  assert.ok(result.status.rows.every(row => row.state === 'MATCHES'));
  assert.equal((await resources()).resources.length, 2);
  const unchanged = await ok('/api/catalog/review', { id: 'first' });
  result = await ok('/api/catalog/apply', { reviewId: unchanged.id });
  assert.equal(result.decision, 'UNCHANGED'); assert.equal(result.signaturesIssued, 0);

  // Identical offer bytes still require publication when the public export URL
  // changes. The original batch updates that provenance with fresh proofs.
  const movedConfig = { ...config, sourceURL: 'https://dataset.example/_seller/offers-v2' };
  const moved = await reviewReleaseCatalog(root, { config: movedConfig, releaseId: 'first' });
  assert.equal(moved.changes.length, 2);
  assert.ok(moved.changes.every(row => row.before.sourceSha256 === row.sourceSha256));
  result = await applyReleaseCatalog(root, { config: movedConfig, review: moved });
  quoteSignatures += result.signaturesIssued;
  assert.ok(result.status.rows.every(row => row.state === 'MATCHES' && row.before.sourceURL === movedConfig.sourceURL));

  await ok('/api/activate', { id: 'second', expectedGeneration: 1, reason: 'Revised price and retained archive history' });
  state = await ok('/api/restart', { expectedGeneration: 2, instanceId: state.console.instanceId });
  const upgrade = await ok('/api/catalog/review', { id: 'second' });
  assert.equal(upgrade.changes[0].before.payment[0].amount, '20000');
  assert.equal(upgrade.changes[0].payment[0].amount, '25000');
  result = await ok('/api/catalog/apply', { reviewId: upgrade.id }); quoteSignatures += result.signaturesIssued;
  assert.equal(result.status.rows[0].before.sequence, 3);
  const beforeRetirement = await ok('/api/catalog/review', { id: 'second' });
  const retirement = await ok('/api/catalog/review', { id: 'first', action: 'withdraw', routeId: 'archive', reason: 'Archived API retired' });
  result = await ok('/api/catalog/apply', { reviewId: retirement.id }); withdrawalSignatures += result.signaturesIssued;
  assert.equal(result.receipt.sequence, 3);
  await assert.rejects(applyReleaseCatalog(root, { config, review: beforeRetirement }), { code: 'RELEASE_CATALOG_REVIEW_STALE' });
  assert.equal((await resources()).resources.length, 1);
  const history = await ok('/api/catalog?id=first');
  assert.equal(history.rows.find(row => row.routeId === 'archive').state, 'WITHDRAWN');
  assert.equal(history.rows.find(row => row.routeId === 'dataset').state, 'DIFFERS');

  await catalog.close();
  catalog = await openCatalogOperator({ directory, policyFile, controlTransport: 'loopback' });
  const resumed = await ok('/api/catalog?id=second');
  assert.equal(resumed.rows[0].state, 'MATCHES');
  assert.equal((await currentCatalog()).committedOperations, 6);
  assert.equal((await resources()).resources.length, 1);
  await ok('/api/stop', { instanceId: state.console.instanceId });
  assert.equal((await ok('/api/catalog?id=second')).runtime.running, false);
  console.log(JSON.stringify({ result: 'PASS', originalCatalogOperations: 6,
    originalQuoteSignatures: quoteSignatures, originalWithdrawalSignatures: withdrawalSignatures,
    journey: ['original retained releases', 'real running seller', 'review without key access',
      'credential-free original OAuth staging', 'authenticated original catalog batch',
      'all payment alternatives signed', 'exact-source no-op', 'source URL update',
      'running release upgrade', 'original seller withdrawal', 'stale-head refusal', 'catalog restart reconciliation'],
    paymentCalls: 0, hostedActions: 0 }));
} finally {
  await consoleSession?.close(); await catalog?.close(); await rm(work, { recursive: true, force: true });
}
