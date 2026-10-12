// MIT. Complete retained reviewer operations over the original workbench owner.
import {mkdir,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {realpath} from 'node:fs/promises';
import {readSourceFile,writeSourceFile} from '../workspace.mjs';
import {privateSupportDirectory} from '../../../../../stellar-forge/mcp-merchant-operator/host-files.mjs';
import {RetainedFileReads} from '../../../../../stellar-forge/mcp-merchant-operator/retained-file-reads.mjs';
import {ReviewerConnection} from './connection.mjs';
import {reviewerMerchantTools,validateReviewerArguments} from './catalog.mjs';
import {TOOL_PREFIX,EXPORT_SCHEMA,MANIFEST_NAME,MAX_PACKET_BYTES,MAX_RESPONSE_BYTES,ALIAS,SHA,
  plain,need,checked,decode,encode,digest,canonical,manifestIdentity,parseReviewerExport,jsonPointer} from './contracts.mjs';
export {reviewerMerchantTools} from './catalog.mjs';
async function directory(path) {
  await mkdir(path,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
  await privateSupportDirectory(path);need(await realpath(path)===path,'GRANT_REVIEWER_DIRECTORY_ALIAS');return path;
}
async function immutable(path,bytes) {
  try{return await writeSourceFile(path,bytes);}
  catch(error){
    if(error.code!=='EEXIST')throw error;
    need((await readSourceFile(path,{privateFile:true,maxBytes:MAX_RESPONSE_BYTES+MAX_PACKET_BYTES})).equals(bytes),
      'GRANT_REVIEWER_RETAINED_CHANGED','The existing retained file differs from its original bytes.');
    return {path,bytes:bytes.length,sha256:digest(bytes)};
  }
}
function preview(value) {
  if(Buffer.byteLength(JSON.stringify(value))<=24000)return {value,completeValue:true};
  const summary=plain(value)?Object.fromEntries(Object.entries(value).map(([key,item])=>[key,
    Array.isArray(item)?{kind:'array',items:item.length,pointer:'/'+key.replace(/~/g,'~0').replace(/\//g,'~1')}:
      typeof item==='string'?{kind:'string',characters:item.length}:
      plain(item)?{kind:'object',keys:Object.keys(item)}:item])):{kind:Array.isArray(value)?'array':typeof value,
        ...(Array.isArray(value)?{items:value.length}:{})};
  return {preview:summary,completeValue:false};
}
function packetSource(args) {
  if(args.source==='bundled') {
    need(args.hostInput===undefined && args.base64===undefined && args.expectedSha256===undefined &&
      args.exportActionId===undefined,'GRANT_REVIEWER_INPUT_INVALID');return;
  }
  if(args.source==='host') {
    need(typeof args.hostInput==='string' && args.base64===undefined && args.exportActionId===undefined,
      'GRANT_REVIEWER_INPUT_INVALID','Host intake selects one declared original input alias.');return;
  }
  if(args.source==='export') {
    need(typeof args.exportActionId==='string' && args.base64===undefined && args.expectedSha256===undefined &&
      args.hostInput===undefined,'GRANT_REVIEWER_INPUT_INVALID','Select the original workbench export action UUID.');return;
  }
  need(typeof args.base64==='string' && typeof args.expectedSha256==='string' && args.hostInput===undefined &&
    args.exportActionId===undefined,'GRANT_REVIEWER_INPUT_INVALID','Upload complete original bytes with their reviewed SHA256.');
}
export class MerchantGrantReviewers {
  #config;#clients=new Map();#pending=new Set();#readers=new RetainedFileReads({errorPrefix:'GRANT_REVIEWER'});
  #closing=false;#close=null;
  constructor(config){this.#config=config;}
  get summary(){return {configured:Boolean(this.#config.grantReviewers),
    workspaces:Object.entries(this.#config.grantReviewers?.workspaces??{}).map(([workspace,b])=>({
      workspace,label:b.label,workbenchId:b.workbenchId,allowStart:b.allowStart,selectionSha256:b.selectionSha256,
      inputs:Object.entries(b.inputs).map(([id,v])=>({id,label:v.label,sha256:v.sha256,bytes:v.bytes}))})),
    clients:[...this.#clients].map(([workspace,c])=>({workspace,...c.summary})),...this.#readers.summary,newPayments:0};}
  #binding(alias){
    checked(alias,ALIAS,'workspace alias');const value=this.#config.grantReviewers?.workspaces?.[alias];
    need(value,'GRANT_REVIEWER_NOT_CONFIGURED','Choose a declared original reviewer workspace.');return value;
  }
  #client(alias){
    const binding=this.#binding(alias);
    if(!this.#clients.has(alias))this.#clients.set(alias,new ReviewerConnection(binding));
    return this.#clients.get(alias);
  }
  async #root(alias){
    this.#binding(alias);
    return directory(join(await directory(join(this.#config.exportsDirectory,'grant-reviewers')),alias));
  }
  async #capture(alias,original,source,{kind='native-response',name='original-response.json',extra=[]}={}){
    const bodies=[{name,bytes:original.bytes,contentType:original.contentType??'application/json'},...extra];
    const manifest={schema:EXPORT_SCHEMA,workspace:alias,workbenchId:original.workbenchId,kind,source,
      files:bodies.map(f=>({name:f.name,bytes:f.bytes.length,sha256:digest(f.bytes),contentType:f.contentType}))};
    manifest.exportId=manifestIdentity(manifest);
    const manifestBytes=encode(manifest);parseReviewerExport(manifestBytes,manifest.exportId);
    const descriptor={schema:'stellar-forge.grant-reviewer-merchant-result.v1',workspace:alias,
      workbenchId:original.workbenchId,kind,source,exportId:manifest.exportId,
      manifestSha256:digest(manifestBytes),manifestFile:{name:MANIFEST_NAME,bytes:manifestBytes.length,sha256:digest(manifestBytes)},
      files:manifest.files,...(original.value===undefined?{}:preview(original.value))};
    try {
      const root=await this.#root(alias),payloads=await directory(join(root,'files')),
        manifests=await directory(join(root,'exports'));
      for(const [index,body] of bodies.entries())await immutable(join(payloads,manifest.files[index].sha256),body.bytes);
      await immutable(join(manifests,manifest.exportId+'.json'),manifestBytes);
    } catch(error) {
      return {...descriptor,exportId:null,retention:{state:'FAILED',code:error.code??error.name,
        recovery:source.requestId?
          'The original action returned. Read or repeat that exact saved request UUID after restoring storage; do not issue a new action.':
          'The original read returned. Restore storage and repeat the same read to retain its complete file.'}};
    }
    return {...descriptor,retention:{state:'COMPLETE'}};
  }
  async #manifest(alias,id,expected){
    this.#binding(alias);checked(id,SHA,'export ID');
    const root=await this.#root(alias),bytes=await readSourceFile(join(root,'exports',id+'.json'),{privateFile:true,maxBytes:65000}),
      sha256=digest(bytes),manifest=parseReviewerExport(bytes,id);
    need(manifest.workspace===alias && (expected===undefined || checked(expected,SHA,'manifest SHA256')===sha256),
      'GRANT_REVIEWER_EXPORT_CHANGED','Keep the same original workspace, export and manifest identity.');
    return {root,bytes,sha256,manifest};
  }
  async #body(manifest,file){
    const item=manifest.manifest.files.find(f=>f.name===file);
    need(item,'GRANT_REVIEWER_FILE_NOT_FOUND','Choose a filename from this exact original manifest.');
    const bytes=await readSourceFile(join(manifest.root,'files',item.sha256),{privateFile:true,maxBytes:item.bytes});
    need(bytes.length===item.bytes && digest(bytes)===item.sha256,'GRANT_REVIEWER_RETAINED_CHANGED');
    return {bytes,item};
  }
  async #json(alias,args) {
    const exported=await this.#manifest(alias,args.exportId,args.expectedManifestSha256),{bytes}=await this.#body(exported,args.file);
    const original=jsonPointer(decode(bytes),args.pointer??''),offset=args.offset??0,limit=args.limit??50;
    let value,total,type;
    if(Array.isArray(original)){total=original.length;value=original.slice(offset,offset+limit);type='array';}
    else if(plain(original)){const entries=Object.entries(original);total=entries.length;value=entries.slice(offset,offset+limit);type='object-entries';}
    else if(typeof original==='string'){total=original.length;value=original.slice(offset,offset+limit);type='string';}
    else {need(offset===0,'GRANT_REVIEWER_POINTER_RANGE');total=1;value=original;type=typeof original;}
    need(offset<=total,'GRANT_REVIEWER_POINTER_RANGE');
    const response={exportId:args.exportId,manifestSha256:exported.sha256,file:args.file,
      pointer:args.pointer??'',type,offset,total,value,nextOffset:offset+limit<total?offset+limit:null};
    if(Buffer.byteLength(JSON.stringify(response))>65536)return {...response,value:undefined,
      valueAvailableInOriginalFile:true,message:'This selected value exceeds a tool page. Download the complete original file.'};
    return response;
  }
  async #do(name,args) {
    const action=validateReviewerArguments(name,args);
    if(action==='workspaces')return this.summary;
    if(action==='schema')return {schema:'stellar-forge.grant-reviewer-merchant-api.v1',
      tools:reviewerMerchantTools,originalWorkbench:'stellar-forge.grant-reviewer-workbench.v1',
      originalPacket:'stellar-forge.grant-reviewer-packet.v1',maximumPacketBytes:MAX_PACKET_BYTES,
      lifecycle:'A borrowed original workbench remains owned by Applications. Export drains its original Buyer through the workbench before reading native history.',
      recovery:'Read the saved action UUID or repeat exactly the same UUID, selection revision and inputs after a lost reply.',
      credentials:'Private connection codes remain in the host process. No tool returns them.',newPayments:0};
    const alias=args.workspace,client=this.#client(alias);
    if(action==='workbench_open')return {workspace:alias,...await client.open()};
    if(action==='workbench_release')return {workspace:alias,...await client.release()};
    if(action==='manifest'){
      const saved=await this.#manifest(alias,args.exportId);
      return {state:'MANIFEST_RETAINED',workspace:alias,exportId:args.exportId,
        manifestFile:{name:MANIFEST_NAME,bytes:saved.bytes.length,sha256:saved.sha256},manifest:saved.manifest};
    }
    if(action==='file_release'){
      await this.#readers.release(alias+':'+args.exportId,args.readId);
      return {state:'RELEASED',workspace:alias,exportId:args.exportId,readId:args.readId};
    }
    if(action==='file'){
      const saved=await this.#manifest(alias,args.exportId,args.expectedManifestSha256);
      let file,bytes;
      if(args.file===MANIFEST_NAME){file={name:MANIFEST_NAME,bytes:saved.bytes.length,sha256:saved.sha256,contentType:'application/json'};bytes=saved.bytes;}
      else file=saved.manifest.files.find(f=>f.name===args.file);
      need(file && file.sha256===args.expectedSha256,'GRANT_REVIEWER_FILE_CHANGED','Select the exact manifest file and original SHA256.');
      const result=await this.#readers.read({scope:alias+':'+args.exportId,key:args.file,kind:'grant-reviewer',
        directory:saved.root,expectedSha256:file.sha256,offset:args.offset??0,limit:args.limit??65536,readId:args.readId,
        load:async()=>({name:file.name,type:file.contentType,bytes:bytes??(await this.#body(saved,file.name)).bytes})});
      return {workspace:alias,exportId:args.exportId,manifestSha256:saved.sha256,...result};
    }
    if(action==='json')return this.#json(alias,args);
    const query=(path,values)=>path+'?'+new URLSearchParams(values);
    if(action==='state' || action==='selection' || action==='action'){
      const original=await client.json('GET',action==='selection'?query('/api/selection',{id:args.selectionId}):'/api/state');
      if(action==='action'){
        const record=original.value.operations.find(item=>item.id===args.requestId);
        need(record,'GRANT_REVIEWER_ACTION_NOT_FOUND','The original workbench has no saved action with that UUID.');
        original.value={operation:record,buyer:original.value.buyer,workbenchId:original.workbenchId,instanceId:original.instanceId};
        original.bytes=encode(original.value);
      }
      return this.#capture(alias,original,{action,...(args.selectionId?{selectionId:args.selectionId}:{}),
        ...(args.requestId?{requestId:args.requestId}:{}),instanceId:original.instanceId});
    }
    if(action==='review' || action==='review_export'){
      let input;
      if(action==='review_export'){
        const saved=await this.#manifest(args.sourceWorkspace,args.exportId,args.expectedManifestSha256);
        need(saved.manifest.kind==='reviewer-packet','GRANT_REVIEWER_PACKET_EXPORT_REQUIRED');
        const {bytes,item}=await this.#body(saved,'grant-reviewer-packet.json');
        input={source:'upload',title:args.title,requestId:args.requestId,base64:bytes.toString('base64'),expectedSha256:item.sha256};
      }else{
        packetSource(args);input={source:args.source,title:args.title,requestId:args.requestId};
        if(args.source==='host'){
          const original=await client.hostInput(args.hostInput);
          if(args.expectedSha256!==undefined)need(original.sha256===args.expectedSha256,'GRANT_REVIEWER_INPUT_CHANGED');
          Object.assign(input,{source:'upload',base64:original.bytes.toString('base64'),expectedSha256:original.sha256});
        }else if(args.source==='upload')Object.assign(input,{base64:args.base64,expectedSha256:args.expectedSha256});
        else if(args.source==='export')input.exportId=args.exportActionId;
      }
      const result=await client.json('POST','/api/review',input);
      return this.#capture(alias,result,{action,requestId:args.requestId,
        ...(args.hostInput?{hostInput:args.hostInput}:{}),
        ...(args.sourceWorkspace?{sourceWorkspace:args.sourceWorkspace,exportId:args.exportId,manifestSha256:args.expectedManifestSha256}:{})});
    }
    if(['receive','buyer_open','buyer_close','export'].includes(action)){
      const path={receive:'/api/receive',buyer_open:'/api/open',buyer_close:'/api/close',export:'/api/export'}[action],
        input={requestId:args.requestId,...(args.selectionId?{selectionId:args.selectionId,expectedRevision:args.expectedRevision}:{})},
        original=await client.json('POST',path,input);
      if(action==='export'){
        const packet=await client.request('GET',query('/api/export',{id:args.requestId}));
        need(packet.bytes.length===original.value.export.bytes && digest(packet.bytes)===original.value.export.sha256,
          'GRANT_REVIEWER_EXPORT_CHANGED','The original exported packet differs from its accepted action.');
        return this.#capture(alias,original,{action,requestId:args.requestId,selectionId:args.selectionId,
          packetId:original.value.export.packetId,sourcePacketId:original.value.export.sourcePacketId},
        {kind:'reviewer-packet',name:'operation.json',extra:[{name:'grant-reviewer-packet.json',
          bytes:packet.bytes,contentType:'application/json'}]});
      }
      return this.#capture(alias,original,{action,requestId:args.requestId,...(args.selectionId?{selectionId:args.selectionId}:{})});
    }
    if(action==='document'){
      const selected=await client.json('GET',query('/api/selection',{id:args.selectionId})),
        expected=selected.value.packet.documents[args.index];
      need(expected,'GRANT_REVIEWER_DOCUMENT_NOT_FOUND');
      const original=await client.request('GET',query('/api/document',{id:args.selectionId,index:String(args.index)}));
      need(original.bytes.length===expected.bytes && digest(original.bytes)===expected.sha256,'GRANT_REVIEWER_DOCUMENT_CHANGED');
      let name=expected.path.split('/').at(-1).replace(/[^A-Za-z0-9._-]/g,'_').slice(0,230);
      if(!/^[A-Za-z0-9]/.test(name) || name===MANIFEST_NAME)name='source-'+name;
      return this.#capture(alias,original,{action,selectionId:args.selectionId,index:args.index,
        originalPath:expected.path,sha256:expected.sha256},{kind:'source-document',name});
    }
    if(action==='buyer_read'){
      const connected=await client.nativeClient(),value=await connected.native.call(args.tool,args.arguments??{});
      return this.#capture(alias,{bytes:encode(value),value,contentType:'application/json',
        workbenchId:connected.workbenchId},{action,tool:args.tool,arguments:args.arguments??{},instanceId:connected.instanceId});
    }
    if(action==='buyer_result'){
      const original=await client.savedResult(args.quoteId);
      return this.#capture(alias,original,{action,quoteId:args.quoteId,bytes:original.metadata.bytes,
        sha256:original.metadata.sha256,representation:original.metadata.representation},
      {kind:'saved-result',name:'saved-result.json'});
    }
    throw new Error('Unreachable reviewer action');
  }
  call(name,args={}){
    need(!this.#closing,'GRANT_REVIEWER_CLOSING','The original merchant provider is closing.');
    const promise=this.#do(name,args);this.#pending.add(promise);
    promise.finally(()=>this.#pending.delete(promise)).catch(()=>{});return promise;
  }
  close(){
    if(this.#close)return this.#close;this.#closing=true;
    this.#close=(async()=>{
      await Promise.allSettled([...this.#pending]);
      const results=await Promise.allSettled([this.#readers.close(),
        ...[...this.#clients.values()].map(client=>client.close())]);
      const failed=results.filter(value=>value.status==='rejected').map(value=>value.reason);
      if(failed.length)throw failed.length===1?failed[0]:Object.assign(
        new AggregateError(failed,'Original reviewer cleanup is incomplete.'),{code:'GRANT_REVIEWER_CLOSE_INCOMPLETE'});
    })().catch(error=>{this.#close=null;throw error;});
    return this.#close;
  }
}
