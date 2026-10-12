// MIT. Commercial documents through the original SF74 case and commissioning writer.
import {createHash} from 'node:crypto';
import {parseWorkspace} from './workspace-file.mjs';
import {operateCaseCommissioning} from './case-commissioning.mjs';
import {MAX_MATERIAL_BYTES,encodeCommissioningBytes} from './commissioning.mjs';
import {exportRuntimeHandoff} from './runtime-support.mjs';
import {canonical,sha256,jsonBytes,commercialError,inspectCommercialPricingSource} from './commercial-pricing.mjs';
import {commercialContext,commercialView,normalizeCommercialDraft,reviewCommercialQuote,makeCommercialDocument,
  COMMERCIAL_MATERIAL_KINDS,sealCommercialQuote,compareCommercialQuotes} from './commercial-quote.mjs';

const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const copy=value=>JSON.parse(JSON.stringify(value));
function fields(value,allowed){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!allowed.includes(k)))throw commercialError('COMMERCIAL_REQUEST_INVALID','Unexpected quotation request fields.');}
function text(value,label,max=16000,empty=false){if(typeof value!=='string'||value.length>max||/\0/.test(value)||!empty&&!value.trim())throw commercialError('COMMERCIAL_REQUEST_INVALID','Supply '+label+' as complete text.');return value;}
function conflict(revision){return Object.assign(commercialError('CASE_CONFLICT','The original saved case changed. Reopen it and review the current quotation sources.',409),{currentRevision:revision});}
function recordRef(record){return {id:record.id,revision:record.revision,workspaceSha256:sha256(record.workspaceText),
  supportSha256:record.supportText===null?null:sha256(record.supportText)};}
