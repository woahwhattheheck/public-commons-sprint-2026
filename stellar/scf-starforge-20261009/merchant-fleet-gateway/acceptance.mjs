// MIT. One SOURCE-NATIVE challenge-only acceptance across two real original SF30 sellers.
// No payment credentials, payments, fabricated facilitator, or hosted CI.
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { startSellerService } from '../sf30-seller-sdk/serve.mjs';
import { loadMerchantFleet, startMerchantFleet } from './gateway.mjs';

async function get(port, path, host) {
  return new Promise((done, fail) => {
    const call = httpRequest({ hostname: '127.0.0.1', port, path,
      headers: host ? { host } : { host: '127.0.0.1' } }, res => {
      const chunks = [];
      res.on('data', bytes => chunks.push(bytes));
      res.on('error', fail);
      res.on('end', () => done({ status: res.statusCode, headers: res.headers,
        body: Buffer.concat(chunks) }));
    });
    call.on('error', fail); call.end();
  });
}
async function main() {
  const directory = await mkdtemp(join(tmpdir(), 'original-sf30-fleet-'));
  const sessions = [];
  let gateway = null;
  try {
    const original = JSON.parse(await readFile(new URL('../sf30-seller-sdk/examples/service.json', import.meta.url)));
    const configs = [
      { id: 'merchant-alpha', host: 'alpha.scf-merchant.example', amount: '10000' },
      { id: 'merchant-bravo', host: 'bravo.scf-merchant.example', amount: '20000' },
    ];
    const tenants = [];
    for (const merchant of configs) {
      const config = structuredClone(original);
      config.publicOrigin = 'https://' + merchant.host;
      config.routes[0].definition.payment.amount = merchant.amount;
      const configPath = join(directory, merchant.id + '.json');
      await writeFile(configPath, JSON.stringify(config));
      const running = await startSellerService({ config, port: 0 });
      sessions.push(running);
      tenants.push({ id: merchant.id, host: merchant.host,
        sellerConfig: merchant.id + '.json',
        upstreamPort: new URL(running.url).port * 1 });
    }
    const manifest = join(directory, 'fleet.json');
    await writeFile(manifest, JSON.stringify({ schema: 'stellar-forge.merchant-fleet.v1', tenants }));
    const prepared = await loadMerchantFleet(manifest);
    gateway = await startMerchantFleet(prepared, { port: 0, adminPort: 0 });
    const front = Number(new URL(gateway.publicURL).port);
    const admin = Number(new URL(gateway.adminURL).port);
    const a = await get(front, '/dataset', configs[0].host);
    const b = await get(front, '/dataset', configs[1].host);
    const directA = await get(tenants[0].upstreamPort, '/dataset', '127.0.0.1');
    const directB = await get(tenants[1].upstreamPort, '/dataset', '127.0.0.1');
    assert.equal(a.status, 402); assert.equal(b.status, 402);
    assert.deepEqual(a.body, directA.body); assert.deepEqual(b.body, directB.body);
    assert.equal(a.headers['payment-required'], directA.headers['payment-required']);
    assert.equal(b.headers['payment-required'], directB.headers['payment-required']);
    assert.notEqual(a.headers['payment-required'], b.headers['payment-required']);
    assert.equal((await get(front, '/_seller/health', configs[0].host)).status, 404);
    assert.equal((await get(front, '/_fleet/health', configs[0].host)).status, 404);
    assert.equal((await get(front, '/dataset', 'unregistered.example')).status, 421);
    assert.equal((await get(front, '/other', configs[0].host)).status, 404);
    const status = await get(admin, '/_fleet/health');
    assert.equal(status.status, 200);
    assert.equal(JSON.parse(status.body.toString('utf8')).merchants.length, 2);
    process.stdout.write(JSON.stringify({ decision: 'SOURCE_NATIVE_PASS',
      originalSF30SellerProcesses: 2, original402: [a.status, b.status],
      exactBodyAndPaymentRequiredPreserved: true, independentAuthorities: true,
      exposedSellerAdmin: false, privateOperatorHealth: true,
      note: 'Challenge-only sellers; NO on-chain transaction or payment receipt' }) + '\n');
  } finally {
    await Promise.allSettled([gateway?.close(), ...sessions.map(s => s.close())]);
    await rm(directory, { recursive: true, force: true });
  }
}
main().catch(error => { process.stderr.write(String(error?.stack ?? error) + '\n'); process.exitCode = 1; });
