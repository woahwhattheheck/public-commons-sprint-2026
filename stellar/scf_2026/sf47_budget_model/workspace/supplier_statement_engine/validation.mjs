import { canonicalJson, fail, sha256 } from './json.mjs';
import {
  assertCurrency,
  assertDate,
  assertDigest,
  assertEvidenceRef,
  assertExactKeys,
  assertOpaqueId,
  assertPositiveInt,
  assertSignedMinor,
  assertString,
  assertSupplierRef,
  assertUtc,
  canonicalDocumentRef,
  checkedAddSigned,
} from './guards.mjs';

export { assertUtc, canonicalRef, daysBetween, editDistanceAtMostOne, safeSignedAdd } from './guards.mjs';

export const INPUT_SCHEMA = 'smb.supplier-statement-reconciliation.input/v1';
export const RECEIPT_SCHEMA = 'smb.supplier-statement-reconciliation.receipt/v1';
export const MAX_ROWS = 1_000;

const isObj = value => value !== null && typeof value === 'object' && !Array.isArray(value);

function validatePolicy(policy) {
  assertExactKeys(policy, ['maxAgeHours', 'enablePossibleMatchReview', 'possibleMatchDateWindowDays']);
  if (typeof policy.enablePossibleMatchReview !== 'boolean') fail('INVALID_POLICY');
  const maxAgeHours = assertPositiveInt(policy.maxAgeHours, 'INVALID_POLICY');
  if (maxAgeHours < 1 || maxAgeHours > 24 * 31) fail('INVALID_POLICY');
  const possibleMatchDateWindowDays = assertPositiveInt(policy.possibleMatchDateWindowDays, 'INVALID_POLICY');
  if (possibleMatchDateWindowDays > 31) fail('INVALID_POLICY');
  return { maxAgeHours, enablePossibleMatchReview: policy.enablePossibleMatchReview, possibleMatchDateWindowDays };
}

function validateRow(row, side) {
  const idKey = side === 'statement' ? 'statementRowId' : 'ledgerRowId';
  assertExactKeys(row, [idKey, 'documentRef', 'rowType', 'eventDate', 'effectMinor', 'evidenceRef', 'evidenceDigest']);
  const rowType = assertString(row.rowType, 'INVALID_ROW_TYPE', 16);
  if (!['INVOICE', 'CREDIT', 'PAYMENT', 'ADJUSTMENT'].includes(rowType)) fail('INVALID_ROW_TYPE');
  const effectMinor = assertSignedMinor(row.effectMinor);
  if (effectMinor === 0) fail('ZERO_EFFECT_NOT_ALLOWED');
  if (rowType === 'INVOICE' && effectMinor <= 0) fail('ROW_SIGN_MISMATCH', rowType);
  if ((rowType === 'CREDIT' || rowType === 'PAYMENT') && effectMinor >= 0) fail('ROW_SIGN_MISMATCH', rowType);
  const documentRef = assertString(row.documentRef, 'INVALID_DOCUMENT_REF', 96);
  const canonicalRefValue = canonicalDocumentRef(documentRef);
  return {
    [idKey]: assertOpaqueId(row[idKey], `INVALID_${idKey.toUpperCase()}`),
    documentRef,
    canonicalRef: canonicalRefValue,
    rowType,
    eventDate: assertDate(row.eventDate),
    effectMinor,
    evidenceRef: assertEvidenceRef(row.evidenceRef),
    evidenceDigest: assertDigest(row.evidenceDigest),
  };
}

function dedupeRows(rows, side) {
  const idKey = side === 'statement' ? 'statementRowId' : 'ledgerRowId';
  const byId = new Map();
  const evidence = new Map();
  const semantic = new Map();
  for (const row of rows) {
    const bytes = canonicalJson(row);
    const id = row[idKey];
    if (byId.has(id)) {
      if (byId.get(id).bytes !== bytes) fail('ROW_ID_CONFLICT', id);
      continue;
    }
    const evidenceKey = `${row.evidenceRef}\u001f${row.evidenceDigest}`;
    const evidenceMeaning = `${row.canonicalRef}\u001f${row.rowType}\u001f${row.eventDate}\u001f${row.effectMinor}`;
    if (evidence.has(evidenceKey) && evidence.get(evidenceKey) !== evidenceMeaning) fail('ROW_EVIDENCE_ALIAS_CONFLICT', row.evidenceRef);
    evidence.set(evidenceKey, evidenceMeaning);
    if (semantic.has(row.canonicalRef)) {
      const prior = semantic.get(row.canonicalRef);
      if (prior.rowType !== row.rowType || prior.effectMinor !== row.effectMinor) fail('CANONICAL_DOCUMENT_SEMANTIC_CONFLICT', row.canonicalRef);
      fail('CANONICAL_DOCUMENT_REUSE', row.canonicalRef);
    }
    semantic.set(row.canonicalRef, row);
    byId.set(id, { row, bytes });
  }
  return [...byId.values()].map(x => x.row);
}

