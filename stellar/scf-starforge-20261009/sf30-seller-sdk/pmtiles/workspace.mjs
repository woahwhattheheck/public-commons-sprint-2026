// MIT. One saved PMTiles workspace, native inputs, release choices and request recovery.
import {DatabaseSync} from 'node:sqlite';
import {open,lstat,readdir,mkdir,rename,unlink,rm,realpath,link} from 'node:fs/promises';
import {resolve,join,dirname,isAbsolute,sep} from 'node:path';
import {randomUUID} from 'node:crypto';
import {privateDirectory,readJson,readBytes,writeJson,writeBytes,exists,syncDirectory}
  from '../../sf88-operator-buyer-cli/node/store.mjs';
import {SCHEMA,EDITION_SCHEMA,REVIEW_SCHEMA,need,plain,identifier,text,digest,hash,canonical,clone,timestamp,
  resourceDescriptor,normalizeEdition,editionResourceIds,prepareStyle,compareEditions,resolveStyle,validatePaths} from './model.mjs';
import {ResourceFile,captureObjectDelivery,importLocalResource,importObjectResource,acquireHttpsResource,resourceBytes,retainJson,
  retainFile,fileDescriptor,copyTree,verifyFiles,MAX_METADATA_BYTES,MAX_RESOURCE_BYTES} from './files.mjs';
import {withNativeLease,inspectResource,validateNativeStyle,readRuntime} from './native.mjs';

const json=value=>{const encoded=canonical(value);need(Buffer.byteLength(encoded)<=MAX_METADATA_BYTES,'PMTILES_JSON_SIZE_LIMIT');return encoded;};
const parse=value=>JSON.parse(value);
function recordId(prefix){return prefix+'-'+randomUUID().replaceAll('-','').slice(0,24);}
function nativeId(requestId,suffix){return 'native-'+digest({requestId,suffix}).slice(0,40);}
function paging(offset=0,limit=50){need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200,'PMTILES_PAGE_INVALID');return {offset,limit};}

