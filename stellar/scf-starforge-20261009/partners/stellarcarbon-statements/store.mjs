// MIT. Original merchant private-file and kernel-lease primitives retain the editable workspace.
import {randomUUID,createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {privateDirectory,makePrivate,regular,saveJSON,operationLease} from '../../distribution/runtime-workspace/storage.mjs';
import {copy,need,TABLES,receiveBackup} from './source.mjs';
import {newWorkspace,validateWorkspace,mutate,canonical,workspaceOverview,receiveHandover,exportHandover} from './engine.mjs';
export const MAX_INPUT_BYTES=128*1024*1024;
const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
export const digest=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
export const sourceDigest=source=>digest({format:source.format,files:source.files,responses:source.responses,tables:source.tables});
export function sealSource(source){return {...copy(source),sha256:sourceDigest(source)};}
export function verifySources(state){
  validateWorkspace(state);
  for(const source of state.editions)need(source.sha256===sourceDigest(source),'SOURCE_EDITION_CHANGED','Restore the complete original source edition.');
  return state;
}
export async function readNativeDirectory(directory){
  const files={};
  for(const table of Object.keys(TABLES))files[table]=decode(await regular(join(resolve(directory),table+'.ndjson'),MAX_INPUT_BYTES));
  let metadata={};
  try{metadata=JSON.parse(decode(await regular(join(resolve(directory),'manifest.json'),1000000)));}
  catch(error){if(error.code!=='ENOENT')throw error;}
  return sealSource(receiveBackup(files,metadata));
}
export async function inspectBinding(directory){
  directory=await privateDirectory(resolve(directory));
  const state=JSON.parse(decode(await regular(join(directory,'workspace.json'),512*1024*1024)));
  validateWorkspace(state);
  return {directory,workspaceId:state.workspaceId};
}
export class StellarcarbonWorkspace{
  constructor(directory,state,lease){this.directory=directory;this.state=state;this.lease=lease;this.queue=Promise.resolve();this.closed=false;}
  static async create(directory,{name='Stellarcarbon statements',handover}={}){
    directory=resolve(directory);
    try{await makePrivate(directory);}catch(error){if(error.code!=='EEXIST')throw error;await privateDirectory(directory);}
    const lease=await operationLease(join(directory,'.workspace-lease'));
    try{
      const state=handover?verifySources(receiveHandover(handover)):newWorkspace({workspaceId:randomUUID(),name});
      await saveJSON(join(directory,'workspace.json'),state);
      return new StellarcarbonWorkspace(directory,state,lease);
    }catch(error){await lease.close();throw error;}
  }
  static async open(directory,{expectedWorkspaceId}={}){
    directory=await privateDirectory(resolve(directory));
    const lease=await operationLease(join(directory,'.workspace-lease'));
    try{
      const state=verifySources(JSON.parse(decode(await regular(join(directory,'workspace.json'),512*1024*1024))));
      need(!expectedWorkspaceId||state.workspaceId===expectedWorkspaceId,'WORKSPACE_ID_CHANGED','Reopen the selected original workspace.',409);
      return new StellarcarbonWorkspace(directory,state,lease);
    }catch(error){await lease.close();throw error;}
  }
  serial(work){
    need(!this.closed,'WORKSPACE_CLOSED','Reopen the workspace.');
    const result=this.queue.then(work);this.queue=result.catch(()=>{});return result;
  }
  async overview(){return this.serial(()=>workspaceOverview(this.state));}
  async snapshot(){return this.serial(()=>copy(this.state));}
  async applyUnlocked(action,value,options={}){
    const actor=options.actor||'Local operator';
    const operation={action,value,revision:options.revision,actor,requestId:options.requestId||randomUUID(),
      recordId:randomUUID(),at:new Date().toISOString(),intentSha256:digest({action,value,actor})};
    const output=mutate(this.state,operation);
    if(!output.replayed){await saveJSON(join(this.directory,'workspace.json'),output.state,true);this.state=output.state;}
    return {...output.result,revision:this.state.revision,replayed:output.replayed,requestId:operation.requestId,workspaceId:this.state.workspaceId};
  }
  async apply(action,value,options={}){
    return this.serial(()=>this.applyUnlocked(action,value,options));
  }
  async import(source,label,options={}){
    return this.apply('import',{source:sealSource(source),label},options);
  }
  async handover(){return this.serial(()=>exportHandover(this.state));}
  async saveCapture(checkpoint){
    await saveJSON(join(this.directory,'api-capture.json'),checkpoint,true);
  }
  async captureCheckpoint(){
    try{return JSON.parse(decode(await regular(join(this.directory,'api-capture.json'),512*1024*1024)));}
    catch(error){if(error.code==='ENOENT')return undefined;throw error;}
  }
  async close(){if(this.closed)return;await this.queue;this.closed=true;await this.lease.close();}
}
