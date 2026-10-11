// MIT. Offline, source-bound seller-remediation comparison for original SCF SF70/SF72 outputs.
// Never fetches an endpoint, signs, buys, settles, or modifies an existing evidence file.
import {readFile, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {combine as recomputeSF70} from '../sf70-merchant-intake/run.mjs';
import {eligibleIntake as recomputeSF72Eligibility, assessPreflight} from '../sf72-post-only-preflight/preflight.mjs';
import {supportsSellerMethod} from '../sf30-seller-sdk/http-methods.mjs';

const SF70 = 'stellar-forge.merchant-intake.v1';
const SF52 = 'stellar-forge.seller-visibility.v1';
const SF72 = 'stellar-forge.post-only-browser-preflight.v1';
const MAX_BYTES = 2_000_000;
const SCOPE_FIELDS = ['resource','catalog','buyerOrigin','network','payTo','intendedRetryMethod'];
const STATES = new Set(['REMEDIATION_REQUIRED','INCONCLUSIVE','UNPAID_DISCOVERY_AND_BROWSER_READY']);
const POST_STATES = new Set(['INCONCLUSIVE','PREFLIGHT_REMEDIATION','POST_PREFLIGHT_READY_CHALLENGE_UNKNOWN']);
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

function fail(reason) {throw new TypeError(reason);}
function object(value) {return value!==null && typeof value==='object' && !Array.isArray(value);}
function time(s) {
  if (typeof s!=='string' || !/^\d{4}-\d\d-\d\dT/.test(s) || !Number.isFinite(Date.parse(s)))
    fail('Original observation time must be ISO 8601');
  return Date.parse(s);
}
function scopeOf(report) {
  if (!object(report?.scope)) fail('Original SF70 scope is absent');
  const result={};
  for (const k of SCOPE_FIELDS) {
    const v=report.scope[k];
    if (typeof v!=='string'||v.length===0||v.length>4096) fail('Invalid scope '+k);
    result[k]=v;
  }
  if (!supportsSellerMethod(result.intendedRetryMethod))
    fail('Invalid original HTTP method');
  if (Object.hasOwn(report.scope,'browserCredentialed')) {
    if (typeof report.scope.browserCredentialed!=='boolean') fail('Invalid browser credential mode');
    result.browserCredentialed=report.scope.browserCredentialed;
  }
  // Scope identity is literal, rather than normalized, to prevent false comparisons of changed URLs/payees.
  return result;
}
export function validateIntake(report) {
  if (!object(report)||report.schema!==SF70||!STATES.has(report.state)) fail('Expected original SF70 intake');
  time(report.observedAt);
  const scope=scopeOf(report), originals=report.originals;
  const seller=originals?.sellerCatalog;
  if (!object(seller)||seller.schema!==SF52||seller.mode!=='READ_ONLY_UNAUTHENTICATED' ||
      seller.seller!==scope.resource||seller.catalog?.endpoint!==scope.catalog||
      seller.network!==scope.network||seller.desiredPayTo!==scope.payTo||
      typeof seller.catalog?.complete!=='boolean'||
      typeof seller.sellerDiscovery?.state!=='string'||
      !object(seller.catalog.matchingEvidence)||
      !['LISTED','LISTED_WRONG_NETWORK','LISTED_WRONG_PAYTO',
        'LISTED_PAYMENT_ROUTE_MISMATCH','NOT_LISTED_IN_EXHAUSTED_CATALOG','INCONCLUSIVE_CATALOG'].includes(seller.verdict))
    fail('Original SF70 does not bind to one matching SF52 seller/catalog/network/payee');
  if (!Array.isArray(report.findings)||report.findings.length>100) fail('Invalid original findings');
  for (const f of report.findings) {
    if (!object(f)||!['HIGH','UNKNOWN'].includes(f.severity)||
        typeof f.code!=='string'||!/^[-A-Z0-9_]{1,100}$/.test(f.code)||
        typeof f.action!=='string') fail('Invalid original finding');
  }
  const s=report.safeguards;
  if (!object(s)||s.walletCalls!==0||s.paidRequests!==0||s.settlementConfirmed!==false)
    fail('Expected no-funds original SF70 safeguards');
  if (seller.sellerDiscovery.state==='CATALOG_NON_GET_ONLY'&&originals.browserReadiness!==null)
    fail('Original non-GET route cannot have a GET browser probe');
  // Re-run the published SF70 decision logic on its retained native observation objects.
  // A stored verdict cannot override the source-derived finding list and state.
  const canonical=recomputeSF70({seller,browser:originals.browserReadiness,
    error:originals.browserError,observedAt:report.observedAt,
    config:{resourceUrl:scope.resource,catalogUrl:scope.catalog,origin:scope.buyerOrigin,
      network:scope.network,payTo:scope.payTo,method:scope.intendedRetryMethod}});
  if (report.state!==canonical.state || JSON.stringify(report.findings)!==JSON.stringify(canonical.findings))
    fail('SF70 state/findings disagree with original native observation logic');
  return scope;
}
export function validatePost(post, intake, intakeSha) {
  if (!object(post)||post.schema!==SF72||!POST_STATES.has(post.status)||
      post.method!=='OPTIONS_ONLY'||!object(post.source)||
      post.source.intakeSha256!==intakeSha||post.source.originalSchema!==SF70||
      post.source.originalObservedAt!==intake.observedAt) fail('SF72 must bind to exact original SF70 bytes');
  const a=post.source,b=intake.scope;
  for (const [k,v] of [['resource',b.resource],['catalog',b.catalog],
      ['network',b.network],['origin',b.buyerOrigin]]) {
    if (a[k]!==v) fail('SF72 source identity mismatch: '+k);
  }
  time(post.observedAt);
  if (Date.parse(post.observedAt)<Date.parse(intake.observedAt)) fail('SF72 cannot precede its source capture');
  if (!object(post.operations)||post.operations.GET!==0||post.operations.POST!==0||
      post.operations.payments!==0||post.operations.signatures!==0||
      !Number.isInteger(post.operations.OPTIONS)||post.operations.OPTIONS<0||post.operations.OPTIONS>1)
    fail('SF72 contains prohibited or inconsistent request counts');
  // Re-evaluate the original SF72 source gate and raw received OPTIONS headers.
  // Never trust the caller's precomputed readiness status or finding list.
  if (typeof post.credentialed!=='boolean') fail('Expected original SF72 credentialed flag');
  const originalEligibility=recomputeSF72Eligibility(intake);
  if (post.eligibility?.ok!==originalEligibility.ok ||
      post.eligibility?.reason!==originalEligibility.reason)
    fail('SF72 eligibility disagrees with original SF70 data');
  if (!originalEligibility.ok) {
    if (post.status!=='INCONCLUSIVE'||post.operations.OPTIONS!==0 || post.findings?.length)
      fail('Ineligible SF72 preflight cannot produce browser readiness');
  } else {
    if (post.operations.OPTIONS!==1||!object(post.observed)||
        !Number.isInteger(post.observed.optionsStatus)||!object(post.observed.optionsCors))
      fail('Eligible SF72 requires genuine recorded OPTIONS status and CORS headers');
    const canonical=assessPreflight({origin:b.buyerOrigin,credentialed:post.credentialed,
      status:post.observed.optionsStatus,headers:post.observed.optionsCors});
    if (canonical.status!==post.status||
        JSON.stringify(canonical.findings)!==JSON.stringify(post.findings))
      fail('SF72 status/findings disagree with actual recorded OPTIONS response');
  }
}
function findingMap(list) {
  const m=new Map();
  for (const f of list) {
    const prior=m.get(f.code);
    if (!prior|| (f.severity==='HIGH'&&prior.severity!=='HIGH')) m.set(f.code,f);
  }
  return m;
}
function diff(before,after) {
  const b=findingMap(before),a=findingMap(after);
  const resolved=[...b.values()].filter(f=>!a.has(f.code));
  const added=[...a.values()].filter(f=>!b.has(f.code));
  const retained=[...a.values()].filter(f=>b.has(f.code));
  const modified=[...a.values()].filter(f=>b.has(f.code)&&b.get(f.code).severity!==f.severity);
  return {notReobserved:resolved, newlyObserved:added, stillObserved:retained, severityChanged:modified};
}
function postSummary(p,sha) {
  return p?{reportSha256:sha,status:p.status,observedAt:p.observedAt,
    optionsRequests:p.operations.OPTIONS,eligibility:p.eligibility}:null;
}
function credentialMode(intake,post) {
  const modes=[];
  if (Object.hasOwn(intake.scope,'browserCredentialed')) modes.push(intake.scope.browserCredentialed);
  const browser=intake.originals.browserReadiness;
  if (browser && Object.hasOwn(browser,'credentialed')) {
    if (typeof browser.credentialed!=='boolean') fail('Invalid original browser credential mode');
    modes.push(browser.credentialed);
  }
  if (post) modes.push(post.credentialed);
  if (modes.some(mode=>mode!==modes[0]))
    fail('Original observations disagree about browser credential mode');
  return modes.length?modes[0]:null;
}
/** Source-safe, read-only comparison. Input hashes are SHA-256 of original exact JSON bytes. */
export function compare({before,after,beforeSha,afterSha,postBefore=null,postAfter=null,
    postBeforeSha=null,postAfterSha=null}) {
  const lhs=validateIntake(before),rhs=validateIntake(after);
  for (const field of SCOPE_FIELDS) if (lhs[field]!==rhs[field])
    fail('Before/after merchant scope differs: '+field);
  if (Date.parse(after.observedAt)<=Date.parse(before.observedAt))
    fail('After capture must follow before capture');
  if (!/^[a-f0-9]{64}$/.test(beforeSha)||!/^[a-f0-9]{64}$/.test(afterSha))
    fail('Real original file SHA-256 values required');
  if (Boolean(postBefore)!==Boolean(postAfter)) fail('Provide both original SF72 reports or neither');
  if ((postBefore||postAfter)&&lhs.intendedRetryMethod!=='POST')
    fail('SF72 preflight is only applicable to POST');
  if (postBefore) {
    validatePost(postBefore,before,beforeSha); validatePost(postAfter,after,afterSha);
    if (!/^[a-f0-9]{64}$/.test(postBeforeSha)||!/^[a-f0-9]{64}$/.test(postAfterSha))
      fail('Real SF72 JSON file SHA-256 required');
  }
  // New SF70 reports preserve the configured mode even if a browser probe failed.
  // Legacy reports may establish it through their original SF68/SF72 observation.
  const beforeMode=credentialMode(before,postBefore),afterMode=credentialMode(after,postAfter);
  const credentialModesKnown=beforeMode!==null&&afterMode!==null;
  if (credentialModesKnown&&beforeMode!==afterMode)
    fail('Before/after merchant scope differs: browserCredentialed');
  const changes=diff(before.findings,after.findings);
  const observedAfterComplete=after.originals.sellerCatalog.catalog.complete;
  const authoritativePost=postAfter?.status==='POST_PREFLIGHT_READY_CHALLENGE_UNKNOWN';
  const afterHasHigh=after.findings.some(f=>f.severity==='HIGH') ||
    (postAfter?.findings||[]).some(f=>f.severity==='HIGH');
  let classification='INCOMPLETE_EVIDENCE';
  if (afterHasHigh) classification='REMEDIATION_STILL_REQUIRED';
  else if (!observedAfterComplete) classification='CATALOG_COVERAGE_INCOMPLETE';
  else if (!credentialModesKnown) classification='BROWSER_CREDENTIAL_MODE_UNCONFIRMED';
  else if (lhs.intendedRetryMethod==='GET'&&
      after.state==='UNPAID_DISCOVERY_AND_BROWSER_READY')
    classification='GET_UNPAID_DISCOVERY_AND_BROWSER_READY';
  else if (lhs.intendedRetryMethod==='POST'&&authoritativePost&&
      after.originals.sellerCatalog.catalog.matchingEvidence.desiredPaymentRouteFound===true&&
      after.originals.sellerCatalog.sellerDiscovery.state==='CATALOG_NON_GET_ONLY')
    classification='POST_OPTIONS_READY_CHALLENGE_UNCHECKED';
  const technicalMilestoneObserved=classification==='GET_UNPAID_DISCOVERY_AND_BROWSER_READY'||
    classification==='POST_OPTIONS_READY_CHALLENGE_UNCHECKED';
  const resolved=observedAfterComplete&&credentialModesKnown?changes.notReobserved:[];
  const unverified=observedAfterComplete?[]:changes.notReobserved;
  return {
    schema:'stellar-forge.merchant-repair-delta.v1',
    scope:{...lhs,browserCredentialed:credentialModesKnown?beforeMode:null}, classification,technicalMilestoneObserved,
    source:{before:{sha256:beforeSha,observedAt:before.observedAt,state:before.state,
      catalogComplete:before.originals.sellerCatalog.catalog.complete,browserCredentialed:beforeMode,
      verdict:before.originals.sellerCatalog.verdict},
      after:{sha256:afterSha,observedAt:after.observedAt,state:after.state,
        catalogComplete:observedAfterComplete,browserCredentialed:afterMode,verdict:after.originals.sellerCatalog.verdict},
      sf72Before:postSummary(postBefore,postBeforeSha),sf72After:postSummary(postAfter,postAfterSha)},
    changes:{notReobservedWithCompleteAfterCatalog:resolved,
      notReobservedButAfterCatalogIncomplete:unverified,
      notReobservedButCredentialModeUnknown:observedAfterComplete&&!credentialModesKnown?changes.notReobserved:[],
      newlyObserved:changes.newlyObserved,stillObserved:changes.stillObserved,
      severityChanged:changes.severityChanged},
    boundaries:{cashReceived:false,merchantContractSigned:false,paidCheckoutVerified:false,
      stellarSettlementVerified:false,deliveredResourceVerified:false,
      note:'Original unpaid SF70 catalog and browser observations; SF72, if supplied, observes OPTIONS only. Method-specific acceptance is not a signed payment or customer agreement.'}
  };
}
function args(argv) {
  const values=new Map(), keys=new Set(['--before','--after','--sf72-before','--sf72-after','--out']);
  for (let i=0;i<argv.length;i++) {
    const k=argv[i]; if (!keys.has(k)||values.has(k)||!argv[i+1]||argv[i+1].startsWith('--'))
      fail('Usage: --before SF70.json --after SF70.json [--sf72-before SF72.json --sf72-after SF72.json] [--out NEW.json]');
    values.set(k,argv[++i]);
  }
  for (const k of ['--before','--after']) if (!values.has(k)) fail('Required '+k);
  if (values.has('--sf72-before')!==values.has('--sf72-after'))
    fail('SF72 requires an original report on both sides');
  if (values.get('--before')===values.get('--after')) fail('Two distinct original capture files required');
  return values;
}
async function load(path) {
  const bytes=await readFile(path); if (!bytes.length||bytes.length>MAX_BYTES) fail('Input JSON outside 1..2,000,000 bytes');
  return {data:JSON.parse(bytes.toString('utf8')),sha:sha256(bytes)};
}
export async function main(argv=process.argv.slice(2)) {
  const opts=args(argv),b=await load(opts.get('--before')),a=await load(opts.get('--after'));
  const pb=opts.has('--sf72-before')?await load(opts.get('--sf72-before')):null;
  const pa=opts.has('--sf72-after')?await load(opts.get('--sf72-after')):null;
  const result=compare({before:b.data,after:a.data,beforeSha:b.sha,afterSha:a.sha,
    postBefore:pb?.data,postAfter:pa?.data,postBeforeSha:pb?.sha,postAfterSha:pa?.sha});
  const json=JSON.stringify(result,null,2)+'\n';
  if (opts.has('--out')) await writeFile(opts.get('--out'),json,{flag:'wx',mode:0o600});
  process.stdout.write(json);
  if (result.classification==='REMEDIATION_STILL_REQUIRED') process.exitCode=2;
  else if (!result.technicalMilestoneObserved) process.exitCode=3;
}
if (process.argv[1]&&fileURLToPath(import.meta.url)===resolve(process.argv[1]))
  main().catch(e=>{console.error('SF76: '+String(e.message));process.exitCode=1;});
