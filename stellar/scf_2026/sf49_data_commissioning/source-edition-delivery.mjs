// MIT. Exact-source transfer resources mounted in the original commissioning desk.
import {readdir,lstat} from 'node:fs/promises';
import {join,resolve,basename} from 'node:path';
import {
  atomicJson,readJson,privateDirectory,fileDigest,acceptStream,retainFile
} from '../../scf-starforge-20261009/sf30-seller-sdk/duckdb/cloud-delivery/files.mjs';
import {acquireWorkspace} from '../../scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/files.mjs';
import {
  prepareSourceEditionWorkorder,inspectSourceEditionWorkorder,sourceEditionWorkorderFile,
  sourceEditionWorkorderInput,SOURCE_EDITION_LIMITS
} from './source-edition-workorder.mjs';
import {
  SOURCE_ARCHIVE_LIMITS,exportSourceEditionArchive,inspectSourceEditionArchive,receiveSourceEditionArchive
} from './source-edition-archive.mjs';

export const SOURCE_DELIVERY_SCHEMA='stellar-forge.sf49.source-delivery-request.v1';
export const SOURCE_BUNDLE_REFERENCE_SCHEMA='stellar-forge.sf49.source-bundle-reference.v1';
export const SOURCE_DELIVERY_HTTP_BASE='/api/commissioning/source-bundles';
const MAX_HANDOFF=SOURCE_EDITION_LIMITS.handoffBytes,MAX_TERMS=SOURCE_EDITION_LIMITS.termsBytes,MAX_JSON=2*1024**2;
const ID=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/,SHA=/^[a-f0-9]{64}$/;
const canonical=value=>Array.isArray(value)?'['+value.map(canonical).join(',')+']':
  value!==null&&typeof value==='object'?'{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}':JSON.stringify(value);
