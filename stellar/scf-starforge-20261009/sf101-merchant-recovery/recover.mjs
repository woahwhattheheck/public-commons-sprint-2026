// MIT. Offline encrypted, create-only merchant-state snapshot, verification and restore.
// Source directories must be quiesced by their original owners before snapshot.
import { createReadStream, createWriteStream, constants } from 'node:fs';
import { mkdir, lstat, readdir, rm, writeFile, open } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { createHash, createHmac, timingSafeEqual, createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCb } from 'node:crypto';
import { pipeline } from 'node:stream/promises';
import { Transform, Writable } from 'node:stream';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb);
const SCHEMA = 'stellar-forge.merchant-recovery.v1';
const PLAN_SCHEMA = 'stellar-forge.merchant-recovery-plan.v1';
const MAX_FILES = 10000;
const MAX_TOTAL = 4 * 1024 ** 3;
const MAX_FILE = 2 * 1024 ** 3;
const MAX_DEPTH = 16;
const MAX_MANIFEST = 12 * 1024 ** 2;
const NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const hex = (b) => b.toString('hex');
const sha = () => createHash('sha256');
const own = (x, key) => Object.prototype.hasOwnProperty.call(x, key);
const fail = (s) => { throw new Error(s); };
const fileId = (index) => `objects/${String(index).padStart(6, '0')}.gcm`;
const isObject = x => x && typeof x === 'object' && !Array.isArray(x);

