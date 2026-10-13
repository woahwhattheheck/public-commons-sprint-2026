/** Private durable file journal for native source transfers. Node 20+. MIT. */
import fs from "node:fs/promises";
import path from "node:path";
import {randomBytes,createHash} from "node:crypto";
import os from "node:os";
export async function openSourceTransferJournal(directory) {
  const root=path.resolve(directory);
  await fs.mkdir(root,{recursive:true,mode:0o700});
  const dir=await fs.lstat(root);
  if(!dir.isDirectory()||dir.isSymbolicLink())throw new Error("JOURNAL_DIRECTORY_REQUIRED");
  if(process.platform!=="win32"&&(dir.mode&0o077))throw new Error("JOURNAL_DIRECTORY_MUST_BE_PRIVATE_0700");
  const name=key=>{
    if(!/^native-source-transfer:[0-9a-f]{64}$/.test(key))throw new Error("INVALID_JOURNAL_KEY");
    return key.slice(key.indexOf(":")+1);
  };
  async function read(key) {
    const file=path.join(root,name(key)+".json");
    let stat;try{stat=await fs.lstat(file);}catch(e){if(e.code==="ENOENT")return null;throw e;}
    if(!stat.isFile()||stat.isSymbolicLink()||stat.size>128*1024*1024)throw new Error("INVALID_JOURNAL_FILE");
    const record=JSON.parse(await fs.readFile(file,"utf8"));
    if(record.key!==key||!Number.isSafeInteger(record.revision)||record.revision<1)throw new Error("INVALID_JOURNAL_RECORD");
    return record;
  }
  async function syncRoot(){const d=await fs.open(root,"r");try{await d.sync();}finally{await d.close();}}
  async function inspectLock(key){
    const lock=path.join(root,name(key)+".lock");
    let raw;try{raw=await fs.readFile(lock);}catch(e){if(e.code==="ENOENT")return null;throw e;}
    const record=JSON.parse(raw.toString("utf8")),sha256=createHash("sha256").update(raw).digest("hex");
    if(record.key!==key||!Number.isSafeInteger(record.pid)||record.pid<=0||!record.hostname)throw new Error("INVALID_LOCK_OWNER");
    let alive=null;
    if(record.hostname===os.hostname()){try{process.kill(record.pid,0);alive=true;}catch(e){if(e.code==="ESRCH")alive=false;else if(e.code==="EPERM")alive=true;else throw e;}}
    return {path:lock,sha256,record,same_host:record.hostname===os.hostname(),owner_alive:alive};
  }
  return {
    load:read,
    inspectLock,
    async recoverLock(key,{expected_sha256,confirm_quiescent}){
      if(confirm_quiescent!==true)throw new Error("STOP_ALL_JOURNAL_CLIENTS_BEFORE_LOCK_RECOVERY");
      const observed=await inspectLock(key);
      if(!observed)throw new Error("LOCK_ALREADY_ABSENT");
      if(observed.sha256!==expected_sha256)throw new Error("LOCK_CHANGED");
      if(!observed.same_host||observed.owner_alive!==false)throw new Error("LOCK_OWNER_NOT_PROVEN_DEAD_ON_THIS_HOST");
      // Explicit maintenance while all journal clients are stopped; never an age-based lease steal.
      const check=await inspectLock(key);
      if(!check||check.sha256!==expected_sha256||check.owner_alive!==false)throw new Error("LOCK_CHANGED");
      const retained=path.join(root,"recovered-"+name(key)+"-"+randomBytes(8).toString("hex")+".json");
      await fs.rename(observed.path,retained);await syncRoot();
      return {state:"orphan_lock_preserved",retained,original_lock_sha256:expected_sha256};
    },
    async compareAndSwap(key,expectedRevision,next) {
      const stem=name(key),lock=path.join(root,stem+".lock"),target=path.join(root,stem+".json");
      let guard;
      try{guard=await fs.open(lock,"wx",0o600);}catch(e){if(e.code==="EEXIST")return false;throw e;}
      let temp=null;
      try{
        await guard.writeFile(JSON.stringify({pid:process.pid,hostname:os.hostname(),created_at:new Date().toISOString(),key})+"\n");
        await guard.sync();
        const previous=await read(key);
        if((previous?.revision??null)!==expectedRevision)return false;
        if(next.key!==key||next.revision!==(expectedRevision??0)+1)throw new Error("INVALID_JOURNAL_SUCCESSOR");
        temp=path.join(root,"."+stem+"."+randomBytes(12).toString("hex")+".partial");
        const file=await fs.open(temp,"wx",0o600);
        try{await file.writeFile(JSON.stringify(next)+"\n","utf8");await file.sync();}finally{await file.close();}
        // The exclusive lock owns this one record. Atomic replacement preserves old/new whole snapshots.
        await fs.rename(temp,target);temp=null;await syncRoot();
        return true;
      }finally{
        if(temp)await fs.unlink(temp).catch(()=>{});
        await guard.close();await fs.unlink(lock);await syncRoot();
      }
    }
  };
}
