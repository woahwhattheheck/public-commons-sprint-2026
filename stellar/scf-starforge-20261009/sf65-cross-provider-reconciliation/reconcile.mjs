// MIT. SF65 independent original-source Bazaar cross-provider audit.
// Input snapshots come from unchanged SF56 snapshotFromNative(), which verifies
// raw SF41 capture SHA-256, complete native paging, and SF45 route identity.
// This module makes no network request, payment, wallet or settlement call.
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const hash=x=>typeof x==='string'&&/^[a-f0-9]{64}$/i.test(x);
const cmp=(a,b)=>a<b?-1:a>b?1:0;
const fail=x=>{throw new TypeError(x);};
function source(s,label){
  if(!object(s)||s.schema!=='SCF-SF56/snapshot-v1'||
    !(s.entries instanceof Map)||!Number.isSafeInteger(s.count)||
    s.count!==s.entries.size||!hash(s.manifest_sha256)||
    !['DECLARED_TOTAL_MATCHED','EXPLICIT_EMPTY_PAGE'].includes(s.coverage)||
    typeof s.timestamp!=='string'||!Number.isFinite(Date.parse(s.timestamp)))
    fail(label+'_NOT_VERIFIED_SF41_SNAPSHOT');
  const url=new URL(s.scope);
  if(url.protocol!=='https:'||url.username||url.password||url.hash||
     !url.pathname.endsWith('/discovery/resources')||
     url.searchParams.has('offset')||url.searchParams.has('limit'))
    fail(label+'_INVALID_PROVIDER_SCOPE');
  const network=url.searchParams.get('network');
  if(!['stellar:testnet','stellar:pubnet'].includes(network)||
    url.searchParams.getAll('network').length!==1)
    fail(label+'_EXPLICIT_STELLAR_NETWORK_REQUIRED');
  const filters=[...url.searchParams.entries()].sort((a,b)=>cmp(a[0],b[0])||cmp(a[1],b[1]));
  if(filters.some(([k,v])=>!k||!v||['cursor','page'].includes(k)))
    fail(label+'_INVALID_FILTER');
  for(const [id,entry] of s.entries){
    if(typeof id!=='string'||id.length>4096||!object(entry)||
      !hash(entry.payment)||!hash(entry.contract)||!hash(entry.metadata)||
      !Number.isSafeInteger(entry.offer_count)||entry.offer_count<1||
      !Array.isArray(entry.networks)||!entry.networks.every(x=>typeof x==='string'))
      fail(label+'_INVALID_NATIVE_ROUTE_BUCKET');
  }
  return {provider:url.origin+url.pathname,network,filters:JSON.stringify(filters)};
}
export function reconcileNativeProviders(left,right,{maxItems=100000}={}){
  if(!Number.isSafeInteger(maxItems)||maxItems<1||maxItems>100000)fail('INVALID_REPORT_BOUND');
  const a=source(left,'LEFT'),b=source(right,'RIGHT');
  if(a.provider===b.provider)fail('INDEPENDENT_PROVIDER_ENDPOINTS_REQUIRED');
  if(a.network!==b.network||a.filters!==b.filters)fail('INCOMPARABLE_NETWORK_OR_FILTER_SCOPE');
  const identities=[...new Set([...left.entries.keys(),...right.entries.keys()])].sort(cmp);
  if(identities.length>maxItems)fail('REPORT_TOO_MANY_ROUTES');
  const counts={bothIdentical:0,metadataOnly:0,paymentTermsConflict:0,inputContractConflict:0,
    combinedConflict:0,onlyLeft:0,onlyRight:0,requiresReview:0};
  const findings=[];
  for(const identity of identities){
    const l=left.entries.get(identity)||null,r=right.entries.get(identity)||null;
    let status,risk='INFO';
    if(!l){status='ONLY_RIGHT_OBSERVED';counts.onlyRight++;}
    else if(!r){status='ONLY_LEFT_OBSERVED';counts.onlyLeft++;}
    else {
      const p=l.payment!==r.payment,c=l.contract!==r.contract;
      if(p&&c){status='PAYMENT_AND_CONTRACT_CONFLICT';counts.combinedConflict++;risk='REVIEW';}
      else if(p){status='PAYMENT_TERMS_CONFLICT';counts.paymentTermsConflict++;risk='REVIEW';}
      else if(c){status='INPUT_CONTRACT_CONFLICT';counts.inputContractConflict++;risk='REVIEW';}
      else if(l.metadata!==r.metadata){status='METADATA_ONLY';counts.metadataOnly++;}
      else {status='IDENTICAL_ADVERTISEMENT';counts.bothIdentical++;}
    }
    if(risk==='REVIEW')counts.requiresReview++;
    findings.push({identity,status,risk,left:l,right:r});
  }
  const skew=Math.abs(Date.parse(left.timestamp)-Date.parse(right.timestamp));
  const paired=skew<=90*60*1000;
  return {
    schema:'SCF-SF65/cross-provider-audit-v1',mode:'READ_ONLY_NATIVE_CAPTURE_RECONCILIATION',
    basis:'SHA256_VERIFIED_COMPLETE_INDEPENDENT_SF41_CAPTURE_V1',
    network:a.network,filterScope:JSON.parse(a.filters),
    capturePair:{skewSeconds:Math.round(skew/1000),temporallyPaired:paired,
      warning:paired?null:'Captures exceed 90-minute alignment; differences may be time drift.'},
    providers:{left:{endpoint:a.provider,capturedAt:left.timestamp,manifestSha256:left.manifest_sha256,
      coverage:left.coverage,observedRoutes:left.count,captureRows:left.capture_rows},
      right:{endpoint:b.provider,capturedAt:right.timestamp,manifestSha256:right.manifest_sha256,
      coverage:right.coverage,observedRoutes:right.count,captureRows:right.capture_rows}},
    summary:{uniqueRoutes:identities.length,sharedRoutes:identities.length-counts.onlyLeft-counts.onlyRight,...counts},
    findings,
    interpretation:'Compares advertised original-source payment, input and metadata hashes; does not establish seller authority, live HTTP 402, payment, settlement or customer adoption. Provider-only means absent in that complete observed filter scope, not worldwide absence.',
    paymentCalls:0,merchantCalls:0,signedTransactions:0
  };
}
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function renderCrossProviderHtml(report,{displayLimit=500}={}){
  if(report?.schema!=='SCF-SF65/cross-provider-audit-v1')fail('INVALID_REPORT');
  if(!Number.isSafeInteger(displayLimit)||displayLimit<1||displayLimit>2000)fail('INVALID_DISPLAY_LIMIT');
  const c=report.summary,p=report.providers;
  const rows=report.findings.filter(x=>x.risk==='REVIEW').concat(report.findings.filter(x=>x.risk!=='REVIEW')).slice(0,displayLimit);
  const stat=(name,value)=>'<div class="stat"><strong>'+esc(value)+'</strong><small>'+esc(name)+'</small></div>';
  const cell=x=>'<td>'+esc(x)+'</td>';
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'"><title>SF65: Cross-provider discovery integrity</title><style>'+
    ':root{font:15px system-ui;color-scheme:dark;background:#0c1320;color:#e8edf7}body{max-width:1400px;margin:auto;padding:30px 22px}h1{font-size:34px}p{color:#b6c4d5;line-height:1.6}.stats{display:flex;flex-wrap:wrap;gap:12px}.stat{background:#17263a;border:1px solid #2c4863;padding:18px;border-radius:12px;min-width:130px}.stat strong{display:block;font-size:28px}.stat small{color:#a5bacf}.warn{border-left:4px solid #e7a652;padding:18px;background:#352719}.scope{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin:20px 0}.scope div{overflow-wrap:anywhere;background:#152234;padding:17px}table{width:100%;border-collapse:collapse}th,td{text-align:left;border-bottom:1px solid #293e53;padding:10px;font-size:12px;overflow-wrap:anywhere}th{color:#72dbc8}section{overflow-x:auto}'+
    '</style></head><body><h1>Stellar Forge SF65 / Cross-provider discovery integrity</h1><p>Unmodified SF56 native validator + SF41 raw page hashes + SF45 route identity. No remote fetches or wallet operations.</p><div class="warn">Read-only captured advertisements, not payment authorization. Conflict requires separate verified live 402 and seller authority review.'+
    (report.capturePair.temporallyPaired?'':' Captures are over 90 minutes apart.')+'</div><div class="stats">'+
    stat('Unique routes',c.uniqueRoutes)+stat('Shared routes',c.sharedRoutes)+stat('Payment conflicts',c.paymentTermsConflict+c.combinedConflict)+
    stat('Contract conflicts',c.inputContractConflict+c.combinedConflict)+stat('Left only',c.onlyLeft)+stat('Right only',c.onlyRight)+
    '</div><div class="scope"><div><b>Provider A</b><p>'+esc(p.left.endpoint)+' / '+esc(p.left.capturedAt)+'</p><code>'+esc(p.left.manifestSha256)+'</code></div><div><b>Provider B</b><p>'+esc(p.right.endpoint)+' / '+esc(p.right.capturedAt)+'</p><code>'+esc(p.right.manifestSha256)+'</code></div></div><p>Network: '+esc(report.network)+'. Capture difference: '+esc(report.capturePair.skewSeconds)+' seconds. '+esc(rows.length)+' prioritized of '+esc(c.uniqueRoutes)+' full JSON findings shown.</p><section><table><thead><tr><th>Risk</th><th>Native canonical route</th><th>Observation</th><th>A offers</th><th>B offers</th></tr></thead><tbody>'+
    rows.map(row=>'<tr>'+cell(row.risk)+cell(row.identity)+cell(row.status)+cell(row.left?.offer_count??'Not observed')+cell(row.right?.offer_count??'Not observed')+'</tr>').join('')+
    '</tbody></table></section><p>All findings and capture/source SHA-256 identifiers are retained in the JSON report. No JavaScript, tracking or payment actions in this HTML.</p></body></html>';
}
