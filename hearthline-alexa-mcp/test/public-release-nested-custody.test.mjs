import assert from 'node:assert/strict';
import { execFile as execFileCallback, spawn as spawnCallback } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { buildPublicRelease, loadManifest } from '../release/gate-lib.mjs';

const execFile=promisify(execFileCallback);
const here=path.dirname(fileURLToPath(import.meta.url));
const releaseCli=path.resolve(here,'../release/public-release.mjs');
async function git(cwd,...args){ const {stdout}=await execFile('git',['-C',cwd,...args],{encoding:'utf8'}); return stdout.trim(); }
async function fixture({files={'README.md':'hello\n','src/app.mjs':'export const x=1;\n'},destinations=null}={}){
  const base=await mkdtemp(path.join(os.tmpdir(),'release-nested-')),repo=path.join(base,'repo'),root=path.join(repo,'project'),release=path.join(root,'release'),out=path.join(base,'public');
  await mkdir(release,{recursive:true});
  for(const [rel,val] of Object.entries(files)){ const p=path.join(root,...rel.split('/')); await mkdir(path.dirname(p),{recursive:true}); await writeFile(p,val); }
  const manifestPath=path.join(release,'public-release.manifest.json');
  const manifest={version:1,project:'fixture',maxFiles:32,maxFileBytes:4096,maxTotalBytes:16384,files:Object.keys(files).map((source,i)=>({source,...(destinations?.[i]?{destination:destinations[i]}:{})}))};
  await writeFile(manifestPath,JSON.stringify(manifest));
  await git(base,'init',repo); await git(repo,'config','user.email','fixture@example.invalid'); await git(repo,'config','user.name','fixture'); await git(repo,'add','.'); await git(repo,'commit','-m','fixture');
  const sourceCommit=await git(repo,'rev-parse','HEAD');
  return {base,repo,root,release,out,manifestPath,manifest,sourceCommit};
}
async function emptyCommit(f,msg='advance'){ await git(f.repo,'commit','--allow-empty','-m',msg); return git(f.repo,'rev-parse','HEAD'); }
const code=(promise,expected)=>assert.rejects(promise,e=>e?.code===expected,`expected ${expected}`);

async function runCli(args){
  return new Promise((resolve)=>{
    const p=spawnCallback(process.execPath,[releaseCli,...args],{stdio:['ignore','pipe','pipe']}); let stdout='',stderr='';
    p.stdout.on('data',c=>stdout+=c); p.stderr.on('data',c=>stderr+=c); p.on('close',status=>resolve({status,stdout,stderr}));
  });
}

test('receipt keeps v2 schema but binds current HEAD and retained-tree protocol',async(t)=>{
  const f=await fixture(); t.after(()=>rm(f.base,{recursive:true,force:true}));
  const r=await buildPublicRelease({root:f.root,manifestPath:f.manifestPath,destination:f.out,sourceCommit:f.sourceCommit});
  assert.equal(r.schema,'hearthline-public-release/v2');
  assert.equal(r.sourceCommitProvenance,'CURRENT_HEAD_EXACT_GIT_OBJECT');
  assert.equal(r.publicationProtocol,'retained-tree-custody/v4');
  assert.equal(r.destinationGenerationProvenance,'RETAINED_POST_RESERVATION_OBSERVATION_CREATOR_UNAUTHENTICATED');
  assert.equal(r.sourceCommit,f.sourceCommit);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.out,'PUBLIC_RELEASE_RECEIPT.json'),'utf8')),r);
});

test('historical existing commit is rejected unless it is current HEAD',async(t)=>{
  const f=await fixture(); t.after(()=>rm(f.base,{recursive:true,force:true})); const old=f.sourceCommit; await emptyCommit(f);
  await code(buildPublicRelease({root:f.root,manifestPath:f.manifestPath,destination:f.out,sourceCommit:old}),'SOURCE_COMMIT_NOT_HEAD');
});

