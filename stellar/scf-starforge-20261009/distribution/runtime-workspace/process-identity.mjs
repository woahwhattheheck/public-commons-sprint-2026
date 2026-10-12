// MIT. Resolve a real descendant when procfs exposes host PIDs to a PID namespace.
import { readFile,readlink,readdir } from 'node:fs/promises';

const MAX_CANDIDATES=8192,MAX_ANCESTORS=64,MAX_CACHE=64;
const candidates=new Map();
const integer=value=>Number.isSafeInteger(value)&&value>0;
function stat(text){
 const end=text.lastIndexOf(')'),pid=Number(text.slice(0,text.indexOf(' ')));
 const fields=text.slice(end+2).trim().split(/\s+/);
 if(end<0||!integer(pid)||['Z','X','x'].includes(fields[0])||!/^\d+$/.test(fields[19]??''))return null;
 const parent=Number(fields[1]);if(!Number.isSafeInteger(parent)||parent<0)return null;
 return {hostPid:pid,parent,start:fields[19]};
}
async function inspect(hostPid){
 try{
  const root=hostPid==='self'?'/proc/self':'/proc/'+hostPid;
  const [text,status,namespace]=await Promise.all([
   readFile(root+'/stat','utf8'),readFile(root+'/status','utf8'),readlink(root+'/ns/pid')]);
  const value=stat(text),ids=status.match(/^NSpid:\s+(.+)$/m)?.[1].trim().split(/\s+/).map(Number);
  const tgid=Number(status.match(/^Tgid:\s+(\d+)$/m)?.[1]),parent=Number(status.match(/^PPid:\s+(\d+)$/m)?.[1]);
  if(!value||tgid!==value.hostPid||parent!==value.parent||!ids?.length||!ids.every(integer)||
   ids[0]!==value.hostPid||(hostPid!=='self'&&hostPid!==value.hostPid))return null;
  return {...value,ids,namespace};
 }catch{return null;}
}
function sameProcess(a,b){
 return Boolean(a&&b&&a.hostPid===b.hostPid&&a.start===b.start&&a.parent===b.parent&&
  a.namespace===b.namespace&&a.ids.length===b.ids.length&&a.ids.every((id,index)=>id===b.ids[index]));
}
function sameNamespace(value,self){
 return value?.namespace===self.namespace&&value.ids.length===self.ids.length;
}
async function ancestry(value,self){
 const chain=[],seen=new Set();let current=value;
 for(let depth=0;depth<MAX_ANCESTORS;depth++){
  if(!current||seen.has(current.hostPid)||!sameNamespace(current,self))return null;
  seen.add(current.hostPid);chain.push(current.hostPid+':'+current.start+':'+current.parent);
  if(current.hostPid===self.hostPid)return sameProcess(current,self)?chain.join('/'):null;
  if(current.parent<=0)return null;
  current=await inspect(current.parent);
 }
 return null;
}
async function resolve(hostPid,pid,self){
 const first=await inspect(hostPid);
 if(!sameNamespace(first,self)||first.ids.at(-1)!==pid)return null;
 const firstChain=await ancestry(first,self);if(!firstChain)return null;
 const last=await inspect(hostPid);
 if(!sameProcess(first,last)||!sameNamespace(last,self)||last.ids.at(-1)!==pid)return null;
 const lastChain=await ancestry(last,self);
 if(!lastChain||lastChain!==firstChain)return null;
 return last.start;
}
/**
 * Return original Linux start ticks for this process or a live descendant.
 * This is a procfs lookup only: callers always signal their original local PID.
 * Namespace, complete parent chain and start ticks are checked again after lookup.
 */
export async function namespaceProcessIdentity(pid){
 if(!integer(pid))return null;
 try{
  const self=await inspect('self');
  if(!self||self.ids.at(-1)!==process.pid)return null;
  if(pid===process.pid)return self.start;
  const key=self.hostPid+':'+self.start+':'+pid,cached=candidates.get(key);
  if(cached){
   const start=await resolve(cached.hostPid,pid,self);
   if(start===cached.start)return start;
   candidates.delete(key);
  }
  const names=(await readdir('/proc')).filter(name=>/^[1-9]\d*$/.test(name)).map(Number)
   .filter(integer).sort((a,b)=>Math.abs(a-self.hostPid)-Math.abs(b-self.hostPid));
  for(let offset=0;offset<Math.min(names.length,MAX_CANDIDATES);offset+=16){
   const batch=await Promise.all(names.slice(offset,Math.min(offset+16,MAX_CANDIDATES)).map(inspect));
   for(const found of batch){
    if(!sameNamespace(found,self)||found.ids.at(-1)!==pid)continue;
    const start=await resolve(found.hostPid,pid,self);if(!start)continue;
    candidates.set(key,{hostPid:found.hostPid,start});
    while(candidates.size>MAX_CACHE)candidates.delete(candidates.keys().next().value);
    return start;
   }
  }
  return null;
 }catch{return null;}
}
