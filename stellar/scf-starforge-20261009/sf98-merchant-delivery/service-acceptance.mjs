// One local service journey. This uses isolated event fixtures, never a wallet.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer, request } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openOutbox, SCHEMA } from './outbox.mjs';
import { acquireDeliveryLease, inspectDeliveryLease } from './delivery-lock.mjs';
import { drainOnce, sendSignedWebhook } from './deliver.mjs';
import { runWorker, workerStatus } from './worker.mjs';

const temporary = await mkdtemp(join(tmpdir(), 'sf98-service-'));
const stateDir = join(temporary, 'outbox');
const outbox = await openOutbox(stateDir);
const hash = value => createHash('sha256').update(value).digest('hex');
let now = Date.now(), server, holder;
const secret = randomBytes(32).toString('hex');
const first = hash('local-service-retry'), second = hash('local-service-parallel'), third = hash('local-service-stop');
const fixture = id => ({ schema: SCHEMA, id, at: new Date(now).toISOString(),
  routeId: 'local_data', method: 'GET', network: 'stellar:testnet', amountAtomic: '100',
  assetDigest: hash('local-fixture-asset'), receiptFingerprint: hash(id),
  transactionFingerprint: null, orderReference: 'local-service-journey',
  authority: 'ORIGINAL_NATIVE_PROCESS_SETTLEMENT_SUCCESS' });
const controller = new AbortController();
const cancelController = new AbortController();
let maxRequests = 0, activeRequests = 0;
const received = new Map();
try {
  // The original parent keeps FD ownership after its flock helper exits.
  const source = pathToFileURL(join(import.meta.dirname, 'delivery-lock.mjs')).href;
  holder = spawn(process.execPath, ['--input-type=module', '-e',
    `import {acquireDeliveryLease} from ${JSON.stringify(source)};
     await acquireDeliveryLease(${JSON.stringify(stateDir)}, {purpose:'worker'});
     console.log('LOCKED'); setInterval(()=>{},1000);`], { stdio: ['ignore', 'pipe', 'inherit'] });
  const ready = await Promise.race([once(holder.stdout, 'data'),
    new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Lease child did not start')), 10000); timer.unref(); })]);
  assert.match(String(ready[0]), /LOCKED/);
  await assert.rejects(acquireDeliveryLease(stateDir), { code: 'SF98_DELIVERY_BUSY' });
  const exit = once(holder, 'exit'); holder.kill('SIGKILL'); await exit; holder = null;
  const recovered = await acquireDeliveryLease(stateDir); await recovered.release();
  assert.equal((await inspectDeliveryLease(stateDir)).active, false);

  execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-subj', '/CN=merchant.example', '-addext', 'subjectAltName=DNS:merchant.example',
    '-keyout', join(temporary, 'key.pem'), '-out', join(temporary, 'cert.pem')], { stdio: 'ignore' });
  const ca = await readFile(join(temporary, 'cert.pem'));
  server = createServer({ key: await readFile(join(temporary, 'key.pem')), cert: ca }, async (req, res) => {
    try {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString();
      const event = JSON.parse(body), timestamp = req.headers['x-sf98-timestamp'];
      assert.equal(req.method, 'POST');
      assert.equal(req.headers['idempotency-key'], event.eventId);
      assert.equal(req.headers['x-sf98-signature'], 'sha256=' + createHmac('sha256', secret).update(timestamp + '.' + body).digest('hex'));
      assert.equal(event.schema, 'stellar-forge.sf98.webhook.v1');
      received.set(event.eventId, (received.get(event.eventId) ?? 0) + 1);
      activeRequests++; maxRequests = Math.max(maxRequests, activeRequests);
      if (event.eventId === third) { activeRequests--; cancelController.abort(); return; }
      setTimeout(() => {
        res.writeHead(event.eventId === first && received.get(first) === 1 ? 503 : 200);
        res.end(); activeRequests--;
      }, 15);
    } catch (error) { res.writeHead(500); res.end(); controller.abort(error); }
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const port = server.address().port;
  // Only the test transport terminates at loopback. Actual TLS and the ORIGINAL
  // signed sender run unchanged; production destination restrictions still apply.
  const send = options => sendSignedWebhook({ ...options,
    resolver: async () => [{ address: '1.1.1.1', family: 4 }],
    transport: (_url, settings, callback) => request({ ...settings, lookup: undefined,
      hostname: '127.0.0.1', port, path: '/events', servername: 'merchant.example', ca }, callback),
  });
  const options = { url: 'https://merchant.example/events', allowedHost: 'merchant.example',
    secret, send, pollMs: 50, timeoutMs: 1000, concurrency: 2, clock: () => now };
  await outbox.record(fixture(first)); await outbox.record(fixture(second));
  let cycles = 0;
  const done = await runWorker(outbox, { ...options, signal: controller.signal,
    onCycle: async snapshot => {
      cycles++;
      const observed = await workerStatus(outbox);
      assert.equal(observed.deliveryOwner.active, true);
      assert.equal(observed.deliveryOwner.owner.purpose, 'worker');
      if (cycles === 1) {
        assert.equal(snapshot.outbox.delivered, 1);
        const retried = (await outbox.rows()).find(row => row.event.id === first).state;
        assert.equal(Date.parse(retried.nextAt) - Date.parse(retried.at), 30000);
        await assert.rejects(drainOnce(outbox, options), { code: 'SF98_DELIVERY_BUSY' });
        now += 30001;
      }
      if (snapshot.outbox.delivered === 2) controller.abort();
      if (cycles > 5) throw new Error('Worker failed to resume original due retry');
    },
  });
  assert.equal(done.state, 'STOPPED');
  assert.equal(done.totals.attempted, 3); assert.equal(maxRequests, 2);
  assert.equal(received.get(first), 2); assert.equal(received.get(second), 1);
  assert.equal((await inspectDeliveryLease(stateDir)).active, false);

  const restarted = new AbortController();
  await runWorker(outbox, { ...options, signal: restarted.signal,
    send: () => { throw new Error('Delivered event must not be sent on restart'); },
    onCycle: snapshot => { assert.equal(snapshot.outbox.attemptThisRun, 0); restarted.abort(); } });

  await outbox.record(fixture(third));
  const cancelled = await runWorker(outbox, { ...options, signal: cancelController.signal });
  assert.equal(cancelled.state, 'STOPPED');
  const pending = (await outbox.rows()).find(row => row.event.id === third).state;
  assert.equal(pending.state, 'RETRY'); assert.equal(pending.attempt, 1);
  assert.equal((await workerStatus(outbox)).deliveryOwner.active, false);
  process.stdout.write(JSON.stringify({ result: 'PASS', node: process.version,
    journey: 'original outbox -> original signed TLS sender -> receiver -> durable retry -> restart -> cancellation',
    acceptedEvents: 2, originalAttempts: 3, concurrentRequests: maxRequests,
    crashReacquisition: true, competingDrainRejected: true, interruptedEventRetained: true,
    paymentOrCustomerClaim: false }) + '\n');
} finally {
  holder?.kill('SIGKILL');
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(temporary, { recursive: true, force: true });
}
