#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Original merchant client and resumable receiving; no new publisher controller.
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readJson,fault} from '../../postgres/publisher/files.mjs';
import {openFrictionlessClient} from '../../../../../stellar-forge/mcp-merchant-operator/frictionless-workspace-client.mjs';
const HELP=`Frictionless Source Workbench client

Use the existing merchant MCP listener. Installed browser launch:
  stellar-forge frictionless-agent serve --config MERCHANT.json --workspace ALIAS

Every command below takes --url HTTPS_OR_LOOPBACK_MCP --workspace ALIAS
and optionally --token-env MCP_ACCESS_TOKEN. Reads do not open a new publisher.
After open, scoped commands take --workspace-id ORIGINAL_UUID.

  open
  status [--input PAGE_OPTIONS.json]
  current
  input --name HOST_INPUT
  capture --id CAPTURE_UUID [--input READ_OPTIONS.json]
  edition --id EDITION_UUID
  review --id REVIEW_UUID
  plan-input --id EDITION_UUID --query QUERY_NAME
  comparison --id COMPARISON_UUID
  action --kind intake|edition|review|select|plan|compare|export --input EXACT.json
  request --id REQUEST_UUID [--resume] [--wait]
  cancel --input EXACT_CANCEL.json
  browser [--port 0] [--close]
  close --input EXACT_OWNER_IDS.json
  download --id EXPORT_UUID --directory PRIVATE_DIR

An action input retains requestId, expectedVersion and all original action fields.
The connection selects workspace/workspaceId; include the same workspaceId in the
input if desired. Preserve projection object insertion order. A new UUID is a new
action. For an unknown response, inspect the SAME UUID before explicit resume.
Repeating the identical download resumes its existing checkpoint after interruption.
The received source.tar.gz is opened by the ORIGINAL frictionless source-receive.
See workbench/RECEIVING.md and merchant FRICTIONLESS_WORKSPACE.md.
`;
function parse(argv){
 const flags=new Set(['--resume','--wait','--close']),values=new Set(['--url','--workspace','--workspace-id','--token-env','--input','--name','--id','--query','--kind','--port','--directory']);
 const result={};for(let n=0;n<argv.length;n++){const key=argv[n];if(Object.hasOwn(result,key))throw fault('FRICTIONLESS_OPTION_DUPLICATE');
  if(flags.has(key)){result[key]=true;continue;}if(!values.has(key)||!argv[n+1]||argv[n+1].startsWith('--'))throw fault('FRICTIONLESS_OPTION_INVALID');
  result[key]=argv[++n];}return result;
}
function integer(value){const n=Number(value);if(!/^(?:0|[1-9][0-9]*)$/.test(value??'')||!Number.isSafeInteger(n))throw fault('FRICTIONLESS_INTEGER_REQUIRED');return n;}
export async function main(argv=process.argv.slice(2)){
 if(!argv.length||argv[0]==='--help'){process.stdout.write(HELP);return;}
 const [command,...rest]=argv,o=parse(rest);
 if(!o['--url']||!o['--workspace'])throw fault('FRICTIONLESS_CONNECTION_REQUIRED');
 const input=o['--input']?await readJson(resolve(o['--input']),8*1024*1024):{};
 if(input.workspaceId!==undefined&&input.workspaceId!==o['--workspace-id'])throw fault('FRICTIONLESS_WORKSPACE_CHANGED');
 const client=await openFrictionlessClient({url:o['--url'],tokenEnv:o['--token-env']??'MCP_ACCESS_TOKEN',workspace:o['--workspace'],workspaceId:o['--workspace-id']});
 let result;
 if(command==='open')result=await client.open();
 else if(command==='status')result=await client.status(input);
 else if(command==='current')result=await client.current();
 else if(command==='input')result=await client.input(o['--name']);
 else if(command==='capture')result=await client.capture(o['--id'],input);
 else if(command==='edition')result=await client.edition(o['--id']);
 else if(command==='review')result=await client.review(o['--id']);
 else if(command==='plan-input')result=await client.planInput(o['--id'],o['--query']);
 else if(command==='comparison')result=await client.comparison(o['--id']);
 else if(command==='action'){
  const methods={intake:'intake',edition:'createEdition',review:'reviewEdition',select:'select',plan:'savePlan',compare:'compare',export:'export'};
  if(!methods[o['--kind']]||!o['--input'])throw fault('FRICTIONLESS_ACTION_REQUIRED');
  result=await client[methods[o['--kind']]](input);
 }else if(command==='request'){
  result=await client.request(o['--id'],o['--resume']?'resume':'inspect');
  if(o['--wait'])result=await client.wait(o['--id']);
 }else if(command==='cancel')result=await client.cancel(input);
 else if(command==='browser')result=await client.browser(o['--close']?'close':'open',o['--port']===undefined?0:integer(o['--port']));
 else if(command==='close')result=await client.close(input);
 else if(command==='download'){
  if(!o['--directory'])throw fault('FRICTIONLESS_OUTPUT_REQUIRED');
  result=await client.downloadExport({exportId:o['--id'],directory:resolve(o['--directory'])});
 }else throw fault('FRICTIONLESS_COMMAND_UNKNOWN');
 process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(e=>{
 process.stderr.write((e.code??'FRICTIONLESS')+': '+(e.path||e.syscall?'Original private storage is unavailable.':e.message)+'\n');process.exitCode=1;
});
