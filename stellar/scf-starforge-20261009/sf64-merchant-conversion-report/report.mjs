// MIT. SF64 merchant-facing portable evidence report. No wallet, payment or contact path.
import {readFile, writeFile, mkdir, rm, stat} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

const MAX_REPORT_BYTES = 1_000_000;
const REPORT_SCHEMA = 'stellar-forge.seller-visibility.v1';
const VERDICTS = new Set([
  'LISTED', 'LISTED_WRONG_NETWORK', 'LISTED_WRONG_PAYTO',
  'LISTED_PAYMENT_ROUTE_MISMATCH', 'NOT_LISTED_IN_EXHAUSTED_CATALOG', 'INCONCLUSIVE_CATALOG'
]);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const plain = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
const html = value => plain(value).replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const display = (value, limit = 1000) => html(plain(value).slice(0, limit));

export function validateOriginalReport(report) {
  if (!report || Array.isArray(report) || typeof report !== 'object' ||
    report.schema !== REPORT_SCHEMA || report.mode !== 'READ_ONLY_UNAUTHENTICATED' ||
    !VERDICTS.has(report.verdict) || !report.catalog || typeof report.catalog !== 'object' ||
    !report.challenge || typeof report.challenge !== 'object' ||
    typeof report.seller !== 'string' || typeof report.catalog.endpoint !== 'string') {
    throw new TypeError('Expected a complete original SF52 diagnostic report');
  }
  for (const locator of [report.seller, report.catalog.endpoint]) {
    const u = new URL(locator);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) {
      throw new TypeError('Report locator has invalid protocol or credentials');
    }
  }
  for (const key of ['pages', 'rawRows', 'uniqueKeys', 'matchingResourceCount']) {
    if (!Number.isSafeInteger(report.catalog[key]) || report.catalog[key] < 0) {
      throw new TypeError('Invalid original catalog counter: ' + key);
    }
  }
  if (typeof report.catalog.complete !== 'boolean' ||
    !Array.isArray(report.catalog.matches) || !Array.isArray(report.catalog.matchingPayToOtherResources) ||
    report.catalog.matches.length > 50 || report.catalog.matchingPayToOtherResources.length > 15 ||
    typeof report.challenge.state !== 'string' || report.challenge.state.length > 120) {
    throw new TypeError('Malformed original SF52 diagnostic fields');
  }
  if (report.verdict === 'NOT_LISTED_IN_EXHAUSTED_CATALOG' &&
    (!report.catalog.complete || report.catalog.matchingResourceCount !== 0)) {
    throw new TypeError('Contradictory absent-catalog classification');
  }
  if (report.verdict === 'LISTED' && report.catalog.matchingResourceCount === 0) {
    throw new TypeError('Contradictory listed-catalog classification');
  }
  // A source report is never elevated to receipt or payment proof by this renderer.
  return report;
}

