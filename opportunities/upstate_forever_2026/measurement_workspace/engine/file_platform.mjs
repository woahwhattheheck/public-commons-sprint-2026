/** File publication boundaries for the installed Measurements application. */
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const helper=fileURLToPath(new URL('./file_platform.py',import.meta.url));
const schema='upstate.measurements-directory-boundary/v1';
export function syncDirectory(directory){
 const selected=path.resolve(directory),stat=fs.lstatSync(selected);
 if(!stat.isDirectory()||stat.isSymbolicLink())throw Error('Use an original real directory: '+selected);
 if(process.platform==='win32'){
  const python=process.env.MEASUREMENTS_PYTHON;
  if(!python)throw Error('Open Measurements through the installed operator or set MEASUREMENTS_PYTHON to its verified original interpreter.');
  const raw=execFileSync(python,['-B',helper,'directory',selected],{
   encoding:'utf8',maxBuffer:65536,windowsHide:true,stdio:['ignore','pipe','pipe']});
  const result=JSON.parse(raw);
  if(result.schema!==schema||result.platform!=='win32'||path.resolve(result.path)!==selected||
      result.boundary!=='directory-handle-validation'||result.operation!=='directory')
   throw Error('The original Windows directory helper returned a different boundary.');
  return result;
 }
 const fd=fs.openSync(selected,'r');let failure;
 try{fs.fsyncSync(fd);}
 catch(error){failure=error;throw error;}
 finally{try{fs.closeSync(fd);}catch(error){if(!failure)throw error;}}
 return {schema,operation:'directory',platform:process.platform,path:selected,boundary:'directory-fsync'};
}
