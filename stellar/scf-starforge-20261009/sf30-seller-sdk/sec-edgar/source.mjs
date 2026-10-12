// MIT. Exact SEC source capture, immutable editions and snapshot-bound queries.
import {mkdir,open,link,unlink,readFile,readdir,lstat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Agent as HttpsAgent} from 'node:https';
import {createUpstreamHandler} from '../upstream-handler.mjs';
import {createSupplierQuotaRegistry} from '../supplier-quota/application.mjs';
import {SOURCE_ORIGIN,object,json,sha256,fail,cik,editionId,date,sourceUrl,validateEdgarQuery} from './config.mjs';

export const EDITION_SCHEMA='stellar-forge.sec-edgar-edition.v1';
export const RESULT_SCHEMA='stellar-forge.sec-edgar-result.v1';
const EXACT_NUMBER=Symbol('EDGAR numeric source');
const MAX_SOURCE_BYTES=33554432;
const clone=v=>structuredClone(v);
const optional=value=>value===undefined||value===''?null:value;
function sourceFailure(message){fail(message,422,'EDGAR_SOURCE_INVALID');}
function dateOrNull(value,label){
  if(value===undefined||value===null||value==='')return null;
  try{return date(value,label);}catch{sourceFailure('Invalid '+label+' in the original source.');}
}
function validateSourceUrl(kind,company,value){
  let url;try{url=new URL(value);}catch{sourceFailure('Use the original SEC source URL.');}
  if(url.origin!==SOURCE_ORIGIN||url.username||url.password||url.search||url.hash)sourceFailure('Use an original data.sec.gov source URL.');
  const current=sourceUrl(kind,company);
  const historic=kind==='filings'&&new RegExp('^/submissions/CIK'+company+'-submissions-[0-9]+[.]json$').test(url.pathname);
  if(url.href!==current&&!historic)sourceFailure('The source URL must match this company and data kind.');
  return {url:url.href,historic};
}
export function parseEdgarCapture(bytes,{kind,cik:company,sourceUrl:origin}){
  company=cik(company);
  if(!Buffer.isBuffer(bytes))bytes=Buffer.from(bytes);
  if(bytes.length===0||bytes.length>MAX_SOURCE_BYTES)sourceFailure('Use an SEC JSON capture from 1 byte to 32 MiB.');
  const {url,historic}=validateSourceUrl(kind,company,origin);
  let raw;
  try{
    raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes),(key,value,context)=>{
      if(key==='val'&&typeof value==='number'){
        if(!context?.source)throw new Error('JSON numeric source context requires a current Node runtime.');
        return {[EXACT_NUMBER]:context.source};
      }
      return value;
    });
  }catch(error){sourceFailure('The source must be UTF-8 JSON; use Node 24 to retain exact numeric values.');}
  if(!object(raw))sourceFailure('Expected an SEC JSON object.');
  if(raw.cik!==undefined&&cik(raw.cik)!==company)sourceFailure('The source CIK does not match the selected company.');
  const entityName=typeof (raw.entityName??raw.name)==='string'?(raw.entityName??raw.name):'CIK '+company;
  const rows=[],concepts=[],forms=new Set(),historyFiles=[];
  if(kind==='facts'){
    if(raw.cik===undefined||!object(raw.facts))sourceFailure('Expected the original companyfacts response.');
    for(const [taxonomy,tags] of Object.entries(raw.facts)){
      if(!object(tags))sourceFailure('Invalid taxonomy in companyfacts.');
      for(const [concept,entry] of Object.entries(tags)){
        if(!object(entry)||!object(entry.units))sourceFailure('Invalid concept in companyfacts.');
        const selected={taxonomy,concept,label:typeof entry.label==='string'?entry.label:concept,
          description:typeof entry.description==='string'?entry.description:'',units:[],count:0};
        for(const [unit,values] of Object.entries(entry.units)){
          if(!Array.isArray(values))sourceFailure('Expected an array for each reported unit.');
          selected.units.push(unit);
          for(let index=0;index<values.length;index++){
            const fact=values[index];
            if(!object(fact)||!Object.hasOwn(fact,'val'))sourceFailure('Invalid reported fact.');
            const numeric=object(fact.val)&&Object.hasOwn(fact.val,EXACT_NUMBER);
            if(!numeric&&!['string','boolean'].includes(typeof fact.val))sourceFailure('Expected an original scalar fact value.');
            const row={cik:company,entityName,taxonomy,concept,label:selected.label,unit,
              value:numeric?fact.val[EXACT_NUMBER]:fact.val,valueType:numeric?'number':typeof fact.val,
              start:dateOrNull(fact.start,'period start'),end:dateOrNull(fact.end,'period end'),
              accession:optional(fact.accn),filed:dateOrNull(fact.filed,'filing date'),
              form:optional(fact.form),fy:optional(fact.fy),fp:optional(fact.fp),frame:optional(fact.frame),
              sourceIndex:rows.length,unitIndex:index};
            if(row.form!==null&&typeof row.form!=='string')sourceFailure('Invalid original filing form.');
            if(row.accession!==null&&typeof row.accession!=='string')sourceFailure('Invalid original accession.');
            if(row.fy!==null&&!Number.isSafeInteger(row.fy))sourceFailure('Invalid original fiscal year.');
            if(row.fp!==null&&typeof row.fp!=='string')sourceFailure('Invalid original fiscal period.');
            if(row.form)forms.add(row.form);
            rows.push(Object.freeze(row));selected.count++;
          }
        }
        concepts.push(selected);
      }
    }
  }else if(kind==='filings'){
    const columns=historic?raw:raw.filings?.recent;
    if(!object(columns)||!Array.isArray(columns.accessionNumber))sourceFailure('Expected the original submissions columns.');
    const count=columns.accessionNumber.length;
    for(const key of ['filingDate','form','primaryDocument']){
      if(!Array.isArray(columns[key])||columns[key].length!==count)sourceFailure('The submissions columns have inconsistent lengths.');
    }
    for(const [key,value] of Object.entries(columns)){
      if(!Array.isArray(value)||value.length!==count)sourceFailure('The '+key+' submissions column has changed shape.');
    }
    for(let index=0;index<count;index++){
      const accession=columns.accessionNumber[index];
      if(typeof accession!=='string'||!/^\d{10}-\d{2}-\d{6}$/.test(accession))sourceFailure('Invalid original accession number.');
      const primaryDocument=columns.primaryDocument[index];
      if(typeof primaryDocument!=='string'||/[\\?#\x00-\x1f]/.test(primaryDocument)||
        (primaryDocument!==''&&primaryDocument.split('/').some(part=>part===''||part==='.'||part==='..')))
        sourceFailure('Invalid primary document name.');
      const row={cik:company,entityName,accession,filed:dateOrNull(columns.filingDate[index],'filing date'),
        form:columns.form[index],reportDate:dateOrNull(columns.reportDate?.[index],'report date'),
        acceptanceDateTime:optional(columns.acceptanceDateTime?.[index]),primaryDocument,
        primaryDocDescription:optional(columns.primaryDocDescription?.[index]),
        size:optional(columns.size?.[index]),isXBRL:optional(columns.isXBRL?.[index]),
        isInlineXBRL:optional(columns.isInlineXBRL?.[index]),isXBRLNumeric:optional(columns.isXBRLNumeric?.[index]),
        coreType:optional(columns.core_type?.[index]),items:optional(columns.items?.[index]),
        act:optional(columns.act?.[index]),fileNumber:optional(columns.fileNumber?.[index]),
        filmNumber:optional(columns.filmNumber?.[index]),
        documentUrl:primaryDocument?'https://www.sec.gov/Archives/edgar/data/'+BigInt(company).toString()+'/'+accession.replaceAll('-','')+'/'+primaryDocument.split('/').map(encodeURIComponent).join('/'):null,
        sourceIndex:index};
      if(typeof row.form!=='string')sourceFailure('Invalid original filing form.');
      if(row.form)forms.add(row.form);
      rows.push(Object.freeze(row));
    }
    if(!historic){
      if(raw.cik===undefined)sourceFailure('The current submissions source must identify its company.');
      if(raw.filings.files!==undefined&&!Array.isArray(raw.filings.files))sourceFailure('Invalid historical submissions list.');
      for(const file of raw.filings.files??[]){
        if(!object(file)||typeof file.name!=='string')sourceFailure('Invalid historical submissions file.');
        const historyUrl=SOURCE_ORIGIN+'/submissions/'+file.name;
        validateSourceUrl('filings',company,historyUrl);
        historyFiles.push({name:file.name,url:historyUrl,filingCount:optional(file.filingCount),
          filingFrom:dateOrNull(file.filingFrom,'history filing start'),filingTo:dateOrNull(file.filingTo,'history filing end')});
      }
    }
  }else sourceFailure('Choose facts or filings.');
  return {kind,cik:company,entityName,sourceUrl:url,sourceSha256:sha256(bytes),sourceBytes:bytes.length,
    recordCount:rows.length,scope:kind==='facts'?'companyfacts':historic?'submissions-history':'submissions-recent',
    historyFiles,concepts,forms:[...forms].sort(),rows:Object.freeze(rows)};
}
async function regular(path,max=MAX_SOURCE_BYTES){
  const stat=await lstat(path);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>max)fail('Invalid retained source file.',409,'EDGAR_STORE_INVALID');
  return readFile(path);
}
async function atomicExact(path,bytes){
  const temp=path+'.'+randomUUID()+'.tmp';let handle;
  try{
    handle=await open(temp,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
    try{await link(temp,path);}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const old=await regular(path,Math.max(MAX_SOURCE_BYTES,bytes.length));
      if(!old.equals(bytes))fail('An existing immutable record has different bytes.',409,'EDGAR_IMMUTABLE_CONFLICT');
    }
    const dir=await open(resolve(path,'..'),'r');try{await dir.sync();}finally{await dir.close();}
  }finally{await handle?.close();await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
function stable(value){
  if(Array.isArray(value))return '['+value.map(stable).join(',')+']';
  if(object(value))return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stable(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
function decodeCursor(value,digest,total){
  if(!value)return 0;
  try{
    if(!/^[A-Za-z0-9_-]+$/.test(value))throw 0;
    const bytes=Buffer.from(value,'base64url');
    if(bytes.toString('base64url')!==value)throw 0;
    const c=JSON.parse(bytes.toString('utf8'));
    if(!object(c)||Object.keys(c).sort().join(',')!=='d,o,v'||c.v!==1||c.d!==digest||!Number.isSafeInteger(c.o)||c.o<0||c.o>total)throw 0;
    return c.o;
  }catch{fail('This cursor belongs to a different edition, product selection or query.',409,'EDGAR_CURSOR_MISMATCH');}
}
export async function openEdgarStore(directory){
  const root=resolve(directory);await mkdir(root,{recursive:true,mode:0o700});
  if((await lstat(root)).isSymbolicLink())fail('Use a real private edition directory.');
  for(const name of ['editions','blobs']){
    const p=join(root,name);await mkdir(p,{recursive:true,mode:0o700});
    const stat=await lstat(p);if(!stat.isDirectory()||stat.isSymbolicLink())fail('Invalid edition store directory.',409,'EDGAR_STORE_INVALID');
  }
  let closed=false;const cache=new Map();
  const active=()=>{if(closed)fail('The edition store is closed.',503,'EDGAR_STORE_CLOSED');};
  const recordPath=id=>join(root,'editions',editionId(id)+'.json');
  const blobPath=sha=>{if(!/^[a-f0-9]{64}$/.test(sha??''))fail('Invalid source digest.',409,'EDGAR_STORE_INVALID');return join(root,'blobs',sha+'.json');};
  async function readRecord(id){
    active();let record;
    try{record=JSON.parse((await regular(recordPath(id),1048576)).toString('utf8'));}
    catch(error){if(error.code==='ENOENT')fail('Choose an imported edition.',404,'EDGAR_EDITION_NOT_FOUND');throw error;}
    if(!object(record)||record.schema!==EDITION_SCHEMA||record.id!==id)fail('Invalid edition record.',409,'EDGAR_STORE_INVALID');
    return record;
  }
  async function original(record){
    active();
    const path=blobPath(record.sourceSha256),stat=await lstat(path);
    const key=[stat.ino,stat.size,stat.mtimeMs,stat.ctimeMs].join(':');
    const prior=cache.get(record.sourceSha256);
    if(prior?.key===key&&prior.value.parsed.kind===record.kind&&prior.value.parsed.cik===record.cik&&
      prior.value.parsed.sourceUrl===record.sourceUrl&&prior.value.parsed.recordCount===record.recordCount)return prior.value;
    const bytes=await regular(path);
    if(bytes.length!==record.sourceBytes||sha256(bytes)!==record.sourceSha256)fail('The retained source has changed.',409,'EDGAR_SOURCE_CHANGED');
    const parsed=parseEdgarCapture(bytes,record);
    if(parsed.recordCount!==record.recordCount||parsed.kind!==record.kind||parsed.cik!==record.cik)fail('The edition no longer matches its source.',409,'EDGAR_SOURCE_CHANGED');
    const value={bytes,parsed};cache.set(record.sourceSha256,{key,value});return value;
  }
  async function getEdition(id,{includeRows=false}={}){
    const record=await readRecord(id),{parsed}=await original(record);
    return {record:clone(record),concepts:clone(parsed.concepts),forms:[...parsed.forms],...(includeRows?{rows:parsed.rows}:{})};
  }
  async function importCapture({id,kind,cik:company,sourceUrl:origin,capturedAt,bytes}){
    active();editionId(id);company=cik(company);
    bytes=Buffer.isBuffer(bytes)?bytes:Buffer.from(bytes);
    const parsed=parseEdgarCapture(bytes,{kind,cik:company,sourceUrl:origin});
    if(capturedAt!==undefined&&(typeof capturedAt!=='string'||capturedAt.length>64||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(capturedAt)||
      !Number.isFinite(Date.parse(capturedAt))))fail('Use the capture’s original timestamp.');
    try{
      const old=await readRecord(id);
      if(old.kind!==kind||old.cik!==company||old.sourceSha256!==parsed.sourceSha256||old.sourceUrl!==parsed.sourceUrl||
        (capturedAt!==undefined&&old.capturedAt!==capturedAt))fail('This edition ID already identifies different source.',409,'EDGAR_EDITION_CONFLICT');
      const result=await getEdition(id);return {...result,recovered:true};
    }catch(error){if(error.code!=='EDGAR_EDITION_NOT_FOUND')throw error;}
    const {rows,concepts,forms,...summary}=parsed;
    const record={schema:EDITION_SCHEMA,id,...summary,capturedAt:capturedAt??new Date().toISOString()};
    await atomicExact(blobPath(record.sourceSha256),bytes);
    try{await atomicExact(recordPath(id),Buffer.from(json(record)));}
    catch(error){
      if(error.code!=='EDGAR_IMMUTABLE_CONFLICT')throw error;
      const existing=await readRecord(id);
      if(existing.kind!==kind||existing.cik!==company||existing.sourceSha256!==parsed.sourceSha256||existing.sourceUrl!==parsed.sourceUrl||
        (capturedAt!==undefined&&existing.capturedAt!==capturedAt))fail('This edition ID already identifies different source.',409,'EDGAR_EDITION_CONFLICT');
      return {...await getEdition(id),recovered:true};
    }
    return {...await getEdition(id),recovered:false};
  }
  async function listEditions(){
    active();const names=(await readdir(join(root,'editions'))).filter(name=>/^[A-Za-z0-9][A-Za-z0-9_-]{0,95}\.json$/.test(name)).sort();
    return Promise.all(names.map(name=>readRecord(name.slice(0,-5))));
  }
  async function query(id,product,input={}){
    active();const q=validateEdgarQuery(product,input),edition=await getEdition(id,{includeRows:true}),record=edition.record;
    if(id!==product.editionId||record.sourceSha256!==product.sourceSha256||record.kind!==product.kind||record.cik!==cik(product.cik))
      fail('The product must select this exact edition and source digest.',409,'EDGAR_EDITION_MISMATCH');
    const available=new Set(edition.concepts.map(c=>c.taxonomy+':'+c.concept));
    if(product.kind==='facts'&&product.concepts.some(key=>!available.has(key)))fail('A configured concept is absent from this edition.',409,'EDGAR_CONCEPT_MISSING');
    const allowedConcepts=new Set(product.concepts),allowedForms=new Set(product.forms??[]);
    const selection=Object.fromEntries(Object.entries(q).filter(([k])=>!['cursor','limit'].includes(k)));
    const digest=sha256(stable({edition:id,source:record.sourceSha256,product:product.id,kind:product.kind,
      concepts:product.concepts,forms:product.forms??[],selection}));
    const matched=edition.rows.filter(row=>{
      if(product.kind==='facts'&&!allowedConcepts.has(row.taxonomy+':'+row.concept))return false;
      if(allowedForms.size&&!allowedForms.has(row.form))return false;
      for(const key of ['taxonomy','concept','unit','form','accession'])if(q[key]!==undefined&&row[key]!==q[key])return false;
      for(const [from,to,field] of [['filedFrom','filedTo','filed'],['periodFrom','periodTo','end']]){
        if((q[from]||q[to])&&(!row[field]||(q[from]&&row[field]<q[from])||(q[to]&&row[field]>q[to])))return false;
      }
      return true;
    });
    const offset=decodeCursor(q.cursor,digest,matched.length),rows=clone(matched.slice(offset,offset+q.limit)),end=offset+rows.length;
    const nextCursor=end<matched.length?Buffer.from(JSON.stringify({v:1,d:digest,o:end})).toString('base64url'):null;
    const body={schema:RESULT_SCHEMA,edition:record,selection,rows,totalReturned:rows.length,totalMatched:matched.length,nextCursor};
    return {status:200,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store',
      'x-data-provider':'SEC EDGAR','x-edgar-edition':id,'x-edgar-source-sha256':record.sourceSha256},
      body,source:{editionId:id,sourceUrl:record.sourceUrl,sourceSha256:record.sourceSha256,capturedAt:record.capturedAt}};
  }
  return {root,listEditions,importCapture,getEdition,query,async readRaw(id){const record=await readRecord(id);return Buffer.from((await original(record)).bytes);},
    async close(){closed=true;cache.clear();}};
}
export async function acquireEdgarCapture({store,id,kind,cik:company,userAgent,quotaDirectory,
  historyFile,timeoutMs=30000,requestsPerSecond=2,callsPerDay=1000,signal,env=process.env}){
  editionId(id);company=cik(company);
  const origin=historyFile?SOURCE_ORIGIN+'/submissions/'+historyFile:sourceUrl(kind,company);
  validateSourceUrl(kind,company,origin);
  try{
    const existing=await store.getEdition(id);
    if(existing.record.kind!==kind||existing.record.cik!==company||existing.record.sourceUrl!==origin)
      fail('This edition ID already identifies another source.',409,'EDGAR_EDITION_CONFLICT');
    return {...existing,recovered:true};
  }catch(error){if(error.code!=='EDGAR_EDITION_NOT_FOUND')throw error;}
  if(typeof userAgent!=='string'||userAgent.length>512||/[\r\n\x00]/.test(userAgent)||
    !/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/.test(userAgent))fail('Configure SEC_EDGAR_USER_AGENT with your organization and contact email.');
  if(!Number.isInteger(requestsPerSecond)||requestsPerSecond<1||requestsPerSecond>10)fail('Use 1–10 SEC source requests per second.');
  if(!Number.isInteger(callsPerDay)||callsPerDay<1||callsPerDay>1000000)fail('Use a positive daily source-call allowance.');
  if(!Number.isInteger(timeoutMs)||timeoutMs<1000||timeoutMs>120000)fail('Use a source timeout from 1,000 to 120,000 ms.');
  if(!quotaDirectory)fail('Use the original shared SEC supplier quota directory.');
  const quotas=createSupplierQuotaRegistry({supplierAccounts:{sec:{directory:resolve(quotaDirectory),account:'sec-edgar',
    requestsPerSecond,callsPerDay}},bindings:{edgar:{supplierAccount:'sec'}}});
  const control=quotas.controller('sec'),agent=new HttpsAgent({keepAlive:false,proxyEnv:env});
  try{
    signal?.throwIfAborted();
    const admitted=await control.reserve({signal});
    if(admitted!==true)throw Object.assign(new Error('SEC source allowance is unavailable.'),{
      status:admitted.status,code:admitted.body.error,retryAfter:admitted.headers['retry-after']});
    const handler=createUpstreamHandler({baseUrl:SOURCE_ORIGIN,path:new URL(origin).pathname,method:'GET',
      headers:()=>({'user-agent':userAgent,accept:'application/json'}),query:[],agent,
      responseType:'json',timeoutMs,maxResponseBytes:16*1048576,
      responseHeaders:['content-type','retry-after'],maxInFlight:1});
    const response=await handler({method:'GET',url:new URL(origin),query:{},pathParams:{},headers:{},body:null,signal});
    await control.observe(response);
    if(response.status!==200||!Buffer.isBuffer(response.body))throw Object.assign(new Error('The SEC source request did not return a complete JSON capture.'),{
      status:response.status===429?429:502,code:'EDGAR_SOURCE_UNAVAILABLE',upstreamStatus:response.body?.upstreamStatus??response.status,
      retryAfter:response.headers?.['retry-after']});
    return await store.importCapture({id,kind,cik:company,sourceUrl:origin,capturedAt:new Date().toISOString(),bytes:response.body});
  }finally{agent.destroy();await quotas.close();}
}

