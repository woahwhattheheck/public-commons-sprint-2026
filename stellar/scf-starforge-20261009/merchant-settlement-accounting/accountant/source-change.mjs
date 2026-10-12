// MIT. Exact source-edition comparison for the original QBO/Xero accountant plans.
import {qboCanonical,qboHash,validateQboPlan} from './qbo.mjs';
import {validateQboCompany} from './qbo-company.mjs';
import {validateXeroContext,validateXeroPlan} from './xero.mjs';

export const SOURCE_CHANGE_SCHEMA='stellar-forge.accounting-source-change.v1';
export const changeCanonical=qboCanonical;
export const changeHash=value=>qboHash(typeof value==='string'||Buffer.isBuffer(value)?value:qboCanonical(value));
export const changeClone=value=>structuredClone(value);
export function changeCheck(ok,code,message,status=400){if(!ok)throw Object.assign(new Error(message),{code,status});}
export function changeId(value){
  changeCheck(typeof value==='string'&&/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value),
    'SOURCE_CHANGE_ID','Use the original lower-case UUID.');return value;
}
export function changeText(value,label,max=2000){
  changeCheck(typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value),
    'SOURCE_CHANGE_FIELD','Provide '+label+' within '+max+' characters.');return value;
}
export function changeKind(value){changeCheck(['qbo','xero'].includes(value),'SOURCE_CHANGE_KIND','Choose QuickBooks or Xero.');return value;}
const same=(a,b)=>qboCanonical(a)===qboCanonical(b);
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);

