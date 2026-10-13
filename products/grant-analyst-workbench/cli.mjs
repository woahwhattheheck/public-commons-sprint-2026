#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Run the selected original private analyst CLI while holding its workspace writer.
import {spawn} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {need,readLaunchConfiguration} from './connection.mjs';
import {inspectOriginalSource,managedOptions,runtimeEnvironment} from './managed.mjs';
const BRIDGE=join(dirname(fileURLToPath(import.meta.url)),'managed_host.py');
export function cliOptions(argv){
  const at=argv.indexOf('--');
  need(at>0&&at<argv.length-1,'GRANT_ANALYST_CLI_ARGUMENT','Select --configuration ABS_LAUNCH -- ORIGINAL_ARGS.');
  const outer=argv.slice(0,at),options=managedOptions(outer),original=argv.slice(at+1);
  need(!outer.includes('--port'),'GRANT_ANALYST_CLI_ARGUMENT','Use managed Applications for the original listener.');
  need(original.every(x=>typeof x==='string'&&!(x.startsWith('--')&&x.split('=',1)[0].length>2&&'--workspace'.startsWith(x.split('=',1)[0]))),
    'GRANT_ANALYST_CLI_SELECTION','The reviewed configuration selects the original workspace root.');
  need(original[0]!=='serve','GRANT_ANALYST_CLI_OWNER','Use managed Applications for a long-running original service.');
  return{...options,original};
}
export async function runOriginalGrantAnalystCLI(options){
  const selected=await readLaunchConfiguration(options.configuration),v=selected.value;
  need(!options.expectedConfigurationSha256||selected.sha256===options.expectedConfigurationSha256,
    'GRANT_ANALYST_CONFIGURATION_CHANGED','Select the reviewed original configuration.',409);
  await inspectOriginalSource({directory:v.applicationDirectory,sourceManifestFile:v.sourceManifestFile,sourceManifestSha256:v.sourceManifestSha256});
  const bootstrap=[
    'import json,os,runpy,sys',
    'bridge=sys.argv.pop(1); configuration=json.loads(sys.argv.pop(1))',
    "support=runpy.run_path(bridge,run_name='grant_analyst_managed_library')",
    "support['need'](sys.version_info>=(3,10),'Python 3.10 or later is required.')",
    "support['source'](configuration)",
    "root=configuration['directory']; receiving=sys.argv[1:2]==['receive']; selected=support['module']('analyst')",
    "if receiving:\n lease=support['receive_lock'](root)\n support['need'](not os.path.lexists(root),'Select a fresh original receiving destination.')\nelse:\n os.makedirs(root,mode=0o700,exist_ok=True); support['directory'](root); lease=support['lock'](os.path.join(root,'grant-analyst-operator.lock'))",
    "sys.argv=['analyst','--workspace',root]+sys.argv[1:]",
    "try:\n selected.main()\nfinally:\n os.close(lease)"
  ].join('\n');
  const child=spawn(v.python,['-I','-B','-c',bootstrap,BRIDGE,JSON.stringify(v),...options.original],
    {cwd:dirname(selected.path),env:runtimeEnvironment(v.python),stdio:'inherit'});
  let failure=null,closed=false;
  const close=new Promise(resolveClose=>{child.on('error',e=>{failure=e;});child.once('close',(code,signal)=>{closed=true;resolveClose({code,signal});});});
  const stop=signal=>{if(!closed&&child.pid&&child.exitCode===null&&child.signalCode===null)child.kill(signal);};
  const interrupt=()=>stop('SIGINT'),terminate=()=>stop('SIGTERM');
  process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
  try{const result=await close;if(failure)throw failure;return{...result,exitCode:result.code??(result.signal==='SIGINT'?130:result.signal==='SIGTERM'?143:1)};}
  finally{process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);if(!closed){stop('SIGTERM');await close;}}
}
export async function main(argv=process.argv.slice(2)){
  if(!argv.length||argv.length===1&&['help','--help'].includes(argv[0])){
    const result={command:'grant-analyst-workbench',
      usage:'--configuration ABS_PRIVATE_LAUNCH [--configuration-sha256 FULL_SHA256] -- ORIGINAL_COMMAND_ARGS',
      originalHelp:'--configuration ABS_PRIVATE_LAUNCH -- --help',
      ownership:'The selected grant-analyst-operator.lock is held until the original command closes. Original per-request .lock remains owned by the native model. Managed Applications owns the listener.',
      receiving:'The original receive command interprets the configured directory as a fresh receiving container and returns its workspacePath. Keep that exact returned path for a later managed workspace.'};
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }
  const result=await runOriginalGrantAnalystCLI(cliOptions(argv));process.exitCode=result.exitCode;return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(e=>{process.stderr.write(JSON.stringify({error:{code:e.code??'GRANT_ANALYST_CLI_FAILED',message:e.message}})+'\n');process.exitCode=1;});
