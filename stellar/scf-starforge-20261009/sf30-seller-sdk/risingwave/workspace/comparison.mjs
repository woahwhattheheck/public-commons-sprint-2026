// MIT. Complete deterministic differences between two retained native editions.
import { open, lstat, link, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { DatabaseSync } from 'node:sqlite';
import { acquireWorkspace, privateDirectory, readPrivate, readJson, createFile, atomicJson,
  bytes, digest, fault, syncDirectory } from '../../postgres/publisher/files.mjs';

const SCHEMA='stellar-forge.risingwave-capture-comparison.v1';
export const COMPARISON_FILES=Object.freeze({added:'added.ndjson',removed:'removed.ndjson',changed:'changed.ndjson',manifest:'comparison.json'});
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const stamp=()=>new Date().toISOString();
async function exists(path){try{await lstat(path);return true;}catch(error){if(error.code==='ENOENT')return false;throw error;}}
async function remove(path){try{await unlink(path);}catch(error){if(error.code!=='ENOENT')throw error;}}
const identity=value=>[value.dev,value.ino,value.size,value.mtimeMs,value.ctimeMs].join(':');
async function checkedFile(directory,name,descriptor,cache){
  if(COMPARISON_FILES[name]!==descriptor?.path||!Number.isSafeInteger(descriptor.bytes)||descriptor.bytes<0||!/^[a-f0-9]{64}$/.test(descriptor.sha256))throw fault('COMPARISON_FILE_INVALID');
  const path=join(directory,descriptor.path),handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const info=await handle.stat(),observed=identity(info),cacheKey=path+':'+descriptor.sha256;
    if(!info.isFile()||info.mode&0o077||info.size!==descriptor.bytes)throw fault('COMPARISON_FILE_CHANGED');
    if(cache?.get(cacheKey)!==observed){
      const hash=createHash('sha256');
      for await(const chunk of handle.createReadStream({start:0,autoClose:false}))hash.update(chunk);
      if(hash.digest('hex')!==descriptor.sha256||identity(await handle.stat())!==observed)throw fault('COMPARISON_FILE_CHANGED');
      cache?.set(cacheKey,observed);
    }
    return{handle,size:info.size,name:descriptor.path,sha256:descriptor.sha256,type:name==='manifest'?'application/json':'application/x-ndjson'};
  }catch(error){await handle.close();throw error;}
}
export async function readCaptureComparison(directory,{verify=true,cache}={}){
  await privateDirectory(directory);
  const raw=await readPrivate(join(directory,'comparison.json'),8388608),value=JSON.parse(raw);
  if(value.schema!==SCHEMA||value.complete!==true||!object(value.files)||!object(value.counts)||
      !Array.isArray(value.identity?.fields)||!value.identity.fields.length)throw fault('COMPARISON_MANIFEST_INVALID');
  for(const name of ['added','removed','changed']){
    const descriptor=value.files[name];
    if(descriptor?.path!==COMPARISON_FILES[name]||descriptor.rows!==value.counts[name])throw fault('COMPARISON_FILE_INVALID');
    if(verify){const file=await checkedFile(directory,name,descriptor,cache);await file.handle.close();}
  }
  return{...value,files:{...value.files,manifest:{path:'comparison.json',bytes:raw.length,sha256:digest(raw)}}};
}
export async function openComparisonFile(directory,name,{cache}={}){
  if(!Object.hasOwn(COMPARISON_FILES,name))throw fault('COMPARISON_FILE_NOT_FOUND');
  const result=await readCaptureComparison(directory,{verify:false});
  return checkedFile(directory,name,result.files[name],cache);
}
const queries={
  added:'SELECT r.key,r.payload AS "after" FROM rows r LEFT JOIN rows l ON l.side=0 AND l.key=r.key WHERE r.side=1 AND l.key IS NULL ORDER BY r.key',
  removed:'SELECT l.key,l.payload AS "before" FROM rows l LEFT JOIN rows r ON r.side=1 AND r.key=l.key WHERE l.side=0 AND r.key IS NULL ORDER BY l.key',
  changed:'SELECT l.key,l.payload AS "before",r.payload AS "after" FROM rows l JOIN rows r ON r.side=1 AND r.key=l.key WHERE l.side=0 AND l.hash<>r.hash ORDER BY l.key',
};
export async function createCaptureComparison({directory,id,before,after,keys,sampleLimit=100,openCaptureFile}){
  if(!Array.isArray(keys)||!keys.length||keys.some(name=>typeof name!=='string'||!name)||new Set(keys).size!==keys.length||
      !Number.isSafeInteger(sampleLimit)||sampleLimit<1||sampleLimit>1000)throw fault('CAPTURE_COMPARISON_INVALID');
  await privateDirectory(directory,true);const release=await acquireWorkspace(directory);
  let db=null;
  const selected=record=>({id:record.id,sourceHash:record.sourceHash,query:record.query,input:record.input,sha256:record.files.ndjson.sha256});
  const request={id,before:selected(before),after:selected(after),identity:{kind:'keyed',fields:keys},sampleLimit};
  const requestHash=digest(bytes(request)),dbPath=join(directory,'index.sqlite');
  let status;
  try{
    const path=join(directory,'request.json');
    if(await exists(path)){
      const original=await readJson(path,8388608);
      if(original.requestHash!==requestHash||digest(bytes(original.request))!==requestHash)throw fault('COMPARISON_REQUEST_CHANGED');
    }else{await createFile(path,bytes({schema:'stellar-forge.risingwave-comparison-request.v1',requestHash,request,createdAt:stamp()}));await syncDirectory(directory);}
    if(await exists(join(directory,'comparison.json'))){
      const retained=await readCaptureComparison(directory);
      if(retained.requestHash!==requestHash)throw fault('COMPARISON_REQUEST_CHANGED');
      return retained;
    }
    status=await exists(join(directory,'status.json'))?await readJson(join(directory,'status.json'),65536):{startedAt:stamp(),attempts:0};
    status={...status,id,requestHash,state:'INDEXING',attempts:status.attempts+1,updatedAt:stamp()};delete status.error;
    await atomicJson(directory,'status.json',status);
    for(const suffix of ['','-journal','-wal','-shm'])await remove(dbPath+suffix);
    db=new DatabaseSync(dbPath);db.exec('PRAGMA journal_mode=DELETE; PRAGMA temp_store=FILE; CREATE TABLE rows(side INTEGER,key TEXT,payload TEXT,hash TEXT,PRIMARY KEY(side,key));');
    const put=db.prepare('INSERT INTO rows VALUES(?,?,?,?)'),counts={before:0,after:0,added:0,removed:0,changed:0,unchanged:0};
    for(const [side,record]of [[0,before],[1,after]]){
      const file=await openCaptureFile(record.id,'ndjson');let count=0;
      try{
        db.exec('BEGIN');
        const lines=createInterface({input:file.handle.createReadStream({autoClose:false,start:0}),crlfDelay:Infinity});
        for await(const line of lines){
          if(!line)continue;const row=JSON.parse(line);
          if(!object(row)||keys.some(name=>!Object.hasOwn(row,name)||row[name]===null))throw fault('CAPTURE_KEY_NOT_FOUND');
          const rowKey=JSON.stringify(keys.map(name=>row[name])),payload=JSON.stringify(Object.fromEntries(Object.keys(row).sort().map(name=>[name,row[name]])));
          try{put.run(side,rowKey,payload,digest(Buffer.from(payload)));}
          catch(error){if(String(error.message).includes('UNIQUE'))throw fault('CAPTURE_KEY_NOT_UNIQUE','Use fields that identify one row in each edition.');throw error;}
          count++;if(count%1000===0){db.exec('COMMIT');db.exec('BEGIN');}
        }
        db.exec('COMMIT');counts[side===0?'before':'after']=count;
      }catch(error){try{db.exec('ROLLBACK');}catch{}throw error;}
      finally{await file.handle.close();}
    }
    counts.unchanged=Number(db.prepare('SELECT count(*) count FROM rows l JOIN rows r ON r.side=1 AND r.key=l.key WHERE l.side=0 AND l.hash=r.hash').get().count);
    status={...status,state:'EXPORTING',updatedAt:stamp()};await atomicJson(directory,'status.json',status);
    const files={},samples={added:[],removed:[],changed:[]};let sampledBytes=0;
    for(const[name,sql]of Object.entries(queries)){
      const partial=join(directory,COMPARISON_FILES[name]+'.partial');await remove(partial);
      const handle=await open(partial,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600),hash=createHash('sha256');
      let length=0,rowCount=0;
      try{
        for(const row of db.prepare(sql).iterate()){
          const value={key:JSON.parse(row.key),...(row.before?{before:JSON.parse(row.before)}:{}),...(row.after?{after:JSON.parse(row.after)}:{})};
          const raw=Buffer.from(JSON.stringify(value)+'\n');let offset=0;
          while(offset<raw.length){const written=await handle.write(raw,offset,raw.length-offset);if(!written.bytesWritten)throw fault('COMPARISON_WRITE_FAILED');offset+=written.bytesWritten;}
          hash.update(raw);length+=raw.length;rowCount++;
          if(samples[name].length<sampleLimit&&sampledBytes+raw.length<=1048576){samples[name].push(value);sampledBytes+=raw.length;}
        }await handle.sync();
      }finally{await handle.close();}
      const descriptor={path:COMPARISON_FILES[name],bytes:length,sha256:hash.digest('hex'),rows:rowCount},final=join(directory,descriptor.path);
      if(await exists(final)){const retained=await checkedFile(directory,name,descriptor);await retained.handle.close();}
      else await link(partial,final);
      await remove(partial);files[name]=descriptor;counts[name]=rowCount;
    }
    if(counts.before!==counts.removed+counts.changed+counts.unchanged||counts.after!==counts.added+counts.changed+counts.unchanged)throw fault('COMPARISON_ACCOUNTING_INVALID');
    const result={schema:SCHEMA,complete:true,...request,requestHash,comparedAt:stamp(),counts,files,
      sameSelection:before.sourceHash===after.sourceHash&&before.query===after.query&&digest(bytes(before.input))===digest(bytes(after.input)),
      sampleByteLimit:1048576,sampledBytes,...samples};
    await syncDirectory(directory);await createFile(join(directory,'comparison.json'),bytes(result));await syncDirectory(directory);
    await atomicJson(directory,'status.json',{...status,state:'COMPLETE',updatedAt:stamp(),completedAt:result.comparedAt,counts});
    return await readCaptureComparison(directory);
  }catch(error){
    if(status)await atomicJson(directory,'status.json',{...status,state:'FAILED',updatedAt:stamp(),error:{code:error.code??'COMPARISON_FAILED',message:error.code?error.message:'The complete comparison could not finish.'}}).catch(()=>{});
    throw error;
  }finally{
    try{db?.close();for(const suffix of ['','-journal','-wal','-shm'])await remove(dbPath+suffix);}
    finally{await release();}
  }
}
