import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { openWorkspace } from './model.mjs';
import { jsonBytes, parse, requireThat } from './common.mjs';

const publicDirectory = fileURLToPath(new URL('./public/', import.meta.url));
export async function startServer(options) {
  const model = await openWorkspace(options); let origin;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    const send = (value, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(jsonBytes(value)); };
    const download = (file, type = 'application/octet-stream') => { res.writeHead(200, { 'Content-Type': type, 'Content-Length': file.data.length, 'Content-Disposition': `attachment; filename="${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}"` }); res.end(file.data); };
    try {
      requireThat(req.headers.host === new URL(origin).host, 'HOST', 'Open the original printed local address', 403);
      requireThat(!req.headers.origin || req.headers.origin === origin, 'ORIGIN', 'Use the same local operator origin', 403);
      requireThat(!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']), 'ORIGIN', 'Cross-site workspace access is refused', 403);
      const url = new URL(req.url, origin), path = url.pathname, query = Object.fromEntries(url.searchParams); let match;
      if (req.method === 'GET' || req.method === 'HEAD') {
        if (['/', '/app.mjs', '/style.css'].includes(path)) {
          const file = path === '/' ? 'index.html' : path.slice(1), bytes = await readFile(join(publicDirectory, file));
          res.writeHead(200, { 'Content-Type': file.endsWith('.html') ? 'text/html; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8', 'Content-Length': bytes.length }); res.end(req.method === 'HEAD' ? undefined : bytes); return;
        }
        requireThat(req.method === 'GET', 'METHOD', 'Use GET for workspace API reads', 405);
        if (path === '/api/state') return send(model.state());
        if ((match = path.match(/^\/api\/projects\/([^/]+)$/))) return send(model.project(match[1]));
        if ((match = path.match(/^\/api\/projects\/([^/]+)\/schema$/))) return send(model.schema(match[1]));
        if ((match = path.match(/^\/api\/projects\/([^/]+)\/items$/))) {
          model.store.project(match[1]); requireThat(['snapshot', 'run', 'job', 'action', 'export', 'schema'].includes(query.kind), 'ITEM_KIND', 'Choose a retained item kind');
          const offset = Number(query.offset ?? 0), limit = Number(query.limit ?? 50); requireThat(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 100, 'PAGE', 'Invalid retained item page');
          const total = model.store.db.prepare('SELECT count(*) AS n FROM objects WHERE project_id=? AND kind=?').get(match[1], query.kind).n;
          const items = model.store.list(match[1], query.kind, { offset, limit });
          for (const item of items) { delete item.providerBinding; delete item.credentialBinding; delete item.capturedConfig; delete item.config; }
          return send({ items, total, offset, limit });
        }
        if ((match = path.match(/^\/api\/snapshots\/([^/]+)$/))) return send(model.snapshot(match[1]));
        if ((match = path.match(/^\/api\/snapshots\/([^/]+)\/deals$/))) return send(model.deals(match[1], query));
        if ((match = path.match(/^\/api\/snapshots\/([^/]+)\/deals\/(\d+)$/))) return send({ deal: model.record(match[1], match[2]) });
        if ((match = path.match(/^\/api\/jobs\/([^/]+)$/))) return send(model.job(match[1]));
        if ((match = path.match(/^\/api\/runs\/([^/]+)$/))) return send(model.run(match[1]));
        if ((match = path.match(/^\/api\/runs\/([^/]+)\/alerts$/))) return send(model.alerts(match[1], query));
        if ((match = path.match(/^\/api\/runs\/([^/]+)\/cohorts$/))) return send(model.cohorts(match[1], query));
        if ((match = path.match(/^\/api\/runs\/([^/]+)\/compare$/))) return send(model.compare(match[1], query.baseline));
        if ((match = path.match(/^\/api\/runs\/([^/]+)\/report$/))) { const run = model.store.get(match[1], 'run'); return download(model.store.readFile(run.reportFileId), 'application/json'); }
        if ((match = path.match(/^\/api\/actions\/([^/]+)$/))) return send(model.action(match[1]));
        if ((match = path.match(/^\/api\/actions\/([^/]+)\/request$/))) { const { action } = model.action(match[1]); requireThat(action.prepared, 'NOT_PREPARED', 'Prepare this proposal first'); const data = jsonBytes(action.prepared); return download({ name: 'hubspot-prepared-request.json', data }, 'application/json'); }
        if ((match = path.match(/^\/api\/files\/([^/]+)\/download$/))) return download(model.store.readFile(match[1]));
        if ((match = path.match(/^\/api\/exports\/([^/]+)\/download$/))) return download(model.store.readFile(model.store.get(match[1], 'export').fileId), 'application/gzip');
        requireThat(false, 'NOT_FOUND', 'Resource was not found', 404);
      }
      requireThat(req.method === 'POST', 'METHOD', 'Use POST for explicit workspace actions', 405);
      requireThat(req.headers['x-workspace-request'] === '1' && /^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? ''), 'WRITE_CONTEXT', 'Use the original workspace JSON request header', 403);
      const chunks = []; let length = 0;
      for await (const chunk of req) { length += chunk.length; requireThat(length <= 180 * 1024 * 1024, 'UPLOAD_CAPACITY', 'Request exceeds the 180 MiB encoded upload limit', 413); chunks.push(chunk); }
      const input = parse(Buffer.concat(chunks), 'request');
      if (path === '/api/projects') return send(model.createProject(input), 201);
      if (path === '/api/restore') return send(model.restoreProject(input), 201);
      if ((match = path.match(/^\/api\/projects\/([^/]+)\/(config|import|schema|sync|runs|exports)$/))) {
        const methods = { config: 'saveConfig', import: 'importSource', schema: 'importSchema', sync: 'startSync', runs: 'startRun', exports: 'exportProject' }; return send(await model[methods[match[2]]](match[1], input));
      }
      if ((match = path.match(/^\/api\/jobs\/([^/]+)\/(cancel|resume)$/))) return send(await model[match[2] === 'cancel' ? 'cancelJob' : 'resumeJob'](match[1], input));
      if ((match = path.match(/^\/api\/runs\/([^/]+)\/alerts\/(\d+)\/review$/))) return send(model.review(match[1], match[2], input));
      if ((match = path.match(/^\/api\/runs\/([^/]+)\/actions$/))) return send(model.createAction(match[1], input));
      if ((match = path.match(/^\/api\/runs\/([^/]+)\/retry$/))) return send(model.retryRun(match[1], input));
      if ((match = path.match(/^\/api\/actions\/([^/]+)\/(prepare|approve|execute|reconcile|revoke)$/))) return send(await model[match[2] + 'Action'](match[1], input));
      requireThat(false, 'NOT_FOUND', 'Action was not found', 404);
    } catch (error) {
      if (!res.headersSent) send({ error: error.code ?? 'OPERATION_FAILED', message: error.message ?? 'Operation failed' }, error.status ?? 400); else res.destroy();
    }
  });
  server.requestTimeout = 60000;
  try { await new Promise((resolve, reject) => { server.once('error', reject); server.listen(options.port ?? 0, '127.0.0.1', resolve); }); }
  catch (e) { await model.close(); throw e; }
  origin = `http://127.0.0.1:${server.address().port}`;
  return { model, server, url: origin, async close() { const stopped = new Promise(resolve => server.close(resolve)); server.closeIdleConnections(); await model.close(); server.closeAllConnections(); await stopped; } };
}
