#!/usr/bin/env node
// MIT. Local customer analysis; original buyer and provider operations run in their own tools.
import { parseArgs } from 'node:util';
import { resolve } from 'node:path';
import { readBytes } from '../node/store.mjs';
import { listCaptures, receiveResultFile, receiveResponseFile, openCapture, compareCaptures,
  exportCapture, saveReview } from './library.mjs';
import { requireValue } from './analyze.mjs';
import { startAnalysisWorkspace } from './server.mjs';

const HELP=`Tenderly customer analysis

  receive  --workspace DIR --result ORIGINAL_BUYER_RESULT.json [--request REQUEST.json] [--label TEXT]
  receive  --workspace DIR --response RESPONSE.json [--request REQUEST.json] [--buyer-result RESULT.json] [--label TEXT]
  list     --workspace DIR
  inspect  --workspace DIR --id CAPTURE
  compare  --workspace DIR --before CAPTURE --after CAPTURE
  review   --workspace DIR --before CAPTURE [--after CAPTURE] [--title TEXT] [--notes FILE]
  export   --workspace DIR --id CAPTURE --out DIRECTORY
  serve    --workspace DIR [--port 8468]

--payload-pointer /path explicitly selects the provider object in a merchant envelope.
Receive checks the original native saved response when --result is supplied.
Existing captures reopen by ID; export creates or resumes the same private export.
`;
const strings=['workspace','result','response','buyer-result','request','label','payload-pointer','id','before','after','out','title','notes','port'];
try{
  const {values,positionals}=parseArgs({options:Object.fromEntries([...strings.map(k=>[k,{type:'string'}]),['help',{type:'boolean'}]]),
    allowPositionals:true,strict:true});
  const command=positionals[0];
  if(values.help||!command){process.stdout.write(HELP);}
  else{
    requireValue(positionals.length===1&&typeof values.workspace==='string','WORKSPACE_REQUIRED');
    const workspace=resolve(values.workspace);let result;
    if(command==='receive'){
      requireValue(Boolean(values.result)!==Boolean(values.response),'SELECT_ONE_RESPONSE_SOURCE');
      requireValue(!values['buyer-result']||Boolean(values.response),'BUYER_RESULT_REQUIRES_RESPONSE');
      const options={workspace,label:values.label??'',payloadPointer:values['payload-pointer']??''};
      if(values.request)options.requestBytes=await readBytes(resolve(values.request),4*1024*1024);
      if(values['buyer-result'])options.nativeResultFile=resolve(values['buyer-result']);
      result=values.result?await receiveResultFile(values.result,options):await receiveResponseFile(values.response,options);
      result={id:result.id,analysisPath:result.analysisPath,record:result.record};
    }else if(command==='list')result=await listCaptures(workspace);
    else if(command==='inspect'){const captured=await openCapture(workspace,values.id);result={record:captured.record,analysis:captured.analysis};}
    else if(command==='compare')result=(await compareCaptures(workspace,values.before,values.after)).comparison;
    else if(command==='review'){
      const notes=values.notes?new TextDecoder('utf-8',{fatal:true}).decode(await readBytes(resolve(values.notes),80000)):'';
      const review=await saveReview(workspace,{beforeId:values.before,afterId:values.after??null,title:values.title??'',notes});
      result={id:review.id,directory:review.directory};
    }else if(command==='export'){
      requireValue(typeof values.out==='string','EXPORT_DESTINATION_REQUIRED');result=await exportCapture(workspace,values.id,values.out);
    }else if(command==='serve'){
      requireValue(values.port===undefined||/^[0-9]{1,5}$/.test(values.port),'PORT_INVALID');
      const app=await startAnalysisWorkspace({workspace,port:values.port===undefined?8468:Number(values.port)});
      process.stdout.write('Tenderly customer analysis: '+app.url+'\n');
      let stopping=false;
      const stop=async()=>{if(stopping)return;stopping=true;await app.close();};
      process.once('SIGINT',stop);process.once('SIGTERM',stop);
    }else requireValue(false,'COMMAND_UNKNOWN',HELP);
    if(result!==undefined)process.stdout.write(JSON.stringify(result,null,2)+'\n');
  }
}catch(error){
  process.stderr.write(JSON.stringify({error:error.code??'ANALYSIS_FAILED',
    ...(error.name==='AnalysisError'?{message:error.message}:{})})+'\n');process.exitCode=1;
}
