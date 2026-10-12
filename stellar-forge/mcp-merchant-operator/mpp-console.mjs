// MIT. Native MPP customer operations through the original private console.
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { digest, privateDirectory, readJSON, saveJSON } from '../../stellar/scf-starforge-20261009/distribution/runtime-workspace/storage.mjs';
import { MPP_CONNECTION_SCHEMA, MPP_REVIEW_SCHEMA, MAX_MPP_CHUNK_BYTES, stable, fail, need,
  exact, alias, nativeId, sha, publicConfiguration, workspaceIdentity } from './mpp-config.mjs';
export { readMppConfiguration, MPP_CONNECTION_SCHEMA, MAX_MPP_CHUNK_BYTES } from './mpp-config.mjs';

import { MppFileExports, mppFileTools, exportId } from './mpp-files.mjs';

const MAX_RESPONSE=16*1024*1024;
const consoleSchema={type:'string',pattern:'^[a-z][a-z0-9_-]{0,63}$'};
const digestSchema={type:'string',pattern:'^[a-f0-9]{64}$'};
const purchaseSchema={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,95}$'};
const querySchema={type:'object',additionalProperties:{oneOf:[{type:'string'},{type:'array',items:{type:'string'}}]}};
const inputSchema={type:'object',additionalProperties:false,properties:{query:querySchema,json:{}}};
const rangeSchema={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:MAX_MPP_CHUNK_BYTES}};
const read={readOnly:true,idempotent:true,openWorld:false};
const change={destructive:false,idempotent:false,openWorld:false};
const worldRead={...read,openWorld:true};
const worldChange={...change,openWorld:true};
const selected={console:consoleSchema};
export function mppTools(tool) {
  return [
    ...mppFileTools(tool),
    tool('merchant_mpp_export','Retain exact original paid response or merchant handoff bytes for the maintained resumable MCP downloader. Reopen the same exportId after an interrupted reply.',
      {...selected,exportId:{type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'},
        kind:{type:'string',enum:['response','contract','openapi','package']},purchaseId:purchaseSchema,
        profileId:digestSchema,expectedSha256:digestSchema},
      ['console','exportId','kind','expectedSha256'],change),
    tool('merchant_mpp_consoles','List host-declared native MPP consoles and customer configuration aliases. Credentials and executable paths stay on the host.',{},[],read),
    tool('merchant_mpp_status','Read current native customer selection and original paged purchase history while preparation or terminal approval continues.',
      {...selected,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}},['console'],read),
    tool('merchant_mpp_contract','Read a public merchant contract through the original console and this host-selected customer transport. Return its terms and changes for a retained customer review.',
      {...selected,customer:consoleSchema,origin:{type:'string'}},['console','customer','origin'],worldRead),
    tool('merchant_mpp_customer_review','Retain an exact original customer review from a contract or complete customer bundle, using a host-declared customer configuration and the current native revision. Reopen the same reviewId after an interrupted reply.',
      {...selected,customer:consoleSchema,reviewId:purchaseSchema,document:{type:'object'}},
      ['console','customer','reviewId','document'],change),
    tool('merchant_mpp_customer_review_status','Reopen the original customer review and compare its exact profile/revision with the current console. The private original review survives MCP restart.',
      {...selected,reviewId:purchaseSchema},['console','reviewId'],read),
    tool('merchant_mpp_customer_configure','Apply the exact retained customer review and revision. Inspect review_status after interruption; an already selected identical original profile is recovered without another write.',
      {...selected,reviewId:purchaseSchema,expectedReviewSha256:digestSchema},
      ['console','reviewId','expectedReviewSha256'],change),
    tool('merchant_mpp_preview','Preview the exact offer, atomic price, cap, HTTP method, full URL and JSON body under the current native customer profile.',
      {...selected,profileId:digestSchema,offerId:purchaseSchema,inputs:inputSchema},
      ['console','profileId','offerId'],read),
    tool('merchant_mpp_prepare','Queue one original native 402 preparation using a stable purchaseId. The console retains the original profile and request before network preparation. Read the job or original purchase after interruption.',
      {...selected,profileId:digestSchema,offerId:purchaseSchema,purchaseId:purchaseSchema,
        query:querySchema,json:{},challengeId:{type:'string',minLength:1,maxLength:512}},
      ['console','profileId','offerId','purchaseId'],worldChange),
    tool('merchant_mpp_retry_prepare','Retry the same retained original preparation after transport loss, including after the active customer profile changes.',
      {...selected,purchaseId:purchaseSchema},['console','purchaseId'],worldChange),
    tool('merchant_mpp_execute','Queue the original purchase through the console host: exact SF36 terminal approval and reservation, official MPP pull credential, original delivery and SF86 finality accounting. Read the original job and purchase ID.',
      {...selected,purchaseId:purchaseSchema},['console','purchaseId'],worldChange),
    tool('merchant_mpp_resume','Recover the original retained purchase and signed credential after an interrupted payment or response. Uses the original contract, request and accounting record.',
      {...selected,purchaseId:purchaseSchema},['console','purchaseId'],worldChange),
    tool('merchant_mpp_finalize','Reconcile the original transaction through SF86 and the original SF36 reservation. Returns a native background job ID.',
      {...selected,purchaseId:purchaseSchema},['console','purchaseId'],worldChange),
    tool('merchant_mpp_job','Read one original console job. Supply purchaseId to reopen its retained purchase when the console has restarted and the transient job is no longer present.',
      {...selected,jobId:{type:'string',pattern:'^[a-f0-9-]{36}$'},purchaseId:purchaseSchema},
      ['console','jobId'],read),
    tool('merchant_mpp_purchase','Read one retained original purchase or interrupted preparation directly, including its original contract and current response/finality state.',
      {...selected,purchaseId:purchaseSchema},['console','purchaseId'],read),
    tool('merchant_mpp_response_preview','Inspect a retained paid response, its original receipt, transaction, accounting result and SHA256 before downloading its exact bytes.',
      {...selected,purchaseId:purchaseSchema},['console','purchaseId'],read),
    tool('merchant_mpp_response_file','Read SHA-pinned chunks of the original retained paid response. Continue with its exact expectedSha256 and nextOffset; retrieval uses no payment operation.',
      {...selected,purchaseId:purchaseSchema,expectedSha256:digestSchema,...rangeSchema},
      ['console','purchaseId','expectedSha256'],read),
    tool('merchant_mpp_catalog','Read the original active or saved native merchant contract and profile identity for customer handoff.',
      selected,['console'],read),
    tool('merchant_mpp_handoff_file','Read original contract, OpenAPI or complete Node/TypeScript/Python customer bundle bytes for an exact merchant profile. Retain the first SHA256 for every following chunk.',
      {...selected,kind:{type:'string',enum:['contract','openapi','package']},profileId:digestSchema,
        expectedSha256:digestSchema,...rangeSchema},['console','kind','profileId'],read)
  ];
}
function revision(value) {
  need(Number.isSafeInteger(value) && value>=0,'INVALID_PARAMS','Use the current original revision.');
  return value;
}
function range(args) {
  const offset=args.offset??0,limit=args.limit??MAX_MPP_CHUNK_BYTES;
  need(Number.isSafeInteger(offset) && offset>=0 && Number.isSafeInteger(limit) &&
    limit>=1 && limit<=MAX_MPP_CHUNK_BYTES,'INVALID_PARAMS','Use the original byte offset and a bounded chunk size.');
  return {offset,limit};
}
function profileView(profile) {
  return profile?{schema:profile.schema,contract:profile.contract,
    configuration:publicConfiguration(profile.configuration)}:null;
}
function reviewView(record) {
  return {schema:MPP_REVIEW_SCHEMA,reviewId:record.reviewId,console:record.console,
    workspaceIdentity:record.workspaceIdentity,customer:record.customer,
    configurationSha256:record.configurationSha256,reviewSha256:record.sha256,
    createdAt:record.createdAt,revision:record.revision,profileId:record.profileId,
    contractSha256:record.profile.contract.sha256,profile:profileView(record.profile),
    difference:record.difference};
}
function code(error) {return /^[A-Z0-9_]{1,96}$/.test(error?.code??'')?error.code:'MPP_MCP_OPERATION_FAILED';}
function compactConsole(key,value) {
  return {console:key,label:value.label,workspaceIdentity:value.identity,
    customers:Object.entries(value.customers).map(([customer,row])=>({
      customer,label:row.label,configurationSha256:row.configurationSha256,
      configuration:publicConfiguration(row.configuration)}))};
}
export class MerchantMppConsole {
  #configuration;#directory;#environment;#fetch;#closing=false;#inflight=new Set();#closed;#exports;
  constructor(config,{environment=process.env,fetchImpl=globalThis.fetch}={}) {
    this.#configuration=config.mpp??null;
    this.#directory=join(config.exportsDirectory,'mpp-customer-reviews');
    this.#environment=environment;this.#fetch=fetchImpl;
    this.#exports=new MppFileExports(config.exportsDirectory);
  }
  get summary() {return {configured:Boolean(this.#configuration),
    consoles:Object.keys(this.#configuration?.consoles??{}),borrowed:true,closing:this.#closing,
    exports:this.#exports.summary};}
  #selected(key) {
    alias(key,'Console alias');
    const selected=this.#configuration?.consoles[key];
    need(selected,'MPP_MCP_CONSOLE_NOT_CONFIGURED','Choose a host-declared native MPP console.');
    return selected;
  }
  #customer(selected,key) {
    alias(key,'Customer alias');
    const customer=selected.customers[key];
    need(customer,'MPP_MCP_CUSTOMER_NOT_CONFIGURED','Choose a host-declared customer configuration.');
    return customer;
  }
  async #request(context,path,body,{bytes=false}={}) {
    need(path.startsWith('/api/') && !path.startsWith('//'),'MPP_MCP_INTERNAL_ROUTE_INVALID');
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),30000);
    let response;
    try {
      response=await this.#fetch(context.origin+path,{method:body===undefined?'GET':'POST',
        headers:{authorization:'Bearer '+context.token,origin:context.origin,
          accept:'application/json',...(body===undefined?{}:{'content-type':'application/json'})},
        ...(body===undefined?{}:{body:JSON.stringify(body)}),redirect:'error',signal:controller.signal});
      const parts=[];let count=0;
      if(response.body) {
        const reader=response.body.getReader();
        try {
          while(true) {
            const part=await reader.read();if(part.done)break;
            count+=part.value.byteLength;
            need(count<=MAX_RESPONSE,'MPP_MCP_RESPONSE_TOO_LARGE','Read the original records with smaller pages.');
            parts.push(Buffer.from(part.value));
          }
        } catch(error){await reader.cancel().catch(()=>{});throw error;}
        finally {reader.releaseLock();}
      }
      const raw=Buffer.concat(parts);
      if(!response.ok) {
        let original;try{original=JSON.parse(raw.toString('utf8')).error;}catch{}
        fail(/^[A-Z0-9_]{1,96}$/.test(original??'')?original:'MPP_MCP_CONSOLE_REJECTED',
          'The original native MPP console rejected this operation.');
      }
      if(bytes)return raw;
      try{return JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(raw));}
      catch{fail('MPP_MCP_CONSOLE_RESPONSE_INVALID','The original console response is not a complete JSON record.');}
    } catch(error) {
      if(error.code && /^[A-Z0-9_]{1,96}$/.test(error.code))throw error;
      fail('MPP_MCP_CONSOLE_UNAVAILABLE','The original native MPP console request did not complete. Inspect the retained original ID before retrying.');
    } finally {clearTimeout(timer);}
  }
  async #context(key) {
    const selected=this.#selected(key),token=this.#environment[selected.tokenEnv];
    need(typeof token==='string' && /^[a-f0-9]{64}$/.test(token),'MPP_MCP_CONSOLE_TOKEN_REQUIRED',
      'The host must supply the original native MPP console token through its selected environment variable.');
    const context={...selected,token};
    const identity=await this.#request(context,'/api/identity');
    need(identity.schema==='stellar-forge.mpp-console-identity.v1' &&
      identity.workspace===selected.workspace && identity.createdAt===selected.createdAt &&
      workspaceIdentity(identity.workspace,identity.createdAt)===selected.identity,
      'MPP_MCP_WORKSPACE_CHANGED','This endpoint must open the originally selected native MPP workspace.');
    context.versions=identity.versions;
    return context;
  }
  async #reviewFile(key,reviewId) {
    this.#selected(key);nativeId(reviewId);
    await mkdir(this.#directory,{mode:0o700}).catch(error=>{if(error.code!=='EEXIST')throw error;});
    await privateDirectory(this.#directory);
    return join(this.#directory,digest(key+'\0'+reviewId)+'.json');
  }
  async #readReview(key,reviewId,optional=false) {
    const record=await readJSON(await this.#reviewFile(key,reviewId),optional);
    if(!record)return null;
    const {sha256,...original}=record;
    need(record.schema===MPP_REVIEW_SCHEMA && record.console===key && record.reviewId===reviewId &&
      sha256===digest(stable(original)) && record.workspaceIdentity===this.#selected(key).identity,
      'MPP_MCP_REVIEW_CHANGED','Reopen the original customer review in its selected workspace.');
    need(record.profileId===digest(stable(record.profile)),'MPP_MCP_REVIEW_CHANGED');
    return record;
  }
  async #review(args) {
    const selected=this.#selected(args.console),customer=this.#customer(selected,args.customer);
    nativeId(args.reviewId);
    need(args.document && typeof args.document==='object' && !Array.isArray(args.document),
      'INVALID_PARAMS','Supply the received contract or complete customer bundle.');
    const documentSha256=digest(stable(args.document));
    const matches=record=>need(record.customer===args.customer &&
      record.configurationSha256===customer.configurationSha256 && record.documentSha256===documentSha256,
      'MPP_MCP_REVIEW_ID_ALREADY_BOUND','The original review ID already selects different customer input. Reopen that review.');
    const previous=await this.#readReview(args.console,args.reviewId,true);
    if(previous){matches(previous);return {...reviewView(previous),retained:true};}
    const context=await this.#context(args.console);
    const draft=await this.#request(context,'/api/customer-workbench/intake',{document:args.document});
    const reviewed=await this.#request(context,'/api/customer-workbench/review',{
      profile:{schema:'stellar-forge.mpp-customer-workbench.v1',contract:draft.draft.contract,
        configuration:customer.configuration},revision:draft.revision});
    need(reviewed.profileId===digest(stable(reviewed.profile)) &&
      reviewed.profile.contract.sha256===draft.draft.contract.sha256 &&
      reviewed.profile.configuration.workspace===context.workspace,'MPP_MCP_REVIEW_CHANGED');
    const original={schema:MPP_REVIEW_SCHEMA,reviewId:args.reviewId,console:args.console,
      workspaceIdentity:context.identity,customer:args.customer,configurationSha256:customer.configurationSha256,
      documentSha256,profile:reviewed.profile,profileId:reviewed.profileId,revision:revision(reviewed.revision),
      difference:draft.difference,createdAt:new Date().toISOString()};
    const record={...original,sha256:digest(stable(original))};
    try{await saveJSON(await this.#reviewFile(args.console,args.reviewId),record);}
    catch(error){
      if(error.code!=='EEXIST')throw error;
      const winner=await this.#readReview(args.console,args.reviewId);matches(winner);
      return {...reviewView(winner),retained:true};
    }
    return {...reviewView(record),retained:false};
  }
  async #reviewStatus(args) {
    const record=await this.#readReview(args.console,args.reviewId);
    need(record,'MPP_MCP_REVIEW_NOT_FOUND','Use the retained original review ID.');
    const selected=this.#selected(args.console);
    const configurationMatches=selected.customers[record.customer]?.configurationSha256===record.configurationSha256;
    try {
      const context=await this.#context(args.console);
      const current=await this.#request(context,'/api/customer-workbench?limit=1');
      return {...reviewView(record),configurationMatches,currentRevision:current.revision,
        currentProfileId:current.profileId,state:current.profileId===record.profileId?'SELECTED':
          !configurationMatches?'CUSTOMER_SELECTION_CHANGED':
          current.revision===record.revision?'READY':'REVISION_CHANGED'};
    } catch(error) {return {...reviewView(record),configurationMatches,state:'CONSOLE_UNAVAILABLE',error:code(error)};}
  }
  async #configure(args) {
    const record=await this.#readReview(args.console,args.reviewId);
    need(record,'MPP_MCP_REVIEW_NOT_FOUND','Use the retained original review ID.');
    need(record.sha256===sha(args.expectedReviewSha256),'MPP_MCP_REVIEW_CHANGED','Use the exact reviewed SHA256.');
    const context=await this.#context(args.console);
    const current=await this.#request(context,'/api/customer-workbench?limit=1');
    if(current.profileId===record.profileId)return {...reviewView(record),state:'SELECTED',
      currentRevision:current.revision,recovered:true};
    need(this.#customer(context,record.customer).configurationSha256===record.configurationSha256,
      'MPP_MCP_CUSTOMER_SELECTION_CHANGED','Review the current host-selected customer configuration.');
    const result=await this.#request(context,'/api/customer-workbench/configure',
      {profile:record.profile,revision:record.revision});
    need(result.profileId===record.profileId,'MPP_MCP_REVIEW_CHANGED');
    return {...reviewView(record),state:'SELECTED',currentRevision:result.revision,recovered:false};
  }
  async #export(args) {
    const selected=this.#selected(args.console);
    exportId(args.exportId);sha(args.expectedSha256);
    need(['response','contract','openapi','package'].includes(args.kind),'INVALID_PARAMS','Choose an original response or handoff.');
    if(args.kind==='response') {
      nativeId(args.purchaseId);
      need(args.profileId===undefined,'INVALID_PARAMS','A paid response selects its original purchase ID.');
    } else {
      sha(args.profileId);
      need(args.purchaseId===undefined,'INVALID_PARAMS','A customer handoff selects its original merchant profile ID.');
    }
    const intent={console:args.console,workspaceIdentity:selected.identity,kind:args.kind,
      expectedSha256:args.expectedSha256,...(args.kind==='response'?{purchaseId:args.purchaseId}:{profileId:args.profileId})};
    return this.#exports.capture({id:args.exportId,intent,load:async()=>{
      const context=await this.#context(args.console);
      if(args.kind==='response') {
        const path='/api/customer-workbench/purchases/'+encodeURIComponent(args.purchaseId);
        const original=await this.#request(context,path+'/preview');
        need(original.sha256===args.expectedSha256,'MPP_EXPORT_SOURCE_CHANGED');
        const bytes=await this.#request(context,path+'/response',undefined,{bytes:true});
        return {bytes,contentType:original.headers?.['content-type']??'application/octet-stream',
          source:{purchaseId:args.purchaseId,contractSha256:original.contractSha256,offerId:original.offerId,
            transaction:original.transaction,receipt:original.receipt,accounting:{
              outcome:original.accounting?.outcome??'PENDING',
              ...(original.accounting?.receipt_ref?{receipt_ref:original.accounting.receipt_ref}:{}),
              ...(original.accounting?.proof_sha256?{proof_sha256:original.accounting.proof_sha256}:{})}}};
      }
      const bytes=await this.#request(context,'/api/customer/'+args.kind+'?'+
        new URLSearchParams({profileId:args.profileId}),undefined,{bytes:true});
      return {bytes,contentType:'application/json',source:{profileId:args.profileId}};
    }});
  }
  async #execute(name,args) {
    if(name==='merchant_mpp_export')return this.#export(args);
    if(name.startsWith('merchant_mpp_export_'))return this.#exports.call(name,args);
    if(name==='merchant_mpp_consoles')return {schema:MPP_CONNECTION_SCHEMA,
      selectionSha256:this.#configuration?.selectionSha256??null,
      consoles:Object.entries(this.#configuration?.consoles??{}).map(([key,value])=>compactConsole(key,value))};
    if(name==='merchant_mpp_customer_review')return this.#review(args);
    if(name==='merchant_mpp_customer_review_status')return this.#reviewStatus(args);
    if(name==='merchant_mpp_customer_configure')return this.#configure(args);
    const context=await this.#context(args.console);
    if(name==='merchant_mpp_status') {
      const offset=args.offset??0,limit=args.limit??25;
      need(Number.isSafeInteger(offset) && offset>=0 && Number.isInteger(limit) && limit>=1 && limit<=100,
        'INVALID_PARAMS','Use an original purchase page of one to one hundred records.');
      const current=await this.#request(context,'/api/customer-workbench?'+new URLSearchParams({offset,limit}));
      return {schema:current.schema,console:args.console,workspaceIdentity:context.identity,
        versions:context.versions,revision:current.revision,profileId:current.profileId,
        profile:profileView(current.profile),purchases:current.purchases};
    }
    if(name==='merchant_mpp_contract') {
      const customer=this.#customer(context,args.customer);
      need(typeof args.origin==='string','INVALID_PARAMS','Supply the public merchant origin.');
      const result=await this.#request(context,'/api/customer-workbench/fetch',{
        origin:args.origin,...(customer.configuration.transport?{transport:customer.configuration.transport}:{})});
      return {console:args.console,customer:args.customer,configurationSha256:customer.configurationSha256,
        contract:result.draft.contract,difference:result.difference,revision:result.revision};
    }
    if(name==='merchant_mpp_preview') {
      sha(args.profileId);nativeId(args.offerId);
      exact(args.inputs??{},['query','json']);
      return this.#request(context,'/api/customer-workbench/preview',{
        profileId:args.profileId,offerId:args.offerId,inputs:args.inputs??{}});
    }
    if(name==='merchant_mpp_prepare') {
      sha(args.profileId);nativeId(args.offerId);nativeId(args.purchaseId);
      const options={purchaseId:args.purchaseId};
      for(const key of ['query','json','challengeId'])if(Object.hasOwn(args,key))options[key]=args[key];
      const job=await this.#request(context,'/api/customer-workbench/prepare',{
        profileId:args.profileId,offerId:args.offerId,options});
      return {console:args.console,purchaseId:args.purchaseId,operation:'prepare',job};
    }
    const action={merchant_mpp_retry_prepare:'retry-prepare',merchant_mpp_execute:'execute',
      merchant_mpp_resume:'resume',merchant_mpp_finalize:'finalize'}[name];
    if(action) {
      nativeId(args.purchaseId);
      const job=await this.#request(context,'/api/customer-workbench/'+action,{id:args.purchaseId});
      return {console:args.console,purchaseId:args.purchaseId,operation:action,job};
    }
    if(name==='merchant_mpp_job') {
      need(typeof args.jobId==='string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(args.jobId),
        'INVALID_PARAMS','Use the original console job ID.');
      try{return await this.#request(context,'/api/jobs/'+args.jobId);}
      catch(error){
        if(error.code!=='MPP_JOB_NOT_FOUND' || !args.purchaseId)throw error;
        nativeId(args.purchaseId);
        return {id:args.jobId,state:'JOB_NOT_RETAINED',purchaseId:args.purchaseId,
          purchase:await this.#request(context,'/api/customer-workbench/purchases/'+encodeURIComponent(args.purchaseId))};
      }
    }
    if(['merchant_mpp_purchase','merchant_mpp_response_preview','merchant_mpp_response_file'].includes(name)) {
      const id=encodeURIComponent(nativeId(args.purchaseId));
      let path='/api/customer-workbench/purchases/'+id;
      if(name==='merchant_mpp_response_preview')path+='/preview';
      if(name==='merchant_mpp_response_file') {
        const options=range(args);
        path+='/file?'+new URLSearchParams({expectedSha256:sha(args.expectedSha256),...options});
      }
      return this.#request(context,path);
    }
    if(name==='merchant_mpp_catalog')return this.#request(context,'/api/customer');
    if(name==='merchant_mpp_handoff_file') {
      need(['contract','openapi','package'].includes(args.kind),'INVALID_PARAMS','Choose contract, openapi or package.');
      sha(args.profileId);const {offset,limit}=range(args);
      if(args.expectedSha256!==undefined)sha(args.expectedSha256);
      need(offset===0 || args.expectedSha256,'INVALID_PARAMS','Continue with the first chunk’s exact SHA256.');
      const bytes=await this.#request(context,'/api/customer/'+args.kind+'?'+
        new URLSearchParams({profileId:args.profileId}),undefined,{bytes:true});
      const sha256=digest(bytes);
      need(!args.expectedSha256 || args.expectedSha256===sha256,'MPP_MCP_HANDOFF_CHANGED',
        'Reopen the original merchant profile and handoff digest.');
      need(offset<=bytes.length,'INVALID_PARAMS','The original byte offset exceeds this file.');
      const part=bytes.subarray(offset,Math.min(offset+limit,bytes.length)),next=offset+part.length;
      return {schema:'stellar-forge.mpp-handoff-chunk.v1',console:args.console,kind:args.kind,
        profileId:args.profileId,file:'mpp-'+args.kind+'-'+sha256.slice(0,12)+'.json',
        sha256,bytes:bytes.length,offset,length:part.length,chunkSha256:digest(part),
        nextOffset:next<bytes.length?next:null,complete:next===bytes.length,encoding:'base64',data:part.toString('base64')};
    }
    fail('TOOL_NOT_FOUND','Unknown native MPP console operation.');
  }
  call(name,args={}) {
    need(!this.#closing,'OPERATOR_CLOSING','The native MPP client is closing.');
    const definition=definitions.get(name);
    need(definition,'TOOL_NOT_FOUND','Unknown native MPP console operation.');
    exact(args,Object.keys(definition.inputSchema.properties),definition.inputSchema.required);
    const pending=this.#execute(name,args).catch(error=>{
      const retained=args.purchaseId?' Original purchase: '+args.purchaseId+'.':
        args.reviewId?' Original review: '+args.reviewId+'.':'';
      fail(code(error),(error.message??'Native MPP operation failed.')+retained);
    });
    this.#inflight.add(pending);
    pending.then(()=>this.#inflight.delete(pending),()=>this.#inflight.delete(pending));
    return pending;
  }
  close() {
    if(!this.#closed) {
      this.#closing=true;
      this.#closed=Promise.allSettled([...this.#inflight]).then(()=>this.#exports.close());
    }
    return this.#closed;
  }
}
const definitions=new Map(mppTools((name,description,properties={},required=[])=>({
  name,description,inputSchema:{type:'object',properties,required,additionalProperties:false}
})).map(value=>[value.name,value]));
