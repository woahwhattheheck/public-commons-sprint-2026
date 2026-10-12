// MIT. Exact immutable UTF-8 files owned by the original GridFabric workspace.
import {constants,openSync,closeSync,writeFileSync,writeSync,readSync,readFileSync,fsyncSync,fstatSync,lstatSync,
  mkdirSync,renameSync,unlinkSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {TextDecoder} from 'node:util';

const ID=/^[0-9a-f]{64}$/;
const decoder=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
export const sha256Utf8=text=>{
  if(typeof text!=='string')throw Object.assign(new Error('Use the complete original UTF-8 text.'),{code:'GRIDFABRIC_FILE_TEXT'});
  const bytes=Buffer.from(text,'utf8');
  return {bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')};
};
function fail(code,message){return Object.assign(new Error(message),{code});}
function fsyncDirectory(path){const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY);try{fsyncSync(fd);}finally{closeSync(fd);}}
export function createGridFabricFiles({directory,assertHeld=()=>{},readOnly=false}) {
  const root=join(directory,'files');
  if(!readOnly)mkdirSync(root,{recursive:true,mode:0o700});
  const rootStat=lstatSync(root);
  if(!rootStat.isDirectory()||rootStat.isSymbolicLink()||(rootStat.mode&0o077))throw fail('GRIDFABRIC_FILE_DIRECTORY','Keep the original private immutable file directory.');
  const locate=id=>{
    if(!ID.test(id))throw fail('GRIDFABRIC_FILE_ID','Use an original SHA256 file identity.');
    return join(root,id.slice(0,2),id+'.utf8');
  };
  const readBytes=id=>{
    assertHeld();const path=locate(id),fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try {
      const before=fstatSync(fd);
      if(!before.isFile()||before.nlink!==1||(before.mode&0o077)||(typeof process.getuid==='function'&&before.uid!==process.getuid()))throw fail('GRIDFABRIC_FILE_TYPE','Keep the immutable original regular file.');
      const bytes=readFileSync(fd),after=fstatSync(fd),named=lstatSync(path);
      if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||before.ctimeMs!==after.ctimeMs||
          named.isSymbolicLink()||named.dev!==before.dev||named.ino!==before.ino||
          createHash('sha256').update(bytes).digest('hex')!==id)
        throw fail('GRIDFABRIC_FILE_CHANGED','The original file identity changed.');
      return bytes;
    } finally {closeSync(fd);}
  };
  const identity=id=>{
    assertHeld();const path=locate(id),fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const before=fstatSync(fd);
      if(!before.isFile()||before.nlink!==1||(before.mode&0o077)||
          (typeof process.getuid==='function'&&before.uid!==process.getuid()))
        throw fail('GRIDFABRIC_FILE_TYPE','Keep the immutable original regular file.');
      const hash=createHash('sha256'),utf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}),buffer=Buffer.allocUnsafe(256*1024);
      let count=0;
      for(;;){
        const size=readSync(fd,buffer,0,buffer.length,null);if(size===0)break;
        const chunk=buffer.subarray(0,size);hash.update(chunk);utf8.decode(chunk,{stream:true});count+=size;
      }
      utf8.decode();const after=fstatSync(fd),named=lstatSync(path);
      if(before.dev!==after.dev||before.ino!==after.ino||before.size!==after.size||before.mtimeMs!==after.mtimeMs||
          before.ctimeMs!==after.ctimeMs||named.isSymbolicLink()||named.dev!==before.dev||named.ino!==before.ino||
          count!==before.size||hash.digest('hex')!==id)
        throw fail('GRIDFABRIC_FILE_CHANGED','The original file identity changed.');
      return {sha256:id,bytes:count};
    }finally{closeSync(fd);}
  };
  return {
    directory:root,identity,
    filePath(id){return locate(id);},
    put(text,{name='original.json',mime_type='application/json'}={}) {
      assertHeld();if(readOnly)throw fail('GRIDFABRIC_FILE_READ_ONLY','This original file reader is read-only.');const identity=sha256Utf8(text),target=locate(identity.sha256);
      if(typeof name!=='string'||!name||name.includes('\0')||typeof mime_type!=='string'||!mime_type||mime_type.includes('\0'))
        throw fail('GRIDFABRIC_FILE_METADATA','Keep the original file name and media type.');
      const shard=join(root,identity.sha256.slice(0,2));mkdirSync(shard,{recursive:true,mode:0o700});
      if(existsSync(target)) {
        if(decoder.decode(readBytes(identity.sha256))!==text)throw fail('GRIDFABRIC_FILE_CHANGED','An existing original file differs.');
        return {...identity,name,mime_type};
      }
      const temporary=join(shard,'.writing-'+randomUUID());
      let fd;
      try {
        fd=openSync(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
        writeFileSync(fd,Buffer.from(text,'utf8'));fsyncSync(fd);closeSync(fd);fd=undefined;
        renameSync(temporary,target);fsyncDirectory(shard);
      } catch(error) {
        if(fd!==undefined)try{closeSync(fd);}catch{}
        try{unlinkSync(temporary);}catch{}
        throw error;
      }
      return {...identity,name,mime_type};
    },
    beginReceive({sha256,bytes,name='original.json',mime_type='application/json'}){
      assertHeld();if(readOnly)throw fail('GRIDFABRIC_FILE_READ_ONLY','This original file reader is read-only.');
      if(!ID.test(sha256)||!Number.isSafeInteger(bytes)||bytes<0)throw fail('GRIDFABRIC_FILE_ID','Use the complete original receiving identity.');
      const target=locate(sha256),shard=join(root,sha256.slice(0,2));mkdirSync(shard,{recursive:true,mode:0o700});
      const temporary=join(shard,'.receiving-'+randomUUID()),hash=createHash('sha256'),utf8=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true});
      let fd=openSync(temporary,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600),count=0,finished=false;
      const abort=()=>{if(fd!==null){try{closeSync(fd);}catch{}fd=null;}try{unlinkSync(temporary);}catch{}};
      return {
        write(chunk){
          assertHeld();if(finished||fd===null)throw fail('GRIDFABRIC_FILE_RECEIVER_CLOSED','The original file receiver is closed.');
          const body=Buffer.from(chunk);count+=body.length;
          if(count>bytes)throw fail('GRIDFABRIC_FILE_RECEIVER_LENGTH','The original receiving file exceeds its declared length.');
          utf8.decode(body,{stream:true});hash.update(body);
          let offset=0;while(offset<body.length)offset+=writeSync(fd,body,offset,body.length-offset);
        },
        finish(){
          assertHeld();if(finished||fd===null)throw fail('GRIDFABRIC_FILE_RECEIVER_CLOSED','The original file receiver is closed.');
          try{
            utf8.decode();
            if(count!==bytes||hash.digest('hex')!==sha256)throw fail('GRIDFABRIC_FILE_RECEIVER_SHA','The complete original receiving bytes differ.');
            fsyncSync(fd);closeSync(fd);fd=null;
            if(existsSync(target)){
              const retained=identity(sha256);
              if(retained.bytes!==bytes)throw fail('GRIDFABRIC_FILE_CHANGED','An original receiving target differs.');
              unlinkSync(temporary);
            }else renameSync(temporary,target);
            fsyncDirectory(shard);finished=true;return {sha256,bytes,name,mime_type};
          }catch(error){abort();throw error;}
        },
        abort
      };
    },
    read(id){return decoder.decode(readBytes(id));},
    readBytes,
    path(id){identity(id);return locate(id);},
    *identities() {
      assertHeld();
      for(const shard of readdirSync(root).sort()) {
        if(!/^[0-9a-f]{2}$/.test(shard))continue;
        const parent=join(root,shard),stat=lstatSync(parent);
        if(!stat.isDirectory()||stat.isSymbolicLink())throw fail('GRIDFABRIC_FILE_DIRECTORY','Keep the original immutable file directory.');
        for(const name of readdirSync(parent).sort()) {
          const match=/^([0-9a-f]{64})\.utf8$/.exec(name);
          if(!match)continue;
          if(!match[1].startsWith(shard))throw fail('GRIDFABRIC_FILE_DIRECTORY','The original file shard differs.');
          yield identity(match[1]);
        }
      }
    }
  };
}
