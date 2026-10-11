// MIT. Linux open-file-description leases retained by the native parent process.
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { mkdir, lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateConfig, FacilitatorError } from './config.mjs';

/** All cooperating same-host native facilitators use the same private directory. */
export async function acquireSignerOwnership(input) {
  const c = validateConfig(input), directory = c.operations.ownershipDirectory;
  const accounts = [...new Set([...c.signers.map(x => x.address),
    ...(c.feeBumpSigner ? [c.feeBumpSigner.address] : [])])].sort();
  if (directory === null) return Object.freeze({
    status:() => ({mode:'PROCESS_LOCAL',state:'ACTIVE',network:c.network,accounts}),
    release:async () => {},
  });
  if (process.platform !== 'linux' || typeof process.getuid !== 'function')
    throw new FacilitatorError('LINUX_SIGNER_OWNERSHIP_REQUIRED',503);
  await mkdir(directory,{recursive:true,mode:0o700});
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || info.uid !== process.getuid() || (info.mode & 0o077))
    throw new FacilitatorError('PRIVATE_OWNERSHIP_DIRECTORY_REQUIRED',503);
  const handles = [], ownerId = randomUUID(), startedAt = new Date().toISOString();
  let released = false, releasing;
  function release() {
    if (releasing) return releasing;
    // Never unlink lock inodes: a waiter can already have the original inode open.
    releasing = Promise.all(handles.splice(0).map(handle => handle.close()))
      .then(() => {released = true;});
    return releasing;
  }
  try {
    for (const account of accounts) {
      const id = createHash('sha256').update(c.network+'\0'+account).digest('hex');
      const handle = await open(join(directory,id+'.lock'),
        constants.O_RDWR | constants.O_CREAT | constants.O_NOFOLLOW,0o600);
      handles.push(handle);
      const file = await handle.stat();
      if (!file.isFile() || file.nlink !== 1 || file.uid !== process.getuid() || (file.mode & 0o077))
        throw new FacilitatorError('PRIVATE_SIGNER_LOCK_REQUIRED',503);
      // fd3 refers to the parent's open file description. flock's exit leaves the
      // lock held by that parent descriptor, including when the helper exits.
      const result = spawnSync('flock',['--nonblock','--conflict-exit-code','73','3'],
        {stdio:['ignore','ignore','ignore',handle.fd],timeout:5000});
      if (result.status === 73) throw new FacilitatorError('SIGNER_ALREADY_OWNED',503);
      if (result.error || result.status !== 0) throw new FacilitatorError('FLOCK_REQUIRED',503);
      await handle.truncate(0);
      await handle.writeFile(JSON.stringify({schema:'stellar-forge.signer-owner.v1',
        network:c.network,account,ownerId,pid:process.pid,startedAt})+'\n');
      await handle.sync();
    }
  } catch (error) { await release(); throw error; }
  return Object.freeze({release,status:() => ({mode:'HOST_SIGNER_LEASES',
    state:released ? 'RELEASED' : 'HELD',network:c.network,accounts:[...accounts],ownerId,startedAt})});
}
