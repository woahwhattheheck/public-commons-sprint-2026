// MIT. Create-only durable publication for retained collection files.
import {randomUUID} from 'node:crypto';
import {constants} from 'node:fs';
import {open,link,unlink} from 'node:fs/promises';
import {dirname,join} from 'node:path';

export async function exclusiveFile(path,bytes) {
  const handle=await open(path,'wx',0o600);
  try{await handle.writeFile(bytes);await handle.sync();}
  finally{await handle.close();}
}
export async function publish(path,bytes) {
  const temp=join(dirname(path),'.collect-'+randomUUID()+'.tmp');
  try {
    await exclusiveFile(temp,bytes);
    await link(temp,path);
    const handle=await open(dirname(path),constants.O_RDONLY);
    try{await handle.sync();}finally{await handle.close();}
  } finally {await unlink(temp).catch(error=>{if(error.code!=='ENOENT')throw error;});}
}
