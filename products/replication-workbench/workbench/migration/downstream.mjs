// SPDX-License-Identifier: MIT
import {
  canonical, copy, isObject, nonempty, objectDigest, relation, requireValue, sha256, verifyDocumentDigest,
} from './common.mjs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { mkdir, open, readFile, realpath, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { acquireWorkspaceLease, privateDirectory } from '../vendor/stellar-expert/store.mjs';

function sourceFiles(files) {
  requireValue(isObject(files), 'invalid_consumer_files', 'Provide selected consumer files as a path-to-UTF-8-text object.');
  return Object.entries(files).map(([path, content]) => {
    nonempty(path, 'consumer path');
    requireValue(typeof content === 'string' && !content.includes('\u0000') && Buffer.from(content, 'utf8').toString('utf8') === content, 'invalid_consumer_text',
      'Consumer edits require complete UTF-8 text.', { path });
    return { path, content, sha256: sha256(content) };
  });
}
function occurrences(content, find) {
  const values = [];
  for (let at = content.indexOf(find); at >= 0; at = content.indexOf(find, at + find.length)) values.push(at);
  return values;
}
function position(content, offset) {
  const before = content.slice(0, offset), last = before.lastIndexOf('\n');
  const end = content.indexOf('\n', offset);
  return { line: before.split('\n').length, column: offset - last,
    lineText: content.slice(last + 1, end < 0 ? content.length : end) };
}

/** Inventory exact references in the selected, complete consumer files. */
export function inventoryDownstream(plan, files) {
  verifyDocumentDigest(plan, 'planId');
  requireValue(plan?.schema === 'slingdata.migration-plan.v1', 'invalid_plan', 'Select a migration plan.');
  const dialect = plan.bindings.targetDialect;
  const inventory = sourceFiles(files).map(file => {
    const metadata = [];
    for (const match of file.content.matchAll(/\b_airbyte_[A-Za-z0-9_]*\b/g)) {
      metadata.push({ name: match[0], offset: match.index, ...position(file.content, match.index) });
    }
    const references = [];
    for (const stream of plan.selectedStreams) {
      const forms = [...new Set([
        relation(stream.previousRelation, dialect), stream.previousRelation.join('.'),
      ])];
      for (const spelling of forms) for (const offset of occurrences(file.content, spelling)) {
        references.push({
          streamId: stream.id, spelling, offset, ...position(file.content, offset),
          selectedReplacement: relation(stream.parallelRelation, dialect),
        });
      }
    }
    return { path: file.path, sha256: file.sha256, bytes: Buffer.byteLength(file.content, 'utf8'),
      metadataReferences: metadata, relationReferences: references };
  });
  return { schema: 'slingdata.downstream-inventory.v1', migrationPlanId: plan.planId,
    files: inventory, metadataReferenceCount: inventory.reduce((sum, file) => sum + file.metadataReferences.length, 0),
    relationReferenceCount: inventory.reduce((sum, file) => sum + file.relationReferences.length, 0) };
}

/**
 * Prepare complete reversible consumer-file edits.
 * edits: [{path, find, replace, expectedOccurrences, reason}]
 * A draft can be prepared before native comparison; readiness follows that exact comparison.
 */
