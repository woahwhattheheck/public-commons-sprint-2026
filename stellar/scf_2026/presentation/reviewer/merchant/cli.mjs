#!/usr/bin/env node
// MIT. Original reviewer operations and complete retained files through the normal merchant host.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readSourceFile} from '../workspace.mjs';
import {openReviewerMerchantClient,reviewReviewerFile,downloadReviewerExport,inspectReviewerExport,
  reopenReviewerExport,reviewerActions} from './client.mjs';
import {initializeReviewerMerchant} from './setup.mjs';
import {decode,need} from './contracts.mjs';
const help = [
  'starforge merchant-grant-reviewer tools',
  'starforge merchant-grant-reviewer init --directory ABS --connection ABS [--name NAME]',
  'starforge merchant-grant-reviewer call --url MCP_URL --token-env ENV --action ACTION --args ABS_JSON',
  'starforge merchant-grant-reviewer review-file --url MCP_URL --token-env ENV --workspace ALIAS --file ABS --title TITLE --request-id UUID [--expected-sha256 SHA]',
  'starforge merchant-grant-reviewer inspect --url MCP_URL --token-env ENV --workspace ALIAS --export-id SHA',
  'starforge merchant-grant-reviewer download --url MCP_URL --token-env ENV --workspace ALIAS --export-id SHA --directory ABS [--manifest-sha256 SHA] [--chunk-size BYTES]',
  'starforge merchant-grant-reviewer reopen --workspace ALIAS --export-id SHA --directory ABS [--manifest-sha256 SHA]',
  '',
  'Use original saved UUIDs for mutations; call action after a lost reply before selecting another operation.',
  'Access credentials are read from the selected environment variable, never a command argument.',
  'download resumes the same retained directory; reopen verifies complete local files without a network call.',
].join('\n');
export async function main(argv=process.argv.slice(2),{environment=process.env,signal,write=value=>process.stdout.write(value)}={}){
  const [command,...rest]=argv;
  if(!command||command==='--help'||command==='help'){write(help+'\n');return;}
  const flags=Object.create(null);
  for(let i=0;i<rest.length;i+=2){
    need(/^--[a-z][a-z-]*$/.test(rest[i]??'') && typeof rest[i+1]==='string' && !rest[i+1].startsWith('--') &&
      !Object.hasOwn(flags,rest[i]),'GRANT_REVIEWER_CLI_INPUT','Use one value after each declared option.');
    flags[rest[i]]=rest[i+1];
  }
  const allowed={
    tools:[],
    init:['directory','connection','name'],
    call:['url','token-env','action','args'],
    'review-file':['url','token-env','workspace','file','title','request-id','expected-sha256'],
    inspect:['url','token-env','workspace','export-id'],
    download:['url','token-env','workspace','export-id','directory','manifest-sha256','chunk-size'],
    reopen:['workspace','export-id','directory','manifest-sha256'],
  }[command];
  need(allowed && Object.keys(flags).every(k=>allowed.includes(k.slice(2))),
    'GRANT_REVIEWER_CLI_INPUT','Choose a declared original reviewer command and options.');
  const required=key=>{need(typeof flags['--'+key]==='string' && flags['--'+key],
    'GRANT_REVIEWER_CLI_INPUT','Missing --'+key);return flags['--'+key];};
  const remote=()=>({url:required('url'),tokenEnv:flags['--token-env']??'MCP_ACCESS_TOKEN',environment,signal});
  const selected=()=>({workspace:required('workspace'),exportId:required('export-id')});
  let result;
  if(command==='tools')result={tools:Object.values(reviewerActions)};
  else if(command==='init')result=await initializeReviewerMerchant({directory:resolve(required('directory')),
    connection:resolve(required('connection')),...(flags['--name']?{name:flags['--name']}:{})});
  else if(command==='call'){
    const input=decode(await readSourceFile(resolve(required('args')),{maxBytes:12*1024*1024})),
      client=await openReviewerMerchantClient(remote());
    result=await client.call(required('action'),input);
  }else if(command==='review-file')result=await reviewReviewerFile({...remote(),workspace:required('workspace'),
    file:resolve(required('file')),title:required('title'),requestId:required('request-id'),
    expectedSha256:flags['--expected-sha256']});
  else if(command==='inspect')result=await inspectReviewerExport({...remote(),...selected()});
  else if(command==='download'){
    const chunk=flags['--chunk-size'];
    need(chunk===undefined||/^[1-9][0-9]*$/.test(chunk),'GRANT_REVIEWER_CLI_INPUT','Chunk size must be a positive byte count.');
    result=await downloadReviewerExport({...remote(),...selected(),directory:resolve(required('directory')),
      expectedManifestSha256:flags['--manifest-sha256'],...(chunk?{chunkSize:Number(chunk)}:{})});
  }else result=await reopenReviewerExport({...selected(),directory:resolve(required('directory')),
    expectedManifestSha256:flags['--manifest-sha256']});
  write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const controller=new AbortController(),stop=()=>controller.abort(new Error('Original reviewer command cancelled.'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{await main(undefined,{signal:controller.signal});}
  catch(error){process.stderr.write(JSON.stringify({error:{code:error.code??error.name,message:error.message,
    ...(error.details?{details:error.details}:{})}})+'\n');process.exitCode=1;}
  finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
