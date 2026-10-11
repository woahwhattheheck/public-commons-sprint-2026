// MIT. One durable operator workspace around the released Midland preflight.
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {createReadStream,readFileSync,readlinkSync} from 'node:fs';
import {mkdir,readFile,stat} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createInterface} from 'node:readline';
import {run as preflight} from '../preflight.mjs';
import {RFP} from '../spec.mjs';
import {CLASSES,ARTIFACT_ROLES,MILESTONES,ROLES,defaultDictionary,compileDictionary,
  canonical,digest,fault,text,stableRecordKey} from './contract.mjs';
import {retainFile,retainStream,readObject,objectPath,DEFAULT_LIMIT,fileLabel,hashFile} from './files.mjs';

const now=()=>new Date().toISOString(),id=prefix=>prefix+'-'+randomUUID();
const json=value=>JSON.stringify(value),parse=value=>value?JSON.parse(value):null;
const actions=['ASSIGNED','CORRECTION_REQUESTED','ACCEPTED_EXCEPTION','REOPENED','NOTE'];
const heuristic=new Set(['AREA_BALANCE_REVIEW','PERCENT_REVIEW','DUPLICATE_PARCEL_ID']);
const unpack=row=>row?Object.fromEntries(Object.entries(row).map(([k,v])=>[k,['selection','body','reports','payload','progress','context','contract_body'].includes(k)?parse(v):v])):null;
const integer=(v,label,max)=>{if(!Number.isSafeInteger(v)||v<0||v>max)throw fault(422,'Invalid '+label+'.');return v;};
const rowDigest=(row,raw)=>raw===undefined?digest(row):digest({invalid_ndjson:raw});
const processStart=pid=>{
  try{return readFileSync('/proc/'+pid+'/stat','utf8').split(') ').slice(1).join(') ').split(' ')[19];}
  catch{return null;}
};
const workerIdentity=()=>{
  try{return {boot:readFileSync('/proc/sys/kernel/random/boot_id','utf8').trim(),namespace:readlinkSync('/proc/self/ns/pid'),start:processStart(process.pid)};}
  catch{return null;}
};

