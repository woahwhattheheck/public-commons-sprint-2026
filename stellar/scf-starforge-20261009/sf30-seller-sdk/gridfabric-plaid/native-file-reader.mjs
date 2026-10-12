// MIT. Verified bounded-memory reads of the original immutable native files.
import {constants} from 'node:fs';
import {open,lstat,realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';

export const GRIDFABRIC_FILE_RANGE=196608;
const SHA=/^[0-9a-f]{64}$/;
const stamp=s=>[s.dev,s.ino,s.size,s.mtimeNs,s.ctimeNs,s.mode,s.nlink,s.uid].join(':');
const fail=(code,message)=>Object.assign(new Error(message),{code,statusCode:409});
function privateFile(s) {
  if(!s.isFile()||s.nlink!==1n||(s.mode&0o077n)!==0n||
     typeof process.getuid==='function'&&s.uid!==BigInt(process.getuid()))
    throw fail('GRIDFABRIC_TRANSFER_FILE','Keep the original private regular file.');
}
export function createGridFabricFileReader() {
  // Cache only verified identities. Every read still checks the open descriptor
  // and current named file; changed files are hashed again before any bytes return.
  const verified=new Map();
  async function selected(filename,expected) {
    if(typeof filename!=='string'||!SHA.test(expected?.sha256??'')||
       expected.bytes!==undefined&&(!Number.isSafeInteger(expected.bytes)||expected.bytes<0))
      throw fail('GRIDFABRIC_TRANSFER_IDENTITY','Select the complete original file identity.');
    const path=resolve(filename);
    if(await realpath(path)!==path)throw fail('GRIDFABRIC_TRANSFER_PATH','Use the original real file path.');
    const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try {
      const before=await handle.stat({bigint:true});privateFile(before);
      if(before.size>BigInt(Number.MAX_SAFE_INTEGER)||
         expected.bytes!==undefined&&before.size!==BigInt(expected.bytes))
        throw fail('GRIDFABRIC_TRANSFER_LENGTH','The original complete file length changed.');
      const identity=stamp(before),prior=verified.get(path);
      if(!prior||prior.stamp!==identity||prior.sha256!==expected.sha256) {
        const hash=createHash('sha256'),buffer=Buffer.allocUnsafe(256*1024);
        let count=0;
        for(;;) {
          const {bytesRead}=await handle.read(buffer,0,buffer.length,null);
          if(!bytesRead)break;
          hash.update(buffer.subarray(0,bytesRead));count+=bytesRead;
        }
        if(count!==Number(before.size)||hash.digest('hex')!==expected.sha256)
          throw fail('GRIDFABRIC_TRANSFER_CHANGED','The complete original file digest differs.');
        verified.delete(path);verified.set(path,{stamp:identity,sha256:expected.sha256});
        if(verified.size>1024)verified.delete(verified.keys().next().value);
      }
      const check=async()=>{
        const after=await handle.stat({bigint:true}),named=await lstat(path,{bigint:true});
        privateFile(after);privateFile(named);
        if(stamp(after)!==identity||stamp(named)!==identity||await realpath(path)!==path) {
          verified.delete(path);
          throw fail('GRIDFABRIC_TRANSFER_CHANGED','The original file changed during receiving.');
        }
      };
      await check();
      return {handle,check,info:{bytes:Number(before.size),sha256:expected.sha256}};
    } catch(error) {verified.delete(path);await handle.close();throw error;}
  }
  return Object.freeze({
    async info(path,expected) {
      const item=await selected(path,expected);
      try {await item.check();return item.info;}finally{await item.handle.close();}
    },
    async range(path,expected,{offset,limit}) {
      if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||
         limit<1||limit>GRIDFABRIC_FILE_RANGE)
        throw fail('GRIDFABRIC_TRANSFER_RANGE','Select an original byte range from 1 to 196608 bytes.');
      const item=await selected(path,expected);
      try {
        if(offset>item.info.bytes)throw fail('GRIDFABRIC_TRANSFER_RANGE','The byte offset is beyond the original file.');
        const bytes=Buffer.allocUnsafe(Math.min(limit,item.info.bytes-offset));
        let received=0;
        while(received<bytes.length) {
          const chunk=await item.handle.read(bytes,received,bytes.length-received,offset+received);
          if(!chunk.bytesRead)throw fail('GRIDFABRIC_TRANSFER_INCOMPLETE','The original byte range ended early.');
          received+=chunk.bytesRead;
        }
        await item.check();
        return {bytes,offset,total:item.info.bytes,sha256:item.info.sha256,
          chunk_sha256:createHash('sha256').update(bytes).digest('hex')};
      } finally {await item.handle.close();}
    },
    close(){verified.clear();}
  });
}
