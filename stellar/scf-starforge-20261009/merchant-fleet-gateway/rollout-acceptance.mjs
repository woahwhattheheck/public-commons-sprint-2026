// MIT. One original-source merchant rollout journey. No facilitator or chain calls.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as pause } from 'node:timers/promises';
import { readSellerConfig, startSellerService } from '../sf30-seller-sdk/serve.mjs';
import { main as launch } from './cli.mjs';
import { run as control } from './control.mjs';

function exchange(url, path, { host, method = 'GET', body, hold = false } = {}) {
  let call;
  const result = new Promise((done, fail) => {
    call = request({ hostname: '127.0.0.1', port: Number(new URL(url).port), path, method,
      headers: { ...(host ? { host } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) }) } }, res => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk)); res.on('error', fail);
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    call.on('error', fail);
    if (hold) { call.flushHeaders(); call.write(body.slice(0, 1)); }
    else call.end(body);
  });
  return hold ? { result, finish: () => call.end(body.slice(1)), abort: () => call.destroy() } : result;
}
function sameChallenge(actual, direct) {
  assert.equal(actual.status, 402);
  assert.deepEqual(actual.body, direct.body);
  assert.equal(actual.headers['payment-required'], direct.headers['payment-required']);
}
async function until(read, predicate) {
  for (let i = 0; i < 100; i++) {
    const value = await read(); if (predicate(value)) return value;
    await pause(20);
  }
  throw new Error('Original gateway lifecycle did not reach expected state');
}

