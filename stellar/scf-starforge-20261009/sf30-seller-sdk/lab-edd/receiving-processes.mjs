// MIT. Complete workbook worker ownership receiving through the original sealed-file engine.
import {readFile,chmod,readdir,access,realpath} from 'node:fs/promises';
import {constants} from 'node:fs';
import {delimiter,isAbsolute,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
import {createHash,randomBytes} from 'node:crypto';
import {executeJob} from '../jobs/execution.mjs';
import {validateJobInput} from '../jobs/config.mjs';
import {privateDirectory,readPrivateJson,writePrivateJson} from '../jobs/inputs/files.mjs';
import {writeBytes} from '../../sf88-operator-buyer-cli/node/store.mjs';

const PROBE=fileURLToPath(new URL('./receiving-process.py',import.meta.url));
const hash=body=>createHash('sha256').update(body).digest('hex');
const canonical=value=>JSON.stringify(value);
async function existing(path){try{return await readPrivateJson(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}}
async function pythonExecutable(){
  const selected=process.env.LAB_EDD_PYTHON||'python3';
  const candidates=isAbsolute(selected)||selected.includes('/')||selected.includes('\\')?[resolve(selected)]:
    (process.env.PATH||'/usr/local/bin:/usr/bin:/bin').split(delimiter).filter(Boolean).map(path=>resolve(path,selected));
  for(const path of candidates)try{const real=await realpath(path);await access(real,constants.X_OK);return real;}catch(error){if(!['ENOENT','ENOTDIR','EACCES'].includes(error.code))throw error;}
  throw Error('Select the installed Python interpreter for native workbook receiving.');
}
async function originalProcessExists(observation){
  try{
    const body=await readFile('/proc/'+observation.pid+'/stat','utf8');
    const ticks=body.slice(body.lastIndexOf(')')+2).split(' ')[19];
    return ticks===observation.start_ticks;
  }catch(error){if(error.code==='ENOENT'||error.code==='ESRCH')return false;throw error;}
}
async function immutable(path,body){
  try{await writeBytes(path,body,{exclusive:true});}
  catch(error){if(error.code!=='EEXIST')throw error;if(hash(await readFile(path))!==hash(body))throw Error('The retained native process fixture changed: '+path);}
}
/**
 * This optional receiving phase uses a generated DTS format workbook. The probe
 * performs the real file-mode decoder, records that native process, then remains
 * alive so the original worker cancellation/timeout must retire it.
 */
export async function receiveLabProcessOwnership({directory,scratch,merchant,store,inputDirectory,
  source,sourceBinding,operationId,stageSource,lease,signal,timeoutMs=15000}){
  if(process.platform!=='linux')throw Error('The declared native process receiving uses Linux process identities.');
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<3000||timeoutMs>60000)throw Error('Select a native receiving timeout from3000 to60000ms.');
  directory=resolve(directory);scratch=resolve(scratch);
  await privateDirectory(directory);await privateDirectory(scratch);
  const python=await pythonExecutable(),probeBody=await readFile(PROBE,'utf8');
  if(/[\r\n]/.test(python))throw Error('The selected Python executable path is invalid.');
  const probe=join(directory,'native-workbook-probe');
  await immutable(probe,Buffer.from('#!'+python+'\n'+probeBody));await chmod(probe,0o700);
  const definition=merchant.compiled.functions.laboratoryReview;
  const binding={operationId,source:sourceBinding,applicationSha256:merchant.identity.applicationSha256,
    merchantSha256:merchant.identity.configSha256,probeSha256:hash(Buffer.from('#!'+python+'\n'+probeBody)),timeoutMs};
  const checkpointPath=join(directory,'process-receiving.json');
  let state=await existing(checkpointPath);
  if(state&&canonical(state.binding)!==canonical(binding))throw Error('The retained workbook ownership receiving uses a different source.');
  if(!state){state={schema:'starforge.lab-edd-process-receiving.v1',sourceKind:'generated software-format fixture',binding,cases:{}};await writePrivateJson(checkpointPath,state,()=>lease.assertHeld());}
  for(const kind of ['cancel','timeout']){
    signal.throwIfAborted();
    if(state.cases[kind]?.status==='COMPLETE')continue;
    let selected=state.cases[kind];
    if(!selected){selected=state.cases[kind]={reference:'lab-process-'+hash(operationId+':'+kind).slice(0,32),token:randomBytes(32).toString('base64url')};await writePrivateJson(checkpointPath,state,()=>lease.assertHeld());}
    const folder=join(directory,kind),temporary=join(scratch,kind);await privateDirectory(folder);await privateDirectory(temporary);
    const marker=join(folder,'native-decoder.json'),observation=await existing(marker);
    if(observation&&await originalProcessExists(observation))throw Error('The original workbook receiving process is still present: '+observation.pid);
    // An ended receiver may repeat its same local software fixture. The prior
    // observation is retained; this invocation gets its own complete marker.
    const invocation=selected.invocations??=[];let markerPath=marker;
    if(observation||invocation.length)markerPath=join(folder,'native-decoder-'+String(invocation.length+1)+'.json');
    const uploaded=await stageSource(selected.reference,selected.token,source);
    const input={profile:'geotech-dts8d',reviewName:'native-process-'+kind,expectedSourceSha256:sourceBinding.sourceSha256,
      encoding:'utf-8',tableScope:'issues',$files:{source:uploaded.file}};
    const request=validateJobInput(definition,input);
    await store.pinJob({origin:merchant.compiled.publicOrigin,reference:selected.reference,functionId:'laboratoryReview',
      ...request,policy:definition.inputFiles,token:selected.token,signal});
    const row={id:selected.reference,functionId:'laboratoryReview',...request};
    const fixtureMerchant={...merchant,compiled:{...merchant.compiled,
      environment:[...merchant.compiled.environment,'LAB_EDD_PROCESS_RECEIVING'],
      functions:{...merchant.compiled.functions,laboratoryReview:{...definition,timeoutMs}}}};
    const started={startedAt:new Date().toISOString(),inputSha256:request.inputSha256,marker:markerPath};
    invocation.push(started);await writePrivateJson(checkpointPath,state,()=>lease.assertHeld());
    const stop=new AbortController(),abort=()=>stop.abort(signal.reason);
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    let terminal=false,outcome,seen;
    const running=executeJob(fixtureMerchant,row,{id:'native-process-'+kind},{inputDirectory,signal:stop.signal,env:{
      ...process.env,LAB_EDD_TEMP_ROOT:temporary,SF30_JOB_TEMP:temporary,LAB_EDD_PYTHON:probe,LAB_EDD_PROCESS_RECEIVING:markerPath
    }}).then(body=>({unexpectedResultBytes:body.length}),error=>({error:error.code??error.message,status:error.status}));
    running.then(result=>{terminal=true;outcome=result;});
    try{
      while(!terminal){
        signal.throwIfAborted();seen??=await existing(markerPath);
        if(seen&&kind==='cancel'&&!stop.signal.aborted)stop.abort(Object.assign(new Error('JOB_EXECUTION_CANCELLED'),{code:'JOB_EXECUTION_CANCELLED'}));
        await delay(25);
      }
      outcome=await running;seen??=await existing(markerPath);
      signal.throwIfAborted();
      const expected=kind==='cancel'?'JOB_EXECUTION_CANCELLED':'JOB_EXECUTION_TIMEOUT';
      if(!seen)throw Error('The native workbook process did not reach its completed decoder before '+kind+'.');
      if(outcome.error!==expected)throw Error('The original worker returned '+JSON.stringify(outcome)+' during '+kind+'.');
      if(seen.source_sha256!==sourceBinding.sha256)throw Error('The native process used a different complete workbook.');
      if(!Number.isSafeInteger(seen.pid)||seen.pid<1||typeof seen.start_ticks!=='string')throw Error('The native process identity is incomplete.');
      if(await originalProcessExists(seen))throw Error('The original worker left its workbook process alive.');
      const remaining=await readdir(temporary);
      if(remaining.length)throw Error('The original process host retained unfinished scratch: '+remaining.join(', '));
      Object.assign(started,{completedAt:new Date().toISOString(),outcome,observation:seen,originalProcessRetired:true,brokerScratchRemoved:true});
      selected.status='COMPLETE';await writePrivateJson(checkpointPath,state,()=>lease.assertHeld());
    }finally{
      signal.removeEventListener('abort',abort);
      if(!terminal)stop.abort(Object.assign(new Error('JOB_EXECUTION_CANCELLED'),{code:'JOB_EXECUTION_CANCELLED'}));
      await running;
    }
  }
  const result={schema:state.schema,sourceKind:state.sourceKind,binding,status:'COMPLETE',
    cases:Object.fromEntries(Object.entries(state.cases).map(([kind,value])=>{const {token,...visible}=value;return [kind,visible];}))};
  await writePrivateJson(join(directory,'result.json'),result,()=>lease.assertHeld());return result;
}
