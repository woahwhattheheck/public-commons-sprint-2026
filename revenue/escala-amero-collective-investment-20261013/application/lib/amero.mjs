// MIT. Pure reconciliation of retained Escala collective-investment, SDP and Stellar evidence.
// No provider, persistence, timer, or financial mutation is performed by this module.
import {invariant,sha256,canonicalJSON} from './source-json.mjs';
import {decimalParts,decimalString,exactField} from './decimal.mjs';

const clone=v=>JSON.parse(JSON.stringify(v));
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const own=(v,k)=>Object.hasOwn(v??{},k);
const hash=v=>sha256(canonicalJSON(v));
const required=(v,code,max=16000)=>{invariant(typeof v==='string'&&v.length>0&&v.length<=max&&v.isWellFormed()&&!v.includes('\0'),code);return v;};
const optional=v=>v===undefined||v===null||v===''?null:required(v,'INVALID_OPTIONAL_TEXT');
const notes=v=>{invariant(typeof v==='string'&&v.length<=32000&&v.isWellFormed()&&!v.includes('\0'),'NOTES_REQUIRED');return v;};
const strings=(v=[])=>{invariant(Array.isArray(v)&&v.every(x=>typeof x==='string'&&x.length>0&&x.length<=4096&&x.isWellFormed()&&!x.includes('\0')),'STRING_LIST_REQUIRED');invariant(new Set(v).size===v.length,'DUPLICATE_SELECTION');return [...v];};
const scope=v=>v.sourceScope??v.context?.providerScope??null;
const originalId=v=>typeof v.resourceId==='string'&&v.resourceId?v.resourceId:typeof v.value?.id==='string'?v.value.id:null;
const nativeProvider=v=>v.provider??v.kind?.split('-')[0];
const inScope=(v,b)=>v&&v.environment===b.environment&&(b.connections[nativeProvider(v)]??[]).includes(v.connectionAlias);
const key=v=>canonicalJSON([scope(v),v.environment,v.kind,originalId(v)]);
const nonempty=v=>typeof v==='string'&&v.length>0;
const check=(row,code,state,evidence={})=>{row.checks.push({code,state,...clone(evidence)});};
const finalState=checks=>checks.some(x=>x.state==='MISMATCH')?'MISMATCH':checks.some(x=>x.state==='UNKNOWN')?'UNKNOWN':'MATCH';

// Strict external decimal limits come from the maintained decimal module.
// Internal canonical expansion/sums are read separately, so valid exponent inputs
// never fail merely because their exact expanded result is longer than the source token.
function parts(v){const m=/^(-?)(\d+)(?:\.(\d+))?$/.exec(v);invariant(m,'INTERNAL_DECIMAL_INVALID');return{coefficient:BigInt((m[1]||'')+m[2]+(m[3]||'')),scale:(m[3]||'').length};}
function fmt(p){while(p.scale>0&&p.coefficient%10n===0n){p={coefficient:p.coefficient/10n,scale:p.scale-1};}return decimalString(p);}
function decimal(v){return fmt(decimalParts(required(v,'EXACT_DECIMAL_TEXT_REQUIRED',256)));}
function add(a,b){const x=parts(a),y=parts(b),s=Math.max(x.scale,y.scale);return fmt({coefficient:x.coefficient*10n**BigInt(s-x.scale)+y.coefficient*10n**BigInt(s-y.scale),scale:s});}
function sub(a,b){const p=parts(b);return add(a,fmt({coefficient:-p.coefficient,scale:p.scale}));}
function mul(a,b){const x=parts(a),y=parts(b);return fmt({coefficient:x.coefficient*y.coefficient,scale:x.scale+y.scale});}
function cmp(a,b){const n=parts(sub(a,b)).coefficient;return n<0n?-1:n>0n?1:0;}
const sum=a=>a.reduce(add,'0');
const positive=v=>{const d=decimal(v);invariant(cmp(d,'0')>0,'POSITIVE_AMOUNT_REQUIRED');return d;};
const zeroFloor=v=>cmp(v,'0')<0?'0':v;
function readAmount(row,v,field,pointer='',{integer=false,required=true}={}){
 const raw=v.value,location=pointer+'/'+field;
 try{
  const selected=pointer?pointer.slice(1).split('/').reduce((o,k)=>o?.[k],raw):raw;
  const d=exactField(selected,field,v.numberTokens??{},pointer);
  if(d===null){if(required)check(row,'AMOUNT_UNAVAILABLE','UNKNOWN',{field:location});return null;}
  if(cmp(d,'0')<0){check(row,'NEGATIVE_AMOUNT','MISMATCH',{field:location,value:d});return null;}
  if(integer&&parts(d).scale!==0){check(row,'MINOR_UNIT_INTEGER_REQUIRED','MISMATCH',{field:location,value:d});return null;}
  return d;
 }catch(e){check(row,'ORIGINAL_AMOUNT_INVALID','UNKNOWN',{field:location,reason:e.code??e.message});return null;}
}
function instant(v){
 if(typeof v!=='string'||v.length>200)return null;
 const m=/^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d):(\d\d)(?:\.(\d{1,100}))?(Z|([+-])(\d\d):(\d\d))$/.exec(v);
 if(!m)return null;
 const [y,mo,d,h,mi,s]=m.slice(1,7).map(Number),leap=y%4===0&&(y%100!==0||y%400===0);
 if(mo<1||mo>12||d<1||d>[31,leap?29:28,31,30,31,30,31,31,30,31,30,31][mo-1]||h>23||mi>59||s>59||m[9]&&(Number(m[10])>23||Number(m[11])>59))return null;
 const base=Date.parse(v.slice(0,19)+m[8]);if(!Number.isFinite(base))return null;
 const frac=m[7]??'',scale=frac.length,coefficient=BigInt(base/1000)*10n**BigInt(scale)+(frac?BigInt(frac):0n);
 return fmt({coefficient,scale});
}
function periodMembership(v,b){const t=instant(v),lo=instant(b.period.start),hi=instant(b.period.end);return t===null?null:cmp(t,lo)>=0&&cmp(t,hi)<0;}

