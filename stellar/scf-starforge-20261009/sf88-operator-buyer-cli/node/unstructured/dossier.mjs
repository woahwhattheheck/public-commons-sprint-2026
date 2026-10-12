// MIT. Original document purchases received through the existing research dossier.
import { Buyer } from '../client.mjs';
import { parseJson } from '../store.mjs';
import { UNSTRUCTURED_SOURCE, PARTITION_LIMITS, parsePartitionElements, canonicalBytes, digest, same, need, object } from './contract.mjs';
import {
  readPartitionPurchase, readPartitionInboxPurchase, verifyPartitionPurchase, partitionPurchaseBinding, decodePartitionBytes,
} from './purchase.mjs';

export const PARTITION_RESEARCH_SCHEMA = 'sf88-research-results-v1';
const TERMS = 'Original document and unchanged Unstructured Partition response retained by the purchasing operator; document rights remain with its owner.';
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const copy = value => structuredClone(value);
const reference = purchase => ({
  id: 'unstructured-v1:' + digest(canonicalBytes(partitionPurchaseBinding(purchase))),
  workspaceId: purchase.workspaceId, operationId: purchase.intentId,
});
function checkedReference(value, workspaceId) {
  need(object(value) && Object.keys(value).length === 3 &&
    typeof value.id === 'string' && /^unstructured-v1:[a-f0-9]{64}$/.test(value.id) &&
    value.workspaceId === workspaceId && typeof value.operationId === 'string' &&
    value.operationId.length > 0 && value.operationId.length <= 512,
  'UNSTRUCTURED_EDITION_REFERENCE_INVALID');
}

/** Original element IDs and array positions remain distinct, including repeated IDs. */
export function partitionResearchProjection(purchase, elements) {
  const bound = partitionPurchaseBinding(purchase);
  const document = copy(bound.document);
  const originalPurchase = {
    workspaceId: bound.workspaceId, intentId: bound.intentId,
    configurationSha256: bound.configurationSha256, profileId: bound.profileId,
    parametersSha256: bound.parametersSha256, responseSha256: bound.responseSha256,
  };
  const items = elements.map((element, index) => {
    const position = index + 1;
    const page = element.metadata.page_number ?? null;
    const pageLabel = typeof page === 'string' || Number.isFinite(page) ? ' · page ' + page : '';
    return {
      key: 'element-' + String(position).padStart(8, '0'),
      id: 'unstructured-element:' + document.sha256 + ':' + bound.responseSha256 + ':' + position,
      title: document.filename + pageLabel + ' · ' + (element.type ?? 'Element') + ' ' + position,
      // A document URL would merge all its elements in the original URL deduper.
      // The source identity above identifies one original array occurrence instead.
      url: '', content: element.text,
      citation: {
        kind: 'UNSTRUCTURED_DOCUMENT_ELEMENT', position, elementId: element.element_id,
        type: element.type, pageNumber: copy(page),
        coordinates: copy(element.metadata.coordinates ?? null), document,
      },
      metadata: {
        kind: 'document_element', position, originalPurchase, document,
        elementMetadata: copy(element.metadata),
      },
      providerRecord: copy(element),
    };
  });
  return {
    query: 'Document: ' + document.filename + ' · profile ' + purchase.selection.profileId,
    items,
    usage: { originalPurchase: bound, document, parameters: copy(purchase.selection.parameters),
      elementSummary: copy(purchase.summary), contractSource: UNSTRUCTURED_SOURCE },
    warnings: elements.length === 0 ? ['The selected provider request returned an empty element array.'] : [],
  };
}

function envelopeFor(purchase, elements) {
  const view = partitionResearchProjection(purchase, elements);
  return {
    schema: PARTITION_RESEARCH_SCHEMA, provider: 'unstructured',
    query: view.query, success: true, status: 'AVAILABLE', sourceTerms: TERMS,
    results: view.items, usage: view.usage, warnings: view.warnings,
    originalPurchase: purchase,
  };
}
function receiptFor(purchase, envelope) {
  return {
    reference: reference(purchase), binding: partitionPurchaseBinding(purchase),
    editionSha256: digest(canonicalBytes(envelope)),
    elementCount: envelope.results.length, summary: copy(purchase.summary),
  };
}

/** Reads the retained native buyer only. Acquiring another document is a separate original purchase. */
export function createPartitionEditionProvider(buyer, { workspaceId, inboxDirectory } = {}) {
  need(buyer instanceof Buyer, 'ORIGINAL_DOCUMENT_BUYER_REQUIRED');
  need(typeof workspaceId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/.test(workspaceId),
    'UNSTRUCTURED_WORKSPACE_ID_REQUIRED');
  async function envelope(intentId, { signal } = {}) {
    const purchase = inboxDirectory === undefined ?
      await readPartitionPurchase(buyer, intentId, { workspaceId, signal }) :
      await readPartitionInboxPurchase(buyer, inboxDirectory, intentId, { workspaceId, signal });
    const elements = parsePartitionElements(parseJson(decodePartitionBytes(purchase.response, PARTITION_LIMITS.responseBytes)));
    return envelopeFor(purchase, elements);
  }
  async function describe(intentId, options) {
    const value = await envelope(intentId, options);
    return receiptFor(value.originalPurchase, value);
  }
  async function read(value) {
    checkedReference(value, workspaceId);
    const saved = await envelope(value.operationId);
    const purchase = saved.originalPurchase;
    need(same(reference(purchase), value), 'UNSTRUCTURED_ORIGINAL_PURCHASE_CHANGED');
    return { status: 'AVAILABLE',
      items: saved.results.map(row => ({ ...row, original: row.providerRecord })),
      usage: saved.usage, warnings: saved.warnings, retention: 'ORIGINAL_SAVED_BUYER_RESULT' };
  }
  return Object.freeze({ workspaceId, runtimeDirectory: buyer.runtime.directory, envelope, describe, read });
}

