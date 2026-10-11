// MIT. Retained CSV work only; the original dataset service owns publication.
import { mkdir, readdir, rename, rm, lstat, chmod } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { acquireWorkspace, privateDirectory, readPrivate, readJson, createFile,
  atomicJson, syncDirectory, bytes, digest, hashPrivate, fault } from '../postgres/publisher/files.mjs';

const SCHEMA = 'stellar-forge.dataset-publisher-workspace.v1';
const CANDIDATE = 'stellar-forge.dataset-publisher-candidate.v1';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const stamp = () => new Date().toISOString();
const copy = value => structuredClone(value);
const pending = record => ['PENDING', 'NEEDS_REVIEW'].includes(record.publications.at(-1)?.state);
const label = (value, maximum, required = false) => {
  if (typeof value !== 'string' || value.length > maximum || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value) || required && !value.trim())
    throw fault('INVALID_REVIEW_TEXT', `Enter ${required ? 'a name' : 'notes'} within ${maximum} characters.`);
  return value.trim();
};
const absent = async path => { try { await lstat(path); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; } };

function validateCandidate(record) {
  if (record?.schema !== CANDIDATE || !UUID.test(record.id ?? '') || !HASH.test(record.csvHash ?? '') ||
      !HASH.test(record.configHash ?? '') || !HASH.test(record.dataset?.snapshot ?? '') ||
      !Number.isSafeInteger(record.sourceBytes) || record.sourceBytes < 1 || record.sourceBytes > 256 * 1024 ** 2 ||
      !Number.isSafeInteger(record.revision) || record.revision < 1 || !Array.isArray(record.publications) ||
      !HASH.test(record.expectedSnapshot ?? '') || !Number.isSafeInteger(record.expectedRevision) || record.expectedRevision < 1)
    throw fault('SAVED_CANDIDATE_INVALID', 'The retained candidate metadata is invalid. Preserve its directory for repair.');
  label(record.name, 160, true); label(record.notes, 2000);
  return record;
}

function validateBuyer(record) {
  if (!UUID.test(record?.id ?? '') || !HASH.test(record.snapshot ?? '') || !HASH.test(record.configSha256 ?? '') ||
      !HASH.test(record.offerSha256 ?? '') || typeof record.intentId !== 'string' || record.intentId.length > 128 ||
      typeof record.query !== 'string' || record.query.length > 8192 || typeof record.createdAt !== 'string')
    throw fault('SAVED_BUYER_INVALID', 'The saved buyer metadata needs repair.');
  return record;
}

/** Uses the existing kernel-owned publisher lock and private atomic files.
 * No second seller/version store is opened, including during crash recovery. */
