import { spawn } from 'node:child_process';
import { readFileSync, existsSync, readdirSync, statSync, fstatSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateDirectory } from '../vendor/stellar-expert/store.mjs';
import { atomicJson, requireValue, sha, now } from '../core/common.mjs';

const sourceRoot=dirname(dirname(fileURLToPath(import.meta.url))),script=fileURLToPath(import.meta.url);
const args={};for(let i=2;i<process.argv.length;i++){const name=process.argv[i];requireValue(name.startsWith('--'),'CLI_ARGUMENT','Use named installation arguments.');
  const key=name.slice(2);args[key]=['help','reopen','inside-original-lock'].includes(key)?true:process.argv[++i];}
if(args.help){process.stdout.write('node scripts/install.mjs --receipt /private/runtime-ready.json [--cache /private/npm-cache] [--prepared-runtime /private/prepared-runtime] [--reopen]\n');process.exit(0);}
requireValue(/^v24\./.test(process.version),'NODE_VERSION','Select Node24 for this complete installed application.',409);
const receipt=resolve(args.receipt??join(sourceRoot,'..','runtime-ready.json')),lock=realpathSync(sourceRoot)+'.install.lock';
await privateDirectory(dirname(receipt),{create:true});
if(!args['inside-original-lock']){
  // Native flock owns the complete original installer. Its open description is
  // deliberately inherited by every real npm/build child below, including after
  // a caller/installer process interruption.
  const original=process.argv.slice(2);
  const exit=await new Promise((yes,no)=>{const child=spawn('flock',['--exclusive','--nonblock',lock,process.execPath,script,...original,'--inside-original-lock'],{cwd:sourceRoot,env:process.env,stdio:'inherit'});
    child.once('error',no);child.once('exit',(code,signal)=>yes({code,signal}));});
  process.exitCode=exit.code??1;
}else{
  const lockStat=statSync(lock),fds=readdirSync('/proc/self/fd').filter(v=>/^\d+$/.test(v)).map(Number).filter(fd=>{
    if(fd<3)return false;try{const s=fstatSync(fd);return s.dev===lockStat.dev&&s.ino===lockStat.ino;}catch{return false;}});
  requireValue(fds.length,'INSTALL_LIFETIME_LOCK','The original native flock descriptor must reach the complete installation process.',409);
  const stdio=Array.from({length:Math.max(2,...fds)+1},(_,i)=>i<3?'inherit':fds.includes(i)?i:'ignore');
  async function run(command,argv){
    await new Promise((yes,no)=>{const child=spawn(command,argv,{cwd:sourceRoot,env:process.env,stdio});
      child.once('error',no);child.once('exit',(code,signal)=>code===0?yes():no(new Error('Original runtime command failed: '+command+' / '+(signal??code))));});
  }
  const original=readFileSync(join(sourceRoot,'package-lock.json')),packageJson=readFileSync(join(sourceRoot,'package.json'));
  if(existsSync(receipt)){
    const {selectRuntime}=await import('../native/selection.mjs'),selected=await selectRuntime({sourceRoot,runtimeReadyFile:receipt});
    process.stdout.write(JSON.stringify({state:'ready',reopened:true,receipt,selectionSha256:selected.selectionSha256})+'\n');
  }else{
    requireValue(!args.reopen,'RUNTIME_RECEIPT_MISSING','The original installed receipt does not yet exist.',409);
    let installation;
    if(args['prepared-runtime']){
      // Adopt the existing complete runtime owner's verified READY application.
      // Its original preparation owns npm/build and full upstream source custody.
      const {inspectRuntime:inspectPreparedRuntime}=await import('../runtime/client.mjs');
      const prepared=await inspectPreparedRuntime({directory:resolve(args['prepared-runtime']),node:process.execPath,full:true});
      requireValue(prepared.schema==='hocuspocus.runtime-status.v1'&&prepared.status==='READY'&&realpathSync(prepared.application)===realpathSync(sourceRoot),
        'PREPARED_RUNTIME_BINDING','Run this exact adapter from the original prepared or received application returned by runtime/manage.py.',409);
      requireValue(existsSync(join(sourceRoot,'dist/build-manifest.json')),'PREPARED_BUILD_MISSING','The complete original runtime must include its selected application build.',409);
      installation={mode:'original-prepared-runtime',runtimeId:prepared.id,runtimeDirectory:prepared.directory,
        sourceId:prepared.source_id??prepared.source?.source_id??null,completedAt:now()};
    }else{
      const npmArgs=['ci','--no-audit','--no-fund'];if(args.cache)npmArgs.push('--cache',resolve(args.cache));
      await run(process.platform==='win32'?'npm.cmd':'npm',npmArgs);
      requireValue(readFileSync(join(sourceRoot,'package-lock.json')).equals(original)&&readFileSync(join(sourceRoot,'package.json')).equals(packageJson),'INSTALL_SOURCE_CHANGED','Installation changed the exact original selected package source.',409);
      await run(process.execPath,[join(sourceRoot,'scripts/build.mjs')]);
      installation={mode:'source-install',command:['npm',...npmArgs],completedAt:now()};
    }
    requireValue(readFileSync(join(sourceRoot,'package-lock.json')).equals(original)&&readFileSync(join(sourceRoot,'package.json')).equals(packageJson),'INSTALL_SOURCE_CHANGED','The selected package source changed during original runtime receipt binding.',409);
    const {inspectRuntime}=await import('../native/selection.mjs'),selected=await inspectRuntime({sourceRoot});
    atomicJson(receipt,{...selected,installation:{...installation,packageJsonSha256:sha(packageJson),lockfileSha256:sha(original)}},{immutable:true});
    process.stdout.write(JSON.stringify({state:'ready',reopened:false,receipt,selectionSha256:selected.selectionSha256})+'\n');
  }
}
