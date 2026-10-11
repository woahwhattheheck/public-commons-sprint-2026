// SPDX-License-Identifier: MIT
// Native MCP customer workflow over the ORIGINAL SF88 dataset and SF100 data room.
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open, readdir, lstat} from 'node:fs/promises';
import {join, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {need, execution, InputError} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/config.mjs';
import {createDatasetSession, inspectDatasetSession, recoverDatasetSession,
  deliverDatasetSession, accountDatasetSession} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-session.mjs';
import {canonical, validateDatasetQuery} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-page.mjs';
import {workspaceConfiguration} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/queue.mjs';
import {MAX_DATASET_PAGES, MAX_DATASET_PAGE_BYTES} from '../../stellar/scf-starforge-20261009/sf100-buyer-dataset-delivery/deliver.mjs';
import {initializationDirectory as directory, initializationBytes as bytes,
  optionalInitializationBytes as optionalBytes, retainInitializationFile as retain,
  retainInitializationRecord as retainRecord, initializationJson as encoded,
  acquireInitialization} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {createSavedFileReader} from './native-file.mjs';

const SCHEMA='stellar-forge.mcp-native-dataset.v1';
const SOURCE='stellar-forge.mcp-native-dataset-source.v1';
const HASH=/^[a-f0-9]{64}$/;
const sha=value=>createHash('sha256').update(value).digest('hex');
const same=(a,b)=>canonical(a)===canonical(b);
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const fail=code=>{throw new InputError(code);};
const integer=(value,min,max)=>Number.isSafeInteger(value)&&value>=min&&value<=max;
const fieldName=value=>typeof value==='string'&&/^[A-Za-z][A-Za-z0-9_]{0,47}$/.test(value)&&
  !['constructor','prototype','__proto__'].includes(value);
const files=Object.freeze({
  'dataset.jsonl':'application/x-ndjson',
  'dataset.csv':'text/csv; charset=utf-8',
  'review.html':'text/html; charset=utf-8',
  'manifest.json':'application/json',
});
const pins=['operator.json','workspace.json','policy.json','signer.mjs'];
const datasetCli=fileURLToPath(new URL('../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/dataset-cli.mjs',import.meta.url));
const identifier=value=>{
  need(typeof value==='string'&&/^[A-Za-z0-9._:-]{1,128}$/.test(value),'MCP_DATASET_ACQUISITION_ID_REQUIRED');
  return sha(value);
};
function parse(raw){
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch{fail('MCP_DATASET_JSON_INVALID');}
}
const json=async(path,limit=262144)=>parse(await bytes(path,limit));
async function exists(path){
  try{await lstat(path);return true;}
  catch(error){if(error.code==='ENOENT')return false;throw error;}
}
function page(args){
  const offset=args.offset??0,limit=args.limit??25;
  need(integer(offset,0,1000000)&&integer(limit,1,100),'MCP_DATASET_PAGE_INVALID');
  return {offset,limit};
}
function atomic(value){
  need(typeof value==='string'&&/^[1-9][0-9]{0,38}$/.test(value)&&
    BigInt(value)<=170141183460469231731687303715884105727n,'MCP_DATASET_ATOMIC_LIMIT_INVALID');
  return value;
}
function description(raw){
  const value=parse(raw);
  need(object(value)&&typeof value.name==='string'&&value.name.length>=1&&value.name.length<=128&&
    !/[\x00-\x1f\x7f]/.test(value.name)&&HASH.test(value.snapshot??'')&&
    integer(value.rowCount,0,Number.MAX_SAFE_INTEGER)&&
    integer(value.defaultLimit,1,1000)&&integer(value.maxLimit,value.defaultLimit,1000)&&
    Array.isArray(value.columns)&&integer(value.columns.length,1,64),
    'MCP_DATASET_ORIGINAL_DESCRIPTION_REQUIRED');
  const names=new Set();
  for(const column of value.columns){
    need(object(column)&&fieldName(column.name)&&!names.has(column.name)&&
      ['string','boolean','integer','number'].includes(column.type)&&typeof column.nullable==='boolean'&&
      ['filterable','rangeFilterable','sortable'].every(key=>column[key]===undefined||typeof column[key]==='boolean'),
      'MCP_DATASET_DESCRIPTION_COLUMN_INVALID');
    names.add(column.name);
  }
  return value;
}
// This is only a request preview. Original inspectDatasetPage checks the actual
// response, native query signature, every typed row and cursor continuity.
function typedFilter(text,column){
  if(text===''&&column.nullable)return null;
  if(column.type==='string')return text;
  if(column.type==='boolean'&&['true','false'].includes(text))return text==='true';
  if(column.type==='integer'&&/^-?(0|[1-9][0-9]*)$/.test(text)&&Number.isSafeInteger(Number(text)))return Number(text);
  if(column.type==='number'&&/^-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?$/.test(text)&&
    Number.isFinite(Number(text)))return Number(text);
  fail('DATASET_FILTER_TYPE_MISMATCH');
}
function selection(value,query,route){
  need(object(query)&&Object.keys(query).length<=32&&
    Object.values(query).every(text=>typeof text==='string'&&Buffer.byteLength(text)<=8192),
    'MCP_DATASET_QUERY_REQUIRED');
  need(query.snapshot===undefined||query.snapshot===value.snapshot,'MCP_DATASET_SNAPSHOT_SELECTION_CONFLICT');
  // The plain original CSV route has no snapshot URL selector. Its exact
  // generation is still bound by expectedSnapshot in the native session.
  // Only forward an explicitly selected, matching version-store parameter.
  const selected={...query};
  const url=new URL(route.origin+route.pathname);
  for(const key of Object.keys(selected).sort())url.searchParams.set(key,selected[key]);
  need(Buffer.byteLength(url.href)<=16384,'MCP_DATASET_QUERY_TOO_LARGE');
  const params=validateDatasetQuery(url.href,{initial:true}),columns=new Map(value.columns.map(c=>[c.name,c]));
  const projected=params.has('fields')?params.get('fields').split(','):[...columns.keys()];
  need(projected.every(name=>columns.has(name)),'MCP_DATASET_UNKNOWN_FIELD');
  const limit=Number(params.get('limit')??value.defaultLimit);
  need(limit<=value.maxLimit,'MCP_DATASET_PAGE_LIMIT_EXCEEDS_DESCRIPTION');
  const filters={},ranges=[];
  for(const [key,text] of params){
    if(['fields','limit','snapshot'].includes(key))continue;
    if(key==='sort'){
      const name=text.startsWith('-')?text.slice(1):text;
      need(columns.get(name)?.sortable===true,'DATASET_SORT_NOT_ENABLED');continue;
    }
    const match=/^(where|gt|gte|lt|lte)_(.+)$/.exec(key),column=columns.get(match?.[2]);
    need(column&&(match[1]==='where'?column.filterable===true:column.rangeFilterable===true),
      'MCP_DATASET_QUERY_CAPABILITY_NOT_ENABLED');
    const typed=typedFilter(text,column);
    if(match[1]==='where')filters[column.name]=typed;
    else{need(typed!==null,'DATASET_RANGE_NULL_BOUND');ranges.push([column.name,match[1],typed]);}
  }
  const sort=params.get('sort');
  return {url:url.href,query:Object.fromEntries(params),snapshot:value.snapshot,
    fields:projected,columns:projected.map(name=>columns.get(name)),limit,filters,ranges,
    order:sort?{column:sort.startsWith('-')?sort.slice(1):sort,direction:sort.startsWith('-')?'desc':'asc',
      nulls:'last',ties:'csv-record-order'}:'csv-record-order'};
}
function limits(args){
  need(integer(args.maxPages,1,MAX_DATASET_PAGES)&&integer(args.maxRows,1,1000000)&&
    integer(args.maxPageBytes,1024,MAX_DATASET_PAGE_BYTES),'MCP_DATASET_LIMITS_REQUIRED');
  return {maxPages:args.maxPages,maxTotalAtomic:atomic(args.maxTotalAtomic),
    maxRows:args.maxRows,maxPageBytes:args.maxPageBytes};
}
const fields=Object.freeze({
  'dataset-sources':['limit','cursor'],
  'dataset-describe':['sourceId'],
  'dataset-prepare':['acquisitionId','sourceId','query','maxAtomic','maxPages','maxTotalAtomic','maxRows','maxPageBytes'],
  'dataset-history':['limit','cursor'],
  'dataset-status':['acquisitionId','offset','limit'],
  'dataset-run':['acquisitionId','offset','limit'],
  'dataset-cancel':['acquisitionId','offset','limit'],
  'dataset-recover':['acquisitionId','offset','limit'],
  'dataset-deliver':['acquisitionId'],
  'dataset-rows':['acquisitionId','offset','limit','maxBytes'],
  'dataset-read':['acquisitionId','filename','byteOffset','maxBytes'],
  'dataset-accounting':['acquisitionId','offset','limit'],
  'dataset-finalize':['acquisitionId','offset','limit'],
});
export const nativeDatasetActions=Object.freeze(Object.keys(fields));

function originalCommand(arguments_,signal){
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new InputError('OPERATOR_ABORTED'));return;}
    let child,timer,finished=false,stderr='';
    const done=(error,result)=>{
      if(finished)return;finished=true;clearTimeout(timer);signal.removeEventListener('abort',abort);
      error?reject(error):resolve(result);
    };
    const abort=()=>{
      if(child&&child.exitCode===null&&child.signalCode===null){
        child.kill('SIGTERM');timer??=setTimeout(()=>child.kill('SIGKILL'),10000);
      }
    };
    try{child=spawn(process.execPath,[datasetCli,...arguments_],{
      shell:false,detached:false,env:process.env,stdio:['ignore','pipe','pipe']});}
    catch{done(new InputError('MCP_NATIVE_EXECUTOR_START_FAILED'));return;}
    child.once('error',()=>done(new InputError('MCP_NATIVE_EXECUTOR_START_FAILED')));
    child.stdout.resume();
    child.stderr.on('data',part=>{stderr=(stderr+part.toString('utf8')).slice(-8192);});
    child.once('close',(exitCode,childSignal)=>{
      let error=null;
      for(const line of stderr.split(/\r?\n/))try{
        const value=JSON.parse(line);if(/^[A-Z0-9_]{1,120}$/.test(value.error??''))error=value.error;
      }catch{}
      done(null,{exitCode,signal:childSignal,error,interrupted:signal.aborted});
    });
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
  });
}

