// MIT. Routes use the original workspace's origin, token, request limits and serialization.
import { inspectOpenApi } from '../workspace/model.mjs';
import { openMigrationApplication } from './application.mjs';
import { HANDOVER_MAX_ARCHIVE_BYTES } from './handover.mjs';

export async function createMigrationRoutes(options) {
  const app = await openMigrationApplication(options);
  const parameter = (url, name) => { const value = url.searchParams.get(name); if (!value) throw new TypeError('Missing ' + name + '.'); return value; };
  async function get(path, url, send, res) {
    const action = path.slice('/api/migrations/'.length);
    if (action === 'list') return send(200, { projects: await app.projects.list(), packages: await app.releases.packages(), receivedWorkspaces: await app.listReceivedWorkspaces() });
    const id = parameter(url, 'project');
    if (action === 'project') return send(200, await app.snapshot(id));
    if (action === 'history') {
      const history = await app.projects.history(id);
      return send(200, { project: history.project, editions: history.editions.map(({ state, ...row }) => ({ ...row,
        sourceCount: state.sources.length, mappingCount: Object.keys(state.mappings).length, acquisitionCount: state.acquisitions.length })) });
    }
    if (action === 'source' || action === 'source-download' || action === 'source-inspect') {
      const source = await app.projects.readSource(id, parameter(url, 'ref'));
      if (action === 'source-inspect') return send(200, inspectOpenApi(source.body.toString('utf8')));
      if (action === 'source-download') {
        const filename = source.metadata.name.replace(/[\r\n"\\/]/g, '_');
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Length': source.body.length,
          'Content-Disposition': 'attachment; filename="' + filename + '"' }); res.end(source.body); return;
      }
      return send(200, { ref: source.ref, metadata: source.metadata, content: source.body.toString('utf8') });
    }
    if (action === 'inventory') {
      const project = await app.projects.get(id); const requests = [];
      for (const ref of project.state.inventories) {
        const source = await app.projects.readJson(id, ref);
        requests.push(...source.value.requests.map(row => ({ ...row, sourceRef: ref })));
      }
      return send(200, { requests });
    }
    if (action === 'acquisition' || action === 'rows' || action === 'capture') {
      const run = parameter(url, 'run'); const selected = await app.acquisition(id, run);
      if (action === 'acquisition') return send(200, { ...selected.entry, manifest: selected.manifest });
      if (action === 'rows') return send(200, await selected.service.readRows(run));
      const capture = await selected.service.readCapture(run, parameter(url, 'capture'));
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': capture.body.length,
        'Content-Disposition': 'attachment; filename="' + run + '-' + parameter(url, 'capture').replace(/[^a-zA-Z0-9_-]/g, '_') + '.json"' });
      res.end(capture.body); return;
    }
    if (action === 'handover-download') {
      const value = await app.handovers.download(id, parameter(url, 'name'));
      res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Length': value.body.length,
        'Content-Disposition': 'attachment; filename="' + value.filename + '"' });
      res.end(value.body); return;
    }
    if (action === 'handovers') return send(200, { handovers: await app.handovers.list(id) });
    if (action === 'receiver') return send(200, app.receiverView(id));
    if (action === 'releases') return send(200, await app.releases.status(id));
    return send(404, { error: 'Migration view not found.' });
  }
  async function upload(req, url, send) {
    if (url.pathname !== '/api/migrations/handover/import-file') return send(404, { error: 'Migration upload not found.' });
    if (!/^application\/(?:gzip|octet-stream)(?:;|$)/i.test(req.headers['content-type'] ?? ''))
      return send(415, { error: 'Select the original compressed migration handover.' });
    const name = parameter(url, 'name'), expectedSha256 = parameter(url, 'sha256');
    if (!/^[a-z0-9][a-z0-9_-]{0,79}$/.test(name) || !/^[a-f0-9]{64}$/.test(expectedSha256))
      return send(400, { error: 'Choose a workspace name and retain the complete handover identity.' });
    const chunks = []; let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > HANDOVER_MAX_ARCHIVE_BYTES) {
        const error = new Error('Migration handover exceeds 32 MiB.'); error.status = 413; throw error;
      }
      chunks.push(chunk);
    }
    return send(200, await app.importHandover({ name, expectedSha256, body: Buffer.concat(chunks) }));
  }
  async function post(path, input, send) {
    const action = path.slice('/api/migrations/'.length); let result;
    if (action === 'create') result = { project: await app.projects.create(input) };
    else if (action === 'source/add') result = await app.addSource(input);
    else if (action === 'acquisition/create') result = await app.createAcquisition(input);
    else if (action === 'acquisition/run') result = await app.startAcquisition(input);
    else if (action === 'acquisition/pause') result = await app.stopAcquisition(input);
    else if (action === 'acquisition/import') result = await app.importCapture(input);
    else if (action === 'mapping/save') result = await app.saveMapping(input);
    else if (action === 'mapping/review') result = await app.reviewSemanticMapping(input);
    else if (action === 'mapping/compare') {
      const value = await app.compare(input), comparison = value.comparison;
      result = { project: value.project, comparison: { comparisonId: comparison.comparisonId,
        reviewId: comparison.reviewId, mappingId: comparison.mappingId, status: comparison.status,
        ready: comparison.ready, equivalent: comparison.equivalent, summary: comparison.summary } };
    }
    else if (action === 'source/review') result = await app.createSourceReview(input);
    else if (action === 'source/export') result = await app.exportMerchant(input);
    else if (action === 'receiver/open') result = await app.openReceiver(input);
    else if (action === 'receiver/close') result = await app.closeReceiver(input);
    else if (action === 'receiver/retain') result = await app.retainReceivedResponse(input);
    else if (action === 'handover/create') result = await app.createHandover(input);
    else if (action === 'handover/import') result = await app.importHandover(input);
    else if (action === 'handover/open') result = await app.openReceivedWorkspace(input);
    else if (action === 'release/stage') result = await app.releases.stage(input);
    else if (action === 'release/diff') result = await app.releases.diff(input);
    else if (action === 'release/select') result = await app.releases.select(input);
    else if (action === 'release/start') result = await app.releases.start(input);
    else if (action === 'release/stop') result = await app.releases.stop(input);
    else return send(404, { error: 'Migration action not found.' });
    return send(action === 'acquisition/run' && result.running ? 202 : 200, result);
  }
  return { app, get, post, upload, close: app.close };
}
