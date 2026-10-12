// MIT. Retained WFS XML and unchanged feature pages over the original public transport.
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { link, unlink, lstat } from 'node:fs/promises';
import { createPublicHttpsFetch, normalizeBuyerTransport } from '../../sf31-buyer-client/public-transport.mjs';
import { privateDirectory, acquireWorkspace, readPrivate, readJson, createFile, atomicJson,
  digest, identity, stamp, fault, syncDirectory, bytes as jsonBytes } from '../postgres/publisher/files.mjs';
import { capture } from '../ogc/source.mjs';
import { endpointUrl } from './protocol.mjs';

const XML_LIMIT = 8 * 1024 * 1024;
const need = (yes, code, message = code) => { if (!yes) throw fault(code,message); };
export async function optionalJson(path, maximum = 4 * 1024 * 1024) {
  try { return await readJson(path,maximum); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
export async function reconcileRetainedFile(path, sha256) {
  need(/^[a-f0-9]{64}$/.test(sha256 ?? ''),'WFS_RETAINED_HASH_REQUIRED');
  const directory = dirname(path), staged = join(directory,'.wfs-staged-'+identity({path,sha256}));
  // Every caller owns its enclosing project/document lease. Recover only this
  // exact member's staged inode, including a kill between link and unlink.
  let partial;
  try {partial = await lstat(staged);} catch (error) {if (error.code !== 'ENOENT') throw error;}
  if (partial) {
    need(partial.isFile() && !partial.isSymbolicLink() && !(partial.mode & 0o077) &&
      [1,2].includes(partial.nlink),'WFS_STAGED_MEMBER_INVALID');
    let final;try {final = await lstat(path);} catch (error) {if (error.code !== 'ENOENT') throw error;}
    need(partial.nlink === 1 || (final?.isFile() && !final.isSymbolicLink() &&
      partial.dev === final.dev && partial.ino === final.ino),'WFS_STAGED_MEMBER_INVALID');
    await unlink(staged);await syncDirectory(directory);
  }
  return staged;
}
export async function exactFile(path, value) {
  need(Buffer.isBuffer(value),'WFS_RETAINED_BYTES_REQUIRED');
  const directory = dirname(path), staged = await reconcileRetainedFile(path,digest(value));
  try {const previous = await readPrivate(path,value.length);
    need(previous.equals(value),'WFS_RETAINED_FILE_CHANGED','Keep the original retained member: ' + path);return;
  } catch (error) {if (error.code !== 'ENOENT') throw error;}
  try {
    await createFile(staged,value);
    try {await link(staged,path);} catch (error) {if (error.code !== 'EEXIST') throw error;}
    await unlink(staged);await syncDirectory(directory);
    const retained = await readPrivate(path,value.length);
    need(retained.equals(value),'WFS_RETAINED_FILE_CHANGED','Keep the original retained member: ' + path);
  } finally {await unlink(staged).catch(error => {if (error.code !== 'ENOENT') throw error;});}
}
export async function durableDirectory(directory) {
  await privateDirectory(directory,true);await syncDirectory(directory);await syncDirectory(dirname(directory));return directory;
}
export async function parseWfsXml(bytes,kind,{python = process.env.CODEX_PRIMARY_RUNTIME_PYTHON || 'python3',signal} = {}) {
  need(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= XML_LIMIT &&
    ['capabilities','schema'].includes(kind),'WFS_XML_INPUT_INVALID');
  signal?.throwIfAborted();
  return new Promise((resolve,reject) => {
    const child = spawn(python,['-B',fileURLToPath(new URL('./xml.py',import.meta.url)),kind],
      {stdio:['pipe','pipe','pipe'],shell:false});
    const chunks = [], errors = []; let size = 0, errorBytes = 0, issue = null;
    const stop = () => { issue ??= signal?.reason ?? fault('WFS_XML_CANCELLED'); child.kill('SIGKILL'); };
    const timer = setTimeout(() => { issue ??= fault('WFS_XML_TIMEOUT'); child.kill('SIGKILL'); },30000);
    signal?.addEventListener('abort',stop,{once:true});
    child.stdout.on('data',chunk => { size += chunk.length;
      if (size > XML_LIMIT) { issue ??= fault('WFS_XML_MODEL_TOO_LARGE'); child.kill('SIGKILL'); }
      else chunks.push(chunk); });
    child.stderr.on('data',chunk => { if (errorBytes < 4096) {errors.push(chunk.subarray(0,4096-errorBytes));errorBytes += chunk.length;} });
    child.stdin.on('error',error => { issue ??= error; });
    child.once('error',error => { issue ??= error; });
    child.once('close',code => {
      clearTimeout(timer);signal?.removeEventListener('abort',stop);
      if (issue) return reject(issue);
      if (code !== 0) return reject(fault('WFS_XML_INVALID',Buffer.concat(errors).toString('utf8').trim() || 'The retained XML could not be parsed.'));
      try { resolve(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)))); }
      catch { reject(fault('WFS_XML_MODEL_INVALID')); }
    });
    child.stdin.end(bytes);
  });
}
function documentIdentity(value) {
  return identity({kind:value.kind,requestedUrl:value.requestedUrl,url:value.url,sha256:value.sha256,
    modelSha256:value.modelSha256,bytes:value.bytes,fetchedAt:value.fetchedAt,headers:value.headers});
}
export async function readWfsDocument(directory) {
  await privateDirectory(directory);
  const record = await readJson(join(directory,'document.json'),131072);
  need(record.schema === 'stellar-forge.wfs-document.v1' && record.id === documentIdentity(record),'WFS_DOCUMENT_CHANGED');
  const raw = await readPrivate(join(directory,'response.bin'),XML_LIMIT);
  const modelBytes = await readPrivate(join(directory,'model.json'),XML_LIMIT);
  need(raw.length === record.bytes && digest(raw) === record.sha256 && digest(modelBytes) === record.modelSha256,'WFS_DOCUMENT_BYTES_CHANGED');
  const model = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(modelBytes));
  need(model.schema === (record.kind === 'capabilities' ? 'stellar-forge.wfs-capabilities.v1' : 'stellar-forge.wfs-feature-schema.v1'),
    'WFS_DOCUMENT_KIND_CHANGED');
  return {record,model,raw};
}
export function createWfsProvider({endpoint,allowLoopback = false,transport,sourceAuth,python,timeoutMs = 60000,
  fetchImpl,metadataRecordSource,featureRecordSource} = {}) {
  endpoint = endpointUrl(endpoint,{allowLoopback});
  const origin = new URL(endpoint).origin, profile = transport ? normalizeBuyerTransport(transport) : null;
  need(!profile || profile.origin === origin,'WFS_TRANSPORT_ORIGIN_CHANGED');
  need(!sourceAuth || (typeof sourceAuth.requestHeaders === 'function' && typeof sourceAuth.authorizationForOrigin === 'function'),
    'WFS_SOURCE_AUTH_INVALID');
  const capability = sourceAuth?.authorizationForOrigin(origin) ?? null;
  const dispatch = fetchImpl ?? (allowLoopback && new URL(endpoint).protocol === 'http:' ? fetch :
    createPublicHttpsFetch({timeoutMs,...(profile ? {trustedProxy:profile} : {}),sourceAuthorization:capability}));
  const lifetime = new AbortController(), active = new Set(); let closing;
  function own(work) {
    if (lifetime.signal.aborted) return Promise.reject(fault('WFS_PROVIDER_CLOSED'));
    const task = Promise.resolve().then(work); active.add(task);
    task.then(() => active.delete(task),() => active.delete(task)); return task;
  }
  function selectedUrl(value) {
    const url = new URL(value);
    need(url.origin === origin && !url.username && !url.password && !url.hash,'WFS_SOURCE_ORIGIN_CHANGED');
    return url.href;
  }
  async function request(url,init = {}) {
    const signal = init.signal ? AbortSignal.any([init.signal,lifetime.signal]) : lifetime.signal;
    signal.throwIfAborted(); url = selectedUrl(url);
    const headers = new Headers(init.headers ?? {});
    need(!['authorization','cookie','api-key','proxy-authorization'].some(name => headers.has(name)),'WFS_RETAINED_CREDENTIAL_FORBIDDEN');
    const privateHeaders = new Headers(await sourceAuth?.requestHeaders({url,method:'GET',signal}) ?? {});
    for (const [name,value] of privateHeaders) {
      need(capability?.origin === origin &&
        (name === 'authorization' && ['Bearer','Basic'].includes(capability.scheme) || name === 'api-key' && capability.scheme === 'ApiKey'),
        'WFS_SOURCE_AUTH_HEADER_UNSUPPORTED');
      headers.set(name,value);
    }
    const response = await dispatch(url,{...init,method:'GET',headers,redirect:'manual',signal});
    try { await sourceAuth?.observeResponse?.({url,status:response.status,authorization:privateHeaders.get('authorization')}); }
    catch (error) { await response.body?.cancel().catch(() => {}); throw error; }
    return response;
  }
  async function readResponse(url,signal) {
    const requestedUrl = selectedUrl(url); let target = requestedUrl;
    const timer = AbortSignal.timeout(timeoutMs), combined = AbortSignal.any([timer,lifetime.signal,...(signal ? [signal] : [])]);
    for (let redirects = 0; redirects < 6; redirects++) {
      const response = await request(target,{headers:{accept:'application/xml, text/xml;q=0.9'},signal:combined});
      if ([301,302,303,307,308].includes(response.status)) {
        await response.body?.cancel();const location = response.headers.get('location');
        need(location,'WFS_REDIRECT_INVALID');target = selectedUrl(new URL(location,target).href);continue;
      }
      const chunks = []; let size = 0;
      for await (const chunk of response.body ?? []) {
        combined.throwIfAborted();size += chunk.length;
        need(size <= XML_LIMIT,'WFS_XML_SIZE_LIMIT');chunks.push(Buffer.from(chunk));
      }
      const raw = Buffer.concat(chunks,size), headers = Object.fromEntries(
        ['content-type','content-crs','etag','last-modified','date','retry-after'].flatMap(name =>
          response.headers.has(name) ? [[name,response.headers.get(name)]] : []));
      return {raw,requestedUrl,url:target,status:response.status,fetchedAt:stamp(),headers};
    }
    throw fault('WFS_REDIRECT_LIMIT');
  }
  async function document({directory,url,kind,signal}) {
    url = selectedUrl(url);need(['capabilities','schema'].includes(kind),'WFS_DOCUMENT_KIND_REQUIRED');
    await durableDirectory(directory);const release = await acquireWorkspace(directory);
    try {
      const existing = await optionalJson(join(directory,'document.json'));
      if (existing) {
        const result = await readWfsDocument(directory);
        need(result.record.requestedUrl === url && result.record.kind === kind,'WFS_DOCUMENT_SELECTION_CHANGED');
        return result;
      }
      await exactFile(join(directory,'request.json'),jsonBytes({schema:'stellar-forge.wfs-document-request.v1',url,kind}));
      let response = await optionalJson(join(directory,'pending-response.json'));
      if (response?.status === 200) {
        try {
          await reconcileRetainedFile(join(directory,'response.bin'),response.sha256);
          const raw = await readPrivate(join(directory,'response.bin'),XML_LIMIT);
          need(digest(raw) === response.sha256 && raw.length === response.bytes && response.requestedUrl === url,
            'WFS_PENDING_RESPONSE_CHANGED');response = {...response,raw};
        } catch (error) {
          if (error.code !== 'ENOENT') throw error;
          await atomicJson(directory,'unreceived-response.json',response);response = null;
        }
      }
      if (!response?.raw) {
        const last = await optionalJson(join(directory,'last-error.json'));
        if (last?.retryAt) need(Date.now() >= Date.parse(last.retryAt),'WFS_PROVIDER_COOLDOWN','Continue the same request after ' + last.retryAt + '.');
        response = metadataRecordSource ? await metadataRecordSource(url,kind) : await readResponse(url,signal);
        need(Buffer.isBuffer(response.raw) && response.raw.length <= XML_LIMIT && response.requestedUrl === url &&
          typeof response.fetchedAt === 'string' && Number.isFinite(Date.parse(response.fetchedAt)),
          'WFS_RECORDED_RESPONSE_INVALID');
        selectedUrl(response.url);
        const pending = {...response,bytes:response.raw.length,sha256:digest(response.raw)};delete pending.raw;
        if (response.status !== 200) {
          const failureRoot = join(directory,'failed-responses');await durableDirectory(failureRoot);
          const key = identity(pending);
          await exactFile(join(failureRoot,key+'.bin'),response.raw);
          await exactFile(join(failureRoot,key+'.json'),jsonBytes(pending));
          const retry = response.headers?.['retry-after'];
          const retryMillis = /^\d+$/.test(retry ?? '') ? Math.min(8.64e15,Date.now()+Number(retry)*1000) : Date.parse(retry ?? '');
          const retryAt = Number.isFinite(retryMillis) && Math.abs(retryMillis) <= 8.64e15 ? new Date(retryMillis).toISOString() : null;
          await atomicJson(directory,'last-error.json',{code:'WFS_HTTP_'+response.status,response:key,retryAt,observedAt:stamp()});
          throw fault('WFS_HTTP_'+response.status,'The source returned HTTP '+response.status+'.');
        }
        await atomicJson(directory,'pending-response.json',pending);
        await exactFile(join(directory,'response.bin'),response.raw);
      }
      const model = await parseWfsXml(response.raw,kind,{python,signal:signal ? AbortSignal.any([signal,lifetime.signal]) : lifetime.signal});
      const modelBytes = jsonBytes(model);await exactFile(join(directory,'model.json'),modelBytes);
      const record = {schema:'stellar-forge.wfs-document.v1',kind,requestedUrl:url,url:response.url,
        bytes:response.raw.length,sha256:digest(response.raw),modelSha256:digest(modelBytes),
        fetchedAt:response.fetchedAt,headers:response.headers};
      record.id = documentIdentity(record);await atomicJson(directory,'document.json',record);
      return {record,model,raw:response.raw};
    } finally {await release();}
  }
  return {
    endpoint, captureDocument:args => own(() => document(args)),
    captureFeatures:(directory,config,options = {}) => own(() => {
      need(!config.authorizationEnv,'WFS_USE_PRIVATE_SOURCE_AUTH','Select the existing private source authentication profile.');
      return capture(directory,config,{...options,fetchImpl:request,
        signal:options.signal ? AbortSignal.any([options.signal,lifetime.signal]) : lifetime.signal,
        ...(featureRecordSource ? {recordSource:featureRecordSource} : {})});
    }),
    close(){ return closing ??= (async () => {lifetime.abort();await Promise.allSettled([...active]);})(); },
  };
}
