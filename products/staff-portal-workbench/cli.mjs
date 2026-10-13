#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Invoke the unchanged private staff portal CLI through its selected source and original writer lease.
import {spawn} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {need,readLaunchConfiguration} from './connection.mjs';
import {inspectOriginalSource,managedOptions} from './managed.mjs';
const BRIDGE=join(dirname(fileURLToPath(import.meta.url)),'managed_host.py');

export function cliOptions(argv){
  const at=argv.indexOf('--');
  need(at>0&&at<argv.length-1,'STAFF_PORTAL_CLI_ARGUMENT','Select --configuration ABS_LAUNCH -- ORIGINAL_COMMAND_ARGS.');
  const options=managedOptions(argv.slice(0,at));
  need(!argv.slice(0,at).includes('--port'),'STAFF_PORTAL_CLI_ARGUMENT','The original CLI does not open a managed listener.');
  const original=argv.slice(at+1);
  need(original.every(x=>typeof x==='string'&&!(x.startsWith('--')&&x.split('=',1)[0].length>2&&
    '--data'.startsWith(x.split('=',1)[0]))),'STAFF_PORTAL_CLI_SELECTION','The reviewed configuration selects the original workspace root.');
  return{...options,original};
}
export async function runOriginalStaffPortalCLI(options){
  const selected=await readLaunchConfiguration(options.configuration),v=selected.value;
  need(!options.expectedConfigurationSha256||selected.sha256===options.expectedConfigurationSha256,
    'STAFF_PORTAL_CONFIGURATION_CHANGED','Select the reviewed original CLI configuration.',409);
  await inspectOriginalSource({directory:v.applicationDirectory,sourceManifestFile:v.sourceManifestFile,sourceManifestSha256:v.sourceManifestSha256});
  const env={...process.env};
  for(const key of['PYTHONPATH','PYTHONHOME','PYTHONUSERBASE','PYTHONSTARTUP','VIRTUAL_ENV'])delete env[key];
  env.PYTHONDONTWRITEBYTECODE='1';env.PATH=[dirname(v.python),process.env.PATH??''].join(':');
  // The library validates the full private source before the original CLI imports it.
  // The same kernel file lock excludes the HTTP owner and other managed CLI writers.
  const bootstrap=[
    'import json,os,runpy,sys',
    'bridge=sys.argv.pop(1); configuration=json.loads(sys.argv.pop(1))',
    "support=runpy.run_path(bridge,run_name='staff_portal_managed_library')",
    "support['need'](sys.version_info>=(3,11),'Python 3.11 or later is required.')",
    "support['source'](configuration)",
    "root=configuration['directory']",
    "os.makedirs(root,mode=0o700,exist_ok=True); support['directory'](root)",
    "lease=support['lock'](os.path.join(root,'portal-operator.lock'))",
    "sys.argv=[os.path.join(configuration['applicationDirectory'],'portal_cli.py'),'--data',root]+sys.argv[1:]",
    "try:\n runpy.run_path(sys.argv[0],run_name='__main__')\nfinally:\n os.close(lease)"
  ].join('\n');
  const child=spawn(v.python,['-I','-B','-c',bootstrap,BRIDGE,JSON.stringify(v),...options.original],
    {cwd:dirname(selected.path),env,stdio:'inherit'});
  let failure=null,closed=false;
  const close=new Promise(resolveClose=>{child.on('error',e=>{failure=e;});child.once('close',(code,signal)=>{closed=true;resolveClose({code,signal});});});
  const stop=signal=>{if(!closed&&child.pid&&child.exitCode===null&&child.signalCode===null)child.kill(signal);};
  const interrupt=()=>stop('SIGINT'),terminate=()=>stop('SIGTERM');
  process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
  try{
    const result=await close;if(failure)throw failure;
    return{...result,exitCode:result.code??(result.signal==='SIGINT'?130:result.signal==='SIGTERM'?143:1)};
  }finally{
    process.off('SIGINT',interrupt);process.off('SIGTERM',terminate);
    if(!closed){stop('SIGTERM');await close;}
  }
}
export async function main(argv=process.argv.slice(2)){
  if(!argv.length||argv.length===1&&['help','--help'].includes(argv[0])){
    const result={command:'staff-portal-workbench',
      usage:'--configuration ABS_PRIVATE_LAUNCH [--configuration-sha256 FULL_SHA256] -- ORIGINAL_COMMAND_ARGS',
      commands:['list','state','pages','preview','retain','apply','report','package','inspect-delivery','unpack-source','receive-delivery','receive-workspace','native'],
      originalHelp:'--configuration ABS_PRIVATE_LAUNCH -- --help',
      ownership:'This wrapper uses the original portal-operator.lock. Close the installed application before an offline CLI operation.',
      native:'The original native CLI retains its own selected tenant, token environment, operation and returned provider history.'};
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }
  const result=await runOriginalStaffPortalCLI(cliOptions(argv));process.exitCode=result.exitCode;return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(e=>{process.stderr.write(JSON.stringify({error:{code:e.code??'STAFF_PORTAL_CLI_FAILED',message:e.message}})+'\n');process.exitCode=1;});
