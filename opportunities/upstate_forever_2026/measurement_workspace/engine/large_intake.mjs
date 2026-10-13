/** Complete file intake into the existing Measurements database and normalizer. */
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomUUID} from 'node:crypto';
import {fieldReader,normaliseWQP,hash,stable,FIELDS} from './normalise.mjs';
import {InputError,clean,number} from './parse.mjs';
import {csvRows} from './stream_csv.mjs';
import {CHUNK,identifier,atomicJSON,readJSON,fileChunks,fileDigest,copyVerified,withDirectoryLock,writeAll} from './large_io.mjs';
const FORMAT='upper-savannah-file-intake/v1';
const ownRoot=w=>path.join(w.directory,'.large','intakes');
export function intakeRoot(w,id){if(!identifier(id))throw new InputError('Invalid intake identifier');return path.join(ownRoot(w),id);}
function descriptor(w,id){try{return readJSON(path.join(intakeRoot(w,id),'intake.json'));}catch(e){if(e.code==='ENOENT')throw new InputError('Intake not found',404);throw e;}}
export function ensureSourceSchema(w){w.db.exec(`
 CREATE TABLE IF NOT EXISTS source_chunks(import_id TEXT NOT NULL REFERENCES imports(id),sequence INTEGER NOT NULL,bytes BLOB NOT NULL,PRIMARY KEY(import_id,sequence));
 CREATE TABLE IF NOT EXISTS source_rejections(import_id TEXT NOT NULL REFERENCES imports(id),category INTEGER NOT NULL,sequence INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(import_id,category,sequence));
 CREATE TABLE IF NOT EXISTS large_receives(id TEXT PRIMARY KEY,source_revision INTEGER NOT NULL,received_revision INTEGER NOT NULL,manifest TEXT NOT NULL);
`);}
export function* sourceChunks(w,source){
 const supported=w.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_chunks'").get();
 if(supported&&w.db.prepare('SELECT 1 FROM source_chunks WHERE import_id=? LIMIT 1').get(source.id)){
  for(const row of w.db.prepare('SELECT bytes FROM source_chunks WHERE import_id=? ORDER BY sequence').iterate(source.id))yield Buffer.from(row.bytes);
 }else{
  // substr operates in source characters, so it never divides an encoded scalar.
  const size=w.db.prepare('SELECT length(content) n FROM imports WHERE id=?').get(source.id).n;
  for(let offset=1;offset<=size;offset+=65536)yield Buffer.from(w.db.prepare('SELECT substr(content,?,?) content FROM imports WHERE id=?').get(offset,65536,source.id).content);
 }
}
export function sourceRejections(w,id){
 const supported=w.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_rejections'").get();
 if(supported&&w.db.prepare('SELECT 1 FROM source_chunks WHERE import_id=? LIMIT 1').get(id))return [...w.db.prepare('SELECT data FROM source_rejections WHERE import_id=? ORDER BY category,sequence').iterate(id)].map(x=>JSON.parse(x.data));
 return JSON.parse(w.db.prepare('SELECT rejected FROM imports WHERE id=?').get(id).rejected);
}
/** Install only compatibility reads; parsing, reviews, eligibility and old receive stay native. */
export function installLargeFileReads(Type){
 if(Type.prototype.largeFileReadVersion)return;
 const originalSource=Type.prototype.source,originalPortable=Type.prototype.portable;
 Type.prototype.source=function(id){const value=originalSource.call(this,id);if(this.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='source_chunks'").get()&&this.db.prepare('SELECT 1 FROM source_chunks WHERE import_id=? LIMIT 1').get(id)){
   value.content=Buffer.concat([...sourceChunks(this,value)]).toString('utf8');value.rejected=JSON.stringify(sourceRejections(this,id));}return value;};
 Type.prototype.portable=function(){const value=originalPortable.call(this);for(const source of value.tables.imports){const hydrated=this.source(source.id);source.content=hydrated.content;source.rejected=hydrated.rejected;}return value;};
 Object.defineProperty(Type.prototype,'largeFileReadVersion',{value:1});
}
export function beginIntake(w,input){
 if(!['wqp','stations','portable'].includes(input.kind))throw new InputError('Large file kind must be wqp, stations or portable');
 if(!Number.isSafeInteger(input.bytes)||input.bytes<1)throw new InputError('Declare the complete nonempty original file size');
 const label=clean(input.label);if(!label)throw new InputError('Name the original file');
 if(input.mapping!==undefined&&(!input.mapping||typeof input.mapping!=='object'||Array.isArray(input.mapping)))throw new InputError('Column mapping must be an object');
 const id=input.id??hash(randomUUID());if(!identifier(id))throw new InputError('Invalid intake identifier');
 const root=intakeRoot(w,id),definition={kind:input.kind,label,bytes:input.bytes,mapping:input.mapping||{},origin:input.origin||{type:'file'}};
 return withDirectoryLock(root,()=>{
  const stateFile=path.join(root,'intake.json');
  if(fs.existsSync(stateFile)){
   const old=readJSON(stateFile);for(const key of Object.keys(definition))if(stable(old[key])!==stable(definition[key]))throw new InputError('This intake identifier already retains a different original definition',409);
   return old;
  }
  const original=path.join(root,'original');
  if(fs.existsSync(original)){if(fs.statSync(original).size!==0)throw new InputError('Interrupted initial intake has unexpected original bytes',409);}
  else fs.closeSync(fs.openSync(original,'wx',0o600));
  const value={format:FORMAT,id,...definition,offset:0,phase:'uploading',createdAt:new Date().toISOString()};
  atomicJSON(stateFile,value);return value;
 });
}
export function putChunk(w,id,{offset,base64,sha256,check=false}){
 const root=intakeRoot(w,id);return withDirectoryLock(root,()=>{
  const value=descriptor(w,id),file=path.join(root,'original');
  if(!Number.isSafeInteger(offset)||offset<0||offset>value.offset||offset%CHUNK!==0)throw new InputError('Use the returned contiguous upload offset',409);
  if(!identifier(sha256))throw new InputError('Every original chunk requires its SHA-256');
  const expected=Math.min(CHUNK,value.bytes-offset);if(expected<=0)throw new InputError('Upload is already complete',409);
  if(offset<value.offset){const buffer=Buffer.alloc(expected),fd=fs.openSync(file,'r');let n;try{n=fs.readSync(fd,buffer,0,expected,offset);}finally{fs.closeSync(fd);}
   if(n!==expected||hash(buffer)!==sha256)throw new InputError('The selected file differs from the retained upload prefix; start a new intake',409);return {id,offset:value.offset,reused:true};}
  if(check)return {id,offset:value.offset,reused:false};
  if(value.phase!=='uploading')throw new InputError('This intake is no longer accepting bytes',409);
  if(typeof base64!=='string'||base64.length>Math.ceil(CHUNK/3)*4+4||!/^[A-Za-z0-9+/]*={0,2}$/.test(base64))throw new InputError('Invalid chunk encoding');
  const data=Buffer.from(base64,'base64');if(data.length!==expected||data.toString('base64')!==base64||hash(data)!==sha256)throw new InputError('Original chunk size or checksum mismatch');
  const fd=fs.openSync(file,'r+');try{
   // An interrupted write may have extended the file before the committed offset.
   fs.ftruncateSync(fd,value.offset);let n=0;while(n<data.length){const wrote=fs.writeSync(fd,data,n,data.length-n,offset+n);if(!wrote)throw new Error('No upload progress');n+=wrote;}fs.fsyncSync(fd);
  }finally{fs.closeSync(fd);}
  value.offset+=data.length;atomicJSON(path.join(root,'intake.json'),value);return {id,offset:value.offset,reused:false};
 });
}
export function intakeStatus(w,id){const value=descriptor(w,id);const p=path.join(intakeRoot(w,id),'prepared.json');return {...value,...(fs.existsSync(p)?{prepared:readJSON(p)}:{})};}
export function listIntakes(w){const root=ownRoot(w);if(!fs.existsSync(root))return [];return fs.readdirSync(root).filter(id=>identifier(id)&&fs.existsSync(path.join(root,id,'intake.json'))).map(id=>descriptor(w,id)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));}
function normalizeStation(raw,get){const id=get(raw,'station');if(!id)throw new InputError('Station identifier is missing');const lat=number(get(raw,'latitude')),lon=number(get(raw,'longitude'));if((lat!==null&&Math.abs(lat)>90)||(lon!==null&&Math.abs(lon)>180))throw new InputError('Station coordinate outside valid range');return {id,name:get(raw,'name')||id,latitude:lat,longitude:lon,datum:get(raw,'datum'),raw};}
export function* normalizedCSV(chunks,kind,mapping){
 let reader;
 for(const item of csvRows(chunks)){
  if(item.type==='header'){
   reader=fieldReader(item.headers,mapping);
   if(!reader.mapping.station)throw new InputError('Missing station column; choose the correct column mapping');
   if(kind==='wqp'&&(!reader.mapping.characteristic||(!reader.mapping.date&&!reader.mapping.datetime)))throw new InputError('Missing characteristic/date columns; choose the correct column mapping');
   yield {...item,mapping:reader.mapping};continue;
  }
  if(item.type==='rejected'){yield item;continue;}
  try{yield {type:'row',line:item.line,row:kind==='stations'?normalizeStation(item.raw,reader.get):normaliseWQP(item.raw,reader.get)};}
  catch(error){if(!(error instanceof InputError))throw error;yield {type:'rejected',category:1,entry:{line:item.line,reason:error.message,raw:item.raw}};}
 }
}
const normalizerPin=()=>hash(['normalise.mjs','parse.mjs','stream_csv.mjs','large_intake.mjs'].map(name=>hash(fs.readFileSync(new URL('./'+name,import.meta.url)))).join('\n'));
export function prepareIntake(w,id){
 const root=intakeRoot(w,id);return withDirectoryLock(root,()=>{
  const value=descriptor(w,id);if(value.kind==='portable')throw new InputError('Use the complete-project receiving operation for this file');
  if(value.offset!==value.bytes)throw new InputError('Finish receiving the complete original file first',409);
  const preparedFile=path.join(root,'prepared.json');if(fs.existsSync(preparedFile)){const old=readJSON(preparedFile);if(old.normalizerPin===normalizerPin()||value.phase==='committed')return old;}
  const original=path.join(root,'original'),digest=fileDigest(original);if(digest.bytes!==value.bytes)throw new InputError('Retained source length differs',409);
  const stageFile=path.join(root,'normalized.sqlite');for(const suffix of ['','-journal','-wal','-shm'])fs.rmSync(stageFile+suffix,{force:true});
  const db=new DatabaseSync(stageFile);let accepted=0,rejected=0,censored=0,headers,mapping;
  try{
   db.exec(`PRAGMA journal_mode=DELETE; PRAGMA cache_size=-4096; BEGIN;
    CREATE TABLE accepted(sequence INTEGER PRIMARY KEY,line INTEGER NOT NULL,data TEXT NOT NULL);
    CREATE TABLE rejected(category INTEGER NOT NULL,sequence INTEGER NOT NULL,line INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(category,sequence));
    CREATE TABLE stations(id TEXT PRIMARY KEY); CREATE TABLE counts(kind TEXT,key TEXT,n INTEGER,PRIMARY KEY(kind,key));`);
   const insert=db.prepare('INSERT INTO accepted VALUES(?,?,?)'),reject=db.prepare('INSERT INTO rejected VALUES(?,?,?,?)'),station=db.prepare('INSERT OR IGNORE INTO stations VALUES(?)'),count=db.prepare('INSERT INTO counts VALUES(?,?,1) ON CONFLICT(kind,key) DO UPDATE SET n=n+1');
   for(const item of normalizedCSV(fileChunks(original),value.kind,value.mapping)){
    if(item.type==='header'){headers=item.headers;mapping=item.mapping;continue;}
    if(item.type==='rejected'){reject.run(item.category,rejected++,item.entry.line,JSON.stringify(item.entry));continue;}
    const row=item.row;insert.run(accepted++,item.line,JSON.stringify(row));station.run(row.stationId||row.id);if(row.parameter)count.run('parameter',row.parameter);if(row.censor&&row.censor!=='none')censored++;for(const issue of row.issues||[])count.run('issue',issue);
   }
   db.exec('COMMIT');
   const summary={rows:accepted,rejectedCount:rejected,stationCount:db.prepare('SELECT COUNT(*) n FROM stations').get().n,censored,parameters:Object.fromEntries(db.prepare("SELECT key,n FROM counts WHERE kind='parameter' ORDER BY key").iterate().map(x=>[x.key,x.n])),issues:Object.fromEntries(db.prepare("SELECT key,n FROM counts WHERE kind='issue' ORDER BY key").iterate().map(x=>[x.key,x.n]))};
   if(!accepted&&rejected)throw new InputError('Every source row was rejected. Correct mapping or values before committing.');
   const result={id,importId:hash(stable([value.kind,digest.sha256,mapping])),sourceSha256:digest.sha256,bytes:digest.bytes,kind:value.kind,label:value.label,headers,mapping,summary,normalizedStage:fileDigest(stageFile),normalizerPin:normalizerPin(),sample:[...db.prepare('SELECT line,data FROM accepted ORDER BY sequence LIMIT 25').iterate()].map(r=>({...JSON.parse(r.data),sourceLine:r.line})),rejected:[...db.prepare('SELECT data FROM rejected ORDER BY category,sequence LIMIT 25').iterate()].map(r=>JSON.parse(r.data)),mappingFields:Object.keys(FIELDS)};
   atomicJSON(preparedFile,result);value.phase='prepared';value.sourceSha256=digest.sha256;atomicJSON(path.join(root,'intake.json'),value);return result;
  }finally{db.close();}
 });
}
export function commitIntake(w,id,{expectedRevision,expectedSourceSha256,expectedNormalizerPin}={}){
 const root=intakeRoot(w,id);return withDirectoryLock(root,()=>{
  const value=descriptor(w,id),prepared=readJSON(path.join(root,'prepared.json'));
  if(expectedSourceSha256!==undefined&&expectedSourceSha256!==prepared.sourceSha256)throw new InputError('The displayed source preview belongs to another original',409);
  if(expectedNormalizerPin!==undefined&&expectedNormalizerPin!==prepared.normalizerPin)throw new InputError('The displayed preview belongs to another normalizer edition',409);
  const digest=fileDigest(path.join(root,'original'));if(digest.bytes!==prepared.bytes||digest.sha256!==prepared.sourceSha256)throw new InputError('Reviewed original source changed',409);
  // A committed source is immutable. An application upgrade must not reinterpret a
  // lost-response retry, or require its old staging database to remain available.
  const committed=w.db.prepare('SELECT sha,summary FROM imports WHERE id=?').get(prepared.importId);
  if(committed){
   if(committed.sha!==prepared.sourceSha256)throw new InputError('Retained source identity differs',409);
   const result={id:prepared.importId,intakeId:id,duplicate:true,...JSON.parse(committed.summary),revision:w.revision()};
   value.phase='committed';value.result=result;atomicJSON(path.join(root,'intake.json'),value);return result;
  }
  if(prepared.normalizerPin!==normalizerPin())throw new InputError('Normalizer source changed; review this file again before commit',409);
  const staged=fileDigest(path.join(root,'normalized.sqlite'));if(staged.sha256!==prepared.normalizedStage.sha256||staged.bytes!==prepared.normalizedStage.bytes)throw new InputError('Reviewed normalized source changed; prepare a fresh intake',409);
  ensureSourceSchema(w);w.db.exec('BEGIN IMMEDIATE');let result,stage;
  try{
   const previous=w.db.prepare('SELECT summary FROM imports WHERE id=?').get(prepared.importId);
   if(previous){w.db.exec('COMMIT');result={id:prepared.importId,intakeId:id,duplicate:true,...JSON.parse(previous.summary),revision:w.revision()};}
   else{
    if(expectedRevision!==undefined&&expectedRevision!==w.revision())throw new InputError('Workspace changed. Refresh before committing this reviewed source.',409);
    stage=new DatabaseSync(path.join(root,'normalized.sqlite'),{readOnly:true});
    const now=new Date().toISOString();let inserted=0,existing=0;
    w.db.prepare('INSERT INTO imports VALUES(?,?,?,?,?,?,?,?,?,?)').run(prepared.importId,value.kind,value.label,now,prepared.sourceSha256,stable(value.origin),JSON.stringify(prepared.mapping),'',JSON.stringify(prepared.summary),'[]');
    const source=w.db.prepare('INSERT INTO source_chunks VALUES(?,?,?)');let sequence=0;for(const chunk of fileChunks(path.join(root,'original')))source.run(prepared.importId,sequence++,chunk);
    const rejection=w.db.prepare('INSERT INTO source_rejections VALUES(?,?,?,?)');for(const row of stage.prepare('SELECT * FROM rejected ORDER BY category,sequence').iterate())rejection.run(prepared.importId,row.category,row.sequence,row.data);
    const insert=w.db.prepare('INSERT OR IGNORE INTO records VALUES(?,?,?,?,?,?,?,?,?)'),link=w.db.prepare('INSERT OR IGNORE INTO import_records VALUES(?,?,?)');
    for(const item of stage.prepare('SELECT line,data FROM accepted ORDER BY sequence').iterate()){
     const row=JSON.parse(item.data);if(value.kind==='stations'){w.mergeStation(row,prepared.importId);continue;}
     const recordId=hash(stable([row.sourceKind,row]));const changed=insert.run(recordId,row.logicalKey,row.stationId,row.parameter,row.sampledDate,row.censor,row.unit,row.fraction,item.data).changes;
     if(changed)inserted++;else existing++;link.run(prepared.importId,recordId,item.line);w.mergeStation(row.station,prepared.importId);
    }
    w.event('import',prepared.importId,{label:value.label,sha:prepared.sourceSha256,inserted,existing,summary:prepared.summary,intakeId:id,storage:'source-chunks/v1'});
    w.db.prepare("UPDATE meta SET value=value+1 WHERE key='revision'").run();w.db.exec('COMMIT');result={id:prepared.importId,intakeId:id,duplicate:false,...prepared.summary,inserted,existing,revision:w.revision()};
   }
  }catch(error){try{w.db.exec('ROLLBACK');}catch{}throw error;}finally{stage?.close();}
  value.phase='committed';value.result=result;atomicJSON(path.join(root,'intake.json'),value);return result;
 });
}
export function intakeFromFile(w,file,input={}){
 const stat=fs.statSync(file);if(!stat.isFile())throw new InputError('Select a regular original file');
 const value=beginIntake(w,{...input,bytes:stat.size,label:input.label||path.basename(file)}),root=intakeRoot(w,value.id),original=path.join(root,'original');
 const fd=fs.openSync(original,'w');try{for(const chunk of fileChunks(file))writeAll(fd,chunk);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const actual=fileDigest(original);if(actual.bytes!==stat.size)throw new InputError('Original source length changed during intake',409);
 value.offset=actual.bytes;atomicJSON(path.join(root,'intake.json'),value);return value;
}
/** Re-review new column choices without uploading the complete original again. */
export function reconfigureIntake(w,id,input){
 const root=intakeRoot(w,id);return withDirectoryLock(root,()=>{
  const value=descriptor(w,id);if(value.phase==='committed')throw new InputError('The original import is immutable; make a new source edition for later changes',409);
  if(input.mapping!==undefined&&(!input.mapping||typeof input.mapping!=='object'||Array.isArray(input.mapping)))throw new InputError('Column mapping must be an object');
  if(input.mapping!==undefined)value.mapping=input.mapping;
  if(input.label!==undefined){const label=clean(input.label);if(!label)throw new InputError('Name the original file');value.label=label;}
  value.phase=value.offset===value.bytes?'uploaded':'uploading';
  for(const name of ['prepared.json','normalized.sqlite','normalized.sqlite-journal','normalized.sqlite-wal','normalized.sqlite-shm'])fs.rmSync(path.join(root,name),{force:true});
  atomicJSON(path.join(root,'intake.json'),value);return value;
 });
}