export const RESULT_ARRAYS=Object.freeze(['communities','funds','contributions','tokens','proposals','votes','milestones','evidence','attestations','disbursementRequests','disbursements','sdpDisbursements','payments','receivers','wallets','assets','settlements','events','allocations','decisions','rejectedDecisions','totals','findings','sourceGaps','distributionWallets','balances','capabilities','organizations']);
const KIND_ARRAY=Object.freeze({
 'escala-community':'communities','escala-fund':'funds','escala-contribution':'contributions',
 'escala-token-mint':'tokens','escala-token-balance':'tokens',
 'escala-proposal':'proposals','escala-vote':'votes','escala-delegation':'votes','escala-tally':'votes',
 'escala-milestone':'milestones','escala-evidence':'evidence','escala-attestation':'attestations',
 'escala-disbursement-request':'disbursementRequests','escala-disbursement':'disbursements',
 'escala-audit-event':'events','escala-dashboard':'events','escala-moneygram-event':'events','escala-sdp-event':'events',
 'sdp-disbursement':'sdpDisbursements','sdp-payment':'payments','sdp-receiver':'receivers','sdp-wallet':'wallets','sdp-asset':'assets',
 'sdp-distribution-wallet':'distributionWallets','sdp-balance':'balances','sdp-capabilities':'capabilities',
 'sdp-organization':'organizations','sdp-statistics':'organizations','horizon-operation':'settlements',
 'horizon-transaction':'events','horizon-network':'events'
});
const RELATIONS=Object.freeze({
 'community-fund':['escala-community','escala-fund'],
 'proposal-milestone':['escala-proposal','escala-milestone'],
 'proposal-vote':['escala-proposal',['escala-vote','escala-delegation','escala-tally']],
 'milestone-evidence':['escala-milestone','escala-evidence'],
 'milestone-attestation':['escala-milestone','escala-attestation'],
 'milestone-disbursement':['escala-milestone',['escala-disbursement-request','escala-disbursement']],
 'disbursement-sdp':[['escala-disbursement-request','escala-disbursement'],'sdp-disbursement'],
 'disbursement-payment':['sdp-disbursement','sdp-payment'],
 'payment-settlement':['sdp-payment','horizon-operation']
});
export const AMERO_CONTRACT=Object.freeze({schema:'amero.reconciliation.v1',resourceKinds:Object.keys(KIND_ARRAY),resultArrays:RESULT_ARRAYS,relations:Object.keys(RELATIONS)});
export function normalizeBook(input){
 invariant(object(input),'BOOK_OBJECT_REQUIRED');invariant(['sandbox','production'].includes(input.environment),'BOOK_ENVIRONMENT_REQUIRED');
 invariant(object(input.connections),'BOOK_CONNECTIONS_REQUIRED');
 const connections={escala:strings(input.connections.escala),sdp:strings(input.connections.sdp),horizon:strings(input.connections.horizon)};
 invariant(connections.escala.length||connections.sdp.length,'SOURCE_CONNECTION_REQUIRED');
 invariant(object(input.period),'BOOK_PERIOD_REQUIRED');const start=required(input.period.start,'PERIOD_START_REQUIRED',200),end=required(input.period.end,'PERIOD_END_REQUIRED',200);
 invariant(instant(start)!==null&&instant(end)!==null&&cmp(instant(start),instant(end))<0,'BOOK_PERIOD_INVALID');
 const timeZone=required(input.period.timeZone,'TIMEZONE_REQUIRED',128);try{new Intl.DateTimeFormat('en',{timeZone}).format(new Date(0));}catch{invariant(false,'TIMEZONE_INVALID');}
 return{id:required(input.id,'BOOK_ID_REQUIRED',200),name:required(input.name,'BOOK_NAME_REQUIRED',500),environment:input.environment,connections,
 tenantId:optional(input.tenantId),communityId:optional(input.communityId),fundId:optional(input.fundId),
 projectIds:strings(input.projectIds),proposalIds:strings(input.proposalIds),milestoneIds:strings(input.milestoneIds),distributionWalletIds:strings(input.distributionWalletIds),
 period:{start,end,timeZone},notes:notes(input.notes??'')};
}
function refs(v,rows,code){const out=strings(v);for(const id of out)invariant(rows.some(x=>x.id===id),code,{id});return out;}
function decisionTips(decisions){
 const index=new Map(),children=new Map();
 for(const d of decisions){invariant(nonempty(d.id)&&!index.has(d.id),'DECISION_ID_DUPLICATE');index.set(d.id,d);}
 for(const d of decisions){
  if(d.supersedesDecisionId){const p=index.get(d.supersedesDecisionId);invariant(p&&p.bookId===d.bookId&&p.subjectVersionId===d.subjectVersionId,'DECISION_PARENT_INVALID');invariant(!children.has(p.id),'DECISION_FORK');children.set(p.id,d.id);}
  const seen=new Set();let at=d;while(at?.supersedesDecisionId){invariant(!seen.has(at.id),'DECISION_CYCLE');seen.add(at.id);at=index.get(at.supersedesDecisionId);}
 }
 return decisions.filter(x=>!children.has(x.id));
}
function normalizeUnit(input){
 invariant(object(input),'UNIT_BINDING_REQUIRED');
 const o={network:required(input.network,'NETWORK_REQUIRED',500),assetType:input.assetType,assetCode:required(input.assetCode,'ASSET_CODE_REQUIRED',12),assetIssuer:optional(input.assetIssuer),
 account:required(input.account,'ACCOUNT_REQUIRED',200),memoType:input.memoType??'none',memo:input.memo==null?null:notes(input.memo)};
 invariant(['native','credit_alphanum4','credit_alphanum12'].includes(o.assetType),'STELLAR_ASSET_TYPE_REQUIRED');
 invariant(o.assetType==='native'?o.assetCode==='XLM'&&o.assetIssuer===null:!!o.assetIssuer&&o.assetCode.length<=(o.assetType==='credit_alphanum4'?4:12),'ASSET_UNIT_INVALID');
 invariant(['none','text','id','hash','return'].includes(o.memoType),'MEMO_TYPE_INVALID');invariant(o.memoType==='none'?o.memo===null:o.memo!==null,'MEMO_BINDING_INCOMPLETE');
 return o;
}
function relationValid(name,a,b){const pair=RELATIONS[name];return pair&&[pair[0]].flat().includes(a)&&[pair[1]].flat().includes(b);}
export function normalizeLinkDecision(input,{book,versions=[],sources=[],decisions=[]}){
 book=normalizeBook(book);invariant(object(input),'DECISION_OBJECT_REQUIRED');if(input.bookId!==undefined)invariant(input.bookId===book.id,'DECISION_BOOK_CHANGED');
 invariant(['note','include','exclude','relate','allocate','withdraw'].includes(input.kind),'DECISION_KIND_REQUIRED');
 invariant(['proposed','accepted','rejected'].includes(input.status),'DECISION_STATUS_REQUIRED');
 const subject=versions.find(x=>x.id===input.subjectVersionId);invariant(subject&&KIND_ARRAY[subject.kind]&&inScope(subject,book),'SUBJECT_OUTSIDE_BOOK');
 const cohort=decisions.filter(d=>d.bookId===book.id),tips=decisionTips(cohort),parent=input.supersedesDecisionId?cohort.find(d=>d.id===input.supersedesDecisionId):null;
 if(input.supersedesDecisionId)invariant(parent&&parent.subjectVersionId===subject.id&&tips.some(x=>x.id===parent.id),'CURRENT_DECISION_TIP_REQUIRED');
 if(input.kind==='withdraw')invariant(parent,'WITHDRAWAL_PARENT_REQUIRED');
 const out={bookId:book.id,subjectVersionId:subject.id,kind:input.kind,status:input.status,targetVersionId:null,relation:null,subjectAmount:null,targetAmount:null,unitBinding:null,
 reason:required(input.reason,'REASON_REQUIRED'),actor:required(input.actor,'ACTOR_REQUIRED',500),recordedAt:required(input.recordedAt,'RECORDED_TIME_REQUIRED',200),sources:refs(input.sources??[],sources,'SUPPORTING_SOURCE_MISSING'),supersedesDecisionId:parent?.id??null};
 invariant(instant(out.recordedAt)!==null,'RECORDED_TIME_INVALID');
 if(['relate','allocate'].includes(input.kind)){
  const target=versions.find(v=>v.id===input.targetVersionId);invariant(target&&inScope(target,book),'TARGET_OUTSIDE_BOOK');out.targetVersionId=target.id;
  if(input.kind==='relate'){invariant(relationValid(input.relation,subject.kind,target.kind),'RELATION_KIND_MISMATCH');out.relation=input.relation;}
  else{invariant(subject.kind==='sdp-payment'&&target.kind==='horizon-operation','SDP_PAYMENT_HORIZON_REQUIRED');out.relation='payment-settlement';out.subjectAmount=positive(input.subjectAmount);out.targetAmount=positive(input.targetAmount);invariant(cmp(out.subjectAmount,out.targetAmount)===0,'SAME_ASSET_AMOUNT_REQUIRED');invariant(parts(out.targetAmount).scale<=7,'STELLAR_PRECISION_EXCEEDED');out.unitBinding=normalizeUnit(input.unitBinding);}
 }else for(const k of ['targetVersionId','relation','subjectAmount','targetAmount','unitBinding'])invariant(input[k]==null||input[k]==='','NON_LINK_FIELDS_MUST_BE_EMPTY');
 return out;
}
function originalSourceOK(source,v){
 return !!source&&source.bodyComplete===true&&!source.error&&!source.projectionError&&source.classification?.outcome==='accepted'&&
 source.environment===v.environment&&source.sourceScope===scope(v)&&
 /^[a-f0-9]{64}$/.test(source.bodySha256??'')&&/^[a-f0-9]{64}$/.test(source.requestSha256??'')&&
 Array.isArray(source.versionIds)&&source.versionIds.includes(v.id);
}
function select(versions,book,coverage,exception){
 const byId=new Map(),groups=new Map(),conflicts=new Set((coverage.selectionConflicts??[]).flatMap(x=>x.versionIds??[]));
 for(const v of versions){
  invariant(object(v)&&nonempty(v.id),'ORIGINAL_VERSION_REQUIRED');
  if(!KIND_ARRAY[v.kind]){exception('UNSUPPORTED_AUXILIARY_RESOURCE',{versionId:v.id,kind:v.kind,originalVersion:clone(v)});continue;}
  if(!inScope(v,book)){exception('VERSION_OUTSIDE_BOOK',{versionId:v.id,kind:v.kind,originalVersion:clone(v)});continue;}
  invariant(object(v.value),'ORIGINAL_RECORD_OBJECT_REQUIRED');
  if(byId.has(v.id)){invariant(canonicalJSON(byId.get(v.id))===canonicalJSON(v),'VERSION_ID_BODY_CONFLICT');continue;}
  byId.set(v.id,v);const k=key(v),g=groups.get(k)??[];g.push(v);groups.set(k,g);
 }
 const entries=[];
 for(const [k,g]of groups){
  const signatures=new Set(g.map(v=>canonicalJSON([v.value,v.numberTokens??{},v.context?.tenantId??null,v.context?.apiMode??null]))),bad=!scope(g[0])||!originalId(g[0])||signatures.size>1||g.some(v=>conflicts.has(v.id));
  if(bad)exception('RESOURCE_SELECTION_UNRESOLVED',{resourceKey:k,versionIds:g.map(v=>v.id)});
  const partition=new Map();for(const v of g){const sk=canonicalJSON([v.value,v.numberTokens??{},v.context?.tenantId??null,v.context?.apiMode??null]);const a=partition.get(sk)??[];a.push(v);partition.set(sk,a);}
  for(const a of partition.values())entries.push({version:a[0],versions:a,ambiguous:bad});
 }
 return{entries,byId};
}
function observedTime(v){const x=v.value;for(const k of ['created_at','createdAt','date','timestamp','verifiedAt','votingDate','disbursmentsDate','completedAt'])if(own(x,k))return{field:k,value:x[k]};return{field:null,value:null};}
function common(entry,book,sources){
 const v=entry.version,t=observedTime(v),row={id:hash([v.kind,v.id]),kind:v.kind,versionId:v.id,observedVersionIds:entry.versions.map(x=>x.id),resourceId:originalId(v),
 sourceId:v.sourceId,sourceIds:[...new Set(entry.versions.map(x=>x.sourceId))],sourceScope:scope(v),environment:v.environment,connectionAlias:v.connectionAlias,
 apiMode:v.context?.apiMode??'unknown',executionSemantics:v.context?.executionSemantics??null,tenantId:v.context?.tenantId??null,
 providerStatus:v.value.status??null,status:'UNKNOWN',original:clone(v.value),numberTokens:clone(v.numberTokens??{}),context:clone(v.context??{}),
 checks:[],relatedVersionIds:[],amounts:{},currency:v.value.currency??null,inPeriod:periodMembership(t.value,book),periodBasis:t.field,
 filterMatch:true,excluded:false,selectionAmbiguous:entry.ambiguous,allocatedAmount:'0',remainingAmount:null};
 if(entry.ambiguous)check(row,'SELECTED_RESOURCE_IDENTITY','UNKNOWN');
 if(!row.sourceScope||!row.resourceId)check(row,'SOURCE_IDENTITY','UNKNOWN');
 if(nonempty(v.value.id)&&v.value.id!==row.resourceId)check(row,'NATIVE_RECORD_IDENTITY','MISMATCH',{recordId:v.value.id,resourceId:row.resourceId});
 for(const x of entry.versions)check(row,'ORIGINAL_SOURCE',originalSourceOK(sources.find(s=>s.id===x.sourceId),x)?'MATCH':'UNKNOWN',{sourceId:x.sourceId,versionId:x.id});
 if(v.kind.startsWith('escala-')){
  check(row,'PUBLISHED_MOCK_CONTRACT','UNKNOWN',{apiMode:row.apiMode,executionSemantics:row.executionSemantics,meaning:'The selected catalogue returns mock examples; an observed response is not independent execution or authorization.'});
  if(book.tenantId)check(row,'TENANT_SELECTOR',row.tenantId===book.tenantId?'MATCH':'UNKNOWN',{expected:book.tenantId,observed:row.tenantId,binding:v.context?.tenantBinding??null});
 }
 return row;
}
function sameScope(a,b){return a.sourceScope===b.sourceScope&&a.environment===b.environment;}
function parentId(v,field){const x=v.value,c=v.context??{},params=c.params??c.requestInput?.params??{},body=c.body??c.requestInput?.body??{},r=c.responseIdentity??{};const value=x[field]??r[field]??params[field]??body[field];return nonempty(value)?value:null;}
function linked(row,rows,kind,id,{required=true}={}){
 if(!id){if(required)check(row,'RELATED_ID_MISSING','UNKNOWN',{kind});return null;}
 const a=rows.filter(x=>x.kind===kind&&sameScope(row,x)&&x.resourceId===id);
 row.relatedVersionIds.push(...a.flatMap(x=>x.observedVersionIds));
 if(a.length!==1||a[0].selectionAmbiguous){check(row,'RELATED_RECORD_UNRESOLVED','UNKNOWN',{kind,id,versionIds:a.flatMap(x=>x.observedVersionIds)});return null;}return a[0];
}
function finalRows(rows){for(const r of rows){r.relatedVersionIds=[...new Set(r.relatedVersionIds)];r.status=finalState(r.checks);}}


