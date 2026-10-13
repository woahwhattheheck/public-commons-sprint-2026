/** Complete streamed exports and independently editable receiving, on the original engine. */
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {DatabaseSync,backup} from 'node:sqlite';
import {MeasurementWorkspace} from './workspace.mjs';
import {hash,stable,parseSource} from './normalise.mjs';
import {InputError,csv} from './parse.mjs';
import {materializeOriginals} from './large_sources.mjs';
import {ensureSourceSchema,sourceChunks,normalizedCSV,intakeRoot,intakeStatus} from './large_intake.mjs';
import {CHUNK,identifier,atomicJSON,readJSON,fileChunks,fileDigest,copyVerified,withDirectoryLock,writeAll,listFiles,safePath} from './large_io.mjs';
const TABLES={
 meta:['key','value'],imports:['id','kind','label','created_at','sha','origin','mapping','content','summary','rejected'],
 records:['id','logical_key','station_id','parameter','sampled_date','censor','unit','fraction','data'],
 import_records:['import_id','record_id','source_line'],stations:['id','data'],mappings:['station_id','reach_id','data'],
 reviews:['record_id','state','data'],selected_versions:['logical_key','record_id'],events:['id','created_at','kind','entity','data'],
 exports:['id','created_at','revision','kind','content'],source_chunks:['import_id','sequence','bytes'],
 source_rejections:['import_id','category','sequence','data'],large_receives:['id','source_revision','received_revision','manifest']
};
const CORE=Object.keys(TABLES).slice(0,10);
const SKIP=new Set(['.large','measurements.sqlite','measurements.sqlite-wal','measurements.sqlite-shm','measurements.sqlite-journal','measurement-process.log']);
const RECORD_FIELDS=['id','stationId','reachId','sampledDate','sampledAt','timePrecision','parameter','characteristic','basis','fraction','value','lower','upper','censor','unit','qualifier','status','method','laboratory','review','eligible','reasons','sourceResultId'];
const INPUT_FIELDS=['id','stationId','reachId','sampledDate','sampledAt','timePrecision','parameter','basis','fraction','value','unit','method','sourceResultId'];
const RULES={nondetectSubstitution:'none',replicateAggregation:'none',bod5ToUltimateBod:'not-performed',timeMatching:'not-performed',fractions:'preserved',nativeAnnualLoadBinding:'explicit downstream derivation required; PO4_KG/NH4_KG/NO3_KG are not concentration aliases'};
const tool=fileURLToPath(new URL('./large_archive.py',import.meta.url));
function archive(...args){return JSON.parse(execFileSync(process.env.MEASUREMENTS_PYTHON||'python3',[tool,...args],{encoding:'utf8',maxBuffer:64*1024*1024,stdio:['ignore','pipe','pipe']}));}
function editionRoot(w,id){if(!identifier(id))throw new InputError('Invalid edition identifier');return path.join(w.directory,'.large','exports',id);}
function digestChunks(file){const digest=createHash('sha256');let bytes=0;const chunks=[];for(const data of fileChunks(file)){digest.update(data);bytes+=data.length;chunks.push(hash(data));}return {bytes,sha256:digest.digest('hex'),chunks};}
function* lines(file){let text='';const decoder=new TextDecoder('utf-8',{fatal:true});for(const b of fileChunks(file)){text+=decoder.decode(b,{stream:true});let p;while((p=text.indexOf('\n'))>=0){yield text.slice(0,p);text=text.slice(p+1);}}text+=decoder.decode();if(text)yield text;}
function writeText(fd,text){writeAll(fd,Buffer.from(text));}
function recordValue(r){return {id:r.id,stationId:r.stationId,reachId:r.mapping?.reachId||'',sampledDate:r.sampledDate,sampledAt:r.sampledAt,timePrecision:r.timePrecision,parameter:r.parameter,characteristic:r.characteristic,basis:r.basis,fraction:r.fraction,value:r.value,lower:r.lower,upper:r.upper,censor:r.censor,unit:r.unit,qualifier:r.qualifier,status:r.status,method:r.method,laboratory:r.laboratory,review:r.review.state,eligible:r.eligible.ok,reasons:r.eligible.reasons,sourceResultId:r.sourceResultId};}
function inputValue(w,r){return {id:r.id,stationId:r.stationId,reachId:r.mapping?.reachId||'',sampledDate:r.sampledDate,sampledAt:r.sampledAt,timePrecision:r.timePrecision,parameter:r.parameter,unit:r.unit,value:r.value,censor:r.censor,lower:r.lower,upper:r.upper,basis:r.basis,fraction:r.fraction,method:r.method,sourceResultId:r.sourceResultId,logicalKey:r.logicalKey,sourceReferences:w.recordSources(r.id)};}
function writePopulations(w,directory,filters,exportId){
 const accepted=path.join(directory,'accepted.jsonl'),excluded=path.join(directory,'excluded.jsonl'),records=path.join(directory,'records.csv'),inputs=path.join(directory,'calibration.csv');
 const fds=[accepted,excluded,records,inputs].map(f=>fs.openSync(f,'wx',0o600));const counts={accepted:0,excluded:0};
 const recordHeader=csv([],RECORD_FIELDS),inputHeader=csv([],INPUT_FIELDS);
 try{writeText(fds[2],recordHeader);writeText(fds[3],inputHeader);
  for(const row of w.iterate(filters)){
   writeText(fds[2],csv([recordValue(row)],RECORD_FIELDS).slice(recordHeader.length));const base=inputValue(w,row);
   if(row.eligible.reasons.length){counts.excluded++;writeText(fds[1],stable({...base,reasons:[...new Set(row.eligible.reasons)]})+'\n');}
   else{counts.accepted++;writeText(fds[0],stable(base)+'\n');writeText(fds[3],csv([base],INPUT_FIELDS).slice(inputHeader.length));}
  }
  for(const fd of fds)fs.fsyncSync(fd);
 }finally{for(const fd of fds)fs.closeSync(fd);}
 const metadata={format:'upper-savannah-calibration-input',version:1,createdAt:new Date().toISOString(),workspaceRevision:w.revision(),filters,counts,rules:RULES};
 const fd=fs.openSync(path.join(directory,'calibration.json'),'wx',0o600),digest=createHash('sha256');
 const emit=text=>{digest.update(text);writeText(fd,text);};let first=true;
 try{emit('{');for(const key of [...Object.keys(metadata),'accepted','excluded'].sort()){
   if(!first)emit(',');first=false;emit(JSON.stringify(key)+':');
   if(key==='accepted'||key==='excluded'){emit('[');let separator='';for(const line of lines(key==='accepted'?accepted:excluded)){emit(separator+line);separator=',';}emit(']');}
   else emit(stable(metadata[key]));
  }
  digest.update('}');const valueSha256=digest.digest('hex');writeText(fd,',"sha256":'+JSON.stringify(valueSha256)+',"exportId":'+JSON.stringify(exportId)+'}\n');fs.fsyncSync(fd);return {...metadata,sha256:valueSha256,exportId};
 }finally{fs.closeSync(fd);}
}
function registerEdition(w,value){
 const content={format:value.format,id:value.id,workspaceRevision:value.workspaceRevision,createdAt:value.createdAt,filters:value.filters,counts:value.counts,recordCount:value.recordCount,calibrationSha256:value.calibrationSha256,files:value.files.filter(file=>file.path!=='project.zip'),chunkBytes:value.chunkBytes};
 const existing=w.db.prepare('SELECT kind,content FROM exports WHERE id=?').get(value.id);
 if(existing){if(existing.kind!=='large-file-edition'||stable(JSON.parse(existing.content))!==stable(content))throw new InputError('Existing native export identifier contains a different edition',409);}
 else w.db.prepare('INSERT INTO exports VALUES(?,?,?,?,?)').run(value.id,value.createdAt,value.workspaceRevision,'large-file-edition',stable(content));
 return value;
}
function verifyMembers(root,members){
 for(const member of members){const actual=fileDigest(path.join(root,safePath(member.path)));
  if(actual.bytes!==member.bytes||actual.sha256!==member.sha256)throw new InputError('Retained edition member changed: '+member.path,409);
 }
}
/** One revision, durable phase boundaries, same-ID reconnect after process death. */
export async function exportEdition(w,{id=hash(randomUUID()),filters={}}={}){
 const root=editionRoot(w,id);
 return withDirectoryLock(root,async()=>{
  const resultFile=path.join(root,'edition.json'),ready=path.join(root,'files');
  const requestFile=path.join(root,'request.json');
  if(fs.existsSync(requestFile)){
   if(stable(readJSON(requestFile).filters)!==stable(filters))throw new InputError('This edition retains different filters; reopen it or choose a new identifier',409);
  }else atomicJSON(requestFile,{format:'upper-savannah-measurement-export-request/v1',id,filters});
  if(fs.existsSync(resultFile))return registerEdition(w,readJSON(resultFile));
  // Publication may have completed just before the response/outer receipt was lost.
  if(fs.existsSync(path.join(ready,'edition.json'))){
   const result=readJSON(path.join(ready,'edition.json'));verifyMembers(ready,result.files);
   atomicJSON(resultFile,result);atomicJSON(path.join(root,'status.json'),{id,phase:'complete',workspaceRevision:result.workspaceRevision});return registerEdition(w,result);
  }
  const savedFile=path.join(w.directory,'saved-measurement-editions',id,'edition.json');
  const build=path.join(root,'build'),snapshot=path.join(build,'workspace');
  const capturedFile=path.join(build,'captured.json'),populationFile=path.join(build,'population.json'),packedFile=path.join(build,'packed.json');
  // A transferred saved population is already complete. Its receiving workspace
  // creates a new archive under a new ID; it never silently replaces that history.
  if(fs.existsSync(savedFile)&&!fs.existsSync(capturedFile)){
   const saved=readJSON(savedFile);if(stable(saved.filters)!==stable(filters))throw new InputError('This saved edition retains different filters',409);return registerEdition(w,saved);
  }
  let view;
  try{
   if(!fs.existsSync(capturedFile)){
    fs.rmSync(build,{recursive:true,force:true});fs.mkdirSync(snapshot,{recursive:true});
    atomicJSON(path.join(root,'status.json'),{id,phase:'snapshotting'});
    const before=listFiles(w.directory,{exclude:SKIP});
    await backup(w.db,path.join(snapshot,'measurements.sqlite'));
    for(const member of before)copyVerified(path.join(w.directory,member.path),path.join(snapshot,member.path),member);
    if(stable(before)!==stable(listFiles(w.directory,{exclude:SKIP})))throw new InputError('Companion sources changed during capture; repeat this edition identifier',409);
    view=new MeasurementWorkspace(snapshot);const revision=view.revision();materializeOriginals(view,snapshot);view.close();view=null;
    for(const suffix of ['-wal','-shm','-journal'])fs.rmSync(path.join(snapshot,'measurements.sqlite'+suffix),{force:true});
    atomicJSON(capturedFile,{workspaceRevision:revision,files:listFiles(snapshot)});
   }
   const captured=readJSON(capturedFile),revision=captured.workspaceRevision;
   verifyMembers(snapshot,captured.files);
   const populationNames=['records.csv','calibration.json','calibration.csv','accepted.jsonl','excluded.jsonl'];
   if(!fs.existsSync(populationFile)){
    for(const name of populationNames)fs.rmSync(path.join(build,name),{force:true});
    atomicJSON(path.join(root,'status.json'),{id,phase:'exporting',workspaceRevision:revision});
    view=new MeasurementWorkspace(snapshot);const calibration=writePopulations(view,build,filters,id);view.close();view=null;
    const files=populationNames.map(name=>({path:name,...digestChunks(path.join(build,name))}));
    atomicJSON(populationFile,{calibration,files});
   }
   const population=readJSON(populationFile),{calibration}=population,populationFiles=population.files;
   verifyMembers(build,populationFiles);
   const saved={format:'upper-savannah-measurements-edition/v1',id,workspaceRevision:revision,createdAt:calibration.createdAt,filters,counts:calibration.counts,recordCount:calibration.counts.accepted+calibration.counts.excluded,calibrationSha256:calibration.sha256,files:populationFiles,chunkBytes:CHUNK};
   const savedRelative='saved-measurement-editions/'+id,snapshotSaved=path.join(snapshot,savedRelative);
   fs.mkdirSync(snapshotSaved,{recursive:true});
   for(const member of populationFiles)copyVerified(path.join(build,member.path),path.join(snapshotSaved,member.path),member);
   const snapshotSavedMeta=path.join(snapshotSaved,'edition.json');
   if(fs.existsSync(snapshotSavedMeta)){if(stable(readJSON(snapshotSavedMeta))!==stable(saved))throw new InputError('Captured saved population differs',409);}
   else atomicJSON(snapshotSavedMeta,saved);
   for(const suffix of ['-wal','-shm','-journal'])fs.rmSync(path.join(snapshot,'measurements.sqlite'+suffix),{force:true});
   if(!fs.existsSync(packedFile)){
    fs.rmSync(path.join(build,'project.zip'),{force:true});
    atomicJSON(path.join(root,'status.json'),{id,phase:'packing',workspaceRevision:revision});
    const packed=archive('pack',snapshot,path.join(build,'project.zip'),'--revision',String(revision));
    atomicJSON(packedFile,{originalFiles:packed.manifest.files.length,file:{path:'project.zip',...digestChunks(path.join(build,'project.zip'))}});
   }
   const packed=readJSON(packedFile);verifyMembers(build,[packed.file]);
   const savedRoot=path.join(w.directory,savedRelative);
   for(const member of [...populationFiles,{path:'edition.json',...fileDigest(snapshotSavedMeta)}])copyVerified(path.join(snapshotSaved,member.path),path.join(savedRoot,member.path),member);
   const result={...saved,originalFiles:packed.originalFiles,files:[packed.file,...populationFiles]};
   atomicJSON(path.join(build,'edition.json'),result);
   // Keep the captured source until the entire edition is atomically published.
   fs.renameSync(build,ready);atomicJSON(resultFile,result);
   atomicJSON(path.join(root,'status.json'),{id,phase:'complete',workspaceRevision:revision});
   fs.rmSync(path.join(ready,'workspace'),{recursive:true,force:true});return registerEdition(w,result);
  }catch(error){
   try{atomicJSON(path.join(root,'status.json'),{id,phase:'interrupted',error:error.message});}catch(receiptError){error.receiptError=receiptError.message;}
   throw error;
  }finally{view?.close();}
 });
}
export function listEditions(w){
 const values=new Map(),saved=path.join(w.directory,'saved-measurement-editions'),cache=path.join(w.directory,'.large','exports');
 if(fs.existsSync(saved))for(const id of fs.readdirSync(saved).filter(identifier)){const file=path.join(saved,id,'edition.json');if(fs.existsSync(file))values.set(id,readJSON(file));}
 if(fs.existsSync(cache))for(const id of fs.readdirSync(cache).filter(identifier)){const file=path.join(cache,id,'edition.json'),status=path.join(cache,id,'status.json');if(fs.existsSync(file))values.set(id,readJSON(file));else if(!values.has(id)&&fs.existsSync(status))values.set(id,readJSON(status));}
 return [...values.values()].sort((a,b)=>(b.createdAt||'').localeCompare(a.createdAt||''));
}
export function editionInfo(w,id){
 const root=editionRoot(w,id),cached=path.join(root,'edition.json'),saved=path.join(w.directory,'saved-measurement-editions',id,'edition.json');
 if(fs.existsSync(cached))return readJSON(cached);if(fs.existsSync(saved))return readJSON(saved);throw new InputError('Saved edition not found',404);
}
export function editionMemberFile(w,id,name){
 const edition=editionInfo(w,id),member=edition.files.find(x=>x.path===name);if(!member)throw new InputError('Unknown saved edition member',404);
 const cached=path.join(editionRoot(w,id),'files',safePath(name)),saved=path.join(w.directory,'saved-measurement-editions',id,safePath(name));
 return {member,file:fs.existsSync(cached)?cached:saved};
}
export function editionChunk(w,id,name,index){
 const {member,file}=editionMemberFile(w,id,name);
 if(!Number.isSafeInteger(index)||index<0||index>=member.chunks.length)throw new InputError('Unknown edition chunk',404);
 const buffer=Buffer.alloc(Math.min(CHUNK,member.bytes-index*CHUNK)),fd=fs.openSync(file,'r');let read;
 try{read=fs.readSync(fd,buffer,0,buffer.length,index*CHUNK);}finally{fs.closeSync(fd);}
 if(read!==buffer.length||hash(buffer)!==member.chunks[index])throw new InputError('Retained edition member changed',409);
 return {id,name,index,bytes:buffer.length,sha256:member.chunks[index],base64:buffer.toString('base64')};
}
function requireSchema(file){
 const db=new DatabaseSync(file,{readOnly:true});try{
  db.exec('PRAGMA trusted_schema=OFF');const entries=[...db.prepare("SELECT type,name,tbl_name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").iterate()];
  if(entries.some(x=>!['table','index'].includes(x.type)||!Object.hasOwn(TABLES,x.tbl_name)))throw new InputError('Archive uses an unsupported Measurements database schema');
  const names=entries.filter(x=>x.type==='table').map(x=>x.name);
  if(CORE.some(name=>!names.includes(name)))throw new InputError('Archive is missing a native Measurements table');
  for(const name of names){const columns=[...db.prepare(`PRAGMA table_info("${name}")`).iterate()].map(x=>x.name);if(stable(columns)!==stable(TABLES[name]))throw new InputError('Native table columns differ: '+name);}
  if(db.prepare('PRAGMA quick_check').get().quick_check!=='ok'||[...db.prepare('PRAGMA foreign_key_check').iterate()].length)throw new InputError('Native measurement database failed its integrity check');
  return names;
 }finally{db.close();}
}
/** Disk-backed counterpart of the original complete-source receive validation. */
export function validateReceived(directory){
 const file=path.join(directory,'measurements.sqlite'),names=requireSchema(file),db=new DatabaseSync(file,{readOnly:true});
 db.exec('BEGIN');const facade={db,directory};const scratch=path.join(directory,'.validation-'+randomUUID()+'.sqlite'),expected=new DatabaseSync(scratch);let imports=0;
 try{
  expected.exec(`PRAGMA journal_mode=OFF;PRAGMA cache_size=-4096;BEGIN;
   CREATE TABLE records(id TEXT PRIMARY KEY,data TEXT NOT NULL);
   CREATE TABLE links(import_id TEXT,record_id TEXT,line INTEGER,PRIMARY KEY(import_id,record_id,line));
   CREATE TABLE stations(id TEXT PRIMARY KEY);CREATE TABLE counts(kind TEXT,key TEXT,n INTEGER,PRIMARY KEY(kind,key));
   CREATE TABLE rejected(category INTEGER,sequence INTEGER,data TEXT,PRIMARY KEY(category,sequence));`);
  const saveRecord=expected.prepare('INSERT OR IGNORE INTO records VALUES(?,?)'),saveLink=expected.prepare('INSERT OR IGNORE INTO links VALUES(?,?,?)'),station=expected.prepare('INSERT OR IGNORE INTO stations VALUES(?)'),count=expected.prepare('INSERT INTO counts VALUES(?,?,1) ON CONFLICT(kind,key) DO UPDATE SET n=n+1'),reject=expected.prepare('INSERT INTO rejected VALUES(?,?,?)');
  for(const source of db.prepare('SELECT id,kind,sha,mapping,summary,rejected,origin FROM imports ORDER BY id').iterate()){
   imports++;expected.exec('DELETE FROM stations;DELETE FROM counts;DELETE FROM rejected');let accepted=0,rejected=0,censored=0,mapping;
   const digest=createHash('sha256');for(const b of sourceChunks(facade,source))digest.update(b);if(digest.digest('hex')!==source.sha)throw new InputError('Original source checksum differs');
   let stream;
   if(['wqp','stations'].includes(source.kind))stream=normalizedCSV(sourceChunks(facade,source),source.kind,JSON.parse(source.mapping));
   else if(source.kind==='usgs-daily'){
    const parsed=parseSource({kind:source.kind,text:Buffer.concat([...sourceChunks(facade,source)]).toString('utf8'),mapping:JSON.parse(source.mapping)});
    stream=[{type:'header',mapping:parsed.mapping},...parsed.rows.map(x=>({type:'row',...x})),...parsed.rejected.map(entry=>({type:'rejected',category:1,entry}))];
   }else throw new InputError('Unknown native source kind');
   for(const item of stream){
    if(item.type==='header'){mapping=item.mapping;continue;}
    if(item.type==='rejected'){reject.run(item.category,rejected++,stable(item.entry));continue;}
    accepted++;const row=item.row;station.run(row.stationId||row.id);if(row.parameter)count.run('parameter',row.parameter);if(row.censor&&row.censor!=='none')censored++;for(const issue of row.issues||[])count.run('issue',issue);
    if(source.kind!=='stations'){const id=hash(stable([row.sourceKind,row]));saveRecord.run(id,stable(row));saveLink.run(source.id,id,item.line);}
   }
   const summary={rows:accepted,rejectedCount:rejected,stationCount:expected.prepare('SELECT COUNT(*) n FROM stations').get().n,censored,parameters:Object.fromEntries(expected.prepare("SELECT key,n FROM counts WHERE kind='parameter'").iterate().map(x=>[x.key,x.n])),issues:Object.fromEntries(expected.prepare("SELECT key,n FROM counts WHERE kind='issue'").iterate().map(x=>[x.key,x.n]))};
   if(hash(stable([source.kind,source.sha,mapping]))!==source.id||stable(summary)!==stable(JSON.parse(source.summary)))throw new InputError('Native source identity or parse accounting differs');
   const chunked=names.includes('source_chunks')&&db.prepare('SELECT 1 FROM source_chunks WHERE import_id=? LIMIT 1').get(source.id);
   const actualRejected=chunked?db.prepare('SELECT data FROM source_rejections WHERE import_id=? ORDER BY category,sequence').iterate(source.id):JSON.parse(source.rejected).map(data=>({data:JSON.stringify(data)}));
   const expectedRejected=expected.prepare('SELECT data FROM rejected ORDER BY category,sequence').iterate();let n=0;
   for(const row of actualRejected){const next=expectedRejected.next();if(next.done||stable(JSON.parse(row.data))!==next.value.data)throw new InputError('Original rejection population differs');n++;}
   if(n!==rejected||!expectedRejected.next().done)throw new InputError('Original rejection count differs');
   for(const page of JSON.parse(source.origin).pages||[])if(hash(page.text)!==page.sha)throw new InputError('Provider page checksum differs');
  }
  const expectedCount=expected.prepare('SELECT COUNT(*) n FROM records').get().n;
  if(expectedCount!==db.prepare('SELECT COUNT(*) n FROM records').get().n)throw new InputError('Native record population differs from original sources');
  const find=expected.prepare('SELECT data FROM records WHERE id=?');
  for(const row of db.prepare('SELECT * FROM records').iterate()){
   const data=JSON.parse(row.data);if(find.get(row.id)?.data!==stable(data))throw new InputError('Canonical measurement differs from its complete original source');
   for(const [column,key] of Object.entries({logical_key:'logicalKey',station_id:'stationId',parameter:'parameter',sampled_date:'sampledDate',censor:'censor',unit:'unit',fraction:'fraction'}))if(row[column]!==data[key])throw new InputError('Native measurement index differs');
  }
  if(expected.prepare('SELECT COUNT(*) n FROM links').get().n!==db.prepare('SELECT COUNT(*) n FROM import_records').get().n)throw new InputError('Source-row provenance count differs');
  const link=expected.prepare('SELECT 1 FROM links WHERE import_id=? AND record_id=? AND line=?');for(const row of db.prepare('SELECT * FROM import_records').iterate())if(!link.get(row.import_id,row.record_id,row.source_line))throw new InputError('Source-row provenance differs');
  for(const row of db.prepare('SELECT * FROM selected_versions').iterate()){const rec=db.prepare('SELECT logical_key FROM records WHERE id=?').get(row.record_id);if(rec?.logical_key!==row.logical_key)throw new InputError('Selected revision belongs to another source result');}
  for(const row of db.prepare('SELECT * FROM reviews').iterate())if(!['pending','include','exclude'].includes(row.state)||JSON.parse(row.data).state!==row.state)throw new InputError('Invalid retained review');
  for(const row of db.prepare('SELECT * FROM stations').iterate())if(JSON.parse(row.data).id!==row.id)throw new InputError('Invalid retained station');
  for(const row of db.prepare('SELECT * FROM mappings').iterate()){const data=JSON.parse(row.data);if(data.stationId!==row.station_id||data.reachId!==row.reach_id||!db.prepare('SELECT 1 FROM stations WHERE id=?').get(row.station_id))throw new InputError('Invalid retained native assignment');}
  const revision=db.prepare("SELECT value FROM meta WHERE key='revision'").get()?.value;if(!Number.isSafeInteger(revision)||revision<0)throw new InputError('Invalid native revision');
  return {recordCount:expectedCount,sourceCount:imports,revision,tables:names};
 }finally{expected.close();db.close();for(const suffix of ['','-journal','-wal','-shm'])fs.rmSync(scratch+suffix,{force:true});}
}
export function receiveArchive(w,archiveFile){
 ensureSourceSchema(w);const digest=fileDigest(archiveFile),id=digest.sha256,root=path.join(w.directory,'.large','receives',id);
 return withDirectoryLock(root,()=>{
  const previous=w.db.prepare('SELECT * FROM large_receives WHERE id=?').get(id);if(previous)return {id,duplicate:true,sourceRevision:previous.source_revision,revision:previous.received_revision,recordCount:w.db.prepare('SELECT COUNT(*) n FROM records').get().n};
  for(const name of CORE.filter(x=>x!=='meta'))if(w.db.prepare(`SELECT 1 FROM ${name} LIMIT 1`).get())throw new InputError('Choose an empty measured workspace for complete receiving; existing work is preserved',409);
  const copy=path.join(root,'verified');if(!fs.existsSync(copy))archive('unpack',archiveFile,copy);
  const manifest=readJSON(path.join(copy,'MEASUREMENTS_ARCHIVE.json'));
  // Recheck a retained receiving copy after interruption before semantic validation.
  for(const member of manifest.files){const actual=fileDigest(path.join(copy,safePath(member.path)));if(actual.bytes!==member.bytes||actual.sha256!==member.sha256)throw new InputError('Retained receiving member changed',409);}
  const validation=validateReceived(copy);if(validation.revision!==manifest.revision)throw new InputError('Archive revision differs from its original database');
  for(const member of manifest.files.filter(x=>x.path!=='measurements.sqlite')){
   if(SKIP.has(member.path.split('/')[0])||member.path==='MEASUREMENTS_ARCHIVE.json')throw new InputError('Archive attempts to replace runtime-managed files');
   const destination=path.resolve(w.directory),target=path.join(destination,member.path);let parent=path.dirname(target);while(parent!==destination){if(fs.existsSync(parent)&&fs.lstatSync(parent).isSymbolicLink())throw new InputError('Receiving path crosses a symlink');parent=path.dirname(parent);}
   if(member.path==='reaches.json'&&fs.existsSync(target)&&stable(readJSON(target))==='[]'&&fileDigest(target).sha256!==member.sha256){
    // The original Python bridge initializes this derived cache before the empty
    // recipient can accept its complete project. It is not an authored source.
    const temporary=target+'.'+randomUUID()+'.receiving';copyVerified(path.join(copy,member.path),temporary,member);
    try{if(stable(readJSON(target))!=='[]')throw new InputError('Native reach cache changed during receiving; reopen the same original',409);fs.renameSync(temporary,target);}finally{fs.rmSync(temporary,{force:true});}
   }else copyVerified(path.join(copy,member.path),target,member);
  }
  const received=new DatabaseSync(path.join(copy,'measurements.sqlite'),{readOnly:true});w.db.exec('BEGIN IMMEDIATE');
  try{
   for(const name of CORE.filter(x=>x!=='meta'))if(w.db.prepare(`SELECT 1 FROM ${name} LIMIT 1`).get())throw new InputError('Workspace changed during receiving; existing work is preserved',409);
   for(const name of Object.keys(TABLES)){
    if(!validation.tables.includes(name))continue;if(name==='meta')w.db.exec('DELETE FROM meta');
    const columns=TABLES[name],insert=w.db.prepare(`INSERT INTO ${name}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);
    for(const row of received.prepare(`SELECT * FROM ${name}`).iterate())insert.run(...columns.map(x=>row[x]));
   }
   // The just-created edition cannot contain its own ZIP hash recursively. Its
   // complete output population reconstructs the native catalogue on receiving.
   const savedRoot=path.join(copy,'saved-measurement-editions');
   if(fs.existsSync(savedRoot))for(const name of fs.readdirSync(savedRoot).filter(identifier)){
    const file=path.join(savedRoot,name,'edition.json');if(fs.existsSync(file))registerEdition(w,readJSON(file));
   }
   w.db.prepare("UPDATE meta SET value=? WHERE key='revision'").run(validation.revision+1);
   w.event('receive','workspace',{sourceRevision:validation.revision,archiveSha256:id,format:manifest.format});
   w.db.prepare('INSERT INTO large_receives VALUES(?,?,?,?)').run(id,validation.revision,validation.revision+1,JSON.stringify(manifest));w.db.exec('COMMIT');
  }catch(error){w.db.exec('ROLLBACK');throw error;}finally{received.close();}
  const result={id,duplicate:false,sourceRevision:validation.revision,revision:w.revision(),recordCount:validation.recordCount,sourceCount:validation.sourceCount,originalFiles:manifest.files.length};atomicJSON(path.join(root,'result.json'),result);return result;
 });
}
export function receiveIntake(w,id){const value=intakeStatus(w,id);if(value.kind!=='portable'||value.offset!==value.bytes)throw new InputError('Choose a completely uploaded portable archive');return receiveArchive(w,path.join(intakeRoot(w,id),'original'));}