const problem=(code,message=code,status=422)=>Object.assign(new Error(message),{code,status});
const ensure=(value,code,message)=>{if(!value)throw problem(code,message);};
const now=()=>new Date().toISOString();
function object(value,keys,label) {
  ensure(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).every(key=>keys.includes(key)),
    'SF49_DELIVERY_INPUT_INVALID','Invalid '+label);
}
function identifier(value) {
  ensure(typeof value==='string'&&ID.test(value),'SF49_DELIVERY_ID_INVALID');return value;
}
function text(value,max,label,{empty=false}={}) {
  ensure(typeof value==='string'&&Buffer.byteLength(value)<=max&&(empty||value.trim())&&
    !/[\x00-\x1f\x7f]/.test(value),'SF49_DELIVERY_INPUT_INVALID','Invalid '+label);return value;
}
function filename(value) {
  text(value,240,'filename');ensure(!/[\\/]/.test(value)&&value!=='.'&&value!=='..','SF49_DELIVERY_FILENAME_INVALID');return value;
}
function size(value,maximum) {
  const result=typeof value==='number'&&Number.isSafeInteger(value)?String(value):value;
  ensure(typeof result==='string'&&/^(0|[1-9][0-9]{0,15})$/.test(result)&&
    Number.isSafeInteger(Number(result))&&Number(result)<=maximum,'SF49_DELIVERY_FILE_LIMIT');
  return result;
}
function fileSelection(value,kind,{reserveNative=true}={}) {
  ensure(Array.isArray(value)&&value.length<=(kind==='archive'?1:64)&&
    (kind!=='archive'||value.length===1),'SF49_DELIVERY_FILES_INVALID');
  const ids=new Set();let total=0;
  const files=value.map(file=>{
    object(file,['id','name','role','bytes','sha256'],'selected file');
    const id=identifier(file.id);ensure(!ids.has(id),'SF49_DELIVERY_FILE_ID_CONFLICT');ids.add(id);
    const bytes=size(file.bytes,kind==='archive'?SOURCE_ARCHIVE_LIMITS.archiveBytes:SOURCE_ARCHIVE_LIMITS.fileBytes);
    total+=Number(bytes);
    ensure(file.sha256===undefined||file.sha256===null||SHA.test(file.sha256),'SF49_DELIVERY_DIGEST_INVALID');
    return {id,name:filename(file.name),role:kind==='archive'?'source-edition-archive':
      text(file.role||'source',160,'source role'),bytes,sha256:file.sha256??null};
  });
  ensure(kind==='archive'||total<=SOURCE_ARCHIVE_LIMITS.sourceBytes-(reserveNative?MAX_HANDOFF+MAX_TERMS:0),
    'SF49_DELIVERY_SOURCE_TOTAL_LIMIT','The original SF49 source ceiling includes its handoff and terms.');
  return files;
}
async function optionalJson(path,maximum=MAX_JSON) {
  try {return await readJson(path,maximum);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
async function privateRoot(value) {
  const root=await privateDirectory(resolve(value)),info=await lstat(root);
  ensure((info.mode&0o077)===0,'SF49_DELIVERY_PRIVATE_DIRECTORY_REQUIRED');return root;
}
function same(a,b,code='SF49_DELIVERY_REQUEST_CONFLICT') {
  ensure(canonical(a)===canonical(b),code,'This retained identity belongs to different original inputs.');
}
function pin(value) {return {bytes:value.bytes,sha256:value.sha256};}
function abort(signal) {if(signal?.aborted)throw problem('SF49_DELIVERY_ABORTED','The original source operation was stopped.',409);}
function sourcePin(value,maximum) {
  object(value,['bytes','sha256'],'source pin');size(value.bytes,maximum);
  ensure(typeof value.sha256==='string'&&SHA.test(value.sha256),'SF49_DELIVERY_DIGEST_INVALID');return value;
}
function safeError(error) {
  return {code:typeof error?.code==='string'?error.code:'SF49_DELIVERY_FAILED',
    message:typeof error?.code==='string'?error.message:'The retained source transfer could not complete.'};
}

/** Only the host resolves saved case inputs and attaches a verified bundle.
 * resolveInputs must retain the same original handoff/terms for operationId.
 * attachBundle must use the original case revision and stable requestId.
 */
export async function openSourceEditionDelivery({
  directory,resolveInputs,attachBundle,python=process.env.SCF_PYTHON||'python3',environment=process.env
}) {
  ensure(typeof resolveInputs==='function'&&typeof attachBundle==='function',
    'SF49_DELIVERY_ORIGINAL_CASE_CALLBACKS_REQUIRED');
  const root=await privateRoot(directory),transfers=await privateRoot(join(root,'transfers'));
  const active=new Map();let closing=false,closePromise=null;
  function available() {if(closing)throw problem('SF49_DELIVERY_CLOSING','The original workspace is closing.',409);}
  const pathFor=id=>join(transfers,identifier(id));
  async function request(id) {
    const value=await optionalJson(join(pathFor(id),'request.json'));
    ensure(value?.schema===SOURCE_DELIVERY_SCHEMA&&value.id===id,'SF49_DELIVERY_NOT_FOUND');
    identifier(value.caseId);ensure(SHA.test(value.caseRevision)&&['source','archive'].includes(value.kind),'SF49_DELIVERY_RETAINED_REQUEST_INVALID');
    // Existing requests retain the actual accepted handoff/terms byte pins.
    // A later native allowance change must not invalidate completed sources
    // merely because their old conservative reservation was different.
    same(value.files,fileSelection(value.files,value.kind,{reserveNative:false}),'SF49_DELIVERY_RETAINED_REQUEST_INVALID');
    text(value.label,240,'retained label');text(value.actor,200,'retained operator');
    ensure(typeof value.createdAt==='string'&&Number.isFinite(Date.parse(value.createdAt)),'SF49_DELIVERY_RETAINED_REQUEST_INVALID');
    if(value.kind==='source') {
      object(value.source,['handoff','terms'],'retained native source');
      sourcePin(value.source.handoff,MAX_HANDOFF);sourcePin(value.source.terms,MAX_TERMS);
      const total=value.files.reduce((sum,file)=>sum+Number(file.bytes),0)+
        Number(value.source.handoff.bytes)+Number(value.source.terms.bytes);
      ensure(total<=SOURCE_EDITION_LIMITS.sourceBytes,'SF49_DELIVERY_RETAINED_REQUEST_INVALID');
    }
    return value;
  }
  async function result(id,name) {return optionalJson(join(pathFor(id),name+'.json'),8*MAX_JSON);}
  async function status(id,value) {await atomicJson(join(pathFor(id),'status.json'),value,{replace:true});}
  async function uploadState(req) {
    const values=[];
    for(const file of req.files) {
      const saved=await optionalJson(join(pathFor(req.id),'uploads',file.id+'.receipt.json'));
      let present=false;
      if(saved?.file?.bytes===file.bytes&&(!file.sha256||file.sha256===saved.file.sha256)) {
        try {const info=await lstat(join(pathFor(req.id),'uploads',file.id+'.data'));
          present=info.isFile()&&!info.isSymbolicLink()&&String(info.size)===saved.file.bytes;
        }catch(error){if(error.code!=='ENOENT')throw error;}
      }
      values.push({...file,present,retained:present?saved.file:null,
        url:SOURCE_DELIVERY_HTTP_BASE+'/upload?id='+encodeURIComponent(req.id)+'&file='+encodeURIComponent(file.id)});
    }
    return values;
  }
  async function view(id) {
    const req=await request(id),completion=await result(id,'completion'),exported=await result(id,'export'),
      inspection=await result(id,'inspection'),last=await result(id,'status');
    return {id:req.id,kind:req.kind,label:req.label,actor:req.actor,createdAt:req.createdAt,
      caseId:req.caseId,caseRevision:req.caseRevision,files:await uploadState(req),
      source:req.source??null,state:completion?'READY':last?.state??'UPLOADING',lastRequestId:last?.requestId??null,
      active:active.has(id),lastOperation:last?.operation??null,error:last?.error??null,
      descriptor:completion?.descriptor??null,inspection:inspection?.value??null,
      exported:exported?{archive:exported.value.archive,filename:exported.value.filename,
        url:SOURCE_DELIVERY_HTTP_BASE+'/download?id='+encodeURIComponent(id)+'&kind=archive'}:null,
      latest:await result(id,'latest-attachment')};
  }
  async function perform(id,operation,work,{stream,token,initial=false,requestId=null}={}) {
    available();identifier(id);
    if(token!==undefined) {
      const original=active.get(id);
      ensure(original?.token===token,'SF49_DELIVERY_OWNER_INVALID');
      abort(original.controller.signal);
      return work(original.controller.signal,token);
    }
    if(active.has(id))throw problem('SF49_DELIVERY_BUSY','This source transfer already has an active original operation.',409);
    const controller=new AbortController(),task={controller,stream,promise:null,token:Symbol('original-transfer'),requestId};
    active.set(id,task);
    task.promise=(async()=>{
      let release;
      try {
        const out=await privateRoot(pathFor(id));
        release=await acquireWorkspace(out);
        abort(controller.signal);
        if(!initial)await request(id);
        await status(id,{operation,state:'RUNNING',startedAt:now(),requestId,error:null});
        const value=await work(controller.signal,task.token);
        await status(id,{operation,state:'IDLE',completedAt:now(),requestId,error:null});
        return value;
      }catch(error) {
        if(release)await status(id,{operation,state:'NEEDS_CONTINUATION',completedAt:now(),requestId,error:safeError(error)}).catch(()=>{});
        throw error;
      }finally {
        try {await release?.();}finally {active.delete(id);}
      }
    })();
    return task.promise;
  }
  async function uploaded(req) {
    const files=[];
    for(const file of req.files) {
      const saved=await optionalJson(join(pathFor(req.id),'uploads',file.id+'.receipt.json'));
      ensure(saved?.file,'SF49_DELIVERY_UPLOAD_REQUIRED','Upload each selected original file before continuing.');
      const path=join(pathFor(req.id),'uploads',file.id+'.data');
      const actual=await fileDigest(path,req.kind==='archive'?SOURCE_ARCHIVE_LIMITS.archiveBytes:SOURCE_ARCHIVE_LIMITS.fileBytes);
      same(actual,pin(saved.file),'SF49_DELIVERY_UPLOADED_FILE_CHANGED');
      ensure(actual.bytes===file.bytes&&(!file.sha256||actual.sha256===file.sha256),'SF49_DELIVERY_UPLOAD_CHANGED');
      files.push({...file,path,...actual});
    }
    return files;
  }
  async function ready(id) {
    const value=await result(id,'completion');
    ensure(value?.descriptor?.schema===SOURCE_BUNDLE_REFERENCE_SCHEMA,'SF49_DELIVERY_NOT_READY');
    return {record:value,directory:join(pathFor(id),value.kind==='source'?'bundle':'received')};
  }
  function descriptor(req,inspected) {
    return {schema:SOURCE_BUNDLE_REFERENCE_SCHEMA,id:req.id,caseId:req.caseId,caseRevision:req.caseRevision,
      operationId:inspected.operationId,bundleId:inspected.bundleId,manifestSha256:inspected.manifestSha256,
      generatedAt:inspected.generatedAt,workOrderRef:inspected.workOrderRef,sourceKind:inspected.sourceKind,
      nativeSource:inspected.manifest.nativeSource,nativeReplay:inspected.verification,
      nativeSourceMatches:inspected.nativeSourceMatches,runtimeSource:inspected.packet.runtimeSource,
      files:[...inspected.manifest.files,{path:'manifest.json',role:'source-edition-manifest',
        bytes:inspected.manifestBytes,sha256:inspected.manifestSha256}]};
  }
  async function complete(req,directory,extra={}) {
    const inspected=await inspectSourceEditionWorkorder({directory});
    const record={schema:'stellar-forge.sf49.source-delivery-completion.v1',kind:req.kind,
      descriptor:descriptor(req,inspected),completedAt:now(),...extra};
    const existing=await result(req.id,'completion');
    if(existing){same(existing.descriptor,record.descriptor,'SF49_DELIVERY_COMPLETION_CHANGED');return existing;}
    await atomicJson(join(pathFor(req.id),'completion.json'),record);
    return record;
  }
  const service={
    async state({caseId,offset=0,limit=50}={}) {
      available();if(caseId!==undefined)identifier(caseId);
      ensure(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200,
        'SF49_DELIVERY_PAGE_INVALID');
      const names=(await readdir(transfers)).filter(name=>ID.test(name)).sort();
      const rows=[];
      for(const id of names) {
        const req=await optionalJson(join(pathFor(id),'request.json'));
        if(req&&(!caseId||req.caseId===caseId))rows.push({id,createdAt:req.createdAt});
      }
      rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
      const items=[];for(const row of rows.slice(offset,offset+limit))items.push(await view(row.id));
      return {schema:'stellar-forge.sf49.source-delivery-state.v1',total:rows.length,offset,limit,
        nextOffset:offset+limit<rows.length?offset+limit:null,transfers:items,limits:SOURCE_ARCHIVE_LIMITS};
    },
    get:async({id})=>{available();return view(identifier(id));},
    async begin(input,token) {
      input=JSON.parse(JSON.stringify(input));
      identifier(input?.id);
      return perform(input.id,'begin',async signal=>{
      abort(signal);
      object(input,['id','kind','caseId','caseRevision','label','actor','files'],'source transfer');
      const id=identifier(input.id),caseId=identifier(input.caseId);
      ensure(SHA.test(input.caseRevision)&&['source','archive'].includes(input.kind),'SF49_DELIVERY_CASE_BINDING_INVALID');
      const out=await privateRoot(pathFor(id)),retained=await optionalJson(join(out,'request.json'));
      const files=fileSelection(input.files??[],input.kind,{reserveNative:!retained});
      const selection={id,kind:input.kind,caseId,caseRevision:input.caseRevision,
        label:text(input.label||id,240,'transfer label'),actor:text(input.actor,200,'operator'),files};
      if(retained) {
        await request(id);
        same(Object.fromEntries(Object.keys(selection).map(key=>[key,retained[key]])),selection);
        if(input.kind==='source') {
          const sourceRoot=await privateRoot(join(out,'original-inputs'));
          let done=true;
          for(const [name,expected]of Object.entries(retained.source))
            try {same(await fileDigest(join(sourceRoot,name+'.json'),name==='handoff'?MAX_HANDOFF:MAX_TERMS),expected);}
            catch(error){if(error.code==='ENOENT')done=false;else throw error;}
          if(!done) {
            abort(signal);
            const resolved=await resolveInputs({caseId,caseRevision:input.caseRevision,operationId:id,
              directory:await privateRoot(join(out,'case-inputs')),signal});
            for(const [name,expected]of Object.entries(retained.source))
              await retainFile(resolve(resolved[name]),join(sourceRoot,name+'.json'),expected);
          }
        }
        return view(id);
      }
      let original=null,source;
      if(input.kind==='source') {
        abort(signal);
        original=await resolveInputs({caseId,caseRevision:input.caseRevision,operationId:id,
          directory:await privateRoot(join(out,'case-inputs')),signal});
        ensure(original&&typeof original.handoff==='string'&&typeof original.terms==='string','SF49_DELIVERY_ORIGINAL_INPUTS_REQUIRED');
        source={handoff:await fileDigest(resolve(original.handoff),MAX_HANDOFF),
          terms:await fileDigest(resolve(original.terms),MAX_TERMS)};
      }
      const req={schema:SOURCE_DELIVERY_SCHEMA,...selection,createdAt:now(),...(source?{source}:{})};
      abort(signal);
      await atomicJson(join(out,'request.json'),req);
      if(original) {
        const sourceRoot=await privateRoot(join(out,'original-inputs'));
        for(const [name,expected]of Object.entries(source))
          await retainFile(resolve(original[name]),join(sourceRoot,name+'.json'),expected);
      }
      return view(id);
      },{token,initial:true});
    },
    async upload({id,fileId,stream,signal},token) {
      return perform(id,'upload',async internalSignal=>{
        const req=await request(id),selected=req.files.find(file=>file.id===fileId);
        ensure(selected,'SF49_DELIVERY_FILE_NOT_DECLARED');
        const out=await privateRoot(join(pathFor(id),'uploads'));
        const stop=()=>stream.destroy?.(problem('SF49_DELIVERY_UPLOAD_ABORTED'));
        signal?.addEventListener('abort',stop,{once:true});internalSignal.addEventListener('abort',stop,{once:true});
        try {
          if(signal?.aborted||internalSignal.aborted)stop();
          const saved=await acceptStream(join(out,fileId+'.data'),stream,selected,{signal:internalSignal});
          const old=await optionalJson(join(out,fileId+'.receipt.json'));
          const receipt=old??{file:{...pin(saved)},completedAt:now(),reconciled:saved.reused??false};
          same(receipt.file,pin(saved),'SF49_DELIVERY_UPLOAD_RECEIPT_CHANGED');
          await atomicJson(join(out,fileId+'.receipt.json'),receipt);
          return {file:{id:fileId,...saved},transfer:await view(id)};
        }finally {
          signal?.removeEventListener('abort',stop);internalSignal.removeEventListener('abort',stop);
        }
      },{stream,token});
    },
    async prepare({id},token) {
      return perform(id,'prepare',async()=>{
        const req=await request(id);ensure(req.kind==='source','SF49_DELIVERY_SOURCE_REQUIRED');
        if(await result(id,'completion'))return view(id);
        const files=await uploaded(req),out=pathFor(id),selection={
          schema:'stellar-forge.sf49.source-edition-attachments.v1',
          files:files.map(file=>({id:file.id,name:file.name,role:file.role,path:file.path,
            bytes:Number(file.bytes),sha256:file.sha256}))};
        await atomicJson(join(out,'attachment-selection.json'),selection);
        await prepareSourceEditionWorkorder({handoff:join(out,'original-inputs','handoff.json'),
          terms:join(out,'original-inputs','terms.json'),attachments:join(out,'attachment-selection.json'),
          operationId:id,directory:join(out,'bundle'),generatedAt:req.createdAt});
        await complete(req,join(out,'bundle'));return view(id);
      },{token});
    },
    async inspect({id},token) {
      return perform(id,'inspect-archive',async signal=>{
        const req=await request(id);ensure(req.kind==='archive','SF49_DELIVERY_ARCHIVE_REQUIRED');
        const files=await uploaded(req),value=await inspectSourceEditionArchive({archive:files[0].path,python,environment,signal});
        const previous=await result(id,'inspection');
        if(previous)same(previous.value,value,'SF49_DELIVERY_ARCHIVE_CHANGED');
        else await atomicJson(join(pathFor(id),'inspection.json'),{value,completedAt:now()});
        return view(id);
      },{token});
    },
    async receive({id},token) {
      return perform(id,'receive-archive',async signal=>{
        const req=await request(id);ensure(req.kind==='archive','SF49_DELIVERY_ARCHIVE_REQUIRED');
        if(await result(id,'completion'))return view(id);
        const files=await uploaded(req),out=pathFor(id);
        const value=await receiveSourceEditionArchive({archive:files[0].path,stagingDirectory:join(out,'intake'),
          destination:join(out,'received'),python,environment,signal});
        await complete(req,join(out,'received'),{archive:value.archive});
        return view(id);
      },{token});
    },
    async export({id},token) {
      return perform(id,'export-archive',async signal=>{
        const saved=await ready(id),out=pathFor(id);
        const value=await exportSourceEditionArchive({directory:saved.directory,destination:join(out,'source-edition.zip'),
          python,environment,signal});
        const old=await result(id,'export');
        if(old)same(old.value.archive,value.archive,'SF49_DELIVERY_ARCHIVE_CHANGED');
        else await atomicJson(join(out,'export.json'),{value:{archive:value.archive,filename:value.filename,members:value.members},
          completedAt:now()});
        return view(id);
      },{token});
    },
    async reopen({id,requestId},token) {
      identifier(requestId);
      return perform(id,'reopen',async()=>{
        const saved=await ready(id),file=join(pathFor(id),'checks',requestId+'.json');
        const existing=await optionalJson(file);
        if(existing)return {check:existing,transfer:await view(id)};
        const inspected=await inspectSourceEditionWorkorder({directory:saved.directory});
        ensure(inspected.bundleId===saved.record.descriptor.bundleId&&
          inspected.manifestSha256===saved.record.descriptor.manifestSha256,'SF49_DELIVERY_ORIGINAL_CHANGED');
        const check={requestId,checkedAt:now(),bundleId:inspected.bundleId,manifestSha256:inspected.manifestSha256,
          nativeSourceMatches:inspected.nativeSourceMatches,verification:inspected.verification};
        await atomicJson(file,check);return {check,transfer:await view(id)};
      },{token});
    },
    async attach({id,caseId,expectedRevision,requestId,actor},token) {
      identifier(caseId);identifier(requestId);ensure(SHA.test(expectedRevision),'SF49_DELIVERY_CASE_BINDING_INVALID');
      text(actor,200,'operator');
      return perform(id,'attach-to-case',async signal=>{
        const saved=await ready(id),request={id,caseId,expectedRevision,requestId,actor,
          bundleId:saved.record.descriptor.bundleId,manifestSha256:saved.record.descriptor.manifestSha256};
        const folder=await privateRoot(join(pathFor(id),'attachments',requestId));
        const original=await optionalJson(join(folder,'request.json'));
        if(original)same(original,request);
        else await atomicJson(join(folder,'request.json'),request);
        const previous=await optionalJson(join(folder,'result.json'),8*MAX_JSON);
        if(previous)return {attachment:previous,transfer:await view(id)};
        const nativeInput=await sourceEditionWorkorderInput({directory:saved.directory});
        const checked=nativeInput.summary;
        ensure(checked.bundleId===request.bundleId&&checked.manifestSha256===request.manifestSha256,
          'SF49_DELIVERY_ORIGINAL_CHANGED');
        abort(signal);
        const result=await attachBundle({caseId,expectedRevision,requestId,actor,signal,
          descriptor:saved.record.descriptor,directory:saved.directory,
          loadWorkorder:async()=>nativeInput});
        ensure(result&&typeof result==='object'&&!Array.isArray(result)&&
          Buffer.byteLength(JSON.stringify(result))<=MAX_JSON,'SF49_DELIVERY_CASE_ATTACHMENT_RESULT_REQUIRED');
        const retained={requestId,caseId,bundleId:request.bundleId,manifestSha256:request.manifestSha256,
          recordedAt:now(),result};
        await atomicJson(join(folder,'result.json'),retained);
        await atomicJson(join(pathFor(id),'latest-attachment.json'),retained,{replace:true});
        return {attachment:retained,transfer:await view(id)};
      },{token});
    },
    async command({id,requestId}) {
      available();identifier(id);identifier(requestId);
      const folder=join(pathFor(id),'commands',requestId);
      const command=await optionalJson(join(folder,'request.json'));
      ensure(command?.id===id&&command.requestId===requestId,'SF49_DELIVERY_COMMAND_NOT_FOUND');
      const saved=await optionalJson(join(folder,'result.json'),8*MAX_JSON),last=await optionalJson(join(folder,'status.json'));
      return {request:command,state:saved?'COMPLETE':active.get(id)?.requestId===requestId?'RUNNING':last?.state==='NEEDS_CONTINUATION'&&last.error?'FAILED':'NEEDS_CONTINUATION',
        attempts:last?.attempts??0,error:last?.error??null,result:saved?.result??null,
        completedAt:saved?.completedAt??null};
    },
    async dispatch({id,requestId,action,input,continue:continuation=false}) {
      available();identifier(id);identifier(requestId);
      ensure(['begin','prepare','inspect','receive','export','reopen','attach'].includes(action)&&
        input&&typeof input==='object'&&!Array.isArray(input)&&input.id===id&&
        typeof continuation==='boolean','SF49_DELIVERY_COMMAND_INVALID');
      if(['reopen','attach'].includes(action))ensure(input.requestId===requestId,'SF49_DELIVERY_COMMAND_ID_MISMATCH');
      ensure(Buffer.byteLength(JSON.stringify(input))<=MAX_JSON,'SF49_DELIVERY_INPUT_LIMIT');
      const command={schema:'stellar-forge.sf49.source-delivery-command.v1',id,requestId,action,input:JSON.parse(JSON.stringify(input))};
      let accepted,notAccepted,settled=false;
      const admission=new Promise((done,reject)=>{accepted=value=>{settled=true;done(value);};notAccepted=reject;});
      const pending=perform(id,action,async(signal,token)=>{
        const folder=await privateRoot(join(pathFor(id),'commands',requestId));
        const prior=await optionalJson(join(folder,'request.json'));
        if(prior)same(prior,command,'SF49_DELIVERY_COMMAND_CONFLICT');
        const complete=await optionalJson(join(folder,'result.json'),8*MAX_JSON);
        if(complete) {accepted({id,requestId,state:'COMPLETE'});return complete.result;}
        if(prior&&!continuation)throw problem('SF49_DELIVERY_CONTINUATION_REQUIRED',
          'Inspect the retained command, then explicitly continue that same command.',409);
        if(!prior)await atomicJson(join(folder,'request.json'),command);
        const last=await optionalJson(join(folder,'status.json')),attempts=(last?.attempts??0)+1;
        const attempt={state:'RUNNING',attempts,startedAt:now(),error:null};
        await atomicJson(join(folder,'status.json'),attempt,{replace:true});
        accepted({id,requestId,state:'RUNNING'});
        try {
          abort(signal);
          const value=await service[action](command.input,token);
          await atomicJson(join(folder,'result.json'),{result:value,completedAt:now()});
          await atomicJson(join(folder,'status.json'),{...attempt,state:'COMPLETE',completedAt:now()},{replace:true});
          return value;
        }catch(error) {
          await atomicJson(join(folder,'attempt-'+attempts+'.json'),
            {...attempt,state:'NEEDS_CONTINUATION',completedAt:now(),error:safeError(error)}).catch(()=>{});
          await atomicJson(join(folder,'status.json'),
            {...attempt,state:'NEEDS_CONTINUATION',completedAt:now(),error:safeError(error)},{replace:true}).catch(()=>{});
          throw error;
        }
      },{initial:action==='begin',requestId});
      void pending.catch(error=>{if(!settled)notAccepted(error);});
      return admission;
    },
    async artifact({id,kind,name}) {
      available();
      if(kind==='archive') {
        const exported=await result(id,'export');ensure(exported,'SF49_DELIVERY_ARCHIVE_NOT_READY');
        const path=join(pathFor(id),'source-edition.zip'),actual=sourcePin(exported.value.archive,SOURCE_ARCHIVE_LIMITS.archiveBytes);
        return {path,bytes:Number(actual.bytes),sha256:actual.sha256,filename:exported.value.filename,type:'application/zip'};
      }
      ensure(kind==='file','SF49_DELIVERY_ARTIFACT_KIND_INVALID');
      const saved=await ready(id),file=await sourceEditionWorkorderFile({directory:saved.directory,name});
      ensure(file.bundleId===saved.record.descriptor.bundleId&&file.manifestSha256===saved.record.descriptor.manifestSha256,
        'SF49_DELIVERY_ORIGINAL_CHANGED');
      return {path:file.path,bytes:file.bytes,sha256:file.sha256,filename:basename(file.name),
        type:file.name.endsWith('.json')?'application/json':file.name.endsWith('.html')?'text/html':
          file.name.endsWith('.md')?'text/markdown':'application/octet-stream'};
    },
    async close() {
      if(closePromise)return closePromise;
      closing=true;
      closePromise=(async()=>{
        const pending=[...active.values()];
        for(const task of pending){task.controller.abort();task.stream?.destroy?.(problem('SF49_DELIVERY_CLOSING'));}
        await Promise.allSettled(pending.map(task=>task.promise));
      })();
      return closePromise;
    }
  };
  return service;
}
