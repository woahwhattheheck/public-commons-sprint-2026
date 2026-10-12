// MIT. Durable Timescale operator work joined to the original PostgreSQL publisher.
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { join, dirname, resolve } from 'node:path';
import { lstat, chmod, mkdir, rename } from 'node:fs/promises';
import { openPostgresPublisher } from '../publisher/model.mjs';
import { readPostgresSourceFile } from '../config.mjs';
import { absolute, privateDirectory, acquireWorkspace, readPrivate, readJson, createFile, atomicJson, syncDirectory, bytes, digest, identity, fault, stamp } from '../publisher/files.mjs';
import { uuid, hash, only, checkText, catalog, tableRows, selectedAggregate, compareEditions, refreshContract, projectionContract, jobDefinition, nativeTarget } from './contracts.mjs';
import { captureTimescale, prepareNativeRefresh, runNativeRefresh, verifyAggregate, prepareNativeJob, runNativeJobChange } from './native.mjs';
const safeIssue=issue=>({code:typeof issue?.code==='string'&&/^[A-Z0-9_]{1,100}$/.test(issue.code)?issue.code:'TIMESCALE_OPERATION_FAILED',
  ...(typeof issue?.sqlState==='string'?{sqlState:issue.sqlState}:{})});
async function exists(path){try{await lstat(path);return true;}catch(issue){if(issue.code==='ENOENT')return false;throw issue;}}
function canonicalRequest(value){return identity(value);}
async function retainConnection(sourceFile,directory,prefix) {
  const original=await readPrivate(sourceFile),declaration=await readPostgresSourceFile(sourceFile);
  const config=structuredClone(declaration.config);
  const caFile=config.connection?.caFile??config.caFile;
  let ca=null;
  if(caFile!==undefined){
    const native=await readPrivate(resolve(dirname(sourceFile),caFile),1048576);
    ca=prefix+'-ca.pem';await createFile(join(directory,ca),native);
    if(config.connection?.caFile!==undefined)config.connection.caFile=ca;
    if(config.caFile!==undefined)config.caFile=ca;
  }
  await createFile(join(directory,prefix+'-original.json'),original);
  await createFile(join(directory,prefix+'.json'),bytes(config));
  return {sourceDigest:digest(original),runtimeSourceDigest:digest(bytes(config)),ca};
}
async function openTimescaleWorkspace({directory,create=false,sourceFile,maintenanceSourceFile,
  targetDirectory,environment=process.env,seller=null,resource=null,title='Timescale operations'}={}) {
  absolute(directory);
  if(create){
    if(await exists(directory))throw fault('TIMESCALE_WORKSPACE_EXISTS','Reopen this project or choose a new directory.',409);
    absolute(sourceFile,'source file');absolute(targetDirectory,'dataset target');
    await privateDirectory(directory,true);
  }else await privateDirectory(directory);
  const release=await acquireWorkspace(directory);
  let db,publisher,closed=false,closing=null,active=null;
  try{
    if(create){
      await privateDirectory(join(directory,'connection'),true);
      await privateDirectory(join(directory,'editions'),true);
      await privateDirectory(join(directory,'records'),true);
      const original=await retainConnection(sourceFile,join(directory,'connection'),'source');
      const maintenance=maintenanceSourceFile?await retainConnection(absolute(maintenanceSourceFile,'maintenance source'),join(directory,'connection'),'maintenance'):null;
      await createFile(join(directory,'workspace.json'),bytes({schema:'stellar-forge.timescale-workspace.v1',
        id:randomUUID(),title:checkText(title,'a workspace title',128),createdAt:stamp(),
        originalSourceDigest:original.sourceDigest,targetDirectory,maintenance:!!maintenance,
        maintenanceSourceDigest:maintenance?.sourceDigest??null,buyer:seller===null&&resource===null?null:{seller,resource}}));
    }
    const settings=await readJson(join(directory,'workspace.json'),16384);
    if(settings.schema!=='stellar-forge.timescale-workspace.v1')throw fault('TIMESCALE_WORKSPACE_INVALID');
    if(targetDirectory&&targetDirectory!==settings.targetDirectory)throw fault('TIMESCALE_TARGET_BINDING_CHANGED');
    targetDirectory=settings.targetDirectory;absolute(targetDirectory,'dataset target');
    sourceFile=join(directory,'connection','source.json');
    maintenanceSourceFile=settings.maintenance?join(directory,'connection','maintenance.json'):null;
    for(const name of ['connection','editions','records'])await privateDirectory(join(directory,name));
    const dbPath=join(directory,'timescale.sqlite');
    if(!create&&!await exists(dbPath))throw fault('TIMESCALE_DATABASE_MISSING');
    if(await exists(dbPath)){
      const stat=await lstat(dbPath);
      if(!stat.isFile()||stat.isSymbolicLink()||stat.mode&0o077)throw fault('TIMESCALE_PRIVATE_DATABASE_REQUIRED');
    }
    db=new DatabaseSync(dbPath);await chmod(dbPath,0o600);
    db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL;"+
      "CREATE TABLE IF NOT EXISTS meta(id INTEGER PRIMARY KEY CHECK(id=1),version INTEGER NOT NULL);"+
      "INSERT OR IGNORE INTO meta(id,version) VALUES(1,0);"+
      "CREATE TABLE IF NOT EXISTS operations(id TEXT PRIMARY KEY,kind TEXT NOT NULL,state TEXT NOT NULL,input_digest TEXT NOT NULL,input TEXT NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL,attempts INTEGER NOT NULL,data TEXT NOT NULL);"+
      "CREATE TABLE IF NOT EXISTS editions(id TEXT PRIMARY KEY,created TEXT NOT NULL,title TEXT NOT NULL,digest TEXT NOT NULL,bytes INTEGER NOT NULL,file TEXT NOT NULL);"+
      "CREATE TABLE IF NOT EXISTS plans(id TEXT PRIMARY KEY,kind TEXT NOT NULL,created TEXT NOT NULL,digest TEXT NOT NULL,data TEXT NOT NULL);"+
      "CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,created TEXT NOT NULL,before_id TEXT NOT NULL,after_id TEXT NOT NULL,data TEXT NOT NULL);"+
      "CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY,created TEXT NOT NULL,kind TEXT NOT NULL,operation TEXT,data TEXT NOT NULL);");
    const event=(kind,operation,data={})=>db.prepare('INSERT INTO events(created,kind,operation,data) VALUES(?,?,?,?)').run(stamp(),kind,operation??null,JSON.stringify(data));
    const version=()=>db.prepare('SELECT version FROM meta WHERE id=1').get().version;
    function transaction(fn){
      db.exec('BEGIN IMMEDIATE');
      try{const result=fn();db.prepare('UPDATE meta SET version=version+1 WHERE id=1').run();db.exec('COMMIT');return result;}
      catch(issue){db.exec('ROLLBACK');throw issue;}
    }
    function available(expectedVersion){
      if(closed)throw fault('TIMESCALE_WORKSPACE_CLOSED');
      if(active||publisher?.status().active)throw fault('TIMESCALE_WORKSPACE_BUSY','The current original operation is still running.',409);
      if(expectedVersion!==undefined&&expectedVersion!==version())throw fault('TIMESCALE_REVISION_CHANGED','Reload the saved project before applying this change.',409);
    }
    const decode=row=>row?{...row,...(row.data?{data:JSON.parse(row.data)}:{}),...(row.input?{input:JSON.parse(row.input)}:{})}:null;
    function operation(id){
      uuid(id);const row=decode(db.prepare('SELECT * FROM operations WHERE id=?').get(id));
      if(!row)throw fault('TIMESCALE_OPERATION_NOT_FOUND','Select a saved operation.',404);
      return row;
    }
    function change(id,state,patch,kind){
      return transaction(()=>{
        const row=operation(id),data={...row.data,...patch};
        db.prepare('UPDATE operations SET state=?,updated=?,data=? WHERE id=?').run(state,stamp(),JSON.stringify(data),id);
        event(kind,id,{state,...patch});return operation(id);
      });
    }
    for(const row of db.prepare("SELECT id,kind,state FROM operations WHERE state IN ('RUNNING','DISPATCHING')").all()){
      change(row.id,row.state==='DISPATCHING'?'OUTCOME_UNKNOWN':'INTERRUPTED',
        {error:{code:'TIMESCALE_PROCESS_INTERRUPTED'}},'PROCESS_RECOVERY');
    }
    if(seller===null&&resource===null&&settings.buyer){seller=settings.buyer.seller;resource=settings.buyer.resource;}
    publisher=await openPostgresPublisher({directory:join(directory,'publisher'),create,sourceFile,targetDirectory,environment,seller,resource});
    function status({limit=25,offset=0}={}){
      if(!Number.isSafeInteger(limit)||limit<1||limit>100||!Number.isSafeInteger(offset)||offset<0)throw fault('TIMESCALE_HISTORY_PAGE_INVALID');
      const page=(name,order)=>({total:db.prepare('SELECT count(*) AS n FROM '+name).get().n,offset,limit,
        rows:db.prepare('SELECT * FROM '+name+' ORDER BY '+order+' LIMIT ? OFFSET ?').all(limit,offset).map(decode)});
      return {schema:'stellar-forge.timescale-status.v1',id:settings.id,title:settings.title,version:version(),
        directory,sourceFile,targetDirectory,maintenanceConfigured:settings.maintenance,
        active:active?{id:active.id,kind:active.kind,progress:active.progress}:null,
        editions:page('editions','created DESC,id DESC'),operations:page('operations','created DESC,id DESC'),
        plans:page('plans','created DESC,id DESC'),reviews:page('reviews','created DESC,id DESC'),events:page('events','id DESC')};
    }
    async function edition(id){
      uuid(id);const row=db.prepare('SELECT * FROM editions WHERE id=?').get(id);
      if(!row)throw fault('TIMESCALE_EDITION_NOT_FOUND','Select a retained edition.',404);
      const original=await readPrivate(join(directory,'editions',row.file),1024*1024*1024);
      if(original.length!==row.bytes||digest(original)!==row.digest)throw fault('TIMESCALE_EDITION_FILE_CHANGED');
      const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(original));
      if(value.id!==id||value.complete!==true)throw fault('TIMESCALE_EDITION_FILE_CHANGED');
      return {record:row,value,catalog:catalog(value)};
    }
    async function retainRecord(value){
      const data=bytes(value),sha=digest(data),file=sha+'.json',path=join(directory,'records',file);
      if(await exists(path)){if(digest(await readPrivate(path,1024*1024*1024))!==sha)throw fault('TIMESCALE_RECORD_CHANGED');}
      else{await createFile(path,data);await syncDirectory(join(directory,'records'));}
      return {file,sha256:sha,bytes:data.length};
    }
    async function readRecord(reference){
      if(!reference||reference.file!==hash(reference.sha256)+'.json')throw fault('TIMESCALE_RECORD_INVALID');
      const data=await readPrivate(join(directory,'records',reference.file),1024*1024*1024);
      if(data.length!==reference.bytes||digest(data)!==reference.sha256)throw fault('TIMESCALE_RECORD_CHANGED');
      return {data:JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data)),bytes:data};
    }
    function start(kind,input,work,{retryRead=false}={}){
      uuid(input.requestId);
      const stable=structuredClone(input);delete stable.expectedVersion;
      const inputDigest=canonicalRequest(stable),existing=db.prepare('SELECT id FROM operations WHERE id=?').get(input.requestId);
      if(existing){
        const prior=operation(input.requestId);
        if(prior.kind!==kind||prior.input_digest!==inputDigest)throw fault('TIMESCALE_REQUEST_BINDING_CHANGED');
        if(active?.id===prior.id)return {id:prior.id,completion:active.promise,reused:true};
        if(!retryRead||!['INTERRUPTED','FAILED'].includes(prior.state))return {id:prior.id,completion:Promise.resolve(prior),reused:true};
      }
      available(input.expectedVersion);
      const controller=new AbortController(),current={id:input.requestId,kind,controller,progress:{},promise:null};
      transaction(()=>{
        const now=stamp();
        if(existing)db.prepare("UPDATE operations SET state='RUNNING',updated=?,attempts=attempts+1 WHERE id=?").run(now,input.requestId);
        else db.prepare('INSERT INTO operations VALUES(?,?,?,?,?,?,?,?,?,?)').run(input.requestId,kind,'RUNNING',inputDigest,JSON.stringify(stable),now,now,1,'{}');
        event(existing?'OPERATION_CONTINUED':'OPERATION_STARTED',input.requestId,{kind,inputDigest});
      });
      active=current;
      current.promise=Promise.resolve().then(()=>work({signal:controller.signal,
        progress:value=>{current.progress=value;},
        dispatch:async data=>{
          const before=data.before?await retainRecord(data.before):null;
          change(input.requestId,'DISPATCHING',{dispatch:{...data,before}},'NATIVE_DISPATCH');
        }})).then(data=>change(input.requestId,'COMPLETE',{result:data,error:null},'OPERATION_COMPLETED'))
        .catch(issue=>{
          const prior=operation(input.requestId),unknown=prior.state==='DISPATCHING';
          return change(input.requestId,unknown?'OUTCOME_UNKNOWN':controller.signal.aborted?'INTERRUPTED':'FAILED',
            {error:safeIssue(issue)},unknown?'NATIVE_OUTCOME_UNKNOWN':'OPERATION_STOPPED');
        }).finally(()=>{if(active===current)active=null;});
      return {id:input.requestId,completion:current.promise,reused:false};
    }
    function startCapture(input){
      only(input,['requestId','expectedVersion','title','note','timeoutMs']);
      const title=checkText(input.title,'an edition title',128),note=checkText(input.note,'the source-capture purpose');
      return start('capture',input,async context=>{
        const path=join(directory,'editions',input.requestId+'.json');
        let value,data;
        if(await exists(path)){
          data=await readPrivate(path,1024*1024*1024);value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
          if(value.id!==input.requestId||value.complete!==true||value.sourceDigest!==settings.originalSourceDigest)
            throw fault('TIMESCALE_RETAINED_CAPTURE_MISMATCH');
        }else{
          value=await captureTimescale(sourceFile,{id:input.requestId,title,note,sourceDigest:settings.originalSourceDigest,
            environment,signal:context.signal,timeoutMs:input.timeoutMs??600000,onProgress:context.progress});
          data=bytes(value);await createFile(path,data);await syncDirectory(join(directory,'editions'));
        }
        transaction(()=>{
          const prior=db.prepare('SELECT * FROM editions WHERE id=?').get(input.requestId);
          if(prior&&prior.digest!==digest(data))throw fault('TIMESCALE_CAPTURE_ID_CHANGED');
          db.prepare('INSERT OR IGNORE INTO editions VALUES(?,?,?,?,?,?)').run(input.requestId,value.completedAt,title,digest(data),data.length,input.requestId+'.json');
          event('EDITION_RETAINED',input.requestId,{digest:digest(data),bytes:data.length});
        });
        return {editionId:input.requestId,digest:digest(data),bytes:data.length,aggregateCount:catalog(value).length};
      },{retryRead:true});
    }
    async function comparison(beforeId,afterId){
      const before=await edition(beforeId),after=await edition(afterId);
      return {...compareEditions(before.value,after.value),beforeDigest:before.record.digest,afterDigest:after.record.digest};
    }
    function saveReview(input){
      only(input,['requestId','expectedVersion','beforeId','afterId','comparisonDigest','reviewer','note','decisions']);
      return start('review',input,async()=>{
        const current=await comparison(input.beforeId,input.afterId);
        if(identity(current)!==input.comparisonDigest)throw fault('TIMESCALE_COMPARISON_CHANGED');
        if(!Array.isArray(input.decisions))throw fault('TIMESCALE_DECISIONS_REQUIRED');
        const keys=new Set(),changes=new Set(current.changes.map(row=>row.key));
        const decisions=input.decisions.map(row=>{
          only(row,['changeKey','decision','owner','note']);
          if(!changes.has(row.changeKey)||keys.has(row.changeKey)||!['ACCEPT','REMEDIATE','DEFER'].includes(row.decision))throw fault('TIMESCALE_DECISION_INVALID');
          keys.add(row.changeKey);return {...row,owner:checkText(row.owner,'an assigned owner',128),note:checkText(row.note,'the decision reason')};
        });
        if(keys.size!==changes.size)throw fault('TIMESCALE_ALL_CHANGES_REQUIRE_DECISIONS');
        const data={schema:'stellar-forge.timescale-review.v1',beforeId:input.beforeId,afterId:input.afterId,
          comparisonDigest:input.comparisonDigest,reviewer:checkText(input.reviewer,'the reviewer',128),note:checkText(input.note,'the review purpose'),decisions};
        transaction(()=>{db.prepare('INSERT INTO reviews VALUES(?,?,?,?,?)').run(input.requestId,stamp(),input.beforeId,input.afterId,JSON.stringify(data));});
        return {reviewId:input.requestId,...data};
      });
    }
    function getPlan(id,kind){
      uuid(id);const row=decode(db.prepare('SELECT * FROM plans WHERE id=?').get(id));
      if(!row||kind&&row.kind!==kind)throw fault('TIMESCALE_PLAN_NOT_FOUND');
      if(identity(row.data)!==row.digest)throw fault('TIMESCALE_PLAN_CHANGED');
      return row;
    }
    function prepareRefresh(input){
      only(input,['requestId','expectedVersion','plan']);
      return start('prepare-refresh',input,async context=>{
        if(!maintenanceSourceFile)throw fault('TIMESCALE_MAINTENANCE_CONNECTION_REQUIRED','Reopen or receive with the selected maintenance connection to operate the database.');
        const selected=await edition(input.plan.editionId);
        if(selected.record.digest!==input.plan.editionDigest)throw fault('TIMESCALE_EDITION_REVIEW_CHANGED');
        const retained=db.prepare('SELECT id FROM plans WHERE id=?').get(input.requestId);
        if(retained){const saved=getPlan(input.requestId,'refresh');return {planId:saved.id,digest:saved.digest,plan:saved.data};}
        const original=refreshContract(selected.value,input.plan);
        const plan=await prepareNativeRefresh(maintenanceSourceFile,original,{environment,signal:context.signal,captureId:randomUUID(),sourceDigest:settings.originalSourceDigest});
        transaction(()=>{db.prepare('INSERT INTO plans VALUES(?,?,?,?,?)').run(input.requestId,'refresh',stamp(),identity(plan),JSON.stringify(plan));});
        return {planId:input.requestId,digest:identity(plan),plan};
      },{retryRead:true});
    }
    function startRefresh(input){
      only(input,['requestId','expectedVersion','planId','planDigest','timeoutMs']);
      return start('refresh',input,async context=>{
        if(!maintenanceSourceFile)throw fault('TIMESCALE_MAINTENANCE_CONNECTION_REQUIRED');
        const p=getPlan(input.planId,'refresh');if(p.digest!==input.planDigest)throw fault('TIMESCALE_PLAN_REVIEW_CHANGED');
        const result=await runNativeRefresh(maintenanceSourceFile,p.data,{environment,signal:context.signal,timeoutMs:input.timeoutMs??600000,
          captureId:randomUUID(),sourceDigest:settings.originalSourceDigest,beforeDispatch:context.dispatch});
        const reference=await retainRecord(result);
        return {planId:input.planId,native:reference,acknowledgedAt:result.acknowledgedAt,
          window:result.window,options:result.options,atomic:result.atomic};
      });
    }
    function startVerification(input){
      only(input,['requestId','expectedVersion','planId','planDigest','timeoutMs']);
      return start('verification',input,async context=>{
        const p=getPlan(input.planId);if(!['refresh','projection'].includes(p.kind)||p.digest!==input.planDigest)throw fault('TIMESCALE_PLAN_REVIEW_CHANGED');
        const result=await verifyAggregate(sourceFile,p.data,{environment,signal:context.signal,timeoutMs:input.timeoutMs??600000,
          captureId:randomUUID(),sourceDigest:settings.originalSourceDigest});
        return {planId:input.planId,matches:result.matches,counts:tableRows(result.counts),native:await retainRecord(result)};
      },{retryRead:true});
    }
    function prepareJob(input){
      only(input,['requestId','expectedVersion','editionId','editionDigest','jobId','changes','title','owner','note']);
      return start('prepare-job',input,async context=>{
        if(!maintenanceSourceFile)throw fault('TIMESCALE_MAINTENANCE_CONNECTION_REQUIRED');
        const selected=await edition(input.editionId);
        if(selected.record.digest!==input.editionDigest)throw fault('TIMESCALE_EDITION_REVIEW_CHANGED');
        const retained=db.prepare('SELECT id FROM plans WHERE id=?').get(input.requestId);
        if(retained){const saved=getPlan(input.requestId,'job');return {planId:saved.id,digest:saved.digest,plan:saved.data};}
        const plan=await prepareNativeJob(maintenanceSourceFile,{edition:selected.value,...input},{environment,signal:context.signal});
        transaction(()=>{db.prepare('INSERT INTO plans VALUES(?,?,?,?,?)').run(input.requestId,'job',stamp(),identity(plan),JSON.stringify(plan));});
        return {planId:input.requestId,digest:identity(plan),plan};
      },{retryRead:true});
    }
    function applyJob(input){
      only(input,['requestId','expectedVersion','planId','planDigest']);
      return start('job-change',input,async context=>{
        if(!maintenanceSourceFile)throw fault('TIMESCALE_MAINTENANCE_CONNECTION_REQUIRED');
        const p=getPlan(input.planId,'job');if(p.digest!==input.planDigest)throw fault('TIMESCALE_PLAN_REVIEW_CHANGED');
        const result=await runNativeJobChange(maintenanceSourceFile,p.data,{environment,signal:context.signal,
          captureId:randomUUID(),sourceDigest:settings.originalSourceDigest,beforeDispatch:context.dispatch});
        return {planId:input.planId,native:await retainRecord(result),jobId:result.jobId,acknowledgedAt:result.acknowledgedAt};
      });
    }
    function selectAggregate(input){
      only(input,['requestId','expectedVersion','selection','extraction']);
      return start('select-aggregate',input,async()=>{
        const retained=db.prepare('SELECT id FROM plans WHERE id=?').get(input.requestId);
        if(retained){const saved=getPlan(input.requestId,'projection');return {planId:saved.id,digest:saved.digest,publisherPlanId:saved.data.publisherPlanId,plan:saved.data};}
        let prepared=operation(input.requestId).data.selection;
        if(!prepared){
          const selected=await edition(input.selection.editionId);
          if(selected.record.digest!==input.selection.editionDigest)throw fault('TIMESCALE_EDITION_REVIEW_CHANGED');
          const plan=projectionContract(selected.value,input.selection);
          const config=(await readPostgresSourceFile(sourceFile)).config;
          const next={...config,queries:{timescale_aggregate:plan.query},bindings:{}};
          const extraction={maxRows:1000000,maxBytes:268435456,maxRowBytes:1048576,timeoutMs:300000,
            ...input.extraction,order:plan.columns.map(column=>({column:column.name,direction:'asc'}))};
          const declaration={title:plan.title,sourceHash:digest(bytes(next)),query:'timescale_aggregate',
            input:plan.input,dataset:{name:plan.title,columns:Object.fromEntries(plan.columns.map(column=>[column.name,{type:'string',nullable:column.nullable}])),
              sorts:plan.columns.map(column=>column.name),defaultLimit:50,maxLimit:250,maxCellChars:65536,maxPageBytes:921600},
            extraction};
          prepared={plan,next,declaration,afterPublisherPlanId:publisher.status({limit:1}).plans[0]?.id??0};
          change(input.requestId,'RUNNING',{selection:prepared},'SELECTION_PREPARED');
        }
        // Restore the selected saved declaration on an explicit continuation.
        // The publisher's earlier plans retain their own original source files.
        if(digest(await readPrivate(sourceFile))!==prepared.declaration.sourceHash)
          await atomicJson(join(directory,'connection'),'source.json',prepared.next);
        let saved=null,offset=0;
        for(;;){
          const page=publisher.status({limit:100,plansOffset:offset});
          for(const row of page.plans){
            if(row.id<=prepared.afterPublisherPlanId)continue;
            const value=row.data;
            if(value.sourceHash===prepared.declaration.sourceHash&&value.title===prepared.plan.title&&
                value.query==='timescale_aggregate'&&identity(value.input)===identity(prepared.plan.input)&&
                identity(value.extraction)===identity(prepared.declaration.extraction)&&
                identity(value.dataset.columns)===identity(prepared.declaration.dataset.columns)){
              if(saved)throw fault('TIMESCALE_SELECTION_PUBLICATION_AMBIGUOUS');
              saved=row;
            }
          }
          if(page.pages.plans.next===null)break;
          offset=page.pages.plans.next;
        }
        saved??=await publisher.savePlan(prepared.declaration);
        const data={...prepared.plan,publisherPlanId:saved.id,publisherPlanDigest:saved.data.digest};
        transaction(()=>{db.prepare('INSERT INTO plans VALUES(?,?,?,?,?)').run(input.requestId,'projection',stamp(),identity(data),JSON.stringify(data));});
        return {planId:input.requestId,digest:identity(data),publisherPlanId:saved.id,plan:data};
      },{retryRead:true});
    }
    function startPublicationExtraction(input){
      only(input,['requestId','expectedVersion','planId','planDigest']);
      return start('extraction',input,async context=>{
        const selected=getPlan(input.planId,'projection');
        if(selected.digest!==input.planDigest)throw fault('TIMESCALE_PLAN_REVIEW_CHANGED');
        let original;
        try{original=publisher.run(input.requestId);}catch(issue){if(issue.code!=='RUN_NOT_FOUND')throw issue;}
        if(original){
          if(original.plan!==selected.data.publisherPlanId)throw fault('TIMESCALE_EXTRACTION_BINDING_CHANGED');
          return {runId:original.id,state:original.state,publisherPlanId:original.plan,reused:true};
        }
        const started=publisher.startExtraction(selected.data.publisherPlanId,{id:input.requestId});
        const cancel=()=>{try{publisher.cancel(started.id);}catch{}};
        context.signal.addEventListener('abort',cancel,{once:true});
        try{
          const result=await started.completion;
          return {runId:result.id,state:result.state,publisherPlanId:result.plan,error:result.data.error??null,reused:false};
        }finally{context.signal.removeEventListener('abort',cancel);}
      },{retryRead:true});
    }
    function cancel(id){
      uuid(id);if(active?.id!==id)throw fault('TIMESCALE_OPERATION_NOT_ACTIVE','The operation has already returned.',409);
      active.controller.abort();return {id,cancelling:true};
    }
    async function close(){
      if(closing)return closing;
      closed=true;active?.controller.abort();
      closing=(async()=>{try{await active?.promise;await publisher?.close();}finally{db.close();await release();}})();
      return closing;
    }
    const guardedMutations=new Set(['savePlan','startExtraction','review','publish','recover','prepareBuyer']);
    const publisherFacade=Object.freeze(Object.fromEntries(Object.entries(publisher).map(([name,value])=>
      [name,guardedMutations.has(name)?(...args)=>{available();return value(...args);}:value])));
    function exclusive(kind,input,work){return start(kind,input,work,{retryRead:true});}
    return {directory,settings,sourceFile,maintenanceSourceFile,publisher:publisherFacade,status,operation,edition,comparison,
      saveReview,prepareRefresh,startRefresh,startVerification,prepareJob,applyJob,selectAggregate,startCapture,startPublicationExtraction,
      getPlan,readRecord,retainRecord,cancel,available,exclusive,close};
  }catch(issue){try{await publisher?.close();}finally{db?.close();await release();}throw issue;}
}

export { openTimescaleWorkspace };
