#!/usr/bin/env node
// MIT. Complete reviewed refresh of a real retained CKAN publication.
import { dirname, join, resolve } from 'node:path';
import { createReadStream } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdir, readFile, lstat } from 'node:fs/promises';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { openCkanWorkbench } from '../model.mjs';
import { readCkanCapture, captureSelection } from '../capture.mjs';
import { inspectCkanWorkspaceArchive, receiveCkanWorkspaceArchive } from '../archive.mjs';
import { startCkanServer } from '../server.mjs';
import { atomicJson, privateDirectory, readJson, identity } from '../../postgres/publisher/files.mjs';
import { initReleaseStore } from '../../../sf82-seller-pilot/releases.mjs';
import { MCP_VERSION } from '../../../../../stellar-forge/mcp-paid-agent/http-tools.mjs';
import { startCkanAgentWorkspace } from '../../../../../stellar-forge/mcp-merchant-operator/ckan-workspace-launcher.mjs';
import { CKAN_WORKSPACE_CONNECTION_SCHEMA } from '../../../../../stellar-forge/mcp-merchant-operator/ckan-workspace.mjs';

const insist = (value, message) => { if (!value) throw new Error(message); };
async function streamDigest(stream) {
  const hash = createHash('sha256'); let bytes = 0;
  for await (const part of stream) { hash.update(part); bytes += part.length; }
  return { sha256: hash.digest('hex'), bytes };
}
const exists = async path => { try { return await lstat(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } };
async function finished(operation) {
  const result = await operation.completion;
  insist(result.state === 'COMPLETE', JSON.stringify(result.error ?? result));
  return result.result;
}
const publicSelection = value => ({ added: value.added, removed: value.removed, changed: value.changed,
  unchanged: value.unchanged, selectionStatus: value.selectionStatus,
  interpretation: value.interpretation, changeRows: value.changes.rows, changesSha256: value.changes.sha256 });

/** afterCapture is an original capture.json. afterSelection runs the original
 * live capture engine and retains its actual metadata, pages and definitions.
 * The receiving copy also exercises keep-current and withdrawal of the old
 * selection; its accepted successor remains available for further publication. */
export async function runReviewedRefresh({
  project, sourceId, previousPublicationId, afterCapture, afterSelection, out, received,
  keys = ['_id'], reviewer = 'CKAN receiving operator',
} = {}) {
  project = resolve(project); out = resolve(out); received = resolve(received);
  insist(Boolean(afterCapture) !== Boolean(afterSelection), 'Select one original --after-capture or live --after-selection.');
  insist(new Set([project, out, received]).size === 3, 'Use separate project, output and receiving directories.');
  await privateDirectory(dirname(out)); await mkdir(out, { recursive: true, mode: 0o700 }); await privateDirectory(out);
  await privateDirectory(dirname(received));
  const recordPath = join(out, 'receiving.json');
  const input = { project, sourceId, previousPublicationId, afterCapture: afterCapture ? resolve(afterCapture) : null,
    afterSelection: afterSelection ? resolve(afterSelection) : null, received, keys, reviewer };
  let record;
  try { record = await readJson(recordPath, 33554432); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (record) {
    insist(identity(record.input) === identity(input), 'Continue the original selected source, capture and receiving directories.');
    if (record.state === 'COMPLETE') return record;
  } else record = { schema: 'stellar-forge.ckan-reviewed-refresh-example.v1',
    input, state: 'RUNNING', startedAt: new Date().toISOString(), steps: [] };
  record.state = 'RUNNING'; delete record.error;
  const save = () => atomicJson(out, 'receiving.json', record);
  const note = async (name, value) => {
    record.steps.push({ name, at: new Date().toISOString(), value }); await save();
    process.stdout.write(JSON.stringify({ step: name, value }) + '\n');
  };
  await save();
  let workbench, web, application;
  try {
    workbench = await openCkanWorkbench({ directory: project });
    const source = workbench.status().sources.find(item => item.id === sourceId);
    insist(source, 'Select the exact existing original source ID.');
    const previous = await workbench.publication(previousPublicationId, 'limit=5');
    insist(previous.sourceId === sourceId && previous.run.state === 'PUBLISHED',
      'Select the original published version of this source.');
    if (!record.original) {
      const policy = previous.detail.plan.data;
      record.original = { sourceId, sourceSha256: source.sha256, editionId: source.editionId,
        publicationId: previousPublicationId, semanticReview: source.semanticReview ?? null,
        snapshot: previous.detail.preview.dataset.snapshot, rows: previous.detail.preview.dataset.rowCount,
        candidateDigest: previous.run.data.candidate.candidateDigest,
        policy: { filters: policy.dataset.filters, ranges: policy.dataset.ranges, sorts: policy.dataset.sorts,
          defaultLimit: policy.dataset.defaultLimit, maxLimit: policy.dataset.maxLimit,
          order: policy.extraction.order, maxRows: policy.extraction.maxRows,
          maxBytes: policy.extraction.maxBytes, timeoutMs: policy.extraction.timeoutMs } };
      await note('original source and published version retained', record.original);
    }
    insist(source.sha256 === record.original.sourceSha256, 'The original saved source changed.');
    if (afterCapture) {
      const capture = await readCkanCapture(resolve(afterCapture));
      if (record.after) insist(record.after.manifestSha256 === capture.manifestSha256, 'The selected original capture changed.');
      else {
        record.after = await finished(workbench.importCapture(resolve(afterCapture),
          { expectedManifestSha256: capture.manifestSha256 }));
        await note('complete original after-edition received', record.after);
      }
    } else {
      const selection = JSON.parse(await readFile(resolve(afterSelection), 'utf8'));
      const normalized = captureSelection({ ...selection, catalogOrigin: workbench.status().catalogOrigin,
        authTokenEnv: workbench.status().authTokenEnv });
      if (record.captureSelectionSha256) insist(record.captureSelectionSha256 === identity(normalized), 'The original live capture selection changed.');
      else { record.captureSelectionSha256 = identity(normalized); await save(); }
      if (!record.after) {
        let operation;
        if (record.afterEditionId) {
          const retained = await workbench.edition(record.afterEditionId);
          if (retained.state === 'COMPLETE') record.after = retained;
          else operation = workbench.resumeCapture(record.afterEditionId);
        } else {
          operation = workbench.startCapture(selection);
          record.afterEditionId = operation.editionId; await save();
        }
        if (operation) record.after = await finished(operation);
        await note('actual next selection captured by the original engine', record.after);
      }
    }
    const after = await workbench.edition(record.after.id);
    insist(after.manifestSha256 === record.after.manifestSha256, 'The retained after-edition changed.');
    if (!record.refreshId) {
      const result = await finished(workbench.prepareRefresh(sourceId, { afterEditionId: after.id,
        expectedSourceSha256: source.sha256, expectedAfterCaptureSha256: after.manifestSha256,
        previousPublicationId, keys }));
      record.refreshId = result.id; await save();
    }
    let refresh = await workbench.refresh(record.refreshId);
    if (!refresh.comparisonSha256) {
      await finished(workbench.resumeRefresh(record.refreshId)); refresh = await workbench.refresh(record.refreshId);
    }
    const comparison = refresh.comparison, expectedComparisonSha256 = refresh.comparisonSha256;
    if (!record.comparison) {
      let offset = 0, seen = 0, pagesRead = 0;
      do {
        const page = await workbench.refreshChanges(refresh.id, { expectedComparisonSha256, offset, limit: 7 });
        insist(page.offset === offset && page.changes.every((item, index) => item.index === seen + index),
          'Complete comparison pages lost original change order.');
        seen += page.changes.length; offset = page.nextOffset; pagesRead++;
      } while (offset !== null);
      const selected = await workbench.refreshChangesFile(refresh.id, expectedComparisonSha256);
      const downloaded = await streamDigest(createReadStream(selected.file));
      insist(seen === comparison.changes.rows && downloaded.bytes === selected.bytes && downloaded.sha256 === selected.sha256,
        'The complete page census and original JSONL must agree.');
      await atomicJson(out, 'comparison.json', comparison);
      record.comparison = { refreshId: refresh.id, sha256: expectedComparisonSha256,
        ...publicSelection(comparison), bytes: selected.bytes, pagesRead };
      await note('every keyed change and source selection difference reviewed', record.comparison);
    }
    if (!record.accepted) {
      const preview = await workbench.previewRefresh(refresh.id, { expectedComparisonSha256 });
      insist(preview.validatedRows === after.rowCount, 'Validate every after-row against the original typed projection.');
      const accepted = await finished(workbench.reviewRefresh(refresh.id, { expectedComparisonSha256,
        decision: 'accept', reviewer,
        note: 'Reviewed the complete retained key comparison, source terms, changed selection and field definitions. Publish the selected after-edition as a successor while retaining the previous publication.',
        title: preview.title, query: preview.query, projection: preview.projection,
        expectedProjectionSha256: preview.projectionSha256,
        expectedSemanticsSha256: preview.semanticReview?.sha256 ?? null,
        expectedDefinitionSha256: preview.semanticReview?.definitionSha256 ?? null }));
      record.accepted = { refreshId: accepted.id, sourceId: accepted.acceptedSourceId,
        decisionSha256: accepted.decisionSha256, projectionSha256: preview.projectionSha256,
        semanticReview: preview.semanticReview, validatedRows: preview.validatedRows };
      await note('complete successor projection and semantic review accepted', record.accepted);
    }
    if (!record.publication) {
      let selected = workbench.status().publications.find(item => item.sourceId === record.accepted.sourceId);
      if (!selected) selected = await finished(workbench.createPublication(record.accepted.sourceId, record.original.policy));
      let current = await workbench.publication(selected.id, 'limit=5');
      if (!['READY', 'REVIEWED', 'PUBLISHED'].includes(current.run.state)) {
        await finished(workbench.recoverPublication(selected.id)); current = await workbench.publication(selected.id, 'limit=5');
      }
      if (current.run.state === 'READY') {
        await finished(workbench.reviewPublication(selected.id, { expectedCandidateDigest: current.run.data.candidate.candidateDigest,
          reviewer, note: 'Publish the accepted retained refresh with its exact source, complete typed rows and reviewed field meanings.' }));
        current = await workbench.publication(selected.id, 'limit=5');
      }
      if (current.run.state === 'REVIEWED') await finished(workbench.publishDataset(selected.id, current.run.data.review.id));
      current = await workbench.publication(selected.id, 'limit=5');
      insist(current.run.state === 'PUBLISHED' && current.detail.preview.dataset.rowCount === after.rowCount &&
        current.previousPublicationId === previousPublicationId && current.refreshDecisionSha256 === record.accepted.decisionSha256,
        'The successor must retain its original reviewed decision and predecessor.');
      record.publication = { publicationId: current.id, sourceId: current.sourceId, runId: current.run.id,
        state: current.run.state, snapshot: current.detail.preview.dataset.snapshot,
        rows: current.detail.preview.dataset.rowCount, candidateDigest: current.run.data.candidate.candidateDigest };
      await note('accepted successor prepared reviewed and published', record.publication);
    }
    const older = await workbench.publication(previousPublicationId, 'limit=5');
    insist(older.run.state === 'PUBLISHED' && older.detail.preview.dataset.snapshot === record.original.snapshot &&
      older.run.data.candidate.candidateDigest === record.original.candidateDigest, 'The original published version changed.');
    if (!record.http) {
      web = await startCkanServer({ workbench, port: 0 });
      const get = async path => {
        const response = await fetch(web.origin + path, { headers: { authorization: 'Bearer ' + web.token }, redirect: 'error' });
        insist(response.status === 200, 'Original operator request failed: ' + path); return response;
      };
      const detail = await (await get('/api/refreshes/' + refresh.id)).json();
      const page = await (await get('/api/refreshes/' + refresh.id + '/changes?sha256=' + expectedComparisonSha256 + '&limit=7')).json();
      const downloaded = await get('/api/refreshes/' + refresh.id + '/changes/download?sha256=' + expectedComparisonSha256);
      const downloadedFile = await streamDigest(downloaded.body);
      insist(detail.state === 'ACCEPTED' && page.total === comparison.changes.rows &&
        downloaded.headers.get('x-content-sha256') === comparison.changes.sha256 && downloadedFile.sha256 === comparison.changes.sha256 && downloadedFile.bytes === comparison.changes.bytes,
        'Authenticated publisher routes must deliver the complete accepted comparison.');
      const html = await (await get('/')).text();
      insist(html.includes('data-tab="refreshes"'), 'The original operator navigation must expose reviewed refresh.');
      record.http = { status: 200, refreshId: refresh.id, state: detail.state,
        changeRows: page.total, changesSha256: downloadedFile.sha256, reviewedRefreshNavigation: true };
      await note('original authenticated operator and complete download opened', record.http);
      await web.close(); web = null;
    }
    if (!record.archive) {
      const file = join(out, 'accepted-refresh.ckanw');
      record.archive = (await workbench.workspaceArchives()).find(item => item.file === file) ??
        await finished(workbench.archiveWorkspace({ out: file }));
      const inspected = await inspectCkanWorkspaceArchive({ file, expectedSha256: record.archive.sha256 });
      insist(inspected.source.refreshes.some(item => item.id === refresh.id &&
        item.decisionSha256 === record.accepted.decisionSha256), 'The complete workspace must include its reviewed refresh.');
      await note('whole accepted workspace archived', { sha256: record.archive.sha256, bytes: record.archive.bytes, files: record.archive.files });
    }
    await workbench.close(); workbench = null;
    if (!record.receiving) {
      const result = await receiveCkanWorkspaceArchive({ file: record.archive.file, directory: received,
        expectedSha256: record.archive.sha256 });
      record.receiving = { state: result.state, files: result.files, archiveSha256: result.archiveSha256 };
      await note('full reviewed workspace received', record.receiving);
    }
    if (!record.agent) {
      const releaseStore = join(out, 'agent-release-store');
      if (!await exists(releaseStore)) await initReleaseStore(releaseStore);
      const exportsDirectory = join(out, 'agent-exports'); await privateDirectory(exportsDirectory, true);
      const connectionPath = join(out, 'workspace-connection.json'), configPath = join(out, 'merchant-mcp.json');
      await atomicJson(out, 'workspace-connection.json', { schema: CKAN_WORKSPACE_CONNECTION_SCHEMA,
        workspaces: { received: { directory: received, label: 'Received reviewed refresh' } } });
      await atomicJson(out, 'merchant-mcp.json', { schema: 'stellar-forge.merchant-mcp.v1',
        name: 'Reviewed CKAN refresh receiving', releaseStore, exportsDirectory, sources: {}, ckanWorkspaceConnection: connectionPath });
      const tokenEnv = 'CKAN_REVIEWED_REFRESH_MCP_TOKEN', token = randomBytes(32).toString('hex');
      application = await startCkanAgentWorkspace({ configPath, workspace: 'received', tokenEnv,
        environment: { ...process.env, [tokenEnv]: token } });
      let rpcId = 0;
      const rpc = async (method, params) => {
        const response = await fetch(application.startup.mcpUrl, { method: 'POST', redirect: 'error',
          headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json',
            accept: 'application/json, text/event-stream', 'mcp-protocol-version': MCP_VERSION },
          body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }) });
        insist(response.status === 200, 'Original MCP transport failed: ' + response.status);
        const body = await response.json(); insist(!body.error, JSON.stringify(body.error)); return body.result;
      };
      const call = async (name, input = {}) => {
        const result = await rpc('tools/call', { name, arguments: { workspace: 'received', ...input } });
        insist(!result.isError, name + ': ' + JSON.stringify(result.content));
        return result.structuredContent ?? JSON.parse(result.content.find(item => item.type === 'text').text);
      };
      const mutation = async (name, input) => {
        const current = await call('merchant_ckan_status', { limit: 100 });
        const operation = await call(name, { ...input, expectedOperationId: current.native.operation?.id ?? null });
        for (;;) {
          const status = await call('merchant_ckan_status', { limit: 100 }), selected = status.native.operation;
          insist(selected?.id === operation.operationId, 'Continue the original agent operation.');
          if (status.native.active === operation.operationId) { await new Promise(done => setTimeout(done, 100)); continue; }
          insist(selected.state === 'COMPLETE', JSON.stringify(selected.error)); return selected.result;
        }
      };
      const initialized = await rpc('initialize', { protocolVersion: MCP_VERSION, capabilities: {},
        clientInfo: { name: 'ckan-reviewed-refresh-receiving', version: '1.0.0' } });
      insist(initialized.protocolVersion === MCP_VERSION, 'Use the current original MCP protocol.');
      const tools = (await rpc('tools/list', {})).tools.map(item => item.name);
      for (const suffix of ['prepare', 'resume', 'preview', 'changes', 'read', 'review'])
        insist(tools.includes('merchant_ckan_refresh_' + suffix), 'The complete refresh tool is missing: ' + suffix);
      const restored = (await call('merchant_ckan_refresh', { refreshId: refresh.id })).native;
      insist(restored.decisionSha256 === record.accepted.decisionSha256 && restored.state === 'ACCEPTED',
        'The original decision must survive complete workspace relocation.');
      const preview = (await call('merchant_ckan_refresh_preview', { refreshId: refresh.id, expectedComparisonSha256 })).native;
      insist(preview.projectionSha256 === record.accepted.projectionSha256, 'The relocated successor projection changed.');
      await mutation('merchant_ckan_refresh_resume', { refreshId: refresh.id });
      let offset = 0, readId, count = 0; const hash = createHash('sha256');
      do {
        const part = await call('merchant_ckan_refresh_read', { refreshId: refresh.id, expectedComparisonSha256,
          expectedSha256: comparison.changes.sha256, offset, limit: 4096, ...(readId ? { readId } : {}) });
        const raw = Buffer.from(part.data, 'base64'); hash.update(raw); count += raw.length;
        offset = part.nextOffset; readId = part.readId;
      } while (offset !== null);
      insist(count === comparison.changes.bytes && hash.digest('hex') === comparison.changes.sha256, 'Original MCP chunks changed the complete JSONL.');
      const page = (await call('merchant_ckan_refresh_changes', { refreshId: refresh.id, expectedComparisonSha256, offset: 0, limit: 7 })).native;
      insist(page.total === comparison.changes.rows, 'The relocated complete page total changed.');
      // The second operator makes both additional decisions in the receiving
      // copy. The original source project and accepted successor remain usable.
      let priorRefreshId = refresh.id;
      for (const decision of ['keep-current', 'withdraw-source']) {
        const prepared = await mutation('merchant_ckan_refresh_prepare', { sourceId, afterEditionId: after.id,
          expectedSourceSha256: record.original.sourceSha256, expectedAfterCaptureSha256: after.manifestSha256,
          previousPublicationId, keys, supersedesRefreshId: priorRefreshId });
        const decided = await mutation('merchant_ckan_refresh_review', { refreshId: prepared.id,
          expectedComparisonSha256: prepared.comparisonSha256, decision, reviewer,
          note: decision === 'keep-current' ? 'Second operator retains the original publication after reviewing the same complete source change.' :
            'Second operator withdraws the earlier source from future publication in this receiving copy. Retain its published data and the accepted successor.' });
        priorRefreshId = decided.id;
      }
      const originalAfter = (await call('merchant_ckan_publication', { publicationId: previousPublicationId, query: 'limit=5' })).native;
      const successor = (await call('merchant_ckan_publication', { publicationId: record.publication.publicationId, query: 'limit=5' })).native;
      insist(originalAfter.run.state === 'PUBLISHED' && successor.run.state === 'PUBLISHED',
        'Both published versions must remain usable after source withdrawal.');
      record.agent = { ckanTools: tools.filter(name => name.startsWith('merchant_ckan_')).length,
        refreshId: refresh.id, comparisonSha256: expectedComparisonSha256, changesSha256: comparison.changes.sha256,
        originalPublicationId: previousPublicationId, successorPublicationId: record.publication.publicationId,
        withdrawalRefreshId: priorRefreshId };
      await note('all agent refresh tools and second-operator decisions completed', record.agent);
      await application.close(); application = null;
    }
    if (!record.cli) {
      const cli = fileURLToPath(new URL('../cli.mjs', import.meta.url));
      const result = await promisify(execFile)(process.execPath, ['--max-old-space-size=128', '--v8-pool-size=1', cli,
        'refresh', '--project', received, '--id', record.refreshId], { maxBuffer: 8388608 });
      const restored = JSON.parse(result.stdout);
      insist(restored.state === 'ACCEPTED' && restored.decisionSha256 === record.accepted.decisionSha256,
        'The original CLI must reopen the accepted refresh after agent shutdown.');
      record.cli = { refreshId: restored.id, state: restored.state, decisionSha256: restored.decisionSha256 };
      await note('original CLI reopened the received accepted refresh', record.cli);
    }
    workbench = await openCkanWorkbench({ directory: received });
    const status = workbench.status(), withdrawn = status.sources.find(item => item.id === sourceId);
    insist(withdrawn.withdrawal && status.sources.some(item => item.id === record.accepted.sourceId && !item.withdrawal),
      'Withdrawal must retain the distinct accepted successor.');
    const denied = await workbench.createPublication(sourceId).completion;
    insist(denied.state === 'FAILED' && denied.error?.code === 'CKAN_SOURCE_WITHDRAWN',
      'The original publisher must enforce this receiving operator withdrawal.');
    const olderAgain = await workbench.publication(previousPublicationId, 'limit=5');
    insist(olderAgain.detail.preview.dataset.snapshot === record.original.snapshot,
      'Withdrawing future publication changed the original published version.');
    if (!record.receivedArchive) {
      const file = join(out, 'received-refresh-history.ckanw');
      record.receivedArchive = (await workbench.workspaceArchives()).find(item => item.file === file) ??
        await finished(workbench.archiveWorkspace({ out: file }));
      const checked = await inspectCkanWorkspaceArchive({ file, expectedSha256: record.receivedArchive.sha256 });
      insist(checked.source.refreshes.some(item => item.id === record.agent.withdrawalRefreshId &&
        item.state === 'SOURCE_WITHDRAWN'), 'Retain the complete second-operator decision history.');
    }
    await workbench.close(); workbench = null;
    record.state = 'COMPLETE'; record.completedAt = new Date().toISOString();
    await note('complete receiving history and both published versions retained', {
      archiveSha256: record.receivedArchive.sha256, archiveBytes: record.receivedArchive.bytes,
      acceptedPublication: record.publication.publicationId, originalPublication: previousPublicationId });
    return record;
  } catch (error) {
    record.state = 'INTERRUPTED'; record.error = { code: error.code ?? 'CKAN_REVIEWED_REFRESH_FAILED', message: error.message };
    await save(); throw error;
  } finally { await application?.close(); await web?.close(); await workbench?.close(); }
}
export async function main(argv = process.argv.slice(2)) {
  const names = new Map([['--project', 'project'], ['--source', 'sourceId'],
    ['--previous-publication', 'previousPublicationId'], ['--after-capture', 'afterCapture'],
    ['--after-selection', 'afterSelection'], ['--out', 'out'], ['--received', 'received'],
    ['--keys', 'keys'], ['--reviewer', 'reviewer']]);
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    insist(names.has(argv[index]) && argv[index + 1] && !Object.hasOwn(options, names.get(argv[index])),
      'Use each named reviewed-refresh option once.');
    options[names.get(argv[index])] = argv[index + 1];
  }
  for (const name of ['project', 'sourceId', 'previousPublicationId', 'out', 'received'])
    insist(options[name], 'Supply --project, --source, --previous-publication, --out and --received.');
  if (options.keys) options.keys = options.keys.split(',');
  const result = await runReviewedRefresh(options);
  process.stdout.write(JSON.stringify({ state: result.state, refreshId: result.refreshId,
    successor: result.publication, archive: result.receivedArchive, outputDirectory: resolve(options.out) }) + '\n');
}
if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? '')).href)
  main().catch(error => { process.stderr.write((error.code ?? 'CKAN_REVIEWED_REFRESH_FAILED') + ': ' + error.message + '\n'); process.exitCode = 1; });
