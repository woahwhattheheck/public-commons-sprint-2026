// MIT. Configured paths select the original listener; its session owns the token.
import {constants} from 'node:fs';
import {open,realpath} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {CONNECTION_SCHEMA,SESSION_SCHEMA,STORE,plain,exact,need,id,decode} from './contracts.mjs';
export async function privateBytes(file,maximum=1024*1024){
 file=resolve(file);need(await realpath(dirname(file))===dirname(file),'WEBHOOK_OPERATIONS_PRIVATE_PATH_REQUIRED');
 const handle=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const before=await handle.stat({bigint:true});need(before.isFile()&&before.size<=BigInt(maximum)&&!(before.mode&0o077n),'WEBHOOK_OPERATIONS_PRIVATE_FILE_REQUIRED');
 const bytes=await handle.readFile(),after=await handle.stat({bigint:true});need(bytes.length===Number(before.size)&&before.size===after.size&&before.mtimeNs===after.mtimeNs&&before.ctimeNs===after.ctimeNs,'WEBHOOK_OPERATIONS_FILE_CHANGED');return bytes;
 }finally{await handle.close();}
}
export async function privateJson(file,maximum){return decode(await privateBytes(file,maximum));}
function path(base,value){need(typeof value==='string'&&value&&!/[\u0000-\u001f\u007f]/.test(value),'WEBHOOK_OPERATIONS_PATH_REQUIRED');const result=resolve(base,value);need(result!=='/','WEBHOOK_OPERATIONS_PATH_REQUIRED');return result;}
export async function readWebhookFeedConfiguration(file){
 file=resolve(file);const raw=await privateJson(file);exact(raw,['schema','workspaces','receivers'],['schema','workspaces']);
 need(raw.schema===CONNECTION_SCHEMA&&plain(raw.workspaces)&&Object.keys(raw.workspaces).length>0&&Object.keys(raw.workspaces).length<=32,'WEBHOOK_OPERATIONS_CONFIGURATION_INVALID');
 const base=dirname(file),workspaces=Object.create(null),receivers=Object.create(null),dirs=new Set();
 for(const [name,input]of Object.entries(raw.workspaces)){id(name,'workspace alias');exact(input,['label','directory','sessionFile','expectedStoreId'],['directory']);const directory=path(base,input.directory);
 need(!dirs.has(directory),'WEBHOOK_OPERATIONS_DUPLICATE_WORKSPACE');dirs.add(directory);
 if(input.expectedStoreId!==undefined)need(STORE.test(input.expectedStoreId),'WEBHOOK_OPERATIONS_STORE_REQUIRED');
 need(input.label===undefined||typeof input.label==='string'&&input.label.length>0&&input.label.length<=240,'WEBHOOK_OPERATIONS_CONFIGURATION_INVALID');
 workspaces[name]={label:input.label??name,directory,sessionFile:input.sessionFile?path(base,input.sessionFile):join(directory,'.webhook-operations-session.json'),expectedStoreId:input.expectedStoreId??null};}
 need(raw.receivers===undefined||plain(raw.receivers)&&Object.keys(raw.receivers).length<=32,'WEBHOOK_OPERATIONS_CONFIGURATION_INVALID');
 for(const [name,input]of Object.entries(raw.receivers??{})){id(name,'receiver alias');exact(input,['directory'],['directory']);const directory=path(base,input.directory);need(!dirs.has(directory),'WEBHOOK_OPERATIONS_RECEIVER_OVERLAP');dirs.add(directory);receivers[name]={directory};}
 return {schema:CONNECTION_SCHEMA,workspaces,receivers};
}
export async function readWebhookFeedSession(definition){
 const session=await privateJson(definition.sessionFile,32768);
 need(session.schema===SESSION_SCHEMA&&session.state==='READY'&&session.directory===definition.directory&&STORE.test(session.storeId??'')&&(!definition.expectedStoreId||definition.expectedStoreId===session.storeId)&&typeof session.instanceId==='string','WEBHOOK_OPERATIONS_SESSION_CHANGED','Start the configured original Webhook operations application.');
 let url;try{url=new URL(session.url);}catch{need(false,'WEBHOOK_OPERATIONS_SESSION_CHANGED');}
 need(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.pathname==='/'&&!url.username&&!url.password&&!url.search&&/^#token=[A-Za-z0-9_-]{43}$/.test(url.hash),'WEBHOOK_OPERATIONS_SESSION_CHANGED');
 return {session,origin:url.origin,token:url.hash.slice(7)};
}
