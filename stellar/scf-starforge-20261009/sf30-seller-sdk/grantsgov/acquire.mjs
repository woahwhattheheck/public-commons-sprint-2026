#!/usr/bin/env node
// MIT. Source acquisition/receiving utility for the maintained Grants.gov capture API.
import {readFile,mkdir,rename,unlink} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createFile,syncDirectory} from '../postgres/publisher/files.mjs';
import {resolve,dirname,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {captureGrants,readCapture,exportCapture,importCapture} from './capture.mjs';
import {sourceFromResponse} from './transport.mjs';
import {sha,need,fault} from './source.mjs';

const help='Grants.gov source acquisition\n\n'+
  'node acquire.mjs capture --directory /private/capture --query-file query.json --operation grant-ai-20261012\n'+
  '  [--seed-manifest original-http-sources.json] [--max-pages 1000] [--max-opportunities 25000]\n'+
  'node acquire.mjs status --directory /private/capture\n'+
  'node acquire.mjs export --directory /private/capture --output /private/capture-export.json\n'+
  'node acquire.mjs import --directory /private/receiving --input /private/capture-export.json\n\n'+
  'Queries: keyword, opportunityNumber, statuses, agencies, eligibilities, fundingCategories,\n'+
  'fundingInstruments, aln, pageSize. An existing capture resumes the same operation and query.\n'+
  'Seed manifest: [{kind,requestFile,responseFile,receiptFile}]. Paths resolve beside that manifest.\n'+
  'The export preserves exact public data slices and response receipts; token envelopes are excluded.\n';
function options(args){
  const result={};
  for(let i=0;i<args.length;i++){
    need(/^--[a-z-]+$/.test(args[i]),'GRANTS_ARGUMENT_INVALID');
    const key=args[i].slice(2);
    need(args[i+1]&&!args[i+1].startsWith('--'),'GRANTS_ARGUMENT_VALUE_REQUIRED',key+' requires a value.');
    need(!(key in result),'GRANTS_ARGUMENT_DUPLICATE');
    result[key]=args[++i];
  }
  return result;
}
async function json(path){return JSON.parse(await readFile(path,'utf8'));}
async function originalSeeds(path){
  if(!path)return [];
  const entries=await json(path),root=dirname(resolve(path));
  need(Array.isArray(entries),'GRANTS_SEED_MANIFEST_INVALID');
  const result=[];
  for(const entry of entries){
    const locate=name=>isAbsolute(name)?name:resolve(root,name);
    const request=await readFile(locate(entry.requestFile));
    const response=await readFile(locate(entry.responseFile));
    const receipt=await json(locate(entry.receiptFile));
    need(sha(request)===receipt.requestSha256&&sha(response)===receipt.responseSha256&&response.length===receipt.bytes,
      'GRANTS_SEED_RECEIPT_MISMATCH','An original HTTP source differs from its acquisition receipt.');
    const value=sourceFromResponse({kind:entry.kind,requestBody:JSON.parse(request.toString('utf8')),
      requestBytes:request,responseBytes:response,status:receipt.status,headers:receipt.headers,
      startedAt:receipt.capturedAt,capturedAt:receipt.capturedAt});
    result.push(value);
  }
  return result;
}
function summary(view){
  return {schema:view.schema,captureId:view.captureId,operationId:view.operationId,status:view.status,
    query:view.query,startedAt:view.startedAt,completedAt:view.completedAt,coverage:view.coverage,
    sourceSignature:view.sourceSignature,opportunityCount:view.opportunities.length,
    pendingSourceCount:view.pendingSources.length};
}
async function output(path,bytes){
  const target=resolve(path);await mkdir(dirname(target),{recursive:true,mode:0o700});
  const temporary=target+'.export-'+randomUUID();
  try{
    await createFile(temporary,bytes);
    await rename(temporary,target);
    await syncDirectory(dirname(target));
  }finally{await unlink(temporary).catch(error=>{if(error.code!=='ENOENT')throw error;});}
  return {file:target,bytes:bytes.length,sha256:sha(bytes)};
}
export async function main(argv=process.argv.slice(2)){
  const action=argv.shift();
  if(!action||action==='help'||action==='--help'){process.stdout.write(help);return;}
  const args=options(argv);need(args.directory,'GRANTS_DIRECTORY_REQUIRED');
  const directory=resolve(args.directory);
  const allowed={
    capture:['directory','query-file','operation','seed-manifest','max-pages','max-opportunities','search-only'],
    status:['directory'],export:['directory','output'],import:['directory','input']
  };
  need(action in allowed,'GRANTS_ACTION_INVALID');
  for(const key of Object.keys(args))need(allowed[action].includes(key),'GRANTS_ARGUMENT_UNKNOWN','Unknown option: '+key);
  if(action==='capture'){
    need(args['query-file']&&args.operation,'GRANTS_CAPTURE_ARGUMENTS_REQUIRED','Provide --query-file and --operation.');
    const controller=new AbortController();
    const pause=()=>controller.abort();
    process.once('SIGINT',pause);process.once('SIGTERM',pause);
    let lastDetail=-1;
    try{
      const view=await captureGrants({directory,query:await json(resolve(args['query-file'])),operationId:args.operation,
        signal:controller.signal,seedSources:await originalSeeds(args['seed-manifest']?resolve(args['seed-manifest']):null),
        includeDetails:args['search-only']!=='true',
        maxPages:Number(args['max-pages']??1000),maxOpportunities:Number(args['max-opportunities']??25000),
        onProgress:value=>{
          if(value.phase!=='detail'||value.coverage.detailCount===1||value.coverage.detailCount>=lastDetail+10){
            process.stdout.write(JSON.stringify({event:'capture-progress',...value})+'\n');
            lastDetail=value.coverage.detailCount;
          }
        }});
      process.stdout.write(JSON.stringify({event:'capture-result',...summary(view)})+'\n');
    }finally{process.removeListener('SIGINT',pause);process.removeListener('SIGTERM',pause);}
  }else if(action==='status'){
    process.stdout.write(JSON.stringify(summary(await readCapture(directory)),null,2)+'\n');
  }else if(action==='export'){
    need(args.output,'GRANTS_OUTPUT_REQUIRED');
    const packet=await exportCapture(directory),bytes=Buffer.from(JSON.stringify(packet,null,2)+'\n');
    process.stdout.write(JSON.stringify({captureId:packet.captureId,sourceSignature:packet.sourceSignature,
      ...await output(args.output,bytes)})+'\n');
  }else{
    need(args.input,'GRANTS_INPUT_REQUIRED');
    process.stdout.write(JSON.stringify(summary(await importCapture(directory,await json(resolve(args.input)))),null,2)+'\n');
  }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().catch(error=>{
    process.stderr.write(JSON.stringify({error:error.code??'GRANTS_SOURCE_FAILED',message:error.message,
      captureId:error.captureId??null,retryAt:error.retryAt??null,checkpointError:error.checkpointError??null})+'\n');
    process.exitCode=1;
  });
}
