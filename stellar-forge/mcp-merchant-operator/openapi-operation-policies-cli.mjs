#!/usr/bin/env node
// MIT. Original policy library, source-bound review and complete receiving.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {callOpenApiOperationPolicy,downloadOpenApiOperationPolicy,readOpenApiOperationPolicy,operationPolicyCommands} from './openapi-operation-policies-client.mjs';
import {sf61Failure as fail,sf61Plain as plain} from './sf61-connection.mjs';

export async function main(args=process.argv.slice(2)) {
 const [command,...rest]=args;
 if(!Object.hasOwn(operationPolicyCommands,command)&&!['export','read'].includes(command))
  throw fail('INVALID_PARAMS','Choose list, load, save, review, package, export or read.');
 const allowed=new Set(command==='read'?['--file','--kind','--sha256']:
  ['--url','--request-file','--token-env',...(command==='export'?['--out','--sha256','--chunk-bytes']:[])]);
 const options=new Map();
 for(let index=0;index<rest.length;index+=2) {
  if(!allowed.has(rest[index])||options.has(rest[index])||typeof rest[index+1]!=='string'||rest[index+1].startsWith('--'))
   throw fail('INVALID_PARAMS','Use each declared option once with its complete value.');
  options.set(rest[index],rest[index+1]);
 }
 let result;
 if(command==='read') {
  if(!options.get('--file'))throw fail('INVALID_PARAMS','Choose the complete received file with --file.');
  result=await readOpenApiOperationPolicy({path:options.get('--file'),kind:options.get('--kind')??'policy',
   expectedSha256:options.get('--sha256')});
 } else {
  if(!options.get('--url')||!options.get('--request-file'))
   throw fail('INVALID_PARAMS','Provide the original merchant --url and a complete --request-file.');
  const bytes=await readFile(options.get('--request-file'));
  if(bytes.length>131072)throw fail('OPENAPI_OPERATION_POLICY_REQUEST_TOO_LARGE',
   'Keep the complete request within 128 KiB; select original host-declared source, plan, worksheet, policy and application files.');
  const request=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!plain(request))throw fail('INVALID_PARAMS','The request file must contain one complete merchant argument object.');
  const connection={url:options.get('--url'),tokenEnv:options.get('--token-env')??'MCP_ACCESS_TOKEN'};
  if(command==='export') {
   if(!options.get('--out'))throw fail('INVALID_PARAMS','Choose the complete receiving filename with --out.');
   const {workspace,...selected}=request;
   result=await downloadOpenApiOperationPolicy({...connection,workspace,request:selected,path:options.get('--out'),
    expectedFileSha256:options.get('--sha256'),
    ...(options.has('--chunk-bytes')?{chunkBytes:Number(options.get('--chunk-bytes'))}:{})});
  } else result=await callOpenApiOperationPolicy({...connection,operation:command,request});
 }
 process.stdout.write(JSON.stringify(result,null,2)+'\n');
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
 main().catch(error=>{
  process.stderr.write(JSON.stringify({code:error.code??'OPENAPI_OPERATION_POLICY_ERROR',reason:error.message,
   ...(error.outcomeUnknown?{outcomeUnknown:true}:{})})+'\n');process.exitCode=1;
 });
