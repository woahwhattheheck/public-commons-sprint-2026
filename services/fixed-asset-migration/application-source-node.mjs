import fs from 'node:fs';
import path from 'node:path';
import {APPLICATION_SOURCE_PATHS,createApplicationSource} from './application-source.mjs';
import {sha256Utf8} from './sha256.mjs';

/** Read only the maintained allowlist; source records/customer files are excluded. */
export function readApplicationSource(applicationRoot){
 const root=fs.realpathSync(path.resolve(applicationRoot,'../..'));
 const files=APPLICATION_SOURCE_PATHS.map(name=>{
  const target=path.resolve(root,...name.split('/'));
  const stat=fs.lstatSync(target);
  if(!stat.isFile()||stat.isSymbolicLink())throw Error('Retain an original regular application source: '+name);
  const real=fs.realpathSync(target);
  if(!real.startsWith(root+path.sep))throw Error('Application source leaves its retained root: '+name);
  const bytes=fs.readFileSync(real),text=bytes.toString('utf8');
  if(!Buffer.from(text,'utf8').equals(bytes))throw Error('Application source is not complete UTF-8: '+name);
  return {path:name,text};
 });
 return createApplicationSource({sha256Utf8}).prepare(files);
}
