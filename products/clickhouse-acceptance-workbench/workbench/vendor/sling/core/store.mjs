import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { ObjectStore } from './objects.mjs';
import { requireValue, clone, canonical, identity, sha, now, uuid, privateDirectory, id } from './common.mjs';

const SQL = [
'CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);',
'CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,head INTEGER NOT NULL);',
'CREATE TABLE IF NOT EXISTS versions(project_id TEXT NOT NULL,revision INTEGER NOT NULL,state_json TEXT NOT NULL,sha256 TEXT NOT NULL,parent_sha256 TEXT,PRIMARY KEY(project_id,revision));',
'CREATE TABLE IF NOT EXISTS requests(actor_id TEXT NOT NULL,request_id TEXT NOT NULL,project_id TEXT NOT NULL,input_sha256 TEXT NOT NULL,revision INTEGER NOT NULL,result_json TEXT NOT NULL,PRIMARY KEY(actor_id,request_id));',
'CREATE TABLE IF NOT EXISTS local_jobs(job_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,binding_json TEXT NOT NULL);',
'CREATE TABLE IF NOT EXISTS local_receiving(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,sha256 TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL);',
'CREATE TABLE IF NOT EXISTS handoffs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,revision INTEGER NOT NULL,record_json TEXT NOT NULL);',
'CREATE TABLE IF NOT EXISTS local_downstream(operation_id TEXT PRIMARY KEY,project_id TEXT NOT NULL,binding_json TEXT NOT NULL);'
].join('\n');

