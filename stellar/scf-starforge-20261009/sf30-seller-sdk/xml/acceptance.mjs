// MIT. Original SF30 merchant handoff of the dataset exported by acceptance.py.
import assert from 'node:assert/strict';
import { loadDatasetConfig } from '../dataset-handler.mjs';
import { buildDatasetSellerConfig } from '../dataset-cli.mjs';
import { startSellerService } from '../serve.mjs';
const dataset = await loadDatasetConfig(process.argv[2]);
// Deliberately fictional public terms, used only by the original local challenge server.
const payment = { scheme: 'exact', network: 'stellar:testnet', asset: 'UNVERIFIED_DEMO_ASSET',
  payTo: 'UNVERIFIED_DEMO_RECIPIENT', amount: '9007199254740993', maxTimeoutSeconds: 60 };
const config = await buildDatasetSellerConfig(dataset, {
  payment, origin: 'https://xml.example.invalid', path: '/inventory',
});
const service = await startSellerService({ config, port: 0,
  handlers: { queryDataset: dataset.handle, admitDataset: dataset.admit } });
try {
  const response = await fetch(service.url + '/inventory?where_sku=9007199254740993');
  const body = await response.json();
  assert.equal(response.status, 402);
  assert.equal(body.accepts[0].amount, payment.amount);
  const docs = await fetch(service.url + '/_seller/docs');
  assert.equal(docs.status, 200);
  const specification = await (await fetch(service.url + '/_seller/openapi.json')).json();
  assert.ok(specification.paths['/inventory']);
  console.log(JSON.stringify({ mode: service.mode, status: response.status,
    exactAmount: body.accepts[0].amount, docs: docs.status, openapiRoute: '/inventory',
    nativeSnapshot: dataset.describe().snapshot }));
} finally { await service.close(); }
