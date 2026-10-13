import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { ObjectStore } from './objects.mjs';
import { requireValue, fail, clone, canonical, identity, sha, now, uuid, privateDirectory, id } from './common.mjs';

const SQL = [
'CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,value TEXT NOT NULL);',
'CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,head INTEGER NOT NULL);',
'CREATE TABLE IF NOT EXISTS versions(project_id TEXT NOT NULL,revision INTEGER NOT NULL,state_json TEXT NOT NULL,sha256 TEXT NOT NULL,parent_sha256 TEXT,PRIMARY KEY(project_id,revision));',
'CREATE TABLE IF NOT EXISTS requests(actor_id TEXT NOT NULL,request_id TEXT NOT NULL,project_id TEXT NOT NULL,input_sha256 TEXT NOT NULL,revision INTEGER NOT NULL,result_json TEXT NOT NULL,PRIMARY KEY(actor_id,request_id));',
'CREATE TABLE IF NOT EXISTS native_documents(project_id TEXT NOT NULL,document_id TEXT NOT NULL,epoch_id TEXT NOT NULL,document_name TEXT NOT NULL,sha256 TEXT NOT NULL,bytes INTEGER NOT NULL,vector_sha256 TEXT NOT NULL,vector_base64 TEXT NOT NULL,saved_at TEXT NOT NULL,sequence INTEGER NOT NULL,PRIMARY KEY(project_id,document_id,epoch_id),UNIQUE(document_name));',
'CREATE TABLE IF NOT EXISTS local_deployments(project_id TEXT PRIMARY KEY,state_json TEXT NOT NULL);',
'CREATE TABLE IF NOT EXISTS local_receiving(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,sha256 TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL);',
].join('\n');

