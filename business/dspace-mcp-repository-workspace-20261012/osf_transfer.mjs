import fs from 'node:fs';
import path from 'node:path';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip,createGunzip,inflateSync} from 'node:zlib';
import {createHash,randomUUID} from 'node:crypto';
import {Store} from './store.mjs';
import {DatabaseSync} from 'node:sqlite';
import {sourceHash,problem,copy} from './osf_source.mjs';

export const OSF_ARCHIVE_SCHEMA='osf-dspace-transition-archive/v1';
const decode=v=>JSON.parse(inflateSync(v).toString('utf8'));
function strings(value,accept){if(typeof value==='string'){accept(value);return;}if(Array.isArray(value)){for(const x of value)strings(x,accept);return;}if(value&&typeof value==='object')for(const x of Object.values(value))strings(x,accept);}
export function freezeReceivingRecords(store,seeds,{operationId,draftIds=[]}={}){
 const all=store.db.prepare('SELECT kind,id,summary,data FROM records ORDER BY kind,id').all();
 const rows=new Map(),byId=new Map();
 for(const row of all){if(row.kind==='osf_deliveries')continue;if(row.kind==='osf_drafts'&&!draftIds.includes(row.id))continue;
  const key=row.kind+'\0'+row.id,value={kind:row.kind,id:row.id,summary:JSON.parse(row.summary),value:decode(row.data)};rows.set(key,value);const list=byId.get(row.id)??[];list.push(key);byId.set(row.id,list);
 }
 const selected=new Set(),queue=[];
 const add=value=>{for(const key of byId.get(value)??[])if(!selected.has(key)){selected.add(key);queue.push(key);}};
 for(const seed of seeds)strings(seed,add);draftIds.forEach(add);
 function walk(){while(queue.length){const row=rows.get(queue.shift());strings(row.value,add);}}
 walk();
 // Include the original completed operation receipts that created the selected records.
 for(const [key,row]of rows)if(row.kind==='operations'&&row.id!==operationId){let relevant=false;strings(row.value.result??row.value.osf_result,x=>{if((byId.get(x)??[]).some(k=>selected.has(k)))relevant=true;});if(relevant)add(row.id);}
 walk();
 const records=[...selected].map(k=>copy(rows.get(k))).sort((a,b)=>a.kind.localeCompare(b.kind)||a.id.localeCompare(b.id));
 const blobNames=new Set(store.db.prepare('SELECT sha FROM blobs').all().map(r=>r.sha)),blobs=new Set();
 for(const row of records)strings(row.value,v=>{if(blobNames.has(v))blobs.add(v);});
 const descriptors=[...blobs].sort().map(sha=>{const row=store.db.prepare('SELECT size FROM blobs WHERE sha=?').get(sha);return {sha256:sha,bytes:row.size};});
 return {schema:'osf-selected-workspace/v1',revision:store.revision(),selected_profile_id:store.meta('selected_profile_id'),tools:copy(store.meta('tools')??[]),records,blobs:descriptors};
}
function verifySnapshot(snapshot){
 if(snapshot?.schema!=='osf-selected-workspace/v1'||!Number.isInteger(snapshot.revision)||!Array.isArray(snapshot.records)||!Array.isArray(snapshot.blobs))problem('OSF_HANDOVER_SNAPSHOT','The frozen selected-workspace snapshot is invalid.');
 const seen=new Set();for(const row of snapshot.records){const key=row.kind+'\0'+row.id;if(seen.has(key)||row.value?.id!==row.id||row.kind==='osf_deliveries')problem('OSF_HANDOVER_ID','Frozen original record identities differ.');seen.add(key);}
 const hashes=new Set();for(const b of snapshot.blobs){if(!/^[a-f0-9]{64}$/.test(b.sha256)||!Number.isSafeInteger(b.bytes)||b.bytes<0||hashes.has(b.sha256))problem('OSF_HANDOVER_BLOB','An original frozen source-byte identity differs.');hashes.add(b.sha256);}
 return snapshot;
}
function durableDirectory(directory){
 if(fs.existsSync(directory))return;
 durableDirectory(path.dirname(directory));fs.mkdirSync(directory,{mode:0o700});const fd=fs.openSync(path.dirname(directory),'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
async function fileDigest(filename){const h=createHash('sha256');let bytes=0;for await(const b of fs.createReadStream(filename)){h.update(b);bytes+=b.length;}return {sha256:h.digest('hex'),bytes};}
function durableWrite(filename,bytes){const fd=fs.openSync(filename,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}const parent=fs.openSync(path.dirname(filename),'r');try{fs.fsyncSync(parent);}finally{fs.closeSync(parent);}}
function tarHeader(name,size){
 if(!/^[A-Za-z0-9._/-]+$/.test(name)||Buffer.byteLength(name)>100||name.startsWith('/')||name.split('/').some(x=>x==='..'||x==='.'||!x)||!Number.isSafeInteger(size)||size<0)problem('OSF_ARCHIVE_PATH','An export member is invalid.');
 const b=Buffer.alloc(512),put=(v,start,width)=>b.write(v,start,width,'ascii'),oct=(v,start,width)=>put(v.toString(8).padStart(width-1,'0')+'\0',start,width);
 put(name,0,100);oct(0o600,100,8);oct(0,108,8);oct(0,116,8);oct(size,124,12);oct(0,136,12);b.fill(32,148,156);put('0',156,1);put('ustar\0',257,6);put('00',263,2);let sum=0;for(const n of b)sum+=n;put(sum.toString(8).padStart(6,'0')+'\0 ',148,8);return b;
}
async function* tarEntries(entries){
 for(const entry of entries){yield tarHeader(entry.path,entry.bytes);let count=0;const h=createHash('sha256');
  if(entry.filename){for await(const b of fs.createReadStream(entry.filename)){count+=b.length;h.update(b);yield b;}}
  else {const bytes=entry.data??entry.load();count=bytes.length;h.update(bytes);yield bytes;}
  if(count!==entry.bytes||h.digest('hex')!==entry.sha256)problem('OSF_EXPORT_CHANGED','An original export member changed during streaming.');
  const padding=(512-count%512)%512;if(padding)yield Buffer.alloc(padding);
 }
 yield Buffer.alloc(1024);
}
export async function exportTransition(workspace,deliveryId){
 const delivery=workspace.store.get('osf_deliveries',deliveryId),{manifest_sha256,...logical}=delivery;
 if(sourceHash(logical)!==manifest_sha256)problem('OSF_HANDOVER_CHANGED','The frozen transition manifest differs.');
 const snapshot=verifySnapshot(delivery.receiving_snapshot),parent=path.join(workspace.directory,'exports');durableDirectory(parent);
 const directory=fs.mkdtempSync(path.join(parent,'osf-transition-'));fs.chmodSync(directory,0o700);
 let selected;
 try{
  const selectedDir=path.join(directory,'workspace');selected=new Store(selectedDir);
  selected.tx(()=>{
   for(const row of snapshot.records)selected.put(row.kind,row.id,row.value,row.summary);
   for(const b of snapshot.blobs){const bytes=workspace.store.bytes(b.sha256);if(bytes.length!==b.bytes)problem('OSF_HANDOVER_SOURCE','The retained original file length differs.');selected.blob(bytes);}
   selected.put('osf_deliveries',delivery.id,delivery,{id:delivery.id,mapping_id:delivery.mapping_id,name:delivery.name,state:delivery.state,created_at:delivery.created_at,manifest_sha256});
   selected.meta('revision',snapshot.revision);selected.meta('selected_profile_id',delivery.mapping.profile_id??snapshot.selected_profile_id);selected.meta('tools',snapshot.tools);
   if(delivery.operation_id){const root=workspace.store.maybe('operations',delivery.operation_id);if(root?.osf_result?.delivery_id===delivery.id)selected.put('operations',root.id,root);}
  });
  const sqlite=selected.filename;selected.close();selected=null;
  const sqliteIdentity=await fileDigest(sqlite),manifestBytes=Buffer.from(JSON.stringify(delivery,null,2)+'\n');
  const entries=[{path:'repository-workspace.sqlite',filename:sqlite,...sqliteIdentity},{path:'transition.json',data:manifestBytes,sha256:sourceHash(manifestBytes),bytes:manifestBytes.length}];
  const names=new Set(entries.map(e=>e.path));
  for(const original of snapshot.blobs){const p='original-bytes/'+original.sha256+'.bin';if(names.has(p))continue;names.add(p);entries.push({path:p,sha256:original.sha256,bytes:original.bytes,load:()=>workspace.store.bytes(original.sha256)});}
  const index={schema:OSF_ARCHIVE_SCHEMA,delivery_id:delivery.id,delivery_sha256:manifest_sha256,created_at:delivery.created_at,source_id:delivery.source_id,source_sha256:delivery.source_sha256,mapping_id:delivery.mapping_id,files:entries.map(({path,sha256,bytes})=>({path,sha256,bytes})),original_files:delivery.source.files.map(f=>({...f,member:'original-bytes/'+f.sha256+'.bin'})),original_responses:delivery.source.documents.map(d=>({...d,member:d.sha256?'original-bytes/'+d.sha256+'.bin':null})),receiving:{workspace:'repository-workspace.sqlite',transition:'transition.json',instruction:'Restore repository-workspace.sqlite with the original Repository Workspace receiving action or use osf_cli.mjs receive on this complete archive. Source, mapping, reviews, native results and original operation IDs remain editable in the received workspace.'}};
  index.manifest_sha256=sourceHash(index);
  const bytes=Buffer.from(JSON.stringify(index,null,2)+'\n'),readme=Buffer.from('OSF to DSpace institutional handover\n\n'+delivery.name+'\n\n1. Preview the complete archive: node scripts/osf_cli.mjs preview --workspace NEW_DIRECTORY --source ORIGINAL.tar.gz --output receive-preview.json\n   Apply that exact preview: node scripts/osf_cli.mjs receive --workspace NEW_DIRECTORY --source ORIGINAL.tar.gz --preview receive-preview.json --actor NAME --request receive-original.json\n   Resume a lost response with: node scripts/osf_cli.mjs resume --workspace NEW_DIRECTORY --request receive-original.json\n2. The original browser archive receiving control also accepts this complete .tar.gz. It verifies every member before restoring the selected original SQLite workspace.\n3. Review transition.json for exact selected components, original file paths/versions, contributor and rights decisions, native record/file identifiers, and any retained exceptions.\n4. Public OSF URLs and DOIs remain original identifiers. Request an OSF administrator redirect only after institutional acceptance, using the publisher process recorded in the manifest.\n\nOriginal source byte filenames are hashes; manifest.json maps them back to every original URL, path, response and file version. Values and bytes are retained unchanged.\n');
  const readmeEntry={path:'START_HERE.txt',data:readme,sha256:sourceHash(readme),bytes:readme.length};index.files.push({path:readmeEntry.path,sha256:readmeEntry.sha256,bytes:readmeEntry.bytes});delete index.manifest_sha256;index.manifest_sha256=sourceHash(index);
  const finalManifest=Buffer.from(JSON.stringify(index,null,2)+'\n');
  const target=path.join(directory,'OSF_DSpace_Transition_'+delivery.id+'.tar.gz');
  await pipeline(Readable.from(tarEntries([{path:'manifest.json',data:finalManifest,sha256:sourceHash(finalManifest),bytes:finalManifest.length},...entries,readmeEntry])),createGzip({level:6}),fs.createWriteStream(target,{flags:'wx',mode:0o600}));
  const fd=fs.openSync(target,'r');try{fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  return {path:target,filename:path.basename(target),bytes:fs.statSync(target).size,contentType:'application/gzip',temporary:true,cleanup_directory:directory,manifest_sha256:index.manifest_sha256};
 }catch(error){selected?.close();fs.rmSync(directory,{recursive:true,force:true});throw error;}
}
async function* gzipChunks(filename){const input=fs.createReadStream(filename),gunzip=createGunzip();input.on('error',error=>gunzip.destroy(error));input.pipe(gunzip);try{for await(const b of gunzip)yield b;}finally{input.destroy();gunzip.destroy();}}
async function readPrefix(filename,limit=512){let out=Buffer.alloc(0);for await(const b of gzipChunks(filename)){out=Buffer.concat([out,b.subarray(0,Math.max(0,limit-out.length))]);if(out.length>=limit)break;}return out;}
export async function isTransitionArchive(filename){const fd=fs.openSync(filename,'r'),magic=Buffer.alloc(2);try{fs.readSync(fd,magic);}finally{fs.closeSync(fd);}if(magic[0]!==0x1f||magic[1]!==0x8b)return false;const head=await readPrefix(filename);return head.length===512&&head.subarray(0,100).toString('ascii').split('\0')[0]==='manifest.json'&&head.subarray(257,263).toString('ascii')==='ustar\0';}
function parseHeader(header){
 if(header.every(v=>v===0))return null;
 const number=(start,width)=>{const s=header.subarray(start,start+width).toString('ascii').replace(/\0.*$/,'').trim();if(!/^[0-7]+$/.test(s))problem('OSF_ARCHIVE_HEADER','Archive numeric metadata is invalid.');const n=parseInt(s,8);if(!Number.isSafeInteger(n)||n<0)problem('OSF_ARCHIVE_HEADER','Archive member size is invalid.');return n;};
 const expected=number(148,8),copyHeader=Buffer.from(header);copyHeader.fill(32,148,156);let sum=0;for(const n of copyHeader)sum+=n;if(sum!==expected)problem('OSF_ARCHIVE_HEADER','The original archive header checksum differs.');
 const name=header.subarray(0,100).toString('ascii').split('\0')[0],type=header[156];
 if(![0,48].includes(type)||!name||name.startsWith('/')||name.split('/').some(v=>!v||v==='.'||v==='..')||!/^[A-Za-z0-9._/-]+$/.test(name)||header.subarray(157,257).some(v=>v!==0)||header.subarray(345,500).some(v=>v!==0))problem('OSF_ARCHIVE_MEMBER','Only the declared original regular-file members are accepted.');
 return {path:name,bytes:number(124,12)};
}
export async function receiveTransitionArchive(filename,parent){
 durableDirectory(parent);const directory=fs.mkdtempSync(path.join(parent,'osf-receive-'));fs.chmodSync(directory,0o700);
 let buffer=Buffer.alloc(0),member=null,remaining=0,padding=0,fd=null,hash=null,index=null,manifestChunks=[],zeroBlocks=0;
 const seen=new Set(),received=new Map();
 function finish(){
  if(fd!==null){fs.fsyncSync(fd);fs.closeSync(fd);fd=null;}
  const sha256=hash.digest('hex');
  if(member.path==='manifest.json'){
   const bytes=Buffer.concat(manifestChunks);manifestChunks=[];try{index=JSON.parse(bytes.toString('utf8'));}catch{problem('OSF_ARCHIVE_MANIFEST','The complete archive manifest is not JSON.');}
   const {manifest_sha256,...body}=index;if(index.schema!==OSF_ARCHIVE_SCHEMA||sourceHash(body)!==manifest_sha256||!Array.isArray(index.files))problem('OSF_ARCHIVE_MANIFEST','The original archive manifest differs.');
   const paths=new Set();for(const f of index.files){if(typeof f.path!=='string'||paths.has(f.path)||!/^[a-f0-9]{64}$/.test(f.sha256)||!Number.isSafeInteger(f.bytes)||f.bytes<0)problem('OSF_ARCHIVE_MANIFEST','The original file manifest is invalid.');paths.add(f.path);}
   if(!paths.has('repository-workspace.sqlite')||!paths.has('transition.json'))problem('OSF_ARCHIVE_MANIFEST','The complete original workspace and transition record are required.');
  }else {
   const expected=index.files.find(f=>f.path===member.path);if(expected.sha256!==sha256)problem('OSF_ARCHIVE_DIGEST','An original received member digest differs.');
   received.set(member.path,{path:path.join(directory,member.path),sha256,bytes:member.bytes});
  }
  member=null;hash=null;
 }
 try{
  for await(const chunk of gzipChunks(filename)){
   buffer=buffer.length?Buffer.concat([buffer,chunk]):Buffer.from(chunk);
   for(;;){
    if(member){
     const length=Math.min(remaining,buffer.length);if(!length)break;const part=buffer.subarray(0,length);hash.update(part);if(fd!==null){let written=0;while(written<part.length)written+=fs.writeSync(fd,part,written,part.length-written);}else manifestChunks.push(Buffer.from(part));buffer=buffer.subarray(length);remaining-=length;if(remaining===0)finish();else break;
    }
    if(padding){if(buffer.length<padding)break;if(buffer.subarray(0,padding).some(v=>v!==0))problem('OSF_ARCHIVE_PADDING','Original archive padding is invalid.');buffer=buffer.subarray(padding);padding=0;}
    if(buffer.length<512)break;
    const next=parseHeader(buffer.subarray(0,512));buffer=buffer.subarray(512);
    if(!next){zeroBlocks++;continue;}
    if(zeroBlocks)problem('OSF_ARCHIVE_TRAILING','The archive contains members after its end marker.');
    if(seen.has(next.path))problem('OSF_ARCHIVE_DUPLICATE','The same original member occurs twice.');seen.add(next.path);
    if(!index){if(next.path!=='manifest.json'||next.bytes>128*1024*1024)problem('OSF_ARCHIVE_MANIFEST','The first member must be the complete manifest within the 128 MiB metadata envelope.');}
    else {const expected=index.files.find(f=>f.path===next.path);if(!expected||expected.bytes!==next.bytes)problem('OSF_ARCHIVE_MEMBER','The received member differs from the declared original file.');const target=path.join(directory,next.path);durableDirectory(path.dirname(target));fd=fs.openSync(target,'wx',0o600);}
    member=next;remaining=next.bytes;padding=(512-next.bytes%512)%512;hash=createHash('sha256');if(!remaining)finish();
   }
  }
  if(member||padding||buffer.length||zeroBlocks<2||!index||received.size!==index.files.length)problem('OSF_ARCHIVE_INCOMPLETE','Receive the complete original archive, including every declared member.');
  const transition=JSON.parse(fs.readFileSync(received.get('transition.json').path,'utf8')),{manifest_sha256,...payload}=transition;
  if(sourceHash(payload)!==manifest_sha256||manifest_sha256!==index.delivery_sha256||transition.id!==index.delivery_id)problem('OSF_ARCHIVE_TRANSITION','The frozen transition record differs from the selected archive.');
  verifySnapshot(transition.receiving_snapshot);
  const required=new Set(transition.receiving_snapshot.blobs.map(b=>'original-bytes/'+b.sha256+'.bin'));for(const p of required)if(!received.has(p))problem('OSF_ARCHIVE_SOURCE','The complete original source bytes are missing.');
  verifyReceivedWorkspace(received.get('repository-workspace.sqlite').path,transition);
  return {directory,sqlite:received.get('repository-workspace.sqlite').path,manifest:index,transition,files:received.size,cleanup(){fs.rmSync(directory,{recursive:true,force:true});}};
 }catch(error){if(fd!==null)fs.closeSync(fd);fs.rmSync(directory,{recursive:true,force:true});throw error;}
}

function verifyReceivedWorkspace(filename,transition){
 const db=new DatabaseSync(filename,{readOnly:true,allowExtension:false});try{
  db.exec('PRAGMA trusted_schema=OFF; PRAGMA query_only=ON; BEGIN;');
  const expected=new Map(transition.receiving_snapshot.records.map(r=>[r.kind+'\0'+r.id,r]));
  const observed=db.prepare('SELECT kind,id,summary,data FROM records').all();
  for(const row of observed){
   const value=decode(row.data),key=row.kind+'\0'+row.id;
   if(row.kind==='osf_deliveries'&&row.id===transition.id){if(sourceHash(value)!==sourceHash(transition))problem('OSF_ARCHIVE_WORKSPACE','The native workspace contains a different frozen transition.');continue;}
   if(row.kind==='operations'&&row.id===transition.operation_id){if(value.osf_result?.delivery_id!==transition.id||value.osf_result?.manifest_sha256!==transition.manifest_sha256)problem('OSF_ARCHIVE_OPERATION','The original handover receipt differs.');continue;}
   const original=expected.get(key);if(!original||sourceHash(original.value)!==sourceHash(value)||sourceHash(original.summary)!==sourceHash(JSON.parse(row.summary)))problem('OSF_ARCHIVE_WORKSPACE','The complete native record differs from the frozen selected workspace.');
   expected.delete(key);
  }
  if(expected.size)problem('OSF_ARCHIVE_WORKSPACE','An original frozen native record is absent.');
  const wanted=new Map(transition.receiving_snapshot.blobs.map(b=>[b.sha256,b.bytes]));
  for(const row of db.prepare('SELECT sha,size FROM blobs').iterate()){if(wanted.get(row.sha)!==row.size)problem('OSF_ARCHIVE_SOURCE','The original native source-byte inventory differs.');wanted.delete(row.sha);}
  if(wanted.size)problem('OSF_ARCHIVE_SOURCE','An original source body is absent from the native workspace.');
 }finally{db.close();}
}
