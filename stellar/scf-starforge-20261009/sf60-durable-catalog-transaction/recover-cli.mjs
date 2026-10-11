#!/usr/bin/env node
// MIT. Read-only recovery of a retained ORIGINAL SF60 operator command.
import { constants as FS } from 'node:fs';
import { open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reconcileCatalogOperation } from './workspace-recovery.mjs';

const USAGE = 'node recover-cli.mjs --directory CATALOG --command ORIGINAL_COMMAND.json --out NEW_REPORT.json [--html NEW_REPORT.html]';
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const labels = {'observed-current':'Exact effect is current','observed-superseded':'Exact effect exists; later revision is current',
  'not-observed':'No exact effect in this snapshot','sequence-conflict':'Sequence has different content or provenance',
  'identity-conflict':'Seller or signer differs','unavailable':'Native read unavailable'};

export function renderRecoveryReport(report) {
  if (report?.schema !== 'stellar-forge.catalog-effect-recovery/v1' || !Array.isArray(report.items)) throw new Error('RECOVERY_REPORT_REQUIRED');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Catalog effect recovery · Stellar Forge</title><style>
*{box-sizing:border-box}body{margin:0;background:#f4f4f4;color:#222;font:15px/1.5 system-ui,sans-serif}main{max-width:1100px;margin:auto;padding:36px 24px}header{border-bottom:2px solid #333;padding-bottom:20px}small{font:11px ui-monospace,monospace;color:#666;letter-spacing:1px}h1{font-size:28px;margin:12px 0 8px}h2{font-size:19px}p{overflow-wrap:anywhere}.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:22px 0}.stats>div,article{border:1px solid #ccc;background:#fff;padding:18px}.stats strong{display:block;font-size:26px}.stats span{font-size:12px;color:#666}article{margin:16px 0}article h2{margin:0 0 8px}.state{font-size:12px;border:1px solid #aaa;padding:3px 8px;display:inline-block}dl{display:grid;grid-template-columns:170px minmax(0,1fr);gap:7px 16px;font-size:13px}dt{color:#666}dd{margin:0;overflow-wrap:anywhere}code,pre{font:12px/1.5 ui-monospace,monospace;overflow-wrap:anywhere}pre{white-space:pre-wrap;background:#eee;padding:14px;max-height:420px;overflow:auto}summary{cursor:pointer;font-size:13px}footer{margin-top:28px;border-top:1px solid #ccc;padding-top:14px;color:#666;font-size:12px}@media(max-width:650px){main{padding:24px 16px}.stats{gap:5px}.stats>div{padding:12px}.stats strong{font-size:23px}dl{grid-template-columns:1fr}dd{margin-bottom:8px}h1{font-size:24px}}@media print{body{background:#fff}article{break-inside:avoid}details{display:block}}
</style><main><header><small>STELLAR FORGE / ORIGINAL CATALOG</small><h1>Catalog effect recovery</h1><p>${esc(report.operation)} · ${esc(report.observedAt)}</p><p>${esc(report.interpretation)}</p></header>
<div class="stats"><div><strong>${esc(report.counts.requested)}</strong><span>original operations</span></div><div><strong>${esc(report.counts.observed)}</strong><span>exact effects observed</span></div><div><strong>${esc(report.counts.unavailable)}</strong><span>unavailable reads</span></div></div>
<section><h2>Read snapshot</h2><dl><dt>Coherent catalog head</dt><dd>${report.coherentSnapshot?'Yes':'No — catalog changed during reads, or a read was unavailable'}</dd><dt>Before head</dt><dd><code>${esc(report.beforeHead)}</code></dd><dt>After head</dt><dd><code>${esc(report.afterHead)}</code></dd><dt>Policy SHA-256</dt><dd><code>${esc(report.policySha256)}</code></dd><dt>Native mutations</dt><dd>${esc(report.nativeMutationCalls)}</dd></dl></section>
${report.items.map(item=>`<article><span class="state">${esc(labels[item.state] ?? item.state)}</span><h2>${esc(item.sellerId)} · sequence ${esc(item.sequence)}</h2><p>${esc(item.explanation ?? item.error)}</p><dl><dt>Catalog key</dt><dd><code>${esc(item.catalogKey)}</code></dd><dt>Original source / proof</dt><dd><code>${esc(item.sourceSha256)}</code></dd><dt>Current sequence</dt><dd>${esc(item.currentSequence ?? 'Not returned')}</dd></dl>${item.evidence?`<details><summary>Exact matching native lifecycle evidence</summary><pre>${esc(JSON.stringify(item.evidence,null,2))}</pre></details>`:''}</article>`).join('')}
<footer>Read-only native catalog history. No replay, signature, withdrawal, payment, or automatic state promotion occurred. The companion JSON retains every returned result.</footer></main></html>`;
}
async function readCommand(filename) {
  const handle = await open(filename, FS.O_RDONLY | (FS.O_NOFOLLOW ?? 0));
  try {
    const meta = await handle.stat();
    if (!meta.isFile() || meta.size < 1 || meta.size > 8 * 1024 * 1024) throw new Error('ORIGINAL_COMMAND_FILE_SIZE_INVALID');
    const bytes = Buffer.alloc(meta.size + 1); let size = 0;
    while (size < bytes.length) {
      const part = await handle.read(bytes, size, bytes.length - size, null);
      if (!part.bytesRead) break; size += part.bytesRead;
    }
    if (size !== meta.size) throw new Error('ORIGINAL_COMMAND_FILE_CHANGED');
    let command;
    try { command = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size))); }
    catch { throw new Error('ORIGINAL_COMMAND_JSON_INVALID'); }
    if (!command || typeof command !== 'object' || Array.isArray(command) ||
        Object.keys(command).some(key => !['schema','requestId','operation','input'].includes(key)) ||
        (command.schema !== undefined && command.schema !== 'stellar-forge.catalog-operator-command/v1')) throw new Error('ORIGINAL_COMMAND_ENVELOPE_REQUIRED');
    return command;
  } finally { await handle.close(); }
}
export async function run(argv = process.argv.slice(2)) {
  if (argv.length === 1 && argv[0] === '--help') { console.log(USAGE); return; }
  const options = {};
  if (argv.length % 2) throw new Error(USAGE);
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index], value = argv[index + 1];
    if (!['--directory','--command','--out','--html'].includes(key) || Object.hasOwn(options,key) || !value || value.startsWith('--')) throw new Error(USAGE);
    options[key] = value;
  }
  if (['--directory','--command','--out'].some(key => !options[key])) throw new Error(USAGE);
  const command = await readCommand(options['--command']);
  const opened = []; let complete = false;
  try {
    for (const option of ['--out','--html']) if (options[option]) opened.push({option,path:options[option],handle:await open(options[option],'wx',0o600)});
    const report = await reconcileCatalogOperation({directory:options['--directory'],operation:command.operation,input:command.input,
      expectedPolicySha256:command.input?.expectedPolicy ?? null});
    for (const output of opened) {
      await output.handle.writeFile(output.option === '--html' ? renderRecoveryReport(report) : JSON.stringify(report,null,2)+'\n');
      await output.handle.sync();
    }
    complete = true;
    console.log(JSON.stringify({saved:resolve(options['--out']),...(options['--html']?{html:resolve(options['--html'])}:{}),
      catalogEffects:report.catalogEffects,counts:report.counts,coherentSnapshot:report.coherentSnapshot,nativeMutationCalls:0}));
    return report;
  } finally {
    for (const output of opened) {
      await output.handle.close();
      if (!complete) await unlink(output.path).catch(()=>{});
    }
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  run().catch(error=>{console.error(/^[A-Z][A-Z0-9_]{0,159}$/.test(error?.message??'')?error.message:USAGE);process.exitCode=1;});
}
