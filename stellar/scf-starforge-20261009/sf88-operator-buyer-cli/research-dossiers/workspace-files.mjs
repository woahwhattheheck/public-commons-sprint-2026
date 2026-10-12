// MIT. Host-selected Research source files; complete bytes and stable file identities.
import {constants} from 'node:fs';
import {open} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {isAbsolute,resolve} from 'node:path';
import {Readable} from 'node:stream';
import {need} from '../node/store.mjs';

const stamp=value=>[value.dev,value.ino,value.size,value.mtimeNs,value.ctimeNs,value.mode,value.uid].join(':');
const sha=value=>createHash('sha256').update(value).digest('hex');
async function selected(file,maximum,{privateFile=false}={}){
  need(typeof file==='string'&&isAbsolute(file)&&resolve(file)===file,'ABSOLUTE_PATH_REQUIRED');
  need(Number.isSafeInteger(maximum)&&maximum>=0,'READ_LIMIT_INVALID');
  const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0));
  try{
    const before=await handle.stat({bigint:true});
    need(before.isFile()&&before.size<=BigInt(maximum)&&(!privateFile||
      before.nlink===1n&&(process.platform==='win32'||(before.mode&0o077n)===0n)&&
      (!process.getuid||before.uid===BigInt(process.getuid()))),'RESEARCH_HOST_FILE_INVALID');
    return {handle,before};
  }catch(error){await handle.close();throw error;}
}
export async function readResearchHostFile(file,maximum,{privateFile=false,sha256}={}){
  const {handle,before}=await selected(file,maximum,{privateFile});
  try{
    const bytes=await handle.readFile();
    need(bytes.length<=maximum&&BigInt(bytes.length)===before.size&&stamp(before)===stamp(await handle.stat({bigint:true})),
      'RESEARCH_HOST_FILE_CHANGED');
    need(sha256===undefined||/^[a-f0-9]{64}$/.test(sha256)&&sha(bytes)===sha256,'RESEARCH_HOST_FILE_CHANGED');
    return bytes;
  }finally{await handle.close();}
}
/** Verify the complete reviewed file, then stream the same descriptor.
 * The second hash and stamp check run before the request stream ends.
 */
export async function openResearchSource(file,maximum,{sha256}={}){
  const {handle,before}=await selected(file,maximum);
  try{
    const hash=createHash('sha256');let bytes=0;
    for await(const chunk of handle.createReadStream({autoClose:false,start:0})){
      bytes+=chunk.length;need(bytes<=maximum,'RESEARCH_HOST_FILE_CHANGED');hash.update(chunk);
    }
    const digest=hash.digest('hex');
    need(BigInt(bytes)===before.size&&stamp(before)===stamp(await handle.stat({bigint:true}))&&
      (sha256===undefined||/^[a-f0-9]{64}$/.test(sha256)&&digest===sha256),'RESEARCH_HOST_FILE_CHANGED');
    const stream=Readable.from((async function*(){
      const verify=createHash('sha256');let count=0;
      for await(const chunk of handle.createReadStream({autoClose:false,start:0})){
        count+=chunk.length;need(count<=bytes,'RESEARCH_HOST_FILE_CHANGED');verify.update(chunk);yield chunk;
      }
      need(count===bytes&&verify.digest('hex')===digest&&stamp(before)===stamp(await handle.stat({bigint:true})),
        'RESEARCH_HOST_FILE_CHANGED');
    })());
    return {stream,bytes,sha256:digest,async close(){stream.destroy();await handle.close();}};
  }catch(error){await handle.close();throw error;}
}
