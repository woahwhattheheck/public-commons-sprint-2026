/** Guided preparation around the original Measurements parser and importer. */
import {randomUUID} from 'node:crypto';
import {CHARACTERISTIC_FIELDS,CHARACTERISTIC_MAPPING,WQP_CHARACTERISTIC_EDITIONS} from './characteristics.mjs';
import {buildIntakeComparison,compareIntakeIdentity} from './intake_comparison.mjs';
import {initialiseLineage,originalMap,retainOriginals,readOriginal,validateStoredLineage,exportOriginals,validateLineagePacket,sourceLineages} from './source_lineage.mjs';
import {parseCSV, safeJSON, InputError, sourceLineEndings, SOURCE_LINE_EDITION} from './parse.mjs';
import {FIELDS, fieldReader, hash, stable, parseSource, WQP_DETECTION_EDITION, USGS_DAILY_EDITION} from './normalise.mjs';
export const INTAKE_FORMAT='upper-savannah-measurement-intake/v1';
const kinds=['wqp','stations','usgs-daily'];
const idOK=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(x);
const fail=(s,status=400)=>{throw new InputError(s,status);};
const object=x=>x&&typeof x==='object'&&!Array.isArray(x);
export function initialiseIntake(s){
  initialiseLineage(s);
  s.db.exec('CREATE TABLE IF NOT EXISTS intake_meta(key TEXT PRIMARY KEY,value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS intake_sources(sha TEXT PRIMARY KEY,content TEXT NOT NULL); CREATE TABLE IF NOT EXISTS intake_editions(id TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,digest TEXT NOT NULL,data TEXT NOT NULL,PRIMARY KEY(id,revision)); CREATE TABLE IF NOT EXISTS intake_receipts(id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(id,revision)); CREATE TABLE IF NOT EXISTS intake_origins(id TEXT PRIMARY KEY,data TEXT NOT NULL);');
  s.db.prepare("INSERT OR IGNORE INTO intake_meta VALUES('workspace',?)").run(randomUUID());
}
export function intakeIdentity(s){return s.db.prepare("SELECT value FROM intake_meta WHERE key='workspace'").get().value;}
function draft(value){
  if(!object(value)||!kinds.includes(value.kind))fail('Select chemistry, stations or complete USGS daily discharge.');
  const v={};
  for(const k of ['kind','label','sourceName','sourceSha','reviewer','note','context']){
    if(typeof value[k]!=='string')fail('Preparation '+k+' must be text.');
    v[k]=value[k];
  }
  if(!/^[a-f0-9]{64}$/.test(v.sourceSha))fail('Preparation source checksum is invalid.');
  if(!object(value.mapping))fail('Preparation mapping must be an object.');
  v.mapping={};
  for(const [k,x]of Object.entries(value.mapping)){
    if(k==='_csv_lines'&&x===SOURCE_LINE_EDITION||k===CHARACTERISTIC_MAPPING&&WQP_CHARACTERISTIC_EDITIONS.includes(x)||k==='_wqp_detection'&&x===WQP_DETECTION_EDITION||k==='_usgs_daily'&&x===USGS_DAILY_EDITION){v.mapping[k]=x;continue;}
    if(!(Object.hasOwn(FIELDS,k)||Object.hasOwn(CHARACTERISTIC_FIELDS,k))||typeof x!=='string')fail('Invalid preparation mapping: '+k);
    v.mapping[k]=x;
  }
  if(value.lineage!==undefined){if(!object(value.lineage))fail('Keep complete original worksheet lineage.');v.lineage=JSON.parse(JSON.stringify(value.lineage));}
  return v;
}
function source(s,sha){const x=s.db.prepare('SELECT content FROM intake_sources WHERE sha=?').get(sha);if(!x)fail('The complete original preparation file is absent.',404);return x.content;}
function rowValue(row){return row?{id:row.id,revision:row.revision,createdAt:row.created_at,digest:row.digest,value:JSON.parse(row.data)}:null;}
export function readIntake(s,id,revision){
  if(!idOK(id))fail('Invalid preparation identity.');
  const row=revision===undefined?s.db.prepare('SELECT * FROM intake_editions WHERE id=? ORDER BY revision DESC LIMIT 1').get(id):s.db.prepare('SELECT * FROM intake_editions WHERE id=? AND revision=?').get(id,revision);
  if(!row)fail('Saved preparation not found.',404);
  const result=rowValue(row),text=source(s,result.value.sourceSha);
  validateStoredLineage(s,result.value,text);
  return {...result,text,originals:exportOriginals(s,[result]),receipt:receipt(s,id,result.revision),workspaceId:intakeIdentity(s)};
}
function receipt(s,id,revision){const row=s.db.prepare('SELECT data FROM intake_receipts WHERE id=? AND revision=?').get(id,revision);return row?JSON.parse(row.data):null;}
export function listIntakes(s){
  return {workspaceId:intakeIdentity(s),interpretations:{wqp:WQP_DETECTION_EDITION,'usgs-daily':USGS_DAILY_EDITION,characteristics:[...WQP_CHARACTERISTIC_EDITIONS],characteristicFields:Object.keys(CHARACTERISTIC_FIELDS)},preparations:s.db.prepare('SELECT e.* FROM intake_editions e JOIN (SELECT id,MAX(revision) r FROM intake_editions GROUP BY id) x ON e.id=x.id AND e.revision=x.r ORDER BY e.created_at DESC,e.id').all().map(r=>{const v=rowValue(r);return {...v,receipt:receipt(s,v.id,v.revision)};})};
}
function writeIntake(s,operation){s.db.exec('BEGIN IMMEDIATE');try{let changed=false;const result=operation(()=>{changed=true;});if(changed)s.db.prepare("UPDATE meta SET value=value+1 WHERE key='revision'").run();s.db.exec('COMMIT');return result;}catch(e){s.db.exec('ROLLBACK');throw e;}}
export function saveIntake(s,input){
  if(!idOK(input?.id)||!Number.isSafeInteger(input.expectedRevision)||input.expectedRevision<0)fail('Save requires the preparation identity and its last saved revision.');
  const value=draft(input.value),digest=hash(stable(value));
  if(input.text!==undefined&&(typeof input.text!=='string'||hash(input.text)!==value.sourceSha))fail('The complete original file does not match its checksum.');
  const suppliedOriginals=originalMap(input.originals||[]);
  if([...suppliedOriginals.keys()].some(sha=>sha!==value.lineage?.original?.sha256))fail('Retain only the complete original bound to this worksheet.');
  return writeIntake(s,changed=>{
    const current=rowValue(s.db.prepare('SELECT * FROM intake_editions WHERE id=? ORDER BY revision DESC LIMIT 1').get(input.id));
    const priorRevision=current?.revision||0;
    if(input.expectedRevision!==priorRevision){
      const completed=rowValue(s.db.prepare('SELECT * FROM intake_editions WHERE id=? AND revision=?').get(input.id,input.expectedRevision+1));
      if(completed?.digest===digest)return readIntake(s,input.id,completed.revision);
      fail('This preparation changed in another view. Keep this draft and save it as a separate copy, or open the current saved edition.',409);
    }
    if(input.text!==undefined){
      const prior=s.db.prepare('SELECT content FROM intake_sources WHERE sha=?').get(value.sourceSha);
      if(prior&&prior.content!==input.text)fail('Original source identity conflict.');
      s.db.prepare('INSERT OR IGNORE INTO intake_sources VALUES(?,?)').run(value.sourceSha,input.text);
    }
    retainOriginals(s,[...suppliedOriginals.values()]);
    validateStoredLineage(s,value,source(s,value.sourceSha));
    if(current?.digest===digest)return readIntake(s,input.id);
    s.db.prepare('INSERT INTO intake_editions VALUES(?,?,?,?,?)').run(input.id,priorRevision+1,new Date().toISOString(),digest,JSON.stringify(value));
    preparationCapacity(s,input.id);
    s.event('intake-preparation',input.id,{revision:priorRevision+1,digest,sourceSha:value.sourceSha});changed();
    return readIntake(s,input.id);
  });
}
export function validateWorkingIntake(input){
  const value=draft(input?.value);
  if(typeof input.text!=='string'||hash(input.text)!==value.sourceSha)fail('The complete working source differs from its checksum.');
  validateLineagePacket({originals:input.originals||[],editions:[{value}]},new Map([[value.sourceSha,input.text]]));
  return {value,text:input.text,originals:input.originals||[]};
}
export function inspectIntake(s,input){
  if(typeof input?.text!=='string'||!kinds.includes(input.kind))fail('Choose a complete UTF-8 CSV or USGS GeoJSON source.');
  const result={kind:input.kind,sourceSha:hash(input.text),bytes:Buffer.byteLength(input.text),headers:[],sample:[],interpretations:{wqp:WQP_DETECTION_EDITION,'usgs-daily':USGS_DAILY_EDITION,characteristics:[...WQP_CHARACTERISTIC_EDITIONS],characteristicFields:Object.keys(CHARACTERISTIC_FIELDS)},rawRows:0,rawRejectedCount:0,mapping:{},mappingFields:Object.keys(input.mapping?.[CHARACTERISTIC_MAPPING]?{...FIELDS,...CHARACTERISTIC_FIELDS}:FIELDS),missing:[],issues:[],native:null};
  if(input.kind==='usgs-daily'){
    result.mapping=input.mapping||{};
    try{
      const json=safeJSON(input.text);
      if(json.type!=='FeatureCollection'||!Array.isArray(json.features))fail('USGS daily input must be the original complete FeatureCollection.');
      result.headers=[...new Set(json.features.flatMap(x=>Object.keys(x.properties||{})))];
      result.sample=json.features.slice(0,12).map((x,i)=>({line:i+1,raw:x.properties||{},geometry:x.geometry??null}));
      result.rawRows=json.features.length;
    }catch(e){if(!(e instanceof InputError))throw e;result.issues.push(e.message);return result;}
  }else{
    let parsed;
    try{parsed=parseCSV(input.text,{lineEndings:input.lineEndings||'physical'});}catch(e){if(!(e instanceof InputError))throw e;result.issues.push(e.message);return result;}
    result.headers=parsed.headers;result.sample=parsed.rows.slice(0,12);result.rawRows=parsed.rows.length;result.rawRejectedCount=parsed.rejected.length;
    result.rawRejected=parsed.rejected.slice(0,12);
    try{result.mapping=fieldReader(parsed.headers,input.mapping||{}).mapping;}catch(e){if(!(e instanceof InputError))throw e;result.issues.push(e.message);return result;}
    if(!result.mapping.station)result.missing.push('station');
    if(input.kind==='wqp'){
      if(!result.mapping.characteristic)result.missing.push('characteristic');
      if(!result.mapping.date&&!result.mapping.datetime)result.missing.push('date or datetime');
    }
    if(result.missing.length){result.issues.push('Map '+result.missing.join(', ')+' before the scientific preview.');return result;}
  }
  try{result.native=s.preview(input);}catch(e){if(!(e instanceof InputError))throw e;result.issues.push(e.message);}
  return result;
}
export function previewSavedIntake(s,id,revision){
  const saved=readIntake(s,id,revision),value=saved.value;
  const inspected=inspectIntake(s,{kind:value.kind,text:saved.text,mapping:value.mapping,lineEndings:value.lineage?.schema==='upper-savannah-measurement-source-lineage/v1'?'legacy':'physical'});
  return {...inspected,id:saved.id,revision:saved.revision,digest:saved.digest,previewSha:hash(stable([saved.id,saved.revision,saved.digest,inspected]))};
}
export function importIntake(s,id,input){
  if(!Number.isSafeInteger(input?.revision)||input.revision<1)fail('Choose the saved preparation revision.');
  const saved=readIntake(s,id,input.revision),old=receipt(s,id,input.revision);
  if(old){if(input.previewSha!==old.previewSha)fail('The selected preview differs from the completed intake.',409);return old;}
  const inspected=previewSavedIntake(s,id,input.revision);
  if(input.previewSha!==inspected.previewSha)fail('Preview changed. Review this saved edition again.',409);
  if(!saved.value.label.trim()||!saved.value.reviewer.trim())fail('Name the source and record the mapping reviewer before import.');
  if(!inspected.native?.rows)fail('No accepted source rows. Correct the mapping or source, then preview again.');
  const value=saved.value;
  // Original import identity is kind + original content + original resolved mapping.
  // If the process stops after import, the same saved edition recovers that import.
  const imported=s.import({kind:value.kind,text:saved.text,label:value.label,mapping:value.mapping,lineEndings:value.lineage?.schema==='upper-savannah-measurement-source-lineage/v1'?'legacy':'physical',contentSha:value.sourceSha,origin:{type:'guided-file',filename:value.sourceName,context:value.context,...(value.lineage?{lineage:value.lineage}:{}),intake:{id,revision:input.revision,reviewer:value.reviewer,note:value.note}}});
  const completed={id,revision:input.revision,...(imported.sourceLineEdition?{sourceLineEdition:imported.sourceLineEdition}:{}),previewSha:input.previewSha,importId:imported.id,sourceSha:value.sourceSha,rows:imported.rows,rejectedCount:imported.rejectedCount,completedAt:new Date().toISOString()};
  return s.atomic(()=>{
    const existing=receipt(s,id,input.revision);if(existing)return existing;
    s.db.prepare('INSERT INTO intake_receipts VALUES(?,?,?)').run(id,input.revision,JSON.stringify(completed));
    s.event('intake-import',id,completed);return completed;
  });
}
export function exportIntakes(s,selectedId){
  const editions=s.db.prepare('SELECT * FROM intake_editions ORDER BY id,revision').all().filter(x=>!selectedId||x.id===selectedId).map(rowValue);
  if(selectedId&&!editions.length)fail('Preparation not found.',404);
  const hashes=new Set(editions.map(x=>x.value.sourceSha));
  return {format:INTAKE_FORMAT,workspaceId:intakeIdentity(s),originals:exportOriginals(s,editions),sources:[...hashes].sort().map(sha=>({sha,text:source(s,sha)})),editions,origins:s.db.prepare('SELECT * FROM intake_origins ORDER BY id').all().filter(x=>!selectedId||x.id===selectedId).map(x=>({id:x.id,project:JSON.parse(x.data)})),receipts:s.db.prepare('SELECT * FROM intake_receipts ORDER BY id,revision').all().filter(x=>!selectedId||x.id===selectedId).map(x=>JSON.parse(x.data))};
}
function preparationCapacity(s,id){
  const packet=exportIntakes(s,id);
  if(Buffer.byteLength(JSON.stringify({id:'x'.repeat(120),project:packet}))>128*1024*1024)
    fail('This complete preparation history exceeds the original receiving route. The preceding original history remains unchanged; retain it and begin a separately named preparation.',413);
}
export function validateIntakes(value,imports=null,depth=0){
  if(depth>32)fail('Preparation ancestry is too deeply nested. Retain the full original project separately.',413);
  if(value?.format!==INTAKE_FORMAT||typeof value.workspaceId!=='string'||!Array.isArray(value.sources)||!Array.isArray(value.editions)||!Array.isArray(value.receipts))fail('Unknown complete intake format.');
  const sources=new Map(),editions=new Map();
  for(const file of value.sources){if(typeof file.text!=='string'||hash(file.text)!==file.sha||sources.has(file.sha))fail('Intake source checksum or identity mismatch.');sources.set(file.sha,file.text);}
  const revisions=new Map();
  for(const e of value.editions){
    if(!idOK(e.id)||!Number.isSafeInteger(e.revision)||e.revision!==(revisions.get(e.id)||0)+1||typeof e.createdAt!=='string'||!Number.isFinite(Date.parse(e.createdAt)))fail('Invalid preparation edition history.');
    const v=draft(e.value);if(stable(v)!==stable(e.value)||hash(stable(v))!==e.digest||!sources.has(v.sourceSha))fail('Preparation edition/source identity mismatch.');
    revisions.set(e.id,e.revision);editions.set(e.id+':'+e.revision,e);
  }
  validateLineagePacket(value,sources);
  const receipts=new Set();
  for(const r of value.receipts){
    const key=r.id+':'+r.revision,e=editions.get(key),imp=imports?.find(x=>x.id===r.importId);
    if(receipts.has(key)||!e||r.sourceSha!==e.value.sourceSha||(imports&&!imp))fail('Intake receipt does not match its original imported source.');
    const parsed=parseSource({kind:e.value.kind,text:sources.get(r.sourceSha),mapping:e.value.mapping,lineEndings:sourceLineEndings(r)});
    if(hash(stable([e.value.kind,r.sourceSha,parsed.mapping]))!==r.importId||(imp&&imp.sha!==r.sourceSha))fail('Intake receipt import identity mismatch.');
    receipts.add(key);
  }
  const originIds=new Set();
  for(const origin of value.origins||[]){
    if(!idOK(origin.id)||!revisions.has(origin.id)||originIds.has(origin.id))fail('Invalid received preparation identity.');
    validateIntakes(origin.project,null,depth+1);originIds.add(origin.id);
  }
  return value;
}
export function receiveIntakes(s,value){
  // Called inside the existing receive transaction, after native original validation.
  validateIntakes(value,s.db.prepare('SELECT * FROM imports').all());
  if(s.db.prepare('SELECT COUNT(*) n FROM intake_editions').get().n)fail('Receive into an empty preparation workspace.',409);
  retainOriginals(s,value.originals||[]);
  for(const x of value.sources)s.db.prepare('INSERT OR IGNORE INTO intake_sources VALUES(?,?)').run(x.sha,x.text);
  for(const e of value.editions)s.db.prepare('INSERT INTO intake_editions VALUES(?,?,?,?,?)').run(e.id,e.revision,e.createdAt,e.digest,JSON.stringify(e.value));
  for(const origin of value.origins||[])s.db.prepare('INSERT INTO intake_origins VALUES(?,?)').run(origin.id,JSON.stringify(origin.project));
  for(const r of value.receipts)s.db.prepare('INSERT INTO intake_receipts VALUES(?,?,?)').run(r.id,r.revision,JSON.stringify(r));
  s.db.prepare("UPDATE intake_meta SET value=? WHERE key='workspace'").run(value.workspaceId);
}
export function copyIntake(s,input){
  const packet=validateIntakes(input.project,null,1),ids=new Set(packet.editions.map(x=>x.id));
  if(ids.size!==1||!idOK(input.id))fail('Open one complete preparation as a separate copy.');
  return writeIntake(s,changed=>{
    const existing=s.db.prepare('SELECT data FROM intake_origins WHERE id=?').get(input.id);
    if(existing){if(stable(JSON.parse(existing.data))===stable(packet))return readIntake(s,input.id,packet.editions.at(-1).revision);fail('Copy identity belongs to a different original project.',409);}
    if(s.db.prepare('SELECT id FROM intake_editions WHERE id=? LIMIT 1').get(input.id))fail('Choose a new copy identity.',409);
    retainOriginals(s,packet.originals||[]);
    for(const file of packet.sources){
      const old=s.db.prepare('SELECT content FROM intake_sources WHERE sha=?').get(file.sha);
      if(old&&old.content!==file.text)fail('Original source identity conflict.');
      s.db.prepare('INSERT OR IGNORE INTO intake_sources VALUES(?,?)').run(file.sha,file.text);
    }
    for(const e of packet.editions)s.db.prepare('INSERT INTO intake_editions VALUES(?,?,?,?,?)').run(input.id,e.revision,e.createdAt,e.digest,JSON.stringify(e.value));
    s.db.prepare('INSERT INTO intake_origins VALUES(?,?)').run(input.id,JSON.stringify(packet));
    preparationCapacity(s,input.id);
    s.event('intake-copy',input.id,{sourceWorkspace:packet.workspaceId,sourceId:packet.editions[0].id,editions:packet.editions.length});changed();
    return readIntake(s,input.id);
  });
}