export class Workspace{
  static async open(directory,options={}){
    const root=resolve(directory);await mkdir(root,{recursive:true,mode:0o700});
    for(const child of ['objects','staging','exports'])await mkdir(join(root,child),{recursive:true,mode:0o700});
    return new Workspace(root,options);
  }
  constructor(root,{uploadLimit=DEFAULT_LIMIT}={}){
    this.root=root;this.uploadLimit=uploadLimit;this.active=new Map();this.closed=false;
    this.db=new DatabaseSync(join(root,'workspace.sqlite'));
    this.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
    this.db.exec([
      "CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY,title TEXT NOT NULL,owner TEXT NOT NULL,revision INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,selection TEXT NOT NULL,dictionary_id TEXT)",
      "CREATE TABLE IF NOT EXISTS dictionaries(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),label TEXT NOT NULL,sha256 TEXT NOT NULL,body TEXT NOT NULL,source_ref TEXT NOT NULL,approval TEXT NOT NULL,approver TEXT NOT NULL,approval_date TEXT NOT NULL,approval_ref TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS uploads(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),filename TEXT NOT NULL,sha256 TEXT NOT NULL,size INTEGER NOT NULL,created_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS sources(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),feature_class TEXT NOT NULL,label TEXT NOT NULL,metadata_sha TEXT NOT NULL,rows_sha TEXT NOT NULL,metadata_size INTEGER NOT NULL,rows_size INTEGER NOT NULL,metadata_name TEXT NOT NULL,rows_name TEXT NOT NULL,sample INTEGER NOT NULL,parent_id TEXT,source_ref TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),role TEXT NOT NULL,label TEXT NOT NULL,filename TEXT NOT NULL,sha256 TEXT NOT NULL,size INTEGER NOT NULL,source_ref TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),status TEXT NOT NULL,selection TEXT NOT NULL,dictionary_id TEXT,contract_sha TEXT NOT NULL,reports TEXT NOT NULL,progress TEXT NOT NULL,owner_pid INTEGER NOT NULL,parent_run_id TEXT,error TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,completed_at TEXT)",
      "CREATE UNIQUE INDEX IF NOT EXISTS one_running ON runs(project_id) WHERE status='RUNNING'",
      "CREATE TABLE IF NOT EXISTS records(run_id TEXT NOT NULL REFERENCES runs(id),source_id TEXT NOT NULL,line INTEGER NOT NULL,record_key TEXT NOT NULL,row_sha TEXT NOT NULL,PRIMARY KEY(run_id,source_id,line))",
      "CREATE TABLE IF NOT EXISTS findings(id TEXT PRIMARY KEY,project_id TEXT NOT NULL,run_id TEXT NOT NULL REFERENCES runs(id),source_id TEXT NOT NULL,feature_class TEXT NOT NULL,scope TEXT NOT NULL,line INTEGER NOT NULL,record_key TEXT NOT NULL,row_sha TEXT NOT NULL,code TEXT NOT NULL,location TEXT NOT NULL,detail TEXT NOT NULL,rule_origin TEXT NOT NULL,fingerprint TEXT NOT NULL)",
      "CREATE INDEX IF NOT EXISTS finding_run ON findings(run_id,source_id,line)",
      "CREATE INDEX IF NOT EXISTS finding_fingerprint ON findings(project_id,fingerprint,run_id)",
      "CREATE TABLE IF NOT EXISTS decisions(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,project_id TEXT NOT NULL,finding_id TEXT NOT NULL REFERENCES findings(id),action TEXT NOT NULL,owner TEXT NOT NULL,note TEXT NOT NULL,source_ref TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL)",
      "CREATE INDEX IF NOT EXISTS decision_finding ON decisions(finding_id,seq)",
      "CREATE TABLE IF NOT EXISTS milestones(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),milestone TEXT NOT NULL,status TEXT NOT NULL,owner TEXT NOT NULL,due_date TEXT NOT NULL,note TEXT NOT NULL,source_ref TEXT NOT NULL,artifact_id TEXT,actor TEXT NOT NULL,created_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS releases(id TEXT PRIMARY KEY,project_id TEXT NOT NULL REFERENCES projects(id),run_id TEXT NOT NULL REFERENCES runs(id),label TEXT NOT NULL,reviewer TEXT NOT NULL,note TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL)",
      "CREATE TABLE IF NOT EXISTS events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,project_id TEXT NOT NULL REFERENCES projects(id),revision INTEGER NOT NULL,kind TEXT NOT NULL,actor TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL)"
    ].join(';'));
    if(!this.db.prepare('PRAGMA table_info(runs)').all().some(c=>c.name==='worker_identity'))
      this.db.exec('ALTER TABLE runs ADD COLUMN worker_identity TEXT');
    if(!this.db.prepare('PRAGMA table_info(runs)').all().some(c=>c.name==='contract_body'))
      this.db.exec('ALTER TABLE runs ADD COLUMN contract_body TEXT');
    this.identity=workerIdentity();
    this.recoverDeadRuns();
  }
  project(projectId){
    const p=unpack(this.db.prepare('SELECT * FROM projects WHERE id=?').get(projectId));
    if(!p)throw fault(404,'Project not found.');return p;
  }
  list(){return this.db.prepare('SELECT id,title,owner,revision,updated_at FROM projects ORDER BY updated_at DESC').all();}
  event(project,revision,kind,actor,payload){
    this.db.prepare('INSERT INTO events(id,project_id,revision,kind,actor,payload,created_at) VALUES(?,?,?,?,?,?,?)')
      .run(id('event'),project,revision,kind,actor,json(payload),now());
  }
  change(projectId,expected,actor,kind,payload,mutate){
    text(actor,'the operator name',200);
    this.db.exec('BEGIN IMMEDIATE');
    try{
      const p=this.project(projectId);
      if(p.revision!==expected)throw fault(409,'The project changed. Reload its current version before saving.');
      const result=mutate(p);
      this.db.prepare('UPDATE projects SET revision=revision+1,updated_at=? WHERE id=?').run(now(),projectId);
      this.event(projectId,p.revision+1,kind,actor,payload);this.db.exec('COMMIT');return result;
    }catch(e){this.db.exec('ROLLBACK');throw e;}
  }
  create({title,owner}){
    const projectId=id('project'),time=now();title=text(title,'a project name');owner=text(owner,'the operator name',200);
    this.db.exec('BEGIN IMMEDIATE');
    try{
      this.db.prepare('INSERT INTO projects VALUES(?,?,?,?,?,?,?,?)').run(projectId,title,owner,1,time,time,'{}',null);
      this.event(projectId,1,'CREATE',owner,{title});this.db.exec('COMMIT');
    }catch(e){this.db.exec('ROLLBACK');throw e;}
    return this.state(projectId);
  }
  async upload(projectId,filename,stream,{signal}={}){
    this.project(projectId);fileLabel(filename);
    const retained=await retainStream(this.root,stream,{limit:this.uploadLimit,signal});
    const upload={id:id('upload'),project_id:projectId,filename,sha256:retained.sha256,size:retained.size,created_at:now()};
    this.db.prepare('INSERT INTO uploads VALUES(?,?,?,?,?,?)').run(...Object.values(upload));return upload;
  }
  async uploadFile(projectId,path){return this.upload(projectId,fileLabel(path.replace(/\\/g,'/').split('/').pop()),createReadStream(path));}
  getUpload(projectId,uploadId){
    const u=this.db.prepare('SELECT * FROM uploads WHERE id=? AND project_id=?').get(uploadId,projectId);
    if(!u)throw fault(404,'Retained upload not found in this project.');return u;
  }
  async addSource(projectId,input){
    const meta=this.getUpload(projectId,input.metadata_upload),rows=this.getUpload(projectId,input.rows_upload);
    let metadata;try{metadata=JSON.parse((await readObject(this.root,meta.sha256)).toString('utf8'));}catch(e){if(e.status)throw e;throw fault(422,'The metadata file must contain a JSON object.');}
    if(!metadata||!CLASSES.includes(metadata.feature_class)||!Array.isArray(metadata.fields))throw fault(422,'Select original metadata for one of the four RFP feature classes.');
    if(typeof input.sample!=='boolean')throw fault(422,'Choose representative sample or full-population review.');
    const source={id:id('source'),project_id:projectId,feature_class:metadata.feature_class,label:text(input.label,'a source version label'),
      metadata_sha:meta.sha256,rows_sha:rows.sha256,metadata_size:meta.size,rows_size:rows.size,
      metadata_name:meta.filename,rows_name:rows.filename,sample:input.sample?1:0,parent_id:input.parent_id||null,
      source_ref:text(input.source_ref??'','the original source reference',4000,false),actor:text(input.actor,'the operator name',200),created_at:now()};
    const native=input.native_artifacts??[];
    if(!Array.isArray(native)||native.length>4)throw fault(422,'Choose up to four original source-context files.');
    const artifacts=native.map(item=>{
      const u=this.getUpload(projectId,item.upload_id);
      return {id:id('artifact'),project_id:projectId,role:'source_gis_context',label:text(item.label,'a source context label'),
        filename:u.filename,sha256:u.sha256,size:u.size,source_ref:source.source_ref,actor:source.actor,created_at:source.created_at};
    });
    this.change(projectId,input.expected,source.actor,'IMPORT_SOURCE',{source_id:source.id,parent_id:source.parent_id},p=>{
      if(source.parent_id){
        const prior=this.db.prepare('SELECT * FROM sources WHERE id=? AND project_id=?').get(source.parent_id,projectId);
        if(!prior||prior.feature_class!==source.feature_class)throw fault(422,'The prior version must be the same feature class in this project.');
      }
      this.db.prepare('INSERT INTO sources VALUES('+Array(15).fill('?').join(',')+')').run(...Object.values(source));
      for(const artifact of artifacts)this.db.prepare('INSERT INTO artifacts VALUES('+Array(10).fill('?').join(',')+')').run(...Object.values(artifact));
      p.selection[source.feature_class]=source.id;
      this.db.prepare('UPDATE projects SET selection=? WHERE id=?').run(json(p.selection),projectId);
    });
    return {source,state:this.state(projectId)};
  }
  selectSources(projectId,input){
    const selection=input.selection;
    if(!selection||typeof selection!=='object'||Array.isArray(selection)||!Object.keys(selection).length)
      throw fault(422,'Select at least one retained feature-class source.');
    this.change(projectId,input.expected,input.actor,'SELECT_SOURCES',{selection},()=>{
      for(const [featureClass,sourceId] of Object.entries(selection)){
        const s=this.db.prepare('SELECT * FROM sources WHERE id=? AND project_id=?').get(sourceId,projectId);
        if(!CLASSES.includes(featureClass)||s?.feature_class!==featureClass)throw fault(422,'Select a retained version of the named feature class.');
      }
      this.db.prepare('UPDATE projects SET selection=? WHERE id=?').run(json(selection),projectId);
    });return this.state(projectId);
  }
  addArtifact(projectId,input){
    const u=this.getUpload(projectId,input.upload_id);
    if(!ARTIFACT_ROLES.includes(input.role))throw fault(422,'Choose a delivery or source-document role.');
    const artifact={id:id('artifact'),project_id:projectId,role:input.role,label:text(input.label,'an inventory label'),
      filename:u.filename,sha256:u.sha256,size:u.size,source_ref:text(input.source_ref??'','a source reference',4000,false),
      actor:text(input.actor,'the operator name',200),created_at:now()};
    this.change(projectId,input.expected,input.actor,'RETAIN_ARTIFACT',{artifact_id:artifact.id},()=>{
      this.db.prepare('INSERT INTO artifacts VALUES('+Array(10).fill('?').join(',')+')').run(...Object.values(artifact));
    });return {artifact,state:this.state(projectId)};
  }
  async addDictionary(projectId,input){
    const u=this.getUpload(projectId,input.upload_id);let body;
    try{body=compileDictionary(JSON.parse((await readObject(this.root,u.sha256)).toString('utf8')));}catch(e){if(e.status)throw e;throw fault(422,'The dictionary must be valid JSON.');}
    const approval=input.approval??'DRAFT';
    if(!['DRAFT','RECORDED_CITY_APPROVAL'].includes(approval))throw fault(422,'Choose draft or recorded City approval.');
    const approvalRef=text(input.approval_ref??'','the written approval source',4000,approval!=='DRAFT');
    const approver=text(input.approver??'','the approval author',200,approval!=='DRAFT');
    const approvalDate=text(input.approval_date??'','the approval date',40,approval!=='DRAFT');
    if(approvalDate&&!/^\d{4}-\d{2}-\d{2}$/.test(approvalDate))throw fault(422,'Use an ISO approval date.');
    const dictionary={id:id('dictionary'),project_id:projectId,label:body.label,sha256:u.sha256,body:json(body),
      source_ref:text(input.source_ref??'','the dictionary source',4000,false),approval,approver,approval_date:approvalDate,
      approval_ref:approvalRef,actor:text(input.actor,'the operator name',200),created_at:now()};
    this.change(projectId,input.expected,input.actor,'IMPORT_DICTIONARY',{dictionary_id:dictionary.id,approval},()=>{
      this.db.prepare('INSERT INTO dictionaries VALUES('+Array(12).fill('?').join(',')+')').run(...Object.values(dictionary));
      this.db.prepare('UPDATE projects SET dictionary_id=? WHERE id=?').run(dictionary.id,projectId);
    });return this.state(projectId);
  }
  contract(projectId,dictionaryId){
    if(!dictionaryId)return defaultDictionary();
    const d=this.db.prepare('SELECT body FROM dictionaries WHERE id=? AND project_id=?').get(dictionaryId,projectId);
    if(!d)throw fault(404,'Dictionary not found.');return compileDictionary(parse(d.body));
  }
  selectDictionary(projectId,input){
    if(input.dictionary_id)this.contract(projectId,input.dictionary_id);
    this.change(projectId,input.expected,input.actor,'SELECT_DICTIONARY',{dictionary_id:input.dictionary_id||null},()=>{
      this.db.prepare('UPDATE projects SET dictionary_id=? WHERE id=?').run(input.dictionary_id||null,projectId);
    });return this.state(projectId);
  }
  recoverDeadRuns(){
    for(const r of this.db.prepare("SELECT id,owner_pid,worker_identity FROM runs WHERE status='RUNNING'").all()){
      const original=parse(r.worker_identity);let ended=false;
      if(original&&this.identity){
        if(original.boot!==this.identity.boot)ended=true;
        else if(original.namespace===this.identity.namespace){
          const start=processStart(r.owner_pid);
          if(start)ended=start!==original.start;
          else try{process.kill(r.owner_pid,0);}catch(e){ended=e.code==='ESRCH';}
        }
      }else try{process.kill(r.owner_pid,0);}catch(e){ended=e.code==='ESRCH';}
      if(ended)this.db.prepare("UPDATE runs SET status='INTERRUPTED',error=?,completed_at=? WHERE id=? AND status='RUNNING'")
        .run('The original worker exited before completion. The partial findings remain; rerun the retained inputs explicitly.',now(),r.id);
    }
  }
  startRun(projectId,input){
    this.recoverDeadRuns();const runId=id('run'),actor=text(input.actor,'the operator name',200);
    this.change(projectId,input.expected,actor,'START_PREFLIGHT',{run_id:runId,parent_run_id:input.parent_run_id||null},p=>{
      let selection=p.selection,dictionaryId=p.dictionary_id,contract;
      if(input.parent_run_id){
        const previous=this.getRun(projectId,input.parent_run_id);
        if(previous.status==='RUNNING')throw fault(409,'The original preflight is still running.');
        selection=previous.selection;dictionaryId=previous.dictionary_id;contract=this.runContract(projectId,previous);
      }
      if(!Object.keys(selection).length)throw fault(422,'Retain and select a source first.');
      if(this.db.prepare("SELECT id FROM runs WHERE project_id=? AND status='RUNNING'").get(projectId))
        throw fault(409,'This project already has a running preflight.');
      contract??=this.contract(projectId,dictionaryId);
      this.db.prepare('INSERT INTO runs(id,project_id,status,selection,dictionary_id,contract_sha,reports,progress,owner_pid,parent_run_id,error,actor,created_at,completed_at,worker_identity,contract_body) VALUES('+Array(16).fill('?').join(',')+')').run(runId,projectId,'RUNNING',json(selection),
        dictionaryId,digest(contract),'[]','{}',process.pid,input.parent_run_id||null,'',actor,now(),null,json(this.identity),json(contract));
    });
    const controller=new AbortController();
    const job={controller,promise:null};this.active.set(runId,job);
    job.promise=this.executeRun(projectId,runId,controller.signal).finally(()=>this.active.delete(runId));
    return {run_id:runId,state:this.state(projectId)};
  }
  getRun(projectId,runId){
    const r=unpack(this.db.prepare('SELECT * FROM runs WHERE id=? AND project_id=?').get(runId,projectId));
    if(!r)throw fault(404,'Run not found.');return r;
  }
  runContract(projectId,run){
    const contract=run.contract_body??this.contract(projectId,run.dictionary_id);
    compileDictionary(contract);
    if(digest(contract)!==run.contract_sha)
      throw fault(409,'The original run dictionary is unavailable at its retained identity. Start a new review of the selected retained sources before preparing an edition.');
    return contract;
  }
  async executeRun(projectId,runId,signal){
    const r=this.getRun(projectId,runId),contract=this.runContract(projectId,r),reports=[];
    let rows=[],findings=[],count=0,observedRows=0;
    const insertRow=this.db.prepare('INSERT INTO records VALUES(?,?,?,?,?)');
    const insertFinding=this.db.prepare('INSERT INTO findings VALUES('+Array(14).fill('?').join(',')+')');
    const flush=()=>{
      if(!rows.length&&!findings.length)return;
      this.db.exec('BEGIN IMMEDIATE');
      try{
        for(const value of rows)insertRow.run(...value);
        for(const value of findings)insertFinding.run(...value);
        this.db.exec('COMMIT');rows=[];findings=[];
      }catch(e){this.db.exec('ROLLBACK');throw e;}
    };
    try{
      for(const [featureClass,sourceId] of Object.entries(r.selection)){
        signal.throwIfAborted();
        const source=this.db.prepare('SELECT * FROM sources WHERE id=? AND project_id=?').get(sourceId,projectId);
        if(!source||source.feature_class!==featureClass)throw fault(409,'A retained source is missing.');
        const metadata=await readObject(this.root,source.metadata_sha);
        const initial=await hashFile(objectPath(this.root,source.rows_sha),this.uploadLimit);
        if(initial.sha256!==source.rows_sha||initial.size!==source.rows_size)throw fault(409,'The retained row export changed.');
        const report=await preflight({metadata:objectPath(this.root,source.metadata_sha),ndjson:objectPath(this.root,source.rows_sha),
          sample:!!source.sample,contract,signal,
          onRow:({line,row,raw})=>{
            const sha=rowDigest(row,raw),key=stableRecordKey(featureClass,row,contract);
            rows.push([runId,sourceId,line,key,sha]);observedRows++;if(rows.length>=500)flush();
          },
          onFinding:({problem,scope,line,row,raw})=>{
            const key=scope==='row'?stableRecordKey(featureClass,row,contract):scope;
            const rowSha=scope==='row'?rowDigest(row,raw):scope==='population'?source.rows_sha:source.metadata_sha;
            const location=problem.where.replace(/^row \d+\/?/,'').replace(/^line \d+$/,'invalid NDJSON');
            const fingerprint=digest({featureClass,scope,key,rowSha,metadata:source.metadata_sha,code:problem.code,location,detail:problem.detail,contract:r.contract_sha});
            findings.push([runId+'-finding-'+(++count),projectId,runId,sourceId,featureClass,scope,line,key,rowSha,
              problem.code,problem.where,problem.detail,heuristic.has(problem.code)?'PROPOSED_QA_HEURISTIC':'RFP_OR_SOURCE_CHECK',fingerprint]);
            if(findings.length>=1000)flush();
          },
          onProgress:progress=>{
            flush();this.db.prepare('UPDATE runs SET progress=?,reports=? WHERE id=?')
              .run(json({feature_class:featureClass,...progress,total_observed_rows:observedRows,findings:count}),json(reports),runId);
          }
        });
        if(report.input_sha256!==source.rows_sha||report.input_bytes!==source.rows_size||report.metadata_input_sha256!==source.metadata_sha)
          throw fault(409,'The reviewed bytes differ from the retained input.');
        reports.push({source_id:sourceId,...report});flush();
      }
      this.db.prepare("UPDATE runs SET status='COMPLETED',reports=?,progress=?,completed_at=? WHERE id=?")
        .run(json(reports),json({total_observed_rows:observedRows,findings:count}),now(),runId);
    }catch(e){
      try{flush();}catch{}
      this.db.prepare('UPDATE runs SET status=?,reports=?,error=?,completed_at=? WHERE id=?')
        .run(signal.aborted?'CANCELLED':'FAILED',json(reports),String(e.message).slice(0,4000),now(),runId);
    }
    return this.getRun(projectId,runId);
  }
  stopRun(projectId,runId){
    this.getRun(projectId,runId);const job=this.active.get(runId);
    if(!job)throw fault(409,'This server does not own a live worker for that run.');
    job.controller.abort(new Error('Stopped by the operator.'));return this.getRun(projectId,runId);
  }
  async waitRun(runId){await this.active.get(runId)?.promise;}
  effectiveSql(cutoff=null){
    const boundary=cutoff===null?'':' AND d0.seq<='+integer(cutoff,'review snapshot',Number.MAX_SAFE_INTEGER);
    return " FROM findings f LEFT JOIN decisions d ON d.seq=(SELECT d0.seq FROM decisions d0 JOIN findings old ON old.id=d0.finding_id WHERE d0.action!='NOTE'"+boundary+" AND old.project_id=f.project_id AND old.fingerprint=f.fingerprint AND (old.id=f.id OR (old.run_id!=f.run_id AND (SELECT COUNT(*) FROM findings same WHERE same.run_id=f.run_id AND same.fingerprint=f.fingerprint)=1 AND (SELECT COUNT(*) FROM findings previous WHERE previous.run_id=old.run_id AND previous.fingerprint=old.fingerprint)=1)) ORDER BY d0.seq DESC LIMIT 1) ";
  }
  findings(projectId,runId,{offset=0,limit=50,code='',search='',action=''}={}){
    this.getRun(projectId,runId);integer(offset,'page offset',100000000);integer(limit,'page size',200);
    if(!limit)throw fault(422,'Page size must be positive.');
    let where=' WHERE f.project_id=? AND f.run_id=?',args=[projectId,runId];
    if(code){where+=' AND f.code=?';args.push(text(code,'a finding code',100));}
    if(search){where+=" AND (f.record_key LIKE ? OR f.detail LIKE ? OR f.location LIKE ?)";const q='%'+text(search,'search text',200)+'%';args.push(q,q,q);}
    if(action){where+=" AND COALESCE(d.action,'OPEN')=?";args.push(text(action,'a decision filter',40));}
    const from=this.effectiveSql();
    const total=this.db.prepare('SELECT COUNT(*) AS n'+from+where).get(...args).n;
    const found=this.db.prepare('SELECT f.*,d.id AS decision_id,d.finding_id AS decision_finding_id,d.action,d.owner,d.note,d.source_ref,d.actor,d.created_at AS decided_at'+from+where+' ORDER BY f.source_id,f.line,f.id LIMIT ? OFFSET ?').all(...args,limit,offset)
      .map(f=>({...f,inherited_decision:!!f.decision_id&&f.decision_finding_id!==f.id}));
    return {total,offset,limit,findings:found};
  }
  decide(projectId,input){
    if(!actions.includes(input.action))throw fault(422,'Choose an assignment, correction request, exception, reopening or note.');
    const ids=input.finding_ids??[input.finding_id];
    if(!Array.isArray(ids)||!ids.length||ids.length>1000||new Set(ids).size!==ids.length)
      throw fault(422,'Select up to 1,000 distinct findings for this review.');
    const found=ids.map(findingId=>{
      const f=this.db.prepare('SELECT * FROM findings WHERE id=? AND project_id=?').get(findingId,projectId);
      if(!f)throw fault(404,'Finding not found.');
      if(this.getRun(projectId,f.run_id).status!=='COMPLETED')throw fault(409,'Review a completed preflight. Partial runs retain observations only.');
      return f;
    });
    const owner=text(input.owner??'','the assigned reviewer',200,input.action==='ASSIGNED'||input.action==='CORRECTION_REQUESTED');
    const note=text(input.note,'a source-linked review note',8000);
    const sourceRef=text(input.source_ref??'','the review or exception source',4000,input.action==='ACCEPTED_EXCEPTION');
    this.change(projectId,input.expected,input.actor,'REVIEW_FINDINGS',{finding_ids:ids,action:input.action},()=>{
      const insert=this.db.prepare('INSERT INTO decisions(id,project_id,finding_id,action,owner,note,source_ref,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?)');
      for(const f of found)insert.run(id('decision'),projectId,f.id,input.action,owner,note,sourceRef,input.actor,now());
    });return this.state(projectId);
  }
  milestone(projectId,input){
    if(!MILESTONES.some(m=>m.id===input.milestone)||!['NOT_STARTED','IN_PROGRESS','RECEIVED','CORRECTION_REQUESTED','NOT_APPLICABLE'].includes(input.status))
      throw fault(422,'Choose an original delivery milestone and status.');
    const owner=text(input.owner??'','the responsible person',200,false),note=text(input.note,'the source or decision context',8000);
    const sourceRef=text(input.source_ref??'','the original source reference',4000,input.status==='RECEIVED');
    const due=text(input.due_date??'','a due date',40,false);
    if(due&&!/^\d{4}-\d{2}-\d{2}$/.test(due))throw fault(422,'Use an ISO due date.');
    if(input.artifact_id&&!this.db.prepare('SELECT id FROM artifacts WHERE id=? AND project_id=?').get(input.artifact_id,projectId))
      throw fault(422,'Select a retained project artifact.');
    this.change(projectId,input.expected,input.actor,'RECORD_MILESTONE',{milestone:input.milestone,status:input.status},()=>{
      this.db.prepare('INSERT INTO milestones(id,project_id,milestone,status,owner,due_date,note,source_ref,artifact_id,actor,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)')
        .run(id('milestone'),projectId,input.milestone,input.status,owner,due,note,sourceRef,input.artifact_id||null,input.actor,now());
    });return this.state(projectId);
  }
  comparison(projectId,previousId,currentId){
    const previous=this.getRun(projectId,previousId),current=this.getRun(projectId,currentId);
    if(previous.status!=='COMPLETED'||current.status!=='COMPLETED')throw fault(422,'Compare two completed runs.');
    const grouped=this.db.prepare('SELECT fingerprint,COUNT(*) AS n,feature_class,code FROM findings WHERE run_id=? GROUP BY fingerprint').all(previousId);
    const old=new Map(grouped.map(f=>[f.fingerprint,f]));let introduced=0,persisting=0,resolvedCount=0;
    const byClass=Object.fromEntries(CLASSES.map(c=>[c,{introduced:0,persisting:0,resolved:0}]));
    for(const f of this.db.prepare('SELECT fingerprint,COUNT(*) AS n,feature_class FROM findings WHERE run_id=? GROUP BY fingerprint').iterate(currentId)){
      const prior=old.get(f.fingerprint),same=Math.min(prior?.n??0,f.n),added=f.n-same;
      persisting+=same;introduced+=added;byClass[f.feature_class].persisting+=same;byClass[f.feature_class].introduced+=added;
      if(prior)prior.n-=same;
    }
    for(const f of old.values()){resolvedCount+=f.n;byClass[f.feature_class].resolved+=f.n;}
    return {previous_id:previousId,current_id:currentId,introduced,persisting,resolved:resolvedCount,by_class:byClass,
      dictionary_changed:previous.contract_sha!==current.contract_sha,previous_selection:previous.selection,current_selection:current.selection,
      meaning:'Resolved means the prior source-bound finding is absent from this run. Changed rows require a new decision; it does not establish City acceptance.'};
  }
  async row(projectId,runId,sourceId,line){
    this.getRun(projectId,runId);integer(line,'source line',100000000);
    const source=this.db.prepare('SELECT * FROM sources WHERE id=? AND project_id=?').get(sourceId,projectId);
    const index=this.db.prepare('SELECT * FROM records WHERE run_id=? AND source_id=? AND line=?').get(runId,sourceId,line);
    if(!source||!index)throw fault(404,'Source row not found in this run.');
    const raw=createReadStream(objectPath(this.root,source.rows_sha)),rl=createInterface({input:raw,crlfDelay:Infinity});let number=0;
    try{
      for await(const content of rl){if(++number!==line)continue;let row,invalid=false;try{row=JSON.parse(content);}catch{row=null;invalid=true;}
        if(rowDigest(row,invalid?content:undefined)!==index.row_sha)throw fault(409,'The retained source row changed.');
        return {source_id:sourceId,line,record_key:index.record_key,row_sha:index.row_sha,row,raw:invalid?content.slice(0,16000):null};
      }
    }finally{rl.close();raw.destroy();}
    throw fault(409,'The retained source line is missing.');
  }
  readiness(projectId,runId){
    const run=runId?this.getRun(projectId,runId):null;
    const latest=this.db.prepare('SELECT m.* FROM milestones m WHERE m.project_id=? AND m.seq=(SELECT MAX(x.seq) FROM milestones x WHERE x.project_id=m.project_id AND x.milestone=m.milestone)').all(projectId);
    const milestones=MILESTONES.map(m=>({...m,record:latest.find(x=>x.milestone===m.id)||null}));
    return {milestones,classes:CLASSES.map(featureClass=>{
      const report=run?.reports?.find(r=>r.feature_class===featureClass);
      return {feature_class:featureClass,reviewed:!!report,rows:report?.rows??null,mode:report?.mode??null,
        representative_minimum_observed:report?report.rows>=5:null,verdict:report?.verdict??'NOT_REVIEWED'};
    }),city_acceptance_recorded:latest.some(m=>m.milestone==='city_final_acceptance'&&m.status==='RECEIVED'),
      note:'Milestone states are operator-entered records linked to their sources. Attribute checks do not perform acquisition, spatial QA or City approval.'};
  }
  createRelease(projectId,input){
    const run=this.getRun(projectId,input.run_id);
    if(run.status!=='COMPLETED')throw fault(422,'Select a completed run for the delivery edition.');
    const selected=input.artifact_ids??this.db.prepare('SELECT id FROM artifacts WHERE project_id=?').all(projectId).map(x=>x.id);
    if(!Array.isArray(selected)||selected.length>100000||new Set(selected).size!==selected.length)throw fault(422,'Choose distinct retained delivery files.');
    const artifacts=selected.map(artifactId=>{const a=this.db.prepare('SELECT * FROM artifacts WHERE id=? AND project_id=?').get(artifactId,projectId);if(!a)throw fault(422,'A delivery file is not in this project.');return a;});
    const releaseId=id('release'),reviewer=text(input.actor,'the reviewer name',200),label=text(input.label,'an edition label');
    const note=text(input.note,'the handoff context',8000);
    this.change(projectId,input.expected,reviewer,'PREPARE_RELEASE',{release_id:releaseId,run_id:run.id},p=>{
      const payload={schema:'midland.delivery-edition.v1',project:{id:p.id,title:p.title,owner:p.owner,revision:p.revision},
        run,contract:this.runContract(projectId,run),sources:Object.values(run.selection).map(sourceId=>this.db.prepare('SELECT * FROM sources WHERE id=?').get(sourceId)),
        artifacts,readiness:this.readiness(projectId,run.id),review_cutoff_seq:this.db.prepare('SELECT COALESCE(MAX(seq),0) AS n FROM decisions WHERE project_id=?').get(projectId).n,
        current_selection_at_preparation:p.selection,current_dictionary_at_preparation:p.dictionary_id};
      this.db.prepare('INSERT INTO releases VALUES(?,?,?,?,?,?,?,?)').run(releaseId,projectId,run.id,label,reviewer,note,json(payload),now());
    });return {release_id:releaseId,state:this.state(projectId)};
  }
  state(projectId){
    const project=this.project(projectId),runs=this.db.prepare('SELECT * FROM runs WHERE project_id=? ORDER BY created_at DESC,id DESC').all(projectId).map(unpack);
    const current=runs.find(r=>r.status==='COMPLETED')??runs[0]??null;
    const decisions=current?this.db.prepare("SELECT COALESCE(d.action,'OPEN') AS action,COUNT(*) AS n"+this.effectiveSql()+' WHERE f.run_id=? GROUP BY action').all(current.id):[];
    return {schema:'midland.delivery-workspace.v1',project,classes:CLASSES,artifact_roles:ARTIFACT_ROLES,
      sources:this.db.prepare('SELECT * FROM sources WHERE project_id=? ORDER BY created_at DESC,id DESC').all(projectId),
      artifacts:this.db.prepare('SELECT * FROM artifacts WHERE project_id=? ORDER BY created_at,id').all(projectId),
      dictionaries:this.db.prepare('SELECT * FROM dictionaries WHERE project_id=? ORDER BY created_at,id').all(projectId).map(unpack),
      selected_dictionary:this.contract(projectId,project.dictionary_id),runs,review_counts:decisions,readiness:this.readiness(projectId,current?.id),
      milestone_history:this.db.prepare('SELECT * FROM milestones WHERE project_id=? ORDER BY seq DESC').all(projectId),
      releases:this.db.prepare('SELECT id,project_id,run_id,label,reviewer,note,created_at FROM releases WHERE project_id=? ORDER BY created_at DESC').all(projectId),
      history:this.db.prepare('SELECT * FROM events WHERE project_id=? ORDER BY seq DESC LIMIT 200').all(projectId).map(unpack)};
  }
  async close(){
    if(this.closed)return;this.closed=true;
    for(const job of this.active.values())job.controller.abort(new Error('Workspace server is closing.'));
    await Promise.allSettled([...this.active.values()].map(j=>j.promise));this.db.close();
  }
}
