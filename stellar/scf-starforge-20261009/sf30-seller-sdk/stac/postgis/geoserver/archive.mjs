// MIT. Stream the original receiving package with one retained native child.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { absolute, hash, need } from './contract.mjs';

export function createGeoServerArchive({directory,archiveFile,manifestSha256,
  python=process.env.CODEX_PRIMARY_RUNTIME_PYTHON||'python3',signal}={}){
  absolute(directory);absolute(archiveFile);hash(manifestSha256);signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const child=spawn(python,['-B',fileURLToPath(new URL('./archive.py',import.meta.url)),
      directory,archiveFile,manifestSha256],{stdio:['ignore','pipe','pipe'],shell:false});
    let output='',stderr='',issue=null,stopping=false;
    const stop=()=>{issue??=signal?.reason??new Error('Archive cancelled.');
      if(!stopping){stopping=true;child.kill('SIGTERM');}};
    signal?.addEventListener('abort',stop,{once:true});
    child.on('error',error=>{issue??=error;});
    child.stdout.on('data',chunk=>{output+=chunk.toString();
      if(output.length>131072){issue??=new Error('Native archive output exceeded its result allowance.');stop();}});
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-4096);});
    child.once('close',code=>{
      signal?.removeEventListener('abort',stop);
      if(issue)return reject(issue);
      if(code!==0)return reject(Object.assign(new Error(stderr||'Native archive failed.'),{code:'GEOSERVER_ARCHIVE_FAILED'}));
      try{const result=JSON.parse(output);need(result.schema==='starforge.geoserver-archive.v1'&&
        result.path===archiveFile&&result.manifestSha256===manifestSha256,'GEOSERVER_ARCHIVE_RESULT');resolve(result);}
      catch(error){reject(error);}
    });
    if(signal?.aborted)stop();
  });
}
