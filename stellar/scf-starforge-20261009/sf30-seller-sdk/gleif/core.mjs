// SPDX-License-Identifier: MIT
// Official GLEIF JSON:API source meanings and the shared browser/Node research model.
export const SCHEMA = 'stellar-forge.gleif-research.v1';
export const API = 'https://api.gleif.org/api/v1/lei-records';
export const SOURCE = Object.freeze({
  publisher: 'Global Legal Entity Identifier Foundation',
  name: 'GLEIF LEI reference data',
  api: 'https://www.gleif.org/en/lei-data/gleif-api/',
  documentation: 'https://documenter.getpostman.com/view/7679680/SVYrrxuU',
  dictionary: 'https://www.gleif.org/en/lei-data/access-and-use-lei-data/gleif-data-dictionary',
  terms: 'https://www.gleif.org/en/meta/lei-data-terms-of-use'
});
export const COLUMNS = Object.freeze(['lei','legalName','legalNameLanguage','otherNames','transliteratedOtherNames',
  'entityStatus','category','subCategory','legalJurisdiction','legalFormId','legalFormOther',
  'registrationAuthorityId','registrationAuthorityEntityId','legalAddress','headquartersAddress',
  'creationDate','registrationStatus','initialRegistrationDate','lastUpdateDate','nextRenewalDate',
  'managingLou','validationSources','bic','successorEntities','entityEvents','relationshipReferences',
  'captureId','sourcePage','sourceObservedAt']);
