// MIT. One retained source, request, research and native-operation model.
import {MarketStore} from './store.mjs';
import {retainCapture,importCapture,originalBazaarExample} from './capture.mjs';
import {CONTRACTS,normalizeRequest} from '../contracts.mjs';
import {compareMarketRows} from '../market.mjs';
import {prepareCoinGeckoProduct} from '../provider.mjs';
import {need,plain,text,id,integer,uuid,now,jsonBytes,base64,origin,prefix,clone,LIMITS,enumValue} from '../common.mjs';
import {createProjectArchive,restoreProjectArchive} from './recovery.mjs';

const KINDS=new Set(['requests','collections','captures','jobs','snapshots','comparisons','notes','providerPlans','exports']);
const distinct=(values,label,maximum=1000)=>{
  need(Array.isArray(values)&&values.length>=1&&values.length<=maximum&&new Set(values).size===values.length,
    'INVALID_SELECTION',label+' must contain distinct selected records');
  values.forEach(value=>id(value,label));return values;
};
export class MarketModel {
  constructor(directory,{buyerProfiles=[],allowLocal=false,providerMode='ORIGINAL_SF61_SF30',...options}={}) {
    this.store=new MarketStore(directory);this.options={allowLocal,providerMode,...options};
    this.profiles=buyerProfiles;this.runner=null;
  }
  attachRunner(runner){this.runner=runner;return this}
  close(){this.store.close()}
  state(){
    return {projects:this.store.projects(),contracts:clone(CONTRACTS),
      buyerProfiles:this.profiles.map(p=>({id:p.id,name:p.name,network:p.network,workspaceConfigured:!!p.workspacePath})),
      jobStatuses:{terminal:['completed','partial','failed','cancelled','interrupted','archived'],resumable:['partial','failed','cancelled','interrupted']},
      runtime:{node:process.version,providerMode:this.options.providerMode},limits:{uploadBytes:LIMITS.uploadBytes,
        pageSize:LIMITS.pageSize,restoreBytes:LIMITS.restoreBytes,restoreExpandedBytes:LIMITS.restoreExpandedBytes}};
  }
  project(projectId){
    return {project:this.store.project(projectId),counts:this.store.counts(projectId),
      latestJobs:this.store.list('jobs',projectId,{limit:10}).items.map(j=>this.jobView(j)),
      recentEvents:this.store.events(projectId,{limit:20}).items};
  }
  list(projectId,kind,query={}){
    this.store.project(projectId);
    if(kind==='files')return this.store.files(projectId,query);
    if(kind==='events')return this.store.events(projectId,query);
    need(KINDS.has(kind),'UNKNOWN_COLLECTION','Unknown retained collection',404);
    const result=this.store.list(kind,projectId,query);
    if(kind==='jobs')result.items=result.items.map(j=>this.jobView(j));
    return result;
  }
  createProject(body){
    return this.store.write(null,body,'project.created',()=>this.store.newProject(body.name,
      {merchantOrigin:'',merchantPrefix:'/api/v3/stellar',buyerProfileId:''}));
  }
  requestConfig(projectId){
    return {...this.store.project(projectId).config,allowLocal:this.options.allowLocal};
  }
  saveConfig(projectId,body){
    return this.store.write(projectId,body,'project.configuration',()=>{
      need(plain(body.config),'INVALID_CONFIG');
      const selected=body.config.buyerProfileId??'';
      need(selected===''||this.profiles.some(p=>p.id===selected),'BUYER_PROFILE_NOT_FOUND');
      const config={merchantOrigin:origin(body.config.merchantOrigin??'',{empty:true,allowLocal:this.options.allowLocal}),
        merchantPrefix:prefix(body.config.merchantPrefix),buyerProfileId:selected};
      return this.store.projectConfig(projectId,config);
    });
  }
  saveRequest(projectId,body,requestId=null){
    return this.store.write(projectId,body,requestId?'request.updated':'request.created',()=>{
      const previous=requestId?this.store.expected('requests',requestId,body.version):null;
      if(previous)need(previous.projectId===projectId,'WRONG_PROJECT');
      const normalized=normalizeRequest(body.request,this.requestConfig(projectId));
      return this.store.put('requests',{...normalized,id:requestId??uuid(),projectId,reference:previous?.reference??uuid()});
    });
  }
  request(requestId){return{request:this.store.get('requests',requestId),versions:this.store.versions('requests',requestId)}}
  saveCollection(projectId,body,collectionId=null){
    return this.store.write(projectId,body,collectionId?'collection.updated':'collection.created',()=>{
      const previous=collectionId?this.store.expected('collections',collectionId,body.version):null;
      if(previous)need(previous.projectId===projectId,'WRONG_PROJECT');
      const input=body.collection;need(plain(input),'INVALID_COLLECTION');
      const requestIds=distinct(input.requestIds,'requests');
      requestIds.forEach(requestId=>this.store.owned('requests',requestId,projectId));
      return this.store.put('collections',{id:collectionId??uuid(),projectId,
        name:text(input.name,'collection name',240),description:text(input.description??'','description',10000,{empty:true}),requestIds});
    });
  }
  collection(collectionId){
    const collection=this.store.get('collections',collectionId);
    return{collection,requests:collection.requestIds.map(requestId=>this.store.owned('requests',requestId,collection.projectId))};
  }
  collectionBytes(collectionId){
    const{collection,requests}=this.collection(collectionId);
    return jsonBytes({schema:'stellar-forge.coingecko-collection.v1',collection:{name:collection.name,description:collection.description},
      requests:requests.map(({name,endpoint,path,query,notes,enabled,reference})=>({name,endpoint,path,query,notes,enabled,reference}))});
  }
  importCollection(projectId,body){
    return this.store.write(projectId,body,'collection.imported',()=>{
      need(this.store.fileInfo(body.fileId).projectId===projectId,'WRONG_PROJECT');
      let source;try{source=JSON.parse(this.store.fileBytes(body.fileId).toString('utf8'))}catch{need(false,'INVALID_COLLECTION_JSON')}
      need(source?.schema==='stellar-forge.coingecko-collection.v1'&&Array.isArray(source.requests)&&
        source.requests.length>=1&&source.requests.length<=1000,'INVALID_COLLECTION_PACKAGE');
      const existing=new Set(this.store.all('requests',projectId).map(r=>r.reference)),requests=[];
      for(const original of source.requests){
        const input=normalizeRequest(original,this.requestConfig(projectId));
        let reference=original.reference;
        if(typeof reference!=='string'||existing.has(reference))reference=uuid();
        else id(reference,'request reference');
        existing.add(reference);
        requests.push(this.store.put('requests',{...input,projectId,reference,importFileId:body.fileId}));
      }
      const collection=this.store.put('collections',{projectId,name:text(body.name??source.collection?.name,'collection name',240),
        description:text(source.collection?.description??'','description',10000,{empty:true}),requestIds:requests.map(r=>r.id),importFileId:body.fileId});
      return{collection,requests};
    });
  }
  upload(projectId,body){
    return this.store.write(projectId,body,'source.uploaded',()=>this.store.file(projectId,
      text(body.filename,'filename',240),text(body.contentType??'application/octet-stream','content type',200),base64(body.contentBase64)));
  }
  importResponse(projectId,body){
    return this.store.write(projectId,body,'response.imported',()=>{
      const request=this.store.owned('requests',body.requestId,projectId);
      return importCapture(this.store,projectId,request,body);
    });
  }
  sample(projectId,body){
    return this.store.write(projectId,body,'provider.example.retained',()=>{
      const capture=this.store.owned('captures',body.captureId,projectId);
      need(capture.challengeFileId,'ORIGINAL_CHALLENGE_REQUIRED');
      const sample=originalBazaarExample(this.store.fileBytes(capture.challengeFileId));
      return retainCapture(this.store,{projectId,request:capture.request,name:body.name??capture.name+' — provider example',
        basis:'provider_bazaar_example',httpStatus:200,requestUrl:capture.requestUrl,observedAt:capture.observedAt,
        body:sample.bytes,headers:{'content-type':'application/json'},sourceFileId:capture.challengeFileId,
        parentCaptureId:capture.id,sourcePointer:sample.sourcePointer});
    });
  }
  capture(captureId){const capture=this.store.get('captures',captureId);return{capture,request:capture.request}}
  captureRows(captureId,query={}){
    this.store.get('captures',captureId);return this.store.rows([captureId],query);
  }
  captureRow(captureId,rowId){
    const capture=this.store.get('captures',captureId),row=this.store.row(captureId,rowId);
    const all=this.store.allRows([captureId]),linkedEntities=[];
    for(const relation of row.relations??[]){
      const matches=all.filter(r=>r.identity?.providerId===relation.id&&r.identity?.providerType===relation.type);
      for(const found of matches)if(!linkedEntities.some(r=>r.id===found.id))linkedEntities.push(found);
    }
    return{row,capture,linkedEntities};
  }
  createSnapshot(projectId,body){
    return this.store.write(projectId,body,'research.snapshot.created',()=>{
      const captureIds=distinct(body.captureIds,'captures'),captures=captureIds.map(c=>this.store.owned('captures',c,projectId));
      need(captures.every(c=>c.kind==='response'),'RESPONSE_CAPTURE_REQUIRED','Snapshots use returned response captures');
      need(new Set(captures.map(c=>c.requestId)).size===captures.length,'ONE_CAPTURE_PER_REQUEST','Select one response per request definition');
      if(body.collectionId){
        const collection=this.store.owned('collections',body.collectionId,projectId);
        need(captures.every(c=>collection.requestIds.includes(c.requestId)),'CAPTURE_OUTSIDE_COLLECTION');
      }
      const basisCounts={};for(const c of captures)basisCounts[c.basis]=(basisCounts[c.basis]??0)+1;
      return this.store.put('snapshots',{projectId,name:text(body.name,'snapshot name',240),captureIds,collectionId:body.collectionId??null,
        summary:{rowCount:captures.reduce((sum,c)=>sum+c.analysis.rowCount,0),captureCount:captures.length,basisCounts,
          missingCount:captures.reduce((sum,c)=>sum+c.analysis.missing.length,0),
          unindexedCount:captures.filter(c=>c.analysis.error).length}});
    });
  }
  snapshot(snapshotId){
    const snapshot=this.store.get('snapshots',snapshotId);
    return{snapshot,captures:snapshot.captureIds.map(c=>this.store.owned('captures',c,snapshot.projectId))};
  }
  snapshotRows(snapshotId,query={}){
    const snapshot=this.store.get('snapshots',snapshotId);return this.store.rows(snapshot.captureIds,query);
  }
  snapshotDocument(snapshotId){
    const value=this.snapshot(snapshotId),ids=new Set();
    for(const capture of value.captures)for(const field of ['bodyFileId','headersFileId','challengeFileId','sourceFileId'])if(capture[field])ids.add(capture[field]);
    return{schema:'stellar-forge.coingecko-snapshot.v1',...value,rows:this.store.allRows(value.snapshot.captureIds),
      files:[...ids].map(f=>this.store.fileInfo(f))};
  }
  createComparison(projectId,body){
    return this.store.write(projectId,body,'research.comparison.created',()=>{
      const baseline=this.store.owned('snapshots',body.baselineId,projectId),current=this.store.owned('snapshots',body.currentId,projectId);
      need(baseline.id!==current.id,'DISTINCT_SNAPSHOTS_REQUIRED');
      const comparisonId=uuid(),result=compareMarketRows(this.store.allRows(baseline.captureIds),this.store.allRows(current.captureIds),comparisonId);
      const comparison=this.store.put('comparisons',{id:comparisonId,projectId,name:text(body.name,'comparison name',240),
        baselineId:baseline.id,currentId:current.id,summary:result.summary});
      this.store.setRows(comparison.id,projectId,result.rows);return comparison;
    });
  }
  comparison(comparisonId){return{comparison:this.store.get('comparisons',comparisonId)}}
  comparisonRows(comparisonId,query={}){
    this.store.get('comparisons',comparisonId);return this.store.rows([comparisonId],query);
  }
  comparisonDocument(comparisonId){
    const comparison=this.store.get('comparisons',comparisonId);
    return{schema:'stellar-forge.coingecko-comparison.v1',comparison,baseline:this.snapshotDocument(comparison.baselineId),
      current:this.snapshotDocument(comparison.currentId),rows:this.store.allRows([comparison.id])};
  }
  saveNote(projectId,body,noteId=null){
    return this.store.write(projectId,body,noteId?'review.updated':'review.created',()=>{
      const previous=noteId?this.store.expected('notes',noteId,body.version):null;
      if(previous)need(previous.projectId===projectId,'WRONG_PROJECT');
      const note=body.note;need(plain(note),'INVALID_NOTE');
      enumValue(note.targetType,['request','capture','row','snapshot','comparison'],'target type');
      id(note.targetId,'target');
      if(note.targetType==='row')need(this.store.db.prepare('SELECT 1 FROM rows WHERE id=? AND project_id=?').get(note.targetId,projectId),'ROW_NOT_FOUND');
      else this.store.owned({request:'requests',capture:'captures',snapshot:'snapshots',comparison:'comparisons'}[note.targetType],note.targetId,projectId);
      const sourceFileIds=note.sourceFileIds??[];
      need(Array.isArray(sourceFileIds)&&sourceFileIds.length<=100&&new Set(sourceFileIds).size===sourceFileIds.length,'INVALID_SOURCE_SELECTION');
      sourceFileIds.forEach(f=>need(this.store.fileInfo(f).projectId===projectId,'WRONG_PROJECT'));
      return this.store.put('notes',{id:noteId??uuid(),projectId,targetType:note.targetType,targetId:note.targetId,
        title:text(note.title,'review title',240),text:text(note.text??'','review text',50000,{empty:true}),
        assignee:text(note.assignee??'','assignee',240,{empty:true}),
        status:enumValue(note.status??'open',['open','reviewed','resolved'],'review status'),
        type:enumValue(note.type??'research',['research','data_quality','follow_up'],'review type'),sourceFileIds,reviewer:body.actor});
    });
  }
  note(noteId){return{note:this.store.get('notes',noteId)}}
  async saveProviderPlan(projectId,body,planId=null){
    const compiled=await prepareCoinGeckoProduct(body.plan);
    return this.store.write(projectId,body,planId?'provider.plan.updated':'provider.plan.created',()=>{
      if(planId)need(this.store.expected('providerPlans',planId,body.version).projectId===projectId,'WRONG_PROJECT');
      const{plan,...compiledValue}=compiled;
      return this.store.put('providerPlans',{...plan,id:planId??uuid(),projectId,compiled:compiledValue});
    });
  }
  providerPlan(planId){
    const{compiled,...plan}=this.store.get('providerPlans',planId);return{plan,compiled};
  }
  providerDocument(planId){
    const{plan,compiled}=this.providerPlan(planId);
    return{schema:'stellar-forge.coingecko-provider-deployment.v1',plan,compiled,
      instructions:'Run the original provider CLI with this plan and the provider’s own callback or licensed upstream environment. Pass an actual facilitator for native payment; omission is explicitly challenge-only.'};
  }
  jobView(job){return this.runner?this.runner.view(job):{...job,canExecute:false,canCancel:false,canResume:false,canRecover:false}}
  job(jobId){return{job:this.jobView(this.store.get('jobs',jobId))}}
  async createProbe(projectId,body){
    need(this.runner,'RUNTIME_REQUIRED');
    const response=this.store.write(projectId,body,'source.probe.created',()=>{
      const requestIds=distinct(body.requestIds,'requests',256),target=enumValue(body.target,['vendor','merchant'],'probe target');
      const items=requestIds.map(requestId=>{
        const saved=this.store.owned('requests',requestId,projectId),request={...saved,...normalizeRequest(saved,this.requestConfig(projectId))};
        need(request.enabled,'REQUEST_DISABLED');need(request.urls[target],'MERCHANT_ORIGIN_REQUIRED');
        return{id:uuid(),requestId,requestVersion:saved.version,request,requestUrl:request.urls[target],status:'queued',attempts:[]};
      });
      return this.store.put('jobs',{projectId,name:text(body.name,'probe name',240),kind:'probe',target,status:'queued',
        total:items.length,completed:0,items,errors:[],cancelRequested:false});
    });
    this.runner.schedule(response.value.id,'probe');return response;
  }
  async createCheckout(collectionId,body){
    need(this.runner,'RUNTIME_REQUIRED');
    const collection=this.store.get('collections',collectionId);
    const prepared=await this.runner.prepareCheckout(collection,body);
    const response=this.store.write(collection.projectId,body,'purchase.prepared',()=>{
      this.store.expected('collections',collectionId,body.version);
      return this.store.put('jobs',{projectId:collection.projectId,id:prepared.id,name:text(body.name,'purchase name',240),
        kind:'checkout',collectionId,buyerProfileId:prepared.buyerProfileId,status:'queued',phase:'intake',purchaseStarted:false,
        total:prepared.items.length,completed:0,items:prepared.items,errors:[],cancelRequested:false});
    });
    this.runner.schedule(response.value.id,'prepare');return response;
  }
  async controlJob(jobId,action,body){
    need(this.runner,'RUNTIME_REQUIRED');
    const current=this.store.get('jobs',jobId);
    const response=this.store.write(current.projectId,body,'job.'+action,()=>{
      const job=this.store.expected('jobs',jobId,body.version);
      this.runner.validateAction(job,action);
      const next={...job,requestedAction:action,cancelRequested:action==='cancel',lastOperator:body.actor};
      if(action!=='cancel'){next.status='queued';next.completedAt=null}
      return this.store.put('jobs',next);
    });
    this.runner.schedule(jobId,action);return response;
  }
  exportProject(projectId,body){
    return this.store.write(projectId,body,'handover.created',()=>{
      if(body.snapshotId)this.store.owned('snapshots',body.snapshotId,projectId);
      if(body.comparisonId)this.store.owned('comparisons',body.comparisonId,projectId);
      const name=text(body.name,'handover name',240),archive=createProjectArchive(this.store,projectId,
        {name,snapshotId:body.snapshotId??null,comparisonId:body.comparisonId??null,actor:body.actor});
      const file=this.store.file(projectId,name+'.json.gz','application/gzip',archive);
      return this.store.put('exports',{projectId,name,fileId:file.id,sha256:file.sha256,bytes:file.bytes,
        snapshotId:body.snapshotId??null,comparisonId:body.comparisonId??null,available:true});
    });
  }
  restore(body){
    const bytes=base64(body.contentBase64,LIMITS.restoreBytes);
    return this.store.write(null,body,'handover.restored',()=>restoreProjectArchive(this.store,bytes,
      {name:text(body.name,'restored project name',240),actor:body.actor}));
  }
  exportBytes(exportId){
    const record=this.store.get('exports',exportId);need(record.available!==false,'ARCHIVE_PAYLOAD_UNAVAILABLE',
      'This retained handover record has no redundant earlier archive payload; create a new complete handover',404);
    return {record,bytes:this.store.fileBytes(record.fileId)};
  }
}
