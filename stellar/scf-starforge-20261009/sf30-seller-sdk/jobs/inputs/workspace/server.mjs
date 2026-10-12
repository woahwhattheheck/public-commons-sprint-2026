// MIT. Borrow the original private merchant host and the maintained Library transfer path.
import { readFile } from 'node:fs/promises';
import { need, object } from '../../intake/protocol.mjs';
import { openJobInputWorkspace } from './model.mjs';
import { createVerifiedDownloads } from '../../../../sf88-operator-buyer-cli/resource-library/verified-downloads.mjs';

const only = (value, names) => need(object(value) && Object.keys(value).every(key => names.includes(key)),
  'JOB_INPUT_DESK_OPTIONS_INVALID');
export async function jobInputWorkspaceExtension({ model } = {}) {
  const desk = openJobInputWorkspace({ model });
  const downloads = createVerifiedDownloads({ prefix: '/input-transfer/' });
  let closePromise;
  const close = () => closePromise ??= (async () => {
    const errors = [];
    for (const stop of [() => downloads.close(), () => desk.close()])
      try { await stop(); } catch (error) { errors.push(error); }
    if (errors.length) throw new AggregateError(errors, 'JOB_INPUT_WORKSPACE_CLOSE_FAILED');
    return { closed: true };
  })();
  let assets;
  try {
    assets = await Promise.all([
      ['/inputs/', 'index.html', 'text/html'], ['/job-inputs.mjs', 'app.mjs', 'text/javascript'],
      ['/job-inputs.css', 'style.css', 'text/css'],
    ].map(async ([route, filename, type]) =>
      ({ route, type, bytes: await readFile(new URL('./public/' + filename, import.meta.url)) })));
  } catch (error) {
    try { await close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'JOB_INPUT_WORKSPACE_OPEN_FAILED'); }
    throw error;
  }
  return { desk, assets, close,
    status: () => ({ workspace: '/inputs/', configured: !!model.inputs, downloads: downloads.status() }),
    /** Invoke only after the owning host has checked Host, Origin and Fetch-Site. */
    async publicRoute({ request, response, url, signal }) {
      if (!url.pathname.startsWith('/input-transfer/')) return false;
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      response.setHeader('Referrer-Policy', 'no-referrer');
      response.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
      return downloads.serve({ request, response, path: url.pathname, signal });
    },
    /** Same callback shape as the original Library extension: send(value,status). */
    async authenticatedRoute({ request, url, body, send, signal }) {
      const path = url.pathname, method = request.method;
      if (path !== '/api/inputs' && !path.startsWith('/api/inputs/')) return false;
      need(!url.search, 'JOB_INPUT_DESK_QUERY_REFUSED');
      if (method === 'GET' && path === '/api/inputs') { send(await desk.query()); return true; }
      if (method === 'POST' && path === '/api/inputs/query') { send(await desk.query(await body(65536))); return true; }
      const match = /^\/api\/inputs\/([a-f0-9]{64})(?:\/(preview|download|discard))?$/.exec(path);
      need(match, 'JOB_INPUT_NOT_FOUND', 404);
      const [, id, action] = match;
      if (method === 'GET' && !action) { send(await desk.get(id)); return true; }
      if (method === 'GET' && action === 'preview') { send(await desk.preview(id, { signal })); return true; }
      need(method === 'POST', 'JOB_INPUT_DESK_METHOD_REQUIRED', 405);
      const input = await body(65536);
      if (action === 'preview') {
        only(input, ['maxBytes']); send(await desk.preview(id, { ...input, signal })); return true;
      }
      if (action === 'download') {
        only(input, []);
        send(await downloads.register(ownedSignal => desk.download(id, { signal: ownedSignal }), { signal }));
        return true;
      }
      if (action === 'discard') {
        only(input, ['expectedRevision', 'reason', 'releaseOrphan']);
        send(await desk.discard({ id, ...input })); return true;
      }
      need(false, 'JOB_INPUT_DESK_METHOD_REQUIRED', 405);
    },
  };
}
