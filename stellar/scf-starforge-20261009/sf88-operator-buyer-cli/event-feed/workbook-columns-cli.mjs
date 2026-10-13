#!/usr/bin/env node
/** Original Event worksheet choices: complete file preparation and receiving. */
import { open, lstat, realpath, link, unlink } from 'node:fs/promises';
import { resolve, dirname, basename, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { initial, reopen, review, nativeColumns, reviewHTML } from './workbook-columns.mjs';
const MAX=16*1024*1024;
const need=(ok,text)=>{if(!ok)throw Error(text);};
async function read(path){
  const selected=resolve(path),before=await lstat(selected);
  need(before.isFile()&&!before.isSymbolicLink()&&before.size<=MAX,'Select a complete regular JSON file up to 16 MiB.');
  const fd=await open(selected,'r');
  try{
    const a=await fd.stat();need(a.dev===before.dev&&a.ino===before.ino&&a.size===before.size,'The selected file changed while opening.');
    const raw=await fd.readFile();const b=await fd.stat();
    need(raw.length===a.size&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs,'The complete selected source changed while reading.');
    return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw));
  }finally{await fd.close();}
}
async function publish(path,body){
  const destination=resolve(path),parent=dirname(destination),folder=await lstat(parent);
  need(folder.isDirectory()&&!folder.isSymbolicLink(),'Choose an existing private output directory.');
  const actual=await realpath(parent),target=join(actual,basename(destination));
  const temporary=join(actual,'.event-columns-'+randomUUID()+'.tmp'),raw=Buffer.from(body,'utf8');
  const fd=await open(temporary,'wx',0o600);let written=false;
  try{await fd.writeFile(raw);await fd.sync();written=true;}finally{await fd.close();if(!written)await unlink(temporary).catch(()=>{});}
  try{
    try{await link(temporary,target);}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const old=await lstat(target);need(old.isFile()&&!old.isSymbolicLink()&&old.size===raw.length,'The output already contains different original work.');
      const original=await open(target,'r');try{const before=await original.stat();const received=await original.readFile();const after=await original.stat();need(before.dev===old.dev&&before.ino===old.ino&&before.size===after.size&&before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs&&received.equals(raw),'The output already contains different original work.');}finally{await original.close();}
    }
    const directory=await open(actual,'r');try{await directory.sync();}finally{await directory.close();}
  }finally{await unlink(temporary).catch(()=>{});}
  return {path:target,bytes:raw.length};
}
function args(values){
  const command=values.shift(),out={command};
  need(['template','inspect','columns','html'].includes(command),'Use template, inspect, columns or html.');
  while(values.length){const key=values.shift();need(['--proposal','--workspace','--programme','--choices','--out'].includes(key)&&values.length,'Unknown or incomplete argument '+key);need(!Object.hasOwn(out,key.slice(2)),'Do not repeat '+key);out[key.slice(2)]=values.shift();}
  return out;
}
function proposal(value){
  const candidate=value?.state==='WORKBOOK_COLUMN_CHOICES_REQUIRED'?value:value?.result;
  need(candidate?.state==='WORKBOOK_COLUMN_CHOICES_REQUIRED','Select the complete native worksheet proposal or its original completed action.');
  return candidate;
}
async function main(){
  const a=args(process.argv.slice(2));let value;
  if(a.command==='template'){
    need(a.proposal&&a.workspace&&a.programme&&a.out,'Template needs --proposal, --workspace, --programme and --out.');
    value=initial({workspace_id:a.workspace,programme:a.programme,proposal:proposal(await read(a.proposal))});
    console.log(JSON.stringify(await publish(a.out,JSON.stringify(value,null,2)+'\n'),null,2));return;
  }
  need(a.choices,'Select the complete --choices handover.');
  value=reopen(await read(a.choices));
  if(a.proposal||a.workspace||a.programme){
    need(a.proposal&&a.workspace&&a.programme,'Together select --proposal, --workspace and --programme for original source matching.');
    value=reopen(value,{workspace_id:a.workspace,programme:a.programme,proposal:proposal(await read(a.proposal))});
  }
  if(a.command==='inspect'){
    const result=review(value),raw=JSON.stringify(result,null,2)+'\n';
    if(a.out)console.log(JSON.stringify(await publish(a.out,raw),null,2));else process.stdout.write(raw);
  }else{
    need(a.out,'Choose a new --out path for the complete selected file.');
    const raw=a.command==='columns'?JSON.stringify(nativeColumns(value),null,2)+'\n':reviewHTML(value);
    console.log(JSON.stringify(await publish(a.out,raw),null,2));
  }
}
main().catch(error=>{process.stderr.write(JSON.stringify({error:error.message})+'\n');process.exitCode=1;});
