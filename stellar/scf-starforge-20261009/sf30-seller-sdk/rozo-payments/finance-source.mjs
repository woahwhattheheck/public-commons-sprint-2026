// MIT. Exact saved ROZO reports and native evidence for the existing finance owners.
import {
  assert, fields, id, integer, text, sha, canonical, jsonDigest, digest, clone,
  validateProfile, validateAsset, assetKey, amountUnits
} from './model.mjs';
import { REPORT_SCHEMA, verifyReport } from './reports.mjs';

export const ROZO_FINANCE_SOURCE_SCHEMA = 'stellar-forge.rozo-finance-source.v1';
export const ROZO_FINANCE_FACTS_SCHEMA = 'stellar-forge.rozo-finance-facts.v1';
export const ROZO_FINANCE_SOURCE_LIMIT = 64 * 1024 * 1024;
const FILE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,299}$/;
const HEX = /^[a-f0-9]{64}$/;
const fail = (ok, message) => assert(ok, 'ROZO_FINANCE_SOURCE_INVALID', message, 409);
const parsed = raw => JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
const jsonBytes = value => Buffer.from(canonical(value) + '\n', 'utf8');

function descriptor(raw, type) {
  return { bytes: raw.length, sha256: digest(raw), type, base64: raw.toString('base64') };
}
function originalBytes(value, maximum = ROZO_FINANCE_SOURCE_LIMIT) {
  fail(value && typeof value === 'object' && !Array.isArray(value), 'Retain the complete original file descriptor.');
  integer(value.bytes, 'original file bytes', 0, maximum);
  sha(value.sha256, 'original file SHA-256');
  fail(typeof value.base64 === 'string' && value.base64.length <= Math.ceil(maximum / 3) * 4,
    'Retain the complete original base64 body within the source limit.');
  const raw = Buffer.from(value.base64, 'base64');
  fail(raw.toString('base64') === value.base64 && raw.length === value.bytes && digest(raw) === value.sha256,
    'The original file byte count or SHA-256 differs.');
  return raw;
}
function recordIdentity(record, kind) {
  fail(record && record.value && typeof record.value === 'object', 'Retain the original ' + kind + ' record.');
  integer(record.version, kind + ' version', 1);
  integer(record.workspaceRevision, kind + ' workspace revision');
  sha(record.sha256, kind + ' record SHA-256');
  fail(jsonDigest(record.value) === record.sha256, 'The retained ' + kind + ' record bytes differ.');
  return record;
}
function unique(values, key, name) {
  const map = new Map();
  for (const value of values) {
    const selected = key(value);
    fail(!map.has(selected), 'The original source repeats ' + name + ' ' + selected + '.');
    map.set(selected, value);
  }
  return map;
}
function editionAt(workspace, kind, recordId, revision) {
  const editions = workspace.history(kind, recordId).filter(row => row.workspaceRevision <= revision);
  const value = editions.at(-1);
  fail(value, 'The original report refers to a missing ' + kind + ' edition: ' + recordId);
  return clone(value);
}

/**
 * Capture an existing immutable report without refreshing a provider or changing
 * either finance workspace. The returned body has a deterministic identity.
 * Original report files, raw HTTP bodies and report-era order editions travel
 * together; receiving does not need the producer's credentials or directory.
 */
