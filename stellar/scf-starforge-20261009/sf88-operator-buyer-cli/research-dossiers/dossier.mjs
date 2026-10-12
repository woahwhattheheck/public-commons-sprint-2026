// MIT — Research project state beside the original SF88 buyer.
import { readdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  privateDirectory, writeJson, readJson, writeBytes, readBytes, digest, jsonBytes,
  need, object, BuyerError, safeCode,
} from '../node/store.mjs';
import { normalizeResponse, normalizeProjection, sourceView, compareViews } from './normalize.mjs';
import { markdownReport, htmlReport } from './report.mjs';
import { portableEntries, encodePortable } from './portable.mjs';
import {inspectSourceBundle} from './source-bundles.mjs';
import {CITATION_REVIEW_SCHEMA,citationDigest,citationUpdateModel,citationUpdatePage,citationReviewInput,
  recordCitationReview,validateCitationReviewState,validateCitationReviewTransition} from './citation-updates.mjs';
import {eligibilityDigest,eligibilityInput,eligibilityModel,eligibilityPage,eligibilityReport,eligibilityExport,
  recordEligibilityOperation,validateEligibilityState,validateEligibilityTransition} from './eligibility-review.mjs';
import {extractionDigest,extractionInput,studyExtractionModel,extractionPublicationContext,extractionPage,extractionReport,
  extractionSourcePointers,recordStudyExtractionOperation,validateStudyExtractionState,validateStudyExtractionTransition} from './study-extraction.mjs';
import {extractionMarkdown,extractionHtml} from './study-extraction-report.mjs';
import {riskOfBiasDigest,riskOfBiasInput,riskOfBiasModel,riskOfBiasPage,riskOfBiasReport,riskOfBiasExport,
  recordRiskOfBiasOperation,validateRiskOfBiasState,validateRiskOfBiasTransition} from './risk-of-bias/index.mjs';
import {riskOfBiasRegistry} from './risk-of-bias/registry.mjs';
import {publicationDigest,publicationInput,extractionPublicationModel,extractionPublicationPage,extractionPublicationReport,
  extractionPublicationExport,recordExtractionPublication,validateExtractionPublicationState,validateExtractionPublicationTransition} from './extraction-publication.mjs';

const DOCUMENT = 'sf88-research-dossier-v1';
const PORTABLE = 'sf88-research-dossier-portable-v1';
const MAX_RESPONSE = 64 * 1024 * 1024;
const MAX_STATE = 8 * 1024 * 1024;
const MAX_PORTABLE = 256 * 1024 * 1024;
const clone = value => structuredClone(value);
const timestamp = () => new Date().toISOString();
const newId = prefix => prefix + '_' + randomUUID();
const filename = revision => String(revision).padStart(8, '0') + '.json';
const validId = id => typeof id === 'string' && /^d_[a-f0-9-]{36}$/.test(id);
const text = (value, name, max, empty = false) => {
  need(typeof value === 'string' && value.length <= max && (empty || value.trim().length > 0), name);
  return value;
};
const summary = state => ({
  id: state.id, title: state.title, description: state.description, revision: state.revision,
  createdAt: state.createdAt, updatedAt: state.updatedAt,
  questionCount: state.questions.length, editionCount: state.editions.length,
  selectedCount: state.selections.filter(selection => selection.selected).length,
  findingCount: state.findings.length, citationReviewCount:(state.citationReviews??[]).length,
  eligibilityReviewCount:(state.eligibilityEvents??[]).filter(value=>value.action==='create-review').length,
  riskOfBiasReviewCount:(state.riskOfBiasEvents??[]).filter(value=>value.action==='create-review').length,
  extractionFormCount:(state.extractionEvents??[]).filter(value=>value.action==='create-form').length,
  extractionPublicationCount:(state.extractionPublicationEvents??[]).filter(value=>value.action==='publish-table').length,
});
const referenceKeys = new Set(['id', 'editionId', 'queryId', 'workspaceId', 'operationId']);
function referenceValue(reference) {
  need(object(reference) && Object.keys(reference).length > 0 &&
    (typeof reference.editionId === 'string' || typeof reference.id === 'string'), 'EDITION_REFERENCE_REQUIRED');
  need(Object.entries(reference).every(([key, value]) => referenceKeys.has(key) &&
    typeof value === 'string' && value.length > 0 && value.length <= 512), 'EDITION_REFERENCE_INVALID');
  return clone(reference);
}

