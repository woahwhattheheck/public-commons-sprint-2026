// MIT. Copy one exact native Soroban source file through its original range reader.
import {promises as fs} from 'node:fs';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {requireValue} from './rpc.mjs';

export async function downloadSorobanSourceFile({source,exportId,path,output,signal}){
  const identity=await source.sourceFile({exportId,path,offset:0,length:1});
  requireValue(Number.isSafeInteger(identity.bytes)&&identity.bytes>=0&&/^[a-f0-9]{64}$/.test(identity.sha256),
    'SOURCE_FILE_CHANGED','The native source file has no complete identity.');
  const target=resolve(output),handle=await fs.open(target,'wx',0o600),hash=createHash('sha256');
  let complete=false,offset=0;
  try{
    while(offset<identity.bytes){
      signal?.throwIfAborted();
      const length=Math.min(196608,identity.bytes-offset);
      const page=await source.sourceFile({exportId,path,offset,length});
      requireValue(page.path===identity.path&&page.bytes===identity.bytes&&page.sha256===identity.sha256&&
        Buffer.isBuffer(page.content)&&page.content.length===length,
        'SOURCE_FILE_CHANGED','The original export file changed during copying.');
      await handle.writeFile(page.content);hash.update(page.content);offset+=length;
    }
    requireValue(hash.digest('hex')===identity.sha256,'SOURCE_FILE_CHANGED','The copied source differs from its retained SHA256.');
    await handle.sync();complete=true;
    return {path:target,exportId,sourcePath:identity.path,bytes:offset,sha256:identity.sha256};
  }finally{
    await handle.close();
    if(!complete)await fs.unlink(target).catch(()=>{});
  }
}