function validateSnapshot(snapshot, side, policy, evaluatedAt) {
  const idKey = side === 'statement' ? 'statementRowId' : 'ledgerRowId';
  assertExactKeys(snapshot, ['generationId', 'supplierRef', 'currency', 'periodEnd', 'capturedAt', 'complete', 'openingBalanceMinor', 'closingBalanceMinor', 'evidenceRef', 'evidenceDigest', 'rows']);
  if (snapshot.complete !== true) fail('INCOMPLETE_GENERATION', side);
  const periodEnd = assertDate(snapshot.periodEnd);
  const capturedAt = assertUtc(snapshot.capturedAt);
  const evalMs = Date.parse(evaluatedAt);
  const capturedMs = Date.parse(capturedAt);
  if (capturedMs > evalMs) fail('FUTURE_GENERATION', side);
  if (evalMs - capturedMs > policy.maxAgeHours * 3_600_000) fail('STALE_GENERATION', side);
  if (Date.parse(`${periodEnd}T00:00:00Z`) > evalMs) fail('FUTURE_PERIOD_END', side);
  if (capturedAt.slice(0, 10) < periodEnd) fail('CAPTURED_BEFORE_PERIOD_END', side);
  if (!Array.isArray(snapshot.rows) || snapshot.rows.length > MAX_ROWS) fail('INVALID_ROWS', side);
  const normalizedRows = dedupeRows(snapshot.rows.map(row => validateRow(row, side)), side);
  const openingBalanceMinor = assertSignedMinor(snapshot.openingBalanceMinor, 'INVALID_OPENING_BALANCE');
  const closingBalanceMinor = assertSignedMinor(snapshot.closingBalanceMinor, 'INVALID_CLOSING_BALANCE');
  const calculated = checkedAddSigned([openingBalanceMinor, ...normalizedRows.map(row => row.effectMinor)]);
  if (calculated !== closingBalanceMinor) fail('GENERATION_BALANCE_ARITHMETIC_MISMATCH', side);
  const cmp = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  normalizedRows.sort((a, b) => {
    const aid = a[idKey]; const bid = b[idKey];
    return cmp(a.canonicalRef, b.canonicalRef) || cmp(a.rowType, b.rowType) || cmp(aid, bid);
  });
  return {
    generationId: assertOpaqueId(snapshot.generationId, 'INVALID_GENERATION_ID'),
    supplierRef: assertSupplierRef(snapshot.supplierRef),
    currency: assertCurrency(snapshot.currency),
    periodEnd,
    capturedAt,
    complete: true,
    openingBalanceMinor,
    closingBalanceMinor,
    evidenceRef: assertEvidenceRef(snapshot.evidenceRef),
    evidenceDigest: assertDigest(snapshot.evidenceDigest),
    rows: normalizedRows,
  };
}

export function normalizeInput(input, evaluatedAt) {
  if (!isObj(input)) fail('INPUT_OBJECT_REQUIRED');
  assertExactKeys(input, ['schemaVersion', 'policy', 'statement', 'ledger']);
  if (input.schemaVersion !== INPUT_SCHEMA) fail('INVALID_SCHEMA_VERSION');
  const policy = validatePolicy(input.policy);
  const statement = validateSnapshot(input.statement, 'statement', policy, evaluatedAt);
  const ledger = validateSnapshot(input.ledger, 'ledger', policy, evaluatedAt);
  if (statement.supplierRef !== ledger.supplierRef) fail('SUPPLIER_SCOPE_MISMATCH');
  if (statement.currency !== ledger.currency) fail('CURRENCY_SCOPE_MISMATCH');
  if (statement.periodEnd !== ledger.periodEnd) fail('PERIOD_SCOPE_MISMATCH');
  if (statement.evidenceRef === ledger.evidenceRef && statement.evidenceDigest === ledger.evidenceDigest) fail('GENERATION_EVIDENCE_ALIAS_CONFLICT');
  const crossEvidence = new Map();
  for (const rows of [statement.rows, ledger.rows]) {
    for (const row of rows) {
      const key = `${row.evidenceRef}\u001f${row.evidenceDigest}`;
      const meaning = `${row.canonicalRef}\u001f${row.rowType}\u001f${row.eventDate}\u001f${row.effectMinor}`;
      if (crossEvidence.has(key) && crossEvidence.get(key) !== meaning) fail('CROSS_SIDE_EVIDENCE_ALIAS_CONFLICT', row.evidenceRef);
      if (!crossEvidence.has(key)) crossEvidence.set(key, meaning);
    }
  }
  return { schemaVersion: INPUT_SCHEMA, policy, statement, ledger };
}

export function publicNormalizedInput(normalized) {
  const strip = side => ({
    generationId: side.generationId,
    supplierRef: side.supplierRef,
    currency: side.currency,
    periodEnd: side.periodEnd,
    capturedAt: side.capturedAt,
    complete: side.complete,
    openingBalanceMinor: side.openingBalanceMinor,
    closingBalanceMinor: side.closingBalanceMinor,
    evidenceRef: side.evidenceRef,
    evidenceDigest: side.evidenceDigest,
    rows: side.rows.map(row => {
      const { canonicalRef: _drop, ...rest } = row;
      return rest;
    }),
  });
  return { schemaVersion: normalized.schemaVersion, policy: normalized.policy, statement: strip(normalized.statement), ledger: strip(normalized.ledger) };
}

export function inputDigest(normalized) { return sha256(publicNormalizedInput(normalized)); }
export function snapshotSemanticDigest(snapshot) {
  return sha256({ ...snapshot, rows: snapshot.rows.map(row => {
    const { canonicalRef: _drop, ...rest } = row;
    return rest;
  }) });
}
