// MIT. Installed Woo ERP client and complete original-file receiving.
import { join, resolve } from 'node:path';
import { createRetainedDownload, openMerchantFileClient } from './retained-download.mjs';
import { wooErpClientOperations, validateWooErpArguments } from './woo-erp-schema.mjs';
import { ERP_FILE_LIMIT, erpFailure, erpDigest, readPrivateErpFile, erpParseJson,
 originalErpInput, parseWooErpManifest } from './woo-erp-artifacts.mjs';
export { wooErpClientOperations };
const ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/,HASH=/^[a-f0-9]{64}$/;
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
function need(value,code,message){if(!value)throw erpFailure('CLIENT_'+code,message);}
function selected(options){
 need(plain(options)&&['mapping','project'].includes(options.kind)&&HASH.test(options.id??'')&&ALIAS.test(options.exportId??''),
  'SELECTION_INVALID','Select the original artifact kind, native operation/map ID and retained export alias.');
 return {kind:options.kind,id:options.id,exportId:options.exportId};
}
function receiver(store,selection,client){
 const bound={endpoint:client.endpoint+'|woo-erp:'+store+':'+selection.kind+':'+selection.id,async call(name,args,options){
  need(args.exportId===selection.exportId,'EXPORT_CHANGED','Continue the same original retained export.');
  const result=await client.call(name,{store,...selection,...args},options);
  need(result?.store===store&&result.kind===selection.kind&&result.id===selection.id&&result.exportId===selection.exportId,
   'IDENTITY_CHANGED','The returned ERP file belongs to another store or original artifact.');
  return result;
 }};
 const engine=createRetainedDownload({
  manifestName:'manifest.json',parseManifest:(bytes,exportId)=>parseWooErpManifest(bytes,{store,...selection,exportId}),
  maximumBytes:ERP_FILE_LIMIT,stateSchema:'stellar-forge.sf104.erp-download-state.v1',
  resultSchema:'stellar-forge.sf104.erp-download.v1',toolPrefix:'merchant_woo_erp_export',
  errorPrefix:'WOO_ERP',clientName:'starforge-woo-erp',
  describe:manifest=>({store,kind:manifest.kind,id:manifest.id,revision:manifest.revision,nativeSha256:manifest.nativeSha256})
 });
 return {engine,client:bound};
}
/** Use the original authenticated merchant MCP endpoint, or an explicit host-owned
 * native client with endpoint/call. No ERP credentials enter this client.
 */
export async function openWooErpClient({store,url,client:supplied,tokenEnv='MCP_ACCESS_TOKEN',environment=process.env,signal}={}){
 need(ALIAS.test(store??''),'STORE_REQUIRED','Select the host-declared original Woo store alias.');
 need(supplied===undefined||plain(supplied)&&typeof supplied.call==='function'&&typeof supplied.endpoint==='string'&&
  supplied.endpoint.length>0&&supplied.endpoint.length<=3800&&!/[\0\r\n]/.test(supplied.endpoint)&&url===undefined,
  'CONNECTION_INVALID','Supply one original native MCP client or its authenticated HTTP URL.');
 const original=supplied??await openMerchantFileClient({url,tokenEnv,environment,signal,errorPrefix:'WOO_ERP',clientName:'starforge-woo-erp'});
 async function call(command,args={},options={}){
  const name=wooErpClientOperations[command]??command;
  need(plain(args)&&(args.store===undefined||args.store===store),'STORE_CHANGED','This client remains attached to its selected original Woo store.');
  const body={...args,store};validateWooErpArguments(name,body);
  const result=await original.call(name,body,{timeoutMs:90000,...options});
  need(result?.store===store,'IDENTITY_CHANGED','The ERP response belongs to another configured Woo store.');
  return result;
 }
 return Object.freeze({store,endpoint:original.endpoint,call,
  async inspectExport(options){
   const selection=selected(options),download=receiver(store,selection,original);
   return download.engine.inspect({client:download.client,exportId:selection.exportId});
  },
  async download(options){
   need(HASH.test(options?.expectedManifestSha256??''),'MANIFEST_REQUIRED','Retain the exact original export manifest SHA256 before downloading.');
   const selection=selected(options),download=receiver(store,selection,original);
   const {kind,id,exportId,...rest}=options;
   need(rest.url===undefined&&rest.client===undefined,'CONNECTION_CHANGED','Use this original client connection for the complete download.');
   const result=await download.engine.download({...rest,client:download.client,exportId});
   const verified=await inspectReceivedWooErp({directory:result.directory,expectedManifestSha256:result.manifestSha256,
    store,kind,id,exportId});
   return {...result,native:verified.native};
  }
 });
}
/** Inspect a complete received mapping/project in its original private directory.
 * The native project digest is checked after the transport file hashes.
 */
export async function inspectReceivedWooErp({directory,expectedManifestSha256,store,kind,id,exportId}={}){
 need(typeof directory==='string'&&directory.length>0&&!directory.includes('\0')&&HASH.test(expectedManifestSha256??''),
  'RECEIVING_SELECTION','Choose the original received directory and its exact manifest SHA256.');
 const root=resolve(directory),manifestBytes=await readPrivateErpFile(join(root,'manifest.json'),65000);
 need(erpDigest(manifestBytes)===expectedManifestSha256,'MANIFEST_CHANGED','The received manifest differs from its selected original SHA256.');
 const manifest=parseWooErpManifest(manifestBytes,{store,kind,id,exportId}),file=manifest.files[0];
 const bytes=await readPrivateErpFile(join(root,file.name));
 need(bytes.length===file.bytes&&erpDigest(bytes)===file.sha256,'FILE_CHANGED','The complete received file differs from its original manifest.');
 const value=erpParseJson(bytes),original=originalErpInput(manifest.kind,value);
 if(manifest.kind==='project'){
  need(original.operation.operationId===manifest.id&&original.operation.revision===manifest.revision&&original.sha256===manifest.nativeSha256,
   'NATIVE_CHANGED','The received project has a different original operation, journal revision or native digest.');
 }else need(value.id===manifest.id&&manifest.nativeSha256===value.id,'NATIVE_CHANGED','The received mapping differs from its original native ID.');
 return {schema:'stellar-forge.sf104.erp-received.v1',state:'COMPLETE',directory:root,manifest,manifestSha256:expectedManifestSha256,
  file:{...file,path:join(root,file.name)},native:manifest.kind==='project'?
   {schema:original.schema,operationId:original.operation.operationId,orderId:original.operation.orderId,revision:original.operation.revision,
    sha256:original.sha256,mappings:original.mappings.length,editions:original.operation.editions?.length??0,
    attempts:original.operation.attempts?.length??0,decisions:original.operation.decisions?.length??0}:
   {schema:original.schema,mapId:value.id,sha256:manifest.nativeSha256}};
}
