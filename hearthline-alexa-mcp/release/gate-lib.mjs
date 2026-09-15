import { execFile as execFileCallback } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readFile, realpath, readdir } from 'node:fs/promises';
import path from 'node:path';
import { promisify, TextDecoder } from 'node:util';

const execFile = promisify(execFileCallback);
const UTF8 = new TextDecoder('utf-8', { fatal: true });
const MAX_MANIFEST_BYTES = 1024 * 1024;
const GIT_TEXT_LIMIT = 1024 * 1024;
const BAD_NAMES = new Set(['.env','.env.local','.env.production','.npmrc','.netrc','id_rsa','id_ed25519','credentials','credentials.json','secrets.json','auth.json']);
const BAD_EXT = new Set(['.pem','.key','.p12','.pfx','.jks','.keystore']);
const SECRETS = [
  ['private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['aws-key', /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ['github-token', /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/],
  ['slack-token', /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/],
  ['stripe-secret', /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/],
  ['google-key', /\bAIza[0-9A-Za-z_-]{35}\b/],
  ['bearer-token', /\bBearer\s+[A-Za-z0-9._~+\/-]{20,}={0,2}\b/i],
  ['credential-url', /[?&](?:access_token|api[_-]?key|token)=[A-Za-z0-9._~+\/%-]{8,}/i],
];

export class ReleaseGateError extends Error {
  constructor(code, message) { super(`${code}: ${message}`); this.name='ReleaseGateError'; this.code=code; }
}
const fail = (code, msg) => { throw new ReleaseGateError(code, msg); };
export const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (v) => v === null || typeof v !== 'object' ? JSON.stringify(v) : Array.isArray(v) ? `[${v.map(canonical).join(',')}]` : `{${Object.keys(v).sort().map(k=>`${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
const fdPath = (handle) => `/proc/self/fd/${handle.fd}`;

function safeRel(rel, label) {
  if (typeof rel !== 'string' || !rel || rel.includes('\0') || rel.includes('\\') || /[\x00-\x1f\x7f]/.test(rel) || path.posix.isAbsolute(rel)) fail('UNSAFE_PATH', label);
  const n=path.posix.normalize(rel), parts=rel.split('/');
  if (n!==rel || n==='.' || n==='..' || n.startsWith('../') || parts.some(p=>!p || p==='.' || p==='..')) fail('UNSAFE_PATH', label);
  const base=parts.at(-1).toLowerCase(), ext=path.posix.extname(base);
  if (BAD_NAMES.has(base) || BAD_EXT.has(ext)) fail('UNSAFE_FILENAME', rel);
  return rel;
}
function scan(text, rel) { for(const [name,re] of SECRETS) if(re.test(text)) fail('SECRET_DETECTED',`${name} in ${rel}`); }
function plain(v) { return !!v && typeof v==='object' && !Array.isArray(v); }
function sameIdentity(a,b) { return a.dev===b.dev && a.ino===b.ino; }
function under(root, candidate) { const r=path.relative(root,candidate); return r==='' || (!r.startsWith(`..${path.sep}`) && r!=='..' && !path.isAbsolute(r)); }

function parseManifestText(text) {
  let m; try { m=JSON.parse(text); } catch(e) { if(e instanceof SyntaxError) fail('INVALID_MANIFEST',e.message); throw e; }
  if(!plain(m) || m.version!==1 || typeof m.project!=='string' || !m.project.trim() || !Array.isArray(m.files) || !m.files.length) fail('INVALID_MANIFEST','shape');
  const maxFiles=m.maxFiles??128, maxFileBytes=m.maxFileBytes??2_000_000, maxTotalBytes=m.maxTotalBytes??20_000_000;
  for(const [k,v] of Object.entries({maxFiles,maxFileBytes,maxTotalBytes})) if(!Number.isSafeInteger(v)||v<=0) fail('INVALID_MANIFEST',k);
  if(m.files.length>maxFiles) fail('MANIFEST_LIMIT',String(m.files.length));
  const src=new Set(), dst=new Set();
  const files=m.files.map((e,i)=>{
    if(!plain(e)) fail('INVALID_MANIFEST',`files[${i}]`);
    const source=safeRel(e.source,`files[${i}].source`), destination=safeRel(e.destination??e.source,`files[${i}].destination`);
    if(['PUBLIC_RELEASE_RECEIPT.json','PUBLIC_RELEASE_ABORTED.json'].some(name=>destination===name||destination.startsWith(`${name}/`))) fail('RESERVED_DESTINATION',destination);
    if(src.has(source)) fail('DUPLICATE_SOURCE',source); if(dst.has(destination)) fail('DUPLICATE_DESTINATION',destination);
    src.add(source); dst.add(destination); return {source,destination};
  }).sort((a,b)=>a.destination.localeCompare(b.destination));
  for(const {destination} of files){
    const parts=destination.split('/');
    for(let i=1;i<parts.length;i++) if(dst.has(parts.slice(0,i).join('/'))) fail('DESTINATION_PREFIX_CONFLICT',destination);
  }
  return {project:m.project,maxFiles,maxFileBytes,maxTotalBytes,files};
}

export async function loadManifest(file) {
  let text; try { text=await readFile(file,'utf8'); } catch(e) { throw e; }
  return parseManifestText(text);
}

async function gitBuffer(cwd,args,maxBuffer=GIT_TEXT_LIMIT) {
  try {
    const {stdout}=await execFile('git',['-C',cwd,...args],{encoding:null,maxBuffer});
    return Buffer.isBuffer(stdout)?stdout:Buffer.from(stdout);
  } catch (error) {
    const detail=Buffer.isBuffer(error?.stderr)?error.stderr.toString('utf8').trim():String(error?.stderr??error?.message??'git failed').trim();
    throw new ReleaseGateError('GIT_ERROR',detail||'git failed');
  }
}
async function gitText(cwd,args,maxBuffer=GIT_TEXT_LIMIT) { return (await gitBuffer(cwd,args,maxBuffer)).toString('utf8').trim(); }

async function gitContext(root,sourceCommit) {
  if(typeof sourceCommit!=='string'||!/^[0-9a-f]{40}$/.test(sourceCommit)) fail('INVALID_SOURCE_COMMIT','lowercase 40-hex required');
  let rootReal; try { rootReal=await realpath(root); } catch { fail('INVALID_ROOT','source root must exist'); }
  const sourceHeld=await openHeldDir(rootReal,'SOURCE_ROOT_CHANGED');
  try {
    if(sourceHeld.resolved!==rootReal) fail('SOURCE_ROOT_CHANGED','source root identity drifted during acquisition');
    let gitTop;
    try { gitTop=await gitText(rootReal,['rev-parse','--show-toplevel']); } catch { fail('INVALID_ROOT','source root must be inside a Git worktree'); }
    gitTop=await realpath(gitTop);
    if(!under(gitTop,rootReal)) fail('INVALID_ROOT','source root escaped Git worktree');
    let resolved;
    try { resolved=await gitText(rootReal,['rev-parse','--verify',`${sourceCommit}^{commit}`]); } catch { fail('INVALID_SOURCE_COMMIT','commit does not exist in source repository'); }
    if(resolved!==sourceCommit) fail('INVALID_SOURCE_COMMIT','source commit must resolve exactly');
    const head=await gitText(rootReal,['rev-parse','--verify','HEAD^{commit}']);
    if(head!==sourceCommit) fail('SOURCE_COMMIT_NOT_HEAD',`expected current HEAD ${head}; got ${sourceCommit}`);
    const nativePrefix=path.relative(gitTop,rootReal), prefix=nativePrefix?nativePrefix.split(path.sep).join('/'):'';
    const ctx={rootReal,gitTop,sourceCommit,prefix,sourceHeld};
    await assertSourceRootVisible(ctx);
    return ctx;
  } catch(error){ await sourceHeld.handle.close().catch(()=>{}); throw error; }
}
async function assertSourceRootVisible(ctx){
  await assertLexicalDirIdentity(ctx.rootReal,ctx.sourceHeld,'SOURCE_ROOT_CHANGED');
}
async function assertCurrentHead(ctx){
  await assertSourceRootVisible(ctx);
  const head=await gitText(ctx.rootReal,['rev-parse','--verify','HEAD^{commit}']);
  if(head!==ctx.sourceCommit) fail('SOURCE_HEAD_MOVED',`expected ${ctx.sourceCommit}; actual ${head}`);
  await assertSourceRootVisible(ctx);
}
function gitPath(ctx,rel){ return ctx.prefix?`${ctx.prefix}/${rel}`:rel; }

async function committedEntry(ctx,rel,maxBytes,label=rel) {
  const gp=gitPath(ctx,rel);
  let listing;
  try { listing=await gitBuffer(ctx.gitTop,['ls-tree','-z',ctx.sourceCommit,'--',gp]); } catch { fail('GIT_SOURCE_ERROR',label); }
  const rows=listing.toString('utf8').split('\0').filter(Boolean);
  if(rows.length!==1) fail(rows.length===0?'MISSING_SOURCE':'AMBIGUOUS_SOURCE',label);
  const tab=rows[0].indexOf('\t'); if(tab<0) fail('GIT_SOURCE_ERROR',label);
  const meta=rows[0].slice(0,tab).split(' '), returned=rows[0].slice(tab+1);
  if(meta.length!==3 || returned!==gp) fail('GIT_SOURCE_ERROR',label);
  const [mode,type,object]=meta;
  if(mode==='120000') fail('SYMLINK_SOURCE',rel);
  if(type!=='blob' || !['100644','100755'].includes(mode)) fail('NON_REGULAR_SOURCE',rel);
  if(!/^[0-9a-f]{40}$/.test(object)) fail('GIT_SOURCE_ERROR',label);
  const sizeText=await gitText(ctx.gitTop,['cat-file','-s',object]);
  const size=Number(sizeText);
  if(!Number.isSafeInteger(size)||size<0) fail('GIT_SOURCE_ERROR',label);
  if(size>maxBytes) fail('FILE_TOO_LARGE',rel);
  const bytes=await gitBuffer(ctx.gitTop,['cat-file','blob',object],maxBytes+65536);
  if(bytes.length!==size) fail('GIT_SOURCE_ERROR',`${label} size changed`);
  return {bytes,size,gitBlobSha:object,mode:mode==='100755'?0o755:0o644};
}

async function committedManifest(ctx,manifestPath) {
  const abs=path.resolve(manifestPath), nativeRel=path.relative(ctx.rootReal,abs);
  if(!nativeRel || nativeRel==='..'||nativeRel.startsWith(`..${path.sep}`)||path.isAbsolute(nativeRel)) fail('INVALID_MANIFEST','manifest must be inside source root');
  const rel=safeRel(nativeRel.split(path.sep).join('/'),'manifest path');
  const entry=await committedEntry(ctx,rel,MAX_MANIFEST_BYTES,'release manifest');
  let text; try { text=UTF8.decode(entry.bytes); } catch { fail('INVALID_MANIFEST','manifest must be UTF-8'); }
  return {manifest:parseManifestText(text),rel,gitBlobSha:entry.gitBlobSha,size:entry.size,sha256:sha256(entry.bytes)};
}

async function validateCommitted(ctx,e,limits) {
  const entry=await committedEntry(ctx,e.source,limits.maxFileBytes,e.source);
  let text; try { text=UTF8.decode(entry.bytes); } catch { fail('NON_UTF8_SOURCE',e.source); }
  scan(text,e.source);
  return {...e,...entry,sha256:sha256(entry.bytes)};
}

function requireStableDirSupport(){
  if(!Number.isInteger(constants.O_DIRECTORY)||!Number.isInteger(constants.O_NOFOLLOW)||constants.O_NOFOLLOW===0) fail('PLATFORM_UNSUPPORTED','directory no-follow custody unavailable');
}
const dirFlags=()=>constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW;
const createFileFlags=()=>constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW;

async function openHeldDir(directory,code){
  let handle;
  try { handle=await open(directory,dirFlags()); }
  catch(error){ if(['ELOOP','ENOTDIR','ENOENT'].includes(error?.code)) fail(code,`${directory}: ${error.code}`); throw error; }
  try {
    const stat=await handle.stat({bigint:true});
    if(!stat.isDirectory()) fail(code,`not directory: ${directory}`);
    let resolved; try { resolved=await realpath(fdPath(handle)); } catch { fail('PLATFORM_UNSUPPORTED','/proc/self/fd directory custody unavailable'); }
    return {handle,stat,resolved};
  } catch(error){ await handle.close().catch(()=>{}); throw error; }
}
async function assertLexicalDirIdentity(lexical,retained,code){
  const current=await openHeldDir(lexical,code);
  try {
    if(!sameIdentity(current.stat,retained.stat)||current.resolved!==retained.resolved) fail(code,`directory rebound: ${lexical}`);
    const heldNow=await realpath(fdPath(retained.handle));
    if(heldNow!==retained.resolved) fail(code,`retained directory moved: ${lexical}`);
  } finally { await current.handle.close(); }
}

async function reserveDestination(ctx,destination,hooks={}) {
  requireStableDirSupport();
  await assertSourceRootVisible(ctx);
  if(typeof destination!=='string'||!destination) fail('INVALID_DESTINATION','required');
  const destLex=path.resolve(destination), name=path.basename(destLex), parentLex=path.dirname(destLex);
  let parentReal; try { parentReal=await realpath(parentLex); } catch { fail('INVALID_DESTINATION','destination parent must already exist'); }
  if(parentReal!==parentLex) fail('INVALID_DESTINATION','destination parent ancestry may not contain symlinks');
  const candidate=path.join(parentReal,name);
  if(under(ctx.sourceHeld.resolved,candidate)) fail('INVALID_DESTINATION','destination resolves inside retained source root generation');
  const parentHeld=await openHeldDir(parentLex,'DESTINATION_PARENT_CHANGED');
  let destHeld=null, reserved=false;
  try {
    await assertSourceRootVisible(ctx);
    if(parentHeld.resolved!==parentReal) fail('DESTINATION_PARENT_CHANGED','destination parent identity drifted');
    await assertLexicalDirIdentity(parentLex,parentHeld,'DESTINATION_PARENT_CHANGED');
    const child=path.join(fdPath(parentHeld.handle),name);
    try { await mkdir(child,{mode:0o700}); reserved=true; }
    catch(error){ if(error?.code==='EEXIST') fail('DESTINATION_EXISTS',destLex); throw error; }
    const createdStat=await lstat(child,{bigint:true});
    if(!createdStat.isDirectory()) fail('DESTINATION_CREATION_CHANGED','created destination is not a directory');
    await runHook(hooks,'afterDestinationMkdir',{destination:destLex});
    await parentHeld.handle.sync();
    destHeld=await openHeldDir(child,'DESTINATION_IDENTITY_CHANGED');
    if(!sameIdentity(createdStat,destHeld.stat)) fail('DESTINATION_CREATION_CHANGED','destination generation changed between creation snapshot and retained open');
    const expected=path.join(parentReal,name);
    if(destHeld.resolved!==expected || under(ctx.sourceHeld.resolved,destHeld.resolved)) fail('INVALID_DESTINATION','reserved destination identity invalid');
    destHeld.dirIdentities=new Map();
    const reservation={rootReal:ctx.rootReal,destLex,parentLex,parentReal,name,parentHeld,destHeld,receiptHeld:null};
    await assertSourceRootVisible(ctx);
    await assertReservationVisible(reservation);
    return reservation;
  } catch(error){
    if(destHeld) await destHeld.handle.close().catch(()=>{});
    await parentHeld.handle.close().catch(()=>{});
    if(reserved) error.releaseReservationLeaked=true;
    throw error;
  }
}
async function assertReservationVisible(r){
  await assertLexicalDirIdentity(r.parentLex,r.parentHeld,'DESTINATION_PARENT_CHANGED');
  await assertLexicalDirIdentity(r.destLex,r.destHeld,'DESTINATION_IDENTITY_CHANGED');
  if(r.destHeld.resolved!==path.join(r.parentReal,r.name)) fail('DESTINATION_IDENTITY_CHANGED','destination resolved path drifted');
}
async function runHook(hooks,name,payload){ if(typeof hooks?.[name]==='function') await hooks[name](payload); }

async function retainedOutputParent(rootHeld,relativeFile,{create=false,hooks=null}={}){
  const parts=relativeFile.split('/'), base=parts.pop(); let current=rootHeld, owned=false, rel='';
  rootHeld.dirIdentities??=new Map();
  try {
    for(const segment of parts){
      rel=rel?`${rel}/${segment}`:segment;
      const childLex=path.join(fdPath(current.handle),segment), expected=path.join(current.resolved,segment);
      let createdStat=null;
      if(create && !rootHeld.dirIdentities.has(rel)){
        try { await mkdir(childLex,{mode:0o700}); }
        catch(error){ if(error?.code==='EEXIST') fail('OUTPUT_DIRECTORY_COLLISION',rel); throw error; }
        createdStat=await lstat(childLex,{bigint:true});
        if(!createdStat.isDirectory()) fail('OUTPUT_DIRECTORY_CHANGED',rel);
        await runHook(hooks,'afterDirectoryMkdir',{relative:rel,destination:rootHeld.resolved});
      }
      const child=await openHeldDir(childLex,'OUTPUT_DIRECTORY_CHANGED');
      if(child.resolved!==expected){ await child.handle.close(); fail('OUTPUT_DIRECTORY_CHANGED',`${child.resolved} != ${expected}`); }
      const prior=rootHeld.dirIdentities.get(rel);
      if(createdStat && !sameIdentity(createdStat,child.stat)){ await child.handle.close(); fail('OUTPUT_DIRECTORY_CREATION_CHANGED',rel); }
      if(prior && (!sameIdentity(prior.stat,child.stat)||prior.resolved!==child.resolved)){ await child.handle.close(); fail('OUTPUT_DIRECTORY_CHANGED',rel); }
      if(!prior) rootHeld.dirIdentities.set(rel,{stat:child.stat,resolved:child.resolved});
      if(owned) await current.handle.close(); current=child; owned=true;
      if(create) await runHook(hooks,'afterDirectoryOpen',{relative:rel,destination:rootHeld.resolved});
    }
    return {parent:current,base,owned};
  } catch(error){ if(owned) await current.handle.close().catch(()=>{}); throw error; }
}

async function writeOutput(rootHeld,entry,hooks,kind='payload',{retain=false}={}){
  const held=await retainedOutputParent(rootHeld,entry.destination,{create:true,hooks}); let handle=null, kept=false;
  try {
    const out=path.join(fdPath(held.parent.handle),held.base);
    try { handle=await open(out,createFileFlags(),entry.mode); }
    catch(error){ if(error?.code==='EEXIST'||error?.code==='ELOOP') fail('OUTPUT_COLLISION',entry.destination); throw error; }
    await runHook(hooks,'afterFileOpen',{relative:entry.destination,kind});
    await handle.writeFile(entry.bytes);
    await handle.chmod(entry.mode);
    await handle.sync();
    const stat=await handle.stat({bigint:true});
    if(!stat.isFile()||Number(stat.size)!==entry.size||(Number(stat.mode)&0o777)!==entry.mode) fail('OUTPUT_WRITEBACK',entry.destination);
    await runHook(hooks,'afterFileWrite',{relative:entry.destination,kind});
    if(retain){ kept=true; return {handle,stat,entry}; }
    await handle.close(); handle=null;
    return {entry};
  } finally {
    if(handle&&!kept) await handle.close().catch(()=>{});
    if(held.owned) await held.parent.handle.close().catch(()=>{});
  }
}

async function verifyOutput(rootHeld,entry){
  const held=await retainedOutputParent(rootHeld,entry.destination,{create:false});
  try {
    const out=path.join(fdPath(held.parent.handle),held.base); let handle;
    try { handle=await open(out,constants.O_RDONLY|constants.O_NOFOLLOW); }
    catch(error){ fail('OUTPUT_READBACK',`${entry.destination}: ${error?.code??error}`); }
    try {
      const stat=await handle.stat({bigint:true});
      if(!stat.isFile()||Number(stat.size)!==entry.size||(Number(stat.mode)&0o777)!==entry.mode) fail('OUTPUT_READBACK',entry.destination);
      const bytes=await handle.readFile();
      if(bytes.length!==entry.size||sha256(bytes)!==entry.sha256) fail('OUTPUT_READBACK',entry.destination);
    } finally { await handle.close(); }
  } finally { if(held.owned) await held.parent.handle.close(); }
}

function expectedDirectories(files){
  const dirs=new Set();
  for(const rel of files){ const parts=rel.split('/'); parts.pop(); let cur=''; for(const part of parts){ cur=cur?`${cur}/${part}`:part; dirs.add(cur); } }
  return dirs;
}
async function openExpectedDir(rootHeld,dirRel){
  if(!dirRel) return {held:rootHeld,owned:false};
  const parts=dirRel.split('/'); let current=rootHeld, owned=false;
  try {
    for(const segment of parts){
      const child=await openHeldDir(path.join(fdPath(current.handle),segment),'OUTPUT_DIRECTORY_CHANGED');
      const expected=path.join(current.resolved,segment);
      if(child.resolved!==expected){ await child.handle.close(); fail('OUTPUT_DIRECTORY_CHANGED',dirRel); }
      if(owned) await current.handle.close(); current=child; owned=true;
    }
    return {held:current,owned};
  } catch(error){ if(owned) await current.handle.close().catch(()=>{}); throw error; }
}
async function syncOutputDirectories(rootHeld,expectedFiles){
  const dirs=[...expectedDirectories(expectedFiles)].sort((a,b)=>b.split('/').length-a.split('/').length);
  for(const rel of dirs){ const opened=await openExpectedDir(rootHeld,rel); try { await opened.held.handle.sync(); } finally { if(opened.owned) await opened.held.handle.close(); } }
  await rootHeld.handle.sync();
}
async function verifyTreeShape(rootHeld,expectedFiles){
  const files=new Set(expectedFiles), dirs=expectedDirectories(expectedFiles);
  async function walk(held,prefix=''){
    const entries=(await readdir(fdPath(held.handle),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name));
    for(const entry of entries){
      const rel=prefix?`${prefix}/${entry.name}`:entry.name;
      if(files.has(rel)){ if(!entry.isFile()) fail('OUTPUT_TREE_SHAPE',`${rel} not regular file`); continue; }
      if(dirs.has(rel)){
        const child=await openHeldDir(path.join(fdPath(held.handle),entry.name),'OUTPUT_DIRECTORY_CHANGED');
        try { const expected=path.join(held.resolved,entry.name); if(child.resolved!==expected) fail('OUTPUT_DIRECTORY_CHANGED',rel); await walk(child,rel); }
        finally { await child.handle.close(); }
        continue;
      }
      fail('OUTPUT_EXTRA_ENTRY',rel);
    }
  }
  await walk(rootHeld);
}
async function verifyCandidate(r,entries){
  await assertReservationVisible(r);
  for(const entry of entries) await verifyOutput(r.destHeld,entry);
  await verifyTreeShape(r.destHeld,entries.map(e=>e.destination));
}

async function invalidateRetainedReceipt(r){
  const held=r.receiptHeld;
  if(!held?.handle) return;
  try { await held.handle.truncate(0); await held.handle.sync(); }
  catch{}
}
async function writeAbortMarker(r,cause){
  const marker={schema:'hearthline-public-release-abort/v2',code:typeof cause?.code==='string'?cause.code:'EXPORT_FAILED',message:String(cause?.message??'export failed').slice(0,1024)};
  const out=path.join(fdPath(r.destHeld.handle),'PUBLIC_RELEASE_ABORTED.json'); let handle=null;
  try {
    handle=await open(out,createFileFlags(),0o600);
    const bytes=Buffer.from(`${JSON.stringify(marker,null,2)}\n`);
    await handle.writeFile(bytes); await handle.chmod(0o600); await handle.sync();
  } catch(error){ if(!['EEXIST','ELOOP'].includes(error?.code)) throw error; }
  finally { if(handle) await handle.close().catch(()=>{}); }
}
async function abortReservation(r,testHooks,cause){
  try {
    await runHook(testHooks,'beforeAbort',{destination:r.destLex,cause});
    await invalidateRetainedReceipt(r);
    await writeAbortMarker(r,cause).catch(()=>{});
    await r.destHeld.handle.chmod(0o700).catch(()=>{});
    await r.destHeld.handle.sync().catch(()=>{});
    await r.parentHeld.handle.sync().catch(()=>{});
  } finally { await closeReservation(r); }
}
async function closeReservation(r){
  if(r.receiptHeld?.handle) await r.receiptHeld.handle.close().catch(()=>{});
  await r.destHeld.handle.close().catch(()=>{});
  await r.parentHeld.handle.close().catch(()=>{});
}

export async function buildPublicRelease({root,manifestPath,destination,sourceCommit,_testHooks={}}) {
  const ctx=await gitContext(root,sourceCommit);
  try {
    const committed=await committedManifest(ctx,manifestPath), manifest=committed.manifest;
    const validated=[]; let total=0;
  for(const e of manifest.files){ const v=await validateCommitted(ctx,e,manifest); total+=v.size; if(total>manifest.maxTotalBytes) fail('TOTAL_TOO_LARGE',String(total)); validated.push(v); }
  await assertCurrentHead(ctx);
  const base={
    schema:'hearthline-public-release/v2',project:manifest.project,sourceCommit:ctx.sourceCommit,sourceCommitProvenance:'CURRENT_HEAD_EXACT_GIT_OBJECT',
    manifest:{source:committed.rel,gitBlobSha:committed.gitBlobSha,size:committed.size,sha256:committed.sha256},
    files:validated.map(({source,destination,size,sha256,gitBlobSha,mode})=>({source,destination,size,sha256,gitBlobSha,mode})),
    totals:{files:validated.length,bytes:total},publicationProtocol:'retained-tree-custody/v4',destinationGenerationProvenance:'RETAINED_POST_RESERVATION_OBSERVATION_CREATOR_UNAUTHENTICATED',
  };
  const receipt={...base,receiptSha256:sha256(canonical(base))};
  await runHook(_testHooks,'afterValidation',{receipt});
  await assertCurrentHead(ctx);
  const reservation=await reserveDestination(ctx,destination,_testHooks); let completed=false, failure=null;
  try {
    await runHook(_testHooks,'afterReserve',{destination:reservation.destLex});
    await assertReservationVisible(reservation);
    for(const v of validated) await writeOutput(reservation.destHeld,v,_testHooks,'payload');
    await syncOutputDirectories(reservation.destHeld,validated.map(v=>v.destination));
    await runHook(_testHooks,'beforeCompletion',{destination:reservation.destLex,destinationFdPath:fdPath(reservation.destHeld.handle),receipt});
    await assertCurrentHead(ctx);
    await verifyCandidate(reservation,validated);
    await runHook(_testHooks,'beforeReceipt',{destination:reservation.destLex,receipt});
    await assertCurrentHead(ctx);
    // Keep the legacy hook before receipt so the inherited #125 hostile remains deterministic;
    // post-receipt races are exercised by afterReceiptWrite and the unhooked final visibility fence below.
    await runHook(_testHooks,'beforeFinalVisibilityCheck',{destination:reservation.destLex});
    await assertReservationVisible(reservation);
    const receiptBytes=Buffer.from(`${JSON.stringify(receipt,null,2)}\n`);
    const receiptEntry={destination:'PUBLIC_RELEASE_RECEIPT.json',bytes:receiptBytes,size:receiptBytes.length,sha256:sha256(receiptBytes),mode:0o644};
    reservation.receiptHeld=await writeOutput(reservation.destHeld,receiptEntry,_testHooks,'receipt',{retain:true});
    await reservation.destHeld.handle.sync();
    await reservation.parentHeld.handle.sync();
    await runHook(_testHooks,'afterReceiptWrite',{destination:reservation.destLex,receipt});
    await assertCurrentHead(ctx);
    await verifyCandidate(reservation,[...validated,receiptEntry]);
    await reservation.destHeld.handle.chmod(0o755);
    await reservation.destHeld.handle.sync();
    await reservation.parentHeld.handle.sync();
    await assertCurrentHead(ctx);
    await verifyCandidate(reservation,[...validated,receiptEntry]);
    completed=true;
    await closeReservation(reservation);
    return receipt;
  } catch(error) {
    failure=error;
    throw error;
    } finally {
      if(!completed) await abortReservation(reservation,_testHooks,failure);
    }
  } finally {
    await ctx.sourceHeld.handle.close().catch(()=>{});
  }
}