export class Store {
  constructor(directory,{lease}={}){
    this.directory=privateDirectory(directory);this.lease=lease;
    this.objects=new ObjectStore(join(this.directory,'objects'));
    this.db=null;this.closed=false;
    try{
    this.db=new DatabaseSync(join(this.directory,'workspace.sqlite'),{timeout:5000});
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON;');
    this.db.exec(SQL);
    const schema=this.db.prepare('SELECT value FROM meta WHERE key=?').get('schema');
    requireValue(!schema||schema.value==='tjlabs.tiptap-workspace.v1','WORKSPACE_SCHEMA','This directory belongs to another workspace schema.',409);
    if(!schema)this.transaction(()=>{this.db.prepare('INSERT INTO meta VALUES(?,?)').run('schema','tjlabs.tiptap-workspace.v1');this.db.prepare('INSERT INTO meta VALUES(?,?)').run('instance_id',uuid('instance'));});
    this.instanceId=this.db.prepare('SELECT value FROM meta WHERE key=?').get('instance_id').value;
    }catch(error){
      try{this.close();}catch(cleanupError){
        error.store=this;error.closeFailedStore=()=>this.close();error.cleanupError=cleanupError;
      }
      throw error;
    }
  }
  assert(){this.lease?.assert();}
  transaction(fn){
    this.assert();if(this.db.isTransaction)return fn();
    this.db.exec('BEGIN IMMEDIATE');
    try{const result=fn();requireValue(!result||typeof result.then!=='function','ASYNC_TRANSACTION','A native SQLite commit cannot await another operation.',500);this.assert();this.db.exec('COMMIT');return result;}
    catch(error){try{this.db.exec('ROLLBACK');}catch{}throw error;}
  }
  exists(projectId){return !!this.db.prepare('SELECT id FROM projects WHERE id=?').get(projectId);}
  head(projectId){const row=this.db.prepare('SELECT head FROM projects WHERE id=?').get(projectId);requireValue(row,'PROJECT_NOT_FOUND','Project was not found.',404);return Number(row.head);}
  get(projectId,revision){
    id(projectId,'projectId');const selected=revision??this.head(projectId);
    const row=this.db.prepare('SELECT state_json,sha256 FROM versions WHERE project_id=? AND revision=?').get(projectId,selected);
    requireValue(row,'REVISION_NOT_FOUND','The selected original project revision does not exist.',404);
    requireValue(sha(Buffer.from(row.state_json))===row.sha256,'PROJECT_IDENTITY_CHANGED','The retained project revision failed its identity.',409);
    return JSON.parse(row.state_json);
  }
  list(){return this.db.prepare('SELECT id,head FROM projects ORDER BY id').all().map(r=>this.get(r.id,Number(r.head)));}
  versionRows(projectId,revision=this.head(projectId)){return this.db.prepare('SELECT * FROM versions WHERE project_id=? AND revision<=? ORDER BY revision').all(projectId,revision);}
  requestReceipt(actorId,requestId){
    this.assert();id(actorId,'actorId');id(requestId,'requestId');
    const row=this.db.prepare('SELECT * FROM requests WHERE actor_id=? AND request_id=?').get(actorId,requestId);
    requireValue(row,'REQUEST_NOT_FOUND','This actor has no retained completion for the selected original request.',404);
    return {schema:'tjlabs.tiptap-request-receipt.v1',instanceId:this.instanceId,actorId,requestId,
      inputSha256:row.input_sha256,projectId:row.project_id,revision:Number(row.revision),
      response:{view:this.get(row.project_id,Number(row.revision)),result:JSON.parse(row.result_json),
        replayed:true,currentRevision:this.head(row.project_id)}};
  }
  request(actorId,requestId,input){
    const row=this.db.prepare('SELECT * FROM requests WHERE actor_id=? AND request_id=?').get(actorId,requestId);
    if(!row)return null;
    requireValue(row.input_sha256===identity(input),'REQUEST_ID_REUSED','This request ID already belongs to different original input.',409);
    return {view:this.get(row.project_id,Number(row.revision)),result:JSON.parse(row.result_json),replayed:true,currentRevision:this.head(row.project_id)};
  }
  create(actor,input){
    id(input.requestId,'requestId');const bound={action:'project.create',...input};
    return this.transaction(()=>{
      const previous=this.request(actor.id,input.requestId,bound);if(previous)return previous;
      const projectId='project_'+identity({actorId:actor.id,requestId:input.requestId}).slice(0,32);
      requireValue(!this.exists(projectId),'PROJECT_EXISTS','The original project ID is already in use.',409);
      const at=now(),state={id:projectId,title:input.title,notes:input.notes??'',revision:0,createdAt:at,updatedAt:at,settings:{namespace:projectId,defaultField:'default',sessionTtlSeconds:300},sources:[],tenants:[],grants:[],editions:[],migrations:[],documents:[],deployments:[],checkpoints:[],jobs:[],handoffs:[],reviews:[],history:[],currentEditionId:null,activeDeploymentId:null};
      state.history.push({id:uuid('event'),revision:0,type:'project.create',actorId:actor.id,createdAt:at,summary:'Created project',data:{title:state.title}});
      this.insertVersion(state,null);
      this.db.prepare('INSERT INTO projects VALUES(?,?)').run(projectId,0);
      const result={projectId};this.saveRequest(actor.id,input.requestId,projectId,bound,0,result);
      return {view:state,result,replayed:false,currentRevision:0};
    });
  }
  insertVersion(state,parent){
    const encoded=canonical(state),hash=sha(Buffer.from(encoded));
    this.db.prepare('INSERT INTO versions VALUES(?,?,?,?,?)').run(state.id,state.revision,encoded,hash,parent);
    return hash;
  }
  saveRequest(actorId,requestId,projectId,input,revision,result){
    this.db.prepare('INSERT INTO requests VALUES(?,?,?,?,?,?)').run(actorId,requestId,projectId,identity(input),revision,canonical(result??null));
  }
  commit(actor,input,mutate){
    id(input.requestId,'requestId');id(input.projectId,'projectId');
    return this.transaction(()=>{
      const previous=this.request(actor.id,input.requestId,input);if(previous)return previous;
      const current=this.get(input.projectId);
      requireValue(input.expectedRevision===current.revision,'REVISION_CONFLICT','The project changed. Reconcile the original request before editing the current revision.',409,{expectedRevision:input.expectedRevision,currentRevision:current.revision});
      const state=clone(current);this.refreshNative(state);
      const result=mutate(state)??null;
      const at=now();state.revision=current.revision+1;state.updatedAt=at;
      state.history.push({id:uuid('event'),revision:state.revision,type:input.action,actorId:actor.id,createdAt:at,summary:input.action,data:{requestId:input.requestId,result:clone(result)}});
      const parent=this.db.prepare('SELECT sha256 FROM versions WHERE project_id=? AND revision=?').get(state.id,current.revision).sha256;
      this.insertVersion(state,parent);this.db.prepare('UPDATE projects SET head=? WHERE id=?').run(state.revision,state.id);
      this.saveRequest(actor.id,input.requestId,state.id,input,state.revision,result);
      return {view:state,result,replayed:false,currentRevision:state.revision};
    });
  }
  internal(projectId,key,action,mutate){
    const actor={id:'native-runtime'},requestId=id(key,'native requestId');
    const saved=this.db.prepare('SELECT * FROM requests WHERE actor_id=? AND request_id=?').get(actor.id,requestId);
    if(saved)return {view:this.get(saved.project_id,Number(saved.revision)),result:JSON.parse(saved.result_json),replayed:true,currentRevision:this.head(saved.project_id)};
    return this.commit(actor,{projectId,expectedRevision:this.head(projectId),requestId,action,payload:{}},mutate);
  }
  refreshNative(state){
    for(const document of state.documents){
      const receipt=this.nativeReceipt(state.id,document.id,document.epochId);
      if(receipt){document.persisted=receipt;document.updatedAt=receipt.savedAt;}
    }
    return state;
  }
  nativeRow(projectId,documentId,epochId){
    return this.db.prepare('SELECT * FROM native_documents WHERE project_id=? AND document_id=? AND epoch_id=?').get(projectId,documentId,epochId)??null;
  }
  nativeReceipt(projectId,documentId,epochId){
    const r=this.nativeRow(projectId,documentId,epochId);
    return r?{sha256:r.sha256,bytes:Number(r.bytes),stateVectorBase64:r.vector_base64,stateVectorSha256:r.vector_sha256,savedAt:r.saved_at,sequence:Number(r.sequence)}:null;
  }
  nativeByName(documentName){return this.db.prepare('SELECT * FROM native_documents WHERE document_name=?').get(documentName)??null;}
  nativeData(documentName){const row=this.nativeByName(documentName);return row?this.objects.read(row.sha256,Number(row.bytes)):null;}
  writeNative({projectId,documentId,epochId,documentName,bytes,vector,allowInactive=false}){
    const original=this.objects.put(bytes),sv=Buffer.from(vector);
    return this.transaction(()=>{
      if(!allowInactive){
        const project=this.get(projectId),doc=project.documents.find(d=>d.id===documentId);
        requireValue(doc&&doc.epochId===epochId&&doc.documentName===documentName,'DOCUMENT_EPOCH_CHANGED','The original document epoch is no longer active.',409);
      }
      const old=this.nativeRow(projectId,documentId,epochId);
      if(old&&old.sha256===original.sha256&&old.vector_sha256===sha(sv))return this.nativeReceipt(projectId,documentId,epochId);
      const at=now(),sequence=old?Number(old.sequence)+1:1;
      this.db.prepare('INSERT INTO native_documents VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,document_id,epoch_id) DO UPDATE SET sha256=excluded.sha256,bytes=excluded.bytes,vector_sha256=excluded.vector_sha256,vector_base64=excluded.vector_base64,saved_at=excluded.saved_at,sequence=excluded.sequence').run(projectId,documentId,epochId,documentName,original.sha256,original.bytes,sha(sv),sv.toString('base64'),at,sequence);
      return this.nativeReceipt(projectId,documentId,epochId);
    });
  }
  restoreNativeRow(row){
    this.objects.read(row.sha256,Number(row.bytes));
    const old=this.nativeRow(row.project_id,row.document_id,row.epoch_id);
    if(old&&old.sequence===row.sequence)requireValue(old.sha256===row.sha256,'NATIVE_HISTORY_CONFLICT','The same native sequence has different retained bytes.',409);
    this.db.prepare('INSERT INTO native_documents VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,document_id,epoch_id) DO UPDATE SET document_name=excluded.document_name,sha256=excluded.sha256,bytes=excluded.bytes,vector_sha256=excluded.vector_sha256,vector_base64=excluded.vector_base64,saved_at=excluded.saved_at,sequence=excluded.sequence').run(row.project_id,row.document_id,row.epoch_id,row.document_name,row.sha256,Number(row.bytes),row.vector_sha256,row.vector_base64,row.saved_at,Number(row.sequence));
  }
  local(projectId){const r=this.db.prepare('SELECT state_json FROM local_deployments WHERE project_id=?').get(projectId);return r?JSON.parse(r.state_json):null;}
  setLocal(projectId,value){this.transaction(()=>this.db.prepare('INSERT INTO local_deployments VALUES(?,?) ON CONFLICT(project_id) DO UPDATE SET state_json=excluded.state_json').run(projectId,canonical(value)));}
  requestsFor(projectId,revision){return this.db.prepare('SELECT * FROM requests WHERE project_id=? AND revision<=? ORDER BY revision,actor_id,request_id').all(projectId,revision);}
  close(){
    if(this.closed)return;
    if(this.db){this.db.close();this.db=null;}
    this.closed=true;
  }
}
