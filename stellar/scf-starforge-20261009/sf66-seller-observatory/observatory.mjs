// MIT. SF66 local merchant observatory. Original SF52 diagnoses; original SF64 interprets.
// No settlement, signing, purchases, scheduler, telemetry service, or external messaging.
import { readFile, writeFile, mkdir, open } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HASH_ZERO = '0'.repeat(64);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const safeId = id => typeof id === 'string' && /^[a-z][a-z0-9_-]{0,47}$/.test(id);
const string = x => x === null || x === undefined ? '' : String(x);
const esc = x => string(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const json = x => JSON.stringify(x, null, 2) + '\n';
const eventHash = x => digest(JSON.stringify(Object.fromEntries(Object.entries(x).filter(([k]) => k !== 'hash'))));

export function checkTargets(config) {
  if (!config || !Array.isArray(config.targets) || config.targets.length < 1 || config.targets.length > 32)
    throw new TypeError('config.targets must contain 1..32 opt-in merchants');
  const ids = new Set();
  return config.targets.map(t => {
    if (!t || !safeId(t.id) || ids.has(t.id)) throw new TypeError('Invalid or duplicate target id');
    ids.add(t.id);
    if (!t.resource || !t.catalog || !['stellar:testnet', 'stellar:pubnet'].includes(t.network))
      throw new TypeError('Target requires real resource/catalog and explicit Stellar network');
    for (const input of [t.resource, t.catalog]) {
      if (typeof input !== 'string' || input.length > 2048) throw new TypeError('Invalid URL');
      const u = new URL(input);
      if (u.protocol !== 'https:' || u.username || u.password || u.hash)
        throw new TypeError('Remote HTTPS URL without credentials/fragment required');
    }
    if (t.payTo !== undefined && (typeof t.payTo !== 'string' || t.payTo.length > 256))
      throw new TypeError('Invalid recipient');
    return {id:t.id, resource:new URL(t.resource).toString(), catalog:new URL(t.catalog).toString(),
      network:t.network, payTo:t.payTo || null};
  });
}

function scopeId(target) {
  return digest(JSON.stringify([target.resource, target.catalog, target.network, target.payTo]));
}

function assertEvidencePath(name, id) {
  if (typeof name !== 'string' || !new RegExp(`^evidence/${id}/[0-9]+-[a-f0-9]{12}\\.json$`).test(name))
    throw new TypeError('Unsafe or unexpected evidence location');
}

function assertOriginal(report, target) {
  if (!report || report.schema !== 'stellar-forge.seller-visibility.v1' ||
      report.mode !== 'READ_ONLY_UNAUTHENTICATED' || typeof report.verdict !== 'string' ||
      typeof report.catalog?.complete !== 'boolean' || !report.seller)
    throw new TypeError('Input is not original SF52 diagnostic output');
  if (new URL(report.seller).toString() !== target.resource ||
      new URL(report.catalog.endpoint).toString() !== target.catalog ||
      report.network !== target.network || (target.payTo && report.desiredPayTo !== target.payTo))
    throw new TypeError('SF52 report scope does not match selected merchant config');
  return report;
}

function eventState(report) {
  return {verdict:report.verdict, challenge:report.challenge.state,
    catalogComplete:report.catalog.complete, pages:report.catalog.pages,
    matches:report.catalog.matchingResourceCount};
}

export async function history(dataDir, {verifyEvidence = true, validate = null} = {}) {
  let data = '';
  try { data = await readFile(join(dataDir, 'history.jsonl'), 'utf8'); }
  catch (err) { if (err.code !== 'ENOENT') throw err; }
  if (data && !data.endsWith('\n')) throw new Error('Truncated history; manual recovery required');
  const events = [];
  let previous = HASH_ZERO;
  for (const line of data.split('\n').filter(Boolean)) {
    const event = JSON.parse(line);
    if (!safeId(event.id) || event.seq !== events.length + 1 || event.prevHash !== previous ||
      !/^[a-f0-9]{64}$/.test(event.hash) || event.hash !== eventHash(event) ||
      !/^[a-f0-9]{64}$/.test(event.scope) || !/^[a-f0-9]{64}$/.test(event.evidenceSha256))
      throw new Error(`Tampered or incoherent ledger at record ${events.length + 1}`);
    assertEvidencePath(event.evidence, event.id);
    if (verifyEvidence) {
      const bytes = await readFile(join(dataDir, event.evidence));
      if (digest(bytes) !== event.evidenceSha256) throw new Error(`Evidence hash mismatch: ${event.id}/${event.seq}`);
      const report = JSON.parse(bytes.toString('utf8'));
      if (validate) validate(report);
      if (JSON.stringify(eventState(report)) !== JSON.stringify(event.observation))
        throw new Error(`Observed classification changed: ${event.id}/${event.seq}`);
    }
    events.push(event);
    previous = event.hash;
  }
  return events;
}

function compare(previous, current) {
  if (!previous) return 'FIRST_OBSERVATION';
  if (previous.scope !== current.scope) return 'SOURCE_SCOPE_CHANGED';
  const a = previous.observation, b = current.observation;
  if (a.verdict === 'LISTED' && b.verdict === 'NOT_LISTED_IN_EXHAUSTED_CATALOG' && b.catalogComplete)
    return 'LISTING_REGRESSION';
  if (a.challenge === 'X402_402' && b.challenge !== 'X402_402') return 'CHALLENGE_REGRESSION';
  if (!b.catalogComplete) return 'CATALOG_INCONCLUSIVE';
  if (a.verdict !== b.verdict || a.challenge !== b.challenge) return 'STATUS_CHANGED';
  return 'UNCHANGED';
}

export async function record(dataDir, target, sourceBytes, {origin, observedAt = null, validate, assess} = {}) {
  if (!Buffer.isBuffer(sourceBytes) || sourceBytes.length < 1 || sourceBytes.length > 1_000_000)
    throw new RangeError('Original SF52 JSON must be <=1MiB');
  if (!['SF52_LIVE_GET', 'SF52_IMPORTED_ORIGINAL'].includes(origin)) throw new TypeError('Invalid origin');
  if (observedAt !== null && (!/^\d{4}-\d\d-\d\dT/.test(observedAt) ||
      !Number.isFinite(Date.parse(observedAt)))) throw new TypeError('Invalid source observation timestamp');
  const report = assertOriginal(JSON.parse(sourceBytes.toString('utf8')), target);
  if (validate) validate(report);
  await mkdir(dataDir, {recursive:true, mode:0o700});
  const lock = await open(join(dataDir, '.writer.lock'), 'wx', 0o600);
  try {
    const events = await history(dataDir, {validate});
    const prior = [...events].reverse().find(e => e.id === target.id);
    const seq = events.length + 1;
    const hash = digest(sourceBytes);
    const name = `evidence/${target.id}/${seq}-${hash.slice(0,12)}.json`;
    const evidenceDir = join(dataDir, 'evidence', target.id);
    await mkdir(evidenceDir, {recursive:true, mode:0o700});
    await writeFile(join(dataDir, name), sourceBytes, {flag:'wx', mode:0o600});
    const event = {schema:'stellar-forge.seller-observation.v1', seq, id:target.id,
      scope:scopeId(target), ingestedAt:new Date().toISOString(), observedAt,
      origin, evidence:name, evidenceSha256:hash, observation:eventState(report),
      prevHash:events.at(-1)?.hash || HASH_ZERO};
    if (assess) {
      const assessment = assess(report);
      event.readiness = assessment.state;
      event.firstAction = assessment.findings.find(f => f.priority === 'HIGH') ||
        assessment.findings.find(f => f.priority === 'MEDIUM') || null;
    }
    event.trend = compare(prior, event);
    event.hash = eventHash(event);
    const log = await open(join(dataDir, 'history.jsonl'), 'a', 0o600);
    try { await log.writeFile(JSON.stringify(event) + '\n'); await log.sync(); }
    finally { await log.close(); }
    return event;
  } finally {
    await lock.close();
    const {unlink} = await import('node:fs/promises');
    await unlink(join(dataDir, '.writer.lock'));
  }
}

export function dashboard(events) {
  const latest = new Map();
  for (const event of events) latest.set(event.id, event);
  const alerts = [...latest.values()].filter(e => /REGRESSION|CHANGED|INCONCLUSIVE/.test(e.trend));
  const rows = [...latest.values()].sort((a,b) => a.id.localeCompare(b.id)).map(e =>
    `<tr><th scope="row">${esc(e.id)}</th><td>${esc(e.observation.challenge)}</td>`+
    `<td>${esc(e.observation.verdict)}</td><td>${e.observation.catalogComplete ? 'Complete' : 'Incomplete'}</td>`+
    `<td>${esc(e.readiness || 'Source only')}</td><td>${esc(e.trend)}</td><td>${esc(e.observedAt || 'Source time unprovided')}</td></tr>`).join('\n');
  const actions = [...latest.values()].filter(e => e.firstAction).map(e =>
    `<li><strong>${esc(e.id)}</strong> (${esc(e.firstAction.priority)}): ${esc(e.firstAction.finding)} `+
    `<span>${esc(e.firstAction.action)}</span></li>`).join('\n');
  const recent = [...events].reverse().slice(0,100).map(e => `<tr><td>${e.seq}</td><td>${esc(e.id)}</td>`+
    `<td>${esc(e.ingestedAt)}</td><td>${esc(e.origin)}</td><td>${esc(e.trend)}</td>`+
    `<td><a href="${esc(e.evidence)}">Original JSON</a> <code>${esc(e.evidenceSha256.slice(0,16))}…</code></td></tr>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'"><title>Merchant Observatory | SF66</title><style>
  :root{color-scheme:light;font:16px system-ui,Arial,sans-serif;color:#17324c;background:#f6f9fb}*{box-sizing:border-box}body{margin:0}.wrap{max-width:1160px;margin:auto;padding:32px 22px 90px}header{border-bottom:3px solid #177b7a;padding-bottom:24px}.eyebrow{color:#14716f;text-transform:uppercase;font-size:12px;letter-spacing:.14em;font-weight:bold}h1{font-size:clamp(2rem,4vw,3rem);margin:8px 0}h2{margin-top:35px}p{line-height:1.5}.stats{display:flex;gap:14px;flex-wrap:wrap}.stat{background:#fff;padding:12px 18px;border:1px solid #d0dce6;border-radius:10px}.stat strong{display:block;font-size:2rem}table{border-collapse:collapse;background:#fff;width:100%;font-size:.9rem}th,td{text-align:left;vertical-align:top;padding:13px 12px;border-bottom:1px solid #d9e3e8;overflow-wrap:anywhere}thead{background:#deeeed}section{overflow-x:auto}.note{padding:20px;background:#eaf3f1;border-left:4px solid #14716f;margin-top:30px}code{font-size:.83rem}@media(max-width:650px){.wrap{padding:22px 12px}table{min-width:700px}}@media print{body{background:white}.wrap{padding:0}}
  </style></head><body><main class="wrap"><header><div class="eyebrow">Stellar Forge · original SF52 input · local-only</div><h1>Merchant observatory</h1><p>Latest observed x402 seller challenge and actual facilitator-catalog visibility. Each row is one configured merchant and original source scope; historical changes can indicate seller regressions.</p><div class="stats"><div class="stat"><strong>${latest.size}</strong> merchants</div><div class="stat"><strong>${events.length}</strong> original reports</div><div class="stat"><strong>${alerts.length}</strong> latest changes to review</div></div></header><section><h2>Merchant status</h2><table><thead><tr><th>Merchant ID</th><th>Seller 402 state</th><th>Catalog observation</th><th>Coverage</th><th>Readiness</th><th>Change</th><th>Source observed UTC</th></tr></thead><tbody>${rows}</tbody></table></section><section><h2>Original SF64 prioritized repair actions</h2><ol>${actions || '<li>No high or medium priority actions in the current state.</li>'}</ol></section><section><h2>Recent original reports</h2><table><thead><tr><th>Seq.</th><th>Merchant</th><th>Ingested UTC</th><th>Source type</th><th>Change</th><th>SHA-256 prefix</th></tr></thead><tbody>${recent}</tbody></table></section><aside class="note"><strong>Interpretation and privacy.</strong> An HTTP 402, a catalog row, and a ledger settlement are different events. Missing listings require complete original pagination; an incomplete catalog never proves absence. Observations were produced by original SF52, not simulated provider records. Imported reports retain separately supplied source observation times, if any. This private static page makes no network requests. The checksum chain detects changes but is not a cryptographic signature or payment proof. Do not publish confidential seller configurations or evidence.</aside></main></body></html>`;
}

export async function render(dataDir, {validate = null} = {}) {
  const events = await history(dataDir, {validate});
  const target = join(dataDir, 'merchant-observatory.html');
  await writeFile(target, dashboard(events), {mode:0o600});
  return {target, count:events.length, merchants:new Set(events.map(x=>x.id)).size};
}

async function main(args) {
  const verb = args.shift();
  const options = {};
  while (args.length) {
    const k = args.shift();
    if (!['--config','--data','--id','--report','--observed-at'].includes(k) || !args.length)
      throw new TypeError('Usage: once|import|verify|render --config CONFIG --data DIR [--id ID --report FILE --observed-at ISO]');
    options[k.slice(2)] = args.shift();
  }
  if (!['once','import','verify','render'].includes(verb) || !options.data) throw new TypeError('Verb and --data required');
  const dataDir = resolve(options.data);
  // Dynamically load original upstream modules, not copied simplified substitutes.
  const {validateOriginalReport, interpret} = await import('../sf64-merchant-conversion-report/report.mjs');
  if (verb === 'verify') {
    const events = await history(dataDir, {validate:validateOriginalReport});
    process.stdout.write(json({verified:events.length, latest:events.at(-1)?.hash || HASH_ZERO})); return;
  }
  if (verb === 'render') { process.stdout.write(json(await render(dataDir, {validate:validateOriginalReport}))); return; }
  if (!options.config) throw new TypeError('--config required for once/import');
  const targets = checkTargets(JSON.parse(await readFile(options.config, 'utf8')));
  if (verb === 'import') {
    const target = targets.find(t=>t.id === options.id);
    if (!target || !options.report) throw new TypeError('Choose a configured --id and original --report');
    const bytes = await readFile(options.report);
    const e = await record(dataDir, target, bytes, {origin:'SF52_IMPORTED_ORIGINAL',
      observedAt:options['observed-at'] || null, validate:validateOriginalReport, assess:interpret});
    process.stdout.write(json({record:e, dashboard:await render(dataDir, {validate:validateOriginalReport})}));
    return;
  }
  const {diagnose} = await import('../sf52-merchant-visibility/diagnose.mjs');
  for (const target of targets) {
    // One original merchant GET and bounded full native facilitator pages at a time.
    const result = await diagnose({resourceUrl:target.resource,catalogUrl:target.catalog,
      network:target.network, payTo:target.payTo || undefined, pageLimit:100,maxPages:500});
    const event = await record(dataDir, target, Buffer.from(json(result)), {origin:'SF52_LIVE_GET',
      observedAt:new Date().toISOString(),validate:validateOriginalReport,assess:interpret});
    process.stdout.write(json({merchant:target.id, seq:event.seq, verdict:event.observation.verdict, trend:event.trend}));
  }
  process.stdout.write(json({dashboard:await render(dataDir,{validate:validateOriginalReport})}));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(err => {process.stderr.write(`SF66: ${String(err.message)}\n`); process.exitCode=1;});
}
