// MIT — Receive an exported edition in the original research workspace.
import {constants} from 'node:fs';
import {open,lstat,realpath,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {dirname,join,resolve,sep} from 'node:path';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {openResearchWorkspace,canonical,safeId,ResearchError} from './workspace.mjs';
import {digest,parseJson,jsonBytes,writeBytes,privateDirectory,exists,syncDirectory} from '../node/store.mjs';

const runFile=promisify(execFile);
const RECEIPT='received-edition.json';
const DEFAULT_MAX_BYTES=536870912;
const MAX_FILES=50000;
const MAX_MANIFEST_BYTES=16777216;
const MAX_FILE_BYTES=67108864;
const own=(x,k)=>Object.hasOwn(x,k);
const object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const check=(ok,code,message,status=400)=>{if(!ok)throw new ResearchError(code,message??code,status);};
const json=(raw)=>{const value=parseJson(raw);check(object(value),'RECEIVE_JSON_OBJECT_REQUIRED');return value;};
const nested=(parent,child)=>child===parent||child.startsWith(parent+sep);
function fileName(name){
  check(typeof name==='string'&&name.length<=240&&!name.includes('\\')&&!name.includes('\0'),'RECEIVE_FILE_NAME_INVALID');
  const parts=name.split('/');
  check(parts.every(x=>/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(x)&&x!=='.'&&x!=='..'),'RECEIVE_FILE_NAME_INVALID');
  return name;
}
async function sourceRoot(directory){
  const root=resolve(directory),st=await lstat(root);
  check(st.isDirectory()&&!st.isSymbolicLink()&&await realpath(root)===root,'RECEIVE_SOURCE_DIRECTORY_INVALID');
  return root;
}
async function regularBytes(root,name,limit){
  fileName(name);const path=join(root,name);
  check(await realpath(dirname(path))===dirname(path),'RECEIVE_SOURCE_SYMLINK_REFUSED');
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try{
    const before=await handle.stat();
    check(before.isFile()&&before.size<=limit,'RECEIVE_FILE_SIZE_OR_TYPE_INVALID');
    const bytes=await handle.readFile(),after=await handle.stat();
    check(bytes.length<=limit&&bytes.length===before.size&&after.size===before.size&&after.mtimeMs===before.mtimeMs,'RECEIVE_SOURCE_CHANGED');
    return bytes;
  }finally{await handle.close();}
}
async function header(directory,{maxBytes=DEFAULT_MAX_BYTES}={}){
  check(Number.isSafeInteger(maxBytes)&&maxBytes>0,'RECEIVE_LIMIT_INVALID');
  const root=await sourceRoot(directory),raw=await regularBytes(root,'manifest.json',MAX_MANIFEST_BYTES),manifest=json(raw);
  check(manifest.schema==='stellar-forge.research-export.v1'&&object(manifest.files),'RECEIVE_MANIFEST_INVALID');
  safeId(manifest.editionId);
  const entries=Object.entries(manifest.files);
  check(entries.length>0&&entries.length<=MAX_FILES,'RECEIVE_FILE_COUNT_INVALID');
  let total=0;
  for(const [name,meta] of entries){
    fileName(name);
    check(name!=='manifest.json'&&object(meta)&&Number.isSafeInteger(meta.bytes)&&meta.bytes>=0&&meta.bytes<=MAX_FILE_BYTES&&
      typeof meta.sha256==='string'&&/^[a-f0-9]{64}$/.test(meta.sha256),'RECEIVE_MANIFEST_ENTRY_INVALID');
    total+=meta.bytes;check(Number.isSafeInteger(total)&&total<=maxBytes,'RECEIVE_TOTAL_TOO_LARGE');
  }
  for(const name of ['edition.json','query.json','coverage.json','decisions.json','page-index.json'])
    check(own(manifest.files,name),'RECEIVE_EXPORT_INCOMPLETE','Receive the complete original edition export.');
  const sha=digest(raw);
  if(await exists(join(root,'export-plan.json'))){
    const plan=json(await regularBytes(root,'export-plan.json',65536));
    check(plan.schema==='stellar-forge.research-export-plan.v1'&&plan.editionId===manifest.editionId&&plan.manifestSha256===sha,'RECEIVE_EXPORT_PLAN_CHANGED');
  }
  return {root,manifest,manifestBytes:raw,manifestSha256:sha,entries,total,maxBytes};
}
async function verified(h,name){
  const meta=h.manifest.files[name];check(meta,'RECEIVE_REQUIRED_FILE_MISSING',name);
  const raw=await regularBytes(h.root,name,meta.bytes);
  check(raw.length===meta.bytes&&digest(raw)===meta.sha256,'RECEIVE_FILE_CHANGED',name);
  return raw;
}
async function metadata(h){
  const bytes={},v={};
  for(const name of ['edition.json','query.json','coverage.json','decisions.json','page-index.json']){
    bytes[name]=await verified(h,name);v[name]=json(bytes[name]);
  }
  const edition=v['edition.json'],query=v['query.json'],decisions=v['decisions.json'],pages=v['page-index.json'].pages;
  safeId(edition.id);safeId(query.id);
  check(edition.schema==='stellar-forge.research-edition.v1'&&edition.id===h.manifest.editionId&&
    query.schema==='stellar-forge.research-query.v1'&&edition.queryId===query.id&&
    Number.isSafeInteger(query.revision)&&query.revision>0&&edition.queryRevision===query.revision&&
    edition.querySha256===query.sha256&&query.sha256===h.manifest.querySha256&&
    query.sha256===digest(canonical({label:query.label,entity:query.entity,parameters:query.parameters})),'RECEIVE_IDENTITIES_CHANGED');
  check(Number.isSafeInteger(decisions.revision)&&decisions.revision>=0&&decisions.revision===h.manifest.decisionsRevision&&
    object(decisions.items)&&Array.isArray(pages),'RECEIVE_REVIEW_OR_INDEX_INVALID');
  const required=new Set(['edition.json','query.json','decisions.json']);
  for(let index=0;index<pages.length;index++){
    const p=pages[index];check(object(p)&&p.index===index+1&&p.editionId===edition.id,'RECEIVE_PAGE_INDEX_INVALID');
    const prefix='pages/'+String(index+1).padStart(8,'0')+'/';
    for(const name of ['response.json','request.json','page.json'])required.add(prefix+name);
    if(p.nativeSha256)required.add(prefix+'buyer-result.json');
  }
  for(const name of required)check(own(h.manifest.files,name),'RECEIVE_EXPORT_INCOMPLETE','Receive full source pages and every retained native buyer result.');
  const listedPageNames=new Set([...required].filter(x=>x.startsWith('pages/')));
  for(const name of Object.keys(h.manifest.files))if(name.startsWith('pages/'))
    check(listedPageNames.has(name),'RECEIVE_UNINDEXED_PAGE_FILE',name);
  return {bytes,edition,query,decisions,pages,coverage:v['coverage.json'],required};
}
function summary(h,m){
  return {schema:'stellar-forge.research-receiving-plan.v1',editionId:m.edition.id,queryId:m.query.id,
    queryRevision:m.query.revision,querySha256:m.query.sha256,decisionsRevision:m.decisions.revision,
    pages:m.pages.length,sourceCoverage:m.coverage,files:h.entries.length,bytes:h.total,
    manifestSha256:h.manifestSha256};
}
function stateName(m,name){
  if(name==='query.json')return join('editions',m.edition.id,'query.json');
  if(name==='edition.json'||name==='decisions.json'||name.startsWith('pages/'))return join('editions',m.edition.id,name);
  return null;
}
// Earlier readers used two labels for a valid non-empty terminal page.
// Preserve their original coverage in the receipt while re-deriving its state
// from the same verified source pages. All other measured fields must match.
function sameCoverage(current,original,pages){
  if(canonical(current)===canonical(original))return true;
  const terminal=current.state==='COMPLETE'&&current.nextCursor===null&&
    current.reason==='TERMINAL_CURSOR'&&pages.at(-1)?.records>0;
  const legacy=original.state==='COMPLETE'&&original.reason==='TERMINAL_PAGE'||
    original.state==='INTERRUPTED'&&original.reason==='TERMINAL_CURSOR_WITH_RECORDS';
  return terminal&&legacy&&canonical(current)===canonical({...original,
    state:current.state,reason:current.reason,warnings:current.warnings});
}
async function validateWorkspace(root,m){
  const workspace=await openResearchWorkspace(root);
  try{
    const query=await workspace.query(m.query.id,m.query.revision),e=await workspace.edition(m.edition.id);
    check(canonical(query)===canonical(m.query)&&canonical(e.record)===canonical(m.edition)&&
      canonical(e.query)===canonical(m.query)&&canonical(e.pages)===canonical(m.pages),'RECEIVE_NATIVE_IDENTITIES_CHANGED');
    check(sameCoverage(e.coverage,m.coverage,e.pages),'RECEIVE_NATIVE_COVERAGE_CHANGED');
    const ids=new Set(e.records.map(x=>x.id));
    for(const [id,d] of Object.entries(m.decisions.items)){
      check(ids.has(id)&&object(d)&&['include','exclude','undecided'].includes(d.status)&&
        typeof d.notes==='string'&&d.notes.length<=10000&&Array.isArray(d.tags)&&d.tags.length<=32&&
        d.tags.every(t=>typeof t==='string'&&t.length<=80),'RECEIVE_REVIEW_RECORD_INVALID',id);
    }
    check(canonical(e.decisions)===canonical(m.decisions),'RECEIVE_REVIEW_CHANGED');
    return {editionId:e.record.id,queryId:query.id,queryRevision:query.revision,
      coverage:e.coverage,decisionsRevision:e.decisions.revision,
      uniqueRecords:e.analysis.counts?.uniqueRecords??null};
  }finally{await workspace.close();}
}
// Python's standard library calls Linux's atomic create-only directory rename.
async function publishDirectory(stage,destination,python){
  const program="import ctypes,errno,os,sys\nlibc=ctypes.CDLL(None,use_errno=True)\nfn=getattr(libc,'renameat2',None)\nif fn is None:\n    sys.stderr.write('RENAME_NOREPLACE_UNAVAILABLE')\n    sys.exit(78)\nfn.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint]\nfn.restype=ctypes.c_int\nrc=fn(-100,os.fsencode(sys.argv[1]),-100,os.fsencode(sys.argv[2]),1)\nif rc:\n    code=ctypes.get_errno()\n    sys.stderr.write(errno.errorcode.get(code,str(code)))\n    sys.exit(73 if code==errno.EEXIST else 74)\n";
  try{await runFile(python,['-c',program,stage,destination],{timeout:10000,maxBuffer:1024});}
  catch(e){
    if(e.code===73)throw new ResearchError('RECEIVE_DESTINATION_EXISTS','Choose a new private workspace directory.',409);
    throw new ResearchError('RECEIVE_ATOMIC_PUBLISH_UNAVAILABLE','The receiver needs Python 3 and Linux renameat2 support; the prepared source remains in its staging directory.',503);
  }
  await syncDirectory(dirname(destination));
}
async function loadExports(sourceDirectories,{maxBytes=DEFAULT_MAX_BYTES}={}){
  check(Array.isArray(sourceDirectories)&&sourceDirectories.length>0&&sourceDirectories.length<=128&&
    sourceDirectories.every(x=>typeof x==='string'),'RECEIVE_SOURCES_REQUIRED');
  const rows=[],editions=new Set(),queries=new Map();let total=0,fileCount=0;
  for(const directory of sourceDirectories){
    const h=await header(directory,{maxBytes}),m=await metadata(h);
    check(!editions.has(m.edition.id),'RECEIVE_EDITION_COLLISION','Select one exact export for each edition.');
    editions.add(m.edition.id);total+=h.total;fileCount+=h.entries.length;
    check(Number.isSafeInteger(total)&&total<=maxBytes&&fileCount<=MAX_FILES,'RECEIVE_TOTAL_TOO_LARGE');
    const key=m.query.id+':'+m.query.revision,prior=queries.get(key);
    check(!prior||prior.bytes.equals(m.bytes['query.json']),'RECEIVE_QUERY_REVISION_COLLISION');
    if(!prior)queries.set(key,{query:m.query,bytes:m.bytes['query.json']});
    rows.push({h,m});
  }
  rows.sort((a,b)=>a.m.edition.id.localeCompare(b.m.edition.id));
  const identity=rows.map(({h,m})=>({editionId:m.edition.id,manifestSha256:h.manifestSha256}));
  return {rows,queries,total,fileCount,bundleSha256:digest(canonical(identity))};
}
function bundleSummary(bundle){
  return {schema:'stellar-forge.research-receiving-plan.v1',bundleSha256:bundle.bundleSha256,
    editionCount:bundle.rows.length,queryCount:new Set([...bundle.queries.values()].map(x=>x.query.id)).size,
    files:bundle.fileCount,bytes:bundle.total,editions:bundle.rows.map(({h,m})=>summary(h,m))};
}
async function verifyRemaining(bundle){
  for(const {h,m} of bundle.rows)for(const [name] of h.entries)if(!own(m.bytes,name))await verified(h,name);
}
export async function inspectResearchExports(sourceDirectories,options={}){
  const bundle=await loadExports(sourceDirectories,options);await verifyRemaining(bundle);return bundleSummary(bundle);
}
export async function inspectResearchExport(sourceDirectory,options={}){
  return inspectResearchExports([sourceDirectory],options);
}
export async function receiveResearchExport({sourceDirectory,sourceDirectories,destination,maxBytes=DEFAULT_MAX_BYTES,python='python3'}){
  check((sourceDirectory===undefined)!==(sourceDirectories===undefined)&&typeof destination==='string'&&
    typeof python==='string'&&python.length>0,'RECEIVE_OPTIONS_REQUIRED');
  return receiveResearchExports({sourceDirectories:sourceDirectories??[sourceDirectory],destination,maxBytes,python});
}
export async function receiveResearchExports({sourceDirectories,destination,maxBytes=DEFAULT_MAX_BYTES,python='python3'}){
  check(typeof destination==='string'&&typeof python==='string'&&python.length>0,'RECEIVE_OPTIONS_REQUIRED');
  const bundle=await loadExports(sourceDirectories,{maxBytes}),target=resolve(destination),parent=dirname(target);
  for(const {h} of bundle.rows)check(!nested(h.root,target)&&!nested(target,h.root),'RECEIVE_SOURCE_DESTINATION_OVERLAP');
  if(await exists(target)){
    let receipt;
    try{receipt=json(await regularBytes(await sourceRoot(target),RECEIPT,MAX_MANIFEST_BYTES));}catch{
      throw new ResearchError('RECEIVE_DESTINATION_EXISTS','Choose a new directory; the receiver preserves an existing workspace.',409);
    }
    check(receipt.schema==='stellar-forge.research-receiving.v1'&&receipt.bundleSha256===bundle.bundleSha256,
      'RECEIVE_DESTINATION_EXISTS','The destination belongs to another source delivery.',409);
    await verifyRemaining(bundle);
    const workspace=await openResearchWorkspace(target),current=[];
    try{
      for(const {m} of bundle.rows){
        const e=await workspace.edition(m.edition.id);
        check(canonical(e.record)===canonical(m.edition)&&canonical(e.query)===canonical(m.query)&&
          e.pages.length>=m.pages.length&&canonical(e.pages.slice(0,m.pages.length))===canonical(m.pages),
          'RECEIVE_DESTINATION_SOURCE_CHANGED',undefined,409);
        current.push({editionId:e.record.id,coverage:e.coverage,decisionsRevision:e.decisions.revision});
      }
      return {...bundleSummary(bundle),destination:target,reused:true,current,receipt};
    }finally{await workspace.close();}
  }
  await mkdir(parent,{recursive:true,mode:0o700});
  check(await realpath(parent)===parent,'RECEIVE_DESTINATION_PARENT_SYMLINK_REFUSED');
  const stage=await mkdtemp(join(parent,'.research-receive-'));
  let published=false,validated=false;
  try{
    await privateDirectory(stage);
    for(const path of ['queries','editions','exports','received-manifests'])await privateDirectory(join(stage,path));
    for(const {h,m} of bundle.rows){
      await privateDirectory(join(stage,'editions',m.edition.id));
      await privateDirectory(join(stage,'editions',m.edition.id,'pages'));
      for(const [name] of h.entries){
        const raw=own(m.bytes,name)?m.bytes[name]:await verified(h,name),relative=stateName(m,name);
        if(relative){
          const path=join(stage,relative);await privateDirectory(dirname(path));await writeBytes(path,raw,{exclusive:true});
        }
      }
      await writeBytes(join(stage,'received-manifests',m.edition.id+'.json'),h.manifestBytes,{exclusive:true});
    }
    const latestQueries=new Map();
    for(const {query,bytes} of bundle.queries.values()){
      const folder=join(stage,'queries',query.id);
      await privateDirectory(folder);await privateDirectory(join(folder,'revisions'));
      await writeBytes(join(folder,'revisions',String(query.revision)+'.json'),bytes,{exclusive:true});
      if(!latestQueries.has(query.id)||latestQueries.get(query.id).query.revision<query.revision)latestQueries.set(query.id,{query,bytes});
    }
    for(const {query,bytes} of latestQueries.values())await writeBytes(join(stage,'queries',query.id,'query.json'),bytes,{exclusive:true});
    const native=[];for(const {m} of bundle.rows)native.push(await validateWorkspace(stage,m));
    const receipt={...bundleSummary(bundle),schema:'stellar-forge.research-receiving.v1',receivedAt:new Date().toISOString(),
      sourceManifests:bundle.rows.map(({h,m})=>({editionId:m.edition.id,path:'received-manifests/'+m.edition.id+'.json',
        bytes:h.manifestBytes.length,sha256:h.manifestSha256})),
      importedQueryRevisions:[...bundle.queries.values()].map(({query})=>({id:query.id,revision:query.revision,sha256:query.sha256})),
      native};
    await writeBytes(join(stage,RECEIPT),jsonBytes(receipt),{exclusive:true});
    await syncDirectory(stage);validated=true;
    await publishDirectory(stage,target,python);published=true;
    return {...bundleSummary(bundle),destination:target,reused:false,native,receipt};
  }catch(e){
    if(validated&&!published)e.preparedDirectory=stage;
    throw e;
  }finally{
    if(!published&&!validated)await rm(stage,{recursive:true,force:true});
  }
}
