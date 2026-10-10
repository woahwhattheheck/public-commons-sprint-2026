#!/usr/bin/env node
// MIT. SF58: read-only, offline merchant reconciliation export.
// Runs the ORIGINAL SF52 source-contract aggregator. No signer, RPC, facilitator,
// payments, invoice issuance, external communications, or hosted CI.
import { readFile, lstat, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { aggregateOutcomes, VERSION as OUTCOME_SCHEMA } from '../sf52-buyer-outcomes/outcomes.mjs';

const MAX_INPUT_BYTES = 8 * 1024 * 1024;
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const clean = v => v === null || v === undefined ? '' : String(v);
const html = v => clean(v).replace(/[&<>"']/g, c => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
})[c]);
function csv(v) {
  let s = clean(v);
  // Spreadsheet applications can execute formulas in untrusted cells.
  if (/^[\s]*[=+@\-\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}
function gitBlob(bytes) {
  return createHash('sha1').update(Buffer.from('blob ' + bytes.length + '\0')).update(bytes).digest('hex');
}
function makeCsv(rows) {
  const fields = ['intentId', 'observedAt', 'result', 'reviewLane', 'network', 'asset',
    'atomicAmount', 'signedAttempt', 'sellerReportedSuccess', 'independentlyVerifiedTransfer',
    'httpBodyObserved', 'ledger', 'transaction', 'chainEvidence'];
  return fields.join(',') + '\n' + rows.map(row =>
    fields.map(field => csv(row[field])).join(',')).join('\n') + (rows.length ? '\n' : '');
}
function auditHTML(report) {
  const { counts, verifiedAtomicByAsset, entries } = report;
  const maxRendered = 2000;
  const rows = entries.slice(0, maxRendered).map(e =>
    '<tr><td>' + html(e.intentId) + '</td><td>' + html(e.reviewLane) +
    '</td><td>' + html(e.result) + '</td><td>' + html(e.network) +
    '</td><td>' + html(e.atomicAmount) + '</td><td>' + html(e.ledger) +
    '</td><td class="hash">' + html(e.transaction) + '</td></tr>').join('\n');
  const totals = verifiedAtomicByAsset.map(a =>
    '<tr><td>' + html(a.network) + '</td><td class="hash">' + html(a.asset) +
    '</td><td>' + html(a.atomicTotal) + '</td></tr>').join('\n');
  const css = 'body{font:15px/1.6 system-ui,sans-serif;margin:0 auto;padding:2rem;max-width:1250px;background:#0c1524;color:#e8edf6}' +
    'h1{line-height:1.2}p{max-width:84ch}a{color:#8dc4ff}table{border-collapse:collapse;width:100%;font-size:13px}' +
    'th,td{text-align:left;border-bottom:1px solid #334257;padding:8px;vertical-align:top;overflow-wrap:anywhere}' +
    'th{color:#a8c3e6}section{margin-top:2rem}.cards{display:flex;flex-wrap:wrap;gap:12px}' +
    '.cards div{background:#17283c;border:1px solid #405a77;border-radius:12px;padding:12px 20px;min-width:140px}' +
    '.cards strong{display:block;font-size:28px}.hash{font-family:ui-monospace,monospace;overflow-wrap:anywhere}' +
    '.notice{padding:16px;border-left:4px solid #ffc05c;background:#20283b}.scroller{overflow:auto}';
  return '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Stellar Forge | merchant operator evidence</title><style>' + css + '</style></head><body>' +
    '<h1>Stellar Forge: merchant reconciliation</h1>' +
    '<p class="notice"><strong>Operator evidence, not an invoice.</strong> Verified rows are independent Stellar <em>testnet</em> transfer observations. They are not booked revenue, a mainnet payout, proof of customer satisfaction, a spending authorization or an SCF award. Unverified rows are never included in verified atomic totals. No external network or payment calls were made by this export.</p>' +
    '<div class="cards"><div><strong>' + counts.total + '</strong>Observed intents</div>' +
    '<div><strong>' + counts.verifiedTransfers + '</strong>Verified testnet transfers</div>' +
    '<div><strong>' + counts.transferAndBodyObserved + '</strong>With HTTP body observed</div>' +
    '<div><strong>' + counts.reviewRequired + '</strong>Needs review / not chain-verified</div></div>' +
    '<section><h2>Source identity</h2><p>SF52 original source: <code>' + html(report.source.gitBlobSha1) +
    '</code> (Git blob). Original input SHA-256: <code>' + html(report.source.inputSha256) +
    '</code>. Generated UTC: ' + html(report.generatedAt) + '.</p></section>' +
    '<section><h2>Verified testnet amounts by asset</h2><p>Amounts are exact atomic token units, with no fiat exchange rate or net-revenue assumption.</p>' +
    '<div class="scroller"><table><thead><tr><th>Network</th><th>Asset contract</th><th>Verified atomic total</th></tr></thead><tbody>' +
    totals + '</tbody></table></div></section>' +
    '<section><h2>Outcome ledger</h2><p>Read-only snapshot. The accompanying <code>audit.csv</code> contains all ' +
    counts.total + ' normalized intents; this page shows at most ' + maxRendered + '.</p>' +
    '<div class="scroller"><table><thead><tr><th>Intent</th><th>Review lane</th><th>Actual SF52 result</th>' +
    '<th>Network</th><th>Atomic amount</th><th>Ledger</th><th>Matched transaction</th></tr></thead><tbody>' +
    rows + '</tbody></table></div></section>' +
    '<footer><p>Only SF52 independently matched original SF43 transfer evidence produces a transaction in this report. Full unredacted source observations remain under the operator’s custody. No payment credential, response body or raw signer payload is exported.</p></footer>' +
    '</body></html>\n';
}

/** Original-SF52-first audit. Records must be source-normalized SF52 inputs. */
export function makeOperatorReport(records, source = {}) {
  // This call enforces original invariant and duplicate-transfer-proof checks.
  // Do not catch a failure and silently publish a partial billing view.
  const native = aggregateOutcomes(records);
  const original = new Map(records.map(r => [r.intentId, r]));
  const entries = native.outcomes.map(o => {
    const record = original.get(o.intentId);
    const verified = o.independentlyVerifiedTransfer === true;
    const lane = verified ? (o.observedHttpBody ?
      'TESTNET_TRANSFER_AND_BODY_OBSERVED' : 'TESTNET_TRANSFER_DELIVERY_UNCONFIRMED') :
      (o.sellerReportedSuccess ? 'SELLER_ONLY_NEEDS_CHAIN_PROOF' :
      (o.signedAttempt ? 'SIGNED_OR_PENDING_NEEDS_RECONCILIATION' : 'NO_VERIFIED_PAID_TRANSFER'));
    return {
      intentId: o.intentId,
      observedAt: o.observedAt,
      result: o.status,
      reviewLane: lane,
      network: o.network,
      asset: o.asset,
      atomicAmount: o.amountAtomic,
      signedAttempt: o.signedAttempt,
      sellerReportedSuccess: o.sellerReportedSuccess,
      independentlyVerifiedTransfer: verified,
      httpBodyObserved: o.observedHttpBody,
      ledger: verified ? o.ledger : null,
      // SF52 has independently reconciled the receipt, exact payee, asset and
      // amount with SF43 testnet event before this branch is reachable.
      transaction: verified ? record.chain.transaction : null,
      chainEvidence: o.chainEvidence
    };
  });
  const counts = { ...native.counts, reviewRequired: entries.filter(e => !e.independentlyVerifiedTransfer).length };
  const report = {
    schema: 'scf58.merchant-operator-report.v1',
    generatedAt: native.generatedAt,
    source: {
      inputSha256: source.inputSha256 || null,
      gitBlobSha1: source.gitBlobSha1 || null,
      sourceSha256: source.sourceSha256 || null,
      importedOutcomeSchema: OUTCOME_SCHEMA
    },
    counts,
    verifiedAtomicByAsset: native.observedTransferAtomicByAsset,
    entries,
    interpretation: 'Testnet transfer evidence and original SF52 outcome states only; no invoice, customer payment, booked revenue, USD estimate, public-mainnet proof, grant eligibility or grant submission.'
  };
  return {
    report,
    csv: makeCsv(entries),
    html: auditHTML(report)
  };
}

/** By default fails instead of overwriting any existing evidence directory. */
export async function runCli(args = process.argv.slice(2)) {
  if (args.length !== 4 || !args.includes('--input') || !args.includes('--out') ||
      args.filter(x => x === '--input').length !== 1 || args.filter(x => x === '--out').length !== 1)
    throw new Error('USAGE: node report.mjs --input source-observations.json --out NEW_OUTPUT_DIRECTORY');
  const input = args[args.indexOf('--input') + 1];
  const output = args[args.indexOf('--out') + 1];
  if (!input || !output || input.startsWith('--') || output.startsWith('--'))
    throw new Error('Invalid input or output argument');
  const stat = await lstat(input);
  if (!stat.isFile() || stat.size > MAX_INPUT_BYTES)
    throw new Error('Only regular observation input files up to 8 MiB');
  const raw = await readFile(input);
  if (raw.length > MAX_INPUT_BYTES) throw new Error('Input grew beyond 8 MiB');
  const records = JSON.parse(raw.toString('utf8'));
  const nativePath = fileURLToPath(new URL('../sf52-buyer-outcomes/outcomes.mjs', import.meta.url));
  const nativeBytes = await readFile(nativePath);
  const made = makeOperatorReport(records, {
    inputSha256: sha256(raw),
    gitBlobSha1: gitBlob(nativeBytes),
    sourceSha256: sha256(nativeBytes)
  });
  await mkdir(resolve(output), { mode: 0o700 });
  await writeFile(resolve(output, 'summary.json'), JSON.stringify(made.report, null, 2) + '\n',
    { flag:'wx', mode:0o600 });
  await writeFile(resolve(output, 'audit.csv'), made.csv, { flag:'wx', mode:0o600 });
  await writeFile(resolve(output, 'index.html'), made.html, { flag:'wx', mode:0o600 });
  process.stdout.write(JSON.stringify({
    output: resolve(output),
    observedIntents: made.report.counts.total,
    independentlyVerifiedTestnetTransfers: made.report.counts.verifiedTransfers,
    reviewRequired: made.report.counts.reviewRequired,
    originalSF52Blob: made.report.source.gitBlobSha1,
    paymentsInitiated: 0
  }, null, 2) + '\n');
  return made.report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  runCli().catch(e => { process.stderr.write('SF58: ' + e.message + '\n'); process.exitCode = 2; });
