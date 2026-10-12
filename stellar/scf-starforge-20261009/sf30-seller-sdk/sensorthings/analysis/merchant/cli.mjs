#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Original authenticated operations and retained file receiving; no new writer.
import {resolve,isAbsolute} from 'node:path';
import {pathToFileURL} from 'node:url';
import {readOwned} from '../../../stellar-expert/store.mjs';
import {parseExactJSON} from '../../../stellar-expert/exact-json.mjs';
import {json,fault} from '../../contract.mjs';
import {main as originalCli} from '../../cli.mjs';
import {main as originalLauncher} from '../deployment/launch.mjs';
import {AnalysisMerchantClient,parsePrivateLink} from './client.mjs';
const common=['url-file','workspace-id'];
const COMMANDS={
  overview:[...common,'project'],record:[...common,'id'],operations:common,operation:[...common,'id'],
  history:[...common,'id'],input:[...common,'selection'],preview:[...common,'selection'],
  files:[...common,'id'],action:[...common,'request'],
  serve:['workspace','host','port','session-file','expected-workspace-id','source-inbox','buyer-workspace','merchant-runtime'],
  'inspect-download':['config','alias','selection'],
  download:['config','alias','selection','directory','expected-manifest-sha256','export-id','chunk-size','progress']
};
export const HELP=[
  'Approved SensorThings publication delivery on the original workspace.',
  '',
  'overview [--project ID] | record --id ID | operations | operation --id ID',
  'history --id ID | files --id ID | input --selection JSON | preview --selection JSON',
  'action --request ORIGINAL_JSON_FILE',
  '  Every connected command requires --url-file PRIVATE_ORIGINAL_URL_FILE --workspace-id ORIGINAL_UUID.',
  '',
  'serve --workspace DIR --expected-workspace-id ORIGINAL_UUID --session-file PRIVATE_URL_FILE',
  '      [--source-inbox DIR] [--buyer-workspace DIR] [--merchant-runtime PRIVATE_JSON] [--port N]',
  '  Delegates the existing launcher and native workspace lease. Do not start while its original Desk is active.',
  '',
  'inspect-download --config PRIVATE_CONNECTION_JSON --alias ORIGINAL_ALIAS --selection JSON_FILE',
  'download --config PRIVATE_CONNECTION_JSON --alias ORIGINAL_ALIAS --selection JSON_FILE --directory DIR',
  '         [--expected-manifest-sha256 SHA] [--export-id ID] [--chunk-size N] [--progress]',
  '  Delegates the original complete-file downloader and its resumable journal; no file-size truncation.',
  '',
  'Keep the exact action JSON file before dispatch. Read operation --id after an uncertain reply.',
  'Use an explicit analysis.merchant.resume request for a failed local merchant operation.',
  'The CLI never creates a review, payment, publication or operation ID on your behalf.',
  'Do not put private session URLs or tokens in command arguments or output.'
].join('\n');
function fail(message){throw fault('ANALYSIS_MERCHANT_CLI',message,422);}
function parse(argv){
  const [command,...args]=argv,allowed=COMMANDS[command];if(!allowed)fail('Choose an advertised command; use --help.');
  const result={command};
  for(let i=0;i<args.length;i++){
    const token=args[i];if(!/^--[a-z][a-z0-9-]*$/.test(token))fail('Use explicit --name value arguments.');
    const key=token.slice(2);if(!allowed.includes(key)||Object.hasOwn(result,key))fail('Unknown or repeated '+token+'.');
    if(key==='progress'){result[key]=true;continue;}
    if(i+1>=args.length||args[i+1].startsWith('--'))fail('Supply the value for '+token+'.');
    result[key]=args[++i];
  }return result;
}
function required(options,key){if(typeof options[key]!=='string'||!options[key])fail('Supply --'+key+'.');return options[key];}
async function input(path,maximum=2*1024*1024){
  if(!isAbsolute(path)||resolve(path)!==path)fail('Use an exact absolute original input filename.');
  const bytes=await readOwned(path,maximum),raw=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
  parseExactJSON(raw);return {raw,value:JSON.parse(raw)};
}
export async function connectMerchantClient({urlFile,workspaceId,fetch,timeoutMs}){
  if(!isAbsolute(urlFile)||resolve(urlFile)!==urlFile)fail('Use the absolute private URL filename.');
  const raw=new TextDecoder('utf-8',{fatal:true}).decode(await readOwned(urlFile,4096)).trim(),selected=parsePrivateLink(raw);
  const client=new AnalysisMerchantClient({...selected,workspaceId,...(fetch?{fetch}:{}),...(timeoutMs?{timeoutMs}:{})});
  try{await client.connect();return client;}catch(e){client.close();throw e;}
}
export async function main(argv=process.argv.slice(2),{emit=value=>process.stdout.write(json(value))}={}){
  if(!argv.length||argv.includes('--help')){process.stdout.write(HELP+'\n');return null;}
  const options=parse(argv),command=options.command;
  if(command==='serve'){
    required(options,'workspace');required(options,'expected-workspace-id');required(options,'session-file');
    return originalLauncher(argv,{emit});
  }
  if(command==='download'||command==='inspect-download')return originalCli(argv,{emit});
  const client=await connectMerchantClient({urlFile:required(options,'url-file'),workspaceId:required(options,'workspace-id')});
  try{
    let result;
    if(command==='overview')result=await client.overview(options.project);
    else if(command==='record')result=await client.record(required(options,'id'));
    else if(command==='operations')result=await client.operations();
    else if(command==='operation')result=await client.operation(required(options,'id'));
    else if(command==='history')result=await client.request('/api/analysis/merchant/history/'+encodeURIComponent(required(options,'id')));
    else if(command==='files')result=await client.files(required(options,'id'));
    else if(command==='input')result=await client.inspectInput((await input(required(options,'selection'))).value);
    else if(command==='preview')result=await client.preview((await input(required(options,'selection'))).value);
    else if(command==='action')result=await client.actionRaw((await input(required(options,'request'))).raw);
    emit(result);return result;
  }finally{client.close();}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)main().catch(error=>{
  process.stderr.write(json({error:typeof error.code==='string'?error.code:'ANALYSIS_MERCHANT_CLI_FAILURE',
    message:error.message,operationId:error.operationId??null,status:error.status??null}));
  process.exitCode=1;
});