function assetIdentity(value){
 if(!object(value))return null;
 const code=value.code??value.asset_code,issuer=value.issuer??value.asset_issuer??null;
 if(code==='XLM'&&(issuer===null||issuer===''))return{assetType:'native',assetCode:'XLM',assetIssuer:null};
 if(typeof code==='string'&&code.length>0&&code.length<=12&&typeof issuer==='string'&&issuer.length>0)return{assetType:code.length<=4?'credit_alphanum4':'credit_alphanum12',assetCode:code,assetIssuer:issuer};
 return null;
}
function originalAsset(row,v,rows){
 const raw=v.value.asset??null,asset=assetIdentity(raw);row.asset=asset;row.currency=asset?asset.assetCode:null;
 if(raw?.id)linked(row,rows,'sdp-asset',raw.id,{required:false});
 check(row,'EXACT_ASSET',asset?'MATCH':'UNKNOWN',{original:raw});
 return asset;
}
function projectedAmounts(row,v,fields){
 for(const f of fields){if(own(v.value,f))row.amounts[f]=readAmount(row,v,f);}
}
function scopedFilter(row,v,book){
 const filters=[['communityId',book.communityId?[book.communityId]:[]],['fundId',book.fundId?[book.fundId]:[]],['projectId',book.projectIds],['proposalId',book.proposalIds],['milestoneId',book.milestoneIds]];
 const ownIdentity={'escala-community':'communityId','escala-fund':'fundId','escala-proposal':'proposalId','escala-milestone':'milestoneId'};
 for(const [field,ids]of filters){if(!ids.length||!v.kind.startsWith('escala-'))continue;const id=ownIdentity[v.kind]===field?row.resourceId:parentId(v,field);if(id&&!ids.includes(id))row.filterMatch=false;else if(!id)check(row,'BOOK_FILTER_SCOPE','UNKNOWN',{field,selected:ids});}
 if(v.kind==='sdp-payment'||v.kind==='sdp-disbursement'){
  const id=v.value.source_wallet_id??v.context?.requestInput?.headers?.['X-Wallet-Id']??null;
  row.distributionWalletId=id;
  if(book.distributionWalletIds.length){if(!id)check(row,'SOURCE_WALLET_SCOPE','UNKNOWN');else if(!book.distributionWalletIds.includes(id))row.filterMatch=false;}
 }
}
function project(entry,book,sources,rows){
 const v=entry.version,r=rows.find(x=>x.versionId===v.id),x=v.value;
 scopedFilter(r,v,book);
 const parent=(field,kind,required=true)=>linked(r,rows,kind,parentId(v,field),{required});
 switch(v.kind){
 case 'escala-community':break;
 case 'escala-fund':parent('communityId','escala-community');projectedAmounts(r,v,['totalBalance','balanceUsdc']);r.measure='treasury-summary';break;
 case 'escala-contribution':parent('fundId','escala-fund');projectedAmounts(r,v,['amount']);r.currency='USDC';r.measure='contribution-observation';break;
 case 'escala-token-mint':parent('fundId','escala-fund');projectedAmounts(r,v,['amount']);r.measure='token-mint';r.tokenId=x.token??null;check(r,'TOKEN_NOT_CASH','MATCH');check(r,'ONCHAIN_MINT_PROOF','UNKNOWN',{observed:x.onchainProof??null});break;
 case 'escala-token-balance':r.measure='token-balance';check(r,'BALANCES_NOT_FLOWS','MATCH');for(const field of ['projectTokens','governanceTokens']){if(own(x,field)&&!Array.isArray(x[field]))check(r,'TOKEN_COLLECTION_INVALID','UNKNOWN',{field});}break;
 case 'escala-proposal':parent('communityId','escala-community');projectedAmounts(r,v,['amountUsdc']);r.currency='USDC';r.measure='proposal-request';check(r,'VOTING_POLICY','UNKNOWN',{meaning:'A voting window or proposed amount is not an accepted vote result; governance policy and snapshot must be supplied.'});break;
 case 'escala-vote':case 'escala-delegation':parent('proposalId','escala-proposal');projectedAmounts(r,v,['amount']);check(r,'GOVERNANCE_SIGNATURE','UNKNOWN',{meaning:'Retained response and supplied signature have not been independently verified.'});break;
 case 'escala-tally':parent('proposalId','escala-proposal');projectedAmounts(r,v,['yesWeight','noWeight','quorumRequired']);r.reportedResult=x.result??null;check(r,'TALLY_POLICY_AND_SNAPSHOT','UNKNOWN',{snapshotId:x.snapshotId??null,meaning:'No electorate, complete voting population, threshold rule or snapshot proof is inferred from these reported weights.'});break;
 case 'escala-milestone':parent('proposalId','escala-proposal');projectedAmounts(r,v,['amountUsdc']);r.currency='USDC';r.measure='milestone-budget';check(r,'MILESTONE_COMPLETION','UNKNOWN',{meaning:'An open/create response and supporting documents are separate from accepted completion.'});break;
 case 'escala-evidence':parent('milestoneId','escala-milestone');check(r,'EVIDENCE_CONTENT_PROOF','UNKNOWN',{hash:x.evidenceHash??null,meaning:'A reference/hash is retained; complete evidence file bytes are a separate selected source.'});break;
 case 'escala-attestation':parent('milestoneId','escala-milestone',false);parent('proposalId','escala-proposal',false);check(r,'ORACLE_SIGNATURE_AND_AUTHORITY','UNKNOWN',{attestor:x.attestorId??x.verifiedBy??null,evidenceHash:x.evidenceHash??null});break;
 case 'escala-disbursement-request':parent('proposalId','escala-proposal');parent('milestoneId','escala-milestone');projectedAmounts(r,v,['amountUsdc']);r.currency='USDC';r.measure='release-request';break;
 case 'escala-disbursement':parent('proposalId','escala-proposal',false);parent('disbursementRequestId','escala-disbursement-request',false);projectedAmounts(r,v,['amountUsdc']);r.currency='USDC';r.measure='release-observation';check(r,'INDEPENDENT_PAYMENT_REQUIRED','UNKNOWN',{onchainTx:x.onchainTx??null});break;
 case 'sdp-disbursement':
  originalAsset(r,v,rows);if(x.wallet?.id)linked(r,rows,'sdp-wallet',x.wallet.id,{required:false});
  if(x.source_wallet_id)linked(r,rows,'sdp-distribution-wallet',x.source_wallet_id);
  r.measure='disbursement-summary';r.reportedStatistics=clone(x.statistics??x.stats??null);
  check(r,'SUMMARY_ROUNDING','MATCH',{meaning:'Original SDP statistics round some amount totals to two decimal places; exact individual payments form a separate layer.'});break;
 case 'sdp-payment':{
  const a=originalAsset(r,v,rows);r.amount=readAmount(r,v,'amount');r.amounts.payment=r.amount;r.remainingAmount=r.amount;r.measure='payment';
  r.providerFinal=x.status==='SUCCESS';r.network=v.context?.networkPassphrase??null;r.transactionHash=x.stellar_transaction_id??null;r.operationId=x.stellar_operation_id==null?null:typeof x.stellar_operation_id==='string'?x.stellar_operation_id:v.numberTokens?.['/stellar_operation_id']??null;
  r.receiverWallet=clone(x.receiver_wallet??null);
  if(r.amount!==null)check(r,'STELLAR_AMOUNT_BOUND',parts(r.amount).scale<=7&&cmp(r.amount,'922337203685.4775807')<=0?'MATCH':'MISMATCH');
  if(x.type==='DISBURSEMENT'){linked(r,rows,'sdp-disbursement',x.disbursement?.id??x.disbursement_id??null);}else if(x.type!=='DIRECT')check(r,'PAYMENT_TYPE','UNKNOWN',{observed:x.type??null});
  if(x.source_wallet_id){const wallet=linked(r,rows,'sdp-distribution-wallet',x.source_wallet_id);r.sourceAccount=wallet?.original.distribution_account_address??null;
   r.sourceAccountEvidence=wallet?{versionIds:[...wallet.observedVersionIds],sourceIds:[...wallet.sourceIds],checks:clone(wallet.checks.filter(c=>['ORIGINAL_SOURCE','SELECTED_RESOURCE_IDENTITY','SOURCE_IDENTITY','NATIVE_RECORD_IDENTITY'].includes(c.code)))}:null;
  }else{r.sourceAccount=null;r.sourceAccountEvidence=null;check(r,'SOURCE_WALLET_ID','UNKNOWN');}
  r.destinationAccount=x.receiver_wallet?.stellar_address??x.receiver_wallet?.stellarAddress??null;
  r.destinationMemo=x.receiver_wallet?.stellar_memo??null;r.destinationMemoType=x.receiver_wallet?.stellar_memo_type??null;
  r.economicKey=canonicalJSON([r.network,r.environment,r.sourceScope,r.resourceId]);
  if(r.inPeriod===null)check(r,'PERIOD_MEMBERSHIP','UNKNOWN',{basis:r.periodBasis});
  break;}
 case 'sdp-receiver':r.measure='receiver-evidence';if(x.payment)check(r,'NESTED_PAYMENT_NOT_COUNTED','MATCH',{meaning:'Nested receiver payment is retained intact; selected payment resource is the economic row.'});break;
 case 'sdp-wallet':r.measure='recipient-provider';break;
 case 'sdp-asset':r.asset=assetIdentity(x);check(r,'EXACT_ASSET',r.asset?'MATCH':'UNKNOWN');break;
 case 'sdp-distribution-wallet':r.measure='distribution-account';check(r,'WALLET_LIFECYCLE',x.status==='ACTIVE'?'MATCH':x.status?'MISMATCH':'UNKNOWN',{status:x.status??null,distributionAccountStatus:x.distribution_account_status??null});break;
 case 'sdp-balance':r.measure='balance-snapshot';check(r,'BALANCES_NOT_FLOWS','MATCH');break;
 case 'sdp-capabilities':r.measure='capability-observation';check(r,'CAPABILITY_CONTEXT','MATCH',{meaning:'A retained capability response is specific to its original authenticated user/account request; it is not delegated approval.'});break;
 case 'sdp-organization':case 'sdp-statistics':r.measure='organization-summary';break;
 default:r.measure='event-evidence';check(r,'EVENT_NOT_CASH','MATCH');
 }
 if(v.kind.startsWith('escala-')&&/event$/.test(v.kind))check(r,'CALLBACK_AUTHENTICITY','UNKNOWN',{meaning:'The published mock provides no complete signed-byte/replay protocol and no implemented callback router.'});
}
function movement(entry,book,sources,cohort){
 const r=common(entry,book,sources),v=entry.version,o=v.value,network=v.context?.networkPassphrase??null,txHash=o.transaction_hash??null;
 const txs=cohort.filter(x=>x.kind==='horizon-transaction'&&scope(x)===scope(v)&&x.environment===v.environment&&originalId(x)===txHash);
 const txSignatures=new Set(txs.map(x=>canonicalJSON([x.value,x.numberTokens??{}])));
 const inline=object(o.transaction)?o.transaction:null,tx=txSignatures.size===1?txs[0].value:txs.length===0?inline:null;
 const networks=cohort.filter(x=>x.kind==='horizon-network'&&scope(x)===scope(v)&&x.environment===v.environment&&x.value.network_passphrase===network);
 const supported=['payment','path_payment_strict_send','path_payment_strict_receive'].includes(o.type),native=o.asset_type==='native';
 Object.assign(r,{transactionHash:txHash,operationType:o.type??null,network,assetType:o.asset_type??null,assetCode:native?'XLM':o.asset_code??null,
  assetIssuer:o.asset_issuer??null,from:o.from??null,to:o.to??null,fromMuxed:o.from_muxed??null,toMuxed:o.to_muxed??null,
  amount:readAmount(r,v,'amount'),memoType:tx?.memo_type??null,memo:tx?.memo_type==='none'?null:tx?.memo??null,
  transactionVersionIds:txs.map(x=>x.id),networkVersionIds:networks.map(x=>x.id),transaction:tx?clone(tx):null,settled:false,
  economicKey:canonicalJSON([network,v.environment,txHash,originalId(v)]),allocatedAmount:'0',remainingAmount:null});
 r.relatedVersionIds.push(...r.transactionVersionIds,...r.networkVersionIds);
 check(r,'PAYMENT_OPERATION',supported?'MATCH':'UNKNOWN',{type:o.type??null});
 check(r,'NETWORK_PROOF',nonempty(network)&&networks.length>0?'MATCH':'UNKNOWN',{network,versionIds:r.networkVersionIds});
 check(r,'TRANSACTION_IDENTITY',nonempty(txHash)&&tx&&tx.hash===txHash&&txSignatures.size<=1?'MATCH':'UNKNOWN',{operationHash:txHash,observed:tx?.hash??null,versionIds:r.transactionVersionIds});
 if(inline&&inline.hash!==txHash)check(r,'INLINE_TRANSACTION_IDENTITY','MISMATCH',{expected:txHash,observed:inline.hash??null});
 check(r,'TRANSACTION_SUCCESS',o.transaction_successful===true&&tx?.successful===true?'MATCH':o.transaction_successful===false||tx?.successful===false?'MISMATCH':'UNKNOWN');
 if(tx&&inline&&txs.length&&canonicalJSON([tx.hash??null,tx.successful??null,tx.memo_type??null,tx.memo??null])!==canonicalJSON([inline.hash??null,inline.successful??null,inline.memo_type??null,inline.memo??null]))check(r,'TRANSACTION_JOIN_CONFLICT','MISMATCH');
 check(r,'STELLAR_ASSET',native?r.assetIssuer===null?'MATCH':'MISMATCH':['credit_alphanum4','credit_alphanum12'].includes(r.assetType)&&nonempty(r.assetCode)&&nonempty(r.assetIssuer)?'MATCH':'UNKNOWN');
 check(r,'PAYMENT_ACCOUNTS',nonempty(r.from)&&nonempty(r.to)?'MATCH':'UNKNOWN');
 if(r.amount!==null)check(r,'STELLAR_PRECISION',parts(r.amount).scale<=7?'MATCH':'MISMATCH');
 if(tx?.memo_type===undefined)check(r,'TRANSACTION_MEMO','UNKNOWN');
 // Transaction/source completeness is part of the same proof, including joined rows.
 for(const x of [...txs,...networks]){const s=sources.find(s=>s.id===x.sourceId);check(r,'SUPPORTING_SOURCE',originalSourceOK(s,x)?'MATCH':'UNKNOWN',{versionId:x.id,sourceId:x.sourceId});}
 r.evidenceState=finalState(r.checks.filter(x=>x.code!=='PERIOD_MEMBERSHIP'));r.settled=r.evidenceState==='MATCH';r.remainingAmount=r.amount;
 return r;
}



