/**
 * SF97 Merchant Revenue Operations: joins the ORIGINAL SF30 seller config and
 * ORIGINAL SF30 operations export to merchant-entered commercial terms.
 * No payment collection, verification, signing, remote polling or CI.
 * Node 22+, standard library only, MIT.
 */
import { readFile, mkdir, open } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { run as runNativeReconciliation } from './native-reconcile.mjs';

const SCHEMA = 'stellar-forge.merchant-revenue-ops.v1';
const USDMICRO = 1_000_000n;
const MAX_INPUT = 2 * 1024 * 1024;
const keys = new Set(['--config','--terms','--snapshot','--ops-url','--output','--native-outbox']);
const own = (obj,key) => Object.hasOwn(obj,key);
const digest = data => createHash('sha256').update(data).digest('hex');

function object(x, name) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new TypeError(`${name} must be an object`);
  return x;
}
function exactUsd(value, name, optional = false) {
  if (value === null && optional) return null;
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value))
    throw new TypeError(`${name} must be a USD decimal string with <=6 places${optional ? ' or null' : ''}`);
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * USDMICRO + BigInt((fraction + '000000').slice(0, 6));
}
function usd(n) {
  if (n === null) return null;
  const minus = n < 0n, x = minus ? -n : n;
  const f = String(x % USDMICRO).padStart(6,'0').replace(/0+$/,'');
  return `${minus?'-':''}${x / USDMICRO}${f ? '.'+f : ''}`;
}
function count(x,name) {
  if (!Number.isSafeInteger(x) || x < 0) throw new TypeError(`${name} must be nonnegative safe integer`);
  return BigInt(x);
}
function percentage(a, b) { return b === 0n ? null : `${(a * 10000n / b / 100n)}.${String((a * 10000n / b) % 100n).padStart(2,'0')}`; }
function finiteNonnegative(x, name) {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) throw new TypeError(`${name} must be finite >=0`);
}
function methodFor(route) {
  const method = route.definition?.method || route.offer?.extensions?.bazaar?.info?.input?.method || route.offer?.method || 'GET';
  return String(method).toUpperCase();
}
function priceMetadata(route) {
  if (route.definition) {
    const p = object(route.definition.payment, `route ${route.id}.definition.payment`);
    return {scheme: p.scheme, network: p.network, asset: p.asset, atomicAmount: String(p.amount), payTo: p.payTo};
  }
  const a = route.offer?.accepts?.[0];
  if (!a) throw new TypeError(`route ${route.id} has no offered payment terms`);
  return {scheme:a.scheme, network:a.network, asset:a.asset, atomicAmount:String(a.amount), payTo:a.payTo};
}
function validRoute(route, name) {
  object(route,name);
  if (typeof route.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(route.id) ||
      typeof route.path !== 'string' || !route.path.startsWith('/')) throw new TypeError(`${name}: invalid route identity`);
  return route;
}
function validateSnapshot(snapshot, seller) {
  object(snapshot, 'snapshot');
  if (snapshot.schema !== 'stellar-forge.seller-traffic.v1' || !Array.isArray(snapshot.routes))
    throw new TypeError('Expected unmodified SF30 seller-traffic.v1 export');
  if (typeof snapshot.sessionId !== 'string' || !Number.isFinite(Date.parse(snapshot.startedAt)) ||
      !Number.isFinite(Date.parse(snapshot.capturedAt)) || snapshot.capturedAt < snapshot.startedAt)
    throw new TypeError('Snapshot needs valid session and times');
  if (!['CHALLENGE_ONLY','NATIVE_X402','UNKNOWN'].includes(snapshot.mode)) throw new TypeError('Invalid native seller mode');
  count(snapshot.observerErrors, 'snapshot.observerErrors');
  const seen = new Set();
  for (const raw of snapshot.routes) {
    const r = object(raw,'snapshot route');
    if (!['@unmatched','@method','@invalid'].includes(r.id)) validRoute(r,'snapshot route');
    else if (typeof r.path !== 'string' || r.method !== '-') throw new TypeError('Invalid native aggregate bucket');
    if (seen.has(r.id)) throw new TypeError(`Duplicate snapshot route ${r.id}`);
    seen.add(r.id);
    for (const field of ['started','completed','inFlight','success','challenge','clientError','serverError','other','disconnected','responses']) count(r[field],`${r.id}.${field}`);
    if (r.completed !== r.success+r.challenge+r.clientError+r.serverError+r.other+r.disconnected ||
        r.started !== r.completed+r.inFlight || r.responses !== r.completed-r.disconnected)
      throw new TypeError(`Invalid original traffic counter conservation on route ${r.id}`);
    if (r.latencyP95UpperBoundMs !== null && r.latencyP95UpperBoundMs !== '>15000') finiteNonnegative(r.latencyP95UpperBoundMs, `${r.id}.latencyP95UpperBoundMs`);
  }
  for (const r of seller.routes) {
    const observed = snapshot.routes.find(x=>x.id===r.id);
    if (!observed || observed.path !== r.path || observed.method !== methodFor(r))
      throw new TypeError(`Observed seller route ${r.id} missing or identity differs; use a same-configuration capture`);
  }
  for (const r of snapshot.routes) {
    if (!seller.routes.some(x=>x.id===r.id) && !['@unmatched','@method','@invalid'].includes(r.id))
      throw new TypeError(`Snapshot has unknown original route ${r.id}`);
  }
  return snapshot;
}
function sellerConfig(config) {
  object(config, 'seller config');
  if (config.schema !== 'stellar-forge.seller-service.v1' || !Array.isArray(config.routes) || !config.routes.length)
    throw new TypeError('Expected original seller-service.v1 config');
  const ids = new Set();
  for (const r of config.routes) {
    validRoute(r, 'seller route');
    if (ids.has(r.id)) throw new TypeError(`Duplicate seller route ${r.id}`);
    ids.add(r.id);
    priceMetadata(r);
  }
  return config;
}
function checkTerms(terms, seller) {
  object(terms,'terms');
  if (terms.schema !== SCHEMA) throw new TypeError('Wrong merchant terms schema');
  if (typeof terms.merchantName !== 'string' || !terms.merchantName.trim() || terms.merchantName.length > 160)
    throw new TypeError('merchantName must be 1–160 chars');
  const fixed = exactUsd(terms.sharedMonthlyFixedUsd,'sharedMonthlyFixedUsd',true);
  const defined = object(terms.routes,'terms.routes');
  for (const sellerRoute of seller.routes) {
    const t = object(defined[sellerRoute.id], `terms.routes.${sellerRoute.id}`);
    exactUsd(t.unitPriceUsd, `${sellerRoute.id}.unitPriceUsd`);
    exactUsd(t.perFulfilledUsd, `${sellerRoute.id}.perFulfilledUsd`,true);
    exactUsd(t.perChallengeUsd, `${sellerRoute.id}.perChallengeUsd`,true);
    count(t.monthlyPaidTarget, `${sellerRoute.id}.monthlyPaidTarget`);
    const expected = object(t.expectedPayment, `${sellerRoute.id}.expectedPayment`);
    const actual = priceMetadata(sellerRoute);
    for (const k of ['scheme','network','asset','atomicAmount','payTo']) {
      if (String(expected[k]) !== String(actual[k])) throw new TypeError(`Payment terms drift on ${sellerRoute.id}.${k}`);
    }
    if (typeof t.priceBasis !== 'string' || t.priceBasis.length < 4 || t.priceBasis.length > 300)
      throw new TypeError(`${sellerRoute.id}.priceBasis is mandatory (quote or valuation context)`);
  }
  if (Object.keys(defined).length !== seller.routes.length) throw new TypeError('Each route must have exactly one owner commercial definition');
  return {fixed};
}

