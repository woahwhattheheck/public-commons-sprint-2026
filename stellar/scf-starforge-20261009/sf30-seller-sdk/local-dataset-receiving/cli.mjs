#!/usr/bin/env node
// SPDX-License-Identifier: MIT
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readJson,fault} from '../postgres/publisher/files.mjs';
import {openLocalDatasetClient} from '../../../../stellar-forge/mcp-merchant-operator/local-dataset-workspace-client.mjs';
import {receiveLocalDatasetPackage} from './package.mjs';
const HELP=`Local dataset customer receiving

Original installed owner and browser:
  stellar-forge local-dataset-agent --help

Existing merchant client:
  local-dataset status|open --url MCP_URL --workspace ALIAS [--workspace-id UUID]
  local-dataset call --url MCP_URL --workspace ALIAS --workspace-id UUID
                     --operation prepare|continue|cancel|customer-read|customer-write|package|browser|close
                     --input ORIGINAL_PRIVATE_JSON
  local-dataset request --url MCP_URL --workspace ALIAS --workspace-id UUID
                        --request-id UUID [--resume|--wait]
  local-dataset download --url MCP_URL --workspace ALIAS --workspace-id UUID
                         --export-id PACKAGE_REQUEST_UUID --output PRIVATE_DIRECTORY
  Add --token-env NAME to use an existing bearer-token environment variable.

Complete portable receiving (no server, source query or payment):
  local-dataset receive --archive ORIGINAL_ZIP --sha256 SHA256
                        --output NEW_PRIVATE_DIRECTORY --request-id UUID

Call input is the exact typed-client method input. Keep its original request UUID,
review/edition/query identities and complete expected_views. Read a request after a
lost response; --resume is explicit and reuses only that original saved input.
The downloaded ZIP contains full source, original SF100 records, selected exports,
the whole customer warehouse and receiving guides. Preserve the verified receiving
directory and open a distinct sparse warehouse working copy with the original
DuckDB application. These operations are local operator receiving, not purchases.
`;
function args(argv){
 const positionals=[],options={};for(let i=0;i<argv.length;i++){const key=argv[i];if(!key.startsWith('--')){positionals.push(key);continue;}
  if(['--help','--resume','--wait'].includes(key)){options[key.slice(2)]=true;continue;}
  if(!['--url','--workspace','--workspace-id','--operation','--input','--request-id','--export-id','--output','--archive','--sha256','--token-env'].includes(key)||i+1===argv.length||argv[i+1].startsWith('--'))throw fault('LOCAL_CLI_ARGUMENTS');
  if(Object.hasOwn(options,key.slice(2)))throw fault('LOCAL_CLI_ARGUMENTS');options[key.slice(2)]=argv[++i];
 }
 if(positionals.length>1)throw fault('LOCAL_CLI_ARGUMENTS');return{command:positionals[0],options};
}
export async function main(argv=process.argv.slice(2),{environment=process.env,stdout=process.stdout}={}){
 const {command,options:o}=args(argv);if(o.help||!command){stdout.write(HELP);return;}
 const allowed={
  receive:['archive','sha256','output','request-id'],
  status:['url','workspace','workspace-id','token-env'],open:['url','workspace','workspace-id','token-env'],
  request:['url','workspace','workspace-id','token-env','request-id','resume','wait'],
  download:['url','workspace','workspace-id','token-env','export-id','output'],
  call:['url','workspace','workspace-id','token-env','operation','input']
 };
 if(!Object.hasOwn(allowed,command)||Object.keys(o).some(key=>!allowed[command].includes(key)))throw fault('LOCAL_CLI_ARGUMENTS','Use the documented options for this command.');
 const required=command==='receive'?['archive','sha256','output','request-id']:['url','workspace',...(['open','status'].includes(command)?[]:['workspace-id']),...(command==='request'?['request-id']:command==='download'?['export-id','output']:command==='call'?['operation','input']:[])];
 if(required.some(key=>typeof o[key]!=='string'||!o[key].trim()))throw fault('LOCAL_CLI_ARGUMENTS','Supply every required path and original identity explicitly.');
 let result;
 if(command==='receive')result=await receiveLocalDatasetPackage({archive:resolve(o.archive),sha256:o.sha256,directory:resolve(o.output),requestId:o['request-id'],environment});
 else{
  const client=await openLocalDatasetClient({url:o.url,tokenEnv:o['token-env'],environment,workspace:o.workspace,workspaceId:o['workspace-id']});
  if(command==='open')result=await client.open();
  else if(command==='status')result=await client.status();
  else if(command==='request'){if(o.resume&&o.wait)throw fault('LOCAL_CLI_ARGUMENTS');result=o.wait?await client.wait(o['request-id']):await client.request(o['request-id'],o.resume?'resume':'inspect');}
  else if(command==='download')result=await client.downloadPackage({exportId:o['export-id'],directory:resolve(o.output)});
  else if(command==='call'){
   if(!o.input)throw fault('LOCAL_CLI_INPUT_REQUIRED');const value=await readJson(resolve(o.input),8*1024*1024);
   if(['prepare','continue','cancel','package','close'].includes(o.operation))result=await client[o.operation](value);
   else if(o.operation==='customer-read')result=await client.customerRead(value.deliveryId,value.operation,value.arguments);
   else if(o.operation==='customer-write')result=await client.customerWrite(value.requestId,value.deliveryId,value.operation,value.arguments);
   else if(o.operation==='browser')result=await client.browser(value.action,value.port);
   else throw fault('LOCAL_CLI_OPERATION_INVALID');
  }else throw fault('LOCAL_CLI_COMMAND_INVALID');
 }
 stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
 main().catch(error=>{process.stderr.write(JSON.stringify({error:error.code??'LOCAL_CLI_FAILED',message:error.message})+'\n');process.exitCode=1;});
