'use strict';
// One create-only publication, with restart state outside the delivered source.
// Adapters are explicit so the same production code can be exercised without
// substituting a second publication implementation.
function createPublication({fs,path,hash,encode,randomId,syncDirectories=true}){
 const fail=message=>{throw Error(message);};
 const bytes=(value,encoding)=>encode(value,encoding);
 const json=value=>JSON.stringify(value,null,2)+'\n';
 async function stat(p){try{return await fs.lstat(p);}catch(e){if(e.code==='ENOENT')return null;throw e;}}
 function safe(name){
  if(typeof name!=='string'||!name||name.length>4096||/[\x00-\x1f\x7f\\<>:"|?*]/.test(name))fail('Unsafe publication path');
  for(const part of name.split('/'))if(!part||part==='.'||part==='..'||/[ .]$/.test(part)||bytes(part).length>255||/^(CON|PRN|AUX|NUL|CONIN\$|CONOUT\$|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(part))fail('Unsafe publication component: '+part);
  return name;
 }
 async function dir(p){const s=await stat(p);if(!s||!s.isDirectory()||s.isSymbolicLink())fail('Not an ordinary directory: '+p);}
 async function ancestors(p){const chain=[];for(let at=p;;at=path.dirname(at)){chain.unshift(at);if(path.dirname(at)===at)break;}for(const at of chain)await dir(at);}
 async function sync(p){if(!syncDirectories)return;const h=await fs.open(p,'r');try{await h.sync();}finally{await h.close();}}
 async function mkdir(p){try{await fs.mkdir(p);await sync(path.dirname(p));}catch(e){if(e.code!=='EEXIST')throw e;}await dir(p);}
 async function exact(p,body){
  const s=await stat(p);if(!s||!s.isFile()||s.isSymbolicLink())fail('Not an ordinary publication file: '+p);
  const actual=await fs.readFile(p),a=hash(actual),b=hash(body);
  if(a.bytes!==b.bytes||a.sha256!==b.sha256)fail('Existing publication bytes differ: '+p);
 }
 async function atomic(target,body,staging,prefix='member',acceptWinner=false){
  await dir(staging);await dir(path.dirname(target));
  if(await stat(target)){if(!acceptWinner)await exact(target,body);return;}
  const temporary=path.join(staging,'.'+prefix+'.'+randomId()+'.stage');
  let handle;
  try{
   handle=await fs.open(temporary,'wx',0o600);await handle.writeFile(body);await handle.sync();await handle.close();handle=null;
   try{await fs.link(temporary,target);}catch(e){if(e.code!=='EEXIST')throw e;if(!acceptWinner)await exact(target,body);}
   await sync(path.dirname(target));if(!acceptWinner)await exact(target,body);
  }finally{
   if(handle)await handle.close();
   try{await fs.unlink(temporary);await sync(staging);}catch(e){if(e.code!=='ENOENT')throw e;}
  }
 }
 async function readJSON(p){const s=await stat(p);if(!s||!s.isFile()||s.isSymbolicLink())fail('Not an ordinary state file: '+p);return JSON.parse((await fs.readFile(p)).toString('utf8'));}
 function planMembers(members,completionPath){
  if(!Array.isArray(members)||!members.length)fail('Publication needs complete members');
  const keys=new Map(),out=[];
  for(const item of members){
   const name=safe(item.path),key=name.normalize('NFC').toLowerCase(),body=bytes(item.body),id=hash(body);
   for(const prior of keys.keys())if(prior===key||prior.startsWith(key+'/')||key.startsWith(prior+'/'))fail('Portable publication path collision: '+name);
   keys.set(key,name);out.push({path:name,body,...id});
  }
  out.sort((a,b)=>a.path.localeCompare(b.path,'en'));
  const complete=out.findIndex(x=>x.path===completionPath);
  if(complete<0)fail(completionPath==='complete-source.json'?'Publication requires the complete original source bank':'Publication requires its complete final member: '+completionPath);
  out.push(...out.splice(complete,1));return out;
 }
 async function checkOutput(output,members){
  if(!await stat(output))return;await dir(output);
  const files=new Map(members.map(x=>[x.path,x])),dirs=new Set();
  for(const x of members){const parts=x.path.split('/');for(let i=1;i<parts.length;i++)dirs.add(parts.slice(0,i).join('/'));}
  async function visit(parent,prefix=''){
   for(const entry of await fs.readdir(parent,{withFileTypes:true})){
    const name=prefix+entry.name,target=path.join(parent,entry.name);
    if(entry.isDirectory()&&!entry.isSymbolicLink()){if(!dirs.has(name))fail('Unplanned publication directory: '+name);await visit(target,name+'/');}
    else{if(!files.has(name))fail('Unplanned publication member: '+name);await exact(target,files.get(name).body);}
   }
  }
  await visit(output);
 }
 async function open({output,binding,recordedAt,completionPath='complete-source.json'}){
  safe(completionPath);
  if(typeof output!=='string'||!path.isAbsolute(output)||path.dirname(output)===output)fail('Use an absolute named publication output');
  safe(path.basename(output));await ancestors(path.dirname(output));
  const state=output+'.lead-delivery-state',bindingBody=json(binding),bindingID=hash(bindingBody);
  await mkdir(state);
  const ownerPath=path.join(state,'operation.json');
  if(!await stat(ownerPath)){
   for(const entry of await fs.readdir(state,{withFileTypes:true}))if(!/^\.owner\.[A-Za-z0-9-]+\.stage$/.test(entry.name)||!entry.isFile()||entry.isSymbolicLink())fail('Publication state has no original operation owner');
   const candidate={schema:'lead-source.publication-owner.v1',output,binding:bindingID,recorded_at:recordedAt,...(completionPath==='complete-source.json'?{}:{completion_path:completionPath})};
   if(typeof recordedAt!=='string'||!Number.isFinite(Date.parse(recordedAt)))fail('Publication recorded_at must be an ISO date');
   await atomic(ownerPath,bytes(json(candidate)),state,'owner',true);
  }
  const owner=await readJSON(ownerPath);
  if(owner.schema!=='lead-source.publication-owner.v1'||owner.output!==output||(owner.completion_path||'complete-source.json')!==completionPath||owner.binding?.sha256!==bindingID.sha256||owner.binding?.bytes!==bindingID.bytes||typeof owner.recorded_at!=='string'||!Number.isFinite(Date.parse(owner.recorded_at)))fail('Existing publication belongs to a different original input or tool edition');
  const staging=path.join(state,'stages');await mkdir(staging);
  return {
   recorded_at:owner.recorded_at,state_directory:state,
   async publish(inputMembers){
    const members=planMembers(inputMembers,completionPath);
    const plan={schema:'lead-source.publication-plan.v1',owner,files:members.map(x=>({path:x.path,bytes:x.bytes,sha256:x.sha256,content_base64:x.body.toString('base64')}))};
    // Check all existing destination members before writing the output tree.
    await checkOutput(output,members);
    await atomic(path.join(state,'plan.json'),bytes(json(plan)),state,'plan');
    await mkdir(output);
    for(const member of members){
     let parent=output;const parts=member.path.split('/');
     for(const part of parts.slice(0,-1)){parent=path.join(parent,part);await mkdir(parent);}
     await atomic(path.join(parent,parts.at(-1)),member.body,staging);
    }
    await checkOutput(output,members);for(const member of members)await exact(path.join(output,member.path),member.body);
    const complete=members.find(x=>x.path===completionPath);
    const receipt={schema:'lead-source.publication-complete.v1',output,binding:bindingID,recorded_at:owner.recorded_at,files:members.length,...(completionPath==='complete-source.json'?{source:{bytes:complete.bytes,sha256:complete.sha256}}:{completion:{path:completionPath,bytes:complete.bytes,sha256:complete.sha256}})};
    await atomic(path.join(state,'completed.json'),bytes(json(receipt)),state,'completed');return receipt;
   }
  };
 }
 return {open};
}
module.exports={createPublication};
