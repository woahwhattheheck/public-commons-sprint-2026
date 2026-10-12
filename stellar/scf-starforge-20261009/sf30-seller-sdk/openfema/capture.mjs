// MIT. OpenFEMA original-byte capture, complete scoped paging and durable recovery.
import {createHash, randomBytes} from 'node:crypto';
import {TextDecoder} from 'node:util';
import {stable} from '../stellar-expert/store.mjs';

export const DATASETS = Object.freeze({
  declarations:Object.freeze({entity:'DisasterDeclarationsSummaries',version:2,orderBy:'id',primaryKey:['disasterNumber','placeCode']}),
  applicants:Object.freeze({entity:'PublicAssistanceApplicants',version:1,orderBy:'id',primaryKey:[]}),
  projects:Object.freeze({entity:'PublicAssistanceFundedProjectsDetails',version:2,orderBy:'gmProjectId',primaryKey:['gmProjectId']}),
});
const API='https://www.fema.gov/api/open/';
const CAPTURE_SCHEMA='stellar-forge.openfema-capture.v1';
const EDITION_SCHEMA='stellar-forge.openfema-source-edition.v1';
const BUNDLE_SCHEMA='stellar-forge.openfema-source-bundle.v1';
const KINDS=Object.keys(DATASETS), MAX_PAGE_BYTES=64*1024*1024, MAX_METADATA_BYTES=8*1024*1024;
const SHA=/^[a-f0-9]{64}$/, CAPTURE_ID=/^[a-f0-9]{24}$/, activeStores=new WeakMap();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const stamp=()=>new Date().toISOString();
function fault(code,message,status=400,details={}) {return Object.assign(new Error(message),{code,status,...details});}
function plain(value) {return value!==null&&typeof value==='object'&&!Array.isArray(value);}
function copy(value) {return structuredClone(value);}
function integer(value,label,{min=0,max=Number.MAX_SAFE_INTEGER}={}) {
  if(typeof value!=='string'&&typeof value!=='number')throw fault('OPENFEMA_NUMBER',label+' must be an exact integer.');
  if(typeof value==='string'&&!/^\d+$/.test(value)) throw fault('OPENFEMA_NUMBER',label+' must be an exact nonnegative integer.');
  const n=Number(value);
  if(!Number.isSafeInteger(n)||n<min||n>max) throw fault('OPENFEMA_NUMBER',label+' is outside the supported integer range.');
  return n;
}
function exactDate(value,label) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value)||
     !Number.isFinite(Date.parse(value+'T00:00:00.000Z'))||
     new Date(value+'T00:00:00.000Z').toISOString().slice(0,10)!==value)
    throw fault('OPENFEMA_SCOPE',label+' must be a calendar date in YYYY-MM-DD format.');
  return value;
}
export function validateScope(input) {
  if(!plain(input)) throw fault('OPENFEMA_SCOPE','Choose a disaster, state or declaration-date cohort.');
  const allowed=['disasterNumbers','states','declarationDateFrom','declarationDateTo','pageSize'];
  if(Object.keys(input).some(k=>!allowed.includes(k))) throw fault('OPENFEMA_SCOPE','Use the named cohort fields; arbitrary URLs and OData are not accepted.');
  const scope={disasterNumbers:[],states:[],declarationDateFrom:null,declarationDateTo:null,pageSize:1000};
  if(input.disasterNumbers!==undefined) {
    if(!Array.isArray(input.disasterNumbers)||input.disasterNumbers.length>20000)
      throw fault('OPENFEMA_SCOPE','Disaster numbers must be an array of at most 20,000 exact identifiers.');
    scope.disasterNumbers=[...new Set(input.disasterNumbers.map(v=>integer(v,'Disaster number',{min:1,max:99999})))].sort((a,b)=>a-b);
  }
  if(input.states!==undefined) {
    if(!Array.isArray(input.states)||input.states.length>100) throw fault('OPENFEMA_SCOPE','States must be an array of two-letter source codes.');
    scope.states=[...new Set(input.states.map(v=>{
      if(typeof v!=='string'||!/^[A-Za-z]{2}$/.test(v)) throw fault('OPENFEMA_SCOPE','Use a two-letter state or territory code.');
      return v.toUpperCase();
    }))].sort();
  }
  for(const name of ['declarationDateFrom','declarationDateTo'])
    if(input[name]!=null&&input[name]!=='') scope[name]=exactDate(input[name],name);
  if(scope.declarationDateFrom&&scope.declarationDateTo&&scope.declarationDateFrom>scope.declarationDateTo)
    throw fault('OPENFEMA_SCOPE','The declaration-date start must precede its end.');
  if(input.pageSize!==undefined) scope.pageSize=integer(input.pageSize,'Page size',{min:1,max:10000});
  if(!scope.disasterNumbers.length&&!scope.states.length&&!scope.declarationDateFrom&&!scope.declarationDateTo)
    throw fault('OPENFEMA_SCOPE','Choose a cohort. A declaration-date start of 1953-05-01 selects the full declared history.');
  return scope;
}

