// MIT. Original accounting-server routes and fixed operator assets.
import { readFile } from 'node:fs/promises';
import { WorkspaceError } from '../workspace/store.mjs';
import { NOTICE_BYTES, oneNoticeHeader } from './workspace.mjs';

export async function readSignedNotice(request) {
  const headers = request.rawHeaders ?? request.headers;
  const length = oneNoticeHeader(headers, 'content-length');
  const transferPresent = Array.isArray(headers)
    ? headers.some((value, index) => index % 2 === 0 && String(value).toLowerCase() === 'transfer-encoding')
    : Object.keys(headers ?? {}).some(name => name.toLowerCase() === 'transfer-encoding');
  if (transferPresent ||
      !length || !/^[1-9][0-9]{0,4}$/.test(length) || Number(length) > NOTICE_BYTES ||
      oneNoticeHeader(headers, 'content-type') !== 'application/json')
    throw new WorkspaceError('INVALID_NOTICE_FRAMING', 'Send the original SF98 JSON body and exact content length.', 400);
  const parts = []; let bytes = 0;
  for await (const part of request) {
    bytes += part.length;
    if (bytes > NOTICE_BYTES || bytes > Number(length))
      throw new WorkspaceError('NOTICE_BODY_TOO_LARGE', 'The signed notice exceeds its declared size.', 413);
    parts.push(part);
  }
  if (bytes !== Number(length))
    throw new WorkspaceError('TRUNCATED_NOTICE_BODY', 'The signed notice body is incomplete.', 400);
  return { rawBody: Buffer.concat(parts), headers };
}
export async function handleDeliveryNoticeRequest(controller, { method, path, query = {}, value }) {
  if (path === '/api/delivery-notices' && method === 'GET')
    return { value: await controller.state(query) };
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'api' || parts[1] !== 'delivery-notices') return null;
  if (parts.length === 3 && method === 'GET')
    return { value: await controller.detail(parts[2]) };
  if (parts.length === 4 && parts[3] === 'capture' && method === 'POST')
    return { value: await controller.capture(parts[2], value) };
  return null;
}
export async function deliveryNoticeAsset(path) {
  const files = {
    '/delivery-notices': ['index.html', 'text/html; charset=utf-8'],
    '/delivery-notices/': ['index.html', 'text/html; charset=utf-8'],
    '/delivery-notices/app.mjs': ['app.mjs', 'text/javascript; charset=utf-8'],
    '/delivery-notices/style.css': ['style.css', 'text/css; charset=utf-8'],
  };
  const selected = files[path];
  if (!selected) return null;
  return { bytes: await readFile(new URL('./public/' + selected[0], import.meta.url)), type: selected[1] };
}