export function planDownstreamChanges(plan, comparison, files, edits, options = {}) {
  verifyDocumentDigest(plan, 'planId');
  if (comparison != null) verifyDocumentDigest(comparison, 'comparisonId');
  requireValue(plan?.schema === 'slingdata.migration-plan.v1', 'invalid_plan', 'Select a migration plan.');
  if (comparison != null) requireValue(comparison.schema === 'slingdata.migration-comparison.v1' &&
    comparison.planId === plan.planId, 'comparison_plan_mismatch', 'Use the comparison for this exact migration plan.');
  requireValue(Array.isArray(edits), 'invalid_consumer_edits', 'Provide the complete selected literal edits.');
  const before = new Map(sourceFiles(files).map(file => [file.path, file]));
  const staged = new Map(), selected = new Map();
  for (const [index, edit] of edits.entries()) {
    requireValue(isObject(edit), 'invalid_consumer_edit', 'Every edit must be an object.', { index });
    nonempty(edit.path, 'edit.path');
    requireValue(before.has(edit.path), 'consumer_file_missing', 'Retain the complete current file before selecting its edits.', { path: edit.path });
    requireValue(typeof edit.find === 'string' && edit.find.length > 0 && typeof edit.replace === 'string',
      'invalid_literal_replacement', 'Select nonempty literal source text and replacement text.', { path: edit.path });
    nonempty(edit.reason, 'edit.reason');
    requireValue(Number.isSafeInteger(edit.expectedOccurrences) && edit.expectedOccurrences > 0,
      'invalid_replacement_count', 'Declare the exact positive number of occurrences selected for this edit.', { path: edit.path });
    const current = staged.get(edit.path) ?? before.get(edit.path).content;
    const offsets = occurrences(current, edit.find);
    requireValue(offsets.length === edit.expectedOccurrences, 'replacement_count_changed',
      'The selected current text does not have the declared occurrence count.', {
        path: edit.path, expected: edit.expectedOccurrences, actual: offsets.length,
      });
    const next = current.split(edit.find).join(edit.replace);
    requireValue(current !== next, 'empty_consumer_change', 'Each selected edit must change its file.', { path: edit.path });
    staged.set(edit.path, next);
    const list = selected.get(edit.path) ?? [];
    list.push({ find: edit.find, replace: edit.replace, occurrences: offsets.length, reason: edit.reason });
    selected.set(edit.path, list);
  }
  const changes = [...staged.entries()].map(([path, content]) => ({
    path, before: { content: before.get(path).content, sha256: before.get(path).sha256 },
    after: { content, sha256: sha256(content) }, edits: selected.get(path),
  })).filter(change => change.before.sha256 !== change.after.sha256);
  const changePlan = {
    schema: 'slingdata.downstream-change-plan.v1',
    migrationPlanId: plan.planId,
    comparisonId: comparison?.comparisonId ?? null,
    readyForApply: plan.ready === true && comparison?.readyForCutover === true && changes.length > 0,
    reason: options.reason == null ? '' : String(options.reason),
    inventory: inventoryDownstream(plan, files),
    changes,
    rollback: { method: 'restore-exact-preimages', preservesPreviousData: true, preservesParallelData: true },
  };
  changePlan.changePlanId = objectDigest(changePlan);
  return changePlan;
}
function validateChangePlan(plan) {
  requireValue(plan?.schema === 'slingdata.downstream-change-plan.v1' && Array.isArray(plan.changes),
    'invalid_change_plan', 'Select a complete downstream change plan.');
  const { changePlanId, ...body } = plan;
  requireValue(typeof changePlanId === 'string' && objectDigest(body) === changePlanId,
    'change_plan_changed', 'The downstream plan no longer matches its selected edition.');
  for (const change of plan.changes) {
    requireValue(typeof change.before?.content === 'string' && typeof change.after?.content === 'string' &&
      sha256(change.before.content) === change.before.sha256 && sha256(change.after.content) === change.after.sha256,
      'change_content_changed', 'The retained before/after file contents do not match their digests.', { path: change.path });
  }
}
function selectedPath(root, path) {
  requireValue(typeof path === 'string' && path.length > 0 && !isAbsolute(path),
    'consumer_path', 'Select each consumer path relative to its working directory.', { path });
  const full = resolve(root, path), rel = relative(root, full);
  requireValue(rel !== '' && rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel),
    'consumer_path', 'The selected consumer path must be within its working directory.', { path });
  return full;
}
async function atomicJSON(path, value) {
  const temp = path + '.' + randomUUID() + '.tmp';
  await writeFile(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  await rename(temp, path);
}
async function currentFile(root, change) {
  const path = selectedPath(root, change.path);
  const actual = await realpath(path);
  requireValue(actual === path, 'consumer_symlink', 'Select the actual consumer file rather than a symbolic link.', { path: change.path });
  const info = await stat(path);
  requireValue(info.isFile(), 'consumer_not_file', 'The selected consumer path is not a regular file.', { path: change.path });
  const bytes = await readFile(path);
  const content = bytes.toString('utf8');
  requireValue(Buffer.from(content, 'utf8').equals(bytes), 'consumer_invalid_utf8',
    'The selected consumer must contain complete UTF-8 text.', { path: change.path });
  return { path, content, sha256: sha256(content), bytes: bytes.length, mode: info.mode & 0o777 };
}
async function replaceCurrent(root, change, from, to, assertOwnership) {
  assertOwnership();
  const current = await currentFile(root, change);
  requireValue(current.sha256 === from.sha256, 'consumer_changed',
    'A consumer changed after the selected edition; preserve it and prepare a new file selection.', { path: change.path });
  const temporary = current.path + '.sling-' + randomUUID() + '.tmp';
  let created = false;
  try {
    const handle = await open(temporary, 'wx', current.mode); created = true;
    try { await handle.writeFile(to.content, 'utf8'); await handle.sync(); } finally { await handle.close(); }
    const latest = await currentFile(root, change);
    requireValue(latest.sha256 === from.sha256, 'consumer_changed',
      'A consumer changed while its replacement was being written.', { path: change.path });
    assertOwnership();
    await rename(temporary, current.path); created = false;
    const received = await currentFile(root, change);
    requireValue(received.sha256 === to.sha256, 'consumer_write_changed', 'The saved consumer differs from the selected replacement.', { path: change.path });
    return received.sha256;
  } finally {
    if (created) await unlink(temporary).catch(() => {});
  }
}
async function observeSelectedCurrent(root, plan, selectedName, assertOwnership) {
  const files = [];
  for (const change of plan.changes) {
    assertOwnership();
    const expectedSha256 = change[selectedName].sha256;
    try {
      const current = await currentFile(root, change);
      files.push({ path: change.path, expectedSha256, actualSha256: current.sha256,
        bytes: current.bytes, state: current.sha256 === expectedSha256 ? 'selected' : 'changed' });
    } catch (error) {
      files.push({ path: change.path, expectedSha256, actualSha256: null, bytes: null,
        state: 'unavailable', error: { code: error.code || 'consumer_read_failed', message: error.message } });
    }
  }
  assertOwnership();
  return { observedAt: new Date().toISOString(), selectedEdition: selectedName,
    matchesSelected: files.every(file => file.state === 'selected'), files };
}
async function executeChanges(rootValue, plan, direction, options = {}) {
  validateChangePlan(plan);
  requireValue(direction === 'restore' || plan.readyForApply, 'comparison_required',
    'Apply the selected consumer change after its complete native comparison is ready.');
  const root = await realpath(resolve(rootValue));
  const fromName = direction === 'restore' ? 'after' : 'before';
  const toName = direction === 'restore' ? 'before' : 'after';
  const journalBase = resolve(root, '.sling-migration');
  await privateDirectory(journalBase, { create: true });
  const journalDirectory = resolve(journalBase, plan.changePlanId);
  await privateDirectory(journalDirectory, { create: true });
  // All selected plans for this consumer root share the original kernel lifetime lease.
  // Per-plan journals remain separate. The lease dies with its helper process.
  const operation = options.operationId == null ? randomUUID() : nonempty(options.operationId, 'operationId');
  const lease = await acquireWorkspaceLease(resolve(journalBase, 'consumer.lock'));
  const startedAt = new Date().toISOString();
  const journalPath = resolve(journalDirectory, direction + '-' + sha256(operation) + '.json');
  const journal = {
    schema: 'slingdata.downstream-operation.v1', operation, changePlanId: plan.changePlanId,
    migrationPlanId: plan.migrationPlanId, comparisonId: plan.comparisonId, direction,
    startedAt, state: 'preparing', files: [], recovery: [],
  };
  const changed = [];
  let journalSelected = false;
  try {
    lease.assert();
    let previous = null;
    try { previous = JSON.parse(await readFile(journalPath, 'utf8')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (previous != null) {
      requireValue(previous.schema === journal.schema && previous.operation === operation &&
        previous.changePlanId === plan.changePlanId && previous.migrationPlanId === plan.migrationPlanId &&
        previous.comparisonId === plan.comparisonId && previous.direction === direction,
        'operation_selection_changed', 'The original operation belongs to a different selected change.', { journalPath });
      if (previous.state === 'complete') {
        // The saved completion describes the original write. Observe today's files
        // separately so a lost acknowledgement cannot certify a later edit.
        const current = await observeSelectedCurrent(root, plan, toName, () => lease.assert());
        return { ...previous, journalPath, replayed: true, current };
      }
      journal.earlierAttempts = [
        ...(previous.earlierAttempts || []),
        { startedAt: previous.startedAt, completedAt: previous.completedAt ?? null,
          state: previous.state, files: previous.files || [], recovery: previous.recovery || [],
          error: previous.error ?? null },
      ];
    }
    journalSelected = true;
    const planPath = resolve(journalDirectory, 'change-plan.json');
    try { await writeFile(planPath, JSON.stringify(plan, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const retained = JSON.parse(await readFile(planPath, 'utf8'));
      requireValue(canonical(retained) === canonical(plan), 'retained_change_plan_changed', 'The retained original change plan differs.');
    }
    for (const change of plan.changes) {
      lease.assert();
      const current = await currentFile(root, change);
      requireValue([change[fromName].sha256, change[toName].sha256].includes(current.sha256), 'consumer_changed',
        'A current consumer differs from both retained editions; preserve it and prepare a new selection.', { path: change.path });
      journal.files.push({ path: change.path, state: current.sha256 === change[toName].sha256 ? 'already-complete' : 'pending',
        before: current.sha256, selected: change[toName].sha256 });
    }
    journal.state = 'writing';
    await atomicJSON(journalPath, journal);
    for (let index = 0; index < plan.changes.length; index += 1) {
      if (journal.files[index].state === 'already-complete') continue;
      const change = plan.changes[index];
      lease.assert();
      await replaceCurrent(root, change, change[fromName], change[toName], () => lease.assert());
      changed.push(change);
      journal.files[index].state = 'complete';
      await atomicJSON(journalPath, journal);
    }
    journal.state = 'complete'; journal.completedAt = new Date().toISOString();
    await atomicJSON(journalPath, journal);
    const current = await observeSelectedCurrent(root, plan, toName, () => lease.assert());
    return { ...journal, journalPath, replayed: false, current };
  } catch (error) {
    for (const change of changed.reverse()) {
      try {
        lease.assert();
        await replaceCurrent(root, change, change[toName], change[fromName], () => lease.assert());
        journal.recovery.push({ path: change.path, state: 'restored-before-this-operation' });
      } catch (restoreError) {
        journal.recovery.push({ path: change.path, state: 'preserved-current-file',
          code: restoreError.code || 'restore_failed', message: restoreError.message });
      }
    }
    journal.state = 'failed'; journal.completedAt = new Date().toISOString();
    journal.error = { code: error.code || 'consumer_operation_failed', message: error.message, details: error.details || {} };
    if (journalSelected) await atomicJSON(journalPath, journal);
    error.details = { ...(error.details || {}), journalPath, recovery: journal.recovery };
    throw error;
  } finally {
    await lease.close();
  }
}

/** Apply the actual selected downstream files; the full original files remain retained. */
export async function applyDownstreamChanges(root, plan, options = {}) { return executeChanges(root, plan, 'apply', options); }
/** Restore the original selected downstream files while retaining both data targets. */
export async function restoreDownstreamChanges(root, plan, options = {}) { return executeChanges(root, plan, 'restore', options); }
