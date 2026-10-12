#!/usr/bin/env node
// MIT. Native operator entrypoint for deployment commissioning and offline receiving.
import { constants } from 'node:fs';
import { open, lstat } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { need, object, jsonBytes, privateDirectory, writeBytes, safeCode } from '../../../../sf88-operator-buyer-cli/node/store.mjs';
import { createSourceBearerAuth } from '../../../../sf31-buyer-client/source-auth.mjs';
import { openDeploymentPolicyWorkspace } from '../policy-workspace.mjs';
import { openStacWorkspace } from '../../workspace.mjs';
import { openCommissioningWorkspace, inspectCommissioningPackage } from './workspace.mjs';
import { bytesDigest, identifier } from './model.mjs';

const HELP={
  command:'node sf30-seller-sdk/stac/eoapi/commissioning/cli.mjs COMMAND [FLAGS]',
  commands:{
    status:'--directory WORKSPACE',
    plan:'--directory WORKSPACE --policy-directory POLICY --input PLAN.json --operation ID [--stac-directory STAC]',
    prepare:'--directory WORKSPACE --policy-directory POLICY --plan ID --operation ID',
    run:'--directory WORKSPACE --policy-directory POLICY --run ID [--connections-file PRIVATE.json]',
    adopt:'--directory WORKSPACE --policy-directory POLICY --stac-directory STAC --run ID --case ID --capture REF --source-workspace ID',
    report:'--directory WORKSPACE --run ID',
    compare:'--directory WORKSPACE --left RUN --right RUN',
    export:'--directory WORKSPACE --run ID --output PACKAGE.json',
    inspect:'--input PACKAGE.json',
    receive:'--directory RECEIVING --input PACKAGE.json --operation ID',
    reopen:'--directory RECEIVING --import ID'
  }
};
const flags=new Set(['directory','policy-directory','stac-directory','connections-file','input','output','operation','plan','run','case','capture','source-workspace','left','right','import']);
function parse(argv){
  const [command='help',...args]=argv,options={};
  need(Object.hasOwn(HELP.commands,command)||command==='help','EOAPI_COMMISSIONING_COMMAND_INVALID');
  for(let i=0;i<args.length;i+=2){
    const key=args[i]?.slice(2),value=args[i+1];
    need(args[i]?.startsWith('--')&&flags.has(key)&&typeof value==='string'&&!value.startsWith('--')&&!Object.hasOwn(options,key),
      'EOAPI_COMMISSIONING_ARGUMENT_INVALID');options[key]=value;
  }
  return {command,options};
}
async function privateJson(path,limit=4*1024*1024){
  need(typeof path==='string'&&path.length,'EOAPI_COMMISSIONING_INPUT_FILE_REQUIRED');
  const file=await open(resolve(path),constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const info=await file.stat();
    need(info.isFile()&&info.size<=limit&&(process.platform==='win32'||(!(info.mode&0o077)&&(!process.getuid||info.uid===process.getuid()))),
      'EOAPI_COMMISSIONING_PRIVATE_FILE_REQUIRED');
    const raw=await file.readFile();need(raw.length<=limit,'EOAPI_COMMISSIONING_FILE_LIMIT');
    const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
    need(object(value),'EOAPI_COMMISSIONING_JSON_OBJECT_REQUIRED');return value;
  }finally{await file.close();}
}
export async function openCommissioningConnections(path,{resolveCredential}={}){
  if(path===undefined)return {sourceRuntimeFor:undefined,close(){}};
  const input=await privateJson(path);
  need(input.schema==='scf-eoapi-commissioning-connections/v1'&&object(input.principals)&&
    Object.keys(input).every(key=>['schema','principals'].includes(key)),'EOAPI_COMMISSIONING_CONNECTIONS_INVALID');
  const runtimes=new Map();
  for(const [principal,config]of Object.entries(input.principals)){
    identifier(principal);
    need(object(config)&&Object.keys(config).every(key=>['transport','bindings'].includes(key)),
      'EOAPI_COMMISSIONING_CONNECTIONS_INVALID');
    if(principal==='anonymous')need(config.bindings===undefined,'EOAPI_COMMISSIONING_ANONYMOUS_BINDING_INVALID');
    else need(Array.isArray(config.bindings),'EOAPI_COMMISSIONING_PRIVATE_CONNECTION_REQUIRED');
    const sourceAuth=config.bindings?createSourceBearerAuth({bindings:config.bindings,...(resolveCredential?{resolveCredential}:{})}):undefined;
    runtimes.set(principal,{...(config.transport?{transport:config.transport}:{}),...(sourceAuth?{sourceAuth}:{})});
  }
  return {
    sourceRuntimeFor:async({principal})=>{
      need(runtimes.has(principal),'EOAPI_COMMISSIONING_PRIVATE_CONNECTION_REQUIRED');return runtimes.get(principal);
    },
    close(){for(const runtime of runtimes.values())runtime.sourceAuth?.close();}
  };
}
export async function runCommissioningCli(argv,{stdout=process.stdout,stderr=process.stderr}={}){
  let workspace,policy,stac,connections;
  const controller=new AbortController(),stop=()=>controller.abort(new Error('EOAPI_COMMISSIONING_OPERATOR_INTERRUPTED'));
  process.once('SIGINT',stop);process.once('SIGTERM',stop);
  try{
    const {command,options}=parse(argv),required=key=>{need(options[key],'EOAPI_COMMISSIONING_'+key.toUpperCase().replaceAll('-','_')+'_REQUIRED');return options[key];};
    let result;
    if(command==='help')result=HELP;
    else if(command==='inspect')result=inspectCommissioningPackage(await privateJson(required('input'),380*1024*1024));
    else{
      if(options['policy-directory'])policy=await openDeploymentPolicyWorkspace({directory:resolve(options['policy-directory']),create:false});
      if(options['stac-directory'])stac=await openStacWorkspace({directory:resolve(options['stac-directory']),create:false});
      connections=await openCommissioningConnections(options['connections-file']);
      workspace=await openCommissioningWorkspace({directory:resolve(required('directory')),policyWorkspace:policy,
        stacWorkspace:stac,sourceRuntimeFor:connections.sourceRuntimeFor,create:['plan','receive'].includes(command)});
      if(command==='status')result=await workspace.getState();
      if(command==='plan')result=await workspace.savePlan({input:await privateJson(required('input')),operationId:required('operation')});
      if(command==='prepare')result=await workspace.createRun({planId:required('plan'),operationId:required('operation')});
      if(command==='run')result=await workspace.executeRun({runId:required('run'),signal:controller.signal});
      if(command==='adopt')result=await workspace.adoptCapture({runId:required('run'),caseId:required('case'),captureRef:required('capture'),sourceWorkspaceId:required('source-workspace')});
      if(command==='report')result=await workspace.getReport({runId:required('run')});
      if(command==='compare')result=await workspace.compareRuns({leftRunId:required('left'),rightRunId:required('right')});
      if(command==='export'){
        const bundle=await workspace.exportRun({runId:required('run')}),raw=jsonBytes(bundle),path=resolve(required('output'));
        await privateDirectory(dirname(path));
        let existing=null;
        try{const info=await lstat(path);need(info.isFile()&&!info.isSymbolicLink()&&info.size===raw.length,'EOAPI_COMMISSIONING_DESTINATION_CONFLICT');
          const file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{existing=await file.readFile();}finally{await file.close();}
        }catch(error){if(error.code!=='ENOENT')throw error;}
        if(existing)need(existing.equals(raw),'EOAPI_COMMISSIONING_DESTINATION_CONFLICT');else await writeBytes(path,raw,{exclusive:true});
        result={file:path,bytes:raw.length,sha256:bytesDigest(raw),packageDigest:bundle.digest,runId:bundle.run.id};
      }
      if(command==='receive')result=await workspace.importPackage({package:await privateJson(required('input'),380*1024*1024),operationId:required('operation')});
      if(command==='reopen')result=await workspace.getImported({importId:required('import')});
    }
    stdout.write(jsonBytes(result));return command==='run'&&result?.status==='INTERRUPTED'?2:0;
  }catch(error){
    stderr.write(jsonBytes({error:safeCode(error?.code,'EOAPI_COMMISSIONING_OPERATION_FAILED')}));
    return 1;
  }finally{
    await workspace?.close();await stac?.close();await policy?.close();connections?.close();
    process.removeListener('SIGINT',stop);process.removeListener('SIGTERM',stop);
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)
  process.exitCode=await runCommissioningCli(process.argv.slice(2));