export async function openPublisherDrafts({ datasetDirectory, directory = join(datasetDirectory, '.publisher-workspace'),
  maxCandidates = 32, maxSourceBytes = 256 * 1024 * 1024 } = {}) {
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 256 ||
      !Number.isSafeInteger(maxSourceBytes) || maxSourceBytes < 1024 || maxSourceBytes > 4 * 1024 ** 3)
    throw fault('INVALID_DRAFT_CAPACITY', 'Choose 1–256 candidates and 1 KiB–4 GiB of retained CSV capacity.');
  if (directory === datasetDirectory || datasetDirectory.startsWith(directory + '/') ||
      directory.startsWith(join(datasetDirectory, 'versions') + '/') || directory === join(datasetDirectory, 'versions'))
    throw fault('SEPARATE_WORKSPACE_REQUIRED', 'Keep draft work outside the original published-version directories.');
  await privateDirectory(directory, true);
  const unlock = await acquireWorkspace(directory);
  let state, closed = false;
  const recoveryWarnings = [];
  const roots = { candidates: join(directory, 'candidates'), staging: join(directory, 'staging'), buyers: join(directory, 'buyers') };
  const indexPath = join(directory, 'workspace.json');
  try {
    if (await absent(indexPath)) {
      const existing = await readdir(directory);
      if (existing.some(name => name !== 'publisher.lock' && !(name.startsWith('.pending-') && UUID.test(name.slice(9)))))
        throw fault('WORKSPACE_METADATA_MISSING', 'This directory contains existing files without its workspace metadata. Use its original workspace or a new directory.');
      for (const name of existing) if (name.startsWith('.pending-') && UUID.test(name.slice(9))) {
        await readPrivate(join(directory, name), 8 * 1024 * 1024); await rm(join(directory, name));
      }
      state = { schema: SCHEMA, datasetDirectory, createdAt: stamp(), revision: 1,
        selectedDraftId: null, selection: null, candidates: [], buyers: [], removedCandidateIds: [], removedBuyerIds: [] };
      await atomicJson(directory, 'workspace.json', state);
    } else state = await readJson(indexPath, 8 * 1024 * 1024);
    if (state.schema !== SCHEMA || state.datasetDirectory !== datasetDirectory || !Number.isSafeInteger(state.revision) ||
        !Array.isArray(state.candidates) || !Array.isArray(state.buyers) || !Array.isArray(state.removedCandidateIds) ||
        !Array.isArray(state.removedBuyerIds) || state.removedCandidateIds.some(id => !UUID.test(id)) ||
        state.removedBuyerIds.some(id => !UUID.test(id)) || new Set(state.candidates.map(c => c.id)).size !== state.candidates.length ||
        new Set(state.buyers.map(item => item.id)).size !== state.buyers.length)
      throw fault('WORKSPACE_BINDING_CHANGED', 'Reopen this workspace against its original dataset state directory.');
    state.candidates.forEach(validateCandidate);
    state.buyers.forEach(validateBuyer);
    for (const path of Object.values(roots)) await privateDirectory(path, true);

    async function save(change) {
      if (closed) throw fault('WORKSPACE_CLOSED');
      const next = copy(state); change(next); next.revision++;
      if (bytes(next).length > 8 * 1024 * 1024)
        throw fault('WORKSPACE_METADATA_CAPACITY', 'Export and remove completed candidate work before saving more history.');
      await atomicJson(directory, 'workspace.json', next); state = next;
      return view();
    }
    function candidate(id) {
      const record = UUID.test(id ?? '') && state.candidates.find(value => value.id === id);
      if (!record) throw fault('DRAFT_NOT_FOUND', 'Choose a retained candidate from this workspace.', 404);
      return copy(record);
    }
    const sourceBytes = () => state.candidates.reduce((total, record) => total + record.sourceBytes, 0);
    function capacity(additional = 0) {
      if (state.candidates.length >= maxCandidates || sourceBytes() + additional > maxSourceBytes)
        throw fault('DRAFT_CAPACITY_REACHED', 'Download and remove a completed candidate, or reopen with more retained draft capacity.', 409);
      return Math.max(0, maxSourceBytes - sourceBytes());
    }
    function files(id) {
      if (!UUID.test(id ?? '')) throw fault('DRAFT_NOT_FOUND', 'Choose a retained candidate.', 404);
      const root = join(roots.candidates, id);
      return { directory: root, configPath: join(root, 'dataset.json'), csvPath: join(root, 'data.csv') };
    }
    function view() {
      return { schema: SCHEMA, revision: state.revision, createdAt: state.createdAt,
        selectedDraftId: state.selectedDraftId, selection: copy(state.selection),
        candidates: copy(state.candidates), buyers: copy(state.buyers),
        recoveryWarnings: copy(recoveryWarnings),
        capacity: { candidateCount: state.candidates.length, maxCandidates, sourceBytes: sourceBytes(), maxSourceBytes } };
    }

    // A completed upload renamed before its index commit is recovered once.
    // Partial upload directories belong to this kernel-locked workspace alone.
    for (const entry of await readdir(roots.candidates, { withFileTypes: true })) {
      if (!UUID.test(entry.name) || state.candidates.some(value => value.id === entry.name)) continue;
      if (state.removedCandidateIds.includes(entry.name)) {
        await rm(join(roots.candidates, entry.name), { recursive: true, force: true }); continue;
      }
      let recovered;
      try {
        await privateDirectory(join(roots.candidates, entry.name));
        recovered = validateCandidate(await readJson(join(roots.candidates, entry.name, 'candidate.json'), 262144));
        if (recovered.id !== entry.name) throw fault('SAVED_CANDIDATE_INVALID');
        const paths = files(entry.name), config = await readPrivate(paths.configPath, 65536);
        const csv = await hashPrivate(paths.csvPath, recovered.sourceBytes);
        if (digest(config) !== recovered.configHash || csv.hash !== recovered.csvHash || csv.bytes !== recovered.sourceBytes)
          throw fault('SAVED_CANDIDATE_CHANGED');
      } catch (error) { recoveryWarnings.push({ kind: 'Candidate', id: entry.name, code: error.code ?? 'SAVED_CANDIDATE_INVALID' }); continue; }
      await save(next => { next.candidates.push({ ...recovered, recoveredAt: stamp() });
        if (!next.selectedDraftId) next.selectedDraftId = recovered.id; });
    }
    for (const entry of await readdir(roots.staging)) {
      if (UUID.test(entry)) await rm(join(roots.staging, entry), { recursive: true, force: true });
    }
    for (const name of await readdir(roots.buyers)) {
      if (!name.endsWith('.metadata.json')) continue;
      const id = name.slice(0, -14);
      if (!UUID.test(id) || state.buyers.some(item => item.id === id)) continue;
      if (state.removedBuyerIds.includes(id)) {
        await rm(join(roots.buyers, id + '.json'), { force: true });
        await rm(join(roots.buyers, name), { force: true }); continue;
      }
      let record;
      try {
        record = validateBuyer(await readJson(join(roots.buyers, name), 16384));
        if (record.id !== id || digest(await readPrivate(join(roots.buyers, id + '.json'), 262144)) !== record.configSha256)
          throw fault('SAVED_BUYER_CHANGED');
      } catch (error) { recoveryWarnings.push({ kind: 'Buyer config', id, code: error.code ?? 'SAVED_BUYER_INVALID' }); continue; }
      await save(next => { next.buyers.push({ ...record, recoveredAt: stamp() }); });
    }

    return {
      directory, view, candidate, files, capacity,
      async stage() {
        capacity(); const id = randomUUID(), path = join(roots.staging, id);
        await mkdir(path, { mode: 0o700 }); return { id, directory: path };
      },
      async adopt(staged, record) {
        capacity(record.sourceBytes);
        const saved = validateCandidate({ ...record, schema: CANDIDATE, id: staged.id, revision: 1,
          name: label(record.filename, 160, true), notes: '', createdAt: stamp(), publications: [] });
        if (staged.directory !== join(roots.staging, staged.id)) throw fault('INVALID_UPLOAD_STAGE');
        await createFile(join(staged.directory, 'candidate.json'), bytes(saved));
        await chmod(join(staged.directory, 'data.csv'), 0o400);
        await chmod(join(staged.directory, 'dataset.json'), 0o400);
        await syncDirectory(staged.directory);
        await rename(staged.directory, files(staged.id).directory); await syncDirectory(roots.candidates);
        await save(next => { next.candidates.push(saved); next.selectedDraftId = saved.id;
          next.selection = { target: 'draft:' + saved.id, query: '', snapshot: saved.dataset.snapshot, savedAt: stamp() }; });
        return candidate(saved.id);
      },
      async select(id) {
        candidate(id); if (state.selectedDraftId !== id) await save(next => { next.selectedDraftId = id; });
        return candidate(id);
      },
      async update(id, patch, expectedDraftRevision) {
        const record = candidate(id);
        if (expectedDraftRevision !== undefined && record.revision !== expectedDraftRevision)
          throw fault('DRAFT_METADATA_CHANGED', 'Another review changed this candidate. Refresh before saving your edits.', 409);
        await save(next => { const position = next.candidates.findIndex(value => value.id === id);
          next.candidates[position] = validateCandidate({ ...record, ...patch, revision: record.revision + 1, updatedAt: stamp() }); });
        return candidate(id);
      },
      async metadata(id, name, notes, expectedDraftRevision) {
        if (!Number.isSafeInteger(expectedDraftRevision)) throw fault('DRAFT_REVIEW_REQUIRED');
        return this.update(id, { name: label(name, 160, true), notes: label(notes, 2000) }, expectedDraftRevision);
      },
      async selection(selection) {
        const query = new URLSearchParams(selection.query); query.delete('cursor');
        await save(next => { next.selection = { target: selection.target, query: query.toString(),
          snapshot: selection.snapshot, savedAt: stamp() }; });
      },
      async publication(id, event) {
        const record = candidate(id), publications = copy(record.publications);
        const position = publications.findIndex(value => value.id === event.id);
        if (position < 0) publications.push(event); else publications[position] = event;
        await save(next => {
          next.candidates[next.candidates.findIndex(value => value.id === id)] = {
            ...record, publications, revision: record.revision + 1, updatedAt: stamp() };
          if (['CONFIRMED', 'CURRENT_OBSERVED'].includes(event.state) && next.selectedDraftId === id) {
            const query = next.selection?.snapshot === record.dataset.snapshot ? next.selection.query : '';
            next.selectedDraftId = null; next.selection = { target: record.dataset.snapshot,
              query, snapshot: record.dataset.snapshot, savedAt: stamp() };
          }
        });
        return candidate(id);
      },
      async reconcile(observed) {
        for (const record of [...state.candidates]) {
          if (!pending(record) || observed.current !== record.dataset.snapshot) continue;
          const version = observed.versions.find(value => value.snapshot === observed.current);
          if (version?.configHash !== record.configHash || version.csvHash !== record.csvHash || version.sourceBytes !== record.sourceBytes) continue;
          const event = record.publications.at(-1);
          await this.publication(record.id, { ...event, state: 'CURRENT_OBSERVED', observedAt: stamp(),
            observed: { current: observed.current, revision: observed.revision } });
        }
      },
      async remove(id) {
        const record = candidate(id);
        if (pending(record)) throw fault('PUBLICATION_REVIEW_REQUIRED', 'Check the original publication result and review the candidate before removing it.', 409);
        await save(next => { next.candidates = next.candidates.filter(value => value.id !== id);
          next.removedCandidateIds.push(id);
          if (next.selectedDraftId === id) next.selectedDraftId = null;
          if (next.selection?.target === 'draft:' + id) next.selection = null; });
        await rm(files(id).directory, { recursive: true, force: true }); await syncDirectory(roots.candidates);
      },
      async csv(id) {
        const record = candidate(id), data = await readPrivate(files(id).csvPath, Math.max(maxSourceBytes, record.sourceBytes));
        if (data.length !== record.sourceBytes || digest(data) !== record.csvHash)
          throw fault('SAVED_CANDIDATE_CHANGED', 'The retained CSV no longer matches the saved candidate.', 409);
        return data;
      },
      async export(id) {
        const record = candidate(id), data = await readPrivate(files(id).configPath, 65536);
        if (digest(data) !== record.configHash) throw fault('SAVED_CANDIDATE_CHANGED', 'The saved schema differs from its original bytes.', 409);
        return { schema: 'stellar-forge.dataset-publisher-review.v1', exportedAt: stamp(),
          candidate: record, datasetConfig: JSON.parse(data.toString('utf8')),
          selection: state.selection?.target === 'draft:' + id ? copy(state.selection) : null };
      },
      async saveBuyer(prepared, input) {
        const configSha256 = digest(prepared.configText), prior = state.buyers.find(value => value.configSha256 === configSha256);
        if (prior) return copy(prior);
        if (state.buyers.length >= 256) throw fault('BUYER_HISTORY_CAPACITY', 'Export and remove a saved buyer config before preparing more.', 409);
        const record = validateBuyer({ id: randomUUID(), createdAt: stamp(), snapshot: prepared.snapshot, query: input.query,
          intentId: input.intentId, offerSha256: input.offerSha256, configSha256 });
        await createFile(join(roots.buyers, record.id + '.json'), Buffer.from(prepared.configText));
        await createFile(join(roots.buyers, record.id + '.metadata.json'), bytes(record));
        await syncDirectory(roots.buyers);
        await save(next => { next.buyers.push(record); }); return copy(record);
      },
      async buyer(id) {
        const record = UUID.test(id ?? '') && state.buyers.find(value => value.id === id);
        if (!record) throw fault('BUYER_CONFIG_NOT_FOUND', 'Choose a saved buyer configuration.', 404);
        const data = await readPrivate(join(roots.buyers, id + '.json'), 262144);
        if (digest(data) !== record.configSha256) throw fault('BUYER_CONFIG_CHANGED', 'The saved buyer file differs from its prepared bytes.', 409);
        return { record: copy(record), configText: data.toString('utf8') };
      },
      async removeBuyer(id) {
        await this.buyer(id);
        await save(next => { next.buyers = next.buyers.filter(value => value.id !== id); next.removedBuyerIds.push(id); });
        await rm(join(roots.buyers, id + '.json')); await rm(join(roots.buyers, id + '.metadata.json')); await syncDirectory(roots.buyers);
      },
      async close() { if (!closed) { closed = true; await unlock(); } },
    };
  } catch (error) { await unlock(); throw error; }
}

export const pendingDraftPublication = pending;
