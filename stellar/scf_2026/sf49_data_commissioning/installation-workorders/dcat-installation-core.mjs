// MIT. Complete retained DCAT source selections in the original Installation/Workshare.
import { createHash } from 'node:crypto';
import { bindingTemplate, prepareInstallation, renderWorkorder } from './prepare-core.mjs';
export const DCAT_INSTALLATION_SOURCE_SCHEMA = 'stellar-forge.dcat-installation-source.v1';
export const DCAT_INSTALLATION_SELECTION_SCHEMA = 'stellar-forge.dcat-installation-selection.v1';
export const DCAT_INSTALLATION_PREPARATION_SCHEMA = 'stellar-forge.dcat-installation-preparation.v1';
export const DCAT_INSTALLATION_FAMILIES = Object.freeze([
  'catalog', 'migration-review', 'release', 'source', 'acquisition', 'correction',
  'correction-revision', 'recipient-issue', 'recipient-proposal', 'recipient-decision',
  'semantic-profile', 'semantic-run', 'semantic-review', 'semantic-comparison',
  'semantic-comparison-review',
]);
export const DCAT_INSTALLATION_MAX_SCOPE = 8 * 1024 * 1024;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const dcatInstallationSha = raw => createHash('sha256').update(raw).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])]));
  return value;
}
export const dcatInstallationCanonical = value => JSON.stringify(ordered(value));
export const dcatInstallationIdentity = value => dcatInstallationSha(Buffer.from(dcatInstallationCanonical(value)));
export const dcatInstallationSame = (a, b) => dcatInstallationCanonical(a) === dcatInstallationCanonical(b);
export function dcatInstallationNeed(ok, message, code = 'DCAT_INSTALLATION_INVALID') {
  if (!ok) { const error = new Error(message); error.code = code; throw error; }
}
const need = dcatInstallationNeed;
function exact(value, keys, label) {
  need(object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)),
    'Retain the complete ' + label + ' fields.');
}
function recordKey(family, id, ownerId) {
  need(DCAT_INSTALLATION_FAMILIES.includes(family) && UUID.test(id ?? '') &&
    (ownerId === undefined || UUID.test(ownerId)), 'Retain the original DCAT record identity.');
  return family + '/' + (ownerId ? ownerId + '/' : '') + id;
}
const media = path => /\.jsonl$/.test(path) ? 'application/x-ndjson' : /\.json$/.test(path) ?
  'application/json' : /\.html$/.test(path) ? 'text/html' : /\.ttl$/.test(path) ?
  'text/turtle' : /\.nt$/.test(path) ? 'application/n-triples' : 'application/octet-stream';
/** Called after the original archive reader and original complete domain validators.
 * Catalogue JSON/RDF/member bytes are never parsed or rewritten by this projection. */
