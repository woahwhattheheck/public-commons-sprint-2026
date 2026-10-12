// MIT. Complete laboratory review in the original customer's retained Job Workspace.
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { privateDirectory, readPrivateJson } from '../routescan/quota.mjs';
import { writeBytes } from '../../sf88-operator-buyer-cli/node/store.mjs';
import { labProfile, labProfiles } from './profiles.mjs';
import { inspectDelivery, normalizeDecisions, canonicalJson, sha256 } from './model.mjs';
import { sourceMembers, readLabDecisions } from './application.mjs';
import { readReconciliationDecisions } from './reconciliation-application.mjs';
import { reconcileDeliveries } from './reconciliation.mjs';
import { reviewTable } from './decisions.mjs';
import { reconciliationTable, reconciliationFieldTable } from './reconciliation-table.mjs';
import { renderLabReport } from './report.mjs';
import { renderReconciliationReport } from './reconciliation-report.mjs';
import { readLabResult } from './result.mjs';
import { labError } from './table.mjs';
import { laboratoryParameters, laboratoryBinding, assertLaboratoryBinding, laboratorySourceView,
  previewLaboratoryReview, laboratoryRows, laboratoryIssues, laboratoryGroups,
  LAB_OPERATOR_REVIEW_SCHEMA, laboratoryJson } from './operator-model.mjs';

const SHA = /^[0-9a-f]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;
const same = (a, b) => canonicalJson(a) === canonicalJson(b);
const jsonBytes = value => Buffer.from(laboratoryJson(value));
const descriptor = file => ({ fileId: file.fileId, name: file.name, contentType: file.contentType,
  bytes: file.bytes, sha256: file.sha256 });
