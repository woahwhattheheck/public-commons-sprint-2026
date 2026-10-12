import fs from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
const selected=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
const {work,stage}=selected;
const nodeBin=dirname(process.execPath);
// This selected operator profile has no external dependencies. Keep npm pack writes
// in the operation's own writable cache, independent of a shared seed filesystem.
const cache=join(work,'npm-cache-owned');
const save=async(name,value)=>fs.writeFile(join(stage,name),JSON.stringify(value,null,2)+'\n',{mode:0o600});
const phase=(stage,detail={})=>console.log(JSON.stringify({stage,...detail}));
process.env.npm_config_cache=cache;process.env.NPM_CONFIG_CACHE=cache;
process.env.npm_config_audit='false';process.env.npm_config_fund='false';process.env.npm_config_update_notifier='false';
process.env.PATH=nodeBin+':'+process.env.PATH;
try {
  await fs.mkdir(cache,{recursive:true,mode:0o700});
  if(!(await fs.lstat(cache)).isDirectory()||await fs.realpath(cache)!==cache)
    throw Error('Use a real writable npm cache directory owned by this receiving operation');
  if(selected.prepareOnly!==undefined&&typeof selected.prepareOnly!=='boolean')
    throw Error('prepareOnly must be a boolean when provided');
  const {buildDistribution}=await import(pathToFileURL(join(selected.builder,'build.mjs')).href);
  const output=join(work,'release');
  let resume=false;try {await fs.stat(output);resume=true;}catch(error){if(error.code!=='ENOENT')throw error;}
  phase('original distribution producer',{sourceCommit:selected.sourceCommit,resume});
  const built=await buildDistribution({repository:selected.cache,ref:selected.sourceCommit,output,offline:true,resume,
    python:'/usr/bin/python3',onProgress:event=>phase('producer',event)});
  await save('native-build.json',built);phase('original source edition packaged',{sourceCommit:built.sourceCommit,sourceFiles:built.sourceFiles,sha256:built.sha256});
  const installer=await import(pathToFileURL(join(output,'package/source/stellar/scf-starforge-20261009/distribution/runtime-install.mjs')).href);
  const runtime=join(work,'runtime');
  try {await fs.stat(join(runtime,'runtime-install.json'));}catch(error){if(error.code!=='ENOENT')throw error;
    await installer.prepareRuntimeInstall({directory:runtime,archive:built.archive,sha256:built.sha256,native:false,features:[],operator:true,python:'/usr/bin/python3'});
  }
  await installer.installRuntime({directory:runtime,offline:true,cache,npm:join(nodeBin,'npm')});
  const plan=JSON.parse(await fs.readFile(join(runtime,'runtime-install.json'),'utf8'));
  const state=JSON.parse(await fs.readFile(join(runtime,'install-state.json'),'utf8'));
  if(state.phase!=='READY'||plan.source.sourceCommit!==selected.sourceCommit)throw Error('Original installed runtime did not reach the selected READY source');
  const journey={...selected,runtime,sourceRoot:plan.sourceRoot,sourceCommit:plan.source.sourceCommit};
  const file=join(work,'journey-selection.json');await fs.writeFile(file,JSON.stringify(journey),{mode:0o600});
  phase('original runtime installed READY',{sourceCommit:plan.source.sourceCommit});
  if(selected.prepareOnly){
    phase('original runtime prepared for the same native receiving operation',{sourceCommit:plan.source.sourceCommit,selection:file});
  }else{
    const code=await new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(stage,'native-journey.mjs'),file],{stdio:'inherit',env:process.env});child.once('error',reject);child.once('exit',code=>resolve(code??1));});
    process.exitCode=code;
  }
} catch(error) {
  const result={status:'FAILED',sourceCommit:selected.sourceCommit,error:String(error.stack),at:new Date().toISOString()};
  await save('native-wrapper-result.json',result);console.error('NATIVE_WRAPPER_FAILURE '+JSON.stringify(result));process.exitCode=1;
}
