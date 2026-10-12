// MIT. Complete native Redis/Valkey receiving handover from the original pair.
import {open,lstat,link,unlink} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createScientificArchive} from '../../wqx-water-quality/jobs/archive.mjs';
import {withVerifiedRedisCutover,readRedisCutoverJson,writeRedisCutoverJson} from './cutover.mjs';
import {openRedisCutoverFile,redisCutoverFileDigest} from './cutover-files.mjs';

const encode=value=>JSON.stringify(value,null,2)+'\n';
const sha=value=>createHash('sha256').update(value).digest('hex');
const issue=(code,message)=>Object.assign(new Error(message),{code,status:409});
async function optional(path){
  return readRedisCutoverJson(path).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
}
async function sync(root){const directory=await open(root,'r');try{await directory.sync();}finally{await directory.close();}}
async function ownFile(path){
  const info=await lstat(path).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(info&&(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||process.platform!=='win32'&&
      ((info.mode&0o077)||typeof process.getuid==='function'&&info.uid!==process.getuid())))
    throw issue('REDIS_CUTOVER_HANDOVER_PATH_CHANGED','Keep the original private handover staging file.');
  return info;
}
function readme(context){
  const {selection,retained}=context;
  return [
    '# Redis / Valkey application cutover','',
    'Original cutover: '+selection.input.operationId,
    'Receiving result: '+retained.status,
    'Approved source edition: '+selection.input.consistency.reference,
    'Receiving operator: '+selection.input.consistency.approvedBy,'',
    '## Contents','',
    'cutover-input.json is the complete approved input for the original cutover CLI.',
    'selection.json preserves its original input digest; result.json is the exact retained paired outcome.',
    'Each deployment directory contains its original receiving report, approved commissioning input,',
    'received source revision, and every complete native preview in native-previews.jsonl.',
    'Its customer directory contains the whole original generated client/OpenAPI package when receiving accepted that deployment.',
    'Each differences/ file is the complete original comparison, including rows beyond the operator page.',
    'manifest.json lists every preceding member with its complete byte count and SHA256.','',
    '## Continue the original saved pair','',
    'Use the installed merchant CLI with the existing private cutover directory:',
    '',
    'starforge-merchant redis-cutover-operator open --directory /CUSTOMER/original-cutover',
    '',
    'The operator reopens original reports and native operations. Compare saved results works after both source servers stop.',
    'A live source correction needs a new receiving edition with new original source/setup IDs.',
    'Use New edition in the operator, review the complete corrected profiles, examples and consistency reference, then Receive.','',
    '## Receive this approved contract in a new customer directory','',
    'Set the source environment variables named in the approved inputs, then use the original engine:',
    '',
    'starforge-merchant redis-cutover receive --input ./cutover-input.json --directory /CUSTOMER/new-cutover',
    '',
    'The new directory creates its own original Redis and Valkey authoring workspaces.',
    'Its complete row sequences and declared comparison modes determine the resulting candidate stage.',
    'The package retains environment reference names and public certificates. Source credential values come from the receiving process.','',
    '## Customer applications','',
    'Keep each generated client directory intact, including its module, types, OpenAPI, manifest, package metadata and guide.',
    'The original native source rows are JSON values, including explicit base64 objects for binary data.',
    'Ordered comparisons preserve positions and duplicate counts. Multiset comparisons retain duplicate counts;',
    'native Set comparisons compare membership while all original SSCAN pages remain in native-previews.jsonl.','',
  ].join('\n');
}
async function *nativePreviews(workspace,report){
  for(const check of report.checks)for(const page of check.pages){
    const original=workspace.operation(page.requestId);
    yield Buffer.from(JSON.stringify({schema:'stellar-forge.redis-cutover-native-page.v1',
      checkId:check.id,query:check.query,receivingPage:page,operation:original})+'\n');
  }
}
async function publishPrepared(root,receipt){
  const temporary=join(root,receipt.temporary),target=join(root,receipt.file.name);
  const exists=await lstat(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(exists)await redisCutoverFileDigest(target,{sha256:receipt.file.sha256,maximum:67108864});
  else{
    await redisCutoverFileDigest(temporary,{sha256:receipt.file.sha256,maximum:67108864});
    try{await link(temporary,target);}catch(error){
      if(error.code!=='EEXIST')throw error;
      await redisCutoverFileDigest(target,{sha256:receipt.file.sha256,maximum:67108864});
    }
    await sync(root);
  }
  const complete={...receipt,state:'READY'};
  await writeRedisCutoverJson(root,'cutover-handover.json',complete);
  // The completed ZIP and its retained receipt are already durable. An old
  // stage name can share that exact published inode after create-only linking.
  const leftover=await lstat(temporary).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  if(leftover){
    const final=await lstat(target);
    if(leftover.isSymbolicLink()||!leftover.isFile()||process.platform!=='win32'&&
        ((leftover.mode&0o077)||typeof process.getuid==='function'&&leftover.uid!==process.getuid()))
      throw issue('REDIS_CUTOVER_HANDOVER_PATH_CHANGED','The original published handover staging name changed.');
    if(leftover.dev!==final.dev||leftover.ino!==final.ino)
      await redisCutoverFileDigest(temporary,{sha256:receipt.file.sha256,maximum:67108864});
    await unlink(temporary);await sync(root);
  }
  return complete;
}
export async function createRedisCutoverHandover({directory,environment=process.env,onProgress=async()=>{},signal}={}){
  return withVerifiedRedisCutover({directory,environment,onProgress},async context=>{
    const {root,selection,retained,resultFile,selectedFile,workspaces,reports}=context;
    const name='redis-valkey-'+resultFile.sha256+'.zip',temporary='.'+name+'.partial';
    const old=await optional(join(root,'cutover-handover.json'));
    if(old&&old.value.resultSha256!==resultFile.sha256)
      throw issue('REDIS_CUTOVER_HANDOVER_SELECTION_CHANGED','The retained handover belongs to a different original result.');
    if(old?.value.state==='READY'){
      await redisCutoverFileDigest(join(root,old.value.file.name),{sha256:old.value.file.sha256,maximum:67108864});
      return old.value;
    }
    if(old?.value.state==='PREPARED')return publishPrepared(root,old.value);
    const request={schema:'stellar-forge.redis-cutover-handover.v1',state:'PREPARING',
      operationId:selection.input.operationId,inputSha256:selection.inputSha256,resultSha256:resultFile.sha256,
      selectionSha256:selectedFile.sha256,temporary,file:{name,type:'application/zip'}};
    if(old&&(old.value.operationId!==request.operationId||old.value.temporary!==temporary||old.value.state!=='PREPARING'))
      throw issue('REDIS_CUTOVER_HANDOVER_REQUEST_CHANGED','Continue the original handover preparation.');
    if(await ownFile(join(root,temporary))){
      if(!old)throw issue('REDIS_CUTOVER_HANDOVER_PATH_CHANGED','An unrelated staging file already occupies this handover path.');
      await unlink(join(root,temporary));await sync(root);
    }
    await writeRedisCutoverJson(root,'cutover-handover.json',request);
    let archive;
    try{
      archive=await createScientificArchive(join(root,temporary),{signal,maxBytes:67108864,maxLogicalBytes:536870912});
      let members=0;
      const add=async(name,source,options={})=>{
        if(signal?.aborted)throw issue('REDIS_CUTOVER_PAUSED','The original handover is paused after its retained member.');
        const value=await archive.add(name,source,options);members++;
        await onProgress({phase:'handover',file:name,members});return value;
      };
      await add('README.md',Buffer.from(readme(context)),{contentType:'text/markdown'});
      await add('cutover-input.json',Buffer.from(encode(selection.input)),{contentType:'application/json'});
      for(const [path,name,digest] of [['cutover-input.json','selection.json',selectedFile.sha256],['cutover-result.json','result.json',resultFile.sha256]]){
        const original=await openRedisCutoverFile(join(root,path),{sha256:digest});
        try{await add(name,original.stream(),{contentType:'application/json',expected:{bytes:original.bytes,sha256:original.sha256}});}
        finally{await original.close();}
      }
      for(const side of ['baseline','candidate']){
        const report=reports[side],workspace=workspaces[side];
        await add(side+'/receiving.json',Buffer.from(encode(report)),{contentType:'application/json'});
        await add(side+'/commissioning-input.json',Buffer.from(encode(selection.input[side])),{contentType:'application/json'});
        await add(side+'/source-revision.json',Buffer.from(encode(workspace.revision(report.revisionId))),{contentType:'application/json'});
        await add(side+'/native-previews.jsonl',nativePreviews(workspace,report),{contentType:'application/x-ndjson'});
        for(const file of retained.packages[side]?.customerFiles??[]){
          const original=await workspace.file(report.package.requestId,file.path);
          await add(side+'/customer/'+file.path,original.bytes,{contentType:original.type,expected:file});
        }
      }
      for(const compared of retained.comparisons){
        const original=await openRedisCutoverFile(join(root,compared.file),{sha256:compared.differenceSha256});
        try{await add('differences/'+compared.file,original.stream(),{contentType:'application/json',
          expected:{bytes:original.bytes,sha256:original.sha256}});}
        finally{await original.close();}
      }
      // The archive writer also checks its native 128-member limit. This
      // includes the complete original checks and both generated packages.
      await add('manifest.json',Buffer.from(encode({schema:'stellar-forge.redis-cutover-handover-manifest.v1',
        operationId:selection.input.operationId,inputSha256:selection.inputSha256,resultSha256:resultFile.sha256,
        status:retained.status,workspaceBindings:retained.workspaceBindings,
        comparisons:retained.comparisons.map(value=>({checkId:value.checkId,mode:value.mode,
          matched:value.matched,expectationsMatch:value.expectationsMatch,differenceSha256:value.differenceSha256})),
        members:archive.members()})),{contentType:'application/json'});
      const packed=await archive.finish(),actual=await redisCutoverFileDigest(join(root,temporary),{maximum:67108864});
      if(actual.bytes!==packed.bytes)throw issue('REDIS_CUTOVER_HANDOVER_CHANGED','The completed original archive size changed.');
      const prepared={...request,state:'PREPARED',file:{...request.file,bytes:packed.bytes,sha256:actual.sha256},
        logicalBytes:packed.logicalBytes,members:packed.members};
      await writeRedisCutoverJson(root,'cutover-handover.json',prepared);
      return await publishPrepared(root,prepared);
    }finally{await archive?.close();}
  });
}
