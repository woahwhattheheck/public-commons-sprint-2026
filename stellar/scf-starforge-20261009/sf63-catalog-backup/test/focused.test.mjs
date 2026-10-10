import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, readFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inspectJournal, createSnapshot, verifySnapshot, restoreSnapshot } from '../backup.mjs';

const ZERO='0'.repeat(64);
const schema='stellar-forge.catalog-transactions/v1';
const valid=Buffer.from(JSON.stringify({schema,records:[],head:ZERO})+'\n');
const replay=async bytes=>{
  const j=inspectJournal(bytes);
  return {head:j.head,records:j.records};
};

test('SF63 local exact byte copy, manifest-last integrity, collision and no-follow safety',async()=>{
  const root=await mkdtemp(join(tmpdir(),'sf63-focus-'));
  try {
    const original=join(root,'original'),backup=join(root,'backup'),restore=join(root,'restored');
    await mkdir(original);
    await writeFile(join(original,'catalog-commits.json'),valid);
    const created=await createSnapshot(original,backup,replay);
    assert.equal(created.decision,'VERIFIED_NATIVE_REPLAY');
    assert.equal(created.records,0);
    assert.deepEqual(await readFile(join(backup,'catalog-commits.json')),valid);
    await assert.rejects(()=>createSnapshot(original,backup,replay),{code:'EEXIST'});
    assert.equal((await restoreSnapshot(backup,restore,replay)).decision,'RESTORED_AND_VERIFIED');
    assert.deepEqual(await readFile(join(restore,'catalog-commits.json')),valid);
    await assert.rejects(()=>restoreSnapshot(backup,restore,replay),{code:'EEXIST'});
    // A manifest update cannot override a real chain corruption in the journal.
    const bad=Buffer.from(JSON.stringify({schema,records:[],head:'a'.repeat(64)}));
    await writeFile(join(backup,'catalog-commits.json'),bad);
    await assert.rejects(()=>verifySnapshot(backup,replay),/MANIFEST_INVALID|JOURNAL_HEAD_MISMATCH/);
    const linked=join(root,'linked');
    await symlink(original,linked);
    await assert.rejects(()=>createSnapshot(linked,join(root,'not-written'),replay),/DIRECTORY_NOT_REGULAR/);
  } finally {await rm(root,{recursive:true,force:true});}
});
