#!/usr/bin/env node
// MIT. One original sealed-file job, same-job replay and complete native commissioning customer receiving.
import { realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { parseArgs } from 'node:util';
import { acquireStateLease } from '../../../merchant-fleet-gateway/state-lease.mjs';
import { readJobMerchant, validateJobInput } from '../../jobs/config.mjs';
import { openInputStore } from '../../jobs/inputs/store.mjs';
import { privateDirectory, readPrivateJson, writePrivateJson } from '../../jobs/inputs/files.mjs';
import { executeJob } from '../../jobs/execution.mjs';
import { canonical } from '../kiwis/source.mjs';
import { metadata, immutable, stageFile } from './receive.mjs';
import { inspectCommissioningJobSource, receiveCommissioningJobResult } from './commissioning-client.mjs';

const ROOT = fileURLToPath(new URL('.',import.meta.url));
export const COMMISSIONING_JOB_RECEIVING_SCHEMA = 'starforge.wqx-commissioning-job-receiving.v1';
const json = value => JSON.stringify(value,null,2)+'\n';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (code,message=code) => { throw Object.assign(new Error(message),{code}); };
const equal = (a,b,message) => { if(canonical(a)!==canonical(b))fail('KIWIS_JOB_RECEIVING_CHANGED',message); };
async function existing(path) {
  try{return await readPrivateJson(path);}catch(error){if(error.code==='ENOENT')return null;throw error;}
}

/**
 * Execute the original function through its existing sealed input and terminable worker.
 * Payment and remote source acquisition remain with the original merchant/customer workflow.
 */
export async function receiveCommissioningJob({sourceFile,expectedSourceSha256,directory,scratch,
  configFile=join(ROOT,'merchant.example.json'),python='python3',
  signal=new AbortController().signal}={}){
  signal.throwIfAborted();
  directory=resolve(directory);scratch=resolve(scratch);
  await privateDirectory(directory);await privateDirectory(scratch);
  directory=await realpath(directory);scratch=await realpath(scratch);
  const selected=await inspectCommissioningJobSource({sourceFile,expectedSourceSha256,signal});
  sourceFile=selected.sourceFile;
  const source={bytes:selected.source.bytes,sha256:selected.source.sha256};
  const merchant=await readJobMerchant(configFile),definition=merchant.compiled.functions.waterQualityReview;
  if(!definition?.inputFiles||definition.inputFiles.slots.source.maxBytes<source.bytes||
      definition.output?.contentType!=='application/zip')
    fail('KIWIS_JOB_RECEIVING_POLICY','Select the original Water Quality ZIP function and complete source-file policy.');
  const binding={sourceFile,source,configFile:await realpath(configFile),
    configSha256:merchant.identity.configSha256,applicationSha256:merchant.identity.applicationSha256};
  const lease=await acquireStateLease(directory),checkpointPath=join(directory,'receiving.json');
  const save=checkpoint=>writePrivateJson(checkpointPath,checkpoint,()=>lease.assertHeld());
  let inputs;
  try{
    let checkpoint=await existing(checkpointPath);
    if(checkpoint){
      if(checkpoint.schema!==COMMISSIONING_JOB_RECEIVING_SCHEMA)
        fail('KIWIS_JOB_RECEIVING_CHECKPOINT','Keep the original commissioning receiving checkpoint.');
      equal(checkpoint.binding,binding,'Keep the original full input and merchant source.');
      equal(checkpoint.input,selected.input,'Keep the original exact commissioning job request.');
      equal(checkpoint.original,selected.commissioning,'Keep the complete original saved commissioning identity.');
    }else{
      checkpoint={schema:COMMISSIONING_JOB_RECEIVING_SCHEMA,binding,input:selected.input,
        original:selected.commissioning,reference:'wqx-commissioning-'+source.sha256.slice(0,20),
        token:randomBytes(32).toString('base64url'),createdAt:new Date().toISOString(),completedAt:null};
      await save(checkpoint);
    }
    const customerDirectory=join(directory,'customer');
    const receiveCustomer=()=>receiveCommissioningJobResult({
      archiveFile:checkpoint.output.path,expectedArchiveSha256:checkpoint.output.sha256,
      directory:customerDirectory,python,expectedJobId:checkpoint.reference,
      expectedRequest:{...checkpoint.input,$files:{source:checkpoint.upload.file}},expectedSource:source,signal,
    });
    if(checkpoint.completedAt){
      equal(await metadata(checkpoint.output.path),{bytes:checkpoint.output.bytes,sha256:checkpoint.output.sha256},
        'The retained complete worker result changed.');
      const result=await readPrivateJson(join(directory,'result.json'));
      equal(result.binding,binding,'The retained complete result changed its selected source.');
      equal(result.original,checkpoint.original,'The retained complete result changed its original review.');
      equal(result.input,checkpoint.input,'The retained complete result changed its exact request.');
      equal(result.output,checkpoint.output,'The retained complete result changed its original output.');
      equal(result.replay,checkpoint.replay,'The retained complete result changed its same-job replay.');
      if(result.jobId!==checkpoint.reference||!result.replay)
        fail('KIWIS_JOB_RECEIVING_RESULT','Retain the original job and completed same-job replay.');
      const customer=await receiveCustomer();
      equal(result.exports,customer.exports,'The cold complete native customer exports changed.');
      equal(result.coldExports,customer.coldExports,'The cold native customer export replay changed.');
      equal(result.receivedProject,customer.receivedProject,'The original customer project changed.');
      return {...result,reopened:true};
    }
    const inputsDirectory=join(directory,'inputs');
    inputs=await openInputStore({directory:inputsDirectory,lease,limits:merchant.compiled.inputFileStorage});
    const upload=await stageFile(inputs,definition,merchant.compiled.publicOrigin,checkpoint.reference,
      'source',sourceFile,checkpoint.token,signal);
    equal({bytes:upload.file.bytes,sha256:upload.file.sha256},source,'The original source changed while it was sealed.');
    const prepared=validateJobInput(definition,{...checkpoint.input,$files:{source:upload.file}});
    if(checkpoint.inputSha256&&checkpoint.inputSha256!==prepared.inputSha256)
      fail('KIWIS_JOB_RECEIVING_CHANGED','The canonical original sealed job input changed.');
    await inputs.pinJob({origin:merchant.compiled.publicOrigin,reference:checkpoint.reference,
      functionId:'waterQualityReview',...prepared,policy:definition.inputFiles,token:checkpoint.token,signal});
    checkpoint.upload=upload;checkpoint.inputSha256=prepared.inputSha256;await save(checkpoint);
    const row={id:checkpoint.reference,functionId:'waterQualityReview',...prepared};
    const outputPath=join(directory,'water-quality-commissioning-review.zip');
    if(!checkpoint.output){
      let bytes=await executeJob(merchant,row,{id:'native-commissioning-1'},
        {env:{...process.env,WQX_JOB_TEMP_ROOT:scratch},signal,inputDirectory:inputsDirectory});
      signal.throwIfAborted();lease.assertHeld();
      await immutable(outputPath,bytes);
      checkpoint.output={path:outputPath,bytes:bytes.length,sha256:hash(bytes)};bytes=null;
      await save(checkpoint);global.gc?.();
    }
    if(checkpoint.output.path!==outputPath)
      fail('KIWIS_JOB_RECEIVING_CHANGED','Retain the original full commissioning ZIP path.');
    equal(await metadata(outputPath),{bytes:checkpoint.output.bytes,sha256:checkpoint.output.sha256},
      'The retained full commissioning output changed.');
    if(!checkpoint.replay){
      let bytes=await executeJob(merchant,row,{id:'native-commissioning-2'},
        {env:{...process.env,WQX_JOB_TEMP_ROOT:scratch},signal,inputDirectory:inputsDirectory});
      signal.throwIfAborted();lease.assertHeld();
      const replay={bytes:bytes.length,sha256:hash(bytes)};bytes=null;
      equal(replay,{bytes:checkpoint.output.bytes,sha256:checkpoint.output.sha256},
        'The original same-job replay changed its complete result archive.');
      checkpoint.replay={...replay,reference:row.id,inputSha256:row.inputSha256,attemptId:'native-commissioning-2'};
      await save(checkpoint);global.gc?.();
    }
    const customer=await receiveCustomer();
    equal(customer.original,checkpoint.original,'The full customer result changed its selected review.');
    if(customer.exports.length!==8||customer.coldExports.length!==8)
      fail('KIWIS_JOB_RECEIVING_EXPORTS','Receive and cold-reopen all eight original native formats.');
    checkpoint.completedAt??=new Date().toISOString();
    const result={schema:COMMISSIONING_JOB_RECEIVING_SCHEMA,completedAt:checkpoint.completedAt,
      jobId:checkpoint.reference,binding,original:checkpoint.original,input:checkpoint.input,
      inputSha256:checkpoint.inputSha256,output:checkpoint.output,replay:checkpoint.replay,
      archive:customer.archive,exports:customer.exports,coldExports:customer.coldExports,
      receivedProject:customer.receivedProject,customerResult:join(customerDirectory,'result.json'),
      upload:{file:upload.file,chunks:upload.chunks,status:upload.status}};
    await writePrivateJson(join(directory,'result.json'),result,()=>lease.assertHeld());
    await save(checkpoint);
    return {...result,reopened:false};
  }finally{
    try{await inputs?.close();}finally{await lease.close();}
  }
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {values}=parseArgs({options:{
    source:{type:'string'},'expected-source-sha256':{type:'string'},directory:{type:'string'},
    scratch:{type:'string'},config:{type:'string'},python:{type:'string'},
  }});
  if(!values.source||!values['expected-source-sha256']||!values.directory||!values.scratch)
    fail('KIWIS_JOB_RECEIVING_ARGUMENTS',
      'Use --source COMPLETE_COMMISSIONING_JSON --expected-source-sha256 SHA --directory PRIVATE_RECEIVING --scratch PRIVATE_WORKER_TEMP.');
  const stop=new AbortController();
  const handlers=new Map(['SIGINT','SIGTERM'].map(name=>[name,()=>stop.abort(
    Object.assign(new Error('Receiving stopped by '+name),{code:'JOB_EXECUTION_CANCELLED'}))]));
  for(const [name,handler]of handlers)process.on(name,handler);
  receiveCommissioningJob({sourceFile:values.source,expectedSourceSha256:values['expected-source-sha256'],
    directory:values.directory,scratch:values.scratch,configFile:values.config,python:values.python,signal:stop.signal})
    .then(result=>process.stdout.write(json({jobId:result.jobId,output:result.output,
      exports:result.exports.length,coldExports:result.coldExports.length,
      receivedProject:result.receivedProject,reopened:result.reopened})))
    .catch(error=>{process.stderr.write(json({error:error.code??error.name,message:error.message}));process.exitCode=1;})
    .finally(()=>{for(const [name,handler]of handlers)process.removeListener(name,handler);});
}
