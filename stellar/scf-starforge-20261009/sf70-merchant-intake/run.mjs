// MIT. Single merchant-scoped integration of the published SF52 and SF68 original HTTP diagnostics.
// No signing, credentialed requests, paid HTTP retry, or settlement operations.
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {diagnose, requireEndpoint} from '../sf52-merchant-visibility/diagnose.mjs';
import {probe} from '../sf68-browser-payment-readiness/audit.mjs';
import {supportsSellerMethod} from '../sf30-seller-sdk/http-methods.mjs';

const VALUE_FLAGS = new Set(['--resource','--catalog','--origin','--network','--pay-to','--method','--out']);
const SWITCH_FLAGS = new Set(['--credentialed','--allow-loopback','--help']);
const HELP = [
  'SF70 merchant one-pass intake (read-only, Node 22+)',
  'node run.mjs --resource https://seller.example/paid --catalog https://facilitator.example/discovery/resources',
  '  --origin https://buyer.example --network stellar:testnet --pay-to G... [--method GET|HEAD|POST|PUT|PATCH|DELETE]',
  '  [--credentialed] [--out private.json]',
  'For local original HTTP fixtures only: --allow-loopback with literal http://127.0.0.1 URLs.',
  'Performs original catalog GET pages; GET/OPTIONS browser checks only where GET is a relevant advertised operation. Never signs or pays.'
].join('\n');

export function parseArgs(argv) {
  const values = new Map(), switches = new Set();
  for (let i=0;i<argv.length;i++) {
    const key = argv[i];
    if (SWITCH_FLAGS.has(key)) {
      if (switches.has(key)) throw new TypeError('Duplicate option: '+key);
      switches.add(key);
    } else if (VALUE_FLAGS.has(key)) {
      if (values.has(key) || !argv[i+1] || argv[i+1].startsWith('--'))
        throw new TypeError('Missing or repeated option: '+key);
      values.set(key,argv[++i]);
    } else throw new TypeError('Unknown option: '+key);
  }
  if (switches.has('--help')) {
    if (switches.size!==1 || values.size) throw new TypeError('--help must be alone');
    return {help:true};
  }
  for (const field of ['--resource','--catalog','--origin','--network','--pay-to']) {
    if (!values.has(field)) throw new TypeError('Required: '+field);
  }
  const allowLoopback=switches.has('--allow-loopback');
  const resource=requireEndpoint(values.get('--resource'),{allowLoopback});
  const catalog=requireEndpoint(values.get('--catalog'),{allowLoopback});
  const browser=requireEndpoint(values.get('--origin'),{allowLoopback});
  if (browser.pathname!=='/' || browser.search || browser.hash)
    throw new TypeError('Buyer origin must have no path or query');
  if (resource.origin===browser.origin) throw new TypeError('Buyer origin must differ from seller');
  const network=values.get('--network');
  if (!/^stellar:[a-z0-9-]{2,32}$/.test(network)) throw new TypeError('Expected exact stellar:* network');
  const payTo=values.get('--pay-to');
  if (!payTo.trim() || payTo!==payTo.trim() || payTo.length>256)
    throw new TypeError('Invalid seller payment recipient');
  const method=values.get('--method')||'GET';
  if (!supportsSellerMethod(method))
    throw new TypeError('Unsupported intended buyer retry method');
  const out=values.get('--out');
  if (out && out.length>2048) throw new TypeError('Report path too long');
  return {resourceUrl:resource.toString(),catalogUrl:catalog.toString(),origin:browser.origin,
    network,payTo,method,credentialed:switches.has('--credentialed'),allowLoopback,out};
}

