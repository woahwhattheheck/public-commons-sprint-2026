// MIT. Drive the original Python customer product on the selected live workspace.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {isAbsolute,resolve,join,relative,sep} from 'node:path';
import {lstat,readFile} from 'node:fs/promises';
import {extractionDigest} from './study-extraction.mjs';
import {privateDirectory,writeJson,readJson,digest,need,object} from '../node/store.mjs';

const LIMIT=16*1024*1024;
const schema='sf88-study-extraction-eligibility-receiving/v1';
const checkout=resolve(fileURLToPath(new URL('../../../../',import.meta.url)));
const entry=fileURLToPath(new URL('./study-extraction-eligibility.py',import.meta.url));
const ownerWrapper=fileURLToPath(new URL('./study-extraction-owned-child.py',import.meta.url));
const absolute=value=>typeof value==='string'&&isAbsolute(value)&&resolve(value)===value;
async function originalInput(file,input){
  try{
    const prior=await readJson(file,LIMIT);
    need(extractionDigest(prior)===extractionDigest(input),'STUDY_ELIGIBILITY_INPUT_CHANGED');
  }catch(error){
    if(error.code!=='ENOENT')throw error;
    await writeJson(file,input,{exclusive:true});
  }
}
async function ownedPython({python,inputFile,resultFile,signal,timeoutMs}){
  need(typeof python==='string'&&python.length>0&&Number.isSafeInteger(timeoutMs)&&timeoutMs>=1000,
    'STUDY_ELIGIBILITY_RUNTIME_REQUIRED');
  if(signal?.aborted)throw signal.reason??new Error('STUDY_ELIGIBILITY_CANCELLED');
  const group=process.platform!=='win32';
  const child=spawn(python,[ownerWrapper,python,entry,'--input',inputFile,'--output',resultFile],{
    cwd:checkout,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'},detached:group,stdio:['ignore','pipe','pipe']});
  let failure=null,ended=false,escalation=null,stdoutBytes=0,stderrBytes=0;
  const stdout=[],stderr=[];
  const stop=code=>{
    if(!failure)failure=Object.assign(new Error(code),{code});
    if(ended)return;
    try{if(group&&child.pid)process.kill(-child.pid,'SIGTERM');else child.kill('SIGTERM');}
    catch(error){if(error.code!=='ESRCH')failure=error;}
    if(!escalation)escalation=setTimeout(()=>{
      try{if(group&&child.pid)process.kill(-child.pid,'SIGKILL');else if(!ended)child.kill('SIGKILL');}
      catch(error){if(error.code!=='ESRCH'&&!failure)failure=error;}
      child.stdout.destroy();child.stderr.destroy();
    },15000);
  };
  const collect=(chunks,kind)=>chunk=>{
    const count=kind==='stdout'?stdoutBytes+=chunk.length:stderrBytes+=chunk.length;
    if(count<=1024*1024)chunks.push(chunk);else stop('STUDY_ELIGIBILITY_OUTPUT_LIMIT');
  };
  child.stdout.on('data',collect(stdout,'stdout'));child.stderr.on('data',collect(stderr,'stderr'));
  const closed=new Promise(resolveClose=>{
    child.once('error',error=>{failure=error;});
    child.once('close',(code,closedSignal)=>{ended=true;resolveClose({code,signal:closedSignal});});
  });
  const abort=()=>stop('STUDY_ELIGIBILITY_CANCELLED');
  signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();
  const timer=setTimeout(()=>stop('STUDY_ELIGIBILITY_TIMEOUT'),timeoutMs);
  try{
    const closedResult=await closed;
    if(failure)throw failure;
    if(closedResult.code!==0){
      let actual;
      try{actual=JSON.parse(Buffer.concat(stderr).toString('utf8').trim());}catch{}
      const code=typeof actual?.error==='string'&&/^[A-Z0-9_]+$/.test(actual.error)?
        actual.error:'STUDY_ELIGIBILITY_NATIVE_FAILED';
      throw Object.assign(new Error(code),{code,nativeExitCode:closedResult.code});
    }
    let receipt;
    try{receipt=JSON.parse(Buffer.concat(stdout).toString('utf8').trim());}
    catch{throw Object.assign(new Error('STUDY_ELIGIBILITY_NATIVE_REPLY_INVALID'),{code:'STUDY_ELIGIBILITY_NATIVE_REPLY_INVALID'});}
    need(receipt.state==='COMPLETE'&&receipt.file===resultFile,'STUDY_ELIGIBILITY_NATIVE_REPLY_CHANGED');
  }finally{
    if(failure&&group&&child.pid){try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH'&&!failure)failure=error;}}
    clearTimeout(timer);if(escalation)clearTimeout(escalation);
    signal?.removeEventListener('abort',abort);
    child.stdout.destroy();child.stderr.destroy();
  }
}
async function verifyFile(root,descriptor){
  need(object(descriptor)&&absolute(descriptor.file)&&Number.isSafeInteger(descriptor.bytes)&&
    descriptor.bytes>=0&&/^[a-f0-9]{64}$/.test(descriptor.sha256),'STUDY_ELIGIBILITY_FILE_REQUIRED');
  const local=relative(root,descriptor.file);
  need(local&&!isAbsolute(local)&&!local.split(sep).includes('..'),'STUDY_ELIGIBILITY_FILE_SCOPE_CHANGED');
  const stat=await lstat(descriptor.file);
  need(stat.isFile()&&!stat.isSymbolicLink()&&stat.size===descriptor.bytes&&stat.size<=512*1024*1024,
    'STUDY_ELIGIBILITY_FILE_CHANGED');
  const bytes=await readFile(descriptor.file);
  need(bytes.length===descriptor.bytes&&digest(bytes)===descriptor.sha256,'STUDY_ELIGIBILITY_FILE_CHANGED');
}
export async function runStudyExtractionEligibility({connectionFile,expectedWorkspaceId,dossierId,revision,
  reviewId,workSetId,reviewRequestFile,runDirectory,python='python3',signal,timeoutMs=3600000}){
  for(const value of [connectionFile,reviewRequestFile,runDirectory])need(absolute(value),'STUDY_ELIGIBILITY_ABSOLUTE_PATH');
  runDirectory=await privateDirectory(runDirectory);
  const input={checkout,node:process.execPath,connectionFile,expectedWorkspaceId,dossierId,revision,reviewId,workSetId,
    reviewRequestFile,runDirectory};
  const inputFile=join(runDirectory,'input.private.json'),resultFile=join(runDirectory,'result.json');
  await originalInput(inputFile,input);
  await ownedPython({python,inputFile,resultFile,signal,timeoutMs});
  const result=await readJson(resultFile,LIMIT);
  need(result.schema===schema&&result.state==='COMPLETE'&&result.workspaceId===expectedWorkspaceId&&
    result.dossierId===dossierId&&result.revision===revision&&result.reviewId===reviewId&&result.workSetId===workSetId&&
    Array.isArray(result.files)&&result.files.length===16,'STUDY_ELIGIBILITY_RECEIVING_CHANGED');
  for(const descriptor of result.files)await verifyFile(runDirectory,descriptor);
  for(const path of [result.jsonDirectory,result.streamDirectory]){
    need(absolute(path)&&path.startsWith(runDirectory+sep)&&path.endsWith(sep+'workspace'),
      'STUDY_ELIGIBILITY_RECEIVED_WORKSPACE_CHANGED');
  }
  return result;
}
