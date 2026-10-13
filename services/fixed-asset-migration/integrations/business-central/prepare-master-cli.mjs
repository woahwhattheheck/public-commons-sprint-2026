#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {prepareMasterCapture} from './prepare-master.mjs';

function regular(file){
  const st=fs.lstatSync(file);if(!st.isFile()||st.isSymbolicLink())throw new Error('Use a complete regular file: '+file);
  return fs.readFileSync(file);
}
function durableDirectory(directory){
  let fd;try{fd=fs.openSync(directory,'r');fs.fsyncSync(fd);}
  catch(error){if(!['EINVAL','EPERM','EISDIR','ENOTSUP'].includes(error.code))throw error;}
  finally{if(fd!==undefined)fs.closeSync(fd);}
}
function publish(file,text){
  const bytes=Buffer.from(text,'utf8');
  try{if(!regular(file).equals(bytes))throw new Error('Another complete output edition exists at '+file);return;}
  catch(error){if(error.code!=='ENOENT')throw error;}
  const temporary=file+'.'+randomUUID()+'.candidate';let fd;
  try{
    fd=fs.openSync(temporary,'wx',0o600);fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);fs.closeSync(fd);fd=undefined;
    try{fs.linkSync(temporary,file);}catch(error){if(error.code!=='EEXIST'||!regular(file).equals(bytes))throw error;}
    durableDirectory(path.dirname(file));
  }finally{if(fd!==undefined)fs.closeSync(fd);fs.rmSync(temporary,{force:true});}
}
export function main(args=process.argv.slice(2)){
  if(args.length!==4||args[0]!=='--capture'||args[2]!=='--out')throw new Error('Use --capture /absolute/capture.json --out /absolute/output-directory');
  if(!path.isAbsolute(args[1])||!path.isAbsolute(args[3]))throw new Error('Use absolute capture and output paths.');
  const input=fs.lstatSync(args[1]);if(!input.isFile()||input.isSymbolicLink())throw new Error('Use a complete original regular capture file.');
  if(input.size>128*1024*1024)throw new Error('Capture exceeds the original workspace limit.');
  const raw=regular(args[1]),text=raw.toString('utf8');
  if(!Buffer.from(text,'utf8').equals(raw))throw new Error('Capture must be complete UTF-8.');
  const result=prepareMasterCapture(JSON.parse(text)),root=path.resolve(args[3]);
  fs.mkdirSync(root,{recursive:true,mode:0o700});const st=fs.lstatSync(root);
  if(!st.isDirectory()||st.isSymbolicLink())throw new Error('Use an ordinary output directory.');
  const actualRoot=fs.realpathSync(root);
  for(const file of result.files){
    const target=path.resolve(root,file.path);
    if(!target.startsWith(root+path.sep))throw new Error('Keep prepared output inside its selected directory.');
    fs.mkdirSync(path.dirname(target),{recursive:true,mode:0o700});
    const parent=fs.realpathSync(path.dirname(target));
    if(parent!==actualRoot&&!parent.startsWith(actualRoot+path.sep))throw new Error('Keep output members inside the selected directory.');
    publish(target,file.text);
  }
  return {scope:result.scope,output:root,files:result.files.map(({text,...file})=>file)};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{process.stdout.write(JSON.stringify(main(),null,2)+'\n');}
  catch(error){process.stderr.write(JSON.stringify({error:error.code||error.name,message:error.message})+'\n');process.exitCode=1;}
}
