// MIT. Retained Crossref records for the original SF88 research dossier.
import {createHash} from 'node:crypto';
export const ORIGIN='https://api.crossref.org';
export const EDITION_SCHEMA='sf88-research-results-v1';
export const CAPTURE_SCHEMA='stellar-forge.crossref-capture.v1';
export const SOURCE_TERMS='Crossref metadata from https://api.crossref.org. Crossref permits metadata reuse; individual abstracts may retain copyright. Source terms: https://www.crossref.org/documentation/retrieve-metadata/rest-api/.';
export const DOCUMENTATION='https://www.crossref.org/documentation/retrieve-metadata/rest-api/';
export const CURSOR_DOCUMENTATION='https://community.crossref.org/t/changes-to-cursors-filtering-and-sorting-in-the-rest-api/16246';
export const RATE_DOCUMENTATION='https://community.crossref.org/t/refining-rest-api-limits-for-improved-stability-and-reliability/16137';
export const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const sha256=v=>createHash('sha256').update(v).digest('hex');
export const json=v=>JSON.stringify(v,null,2)+'\n';
export function fail(code,status=400,message=code){throw Object.assign(new Error(message),{code,status});}
export function need(value,code,status=400){if(!value)fail(code,status);}
export function normalizeDoi(input){
  need(typeof input==='string'&&input.length<=2048,'CROSSREF_DOI_REQUIRED');
  let value=input.trim().replace(/^doi:\s*/i,'');
  if(/^https?:\/\/(?:dx\.)?doi\.org\//i.test(value)){
    value=value.replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'');
    try{value=decodeURIComponent(value);}catch{fail('CROSSREF_DOI_ENCODING_INVALID');}
  }
  need(/^10\.\d{4,9}\/\S+$/i.test(value)&&!/[\\\u0000-\u0020\u007f]/.test(value),'CROSSREF_DOI_INVALID');
  return value.toLowerCase();
}
export function doiList(values){
  need(Array.isArray(values)&&values.length>0&&values.length<=10000,'CROSSREF_DOI_LIST_REQUIRED');
  return [...new Set(values.map(normalizeDoi))];
}
export function requestFor(kind,input={}){
  need(object(input)&&['work','updates'].includes(kind),'CROSSREF_REQUEST_INVALID');
  if(kind==='work'){
    need(Object.keys(input).every(k=>k==='doi'),'CROSSREF_REQUEST_FIELDS_INVALID');
    const doi=normalizeDoi(input.doi);
    return {kind,doi,pool:'single',url:ORIGIN+'/works/'+encodeURIComponent(doi)};
  }
  need(Object.keys(input).every(k=>['doi','dois','rows','cursor'].includes(k))&&!(input.doi&&input.dois),'CROSSREF_REQUEST_FIELDS_INVALID');
  const dois=doiList(input.dois??[input.doi]);
  // Commas delimit Crossref filter clauses. Singleton lookup retains these DOI identities.
  need(dois.length<=100&&dois.every(doi=>!doi.includes(',')),'CROSSREF_UPDATE_FILTER_DOI_INVALID');
  const rows=Number(input.rows??1000),cursor=input.cursor??'*';
  need(Number.isSafeInteger(rows)&&rows>=1&&rows<=1000,'CROSSREF_ROWS_INVALID');
  need(typeof cursor==='string'&&cursor.length>0&&cursor.length<=12000&&!/[\u0000-\u001f\u007f]/.test(cursor),'CROSSREF_CURSOR_INVALID');
  const url=new URL('/works',ORIGIN);
  url.searchParams.set('filter',dois.map(doi=>'updates:'+doi).join(','));
  url.searchParams.set('rows',String(rows));url.searchParams.set('cursor',cursor);
  need(Buffer.byteLength(url.href)<=16000,'CROSSREF_UPDATE_QUERY_TOO_LONG');
  return {kind,dois,rows,cursor,pool:'list',url:url.href};
}
const publicHeaders=new Set(['content-type','content-length','content-encoding','date','etag','last-modified','cache-control','expires','vary','retry-after','x-rate-limit-limit','x-rate-limit-interval','x-rate-limit-type','x-concurrency-limit','x-api-pool']);
export function retainedHeaders(headers={}){
  const result={};
  for(const [name,value] of Object.entries(headers)){
    const key=name.toLowerCase();
    if(publicHeaders.has(key)&&typeof value==='string'&&value.length<=8192&&!/[\r\n\0]/.test(value))result[key]=value;
  }
  return result;
}
export function parseCapture(capture,{validateResponse=true}={}){
  need(object(capture)&&object(capture.request),'CROSSREF_CAPTURE_REQUIRED');
  const req=requestFor(capture.request.kind,capture.request.kind==='work'?{doi:capture.request.doi}:
    {dois:capture.request.dois,rows:capture.request.rows,cursor:capture.request.cursor});
  need(capture.url===req.url&&(capture.finalUrl===undefined||capture.finalUrl===req.url),'CROSSREF_CAPTURE_SOURCE_MISMATCH');
  need(Number.isInteger(capture.status)&&capture.status>=100&&capture.status<=599,'CROSSREF_CAPTURE_STATUS_INVALID');
  need(typeof capture.retrievedAt==='string'&&Number.isFinite(Date.parse(capture.retrievedAt)),'CROSSREF_CAPTURE_TIME_INVALID');
  let bytes;
  if(capture.body instanceof Uint8Array)bytes=Buffer.from(capture.body);
  else if(typeof capture.bodyBase64==='string'){
    need(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(capture.bodyBase64),'CROSSREF_CAPTURE_ENCODING_INVALID');
    bytes=Buffer.from(capture.bodyBase64,'base64');
  }else fail('CROSSREF_CAPTURE_BYTES_REQUIRED');
  need(bytes.length<=16*1024*1024,'CROSSREF_RESPONSE_SIZE_LIMIT',413);
  const digest=sha256(bytes);
  if(capture.bodySha256!==undefined)need(capture.bodySha256===digest,'CROSSREF_CAPTURE_HASH_MISMATCH');
  if(capture.bodyBytes!==undefined)need(capture.bodyBytes===bytes.length,'CROSSREF_CAPTURE_LENGTH_MISMATCH');
  let value=null;
  try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{if(validateResponse&&capture.status===200)fail('CROSSREF_RESPONSE_JSON_INVALID',502);}
  const successful=capture.status===200;
  if(successful&&validateResponse){
    need(object(value)&&value.status==='ok'&&object(value.message),'CROSSREF_RESPONSE_CONTRACT_CHANGED',502);
    need(value['message-type']===(req.kind==='work'?'work':'work-list'),'CROSSREF_RESPONSE_TYPE_CHANGED',502);
    if(req.kind==='work'){
      let returned;try{returned=normalizeDoi(value.message.DOI);}catch{fail('CROSSREF_RESPONSE_DOI_MISMATCH',502);}
      need(returned===req.doi,'CROSSREF_RESPONSE_DOI_MISMATCH',502);
    }
    else need(Array.isArray(value.message.items)&&Number.isSafeInteger(value.message['total-results'])&&value.message['total-results']>=0&&
      value.message.items.every(row=>{try{return object(row)&&Boolean(normalizeDoi(row.DOI));}catch{return false;}}),'CROSSREF_RESPONSE_LIST_INVALID',502);
  }
  const record={schema:CAPTURE_SCHEMA,request:req,url:req.url,finalUrl:capture.finalUrl??req.url,status:capture.status,
    ...(capture.startedAt?{startedAt:capture.startedAt}:{}),retrievedAt:capture.retrievedAt,
    headers:retainedHeaders(capture.headers),bodyBytes:bytes.length,bodySha256:digest,bodyBase64:bytes.toString('base64'),
    ...(capture.sourceId?{sourceId:String(capture.sourceId)}:{})};
  return {record,value,bytes,successful};
}
const list=v=>Array.isArray(v)?v:[];
const names=v=>list(v).map(a=>typeof a==='string'?a:[a?.given,a?.family].filter(Boolean).join(' ')||a?.name||'').filter(Boolean);
const text=v=>typeof v==='string'?v:'';
const count=v=>Number.isSafeInteger(v)&&v>=0?v:null;
export function publicationDates(work){
  const result={};
  for(const key of ['issued','published','published-online','published-print','created','deposited','indexed']){
    if(object(work[key]))result[key]=structuredClone(work[key]);
  }
  return result;
}
export function dateLabel(value){
  const parts=value?.['date-parts'];
  if(!Array.isArray(parts)||!Array.isArray(parts[0])||!parts[0].length)return text(value?.['date-time']);
  return parts.map(row=>row.map((v,i)=>i===0?String(v):String(v).padStart(2,'0')).join('-')).join('; ');
}
function sourceContent(work){
  const rows=[],title=list(work.title).join('; '),authorNames=names(work.author),dates=publicationDates(work);
  rows.push(title||normalizeDoi(work.DOI));
  if(authorNames.length)rows.push('Authors: '+authorNames.join('; '));
  if(work.publisher)rows.push('Publisher: '+work.publisher);
  if(list(work['container-title']).length)rows.push('Publication: '+work['container-title'].join('; '));
  for(const [kind,value] of Object.entries(dates))rows.push(kind+': '+dateLabel(value));
  if(work.type)rows.push('Work type: '+work.type);
  if(work.volume)rows.push('Volume: '+work.volume);
  if(work.issue)rows.push('Issue: '+work.issue);
  if(work.page)rows.push('Pages: '+work.page);
  if(work['article-number'])rows.push('Article number: '+work['article-number']);
  if(count(work['is-referenced-by-count'])!==null)rows.push('Crossref cited-by count: '+work['is-referenced-by-count']);
  if(count(work['reference-count'])!==null)rows.push('Deposited reference count: '+work['reference-count']);
  if(list(work.funder).length)rows.push('Funders:\n'+work.funder.map(f=>[f.name,f.DOI,list(f.award).length?'Awards: '+f.award.join('; '):''].filter(Boolean).join(' — ')).join('\n'));
  if(list(work.license).length)rows.push('Licenses:\n'+work.license.map(l=>[l.URL,l['content-version'],dateLabel(l.start)].filter(Boolean).join(' — ')).join('\n'));
  if(object(work.relation)&&Object.keys(work.relation).length)rows.push('Registered relations:\n'+json(work.relation).trim());
  if(list(work['update-to']).length)rows.push('Registered update relationships:\n'+json(work['update-to']).trim());
  return rows.join('\n\n');
}
function workResult(work,occurrences){
  const doi=normalizeDoi(work.DOI),dates=publicationDates(work);
  return {id:doi,doi,url:'https://doi.org/'+encodeURIComponent(doi),
    title:list(work.title).join('; ')||doi,authors:names(work.author),
    publishedAt:dateLabel(work.issued??work.published??work['published-online']??work['published-print']),
    content:sourceContent(work),citation:{doi,type:work.type??null,authors:structuredClone(work.author??[]),
      publisher:work.publisher??null,containerTitle:structuredClone(work['container-title']??[]),
      volume:work.volume??null,issue:work.issue??null,page:work.page??null,articleNumber:work['article-number']??null,dates},
    references:structuredClone(work.reference??[]),
    metadata:{crossref:structuredClone(work),sourceOccurrences:occurrences,dates,
      citationCount:count(work['is-referenced-by-count']),cited_by_count:count(work['is-referenced-by-count']),referenceCount:count(work['reference-count']),
      depositedReferences:list(work.reference).length}};
}
function acquisitionPlan(input,requestedDois,parsed){
  const inferred={schema:'stellar-forge.crossref-acquisition.v1',
    metadata:parsed.some(({record})=>record.request.kind==='work'),
    updates:parsed.some(({record})=>record.request.kind==='updates'),failures:[]};
  if(input===undefined)return inferred;
  need(object(input)&&Object.keys(input).every(key=>['schema','metadata','updates','failures'].includes(key))&&
    input.schema===inferred.schema&&typeof input.metadata==='boolean'&&typeof input.updates==='boolean'&&
    Array.isArray(input.failures)&&input.failures.length<=2001,'CROSSREF_ACQUISITION_PLAN_INVALID');
  need((input.metadata||!inferred.metadata)&&(input.updates||!inferred.updates),'CROSSREF_ACQUISITION_PLAN_CONFLICT');
  const failures=input.failures.map(failure=>{
    need(object(failure)&&['transport','pagination','capacity'].includes(failure.phase)&&
      typeof failure.code==='string'&&/^[A-Z][A-Z0-9_]{0,100}$/.test(failure.code)&&object(failure.request),
      'CROSSREF_ACQUISITION_FAILURE_INVALID');
    const value=failure.request,request=requestFor(value.kind,value.kind==='work'?{doi:value.doi}:
      {dois:value.dois??[value.doi],rows:value.rows,cursor:value.cursor});
    need((request.kind==='work'?input.metadata:input.updates)&&
      (request.kind==='work'?[request.doi]:request.dois).every(doi=>requestedDois.includes(doi)),
      'CROSSREF_ACQUISITION_FAILURE_SCOPE_INVALID');
    return {phase:failure.phase,code:failure.code,request};
  });
  return {schema:inferred.schema,metadata:input.metadata,updates:input.updates,failures};
}
export function buildCrossrefEdition({captures,dois,query,label='Crossref DOI metadata',acquisition}){
  const requestedDois=doiList(dois);
  need(typeof query==='string'&&query.trim().length>0&&query.length<=12000,'CROSSREF_RESEARCH_QUESTION_REQUIRED');
  need(typeof label==='string'&&label.trim().length>0&&label.length<=200,'CROSSREF_LABEL_INVALID');
  need(Array.isArray(captures)&&captures.length<=2000&&(captures.length>0||acquisition!==undefined),'CROSSREF_CAPTURES_REQUIRED');
  const parsed=captures.map(capture=>{
    try{return parseCapture(capture);}
    catch(error){
      if(!/^CROSSREF_RESPONSE_/.test(error.code??''))throw error;
      return {...parseCapture(capture,{validateResponse:false}),successful:false,contractError:error.code};
    }
  }),records=parsed.map(x=>x.record),plan=acquisitionPlan(acquisition,requestedDois,parsed);
  need(captures.length>0||plan.failures.length>0,'CROSSREF_ACQUISITION_EMPTY');
  const found=new Set(),works=new Map(),warnings=plan.failures.map(failure=>({code:'CROSSREF_ACQUISITION_FAILURE',phase:failure.phase,request:failure.request,error:failure.code})),updateCollections=new Map();
  for(const {record,value,successful,contractError} of parsed){
    const request=record.request;
    need((request.kind==='work'?[request.doi]:request.dois).every(doi=>requestedDois.includes(doi)),'CROSSREF_CAPTURE_OUTSIDE_SELECTED_DOIS');
    if(!successful){warnings.push({code:contractError??(record.status===404?'CROSSREF_WORK_NOT_FOUND':'CROSSREF_PROVIDER_RESPONSE'),request,status:record.status});continue;}
    const items=request.kind==='work'?[value.message]:value.message.items;
    if(request.kind==='work')found.add(request.doi);
    if(request.kind==='updates'){
      const key=JSON.stringify([...request.dois].sort());
      if(!updateCollections.has(key))updateCollections.set(key,[]);
      updateCollections.get(key).push({record,message:value.message});
    }
    for(const work of items){
      const doi=normalizeDoi(work.DOI),occurrence={captureSha256:record.bodySha256,sourceUrl:record.url,
        retrievedAt:record.retrievedAt,role:request.kind==='work'?'metadata':'registered-update',
        requestedDois:request.kind==='work'?[request.doi]:request.dois};
      const prior=works.get(doi);
      if(prior){prior.occurrences.push(occurrence);prior.work=work;}
      else works.set(doi,{work,occurrences:[occurrence]});
    }
  }
  const updates=[],updateCovered=new Set();
  for(const pages of updateCollections.values()){
    const first=pages[0],initialTotal=first.message['total-results'],fromBeginning=first.record.request.cursor==='*';
    let expected=first.record.request.cursor,finished=false,received=0,nextCursor=null,duplicates=0;
    const seenCursors=new Set(),seenDois=new Set(),issues=new Set(),reportedTotals=new Set();
    for(const {record,message} of pages){
      const request=record.request;
      if(finished)issues.add('CROSSREF_UPDATE_AFTER_FINAL_PAGE');
      if(request.cursor!==expected||seenCursors.has(request.cursor))issues.add('CROSSREF_UPDATE_PAGE_CHAIN_INVALID');
      if(request.rows!==first.record.request.rows||JSON.stringify(request.dois)!==JSON.stringify(first.record.request.dois))
        issues.add('CROSSREF_UPDATE_REQUEST_CHANGED');
      seenCursors.add(request.cursor);reportedTotals.add(message['total-results']);
      received+=message.items.length;
      for(const item of message.items){const doi=normalizeDoi(item.DOI);if(seenDois.has(doi))duplicates++;else seenDois.add(doi);}
      finished=message.items.length<request.rows;
      nextCursor=null;
      if(!finished){
        const next=message['next-cursor'];
        if(typeof next!=='string'||!next)issues.add('CROSSREF_NEXT_CURSOR_MISSING');
        else if(next===request.cursor||seenCursors.has(next))issues.add('CROSSREF_CURSOR_NOT_ADVANCING');
        else nextCursor=next;
      }
      expected=nextCursor;
    }
    if(reportedTotals.size!==1)issues.add('CROSSREF_UPDATE_TOTAL_CHANGED');
    if(duplicates)issues.add('CROSSREF_UPDATE_DUPLICATE_RECORDS');
    if(finished&&(received!==initialTotal||seenDois.size!==initialTotal))issues.add('CROSSREF_UPDATE_COUNT_MISMATCH');
    const complete=fromBeginning&&finished&&issues.size===0;
    const result={dois:first.record.request.dois,status:complete?'COMPLETE':'PARTIAL',pages:pages.length,
      records:received,uniqueRecords:seenDois.size,duplicateRecords:duplicates,totalResults:initialTotal,
      lastTotalResults:pages.at(-1).message['total-results'],fromBeginning,finalPage:finished,nextCursor,
      issues:[...issues],retrievedAt:pages.at(-1).record.retrievedAt};
    updates.push(result);
    if(complete)for(const doi of result.dois)updateCovered.add(doi);
    else warnings.push({code:'CROSSREF_UPDATE_COLLECTION_PARTIAL',dois:result.dois,nextCursor,issues:result.issues});
  }
  const missingDois=plan.metadata?requestedDois.filter(doi=>!found.has(doi)):[];
  const missingUpdates=plan.updates?requestedDois.filter(doi=>!updateCovered.has(doi)):[];
  if(missingDois.length)warnings.push({code:'CROSSREF_METADATA_INCOMPLETE',dois:missingDois});
  if(missingUpdates.length)warnings.push({code:'CROSSREF_UPDATES_INCOMPLETE',dois:missingUpdates});
  const results=[...works].sort(([a],[b])=>a.localeCompare(b)).map(([,v])=>workResult(v.work,v.occurrences));
  const available=parsed.some(row=>row.successful);
  const coverage=warnings.length===0?'COMPLETE':available?'PARTIAL':'UNAVAILABLE';
  return {schema:EDITION_SCHEMA,provider:'crossref',query,label,sourceTerms:SOURCE_TERMS,
    success:available,status:coverage==='COMPLETE'?'AVAILABLE':coverage==='PARTIAL'?'PARTIAL':'PROVIDER_ERROR',results,
    usage:{schema:'stellar-forge.crossref-edition.v1',coverage,requestedDois,receivedDois:[...found].sort(),missingDois,missingUpdates,
      acquisition:plan,sourceResponses:records.map(({bodyBase64,...r})=>r),updates,
      metadataLookup:plan.metadata?'REQUESTED':'NOT_REQUESTED',updatesLookup:plan.updates?'REQUESTED':'NOT_REQUESTED',
      sourceRecordsReceived:results.length,sourcePages:records.length,sourceCoverage:coverage},
    warnings,originalResponses:records};
}
export function crossrefFieldChanges(before,after){
  const a=before?.metadata?.crossref??before??{},b=after?.metadata?.crossref??after??{};
  need(object(a)&&object(b),'CROSSREF_COMPARISON_RECORDS_REQUIRED');
  const keys=['title','author','type','publisher','container-title','volume','issue','page','article-number','issued','published',
    'published-online','published-print','created','deposited','indexed','license','funder','relation','update-to','reference',
    'reference-count','is-referenced-by-count'];
  return keys.filter(key=>JSON.stringify(a[key]??null)!==JSON.stringify(b[key]??null))
    .map(field=>({field,before:structuredClone(a[field]??null),after:structuredClone(b[field]??null)}));
}
