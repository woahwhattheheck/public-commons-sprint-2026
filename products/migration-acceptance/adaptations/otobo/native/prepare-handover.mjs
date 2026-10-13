#!/usr/bin/env node
// SPDX-License-Identifier: MIT
// Prepared by TokenJunkieLabs. Evaluate original reviewed source, then derive native files only.
import {readFile,writeFile,mkdir,lstat} from 'node:fs/promises';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {evaluateConfigurationPlan,canonical,hash} from '../core.mjs';
const LIMIT=256_000_000;
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
const options={};
for(let i=2;i<process.argv.length;i+=2){
 const key=process.argv[i],value=process.argv[i+1];
 if(!['--source','--target','--plan','--out-dir','--otobo-root','--perl'].includes(key)||value===undefined||Object.hasOwn(options,key))throw Error('Use each named argument once with a value.');
 options[key]=value;
}
for(const key of ['--source','--target','--plan','--out-dir'])if(!options[key])throw Error('Required '+key);
async function original(path){
 const info=await lstat(path);
 if(!info.isFile()||info.isSymbolicLink()||info.size>LIMIT)throw Error('Input must be a bounded regular file: '+path);
 const bytes=await readFile(path);
 if(bytes.length>LIMIT)throw Error('Input changed beyond complete size bound.');
 const decoded=decoder.decode(bytes);
 const value=JSON.parse(decoded.replace(/^\uFEFF/,''));
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('Expected complete JSON object.');
 return {bytes,value};
}
const [source,before,plan]=await Promise.all([
 original(resolve(options['--source'])),original(resolve(options['--target'])),original(resolve(options['--plan']))
]);
const review=evaluateConfigurationPlan({source:source.value,before:before.value,plan:plan.value});
const ordered=Array.isArray(plan.value.importOrder)&&canonical(plan.value.importOrder)===canonical(review.importOrder);
const output=resolve(options['--out-dir']);
await mkdir(output,{recursive:false,mode:0o700});
await mkdir(join(output,'inputs'),{recursive:false,mode:0o700});
for(const [name,item]of [['source.capture.json',source],['target.capture.json',before],['reviewed.plan.json',plan]]){
 await writeFile(join(output,'inputs',name),item.bytes,{flag:'wx',mode:0o600});
}
const retainedReview={schema:'otobo.native-emission-readiness.v1',preparedBy:'TokenJunkieLabs',
 sourceCaptureId:source.value.captureId,targetCaptureId:before.value.captureId,planId:plan.value.planId,
 ready:review.ready&&ordered,ordered,review,nativeImportsExecuted:false};
await writeFile(join(output,'review.json'),JSON.stringify(retainedReview,null,2)+'\n',{flag:'wx',mode:0o600});
if(!retainedReview.ready){
 process.stdout.write(JSON.stringify({ready:false,review:join(output,'review.json'),reason:!ordered?'Keep the exact complete reviewed importOrder.':'Resolve the original engine findings before native emission.'})+'\n');
 process.exitCode=2;
}else{
 const helper=fileURLToPath(new URL('./otobo-native-handover.pl',import.meta.url));
 const args=[helper,'emit','--source',join(output,'inputs','source.capture.json'),
 '--target',join(output,'inputs','target.capture.json'),'--plan',join(output,'inputs','reviewed.plan.json'),
 '--out-dir',join(output,'emission')];
 if(options['--otobo-root'])args.push('--otobo-root',resolve(options['--otobo-root']));
 const perl=options['--perl']||'perl';
 const result=await new Promise((accept,reject)=>{
  const child=spawn(perl,args,{shell:false,stdio:['ignore','pipe','pipe'],env:process.env});
  let stdout='',stderr='',overflow=false,done=false;
  const collect=(kind,data)=>{
   const text=data.toString('utf8');
   if(kind==='stdout')stdout+=text;else stderr+=text;
   if(stdout.length+stderr.length>1_000_000&&!overflow){overflow=true;child.kill('SIGTERM');}
  };
  child.stdout.on('data',data=>collect('stdout',data));
  child.stderr.on('data',data=>collect('stderr',data));
  child.on('error',error=>{if(!done){done=true;reject(error);}});
  child.on('close',(code,signal)=>{if(!done){done=true;accept({code,signal,stdout,stderr,overflow});}});
 });
 await writeFile(join(output,'native-process.json'),JSON.stringify({schema:'otobo.native-emitter-process.v1',
  executable:perl,arguments:args,...result,planId:plan.value.planId,nativeImportsExecuted:false},null,2)+'\n',{flag:'wx',mode:0o600});
 if(result.code!==0||result.overflow)throw Error('Native emitter did not complete. Preserve this directory; inspect native-process.json and use a new output path after correction.');
 const receipt=JSON.parse(decoder.decode(await readFile(join(output,'emission','emission.json'))));
 const body={...receipt};delete body.emissionId;
 if(receipt.schema!=='otobo.emission.v1'||receipt.planId!==plan.value.planId||
  receipt.sourceCaptureId!==source.value.captureId||receipt.targetCaptureId!==before.value.captureId||
  receipt.nativeImportsExecuted!==false||receipt.emissionId!==hash(body))throw Error('Native emission receipt differs from original reviewed identities.');
 await writeFile(join(output,'handover.json'),JSON.stringify({schema:'otobo.reviewed-native-handover.v1',
  preparedBy:'TokenJunkieLabs',planId:plan.value.planId,sourceCaptureId:source.value.captureId,
  targetCaptureId:before.value.captureId,emissionId:receipt.emissionId,
  files:receipt.outputs,nativeImportsExecuted:false,
  next:'Authorized operator reviews the exact files and original command arguments, runs native import separately, then independently captures target export.'},null,2)+'\n',{flag:'wx',mode:0o600});
 process.stdout.write(JSON.stringify({ready:true,planId:plan.value.planId,emissionId:receipt.emissionId,
  output,nativeImportsExecuted:false})+'\n');
}