export function captureRozoFinanceSource(workspace, {
  reportId, reportVersion, expectedReportSha256
} = {}) {
  id(reportId, 'reportId');
  sha(expectedReportSha256, 'expected report SHA-256');
  if (reportVersion !== undefined) integer(reportVersion, 'report version', 1);
  const record = workspace.get('report', reportId, { version: reportVersion });
  fail(record, 'Select an existing saved ROZO report.');
  verifyReport(record.value);
  fail(record.value.sha256 === expectedReportSha256, 'The selected original report differs from the reviewed SHA-256.');
  const meta = workspace.meta(), report = record.value;
  fail(report.workspaceId === meta.workspaceId, 'The saved report belongs to another original workspace.');
  const profile = workspace.get('profile', report.profileId, { version: report.profileVersion });
  recordIdentity(profile, 'profile');
  fail(profile.sha256 === report.profileSha256 && canonical(profile.value) === canonical(report.profile),
    'The original report profile edition is missing or changed.');

  const objects = new Map();
  const retain = value => {
    const raw = workspace.wholeObject(value.sha256);
    fail(raw.length === value.bytes, 'A saved report object differs from its recorded length.');
    const body = { ...descriptor(raw, value.type), sha256: value.sha256 };
    const old = objects.get(body.sha256);
    if (old) fail(old.bytes === body.bytes && old.base64 === body.base64,
      'Two original object descriptors disagree.');
    else objects.set(body.sha256, body);
    return body;
  };
  const reportFiles = report.files.map(file => {
    retain(file);
    return clone(file);
  });
  const captures = report.original.captures.map(capture => {
    const original = workspace.getCapture(capture.id);
    fail(original && canonical(original) === canonical(capture), 'The original report capture changed.');
    if (capture.body) retain(capture.body);
    return clone(capture);
  });
  const observations = report.original.observations.map(observation => {
    const original = workspace.observation(observation.id);
    fail(original && canonical(original) === canonical(observation), 'The original report observation changed.');
    return clone(observation);
  });
  // Contract links retain their actual observed event/transaction, not a
  // generated proof. Provider confirmation keeps its original label.
  const contractObservations = new Map();
  for (const row of report.rows) for (const link of row.contractLinks ?? []) {
    const observation = workspace.observation(link.observationId);
    fail(observation && observation.sha256 === link.observationSha256 &&
      observation.profileId === report.profileId, 'A selected contract-evidence observation changed.');
    contractObservations.set(observation.id, clone(observation));
    if (observation.captureId && !captures.some(c => c.id === observation.captureId)) {
      const capture = workspace.getCapture(observation.captureId);
      fail(capture && capture.profileId === report.profileId, 'A contract-evidence capture is absent.');
      captures.push(clone(capture));
      if (capture.body) retain(capture.body);
    }
  }
  const orders = [...new Set(report.rows.map(row => row.internalOrderId).filter(Boolean))]
    .sort().map(orderId => editionAt(workspace, 'order', orderId, report.workspaceRevision));
  const source = {
    schema: ROZO_FINANCE_SOURCE_SCHEMA,
    workspace: {
      schema: 'stellar-forge.rozo-workspace.v1',
      workspaceId: meta.workspaceId, originId: meta.originId, createdAt: meta.createdAt
    },
    sourceId: 'rozo-' + jsonDigest({ originId: meta.originId, profileId: report.profileId }),
    report: clone(record), profile: clone(profile), orders, reportFiles,
    observations, contractObservations: [...contractObservations.values()].sort((a, b) => a.id.localeCompare(b.id)),
    captures: captures.sort((a, b) => a.id.localeCompare(b.id)),
    objects: [...objects.values()].sort((a, b) => a.sha256.localeCompare(b.sha256)),
    interpretation: {
      provider: report.profile.type,
      amountBasis: 'Original exact native units and selected chain/network/token/precision.',
      confirmationBasis: 'Original provider confirmation; selected contract evidence remains separate.',
      dateBasis: 'Original provider timestamps. Accounting recognition dates require an explicit review.',
      movementBasis: 'Source payment, provider fee and destination payout are distinct facts; no automatic income/expense or FX assignment.'
    }
  };
  source.sha256 = jsonDigest(source);
  inspectRozoFinanceSource(source);
  return source;
}

