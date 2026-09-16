import { sha256Hex } from './canonical.mjs';
import { exact, nullableSha, parseInstant, sha, validateReportBinding } from './recipe-authority.mjs';

export const REPORT_SCHEMA = 'agent-revenue-rail/report-payload/v1';
const REPORT_ACTIONS = new Set(['ACT', 'MONITOR', 'IGNORE']);

export function validateReportPayload(report, binding, laneAReceipt, evaluatedAtMs) {
  validateReportBinding(binding);
  exact(report, [
    'schema', 'reportId', 'generatedAt', 'summary', 'recommendation', 'sourceDigest',
    'serviceResponseDigest', 'payloadDigest',
  ], [], 'report');
  if (report.schema !== REPORT_SCHEMA) throw new TypeError(`report.schema must be ${REPORT_SCHEMA}`);
  if (typeof report.reportId !== 'string' || report.reportId.trim() === '') throw new TypeError('report.reportId is required');
  if (parseInstant(report.generatedAt, 'report.generatedAt') > evaluatedAtMs) throw new TypeError('report.generatedAt is from the future');
  if (typeof report.summary !== 'string' || report.summary.trim() === '') throw new TypeError('report.summary is required');
  exact(report.recommendation, ['action', 'rationale'], [], 'report.recommendation');
  if (!REPORT_ACTIONS.has(report.recommendation.action)) throw new TypeError('report.recommendation.action is invalid');
  if (typeof report.recommendation.rationale !== 'string' || report.recommendation.rationale.trim() === '') throw new TypeError('report.recommendation.rationale is required');
  nullableSha(report.sourceDigest, 'report.sourceDigest');
  sha(report.serviceResponseDigest, 'report.serviceResponseDigest');
  sha(report.payloadDigest, 'report.payloadDigest');
  const { payloadDigest, ...payloadCore } = report;
  if (sha256Hex(payloadCore) !== payloadDigest) throw new TypeError('report.payloadDigest mismatch');
  if (payloadDigest !== binding.expectedPayloadDigest || payloadDigest !== laneAReceipt.reportPayloadDigest) throw new TypeError('report payload is not the out-of-band retained Lane A result');
  if (report.serviceResponseDigest !== binding.expectedServiceResponseDigest || report.serviceResponseDigest !== laneAReceipt.serviceResponseDigest) throw new TypeError('report service response is not bound to Lane A settlement');
}