export function sourceEdition(kind,value){
  changeKind(kind);
  if(kind==='qbo'){
    validateQboCompany(value);
    return {kind,sha256:value.integrity.sha256,company:{id:value.realmId,name:value.companyName,baseCurrency:value.baseCurrency,
      multiCurrencyEnabled:value.multiCurrencyEnabled},accounts:value.accounts.map(row=>({id:row.value,code:null,name:row.name,
      eligible:row.selectable,status:row.Active?'ACTIVE':'INACTIVE',type:row.AccountType,currency:row.CurrencyRef?.value??value.baseCurrency,
      reasons:changeClone(row.reasons??[])}))};
  }
  validateXeroContext(value);
  return {kind,sha256:value.sha256,company:{id:value.tenantId,name:value.organization.name,
    baseCurrency:value.organization.baseCurrency,isDemoCompany:value.organization.isDemoCompany,status:value.organization.status},
    accounts:value.accounts.map(row=>({id:row.id,code:row.code,name:row.name,eligible:row.eligible,
      status:row.status,type:row.type,systemAccount:row.systemAccount}))};
}
export function planIdentity(kind,plan){
  if(changeKind(kind)==='qbo'){validateQboPlan(plan);return plan.integrity.sha256;}
  validateXeroPlan(plan);return plan.sha256;
}
export function compareSourceEditions(kind,plan,before,after){
  planIdentity(kind,plan);const left=sourceEdition(kind,before),right=sourceEdition(kind,after);
  changeCheck(left.company.id===right.company.id,'SOURCE_CHANGE_COMPANY','A chart change must retain the same original company or tenant.',409);
  if(kind==='xero')changeCheck(left.company.isDemoCompany===right.company.isDemoCompany,'SOURCE_CHANGE_COMPANY',
    'Preserve the original demo/books organization identity.',409);
  const uses=new Map(),use=(id,sourceId,side)=>{const rows=uses.get(id)??[];rows.push({sourceId,side});uses.set(id,rows);};
  for(const row of kind==='qbo'?plan.rows:plan.entries){
    const sourceId=kind==='qbo'?row.rowId:row.id;
    use(kind==='qbo'?row.debitAccount.value:row.debitAccount.id,sourceId,'debit');
    use(kind==='qbo'?row.creditAccount.value:row.creditAccount.id,sourceId,'credit');
  }
  const a=new Map(left.accounts.map(row=>[row.id,row])),b=new Map(right.accounts.map(row=>[row.id,row]));
  const accounts=[...new Set([...a.keys(),...b.keys()])].sort().map(id=>{
    const before=a.get(id)??null,after=b.get(id)??null;
    const fields=before&&after?[...new Set([...Object.keys(before),...Object.keys(after)])].sort().filter(key=>!same(before[key]??null,after[key]??null)):[];
    return {id,change:!before?'added':!after?'removed':fields.length?'changed':'unchanged',before,after,fields,usedBy:uses.get(id)??[]};
  });
  const companyChanges=[...new Set([...Object.keys(left.company),...Object.keys(right.company)])].sort()
    .filter(field=>!same(left.company[field]??null,right.company[field]??null))
    .map(field=>({field,before:left.company[field]??null,after:right.company[field]??null}));
  const body={schema:SOURCE_CHANGE_SCHEMA,kind,predecessorSha256:planIdentity(kind,plan),beforeSha256:left.sha256,afterSha256:right.sha256,
    sourceChanged:left.sha256!==right.sha256,companyChanges,accounts,
    summary:{added:accounts.filter(row=>row.change==='added').length,removed:accounts.filter(row=>row.change==='removed').length,
      changed:accounts.filter(row=>row.change==='changed').length,unchanged:accounts.filter(row=>row.change==='unchanged').length,
      usedChanged:accounts.filter(row=>row.usedBy.length&&row.change!=='unchanged').length,
      usedUnavailable:accounts.filter(row=>row.usedBy.length&&!row.after?.eligible).length,
      currencyChanged:left.company.baseCurrency!==right.company.baseCurrency}};
  return {...body,sha256:changeHash(body)};
}
export function successorDefaults(kind,plan,target){
  planIdentity(kind,plan);const after=sourceEdition(kind,target),accounts=new Map(after.accounts.map(row=>[row.id,row]));
  const selected=(id,key)=>{const row=accounts.get(id);return row?.eligible?row[key]:'';};
  const name=(plan.name+' — chart update').slice(0,160);
  if(kind==='qbo')return {name,txnDate:plan.txnDate,docNumber:null,rows:plan.rows.map(row=>({rowId:row.rowId,amount:row.amount,
    debitAccount:{value:selected(row.debitAccount.value,'id')},creditAccount:{value:selected(row.creditAccount.value,'id')},
    description:row.description}))};
  return {name,valuationBasis:plan.valuationBasis,entries:[
    ...plan.entries.map(row=>({componentId:row.id,decision:'include',date:row.date,amount:row.amount,
      debitAccountCode:selected(row.debitAccount.id,'code'),creditAccountCode:selected(row.creditAccount.id,'code'),
      valuationNote:row.valuationNote,description:row.description})),
    ...plan.excluded.map(row=>({componentId:row.id,decision:'exclude',reason:row.reason}))]};
}
export function assertSameEconomicSource(kind,before,after){
  planIdentity(kind,before);planIdentity(kind,after);
  changeCheck(before.id!==after.id,'SOURCE_CHANGE_SUCCESSOR_ID','Use a new retained UUID for the successor.');
  if(kind==='qbo'){
    changeCheck(before.handoffId===after.handoffId&&before.handoffSha256===after.handoffSha256&&
      before.realmId===after.realmId&&before.environment===after.environment,'SOURCE_CHANGE_ECONOMIC_SOURCE',
      'Preserve this plan’s exact handoff, company and environment.',409);
    const project=plan=>plan.rows.map(row=>({rowId:row.rowId,eventId:row.eventId,sourceRowSha256:row.sourceRowSha256,
      assignmentSha256:row.assignmentSha256,sourceNetwork:row.sourceNetwork,sourceAmountAtomic:row.sourceAmountAtomic,
      sourceLabel:row.sourceLabel,sourceAdjustments:row.sourceAdjustments})).sort((a,b)=>a.rowId.localeCompare(b.rowId));
    changeCheck(same(project(before),project(after)),'SOURCE_CHANGE_ECONOMIC_SOURCE',
      'A chart replacement keeps every selected original economic event and its accountant assignment.',409);
  }else{
    changeCheck(same(before.source,after.source)&&same(before.baseline,after.baseline)&&before.context.tenantId===after.context.tenantId&&
      before.purpose===after.purpose&&before.showOnCashBasisReports===after.showOnCashBasisReports,
      'SOURCE_CHANGE_ECONOMIC_SOURCE','Preserve the exact handoff, accountant baseline, tenant and original journal treatment.',409);
    const project=plan=>plan.entries.map(row=>Object.fromEntries(Object.entries(row).filter(([key])=>
      !['date','amount','debitAccount','creditAccount','valuationNote','description'].includes(key)))).sort((a,b)=>a.id.localeCompare(b.id));
    const excluded=plan=>[...plan.excluded].sort((a,b)=>a.id.localeCompare(b.id));
    changeCheck(same(project(before),project(after))&&same(excluded(before),excluded(after)),
      'SOURCE_CHANGE_ECONOMIC_SOURCE','Keep every included component and every original exclusion; change only explicit mappings and valuations.',409);
  }
  return true;
}
export function successorRequest(kind,previous,target,input,{accountantRevisionId=null}={}){
  changeCheck(plain(input),'SOURCE_CHANGE_REQUEST','Provide the reviewed successor fields.');
  changeId(input.id);changeText(input.name,'the successor name',160);changeText(input.actor,'the operator',1000);
  changeCheck(typeof input.createdAt==='string'&&Number.isFinite(Date.parse(input.createdAt))&&new Date(input.createdAt).toISOString()===input.createdAt,
    'SOURCE_CHANGE_CREATED_AT','Retain the exact ISO timestamp assigned to this successor.');
  if(kind==='qbo')return {id:input.id,name:input.name,actor:input.actor,createdAt:input.createdAt,handoffId:previous.handoffId,
    expectedParentId:accountantRevisionId,realmId:previous.realmId,companyName:target.companyName,baseCurrency:target.baseCurrency,
    environment:previous.environment,txnDate:input.txnDate,docNumber:input.docNumber??null,rows:changeClone(input.rows),
    companySnapshot:changeClone(target)};
  return {id:input.id,name:input.name,actor:input.actor,createdAt:input.createdAt,handoffId:previous.source.handoffId,
    contextId:target.id,accountantRevisionId:accountantRevisionId??'initial',entries:changeClone(input.entries),
    purpose:previous.purpose,valuationBasis:input.valuationBasis,showOnCashBasisReports:previous.showOnCashBasisReports};
}
