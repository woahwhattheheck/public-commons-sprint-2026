// MIT. Pure reconciliation of retained Paycashless records and explicitly selected Stellar evidence.
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
const inScope=(v,b)=>v&&v.environment===b.environment&&(b.connectionAliases[nativeProvider(v)]??[]).includes(v.connectionAlias);
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
export function normalizeBook(input){
 invariant(object(input),'BOOK_OBJECT_REQUIRED');invariant(['sandbox','production'].includes(input.environment),'BOOK_ENVIRONMENT_REQUIRED');
 invariant(object(input.connectionAliases),'BOOK_CONNECTIONS_REQUIRED');
 const connectionAliases={paycashless:strings(input.connectionAliases.paycashless),horizon:strings(input.connectionAliases.horizon)};
 invariant(connectionAliases.paycashless.length,'PAYCASHLESS_CONNECTION_REQUIRED');
 invariant(['createdAt','updatedAt'].includes(input.collectionBasis),'COLLECTION_BASIS_REQUIRED');
 invariant(['provider','stellar'].includes(input.settlementBasis),'SETTLEMENT_BASIS_REQUIRED');
 if(input.settlementBasis==='stellar')invariant(connectionAliases.horizon.length,'HORIZON_CONNECTION_REQUIRED');
 invariant(object(input.period),'BOOK_PERIOD_REQUIRED');const start=required(input.period.start,'PERIOD_START_REQUIRED',200),end=required(input.period.end,'PERIOD_END_REQUIRED',200);
 invariant(instant(start)!==null&&instant(end)!==null&&cmp(instant(start),instant(end))<0,'BOOK_PERIOD_INVALID');
 const timeZone=required(input.period.timeZone,'TIMEZONE_REQUIRED',128);try{new Intl.DateTimeFormat('en',{timeZone}).format(new Date(0));}catch{invariant(false,'TIMEZONE_INVALID');}
 const filters={};for(const k of ['invoiceIds','paymentIds','payoutIds','customerIds'])filters[k]=strings(input.filters?.[k]);
 return{id:required(input.id,'BOOK_ID_REQUIRED',200),name:required(input.name,'BOOK_NAME_REQUIRED',500),environment:input.environment,connectionAliases,
  period:{start,end,timeZone},filters,collectionBasis:input.collectionBasis,settlementBasis:input.settlementBasis,notes:notes(input.notes??'')};
}
function refs(v,rows,code){const out=strings(v);const set=new Set(rows.map(x=>x.id));for(const id of out)invariant(set.has(id),code,{id});return out;}
function decisionTips(decisions){
 const index=new Map(),children=new Map();
 for(const d of decisions){invariant(nonempty(d.id)&&!index.has(d.id),'DECISION_ID_DUPLICATE');index.set(d.id,d);}
 for(const d of decisions){
  if(d.supersedesId){const p=index.get(d.supersedesId);invariant(p&&p.bookId===d.bookId&&p.subjectVersionId===d.subjectVersionId,'DECISION_PARENT_INVALID');
   invariant(!children.has(p.id),'DECISION_FORK',{id:p.id});children.set(p.id,d.id);}
  const seen=new Set();let at=d;while(at?.supersedesId){invariant(!seen.has(at.id),'DECISION_CYCLE');seen.add(at.id);at=index.get(at.supersedesId);}
 }
 return decisions.filter(x=>!children.has(x.id));
}
function unit(input){
 invariant(object(input),'UNIT_BINDING_REQUIRED');invariant(input.providerUnit==='minor','PROVIDER_MINOR_UNIT_REQUIRED');
 invariant(['native','credit_alphanum4','credit_alphanum12'].includes(input.assetType),'STELLAR_ASSET_TYPE_REQUIRED');
 invariant(['incoming','outgoing'].includes(input.direction),'ALLOCATION_DIRECTION_REQUIRED');
 const out={currency:required(input.currency,'CURRENCY_REQUIRED',32),providerUnit:'minor',assetType:input.assetType,
  assetCode:required(input.assetCode,'ASSET_CODE_REQUIRED',12),assetIssuer:optional(input.assetIssuer),
  network:required(input.network,'NETWORK_REQUIRED',500),account:required(input.account,'ACCOUNT_REQUIRED',200),direction:input.direction,
  memo:input.memo===undefined||input.memo===null?null:notes(input.memo),memoType:optional(input.memoType)};
 if(out.assetType==='native')invariant(out.assetCode==='XLM'&&!out.assetIssuer,'NATIVE_UNIT_INVALID');
 else invariant(nonempty(out.assetIssuer)&&out.assetCode.length<=(out.assetType==='credit_alphanum4'?4:12),'CREDIT_UNIT_INVALID');
 invariant(['none','text','id','hash','return',null].includes(out.memoType),'MEMO_TYPE_INVALID');
 invariant(out.memoType===null||out.memoType==='none'?out.memo===null:out.memo!==null,'MEMO_BINDING_INCOMPLETE');
 return out;
}
export function normalizeLinkDecision(input,{book,versions=[],sources=[],decisions=[]}){
 book=normalizeBook(book);invariant(object(input),'DECISION_OBJECT_REQUIRED');
 invariant(['allocate','note','exclude','include','withdraw'].includes(input.action),'DECISION_ACTION_REQUIRED');
 invariant(['proposed','accepted','rejected'].includes(input.status),'DECISION_STATUS_REQUIRED');
 const subject=versions.find(x=>x.id===input.subjectVersionId);
 invariant(subject&&['paycashless-payment','paycashless-payout','paycashless-invoice','paycashless-invoice-payment'].includes(subject.kind)&&inScope(subject,book),'SUBJECT_OUTSIDE_BOOK');
 const active=decisionTips(decisions),parent=input.supersedesId?decisions.find(x=>x.id===input.supersedesId):null;
 if(input.supersedesId)invariant(parent&&parent.bookId===book.id&&parent.subjectVersionId===subject.id&&active.some(x=>x.id===parent.id),'CURRENT_DECISION_TIP_REQUIRED');
 if(input.action==='withdraw')invariant(parent,'WITHDRAWAL_PARENT_REQUIRED');
 const out={action:input.action,status:input.status,supersedesId:parent?.id??null,actor:required(input.actor,'ACTOR_REQUIRED',500),reason:required(input.reason,'REASON_REQUIRED'),
  subjectVersionId:subject.id,settlementVersionId:null,allocationAmount:null,settlementAmount:null,unitBinding:null,conversion:null,
  sourceIds:refs(input.sourceIds??[],sources,'SUPPORTING_SOURCE_MISSING'),corroborationVersionIds:refs(input.corroborationVersionIds??[],versions,'CORROBORATION_MISSING'),notes:notes(input.notes??'')};
 for(const id of out.corroborationVersionIds)invariant(inScope(versions.find(x=>x.id===id),book),'CORROBORATION_OUTSIDE_BOOK');
 if(input.action==='allocate'){
  invariant(['paycashless-payment','paycashless-payout'].includes(subject.kind),'CASH_SUBJECT_REQUIRED');
  invariant(book.settlementBasis==='stellar','STELLAR_BOOK_REQUIRED');
  const settlement=versions.find(x=>x.id===input.settlementVersionId);invariant(settlement?.kind==='horizon-operation'&&inScope(settlement,book),'SETTLEMENT_OUTSIDE_BOOK');
  out.settlementVersionId=settlement.id;out.allocationAmount=positive(input.allocationAmount);out.settlementAmount=positive(input.settlementAmount);
  invariant(parts(out.allocationAmount).scale===0,'ALLOCATION_MINOR_INTEGER_REQUIRED');
  invariant(parts(out.settlementAmount).scale<=7,'STELLAR_PRECISION_EXCEEDED');
  out.unitBinding=unit(input.unitBinding);
  invariant(subject.value?.currency===out.unitBinding.currency,'SUBJECT_CURRENCY_CHANGED');
  invariant(out.unitBinding.direction===(subject.kind==='paycashless-payment'?'incoming':'outgoing'),'SUBJECT_DIRECTION_CHANGED');
  invariant(object(input.conversion),'EXPLICIT_CONVERSION_REQUIRED');
  out.conversion={rate:positive(input.conversion.rate),sourceIds:refs(input.conversion.sourceIds,sources,'CONVERSION_SOURCE_MISSING'),reason:required(input.conversion.reason,'CONVERSION_REASON_REQUIRED')};
  invariant(out.conversion.sourceIds.length,'CONVERSION_SOURCE_REQUIRED');
  invariant(cmp(mul(out.settlementAmount,out.conversion.rate),out.allocationAmount)===0,'CONVERSION_AMOUNT_MISMATCH');
 }
 return out;
}
function select(versions,book,coverage,exception){
 const byId=new Map(),groups=new Map(),conflicts=new Set((coverage.selectionConflicts??[]).flatMap(x=>x.versionIds??[])),blocked=new Set((coverage.selectionConflicts??[]).map(x=>x.resourceId));
 for(const v of versions){
  invariant(object(v)&&nonempty(v.id)&&object(v.value),'ORIGINAL_VERSION_REQUIRED');
  if(!inScope(v,book)){exception('VERSION_OUTSIDE_BOOK',{versionId:v.id});continue;}
  if(byId.has(v.id)){invariant(canonicalJSON(byId.get(v.id))===canonicalJSON(v),'VERSION_ID_BODY_CONFLICT');continue;}byId.set(v.id,v);
  const k=key(v),g=groups.get(k)??[];g.push(v);groups.set(k,g);
 }
 const entries=[];
 for(const [k,g]of groups){
  const signatures=new Set(g.map(v=>canonicalJSON([v.value,v.numberTokens??{}]))),bad=!scope(g[0])||!originalId(g[0])||signatures.size>1||g.some(v=>conflicts.has(v.id)||blocked.has(v.localResourceId));
  if(bad)exception('ORIGINAL_RESOURCE_SELECTION_UNRESOLVED',{resourceKey:k,versionIds:g.map(v=>v.id)});
  // Conflicting observations remain complete report rows. Identical observations
  // share one economic row and keep every exact selected version ID.
  const partition=new Map();for(const v of g){const s=canonicalJSON([v.value,v.numberTokens??{}]);const a=partition.get(s)??[];a.push(v);partition.set(s,a);}
  for(const a of partition.values())entries.push({version:a[0],versions:a,ambiguous:bad});
 }
 for(const c of coverage.selectionConflicts??[])exception('ORIGINAL_SELECTION_CONFLICT',{evidence:c});
 return{entries,byId};
}
function common(entry,book,sources){
 const v=entry.version,value=v.value,sourceIds=entry.versions.map(x=>x.sourceId),row={id:hash([v.kind,v.id]),versionId:v.id,observedVersionIds:entry.versions.map(x=>x.id),
  resourceId:originalId(v),sourceId:v.sourceId,sourceIds:[...new Set(sourceIds)],sourceScope:scope(v),environment:v.environment,connectionAlias:v.connectionAlias,kind:v.kind,
  status:value.status??null,currency:value.currency??null,inPeriod:periodMembership(value[book.collectionBasis],book),filterMatch:true,amounts:{},checks:[],
  original:clone(value),numberTokens:clone(v.numberTokens??{}),relatedVersionIds:[],excluded:false,selectionAmbiguous:entry.ambiguous,
  allocationIds:[],allocatedAmount:'0',remainingAmount:null,evidenceState:'UNKNOWN'};
 if(entry.ambiguous)check(row,'SELECTED_RESOURCE_IDENTITY','UNKNOWN',{observedVersionIds:row.observedVersionIds});
 if(!row.resourceId||!row.sourceScope)check(row,'SOURCE_IDENTITY','UNKNOWN');
 if(nonempty(value.id)&&value.id!==row.resourceId)check(row,'NATIVE_IDENTITY','MISMATCH',{resourceId:row.resourceId,originalId:value.id});
 for(const sourceId of row.sourceIds){const s=sources.find(x=>x.id===sourceId);check(row,'ORIGINAL_SOURCE',s&&s.bodyComplete===true?'MATCH':'UNKNOWN',{sourceId,bodyComplete:s?.bodyComplete??null});}
 if(v.kind.startsWith('paycashless-')&&!['paycashless-event','paycashless-operation-result','paycashless-bank','paycashless-bank-account'].includes(v.kind)){
  check(row,'LIVE_MODE',typeof value.liveMode==='boolean'?(value.liveMode===(book.environment==='production')?'MATCH':'MISMATCH'):'UNKNOWN',{observed:value.liveMode??null,environment:book.environment});
 }
 if(row.inPeriod===null)check(row,'PERIOD_MEMBERSHIP','UNKNOWN',{basis:book.collectionBasis,observed:value[book.collectionBasis]??null});
 return row;
}
function sameScope(a,b){return a.sourceScope===b.sourceScope&&a.environment===b.environment;}
function relate(row,rows,kind,id){
 if(!nonempty(id)){check(row,'RELATED_ID_MISSING','UNKNOWN',{kind,id:id??null});return null;}
 const matches=rows.filter(x=>x.kind===kind&&sameScope(row,x)&&x.resourceId===id);
 row.relatedVersionIds.push(...matches.flatMap(x=>x.observedVersionIds));
 if(matches.length!==1||matches[0].selectionAmbiguous){check(row,'RELATED_RECORD_UNRESOLVED','UNKNOWN',{kind,id,versionIds:matches.flatMap(x=>x.observedVersionIds)});return null;}
 return matches[0];
}
function filterRows(rows,book){
 const has=(ids,id)=>!ids.length?true:!nonempty(id)?null:ids.includes(id);
 const and=(a,b)=>a===false||b===false?false:a===null||b===null?null:true;
 for(const r of rows){
  const v=r.original;
  if(r.kind==='paycashless-invoice'){
   r.filterMatch=and(has(book.filters.invoiceIds,r.resourceId),has(book.filters.customerIds,v.customerId));
   if(book.filters.paymentIds.length)r.filterMatch=and(r.filterMatch,rows.some(p=>p.kind==='paycashless-invoice-payment'&&sameScope(r,p)&&p.original.invoiceId===r.resourceId&&book.filters.paymentIds.includes(p.original.intentId))?true:null);
  }else if(r.kind==='paycashless-invoice-payment'){
   r.filterMatch=and(has(book.filters.invoiceIds,v.invoiceId),has(book.filters.paymentIds,v.intentId));
   if(book.filters.customerIds.length){const i=rows.filter(x=>x.kind==='paycashless-invoice'&&x.resourceId===v.invoiceId&&sameScope(r,x));r.filterMatch=and(r.filterMatch,i.length===1?has(book.filters.customerIds,i[0].original.customerId):null);}
  }else if(r.kind==='paycashless-payment'){
   r.filterMatch=and(has(book.filters.paymentIds,r.resourceId),has(book.filters.customerIds,v.customerId));
   if(book.filters.invoiceIds.length)r.filterMatch=and(r.filterMatch,rows.some(i=>i.kind==='paycashless-invoice-payment'&&sameScope(r,i)&&i.original.intentId===r.resourceId&&book.filters.invoiceIds.includes(i.original.invoiceId))?true:null);
  }else if(r.kind==='paycashless-payout')r.filterMatch=has(book.filters.payoutIds,r.resourceId);
  if(r.filterMatch===null)check(r,'BOOK_FILTER_MEMBERSHIP','UNKNOWN',{filters:book.filters});
 }
}
function projectCash(entry,book,sources){
 const r=common(entry,book,sources),v=entry.version,o=v.value;
 const fields=r.kind==='paycashless-payment'?['expectedAmount','chargedAmount','fee','vat','emtl']:
  r.kind==='paycashless-payout'?['amount','stampDuty','fee','vat']:
  r.kind==='paycashless-invoice'?['amountDue','amountPaid','amountOverpaid','amountRemaining','subTotal','totalInclusiveTaxAmount','totalExclusiveTaxAmount']:
  ['amountPaid','amountRequested'];
 for(const f of fields)r.amounts[f]=readAmount(r,v,f,'',{integer:!(r.kind==='paycashless-payment'&&['fee','vat','emtl'].includes(f))});
 check(r,'CURRENCY',nonempty(r.currency)?'MATCH':'UNKNOWN',{observed:r.currency});
 const states={'paycashless-payment':['initiated','awaiting_charge','charged','failed','expired','reversed','succeeded'],
  'paycashless-payout':['pending','succeeded','failed','reversed','sent','cancelled'],
  'paycashless-invoice':['draft','open','paid','partially_paid','cancelled']};
 if(states[r.kind])check(r,'PROVIDER_STATUS',states[r.kind].includes(r.status)?'MATCH':'UNKNOWN',{observed:r.status});
 if(r.kind==='paycashless-payment'){
  r.expectedSettlementAmount=r.amounts.chargedAmount;r.providerFinal=r.status==='succeeded';
  const a=r.amounts.expectedAmount,b=r.amounts.chargedAmount,p=o.acceptedAmountPolicy;
  if(a!==null&&b!==null&&r.providerFinal){
   const relation=cmp(b,a),rules={ACCEPTED_AMOUNT_POLICY_FIXED:relation===0,ACCEPTED_AMOUNT_POLICY_ALLOW_PARTIAL:relation<=0,ACCEPTED_AMOUNT_POLICY_ALLOW_EXCESS:relation>=0,ACCEPTED_AMOUNT_POLICY_ALLOW_ANY:true};
   check(r,'ACCEPTED_AMOUNT_POLICY',own(rules,p)?rules[p]?'MATCH':'MISMATCH':'UNKNOWN',{policy:p??null,expectedAmount:a,chargedAmount:b});
  }
 }else if(r.kind==='paycashless-payout'){
  r.expectedSettlementAmount=r.amounts.amount;r.providerFinal=r.status==='succeeded';
  check(r,'CONFIRMATION_FIELDS',typeof o.requiresConfirmation==='boolean'&&['pending','confirmed','rejected'].includes(o.confirmationState)?'MATCH':'UNKNOWN');
  if(r.providerFinal&&o.requiresConfirmation===true)check(r,'CONFIRMED_PAYOUT',o.confirmationState==='confirmed'?'MATCH':'MISMATCH',{observed:o.confirmationState});
 }else if(r.kind==='paycashless-invoice-payment'){
  r.status=o.paid===true?'paid':o.paid===false?'unpaid':null;r.providerFinal=o.paid===true;
  check(r,'INSTALMENT_PAID_STATE',typeof o.paid==='boolean'?'MATCH':'UNKNOWN');
 }else{
  const {amountDue:due,amountPaid:paid,amountRemaining:remaining,amountOverpaid:overpaid}=r.amounts;
  if(due!==null&&paid!==null){
   if(remaining!==null)check(r,'INVOICE_REMAINING',cmp(remaining,zeroFloor(sub(due,paid)))===0?'MATCH':'MISMATCH',{due,paid,remaining});
   if(overpaid!==null)check(r,'INVOICE_OVERPAYMENT',cmp(overpaid,zeroFloor(sub(paid,due)))===0?'MATCH':'MISMATCH',{due,paid,overpaid});
   if(r.status==='paid')check(r,'PAID_INVOICE_AMOUNT',cmp(paid,due)>=0?'MATCH':'MISMATCH',{due,paid});
   if(r.status==='partially_paid')check(r,'PARTIAL_INVOICE_AMOUNT',cmp(paid,'0')>0&&cmp(paid,due)<0?'MATCH':'MISMATCH',{due,paid});
  }
  r.lineItems=[];
  if(Array.isArray(o.items)){
   let complete=true,total='0';
   o.items.forEach((item,i)=>{const price=readAmount(r,v,'price','/items/'+i,{integer:true}),quantity=readAmount(r,v,'quantity','/items/'+i),amount=price!==null&&quantity!==null?mul(price,quantity):null;
    r.lineItems.push({ordinal:i,original:clone(item),price,quantity,amount});if(amount===null)complete=false;else total=add(total,amount);});
   r.computedLineSubtotal=complete?total:null;
   if(complete&&r.amounts.subTotal!==null)check(r,'INVOICE_LINE_SUBTOTAL',cmp(total,r.amounts.subTotal)===0?'MATCH':'MISMATCH',{observed:total,reported:r.amounts.subTotal});
  }else check(r,'INVOICE_ITEMS_UNAVAILABLE','UNKNOWN');
  // The response does not specify each tax's inclusion mode/rounding contract.
  // Retain complete tax fields; do not infer a per-line tax allocation.
  r.taxRates=clone(o.taxRates??null);
 }
 r.remainingAmount=r.expectedSettlementAmount??null;
 return r;
}
function movement(entry,book,sources,cohort){
 const r=common(entry,book,sources),v=entry.version,o=v.value,network=v.context?.networkPassphrase??null,txHash=o.transaction_hash??null;
 const txs=cohort.filter(x=>x.kind==='horizon-transaction'&&scope(x)===scope(v)&&x.environment===v.environment&&originalId(x)===txHash);
 const inline=object(o.transaction)?o.transaction:null,tx=txs.length===1?txs[0].value:txs.length===0?inline:null;
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
 check(r,'TRANSACTION_IDENTITY',nonempty(txHash)&&tx&&tx.hash===txHash&&txs.length<=1?'MATCH':'UNKNOWN',{operationHash:txHash,observed:tx?.hash??null,versionIds:r.transactionVersionIds});
 if(inline&&inline.hash!==txHash)check(r,'INLINE_TRANSACTION_IDENTITY','MISMATCH',{expected:txHash,observed:inline.hash??null});
 check(r,'TRANSACTION_SUCCESS',o.transaction_successful===true&&tx?.successful===true?'MATCH':o.transaction_successful===false||tx?.successful===false?'MISMATCH':'UNKNOWN');
 if(tx&&inline&&txs.length&&canonicalJSON([tx.hash??null,tx.successful??null,tx.memo_type??null,tx.memo??null])!==canonicalJSON([inline.hash??null,inline.successful??null,inline.memo_type??null,inline.memo??null]))check(r,'TRANSACTION_JOIN_CONFLICT','MISMATCH');
 check(r,'STELLAR_ASSET',native?r.assetIssuer===null?'MATCH':'MISMATCH':['credit_alphanum4','credit_alphanum12'].includes(r.assetType)&&nonempty(r.assetCode)&&nonempty(r.assetIssuer)?'MATCH':'UNKNOWN');
 check(r,'PAYMENT_ACCOUNTS',nonempty(r.from)&&nonempty(r.to)?'MATCH':'UNKNOWN');
 if(r.amount!==null)check(r,'STELLAR_PRECISION',parts(r.amount).scale<=7?'MATCH':'MISMATCH');
 if(tx?.memo_type===undefined)check(r,'TRANSACTION_MEMO','UNKNOWN');
 // Transaction/source completeness is part of the same proof, including joined rows.
 for(const x of [...txs,...networks]){const s=sources.find(s=>s.id===x.sourceId);check(r,'SUPPORTING_SOURCE',s?.bodyComplete===true?'MATCH':'UNKNOWN',{versionId:x.id,sourceId:x.sourceId});}
 r.evidenceState=finalState(r.checks.filter(x=>x.code!=='PERIOD_MEMBERSHIP'));r.settled=r.evidenceState==='MATCH';r.remainingAmount=r.amount;
 return r;
}

