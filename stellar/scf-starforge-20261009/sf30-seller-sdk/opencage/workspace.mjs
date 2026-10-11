// MIT. One retained geocoding workspace over original private storage, source and release APIs.
import { mkdir,readdir,realpath } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { acquireStateLease } from '../../merchant-fleet-gateway/state-lease.mjs';
import { compileGeocodePlan,productFor,bindGeocodeQuery,queryParameters,identifier,
  API_ORIGIN,API_PATH,object,fail,text,fields } from './config.mjs';
import { createOpenCageSource,readGeocodeResponse } from './source.mjs';
import { GeocodeDelivery,decisionOf } from './customer.mjs';
import { compileGeocodeSeller,packageGeocodeMerchant,inspectGeocodePackage,stageGeocodePackage,runtimeBinding,
  releaseStatus,inspectRelease,compareReleases,activateRelease,rollbackRelease,runActiveRelease } from './merchant.mjs';
import { privateDirectory,readBytes,readJson,writeBytes,writeJson,jsonBytes,digest,exists,
  putOnce,readBundle,publishBundle } from '../twelvedata/files.mjs';
export const WORKSPACE='stellar-forge.opencage-workspace.v1';
export const CAPTURE='stellar-forge.opencage-capture.v1';
export const OBSERVATION='stellar-forge.opencage-http-observation.v1';
const initialDecision=()=>({revision:0,current:null,history:[]});
const safeError=error=>typeof error?.code==='string' && /^[A-Z][A-Z0-9_]{0,100}$/.test(error.code) ? error.code : 'GEOCODE_OPERATION_FAILED';
const same=(a,b)=>digest(jsonBytes(a))===digest(jsonBytes(b));
const now=()=>new Date().toISOString();
function requestFor(configuration,id,productId,input) {
  identifier(id);
  const product=productFor(configuration.plan,productId),query=bindGeocodeQuery(product,input);
  const url=new URL(product.path,configuration.terms.publicOrigin);url.search=queryParameters(query).toString();
  return {schema:'stellar-forge.opencage-request.v1',id,workspaceIdentity:configuration.identity,
    planId:configuration.plan.id,planSha256:configuration.planSha256,termsSha256:configuration.termsSha256,
    productId,mode:product.mode,method:'GET',merchantPreviewUrl:url.href,
    providerEndpoint:API_ORIGIN+API_PATH,query};
}
function validateObservation(observation,request,bytes) {
  fields(observation,['schema','request','response','startedAt','finishedAt','bodySha256','bodyBytes','requestSha256','sourceReference'],'HTTP observation');
  fields(observation.request,['method','endpoint','query'],'observed request');
  fields(observation.response,['status','headers'],'observed response');
  if(!object(observation) || observation.schema !== OBSERVATION || !object(observation.request) ||
      observation.request.method !== 'GET' || observation.request.endpoint !== API_ORIGIN+API_PATH ||
      !same(observation.request.query,request.query) || !object(observation.response) ||
      !Number.isInteger(observation.response.status) || !object(observation.response.headers) ||
      !Number.isFinite(Date.parse(observation.startedAt)) || !Number.isFinite(Date.parse(observation.finishedAt)) ||
      Date.parse(observation.finishedAt)<Date.parse(observation.startedAt) ||
      observation.bodySha256 !== digest(bytes) || observation.bodyBytes !== bytes.length)
    fail('GEOCODE_HTTP_OBSERVATION_MISMATCH');
  const safeHeaders={};
  for(const [name,value] of Object.entries(observation.response.headers)) {
    const normalized=name.toLowerCase();
    if(!['content-type','retry-after','x-ratelimit-limit','x-ratelimit-remaining','x-ratelimit-reset'].includes(normalized) ||
        typeof value!=='string' || /[\r\n\x00]/.test(value)) fail('GEOCODE_OBSERVATION_HEADER_INVALID');
    safeHeaders[normalized]=value;
  }
  if(!/^application\/json(?:\s*;|$)/i.test(safeHeaders['content-type']??''))fail('GEOCODE_PROVIDER_CONTENT_TYPE_INVALID');
  const parsed=readGeocodeResponse(bytes,{httpStatus:observation.response.status,mode:request.mode,query:request.query});
  return {parsed,headers:safeHeaders};
}
export class GeocodeWorkspace {
  static async open(directory,{plan,terms,env=process.env,lookup,clock,readOnly=false}={}) {
    directory=await privateDirectory(resolve(directory),{create:!readOnly});
    if(await realpath(directory)!==directory)fail('GEOCODE_WORKSPACE_PATH_CHANGED');
    const lease=readOnly ? {assertHeld(){fail('GEOCODE_WORKSPACE_READ_ONLY');},async close(){}} : await acquireStateLease(directory);
    try {
      const path=join(directory,'configuration.json');
      let configuration;
      if(await exists(path)) {
        configuration=await readJson(path,1048576);
        const built=compileGeocodeSeller(configuration.plan,configuration.terms);
        const identity=digest(jsonBytes({plan:built.plan,terms:built.terms}));
        if(configuration.schema!==WORKSPACE || configuration.identity!==identity ||
            configuration.planSha256!==built.planSha256 || configuration.termsSha256!==built.termsSha256)
          fail('GEOCODE_WORKSPACE_IDENTITY_CHANGED');
        if(plan!==undefined && !same(compileGeocodePlan(plan),configuration.plan) ||
            terms!==undefined && !same(terms,configuration.terms))fail('GEOCODE_WORKSPACE_CONFIGURATION_CONFLICT');
      } else {
        if(readOnly)fail('GEOCODE_WORKSPACE_NOT_INITIALIZED');
        const built=compileGeocodeSeller(plan,terms);
        configuration={schema:WORKSPACE,createdAt:now(),identity:digest(jsonBytes({plan:built.plan,terms:built.terms})),
          plan:built.plan,terms:built.terms,planSha256:built.planSha256,termsSha256:built.termsSha256};
        await writeJson(path,configuration,{exclusive:true});
      }
      if(!readOnly)for(const name of ['requests','deliveries','merchant-packages','applications'])
        await privateDirectory(join(directory,name));
      return new GeocodeWorkspace(directory,configuration,lease,{env,lookup,clock,readOnly});
    } catch(error){await lease.close();throw error;}
  }
  constructor(directory,configuration,lease,sourceOptions) {
    this.directory=directory;this.configuration=configuration;this.lease=lease;
    this.readOnly=sourceOptions.readOnly===true;
    this.source=createOpenCageSource(configuration.plan,sourceOptions);
    this.releaseRoot=join(directory,'releases');this.queue=Promise.resolve();this.closing=false;this.runtime=null;
  }
  _serial(operation) {
    if(this.readOnly)return Promise.reject(Object.assign(new Error('Workspace is read only'),{code:'GEOCODE_WORKSPACE_READ_ONLY'}));
    if(this.closing)return Promise.reject(Object.assign(new Error('Workspace is closing'),{code:'GEOCODE_WORKSPACE_CLOSING'}));
    const next=this.queue.then(async()=>{this.lease.assertHeld();return operation();});
    this.queue=next.catch(()=>{});return next;
  }
  _root(id){return join(this.directory,'requests',identifier(id));}
  async _configuration() {
    const current=await readJson(join(this.directory,'configuration.json'),1048576);
    if(!same(current,this.configuration))fail('GEOCODE_WORKSPACE_IDENTITY_CHANGED');
    return this.configuration;
  }
  async _request(id,productId,input) {
    const request=requestFor(await this._configuration(),id,productId,input);
    const directory=await privateDirectory(this._root(id));
    await putOnce(join(directory,'request.json'),jsonBytes(request));
    return {request,directory};
  }
  async _read(id) {
    const directory=this._root(id),request=await readJson(join(directory,'request.json'),1048576);
    if(!same(request,requestFor(await this._configuration(),id,request.productId,request.query)))
      fail('GEOCODE_RETAINED_REQUEST_CHANGED');
    if(!await exists(join(directory,'capture','manifest.json'))) {
      const state=await exists(join(directory,'state.json')) ? await readJson(join(directory,'state.json'),65536) :
        {state:'PREPARED',dispatched:false};
      return {directory,request,state,capture:null,decision:initialDecision()};
    }
    const capture=await readBundle(join(directory,'capture'),{schema:CAPTURE});
    const report=JSON.parse(capture.files.get('capture.json')??'null'),body=capture.files.get('response.json');
    if(!object(report) || !body || !capture.files.has('request.json') ||
        !same(JSON.parse(capture.files.get('request.json')),request) ||
        report.requestSha256!==digest(jsonBytes(request)) || report.responseSha256!==digest(body) ||
        report.responseBytes!==body.length || report.complete!==true)fail('GEOCODE_CAPTURE_IDENTITY_CHANGED');
    const identity=digest(jsonBytes({requestSha256:report.requestSha256,responseSha256:report.responseSha256,
      captureSha256:digest(capture.files.get('capture.json')),
      files:[...capture.files].map(([name,value])=>({name,sha256:digest(value)}))}));
    if(identity!==capture.manifest.identity)fail('GEOCODE_CAPTURE_IDENTITY_CHANGED');
    let parsed=null;
    if(report.bodyOrigin==='OPENCAGE_NATIVE_JSON' || report.bodyOrigin==='IMPORTED_OPENCAGE_HTTP' ||
        report.bodyOrigin==='ORIGINAL_SF88_BUYER_RESULT') {
      parsed=readGeocodeResponse(body,{httpStatus:report.providerStatus,mode:request.mode,query:request.query});
    }
    const decision=await exists(join(directory,'decision.json')) ? await readJson(join(directory,'decision.json'),1048576) : initialDecision();
    decisionOf(decision,digest(body),parsed?.candidates.length??0);
    return {directory,request,state:{state:'COMPLETE',...report},capture,decision,parsed};
  }
  async _complete(directory,request,response,observation,extra=[]) {
    const body=response.body instanceof Uint8Array ? Buffer.from(response.body) : jsonBytes(response.body);
    const report={schema:CAPTURE,complete:true,requestSha256:digest(jsonBytes(request)),
      responseSha256:digest(body),responseBytes:body.length,
      applicationStatus:response.status,providerStatus:observation.providerStatus??null,
      outcome:observation.state??'APPLICATION_ERROR',dispatched:observation.dispatched===true,
      bodyOrigin:observation.bodyOrigin,startedAt:observation.startedAt??null,
      finishedAt:observation.finishedAt??now(),headers:response.headers??{},observation};
    const entries=[['request.json',jsonBytes(request)],['response.json',body],['capture.json',jsonBytes(report)],...extra];
    const identity=digest(jsonBytes({requestSha256:report.requestSha256,responseSha256:report.responseSha256,
      captureSha256:digest(jsonBytes(report)),files:entries.map(([name,value])=>({name,sha256:digest(value)}))}));
    await publishBundle(join(directory,'capture'),CAPTURE,identity,entries,{requestId:request.id,
      requestSha256:report.requestSha256,responseSha256:report.responseSha256});
    return this.get(request.id);
  }
  async get(id) {
    const value=await this._read(id),body=value.capture?.files.get('response.json');
    return {request:value.request,state:value.state,decision:value.decision,
      responseSha256:body?digest(body):null,responseBytes:body?.length??0,
      candidates:value.parsed?.candidates.map((candidate,index)=>({...structuredClone(candidate),index,
        selected:value.decision.current?.index===index}))??[],
      semantics:value.parsed?.semantics??null,merchantSelection:value.state.observation?.merchantSelection??null,
      captureIdentity:value.capture?.manifest.identity??null,
      files:value.capture?.manifest.files??[]};
  }
  async overview() {
    const requests=[];
    for(const id of (await readdir(join(this.directory,'requests'))).sort()) {
      if(!/^[a-z][a-z0-9-]{0,47}$/.test(id))continue;
      try {
        const value=await this.get(id);requests.push({id,productId:value.request.productId,query:value.request.query,
          state:value.state.state,outcome:value.state.outcome??null,dispatched:value.state.dispatched,
          providerStatus:value.state.providerStatus??null,candidateCount:value.candidates.length,
          decisionRevision:value.decision.revision,selectedIndex:value.decision.current?.index??null,
          responseSha256:value.responseSha256,finishedAt:value.state.finishedAt??null});
      }catch(error){requests.push({id,state:'READ_ERROR',error:safeError(error)});}
    }
    let merchant={state:'UNPREPARED',generation:0};
    if(await exists(join(this.releaseRoot,'state.json')))merchant=await releaseStatus(this.releaseRoot);
    return {schema:WORKSPACE,identity:this.configuration.identity,configuration:structuredClone(this.configuration),
      source:this.source.inspect(),requests,merchant,ownsRunningRelease:Boolean(this.runtime),
      totals:{requests:requests.length,completed:requests.filter(r=>r.state==='COMPLETE').length,
        selected:requests.filter(r=>r.selectedIndex!==null && r.selectedIndex!==undefined).length}};
  }
  capture({id,productId,input}) {
    return this._serial(async()=>{
      const {request,directory}=await this._request(id,productId,input);
      if(await exists(join(directory,'capture','manifest.json')))return this.get(id);
      if(await exists(join(directory,'state.json')))fail('GEOCODE_PREVIOUS_DISPATCH_REQUIRES_RECONCILIATION',
        'This retained attempt has no complete result. Import its exact observation or create a separately reviewed request.');
      await writeJson(join(directory,'state.json'),{state:'DISPATCHING',requestSha256:digest(jsonBytes(request)),
        startedAt:now(),dispatched:null},{exclusive:true});
      try {
        const result=await this.source.capture(productId,request.query);
        return await this._complete(directory,request,result.response,result.observation,
          result.providerBody ? [['provider-response.json',result.providerBody]] : []);
      } catch(error) {
        await writeJson(join(directory,'state.json'),{state:'RECONCILE_RESULT',requestSha256:digest(jsonBytes(request)),
          dispatched:null,finishedAt:now(),error:safeError(error)}).catch(()=>{});
        throw error;
      }
    });
  }
  importResponse({id,productId,input,observation,bytes}) {
    return this._serial(async()=>{
      bytes=Buffer.from(bytes);
      if(bytes.length>this.configuration.plan.maxResponseBytes)fail('GEOCODE_RESPONSE_TOO_LARGE');
      const {request,directory}=await this._request(id,productId,input);
      const {parsed,headers}=validateObservation(observation,request,bytes);
      if(await exists(join(directory,'capture','manifest.json'))) {
        const prior=await this._read(id);
        if(prior.state.responseSha256!==digest(bytes))fail('GEOCODE_CAPTURE_ALREADY_COMPLETED');
        return this.get(id);
      }
      if(await exists(join(directory,'state.json')) && observation.requestSha256!==digest(jsonBytes(request)))
        fail('GEOCODE_RECONCILIATION_REQUEST_HASH_REQUIRED');
      return this._complete(directory,request,{status:observation.response.status,headers,body:bytes},{
        ...observation,providerStatus:observation.response.status,state:parsed.state,dispatched:true,
        bodyOrigin:'IMPORTED_OPENCAGE_HTTP',semantics:parsed.semantics,
      },[['http-observation.json',jsonBytes(observation)]]);
    });
  }
  adoptBuyer({id,productId,operation,packageId}) {
    return this._serial(async()=>{
      let terms=this.configuration.terms,selectedPackage=null,packageManifest=null;
      if(packageId){
        const bundle=await inspectGeocodePackage(join(this.directory,'merchant-packages',identifier(packageId)));
        if(bundle.built.planSha256!==this.configuration.planSha256)fail('GEOCODE_PACKAGE_WORKSPACE_MISMATCH');
        terms=bundle.built.terms;selectedPackage={packageId,packageIdentity:bundle.manifest.identity};
        packageManifest=await readBytes(join(bundle.directory,'manifest.json'),1048576);
      }
      const merchantSelection={schema:'stellar-forge.opencage-buyer-merchant.v1',
        ...(selectedPackage??{packageId:null,packageIdentity:null}),termsSha256:digest(jsonBytes(terms)),
        publicOrigin:terms.publicOrigin,workspaceTermsSha256:this.configuration.termsSha256};
      const delivery=await GeocodeDelivery.fromOperation(operation,{plan:this.configuration.plan,productId,
        publicOrigin:terms.publicOrigin});
      const {request,directory}=await this._request(id,productId,delivery.request.query);
      if(await exists(join(directory,'capture','manifest.json'))) {
        const prior=await this._read(id);
        if(prior.state.responseSha256!==delivery.responseSha256 || prior.state.bodyOrigin!=='ORIGINAL_SF88_BUYER_RESULT' ||
            !same(prior.state.observation.originalRequest,delivery.request) ||
            !same(prior.state.observation.merchantSelection,merchantSelection))fail('GEOCODE_CAPTURE_ALREADY_COMPLETED');
        return this.get(id);
      }
      const attachments=[...delivery.attachments,['merchant-selection.json',jsonBytes(merchantSelection)],
        ['merchant-terms.json',jsonBytes(terms)],...(packageManifest?[['merchant-package-manifest.json',packageManifest]]:[])];
      return this._complete(directory,request,{status:200,headers:{'content-type':'application/json'},body:delivery.bytes()},
        {providerStatus:200,state:delivery.parsed.state,dispatched:true,bodyOrigin:'ORIGINAL_SF88_BUYER_RESULT',
          provenance:delivery.provenance,originalRequest:delivery.request,merchantSelection,
          semantics:delivery.parsed.semantics,finishedAt:now()},attachments);
    });
  }
  select({id,responseSha256,index,expectedRevision,note=''}) {
    return this._serial(async()=>{
      const value=await this._read(id);
      if(!value.parsed || value.state.providerStatus!==200)fail('GEOCODE_RESULT_NOT_SELECTABLE');
      if(value.state.responseSha256!==responseSha256)fail('GEOCODE_SELECTION_RESPONSE_CHANGED');
      if(value.decision.revision!==expectedRevision)fail('GEOCODE_DECISION_CONFLICT');
      if(index!==null && (!Number.isSafeInteger(index)||index<0||index>=value.parsed.candidates.length))
        fail('GEOCODE_CANDIDATE_INDEX_INVALID');
      if(typeof note!=='string'||note.length>2000||/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(note))fail('GEOCODE_DECISION_NOTE_INVALID');
      if(value.decision.revision>=1000)fail('GEOCODE_DECISION_HISTORY_FULL');
      const current={revision:expectedRevision+1,responseSha256,index,note,at:now()};
      const decision={revision:current.revision,current,history:[...value.decision.history,current]};
      await writeJson(join(value.directory,'decision.json'),decision);
      return this.get(id);
    });
  }
  async delivery(id) {
    const value=await this._read(id);
    if(!value.parsed || value.state.providerStatus!==200)fail('GEOCODE_RESULT_NOT_DELIVERABLE');
    return new GeocodeDelivery({bytes:value.capture.files.get('response.json'),request:value.request,
      provenance:{kind:value.state.bodyOrigin,captureIdentity:value.capture.manifest.identity,
        captureManifestSha256:value.capture.manifestSha256,
        ...(value.state.observation?.merchantSelection ? {merchantSelection:value.state.observation.merchantSelection,
          originalBuyerRequest:value.state.observation.originalRequest} : {})},decision:value.decision,
      attachments:new Map([...value.capture.files].filter(([name])=>name!=='response.json'))});
  }
  export({id,responseSha256,expectedRevision}) {
    return this._serial(async()=>{
      const delivery=await this.delivery(id);
      if(delivery.responseSha256!==responseSha256 || delivery.decision.revision!==expectedRevision)
        fail('GEOCODE_EXPORT_REVIEW_CHANGED');
      const exportId=identifier(id).slice(0,24)+'-r'+delivery.decision.revision+'-'+delivery.identity.slice(0,12);
      const result=await delivery.export(join(this.directory,'deliveries',exportId));
      return {exportId,...result,delivery:delivery.inspect()};
    });
  }
  async openExport(exportId) {
    identifier(exportId);
    const directory=join(this.directory,'deliveries',exportId);
    const delivery=await GeocodeDelivery.open(directory);
    return {directory,delivery};
  }
  package({terms=this.configuration.terms}={}) {
    return this._serial(async()=>{
      const built=compileGeocodeSeller(this.configuration.plan,terms),runtime=await runtimeBinding();
      const packageId='merchant-'+digest(jsonBytes({identity:this.configuration.identity,terms:built.terms,runtime})).slice(0,24);
      const result=await packageGeocodeMerchant(join(this.directory,'merchant-packages',packageId),
        this.configuration.plan,built.terms);
      return {packageId,...result};
    });
  }
  stage({packageId,id,label,facilitator,port=0}) {
    return this._serial(async()=>{
      identifier(packageId);identifier(id);
      const directory=join(this.directory,'merchant-packages',packageId),bundle=await inspectGeocodePackage(directory);
      if(bundle.built.planSha256!==this.configuration.planSha256)
        fail('GEOCODE_PACKAGE_WORKSPACE_MISMATCH');
      return stageGeocodePackage(this.releaseRoot,join(this.directory,'applications'),directory,{id,label,facilitator,port});
    });
  }
  async releaseDiff(before,after){return compareReleases(this.releaseRoot,before||null,identifier(after));}
  async listDeliveries() {
    const results=[];
    for(const exportId of (await readdir(join(this.directory,'deliveries'))).sort()) {
      if(!/^[a-z][a-z0-9-]{0,47}$/.test(exportId))continue;
      const manifest=await readJson(join(this.directory,'deliveries',exportId,'manifest.json'),1048576);
      results.push({exportId,identity:manifest.identity,candidateCount:manifest.candidateCount,
        selectedIndex:manifest.selectedIndex,decisionRevision:manifest.decisionRevision,files:manifest.files});
    }
    return results;
  }
  async listPackages() {
    const results=[];
    for(const packageId of (await readdir(join(this.directory,'merchant-packages'))).sort()) {
      if(!/^[a-z][a-z0-9-]{0,47}$/.test(packageId))continue;
      const manifest=await readJson(join(this.directory,'merchant-packages',packageId,'manifest.json'),1048576);
      results.push({packageId,manifest});
    }
    return results;
  }
  async readCaptureFile(id,name) {
    const value=await this._read(id),bytes=value.capture?.files.get(name);
    if(!bytes)fail('GEOCODE_ARTIFACT_UNKNOWN');return Buffer.from(bytes);
  }
  importPackage(directory) {
    return this._serial(async()=>{
      const bundle=await inspectGeocodePackage(directory);
      if(bundle.built.planSha256!==this.configuration.planSha256)fail('GEOCODE_PACKAGE_WORKSPACE_MISMATCH');
      const packageId='merchant-'+bundle.manifest.identity.slice(0,24);
      const result=await publishBundle(join(this.directory,'merchant-packages',packageId),
        bundle.manifest.schema,bundle.manifest.identity,[...bundle.files],{
          planId:bundle.manifest.planId,planSha256:bundle.manifest.planSha256,
          termsSha256:bundle.manifest.termsSha256,source:bundle.manifest.source});
      return {packageId,...result};
    });
  }
  activate({id,expectedGeneration,reason='Reviewed geocoding release'}) {
    return this._serial(()=>activateRelease(this.releaseRoot,identifier(id),{expectedGeneration,reason}));
  }
  rollback({expectedGeneration,reason='Return to previous geocoding release'}) {
    return this._serial(()=>rollbackRelease(this.releaseRoot,{expectedGeneration,reason}));
  }
  start({expectedGeneration}) {
    return this._serial(async()=>{
      if(this.runtime)fail('GEOCODE_RELEASE_ALREADY_OWNED');
      const runtime=await runActiveRelease(this.releaseRoot,{expectedGeneration,handleSignals:false});
      this.runtime=runtime;
      void runtime.completion.finally(()=>{if(this.runtime===runtime)this.runtime=null;}).catch(()=>{});
      return {url:runtime.url,mode:runtime.mode,release:runtime.release,observation:runtime.observation};
    });
  }
  stop() {
    return this._serial(async()=>{
      if(!this.runtime)fail('GEOCODE_NO_OWNED_RUNNING_RELEASE');
      const runtime=this.runtime,result=await runtime.close();if(this.runtime===runtime)this.runtime=null;return result;
    });
  }
  async close() {
    if(this._closing)return this._closing;
    this.closing=true;
    return this._closing=(async()=>{await this.queue;this.source.close();await this.runtime?.close();await this.lease.close();})();
  }
}
