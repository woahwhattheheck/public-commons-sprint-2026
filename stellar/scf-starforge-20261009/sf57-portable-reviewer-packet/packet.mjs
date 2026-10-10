// MIT. Portable, offline, unauthenticated checksums for first-party SF53 local evidence.
// This module never makes HTTP calls, signs transactions, or submits grant material.
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile, lstat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const SCHEMA = 'stellar-forge.sf57.portable-reviewer.v1';
const EXPECTED = 'stellar-forge.sf53.local-proof.v1';
const hash = content => createHash('sha256').update(content).digest('hex');
const esc = value => String(value ?? '—').replace(/[&<>"']/g, ch => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[ch]);
const goodNumber = x => Number.isSafeInteger(x) && x >= 0;

function canonical(value, depth = 0) {
  if (depth > 24) throw new TypeError('Evidence nesting limit');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(x => canonical(x, depth + 1));
  if (typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value))) {
    const result = {};
    for (const k of Object.keys(value).sort()) {
      if (k === '__proto__' || k === 'constructor' || k === 'prototype') throw new TypeError('Unsafe evidence key');
      result[k] = canonical(value[k], depth + 1);
    }
    return result;
  }
  throw new TypeError('Non-JSON evidence value');
}

function normalize(report) {
  const r = canonical(report);
  const encoded = JSON.stringify(r);
  if (Buffer.byteLength(encoded) > 1024 * 1024) throw new RangeError('Evidence exceeds 1 MiB limit');
  if (r?.schema !== EXPECTED || !r?.commerce || !r?.release || !r?.wire || !r?.restrictions) {
    throw new TypeError('Expected real SF53 report schema and evidence sections');
  }
  if (typeof r.observedAt !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(r.observedAt) ||
      new Date(r.observedAt).toISOString() !== r.observedAt) throw new TypeError('Invalid observation timestamp');
  const keys = [
    'browserCanTriggerPayment', 'browserCanTriggerAdditionalRuns', 'testnetSettlementProved',
    'mainnetDeploymentProved', 'buyerOrMerchantAdoptionProved', 'scfApplicationSubmitted',
  ];
  if (keys.some(k => r.restrictions[k] !== false)) throw new TypeError('SF53 restriction contract changed');
  return r;
}

function classification(r) {
  const source = r.release;
  const allCounters = [r.commerce.signedRequests, r.commerce.paidCalls,
    r.commerce.testnetTransactions, r.wire.signedRequests, r.wire.signingCallbacks,
    r.wire.chainTransactions, source.changedPins, source.missingOrUnreadable];
  const passed = r.commerce.status === 'PASS_LOCAL_SOURCE_SMOKE' &&
    source.status === 'PASS_SOURCE_CONTRACTS_ONLY' &&
    r.wire.status === 'PASS_DENIED_WIRE_POLICY' &&
    allCounters.every(goodNumber) && allCounters.every(x => x === 0) &&
    Array.isArray(source.failures) && source.failures.length === 0;
  return passed ? 'SOURCE_CONTRACTS_PASS_ONLY' : 'REVIEW_REQUIRED';
}

function listRows(rows, keys) {
  if (!Array.isArray(rows)) return '<tr><td colspan="3">Not recorded</td></tr>';
  return rows.slice(0, 300).map(row => '<tr>' + keys.map(k => `<td>${esc(row?.[k])}</td>`).join('') + '</tr>').join('') || '<tr><td colspan="3">No rows</td></tr>';
}

