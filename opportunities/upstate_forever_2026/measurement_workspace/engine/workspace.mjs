import {installLargeFileReads} from './large_intake.mjs';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID} from 'node:crypto';
import {parseSource, hash, stable, FIELDS} from './normalise.mjs';
import {InputError, clean, csv} from './parse.mjs';

export class MeasurementWorkspace {
  constructor(directory = path.resolve(process.env.DATA_DIR || './data')) {
    this.directory=directory;fs.mkdirSync(directory,{recursive:true});
    this.db=new DatabaseSync(path.join(directory,'measurements.sqlite'));
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value INTEGER NOT NULL);
      INSERT OR IGNORE INTO meta VALUES('revision',0);
      CREATE TABLE IF NOT EXISTS imports(id TEXT PRIMARY KEY,kind TEXT NOT NULL,label TEXT NOT NULL,created_at TEXT NOT NULL,sha TEXT NOT NULL,origin TEXT NOT NULL,mapping TEXT NOT NULL,content TEXT NOT NULL,summary TEXT NOT NULL,rejected TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY,logical_key TEXT NOT NULL,station_id TEXT NOT NULL,parameter TEXT NOT NULL,sampled_date TEXT NOT NULL,censor TEXT NOT NULL,unit TEXT NOT NULL,fraction TEXT NOT NULL,data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS records_station_date ON records(station_id,sampled_date);
      CREATE INDEX IF NOT EXISTS records_parameter ON records(parameter,sampled_date);
      CREATE INDEX IF NOT EXISTS records_logical ON records(logical_key);
      CREATE TABLE IF NOT EXISTS import_records(import_id TEXT NOT NULL REFERENCES imports(id),record_id TEXT NOT NULL REFERENCES records(id),source_line INTEGER NOT NULL,PRIMARY KEY(import_id,record_id,source_line));
      CREATE INDEX IF NOT EXISTS import_records_record ON import_records(record_id);
      CREATE TABLE IF NOT EXISTS stations(id TEXT PRIMARY KEY,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS mappings(station_id TEXT PRIMARY KEY,reach_id TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS reviews(record_id TEXT PRIMARY KEY REFERENCES records(id),state TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS selected_versions(logical_key TEXT PRIMARY KEY,record_id TEXT NOT NULL REFERENCES records(id));
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY AUTOINCREMENT,created_at TEXT NOT NULL,kind TEXT NOT NULL,entity TEXT NOT NULL,data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS exports(id TEXT PRIMARY KEY,created_at TEXT NOT NULL,revision INTEGER NOT NULL,kind TEXT NOT NULL,content TEXT NOT NULL);
    `);
  }
  readConsistent(operation){
    this.db.exec('BEGIN');try{const value=operation();this.db.exec('COMMIT');return value;}catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  recordSources(id){
    this.sourceStatement ||= this.db.prepare('SELECT i.id,i.label,i.sha,i.created_at,ir.source_line FROM import_records ir JOIN imports i ON i.id=ir.import_id WHERE ir.record_id=? ORDER BY i.created_at');
    return this.sourceStatement.all(id);
  }
  refreshNativeDomain(){
    const file=path.join(this.directory,'reaches.json');
    this.nativeDomain=fs.existsSync(file)?new Map(JSON.parse(fs.readFileSync(file,'utf8')).map(r=>[r.id,r])):null;
  }
  close(){this.db.close();}
  revision(){return this.db.prepare("SELECT value FROM meta WHERE key='revision'").get().value;}
  atomic(operation, expectedRevision) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      if(expectedRevision!==undefined && expectedRevision!==this.revision())throw new InputError('Workspace changed. Refresh before applying this edit.',409);
      const result=operation();
      this.db.prepare("UPDATE meta SET value=value+1 WHERE key='revision'").run();
      this.db.exec('COMMIT');return result;
    } catch(error) {this.db.exec('ROLLBACK');throw error;}
  }
  event(kind,entity,data) {
    this.db.prepare('INSERT INTO events(created_at,kind,entity,data) VALUES(?,?,?,?)').run(new Date().toISOString(),kind,entity,JSON.stringify(data));
  }
  preview(input) {
    const parsed=parseSource(input),summary=this.describe(parsed),contentSha=hash(input.text);
    return {...summary,contentSha,kind:input.kind,mapping:parsed.mapping,headers:parsed.headers,
      sample:parsed.rows.slice(0,25).map(x=>({...x.row,sourceLine:x.line})),rejected:parsed.rejected.slice(0,25),
      previewCount:Math.min(25,parsed.rows.length),mappingFields:Object.keys(FIELDS)};
  }
  describe(parsed) {
    const parameters={},issues={},stations=new Set();let censored=0;
    for(const {row} of parsed.rows){stations.add(row.stationId||row.id);if(row.parameter)parameters[row.parameter]=(parameters[row.parameter]||0)+1;if(row.censor&&row.censor!=='none')censored++;for(const issue of row.issues||[])issues[issue]=(issues[issue]||0)+1;}
    return {rows:parsed.rows.length,rejectedCount:parsed.rejected.length,stationCount:stations.size,censored,parameters,issues};
  }
  import(input) {
    const label=clean(input.label);if(!label)throw new InputError('Name this source before importing');
    const sha=hash(input.text), parsed=parseSource(input);
    if(input.contentSha && input.contentSha!==sha)throw new InputError('Source content differs from the reviewed preview',409);
    const id=hash(stable([input.kind,sha,parsed.mapping]));
    const previous=this.db.prepare('SELECT summary FROM imports WHERE id=?').get(id);
    if(previous)return {id,duplicate:true,...JSON.parse(previous.summary),revision:this.revision()};
    if(!parsed.rows.length && parsed.rejected.length)throw new InputError('Every source row was rejected. Fix column mapping or input values before committing.');
    const summary=this.describe(parsed),now=new Date().toISOString();let inserted=0,existing=0;
    this.atomic(()=>{
      // Another process may have committed the same complete source between preview and lock.
      if(this.db.prepare('SELECT id FROM imports WHERE id=?').get(id))return;
      this.db.prepare('INSERT INTO imports VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,input.kind,label,now,sha,stable(input.origin||{type:'file'}),JSON.stringify(parsed.mapping),input.text,JSON.stringify(summary),JSON.stringify(parsed.rejected));
      const insert=this.db.prepare('INSERT OR IGNORE INTO records VALUES(?,?,?,?,?,?,?,?,?)');
      const link=this.db.prepare('INSERT OR IGNORE INTO import_records VALUES(?,?,?)');
      for(const {line,row} of parsed.rows){
        if(input.kind==='stations'){this.mergeStation(row,id);continue;}
        const recordId=hash(stable([row.sourceKind,row]));
        const changes=insert.run(recordId,row.logicalKey,row.stationId,row.parameter,row.sampledDate,row.censor,row.unit,row.fraction,JSON.stringify(row)).changes;
        if(changes)inserted++;else existing++;
        link.run(id,recordId,line);this.mergeStation(row.station,id);
      }
      this.event('import',id,{label,sha,inserted,existing,summary});
    });
    return {id,duplicate:false,...summary,inserted,existing,revision:this.revision()};
  }
  mergeStation(station,importId){
    const oldRow=this.db.prepare('SELECT data FROM stations WHERE id=?').get(station.id),old=oldRow?JSON.parse(oldRow.data):{};
    // Merge metadata only, preserving every original row in its immutable source import.
    const merged={...old,id:station.id,sourceImports:[...new Set([...(old.sourceImports||[]),importId])]};
    for(const [key,value] of Object.entries(station))if(key!=='id'&&value!==null&&value!==''&&!(key==='name'&&value===station.id&&old.name))merged[key]=value;
    this.db.prepare('INSERT INTO stations VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(station.id,JSON.stringify(merged));
  }
  filters(input={}) {
    const terms=[],params=[];
    for(const [key,column] of Object.entries({stationId:'r.station_id',parameter:'r.parameter',fraction:'r.fraction',unit:'r.unit',censor:'r.censor'}))if(clean(input[key])){terms.push(column+'=?');params.push(input[key]);}
    if(clean(input.from)){terms.push('r.sampled_date>=?');params.push(input.from);}
    if(clean(input.to)){terms.push('r.sampled_date<=?');params.push(input.to);}
    if(clean(input.q)){terms.push('(r.station_id LIKE ? ESCAPE \'\\\' OR r.parameter LIKE ? ESCAPE \'\\\')');const q='%'+String(input.q).replace(/[\\%_]/g,'\\$&')+'%';params.push(q,q);}
    return {where:terms.length?' WHERE '+terms.join(' AND '):'',params};
  }
  selectSQL(){return `SELECT r.*,rv.state AS review_state,rv.data AS review_data,m.data AS mapping_data,
    (SELECT COUNT(*) FROM records x WHERE x.logical_key=r.logical_key) AS variant_count,
    s.record_id AS selected_id FROM records r LEFT JOIN reviews rv ON rv.record_id=r.id
    LEFT JOIN mappings m ON m.station_id=r.station_id LEFT JOIN selected_versions s ON s.logical_key=r.logical_key`;}
  view(item){
    const row={...JSON.parse(item.data),id:item.id,review:item.review_data?JSON.parse(item.review_data):{state:'pending'},
      mapping:item.mapping_data?JSON.parse(item.mapping_data):null,variantCount:item.variant_count,selectedVersion:item.selected_id||null};
    row.eligible=this.eligibility(row);return row;
  }
  eligibility(row){
    const reasons=[];
    if(row.mapping?.reachId&&this.nativeDomain){
      const native=this.nativeDomain.get(row.mapping.reachId);
      if(!native)reasons.push('native-domain-unbound');
      else if(row.mapping.domainSourceReference?.sourceSha256&&native.sourceSha256!==row.mapping.domainSourceReference.sourceSha256)reasons.push('native-domain-edition-changed');
    }
    if(!row.mapping?.reachId)reasons.push('reach-unassigned');
    if(row.censor!=='none')reasons.push('censored-result');
    if(row.value===null)reasons.push('missing-numeric-result');
    if(!['do','tn','tp','flow','temperature','bod5','cbod5','nitrate','orthophosphate'].includes(row.parameter))reasons.push('unmapped-constituent');
    const fatal=['unrecognized-unit','negative-concentration','negative-detection-limit','invalid-station-coordinate','non-water-or-unspecified-medium','quality-control-sample','derived-source-value','review-detection-condition'];
    reasons.push(...row.issues.filter(x=>fatal.includes(x)));
    if(row.review.state==='exclude')reasons.push('review-excluded');
    if(row.review.state!=='include'&&row.issues.some(x=>['qualified-result','review-source-status','unit-from-single-detection-limit'].includes(x)))reasons.push('review-required');
    if(row.variantCount>1&&row.selectedVersion!==row.id)reasons.push(row.selectedVersion?'superseded-by-explicit-selection':'source-revision-conflict');
    return {ok:reasons.length===0,reasons:[...new Set(reasons)]};
  }
  records(query={}) {
    this.refreshNativeDomain();
    const{where,params}=this.filters(query),limit=Math.max(1,Math.min(500,Math.trunc(Number(query.limit))||100)),offset=Math.max(0,Math.trunc(Number(query.offset)||0));
    const count=this.db.prepare('SELECT COUNT(*) n FROM records r'+where).get(...params).n;
    const rows=this.db.prepare(this.selectSQL()+where+' ORDER BY r.sampled_date DESC,r.id LIMIT ? OFFSET ?').all(...params,limit,offset).map(r=>{const view=this.view(r);delete view.raw;return view;});
    return {revision:this.revision(),total:count,offset,limit,rows};
  }
  *iterate(query={}) {
    this.refreshNativeDomain();
    const{where,params}=this.filters(query);
    for(const row of this.db.prepare(this.selectSQL()+where+' ORDER BY r.sampled_date,r.id').iterate(...params))yield this.view(row);
  }
  recordDetail(item){
    // Both single-record reads and the complete snapshot use this original view.
    const row=this.view(item);row.sources=this.recordSources(item.id);
    this.variantStatement ||= this.db.prepare('SELECT id FROM records WHERE logical_key=?');
    this.historyStatement ||= this.db.prepare('SELECT * FROM events WHERE entity=? ORDER BY id');
    row.variants=this.variantStatement.all(item.logical_key).map(x=>x.id);
    row.history=this.historyStatement.all(item.id).map(x=>({...x,data:JSON.parse(x.data)}));
    return row;
  }
  record(id){
    this.refreshNativeDomain();
    const item=this.db.prepare(this.selectSQL()+' WHERE r.id=?').get(id);if(!item)throw new InputError('Measurement not found',404);
    return this.recordDetail(item);
  }
  fullSnapshot(query={}){
    const supported=new Set(['stationId','parameter','fraction','unit','censor','from','to','q','expected_revision']);
    for(const key of Object.keys(query))if(!supported.has(key))throw new InputError('Unknown full-snapshot filter: '+key);
    let expected;
    if(query.expected_revision!==undefined){
      if(!/^(0|[1-9]\d*)$/.test(String(query.expected_revision)))throw new InputError('Expected measured revision must be a nonnegative integer');
      expected=Number(query.expected_revision);
      if(!Number.isSafeInteger(expected))throw new InputError('Expected measured revision exceeds the supported range');
    }
    // The original native domain is read once; the entire database view uses one
    // read transaction. No portable export or revision is created by this read.
    this.refreshNativeDomain();
    return this.readConsistent(()=>{
      const revision=this.revision();
      if(expected!==undefined&&expected!==revision)throw new InputError('Measurements changed after inspection. Review the current source revision.',409);
      const{where,params}=this.filters(query);
      const records=this.db.prepare(this.selectSQL()+where+' ORDER BY r.sampled_date DESC,r.id').all(...params).map(item=>this.recordDetail(item));
      const portable=this.portableDocument(),summary={...this.summary(),reaches:[...(this.nativeDomain?.values()||[])]};
      return {revision,total:records.length,records,portable,summary};
    });
  }
  summary(){
    const stations=this.db.prepare('SELECT s.data,m.data AS mapping_data,(SELECT COUNT(*) FROM records r WHERE r.station_id=s.id) AS n FROM stations s LEFT JOIN mappings m ON m.station_id=s.id ORDER BY s.id').all().map(x=>({...JSON.parse(x.data),mapping:x.mapping_data?JSON.parse(x.mapping_data):null,recordCount:x.n}));
    return {revision:this.revision(),recordCount:this.db.prepare('SELECT COUNT(*) n FROM records').get().n,
      stations,parameters:this.db.prepare('SELECT parameter,unit,fraction,COUNT(*) n FROM records GROUP BY parameter,unit,fraction ORDER BY parameter,unit,fraction').all(),
      imports:this.db.prepare('SELECT id,kind,label,created_at AS createdAt,sha,summary,origin FROM imports ORDER BY created_at DESC').all().map(x=>({...x,summary:JSON.parse(x.summary),origin:JSON.parse(x.origin)})),
      exportCount:this.db.prepare('SELECT COUNT(*) n FROM exports').get().n};
  }
  mapping(stationId,input,reachIds){
    if(!this.db.prepare('SELECT id FROM stations WHERE id=?').get(stationId))throw new InputError('Import this station first',404);
    const reachId=clean(input.reachId),reviewer=clean(input.reviewer),reason=clean(input.reason);
    if(reachId&&!reachIds.includes(reachId))throw new InputError('Unknown reach identifier');
    if(!reviewer||!reason)throw new InputError('Reviewer and assignment rationale are required');
    const value={stationId,reachId,reviewer,reason,domainSourceReference:input.domainSourceReference||null,updatedAt:new Date().toISOString(),coordinateInterpretation:clean(input.coordinateInterpretation)||'Explicit analyst assignment'};
    this.atomic(()=>{this.db.prepare('INSERT INTO mappings VALUES(?,?,?) ON CONFLICT(station_id) DO UPDATE SET reach_id=excluded.reach_id,data=excluded.data').run(stationId,reachId,JSON.stringify(value));this.event('station-assignment',stationId,value);},input.expectedRevision);
    return {value,revision:this.revision()};
  }
  review(id,input){
    const row=this.record(id),state=clean(input.state),reviewer=clean(input.reviewer),reason=clean(input.reason);
    if(!['pending','include','exclude'].includes(state)||!reviewer||!reason)throw new InputError('Valid review state, reviewer and rationale are required');
    if(input.selectVersion&&state!=='include')throw new InputError('A selected source revision must be included');
    const value={state,reviewer,reason,updatedAt:new Date().toISOString(),selectVersion:input.selectVersion===true};
    this.atomic(()=>{
      this.db.prepare('INSERT INTO reviews VALUES(?,?,?) ON CONFLICT(record_id) DO UPDATE SET state=excluded.state,data=excluded.data').run(id,state,JSON.stringify(value));
      if(input.selectVersion)this.db.prepare('INSERT INTO selected_versions VALUES(?,?) ON CONFLICT(logical_key) DO UPDATE SET record_id=excluded.record_id').run(row.logicalKey,id);
      else if(state!=='include')this.db.prepare('DELETE FROM selected_versions WHERE record_id=?').run(id);
      this.event('measurement-review',id,value);
    },input.expectedRevision);
    return {record:this.record(id),revision:this.revision()};
  }
  source(id){const result=this.db.prepare('SELECT * FROM imports WHERE id=?').get(id);if(!result)throw new InputError('Source not found',404);return result;}
  exportRecords(query={}){
    const rows=[...this.iterate(query)].map(r=>({id:r.id,stationId:r.stationId,reachId:r.mapping?.reachId||'',sampledDate:r.sampledDate,sampledAt:r.sampledAt,timePrecision:r.timePrecision,parameter:r.parameter,characteristic:r.characteristic,basis:r.basis,fraction:r.fraction,value:r.value,lower:r.lower,upper:r.upper,censor:r.censor,unit:r.unit,qualifier:r.qualifier,status:r.status,method:r.method,laboratory:r.laboratory,review:r.review.state,eligible:r.eligible.ok,reasons:r.eligible.reasons,sourceResultId:r.sourceResultId}));
    const fields=['id','stationId','reachId','sampledDate','sampledAt','timePrecision','parameter','characteristic','basis','fraction','value','lower','upper','censor','unit','qualifier','status','method','laboratory','review','eligible','reasons','sourceResultId'];
    return csv(rows,fields);
  }
  snapshot(kind,content){const id=randomUUID();this.db.prepare('INSERT INTO exports VALUES(?,?,?,?,?)').run(id,new Date().toISOString(),content.workspaceRevision??this.revision(),kind,JSON.stringify(content));return id;}
  portableDocument(){
    // Caller owns the original consistent read transaction.
    const value={format:'upper-savannah-measurements',version:1,createdAt:new Date().toISOString(),revision:this.revision(),tables:{}};
    for(const name of ['imports','records','import_records','stations','mappings','reviews','selected_versions','events','exports'])value.tables[name]=this.db.prepare(`SELECT * FROM ${name}`).all();
    return value;
  }
  portable(){return this.readConsistent(()=>this.portableDocument());}
  receive(packageValue){
    if(packageValue?.format!=='upper-savannah-measurements'||packageValue.version!==1)throw new InputError('Unknown portable workspace format');
    const tables=packageValue.tables;
    const keys={imports:['id','kind','label','created_at','sha','origin','mapping','content','summary','rejected'],records:['id','logical_key','station_id','parameter','sampled_date','censor','unit','fraction','data'],import_records:['import_id','record_id','source_line'],stations:['id','data'],mappings:['station_id','reach_id','data'],reviews:['record_id','state','data'],selected_versions:['logical_key','record_id'],events:['id','created_at','kind','entity','data'],exports:['id','created_at','revision','kind','content']};
    for(const [name,columns]of Object.entries(keys)){
      if(!Array.isArray(tables?.[name]))throw new InputError('Portable workspace missing '+name);
      for(const row of tables[name])if(columns.some(c=>!Object.hasOwn(row,c)))throw new InputError('Portable row missing required field in '+name);
    }
    // Canonical values are rebuilt from complete originals, not trusted from the package.
    const expectedRecords=new Map(),expectedLinks=new Set();
    for(const source of tables.imports){
      if(hash(source.content)!==source.sha)throw new InputError('Original source checksum mismatch');
      const parsed=parseSource({kind:source.kind,text:source.content,mapping:JSON.parse(source.mapping)});
      if(hash(stable([source.kind,source.sha,parsed.mapping]))!==source.id)throw new InputError('Original import identity mismatch');
      if(stable(this.describe(parsed))!==stable(JSON.parse(source.summary))||stable(parsed.rejected)!==stable(JSON.parse(source.rejected)))throw new InputError('Source parse accounting mismatch');
      const origin=JSON.parse(source.origin);
      for(const page of origin.pages||[])if(hash(page.text)!==page.sha)throw new InputError('Provider page checksum mismatch');
      for(const {line,row}of parsed.rows)if(source.kind!=='stations'){
        const id=hash(stable([row.sourceKind,row]));expectedRecords.set(id,row);expectedLinks.add(stable([source.id,id,line]));
      }
    }
    if(expectedRecords.size!==tables.records.length)throw new InputError('Portable record population differs from original sources');
    for(const row of tables.records){
      const expected=expectedRecords.get(row.id),record=JSON.parse(row.data);
      if(!expected||stable(expected)!==stable(record))throw new InputError('Canonical measurement differs from its original source');
      for(const [column,key] of Object.entries({logical_key:'logicalKey',station_id:'stationId',parameter:'parameter',sampled_date:'sampledDate',censor:'censor',unit:'unit',fraction:'fraction'}))if(row[column]!==record[key])throw new InputError('Indexed measurement differs from canonical record');
    }
    if(expectedLinks.size!==tables.import_records.length||tables.import_records.some(r=>!expectedLinks.has(stable([r.import_id,r.record_id,r.source_line]))))throw new InputError('Source-row provenance population mismatch');
    for(const row of tables.selected_versions)if(expectedRecords.get(row.record_id)?.logicalKey!==row.logical_key)throw new InputError('Selected revision does not belong to its source result');
    for(const row of tables.reviews)if(!['pending','include','exclude'].includes(row.state)||JSON.parse(row.data).state!==row.state)throw new InputError('Invalid portable review state');
    for(const row of tables.stations)if(JSON.parse(row.data).id!==row.id)throw new InputError('Invalid station identity');
    for(const row of tables.mappings){const data=JSON.parse(row.data);if(data.stationId!==row.station_id||data.reachId!==row.reach_id||!tables.stations.some(x=>x.id===row.station_id))throw new InputError('Invalid station mapping');}
    if(!Number.isSafeInteger(packageValue.revision)||packageValue.revision<0)throw new InputError('Invalid portable revision');
    this.atomic(()=>{
      if(this.db.prepare('SELECT COUNT(*) n FROM imports').get().n||this.db.prepare('SELECT COUNT(*) n FROM records').get().n)throw new InputError('Receive into an empty workspace; existing work is never overwritten',409);
      for(const [name,columns]of Object.entries(keys)){
        const insert=this.db.prepare(`INSERT INTO ${name}(${columns.join(',')}) VALUES(${columns.map(()=>'?').join(',')})`);
        for(const row of tables[name])insert.run(...columns.map(c=>row[c]));
      }
      this.db.prepare("UPDATE meta SET value=? WHERE key='revision'").run(packageValue.revision);
      this.event('receive','workspace',{sourceCreatedAt:packageValue.createdAt,sourceRevision:packageValue.revision});
    });
    return this.summary();
  }
}

installLargeFileReads(MeasurementWorkspace);
