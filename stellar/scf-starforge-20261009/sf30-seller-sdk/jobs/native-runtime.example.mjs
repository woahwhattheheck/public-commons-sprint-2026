// MIT. Explicit original native x402 runtime; use the installed sibling module.
import { createNativeSellerServer } from '../native-factory.mjs';

export async function nativeFactory(compiled) {
  const configured = process.env.SF_JOBS_FACILITATOR_URL;
  let endpoint;
  try { endpoint = new URL(configured); } catch {
    throw Object.assign(new Error('Set SF_JOBS_FACILITATOR_URL to the merchant facilitator HTTPS endpoint.'),
      { code: 'JOB_FACILITATOR_URL_REQUIRED' });
  }
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.hash)
    throw Object.assign(new Error('Use an explicit HTTPS facilitator endpoint without URL credentials or fragments.'),
      { code: 'JOB_FACILITATOR_URL_INVALID' });
  const { HTTPFacilitatorClient } = await import('@x402/core/server');
  return createNativeSellerServer(compiled, {
    facilitatorClient: new HTTPFacilitatorClient({ url: endpoint.href }),
  });
}
export default nativeFactory;