/** Validate the complete retained source, including every ordinary file body. */
export function inspectRozoFinanceSource(input) {
  const source = Buffer.isBuffer(input) || input instanceof Uint8Array ? parsed(input) : input;
  fields(source, ['schema', 'workspace', 'sourceId', 'report', 'profile', 'orders', 'reportFiles',
    'observations', 'contractObservations', 'captures', 'objects', 'interpretation', 'sha256'], 'ROZO finance source');
  fail(source.schema === ROZO_FINANCE_SOURCE_SCHEMA, 'Choose an original ROZO finance source.');
  const { sha256, ...body } = source;
  sha(sha256, 'finance source SHA-256');
  fail(jsonDigest(body) === sha256, 'The complete finance source differs from its recorded identity.');
  const size = jsonBytes(source).length;
  fail(size <= ROZO_FINANCE_SOURCE_LIMIT, 'The complete finance source exceeds 64 MiB; preserve it without truncation.');
  fields(source.workspace, ['schema', 'workspaceId', 'originId', 'createdAt'], 'source workspace');
  fail(source.workspace.schema === 'stellar-forge.rozo-workspace.v1', 'Retain the original workspace identity.');
  id(source.workspace.workspaceId, 'workspaceId'); id(source.workspace.originId, 'originId');
  text(source.workspace.createdAt, 'workspace creation time', 80);
  const record = recordIdentity(source.report, 'report'), report = verifyReport(record.value);
  fail(report.schema === REPORT_SCHEMA && report.workspaceId === source.workspace.workspaceId,
    'The saved report and original workspace differ.');
  fail(source.sourceId === 'rozo-' + jsonDigest({ originId: source.workspace.originId, profileId: report.profileId }),
    'The source identifier does not name its original profile and workspace.');
  const profile = recordIdentity(source.profile, 'profile');
  validateProfile(profile.value);
  fail(profile.version === report.profileVersion && profile.sha256 === report.profileSha256 &&
    canonical(profile.value) === canonical(report.profile), 'The original profile edition differs.');
  for (const name of ['orders', 'reportFiles', 'observations', 'contractObservations', 'captures', 'objects'])
    fail(Array.isArray(source[name]), 'Retain the complete ' + name + ' array.');
  fail(Array.isArray(report.rows) && Array.isArray(report.original?.observations) &&
    Array.isArray(report.original?.captures), 'The original report source arrays are absent.');
  const rows = unique(report.rows, row => row.paymentId, 'payment');
  fail(report.rows.every(row => row.profileId === report.profileId), 'A report row names another profile.');
  const objects = unique(source.objects, value => value.sha256, 'source object');
  let retainedBytes = 0;
  for (const value of objects.values()) { originalBytes(value); retainedBytes += value.bytes; }
  fail(retainedBytes <= ROZO_FINANCE_SOURCE_LIMIT, 'The original evidence bodies exceed the complete source limit.');
  const requireObject = selected => {
    fail(selected && HEX.test(selected.sha256 ?? ''), 'An original file descriptor is absent.');
    const object = objects.get(selected.sha256);
    fail(object && object.bytes === selected.bytes, 'An original file body or byte identity is absent.');
    return originalBytes(object);
  };
  fail(canonical(source.reportFiles) === canonical(report.files) && source.reportFiles.length === 3,
    'Retain the original report JSON, CSV and HTML files.');
  const reportNames = unique(source.reportFiles, f => f.name, 'report filename');
  for (const name of reportNames.keys()) fail(FILE.test(name), 'An original report filename is invalid.');
  const originalJSON = source.reportFiles.find(f => f.type === 'application/json');
  const originalCSV = source.reportFiles.find(f => f.type.startsWith('text/csv'));
  const originalHTML = source.reportFiles.find(f => f.type.startsWith('text/html'));
  fail(originalJSON && originalCSV && originalHTML, 'All three original report representations are required.');
  const { files, ...fileReport } = report;
  fail(requireObject(originalJSON).equals(jsonBytes(fileReport)),
    'The original report JSON file differs from the saved report.');
  // CSV and HTML are frozen original representations. Their bytes are bound by
  // the immutable report descriptors and source hash; a later renderer edition
  // must not invalidate an already saved report.
  requireObject(originalCSV); requireObject(originalHTML);

  const observations = unique(source.observations, o => o.id, 'report observation');
  fail(canonical(source.observations) === canonical(report.original.observations),
    'The complete original report observations differ.');
  const contracts = unique(source.contractObservations, o => o.id, 'contract observation');
  const captures = unique(source.captures, c => c.id, 'capture');
  const referencedObjects = new Set(source.reportFiles.map(f => f.sha256));
  for (const selected of report.original.captures)
    fail(canonical(captures.get(selected.id) ?? null) === canonical(selected), 'An original report capture is missing.');
  for (const observation of [...observations.values(), ...contracts.values()]) {
    fail(observation.profileId === report.profileId && jsonDigest(observation.value) === observation.sha256,
      'An original observation profile or value identity differs.');
    const expectedId = 'obs-' + jsonDigest({ profileId: observation.profileId, kind: observation.kind,
      identity: observation.identity, captureId: observation.captureId, hash: observation.sha256 });
    fail(observation.id === expectedId, 'An original observation identifier differs.');
    if (observation.captureId) fail(captures.has(observation.captureId), 'An observation capture is absent.');
  }
  const referencedContracts = new Set();
  for (const row of rows.values()) {
    if (row.sourceObservationId) {
      const observation = observations.get(row.sourceObservationId);
      fail(observation && observation.identity === row.paymentId && observation.sha256 === row.sourceSha256 &&
        observation.kind === 'payment', 'The selected native payment observation differs.');
    } else fail(row.sourceSha256 === null, 'An unobserved payment cannot carry a generated source hash.');
    for (const selected of row.contractLinks ?? []) {
      const observation = contracts.get(selected.observationId);
      fail(observation && selected.profileId === row.profileId && selected.paymentId === row.paymentId &&
        observation.sha256 === selected.observationSha256, 'A selected contract link differs.');
      referencedContracts.add(observation.id);
    }
  }
  fail(referencedContracts.size === contracts.size, 'The packet carries an unrelated contract observation.');
  const referencedCaptures = new Set([...observations.values(), ...contracts.values()].map(o => o.captureId).filter(Boolean));
  fail(referencedCaptures.size === captures.size && [...captures.keys()].every(key => referencedCaptures.has(key)),
    'The packet carries an unrelated or missing native capture.');
  for (const capture of captures.values()) {
    fail(capture.profileId === report.profileId, 'A raw capture belongs to another original profile.');
    if (capture.body) { requireObject(capture.body); referencedObjects.add(capture.body.sha256); }
  }
  fail(referencedObjects.size === objects.size && [...objects.keys()].every(key => referencedObjects.has(key)),
    'Every retained object must belong to the original selected evidence.');
  const orders = unique(source.orders, row => row.value?.id, 'order');
  for (const order of orders.values()) {
    recordIdentity(order, 'order');
    fail(order.workspaceRevision <= report.workspaceRevision && order.value.profileId === report.profileId,
      'The source carries a later or unrelated order edition.');
  }
  const selectedOrders = new Set(report.rows.map(row => row.internalOrderId).filter(Boolean));
  fail(orders.size === selectedOrders.size && [...selectedOrders].every(key => orders.has(key)),
    'Retain exactly the report-era order editions.');
  return {
    source, schema: ROZO_FINANCE_SOURCE_SCHEMA, sourceId: source.sourceId, sha256,
    bytes: size, workspaceId: source.workspace.workspaceId, originId: source.workspace.originId,
    profileId: report.profileId, reportId: report.id, reportSha256: report.sha256,
    reportVersion: record.version, reportWorkspaceRevision: report.workspaceRevision,
    rows: report.rows.length, originalObjects: objects.size, originalBytes: retainedBytes
  };
}

