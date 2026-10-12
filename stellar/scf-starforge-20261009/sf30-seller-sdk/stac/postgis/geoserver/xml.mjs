// MIT. Standard-library XML views; original WFS schema/feature parsers remain shared.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { need, MiB } from './contract.mjs';

export async function inspectXml(bytes,kind,{python=process.env.CODEX_PRIMARY_RUNTIME_PYTHON||'python3',signal}={}){
  need(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=8*MiB&&['wms','style','envelope'].includes(kind),
    'GEOSERVER_XML_INPUT');
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const child=spawn(python,['-B',fileURLToPath(new URL('./xml.py',import.meta.url)),kind],
      {stdio:['pipe','pipe','pipe'],shell:false});
    const chunks=[];let size=0,stderr='',issue=null;
    const stop=()=>{issue??=signal?.reason??new Error('XML view cancelled.');child.kill('SIGKILL');};
    const timer=setTimeout(()=>{issue??=Object.assign(new Error('The native XML view timed out.'),{code:'GEOSERVER_XML_TIMEOUT'});child.kill('SIGKILL');},30000);
    signal?.addEventListener('abort',stop,{once:true});
    child.stdout.on('data',chunk=>{size+=chunk.length;
      if(size>8*MiB){issue??=new Error('The complete native XML model is too large.');child.kill('SIGKILL');}
      else chunks.push(chunk);});
    child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-4096);});
    child.stdin.on('error',error=>{issue??=error;});child.once('error',error=>{issue??=error;});
    child.once('close',code=>{
      clearTimeout(timer);signal?.removeEventListener('abort',stop);
      if(issue)return reject(issue);
      if(code!==0)return reject(Object.assign(new Error(stderr.trim()||'The native XML response is invalid.'),{code:'GEOSERVER_XML_INVALID'}));
      try{resolve(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks))));}
      catch(error){reject(Object.assign(error,{code:'GEOSERVER_XML_MODEL'}));}
    });
    if(signal?.aborted)stop();child.stdin.end(bytes);
  });
}
export const inspectStyle=(bytes,options)=>inspectXml(bytes,'style',options);
