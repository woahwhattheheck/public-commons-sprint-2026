// MIT. Checkout extends the existing authenticated resource-library host.
import { readFile } from 'node:fs/promises';
import { requireValue } from '../state.mjs';
import { MAX_TICKET_BYTES } from './contract.mjs';

export async function jobCheckoutExtension(checkout) {
  requireValue(checkout && typeof checkout.start === 'function', 'JOB_CHECKOUT_WORKSPACE_REQUIRED');
  const additionalAssets = await Promise.all([
    ['/jobs/checkout/', 'public/index.html', 'text/html'],
    ['/jobs/checkout/app.mjs', 'public/app.mjs', 'text/javascript'],
    ['/jobs/checkout/style.css', 'public/style.css', 'text/css'],
  ].map(async ([route, file, type]) => ({ route, type, bytes: await readFile(new URL(file, import.meta.url)) })));
  const ticketBytes = input => {
    requireValue(typeof input.handoffBase64 === 'string' && input.handoffBase64.length > 0 &&
      input.handoffBase64.length <= Math.ceil(MAX_TICKET_BYTES / 3) * 4 &&
      Buffer.from(input.handoffBase64, 'base64').toString('base64') === input.handoffBase64,
      'JOB_CHECKOUT_TICKET_ENCODING_INVALID');
    return Buffer.from(input.handoffBase64, 'base64');
  };
  const authenticatedRoute = async ({ request, url, send, body }) => {
    if (!url.pathname.startsWith('/api/job-checkout/')) return false;
    try {
      const path = url.pathname.slice('/api/job-checkout'.length), method = request.method;
      if (path === '/state' && method === 'GET') send(checkout.status());
      else if (path === '/checkouts' && method === 'GET') send(checkout.list({
        q: url.searchParams.get('q') ?? '', phase: url.searchParams.get('phase') ?? '',
        offset: Number(url.searchParams.get('offset') ?? 0), limit: Number(url.searchParams.get('limit') ?? 50),
      }));
      else if (path === '/import' && method === 'POST') {
        const input = await body(131072);
        send(await checkout.import({ handoffBytes: ticketBytes(input), label: input.label }), 201);
      } else {
        const match = /^\/checkouts\/([a-f0-9]{64})(?:\/(start|stop|replace))?$/.exec(path);
        requireValue(match, 'JOB_CHECKOUT_ROUTE_NOT_FOUND', 404);
        const [, id, action] = match;
        if (!action && method === 'GET') send(checkout.get(id));
        else if (action === 'start' && method === 'POST') send(await checkout.start(id, await body()), 202);
        else if (action === 'stop' && method === 'POST') send(await checkout.cancel(id, await body()), 202);
        else if (action === 'replace' && method === 'POST') {
          const input = await body(131072);
          send(await checkout.replace(id, { handoffBytes: ticketBytes(input),
            expectedRevision: input.expectedRevision, reason: input.reason }));
        } else requireValue(false, 'METHOD_NOT_ALLOWED', 405);
      }
      return true;
    } catch (error) {
      if (!error.status) error.status = /NOT_FOUND/.test(error.code ?? '') ? 404 :
        /CAPACITY/.test(error.code ?? '') ? 429 :
        /CONFLICT|CHANGED|ACTIVE|EXISTS|RECOVER|REVIEW|REPLACE|OPERATOR_REQUIRED/.test(error.code ?? '') ? 409 : 400;
      throw error;
    }
  };
  return { additionalAssets, authenticatedRoute };
}