export function interpret(report) {
  validateOriginalReport(report);
  const tasks = [];
  const add = (priority, finding, action) => tasks.push({priority, finding, action});
  const status = report.challenge.state;
  const statusCode = report.challenge.httpStatus;
  if (statusCode === 200 && (status === 'UNPAID_GET_HTTP_200' || status === 'NOT_HTTP_402')) {
    add('HIGH', 'Unauthenticated seller GET returned HTTP 200 rather than an x402 payment challenge.',
      'Confirm whether a default free tier bypasses the paid route. If this operation is intended to require payment, make free access opt-in and recheck the original 402 before escalating index issues.');
  } else if (status === 'NOT_HTTP_402') {
    add('HIGH', `Unauthenticated seller GET returned HTTP ${String(statusCode)} instead of a payment challenge.`,
      'Check advertised HTTP method and access policy. A POST-only paid operation may be undiscoverable through a GET probe unless it advertises a valid read-only discovery response.');
  } else if (status === 'FETCH_ERROR') {
    add('HIGH', 'The seller probe did not complete.',
      'Check origin connectivity, TLS and non-redirecting path; replay from a permitted environment before attributing fault to a catalog.');
  } else if (status === 'NO_PAYMENT_REQUIRED_HEADER' || status === 'INVALID_PAYMENT_REQUIRED' || status === 'INVALID_ACCEPTS') {
    add('HIGH', `Seller returned HTTP 402 but the v2 payment contract was ${status}.`,
      'Repair the canonical PAYMENT-REQUIRED header/accepts contract at the seller edge and re-run discovery.');
  } else if (status === 'X402_402') {
    add('INFO', 'Seller GET exposed a parsable x402 v2 payment challenge.',
      'Compare the live operation, resource URL, asset, network, recipient and amount with one catalog offer before requesting buyer approval.');
    if (!report.challenge.bazaarExtension) add('MEDIUM', 'No Bazaar discovery extension was observed in the seller challenge.',
      'Review the seller SDK discovery extension and provider-specific indexing requirements.');
  } else {
    add('MEDIUM', `Seller probe yielded ${status}.`, 'Investigate the original SF52 diagnostic JSON before proceeding.');
  }
  switch (report.verdict) {
    case 'LISTED':
      add('INFO', 'Matching resource is visible in the observed facilitator catalog.',
        'Verify actual callable method, current origin 402 terms and authorized fulfillment separately; visibility is not a transaction.'); break;
    case 'NOT_LISTED_IN_EXHAUSTED_CATALOG':
      add('HIGH', 'Resource did not appear in this facilitator catalog after exhaustive pagination.',
        'Validate original seller 402 and Bazaar eligibility, then ask the selected facilitator about ingestion and catalog publication.'); break;
    case 'LISTED_WRONG_NETWORK':
      add('HIGH', 'Catalog has the URL, but none of its accepted options matches the requested network.',
        'Align CAIP-2 network declarations between the origin and published catalog; never substitute a different network.'); break;
    case 'LISTED_WRONG_PAYTO':
      add('HIGH', 'Catalog has the URL, but its accepted options do not match the requested recipient.',
        'Investigate seller identity/recipient binding and update the authoritative listing through its operator.'); break;
    case 'LISTED_PAYMENT_ROUTE_MISMATCH':
      add('HIGH', 'Requested network and recipient occur in catalog metadata but not in one valid payment option.',
        'Reconcile one atomic accepted payment option rather than combining terms from different offers.'); break;
    default:
      add('MEDIUM', 'Catalog crawl did not establish full coverage.',
        `Resolve ${report.catalog.incompleteReason || 'the original pagination limit/error'} before claiming the resource is missing.`);
  }
  const extension = report.extensionResponse?.state;
  if (extension && extension !== 'NOT_PROVIDED') {
    add('INFO', `Previously supplied EXTENSION-RESPONSES was classified ${extension}.`,
      'Verify origin and raw header independently. Processing/success metadata is not a ledger receipt or proof that the resource was delivered.');
  }
  const state = tasks.some(x => x.priority === 'HIGH') ? 'REMEDIATION_REQUIRED' :
    report.verdict === 'INCONCLUSIVE_CATALOG' ? 'INCONCLUSIVE' : 'REVIEW_READY';
  return {state, findings:tasks, catalogVerdict:report.verdict,
    paymentConfirmed:false, sellerAuthorized:false, deliveredResourceConfirmed:false};
}

