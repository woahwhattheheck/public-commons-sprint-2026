// MIT. Workbook metadata using the original, host-selected Google grant.
import { fault, object, absolute } from '../../postgres/publisher/files.mjs';
import { spreadsheetId, only, MAX_CAPTURE_BYTES } from '../declaration.mjs';
import { getGoogleAccessToken, googleConnectionStatus } from '../auth/oauth.mjs';

export function normalizeConnections(value = {}) {
  if (!object(value) || Object.keys(value).length > 32) throw fault('SHEETS_CONNECTIONS_INVALID');
  return Object.fromEntries(Object.entries(value).map(([alias, input]) => {
    if (!/^[A-Za-z][A-Za-z0-9_-]{0,47}$/.test(alias) || ['constructor', 'prototype', '__proto__'].includes(alias))
      throw fault('SHEETS_CONNECTION_ALIAS_INVALID');
    only(input, ['label', 'oauthDirectory', 'accessTokenEnv', 'timeoutMs', 'maxResponseBytes'], 'SHEETS_CONNECTION_INVALID');
    if (Object.hasOwn(input, 'oauthDirectory') === Object.hasOwn(input, 'accessTokenEnv'))
      throw fault('SHEETS_CREDENTIAL_REFERENCE_REQUIRED');
    if (input.oauthDirectory !== undefined) absolute(input.oauthDirectory, 'existing Google connection');
    if (input.accessTokenEnv !== undefined && !/^[A-Z][A-Z0-9_]{0,127}$/.test(input.accessTokenEnv))
      throw fault('SHEETS_TOKEN_ENV_REQUIRED');
    if (input.label !== undefined && (typeof input.label !== 'string' || !input.label.trim() || input.label.length > 128))
      throw fault('SHEETS_CONNECTION_LABEL_INVALID');
    for (const [key, low, high] of [['timeoutMs', 100, 180000], ['maxResponseBytes', 1024, MAX_CAPTURE_BYTES]])
      if (input[key] !== undefined && (!Number.isSafeInteger(input[key]) || input[key] < low || input[key] > high))
        throw fault('SHEETS_CONNECTION_LIMIT_INVALID');
    return [alias, { ...input, label: input.label ?? alias }];
  }));
}

export function selectConnection(connections, alias) {
  if (typeof alias !== 'string' || !Object.hasOwn(connections, alias))
    throw fault('SHEETS_CONNECTION_NOT_DECLARED', 'Choose a connection declared by this host.');
  const { label, ...input } = connections[alias];
  return { kind: 'google', ...input };
}

export async function connectionViews(connections, environment) {
  return Promise.all(Object.entries(connections).map(async ([alias, input]) => {
    if (!input.oauthDirectory) return { alias, label: input.label, kind: 'environment',
      state: environment[input.accessTokenEnv] ? 'configured' : 'missing' };
    try {
      const status = await googleConnectionStatus(input.oauthDirectory);
      return { alias, label: input.label, kind: 'renewable', state: status.state,
        account: status.account ?? null, expiresAt: status.expiresAt ?? null };
    } catch (issue) { return { alias, label: input.label, kind: 'renewable', state: 'unavailable',
      error: issue.code ?? 'SHEETS_CONNECTION_UNAVAILABLE' }; }
  }));
}

export function workbookId(input) {
  if (typeof input !== 'string') throw fault('SHEETS_SPREADSHEET_ID_INVALID');
  const text = input.trim();
  if (!text.startsWith('https://')) return spreadsheetId(text);
  let url;
  try { url = new URL(text); } catch { throw fault('SHEETS_SPREADSHEET_ID_INVALID'); }
  const match = /^\/spreadsheets\/d\/([A-Za-z0-9_-]+)(?:\/|$)/.exec(url.pathname);
  if (url.origin !== 'https://docs.google.com' || url.username || url.password || !match)
    throw fault('SHEETS_WORKBOOK_URL_INVALID', 'Use a Google Sheets workbook URL or its exact workbook ID.');
  return spreadsheetId(match[1]);
}

