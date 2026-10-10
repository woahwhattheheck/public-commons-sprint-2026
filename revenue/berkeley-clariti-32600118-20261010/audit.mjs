/**
 * Berkeley Clariti 32600118 independent cutover acceptance evidence checker.
 * MIT — vendor-neutral, offline-only; no access to City/Clariti systems or data.
 * Compare two already normalized, same-cohort extracts from a controlled cutover.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const VALID_TYPES = new Set(['permit', 'license', 'inspection', 'special_event']);
const PLAIN = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const MAX_BYTES = 25 * 1024 * 1024;
const ERROR_CODES = new Set([
  'MISSING_TARGET', 'UNEXPECTED_TARGET', 'TYPE_CHANGED', 'DEPARTMENT_CHANGED',
  'STATUS_CHANGED', 'LINKS_CHANGED', 'REVIEWS_CHANGED', 'ATTACHMENTS_CHANGED',
  'PAYMENT_MINOR_CHANGED', 'ORPHAN_TARGET_LINK',
]);

class InvalidEvidence extends TypeError {
  constructor(message) { super(message); this.name = 'InvalidEvidence'; }
}
const invalid = detail => { throw new InvalidEvidence(detail); };
const requireString = (value, label) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 256 || /[\u0000-\u001F]/.test(value))
    invalid(`${label}: expected a short nonempty text value`);
  return value;
};
const normalizeSet = (v, label) => {
  if (!Array.isArray(v) || v.length > 4000) invalid(`${label}: expected bounded array`);
  const result = v.map(x => {
    if (typeof x !== 'string' || !IDENTIFIER.test(x)) invalid(`${label}: invalid ID`);
    return x;
  });
  if (new Set(result).size !== result.length) invalid(`${label}: duplicated ID`);
  return result.sort();
};
const compareObjects = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const normalizeReviews = (v, label) => {
  if (!PLAIN(v) || Object.keys(v).length > 100) invalid(`${label}: expected review-status map`);
  const entries = [];
  for (const [dept, state] of Object.entries(v)) {
    requireString(dept, `${label} department`);
    requireString(state, `${label} state`);
    entries.push([dept, state]);
  }
  return Object.fromEntries(entries.sort(([a], [b]) => a.localeCompare(b)));
};
const normalize = (data, label) => {
  if (!PLAIN(data) || !Array.isArray(data.records) || data.records.length > 500000)
    invalid(`${label}: expected records array (max 500000)`);
  const cohort = requireString(data.cohort, `${label} cohort`);
  if (!IDENTIFIER.test(cohort)) invalid(`${label}: invalid cohort identifier`);
  const records = new Map();
  for (let i = 0; i < data.records.length; i++) {
    const r = data.records[i], loc = `${label} records[${i}]`;
    if (!PLAIN(r) || !IDENTIFIER.test(r.id)) invalid(`${loc}: invalid record identifier`);
    if (records.has(r.id)) invalid(`${loc}: duplicate record identifier`);
    if (!VALID_TYPES.has(r.type)) invalid(`${loc}: unsupported record type`);
    const dep = requireString(r.department, `${loc} department`);
    const status = requireString(r.status, `${loc} status`);
    const links = normalizeSet(r.relatedIds ?? [], `${loc} relatedIds`);
    const reviews = normalizeReviews(r.reviewStates ?? {}, `${loc} reviewStates`);
    if (!Number.isSafeInteger(r.attachments) || r.attachments < 0 || r.attachments > 100000)
      invalid(`${loc}: attachments must be an explicit nonnegative count`);
    if (r.paymentMinor !== undefined && (typeof r.paymentMinor !== 'string' ||
      !/^(0|[1-9][0-9]{0,18})$/.test(r.paymentMinor)))
      invalid(`${loc}: paymentMinor must be nonnegative integer minor-units as text`);
    records.set(r.id, { type: r.type, department: dep, status, links, reviews,
      attachments: r.attachments, paymentMinor: r.paymentMinor ?? null });
  }
  return {cohort, records};
};

/**
 * Return a bounded, privacy-minimized discrepancy report; never exposes source
 * IDs, names, addresses, evidence rows or payment values. It is not a score,
 * proof of compliance or an authorization to accept a vendor deliverable.
 */