function effectiveDecisions(decisions,book,finding){
 const cohort=decisions.filter(d=>d.bookId===book.id),effective=[];
 try{const tips=decisionTips(cohort),byId=new Map(cohort.map(x=>[x.id,x]));for(const tip of tips){let d=tip;while(d&&d.status!=='accepted')d=d.supersedesDecisionId?byId.get(d.supersedesDecisionId):null;if(d)effective.push(d);}return{cohort,tips,effective};}
 catch(e){finding('DECISION_HISTORY_INVALID',{reason:e.code??e.message});return{cohort,tips:[],effective:[]};}
}
function allocationChecks(d,subject,target,book,rows){
 const r={checks:[]};
 try{
  const u=normalizeUnit(d.unitBinding),a=positive(d.subjectAmount),b=positive(d.targetAmount);
  check(r,'SAME_UNIT_AMOUNT',cmp(a,b)===0?'MATCH':'MISMATCH');
  check(r,'SUBJECT_PAYMENT',subject.kind==='sdp-payment'?'MATCH':'MISMATCH');
  check(r,'SUBJECT_FINAL',subject.providerFinal?'MATCH':'UNKNOWN',{providerStatus:subject.providerStatus});
  check(r,'SUBJECT_PERIOD',subject.inPeriod===true?'MATCH':'UNKNOWN');
  check(r,'SUBJECT_CURRENT_SELECTION',!subject.selectionAmbiguous&&!subject.selectionConflict&&!subject.excluded&&subject.filterMatch?'MATCH':'UNKNOWN');
  check(r,'SUBJECT_SOURCE',finalState(subject.checks.filter(x=>['ORIGINAL_SOURCE','SELECTED_RESOURCE_IDENTITY','SOURCE_IDENTITY','NATIVE_RECORD_IDENTITY','EXACT_ASSET','STELLAR_AMOUNT_BOUND'].includes(x.code))));
  check(r,'SDP_ASSET',subject.asset&&canonicalJSON(subject.asset)===canonicalJSON({assetType:u.assetType,assetCode:u.assetCode,assetIssuer:u.assetIssuer})?'MATCH':'UNKNOWN');
  check(r,'HORIZON_CURRENT_SELECTION',!target.selectionAmbiguous&&!target.selectionConflict&&!target.excluded&&target.filterMatch?'MATCH':'UNKNOWN');
  check(r,'HORIZON_FINAL',target.settled?'MATCH':'UNKNOWN',{checks:target.checks});
  const walletRows=rows.filter(x=>subject.sourceAccountEvidence?.versionIds.some(id=>x.observedVersionIds.includes(id)));
  check(r,'SOURCE_ACCOUNT_EVIDENCE',subject.sourceAccountEvidence&&walletRows.length===1&&!walletRows[0].selectionAmbiguous&&!walletRows[0].selectionConflict&&!walletRows[0].excluded&&walletRows[0].filterMatch?finalState(subject.sourceAccountEvidence.checks):'UNKNOWN',{evidence:subject.sourceAccountEvidence??null});
  check(r,'HORIZON_PAYMENT_TYPE',target.operationType==='payment'?'MATCH':'UNKNOWN',{meaning:'Path-payment destination units cannot prove the SDP source spend.'});
  check(r,'NETWORK',subject.network===u.network&&target.network===u.network?'MATCH':'UNKNOWN',{sdp:subject.network,horizon:target.network,selected:u.network});
  check(r,'ASSET_MATCH',target.assetType===u.assetType&&target.assetCode===u.assetCode&&target.assetIssuer===u.assetIssuer?'MATCH':'MISMATCH');
  check(r,'SOURCE_ACCOUNT',subject.sourceAccount&&subject.sourceAccount===u.account&&[target.from,target.fromMuxed].includes(u.account)?'MATCH':'UNKNOWN',{sdp:subject.sourceAccount,selected:u.account,horizon:target.from});
  check(r,'RECIPIENT_ACCOUNT',subject.destinationAccount&&[target.to,target.toMuxed].includes(subject.destinationAccount)?'MATCH':'UNKNOWN',{sdp:subject.destinationAccount,horizon:target.to});
  check(r,'SDP_TRANSACTION',subject.transactionHash&&subject.transactionHash===target.transactionHash?'MATCH':'UNKNOWN',{sdp:subject.transactionHash,horizon:target.transactionHash});
  check(r,'SDP_OPERATION',subject.operationId&&subject.operationId===target.resourceId?'MATCH':'UNKNOWN',{sdp:subject.operationId,horizon:target.resourceId});
  check(r,'MEMO',target.memoType===u.memoType&&target.memo===u.memo?'MATCH':'MISMATCH',{type:target.memoType,memo:target.memo});
  if(subject.destinationMemo!==null)check(r,'RECIPIENT_MEMO',String(subject.destinationMemo)===u.memo&&(!subject.destinationMemoType||subject.destinationMemoType===u.memoType)?'MATCH':'MISMATCH');
  if(parts(a).scale>7||parts(b).scale>7)check(r,'ALLOCATION_PRECISION','MISMATCH');
 }catch(e){check(r,'INVALID_ALLOCATION','UNKNOWN',{reason:e.code??e.message});}
 return r.checks;
}
function applyDecisions(result,book,versions,sources,decisions){
 const rows=Object.entries(KIND_ARRAY).flatMap(([kind,array])=>result[array].filter(r=>r.kind===kind)),index=new Map(rows.flatMap(r=>r.observedVersionIds.map(id=>[id,r]))),
 finding=(code,detail)=>result.findings.push({code,state:'UNKNOWN',...clone(detail)}),history=effectiveDecisions(decisions,book,finding);
 result.decisions=history.cohort.map(clone);
 const validated=[];
 for(const d of history.effective){
  try{
   const ancestors=[];let p=d.supersedesDecisionId?history.cohort.find(x=>x.id===d.supersedesDecisionId):null;
   while(p){ancestors.push(p);p=p.supersedesDecisionId?history.cohort.find(x=>x.id===p.supersedesDecisionId):null;}
   const n=normalizeLinkDecision(d,{book,versions,sources,decisions:ancestors});validated.push({d,n});
  }catch(e){result.rejectedDecisions.push({decision:clone(d),code:e.code??e.message});}
 }
 const selection=new Map();
 for(const {d}of validated){const r=index.get(d.subjectVersionId);if(!r){result.rejectedDecisions.push({decision:clone(d),code:'SUBJECT_NOT_CURRENTLY_SELECTED'});continue;}
  if(['include','exclude'].includes(d.kind)){const set=selection.get(r.id)??new Set();set.add(d.kind);selection.set(r.id,set);}
 }
 for(const [id,set]of selection){const r=rows.find(r=>r.id===id);if(set.size>1){r.selectionConflict=true;check(r,'SELECTION_DECISION_CONFLICT','UNKNOWN');}else r.excluded=set.has('exclude');}
 const candidates=[];
 for(const {d}of validated){
  const a=index.get(d.subjectVersionId),b=d.targetVersionId?index.get(d.targetVersionId):null;if(!a||d.kind==='withdraw')continue;
  if(d.kind==='relate'){
   if(!b){result.rejectedDecisions.push({decision:clone(d),code:'RELATED_VERSION_NOT_CURRENTLY_SELECTED'});continue;}
   a.relatedVersionIds.push(...b.observedVersionIds);check(a,'OPERATOR_RELATION','MATCH',{decisionId:d.id,relation:d.relation,targetVersionId:b.versionId,meaning:'Recorded attributed association; original provider fields are unchanged.'});continue;
  }
  if(d.kind!=='allocate')continue;
  const item={id:d.id,decisionId:d.id,subjectVersionId:d.subjectVersionId,targetVersionId:d.targetVersionId,subjectAmount:d.subjectAmount,targetAmount:d.targetAmount,
   unitBinding:clone(d.unitBinding),status:'UNKNOWN',checks:[],applied:false};
  if(!b){check(item,'TARGET_NOT_SELECTED','UNKNOWN');result.allocations.push(item);continue;}
  item.checks=allocationChecks(d,a,b,book,rows);candidates.push({d,a,b,item});result.allocations.push(item);
 }
 // Capacity is evaluated for the entire accepted set, independent of iteration
 // order and repeated aliases for the same exact Stellar operation.
 const bySubject=new Map(),byEconomic=new Map();
 for(const c of candidates){if(finalState(c.item.checks)!=='MATCH')continue;
  const sk=c.a.id,ek=c.b.economicKey;bySubject.set(sk,add(bySubject.get(sk)??'0',c.d.subjectAmount));byEconomic.set(ek,add(byEconomic.get(ek)??'0',c.d.targetAmount));
 }
 for(const c of candidates){
  if(finalState(c.item.checks)==='MATCH'){
   check(c.item,'PAYMENT_CAPACITY',c.a.amount!==null&&cmp(bySubject.get(c.a.id),c.a.amount)<=0?'MATCH':'MISMATCH',{amount:c.a.amount,selected:bySubject.get(c.a.id)});
   const peers=result.settlements.filter(x=>x.economicKey===c.b.economicKey),amounts=new Set(peers.map(x=>x.amount));
   check(c.item,'OPERATION_CAPACITY',amounts.size===1&&c.b.amount!==null&&cmp(byEconomic.get(c.b.economicKey),c.b.amount)<=0?'MATCH':'MISMATCH',{amount:c.b.amount,selected:byEconomic.get(c.b.economicKey)});
  }
  c.item.status=finalState(c.item.checks);if(c.item.status!=='MATCH')continue;c.item.applied=true;
  c.a.allocatedAmount=add(c.a.allocatedAmount,c.d.subjectAmount);c.b.allocatedAmount=add(c.b.allocatedAmount,c.d.targetAmount);
 }
 for(const r of [...result.payments,...result.settlements])if(r.amount!==null&&r.amount!==undefined)r.remainingAmount=sub(r.amount,r.allocatedAmount);
}
function paymentTotals(result){
 const groups=new Map();
 for(const r of result.payments){
  if(r.excluded||r.filterMatch===false||r.inPeriod===false)continue;
  const unit=r.asset??{assetType:null,assetCode:null,assetIssuer:null};
  const evidence=finalState(r.checks.filter(x=>['ORIGINAL_SOURCE','SELECTED_RESOURCE_IDENTITY','SOURCE_IDENTITY','NATIVE_RECORD_IDENTITY','EXACT_ASSET','STELLAR_AMOUNT_BOUND'].includes(x.code)));
  const scopeAndAmount=r.amount!==null&&r.checks.filter(x=>['SOURCE_WALLET_SCOPE','BOOK_FILTER_SCOPE','AMOUNT_UNAVAILABLE','ORIGINAL_AMOUNT_INVALID','NEGATIVE_AMOUNT'].includes(x.code)).every(x=>x.state==='MATCH');
  const conclusive=r.inPeriod===true&&!r.selectionAmbiguous&&!r.selectionConflict&&evidence==='MATCH'&&scopeAndAmount;
  const bucket=!conclusive?'unresolved-evidence-or-period':r.providerFinal?'observed-success':'observed-nonfinal';
  const k=canonicalJSON([r.environment,r.sourceScope,unit,r.network,bucket]),g=groups.get(k)??{layer:'sdp-payment',bucket,environment:r.environment,sourceScope:r.sourceScope,network:r.network,asset:clone(unit),amount:'0',allocated:'0',remaining:'0',versionIds:[],unquantifiedVersionIds:[],amountBasis:'sum-of-known-selected-amounts',populationComplete:false};
  if(r.amount!==null){g.amount=add(g.amount,r.amount);g.allocated=add(g.allocated,r.allocatedAmount);g.remaining=add(g.remaining,r.remainingAmount??r.amount);}
  if(r.amount===null)g.unquantifiedVersionIds.push(...r.observedVersionIds);
  g.versionIds.push(...r.observedVersionIds);groups.set(k,g);
 }
 result.totals=[...groups.values()];
}
export function reconcilePayments({book,versions=[],history=[],sources=[],decisions=[],coverage={}}){
 book=normalizeBook(book);invariant(Array.isArray(versions)&&Array.isArray(history)&&Array.isArray(sources)&&Array.isArray(decisions),'COHORT_ARRAYS_REQUIRED');
 const result={schema:'amero.reconciliation.v1',book:clone(book),coverage:clone(coverage),...Object.fromEntries(RESULT_ARRAYS.map(k=>[k,[]])),
 semantics:{source:'Original selected response cells and exact number spellings remain intact.',period:'Half-open [start,end), using each original created/date field; unknown dates remain separate.',money:'SDP payment rows are the sole counted payout layer. Contributions, token balances, Escala observations, summary statistics and Horizon evidence remain separate.',population:'Totals describe selected original observations; terminal HTTP alone is not complete-population proof.',authorization:'An operator relationship, mock approval, oracle label or prepared CSV is not financial authorization.'}};
 const finding=(code,details)=>result.findings.push({code,state:'UNKNOWN',...clone(details)});
 const selected=select(versions,book,coverage,finding),rows=selected.entries.map(e=>common(e,book,sources));
 for(const entry of selected.entries){if(entry.version.kind==='horizon-operation'){const i=rows.findIndex(x=>x.versionId===entry.version.id);rows[i]=movement(entry,book,sources,[...versions,...history.filter(x=>!versions.some(v=>v.id===x.id))]);}else project(entry,book,sources,rows);}
 for(const r of rows)result[KIND_ARRAY[r.kind]].push(r);
 applyDecisions(result,book,[...versions,...history.filter(x=>!versions.some(v=>v.id===x.id))],sources,decisions);
 finalRows(rows);paymentTotals(result);
 for(const r of rows)for(const c of r.checks)if(c.state!=='MATCH')result.findings.push({versionId:r.versionId,resourceId:r.resourceId,...clone(c)});
 for(const r of result.payments)if(r.inPeriod!==false&&r.filterMatch&&!r.excluded)result.sourceGaps.push({code:'PAYMENT_POPULATION_NOT_PROVEN',sourceScope:r.sourceScope,versionId:r.versionId,meaning:'Complete selected observations are retained; this domain does not promote a paginated capture or stream to complete population without a source-specific query-chain proof.'});
 for(const c of coverage.selectionConflicts??[])result.sourceGaps.push({code:'SELECTION_CONFLICT',evidence:clone(c)});
 return result;
}


