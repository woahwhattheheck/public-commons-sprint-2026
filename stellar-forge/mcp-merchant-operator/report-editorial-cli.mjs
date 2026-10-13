#!/usr/bin/env node
// MIT. Complete report editorial operation and receiving CLI.
import {realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readWorkflowSeriesPrivateFile} from './workflow-series-connection.mjs';
import {need} from './analysis-report-review-client.mjs';
import {callReportEditorial,receiveReportEditorialReturn,downloadReportEditorial} from './report-editorial-client.mjs';
function options(values,allowed){
 const out={};for(let i=0;i<values.length;i+=2){const key=values[i],value=values[i+1];
 need(allowed.includes(key)&&!Object.hasOwn(out,key)&&typeof value==='string'&&value&&!value.startsWith('--'),'Use complete distinct documented options.');out[key]=value;}
 return out;
}
export async function main(argv=process.argv.slice(2)){
 const[command,...tail]=argv;
 if(!command||['help','--help','-h'].includes(command)){
 console.log('Report editorial returns on the original Analysis workspace\n\n'+
 '  starforge report-editorial-agent call --url MCP_URL --action ACTION --arguments PRIVATE.json --directory PRIVATE_OPERATION [--token-env MCP_ACCESS_TOKEN]\n'+
 '  starforge report-editorial-agent receive --url MCP_URL --workspace ALIAS --upload-id HEX32 --returned PRIVATE_RETURN.json --directory PRIVATE_OPERATION [--token-env MCP_ACCESS_TOKEN]\n'+
 '  starforge report-editorial-agent download --url MCP_URL --workspace ALIAS --export-id SHA256 --manifest-sha256 SHA256 --directory PRIVATE_DELIVERY [--token-env MCP_ACCESS_TOKEN]\n\n'+
 'Call actions: connections, state, history, detail, issue, returned, preview, apply, status, export.\n'+
 'Arguments are the complete declared tool arguments including workspace. Each call retains its immutable complete intent before dispatch.\n'+
 'Reuse the same operation directory and request ID after interruption. receive can omit --returned on continuation; its original complete bytes are retained.\n'+
 'Read the actual complete comparison file before apply. NEEDS_REVIEW requires a fresh explicit comparison; native status remains available under the old request ID.');
 return 0;
 }
 const common=['--url','--token-env','--directory'];
 if(command==='call'){
  const o=options(tail,[...common,'--action','--arguments']);
  need(o['--url']&&o['--action']&&o['--arguments']&&o['--directory'],'Supply the endpoint, action, complete private arguments and original operation directory.');
  const raw=await readWorkflowSeriesPrivateFile(resolve(o['--arguments']),1024*1024+65536);
  const args=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  const result=await callReportEditorial({url:o['--url'],tokenEnv:o['--token-env']??'MCP_ACCESS_TOKEN',
   action:o['--action'],args,directory:resolve(o['--directory'])});
  console.log(JSON.stringify(result));return 0;
 }
 if(command==='receive'){
  const o=options(tail,[...common,'--workspace','--upload-id','--returned']);
  need(['--url','--workspace','--upload-id','--directory'].every(k=>o[k]),'Supply the original endpoint, workspace, upload ID and receiving directory.');
  const result=await receiveReportEditorialReturn({url:o['--url'],tokenEnv:o['--token-env']??'MCP_ACCESS_TOKEN',
   workspace:o['--workspace'],uploadId:o['--upload-id'],returnedFile:o['--returned'],directory:resolve(o['--directory'])});
  console.log(JSON.stringify(result));return 0;
 }
 if(command==='download'){
  const o=options(tail,[...common,'--workspace','--export-id','--manifest-sha256']);
  need(['--url','--workspace','--export-id','--manifest-sha256','--directory'].every(k=>o[k]),'Supply the complete original delivery selection.');
  const result=await downloadReportEditorial({url:o['--url'],tokenEnv:o['--token-env']??'MCP_ACCESS_TOKEN',
   workspace:o['--workspace'],exportId:o['--export-id'],expectedManifestSha256:o['--manifest-sha256'],directory:resolve(o['--directory'])});
  console.log(JSON.stringify(result));return 0;
 }
 need(false,'Choose call, receive or download; use --help for the full original contract.');
}
if(process.argv[1]&&await realpath(resolve(process.argv[1])).then(p=>pathToFileURL(p).href===import.meta.url,()=>false)){
 main().then(code=>{process.exitCode=code;}).catch(error=>{
  console.error(JSON.stringify({error:{code:error.code??'REPORT_REVIEW_CLIENT',message:error.message,
   outcomeUnknown:error.outcomeUnknown??false,resultReceived:error.resultReceived??false,
   recovery:'Keep the complete original intent and request ID. Read status before an exact retry; use the same private operation directory.'}}));
  process.exitCode=1;
 });
}
