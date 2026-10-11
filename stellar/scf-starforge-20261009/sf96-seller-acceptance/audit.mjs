/**
 * SF96: observe original SF30 seller routes in its CHALLENGE_ONLY runtime.
 * Only the actual merchant's local seller is called. No wallet, facilitator,
 * outbound merchant probe, payment, application handler or external dependencies.
 * SPDX-License-Identifier: MIT
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { supportsSellerMethod, requiresJsonBody } from '../sf30-seller-sdk/http-methods.mjs';

const sha = b => createHash('sha256').update(b).digest('hex');
const obj = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const die = code => { throw new Error(code); };
const esc = x => String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const canon = x => JSON.stringify(x, (_, v) => obj(v) ? Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))) : v);
const MAX = 2 * 1024 * 1024;

export function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === '--help') return null;
  if (argv.length % 2) die('ARGUMENT_VALUE_PAIRS_REQUIRED');
  const args = {};
  for (let i=0; i<argv.length; i+=2) {
    if (!['--seller','--out','--cases','--support'].includes(argv[i]) || args[argv[i]] || !argv[i+1])
      die('UNKNOWN_DUPLICATE_OR_EMPTY_ARGUMENT');
    args[argv[i]] = argv[i+1];
  }
  if (!args['--seller'] || !args['--out']) die('SELLER_AND_OUT_REQUIRED');
  const origin = new URL(args['--seller']);
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' ||
      origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash)
    die('SELLER_MUST_BE_LOOPBACK_HTTP_ORIGIN');
  const out = args['--out'];
  if (!isAbsolute(out) || out === '/' || resolve(out) === process.cwd()) die('OUT_MUST_BE_NEW_ABSOLUTE_PRIVATE_DIRECTORY');
  return { seller: origin.origin, out, casesPath: args['--cases'], supportPath: args['--support'] };
}

async function localJson(base, path) {
  const r = await fetch(base + path, { signal: AbortSignal.timeout(7000), redirect:'manual', cache:'no-store' });
  if (r.status !== 200 || !/^application\/json\b/.test(r.headers.get('content-type') ?? '')) die(`LOCAL_METADATA_${path}_INVALID`);
  const contentLength = Number(r.headers.get('content-length') || 0);
  if (contentLength > MAX) die('LOCAL_METADATA_TOO_LARGE');
  const bytes = Buffer.from(await r.arrayBuffer());
  if (bytes.length > MAX) die('LOCAL_METADATA_TOO_LARGE');
  let value;
  try { value = JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes)); }
  catch { die('LOCAL_METADATA_INVALID_JSON'); }
  return {value, sha256:sha(bytes), bytes:bytes.length};
}

function sourceRoutes(health, offers) {
  if (!obj(health) || health.schema !== 'stellar-forge.seller-service.v1' ||
      !['CHALLENGE_ONLY','NATIVE_X402'].includes(health.mode) ||
      !Array.isArray(health.routes) || !Array.isArray(offers) ||
      !health.routes.length || health.routes.length !== offers.length || health.routes.length > 100)
    die('ORIGINAL_SELLER_HEALTH_OFFERS_MISMATCH');
  const ids = new Set();
  return health.routes.map((r,i) => {
    const offer=offers[i], method=offer?.extensions?.bazaar?.info?.input?.method;
    if (!obj(r) || !/^[A-Za-z0-9_-]{1,80}$/.test(r.id) || ids.has(r.id) ||
        !supportsSellerMethod(r.method) || r.method !== method ||
        r.url !== offer?.resource?.url || offer?.x402Version !== 2 ||
        !Array.isArray(offer.accepts) || offer.accepts.length !== 1 ||
        !obj(offer.extensions?.bazaar) || !obj(offer.accepts[0])) die('NONCANONICAL_OR_UNMATCHED_SELLER_OFFER');
    ids.add(r.id);
    const u=new URL(r.url);
    if (u.protocol !== 'https:' && !(u.protocol === 'http:' && u.hostname === '127.0.0.1'))
      die('INVALID_ADVERTISED_RESOURCE_ORIGIN');
    return {id:r.id,method,advertisedUrl:r.url,template:r.routeTemplate ?? null,offer};
  });
}

function templateMatches(template, path) {
  const parts = template.split('/'), actual = path.split('/');
  return parts.length === actual.length && parts.every((segment,i) =>
    segment.startsWith(':') ? actual[i] && !actual[i].includes('%2f') && !actual[i].includes('%2F') : segment === actual[i]);
}

export function planProbes(routes, cases={}) {
  if (!obj(cases) || Object.keys(cases).some(k=>!routes.some(r=>r.id===k))) die('UNKNOWN_CASE_ROUTE');
  return routes.map(route => {
    const input=route.offer.extensions.bazaar.info.input;
    const c=cases[route.id];
    if (c !== undefined && !obj(c)) die('CASE_MUST_BE_OBJECT');
    if (c && Object.keys(c).some(k=>!['path','query','body','allowPost','allowMethod'].includes(k))) die('UNKNOWN_CASE_FIELD');
    if (c && Object.hasOwn(c,'allowMethod') && c.allowMethod !== route.method) die('CASE_METHOD_MISMATCH');
    if (route.method === 'POST' && (!c?.allowPost || !Object.hasOwn(c,'body')))
      return {route,skip:'POST_REQUIRES_OPERATOR_CASE_AND_EXPLICIT_ALLOWPOST'};
    if (['PUT','PATCH','DELETE'].includes(route.method) && c?.allowMethod !== route.method)
      return {route,skip:route.method + '_REQUIRES_OPERATOR_CASE_AND_EXACT_ALLOWMETHOD'};
    if (requiresJsonBody(route.method) && (!c || !Object.hasOwn(c,'body')))
      return {route,skip:'JSON_BODY_REQUIRES_OPERATOR_CASE'};
    if (!requiresJsonBody(route.method) && c && Object.hasOwn(c,'body')) die('CASE_BODY_NOT_SUPPORTED_FOR_METHOD');
    if (route.template && !c?.path) return {route,skip:'DYNAMIC_ROUTE_REQUIRES_OPERATOR_PATH'};
    const original = new URL(route.advertisedUrl);
    const path = c?.path ?? original.pathname;
    if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//') ||
        path.includes('?') || path.includes('#') || path.includes('\\') || path.includes('\0')) die('UNSAFE_CASE_PATH');
    const decoded = new URL(path,'http://127.0.0.1').pathname;
    if (route.template ? !templateMatches(route.template,decoded) : original.pathname !== decoded)
      die('CASE_PATH_OUTSIDE_DECLARED_ROUTE');
    const examples = input.queryParams ?? {};
    const query = c?.query ?? examples;
    if (!obj(query) || Object.keys(query).some(k=>!Object.hasOwn(examples,k))) die('CASE_QUERY_OUTSIDE_DECLARED_INPUT');
    const target = new URL(path,'http://127.0.0.1');
    for (const [k,v] of Object.entries(query)) {
      if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') die('CASE_QUERY_MUST_BE_SCALAR');
      target.searchParams.set(k,String(v));
    }
    if (target.pathname !== decoded || target.href.length > 2048) die('UNSAFE_FINAL_PROBE_TARGET');
    if (requiresJsonBody(route.method) && input.bodyType !== 'json') die('ONLY_JSON_BODY_SUPPORTED');
    const body = requiresJsonBody(route.method) ? JSON.stringify(c.body) : undefined;
    if (requiresJsonBody(route.method) && body === undefined) die('JSON_BODY_REQUIRED');
    if (body && Buffer.byteLength(body) > 8192) die('JSON_CASE_EXCEEDS_8K');
    return {route, path: target.pathname + target.search, body};
  });
}

function actualOffer(header) {
  if (!header || header.length > 32768 || header.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(header)) die('PAYMENT_REQUIRED_HEADER_MISSING_OR_INVALID');
  const b=Buffer.from(header,'base64');
  if (b.toString('base64') !== header) die('PAYMENT_REQUIRED_HEADER_NOT_CANONICAL_BASE64');
  let parsed;
  try { parsed = JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(b)); }
  catch { die('PAYMENT_REQUIRED_HEADER_NOT_UTF8_JSON'); }
  if (parsed?.x402Version !== 2 || !obj(parsed.resource) ||
      !Array.isArray(parsed.accepts) || parsed.accepts.length !== 1 ||
      !obj(parsed.extensions?.bazaar)) die('PAYMENT_REQUIRED_NOT_V2_BAZAAR');
  return {parsed, digest:sha(b)};
}

export function compareChallenge(source, challenge, requestTarget) {
  const errors=[];
  const advertised = source.offer;
  const expected = new URL(requestTarget, advertised.resource.url).href;
  if (challenge.resource.url !== expected) errors.push('CHALLENGE_RESOURCE_URL_DRIFT');
  if (canon(challenge.accepts) !== canon(advertised.accepts)) errors.push('CHALLENGE_STELLAR_PAYMENT_TERMS_DRIFT');
  if (challenge.extensions?.bazaar?.info?.input?.method !== source.method) errors.push('CHALLENGE_HTTP_METHOD_DRIFT');
  const expectedExt=structuredClone(advertised.extensions);
  const actualExt=structuredClone(challenge.extensions);
  if (source.template) {
    // The original SF30 server attaches concrete pathParams to dynamic offers.
    delete expectedExt.bazaar.info.input.pathParams;
    delete actualExt.bazaar.info.input.pathParams;
  }
  if (canon(actualExt) !== canon(expectedExt)) errors.push('CHALLENGE_BAZAAR_SCHEMA_DRIFT');
  return errors;
}

async function probe(base, planned) {
  if (planned.skip) return {id:planned.route.id,method:planned.route.method,state:'NEEDS_INPUT',issues:[planned.skip]};
  const {route}=planned;
  try {
    const resp=await fetch(base+planned.path, {method:route.method,redirect:'manual',cache:'no-store',
      signal:AbortSignal.timeout(7000),
      headers: requiresJsonBody(route.method) ? {'content-type':'application/json'} : {},
      body:planned.body});
    await resp.body?.cancel();
    const issues=[];
    if (resp.status !== 402) issues.push(`EXPECTED_402_GOT_${resp.status}`);
    let challengeDigest=null;
    if (resp.status === 402) {
      try {
        const hdr=actualOffer(resp.headers.get('payment-required'));
        challengeDigest=hdr.digest;
        const expected=new URL(planned.path,route.advertisedUrl).href;
        issues.push(...compareChallenge(route,hdr.parsed,expected));
      } catch(error) {issues.push(error.message);}
    }
    return {id:route.id,method:route.method,state:issues.length?'BLOCKED':'PASS',httpStatus:resp.status,
      routeSha256:sha(Buffer.from(JSON.stringify(route.offer))),challengeSha256:challengeDigest,issues};
  } catch(error) {return {id:route.id,method:route.method,state:'BLOCKED',issues:['ORIGINAL_SELLER_ROUTE_REQUEST_FAILED',String(error.cause?.code??error.name)]};}
}

function reviewReport(report) {
  const rows=report.routes.map(r=>`<tr><td>${esc(r.id)}</td><td>${esc(r.method)}</td><td>${esc(r.state)}</td><td>${esc(r.httpStatus ?? 'not called')}</td><td>${esc(r.issues.join(', ') || 'Challenge matched original offer')}</td></tr>`).join('\n');
  const summary=report.summary;
  return `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>SF96 | merchant route acceptance</title><style>body{font:14px/1.55 system-ui, sans-serif;max-width:1100px;margin:3rem auto;padding:0 1.2rem;color:#222}h1{font-size:1.6rem}h2{font-size:1.1rem;margin-top:2rem}table{border-collapse:collapse;width:100%}td,th{text-align:left;border-bottom:1px solid #ccc;padding:.65rem;vertical-align:top}thead{background:#f2f2f2}code{overflow-wrap:anywhere}.muted{color:#555}footer{border-top:1px solid #ddd;margin-top:2rem;padding-top:1rem}</style><h1>Seller route acceptance</h1><p class="muted">Original SF30 CHALLENGE_ONLY runtime · ${esc(report.generatedAt)}</p><p><strong>${summary.passed} passed</strong> · ${summary.blocked} blocked · ${summary.needsInput} needs operator case · ${summary.total} original routes</p><p>Decision: <strong>${esc(report.decision)}</strong></p><h2>Actual original route checks</h2><table><thead><tr><th>Route ID</th><th>Method</th><th>Result</th><th>HTTP</th><th>Operator action</th></tr></thead><tbody>${rows}</tbody></table><h2>Implementation review</h2><p>Request targets are mapped to this operator's real loopback seller. All challenge payment terms are compared with the same seller's original advertised offers. This review did not call a public merchant, facilitator, wallet, settlement or application handler. Native paid mode is never probed.</p><p>Source digests: seller health <code>${esc(report.sourceDigests.health)}</code>; offers <code>${esc(report.sourceDigests.offers)}</code>.</p><footer>Passing unpaid challenges does not prove public HTTPS reachability, customer acceptance, wallet ownership, correct real asset deployment, successful settlement, API fulfillment, uptime or revenue. Perform separately authorized live acceptance with original x402/ledger tools and merchant.</footer></html>`;
}

export async function run(options) {
  const [health,offers]=await Promise.all([localJson(options.seller,'/_seller/health'),localJson(options.seller,'/_seller/offers')]);
  const routes=sourceRoutes(health.value,offers.value);
  // Block actual route traffic in a native-payment service, even if client promises no wallet.
  if (health.value.mode !== 'CHALLENGE_ONLY') die('PAID_NATIVE_MODE_REJECTED_RUN_CHALLENGE_ONLY_SERVICE');
  let cases={};
  if (options.casesPath) {
    const raw=await readFile(options.casesPath);
    if (raw.length>65536) die('CASE_FILE_TOO_LARGE');
    const config=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(raw));
    if (config?.schema !== 'scf.sf96.operator-cases.v1' || !obj(config.routes)) die('UNKNOWN_CASES_SCHEMA');
    cases=config.routes;
  }
  const planned=planProbes(routes,cases);
  const results=[];
  for (const item of planned) results.push(await probe(options.seller,item));
  const summary={total:results.length,passed:results.filter(r=>r.state==='PASS').length,
    blocked:results.filter(r=>r.state==='BLOCKED').length,
    needsInput:results.filter(r=>r.state==='NEEDS_INPUT').length};
  let support=null;
  if (options.supportPath) {
    const bytes=await readFile(options.supportPath);
    if (bytes.length>MAX) die('SUPPORT_FILE_TOO_LARGE');
    const input=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));
    if (input?.schema !== 'stellar-forge.seller-support.v1' ||
        !Array.isArray(input.seller?.advertisedRoutes) ||
        !Array.isArray(input.observation?.routes)) die('NOT_ORIGINAL_SF93_SUPPORT_BUNDLE');
    const same=canon(input.seller.advertisedRoutes.map(x=>[x.id,x.method]).sort()) ===
      canon(routes.map(x=>[x.id,x.method]).sort());
    support={originalBundleSha256:sha(bytes),sameRouteIdentity:same,
      sessionId:input.observation.sessionId,trafficSince:input.observation.startedAt,
      sellerMode:input.seller.mode};
    if (!same) summary.blocked++;
  }
  const report={schema:'scf.sf96.merchant-acceptance.v1',generatedAt:new Date().toISOString(),
    sourceDigests:{health:health.sha256,offers:offers.sha256},mode:health.value.mode,
    summary,decision:summary.blocked || summary.needsInput?'INCOMPLETE_OPERATOR_ACCEPTANCE':'CHALLENGE_ONLY_ACCEPTANCE_COMPLETE',
    routes:results,support,limitations:['No native paid execution','No external merchant or facilitator contacted','No buyer/payment/ledger proof','No successful application response claimed']};
  const checklist=`# Original SF30 merchant route acceptance\n\nGenerated ${report.generatedAt}; decision **${report.decision}**.\n\n${results.map(x=>`- [ ] ${x.id} (${x.method}) · ${x.state}${x.issues.length ? ' · '+x.issues.join(', ') : ' · original v2 challenge and payment terms matched'}`).join('\n')}\n\nNext operator review: resolve reported route failures and missing method/dynamic cases; rerun a NEW create-only package against the same original seller. When complete, separately review public HTTPS exposure, true customer API acceptance, authentic native settlement/receipts and contract terms with the merchant. This is neither a paid transaction nor grant approval.\n`;
  const files={'audit.json':Buffer.from(JSON.stringify(report,null,2)+'\n'),'review.html':Buffer.from(reviewReport(report)),
    'acceptance.md':Buffer.from(checklist)};
  const manifest={schema:'scf.sf96.manifest.v1',sourceDigests:report.sourceDigests,
    files:Object.fromEntries(Object.entries(files).map(([k,v])=>[k,{bytes:v.length,sha256:sha(v)}]))};
  files['manifest.json']=Buffer.from(JSON.stringify(manifest,null,2)+'\n');
  await mkdir(options.out,{mode:0o700});
  for (const [name,data] of Object.entries(files)) await writeFile(resolve(options.out,name),data,{mode:0o600,flag:'wx'});
  return {out:options.out,decision:report.decision,summary,files:Object.keys(files)};
}

if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const usage='node audit.mjs --seller http://127.0.0.1:PORT --out /absolute/NEW_DIR [--cases cases.json] [--support sf93-bundle.json]';
  try {const args=parseArgs(process.argv.slice(2));if (!args) console.log(usage);
    else run(args).then(r=>{console.log(JSON.stringify(r));if(r.decision!=='CHALLENGE_ONLY_ACCEPTANCE_COMPLETE')process.exitCode=1;})
      .catch(e=>{console.error(e.message);process.exitCode=2;});}
  catch(e){console.error(e.message+'\n'+usage);process.exitCode=2;}
}
