// MIT. Retained Atlas actions on the original loopback HTTP host.
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { openAtlasWorkspace } from './workspace.mjs';

const routes = Object.freeze({
  '/api/workspace/capture/receive-page': ['receivePage', ['name', 'pageText']],
  '/api/workspace/capture/begin': ['beginCapture', ['name', 'sessionText', 'manifestText']],
  '/api/workspace/capture/page': ['putCapturePage', ['captureId', 'file', 'text']],
  '/api/workspace/capture/finish': ['finishCapture', ['captureId']],
  '/api/workspace/selection/save': ['saveSelection', ['captureId', 'pageFile', 'row', 'accept', 'label', 'selectionId']],
  '/api/workspace/selection/prepare': ['prepareSelection', ['selectionId', 'request', 'revision', 'bodyText', 'ticketText']],
  '/api/workspace/selection/handoff': ['createHandoff', ['selectionId', 'revision']],
});
const codeOf = error => /^[A-Z0-9_]{1,160}$/.test(error?.code ?? '')
  ? error.code : 'ATLAS_WORKSPACE_OPERATION_FAILED';
function fail(code, status = 400) { const error = new Error(code); error.code = code; error.status = status; throw error; }
function query(url, fields) {
  if ([...url.searchParams.keys()].some(key => !fields.includes(key) || url.searchParams.getAll(key).length !== 1))
    fail('ATLAS_WORKSPACE_QUERY_INVALID');
  return Object.fromEntries(url.searchParams);
}
function integer(value, fallback) {
  if (value === undefined) return fallback;
  if (!/^(0|[1-9][0-9]{0,8})$/.test(value)) fail('ATLAS_WORKSPACE_RANGE_INVALID');
  return Number(value);
}
async function body(request, fields) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(request.headers['content-type'] ?? ''))
    fail('ATLAS_WORKSPACE_JSON_REQUIRED', 415);
  const maximum = fields.includes('manifestText') ? 17 * 1024 * 1024 : 8 * 1024 * 1024;
  if (request.headers['content-encoding'] || Number(request.headers['content-length']) > maximum)
    fail('ATLAS_WORKSPACE_INPUT_TOO_LARGE', 413);
  const chunks = []; let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maximum) fail('ATLAS_WORKSPACE_INPUT_TOO_LARGE', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
  catch { fail('ATLAS_WORKSPACE_JSON_INVALID'); }
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !fields.includes(key)))
    fail('ATLAS_WORKSPACE_ACTION_FIELDS_INVALID');
  return value;
}

export async function createAtlasWorkspaceHttp({ directory } = {}) {
  const workspace = await openAtlasWorkspace({ directory });
  const token = randomBytes(32).toString('hex'), secret = Buffer.from(token);
  let closed = false;
  return {
    token,
    async handle({ request, url, origin, reply }) {
      if (!url.pathname.startsWith('/api/workspace/')) return false;
      try {
        if (closed) fail('ATLAS_WORKSPACE_CLOSED', 503);
        const supplied = Buffer.from(typeof request.headers['x-atlas-workspace-token'] === 'string'
          ? request.headers['x-atlas-workspace-token'] : '');
        if (supplied.length !== secret.length || !timingSafeEqual(supplied, secret))
          fail('ATLAS_WORKSPACE_SESSION_REQUIRED', 401);
        if (request.headers.origin && request.headers.origin !== origin ||
          request.headers['sec-fetch-site'] && !['none', 'same-origin'].includes(request.headers['sec-fetch-site']))
          fail('ATLAS_WORKSPACE_ORIGIN_REQUIRED', 403);
        if (request.method === 'GET') {
          if (url.pathname === '/api/workspace/summary' && !url.search)
            reply(200, await workspace.summary());
          else if (url.pathname === '/api/workspace/capture') {
            const value = query(url, ['captureId', 'query', 'page', 'pageSize']);
            reply(200, await workspace.capture({ captureId: value.captureId, query: value.query ?? '',
              page: integer(value.page, 0), pageSize: integer(value.pageSize, 50) }));
          } else if (url.pathname === '/api/workspace/selection')
            reply(200, await workspace.selection(query(url, ['selectionId'])));
          else fail('ATLAS_WORKSPACE_ROUTE_NOT_FOUND', 404);
          return true;
        }
        const action = routes[url.pathname];
        if (!action || url.search) fail('ATLAS_WORKSPACE_ROUTE_NOT_FOUND', 404);
        if (request.method !== 'POST') fail('ATLAS_WORKSPACE_POST_REQUIRED', 405);
        if (request.headers.origin !== origin) fail('ATLAS_WORKSPACE_ORIGIN_REQUIRED', 403);
        const value = await body(request, action[1]);
        const output = await workspace[action[0]](value);
        reply(200, output);
      } catch (error) {
        const code = codeOf(error);
        const status = error.status ?? (/CONFLICT|CHANGED|EXISTS|INCOMPLETE|REVISION/.test(code) ? 409
          : /NOT_FOUND/.test(code) ? 404 : /TOO_LARGE|LIMIT_EXCEEDED/.test(code) ? 413 : 400);
        reply(status, { error: code });
      }
      return true;
    },
    async close() { if (closed) return; closed = true; await workspace.close?.(); },
  };
}