test('HEAD movement after validation fails before destination reservation',async(t)=>{
  const f=await fixture(); t.after(()=>rm(f.base,{recursive:true,force:true}));
  await code(buildPublicRelease({root:f.root,manifestPath:f.manifestPath,destination:f.out,sourceCommit:f.sourceCommit,_testHooks:{afterValidation:async()=>{await emptyCommit(f,'race');}}}),'SOURCE_HEAD_MOVED');
  await assert.rejects(readFile(path.join(f.out,'PUBLIC_RELEASE_RECEIPT.json')),{code:'ENOENT'});
});

test('source-root generation relocation and old-path recreation fail before destination mutation',async(t)=>{
  const f=await fixture(); t.after(()=>rm(f.base,{recursive:true,force:true})); const moved=path.join(f.repo,'project-moved');
  await code(buildPublicRelease({root:f.root,manifestPath:f.manifestPath,destination:f.out,sourceCommit:f.sourceCommit,_testHooks:{afterValidation:async()=>{await rename(f.root,moved); await mkdir(f.root);}}}),'SOURCE_ROOT_CHANGED');
  await assert.rejects(readFile(path.join(f.out,'PUBLIC_RELEASE_RECEIPT.json')),{code:'ENOENT'});
});

test('destination generation replacement after creation snapshot fails before payload write',async(t)=>{
  const f=await fixture(); t.after(()=>rm(f.base,{recursive:true,force:true})); const created=`${f.out}-created`;
  await code(buildPublicRelease({root:f.root,manifestPath:f.manifestPath,destination:f.out,sourceCommit:f.sourceCommit,_testHooks:{afterDestinationMkdir:async()=>{await rename(f.out,created); await mkdir(f.out); await writeFile(path.join(f.out,'foreign'),'survive\n');}}}),'DESTINATION_CREATION_CHANGED');
  assert.equal(await readFile(path.join(f.out,'foreign'),'utf8'),'survive\n');
  await assert.rejects(readFile(path.join(f.out,'PUBLIC_RELEASE_RECEIPT.json')),{code:'ENOENT'});
});

test('nested directory generation replacement after creation snapshot fails before file write',async(t)=>{
  const f=await fixture({files:{'src/app.mjs':'payload\n'}}); t.after(()=>rm(f.base,{recursive:true,force:true}));
  await code(buildPublicRelease({root:f.root,manifestPath:f.manifestPath,destination:f.out,sourceCommit:f.sourceCommit,_testHooks:{afterDirectoryMkdir:async({relative})=>{if(relative==='src'){await rename(path.join(f.out,'src'),path.join(f.out,'src-created')); await mkdir(path.join(f.out,'src'));}}}}),'OUTPUT_DIRECTORY_CREATION_CHANGED');
  await assert.rejects(readFile(path.join(f.out,'src','app.mjs')),{code:'ENOENT'});
  await assert.rejects(readFile(path.join(f.out,'PUBLIC_RELEASE_RECEIPT.json')),{code:'ENOENT'});
});

test('nested symlink injected after root reserve cannot redirect payload',async(t)=>{
  const f=await fixture(); t.after(()=>rm(f.base,{recursive:true,force:true})); const outside=path.join(f.base,'outside'); await mkdir(outside);
  await code(buildPublicRelease({root:f.root,manifestPath:f.manifestPath,destination:f.out,sourceCommit:f.sourceCommit,_testHooks:{afterReserve:async()=>symlink(outside,path.join(f.out,'src'),'dir')}}),'OUTPUT_DIRECTORY_COLLISION');
  await assert.rejects(readFile(path.join(outside,'app.mjs')),{code:'ENOENT'});
  await assert.rejects(readFile(path.join(f.out,'PUBLIC_RELEASE_RECEIPT.json')),{code:'ENOENT'});
});