/** Verify original wire bytes, document, parameters and every derived evidence row. */
export async function verifyPartitionResearchEnvelope(value, { runtimeDirectory } = {}) {
  if (value instanceof Uint8Array) value = parseJson(value);
  need(object(value) && value.schema === PARTITION_RESEARCH_SCHEMA &&
    value.provider === 'unstructured' && object(value.originalPurchase),
  'UNSTRUCTURED_RESEARCH_ENVELOPE_REQUIRED');
  const checked = await verifyPartitionPurchase(value.originalPurchase, { runtimeDirectory });
  const expected = envelopeFor(value.originalPurchase, checked.elements);
  need(same(value, expected), 'UNSTRUCTURED_RESEARCH_PROJECTION_CHANGED');
  return { ...receiptFor(value.originalPurchase, value), envelope: value,
    elements: checked.elements, document: checked.document };
}

/** A saved exact receive is recovered before testing a later dossier revision. */
export async function receivePartitionEnvelope(store, dossierId, {
  envelope, runtimeDirectory, questionId, label, expectedRevision, expectedEditionSha256,
  mode = 'retained', signal,
} = {}) {
  need(store && typeof store.get === 'function' && typeof store.receive === 'function' &&
    typeof store.receiveReference === 'function', 'ORIGINAL_DOSSIER_STORE_REQUIRED');
  need(['retained', 'reference'].includes(mode), 'UNSTRUCTURED_RECEIVING_MODE_INVALID');
  need(typeof label === 'string' && label.trim().length > 0 && label.length <= 240,
    'UNSTRUCTURED_EDITION_LABEL_REQUIRED');
  need(typeof questionId === 'string' && questionId.length > 0, 'UNSTRUCTURED_QUESTION_REQUIRED');
  const checked = await verifyPartitionResearchEnvelope(envelope, { runtimeDirectory });
  need(hex(expectedEditionSha256) && checked.editionSha256 === expectedEditionSha256,
    'UNSTRUCTURED_REVIEWED_EDITION_CHANGED');
  const bytes = canonicalBytes(checked.envelope), rawSha256 = digest(bytes);
  const origin = { mode: 'ORIGINAL_UNSTRUCTURED_SAVED_BUYER_RESULT', ...checked.binding,
    projectionSha256: rawSha256, elementCount: checked.elementCount };
  const current = typeof store.getMetadata === 'function' ? await store.getMetadata(dossierId) : await store.get(dossierId);
  const matches = edition => edition.questionId === questionId &&
    (mode === 'reference' ? edition.mode === 'reference' && edition.provider === 'unstructured' &&
      same(edition.reference, checked.reference) :
      edition.mode === 'retained' && edition.raw?.sha256 === rawSha256 &&
      edition.origin?.intentId === checked.binding.intentId &&
      edition.origin?.configurationSha256 === checked.binding.configurationSha256);
  const previous = current.editions.find(matches);
  const receipt = { reference: checked.reference, binding: checked.binding,
    editionSha256: checked.editionSha256, elementCount: checked.elementCount, summary: checked.summary };
  if (previous) {
    need(previous.label === label, 'UNSTRUCTURED_RECEIVING_LABEL_CONFLICT');
    const dossier = Array.isArray(current.sources) ? current : await store.get(dossierId, {revision:current.revision});
    return { dossier, receipt, reused: true, editionId: previous.id };
  }
  need(Number.isSafeInteger(expectedRevision) && expectedRevision >= 1, 'EXPECTED_REVISION_REQUIRED');
  need(!signal?.aborted, 'UNSTRUCTURED_RECEIVING_ABORTED');
  const dossier = mode === 'reference' ?
    await store.receiveReference(dossierId, { questionId, label, provider: 'unstructured',
      reference: checked.reference, expectedRevision }) :
    await store.receive(dossierId, { questionId, label, provider: 'research', rawBytes: bytes,
      sourceReference: 'Original document purchase ' + checked.binding.intentId, origin, expectedRevision });
  const edition = dossier.editions.find(matches);
  need(edition, 'UNSTRUCTURED_EDITION_RECEIVING_INCOMPLETE');
  return { dossier, receipt, reused: false, editionId: edition.id };
}

export async function receivePartitionEdition(store, dossierId, {
  provider, intentId, ...selection
} = {}) {
  need(provider && typeof provider.envelope === 'function' &&
    typeof provider.runtimeDirectory === 'string', 'ORIGINAL_DOCUMENT_EDITION_PROVIDER_REQUIRED');
  const envelope = await provider.envelope(intentId, { signal: selection.signal });
  return receivePartitionEnvelope(store, dossierId, {
    ...selection, envelope, runtimeDirectory: provider.runtimeDirectory,
  });
}