async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'scf-original-fleet-rollout-'));
  const state = join(directory, 'state'), sessions = [];
  const sources = [], write = async (name, value) => {
    const path = join(directory, name);
    await writeFile(path, JSON.stringify(value), { mode: 0o600 }); sources.push(path); return path;
  };
  const status = () => control(['status', '--state', state]);
  const prepare = (manifest, revision = 1) => control(['prepare', '--state', state,
    '--manifest', manifest, '--expect', String(revision)]);
  let gateway, held;
  try {
    const original = JSON.parse(await readFile(new URL('../sf30-seller-sdk/examples/service.json', import.meta.url)));
    const alpha = 'alpha.scf-merchant.example', bravo = 'bravo.scf-merchant.example';
    await write('dataset.json', { merchant: 'alpha', value: 7 });
    const asset = Buffer.from('Original merchant downloadable inventory\n');
    const assetFile = join(directory, 'inventory.txt');
    await writeFile(assetFile, asset, { mode: 0o600 }); sources.push(assetFile);
    const alphaConfig = amount => {
      const config = structuredClone(original); config.publicOrigin = 'https://' + alpha;
      const read = config.routes[0];
      read.definition.payment.amount = amount; delete read.response;
      read.responseFile = './dataset.json'; read.admit = 'requireMerchantToken';
      config.routes.push({ id: 'quote', path: '/quote', admit: 'requireMerchantToken',
        definition: { ...structuredClone(read.definition), method: 'POST', bodyType: 'json', body: {} }, response: {} });
      return config;
    };
    const first = alphaConfig('10000'), second = alphaConfig('30000');
    second.routes.push({ id: 'records', path: '/records',
      definition: { ...structuredClone(second.routes[1].definition), method: 'PUT' }, response: {} });
    const other = structuredClone(original); other.publicOrigin = 'https://' + bravo;
    delete other.routes[0].response; delete other.routes[0].definition.outputExample;
    other.routes[0].responseAsset = { file: './inventory.txt',
      sha256: createHash('sha256').update(asset).digest('hex'), contentType: 'text/plain', downloadName: 'inventory.txt' };
    const configs = [first, second, other], paths = [];
    for (let index = 0; index < configs.length; index++) {
      const path = await write('seller-' + index + '.json', configs[index]); paths.push(path);
      sessions.push(await startSellerService({ config: await readSellerConfig(path), port: 0,
        handlers: { requireMerchantToken: context => Boolean(context.headers['x-merchant-token']) } }));
    }
    const tenant = (index, id, host) => ({ id, host, sellerConfig: paths[index],
      upstreamPort: Number(new URL(sessions[index].url).port), maxInFlight: 1 });
    const initial = { schema: 'stellar-forge.merchant-fleet.v1',
      tenants: [tenant(0, 'merchant-alpha', alpha), tenant(2, 'merchant-bravo', bravo)] };
    const proposed = structuredClone(initial); proposed.tenants[0] = tenant(1, 'merchant-alpha', alpha);
    const manifest = await write('fleet.json', initial), nextManifest = await write('next.json', proposed);
    const bad = structuredClone(second); bad.routes[0].definition.payment.amount = '40000';
    const badPath = await write('incorrect-seller.json', bad), invalid = structuredClone(proposed);
    invalid.tenants[0].sellerConfig = badPath;
    const invalidManifest = await write('invalid.json', invalid);
    gateway = await launch(['--state', state, '--manifest', manifest, '--port', '0', '--admin-port', '0']);
    assert.equal((await status()).revision, 1);
    assert.equal((await exchange(gateway.adminURL, '/_fleet/health')).status, 401);
    await assert.rejects(() => launch(['--state', state, '--port', '0', '--admin-port', '0']), /FLEET_STATE_ALREADY_OWNED/);
    await assert.rejects(() => prepare(invalidManifest), /offers\/routes\/admission drift/);
    assert.equal((await status()).revision, 1);
    const oldGet = await exchange(sessions[0].url, '/dataset');
    const oldPost = await exchange(sessions[0].url, '/quote', { method: 'POST', body: '{}' });
    const newGet = await exchange(sessions[1].url, '/dataset');
    const newPut = await exchange(sessions[1].url, '/records', { method: 'PUT', body: '{}' });
    const bravoGet = await exchange(sessions[2].url, '/dataset');
    sameChallenge(await exchange(gateway.publicURL, '/dataset', { host: alpha }), oldGet);
    sameChallenge(await exchange(gateway.publicURL, '/dataset', { host: bravo }), bravoGet);
    held = exchange(gateway.publicURL, '/quote', { host: alpha, method: 'POST', body: '{}', hold: true });
    await until(status, value => value.merchants[0].active === 1);
    const superseded = await prepare(nextManifest), prepared = await prepare(nextManifest);
    assert.notEqual(superseded.candidate.id, prepared.candidate.id);
    assert.equal((await readdir(join(state, 'snapshots'))).length, 2);
    const activated = await control(['activate', '--state', state, '--candidate', prepared.candidate.id, '--expect', '1']);
    assert.equal(activated.revision, 2);
    assert.equal(activated.retired[0].state, 'DRAINING');
    assert.equal((await exchange(gateway.publicURL, '/dataset', { host: alpha })).status, 503);
    sameChallenge(await exchange(gateway.publicURL, '/dataset', { host: bravo }), bravoGet);
    held.finish(); sameChallenge(await held.result, oldPost); held = null;
    await until(status, value => value.retired[0].state === 'DRAINED');
    sameChallenge(await exchange(gateway.publicURL, '/dataset', { host: alpha }), newGet);
    sameChallenge(await exchange(gateway.publicURL, '/records', { host: alpha, method: 'PUT', body: '{}' }), newPut);
    await assert.rejects(() => control(['rollback', '--state', state, '--expect', '1']), /FLEET_REVISION_CHANGED/);
    await gateway.close(); gateway = null;
    await Promise.all(sources.map(path => rm(path)));
    gateway = await launch(['--state', state, '--manifest', manifest, '--port', '0', '--admin-port', '0']);
    assert.equal((await status()).revision, 2);
    sameChallenge(await exchange(gateway.publicURL, '/records', { host: alpha, method: 'PUT', body: '{}' }), newPut);
    const restored = await control(['rollback', '--state', state, '--expect', '2', '--revision', '1']);
    assert.equal(restored.revision, 3);
    sameChallenge(await exchange(gateway.publicURL, '/dataset', { host: alpha }), oldGet);
    sameChallenge(await exchange(gateway.publicURL, '/dataset', { host: bravo }), bravoGet);
    assert.equal((await exchange(gateway.publicURL, '/records', { host: alpha, method: 'PUT', body: '{}' })).status, 404);
    const selected = JSON.parse(await readFile(join(state, 'active.json')));
    const retained = JSON.parse(await readFile(join(state, 'snapshots', selected.snapshotId, 'sellers', 'merchant-alpha.json')));
    assert.equal(retained.routes[0].admit, 'requireMerchantToken');
    assert.equal(retained.routes[0].responseFile, resolve(directory, 'dataset.json'));
    const owner = JSON.parse(await readFile(join(state, 'owner.json')));
    assert.equal(owner.pid, process.pid);
    process.stdout.write(JSON.stringify({ decision: 'ORIGINAL_FLEET_ROLLOUT_PASS', node: process.version, originalSellerServices: 3,
      prepareFailurePreservedActive: true, supersededSnapshotsCollected: true,
      admittedOriginalPostPreserved: true, crossGenerationCapacity: true,
      independentAssetMerchantPreserved: true, originalPutRouteActivated: true,
      restartedWithoutOriginalInputs: true, rollbackToRetainedOriginal: true,
      retainedAdmissionAndFileReferences: true, finalRevision: 3,
      chainCalls: 0, hostedActions: 0,
      note: 'Actual original SF30 challenge-only HTTP. No payment or delivery revenue is asserted.' }) + '\n');
  } finally {
    if (held) { held.abort(); await held.result.catch(() => {}); }
    await gateway?.close();
    await Promise.allSettled(sessions.map(session => session.close()));
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { process.stderr.write(String(error.stack ?? error) + '\n'); process.exitCode = 1; });
