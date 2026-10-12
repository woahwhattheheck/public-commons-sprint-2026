// SPDX-License-Identifier: MIT
// Host declaration only. This reader opens no publisher, warehouse or listener.
import {resolve,dirname} from 'node:path';
import {lstat,realpath} from 'node:fs/promises';
import {exact,failure,fileBytes,identifier,line,plain} from './host-files.mjs';
export const LOCAL_DATASET_WORKSPACE_CONNECTION_SCHEMA='stellar-forge.local-dataset-workspace-connection.v1';
export async function readLocalDatasetWorkspaceConfig(path,{publishers}={}){
 path=resolve(path);const info=await lstat(path);
 if(!info.isFile()||info.isSymbolicLink()||await realpath(path)!==path||info.size>1048576||process.platform!=='win32'&&(info.mode&0o077||process.getuid&&info.uid!==process.getuid()))
  throw failure('CONFIGURATION_ERROR','Use an owned canonical private local-dataset connection JSON file up to one MiB.');
 const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await fileBytes(path,1048576)));
 exact(raw,['schema','workspaces'],['schema','workspaces']);
 if(raw.schema!==LOCAL_DATASET_WORKSPACE_CONNECTION_SCHEMA||!plain(raw.workspaces)||Object.keys(raw.workspaces).length<1||Object.keys(raw.workspaces).length>32)
  throw failure('CONFIGURATION_ERROR','Declare one to 32 original local-data customer workspaces.');
 const workspaces=Object.create(null),used=new Set();
 for(const [alias,input]of Object.entries(raw.workspaces)){
  identifier(alias,'Local dataset workspace alias');exact(input,['label','publisher','customer'],['publisher','customer']);exact(input.customer,['name','database','workspaceId'],['name','database','workspaceId']);
  const publisher=identifier(input.publisher,'Publisher alias'),original=publishers?.workspaces?.[publisher];
  if(!original||original.kind!=='frictionless'||used.has(publisher))throw failure('CONFIGURATION_ERROR','Bind each original Frictionless publisher to one local customer alias.');
  const customer=input.customer;
  identifier(customer.name,'Customer alias');
  if(typeof customer.database!=='string'||!customer.database||typeof customer.workspaceId!=='string'||!/^[a-f0-9]{32}$/.test(customer.workspaceId))
   throw failure('CONFIGURATION_ERROR','Declare the original customer directory and persistent 32-hex workspace ID.');
  const database=resolve(dirname(path),customer.database),directory=await lstat(database);
  if(!directory.isDirectory()||directory.isSymbolicLink()||await realpath(database)!==database||process.platform!=='win32'&&(directory.mode&0o077))
   throw failure('CONFIGURATION_ERROR','Use the original canonical private DuckDB workspace directory.');
  if(database===original.directory||database.startsWith(original.directory+'/')||original.directory.startsWith(database+'/'))
   throw failure('CONFIGURATION_ERROR','Keep the original publisher and customer warehouse in distinct directories.');
  used.add(publisher);workspaces[alias]={label:line(input.label??alias,'Workspace label'),publisher,directory:original.directory,customer:{name:customer.name,database,workspaceId:customer.workspaceId}};
 }
 return{workspaces};
}
