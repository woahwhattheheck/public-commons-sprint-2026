// MIT. Original SF61 package/source review and SF82 deployment integration.
import {join} from 'node:path';
import {lstat,readFile,readdir,mkdir} from 'node:fs/promises';
import {digest,stable,identifier,plain,fail,text,FIELD_MAP,SOURCE} from './contract.mjs';
import {readReview} from './acquisition.mjs';
const now=()=>new Date().toISOString();
const sourceModel=()=>import('../workspace/model.mjs');
const releaseModel=()=>import('../../sf82-seller-pilot/releases.mjs');
const findProject=(store,id)=>store.snapshot().projects[identifier(id)]??fail('PROJECT_MISSING','Project was not found',404);

export async function importInventory(store,{project:projectId,specText,sourceUrl='',name='Customer API'}){
  const project=findProject(store,projectId);
  if(typeof specText!=='string'||Buffer.byteLength(specText)>4*1024*1024)fail('SOURCE_LIMIT','Use an OpenAPI source within 4 MiB');
  if(sourceUrl){const u=new URL(sourceUrl);if(u.protocol!=='https:'||u.username||u.password)fail('INVALID_INPUT','Source URL must use HTTPS without credentials');}
  const {inspectOpenApi}=await sourceModel(),inspection=inspectOpenApi(specText);
  const core={schema:'stellar-forge.openweather-inventory.v1',name:text(name,'Source name'),specText,sourceUrl,inspection},sourceId=digest(core);
  const ref=await store.write('sources',sourceId,core);
  await store.transaction(s=>{
    const p=s.projects[project.id];if(!p.sources.some(row=>row.id===sourceId)){p.sources.push({...ref,name:core.name,sourceUrl,createdAt:now()});s.retainedBytes+=ref.bytes;}
  });return {...ref,inspection};
}
const number={type:'number'};
const weatherRecord={type:'object',required:['at'],properties:{
  at:{type:'integer',description:'Unix seconds UTC'},temperature:number,feelsLike:number,dewPoint:number,pressure:number,
  humidity:{type:'number',minimum:0,maximum:100},clouds:{type:'number',minimum:0,maximum:100},visibility:number,
  uvIndex:number,windSpeed:number,windGust:number,windDirection:number,rainRate:number,snowRate:number,
  precipitationProbability:{type:'number',minimum:0,maximum:1},sunrise:{type:'integer'},sunset:{type:'integer'},
  weather:{type:'array',items:{type:'object',properties:{id:{type:'integer'},main:{type:'string'},description:{type:'string'},icon:{type:'string'}}}},
  alertIds:{type:'array',items:{type:'string'}}}};