// Numbers remain their original JSON lexemes, including big integers and decimals.
// String values, booleans and null retain their JSON types. Duplicate object keys
// are rejected so a source field cannot silently overwrite an earlier value.
export function parseOpenFemaJSON(input) {
  const text=typeof input==='string'?input:new TextDecoder('utf-8',{fatal:true}).decode(input);
  let at=text.charCodeAt(0)===0xfeff?1:0;
  const bad=()=>{throw fault('OPENFEMA_JSON','The original response is not unambiguous valid JSON at offset '+at+'.',502);};
  const ws=()=>{while(at<text.length&&(text[at]===' '||text[at]==='\r'||text[at]==='\n'||text[at]==='\t'))at++;};
  function string() {
    const start=at++;
    while(at<text.length) {
      const c=text[at++];
      if(c==='"') {try{return JSON.parse(text.slice(start,at));}catch{bad();}}
      if(c==='\\')at++;
      else if(c.charCodeAt(0)<32)bad();
    }
    bad();
  }
  function value(depth) {
    if(depth>64)throw fault('OPENFEMA_JSON_DEPTH','The original response exceeds 64 nested JSON levels.',502);
    ws();const c=text[at];
    if(c==='"')return string();
    if(c==='{') {
      at++;ws();const out={};if(text[at]==='}'){at++;return out;}
      while(at<text.length) {
        ws();if(text[at]!=='"')bad();const key=string();ws();if(text[at++]!==':')bad();
        if(Object.hasOwn(out,key))throw fault('OPENFEMA_DUPLICATE_FIELD','The original response repeats JSON field '+key+'.',502);
        Object.defineProperty(out,key,{value:value(depth+1),enumerable:true,writable:true,configurable:true});
        ws();const delim=text[at++];if(delim==='}')return out;if(delim!==',')bad();
      }bad();
    }
    if(c==='[') {
      at++;ws();const out=[];if(text[at]===']'){at++;return out;}
      while(at<text.length) {
        out.push(value(depth+1));ws();const delim=text[at++];if(delim===']')return out;if(delim!==',')bad();
      }bad();
    }
    for(const [token,result] of [['true',true],['false',false],['null',null]])
      if(text.startsWith(token,at)){at+=token.length;return result;}
    if(c==='-'||(c>='0'&&c<='9')) {
      const start=at;if(text[at]==='-')at++;
      if(text[at]==='0')at++;
      else {if(!(text[at]>='1'&&text[at]<='9'))bad();while(text[at]>='0'&&text[at]<='9')at++;}
      if(text[at]==='.') {at++;if(!(text[at]>='0'&&text[at]<='9'))bad();while(text[at]>='0'&&text[at]<='9')at++;}
      if(text[at]==='e'||text[at]==='E') {
        at++;if(text[at]==='+'||text[at]==='-')at++;
        if(!(text[at]>='0'&&text[at]<='9'))bad();while(text[at]>='0'&&text[at]<='9')at++;
      }
      return text.slice(start,at);
    }
    bad();
  }
  const result=value(0);ws();if(at!==text.length)bad();return result;
}
export const parseSourceJSON=parseOpenFemaJSON;
function entityRows(body,entity) {
  const alias={OpenFemaDataSets:'DataSets',OpenFemaDataSetFields:'DataSetFields'};
  const rows=body?.[entity]??body?.[alias[entity]];
  if(!plain(body)||!Array.isArray(rows)||rows.some(r=>!plain(r)))
    throw fault('OPENFEMA_RESPONSE','The original response does not contain '+entity+' records.',502);
  return rows;
}
function query(entity,version,parameters) {
  const url=new URL(API+'v'+version+'/'+entity);
  for(const [key,value] of Object.entries(parameters)) if(value!==null&&value!==undefined&&value!=='')url.searchParams.set(key,String(value));
  return url.href;
}
function metaUrl(kind) {const {entity,version}=DATASETS[kind];return query('OpenFemaDataSets',1,{'$filter':"name eq '"+entity+"' and version eq "+version,'$top':1000,'$count':'true'});}
function fieldsUrl(kind) {const {entity,version}=DATASETS[kind];return query('OpenFemaDataSetFields',1,{'$filter':"openFemaDataSet eq '"+entity+"' and datasetVersion eq "+version,'$top':1000,'$orderby':'sortOrder','$count':'true'});}
function grouped(values,field,strings=false) {
  return '('+values.map(v=>field+' eq '+(strings?"'"+v+"'":v)).join(' or ')+')';
}
function split(values,n=40) {const out=[];for(let i=0;i<values.length;i+=n)out.push(values.slice(i,i+n));return out;}
function declarationFilters(scope) {
  const rest=[];
  if(scope.states.length)rest.push(grouped(scope.states,'state',true));
  if(scope.declarationDateFrom)rest.push("declarationDate ge '"+scope.declarationDateFrom+"T00:00:00.000Z'");
  if(scope.declarationDateTo)rest.push("declarationDate le '"+scope.declarationDateTo+"T23:59:59.999Z'");
  return scope.disasterNumbers.length?split(scope.disasterNumbers).map(ids=>[grouped(ids,'disasterNumber'),...rest].join(' and ')):[rest.join(' and ')];
}
function linkedFilters(numbers) {return split(numbers).map(ids=>grouped(ids,'disasterNumber'));}
function pageUrl(kind,filter,skip,pageSize) {const d=DATASETS[kind];return query(d.entity,d.version,{'$filter':filter,'$orderby':d.orderBy,'$top':pageSize,'$skip':skip,'$count':skip===0?'true':'false'});}
function freshDataset(kind,generation=0) {
  const d=DATASETS[kind];return {entity:d.entity,version:d.version,orderBy:d.orderBy,generation,state:'PENDING',
    metadataReceipt:null,metadataEndReceipt:null,fieldsReceipt:null,metadataSnapshot:null,
    filterBatches:[],pages:[],rowCount:0,sourceCount:0};
}
function refreshToken(meta) {
  return stable({entity:meta.name,version:meta.version,lastDataSetRefresh:meta.lastDataSetRefresh??null,recordCount:meta.recordCount??null});
}
function metadataRecord(body,kind) {
  const d=DATASETS[kind],records=entityRows(body,'OpenFemaDataSets');
  if(records.length!==1||records[0].name!==d.entity||integer(records[0].version,'Dataset version')!==d.version)
    throw fault('OPENFEMA_METADATA','The source metadata does not uniquely identify '+d.entity+' v'+d.version+'.',502);
  const m=records[0];
  if(typeof m.lastDataSetRefresh!=='string'||!Number.isFinite(Date.parse(m.lastDataSetRefresh)))
    throw fault('OPENFEMA_METADATA','The dataset must expose its original refresh timestamp for complete pagination.',502);
  if(m.depDate&&Date.parse(m.depDate)<=Date.now())
    throw fault('OPENFEMA_DATASET_DEPRECATED',d.entity+' v'+d.version+' is deprecated. Update its maintained source contract before capturing.',409);
  if(m.webService) {
    const url=new URL(m.webService);
    if(url.origin!=='https://www.fema.gov'||url.pathname!=='/api/open/v'+d.version+'/'+d.entity)
      throw fault('OPENFEMA_METADATA','The dataset metadata points to a different source API.',502);
  }
  integer(m.recordCount,'Dataset source count');return m;
}
function validateFields(body,kind) {
  const d=DATASETS[kind],fields=entityRows(body,'OpenFemaDataSetFields');
  if(!fields.length||fields.length>=1000||fields.some(f=>f.openFemaDataSet!==d.entity||integer(f.datasetVersion,'Field version')!==d.version))
    throw fault('OPENFEMA_FIELDS','The source field dictionary is missing, incomplete or from another dataset.',502);
  const names=new Set(fields.map(f=>f.name));
  for(const key of ['disasterNumber',d.orderBy,...(kind==='declarations'?['state','declarationDate']:kind==='projects'?['applicantId']:['applicantId'])])
    if(!names.has(key))throw fault('OPENFEMA_FIELDS_CHANGED','The current source dictionary lacks required field '+key+'.',409);
  return fields;
}
function safeHeaders(headers) {
  const out={};
  for(const name of ['content-type','content-length','etag','last-modified','date','retry-after','cache-control','content-encoding'])
    {const value=headers?.get?.(name)??headers?.[name];if(value!=null)out[name]=String(value);}
  return out;
}
function boundPageMetadata(body,{skip,pageSize,firstCount}) {
  if(!plain(body.metadata))throw fault('OPENFEMA_PAGE_METADATA','A source page must retain API query metadata.',502);
  const meta=body.metadata;
  if(meta.skip!=null&&integer(meta.skip,'Returned page skip')!==skip)
    throw fault('OPENFEMA_PAGE_METADATA','The response skip differs from the requested page.',502);
  if(meta.top!=null&&integer(meta.top,'Returned page limit',{min:1,max:10000})>pageSize)
    throw fault('OPENFEMA_PAGE_METADATA','The source returned a larger page than requested.',502);
  const count=integer(meta.count,'Scoped source count');
  if(skip===0)return count;
  if(count!==0&&firstCount!==null&&count!==firstCount)
    throw fault('OPENFEMA_SOURCE_CHANGED','The scoped source count changed during paging.',409);
  return firstCount;
}
function matchesDeclaration(row,scope) {
  const number=integer(row.disasterNumber,'Declaration disaster number',{min:1,max:99999});
  if(scope.disasterNumbers.length&&!scope.disasterNumbers.includes(number))return false;
  if(scope.states.length&&!scope.states.includes(row.state))return false;
  if(scope.declarationDateFrom||scope.declarationDateTo) {
    const date=String(row.declarationDate??'').slice(0,10);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
    if(scope.declarationDateFrom&&date<scope.declarationDateFrom||scope.declarationDateTo&&date>scope.declarationDateTo)return false;
  }
  return true;
}
function compareKey(a,b,kind) {
  if(kind==='projects') {
    if(!/^-?\d+$/.test(a)||!/^-?\d+$/.test(b))throw fault('OPENFEMA_SOURCE_KEY','The project source key must be an exact integer.',502);
    return BigInt(a)<BigInt(b)?-1:BigInt(a)>BigInt(b)?1:0;
  }
  return a<b?-1:a>b?1:0;
}
function sourceIdentity(edition) {
  return hash(Buffer.from(stable({scope:edition.scope,disasterNumbers:edition.disasterNumbers,
    datasets:Object.fromEntries(KINDS.map(kind=>{const d=edition.datasets[kind];return [kind,{entity:d.entity,version:d.version,
      metadataSha256:d.metadataReceipt.sha256,metadataEndSha256:d.metadataEndReceipt.sha256,fieldsSha256:d.fieldsReceipt.sha256,
      pages:d.pages.map(p=>({sha256:p.sha256,bytes:p.bytes,url:p.url,skip:p.skip,count:p.count})),rowCount:d.rowCount,sourceCount:d.sourceCount,
      filterBatches:d.filterBatches.map(b=>({filter:b.filter,sourceCount:b.sourceCount,rowCount:b.rowCount}))}];}))})));
}
function editionIdentity(edition) {
  return hash(Buffer.from(stable({schema:EDITION_SCHEMA,captureId:edition.captureId,sourceSha256:edition.sourceSha256,
    createdAt:edition.createdAt,completedAt:edition.completedAt})));
}
function validateReceipt(receipt,url) {
  if(!plain(receipt)||receipt.url!==url||!SHA.test(receipt.sha256??'')||!Number.isSafeInteger(receipt.bytes)||receipt.bytes<0||receipt.status!==200)
    throw fault('OPENFEMA_RECEIPT','A retained original response has a different URL, status or byte identity.',409);
}
export function createOpenFemaCapture({store,fetchImpl=globalThis.fetch,userAgent='Commons OpenFEMA portfolio/1.0'}={}) {
  if(!store||typeof store.putObject!=='function'||typeof store.saveResponse!=='function'||typeof store.mutate!=='function')
    throw fault('OPENFEMA_STORE','Use the original private workspace store.');
  if(typeof fetchImpl!=='function')throw fault('OPENFEMA_FETCH','An available native Fetch implementation is required.');
  if(typeof userAgent!=='string'||!userAgent||userAgent.length>240||/[\r\n]/.test(userAgent))
    throw fault('OPENFEMA_USER_AGENT','Use a short plain user-agent label.');
  let active=activeStores.get(store);if(!active){active=new Set();activeStores.set(store,active);}
  const find=(state,id)=>state.captures?.find(c=>c.schema===CAPTURE_SCHEMA&&c.id===id);
  function status(id) {
    if(!CAPTURE_ID.test(id??''))throw fault('OPENFEMA_CAPTURE_ID','Choose an original 24-character capture ID.');
    const value=find(store.read(),id);
    if(!value)throw fault('OPENFEMA_CAPTURE_UNKNOWN','The capture is not retained in this workspace.',404);
    return copy(value);
  }
  async function update(id,fn) {
    return store.mutate(state=>{const c=find(state,id);if(!c)throw fault('OPENFEMA_CAPTURE_UNKNOWN','The capture is not retained.',404);
      fn(c);c.updatedAt=stamp();return copy(c);});
  }
  async function begin({id24=randomBytes(12).toString('hex'),scope,label='OpenFEMA portfolio'}={}) {
    if(!CAPTURE_ID.test(id24??''))throw fault('OPENFEMA_CAPTURE_ID','Use a 24-character lowercase hex capture ID.');
    const selected=validateScope(scope);
    if(typeof label!=='string'||!label.trim()||label.length>240)throw fault('OPENFEMA_LABEL','Use a portfolio label of at most 240 characters.');
    return store.mutate(state=>{
      state.captures??=[];const old=state.captures.find(c=>c.id===id24);
      if(old) {
        if(old.schema!==CAPTURE_SCHEMA||stable(old.scope)!==stable(selected))
          throw fault('OPENFEMA_CAPTURE_CONFLICT','This capture ID already belongs to another cohort.',409);
        return copy(old);
      }
      const c={schema:CAPTURE_SCHEMA,id:id24,label:label.trim(),scope:selected,state:'READY',createdAt:stamp(),updatedAt:stamp(),
        datasets:Object.fromEntries(KINDS.map(k=>[k,freshDataset(k)])),disasterNumbers:[],issues:[],attempts:[],editionId:null,error:null};
      state.captures.push(c);return copy(c);
    });
  }
  async function original(receipt,url) {
    validateReceipt(receipt,url);const bytes=await store.object(receipt.sha256);
    if(bytes.length!==receipt.bytes)throw fault('OPENFEMA_SOURCE_CHANGED','The retained source byte length changed.',409);
    return {receipt,body:parseOpenFemaJSON(bytes)};
  }
  async function fetchOriginal(id,kind,url,{signal,fresh=false,max=MAX_PAGE_BYTES,generation=0}={}) {
    const target=new URL(url);
    if(target.origin!=='https://www.fema.gov'||!target.pathname.startsWith('/api/open/')||target.username||target.password)
      throw fault('OPENFEMA_SOURCE_URL','Only the original public OpenFEMA API may be captured.');
    const saved=await store.response(id,url);
    if(saved?.status===429&&saved.retryAt&&Date.parse(saved.retryAt)>Date.now())
      throw fault('OPENFEMA_RATE_LIMIT','The original FEMA response asks this request to wait until '+saved.retryAt+'.',429,{receipt:saved,retryAfter:saved.headers?.['retry-after']??null});
    if(!fresh&&saved?.captureGeneration===generation&&saved?.dataset===kind&&saved.status===200)return original(saved,url);
    signal?.throwIfAborted();
    const timeout=AbortSignal.timeout(45000),combined=signal?AbortSignal.any([signal,timeout]):timeout;
    let response;
    try {response=await fetchImpl(url,{method:'GET',headers:{accept:'application/json','user-agent':userAgent},redirect:'error',signal:combined});}
    catch(error) {
      if(signal?.aborted)throw fault('OPENFEMA_CAPTURE_PAUSED','Capture paused; completed original pages are retained.',409);
      throw fault('OPENFEMA_TRANSPORT','The original FEMA request did not return. Resume this capture to continue from its last retained page.',503,{cause:error});
    }
    const limit=response.status===200?max:65536,chunks=[];let length=0;
    if(response.body?.getReader) {
      const reader=response.body.getReader();
      try {
        while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;
          if(length>limit){await reader.cancel();throw fault('OPENFEMA_RESPONSE_SIZE','The original response exceeds its retained page limit.',502);}
          chunks.push(Buffer.from(part.value));}
      }finally{reader.releaseLock();}
    } else {
      const bytes=Buffer.from(await response.arrayBuffer());length=bytes.length;
      if(length>limit)throw fault('OPENFEMA_RESPONSE_SIZE','The original response exceeds its retained page limit.',502);chunks.push(bytes);
    }
    const bytes=Buffer.concat(chunks,length),object=await store.putObject(bytes);
    const receipt={schema:'stellar-forge.openfema-response.v1',url,method:'GET',status:response.status,
      observedAt:stamp(),headers:safeHeaders(response.headers),...object,dataset:kind,captureGeneration:generation};
    const retryAfter=receipt.headers['retry-after'];
    if(response.status===429&&retryAfter) {
      const retryTime=/^\d+$/.test(retryAfter)?Date.now()+Number(retryAfter)*1000:Date.parse(retryAfter);
      if(Number.isFinite(retryTime))receipt.retryAt=new Date(retryTime).toISOString();
    }
    await store.saveResponse(id,url,receipt);
    if(response.status!==200) {
      const retry=receipt.headers['retry-after'];
      throw fault(response.status===429?'OPENFEMA_RATE_LIMIT':'OPENFEMA_HTTP',
        'FEMA returned HTTP '+response.status+'. The response is retained; resume the same capture after the provider recovers.',
        response.status===429?429:502,{receipt,retryAfter:retry??null});
    }
    return {receipt,body:parseOpenFemaJSON(bytes)};
  }
  async function refreshDataset(id,kind,reason) {
    return update(id,c=>{
      const old=c.datasets[kind];
      if(old.pages.length||old.metadataReceipt)c.attempts.push({kind,reason,retainedAt:stamp(),dataset:copy(old)});
      c.datasets[kind]=freshDataset(kind,old.generation+1);
      c.issues.push({code:'SOURCE_REFRESH_RESTART',kind,at:stamp(),message:reason});
    });
  }
  async function collectDataset(id,kind,filters,{signal,onProgress}={}) {
    let restarts=0;
    while(true) {
      signal?.throwIfAborted();
      let c=status(id),dataset=c.datasets[kind];
      if(dataset.state==='COMPLETE')return dataset;
      const start=await fetchOriginal(id,kind,metaUrl(kind),{signal,fresh:true,max:MAX_METADATA_BYTES,generation:dataset.generation});
      const metadata=metadataRecord(start.body,kind);
      if(dataset.metadataSnapshot&&refreshToken(dataset.metadataSnapshot)!==refreshToken(metadata)) {
        await refreshDataset(id,kind,'The source dataset refreshed before this capture resumed. Its complete scoped paging is restarting.');
        dataset=status(id).datasets[kind];
      }
      if(!dataset.metadataReceipt) {
        const fields=await fetchOriginal(id,kind,fieldsUrl(kind),{signal,max:MAX_METADATA_BYTES,generation:dataset.generation});
        validateFields(fields.body,kind);
        await update(id,c=>{
          const d=c.datasets[kind];d.metadataReceipt=start.receipt;d.metadataSnapshot=metadata;d.fieldsReceipt=fields.receipt;
          d.filterBatches=filters.map(filter=>({filter,sourceCount:null,rowCount:0,skip:0,lastKey:null,pages:[],complete:false}));
          d.state='PAGING';
        });
      } else {
        await original(dataset.metadataReceipt,metaUrl(kind));
        validateFields((await original(dataset.fieldsReceipt,fieldsUrl(kind))).body,kind);
        if(stable(dataset.filterBatches.map(b=>b.filter))!==stable(filters))
          throw fault('OPENFEMA_SCOPE_CHANGED','The retained page filters differ from the selected original cohort.',409);
      }
      c=status(id);dataset=c.datasets[kind];
      try {
      for(let batchIndex=0;batchIndex<dataset.filterBatches.length;batchIndex++) {
        let batch=status(id).datasets[kind].filterBatches[batchIndex];
        const allowed=kind==='declarations'?(c.scope.disasterNumbers.length?new Set(split(c.scope.disasterNumbers)[batchIndex]):null):new Set((batch.filter.match(/\d+/g)??[]).map(Number));
        while(!batch.complete) {
          signal?.throwIfAborted();
          const current=status(id),d=current.datasets[kind],url=pageUrl(kind,batch.filter,batch.skip,current.scope.pageSize);
          const saved=await fetchOriginal(id,kind,url,{signal,generation:d.generation});
          const records=entityRows(saved.body,d.entity);
          if(records.length>current.scope.pageSize)throw fault('OPENFEMA_PAGE_SIZE','The source returned more rows than the requested page.',502);
          const count=boundPageMetadata(saved.body,{skip:batch.skip,pageSize:current.scope.pageSize,firstCount:batch.sourceCount});
          if(batch.skip+records.length>count||(!records.length&&batch.skip<count))
            throw fault('OPENFEMA_SOURCE_CHANGED','The scoped row count changed or a source page is missing. Resume to refresh this dataset.',409);
          let lastKey=batch.lastKey;const issues=[];
          for(let rowIndex=0;rowIndex<records.length;rowIndex++) {
            const row=records[rowIndex],number=integer(row.disasterNumber,'Source disaster number',{min:1,max:99999});
            if(kind==='declarations'?(!matchesDeclaration(row,current.scope)||(allowed&&!allowed.has(number))):!allowed.has(number))
              throw fault('OPENFEMA_FILTER_IGNORED','A provider row is outside its requested disaster cohort.',502);
            const key=String(row[d.orderBy]??'');
            if(!key)throw fault('OPENFEMA_SOURCE_KEY','The original source row lacks its stable paging key '+d.orderBy+'.',502);
            if(lastKey!==null) {
              const cmp=compareKey(lastKey,key,kind);
              if(cmp>0)throw fault('OPENFEMA_PAGE_ORDER','The provider page is not ordered by its original source key.',502);
              if(cmp===0)issues.push({code:'DUPLICATE_SOURCE_KEY',kind,key,sourcePageSha256:saved.receipt.sha256,sourceRow:rowIndex});
            }
            lastKey=key;
          }
          const page={...saved.receipt,skip:batch.skip,count:records.length,sourceCount:count,batchIndex,filter:batch.filter,
            metadata:copy(saved.body.metadata)};
          await update(id,c=>{
            const d=c.datasets[kind],b=d.filterBatches[batchIndex];
            if(b.skip!==batch.skip)throw fault('OPENFEMA_CAPTURE_CONFLICT','Another operation changed this capture page.',409);
            if(b.sourceCount===null){b.sourceCount=count;d.sourceCount+=count;}
            b.pages.push(page);d.pages.push(page);b.rowCount+=records.length;d.rowCount+=records.length;b.skip+=records.length;
            b.lastKey=lastKey;b.complete=b.rowCount===count;c.issues.push(...issues);
          });
          if(onProgress)await onProgress(status(id));
          batch=status(id).datasets[kind].filterBatches[batchIndex];
        }
      }
      } catch(error) {
        if(['OPENFEMA_SOURCE_CHANGED','OPENFEMA_PAGE_ORDER'].includes(error.code)) {
          await refreshDataset(id,kind,'The source paging sequence changed. The next attempt starts from the first original page.');
          if(restarts++<1)continue;
        }
        throw error;
      }
      const current=status(id),d=current.datasets[kind];
      const end=await fetchOriginal(id,kind,metaUrl(kind),{signal,fresh:true,max:MAX_METADATA_BYTES,generation:d.generation});
      const endMetadata=metadataRecord(end.body,kind);
      if(refreshToken(d.metadataSnapshot)!==refreshToken(endMetadata)) {
        await refreshDataset(id,kind,'FEMA refreshed this dataset while it was being paged; all original pages remain in its prior attempt.');
        if(restarts++<1)continue;
        throw fault('OPENFEMA_SOURCE_MOVING','FEMA refreshed this dataset during both paging attempts. Resume the same capture after this refresh settles.',409);
      }
      await update(id,c=>{const d=c.datasets[kind];
        if(d.rowCount!==d.sourceCount||d.filterBatches.some(b=>!b.complete))
          throw fault('OPENFEMA_INCOMPLETE','The source cohort is not complete.',409);
        d.metadataEndReceipt=end.receipt;d.state='COMPLETE';d.completedAt=stamp();});
      return status(id).datasets[kind];
    }
  }
  async function *datasetRows(dataset) {
    for(const page of dataset.pages) {
      const {body}=await original(page,page.url),records=entityRows(body,dataset.entity);
      if(records.length!==page.count)throw fault('OPENFEMA_SOURCE_CHANGED','The retained page row count changed.',409);
      for(let sourceRow=0;sourceRow<records.length;sourceRow++)
        yield {record:records[sourceRow],sourcePageSha256:page.sha256,sourceRow,sourceUrl:page.url};
    }
  }
  async function finish(id,{originalEdition=null}={}) {
    const c=status(id);
    if(KINDS.some(k=>c.datasets[k].state!=='COMPLETE'))throw fault('OPENFEMA_INCOMPLETE','All three original datasets must complete before creating an edition.',409);
    const completedAt=c.completedAt??stamp();let edition={schema:EDITION_SCHEMA,id:null,captureId:id,label:c.label,scope:c.scope,createdAt:c.createdAt,completedAt,
      datasets:c.datasets,disasterNumbers:c.disasterNumbers,sourceSha256:null,issues:c.issues,
      consistency:'dataset-refresh-bracketed',termsUrl:'https://www.fema.gov/about/openfema/terms-conditions',
      source:'Federal Emergency Management Agency, OpenFEMA'};
    edition.sourceSha256=sourceIdentity(edition);edition.id=editionIdentity(edition);
    if(originalEdition) {
      if(originalEdition.schema!==EDITION_SCHEMA||sourceIdentity(originalEdition)!==originalEdition.sourceSha256||
         editionIdentity(originalEdition)!==originalEdition.id||originalEdition.sourceSha256!==edition.sourceSha256)
        throw fault('OPENFEMA_IMPORT_EDITION','The supplied original edition differs from the complete retained source responses.',409);
      edition=copy(originalEdition);
    }
    await update(id,record=>{record.completedAt??=completedAt;});
    await store.saveEdition(edition);
    await store.mutate(state=>{
      const record=find(state,id);record.state='COMPLETE';record.completedAt=completedAt;record.editionId=edition.id;record.error=null;
      record.updatedAt=completedAt;state.editionIds??=[];if(!state.editionIds.includes(edition.id))state.editionIds.push(edition.id);
    });
    return copy(edition);
  }
  async function run(id,{signal,onProgress}={}) {
    const initial=status(id);
    if(initial.state==='COMPLETE')return readEdition(initial.editionId);
    if(initial.importBundleSha256)throw fault('OPENFEMA_IMPORT_RESUME','Resume this imported capture with the same original source bundle.',409);
    if(active.has(id))throw fault('OPENFEMA_CAPTURE_BUSY','This original capture is already running.',409);
    active.add(id);
    try {
      await update(id,c=>{c.state='RUNNING';c.error=null;});
      await collectDataset(id,'declarations',declarationFilters(initial.scope),{signal,onProgress});
      const numbers=new Set();
      for await(const row of datasetRows(status(id).datasets.declarations))
        numbers.add(integer(row.record.disasterNumber,'Declaration number',{min:1,max:99999}));
      const selected=[...numbers].sort((a,b)=>a-b),previous=status(id).disasterNumbers;
      if(previous.length&&stable(previous)!==stable(selected)) {
        for(const kind of ['applicants','projects'])await refreshDataset(id,kind,'The complete declaration cohort changed before its linked datasets completed.');
      }
      await update(id,c=>{c.disasterNumbers=selected;});
      const filters=linkedFilters(selected);
      for(const kind of ['applicants','projects'])await collectDataset(id,kind,filters,{signal,onProgress});
      return await finish(id);
    }catch(error) {
      await update(id,c=>{c.state='PAUSED';c.error={code:error.code??'OPENFEMA_CAPTURE_ERROR',message:String(error.message??error),at:stamp(),
        ...(error.receipt?{receipt:error.receipt}:{}),...(error.retryAfter?{retryAfter:error.retryAfter}:{})};});
      throw error;
    }finally{active.delete(id);}
  }
  async function readEdition(id) {
    if(!SHA.test(id??''))throw fault('OPENFEMA_EDITION_ID','Choose a retained original edition.');
    const edition=await store.edition(id);
    if(edition.schema!==EDITION_SCHEMA||edition.id!==id||sourceIdentity(edition)!==edition.sourceSha256||editionIdentity(edition)!==id)
      throw fault('OPENFEMA_EDITION_CHANGED','The original edition identity changed.',409);
    return edition;
  }
  async function *rows(id,kind) {
    if(!Object.hasOwn(DATASETS,kind))throw fault('OPENFEMA_DATASET','Choose declarations, applicants or projects.');
    yield* datasetRows((await readEdition(id)).datasets[kind]);
  }
  async function retainExternal(id,kind,input,url,generation=0) {
    if(!plain(input)||input.url!==url||input.status!==200||typeof input.observedAt!=='string'||!Number.isFinite(Date.parse(input.observedAt)))
      throw fault('OPENFEMA_IMPORT_RECEIPT','Import the original URL, observed timestamp, HTTP200 status and unchanged response bytes.');
    let bytes;
    if(typeof input.bodyText==='string'&&input.bodyBase64===undefined)bytes=Buffer.from(input.bodyText,'utf8');
    else if(typeof input.bodyBase64==='string'&&input.bodyText===undefined&&/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.bodyBase64))
      bytes=Buffer.from(input.bodyBase64,'base64');
    else throw fault('OPENFEMA_IMPORT_BYTES','Each original response needs exactly one bodyText or canonical bodyBase64 value.');
    if(bytes.length>MAX_PAGE_BYTES)throw fault('OPENFEMA_IMPORT_BYTES','An original page exceeds 64MiB.');
    const object=await store.putObject(bytes);
    if(input.sha256!=null&&input.sha256!==object.sha256||input.bytes!=null&&input.bytes!==object.bytes)
      throw fault('OPENFEMA_IMPORT_HASH','The imported source bytes differ from the supplied receipt.',409);
    const receipt={schema:'stellar-forge.openfema-response.v1',url,status:200,method:'GET',observedAt:input.observedAt,
      headers:safeHeaders(input.headers),...object,dataset:kind,captureGeneration:generation,acquisition:'imported-original'};
    await store.saveResponse(id,url,receipt);return {receipt,body:parseOpenFemaJSON(bytes)};
  }
  async function importBundle(bundle) {
    if(!plain(bundle)||bundle.schema!==BUNDLE_SCHEMA||!plain(bundle.datasets)||KINDS.some(k=>!plain(bundle.datasets[k])))
      throw fault('OPENFEMA_IMPORT_SCHEMA','Choose an original OpenFEMA source bundle containing all three datasets.');
    const bundleSha256=hash(Buffer.from(stable(bundle)));
    const b=await begin({id24:bundle.captureId??randomBytes(12).toString('hex'),scope:bundle.scope,label:bundle.label??'Imported OpenFEMA portfolio'});
    if(b.importBundleSha256&&b.importBundleSha256!==bundleSha256)
      throw fault('OPENFEMA_IMPORT_CONFLICT','This capture ID belongs to a different original source bundle.',409);
    if(b.state==='COMPLETE') {
      if(!b.importBundleSha256)throw fault('OPENFEMA_IMPORT_CONFLICT','This capture ID already belongs to a native source acquisition.',409);
      return readEdition(b.editionId);
    }
    if(active.has(b.id))throw fault('OPENFEMA_CAPTURE_BUSY','This capture is already running.',409);
    active.add(b.id);
    try {
      if(!b.importBundleSha256&&KINDS.some(k=>b.datasets[k].metadataReceipt||b.datasets[k].pages.length))
        throw fault('OPENFEMA_IMPORT_CONFLICT','Use a new capture ID when importing a separate original source bundle.',409);
      await update(b.id,c=>{c.state='IMPORTING';c.error=null;c.importBundleSha256=bundleSha256;});
      let cohort=[];
      for(const kind of KINDS) {
        const existing=status(b.id).datasets[kind];
        if(existing.state==='COMPLETE') {
          if(kind==='declarations')cohort=status(b.id).disasterNumbers;
          continue;
        }
        const incoming=bundle.datasets[kind],meta=await retainExternal(b.id,kind,incoming.metadata,metaUrl(kind)),
          fields=await retainExternal(b.id,kind,incoming.fields,fieldsUrl(kind));
        const metadata=metadataRecord(meta.body,kind);validateFields(fields.body,kind);
        const filters=kind==='declarations'?declarationFilters(b.scope):linkedFilters(cohort);
        if(!Array.isArray(incoming.pages))throw fault('OPENFEMA_IMPORT_PAGES','Each imported dataset must include its complete ordered original pages.');
        const dataset=freshDataset(kind),importIssues=[];dataset.metadataReceipt=meta.receipt;dataset.metadataSnapshot=metadata;dataset.fieldsReceipt=fields.receipt;
        let pageIndex=0;const numbers=new Set();
        for(let batchIndex=0;batchIndex<filters.length;batchIndex++) {
          const filter=filters[batchIndex],allowed=kind==='declarations'?(b.scope.disasterNumbers.length?new Set(split(b.scope.disasterNumbers)[batchIndex]):null):new Set((filter.match(/\d+/g)??[]).map(Number));
          const batch={filter,sourceCount:null,rowCount:0,skip:0,lastKey:null,pages:[],complete:false};
          while(!batch.complete) {
            const item=incoming.pages[pageIndex++];if(!item)throw fault('OPENFEMA_IMPORT_INCOMPLETE','An imported source page is missing.');
            const url=pageUrl(kind,filter,batch.skip,b.scope.pageSize),retained=await retainExternal(b.id,kind,item,url),
              records=entityRows(retained.body,dataset.entity),
              count=boundPageMetadata(retained.body,{skip:batch.skip,pageSize:b.scope.pageSize,firstCount:batch.sourceCount});
            if(records.length>b.scope.pageSize||batch.skip+records.length>count||(!records.length&&batch.skip<count))
              throw fault('OPENFEMA_IMPORT_INCOMPLETE','An imported page does not cover its declared source count.');
            for(const [sourceRow,row] of records.entries()) {
              const number=integer(row.disasterNumber,'Source disaster number',{min:1,max:99999});
              if(kind==='declarations'?(!matchesDeclaration(row,b.scope)||(allowed&&!allowed.has(number))):!allowed.has(number))
                throw fault('OPENFEMA_IMPORT_SCOPE','An original row is outside the selected cohort.');
              if(kind==='declarations')numbers.add(number);
              const key=String(row[dataset.orderBy]??'');
              if(!key||batch.lastKey!==null&&compareKey(batch.lastKey,key,kind)>0)
                throw fault('OPENFEMA_IMPORT_ORDER','The imported pages must follow their complete original source-key order.');
              if(batch.lastKey!==null&&compareKey(batch.lastKey,key,kind)===0)
                importIssues.push({code:'DUPLICATE_SOURCE_KEY',kind,key,sourcePageSha256:retained.receipt.sha256,sourceRow});
              batch.lastKey=key;
            }
            const page={...retained.receipt,skip:batch.skip,count:records.length,sourceCount:count,batchIndex,filter,metadata:copy(retained.body.metadata)};
            if(batch.sourceCount===null){batch.sourceCount=count;dataset.sourceCount+=count;}
            batch.pages.push(page);dataset.pages.push(page);batch.skip+=records.length;batch.rowCount+=records.length;dataset.rowCount+=records.length;
            batch.complete=batch.rowCount===count;
          }
          dataset.filterBatches.push(batch);
        }
        if(pageIndex!==incoming.pages.length)throw fault('OPENFEMA_IMPORT_SCOPE','The bundle contains extra pages outside its exact cohort.');
        const end=await retainExternal(b.id,kind,incoming.metadataEnd,metaUrl(kind));
        if(refreshToken(metadata)!==refreshToken(metadataRecord(end.body,kind)))
          throw fault('OPENFEMA_IMPORT_REFRESH','The original dataset refreshed during this supplied page sequence.');
        dataset.metadataEndReceipt=end.receipt;dataset.state='COMPLETE';dataset.completedAt=stamp();
        if(kind==='declarations')cohort=[...numbers].sort((a,b)=>a-b);
        await update(b.id,c=>{c.datasets[kind]=dataset;c.disasterNumbers=cohort;c.issues.push(...importIssues);});
      }
      return await finish(b.id,{originalEdition:bundle.edition??null});
    }catch(error) {
      await update(b.id,c=>{c.state='PAUSED';c.error={code:error.code??'OPENFEMA_IMPORT_ERROR',message:String(error.message??error),at:stamp()};});
      throw error;
    }finally{active.delete(b.id);}
  }
  async function exportBundle(id) {
    const e=await readEdition(id),bundle={schema:BUNDLE_SCHEMA,captureId:e.captureId,scope:e.scope,label:e.label,sourceEditionId:e.id,edition:copy(e),datasets:{}};
    const pack=async receipt=>{
      const bytes=await store.object(receipt.sha256);
      if(bytes.length!==receipt.bytes)throw fault('OPENFEMA_SOURCE_CHANGED','The original response length changed.',409);
      return {url:receipt.url,status:receipt.status,observedAt:receipt.observedAt,headers:receipt.headers,sha256:receipt.sha256,bytes:receipt.bytes,
        bodyBase64:bytes.toString('base64')};
    };
    for(const kind of KINDS) {
      const d=e.datasets[kind],out={metadata:await pack(d.metadataReceipt),fields:await pack(d.fieldsReceipt),pages:[],metadataEnd:await pack(d.metadataEndReceipt)};
      for(const page of d.pages)out.pages.push(await pack(page));bundle.datasets[kind]=out;
    }
    return bundle;
  }
  return {begin,run,status,rows,readEdition,importBundle,exportBundle,
    resume:(id,options)=>run(id,options),
    async capture({id,id24,scope,label,...options}={}){const c=await begin({id24:id24??id,scope,label});return run(c.id,options);}};
}