test('nested directory replacement after retained open fails closed without redirect',async(t)=>{
  const f=await fixture({files:{'src/app.mjs':'export const x=1;\n'}}); t.after(()=>rm(f.base,{recursive:true,force:true})); const outside=path.join(f.base,'outside'); await mkdir(outside); let fired=false;
  await code(buildPublicRelease({root:f.root,manifestPath:f.manifestPath,destination:f.out,sourceCommit:f.sourceCommit,_testHooks:{afterDirectoryOpen:async({relative})=>{if(relative==='src'&&!fired){fired=true; await rename(path.join(f.out,'src'),path.join(f.out,'src-held')); await symlink(outside,path.join(f.out,'src'),'dir');}}}}),'OUTPUT_DIRECTORY_CHANGED');
  await assert.rejects(readFile(path.join(outside,'app.mjs')),{code:'ENOENT'});
  assert.equal(await readFile(path.join(f.out,'src-held','app.mjs'),'utf8'),'export const x=1;\n');
  await assert.rejects(readFile(path.join(f.out,'PUBLIC_RELEASE_RECEIPT.json')),{code:'ENOENT'});
});

test('payload replacement after retained write prevents receipt commit',async(t)=>{
  const f=await fixture({files:{'src/app.mjs':'payload\n'}}); t.after(()=>rm(f.base,{recursive:true,force:true})); const outside=path.join(f.base,'outside.txt'); await writeFile(outside,'foreign\n'); let fired=false;
  await code(buildPublicRelease({root:f.root,manifestPath:f.manifestPath,destination:f.out,sourceCommit:f.sourceCommit,_testHooks:{afterFileWrite:async({relative,kind})=>{if(kind==='payload'&&relative==='src/app.mjs'&&!fired){fired=true; await rename(path.join(f.out,'src','app.mjs'),path.join(f.out,'src','app-held.mjs')); await symlink(outside,path.join(f.out,'src','app.mjs'));}}}}),'OUTPUT_READBACK');
  assert.equal(await readFile(outside,'utf8'),'foreign\n');
  await assert.rejects(readFile(path.join(f.out,'PUBLIC_RELEASE_RECEIPT.json')),{code:'ENOENT'});
});

test('reserved metadata namespaces and file-directory prefix conflicts fail manifest validation',async(t)=>{
  for(const destination of ['PUBLIC_RELEASE_RECEIPT.json','PUBLIC_RELEASE_RECEIPT.json/child','PUBLIC_RELEASE_ABORTED.json','PUBLIC_RELEASE_ABORTED.json/child']){
    const f=await fixture(); t.after(()=>rm(f.base,{recursive:true,force:true}));
    f.manifest.files=[{source:'README.md',destination}]; await writeFile(f.manifestPath,JSON.stringify(f.manifest));
    await code(loadManifest(f.manifestPath),'RESERVED_DESTINATION');
  }
  const f=await fixture(); t.after(()=>rm(f.base,{recursive:true,force:true}));
  f.manifest.files=[{source:'README.md',destination:'tree'},{source:'src/app.mjs',destination:'tree/app.mjs'}]; await writeFile(f.manifestPath,JSON.stringify(f.manifest));
  await code(loadManifest(f.manifestPath),'DESTINATION_PREFIX_CONFLICT');
});

test('production CLI refuses caller-controlled source root and manifest',async()=>{
  for(const forbidden of [['--root','/tmp'],['--manifest','/tmp/manifest.json']]){
    const r=await runCli([...forbidden,'--dest','/tmp/unused-zfr','--source-commit','a'.repeat(40)]);
    assert.notEqual(r.status,0); assert.match(r.stderr,/disabled.*source root and allowlist are code-owned/s);
  }
});