export const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const clone = value => JSON.parse(JSON.stringify(value));
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const stable = value => JSON.stringify(canonical(value));
export function fail(code, message, status = 400) { throw Object.assign(new Error(message || code), {code, status}); }
export function need(condition, code, message, status) { if (!condition) fail(code, message, status); }
export function label(value, name = 'value', max = 1000, optional = false) {
  need(typeof value === 'string' && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value) &&
    (optional || value.trim().length > 0), 'GLEIF_INPUT', 'Enter a valid ' + name + '.');
  return value;
}
export function key(value, name = 'record ID') {
  need(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(value), 'GLEIF_ID', 'Choose a simple ' + name + '.');
  return value;
}
export function lei(value) {
  need(typeof value === 'string' && /^[A-Z0-9]{18}[0-9]{2}$/.test(value), 'GLEIF_LEI', 'Use the complete 20-character uppercase LEI.');
  let remainder = 0;
  for (const c of value) for (const digit of (/[0-9]/.test(c) ? c : String(c.charCodeAt(0)-55))) remainder = (remainder*10+Number(digit))%97;
  need(remainder === 1, 'GLEIF_LEI_CHECK_DIGITS', 'The LEI check digits do not match.');
  return value;
}
export function plan(value) {
  need(object(value) && ['name','lei'].includes(value.kind), 'GLEIF_QUERY', 'Select a name search or exact LEI.');
  const result = {kind:value.kind, query:value.kind === 'lei' ? lei(value.query) : label(value.query,'legal name',500)};
  if (value.kind === 'name') {
    const pageSize = value.pageSize ?? 100;
    need(Number.isInteger(pageSize) && pageSize >= 1 && pageSize <= 100, 'GLEIF_PAGE_SIZE','Choose 1 to 100 records per source page.');
    result.pageSize = pageSize;
    if (value.country) { need(/^[A-Z]{2}$/.test(value.country),'GLEIF_COUNTRY','Use the two-letter source country code.'); result.country=value.country; }
    for (const name of ['entityStatus','registrationStatus']) if (value[name]) {
      need(/^[A-Z][A-Z_]{0,63}$/.test(value[name]),'GLEIF_STATUS','Use the exact source status.'); result[name]=value[name];
    }
  } else need(!value.country && !value.entityStatus && !value.registrationStatus,'GLEIF_QUERY','Exact LEI lookup does not use search filters.');
  return result;
}
export function queryUrl(value) {
  const selected=plan(value); if(selected.kind==='lei') return API+'/'+selected.query;
  const url=new URL(API); url.searchParams.set('filter[entity.legalName]',selected.query);
  if(selected.country) url.searchParams.set('filter[entity.legalAddress.country]',selected.country);
  if(selected.entityStatus) url.searchParams.set('filter[entity.status]',selected.entityStatus);
  if(selected.registrationStatus) url.searchParams.set('filter[registration.status]',selected.registrationStatus);
  url.searchParams.set('page[size]',String(selected.pageSize));url.searchParams.set('page[number]','1');return url.href;
}
export function linkUrl(link) {
  if(link === null || link === undefined) return null;
  const value=object(link)?link.href:link;
  need(typeof value==='string' && value.length<=16000,'GLEIF_SOURCE_LINK','The source returned an invalid page link.');
  return value;
}
export function sameRequest(a,b) {
  const x=new URL(a),y=new URL(b);
  const entries=u=>[...u.searchParams.entries()].sort(([a,av],[b,bv])=>a.localeCompare(b)||av.localeCompare(bv));
  return x.origin===y.origin&&x.pathname===y.pathname&&stable(entries(x))===stable(entries(y));
}
function pageSelection(url) {
  return [...url.searchParams.entries()].filter(([k])=>k!=='page[number]').sort(([a,av],[b,bv])=>a.localeCompare(b)||av.localeCompare(bv));
}
export function nextPage(link,first,current) {
  const value=linkUrl(link);if(value===null) return null;
  let url;try{url=new URL(value,current);}catch{fail('GLEIF_SOURCE_LINK','The source page link is not a URL.');}
  const initial=new URL(first),before=new URL(current);
  need(url.origin===new URL(API).origin && url.pathname===initial.pathname && !url.username && !url.password && !url.hash &&
    stable(pageSelection(url))===stable(pageSelection(initial)),
    'GLEIF_SOURCE_SCOPE_CHANGED','The next page changes the original source query.');
  const n=url.searchParams.getAll('page[number]'),old=Number(before.searchParams.get('page[number]')??1);
  need(n.length===1 && /^[1-9][0-9]*$/.test(n[0]) && Number.isSafeInteger(Number(n[0])) && Number(n[0])===old+1,
    'GLEIF_SOURCE_PAGE_SEQUENCE','The source did not return the following page in this query.');
  return url.href;
}
export function decodePage(raw, url) {
  label(raw,'source JSON',64*1024*1024);
  let data;try{data=JSON.parse(raw);}catch{fail('GLEIF_SOURCE_JSON','The original response is not valid JSON.');}
  need(object(data) && !data.errors && (Array.isArray(data.data)||object(data.data)||data.data===null),
    'GLEIF_SOURCE_RESPONSE','The response must contain the original JSON:API data.');
  const resources=data.data===null?[]:Array.isArray(data.data)?data.data:[data.data];
  for(const resource of resources) {
    need(object(resource)&&resource.type==='lei-records'&&typeof resource.id==='string'&&object(resource.attributes),
      'GLEIF_SOURCE_RESOURCE','The selected response must contain original LEI resources.');
    lei(resource.id);need(resource.attributes.lei===resource.id,'GLEIF_SOURCE_IDENTITY','The resource ID and LEI field differ.');
    need(object(resource.attributes.entity)&&object(resource.attributes.entity.legalName)&&
      typeof resource.attributes.entity.legalName.name==='string','GLEIF_SOURCE_NAME','The source legal name is missing.');
  }
  if(data.included!==undefined)need(Array.isArray(data.included),'GLEIF_SOURCE_INCLUDED','The source included records are malformed.');
  if(data.links!==undefined)need(object(data.links),'GLEIF_SOURCE_LINKS','The source links are malformed.');
  return {document:data,resources,next:linkUrl(data.links?.next),sourceUrl:url};
}
const cell=value=>value===null||value===undefined?'':typeof value==='string'?value:JSON.stringify(value);
export function projectEntity(resource,context) {
  const a=resource.attributes,e=a.entity,r=a.registration??{},form=e.legalForm??{};
  return {
    lei:resource.id,legalName:e.legalName.name,legalNameLanguage:cell(e.legalName.language??e.legalName.lang),
    otherNames:cell(e.otherNames??[]),transliteratedOtherNames:cell(e.transliteratedOtherNames??[]),
    entityStatus:cell(e.status),category:cell(e.category),subCategory:cell(e.subCategory),legalJurisdiction:cell(e.jurisdiction),
    legalFormId:cell(form.id),legalFormOther:cell(form.other),registrationAuthorityId:cell(e.registeredAt?.id),
    registrationAuthorityEntityId:cell(e.registeredAs),
    legalAddress:cell(e.legalAddress),headquartersAddress:cell(e.headquartersAddress),creationDate:cell(e.creationDate),
    registrationStatus:cell(r.status),initialRegistrationDate:cell(r.initialRegistrationDate),lastUpdateDate:cell(r.lastUpdateDate),
    nextRenewalDate:cell(r.nextRenewalDate),managingLou:cell(r.managingLou),validationSources:cell(r.corroborationLevel??r.validationSources),
    bic:cell(a.bic??[]),successorEntities:cell(e.successorEntities??(e.successorEntity?[e.successorEntity]:[])),
    entityEvents:cell(e.eventGroups??[]),relationshipReferences:cell(resource.relationships??{}),
    captureId:context.captureId,sourcePage:String(context.page),sourceObservedAt:context.observedAt
  };
}
export function assembleCapture(capture,pages) {
  need(capture.schema===SCHEMA+'.capture'&&Array.isArray(capture.pages)&&capture.pages.length===pages.length,
    'GLEIF_CAPTURE','Choose a complete retained capture.');
  const records=[],issues=[],seen=new Map();let first=queryUrl(capture.plan),expected=first;
  for(let i=0;i<pages.length;i++) {
    const page=capture.pages[i],decoded=decodePage(pages[i],page.url);
    need(sameRequest(page.url,expected),'GLEIF_CAPTURE_SEQUENCE','The retained page sequence differs from its query.');
    for(const record of decoded.resources) {
      if(seen.has(record.id))issues.push({code:'GLEIF_CAPTURE_DUPLICATE',message:'The source repeats LEI '+record.id+'. Retain this edition and acquire a new complete query before using it for company decisions.',lei:record.id,firstPage:seen.get(record.id),repeatedPage:i+1});
      else seen.set(record.id,i+1);
      records.push({row:projectEntity(record,{captureId:capture.id,page:i+1,observedAt:page.observedAt}),resource:clone(record),page:i+1});
    }
    expected=nextPage(decoded.next,first,page.url);
    need(i===pages.length-1||expected!==null,'GLEIF_CAPTURE_SEQUENCE','Pages occur after the source ended.');
  }
  need((capture.next===null&&expected===null)||(typeof capture.next==='string'&&typeof expected==='string'&&sameRequest(capture.next,expected)),'GLEIF_CAPTURE_CURSOR','The saved continuation differs from the retained response.');
  need(capture.state!=='COMPLETE'||(pages.length>0&&expected===null),'GLEIF_CAPTURE_INCOMPLETE','The original source still has pages.');
  return {records,complete:capture.state==='COMPLETE'&&issues.length===0,sourceComplete:pages.length>0&&expected===null,issues,next:expected};
}
export function compareRecords(before,after) {
  const a=new Map(before.map(x=>[x.resource.id,x])),b=new Map(after.map(x=>[x.resource.id,x])),added=[],missing=[],changed=[],unchanged=[];
  for(const [id,item]of b){if(!a.has(id))added.push(item);else{
    const old=a.get(id),fields=[];diff(old.resource.attributes,item.resource.attributes,'/attributes',fields);
    diff(old.resource.relationships??{},item.resource.relationships??{},'/relationships',fields);
    if(fields.length)changed.push({lei:id,legalName:item.row.legalName,before:old,after:item,fields});else unchanged.push(id);
  }}
  for(const [id,item]of a)if(!b.has(id))missing.push(item);
  return {added,missing,changed,unchanged,counts:{before:a.size,after:b.size,added:added.length,missing:missing.length,changed:changed.length,unchanged:unchanged.length}};
}
function diff(a,b,path,out) {
  if(stable(a)===stable(b))return;
  if(object(a)&&object(b)){for(const k of new Set([...Object.keys(a),...Object.keys(b)]))diff(a[k],b[k],path+'/'+k.replaceAll('~','~0').replaceAll('/','~1'),out);}
  else out.push({path,before:a===undefined?null:clone(a),after:b===undefined?null:clone(b),beforePresent:a!==undefined,afterPresent:b!==undefined});
}
export function reviewInput(value,captures) {
  need(object(value),'GLEIF_REVIEW','Choose an entity and review decision.');
  const capture=captures.find(c=>c.id===value.captureId);need(capture,'GLEIF_REVIEW_CAPTURE','The source capture is not retained.');
  const result={id:key(value.id),title:label(value.title,'company research title',200),captureId:capture.id,
    lei:lei(value.lei),decision:value.decision,reviewer:label(value.reviewer,'reviewer',200),
    rationale:label(value.rationale,'research rationale',8000,true),
    useCase:label(value.useCase??'','customer use case',4000,true),nextWork:label(value.nextWork??'','next research work',4000,true)};
  need(['include','exclude','research'].includes(result.decision),'GLEIF_REVIEW_DECISION','Choose Include, Exclude or Research.');
  return result;
}
export function csv(rows,{spreadsheet=false}={}) {
  const quote=value=>{let text=cell(value);if(spreadsheet&&/^[\u0009\u000d\u0020]*[=+\-@]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  return [COLUMNS,...rows.map(row=>COLUMNS.map(k=>row[k]))].map(row=>row.map(quote).join(',')).join('\r\n')+'\r\n';
}
export function escapeHtml(value) {return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');}
function parsedSourceValue(value) {
  if(typeof value!=='string')return value;
  try{return JSON.parse(value);}catch{return value;}
}
export function sourceWords(value) {
  const text=String(value??'').trim().replace(/[-_]+/g,' ').toLowerCase();
  return text?text[0].toUpperCase()+text.slice(1):'Not supplied';
}
export function countryName(value,{showCode=false}={}) {
  const code=String(value??'').trim();
  if(!code)return 'Not supplied';
  if(!/^[A-Z]{2}$/i.test(code))return code;
  try{
    const name=new Intl.DisplayNames(['en'],{type:'region'}).of(code.toUpperCase());
    return name&&name!==code?(showCode?name+' ('+code+')':name):code;
  }catch{return code;}
}
export function sourceAddress(value) {
  const address=parsedSourceValue(value);
  if(!address||typeof address!=='object'||Array.isArray(address))return escapeHtml(value||'Not supplied');
  const lines=[
    ...(Array.isArray(address.addressLines)?address.addressLines:[]),
    address.mailRouting,
    [address.postalCode,address.city].filter(value=>value!==null&&value!==undefined&&value!=='').join(' '),
    address.country?countryName(address.country):address.region
  ].filter(value=>value!==null&&value!==undefined&&String(value).trim());
  return lines.length?[...new Set(lines.map(String))].map(line=>escapeHtml(line)).join('<br>'):'Not supplied';
}
export function sourceDate(value,{time=false}={}) {
  if(!value)return 'Not supplied';
  const date=new Date(value);
  return Number.isFinite(date.getTime())?'<time datetime="'+escapeHtml(value)+'" title="'+escapeHtml(value)+'">'+escapeHtml(new Intl.DateTimeFormat('en-GB',{dateStyle:'medium',...(time?{timeStyle:'short'}:{}),timeZone:'UTC'}).format(date)+(time?' UTC':''))+'</time>':escapeHtml(value);
}
export function sourceRelationships(value) {
  const references=parsedSourceValue(value);
  if(!references||typeof references!=='object'||Array.isArray(references))return '<p>'+escapeHtml(value||'No relationship references supplied.')+'</p>';
  const names={'managing-lou':'Managing LEI organisation','lei-issuer':'LEI issuer','field-modifications':'Field changes','direct-parent':'Direct parent','ultimate-parent':'Ultimate parent','branches':'Branches','head-office':'Head office'};
  const linkNames={'related':'Source reference','lei-record':'Company record','relationship-record':'Relationship record','relationship-records':'Relationship records','reporting-exception':'Reporting exception'};
  const entries=Object.entries(references);
  return entries.length?entries.map(([kind,reference])=>{
    const links=reference&&typeof reference==='object'?reference.links:null;
    const rendered=links&&typeof links==='object'?Object.entries(links).map(([name,value])=>{
      const href=typeof value==='string'?value:value?.href;
      const label=linkNames[name]??sourceWords(name);
      try{
        const url=new URL(href);
        if(url.protocol==='https:'||url.protocol==='http:')return '<a class="hint" href="'+escapeHtml(href)+'" target="_blank" rel="noopener noreferrer">'+escapeHtml(label)+'</a>';
      }catch{}
      return '<span>'+escapeHtml(label)+(href?': '+escapeHtml(href):'')+'</span>';
    }).join(' · '):'<pre>'+escapeHtml(JSON.stringify(reference,null,2))+'</pre>';
    return '<p><strong>'+escapeHtml(names[kind]??sourceWords(kind))+'</strong>'+rendered+'</p>';
  }).join(''):'<p>No relationship references supplied.</p>';
}
export function sourceFact(key,value) {
  if(key==='legalAddress'||key==='headquartersAddress')return sourceAddress(value);
  if(key==='legalJurisdiction')return escapeHtml(countryName(value,{showCode:true}));
  if(key==='nextRenewalDate')return sourceDate(value);
  if(key==='entityStatus'||key==='registrationStatus')return escapeHtml(sourceWords(value));
  return escapeHtml(value||'Not supplied');
}
export const COMPANY_FACT_LABELS=Object.freeze({lei:'Legal entity identifier',entityStatus:'Entity status',registrationStatus:'LEI registration',legalJurisdiction:'Legal jurisdiction',legalAddress:'Legal address',headquartersAddress:'Headquarters address',nextRenewalDate:'Next renewal'});
export function sourceReferenceDetails(row) {
  return '<details><summary>Registration and relationship references</summary><p><strong>Registration authority ID</strong>'+escapeHtml(row.registrationAuthorityId||'Not supplied')+'</p><p><strong>Registered entity number</strong>'+escapeHtml(row.registrationAuthorityEntityId||'Not supplied')+'</p>'+sourceRelationships(row.relationshipReferences)+'</details>';
}
function sourceObservation(capture) {
  const observed=capture.pages.map(page=>page.observedAt).filter(Boolean);
  if(!observed.length)return 'Observation time not supplied';
  const first=observed[0],last=observed.at(-1);
  return sourceDate(first,{time:true})+(first!==last?' to '+sourceDate(last,{time:true}):'');
}
function researchDecision(review) {
  if(!review)return '<p class="muted">Awaiting a saved research decision for this source edition.</p>';
  const labels={include:'Include in shortlist',exclude:'Exclude from shortlist',research:'Research'};
  return '<h4>Saved research decision</h4><p><strong>'+escapeHtml(labels[review.decision]??sourceWords(review.decision))+'</strong> · '+escapeHtml(review.reviewer)+'</p>'+
    [['Research rationale',review.rationale],['Customer use case',review.useCase],['Next research work',review.nextWork]].filter(([,value])=>value).map(([label,value])=>'<p class="research-note"><strong>'+escapeHtml(label)+'</strong>'+escapeHtml(value)+'</p>').join('');
}
export function reportHtml({title,createdAt,records,reviews,captures,comparison=null}) {
  const e=escapeHtml,bySource=new Map(reviews.map(r=>[r.captureId+'/'+r.lei,r]));
  const editions=new Map(captures.map(c=>[c.id,c]));
  const fact=(label,value)=>'<div><dt>'+e(label)+'</dt><dd>'+value+'</dd></div>';
  const comparisonHtml=comparison?'<section><h2>Source revision comparison</h2><dl class="facts">'+
    [['Added',comparison.counts?.added??comparison.added?.length??0],['Changed',comparison.counts?.changed??comparison.changed?.length??0],['Absent from the later search',comparison.counts?.missing??comparison.missing?.length??0],['Unchanged',comparison.counts?.unchanged??comparison.unchanged?.length??0]].map(([label,value])=>fact(label,e(value))).join('')+
    '</dl><details><summary>Complete source comparison</summary><pre>'+e(JSON.stringify(comparison,null,2))+'</pre></details></section>':'';
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>'+e(title)+'</title>'+
    '<style>:root{color-scheme:light}*{box-sizing:border-box}body{font:15px/1.55 Arial,system-ui,sans-serif;color:#222;background:#fff;max-width:1120px;margin:32px auto;padding:0 24px}h1,h2,h3{line-height:1.25}h1{font-size:28px}h2{font-size:21px;margin-top:32px}h3{font-size:18px}h4{font-size:15px;margin:24px 0 10px}a{color:inherit;overflow-wrap:anywhere}p{margin:10px 0}section{margin:24px 0}.company,.capture{border:1px solid #ccc;padding:20px;margin:16px 0;break-inside:avoid}.facts{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:10px 20px;margin:16px 0}.facts>div{background:#f6f6f6;padding:10px;overflow-wrap:anywhere}dt{font-size:12px;font-weight:700;color:#555;margin-bottom:4px}dd{margin:0}.muted,.hint{color:#555;font-size:13px}.research-note{white-space:pre-wrap;overflow-wrap:anywhere}.research-note strong,details strong{display:block}details{margin:16px 0}summary{font-size:13px;font-weight:700;cursor:pointer}details p{overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f6f6f6;padding:14px;font:12px/1.5 ui-monospace,monospace;max-height:480px;overflow:auto}code{overflow-wrap:anywhere}.source-pages{padding-left:20px}.source-pages li{margin:8px 0}footer{border-top:1px solid #ccc;margin-top:32px;padding-top:16px;font-size:13px}@media(max-width:640px){body{margin:20px auto;padding:0 14px}h1{font-size:23px}.company,.capture{padding:14px}.facts{grid-template-columns:minmax(0,1fr);gap:8px}}@media print{body{font-size:11pt;max-width:none;margin:0;padding:0}.company,.capture{padding:12px}pre{max-height:none;overflow:visible}.facts{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}}</style>'+
    '<header><h1>'+e(title)+'</h1><p class="muted">Prepared '+sourceDate(createdAt,{time:true})+'. Source: <a href="'+SOURCE.api+'">GLEIF LEI reference data</a>.</p></header>'+
    '<section><h2>Selected source editions</h2>'+captures.map(c=>'<article class="capture"><h3>'+e(c.plan.query)+'</h3><dl class="facts">'+
      fact('Search',e(c.plan.kind==='lei'?'Exact LEI lookup':'Legal name search'))+fact('Source status',e(sourceWords(c.state)))+
      fact('Original response observed',sourceObservation(c))+fact('Retained pages',e(c.pages.length))+'</dl>'+
      '<details><summary>Source edition references</summary><p><strong>Edition ID</strong><code>'+e(c.id)+'</code></p><p><strong>Saved in this project</strong>'+sourceDate(c.createdAt,{time:true})+'</p><ol class="source-pages">'+
      c.pages.map((page,index)=>'<li><strong>Page '+e(index+1)+'</strong> · '+sourceDate(page.observedAt,{time:true})+'<br>'+e(page.url??'')+'</li>').join('')+'</ol></details></article>').join('')+
    '<p class="muted">Entity status and LEI registration status describe separate source fields. Each research decision belongs to its selected original record. Source comparisons retain the complete records and the scope of their original searches.</p></section>'+
    comparisonHtml+'<section><h2>Company research</h2>'+records.map(item=>{
      const r=item.row,review=bySource.get(r.captureId+'/'+r.lei),capture=editions.get(r.captureId);
      return '<article class="company"><h3>'+e(r.legalName)+'</h3><p class="muted">Source: '+e(capture?.plan.query??'GLEIF company record')+' · '+sourceDate(r.sourceObservedAt,{time:true})+'</p><dl class="facts">'+
        Object.entries(COMPANY_FACT_LABELS).map(([key,label])=>fact(label,sourceFact(key,r[key]))).join('')+'</dl>'+
        researchDecision(review)+sourceReferenceDetails(r)+
        '<details><summary>Complete original resource and source reference</summary><p><strong>Source edition ID</strong><code>'+e(r.captureId)+'</code></p><p><strong>Original source page</strong>'+e(r.sourcePage)+'</p><pre>'+e(JSON.stringify(item.resource,null,2))+'</pre></details></article>';
    }).join('')+'</section><footer>Reference data: <a href="'+SOURCE.terms+'">GLEIF LEI Data Terms of Use</a>. Original responses and full source observations accompany this report.</footer></html>';
}
