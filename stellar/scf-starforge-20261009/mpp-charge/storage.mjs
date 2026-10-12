// MIT. One private, flock-owned workspace; native MPP CAS and retained commerce records.
import { mkdir, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { privateDirectory, operationLease, regular, saveJSON } from '../distribution/runtime-workspace/storage.mjs';

export const hash = value => createHash('sha256').update(value).digest('hex');
export const now = () => new Date().toISOString();
export const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const json = value => JSON.stringify(value, null, 2) + '\n';
export function requireValue(value, code, status = 400) {
  if (!value) throw Object.assign(new Error(code), {code, status});
}
export function stable(value) {
  return JSON.stringify((function sorted(v) {
    if (Array.isArray(v)) return v.map(sorted);
    return plain(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, sorted(v[k])])) : v;
  })(value));
}
export function id(value) {
  requireValue(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$/.test(value), 'MPP_ID_INVALID');
  return value;
}
const groups = new Set(['sdk','purchases','deliveries','profiles','reports']);
async function read(path, optional = false) {
  try { return JSON.parse(new TextDecoder('utf8', {fatal:true}).decode(await regular(path, 16 * 1024 * 1024))); }
  catch(error) { if(optional && error.code === 'ENOENT') return null; throw error; }
}
export async function openWorkspace(directory, {create = false} = {}) {
  requireValue(typeof directory === 'string' && directory === resolve(directory), 'MPP_PRIVATE_ABSOLUTE_WORKSPACE_REQUIRED');
  if (create) await mkdir(directory, {mode:0o700});
  const root = await privateDirectory(directory);
  const lease = await operationLease(join(root, '.mpp-workspace.lock'));
  let tail = Promise.resolve(), closed = false;
  const serial = fn => {
    requireValue(!closed, 'MPP_WORKSPACE_CLOSED');
    const pending = tail.then(fn); tail = pending.catch(() => {}); return pending;
  };
  const file = (group, key) => {
    requireValue(groups.has(group) && typeof key === 'string' && key.length <= 8192, 'MPP_RECORD_KEY_INVALID');
    return join(root, group, hash(key) + '.json');
  };
  const get = async (group, key) => {
    const row = await read(file(group,key), true);
    requireValue(row === null || row.key === key && row.schema === 'stellar-forge.mpp-record.v1', 'MPP_RECORD_IDENTITY_MISMATCH');
    return row?.value ?? null;
  };
  const put = (group,key,value) => saveJSON(file(group,key), {
    schema:'stellar-forge.mpp-record.v1', key, updatedAt:now(), value
  }, true);
  try {
    for (const group of groups) {
      await mkdir(join(root, group), {mode:0o700}).catch(e => {if(e.code !== 'EEXIST') throw e;});
      await privateDirectory(join(root, group));
    }
    const metaPath = join(root,'workspace.json');
    if (!(await read(metaPath,true))) await saveJSON(metaPath, {
      schema:'stellar-forge.mpp-workspace.v1', createdAt:now(), revision:0, merchant:null, buyer:null, customer:null
    });
    const api = {
      root,
      metadata: () => read(metaPath),
      profile: async kind => {
        requireValue(['merchant','buyer','customer'].includes(kind),'MPP_PROFILE_KIND_INVALID');
        const meta = await read(metaPath); return meta[kind] ? get('profiles',meta[kind]) : null;
      },
      configure: (kind,profile,expectedRevision) => serial(async () => {
        requireValue(['merchant','buyer','customer'].includes(kind),'MPP_PROFILE_KIND_INVALID');
        const meta = await read(metaPath);
        requireValue(meta.revision === expectedRevision,'MPP_PROFILE_REVISION_CHANGED',409);
        const digest = hash(stable(profile));
        await put('profiles',digest,profile);
        await saveJSON(metaPath,{...meta,[kind]:digest,revision:meta.revision+1,updatedAt:now()},true);
        return {kind,profileId:digest,revision:meta.revision+1};
      }),
      read: get,
      put: (group,key,value) => serial(() => put(group,key,value)),
      update: (group,key,fn) => serial(async () => {
        const change = fn(await get(group,key));
        requireValue(plain(change) && ['set','delete','noop'].includes(change.op),'MPP_ATOMIC_UPDATE_INVALID');
        if(change.op !== 'noop') await put(group,key,change.op === 'delete' ? null : change.value);
        return change.result;
      }),
      list: async group => {
        requireValue(groups.has(group),'MPP_RECORD_GROUP_INVALID');
        const rows=[];
        for (const name of await readdir(join(root,group))) {
          if(!/^[a-f0-9]{64}\.json$/.test(name)) continue;
          const row = await read(join(root,group,name));
          if(row.value !== null) rows.push({id:row.key,...row.value});
        }
        return rows.sort((a,b)=>(b.updatedAt ?? b.createdAt ?? '').localeCompare(a.updatedAt ?? a.createdAt ?? ''));
      },
      close: async () => { if(!closed) {closed=true; await tail; await lease.close();} }
    };
    api.sdkStore = {
      get:key=>get('sdk',key),
      put:(key,value)=>api.put('sdk',key,value),
      delete:key=>api.put('sdk',key,null),
      update:(key,fn)=>api.update('sdk',key,fn)
    };
    return api;
  } catch(error) { await lease.close(); throw error; }
}
