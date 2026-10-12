// MIT. Complete portable receiving around the original SF88 dataset session.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isAbsolute,resolve} from 'node:path';
import {withLockedDatasetSession,inspectDatasetSession} from './dataset-session.mjs';
import {canonical,object} from './dataset-page.mjs';
import {InputError,need} from './config.mjs';

const WORKER=fileURLToPath(new URL('./dataset-session-portable.py',import.meta.url));
const SCHEMA='stellar-forge.sf88.dataset-session-archive.v1';
const MAX_JSON=32*1024*1024;
const HASH=/^[a-f0-9]{64}$/;
const exact=path=>typeof path==='string'&&isAbsolute(path)&&resolve(path)===path&&!path.includes('\0');

function options(value={}) {
  const {python='python3',signal,maxBytes=2*1024*1024*1024}=value;
  need(typeof python==='string'&&python.length>0&&python.length<=4096&&!python.includes('\0'),
    'DATASET_ARCHIVE_PYTHON_REQUIRED');
  need(signal===undefined||signal instanceof AbortSignal,'INVALID_ABORT_SIGNAL');
  need(Number.isSafeInteger(maxBytes)&&maxBytes>=1&&maxBytes<=16*1024**3,
    'DATASET_ARCHIVE_TOTAL_LIMIT');
  return {python,signal,maxBytes};
}
function operation(value) {
  need(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value),
    'DATASET_ARCHIVE_OPERATION_REQUIRED');
  return value;
}
async function worker(input,selected) {
  const raw=Buffer.from(JSON.stringify({...input,maxBytes:selected.maxBytes}));
  need(raw.length<=MAX_JSON,'DATASET_ARCHIVE_INPUT_LIMIT');
  need(!selected.signal?.aborted,'OPERATOR_ABORTED');
  return new Promise((accept,reject)=>{
    const child=spawn(selected.python,['-I','-B',WORKER],{shell:false,
      env:{LANG:'C.UTF-8',LC_ALL:'C.UTF-8',PATH:process.env.PATH??'/usr/bin:/bin'},
      stdio:['pipe','pipe','pipe']});
    const chunks=[];
    let size=0,errors=0,settled=false,killTimer;
    const finish=(error,value)=>{
      if(settled)return;
      settled=true;
      selected.signal?.removeEventListener('abort',abort);
      clearTimeout(killTimer);
      if(error){
        error.partialWorkPreserved=true;
        if(input.destination)error.destination=input.destination;
        if(input.archive)error.archive=input.archive;
        reject(error);
      }else accept(value);
    };
    const abort=()=>{
      child.kill('SIGTERM');
      killTimer=setTimeout(()=>child.kill('SIGKILL'),5000);
      killTimer.unref();
    };
    selected.signal?.addEventListener('abort',abort,{once:true});
    child.once('error',()=>finish(new InputError('DATASET_ARCHIVE_WORKER_START_FAILED')));
    child.stdin.on('error',()=>{}); // The child result carries its exact source failure.
    child.stdout.on('data',part=>{
      size+=part.length;
      if(size>MAX_JSON){child.kill('SIGKILL');finish(new InputError('DATASET_ARCHIVE_OUTPUT_LIMIT'));}
      else chunks.push(part);
    });
    child.stderr.on('data',part=>{
      errors+=part.length;
      if(errors>65536){child.kill('SIGKILL');finish(new InputError('DATASET_ARCHIVE_DIAGNOSTIC_LIMIT'));}
    });
    child.once('close',code=>{
      if(settled)return;
      if(selected.signal?.aborted)return finish(new InputError('DATASET_ARCHIVE_INTERRUPTED'));
      try {
        const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
        need(value?.schema===SCHEMA,'DATASET_ARCHIVE_WORKER_RESULT_INVALID');
        if(value.state==='ERROR'){
          const error=new InputError(/^[A-Z0-9_]{1,120}$/.test(value.code??'')
            ?value.code:'DATASET_ARCHIVE_FAILED');
          error.exitCode=code;
          return finish(error);
        }
        need(code===0&&HASH.test(value.archiveSha256??'')&&HASH.test(value.manifestSha256??'')&&
          HASH.test(value.sessionSha256??'')&&HASH.test(value.configurationSha256??''),
          'DATASET_ARCHIVE_WORKER_RESULT_INVALID');
        finish(null,value);
      }catch(error){finish(error instanceof InputError?error:new InputError('DATASET_ARCHIVE_WORKER_RESULT_INVALID'));}
    });
    child.stdin.end(raw);
    if(selected.signal?.aborted)abort();
  });
}
function sameInspection(actual,retained) {
  need(object(actual)&&object(retained),'DATASET_ARCHIVE_NATIVE_INSPECTION_REQUIRED');
  for(const key of ['schema','directory','sessionId','configurationSha256','status',
    'completedPages','acquiredRows','totalRows','snapshot','capAllocatedAtomic'])
    need(canonical(actual[key]??null)===canonical(retained[key]??null),
      'DATASET_ARCHIVE_NATIVE_INSPECTION_CHANGED');
  const pages=value=>(value.pages??[]).map(page=>Object.fromEntries([
    'index','intentId','sha256','bytes','evidenceSha256','snapshot','querySha256',
    'offset','nextOffset','nextCursor','returned','total','semantics',
  ].map(key=>[key,page[key]??null])));
  need(canonical(pages(actual))===canonical(pages(retained)),
    'DATASET_ARCHIVE_NATIVE_PAGE_CHANGED');
  if(retained.stoppedPage)for(const key of ['index','intentId'])
    need(actual.stoppedPage?.[key]===retained.stoppedPage[key],
      'DATASET_ARCHIVE_ORIGINAL_RECONCILIATION_CHANGED');
}