export function metadataView(resource) {
  if (!object(resource) || !Array.isArray(resource.sheets)) throw fault('SHEETS_RESOURCE_INVALID');
  spreadsheetId(resource.spreadsheetId);
  const tabs = resource.sheets.map(item => item?.properties).filter(item => object(item)).map(item => ({
    sheetId: item.sheetId, title: item.title, sheetType: item.sheetType,
    rows: item.gridProperties?.rowCount ?? null, columns: item.gridProperties?.columnCount ?? null,
  }));
  if (!tabs.length || tabs.some(item => !Number.isSafeInteger(item.sheetId) || typeof item.title !== 'string'))
    throw fault('SHEETS_METADATA_INVALID');
  return { spreadsheetId: resource.spreadsheetId, title: resource.properties?.title ?? '',
    locale: resource.properties?.locale ?? null, timeZone: resource.properties?.timeZone ?? null, tabs };
}

/** Only metadata is requested here. Range CellData still uses the original
 * fetchSheetsResource implementation, including its exact selection binding. */
export async function fetchWorkbookMetadata(id, connection, { environment = process.env, signal,
  fetchImpl = globalThis.fetch } = {}) {
  spreadsheetId(id);
  const timeout = AbortSignal.timeout(connection.timeoutMs ?? 30000);
  const abort = AbortSignal.any([timeout, ...(signal ? [signal] : [])]);
  let token = connection.oauthDirectory ? await getGoogleAccessToken(connection.oauthDirectory, { signal: abort }) :
    environment[connection.accessTokenEnv];
  const checkToken = () => {
    if (typeof token !== 'string' || !token.length || token.length > 16384 || /[^\x21-\x7e]/.test(token))
      throw fault('SHEETS_ACCESS_TOKEN_MISSING', 'The declared Google connection needs a valid read-only grant.');
  };
  const url = new URL('https://sheets.googleapis.com/v4/spreadsheets/' + id);
  url.searchParams.set('fields', 'spreadsheetId,properties(title,locale,timeZone),sheets(properties(sheetId,title,sheetType,gridProperties(rowCount,columnCount)))');
  const read = async () => {
    checkToken();
    try { return await fetchImpl(url, { method: 'GET', headers: { authorization: 'Bearer ' + token,
      accept: 'application/json' }, redirect: 'error', signal: abort }); }
    catch { throw fault(signal?.aborted ? 'SHEETS_CAPTURE_CANCELLED' : timeout.aborted ? 'SHEETS_CAPTURE_TIMEOUT' : 'SHEETS_PROVIDER_UNREACHABLE'); }
  };
  let response = await read();
  if (response.status === 401 && connection.oauthDirectory) {
    await response.body?.cancel();
    token = await getGoogleAccessToken(connection.oauthDirectory, { signal: abort, force: true, rejectedAccessToken: token });
    response = await read();
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw fault(({ 400: 'SHEETS_PROVIDER_REQUEST_INVALID', 401: 'SHEETS_AUTH_EXPIRED', 403: 'SHEETS_ACCESS_DENIED',
      404: 'SHEETS_WORKBOOK_NOT_FOUND', 429: 'SHEETS_RATE_LIMITED' })[response.status] ?? 'SHEETS_PROVIDER_FAILED');
  }
  const parts = []; let size = 0;
  try {
    for await (const chunk of response.body ?? []) {
      size += chunk.length;
      if (size > 1048576) throw fault('SHEETS_METADATA_TOO_LARGE');
      parts.push(chunk);
    }
  } catch (issue) { throw issue.code ? issue : fault('SHEETS_RESPONSE_INTERRUPTED'); }
  let resource;
  try { resource = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts))); }
  catch { throw fault('SHEETS_RESOURCE_JSON_INVALID'); }
  if (resource.spreadsheetId !== id) throw fault('SHEETS_SOURCE_IDENTITY_CHANGED');
  return metadataView(resource);
}