export function compareIntakePreparations(s,id,input){
 return s.readConsistent(()=>{
 const project=exportIntakes(s,id);
 validateIntakes(project);
 if(input.expectedHistorySha!==hash(stable(project)))fail('The complete preparation history changed. Refresh the comparison selection.',409);
 return buildIntakeComparison(project,input.beforeRevision,input.afterRevision);
 });
}
export function reopenIntakeComparison(report){
 compareIntakeIdentity(report);
 validateIntakes(report.project);
 const fresh=buildIntakeComparison(report.project,report.before.revision,report.after.revision,{lineEndings:sourceLineEndings(report)});
 if(stable(fresh)!==stable(report))fail('This saved comparison differs from the complete original preparation or the current normaliser. Keep the unchanged selected file; it was not installed or imported.',409);
 return fresh;
}

export function intakeOperation(s,method,parts,input={}){
  if(method==='GET'&&!parts.length)return listIntakes(s);
  if(method==='GET'&&parts[0]==='source-lineages'&&parts.length===2)return sourceLineages(s,parts[1]);
  if(method==='GET'&&parts[1]==='original'&&parts.length===2){const saved=readIntake(s,parts[0]);if(!saved.value.lineage)fail('This preparation uses an original text source.',404);return {...readOriginal(s,saved.value.lineage.original.sha256),filename:saved.value.lineage.original.filename};}
  if(method==='POST'&&parts[0]==='comparison-reopen'&&parts.length===1)return reopenIntakeComparison(input);
  if(method==='POST'&&parts[1]==='compare'&&parts.length===2)return compareIntakePreparations(s,parts[0],input);
  if(method==='GET'&&parts[1]==='comparison-history'&&parts.length===2)return s.readConsistent(()=>{const project=exportIntakes(s,parts[0]);validateIntakes(project);return {project,historySha:hash(stable(project))};});
  if(method==='POST'&&parts[0]==='validate-working')return validateWorkingIntake(input);
  if(method==='POST'&&parts[0]==='inspect')return inspectIntake(s,input);
  if(method==='POST'&&parts[0]==='copy')return copyIntake(s,input);
  if(method==='PUT'&&parts.length===1)return saveIntake(s,{...input,id:parts[0]});
  if(method==='GET'&&parts.length===1)return readIntake(s,parts[0]);
  if(method==='GET'&&parts[1]==='export')return exportIntakes(s,parts[0]);
  if(method==='GET'&&parts[1]==='editions')return exportIntakes(s,parts[0]).editions;
  if(method==='POST'&&parts[1]==='preview')return previewSavedIntake(s,parts[0],input.revision);
  if(method==='POST'&&parts[1]==='import')return importIntake(s,parts[0],input);
  fail('Guided intake operation not found.',404);
}
