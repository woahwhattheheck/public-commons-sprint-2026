// MIT. SF72: unpaid browser preflight for catalog-proven, HTTP POST-only x402 offers.
// Consumes an ORIGINAL SF70 merchant-intake JSON output; never issues GET, POST, signatures or payments.
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MAX_INPUT = 2_000_000;
const HEADER_FIELDS = ['access-control-allow-origin', 'access-control-allow-credentials',
  'access-control-allow-methods', 'access-control-allow-headers', 'vary'];
const USAGE = [
  'SF72 POST-only x402 browser preflight (Node 22+, no dependencies)',
  'node preflight.mjs --intake /private/original-sf70.json --out /private/post-preflight.json [--credentialed]',
  'Only original SF70 reports proving one complete POST-only HTTP catalog route are eligible.',
  'OPTIONS-only; never GET, POST, payment, signature or seller-origin challenge requests.',
  '--allow-loopback is permitted only for local http://127.0.0.1 acceptance servers.',
].join('\n');

function parseArgs(argv) {
  const values = new Map(), flags = new Set();
  for (let i=0;i<argv.length;i++) {
    const k=argv[i];
    if (['--credentialed','--allow-loopback','--help'].includes(k)) {
      if (flags.has(k)) throw new TypeError('Repeated '+k);
      flags.add(k);
    } else if (['--intake','--out'].includes(k)) {
      if (values.has(k)||!argv[i+1]||argv[i+1].startsWith('--')) throw new TypeError('Missing/repeated '+k);
      values.set(k,argv[++i]);
    } else throw new TypeError('Unknown '+k);
  }
  if (flags.has('--help')) {
    if (flags.size!==1||values.size) throw new TypeError('--help must be used alone');
    return {help:true};
  }
  if (!values.has('--intake')) throw new TypeError('Required --intake path');
  return {intake:values.get('--intake'),out:values.get('--out'),
    credentialed:flags.has('--credentialed'),allowLoopback:flags.has('--allow-loopback')};
}

function safeResource(raw, allowLoopback) {
  if (typeof raw!=='string'||raw.length>2048) throw new TypeError('Invalid SF70 resource URL');
  const u = new URL(raw);
  if (u.username||u.password||u.hash) throw new TypeError('Credentials/fragments not allowed');
  const local = u.hostname === '127.0.0.1';
  if (!(u.protocol==='https:' && !local && u.hostname!=='localhost') &&
      !(u.protocol==='http:' && local && allowLoopback)) throw new TypeError('HTTPS required; loopback needs explicit flag');
  // Do not send probes to a literal private IPv4 target, link-local host or metadata endpoint.
  const h=u.hostname.toLowerCase();
  if (/^(?:10\.|127\.|169\.254\.|192\.168\.|172\.(?:1[6-9]|2\d|3[01])\.)/.test(h) && !local)
    throw new TypeError('Private IP seller target not permitted');
  if (/^(?:.*\.localhost|.*\.local|.*\.internal)$/.test(h) || h==='[::1]')
    throw new TypeError('Local/private hostname not permitted');
  return u;
}

function corsTokens(raw) {
  return new Set(String(raw||'').split(',').map(s=>s.trim().toLowerCase()).filter(Boolean));
}
function tokenAllowed(raw, target, credentialed) {
  const t=corsTokens(raw);
  return t.has(target.toLowerCase()) || (!credentialed && t.has('*'));
}
function allowOrigin(raw, original, credentialed, credentials) {
  return (raw===original || (raw==='*'&&!credentialed)) &&
    (!credentialed || credentials==='true');
}

/** Only an exhaustive, self-consistent original SF70 catalog snapshot authorizes an OPTIONS probe. */
export function eligibleIntake(intake) {
  if (!intake || intake.schema!=='stellar-forge.merchant-intake.v1' ||
      intake.originals?.sellerCatalog?.schema!=='stellar-forge.seller-visibility.v1')
    return {ok:false,reason:'ORIGINAL_SF70_REQUIRED'};
  const catalog=intake.originals.sellerCatalog.catalog;
  const evidence=catalog?.operationEvidence;
  if (intake.originals.sellerCatalog.sellerDiscovery?.state!=='CATALOG_NON_GET_ONLY' ||
      !catalog?.complete || !Number.isSafeInteger(catalog.matchingResourceCount) ||
      catalog.matchingResourceCount<1 || catalog.matchingEvidence?.desiredPaymentRouteFound!==true ||
      !evidence || evidence.unresolvedMethodCount!==0 || evidence.mcpToolCount!==0 ||
      !Array.isArray(evidence.httpMethods) || evidence.httpMethods.length!==1 ||
      evidence.httpMethods[0]!=='POST' || intake.scope?.intendedRetryMethod!=='POST' ||
      intake.originals.browserReadiness!==null)
    return {ok:false,reason:'NOT_PROVEN_POST_ONLY_HTTP_PAYMENT_ROUTE'};
  if (intake.scope?.resource!==intake.originals.sellerCatalog.seller ||
      intake.scope?.catalog!==catalog.endpoint ||
      intake.scope?.network!==intake.originals.sellerCatalog.network ||
      intake.scope?.payTo!==intake.originals.sellerCatalog.desiredPayTo ||
      !intake.scope?.buyerOrigin)
    return {ok:false,reason:'SF70_SOURCE_SCOPE_MISMATCH'};
  return {ok:true,reason:'EXHAUSTIVE_POST_ONLY_HTTP_CATALOG'};
}

