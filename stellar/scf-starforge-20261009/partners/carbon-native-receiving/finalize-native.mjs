// MIT. Preserve a closed native receiving operation as a complete portable gzip/tar archive.
// Uses Node builtins, streams every original regular file, and never follows symbolic links.
import {constants,createWriteStream} from 'node:fs';
import {lstat,readdir,readlink,readFile,open,realpath,link,unlink,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join,relative,dirname,basename,sep,isAbsolute} from 'node:path';
import {Readable,Transform} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {createGzip} from 'node:zlib';
import {createHash,randomUUID} from 'node:crypto';

const need=(value,message)=>{if(!value)throw new Error(message);return value;};
const sha256=value=>createHash('sha256').update(value).digest('hex');
const inside=(root,path)=>{const value=relative(root,path);return value===''||(!value.startsWith('..'+sep)&&value!=='..'&&!isAbsolute(value));};
const portable=value=>{
  need(typeof value==='string'&&value&&!value.includes('\0')&&!value.includes('\\')&&!value.startsWith('/')&&
    value.split('/').every(part=>part&&part!=='.'&&part!=='..'),'Use a complete relative source path: '+String(value));
  return value;
};
const mtime=value=>{
  const negative=value<0n,n=negative?-value:value;
  return (negative?'-':'')+(n/1000000000n).toString()+'.'+(n%1000000000n).toString().padStart(9,'0');
};
const sameStat=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.mode===b.mode&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&a.ctimeNs===b.ctimeNs;
function paxRecord(key,value){
  const body=key+'='+String(value)+'\n',bytes=Buffer.byteLength(body);let size=bytes+3;
  for(;;){const next=bytes+String(size).length+1;if(next===size)return Buffer.from(String(size)+' '+body);size=next;}
}
function tarHeader({name,size=0n,mode=0o600n,uid=0n,gid=0n,modified=0n,type='0',linkTarget=''}){
  const header=Buffer.alloc(512);
  const text=(value,offset,length)=>{const bytes=Buffer.from(String(value),'utf8');need(bytes.length<=length,'A fixed tar header field is too long.');bytes.copy(header,offset);};
  const octal=(value,offset,length)=>{const body=BigInt(value).toString(8);need(body.length<length,'Use a PAX record for a large native tar field.');text(body.padStart(length-1,'0')+'\0',offset,length);};
  text(name,0,100);octal(mode&0o7777n,100,8);octal(uid,108,8);octal(gid,116,8);octal(size,124,12);octal(modified<0n?0n:modified,136,12);
  header.fill(32,148,156);text(type,156,1);text(linkTarget,157,100);text('ustar\0',257,6);text('00',263,2);
  let sum=0;for(const byte of header)sum+=byte;text(sum.toString(8).padStart(6,'0')+'\0 ',148,8);return header;
}
const padding=size=>{const remainder=Number(BigInt(size)%512n);return remainder?Buffer.alloc(512-remainder):null;};

/**
 * Close Chromium and all original/received services before calling.
 * sourceManifestPath defaults to sourceRoot/receiving/source-manifest.json.
 * The manifest's complete files[] are checked, and the whole bootstrap-owned source root is archived.
 * parcelFiles may additionally select retained original JSON/text parts outside sourceRoot.
 * {path,archiveName} parcel entries retain the exact original bytes under source-parcels/.
 * Write the final completed receiving.json before this call; the archive descriptor is a sibling file.
 */
