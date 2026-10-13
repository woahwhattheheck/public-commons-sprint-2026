// MIT. Native private files and the original Merchant kernel lease retain complete editable work.
import {randomUUID,createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {privateDirectory,makePrivate,regular,operationLease} from '../../distribution/runtime-workspace/storage.mjs';
import {need,copy,validateSourceEdition} from './source.mjs';
import {writeJSONFile,jsonIdentity} from './native-json.mjs';
import {freezeJSON,isImmutableJSON} from './immutable.mjs';
import {CaptureCheckpointStore} from './checkpoint.mjs';
const saveJSON=(path,value,replace=false)=>writeJSONFile(path,value,{replace});
import {newWorkspace,validateWorkspace,mutate,workspaceOverview,receiveHandover,exportHandover,HANDOVER_SCHEMA} from './engine.mjs';
export const MAX_INPUT_BYTES=128*1024*1024;
export const MAX_WORKSPACE_BYTES=512*1024*1024;
export const decode=bytes=>new TextDecoder('utf-8',{fatal:true}).decode(bytes);
export const digest=value=>typeof value==='string'?createHash('sha256').update(value).digest('hex'):jsonIdentity(value,{canonical:true}).sha256;
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
  #state;
  get state(){return this.#state;}
  constructor(directory,state,lease){this.directory=directory;this.#state=freezeJSON(state);this.lease=lease;this.queue=Promise.resolve();this.closed=false;this.captureStores=new Map();}
  static async create(directory,{name='GiveCredit statements',handover}={}){
    directory=resolve(directory);
    try{await makePrivate(directory);}catch(error){if(error.code!=='EEXIST')throw error;await privateDirectory(directory);}
    const lease=await operationLease(join(directory,'.workspace-lease'));
    try{
      const state=handover?verifySources(receiveHandover(handover,{workspaceId:randomUUID()})):newWorkspace({workspaceId:randomUUID(),name});
      freezeJSON(state);await saveJSON(join(directory,'workspace.json'),state);return new GiveCreditWorkspace(directory,state,lease);
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
  /** Stable immutable version for native projections and streaming; snapshot() stays detached. */
  async readonlySnapshot(){return this.serial(()=>this.state);}
  async readonlyHandover(){return this.serial(()=>freezeJSON({schema:HANDOVER_SCHEMA,exportedAt:new Date().toISOString(),workspace:this.state}));}
  async applyUnlocked(action,value,options={}){
    // Own a detached source before hashing or awaiting persistence. Never freeze
    // an operator's mutable import, and never copy an already owned edition again.
    if(action==='import')value={...value,source:isImmutableJSON(value.source)?value.source:freezeJSON(copy(value.source))};
    const actor=options.actor||'Local operator',operation={action,value,revision:options.revision,actor,requestId:options.requestId||randomUUID(),
      recordId:randomUUID(),at:new Date().toISOString(),intentSha256:digest({action,value,actor})};
    const result=mutate(this.state,operation,{reuseImmutableEditions:true});
    if(!result.replayed){freezeJSON(result.state);await saveJSON(join(this.directory,'workspace.json'),result.state,true);this.#state=result.state;}
    return {...result.result,revision:this.state.revision,workspaceId:this.state.workspaceId,requestId:operation.requestId,replayed:result.replayed};
  }
  async apply(action,value,options={}){return this.serial(()=>this.applyUnlocked(action,value,options));}
  async importUnlocked(source,label,options={}){return this.applyUnlocked('import',{source:freezeJSON(sealSource(source)),label},options);}
  async import(source,label,options={}){return this.serial(()=>this.importUnlocked(source,label,options));}
  async handover(){return this.serial(()=>exportHandover(this.state));}
  captureStore(kind){
    need(['registry','ledger'].includes(kind),'CAPTURE_KIND','Choose registry or ledger capture.');
    if(!this.captureStores.has(kind))this.captureStores.set(kind,CaptureCheckpointStore.open(join(this.directory,kind+'-capture-store'),
      {legacyPath:join(this.directory,kind+'-capture.json'),expectedKind:kind}));
    return this.captureStores.get(kind);
  }
  async saveCapture(kind,checkpoint,options={}){return (await this.captureStore(kind)).save(checkpoint,options);}
  async captureCheckpoint(kind){return (await this.captureStore(kind)).load();}
  async captureStatus(kind){return (await this.captureStore(kind)).status();}
  async exportCapture(kind,path){return (await this.captureStore(kind)).export(path);}
  async importCapture(kind,path){return (await this.captureStore(kind)).importLegacy(path);}
  async releaseCapture(kind){(await this.captureStore(kind)).releaseMemory();}
  async close(){if(this.closed)return;this.closed=true;try{await this.queue;const results=await Promise.allSettled([...this.captureStores.values()].map(async pending=>{const capture=await pending;await capture.queue;capture.releaseMemory();}));const failure=results.find(result=>result.status==='rejected');if(failure)throw failure.reason;}finally{await this.lease.close();}}
}
