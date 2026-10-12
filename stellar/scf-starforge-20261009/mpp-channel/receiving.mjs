// MIT. Transfer one complete operating channel, its original records, output and executable source.
import { mkdir, readdir, readFile } from 'node:fs/promises';
import { resolve, join, dirname, relative, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { regular, saveJSON, privateDirectory } from '../distribution/runtime-workspace/storage.mjs';
import { requireValue as need, hash, stable, now, id } from '../mpp-charge/storage.mjs';
import { channel, streamKey, absolute } from './config.mjs';
import { versions, inputPathFor } from './runtime.mjs';
import { groups, serialChannel } from './state.mjs';
const moduleRoot=fileURLToPath(new URL('./',import.meta.url));
const sourceRoot=fileURLToPath(new URL('../../../',import.meta.url));
const MAX_BUNDLE=128*1024*1024, MAX_FILE=16*1024*1024;
async function directory(path) {
  await mkdir(path,{recursive:true,mode:0o700}); return privateDirectory(path);
}
function fileRecord(path,bytes) {
  return {path,bytes:bytes.length,sha256:hash(bytes),bodyBase64:bytes.toString('base64')};
}
async function sourceClosure() {
  const selected=new Map();
  async function visit(path) {
    path=resolve(path); need(path.startsWith(sourceRoot), 'MPP_CHANNEL_SOURCE_ROOT_CHANGED');
    if(selected.has(path)) return;
    const bytes=await regular(path,MAX_FILE); selected.set(path,fileRecord(relative(sourceRoot,path),bytes));
    need(selected.size<=8192, 'MPP_CHANNEL_SOURCE_PACKAGE_TOO_LARGE');
    if(!['.mjs','.js','.mts'].includes(extname(path))) return;
    const text=bytes.toString('utf8');
    const patterns=[
      /^\s*(?:import\s+(?:[\w*$,{}\s]+\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+)['"](\.[^'"]+)['"]/gm,
      /\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/g,
      /\bnew URL\(\s*['"](\.[^'"]+\.(?:mjs|js|json|py|html|css))['"]\s*,\s*import\.meta\.url\s*\)/g
    ];
    for(const pattern of patterns) for(const match of text.matchAll(pattern)) {
      const target=resolve(dirname(path),match[1]);
      if(extname(target)) await visit(target);
    }
  }
  async function seed(path) {
    for(const entry of await readdir(path,{withFileTypes:true})) {
      if(entry.name==='__pycache__' || /\.py[co]$/.test(entry.name)) continue;
      need(!entry.isSymbolicLink(), 'MPP_CHANNEL_SOURCE_SYMLINK_UNSUPPORTED');
      if(entry.isDirectory()) await seed(join(path,entry.name));
      else if(entry.isFile()) await visit(join(path,entry.name));
    }
  }
  await seed(moduleRoot);
  await seed(resolve(moduleRoot,'../mpp-charge/public'));
  await visit(resolve(moduleRoot,'../mpp-charge/package.json'));
  await visit(resolve(moduleRoot,'../mpp-charge/package-lock.json'));
  return [...selected.values()].sort((a,b)=>a.path.localeCompare(b.path));
}
async function externalFiles(workspace,configs) {
  const selected=new Map();
  async function visit(path,module=false) {
    path=absolute(path); if(selected.has(path)) return;
    const actual=configs.length?await inputPathFor(workspace,configs[0],path):path;
    const bytes=await regular(actual,MAX_FILE); selected.set(path,fileRecord(path,bytes));
    need(selected.size<=1024, 'MPP_CHANNEL_SOURCE_INPUTS_TOO_LARGE');
    if(module && ['.mjs','.js'].includes(extname(path))) {
      const text=bytes.toString('utf8');
      const pattern=/^\s*(?:import\s+(?:[\w*$,{}\s]+\s+from\s+)?|export\s+(?:\*|\{[^}]*\})\s+from\s+)['"](\.[^'"]+)['"]|\bimport\s*\(\s*['"](\.[^'"]+)['"]\s*\)/gm;
      for(const match of text.matchAll(pattern)) await visit(resolve(dirname(path),match[1] ?? match[2]),true);
    }
  }
  for(const config of configs) {
    if(config.handlersModule) await visit(config.handlersModule,true);
    for(const route of config.routes ?? []) if(route.resource?.kind==='json-file') await visit(route.resource.path);
  }
  return [...selected.values()].sort((a,b)=>a.path.localeCompare(b.path));
}
async function nativeRows(workspace,group) {
  const rows=[];
  for(const name of await readdir(join(workspace.root,group))) {
    if(!/^[a-f0-9]{64}\.json$/.test(name)) continue;
    const row=JSON.parse((await regular(join(workspace.root,group,name),MAX_FILE)).toString('utf8'));
    need(row.schema==='stellar-forge.mpp-record.v1' && hash(row.key)===name.slice(0,-5),
      'MPP_CHANNEL_NATIVE_RECORD_CHANGED');
    if(row.value!==null) rows.push({group,key:row.key,value:row.value});
  }
  return rows;
}
export async function assertOperating(workspace,terms) {
  const key=streamKey(terms);
  const outgoing=await workspace.read(groups.receiving,'outbound:'+key);
  need(!outgoing, 'MPP_CHANNEL_OPERATING_WORK_TRANSFERRED',409);
  const incoming=await workspace.read(groups.receiving,'inbound:'+key);
  need(!incoming || incoming.state==='READY', 'MPP_CHANNEL_RESUME_ORIGINAL_RECEIVING',409);
}
export async function exportChannel({workspace,terms,handoverId}) {
  id(handoverId); terms=channel(terms);
  return serialChannel(workspace,terms,async()=>{
    const selected=streamKey(terms), outgoing=await workspace.read(groups.receiving,'outbound:'+selected);
    if(outgoing) {
      need(outgoing.id===handoverId, 'MPP_CHANNEL_ORIGINAL_HANDOVER_ID_REQUIRED',409);
      const bundle=JSON.parse((await regular(outgoing.path,MAX_BUNDLE)).toString('utf8'));
      parseBundle(bundle); return bundle;
    }
    await assertOperating(workspace,terms);
    const prefix='mpp-channel:'+terms.network+':'+terms.address+':', records=[];
    for(const group of [groups.tasks,groups.streams,groups.purchases,groups.deliveries,groups.settlements,groups.settings,groups.funding,groups.funders,groups.observations,'sdk']) {
      for(const row of await nativeRows(workspace,group)) {
        const config=row.value.config, rowTerms=config?.channel ?? row.value.channel;
        if(group==='sdk'?row.key.startsWith(prefix):rowTerms && streamKey(rowTerms)===selected) records.push(row);
      }
    }
    need(records.some(row=>row.group!== 'sdk'), 'MPP_CHANNEL_OPERATING_HISTORY_REQUIRED');
    const profiles=new Set(records.map(row=>row.value.profileId).filter(Boolean));
    for(const row of await nativeRows(workspace,'profiles'))
      if(row.value.channel && streamKey(row.value.channel)===selected) profiles.add(row.key);
    for(const profileId of profiles) {
      const value=await workspace.read('profiles',profileId);
      need(value && hash(stable(value))===profileId, 'MPP_CHANNEL_ORIGINAL_PROFILE_REQUIRED');
      records.push({group:'profiles',key:profileId,value});
    }
    const metadata=await workspace.metadata();
    const body={schema:'stellar-forge.mpp-channel-handover.v1',id:handoverId,createdAt:now(),
      sourceWorkspace:{path:workspace.root,createdAt:metadata.createdAt},channel:terms,versions,
      records:records.sort((a,b)=>(a.group+'/'+a.key).localeCompare(b.group+'/'+b.key)),
      sourceFiles:await sourceClosure(),
      inputFiles:await externalFiles(workspace,records.filter(row=>row.group==='profiles').map(row=>row.value))};
    const bundle={...body,sha256:hash(stable(body))};
    need(Buffer.byteLength(JSON.stringify(bundle))<=MAX_BUNDLE, 'MPP_CHANNEL_HANDOVER_TOO_LARGE');
    const root=await directory(join(workspace.root,'channel-handover'));
    const path=join(root,bundle.sha256+'.json');
    await saveJSON(path,bundle);
    const retainedBytes=await regular(path,MAX_BUNDLE);
    // The complete immutable file is retained before this original operator transfers custody.
    await workspace.put(groups.receiving,'outbound:'+selected,{
      schema:'stellar-forge.mpp-channel-outgoing.v1',id:handoverId,channel:terms,sha256:bundle.sha256,path,
      state:'TRANSFERRED',fileBytes:retainedBytes.length,fileSha256:hash(retainedBytes),createdAt:now()});
    return bundle;
  });
}
export function parseBundle(value) {
  const bundle=typeof value==='string'?JSON.parse(value):value;
  need(bundle?.schema==='stellar-forge.mpp-channel-handover.v1' &&
    typeof bundle.sha256==='string' && Array.isArray(bundle.records) &&
    Array.isArray(bundle.sourceFiles) && Array.isArray(bundle.inputFiles), 'MPP_CHANNEL_COMPLETE_HANDOVER_REQUIRED');
  const {sha256,...body}=bundle;
  need(hash(stable(body))===sha256 && stable(bundle.versions)===stable(versions), 'MPP_CHANNEL_HANDOVER_SOURCE_CHANGED');
  channel(bundle.channel); id(bundle.id);
  const names=new Set();
  for(const row of bundle.records) {
    need([groups.tasks,groups.streams,groups.purchases,groups.deliveries,groups.settlements,groups.settings,groups.funding,groups.funders,groups.observations,'sdk','profiles'].includes(row.group) &&
      typeof row.key==='string' && row.value && !names.has(row.group+'\n'+row.key), 'MPP_CHANNEL_HANDOVER_RECORD_INVALID');
    names.add(row.group+'\n'+row.key);
    if(row.group==='profiles') need(hash(stable(row.value))===row.key, 'MPP_CHANNEL_PROFILE_HASH_CHANGED');
    else if(row.group==='sdk') need(row.key.startsWith('mpp-channel:'+bundle.channel.network+':'+bundle.channel.address+':'),
      'MPP_CHANNEL_SDK_SCOPE_CHANGED');
    else need(streamKey(row.value.config?.channel ?? row.value.channel)===streamKey(bundle.channel),
      'MPP_CHANNEL_RECORD_SCOPE_CHANGED');
  }
  for(const list of [bundle.sourceFiles,bundle.inputFiles]) {
    const paths=new Set();
    for(const file of list) {
      need(typeof file.path==='string' && !paths.has(file.path), 'MPP_CHANNEL_HANDOVER_FILE_INVALID');
      paths.add(file.path);
      const bytes=Buffer.from(file.bodyBase64,'base64');
      need(bytes.length===file.bytes && bytes.length<=MAX_FILE && hash(bytes)===file.sha256,
        'MPP_CHANNEL_HANDOVER_FILE_CHANGED');
    }
  }
  return bundle;
}
async function retainFile(root,name,file) {
  const path=resolve(root,name);
  need(path.startsWith(root+'/'), 'MPP_CHANNEL_RECEIVING_PATH_INVALID');
  await directory(dirname(path));
  const bytes=Buffer.from(file.bodyBase64,'base64');
  let existing;
  try { existing=await regular(path,MAX_FILE); } catch(error) { if(error.code!=='ENOENT') throw error; }
  if(existing) need(hash(existing)===file.sha256, 'MPP_CHANNEL_RECEIVED_SOURCE_CHANGED');
  else {
    const {open}=await import('node:fs/promises');
    const handle=await open(path,'wx',0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
  }
  return path;
}
export async function receiveChannel({workspace,bundle,dependencyRoot}) {
  bundle=parseBundle(bundle); absolute(dependencyRoot);
  return serialChannel(workspace,bundle.channel,async()=>{
    const key=streamKey(bundle.channel), control='inbound:'+key;
    const incoming=await workspace.read(groups.receiving,control);
    need(!incoming || incoming.sha256===bundle.sha256, 'MPP_CHANNEL_ORIGINAL_RECEIVING_SOURCE_REQUIRED',409);
    if(incoming?.state==='READY') return incoming;
    need(!await workspace.read(groups.receiving,'outbound:'+key), 'MPP_CHANNEL_ORIGINAL_SENDER_WORKSPACE_SELECTED',409);
    const planned=bundle.records.map(row=>row.group===groups.tasks?
      {...row,value:{...row.value,status:'RECEIVED',receivedAuthority:row.value.authority ?? null,
        receivingSha256:bundle.sha256}}:row);
    // Compare the entire selected native history before joining any original records.
    for(const row of planned) {
      const current=await workspace.read(row.group,row.key);
      need(!current || stable(current)===stable(row.value), 'MPP_CHANNEL_EXISTING_OPERATING_RECORD_CHANGED',409);
    }
    const root=await directory(join(workspace.root,'channel-handover',bundle.sha256));
    await saveJSON(join(root,'HANDOVER.json'),bundle,true);
    await workspace.put(groups.receiving,control,{schema:'stellar-forge.mpp-channel-incoming.v1',
      id:bundle.id,sha256:bundle.sha256,channel:bundle.channel,state:'IMPORTING',root,createdAt:now()});
    const application=await directory(join(root,'application')), inputs=await directory(join(root,'inputs')), mappings={};
    for(const file of bundle.sourceFiles) {
      need(!file.path.startsWith('/') && !file.path.split('/').includes('..'), 'MPP_CHANNEL_SOURCE_PATH_INVALID');
      await retainFile(application,file.path,file);
    }
    for(const file of bundle.inputFiles) {
      absolute(file.path);
      const path=await retainFile(inputs,file.path.slice(1),file);
      mappings[file.path]={path,sha256:file.sha256};
    }
    for(const row of planned) {
      const current=await workspace.read(row.group,row.key);
      if(!current) await workspace.put(row.group,row.key,row.value);
    }
    await workspace.put(groups.receiving,'runtime:'+key,{
      schema:'stellar-forge.mpp-channel-runtime-binding.v1',dependencyRoot,application,files:mappings,
      sourceSha256:bundle.sha256,versions,createdAt:now()});
    const retainedBytes=await regular(join(root,'HANDOVER.json'),MAX_BUNDLE);
    const ready={schema:'stellar-forge.mpp-channel-incoming.v1',id:bundle.id,sha256:bundle.sha256,
      channel:bundle.channel,state:'READY',root,application,dependencyRoot,records:planned.length,
      sourceFiles:bundle.sourceFiles.length,inputFiles:bundle.inputFiles.length,
      originalWorkspace:bundle.sourceWorkspace,receivingWorkspace:workspace.root,
      fileBytes:retainedBytes.length,fileSha256:hash(retainedBytes),completedAt:now()};
    await workspace.put(groups.receiving,control,ready); return ready;
  });
}
