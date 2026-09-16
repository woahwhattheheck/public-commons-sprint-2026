import { normalizeAtomicInteger } from './atomic.mjs';
import { exact } from './recipe-authority.mjs';

function safeCount(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${label} must be a non-negative safe integer`);
}

function scoreString(value, label) {
  if (typeof value !== 'string' || !/^\d+\.\d{2}$/.test(value)) throw new TypeError(`${label} must be a fixed two-decimal score string`);
}

export function validateLaneBMetrics(metrics, serviceUrl) {
  exact(metrics, [
    'feedbackCount', 'averageFeedbackScore', 'paidFeedbackCount',
    'completedValidationCount', 'averageCompletedValidationScore',
    'supportedTrustModels', 'serviceOrigin', 'matchedEndpointKinds',
    'graphBlockNumber', 'graphBlockTimestamp',
  ], [], 'laneBReceipt.metrics');
  for (const key of ['feedbackCount', 'paidFeedbackCount', 'completedValidationCount']) safeCount(metrics[key], `laneBReceipt.metrics.${key}`);
  for (const key of ['averageFeedbackScore', 'averageCompletedValidationScore']) scoreString(metrics[key], `laneBReceipt.metrics.${key}`);
  if (!Array.isArray(metrics.supportedTrustModels) || metrics.supportedTrustModels.some((entry) => typeof entry !== 'string' || !entry)) throw new TypeError('laneBReceipt.metrics.supportedTrustModels must be string[]');
  if (!Array.isArray(metrics.matchedEndpointKinds) || metrics.matchedEndpointKinds.some((entry) => !['web', 'mcp', 'a2a'].includes(entry))) throw new TypeError('laneBReceipt.metrics.matchedEndpointKinds is invalid');
  normalizeAtomicInteger(metrics.graphBlockNumber, 'laneBReceipt.metrics.graphBlockNumber');
  normalizeAtomicInteger(metrics.graphBlockTimestamp, 'laneBReceipt.metrics.graphBlockTimestamp');
  if (metrics.serviceOrigin !== new URL(serviceUrl).origin) throw new TypeError('laneBReceipt.metrics.serviceOrigin does not match serviceUrl');
}
