#!/usr/bin/env node
// MIT. One real closed-project transfer and original merchant receiving continuation.
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openCkanWorkbench } from '../model.mjs';
import { inspectCkanWorkspaceArchive, receiveCkanWorkspaceArchive } from '../archive.mjs';
import { readCkanSourceFile } from '../declaration.mjs';
import { startCkanServer } from '../server.mjs';
import { openCkanPublisher } from '../publisher/model.mjs';
import { openDatasetVersions } from '../../dataset-refresh/versions.mjs';
import { inspectReleaseInstallation, readReleaseState, runActiveRelease } from '../../../sf82-seller-pilot/releases.mjs';
import { bytes, digest, readPrivate, readJson, atomicJson, createFile, privateDirectory } from '../../postgres/publisher/files.mjs';

const insist = (value, message) => { if (!value) throw new Error(message); };
async function finished(operation) {
  const result = await operation.completion;
  insist(result.state === 'COMPLETE', result.error?.message ?? result.error?.code ?? 'Native operation incomplete.');
  return result.result;
}
export async function runWorkspaceTransfer({ project, received, out }) {
  project = resolve(project); received = resolve(received); out = resolve(out);
  insist(project !== received && project !== out && received !== out, 'Use separate original, receiving, and output directories.');
  await privateDirectory(dirname(out)); await mkdir(out, { mode: 0o700, recursive: true }); await privateDirectory(out);
  const resultFile = join(out, 'receiving.json');
  let record;
  try { record = await readJson(resultFile, 33554432); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (record) {
    insist(record.original === project && record.received === received, 'Resume the original receiving directories.');
    if (record.state === 'COMPLETE') return record;
  } else record = { schema: 'stellar-forge.ckan-workspace-transfer-example.v1',
    original: project, received, state: 'RUNNING', startedAt: new Date().toISOString(), steps: [] };
  record.state = 'RUNNING'; delete record.error;
  const save = () => atomicJson(out, 'receiving.json', record);
  const note = async (name, value) => { record.steps.push({ name, at: new Date().toISOString(), ...value }); await save(); };
  await save();
  let original, workbench, merchant, web;
  try {
    if (!record.archive) {
      original = await openCkanWorkbench({ directory: project });
      const before = original.status(), source = before.sources.find(item => item.semanticReview);
      const publication = before.publications.find(item => item.sourceId === source?.id && item.state === 'PUBLISHED');
      const product = before.exports.find(item => item.publicationId === publication?.id && item.staged);
      insist(source && publication && product, 'Use the existing reviewed, published CKAN merchant project.');
      const edition = await original.edition(source.editionId);
      record.selected = { sourceId: source.id, editionId: source.editionId, publicationId: publication.id,
        exportId: product.id, rows: edition.rowCount, sourceSha256: source.sha256,
        semanticReview: source.semanticReview, manifestSha256: product.manifestSha256,
        snapshot: product.dataset.snapshot };
      record.originalPublicationIds = before.publications.map(item => item.id);
      record.originalCounts = { editions: before.editions.length, sources: before.sources.length,
        publications: before.publications.length, exports: before.exports.length, buyers: before.buyerRequests.length };
      record.archive = await finished(original.archiveWorkspace({ out: join(out, 'publisher-workspace.ckanw') }));
      await original.close(); original = null;
      await note('original complete archive', { archive: record.archive });
    }
    if (!record.inspection) {
      const inspected = await inspectCkanWorkspaceArchive({ file: record.archive.file, expectedSha256: record.archive.sha256 });
      insist(inspected.source.sources.some(item => item.id === record.selected.sourceId && item.sha256 === record.selected.sourceSha256),
        'The archive must preserve the selected source identity.');
      record.inspection = { sha256: inspected.sha256, manifestSha256: inspected.manifestSha256,
        files: inspected.files, unpackedBytes: inspected.unpackedBytes };
      await note('archive byte verification', record.inspection);
    }
    if (!record.receiving) {
      record.receiving = await receiveCkanWorkspaceArchive({ file: record.archive.file, directory: received,
        expectedSha256: record.archive.sha256 });
      await note('complete project received', { directory: received, files: record.receiving.files,
        installed: record.receiving.installed.map(item => ({ id: item.id, digest: item.digest })) });
    }
    workbench = await openCkanWorkbench({ directory: received });
    const state = workbench.status(), selected = record.selected;
    insist(state.editions.length === record.originalCounts.editions && state.sources.length === record.originalCounts.sources &&
      state.exports.length === record.originalCounts.exports && state.buyerRequests.length >= record.originalCounts.buyers,
    'Original retained editions, selections, products, and buyer requests must survive.');
    const source = state.sources.find(item => item.id === selected.sourceId);
    const parsed = await readCkanSourceFile(source.file);
    insist(parsed.hash === selected.sourceSha256 &&
      parsed.captureFile === join(received, 'editions', selected.editionId, 'capture.json'),
    'The original source bytes must select the received capture.');
    const meanings = await workbench.sourceSemantics(selected.sourceId);
    insist(meanings.sha256 === selected.semanticReview.sha256 &&
      meanings.definitionSha256 === selected.semanticReview.definitionSha256, 'Semantic review changed.');
    const view = await workbench.publication(selected.publicationId, 'limit=5');
    insist(view.run.state === 'PUBLISHED' && view.detail.preview.dataset.rowCount === selected.rows &&
      view.detail.preview.rows.length === Math.min(5, selected.rows), 'Original publication query differs after receive.');
    if (!record.retained) {
      const publisher = await openCkanPublisher({ directory: join(received, 'publications', selected.publicationId) });
      try {
        const history = publisher.status({ limit: 100 });
        record.retained = { sourceSha256: parsed.hash, captureFile: parsed.captureFile,
          semanticReview: selected.semanticReview, candidateDigest: view.run.data.candidate.candidateDigest,
          previewRows: view.detail.preview.rows.length, history: history.pages,
          plans: history.plans.map(item => ({ id: item.id, digest: item.data.digest })),
          events: history.history };
      } finally { await publisher.close(); }
      await note('source and original publisher history reopened', record.retained);
    }
    if (!record.versions) {
      const versions = await openDatasetVersions({ directory: join(received, 'datasets', selected.publicationId), collectOnOpen: false });
      try {
        const page = await versions.handle({ query: new URLSearchParams('limit=5') });
        insist(page.status === 200 && versions.status().current === selected.snapshot, 'Original version store differs.');
        record.versions = { status: versions.status(), preview: page.body };
      } finally { await versions.close(); }
      await note('original dataset versions reopened', { snapshot: record.versions.status.current, revision: record.versions.status.revision });
    }
    // Complete a new publication using the unchanged saved source at its new
    // location. The received copy owns this continuation and its existing journal.
    if (!record.continuation) {
      const policy = view.detail.plan.data;
      const prior = workbench.status().publications.find(item => !record.originalPublicationIds.includes(item.id) && item.sourceId === source.id);
      let candidate = prior;
      if (!candidate) candidate = await finished(workbench.createPublication(source.id, {
        filters: policy.dataset.filters, ranges: policy.dataset.ranges, sorts: policy.dataset.sorts,
        defaultLimit: policy.dataset.defaultLimit, maxLimit: policy.dataset.maxLimit,
        order: policy.extraction.order, maxRows: policy.extraction.maxRows,
        maxBytes: policy.extraction.maxBytes, timeoutMs: policy.extraction.timeoutMs }));
      let current = await workbench.publication(candidate.id, 'limit=5');
      if (current.run.state === 'READY') {
        await finished(workbench.reviewPublication(candidate.id, { expectedCandidateDigest: current.run.data.candidate.candidateDigest,
          reviewer: 'Workspace receiving operator', note: 'Continue the unchanged reviewed source from its received capture and original typed dataset contract.' }));
        current = await workbench.publication(candidate.id, 'limit=5');
      }
      if (current.run.state === 'REVIEWED') await finished(workbench.publishDataset(candidate.id, current.run.data.review.id));
      current = await workbench.publication(candidate.id, 'limit=5');
      insist(current.run.state === 'PUBLISHED' && current.detail.preview.dataset.rowCount === selected.rows,
        'Received source did not complete its original publication lifecycle.');
      record.continuation = { publicationId: candidate.id, runId: current.run.id,
        candidateDigest: current.run.data.candidate.candidateDigest, state: current.run.state,
        snapshot: current.detail.preview.dataset.snapshot };
      await note('received source prepared reviewed and published', record.continuation);
    }
    const store = join(received, 'seller-releases'), releases = await readReleaseState(store);
    insist(releases.active, 'The archived original active seller selection is required.');
    const installed = await inspectReleaseInstallation(store, releases.active);
    insist(installed.installation && installed.effectiveRuntime.handlers.startsWith(store + '/ckan-packages/'),
      'The original release must resolve its received handler package.');
    if (!record.seller) {
      merchant = await runActiveRelease(store, { expectedGeneration: releases.generation, handleSignals: false });
      insist(merchant.release.digest === installed.release.digest, 'Starting the installed seller changed its saved release identity.');
      const product = state.exports.find(item => item.id === selected.exportId);
      const request = new URL(product.resource);
      request.searchParams.set('limit', '5'); request.searchParams.set('snapshot', selected.snapshot);
      request.searchParams.set('semantics', selected.semanticReview.sha256);
      const response = await fetch(merchant.url + request.pathname + request.search);
      const raw = Buffer.from(await response.arrayBuffer());
      insist(response.status === 402, 'The actual installed original seller must issue its native challenge.');
      const offer = await workbench.buyerOffer(selected.exportId, { seller: merchant.url, query: 'limit=5' });
      const intentId = 'ckan-workspace-receive-' + record.archive.sha256.slice(0, 20);
      const retainedBuyer = workbench.status().buyerRequests.find(item => item.exportId === selected.exportId &&
        typeof item.configText === 'string' && item.configText.includes(JSON.stringify(intentId)));
      const buyer = retainedBuyer ?? await finished(workbench.prepareBuyer(selected.exportId, { seller: merchant.url, query: 'limit=5',
        intentId, acceptIndex: 0, offerSha256: offer.offerSha256 }));
      record.seller = { releaseId: merchant.release.id, releaseDigest: merchant.release.digest,
        listener: merchant.url, status: response.status, responseSha256: digest(raw),
        offerSha256: offer.offerSha256, buyerId: buyer.id, buyerConfigSha256: buyer.configSha256,
        snapshot: offer.snapshot, semantics: offer.semantics };
      const buyerFile = join(out, 'buyer-config.json');
      let priorBuyer;
      try { priorBuyer = await readPrivate(buyerFile, 1048576); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (priorBuyer) insist(digest(priorBuyer) === digest(Buffer.from(buyer.configText)), 'Retained buyer configuration differs.');
      else await createFile(buyerFile, Buffer.from(buyer.configText));
      await note('original installed seller challenge and buyer preparation', record.seller);
      await merchant.close(); merchant = null;
    }
    if (!record.web) {
      web = await startCkanServer({ workbench, port: 0 });
      const get = async path => {
        const response = await fetch(web.origin + path, { headers: { authorization: 'Bearer ' + web.token } });
        insist(response.status === 200, 'Original operator route failed: ' + path);
        return response;
      };
      const launch = await (await get('/api/launch')).json();
      insist(launch.directory === received, 'The original managed listener points at another project.');
      const dictionary = await (await get('/api/sources/' + selected.sourceId + '/semantics')).json();
      insist(dictionary.sha256 === selected.semanticReview.sha256, 'Original UI dictionary identity changed.');
      const rawSource = Buffer.from(await (await get('/api/sources/' + selected.sourceId + '/download')).arrayBuffer());
      insist(digest(rawSource) === selected.sourceSha256, 'Original UI source download changed.');
      const html = await (await get('/')).text(), ui = await (await get('/app.mjs')).text();
      insist(html.includes('data-tab="workspace"') && ui.includes('renderWorkspace'), 'Workspace transfer interface is missing.');
      record.web = { instanceId: launch.instanceId, directory: launch.directory, sourceSha256: digest(rawSource),
        semanticSha256: dictionary.sha256, workspaceSection: true };
      await note('original authenticated operator and downloads', record.web);
      await web.close(); web = null;
    }
    await workbench.close(); workbench = null;
    const reopened = await openCkanWorkbench({ directory: received });
    try {
      const meaning = await reopened.sourceSemantics(selected.sourceId);
      const continued = await reopened.publication(record.continuation.publicationId, 'limit=5');
      insist(meaning.sha256 === selected.semanticReview.sha256 && continued.run.state === 'PUBLISHED',
        'Received source or completed continuation did not reopen.');
      const replay = await receiveCkanWorkspaceArchive({ file: record.archive.file, directory: received,
        expectedSha256: record.archive.sha256 }).catch(error => {
          if (error.code === 'PUBLISHER_ALREADY_OPEN') return { owned: true }; throw error;
        });
      insist(replay.owned === true, 'Receive must respect the original live workspace owner.');
      record.reopen = { semanticSha256: meaning.sha256, publicationId: continued.id,
        state: continued.run.state, liveOwnerProtected: true };
    } finally { await reopened.close(); }
    const replay = await receiveCkanWorkspaceArchive({ file: record.archive.file, directory: received, expectedSha256: record.archive.sha256 });
    insist(replay.reused === true, 'The same completed receive should be reused.');
    record.state = 'COMPLETE'; record.completedAt = new Date().toISOString();
    await note('closed reopened and same receive retained', record.reopen);
    return record;
  } catch (error) {
    record.state = 'INTERRUPTED'; record.error = { code: error.code ?? 'WORKSPACE_RECEIVING_FAILED', message: error.message };
    await save(); throw error;
  } finally {
    await web?.close(); await merchant?.close(); await workbench?.close(); await original?.close();
  }
}
export async function main(argv = process.argv.slice(2)) {
  const input = {};
  for (let i = 0; i < argv.length; i += 2) {
    insist(['--project', '--received', '--out'].includes(argv[i]) && argv[i + 1], 'Use --project ORIGINAL --received NEW --out OUTPUT.');
    input[argv[i].slice(2)] = argv[i + 1];
  }
  insist(input.project && input.received && input.out, 'Use --project ORIGINAL --received NEW --out OUTPUT.');
  process.stdout.write(JSON.stringify(await runWorkspaceTransfer(input), null, 2) + '\n');
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href)
  main().catch(error => { process.stderr.write((error.code ?? 'WORKSPACE_RECEIVING_FAILED') + ': ' + error.message + '\n'); process.exitCode = 1; });
