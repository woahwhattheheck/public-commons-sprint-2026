#!/usr/bin/env node
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
export async function main(argv=process.argv.slice(2)){
  const executable=process.env.FINAGE_PYTHON||'python3';
  if(executable.includes('\0'))throw new Error('Choose a valid Finage Python executable.');
  const script=fileURLToPath(new URL('./acquisition.py',import.meta.url));
  await new Promise((resolveRun,rejectRun)=>{
    const child=spawn(executable,[script,...argv],{stdio:'inherit',env:process.env});
    const stop=signal=>child.kill(signal),interrupt=()=>stop('SIGINT'),terminate=()=>stop('SIGTERM');
    process.once('SIGINT',interrupt);process.once('SIGTERM',terminate);
    const cleanup=()=>{process.removeListener('SIGINT',interrupt);process.removeListener('SIGTERM',terminate);};
    child.once('error',error=>{cleanup();rejectRun(error);});
    child.once('exit',(code,signal)=>{cleanup();if(code===0)resolveRun();else{process.exitCode=code??1;rejectRun(new Error('Original Finage acquisition exited '+(signal??code)));}});
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(error=>{process.stderr.write(error.message+'\n');process.exitCode||=1;});