export function projectDcatInstallationSource({ archive, workbench }) {
  need(archive?.schema === 'stellar-forge.ckan-workspace-archive.v1' &&
    HASH.test(archive.sha256 ?? '') && HASH.test(archive.manifestSha256 ?? '') &&
    Number.isSafeInteger(archive.bytes) && archive.bytes > 0 &&
    object(archive.manifest) && Array.isArray(archive.manifest.files), 'Use the complete original CKAN/DCAT archive inspection.');
  need(workbench?.schema === 'stellar-forge.ckan-workbench.v1' &&
    workbench.dcat?.schema === 'stellar-forge.dcat-workspace.v1' &&
    workbench.createdAt === archive.source.projectCreatedAt &&
    workbench.catalogOrigin === archive.source.catalogOrigin, 'The original workbench and complete archive differ.');
  need(workbench.operation?.state !== 'RUNNING', 'Select a completed original workspace edition.');
  const members = archive.manifest.files.map(file => ({ ...clone(file), mediaType: media(file.path) }));
  const byPath = new Map(members.map(file => [file.path, file]));
  const stateFile = byPath.get('workbench.json');
  need(stateFile?.sha256 === archive.source.workbenchSha256, 'Retain the complete original workbench identity.');
  const records = [], keys = new Set();
  // Index original directory membership once, preserving manifest order for
  // every ancestor. Repeated record projections then reuse the same exact list.
  const byPrefix = new Map();
  for (const file of members) {
    for (let end = file.path.indexOf('/'); end !== -1; end = file.path.indexOf('/', end + 1)) {
      const prefix = file.path.slice(0, end + 1);
      let files = byPrefix.get(prefix);
      if (!files) { files = []; byPrefix.set(prefix, files); }
      files.push(file);
    }
  }
  const prefixFiles = prefix => byPrefix.get(prefix) ?? [];
  const namedFiles = paths => paths.filter(path => byPath.has(path)).map(path => byPath.get(path));
  function add(family, value, files, links = [], ownerId, extra = {}) {
    need(object(value), 'Retain each complete original source record.');
    const key = recordKey(family, value.id, ownerId);
    need(!keys.has(key), 'The source record is repeated.'); keys.add(key);
    const body = { key, family, id: value.id, ...(ownerId ? { ownerId } : {}),
      label: String(value.label ?? value.name ?? value.note ?? value.id),
      state: value.status ?? value.state ?? null, metadata: clone(value),
      files: clone(files), relationships: [...new Set(links.filter(Boolean))], ...extra };
    records.push({ ...body, recordSha256: dcatInstallationIdentity(body) });
  }
  const key = (family, id, owner) => id ? recordKey(family, id, owner) : null;
  const dcat = workbench.dcat;
  for (const row of dcat.catalogs ?? []) add('catalog', row,
    namedFiles(['dcat/catalogs/' + row.id + '/catalog.json']), [],
    undefined, { documentSha256: row.sha256, documentBytes: row.bytes });
  for (const row of dcat.reviews ?? []) add('migration-review', row,
    prefixFiles('dcat/reviews/' + row.id + '/'),
    [key('catalog', row.sourceId), key('catalog', row.candidateId), key('catalog', row.comparisonId)]);
  for (const row of dcat.releases ?? []) add('release', row,
    namedFiles(['dcat/releases/' + row.id + '.json']),
    [key('migration-review', row.reviewId), key('release', row.previousReleaseId), key('release', row.restoredFromReleaseId)],
    undefined, { active: row.id === dcat.activeReleaseId });
  for (const row of dcat.sources ?? []) add('source', row,
    prefixFiles('dcat/sources/' + row.id + '/'),
    [key('catalog', row.latestCatalogId), key('acquisition', row.latestAcquisitionId)]);
  for (const row of dcat.acquisitions ?? []) add('acquisition', row,
    prefixFiles('dcat/acquisitions/' + row.id + '/'),
    [key('source', row.sourceId), key('catalog', row.catalogId)]);
  const corrections = dcat.corrections;
  for (const draft of corrections?.drafts ?? []) {
    const draftKey = key('correction', draft.id);
    const source = draft.source ?? {};
    add('correction', draft, prefixFiles('dcat/corrections/' + draft.id + '/'),
      [key(source.kind === 'catalog' ? 'catalog' : 'migration-review', source.id),
        ...draft.revisions.map(row => key('correction-revision', row.id, draft.id))]);
    for (const row of draft.revisions) add('correction-revision', row,
      prefixFiles('dcat/corrections/' + draft.id + '/revisions/' + row.id + '/'),
      [draftKey, key('correction-revision', row.previousRevisionId, draft.id)],
      draft.id, { revisionId: row.id, head: row.id === draft.headRevisionId,
        documentSha256: row.documentSha256, documentBytes: row.documentBytes });
  }
  const exchanges = corrections?.exchanges;
  for (const row of exchanges?.issues ?? []) add('recipient-issue', row,
    prefixFiles('dcat/corrections/exchanges/issues/' + row.id + '/'),
    [key('correction', row.correctionId), key('correction-revision', row.revisionId, row.correctionId)]);
  for (const row of exchanges?.proposals ?? []) add('recipient-proposal', row,
    prefixFiles('dcat/corrections/exchanges/proposals/' + row.id + '/'),
    [key('recipient-issue', row.exchangeId), key('correction', row.correctionId)]);
  for (const row of exchanges?.decisions ?? []) add('recipient-decision', row,
    prefixFiles('dcat/corrections/exchanges/decisions/' + row.id + '/'),
    [key('recipient-proposal', row.proposalId), key('correction-revision', row.revisionId, row.correctionId)]);
  const semantic = dcat.semantic;
  for (const row of semantic?.profiles ?? []) add('semantic-profile', row,
    [...namedFiles(['dcat/semantic/profiles/' + row.id + '.json']),
      ...prefixFiles('dcat/semantic/profile-files/' + row.id + '/')],
    [key('semantic-profile', row.supersedesProfileId)]);
  function selectionLinks(row) {
    const selected = row.selection ?? {};
    return [key(selected.kind === 'catalog' ? 'catalog' : 'migration-review', selected.id)];
  }
  for (const row of semantic?.runs ?? []) add('semantic-run', row,
    [...namedFiles(['dcat/semantic/runs/' + row.id + '.json']),
      ...prefixFiles('dcat/semantic/native/' + row.id + '/')],
    [key('semantic-profile', row.profileId), ...selectionLinks(row)]);
  for (const row of semantic?.reviews ?? []) add('semantic-review', row,
    namedFiles(['dcat/semantic/reviews/' + row.id + '.json']),
    [key('semantic-run', row.runId), key('semantic-review', row.previousReviewId)]);
  for (const row of semantic?.comparisons ?? []) add('semantic-comparison', row,
    [...namedFiles(['dcat/semantic/comparisons/' + row.id + '.json']),
      ...prefixFiles('dcat/semantic/native/' + row.id + '/')],
    [key('semantic-run', row.before?.runId), key('semantic-run', row.after?.runId)]);
  for (const row of semantic?.comparisonReviews ?? []) add('semantic-comparison-review', row,
    namedFiles(['dcat/semantic/comparison-reviews/' + row.id + '.json']),
    [key('semantic-comparison', row.comparisonId), key('semantic-comparison-review', row.previousReviewId)]);
  need(records.length > 0, 'Select an original workspace with retained DCAT source records.');
  records.sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  for (const row of records) {
    // Original metadata remains complete even if an older optional link is absent.
    row.relationships = row.relationships.filter(link => keys.has(link));
    const { recordSha256, ...body } = row; row.recordSha256 = dcatInstallationIdentity(body);
  }
  const body = { schema: DCAT_INSTALLATION_SOURCE_SCHEMA,
    archive: { bytes: archive.bytes, sha256: archive.sha256 },
    manifestSha256: archive.manifestSha256,
    project: { createdAt: workbench.createdAt, catalogOrigin: workbench.catalogOrigin,
      sourceKind: workbench.sourceKind ?? 'ckan', originalDirectory: archive.source.directory },
    workbench: clone(stateFile), manifest: clone(archive.manifest), records,
    pending: { operation: clone(workbench.operation ?? null),
      corrections: clone(corrections?.pending ?? []), exchanges: clone(exchanges?.pending ?? []) },
    totals: { members: members.length, bytes: archive.unpackedBytes,
      records: records.length, families: Object.fromEntries(DCAT_INSTALLATION_FAMILIES.map(family =>
        [family, records.filter(row => row.family === family).length])) },
    qualification: 'All original archive bytes and outcomes remain retained. Selected scope and local catalogue/review decisions do not establish commissioned acceptance or payment.' };
  return { ...body, sourceSha256: dcatInstallationIdentity(body) };
}
export function validateDcatInstallationSource(source) {
  need(source?.schema === DCAT_INSTALLATION_SOURCE_SCHEMA && HASH.test(source.sourceSha256 ?? ''),
    'Use the complete retained DCAT installation source.');
  const { sourceSha256, ...body } = source;
  need(dcatInstallationIdentity(body) === sourceSha256, 'The original complete source report changed.');
  need(Array.isArray(source.records) && new Set(source.records.map(row => row.key)).size === source.records.length,
    'Retain each original source record once.');
  for (const row of source.records) {
    const { recordSha256, ...record } = row;
    need(HASH.test(recordSha256 ?? '') && dcatInstallationIdentity(record) === recordSha256,
      'A selected record changed.');
  }
  return source;
}
export function dcatInstallationRows({ source, offset = 0, limit = 50, family = '', query = '' }) {
  validateDcatInstallationSource(source);
  need(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit > 0 && limit <= 500 &&
    (family === '' || DCAT_INSTALLATION_FAMILIES.includes(family)) && typeof query === 'string' && query.length <= 4096,
    'Use the supported complete-source page and filters.');
  const term = query.toLocaleLowerCase();
  const rows = source.records.filter(row => (!family || row.family === family) &&
    (!term || JSON.stringify(row).toLocaleLowerCase().includes(term)));
  return { sourceSha256: source.sourceSha256, records: rows.slice(offset, offset + limit).map(row => ({
    key: row.key, family: row.family, id: row.id, ...(row.ownerId ? { ownerId: row.ownerId } : {}),
    label: row.label, state: row.state, recordSha256: row.recordSha256,
    files: row.files.length, relationships: row.relationships.length,
    ...(row.documentSha256 ? { documentSha256: row.documentSha256, documentBytes: row.documentBytes } : {}),
  })), page: { offset, limit, total: rows.length, nextOffset: offset + limit < rows.length ? offset + limit : null } };
}
export function dcatInstallationRecord({ source, key }) {
  validateDcatInstallationSource(source);
  const row = source.records.find(row => row.key === key);
  need(row, 'Choose an original record from this source.', 'DCAT_INSTALLATION_RECORD_NOT_FOUND');
  return clone(row);
}
function sameCase(seed, caseValue) {
  need(object(caseValue?.program) && Array.isArray(caseValue.sources) &&
    seed?.source?.caseId === caseValue.program.id && seed.source.version === caseValue.program.version &&
    seed.source.planId === caseValue.program.planId, 'Use the complete same-version original case and Workshare seed.');
  need(caseValue.sources.length <= 200, 'Retain the original case source-count bound.');
}
function attachment(caseValue, id, file, label) {
  const rows = caseValue.sources.filter(row => row.id === id);
  need(rows.length === 1 && rows[0].bytes === file.bytes && rows[0].sha256 === file.sha256,
    'Attach the complete exact ' + label + ' through the original Operations source writer.');
  return rows[0];
}
export function dcatInstallationTemplate({ source, seed, caseValue, profile }) {
  validateDcatInstallationSource(source); sameCase(seed, caseValue);
  const matches = caseValue.sources.filter(row => row.bytes === source.archive.bytes && row.sha256 === source.archive.sha256);
  return { selection: { schema: DCAT_INSTALLATION_SELECTION_SCHEMA, sourceSha256: source.sourceSha256,
    archive: { sourceId: matches.length === 1 ? matches[0].id : null, ...source.archive },
    records: source.records.map(row => ({ key: row.key, recordSha256: row.recordSha256, included: false, purpose: '' })) },
    bindings: bindingTemplate(seed, profile) };
}
export function prepareDcatInstallation({ source, seed, caseValue, profile, bindings, selectionRaw, selectionSourceId }) {
  validateDcatInstallationSource(source); sameCase(seed, caseValue);
  need(Buffer.isBuffer(selectionRaw) && selectionRaw.length <= DCAT_INSTALLATION_MAX_SCOPE,
    'Retain the complete source selection within its original case-source allowance.');
  let selection;
  try { selection = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(selectionRaw)); }
  catch { throw new Error('Use a complete UTF-8 source selection JSON file.'); }
  exact(selection, ['schema', 'sourceSha256', 'archive', 'records'], 'DCAT source selection');
  exact(selection.archive, ['sourceId', 'bytes', 'sha256'], 'whole archive source selection');
  need(selection.schema === DCAT_INSTALLATION_SELECTION_SCHEMA && selection.sourceSha256 === source.sourceSha256 &&
    selection.archive.bytes === source.archive.bytes && selection.archive.sha256 === source.archive.sha256,
    'The complete source edition differs from this scope.');
  const archive = attachment(caseValue, selection.archive.sourceId, source.archive, 'DCAT workspace archive');
  const selectedFile = { sourceId: selectionSourceId, bytes: selectionRaw.length, sha256: dcatInstallationSha(selectionRaw) };
  attachment(caseValue, selectionSourceId, selectedFile, 'source scope JSON');
  need(Array.isArray(selection.records) && selection.records.length === source.records.length,
    'Retain every source record with its explicit inclusion or exclusion.');
  const byKey = new Map(source.records.map(row => [row.key, row])), seen = new Set(), records = [];
  for (const row of selection.records) {
    exact(row, ['key', 'recordSha256', 'included', 'purpose'], 'scope decision');
    const original = byKey.get(row.key);
    need(original && original.recordSha256 === row.recordSha256 && !seen.has(row.key),
      'Select each original source record once by its exact identity.');
    need(typeof row.included === 'boolean' && typeof row.purpose === 'string' && row.purpose.trim() &&
      row.purpose.length <= 4000, 'Give each included or excluded record its actual purpose.');
    seen.add(row.key); records.push(clone(row));
  }
  need(records.some(row => row.included), 'Select a complete useful customer output or source.');
  const next = clone(bindings);
  need(object(next.source) && object(next.receiving), 'Use the complete maintained bindings template.');
  for (const field of ['source', 'receiving']) next[field].sourceIds =
    [...new Set([...(next[field].sourceIds ?? []), archive.id, selectionSourceId])];
  const prepared = prepareInstallation(seed, profile, next);
  need(prepared.document.workshare && prepared.document.source.mode === 'SNAPSHOT',
    'Keep the original commercial Workshare and complete selected source edition.');
  need(Buffer.byteLength(JSON.stringify(prepared.document)) <= 128 * 1024,
    'Keep the whole native Installation document within its original 128 KiB allowance.');
  const snapshot = { schema: 'stellar-forge.dcat-installation-scope.v1', originalCase: clone(seed.source),
    workshare: clone(prepared.document.workshare), sourceSha256: source.sourceSha256,
    project: clone(source.project), manifestSha256: source.manifestSha256,
    archive: clone(selection.archive), selection: selectedFile, records,
    completeSource: { records: source.records.length, members: source.totals.members, bytes: source.totals.bytes },
    qualification: source.qualification };
  return { schema: DCAT_INSTALLATION_PREPARATION_SCHEMA, source, prepared,
    selection, snapshot, bindings: next, workorder: renderWorkorder(prepared) };
}
