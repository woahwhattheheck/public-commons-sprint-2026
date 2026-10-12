// MIT. Exact saved-case inputs for the original SF49 source-edition carrier.
import {constants} from 'node:fs';
import {mkdir,lstat,open,link,unlink} from 'node:fs/promises';
import {resolve,join,dirname,isAbsolute} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {parseWorkspace} from './workspace-file.mjs';
import {exportRuntimeHandoff,MAX_HANDOFF_BYTES} from './runtime-support.mjs';
import {termsDocumentFromDraft} from './terms-editor.mjs';
import {commissioningError} from './commissioning.mjs';
import {readPrivateFile} from '../sf93-seller-support-bundle/incident-store.mjs';

const INPUT_SCHEMA='stellar-forge.merchant-case-source-inputs.v1';
const SHA=/^[a-f0-9]{64}$/,CASE=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const OPERATION=/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const encode=value=>Buffer.from(JSON.stringify(value,null,2)+'\n');
const sha=value=>createHash('sha256').update(value).digest('hex');
const ensure=(value,message,code='INVALID_SOURCE_CASE_INPUT')=>{if(!value)throw commissioningError(code,message,
  code.endsWith('_CONFLICT')?409:422);};
const fields=(value,allowed)=>ensure(value&&typeof value==='object'&&!Array.isArray(value)&&
  Object.keys(value).every(key=>allowed.includes(key)),'Unexpected saved source input fields');
