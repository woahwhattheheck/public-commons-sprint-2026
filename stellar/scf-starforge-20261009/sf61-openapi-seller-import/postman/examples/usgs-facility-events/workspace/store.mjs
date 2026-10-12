// MIT. Durable private customer workspaces; original responses are stored once by their byte digest.
import { DatabaseSync } from 'node:sqlite';
import { mkdir, chmod, readFile, writeFile, lstat, realpath } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
import { retainCollectionArchive, retainUploadedCollection, readRetainedCollection, readCollectionMembers, parseCollectionManifest, collectionArchiveParts, receiveArchiveParts } from './buyer-collections.mjs';
import { DESK_SCHEMA, TRANSFER_SCHEMA, COLLECTION_TRANSFER_SCHEMA, SOURCE_LIMIT, now, uuid, plain, need, string, hash, canonical,
  projectSettings, roster, queryPlan, sourceRecord, edition, editionRows, review, compareEditions, eventFingerprint,
  buyerCollection, validateBuyerSource } from './model.mjs';

const identify = value => {const {id,...body}=value;return {...body,id:hash(body)};};
const json = value => JSON.stringify(value);
const parse = row => row?JSON.parse(row.payload):null;
export class FacilityStore {
  constructor(directory,database,lease,manifest) {
    this.directory=directory;this.database=database;this.lease=lease;this.manifest=manifest;this.closed=false;this.importing=false;
    database.exec([
      'PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;',
      'CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, revision INTEGER NOT NULL, payload TEXT NOT NULL) STRICT;',
      'CREATE TABLE IF NOT EXISTS blobs(sha TEXT PRIMARY KEY, bytes BLOB NOT NULL) STRICT;',
      'CREATE TABLE IF NOT EXISTS entries(project_id TEXT NOT NULL REFERENCES projects(id),kind TEXT NOT NULL,id TEXT NOT NULL,position INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(project_id,kind,id)) STRICT;',
      'CREATE INDEX IF NOT EXISTS entry_order ON entries(project_id,kind,position);',
      'CREATE TABLE IF NOT EXISTS work(project_id TEXT NOT NULL REFERENCES projects(id),pair TEXT NOT NULL,edition_id TEXT NOT NULL,position INTEGER NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(project_id,pair)) STRICT;',
      'CREATE TABLE IF NOT EXISTS latest_review(project_id TEXT NOT NULL REFERENCES projects(id),pair TEXT NOT NULL,id TEXT NOT NULL,position INTEGER NOT NULL,fingerprint TEXT NOT NULL,status TEXT NOT NULL,assignee TEXT NOT NULL,PRIMARY KEY(project_id,pair)) STRICT;',
      'CREATE TABLE IF NOT EXISTS captures(project_id TEXT NOT NULL REFERENCES projects(id),id TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(project_id,id)) STRICT;',
      'CREATE TABLE IF NOT EXISTS receipts(project_id TEXT NOT NULL,operation_id TEXT NOT NULL,request_hash TEXT NOT NULL,payload TEXT NOT NULL,PRIMARY KEY(project_id,operation_id)) STRICT;'
    ].join('\n'));
    // Acquiring the native SQLite writer lease establishes that the preceding process has ended.
    for(const row of database.prepare('SELECT project_id,id,payload FROM captures').all()) {
      const job=JSON.parse(row.payload);
      if(job.state==='capturing') {job.state='interrupted';job.error='The workspace closed while this capture was in progress.';this.saveCapture(row.project_id,job);}
    }
  }
  assertOpen() {need(!this.closed,'This workspace is closed.',503);need(!this.importing,'The full workspace import is still being received.',409);}
  transaction(projectId,input,expectedRevision,operationId,fn) {
    this.assertOpen();
    need(typeof operationId==='string' && /^[A-Za-z0-9._:-]{1,180}$/.test(operationId),'Supply the original request identity.');
    const requestHash=hash(input),scope=projectId??'@workspace';
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const receipt=this.database.prepare('SELECT request_hash,payload FROM receipts WHERE project_id=? AND operation_id=?').get(scope,operationId);
      if(receipt) {need(receipt.request_hash===requestHash,'This request identity already names a different operation.',409);this.database.exec('COMMIT');return JSON.parse(receipt.payload);}
      const project=projectId?this.project(projectId):null;
      if(project) need(expectedRevision===project.revision,'This project changed in another operation. Refresh it and retain your draft before saving.',409);
      const result=fn(project);
      if(project) {project.revision++;project.updatedAt=now();this.database.prepare('UPDATE projects SET revision=?,payload=? WHERE id=?').run(project.revision,json(project),projectId);}
      const response={...result,projectId:result.projectId??projectId,revision:project?.revision??result.revision};
      this.database.prepare('INSERT INTO receipts VALUES(?,?,?,?)').run(scope,operationId,requestHash,json(response));
      this.database.exec('COMMIT');return response;
    } catch(error) {if(this.database.isTransaction)this.database.exec('ROLLBACK');throw error;}
  }
  project(id) {
    const row=this.database.prepare('SELECT payload FROM projects WHERE id=?').get(id);
    need(row,'Choose an existing customer project.',404);return parse(row);
  }
  listProjects() {this.assertOpen();return this.database.prepare('SELECT payload FROM projects ORDER BY json_extract(payload,\'$.updatedAt\') DESC,id').all().map(parse);}
  createProject(input,operationId) {
    const settings=projectSettings(input);
    return this.transaction(null,{command:'create-project',settings},null,operationId,()=>{
      const project={...settings,id:uuid(),revision:0,createdAt:now(),updatedAt:now(),currentRosterId:null,selectedEditionId:null};
      this.database.prepare('INSERT INTO projects VALUES(?,?,?)').run(project.id,0,json(project));
      return {projectId:project.id,revision:0};
    });
  }
  updateProject(id,input,revision,operationId) {
    const settings=projectSettings(input);
    return this.transaction(id,{command:'settings',settings},revision,operationId,project=>{Object.assign(project,settings);return {saved:true};});
  }
  entry(projectId,kind,id) {
    const value=parse(this.database.prepare('SELECT payload FROM entries WHERE project_id=? AND kind=? AND id=?').get(projectId,kind,id));
    need(value,'The selected '+kind+' is not in this project.',404);return value;
  }
  entries(projectId,kind) {return this.database.prepare('SELECT payload FROM entries WHERE project_id=? AND kind=? ORDER BY position,id').all(projectId,kind).map(parse);}
  addEntry(projectId,kind,value,position) {
    const payload=json(value),existing=this.database.prepare('SELECT payload FROM entries WHERE project_id=? AND kind=? AND id=?').get(projectId,kind,value.id);
    if(existing) need(existing.payload===payload,'An immutable saved item has different contents.',409);
    else this.database.prepare('INSERT INTO entries VALUES(?,?,?,?,?)').run(projectId,kind,value.id,position,payload);
    if(kind==='edition') for(const row of editionRows(value)) {
      this.database.prepare('INSERT INTO work VALUES(?,?,?,?,?) ON CONFLICT(project_id,pair) DO UPDATE SET edition_id=excluded.edition_id,position=excluded.position,payload=excluded.payload WHERE excluded.position>=work.position')
        .run(projectId,row.pair,value.id,position,json(row));
    }
    if(kind==='review') this.database.prepare('INSERT INTO latest_review VALUES(?,?,?,?,?,?,?) ON CONFLICT(project_id,pair) DO UPDATE SET id=excluded.id,position=excluded.position,fingerprint=excluded.fingerprint,status=excluded.status,assignee=excluded.assignee WHERE excluded.position>=latest_review.position')
      .run(projectId,value.pair,value.id,position,value.fingerprint,value.status,value.assignee);
    return value;
  }
  putBlob(bytes) {
    const digest=hash(bytes);
    this.database.prepare('INSERT OR IGNORE INTO blobs VALUES(?,?)').run(digest,bytes);return digest;
  }
  blob(digest) {const row=this.database.prepare('SELECT bytes FROM blobs WHERE sha=?').get(digest);need(row,'Original source bytes are missing.',404);return Buffer.from(row.bytes);}
  saveRoster(projectId,input,revision,operationId) {
    const selected=roster(input);
    return this.transaction(projectId,{command:'roster',selected},revision,operationId,project=>{
      const value=identify({...selected,createdAt:now(),sequence:project.revision+1});
      this.addEntry(projectId,'roster',value,value.sequence);project.currentRosterId=value.id;
      return {id:value.id};
    });
  }
  importSource(projectId,bytes,input,revision,operationId) {
    return this.transaction(projectId,{command:'source',bodySha256:hash(bytes),metadata:input},revision,operationId,project=>{
      const selected=sourceRecord(bytes,input);this.putBlob(bytes);this.addEntry(projectId,'source',selected,project.revision+1);return {id:selected.id};
    });
  }
  async collectionTransaction(projectId,input,expectedRevision,operationId,fn) {
    this.assertOpen();
    need(typeof operationId==='string'&&/^[A-Za-z0-9._:-]{1,180}$/.test(operationId),'Supply the original request identity.');
    need(!this.database.prepare("SELECT 1 FROM captures WHERE json_extract(payload,'$.state')='capturing' LIMIT 1").get(),
      'Pause active source captures before receiving buyer collections.',409);
    const requestHash=hash(input),db=this.database;this.importing=true;
    try{
      db.exec('BEGIN IMMEDIATE');
      const receipt=db.prepare('SELECT request_hash,payload FROM receipts WHERE project_id=? AND operation_id=?').get(projectId,operationId);
      if(receipt){need(receipt.request_hash===requestHash,'This request identity already names a different operation.',409);
        db.exec('COMMIT');return JSON.parse(receipt.payload);}
      const project=this.project(projectId);
      need(expectedRevision===project.revision,'This project changed. Refresh it and retain your collection selection.',409);
      const result=await fn(project);
      project.revision++;project.updatedAt=now();
      db.prepare('UPDATE projects SET revision=?,payload=? WHERE id=?').run(project.revision,json(project),projectId);
      const response={...result,projectId,revision:project.revision};
      db.prepare('INSERT INTO receipts VALUES(?,?,?,?)').run(projectId,operationId,requestHash,json(response));
      db.exec('COMMIT');return response;
    }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
    finally{this.importing=false;}
  }
  async importBuyerCollection(projectId,input,revision,operationId,{signal}={}) {
    const request={archive:string(input.archive,'Original archive path',8000,true),
      expectedSha256:string(input.expectedSha256??'','Expected archive SHA-256',64),
      operator:string(input.operator,'Receiving operator',200,true),note:string(input.note??'','Collection receiving note',8000)};
    return this.collectionTransaction(projectId,{command:'buyer-collection',...request},revision,operationId,async project=>{
      const native=await retainCollectionArchive(this.directory,request.archive,{expectedSha256:request.expectedSha256,signal});
      const value=buyerCollection(native.manifestBytes,native,{...request,name:native.name});
      this.putBlob(native.manifestBytes);this.addEntry(projectId,'collection',value,project.revision+1);
      return {id:value.id,archiveSha256:value.archiveSha256,manifestSha256:value.manifestSha256,
        members:value.memberCount,archiveBytes:value.archiveBytes};
    });
  }
  async importBuyerCollectionUpload(projectId,readable,input,revision,operationId,{signal}={}) {
    const request={name:string(input.name,'Original archive filename',4096,true),
      expectedSha256:string(input.expectedSha256,'Original archive SHA-256',64,true),bytes:input.bytes,
      operator:string(input.operator,'Receiving operator',200,true)};
    need(/^[a-f0-9]{64}$/.test(request.expectedSha256)&&Number.isSafeInteger(request.bytes)&&
      request.bytes>=1024&&request.bytes<=16*1024*1024*1024,'Supply the complete original upload identity.');
    return this.collectionTransaction(projectId,{command:'buyer-collection-upload',...request},revision,operationId,async project=>{
      const native=await retainUploadedCollection(this.directory,readable,{expectedSha256:request.expectedSha256,expectedBytes:request.bytes,signal});
      const value=buyerCollection(native.manifestBytes,native,request);
      this.putBlob(native.manifestBytes);this.addEntry(projectId,'collection',value,project.revision+1);
      return {id:value.id,archiveSha256:value.archiveSha256,manifestSha256:value.manifestSha256,
        members:value.memberCount,archiveBytes:value.archiveBytes};
    });
  }
  collectionMembers(projectId,id,options={}) {
    this.assertOpen();const collection=this.entry(projectId,'collection',id);
    return {...readCollectionMembers(this.blob(collection.manifestSha256),options),received:collection};
  }
  sourceAcquisitions(projectId,sources) {
    return sources.filter(source=>source.acquisition).map(source=>{
      const collection=this.entry(projectId,'collection',source.acquisition.collectionId);
      return validateBuyerSource(source,collection,this.blob(collection.manifestSha256));
    });
  }
  async importCollectionSources(projectId,collectionId,input,revision,operationId,{signal}={}) {
    const operator=string(input.operator,'Receiving operator',200,true),note=string(input.note??'','Response receiving note',4000);
    need(Array.isArray(input.memberIds)&&input.memberIds.length>=1&&input.memberIds.length<=16&&
      input.memberIds.every(id=>/^[a-f0-9]{64}$/.test(id))&&new Set(input.memberIds).size===input.memberIds.length,
      'Choose 1–16 distinct original response members.');
    const request={command:'collection-sources',collectionId,memberIds:input.memberIds,operator,note};
    return this.collectionTransaction(projectId,request,revision,operationId,async project=>{
      const collection=this.entry(projectId,'collection',collectionId),metadata=this.blob(collection.manifestSha256);
      const originalMembers=new Map(parseCollectionManifest(metadata).collection.members.map(member=>[member.id,member]));
      const members=input.memberIds.map(id=>{
        const selected=originalMembers.get(id);
        need(selected&&selected.bytes<=SOURCE_LIMIT&&[200,204].includes(selected.httpStatus),
          'Select a saved HTTP 200 or 204 response within the original source size limit.');
        return selected;
      });
      const byHash=new Map();
      for(const member of members){const list=byHash.get(member.sha256)??[];list.push(member);byHash.set(member.sha256,list);}
      const sourceIds=new Map(),receivedAt=now();
      await readRetainedCollection(this.directory,collection,{signal,onObject:object=>{
        const selected=byHash.get(object.sha256);if(!selected)return undefined;
        need(object.bytes<=SOURCE_LIMIT,'This member exceeds the original reporter’s source limit.');
        const chunks=[];let bytes=0;
        return {
          write(chunk){chunks.push(Buffer.from(chunk));bytes+=chunk.length;},
          finish:()=>{
            need(bytes===object.bytes,'The original collection member length changed.');
            const body=Buffer.concat(chunks,bytes);this.putBlob(body);
            for(const member of selected){
              const source=sourceRecord(body,{name:member.name,status:member.httpStatus,url:String(member.url??''),
                mode:'buyer-collection',receivedBy:operator,receivedAt,note,
                acquisition:{schema:'stellar-forge.facility-buyer-source.v1',collectionId:collection.id,
                  archiveSha256:collection.archiveSha256,manifestSha256:collection.manifestSha256,memberId:member.id}});
              validateBuyerSource(source,collection,metadata);
              this.addEntry(projectId,'source',source,project.revision+1);sourceIds.set(member.id,source.id);
            }
          },
          close(){chunks.length=0;}
        };
      }});
      need(sourceIds.size===members.length,'A selected original collection member is missing.');
      return {collectionId,sourceIds:members.map(member=>sourceIds.get(member.id)),archiveSha256:collection.archiveSha256};
    });
  }
  saveQuery(projectId,input,revision,operationId) {
    const selected=queryPlan(input);
    return this.transaction(projectId,{command:'query',selected},revision,operationId,project=>{
      const value=identify({plan:selected,createdAt:now(),sequence:project.revision+1});
      this.addEntry(projectId,'query',value,value.sequence);return {id:value.id};
    });
  }
  createEdition(projectId,input,revision,operationId) {
    need(Array.isArray(input.sourceIds),'Select retained sources.');
    const selected={rosterId:input.rosterId,sourceIds:input.sourceIds,label:input.label,operator:input.operator,note:input.note??''};
    return this.transaction(projectId,{command:'edition',selected},revision,operationId,project=>{
      const sites=this.entry(projectId,'roster',selected.rosterId),sources=selected.sourceIds.map(id=>{const source=this.entry(projectId,'source',id);return {source,bytes:this.blob(source.bodySha256)};});
      const value=identify({...edition(selected,sites,sources),sequence:project.revision+1});
      this.addEntry(projectId,'edition',value,value.sequence);project.selectedEditionId=value.id;return {id:value.id,counts:value.report.counts};
    });
  }
  selectEdition(projectId,id,revision,operationId) {
    return this.transaction(projectId,{command:'select-edition',id},revision,operationId,project=>{
      this.entry(projectId,'edition',id);project.selectedEditionId=id;return {id};
    });
  }
  saveReview(projectId,input,revision,operationId) {
    const selected={...input};delete selected.revision;delete selected.operationId;
    return this.transaction(projectId,{command:'review',selected},revision,operationId,project=>{
      const report=this.entry(projectId,'edition',input.editionId),row=editionRows(report).find(row=>row.pair===input.pair);
      need(row,'Choose a retained facility/event row.');
      const previous=this.database.prepare('SELECT id FROM latest_review WHERE project_id=? AND pair=?').get(projectId,row.pair);
      const value=identify({...review({...selected,...(previous?{previousId:previous.id}:{})},row),sequence:project.revision+1});
      this.addEntry(projectId,'review',value,value.sequence);return {id:value.id};
    });
  }
  reviewHistory(projectId,pair) {return this.entries(projectId,'review').filter(value=>value.pair===pair);}
  state(projectId) {
    this.assertOpen();const project=this.project(projectId);
    return {project,rosters:this.entries(projectId,'roster'),sources:this.entries(projectId,'source'),queries:this.entries(projectId,'query'),
      collections:this.entries(projectId,'collection'),
      editions:this.entries(projectId,'edition').map(({report,...value})=>({...value,counts:report.counts})),
      captures:this.database.prepare('SELECT payload FROM captures WHERE project_id=? ORDER BY id').all(projectId).map(parse)};
  }
  work(projectId,{editionId=null,status='',assignee='',query='',offset=0,limit=50,openOnly=false}={}) {
    this.assertOpen();this.project(projectId);
    need(Number.isInteger(offset)&&offset>=0 && Number.isInteger(limit)&&limit>=1&&limit<=200,'Use a valid work-table page.');
    let rows=editionId?editionRows(this.entry(projectId,'edition',editionId)):this.database.prepare('SELECT payload FROM work WHERE project_id=? ORDER BY position DESC,pair').all(projectId).map(parse);
    const summaries=new Map(this.database.prepare('SELECT * FROM latest_review WHERE project_id=?').all(projectId).map(value=>[value.pair,value]));
    const text=String(query).toLowerCase(),owner=String(assignee).toLowerCase();
    rows=rows.map(row=>{
      const last=summaries.get(row.pair),same=last?.fingerprint===row.fingerprint;
      return {...row,status:same?last.status:'needs-review',sourceChanged:Boolean(last&&!same),assignee:last?.assignee??'',reviewId:last?.id??null};
    }).filter(row=>(!status||row.status===status)&&(!openOnly||row.status!=='closed')&&(!owner||row.assignee.toLowerCase().includes(owner))&&
      (!text||[row.facility.id,row.facility.name,row.event.id,row.event.place].some(value=>String(value).toLowerCase().includes(text))));
    const counts=Object.fromEntries(['needs-review','assigned','investigating','action-recorded','closed'].map(kind=>[kind,rows.filter(row=>row.status===kind).length]));
    return {total:rows.length,offset,limit,counts,rows:rows.slice(offset,offset+limit).map(row=>{
      const decision=row.reviewId?this.entry(projectId,'review',row.reviewId):null;
      return {...row,review:decision,carriedFrom:decision&&decision.fingerprint===row.fingerprint&&decision.editionId!==row.editionId?decision.editionId:null};
    })};
  }
  allEditionWork(projectId,editionId) {
    const rows=editionId?editionRows(this.entry(projectId,'edition',editionId)):this.database.prepare('SELECT payload FROM work WHERE project_id=? ORDER BY position DESC,pair').all(projectId).map(parse),summaries=new Map(this.database.prepare('SELECT * FROM latest_review WHERE project_id=?').all(projectId).map(value=>[value.pair,value]));
    return rows.map(row=>{
      const last=summaries.get(row.pair),decision=last?this.entry(projectId,'review',last.id):null,same=decision?.fingerprint===row.fingerprint;
      return {...row,review:decision,status:same?decision.status:'needs-review',sourceChanged:Boolean(decision&&!same),assignee:decision?.assignee??''};
    });
  }
  compare(projectId,before,after) {return compareEditions(this.entry(projectId,'edition',before),this.entry(projectId,'edition',after));}
  capture(projectId,id) {const job=parse(this.database.prepare('SELECT payload FROM captures WHERE project_id=? AND id=?').get(projectId,id));need(job,'The original capture was not found.',404);return job;}
  createCapture(projectId,input,revision,operationId) {
    const plan=queryPlan(input);
    return this.transaction(projectId,{command:'capture',plan},revision,operationId,project=>{
      const job={id:uuid(),plan,createdAt:now(),updatedAt:now(),state:'prepared',observations:[],completed:[],sourceIds:[],
        pending:[plan.mode==='feed'?{id:'feed'}:{id:'window',starttime:plan.starttime,endtime:plan.endtime}],retryAt:null,error:null};
      this.database.prepare('INSERT INTO captures VALUES(?,?,?)').run(projectId,job.id,json(job));return {id:job.id,state:job.state};
    });
  }
  saveCapture(projectId,job) {
    need(!this.closed,'This workspace is closed.',503);job.updatedAt=now();
    this.database.prepare('UPDATE captures SET payload=? WHERE project_id=? AND id=?').run(json(job),projectId,job.id);return job;
  }
  retainObservation(projectId,job,observation,bytes) {
    this.assertOpen();this.database.exec('BEGIN IMMEDIATE');
    try {
      const bodySha256=this.putBlob(bytes);const saved={...observation,bodySha256,bytes:bytes.byteLength};
      job.observations.push(saved);this.saveCapture(projectId,job);this.database.exec('COMMIT');return saved;
    }catch(error){if(this.database.isTransaction)this.database.exec('ROLLBACK');throw error;}
  }
  completeSource(projectId,job,window,observation,counts=null) {
    this.assertOpen();const bytes=this.blob(observation.bodySha256);
    const source=sourceRecord(bytes,{name:job.plan.label+' — '+window.id+'.geojson',status:observation.status,url:observation.url,
      receivedAt:observation.receivedAt,headers:observation.headers,mode:job.plan.mode,captureId:job.id,plan:job.plan,window,...(counts?{counts}:{})});
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const project=this.project(projectId);this.addEntry(projectId,'source',source,project.revision+1);
      if(!job.sourceIds.includes(source.id))job.sourceIds.push(source.id);
      job.completed.push({window,sourceId:source.id});job.pending=job.pending.filter(item=>item.id!==window.id);
      this.saveCapture(projectId,job);project.revision++;project.updatedAt=now();
      this.database.prepare('UPDATE projects SET revision=?,payload=? WHERE id=?').run(project.revision,json(project),projectId);
      this.database.exec('COMMIT');return source;
    }catch(error){if(this.database.isTransaction)this.database.exec('ROLLBACK');throw error;}
  }
  async *exportProject(projectId) {
    this.assertOpen();
    const db=new DatabaseSync(join(this.directory,'facility-desk.sqlite'),{readOnly:true,timeout:5000});
    const digest=createHash('sha256');let byteCount=0,entryCount=0,blobCount=0,captureCount=0,archiveCount=0;
    const chunk=value=>{const bytes=typeof value==='string'?Buffer.from(value):value;digest.update(bytes);byteCount+=bytes.byteLength;return bytes;};
    try {
      db.exec('BEGIN');
      const project=parse(db.prepare('SELECT payload FROM projects WHERE id=?').get(projectId));need(project,'Project not found.',404);
      const entries=db.prepare('SELECT kind,id,position,payload FROM entries WHERE project_id=? ORDER BY position,kind,id').all(projectId);
      const collections=entries.filter(row=>row.kind==='collection').map(row=>JSON.parse(row.payload));
      yield chunk(json({type:'header',schema:collections.length?COLLECTION_TRANSFER_SCHEMA:TRANSFER_SCHEMA,project,exportedAt:now()})+'\n');
      const captures=db.prepare('SELECT payload FROM captures WHERE project_id=? ORDER BY id').all(projectId).map(parse);
      const blobs=new Set(entries.filter(row=>row.kind==='source').map(row=>JSON.parse(row.payload).bodySha256));
      for(const capture of captures)for(const observation of capture.observations)blobs.add(observation.bodySha256);
      for(const collection of collections)blobs.add(collection.manifestSha256);
      for(const sha of [...blobs].sort()) {
        const row=db.prepare('SELECT bytes FROM blobs WHERE sha=?').get(sha);need(row,'A retained source body is missing.');
        const bytes=Buffer.from(row.bytes);need(hash(bytes)===sha,'A retained source body changed.');
        yield chunk('{"type":"blob","sha256":'+json(sha)+',"bytes":'+bytes.byteLength+',"base64":"');
        // A multiple of three bytes preserves one exact base64 stream while avoiding a full encoded copy.
        for(let offset=0;offset<bytes.length;offset+=49152)yield chunk(bytes.subarray(offset,offset+49152).toString('base64'));
        yield chunk('"}\n');blobCount++;
      }
      const archives=new Map(collections.map(collection=>[collection.archiveSha256,collection]));
      for(const [sha,collection] of [...archives].sort(([a],[b])=>a.localeCompare(b))){
        for await(const part of collectionArchiveParts(this.directory,collection))yield chunk(json(part)+'\n');
        archiveCount++;
      }
      for(const entry of entries) {yield chunk('{"type":"entry","kind":'+json(entry.kind)+',"position":'+entry.position+',"value":'+entry.payload+'}\n');entryCount++;}
      for(const capture of captures) {yield chunk(json({type:'capture',value:capture})+'\n');captureCount++;}
      for(const row of db.prepare('SELECT operation_id,request_hash,payload FROM receipts WHERE project_id=? ORDER BY operation_id').all(projectId))
        yield chunk('{"type":"receipt","operationId":'+json(row.operation_id)+',"requestHash":'+json(row.request_hash)+',"value":'+row.payload+'}\n');
      yield Buffer.from(json({type:'complete',entries:entryCount,blobs:blobCount,captures:captureCount,
        ...(collections.length?{archives:archiveCount}:{}),bytes:byteCount,sha256:digest.digest('hex')})+'\n');
      db.exec('COMMIT');
    }finally {if(db.isTransaction)db.exec('ROLLBACK');db.close();}
  }
  async importProject(readable,operationId) {
    this.assertOpen();need(typeof operationId==='string' && /^[A-Za-z0-9._:-]{1,180}$/.test(operationId),'Supply the original import request identity.');this.importing=true;
    const db=this.database,digest=createHash('sha256'),lineReader=createInterface({input:readable,crlfDelay:Infinity});
    let header=null,final=null,byteCount=0,entryCount=0,blobCount=0,captureCount=0,newId=uuid(),archiveSink=null;
    const archives=new Map();
    const originalEntries=[],originalCaptures=[],originalReceipts=[];
    try {
      db.exec('BEGIN IMMEDIATE');
      for await(const line of lineReader) {
        need(!final,'The workspace transfer contains content after its completion record.');
        let value;try{value=JSON.parse(line);}catch{throw new TypeError('The workspace transfer contains an invalid JSON line.');}
        if(value.type==='complete') {need(!archiveSink,'The original collection archive is incomplete.');final=value;continue;}
        const raw=Buffer.from(line+'\n');digest.update(raw);byteCount+=raw.length;
        if(!header) {
          need(value.type==='header'&&[TRANSFER_SCHEMA,COLLECTION_TRANSFER_SCHEMA].includes(value.schema)&&plain(value.project),'Choose a complete facility workspace export.');
          header=value;projectSettings(header.project);
          need(typeof header.project.id==='string'&&Number.isSafeInteger(header.project.revision)&&header.project.revision>=0,'Invalid source project identity.');
          let receivedTitle=header.project.title;while(receivedTitle.length>189)receivedTitle=Array.from(receivedTitle).slice(0,-1).join('');
          const p={...header.project,id:newId,title:receivedTitle+' — received',importedFrom:{projectId:header.project.id,revision:header.project.revision},createdAt:now(),updatedAt:now()};
          db.prepare('INSERT INTO projects VALUES(?,?,?)').run(newId,p.revision,json(p));continue;
        }
        if(value.type==='collection-archive'){
          need(header.schema===COLLECTION_TRANSFER_SCHEMA&&!archiveSink&&!archives.has(value.sha256),
            'A full collection archive is duplicated or out of sequence.');
          archiveSink=await receiveArchiveParts(this.directory,value);continue;
        }
        if(value.type==='collection-part'){
          need(archiveSink,'A collection part has no original archive.');await archiveSink.write(value);continue;
        }
        if(value.type==='collection-end'){
          need(archiveSink,'The collection archive has not started.');
          const retained=await archiveSink.finish(value);
          archives.set(value.sha256,{archiveSha256:retained.archiveSha256,archiveBytes:retained.archiveBytes,
            manifestSha256:hash(retained.manifestBytes),manifestBytes:retained.manifestBytes.length});
          archiveSink=null;continue;
        }
        need(!archiveSink,'Finish the complete original collection before the next workspace item.');
        if(value.type==='blob') {
          need(typeof value.base64==='string' && value.base64.length<=Math.ceil(SOURCE_LIMIT/3)*4+4 && /^[A-Za-z0-9+/]*={0,2}$/.test(value.base64),'A source body exceeds its retained format or size.');
          const bytes=Buffer.from(value.base64,'base64');
          need(bytes.length===value.bytes&&hash(bytes)===value.sha256&&bytes.toString('base64')===value.base64,'A transferred source differs from its original bytes.');
          this.putBlob(bytes);blobCount++;
        } else if(value.type==='entry') {
          need(['roster','source','query','edition','review',...(header.schema===COLLECTION_TRANSFER_SCHEMA?['collection']:[])].includes(value.kind)&&plain(value.value)&&Number.isSafeInteger(value.position)&&value.position>=0,'Invalid saved workspace item.');
          need(value.value.id===identify(value.value).id,'A saved item differs from its content identity.');
          originalEntries.push(value);entryCount++;
        } else if(value.type==='capture') {need(plain(value.value)&&typeof value.value.id==='string','Invalid retained capture.');originalCaptures.push(value.value);captureCount++;}
        else if(value.type==='receipt') originalReceipts.push(value);
        else throw new TypeError('Unknown workspace transfer record: '+String(value.type));
      }
      need(header&&final,'The full workspace completion record is missing.');
      const sourceDigest=digest.digest('hex');
      need(final.sha256===sourceDigest&&final.bytes===byteCount&&final.entries===entryCount&&final.blobs===blobCount&&final.captures===captureCount&&
        (header.schema===TRANSFER_SCHEMA?archives.size===0:final.archives===archives.size),'The transfer does not match its complete manifest.');
      const collectionArchives=new Set(originalEntries.filter(entry=>entry.kind==='collection').map(entry=>entry.value.archiveSha256));
      need(collectionArchives.size===archives.size&&[...collectionArchives].every(sha=>archives.has(sha)),
        'The transferred collections differ from their complete original archives.');
      const duplicate=db.prepare('SELECT payload FROM receipts WHERE project_id=? AND operation_id=?').get('@import',operationId);
      if(duplicate){const saved=JSON.parse(duplicate.payload);need(saved.sourceSha256===sourceDigest,'The import request names a different source.',409);db.exec('ROLLBACK');return saved;}
      // Insert native dependencies first, then recompute every retained report and validate each attributed review against it.
      for(const kind of ['collection','roster','source','query','edition','review'])for(const item of originalEntries.filter(entry=>entry.kind===kind).sort((a,b)=>a.position-b.position||a.value.id.localeCompare(b.value.id))) {
        const value=item.value;
        if(kind==='collection'){
          const native=archives.get(value.archiveSha256),metadata=this.blob(value.manifestSha256);
          need(native&&native.archiveBytes===value.archiveBytes&&native.manifestBytes===metadata.length&&
            native.manifestSha256===hash(metadata),
            'The complete original buyer archive or manifest changed.');
          const checked=buyerCollection(metadata,value,value,value.receivedAt);
          need(canonical(checked)===canonical(value),'The original collection identity or receiving attribution changed.');
        }
        if(kind==='roster') {const checked=roster(value),{label,facilityInput,details}=value;need(canonical(checked)===canonical({label,facilityInput,details}),'The facility roster changed.');}
        if(kind==='source') {
          const bytes=this.blob(value.bodySha256);
          const checked=sourceRecord(bytes,value);need(canonical(checked)===canonical(value),'A source record differs from its retained response.');
          if(value.acquisition){const collection=this.entry(newId,'collection',value.acquisition.collectionId);
            validateBuyerSource(value,collection,this.blob(collection.manifestSha256));}
        }
        if(kind==='query') need(canonical(queryPlan(value.plan))===canonical(value.plan),'A saved source query changed.');
        if(kind==='edition') {
          const sites=this.entry(newId,'roster',value.rosterId),sources=value.sourceIds.map(id=>{const source=this.entry(newId,'source',id);return {source,bytes:this.blob(source.bodySha256)};});
          const recomputed=edition(value,sites,sources,value.createdAt);
          need(recomputed.reportSha256===value.reportSha256&&canonical(recomputed.report)===canonical(value.report),'A saved report differs from its original source and facility selection.');
        }
        if(kind==='review') {
          const original=this.entry(newId,'edition',value.editionId),row=editionRows(original).find(row=>row.pair===value.pair);
          const checked=review(value,row,value.createdAt);
          const {id,sequence,...expected}=value,{id:ignored,...actual}=checked;
          need(canonical(expected)===canonical(actual),'A review differs from its original event, facility or attribution.');
        }
        this.addEntry(newId,kind,value,item.position);
      }
      for(const original of originalCaptures) {
        queryPlan(original.plan);
        need(Array.isArray(original.observations)&&Array.isArray(original.pending)&&Array.isArray(original.completed)&&Array.isArray(original.sourceIds),'Invalid capture history.');
        for(const observation of original.observations) {const bytes=this.blob(observation.bodySha256);need(bytes.length===observation.bytes&&hash(bytes)===observation.bodySha256,'A captured HTTP response changed.');}
        for(const id of original.sourceIds)this.entry(newId,'source',id);
        const value={...original,...(original.state==='capturing'?{state:'interrupted',error:'The capture was received from another workspace.'}:{})};
        db.prepare('INSERT INTO captures VALUES(?,?,?)').run(newId,value.id,json(value));
      }
      const project=this.project(newId);
      if(project.currentRosterId)this.entry(newId,'roster',project.currentRosterId);
      if(project.selectedEditionId)this.entry(newId,'edition',project.selectedEditionId);
      project.importedFrom={projectId:header.project.id,revision:header.project.revision,sha256:sourceDigest,originalHeader:header,receipts:originalReceipts};
      db.prepare('UPDATE projects SET payload=? WHERE id=?').run(json(project),newId);
      const result={projectId:newId,revision:project.revision,sourceSha256:sourceDigest,entries:entryCount,blobs:blobCount,captures:captureCount,
        ...(header.schema===COLLECTION_TRANSFER_SCHEMA?{archives:archives.size}:{} )};
      db.prepare('INSERT INTO receipts VALUES(?,?,?,?)').run('@import',operationId,sourceDigest,json(result));
      db.exec('COMMIT');return result;
    }catch(error){if(db.isTransaction)db.exec('ROLLBACK');throw error;}
    finally {lineReader.close();try{if(archiveSink)await archiveSink.close();}finally{this.importing=false;}}
  }
  close() {
    if(this.closed)return;
    let failure;
    for(const action of [()=>this.database.exec('PRAGMA wal_checkpoint(TRUNCATE)'),()=>this.database.close(),()=>{if(this.lease.isTransaction)this.lease.exec('ROLLBACK');},()=>this.lease.close()]) {
      try{action();}catch(error){failure??=error;}
    }
    this.closed=true;if(failure)throw failure;
  }
}
export async function openFacilityStore(directory) {
  directory=resolve(directory);
  await mkdir(directory,{recursive:true,mode:0o700});
  const info=await lstat(directory);need(info.isDirectory()&&!info.isSymbolicLink(),'Use a regular customer workspace directory.');
  need(await realpath(directory)===directory,'Use the workspace’s real directory path.');
  await chmod(directory,0o700);
  const manifestPath=join(directory,'workspace.json');
  try {await writeFile(manifestPath,json({schema:DESK_SCHEMA,id:uuid(),createdAt:now()})+'\n',{flag:'wx',mode:0o600});}catch(error){if(error.code!=='EEXIST')throw error;}
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));need(manifest.schema===DESK_SCHEMA&&typeof manifest.id==='string','This directory belongs to another application.');
  let lease,database;
  try {
    lease=new DatabaseSync(join(directory,'runtime-lock.sqlite'),{timeout:1000});
    lease.exec('CREATE TABLE IF NOT EXISTS owner(id INTEGER PRIMARY KEY); BEGIN IMMEDIATE;');
    database=new DatabaseSync(join(directory,'facility-desk.sqlite'),{timeout:5000});
    const store=new FacilityStore(directory,database,lease,manifest);
    await chmod(join(directory,'facility-desk.sqlite'),0o600);await chmod(join(directory,'runtime-lock.sqlite'),0o600);
    return store;
  }catch(error){
    try{database?.close();}catch{}
    try{if(lease?.isTransaction)lease.exec('ROLLBACK');lease?.close();}catch{}
    if(/locked|busy/i.test(error.message))throw new Error('This customer workspace is already open. Use its original browser or close that process before reopening.');
    throw error;
  }
}
