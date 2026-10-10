// Public-source, read-only migration preflight. Does not certify WCAG or act on forms.
import {readFile, writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const DEFAULT_MANIFEST = new URL('./baseline.json', import.meta.url);
const MAX_BYTES = 1536 * 1024;
const norm = s => String(s).replace(/&amp;/gi,'&').replace(/&#38;/gi,'&');
const fail = s => {throw new Error(s)};
function validateBaseline(b){
  if(b.schema !== 'commons.city-site-first-party-sample.v1' || b.rfpId!=='RFP 51-26') fail('Unexpected manifest schema or buyer RFP identity');
  if(!Array.isArray(b.pages) || b.pages.length !== 5) fail('Expected five source-sampled pages');
  if(!Array.isArray(b.criticalOutbound) || b.criticalOutbound.length < 5) fail('Expected original outbound service register');
  for(const p of b.pages){
    if(typeof p.path !== 'string' || !p.path.startsWith('/') || p.path.includes('..') || p.path.includes('?')) fail('Unsafe original page path');
    if(new URL(p.url).hostname!=='www.cityofvancouver.us') fail('Unexpected original page host');
  }
  return b;
}
export function buildPlan(manifest){
  const b=validateBaseline(manifest);
  return {schema:'commons.city-site-qa-plan.v1',rfpId:b.rfpId,
    originalCityPortal:b.portalUrl,closedAt:b.closingDateLocal,
    sampledPages:b.pages.map(p=>({id:p.id,path:p.path,source:p.url,why:p.purpose,verification:'PENDING_LIVE_TARGET_CHECK'})),
    sampledOutbound:b.criticalOutbound.map(x=>({id:x.id,originalUrl:x.url,kind:x.kind,review:x.review,verification:'OWNER_REVIEW_REQUIRED'})),
    sampleSummary:b.sampleSummary,
    criticalLimitations:['Source observations are five public pages, not full buyer RFP or exhaustive content inventory', 'Absence of a link on a redesigned page may be an intended navigation change', 'HTTP or HTML presence alone cannot establish accessible behavior or payment functionality', 'No client, bidder, subcontract, contract or agency instruction is implied']};
}

function extractHrefs(html){
  return [...html.matchAll(/\bhref\s*=\s*(['"])([\s\S]*?)\1/gi)].map(m=>norm(m[2].trim()));
}
function hrefMatches(href,needed,base){
  try { return new URL(href,base).href === new URL(needed).href; }catch {return false}
}
async function getHtml(url,{timeoutMs=8000,fetchImpl=fetch}={}){
  const res=await fetchImpl(url,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(timeoutMs),headers:{'accept':'text/html'}});
  const status=res.status;
  const type=res.headers.get('content-type')||'';
  if(!(status>=200 && status<300) || !/text\/html/i.test(type)){
    await res.body?.cancel().catch(()=>{});
    return {httpStatus:status,contentType:type,html:null,error:status>=300&&status<400?'REDIRECT_REQUIRES_REVIEW':'NOT_HTML_OR_NON_2XX'};
  }
  const reader=res.body?.getReader();
  if(!reader) return {httpStatus:status,contentType:type,html:null,error:'NO_RESPONSE_BODY'};
  const chunks=[];let size=0;
  try{
    for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;
      if(size>MAX_BYTES){await reader.cancel();return {httpStatus:status,contentType:type,html:null,error:'BODY_OVER_BYTE_LIMIT'};}
      chunks.push(value);
    }
  }finally{reader.releaseLock();}
  return {httpStatus:status,contentType:type,html:Buffer.concat(chunks).toString('utf8'),bytes:size};
}
export async function inspectTarget(manifest,{targetBase,timeoutMs=8000,fetchImpl=fetch}={}){
  const b=validateBaseline(manifest);
  if(!targetBase) fail('Specify --target-base (owner-controlled candidate/staging origin)');
  const base = new URL(targetBase);
  if(!['http:','https:'].includes(base.protocol)||base.username||base.password||base.search||base.hash||base.pathname!=='/') fail('Target must be an HTTP(S) origin URL without path or credentials');
  const rows=[];
  for(const p of b.pages){
    const destination=new URL(p.path,base);
    if(destination.origin!==base.origin) fail('Unsafe target path escape');
    let response;
    try {response=await getHtml(destination.href,{timeoutMs,fetchImpl})}
    catch(error){response={httpStatus:null,contentType:null,error:'FETCH_FAILED',detail:String(error.message).slice(0,160)};}
    const html=response.html;
    const hrefs=html===null?[]:extractHrefs(html);
    const required=b.criticalOutbound.filter(x=>x.seenOn===p.id);
    const boundaryResults=required.map(x=>({id:x.id,originalUrl:x.url,
      evidence:html===null?'NOT_TESTED':hrefs.some(href=>hrefMatches(href,x.url,destination.href))?'LINK_PRESENT':'NEEDS_OWNER_REVIEW',
      ownerReview:x.review}));
    rows.push({pageId:p.id,url:destination.href,originalUrl:p.url,status:html===null?'NO_HTML_OBSERVED':'OBSERVED_HTML',
      httpStatus:response.httpStatus,contentType:response.contentType,error:response.error||null,
      htmlBytes:response.bytes||0,
      markers:html===null?null:{hasMain:/<main\b/i.test(html),hasH1:/<h1\b/i.test(html),hasHtmlLanguage:/<html\b[^>]*\blang\s*=/i.test(html),forms:(html.match(/<form\b/gi)||[]).length,hrefs:hrefs.length,documentLinks:hrefs.filter(h=>/\.pdf(?:[?#]|$)/i.test(h)).length},
      originalOutboundChecks:boundaryResults,
      notes:'No form submitted, external service fetched, payment made, authenticated route tested or WCAG conformance certified'});
  }
  return {schema:'commons.city-site-live-acceptance.v1',originalBuyerRfp:b.rfpId,checkedAt:new Date().toISOString(),targetOrigin:base.origin,
    pageCount:rows.length,pages:rows,
    overall:'REVIEW_REQUIRED',
    caveat:'This preflight samples five pages and link presence; manual keyboard/screenreader, PDF accessibility, redirects/SEO, full content migration, form safety and third-party system acceptance remain owner gates'};
}
export async function main(args){
  const flags={};for(let i=0;i<args.length;i++){
    if(args[i]==='--plan'){flags.plan=true;continue;}
    if(!['--manifest','--target-base','--out','--timeout-ms'].includes(args[i])||!args[i+1]) fail('Usage: --plan or --target-base ORIGIN [--manifest baseline.json] [--out output.json] [--timeout-ms 8000]');
    flags[args[i].slice(2)]=args[++i];
  }
  const baseline=validateBaseline(JSON.parse(await readFile(flags.manifest||DEFAULT_MANIFEST,'utf8')));
  const result=flags.plan?buildPlan(baseline):await inspectTarget(baseline,{targetBase:flags['target-base'],timeoutMs:flags['timeout-ms']?Number(flags['timeout-ms']):8000});
  const output=JSON.stringify(result,null,2)+'\n';
  if(flags.out){await writeFile(flags.out,output,{flag:'wx',mode:0o600});return {saved:resolve(flags.out),pageCount:result.sampledPages?.length||result.pageCount};}
  process.stdout.write(output);return result;
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) main(process.argv.slice(2)).catch(e=>{console.error('acceptance: '+e.message);process.exitCode=1;});