export function renderPacket(input) {
  const report = normalize(input);
  const json = JSON.stringify(report, null, 2) + '\n';
  const reportSha256 = hash(json);
  const status = classification(report);
  const issues = [...(report.release.warnings ?? []), ...(report.release.failures ?? []),
    report.commerce.detail, report.release.detail, report.wire.detail].filter(x => typeof x === 'string');
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'">
<title>Stellar Forge · Portable reviewer evidence</title>
<style>*{box-sizing:border-box}body{margin:0;color:#172736;background:#f5f8fa;font:16px/1.55 system-ui,-apple-system,sans-serif}header{padding:3rem max(1rem,calc((100vw - 1030px)/2));background:#112e39;color:#f4fff9}h1{font-size:clamp(1.8rem,4vw,2.9rem);line-height:1.12;margin:.6rem 0}h2{font-size:1.18rem}main{max-width:1030px;margin:0 auto;padding:2rem 1rem 4rem}.tag{font-weight:700;letter-spacing:.07em;font-size:.78rem;color:#71f2b9}.summary{padding:1.1rem;border-left:5px solid #b47133;background:#fff7ef;margin-bottom:1.5rem}.summary.pass{border-color:#2a9774;background:#e8f7f1}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(195px,1fr));gap:1rem}.card,section{padding:1.25rem;background:white;border:1px solid #dce5ea;border-radius:12px;margin-bottom:1rem}.card p{margin:.2rem 0;color:#5a6b78}.card strong{overflow-wrap:anywhere}table{width:100%;border-collapse:collapse}th,td{padding:.6rem;text-align:left;border-bottom:1px solid #e4ecef;word-break:break-word}th{font-size:.8rem;color:#3d5865}small,code{overflow-wrap:anywhere}.scroll{overflow-x:auto}footer{max-width:1030px;margin:auto;padding:0 1rem 3rem;color:#61717b}code{font-size:.86em}</style></head><body>
<header><div class="tag">STELLAR FORGE / SCF ENGINEERING</div><h1>Portable reviewer evidence.</h1><p>Offline, source-linked observation. No wallet, commerce authorization, external requests, scripts or hosted Actions.</p><small>Captured ${esc(report.observedAt)}</small></header><main>
<div class="summary ${status === 'SOURCE_CONTRACTS_PASS_ONLY' ? 'pass' : ''}"><strong>${esc(status)}</strong><p>This is a source-contract inspection, not a live payment receipt, third-party endorsement, customer adoption, or an approved/submitted SCF grant.</p></div>
<div class="cards"><div class="card"><p>Source checkout smoke</p><strong>${esc(report.commerce.status)}</strong></div><div class="card"><p>Git source preflight</p><strong>${esc(report.release.status)}</strong></div><div class="card"><p>Seller–buyer HTTP policy</p><strong>${esc(report.wire.status)}</strong></div><div class="card"><p>Signed requests / chain transactions</p><strong>${esc(report.commerce.signedRequests)} / ${esc(report.wire.chainTransactions)}</strong></div></div>
<section><h2>Original local evidence</h2><p>Catalog discovered: <b>${esc(report.commerce.discovered)}</b> · HTTP 402: <b>${esc(report.commerce.seller402)}</b> · Cancelled replay: <b>${esc(report.commerce.cancelledReplay)}</b> · Wire HTTP probes: <b>${esc(report.wire.httpProbes)}</b> · Blocked before approval: <b>${esc(report.wire.blockedBeforeApproval)}</b></p><p>Source pins matched: ${esc(report.release.matchingPins)} · changed: ${esc(report.release.changedPins)} · missing/unreadable: ${esc(report.release.missingOrUnreadable)}</p></section>
<section><h2>First-party source identities</h2><div class="scroll"><table><thead><tr><th>Module</th><th>Status</th><th>Observed Git blob</th></tr></thead><tbody>${listRows(report.release.sources, ['id','status','actualGitBlob'])}</tbody></table></div></section>
<section><h2>Seller–buyer policy decisions</h2><div class="scroll"><table><thead><tr><th>Original HTTP probe</th><th>Decision</th><th>Approval count</th></tr></thead><tbody>${listRows(report.wire.decisions, ['label','denial','approvals'])}</tbody></table></div></section>
<section><h2>Warnings, errors and limitations</h2>${issues.length ? '<ul>' + issues.slice(0, 50).map(x => `<li>${esc(x)}</li>`).join('') + '</ul>' : '<p>No additional source warnings recorded.</p>'}<p>Public grant decision, live authorized Stellar settlement, product revenue and deployment require separate independent evidence. Verify files using the provided checksum manifest; SHA-256 is not a digital signature or proof of who generated these files.</p></section>
<section><h2>Portable bundle integrity</h2><p>SHA-256 of canonical <code>report.json</code>:</p><code>${reportSha256}</code><p><small>Reproduce with: <code>node packet.mjs --verify /path/to/reviewer-packet</code>. This verifies internal file agreement, not an external signer identity.</small></p></section>
</main><footer>Stellar Forge · MIT · Offline reviewer view · Original SF53 observation timestamp retained</footer></body></html>\n`;
  const manifest = {
    schema: SCHEMA, observedAt: report.observedAt, classification: status,
    reportSha256, htmlSha256: hash(html),
    fileNames: ['review.html', 'report.json'],
    checksumOnlyNotSignature: true,
    includesSignedSettlementOrGrantApproval: false,
  };
  return { json, html, manifest: JSON.stringify(manifest, null, 2) + '\n', classification: status };
}

export async function writePacket(report, outputDirectory) {
  if (typeof outputDirectory !== 'string' || !outputDirectory.trim()) throw new TypeError('Output directory required');
  const output = resolve(outputDirectory);
  try { await lstat(output); throw new Error('Output exists; refuse to overwrite reviewer packet'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const built = renderPacket(report);
  await mkdir(dirname(output), { recursive: true });
  const stage = await mkdtemp(join(dirname(output), '.sf57-'));
  try {
    await Promise.all([
      writeFile(join(stage, 'report.json'), built.json, { flag:'wx', mode:0o600 }),
      writeFile(join(stage, 'review.html'), built.html, { flag:'wx', mode:0o600 }),
      writeFile(join(stage, 'manifest.json'), built.manifest, { flag:'wx', mode:0o600 }),
    ]);
    await rename(stage, output);
  } catch (error) { await rm(stage, { recursive:true, force:true }); throw error; }
  return { path: output, classification: built.classification };
}

export async function verifyPacket(directory) {
  const target = resolve(directory);
  const [json, html, manifest] = await Promise.all(['report.json', 'review.html', 'manifest.json']
    .map(p => readFile(join(target, p), 'utf8')));
  const expected = renderPacket(JSON.parse(json));
  if (expected.json !== json || expected.html !== html || expected.manifest !== manifest) {
    throw new Error('Reviewer packet mismatch: report, HTML or manifest was modified');
  }
  return { status: 'FILES_MATCH_CHECKSUMS_ONLY', classification: expected.classification };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, folder] = process.argv.slice(2);
  try {
    if (mode === '--verify' && folder && process.argv.length === 4) {
      console.log(JSON.stringify(await verifyPacket(folder)));
    } else if (mode === '--out' && folder && process.argv.length === 4) {
      const { readOriginalEvidence } = await import('../sf53-local-proof-workbench/serve.mjs');
      const result = await writePacket(await readOriginalEvidence(), folder);
      console.log(JSON.stringify(result));
    } else throw new Error('Usage: node packet.mjs --out NEW_DIRECTORY | --verify EXISTING_DIRECTORY');
  } catch (error) { console.error(String(error.message ?? error)); process.exitCode = 1; }
}
