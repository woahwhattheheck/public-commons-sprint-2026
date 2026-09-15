import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const SECRET_KEYS = /access[_-]?key|secret[_-]?access|session[_-]?token|authorization|credential/i;

export function validateAwsEvidence(value, { expectedRegion, expectedTable, expectedAdapter = 'hearthline-dynamodb-json-store' } = {}) {
  const errors = [];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ok: false, state: 'BLOCKED', errors: ['evidence must be an object'] };
  const scanKeys = (node, path = '') => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) { node.forEach((entry, index) => scanKeys(entry, `${path}[${index}]`)); return; }
    for (const [key, child] of Object.entries(node)) {
      const next = path ? `${path}.${key}` : key;
      if (SECRET_KEYS.test(key)) errors.push(`secret-bearing field forbidden: ${next}`);
      scanKeys(child, next);
    }
  };
  scanKeys(value);
  if (value.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (value.provider !== 'aws') errors.push('provider must be aws');
  if (value.service !== 'dynamodb') errors.push('service must be dynamodb');
  if (value.evidenceKind !== 'live_read_probe') errors.push('evidenceKind must be live_read_probe');
  if (value.adapter !== expectedAdapter) errors.push('adapter mismatch');
  if (value.liveAwsObservation !== true) errors.push('liveAwsObservation must be true');
  if (value.httpStatus !== 200) errors.push('httpStatus must be 200');
  if (!/^[A-Za-z0-9-]{8,128}$/.test(String(value.requestId ?? ''))) errors.push('requestId missing or malformed');
  if (!/^[a-z0-9-]{3,32}$/.test(String(value.region ?? ''))) errors.push('region missing or malformed');
  if (expectedRegion && value.region !== expectedRegion) errors.push('region does not match expected region');
  if (!/^[A-Za-z0-9_.-]{3,255}$/.test(String(value.tableName ?? ''))) errors.push('tableName missing or malformed');
  if (expectedTable && value.tableName !== expectedTable) errors.push('tableName does not match expected table');
  const endpoint = (() => { try { return new URL(value.endpoint); } catch { return null; } })();
  if (!endpoint || endpoint.protocol !== 'https:' || endpoint.hostname !== `dynamodb.${value.region}.amazonaws.com`) errors.push('endpoint is not the canonical regional DynamoDB HTTPS endpoint');
  if (!/^DynamoDB_20120810\.GetItem$/.test(String(value.target ?? ''))) errors.push('target must be DynamoDB GetItem');
  const observedAt = Date.parse(value.observedAt);
  if (!Number.isFinite(observedAt)) errors.push('observedAt must be an ISO timestamp');
  return { ok: errors.length === 0, state: errors.length ? 'BLOCKED' : 'LIVE_AWS_EVIDENCE_VERIFIED', errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) throw new Error('usage: node aws/evidence-gate.mjs <evidence.json> [region] [table]');
  const value = JSON.parse(await readFile(resolve(path), 'utf8'));
  const result = validateAwsEvidence(value, { expectedRegion: process.argv[3], expectedTable: process.argv[4] });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 2;
}
