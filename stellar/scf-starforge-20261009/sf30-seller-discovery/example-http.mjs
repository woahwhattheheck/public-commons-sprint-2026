/**
 * Start: `node example-http.mjs` and GET http://127.0.0.1:8422/weather?city=Louisville
 * Real 402 metadata transport; no authorization or payment takes place.
 * Replace this with an approved canonical @x402/stellar middleware for a
 * production seller; ingest Bazaar only from its authenticated settled hook.
 */
import { createServer } from 'node:http';
import { createSellerDiscovery, makePaymentRequiredResponse } from './index.mjs';

const payment = createSellerDiscovery({
  resource: {
    url: 'http://127.0.0.1:8422/weather',
    description: 'Current weather for a named city',
    mimeType: 'application/json',
    serviceName: 'Local Weather Demo',
    tags: ['weather', 'lookup'],
  },
  // Sample-only values; replace payTo and asset with real Stellar addresses
  // from the actual selected network BEFORE any network-connected deployment.
  accepts: [{ scheme: 'exact', network: 'stellar:testnet', asset: 'DEMO_ASSET_UNSET', amount: '10000',
    payTo: 'DEMO_PAYTO_UNSET', maxTimeoutSeconds: 60 }],
  input: { type: 'http', method: 'GET', querySchema: { type: 'object', properties: {
    city: { type: 'string', description: 'City to look up', examples: ['Louisville'] },
  }, required: ['city'], additionalProperties: false } },
  output: { type: 'json', example: { city: 'Louisville', temperatureC: 20 } },
  allowHttpLoopback: true,
});
const required = makePaymentRequiredResponse(payment);
const port = Number(process.env.PORT ?? 8422);
const server = createServer((req, res) => {
  if (req.method !== 'GET' || !req.url.startsWith('/weather')) {
    res.writeHead(404); res.end('Not found'); return;
  }
  // A real seller must let its x402 middleware verify/settle the signed
  // PAYMENT-SIGNATURE before it executes the protected route.
  res.writeHead(required.statusCode, required.headers);
  res.end(required.body);
});
server.listen(port, '127.0.0.1', () => console.log(`Seller 402 example: http://127.0.0.1:${port}/weather?city=Louisville`));
