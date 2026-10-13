/** Publish a complete standalone file without exposing a partial destination. */
import fs from 'node:fs/promises';
import path from 'node:path';
export async function publishExactFile(destination,data){
 const body=Buffer.from(data),target=path.resolve(destination);
 const directory=await fs.mkdtemp(path.join(path.dirname(target),'.flow-export-')),temporary=path.join(directory,'complete');
 try{
  const file=await fs.open(temporary,'wx');
  try{await file.writeFile(body);await file.sync();}
  catch(error){await file.close().catch(()=>{});throw error;}
  await file.close();
  try{await fs.link(temporary,target);}
  catch(error){
   if(error.code!=='EEXIST')throw error;
   const existing=await fs.readFile(target);
   if(!existing.equals(body))throw Error('Existing output contains a different file: '+target);
  }
 }finally{
  await fs.unlink(temporary).catch(()=>{});
  await fs.rmdir(directory).catch(()=>{});
 }
}
