#!/usr/bin/env node
/** Original CanadaBuys Workshare -> complete native Installation source. */
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {spawnSync} from 'node:child_process';
import {prepareNativeWorkshareSource,retainNativeSelectionTemplate} from './canadabuys-source.mjs';
import {readProfile} from './profiles.mjs';

const here=dirname(fileURLToPath(import.meta.url));
const usage='starforge grant-installation-workorder canadabuys template --package ORIGINAL_PACKAGE.json --out PRIVATE_DIRECTORY\n'+
  'starforge grant-installation-workorder canadabuys prepare --package ORIGINAL_PACKAGE.json --selection SELECTED_SOURCE.json --out PRIVATE_DIRECTORY [--python python3]\n'+
  'starforge grant-installation-workorder canadabuys package --source PRIVATE_PREPARATION --out COMPLETE_SOURCE.zip [--python python3]';
export function main(argv=process.argv.slice(2)){
  const [command,...args]=argv,value={};
  if(!['template','prepare','package'].includes(command))throw new Error(usage);
  for(let i=0;i<args.length;i+=2){
    const key=args[i]?.replace(/^--/,'');
    if(!['package','selection','source','out','python'].includes(key)||!args[i]?.startsWith('--')||
      !args[i+1]||args[i+1].startsWith('--')||Object.hasOwn(value,key))throw new Error(usage);
    value[key]=args[i+1];
  }
  if(!value.out||(command==='package'?(!value.source||value.package||value.selection):
      (!value.package||value.source||(command==='prepare'&&!value.selection)||
       (command==='template'&&(value.selection||value.python)))))throw new Error(usage);
  const profile=readProfile('canadabuys-bidder-desk');
  if(profile.value.id!=='canadabuys-bidder-desk')throw new Error('Select the complete installed CanadaBuys profile.');
  if(command==='package'){
    const entry=join(here,'../../sf47_budget_model/workspace/canadabuys_source_package.py');
    const result=spawnSync(value.python||'python3',[entry,'--source',resolve(value.source),'--out',resolve(value.out)],
      {stdio:'inherit',env:process.env});
    if(result.error)throw result.error;
    if(result.signal)throw new Error('Complete native source packaging ended on '+result.signal+'.');
    process.exitCode=result.status??1;return;
  }
  if(command==='template'){
    console.log(JSON.stringify(retainNativeSelectionTemplate(resolve(value.package),resolve(value.out)),null,2));return;
  }
  const source=prepareNativeWorkshareSource({selectionPath:resolve(value.selection),
    packagePath:resolve(value.package),outputDirectory:resolve(value.out)});
  const intake=join(here,'../../sf47_budget_model/workspace/canadabuys_workshare_intake.py');
  const result=spawnSync(value.python||'python3',[intake,
    '--commissioning',join(resolve(value.out),source.output.filename),
    '--packet',join(resolve(value.out),source.originalPackage.filename),
    '--out',resolve(value.out)],{stdio:'inherit',env:process.env});
  if(result.error)throw result.error;
  if(result.signal)throw new Error('Native original Workshare preparation ended on '+result.signal+'.');
  process.exitCode=result.status??1;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  try{main();}catch(error){console.error(error.message);process.exitCode=1;}
}
