// MIT. Real loopback HTTP 402 advertisement; NOT a paid/settled service.
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { compileHttpSellerOffer, paymentRequiredResponse } from '../seller.mjs';

// Intentionally non-payable placeholders. A valid facilitator+seller must
// replace them with verified addresses/asset and genuine auth/settlement hooks.
export function makeWeatherOffer(port) {
  return compileHttpSellerOffer({
    url: `http://127.0.0.1:${port}/weather`, method: 'GET',
    serviceName: 'Weather Example', tags: ['weather', 'forecast'],
    description: 'Sample endpoint that advertises x402 terms without collecting funds',
    queryParameters: [
      { name: 'city', type: 'string', description: 'City to look up', required: true, example: 'Louisville' },
    ],
    payment: { network: 'stellar:testnet', scheme: 'exact', amount: '10000',
      asset: 'UNVERIFIED_DEMO_ASSET', payTo: 'UNVERIFIED_DEMO_RECIPIENT', maxTimeoutSeconds: 60 },
    outputExample: { city: 'Louisville', sample: 'not a real weather observation' },
  }, { allowLocalhost: true });
}
export async function startWeatherExample() {
  let offer;
  const server = createServer((req, res) => {
    if (req.method !== 'GET' || !req.url?.startsWith('/weather')) {
      res.writeHead(404, { 'content-type': 'application/json' }); res.end('{}'); return;
    }
    const response = paymentRequiredResponse(offer);
    res.writeHead(response.statusCode, response.headers);
    res.end(response.body);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
  });
  offer = makeWeatherOffer(server.address().port);
  return { server, offer, endpoint: offer.resource.url,
    close: () => new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())) };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await startWeatherExample();
  console.log(JSON.stringify({ endpoint: app.endpoint, mode: '402_ADVERTISEMENT_ONLY_NO_SETTLEMENT' }));
}