function argumentsOf(argv) {
  const [command, ...rest] = argv;
  if (!['snapshot', 'verify', 'restore'].includes(command)) fail('Usage: recover.mjs snapshot|verify|restore --plan|--bundle PATH --out PATH --pass-env NAME [--quiesced]');
  const opts = {};
  for (let i = 0; i < rest.length; i++) {
    let k = rest[i];
    if (k === '--quiesced') { if (opts[k]) fail('Duplicate --quiesced'); opts[k] = true; continue; }
    if (!['--plan', '--bundle', '--out', '--pass-env'].includes(k) || !rest[i+1] || rest[i+1].startsWith('--') || own(opts,k)) fail('Invalid/duplicate option '+k);
    opts[k] = rest[++i];
  }
  const allowed = command === 'snapshot' ? ['--plan','--out','--pass-env','--quiesced'] :
    command === 'restore' ? ['--bundle','--out','--pass-env'] : ['--bundle','--pass-env'];
  if (Object.keys(opts).some(k => !allowed.includes(k)) || !opts['--pass-env'] ||
     (command === 'snapshot' && (!opts['--plan'] || !opts['--out'] || !opts['--quiesced'])) ||
     (command === 'restore' && (!opts['--bundle'] || !opts['--out'])) ||
     (command === 'verify' && !opts['--bundle'])) fail('Missing or unsupported arguments for '+command);
  if (!/^[A-Z][A-Z0-9_]{4,63}$/.test(opts['--pass-env'])) fail('Passphrase env variable name must be uppercase');
  for (const key of ['--plan','--bundle','--out']) if (opts[key] && !isAbsolute(opts[key])) fail(key+' must be absolute');
  return { command, opts };
}
function password(name) {
  const value = process.env[name];
  if (typeof value !== 'string' || Buffer.byteLength(value) < 16) fail('Missing or too-short private passphrase env');
  return value;
}
async function keyFor(pass, salt) {
  return await scrypt(pass, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 << 20 });
}
async function safeJSON(file, max) {
  const st = await lstat(file);
  if (!st.isFile() || st.isSymbolicLink() || st.size > max || st.nlink !== 1) fail('Unsafe JSON input');
  const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { return JSON.parse((await fd.readFile({encoding:'utf8'}))); } finally { await fd.close(); }
}
async function safeDir(path) {
  const st = await lstat(path);
  if (!st.isDirectory() || st.isSymbolicLink()) fail('Expected private real directory');
  return path;
}
function inside(a,b) { return a === b || b.startsWith(a+sep); }
async function inventory(planPath, out) {
  const plan = await safeJSON(planPath, 256 * 1024);
  if (!isObject(plan) || plan.schema !== PLAN_SCHEMA || !Array.isArray(plan.roots) ||
      plan.roots.length < 1 || plan.roots.length > 20) fail('Invalid recovery plan');
  const roots = [], names = new Set();
  for (const r of plan.roots) {
    if (!isObject(r) || !NAME.test(r.name) || names.has(r.name) ||
        !isAbsolute(r.path) || r.path.includes('\0') || resolve(r.path) !== r.path) fail('Invalid root mapping');
    names.add(r.name);
    const st = await lstat(r.path);
    if (st.isSymbolicLink() || (!st.isDirectory() && !st.isFile())) fail('Source must be a real file/directory');
    if (st.isFile() && st.nlink !== 1) fail('Hardlinked source refused');
    roots.push({name:r.name, absolute:r.path, kind: st.isFile()?'file':'directory'});
  }
  for (let i=0;i<roots.length;i++) for (let j=i+1;j<roots.length;j++) {
    if (inside(roots[i].absolute,roots[j].absolute) || inside(roots[j].absolute,roots[i].absolute)) fail('Overlapping source roots');
  }
  if (roots.some(r=>inside(r.absolute,out)||inside(out,r.absolute))) fail('Bundle cannot overlap a source root');
  const entries = []; let total = 0;
  async function walk(source, logical, depth) {
    if (depth > MAX_DEPTH) fail('Directory nesting limit exceeded');
    const st = await lstat(source);
    if (st.isSymbolicLink() || (!st.isFile() && !st.isDirectory())) fail('Symlink/socket/device refused');
    if (entries.length >= MAX_FILES) fail('File count limit exceeded');
    if (st.isFile()) {
      if (st.nlink !== 1 || st.size > MAX_FILE) fail('Hardlinked or oversized source file');
      total += st.size; if (total > MAX_TOTAL) fail('Bundle uncompressed size limit exceeded');
      entries.push({source, path:logical, kind:'file', size:st.size});
    } else {
      entries.push({source, path:logical, kind:'directory'});
      const children = (await readdir(source)).sort();
      for (const child of children) {
        if (child === '.' || child === '..' || child.includes('/') || child.includes('\\')) fail('Invalid source filename');
        await walk(join(source,child),logical+'/'+child,depth+1);
      }
    }
  }
  for (const r of roots) await walk(r.absolute,r.name,0);
  return { roots:roots.map(({name,kind})=>({name,kind})), entries, total };
}
function hashStream(hash) {
  return new Transform({transform(chunk,enc,cb){hash.update(chunk);cb(null,chunk)}});
}
async function digestFile(path) {
  const h=sha();
  const fd=await open(path, constants.O_RDONLY|constants.O_NOFOLLOW);
  try { await pipeline(fd.createReadStream({autoClose:false}),hashStream(h),new Writable({write(_chunk,_enc,cb){cb();}}));}
  finally {await fd.close();}
  return h.digest('hex');
}
function manifestMac(manifest,key) {
  const unsigned={...manifest}; delete unsigned.manifestMac;
  return createHmac('sha256',key).update('stellar-forge.sf101.manifest.v1\0').update(JSON.stringify(unsigned)).digest('hex');
}
async function syncFile(path) {
  const fd = await open(path,constants.O_RDONLY | constants.O_NOFOLLOW);
  try { await fd.sync(); } finally { await fd.close(); }
}
async function encryptSource(source,dest,key) {
  const before = await lstat(source);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) fail('Source changed to unsafe file');
  const fd = await open(source, constants.O_RDONLY | constants.O_NOFOLLOW);
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm',key,iv);
  const plaintext = sha();
  try {
    const statBefore = await fd.stat();
    if (!statBefore.isFile() || statBefore.nlink !== 1 || statBefore.size !== before.size) fail('Source changed before capture');
    await pipeline(fd.createReadStream({autoClose:false}),hashStream(plaintext),cipher,
      createWriteStream(dest,{flags:'wx',mode:0o600}));
    const after = await fd.stat();
    if (after.size !== statBefore.size || after.mtimeMs !== statBefore.mtimeMs || after.ctimeMs !== statBefore.ctimeMs) fail('Source mutated during capture');
  } finally { await fd.close(); }
  await syncFile(dest);
  return {iv:hex(iv),tag:hex(cipher.getAuthTag()),sha256:plaintext.digest('hex'),cipherSha256:await digestFile(dest)};
}
async function makeSnapshot(opts) {
  const output = resolve(opts['--out']);
  const {roots,entries,total} = await inventory(opts['--plan'],output);
  const pass = password(opts['--pass-env']);
  const salt = randomBytes(32), key = await keyFor(pass,salt);
  let created = false;
  try {
    await mkdir(output,{mode:0o700}); created = true;
    await mkdir(join(output,'objects'),{mode:0o700});
    const manifest = {schema:SCHEMA,createdAt:new Date().toISOString(),
      kdf:{name:'scrypt',N:32768,r:8,p:1,salt:hex(salt)},cipher:'aes-256-gcm',
      roots,entries:[],fileCount:0,totalPlainBytes:total};
    for (const item of entries) {
      if (item.kind === 'directory') { manifest.entries.push({path:item.path,kind:'directory'}); continue; }
      const id = fileId(++manifest.fileCount);
      const hashes = await encryptSource(item.source,join(output,id),key);
      manifest.entries.push({path:item.path,kind:'file',size:item.size,object:id,...hashes});
    }
    manifest.manifestMac=manifestMac(manifest,key);
    await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o600});
    await syncFile(join(output,'manifest.json'));
    return {status:'SNAPSHOT_CREATED',bundle:output,files:manifest.fileCount,bytes:total,roots:roots.map(r=>r.name)};
  } catch(e) {if(created) await rm(output,{recursive:true,force:true}); throw e;}
  finally {key.fill(0);}
}
function validPath(p){
  return typeof p === 'string' && p.length <= 2048 && !p.includes('\\') &&
    p.split('/').every(x=>x && x !== '.' && x !== '..' && !x.includes('\0'));
}
function validateManifest(m) {
  if (!isObject(m) || m.schema !== SCHEMA || m.cipher !== 'aes-256-gcm' ||
      !isObject(m.kdf) || m.kdf.name !== 'scrypt' || m.kdf.N !== 32768 ||
      m.kdf.r !== 8 || m.kdf.p !== 1 || !/^[a-f0-9]{64}$/.test(m.kdf.salt ?? '') ||
      !Array.isArray(m.roots) || !Array.isArray(m.entries) || m.roots.length<1 || m.roots.length>20 ||
      m.entries.length>MAX_FILES || !/^[a-f0-9]{64}$/.test(m.manifestMac??'') || !Number.isSafeInteger(m.fileCount) ||
      !Number.isSafeInteger(m.totalPlainBytes) || m.totalPlainBytes<0 || m.totalPlainBytes>MAX_TOTAL) fail('Bad recovery manifest');
  const names = new Set();
  for(const r of m.roots){if(!isObject(r)||!NAME.test(r.name)||names.has(r.name)||!['file','directory'].includes(r.kind)) fail('Invalid manifest root');names.add(r.name);}
  let files=0, bytes=0; const known = new Set(), items = new Map();
  for(const e of m.entries){
    if(!isObject(e)||!validPath(e.path)||known.has(e.path)||!['file','directory'].includes(e.kind)||
       !names.has(e.path.split('/')[0])) fail('Unsafe manifest path');
    known.add(e.path); items.set(e.path,e.kind);
    if(e.kind==='file'){
      files++; bytes+=e.size;
      if(!Number.isSafeInteger(e.size)||e.size<0||e.size>MAX_FILE||e.object!==fileId(files)||
         !/^[a-f0-9]{64}$/.test(e.sha256??'')||!/^[a-f0-9]{64}$/.test(e.cipherSha256??'')||
         !/^[a-f0-9]{24}$/.test(e.iv??'')||!/^[a-f0-9]{32}$/.test(e.tag??'')) fail('Invalid encrypted entry');
    }
  }
  if(files!==m.fileCount||bytes!==m.totalPlainBytes) fail('Manifest count/size mismatch');
  for(const e of m.entries){
    const parts=e.path.split('/');
    for(let i=1;i<parts.length;i++) if(items.get(parts.slice(0,i).join('/'))!=='directory') fail('Missing parent directory');
  }
  for(const r of m.roots) if(items.get(r.name)!==r.kind) fail('Missing root entry');
  return m;
}
async function loadBundle(bundle){
  await safeDir(bundle);
  const m=validateManifest(await safeJSON(join(bundle,'manifest.json'),MAX_MANIFEST));
  const objDir=join(bundle,'objects');await safeDir(objDir);
  return m;
}
async function decryptEntry(bundle,e,key,destination=null){
  const file = join(bundle,e.object), info=await lstat(file);
  if(!info.isFile()||info.isSymbolicLink()||info.nlink!==1||info.size>MAX_FILE+64) fail('Unsafe encrypted object');
  const fd=await open(file,constants.O_RDONLY|constants.O_NOFOLLOW);
  const cipherHash=sha(), plainHash=sha(), decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(e.iv,'hex'));
  decipher.setAuthTag(Buffer.from(e.tag,'hex'));
  let size=0;
  const collector = new Transform({transform(chunk,enc,cb){size+=chunk.length;if(size>e.size)return cb(new Error('Size mismatch'));plainHash.update(chunk);cb(null,chunk)}});
  try{
    if(destination){
      await pipeline(fd.createReadStream({autoClose:false}),hashStream(cipherHash),decipher,collector,
        createWriteStream(destination,{flags:'wx',mode:0o600}));
    } else {
      await pipeline(fd.createReadStream({autoClose:false}),hashStream(cipherHash),decipher,collector,
        new Writable({write(_chunk,_enc,cb){cb();}}));
    }
  } finally {await fd.close();}
  if(size!==e.size||plainHash.digest('hex')!==e.sha256||cipherHash.digest('hex')!==e.cipherSha256) fail('Snapshot content digest mismatch');
  if(destination) await syncFile(destination);
}
async function verifyBundle(opts,returnKey=false){
  const bundle=resolve(opts['--bundle']);
  const m=await loadBundle(bundle);
  const key=await keyFor(password(opts['--pass-env']),Buffer.from(m.kdf.salt,'hex'));
  try {
    if(!timingSafeEqual(Buffer.from(m.manifestMac,'hex'),Buffer.from(manifestMac(m,key),'hex'))) fail('Manifest authentication failed');
    for(const e of m.entries) if(e.kind==='file') await decryptEntry(bundle,e,key);
    if(returnKey) return {m,key,bundle};
    return {status:'SNAPSHOT_VERIFIED',files:m.fileCount,bytes:m.totalPlainBytes,roots:m.roots.map(r=>r.name)};
  } finally {if(!returnKey) key.fill(0);}
}
async function restoreBundle(opts){
  // Authentication and complete source integrity are established BEFORE output creation.
  const {m,key,bundle} = await verifyBundle(opts,true);
  const output=resolve(opts['--out']);let created=false;
  try {
    if(inside(bundle,output)||inside(output,bundle)) fail('Restore path overlaps backup');
    await mkdir(output,{mode:0o700});created=true;
    for(const e of m.entries){
      const target=join(output,...e.path.split('/'));
      if(e.kind==='directory') await mkdir(target,{mode:0o700});
      else await decryptEntry(bundle,e,key,target);
    }
    return {status:'RESTORED_TO_NEW_DIR',destination:output,files:m.fileCount,bytes:m.totalPlainBytes};
  } catch(e){if(created)await rm(output,{recursive:true,force:true});throw e;}
  finally {key.fill(0);}
}

export async function run(argv=process.argv.slice(2)) {
  const {command,opts}=argumentsOf(argv);
  if(command==='snapshot') return await makeSnapshot(opts);
  if(command==='verify') return await verifyBundle(opts);
  return await restoreBundle(opts);
}
if(process.argv[1] && import.meta.url===new URL('file://'+resolve(process.argv[1])).href){
  run().then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(e=>{console.error('RECOVERY_ERROR: '+e.message);process.exitCode=1;});
}
