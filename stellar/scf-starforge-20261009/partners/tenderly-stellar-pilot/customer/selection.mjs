// MIT. Public customer selection derived from the original reviewed merchant plan.
import { inspectPlan } from '../product.mjs';
import { plain, requireValue } from './contract.mjs';

export const SELECTION_SCHEMA = 'stellar-forge.tenderly-customer-selection.v1';

export function normalizeSelection(value) {
  requireValue(plain(value) && Object.keys(value).every(key =>
    ['schema', 'resource', 'method', 'networkId', 'simulationType', 'planSha256', 'maxResponseBytes'].includes(key)) &&
    value.schema === SELECTION_SCHEMA && value.method === 'POST', 'TENDERLY_CUSTOMER_SELECTION_INVALID');
  let url;
  try { url = new URL(value.resource); } catch { requireValue(false, 'TENDERLY_CUSTOMER_RESOURCE_INVALID'); }
  requireValue(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
    url.href === value.resource, 'TENDERLY_CUSTOMER_RESOURCE_INVALID');
  requireValue(typeof value.networkId === 'string' && /^[1-9][0-9]{0,19}$/.test(value.networkId) &&
    ['quick', 'abi', 'full'].includes(value.simulationType) && /^[a-f0-9]{64}$/.test(value.planSha256) &&
    Number.isSafeInteger(value.maxResponseBytes) && value.maxResponseBytes >= 1024 &&
    value.maxResponseBytes <= 1048576, 'TENDERLY_CUSTOMER_SELECTION_INVALID');
  return { schema: SELECTION_SCHEMA, resource: value.resource, method: 'POST', networkId: value.networkId,
    simulationType: value.simulationType, planSha256: value.planSha256, maxResponseBytes: value.maxResponseBytes };
}

export function createSelection(plan) {
  const review = inspectPlan(plan);
  return normalizeSelection({ schema: SELECTION_SCHEMA, resource: review.route.url, method: review.route.method,
    networkId: review.networkId, simulationType: review.simulationType,
    planSha256: review.planSha256, maxResponseBytes: review.limits.maxResponseBytes });
}
