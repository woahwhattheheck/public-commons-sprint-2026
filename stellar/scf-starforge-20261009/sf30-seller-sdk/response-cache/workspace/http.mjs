// MIT. One cache operating interface shared by the original API workspace and CLI host.
import { readFile } from 'node:fs/promises';
import { renderCacheReport } from './reports.mjs';
import { readBrowserAssets } from '../../../distribution/browser-assets.mjs';

const assets = await readBrowserAssets(new URL('./browser-assets.json', import.meta.url));
export async function serveCacheWorkspaceAsset(req, res, pathname) {
  if (req.method !== 'GET' || !assets.has(pathname)) return false;
  const { url, type: contentType } = assets.get(pathname);
  res.writeHead(200, { 'content-type': contentType });
  res.end(await readFile(url));
  return true;
}
export function sendCacheWorkspaceResponse(res, result) {
  const json = typeof result.body !== 'string';
  res.writeHead(result.status ?? 200, { 'content-type': json ? 'application/json; charset=utf-8' : 'text/html; charset=utf-8',
    ...result.headers });
  res.end(json ? JSON.stringify(result.body) : result.body);
}
export async function cacheWorkspaceApi(workspace, { operation, method, query = new URLSearchParams(), body } = {}) {
  const sourceId = query.get('source') || undefined;
  if (method === 'GET') {
    if (operation === 'workspace') return { body: workspace.snapshot({ sourceId,
      offset: Number(query.get('offset') ?? 0), limit: Number(query.get('limit') ?? 50) }) };
    if (operation === 'inspection') return { body: workspace.inspection(query.get('id')) };
    if (operation === 'change') return { body: workspace.change(query.get('id')) };
    if (operation === 'compare') return { body: workspace.compare(query.get('before'), query.get('after')) };
    if (operation === 'export') return { body: workspace.exportWorkspace(),
      headers: { 'content-disposition': 'attachment; filename="merchant-cache-workspace.json"' } };
    if (operation === 'report') return { body: renderCacheReport(workspace.exportWorkspace(), { sourceId }),
      headers: { 'content-disposition': 'attachment; filename="merchant-cache-report.html"' } };
  }
  if (method === 'POST' && body && typeof body === 'object' && !Array.isArray(body)) {
    if (operation === 'inspect') return { body: await workspace.inspect(body.sourceId) };
    if (operation === 'capture') return { body: await workspace.capture(body) };
    if (operation === 'prepare') return { body: workspace.prepare(body) };
    if (operation === 'apply') return { body: await workspace.apply(body) };
    if (operation === 'recover') return { body: await workspace.recover(body) };
    if (operation === 'note') return { body: workspace.annotate(body) };
    if (operation === 'restore') return { body: workspace.restore(body.archive) };
  }
  return { status: 404, body: { error: 'CACHE_WORKSPACE_OPERATION_UNKNOWN' } };
}