export async function openPMTilesWorkspace({directory,title='Map release operations',create=true,expectedWorkspaceId=null}={}){
  need(typeof directory==='string'&&isAbsolute(directory),'PMTILES_ABSOLUTE_WORKSPACE_REQUIRED');
  directory=await privateDirectory(resolve(directory),{create});
  for(const child of ['objects','captures','native','releases','receiving','locks','exports'])await privateDirectory(join(directory,child),{create});
  if(await exists(join(directory,'receiving-request.json'))){
    const received=await readJson(join(directory,'receiving-complete.json'),MAX_METADATA_BYTES).catch(e=>{if(e.code==='ENOENT')return null;throw e;});
    const requested=await readJson(join(directory,'receiving-request.json'),MAX_METADATA_BYTES);
    need(received&&received.requestSha256===digest(requested),'PMTILES_RECEIVING_INCOMPLETE',
      'Resume the retained workspace receiving operation before opening its editor.');
  }
  const dbPath=join(directory,'workspace.sqlite3');let fresh=false;
  if(!await exists(dbPath)){
    need(expectedWorkspaceId===null,'PMTILES_SELECTED_WORKSPACE_NOT_FOUND');
    need(create,'PMTILES_WORKSPACE_NOT_FOUND');
    try{const file=await open(dbPath,'wx',0o600);await file.close();fresh=true;}catch(e){if(e.code!=='EEXIST')throw e;}
  }
  const info=await lstat(dbPath);
  need(info.isFile()&&!info.isSymbolicLink()&&(info.mode&0o077)===0,'PMTILES_PRIVATE_DATABASE_REQUIRED');
  const db=new DatabaseSync(dbPath);let closed=false,closing=null;
  try{
    const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    if(!tables.length){
      need(expectedWorkspaceId===null,'PMTILES_SELECTED_WORKSPACE_NOT_INITIALIZED');
      need(create,'PMTILES_WORKSPACE_NOT_INITIALIZED');
      db.exec("BEGIN IMMEDIATE; CREATE TABLE metadata (id INTEGER PRIMARY KEY CHECK(id=1), document TEXT NOT NULL);"+
        "CREATE TABLE resources (id TEXT PRIMARY KEY, document TEXT NOT NULL);"+
        "CREATE TABLE editions (id TEXT NOT NULL, version INTEGER NOT NULL, document TEXT NOT NULL, PRIMARY KEY(id,version));"+
        "CREATE TABLE reviews (id TEXT PRIMARY KEY, document TEXT NOT NULL);"+
        "CREATE TABLE releases (id TEXT PRIMARY KEY, document TEXT NOT NULL);"+
        "CREATE TABLE requests (id TEXT PRIMARY KEY, kind TEXT NOT NULL, input_hash TEXT NOT NULL, input TEXT NOT NULL, status TEXT NOT NULL, result TEXT, error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);"+
        "CREATE TABLE events (sequence INTEGER PRIMARY KEY AUTOINCREMENT, document TEXT NOT NULL);");
      db.prepare('INSERT INTO metadata VALUES(1,?)').run(json({schema:SCHEMA,id:recordId('pmtiles'),title:text(title,240),revision:0,
        authoringPort:null,currentRelease:null,createdAt:timestamp(),updatedAt:timestamp(),receivedFrom:null}));
      db.exec('COMMIT');
    }
    const saved=parse(db.prepare('SELECT document FROM metadata WHERE id=1').get()?.document??'null');
    need(saved?.schema===SCHEMA,'PMTILES_WORKSPACE_SCHEMA_CHANGED');
    if(expectedWorkspaceId!==null)need(expectedWorkspaceId===saved.id,'PMTILES_WORKSPACE_ID_CHANGED');
    db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    const pageSize=Number(db.prepare('PRAGMA page_size').get().page_size);
    need(Number.isSafeInteger(pageSize)&&pageSize>=512&&pageSize<=65536,'PMTILES_DATABASE_PAGE_SIZE_INVALID');
    db.exec('PRAGMA max_page_count='+Math.floor(1073741824/pageSize));
  }catch(error){db.close();throw error;}
  const active=new Set();
  function meta(){need(!closed,'PMTILES_WORKSPACE_CLOSED');return parse(db.prepare('SELECT document FROM metadata WHERE id=1').get().document);}
  function owner(input){need(input.expectedWorkspaceId===meta().id,'PMTILES_WORKSPACE_ID_CHANGED');identifier(input.requestId);}
  function transaction(work){
    need(!closed,'PMTILES_WORKSPACE_CLOSED');db.exec('BEGIN IMMEDIATE');
    try{const result=work();db.exec('COMMIT');return clone(result);}catch(error){db.exec('ROLLBACK');throw error;}
  }
  function changed(event){
    const m=meta();m.revision++;m.updatedAt=timestamp();
    db.prepare('UPDATE metadata SET document=? WHERE id=1').run(json(m));
    db.prepare('INSERT INTO events(document) VALUES(?)').run(json({...event,revision:m.revision,at:m.updatedAt}));
  }
  function requestRow(requestId){const row=db.prepare('SELECT * FROM requests WHERE id=?').get(requestId);return row?{
    id:row.id,kind:row.kind,inputHash:row.input_hash,input:parse(row.input),status:row.status,
    result:row.result?parse(row.result):null,error:row.error?parse(row.error):null,createdAt:row.created_at,updatedAt:row.updated_at}:null;}
  function selectedRequest(kind,input){
    owner(input);const previous=requestRow(input.requestId);
    if(previous)need(previous.kind===kind&&previous.inputHash===digest(input),'PMTILES_REQUEST_INPUT_CHANGED');
    return previous;
  }
  async function writeLocked(work,{signal,onProgress,backup=false}={}){
    need(!closed&&!closing,'PMTILES_WORKSPACE_CLOSING');
    const controller=new AbortController(),abort=()=>controller.abort(signal?.reason);
    if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});
    const task={controller,promise:null};active.add(task);
    task.promise=withNativeLease(join(directory,'locks'),'workspace-files',async()=>
      withNativeLease(join(directory,'locks'),'workspace-write',async leaseFd=>{
        controller.signal.throwIfAborted();
        return work({signal:controller.signal,onProgress,leaseFd});
      }),{shared:!backup});
    try{return await task.promise;}finally{active.delete(task);signal?.removeEventListener('abort',abort);}
  }
  function once(kind,input,work){
    input=clone(input);owner(input);
    return writeLocked(()=>transaction(()=>{
      const previous=selectedRequest(kind,input);if(previous?.status==='COMPLETE')return previous.result;
      need(!previous||previous.status!=='RUNNING','PMTILES_OPERATION_ACTIVE');
      const result=work(),at=timestamp();
      db.prepare('INSERT INTO requests(id,kind,input_hash,input,status,result,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) '+
        'ON CONFLICT(id) DO UPDATE SET status=excluded.status,result=excluded.result,error=NULL,updated_at=excluded.updated_at')
        .run(input.requestId,kind,digest(input),json(input),'COMPLETE',json(result),null,previous?.createdAt??at,at);
      changed({requestId:input.requestId,kind,status:'COMPLETE'});return result;
    }));
  }
  async function external(kind,input,work,commit,options={}){
    input=clone(input);owner(input);
    return writeLocked(async context=>{
      const prior=selectedRequest(kind,input);if(prior?.status==='COMPLETE')return prior.result;
      transaction(()=>{
        const current=selectedRequest(kind,input),at=timestamp();
        db.prepare('INSERT INTO requests(id,kind,input_hash,input,status,result,error,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?) '+
          'ON CONFLICT(id) DO UPDATE SET status=excluded.status,error=NULL,updated_at=excluded.updated_at')
          .run(input.requestId,kind,digest(input),json(input),'RUNNING',null,null,current?.createdAt??at,at);
      });
      try{
        const prepared=await work(context);context.signal.throwIfAborted();
        return transaction(()=>{
          selectedRequest(kind,input);const result=commit(prepared);
          db.prepare("UPDATE requests SET status='COMPLETE',result=?,error=NULL,updated_at=? WHERE id=?")
            .run(json(result),timestamp(),input.requestId);
          changed({requestId:input.requestId,kind,status:'COMPLETE'});return result;
        });
      }catch(error){
        transaction(()=>{db.prepare("UPDATE requests SET status='INTERRUPTED',error=?,updated_at=? WHERE id=?")
          .run(json({code:error.code??'PMTILES_OPERATION_FAILED',message:String(error.message??error).slice(0,2000)}),timestamp(),input.requestId);});
        throw error;
      }
    },options);
  }
  function getResource(id){identifier(id);const row=db.prepare('SELECT document FROM resources WHERE id=?').get(id);
    need(row,'PMTILES_RESOURCE_NOT_FOUND');return resourceDescriptor(parse(row.document));}
  function getEdition(id,version){
    identifier(id);need(Number.isSafeInteger(version)&&version>=1,'PMTILES_EDITION_VERSION_REQUIRED');
    const row=db.prepare('SELECT document FROM editions WHERE id=? AND version=?').get(id,version);
    need(row,'PMTILES_EDITION_NOT_FOUND');return parse(row.document);
  }
  function getReview(id){identifier(id);const row=db.prepare('SELECT document FROM reviews WHERE id=?').get(id);
    need(row,'PMTILES_REVIEW_NOT_FOUND');return parse(row.document);}
  function getRelease(id){identifier(id);const row=db.prepare('SELECT document FROM releases WHERE id=?').get(id);
    need(row,'PMTILES_RELEASE_NOT_FOUND');return parse(row.document);}
  function registerResource(resource){
    resourceDescriptor(resource);const prior=db.prepare('SELECT document FROM resources WHERE id=?').get(resource.id);
    if(prior)need(digest(parse(prior.document))===digest(resource),'PMTILES_RETAINED_RESOURCE_CHANGED');
    else db.prepare('INSERT INTO resources VALUES(?,?)').run(resource.id,json(resource));
    return resource;
  }
  async function importLocal(input,options){const normalized={...clone(input),path:resolve(input.path)};
    return external('IMPORT_LOCAL',normalized,c=>importLocalResource(directory,normalized,c),registerResource,options);}
  async function acquire(input,options){input=clone(input);const transport=options?.transport?clone(options.transport):null;return external('ACQUIRE_HTTPS',input,c=>acquireHttpsResource(directory,input,{...c,transport}),
    registerResource,options);}
  async function adoptObject(input,delivery,options){
    input=clone(input);delivery=captureObjectDelivery(delivery);
    const frozen={...clone(input),sourceObject:{sessionId:delivery.report.native.sessionId,
      configurationSha256:delivery.report.native.configurationSha256,snapshot:delivery.report.native.expectedSnapshot,
      assembly:clone(delivery.assembly)}};
    return external('ADOPT_SF88_OBJECT',frozen,c=>importObjectResource(directory,input,delivery,c),registerResource,options);
  }
  function saveEdition(input){
    input=clone(input);
    return once('SAVE_EDITION',input,()=>{
      identifier(input.editionId);need(Number.isSafeInteger(input.expectedVersion)&&input.expectedVersion>=0,'PMTILES_EXPECTED_VERSION_REQUIRED');
      const latest=db.prepare('SELECT MAX(version) AS version FROM editions WHERE id=?').get(input.editionId).version??0;
      need(latest===input.expectedVersion,'PMTILES_EDITION_VERSION_CHANGED','Reopen the current edition and review its intervening changes.');
      const resources=db.prepare('SELECT document FROM resources').all().map(row=>parse(row.document));
      const value=normalizeEdition(input.edition,resources),version=latest+1;
      const result={...value,id:input.editionId,version,createdAt:timestamp(),sourceDigest:digest(value)};
      db.prepare('INSERT INTO editions VALUES(?,?,?)').run(input.editionId,version,json(result));return result;
    });
  }
  async function inspectEdition(input,runtime,options){
    input=clone(input);
    const edition=getEdition(input.editionId,input.version),selected={...clone(input),editionDigest:digest(edition)};
    const normalizedRuntime=await readRuntime(runtime);selected.runtimeSha256=normalizedRuntime.runtimeSha256;
    return external('INSPECT_EDITION',selected,async context=>{
      const resources=editionResourceIds(edition).map(getResource);
      for(const r of resources)await new ResourceFile(directory,r).verify(context);
      const inspections=[];
      for(const binding of edition.archives){
        const r=getResource(binding.resourceId),existing=inspections.find(v=>v.resourceSha256===r.sha256);
        if(!existing)inspections.push(await inspectResource({directory,resource:r,runtime:normalizedRuntime,
          operationId:nativeId(input.requestId,r.sha256),signal:context.signal,onProgress:context.onProgress,parentLeaseFd:context.leaseFd}));
      }
      const styleRaw=await resourceBytes(directory,getResource(edition.style)),style=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(styleRaw));
      const validation=await validateNativeStyle(normalizedRuntime,style);need(validation.valid,'PMTILES_NATIVE_STYLE_INVALID',
        validation.errors.map(e=>e.message).join('\n'));
      const prepared=prepareStyle(edition,style,resources,inspections);
      if(edition.sprite){
        for(const pair of [edition.sprite,...(edition.sprite.retina?[edition.sprite.retina]:[])]){
          const sprite=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await resourceBytes(directory,getResource(pair.json))));
          need(plain(sprite),'PMTILES_SPRITE_JSON_INVALID');
          const png=await resourceBytes(directory,getResource(pair.png));
          need(png.length>=24&&png.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])),'PMTILES_SPRITE_PNG_INVALID');
          const width=png.readUInt32BE(16),height=png.readUInt32BE(20);
          for(const row of Object.values(sprite))need(plain(row)&&['x','y','width','height'].every(k=>Number.isInteger(row[k])&&row[k]>=0)&&
            row.x+row.width<=width&&row.y+row.height<=height,'PMTILES_SPRITE_BOUNDS_INVALID');
        }
      }
      return {schema:'starforge.pmtiles-edition-inspection.v1',editionId:edition.id,version:edition.version,
        editionDigest:digest(edition),runtimeSha256:normalizedRuntime.runtimeSha256,resources,
        inspections,prepared,validation,completedAt:timestamp()};
    },result=>result,options);
  }
  function review(input){
    input=clone(input);
    return once('REVIEW_EDITION',input,()=>{
      const edition=getEdition(input.editionId,input.version),inspection=requestRow(input.inspectionRequestId);
      need(inspection?.kind==='INSPECT_EDITION'&&inspection.status==='COMPLETE'&&inspection.result.editionDigest===digest(edition),
        'PMTILES_MATCHING_INSPECTION_REQUIRED');
      const m=meta();need(input.expectedCurrentRelease===m.currentRelease,'PMTILES_CURRENT_RELEASE_CHANGED');
      const record={schema:REVIEW_SCHEMA,id:recordId('review'),edition:clone(edition),inspectionRequestId:input.inspectionRequestId,
        inspection:clone(inspection.result),previousReleaseId:m.currentRelease,reviewer:text(input.reviewer,240),
        note:text(input.note??'',20000,{empty:true}),createdAt:timestamp(),workspaceId:m.id};
      record.reviewSha256=digest(record);db.prepare('INSERT INTO reviews VALUES(?,?)').run(record.id,json(record));return record;
    });
  }
  async function prepareRelease(input,options){
    input=clone(input);
    const review=getReview(input.reviewId);
    need(input.reviewSha256===review.reviewSha256,'PMTILES_REVIEW_CHANGED');
    const selected={...clone(input),reviewDigest:digest(review)};
    return external('PREPARE_RELEASE',selected,async context=>{
      const id='release-'+review.reviewSha256.slice(0,32),target=join(directory,'releases',id);
      await privateDirectory(target);await privateDirectory(join(target,'files'));
      const files=[];
      for(const resource of review.inspection.resources){
        const file='files/'+resource.sha256;const descriptor={path:file,bytes:resource.bytes,sha256:resource.sha256};
        await retainFile(new ResourceFile(directory,resource).path,join(target,file),{expected:descriptor,signal:context.signal});
        if(!files.some(row=>row.path===file))files.push(descriptor);
      }
      const append=async(path,value)=>{const descriptor=await retainJson(join(target,path),value);files.push({path,...descriptor});};
      await append('original-edition.json',review.edition);await append('review.json',review);
      await append('prepared-style.json',review.inspection.prepared);
      const nativeSources=Object.fromEntries(review.inspection.prepared.sources.map(s=>[s.nativeId,'files/'+s.sha256]));
      await append('martin.json',{pmtiles:{sources:nativeSources},listen_addresses:'127.0.0.1:3000',workers:1,convert_to_mlt:'disabled',convert_to_mvt:'disabled'});
      files.sort((a,b)=>a.path.localeCompare(b.path));validatePaths(files);
      const manifest={schema:'starforge.pmtiles-release.v1',id,workspaceId:review.workspaceId,reviewSha256:review.reviewSha256,
        editionId:review.edition.id,editionVersion:review.edition.version,previousReleaseId:review.previousReleaseId,
        runtimeSha256:review.inspection.runtimeSha256,files,resourceIds:review.inspection.resources.map(r=>r.id),
        createdAt:review.createdAt};
      manifest.manifestSha256=digest(manifest);await retainJson(join(target,'release.json'),manifest);
      return manifest;
    },release=>{
      const previous=db.prepare('SELECT document FROM releases WHERE id=?').get(release.id);
      if(previous)need(digest(parse(previous.document))===digest(release),'PMTILES_RELEASE_CHANGED');
      else db.prepare('INSERT INTO releases VALUES(?,?)').run(release.id,json(release));
      return release;
    },options);
  }
  async function publish(input,options){
    input=clone(input);
    const release=getRelease(input.releaseId);
    need(input.manifestSha256===release.manifestSha256,'PMTILES_RELEASE_CHANGED');
    return external('PUBLISH_RELEASE',input,async context=>{
      await verifyFiles(join(directory,'releases',release.id),release.files,context);return release;
    },result=>{
      const m=meta();need(m.currentRelease===input.expectedCurrentRelease&&m.currentRelease===result.previousReleaseId,
        'PMTILES_CURRENT_RELEASE_CHANGED');
      m.currentRelease=result.id;db.prepare('UPDATE metadata SET document=? WHERE id=1').run(json(m));
      return {schema:'starforge.pmtiles-publication.v1',workspaceId:m.id,releaseId:result.id,
        previousReleaseId:result.previousReleaseId,manifestSha256:result.manifestSha256,publishedAt:timestamp()};
    },options);
  }
  async function restore(input,options){
    input=clone(input);
    const from=getRelease(input.fromReleaseId),previous=from.previousReleaseId?getRelease(from.previousReleaseId):null;
    need(input.manifestSha256===from.manifestSha256,'PMTILES_RELEASE_CHANGED');
    return external('RESTORE_RELEASE',input,async context=>{
      if(previous)await verifyFiles(join(directory,'releases',previous.id),previous.files,context);return {from,previous};
    },({from,previous})=>{
      const m=meta();need(m.currentRelease===from.id,'PMTILES_CURRENT_RELEASE_CHANGED');
      m.currentRelease=previous?.id??null;db.prepare('UPDATE metadata SET document=? WHERE id=1').run(json(m));
      return {schema:'starforge.pmtiles-restoration.v1',workspaceId:m.id,fromReleaseId:from.id,
        restoredReleaseId:previous?.id??null,restoredAt:timestamp()};
    },options);
  }
  function rememberPort(input){input=clone(input);return once('REMEMBER_PORT',input,()=>{
    const m=meta();need(m.authoringPort===input.expectedPort&&Number.isInteger(input.port)&&input.port>=1&&input.port<=65535,'PMTILES_AUTHORING_PORT_CHANGED');
    m.authoringPort=input.port;db.prepare('UPDATE metadata SET document=? WHERE id=1').run(json(m));return {port:input.port,workspaceId:m.id};
  });}
  function state({offset=0,limit=50}={}){
    paging(offset,limit);const m=meta(),counts={};
    for(const table of ['resources','editions','reviews','releases','requests'])counts[table]=Number(db.prepare('SELECT COUNT(*) AS n FROM '+table).get().n);
    return {...m,counts,editions:db.prepare('SELECT document FROM editions ORDER BY rowid DESC LIMIT ? OFFSET ?').all(limit,offset).map(r=>{
      const e=parse(r.document);return {id:e.id,version:e.version,name:e.name,createdAt:e.createdAt,sourceDigest:e.sourceDigest};}),
      hasMore:offset+limit<counts.editions,offset,nextOffset:offset+limit,
      releases:db.prepare('SELECT document FROM releases ORDER BY rowid DESC LIMIT 30').all().map(r=>parse(r.document)),
      operations:db.prepare('SELECT id,kind,status,created_at,updated_at,error FROM requests ORDER BY updated_at DESC LIMIT 30').all().map(r=>({...r,error:r.error?parse(r.error):null}))};
  }
  function listResources({offset=0,limit=100,kind=null}={}){
    paging(offset,limit);need(kind===null||['pmtiles','style','sprite-json','sprite-png','glyph','document'].includes(kind),'PMTILES_RESOURCE_KIND_INVALID');
    const condition=kind===null?'':' WHERE json_extract(document,\'$.kind\')=?',args=kind===null?[]:[kind];
    const total=Number(db.prepare('SELECT COUNT(*) AS n FROM resources'+condition).get(...args).n);
    const rows=db.prepare('SELECT document FROM resources'+condition+' ORDER BY rowid DESC LIMIT ? OFFSET ?').all(...args,limit,offset).map(r=>parse(r.document));
    return {items:rows,total,offset,nextOffset:offset+rows.length,hasMore:offset+rows.length<total};
  }
  async function exportWorkspace({destination,requestId,expectedWorkspaceId,signal}){
    identifier(requestId);need(expectedWorkspaceId===meta().id,'PMTILES_WORKSPACE_ID_CHANGED');
    need(isAbsolute(destination),'PMTILES_ABSOLUTE_EXPORT_DIRECTORY_REQUIRED');destination=resolve(destination);
    need(!destination.startsWith(directory+sep)&&destination!==directory&&!directory.startsWith(destination+sep),
      'PMTILES_SEPARATE_EXPORT_DIRECTORY_REQUIRED');
    return writeLocked(async context=>{
      await privateDirectory(destination);
      const request={schema:'starforge.pmtiles-workspace-export-request.v1',requestId,workspaceId:expectedWorkspaceId};
      await retainJson(join(destination,'export-request.json'),request);
      if(await exists(join(destination,'handover.json'))){
        const manifest=await readJson(join(destination,'handover.json'),MAX_METADATA_BYTES);
        need(manifest.workspaceId===expectedWorkspaceId&&manifest.requestSha256===digest(request),'PMTILES_EXPORT_SELECTION_CHANGED');
        const selected=clone(manifest);delete selected.sha256;need(manifest.sha256===digest(selected),'PMTILES_HANDOVER_CHANGED');
        await verifyFiles(destination,manifest.files,context);return {directory:destination,manifest};
      }
      const snapshot=join(destination,'workspace.sqlite3'),selectionPath=join(destination,'export-selection.json');
      let selection;
      if(await exists(selectionPath)){
        selection=await readJson(selectionPath,MAX_METADATA_BYTES);
        need(selection.requestSha256===digest(request),'PMTILES_EXPORT_SELECTION_CHANGED');
        const expected=selection.files.find(f=>f.path==='workspace.sqlite3');
        const actual=await fileDescriptor(snapshot,context);
        need(expected&&actual.sha256===expected.sha256&&actual.bytes===expected.bytes,'PMTILES_EXPORT_SNAPSHOT_CHANGED');
      }else{
        const m=meta();
        if(!await exists(snapshot)){
          const temporary=join(destination,'.database-'+randomUUID());
          try{
            db.exec("VACUUM INTO '"+temporary.replaceAll("'","''")+"'");
            const handle=await open(temporary,'r+');try{await handle.chmod(0o600);await handle.sync();}finally{await handle.close();}
            await link(temporary,snapshot);await syncDirectory(destination);
          }finally{await unlink(temporary).catch(e=>{if(e.code!=='ENOENT')throw e;});}
        }
        const selectedDb=new DatabaseSync(snapshot,{readOnly:true});
        try{const saved=parse(selectedDb.prepare('SELECT document FROM metadata WHERE id=1').get().document);
          need(saved.id===m.id&&saved.revision===m.revision,'PMTILES_EXPORT_SNAPSHOT_CHANGED',
            'This partial snapshot predates the current workspace. Use a new export directory; its original snapshot remains retained.');
        }finally{selectedDb.close();}
        const files=[];
        async function inventory(relative){
          const full=join(directory,relative);need(await realpath(full)===full,'PMTILES_EXPORT_SOURCE_CHANGED');
          for(const row of (await readdir(full,{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){
            context.signal.throwIfAborted();const path=relative+'/'+row.name;
            if(row.isDirectory()){await inventory(path);continue;}
            need(row.isFile()&&!row.isSymbolicLink(),'PMTILES_EXPORT_NONFILE_MEMBER');
            files.push({path,...await fileDescriptor(join(directory,path),context)});
          }
        }
        for(const folder of ['objects','captures','native','releases','receiving'])await inventory(folder);
        files.push({path:'workspace.sqlite3',...await fileDescriptor(snapshot,context)});
        files.sort((a,b)=>a.path.localeCompare(b.path));validatePaths(files);
        need(files.reduce((n,f)=>n+f.bytes,0)<=17179869184,'PMTILES_HANDOVER_SIZE_LIMIT');
        selection={schema:'starforge.pmtiles-workspace-export-selection.v1',requestSha256:digest(request),
          workspaceId:m.id,revision:m.revision,currentRelease:m.currentRelease,files,exportedAt:timestamp()};
        await retainJson(selectionPath,selection);
      }
      for(const row of selection.files){
        if(row.path==='workspace.sqlite3')continue;
        await retainFile(join(directory,row.path),join(destination,row.path),{expected:row,signal:context.signal});
      }
      await verifyFiles(destination,selection.files,context);
      const manifest={schema:'starforge.pmtiles-workspace-handover.v1',requestSha256:digest(request),workspaceId:selection.workspaceId,
        revision:selection.revision,currentRelease:selection.currentRelease,files:selection.files,exportedAt:selection.exportedAt};
      manifest.sha256=digest(manifest);await retainJson(join(destination,'handover.json'),manifest);
      return {directory:destination,manifest};
    },{signal,backup:true});
  }
  return Object.freeze({directory,state,listResources,getResource,getEdition,getReview,getRelease,getRequest:requestRow,
    importLocal,acquire,adoptObject,saveEdition,inspectEdition,review,prepareRelease,publish,restore,rememberPort,
    compare:({leftId,leftVersion,rightId,rightVersion})=>compareEditions(getEdition(leftId,leftVersion),getEdition(rightId,rightVersion)),
    resourceFile:id=>new ResourceFile(directory,getResource(id)),releaseDirectory:id=>join(directory,'releases',getRelease(id).id),exportWorkspace,
    async close(){
      if(!closing)closing=(async()=>{for(const task of active)task.controller.abort(new Error('PMTILES_WORKSPACE_CLOSING'));
        await Promise.allSettled([...active].map(t=>t.promise));db.close();closed=true;})();return closing;
    }});
}

export async function receivePMTilesWorkspace({source,destination,expectedWorkspaceId,expectedSha256,requestId,signal}={}){
  identifier(requestId);need(isAbsolute(source)&&isAbsolute(destination),'PMTILES_ABSOLUTE_RECEIVING_DIRECTORY_REQUIRED');
  source=resolve(source);destination=resolve(destination);
  need(source!==destination&&!destination.startsWith(source+sep)&&!source.startsWith(destination+sep),'PMTILES_SEPARATE_RECEIVING_DIRECTORY_REQUIRED');
  const manifest=await readJson(join(source,'handover.json'),MAX_METADATA_BYTES);
  need(manifest.schema==='starforge.pmtiles-workspace-handover.v1'&&manifest.workspaceId===expectedWorkspaceId&&
    manifest.sha256===expectedSha256,'PMTILES_HANDOVER_SELECTION_CHANGED');
  const contents=clone(manifest);delete contents.sha256;need(digest(contents)===manifest.sha256,'PMTILES_HANDOVER_CHANGED');
  validatePaths(manifest.files);
  const snapshot=manifest.files.find(row=>row.path==='workspace.sqlite3');
  need(snapshot&&manifest.files.every(row=>row.path==='workspace.sqlite3'||
    ['objects','captures','native','releases','receiving'].includes(row.path.split('/')[0])),'PMTILES_HANDOVER_MEMBER_INVALID');
  await verifyFiles(source,manifest.files,{signal});
  await privateDirectory(destination);
  for(const name of ['objects','captures','native','releases','receiving','locks','exports'])await privateDirectory(join(destination,name));
  return withNativeLease(join(destination,'locks'),'workspace-write',async()=>{
    const request={schema:'starforge.pmtiles-workspace-receiving-request.v1',requestId,
      workspaceId:expectedWorkspaceId,handoverSha256:expectedSha256,sourceRevision:manifest.revision};
    const requestPath=join(destination,'receiving-request.json'),completePath=join(destination,'receiving-complete.json');
    if(!await exists(requestPath))need(!await exists(join(destination,'workspace.sqlite3')),'PMTILES_RECEIVING_DESTINATION_IN_USE');
    await retainJson(requestPath,request);
    if(await exists(completePath)){
      const receipt=await readJson(completePath,MAX_METADATA_BYTES);
      need(receipt.requestSha256===digest(request),'PMTILES_RECEIVING_REQUEST_CHANGED');
      const actualDb=new DatabaseSync(join(destination,'workspace.sqlite3'),{readOnly:true});
      try{const current=parse(actualDb.prepare('SELECT document FROM metadata WHERE id=1').get().document);
        need(current.id===expectedWorkspaceId&&current.revision>=receipt.revision&&
          current.receivedFrom?.handoverSha256===expectedSha256,'PMTILES_RECEIVING_WORKSPACE_CHANGED');
      }finally{actualDb.close();}
      return receipt;
    }
    const retained=join(destination,'receiving',expectedSha256);await privateDirectory(retained);
    await retainJson(join(retained,'handover.json'),manifest);
    await retainFile(join(source,'workspace.sqlite3'),join(retained,'workspace.sqlite3'),{expected:snapshot,signal});
    for(const row of manifest.files){
      if(row.path==='workspace.sqlite3')continue;
      await retainFile(join(source,row.path),join(destination,row.path),{expected:row,signal});
    }
    const live=join(destination,'workspace.sqlite3');
    if(!await exists(live))await retainFile(join(retained,'workspace.sqlite3'),live,{expected:snapshot,signal});
    const nativeDb=new DatabaseSync(live);let received;
    try{
      nativeDb.exec('PRAGMA busy_timeout=5000; PRAGMA synchronous=FULL; BEGIN IMMEDIATE;');
      const current=parse(nativeDb.prepare('SELECT document FROM metadata WHERE id=1').get().document);
      need(current.schema===SCHEMA&&current.id===expectedWorkspaceId,'PMTILES_WORKSPACE_ID_CHANGED');
      if(current.receivedFrom?.handoverSha256!==expectedSha256){
        need(current.revision===manifest.revision&&current.currentRelease===manifest.currentRelease,'PMTILES_RECEIVING_WORKSPACE_CHANGED');
        current.receivedFrom={handoverSha256:expectedSha256,sourceRevision:manifest.revision,requestId};
        current.revision++;current.updatedAt=timestamp();
        nativeDb.prepare('UPDATE metadata SET document=? WHERE id=1').run(json(current));
        nativeDb.prepare('INSERT INTO events(document) VALUES(?)').run(json({kind:'RECEIVE_WORKSPACE',requestId,
          handoverSha256:expectedSha256,revision:current.revision,at:current.updatedAt}));
      }else need(current.receivedFrom.requestId===requestId,'PMTILES_RECEIVING_REQUEST_CHANGED');
      received={schema:'starforge.pmtiles-workspace-received.v1',requestSha256:digest(request),workspaceId:expectedWorkspaceId,
        handoverSha256:expectedSha256,sourceRevision:manifest.revision,revision:current.revision,currentRelease:current.currentRelease,
        retainedSnapshot:'receiving/'+expectedSha256+'/workspace.sqlite3',receivedAt:current.updatedAt};
      nativeDb.exec('COMMIT');
    }catch(error){try{nativeDb.exec('ROLLBACK');}catch{}throw error;}finally{nativeDb.close();}
    await retainJson(completePath,received);return received;
  });
}