const page = (rows, { offset = 0, limit = 50 } = {}) => {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200)
    labError('OPERATOR_PAGE', 'Choose a nonnegative offset and between one and 200 complete records.');
  if (offset > rows.length) labError('OPERATOR_PAGE', 'The offset exceeds the complete selected source catalogue.');
  return { total: rows.length, offset, limit, items: rows.slice(offset, offset + limit),
    nextOffset: offset + limit < rows.length ? offset + limit : null };
};
function id(value, label) {
  if (!ID.test(value ?? '')) labError('OPERATOR_ID', 'Choose one stable original ' + label + '.');
  return value;
}
function hash(value, label) {
  if (!SHA.test(value ?? '')) labError('OPERATOR_HASH', 'Use the exact original ' + label + ' SHA256.');
  return value;
}
async function maybe(path) {
  try { return await readPrivateJson(path, 2 * 1024 * 1024); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function immutable(path, value) {
  const bytes = jsonBytes(value);
  try { await writeBytes(path, bytes, { exclusive: true }); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    if (!same(await readPrivateJson(path, 2 * 1024 * 1024), value))
      labError('OPERATOR_RECORD_EXISTS', 'This stable identifier already retains another original review or operation.');
  }
}
const formats = { current: 'decisionFormat', baseline: 'baselineDecisionFormat', correspondence: 'reconciliationFormat' };
const slots = { current: 'decisions', baseline: 'baseline_decisions', correspondence: 'reconciliation' };
const selectedInputs = ['source', 'baseline', 'decisions', 'baseline_decisions', 'reconciliation'];

/** The caller owns workspace and files; close this desk before closing either original owner. */
export async function openLaboratoryOperator({ workspace, files, alias = 'laboratory', processes } = {}) {
  if (!workspace?.intake?.inputFiles?.withSelected || !files?.retain || !files?.readInput)
    labError('OPERATOR_OWNER', 'Use the original Job Workspace and maintained retained-file owner.');
  const root = join(workspace.directory, 'artifacts', 'laboratory-reviews');
  await privateDirectory(root);
  for (const child of ['reviews', 'applies', 'results']) await privateDirectory(join(root, child));
  let cached = null, lastPreview = null, lastResult = null, closing = false, closePromise;
  const pending = new Set();
  const active = () => { if (closing) labError('OPERATOR_CLOSED', 'The laboratory review owner is closing.'); };
  const retain = (kind, name, bytes, source, contentType = 'application/json') =>
    files.retain({ workspace: alias, source: { kind, ...source }, name, contentType,
      bytes: Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes) });
  const jsonFile = (kind, name, value, source) => retain(kind, name, jsonBytes(value), source);
  async function source(requestId, { expectedRevision, signal, readDecisionFiles = true,
    processes: operationProcesses = processes } = {}) {
    active(); hash(requestId, 'request');
    const request = await workspace.intake.get(requestId);
    if (expectedRevision !== undefined && request.revision !== expectedRevision)
      labError('OPERATOR_REQUEST_CHANGED', 'The original customer request revision changed.');
    const parameters = laboratoryParameters(request.input);
    const manifest = request.input.$files ?? {};
    if (!manifest.source) labError('SOURCE_REQUIRED', 'Select and seal the complete original source file first.');
    const chosen = (readDecisionFiles ? selectedInputs : ['source', 'baseline']).filter(slot => manifest[slot]);
    return workspace.intake.inputFiles.withSelected(requestId,
      { slots: chosen, expectedRevision: request.revision, signal }, async selected => {
        const key = sha256(canonicalJson({ requestId, parameters, merchant: selected.merchant,
          source: manifest.source, baseline: manifest.baseline ?? null }));
        const read = async (slot, maximum) => {
          const item = selected.files[slot];
          if (!item || item.descriptor.bytes > maximum) labError('OPERATOR_SOURCE_SIZE', 'The selected native input exceeds its original slot limit.');
          selected.signal.throwIfAborted();
          const bytes = await item.file.readFile();
          if (bytes.length !== item.descriptor.bytes || sha256(bytes) !== item.descriptor.sha256)
            labError('OPERATOR_SOURCE_CHANGED', 'The complete selected original input changed.');
          return bytes;
        };
        let selectedCache = cached?.key === key ? cached : null;
        if (!selectedCache) {
          const current = await inspectDelivery(sourceMembers(await read('source', 16777216), manifest.source,
            { signal: selected.signal }), labProfile(parameters.profile),
            { encoding: parameters.encoding ?? 'utf-8', signal: selected.signal, processes: operationProcesses });
          if (parameters.expectedSourceSha256 && parameters.expectedSourceSha256 !== current.source.sourceSha256)
            labError('SOURCE_CHANGED', 'The selected original source differs from its requested scientific identity.');
          let baseline = null;
          if (manifest.baseline) {
            baseline = await inspectDelivery(sourceMembers(await read('baseline', 16777216), manifest.baseline,
              { signal: selected.signal }), labProfile(parameters.baselineProfile ?? parameters.profile),
              { encoding: parameters.baselineEncoding ?? parameters.encoding ?? 'utf-8', signal: selected.signal, processes: operationProcesses });
            if (parameters.expectedBaselineSha256 && parameters.expectedBaselineSha256 !== baseline.source.sourceSha256)
              labError('SOURCE_CHANGED', 'The selected original baseline differs from its requested scientific identity.');
          } else if (parameters.baselineProfile || parameters.expectedBaselineSha256 ||
              manifest.baseline_decisions || manifest.reconciliation)
            labError('BASELINE_REQUIRED', 'The declared baseline choices require their complete original baseline file.');
          const cross = baseline && baseline.source.profile.id !== current.source.profile.id;
          if (!cross && (manifest.baseline_decisions || manifest.reconciliation))
            labError('CROSS_PROFILE_REQUIRED', 'Separate baseline and correspondence decisions require an explicit different-profile pair.');
          const comparison = cross ? reconcileDeliveries(current, baseline) : null;
          selectedCache = { key, current, baseline, comparison, binding: laboratoryBinding(selected, current, baseline) };
          cached = selectedCache;
          lastPreview = null;
        }
        const documents = {};
        if (readDecisionFiles && manifest.decisions) documents.current = readLabDecisions(selectedCache.current,
          await read('decisions', 4194304), manifest.decisions, parameters.decisionFormat);
        if (readDecisionFiles && manifest.baseline_decisions) documents.baseline = readLabDecisions(selectedCache.baseline,
          await read('baseline_decisions', 4194304), manifest.baseline_decisions, parameters.baselineDecisionFormat);
        if (readDecisionFiles && manifest.reconciliation) documents.correspondence = readReconciliationDecisions(selectedCache.comparison,
          await read('reconciliation', 16777216), manifest.reconciliation, { format: parameters.reconciliationFormat });
        return { ...selectedCache, request, documents };
      });
  }
  async function documentReferences(current, { documents = {}, documentRefs = {} } = {}) {
    if (!documents || typeof documents !== 'object' || Array.isArray(documents) ||
        !documentRefs || typeof documentRefs !== 'object' || Array.isArray(documentRefs))
      labError('OPERATOR_DOCUMENTS', 'Supply named complete review documents or retained references.');
    const out = { ...current.documents };
    for (const family of ['current', 'baseline', 'correspondence']) {
      if (documents[family] !== undefined && documentRefs[family] !== undefined)
        labError('OPERATOR_DOCUMENTS', 'Use one complete inline document or retained file for each review family.');
      if (documents[family] !== undefined) out[family] = documents[family];
      if (documentRefs[family] !== undefined) {
        if (family === 'baseline' && !current.baseline || family === 'correspondence' && !current.comparison)
          labError('CROSS_PROFILE_REQUIRED', 'The selected source pair does not contain this review family.');
        const ref = documentRefs[family], metadata = await files.inputDescription(ref);
        const bytes = await files.readInput(ref, family === 'correspondence' ? 16777216 : 134217728);
        out[family] = family === 'correspondence' ? readReconciliationDecisions(current.comparison, bytes,
          { filename: metadata.name, contentType: metadata.contentType }) :
          readLabDecisions(current[family], bytes, { filename: metadata.name, contentType: metadata.contentType });
      }
    }
    if ([...Object.keys(documents), ...Object.keys(documentRefs)].some(key => !['current', 'baseline', 'correspondence'].includes(key)))
      labError('OPERATOR_DOCUMENTS', 'Select only the three original review families.');
    return out;
  }
  async function preview(requestId, options = {}) {
    const current = await source(requestId, options);
    if (options.expectedBindingSha256 && options.expectedBindingSha256 !== current.binding.bindingSha256)
      labError('OPERATOR_SOURCE_CHANGED', 'The original source selection changed.');
    const documents = await documentReferences(current, options);
    const key = sha256(canonicalJson({ binding: current.binding.bindingSha256, documents }));
    let selectedPreview = lastPreview?.key === key ? { ...lastPreview, source: current } : null;
    if (!selectedPreview) {
      const value = previewLaboratoryReview(current, documents);
      const file = await jsonFile('laboratory-preview', 'laboratory-preview.json', value,
        { bindingSha256: value.binding.bindingSha256, previewSha256: value.previewSha256 });
      selectedPreview = { key, source: current, value, file };
      lastPreview = selectedPreview;
    }
    return selectedPreview;
  }
  async function saved(reviewId) {
    active(); id(reviewId, 'saved review identifier');
    const record = await maybe(join(root, 'reviews', reviewId + '.json'));
    if (!record) labError('OPERATOR_REVIEW_NOT_FOUND', 'Choose a saved original laboratory review.');
    const { createdAt, reviewSha256, ...identity } = record;
    if (record.schema !== LAB_OPERATOR_REVIEW_SCHEMA || record.reviewId !== reviewId ||
        sha256(canonicalJson(identity)) !== reviewSha256)
      labError('OPERATOR_REVIEW_CHANGED', 'The saved laboratory review identity changed.');
    return record;
  }
  async function save(requestId, options = {}) {
    id(options.reviewId, 'new immutable review identifier'); hash(options.expectedPreviewSha256, 'preview');
    const prepared = await preview(requestId, options), { value, source: original } = prepared;
    if (value.previewSha256 !== options.expectedPreviewSha256)
      labError('OPERATOR_PREVIEW_CHANGED', 'The original native preview differs from the reviewed choice set.');
    const prior = await maybe(join(root, 'reviews', options.reviewId + '.json'));
    if (prior) {
      const record = await saved(options.reviewId);
      if (record.requestId !== requestId || record.previewSha256 !== value.previewSha256)
        labError('OPERATOR_REVIEW_EXISTS', 'Choose a new review identifier for changed sources or decisions.');
      return { ...record, reused: true };
    }
    const selected = { bindingSha256: value.binding.bindingSha256, previewSha256: value.previewSha256 };
    const retained = { preview: descriptor(prepared.file) }, jobInputs = {};
    for (const family of Object.keys(value.documents)) {
      const doc = value.documents[family], stem = family === 'current' ? 'decisions' :
        family === 'baseline' ? 'baseline-decisions' : 'correspondence';
      retained[family + 'Document'] = descriptor(await jsonFile('laboratory-document', stem + '.json', doc,
        { ...selected, family, documentSha256: sha256(canonicalJson(doc)) }));
      for (const format of ['csv', 'tsv']) {
        const table = family === 'correspondence' ? reconciliationTable(value.comparison, doc, { format }) :
          reviewTable(original[family], doc, { format, scope: 'all' });
        retained[family + '-' + format] = descriptor(await retain('laboratory-editable-table', stem + '.' + format,
          table.text, { ...selected, family, format }, table.mime));
      }
      const format = original.binding.parameters[formats[family]] ?? 'json';
      const native = format === 'json' ? { text: laboratoryJson(doc), mime: 'application/json' } :
        family === 'correspondence' ? reconciliationTable(value.comparison, doc, { format }) :
          reviewTable(original[family], doc, { format, scope: 'issues' });
      const bytes = Buffer.from(native.text), slot = slots[family], maximum = family === 'correspondence' ? 16777216 : 4194304;
      if (bytes.length > maximum) labError('OPERATOR_DECISION_SIZE', 'The complete normalized decision file exceeds its actual native slot allowance.');
      const metadata = { filename: stem + '.' + format, contentType: native.mime.split(';')[0] };
      const roundtrip = family === 'correspondence' ? readReconciliationDecisions(value.comparison, bytes, metadata, { format }) :
        readLabDecisions(original[family], bytes, metadata, format);
      if (!same(doc, roundtrip)) labError('OPERATOR_DECISION_ROUNDTRIP', 'The selected native representation does not retain the full reviewed choice set.');
      jobInputs[slot] = descriptor(await retain('laboratory-native-decision-input', metadata.filename, bytes,
        { ...selected, slot, format, documentSha256: sha256(canonicalJson(doc)) }, metadata.contentType));
    }
    const currentReport = renderLabReport(original.current, value.current, {
      links: { 'Saved field decisions': 'decisions.json' },
      ...(value.comparison ? { comparison: { schema: value.comparison.schema, counts: value.comparison.counts,
        comparisonSha256: value.comparison.comparisonSha256 ?? null, byKind: value.comparison.byKind ?? null } } : {}),
    });
    retained.currentReport = descriptor(await retain('laboratory-editor', 'report.html', currentReport, selected, 'text/html; charset=utf-8'));
    if (value.correspondence) {
      retained.baselineReport = descriptor(await retain('laboratory-editor', 'baseline-report.html',
        renderLabReport(original.baseline, value.baseline, { links: { 'Saved baseline decisions': 'baseline-decisions.json' } }),
        { ...selected, side: 'baseline' }, 'text/html; charset=utf-8'));
      retained.correspondenceReport = descriptor(await retain('laboratory-correspondence-editor', 'correspondence.html',
        renderReconciliationReport(value.comparison, value.correspondence, {
          links: { currentReport: 'report.html', baselineReport: 'baseline-report.html',
            savedCorrespondenceJSON: 'correspondence.json' }, currentReview: value.current, baselineReview: value.baseline }),
        selected, 'text/html; charset=utf-8'));
      const fields = reconciliationFieldTable(value.comparison);
      retained.comparisonFields = descriptor(await retain('laboratory-complete-field-comparison', 'comparison-fields.csv',
        fields.text, selected, fields.mime));
    }
    const identity = { schema: LAB_OPERATOR_REVIEW_SCHEMA, reviewId: options.reviewId, requestId,
      binding: value.binding, previewSha256: value.previewSha256, nativeIdentity: value.identity,
      summary: value.summary, files: retained, jobInputs };
    const record = { ...identity, reviewSha256: sha256(canonicalJson(identity)), createdAt: new Date().toISOString() };
    await immutable(join(root, 'reviews', options.reviewId + '.json'), record);
    return record;
  }
  async function apply(requestId, options = {}) {
    active(); id(options.applyId, 'decision application identifier'); hash(options.expectedReviewSha256, 'saved review');
    const review = await saved(options.reviewId);
    if (review.requestId !== requestId || review.reviewSha256 !== options.expectedReviewSha256)
      labError('OPERATOR_REVIEW_CHANGED', 'Use this request’s exact saved review and hash.');
    const path = join(root, 'applies', options.applyId + '.json');
    let intent = await maybe(path);
    const expected = { applyId: options.applyId, requestId, reviewId: options.reviewId,
      expectedReviewSha256: options.expectedReviewSha256, expectedRevision: options.expectedRevision };
    const original = await source(requestId, { signal: options.signal, processes: options.processes,
      readDecisionFiles: false });
    assertLaboratoryBinding(original.binding, review.binding);
    const policy = original.request.function.inputFiles, currentFiles = original.request.input.$files;
    const desired = {};
    for (const [slot, file] of Object.entries(review.jobInputs)) {
      const retained = await files.file(file.fileId);
      if (!same(descriptor(retained), file)) labError('OPERATOR_REVIEW_CHANGED', 'The retained native decision file changed.');
      desired[slot] = { schema: 'stellar-forge.job-input-file.v1', filename: file.name,
        contentType: file.contentType.split(';')[0], bytes: file.bytes, sha256: file.sha256, policySha256: policy.policySha256 };
    }
    if (intent) {
      if (!same(intent.request, expected) || !same(intent.desired, desired))
        labError('OPERATOR_APPLICATION_EXISTS', 'This original application identifier belongs to another review or request revision.');
    } else {
      if (original.request.revision !== options.expectedRevision)
        labError('OPERATOR_REQUEST_CHANGED', 'Refresh the original request revision before applying this saved review.');
      intent = { schema: 'starforge.lab-edd-review-application.v1', request: expected,
        binding: review.binding, before: currentFiles, desired, createdAt: new Date().toISOString() };
      await immutable(path, intent);
    }
    const assertCurrent = row => {
      if (!same(laboratoryParameters(row.input), review.binding.parameters))
        labError('OPERATOR_SOURCE_CHANGED', 'The original application parameters changed.');
      for (const slot of selectedInputs) {
        const value = row.input.$files[slot] ?? null, before = intent.before[slot] ?? null, after = desired[slot] ?? before;
        if (!same(value, before) && !same(value, after))
          labError('OPERATOR_SELECTION_CHANGED', 'A concurrent selection replaced an original or reviewed decision file.', { slot });
      }
    };
    for (const [slot, target] of Object.entries(desired)) {
      options.signal?.throwIfAborted();
      const row = await workspace.intake.get(requestId); assertCurrent(row);
      const staged = row.inputFiles?.slots?.find(value => value.slot === slot);
      if (same(row.input.$files[slot] ?? null, target) && same(staged?.file, target) && staged?.upload?.state === 'SEALED') continue;
      const input = await files.inputDescription('file:' + review.jobInputs[slot].fileId);
      await workspace.intake.inputFiles.local(requestId, { path: input.path, slot, filename: input.name,
        contentType: input.contentType.split(';')[0], expectedRevision: row.revision, signal: options.signal });
    }
    const row = await workspace.intake.get(requestId); assertCurrent(row);
    for (const [slot, target] of Object.entries(desired))
      if (!same(row.input.$files[slot] ?? null, target) ||
          row.inputFiles?.slots?.find(value => value.slot === slot)?.upload?.state !== 'SEALED')
        labError('OPERATOR_APPLICATION_INCOMPLETE', 'The original decision upload has not sealed its complete saved target.');
    const completedPath = join(root, 'applies', options.applyId + '.complete.json');
    let complete = await maybe(completedPath);
    if (!complete) {
      complete = { schema: intent.schema, status: 'COMPLETE', ...expected,
        bindingSha256: review.binding.bindingSha256, originalRevision: intent.request.expectedRevision,
        stagedRevision: row.revision, inputSha256: row.inputSha256, requestSha256: row.requestSha256,
        files: row.input.$files, completedAt: new Date().toISOString() };
      await immutable(completedPath, complete);
    }
    return { ...complete, currentRevision: row.revision, phase: row.phase };
  }
  function verifiedResult(bytes, signal) {
    signal?.throwIfAborted();
    const digest = sha256(bytes);
    // The original retained file is read and hashed every time. Reuse only the
    // exact same fully verified native graph while downloading its many members.
    let selected = lastResult;
    if (selected?.sha256 !== digest) {
      selected = { sha256: digest, value: readLabResult(bytes, { signal }) };
      lastResult = selected;
    }
    signal?.throwIfAborted();
    return selected.value;
  }
  async function completeResult({ inputRef, resourceId, expectedSha256, signal } = {}) {
    active(); if ((inputRef === undefined) === (resourceId === undefined))
      labError('OPERATOR_RESULT', 'Choose one complete retained result file or original customer library resource.');
    let bytes, original, origin;
    if (inputRef !== undefined) {
      original = await files.inputDescription(inputRef); bytes = await files.readInput(inputRef, 67108864);
      origin = { kind: 'retained-file', inputRef, bytes: original.bytes, sha256: original.sha256 };
    } else {
      const record = workspace.library.resource(resourceId);
      if (record.bytes > 67108864) labError('OPERATOR_RESULT_SIZE', 'The original result exceeds its native 64 MiB output allowance.');
      const held = await workspace.library.download(resourceId, { signal });
      try { bytes = await held.file.readFile(); } finally { await held.dispose(); }
      if (bytes.length !== record.bytes || sha256(bytes) !== record.sha256)
        labError('OPERATOR_RESULT_CHANGED', 'The original customer result changed during its verified read.');
      original = { name: record.filename ?? 'laboratory-edd-receiving.zip', bytes: record.bytes, sha256: record.sha256 };
      origin = { kind: 'customer-resource-library', resourceId, source: record.source ?? null, bytes: record.bytes, sha256: record.sha256 };
    }
    if (expectedSha256 && expectedSha256 !== original.sha256)
      labError('OPERATOR_RESULT_CHANGED', 'The complete result differs from the selected original SHA256.');
    signal?.throwIfAborted();
    const result = verifiedResult(bytes, signal);
    const prior = await maybe(join(root, 'results', original.sha256 + '.json'));
    if (prior) {
      if (prior.resultId !== original.sha256 || prior.file?.sha256 !== original.sha256 ||
          !same(prior.manifest, result.manifest))
        labError('OPERATOR_RESULT_CHANGED', 'The retained complete result binding changed.');
      return { ...prior, reused: true };
    }
    const file = await retain('laboratory-complete-result', 'laboratory-edd-receiving.zip', bytes,
      { resultSha256: original.sha256, origin }, 'application/zip');
    const resultId = file.sha256, members = [];
    for (const member of result.members) members.push({ path: member.filename, bytes: member.bytes.length, sha256: member.sha256 });
    const value = { schema: 'starforge.lab-edd-operator-result.v1', status: 'COMPLETE', resultId,
      file: descriptor(file), origin, manifest: result.manifest, members };
    const receipt = await jsonFile('laboratory-result-receiving', 'laboratory-result.json', value,
      { resultSha256: resultId, sourceSha256: result.manifest.sourceSha256 ?? result.manifest.source?.sourceSha256 });
    const savedValue = { ...value, receipt: descriptor(receipt) };
    await immutable(join(root, 'results', resultId + '.json'), savedValue);
    return savedValue;
  }
  async function result(resultId, { member, offset, limit, signal } = {}) {
    active(); hash(resultId, 'result');
    const record = await maybe(join(root, 'results', resultId + '.json'));
    if (!record || record.resultId !== resultId || record.file.sha256 !== resultId)
      labError('OPERATOR_RESULT_NOT_FOUND', 'Reopen this complete original result before selecting its members.');
    if (!member) return { ...record, members: page(record.members, { offset, limit }) };
    if (typeof member !== 'string' || !record.members.some(value => value.path === member))
      labError('OPERATOR_RESULT_MEMBER', 'Select an exact member of this verified complete native result.');
    const full = verifiedResult(await files.readInput('file:' + record.file.fileId, 67108864), signal);
    const native = full.members.find(value => value.filename === member);
    const expected = record.members.find(value => value.path === member);
    if (!native || native.sha256 !== expected.sha256 || native.bytes.length !== expected.bytes)
      labError('OPERATOR_RESULT_CHANGED', 'The original native result member changed.');
    const file = await retain('laboratory-result-member', member.split('/').at(-1), native.bytes,
      { resultId, member, originalBytes: expected.bytes, originalSha256: expected.sha256 },
      /\.json$/i.test(member) ? 'application/json' : /\.html$/i.test(member) ? 'text/html; charset=utf-8' :
        /\.csv$/i.test(member) ? 'text/csv; charset=utf-8' : /\.tsv$/i.test(member) ? 'text/tab-separated-values; charset=utf-8' :
          /\.zip$/i.test(member) ? 'application/zip' : 'application/octet-stream');
    return { resultId, member, file: descriptor(file) };
  }
  const api = {
    directory: root,
    profiles() { active(); return labProfiles.map(({ id, version, label, references }) => ({ id, version, label, references })); },
    async inspect(requestId, options = {}) {
      const selected = await source(requestId, options), value = laboratorySourceView(selected);
      const file = await jsonFile('laboratory-original-source-review', 'laboratory-source.json', value,
        { bindingSha256: selected.binding.bindingSha256 });
      return { binding: selected.binding, revision: selected.request.revision, file: descriptor(file),
        current: { summary: selected.current.report.summary, counts: selected.current.report.counts,
          tables: selected.current.tables.map(table => ({ section: table.id, filename: table.filename,
            headers: table.headers, keys: table.keys, rows: table.rows.length, origin: table.origin })) },
        baseline: selected.baseline ? { summary: selected.baseline.report.summary, counts: selected.baseline.report.counts,
          tables: selected.baseline.tables.map(table => ({ section: table.id, filename: table.filename,
            headers: table.headers, keys: table.keys, rows: table.rows.length, origin: table.origin })) } : null };
    },
    async rows(requestId, options = {}) {
      const selected = await source(requestId, options);
      if (options.expectedBindingSha256 && options.expectedBindingSha256 !== selected.binding.bindingSha256)
        labError('OPERATOR_SOURCE_CHANGED', 'The original source selection changed.');
      return { bindingSha256: selected.binding.bindingSha256, ...page(laboratoryRows(selected, options), options) };
    },
    async issues(requestId, options = {}) {
      const selected = await source(requestId, options);
      if (options.expectedBindingSha256 && options.expectedBindingSha256 !== selected.binding.bindingSha256)
        labError('OPERATOR_SOURCE_CHANGED', 'The original source selection changed.');
      return { bindingSha256: selected.binding.bindingSha256, ...page(laboratoryIssues(selected, options), options) };
    },
    async groups(requestId, options = {}) {
      const selected = await source(requestId, options);
      if (options.expectedBindingSha256 && options.expectedBindingSha256 !== selected.binding.bindingSha256)
        labError('OPERATOR_SOURCE_CHANGED', 'The original source selection changed.');
      const comparison = selected.comparison;
      return { bindingSha256: selected.binding.bindingSha256, comparisonSha256: comparison?.comparisonSha256,
        counts: comparison?.counts, ...page(laboratoryGroups(comparison, options), options) };
    },
    async preview(requestId, options = {}) {
      const prepared = await preview(requestId, options);
      return { previewSha256: prepared.value.previewSha256, binding: prepared.value.binding,
        identity: prepared.value.identity, summary: prepared.value.summary, file: descriptor(prepared.file),
        revision: prepared.source.request.revision };
    },
    save, saved, apply,
    async reviews(options = {}) {
      active(); const names = (await readdir(join(root, 'reviews'))).filter(value => /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}\.json$/.test(value)).sort();
      const records = [];
      for (const name of names) {
        const record = await saved(name.slice(0, -5));
        if (options.requestId && record.requestId !== options.requestId) continue;
        records.push({ reviewId: record.reviewId, requestId: record.requestId, previewSha256: record.previewSha256,
          reviewSha256: record.reviewSha256, bindingSha256: record.binding.bindingSha256, createdAt: record.createdAt, summary: record.summary });
      }
      return page(records, options);
    },
    async table(requestId, options = {}) {
      const prepared = await preview(requestId, options), { value, source: selected } = prepared;
      const family = options.family ?? 'current', format = options.format ?? 'csv';
      if (!Object.hasOwn(value.documents, family)) labError('OPERATOR_DOCUMENTS', 'Select a review family present in this source pair.');
      const table = family === 'correspondence' ? reconciliationTable(value.comparison, value.documents[family], { format }) :
        reviewTable(selected[family], value.documents[family], { format, scope: options.scope ?? 'all', fields: options.fields });
      const file = await retain('laboratory-editable-table', family + '-decisions.' + format, table.text,
        { bindingSha256: value.binding.bindingSha256, previewSha256: value.previewSha256,
          family, format, scope: options.scope ?? 'all', fields: options.fields ?? null }, table.mime);
      return { family, rows: table.rows, bindingSha256: value.binding.bindingSha256,
        documentSha256: sha256(canonicalJson(value.documents[family])), file: descriptor(file) };
    },
    async importTable(requestId, options = {}) {
      const selected = await source(requestId, options), family = options.family ?? 'current';
      if (!['current', 'baseline', 'correspondence'].includes(family))
        labError('OPERATOR_DOCUMENTS', 'Choose a current, baseline or correspondence table.');
      const out = await documentReferences(selected, { documentRefs: { [family]: options.inputRef } });
      const next = previewLaboratoryReview(selected, out), document = next.documents[family];
      if (!document) labError('OPERATOR_DOCUMENTS', 'This native source pair has no selected review family.');
      const file = await jsonFile('laboratory-document', family + '-decisions.json', document,
        { bindingSha256: selected.binding.bindingSha256, family, documentSha256: sha256(canonicalJson(document)) });
      return { family, bindingSha256: selected.binding.bindingSha256, documentSha256: sha256(canonicalJson(document)),
        documentRef: 'file:' + file.fileId, file: descriptor(file) };
    },
    completeResult, result,
    close() {
      if (closePromise) return closePromise;
      closing = true;
      closePromise = (async () => {
        await Promise.allSettled([...pending]);
        cached = null; lastPreview = null; lastResult = null;
      })();
      return closePromise;
    },
  };
  for (const [name, action] of Object.entries(api)) {
    if (typeof action !== 'function' || ['profiles', 'close'].includes(name)) continue;
    api[name] = (...args) => {
      active();
      const work = Promise.resolve().then(() => action(...args));
      pending.add(work);
      work.finally(() => pending.delete(work)).catch(() => {});
      return work;
    };
  }
  return Object.freeze(api);
}