function requireCase(id){if(!UUID.test(id??''))throw commercialError('COMMERCIAL_CASE_REQUIRED','Choose an original case UUID.');}
export function commercialWorkspaceId(casesDirectory){return createHash('sha256').update('sf74-commercial\0'+casesDirectory).digest('hex');}
export function openCaseCommercial({store,workspaceId}={}) {
  if(!store?.read||!store?.save||typeof workspaceId!=='string'||!workspaceId)
    throw new TypeError('Original case store and workspace identity required.');
  async function readContext(id,revision=null) {
    requireCase(id);
    const record=await store.read(id,revision),workspace=await parseWorkspace(record.workspaceText);
    return {record,workspace,context:await commercialContext(workspace,{caseId:id,workspaceId,revision:record.revision})};
  }
  function scope(args) {
    requireCase(args.id);
    if(args.scope!==undefined&&(args.scope?.caseId!==args.id||args.scope?.workspaceId!==workspaceId||
        Object.keys(args.scope).some(k=>!['caseId','workspaceId'].includes(k))))
      throw commercialError('COMMERCIAL_SCOPE_CHANGED','Reopen the original selected case and workspace.',409);
  }
  function revision(args,record) {
    if(!HASH.test(args.expectedRevision??''))throw commercialError('COMMERCIAL_REVISION_REQUIRED','Use the original saved case revision.');
    if(args.expectedRevision!==record.revision)throw conflict(record.revision);
  }
  function quoteById(context,id,expectedHash) {
    const quote=context.quotes.find(q=>q.id===id);
    if(!quote)throw commercialError('COMMERCIAL_QUOTE_NOT_FOUND','Choose a retained original quote.',404);
    if(expectedHash!==undefined&&quote.sha256!==expectedHash)throw commercialError('COMMERCIAL_QUOTE_CHANGED','The selected original quote bytes changed.',409);
    return quote;
  }
  function command(document,context,editionId) {
    const bytes=jsonBytes(document);
    if(bytes.length>MAX_MATERIAL_BYTES)throw commercialError('COMMERCIAL_MATERIAL_LIMIT','This complete document exceeds the original implementation material limit.');
    return {type:'add_material',requestId:document.id,expectedRevision:context.state.revision,
      actor:document.request.actor,recordedAt:document.createdAt,payload:{
        id:'commercial:'+document.id,name:'merchant-'+document.kind.toLowerCase()+'-'+document.id+'.json',
        mediaType:'application/json',data:encodeCommissioningBytes(bytes),kind:COMMERCIAL_MATERIAL_KINDS[document.kind],
        description:'Original commercial '+document.kind.toLowerCase()+'; implementation task receiving is separate.',
        taskIds:[],editionId,reference:'urn:stellar-forge:commercial:'+document.kind.toLowerCase()+':'+document.id}};
  }
  async function apply(action,kind,args,payloadBuilder) {
    scope(args);
    if(!UUID.test(args.requestId??'')||!HASH.test(args.expectedRevision??''))
      throw commercialError('COMMERCIAL_REQUEST_ID_REQUIRED','Keep the original request UUID and saved case revision.');
    text(args.actor,'operator name',200);
    const {record,context}=await readContext(args.id);
    const requestArgs=copy(args);delete requestArgs.scope;
    const request={action,actor:args.actor,sha256:sha256(canonical({action,args:requestArgs}))};
    const prior=context.documents.find(d=>d.id===args.requestId);
    let document,editionId;
    if(prior) {
      if(prior.kind!==kind||prior.caseId!==args.id||prior.request.sha256!==request.sha256||
          prior.request.action!==action||prior.request.actor!==args.actor)
        throw commercialError('REQUEST_CONFLICT','This original UUID belongs to different quotation inputs.',409);
      const {material,...original}=prior;document=original;
      editionId=context.state.materials.find(m=>m.id===material.id).editionId;
    } else {
      if(context.state.events.some(e=>e.id===args.requestId))
        throw commercialError('REQUEST_CONFLICT','This original UUID belongs to another implementation operation.',409);
      revision(args,record);
      const createdAt=new Date().toISOString(),payload=await payloadBuilder(context,createdAt);
      document=makeCommercialDocument({kind,requestId:args.requestId,caseId:args.id,createdAt,request,payload});
      editionId=payload.draft?.implementationSourceId||payload.implementationSourceId||context.state.activeEditionId||null;
    }
    // The original engine verifies exact replay before its current revision check.
    const original=await operateCaseCommissioning(store,{id:args.id,expectedRevision:args.expectedRevision,
      command:command(document,context,editionId)});
    const next=await readContext(args.id);
    return {state:'COMPLETE',requestId:args.requestId,replayed:Boolean(prior)||original.replayed,
      document:{id:document.id,kind,sha256:sha256(jsonBytes(document))},case:recordRef(next.record),
      view:commercialView(next.context),...(kind==='QUOTE'?{quote:quoteById(next.context,document.id)}:{}),
      ...(kind==='PRICING'?{pricingSourceId:document.payload.id}:{})};
  }
  async function read(args) {
    fields(args,['id','revision']);const {record,context}=await readContext(args.id,args.revision??null);
    return {...commercialView(context),case:recordRef(record)};
  }
  async function preview(args) {
    fields(args,['id','scope','expectedRevision','draft']);scope(args);
    const {record,context}=await readContext(args.id);revision(args,record);
    return {scope:context.scope,revision:record.revision,review:reviewCommercialQuote(context,args.draft)};
  }
  async function saveDraft(args) {
    fields(args,['id','scope','expectedRevision','requestId','actor','draft']);
    return apply('saveDraft','DRAFT',args,()=>normalizeCommercialDraft(args.draft));
  }
  async function publish(args) {
    fields(args,['id','scope','expectedRevision','requestId','actor','draft','reviewSha256','parentId']);
    if(!HASH.test(args.reviewSha256??''))throw commercialError('COMMERCIAL_REVIEW_REQUIRED','Review this exact draft before saving an edition.');
    return apply('publish','QUOTE',args,(context,createdAt)=>{
      const draft=normalizeCommercialDraft(args.draft);
      if((args.parentId??null)!==(draft.parentId??null))throw commercialError('COMMERCIAL_PARENT_CHANGED','Keep the reviewed original parent edition.');
      const review=reviewCommercialQuote(context,draft);
      if(review.reviewSha256!==args.reviewSha256)throw commercialError('COMMERCIAL_REVIEW_CHANGED','The draft or its original source changed. Review the current draft.',409);
      return sealCommercialQuote({id:args.requestId,createdAt,draft,review});
    });
  }
  async function receive(args) {
    fields(args,['id','scope','expectedRevision','requestId','actor','quoteId','quoteSha256','status','observedAt','source','note']);
    if(!['ACCEPTED','REVISION_REQUESTED','DECLINED'].includes(args.status)||!HASH.test(args.quoteSha256??''))
      throw commercialError('COMMERCIAL_RESPONSE_REQUIRED','Select the original quote and actual customer response.');
    if(typeof args.observedAt!=='string'||!Number.isFinite(Date.parse(args.observedAt))||new Date(args.observedAt).toISOString()!==args.observedAt)
      throw commercialError('COMMERCIAL_RESPONSE_TIME','Record the original customer response time in UTC.');
    text(args.source,'customer response reference',4096);text(args.note??'','customer response note',16000,true);
    return apply('receive','RESPONSE',args,context=>{
      const quote=quoteById(context,args.quoteId,args.quoteSha256);
      return {quoteId:quote.id,quoteSha256:quote.sha256,status:args.status,
        observedAt:args.observedAt,source:args.source,note:args.note??''};
    });
  }
  async function receivePricing(args) {
    fields(args,['id','scope','expectedRevision','requestId','actor','sourceText','sourceSha256']);
    text(args.sourceText,'complete original pricing source',MAX_MATERIAL_BYTES);
    if(!HASH.test(args.sourceSha256??'')||sha256(args.sourceText)!==args.sourceSha256)throw commercialError('COMMERCIAL_PRICING_FILE_CHANGED','Keep the complete original pricing source bytes for this request.');
    return apply('receivePricing','PRICING',args,()=>{
      const source=JSON.parse(args.sourceText);inspectCommercialPricingSource(source);return source;
    });
  }
  async function compare(args) {
    fields(args,['id','scope','expectedRevision','beforeId','afterId']);scope(args);
    const {record,context}=await readContext(args.id);if(args.expectedRevision!==undefined)revision(args,record);
    return {scope:context.scope,revision:record.revision,
      comparison:compareCommercialQuotes(quoteById(context,args.beforeId),quoteById(context,args.afterId))};
  }
  async function download(args) {
    fields(args,['id','scope','revision','expectedRevision','quoteId','quoteSha256','kind']);scope(args);
    const {record,context}=await readContext(args.id,args.revision??null);if(args.expectedRevision!==undefined)revision(args,record);
    const quote=quoteById(context,args.quoteId,args.quoteSha256);
    let body,filename,mediaType;
    if(args.kind==='QUOTE') {
      body=Buffer.from(quote.customerDocument);filename='merchant-quote-'+quote.id+'.md';mediaType='text/markdown; charset=utf-8';
    } else if(args.kind==='QUOTE_JSON') {
      const {receiving,material,originCaseId,...original}=quote;
      body=jsonBytes(original);filename='merchant-quote-'+quote.id+'.json';mediaType='application/json';
    } else if(args.kind==='HANDOFF') {
      if(record.supportText!==null) {
        const result=await exportRuntimeHandoff({workspaceText:record.workspaceText,supportText:record.supportText,metadata:record.metadata,generatedAt:record.updatedAt});
        body=Buffer.from(result.handoff);filename='merchant-support-'+record.id+'.json';
      } else {
        body=Buffer.from(record.workspaceText);filename='merchant-workspace-'+record.id+'.json';
      }
      mediaType='application/json';
    } else throw commercialError('COMMERCIAL_DOWNLOAD_INVALID','Choose the original quote or complete portable workspace.');
    return {scope:context.scope,case:recordRef(record),quoteId:quote.id,quoteSha256:quote.sha256,
      descriptor:{filename,bytes:body.length,sha256:sha256(body),mediaType},body};
  }
  return {read,preview,saveDraft,publish,receive,receivePricing,compare,download};
}