/** Inspect every archive member without writing a session or invoking a buyer. */
export async function inspectDatasetSessionArchive({archive,expectedSha256,...settings}={}) {
  need(exact(archive),'DATASET_ARCHIVE_ABSOLUTE_PATH_REQUIRED');
  need(expectedSha256===undefined||HASH.test(expectedSha256),'DATASET_ARCHIVE_DIGEST_REQUIRED');
  return worker({action:'inspect',archive,expectedSha256},options(settings));
}

/** Hold the original session lock through native inspection and complete capture.
 * The archive keeps original JSON/body/wire/history bytes, including failed and
 * unresolved attempts. run.lock is a live process lease and is not transferable. */
export async function exportDatasetSessionArchive({directory,archive,operation:operationId,...settings}={}) {
  need(exact(directory)&&exact(archive),'DATASET_ARCHIVE_ABSOLUTE_PATH_REQUIRED');
  operation(operationId);
  const selected=options(settings);
  return withLockedDatasetSession(directory,async source=>{
    const inspection=await source.inspect();
    return worker({action:'export',directory:source.storageDirectory,
      sourceDirectory:source.directory,configurationSha256:source.definition.configurationSha256,
      archive,operation:operationId,inspection},selected);
  });
}

/** Receive under a new private root, inspect with the same original SF88 reader,
 * then publish that complete source selection without replacing another target.
 * A repeated completed receive reopens current native state and preserves later
 * customer work. It never starts a page, signer or ledger operation. */
export async function receiveDatasetSessionArchive({archive,directory,expectedSha256,
  operation:operationId,...settings}={}) {
  need(exact(directory)&&exact(archive),'DATASET_ARCHIVE_ABSOLUTE_PATH_REQUIRED');
  need(HASH.test(expectedSha256??''),'DATASET_ARCHIVE_EXACT_SOURCE_REQUIRED');
  operation(operationId);
  const selected=options(settings),input={archive,destination:directory,expectedSha256,operation:operationId};
  const prepared=await worker({...input,action:'receive'},selected);
  const inspection=await inspectDatasetSession(prepared.directory);
  need(inspection.status!=='RUNNING','DATASET_ARCHIVE_ORIGINAL_SESSION_RUNNING');
  if(prepared.state==='RECEIVED')return {...prepared,session:inspection};
  need(prepared.state==='PREPARED','DATASET_ARCHIVE_RECEIVE_PREPARATION_REQUIRED');
  sameInspection(inspection,prepared.inspection);
  const received=await worker({...input,action:'publish'},selected);
  // Reopen the published path: staging paths never become the session identity.
  const session=await inspectDatasetSession(directory);
  sameInspection(session,prepared.inspection);
  return {...received,session};
}
