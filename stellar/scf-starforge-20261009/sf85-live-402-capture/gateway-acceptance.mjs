/** Exact SF85 DNS gateway behavior. No network, no payments or hosted Actions. */
import assert from 'node:assert/strict';
import { capture, parseArgs } from './capture.mjs';

const destination = '/tmp/sf85-gateway-acceptance-private.json';
const argv = [
  '--url', 'https://x402.albylabs.com/demo/quote',
  '--allow-origin', 'https://x402.albylabs.com',
  '--method', 'GET', '--out', destination,
];
const options = parseArgs([...argv, '--egress-gateway-ip', '198.18.126.99']);
assert.equal(options.egressGatewayIP, '198.18.126.99');
assert.throws(
  () => parseArgs([...argv, '--egress-gateway-ip', '127.0.0.1']),
  { code: 'EGRESS_GATEWAY_MUST_BE_BENCHMARK_IPV4' },
);
const resolver = async () => [{ address: '198.18.126.99', family: 4 }];
let pin = null;
const fakeHttps = (target, config, onResponse) => {
  assert.equal(target.hostname, 'x402.albylabs.com');
  assert.equal(config.rejectUnauthorized, true);
  assert.equal(config.method, 'GET');
  config.lookup(target.hostname, {}, (_error, address, family) => {
    pin = { address, family };
  });
  return {
    on() { return this; },
    end() { queueMicrotask(() => onResponse({
      statusCode: 402,
      rawHeaders: ['Payment-Required', 'opaque-original-challenge'],
      destroy() {},
    })); },
  };
};
await assert.rejects(
  capture({ ...options, egressGatewayIP: null }, { resolve: resolver, httpsRequest: fakeHttps }),
  { code: 'DNS_HAS_NONPUBLIC_OR_NO_IPV4' },
);
await assert.rejects(
  capture(options, {
    resolve: async () => [...await resolver(), { address: '198.18.126.98', family: 4 }],
    httpsRequest: fakeHttps,
  }),
  { code: 'EGRESS_GATEWAY_DNS_MISMATCH' },
);
await assert.rejects(
  capture({ ...options, egressGatewayIP: '127.0.0.1' }, { resolve: resolver, httpsRequest: fakeHttps }),
  { code: 'EGRESS_GATEWAY_MUST_BE_BENCHMARK_IPV4' },
);
const original = await capture(options, { resolve: resolver, httpsRequest: fakeHttps });
assert.equal(original.status, 402);
assert.deepEqual(original.headers, [['Payment-Required', 'opaque-original-challenge']]);
assert.deepEqual(pin, { address: '198.18.126.99', family: 4 });
const publicCapture = await capture({ ...options, egressGatewayIP: null }, {
  resolve: async () => [{ address: '8.8.8.8', family: 4 }],
  httpsRequest: fakeHttps,
});
assert.equal(publicCapture.status, 402);
console.log('PASS SF85 gateway opt-in: original 402, exact DNS pin, reject unauthorized/mixed/private, preserve public default');