/** Pure browser CORS evaluation of exact received OPTIONS headers, no HTTP calls. */
export function assessPreflight({origin,credentialed=false,status,headers}) {
  const h=headers;
  const findings=[];
  const add=(code,action)=>findings.push({severity:'HIGH',code,action});
  if (!Number.isInteger(status)||status<200||status>=300)
    add('OPTIONS_NOT_2XX','Handle browser OPTIONS without requesting payment.');
  if (!allowOrigin(h['access-control-allow-origin'],origin,credentialed,h['access-control-allow-credentials']))
    add('ORIGIN_NOT_ALLOWED','Permit only the specified buyer Origin; credentialed browser calls need exact origin and Allow-Credentials:true.');
  if (!tokenAllowed(h['access-control-allow-methods'],'POST',credentialed))
    add('POST_NOT_ALLOWED','Advertise the seller POST operation in Access-Control-Allow-Methods.');
  for (const name of ['payment-signature','content-type']) {
    if (!tokenAllowed(h['access-control-allow-headers'],name,credentialed))
      add('HEADER_NOT_ALLOWED_'+name.toUpperCase().replace('-','_'),
        'Allow '+name+' in Access-Control-Allow-Headers for browser x402 JSON POST retries.');
  }
  return {status:findings.length?'PREFLIGHT_REMEDIATION':'POST_PREFLIGHT_READY_CHALLENGE_UNKNOWN',
    observed:{optionsStatus:status,optionsCors:h},findings,
    limitations:'Only observed OPTIONS CORS headers. No POST, payment challenge, x402 signature, settlement, buyer authorization, server payload, browser execution or service delivery was tested.'};
}

function selectHeaders(headers) {
  return Object.fromEntries(HEADER_FIELDS.map(k=>[k,headers.get(k)??null]));
}

export async function evaluate(intake, {credentialed=false,allowLoopback=false,fetchImpl=fetch,observedAt=new Date().toISOString()}={}) {
  const eligibility=eligibleIntake(intake);
  const summary={schema:'stellar-forge.post-only-browser-preflight.v1',
    source:{originalSchema:intake?.schema??null,originalObservedAt:intake?.observedAt??null,
      resource:intake?.scope?.resource??null,catalog:intake?.scope?.catalog??null,
      network:intake?.scope?.network??null,origin:intake?.scope?.buyerOrigin??null},
    observedAt,method:'OPTIONS_ONLY',credentialed,
    operations:{OPTIONS:0,GET:0,POST:0,payments:0,signatures:0},eligibility};
  if (!eligibility.ok) return {...summary,status:'INCONCLUSIVE',findings:[],
    limitations:'Original SF70 must prove a complete and consistent single HTTP POST-only payment route; no network request made.'};
  const seller=safeResource(intake.scope.resource,allowLoopback);
  const origin=new URL(intake.scope.buyerOrigin);
  if (!['https:','http:'].includes(origin.protocol)||origin.origin!==intake.scope.buyerOrigin ||
      origin.username || origin.password || origin.pathname!=='/' || origin.search || origin.hash ||
      (origin.protocol==='http:' && !(allowLoopback && origin.hostname==='127.0.0.1')) ||
      seller.origin===origin.origin) throw new TypeError('Invalid distinct buyer origin');
  const response=await fetchImpl(seller,{method:'OPTIONS',redirect:'error',
    headers:{Origin:origin.origin,'Access-Control-Request-Method':'POST',
      'Access-Control-Request-Headers':'payment-signature,content-type'},
    signal:AbortSignal.timeout(12000)});
  try {
    const assessment=assessPreflight({origin:origin.origin,credentialed,status:response.status,
      headers:selectHeaders(response.headers)});
    return {...summary,operations:{...summary.operations,OPTIONS:1},...assessment};
  } finally {await response.body?.cancel();}
}

export async function main(argv=process.argv.slice(2)) {
  const options=parseArgs(argv);
  if (options.help) {console.log(USAGE);return;}
  const bytes=await readFile(options.intake);
  if (bytes.length>MAX_INPUT) throw new RangeError('Original SF70 report too large');
  const intake=JSON.parse(bytes.toString('utf8'));
  const report=await evaluate(intake,options);
  report.source.intakeSha256=createHash('sha256').update(bytes).digest('hex');
  const output=JSON.stringify(report,null,2)+'\n';
  if (options.out) await writeFile(options.out,output,{flag:'wx',mode:0o600});
  console.log(output);
  if (report.status==='INCONCLUSIVE') process.exitCode=3;
  else if (report.status==='PREFLIGHT_REMEDIATION') process.exitCode=2;
}

if (process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  main().catch(e=>{console.error('SF72: '+String(e.message));process.exitCode=1;});
}
