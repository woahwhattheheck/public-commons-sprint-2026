// MIT. Native private files and the original Merchant kernel lease retain complete editable work.
import {randomUUID,createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {privateDirectory,makePrivate,regular,saveJSON,operationLease} from '../../distribution/runtime-workspace/storage.mjs';
import {need,copy,validateSourceEdition} from './source.mjs';
import {newWorkspace,validateWorkspace,mutate,canonical,workspaceOverview,receiveHandover,exportHandover} from './engine.mjs';
export const MAX_INPUT_BYTES=128*1024*1024;
export const MAX_WORKSPACE_BYTES=512*1024*1024;
export const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
export const digest=value=>createHash('sha256').update(typeof value==='string'?value:canonical(value)).digest('hex');
export const sourceDigest=source=>digest({kind:source.kind,metadata:source.metadata,files:source.files,
  responses:source.responses,tables:source.tables,carbon:source.carbon||null});
export function sealSource(source){validateSourceEdition(source);return {...copy(source),sha256:sourceDigest(source)};}
export function verifySources(state){
  validateWorkspace(state);
  for(const source of state.editions)need(source.sha256===sourceDigest(source),'SOURCE_EDITION_CHANGED','Restore the complete original source edition.');
  return state;
}
export async function readJSONFile(path,maximum=MAX_INPUT_BYTES){return JSON.parse(decode(await regular(resolve(path),maximum)));}
export async function inspectBinding(directory){
  directory=await privateDirectory(resolve(directory));const state=await readJSONFile(join(directory,'workspace.json'),MAX_WORKSPACE_BYTES);
  validateWorkspace(state);return {directory,workspaceId:state.workspaceId};
}
export class GiveCreditWorkspace{
  constructor(directory,state,lease){this.directory=directory;this.state=state;this.lease=lease;this.queue=Promise.resolve();this.closed=false;}
  static async create(directory,{name='GiveCredit statements',handover}={}){
    directory=resolve(directory);
    try{await makePrivate(directory);}catch(error){if(error.code!=='EEXIST')throw error;await privateDirectory(directory);}
    const lease=await operationLease(join(directory,'.workspace-lease'));
    try{
      const state=handover?verifySources(receiveHandover(handover,{workspaceId:randomUUID()})):newWorkspace({workspaceId:randomUUID(),name});
      await saveJSON(join(directory,'workspace.json'),state);return new GiveCreditWorkspace(directory,state,lease);
    }catch(error){await lease.close();throw error;}
  }
  static async open(directory,{expectedWorkspaceId}={}){
    directory=await privateDirectory(resolve(directory));const lease=await operationLease(join(directory,'.workspace-lease'));
    try{
      const state=verifySources(await readJSONFile(join(directory,'workspace.json'),MAX_WORKSPACE_BYTES));
      need(!expectedWorkspaceId||state.workspaceId===expectedWorkspaceId,'WORKSPACE_ID_CHANGED','Open the selected original workspace.',409);
      return new GiveCreditWorkspace(directory,state,lease);
    }catch(error){await lease.close();throw error;}
  }
  serial(work){need(!this.closed,'WORKSPACE_CLOSED','Reopen the workspace.');const result=this.queue.then(work);this.queue=result.catch(()=>{});return result;}
  async overview(){return this.serial(()=>workspaceOverview(this.state));}
  async snapshot(){return this.serial(()=>copy(this.state));}
  async applyUnlocked(action,value,options={}){
    const actor=options.actor||'Local operator',operation={action,value,revision:options.revision,actor,requestId:options.requestId||randomUUID(),
      recordId:randomUUID(),at:new Date().toISOString(),intentSha256:digest({action,value,actor})};
    const result=mutate(this.state,operation);
    if(!result.replayed){await saveJSON(join(this.directory,'workspace.json'),result.state,true);this.state=result.state;}
    return {...result.result,revision:this.state.revision,workspaceId:this.state.workspaceId,requestId:operation.requestId,replayed:result.replayed};
  }
  async apply(action,value,options={}){return this.serial(()=>this.applyUnlocked(action,value,options));}
  async import(source,label,options={}){return this.apply('import',{source:sealSource(source),label},options);}
  async handover(){return this.serial(()=>exportHandover(this.state));}
  async saveCapture(kind,checkpoint){need(['registry','ledger'].includes(kind),'CAPTURE_KIND','Choose registry or ledger capture.');await saveJSON(join(this.directory,kind+'-capture.json'),checkpoint,true);}
  async captureCheckpoint(kind){
    need(['registry','ledger'].includes(kind),'CAPTURE_KIND','Choose registry or ledger capture.');
    try{return await readJSONFile(join(this.directory,kind+'-capture.json'),MAX_WORKSPACE_BYTES);}
    catch(error){if(error.code==='ENOENT')return undefined;throw error;}
  }
  async close(){if(this.closed)return;await this.queue;this.closed=true;await this.lease.close();}
}
