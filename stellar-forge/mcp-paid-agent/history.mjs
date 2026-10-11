#!/usr/bin/env node
/** MIT. Read-only inspection/export of the same durable MCP quote workspace. */
import { closeSync, fsyncSync, lstatSync, openSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { SqliteQuoteStore } from './quote-store.mjs';
import { historyPage } from './quote-history.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const csv = value => {
  let text = String(value ?? '');
  if (/^[=+@-]/.test(text) || /^[\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};
const time = value => new Date(value).toISOString();

export function renderHistory(data, format) {
  if (format === 'json') return JSON.stringify(data, null, 2) + '\n';
  if (format === 'csv') {
    const rows = [['quote_id', 'created_at', 'updated_at', 'status', 'phase', 'method', 'request_url',
      'network', 'asset', 'amount_atomic', 'recipient', 'signed_dispatch_recorded', 'transaction', 'failure',
      'result_status', 'result_bytes', 'result_sha256', 'result_path', 'result_manifest_status']];
    for (const q of data.quotes) rows.push([q.quoteId, time(q.createdAt), time(q.updatedAt), q.status,
      q.phase, q.method, q.url, q.accepted.network, q.accepted.asset, q.accepted.amount,
      q.accepted.payTo, q.signedRequestDispatched, q.result?.paymentResponse?.transaction, q.failure,
      q.result?.responseFile?.status, q.result?.responseFile?.bytes, q.result?.responseFile?.sha256,
      q.result?.responseFile?.path, q.result?.responseFile?.manifestStatus]);
    return rows.map(row => row.map(csv).join(',')).join('\r\n') + '\r\n';
  }
  if (format !== 'html') throw new TypeError('Format must be json, csv or html');
  const rows = data.quotes.map(q => `<tr><td><code>${escape(q.quoteId)}</code><small>${escape(time(q.createdAt))}</small></td>
    <td><strong>${escape(q.status)}</strong><small>${escape(q.phase)}</small></td>
    <td>${escape(q.method)}<small class="url">${escape(q.url)}</small></td>
    <td><code>${escape(q.accepted.amount)}</code><small>${escape(q.accepted.network)} · ${escape(q.accepted.asset)}</small></td>
    <td>${q.signedRequestDispatched ? 'Recorded before dispatch' : 'Not recorded'}<small>${escape(q.failure)}</small></td>
    <td>${escape(q.result?.responseFile?.status ?? 'Preview metadata')}
      ${q.result?.responseFile ? `<small>${escape(q.result.responseFile.bytes ?? 0)} bytes · ${escape(q.result.responseFile.manifestStatus ?? 'No completion manifest')}</small>
      <small><code>${escape(q.result.responseFile.sha256)}</code></small>` : ''}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
    <title>Stellar MCP · Quote workspace</title><style>
    *{box-sizing:border-box}body{margin:0;background:#f5f5f4;color:#222;font:14px/1.5 system-ui,sans-serif}
    header,main{max-width:1440px;margin:auto;padding:24px}header{border-bottom:1px solid #bcbcbc}
    h1{font-size:24px;font-weight:600;margin:0 0 8px}p{max-width:95ch;margin:8px 0}.meta{font-size:12px;color:#555}
    .table{overflow:auto;background:#fff;border:1px solid #bcbcbc}table{border-collapse:collapse;width:100%;min-width:860px}
    th,td{text-align:left;vertical-align:top;padding:14px;border-bottom:1px solid #ddd}th{font-size:12px;text-transform:uppercase;background:#eee}
    td{min-width:160px}small{display:block;color:#555;margin-top:5px;overflow-wrap:anywhere}code{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}
    .url{max-width:350px}details{margin-top:20px;border:1px solid #bcbcbc;background:#fff;padding:16px}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px}
    @media print{body{background:#fff}header,main{padding:10px}details{break-inside:avoid}th{background:#eee}}
    </style></head><body><header><h1>Stellar MCP / Quote workspace</h1>
    <p>Saved operator quotes, execution checkpoints and recovery status.</p><p class="meta">Generated ${escape(data.generatedAt)} · ${data.quotes.length} of ${data.total} matching quotes</p></header>
    <main><p>Amounts are original atomic units. A dispatch checkpoint records a possible seller request; a server receipt records the seller's settlement claim. SQLite keeps receipt and file metadata. Complete remote MCP results live in this workspace's private result directory; use the result inbox or result-cli.mjs to read and export them.</p>
    <div class="table"><table><thead><tr><th>Quote / created</th><th>State</th><th>Request</th><th>Original terms</th><th>Dispatch / recovery</th><th>Saved result</th></tr></thead><tbody>${rows || '<tr><td colspan="6">No matching quotes.</td></tr>'}</tbody></table></div>
    ${data.nextCursor ? `<p class="meta">More records are available. Continue with cursor <code>${escape(data.nextCursor)}</code>.</p>` : ''}
    <details><summary>Original saved metadata${data.transitions ? ' and checkpoint history' : ''}</summary><pre>${escape(JSON.stringify(data, null, 2))}</pre></details></main></body></html>\n`;
}

export function inspectWorkspace({ directory, quoteId, status, limit = 25, cursor } = {}) {
  const store = new SqliteQuoteStore({ directory, readOnly: true });
  try {
    const records = store.load();
    if (quoteId) {
      const quote = records.find(q => q.quoteId === quoteId);
      if (!quote) throw Object.assign(new Error('Unknown quote'), { code: 'QUOTE_UNKNOWN' });
      return { generatedAt: new Date().toISOString(), quotes: [quote], total: 1, nextCursor: null,
        transitions: store.transitions(quoteId) };
    }
    return { generatedAt: new Date().toISOString(), ...historyPage(records, { status, limit, cursor }) };
  } finally { store.close(); }
}

function main(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--state-dir', '--quote', '--status', '--limit', '--cursor', '--format', '--out'].includes(args[index]) ||
        !args[index + 1] || options[args[index]] !== undefined) throw new TypeError('Invalid or duplicate history option');
    options[args[index]] = args[index + 1];
  }
  const data = inspectWorkspace({ directory: options['--state-dir'], quoteId: options['--quote'],
    status: options['--status'], limit: options['--limit'] === undefined ? 25 : Number(options['--limit']), cursor: options['--cursor'] });
  const output = renderHistory(data, options['--format'] ?? 'json');
  const target = options['--out'];
  if (!target) { process.stdout.write(output); return; }
  if (!isAbsolute(target)) throw new TypeError('Use an absolute private output path');
  const parent = lstatSync(dirname(target));
  if (!parent.isDirectory() || parent.isSymbolicLink() || (parent.mode & 0o077) ||
      (typeof process.getuid === 'function' && parent.uid !== process.getuid())) throw new TypeError('Output parent must be a private owned directory');
  const fd = openSync(target, 'wx', 0o600);
  try { writeFileSync(fd, output); fsyncSync(fd); } finally { closeSync(fd); }
  process.stdout.write(JSON.stringify({ saved: target, quotes: data.quotes.length, total: data.total, nextCursor: data.nextCursor }) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(process.argv.slice(2)); }
  catch (failure) { process.stderr.write(`Quote history: ${failure.code ?? 'INVALID_INPUT'}: ${failure.message}\n`); process.exitCode = 2; }
}
