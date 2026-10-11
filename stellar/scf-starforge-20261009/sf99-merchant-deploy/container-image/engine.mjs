// MIT. Explicit local Docker image operations with source and image identity joins.
import { createReadStream } from 'node:fs';
import { mkdir, rename, lstat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { hostname } from 'node:os';
import { checkContext, acceptLock, contextIdentity, absolute, need, readJSON, writeJSON,
  RECEIPT_SCHEMA, PORTABLE_SCHEMA } from './image.mjs';

const IMAGE = /^sha256:[a-f0-9]{64}$/;
const LABEL_CONTEXT = 'org.tokenjunkielabs.starforge.context-sha256';
const FORMAT = '{"imageId":{{json .Id}},"os":{{json .Os}},"architecture":{{json .Architecture}},' +
  '"repoDigests":{{json .RepoDigests}},"contextSha256":{{json (index .Config.Labels "' + LABEL_CONTEXT + '")}},' +
  '"sourceCommit":{{json (index .Config.Labels "org.opencontainers.image.revision")}},' +
  '"archiveSha256":{{json (index .Config.Labels "org.tokenjunkielabs.starforge.archive-sha256")}}}';
const exists = async path => { try { await lstat(path); return true; } catch(error) { if(error.code === 'ENOENT') return false; throw error; } };
const stamp = () => new Date().toISOString();

/** argv is always passed directly, without a shell or environment serialization. */
export function command(program, args, { cwd, stream = false, allowFailure = false } = {}) {
  return new Promise((resolveResult,reject) => {
    const child = spawn(program,args,{cwd,stdio:['ignore','pipe','pipe']});
    const interrupt = () => child.kill('SIGINT'), terminate = () => child.kill('SIGTERM');
    const cleanup = () => { process.off('SIGINT',interrupt); process.off('SIGTERM',terminate); };
    process.on('SIGINT',interrupt); process.on('SIGTERM',terminate);
    let stdout = '', stderr = '';
    const collect = target => chunk => {
      if (stream) (target === 'stdout' ? process.stdout : process.stderr).write(chunk);
      if (target === 'stdout') stdout = (stdout + chunk).slice(-2*1024*1024);
      else stderr = (stderr + chunk).slice(-65536);
    };
    child.stdout.on('data',collect('stdout')); child.stderr.on('data',collect('stderr'));
    child.once('error',error => { cleanup(); reject(error); });
    child.once('close',(code,signal) => {
      cleanup();
      const result = {code,signal,stdout,stderr};
      if (!allowFailure && code !== 0) {
        const error = new Error(program + ' ' + args[0] + ' failed (' + (signal ?? code) + '): ' + stderr.trim().slice(-2000));
        error.result = result; reject(error);
      } else resolveResult(result);
    });
  });
}
function engineName(value) {
  need(typeof value === 'string' && value && !value.startsWith('-') && !/[\x00-\x1f]/.test(value), 'Docker executable required');
  return value;
}
async function inspectImage(engine, image, optional = false) {
  const result = await command(engine,['image','inspect','--format',FORMAT,image],{allowFailure:optional});
  if (result.code !== 0) {
    if (optional && /no such (?:image|object)/i.test(result.stderr)) return null;
    throw new Error('Docker image inspect failed: ' + result.stderr.trim().slice(-2000));
  }
  let inspected; try { inspected = JSON.parse(result.stdout); } catch { throw new Error('Invalid Docker image identity response'); }
  need(IMAGE.test(inspected.imageId ?? ''), 'Docker did not return an immutable image ID');
  return inspected;
}
function matches(image, receipt) {
  need(image.imageId === receipt.imageId && image.contextSha256 === receipt.contextSha256 &&
    image.sourceCommit === receipt.release.sourceCommit && image.archiveSha256 === receipt.release.archiveSha256 &&
    image.os === 'linux' && image.architecture === receipt.platform.split('/')[1],
    'Docker image differs from its selected source/runtime receipt');
  return image;
}
async function fileDigest(file) {
  const stat = await lstat(file);
  need(stat.isFile() && !stat.isSymbolicLink(), 'Regular portable image file required');
  const hash = createHash('sha256'); let bytes = 0;
  for await (const chunk of createReadStream(file)) { hash.update(chunk); bytes += chunk.length; }
  need(bytes === stat.size, 'Image archive changed while reading');
  return {sha256:hash.digest('hex'),bytes};
}
function receiptFor(p, image, base) {
  return { schema:RECEIPT_SCHEMA,status:'BUILT',imageId:image.imageId,
    localTag:'starforge/' + p.id + ':' + p.release.sourceCommit.slice(0,12) + '-' + contextIdentity(p).slice(0,12),
    contextSha256:contextIdentity(p),baseImage:p.baseImage,baseImageId:base.imageId,
    platform:p.platform,sourceRoot:p.sourceRoot,dependencyRoot:p.dependencyRoot,runtime:p.runtime,
    uid:p.uid,gid:p.gid,features:p.features,dependencies:p.dependencies,pythonModules:p.pythonModules,
    runtimeProfileId:p.profile.profileId,sourceModes:p.sourceModes,
    lockSha256:p.lockSha256,release:p.release,builtAt:stamp() };
}

export async function lockImage(directory, { npm = 'npm', lockFile = null, stream = false } = {}) {
  const p = await checkContext(directory,{requireLock:false});
  if (p.status === 'LOCKED') {
    const checked = await checkContext(directory);
    return {status:'RUNTIME_DEPENDENCIES_LOCKED',directory:checked.directory,lockSha256:checked.lockSha256,
      packages:checked.lockedPackages,dependencies:checked.dependencies};
  }
  if (lockFile) return await acceptLock(p.directory,lockFile);
  if (!await exists(join(p.directory,'package-lock.json'))) {
    await command(npm,['install','--global=false','--location=project','--workspaces=false',
      '--prefix',p.directory,'--package-lock-only','--package-lock=true','--ignore-scripts',
      '--omit=dev','--omit=optional','--no-audit','--no-fund'],{cwd:p.directory,stream});
  }
  return await acceptLock(p.directory);
}

export async function buildImage(directory, { engine = 'docker', stream = true } = {}) {
  engineName(engine);
  const p = await checkContext(directory), identity = contextIdentity(p);
  const receiptFile = join(p.directory,'image-receipt.json');
  if (await exists(receiptFile)) {
    const receipt = await readJSON(receiptFile);
    need(receipt.schema === RECEIPT_SCHEMA && receipt.contextSha256 === identity, 'Existing image receipt belongs to another context');
    matches(await inspectImage(engine,receipt.imageId),receipt);
    return {...receipt,status:'IMAGE_ALREADY_BUILT'};
  }
  const base = await inspectImage(engine,p.baseImage);
  need(base.os === 'linux' && base.architecture === p.platform.split('/')[1], 'Selected base image platform does not match the plan');
  need((base.repoDigests ?? []).some(value => value.slice(value.indexOf('@')+1) === p.baseImage.slice(p.baseImage.indexOf('@')+1)),
    'Selected base digest is not present in the local image store');
  const localTag = 'starforge/' + p.id + ':' + p.release.sourceCommit.slice(0,12) + '-' + identity.slice(0,12);
  let image = await inspectImage(engine,localTag,true);
  if (image) need(image.contextSha256 === identity && image.sourceCommit === p.release.sourceCommit &&
    image.archiveSha256 === p.release.archiveSha256, 'Existing generated image tag belongs to another build');
  if (!image) {
    const operationFile = join(p.directory,'image-build.json');
    if (await exists(operationFile)) {
      const previous = await readJSON(operationFile);
      need(previous.contextSha256 === identity, 'Existing build operation belongs to another context');
      if (previous.status === 'BUILDING' && previous.host === hostname()) {
        let alive = false;
        try { process.kill(previous.pid,0); alive = true; } catch(error) { if(error.code !== 'ESRCH') throw error; }
        need(!alive, 'The original image build process is still active: ' + previous.pid);
      }
    }
    await writeJSON(operationFile,{status:'BUILDING',contextSha256:identity,pid:process.pid,host:hostname(),startedAt:stamp()},false);
    try {
      await command(engine,['build','--pull=false','--platform',p.platform,'--file',join(p.directory,'Dockerfile'),
        '--tag',localTag,'--label',LABEL_CONTEXT + '=' + identity,p.directory],{stream});
      image = await inspectImage(engine,localTag);
      need(image.contextSha256 === identity, 'Built image lacks its original context identity');
      await writeJSON(operationFile,{status:'BUILT',contextSha256:identity,imageId:image.imageId,completedAt:stamp()},false);
    } catch(error) {
      await writeJSON(operationFile,{status:'RECONCILE',contextSha256:identity,localTag,failedAt:stamp(),
        error:String(error.message).slice(-2000)},false);
      throw error;
    }
  }
  const receipt = receiptFor(p,image,base);
  matches(image,receipt);
  await writeJSON(receiptFile,receipt);
  return receipt;
}

export async function imageStatus(directory, {engine='docker'} = {}) {
  engineName(engine);
  const p = await checkContext(directory), receipt = await readJSON(join(p.directory,'image-receipt.json'));
  need(receipt.schema === RECEIPT_SCHEMA && receipt.contextSha256 === contextIdentity(p), 'Original image receipt required');
  const image = matches(await inspectImage(engine,receipt.imageId),receipt);
  return {...receipt,status:'IMAGE_PRESENT',image};
}

export async function exportImage(directory, output, {engine='docker',stream=true} = {}) {
  engineName(engine);
  const receipt = await imageStatus(directory,{engine});
  const out = absolute(resolve(output),'new image transfer directory');
  await mkdir(out,{mode:0o700});
  const partial = join(out,'image.tar.partial'), archive = join(out,'image.tar');
  // Saving by immutable ID cannot race a mutable tag update.
  await command(engine,['image','save','--output',partial,receipt.imageId],{stream});
  const data = await fileDigest(partial);
  await rename(partial,archive);
  const portable = {schema:PORTABLE_SCHEMA,status:'IMAGE_EXPORTED',exportedAt:stamp(),
    image:{...receipt,status:'BUILT',image:undefined},archive:{file:'image.tar',...data}};
  await writeJSON(join(out,'image-bundle.json'),portable);
  return {...portable,directory:out};
}

export async function importImage(directory, {engine='docker',stream=true} = {}) {
  engineName(engine);
  directory = absolute(resolve(directory),'image transfer directory');
  const portable = await readJSON(join(directory,'image-bundle.json'));
  need(portable.schema === PORTABLE_SCHEMA && portable.image?.schema === RECEIPT_SCHEMA &&
    IMAGE.test(portable.image.imageId ?? '') && portable.archive?.file === 'image.tar' &&
    /^[a-f0-9]{64}$/.test(portable.archive.sha256 ?? '') &&
    Number.isSafeInteger(portable.archive.bytes) && portable.archive.bytes > 0,
    'Original portable image manifest required');
  const archive = join(directory,'image.tar'), actual = await fileDigest(archive);
  need(actual.sha256 === portable.archive.sha256 && actual.bytes === portable.archive.bytes,
    'Portable image bytes differ from the original export');
  let image = await inspectImage(engine,portable.image.imageId,true);
  const existing = !!image;
  if (!image) {
    await command(engine,['image','load','--input',archive],{stream});
    image = await inspectImage(engine,portable.image.imageId);
  }
  matches(image,portable.image);
  const tag = portable.image.localTag;
  need(/^starforge\/[a-z][a-z0-9-]{0,39}:[a-f0-9]{12}-[a-f0-9]{12}$/.test(tag ?? ''), 'Original generated image tag required');
  const tagged = await inspectImage(engine,tag,true);
  need(!tagged || tagged.imageId === image.imageId, 'The target image tag already names a different image');
  if (!tagged) await command(engine,['image','tag',image.imageId,tag],{stream});
  matches(await inspectImage(engine,image.imageId),portable.image);
  return {status:existing?'IMAGE_ALREADY_PRESENT':'IMAGE_IMPORTED',imageId:image.imageId,localTag:tag,
    contextSha256:portable.image.contextSha256,release:portable.image.release,
    sourceRoot:portable.image.sourceRoot,dependencyRoot:portable.image.dependencyRoot,
    runtime:portable.image.runtime,platform:portable.image.platform,
    sourceModes:portable.image.sourceModes,archive:actual};
}