test('root replacement after reserve preserves foreign replacement and tombstones retained root',async(t)=>{
  const f=await fixture(); t.after(()=>rm(f.base,{recursive:true,force:true})); const moved=`${f.out}-moved`;
  await code(buildPublicRelease({root:f.root,manifestPath:f.manifestPath,destination:f.out,sourceCommit:f.sourceCommit,_testHooks:{afterReserve:async()=>{await rename(f.out,moved); await mkdir(f.out); await writeFile(path.join(f.out,'marker'),'foreign\n');}}}),'DESTINATION_IDENTITY_CHANGED');
  assert.equal(await readFile(path.join(f.out,'marker'),'utf8'),'foreign\n');
  const aborted=JSON.parse(await readFile(path.join(moved,'PUBLIC_RELEASE_ABORTED.json'),'utf8'));
  assert.equal(aborted.code,'DESTINATION_IDENTITY_CHANGED');
  await assert.rejects(readFile(path.join(moved,'PUBLIC_RELEASE_RECEIPT.json')),{code:'ENOENT'});
});

test('abort-boundary name swap cannot delete or mark foreign replacement',async(t)=>{
  const f=await fixture(); t.after(()=>rm(f.base,{recursive:true,force:true})); const moved=`${f.out}-moved`;
  await assert.rejects(buildPublicRelease({root:f.root,manifestPath:f.manifestPath,destination:f.out,sourceCommit:f.sourceCommit,_testHooks:{afterReserve:async()=>{throw new Error('forced post-reserve failure');},beforeAbort:async()=>{await rename(f.out,moved); await mkdir(f.out); await writeFile(path.join(f.out,'foreign-sentinel'),'must survive\n');}}}),/forced post-reserve failure/);
  assert.equal(await readFile(path.join(f.out,'foreign-sentinel'),'utf8'),'must survive\n');
  await assert.rejects(readFile(path.join(f.out,'PUBLIC_RELEASE_ABORTED.json')),{code:'ENOENT'});
  const aborted=JSON.parse(await readFile(path.join(moved,'PUBLIC_RELEASE_ABORTED.json'),'utf8'));
  assert.equal(aborted.code,'EXPORT_FAILED');
});

test('legacy final-visibility hook moves root before receipt and tombstones retained inode',async(t)=>{
  const f=await fixture(); t.after(()=>rm(f.base,{recursive:true,force:true})); const moved=`${f.out}-moved`;
  await code(buildPublicRelease({root:f.root,manifestPath:f.manifestPath,destination:f.out,sourceCommit:f.sourceCommit,_testHooks:{beforeFinalVisibilityCheck:async()=>{await rename(f.out,moved); await mkdir(f.out); await writeFile(path.join(f.out,'foreign-sentinel'),'must survive\n');}}}),'DESTINATION_IDENTITY_CHANGED');
  assert.equal(await readFile(path.join(f.out,'foreign-sentinel'),'utf8'),'must survive\n');
  await assert.rejects(readFile(path.join(moved,'PUBLIC_RELEASE_RECEIPT.json')),{code:'ENOENT'});
  const aborted=JSON.parse(await readFile(path.join(moved,'PUBLIC_RELEASE_ABORTED.json'),'utf8'));
  assert.equal(aborted.code,'DESTINATION_IDENTITY_CHANGED');
});

test('lexical destination-parent rebind fails closed and preserves replacement tree',async(t)=>{
  const f=await fixture(); t.after(()=>rm(f.base,{recursive:true,force:true}));
  const parent=path.join(f.base,'dest-parent'), moved=`${parent}-moved`, out=path.join(parent,'public'); await mkdir(parent);
  await code(buildPublicRelease({root:f.root,manifestPath:f.manifestPath,destination:out,sourceCommit:f.sourceCommit,_testHooks:{beforeCompletion:async()=>{
    await rename(parent,moved); await mkdir(parent); await mkdir(out); await writeFile(path.join(out,'foreign'),'survive\n');
  }}}),'DESTINATION_PARENT_CHANGED');
  assert.equal(await readFile(path.join(out,'foreign'),'utf8'),'survive\n');
  await assert.rejects(readFile(path.join(out,'PUBLIC_RELEASE_ABORTED.json')),{code:'ENOENT'});
  const aborted=JSON.parse(await readFile(path.join(moved,'public','PUBLIC_RELEASE_ABORTED.json'),'utf8'));
  assert.equal(aborted.code,'DESTINATION_PARENT_CHANGED');
});

