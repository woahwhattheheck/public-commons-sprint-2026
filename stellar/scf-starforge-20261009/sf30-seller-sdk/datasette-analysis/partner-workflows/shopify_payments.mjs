/** Shopify Payments source capture for the existing retail preparation.
 * Current reviewed API: 2026-10. No mutations, credential storage or accounting rules.
 */
import {canonical} from "./preparation.mjs";
export const CAPTURE_SCHEMA="stellar-forge.shopify-payments-capture.v1";
export const SOURCE_SCHEMA="stellar-forge.shopify-payments-source.v1";
export const API_VERSION="2026-10";
export const PARTITION_ROWS=10000;
const clone=value=>JSON.parse(JSON.stringify(value));
const fail=(code,detail)=>{const error=new Error(code);error.code=code;error.detail=detail;throw error;};
const need=(ok,code,detail)=>{if(!ok)fail(code,detail);};
const object=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const text=value=>typeof value==="string"&&value.trim().length>0;
const date=value=>typeof value==="string"&&/(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));
const money="amount currencyCode";
const payoutFields="id legacyResourceId issuedAt status transactionType externalTraceId net { "+money+" }";
const transactionFields=[
 "id type test transactionDate sourceId sourceType sourceOrderTransactionId adjustmentReason",
 "amount { "+money+" } fee { "+money+" } net { "+money+" }",
 "associatedOrder { id name } associatedPayout { id status }",
 "adjustmentsOrders { name link orderTransactionId amount { "+money+" } fees { "+money+" } net { "+money+" } }"
].join("\n");
export const DOCUMENTATION=[
 "https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopifyPaymentsAccount",
 "https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopifyPaymentsBalanceTransaction",
 "https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopifyPaymentsPayout",
 "https://shopify.dev/docs/api/admin-graphql/2026-10/enums/BalanceTransactionSortKeys",
 "https://shopify.dev/docs/api/admin-graphql/2026-10/enums/PayoutSortKeys",
 "https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopifyPaymentsAssociatedOrder",
 "https://shopify.dev/docs/api/admin-graphql/2026-10/objects/ShopifyPaymentsAdjustmentOrder",
 "https://shopify.dev/docs/api/usage/limits",
 "https://shopify.dev/docs/api/usage/pagination-graphql",
 "https://shopify.dev/docs/api/usage/search-syntax",
 "https://shopify.dev/docs/api/usage/versioning",
 "https://shopify.dev/docs/apps/build/apis/graphql-admin/rate-limits"
];
function windowValue(value,label){
 need(object(value)&&date(value.start)&&date(value.end),"SOURCE_WINDOW_REQUIRED",label);
 const start=new Date(value.start).toISOString(),end=new Date(value.end).toISOString();
 need(start<end,"SOURCE_WINDOW_ORDER",label);return {start,end};
}
export function selection(value){
 need(object(value),"CAPTURE_SELECTION_REQUIRED");
 const result=clone(value);
 need(typeof result.shop==="string"&&/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(result.shop),
      "ORIGINAL_MYSHOPIFY_HOST_REQUIRED");
 need(result.apiVersion===API_VERSION,"REVIEWED_API_VERSION_REQUIRED",API_VERSION);
 need(text(result.operationId)&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(result.operationId),
      "ORIGINAL_OPERATION_ID_REQUIRED");
 need(text(result.title)&&result.title.length<=300,"SOURCE_TITLE_REQUIRED");
 result.payoutWindow=windowValue(result.payoutWindow,"payoutWindow");
 result.unassignedWindow=result.unassignedWindow==null?null:windowValue(result.unassignedWindow,"unassignedWindow");
 need(object(result.policy)&&object(result.policy.currencyScale)&&object(result.policy.transactionRoles),
      "ORIGINAL_RETAIL_POLICY_REQUIRED");
 need(Object.keys(result.policy.currencyScale).length>0,"CURRENCY_SCALE_REQUIRED");
 for(const [currency,scale] of Object.entries(result.policy.currencyScale))
  need(/^[A-Z]{3}$/.test(currency)&&Number.isInteger(scale)&&scale>=0&&scale<=8,"CURRENCY_SCALE_REQUIRED",currency);
 for(const [kind,role] of Object.entries(result.policy.transactionRoles))
  need(text(kind)&&["contribution","transfer"].includes(role),"TRANSACTION_ROLE_REQUIRED",kind);
 if(result.expectedAccountId!=null)gid(result.expectedAccountId,"ShopifyPaymentsAccount");
 result.pageSize=result.pageSize??100;
 need(Number.isInteger(result.pageSize)&&result.pageSize>=1&&result.pageSize<=250,"PAGE_SIZE_RANGE");
 if(result.publisher!=null)need(text(result.publisher)&&result.publisher.length<=300,"SOURCE_PUBLISHER_INVALID");
 const allowed=["shop","apiVersion","operationId","title","payoutWindow","unassignedWindow","policy","expectedAccountId","pageSize","publisher"];
 need(Object.keys(result).every(key=>allowed.includes(key)),"UNKNOWN_CAPTURE_SELECTION_FIELD");
 return result;
}
export function gid(value,type){
 need(typeof value==="string","ORIGINAL_GLOBAL_ID_REQUIRED",type);
 const match=new RegExp("^gid://shopify/"+type+"/([1-9][0-9]*)$").exec(value);
 need(match,"ORIGINAL_NUMERIC_GLOBAL_ID_REQUIRED",{type,id:value});
 return BigInt(match[1]);
}
function inside(value,window){
 return date(value)&&Date.parse(value)>=Date.parse(window.start)&&Date.parse(value)<Date.parse(window.end);
}
function digest(value,sha){const result=sha(canonical(value));need(/^[a-f0-9]{64}$/.test(result),"SHA256_REQUIRED");return result;}
function emptyConnection(){return {upper:null,lower:"0",last:"0",after:null,partitionRows:0,rows:0,partitions:0,pages:[],complete:false};}
function pass(number){return {number,startedAt:null,completedAt:null,payouts:emptyConnection(),transactions:emptyConnection(),summary:null};}
export function createCapture(config,sha,createdAt){
 const selected=selection(config);need(date(createdAt),"ACTUAL_TIME_REQUIRED");
 return {schema:CAPTURE_SCHEMA,operationId:selected.operationId,selection:selected,selectionSha256:digest(selected,sha),
         createdAt,updatedAt:createdAt,status:"acquiring",phase:"identify",identity:null,identityReceipt:null,
         passes:[],currentPass:0,pageSize:selected.pageSize,result:null};
}
export function validateCapture(state,sha){
 need(object(state)&&state.schema===CAPTURE_SCHEMA,"CAPTURE_STATE_REQUIRED");
 const selected=selection(state.selection);
 need(state.selectionSha256===digest(selected,sha)&&state.operationId===selected.operationId,"CAPTURE_SELECTION_CHANGED");
 need(Array.isArray(state.passes)&&Number.isInteger(state.currentPass)&&state.currentPass>=0,"CAPTURE_STATE_INVALID");
 need(["acquiring","complete"].includes(state.status),"CAPTURE_STATUS_INVALID");
 need(Number.isInteger(state.pageSize)&&state.pageSize>=1&&state.pageSize<=state.selection.pageSize,"CAPTURE_PAGE_SIZE_INVALID");
 return state;
}
function payoutSearch(selected){
 return "issued_at:>='"+selected.payoutWindow.start+"' issued_at:<'"+selected.payoutWindow.end+"'";
}
function connectionRequest(state,kind,anchor,sha){
 const current=state.passes[state.currentPass],conn=current[kind];
 const filters=[];
 if(kind==="payouts")filters.push(payoutSearch(state.selection));
 if(!anchor){filters.push("id:>"+conn.lower,"id:<="+conn.upper);}
 const fields=kind==="payouts"?payoutFields:transactionFields;
 const connection=kind==="payouts"?"payouts":"balanceTransactions";
 const extra=kind==="transactions"?", hideTransfers:false":"";
 const query="query PaymentsSource($first:Int!,$after:String,$query:String!,$reverse:Boolean!){\n"+
  "shopifyPaymentsAccount { id "+connection+"(first:$first,after:$after,query:$query,reverse:$reverse,sortKey:ID"+extra+") {\n"+
  "nodes { "+fields+" }\npageInfo { hasNextPage endCursor }\n} } }";
 const variables={first:anchor?1:state.pageSize,after:anchor?null:conn.after,
                  query:filters.join(" "),reverse:anchor};
 const request={schema:SOURCE_SCHEMA,operationId:state.operationId,pass:current.number,
                phase:state.phase,kind,anchor,query,variables,
                endpoint:"https://"+state.selection.shop+"/admin/api/"+state.selection.apiVersion+"/graphql.json"};
 return {...request,id:digest(request,sha)};
}
export function nextRequest(state,sha){
 validateCapture(state,sha);
 if(state.status==="complete"||state.phase==="summarize")return null;
 if(state.phase==="identify"){
  const request={schema:SOURCE_SCHEMA,operationId:state.operationId,pass:0,phase:"identify",kind:"identity",
   endpoint:"https://"+state.selection.shop+"/admin/api/"+state.selection.apiVersion+"/graphql.json",
   query:"query PaymentsSourceIdentity { shop { id name myshopifyDomain } shopifyPaymentsAccount { id activated country defaultCurrency } }",
   variables:{}};
  return {...request,id:digest(request,sha)};
 }
 const match=/^(payouts|transactions)-(anchor|pages)$/.exec(state.phase);
 need(match,"CAPTURE_PHASE_INVALID",state.phase);
 return connectionRequest(state,match[1],match[2]==="anchor",sha);
}
export function reducePageSize(state,request,sha,completedAt){
 validateCapture(state,sha);
 need(canonical(request)===canonical(nextRequest(state,sha)),"ORIGINAL_PENDING_REQUEST_CHANGED");
 need(!request.anchor&&request.kind!=="identity"&&state.pageSize>1,"QUERY_COST_REQUIRES_SOURCE_REVIEW");
 need(date(completedAt),"ACTUAL_TIME_REQUIRED");
 const result=clone(state);result.pageSize=Math.max(1,Math.floor(state.pageSize/2));result.updatedAt=completedAt;
 return result;
}
export function checkResponse(request,envelope,apiVersion){
 need(object(envelope)&&Number.isInteger(envelope.status),"ORIGINAL_HTTP_RESPONSE_REQUIRED");
 need(envelope.status===200,"SHOPIFY_HTTP_RESPONSE",{status:envelope.status});
 need(object(envelope.headers),"ORIGINAL_RESPONSE_HEADERS_REQUIRED");
 const headers=Object.fromEntries(Object.entries(envelope.headers).map(([key,value])=>[key.toLowerCase(),String(value)]));
 need(headers["x-shopify-api-version"]===apiVersion,"SHOPIFY_SERVED_VERSION_CHANGED",
      {selected:apiVersion,served:headers["x-shopify-api-version"]??null});
 const body=envelope.body;
 need(object(body),"ORIGINAL_GRAPHQL_OBJECT_REQUIRED");
 need(!Array.isArray(body.errors)||body.errors.length===0,"SHOPIFY_GRAPHQL_ERRORS",body.errors);
 need(body.errors==null||Array.isArray(body.errors),"GRAPHQL_ERRORS_INVALID");
 const search=body.extensions?.search;
 if(search!=null){
  need(Array.isArray(search),"SHOPIFY_SEARCH_DIAGNOSTICS_INVALID");
  for(const item of search)
   need(item?.warnings==null||(Array.isArray(item.warnings)&&item.warnings.length===0),
        "SHOPIFY_SEARCH_WARNING",item?.warnings);
 }
 need(object(body.data),"SHOPIFY_DATA_REQUIRED");
 return body;
}
export function acceptResponse(state,request,envelope,receipt,sha,completedAt){
 validateCapture(state,sha);need(date(completedAt),"ACTUAL_TIME_REQUIRED");
 need(canonical(request)===canonical(nextRequest(state,sha)),"ORIGINAL_PENDING_REQUEST_CHANGED");
 need(object(receipt)&&typeof receipt.path==="string"&&Number.isSafeInteger(receipt.bytes)&&receipt.bytes>0&&
      /^[a-f0-9]{64}$/.test(receipt.sha256),"ORIGINAL_RESPONSE_RECEIPT_REQUIRED");
 const result=clone(state),body=checkResponse(request,envelope,result.selection.apiVersion);
 const account=body.data.shopifyPaymentsAccount;
 need(object(account)&&text(account.id),"SHOPIFY_PAYMENTS_ACCOUNT_UNAVAILABLE");
 gid(account.id,"ShopifyPaymentsAccount");
 if(result.selection.expectedAccountId!=null)
  need(account.id===result.selection.expectedAccountId,"ORIGINAL_ACCOUNT_CHANGED");
 if(result.identity)need(account.id===result.identity.account.id,"ORIGINAL_ACCOUNT_CHANGED");
 result.updatedAt=completedAt;
 if(request.phase==="identify"){
  const shop=body.data.shop;
  need(object(shop)&&shop.myshopifyDomain===result.selection.shop&&text(shop.id)&&text(shop.name),
       "ORIGINAL_SHOP_CHANGED");
  need(account.activated===true,"SHOPIFY_PAYMENTS_ACCOUNT_NOT_ACTIVE");
  result.identity={shop:clone(shop),account:clone(account)};
  result.identityReceipt=clone(receipt);
  result.passes.push(pass(1));result.passes[0].startedAt=completedAt;result.phase="payouts-anchor";
  return result;
 }
 const current=result.passes[result.currentPass],conn=current[request.kind];
 const connection=account[request.kind==="payouts"?"payouts":"balanceTransactions"];
 need(object(connection)&&Array.isArray(connection.nodes)&&object(connection.pageInfo),"COMPLETE_CONNECTION_REQUIRED");
 const rows=connection.nodes,info=connection.pageInfo,type=request.kind==="payouts"?"ShopifyPaymentsPayout":"ShopifyPaymentsBalanceTransaction";
 need(rows.length<=request.variables.first&&typeof info.hasNextPage==="boolean","SOURCE_PAGE_SIZE_INVALID");
 need(!info.hasNextPage||(text(info.endCursor)&&rows.length>0),"SOURCE_CURSOR_REQUIRED");
 if(request.anchor){
  need(rows.length<=1,"SOURCE_ANCHOR_INVALID");
  conn.anchorReceipt=clone(receipt);
  if(rows.length){
   const id=gid(rows[0].id,type);
   if(request.kind==="payouts")need(inside(rows[0].issuedAt,result.selection.payoutWindow),"PAYOUT_WINDOW_CHANGED");
   conn.upper=id.toString();result.phase=request.kind+"-pages";
  }else{
   conn.complete=true;result.phase=request.kind==="payouts"?"transactions-anchor":"summarize";
  }
  return result;
 }
 let last=BigInt(conn.last);
 for(const row of rows){
  const id=gid(row.id,type);
  need(id>last&&id>BigInt(conn.lower)&&id<=BigInt(conn.upper),"SOURCE_ID_ORDER_OR_RANGE",{kind:request.kind,id:row.id});
  if(request.kind==="payouts")need(inside(row.issuedAt,result.selection.payoutWindow),"PAYOUT_WINDOW_CHANGED");
  else {
   need(date(row.transactionDate)&&typeof row.test==="boolean"&&object(row.associatedPayout),
            "SOURCE_TRANSACTION_SHAPE",row.id);
   for(const field of ["sourceId","sourceOrderTransactionId"])
    need(row[field]==null||(typeof row[field]==="string"&&/^-?[0-9]+$/.test(row[field])),"SOURCE_BIGINT_STRING_REQUIRED",{id:row.id,field});
   if(row.associatedPayout.id!=null)gid(row.associatedPayout.id,"ShopifyPaymentsPayout");
   need(Array.isArray(row.adjustmentsOrders),"SOURCE_ADJUSTMENT_ORDERS_REQUIRED",row.id);
   for(const adjustment of row.adjustmentsOrders)
    need(adjustment.orderTransactionId==null||(typeof adjustment.orderTransactionId==="string"&&/^-?[0-9]+$/.test(adjustment.orderTransactionId)),
     "SOURCE_BIGINT_STRING_REQUIRED",{id:row.id,field:"adjustmentsOrders.orderTransactionId"});
  }
  last=id;
 }
 const descriptor={...clone(receipt),requestId:request.id,kind:request.kind,
   partition:conn.partitions,lowerExclusive:conn.lower,upperInclusive:conn.upper,
   after:request.variables.after,endCursor:info.endCursor??null,hasNextPage:info.hasNextPage,rows:rows.length};
 conn.pages.push(descriptor);conn.rows+=rows.length;conn.partitionRows+=rows.length;conn.last=last.toString();
 if(!info.hasNextPage){
  conn.complete=true;result.phase=request.kind==="payouts"?"transactions-anchor":"summarize";
 }else if(conn.partitionRows>=PARTITION_ROWS){
  need(last>BigInt(conn.lower),"SOURCE_PARTITION_NOT_ADVANCING");
  conn.lower=last.toString();conn.after=null;conn.partitionRows=0;conn.partitions++;
 }else{
  need(info.endCursor!==conn.after,"SOURCE_CURSOR_REPEATED");
  conn.after=info.endCursor;
 }
 return result;
}
export async function summarizePass(state,readResponse,sha,completedAt){
 validateCapture(state,sha);need(state.phase==="summarize"&&date(completedAt),"COMPLETE_SOURCE_PASS_REQUIRED");
 const current=state.passes[state.currentPass];
 need(current.payouts.complete&&current.transactions.complete,"SOURCE_CONNECTION_PENDING");
 const payouts=[],transactions=[],orders=new Map(),orderConflicts=[];
 const allPayoutIds=new Set();
 for(const page of current.payouts.pages){
  const body=await readResponse(page);
  for(const row of body.data.shopifyPaymentsAccount.payouts.nodes){
   need(!allPayoutIds.has(row.id),"SOURCE_PAYOUT_ID_REPEATED",row.id);
   allPayoutIds.add(row.id);payouts.push(clone(row));
  }
 }
 let unassigned=0,outside=0;
 for(const page of current.transactions.pages){
  const body=await readResponse(page);
  for(const row of body.data.shopifyPaymentsAccount.balanceTransactions.nodes){
   const payoutId=row.associatedPayout?.id??null;
   const selected=allPayoutIds.has(payoutId);
   const selectedUnassigned=payoutId===null&&state.selection.unassignedWindow&&inside(row.transactionDate,state.selection.unassignedWindow);
   if(!selected&&!selectedUnassigned){outside++;continue;}
   if(selectedUnassigned)unassigned++;
   transactions.push(clone(row));
   const order=row.associatedOrder;
   if(order!=null){
    need(object(order)&&text(order.id)&&typeof order.name==="string","ASSOCIATED_ORDER_SHAPE",row.id);
    if(!orders.has(order.id))orders.set(order.id,clone(order));
    else if(canonical(orders.get(order.id))!==canonical(order))
     orderConflicts.push(clone(order));
   }
  }
 }
 const orderRows=[...orders.values(),...orderConflicts];
 const projection={kind:"retail-payout-reconciliation",policy:clone(state.selection.policy),
                   balanceTransactions:transactions,payouts,orders:orderRows};
 const fingerprint=digest(projection,sha);
 const summary={pass:current.number,completedAt,fingerprint,
   selectedTransactions:transactions.length,selectedPayouts:payouts.length,selectedOrders:orderRows.length,
   scannedTransactions:current.transactions.rows,unassignedTransactions:unassigned,
   otherAccountTransactions:outside,payoutUpperId:current.payouts.upper,transactionUpperId:current.transactions.upper,
   orderReferenceConflicts:orderConflicts.length};
 const prior=state.currentPass?state.passes[state.currentPass-1].summary:null;
 const result=clone(state);result.updatedAt=completedAt;
 result.passes[result.currentPass].summary=summary;result.passes[result.currentPass].completedAt=completedAt;
 if(prior&&prior.fingerprint===fingerprint){
  result.status="complete";result.phase="complete";
  result.result={fingerprint,acceptedPass:current.number,matchingPriorPass:prior.pass,completedAt,summary};
 }else{
  result.currentPass++;result.passes.push(pass(current.number+1));
  result.passes[result.currentPass].startedAt=completedAt;result.phase="payouts-anchor";
 }
 const references=[state.identityReceipt,...current.payouts.pages,...current.transactions.pages,
                   current.payouts.anchorReceipt,current.transactions.anchorReceipt].filter(Boolean);
 const originalInput={...projection,complete:result.status==="complete",source:{
  publisher:state.selection.publisher||state.identity.shop.name,title:state.selection.title,
  url:"https://"+state.selection.shop+"/admin/api/"+state.selection.apiVersion+"/graphql.json",
  selection:"All observed payouts issued in ["+state.selection.payoutWindow.start+", "+state.selection.payoutWindow.end+
    "), and every observed balance transaction associated with those payout IDs across the complete account ID traversal."+
    (state.selection.unassignedWindow?" Also unassigned transactions dated in ["+state.selection.unassignedWindow.start+", "+state.selection.unassignedWindow.end+").":""),
  retrievedAt:completedAt,apiVersion:state.selection.apiVersion,shop:clone(state.identity.shop),
  account:clone(state.identity.account),operationId:state.operationId,
  sourceCapture:{schema:SOURCE_SCHEMA,selectionSha256:state.selectionSha256,pass:current.number,
   fingerprint,summary,matchingPriorPass:result.status==="complete"?prior.pass:null,
   observation:"Complete independently retained traversals with matching selected projected bodies; provider atomic snapshot is not asserted.",
   retainedResponses:references,documentation:DOCUMENTATION}
 }};
 return {state:result,summary,originalInput};
}