const PLAN_COLUMNS=Object.freeze(['phone','email','id','amount','verification','paymentID','walletAddress','walletAddressMemo']);
function utf8Bytes(s){return Buffer.byteLength(s,'utf8');}
function textField(v,maximum=16000){invariant(typeof v==='string'&&v.length<=maximum&&v.isWellFormed()&&!v.includes('\0'),'PLAN_TEXT_REQUIRED');return v;}
function machineCSV(rows){const cell=x=>'"'+String(x??'').replaceAll('"','""')+'"';return[PLAN_COLUMNS.map(cell).join(','),...rows.map(r=>PLAN_COLUMNS.map(k=>cell(r[k])).join(','))].join('\r\n')+'\r\n';}
function strkeyValid(s){
 if(typeof s!=='string'||!/^[GC][A-Z2-7]{55}$/.test(s))return false;
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567',raw=[];let acc=0,bits=0;
 for(const c of s){acc=acc*32+alphabet.indexOf(c);bits+=5;while(bits>=8){bits-=8;raw.push((acc>>>bits)&255);acc&=(1<<bits)-1;}}
 if(raw.length!==35||bits!==0||![6<<3,2<<3].includes(raw[0]))return false;
 let crc=0;for(const b of raw.slice(0,33)){crc^=b<<8;for(let j=0;j<8;j++)crc=((crc<<1)^((crc&0x8000)?0x1021:0))&65535;}
 return raw[33]===(crc&255)&&raw[34]===(crc>>8);
}
const goTrim=s=>s.replace(/^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+|[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+$/g,'');
function canonicalAmount(v){const s=goTrim(v);invariant(/^\d+(?:\.\d{1,7})?$/.test(s),'SDP_AMOUNT_DECIMAL_REQUIRED');const n=positive(s);invariant(cmp(n,'922337203685.4775807')<=0,'SDP_AMOUNT_INT64_BOUND');return n;}
export function normalizeDisbursementPlan(input,{book,versions=[],sources=[],decisions=[]}){
 book=normalizeBook(book);invariant(object(input),'PLAN_OBJECT_REQUIRED');
 const known=['name','milestoneVersionId','proposalVersionId','approvalVersionIds','evidenceVersionIds','treasuryVersionIds','distributionWalletVersionId','assetVersionId','recipientWalletVersionId','registrationContactType','verificationField','rows','note'];
 invariant(Object.keys(input).every(k=>known.includes(k)),'UNKNOWN_PLAN_FIELD');
 const definition={name:textField(input.name??'',500),milestoneVersionId:optional(input.milestoneVersionId),proposalVersionId:optional(input.proposalVersionId),
 approvalVersionIds:strings(input.approvalVersionIds),evidenceVersionIds:strings(input.evidenceVersionIds),treasuryVersionIds:strings(input.treasuryVersionIds),
 distributionWalletVersionId:optional(input.distributionWalletVersionId),assetVersionId:optional(input.assetVersionId),recipientWalletVersionId:optional(input.recipientWalletVersionId),
 registrationContactType:optional(input.registrationContactType),verificationField:optional(input.verificationField),rows:[],note:notes(input.note??'')};
 invariant(Array.isArray(input.rows)&&input.rows.length<=10000,'PLAN_ROWS_LIMIT');for(const row of input.rows){invariant(object(row)&&Object.keys(row).every(k=>PLAN_COLUMNS.includes(k)),'RECIPIENT_ROW_FIELDS_INVALID');definition.rows.push(Object.fromEntries(PLAN_COLUMNS.map(k=>[k,textField(row[k]??'',k==='verification'?16000:4096)])));}
 const findings=[],versionPins=[],pins=new Set(),fail=(code,detail={},blocking=true,state='UNKNOWN')=>findings.push({code,state,blocking,...clone(detail)});
 if(!definition.name.trim())fail('PLAN_NAME_REQUIRED');
 if(!definition.rows.length)fail('RECIPIENT_ROWS_REQUIRED');
 function selected(id,kinds,label,required=true){
  if(!id){if(required)fail('PLAN_SOURCE_REQUIRED',{field:label});return null;}
  const v=versions.find(x=>x.id===id);if(!v||!kinds.includes(v.kind)||!inScope(v,book)){fail('PLAN_SOURCE_OUTSIDE_BOOK',{field:label,versionId:id,expectedKinds:kinds});return null;}
  if(!pins.has(v.id)){pins.add(v.id);const source=sources.find(s=>s.id===v.sourceId);versionPins.push({versionId:v.id,kind:v.kind,resourceId:originalId(v),sourceId:v.sourceId,sourceScope:scope(v),environment:v.environment,connectionAlias:v.connectionAlias,
   valueSha256:hash({value:v.value,numberTokens:v.numberTokens??{},context:v.context??{}}),sourceBodySha256:source?.bodySha256??null,sourceRequestSha256:source?.requestSha256??null,originalVersion:clone(v),originalSource:source?clone(source):null});
   if(!originalSourceOK(source,v))fail('PLAN_ORIGINAL_SOURCE_UNRESOLVED',{field:label,versionId:v.id,sourceId:v.sourceId});}
  if(v.kind.startsWith('escala-')){if(book.tenantId&&v.context?.tenantId!==book.tenantId)fail('PLAN_TENANT_MISMATCH',{field:label,versionId:v.id});
   fail('PUBLISHED_MOCK_OBSERVATION',{versionId:v.id,apiMode:v.context?.apiMode??null,meaning:'Retained mock response cannot establish actual approval, oracle validity or transfer.'},false);}
  return v;
 }
 const milestone=selected(definition.milestoneVersionId,['escala-milestone'],'milestoneVersionId'),
 proposal=selected(definition.proposalVersionId,['escala-proposal'],'proposalVersionId',false),
 wallet=selected(definition.distributionWalletVersionId,['sdp-distribution-wallet'],'distributionWalletVersionId'),
 asset=selected(definition.assetVersionId,['sdp-asset'],'assetVersionId'),
 recipient=selected(definition.recipientWalletVersionId,['sdp-wallet'],'recipientWalletVersionId',false);
 const approvals=definition.approvalVersionIds.map(id=>selected(id,['escala-tally','escala-vote','escala-attestation'],'approvalVersionIds')).filter(Boolean),
 evidence=definition.evidenceVersionIds.map(id=>selected(id,['escala-evidence','escala-attestation'],'evidenceVersionIds')).filter(Boolean),
 treasury=definition.treasuryVersionIds.map(id=>selected(id,['escala-fund','escala-contribution','sdp-balance','sdp-capabilities'],'treasuryVersionIds')).filter(Boolean);
 if(!approvals.length)fail('APPROVAL_EVIDENCE_NOT_SELECTED',{},false);
 if(!evidence.length)fail('MILESTONE_EVIDENCE_NOT_SELECTED',{},false);
 if(!treasury.length)fail('TREASURY_EVIDENCE_NOT_SELECTED',{},false);
 if(milestone&&proposal){const id=parentId(milestone,'proposalId');if(id&&id!==originalId(proposal))fail('PLAN_PROPOSAL_MILESTONE_MISMATCH',{observed:id,selected:originalId(proposal)});if(!id)fail('PLAN_PROPOSAL_RELATION_UNRESOLVED',{},false);}
 for(const v of evidence){const id=parentId(v,'milestoneId');if(id&&milestone&&id!==originalId(milestone))fail('PLAN_EVIDENCE_MILESTONE_MISMATCH',{versionId:v.id});else if(!id)fail('PLAN_EVIDENCE_RELATION_UNRESOLVED',{versionId:v.id},false);}
 for(const v of approvals){const id=parentId(v,'proposalId');if(id&&proposal&&id!==originalId(proposal))fail('PLAN_APPROVAL_PROPOSAL_MISMATCH',{versionId:v.id});}
 const unit=asset?assetIdentity(asset.value):null;
 if(asset&&!unit)fail('PLAN_ASSET_IDENTITY_INVALID');
 if(asset?.value.deleted_at)fail('PLAN_ASSET_DELETED');
 if(asset?.value.enabled===false)fail('PLAN_ASSET_DISABLED');
 if(wallet){
  if(wallet.value.status!=='ACTIVE'||wallet.value.distribution_account_status!=='ACTIVE')fail('DISTRIBUTION_ACCOUNT_NOT_ACTIVE',{lifecycle:wallet.value.status??null,account:wallet.value.distribution_account_status??null});
  if(!strkeyValid(wallet.value.distribution_account_address??'')||!wallet.value.distribution_account_address.startsWith('G'))fail('DISTRIBUTION_ACCOUNT_ADDRESS_INVALID');
  if(book.distributionWalletIds.length&&!book.distributionWalletIds.includes(originalId(wallet)))fail('DISTRIBUTION_ACCOUNT_OUTSIDE_BOOK');
 }
 const sdp=[wallet,asset,recipient,...treasury.filter(v=>v.provider==='sdp')].filter(Boolean);
 if(sdp.length&&sdp.some(v=>v.connectionAlias!==sdp[0].connectionAlias||scope(v)!==scope(sdp[0])))fail('PLAN_SDP_CONNECTION_SCOPE_MISMATCH');
 if(asset&&wallet){const requested=asset.context?.requestInput?.headers?.['X-Wallet-Id']??asset.context?.params?.walletId??null;if(requested&&requested!==originalId(wallet))fail('ASSET_ACCOUNT_CONTEXT_MISMATCH',{observed:requested,selected:originalId(wallet)});}
 const contact=definition.registrationContactType,withAddress=contact?.endsWith('_AND_WALLET_ADDRESS')??false,byEmail=contact?.startsWith('EMAIL')??false;
 if(!['EMAIL','PHONE_NUMBER','EMAIL_AND_WALLET_ADDRESS','PHONE_NUMBER_AND_WALLET_ADDRESS'].includes(contact))fail('REGISTRATION_CONTACT_TYPE_REQUIRED');
 if(withAddress){if(recipient)fail('RECIPIENT_PROVIDER_FORBIDDEN_WITH_ADDRESS');if(definition.verificationField)fail('VERIFICATION_FORBIDDEN_WITH_ADDRESS');}
 else{
  if(!recipient)fail('RECIPIENT_PROVIDER_REQUIRED');
  if(recipient?.value.enabled===false)fail('RECIPIENT_PROVIDER_DISABLED');
  if((recipient?.value.embedded!==true||definition.verificationField)&&!['DATE_OF_BIRTH','YEAR_MONTH','PIN','NATIONAL_ID_NUMBER'].includes(definition.verificationField))fail('VERIFICATION_FIELD_REQUIRED');
 }
 const sanitized=[],seenContacts=new Set(),seenWallets=new Set(),seenPayments=new Set(),invalidAmountRows=[];let total='0';
 const emailRx=/^[a-zA-Z0-9.!#$%&'*+\/=?^_\x60{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
 for(let index=0;index<definition.rows.length;index++){
  const original=definition.rows[index],r=Object.fromEntries(PLAN_COLUMNS.map(k=>[k,goTrim(original[k])])),row=index+2;
  r.email=r.email.toLowerCase();r.phone=r.phone.toLowerCase();r.walletAddress=r.walletAddress.toUpperCase();
  if(!r.id||Array.from(r.id).length>64)fail('RECIPIENT_ID_INVALID',{row});
  if(Array.from(r.paymentID).length>64)fail('PAYMENT_ID_TOO_LONG',{row});
  if(r.paymentID){if(seenPayments.has(r.paymentID))fail('PAYMENT_ID_REUSED',{row,paymentID:r.paymentID},false);seenPayments.add(r.paymentID);}
  try{total=add(total,canonicalAmount(r.amount));}catch(e){invalidAmountRows.push(row);fail('RECIPIENT_AMOUNT_INVALID',{row,reason:e.code??e.message});}
  if(!!r.email===!!r.phone)fail('EXACTLY_ONE_CONTACT_REQUIRED',{row});
  if(byEmail?!r.email||!emailRx.test(r.email):!r.phone||!/^\+[1-9][0-9]{9,14}$/.test(r.phone))fail('RECIPIENT_CONTACT_INVALID',{row});
  const c=r.email||r.phone;if(c){if(seenContacts.has(c))fail('DUPLICATE_RECIPIENT_CONTACT',{row});seenContacts.add(c);}
  if(withAddress){
   if(!strkeyValid(r.walletAddress))fail('RECIPIENT_STELLAR_ADDRESS_INVALID',{row});
   if(r.walletAddress.startsWith('C')&&r.walletAddressMemo)fail('CONTRACT_ADDRESS_MEMO_FORBIDDEN',{row});
   const wk=canonicalJSON([r.walletAddress,r.walletAddressMemo]);if(seenWallets.has(wk))fail('DUPLICATE_RECIPIENT_WALLET',{row});seenWallets.add(wk);
   if(r.walletAddressMemo)fail('PROVIDER_MEMO_VALIDATION_REQUIRED',{row,meaning:'The exact original memo is retained for the selected SDK validator.'},false);
   if(r.verification)fail('UNUSED_VERIFICATION_VALUE',{row},false);
  }else{
   if(r.walletAddress||r.walletAddressMemo)fail('UNUSED_RECIPIENT_ADDRESS',{row});
   const v=r.verification;
   if(definition.verificationField==='PIN'&&(utf8Bytes(v)<4||utf8Bytes(v)>8))fail('VERIFICATION_PIN_LENGTH',{row});
   if(definition.verificationField==='NATIONAL_ID_NUMBER'&&(!v||utf8Bytes(v)>50))fail('VERIFICATION_ID_LENGTH',{row});
   if(definition.verificationField==='DATE_OF_BIRTH'&&(!/^\d{4}-\d\d-\d\d$/.test(v)||instant(v+'T00:00:00Z')===null))fail('VERIFICATION_DATE_INVALID',{row});
   if(definition.verificationField==='YEAR_MONTH'&&(!/^\d{4}-\d\d$/.test(v)||instant(v+'-01T00:00:00Z')===null))fail('VERIFICATION_YEAR_MONTH_INVALID',{row});
  }
  sanitized.push(r);
 }
 if(!byEmail)fail('PROVIDER_PHONE_VALIDATION_REQUIRED',{meaning:'SDP also validates E.164 numbers with its original libphonenumber metadata.'},false);
 if(['DATE_OF_BIRTH','YEAR_MONTH'].includes(definition.verificationField))fail('PROVIDER_CURRENT_DATE_VALIDATION_REQUIRED',{meaning:'The server checks that verification dates are not in its current future.'},false);
 const csv=machineCSV(sanitized);let boundaryLength=54;
 // The native boundary is amero- plus 48 hex digits, extended with x while
 // present in this CSV. Reserve the largest possible exact framing for any
 // later selected disbursement ID without changing one recipient byte.
 for(const match of csv.matchAll(/amero-[a-f0-9]{48}(x*)/g))boundaryLength=Math.max(boundaryLength,54+match[1].length+1);
 const boundary='b'.repeat(boundaryLength),multipartBoundBytes=utf8Bytes('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="disbursement-instructions.csv"\r\nContent-Type: text/csv\r\n\r\n')+utf8Bytes(csv)+utf8Bytes('\r\n--'+boundary+'--\r\n');
 if(multipartBoundBytes>5000000)fail('SDP_MULTIPART_UPLOAD_BOUND',{csvBytes:utf8Bytes(csv),multipartBoundBytes,limit:5000000});
 const createInput={params:{},query:{},headers:wallet?{'X-Wallet-Id':originalId(wallet)}:{},body:{name:definition.name,asset_id:asset?originalId(asset):null,registration_contact_type:contact}};
 if(!withAddress){createInput.body.wallet_id=recipient?originalId(recipient):null;if(definition.verificationField)createInput.body.verification_field=definition.verificationField;}
 fail('INSTRUCTION_REPLACEMENT',{meaning:'The original instructions upload deletes existing DRAFT payments for this disbursement, creates this complete row set and moves the original disbursement to READY.'},false,'MATCH');
 fail('FINANCIAL_AUTHORIZATION_REQUIRED',{meaning:'Preparation retains selected evidence and original mock observations. Native role/account authorization, applicable governance policy, current balances and explicit dispatch remain separate.'},false);
 return{definition,versionPins,csv,multipartBoundBytes,createInput,findings,totals:[{layer:'prepared-instructions',asset:unit,amount:total,amountBasis:'sum-of-valid-instruction-amounts',invalidAmountRows,rows:definition.rows.length,distributionWalletId:wallet?originalId(wallet):null,connectionAlias:wallet?.connectionAlias??null,environment:book.environment}],status:findings.some(f=>f.blocking)?'NEEDS_REVIEW':'PREPARED'};
}
