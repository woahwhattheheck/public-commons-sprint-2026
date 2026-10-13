#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Run the selected original private catalogue CLI while holding its workspace writer.
import {spawn} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {need,readLaunchConfiguration} from './connection.mjs';
import {inspectOriginalSource,managedOptions,runtimeEnvironment} from './managed.mjs';
const BRIDGE=join(dirname(fileURLToPath(import.meta.url)),'managed_host.py');
export function cliOptions(argv){
  const at=argv.indexOf('--');
  need(at>0&&at<argv.length-1,'CATALOGUE_DELIVERY_CLI_ARGUMENT','Select --configuration ABS_LAUNCH [--engine catalogue|approval|implementation] -- ORIGINAL_ARGS.');
  let engine='catalogue',seen=false;const outer=[];
  for(let i=0;i<at;i+=2){
    need(i+1<at,'CATALOGUE_DELIVERY_CLI_ARGUMENT','Retain every complete selected option.');
    if(argv[i]==='--engine'){
      need(!seen&&['catalogue','approval','implementation'].includes(argv[i+1]),'CATALOGUE_DELIVERY_CLI_ENGINE','Select one original command family.');
      seen=true;engine=argv[i+1];
    }else outer.push(argv[i],argv[i+1]);
  }
  const options=managedOptions(outer),original=argv.slice(at+1);
  need(!outer.includes('--port'),'CATALOGUE_DELIVERY_CLI_ARGUMENT','Use managed Applications for the original listener.');
  need(original.every(x=>typeof x==='string'&&!(x.startsWith('--')&&x.split('=',1)[0].length>2&&'--workspace'.startsWith(x.split('=',1)[0]))),
    'CATALOGUE_DELIVERY_CLI_SELECTION','The reviewed configuration selects the original workspace root.');
  need(!['serve','worker'].includes(original[0]),'CATALOGUE_DELIVERY_CLI_OWNER','Use managed Applications and its explicit worker setting for a long-running original service.');
  return{...options,engine,original};
}
export async function runOriginalCatalogueDeliveryCLI(options){
  const selected=await readLaunchConfiguration(options.configuration),v=selected.value;
  need(!options.expectedConfigurationSha256||selected.sha256===options.expectedConfigurationSha256,
    'CATALOGUE_DELIVERY_CONFIGURATION_CHANGED','Select the reviewed original configuration.',409);
  await inspectOriginalSource({directory:v.applicationDirectory,sourceManifestFile:v.sourceManifestFile,sourceManifestSha256:v.sourceManifestSha256});
  const bootstrap=[
    'import json,os,runpy,sys',
    'bridge=sys.argv.pop(1); configuration=json.loads(sys.argv.pop(1)); engine=sys.argv.pop(1)',
    "support=runpy.run_path(bridge,run_name='catalogue_delivery_managed_library')",
    "support['need'](sys.version_info>=(3,11),'Python 3.11 or later is required.')",
    "support['source'](configuration)",
    "environment=support['credentials'](configuration); environment.update({k:v for k,v in os.environ.items() if k in ('HOME','PATH','LANG','LC_ALL','LC_CTYPE','TZ','TMPDIR')})",
    "if configuration.get('leaseRoot'): environment['CATALOGUE_DELIVERY_LEASE_ROOT']=configuration['leaseRoot']",
    "os.environ.clear(); os.environ.update(environment)",
    "root=configuration['directory']; restoring=engine=='approval' and sys.argv[1:2]==['restore']",
    "if restoring:\n support['need'](not os.path.lexists(root),'The original approval receiver needs a fresh destination.'); lease=support['lock'](configuration['connectionFile']+'.lock')\nelse:\n os.makedirs(root,mode=0o700,exist_ok=True); support['directory'](root); lease=support['lock'](os.path.join(root,'catalogue-operator.lock'))",
    "name={'catalogue':'cli','approval':'approval_cli','implementation':'implementation'}[engine]",
    "selected=support['module'](name)",
    "if engine=='implementation':\n original_receive=selected.receive_package\n def managed_receive(archive,destination,**kwargs):\n  return support['receive_implementation'](original_receive,configuration,archive,destination,**kwargs)\n selected.receive_package=managed_receive",
    "sys.argv=[name,'--workspace',root]+sys.argv[1:]",
    "try:\n raise SystemExit(selected.main(sys.argv[1:]))\nfinally:\n os.close(lease)"
  ].join('\n');
  const child=spawn(v.python,['-I','-B','-c',bootstrap,BRIDGE,JSON.stringify(v),options.engine,...options.original],
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
    const result={command:'catalogue-delivery-workbench',
      usage:'--configuration ABS_PRIVATE_LAUNCH [--configuration-sha256 FULL_SHA256] [--engine catalogue|approval|implementation] -- ORIGINAL_COMMAND_ARGS',
      originalHelp:'--configuration ABS_PRIVATE_LAUNCH --engine catalogue -- --help',
      ownership:'Original catalogue-operator.lock is held until the selected original command closes. Managed Applications owns the listener and optional recurring worker.',
      receiving:'Use the original complete implementation and approval receivers with their exact source and archive identities.'};
    process.stdout.write(JSON.stringify(result,null,2)+'\n');return result;
  }
  const result=await runOriginalCatalogueDeliveryCLI(cliOptions(argv));process.exitCode=result.exitCode;return result;
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url)
  main().catch(e=>{process.stderr.write(JSON.stringify({error:{code:e.code??'CATALOGUE_DELIVERY_CLI_FAILED',message:e.message}})+'\n');process.exitCode=1;});
