// One focused original SF31 transport check. No network, wallet or purchase.
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createPublicHttpsFetch } from '../../sf31-buyer-client/public-transport.mjs';
import { catalog } from '../config.mjs';

const host = 'catalog.operator-example.com';
const origin = 'https://' + host;
const gateway = '198.18.126.99';
let pins = 0, attempts = 0;
function fakeHttps(opts, reply) {
  attempts++;
  assert.equal(opts.hostname, host);
  assert.equal(opts.servername, host);
  assert.equal(opts.rejectUnauthorized, true);
  assert.equal(opts.agent, false);
  assert.equal(opts.port, 443);
  assert.equal(opts.autoSelectFamily, false);
  opts.lookup(host, {all:true}, (err, addresses) => {
    assert.ifError(err);
    assert.deepEqual(addresses, [{address:gateway, family:4}]);
    pins++;
  });
  return {
    once(name) { assert.equal(name, 'error'); return this; },
    end() {
      const stream = Readable.from(['{"items":[],"pagination":{"total":0}}']);
      stream.statusCode = 200;
      stream.rawHeaders = ['Content-Type', 'application/json'];
      queueMicrotask(() => reply(stream));
    }
  };
}
const overlayDNS = async (name, opts) => {
  assert.equal(name, host);
  assert.equal(opts.all, true);
  return [{address:gateway, family:4}];
};
catalog({origin, limit:10, sandboxGatewayIPv4:gateway});
assert.throws(() => catalog({origin, sandboxGatewayIPv4:100}),
  {code:'CATALOG_SANDBOX_GATEWAY_INVALID'});
assert.throws(() => createPublicHttpsFetch({sandboxGatewayIPv4:'10.0.0.1'}), TypeError);
assert.throws(() => createPublicHttpsFetch({sandboxGatewayIPv4:'198.20.0.1'}), TypeError);
await assert.rejects(
  createPublicHttpsFetch({lookup:overlayDNS, requestImpl:fakeHttps})(origin),
  {code:'NONPUBLIC_DNS_ANSWER'});
assert.equal(attempts, 0);
for (const answers of [
  [{address:'198.18.126.98',family:4}],
  [{address:gateway,family:4},{address:'8.8.8.8',family:4}],
  [{address:'127.0.0.1',family:4}]
]) {
  await assert.rejects(
    createPublicHttpsFetch({
      sandboxGatewayIPv4:gateway, lookup:async()=>answers, requestImpl:fakeHttps
    })(origin), {code:'SANDBOX_GATEWAY_DNS_MISMATCH'});
}
assert.equal(attempts, 0);
const allowed = createPublicHttpsFetch({
  sandboxGatewayIPv4:gateway, lookup:overlayDNS, requestImpl:fakeHttps
});
const response = await allowed(origin+'/discovery/resources');
assert.equal(response.status, 200);
assert.deepEqual(JSON.parse(await response.text()), {items:[], pagination:{total:0}});
assert.equal(attempts, 1);
assert.equal(pins, 1);
console.log('PASS SF88 catalog-only managed gateway: exact DNS pin, original TLS host, default deny');
