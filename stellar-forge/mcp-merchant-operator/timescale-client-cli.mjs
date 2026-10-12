#!/usr/bin/env node
// MIT. Installed client for the same Timescale merchant and retained request files.
import { parseArgs } from 'node:util';
import { resolve, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openTimescaleClient, TIMESCALE_CLIENT_METHODS } from './timescale-client.mjs';
import { readPrivate, privateDirectory, digest } from '../../stellar/scf-starforge-20261009/sf30-seller-sdk/postgres/publisher/files.mjs';
import { plain, failure } from './host-files.mjs';
const help=`timescale-client METHOD --url ORIGINAL_MCP_URL --workspace ALIAS --workspace-id UUID
  [--input PRIVATE_JSON --input-sha256 SHA256] [--token-env MCP_ACCESS_TOKEN]
  [--timeout-ms 180000] [--wait-ms 600000]

Methods: ${Object.keys(TIMESCALE_CLIENT_METHODS).join(', ')}
  Read methods take their exact JSON arguments in --input when needed.
  Mutations consume caller-retained requestId, version, item/plan/source bindings.
  A lost response never creates or automatically repeats a request.
  operation with {"action":"inspect","requestId":"ORIGINAL_UUID"} reads its outcome.

Complete retained receiving:
  timescale-client download --url URL --workspace ALIAS --workspace-id UUID
    --export ORIGINAL_EXPORT_UUID --directory PRIVATE_DIRECTORY
    [--expected-manifest-sha256 SHA256 --chunk-size 65536]
  timescale-client report-download --url URL --workspace ALIAS --workspace-id UUID
    --export ORIGINAL_REPORT_UUID --directory PRIVATE_DIRECTORY
    [--expected-manifest-sha256 SHA256 --chunk-size 65536]

  timescale-client commissioning-report-download --url URL --workspace ALIAS --workspace-id UUID
    --export ORIGINAL_REPORT_UUID --directory PRIVATE_DIRECTORY
    [--expected-manifest-sha256 SHA256 --chunk-size 65536]

The same receiving directory resumes its verified bytes. These commands use the
existing merchant download engine. SIGINT cancels this client; the original
server request remains available for inspection. Closing the client never closes
the externally owned merchant, publisher, scheduler or browser.
`;
function integer(value,name,min,max){
  if(typeof value!=='string'||!/^[0-9]+$/.test(value)||!Number.isSafeInteger(Number(value))||Number(value)<min||Number(value)>max)
    throw failure('TIMESCALE_CLIENT_ARGUMENT','Use a valid '+name+'.');
  return Number(value);
}
export async function runTimescaleClientCli(argv=process.argv.slice(2),{environment=process.env,output=process.stdout,signal}={}){
  const {values,positionals}=parseArgs({args:argv,allowPositionals:true,strict:true,options:{
    help:{type:'boolean'},url:{type:'string'},workspace:{type:'string'},'workspace-id':{type:'string'},
    input:{type:'string'},'input-sha256':{type:'string'},'token-env':{type:'string',default:'MCP_ACCESS_TOKEN'},
    'timeout-ms':{type:'string',default:'180000'},'wait-ms':{type:'string'},
    export:{type:'string'},directory:{type:'string'},'expected-manifest-sha256':{type:'string'},'chunk-size':{type:'string'}
  }});
  if(values.help||positionals.length===0){output.write(help);return null;}
  if(positionals.length!==1)throw failure('TIMESCALE_CLIENT_ARGUMENT','Select one original operation.');
  const method=positionals[0],receiving=['download','report-download','commissioning-report-download'].includes(method);
  if(!receiving&&!Object.hasOwn(TIMESCALE_CLIENT_METHODS,method))
    throw failure('TIMESCALE_CLIENT_ARGUMENT','Unknown Timescale client operation.');
  if(!values.url||!values.workspace||!values['workspace-id'])
    throw failure('TIMESCALE_CLIENT_ARGUMENT','Provide the original MCP URL, workspace alias and persistent UUID.');
  const timeoutMs=integer(values['timeout-ms'],'request timeout',1,3600000);
  const waitMs=values['wait-ms']===undefined?undefined:integer(values['wait-ms'],'observation timeout',1,3600000);
  const startedMethods=new Set(['capture','review','refresh','verify','job','publication','export','remediation-command','remediation-report','commissioning-command','commissioning-report']);
  if(waitMs!==undefined&&!startedMethods.has(method))throw failure('TIMESCALE_CLIENT_ARGUMENT','Wait applies only to an original retained operation.');
  let input={};
  if(values.input){
    const path=resolve(values.input);await privateDirectory(dirname(path));
    const bytes=await readPrivate(path,method==='commissioning-command'?8*1024*1024:2*1024*1024),actual=digest(bytes);
    if(values['input-sha256']!==undefined&&values['input-sha256']!==actual)
      throw failure('TIMESCALE_CLIENT_INPUT_CHANGED','The retained request file differs from its selected digest.');
    try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
    catch{throw failure('TIMESCALE_CLIENT_INPUT','Use the complete original UTF-8 JSON request.');}
    if(!plain(input))throw failure('TIMESCALE_CLIENT_INPUT','The original request must be a JSON object.');
  }else if(values['input-sha256']!==undefined)throw failure('TIMESCALE_CLIENT_ARGUMENT','Select the retained input file for this digest.');
  if(receiving&&(values.input||values['wait-ms']))throw failure('TIMESCALE_CLIENT_ARGUMENT','Use the receiving arguments without an operation request file.');
  if(!receiving&&['export','directory','expected-manifest-sha256','chunk-size'].some(name=>values[name]!==undefined))
    throw failure('TIMESCALE_CLIENT_ARGUMENT','Complete file receiving has its own download command.');
  const client=await openTimescaleClient({url:values.url,workspace:values.workspace,workspaceId:values['workspace-id'],
    tokenEnv:values['token-env'],environment,signal});
  let result;
  if(receiving){
    if(!values.export||!values.directory)throw failure('TIMESCALE_CLIENT_ARGUMENT','Select the original export UUID and private receiving directory.');
    const options={exportId:values.export,directory:resolve(values.directory),expectedManifestSha256:values['expected-manifest-sha256'],signal,
      ...(values['chunk-size']?{chunkSize:integer(values['chunk-size'],'chunk size',1,196608)}:{})};
    result=method==='download'?await client.exports.download(options):method==='commissioning-report-download'?await client.commissioning.downloadReport(options):await client.remediation.downloadReport(options);
  }else{
    result=await client.call(method,input,{requestSignal:signal,timeoutMs});
    if(values['wait-ms']){
      if(!result?.id||!result.operation)throw failure('TIMESCALE_CLIENT_ARGUMENT','Wait applies only to an acknowledged original operation.');
      result={accepted:result,operation:await client.wait(result.id,{timeoutMs:waitMs,signal})};
    }
  }
  output.write(JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const controller=new AbortController(),stop=()=>controller.abort(new Error('Client interrupted; inspect the same original request.'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{await runTimescaleClientCli(undefined,{signal:controller.signal});}
  catch(error){process.stderr.write(JSON.stringify({error:{code:error.code??'TIMESCALE_CLIENT_FAILED',
    message:error.message,requestId:error.requestId??null}})+'\n');process.exitCode=1;}
  finally{process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);}
}
