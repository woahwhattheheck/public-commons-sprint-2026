// MIT. Retained address review and native SF30 dataset editions.
import {mkdir,open,readFile,rename,unlink,realpath,lstat,readdir} from 'node:fs/promises';
import {dirname,resolve,join,relative,isAbsolute,sep,basename} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {gzipSync,gunzipSync} from 'node:zlib';
import {loadDatasetConfig} from '../dataset-handler.mjs';
import {buildDatasetSellerConfig,datasetQueryParameters} from '../dataset-cli.mjs';
import {INTAKE_SCHEMA,SOURCE_SCHEMA,RESPONSE_SCHEMA,hash,canonical,json,parseJSON,object,own,fail,
  readCsvRecords,readJSONSourceRecords,createAddressIntake,inspectAddressIntake,inspectBatchResponse,
  normalizePolicy,reviewAddressIntake,validateDecision,buildReviewedRows,csvBytes,HPD_MAPPING,SIMPLYRETS_MAPPING} from './source.mjs';

const SCHEMA='stellar-forge.geocodio-workspace.v1',PACKAGE='stellar-forge.geocodio-package.v1';
const HASH=/^[a-f0-9]{64}$/,ID=/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/;
const MAX=256*1024*1024,now=()=>new Date().toISOString();
const exists=async path=>{try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}};
function relativeFile(value){
  if(typeof value!=='string'||!value||value.length>500||isAbsolute(value)||value.includes('\\')||
    value.split('/').some(part=>!part||part==='.'||part==='..')||/[\x00-\x1f\x7f]/.test(value))
    throw fail('GEOCODIO_FILE','Choose a retained workspace file.');
  return value;
}
async function fileBytes(path,maximum=MAX){
  const file=await open(path,'r');
  try{
    const before=await file.stat({bigint:true});
    if(!before.isFile()||before.size>BigInt(maximum))throw fail('GEOCODIO_FILE','Read a regular file within the declared byte limit.');
    const raw=await file.readFile(),after=await file.stat({bigint:true});
    if(raw.length>maximum||BigInt(raw.length)!==before.size||before.size!==after.size||before.mtimeNs!==after.mtimeNs)
      throw fail('GEOCODIO_SOURCE_CHANGED','The selected source changed during intake.',409);
    return raw;
  }finally{await file.close();}
}
async function atomic(path,raw){
  await mkdir(dirname(path),{recursive:true,mode:0o700});
  const temporary=path+'.'+randomUUID()+'.tmp';let primary;
  try{
    const handle=await open(temporary,'wx',0o600);
    try{await handle.writeFile(raw);await handle.sync();}finally{await handle.close();}
    await rename(temporary,path);
  }catch(error){primary=error;throw error;}
  finally{try{await unlink(temporary);}catch(error){if(error.code!=='ENOENT'&&!primary)throw error;}}
}
const descriptor=(file,bytes)=>({file,bytes:bytes.length,sha256:hash(bytes)});
const boundedText=(value,label,max=4000)=>{
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value))
    throw fail('GEOCODIO_INPUT',label+' needs printable text.');
  return value.trim();
};
const integer=(value,label,min,max)=>{
  if(!Number.isSafeInteger(value)||value<min||value>max)throw fail('GEOCODIO_INPUT',label+' must be an integer from '+min+' to '+max+'.');
  return value;
};
function publicReceipt(raw={}){
  if(!object(raw))throw fail('GEOCODIO_RECEIPT','Use a provider response receipt.');
  const receipt={};
  for(const key of ['status','receivedAt','contentType','requestId','usage','retryAfter']){
    if(own(raw,key))receipt[key]=structuredClone(raw[key]);
  }
  if(raw.url){
    const url=new URL(raw.url);
    if(url.protocol!=='https:'||!['api.geocod.io','www.geocod.io'].includes(url.hostname)||url.username||url.password)
      throw fail('GEOCODIO_RECEIPT','Use the original Geocodio response URL.');
    for(const key of [...url.searchParams.keys()])if(/key|token|auth|secret/i.test(key))url.searchParams.delete(key);
    receipt.url=url.href;
  }
  if(receipt.status!==undefined)integer(receipt.status,'HTTP status',100,599);
  return receipt;
}
export async function openGeocodioWorkspace({directory,apiKey=process.env.GEOCODIO_API_KEY,
  fetcher=globalThis.fetch,timeoutMs=900000}={}){
  if(typeof directory!=='string'||!directory)throw fail('GEOCODIO_DIRECTORY','Choose the operator workspace directory.');
  directory=resolve(directory);await mkdir(directory,{recursive:true,mode:0o700});
  if(await realpath(directory)!==directory)throw fail('GEOCODIO_DIRECTORY','Use the canonical workspace directory.');
  let lease;
  try{lease=new DatabaseSync(join(directory,'writer.sqlite'));lease.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN EXCLUSIVE');}
  catch(error){try{lease?.close();}catch{};throw fail(error.code?.includes('BUSY')?'GEOCODIO_WORKSPACE_BUSY':'GEOCODIO_STORAGE',
    error.code?.includes('BUSY')?'Another original operator owns this workspace.':error.message,409);}
  const path=join(directory,'workspace.json');
  let state;
  try{state=await exists(path)?parseJSON(await fileBytes(path)): {
    schema:SCHEMA,createdAt:now(),revision:0,intake:null,responses:[],requests:[],decisions:[],policy:normalizePolicy(),
    editions:[],activeEditionId:null,merchant:null,exports:[],queries:{},error:null
  };
  }catch(error){lease.close();throw error;}
  if(state.schema!==SCHEMA||!Number.isSafeInteger(state.revision)||state.revision<0||!Array.isArray(state.responses)||!Array.isArray(state.requests)||!Array.isArray(state.decisions)||!Array.isArray(state.editions)||!Array.isArray(state.exports)||!object(state.queries)){lease.close();throw fail('GEOCODIO_WORKSPACE','The directory needs its original valid address workspace.');}
  let running=null,closed=false,tail=Promise.resolve(),cache=null;
  const serial=fn=>{
    if(closed)return Promise.reject(fail('GEOCODIO_CLOSED','The workspace is closed.',409));
    const job=tail.then(fn);tail=job.catch(()=>{});return job;
  };
  const save=async()=>{state.updatedAt=now();await atomic(path,json(state));};
  const persist=async()=>{state.revision++;cache=null;await save();};
  const inside=async file=>{
    const full=join(directory,relativeFile(file)),actual=await realpath(full),rel=relative(directory,actual);
    if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)||actual!==full)
      throw fail('GEOCODIO_FILE','Retained source files must stay in their original workspace.');
    return full;
  };
  const read=async(item,maximum=MAX)=>{
    if(!item||!HASH.test(item.sha256??''))throw fail('GEOCODIO_FILE','Missing retained file identity.');
    const raw=await fileBytes(await inside(item.file),maximum);
    if(raw.length!==item.bytes||hash(raw)!==item.sha256)throw fail('GEOCODIO_RETAINED_CHANGED','A retained file differs from its saved identity.',409);
    return raw;
  };
  const immutable=async(file,raw)=>{
    relativeFile(file);
    const full=join(directory,file);
    if(await exists(full)){
      const existing=await fileBytes(await inside(file));
      if(!existing.equals(raw))throw fail('GEOCODIO_RETAINED_CHANGED','The retained artifact has different bytes.',409);
    }else await atomic(full,raw);
    return descriptor(file,raw);
  };
  const intake=async()=>{
    if(!state.intake)throw fail('GEOCODIO_INTAKE_REQUIRED','Import the original address source first.');
    const value=parseJSON(await read(state.intake));inspectAddressIntake(value);return value;
  };
  async function review(){
    if(cache?.revision===state.revision)return cache.review;
    const source=await intake(),matches={};
    for(const saved of state.responses){
      const request=parseJSON(await read(saved.request));
      const parsed=inspectBatchResponse({bytes:await read(saved.response),request,mode:saved.mode,queryId:saved.queryId});
      for(const [id,result] of Object.entries(parsed.matches)){
        if(!own(source.queries,id)||canonical(request[id])!==canonical(source.queries[id]))
          throw fail('GEOCODIO_RESPONSE_BINDING','The retained provider request differs from the source address.');
        matches[id]={...result,responseId:saved.id,responseSha256:saved.response.sha256};
      }
    }
    const decisions=Object.fromEntries(state.decisions.map(decision=>[decision.queryId,decision]));
    const result=reviewAddressIntake({intake:source,matches,decisions,policy:state.policy});
    cache={revision:state.revision,review:result};return result;
  }
  const active=()=>state.editions.find(item=>item.id===state.activeEditionId);
  async function nativeEdition(edition=active()){
    if(!edition)throw fail('GEOCODIO_EDITION_REQUIRED','Build and select a reviewed dataset edition.');
    await read(edition.csv);await read(edition.config);
    const model=await loadDatasetConfig(await inside(edition.config.file));
    if(model.describe().snapshot!==edition.snapshot)throw fail('GEOCODIO_EDITION_CHANGED','The native dataset snapshot differs.',409);
    return model;
  }
  async function publicState(){
    const r=state.intake?await review():null;
    return {schema:SCHEMA,directory,revision:state.revision,createdAt:state.createdAt,updatedAt:state.updatedAt,
      source:state.intake?parseJSON(await read(state.intake)).source:null,intake:state.intake,
      summary:r?.summary??null,policy:state.policy,
      addresses:r?.rows.map(({id,query,sourceRows,state:status,reasons,maximumDisplacementMeters,candidates})=>({
        id,address:[query.street,query.street2,query.city,query.state_province,query.postal_code].filter(Boolean).join(', '),
        sourceRows,status,reasons,maximumDisplacementMeters,candidateCount:candidates.length,
        providerAddress:candidates[0]?.formattedAddress??null,accuracy:candidates[0]?.accuracy??null,
        accuracyType:candidates[0]?.accuracyType??null}))??[],
      duplicates:r?.duplicates??[],responses:state.responses,requests:state.requests.map(({queryIds,...rest})=>({...rest,queryCount:queryIds.length})),
      editions:state.editions,activeEditionId:state.activeEditionId,merchant:state.merchant,exports:state.exports,
      lastQuery:active()?state.queries[active().id]??null:null,
      api:{configured:Boolean(apiKey),endpoint:'https://api.geocod.io/v2/geocode',fields:[],maximumBatch:10000},
      running,error:state.error};
  }
  const requireRevision=input=>{
    if(input.expectedRevision!==state.revision)throw fail('GEOCODIO_REVISION_CONFLICT','The address review changed. Refresh and review the current selection.',409);
  };
  async function importIntake(input){
    if(state.intake)throw fail('GEOCODIO_INTAKE_EXISTS','This workspace already retains an original source. Open another workspace for another intake.',409);
    const external=resolve(boundedText(input.path,'Source path',4000)),raw=await fileBytes(external);
    let value,sourceFile;
    if(input.format==='intake'||input.format===undefined){
      value=parseJSON(raw);inspectAddressIntake(value);
      if(input.sourcePath){
        const original=await fileBytes(resolve(boundedText(input.sourcePath,'Original source bytes path')));
        if(original.length!==value.source.bytes||hash(original)!==value.source.sha256)
          throw fail('GEOCODIO_SOURCE_CHANGED','The original source bytes differ from the retained intake identity.');
        sourceFile=await immutable('source/'+value.source.sha256+(String(input.sourcePath).toLowerCase().endsWith('.csv')?'.csv':'.json'),original);
      }
    }else{
      const source={url:input.sourceURL??null,name:basename(external),bytes:raw.length,sha256:hash(raw),
        format:input.format,provenance:input.provenance??'operator-selected source'};
      const records=input.format==='csv'?readCsvRecords(raw).rows:
        ['json','simplyrets'].includes(input.format)?readJSONSourceRecords(raw):
        (()=>{throw fail('GEOCODIO_SOURCE_FORMAT','Choose retained intake, CSV, JSON records, or SimplyRETS.');})();
      value=createAddressIntake({records,source,mapping:input.mapping??
        (input.format==='simplyrets'?SIMPLYRETS_MAPPING:HPD_MAPPING),operationId:input.operationId});
      sourceFile=await immutable('source/'+source.sha256+(input.format==='csv'?'.csv':'.json'),raw);
    }
    const checked=inspectAddressIntake(value),bytes=json(value);
    const retained=await immutable('source/intake-'+hash(bytes)+'.json',bytes);
    state.intake={...retained,...(sourceFile?{sourceFile}:{}),summary:checked};
    await persist();return {intake:state.intake,summary:checked};
  }
  async function importResponse(input){
    const source=await intake(),raw=await fileBytes(resolve(boundedText(input.responsePath,'Response path')));
    let request,requestBytes,mode=input.mode??'object';
    if(mode==='single'){
      if(!own(source.queries,input.queryId??''))throw fail('GEOCODIO_QUERY','Choose the original query for this single-address response.');
      request={[input.queryId]:source.queries[input.queryId]};requestBytes=json(request);
    }else{
      requestBytes=await fileBytes(resolve(boundedText(input.requestPath,'Original request body path')));
      const original=parseJSON(requestBytes);
      if(mode==='object')request=original;
      else if(mode==='array'){
        if(!Array.isArray(original)||!Array.isArray(input.queryIds)||input.queryIds.length!==original.length)
          throw fail('GEOCODIO_RESPONSE_BINDING','An original array request needs its complete ordered query IDs.');
        request=Object.fromEntries(input.queryIds.map((id,index)=>[id,original[index]]));
      }else throw fail('GEOCODIO_RESPONSE_BINDING','Choose the original response binding mode.');
      if(!object(request)||Object.keys(request).length>10000)throw fail('GEOCODIO_RESPONSE_BINDING','Read the complete original request body.');
    }
    for(const [id,query] of Object.entries(request))
      if(!own(source.queries,id)||canonical(query)!==canonical(source.queries[id]))
        throw fail('GEOCODIO_RESPONSE_BINDING','The response request differs from this original address intake.');
    const parsed=inspectBatchResponse({bytes:raw,request,mode,queryId:input.queryId});
    const receipt=publicReceipt(input.receipt),key=hash(Buffer.concat([requestBytes,Buffer.from('\0'),raw]));
    const previous=state.responses.find(item=>item.id===key);
    if(previous)return {response:previous,reused:true};
    const prefix='provider/'+key;
    const record={id:key,importedAt:now(),mode,queryId:input.queryId??null,receipt,
      originalRequest:await immutable(prefix+'/original-request.json',requestBytes),
      request:await immutable(prefix+'/request-binding.json',json(request)),
      response:await immutable(prefix+'/response.json',raw),queryCount:parsed.queryCount,
      returned:parsed.returned,missing:parsed.missing};
    if(input.requestId){
      const pending=state.requests.find(item=>item.id===input.requestId);
      if(!pending||pending.request.sha256!==hash(requestBytes))
        throw fail('GEOCODIO_REQUEST_CHANGED','The original saved request body differs from this response.');
      pending.responseId=key;pending.status=parsed.missing.length?'PARTIAL':'COMPLETE';pending.completedAt=now();
    }
    state.responses.push(record);
    await persist();return {response:record,reused:false};
  }
  async function prepareRequest(input){
    const source=await intake(),current=await review(),missing=new Set(current.rows.filter(row=>row.providerStatus==='UNQUERIED'||row.providerStatus==='MISSING').map(row=>row.id));
    let ids=input.queryIds??[...missing];
    if(!Array.isArray(ids)||!ids.length||new Set(ids).size!==ids.length||ids.some(id=>!own(source.queries,id)))
      throw fail('GEOCODIO_REQUEST','Select original address queries.');
    if(ids.some(id=>!missing.has(id))&&input.refresh!==true)
      throw fail('GEOCODIO_ALREADY_CAPTURED','Reuse saved address results or explicitly prepare a refreshed provider request.');
    const maximum=integer(input.maximumLookups,'Maximum lookups',1,10000);
    if(ids.length>maximum)throw fail('GEOCODIO_LOOKUP_LIMIT','The selected request exceeds its explicit lookup limit.');
    if(state.requests.some(item=>['SENDING','UNCERTAIN'].includes(item.status)&&item.queryIds.some(id=>ids.includes(id))))
      throw fail('GEOCODIO_REQUEST_UNCERTAIN','Reconcile the saved in-flight request before selecting these addresses again.',409);
    const request=Object.fromEntries(ids.map(id=>[id,source.queries[id]])),body=json(request);
    const id='request-'+randomUUID(),saved={id,status:'PREPARED',createdAt:now(),queryIds:ids,lookups:ids.length,maximumLookups:maximum,
      fields:[],limit:0,endpoint:'https://api.geocod.io/v2/geocode?limit=0',request:await immutable('requests/'+id+'.json',body)};
    state.requests.push(saved);await persist();return {request:saved,path:join(directory,saved.request.file)};
  }
  async function runRequest(input){
    const request=state.requests.find(item=>item.id===input.id);
    if(!request||request.status!=='PREPARED'||request.request.sha256!==input.expectedRequestSha256)
      throw fail('GEOCODIO_REQUEST_CHANGED','Review the exact prepared request before running it.',409);
    if(!apiKey)throw fail('GEOCODIO_API_KEY','Start this operator with its original Geocodio API key environment variable.');
    if(typeof fetcher!=='function')throw fail('GEOCODIO_TRANSPORT','A supported HTTP transport is required.');
    const raw=await read(request.request),body=parseJSON(raw);
    request.status='SENDING';request.startedAt=now();await persist();
    let response,received,receipt;
    try{
      response=await fetcher(request.endpoint,{method:'POST',headers:{accept:'application/json','content-type':'application/json',
        authorization:'Bearer '+apiKey},body:raw,redirect:'error',signal:AbortSignal.timeout(timeoutMs)});
      const chunks=[];let bytes=0;
      if(response.body)for await(const chunk of response.body){
        bytes+=chunk.length;if(bytes>MAX){await response.body.cancel().catch(()=>{});throw fail('GEOCODIO_RESPONSE_LIMIT','The provider response exceeds 256 MiB.');}
        chunks.push(chunk);
      }
      received=Buffer.concat(chunks);
      receipt={status:response.status,receivedAt:now(),url:request.endpoint,contentType:response.headers.get('content-type'),
        retryAfter:response.headers.get('retry-after')};
      const retained=await immutable('requests/'+request.id+'-response.json',received);
      request.rawResponse=retained;request.receipt=receipt;
      if(!response.ok){request.status=response.status===429?'RATE_LIMITED':'PROVIDER_ERROR';await persist();
        throw fail('GEOCODIO_PROVIDER_HTTP','Geocodio returned HTTP '+response.status+'. Review the retained response and provider retry guidance.',response.status>=400&&response.status<500?response.status:502);}
      const parsed=inspectBatchResponse({bytes:received,request:body});
      const key=hash(Buffer.concat([raw,Buffer.from('\0'),received]));
      const record={id:key,importedAt:now(),mode:'object',queryId:null,receipt,
        originalRequest:request.request,request:request.request,response:retained,
        queryCount:parsed.queryCount,returned:parsed.returned,missing:parsed.missing};
      if(!state.responses.some(item=>item.id===key))state.responses.push(record);
      request.responseId=key;request.status=parsed.missing.length?'PARTIAL':'COMPLETE';request.completedAt=now();
      await persist();return {request,summary:{queryCount:parsed.queryCount,returned:parsed.returned,missing:parsed.missing}};
    }catch(error){
      if(request.status==='SENDING'){request.status='UNCERTAIN';request.error={message:boundedText(error.message||'Transport interrupted','Request error'),at:now()};
        await persist();}
      throw error;
    }
  }
  async function buildEdition(input){
    const source=await intake(),reviewed=await review(),name=boundedText(input.name,'Dataset name',128);
    const sourceColumns=input.sourceColumns??[];
    const rows=buildReviewedRows({intake:source,review:reviewed,sourceColumns,scope:input.scope??'all-source'});
    if(!rows.length)throw fail('GEOCODIO_EDITION_EMPTY','The selected review scope has no rows.');
    const names=Object.keys(rows[0]),columns={};
    const numbers=new Set(['accuracy','provider_latitude','provider_longitude','displacement_m','selected_latitude','selected_longitude']);
    for(const name of names)columns[name]={type:name==='source_ordinal'?'integer':numbers.has(name)?'number':'string',
      nullable:numbers.has(name)};
    const config={schema:'stellar-forge.csv-dataset.v1',file:'dataset.csv',name,columns,
      filters:['review_state','accuracy_type','coordinate_choice','stable_address_key'],
      ranges:['accuracy','displacement_m'],sorts:['source_ordinal','accuracy','displacement_m'],
      defaultLimit:integer(input.defaultLimit??50,'Default page size',1,1000),
      maxLimit:integer(input.maxLimit??250,'Maximum page size',1,1000)};
    if(config.defaultLimit>config.maxLimit)throw fail('GEOCODIO_EDITION','Default page size must fit the maximum.');
    const csv=csvBytes(rows,names),basis={intake:state.intake.sha256,policy:state.policy,decisions:state.decisions,
      responses:state.responses.map(item=>({id:item.id,sha256:item.response.sha256})),sourceColumns,scope:input.scope??'all-source'};
    const id='edition-'+hash(canonical({csv:hash(csv),config,basis})).slice(0,40),prefix='editions/'+id;
    const prior=state.editions.find(item=>item.id===id);if(prior){state.activeEditionId=id;await persist();return {edition:prior,reused:true};}
    const csvFile=await immutable(prefix+'/dataset.csv',csv),configFile=await immutable(prefix+'/dataset.json',json(config));
    const dataset=await loadDatasetConfig(await inside(configFile.file)),description=dataset.describe();
    const record={id,createdAt:now(),rowCount:rows.length,snapshot:description.snapshot,scope:input.scope??'all-source',
      csv:csvFile,config:configFile,basis:await immutable(prefix+'/review-basis.json',json(basis)),
      sourceColumns,reviewSummary:reviewed.summary,queryParameters:datasetQueryParameters(description)};
    state.editions.push(record);state.activeEditionId=id;await persist();
    return {edition:record,dataset:description,preview:dataset.handle({query:{limit:String(config.defaultLimit)}}),reused:false};
  }
  async function exportPackage(){
    const edition=active(),dataset=await nativeEdition(edition),source=await intake(),reviewed=await review();
    const id='export-'+randomUUID(),prefix='exports/'+id;
    const selected=state.queries[edition.id];
    const sourceManifest={schema:SOURCE_SCHEMA,createdAt:now(),originalSource:source.source,intakeSha256:state.intake.sha256,
      mapping:inspectAddressIntake(source).mapping,rawRoot:'raw',provider:'Geocodio',direction:'forward',countries:['US'],
      nativeSnapshot:edition.snapshot,edition,reviewSummary:edition.reviewSummary,
      retainedResponses:state.responses.map(item=>({id:item.id,request:item.originalRequest,response:item.response,receipt:item.receipt})),
      coordinatePolicy:'Original source coordinates remain alongside explicitly reviewed provider candidates.',
      termsURL:'https://www.geocod.io/terms-of-use',providerDocs:'https://www.geocod.io/docs/'};
    const query={schema:'stellar-forge.dataset-query.v1',snapshot:edition.snapshot,query:selected?.initialQuery??{limit:'50'},
      lastQuery:selected?.query??null,nextCursor:selected?.nextCursor??null,queryParameters:datasetQueryParameters(dataset.describe())};
    const values={'dataset.csv':await read(edition.csv),'dataset.json':await read(edition.config),
      'source.json':json(sourceManifest),'query.json':json(query),'address-review.json':json(reviewed),
      'README.md':Buffer.from('# Address review delivery\n\n'+edition.rowCount+' retained source rows. Native snapshot '+edition.snapshot+
        '.\n\nSource coordinates, provider candidates, match quality and operator decisions remain distinct columns. Query review_state to select pending or reviewed records. The source manifest preserves the intake, provider response identities and original field mapping.\n\nImport starforge-geocodio.json.gz into an empty address workspace to reopen the complete original source, candidates, review history and dataset editions. Read the selected-date/source provenance before combining this delivery with another feed.\n')};
    if(state.merchant){
      const seller=await buildDatasetSellerConfig(dataset,state.merchant);values['seller.json']=json(seller);
    }
    const retained=new Map();
    const add=async item=>{if(item&&!retained.has(item.file))retained.set(item.file,await read(item));};
    await add(state.intake);await add(state.intake.sourceFile);
    for(const response of state.responses){await add(response.originalRequest);await add(response.request);await add(response.response);}
    for(const request of state.requests){await add(request.request);await add(request.rawResponse);}
    for(const saved of state.editions){await add(saved.csv);await add(saved.config);await add(saved.basis);}
    const snapshot={...state,exports:[],error:null};
    const portable={schema:PACKAGE,exportedAt:now(),state:snapshot,files:[...retained].map(([file,raw])=>({...descriptor(file,raw),base64:raw.toString('base64')}))};
    values['starforge-geocodio.json.gz']=gzipSync(json(portable));
    for(const [file,raw] of retained)values['raw/'+file]=raw;
    sourceManifest.sourceFiles=Object.entries(values)
      .filter(([name])=>!['dataset.csv','dataset.json','seller.json','source.json'].includes(name))
      .map(([path,raw])=>({path,bytes:raw.length,sha256:hash(raw)}));
    values['source.json']=json(sourceManifest);
    const files=[];
    for(const [name,raw] of Object.entries(values)){const d=await immutable(prefix+'/'+name,raw);files.push({name,bytes:d.bytes,sha256:d.sha256});}
    const record={id,createdAt:now(),directory:join(directory,prefix),editionId:edition.id,snapshot:edition.snapshot,files};
    state.exports.push(record);await persist();return record;
  }
  async function importPackage(input){
    if(state.intake||state.responses.length||state.editions.length)throw fail('GEOCODIO_RESTORE','Restore into an empty address workspace.',409);
    const raw=await fileBytes(resolve(boundedText(input.path,'Portable package path')));
    let value;
    try{value=parseJSON(raw[0]===0x1f&&raw[1]===0x8b?gunzipSync(raw,{maxOutputLength:512*1024*1024}):raw);}
    catch(error){throw fail('GEOCODIO_PACKAGE',error.message);}
    if(value.schema!==PACKAGE||value.state?.schema!==SCHEMA||!Array.isArray(value.files)||value.files.length>10000)
      throw fail('GEOCODIO_PACKAGE','Choose the complete retained address package.');
    const entries=new Map();let total=0;
    for(const item of value.files){
      relativeFile(item.file);
      if(!/^(source|provider|requests|editions)\//.test(item.file))throw fail('GEOCODIO_PACKAGE','Portable files must be retained source, provider, request, or edition records.');
      if(entries.has(item.file)||typeof item.base64!=='string'||!HASH.test(item.sha256??''))throw fail('GEOCODIO_PACKAGE','Duplicate or invalid retained file descriptor.');
      const bytes=Buffer.from(item.base64,'base64');total+=bytes.length;
      if(total>512*1024*1024||bytes.length!==item.bytes||hash(bytes)!==item.sha256||bytes.toString('base64')!==item.base64)
        throw fail('GEOCODIO_PACKAGE','A portable source file differs from its descriptor.');
      entries.set(item.file,bytes);
    }
    const saved=value.state;
    if(!Number.isSafeInteger(saved.revision)||saved.revision<0||!Array.isArray(saved.responses)||!Array.isArray(saved.requests)||!Array.isArray(saved.decisions)||!Array.isArray(saved.editions)||!object(saved.queries))
      throw fail('GEOCODIO_PACKAGE','The saved address workspace has incomplete state.');
    const inspect=item=>{
      const bytes=entries.get(relativeFile(item?.file));
      if(!bytes||bytes.length!==item.bytes||hash(bytes)!==item.sha256)throw fail('GEOCODIO_PACKAGE','A required retained source file is missing.');
      return bytes;
    };
    const original=parseJSON(inspect(saved.intake));inspectAddressIntake(original);if(saved.intake.sourceFile)inspect(saved.intake.sourceFile);
    normalizePolicy(saved.policy);
    for(const response of saved.responses){
      inspect(response.originalRequest);const request=parseJSON(inspect(response.request));
      for(const [id,query] of Object.entries(request))if(!own(original.queries,id)||canonical(query)!==canonical(original.queries[id]))
        throw fail('GEOCODIO_PACKAGE','A provider response belongs to another source address.');
      inspectBatchResponse({bytes:inspect(response.response),request,mode:response.mode,queryId:response.queryId});
    }
    for(const request of saved.requests){inspect(request.request);if(request.rawResponse)inspect(request.rawResponse);}
    for(const edition of saved.editions){
      inspect(edition.csv);const config=parseJSON(inspect(edition.config));inspect(edition.basis);
      if(config.file!=='dataset.csv'||basename(edition.csv.file)!=='dataset.csv'||dirname(edition.csv.file)!==dirname(edition.config.file))
        throw fail('GEOCODIO_PACKAGE','A native edition must bind its adjacent retained CSV.');
    }
    if(saved.activeEditionId&&!saved.editions.some(item=>item.id===saved.activeEditionId))throw fail('GEOCODIO_PACKAGE','The selected edition is absent.');
    for(const [file,bytes] of entries)await immutable(file,bytes);
    for(const edition of saved.editions){
      const native=await loadDatasetConfig(join(directory,edition.config.file));
      if(native.describe().snapshot!==edition.snapshot||native.describe().rowCount!==edition.rowCount)
        throw fail('GEOCODIO_PACKAGE','The restored native edition differs from its saved snapshot.');
    }
    state={...saved,exports:[],restoredAt:now(),error:null};cache=null;await persist();await review();
    return {restored:true,sourceRows:original.source.rows,editions:state.editions.length,snapshot:active()?.snapshot??null};
  }
  const reads=new Set(['review.query','review.list','provider.request','status']);
  async function dispatch(action,input){
    if(!reads.has(action))requireRevision(input);
    if(action==='status')return {};
    if(action==='intake.import')return importIntake(input);
    if(action==='provider.import')return importResponse(input);
    if(action==='provider.prepare')return prepareRequest(input);
    if(action==='provider.run')return runRequest(input);
    if(action==='provider.request'){
      const request=state.requests.find(item=>item.id===input.id);
      if(!request)throw fail('GEOCODIO_REQUEST','Choose a retained original request.');
      return {request,path:await inside(request.request.file),body:parseJSON(await read(request.request))};
    }
    if(action==='policy.save'){state.policy=normalizePolicy(input.policy);await persist();return state.policy;}
    if(action==='review.list'){
      const result=await review(),offset=integer(input.offset??0,'Offset',0,1000000),limit=integer(input.limit??50,'Limit',1,500);
      let rows=result.rows;
      if(input.status)rows=rows.filter(row=>row.state===input.status);
      if(input.search){const query=String(input.search).toLowerCase();rows=rows.filter(row=>canonical({query:row.query,ids:row.sourceOrdinals}).toLowerCase().includes(query));}
      return {summary:result.summary,total:rows.length,offset,rows:rows.slice(offset,offset+limit)};
    }
    if(action==='review.query'){
      const source=await intake(),r=(await review()).rows.find(row=>row.id===input.queryId);
      if(!r)throw fail('GEOCODIO_QUERY','Choose an original address query.');
      return {...r,originalRows:source.bindings.filter(row=>row.query_id===r.id)};
    }
    if(action==='review.decide'){
      const decision=validateDecision({review:await review(),...input});state.decisions.push(decision);await persist();return decision;
    }
    if(action==='review.acceptQualified'){
      const reviewState=await review(),note=boundedText(input.note,'Review note');
      const chosen=reviewState.rows.filter(row=>row.state==='QUALIFIED');
      const ids=chosen.map(row=>row.id);
      if(canonical(input.queryIds)!==canonical(ids))throw fail('GEOCODIO_REVIEW_CHANGED','Review the exact qualified address selection before applying it.',409);
      const decisions=chosen.map(row=>validateDecision({review:reviewState,queryId:row.id,candidateId:row.recommended,
        action:'accept',coordinateChoice:input.coordinateChoice,note}));
      for(const decision of decisions)state.decisions.push(decision);
      await persist();return {reviewedQueries:chosen.length};
    }
    if(action==='edition.build')return buildEdition(input);
    if(action==='edition.activate'){
      if(!state.editions.some(item=>item.id===input.editionId))throw fail('GEOCODIO_EDITION','Choose a retained dataset edition.');
      state.activeEditionId=input.editionId;await persist();return active();
    }
    if(action==='dataset.query'){
      const native=await nativeEdition(),result=native.handle({query:input.query??{}});
      if(result.status===200){
        const query={...input.query},initialQuery={...query};delete initialQuery.cursor;
        state.queries[active().id]={query,initialQuery,snapshot:active().snapshot,nextCursor:result.body.page.nextCursor,
          returned:result.body.page.returned,total:result.body.page.total,queriedAt:now()};await persist();
      }
      return result;
    }
    if(action==='merchant.configure'){
      const native=await nativeEdition();await buildDatasetSellerConfig(native,input.merchant);
      state.merchant=structuredClone(input.merchant);await persist();return {merchant:state.merchant};
    }
    if(action==='package.export')return exportPackage();
    if(action==='package.import')return importPackage(input);
    throw fail('GEOCODIO_ACTION','Choose a supported address workspace action.');
  }
  try{await save();}catch(error){lease.exec('ROLLBACK');lease.close();throw error;}
  return {
    state:async()=>publicState(),
    act:(action,input={})=>serial(async()=>{
      if(typeof action!=='string'||!object(input))throw fail('GEOCODIO_ACTION','Use an action name and object payload.');
      running={action,startedAt:now()};state.error=null;
      try{const result=await dispatch(action,input);running=null;return {result,state:await publicState()};}
      catch(error){running=null;state.error={code:error.code??'GEOCODIO_OPERATION',message:error.message,at:now()};
        await save().catch(()=>{});throw error;}
    }),
    readExport:(exportId,filename)=>serial(async()=>{
      const item=state.exports.find(entry=>entry.id===exportId),saved=item?.files.find(file=>file.name===filename);
      if(!saved||relativeFile(filename)!==filename||!ID.test(exportId))throw fail('GEOCODIO_EXPORT','Choose a retained exported file.',404);
      const file='exports/'+exportId+'/'+filename,raw=await read({file,...saved});
      return {path:await inside(file),contentType:filename.endsWith('.gz')?'application/gzip':filename.endsWith('.csv')?
        'text/csv; charset=utf-8':filename.endsWith('.json')?'application/json; charset=utf-8':'text/markdown; charset=utf-8',
        bytes:raw.length,sha256:hash(raw)};
    }),
    close:async()=>{if(closed)return;closed=true;await tail;cache=null;try{lease.exec('ROLLBACK');}finally{lease.close();}}
  };
}