export async function openDossierStore(directory, { providers = {}, extractionOptions = {} } = {}) {
  directory = await privateDirectory(directory);
  const projects = await privateDirectory(join(directory, 'dossiers'));
  const blobs = await privateDirectory(join(directory, 'blobs'));
  need(object(providers), 'EDITION_PROVIDERS_INVALID');
  const dossierDirectory = id => {
    need(validId(id), 'DOSSIER_ID_INVALID');
    return join(projects, id);
  };
  async function revisionsDirectory(id, create = false) {
    const parent = await privateDirectory(dossierDirectory(id), { create });
    return privateDirectory(join(parent, 'revisions'), { create });
  }
  async function numbers(id) {
    let entries;
    try { entries = await readdir(await revisionsDirectory(id), { withFileTypes: true }); }
    catch (error) { if (error.code === 'ENOENT') throw new BuyerError('DOSSIER_NOT_FOUND'); throw error; }
    const values = entries.filter(entry => entry.isFile() && /^[0-9]{8}\.json$/.test(entry.name))
      .map(entry => Number(entry.name.slice(0, 8))).sort((a, b) => a - b);
    need(values.every((value, index) => value === index + 1), 'DOSSIER_HISTORY_INCOMPLETE');
    return values;
  }
  function validateEnvelope(envelope, id, revision) {
    need(object(envelope) && object(envelope.state) && typeof envelope.sha256 === 'string', 'DOSSIER_REVISION_INVALID');
    const state = envelope.state;
    need(state.schema === DOCUMENT && state.id === id && state.revision === revision &&
      digest(jsonBytes(state)) === envelope.sha256, 'DOSSIER_REVISION_CHANGED');
    need(Array.isArray(state.questions) && Array.isArray(state.editions) &&
      Array.isArray(state.selections) && Array.isArray(state.findings), 'DOSSIER_STATE_INVALID');
    return envelope;
  }
  async function readRevision(id, revision) {
    need(Number.isSafeInteger(revision) && revision > 0 && revision < 100000000, 'REVISION_INVALID');
    const envelope = await readJson(join(await revisionsDirectory(id), filename(revision)), MAX_STATE);
    return validateEnvelope(envelope, id, revision);
  }
  async function head(id, revision) {
    const all = await numbers(id);
    need(all.length > 0, 'DOSSIER_NOT_FOUND');
    const selected = revision ?? all.at(-1);
    need(all.includes(selected), 'REVISION_NOT_FOUND');
    return readRevision(id, selected);
  }
  async function history(id) {
    const all = await numbers(id);
    const values = [];
    let previous = null;
    for (const revision of all) {
      const envelope = await readRevision(id, revision);
      need(envelope.state.previous === previous, 'DOSSIER_HISTORY_CHANGED');
      values.push(envelope); previous = envelope.sha256;
    }
    return values;
  }
  async function putBlob(bytes) {
    need(Buffer.isBuffer(bytes) && bytes.length <= MAX_RESPONSE, 'RESEARCH_RESPONSE_TOO_LARGE');
    const sha256 = digest(bytes), path = join(blobs, sha256);
    try { await writeBytes(path, bytes, { exclusive: true }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      need(digest(await readBytes(path, MAX_RESPONSE)) === sha256, 'RESEARCH_BLOB_CHANGED');
    }
    return { sha256, bytes: bytes.length };
  }
  async function blob(metadata) {
    need(object(metadata) && /^[a-f0-9]{64}$/.test(metadata.sha256) &&
      Number.isSafeInteger(metadata.bytes) && metadata.bytes >= 0 && metadata.bytes <= MAX_RESPONSE, 'RESEARCH_BLOB_INVALID');
    const bytes = await readBytes(join(blobs, metadata.sha256), MAX_RESPONSE);
    need(bytes.length === metadata.bytes && digest(bytes) === metadata.sha256, 'RESEARCH_BLOB_CHANGED');
    return bytes;
  }
  /** Open an edition from the selected saved revision through the original verified blob reader. */
  async function readRetainedEdition(id, editionId, {revision} = {}) {
    const {state} = await head(id, revision);
    const edition = state.editions.find(value => value.id === editionId);
    need(edition?.mode === 'retained', 'RETAINED_EDITION_REQUIRED');
    return {edition: clone(edition), revision: state.revision, bytes: await blob(edition.raw)};
  }
  const metadata = state => ({ ...summary(state), schema: DOCUMENT,
    questions: clone(state.questions), editions: clone(state.editions),
    selections: clone(state.selections), findings: clone(state.findings) });
  async function commit(id, expectedRevision, label, update, { projection = 'full' } = {}) {
    need(['full', 'metadata'].includes(projection), 'RESEARCH_PROJECTION_INVALID');
    const current = await head(id);
    need(Number.isSafeInteger(expectedRevision) && current.state.revision === expectedRevision, 'REVISION_CONFLICT');
    const next = clone(current.state);
    const changed = await update(next, current.state);
    if (changed === false) return projection === 'metadata' ? metadata(current.state) : get(id);
    next.revision += 1;
    need(next.revision < 100000000, 'REVISION_LIMIT');
    next.previous = current.sha256; next.updatedAt = timestamp(); next.change = label;
    const envelope = { sha256: digest(jsonBytes(next)), state: next };
    need(jsonBytes(envelope).length <= MAX_STATE, 'DOSSIER_STATE_TOO_LARGE');
    try { await writeJson(join(await revisionsDirectory(id), filename(next.revision)), envelope, { exclusive: true }); }
    catch (error) { if (error.code === 'EEXIST') throw new BuyerError('REVISION_CONFLICT'); throw error; }
    return projection === 'metadata' ? metadata(next) : get(id);
  }
  async function projections(state, { references = true, readContent = blob } = {}) {
    const views = new Map();
    for (const edition of state.editions) {
      if (edition.mode === 'retained') {
        const normalized = normalizeResponse(await readContent(edition.raw), edition.provider);
        views.set(edition.id, normalized);
      } else if (edition.mode === 'reference') {
        let projection = { status: references ? 'ADAPTER_UNAVAILABLE' : 'ORIGINAL_EDITION_REFERENCE', items: [] };
        const adapter = providers[edition.provider];
        if (references && adapter && typeof adapter.read === 'function') {
          try {
            projection = normalizeProjection(await adapter.read(clone(edition.reference)), edition.provider);
            if (projection.availableUntil && Date.parse(projection.availableUntil) <= Date.now()) {
              projection = { ...projection, status: 'EXPIRED', items: [] };
            }
          } catch (error) {
            projection = { status: 'UNAVAILABLE', items: [], error: safeCode(error.code, 'EDITION_READ_FAILED') };
          }
        }
        views.set(edition.id, projection);
      } else throw new BuyerError('EDITION_MODE_INVALID');
    }
    return views;
  }
  async function view(state, { references = true, includeHistory = true } = {}) {
    const projected = await projections(state, { references });
    const sources = sourceView(state.editions, projected, state.selections);
    const occurrenceSource = new Map(sources.flatMap(source => source.occurrenceIds.map(key => [key, source.id])));
    const editions = state.editions.map(edition => {
      const result = projected.get(edition.id);
      return { ...clone(edition), status: result.status, itemCount: result.items.length,
        capturedAt: edition.createdAt, usage: result.usage ?? {},
        warnings: result.warnings ?? [], error: result.error ?? null,
        availableUntil: result.availableUntil ?? null, sourceTerms: result.sourceTerms ?? null };
    });
    const questions = state.questions.map(question => ({
      ...clone(question),
      editionCount: editions.filter(edition => edition.questionId === question.id).length,
      sourceCount: sources.filter(source => source.citations.some(citation => citation.questionId === question.id)).length,
    }));
    const findings = state.findings.map(finding => ({
      ...clone(finding),
      sourceIds: [...new Set(finding.occurrenceIds.map(key => occurrenceSource.get(key)).filter(Boolean))],
      unavailableSources: finding.occurrenceIds.filter(key => !occurrenceSource.has(key)).length,
    }));
    const revisions = includeHistory ? (await history(state.id)).map(envelope => ({
      revision: envelope.state.revision, createdAt: envelope.state.updatedAt,
      label: envelope.state.change, sha256: envelope.sha256,
    })) : [];
    return {
      ...summary(state), schema: DOCUMENT, questions, editions, sources, findings, revisions,
      providerUsage: editions.map(edition => ({ editionId: edition.id, label: edition.label, provider: edition.provider,
        mode: edition.mode, status: edition.status, usage: edition.usage })),
      unavailableSelections: state.selections.filter(selection => !occurrenceSource.has(selection.occurrenceId)),
    };
  }
  async function get(id, { revision, references = true, includeHistory = true } = {}) {
    need(typeof references === 'boolean' && typeof includeHistory === 'boolean', 'RESEARCH_PROJECTION_INVALID');
    return view((await head(id, revision)).state, {references, includeHistory});
  }
  async function listRevisions(id, {revision} = {}) {
    const selected = (await head(id, revision)).state.revision;
    return (await history(id)).filter(envelope => envelope.state.revision <= selected).map(envelope => ({
      revision: envelope.state.revision, createdAt: envelope.state.updatedAt,
      label: envelope.state.change, sha256: envelope.sha256}));
  }
  // Return saved revision metadata without loading or projecting retained response bodies.
  async function getMetadata(id, { revision } = {}) { return metadata((await head(id, revision)).state); }
  async function list() {
    const entries = await readdir(projects, { withFileTypes: true });
    const values = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !validId(entry.name)) continue;
      try { values.push(summary((await head(entry.name)).state)); }
      catch (error) { if (error.code !== 'DOSSIER_NOT_FOUND') throw error; }
    }
    return values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async function create({ title, description = '', projection = 'full' } = {}) {
    need(['full', 'metadata'].includes(projection), 'RESEARCH_PROJECTION_INVALID');
    title = text(title, 'TITLE_REQUIRED', 240);
    description = text(description, 'DESCRIPTION_INVALID', 20000, true);
    const id = newId('d'), now = timestamp();
    const state = { schema: DOCUMENT, id, title, description, revision: 1,
      previous: null, createdAt: now, updatedAt: now, change: 'Created dossier',
      questions: [], editions: [], selections: [], findings: [], citationReviews: [], eligibilityEvents: [], extractionEvents: [], extractionPublicationEvents: [], riskOfBiasEvents: [] };
    await writeJson(join(await revisionsDirectory(id, true), filename(1)),
      { sha256: digest(jsonBytes(state)), state }, { exclusive: true });
    return projection === 'metadata' ? getMetadata(id) : get(id);
  }
  const update = (id, { title, description, expectedRevision, projection = 'full' }) => commit(id, expectedRevision, 'Updated dossier', state => {
    if (title !== undefined) state.title = text(title, 'TITLE_REQUIRED', 240);
    if (description !== undefined) state.description = text(description, 'DESCRIPTION_INVALID', 20000, true);
  }, {projection});
  const addQuestion = (id, { text: questionText, expectedRevision, projection = 'full' }) => commit(id, expectedRevision, 'Added research question', state => {
    state.questions.push({ id: newId('q'), text: text(questionText, 'QUESTION_REQUIRED', 4000),
      notes: '', status: 'open', createdAt: timestamp() });
  }, {projection});
  const updateQuestion = (id, questionId, { text: questionText, notes, status, expectedRevision, projection = 'full' }) =>
    commit(id, expectedRevision, 'Updated research question', state => {
      const question = state.questions.find(row => row.id === questionId);
      need(question, 'QUESTION_NOT_FOUND');
      if (questionText !== undefined) question.text = text(questionText, 'QUESTION_REQUIRED', 4000);
      if (notes !== undefined) question.notes = text(notes, 'QUESTION_NOTES_INVALID', 100000, true);
      if (status !== undefined) { need(['open', 'answered', 'parked'].includes(status), 'QUESTION_STATUS_INVALID'); question.status = status; }
    }, {projection});

  async function receive(id, { questionId, label, provider = 'research', rawText, response, sourceReference = '',
    expectedRevision, origin = null, rawBytes, projection = 'full' } = {}) {
    need(['full', 'metadata'].includes(projection), 'RESEARCH_PROJECTION_INVALID');
    label = text(label, 'EDITION_LABEL_REQUIRED', 240);
    provider = text(provider, 'EDITION_PROVIDER_REQUIRED', 80);
    need(origin === null || object(origin), 'RESEARCH_ORIGIN_INVALID');
    sourceReference = text(sourceReference, 'SOURCE_REFERENCE_INVALID', 4000, true);
    need([rawBytes !== undefined, rawText !== undefined, response !== undefined].filter(Boolean).length === 1, 'ONE_RESEARCH_INPUT_REQUIRED');
    const bytes = rawBytes !== undefined ? Buffer.from(rawBytes) :
      rawText !== undefined ? Buffer.from(text(rawText, 'RESEARCH_JSON_REQUIRED', MAX_RESPONSE), 'utf8') : jsonBytes(response);
    const parsed = normalizeResponse(bytes, provider);
    return commit(id, expectedRevision, 'Received research edition', async state => {
      need(state.questions.some(question => question.id === questionId), 'QUESTION_NOT_FOUND');
      const raw = await putBlob(bytes);
      const originKey = origin?.intentId ?? '';
      const editionId = 'e_' + digest(Buffer.from(questionId + '\n' + provider + '\n' + raw.sha256 + '\n' + originKey));
      if (state.editions.some(edition => edition.id === editionId)) return false;
      state.editions.push({ id: editionId, questionId, label, provider,
        mode: 'retained', createdAt: timestamp(), raw, sourceReference,
        sourceTerms: parsed.sourceTerms, origin: origin ? clone(origin) : null });
    }, { projection });
  }


  async function previewSourceBundle(id,{questionId,rawBytes,rawText,bundle}={}){
    need([rawBytes!==undefined,rawText!==undefined,bundle!==undefined].filter(Boolean).length===1,
      'ONE_RESEARCH_INPUT_REQUIRED');
    const prepared=inspectSourceBundle(rawBytes??rawText??bundle),current=await head(id);
    need(current.state.questions.some(question=>question.id===questionId),'QUESTION_NOT_FOUND');
    const existing=current.state.editions.find(edition=>edition.questionId===questionId&&
      edition.origin?.mode==='LOCAL_SOURCE_BUNDLE'&&edition.raw?.sha256===prepared.preview.bundleSha256);
    return {...prepared.preview,dossierId:id,questionId,expectedRevision:current.state.revision,
      alreadyReceived:Boolean(existing),...(existing?{editionId:existing.id}:{})};
  }
  async function receiveSourceBundle(id,{questionId,rawBytes,rawText,bundle,expectedBundleSha256,
    expectedRevision,projection='metadata'}={}){
    need(['full','metadata'].includes(projection),'RESEARCH_PROJECTION_INVALID');
    need([rawBytes!==undefined,rawText!==undefined,bundle!==undefined].filter(Boolean).length===1,
      'ONE_RESEARCH_INPUT_REQUIRED');
    const prepared=inspectSourceBundle(rawBytes??rawText??bundle);
    need(expectedBundleSha256===undefined||expectedBundleSha256===prepared.preview.bundleSha256,
      'SOURCE_BUNDLE_CHANGED');
    const current=await head(id);
    need(current.state.questions.some(question=>question.id===questionId),'QUESTION_NOT_FOUND');
    // An interrupted response can be recovered with the same bytes after other
    // work extends the project. The atomic edition contains its findings too.
    const existing=current.state.editions.find(edition=>edition.questionId===questionId&&
      edition.origin?.mode==='LOCAL_SOURCE_BUNDLE'&&edition.raw?.sha256===prepared.preview.bundleSha256);
    if(existing)return projection==='metadata'?metadata(current.state):get(id);
    return commit(id,expectedRevision,'Imported original source bundle',async state=>{
      need(state.questions.some(question=>question.id===questionId),'QUESTION_NOT_FOUND');
      const raw=await putBlob(prepared.rawBytes),provider='source-bundle';
      const intentId='source-bundle:'+raw.sha256;
      const editionId='e_'+digest(Buffer.from(questionId+'\n'+provider+'\n'+raw.sha256+'\n'+intentId));
      const now=timestamp(),occurrences=new Map(),findingIds=[];
      for(let index=0;index<prepared.manifest.sources.length;index++){
        const source=prepared.manifest.sources[index],occurrenceId='o_'+digest(Buffer.from(editionId+'\n'+index));
        occurrences.set(source.key,occurrenceId);
        state.selections.push({occurrenceId,editionId,questionId,key:String(index),
          selected:source.selected??true,note:source.note??'',classification:source.classification??'supports',
          updatedAt:now});
      }
      for(const finding of prepared.manifest.findings??[]){
        const findingId=newId('f');findingIds.push({key:finding.key,id:findingId});
        state.findings.push({id:findingId,questionId,title:finding.title,text:finding.text,
          occurrenceIds:finding.sourceKeys.map(source=>occurrences.get(source)),createdAt:now});
      }
      state.editions.push({id:editionId,questionId,label:prepared.manifest.label,provider,mode:'retained',
        createdAt:now,raw,sourceReference:prepared.manifest.sourceReference??'',
        sourceTerms:prepared.manifest.sourceTerms,origin:{mode:'LOCAL_SOURCE_BUNDLE',intentId,
          sourceBundleSha256:raw.sha256,fileCount:prepared.preview.fileCount,fileBytes:prepared.preview.fileBytes,
          sourceKeys:prepared.manifest.sources.map(source=>source.key),findingIds}});
    },{projection});
  }

  async function receiveBuyerResult(id, { result, questionId, label, provider = 'research',
    sourceReference = '', expectedRevision, intentId } = {}) {
    need(result && typeof result.bytes === 'function' && result.delivery?.status === 'SAVED', 'ORIGINAL_SF88_RESULT_REQUIRED');
    need(typeof intentId === 'string' && intentId.length > 0, 'ORIGINAL_INTENT_REQUIRED');
    const bytes = await result.bytes({ limit: MAX_RESPONSE });
    const original = result.delivery;
    need(digest(bytes) === original.sha256 && bytes.length === original.bytes, 'ORIGINAL_RESPONSE_CHANGED');
    return receive(id, {
      questionId, label, provider, rawBytes: bytes, sourceReference, expectedRevision,
      origin: { mode: 'ORIGINAL_SF88_BUYER_RESULT', intentId, status: result.status,
        httpStatus: result.native?.httpStatus ?? null, ok: Boolean(result.ok),
        exitCode: result.record?.exitCode ?? null, runtimeError: result.record?.runtimeError ?? null,
        responseSha256: original.sha256, responseBytes: original.bytes },
    });
  }

  const receiveReference = (id, { questionId, label, provider, reference, expectedRevision, projection = 'full' }) =>
    commit(id, expectedRevision, 'Attached original research edition', state => {
      need(state.questions.some(question => question.id === questionId), 'QUESTION_NOT_FOUND');
      provider = text(provider, 'EDITION_PROVIDER_REQUIRED', 80);
      need(/^[a-z0-9-]+$/.test(provider), 'EDITION_PROVIDER_INVALID');
      reference = referenceValue(reference);
      label = text(label, 'EDITION_LABEL_REQUIRED', 240);
      const ordered = Object.fromEntries(Object.entries(reference).sort(([a], [b]) => a.localeCompare(b)));
      const editionId = 'e_' + digest(jsonBytes({ questionId, provider, reference: ordered }));
      if (state.editions.some(edition => edition.id === editionId)) return false;
      state.editions.push({ id: editionId, questionId, label, provider, reference,
        mode: 'reference', createdAt: timestamp() });
    }, {projection});

  async function selectEvidence(id, { sourceId, selected, note, classification = 'unreviewed', expectedRevision, projection = 'full' }) {
    need(typeof selected === 'boolean', 'SELECTION_REQUIRED');
    note = text(note ?? '', 'EVIDENCE_NOTE_INVALID', 100000, true);
    need(['supports', 'contradicts', 'background', 'unreviewed'].includes(classification), 'CLASSIFICATION_INVALID');
    return commit(id, expectedRevision, 'Updated source selection and note', async state => {
      const current = await view(state, { includeHistory: false });
      const source = current.sources.find(row => row.id === sourceId);
      need(source, 'SOURCE_NOT_AVAILABLE');
      for (const citation of source.citations) {
        let selection = state.selections.find(row => row.occurrenceId === citation.occurrenceId);
        if (!selection) { selection = { occurrenceId: citation.occurrenceId, editionId: citation.editionId,
          questionId: citation.questionId, key: citation.key }; state.selections.push(selection); }
        Object.assign(selection, { selected, note, classification, updatedAt: timestamp() });
      }
    }, {projection});
  }

  const addFinding = (id, { questionId, title, text: findingText, sourceIds = [], expectedRevision, projection = 'full' }) =>
    commit(id, expectedRevision, 'Added analyst finding', async state => {
      need(state.questions.some(question => question.id === questionId), 'QUESTION_NOT_FOUND');
      need(Array.isArray(sourceIds) && sourceIds.every(value => typeof value === 'string'), 'FINDING_SOURCES_INVALID');
      const current = await view(state, { includeHistory: false });
      const selected = sourceIds.map(sourceId => {
        const source = current.sources.find(row => row.id === sourceId);
        need(source, 'FINDING_SOURCE_NOT_AVAILABLE');
        need(source.citations.some(citation => citation.questionId === questionId), 'FINDING_SOURCE_QUESTION_MISMATCH');
        return source;
      });
      state.findings.push({ id: newId('f'), questionId,
        title: text(title, 'FINDING_TITLE_REQUIRED', 240),
        text: text(findingText, 'FINDING_TEXT_REQUIRED', 100000),
        occurrenceIds: [...new Set(selected.flatMap(source => source.citations
          .filter(citation => citation.questionId === questionId).map(citation => citation.occurrenceId)))],
        createdAt: timestamp() });
    }, {projection});
  const updateSelection = (id, { occurrenceId, selected, note, classification, expectedRevision, projection = 'full' }) =>
    commit(id, expectedRevision, 'Updated saved source note', state => {
      const selection = state.selections.find(row => row.occurrenceId === occurrenceId);
      need(selection, 'SELECTION_NOT_FOUND');
      if (selected !== undefined) { need(typeof selected === 'boolean', 'SELECTION_REQUIRED'); selection.selected = selected; }
      if (note !== undefined) selection.note = text(note, 'EVIDENCE_NOTE_INVALID', 100000, true);
      if (classification !== undefined) {
        need(['supports', 'contradicts', 'background', 'unreviewed'].includes(classification), 'CLASSIFICATION_INVALID');
        selection.classification = classification;
      }
      selection.updatedAt = timestamp();
    }, {projection});
  const updateFinding = (id, findingId, { title, text: findingText, sourceIds, expectedRevision, projection = 'full' }) =>
    commit(id, expectedRevision, 'Updated analyst finding', async state => {
      const finding = state.findings.find(row => row.id === findingId);
      need(finding, 'FINDING_NOT_FOUND');
      if (title !== undefined) finding.title = text(title, 'FINDING_TITLE_REQUIRED', 240);
      if (findingText !== undefined) finding.text = text(findingText, 'FINDING_TEXT_REQUIRED', 100000);
      if (sourceIds !== undefined) {
        need(Array.isArray(sourceIds) && sourceIds.every(value => typeof value === 'string'), 'FINDING_SOURCES_INVALID');
        const current = await view(state, { includeHistory: false });
        finding.occurrenceIds = [...new Set(sourceIds.flatMap(sourceId => {
          const source = current.sources.find(row => row.id === sourceId);
          need(source, 'FINDING_SOURCE_NOT_AVAILABLE');
          need(source.citations.some(citation => citation.questionId === finding.questionId), 'FINDING_SOURCE_QUESTION_MISMATCH');
          return source.citations.filter(citation => citation.questionId === finding.questionId).map(citation => citation.occurrenceId);
        }))];
      }
      finding.updatedAt = timestamp();
    }, {projection});
  const compare = async (id, { before, after }) => {
    const [left, right] = await Promise.all([head(id, before), head(id, after)]);
    return compareViews(await view(left.state, { includeHistory: false }), await view(right.state, { includeHistory: false }));
  };


  async function citationUpdates(id,{revision,noticeId,offset=0,limit=30,status='all'}={}){
    need(offset===0||revision!==undefined,'RESEARCH_PAGE_REVISION_REQUIRED');
    const {state}=await head(id,revision);
    return citationUpdatePage(state,citationUpdateModel(state,await projections(state,{references:false})),
      {noticeId,offset,limit,status});
  }
  async function reviewCitationUpdate(id,{projection='metadata',...value}={}){
    need(['metadata','full'].includes(projection),'RESEARCH_PROJECTION_INVALID');
    const request=citationReviewInput(value),requestSha256=citationDigest(request);
    const current=await head(id);
    async function recovered(state){
      const existing=(state.citationReviews??[]).find(item=>item.requestId===request.requestId);
      if(!existing)return null;
      need(existing.requestSha256===requestSha256,'CITATION_REVIEW_REQUEST_CHANGED');
      return {dossier:projection==='metadata'?metadata(state):await get(id),
        review:clone(existing),duplicate:true};
    }
    const prior=await recovered(current.state);if(prior)return prior;
    let review;
    try{
      const dossier=await commit(id,request.expectedRevision,'Reviewed citation update',async (state,previous)=>{
        const projected=await projections(previous,{references:false});
        review=recordCitationReview(state,projected,request,timestamp());
      },{projection});
      return {dossier,review:clone(review),duplicate:false};
    }catch(error){
      if(error.code==='REVISION_CONFLICT'){
        const saved=await recovered((await head(id)).state);if(saved)return saved;
      }
      throw error;
    }
  }


  async function eligibility(id,{revision,reviewId,workSetId,section='overview',offset=0,limit=30}={}){
    need(offset===0||revision!==undefined,'RESEARCH_PAGE_REVISION_REQUIRED');
    const {state}=await head(id,revision);
    return eligibilityPage(state,eligibilityModel(state,await projections(state,{references:false})),
      {reviewId,workSetId,section,offset,limit});
  }
  async function reviewEligibility(id,{projection='metadata',...value}={}){
    need(['metadata','full'].includes(projection),'RESEARCH_PROJECTION_INVALID');
    const request=eligibilityInput(value),requestSha256=eligibilityDigest(request);
    async function recovered(state){
      const existing=(state.eligibilityEvents??[]).find(item=>item.requestId===request.requestId);
      if(!existing)return null;
      need(existing.requestSha256===requestSha256,'ELIGIBILITY_REQUEST_CHANGED');
      return {dossier:projection==='metadata'?metadata(state):await get(id),operation:clone(existing),duplicate:true};
    }
    const prior=await recovered((await head(id)).state);if(prior)return prior;
    let operation;
    try{
      const dossier=await commit(id,request.expectedRevision,'Eligibility: '+request.action,async(state,previous)=>{
        operation=recordEligibilityOperation(state,await projections(previous,{references:false}),request,timestamp());
      },{projection});
      return {dossier,operation:clone(operation),duplicate:false};
    }catch(error){
      if(error.code==='REVISION_CONFLICT'){
        const saved=await recovered((await head(id)).state);if(saved)return saved;
      }
      throw error;
    }
  }
  async function exportEligibility(id,{revision,reviewId,workSetId,format='json',section='queue'}={}){
    const {state}=await head(id,revision);
    return eligibilityExport(state,eligibilityModel(state,await projections(state,{references:false})),
      {reviewId,workSetId,format,section});
  }


  async function riskOfBias(id,{revision,...options}={}){
    need((options.offset??0)===0||revision!==undefined,'RESEARCH_PAGE_REVISION_REQUIRED');
    const {state}=await head(id,revision),projected=await projections(state,{references:false});
    return riskOfBiasPage(state,riskOfBiasModel(state,projected,riskOfBiasRegistry(state,projected)),{...options,revision});
  }
  async function reviewRiskOfBias(id,{projection='metadata',...value}={}){
    need(['metadata','full'].includes(projection),'RESEARCH_PROJECTION_INVALID');
    const request=riskOfBiasInput(value),requestSha256=riskOfBiasDigest(request);
    async function recovered(state){
      const existing=(state.riskOfBiasEvents??[]).find(item=>item.requestId===request.requestId);
      if(!existing)return null;
      need(existing.requestSha256===requestSha256,'RISK_OF_BIAS_REQUEST_CHANGED');
      return {dossier:projection==='metadata'?metadata(state):await get(id),operation:clone(existing),duplicate:true};
    }
    const prior=await recovered((await head(id)).state);if(prior)return prior;
    let operation;
    try{
      const dossier=await commit(id,request.expectedRevision,'Appraisal: '+request.action,async(state,previous)=>{
        const projected=await projections(previous,{references:false});
        operation=await recordRiskOfBiasOperation(state,projected,request,timestamp(),
          riskOfBiasRegistry(previous,projected),extractionOptions);
      },{projection});
      return {dossier,operation:clone(operation),duplicate:false};
    }catch(error){
      if(error.code==='REVISION_CONFLICT'){
        const saved=await recovered((await head(id)).state);if(saved)return saved;
      }
      throw error;
    }
  }
  async function exportRiskOfBias(id,{revision,...options}={}){
    const {state}=await head(id,revision),projected=await projections(state,{references:false});
    return riskOfBiasExport(state,riskOfBiasModel(state,projected,riskOfBiasRegistry(state,projected)),options);
  }

  async function extraction(id,{revision,...options}={}){
    need((options.offset??0)===0||revision!==undefined,'RESEARCH_PAGE_REVISION_REQUIRED');
    const {state}=await head(id,revision),projected=await projections(state,{references:false});
    return extractionPage(state,studyExtractionModel(state,projected),options);
  }
  async function extractionSourceValues(id,{revision,...options}={}){
    const {state}=await head(id,revision);
    return extractionSourcePointers(state,await projections(state,{references:false}),options,extractionOptions);
  }
  async function reviewExtraction(id,{projection='metadata',...value}={}){
    need(['metadata','full'].includes(projection),'RESEARCH_PROJECTION_INVALID');
    const request=extractionInput(value),requestSha256=extractionDigest(request);
    async function recovered(state){
      const existing=(state.extractionEvents??[]).find(item=>item.requestId===request.requestId);
      if(!existing)return null;
      need(existing.requestSha256===requestSha256,'EXTRACTION_REQUEST_CHANGED');
      return {dossier:projection==='metadata'?metadata(state):await get(id),operation:clone(existing),duplicate:true};
    }
    const prior=await recovered((await head(id)).state);if(prior)return prior;
    let operation;
    try{
      const dossier=await commit(id,request.expectedRevision,'Extraction: '+request.action,async(state,previous)=>{
        operation=await recordStudyExtractionOperation(state,await projections(previous,{references:false}),
          request,timestamp(),extractionOptions);
      },{projection});
      return {dossier,operation:clone(operation),duplicate:false};
    }catch(error){
      if(error.code==='REVISION_CONFLICT'){
        const saved=await recovered((await head(id)).state);if(saved)return saved;
      }
      throw error;
    }
  }
  async function exportExtraction(id,{revision,format='json',formId,resultSetId}={}){
    need(['json','md','html'].includes(format),'EXTRACTION_EXPORT_FORMAT_INVALID');
    const {state}=await head(id,revision),projected=await projections(state,{references:false});
    const report=extractionReport(state,studyExtractionModel(state,projected),{formId,resultSetId});
    const body=format==='json'?jsonBytes(report):format==='md'?Buffer.from(extractionMarkdown(report).join('\n')+'\n','utf8'):
      Buffer.from('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
        '<title>Study extraction</title><style>body{font:15px system-ui,sans-serif;color:#171717;background:#fff;max-width:1200px;margin:32px auto;padding:0 20px;line-height:1.5}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top}th{background:#f2f2f2}.extraction-table{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f5f5f5;padding:16px}section{margin:24px 0}a{color:inherit}</style></head><body>'+
        extractionHtml(report)+'</body></html>','utf8');
    return {filename:id+'-r'+state.revision+'-extraction.'+(format==='md'?'md':format),
      revision:state.revision,contentType:format==='json'?'application/json; charset=utf-8':
        format==='md'?'text/markdown; charset=utf-8':'text/html; charset=utf-8',body};
  }
  async function extractionPublications(id,{revision,...options}={}){
    need((options.offset??0)===0||revision!==undefined,'RESEARCH_PAGE_REVISION_REQUIRED');
    const {state}=await head(id,revision),projected=await projections(state,{references:false});
    const context=extractionPublicationContext(state,studyExtractionModel(state,projected));
    return extractionPublicationPage(state,extractionPublicationModel(state,context),options);
  }
  async function reviewExtractionPublication(id,{projection='metadata',...value}={}){
    need(['metadata','full'].includes(projection),'RESEARCH_PROJECTION_INVALID');
    const request=publicationInput(value),requestSha256=publicationDigest(request);
    async function recovered(state){
      const existing=(state.extractionPublicationEvents??[]).find(item=>item.requestId===request.requestId);
      if(!existing)return null;
      need(existing.requestSha256===requestSha256,'EXTRACTION_PUBLICATION_REQUEST_CHANGED');
      return {dossier:projection==='metadata'?metadata(state):await get(id),operation:clone(existing),duplicate:true};
    }
    const prior=await recovered((await head(id)).state);if(prior)return prior;
    let operation;
    try{
      const dossier=await commit(id,request.expectedRevision,'Extraction publication: '+request.action,async(state,previous)=>{
        const projected=await projections(previous,{references:false});
        const context=extractionPublicationContext(previous,studyExtractionModel(previous,projected));
        operation=await recordExtractionPublication(state,context,request,timestamp());
      },{projection});
      return {dossier,operation:clone(operation),duplicate:false};
    }catch(error){
      if(error.code==='REVISION_CONFLICT'){
        const saved=await recovered((await head(id)).state);if(saved)return saved;
      }
      throw error;
    }
  }
  async function exportExtractionPublication(id,{revision,...options}={}){
    const {state}=await head(id,revision),projected=await projections(state,{references:false});
    const context=extractionPublicationContext(state,studyExtractionModel(state,projected));
    return extractionPublicationExport(state,extractionPublicationModel(state,context),options);
  }

  async function exportDossier(id, { format = 'json', revision } = {}) {
    need(['json', 'md', 'html'].includes(format), 'EXPORT_FORMAT_INVALID');
    const selected=(await head(id,revision)).state.revision;
    const versions = (await history(id)).filter(item=>item.state.revision<=selected), current = versions.at(-1).state;
    if (format === 'json') {
      const metadata = new Map(versions.flatMap(envelope => envelope.state.editions
        .filter(edition => edition.mode === 'retained').map(edition => [edition.raw.sha256, edition.raw])));
      const contents = [];
      let total = 0;
      for (const meta of metadata.values()) {
        const bytes = await blob(meta); total += bytes.length;
        need(total <= MAX_PORTABLE, 'PORTABLE_SIZE_LIMIT');
        contents.push({ ...meta, bodyBase64: bytes.toString('base64') });
      }
      const body = jsonBytes({ schema: PORTABLE, id, exportedAt: timestamp(), versions, blobs: contents });
      need(body.length <= MAX_PORTABLE, 'PORTABLE_SIZE_LIMIT');
      return { filename: id + (revision!==undefined?'-r'+selected:'') + '.research.json', revision:current.revision, contentType: 'application/json; charset=utf-8', body };
    }
    // Reference-only editions contribute operator notes and original handles.
    // Their provider projection is never embedded in a durable report.
    const report = await view(current, { references: false });
    report.revisions=report.revisions.filter(value=>value.revision<=current.revision);
    report.citationReviews=clone(current.citationReviews??[]);
    const reportProjected=await projections(current,{references:false});
    const citationModel=citationUpdateModel(current,reportProjected);
    report.eligibility=eligibilityReport(current,eligibilityModel(current,reportProjected));
    const extractionModel=studyExtractionModel(current,reportProjected);
    report.extraction=extractionReport(current,extractionModel);
    report.riskOfBias=riskOfBiasReport(current,riskOfBiasModel(current,reportProjected,
      riskOfBiasRegistry(current,reportProjected)));
    report.extractionPublications=extractionPublicationReport(current,
      extractionPublicationModel(current,extractionPublicationContext(current,extractionModel)));
    report.citationUpdates=citationModel.notices.map(({noticeId,noticeDoi,targetDoi,title,type,date,status,lastReview})=>
      ({noticeId,noticeDoi,targetDoi,title,type,date,status,lastReview}));
    report.citationCoverage=citationModel.coverage;
    return { filename: id + (revision===undefined?'':'-r'+current.revision) + '.' + format, revision:current.revision,
      contentType: format === 'md' ? 'text/markdown; charset=utf-8' : 'text/html; charset=utf-8',
      body: format === 'md' ? markdownReport(report) : htmlReport(report) };
  }

  async function validatePortableState(state, readContent, occurrenceCache) {
    const validText = (value, max, empty = false) => typeof value === 'string' &&
      value.length <= max && (empty || value.trim().length > 0);
    const validTime = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
    const occurrenceId = value => typeof value === 'string' && /^o_[a-f0-9]{64}$/.test(value);
      need(validText(state.title, 240) && validText(state.description, 20000, true) &&
        validText(state.change, 1000) && validTime(state.createdAt) && validTime(state.updatedAt), 'PORTABLE_STATE_INVALID');
      need(state.questions.every(question => object(question) &&
        typeof question.id === 'string' && /^q_[a-f0-9-]{36}$/.test(question.id) &&
        validText(question.text, 4000) && validText(question.notes, 100000, true) &&
        ['open', 'answered', 'parked'].includes(question.status) && validTime(question.createdAt) &&
        (question.updatedAt === undefined || validTime(question.updatedAt))), 'PORTABLE_QUESTION_INVALID');
      const questions = new Set(state.questions.map(question => question.id));
      need(questions.size === state.questions.length, 'PORTABLE_QUESTION_DUPLICATE');
      const editions = new Map(), knownOccurrences = new Map(), referenceQuestions = new Set();
      for (const edition of state.editions) {
        need(object(edition) && typeof edition.id === 'string' && /^e_[a-f0-9]{64}$/.test(edition.id) &&
          questions.has(edition.questionId) && validText(edition.label, 240) && validText(edition.provider, 80) &&
          validTime(edition.createdAt), 'PORTABLE_EDITION_INVALID');
        need(!editions.has(edition.id), 'PORTABLE_EDITION_DUPLICATE');
        editions.set(edition.id, edition);
        if (edition.mode === 'retained') {
          need(object(edition.raw) && /^[a-f0-9]{64}$/.test(edition.raw.sha256) &&
            Number.isSafeInteger(edition.raw.bytes) && edition.raw.bytes >= 0 && edition.raw.bytes <= MAX_RESPONSE &&
            validText(edition.sourceReference, 4000, true) && validText(edition.sourceTerms, MAX_RESPONSE) &&
            (edition.origin === undefined || edition.origin === null || object(edition.origin)), 'PORTABLE_EDITION_INVALID');
          const binding = edition.id + '\n' + edition.provider + '\n' + edition.raw.sha256 + '\n' + edition.raw.bytes;
          let occurrences = occurrenceCache.get(binding);
          if (!occurrences) {
            const raw = await readContent(edition.raw);
            need(Buffer.isBuffer(raw) && raw.length === edition.raw.bytes, 'PORTABLE_BLOB_CHANGED');
            const normalized = normalizeResponse(raw, edition.provider);
            occurrences = normalized.items.map(row => 'o_' + digest(Buffer.from(edition.id + '\n' + row.key)));
            occurrenceCache.set(binding, occurrences);
          }
          for (const occurrence of occurrences) knownOccurrences.set(occurrence, edition.questionId);
        } else {
          need(edition.mode === 'reference' && /^[a-z0-9-]+$/.test(edition.provider), 'EDITION_MODE_INVALID');
          referenceValue(edition.reference);
          referenceQuestions.add(edition.questionId);
        }
      }
      const selections = new Set();
      for (const selection of state.selections) {
        need(object(selection) && occurrenceId(selection.occurrenceId) &&
          editions.has(selection.editionId) && selection.questionId === editions.get(selection.editionId).questionId &&
          validText(selection.key, 512) && typeof selection.selected === 'boolean' &&
          validText(selection.note, 100000, true) &&
          ['supports', 'contradicts', 'background', 'unreviewed'].includes(selection.classification) &&
          validTime(selection.updatedAt), 'PORTABLE_SELECTION_INVALID');
        need(selection.occurrenceId === 'o_' + digest(Buffer.from(selection.editionId + '\n' + selection.key)),
          'PORTABLE_SELECTION_REFERENCE_INVALID');
        need(!selections.has(selection.occurrenceId), 'PORTABLE_SELECTION_DUPLICATE');
        selections.add(selection.occurrenceId);
        if (editions.get(selection.editionId).mode === 'retained')
          need(knownOccurrences.get(selection.occurrenceId) === selection.questionId, 'PORTABLE_SELECTION_REFERENCE_INVALID');
        knownOccurrences.set(selection.occurrenceId, selection.questionId);
      }
      validateCitationReviewState(state,editions);
      validateEligibilityState(state,editions,knownOccurrences);
      validateStudyExtractionState(state);
      validateExtractionPublicationState(state);
      validateRiskOfBiasState(state,editions,knownOccurrences);
      const findings = new Set();
      for (const finding of state.findings) {
        need(object(finding) && typeof finding.id === 'string' && /^f_[a-f0-9-]{36}$/.test(finding.id) &&
          questions.has(finding.questionId) && validText(finding.title, 240) && validText(finding.text, 100000) &&
          Array.isArray(finding.occurrenceIds) && finding.occurrenceIds.every(occurrenceId) &&
          new Set(finding.occurrenceIds).size === finding.occurrenceIds.length && validTime(finding.createdAt) &&
          (finding.updatedAt === undefined || validTime(finding.updatedAt)), 'PORTABLE_FINDING_INVALID');
        need(!findings.has(finding.id), 'PORTABLE_FINDING_DUPLICATE');
        findings.add(finding.id);
        for (const key of finding.occurrenceIds) {
          const questionId = knownOccurrences.get(key);
          // Unavailable external editions retain their opaque original occurrence handles.
          need(questionId === finding.questionId || (questionId === undefined && referenceQuestions.has(finding.questionId)),
            'PORTABLE_FINDING_REFERENCE_INVALID');
        }
      }
  }

  async function validateReviewTransitions(previous,state,readContent){
    const hasCitation=(state.citationReviews?.length??0)>(previous?.citationReviews?.length??0);
    const hasEligibility=(state.eligibilityEvents?.length??0)>(previous?.eligibilityEvents?.length??0);
    const hasExtraction=(state.extractionEvents?.length??0)>(previous?.extractionEvents?.length??0);
    const hasPublication=(state.extractionPublicationEvents?.length??0)>(previous?.extractionPublicationEvents?.length??0);
    const hasRiskOfBias=(state.riskOfBiasEvents?.length??0)>(previous?.riskOfBiasEvents?.length??0);
    const projected=(hasCitation||hasEligibility||hasExtraction||hasPublication||hasRiskOfBias)&&previous?
      await projections(previous,{references:false,readContent}):undefined;
    validateCitationReviewTransition(previous,state,projected);
    validateEligibilityTransition(previous,state,projected);
    await validateStudyExtractionTransition(previous,state,projected,extractionOptions);
    const context=hasPublication&&previous?extractionPublicationContext(previous,studyExtractionModel(previous,projected)):undefined;
    await validateExtractionPublicationTransition(previous,state,context);
    const riskRegistry=hasRiskOfBias&&previous?riskOfBiasRegistry(previous,projected):undefined;
    await validateRiskOfBiasTransition(previous,state,projected,riskRegistry,extractionOptions);
  }

  async function reopen(portable) {
    need(object(portable) && portable.schema === PORTABLE && validId(portable.id) &&
      Array.isArray(portable.versions) && portable.versions.length > 0 && Array.isArray(portable.blobs), 'PORTABLE_INVALID');
    need(jsonBytes(portable).length <= MAX_PORTABLE, 'PORTABLE_SIZE_LIMIT');
    const id = portable.id, incoming = portable.versions, content = new Map();
    let previous = null, total = 0;
    for (let index = 0; index < incoming.length; index++) {
      const envelope = validateEnvelope(incoming[index], id, index + 1);
      need(jsonBytes(envelope).length <= MAX_STATE, 'DOSSIER_STATE_TOO_LARGE');
      need(envelope.state.previous === previous, 'PORTABLE_HISTORY_CHANGED');
      previous = envelope.sha256;
    }
    for (const entry of portable.blobs) {
      need(object(entry) && typeof entry.bodyBase64 === 'string' && /^[a-f0-9]{64}$/.test(entry.sha256), 'PORTABLE_BLOB_INVALID');
      const bytes = Buffer.from(entry.bodyBase64, 'base64');
      need(bytes.toString('base64') === entry.bodyBase64 && bytes.length === entry.bytes &&
        bytes.length <= MAX_RESPONSE && digest(bytes) === entry.sha256, 'PORTABLE_BLOB_CHANGED');
      total += bytes.length; need(total <= MAX_PORTABLE, 'PORTABLE_SIZE_LIMIT');
      if (content.has(entry.sha256)) need(content.get(entry.sha256).equals(bytes), 'PORTABLE_BLOB_CONFLICT');
      content.set(entry.sha256, bytes);
    }
    const occurrenceCache = new Map();
    const readContent = async metadata => {
      need(content.has(metadata.sha256), 'PORTABLE_BLOB_MISSING');
      return content.get(metadata.sha256);
    };
    for (let index=0;index<incoming.length;index++){
      const state=incoming[index].state,prior=index?incoming[index-1].state:null;
      await validatePortableState(state,readContent,occurrenceCache);
      await validateReviewTransitions(prior,state,readContent);
    }
    let existing = [];
    try { existing = await history(id); }
    catch (error) { if (error.code !== 'DOSSIER_NOT_FOUND') throw error; }
    for (let index = 0; index < Math.min(existing.length, incoming.length); index++) {
      need(existing[index].sha256 === incoming[index].sha256, 'PORTABLE_HISTORY_CONFLICT');
    }
    for (const bytes of content.values()) await putBlob(bytes);
    const target = await revisionsDirectory(id, true);
    for (let index = existing.length; index < incoming.length; index++) {
      try { await writeJson(join(target, filename(index + 1)), incoming[index], { exclusive: true }); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        need((await readRevision(id, index + 1)).sha256 === incoming[index].sha256, 'REVISION_CONFLICT');
      }
    }
    return get(id);
  }

  async function exportStream(id, {compression = 'none', revision} = {}) {
    need(['none', 'gzip'].includes(compression), 'PORTABLE_COMPRESSION_INVALID');
    const selected=(await head(id,revision)).state.revision;
    const all = (await numbers(id)).filter(value=>value<=selected);
    need(all.length > 0, 'DOSSIER_NOT_FOUND');
    const exportedAt = timestamp();
    async function* chunks() {
      const contents = new Map();
      let previous = null, total = 0;
      yield Buffer.from('{"schema":' + JSON.stringify(PORTABLE) + ',"id":' + JSON.stringify(id) +
        ',"exportedAt":' + JSON.stringify(exportedAt) + ',"versions":[\n');
      for (const revision of all) {
        const envelope = await readRevision(id, revision);
        need(envelope.state.previous === previous, 'DOSSIER_HISTORY_CHANGED');
        previous = envelope.sha256;
        for (const edition of envelope.state.editions) {
          if (edition.mode !== 'retained') continue;
          const existing = contents.get(edition.raw.sha256);
          need(!existing || existing.bytes === edition.raw.bytes, 'RESEARCH_BLOB_CHANGED');
          contents.set(edition.raw.sha256, edition.raw);
        }
        if (revision > 1) yield Buffer.from(',\n');
        yield jsonBytes(envelope);
      }
      yield Buffer.from('],"blobs":[\n');
      let index = 0;
      for (const metadata of contents.values()) {
        const bytes = await blob(metadata);
        total += bytes.length; need(total <= MAX_PORTABLE, 'PORTABLE_SIZE_LIMIT');
        if (index++) yield Buffer.from(',\n');
        yield jsonBytes({...metadata, bodyBase64: bytes.toString('base64')});
      }
      yield Buffer.from(']}\n');
    }
    return {filename: id + (revision!==undefined?'-r'+selected:'') + '.research.json' + (compression === 'gzip' ? '.gz' : ''),
      contentType: compression === 'gzip' ? 'application/gzip' : 'application/json; charset=utf-8',
      body: encodePortable(chunks(), {compression}), revision: all.at(-1)};
  }

  async function reopenStream(input, {projection = 'full'} = {}) {
    need(['full', 'metadata'].includes(projection), 'RESEARCH_PROJECTION_INVALID');
    const staging = await mkdtemp(join(directory, '.portable-'));
    const fields = {}, content = new Map();
    let revisionCount = 0, blobCount = 0, total = 0;
    try {
      for await (const record of portableEntries(input)) {
        if (record.kind === 'field') {
          if (['schema', 'id', 'exportedAt'].includes(record.key)) fields[record.key] = record.value;
        } else if (record.kind === 'array') {
          if (record.key === 'versions') fields.versions = record.count;
          else fields.blobs = record.count;
        } else if (record.kind === 'versions') {
          const envelope = record.value;
          need(object(envelope) && validId(envelope.state?.id), 'PORTABLE_INVALID');
          validateEnvelope(envelope, envelope.state.id, record.index + 1);
          need(jsonBytes(envelope).length <= MAX_STATE, 'DOSSIER_STATE_TOO_LARGE');
          await writeJson(join(staging, filename(record.index + 1)), envelope, {exclusive: true});
          revisionCount++;
        } else if (record.kind === 'blobs') {
          const entry = record.value;
          need(object(entry) && typeof entry.bodyBase64 === 'string' &&
            /^[a-f0-9]{64}$/.test(entry.sha256), 'PORTABLE_BLOB_INVALID');
          const bytes = Buffer.from(entry.bodyBase64, 'base64');
          need(bytes.toString('base64') === entry.bodyBase64 && bytes.length === entry.bytes &&
            bytes.length <= MAX_RESPONSE && digest(bytes) === entry.sha256, 'PORTABLE_BLOB_CHANGED');
          total += bytes.length; need(total <= MAX_PORTABLE, 'PORTABLE_SIZE_LIMIT');
          const previous = content.get(entry.sha256);
          need(!previous || previous.bytes === bytes.length, 'PORTABLE_BLOB_CONFLICT');
          if (!previous) {
            await writeBytes(join(staging, entry.sha256), bytes, {exclusive: true});
            content.set(entry.sha256, {sha256: entry.sha256, bytes: bytes.length});
          }
          blobCount++;
        }
      }
      need(fields.schema === PORTABLE && validId(fields.id) && fields.versions === revisionCount &&
        revisionCount > 0 && fields.blobs === blobCount, 'PORTABLE_INVALID');
      const id = fields.id;
      const readContent = async metadata => {
        const entry = content.get(metadata.sha256);
        need(entry, 'PORTABLE_BLOB_MISSING');
        need(entry.bytes === metadata.bytes, 'PORTABLE_BLOB_CHANGED');
        const bytes = await readBytes(join(staging, entry.sha256), MAX_RESPONSE);
        need(bytes.length === entry.bytes && digest(bytes) === entry.sha256, 'PORTABLE_BLOB_CHANGED');
        return bytes;
      };
      let previous = null, previousState=null;
      const occurrenceCache = new Map();
      let existing = [];
      try { existing = await numbers(id); }
      catch (error) { if (error.code !== 'DOSSIER_NOT_FOUND') throw error; }
      for (let revision = 1; revision <= revisionCount; revision++) {
        const envelope = validateEnvelope(await readJson(join(staging, filename(revision)), MAX_STATE), id, revision);
        need(envelope.state.previous === previous, 'PORTABLE_HISTORY_CHANGED');
        previous = envelope.sha256;
        await validatePortableState(envelope.state, readContent, occurrenceCache);
        await validateReviewTransitions(previousState,envelope.state,readContent);previousState=envelope.state;
        if (revision <= existing.length)
          need((await readRevision(id, revision)).sha256 === envelope.sha256, 'PORTABLE_HISTORY_CONFLICT');
      }
      // All source and history validation completes before changing the saved
      // project. The original content-addressed blob and exclusive revision
      // writers preserve replay and concurrent-extension behavior.
      for (const metadata of content.values()) await putBlob(await readContent(metadata));
      const target = await revisionsDirectory(id, true);
      for (let revision = existing.length + 1; revision <= revisionCount; revision++) {
        const envelope = await readJson(join(staging, filename(revision)), MAX_STATE);
        try { await writeJson(join(target, filename(revision)), envelope, {exclusive: true}); }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          need((await readRevision(id, revision)).sha256 === envelope.sha256, 'REVISION_CONFLICT');
        }
      }
      return projection === 'metadata' ? getMetadata(id) : get(id);
    } finally { await rm(staging, {recursive: true, force: true}); }
  }

  return Object.freeze({ directory, list, create, get, getMetadata, readRetainedEdition, listRevisions, update, addQuestion, updateQuestion,
    receive, previewSourceBundle, receiveSourceBundle, receiveBuyerResult, receiveReference, selectEvidence, updateSelection, addFinding, updateFinding,
    citationUpdates,reviewCitationUpdate,eligibility,reviewEligibility,exportEligibility,
    riskOfBias,reviewRiskOfBias,exportRiskOfBias,
    extraction,extractionSourceValues,reviewExtraction,exportExtraction,
    extractionPublications,reviewExtractionPublication,exportExtractionPublication,
    compare, exportDossier, exportStream, reopen, reopenStream });
}
