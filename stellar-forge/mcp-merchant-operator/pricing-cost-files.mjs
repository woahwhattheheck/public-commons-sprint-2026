// MIT. Stream exact native economics archives through the existing merchant MCP.
import { createHash, randomUUID } from 'node:crypto';
import { MAX_RETAINED_CHUNK_BYTES } from './retained-file-reads.mjs';
import { openBundleDownload } from '../../stellar/scf-starforge-20261009/sf97-merchant-revenue-ops/economics/archive.mjs';

const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const fail=(code,message)=>Object.assign(new Error(message),{code:'PRICING_'+code});
const IDLE_MS=120000, MAX_HANDLES=4;
const sameFile=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.size===b.size&&a.mtimeMs===b.mtimeMs&&a.ctimeMs===b.ctimeMs;

/** Source selection and manifest validation stay in the original cost model.
 * This owns only bounded chunks and verified native archive file descriptors.
 */
export class PricingCostArchiveReads {
  #reads=new Map(); #tail=Promise.resolve(); #closing=false; #closed;
  get summary(){return {activeArchiveReads:this.#reads.size,archiveReadLimit:MAX_HANDLES,archiveChunkBytes:MAX_RETAINED_CHUNK_BYTES};}
  #queue(work){
    const result=this.#tail.catch(()=>{}).then(work);
    this.#tail=result.then(()=>{},()=>{});return result;
  }
  async #dispose(row){
    clearTimeout(row.timer);this.#reads.delete(row.id);
    await row.opened.close();
  }
  #touch(row){
    clearTimeout(row.timer);row.expiresAt=new Date(Date.now()+IDLE_MS).toISOString();
    row.timer=setTimeout(()=>{void this.release(row.scope,row.id).catch(()=>{});},IDLE_MS);row.timer.unref();
  }
  async read({scope,key,readId,offset=0,limit=65536,expectedSha256,load}){
    if(this.#closing)throw fail('CLOSING','The original archive read handle is closing.');
    return this.#queue(async()=>{
      if(this.#closing)throw fail('CLOSING','The original archive read handle is closing.');
      if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>MAX_RETAINED_CHUNK_BYTES)
        throw fail('READ_ARGUMENTS','Use a nonnegative byte offset and the declared bounded chunk limit.');
      let row;
      if(readId){
        row=this.#reads.get(readId);
        if(!row)throw fail('READ_NOT_FOUND','This archive read expired. Reopen the same manifest and file digest at the retained offset.');
        if(row.scope!==scope||row.key!==key||expectedSha256!==row.file.sha256)
          throw fail('READ_CONFLICT','The read ID belongs to different immutable archive selectors.');
      }else{
        if(offset&&!expectedSha256)throw fail('READ_ARGUMENTS','A resumed offset requires the original SHA-256.');
        if(this.#reads.size>=MAX_HANDLES)throw fail('READ_LIMIT','Release an existing original archive read before opening another.');
        const original=await load();
        if(expectedSha256!==undefined&&original.file.sha256!==expectedSha256)
          throw fail('FILE_CHANGED','The retained archive differs from the selected digest.');
        const opened=await openBundleDownload(original.descriptor);
        try{
          const stat=await opened.handle.stat();
          row={id:randomUUID(),scope,key,file:original.file,opened,stat,timer:null,expiresAt:null};
          this.#reads.set(row.id,row);
        }catch(error){await opened.close();throw error;}
      }
      try{
        if(offset>row.file.bytes)throw fail('READ_ARGUMENTS','The offset exceeds the original archive byte count.');
        if(!sameFile(row.stat,await row.opened.handle.stat()))
          throw fail('FILE_CHANGED','The retained archive changed after the original manifest was verified.');
        const size=Math.min(limit,row.file.bytes-offset),bytes=Buffer.alloc(size);
        let count=0;while(count<size){
          const read=await row.opened.handle.read(bytes,count,size-count,offset+count);
          if(!read.bytesRead)throw fail('FILE_CHANGED','The retained archive ended before its committed byte count.');
          count+=read.bytesRead;
        }
        if(!sameFile(row.stat,await row.opened.handle.stat()))
          throw fail('FILE_CHANGED','The retained archive changed while this chunk was read.');
        this.#touch(row);
        return {readId:row.id,file:row.file,offset,bytesRead:bytes.length,nextOffset:offset+bytes.length<row.file.bytes?offset+bytes.length:null,
          encoding:'base64',data:bytes.toString('base64'),chunkSha256:digest(bytes),expiresAt:row.expiresAt,storage:'ORIGINAL_VERIFIED_ARCHIVE_DESCRIPTOR'};
      }catch(error){await this.#dispose(row).catch(()=>{});throw error;}
    });
  }
  release(scope,readId){return this.#queue(async()=>{
    const row=this.#reads.get(readId);if(!row)return;
    if(row.scope!==scope)throw fail('READ_CONFLICT','The read ID belongs to a different pricing workspace.');
    await this.#dispose(row);
  });}
  closeScope(scope){return this.#queue(async()=>{
    const results=await Promise.allSettled([...this.#reads.values()].filter(row=>row.scope===scope).map(row=>this.#dispose(row)));
    const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
  });}
  close(){
    if(!this.#closed){this.#closing=true;this.#closed=this.#queue(async()=>{
      const results=await Promise.allSettled([...this.#reads.values()].map(row=>this.#dispose(row)));
      const failed=results.find(result=>result.status==='rejected');if(failed)throw failed.reason;
    });}
    return this.#closed;
  }
}