function fullPopulation({action,invoiceId=null,sourceScope,environment,coverage,sources,selectedIds}){
 const evidence=[];let complete=false;
 const equal=(a,b)=>{try{return canonicalJSON(a)===canonicalJSON(b);}catch{return false;}};
 const digest=v=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
 for(const c of coverage.captures??[]){
  if(c.action!==action||c.connection?.sourceScope!==sourceScope||c.connection?.environment!==environment)continue;
  const input=c.input??{},q=input.query??{},params=input.params??{},why=[];
  if(invoiceId!==null&&params.id!==invoiceId)continue;
  if(c.status!=='COMPLETE'||c.next!==null)why.push('CAPTURE_NOT_TERMINAL');
  if(Object.entries(q).some(([k,v])=>k!=='limit'&&v!==undefined&&v!==null&&v!==''))why.push('FILTERED_OR_RESUMED_POPULATION');
  if((c.rejectedSourceIds??[]).length)why.push('REJECTED_SOURCE_PAGES');
  const ids=Array.isArray(c.sourceIds)?c.sourceIds:[];
  if(!ids.length)why.push('NO_ORIGINAL_PAGES');
  if(new Set(ids).size!==ids.length)why.push('DUPLICATE_SOURCE_PAGES');
  if(!Number.isSafeInteger(c.pages)||c.pages!==ids.length)why.push('PAGE_COUNT_MISMATCH');
  const pages=Array.isArray(c.pageReceipts)?c.pageReceipts:[];
  if(pages.length!==ids.length||pages.some((p,i)=>!p||p.index!==i||p.sourceId!==ids[i]))why.push('PAGE_RECEIPTS_UNBOUND');
  for(let i=0;i<ids.length;i++){
   const id=ids[i],s=sources.find(x=>x.id===id),p=pages[i];
   if(!s||s.bodyComplete!==true||(s.action??s.kind)!==action||s.sourceScope!==sourceScope||s.environment!==environment)why.push('PAGE_SOURCE_UNBOUND');
   if(!s||s.classification?.outcome!=='accepted'||s.projectionError!=null||s.error!=null||!Array.isArray(s.versionIds))why.push('PAGE_PROJECTION_UNAVAILABLE');
   for(const versionId of s?.versionIds??[])if(!selectedIds.has(versionId))why.push('ORIGINAL_PAGE_VERSION_NOT_SELECTED');
   if(invoiceId!==null&&s?.requestInput?.params?.id!==invoiceId)why.push('PAGE_INVOICE_UNBOUND');
   if(!p||!s||!digest(p.bodySha256)||p.bodySha256!==s.bodySha256||!digest(p.requestSha256)||p.requestSha256!==s.requestSha256)why.push('PAGE_BYTES_UNBOUND');
   if(!p||!equal(p.requestInput,s?.requestInput))why.push('PAGE_REQUEST_UNBOUND');
   if(i===0){if(!p||!equal(p.requestInput,input))why.push('FIRST_PAGE_REQUEST_UNBOUND');}
   else{const previous=pages[i-1];if(!previous?.next||previous.next.action!==action||!equal(previous.next.input,p?.requestInput))why.push('PAGE_CONTINUATION_UNBOUND');}
   if(i===ids.length-1&&p?.next!==null)why.push('LAST_PAGE_NOT_TERMINAL');
  }
  evidence.push({captureId:c.id,sourceIds:[...ids],complete:why.length===0,reasons:[...new Set(why)],input:clone(input)});
  if(!why.length)complete=true;
 }
 return{complete,evidence,scope:'Whole native collection from its original first cursor, without date or other membership filters; every accepted projected page is bound to its exact request/body receipt and cursor continuation, and every original page version remains selected.'};
}
function reconcileInvoices(invoices,instalments,payments,book,coverage,sources,selectedIds){
 const related=[...invoices,...instalments,...payments];
 for(const p of instalments){
  const i=relate(p,related,'paycashless-invoice',p.original.invoiceId),intent=relate(p,related,'paycashless-payment',p.original.intentId);
  p.invoiceVersionIds=i?.observedVersionIds??[];p.intentVersionIds=intent?.observedVersionIds??[];
  if(i)check(p,'INVOICE_CURRENCY',p.currency===i.currency?'MATCH':'MISMATCH',{invoiceVersionId:i.versionId,expected:i.currency,observed:p.currency});
  if(intent){
   check(p,'INTENT_CURRENCY',p.currency===intent.currency?'MATCH':'MISMATCH',{intentVersionId:intent.versionId,expected:intent.currency,observed:p.currency});
   if(p.original.paid===true)check(p,'PAID_INTENT_STATE',intent.status==='succeeded'?'MATCH':'MISMATCH',{intentVersionId:intent.versionId,observed:intent.status});
   const paid=p.amounts.amountPaid,charged=intent.amounts.chargedAmount,requested=p.amounts.amountRequested,expected=intent.amounts.expectedAmount;
   if(paid!==null&&charged!==null)check(p,'INSTALMENT_CHARGED_AMOUNT',cmp(paid,charged)===0?'MATCH':'MISMATCH',{paid,charged});
   if(requested!==null&&expected!==null)check(p,'INSTALMENT_REQUESTED_AMOUNT',cmp(requested,expected)===0?'MATCH':'MISMATCH',{requested,expected});
   intent.relatedVersionIds.push(...p.observedVersionIds,...(i?.observedVersionIds??[]));
  }
 }
 const intentLinks=new Map();
 for(const p of instalments){const k=canonicalJSON([p.sourceScope,p.environment,p.original.intentId??null]);const g=intentLinks.get(k)??[];g.push(p);intentLinks.set(k,g);}
 for(const g of intentLinks.values())if(g.length>1)for(const p of g)check(p,'INTENT_MULTIPLE_INSTALMENTS','UNKNOWN',{instalmentVersionIds:g.flatMap(x=>x.observedVersionIds)});
 for(const i of invoices){
  const ps=instalments.filter(p=>sameScope(i,p)&&p.original.invoiceId===i.resourceId);
  i.invoicePaymentVersionIds=ps.flatMap(p=>p.observedVersionIds);i.relatedVersionIds.push(...i.invoicePaymentVersionIds);
  i.instalmentCoverage=fullPopulation({action:'paycashless.invoice-payments.list',invoiceId:i.resourceId,sourceScope:i.sourceScope,environment:i.environment,coverage,sources,selectedIds});
  const paid=ps.filter(p=>p.original.paid===true);
  const usable=paid.every(p=>p.currency===i.currency&&p.amounts.amountPaid!==null&&!p.selectionAmbiguous&&finalState(p.checks.filter(c=>!['PERIOD_MEMBERSHIP','RELATED_RECORD_UNRESOLVED'].includes(c.code)))==='MATCH');
  i.selectedPaidInstalmentSum=usable?sum(paid.map(p=>p.amounts.amountPaid)):null;i.selectedPaidInstalmentCount=paid.length;
  i.selectedInstalmentCount=ps.length;
  const allState=ps.every(p=>typeof p.original.paid==='boolean'&&!p.selectionAmbiguous);
  if(i.instalmentCoverage.complete&&usable&&allState&&i.amounts.amountPaid!==null)check(i,'COMPLETE_INSTALMENT_SUM',cmp(i.selectedPaidInstalmentSum,i.amounts.amountPaid)===0?'MATCH':'MISMATCH',{observed:i.selectedPaidInstalmentSum,reported:i.amounts.amountPaid,versionIds:i.invoicePaymentVersionIds});
  else check(i,'COMPLETE_INSTALMENT_SUM','UNKNOWN',{observed:i.selectedPaidInstalmentSum,reported:i.amounts.amountPaid,coverage:i.instalmentCoverage,versionIds:i.invoicePaymentVersionIds});
  let max=null;
  try{max=exactField(i.original,'maxInstallments',i.numberTokens);if(max!==null&&(parts(max).scale!==0||cmp(max,'0')<0))max=null;}catch{}
  i.maxInstallments=max;
  if(max!==null&&cmp(String(paid.length),max)>0)check(i,'INSTALMENT_LIMIT','MISMATCH',{selectedPaidCount:paid.length,maxInstallments:max});
  else check(i,'INSTALMENT_LIMIT',max!==null&&i.instalmentCoverage.complete&&allState?'MATCH':'UNKNOWN',{selectedPaidCount:paid.length,maxInstallments:max});
  if(i.original.acceptPartialPayments===false&&paid.some(p=>p.amounts.amountPaid!==null&&i.amounts.amountDue!==null&&cmp(p.amounts.amountPaid,i.amounts.amountDue)<0))check(i,'PARTIAL_PAYMENT_POLICY','MISMATCH',{selectedPaidVersionIds:paid.flatMap(p=>p.observedVersionIds)});
 }
}
function effectiveDecisions(decisions,book,exception){
 const cohort=decisions.filter(x=>x.bookId===book.id),active=[];let tips=[];
 try{tips=decisionTips(cohort);}catch(e){exception('DECISION_HISTORY_INVALID',{reason:e.code??e.message});return{cohort,tips:[],effective:[]};}
 const byId=new Map(cohort.map(x=>[x.id,x]));
 for(const tip of tips){let at=tip;while(at&&at.status!=='accepted')at=at.supersedesId?byId.get(at.supersedesId):null;if(at)active.push(at);}
 return{cohort,tips,effective:active};
}
function allocationChecks(d,subject,movement,book,versions,sources){
 const r={checks:[]},u=d.unitBinding;
 try{
  invariant(object(u)&&object(d.conversion),'ALLOCATION_FIELDS_REQUIRED');
  const normalized=unit(u),a=positive(d.allocationAmount),s=positive(d.settlementAmount),rate=positive(d.conversion.rate);
  check(r,'EXACT_CONVERSION',cmp(mul(s,rate),a)===0?'MATCH':'MISMATCH',{allocationAmount:a,settlementAmount:s,rate});
  check(r,'CONVERSION_SOURCE',Array.isArray(d.conversion.sourceIds)&&d.conversion.sourceIds.length&&d.conversion.sourceIds.every(id=>sources.some(x=>x.id===id))?'MATCH':'UNKNOWN');
  check(r,'PROVIDER_MINOR_UNIT',parts(a).scale===0?'MATCH':'MISMATCH');
  check(r,'SETTLEMENT_PRECISION',parts(s).scale<=7?'MATCH':'MISMATCH');
  check(r,'SUBJECT_CURRENCY',subject.currency===normalized.currency?'MATCH':'MISMATCH');
  check(r,'SUBJECT_DIRECTION',normalized.direction===(subject.kind==='paycashless-payment'?'incoming':'outgoing')?'MATCH':'MISMATCH');
  check(r,'SUBJECT_FINAL',subject.providerFinal?'MATCH':'MISMATCH',{status:subject.status});
  check(r,'SUBJECT_PERIOD',subject.inPeriod===true?'MATCH':'UNKNOWN',{inPeriod:subject.inPeriod});
  check(r,'SUBJECT_SELECTION',subject.filterMatch===true&&!subject.excluded&&!subject.selectionAmbiguous&&!subject.selectionConflict?'MATCH':'UNKNOWN');
  const intrinsic=subject.checks.filter(c=>!['PERIOD_MEMBERSHIP','COMPLETE_INSTALMENT_SUM','INSTALMENT_LIMIT'].includes(c.code));
  check(r,'SUBJECT_EVIDENCE',finalState(intrinsic),{checks:intrinsic});
  check(r,'HORIZON_FINAL',movement.settled?'MATCH':'UNKNOWN',{checks:movement.checks});
  check(r,'STELLAR_UNIT',normalized.assetType===movement.assetType&&normalized.assetCode===movement.assetCode&&normalized.assetIssuer===movement.assetIssuer?'MATCH':'MISMATCH',{expected:normalized,observed:{assetType:movement.assetType,assetCode:movement.assetCode,assetIssuer:movement.assetIssuer}});
  check(r,'STELLAR_NETWORK',normalized.network===movement.network?'MATCH':'MISMATCH');
  const accounts=normalized.direction==='incoming'?[movement.to,movement.toMuxed]:[movement.from,movement.fromMuxed];
  check(r,'STELLAR_ACCOUNT',accounts.includes(normalized.account)?'MATCH':'MISMATCH',{observed:accounts,expected:normalized.account});
  // For an outgoing path payment, destination amount/asset is not the merchant's
  // spent amount. It cannot satisfy this destination-amount binding.
  if(normalized.direction==='outgoing'&&movement.operationType!=='payment')check(r,'OUTGOING_PATH_PAYMENT_UNIT','UNKNOWN',{type:movement.operationType,reason:'The selected amount is the destination amount; source spend is a different asset/amount contract.'});
  const mt=normalized.memoType??'none',actual=movement.memoType??null;
  check(r,'TRANSACTION_MEMO',mt===actual&&normalized.memo===movement.memo?'MATCH':'MISMATCH',{expectedType:mt,observedType:actual,expected:normalized.memo,observed:movement.memo});
  for(const id of d.sourceIds??[])check(r,'SUPPORTING_SOURCE',sources.some(x=>x.id===id)?'MATCH':'UNKNOWN',{sourceId:id});
  for(const id of d.corroborationVersionIds??[])check(r,'CORROBORATING_VERSION',versions.some(x=>x.id===id&&inScope(x,book))?'MATCH':'UNKNOWN',{versionId:id});
 }catch(e){check(r,'ALLOCATION_INVALID','UNKNOWN',{reason:e.code??e.message});}
 return r.checks;
}
function applyDecisions({state,rows,movements,book,versions,sources,exception}){
 const rowByVersion=new Map(),movementByVersion=new Map();
 for(const r of rows)for(const id of r.observedVersionIds)rowByVersion.set(id,r);
 for(const r of movements)for(const id of r.observedVersionIds)movementByVersion.set(id,r);
 const selections=new Map();
 for(const d of state.effective.filter(x=>['include','exclude'].includes(x.action))){const r=rowByVersion.get(d.subjectVersionId);if(!r){exception('DECISION_SUBJECT_NOT_SELECTED',{decisionId:d.id,versionId:d.subjectVersionId});continue;}const a=selections.get(r.id)??[];a.push(d);selections.set(r.id,a);}
 for(const [id,ds]of selections){const r=rows.find(r=>r.id===id);r.selectionDecisionIds=ds.map(d=>d.id);
  if(new Set(ds.map(d=>d.action)).size>1){r.selectionConflict=true;check(r,'SELECTION_DECISION_CONFLICT','UNKNOWN',{decisionIds:r.selectionDecisionIds});}
  else r.excluded=ds[0].action==='exclude';
 }
 const effective=new Set(state.effective.map(x=>x.id)),tipIds=new Set(state.tips.map(x=>x.id)),allocations=[];
 for(const d of state.cohort){
  const a={id:d.id,action:d.action,decisionStatus:d.status,effective:effective.has(d.id),tip:tipIds.has(d.id),subjectVersionId:d.subjectVersionId,settlementVersionId:d.settlementVersionId??null,
   allocationAmount:d.allocationAmount??null,settlementAmount:d.settlementAmount??null,unitBinding:clone(d.unitBinding??null),conversion:clone(d.conversion??null),
   sourceIds:clone(d.sourceIds??[]),corroborationVersionIds:clone(d.corroborationVersionIds??[]),status:effective.has(d.id)?d.action==='allocate'?'UNKNOWN':'RECORDED':tipIds.has(d.id)?String(d.status).toUpperCase():'SUPERSEDED',
   checks:[],original:clone(d)};
  allocations.push(a);if(!a.effective||d.action!=='allocate')continue;
  const subject=rowByVersion.get(d.subjectVersionId),m=movementByVersion.get(d.settlementVersionId);
  if(book.settlementBasis!=='stellar'||!subject||!m||!['paycashless-payment','paycashless-payout'].includes(subject.kind)){check(a,'EXACT_SELECTION_REQUIRED','UNKNOWN');continue;}
  a.checks=allocationChecks(d,subject,m,book,versions,sources);
  if(finalState(a.checks)==='MATCH'){a.status='ELIGIBLE';a.subjectRowId=subject.id;a.economicKey=m.economicKey;}
 }
 // Both sides enforce aggregate limits before applying any allocation. An
 // invalid group never consumes capacity first and hides the original conflict.
 const byMovement=new Map(),bySubject=new Map();
 for(const a of allocations.filter(a=>a.status==='ELIGIBLE')){
  for(const [map,k]of [[byMovement,a.economicKey],[bySubject,a.subjectRowId]]){const g=map.get(k)??[];g.push(a);map.set(k,g);}
 }
 for(const [k,g]of byMovement){
  const ms=movements.filter(m=>m.economicKey===k),signatures=new Set(ms.map(m=>canonicalJSON([m.amount,m.assetType,m.assetCode,m.assetIssuer,m.from,m.to,m.memoType,m.memo])));
  const total=sum(g.map(a=>a.settlementAmount)),available=ms[0]?.amount;
  if(signatures.size!==1||available===null||available===undefined||cmp(total,available)>0){
   for(const a of g){a.status='OVERALLOCATED_OR_CONFLICT';check(a,'SETTLEMENT_CAPACITY','MISMATCH',{allocated:total,available,versionIds:ms.flatMap(m=>m.observedVersionIds)});}
  }
 }
 for(const [id,g]of bySubject){
  const subject=rows.find(r=>r.id===id),total=sum(g.map(a=>a.allocationAmount)),available=subject.expectedSettlementAmount;
  if(available===null||available===undefined||cmp(total,available)>0)for(const a of g){a.status='OVERALLOCATED_OR_CONFLICT';check(a,'SUBJECT_CAPACITY','MISMATCH',{allocated:total,available});}
 }
 const movementTotals=new Map();
 for(const a of allocations.filter(a=>a.status==='ELIGIBLE')){
  a.status='ALLOCATED';const r=rowByVersion.get(a.subjectVersionId);r.allocationIds.push(a.id);r.allocatedAmount=add(r.allocatedAmount,a.allocationAmount);
  movementTotals.set(a.economicKey,add(movementTotals.get(a.economicKey)??'0',a.settlementAmount));
 }
 for(const r of rows){
  if(r.expectedSettlementAmount!==undefined&&r.expectedSettlementAmount!==null)r.remainingAmount=sub(r.expectedSettlementAmount,r.allocatedAmount);
  r.evidenceState=finalState(r.checks);
  r.reconciliationState=r.excluded?'EXCLUDED':r.selectionConflict||r.selectionAmbiguous?'UNKNOWN':r.filterMatch===false||r.inPeriod===false?'OUTSIDE_SELECTION':r.inPeriod===null||r.filterMatch===null?'UNKNOWN':
   !r.providerFinal?'NOT_FINAL':r.evidenceState!=='MATCH'?'UNKNOWN':book.settlementBasis==='provider'?'PROVIDER_CONFIRMED':
   r.remainingAmount===null?'UNKNOWN':cmp(r.remainingAmount,'0')===0?'RECONCILED':cmp(r.allocatedAmount,'0')>0?'PARTIAL':'UNALLOCATED';
 }
 for(const m of movements){m.allocatedAmount=movementTotals.get(m.economicKey)??'0';if(m.amount!==null)m.remainingAmount=sub(m.amount,m.allocatedAmount);}
 for(const a of allocations)if(a.effective&&a.action==='allocate'&&a.status!=='ALLOCATED')exception('ALLOCATION_UNRESOLVED',{allocationId:a.id,status:a.status,checks:a.checks});
 return allocations;
}
function totalsFor(rows){
 const buckets=new Map();
 const put=(r,role,values)=>{
  const k=canonicalJSON([r.sourceScope,r.environment,r.currency,'minor',role]),b=buckets.get(k)??{sourceScope:r.sourceScope,environment:r.environment,currency:r.currency,unit:'minor',role,values:{count:0},versionIds:[]};
  b.values.count++;b.versionIds.push(...r.observedVersionIds);
  for(const [field,v]of Object.entries(values)){
   if(v===null||v===undefined){b.values[field+'UnknownCount']=(b.values[field+'UnknownCount']??0)+1;continue;}
   b.values[field]=add(b.values[field]??'0',v);
  }buckets.set(k,b);
 };
 for(const r of rows){
  if(r.excluded||r.filterMatch===false||r.inPeriod===false)continue;
  const prefix=r.filterMatch===null?'unresolved-filter/':r.inPeriod===null?'unresolved-period/':r.selectionAmbiguous||r.selectionConflict?'unresolved-identity/':!r.currency?'unresolved-unit/':'';
  const evidencePrefix=!prefix&&r.evidenceState!=='MATCH'?'unresolved-evidence/':prefix;
  if(r.kind==='paycashless-invoice')put(r,evidencePrefix+'invoice-stock',{amount:r.amounts.amountDue,paid:r.amounts.amountPaid,remaining:r.amounts.amountRemaining,overpaid:r.amounts.amountOverpaid});
  else if(r.kind==='paycashless-invoice-payment')put(r,evidencePrefix+'instalment-evidence/'+r.status,{amount:r.amounts.amountPaid,requested:r.amounts.amountRequested});
  else if(r.kind==='paycashless-payment')put(r,evidencePrefix+(r.providerFinal?'collection':'payment-state/'+(r.status??'unknown')),{amount:r.amounts.chargedAmount,expected:r.amounts.expectedAmount,fee:r.amounts.fee,vat:r.amounts.vat,emtl:r.amounts.emtl,allocated:r.allocatedAmount,unallocated:r.remainingAmount});
  else if(r.kind==='paycashless-payout')put(r,evidencePrefix+(r.providerFinal?'payout':'payout-state/'+(r.status??'unknown')),{amount:r.amounts.amount,fee:r.amounts.fee,vat:r.amounts.vat,stampDuty:r.amounts.stampDuty,allocated:r.allocatedAmount,unallocated:r.remainingAmount});
 }
 return[...buckets.values()];
}
export function reconcilePayments({book,versions=[],history=[],sources=[],decisions=[],coverage={}}){
 book=normalizeBook(book);invariant([versions,history,sources,decisions].every(Array.isArray)&&object(coverage),'FULL_SELECTION_REQUIRED');
 const exceptions=[],seen=new Set(),exception=(code,evidence={})=>{const v={code,...clone(evidence)},id=hash(v);if(!seen.has(id)){seen.add(id);exceptions.push({id,...v});}};
 const selected=select(versions,book,coverage,exception),entries=selected.entries,allSelected=[...selected.byId.values()],selectedIds=new Set(allSelected.map(v=>v.id));
 const sourceIds=new Set(sources.map(s=>s.id));for(const v of [...allSelected,...history.filter(v=>inScope(v,book))])if(!sourceIds.has(v.sourceId))exception('ORIGINAL_SOURCE_NOT_SELECTED',{versionId:v.id,sourceId:v.sourceId});
 const cashKinds=['paycashless-invoice','paycashless-invoice-payment','paycashless-payment','paycashless-payout'];
 const rows=entries.filter(e=>cashKinds.includes(e.version.kind)).map(e=>projectCash(e,book,sources));
 const invoices=rows.filter(r=>r.kind==='paycashless-invoice'),invoicePayments=rows.filter(r=>r.kind==='paycashless-invoice-payment'),payments=rows.filter(r=>r.kind==='paycashless-payment'),payouts=rows.filter(r=>r.kind==='paycashless-payout');
 reconcileInvoices(invoices,invoicePayments,payments,book,coverage,sources,selectedIds);filterRows(rows,book);
 const horizon=entries.filter(e=>e.version.kind.startsWith('horizon-')&&!e.ambiguous).map(e=>e.version);
 const settlements=entries.filter(e=>e.version.kind==='horizon-operation').map(e=>movement(e,book,sources,horizon));
 const accounts=entries.filter(e=>['paycashless-dedicated-account','paycashless-account-request','horizon-account'].includes(e.version.kind)).map(e=>common(e,book,sources));
 const events=[],eventIds=new Set();
 for(const v of [...history,...allSelected]){
  if(v.kind!=='paycashless-event'||!inScope(v,book)||eventIds.has(v.id))continue;eventIds.add(v.id);
  const s=sources.find(s=>s.id===v.sourceId);events.push({id:hash(['event',v.id]),versionId:v.id,resourceId:originalId(v),sourceId:v.sourceId,sourceScope:scope(v),environment:v.environment,
   eventType:v.value.event??v.value.eventType??v.value.type??v.context?.eventType??null,eventTypeAuthenticated:false,
   verifiedData:v.context?.verifiedData===true,authenticatedFields:clone(v.context?.authenticatedFields??[]),
   observedAt:v.observedAt??null,original:clone(v.value),numberTokens:clone(v.numberTokens??{}),
   webhookId:s?.webhookId??null,sourceBodyComplete:s?.bodyComplete??null,semantics:'The original event label is unsigned display context. Only the declared data/registered callback URL/signature timestamp tuple is authenticated; no label or arrival order selects current resource state or cash totals.'});
 }
 const state=effectiveDecisions(decisions,book,exception),allocations=applyDecisions({state,rows,movements:settlements,book,versions:[...allSelected,...history],sources,exception});
 for(const r of [...rows,...settlements,...accounts]){
  r.relatedVersionIds=[...new Set(r.relatedVersionIds)];
  for(const c of r.checks)if(c.state!=='MATCH')exception(c.code,{rowId:r.id,versionId:r.versionId,evidence:c});
 }
 const population=[];
 for(const k of ['paycashless-invoice','paycashless-payment','paycashless-payout']){
  const action={'paycashless-invoice':'paycashless.invoices.list','paycashless-payment':'paycashless.payments.list','paycashless-payout':'paycashless.payouts.list'}[k];
  const scopes=new Set([...allSelected.filter(v=>v.kind===k).map(scope),...(coverage.captures??[]).filter(c=>c.action===action).map(c=>c.connection?.sourceScope)].filter(Boolean));
  for(const sourceScope of scopes){const p=fullPopulation({action,sourceScope,environment:book.environment,coverage,sources,selectedIds});population.push({kind:k,sourceScope,...p});}
 }
 for(const c of coverage.captures??[])if(c.status!=='COMPLETE'||c.next!==null)exception('CAPTURE_WINDOW_INCOMPLETE',{captureId:c.id,status:c.status,next:c.next??null});
 for(const p of population)if(!p.complete)exception('RESOURCE_POPULATION_UNPROVEN',{kind:p.kind,sourceScope:p.sourceScope,evidence:p.evidence});
 if(!(coverage.captures??[]).length)exception('COLLECTION_COVERAGE_UNPROVEN');
 return{schema:'paycashless.payment-reconciliation.v1',bookId:book.id,environment:book.environment,period:clone(book.period),collectionBasis:book.collectionBasis,settlementBasis:book.settlementBasis,
  rows,invoices,invoicePayments,payments,payouts,accounts,settlements,events,allocations,exceptions,totals:totalsFor(rows),
  coverage:{...clone(coverage),populations:population,scope:'Exact selected original captures and resources. Complete pages establish only their original query; no period-end bank balance or unbounded merchant population is inferred.'},
  selectedVersionIds:allSelected.map(v=>v.id),historyVersionIds:[...new Set([...history,...allSelected].filter(v=>inScope(v,book)).map(v=>v.id))],
  sourceIds:[...new Set([...sources.map(s=>s.id),...allSelected.map(v=>v.sourceId),...history.filter(v=>inScope(v,book)).map(v=>v.sourceId),...state.cohort.flatMap(d=>[...(d.sourceIds??[]),...(d.conversion?.sourceIds??[])])])],
  linkIds:state.cohort.map(d=>d.id),
  semantics:{
   money:'Provider monetary values remain exact original minor-unit values. Numeric source spellings, integer amounts, fees and tax fields remain distinct. No implicit FX, scale conversion or fee subtraction is applied.',
   layers:'Cash collections are counted once at the succeeded payment-intent layer. Invoice stock and instalment evidence are separate roles and must not be added to cash. Payouts, pending/reversed/failed states and chain movements remain separate.',
   invoices:'Full original invoice and instalment records, line subtotals, explicit intent relationships, remaining/overpaid amounts, supplied partial-payment policy and full captured population support the checks. No undocumented tax rounding or inclusion policy is inferred.',
   settlement:'Provider success is reported independently of explicit Stellar allocations. Stellar proof requires successful exact operation/transaction identity, network, asset/issuer, account, memo and sourced exact conversion. Aggregate limits apply to both obligation and economic operation.',
   period:'Original createdAt or updatedAt is selected explicitly. Bounds are inclusive start/exclusive end with exact fractional-second comparison. Unknown dates never enter proven in-period totals; their original amounts remain in unresolved-period buckets.',
   completeness:'Rows and every selected source/version/decision remain retained. Ambiguous resource versions and incomplete pages cannot prove a complete population. Superseded decisions stay visible; only the latest accepted ancestor at each original tip is effective.',
   boundaries:'This report establishes consistency of selected evidence, not a bank balance, undisclosed merchant access, production settlement authorization, grant acceptance, or automatic financial action.'
  }};
}
