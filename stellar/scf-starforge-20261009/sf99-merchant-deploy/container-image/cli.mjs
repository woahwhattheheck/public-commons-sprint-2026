#!/usr/bin/env node
// MIT. Prepare, build and carry a selected merchant runtime to its Docker host.
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectPlan, prepareImage, checkContext } from './image.mjs';
import { lockImage, buildImage, imageStatus, exportImage, importImage } from './engine.mjs';

const HELP = `Merchant container runtime image

inspect --plan PRIVATE_IMAGE_PLAN.json
prepare --plan PRIVATE_IMAGE_PLAN.json --out NEW_CONTEXT
lock --context CONTEXT [--lock-file EXISTING_LOCK.json] [--npm NPM_EXECUTABLE]
check --context CONTEXT
build --context CONTEXT [--engine DOCKER_EXECUTABLE]
status --context CONTEXT [--engine DOCKER_EXECUTABLE]
export --context CONTEXT --out NEW_TRANSFER_DIRECTORY [--engine DOCKER_EXECUTABLE]
import --bundle TRANSFER_DIRECTORY [--engine DOCKER_EXECUTABLE]

Use an existing retained merchant distribution and an explicit local runtime base
image digest. Preparation is local; lock resolves the selected public dependencies.
Build creates the image; export/import use Docker's original image save/load.
Every command retains the same selected source and native image identity.`;

export async function main(args=process.argv.slice(2)) {
  if (!args.length || ['--help','help'].includes(args[0])) { console.log(HELP); return 0; }
  const [action,...rest] = args;
  const allowed = {inspect:['--plan'],prepare:['--plan','--out'],
    lock:['--context','--lock-file','--npm'],check:['--context'],
    build:['--context','--engine'],status:['--context','--engine'],
    export:['--context','--out','--engine'],import:['--bundle','--engine']}[action];
  if(!allowed) throw new Error(HELP);
  const v={};
  for(let i=0;i<rest.length;i++) {
    const key=rest[i];
    if(!allowed.includes(key)||Object.hasOwn(v,key)||!rest[i+1]||rest[i+1].startsWith('--')) throw new Error(HELP);
    v[key]=rest[++i];
  }
  const required = {inspect:['--plan'],prepare:['--plan','--out'],lock:['--context'],
    check:['--context'],build:['--context'],status:['--context'],export:['--context','--out'],import:['--bundle']}[action];
  if(required.some(key=>!v[key])) throw new Error(HELP);
  const engine=v['--engine']??'docker'; let result;
  if(action==='inspect') {
    const p=await inspectPlan(v['--plan']);
    result={status:'IMAGE_PLAN_REVIEWED',id:p.id,baseImage:p.baseImage,platform:p.platform,
      release:p.release,sourceRoot:p.sourceRoot,dependencyRoot:p.dependencyRoot,
      runtime:p.runtime,uid:p.uid,gid:p.gid,features:p.features,dependencies:p.dependencies,pythonModules:p.pythonModules,
      sourceModes:p.sourceModes};
  } else if(action==='prepare') result=await prepareImage(v['--plan'],v['--out']);
  else if(action==='lock') result=await lockImage(v['--context'],{npm:v['--npm']??'npm',lockFile:v['--lock-file']??null,stream:true});
  else if(action==='check') {
    const p=await checkContext(v['--context']);
    result={status:'IMAGE_CONTEXT_MATCHES',directory:p.directory,sourceCommit:p.release.sourceCommit,
      archiveSha256:p.release.archiveSha256,lockSha256:p.lockSha256,features:p.features,
      sourceModes:p.sourceModes};
  } else if(action==='build') result=await buildImage(v['--context'],{engine});
  else if(action==='status') result=await imageStatus(v['--context'],{engine});
  else if(action==='export') result=await exportImage(v['--context'],v['--out'],{engine});
  else result=await importImage(v['--bundle'],{engine});
  console.log(JSON.stringify(result,null,2)); return 0;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))
  main().then(code=>{process.exitCode=code;}).catch(error=>{console.error(error.message);process.exitCode=1;});
