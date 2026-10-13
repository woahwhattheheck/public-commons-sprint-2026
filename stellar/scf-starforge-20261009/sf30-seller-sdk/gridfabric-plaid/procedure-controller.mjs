// MIT. Browser procedures borrow the original authenticated Grid owner.
import {constants,createWriteStream} from 'node:fs';
import {mkdir,readdir,mkdtemp,unlink,rmdir,open,link} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {connectGridFabricOperator} from './sdk/http-client.mjs';
import {loadCommandCatalog} from '../../distribution/discovery/load.mjs';
import {inspectGridFabricProcedureInput,prepareGridFabricProcedure} from '../../distribution/discovery/gridfabric-procedure.mjs';
import {inspectOperatingPlan} from '../../distribution/discovery/operating-plan.mjs';
import {captureGridFabricProcedure,readGridFabricProcedureCapture} from '../../distribution/discovery/gridfabric-procedure-native.mjs';
import {exportGridProcedureArchive,receiveGridProcedureArchive} from './procedure-archive.mjs';
import {jsonBytes,digest,canonical,same,need,memberPath,privateDirectory,originalFile,readBytes,readJSON,
  exists,writeNew,publishNew,frozenJSON,fileIdentity,syncDirectory,ordinaryNames,streamOriginal} from './procedure-files.mjs';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const SHA=/^[a-f0-9]{64}$/;
const copy=value=>JSON.parse(JSON.stringify(value));
const requestHash=value=>digest(Buffer.from(JSON.stringify(canonical(value))));
const errorView=error=>({code:error.code||error.name||'GRID_PROCEDURE_ERROR',message:String(error.message||error),
  ...(error.details?{details:copy(error.details)}:{}),at:new Date().toISOString()});
const id=value=>{need(UUID.test(value||''),'GRID_PROCEDURE_REQUEST_ID','Keep the original request UUID.');return value;};
const stamp=value=>{need(typeof value==='string'&&Number.isFinite(Date.parse(value))&&new Date(value).toISOString()===value,'GRID_PROCEDURE_TIME','Keep the reviewed UTC capture time.');return value;};
const viewJSON=(response,value,status=200)=>{const raw=jsonBytes(value);response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Content-Length':raw.length});response.end(raw);};
const exact=(value,names)=>need(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===names.length&&
  names.every(k=>Object.hasOwn(value,k)),'GRID_PROCEDURE_FIELDS','Keep the complete original request fields.');
function checkedCapture(value){
  exact(value,['request_id','input','catalog','plan','savedAt']);id(value.request_id);stamp(value.savedAt);
  const input=inspectGridFabricProcedureInput(value.input),plan=inspectOperatingPlan(value.plan);
  need(same(value.input,input),'GRID_PROCEDURE_INPUT','Prepare the complete normalized input before capture.');
  need(plan.id===input.id,'GRID_PROCEDURE_PLAN','The selected full plan belongs to another input.');
  // The original preparer validates the complete selected catalog and all required registrations.
  prepareGridFabricProcedure({input,catalog:value.catalog,savedAt:value.savedAt});
  return copy(value);
}
async function bodyJSON(request,maximum){
  const length=request.headers['content-length'];
  need(length!==undefined&&/^\d+$/.test(length)&&Number(length)<=maximum,
    'GRID_PROCEDURE_BODY','Send the complete declared JSON request within the configured allowance.',413);
  const chunks=[];let count=0;
  for await(const chunk of request){count+=chunk.length;need(count<=maximum,'GRID_PROCEDURE_BODY','The complete request exceeds its allowance.',413);chunks.push(chunk);}
  need(count===Number(length),'GRID_PROCEDURE_BODY','The complete original request ended early.');
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));}
  catch{throw Object.assign(new Error('Send complete UTF-8 JSON.'),{code:'GRID_PROCEDURE_JSON',statusCode:400});}
}
const withoutTime=value=>{const result=copy(value);delete result.capturedAt;return result;};