export function renderReport(report, {capturedAt, sourceSha256} = {}) {
  const assessment = interpret(report);
  const facts = [
    ['Seller', report.seller], ['Facilitator', report.catalog.endpoint],
    ['Network filter', report.network ?? 'Unspecified'],
    ['Recipient filter', report.desiredPayTo ?? 'Unspecified'],
    ['Original observation time', capturedAt || 'Unspecified by supplied report'],
    ['Original SF52 JSON SHA-256', sourceSha256 || 'Not supplied'],
    ['Seller challenge state', report.challenge.state],
    ['Seller GET HTTP', report.challenge.httpStatus ?? 'Request failed'],
    ['Original catalog verdict', report.verdict],
    ['Catalog pages examined', report.catalog.pages],
    ['Raw listings observed', report.catalog.rawRows],
    ['Unique listing keys seen', report.catalog.uniqueKeys],
    ['Matching resource entries', report.catalog.matchingResourceCount],
    ['Catalog exhaustive', report.catalog.complete ? 'YES' : 'NO']
  ];
  const rows = facts.map(([key,value])=>`<tr><th scope="row">${display(key)}</th><td>${display(value)}</td></tr>`).join('\n');
  const items = assessment.findings.map((f,i)=>`<li class="finding"><div class="meta"><span class="pill">${display(f.priority)}</span> Finding ${i + 1}</div><h3>${display(f.finding,2000)}</h3><p><strong>Suggested next action:</strong> ${display(f.action,3000)}</p></li>`).join('\n');
  const warning = 'This is a read-only origin and facilitator-catalog observation. It never pays, signs, verifies chain settlement, authorizes a seller, proves delivery, submits a grant or demonstrates customer revenue.';
  return `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src 'none'; connect-src 'none'; form-action 'none'"><title>Merchant Checkout Evidence | SF64</title><style>
:root{color-scheme:light;--ink:#122a3f;--muted:#526475;--line:#dbe3e8;--accent:#087e70}*{box-sizing:border-box}body{margin:0;background:#f5f8fb;color:var(--ink);font:16px/1.55 system-ui,-apple-system,Segoe UI,sans-serif}.wrap{max-width:940px;margin:0 auto;padding:36px 24px 72px}header{padding-bottom:24px;border-bottom:2px solid var(--accent)}.eyebrow{text-transform:uppercase;letter-spacing:.15em;color:var(--accent);font-weight:750;font-size:.76rem}h1{font-size:clamp(1.8rem,4vw,2.8rem);line-height:1.1;margin:12px 0}h2{font-size:1.3rem;margin:35px 0 15px}.subtitle{color:var(--muted)}.state{display:inline-block;background:#e5f6f1;border:1px solid #a7d8ca;padding:7px 12px;border-radius:8px;font-weight:750;letter-spacing:.03em}table{width:100%;border-collapse:collapse;background:#fff;border:1px solid var(--line);border-radius:12px;table-layout:fixed}th,td{padding:13px 14px;text-align:left;vertical-align:top;border-bottom:1px solid var(--line);overflow-wrap:anywhere}th{width:37%;color:var(--muted);font-weight:600}tr:last-child th,tr:last-child td{border-bottom:0}ol{list-style:none;padding:0;display:grid;gap:13px}.finding{background:white;border:1px solid var(--line);border-radius:12px;padding:19px}.finding h3{font-size:1.03rem;margin:8px 0}.finding p{margin:5px 0}.meta{color:var(--muted);font-size:.83rem}.pill{background:#ebf0f6;border-radius:6px;padding:3px 7px;color:var(--ink);font-weight:700;margin-right:9px}.notice{border-left:4px solid var(--accent);background:#eaf4f3;padding:15px 18px;margin-top:30px}.footer{color:var(--muted);margin-top:35px;font-size:.83rem}@media print{body{background:white}.wrap{padding:0}.finding{break-inside:avoid}}@media(max-width:560px){.wrap{padding:24px 14px 50px}th{width:40%}th,td{padding:9px}table{font-size:.87rem}}
</style></head><body><main class="wrap"><header><div class="eyebrow">Stellar Forge / merchant checkout assurance</div><h1>Checkout evidence report</h1><p class="subtitle">SF64 source-composed diagnostic presentation of the original SF52 live GET and catalog scan.</p><div class="state">${display(assessment.state)}</div></header><section aria-labelledby="evidence"><h2 id="evidence">Observed evidence</h2><table><tbody>${rows}</tbody></table></section><section aria-labelledby="findings"><h2 id="findings">Findings and repair sequence</h2><ol>${items}</ol></section><aside class="notice" aria-label="Scope and limitations"><strong>Interpretation boundary.</strong> ${html(warning)}</aside><p class="footer">Original native report is included as evidence.json; manifest.json carries SHA-256 hashes. Generated locally without remote fonts, scripts, embeds, analytics or browser network requests. The SHA values detect accidental changes and are not signatures.</p></main></body></html>\n`;
}

export function normalizeSourceBytes(source) {
  if (!Buffer.isBuffer(source) || !source.length || source.length > MAX_REPORT_BYTES) {
    throw new RangeError('SF52 input must be a nonempty <=1 MiB JSON document');
  }
  const report = JSON.parse(source.toString('utf8'));
  validateOriginalReport(report);
  // Preserve untouched original JSON bytes. No restaging or rewriting original observations.
  return {report, source};
}