export class Store {
  constructor(directory,{lease}={}) {
    this.directory=privateDirectory(directory);this.lease=lease;
    this.objects=new ObjectStore(join(this.directory,'objects'));
    this.db=new DatabaseSync(join(this.directory,'workspace.sqlite'),{timeout:5000});
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');this.db.exec(SQL);
    const row=this.db.prepare('SELECT value FROM meta WHERE key=?').get('schema');
    requireValue(!row||row.value==='tjlabs.sling-workspace.v1','WORKSPACE_SCHEMA','This is not the selected Sling migration workspace.',409);
    if(!row)this.transaction(()=>{this.db.prepare('INSERT INTO meta VALUES(?,?)').run('schema','tjlabs.sling-workspace.v1');this.db.prepare('INSERT INTO meta VALUES(?,?)').run('instance_id',uuid('instance'));});
    this.instanceId=this.db.prepare('SELECT value FROM meta WHERE key=?').get('instance_id').value;
  }
  assert(){this.lease?.assert();}
  transaction(fn){
    this.assert();if(this.db.isTransaction)return fn();this.db.exec('BEGIN IMMEDIATE');
    try{const v=fn();requireValue(!v||typeof v.then!=='function','ASYNC_TRANSACTION','SQLite transactions cannot await external work.',500);this.assert();this.db.exec('COMMIT');return v;}
    catch(e){try{this.db.exec('ROLLBACK');}catch{}throw e;}
  }
  exists(projectId){return !!this.db.prepare('SELECT id FROM projects WHERE id=?').get(projectId);}
  head(projectId){const r=this.db.prepare('SELECT head FROM projects WHERE id=?').get(id(projectId));requireValue(r,'PROJECT_NOT_FOUND','The selected project does not exist.',404);return Number(r.head);}
  get(projectId,revision){
    const selected=revision??this.head(projectId),r=this.db.prepare('SELECT state_json,sha256 FROM versions WHERE project_id=? AND revision=?').get(id(projectId),selected);
    requireValue(r,'REVISION_NOT_FOUND','The original project revision is not retained.',404);
    requireValue(sha(Buffer.from(r.state_json))===r.sha256,'PROJECT_IDENTITY_CHANGED','The retained project revision failed its original hash.',409);return JSON.parse(r.state_json);
  }
  list(){return this.db.prepare('SELECT id,head FROM projects ORDER BY id').all().map(r=>this.get(r.id,Number(r.head)));}
  versions(projectId,revision=this.head(projectId)){return this.db.prepare('SELECT * FROM versions WHERE project_id=? AND revision<=? ORDER BY revision').all(projectId,revision);}
  requests(projectId,revision=this.head(projectId)){return this.db.prepare('SELECT * FROM requests WHERE project_id=? AND revision<=? ORDER BY revision,actor_id,request_id').all(projectId,revision);}
  request(actorId,requestId,input){
    const r=this.db.prepare('SELECT * FROM requests WHERE actor_id=? AND request_id=?').get(id(actorId),id(requestId));if(!r)return null;
    requireValue(r.input_sha256===identity(input),'REQUEST_ID_REUSED','This original request ID already names different input.',409);
    return {view:this.get(r.project_id,Number(r.revision)),result:JSON.parse(r.result_json),replayed:true,currentRevision:this.head(r.project_id)};
  }
  insertVersion(state,parent){
    const encoded=canonical(state),hash=sha(Buffer.from(encoded));
    this.db.prepare('INSERT INTO versions VALUES(?,?,?,?,?)').run(state.id,state.revision,encoded,hash,parent);return hash;
  }
  saveRequest(actorId,requestId,projectId,input,revision,result){this.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?)').run(actorId,requestId,projectId,identity(input),revision,canonical(result??null));}
  create(actor,input){
    id(input.requestId,'requestId');const bound={action:'project.create',...input};
    return this.transaction(()=>{
      const replay=this.request(actor.id,input.requestId,bound);if(replay)return replay;
      const projectId='project_'+identity({actorId:actor.id,requestId:input.requestId}).slice(0,32);requireValue(!this.exists(projectId),'PROJECT_EXISTS','The original project ID is already retained.',409);
      const at=now(),state={id:projectId,title:input.title,notes:input.notes??'',revision:0,createdAt:at,updatedAt:at,sources:[],plans:[],jobs:[],comparisons:[],cutovers:[],downstreamPlans:[],downstreamOperations:[],handoffs:[],reviews:[],history:[],currentPlanId:null,currentCutoverId:null,runtime:null};
      state.history.push({id:uuid('event'),revision:0,type:'project.create',actorId:actor.id,createdAt:at,data:{title:state.title}});
      this.insertVersion(state,null);this.db.prepare('INSERT INTO projects VALUES(?,?)').run(projectId,0);const result={projectId};
      this.saveRequest(actor.id,input.requestId,projectId,bound,0,result);return{view:state,result,replayed:false,currentRevision:0};
    });
  }
  commit(actor,input,mutate){
    id(input.requestId,'requestId');id(input.projectId,'projectId');
    return this.transaction(()=>{
      const replay=this.request(actor.id,input.requestId,input);if(replay)return replay;
      const current=this.get(input.projectId);requireValue(input.expectedRevision===current.revision,'REVISION_CONFLICT','The project changed. Reconcile the original request before saving the current edition.',409,{expectedRevision:input.expectedRevision,currentRevision:current.revision});
      const state=clone(current),result=mutate(state)??null,at=now();state.revision=current.revision+1;state.updatedAt=at;
      state.history.push({id:uuid('event'),revision:state.revision,type:input.action,actorId:actor.id,createdAt:at,data:{requestId:input.requestId,result:clone(result)}});
      const parent=this.db.prepare('SELECT sha256 FROM versions WHERE project_id=? AND revision=?').get(state.id,current.revision).sha256;
      this.insertVersion(state,parent);this.db.prepare('UPDATE projects SET head=? WHERE id=?').run(state.revision,state.id);
      this.saveRequest(actor.id,input.requestId,state.id,input,state.revision,result);return{view:state,result,replayed:false,currentRevision:state.revision};
    });
  }
  internal(projectId,key,action,mutate){
    const actor={id:'native-runtime'},requestId=id(key,'requestId');
    const saved=this.db.prepare('SELECT * FROM requests WHERE actor_id=? AND request_id=?').get(actor.id,requestId);
    if(saved)return{view:this.get(saved.project_id,Number(saved.revision)),result:JSON.parse(saved.result_json),replayed:true,currentRevision:this.head(saved.project_id)};
    return this.commit(actor,{projectId,expectedRevision:this.head(projectId),requestId,action,payload:{}},mutate);
  }
  binding(jobId){const r=this.db.prepare('SELECT binding_json FROM local_jobs WHERE job_id=?').get(id(jobId));return r?JSON.parse(r.binding_json):null;}
  setBinding(projectId,jobId,value){this.transaction(()=>this.db.prepare('INSERT INTO local_jobs VALUES(?,?,?) ON CONFLICT(job_id) DO UPDATE SET project_id=excluded.project_id,binding_json=excluded.binding_json').run(jobId,projectId,canonical(value)));}
  bindings(projectId){return this.db.prepare('SELECT job_id,binding_json FROM local_jobs WHERE project_id=? ORDER BY job_id').all(projectId).map(r=>({jobId:r.job_id,...JSON.parse(r.binding_json)}));}
  handoff(handoffId){const r=this.db.prepare('SELECT record_json FROM handoffs WHERE id=?').get(id(handoffId));return r?JSON.parse(r.record_json):null;}
  handoffs(projectId,revision=this.head(projectId)){return this.db.prepare('SELECT record_json FROM handoffs WHERE project_id=? AND revision<=? ORDER BY id').all(projectId,revision).map(r=>JSON.parse(r.record_json));}
  saveHandoff(record){
    return this.transaction(()=>{const old=this.handoff(record.id);if(old){requireValue(canonical(old)===canonical(record),'HANDOFF_IDENTITY_CHANGED','The original sealed handoff has different bytes or metadata.',409);return old;}
      this.db.prepare('INSERT INTO handoffs VALUES(?,?,?,?)').run(record.id,record.projectId,record.revision,canonical(record));return record;});
  }
  downstreamBinding(operationId){const r=this.db.prepare('SELECT binding_json FROM local_downstream WHERE operation_id=?').get(id(operationId));return r?JSON.parse(r.binding_json):null;}
  setDownstreamBinding(projectId,operationId,value){this.transaction(()=>this.db.prepare('INSERT INTO local_downstream VALUES(?,?,?) ON CONFLICT(operation_id) DO UPDATE SET project_id=excluded.project_id,binding_json=excluded.binding_json').run(operationId,projectId,canonical(value)));}
  downstreamBindings(projectId){return this.db.prepare('SELECT operation_id,binding_json FROM local_downstream WHERE project_id=? ORDER BY operation_id').all(projectId).map(r=>({operationId:r.operation_id,...JSON.parse(r.binding_json)}));}
  close(){this.db.close();}
}