test('same-size payload mutation is caught by exact hash readback before receipt',async(t)=>{
  const f=await fixture({files:{'README.md':'hello\n'}}); t.after(()=>rm(f.base,{recursive:true,force:true}));
  await code(buildPublicRelease({root:f.root,manifestPath:f.manifestPath,destination:f.out,sourceCommit:f.sourceCommit,_testHooks:{beforeCompletion:async()=>{
    await writeFile(path.join(f.out,'README.md'),'HELLO\n');
  }}}),'OUTPUT_READBACK');
  await assert.rejects(readFile(path.join(f.out,'PUBLIC_RELEASE_RECEIPT.json')),{code:'ENOENT'});
  const aborted=JSON.parse(await readFile(path.join(f.out,'PUBLIC_RELEASE_ABORTED.json'),'utf8'));
  assert.equal(aborted.code,'OUTPUT_READBACK');
});

test('unexpected output entry is rejected by exact tree-shape readback',async(t)=>{
  const f=await fixture({files:{'README.md':'hello\n'}}); t.after(()=>rm(f.base,{recursive:true,force:true}));
  await code(buildPublicRelease({root:f.root,manifestPath:f.manifestPath,destination:f.out,sourceCommit:f.sourceCommit,_testHooks:{beforeCompletion:async()=>{
    await writeFile(path.join(f.out,'unexpected.txt'),'foreign\n');
  }}}),'OUTPUT_EXTRA_ENTRY');
  await assert.rejects(readFile(path.join(f.out,'PUBLIC_RELEASE_RECEIPT.json')),{code:'ENOENT'});
});

test('post-receipt filename swap never deletes foreign replacement and invalidates retained receipt fd',async(t)=>{
  const f=await fixture({files:{'README.md':'hello\n'}}); t.after(()=>rm(f.base,{recursive:true,force:true}));
  const held=path.join(f.out,'receipt-held.json');
  await code(buildPublicRelease({root:f.root,manifestPath:f.manifestPath,destination:f.out,sourceCommit:f.sourceCommit,_testHooks:{afterReceiptWrite:async()=>{
    await rename(path.join(f.out,'PUBLIC_RELEASE_RECEIPT.json'),held);
    await writeFile(path.join(f.out,'PUBLIC_RELEASE_RECEIPT.json'),'foreign receipt\n');
  }}}),'OUTPUT_READBACK');
  assert.equal(await readFile(path.join(f.out,'PUBLIC_RELEASE_RECEIPT.json'),'utf8'),'foreign receipt\n');
  assert.equal(await readFile(held,'utf8'),'');
  const aborted=JSON.parse(await readFile(path.join(f.out,'PUBLIC_RELEASE_ABORTED.json'),'utf8'));
  assert.equal(aborted.code,'OUTPUT_READBACK');
});

test('post-receipt root replacement preserves foreign destination and invalidates retained receipt fd',async(t)=>{
  const f=await fixture({files:{'README.md':'hello\n'}}); t.after(()=>rm(f.base,{recursive:true,force:true})); const moved=`${f.out}-moved`;
  await code(buildPublicRelease({root:f.root,manifestPath:f.manifestPath,destination:f.out,sourceCommit:f.sourceCommit,_testHooks:{afterReceiptWrite:async()=>{
    await rename(f.out,moved); await mkdir(f.out); await writeFile(path.join(f.out,'foreign'),'survive\n');
  }}}),'DESTINATION_IDENTITY_CHANGED');
  assert.equal(await readFile(path.join(f.out,'foreign'),'utf8'),'survive\n');
  assert.equal(await readFile(path.join(moved,'PUBLIC_RELEASE_RECEIPT.json'),'utf8'),'');
  const aborted=JSON.parse(await readFile(path.join(moved,'PUBLIC_RELEASE_ABORTED.json'),'utf8'));
  assert.equal(aborted.code,'DESTINATION_IDENTITY_CHANGED');
});
