// Complete local Contributor preparation files; original native engines own writes.
export const ENGAGEMENT_WORKING_SCHEMA='stellar-forge.sf47-engagement-working-copy.v1';
export const ENGAGEMENT_DOCUMENT_SCHEMA='stellar-forge.sf47-contributor-engagements.v1';
export const ENGAGEMENT_WORKING_MAX_BYTES=64*1024*1024;
export const ENGAGEMENT_WORKING_MAX_COPIES=16;
export const ENGAGEMENT_STATE_KEYS=Object.freeze([
  'tab','document','selectedAgreement','search','acceptanceFilter','newContributor',
  'preview','previewVersion','selectedReview','saved','history','pending','accepted','rejected',
  'handoff','receiving','receivingHistory','draftVersion','controls','portfolioFile','pendingPortfolioFile','storageOriginal','requestReceipts'
]);
export const ENGAGEMENT_ACTIONS=Object.freeze(['engagement.prepare','forecast.save','portfolio.save','engagement.receiving']);
const HEX=/^[a-f0-9]{64}$/;
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
const copy=v=>structuredClone(v);
const need=(v,m)=>{if(!v)throw new Error(m);};
const canonical=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}';
export const equalEngagementValue=(a,b)=>canonical(a)===canonical(b);
const nonempty=v=>typeof v==='string'&&v.trim().length>0;
function data(value,depth=0){
  need(depth<160,'The working file exceeds its supported nested input depth.');
  if(value===null||typeof value==='boolean'||typeof value==='string')return;
  if(typeof value==='number'){need(Number.isFinite(value),'Keep finite JSON numbers in the working file.');return;}
  need(Array.isArray(value)||plain(value),'Keep complete JSON data without executable objects.');
  for(const v of Object.values(value))data(v,depth+1);
}
function string(value,label,max=12000){need(typeof value==='string'&&value.length<=max,label+' must be retained text.');return value;}
function nullableVersion(value,label){need(value===null||Number.isInteger(value)&&value>=1&&value<=10000000,label+' must be the original case version or null.');}
export function engagementCommandShape(command){
  need(plain(command)&&Object.keys(command).every(k=>['action','expectedVersion','actor','requestId','note','data'].includes(k)),'Keep the complete original command envelope.');
  need(ENGAGEMENT_ACTIONS.includes(command.action)&&plain(command.data),'Select an original Contributor handoff command.');
  nullableVersion(command.expectedVersion,'Original command version');need(command.expectedVersion!==null,'Retain the original reviewed command version.');
  need(nonempty(command.requestId)&&command.requestId.length<=300&&nonempty(command.actor)&&command.actor.length<=300,'Retain the original request ID and recording operator.');
  string(command.note??'','Original command note');
  if(command.action==='engagement.prepare'||command.action==='engagement.receiving')need(nonempty(command.note),'Retain the original recorded review note.');
  data(command);return command;
}
export function engagementDocumentShape(document){
  need(plain(document)&&document.schema===ENGAGEMENT_DOCUMENT_SCHEMA&&Array.isArray(document.agreements),'Keep the complete Contributor agreement document.');
  for(const key of ['name','asOfDate','note'])string(document[key]??'',key);
  const ids=new Set();
  for(const row of document.agreements){
    need(plain(row)&&nonempty(row.id)&&!ids.has(row.id)&&plain(row.availability)&&plain(row.compensation)&&plain(row.acceptance)&&Array.isArray(row.allocations),'Keep every complete agreement and its original identity.');ids.add(row.id);
    need(Array.isArray(row.availability.hoursByWeekday)&&row.availability.hoursByWeekday.length===7&&plain(row.availability.hoursByDate),'Keep all seven weekdays and every dated exception.');
    for(const part of [row,row.availability,row.compensation,row.acceptance])need(Array.isArray(part.sourceIds)&&typeof part.sourceNote==='string','Keep every original source link and entered source note.');
    for(const allocation of row.allocations)need(plain(allocation)&&typeof allocation.costId==='string'&&own(allocation,'remainingHours')&&own(allocation,'remainingCostUsd')&&typeof allocation.note==='string','Keep every whole work-package allocation.');
  }
  return document;
}
function acceptedShape(row,programId){
  need(plain(row)&&plain(row.payload)&&plain(row.result),'Keep the complete accepted command and its native result.');
  engagementCommandShape(row.payload);
  need(row.result.id===programId&&row.result.action===row.payload.action&&Number.isInteger(row.result.version)&&row.result.version===row.payload.expectedVersion+1&&nonempty(row.result.recordId),'The original accepted command and result identities differ.');
}
export function engagementStateShape(state,programId){
  need(plain(state)&&ENGAGEMENT_STATE_KEYS.every(k=>own(state,k))&&Object.keys(state).every(k=>ENGAGEMENT_STATE_KEYS.includes(k)),'Keep the whole supported preparation state.');
  data(state);
  need(['editor','history','handoff','copies'].includes(state.tab),'Keep the selected preparation view.');
  for(const key of ['selectedAgreement','search','acceptanceFilter','newContributor','selectedReview'])string(state[key],key);
  nullableVersion(state.draftVersion,'Draft version');nullableVersion(state.previewVersion,'Preview version');
  if(state.document!==null)engagementDocumentShape(state.document);
  if(state.preview!==null){need(plain(state.preview)&&HEX.test(state.preview.previewSha256||''),'Keep the full original native preview.');engagementDocumentShape(state.preview.document);}
  need(Array.isArray(state.history)&&Array.isArray(state.receivingHistory)&&plain(state.controls),'Keep the complete saved history and unfinished controls.');
  for(const [key,row] of Object.entries(state.controls)){
    need(nonempty(key)&&plain(row)&&Object.keys(row).every(k=>['exceptionDate','exceptionHours','allocationCostId','fields'].includes(k)),'Keep only declared unfinished agreement controls.');
    for(const [key,value]of Object.entries(row)){if(key==='fields'){need(plain(value),'Keep the whole entered agreement-field text.');for(const v of Object.values(value))string(v,'Entered agreement field',12000);}else string(value,'Unfinished control',1000);}
  }
  if(state.saved!==null){
    need(plain(state.saved)&&plain(state.saved.review)&&HEX.test(state.saved.review.sha256||'')&&nonempty(state.saved.review.id)&&state.saved.review.purpose==='CONTRIBUTOR_ENGAGEMENTS','Keep the original saved book and full review.');
    engagementDocumentShape(state.saved.document);
    need(state.selectedReview===state.saved.review.id&&equalEngagementValue(state.document,state.saved.document),'The opened saved book differs from its complete original document.');
  }
  if(state.pending!==null){need(plain(state.pending),'Keep the exact pending command.');engagementCommandShape(state.pending.payload);}
  if(state.accepted!==null)acceptedShape(state.accepted,programId);
  need(Array.isArray(state.requestReceipts),'Keep every retained accepted request receipt.');
  for(const row of state.requestReceipts)acceptedShape(row,programId);
  need(!(state.pending&&state.accepted),'One command cannot be both pending and accepted.');
  if(state.rejected!==null){need(plain(state.rejected)&&typeof state.rejected.code==='string','Keep the complete rejected request.');engagementCommandShape(state.rejected.payload);}
  if(state.handoff!==null){
    const h=state.handoff;
    need(plain(h)&&Array.isArray(h.agreementIds)&&plain(h.resourceMap)&&plain(h.remainders)&&plain(h.paymentModes),'Keep the complete cash/allocation handoff selections.');
    if(h.book){need(h.book.review?.id===h.reviewId&&h.book.review?.sha256===h.reviewSha256,'The selected handoff book differs from its original review.');engagementDocumentShape(h.book.document);}
    if(h.portfolioDraft)need(h.portfolioDraft.schema==='stellar-forge.sf47-portfolio.v1'&&['resources','tasks','alternatives'].every(k=>Array.isArray(h.portfolioDraft[k])),'Keep the full original Portfolio input.');
  }
  if(state.receiving!==null){
    const flow=state.receiving;
    need(plain(flow)&&flow.schema==='sf47.engagement-receiving-flow.v1'&&nonempty(flow.id)&&Array.isArray(flow.receipts)&&plain(flow.forecastSelection)&&plain(flow.forecastInputs)&&plain(flow.portfolioChoice),'Keep the complete original native receiving flow.');
    need(['FORECAST_REVIEWED','FORECAST_SAVED','PORTFOLIO_REVIEWED','PORTFOLIO_SAVED','COMPLETED'].includes(flow.phase),'Keep the original receiving stage.');
    need(state.handoff?.reviewId===flow.reviewId&&state.handoff?.reviewSha256===flow.reviewSha256,'The original receiving and handoff book differ.');
    for(const row of flow.receipts){acceptedShape(row,programId);need(row.context?.flowId===flow.id,'An original receiving receipt belongs to another workflow.');}
    for(const row of [state.pending,state.accepted].filter(Boolean))if(row.payload.action!=='engagement.prepare')need(row.context?.flowId===flow.id,'The retained handoff command belongs to another workflow.');
    if(flow.phase==='COMPLETED')need(nonempty(flow.forecastId)&&nonempty(flow.portfolioId)&&nonempty(flow.receivingReviewId),'Keep all three saved native identities in the completed receiving.');
  }else for(const row of [state.pending,state.accepted].filter(Boolean))need(row.payload.action==='engagement.prepare','A native handoff command needs its complete original flow.');
  need(state.storageOriginal===null||typeof state.storageOriginal==='string','Keep the original unreadable browser state as complete text.');
  if(state.pendingPortfolioFile!==null){const f=state.pendingPortfolioFile;need(plain(f)&&nonempty(f.name)&&typeof f.type==='string'&&typeof f.contentBase64==='string'&&Number.isInteger(f.bytes)&&f.bytes>0&&f.bytes<=8*1024*1024&&HEX.test(f.sha256||''),'Keep the complete selected, not-yet-applied Portfolio file.');}
  if(state.portfolioFile!==null){
    const f=state.portfolioFile;
    need(plain(f)&&nonempty(f.name)&&typeof f.type==='string'&&typeof f.contentBase64==='string'&&Number.isInteger(f.bytes)&&f.bytes>0&&f.bytes<=8*1024*1024&&HEX.test(f.sha256||''),'Keep the exact selected Portfolio file bytes and identity.');
    need(state.handoff?.portfolioDraft&&state.handoff?.portfolioDraftSource?.sha256===f.sha256,'The selected Portfolio file is not joined to the complete handoff input.');
  }
  return state;
}
export function captureEngagementState(session){
  const result={};
  for(const key of ENGAGEMENT_STATE_KEYS)result[key]=copy(session[key]??(key==='controls'?{}:key==='requestReceipts'?[]:['portfolioFile','pendingPortfolioFile','storageOriginal'].includes(key)?null:undefined));
  return result;
}
export function engagementWorkingBinding(caseValue,scopeKey,actor){
  return {programId:caseValue.program.id,caseVersion:caseValue.program.version,
    planId:caseValue.program.planId??caseValue.plan.id??null,planRevision:caseValue.program.planRevision??caseValue.plan.revision??null,
    scopeKey,recordingActor:actor,sources:copy(caseValue.sources||[])};
}
function bindingShape(binding){
  need(plain(binding)&&/^operation-[a-f0-9]{32}$/.test(binding.programId||'')&&(binding.caseVersion===null||Number.isInteger(binding.caseVersion)&&binding.caseVersion>=1),'Keep the exact original case identity and observed version.');
  need(binding.scopeKey===null||nonempty(binding.scopeKey),'Keep the original browser staff scope.');
  string(binding.recordingActor??'','Original recording operator',300);
  need(Array.isArray(binding.sources)&&binding.sources.every(s=>plain(s)&&nonempty(s.id)&&HEX.test(s.sha256||'')&&Number.isInteger(s.bytes)&&s.bytes>=0),'Keep each retained native source identity.');
}
export function validateEngagementWorkingCopy(document){
  need(plain(document)&&document.schema===ENGAGEMENT_WORKING_SCHEMA,'Select a complete Contributor working-copy file.');
  need(Object.keys(document).every(k=>['schema','name','createdAt','binding','state','legacy'].includes(k)),'This working file has unsupported fields; retain it unchanged.');
  need(nonempty(document.name)&&document.name.length<=300&&typeof document.createdAt==='string'&&Number.isFinite(Date.parse(document.createdAt)),'Retain the complete working-copy name and creation time.');
  bindingShape(document.binding);engagementStateShape(document.state,document.binding.programId);data(document);
  return document;
}
export function createEngagementWorkingCopy({name,binding,state}){
  return validateEngagementWorkingCopy({schema:ENGAGEMENT_WORKING_SCHEMA,name:String(name).trim(),createdAt:new Date().toISOString(),binding:copy(binding),state:copy(state)});
}
export function encodeEngagementWorkingCopy(document){
  validateEngagementWorkingCopy(document);
  const bytes=new TextEncoder().encode(JSON.stringify(document,null,2)+'\n');
  need(bytes.byteLength<=ENGAGEMENT_WORKING_MAX_BYTES,'This complete working file exceeds 64 MiB. Keep the current desk open and download its full original native case.');
  return bytes;
}
export async function engagementBytesSha256(bytes){
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(v=>v.toString(16).padStart(2,'0')).join('');
}
export function engagementBase64(bytes){
  let out='';for(let i=0;i<bytes.length;i+=16384)out+=String.fromCharCode(...bytes.subarray(i,i+16384));return btoa(out);
}
export function engagementUnbase64(value){
  let raw;try{raw=atob(value);}catch{throw new Error('The retained Portfolio file encoding is invalid.');}
  return Uint8Array.from(raw,c=>c.charCodeAt(0));
}
export async function verifyEngagementPortfolioFile(state){
  if(state.pendingPortfolioFile){const f=state.pendingPortfolioFile,b=engagementUnbase64(f.contentBase64);need(b.length===f.bytes&&await engagementBytesSha256(b)===f.sha256,'The whole pending Portfolio file differs from its retained bytes.');}
  if(!state.portfolioFile)return;
  const f=state.portfolioFile,bytes=engagementUnbase64(f.contentBase64);
  need(bytes.length===f.bytes&&await engagementBytesSha256(bytes)===f.sha256,'The full original Portfolio file bytes differ from their selected identity.');
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error('The complete selected Portfolio file is not valid UTF-8 JSON.');}
  const inputs=value?.inputs?.schema==='stellar-forge.sf47-portfolio.v1'?value.inputs:value;
  need(equalEngagementValue(inputs,state.handoff.portfolioDraft),'The whole selected Portfolio file differs from its retained editable inputs.');
}
function legacyWorking(value,descriptor){
  need(plain(value)&&value.schema==='sf47.engagement-operator-draft.v1'&&/^operation-[a-f0-9]{32}$/.test(value.programId||'')&&Number.isInteger(value.version),'Select a complete original Contributor draft.');
  const state={tab:value.receiving?'handoff':'editor',document:value.document,selectedAgreement:value.document?.agreements?.[0]?.id||'',
    search:'',acceptanceFilter:'',newContributor:'',preview:null,previewVersion:null,selectedReview:'',saved:null,
    history:[],pending:value.pending??null,accepted:value.accepted??null,rejected:null,handoff:value.handoff??null,
    receiving:value.receiving??null,receivingHistory:[],draftVersion:value.version,controls:{},portfolioFile:null,pendingPortfolioFile:null,storageOriginal:null,requestReceipts:[]};
  return validateEngagementWorkingCopy({schema:ENGAGEMENT_WORKING_SCHEMA,name:descriptor.name||'Original Contributor draft',
    createdAt:new Date().toISOString(),binding:{programId:value.programId,caseVersion:value.version,planId:null,planRevision:null,
      scopeKey:null,recordingActor:state.pending?.payload?.actor||state.accepted?.payload?.actor||'',sources:[]},
    state,legacy:{schema:value.schema,file:copy(descriptor),limitations:['No original staff scope or source inventory was present.','No unfinished add-row controls or exact Portfolio file bytes were present.']}});
}
function legacySessionWorking(value,descriptor,raw){
  need(plain(value)&&value.schema==='sf47.engagement-operator.v1'&&/^operation-[a-f0-9]{32}$/.test(value.programId||''),'Select the complete original Contributor browser session.');
  const state={tab:'editor',document:null,selectedAgreement:'',search:'',acceptanceFilter:'',newContributor:'',
    preview:null,previewVersion:null,selectedReview:'',saved:null,history:[],pending:null,accepted:null,rejected:null,
    handoff:null,receiving:null,receivingHistory:[],draftVersion:null,controls:{},portfolioFile:null,pendingPortfolioFile:null,
    storageOriginal:raw,requestReceipts:[]};
  for(const key of ENGAGEMENT_STATE_KEYS)if(own(value,key))state[key]=copy(value[key]);
  // Retain the exact complete old session, including notices and unknown
  // original fields, without copying them into a new active writer.
  state.storageOriginal=raw;
  const versions=[state.draftVersion,state.pending?.payload?.expectedVersion,state.accepted?.result?.version,
    state.receiving?.completedVersion,state.saved?.review?.version,state.preview?.caseVersion];
  const caseVersion=versions.find(v=>Number.isInteger(v)&&v>=1)??null;
  return validateEngagementWorkingCopy({schema:ENGAGEMENT_WORKING_SCHEMA,
    name:typeof value.document?.name==='string'&&value.document.name.trim()?value.document.name:'Recovered Contributor preparation',
    createdAt:new Date().toISOString(),binding:{programId:value.programId,caseVersion,planId:null,planRevision:null,
      scopeKey:null,recordingActor:state.pending?.payload?.actor||state.accepted?.payload?.actor||'',sources:[]},state,
    legacy:{schema:value.schema,file:copy(descriptor),originalSession:copy(value),
      limitations:['The original session did not bind a recording-staff scope. Explicit opening and native reconciliation are required.',
        'The entire original session and exact raw JSON remain retained; no original storage key is deleted.',
        'Original pending and accepted commands remain exact; no request is sent when this session is staged.',
        ...(caseVersion===null?['No original case version was retained; unsent work needs a new native review.']:[]),
        'The earlier session did not retain unfinished add-row controls or exact Portfolio file bytes.']}});
}
export async function readEngagementSessionText(raw,{name='Original Contributor browser session.json'}={}){
  need(typeof raw==='string','Keep the whole original browser session text.');
  const bytes=new TextEncoder().encode(raw);
  need(bytes.length>0&&bytes.length<=ENGAGEMENT_WORKING_MAX_BYTES,'The complete original browser session exceeds the supported working-file extent.');
  const file={name,bytes:bytes.length,sha256:await engagementBytesSha256(bytes)};
  const document=legacySessionWorking(JSON.parse(raw),file,raw);
  await verifyEngagementPortfolioFile(document.state);
  return {document,file};
}
export async function readEngagementWorkingFile(file){
  need(file&&Number.isInteger(file.size)&&file.size>0&&file.size<=ENGAGEMENT_WORKING_MAX_BYTES,'Select a complete working file up to 64 MiB.');
  const bytes=new Uint8Array(await file.arrayBuffer());need(bytes.byteLength===file.size,'The selected working file changed while being read.');
  const descriptor={name:file.name||'contributor-working-copy.json',bytes:bytes.length,sha256:await engagementBytesSha256(bytes)};
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error('The entire working file must be valid UTF-8 JSON.');}
  const document=value?.schema==='sf47.engagement-operator-draft.v1'?legacyWorking(value,descriptor):value?.schema==='sf47.engagement-operator.v1'?legacySessionWorking(value,descriptor,new TextDecoder('utf-8',{fatal:true}).decode(bytes)):validateEngagementWorkingCopy(value);
  await verifyEngagementPortfolioFile(document.state);
  return {document:copy(document),file:descriptor};
}
export function inspectEngagementWorkingCopy(document,currentBinding){
  validateEngagementWorkingCopy(document);bindingShape(currentBinding);
  const binding=document.binding,state=document.state,conflicts=[],observations=[];
  if(binding.programId!==currentBinding.programId)conflicts.push('The working file belongs to another native case. Open its original whole case first; identities are not remapped.');
  if(binding.scopeKey!==null&&binding.scopeKey!==currentBinding.scopeKey)conflicts.push('The working file belongs to another recording-staff browser scope.');
  if(binding.scopeKey===null)observations.push('This earlier draft has no retained staff scope or complete source inventory. Its original command actor and native results must be reconciled explicitly.');
  if(binding.planId!==null&&binding.planId!==currentBinding.planId)conflicts.push('The selected original planning case differs.');
  if(binding.caseVersion!==currentBinding.caseVersion)observations.push('The current case version differs; any unsent previews will be cleared and reviewed again.');
  const currentSources=new Map(currentBinding.sources.map(s=>[s.id,s]));
  const sources=binding.sources.map(row=>({original:copy(row),current:copy(currentSources.get(row.id)||null),
    status:!currentSources.has(row.id)?'MISSING':equalEngagementValue(row,currentSources.get(row.id))?'UNCHANGED':'CHANGED'}));
  if(sources.some(row=>row.status!=='UNCHANGED'))observations.push('Some original source metadata has changed or is missing. The native preview remains authoritative; no source is invented or replaced.');
  const commands=[state.pending,state.accepted,...state.requestReceipts,...(state.receiving?.receipts||[])].filter(Boolean).map(row=>({action:row.payload.action,requestId:row.payload.requestId,actor:row.payload.actor,expectedVersion:row.payload.expectedVersion,result:row.result||null}));
  return {canOpen:conflicts.length===0,conflicts,observations,binding:copy(binding),currentBinding:copy(currentBinding),
    agreements:state.document?.agreements.length||0,selectedReview:state.saved?.review.id||state.selectedReview||null,
    receivingPhase:state.receiving?.phase||null,commands,sources,portfolioFile:state.portfolioFile?{name:state.portfolioFile.name,bytes:state.portfolioFile.bytes,sha256:state.portfolioFile.sha256}:null};
}
export async function reconcileEngagementWorkingState(state,{programId,lookup,read}){
  engagementStateShape(state,programId);
  const next=copy(state),observations=[],seen=new Map();
  const rows=[next.pending,next.accepted,...next.requestReceipts,...(next.receiving?.receipts||[])].filter(Boolean);
  for(const row of rows){
    const requestId=row.payload.requestId,prior=seen.get(requestId);
    if(prior){
      need(equalEngagementValue(prior.payload,row.payload),'One request ID has differing retained command bodies.');
      need(equalEngagementValue(prior.context??null,row.context??null),'One original request has differing receiving context.');
      if(prior.result&&row.result)need(equalEngagementValue(prior.result,row.result),'One original request has differing retained results.');
      if(!prior.result&&row.result)prior.result=copy(row.result);
    }else seen.set(requestId,copy(row));
  }
  for(const row of seen.values()){
    const value=await lookup(copy(row.payload));
    need(value?.schema==='stellar-forge.sf47-engagement-request.v1'&&value.programId===programId&&value.requestId===row.payload.requestId&&typeof value.found==='boolean','The native request lookup did not return its exact selected identity.');
    if(row.result)need(value.found&&equalEngagementValue(value.result,row.result),'A retained accepted result differs from the original native request journal.');
    if(!value.found){observations.push({action:row.payload.action,requestId:row.payload.requestId,status:'NOT_FOUND'});continue;}
    need(value.result?.id===programId&&value.result.action===row.payload.action,'The native accepted result belongs to another command.');
    if(next.pending?.payload.requestId===row.payload.requestId){next.accepted={payload:copy(row.payload),context:copy(row.context||null),result:copy(value.result)};next.pending=null;}
    observations.push({action:row.payload.action,requestId:row.payload.requestId,status:'ACCEPTED',result:copy(value.result)});
  }
  const verifyBook=async book=>{
    if(!book)return;
    const original=await read('engagements/'+encodeURIComponent(book.review.id));
    need(original?.review?.id===book.review.id&&original.review.sha256===book.review.sha256&&['review','document','source','report','previewSha256'].every(key=>equalEngagementValue(original[key],book[key])),'The complete saved engagement book differs from its original native edition.');
  };
  await verifyBook(next.saved);if(next.handoff?.book&&!equalEngagementValue(next.handoff.book,next.saved))await verifyBook(next.handoff.book);
  const flow=next.receiving;
  if(flow?.forecastId){
    const value=await read('forecasts/'+encodeURIComponent(flow.forecastId));
    need(value?.id===flow.forecastId&&value.sha256===flow.forecastSha256&&equalEngagementValue(value.inputs,flow.forecastInputs),'The saved original Forecast differs from the retained receiving.');
  }
  if(flow?.portfolioId){
    const value=await read('portfolios/'+encodeURIComponent(flow.portfolioId));
    need(value?.id===flow.portfolioId&&value.sha256===flow.portfolioSha256&&equalEngagementValue(value.inputs,flow.portfolioInputs),'The saved original Portfolio differs from the retained receiving.');
  }
  if(flow?.receivingReviewId){
    const value=await read('reviews/'+encodeURIComponent(flow.receivingReviewId));
    need(value?.id===flow.receivingReviewId&&value.sha256===flow.receivingSha256&&value.purpose==='CONTRIBUTOR_ENGAGEMENTS_RECEIVING'&&value.engagementReceiving?.book?.id===flow.reviewId&&value.engagementReceiving?.forecast?.id===flow.forecastId&&value.engagementReceiving?.portfolio?.id===flow.portfolioId,'The original receiving review differs from its retained native join.');
  }
  return {state:next,observations};
}