async function syncDirectory(path) {
  const handle=await open(path,constants.O_RDONLY|constants.O_DIRECTORY);
  try{await handle.sync();}finally{await handle.close();}
}
async function privateDirectory(path) {
  await mkdir(path,{mode:0o700,recursive:true});
  const info=await lstat(path);
  ensure(info.isDirectory()&&!info.isSymbolicLink()&&info.uid===process.getuid()&&(info.mode&0o077)===0,
    'Source inputs require a private directory owned by the current operator');
  return path;
}
async function matchesFile(path,pin) {
  let handle;
  try {
    handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    const before=await handle.stat();
    ensure(before.isFile()&&before.uid===process.getuid()&&(before.mode&0o077)===0,
      'A retained source input must be a private regular file');
    ensure(before.size===pin.bytes,'The retained original source input has different bytes','SOURCE_INPUT_CONFLICT');
    const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(1024*1024);let count=0;
    for(;;) {
      const {bytesRead}=await handle.read(buffer,0,buffer.length,null);if(!bytesRead)break;
      count+=bytesRead;ensure(count<=pin.bytes,'The retained source input grew','SOURCE_INPUT_CONFLICT');
      hash.update(buffer.subarray(0,bytesRead));
    }
    const after=await handle.stat();
    ensure(count===pin.bytes&&after.size===before.size&&hash.digest('hex')===pin.sha256,
      'The retained original source input changed','SOURCE_INPUT_CONFLICT');
    return true;
  } catch(error){if(error.code==='ENOENT')return false;throw error;}
  finally{await handle?.close();}
}
async function retain(path,bytes) {
  const pin={bytes:bytes.length,sha256:sha(bytes)};
  if(await matchesFile(path,pin))return pin;
  const stage=path+'.stage-'+randomUUID();let handle;
  try {
    handle=await open(stage,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
    await handle.writeFile(bytes);await handle.sync();await handle.close();handle=null;
    try{await link(stage,path);}catch(error){if(error.code!=='EEXIST')throw error;await matchesFile(path,pin);}
    await syncDirectory(dirname(path));
    return pin;
  } finally {
    await handle?.close();
    await unlink(stage).catch(error=>{if(error.code!=='ENOENT')throw error;});
  }
}
async function readManifest(path) {
  try {
    const bytes=await readPrivateFile(path,65536);
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  } catch(error){if(error.code==='ENOENT')return null;throw error;}
}
/**
 * Pass resolveInputs to the maintained openSourceEditionDelivery factory.
 * A stable operation is bound to one exact original case revision.
 */
export function createCaseSourceInputs({store,directory}) {
  ensure(store&&typeof store.read==='function','Supply the original merchant case store');
  ensure(typeof directory==='string'&&isAbsolute(directory),'Use an absolute private source-input directory');
  const root=resolve(directory);
  return async function resolveInputs(args) {
    fields(args,['caseId','caseRevision','operationId','directory','signal']);
    if(args.signal?.aborted)throw commissioningError('SOURCE_INPUT_ABORTED','The original source preparation was stopped',409);
    ensure(typeof args.caseId==='string'&&CASE.test(args.caseId),'Use the original saved case ID');
    ensure(typeof args.caseRevision==='string'&&SHA.test(args.caseRevision),'Use the exact selected case revision');
    ensure(typeof args.operationId==='string'&&OPERATION.test(args.operationId),'Use the original source delivery operation ID');
    const folder=join(root,args.caseId,args.operationId),manifestPath=join(folder,'source-inputs.json');
    await privateDirectory(root);await privateDirectory(join(root,args.caseId));await privateDirectory(folder);
    const handoffPath=join(folder,'merchant-support.json'),termsPath=join(folder,'owner-terms.json');
    const retained=await readManifest(manifestPath);
    const reply=manifest=>({handoff:handoffPath,terms:termsPath,sourceCase:manifest.sourceCase,
      runtimeBytes:manifest.runtimeBytes,inputManifest:manifestPath,
      inputManifestSha256:sha(encode(manifest)),files:manifest.files});
    if(retained) {
      fields(retained,['schema','operationId','sourceCase','runtimeBytes','files']);
      fields(retained.sourceCase,['id','revision','workspaceSha256','supportSha256']);
      ensure(retained.schema===INPUT_SCHEMA&&retained.operationId===args.operationId&&
        retained.sourceCase.id===args.caseId&&retained.sourceCase.revision===args.caseRevision&&
        SHA.test(retained.sourceCase.workspaceSha256)&&SHA.test(retained.sourceCase.supportSha256)&&
        Number.isSafeInteger(retained.runtimeBytes)&&retained.runtimeBytes>0&&retained.runtimeBytes<=192*1024*1024&&
        Array.isArray(retained.files)&&retained.files.length===2,
        'This operation retains different original case inputs','SOURCE_INPUT_CONFLICT');
      for(const [index,name,maximum] of [[0,'merchant-support.json',MAX_HANDOFF_BYTES],[1,'owner-terms.json',1024*1024]]) {
        const pin=retained.files[index];fields(pin,['name','bytes','sha256']);
        ensure(pin.name===name&&Number.isSafeInteger(pin.bytes)&&pin.bytes>0&&pin.bytes<=maximum&&SHA.test(pin.sha256),
          'The retained original source inventory changed','SOURCE_INPUT_CONFLICT');
      }
      const handoffPresent=await matchesFile(handoffPath,retained.files[0]);
      const termsPresent=await matchesFile(termsPath,retained.files[1]);
      if(handoffPresent&&termsPresent)return reply(retained);
    }
    // A retained input remains usable when the current case has advanced. Its
    // exact requested historical revision is still the original preparation.
    const record=await store.read(args.caseId,args.caseRevision);
    ensure(record.id===args.caseId&&record.revision===args.caseRevision,'The source store returned a different case revision');
    ensure(typeof record.supportText==='string'&&record.supportText.length>0,
      'Attach the original runtime support capture before preparing its source delivery');
    const workspace=await parseWorkspace(record.workspaceText);
    ensure(workspace.termsText.trim(),'Save the original owner terms in this case');
    let draft;try{draft=JSON.parse(workspace.termsText);}catch{ensure(false,'The original owner terms draft is not JSON');}
    fields(draft,['schema','values']);ensure(draft.schema==='stellar-forge.merchant-terms-draft.v1',
      'Use the saved owner terms from the original Support console');
    const terms=encode(termsDocumentFromDraft(draft.values));
    const sourceCase={id:record.id,revision:record.revision,workspaceSha256:sha(record.workspaceText),
      supportSha256:sha(record.supportText)};
    const handoff=await exportRuntimeHandoff({workspaceText:record.workspaceText,supportText:record.supportText,
      metadata:record.metadata,generatedAt:workspace.savedAt}),handoffBytes=Buffer.from(handoff.handoff);
    ensure(handoffBytes.length<=MAX_HANDOFF_BYTES,'The original support handoff exceeds its native file limit');
    const manifest={schema:INPUT_SCHEMA,operationId:args.operationId,sourceCase,
      runtimeBytes:Buffer.byteLength(record.supportText),
      files:[{name:'merchant-support.json',bytes:handoffBytes.length,sha256:sha(handoffBytes)},
        {name:'owner-terms.json',bytes:terms.length,sha256:sha(terms)}]};
    ensure(retained===null||JSON.stringify(retained)===JSON.stringify(manifest),
      'This operation already retains different original case inputs','SOURCE_INPUT_CONFLICT');
    if(args.signal?.aborted)throw commissioningError('SOURCE_INPUT_ABORTED','The original source preparation was stopped',409);
    await retain(handoffPath,handoffBytes);await retain(termsPath,terms);
    await retain(manifestPath,encode(manifest));
    await syncDirectory(join(root,args.caseId));await syncDirectory(root);
    return reply(manifest);
  };
}
