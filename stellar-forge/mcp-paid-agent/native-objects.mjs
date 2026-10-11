// SPDX-License-Identifier: MIT
// MCP application custody around the ORIGINAL SF88 object session and CLI.
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import {open, readdir, lstat} from 'node:fs/promises';
import {join, basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {need, execution, InputError} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/config.mjs';
import {createObjectSession, inspectObjectSession, recoverObjectSession,
  assembleObjectSession, accountObjectSession} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-session.mjs';
import {selectObjectDescriptionBytes} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-description.mjs';
import {initializationDirectory as directory, initializationBytes as bytes,
  optionalInitializationBytes as optionalBytes, retainInitializationFile as retain,
  retainInitializationRecord as retainRecord, initializationJson as encoded,
  acquireInitialization} from '../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/initialization.mjs';
import {createSavedFileReader} from './native-file.mjs';

const SCHEMA = 'stellar-forge.mcp-native-object.v1';
const SOURCE = 'stellar-forge.mcp-native-object-source.v1';
const HASH = /^[a-f0-9]{64}$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = code => {throw new InputError(code);};
const objectCli = fileURLToPath(new URL('../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/object-cli.mjs',import.meta.url));
const codeOf = e => /^[A-Z0-9_]{1,120}$/.test(e?.code ?? '') ? e.code : 'MCP_NATIVE_OBJECT_OPERATION_FAILED';
const identifier = value => {
  need(typeof value === 'string' && /^[A-Za-z0-9._:-]{1,128}$/.test(value), 'MCP_OBJECT_ACQUISITION_ID_REQUIRED');
  return sha(value);
};
function parse(raw) {
  try {return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));}
  catch {fail('MCP_OBJECT_JSON_INVALID');}
}
const json = async (path,limit=131072) => parse(await bytes(path,limit));
async function exists(path) {
  try {await lstat(path);return true;}
  catch (e) {if(e.code==='ENOENT')return false;throw e;}
}
function page(args, maximum=100) {
  const offset=args.offset??0,limit=args.limit??25;
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=maximum,
    'MCP_OBJECT_PAGE_INVALID');
  return {offset,limit};
}
function atomic(value) {
  need(typeof value==='string'&&/^[1-9][0-9]{0,38}$/.test(value)&&
    BigInt(value)<=170141183460469231731687303715884105727n,'MCP_OBJECT_ATOMIC_LIMIT_INVALID');
  return value;
}
function reportView(report,args={}) {
  const {offset,limit}=page(args);
  need(offset<=report.chunkCount,'MCP_OBJECT_PAGE_INVALID');
  const chunks=report.chunks.slice(offset,offset+limit);
  const {chunks:ignored,assemblies,...rest}=report;
  return {...rest,chunks,assemblyCount:assemblies.length,
    chunkRange:{offset,limit,total:report.chunkCount,
      nextOffset:offset+chunks.length<report.chunkCount?offset+chunks.length:null}};
}
const fields = Object.freeze({
  'object-sources':['limit','cursor'],
  'object-list':['sourceId','offset','limit'],
  'object-prepare':['acquisitionId','sourceId','objectId','chunkBytes','maxAtomic','maxTotalAtomic'],
  'object-history':['limit','cursor'],
  'object-status':['acquisitionId','offset','limit'],
  'object-run':['acquisitionId','offset','limit'],
  'object-cancel':['acquisitionId','offset','limit'],
  'object-recover':['acquisitionId','offset','limit'],
  'object-assemble':['acquisitionId','offset','limit'],
  'object-read':['acquisitionId','byteOffset','maxBytes'],
  'object-accounting':['acquisitionId','offset','limit'],
  'object-finalize':['acquisitionId','offset','limit'],
});
export const nativeObjectActions = Object.freeze(Object.keys(fields));

