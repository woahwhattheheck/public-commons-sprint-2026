// MIT. Jobs, verified resources and collections share the original private HTTP host.
import { readFile } from 'node:fs/promises';
import { serveLibrary } from '../resource-library/server.mjs';
import { collectionExtension } from '../resource-library/collection-ui.mjs';
import { requireValue } from './state.mjs';

export async function startJobCustomerWorkspace({ model, port = 0 } = {}) {
  requireValue(model?.library && typeof model.retain === 'function', 'JOB_WORKSPACE_MODEL_REQUIRED');
  const collections = await collectionExtension(model.library);
  const assets = await Promise.all([
    ['/jobs/','public/index.html','text/html'],
    ['/jobs/app.mjs','public/app.mjs','text/javascript'],
    ['/jobs/style.css','public/style.css','text/css'],
  ].map(async ([route, file, type]) => ({ route, type, bytes: await readFile(new URL(file, import.meta.url)) })));
  const route = async ({ request, url, send, body }) => {
    if (!url.pathname.startsWith('/api/job-workspace/')) return false;
    try {
      const method = request.method, path = url.pathname.slice('/api/job-workspace'.length);
      if (path === '/state' && method === 'GET') send(model.status());
      else if (path === '/jobs' && method === 'GET') {
        // Read current local buyer status while a retained monitor writes it.
        // No outbound request is introduced by refreshing the browser list.
        await Promise.allSettled(model.status().active.map(task => model.reconcile(task.entryId)));
        send(model.list({ q: url.searchParams.get('q') ?? '', state: url.searchParams.get('state') ?? '',
          view: url.searchParams.get('view') ?? 'active', offset: Number(url.searchParams.get('offset') ?? 0),
          limit: Number(url.searchParams.get('limit') ?? 50) }));
      } else if (path === '/register' && method === 'POST') send(await model.register(await body()), 201);
      else if (path === '/retain' && method === 'POST') {
        const input = await body(2 * 1024 * 1024), encoded = input.acceptanceBase64;
        requireValue(typeof encoded === 'string' && encoded.length <= 87384 &&
          Buffer.from(encoded, 'base64').toString('base64') === encoded, 'JOB_ACCEPTANCE_ENCODING_INVALID');
        send(await model.retain({ acceptanceBytes: Buffer.from(encoded, 'base64'), label: input.label ?? '',
          ...(input.handoff === undefined ? { claimToken: input.claimToken } : { handoff: input.handoff }) }), 201);
      } else {
        const match = /^\/jobs\/([a-f0-9]{64})(?:\/(start|stop|reopen))?$/.exec(path);
        requireValue(match, 'JOB_WORKSPACE_ROUTE_NOT_FOUND', 404);
        const [,id,action] = match;
        if (!action && method === 'GET') {
          model.get(id);
          try { await model.reconcile(id); } catch { /* The retained entry exposes its read error. */ }
          send(model.get(id));
        } else if (!action && method === 'PATCH') send(await model.update(id, await body()));
        else if (action === 'start' && method === 'POST') send(await model.start(id, await body()), 202);
        else if (action === 'stop' && method === 'POST') { await body(); send(await model.cancel(id), 202); }
        else if (action === 'reopen' && method === 'POST') { await body(); send(await model.reconcile(id)); }
        else requireValue(false, 'METHOD_NOT_ALLOWED', 405);
      }
      return true;
    } catch (error) {
      if (!error.status && typeof error.code === 'string') {
        error.status = /CAPACITY/.test(error.code) ? 429 :
          /CONFLICT|CHANGED|ACTIVE|EXISTS/.test(error.code) ? 409 :
          /NOT_FOUND/.test(error.code) ? 404 : /HTTP_ERROR|REDIRECT|PAYMENT_REQUESTED/.test(error.code) ? 502 : 400;
      }
      throw error;
    }
  };
  const host = await serveLibrary(model.library, { port,
    additionalAssets: [...collections.additionalAssets, ...assets],
    authenticatedRoute: [collections.authenticatedRoute, route] });
  return { ...host, url: host.origin + '/jobs/#' + host.token,
    libraryUrl: host.origin + '/#' + host.token,
    collectionsUrl: host.origin + '/collections#' + host.token };
}
