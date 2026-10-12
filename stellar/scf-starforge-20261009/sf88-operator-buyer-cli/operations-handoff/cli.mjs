#!/usr/bin/env node
// MIT. Original native buyer handoff export/inspection. No attempt, signing or payment command.
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {pathToFileURL} from 'node:url';
import {resolve} from 'node:path';
import {captureInbox,saveHandoff} from './capture.mjs';
import {MAX_BYTES,need,inspectHandoff,renderHandoff} from './contract.mjs';

function args(values){
  const result={command:values.shift(),intents:[]};
  need(['export','inspect'].includes(result.command),'USAGE_export_--inbox_PATH_--intent_ID_--output_FILE_OR_inspect_--file_FILE');
  const known=new Set(['--inbox','--intent','--output','--file','--max-verify-bytes']);
  for(let i=0;i<values.length;i+=2){
    const key=values[i],value=values[i+1];need(known.has(key)&&typeof value==='string'&&value.length>0,'BUYER_HANDOFF_ARGUMENT_INVALID');
    if(key==='--intent')result.intents.push(value);
    else{need(result[key]===undefined,'BUYER_HANDOFF_DUPLICATE_ARGUMENT');result[key]=value;}
  }
  if(result.command==='export')need(result['--inbox']&&result['--output']&&result.intents.length&&result['--file']===undefined,'BUYER_EXPORT_ARGUMENTS_REQUIRED');
  else need(result['--file']&&result['--inbox']===undefined&&!result.intents.length&&result['--output']===undefined&&result['--max-verify-bytes']===undefined,'BUYER_INSPECT_ARGUMENTS_REQUIRED');
  return result;
}
export async function main(argv=process.argv.slice(2)){
  const selected=args([...argv]);
  if(selected.command==='inspect'){
    const handle=await open(resolve(selected['--file']),constants.O_RDONLY|(constants.O_NOFOLLOW??0));
    let raw;try{const stat=await handle.stat();need(stat.isFile()&&stat.size>0&&stat.size<=MAX_BYTES,'BUYER_HANDOFF_SIZE');
      const buffer=Buffer.alloc(MAX_BYTES+1);let length=0;while(length<buffer.length){const read=await handle.read(buffer,length,buffer.length-length,length);if(!read.bytesRead)break;length+=read.bytesRead;}
      need(length===stat.size&&length<=MAX_BYTES,'BUYER_HANDOFF_CHANGED');raw=buffer.subarray(0,length);
    }finally{await handle.close();}
    const report=inspectHandoff(raw);process.stdout.write(JSON.stringify({report,html:renderHandoff(report)},null,2)+'\n');return;
  }
  const max=selected['--max-verify-bytes'];
  if(max!==undefined)need(/^(0|[1-9][0-9]{0,10})$/.test(max),'BUYER_OUTPUT_LIMIT_INVALID');
  const value=await captureInbox({directory:resolve(selected['--inbox']),intentIds:selected.intents,
    ...(max===undefined?{}:{maxVerifyBytes:Number(max)})});
  const saved=await saveHandoff(resolve(selected['--output']),value.raw);
  process.stdout.write(JSON.stringify({...saved,counts:value.report.counts,intentIds:selected.intents,
    noExecution:true,report:value.report},null,2)+'\n');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  main().catch(error=>{process.stderr.write(JSON.stringify({code:error.code??'BUYER_HANDOFF_FAILED',message:error.message})+'\n');process.exitCode=2;});
