#!/usr/bin/env node
// MIT — Inspect and receive an original research export.
import {parseArgs} from 'node:util';
import {resolve} from 'node:path';
import {realpath} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {inspectResearchExports,receiveResearchExports} from './receive-export.mjs';
const HELP='Research edition receiving\n\n'+
 'inspect --source FULL_EXPORTED_EDITION [--source ANOTHER_EDITION] [--max-bytes N]\n'+
 'receive --source FULL_EXPORTED_EDITION [--source ANOTHER_EDITION] --workspace NEW_PRIVATE_DIRECTORY [--max-bytes N] [--python python3]\n\n'+
 'The receiver validates the original manifest and opens the exact source/pages/reviews in the maintained research workspace.\n'+
 'A repeated identical receive reopens the completed target and preserves later review edits.\n';
export async function main(args=process.argv.slice(2)){
  const {values:v,positionals}=parseArgs({args,strict:true,allowPositionals:true,options:{
    source:{type:'string',multiple:true},workspace:{type:'string'},'max-bytes':{type:'string'},python:{type:'string'},help:{type:'boolean'}}});
  if(v.help||!positionals.length){process.stdout.write(HELP);return;}
  const maxBytes=v['max-bytes']===undefined?undefined:Number(v['max-bytes']);
  if(positionals.length!==1||!v.source||maxBytes!==undefined&&(!Number.isSafeInteger(maxBytes)||maxBytes<=0))throw Error(HELP);
  const command=positionals[0];let result;
  if(command==='inspect')result=await inspectResearchExports(v.source.map(s=>resolve(s)),{maxBytes});
  else if(command==='receive'&&v.workspace)result=await receiveResearchExports({
    sourceDirectories:v.source.map(s=>resolve(s)),destination:resolve(v.workspace),maxBytes,python:v.python});
  else throw Error(HELP);
  process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
const invoked=process.argv[1]?await realpath(resolve(process.argv[1])).catch(()=>null):null;
if(invoked&&import.meta.url===pathToFileURL(invoked).href){
  main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'RESEARCH_RECEIVING_FAILED',
    message:error.message,...(error.preparedDirectory?{preparedDirectory:error.preparedDirectory}:{})})+'\n');process.exitCode=1;});
}
