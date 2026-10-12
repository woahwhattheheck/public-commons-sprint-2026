// MIT. Self-service input requests extend the original private customer HTTP host.
import { readFile } from 'node:fs/promises';
import { need } from '../../../sf30-seller-sdk/jobs/intake/protocol.mjs';

export async function jobIntakeExtension(intake) {
  need(intake && typeof intake.draft === 'function', 'JOB_INTAKE_WORKSPACE_REQUIRED');
  const additionalAssets = await Promise.all([
    ['/jobs/request/', 'public/index.html', 'text/html'],
    ['/jobs/request/app.mjs', 'public/app.mjs', 'text/javascript'],
    ['/jobs/request/style.css', 'public/style.css', 'text/css'],
  ].map(async ([route, file, type]) => ({ route, type, bytes: await readFile(new URL(file, import.meta.url)) })));
  const authenticatedRoute = async ({ request, url, send, body }) => {
    if (!url.pathname.startsWith('/api/job-intake/')) return false;
    const path = url.pathname.slice('/api/job-intake'.length), method = request.method;
    if (path === '/state' && method === 'GET') send(intake.status());
    else if (path === '/catalog' && method === 'POST') send(await intake.discover(await body(4096)));
    else if (path === '/draft' && method === 'POST') send(await intake.draft(await body(4194304)), 201);
    else if (path === '/requests' && method === 'GET') send(intake.list({
      q: url.searchParams.get('q') ?? '', phase: url.searchParams.get('phase') ?? '',
      offset: Number(url.searchParams.get('offset') ?? 0), limit: Number(url.searchParams.get('limit') ?? 50),
    }));
    else {
      const match = /^\/requests\/([a-f0-9]{64})(?:\/(start|stop|access|ticket))?$/.exec(path);
      need(match, 'JOB_INTAKE_ROUTE_NOT_FOUND', 404);
      const [, id, action] = match;
      if (!action && method === 'GET') send(await intake.get(id));
      else if (action === 'start' && method === 'POST') send(await intake.start(id, await body()), 202);
      else if (action === 'stop' && method === 'POST') { await body(); send(await intake.cancel(id), 202); }
      else if (action === 'access' && method === 'POST') send(await intake.setAccess(id, await body(4096)));
      else if (action === 'ticket' && method === 'GET') {
        const bytes = await intake.ticket(id); send({ handoffBase64: bytes.toString('base64') });
      } else need(false, 'JOB_INTAKE_METHOD_REJECTED', 405);
    }
    return true;
  };
  return { additionalAssets, authenticatedRoute };
}
