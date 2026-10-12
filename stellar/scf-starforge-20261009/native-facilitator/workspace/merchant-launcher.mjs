#!/usr/bin/env node
// MIT. Managed native agent host over the original merchant service and native operator.
import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {startMerchantMcp} from '../../../../stellar-forge/mcp-merchant-operator/serve.mjs';
import {inspectNativeAgentBinding,nativeAgentAttachment} from './merchant-binding.mjs';
import {nativeCanonicalJSON,nativeOperatorIdentity,requireNative,isDigest} from './merchant-export-contract.mjs';
import {nativeOperatorToolPrefix} from './merchant-tools.mjs';
export {inspectNativeAgentBinding} from './merchant-binding.mjs';
export const NATIVE_AGENT_STARTUP_SCHEMA='stellar-forge.native-agent-launch.v1';

/** This owner closes the original merchant service; the attached native Application keeps its lifetime. */
export async function startNativeFacilitatorAgent({configPath,operator,expectedBindingSha256,
  port=0,tokenEnv='MCP_ACCESS_TOKEN',environment=process.env}={}) {
  requireNative(Number.isSafeInteger(port)&&port>=0&&port<=65535&&
    typeof tokenEnv==='string'&&/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(tokenEnv),
  'NATIVE_AGENT_LAUNCH_INVALID');
  requireNative(expectedBindingSha256===undefined||isDigest(expectedBindingSha256),'NATIVE_AGENT_BINDING_INVALID');
  const hostEnvironment=Object.freeze({...environment});
  const binding=await inspectNativeAgentBinding({configPath,operator});
  requireNative(expectedBindingSha256===undefined||binding.bindingSha256===expectedBindingSha256,
    'NATIVE_AGENT_BINDING_CHANGED','Use the reviewed original merchant configuration and native alias.');
  const attachment=await nativeAgentAttachment(binding,{environment:hostEnvironment});
  let session;
  try {
    session=await startMerchantMcp({configPath:binding.configFile,port,tokenEnv,environment:hostEnvironment});
    const status=await session.operator.call(nativeOperatorToolPrefix+'_status',{operator:binding.operator});
    const original=nativeOperatorIdentity(status.workspace);
    requireNative((!attachment.identity||nativeCanonicalJSON(original)===nativeCanonicalJSON(attachment.identity))&&
      (!attachment.expectedInstanceId||original.instanceId===attachment.expectedInstanceId)&&
      (attachment.sourceSha256===undefined||status.connection?.sourceSha256===attachment.sourceSha256),
    'NATIVE_AGENT_ORIGINAL_INSTANCE_CHANGED');
    const current=await inspectNativeAgentBinding({configPath:binding.configFile,operator:binding.operator});
    requireNative(current.bindingSha256===binding.bindingSha256,'NATIVE_AGENT_BINDING_CHANGED');
    const startedAt=new Date().toISOString();
    const startup=Object.freeze({schema:NATIVE_AGENT_STARTUP_SCHEMA,state:'LISTENING',
      instanceId:randomUUID(),pid:process.pid,ppid:process.ppid,startedAt,
      configFile:binding.configFile,operator:binding.operator,bindingSha256:binding.bindingSha256,
      releaseStore:binding.releaseStore,exportsDirectory:binding.exportsDirectory,
      operatorUrl:attachment.operatorUrl,mcpUrl:session.url,native:original});
    let closing;
    const close=()=>{
      if(!closing)closing=session.close().catch(error=>{closing=null;throw error;});
      return closing;
    };
    return Object.freeze({startup,binding,operator:session.operator,close});
  }catch(error){
    if(session)try{await session.close();}catch(closeError){
      closeError.cause=error;closeError.closeNativeAgent=()=>session.close();throw closeError;
    }
    throw error;
  }
}
const HELP=`Native facilitator agent

  native-facilitator-agent inspect --config MERCHANT_MCP_JSON --operator ALIAS
  native-facilitator-agent serve --config MERCHANT_MCP_JSON --operator ALIAS
    [--expected-binding-sha256 REVIEWED_SHA256] [--port PORT] [--token-env NAME]

Attach the existing original native operator through its declared private
merchant connection. The retained startup opens that original native browser
and reports the original merchant MCP endpoint. Stop drains this agent host’s
accepted work and file receiving through the original service owner.
`;
function argumentsFor(argv){
  const [command,...rest]=argv,flags=Object.create(null);
  requireNative(['inspect','serve'].includes(command),'NATIVE_AGENT_USAGE',HELP);
  const allowed=new Set(['--config','--operator','--expected-binding-sha256','--port','--token-env']);
  for(let at=0;at<rest.length;at+=2){
    const key=rest[at],value=rest[at+1];
    requireNative(allowed.has(key)&&!Object.hasOwn(flags,key)&&typeof value==='string'&&value.length>0,
      'NATIVE_AGENT_USAGE',HELP);flags[key]=value;
  }
  requireNative(flags['--config']&&flags['--operator']&&(command==='serve'||
    Object.keys(flags).every(key=>['--config','--operator'].includes(key))),'NATIVE_AGENT_USAGE',HELP);
  if(flags['--port']!==undefined)requireNative(/^(0|[1-9][0-9]{0,4})$/.test(flags['--port']),
    'NATIVE_AGENT_USAGE',HELP);
  return {command,options:{configPath:flags['--config'],operator:flags['--operator'],
    ...(flags['--expected-binding-sha256']?{expectedBindingSha256:flags['--expected-binding-sha256']}:{}),
    ...(flags['--port']!==undefined?{port:Number(flags['--port'])}:{}),
    ...(flags['--token-env']?{tokenEnv:flags['--token-env']}:{})}};
}
export async function main(argv=process.argv.slice(2)) {
  if(!argv.length||argv.length===1&&['help','--help'].includes(argv[0])){process.stdout.write(HELP);return;}
  const {command,options}=argumentsFor(argv);
  if(command==='inspect'){
    const result=await inspectNativeAgentBinding(options);process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }
  let session,stopping=false,draining;
  const close=()=>{
    stopping=true;
    if(!session)return Promise.resolve();
    if(!draining)draining=session.close().then(()=>{process.off('SIGINT',signal);process.off('SIGTERM',signal);})
      .catch(error=>{draining=null;throw error;});
    return draining;
  };
  const signal=()=>{void close().catch(error=>{
    process.stderr.write((error.code??'NATIVE_AGENT_CLOSE_FAILED')+'\n');process.exitCode=1;
  });};
  process.on('SIGINT',signal);process.on('SIGTERM',signal);
  try{
    session=await startNativeFacilitatorAgent(options);
    if(stopping){await close();return;}
    process.stdout.write(JSON.stringify(session.startup)+'\n');return session;
  }catch(error){
    // A failed startup cleanup retains the same original service for an
    // explicit retry; signal handlers keep that owner reachable until closed.
    if(!session&&typeof error.closeNativeAgent==='function')session={close:error.closeNativeAgent};
    if(session)await close();
    else {process.off('SIGINT',signal);process.off('SIGTERM',signal);}
    throw error;
  }
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(error=>{console.error((error.code??'NATIVE_AGENT_ERROR')+': '+error.message);process.exitCode=1;});
