import { existsSync, readFileSync, createReadStream, statSync, lstatSync, fstatSync, realpathSync, openSync, closeSync, readSync, copyFileSync, linkSync, mkdirSync, renameSync, unlinkSync, fsyncSync, constants } from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute, basename } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { atomicBytes, digest, requireValue, sha, fsyncDirectory } from './common.mjs';
export function hashFile(path){
  const fd=openSync(path,'r'),buffer=Buffer.alloc(1024*1024),h=createHash('sha256');let bytes=0;
  try{for(;;){const n=readSync(fd,buffer,0,buffer.length,null);if(!n)break;h.update(buffer.subarray(0,n));bytes+=n;}}finally{closeSync(fd);}
  return {sha256:h.digest('hex'),bytes};
}

const LINK_COPY_ERRORS=new Set(['EXDEV','ENOTSUP','EOPNOTSUPP','EPERM']);
function missingStat(path){
  try{return lstatSync(path,{bigint:true});}catch(error){if(error.code==='ENOENT')return null;throw error;}
}
function sameFile(a,b,metadata=true){
  return a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeNs===b.mtimeNs&&(!metadata||a.ctimeNs===b.ctimeNs);
}
function expectedObject(expected){
  requireValue(expected&&typeof expected==='object'&&Number.isSafeInteger(expected.bytes)&&expected.bytes>=0,
    'OBJECT_EXPECTED_IDENTITY','Supply the complete selected identity of the closed file.',409);
  return {sha256:digest(expected.sha256),bytes:expected.bytes};
}
function observedDescriptor(fd){
  const buffer=Buffer.alloc(1024*1024),hash=createHash('sha256');let bytes=0;
  for(;;){const n=readSync(fd,buffer,0,buffer.length,bytes);if(!n)break;hash.update(buffer.subarray(0,n));bytes+=n;}
  return {sha256:hash.digest('hex'),bytes};
}
function openClosed(path,expected){
  const before=missingStat(path);
  requireValue(before?.isFile()&&!before.isSymbolicLink(),'OBJECT_CLOSED_FILE','Select a regular closed file, without a symbolic link.',409);
  const fd=openSync(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try{
    const opened=fstatSync(fd,{bigint:true});
    requireValue(sameFile(before,opened),'OBJECT_CLOSED_CHANGED','The closed source changed while opening its retained inode.',409);
    fsyncSync(fd);
    const observed=observedDescriptor(fd),after=fstatSync(fd,{bigint:true}),current=missingStat(path);
    requireValue(current?.isFile()&&sameFile(opened,after)&&sameFile(after,current),
      'OBJECT_CLOSED_CHANGED','The closed source changed while reading its complete bytes.',409);
    if(expected)requireValue(observed.sha256===expected.sha256&&observed.bytes===expected.bytes,
      'OBJECT_IDENTITY_CHANGED','The closed file differs from its selected complete byte identity.',409);
    return {fd,stamp:after,observed};
  }catch(error){closeSync(fd);throw error;}
}
function assertClosedPath(path,held,{ownLinkChange=false}={}){
  const current=missingStat(path),inode=fstatSync(held.fd,{bigint:true});
  requireValue(current?.isFile()&&!current.isSymbolicLink()&&sameFile(held.stamp,inode,!ownLinkChange)&&sameFile(inode,current),
    'OBJECT_CLOSED_CHANGED','The owned closed pathname no longer selects its verified inode and bytes.',409);
}
function verifyClosed(path,expected){
  const held=openClosed(path,expected);try{return held.observed;}finally{closeSync(held.fd);}
}
function unlinkOwned(path){
  try{unlinkSync(path);}catch(error){if(error.code!=='ENOENT')throw error;}
}
function within(root,path){
  const rel=relative(root,path);return rel!==''&&!isAbsolute(rel)&&rel!=='..'&&!rel.startsWith('..'+(process.platform==='win32'?'\\':'/'));
}

export class ObjectStore {
  constructor(directory){this.directory=directory;}
  path(hash){digest(hash);return join(this.directory,hash.slice(0,2),hash);}
  put(bytes){const body=Buffer.from(bytes),hash=sha(body),path=this.path(hash);atomicBytes(path,body,{immutable:true});return {sha256:hash,bytes:body.length};}
  putFile(source,expected){
    const selected=hashFile(source);if(expected)requireValue(selected.sha256===expected.sha256&&selected.bytes===expected.bytes,'OBJECT_IDENTITY_CHANGED','The original source file did not match its selected bytes.',409);
    const target=this.path(selected.sha256);
    if(existsSync(target)){this.verify(selected.sha256,selected.bytes);return selected;}
    mkdirSync(dirname(target),{recursive:true,mode:0o700});const temp=target+'.pending-'+randomUUID();
    try{copyFileSync(source,temp,constants.COPYFILE_EXCL);const copy=hashFile(temp);requireValue(copy.sha256===selected.sha256&&copy.bytes===selected.bytes,'OBJECT_COPY_CHANGED','Source bytes changed while retaining their object.',409);const fd=openSync(temp,'r');try{fsyncSync(fd);}finally{closeSync(fd);}renameSync(temp,target);fsyncDirectory(dirname(target));}
    catch(error){try{unlinkSync(temp);}catch{}throw error;}return selected;
  }
  ownedClosedPath(source){
    const path=resolve(source),owner=realpathSync(dirname(resolve(this.directory)));
    // These methods may retire or replace a pathname. Their inputs belong to
    // this workspace's private staging/portable/upload area, never its CAS.
    const parent=realpathSync(dirname(path)),canonicalPath=join(parent,basename(path)),objects=resolve(owner,basename(this.directory));
    const objectRoot=missingStat(objects);
    requireValue(!objectRoot||(objectRoot.isDirectory()&&!objectRoot.isSymbolicLink()&&realpathSync(objects)===objects),
      'OBJECT_CLOSED_SCOPE','The original object-store root must remain an ordinary owned directory.',409);
    requireValue(within(owner,canonicalPath)&&canonicalPath!==objects&&!within(objects,canonicalPath),
      'OBJECT_CLOSED_SCOPE','Closed-file admission accepts only this workspace own staging files outside its object store.',409);
    return canonicalPath;
  }
  ensureClosedParent(target){
    // A move may consume the only staging pathname. Publish every new CAS
    // directory entry durably before that move can remove its original name.
    mkdirSync(dirname(target),{recursive:true,mode:0o700});
    const root=resolve(this.directory),parent=resolve(dirname(target));
    for(const path of [root,parent]){
      const st=missingStat(path);
      requireValue(st?.isDirectory()&&!st.isSymbolicLink()&&realpathSync(path)===path,
        'OBJECT_CLOSED_SCOPE','Closed-file custody requires ordinary owned CAS directories.',409);
    }
    requireValue(dirname(parent)===root,'OBJECT_CLOSED_SCOPE','The selected closed object must use the original CAS prefix.',409);
    fsyncDirectory(parent);fsyncDirectory(root);fsyncDirectory(dirname(root));
  }
  closedTemporary(source,target){
    return target+'.closed-'+sha(Buffer.from(resolve(source)))+'.pending';
  }
  prepareClosedTemporary(source,target,selected,held,{link=false}={}){
    const temp=this.closedTemporary(source,target);let linked=false;
    const prior=missingStat(temp);
    if(prior){
      // A previous interrupted copy is reproducible from the reopened complete
      // source. A complete temporary is reused; an incomplete one is retired
      // only inside this reserved object-store staging name.
      const saved=openClosed(temp);
      try{
        if(saved.observed.sha256===selected.sha256&&saved.observed.bytes===selected.bytes)return {temp,ownLinkChange:saved.stamp.dev===held.stamp.dev&&saved.stamp.ino===held.stamp.ino};
      }finally{closeSync(saved.fd);}
      assertClosedPath(source,held);unlinkOwned(temp);fsyncDirectory(dirname(temp));
    }
    assertClosedPath(source,held);
    if(link){
      try{linkSync(source,temp);linked=true;}
      catch(error){if(!LINK_COPY_ERRORS.has(error.code))throw error;copyFileSync(source,temp,constants.COPYFILE_EXCL);}
    }else copyFileSync(source,temp,constants.COPYFILE_EXCL);
    try{
      verifyClosed(temp,selected);
      assertClosedPath(source,held,{ownLinkChange:linked});
      return {temp,ownLinkChange:linked};
    }catch(error){try{unlinkOwned(temp);}catch{}throw error;}
  }
  publishClosedTemporary(temp,target,selected){
    if(missingStat(target)){verifyClosed(target,selected);unlinkOwned(temp);}
    else renameSync(temp,target);
    verifyClosed(target,selected);fsyncDirectory(dirname(target));
  }
  // The caller holds the original workspace lease and promises that this
  // complete source will never be written again. Both pathnames remain valid.
  // On one filesystem they share the same verified inode. Unsupported links
  // fall back to independent exact copies without changing the descriptor.
  putClosedFile(source,expected){
    const selected=expectedObject(expected),path=this.ownedClosedPath(source),target=this.path(selected.sha256);
    const held=openClosed(path,selected);let temp=null,alias=null,ownLinkChange=false;
    try{
      this.ensureClosedParent(target);
      if(!missingStat(target)){
        const prepared=this.prepareClosedTemporary(path,target,selected,held,{link:true});
        temp=prepared.temp;ownLinkChange=prepared.ownLinkChange;
        this.publishClosedTemporary(temp,target,selected);temp=null;
      }else verifyClosed(target,selected);
      assertClosedPath(path,held,{ownLinkChange});
      const stored=missingStat(target),current=fstatSync(held.fd,{bigint:true});
      if(stored.dev===current.dev&&stored.ino===current.ino){fsyncDirectory(dirname(path));return selected;}
      // An earlier upload/archive already retained these exact bytes. Replace
      // only the caller's closed duplicate, atomically, with that CAS inode.
      alias=path+'.closed-'+selected.sha256+'.pending';
      if(missingStat(alias)){
        verifyClosed(alias,selected);
        const saved=missingStat(alias);
        if(saved.dev!==stored.dev||saved.ino!==stored.ino){unlinkOwned(alias);fsyncDirectory(dirname(path));}
      }
      if(!missingStat(alias)){
        try{linkSync(target,alias);}
        catch(error){if(!LINK_COPY_ERRORS.has(error.code))throw error;alias=null;return selected;}
      }
      assertClosedPath(path,held,{ownLinkChange});
      renameSync(alias,path);alias=null;fsyncDirectory(dirname(path));verifyClosed(path,selected);
      return selected;
    }finally{
      closeSync(held.fd);
      if(temp)try{unlinkOwned(temp);}catch{}
      if(alias)try{unlinkOwned(alias);}catch{}
    }
  }
  // Consume an owned, fsynced, CLOSED staging file. Same-filesystem rename
  // leaves no .part alias that a resumed parser could truncate. Cross-device
  // copies publish verified custody before retiring the source. Exact replay
  // also accepts source absent + selected CAS present after a completed move.
  adoptClosedFile(source,expected){
    const selected=expectedObject(expected),path=this.ownedClosedPath(source),target=this.path(selected.sha256);
    if(!missingStat(path)){this.ensureClosedParent(target);verifyClosed(target,selected);fsyncDirectory(dirname(path));return selected;}
    const held=openClosed(path,selected);let temp=null,moved=false;
    try{
      this.ensureClosedParent(target);
      if(missingStat(target))verifyClosed(target,selected);
      else{
        assertClosedPath(path,held);
        try{renameSync(path,target);moved=true;}
        catch(error){
          if(error.code!=='EXDEV')throw error;
          const prepared=this.prepareClosedTemporary(path,target,selected,held);
          temp=prepared.temp;this.publishClosedTemporary(temp,target,selected);temp=null;
        }
        verifyClosed(target,selected);fsyncDirectory(dirname(target));
      }
      if(!moved){assertClosedPath(path,held);unlinkSync(path);}
      fsyncDirectory(dirname(path));fsyncDirectory(dirname(target));
      return selected;
    }finally{closeSync(held.fd);if(temp)try{unlinkOwned(temp);}catch{}}
  }
  verify(hash,expectedBytes){const observed=hashFile(this.path(hash));requireValue(observed.sha256===hash&&(expectedBytes===undefined||observed.bytes===expectedBytes),'OBJECT_IDENTITY_CHANGED','The retained original object failed its byte identity.',409,{sha256:hash});return observed;}
  read(hash,expectedBytes){const body=readFileSync(this.path(hash));requireValue(sha(body)===hash&&(expectedBytes===undefined||body.length===expectedBytes),'OBJECT_IDENTITY_CHANGED','The retained original object failed its byte identity.',409);return body;}
  describe(hash){const p=this.path(hash);requireValue(existsSync(p),'OBJECT_MISSING','The selected retained object is missing.',409,{sha256:hash});return {sha256:hash,bytes:statSync(p).size};}
  stream(hash,expectedBytes){this.verify(hash,expectedBytes);return createReadStream(this.path(hash));}
}
