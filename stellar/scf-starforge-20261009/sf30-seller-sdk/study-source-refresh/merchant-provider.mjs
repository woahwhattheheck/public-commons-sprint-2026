// MIT. Original Study operations exposed through host-declared Merchant aliases.
import { basename } from 'node:path';
import { studyWorkspaceTools, STUDY_NATIVE_OPERATIONS, STUDY_CONNECTION_SCHEMA } from './agent-contracts.mjs';
import { StudyWorkspaceClient } from './agent-client.mjs';
import { StudyAgentFiles } from './agent-retained.mjs';
import { STUDY_REQUEST_BYTES, STUDY_MAX_JSON_BYTES, need, failure, exact, identifier, hash,
  canonical, plain, readFile, decode, fileIdentity } from './agent-local.mjs';
export { readStudyWorkspaceConfiguration, initializeStudyWorkspaceMerchant } from './agent-setup.mjs';
export { studyWorkspaceTools } from './agent-contracts.mjs';

const operations=Object.fromEntries(Object.keys(STUDY_NATIVE_OPERATIONS).map(operation=>[operation.replaceAll('.','_'),operation]));
const parameterRecord=args=>Object.fromEntries(Object.entries(args).filter(([key])=>key!=='workspace'));
const requestIdentity=(operation,args)=>({operation,argumentsSha256:hash(Buffer.from(canonical(args))),
  ...Object.fromEntries(Object.entries(args).filter(([key,value])=>
    /^(source_id|edition_id|comparison_id|review_id|selection_id|export_id|candidate_id|baseline_id|expected_version|action)$/.test(key)&&
    (typeof value==='string'||typeof value==='number')))});