export function analyze(seller, snapshot, terms, provenance = {}) {
  sellerConfig(seller);
  validateSnapshot(snapshot,seller);
  const {fixed}=checkTerms(terms,seller);
  const rows=[];
  let targetGross=0n, targetVariable=0n, nominalGross=0n;
  let targetComplete=true, nominalComplete=true;
  for (const route of seller.routes) {
    const stats=snapshot.routes.find(r=>r.id===route.id), term=terms.routes[route.id];
    const quote=exactUsd(term.unitPriceUsd,route.id+'.unitPriceUsd');
    const fulfill=exactUsd(term.perFulfilledUsd,route.id+'.perFulfilledUsd',true);
    const challenge=exactUsd(term.perChallengeUsd,route.id+'.perChallengeUsd',true);
    const target=count(term.monthlyPaidTarget,route.id+'.monthlyPaidTarget');
    const started=count(stats.started,route.id+'.started'), completed=count(stats.completed,route.id+'.completed');
    const success=count(stats.success,route.id+'.success'), challenges=count(stats.challenge,route.id+'.challenge');
    const errors=count(stats.serverError,route.id+'.serverError')+count(stats.disconnected,route.id+'.disconnected');
    const modeledNominal=quote*success;
    const modeledTarget=quote*target;
    const variableTarget=fulfill===null ? null : fulfill*target;
    const contribution=variableTarget===null ? null : modeledTarget-variableTarget;
    const costObserved=(fulfill===null || challenge===null) ? null : fulfill*success+challenge*challenges;
    const possibleContribution=costObserved===null ? null : modeledNominal-costObserved;
    targetGross+=modeledTarget;nominalGross+=modeledNominal;
    if (contribution===null) targetComplete=false; else targetVariable+=variableTarget;
    if (possibleContribution===null) nominalComplete=false;
    const flags=[];
    if (snapshot.mode==='CHALLENGE_ONLY' && success>0n) flags.push('Challenge-only session has 2xx: review route/outcome scope');
    if (errors>0n) flags.push(`${errors} observed 5xx/disconnect outcomes; investigate reliability before estimating retention`);
    if (challenges>0n && success===0n) flags.push('Payment challenges observed without any 2xx service completion');
    if (stats.latencyP95UpperBoundMs === '>15000') flags.push('P95 latency above 15 seconds histogram cap');
    rows.push({routeId:route.id,method:methodFor(route),path:route.path, payment:priceMetadata(route),
      quoteUsd:usd(quote),priceBasis:term.priceBasis,paidTargetMonth:String(target),
      variablePerFulfilledUsd:usd(fulfill),perChallengeUsd:usd(challenge),
      actualAttempts:String(started),actualCompleted:String(completed),actual2xx:String(success),actual402:String(challenges),
      actual5xx:String(stats.serverError),actualDisconnected:String(stats.disconnected),
      httpSuccessPct:percentage(success,completed), latencyP95UpperBoundMs:stats.latencyP95UpperBoundMs,
      modeledNominal2xxValueUsd:usd(modeledNominal),
      modeledObservedVariableCostUsd:usd(costObserved),modeledObservedContributionUsd:usd(possibleContribution),
      plannedMonthlyTargetGrossUsd:usd(modeledTarget),plannedMonthlyTargetVariableCostUsd:usd(variableTarget),
      plannedMonthlyTargetContributionBeforeFixedUsd:usd(contribution),flags});
  }
  const unknown = rows.filter(r=>r.plannedMonthlyTargetVariableCostUsd===null || r.modeledObservedVariableCostUsd===null).map(r=>r.routeId);
  const plannedAfterFixed=targetComplete && fixed!==null ? targetGross-targetVariable-fixed : null;
  const routeIssues=rows.flatMap(r=>r.flags.map(flag=>({routeId:r.routeId,flag})));
  if (snapshot.observerErrors>0) routeIssues.unshift({routeId:'*',flag:`${snapshot.observerErrors} native observer errors; counts may be incomplete`});
  const mismatches=snapshot.routes.filter(r=>r.id.startsWith('@')).filter(r=>r.started>0).map(r=>({routeId:r.id,attempts:r.started}));
  if (mismatches.length) routeIssues.push({routeId:'*',flag:`${mismatches.map(x=>`${x.routeId}=${x.attempts}`).join(', ')} original unmatched/method/invalid attempts excluded from product forecast`});
  return {
    schema:SCHEMA,merchantName:terms.merchantName,sessionId:snapshot.sessionId,
    originalSellerMode:snapshot.mode,observedFrom:snapshot.startedAt,observedUntil:snapshot.capturedAt,
    sourceSha256:provenance,generatedAt:new Date().toISOString(),observerErrors:snapshot.observerErrors,
    overview:{routeCount:rows.length,plannedMonthlyTargetGrossUsd:usd(targetGross),
      plannedMonthlyTargetVariableCostsUsd:targetComplete?usd(targetVariable):null,
      sharedMonthlyFixedUsd:usd(fixed),plannedMonthlyTargetContributionAfterFixedUsd:usd(plannedAfterFixed),
      modeledNominal2xxResponseValueUsd:usd(nominalGross),unknownCostRoutes:unknown,
      observedHttpCompletionIsPaymentEvidence:false},
    routes:rows,issues:routeIssues,
    accounting:'HTTP attempts/2xx/402 are NOT buyer counts, signed payment proofs or revenue. All quote USD, unit costs, and monthly target demand are merchant supplied. 2xx valuation is an IF-all-fulfilled-at-quoted-price counterfactual, never booked receipts. Actual realized payments require external independently checked settlement and customer records.'
  };
}
function escaped(x) {return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
export function html(report) {
  const rs=report.routes.map(r=>`<tr><th scope="row"><b>${escaped(r.routeId)}</b><small>${escaped(r.method)} ${escaped(r.path)}</small></th><td>${escaped(r.actualAttempts)}</td><td>${escaped(r.actual402)}</td><td>${escaped(r.actual2xx)}</td><td>${escaped(r.actual5xx)}</td><td>${escaped(r.actualDisconnected)}</td><td>${escaped(r.quoteUsd)}</td><td>${escaped(r.plannedMonthlyTargetGrossUsd)}</td><td>${escaped(r.plannedMonthlyTargetContributionBeforeFixedUsd??'Unknown')}</td></tr>`).join('');
  const issues=report.issues.length ? report.issues.map(i=>`<li><strong>${escaped(i.routeId)}</strong> ${escaped(i.flag)}</li>`).join('') : '<li>No counters requiring attention in this capture.</li>';
  const pre=report.overview;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Merchant Revenue Operations | ${escaped(report.merchantName)}</title><style>
:root{font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;color:#1c232a;background:#f2f4f5;font-size:15px}*{box-sizing:border-box}body{margin:0}main{max-width:1280px;margin:auto;padding:32px 24px 80px}header{border-bottom:2px solid #2b333b;padding-bottom:22px;display:flex;gap:12px;justify-content:space-between;align-items:end;flex-wrap:wrap}h1{font-size:1.8rem;letter-spacing:-.04em;margin:7px 0}h2{font-size:1.1rem;margin:0 0 15px}p,li{line-height:1.5}.eyebrow{font-size:.7rem;font-weight:750;letter-spacing:.14em;text-transform:uppercase;color:#48555e}.muted,small{color:#59666f}.sub{max-width:75ch;font-size:.9rem}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:24px 0}.card,.panel{background:white;border:1px solid #d2d8dd;padding:22px;border-radius:4px}.card strong{font-size:1.5rem;display:block;margin:10px 0 6px;word-break:break-word}.card p{font-size:.82rem;margin:0;color:#54616a}.panel{margin-top:16px}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;white-space:nowrap}th,td{font-size:.83rem;padding:13px 12px;border-bottom:1px solid #d9dee2;text-align:right}thead th{color:#52606a;font-size:.71rem;text-transform:uppercase;letter-spacing:.04em}th:first-child,td:first-child{text-align:left}tbody th{font-weight:500}tbody small{display:block;font-size:.72rem;margin-top:5px}tbody tr:nth-child(even){background:#f7f8f9}.scroll{overflow-x:auto}ul{padding-left:1.2em}.footer{margin-top:25px;border-top:1px solid #cbd4d8;padding-top:16px;color:#48565f;font-size:.79rem}.tag{padding:6px 10px;font-size:.73rem;border:1px solid #b9c3ca;border-radius:3px;font-weight:650}code{font-size:.8em;word-break:break-all}@media(max-width:680px){main{padding:20px 14px 40px}.cards{grid-template-columns:1fr}.card{padding:17px}h1{font-size:1.45rem}}
@media print{body{background:white}main{padding:0}.card,.panel{break-inside:avoid}.scroll{overflow:visible}thead{display:table-header-group}}
</style></head><body><main><header><div><div class="eyebrow">SF97 / Merchant Revenue Operations / Source-bound operator report</div><h1>${escaped(report.merchantName)}</h1><div class="muted">Session ${escaped(report.sessionId)} · ${escaped(report.originalSellerMode)} · ${escaped(report.observedFrom)} to ${escaped(report.observedUntil)}</div></div><div class="tag">Private local report</div></header><p class="sub">Route-level commercial review from the original SF30 seller traffic counters and seller payment terms, joined to merchant-entered USD valuations and costs. This is not an invoice or a transaction ledger.</p><section class="cards"><article class="card"><span class="eyebrow">Target monthly gross</span><strong>$${escaped(pre.plannedMonthlyTargetGrossUsd)}</strong><p>Merchant targets × owner-valued USD per route, not observed receipts.</p></article><article class="card"><span class="eyebrow">Target contribution</span><strong>${pre.plannedMonthlyTargetContributionAfterFixedUsd===null?'Unknown':'$'+escaped(pre.plannedMonthlyTargetContributionAfterFixedUsd)}</strong><p>After entered variable costs and shared fixed cost; incomplete inputs stay unknown.</p></article><article class="card"><span class="eyebrow">Observed 2xx nominal value</span><strong>$${escaped(pre.modeledNominal2xxResponseValueUsd)}</strong><p>Only if every observed 2xx were billed at today's owner-entered quote; NOT revenue.</p></article></section><section class="panel"><h2>Native seller routes × merchant economics</h2><div class="scroll"><table><thead><tr><th>Route</th><th>Requests</th><th>402</th><th>2xx</th><th>5xx</th><th>D/C</th><th>Quote USD</th><th>Target gross USD</th><th>Target contribution USD*</th></tr></thead><tbody>${rs}</tbody></table></div><p class="muted" style="font-size:.8rem">*Before shared monthly fixed cost. Unmatched/method/invalid request buckets are excluded from product demand. 402 responses are payment challenges, not purchases.</p></section><section class="panel"><h2>Operator review queue</h2><ul>${issues}</ul></section><section class="panel"><h2>Accounting boundary and next commercial decision</h2><p>${escaped(report.accounting)}</p><p>Pair this worksheet with independently checked settlement records and actual cost quotes before making an invoice or a customer revenue claim. Use SF87 when comparing x402 to MPP rail economics; this report does not reimplement that calculator.</p></section><footer class="footer">Seller SHA256 <code>${escaped(report.sourceSha256.seller??'')}</code> · Native operations export SHA256 <code>${escaped(report.sourceSha256.snapshot??'')}</code> · Owner terms SHA256 <code>${escaped(report.sourceSha256.terms??'')}</code><br>Generated ${escaped(report.generatedAt)} · SF97 standalone local output · No network writes, wallets, hosted CI or payments.</footer></main></body></html>`;
}
async function readJson(path, label) {
  const bytes=await readFile(path);
  if (bytes.length > MAX_INPUT) throw new RangeError(`${label} exceeds 2MiB maximum`);
  return {value:JSON.parse(bytes.toString('utf8')), hash:digest(bytes)};
}
function args(argv) {
  const o={};
  for (let i=0;i<argv.length;i+=2) {
    if (!keys.has(argv[i]) || !argv[i+1] || own(o,argv[i])) throw new TypeError('Usage: --config seller-service.json --terms owner-terms.json (--snapshot traffic.json | --ops-url http://127.0.0.1:8424) --output NEW_DIRECTORY');
    o[argv[i]]=argv[i+1];
  }
  if (!o['--config']||!o['--terms']||!o['--output']||Boolean(o['--snapshot'])===Boolean(o['--ops-url'])) throw new TypeError('Specify seller config, owner terms, output and exactly one snapshot source');
  return o;
}
async function liveSnapshot(url) {
  const target=new URL(url);
  if (target.protocol!=='http:' || !['127.0.0.1','localhost'].includes(target.hostname) || target.username || target.password || target.search || target.hash || !target.port || !['/api/snapshot','/export.json'].includes(target.pathname))
    throw new TypeError('Live source must be original loopback operator /api/snapshot or /export.json; do not expose to internet');
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),4000);
  try {
    const res=await fetch(target,{redirect:'error',signal:controller.signal,headers:{accept:'application/json'}});
    if (!res.ok) throw new Error(`Original operator snapshot HTTP ${res.status}`);
    const len=Number(res.headers.get('content-length'));
    if (Number.isFinite(len) && len>MAX_INPUT) throw new RangeError('Snapshot too large');
    const buffer=Buffer.from(await res.arrayBuffer());
    if (buffer.length>MAX_INPUT) throw new RangeError('Snapshot too large');
    return {value:JSON.parse(buffer.toString('utf8')),hash:digest(buffer)};
  } finally {clearTimeout(timeout);}
}
export async function main(argv=process.argv.slice(2)) {
  const a=args(argv);
  const [seller,terms,snapshot]=await Promise.all([
    readJson(a['--config'],'seller config'),readJson(a['--terms'],'merchant terms'),
    a['--snapshot']?readJson(a['--snapshot'],'snapshot'):liveSnapshot(a['--ops-url'].replace(/\/$/,'')+(new URL(a['--ops-url']).pathname==='/'?'/api/snapshot':''))
  ]);
  const report=analyze(seller.value,snapshot.value,terms.value,{seller:seller.hash,terms:terms.hash,snapshot:snapshot.hash});
  const out=resolve(a['--output']);
  await mkdir(out,{recursive:false,mode:0o700});
  for (const [name,contents] of [['report.json',JSON.stringify(report,null,2)+'\n'],['review.html',html(report)]]) {
    const handle=await open(join(out,name),'wx',0o600);
    try {await handle.writeFile(contents,'utf8');} finally {await handle.close();}
  }
  // When the actual native SDK SF98 journal exists, join it to THIS actual original
  // observer session. Retain existing SF97 CLI/output intact without this opt-in.
  let native = null;
  if (a['--native-outbox']) {
    native = await runNativeReconciliation({
      reportPath: join(out, 'report.json'),
      outboxDir: resolve(a['--native-outbox']),
      outDir: join(out, 'native-settlement')
    });
  }
  process.stdout.write(JSON.stringify({status:'REPORT_CREATED',directory:out,
    files:['report.json','review.html',...(native?['native-settlement/']:[])],
    session:report.sessionId,routes:report.routes.length,issues:report.issues.length,
    mode:report.originalSellerMode,
    native: native ? {matchedNativeEvents:native.matchedNativeEvents,
      originalEvents:native.originalEvents,issues:native.issues} : null})+'\n');
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(e=>{console.error('SF97:',e.message);process.exitCode=1;});
}