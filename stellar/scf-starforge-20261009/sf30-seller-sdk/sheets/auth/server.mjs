// MIT. Local account/scope review for the original Sheets publisher.
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { fault } from '../../postgres/publisher/files.mjs';
import { withConnectionLock, googleConnectionStatus } from './store.mjs';
import { beginGoogleAuthorization, refreshGoogleConnection, disconnectGoogleConnection, GOOGLE_SCOPES } from './oauth.mjs';

const html = value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
const CSS = 'body{font:16px/1.5 system-ui,sans-serif;color:#171717;background:#f3f3f3;margin:0}main{max-width:850px;margin:auto;padding:32px 20px}h1{font-size:28px;margin:8px 0 20px}h2{font-size:19px}section{background:white;border:1px solid #bdbdbd;padding:20px;margin:18px 0}p{max-width:75ch}dl{display:grid;grid-template-columns:150px minmax(0,1fr);gap:8px 20px}dd{margin:0;overflow-wrap:anywhere}dt{font-weight:600}code{overflow-wrap:anywhere}input{box-sizing:border-box;width:100%;font:inherit;padding:9px;border:1px solid #777}label{display:block;margin:12px 0}button{font:inherit;padding:10px 16px;margin:8px 8px 0 0;background:#222;color:white;border:1px solid #222;cursor:pointer}button.secondary{background:white;color:#222}button:focus-visible,input:focus-visible,a:focus-visible{outline:3px solid #555;outline-offset:3px}.actions{display:flex;flex-wrap:wrap;gap:8px}.note{color:#444}.message{border-left:4px solid #555;padding:12px;background:#e8e8e8}li{overflow-wrap:anywhere}a{color:#171717}@media(max-width:550px){main{padding:16px 12px}section{padding:14px}dl{grid-template-columns:1fr;gap:4px}dd{margin-bottom:10px}button{width:100%}.actions,.actions form{width:100%}}';
function page({ status, flow, message, base, csrf, closed = false }) {
  const hidden = '<input type="hidden" name="csrf" value="' + html(csrf) + '">';
  const action = (name, label, secondary = false) => '<form method="post" action="' + base + name + '">' + hidden +
    '<button' + (secondary ? ' class="secondary"' : '') + '>' + label + '</button></form>';
  const review = flow?.phase === 'review_account';
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Google Sheets connection · Stellar Forge</title><style>' + CSS + '</style><main>' +
    '<p class="note">Stellar Forge / Merchant connections</p><h1>Google Sheets connection</h1>' +
    (message ? '<p class="message" role="status">' + html(message) + '</p>' : '') +
    (closed ? '<section><h2>Connection window closed</h2><p>The saved connection remains available to the publisher. You can close this browser tab.</p></section></main></html>' :
    '<section><h2>Current connection</h2><dl><dt>Status</dt><dd>' + html(status.state.replaceAll('_', ' ')) +
    '</dd><dt>Google account</dt><dd>' + html(status.account?.email ?? 'No account approved') +
    '</dd><dt>Registered client</dt><dd>' + html(status.clientId) +
    '</dd><dt>Access expires</dt><dd>' + html(status.expiresAt ?? 'Not connected') +
    '</dd><dt>Renewable access</dt><dd>' + (status.refreshable ? 'Available; the publisher renews access when needed' : 'Connect an account') +
    '</dd></dl>' + (status.lastFailure ? '<p class="message">' + html(status.lastFailure.code) +
    (status.retryAfter ? ' · Retry after ' + html(status.retryAfter) : '') + '</p>' : '') + '</section>' +
    '<section><h2>Permissions and account review</h2><p>Google grants this client read access to your Google Sheets spreadsheets and your account identity. Google does not restrict this grant to one tab or rectangle. The publisher continues to use only the workbook, range and public columns in your reviewed source plan.</p>' +
    '<p>This connection does not request permission to edit spreadsheets or to read other Drive files.</p><ul>' +
    GOOGLE_SCOPES.map(scope => '<li><code>' + html(scope) + '</code></li>').join('') + '</ul>' +
    (review ? '<h2>Approve the account returned by Google</h2><p><strong>' + html(flow.account.email) +
      '</strong></p><p>Saving this account replaces the connection used by future extractions. Retained published datasets and source observations stay available.</p>' +
      '<div class="actions">' + action('approve', 'Use this Google account') + action('discard', 'Discard this account', true) + '</div>' :
      '<form method="post" action="' + base + 'connect">' + hidden +
      '<label>Expected Google email (optional)<input type="email" name="email" autocomplete="email" value="' + html(status.account?.email ?? '') +
      '"></label><p class="note">If supplied, the account Google returns must match. Google handles sign-in and consent in your browser.</p><button>' +
      (status.state === 'connected' ? 'Reconnect with Google' : 'Connect with Google') + '</button></form>') +
    (flow?.failure ? '<p class="message">' + html(flow.failure) + '</p>' : '') + '</section>' +
    '<section><h2>Connection operations</h2><div class="actions">' +
    (status.state === 'connected' ? action('refresh', 'Refresh access now', true) + action('disconnect', 'Disconnect locally', true) : '') +
    '</div><p>Local disconnect removes the saved tokens and stops new authenticated reads. Existing published data is retained.</p>' +
    (status.state === 'connected' ? '<p>Revoke also asks Google to revoke this client grant. That can affect other connections using the same Google project and account.</p>' +
      action('revoke', 'Disconnect and revoke Google grant', true) : '') +
    (status.remoteRevocation === 'unconfirmed' ? '<p class="message">Local disconnect completed. Google revocation was not confirmed. Review this client in your <a href="https://myaccount.google.com/permissions" rel="noreferrer">Google account connections</a>.</p>' : '') +
    '</section><section><h2>Continue publishing</h2><p>Use the connection directory in your existing Sheets source as <code>connection.oauthDirectory</code>. Publisher plans store only that reference. Tokens are kept in this separate private directory.</p><code>' + html(status.directory) +
    '</code>' + action('close', 'Close connection window', true) + '</section></main></html>');
}
async function form(request) {
  if (!request.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) throw fault('SHEETS_OAUTH_FORM_REQUIRED');
  const parts = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 8192) throw fault('SHEETS_OAUTH_FORM_TOO_LARGE'); parts.push(chunk); }
  return new URLSearchParams(Buffer.concat(parts).toString('utf8'));
}
export async function serveGoogleConnection({ directory, port = 0, fetchImpl = globalThis.fetch, signal } = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw fault('SHEETS_OAUTH_PORT_INVALID');
  await googleConnectionStatus(directory);
  const capability = randomBytes(32).toString('base64url'), csrf = randomBytes(32).toString('base64url');
  const base = '/session/' + capability + '/';
  let flow = null, server, origin, finish, ready, failReady, message = '', closeRequested = false;
  const done = new Promise(resolve => { finish = resolve; });
  const started = new Promise((resolve, reject) => { ready = resolve; failReady = reject; });
  const lifetime = new AbortController();
  const abort = signal ? AbortSignal.any([signal, lifetime.signal]) : lifetime.signal;
  const send = (response, status, body) => {
    response.writeHead(status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
      'referrer-policy': 'no-referrer', 'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://accounts.google.com; base-uri 'none'; frame-ancestors 'none'" });
    response.end(body);
  };
  const redirectHome = response => { response.writeHead(303, { location: origin + base, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }); response.end(); };
  const close = async () => {
    if (closeRequested) return done;
    closeRequested = true; lifetime.abort();
    try { flow?.discard(); } catch (issue) { if (issue.code !== 'SHEETS_OAUTH_APPROVAL_IN_PROGRESS') throw issue; }
    if (server?.listening) await new Promise(resolve => {
      server.close(resolve); server.closeIdleConnections?.();
      setTimeout(() => server.closeAllConnections?.(), 100).unref();
    });
    finish(); return done;
  };
  const held = withConnectionLock(directory, async () => {
    server = createServer(async (request, response) => {
      try {
        if (request.headers.host !== new URL(origin).host || !['127.0.0.1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress) ||
            !request.url || request.url.length > 20000) throw fault('SHEETS_OAUTH_LOCAL_REQUEST_REQUIRED');
        const url = new URL(request.url, origin);
        if (request.method === 'GET' && url.pathname === '/oauth2callback') {
          if (!flow) throw fault('SHEETS_OAUTH_AUTHORIZATION_REQUIRED');
          const callbackFlow = flow;
          try {
            await callbackFlow.complete(url.searchParams);
            if (flow === callbackFlow) message = callbackFlow.view().phase === 'review_account' ? 'Review the Google account below before saving it.' : 'Google authorization did not finish.';
          } catch (issue) { if (flow === callbackFlow) message = issue.code?.startsWith('SHEETS_OAUTH_') ? issue.message : 'Google authorization could not be completed.'; }
          redirectHome(response); return;
        }
        if (request.method === 'GET' && url.pathname === base && !url.search) {
          send(response, 200, page({ status: await googleConnectionStatus(directory), flow: flow?.view(), message, base, csrf })); return;
        }
        if (request.method !== 'POST' || !url.pathname.startsWith(base) || url.search || request.headers.origin !== origin)
          throw fault('SHEETS_OAUTH_LOCAL_REQUEST_REQUIRED');
        const values = await form(request);
        if (values.get('csrf') !== csrf || values.getAll('csrf').length !== 1) throw fault('SHEETS_OAUTH_FORM_INVALID');
        const action = url.pathname.slice(base.length); message = '';
        if (action === 'connect') {
          if (flow?.view().phase === 'exchanging') throw fault('SHEETS_OAUTH_CONNECTION_BUSY');
          flow?.discard();
          flow = await beginGoogleAuthorization(directory, {
            redirectUri: origin + '/oauth2callback', expectedEmail: values.get('email')?.trim() || undefined, fetchImpl, signal: abort,
          });
          response.writeHead(303, { location: flow.authorizationUrl, 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' }); response.end(); return;
        }
        if (action === 'approve') {
          if (!flow) throw fault('SHEETS_OAUTH_ACCOUNT_REVIEW_REQUIRED');
          await flow.approve(); message = 'Account saved. The original publisher can now renew read access.';
        } else if (action === 'discard') { flow?.discard(); message = 'The proposed account was discarded. The prior saved connection was preserved.'; }
        else if (action === 'refresh') { await refreshGoogleConnection(directory, { fetchImpl, signal: abort }); message = 'Google access refreshed.'; }
        else if (action === 'disconnect' || action === 'revoke') {
          const result = await disconnectGoogleConnection(directory, { revoke: action === 'revoke', fetchImpl, signal: abort });
          flow?.discard();
          message = result.remoteRevocation === 'unconfirmed' ? 'Disconnected locally; Google revocation was not confirmed.' : 'Connection disconnected.';
        } else if (action === 'close') {
          send(response, 200, page({ closed: true, base, csrf }));
          setImmediate(() => close().catch(() => {})); return;
        } else throw fault('SHEETS_OAUTH_ACTION_INVALID');
        redirectHome(response);
      } catch (issue) {
        if (response.headersSent) { response.destroy(); return; }
        message = issue.code?.startsWith('SHEETS_OAUTH_') ? issue.message : 'This connection operation could not complete. Check its private directory and try the requested operation again.';
        if (origin && request.headers.host === new URL(origin).host && request.method === 'POST') { redirectHome(response); return; }
        send(response, 400, '<!doctype html><title>Connection request</title><p>' + html(message) + '</p>');
      }
    });
    server.requestTimeout = 35000; server.headersTimeout = 10000;
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    origin = 'http://127.0.0.1:' + server.address().port;
    ready(); await done;
  }, { name: 'connect.lock', waitSeconds: 0, signal: abort });
  held.catch(failReady); await started;
  const onAbort = () => close().catch(() => {});
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  done.finally(() => signal?.removeEventListener('abort', onAbort));
  return { url: origin + base, origin, port: server.address().port,
    close: async () => { await close(); await held; }, done: held, status: () => googleConnectionStatus(directory) };
}