export function auditSnapshots(before, after, { maxExamples = 12 } = {}) {
  if (!Number.isInteger(maxExamples) || maxExamples < 0 || maxExamples > 100)
    invalid('maxExamples must be an integer between 0 and 100');
  const source = normalize(before, 'source'), target = normalize(after, 'target');
  if (source.cohort !== target.cohort) invalid('source and target cohort identifiers differ');
  const issues = Object.fromEntries([...ERROR_CODES].map(k => [k, 0]));
  const examples = [];
  // Ephemeral HMAC key prevents guessing likely case IDs from public hashes.
  const privacyKey = randomBytes(32);
  const recordTag = id => createHmac('sha256', privacyKey).update(`${source.cohort}\u0000${id}`).digest('hex').slice(0, 16);
  const add = (code, id) => {
    issues[code]++;
    if (examples.length < maxExamples) examples.push({code, recordHash:recordTag(id)});
  };
  for (const [id, row] of source.records) {
    const dst = target.records.get(id);
    if (!dst) { add('MISSING_TARGET', id); continue; }
    if (row.type !== dst.type) add('TYPE_CHANGED', id);
    if (row.department !== dst.department) add('DEPARTMENT_CHANGED', id);
    if (row.status !== dst.status) add('STATUS_CHANGED', id);
    if (!compareObjects(row.links, dst.links)) add('LINKS_CHANGED', id);
    if (!compareObjects(row.reviews, dst.reviews)) add('REVIEWS_CHANGED', id);
    if (row.attachments !== dst.attachments) add('ATTACHMENTS_CHANGED', id);
    if (row.paymentMinor !== dst.paymentMinor) add('PAYMENT_MINOR_CHANGED', id);
  }
  for (const [id, row] of target.records) {
    if (!source.records.has(id)) add('UNEXPECTED_TARGET', id);
    for (const link of row.links) if (!target.records.has(link)) add('ORPHAN_TARGET_LINK', id);
  }
  const totalFindings = Object.values(issues).reduce((a,b) => a+b, 0);
  return {
    status: totalFindings === 0 ? 'RECONCILED_SNAPSHOT' : 'HUMAN_REVIEW_REQUIRED',
    sourceRecords: source.records.size,
    targetRecords: target.records.size,
    totalFindings,
    issues,
    examples,
    examplesTruncated: totalFindings > examples.length,
    limitations: 'Same-cohort normalized snapshots only; human reviewers must check source data completeness, transformations, permissions, business rules, dynamic changes and actual system acceptance.',
  };
}

export async function auditFiles(sourcePath, targetPath, options) {
  for (const file of [sourcePath, targetPath]) {
    const metadata = await stat(file);
    if (!metadata.isFile() || metadata.size > MAX_BYTES) invalid('Input must be a file of at most 25 MiB');
  }
  return auditSnapshots(JSON.parse(await readFile(sourcePath,'utf8')),
    JSON.parse(await readFile(targetPath,'utf8')), options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  if (argv.length !== 4 || argv[0] !== '--source' || argv[2] !== '--target') {
    console.error('Usage: node audit.mjs --source normalized-old.json --target normalized-new.json');
    process.exitCode = 3;
  } else {
    try {
      const result = await auditFiles(argv[1], argv[3]);
      process.stdout.write(JSON.stringify(result,null,2)+'\n');
      process.exitCode = result.totalFindings ? 2 : 0;
    } catch(error) {
      console.error(JSON.stringify({status:'INVALID_EVIDENCE',reason:error.name}));
      process.exitCode = 3;
    }
  }
}
