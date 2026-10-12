// MIT. Private host declarations for the original supplier-order workspace.
import { constants } from 'node:fs';
import { open, lstat, realpath, mkdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { exact, failure, identifier, line, plain, privateSupportDirectory, writePrivate } from './host-files.mjs';

export const SUPPLIER_ORDER_CONNECTION_SCHEMA='stellar-forge.supplier-order-workspace-connection.v1';
const MAX_XML=64*1024*1024,MAX_PACKAGE=8*1024*1024*1024;
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const same=(left,right)=>['dev','ino','size','mtimeNs','ctimeNs'].every(key=>left[key]===right[key]);
function hostPath(value,base){
  if(typeof value!=='string'||!value||value.includes('\0'))throw failure('CONFIGURATION_ERROR','Select original paths in the private host connection file.');
  return resolve(base,value);
}
function flat(value){
  if(typeof value!=='string'||!value||value.length>240||/[\\/\x00-\x1f\x7f]/.test(value)||['.','..'].includes(value))
    throw failure('CONFIGURATION_ERROR','Keep the original complete flat input filename.');
  return value;
}
function inputDeclaration(raw,base){
  exact(raw,['path','name','bytes','sha256','kind','provenance'],['path','name','bytes','sha256','kind']);
  if(!['xml','workspace','draft'].includes(raw.kind))throw failure('CONFIGURATION_ERROR','Host input kind must be xml, workspace or draft.');
  const maximum=raw.kind==='workspace'?MAX_PACKAGE:MAX_XML;
  if(!Number.isSafeInteger(raw.bytes)||raw.bytes<1||raw.bytes>maximum||typeof raw.sha256!=='string'||!/^[a-f0-9]{64}$/.test(raw.sha256))
    throw failure('CONFIGURATION_ERROR','Each selected original input needs its exact positive byte length and SHA-256.');
  if(raw.provenance!==undefined&&(!plain(raw.provenance)||Buffer.byteLength(JSON.stringify(raw.provenance))>32768))
    throw failure('CONFIGURATION_ERROR','Keep original source provenance as a complete JSON object within32 KiB.');
  return Object.freeze({path:hostPath(raw.path,base),name:flat(raw.name),bytes:raw.bytes,sha256:raw.sha256,kind:raw.kind,
    ...(raw.provenance===undefined?{}:{provenance:JSON.parse(JSON.stringify(raw.provenance))})});
}
async function pinnedBytes(file,expected){
  const bytes=Buffer.allocUnsafe(expected);let offset=0;
  while(offset<expected){const read=await file.read(bytes,offset,Math.min(65536,expected-offset),offset);if(!read.bytesRead)throw failure('SUPPLIER_ORDER_INPUT_CHANGED','The selected original file ended before its retained byte length.');offset+=read.bytesRead;}
  if((await file.read(Buffer.alloc(1),0,1,expected)).bytesRead)throw failure('SUPPLIER_ORDER_INPUT_CHANGED','The selected original file grew beyond its retained byte length.');
  return bytes;
}
async function privateJson(path){
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await file.stat({bigint:true});
    if(!before.isFile()||before.size<1n||before.size>1048576n||process.platform!=='win32'&&
        ((before.mode&0o077n)!==0n||process.getuid&&before.uid!==BigInt(process.getuid())))
      throw failure('CONFIGURATION_ERROR','Use an owned private regular connection file of at most1 MiB.');
    const bytes=await pinnedBytes(file,Number(before.size)),after=await file.stat({bigint:true});
    if(!same(before,after)||BigInt(bytes.length)!==before.size)throw failure('CONFIGURATION_ERROR','The selected connection changed while it was read.');
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
    catch{throw failure('CONFIGURATION_ERROR','The complete private connection must contain UTF-8 JSON.');}
  }finally{await file.close();}
}
/** Read configuration only. Input bodies and native databases remain closed until selected. */
export async function readSupplierOrderWorkspaceConfiguration(path){
  path=resolve(path);const raw=await privateJson(path);
  exact(raw,['schema','workspaces'],['schema','workspaces']);
  if(raw.schema!==SUPPLIER_ORDER_CONNECTION_SCHEMA||!plain(raw.workspaces)||
      Object.keys(raw.workspaces).length<1||Object.keys(raw.workspaces).length>32)
    throw failure('CONFIGURATION_ERROR','Declare1–32 original supplier-order workspace aliases.');
  const base=dirname(path),workspaces=Object.create(null),directories=new Set();
  for(const [alias,item]of Object.entries(raw.workspaces)){
    identifier(alias,'Supplier-order workspace alias');
    exact(item,['label','directory','inputs'],['directory']);
    const directory=await realpath(hostPath(item.directory,base));await privateSupportDirectory(directory);
    const info=await lstat(directory);
    if(process.platform!=='win32'&&process.getuid&&info.uid!==process.getuid())
      throw failure('CONFIGURATION_ERROR','The native supplier-order directory must belong to the host user.');
    if(directories.has(directory))throw failure('CONFIGURATION_ERROR','Give each native directory one supplier-order alias.');
    directories.add(directory);
    const declared=item.inputs??{};
    if(!plain(declared)||Object.keys(declared).length>256)throw failure('CONFIGURATION_ERROR','Declare up to256 complete original input aliases.');
    const inputs=Object.create(null);
    for(const [inputId,input]of Object.entries(declared)){
      identifier(inputId,'Original input alias');inputs[inputId]=inputDeclaration(input,base);
    }
    workspaces[alias]=Object.freeze({label:line(item.label??alias,'Supplier-order workspace label'),directory,inputs:Object.freeze(inputs)});
  }
  return Object.freeze({workspaces:Object.freeze(workspaces)});
}
export function supplierOrderInputSummary(inputId,input){
  return{inputId,kind:input.kind,name:input.name,bytes:input.bytes,sha256:input.sha256,
    ...(input.provenance===undefined?{}:{provenance:JSON.parse(JSON.stringify(input.provenance))})};
}
/** Host-declared large JSON is read once through a stable, exact original descriptor. */
export async function readSupplierOrderDraftInput(input){
  if(input.kind!=='draft')throw failure('SUPPLIER_ORDER_INPUT_KIND','Select the original host draft JSON input.');
  const file=await open(input.path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try{
    const before=await file.stat({bigint:true});
    if(!before.isFile()||before.size!==BigInt(input.bytes)||before.size>BigInt(MAX_XML))
      throw failure('SUPPLIER_ORDER_INPUT_CHANGED','The selected draft input differs from its retained byte length.');
    const bytes=await pinnedBytes(file,input.bytes),after=await file.stat({bigint:true});
    if(!same(before,after)||bytes.length!==input.bytes||sha(bytes)!==input.sha256)
      throw failure('SUPPLIER_ORDER_INPUT_CHANGED','The complete draft input differs from its retained SHA-256 or descriptor identity.');
    try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
    catch{throw failure('SUPPLIER_ORDER_INPUT_JSON','The complete native draft request must contain original UTF-8 JSON.');}
  }finally{await file.close();}
}
/** Create the maintained merchant configuration around already-selected native workspaces. */
export async function initializeSupplierOrderMerchant({directory,connection,releaseStore,name='Starforge supplier-order desk'}={}){
  const root=resolve(directory),selectedConnection=hostPath(connection,process.cwd());
  name=line(name,'Merchant name');
  const selection=await readSupplierOrderWorkspaceConfiguration(selectedConnection);
  const release=await import('../../stellar/scf-starforge-20261009/sf82-seller-pilot/releases.mjs');
  const existing=releaseStore===undefined?null:hostPath(releaseStore,process.cwd());
  if(existing)await release.readReleaseState(existing);
  await mkdir(root,{mode:0o700});
  const selectedStore=existing??join(root,'releases');if(!existing)await release.initReleaseStore(selectedStore);
  await mkdir(join(root,'customer-exports'),{mode:0o700});
  const configuration=join(root,'merchant-mcp.json');
  const {CONFIG_SCHEMA,readMerchantConfig}=await import('./config.mjs');
  await writePrivate(configuration,{schema:CONFIG_SCHEMA,name,releaseStore:selectedStore,exportsDirectory:'./customer-exports',
    sources:{},supplierOrderWorkspaceConnection:selectedConnection});
  await readMerchantConfig(configuration);
  return{schema:CONFIG_SCHEMA,configuration,state:'INITIALIZED',supplierOrdersConfigured:true,
    workspaces:Object.entries(selection.workspaces).map(([workspace,entry])=>({workspace,label:entry.label})),
    authoring:'OPENED_BY_MERCHANT_SUPPLIER_ORDER_OPEN',existingReleaseStore:Boolean(existing)};
}