// Keep approval, signer loading, queue attempts and finalization in their original child.
function originalCommand(arguments_,signal) {
  return new Promise((resolve,reject)=>{
    if(signal.aborted){reject(new InputError('OPERATOR_ABORTED'));return;}
    let child,timer,finished=false,stderr='';
    const done=(error,value)=>{
      if(finished)return;finished=true;clearTimeout(timer);signal.removeEventListener('abort',abort);
      error?reject(error):resolve(value);
    };
    const abort=()=>{
      if(child&&child.exitCode===null&&child.signalCode===null){
        child.kill('SIGTERM');timer??=setTimeout(()=>child.kill('SIGKILL'),10000);
      }
    };
    try {child=spawn(process.execPath,[objectCli,...arguments_],{
      shell:false,detached:false,env:process.env,stdio:['ignore','pipe','pipe']});}
    catch {done(new InputError('MCP_NATIVE_EXECUTOR_START_FAILED'));return;}
    child.once('error',()=>done(new InputError('MCP_NATIVE_EXECUTOR_START_FAILED')));
    // Native status is read from the original session; never retain another result engine.
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

/** The host supplies the SAME native workspace and approval-terminal ownership gate. */
export function createNativeObjects({manifest,currentWorkspace,runOwned,cancelOwned,isActive,isClosed}) {
  const root=join(manifest.directory,'objects'),readSavedFile=createSavedFileReader();
  const preparing=new Set();
  async function roots(create=false) {
    if(!create&&!await exists(root))return false;
    await directory(root,{create});
    for(const name of ['sources','acquisitions'])await directory(join(root,name),{create});
    return true;
  }
  function eligible(raw) {
    const description=parse(raw);
    need(description?.schema==='stellar-forge.s3-description.v1'&&Array.isArray(description.objects),
      'OBJECT_ORIGINAL_S3_DESCRIPTION_REQUIRED');
    const candidates=description.objects.filter(item=>object(item)&&item.path===manifest.route.pathname);
    need(manifest.route.method==='GET'&&candidates.length>0,'MCP_OBJECT_WORKSPACE_ROUTE_MISMATCH');
    return candidates.map(item=>({item,selected:selectObjectDescriptionBytes(raw,{objectId:item.id})}));
  }
  async function source(sourceId) {
    need(typeof sourceId==='string'&&HASH.test(sourceId),'MCP_OBJECT_SOURCE_ID_REQUIRED');
    await roots();
    const raw=await bytes(join(root,'sources',sourceId+'.description.json'),8*1024*1024);
    const record=await json(join(root,'sources',sourceId+'.json'));
    need(sha(raw)===sourceId&&record.schema===SOURCE&&record.sourceId===sourceId&&
      record.descriptionSha256===sourceId&&record.bytes===raw.length&&
      same(record.route,manifest.route),'MCP_OBJECT_SOURCE_CHANGED');
    const objects=eligible(raw);
    need(same(record.objectIds,objects.map(row=>row.item.id)),'MCP_OBJECT_SOURCE_CHANGED');
    return {raw,record,objects};
  }
  async function register(descriptionPath) {
    need(!isClosed(),'MCP_NATIVE_WORKSPACE_CLOSING');
    const current=await currentWorkspace(),op=execution(current.config).op;
    need(op.method==='GET'&&new URL(op.url).search===''&&op.bodyFile===undefined,
      'MCP_OBJECT_WORKSPACE_ROUTE_MISMATCH');
    const handle=await open(descriptionPath,constants.O_RDONLY|constants.O_NOFOLLOW|(constants.O_NONBLOCK??0));
    let raw;
    try{
      const info=await handle.stat();need(info.isFile()&&info.size<=8*1024*1024,'OBJECT_DESCRIPTION_FILE_INVALID');
      raw=await handle.readFile();need(raw.length<=8*1024*1024,'OBJECT_DESCRIPTION_BYTE_LIMIT');
    }finally{await handle.close();}
    const objects=eligible(raw),sourceId=sha(raw);
    await roots(true);
    await retain(join(root,'sources',sourceId+'.description.json'),raw,{resume:true});
    const record=await retainRecord(join(root,'sources',sourceId+'.json'),{
      schema:SOURCE,sourceId,descriptionSha256:sourceId,bytes:raw.length,
      registeredAt:new Date().toISOString(),filename:basename(descriptionPath),route:manifest.route,
      objectIds:objects.map(row=>row.item.id),
    },{resume:true,ignore:['registeredAt','filename']});
    return {schema:SCHEMA,status:'OBJECT_SOURCE_REGISTERED',source:record,
      objects:objects.map(({item})=>item),authority:'OPERATOR_REGISTERED_ORIGINAL_S3_DESCRIPTION'};
  }
  async function request(acquisitionId,{optional=false}={}) {
    const key=identifier(acquisitionId),path=join(root,'acquisitions',key);
    if(optional&&!await exists(join(path,'request.json')))return null;
    await directory(path);
    const record=await json(join(path,'request.json'));
    need(record.schema===SCHEMA&&record.acquisitionId===acquisitionId&&
      record.requestSha256===sha(encoded(record.specification)),'MCP_OBJECT_ACQUISITION_CHANGED');
    const cfgRaw=await bytes(join(path,'buyer.json'),65536);
    need(sha(cfgRaw)===record.configSha256,'MCP_OBJECT_CONFIG_CHANGED');
    const source_=await source(record.specification.sourceId);
    const selected=selectObjectDescriptionBytes(source_.raw,{
      objectId:record.specification.objectId,chunkBytes:record.specification.chunkBytes??undefined});
    need(same(selected,record.selected),'MCP_OBJECT_SELECTION_CHANGED');
    const pointerRaw=await optionalBytes(join(path,'binding.json'));
    const pointer=pointerRaw===null?null:parse(pointerRaw);
    let definition=null;
    if(pointer){
      need(pointer.schema===SCHEMA&&pointer.acquisitionId===acquisitionId&&
        /^[0-9]{6}$/.test(pointer.initialization)&&HASH.test(pointer.sessionSha256),
        'MCP_OBJECT_SESSION_BINDING_CHANGED');
      const session=join(path,'sessions',pointer.initialization);
      const sessionRaw=await bytes(join(session,'session.json'));
      need(sha(sessionRaw)===pointer.sessionSha256,'MCP_OBJECT_SESSION_BINDING_CHANGED');
      definition=parse(sessionRaw);
      need(definition.directory===session&&definition.sessionId===pointer.sessionId&&
        definition.workspace===manifest.workspace&&definition.configurationSha256===record.configSha256&&
        same(definition.selection,selected.selection)&&definition.bytes===selected.bytes&&
        definition.chunkBytes===selected.chunkBytes&&definition.expectedSnapshot===selected.expectedSnapshot&&
        definition.expectedSha256===selected.expectedSha256&&
        definition.limits.maxTotalAtomic===record.specification.maxTotalAtomic,'MCP_OBJECT_SESSION_BINDING_CHANGED');
    }
    return {path,key,record,pointer,definition,session:definition?.directory??null};
  }
  async function completed(acquisitionId) {
    const saved=await request(acquisitionId);
    need(saved.pointer,'MCP_OBJECT_INITIALIZATION_INCOMPLETE');return saved;
  }
  async function unfinishedIsUnattempted(session) {
    // A constructor interrupted before its final native manifest has no callable
    // object session. Preserve every file; never abandon a queue with an attempt.
    const jobs=join(session,'inbox','jobs');
    if(!await exists(jobs))return;
    await directory(jobs);
    for(const name of await readdir(jobs)){
      if(name.startsWith('.'))continue;
      need(HASH.test(name),'MCP_OBJECT_INITIALIZATION_REQUIRES_REVIEW');
      await directory(join(jobs,name));
      need(!await exists(join(jobs,name,'attempt.json')),'MCP_OBJECT_INITIALIZATION_HAS_NATIVE_ATTEMPT');
    }
  }
  async function prepare(args) {
    need(!isClosed(),'MCP_NATIVE_WORKSPACE_CLOSING');
    const key=identifier(args.acquisitionId),current=await currentWorkspace();
    const source_=await source(args.sourceId);
    const selected=selectObjectDescriptionBytes(source_.raw,{objectId:args.objectId,chunkBytes:args.chunkBytes});
    const op=execution(current.config).op;
    need(op.method==='GET'&&new URL(op.url).search===''&&new URL(op.url).pathname===selected.selection.path&&
      new URL(op.url).origin===manifest.route.origin,'MCP_OBJECT_WORKSPACE_ROUTE_MISMATCH');
    const specification={sourceId:args.sourceId,objectId:args.objectId,chunkBytes:args.chunkBytes??null,
      maxAtomic:args.maxAtomic??null,maxTotalAtomic:atomic(args.maxTotalAtomic)};
    if(args.maxAtomic!==undefined)atomic(args.maxAtomic);
    await roots(true);
    const path=join(root,'acquisitions',key);
    const lease=await acquireInitialization(path,{python:current.config.operator.python,resume:true});
    try {
      const prior=await request(args.acquisitionId,{optional:true});
      if(prior){
        need(same(prior.record.specification,specification),'MCP_OBJECT_ACQUISITION_CONFLICT');
        if(prior.pointer)return {schema:SCHEMA,acquisitionId:args.acquisitionId,
          report:reportView(await inspectObjectSession(prior.session)),reused:true};
      }
      const maximum=specification.maxAtomic??op.expect.maxAtomic;
      need(BigInt(maximum)<=BigInt(op.expect.maxAtomic)&&
        BigInt(maximum)<=BigInt(current.manifest.signer.maxAtomic),'MCP_NATIVE_SPEND_CAP_EXCEEDED');
      const cfg=structuredClone(current.config);
      delete cfg.responseFile;delete cfg.bodyCaptureTimeoutMs;
      cfg.captureBody=false;cfg.operation={...op,intentId:'mcp-object:'+key,expect:{...op.expect,maxAtomic:maximum}};
      execution(cfg);
      const cfgRaw=encoded(cfg);need(cfgRaw.length<=65536,'MCP_NATIVE_CONFIG_TOO_LARGE');
      // On resume the exact retained configuration remains authoritative; a
      // lowered current cap is checked again by original native execution.
      const savedConfig=prior?await bytes(join(path,'buyer.json'),65536):cfgRaw;
      await retain(join(path,'buyer.json'),savedConfig,{resume:true});
      const record=await retainRecord(join(path,'request.json'),prior?.record??{
        schema:SCHEMA,acquisitionId:args.acquisitionId,createdAt:new Date().toISOString(),specification,
        requestSha256:sha(encoded(specification)),configSha256:sha(savedConfig),selected,
      },{resume:true});
      for(const name of ['sessions','initializations'])await directory(join(path,name),{create:true});
      const attempts=(await readdir(join(path,'initializations'))).filter(name=>/^[0-9]{6}\.json$/.test(name)).sort();
      let accepted=null;
      for(const name of attempts){
        const attempt=await json(join(path,'initializations',name));
        const sequence=name.slice(0,6),session=join(path,'sessions',sequence);
        need(attempt.schema===SCHEMA&&attempt.initialization===sequence&&attempt.session===session&&
          attempt.configSha256===record.configSha256,'MCP_OBJECT_INITIALIZATION_CHANGED');
        if(await exists(join(session,'session.json'))){
          need(accepted===null,'MCP_OBJECT_MULTIPLE_NATIVE_SESSIONS');
          accepted={sequence,session,report:await inspectObjectSession(session)};
        }else await unfinishedIsUnattempted(session);
      }
      if(accepted===null){
        need(attempts.length<999999,'MCP_OBJECT_INITIALIZATION_LIMIT');
        const sequence=String(attempts.length+1).padStart(6,'0'),session=join(path,'sessions',sequence);
        await retainRecord(join(path,'initializations',sequence+'.json'),{
          schema:SCHEMA,initialization:sequence,session,configSha256:record.configSha256,
          createdAt:new Date().toISOString(),authority:'ORIGINAL_SF88_OBJECT_CONSTRUCTOR',
        });
        const report=await createObjectSession({directory:session,configPath:join(path,'buyer.json'),
          workspace:manifest.workspace,maxTotalAtomic:specification.maxTotalAtomic,...selected});
        accepted={sequence,session,report};
      }
      const raw=await bytes(join(accepted.session,'session.json'));
      need(accepted.report.configurationSha256===record.configSha256&&
        accepted.report.workspace===manifest.workspace&&same(accepted.report.selection,selected.selection)&&
        accepted.report.bytes===selected.bytes&&accepted.report.chunkBytes===selected.chunkBytes&&
        accepted.report.maxTotalAtomic===specification.maxTotalAtomic,'MCP_OBJECT_SESSION_BINDING_CHANGED');
      await retainRecord(join(path,'binding.json'),{schema:SCHEMA,acquisitionId:args.acquisitionId,
        initialization:accepted.sequence,sessionId:accepted.report.sessionId,sessionSha256:sha(raw)},{resume:true});
      await completed(args.acquisitionId);
      return {schema:SCHEMA,acquisitionId:args.acquisitionId,report:reportView(accepted.report),
        retainedIncompleteInitializations:attempts.length-(attempts.includes(accepted.sequence+'.json')?1:0)};
    }finally{await lease.close();}
  }
  async function delivery(saved) {
    const record=await json(join(saved.path,'delivery.json'));
    const destination=join(saved.path,'complete.bin');
    need(record.schema===SCHEMA&&record.acquisitionId===saved.record.acquisitionId&&
      record.sessionId===saved.pointer.sessionId&&record.sessionSha256===saved.pointer.sessionSha256&&
      record.destination===destination&&record.bytes===saved.definition.bytes&&HASH.test(record.sha256)&&
      (saved.definition.expectedSha256===null||record.sha256===saved.definition.expectedSha256),
      'MCP_OBJECT_DELIVERY_CHANGED');
    if(record.nativeReceiptSha256!==null){
      const receiptRaw=await bytes(join(saved.session,'assemblies',sha(destination)+'.json'),8192);
      const receipt=parse(receiptRaw);
      need(sha(receiptRaw)===record.nativeReceiptSha256&&receipt.sessionId===record.sessionId&&
        receipt.destination===destination&&receipt.bytes===record.bytes&&receipt.sha256===record.sha256,
        'MCP_OBJECT_NATIVE_ASSEMBLY_CHANGED');
    }
    return record;
  }
  async function assemble(saved,args) {
    const current=await currentWorkspace();
    const lease=await acquireInitialization(saved.path,{python:current.config.operator.python,resume:true});
    try {
      if(await exists(join(saved.path,'delivery.json'))){
        const output=await delivery(saved);
        await readSavedFile(output,{maxBytes:1});
        return {schema:SCHEMA,acquisitionId:saved.record.acquisitionId,
          delivery:{...output,status:'REOPENED',fileRevalidated:true}};
      }
      const destination=join(saved.path,'complete.bin');
      let report;
      if(await exists(destination)){
        report=await inspectObjectSession(saved.session);
        need(report.status==='COMPLETE'&&HASH.test(report.objectSha256??''),'MCP_OBJECT_COMPLETE_SESSION_REQUIRED');
        await readSavedFile({destination,bytes:report.bytes,sha256:report.objectSha256,
          contentType:report.expectedContentType},{maxBytes:1});
      }else report=await assembleObjectSession(saved.session,destination);
      const receiptRaw=await optionalBytes(join(saved.session,'assemblies',sha(destination)+'.json'),8192);
      const output={schema:SCHEMA,acquisitionId:saved.record.acquisitionId,sessionId:saved.pointer.sessionId,
        sessionSha256:saved.pointer.sessionSha256,destination,bytes:report.bytes,
        sha256:report.objectSha256,contentType:report.expectedContentType,
        filename:saved.record.selected.selection.filename,createdAt:new Date().toISOString(),
        nativeReceiptSha256:receiptRaw===null?null:sha(receiptRaw),
        nativeReceiptStatus:receiptRaw===null?'NOT_RECORDED':'RECORDED',
        authority:'ORIGINAL_SF88_VERIFIED_CONTIGUOUS_OBJECT_AND_SAVED_FILE'};
      await retainRecord(join(saved.path,'delivery.json'),output);
      await delivery(saved);
      return {schema:SCHEMA,acquisitionId:saved.record.acquisitionId,
        report:reportView(report,args),delivery:{...output,status:'SAVED',fileRevalidated:true}};
    }finally{await lease.close();}
  }
  async function history(args,sources=false) {
    const limit=args.limit??25;
    need(Number.isInteger(limit)&&limit>=1&&limit<=100&&
      (args.cursor===undefined||HASH.test(args.cursor)),'MCP_OBJECT_PAGE_INVALID');
    if(!await roots())return {schema:SCHEMA,records:[],nextCursor:null,total:0};
    const where=join(root,sources?'sources':'acquisitions');
    const keys=(await readdir(where)).filter(name=>sources?/^[a-f0-9]{64}\.json$/.test(name):HASH.test(name))
      .map(name=>sources?name.slice(0,-5):name).sort();
    const start=args.cursor===undefined?0:keys.indexOf(args.cursor)+1;
    need(args.cursor===undefined||start>0,'MCP_OBJECT_HISTORY_CURSOR_UNKNOWN');
    const selected=keys.slice(start,start+limit),records=[];
    for(const key of selected){
      if(sources)records.push((await source(key)).record);
      else{
        const record=await json(join(where,key,'request.json'));
        const saved=await request(record.acquisitionId);
        records.push({acquisitionId:record.acquisitionId,createdAt:record.createdAt,
          specification:record.specification,selection:record.selected.selection,
          sessionId:saved.pointer?.sessionId??null,
          status:saved.pointer?'SESSION_RETAINED':'INITIALIZATION_INCOMPLETE',
          executionInspected:false,hasDelivery:await exists(join(saved.path,'delivery.json'))});
      }
    }
    return {schema:SCHEMA,records,total:keys.length,
      nextCursor:start+selected.length<keys.length?selected.at(-1):null};
  }
  return {
    register,
    async call(args,context={}) {
      need(!isClosed(),'MCP_NATIVE_WORKSPACE_CLOSING');
      need(object(args)&&Object.hasOwn(fields,args.action)&&
        Object.keys(args).every(key=>key==='action'||fields[args.action].includes(key)),
        'MCP_OBJECT_ARGUMENTS_INVALID');
      const action=args.action;
      if(action==='object-sources')return history(args,true);
      if(action==='object-history')return history(args);
      if(action==='object-list'){
        const src=await source(args.sourceId),{offset,limit}=page(args);
        need(offset<=src.objects.length,'MCP_OBJECT_PAGE_INVALID');
        const objects=src.objects.slice(offset,offset+limit).map(({item,selected})=>({...item,
          selection:selected.selection,resourceUrl:manifest.route.origin+item.path}));
        return {schema:SCHEMA,source:src.record,objects,
          range:{offset,limit,total:src.objects.length,nextOffset:offset+objects.length<src.objects.length?offset+objects.length:null}};
      }
      identifier(args.acquisitionId);
      if(action==='object-prepare'){
        const task=prepare(args);preparing.add(task);
        try{return await task;}finally{preparing.delete(task);}
      }
      const saved=await completed(args.acquisitionId),owner='object:'+saved.key;
      if(['object-status','object-run','object-cancel','object-recover','object-assemble',
        'object-accounting','object-finalize'].includes(action)) {
        const range=page(args);
        need(range.offset<=saved.definition.chunkCount,'MCP_OBJECT_PAGE_INVALID');
      }
      const view=async()=>({schema:SCHEMA,acquisitionId:args.acquisitionId,
        report:reportView(await inspectObjectSession(saved.session),args)});
      if(action==='object-status')return view();
      if(action==='object-read'){
        const output=await delivery(saved);
        return {schema:SCHEMA,acquisitionId:args.acquisitionId,filename:output.filename,
          result:await readSavedFile(output,args),retry:'NO_AUTOMATIC_RETRY'};
      }
      if(action==='object-cancel'){
        const cancelled=await cancelOwned(owner);
        return {...await view(),cancelRequested:cancelled,
          note:'Stops this host’s active object command. Saved attempts remain; a later explicit run can continue only untouched native requests.'};
      }
      if(action==='object-accounting')return {schema:SCHEMA,acquisitionId:args.acquisitionId,
        accounting:await accountObjectSession(saved.session,page(args))};
      if(action==='object-run'||action==='object-finalize'){
        const range=page(args);
        // Concurrent run callers share the original child, then render their
        // own requested report page. Finalization pages are distinct commands.
        const kind=action==='object-finalize'?`${action}:${range.offset}:${range.limit}`:action;
        const outcome=await runOwned(owner,kind,context,async signal=>{
          await currentWorkspace();
          const command=[action==='object-run'?'run':'finalize','--session',saved.session,
            '--workspace',manifest.workspace];
          if(action==='object-finalize'){
            command.push('--offset',String(range.offset),'--limit',String(range.limit));
          }
          return originalCommand(command,signal);
        });
        return action==='object-run'?{...await view(),execution:outcome}:
          {schema:SCHEMA,acquisitionId:args.acquisitionId,execution:outcome,
            accounting:await accountObjectSession(saved.session,range)};
      }
      need(!isActive(owner),'MCP_NATIVE_OPERATION_ACTIVE');
      if(action==='object-recover')return {schema:SCHEMA,acquisitionId:args.acquisitionId,
        report:reportView(await recoverObjectSession(saved.session),args)};
      return assemble(saved,args);
    },
    async close(){await Promise.allSettled([...preparing]);},
  };
}
