// MIT. Source-mode and startup composition over the original accounting Store.
import {openAccountingWorkspace} from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/store.mjs';
import {accountingWorkspaceBinding,inspectAccountingWorkspaceBinding} from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/binding.mjs';
import {accountingSourceMode,inspectBuyerStartupFile,readBuyerStartup,buyerStartupView} from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/workspace/buyer-startup.mjs';

const fail=(code,message)=>Object.assign(new Error(message),{code});
const need=(ok,code,message)=>{if(!ok)throw fail(code,message);};
const copy=value=>structuredClone(value);
const merchantMaps=['recoveredSources','recoveryRequests','proofFiles','termsFiles','pricingReports','collectionInputs','statementUsageInputs','cryptoworthInputs','runbookInputs'];
export function configuredAccountingMode(definition){
 const mode=definition.sourceMode??'merchant';
 need(mode==='merchant'||mode==='buyer','ACCOUNTING_CONFIGURATION_ERROR','Choose sourceMode merchant or buyer.');
 return mode;
}
export function validateBuyerAccountingDefinition(definition){
 if(configuredAccountingMode(definition)!=='buyer')return;
 need(['outboxDir','proofDir','termsFile'].every(key=>definition[key]===undefined),
  'ACCOUNTING_CONFIGURATION_ERROR','A buyer-only accountant retains its issued source; omit merchant outbox, proof and terms directories.');
 need(merchantMaps.every(key=>Object.keys(definition[key]??{}).length===0)&&
  !definition.bitwave&&!definition.platforms?.qbo&&definition.collectionHttpsProxyEnv===undefined&&definition.adjustmentHttpsProxyEnv===undefined,
  'ACCOUNTING_CONFIGURATION_ERROR','Declare buyer source, accountant-return and Xero inputs for buyer mode. Merchant collection, sales, runbook and platform inputs retain their original merchant workspace.');
}
export function requireBuyerAccounting(definition){
 need(configuredAccountingMode(definition)==='buyer','ACCOUNTING_BUYER_MODE_REQUIRED','Choose a host-declared buyer-only accountant workspace.');
}
function briefSource(source){
 if(!source?.buyer)return copy(source);
 const {outstandingReservations=[],sourceCaptures=[],...buyer}=source.buyer;
 return {...copy(source),buyer:{...copy(buyer),outstandingReservationsCount:outstandingReservations.length,sourceCapturesCount:sourceCaptures.length}};
}
function briefStartup(value){
 if(!value)return null;
 const {path,...retained}=copy(value);
 return {...retained,source:briefSource(value.source)};
}
export function buyerAccountingCapabilities(definition){
 const mode=configuredAccountingMode(definition);
 return {sourceMode:mode,issuedBuyerStartup:mode==='buyer',
  accountant:true,xero:true,merchantSources:mode==='merchant',nativeRecovery:Boolean(definition.recovery)};
}
export function buyerAccountingState(workspace){
 requireBuyerAccounting({sourceMode:accountingSourceMode(workspace.state)});
 const binding=accountingWorkspaceBinding(workspace.directory,workspace.state);
 const source=buyerStartupView(workspace.directory,workspace.state);
 const records=new Map((workspace.state.accountantHandoffs??[]).map(row=>[row.id,row]));
 source.handoffs=source.handoffs.map(row=>({...row,requestSha256:records.get(row.id).requestSha256,
  sourceSha256:records.get(row.id).source.reportSha256}));
 return {schema:'stellar-forge.buyer-accounting-operation.v1',sourceMode:'buyer',
  binding:{schema:binding.schema,workspaceId:binding.workspaceId,sourcesSha256:binding.sourcesSha256,
   sourceMode:'buyer',sourceSha256:binding.sources.buyerSourceSha256,sourceBytes:binding.sources.buyerSourceBytes},
  workspaceRevision:workspace.state.revision,source:briefStartup(source)};
}
export function buyerStartupProjection(value){return briefStartup(value);}
function sourceReview(inspected,args={}){
 const {source,rows,document}=inspected,issued=document.issued;
 const offset=args.offset??0,limit=args.limit??25,view=args.view??'summary';
 const result={source:briefSource(source),sourceKind:'buyer-expense-period',sourceSha256:inspected.sha256,
  period:copy(issued.period),totals:copy(issued.totals),creditTotals:copy(issued.credit_totals??[]),
  netTotals:copy(issued.net_totals??issued.totals),
  counts:{allocationRows:rows.length,expenseRows:rows.filter(row=>row.kind==='EXPENSE').length,
   creditRows:rows.filter(row=>row.kind==='CREDIT').length,
   outstandingReservations:source.buyer.outstandingReservations.length,sourceCaptures:source.buyer.sourceCaptures.length}};
 if(view!=='summary'){
  const selected={allocations:rows,outstanding:source.buyer.outstandingReservations,captures:source.buyer.sourceCaptures}[view];
  result.page={view,total:selected.length,offset,limit,items:copy(selected.slice(offset,offset+limit))};
 }
 return result;
}
export async function previewBuyerAccountingSource(definition,path,args){
 requireBuyerAccounting(definition);
 const selected=await inspectBuyerStartupFile(path,{expectedSha256:args.sourceSha256});
 return {...sourceReview(selected.inspected,args),input:{source:args.source,bytes:selected.bytes.length,sha256:selected.sha256}};
}
export function assertBuyerInitialization(value,args){
 need(value?.source?.sha256===args.sourceSha256&&value.source.name===args.name.trim()&&value.source.actor===args.actor.trim(),
  'ACCOUNTING_BUYER_INITIALIZATION_CHANGED','This directory already retains a different named buyer initialization. Inspect its retained startup and preserve the original source, name and operator.');
 return value;
}
export async function initializeBuyerAccounting(definition,path,args){
 requireBuyerAccounting(definition);
 let binding;
 try{binding=await inspectAccountingWorkspaceBinding(definition.directory);}
 catch(error){if(error.code!=='ENOENT')throw error;}
 if(binding)need(binding.sources.sourceMode==='buyer','ACCOUNTING_SOURCE_MODE_MISMATCH','This declared buyer directory belongs to an original merchant workspace.');
 const workspace=await openAccountingWorkspace(binding?
  {directory:definition.directory,expectedWorkspaceId:binding.workspaceId,expectedSourcesSha256:binding.sourcesSha256}:
  {directory:definition.directory,buyerSourceFile:path,buyerSourceSha256:args.sourceSha256,buyerSourceName:args.name,buyerOperator:args.actor});
 try{
  const value=assertBuyerInitialization(buyerAccountingState(workspace),args);
  return {...value,recovered:Boolean(binding)};
 }finally{await workspace.close();}
}
export async function buyerAccountingOpenSettings(definition){
 requireBuyerAccounting(definition);
 let binding;
 try{binding=await inspectAccountingWorkspaceBinding(definition.directory);}
 catch(error){
  if(error.code==='ENOENT')throw fail('ACCOUNTING_BUYER_INITIALIZATION_REQUIRED','Preview a declared original source and initialize this buyer accountant before opening it.');
  throw error;
 }
 need(binding.sources.sourceMode==='buyer','ACCOUNTING_SOURCE_MODE_MISMATCH','The configured buyer alias must retain an original buyer-only accountant workspace.');
 return {directory:definition.directory,expectedWorkspaceId:binding.workspaceId,expectedSourcesSha256:binding.sourcesSha256};
}
export function requireBuyerOperation(workspace,operation,args){
 if(accountingSourceMode(workspace.state)!=='buyer')return;
 const ordinary=new Set(['merchant_accounting_status','merchant_accounting_file','merchant_accounting_file_release',
  'merchant_accounting_accountant_buyer_prepare','merchant_accounting_accountant_buyer_create','merchant_accounting_accountant',
  'merchant_accounting_accountant_rows','merchant_accounting_accountant_preview','merchant_accounting_accountant_apply']);
 need(ordinary.has(operation)||operation.startsWith('merchant_accounting_buyer_')||operation.startsWith('merchant_accounting_xero_'),
  'ACCOUNTING_MERCHANT_SOURCE_REQUIRED','This alias retains an issued buyer period. Use its buyer, accountant, Xero and recovery operations; merchant-source operations belong to a merchant alias.');
 if(operation==='merchant_accounting_file')need(['buyer-source','accountant','xero'].includes(args.kind),
  'ACCOUNTING_MERCHANT_SOURCE_REQUIRED','Choose the retained buyer source, accountant packet or original Xero file for this buyer alias.');
}
export async function callBuyerAccounting(workspace,accountant,operation,args){
 const startup=await readBuyerStartup(workspace.directory,workspace.state);
 const state=buyerAccountingState(workspace),descriptor=startup.descriptor;
 if(operation==='merchant_accounting_buyer_startup')return state;
 need(args.sourceSha256===descriptor.sha256,'ACCOUNTING_BUYER_SOURCE_CHANGED','Retain the exact issued source SHA256 selected in this buyer workspace.');
 if(operation==='merchant_accounting_buyer_prepare')return {...state,...sourceReview(startup.inspected,args),handoffId:descriptor.handoffId};
 if(operation==='merchant_accounting_buyer_handoff'){
  need(args.handoffId===descriptor.handoffId,'ACCOUNTING_BUYER_HANDOFF_CHANGED','Use the original startup handoff ID returned by prepare.');
  return accountant.create({id:descriptor.handoffId,revision:args.revision,name:args.name,actor:args.actor,
   labels:[],buyerStartup:{sha256:descriptor.sha256}});
 }
 throw fail('ACCOUNTING_UNKNOWN_TOOL','Unknown original buyer-accountant operation.');
}
