// MIT. Agent execution on the original Analysis owner, with complete native delivery custody.
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { join } from 'node:path';
import { RetainedFileReads } from './retained-file-reads.mjs';
import { WorldBankProgrammeClient } from './worldbank-programme-client.mjs';
import { readWorkflowSeriesPrivateFile, workflowSeriesPrivateDirectory } from './workflow-series-connection.mjs';
import { writeConsoleWorkflowFile, inspectConsoleWorkflowFile } from './console/client-files.mjs';
import { worldBankProgrammeTools, validateWorldBankProgrammeArguments } from './catalog/worldbank-programmes.mjs';
import { WORLDBANK_ALIAS, WORLDBANK_SHA, WORLDBANK_ID, WORLDBANK_MANIFEST_NAME, WORLDBANK_OPERATION_NAME,
  WORLDBANK_DELIVERY_SCHEMA, WORLDBANK_MANIFEST_BYTES, worldBankDescriptor, worldBankFileName,
  parseWorldBankDelivery, encodeWorldBank, digest, canonical, plain, worldBankNeed as need,
  worldBankFailure as fail } from './worldbank-programme-contracts.mjs';
export { readWorldBankProgrammeConfiguration } from './worldbank-programme-connection.mjs';

function mediaType(name) {
  if (name.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (name.endsWith('.zip')) return 'application/zip';
  if (name.endsWith('.json')) return 'application/json';
  if (name.endsWith('.html')) return 'text/html; charset=utf-8';
  if (name.endsWith('.csv')) return 'text/csv; charset=utf-8';
  return 'text/plain; charset=utf-8';
}
export class MerchantWorldBankProgrammeAgent {
  #config; #reads = new RetainedFileReads({ errorPrefix: 'WORLDBANK' });
  #controller = new AbortController(); #pending = new Set(); #clients = new Set(); #exports = new Map();
  #closing = false; #closed = false; #close;
  constructor(config) { this.#config = config; }
  get summary() {
    return { configured: Boolean(this.#config.worldbankProgrammes), ...this.#reads.summary,
      workspaces: Object.entries(this.#config.worldbankProgrammes?.workspaces ?? {}).map(([workspace,value]) =>
        ({ workspace,label:value.label,workspaceId:value.workspaceId,programmes:value.programmes })) };
  }
  #definition(alias,programme) {
    need(typeof alias === 'string' && WORLDBANK_ALIAS.test(alias), 'Select a host-declared Analysis alias.');
    const value = this.#config.worldbankProgrammes?.workspaces[alias];
    need(value, 'Select an original workspace from merchant_worldbank_programme_connections.');
    if (programme !== undefined) need(value.programmes.includes(programme), 'Select a programme declared by this original host.');
    return value;
  }
  async #using(alias,programme,fn) {
    const definition = this.#definition(alias,programme);
    const launch = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readWorkflowSeriesPrivateFile(definition.launchFile,65536)));
    need(!this.#closing,'The World Bank provider is closing.','WORLDBANK_CLOSING');
    const client = new WorldBankProgrammeClient({launch,workspaceId:definition.workspaceId,signal:this.#controller.signal});
    this.#clients.add(client);
    try {
      const state = await client.state();
      return await fn(client,state);
    } finally { client.close(); this.#clients.delete(client); }
  }
  #result(alias,native) {
    return { workspace:alias, operation:native,
      resultSha256:native?.status==='COMPLETE' && plain(native.result) ? digest(encodeWorldBank(native.result)) : null };
  }
  async #root(create=false) {
    await workflowSeriesPrivateDirectory(this.#config.exportsDirectory);
    return workflowSeriesPrivateDirectory(join(this.#config.exportsDirectory,'worldbank-programmes'),create);
  }
  async #directory(exportId,create=false) {
    need(typeof exportId==='string'&&WORLDBANK_SHA.test(exportId),'Select an original World Bank export ID.');
    return workflowSeriesPrivateDirectory(join(await this.#root(create),exportId),create);
  }
  #scope(workspace,exportId) { this.#definition(workspace); need(WORLDBANK_SHA.test(exportId),'Retain the export SHA256.'); return workspace+'\0'+exportId; }
  async #manifest(workspace,exportId) {
    const definition=this.#definition(workspace),directory=await this.#directory(exportId);
    const bytes=await readWorkflowSeriesPrivateFile(join(directory,WORLDBANK_MANIFEST_NAME),WORLDBANK_MANIFEST_BYTES);
    const manifest=parseWorldBankDelivery(bytes,exportId);
    need(manifest.workspace===workspace&&manifest.workspaceId===definition.workspaceId&&definition.programmes.includes(manifest.programme),
      'The retained export belongs to a different original Analysis selection.','WORLDBANK_DELIVERY_CHANGED');
    return {directory,manifest,bytes,manifestFile:{name:WORLDBANK_MANIFEST_NAME,bytes:bytes.length,sha256:digest(bytes),contentType:'application/json'}};
  }
  async #capture(alias,programme,operationId,expectedResultSha256) {
    return this.#using(alias,programme,async client=>{
      const selected=await client.status(programme,operationId),result=selected.result;
      need(selected.workspace_id===client.workspaceId&&selected.name===programme&&selected.operation_id===operationId&&
        selected.status==='COMPLETE'&&result?.status==='COMPLETE'&&Array.isArray(result.files)&&
        digest(encodeWorldBank(result))===expectedResultSha256,
        'Reopen the exact completed native programme and its displayed result SHA256.','WORLDBANK_RESULT_CHANGED');
      need(result.operation_id===operationId && result.workspace?.workspace_id===client.workspaceId,
        'Keep the original completed operation and workspace identity.','WORLDBANK_RESULT_CHANGED');
      const names=new Set(),files=result.files.map(item=>{
        const name=worldBankFileName(item.filename);
        need(!names.has(name)&&name!==WORLDBANK_OPERATION_NAME&&name!==WORLDBANK_MANIFEST_NAME,'Retain each original filename once.');
        names.add(name);return worldBankDescriptor({name,bytes:item.bytes,sha256:item.sha256,contentType:mediaType(name)});
      });
      // Availability is an observation of the current machine, not a change to
      // the accepted original operation. Every other returned field is kept.
      const {downloads,...accepted}=selected;
      const operationBytes=encodeWorldBank(accepted);
      files.push(worldBankDescriptor({name:WORLDBANK_OPERATION_NAME,bytes:operationBytes.length,
        sha256:digest(operationBytes),contentType:'application/json'}));
      const body={schema:WORLDBANK_DELIVERY_SCHEMA,workspace:alias,workspaceId:client.workspaceId,
        programme,operationId,resultSha256:expectedResultSha256,files};
      const exportId=digest(encodeWorldBank(body)),manifest={...body,exportId};
      const manifestBytes=encodeWorldBank(manifest);parseWorldBankDelivery(manifestBytes,exportId);
      const scope=this.#scope(alias,exportId);
      if(this.#exports.has(scope))return this.#exports.get(scope);
      const pending=(async()=>{
        const directory=await this.#directory(exportId,true);
        for(const file of files){
          need(!this.#closing,'The original file capture is closing. Resume this same completed operation.','WORLDBANK_CLOSING');
          if(file.name===WORLDBANK_OPERATION_NAME)await writeConsoleWorkflowFile(join(directory,file.name),operationBytes);
          else await client.download(programme,operationId,file,join(directory,file.name));
        }
        // Publish the manifest only after every declared complete file exists.
        await writeConsoleWorkflowFile(join(directory,WORLDBANK_MANIFEST_NAME),manifestBytes);
        const manifestFile={name:WORLDBANK_MANIFEST_NAME,bytes:manifestBytes.length,sha256:digest(manifestBytes),contentType:'application/json'};
        return {state:'EXPORTED',workspace:alias,exportId,programme,operationId,
          resultSha256:expectedResultSha256,manifestFile,manifest,files};
      })();
      this.#exports.set(scope,pending);
      try{return await pending;}finally{if(this.#exports.get(scope)===pending)this.#exports.delete(scope);}
    });
  }
  async #file(args) {
    const received=await this.#manifest(args.workspace,args.exportId);
    need(received.manifestFile.sha256===args.expectedManifestSha256,'Select the displayed original manifest SHA256.','WORLDBANK_DELIVERY_CHANGED');
    const file=args.file===WORLDBANK_MANIFEST_NAME?received.manifestFile:received.manifest.files.find(v=>v.name===args.file);
    need(file&&file.sha256===args.expectedSha256,'Select an exact original manifest member and SHA256.','WORLDBANK_FILE_CHANGED');
    const result=await this.#reads.read({scope:this.#scope(args.workspace,args.exportId),key:file.name,
      kind:'worldbank-programme',directory:received.directory,expectedSha256:file.sha256,
      readId:args.readId,offset:args.offset??0,limit:args.limit??65536,
      load:async()=>{
        await inspectConsoleWorkflowFile(join(received.directory,file.name),file);
        const handle=await open(join(received.directory,file.name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
        try{
          const stat=await handle.stat();
          need(stat.isFile()&&stat.size===file.bytes&&!(stat.mode&0o077)&&
            (typeof process.getuid!=='function'||stat.uid===process.getuid()),
            'Read the original private retained delivery file.','WORLDBANK_FILE_CHANGED');
          return {readonlyFileHandle:handle,bytes:file.bytes,sha256:file.sha256,name:file.name,type:file.contentType};
        }catch(error){await handle.close();throw error;}
      }});
    return {workspace:args.workspace,exportId:args.exportId,manifestSha256:received.manifestFile.sha256,...result};
  }
  async #execute(action,args) {
    if(action==='connections')return this.summary;
    const {workspace,programme,...input}=args;
    const definition=this.#definition(workspace,programme);
    if(action==='recipe'){
      const {createWorldBankProgrammeRecipe}=await import('./console/worldbank-programme-recipes.mjs');
      const definitions=worldBankProgrammeTools((name,description,properties,required,annotations)=>({name,description,
        inputSchema:{type:'object',properties,required,additionalProperties:false},annotations:{
          readOnlyHint:annotations.readOnly,destructiveHint:false,idempotentHint:true,openWorldHint:false}}));
      return createWorldBankProgrammeRecipe({definitions,workspace,programme,...input});
    }
    if(action==='export')return this.#capture(workspace,programme,input.operationId,input.expectedResultSha256);
    if(action==='manifest'){
      const received=await this.#manifest(workspace,input.exportId);
      return {state:'MANIFEST_RETAINED',workspace,exportId:input.exportId,
        manifestFile:received.manifestFile,manifest:received.manifest};
    }
    if(action==='file')return this.#file(args);
    if(action==='file_release'){
      await this.#reads.release(this.#scope(workspace,input.exportId),input.readId);
      return {state:'RELEASED',workspace,exportId:input.exportId,readId:input.readId};
    }
    return this.#using(workspace,programme,async(client,state)=>{
      switch(action){
        case 'state':return {workspace,native:state};
        case 'list':{const value=await client.list(input);return {...value,programmes:value.programmes.filter(p=>definition.programmes.includes(p.name)),
          operations:value.operations.filter(p=>definition.programmes.includes(p.name))};}
        case 'sources':return client.sources(input);
        case 'definition':return client.definition(programme);
        case 'history':return client.history(programme,input);
        case 'save':return client.save(programme,input.request);
        case 'prepare':return this.#result(workspace,await client.prepare(programme,input.request));
        case 'status':return this.#result(workspace,await client.status(programme,input.operationId));
        case 'review':return client.review(programme,input.operationId);
        case 'publish':{
          let result=await client.publish(programme,input.request);
          if(input.awaitCompletion&&result.status==='RUNNING')
            result=await client.wait(programme,input.request.id,{timeoutMs:input.timeoutMs??120000,pollMs:input.pollMs??500});
          return this.#result(workspace,result);
        }
        case 'reopen':return this.#result(workspace,await client.reopen(programme,input.request));
        case 'wait':{const {operationId,...options}=input;return this.#result(workspace,await client.wait(programme,operationId,options));}
        case 'comparison':{const {comparisonId,...options}=input;return client.comparison(comparisonId,options);}
        default:throw fail('WORLDBANK_AGENT_METHOD','Choose an original declared programme method.');
      }
    });
  }
  call(name,args={}){
    if(this.#closing)return Promise.reject(fail('WORLDBANK_CLOSING','The original provider is closing.'));
    const action=validateWorldBankProgrammeArguments(name,args);
    const pending=Promise.resolve().then(()=>this.#execute(action,args));
    this.#pending.add(pending);pending.then(()=>this.#pending.delete(pending),()=>this.#pending.delete(pending));return pending;
  }
  requestClose(){this.#closing=true;this.#controller.abort();for(const client of this.#clients)client.close();}
  close(){
    if(this.#closed)return Promise.resolve();if(this.#close)return this.#close;
    this.requestClose();
    this.#close=(async()=>{await Promise.allSettled([...this.#pending]);await this.#reads.close();this.#closed=true;})()
      .catch(error=>{this.#close=undefined;throw error;});return this.#close;
  }
}
