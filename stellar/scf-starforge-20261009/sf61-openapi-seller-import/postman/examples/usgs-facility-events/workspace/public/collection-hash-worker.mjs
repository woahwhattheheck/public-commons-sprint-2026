// MIT. Reuse the existing SF88 incremental hasher for complete collection files.
import { Sha256 } from './buyer-sha256.mjs';
self.onmessage=async event=>{
  try{
    const file=event.data?.file;
    if(!(file instanceof Blob)||file.size<1024||file.size>16*1024*1024*1024)throw new Error('Choose a complete collection archive of at most 16 GiB.');
    const hash=new Sha256();let reported=0;
    for(let offset=0;offset<file.size;offset+=262144){
      const bytes=new Uint8Array(await file.slice(offset,offset+262144).arrayBuffer());hash.update(bytes);
      if(Date.now()-reported>=250||offset+bytes.length===file.size){
        self.postMessage({type:'progress',bytes:offset+bytes.length,total:file.size});reported=Date.now();
      }
    }
    self.postMessage({type:'complete',bytes:file.size,sha256:hash.digest()});
  }catch(error){self.postMessage({type:'error',error:error.message});}
};
