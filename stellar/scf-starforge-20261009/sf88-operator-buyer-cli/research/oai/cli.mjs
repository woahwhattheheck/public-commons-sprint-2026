// MIT. Original Python OAI publisher entry point for the installed distribution.
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export function main(args=process.argv.slice(2)){
  return new Promise((resolveResult,reject)=>{
    const child=spawn(process.env.PYTHON||'python3',
      [fileURLToPath(new URL('./oai_feed.py',import.meta.url)),...args],
      {stdio:'inherit'});
    const interrupt=()=>child.kill('SIGINT');
    const terminate=()=>child.kill('SIGTERM');
    const cleanup=()=>{
      process.off('SIGINT',interrupt);
      process.off('SIGTERM',terminate);
    };
    process.on('SIGINT',interrupt);
    process.on('SIGTERM',terminate);
    child.once('error',error=>{cleanup();reject(error);});
    child.once('exit',(code,signal)=>{
      cleanup();
      resolveResult(code??(signal==='SIGINT'?130:143));
    });
  });
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  main().then(code=>{process.exitCode=code;},error=>{
    process.stderr.write((error.message||String(error))+'\n');
    process.exitCode=1;
  });
}