/** No native domain owner is opened here. close drains only the retained SDK borrowers. */
export function createGridProcedureController({workspace,source,origin,token,tables,maximumRequestBytes=256*1024*1024,
  maximumArchiveBytes=8*1024*1024*1024,maximumExpandedBytes=16*1024*1024*1024}){
  const directory=join(workspace.directory,'procedures'),jobs=new Map(),archives=new Map(),borrowers=new Set();
  let closing=false,closed=null,rootPromise=null;
  const binding={workspace_id:workspace.workspace_id,workspace_directory:workspace.directory,source_sha256:source.sha256};
  function root(){
    if(!rootPromise)rootPromise=privateDirectory(directory,{create:true}).then(async root=>{
      await privateDirectory(join(root,'requests'),{create:true});return root;
    }).catch(e=>{rootPromise=null;throw e;});
    return rootPromise;
  }
  async function requestDirectory(requestId){return join(await root(),'requests',id(requestId));}
  async function currentCatalog(){return loadCommandCatalog();}
  async function context(){
    const before=workspace.state(),catalog=await currentCatalog(),after=workspace.state();
    need(before.revision===after.revision,'GRID_PROCEDURE_REVISION','The original workspace changed during preparation. Refresh its selection.',409);
    return {workspace:copy(binding),revision:after.revision,catalog,tables:copy(tables)};
  }
  async function validateCurrent(input,catalog){
    need(same(input.workspace,binding)&&input.expectedRevision===workspace.state().revision,
      'GRID_PROCEDURE_REVISION','The reviewed original workspace or revision changed. Keep this request and review a separate capture.',409);
    const current=await currentCatalog();
    need(same(withoutTime(current),withoutTime(catalog)),
      'GRID_PROCEDURE_CATALOG','The selected installed catalog changed. Keep its earlier draft and prepare a current selection.',409);
  }
  function requestSummary(saved){
    return {request_id:saved.request.request_id,kind:saved.kind,request_sha256:saved.request_sha256,createdAt:saved.createdAt,
      title:saved.kind==='capture'?saved.request.plan.revisions.at(-1).title:saved.request.name,
      workspace:saved.kind==='capture'?copy(saved.request.input.workspace):null};
  }
  async function reserve(request,kind){
    const root=await requestDirectory(request.request_id);try{await mkdir(root,{mode:0o700});}catch(e){if(e.code!=='EEXIST')throw e;}
    await privateDirectory(root);const path=join(root,'request.json'),sha256=requestHash(request);
    if(await exists(path)){
      const saved=await readJSON(path,Number.MAX_SAFE_INTEGER);
      need(saved.schema==='stellar-forge.gridfabric-browser-procedure-request.v1'&&saved.kind===kind&&
        saved.request_sha256===sha256&&same(saved.request,request),'GRID_PROCEDURE_REQUEST_CONFLICT',
        'This original request UUID names another complete request.',409);
      await frozenJSON(join(root,'request-summary.json'),requestSummary(saved));return {root,saved};
    }
    need((await readdir(root)).length===0,'GRID_PROCEDURE_REQUEST_UNBOUND','Preserve the existing unbound request directory.',409);
    const saved={schema:'stellar-forge.gridfabric-browser-procedure-request.v1',kind,
      request_sha256:sha256,request:copy(request),createdAt:new Date().toISOString()};
    await publishNew(path,jsonBytes(saved));await frozenJSON(join(root,'request-summary.json'),requestSummary(saved));
    await privateDirectory(join(root,'attempts'),{create:true});return {root,saved};
  }
  async function retained(requestId){
    const root=await requestDirectory(requestId);
    need(await exists(join(root,'request.json')),'GRID_PROCEDURE_REQUEST_NOT_FOUND','This original request was not accepted.',404);
    await privateDirectory(root);const saved=await readJSON(join(root,'request.json'),Number.MAX_SAFE_INTEGER);
    need(saved.request?.request_id===requestId&&saved.request_sha256===requestHash(saved.request),
      'GRID_PROCEDURE_REQUEST_CHANGED','The complete retained request changed.',409);return {root,saved};
  }
  async function attempts(root){
    const path=join(root,'attempts');if(!await exists(path))return [];
    const names=await ordinaryNames(path),result=[];
    for(const name of names){
      need(/^\d{6}$/.test(name),'GRID_PROCEDURE_ATTEMPT','Keep only original numbered attempts.',409);
      const dir=join(path,name);await privateDirectory(dir);
      const record=await exists(join(dir,'attempt.json'))?await readJSON(join(dir,'attempt.json')):null;
      const error=await exists(join(dir,'error.json'))?await readJSON(join(dir,'error.json')):null;
      const completion=await exists(join(dir,'complete.json'))?await readJSON(join(dir,'complete.json')):null;
      result.push({number:Number(name),directory:dir,record,error,completion});
    }
    return result;
  }
  async function completeFrom(root,saved,rows){
    for(const attempt of [...rows].reverse()){
      const captureDirectory=join(attempt.directory,'capture'),marker=join(captureDirectory,'capture.json');
      if(!await exists(marker))continue;
      // Imported bytes require both the whole native validator and the finished archive parser.
      if(saved.kind==='import'&&!attempt.completion)continue;
      const result=await readGridFabricProcedureCapture(captureDirectory);
      if(saved.kind==='capture'){
        need(same(result.input,saved.request.input)&&same(result.catalog,saved.request.catalog)&&
          same(await readJSON(join(captureDirectory,'plan-before.json'),Number.MAX_SAFE_INTEGER),saved.request.plan)&&
          result.capture.capturedAt===saved.request.savedAt,
          'GRID_PROCEDURE_CAPTURE_BINDING','The retained capture differs from its complete original request.',409);
      }else{
        need(attempt.completion.archive_sha256===saved.request.sha256&&
          attempt.completion.archive_bytes===saved.request.bytes&&attempt.completion.capture_sha256===result.receipt.sha256,
          'GRID_PROCEDURE_IMPORT_BINDING','The retained imported capture differs from its exact archive.',409);
      }
      return {attempt,result};
    }
    return null;
  }
  async function readSummary(requestId){
    const root=await requestDirectory(requestId),summaryPath=join(root,'request-summary.json');
    let summary;
    if(await exists(summaryPath))summary=await readJSON(summaryPath);
    else{
      const {saved}=await retained(requestId);
      summary=requestSummary(saved);
      await frozenJSON(summaryPath,summary);
    }
    const rows=await attempts(root),completion=[...rows].reverse().find(row=>row.completion)?.completion??null;
    return {...summary,state:completion?'COMPLETE':jobs.has(requestId)?'RUNNING':'INCOMPLETE',
      validation:'Saved status; opening the request verifies its complete native capture.',
      attempts:rows.map(({number,record,error,completion})=>({number,startedAt:record?.startedAt??null,
        error:error?{code:error.code,message:error.message,at:error.at}:null,
        completedAt:completion?.completedAt??null})),
      result:completion?{planId:completion.planId??null,title:completion.title??summary.title,
        revisions:completion.revisions??null,receipt:completion.receipt}:null};
  }
  async function readRequest(requestId){
    const {root,saved}=await retained(id(requestId)),rows=await attempts(root),received=await completeFrom(root,saved,rows);
    const active=jobs.get(requestId),state=received?'COMPLETE':active?'RUNNING':'INCOMPLETE';
    return {request_id:requestId,kind:saved.kind,state,request_sha256:saved.request_sha256,
      request:copy(saved.request),createdAt:saved.createdAt,
      attempts:rows.map(({number,record,error,completion})=>({number,record,error,completion})),
      ...(rows.at(-1)?.error?{error:rows.at(-1).error}:{}),
      result:received?received.result:null};
  }
  async function startAttempt(root,saved){
    await privateDirectory(join(root,'attempts'),{create:true});const rows=await attempts(root);
    const number=rows.length?rows.at(-1).number+1:1;
    need(number<=999999,'GRID_PROCEDURE_ATTEMPT_LIMIT','The complete original request has exhausted its numbered attempts.',409);
    const path=join(root,'attempts',String(number).padStart(6,'0'));await mkdir(path,{mode:0o700});
    await publishNew(join(path,'attempt.json'),jsonBytes({number,request_id:saved.request.request_id,
      request_sha256:saved.request_sha256,kind:saved.kind,startedAt:new Date().toISOString()}));
    return {path,number};
  }
  async function borrowed(fn){
    const temp=await mkdtemp(join(tmpdir(),'grid-procedure-borrow-')),connection=join(temp,'connection.txt');let client=null,primary=null;
    try{
      await writeNew(connection,Buffer.from(origin()+'/#'+token+'\n'));
      client=await connectGridFabricOperator({connectionFile:connection,expectedWorkspaceId:binding.workspace_id,
        expectedWorkspace:binding.workspace_directory,expectedSourceSha256:binding.source_sha256});
      borrowers.add(client);return await fn(client);
    }catch(e){primary=e;throw e;}
    finally{
      const errors=[];
      if(client)try{await client.close();borrowers.delete(client);}catch(e){errors.push(errorView(e));}
      try{await unlink(connection);}catch(e){if(e.code!=='ENOENT')errors.push(errorView(e));}
      try{await rmdir(temp);}catch(e){if(e.code!=='ENOENT')errors.push(errorView(e));}
      if(errors.length){if(primary)primary.details={...(primary.details||{}),closeErrors:errors};
        else throw Object.assign(new Error('The original procedure borrower cleanup did not complete.'),{code:'GRID_PROCEDURE_CLOSE',details:{closeErrors:errors}});}
    }
  }
  function owned(request,kind,fn){
    need(!closing,'GRID_PROCEDURE_CLOSING','The original procedure controller is closing.',503);
    const key=id(request.request_id),hash=requestHash(request),prior=jobs.get(key);
    if(prior){need(prior.hash===hash&&prior.kind===kind,'GRID_PROCEDURE_REQUEST_CONFLICT','This active original UUID names another request.',409);return prior.promise;}
    const promise=Promise.resolve().then(fn);jobs.set(key,{hash,kind,promise});
    promise.finally(()=>jobs.delete(key)).catch(()=>{});return promise;
  }
  async function capture(request,{continueIncomplete=false}={}){
    request=checkedCapture(request);
    return owned(request,'capture',async()=>{
      const {root,saved}=await reserve(request,'capture'),rows=await attempts(root),done=await completeFrom(root,saved,rows);
      if(done)return readRequest(request.request_id);
      need(!rows.length||continueIncomplete,'GRID_PROCEDURE_INCOMPLETE',
        'The earlier original attempt is retained. Inspect it and explicitly continue the same request.',409);
      await validateCurrent(request.input,request.catalog);const attempt=await startAttempt(root,saved);
      try{
        const result=await borrowed(client=>captureGridFabricProcedure({client,catalog:request.catalog,input:request.input,
          plan:request.plan,savedAt:request.savedAt,outputDirectory:join(attempt.path,'capture')}));
        await publishNew(join(attempt.path,'complete.json'),jsonBytes({completedAt:new Date().toISOString(),
          capture_sha256:result.receipt.sha256,receipt:result.receipt,planId:result.plan.id,
          title:result.plan.revisions.at(-1).title,revisions:result.plan.revisions.length}));
      }catch(error){
        try{await publishNew(join(attempt.path,'error.json'),jsonBytes(errorView(error)));}catch(save){error.details={...(error.details||{}),retentionError:errorView(save)};}
        throw error;
      }
      return readRequest(request.request_id);
    });
  }
  async function importArchive(request,raw,{continueIncomplete=false}={}){
    const pending=jobs.get(request.request_id);
    if(pending){
      need(pending.kind==='import'&&pending.hash===requestHash(request),'GRID_PROCEDURE_REQUEST_CONFLICT','This active UUID names another original request.',409);
      const hash=createHash('sha256');let bytes=0;
      for await(const chunk of raw){bytes+=chunk.length;need(bytes<=request.bytes,'GRID_PROCEDURE_ARCHIVE_IDENTITY','The replayed original archive exceeds its declared length.',409);hash.update(chunk);}
      need(bytes===request.bytes&&hash.digest('hex')===request.sha256,'GRID_PROCEDURE_ARCHIVE_IDENTITY','The replayed original archive differs.',409);
      return pending.promise;
    }
    return owned(request,'import',async()=>{
      const {root,saved}=await reserve(request,'import'),rows=await attempts(root),done=await completeFrom(root,saved,rows);
      // Even a replay must receive and verify every byte of the selected original file.
      const target=join(root,'original.gridprocedure.jsonl.gz'),temporary=join(root,'incoming-'+randomUUID()+'.part');
      const hash=createHash('sha256');let bytes=0;
      const meter=new Transform({transform(chunk,encoding,next){
        bytes+=chunk.length;if(bytes>request.bytes||bytes>maximumArchiveBytes){next(Object.assign(new Error('The complete archive exceeds its declared allowance.'),{code:'GRID_PROCEDURE_ARCHIVE_LIMIT',statusCode:413}));return;}
        hash.update(chunk);next(null,chunk);
      }});
      await pipeline(raw,meter,createWriteStream(temporary,{flags:'wx',mode:0o600}));
      need(bytes===request.bytes&&hash.digest('hex')===request.sha256,
        'GRID_PROCEDURE_ARCHIVE_IDENTITY','The complete selected archive bytes differ.',409);
      const input=await open(temporary,constants.O_RDONLY|constants.O_NOFOLLOW);try{await input.sync();}finally{await input.close();}
      if(await exists(target)){
        need(same(await fileIdentity(target),{bytes:request.bytes,sha256:request.sha256}),
          'GRID_PROCEDURE_ARCHIVE_IDENTITY','The retained original archive differs.',409);await unlink(temporary);
      }else{await link(temporary,target);await unlink(temporary);await syncDirectory(root);}
      if(done)return readRequest(request.request_id);
      need(!rows.length||continueIncomplete,'GRID_PROCEDURE_INCOMPLETE',
        'The earlier original import is retained. Inspect it and explicitly continue the same request.',409);
      const attempt=await startAttempt(root,saved);
      try{
        const result=await receiveGridProcedureArchive({file:target,outputDirectory:join(attempt.path,'capture'),
          expectedSha256:request.sha256,expectedBytes:request.bytes,maximumExpanded:maximumExpandedBytes});
        await publishNew(join(attempt.path,'complete.json'),jsonBytes({completedAt:new Date().toISOString(),
          archive_sha256:request.sha256,archive_bytes:request.bytes,capture_sha256:result.receipt.sha256,receipt:result.receipt,
          planId:result.plan.id,title:result.plan.revisions.at(-1).title,revisions:result.plan.revisions.length}));
      }catch(error){
        try{await publishNew(join(attempt.path,'error.json'),jsonBytes(errorView(error)));}catch(save){error.details={...(error.details||{}),retentionError:errorView(save)};}
        throw error;
      }
      return readRequest(request.request_id);
    });
  }
  async function selectCapture(requestId){
    const view=await readRequest(requestId);
    need(view.state==='COMPLETE'&&view.result,'GRID_PROCEDURE_INCOMPLETE','Read the original incomplete capture before download.',409);
    return view;
  }
  async function archive(requestId){
    id(requestId);if(archives.has(requestId))return archives.get(requestId);
    const promise=(async()=>{
      const view=await selectCapture(requestId),{root}=await retained(requestId),target=join(root,'complete.gridprocedure.jsonl.gz'),
        metadata=join(root,'archive.json');
      if(await exists(metadata)){
        const info=await readJSON(metadata);need(same(await fileIdentity(target),{bytes:info.bytes,sha256:info.sha256})&&
          info.capture_sha256===view.result.receipt.sha256,'GRID_PROCEDURE_ARCHIVE_CHANGED','The original archive changed.',409);return info;
      }
      if(await exists(target)){
        const candidate=join(root,'archive-receiving-'+randomUUID()+'.gridprocedure.jsonl.gz');
        const fresh=await exportGridProcedureArchive({directory:view.result.directory,outputFile:candidate});
        need(same(await fileIdentity(target),{bytes:fresh.bytes,sha256:fresh.sha256}),
          'GRID_PROCEDURE_ARCHIVE_CHANGED','The retained archive without metadata differs from the complete original capture.',409);
        const result={...fresh,path:target};await frozenJSON(metadata,result);await unlink(candidate);return result;
      }
      const result=await exportGridProcedureArchive({directory:view.result.directory,outputFile:target});
      await frozenJSON(metadata,result);return result;
    })();
    archives.set(requestId,promise);promise.finally(()=>archives.delete(requestId)).catch(()=>{});return promise;
  }
  async function download(response,path,info){
    response.writeHead(200,{'Content-Type':info.content_type||'application/octet-stream','Content-Length':info.bytes,
      'X-Content-SHA256':info.sha256,'Content-Disposition':"attachment; filename*=UTF-8''"+encodeURIComponent(info.name).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16).toUpperCase())});
    await streamOriginal(path,response,info);
  }
  return {
    async handle(request,response,url){
      if(!url.pathname.startsWith('/api/procedures/'))return false;
      need(!closing,'GRID_PROCEDURE_CLOSING','The original procedure controller is closing.',503);
      if(request.method==='GET'){
        if(url.pathname==='/api/procedures/context'){viewJSON(response,await context());return true;}
        if(url.pathname==='/api/procedures/request'){viewJSON(response,await readRequest(id(url.searchParams.get('request_id'))));return true;}
        if(url.pathname==='/api/procedures/list'){
          const offset=Number(url.searchParams.get('offset')??0),limit=Number(url.searchParams.get('limit')??25);
          need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=50,
            'GRID_PROCEDURE_PAGE','Select complete pages of 1–50 saved requests.');
          const names=(await ordinaryNames(join(await root(),'requests'))).filter(name=>UUID.test(name)),items=[];
          for(const name of names.slice(offset,offset+limit))items.push(await readSummary(name));
          viewJSON(response,{items,offset,total:names.length,next_offset:offset+items.length<names.length?offset+items.length:null});return true;
        }
        const requestId=id(url.searchParams.get('request_id'));
        if(url.pathname==='/api/procedures/file'){
          const view=await selectCapture(requestId),path=memberPath(url.searchParams.get('path'));
          const member=path==='capture.json'?{path,bytes:view.result.receipt.bytes,sha256:view.result.receipt.sha256}:
            view.result.capture.members.find(item=>item.path===path);
          need(member,'GRID_PROCEDURE_MEMBER','Select an exact member from the complete native capture.',404);
          await download(response,join(view.result.directory,path),{...member,name:path.split('/').at(-1),
            content_type:path.endsWith('.json')?'application/json':path.endsWith('.html')?'text/html; charset=utf-8':path.endsWith('.md')?'text/markdown; charset=utf-8':'application/octet-stream'});return true;
        }
        if(url.pathname==='/api/procedures/archive'){const info=await archive(requestId);await download(response,info.path,info);return true;}
      }else if(request.method==='POST'){
        if(url.pathname==='/api/procedures/prepare'){
          const body=await bodyJSON(request,maximumRequestBytes);exact(body,['input']);
          const input=inspectGridFabricProcedureInput(body.input),current=await context();
          need(same(input.workspace,current.workspace)&&input.expectedRevision===current.revision,
            'GRID_PROCEDURE_REVISION','Refresh the actual original workspace before preparing this input.',409);
          const plan=prepareGridFabricProcedure({input,catalog:current.catalog});
          viewJSON(response,{input,catalog:current.catalog,plan});return true;
        }
        if(url.pathname==='/api/procedures/capture'){
          viewJSON(response,await capture(await bodyJSON(request,maximumRequestBytes),{continueIncomplete:url.searchParams.get('continue')==='1'}));return true;
        }
        if(url.pathname==='/api/procedures/import'){
          const request_id=id(request.headers['x-procedure-request-id']),sha256=request.headers['x-procedure-sha256'],
            declared=request.headers['content-length'];let name;
          try{name=decodeURIComponent(request.headers['x-procedure-name']||'Grid_Procedure.gridprocedure.jsonl.gz');}
          catch{throw Object.assign(new Error('Use the original encoded archive filename.'),{code:'GRID_PROCEDURE_NAME'});}
          need(SHA.test(sha256||'')&&typeof declared==='string'&&/^\d+$/.test(declared)&&Number.isSafeInteger(Number(declared))&&
            Number(declared)>0&&Number(declared)<=maximumArchiveBytes&&typeof name==='string'&&name.length<=255&&!/[\\/\x00-\x1f\x7f]/.test(name),
            'GRID_PROCEDURE_ARCHIVE_INPUT','Keep the complete archive name, byte count and SHA256 within the configured allowance.');
          viewJSON(response,await importArchive({request_id,kind:'import',name,bytes:Number(declared),sha256},request,{continueIncomplete:url.searchParams.get('continue')==='1'}));return true;
        }
      }
      throw Object.assign(new Error('Select an original procedure route and method.'),{code:'GRID_PROCEDURE_ROUTE',statusCode:404});
    },
    close(){
      closing=true;
      if(!closed)closed=(async()=>{
        await Promise.allSettled([...jobs.values()].map(row=>row.promise).concat([...archives.values()]));
        const errors=[];for(const client of borrowers)try{await client.close();borrowers.delete(client);}catch(e){errors.push(errorView(e));}
        if(errors.length)throw Object.assign(new Error('The original procedure borrowers have not fully closed.'),{code:'GRID_PROCEDURE_CLOSE',details:{errors}});
      })().catch(e=>{closed=null;throw e;});
      return closed;
    }
  };
}