export function customerContract(review,origin){
  const url=new URL(origin);
  if(url.href!==url.origin+'/'||url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port)
    fail('INVALID_INPUT','Use the weather application’s actual loopback origin');
  const base=url.origin+'/weather/'+review.data.project+'/'+review.id;
  const common={schema:{type:'string'},project:{type:'string'},review:{type:'string'},timezone:{type:'string',nullable:true},
    units:{type:'object',additionalProperties:{type:'string'}},coverage:{type:'object'},sources:{type:'array',items:{type:'object'}}};
  const response=properties=>({description:'Retained reviewed One Call 4.0 data',content:{'application/json':{schema:{type:'object',required:['schema','project','review'],properties:{...common,...properties}}}}});
  return {openapi:'3.0.3',info:{title:review.selection.label+' weather integration',version:'1.0.0',
    description:'Customer adapter for One Call 4.0. UTC timestamps and original unit semantics; missing phenomena remain absent. Immutable data edition '+review.id},
    servers:[{url:base}],security:[{weatherAccess:[]}],
    components:{securitySchemes:{weatherAccess:{type:'apiKey',in:'header',name:'x-weather-token'}}},
    paths:{
      '/current':{get:{operationId:'weather_current',summary:'Reviewed current weather',responses:{200:response({record:{...weatherRecord,nullable:true}})}}},
      '/hourly':{get:{operationId:'weather_hourly',summary:'Reviewed hourly weather',parameters:[
        {name:'offset',in:'query',schema:{type:'integer',minimum:0},example:0},
        {name:'limit',in:'query',schema:{type:'integer',minimum:1,maximum:200},example:100}],
        responses:{200:response({data:{type:'array',items:weatherRecord},offset:{type:'integer'},total:{type:'integer'},nextOffset:{type:'integer',nullable:true}})}}}
    }};
}
export async function listPackages(store,parent=join(store.root,'packages')){
  const {privateParent,readPackage}=await sourceModel();await privateParent(parent);const rows=[];
  for(const name of (await readdir(parent)).sort()){
    if(!/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(name))continue;
    try{const saved=await readPackage(parent,name);rows.push({name,createdAt:saved.manifest.createdAt,title:saved.manifest.preview?.title});}
    catch(e){rows.push({name,error:e.message});}
  }return rows;
}
export async function prepareIntegration(store,input,{origin,packageParent=join(store.root,'packages')}={}){
  const review=await readReview(store,input.project,input.review),specText=JSON.stringify(customerContract(review,origin),null,2)+'\n';
  const {prepareMerchant}=await sourceModel();let plan,refresh=null;
  if(input.baseline){
    const {createRefreshReview}=await import('../refresh-cli.mjs');
    refresh=await createRefreshReview({parent:packageParent,baselineName:identifier(input.baseline),candidateSpecText:specText,decisions:input.decisions??{}});
    if(!refresh.report.ready)return {ready:false,refresh,issues:refresh.report.issues};
    plan=refresh.report.plan;
  }else{
    if(!plain(input.payment))fail('PAYMENT_REQUIRED','Supply the existing authorized merchant payment settings');
    plan={schema:'stellar-forge.api-merchant-plan.v1',sellerServer:input.sellerServer,payment:input.payment,
      serviceName:input.serviceName??'Reviewed weather',allowLoopbackUpstream:true,
      operations:['current','hourly'].map(kind=>({method:'GET',path:'/'+kind,id:'weather_'+kind,
        amountAtomic:input.amountAtomic?.[kind],headerEnv:{'x-weather-token':'OPENWEATHER_APP_TOKEN'},
        responseValidation:'declared',maxResponseBytes:1024*1024,timeoutMs:15000,
        requestExample:{query:kind==='hourly'?{offset:0,limit:100}:{}}}))};
  }
  const prepared=prepareMerchant(specText,plan);
  const core={schema:'stellar-forge.openweather-merchant-review.v1',project:input.project,dataReview:review.id,specText,plan,
    sourceRefresh:refresh,preview:prepared.preview,packageParent},integrationId=digest(core);
  const ref=await store.write('sources',integrationId,{...core,id:integrationId});
  await store.transaction(s=>{
    const p=s.projects[input.project];p.integrations??=[];if(!p.integrations.some(r=>r.id===integrationId)){p.integrations.push({...ref,createdAt:now(),dataReview:review.id});s.retainedBytes+=ref.bytes;}
  });
  return {ready:true,id:integrationId,preview:prepared.preview,refresh,source:specText,plan};
}
export async function readIntegration(store,projectId,integrationId){
  const p=findProject(store,projectId),ref=p.integrations?.find(r=>r.id===identifier(integrationId));
  if(!ref)fail('INTEGRATION_MISSING','Integration review was not found',404);
  const result=await store.read('sources',integrationId);if(result.sha256!==ref.sha256)fail('INTEGRATION_CHANGED','Integration review changed',409);
  const {id,...core}=result.value;if(digest(core)!==id)fail('INTEGRATION_CHANGED','Integration identity differs',409);
  return result.value;
}
async function completedPackage(parent,name,document){
  const {readPackage,prepareMerchant}=await sourceModel(),saved=await readPackage(parent,name);
  if(saved.specText!==document.specText||stable(saved.plan)!==stable(document.plan))fail('PACKAGE_CONFLICT','Existing package has different reviewed inputs',409);
  const expected=prepareMerchant(document.specText,document.plan);
  const manifest=JSON.parse(await readFile(join(saved.folder,'compiled','manifest.json'),'utf8'));
  for(const [file,hashKey,value] of [['offers.json','offersSha256',expected.imported],['seller-service.json','serviceConfigSha256',expected.service]]){
    const bytes=await readFile(join(saved.folder,'compiled',file));
    if(digest(bytes)!==manifest[hashKey]||stable(JSON.parse(bytes))!==stable(value))fail('PACKAGE_CONFLICT','Existing compiled package differs: '+file,409);
  }return {name,folder:saved.folder,preview:expected.preview,manifest:saved.manifest,reopened:true};
}
export async function exportIntegration(store,{project:projectId,integration:integrationId,name}){
  identifier(name,'Package name');const document=await readIntegration(store,projectId,integrationId);
  const {savePackage}=await sourceModel();
  await store.transaction(s=>{
    const p=s.projects[projectId],previous=p.exports.find(x=>x.name===name);
    if(previous&&previous.integration!==integrationId)fail('PACKAGE_CONFLICT','This package name belongs to another integration review',409);
    if(!previous)p.exports.push({name,integration:integrationId,state:'PREPARING',createdAt:now(),packageParent:document.packageParent});
  });
  let result;
  if(document.sourceRefresh){
    const {exportRefreshReview}=await import('../refresh-cli.mjs');
    result=await exportRefreshReview({parent:document.packageParent,document:document.sourceRefresh,reviewId:document.sourceRefresh.report.reviewId,name});
  }else{
    let exists=true;try{await lstat(join(document.packageParent,name));}catch(e){if(e.code!=='ENOENT')throw e;exists=false;}
    result=exists?await completedPackage(document.packageParent,name,document):
      await savePackage({parent:document.packageParent,name,specText:document.specText,plan:document.plan});
  }
  await store.transaction(s=>{Object.assign(s.projects[projectId].exports.find(x=>x.name===name),{state:'COMPLETE',folder:result.folder,completedAt:now()});});
  return {name,folder:result.folder,integration:integrationId,preview:result.preview,reopened:result.reopened??false,command:result.command??null};
}
export function createDeployment(store){
  const root=join(store.root,'releases');let running=null,gate=Promise.resolve();
  const exclusive=fn=>{const work=gate.then(fn);gate=work.catch(()=>{});return work;};
  const ensure=async()=>{
    const model=await releaseModel();let exists=true;try{await lstat(root);}catch(e){if(e.code!=='ENOENT')throw e;exists=false;}
    if(!exists)await model.initReleaseStore(root);await model.readReleaseState(root);return model;
  };
  const status=async()=>{let exists=true;try{await lstat(root);}catch(e){if(e.code!=='ENOENT')throw e;exists=false;}
    return exists?(await releaseModel()).releaseStatus(root):{state:{generation:0,active:null,previous:null},releases:[],root};};
  const stage=input=>exclusive(async()=>{
    const p=findProject(store,input.project),saved=p.exports.find(e=>e.name===identifier(input.package)&&e.state==='COMPLETE');
    if(!saved)fail('PACKAGE_MISSING','Export the reviewed original merchant package first',409);
    const model=await ensure(),releaseId=identifier(input.id,'Release name');
    const runtime=model.normalizeReleaseRuntime({port:input.port??0,...(input.facilitator?{facilitator:input.facilitator}:{})});
    const document=await readIntegration(store,input.project,saved.integration);
    await completedPackage(saved.packageParent,saved.name,document);
    const nativeWorkspace=await (await import('../../sf82-seller-pilot/release-upstreams.mjs')).readReleaseWorkspace(saved.folder);
    const intent={id:releaseId,package:saved.name,project:input.project,runtime,label:input.label??releaseId};
    await store.transaction(s=>{
      const project=s.projects[input.project];project.stages??=[];const previous=project.stages.find(r=>r.id===releaseId);
      if(previous&&stable(previous.intent)!==stable(intent))fail('RELEASE_CONFLICT','This release name has different retained inputs',409);
      if(!previous)project.stages.push({id:releaseId,intent,state:'PREPARING',createdAt:now()});
    });
    let exists=true;try{await lstat(join(root,'releases',releaseId));}catch(e){if(e.code!=='ENOENT')throw e;exists=false;}
    const release=exists?await model.inspectRelease(root,releaseId):
      await model.stageRelease(root,{id:releaseId,label:intent.label,workspace:saved.folder,runtime});
    if(stable(release.inputPackage)!==stable(nativeWorkspace.provenance)||release.runtime.port!==runtime.port||
      (release.runtime.facilitator??null)!==(runtime.facilitator??null))fail('RELEASE_CONFLICT','Existing release does not match this original package/runtime',409);
    await store.transaction(s=>{Object.assign(s.projects[input.project].stages.find(r=>r.id===releaseId),{state:'COMPLETE',digest:release.digest,completedAt:now()});});
    const current=await model.readReleaseState(root);return {release,generation:current.generation,diff:await model.compareReleases(root,current.active,releaseId)};
  });
  const diff=async id=>{const m=await ensure(),s=await m.readReleaseState(root);return {generation:s.generation,diff:await m.compareReleases(root,s.active,identifier(id))};};
  const select=(input,rollback=false)=>exclusive(async()=>{
    const m=await ensure(),state=await m.readReleaseState(root);
    if(state.generation!==input.expectedGeneration)fail('RELEASE_CONFLICT','Reload the original release comparison before selecting',409);
    if(running){await running.close();running=null;}
    return rollback?m.rollbackRelease(root,{expectedGeneration:input.expectedGeneration,...(input.id?{to:identifier(input.id)}:{}),reason:input.reason??'Weather integration rollback'}):
      m.activateRelease(root,identifier(input.id),{expectedGeneration:input.expectedGeneration,reason:input.reason??'Reviewed weather integration'});
  });
  const start=input=>exclusive(async()=>{
    if(running)fail('RELEASE_RUNNING','The owned original seller is already running',409);
    const m=await ensure();running=await m.runActiveRelease(root,{expectedGeneration:input.expectedGeneration,handleSignals:false});
    const current=running;void current.completion.finally(()=>{if(running===current)running=null;}).catch(()=>{});
    return {url:current.url,mode:current.mode,release:current.release,observation:current.observation};
  });
  const stop=()=>exclusive(async()=>{if(!running)return {stopped:false,status:await status()};const current=running;running=null;return {stopped:true,result:await current.close()};});
  return {root,status,stage,diff,select:input=>select(input),rollback:input=>select(input,true),start,stop,close:stop};
}
