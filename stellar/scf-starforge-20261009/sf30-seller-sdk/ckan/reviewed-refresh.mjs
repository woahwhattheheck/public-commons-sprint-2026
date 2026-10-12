// MIT. Reviewed continuation of the original retained CKAN publisher.
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setImmediate as yieldTurn } from 'node:timers/promises';
import { bytes, digest, identity, readPrivate, atomicJson, privateDirectory, fault, stamp } from '../postgres/publisher/files.mjs';
import { compileQueries, readCkanSourceFile } from './declaration.mjs';
import { bindCkanCapture, projectCkanValue } from './source.mjs';
import { projectCkanSemantics } from './semantics.mjs';
import { createCkanRefreshComparison, readCkanRefreshComparison,
  readCkanRefreshChanges, ckanRefreshChangeFile } from './refresh.mjs';

const HASH = /^[a-f0-9]{64}$/;
const FINAL = new Set(['ACCEPTED', 'KEPT_CURRENT', 'SOURCE_WITHDRAWN']);
function requiredText(value, label, maximum = 2048) {
  if (typeof value !== 'string' || !value.trim() || value.length > maximum)
    throw fault('CKAN_REFRESH_REVIEW_REQUIRED', 'Enter ' + label + '.');
  return value.trim();
}
function expected(value, actual, code) {
  if (!HASH.test(value ?? '') || value !== actual) throw fault(code, 'Read the retained refresh and use its current exact identity.', 409);
}

