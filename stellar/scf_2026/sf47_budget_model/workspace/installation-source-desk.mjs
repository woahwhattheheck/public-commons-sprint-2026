#!/usr/bin/env node
// Installed command bridge to the original private-workspace Source Desk CLI.
import {spawn} from 'node:child_process';
import {isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';

const forwarded=process.argv.slice(2);
let executable=process.env.SF47_PYTHON||'python3';
if(forwarded[0]==='--python'){
  if(typeof forwarded[1]!=='string'||!isAbsolute(forwarded[1])||forwarded[1].includes('\0')){
    process.stderr.write('Source Desk --python requires an absolute executable path before the command.\n');
    process.exitCode=2;
  }else executable=forwarded.splice(0,2)[1];
}
if(process.exitCode===undefined){
  const entry=fileURLToPath(new URL('./installation-source-desk.py',import.meta.url));
  const child=spawn(executable,['-B',entry,...forwarded],{stdio:'inherit',shell:false,env:{...process.env}});
  let closed=false,startFailed=false;
  const forward=signal=>{if(!closed&&child.pid!==undefined){try{child.kill(signal);}catch{}}};
  const interrupt=()=>forward('SIGINT'),terminate=()=>forward('SIGTERM');
  process.on('SIGINT',interrupt);process.on('SIGTERM',terminate);
  child.once('error',error=>{
    startFailed=true;
    process.stderr.write('The original Source Desk Python command could not start: '+error.message+
      '\nSelect Python 3 with --python /absolute/executable or SF47_PYTHON.\n');
    process.exitCode=127;
  });
  child.once('close',(code,signal)=>{
    closed=true;process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);
    if(!startFailed)process.exitCode=code??(signal==='SIGINT'?130:signal==='SIGTERM'?143:1);
  });
}
