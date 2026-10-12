// MIT. Complete customer handover from the original reviewed Fiscal comparison.
import { constants } from 'node:fs';
import { open, lstat, readFile, realpath, link, unlink, rename } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  absolute, privateDirectory, readJson, readPrivate, hashPrivate, bytes, digest, identity,
  fault, object, atomicJson, acquireWorkspace, syncDirectory
} from '../postgres/publisher/files.mjs';
import { openFiscalWorkspace } from './workspace-model.mjs';
import {
  BRIEFING_FORMAT, ROWS_PER_PAGE, datedMeasures, datedMeasuresCsv,
  renderBriefing, renderBriefingMarkdown, renderRowPage
} from './briefing-render.mjs';

const MiB = 1024 ** 2;
const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const categories = ['all','added','removed','changed','unchanged'];
const need = (condition,code,message=code) => { if(!condition) throw fault(code,message,409); };
const inside = (parent,path) => {
  const value=relative(parent,path);
  return value==='' || value!=='..' && !value.startsWith('../') && !value.startsWith('/');
};
const sameFile = (a,b) => a.dev===b.dev && a.ino===b.ino;
const descriptor = (path,size,sha256,mime='application/octet-stream') => ({path,size,sha256,mime});
async function absent(path) {
  try { await lstat(path); return false; }
  catch(error) { if(error.code==='ENOENT') return true; throw error; }
}
function member(value) {
  need(typeof value==='string' && value.length<=220 &&
    value.split('/').every(part=>/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part) && part!=='.' && part!=='..'),
  'BRIEFING_FILE_PATH');
  return value;
}
async function exactFile(file,maximum=Math.max(file.size+1,MiB)) {
  need(Number.isSafeInteger(file.size)&&file.size>=0&&HASH.test(file.sha256),'BRIEFING_FILE_IDENTITY');
  need(await realpath(file.path)===file.path,'BRIEFING_FILE_PATH');
  const actual=await hashPrivate(file.path,maximum);
  need(actual.bytes===file.size&&actual.hash===file.sha256,'BRIEFING_FILE_CHANGED');
  return file;
}
async function retained(model,directory,kind,id,name) {
  const file=await model.file(kind,id,name);
  need(file && inside(directory,file.path),'BRIEFING_MODEL_DIRECTORY_CHANGED');
  return file;
}
async function retainedJson(model,directory,kind,id,name,maximum=32*MiB) {
  const file=await retained(model,directory,kind,id,name);
  const content=await readPrivate(file.path,maximum);
  need(content.length===file.size&&digest(content)===file.sha256,'BRIEFING_SOURCE_CHANGED');
  let value;
  try { value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(content)); }
  catch { throw fault('BRIEFING_SOURCE_JSON','The original selected source JSON cannot be read.',409); }
  return {file,value,content};
}
async function fsyncFile(path) {
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function reconcileLink(path,part) {
  if(await absent(path)||await absent(part))return;
  const [finalInfo,partInfo]=await Promise.all([lstat(path),lstat(part)]);
  if(sameFile(finalInfo,partInfo)) {
    need(finalInfo.isFile()&&finalInfo.nlink===2,'BRIEFING_PUBLICATION_CHANGED');
    await fsyncFile(path);await unlink(part);await syncDirectory(dirname(path));
  }
}
async function retainPartial(root,path) {
  if(await absent(path))return;
  const info=await lstat(path);
  need(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1&&!(info.mode&0o077),
    'BRIEFING_PARTIAL_CHANGED');
  const history=join(root,'interrupted');await privateDirectory(history,true);
  await rename(path,join(history,randomUUID()+'.part'));
  await syncDirectory(history);await syncDirectory(dirname(path));
}
/** Files publish once. A stopped copy and a lost link acknowledgement retain their original bytes. */
async function install(root,name,expected,write) {
  member(name);const path=join(root,name),part=path+'.part';
  await privateDirectory(dirname(path),true);await reconcileLink(path,part);
  if(!await absent(path))return exactFile({...expected,path});
  let ready=false;
  if(!await absent(part)) {
    try { await exactFile({...expected,path:part});ready=true; }
    catch(error) {
      if(!['BRIEFING_FILE_CHANGED','SOURCE_CHANGED_DURING_READ'].includes(error.code))throw error;
      await retainPartial(root,part);
    }
  }
  if(!ready) {
    const target=await open(part,'wx',0o600);
    try { await write(target);await target.sync(); } finally { await target.close(); }
    await exactFile({...expected,path:part});
  }
  // A verified temporary can be from an interrupted earlier write/fsync.
  await fsyncFile(part);
  try { await link(part,path); }
  catch(error) { if(error.code!=='EEXIST')throw error; }
  await syncDirectory(dirname(path));
  await reconcileLink(path,part);
  return exactFile({...expected,path});
}
async function installBytes(root,name,content,mime) {
  const raw=Buffer.isBuffer(content)?content:Buffer.from(content);
  const expected=descriptor('',raw.length,digest(raw),mime);
  return install(root,name,expected,target=>target.writeFile(raw));
}
async function installOriginal(root,name,source) {
  return install(root,name,source,async target=>{
    const handle=await open(source.path,constants.O_RDONLY|constants.O_NOFOLLOW);
    try {
      const before=await handle.stat();
      need(before.isFile()&&before.nlink===1&&!(before.mode&0o077)&&before.size===source.size,
        'BRIEFING_SOURCE_CHANGED');
      const hash=createHash('sha256');let size=0;
      for await(const block of handle.createReadStream({autoClose:false})) {
        size+=block.length;need(size<=source.size,'BRIEFING_SOURCE_CHANGED');
        hash.update(block);await target.writeFile(block);
      }
      const after=await handle.stat();
      need(size===source.size&&hash.digest('hex')===source.sha256&&before.size===after.size&&
        before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'BRIEFING_SOURCE_CHANGED');
    } finally { await handle.close(); }
  });
}
async function originalSources(model,directory,comparison) {
  const result={},files=[];
  for(const side of ['left','right']) {
    const source=await retainedJson(model,directory,'edition',comparison[side].id,'source.json');
    const review=await retainedJson(model,directory,'edition',comparison[side].id,'review.json');
    need(source.value.schema==='stellar-forge.fiscaldata-edition-source.v1'&&
      source.value.editionId===comparison[side].id&&
      source.value.captureSha256===comparison[side].captureSha256&&
      review.value.id===comparison[side].id,'BRIEFING_EDITION_SOURCE_CHANGED');
    const original=source.value.source;
    let endpointUrl=original?.endpoint??'';
    if(source.value.pages?.[0]?.url) {
      const url=new URL(source.value.pages[0].url);url.search='';url.hash='';endpointUrl=url.href;
    }
    result[side]={
      endpoint:original.endpoint,endpointUrl,sourceUrl:original.catalog?.entry?.sourceUrl??null,
      sourceId:original.id,sourceRevision:original.revision,sourceSha256:original.sha256??null,
      filter:original.filter,sort:original.sort,pageSize:original.pageSize,
      startedAt:source.value.interval?.first??null,completedAt:source.value.interval?.last??null,
      captureId:source.value.captureId,captureSha256:source.value.captureSha256,
      sourceFile:{name:side+'-source.json',size:source.file.size,sha256:source.file.sha256},
      review:{id:review.value.id,revision:review.value.revision,
        name:side+'-review.json',size:review.file.size,sha256:review.file.sha256}
    };
    files.push({name:side+'-source.json',file:source.file},{name:side+'-review.json',file:review.file});
  }
  return {sources:result,files};
}
function pageIndex(summary,rowsPerPage) {
  const count={all:summary.added+summary.removed+summary.changed+summary.unchanged,...summary};
  return Object.fromEntries(categories.map(category=>[category,
    Array.from({length:Math.ceil(count[category]/rowsPerPage)},(_,i)=>
      'rows/'+category+'-'+String(i+1).padStart(4,'0')+'.html')]));
}
async function rowPages(root,report,source,add) {
  const handle=await open(source.path,constants.O_RDONLY|constants.O_NOFOLLOW);
  const buffers=Object.fromEntries(categories.map(key=>[key,[]]));
  const counts=Object.fromEntries(categories.map(key=>[key,0]));
  const pageNumbers=Object.fromEntries(categories.map(key=>[key,0]));
  async function flush(category) {
    if(!buffers[category].length)return;
    const page=++pageNumbers[category],name=report.pages[category][page-1];
    need(name,'BRIEFING_ROW_COUNT_CHANGED');
    await add(name,await installBytes(root,name,
      renderRowPage(report,buffers[category],category,page,report.pages[category].length),'text/html; charset=utf-8'));
    buffers[category]=[];
  }
  async function consume(line) {
    need(line.length>0&&line.length<=8*MiB,'BRIEFING_ROW_INVALID');
    let row;try{row=JSON.parse(line);}catch{throw fault('BRIEFING_ROW_INVALID');}
    need(object(row)&&row.ordinal===counts.all&&categories.includes(row.status)&&row.status!=='all'&&
      object(row.key)&&Array.isArray(row.changes)&&
      (row.left===null||object(row.left))&&(row.right===null||object(row.right)),
    'BRIEFING_ROW_INVALID');
    for(const category of ['all',row.status]) {
      counts[category]++;buffers[category].push(row);
      if(buffers[category].length===report.rowsPerPage)await flush(category);
    }
  }
  try {
    const before=await handle.stat();
    need(before.isFile()&&before.nlink===1&&!(before.mode&0o077)&&before.size===source.size,'BRIEFING_ROWS_CHANGED');
    const hash=createHash('sha256');let size=0;
    const decoder=new TextDecoder('utf-8',{fatal:true});let pending='';
    // Await page publication before asking the original file stream for another block.
    // readline's event queue can otherwise retain a large complete source while disk writes wait.
    for await(const block of handle.createReadStream({autoClose:false})) {
      hash.update(block);size+=block.length;
      need(size<=source.size,'BRIEFING_ROWS_CHANGED');
      pending+=decoder.decode(block,{stream:true});
      let newline;
      while((newline=pending.indexOf('\n'))!==-1) {
        let line=pending.slice(0,newline);pending=pending.slice(newline+1);
        if(line.endsWith('\r'))line=line.slice(0,-1);
        await consume(line);
      }
      need(pending.length<=8*MiB,'BRIEFING_ROW_INVALID');
    }
    pending+=decoder.decode();if(pending)await consume(pending);
    const after=await handle.stat();
    need(size===source.size&&hash.digest('hex')===source.sha256&&before.size===after.size&&
      before.mtimeMs===after.mtimeMs&&before.ctimeMs===after.ctimeMs,'BRIEFING_ROWS_CHANGED');
    for(const category of categories) {
      await flush(category);
      need(pageNumbers[category]===report.pages[category].length&&
        (category==='all'?counts.all===report.comparison.rows:
          counts[category]===report.comparison.summary[category]),'BRIEFING_ROW_COUNT_CHANGED');
    }
    return counts;
  } finally { await handle.close(); }
}
async function archive(root,manifest,files) {
  const path=join(root,'briefing.tar.gz'),part=path+'.part',receiptPath=join(root,'archive.json');
  const manifestSha256=digest(bytes(manifest));
  let receipt;
  if(!await absent(receiptPath)) {
    receipt=await readJson(receiptPath,MiB);
    need(receipt.manifestSha256===manifestSha256,'BRIEFING_ARCHIVE_CHANGED');
    await reconcileLink(path,part);
    if(!await absent(path))return exactFile({...receipt,path});
    if(!await absent(part)) {
      await exactFile({...receipt,path:part});await fsyncFile(part);
      await link(part,path);await syncDirectory(root);await reconcileLink(path,part);
      return exactFile({...receipt,path});
    }
  } else if(!await absent(path))throw fault('BRIEFING_ARCHIVE_RECEIPT_MISSING');
  await retainPartial(root,part);
  const names=[...files.map(file=>file.path),'manifest.json'].sort();
  const list=Buffer.from(names.join('\0')+'\0');
  await installBytes(root,'archive-inputs.list',list,'application/octet-stream');
  // tar keeps this existing private mode even when an embedding process uses another umask.
  const archiveTarget=await open(part,'wx',0o600);await archiveTarget.close();
  await new Promise((resolve,reject)=>{
    const child=spawn('tar',['--create','--gzip','--format=ustar','--mtime=@0','--owner=0','--group=0',
      '--numeric-owner','--file',part,'--directory',root,'--null','--verbatim-files-from',
      '--files-from',join(root,'archive-inputs.list')],{stdio:['ignore','ignore','pipe'],shell:false});
    let error='';child.stderr.on('data',chunk=>{if(error.length<4096)error+=chunk;});
    child.once('error',reject);
    child.once('exit',code=>code===0?resolve():reject(fault('BRIEFING_ARCHIVE_FAILED',error||'Original tar could not finish.')));
  });
  await fsyncFile(part);
  const actual=await hashPrivate(part,4*1024*MiB);
  const candidate={schema:'stellar-forge.fiscaldata-briefing-archive.v1',manifestSha256,
    size:actual.bytes,sha256:actual.hash,mime:'application/gzip'};
  if(receipt)need(identity(receipt)===identity(candidate),'BRIEFING_ARCHIVE_CHANGED');
  else {receipt=candidate;await atomicJson(root,'archive.json',receipt);}
  await link(part,path);await syncDirectory(root);await reconcileLink(path,part);
  return exactFile({...receipt,path});
}

/** Verify an extracted complete handover, or the original local package after publication. */
export async function verifyFiscalBriefing({directory,expectedManifestSha256}={}) {
  absolute(directory);await privateDirectory(directory);
  if(expectedManifestSha256!==undefined)need(HASH.test(expectedManifestSha256),'BRIEFING_MANIFEST_HASH_REQUIRED');
  const raw=await readPrivate(join(directory,'manifest.json'),32*MiB);
  const manifest=JSON.parse(raw),manifestSha256=digest(raw);
  need(manifest.schema===BRIEFING_FORMAT&&Array.isArray(manifest.files)&&
    (!expectedManifestSha256||manifestSha256===expectedManifestSha256),'BRIEFING_MANIFEST_CHANGED');
  const selected=new Set();let total=0;
  for(const file of manifest.files) {
    member(file.path);need(!selected.has(file.path),'BRIEFING_REPEATED_FILE');selected.add(file.path);
    await exactFile({...file,path:join(directory,file.path)});
    total+=file.size;
  }
  let archiveFile=null;
  if(!await absent(join(directory,'sealed.json'))) {
    const seal=await readJson(join(directory,'sealed.json'),MiB);
    need(seal.schema==='stellar-forge.fiscaldata-briefing-sealed.v1'&&
      seal.manifestSha256===manifestSha256&&seal.operationId===manifest.operationId,'BRIEFING_SEAL_CHANGED');
    archiveFile=await exactFile({...seal.archive,path:join(directory,'briefing.tar.gz')});
  }
  return {schema:'stellar-forge.fiscaldata-briefing-verification.v1',state:'COMPLETE',directory,
    operationId:manifest.operationId,comparisonId:manifest.comparison.id,
    comparisonSha256:manifest.comparison.sha256,manifestSha256,files:manifest.files.length,
    bytes:total,archive:archiveFile,report:join(directory,'index.html')};
}

/**
 * Standalone calls acquire/close the original model. An embedding caller may lend its
 * already-owned model; it retains that model and its browser after this function.
 * No capture, publisher activation, buyer or payment operation is dispatched.
 */
export async function createFiscalBriefing({directory,model:borrowed,comparisonId,
  expectedComparisonSha256,exportId,outputDirectory,operationId,title,audience='',notes='',
  rowsPerPage=ROWS_PER_PAGE,createdAt}={}) {
  absolute(directory);absolute(outputDirectory);
  need(!inside(directory,outputDirectory)&&!inside(outputDirectory,directory),'BRIEFING_OUTPUT_OVERLAP',
    'Choose a separate private briefing directory outside the source workspace.');
  need(UUID.test(comparisonId??'')&&UUID.test(exportId??'')&&HASH.test(expectedComparisonSha256??''),
    'BRIEFING_SELECTION_REQUIRED','Select the original comparison, its SHA-256 and complete comparison export.');
  need(typeof operationId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(operationId),
    'BRIEFING_OPERATION_REQUIRED');
  need(typeof title==='string'&&title.trim().length>0&&title.length<=240&&!/[\r\n]/.test(title)&&
    typeof audience==='string'&&audience.length<=400&&!/[\r\n]/.test(audience)&&
    typeof notes==='string'&&notes.length<=64000,'BRIEFING_TEXT_INVALID');
  need(Number.isSafeInteger(rowsPerPage)&&rowsPerPage>=1&&rowsPerPage<=500,'BRIEFING_PAGE_SIZE');
  if(createdAt!==undefined)need(typeof createdAt==='string'&&Number.isFinite(Date.parse(createdAt))&&
    new Date(createdAt).toISOString()===createdAt,'BRIEFING_CREATED_AT',
    'Use the canonical UTC ISO timestamp retained by the original caller.');
  if(borrowed)need(['dispatch','file','snapshot'].every(name=>typeof borrowed[name]==='function'),
    'BRIEFING_ORIGINAL_MODEL_REQUIRED');
  let model,unlock;
  try {
    model=borrowed??await openFiscalWorkspace({directory});
    const header=await readJson(join(directory,'workspace.json'),MiB);
    need(header.schema==='stellar-forge.fiscaldata-workspace.v1'&&UUID.test(header.id??''),'BRIEFING_WORKSPACE_CHANGED');
    const original=await model.dispatch('comparisons.get',{id:comparisonId,offset:0,limit:1,changesOnly:false});
    need(original.result.sha256===expectedComparisonSha256&&original.result.status==='READY',
      'BRIEFING_COMPARISON_CHANGED','The original comparison must be READY and match the selected identity.');
    const selected=await retainedJson(model,directory,'comparison',comparisonId,'comparison.json');
    const sourceManifest=await retainedJson(model,directory,'export',exportId,'manifest.json');
    need(sourceManifest.value.schema==='stellar-forge.fiscaldata-export.v1'&&
      sourceManifest.value.kind==='comparison'&&sourceManifest.value.sourceId===comparisonId&&
      sourceManifest.value.sourceSha256===expectedComparisonSha256,'BRIEFING_EXPORT_SELECTION_CHANGED');
    need(selected.value.schema==='stellar-forge.fiscaldata-comparison.v1'&&selected.value.id===comparisonId&&
      selected.value.left.id===original.result.leftEditionId&&selected.value.right.id===original.result.rightEditionId,
    'BRIEFING_COMPARISON_CHANGED');
    const comparison={...selected.value,sha256:expectedComparisonSha256};
    const rows=await retained(model,directory,'comparison',comparisonId,'rows.jsonl');
    const changes=await retained(model,directory,'comparison',comparisonId,'changes.csv');
    const sourceArchive=await retained(model,directory,'export',exportId,'delivery.tar.gz');
    const originals=await originalSources(model,directory,comparison);
    for(const [name,file] of [['comparison.json',selected.file],['rows.jsonl',rows],['changes.csv',changes]]) {
      const declared=sourceManifest.value.files.find(item=>item.path===name);
      need(declared&&declared.size===file.size&&declared.sha256===file.sha256,'BRIEFING_EXPORT_SOURCE_CHANGED');
    }
    const producer={module:digest(await readFile(new URL(import.meta.url))),
      renderer:digest(await readFile(new URL('./briefing-render.mjs',import.meta.url)))};
    const request={schema:BRIEFING_FORMAT,operationId,comparisonId,expectedComparisonSha256,exportId,
      title:title.trim(),audience,notes,rowsPerPage,workspaceId:header.id,workspaceCreatedAt:header.createdAt,
      producer,comparisonFileSha256:selected.file.sha256,rowsSha256:rows.sha256,
      sourceManifestSha256:sourceManifest.file.sha256,sourceArchiveSha256:sourceArchive.sha256,
      ...(createdAt===undefined?{}:{createdAt})};
    await privateDirectory(outputDirectory,true);unlock=await acquireWorkspace(outputDirectory);
    const root=join(outputDirectory,'briefing-'+identity({operationId}).slice(0,32));
    await privateDirectory(root,true);
    let intent;
    if(await absent(join(root,'intent.json'))) {
      intent={request,requestSha256:identity(request),createdAt:createdAt??new Date().toISOString()};
      await atomicJson(root,'intent.json',intent);
    } else {
      intent=await readJson(join(root,'intent.json'),MiB);
      need(intent.requestSha256===identity(request)&&identity(intent.request)===identity(request),
        'BRIEFING_OPERATION_CONFLICT','This operation belongs to a different selection, commentary or producer.');
    }
    if(!await absent(join(root,'sealed.json')))return {...await verifyFiscalBriefing({directory:root}),reused:true};
    const report={
      schema:BRIEFING_FORMAT,operationId,createdAt:intent.createdAt,title:request.title,audience,notes,rowsPerPage,
      workspace:{id:header.id,createdAt:header.createdAt},comparison,exportId,producer,
      sourceArchive:{name:'source-delivery.tar.gz',size:sourceArchive.size,sha256:sourceArchive.sha256},
      sourceManifest:{name:'source-manifest.json',size:sourceManifest.file.size,sha256:sourceManifest.file.sha256},
      sources:originals.sources,datedMeasures:datedMeasures(comparison),pages:pageIndex(comparison.summary,rowsPerPage)
    };
    const files=[];
    const add=async(name,file)=>{files.push({path:name,size:file.size,sha256:file.sha256,mime:file.mime});};
    for(const [name,file] of [
      ['comparison.json',selected.file],['rows.jsonl',rows],['changes.csv',changes],
      ['source-manifest.json',sourceManifest.file],['source-delivery.tar.gz',sourceArchive],
      ...originals.files.map(item=>[item.name,item.file])
    ]) await add(name,await installOriginal(root,name,file));
    await rowPages(root,report,rows,add);
    for(const [name,content,mime] of [
      ['briefing.json',bytes(report),'application/json'],
      ['dated-measures.csv',datedMeasuresCsv(report.datedMeasures),'text/csv; charset=utf-8'],
      ['briefing.md',renderBriefingMarkdown(report),'text/markdown; charset=utf-8'],
      ['index.html',renderBriefing(report),'text/html; charset=utf-8']
    ])await add(name,await installBytes(root,name,content,mime));
    files.sort((a,b)=>a.path.localeCompare(b.path,'en'));
    const manifest={schema:BRIEFING_FORMAT,operationId,createdAt:intent.createdAt,
      comparison:{id:comparisonId,sha256:expectedComparisonSha256},exportId,
      sourceArchive:report.sourceArchive,sourceManifest:report.sourceManifest,
      workspace:report.workspace,producer,files};
    await installBytes(root,'manifest.json',bytes(manifest),'application/json');
    const packed=await archive(root,manifest,files);
    const {path:unused,...archiveIdentity}=packed;
    await atomicJson(root,'sealed.json',{schema:'stellar-forge.fiscaldata-briefing-sealed.v1',
      operationId,createdAt:intent.createdAt,manifestSha256:digest(bytes(manifest)),archive:archiveIdentity});
    await syncDirectory(root);
    return {...await verifyFiscalBriefing({directory:root}),reused:false};
  } finally {
    try { await unlock?.(); }
    finally { if(model&&!borrowed)await model.close(); }
  }
}
