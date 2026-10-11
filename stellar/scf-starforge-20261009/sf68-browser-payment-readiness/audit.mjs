// MIT. Read-only browser checkout readiness for actual x402 seller HTTP endpoints.
// Checks unauthenticated GET + CORS OPTIONS, never paid operations, signatures or POST.
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { supportsSellerMethod } from '../sf30-seller-sdk/http-methods.mjs';

const FIELDS = Object.freeze([
  'access-control-allow-origin', 'access-control-allow-credentials',
  'access-control-allow-headers', 'access-control-allow-methods',
  'access-control-expose-headers', 'vary',
]);
const USAGE = `Browser x402 preflight audit (Node 22+, read-only)\n  node audit.mjs --resource https://seller.example/paid --origin https://buyer.example [--method GET|HEAD|POST|PUT|PATCH|DELETE] [--credentialed] [--out private.json]\n  Use --allow-loopback ONLY for explicit http://127.0.0.1 seller + buyer fixtures.\n  Performs actual unpaid GET and OPTIONS, not the method supplied as --method.`;

function tokens(s) {
  return new Set(String(s ?? '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean));
}

function urlOf(s, {loopback = false, originOnly = false} = {}) {
  const u = new URL(s);
  if (u.username || u.password || u.hash || !['https:', 'http:'].includes(u.protocol))
    throw new TypeError('Source URL cannot have credentials, fragments or invalid protocol');
  if (u.protocol === 'http:' && !(loopback && u.hostname === '127.0.0.1'))
    throw new TypeError('Plain HTTP requires explicit literal 127.0.0.1 --allow-loopback');
  if (u.protocol === 'https:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost'))
    throw new TypeError('Private loopback target requires explicit http://127.0.0.1 --allow-loopback');
  if (originOnly && (u.pathname !== '/' || u.search))
    throw new TypeError('Buyer origin must have no path, query, username or fragment');
  return u;
}

function optionArgs(args) {
  const fields = new Set(['--resource', '--origin', '--method', '--out']);
  const switches = new Set(['--credentialed', '--allow-loopback', '--help']);
  const vals = new Map(), flags = new Set();
  for (let i=0; i<args.length; i++) {
    const name = args[i];
    if (switches.has(name)) {
      if (flags.has(name)) throw new TypeError('Duplicate ' + name);
      flags.add(name);
    } else if (fields.has(name)) {
      if (vals.has(name) || !args[i+1] || args[i+1].startsWith('--'))
        throw new TypeError('Missing/duplicate ' + name);
      vals.set(name,args[++i]);
    } else throw new TypeError('Unknown option: ' + name);
  }
  if (flags.has('--help')) {
    if (fields.size === 0) return {help:true};
    if (vals.size || flags.size!==1) throw new TypeError('--help must be alone');
    return {help:true};
  }
  if (!vals.has('--resource') || !vals.has('--origin')) throw new TypeError('Missing seller and browser origin');
  const loopback=flags.has('--allow-loopback');
  const resource=urlOf(vals.get('--resource'),{loopback});
  const origin=urlOf(vals.get('--origin'),{loopback,originOnly:true}).origin;
  const method=vals.get('--method')??'GET';
  if (!supportsSellerMethod(method)) throw new TypeError('Unknown preflight method');
  if (resource.origin===origin) throw new TypeError('Choose a distinct buyer origin for actual cross-origin acceptance');
  return {resource:resource.href,origin,method,credentialed:flags.has('--credentialed'),out:vals.get('--out')};
}

function readCors(headers) {
  const out={};
  for (const k of FIELDS) out[k]=headers.get(k)??null;
  return out;
}

function allowsOrigin(h, origin, credentialed) {
  const actual = h['access-control-allow-origin'];
  if (actual !== origin && !(actual==='*' && !credentialed)) return false;
  if (credentialed && h['access-control-allow-credentials']!=='true') return false;
  return true;
}
function allowsToken(value, desired, credentialed) {
  const set=tokens(value);
  return set.has(desired.toLowerCase()) || (set.has('*') && !credentialed);
}

/** Evaluation of real HTTP header observations using browser CORS rules. */
export function assess({resource,origin,method='GET',credentialed=false,getStatus,getHeaders,
  optionsStatus,optionsHeaders,hasPaymentRequired=false}) {
  if (!getHeaders || !optionsHeaders || typeof origin!=='string')
    throw new TypeError('Original GET and OPTIONS observations required');
  const findings=[];
  const finding=(severity,code,repair)=>findings.push({severity,code,repair});
  const getOrigin=allowsOrigin(getHeaders,origin,credentialed);
  const readable=getOrigin && allowsToken(getHeaders['access-control-expose-headers'],'payment-required',credentialed);
  const preflightOrigin=allowsOrigin(optionsHeaders,origin,credentialed);
  const preflightStatus=Number.isInteger(optionsStatus) && optionsStatus>=200 && optionsStatus<300;
  const methodAllowed=allowsToken(optionsHeaders['access-control-allow-methods'],method,credentialed);
  const paymentAllowed=allowsToken(optionsHeaders['access-control-allow-headers'],'payment-signature',credentialed);
  if (getStatus!==402) finding('HIGH','UNPAID_GET_NOT_402','Inspect the actual advertised paid method and seller discovery behavior. A plain GET is not proof of a valid payment challenge.');
  else if (!hasPaymentRequired) finding('HIGH','NO_PAYMENT_REQUIRED','Emit a valid x402 v2 PAYMENT-REQUIRED challenge header on unpaid requests.');
  if (!getOrigin) finding('HIGH','GET_CORS_ORIGIN','Ensure the actual HTTP 402 carries exactly one permitted Access-Control-Allow-Origin value; credentialed requests require a specific origin and Allow-Credentials: true.');
  else if (!readable) finding('HIGH','CHALLENGE_NOT_BROWSER_READABLE','Union PAYMENT-REQUIRED with the existing Access-Control-Expose-Headers; preserve any other exposed receipt/application headers.');
  if (!preflightStatus) finding('HIGH','PREFLIGHT_NOT_2XX','Answer browser OPTIONS successfully before the payment middleware; never require payment to preflight.');
  if (!preflightOrigin) finding('HIGH','PREFLIGHT_CORS_ORIGIN','Apply permitted Access-Control-Allow-Origin to OPTIONS as well as the 402; avoid duplicate comma-joined values.');
  if (!methodAllowed) finding('HIGH','PREFLIGHT_METHOD','Include the paid retry method in Access-Control-Allow-Methods, or use a noncredentialed wildcard.');
  if (!paymentAllowed) finding('HIGH','PREFLIGHT_PAYMENT_HEADER','Include PAYMENT-SIGNATURE in Access-Control-Allow-Headers; credentialed browser requests cannot rely on a wildcard.');
  const ready=(getStatus===402 && hasPaymentRequired && readable && preflightStatus && preflightOrigin && methodAllowed && paymentAllowed);
  return {
    schema:'stellar-forge.browser-x402-readiness.v1',resource,origin,method,credentialed,
    status:ready?'READABLE_402_AND_PREFLIGHT_READY':'BROWSER_CHECKOUT_REMEDIATION',
    evidence:{getStatus,optionsStatus,hasPaymentRequired,getCors:getHeaders,optionsCors:optionsHeaders,
      GET_402_browser_visible:getOrigin && readable, preflightReady:preflightStatus && preflightOrigin && methodAllowed && paymentAllowed},
    findings,
    limitations:'GET/OPTIONS browser-header preflight only; no native paid retry, payment settlement, receipt, account auth or delivery test.',
  };
}

async function headerRequest(url, method, headers) {
  const response=await fetch(url,{method,headers,redirect:'error',signal:AbortSignal.timeout(12000)});
  try { return {status:response.status,cors:readCors(response.headers),hasPaymentRequired:response.headers.has('payment-required')}; }
  finally { await response.body?.cancel(); }
}

export async function probe(config) {
  const unpaid=await headerRequest(config.resource,'GET',{'Origin':config.origin,'Accept':'application/json'});
  const preflight=await headerRequest(config.resource,'OPTIONS',{
    'Origin':config.origin,'Access-Control-Request-Method':config.method,
    'Access-Control-Request-Headers':'payment-signature',
  });
  const evaluation=assess({...config,getStatus:unpaid.status,getHeaders:unpaid.cors,
    optionsStatus:preflight.status,optionsHeaders:preflight.cors,hasPaymentRequired:unpaid.hasPaymentRequired});
  return {...evaluation,observedAt:new Date().toISOString(),readOnly:true,paidRequests:0};
}

export async function run(args=process.argv.slice(2)) {
  const config=optionArgs(args);
  if (config.help) { console.log(USAGE); return; }
  const report=await probe(config);
  const output=JSON.stringify(report,null,2)+'\n';
  if (config.out) await writeFile(config.out,output,{flag:'wx',mode:0o600});
  console.log(output);
  if (report.status==='BROWSER_CHECKOUT_REMEDIATION') process.exitCode=2;
}

if (process.argv[1] && fileURLToPath(import.meta.url)===resolve(process.argv[1])) {
  run().catch(e=>{ console.error('SF68: '+e.message); process.exitCode=1; });
}