export function combine({seller,browser,error,config,observedAt}) {
  const findings=[];
  const add=(severity,code,action)=>findings.push({severity,code,action});
  const nonGetOnly=seller.sellerDiscovery.state==='CATALOG_NON_GET_ONLY';
  if (nonGetOnly)
    add('UNKNOWN','NON_GET_OR_MCP_ONLY',
      'Source catalog lists non-GET HTTP or MCP operations. An unpaid GET is not a valid checkout test of this route; original advertised operation needs its own authorized verification.');
  else if (seller.sellerDiscovery.state!=='UNPAID_402_BAZAAR_VISIBLE')
    add('HIGH','SELLER_UNPAID_DISCOVERY',
      'Verify the advertised unpaid GET operation returns a valid 402 PAYMENT-REQUIRED with Bazaar extension.');
  if (!seller.catalog.complete)
    add('UNKNOWN','CATALOG_NOT_EXHAUSTIVE',
      'Finish actual facilitator pagination or resolve the reported provider error before claiming listing absence.');
  if (seller.verdict==='INCONCLUSIVE_CATALOG') {
    if (seller.catalog.complete) add('UNKNOWN','CATALOG_INCONCLUSIVE','Review original SF52 catalog and provider response.');
  } else if (seller.verdict!=='LISTED')
    add('HIGH','CATALOG_ROUTE_MISMATCH',
      'Confirm the identical resource operation has a single accepted Stellar network and payTo in the facilitator listing.');
  else if (seller.catalog.matchingEvidence.desiredPaymentRouteFound!==true)
    add('HIGH','CATALOG_PAIRED_TERMS',
      'Require network and recipient on the same accepted payment alternative.');
  if (!browser && nonGetOnly) add('UNKNOWN','BROWSER_METHOD_UNASSESSED',
    'SF68 GET/OPTIONS audit is not a checkout test for a confirmed non-GET/MCP-only catalog offer. Assess the actual authorized operation in a separate browser-aware integration.');
  else if (!browser) add('UNKNOWN','BROWSER_HTTP_UNAVAILABLE',
    'Repeat the original unpaid browser-origin GET and OPTIONS; '+String(error||'request failed').slice(0,200));
  else if (browser.status!=='READABLE_402_AND_PREFLIGHT_READY')
    for (const f of browser.findings)
      add(f.severity==='HIGH'?'HIGH':'UNKNOWN','BROWSER_'+f.code,f.repair);
  const state=findings.some(f=>f.severity==='HIGH')?'REMEDIATION_REQUIRED':
    findings.length?'INCONCLUSIVE':'UNPAID_DISCOVERY_AND_BROWSER_READY';
  return {
    schema:'stellar-forge.merchant-intake.v1',state,observedAt,
    scope:{resource:config.resourceUrl,catalog:config.catalogUrl,buyerOrigin:config.origin,
      network:config.network,payTo:config.payTo,intendedRetryMethod:config.method,
      browserCredentialed:config.credentialed===true},
    findings,
    originals:{sellerCatalog:seller,browserReadiness:browser??null,browserError:error??null},
    safeguards:{walletCalls:0,paidRequests:0,settlementConfirmed:false,
      buyerAuthorizationConfirmed:false,sellerPermissionConfirmed:false,
      description:'Catalog GET pages plus GET/OPTIONS only when the original offer supports GET; no paid request, customer acceptance or settlement.'}
  };
}

export async function capture(config) {
  const observedAt=new Date().toISOString();
  // Preserve original implementations, including redirect/timeout and catalog pagination boundaries.
  const seller=await diagnose({resourceUrl:config.resourceUrl,catalogUrl:config.catalogUrl,
    network:config.network,payTo:config.payTo,allowLoopback:config.allowLoopback});
  let browser=null,error=null;
  // The genuine method-aware SF52 catalog can establish a POST/MCP-only offer.
  // Do not reintroduce a misleading unpaid GET or CORS diagnosis for that offer.
  if (seller.sellerDiscovery.state!=='CATALOG_NON_GET_ONLY') {
    try {
      browser=await probe({resource:config.resourceUrl,origin:config.origin,
        method:config.method,credentialed:config.credentialed});
    } catch (e) { error=String(e?.message||e).slice(0,200); }
  }
  return combine({seller,browser,error,config,observedAt});
}

export async function main(argv=process.argv.slice(2)) {
  const config=parseArgs(argv);
  if (config.help) {process.stdout.write(HELP+'\n');return;}
  const report=await capture(config);
  const json=JSON.stringify(report,null,2)+'\n';
  if (config.out) await writeFile(config.out,json,{flag:'wx',mode:0o600});
  process.stdout.write(json);
  if (report.state==='REMEDIATION_REQUIRED') process.exitCode=2;
  else if (report.state==='INCONCLUSIVE') process.exitCode=3;
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main().catch(e=>{process.stderr.write('SF70 merchant intake: '+String(e.message)+'\n');process.exitCode=1;});
}