export function rozoFinanceSourceBytes(source) {
  inspectRozoFinanceSource(source);
  return jsonBytes(source);
}
export function rozoFinancePaymentKey(source, paymentId) {
  return 'rozo-payment-' + jsonDigest({ originId: source.workspace.originId,
    profileId: source.report.value.profileId, paymentId });
}
function amountFact(value) {
  if (value === null || value === undefined) return null;
  if (value.asset) validateAsset(value.asset);
  if (value.units !== null) {
    fail(value.asset && typeof value.units === 'string' && /^(0|[1-9][0-9]*)$/.test(value.units),
      'A measured amount must retain exact nonnegative native units.');
    fail(amountUnits(value.raw, value.asset.decimals).toString() === value.units,
      'The retained exact amount differs from the selected precision.');
  }
  return clone(value);
}
/**
 * Facts remain separate from financial recognition. An operator subsequently
 * selects the original merchant settlement or buyer purchase and its own
 * accounting date/coding using the existing Accounting/Buyer contracts.
 */
export function rozoFinanceFacts(input) {
  const { source } = inspectRozoFinanceSource(input), report = source.report.value;
  const facts = report.rows.map(row => {
    const value = {
      id: rozoFinancePaymentKey(source, row.paymentId),
      profileId: row.profileId, appId: row.appId, orderId: row.orderId,
      internalOrderId: row.internalOrderId, paymentId: row.paymentId,
      reportId: report.id, reportSha256: report.sha256, sourceSha256: source.sha256,
      providerProfile: report.profile.type, providerStatus: row.status,
      providerCreatedAt: row.createdAt, providerUpdatedAt: row.providerUpdatedAt,
      sourceObservationId: row.sourceObservationId, sourceObservationSha256: row.sourceSha256,
      expectedSource: amountFact(row.expectedSource),
      movements: [
        { kind: 'source_payment', amount: amountFact(row.receivedSource), observation: clone(row.sourcePayment) },
        { kind: 'source_fee', amount: amountFact(row.sourceFee),
          observation: { state: row.sourcePayment.state, txHash: row.sourcePayment.txHash,
            confirmedAt: row.sourcePayment.confirmedAt } },
        { kind: 'destination_payout', amount: amountFact(row.destinationAmount),
          observation: clone(row.destinationPayout) }
      ],
      merchantSettlement: clone(row.merchantSettlement),
      fulfilment: clone(row.fulfilment), issues: clone(row.issues), unresolved: clone(row.unresolved),
      decisions: clone(row.decisions), contractLinks: clone(row.contractLinks ?? [])
    };
    return { ...value, basisSha256: jsonDigest(value) };
  });
  return { schema: ROZO_FINANCE_FACTS_SCHEMA, sourceId: source.sourceId, sourceSha256: source.sha256,
    workspaceId: source.workspace.workspaceId, originId: source.workspace.originId,
    reportId: report.id, reportSha256: report.sha256, facts,
    assetGroups: [...new Set(facts.flatMap(row => row.movements.map(m => m.amount?.asset)
      .filter(Boolean).map(assetKey)))].sort() };
}