/** No new payment or acquisition engine: the host owns one original approval gate. */
export function createNativeDatasets({manifest,currentWorkspace,runOwned,cancelOwned,isActive,isClosed}){
  const root=join(manifest.directory,'datasets'),readSavedFile=createSavedFileReader();
  const preparing=new Map(),offline=new Set(),rowIndexes=new Map();
  function track(task){
    offline.add(task);task.finally(()=>offline.delete(task)).catch(()=>{});
    return task;
  }
  async function roots(create=false){
    if(!create&&!await exists(root))return false;
    await directory(root,{create});
    for(const name of ['sources','acquisitions'])await directory(join(root,name),{create});
    return true;
  }
  async function workspacePins(){
    return Object.fromEntries(await Promise.all(pins.map(async name=>[
      name,sha(await bytes(join(manifest.workspace,name),2*1024*1024))])));
  }
  async function source(sourceId){
    need(typeof sourceId==='string'&&HASH.test(sourceId),'MCP_DATASET_SOURCE_ID_REQUIRED');
    need(await roots(),'MCP_DATASET_SOURCE_NOT_REGISTERED');
    const raw=await bytes(join(root,'sources',sourceId+'.description.json'),1024*1024);
    const record=await json(join(root,'sources',sourceId+'.json'));
    need(sha(raw)===sourceId&&record.schema===SOURCE&&record.sourceId===sourceId&&
      record.descriptionSha256===sourceId&&record.bytes===raw.length&&same(record.route,manifest.route),
      'MCP_DATASET_SOURCE_CHANGED');
    const dataset=description(raw);
    need(record.datasetSha256===sha(canonical(dataset))&&record.snapshot===dataset.snapshot,
      'MCP_DATASET_SOURCE_CHANGED');
    return {raw,record,dataset};
  }
  async function register(descriptionPath){
    need(!isClosed(),'MCP_NATIVE_WORKSPACE_CLOSING');
    const current=await currentWorkspace(),op=execution(current.config).op;
    need(op.method==='GET'&&new URL(op.url).search===''&&op.bodyFile===undefined&&
      manifest.route.method==='GET','MCP_DATASET_WORKSPACE_ROUTE_MISMATCH');
    const handle=await open(descriptionPath,constants.O_RDONLY|constants.O_NOFOLLOW|(constants.O_NONBLOCK??0));
    let raw;
    try{
      const info=await handle.stat();
      need(info.isFile()&&info.size>0&&info.size<=1024*1024,'MCP_DATASET_DESCRIPTION_FILE_INVALID');
      raw=await handle.readFile();need(raw.length<=1024*1024,'MCP_DATASET_DESCRIPTION_TOO_LARGE');
    }finally{await handle.close();}
    const dataset=description(raw),sourceId=sha(raw);
    await roots(true);
    await retain(join(root,'sources',sourceId+'.description.json'),raw,{resume:true});
    const record=await retainRecord(join(root,'sources',sourceId+'.json'),{
      schema:SOURCE,sourceId,descriptionSha256:sourceId,datasetSha256:sha(canonical(dataset)),
      bytes:raw.length,snapshot:dataset.snapshot,name:dataset.name,registeredAt:new Date().toISOString(),
      filename:basename(descriptionPath),route:manifest.route,
    },{resume:true,ignore:['registeredAt','filename']});
    return {schema:SCHEMA,status:'DATASET_SOURCE_REGISTERED',source:record,dataset,
      authority:'OPERATOR_REGISTERED_ORIGINAL_SF30_DATASET_DESCRIPTION'};
  }
  async function request(acquisitionId,{optional=false}={}){
    const key=identifier(acquisitionId),path=join(root,'acquisitions',key);
    if(optional&&!await exists(join(path,'request.json')))return null;
    await directory(path);
    const record=await json(join(path,'request.json'));
    need(record.schema===SCHEMA&&record.acquisitionId===acquisitionId&&
      record.requestSha256===sha(canonical(record.specification)),'MCP_DATASET_ACQUISITION_CHANGED');
    const configRaw=await bytes(join(path,'buyer.json'),65536),cfg=parse(configRaw);
    need(sha(configRaw)===record.configSha256&&sha(canonical(cfg))===record.configurationSha256,
      'MCP_DATASET_CONFIG_CHANGED');
    const src=await source(record.specification.sourceId);
    const selected=selection(src.dataset,record.specification.query,manifest.route);
    need(same(selected,record.selected)&&record.datasetSha256===src.record.datasetSha256,
      'MCP_DATASET_SELECTION_CHANGED');
    const op=execution(cfg).op;
    need(op.intentId==='mcp-dataset:'+key&&op.url===selected.url&&op.method==='GET'&&
      op.bodyFile===undefined&&cfg.responseFile===undefined&&cfg.captureBody===false&&
      same(op.headers??{},manifest.route.headers),'MCP_DATASET_CONFIG_CHANGED');
    const pointerRaw=await optionalBytes(join(path,'binding.json'),8192),pointer=pointerRaw===null?null:parse(pointerRaw);
    let definition=null,session=null;
    if(pointer){
      need(pointer.schema===SCHEMA&&pointer.acquisitionId===acquisitionId&&
        /^[0-9]{6}$/.test(pointer.initialization)&&HASH.test(pointer.sessionSha256??''),
        'MCP_DATASET_SESSION_BINDING_CHANGED');
      session=join(path,'sessions',pointer.initialization);
      const raw=await bytes(join(session,'session.json'),262144);definition=parse(raw);
      need(sha(raw)===pointer.sessionSha256&&definition.schema==='stellar-forge.sf88.dataset-session.v1'&&
        definition.directory===session&&definition.config.operation.intentId===pointer.sessionId&&
        definition.configurationSha256===pointer.configurationSha256&&
        pointer.configurationSha256===record.configurationSha256&&same(definition.config,cfg)&&
        definition.workspaceDirectory===undefined&&definition.expectedSnapshot===selected.snapshot&&
        same(definition.limits,record.specification.limits),'MCP_DATASET_SESSION_BINDING_CHANGED');
    }
    return {path,key,record,cfg,pointer,definition,session,source:src};
  }
  async function completed(acquisitionId){
    const saved=await request(acquisitionId);
    need(saved.pointer,'MCP_DATASET_INITIALIZATION_INCOMPLETE');return saved;
  }
  function reportView(saved,report,args={}){
    need(report?.schema==='stellar-forge.sf88.dataset-acquisition.v1'&&report.directory===saved.session,
      'MCP_DATASET_NATIVE_REPORT_INVALID');
    if(report.status==='RUNNING')return report;
    need(report.sessionId===saved.pointer.sessionId&&report.configurationSha256===saved.record.configurationSha256&&
      report.expectedSnapshot===saved.record.selected.snapshot&&same(report.limits,saved.record.specification.limits)&&
      Array.isArray(report.pages)&&report.pages.every(p=>p.datasetSha256===saved.record.datasetSha256),
      'MCP_DATASET_NATIVE_SOURCE_CHANGED');
    const {offset,limit}=page(args),rows=report.pages.slice(offset,offset+limit);
    return {...report,pages:rows,pageRange:{offset,limit,total:report.pages.length,
      nextOffset:offset+rows.length<report.pages.length?offset+rows.length:null}};
  }
  const view=async(saved,args={})=>({schema:SCHEMA,acquisitionId:saved.record.acquisitionId,
    binding:{sessionId:saved.pointer.sessionId,configurationSha256:saved.record.configurationSha256},
    report:reportView(saved,await inspectDatasetSession(saved.session),args)});
  async function newRunPreflight(saved){
    await currentWorkspace();
    need(same(await workspacePins(),saved.record.workspacePins),'MCP_DATASET_REVIEWED_WORKSPACE_CHANGED');
    await workspaceConfiguration(manifest.workspace,{configuration:saved.cfg});
  }
  async function unfinishedIsUnattempted(session){
    for(const name of ['pages','evidence']){
      const path=join(session,name);
      if(!await exists(path))continue;
      await directory(path);
      // The original constructor writes these directories empty, then writes
      // session.json last. Any content needs its original recovery, not a new ID.
      need((await readdir(path)).length===0,'MCP_DATASET_INITIALIZATION_HAS_NATIVE_WORK');
    }
  }
  async function prepare(args){
    need(!isClosed(),'MCP_NATIVE_WORKSPACE_CLOSING');
    const key=identifier(args.acquisitionId),current=await currentWorkspace(),src=await source(args.sourceId);
    const selected=selection(src.dataset,args.query,manifest.route),cap=limits(args),op=execution(current.config).op;
    need(op.method==='GET'&&new URL(op.url).search===''&&new URL(op.url).origin===manifest.route.origin&&
      new URL(op.url).pathname===manifest.route.pathname&&same(op.headers??{},manifest.route.headers),
      'MCP_DATASET_WORKSPACE_ROUTE_MISMATCH');
    const specification={sourceId:args.sourceId,query:selected.query,maxAtomic:args.maxAtomic??null,limits:cap};
    if(args.maxAtomic!==undefined)atomic(args.maxAtomic);
    await roots(true);
    const path=join(root,'acquisitions',key);
    const lease=await acquireInitialization(path,{python:current.config.operator.python,resume:true});
    try{
      const prior=await request(args.acquisitionId,{optional:true});
      if(prior){
        need(same(prior.record.specification,specification),'MCP_DATASET_ACQUISITION_CONFLICT');
        if(prior.pointer)return {...await view(prior),review:prior.record.selected,reused:true};
      }
      const maximum=specification.maxAtomic??op.expect.maxAtomic;
      need(BigInt(cap.maxTotalAtomic)>=BigInt(maximum),'MCP_DATASET_TOTAL_BELOW_PAGE_CAP');
      const cfg=structuredClone(current.config);
      delete cfg.responseFile;delete cfg.bodyCaptureTimeoutMs;
      cfg.captureBody=false;
      cfg.operation={...op,intentId:'mcp-dataset:'+key,url:selected.url,expect:{...op.expect,maxAtomic:maximum}};
      await workspaceConfiguration(manifest.workspace,{configuration:cfg});
      const raw=prior?await bytes(join(path,'buyer.json'),65536):encoded(cfg);
      need(raw.length<=65536,'MCP_NATIVE_CONFIG_TOO_LARGE');
      await retain(join(path,'buyer.json'),raw,{resume:true});
      const record=await retainRecord(join(path,'request.json'),prior?.record??{
        schema:SCHEMA,acquisitionId:args.acquisitionId,createdAt:new Date().toISOString(),specification,
        requestSha256:sha(canonical(specification)),configSha256:sha(raw),
        configurationSha256:sha(canonical(parse(raw))),datasetSha256:src.record.datasetSha256,
        selected,workspacePins:await workspacePins(),
      },{resume:true});
      need(same(await workspacePins(),record.workspacePins),'MCP_DATASET_REVIEWED_WORKSPACE_CHANGED');
      for(const name of ['sessions','initializations'])await directory(join(path,name),{create:true});
      const attempts=(await readdir(join(path,'initializations'))).filter(n=>/^[0-9]{6}\.json$/.test(n)).sort();
      need(attempts.every((name,index)=>name===String(index+1).padStart(6,'0')+'.json'),
        'MCP_DATASET_INITIALIZATION_CHANGED');
      let accepted=null;
      for(const name of attempts){
        const attempt=await json(join(path,'initializations',name),8192);
        const sequence=name.slice(0,6),session=join(path,'sessions',sequence);
        need(attempt.schema===SCHEMA&&attempt.initialization===sequence&&attempt.session===session&&
          attempt.configSha256===record.configSha256,'MCP_DATASET_INITIALIZATION_CHANGED');
        if(await exists(join(session,'session.json'))){
          need(accepted===null,'MCP_DATASET_MULTIPLE_NATIVE_SESSIONS');
          accepted={sequence,session,report:await inspectDatasetSession(session)};
        }else await unfinishedIsUnattempted(session);
      }
      if(accepted===null){
        need(attempts.length<999999,'MCP_DATASET_INITIALIZATION_LIMIT');
        const sequence=String(attempts.length+1).padStart(6,'0'),session=join(path,'sessions',sequence);
        await retainRecord(join(path,'initializations',sequence+'.json'),{
          schema:SCHEMA,initialization:sequence,session,configSha256:record.configSha256,
          createdAt:new Date().toISOString(),authority:'ORIGINAL_SF88_DATASET_CONSTRUCTOR',
        });
        accepted={sequence,session,report:await createDatasetSession({
          directory:session,configPath:join(path,'buyer.json'),...cap,expectedSnapshot:selected.snapshot})};
      }
      const sessionRaw=await bytes(join(accepted.session,'session.json'),262144),definition=parse(sessionRaw);
      need(accepted.report.status!=='RUNNING'&&accepted.report.sessionId===parse(raw).operation.intentId&&
        accepted.report.configurationSha256===record.configurationSha256&&
        same(definition.config,parse(raw))&&same(definition.limits,cap)&&
        definition.expectedSnapshot===selected.snapshot,'MCP_DATASET_SESSION_BINDING_CHANGED');
      await retainRecord(join(path,'binding.json'),{
        schema:SCHEMA,acquisitionId:args.acquisitionId,initialization:accepted.sequence,
        sessionId:definition.config.operation.intentId,configurationSha256:definition.configurationSha256,
        sessionSha256:sha(sessionRaw),
      },{resume:true});
      const saved=await completed(args.acquisitionId);
      return {schema:SCHEMA,acquisitionId:args.acquisitionId,
        review:{...selected,limits:cap,perPageCapAtomic:definition.config.operation.expect.maxAtomic,
          plannedPageCapAtomic:(BigInt(definition.config.operation.expect.maxAtomic)*BigInt(cap.maxPages)).toString(),
          authority:'EACH_PAGE_REQUIRES_ORIGINAL_BUYER_APPROVAL'},
        report:reportView(saved,accepted.report),reused:false,
        retainedIncompleteInitializations:attempts.length-(attempts.includes(accepted.sequence+'.json')?1:0)};
    }finally{await lease.close();}
  }
  async function delivery(saved){
    const record=await json(join(saved.path,'delivery.json')),room=join(saved.path,'data-room');
    need(record.schema===SCHEMA&&record.acquisitionId===saved.record.acquisitionId&&
      record.sessionId===saved.pointer.sessionId&&record.sessionSha256===saved.pointer.sessionSha256&&
      record.configurationSha256===saved.record.configurationSha256&&record.room===room&&
      HASH.test(record.sourceBindingSha256??'')&&same(Object.keys(record.files??{}).sort(),Object.keys(files).sort()),
      'MCP_DATASET_DELIVERY_CHANGED');
    const marker=await json(join(saved.path,'.data-room.sf88-source.json'),8192);
    need(marker.schema==='stellar-forge.sf88.native-delivery-source.v1'&&marker.destination===room&&
      marker.sourceDirectory===saved.session&&marker.sourceBindingSha256===record.sourceBindingSha256,
      'MCP_DATASET_NATIVE_SOURCE_BINDING_CHANGED');
    for(const [name,file] of Object.entries(record.files)){
      need(file.destination===join(room,name)&&file.contentType===files[name]&&
        integer(file.bytes,0,256*1024*1024)&&HASH.test(file.sha256??''),'MCP_DATASET_DELIVERY_CHANGED');
    }
    const raw=await bytes(join(room,'manifest.json'),4*1024*1024),native=parse(raw);
    need(sha(raw)===record.files['manifest.json'].sha256&&raw.length===record.files['manifest.json'].bytes&&
      native.schema==='stellar-forge.buyer-delivery-manifest.v1'&&native.dataset.snapshot===saved.record.selected.snapshot&&
      same(native.dataset.projectedFields,saved.record.selected.fields)&&
      integer(native.dataset.rows,0,saved.record.specification.limits.maxRows)&&
      native.dataset.rows===record.rows&&native.chainDigest===record.chainDigest,
      'MCP_DATASET_NATIVE_MANIFEST_CHANGED');
    for(const name of Object.keys(files).filter(name=>name!=='manifest.json')){
      const file=record.files[name];
      need(same(native.outputs[name],{sha256:file.sha256,bytes:file.bytes}),'MCP_DATASET_NATIVE_MANIFEST_CHANGED');
    }
    return {record,native};
  }
  function deliveryView(value){
    const {record,native}=value;
    return {dataset:native.dataset,sourceBindingSha256:record.sourceBindingSha256,
      chainDigest:record.chainDigest,files:Object.entries(record.files).map(([filename,file])=>({
        filename,contentType:file.contentType,bytes:file.bytes,sha256:file.sha256})),
      paymentStatus:native.paymentStatus,
      accountingAction:{action:'dataset-accounting',acquisitionId:record.acquisitionId}};
  }
  async function deliver(saved){
    const current=await currentWorkspace();
    const lease=await acquireInitialization(saved.path,{python:current.config.operator.python,resume:true});
    try{
      if(await exists(join(saved.path,'delivery.json'))){
        const delivered=await delivery(saved);
        for(const file of Object.values(delivered.record.files))await readSavedFile(file,{maxBytes:1});
        return {schema:SCHEMA,acquisitionId:saved.record.acquisitionId,status:'REOPENED',
          delivery:deliveryView(delivered),appendedPages:0};
      }
      const report=await inspectDatasetSession(saved.session);
      reportView(saved,report);
      need(report.status==='COMPLETE','DATASET_COMPLETE_SESSION_REQUIRED');
      const room=join(saved.path,'data-room'),result=await deliverDatasetSession(saved.session,room);
      need(result.schema==='stellar-forge.sf88.dataset-delivery.v1'&&result.sourceDirectory===saved.session&&
        result.directory===room&&result.nativeStatus.complete===true&&result.nativeStatus.finalized===true&&
        result.nativeStatus.rows===report.totalRows&&result.nativeStatus.snapshot===saved.record.selected.snapshot,
        'MCP_DATASET_NATIVE_DELIVERY_INVALID');
      const output={};
      for(const [name,contentType] of Object.entries(files)){
        const file=result.outputs[name];
        need(file?.path===join(room,name)&&integer(file.bytes,0,256*1024*1024)&&HASH.test(file.sha256??''),
          'MCP_DATASET_NATIVE_DELIVERY_INVALID');
        output[name]={destination:file.path,contentType,bytes:file.bytes,sha256:file.sha256};
      }
      await retainRecord(join(saved.path,'delivery.json'),{
        schema:SCHEMA,acquisitionId:saved.record.acquisitionId,sessionId:saved.pointer.sessionId,
        sessionSha256:saved.pointer.sessionSha256,configurationSha256:saved.record.configurationSha256,
        room,sourceBindingSha256:result.sourceBindingSha256,rows:result.nativeStatus.rows,
        chainDigest:result.nativeStatus.lastRecordDigest,files:output,createdAt:new Date().toISOString(),
        authority:'ORIGINAL_SF88_COMPLETE_ACQUISITION_AND_SF100_DELIVERY',
      });
      return {schema:SCHEMA,acquisitionId:saved.record.acquisitionId,status:'SAVED',
        delivery:deliveryView(await delivery(saved)),appendedPages:result.appendedPages,resumed:result.resumed};
    }finally{await lease.close();}
  }
  async function rows(saved,args){
    const delivered=await delivery(saved),file=delivered.record.files['dataset.jsonl'];
    const {offset,limit}=page(args),maxBytes=args.maxBytes??32768,total=delivered.record.rows;
    need(offset<=total&&integer(maxBytes,2,65536),'MCP_DATASET_ROW_RANGE_INVALID');
    // One existing reader owns same-descriptor SHA verification and its stamp
    // cache. Scanning later previews never rehashes the complete unchanged file.
    await readSavedFile(file,{maxBytes:1});
    const key=file.destination+':'+file.sha256;
    if(!rowIndexes.has(key)){
      rowIndexes.set(key,{points:[0],last:{row:0,byte:0}});
      if(rowIndexes.size>16)rowIndexes.delete(rowIndexes.keys().next().value);
    }
    const index=rowIndexes.get(key),point=Math.min(Math.floor(offset/128),index.points.length-1);
    let row=point*128,cursor=index.points[point];
    if(index.last.row<=offset&&index.last.row>=row){row=index.last.row;cursor=index.last.byte;}
    let readAt=cursor,block=Buffer.alloc(0),position=0;
    const remember=()=>{
      if(row%128===0){
        const n=row/128;
        if(n===index.points.length)index.points.push(cursor);
        else if(n<index.points.length)need(index.points[n]===cursor,'MCP_DATASET_ROW_INDEX_CHANGED');
      }
      index.last={row,byte:cursor};
    };
    async function nextLine(){
      const start=cursor,parts=[];let length=0;
      while(true){
        if(position===block.length){
          if(readAt===file.bytes){
            need(length===0,'MCP_DATASET_TYPED_FILE_CHANGED');return null;
          }
          const result=await readSavedFile(file,{byteOffset:readAt,maxBytes:65536});
          block=Buffer.from(result.data,'base64');position=0;readAt+=block.length;
          need(block.length>0,'MCP_DATASET_TYPED_FILE_CHANGED');
        }
        const newline=block.indexOf(10,position),end=newline<0?block.length:newline;
        const part=block.subarray(position,end);parts.push(part);length+=part.length;
        // SF100 consumes <=2 MiB pages; UTF-8 JSON escaping is bounded as well.
        need(length<=16*1024*1024,'MCP_DATASET_ROW_TOO_LARGE');
        cursor+=end-position+(newline<0?0:1);position=end+(newline<0?0:1);
        if(newline>=0)return {start,raw:parts.length===1?parts[0]:Buffer.concat(parts,length)};
      }
    }
    while(row<offset){
      need(await nextLine(),'MCP_DATASET_TYPED_FILE_CHANGED');row++;remember();
    }
    const result=[];let used=2,oversizedRow=null;
    while(row<total&&result.length<limit){
      const line=await nextLine();need(line,'MCP_DATASET_TYPED_FILE_CHANGED');
      const required=line.raw.length+(result.length?1:0);
      if(used+required>maxBytes){
        index.last={row,byte:line.start};
        oversizedRow={offset:row,byteOffset:line.start,rowBytes:line.raw.length,
          minimumArrayBytes:line.raw.length+2,
          readAction:{action:'dataset-read',acquisitionId:saved.record.acquisitionId,
            filename:'dataset.jsonl',byteOffset:line.start,maxBytes:65536}};
        break;
      }
      const value=parse(line.raw);
      need(object(value)&&same(Object.keys(value),saved.record.selected.fields),'MCP_DATASET_TYPED_FILE_CHANGED');
      result.push(value);used+=required;row++;remember();
    }
    if(row===total)need(cursor===file.bytes,'MCP_DATASET_TYPED_FILE_CHANGED');
    return {schema:SCHEMA,acquisitionId:saved.record.acquisitionId,dataset:delivered.native.dataset,
      columns:saved.record.selected.columns,rows:result,sha256:file.sha256,verifiedSavedFile:true,
      range:{offset,limit,total,nextOffset:offset+result.length<total?offset+result.length:null,
        maxBytes,returnedRowBytes:used},...(oversizedRow?{nextRow:oversizedRow}:{}),
      retry:'NO_AUTOMATIC_RETRY'};
  }
  async function history(args,sources=false){
    const limit=args.limit??25;
    need(integer(limit,1,100)&&(args.cursor===undefined||HASH.test(args.cursor)),'MCP_DATASET_PAGE_INVALID');
    if(!await roots())return {schema:SCHEMA,records:[],nextCursor:null,total:0};
    const where=join(root,sources?'sources':'acquisitions');
    const keys=(await readdir(where)).filter(name=>sources?/^[a-f0-9]{64}\.json$/.test(name):HASH.test(name))
      .map(name=>sources?name.slice(0,-5):name).sort();
    const start=args.cursor===undefined?0:keys.indexOf(args.cursor)+1;
    need(args.cursor===undefined||start>0,'MCP_DATASET_HISTORY_CURSOR_UNKNOWN');
    const selected=keys.slice(start,start+limit),records=[];
    for(const key of selected){
      if(sources)records.push((await source(key)).record);
      else{
        if(!await exists(join(where,key,'request.json'))){
          records.push({acquisitionKey:key,acquisitionId:null,status:'INITIALIZATION_NOT_RETAINED',
            executionInspected:false,hasDelivery:false,
            next:'Repeat the original dataset-prepare using its same saved acquisitionId and query.'});
          continue;
        }
        const record=await json(join(where,key,'request.json'));
        const saved=await request(record.acquisitionId);
        records.push({acquisitionId:record.acquisitionId,createdAt:record.createdAt,
          specification:record.specification,query:record.selected,
          sessionId:saved.pointer?.sessionId??null,
          status:saved.pointer?'SESSION_RETAINED':'INITIALIZATION_INCOMPLETE',
          executionInspected:false,hasDelivery:await exists(join(saved.path,'delivery.json'))});
      }
    }
    return {schema:SCHEMA,records,total:keys.length,
      nextCursor:start+selected.length<keys.length?selected.at(-1):null};
  }
  return {
    register:path=>track(register(path)),
    /** Host-only source handoff: callers supply a saved ID, never another path. */
    async completedDataset(acquisitionId){
      need(!isClosed(),'MCP_NATIVE_WORKSPACE_CLOSING');
      const saved=await completed(acquisitionId),report=await inspectDatasetSession(saved.session);
      reportView(saved,report);
      need(report.status==='COMPLETE','DATASET_COMPLETE_SESSION_REQUIRED');
      const delivered=await delivery(saved);
      for(const file of Object.values(delivered.record.files))await readSavedFile(file,{maxBytes:1});
      return {acquisitionId,session:saved.session,room:delivered.record.room,
        sessionId:saved.pointer.sessionId,configurationSha256:saved.record.configurationSha256,
        sourceId:saved.record.specification.sourceId,sourceBindingSha256:delivered.record.sourceBindingSha256,
        snapshot:saved.record.selected.snapshot,query:saved.record.selected.query,
        files:Object.fromEntries(Object.entries(delivered.record.files).map(([name,file])=>[
          name,{path:file.destination,sha256:file.sha256,bytes:file.bytes}]))};
    },
    async call(args,context={}){
      need(!isClosed(),'MCP_NATIVE_WORKSPACE_CLOSING');
      need(object(args)&&Object.hasOwn(fields,args.action)&&Object.keys(args).every(key=>
        key==='action'||fields[args.action].includes(key)),'MCP_DATASET_ARGUMENTS_INVALID');
      const action=args.action;
      if(action==='dataset-sources')return history(args,true);
      if(action==='dataset-history')return history(args);
      if(action==='dataset-describe'){
        const src=await source(args.sourceId);
        return {schema:SCHEMA,source:src.record,dataset:src.dataset,
          limits:{maxPages:MAX_DATASET_PAGES,maxRows:1000000,maxPageBytes:MAX_DATASET_PAGE_BYTES},
          authority:'ORIGINAL_REGISTERED_DESCRIPTION; ACTUAL_NATIVE_PAGE_CONTRACT_CONTROLS_ACQUISITION'};
      }
      const key=identifier(args.acquisitionId);
      if(action==='dataset-prepare'){
        const fingerprint=sha(canonical(args));
        if(preparing.has(key)){
          const current=preparing.get(key);
          need(current.fingerprint===fingerprint,'MCP_DATASET_ACQUISITION_CONFLICT');return current.promise;
        }
        const promise=prepare(args);preparing.set(key,{fingerprint,promise});
        try{return await promise;}finally{preparing.delete(key);}
      }
      const saved=await completed(args.acquisitionId),owner='dataset:'+key;
      if(['dataset-status','dataset-run','dataset-cancel','dataset-recover'].includes(action)){
        need(page(args).offset<=saved.definition.limits.maxPages,'MCP_DATASET_PAGE_INVALID');
      }
      if(action==='dataset-status')return view(saved,args);
      if(action==='dataset-read'){
        need(Object.hasOwn(files,args.filename),'MCP_DATASET_FILENAME_REQUIRED');
        const value=await delivery(saved);
        return {schema:SCHEMA,acquisitionId:args.acquisitionId,filename:args.filename,
          result:await readSavedFile(value.record.files[args.filename],args),retry:'NO_AUTOMATIC_RETRY'};
      }
      if(action==='dataset-rows')return rows(saved,args);
      if(action==='dataset-cancel'){
        const cancelled=await cancelOwned(owner);
        return {...await view(saved,args),cancelRequested:cancelled,
          note:'Cancels this host’s active native acquisition/finalization. Completed pages remain; attempted pages are never automatically repeated. Offline SF100 delivery is retained and drained on shutdown.'};
      }
      if(action==='dataset-accounting')return {schema:SCHEMA,acquisitionId:args.acquisitionId,
        accounting:await accountDatasetSession(saved.session,{...page(args),workspace:manifest.workspace})};
      if(action==='dataset-run'||action==='dataset-finalize'){
        const range=page(args),kind=action==='dataset-finalize'
          ?action+':'+range.offset+':'+range.limit:action;
        const outcome=await runOwned(owner,kind,context,async signal=>{
          if(action==='dataset-run'){
            const before=await inspectDatasetSession(saved.session);
            reportView(saved,before);
            if(before.status!=='READY')return {started:false,nativeStatus:before.status,
              exitCode:null,signal:null,error:null,interrupted:signal.aborted};
            await newRunPreflight(saved);
          }
          else{
            // Retained financial attempts use the original post-purchase
            // finalizer even if new-acquisition review pins have since changed.
            await currentWorkspace();
            await accountDatasetSession(saved.session,{...range,workspace:manifest.workspace});
          }
          const command=[action==='dataset-run'?'run':'finalize','--session',saved.session,
            '--workspace',manifest.workspace];
          if(action==='dataset-finalize')command.push('--offset',String(range.offset),'--limit',String(range.limit));
          return originalCommand(command,signal);
        });
        return action==='dataset-run'?{...await view(saved,args),execution:outcome}:
          {schema:SCHEMA,acquisitionId:args.acquisitionId,execution:outcome,
            accounting:await accountDatasetSession(saved.session,{...range,workspace:manifest.workspace})};
      }
      need(!isActive(owner),'MCP_NATIVE_OPERATION_ACTIVE');
      if(action==='dataset-recover')return track((async()=>({
        schema:SCHEMA,acquisitionId:args.acquisitionId,
        report:reportView(saved,await recoverDatasetSession(saved.session),args) }))());
      return track(deliver(saved));
    },
    async close(){await Promise.allSettled([...preparing.values()].map(value=>value.promise).concat([...offline]));},
  };
}

