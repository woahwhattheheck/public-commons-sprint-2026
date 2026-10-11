// MIT. Persistent backup selection and original-engine jobs for the commerce console.
import {constants} from 'node:fs';
import {lstat,mkdir,open,readdir,realpath,rename,unlink} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {reviewCommerceRecovery,snapshotCommerceRecovery,verifyCommerceRecovery,
  restoreCommerceRecovery,COMMERCE_RECOVERY_SCHEMA} from './commerce-recovery.mjs';

const ID=/^commerce-[a-f0-9-]{36}$/;
const HASH=/^[a-f0-9]{64}$/;
const need=(ok,code)=>{if(!ok)throw Object.assign(new Error(code),{code});};
const errorCode=error=>/^[A-Z0-9_]{1,120}$/.test(error?.code??'')?error.code:'COMMERCE_RECOVERY_FAILED';
async function present(path) {try{return await lstat(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function privateDirectory(path) {
  const info=await lstat(path);
  need(resolve(path)===path&&await realpath(path)===path&&info.isDirectory()&&
    info.uid===process.getuid()&&(info.mode&0o077)===0,'COMMERCE_RECOVERY_PRIVATE_DIRECTORY_REQUIRED');
}
async function read(path) {
  need(await realpath(path)===path,'COMMERCE_RECOVERY_SELECTION_INVALID');
  const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const st=await file.stat();
    need(st.isFile()&&st.nlink===1&&st.size<=1048576&&st.uid===process.getuid()&&(st.mode&0o077)===0,
      'COMMERCE_RECOVERY_SELECTION_INVALID');
    return JSON.parse(await file.readFile('utf8'));
  } finally {await file.close();}
}
async function save(path,value) {
  const temporary=path+'.'+randomUUID()+'.tmp',file=await open(temporary,'wx',0o600);
  try {
    await file.writeFile(JSON.stringify(value,null,2)+'\n');await file.sync();await file.close();
    await rename(temporary,path);
    const parent=await open(dirname(path),'r');try{await parent.sync();}finally{await parent.close();}
  } finally {await file.close().catch(()=>{});await unlink(temporary).catch(()=>{});}
}
const publicResult=value=>value?{status:value.status,recordSha256:value.recordSha256,
  createdAt:value.createdAt,files:value.files,bytes:value.bytes,checkpoint:value.checkpoint,
  operators:value.operators,executionStarted:value.executionStarted,
  nativeReopenErrors:value.nativeReopenErrors,commerceReopenErrors:value.commerceReopenErrors}:null;

/** Long operations outlive a browser request. Only host-declared directories and
 * selected retained IDs reach the original recovery APIs. */
export function createCommerceRecoveryController(profile,{environment=process.env,pause,reopen,state}={}) {
  let review=null,job=null,closed=false;
  const options={directory:profile.directory,stateRoot:profile.stateRoot,include:profile.include,
    preparation:profile.preparation,passEnv:profile.passEnv,python:profile.python};
  async function selection(id) {
    need(ID.test(id??''),'COMMERCE_RECOVERY_SELECTION_REQUIRED');
    const path=join(profile.backupDirectory,id);await privateDirectory(path);
    const value=await read(join(path,'selection.json'));
    need(value.schema===COMMERCE_RECOVERY_SCHEMA&&value.id===id&&value.directory===profile.directory&&
      value.stateRoot===profile.stateRoot&&value.bundle===join(path,'bundle')&&
      (value.recordSha256===null||HASH.test(value.recordSha256)),'COMMERCE_RECOVERY_SELECTION_INVALID');
    return {path,value};
  }
  async function history() {
    await privateDirectory(profile.backupDirectory);
    const entries=[];
    for(const name of (await readdir(profile.backupDirectory)).filter(x=>ID.test(x)).sort().slice(-200)) {
      try {
        const {value}=await selection(name);
        entries.push({...value,interrupted:value.status==='CAPTURING'&&job?.backupId!==name,
          active:job?.backupId===name&&job.running});
      } catch(error){entries.push({id:name,status:'UNAVAILABLE',error:errorCode(error)});}
    }
    return entries.sort((a,b)=>(b.createdAt??'').localeCompare(a.createdAt??''));
  }
  async function status() {
    const session=await state(),info=await present(profile.stateRoot);
    const restoreable=!info||(info.isDirectory()&&(await readdir(profile.stateRoot)).length===0);
    return {enabled:true,directory:profile.directory,stateRoot:profile.stateRoot,backupDirectory:profile.backupDirectory,
      passphraseEnvironment:profile.passEnv,review:review?.profile??null,
      job:job?{id:job.id,backupId:job.backupId??null,kind:job.kind,running:job.running,
        startedAt:job.startedAt,endedAt:job.endedAt??null,stage:job.stage,
        result:publicResult(job.result),error:job.error??null}:null,
      backups:await history(),controls:{canReview:!closed&&!job?.running,
        canCapture:!closed&&!job?.running&&Boolean(review)&&session!=='RUNNING',
        canVerify:!closed&&!job?.running,canRestore:!closed&&!job?.running&&session!=='RUNNING'&&restoreable,
        canReopen:!closed&&!job?.running&&session!=='RUNNING'&&Boolean(info),
        canCancel:!closed&&job?.running&&job.kind!=='REOPEN'},restoreable};
  }
  function begin(kind,work,backupId) {
    need(!closed&&!job?.running,'COMMERCE_RECOVERY_BUSY');
    const current={id:randomUUID(),kind,backupId,running:true,startedAt:new Date().toISOString(),stage:kind,
      controller:new AbortController()};
    job=current;
    current.promise=Promise.resolve().then(()=>work(current)).then(result=>{current.result=result;},
      error=>{current.error=errorCode(error);}).finally(()=>{
        current.running=false;current.endedAt=new Date().toISOString();
      });
    return current.id;
  }
  async function selectedOptions(id) {
    const {path,value}=await selection(id);
    need(await present(value.bundle),'COMMERCE_RECOVERY_BUNDLE_NOT_PUBLISHED');
    return {path,value,options:{...options,bundle:value.bundle,
      ...(value.recordSha256?{expected:value.recordSha256}:{})}};
  }
  function dispatch(command,value={}) {
    if(command==='review') {
      need(Object.keys(value).length===0,'COMMERCE_RECOVERY_ACTION_INVALID');
      return begin('PAUSE_AND_REVIEW',async current=>{
        review=null;await pause();need(!current.controller.signal.aborted,'COMMERCE_RECOVERY_INTERRUPTED');
        current.stage='READING_ORIGINAL_STATE';
        review=await reviewCommerceRecovery(options);
        return {status:'COMMERCE_BACKUP_REVIEWED'};
      });
    }
    if(command==='capture') {
      need(Object.keys(value).every(key=>key==='reviewSha256')&&review&&value.reviewSha256===review.profile.reviewSha256,
        'COMMERCE_RECOVERY_REVIEW_REQUIRED');
      return begin('CAPTURE',async current=>{
        need(await state()!=='RUNNING','WORKSPACE_RECOVERY_QUIESCED_SOURCE_REQUIRED');
        const id='commerce-'+randomUUID(),path=join(profile.backupDirectory,id);
        current.backupId=id;await mkdir(path,{mode:0o700});
        let selected={schema:COMMERCE_RECOVERY_SCHEMA,id,createdAt:new Date().toISOString(),
          directory:profile.directory,stateRoot:profile.stateRoot,bundle:join(path,'bundle'),
          reviewSha256:value.reviewSha256,recordSha256:null,status:'CAPTURING'};
        await save(join(path,'selection.json'),selected);
        try {
          const result=await snapshotCommerceRecovery({...options,quiesced:true,output:selected.bundle,
            expectedReviewSha256:value.reviewSha256},{environment,signal:current.controller.signal,
            onProgress:event=>{current.stage=event.stage;}});
          selected={...selected,status:result.status,recordSha256:result.recordSha256,
            files:result.files,bytes:result.bytes,result:publicResult(result)};
          // Preserve a successfully published original archive if saving its
          // local index fails. Verify can recover the authenticated identity.
          try {await save(join(path,'selection.json'),selected);}
          catch(error){result.selectionRecordError=errorCode(error);}
          review=null;return result;
        } catch(error) {
          await save(join(path,'selection.json'),{...selected,status:current.controller.signal.aborted?'CANCELLED':'FAILED',
            error:errorCode(error)}).catch(()=>{});
          throw error;
        }
      });
    }
    if(['verify','restore'].includes(command)) {
      need(Object.keys(value).every(key=>key==='id'),'COMMERCE_RECOVERY_ACTION_INVALID');
      return begin(command.toUpperCase(),async current=>{
        if(command==='restore') {
          await pause();need(await state()!=='RUNNING','WORKSPACE_RECOVERY_QUIESCED_SOURCE_REQUIRED');
        }
        const selected=await selectedOptions(value.id);
        const result=await (command==='verify'?verifyCommerceRecovery:restoreCommerceRecovery)(selected.options,
          {environment,signal:current.controller.signal,onProgress:event=>{current.stage=event.stage;}});
        await save(join(selected.path,'selection.json'),{...selected.value,
          status:command==='verify'?'BACKUP_VERIFIED':'STATE_RESTORED',recordSha256:result.recordSha256,
          files:result.files,bytes:result.bytes,lastVerifiedAt:new Date().toISOString(),
          result:publicResult(result)}).catch(error=>{result.selectionRecordError=errorCode(error);});
        review=null;return result;
      },value.id);
    }
    if(command==='reopen') {
      need(Object.keys(value).length===0,'COMMERCE_RECOVERY_ACTION_INVALID');
      return begin('REOPEN',async()=>{
        need(await state()!=='RUNNING','COMMERCE_RECOVERY_SESSION_ALREADY_RUNNING');
        await reopen();review=null;return {status:'ORIGINAL_COMMERCE_REOPENED',executionStarted:false};
      });
    }
    if(command==='cancel') {
      need(Object.keys(value).length===0&&job?.running&&job.kind!=='REOPEN','COMMERCE_RECOVERY_NOT_RUNNING');
      job.controller.abort();return job.id;
    }
    need(false,'COMMERCE_RECOVERY_ACTION_INVALID');
  }
  return {status,dispatch,get busy(){return Boolean(job?.running);},async wait(){await job?.promise;},
    async close(){closed=true;await job?.promise;}};
}
