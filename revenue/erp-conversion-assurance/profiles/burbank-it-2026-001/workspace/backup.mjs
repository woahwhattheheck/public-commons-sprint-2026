// MIT. Offline encrypted backup of the original service, project catalog and pending work.
import {mkdir,mkdtemp,open,readFile,stat,rm,rename} from 'node:fs/promises';
import {createReadStream,createWriteStream} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {randomBytes,randomUUID,scrypt,createCipheriv,createDecipheriv,createHash} from 'node:crypto';
import {promisify} from 'node:util';
import {pipeline} from 'node:stream/promises';
import {fileURLToPath} from 'node:url';
import {acquireStateLease} from '../../../../../stellar/scf-starforge-20261009/merchant-fleet-gateway/state-lease.mjs';
import {openReconciliationService} from '../../../service/service.mjs';
import {openProjectStore,privateDirectory,privateRead} from './store.mjs';
import {loadCatalog} from './catalog.mjs';
import {runProgram} from './handoff.mjs';
const MAGIC=Buffer.from('BURBANK-BACKUP1\n'),derive=promisify(scrypt);
const need=(value,message)=>{if(!value)throw new Error(message);};
function password(value){need(typeof value==='string'&&value.length>=16,'Use a backup passphrase of at least 16 characters in the named environment variable.');return value;}
async function fileDigest(path){const hash=createHash('sha256');for await(const bytes of createReadStream(path))hash.update(bytes);return hash.digest('hex');}
export async function backupWorkspace({directory,output,passphrase}) {
  const root=resolve(directory),destination=resolve(output);need(!destination.startsWith(root+'/'),'Save the encrypted backup outside the private service directory.');
  password(passphrase);await privateRead(join(root,'service.json'));const leases=[];let handle;
  const temporary=await mkdtemp(join(tmpdir(),'burbank-backup-'));
  try {
    for(const path of [join(root,'burbank','host'),join(root,'runtime','queue'),join(root,'runtime'),join(root,'burbank')]) {
      await privateDirectory(path);try{leases.push(await acquireStateLease(path));}catch(error){if(error.message==='FLEET_STATE_ALREADY_OWNED')throw new Error('Stop the Burbank operator and wait for the original worker to finish before backing up.');throw error;}
    }
    const archive=join(temporary,'workspace.tar.gz');await runProgram('tar',['--format=pax','-czf',archive,'-C',root,'.']);
    const salt=randomBytes(16),iv=randomBytes(12),header=Buffer.concat([MAGIC,salt,iv]);
    const key=await derive(password(passphrase),salt,32),cipher=createCipheriv('aes-256-gcm',key,iv);cipher.setAAD(header);
    handle=await open(destination,'wx',0o600);await handle.write(header,0,header.length,0);
    await pipeline(createReadStream(archive),cipher,createWriteStream(destination,{fd:handle.fd,autoClose:false,start:header.length}));
    const size=(await handle.stat()).size,tag=cipher.getAuthTag();await handle.write(tag,0,tag.length,size);await handle.sync();await handle.close();handle=null;key.fill(0);
    return {schema:'erp-burbank.encrypted-backup.v1',file:destination,bytes:(await stat(destination)).size,sha256:await fileDigest(destination)};
  }catch(error){if(handle){await handle.close().catch(()=>{});await rm(destination,{force:true});}throw error;}
  finally{for(const lease of leases.reverse())await lease.close();await rm(temporary,{recursive:true,force:true});}
}
export async function restoreWorkspace({input,directory,passphrase}) {
  password(passphrase);const source=resolve(input),destination=resolve(directory),temporary=await mkdtemp(join(tmpdir(),'burbank-restore-'));
  const stage=join(dirname(destination),'.burbank-restore-'+randomUUID());let published=false;
  try {
    try{await stat(destination);throw new Error('Restore into a new directory.');}catch(error){if(error.code!=='ENOENT')throw error;}
    const handle=await open(source,'r'),size=(await handle.stat()).size,header=Buffer.alloc(MAGIC.length+28),tag=Buffer.alloc(16);
    try{need(size>header.length+16,'The encrypted backup is incomplete.');await handle.read(header,0,header.length,0);await handle.read(tag,0,16,size-16);}finally{await handle.close();}
    need(header.subarray(0,MAGIC.length).equals(MAGIC),'This is not a Burbank encrypted workspace backup.');
    const key=await derive(passphrase,header.subarray(MAGIC.length,MAGIC.length+16),32),decipher=createDecipheriv('aes-256-gcm',key,header.subarray(MAGIC.length+16));decipher.setAAD(header);decipher.setAuthTag(tag);
    const archive=join(temporary,'authenticated.tar.gz');
    try{await pipeline(createReadStream(source,{start:header.length,end:size-17}),decipher,createWriteStream(archive,{flags:'wx',mode:0o600}));}
    catch{throw new Error('The backup authentication failed. Check the passphrase and original backup bytes.');}finally{key.fill(0);}
    const extracted=JSON.parse(await runProgram(process.env.BURBANK_PYTHON??'python3',[fileURLToPath(new URL('archive.py',import.meta.url)),archive,stage]));
    await openReconciliationService({directory:stage});const catalog=await loadCatalog(join(stage,'burbank','catalog')),store=await openProjectStore(stage,catalog),projects=await store.list();
    for(const project of projects)await store.get(project.id);
    await rename(stage,destination);published=true;return {schema:'erp-burbank.restored-workspace.v1',directory:destination,projects:projects.length,...extracted};
  }finally{if(!published)await rm(stage,{recursive:true,force:true});await rm(temporary,{recursive:true,force:true});}
}
