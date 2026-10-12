#!/usr/bin/env node
// MIT. Complete commissioning selection and customer receiving through the original paid-job transport.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { immutable } from './receive.mjs';
import { inspectCommissioningJobSource, receiveCommissioningJobResult,
  downloadCommissioningJob, reopenCommissioningJob } from './commissioning-client.mjs';

const json=value=>JSON.stringify(value,null,2)+'\n';
const fail=message=>{throw Object.assign(new Error(message),{code:'KIWIS_CUSTOMER_ARGUMENTS'});};
export const COMMISSIONING_JOB_HELP = [
  'Water Quality commissioning: original paid-job customer workflow',
  '',
  'source --source FILE --expected-source-sha256 SHA [--out REQUEST.json]',
  '  Read the complete saved edition and emit its exact ordinary job input.',
  'receive --archive ZIP --expected-archive-sha256 SHA --directory PRIVATE [--python PYTHON]',
  '  Verify the full result, receive the native project and cold-reopen all eight exports.',
  'download --url MCP_URL --workspace NAME --export-id ID --expected-manifest-sha256 SHA',
  '         --directory PRIVATE_DOWNLOAD --receiving-directory PRIVATE_PROJECT [--token-env NAME]',
  '  Use the existing MCP export and complete-file downloader, then the same native receiver.',
  'reopen --directory PRIVATE_DOWNLOAD --receiving-directory PRIVATE_PROJECT',
  '       [--workspace NAME] [--export-id ID] [--expected-manifest-sha256 SHA]',
  '  Rehash the complete retained MCP download and reopen the original native project offline.',
  '',
  'All result commands accept --out RECEIPT.json. Existing complete files must match exactly.',
  'Source selection emits the actual saved reviewId and both SHA-256 bindings, not placeholder values.',
  'The original job intake, checkout approval, merchant worker and Stop controls retain their ownership.',
].join('\n');

const specifications={
  source:{source:{type:'string'},'expected-source-sha256':{type:'string'},out:{type:'string'}},
  receive:{archive:{type:'string'},'expected-archive-sha256':{type:'string'},directory:{type:'string'},
    python:{type:'string'},'job-id':{type:'string'},out:{type:'string'}},
  download:{url:{type:'string'},workspace:{type:'string'},'export-id':{type:'string'},
    'expected-manifest-sha256':{type:'string'},directory:{type:'string'},'receiving-directory':{type:'string'},
    'token-env':{type:'string'},python:{type:'string'},out:{type:'string'}},
  reopen:{directory:{type:'string'},'receiving-directory':{type:'string'},workspace:{type:'string'},
    'export-id':{type:'string'},'expected-manifest-sha256':{type:'string'},python:{type:'string'},out:{type:'string'}},
};
function requireValues(values,names){for(const name of names)if(!values[name])fail('Supply --'+name+'.');}
function stableReceipt(result){
  if(result.commissioning){
    const {reopened,...commissioning}=result.commissioning;
    const transport=result.transport;
    return {schema:'starforge.wqx-commissioning-customer-cli.v1',transport:{
      directory:transport.directory,workspace:transport.workspace,endpoint:transport.endpoint,
      exportId:transport.exportId,manifestSha256:transport.manifestSha256,
      sourceSha256:transport.sourceSha256,job:transport.job,files:transport.files,bytes:transport.bytes,
    },commissioning};
  }
  const {reopened,...receipt}=result;
  return receipt;
}

/** This entry point uses the caller's AbortSignal; the CLI owns and drains its exact invocation. */
export async function main(argv=process.argv.slice(2),{signal=new AbortController().signal}={}){
  const [command,...args]=argv;
  if(!command||command==='help'||command==='--help'){
    process.stdout.write(COMMISSIONING_JOB_HELP+'\n');return null;
  }
  const specification=specifications[command];
  if(!specification)fail('Use source, receive, download or reopen. Run --help for complete options.');
  const {values}=parseArgs({args,options:specification,strict:true,allowPositionals:false});
  let result,output;
  if(command==='source'){
    requireValues(values,['source','expected-source-sha256']);
    result=await inspectCommissioningJobSource({sourceFile:values.source,
      expectedSourceSha256:values['expected-source-sha256'],signal});
    output=result.input;
  }else if(command==='receive'){
    requireValues(values,['archive','expected-archive-sha256','directory']);
    result=await receiveCommissioningJobResult({archiveFile:values.archive,
      expectedArchiveSha256:values['expected-archive-sha256'],directory:values.directory,
      python:values.python,expectedJobId:values['job-id'],signal});
    output=stableReceipt(result);
  }else if(command==='download'){
    requireValues(values,['url','workspace','export-id','expected-manifest-sha256','directory','receiving-directory']);
    result=await downloadCommissioningJob({url:values.url,workspace:values.workspace,exportId:values['export-id'],
      expectedManifestSha256:values['expected-manifest-sha256'],directory:values.directory,
      receivingDirectory:values['receiving-directory'],tokenEnv:values['token-env'],python:values.python,signal});
    output=stableReceipt(result);
  }else{
    requireValues(values,['directory','receiving-directory']);
    result=await reopenCommissioningJob({directory:values.directory,receivingDirectory:values['receiving-directory'],
      workspace:values.workspace,exportId:values['export-id'],
      expectedManifestSha256:values['expected-manifest-sha256'],python:values.python,signal});
    output=stableReceipt(result);
  }
  signal.throwIfAborted();
  if(values.out){
    const out=resolve(values.out);await immutable(out,Buffer.from(json(output)));
    process.stdout.write(json({command,out,...(command==='source'
      ?{source:result.source,commissioning:result.commissioning}
      :{jobId:result.commissioning?.jobId??result.jobId,
        exports:(result.commissioning??result).exports.length,
        receivedProject:(result.commissioning??result).receivedProject})}));
  }else process.stdout.write(json(output));
  return result;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const stop=new AbortController(),handlers=new Map(['SIGINT','SIGTERM'].map(name=>[name,()=>stop.abort(
    Object.assign(new Error('Receiving stopped by '+name),{code:'JOB_EXECUTION_CANCELLED'}))]));
  for(const[name,handler]of handlers)process.on(name,handler);
  main(process.argv.slice(2),{signal:stop.signal})
    .catch(error=>{process.stderr.write(json({error:error.code??error.name,message:error.message}));process.exitCode=1;})
    .finally(()=>{for(const[name,handler]of handlers)process.removeListener(name,handler);});
}
