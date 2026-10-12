#!/usr/bin/env node
// MIT. Original paid-buyer support, complete receipt export and receiving.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {openJobResolutionBuyer} from './client.mjs';
import {createOnlyFile,parseArguments,readInput} from '../../../sf30-seller-sdk/jobs/resolution/cli.mjs';
import {need,json,RESOLUTION_RECEIVING_BYTES} from '../../../sf30-seller-sdk/jobs/resolution/contract.mjs';

export const HELP='Paid-job customer resolution\n\n'+
'  jobs-buyer-resolution inspect|refresh|issue|message|recover|resume|export|receive\n'+
'    --buyer /private/original-buyer [--input /private/request.json]\n'+
'    [--out /private/new-receiving-file.json] [--transport-file /private/original-transport.json]\n'+
'    [--deadline-ms 60000]\n\n'+
'issue/message input: {requestId,expectedRevision,message,requestedRemedy?}.\n'+
'recover/resume input: {requestId}. receive input is the complete saved customer export.\n'+
'The original accepted response and private capability remain in the selected buyer directory.\n';

export async function runJobBuyerResolutionCommand(argv,{signal}={}){
  if(!argv.length||argv[0]==='--help')return {help:HELP};
  const [command,...args]=argv;
  need(['inspect','refresh','issue','message','recover','resume','export','receive'].includes(command),
    'JOB_RESOLUTION_COMMAND_REQUIRED');
  const opt=parseArguments(args,new Set(['--buyer','--input','--out','--transport-file','--deadline-ms']));
  need(opt['--buyer'],'JOB_RESOLUTION_BUYER_REQUIRED');
  const deadlineMs=Number(opt['--deadline-ms']??60000);
  need(Number.isSafeInteger(deadlineMs)&&deadlineMs>=1&&deadlineMs<=120000,'JOB_RESOLUTION_DEADLINE_INVALID');
  const transport=opt['--transport-file']?await readInput(opt['--transport-file'],65536):undefined;
  const buyer=await openJobResolutionBuyer({directory:resolve(opt['--buyer']),transport,requestTimeoutMs:deadlineMs});
  try{
    if(command==='inspect')return await buyer.inspect();
    if(command==='refresh')return await buyer.refresh({signal,deadlineMs});
    if(command==='export'){need(opt['--out'],'JOB_RESOLUTION_OUTPUT_REQUIRED');return createOnlyFile(opt['--out'],json(await buyer.export()));}
    need(!opt['--out'],'JOB_RESOLUTION_OUTPUT_ARGUMENT_INVALID');
    const input=await readInput(opt['--input'],command==='receive'?RESOLUTION_RECEIVING_BYTES:24000);
    if(command==='receive')return await buyer.receive(input);
    if(['recover','resume'].includes(command))return await buyer[command](input.requestId,{signal,deadlineMs});
    return await buyer[command](input,{signal,deadlineMs});
  }finally{await buyer.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const controller=new AbortController(),stop=()=>controller.abort();
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{const result=await runJobBuyerResolutionCommand(process.argv.slice(2),{signal:controller.signal});
    process.stdout.write(result.help??JSON.stringify(result)+'\n');
    if(result.operations?.some(o=>['FAILED','UNKNOWN','DISPATCHING'].includes(o.state)))process.exitCode=2;
  }catch(error){process.stderr.write(JSON.stringify({error:error.code??'JOB_RESOLUTION_COMMAND_FAILED'})+'\n');process.exitCode=1;}
  finally{process.off('SIGINT',stop);process.off('SIGTERM',stop);}
}
