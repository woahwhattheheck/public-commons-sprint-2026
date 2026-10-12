// MIT. One retained Public Assistance workspace over the original source, publisher and buyer engines.
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {openWorkspaceStore,jsonBytes,stable} from '../stellar-expert/store.mjs';
import {createOpenFemaCapture} from './capture.mjs';
import {analyzePortfolio,validatePortfolio,validateAnnotation,comparePortfolios,tableView,datasetProjection,csv,fault,string} from './domain.mjs';
import {WORKSPACE_SCHEMA,ACTIONS,workspaceSchema} from './schema.mjs';
import {preparePortfolioDataset,queryNativeDataset,nativePublishers,prepareNativeRelease,inspectNativeRelease,controlNativeRelease,inspectBuyer,receiveBuyer,readBuyerOutput} from './dataset.mjs';
import {workspaceArchive,portfolioReport} from './exports.mjs';
const hash=value=>createHash('sha256').update(typeof value==='string'?value:stable(value)).digest('hex');
const idOf=(state,operationId)=>hash({workspaceId:state.workspaceId,operationId}).slice(0,24);
const choose=(list,id,label)=>{const selected=list.find(x=>x.id===id);if(!selected)throw fault('OPENFEMA_SELECTION','Select a retained '+label+'.',404);return selected;};
const copy=value=>structuredClone(value);
function publicError(error){
  const code=typeof error.code==='string'?error.code:'OPENFEMA_OPERATION';
  return {code,message:error.message||'This operation could not finish.',status:error.status??(['ENOSPC','EDQUOT'].includes(code)?507:/CHANGED|REVISION|GENERATION|BUSY/.test(code)?409:400),retryAt:error.retryAt??null};
}
export async function openOpenFemaWorkspace({directory,inboxDirectory,releaseRuntime={port:0},fetchImpl=fetch,userAgent}={}){
  const store=await openWorkspaceStore(directory,{schema:WORKSPACE_SCHEMA,initialState:{portfolios:[],portfolioVersions:[],reviews:[],acceptances:[],comparisons:[],selectedPortfolioId:null,selectedVersionId:null}});
  const capture=createOpenFemaCapture({store,fetchImpl,userAgent}),publishers=nativePublishers(store),running=new Map(),controllers=new Map(),cache=new Map();
  let closed=false,tail=Promise.resolve();
  const releaseCapability=()=>({mode:releaseRuntime.facilitator?'NATIVE_X402':'CHALLENGE_ONLY',port:releaseRuntime.port??0,facilitatorConfigured:Boolean(releaseRuntime.facilitator),allowLocalFacilitator:releaseRuntime.allowLocalFacilitator===true});
  const schema=()=>workspaceSchema({workspaceId:store.read().workspaceId,inboxConfigured:Boolean(inboxDirectory),releaseRuntime:releaseCapability()});
  async function version(id){
    const selected=choose(store.read().portfolioVersions,id,'portfolio version');
    if(!cache.has(id)){const value=JSON.parse((await store.object(selected.sha256)).toString('utf8'));cache.set(id,value);if(cache.size>3)cache.delete(cache.keys().next().value);}
    return {record:selected,portfolio:copy(cache.get(id))};
  }
  async function editions(){
    const state=store.read(),result=[];
    for(const id of [...state.editionIds].reverse()){
      const e=await store.edition(id);result.push({id:e.id,captureId:e.captureId,scope:e.scope,label:e.label,createdAt:e.createdAt,completedAt:e.completedAt,sourceSha256:e.sourceSha256,
        issues:e.issues,consistency:e.consistency,datasets:Object.fromEntries(Object.entries(e.datasets).map(([k,d])=>[k,{entity:d.entity,version:d.version,rowCount:d.rowCount,sourceCount:d.sourceCount,metadataReceipt:d.metadataReceipt,metadataEndReceipt:d.metadataEndReceipt,fieldsReceipt:d.fieldsReceipt,pages:d.pages.length}]))});
    }
    return result;
  }
  async function view(){
    const s=store.read();
    return {schema:'stellar-forge.openfema-workspace-view.v1',workspaceId:s.workspaceId,revision:s.revision,createdAt:s.createdAt,
      captures:s.captures.map(c=>({id:c.id??c.captureId,label:c.label,scope:c.scope,state:c.state??c.status,createdAt:c.createdAt,updatedAt:c.updatedAt,editionId:c.editionId,error:c.error,retryAt:c.retryAt,datasets:c.datasets,progress:c.progress})),
      editions:await editions(),portfolios:s.portfolios,versions:s.portfolioVersions,reviews:s.reviews,acceptances:s.acceptances,comparisons:s.comparisons,
      selectedPortfolioId:s.selectedPortfolioId,selectedVersionId:s.selectedVersionId,datasets:s.datasets,releases:s.releases,receipts:s.receipts,exports:s.exports,
      operations:Object.values(s.operations).slice(-100).reverse().map(({payload,context,...op})=>op),capabilities:{inboxConfigured:Boolean(inboxDirectory),releaseRuntime:releaseCapability()}};
  }
  function launch(captureId){
    if(running.has(captureId)||closed)return;
    const control=new AbortController();controllers.set(captureId,control);
    const task=Promise.resolve().then(()=>capture.run(captureId,{signal:control.signal})).catch(()=>{}).finally(()=>{controllers.delete(captureId);running.delete(captureId);});
    running.set(captureId,task);
  }
  async function loadTables(editionId){
    const tables={declarations:[],applicants:[],projects:[]};
    for(const kind of Object.keys(tables))for await(const row of capture.rows(editionId,kind))tables[kind].push(row);
    return tables;
  }
  async function makeVersion({portfolioId,editionId,criteria,annotations,versionId,createdAt,number,previousVersionId,reason}){
    const retained=store.read().portfolioVersions.find(v=>v.id===versionId);
    if(retained)return retained;
    const edition=await store.edition(editionId),tables=await loadTables(editionId),analysis=analyzePortfolio({edition,tables,spec:criteria,annotations});
    const bytes=jsonBytes(analysis);
    if(bytes.length>256*1024*1024)throw fault('OPENFEMA_PORTFOLIO_SIZE','This complete portfolio exceeds 256 MiB. Retain the full source and select a smaller regional portfolio.',413);
    const saved=await store.putObject(bytes);
    cache.set(versionId,analysis);if(cache.size>3)cache.delete(cache.keys().next().value);
    return {id:versionId,portfolioId,number,editionId,sha256:saved.sha256,bytes:saved.bytes,createdAt,previousVersionId:previousVersionId??null,reason,criteria:analysis.criteria,summary:analysis.summary};
  }
  async function reserve(request){
    if(!request||typeof request!=='object'||Array.isArray(request)||Object.keys(request).some(k=>!['operationId','action','payload','expectedRevision'].includes(k)))throw fault('OPENFEMA_ACTION','Provide one workspace action.');
    const operationId=string(request.operationId,'operation ID',160),action=request.action;
    if(!/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(operationId)||!Object.hasOwn(ACTIONS,action))throw fault('OPENFEMA_ACTION','Select a supported action and original operation ID.');
    let payload=copy(request.payload??{});
    if(!payload||typeof payload!=='object'||Array.isArray(payload)||Object.keys(payload).some(k=>!ACTIONS[action].includes(k)))throw fault('OPENFEMA_ACTION_FIELDS','This action contains an unknown field.');
    if(action==='source.import'){
      const saved=await store.putObject(jsonBytes(payload.bundle));payload={bundleSha256:saved.sha256};
    }
    const selectionSha256=hash({action,payload});
    return store.mutate(s=>{
      const prior=s.operations[operationId];
      if(prior){if(prior.selectionSha256!==selectionSha256)throw fault('OPENFEMA_OPERATION_CHANGED','This operation ID already belongs to different inputs.',409);return copy(prior);}
      if(request.expectedRevision!==s.revision)throw fault('OPENFEMA_REVISION_CHANGED','The workspace advanced. Reload its current version before saving this action.',409);
      const op={operationId,id:idOf(s,operationId),action,payload,selectionSha256,state:'PENDING',createdAt:new Date().toISOString(),attempts:0,
        context:{inboxDirectory:inboxDirectory?resolve(inboxDirectory):null,releaseRuntime:copy(releaseRuntime)}};
      s.operations[operationId]=op;return copy(op);
    });
  }
  async function saveExport(op,{bytes,name,type,format,versionId=null,table=null,kind='portfolio'}){
    if(!Buffer.isBuffer(bytes))bytes=Buffer.from(bytes);
    const saved=await store.putObject(bytes),record={id:'export-'+op.id,kind,versionId,table,format,name,type,createdAt:op.createdAt,...saved,downloadUrl:'/api/exports/export-'+op.id};
    await store.mutate(s=>{if(!s.exports.some(x=>x.id===record.id))s.exports.push(record);});return record;
  }
  async function execute(op){
    const p=op.payload,s=store.read(),deterministicVersion=hash({workspaceId:s.workspaceId,operationId:op.operationId,kind:'portfolio-version'});
    let result,launchId=null;
    switch(op.action){
      case 'source.capture':{
        const record=await capture.begin({id24:op.id,scope:p.scope,label:p.label??'Public Assistance source'});result={capture:record,captureId:op.id};launchId=op.id;break;
      }
      case 'source.resume':{
        result={capture:await capture.status(p.captureId),captureId:p.captureId};launchId=p.captureId;break;
      }
      case 'source.pause':{
        controllers.get(p.captureId)?.abort(fault('OPENFEMA_CAPTURE_PAUSED','Capture paused by the operator.'));
        if(running.has(p.captureId))await running.get(p.captureId);
        result=await capture.status(p.captureId);break;
      }
      case 'source.import':result=await capture.importBundle(JSON.parse((await store.object(p.bundleSha256)).toString('utf8')));break;
      case 'portfolio.create':{
        const portfolioId='portfolio-'+op.id,existing=s.portfolios.find(x=>x.id===portfolioId);
        if(existing){result={portfolio:existing,version:choose(s.portfolioVersions,existing.currentVersionId,'portfolio version')};break;}
        const criteria=validatePortfolio({...p.criteria,name:p.name??p.criteria?.name}),record=await makeVersion({portfolioId,editionId:p.editionId,criteria,annotations:[],versionId:deterministicVersion,createdAt:op.createdAt,number:1,reason:'Initial portfolio'});
        const portfolio={id:portfolioId,name:criteria.name,createdAt:op.createdAt,updatedAt:op.createdAt,currentVersionId:record.id,number:1};
        await store.mutate(n=>{if(!n.portfolios.some(x=>x.id===portfolioId)){n.portfolios.push(portfolio);n.portfolioVersions.push(record);}n.selectedPortfolioId=portfolioId;n.selectedVersionId=record.id;});
        result={portfolio,version:record};break;
      }
      case 'portfolio.revise':
      case 'review.save':{
        const current=choose(s.portfolios,p.portfolioId,'portfolio'),existing=s.portfolioVersions.find(v=>v.id===deterministicVersion);
        if(existing){result={portfolio:current,version:existing};break;}
        const expected=op.action==='review.save'?p.versionId:p.expectedVersion;
        if(current.currentVersionId!==expected)throw fault('OPENFEMA_PORTFOLIO_CHANGED','Choose the current portfolio version for this edit.',409);
        const previous=await version(current.currentVersionId);let annotations=copy(previous.portfolio.annotations),review=null;
        if(op.action==='review.save'){
          review={...validateAnnotation(p.annotation),id:'review-'+op.id,portfolioId:p.portfolioId,basedOnVersionId:expected,createdAt:op.createdAt};
          const subjects=new Set([...previous.portfolio.projects,...previous.portfolio.applicants,...previous.portfolio.disasters,...previous.portfolio.declarations].map(r=>r.subject));
          if(!subjects.has(review.subject))throw fault('OPENFEMA_REVIEW_SUBJECT','Select a project, applicant, declaration area or disaster in this portfolio.');
          annotations=annotations.filter(a=>a.subject!==review.subject);annotations.push(review);
        }
        const criteria=op.action==='review.save'?previous.portfolio.criteria:validatePortfolio(p.criteria),editionId=op.action==='review.save'?previous.record.editionId:p.editionId;
        const record=await makeVersion({portfolioId:current.id,editionId,criteria,annotations,versionId:deterministicVersion,createdAt:op.createdAt,number:current.number+1,previousVersionId:current.currentVersionId,reason:review?'Analyst review':'Portfolio/source revision'});
        await store.mutate(n=>{
          const portfolio=choose(n.portfolios,current.id,'portfolio');
          if(portfolio.currentVersionId!==expected&&portfolio.currentVersionId!==record.id)throw fault('OPENFEMA_PORTFOLIO_CHANGED','This portfolio advanced during the edit.',409);
          if(!n.portfolioVersions.some(v=>v.id===record.id))n.portfolioVersions.push(record);
          if(review&&!n.reviews.some(r=>r.id===review.id))n.reviews.push(review);
          Object.assign(portfolio,{name:criteria.name,number:record.number,currentVersionId:record.id,updatedAt:op.createdAt});n.selectedPortfolioId=current.id;n.selectedVersionId=record.id;
        });
        result={portfolio:choose(store.read().portfolios,current.id,'portfolio'),version:record,review};break;
      }
      case 'portfolio.select':{
        const selected=choose(s.portfolios,p.portfolioId,'portfolio'),v=choose(s.portfolioVersions,p.versionId??selected.currentVersionId,'version');
        if(v.portfolioId!==selected.id)throw fault('OPENFEMA_VERSION','Select a version of this portfolio.');
        await store.mutate(n=>{n.selectedPortfolioId=selected.id;n.selectedVersionId=v.id;});result={portfolioId:selected.id,versionId:v.id};break;
      }
      case 'portfolio.compare':{
        const [a,b]=await Promise.all([version(p.beforeVersionId),version(p.afterVersionId)]),comparison=comparePortfolios(a.portfolio,b.portfolio);
        const saved=await saveExport(op,{bytes:jsonBytes(comparison),name:'OpenFEMA_Portfolio_Changes.json',type:'application/json',format:'json',versionId:b.record.id,kind:'comparison'});
        const record={id:'comparison-'+op.id,beforeVersionId:a.record.id,afterVersionId:b.record.id,sameScope:comparison.sameScope,scopeMeaning:comparison.scopeMeaning,summary:comparison.summary,export:saved,createdAt:op.createdAt};
        await store.mutate(n=>{if(!n.comparisons.some(x=>x.id===record.id))n.comparisons.push(record);});
        result={...record,preview:{added:comparison.added.slice(0,100),removed:comparison.removed.slice(0,100),changed:comparison.changed.slice(0,100)}};break;
      }
      case 'review.accept':{
        const selected=await version(p.versionId);if(selected.record.portfolioId!==p.portfolioId)throw fault('OPENFEMA_REVIEW_PORTFOLIO','Select the version of this portfolio.');
        const record={id:'acceptance-'+op.id,portfolioId:p.portfolioId,versionId:p.versionId,sha256:selected.record.sha256,note:string(p.note,'acceptance note',12000),createdAt:op.createdAt};
        await store.mutate(n=>{if(!n.acceptances.some(x=>x.id===record.id))n.acceptances.push(record);});result=record;break;
      }
      case 'dataset.prepare':{
        const selected=await version(p.versionId);
        result=await preparePortfolioDataset(store,{edition:await store.edition(selected.record.editionId),portfolio:selected.portfolio,portfolioVersion:selected.record,table:p.table??'projects',name:p.name??selected.portfolio.criteria.name,id:'dataset-'+op.id});
        await store.mutate(n=>{if(!n.datasets.some(d=>d.id===result.id))n.datasets.push(result);});break;
      }
      case 'dataset.query':result=await queryNativeDataset(store,choose(s.datasets,p.datasetId,'dataset'),p.query??'');break;
      case 'release.prepare':{
        result=await prepareNativeRelease(store,{dataset:choose(s.datasets,p.datasetId,'dataset'),origin:p.origin,path:p.path??'/public-assistance',payment:p.payment,id:'openfema-'+op.id,runtime:op.context.releaseRuntime,publishers});
        await store.mutate(n=>{if(!n.releases.some(r=>r.id===result.id))n.releases.push(result);});break;
      }
      case 'release.inspect':result=await inspectNativeRelease(store,choose(s.releases,p.releaseId,'release'),publishers);break;
      case 'release.activate':case 'release.start':case 'release.stop':case 'release.rollback':
        result=await controlNativeRelease(store,choose(s.releases,p.releaseId,'release'),op.action.split('.')[1],p,publishers);break;
      case 'buyer.inspect':result=await inspectBuyer(op.context.inboxDirectory,p.intentIds);break;
      case 'buyer.receive':{
        result=await receiveBuyer(store,op.context.inboxDirectory,p.intentIds,'buyer-'+op.id);
        await store.mutate(n=>{if(!n.receipts.some(r=>r.id===result.id))n.receipts.push(result);});break;
      }
      case 'export.create':{
        const selected=await version(p.versionId),table=p.table??'projects',format=p.format??'json';
        if(!['json','csv','html'].includes(format))throw fault('OPENFEMA_EXPORT_FORMAT','Choose JSON, spreadsheet CSV or report HTML.');
        const projection=datasetProjection(selected.portfolio,table);
        const body=format==='json'?jsonBytes(selected.portfolio):format==='csv'?Buffer.from(csv(projection.columns,projection.rows,{spreadsheet:true})):Buffer.from(portfolioReport(selected.portfolio,selected.record));
        result=await saveExport(op,{bytes:body,name:'OpenFEMA_'+table+'_'+selected.record.id.slice(0,12)+'.'+format,type:format==='html'?'text/html; charset=utf-8':format==='csv'?'text/csv; charset=utf-8':'application/json',format,versionId:selected.record.id,table});break;
      }
      case 'source.export':result=await saveExport(op,{bytes:jsonBytes(await capture.exportBundle(p.editionId)),name:'OpenFEMA_Original_Source_'+p.editionId.slice(0,12)+'.json',type:'application/json',format:'source-package',kind:'source'});break;
      case 'workspace.export':{
        if(running.size)throw fault('OPENFEMA_CAPTURE_ACTIVE','Pause the running source capture before making a complete workspace handover.',409);
        const artifact=await workspaceArchive(store);
        result=await saveExport(op,{bytes:artifact.bytes,name:'OpenFEMA_Complete_Workspace.zip',type:'application/zip',format:'zip',kind:'workspace'});break;
      }
    }
    const saved=await store.putObject(jsonBytes(result));
    await store.mutate(n=>{const current=n.operations[op.operationId];current.state='COMPLETE';current.completedAt=new Date().toISOString();current.resultSha256=saved.sha256;current.error=null;});
    if(launchId)launch(launchId);return result;
  }
  async function perform(request){
    if(closed)throw fault('OPENFEMA_CLOSED','Reopen the original workspace.',503);
    const op=await reserve(request);
    if(op.state==='COMPLETE')return {operationId:op.operationId,reused:true,result:JSON.parse((await store.object(op.resultSha256)).toString('utf8')),view:await view()};
    await store.mutate(n=>{const current=n.operations[op.operationId];current.state='RUNNING';current.attempts++;current.error=null;});
    try{return {operationId:op.operationId,reused:op.attempts>0,result:await execute(op),view:await view()};}
    catch(error){const info=publicError(error);await store.mutate(n=>{const current=n.operations[op.operationId];if(current.state!=='COMPLETE'){current.state='FAILED';current.error=info;current.failedAt=new Date().toISOString();}});throw Object.assign(error,info,{operationId:op.operationId,currentRevision:store.read().revision});}
  }
  const action=request=>{const pending=tail.then(()=>perform(request));tail=pending.catch(()=>{});return pending;};
  return {store,schema,view,action,editions,version,capture,
    async rows(versionId,options){return tableView((await version(versionId)).portfolio,options);},
    async detail(versionId,table,id){const data=(await version(versionId)).portfolio;if(!Array.isArray(data[table]))throw fault('OPENFEMA_TABLE','Choose a portfolio table.');const row=data[table].find(r=>r.id===id||r.subject===id||r.key===id||r.disasterNumber===id);if(!row)throw fault('OPENFEMA_RECORD','Select an original portfolio record.',404);return copy(row);},
    async raw(sha256){return {bytes:await store.object(sha256),type:'application/json; charset=utf-8'};},
    async exported(id){const item=choose(store.read().exports,id,'export');return {item,bytes:await store.object(item.sha256)};},
    async received(id,name){return readBuyerOutput(store,choose(store.read().receipts,id,'customer delivery'),name);},
    async operation(id){return copy(store.read().operations[id]??null);},
    async waitForCaptures(){await Promise.allSettled([...running.values()]);return view();},
    async close(){if(closed)return;closed=true;for(const control of controllers.values())control.abort();await Promise.allSettled([...running.values(),tail]);try{await publishers.close();}finally{await store.close();}}
  };
}