export async function writePackage({source, out, capturedAt} = {}) {
  if (typeof out !== 'string' || !out.trim()) throw new TypeError('Output directory required');
  const {report} = normalizeSourceBytes(source);
  const sourceSha = sha256(source);
  const document = Buffer.from(renderReport(report, {capturedAt, sourceSha256:sourceSha}), 'utf8');
  const manifest = {
    schema:'stellar-forge.merchant-evidence.v1', format:'OFFLINE_HTML_ORIGINAL_SF52',
    capturedAt: capturedAt ?? null, seller:report.seller, catalogVerdict:report.verdict,
    files:{'evidence.json':{bytes:source.length, sha256:sourceSha},'index.html':{bytes:document.length,sha256:sha256(document)}},
    claims:{paymentConfirmed:false,chainReceipt:false,grantAdmission:false,customerAcceptance:false}
  };
  const dir = resolve(out);
  await mkdir(dir,{recursive:false,mode:0o700});
  try {
    await writeFile(join(dir,'evidence.json'),source,{flag:'wx',mode:0o600});
    await writeFile(join(dir,'index.html'),document,{flag:'wx',mode:0o600});
    await writeFile(join(dir,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
  } catch (e) {await rm(dir,{recursive:true,force:true});throw e;}
  return {directory:dir, manifest};
}

export async function verifyPackage(dir) {
  const root = resolve(dir);
  const files = {};
  for (const name of ['manifest.json','evidence.json','index.html']) {
    const path=join(root,name);
    if (!(await stat(path)).isFile()) throw new TypeError('Expected regular package file');
    files[name]=await readFile(path);
    if (files[name].length>MAX_REPORT_BYTES) throw new RangeError('Package artifact too large');
  }
  const manifest=JSON.parse(files['manifest.json'].toString('utf8'));
  if (manifest.schema!=='stellar-forge.merchant-evidence.v1') throw new TypeError('Unrecognized SF64 manifest');
  for (const key of ['evidence.json','index.html']) {
    if (manifest.files?.[key]?.sha256!==sha256(files[key]) || manifest.files?.[key]?.bytes!==files[key].length) {
      throw new Error('Checksum mismatch: '+key);
    }
  }
  const {report}=normalizeSourceBytes(files['evidence.json']);
  if (report.seller!==manifest.seller || report.verdict!==manifest.catalogVerdict) throw new Error('Manifest report mismatch');
  const expected=renderReport(report,{capturedAt:manifest.capturedAt,sourceSha256:sha256(files['evidence.json'])});
  if (!Buffer.from(expected,'utf8').equals(files['index.html'])) throw new Error('Rendered report mismatch');
  if (Object.values(manifest.claims||{}).some(v=>v!==false)) throw new Error('Unexpected elevated claim');
  return {verified:true,sourceSha256:sha256(files['evidence.json']),catalogVerdict:report.verdict};
}

function parseCli(args) {
  const options={};
  const flags={'--report':'reportPath','--out':'out','--verify':'verifyDir','--resource':'resourceUrl',
    '--catalog':'catalogUrl','--network':'network','--pay-to':'payTo','--limit':'pageLimit','--max-pages':'maxPages'};
  for(let i=0;i<args.length;i++) {
    const key=args[i];
    if(key==='--allow-loopback'){options.allowLoopback=true;continue;}
    if(!(key in flags)||!args[i+1]||args[i+1].startsWith('--'))throw new TypeError('Unknown/missing option '+key);
    const value=args[++i];
    if(options[flags[key]]!==undefined)throw new TypeError('Duplicate option '+key);
    options[flags[key]]=key==='--limit'||key==='--max-pages'?Number(value):value;
  }
  if(options.verifyDir) {
    if(Object.keys(options).length!==1)throw new TypeError('--verify may not be combined with other flags');
  } else if(!options.out || (Boolean(options.reportPath)===Boolean(options.resourceUrl&&options.catalogUrl))) {
    throw new TypeError('Provide --out and either --report FILE or both --resource URL --catalog URL');
  }
  return options;
}

export async function main(args) {
  const opts=parseCli(args);
  if(opts.verifyDir)return verifyPackage(opts.verifyDir);
  let source,capturedAt=null;
  if(opts.reportPath) {
    if(opts.resourceUrl||opts.catalogUrl||opts.allowLoopback||opts.network||opts.payTo||opts.pageLimit||opts.maxPages)
      throw new TypeError('Original --report mode has no network/probe options');
    const file=await stat(opts.reportPath);
    if(!file.isFile()||file.size>MAX_REPORT_BYTES)throw new RangeError('Invalid original SF52 file');
    source=await readFile(opts.reportPath);
  } else {
    const {diagnose}=await import('../sf52-merchant-visibility/diagnose.mjs');
    const report=await diagnose({resourceUrl:opts.resourceUrl,catalogUrl:opts.catalogUrl,
      payTo:opts.payTo,network:opts.network,allowLoopback:opts.allowLoopback,
      pageLimit:opts.pageLimit,maxPages:opts.maxPages});
    capturedAt=new Date().toISOString();
    source=Buffer.from(JSON.stringify(report,null,2)+'\n');
  }
  return writePackage({source,out:opts.out,capturedAt});
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(result=>process.stdout.write(JSON.stringify(result,null,2)+'\n'))
    .catch(error=>{process.stderr.write('SF64: '+error.message+'\n');process.exitCode=1;});
}