/** All writes run through the original workbench launch and project lease. */
export function createCkanReviewedRefreshes({ directory, state, find, selectedCapture, launch, persist, createSource }) {
  const root = value => join(directory, 'refreshes', value);
  async function sourceBinding(sourceId) {
    const source = find('sources', sourceId), selected = await readCkanSourceFile(source.file);
    expected(selected.hash, source.sha256, 'CKAN_REFRESH_SOURCE_CHANGED');
    const capture = await selectedCapture(source.editionId);
    bindCkanCapture(capture, selected.config, selected.queries[source.query]);
    return { source, selected, capture };
  }
  async function comparison(entry) {
    return readCkanRefreshComparison({ directory: root(entry.id), expectedSha256: entry.comparisonSha256 });
  }
  async function retainedDecision(entry, optional = false) {
    let raw;
    try { raw = await readPrivate(join(root(entry.id), 'decision.json'), 1048576); }
    catch (error) { if (optional && error.code === 'ENOENT') return null; throw error; }
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)), sha256 = digest(raw);
    if (value.schema !== 'stellar-forge.ckan-refresh-decision.v1' || value.intent?.refreshId !== entry.id ||
        value.intent?.comparisonSha256 !== entry.comparisonSha256 ||
        entry.decisionSha256 && sha256 !== entry.decisionSha256)
      throw fault('CKAN_REFRESH_DECISION_CHANGED');
    return { ...value, sha256 };
  }
  async function inspectProjection(entry, input = {}) {
    const { source } = await sourceBinding(entry.sourceId), capture = await selectedCapture(entry.afterEditionId);
    expected(entry.afterCaptureSha256, capture.manifestSha256, 'CKAN_REVIEWED_EDITION_CHANGED');
    const query = input.query ?? source.query, title = requiredText(input.title ?? source.title, 'a data product title', 128);
    const compiled = compileQueries({ [query]: { projection: input.projection ?? source.projection } })[query];
    const semantics = projectCkanSemantics(capture, compiled.projection);
    const semanticReview = semantics ? { sha256: semantics.sha256, definitionSha256: semantics.definitionSha256 } : null;
    const selected = { ...compiled, ...(semanticReview ? { semanticReview } : {}) };
    bindCkanCapture(capture, { catalogOrigin: state.catalogOrigin,
      packageId: capture.manifest.packageId, resourceId: capture.manifest.resourceId }, selected);
    const preview = [], columns = Object.entries(compiled.projection);
    for (let index = 0; index < capture.rows.length; index++) {
      const row = capture.rows[index], projected = index < 20 ? Object.create(null) : null;
      for (const [alias, spec] of columns) {
        const value = projectCkanValue(row[spec.field], spec);
        if (projected) projected[alias] = value;
      }
      if (projected) preview.push(projected);
      if ((index + 1) % 2048 === 0) await yieldTurn();
    }
    return { title, query, projection: compiled.projection,
      projectionSha256: identity({ query, projection: compiled.projection }),
      semanticReview, semantics, validatedRows: capture.rows.length, preview };
  }
  async function buildComparison(entry, signal, progress) {
    const { source, capture: before } = await sourceBinding(entry.sourceId);
    expected(entry.sourceSha256, source.sha256, 'CKAN_REFRESH_SOURCE_CHANGED');
    expected(entry.beforeCaptureSha256, before.manifestSha256, 'CKAN_REVIEWED_EDITION_CHANGED');
    const after = await selectedCapture(entry.afterEditionId);
    expected(entry.afterCaptureSha256, after.manifestSha256, 'CKAN_REVIEWED_EDITION_CHANGED');
    entry.state = 'PREPARING'; entry.error = null; await persist();
    try {
      await privateDirectory(root(entry.id), true);
      const result = await createCkanRefreshComparison({ directory: root(entry.id), before, after,
        keys: entry.keys, signal, onProgress: progress });
      const c = result.comparison;
      entry.comparisonSha256 = result.sha256; entry.comparisonBytes = result.bytes;
      entry.summary = { added: c.added, removed: c.removed, changed: c.changed, unchanged: c.unchanged,
        selectionChanged: c.selectionChanged, fieldsChanged: c.fieldsChanged,
        sourceTermsChanged: c.sourceTermsChanged, semanticChanges: c.semanticChanges.changed,
        changeRows: c.changes.rows, changeBytes: c.changes.bytes, changesSha256: c.changes.sha256 };
      entry.state = 'READY'; entry.completedAt = stamp(); await persist();
      return entry;
    } catch (error) {
      entry.state = signal.aborted ? 'INTERRUPTED' : 'FAILED'; entry.error = error.code ?? 'CKAN_REFRESH_FAILED';
      await persist(); throw error;
    }
  }
  async function applyDecision(entry, record) {
    const intent = record.intent;
    if (intent.sourceId !== entry.sourceId || intent.sourceSha256 !== entry.sourceSha256 ||
        intent.afterEditionId !== entry.afterEditionId || intent.afterCaptureSha256 !== entry.afterCaptureSha256)
      throw fault('CKAN_REFRESH_DECISION_CHANGED');
    const { source } = await sourceBinding(entry.sourceId);
    expected(entry.sourceSha256, source.sha256, 'CKAN_REFRESH_SOURCE_CHANGED');
    if (intent.decision === 'accept') {
      if (intent.acceptedSourceId !== entry.nextSourceId) throw fault('CKAN_REFRESH_DECISION_CHANGED');
      const preview = await inspectProjection(entry, intent.selection);
      if (preview.projectionSha256 !== intent.selection.projectionSha256 ||
          identity(preview.semanticReview) !== identity(intent.selection.semanticReview))
        throw fault('CKAN_REFRESH_REVIEW_CHANGED');
      const accepted = await createSource(entry.afterEditionId, {
        expectedCaptureSha256: entry.afterCaptureSha256,
        title: preview.title, query: preview.query, projection: preview.projection,
      }, { sourceId: entry.nextSourceId, refresh: { refreshId: entry.id,
        refreshDecisionSha256: record.sha256, previousSourceId: entry.sourceId,
        previousPublicationId: entry.previousPublicationId } });
      entry.acceptedSourceId = accepted.id; entry.state = 'ACCEPTED';
    } else if (intent.decision === 'keep-current') entry.state = 'KEPT_CURRENT';
    else if (intent.decision === 'withdraw-source') {
      source.withdrawal = { refreshId: entry.id, decisionSha256: record.sha256,
        reviewer: intent.reviewer, note: intent.note, withdrawnAt: record.createdAt };
      entry.state = 'SOURCE_WITHDRAWN';
    } else throw fault('CKAN_REFRESH_DECISION_INVALID');
    entry.decisionSha256 = record.sha256; entry.reviewedAt = record.createdAt;
    entry.reviewer = intent.reviewer; entry.decision = intent.decision; entry.error = null;
    await persist(); return structuredClone(entry);
  }
  return {
    prepareRefresh(sourceId, input = {}) {
      return launch('compare retained refresh', async (signal, progress) => {
        const { source, capture } = await sourceBinding(sourceId), after = await selectedCapture(input.afterEditionId);
        expected(input.expectedSourceSha256, source.sha256, 'CKAN_REFRESH_SOURCE_CHANGED');
        expected(input.expectedAfterCaptureSha256, after.manifestSha256, 'CKAN_REVIEWED_EDITION_CHANGED');
        const previous = input.previousPublicationId ? find('publications', input.previousPublicationId) :
          state.publications.filter(item => item.sourceId === sourceId && item.state === 'PUBLISHED').at(-1);
        if (previous && (previous.sourceId !== sourceId || previous.state !== 'PUBLISHED'))
          throw fault('CKAN_REFRESH_PUBLICATION_MISMATCH', 'Choose a published version of the selected original source.');
        const superseded = input.supersedesRefreshId ? find('refreshes', input.supersedesRefreshId) : null;
        if (superseded && (!FINAL.has(superseded.state) || superseded.sourceId !== sourceId ||
            superseded.afterEditionId !== input.afterEditionId))
          throw fault('CKAN_REFRESH_RECONSIDERATION_INVALID', 'Choose a completed decision on these same source editions.');
        const selection = { sourceId, sourceSha256: source.sha256, beforeEditionId: source.editionId,
          beforeCaptureSha256: capture.manifestSha256, afterEditionId: input.afterEditionId,
          afterCaptureSha256: after.manifestSha256, keys: input.keys ?? ['_id'],
          previousPublicationId: previous?.id ?? null, supersedesRefreshId: superseded?.id ?? null };
        const intentSha256 = identity(selection);
        let entry = state.refreshes.find(item => item.intentSha256 === intentSha256);
        if (entry?.comparisonSha256 && ['READY', ...FINAL].includes(entry.state)) {
          await comparison(entry);
          const decision = await retainedDecision(entry, true);
          return decision ? applyDecision(entry, decision) : structuredClone(entry);
        }
        if (!entry) {
          entry = { id: randomUUID(), schema: 'stellar-forge.ckan-reviewed-refresh.v1',
            ...selection, intentSha256, nextSourceId: randomUUID(), state: 'PREPARING', createdAt: stamp() };
          state.refreshes.push(entry); await persist();
        }
        await buildComparison(entry, signal, progress);
        const decision = await retainedDecision(entry, true);
        return decision ? applyDecision(entry, decision) : structuredClone(entry);
      });
    },
    resumeRefresh(value) {
      return launch('resume retained refresh', async (signal, progress) => {
        const entry = find('refreshes', value);
        if (entry.comparisonSha256) await comparison(entry);
        else await buildComparison(entry, signal, progress);
        const decision = await retainedDecision(entry, true);
        return decision ? applyDecision(entry, decision) : structuredClone(entry);
      });
    },
    async refresh(value) {
      const entry = find('refreshes', value);
      if (!entry.comparisonSha256) return structuredClone(entry);
      const result = await comparison(entry), decision = await retainedDecision(entry, true);
      let selection = null, selectionError = null;
      try { selection = await inspectProjection(entry, decision?.intent.selection ?? {}); }
      catch (error) { selectionError = { code: error.code ?? 'CKAN_REFRESH_SELECTION_INVALID', message: error.message }; }
      return { ...structuredClone(entry), comparison: result.comparison, selection,
        selectionError, review: decision, decisionPending: Boolean(decision && !FINAL.has(entry.state)) };
    },
    async previewRefresh(value, input = {}) {
      const entry = find('refreshes', value);
      expected(input.expectedComparisonSha256, entry.comparisonSha256, 'CKAN_REFRESH_COMPARISON_CHANGED');
      await comparison(entry);
      return { refreshId: entry.id, comparisonSha256: entry.comparisonSha256, ...await inspectProjection(entry, input) };
    },
    async refreshChanges(value, input = {}) {
      const entry = find('refreshes', value);
      expected(input.expectedComparisonSha256, entry.comparisonSha256, 'CKAN_REFRESH_COMPARISON_CHANGED');
      return readCkanRefreshChanges({ directory: root(entry.id), expectedSha256: entry.comparisonSha256,
        offset: input.offset ?? 0, limit: input.limit ?? 50 });
    },
    async refreshChangesFile(value, expectedComparisonSha256) {
      const entry = find('refreshes', value);
      expected(expectedComparisonSha256, entry.comparisonSha256, 'CKAN_REFRESH_COMPARISON_CHANGED');
      return ckanRefreshChangeFile({ directory: root(entry.id), expectedSha256: entry.comparisonSha256 });
    },
    reviewRefresh(value, input) {
      return launch('review retained refresh', async () => {
        const entry = find('refreshes', value);
        expected(input.expectedComparisonSha256, entry.comparisonSha256, 'CKAN_REFRESH_COMPARISON_CHANGED');
        await comparison(entry);
        if (!['accept', 'keep-current', 'withdraw-source'].includes(input.decision))
          throw fault('CKAN_REFRESH_DECISION_INVALID', 'Accept the selected refresh, keep the current source, or withdraw it from future publication.');
        const intent = { refreshId: entry.id, comparisonSha256: entry.comparisonSha256,
          sourceId: entry.sourceId, sourceSha256: entry.sourceSha256,
          afterEditionId: entry.afterEditionId, afterCaptureSha256: entry.afterCaptureSha256,
          decision: input.decision, reviewer: requiredText(input.reviewer, 'the operator name', 128),
          note: requiredText(input.note, 'the source, terms and change review note') };
        if (input.decision === 'accept') {
          const preview = await inspectProjection(entry, input);
          expected(input.expectedProjectionSha256, preview.projectionSha256, 'CKAN_REFRESH_SELECTION_CHANGED');
          if (input.expectedSemanticsSha256 !== (preview.semanticReview?.sha256 ?? null) ||
              input.expectedDefinitionSha256 !== (preview.semanticReview?.definitionSha256 ?? null))
            throw fault('CKAN_REFRESH_SEMANTIC_REVIEW_CHANGED', 'Preview the complete selected field meanings and use their exact identities.', 409);
          intent.acceptedSourceId = entry.nextSourceId;
          intent.selection = { title: preview.title, query: preview.query, projection: preview.projection,
            projectionSha256: preview.projectionSha256, semanticReview: preview.semanticReview };
        }
        let record = await retainedDecision(entry, true);
        if (record && identity(record.intent) !== identity(intent))
          throw fault('CKAN_REFRESH_DECISION_RECORDED', 'This refresh already has a saved decision. Prepare another refresh for a different decision.', 409);
        if (!record) {
          const value = { schema: 'stellar-forge.ckan-refresh-decision.v1', createdAt: stamp(), intent }, raw = bytes(value);
          await atomicJson(root(entry.id), 'decision.json', value);
          record = { ...value, sha256: digest(raw) };
        }
        return applyDecision(entry, record);
      });
    },
    async assertRefreshPublicationSource(source) {
      // A withdrawal is durable when decision.json is saved, even if the
      // process ends before its source/workbench projection is persisted.
      if (!source.withdrawal) {
        for (const entry of state.refreshes) {
          if (entry.sourceId !== source.id || !entry.comparisonSha256) continue;
          const decision = await retainedDecision(entry, true);
          if (decision?.intent.decision !== 'withdraw-source') continue;
          await comparison(entry);
          await applyDecision(entry, decision);
          break;
        }
      }
      if (source.withdrawal) throw fault('CKAN_SOURCE_WITHDRAWN',
        'This selection was withdrawn from future publication. Review a refresh to select its successor.', 409);
      if (!source.refreshId) return;
      const entry = find('refreshes', source.refreshId);
      if (entry.state !== 'ACCEPTED' || entry.acceptedSourceId !== source.id ||
          entry.decisionSha256 !== source.refreshDecisionSha256)
        throw fault('CKAN_REFRESH_DECISION_PENDING', 'Resume the saved refresh decision before preparing its accepted source.', 409);
      await comparison(entry);
      const record = await retainedDecision(entry);
      if (record.intent.decision !== 'accept' || record.intent.acceptedSourceId !== source.id ||
          record.intent.selection.projectionSha256 !== identity({ query: source.query, projection: source.projection }) ||
          identity(record.intent.selection.semanticReview) !== identity(source.semanticReview ?? null))
        throw fault('CKAN_REFRESH_DECISION_CHANGED');
    },
  };
}
