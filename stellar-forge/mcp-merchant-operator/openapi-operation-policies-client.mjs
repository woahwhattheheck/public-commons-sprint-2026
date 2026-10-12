// MIT. Complete policy and review receiving over the original merchant transport.
import {constants} from 'node:fs';
import {open,lstat,link,unlink} from 'node:fs/promises';
import {resolve,dirname,basename,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {openMerchantFileClient} from './retained-download.mjs';
import {SF61_ALIAS,SF61_SHA,sf61Hash as hash,sf61Checked as checked,sf61Plain as plain,sf61Failure as fail} from './sf61-connection.mjs';
import {OPERATION_POLICY_SCHEMA,OPERATION_POLICY_BYTES,OPERATION_POLICY_APPLICATION_BYTES,operationPolicyCanonical} from '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/operation-policy-model.mjs';
import {OPERATION_POLICY_APPLICATION_SCHEMA} from '../../stellar/scf-starforge-20261009/sf61-openapi-seller-import/workspace/operation-policy-record.mjs';
import {parseOperationPolicyFile} from './openapi-operation-policy-file-format.mjs';
const FILE_SCHEMA='stellar-forge.api-operation-policy-file.v1';
const ID=/^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
export const operationPolicyCommands=Object.freeze({
 list:'merchant_openapi_operation_policies',load:'merchant_openapi_operation_policy_load',
 save:'merchant_openapi_operation_policy_save',review:'merchant_openapi_operation_policy_review',
 package:'merchant_openapi_operation_policy_package'
});
async function connect(options) {
 if(options.client!==undefined) {
  if(!options.client||typeof options.client.call!=='function'||options.url!==undefined)
   throw fail('INVALID_PARAMS','Choose the original merchant client or its endpoint once.');
  return options.client;
 }
 return openMerchantFileClient({url:options.url,tokenEnv:options.tokenEnv,environment:options.environment,
  signal:options.signal,errorPrefix:'OPENAPI_OPERATION_POLICY',clientName:'starforge-operation-policies'});
}
function requestSnapshot(request,name) {
 if(!plain(request))throw fail('INVALID_PARAMS','Supply the complete original merchant argument object.');
 const selected=structuredClone(request),text=JSON.stringify({jsonrpc:'2.0',id:'operation-policy',method:'tools/call',params:{name,arguments:selected}});
 if(Buffer.byteLength(text)>131072)
  throw fail('OPENAPI_OPERATION_POLICY_REQUEST_TOO_LARGE','The complete merchant request exceeds 128 KiB. Declare the complete source, plan, policy, application and worksheet files on the original host.');
 return selected;
}
export async function callOpenApiOperationPolicy(options={}) {
 const name=operationPolicyCommands[options.operation];
 if(!name)throw fail('INVALID_PARAMS','Choose list, load, save, review or package.');
 const request=requestSnapshot(options.request,name),client=await connect(options);
 return client.call(name,request);
}
async function regular(path,maximum) {
 const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
 try {
  const before=await file.stat();
  if(!before.isFile()||before.size<1||before.size>maximum)
   throw fail('OPENAPI_OPERATION_POLICY_FILE_INVALID','Select a complete regular policy or application file within its original size limit.');
  const bytes=await file.readFile(),after=await file.stat();
  if(bytes.length!==before.size||after.size!==before.size||after.mtimeMs!==before.mtimeMs||after.ctimeMs!==before.ctimeMs)
   throw fail('OPENAPI_OPERATION_POLICY_FILE_CHANGED','The original file changed during receiving.');
  return bytes;
 } finally {await file.close();}
}
export async function readOpenApiOperationPolicy({path,expectedSha256,kind='policy'}={}) {
 if(typeof path!=='string'||!path||!['policy','application'].includes(kind))
  throw fail('INVALID_PARAMS','Choose the complete original file and policy or application kind.');
 const bytes=await regular(resolve(path),kind==='policy'?OPERATION_POLICY_BYTES:OPERATION_POLICY_APPLICATION_BYTES),sha256=hash(bytes);
 if(expectedSha256!==undefined&&checked(expectedSha256,SF61_SHA,'file SHA256')!==sha256)
  throw fail('OPENAPI_OPERATION_POLICY_FILE_CHANGED','The selected file differs from its original SHA256.');
 return {...parseOperationPolicyFile(bytes,kind),kind,bytes:bytes.length,sha256};
}
function metadata(value,kind) {
 if(!plain(value)||value.schema!==FILE_SCHEMA||value.kind!==kind||
  value.documentSchema!==(kind==='policy'?OPERATION_POLICY_SCHEMA:OPERATION_POLICY_APPLICATION_SCHEMA)||
  value.filename!==(kind==='policy'?'api-operation-policy.json':'api-operation-policy-application.json')||
  !ID.test(value.policyId??'')||!SF61_SHA.test(value.policySha256??'')||!SF61_SHA.test(value.sha256??'')||
  !Number.isSafeInteger(value.bytes)||value.bytes<1||value.bytes>(kind==='policy'?OPERATION_POLICY_BYTES:OPERATION_POLICY_APPLICATION_BYTES)||
  kind==='application'&&(!SF61_SHA.test(value.sourceSha256??'')||!SF61_SHA.test(value.reviewSha256??'')))
  throw fail('OPENAPI_OPERATION_POLICY_REPLY_INVALID','The original host returned incomplete file metadata.');
 return value;
}
export async function downloadOpenApiOperationPolicy(options={}) {
 const {workspace,request={},path,expectedFileSha256,chunkBytes=196608,signal,onProgress}=options;
 checked(workspace,SF61_ALIAS,'original workspace alias');
 if(!plain(request)||['workspace','offset','chunkBytes','expectedFileSha256'].some(key=>Object.hasOwn(request,key))||
  !['policy','application'].includes(request.kind)||typeof path!=='string'||!path||
  !Number.isSafeInteger(chunkBytes)||chunkBytes<1||chunkBytes>196608)
  throw fail('INVALID_PARAMS','Choose a complete policy/file request, destination and chunk size from 1 to 196608.');
 if(expectedFileSha256!==undefined)checked(expectedFileSha256,SF61_SHA,'file SHA256');
 const selected=requestSnapshot(request,'merchant_openapi_operation_policy_file'),kind=selected.kind;
 const client=await connect(options),target=resolve(path),parent=await lstat(dirname(target));
 if(!parent.isDirectory()||parent.isSymbolicLink())throw fail('INVALID_PARAMS','Choose an existing receiving directory.');
 const pieces=[];let file,offset=0;
 for(;;) {
  signal?.throwIfAborted();
  const call={workspace,...selected,offset,chunkBytes,
   ...(file||expectedFileSha256?{expectedFileSha256:file?.sha256??expectedFileSha256}:{}),
   ...(file&&kind==='policy'?{policySha256:file.policySha256}:{}),
   ...(file?.reviewSha256?{expectedReviewSha256:file.reviewSha256}:{})};
  const reply=await client.call('merchant_openapi_operation_policy_file',requestSnapshot(call,'merchant_openapi_operation_policy_file')),info=metadata(reply.file,kind);
  if(reply.workspace!==workspace||file&&operationPolicyCanonical(file)!==operationPolicyCanonical(info))
   throw fail('OPENAPI_OPERATION_POLICY_REPLY_INVALID','The selected complete file changed between chunks.');
  file??=info;
  if(expectedFileSha256!==undefined&&file.sha256!==expectedFileSha256)
   throw fail('OPENAPI_OPERATION_POLICY_FILE_CHANGED','The complete file differs from its reviewed SHA256.');
  const bytes=typeof reply.data==='string'?Buffer.from(reply.data,'base64'):Buffer.alloc(0);
  const count=Math.min(chunkBytes,file.bytes-offset),next=offset+count,complete=next===file.bytes;
  if(reply.encoding!=='base64'||bytes.toString('base64')!==reply.data||reply.offset!==offset||reply.bytes!==count||
   bytes.length!==count||reply.complete!==complete||reply.nextOffset!==(complete?null:next))
   throw fail('OPENAPI_OPERATION_POLICY_REPLY_INVALID','Continue the exact original file offset and complete bytes.');
  pieces.push(bytes);offset=next;
  await onProgress?.({bytes:offset,totalBytes:file.bytes,sha256:file.sha256,policySha256:file.policySha256,reviewSha256:file.reviewSha256});
  if(complete)break;
 }
 const bytes=Buffer.concat(pieces,file.bytes);
 if(hash(bytes)!==file.sha256)throw fail('OPENAPI_OPERATION_POLICY_REPLY_INVALID','Complete received file bytes differ from the original digest.');
 const received=parseOperationPolicyFile(bytes,kind);
 if(received.policy.id!==file.policyId||received.policySha256!==file.policySha256||
  kind==='application'&&(received.sourceSha256!==file.sourceSha256||received.reviewSha256!==file.reviewSha256))
  throw fail('OPENAPI_OPERATION_POLICY_REPLY_INVALID','The received document differs from its original file metadata.');
 const existing=async()=>{
  try{if(!(await regular(target,OPERATION_POLICY_APPLICATION_BYTES)).equals(bytes))
   throw fail('OPENAPI_OPERATION_POLICY_DESTINATION_CONFLICT','This receiving name contains another complete file.');
   return true;
  }catch(error){if(error.code==='ENOENT')return false;throw error;}
 };
 let state='REOPENED';
 if(!await existing()) {
  const temporary=join(dirname(target),'.'+basename(target)+'.'+randomUUID()+'.part');let handle;
  try {
   handle=await open(temporary,'wx',0o600);await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
   signal?.throwIfAborted();
   try{await link(temporary,target);state='COMPLETE';}
   catch(error){if(error.code!=='EEXIST'||!await existing())throw error;}
   const directory=await open(dirname(target),constants.O_RDONLY);try{await directory.sync();}finally{await directory.close();}
  }finally{await handle?.close();await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
 }
 return {schema:'stellar-forge.api-operation-policy-download.v1',state,workspace,path:target,file,
  bytes:file.bytes,sha256:file.sha256,policySha256:file.policySha256,...(file.reviewSha256?{reviewSha256:file.reviewSha256,sourceSha256:file.sourceSha256}:{})};
}
