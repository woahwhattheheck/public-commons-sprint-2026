// MIT. Receive the original generated NDJSON merchant and its customer SDK.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const args = process.argv.slice(2);
const options = new Map();
for (let index = 0; index < args.length; index += 2) {
  if (!['--prepared','--source-root','--request','--build','--source'].includes(args[index]) ||
      options.has(args[index]) || !args[index + 1]) throw new Error('Use the original complete merchant receiving arguments');
  options.set(args[index],args[index + 1]);
}
if (options.size !== 5) throw new Error('Supply prepared, source-root, request, build and source');
const prepared = resolve(options.get('--prepared'));
const original = resolve(options.get('--source-root'));
const input = JSON.parse(await readFile(resolve(options.get('--request')), 'utf8'));
const { inspectNdjsonMerchant } = await import(pathToFileURL(join(original, 'ndjson/merchant.mjs')).href);
const { inspectSellerClientExport } = await import(pathToFileURL(join(original, 'developer/client-export.mjs')).href);
const merchant = await inspectNdjsonMerchant({ prepared });
assert.equal(merchant.build, options.get('--build'));
assert.equal(merchant.source, options.get('--source'));
assert.equal(merchant.origin, input.origin);
assert.equal(merchant.resource, input.origin + input.path);
assert.deepEqual(JSON.parse(await readFile(join(prepared, 'payment.json'), 'utf8')), input.payment);
const customer = await inspectSellerClientExport({ directory: join(prepared, 'customer'), includeOffers: true });
assert.equal(customer.state, 'COMPLETE');
const generated = await import(pathToFileURL(join(prepared, 'customer/seller-client.mjs')).href);
assert.equal(generated.operations.length, 1);
assert.equal(generated.source.origin, input.origin);
const request = generated.buildRequest(generated.operations[0].id, { query: { limit: '50' } }, {
  intentId: 'SCF-KAFKA-MERCHANT-8F43-20261012:generated-customer-page',
  acceptIndex: 0, maxAtomic: input.payment.amount,
});
const actual = new URL(request.url);
assert.equal(actual.origin, input.origin);
assert.equal(actual.pathname, input.path);
assert.equal(actual.searchParams.get('limit'), '50');
assert.equal(request.method, 'GET');
assert.equal(Object.hasOwn(request, 'body'), false);
for (const key of ['scheme','network','asset','payTo','maxTimeoutSeconds'])
  assert.equal(request.expect[key], input.payment[key]);
assert.equal(request.expect.maxAtomic, input.payment.amount);
console.log(JSON.stringify({ schema: 'stellar-forge.kafka-native-merchant-receiving.v1',
  operation: 'SCF-KAFKA-MERCHANT-8F43-20261012', status: 'COMPLETE',
  merchant, customer, generatedCustomer: { source: generated.source, operation: generated.operations[0].id,
    request }, completedAt: new Date().toISOString() }));
