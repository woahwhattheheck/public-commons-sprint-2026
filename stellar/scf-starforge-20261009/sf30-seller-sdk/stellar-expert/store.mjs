// MIT. One private workspace writer, atomic retained state, immutable byte objects.
import {constants} from 'node:fs';
import {open,mkdir,realpath,lstat,rename,unlink,readFile,readdir,link} from 'node:fs/promises';
import {join,resolve,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {hashBytes,fault} from './provider.mjs';
export const jsonBytes = value => Buffer.from(JSON.stringify(value,null,2)+'\n');
export const stable = value => JSON.stringify(canonical(value));
function canonical(value) {
  return Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?
    Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])])):value;
}
export async function writeNew(path,bytes) {
  const f=await open(path,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|(constants.O_NOFOLLOW??0),0o600);
  try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}
}
export async function syncDir(path) {
  const f=await open(path,'r');try{await f.sync();}finally{await f.close();}
}
export async function atomicJSON(path,value) {
  const temp=path+'.'+randomUUID()+'.tmp';
  try{await writeNew(temp,jsonBytes(value));await rename(temp,path);await syncDir(dirname(path));}
  finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
}
export async function privateDirectory(path,{create=false}={}) {
  path=resolve(path);
  if(create)await mkdir(path,{recursive:true,mode:0o700});
  const s=await lstat(path);
  if(!s.isDirectory()||await realpath(path)!==path||(s.mode&0o077)||
     typeof process.getuid==='function'&&s.uid!==process.getuid())
    throw fault('STELLAR_PRIVATE_DIRECTORY','Use an owned, canonical private directory with mode0700.');
  return path;
}
export async function readOwned(path,max=16*1024*1024) {
  if(await realpath(path)!==resolve(path))throw fault('STELLAR_SOURCE_PATH_CHANGED','A retained path changed.',409);
  const f=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const before=await f.stat({bigint:true});
    if(!before.isFile()||before.size>BigInt(max)||(Number(before.mode)&0o077)||
      typeof process.getuid==='function'&&Number(before.uid)!==process.getuid())
      throw fault('STELLAR_PRIVATE_FILE','A retained file has changed type, ownership, size or access.',409);
    const b=await f.readFile(),after=await f.stat({bigint:true});
    if(BigInt(b.length)!==before.size||before.size!==after.size||before.mtimeNs!==after.mtimeNs||before.ctimeNs!==after.ctimeNs)
      throw fault('STELLAR_SOURCE_CHANGED','The retained file changed during reading.',409);
    return b;
  }finally{await f.close();}
}
async function acquireLease(path) {
  // Kernel flock belongs to the pipe-lived helper. Parent death closes stdin,
  // releasing the lock without a timeout-based stale-owner guess.
  const helper=spawn('flock',['--exclusive','--nonblock',path,process.execPath,'-e',
    "process.stdout.write('LOCKED\\n');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));"],
    {stdio:['pipe','pipe','pipe'],windowsHide:true});
  let observed=false,closed=false,errorText='';
  const ended=new Promise(done=>helper.once('exit',()=>{closed=true;done();}));
  await new Promise((yes,no)=>{
    helper.once('error',no);
    helper.stderr.on('data',c=>{errorText=(errorText+c).slice(-1000);});
    helper.stdout.on('data',c=>{if(String(c).includes('LOCKED')){observed=true;yes();}});
    helper.once('exit',code=>{if(!observed)no(fault('STELLAR_WORKSPACE_BUSY',
      code===1?'This workspace is open in another process. Use its printed session URL.':'The private workspace lock could not start.',409));});
  });
  return {assert(){if(closed)throw fault('STELLAR_WORKSPACE_LEASE_LOST','The private workspace writer has stopped.',503);},
    async close(){if(!closed)helper.stdin.end();await ended;}};
}
export async function openWorkspaceStore(directory) {
  const root=await privateDirectory(directory,{create:true});
  for(const name of ['objects','editions','datasets','releases','exports','receipts','responses'])
    await privateDirectory(join(root,name),{create:true});
  const lease=await acquireLease(join(root,'workspace.lock'));let state,tail=Promise.resolve(),closing=false;
  try{
    try{state=JSON.parse((await readOwned(join(root,'workspace.json'),64*1024*1024)).toString('utf8'));}
    catch(e){if(e.code!=='ENOENT')throw e;state={schema:'stellar-forge.stellar-expert-workspace.v1',workspaceId:randomUUID(),revision:0,
      createdAt:new Date().toISOString(),watchlist:[],captures:[],editionIds:[],selectedEditionId:null,datasets:[],releases:[],
      receipts:[],exports:[],annotations:[],operations:{}};await atomicJSON(join(root,'workspace.json'),state);}
    if(state.schema!=='stellar-forge.stellar-expert-workspace.v1'||!Number.isSafeInteger(state.revision)||!state.workspaceId)
      throw fault('STELLAR_WORKSPACE_SCHEMA','This directory contains another workspace format.',409);
  }catch(e){await lease.close();throw e;}
  const mutate=fn=>{
    const p=tail.then(async()=>{
      if(closing)throw fault('STELLAR_WORKSPACE_CLOSING','The workspace is closing.',503);
      lease.assert();const next=structuredClone(state),result=await fn(next);
      if(stable(next)===stable(state))return result;
      next.revision=state.revision+1;next.updatedAt=new Date().toISOString();
      await atomicJSON(join(root,'workspace.json'),next);state=next;return result;
    });tail=p.catch(()=>{});return p;
  };
  const immutable=async(path,bytes)=>{
    const temp=path+'.'+randomUUID()+'.tmp';
    try{
      await writeNew(temp,bytes);
      try{await link(temp,path);await syncDir(dirname(path));}
      catch(e){if(e.code!=='EEXIST')throw e;
        const existing=await readOwned(path,Math.max(bytes.length,16*1024*1024));
        if(!existing.equals(bytes))throw fault('STELLAR_IMMUTABLE_CHANGED','An immutable output differs from its retained operation.',409);}
    }finally{await unlink(temp).catch(e=>{if(e.code!=='ENOENT')throw e;});}
    return {bytes:bytes.length,sha256:hashBytes(bytes)};
  };
  return {
    root,read:()=>structuredClone(state),mutate,
    async putObject(bytes){const sha256=hashBytes(bytes);await immutable(join(root,'objects',sha256),bytes);return {sha256,bytes:bytes.length};},
    async object(sha256){if(!/^[a-f0-9]{64}$/.test(sha256??''))throw fault('STELLAR_SOURCE_ID','Unknown source object.');
      const bytes=await readOwned(join(root,'objects',sha256),256*1024*1024);if(hashBytes(bytes)!==sha256)throw fault('STELLAR_SOURCE_CHANGED','Source bytes differ from their saved hash.',409);return bytes;},
    async response(captureId,url){
      if(!/^[a-f0-9]{24}$/.test(captureId??''))throw fault('STELLAR_CAPTURE_ID','Unknown retained capture.');
      const path=join(root,'responses',captureId+'-'+hashBytes(Buffer.from(url))+'.json');
      try{
        const record=JSON.parse((await readOwned(path,1024*1024)).toString('utf8'));
        if(record.captureId!==captureId||record.requestUrl!==url||record.receipt.url!==url)
          throw fault('STELLAR_SOURCE_CHANGED','The saved response identity changed.',409);
        return record.receipt;
      }catch(e){if(e.code==='ENOENT')return null;throw e;}
    },
    async saveResponse(captureId,url,receipt){
      if(!/^[a-f0-9]{24}$/.test(captureId??'')||receipt.url!==url)
        throw fault('STELLAR_CAPTURE_ID','Unknown response or capture identity.');
      await atomicJSON(join(root,'responses',captureId+'-'+hashBytes(Buffer.from(url))+'.json'),
        {schema:'stellar-forge.stellar-expert-response-journal.v1',captureId,requestUrl:url,receipt});
    },
    async saveEdition(edition){const b=jsonBytes(edition);await immutable(join(root,'editions',edition.id+'.json'),b);return edition;},
    async edition(id){if(!/^[a-f0-9]{64}$/.test(id??''))throw fault('STELLAR_EDITION_ID','Choose a retained edition.');
      const b=await readOwned(join(root,'editions',id+'.json'));return JSON.parse(b.toString('utf8'));},
    immutable,
    async close(){if(closing)return;await tail;closing=true;await lease.close();}
  };
}