export async function finalizeNativeReceiving({
  outputDirectory,sourceRoot,archivePath,sourceManifestPath,parcelFiles=[],operation,createdAt=new Date().toISOString()
}={}){
  const output=await realpath(resolve(need(outputDirectory,'Select the closed original output directory.')));
  const source=await realpath(resolve(need(sourceRoot,'Select the exact original native source root.')));
  const target=resolve(archivePath||output+'.tar.gz'),inventoryPath=target+'.json';
  need(!inside(output,target)&&!inside(output,inventoryPath)&&!inside(source,target)&&!inside(source,inventoryPath),
    'Place the complete archive and its descriptor outside both the archived output and bootstrap-owned source directories.');
  await mkdir(dirname(target),{recursive:true,mode:0o700});
  for(const path of [target,inventoryPath])try{await lstat(path);throw new Error('Preserve the existing native archive or descriptor: '+path);}catch(error){if(error.code!=='ENOENT')throw error;}
  const manifestPath=resolve(sourceManifestPath||join(source,'receiving/source-manifest.json'));
  need(inside(source,manifestPath),'The source manifest must belong to the selected source root.');
  const manifestBody=await readFile(manifestPath),manifest=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(manifestBody));
  need(Array.isArray(manifest.files)&&manifest.files.length,'The exact original source manifest needs its complete files array.');
  need(Number.isFinite(Date.parse(createdAt)),'Retain a valid original receiving timestamp.');
  const entries=[],byName=new Map(),expected=new Map();
  const sourceMetadata={path:relative(source,manifestPath).split(sep).join('/'),bytes:manifestBody.length,sha256:sha256(manifestBody),files:manifest.files.length};
  for(const file of manifest.files){const path=portable(file.path);need(!expected.has(path),'The original source manifest repeats '+path);expected.set(path,file);}
  async function add(path,name,{sourceExpected,walk=false,outputMember=false}={}){
    portable(name.replace(/\/$/,''));const original=await lstat(path,{bigint:true});
    const type=original.isDirectory()?'directory':original.isFile()?'file':original.isSymbolicLink()?'symlink':null;
    need(type,'Close the original process and resolve its transient special file before archiving: '+path);
    const normalized=type==='directory'?name.replace(/\/$/,'')+'/':name;
    const duplicate=byName.get(normalized);
    if(duplicate){need(duplicate.path===path,'Two different originals claim the same archive member: '+normalized);
      if(sourceExpected)duplicate.expected=sourceExpected;return duplicate;}
    const entry={path,name:normalized,type,stat:original,expected:sourceExpected||null};
    if(type==='symlink')entry.linkTarget=await readlink(path);
    entries.push(entry);byName.set(normalized,entry);
    if(type==='directory'&&walk){
      const children=await readdir(path);children.sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));entry.children=children;
      for(const child of children){
        const next=join(path,child);
        if(!outputMember&&inside(output,next))continue;
        need(resolve(next)!==target&&resolve(next)!==inventoryPath,'The selected source tree contains the archive destination.');
        await add(next,normalized+child,{walk:true,outputMember});
      }
    }
    return entry;
  }
  await add(output,'output',{walk:true,outputMember:true});
  // The caller selects its closed bootstrap-only source root, containing the exact parcel and runtime.
  for(const [name,file] of expected){
    const path=resolve(source,...name.split('/'));need(inside(source,path),'Original source path escapes its selected root.');
    await add(path,'source/'+name,{sourceExpected:file});
  }
  await add(manifestPath,'source/'+sourceMetadata.path);
  await add(source,'source',{walk:true});
  for(const item of parcelFiles){
    const path=resolve(typeof item==='string'?item:need(item?.path,'Retain each exact original source parcel path.'));
    const name=portable(typeof item==='string'?basename(path):(item.archiveName||basename(path)));
    const value=await add(path,'source-parcels/'+name);
    need(value.type==='file','Retain each original source parcel as a complete regular file.');
  }
  const partial=target+'.partial-'+randomUUID(),members=[],compressedHash=createHash('sha256');let compressedBytes=0,regularBytes=0;
  const checkpoint={schema:'stellar-forge.native-receiving-archive.v1',operation:operation||null,createdAt,
    outputDirectory:output,sourceRoot:source,archive:target,partial,sourceManifest:sourceMetadata,status:'writing',members};
  let index=0;
  function* headers(name,size,stat,type,linkTarget){
    const record=Buffer.concat([paxRecord('path',name),paxRecord('mtime',mtime(stat.mtimeNs)),paxRecord('uid',stat.uid),paxRecord('gid',stat.gid),
      ...(type==='0'?[paxRecord('size',size)]:[]),...(linkTarget!==undefined?[paxRecord('linkpath',linkTarget)]:[])]);
    const sequence=String(++index).padStart(10,'0');
    yield tarHeader({name:'PaxHeaders/'+sequence,size:BigInt(record.length),type:'x'});yield record;
    const extra=padding(record.length);if(extra)yield extra;
    yield tarHeader({name:'members/'+sequence+(type==='5'?'/':''),size:size>0o77777777777n?0n:size,mode:stat.mode,
      uid:stat.uid>0o7777777n?0n:stat.uid,gid:stat.gid>0o7777777n?0n:stat.gid,
      modified:stat.mtimeNs/1000000000n>0o77777777777n?0n:stat.mtimeNs/1000000000n,type});
  }
  async function* tar(){
    for(const entry of entries){
      const current=await lstat(entry.path,{bigint:true});
      need(sameStat(current,entry.stat),'The closed original changed before archiving: '+entry.path);
      const record={path:entry.name,type:entry.type,mode:Number(current.mode&0o7777n),uid:current.uid.toString(),gid:current.gid.toString(),
        mtime:mtime(current.mtimeNs),bytes:entry.type==='file'?current.size.toString():'0'};
      if(entry.type==='directory'){
        if(entry.children){const children=await readdir(entry.path);children.sort((a,b)=>Buffer.compare(Buffer.from(a),Buffer.from(b)));
          need(JSON.stringify(children)===JSON.stringify(entry.children),'The closed directory changed while archiving: '+entry.path);}
        yield* headers(entry.name,0n,current,'5');members.push(record);continue;
      }
      if(entry.type==='symlink'){
        const target=await readlink(entry.path);need(target===entry.linkTarget,'An original symbolic link changed during archiving.');
        record.linkTarget=target;const linkBytes=Buffer.from(target);record.sourceBytes=String(linkBytes.length);record.sha256=sha256(linkBytes);
        record.gitBlobSha1=createHash('sha1').update('blob '+linkBytes.length+'\0').update(linkBytes).digest('hex');
        if(entry.expected){
          if(entry.expected.bytes!==undefined)need(BigInt(entry.expected.bytes)===BigInt(linkBytes.length),'The original source link length changed: '+entry.name);
          if(entry.expected.gitBlobSha1)need(entry.expected.gitBlobSha1===record.gitBlobSha1,'The original source link identity changed: '+entry.name);
          if(entry.expected.sha256)need(entry.expected.sha256===record.sha256,'The original source link SHA256 changed: '+entry.name);
        }
        yield* headers(entry.name,0n,current,'2',target);members.push(record);continue;
      }
      const handle=await open(entry.path,constants.O_RDONLY|(constants.O_NOFOLLOW||0));let count=0n;
      const fileHash=createHash('sha256'),gitHash=createHash('sha1').update('blob '+current.size.toString()+'\0');
      try{
        need(sameStat(await handle.stat({bigint:true}),current),'The original regular file changed before it was opened: '+entry.path);
        yield* headers(entry.name,current.size,current,'0');
        for await(const chunk of handle.createReadStream({autoClose:false})){count+=BigInt(chunk.length);
          need(count<=current.size,'A closed original grew during archiving: '+entry.path);fileHash.update(chunk);gitHash.update(chunk);yield chunk;}
        need(count===current.size,'The original archive member was truncated: '+entry.path);
        need(sameStat(await handle.stat({bigint:true}),current),'The original bytes changed during archiving: '+entry.path);
      }finally{await handle.close();}
      record.sha256=fileHash.digest('hex');record.gitBlobSha1=gitHash.digest('hex');regularBytes+=Number(count);
      if(entry.expected){
        if(entry.expected.bytes!==undefined)need(BigInt(entry.expected.bytes)===count,'The original source byte count changed: '+entry.name);
        if(entry.expected.gitBlobSha1)need(entry.expected.gitBlobSha1===record.gitBlobSha1,'The original source Git identity changed: '+entry.name);
        if(entry.expected.sha256)need(entry.expected.sha256===record.sha256,'The original source SHA256 changed: '+entry.name);
      }
      const extra=padding(count);if(extra)yield extra;members.push(record);
    }
    // This embedded inventory identifies every original member. Its own identity appears in the sibling descriptor.
    const inventory={schema:'stellar-forge.native-receiving-members.v1',operation:operation||null,createdAt,
      sourceManifest:sourceMetadata,originalMembers:members.length,originalRegularBytes:regularBytes,members:members.map(row=>({...row}))};
    const body=Buffer.from(JSON.stringify(inventory,null,2)+'\n'),name='_delivery/ORIGINAL_MEMBERS.json';
    const stat={mode:0o600n,uid:0n,gid:0n,mtimeNs:BigInt(Date.parse(createdAt))*1000000n};
    yield* headers(name,BigInt(body.length),stat,'0');yield body;const extra=padding(body.length);if(extra)yield extra;
    members.push({path:name,type:'file',mode:0o600,uid:'0',gid:'0',mtime:mtime(stat.mtimeNs),bytes:String(body.length),
      sha256:sha256(body),gitBlobSha1:createHash('sha1').update('blob '+body.length+'\0').update(body).digest('hex'),generated:true});
    yield Buffer.alloc(1024);
  }
  try{
    const tap=new Transform({transform(chunk,encoding,callback){compressedHash.update(chunk);compressedBytes+=chunk.length;callback(null,chunk);}});
    await pipeline(Readable.from(tar(),{objectMode:false}),createGzip({level:6}),tap,createWriteStream(partial,{flags:'wx',mode:0o600}));
    const file=await open(partial,'r');try{await file.sync();need((await file.stat()).size===compressedBytes,'The compressed receiving archive is incomplete.');}finally{await file.close();}
    // link() publishes atomically without overwriting an existing original archive.
    await link(partial,target);await unlink(partial);
    Object.assign(checkpoint,{status:'complete',completedAt:new Date().toISOString(),bytes:compressedBytes,sha256:compressedHash.digest('hex'),
      memberCount:members.length,originalRegularBytes:regularBytes,inventoryPath,receiptPath:inventoryPath,
      manifestPath:inventoryPath,embeddedManifest:'_delivery/ORIGINAL_MEMBERS.json'});delete checkpoint.partial;
    await writeFile(inventoryPath,JSON.stringify(checkpoint,null,2)+'\n',{flag:'wx',mode:0o600});
    return checkpoint;
  }catch(error){
    Object.assign(checkpoint,{status:'interrupted',interruptedAt:new Date().toISOString(),error:{message:error.message,code:error.code||null},
      completedMembers:members.length,compressedBytes});
    const partialInventory=partial+'.json';
    try{await writeFile(partialInventory,JSON.stringify(checkpoint,null,2)+'\n',{flag:'wx',mode:0o600});}catch{}
    error.archiveCheckpoint={partial,inventory:partialInventory,completedMembers:members.length};throw error;
  }
}