export class MerchantStudyWorkspaces {
  #config; #clients=new Map(); #files; #pending=new Set(); #closing=false; #close=null;
  constructor(config) {
    this.#config=config;
    this.#files=new StudyAgentFiles(config.exportsDirectory,config.studyWorkspaces?.workspaces??{});
  }
  get summary() {
    return {configured:Boolean(this.#config.studyWorkspaces),workspaces:Object.keys(this.#config.studyWorkspaces?.workspaces??{}),
      clients:[...this.#clients].map(([workspace,client])=>({workspace,...client.summary})),...this.#files.summary};
  }
  #binding(alias) {
    identifier(alias);const binding=this.#config.studyWorkspaces?.workspaces?.[alias];
    need(binding,'STUDY_WORKSPACE_NOT_CONFIGURED','Choose a host-declared original Study workspace.');return binding;
  }
  #client(alias) {
    const binding=this.#binding(alias);
    if(!this.#clients.has(alias))this.#clients.set(alias,new StudyWorkspaceClient(binding));
    return this.#clients.get(alias);
  }
  async #hostInput(alias,key,expected,kind) {
    const binding=this.#binding(alias),input=binding.inputs[identifier(key)];
    need(input&&(!kind||input.kind===kind),'STUDY_INPUT_NOT_CONFIGURED','Choose an input alias of the required original kind.');
    const original=await this.#files.input(alias,{hostInput:key},expected);
    return {...original,input};
  }
  async #value(alias,args,field='value') {
    need((args[field]!==undefined)!==(args.input!==undefined),'STUDY_ONE_JSON_INPUT_REQUIRED',
      'Provide the complete native object inline or one verified original JSON input.');
    if(args[field]!==undefined) {
      need(args.expectedSha256===undefined&&plain(args[field]),'STUDY_JSON_OBJECT_REQUIRED','Use one complete original JSON object.');
      return args[field];
    }
    const selected=await this.#files.input(alias,args.input,args.expectedSha256,STUDY_MAX_JSON_BYTES);
    const bytes=await readFile(selected.path,STUDY_MAX_JSON_BYTES);
    need(hash(bytes)===selected.sha256,'STUDY_INPUT_CHANGED','The original JSON changed before native dispatch.');
    const value=decode(bytes);need(plain(value),'STUDY_JSON_OBJECT_REQUIRED','Use an original JSON object.');return value;
  }
  async #execute(name,args) {
    const definition=studyWorkspaceTools.find(tool=>tool.name===name);
    need(definition,'STUDY_TOOL_UNKNOWN','Choose an original Study tool.');
    exact(args,Object.keys(definition.inputSchema.properties),definition.inputSchema.required);
    const verb=name.slice('merchant_study_'.length),alias=args.workspace;
    if(verb==='workspaces')return {schema:STUDY_CONNECTION_SCHEMA,
      workspaces:Object.entries(this.#config.studyWorkspaces?.workspaces??{}).map(([workspace,binding])=>({
        workspace,label:binding.label,selectionSha256:binding.selectionSha256,sourceSha256:binding.sourceSha256,
        allowStart:binding.allowStart,inputs:Object.keys(binding.inputs),acquisitions:Object.keys(binding.acquisitions)}))};
    const binding=this.#binding(alias);
    if(verb==='inputs') {
      if(args.input===undefined)return {workspace:alias,inputs:Object.entries(binding.inputs).map(([input,file])=>({
        input,label:file.label,kind:file.kind,mediaType:file.mediaType,provider:file.provider??null,declaredSha256:file.sha256??null})),
        acquisitions:Object.entries(binding.acquisitions).map(([acquisition,value])=>({
          acquisition,label:value.label,provider:value.provider}))};
      const file=binding.inputs[identifier(args.input)];
      need(file,'STUDY_INPUT_NOT_CONFIGURED','Choose an original host input alias.');
      const identity=await fileIdentity(file.file);
      need(!file.sha256||identity.sha256===file.sha256,'STUDY_INPUT_CHANGED','The declared original input hash changed.');
      return {workspace:alias,input:args.input,name:basename(file.file),...identity,kind:file.kind,
        provider:file.provider??null,mediaType:file.mediaType};
    }
    if(verb==='snapshot')return this.#files.view(alias,args);
    if(verb==='rows')return this.#files.rows(alias,args);
    if(verb==='file_read')return this.#files.read(alias,args);
    if(verb==='file_release') {await this.#files.release(alias,args);return {state:'RELEASED',workspace:alias,snapshotId:args.snapshotId,readId:args.readId};}
    if(verb==='receive_begin')return this.#files.begin(alias,args);
    if(verb==='receive_chunk')return this.#files.chunk(alias,args);
    if(verb==='receive_status')return this.#files.status(alias,args);
    if(verb==='receive_commit')return this.#files.commit(alias,args);
    const client=this.#client(alias);
    if(verb==='inspect')return client.inspect();
    if(verb==='open')return client.open({expectedSelectionSha256:args.expectedSelectionSha256});
    if(verb==='close')return client.detach(args.expectedInstanceId);
    if(verb==='browser')return client.browser();
    const rest=parameterRecord(args);
    if(verb==='download') {
      const original=await client.download(rest,await this.#files.temporary(alias));
      return this.#files.retain(alias,original,requestIdentity('download',rest));
    }
    if(verb==='package_import') {
      const file=await this.#files.input(alias,args.input,args.expectedSha256);
      const original=await client.importPackage({path:file.path,bytes:file.bytes,sha256:file.sha256});
      return this.#files.retain(alias,original,{operation:'package.import',inputSha256:file.sha256,inputBytes:file.bytes});
    }
    const operation=operations[verb];need(operation,'STUDY_TOOL_UNKNOWN','Choose an original Study operation.');
    let native=rest;
    if(verb==='source_import') {
      const selected=await this.#hostInput(alias,args.hostInput,args.expectedSha256,'source');
      native={provider:selected.input.provider,source:selected.path,node:binding.nodeExecutable};
    } else if(verb==='source_receive_files'||verb==='source_receive_rows') {
      const acquisition=binding.acquisitions[identifier(args.acquisition)];
      need(acquisition,'STUDY_ACQUISITION_NOT_CONFIGURED','Choose an existing original SF88 acquisition alias.');
      native={checkout:acquisition.checkout,session:acquisition.session,node:binding.nodeExecutable,
        ...(verb==='source_receive_files'?{provider:acquisition.provider,
          ...(args.expected_capture_id===undefined?{}:{expected_capture_id:args.expected_capture_id})}:
          {source_id:args.source_id,projection:args.projection})};
    } else if(verb==='source_receive_scan') {
      const selected=await this.#hostInput(alias,args.hostInput,args.expectedSha256,'scan');
      const {hostInput,expectedSha256,...target}=rest;
      native={...target,scan_file:selected.path,node:binding.nodeExecutable};
    } else if(['portfolio_freeze','mapping_freeze','property_study_freeze'].includes(verb)) {
      native={value:await this.#value(alias,args),...(verb==='property_study_freeze'?{document_ids:args.document_ids}:{})};
    } else if(verb==='property_document_import') {
      const selected=await this.#files.input(alias,args.input,args.expectedSha256);
      native={path:selected.path,metadata:args.metadata};
    } else if(verb==='property_intake'||verb==='property_edition_revise') {
      const {input,expectedSha256,...body}=rest;
      if(verb==='property_intake'&&input!==undefined) {
        need(body.packet===undefined,'STUDY_ONE_JSON_INPUT_REQUIRED','Choose one complete original property intake.');
        const selected=await this.#files.input(alias,input,expectedSha256,STUDY_MAX_JSON_BYTES);
        native={...body,path:selected.path};
      } else native={...body,packet:await this.#value(alias,args,'packet')};
    } else if(verb==='export_verify') {
      const status=await client.call('status');
      const record=status.value?.ok===true?status.value.result.exports.find(item=>item.id===args.export_id):null;
      need(record,'STUDY_EXPORT_NOT_FOUND','Select an export in this original workspace.');
      native={directory:record.directory};
    }
    const original=await client.call(operation,native);
    return this.#files.retain(alias,original,requestIdentity(operation,native));
  }
  async call(name,args={}) {
    need(!this.#closing,'STUDY_CLOSING','The original Study provider is closing.');
    const pending=this.#execute(name,args);this.#pending.add(pending);
    try{return await pending;}finally{this.#pending.delete(pending);}
  }
  close() {
    this.#closing=true;
    if(!this.#close)this.#close=(async()=>{
      await Promise.allSettled([...this.#pending]);await this.#files.close();
      const results=await Promise.allSettled([...this.#clients.values()].map(client=>client.close()));
      need(results.every(value=>value.status==='fulfilled'),'STUDY_SHUTDOWN_INCOMPLETE',
        'An original owned operator has not completed its shutdown.');
    })().catch(error=>{this.#close=null;throw error;});
    return this.#close;
  }
}
