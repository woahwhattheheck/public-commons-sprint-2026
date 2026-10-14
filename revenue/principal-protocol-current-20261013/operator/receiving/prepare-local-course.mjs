#!/usr/bin/env node
// MIT. Prepare the complete real-source local course; no workspace or RPC operation.
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {options,readOriginal} from '../cli.mjs';
import {writeExact} from '../lib/files.mjs';
import {need,hash,bytes} from '../lib/value.mjs';
const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export async function prepareLocalCourse(argv=process.argv.slice(2)){
 const opt=options(argv);
 need(Object.keys(opt).sort().join(',')==='directory,operation-id,out','LOCAL_COURSE_OPTIONS');
 need(path.isAbsolute(opt.directory)&&path.isAbsolute(opt.out),'ABSOLUTE_INPUT_REQUIRED');
 const operationId=opt['operation-id'];
 need(typeof operationId==='string'&&/^[a-zA-Z0-9._:-]{1,160}$/.test(operationId),'OPERATION_ID_REQUIRED');
 const selected=['CONTRACT_API.json','source-files.json','contracts-source/docs/ACCOUNTING_EDITION_3.md','contracts-source/docs/MARKET_EDITION_1.md','contracts-source/docs/PAIRED_EXIT_EDITION_1.md','native/PAIRED_EXIT_BUILD.md'];
 const sources=[];
 for(const relative of selected){const original=await readOriginal(path.join(ROOT,relative));sources.push({relative,...original});}
 const api=JSON.parse(sources[0].data.toString('utf8'));
 need(api.schema==='principal.contract-api.v2'&&api.edition==='principal-paired-exit-1-market-1-accounting-3','CURRENT_PAIRED_EXIT_SOURCE_REQUIRED');
 const base=path.resolve(opt.directory),tag=hash(bytes({operationId,directory:base})).slice(0,24);
 const producerCommands=sources.map((source,index)=>({
  requestId:tag+'.source.'+index,expectedRevision:index,method:'source.import',
  args:{name:source.relative,type:source.relative.endsWith('.json')?'application/json':'text/markdown',
        contentBase64:source.data.toString('base64'),bytes:source.descriptor.bytes,sha256:source.descriptor.sha256}
 }));
 producerCommands.push({requestId:tag+'.source-note',expectedRevision:sources.length,method:'note.save',
  args:{subjectId:'source-edition:'+api.edition,title:'Original paired-exit, market and accounting source selection',
   body:'Retained complete installed ABI, source manifest and accounting guide for '+api.edition+
        '. This local source course records no deployed-contract, balance, transaction or native-build result.'}});
 const customerCommands=[{requestId:tag+'.recipient-note',expectedRevision:producerCommands.length,method:'note.save',
  args:{subjectId:'source-edition:'+api.edition,title:'Independent source handover continuation',
   body:'Independent recipient retained the original source files and request history, and added this explicit source-review note before complete return. Actual chain observations and rendered operation remain separately recorded.'}}];
 const input={schema:'principal.receiving-input.v1',operationId,
  producerDirectory:path.join(base,'producer'),customerDirectory:path.join(base,'customer'),
  returnDirectory:path.join(base,'return'),producerCommands,customerCommands};
 const data=bytes(input);await writeExact(opt.out,data);
 return{schema:'principal.local-course-prepared.v1',operationId,input:{path:path.resolve(opt.out),bytes:data.length,sha256:hash(data)},
  edition:api.edition,sourceFiles:sources.map(s=>({path:s.relative,bytes:s.descriptor.bytes,sha256:s.descriptor.sha256})),
  producerCommands:producerCommands.length,customerCommands:customerCommands.length,
  next:['node',path.join(ROOT,'cli.mjs'),'course','--input',path.resolve(opt.out),'--out',path.join(base,'receiving')]};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)
 prepareLocalCourse().then(result=>process.stdout.write(JSON.stringify(result,null,2)+'\n')).catch(error=>{
  process.stderr.write(JSON.stringify({error:{code:error.code??'ERROR',message:error.message}})+'\n');process.exitCode=1;
 });
