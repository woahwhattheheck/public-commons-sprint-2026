// MIT. The migration application composes the maintained SF61/SF82 lifecycle.
import { readdir, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { readPackage, packageName } from '../workspace/model.mjs';
import { createRefreshReview, exportRefreshReview, verifyRefreshReview } from '../refresh-cli.mjs';
import { initReleaseStore, readReleaseState, listReleases, inspectRelease, compareReleases,
  stageRelease, activateRelease, rollbackRelease, releaseStatus, runActiveRelease } from '../../sf82-seller-pilot/releases.mjs';
import { canonical, sha256 } from './project-store.mjs';

export async function openMigrationReleases({ projects, origin, parentRuntime = () => ({ state: 'STOPPED' }) }) {
  const sessions = new Map();
  const owned = () => [...sessions].map(([projectId, session]) => ({ projectId, url: session.url, mode: session.mode, releaseId: session.release.id }));
  const root = id => join(projects.projectDirectory(id), 'releases');
  async function exists(id) {
    try { await lstat(root(id)); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
  }
  async function packages() {
    const entries = (await readdir(projects.merchantParent, { withFileTypes: true })).filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
    const result = [];
    for (const entry of entries) {
      try { const p = await readPackage(projects.merchantParent, entry.name); result.push({ name: p.name, title: p.manifest.preview.title, preview: p.manifest.preview, id: p.manifest.id }); }
      catch { /* Other private folders are not merchant packages. */ }
    }
    return result;
  }
  async function sourceReview({ projectId, baselineName, sourceRef, decisions = {} }) {
    await projects.get(projectId);
    const source = await projects.readSource(projectId, sourceRef);
    if (source.metadata.kind !== 'openapi') throw new TypeError('Choose the retained new-provider OpenAPI source.');
    const document = await createRefreshReview({ parent: projects.merchantParent, baselineName,
      candidateSpecText: new TextDecoder('utf-8', { fatal: true }).decode(source.body), decisions });
    return { document, sourceRef, sourceSha256: source.metadata.sha256, report: document.report };
  }
  async function saveReviewedPackage({ projectId, sourceReviewRef, reviewId, name }) {
    packageName(name);
    const retained = await projects.readJson(projectId, sourceReviewRef);
    if (retained.metadata.kind !== 'review') throw new TypeError('Choose a saved source review.');
    const document = retained.value.document;
    const report = verifyRefreshReview(document);
    if (report.reviewId !== reviewId) throw new TypeError('Source review identity changed. Reopen the retained review.');
    const source = await projects.readSource(projectId, retained.value.sourceRef);
    if (source.metadata.sha256 !== retained.value.sourceSha256 || source.body.toString('utf8') !== document.input.candidateSpecText)
      throw new TypeError('The source review no longer matches its retained provider description.');
    return exportRefreshReview({ parent: projects.merchantParent, document, reviewId, name });
  }
  async function status(projectId) {
    await projects.get(projectId);
    if (!await exists(projectId)) return { initialized: false, state: { generation: 0, active: null, previous: null }, releases: [], runtime: null };
    const [state, listing, runtime] = await Promise.all([readReleaseState(root(projectId)), listReleases(root(projectId)), releaseStatus(root(projectId))]);
    const local = sessions.get(projectId);
    return { initialized: true, state, ...listing, runtime, ownedRuntime: local ? { url: local.url, mode: local.mode, releaseId: local.release.id, instanceId: local.observation.instanceId } : null };
  }
  async function stage({ projectId, package: selectedPackage, id, label, runtime = { port: 0 } }) {
    await projects.get(projectId); packageName(selectedPackage);
    const merchant = await readPackage(projects.merchantParent, selectedPackage);
    if (!await exists(projectId)) await initReleaseStore(root(projectId));
    const staged = await stageRelease(root(projectId), { id, label, workspace: merchant.folder, runtime });
    return { staged, package: merchant.name, sourcePackageId: merchant.manifest.id, status: await status(projectId) };
  }
  async function diff({ projectId, to, from }) {
    await projects.get(projectId);
    const state = await readReleaseState(root(projectId));
    const report = await compareReleases(root(projectId), from === undefined ? state.active : from, to);
    const review = { projectId, generation: state.generation, report };
    return { ...review, reviewId: sha256(canonical(review)) };
  }
  async function select({ projectId, to, generation, reviewId, reason, rollback = false }) {
    const reviewed = await diff({ projectId, to });
    if (reviewed.generation !== generation || reviewed.reviewId !== reviewId) {
      const error = new Error('The release comparison changed. Reload the current difference before selecting a release.'); error.status = 409; throw error;
    }
    const options = { expectedGeneration: generation, reason };
    const result = rollback ? await rollbackRelease(root(projectId), { ...options, to }) : await activateRelease(root(projectId), to, options);
    return { result, status: await status(projectId) };
  }
  async function start({ projectId, generation }) {
    await projects.get(projectId);
    if (sessions.has(projectId)) throw new Error('This migration already owns a running seller. Open it or stop it first.');
    const parent = parentRuntime();
    if (parent?.state === 'RUNNING' || parent?.customer) throw new Error('Stop the merchant setup session before starting its migration release.');
    if (sessions.size) throw new Error('This workspace already owns a running migration seller. Open it or stop it before starting another.');
    const session = await runActiveRelease(root(projectId), { expectedGeneration: generation, handleSignals: false,
      ...(origin ? { operationsNavigationOrigin: typeof origin === 'function' ? origin() : origin } : {}) });
    sessions.set(projectId, session);
    session.completion.finally(() => { if (sessions.get(projectId) === session) sessions.delete(projectId); }).catch(() => {});
    return { url: session.url, mode: session.mode, release: session.release, status: await status(projectId) };
  }
  async function stop({ projectId }) {
    await projects.get(projectId);
    const session = sessions.get(projectId);
    if (!session) return { owned: false, status: await status(projectId) };
    const result = await session.close();
    if (sessions.get(projectId) === session) sessions.delete(projectId);
    return { owned: true, result, status: await status(projectId) };
  }
  async function close() {
    const results = await Promise.allSettled([...sessions.keys()].map(projectId => stop({ projectId })));
    const failures = results.filter(r => r.status === 'rejected').map(r => r.reason);
    if (failures.length) throw new AggregateError(failures, 'A migration seller did not finish stopping.');
  }
  return { packages, sourceReview, saveReviewedPackage, status, stage, diff, select, start, stop,
    inspect: (projectId, id) => inspectRelease(root(projectId), id), root, owned, close };
}
