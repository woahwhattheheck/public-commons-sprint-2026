/** Editable commissioning transforms for retained native Analysis profiles.
 * No network, database mutation, credentials or independent datasource runtime.
 * Call buildRetail/buildContacts with complete selected original input and SHA-256.
 */
export const SCHEMA = "stellar-forge.partner-workflow-preparation.v1";
const clone = value => JSON.parse(JSON.stringify(value));
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const text = value => value == null ? "" : String(value);
const nonblank = value => typeof value === "string" && value.trim().length > 0;
const fail = (code, detail) => { const e = new Error(code); e.code=code; e.detail=detail; throw e; };
const requireValue = (ok,code,detail) => { if (!ok) fail(code,detail); };
export function canonical(value) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number") { requireValue(Number.isFinite(value),"FINITE_NUMBER_REQUIRED"); return JSON.stringify(value); }
  if (Array.isArray(value)) return "["+value.map(canonical).join(",")+"]";
  requireValue(value && typeof value === "object","JSON_VALUE_REQUIRED");
  return "{"+Object.keys(value).sort().map(k=>JSON.stringify(k)+":"+canonical(value[k])).join(",")+"}";
}
function digest(value, sha) { const h=sha(canonical(value)); requireValue(/^[a-f0-9]{64}$/.test(h),"SHA256_REQUIRED"); return h; }
function list(value,label) { requireValue(Array.isArray(value),"COMPLETE_SOURCE_ARRAY_REQUIRED",label); return value; }
function requiredString(value,label) { requireValue(nonblank(value),"SOURCE_STRING_REQUIRED",label); return value; }
function sourceDescription(input) {
  requireValue(input && typeof input==="object" && !Array.isArray(input),"INPUT_OBJECT_REQUIRED");
  const s=input.source;
  requireValue(s && nonblank(s.publisher) && nonblank(s.url) && nonblank(s.title),"ORIGINAL_SOURCE_DESCRIPTION_REQUIRED");
  requireValue(/^https?:\/\//.test(s.url),"ORIGINAL_SOURCE_URL_REQUIRED");
  requireValue(nonblank(s.selection) && nonblank(s.retrievedAt),"ORIGINAL_SELECTION_REQUIRED");
  requireValue(!Number.isNaN(Date.parse(s.retrievedAt)) && /(?:Z|[+-]\d\d:\d\d)$/.test(s.retrievedAt),"ORIGINAL_RETRIEVAL_TIME_REQUIRED");
  requireValue(input.complete === true,"COMPLETE_SELECTED_SOURCE_REQUIRED");
  return clone(s);
}
function duplicates(rows, get) {
  const m=new Map(); for(const row of rows){const k=get(row);if(k!=="")m.set(k,(m.get(k)||0)+1);} return new Set([...m].filter(([,n])=>n>1).map(([k])=>k));
}
function index(rows,get) { const m=new Map();for(const row of rows){const k=get(row);if(!m.has(k))m.set(k,row);}return m; }
function amount(value, scale) {
  requireValue(typeof value==="string" && /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value),"DECIMAL_STRING_REQUIRED");
  requireValue(Number.isInteger(scale) && scale>=0 && scale<=8,"CURRENCY_SCALE_REQUIRED");
  const negative=value[0]==="-", parts=(negative?value.slice(1):value).split(".");
  requireValue((parts[1]||"").length<=scale,"CURRENCY_PRECISION_EXCEEDED");
  return (negative?-1n:1n)*BigInt(parts[0]+(parts[1]||"").padEnd(scale,"0"));
}
function decimal(value,scale) {
  const negative=value<0n;let s=(negative?-value:value).toString().padStart(scale+1,"0");
  return (negative?"-":"")+(scale?s.slice(0,-scale)+"."+s.slice(-scale):s);
}
function money(v,scales) {
  requireValue(v && nonblank(v.currencyCode) && own(scales,v.currencyCode),"CURRENCY_POLICY_REQUIRED");
  return {currency:v.currencyCode,scale:scales[v.currencyCode],minor:amount(v.amount,scales[v.currencyCode]),original:v.amount};
}
function issue(rows,scope,id,code,detail) { rows.push({scope,source_id:text(id),code,detail:text(detail)}); }
function report(kind,input,source,tables,summary,sha) {
  const original=clone(input), originalSha256=digest(original,sha);
  const result={schema:SCHEMA,kind,source,originalSha256,summary,tables};
  result.preparationSha256=digest(result,sha);
  return {...result,original};
}
export function buildRetail(input,sha) {
  const source=sourceDescription(input), policy=input.policy;
  requireValue(policy && policy.currencyScale && policy.transactionRoles && typeof policy.currencyScale==="object","RETAIL_POLICY_REQUIRED");
  const tx=list(input.balanceTransactions,"balanceTransactions"), payouts=list(input.payouts,"payouts"), orders=list(input.orders,"orders");
  const txdups=duplicates(tx,r=>text(r.id)), payoutdups=duplicates(payouts,r=>text(r.id)), orderdups=duplicates(orders,r=>text(r.id));
  const pi=index(payouts,r=>text(r.id)), oi=index(orders,r=>text(r.id)), problems=[], detail=[], groups=new Map(), groupsByPayout=new Map(), pendingFlags=new Map(), orderReferences=new Map();
  const row=(g)=>({payout_id:g.payoutId,currency:g.currency,test:g.test?"true":"false",transaction_count:String(g.selectedCount),parsed_net_count:String(g.count),
    contribution_net:decimal(g.contribution,g.scale),transfer_net:decimal(g.transfer,g.scale),unclassified_net:decimal(g.unknown,g.scale),
    source_payout_net:g.payoutAmount,payout_status:g.status,payout_direction:g.direction,
    arithmetic_difference:g.difference,review_state:[...g.flags].sort().join(";")||"MATCHED_SOURCE_TOTAL"});
  function group(payoutId,currency,test,scale) {
    const key=JSON.stringify([payoutId,currency,test]);
    if(!groups.has(key)){
      const value={payoutId,currency,test,scale,count:0,selectedCount:0,contribution:0n,transfer:0n,unknown:0n,flags:new Set(["PAYOUT_NOT_VALIDATED"]),payoutAmount:"",status:"",direction:"",difference:""};
      groups.set(key,value);
      if(!groupsByPayout.has(payoutId))groupsByPayout.set(payoutId,[]);
      groupsByPayout.get(payoutId).push(value);
    }
    return groups.get(key);
  }
  for(let n=0;n<tx.length;n++) {
    const t=tx[n],id=text(t.id),flags=new Set(),pid=text(t.associatedPayout?.id),orderId=text(t.associatedOrder?.id);
    if(!nonblank(t.id))flags.add("MISSING_OR_NONSTRING_TRANSACTION_ID");
    if(txdups.has(id))flags.add("DUPLICATE_TRANSACTION_ID");
    if(typeof t.test!=="boolean")flags.add("TEST_MODE_NOT_DECLARED");
    let a,f,net;
    try { a=money(t.amount,policy.currencyScale);f=money(t.fee,policy.currencyScale);net=money(t.net,policy.currencyScale);
      if(a.currency!==f.currency||a.currency!==net.currency)flags.add("ROW_CURRENCY_MISMATCH");
      if(a.currency===f.currency && a.currency===net.currency && a.minor-f.minor!==net.minor)flags.add("GROSS_FEE_NET_DIFFERENCE");
    } catch(e) {flags.add(e.code||"MONEY_INVALID");}
    const type=text(t.type),role=policy.transactionRoles[type];
    if(!["contribution","transfer"].includes(role))flags.add("TRANSACTION_TYPE_REVIEW");
    if(!pid)flags.add("UNASSIGNED_PAYOUT");
    if(pid&&!pi.has(pid))flags.add("PAYOUT_NOT_IN_SELECTED_SOURCE");
    if(payoutdups.has(pid))flags.add("DUPLICATE_PAYOUT_ID");
    if(orderId&&!oi.has(orderId))flags.add("ORDER_NOT_IN_SELECTED_SOURCE");
    if(orderdups.has(orderId))flags.add("DUPLICATE_ORDER_ID");
    if(type==="CHARGE"&&!orderId)flags.add("CHARGE_WITHOUT_ORDER_REFERENCE");
    if(t.test===true)flags.add("TEST_TRANSACTION");
    if(net) {
      const g=group(pid,net.currency,t.test===true,net.scale);g.count++;
      if(role==="contribution")g.contribution+=net.minor;else if(role==="transfer")g.transfer+=net.minor;else g.unknown+=net.minor;
      for(const flag of flags)g.flags.add(flag);
    }
    if(!net&&typeof t.net?.currencyCode==="string"&&Number.isInteger(policy.currencyScale[t.net.currencyCode])&&policy.currencyScale[t.net.currencyCode]>=0&&policy.currencyScale[t.net.currencyCode]<=8)group(pid,t.net.currencyCode,t.test===true,policy.currencyScale[t.net.currencyCode]);
    const flagKey=JSON.stringify([pid,typeof t.test==="boolean"?t.test:null]);
    if(!pendingFlags.has(flagKey))pendingFlags.set(flagKey,{flags:new Set(),counts:new Map()});
    const pending=pendingFlags.get(flagKey),currency=text(t.net?.currencyCode);
    pending.counts.set(currency,(pending.counts.get(currency)||0)+1);
    for(const flag of flags)pending.flags.add(flag);
    if(orderId)orderReferences.set(orderId,(orderReferences.get(orderId)||0)+1);
    for(const flag of flags)issue(problems,"transaction",id||"row:"+String(n+1),flag,"Retained source row "+String(n+1));
    detail.push({source_row:String(n+1),transaction_id:id,payout_id:pid,order_id:orderId,
      order_name:text(oi.get(orderId)?.name),transaction_type:type,role:role||"review",test:text(t.test),
      transaction_date:text(t.transactionDate),source_id:text(t.sourceId),source_type:text(t.sourceType),
      gross:text(t.amount?.amount),fee:text(t.fee?.amount),net:text(t.net?.amount),currency:text(t.net?.currencyCode),
      adjustment_reason:text(t.adjustmentReason),adjustments_orders_json:JSON.stringify(t.adjustmentsOrders||[]),
      review_state:[...flags].sort().join(";")||"SOURCE_LINKED"});
  }
  for(const p of payouts) {
    const id=text(p.id);let m;
    if(!nonblank(p.id))issue(problems,"payout",id,"MISSING_OR_NONSTRING_PAYOUT_ID","");
    try{m=money(p.net,policy.currencyScale);}catch(e){issue(problems,"payout",id,e.code||"MONEY_INVALID","");continue;}
    const matching=(groupsByPayout.get(id)||[]).filter(g=>!g.test);
    if(!matching.length){const g=group(id,m.currency,false,m.scale);g.flags.add("PAYOUT_WITHOUT_SELECTED_TRANSACTIONS");matching.push(g);}
    for(const g of matching) {
      g.flags.delete("PAYOUT_NOT_VALIDATED");g.payoutAmount=m.original;g.status=text(p.status);g.direction=text(p.transactionType);
      if(payoutdups.has(id))g.flags.add("DUPLICATE_PAYOUT_ID");
      if(g.currency!==m.currency)g.flags.add("PAYOUT_CURRENCY_MISMATCH");
      if(p.transactionType!=="DEPOSIT")g.flags.add("PAYOUT_DIRECTION_REVIEW");
      if(p.status!=="PAID")g.flags.add("PAYOUT_STATUS_REVIEW");
      if(g.currency===m.currency){g.difference=decimal(g.contribution-m.minor,g.scale);if(g.contribution!==m.minor)g.flags.add("PAYOUT_NET_DIFFERENCE");}
      for(const flag of g.flags)issue(problems,"payout",id,flag,g.currency);
    }
  }
  for(const g of groups.values())if(!pi.has(g.payoutId)&&g.payoutId)g.flags.add("PAYOUT_NOT_IN_SELECTED_SOURCE");
  for(const g of groups.values())for(const mode of [g.test,null]) {
    const pending=pendingFlags.get(JSON.stringify([g.payoutId,mode]));
    if(pending){
      g.selectedCount+=(pending.counts.get(g.currency)||0)+(pending.counts.get("")||0);
      for(const flag of pending.flags)g.flags.add(flag);
    }
  }
  const summaries=[...groups.values()].map(row).sort((a,b)=>(canonical([a.payout_id,a.currency,a.test])<canonical([b.payout_id,b.currency,b.test])?-1:canonical([a.payout_id,a.currency,a.test])>canonical([b.payout_id,b.currency,b.test])?1:0));
  const orderRows=orders.map((o,n)=>({source_row:String(n+1),order_id:text(o.id),name:text(o.name),
    transaction_references:String(orderReferences.get(text(o.id))||0),
    review_state:!o.id?"MISSING_ORDER_ID":orderdups.has(text(o.id))?"DUPLICATE_ORDER_ID":orderReferences.has(text(o.id))?"SOURCE_REFERENCED":"NO_SELECTED_PAYMENT_REFERENCE"}));
  for(const r of orderRows)if(r.review_state!=="SOURCE_REFERENCED")issue(problems,"order",r.order_id,r.review_state,"Review the selected source window and gateway; an order is not automatically payable.");
  return report("retail-payout-reconciliation",input,source,{transactions:detail,payouts:summaries,orders:orderRows,exceptions:problems},
    {transactions:tx.length,payouts:payouts.length,orders:orders.length,exceptions:problems.length,matchedSourceTotals:summaries.filter(g=>g.review_state==="MATCHED_SOURCE_TOTAL").length},sha);
}
function externalId(namespace,kind,id,sha) { return namespace+"."+kind+"_"+sha(id); }
export function buildContacts(input,sha) {
  const source=sourceDescription(input),namespace=requiredString(input.namespace,"namespace");
  requireValue(/^[a-z][a-z0-9_]{0,39}$/.test(namespace),"MIGRATION_NAMESPACE_INVALID");
  const companies=list(input.companies,"companies"),people=list(input.people,"people"),existing=list(input.targetExisting,"targetExisting");
  const dcompanies=duplicates(companies,r=>text(r.sourceId)),dpeople=duplicates(people,r=>text(r.sourceId)),dexisting=duplicates(existing,r=>text(r.externalId));
  const companyIndex=index(companies,r=>text(r.sourceId)),targetIndex=index(existing,r=>text(r.externalId)),problems=[],mapped=[];
  const ownedFields=input.fields||["name","email","phone"];
  requireValue(Array.isArray(ownedFields)&&ownedFields.includes("name")&&ownedFields.every(f=>["name","email","phone"].includes(f))&&new Set(ownedFields).size===ownedFields.length,"OWNED_CONTACT_FIELDS_INVALID");
  for(const [kind,rows,dups] of [["company",companies,dcompanies],["person",people,dpeople]])for(let n=0;n<rows.length;n++){
    const r=rows[n],id=text(r.sourceId),flags=new Set(),eid=nonblank(r.targetExternalId)?r.targetExternalId:externalId(namespace,kind,id,sha);
    if(!nonblank(r.sourceId))flags.add("MISSING_OR_NONSTRING_SOURCE_ID");
    if(dups.has(id))flags.add("DUPLICATE_SOURCE_ID");
    if(!nonblank(r.name))flags.add("MISSING_NAME");
    if(!/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(eid))flags.add("EXTERNAL_ID_INVALID");
    if(dexisting.has(eid))flags.add("DUPLICATE_TARGET_EXTERNAL_ID");
    const target=targetIndex.get(eid);
    if(target&&target.kind!==kind)flags.add("TARGET_KIND_MISMATCH");
    if(r.targetExternalId&&!target)flags.add("MAPPED_TARGET_NOT_IN_EXPORTED_BASELINE");
    if(input.targetBaselineComplete!==true)flags.add("TARGET_BASELINE_INCOMPLETE");
    let parent="";
    const parentSupplied=own(r,"companySourceId"),baselineParent=target&&own(target,"parentExternalId")?text(target.parentExternalId):"";
    if(target&&!own(target,"parentExternalId"))flags.add("TARGET_PARENT_BASELINE_REQUIRED");
    if(!parentSupplied&&target)parent=baselineParent;
    else if(parentSupplied&&!nonblank(r.companySourceId)) {
      if(target&&baselineParent&&!(r.clearFields||[]).includes("parent")) {
        flags.add("EXPLICIT_CLEAR_REVIEW_PARENT");parent=baselineParent;
      }
    } else if(parentSupplied&&nonblank(r.companySourceId)) {
      if(kind==="company")flags.add("COMPANY_HIERARCHY_REVIEW");
      const p=companyIndex.get(r.companySourceId);
      if(!p)flags.add("PARENT_COMPANY_NOT_IN_SOURCE");
      else {parent=nonblank(p.targetExternalId)?p.targetExternalId:externalId(namespace,"company",r.companySourceId,sha);if(dcompanies.has(r.companySourceId))flags.add("AMBIGUOUS_PARENT_SOURCE");}
    }
    if(!parentSupplied&&parent&&(!targetIndex.has(parent)||targetIndex.get(parent).kind!=="company"))flags.add("PRESERVED_PARENT_NOT_IN_TARGET_BASELINE");
    if(!parentSupplied&&parent&&dexisting.has(parent))flags.add("AMBIGUOUS_PRESERVED_PARENT");
    const fields={name:text(r.name).trim()};
    for(const f of ownedFields.filter(x=>x!=="name")){
      const has=own(r,f);
      if(!has && target) {requireValue(own(target,f),"TARGET_BASELINE_FIELD_REQUIRED",eid+":"+f);fields[f]=text(target[f]);}
      else fields[f]=has?text(r[f]).trim():"";
      if(has && fields[f]==="" && target && text(target[f])!=="" && !(r.clearFields||[]).includes(f)) {
        flags.add("EXPLICIT_CLEAR_REVIEW_"+f.toUpperCase());fields[f]=text(target[f]);
      }
    }
    mapped.push({source_row:String(n+1),source_id:id,kind,external_id:eid,parent_external_id:parent,
      action:target?"UPDATE":"CREATE",...fields,flags,source_record:r});
  }
  const dupeExternal=duplicates(mapped,r=>r.external_id);
  for(const r of mapped)if(dupeExternal.has(r.external_id))r.flags.add("DUPLICATE_MAPPED_EXTERNAL_ID");
  const byExternal=index(mapped,r=>r.external_id);
  for(const r of mapped)if(r.kind==="person"&&r.parent_external_id&&byExternal.get(r.parent_external_id)?.flags.size)r.flags.add("PARENT_COMPANY_REQUIRES_REVIEW");
  for(const r of mapped)for(const flag of r.flags)issue(problems,r.kind,r.source_id,flag,r.external_id);
  const review=mapped.map(({flags,source_record,...r})=>({...r,review_state:[...flags].sort().join(";")||"READY"}));
  const headers=["External ID","Name","Is a Company","Related Company/External ID",...ownedFields.filter(x=>x!=="name").map(x=>x[0].toUpperCase()+x.slice(1))];
  function imports(kind){return mapped.filter(r=>r.kind===kind&&!r.flags.size).map(r=>{
    const v={"External ID":r.external_id,"Name":r.name,"Is a Company":kind==="company"?"True":"False","Related Company/External ID":r.parent_external_id};
    for(const f of ownedFields.filter(x=>x!=="name"))v[f[0].toUpperCase()+f.slice(1)]=r[f];return v;});}
  const companyRows=imports("company"),peopleRows=imports("person");
  const reconciliation=[];
  if(input.targetAfter!==undefined) {
    const after=input.targetAfter;
    requireValue(after&&after.complete===true&&nonblank(after.receivedAt)&&!Number.isNaN(Date.parse(after.receivedAt)),"COMPLETE_TARGET_AFTER_REQUIRED");
    requireValue(nonblank(input.targetScope)&&after.scope===input.targetScope,"TARGET_SCOPE_CHANGED");
    requireValue(after.source&&nonblank(after.source.url)&&nonblank(after.source.description)&&after.nativeResult&&typeof after.nativeResult==="object","ORIGINAL_NATIVE_TARGET_RESULT_REQUIRED");
    const actual=list(after.rows,"targetAfter.rows"),adups=duplicates(actual,r=>text(r.externalId)),ai=index(actual,r=>text(r.externalId));
    const planned=mapped.filter(r=>!r.flags.size),plannedIDs=new Set(planned.map(r=>r.external_id));
    for(const r of planned) {
      const a=ai.get(r.external_id),differences=[];
      if(!a)differences.push("TARGET_RECORD_MISSING");
      else {
        if(adups.has(r.external_id))differences.push("DUPLICATE_TARGET_EXTERNAL_ID");
        if(a.kind!==r.kind)differences.push("KIND_CHANGED");
        if(!own(a,"parentExternalId")||text(a.parentExternalId)!==r.parent_external_id)differences.push("PARENT_RELATION_CHANGED_OR_UNEXPORTED");
        for(const f of ownedFields)if(!own(a,f)||text(a[f])!==r[f])differences.push("FIELD_"+f.toUpperCase()+"_CHANGED_OR_UNEXPORTED");
      }
      const state=differences.length?differences.join(";"):"MATCHED_IMPORTED_FIELDS";
      reconciliation.push({source_id:r.source_id,external_id:r.external_id,kind:r.kind,expected_parent:r.parent_external_id,
        actual_parent:a?text(a.parentExternalId):"",action:r.action,review_state:state,
        expected_fields_json:JSON.stringify(Object.fromEntries(ownedFields.map(f=>[f,r[f]]))),
        actual_fields_json:a?JSON.stringify(Object.fromEntries(ownedFields.filter(f=>own(a,f)).map(f=>[f,a[f]]))):""});
      for(const code of differences)issue(problems,"target-result",r.source_id,code,r.external_id);
    }
    for(const a of actual) {
      const id=text(a.externalId);
      if(!id||(!plannedIDs.has(id)&&!targetIndex.has(id)))issue(problems,"target-result",id,"UNEXPECTED_TARGET_RECORD","Review this complete selected target export against the original baseline and import files.");
    }
    for(const b of existing)if(!ai.has(text(b.externalId)))issue(problems,"target-result",b.externalId,"BASELINE_RECORD_MISSING","Original selected target baseline record is absent after the operation.");
  }
  return report("odoo-contact-import-preparation",input,source,{mapping:review,exceptions:problems,companies:companyRows,people:peopleRows,reconciliation},
    {companies:companies.length,people:people.length,readyCompanies:companyRows.length,readyPeople:peopleRows.length,
      exceptionRows:review.filter(r=>r.review_state!=="READY").length,importHeaders:headers,ownedFields,
      nativeImportOrder:["companies","people"],targetBaselineComplete:input.targetBaselineComplete===true,targetResultReceived:input.targetAfter!==undefined,targetMatchedRows:reconciliation.filter(r=>r.review_state==="MATCHED_IMPORTED_FIELDS").length},sha);
}
export function csv(rows,columns) {
  requireValue(Array.isArray(columns)&&columns.length&&columns.every(nonblank),"CSV_COLUMNS_REQUIRED");
  const q=v=>'"'+text(v).replace(/"/g,'""')+'"';
  return [columns.map(q).join(","),...rows.map(r=>columns.map(c=>q(r[c])).join(","))].join("\r\n")+"\r\n";
}
function escapeHTML(value){return text(value).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));}
export function renderReport(result) {
  const tables=Object.entries(result.tables).map(([name,rows])=>{
    const columns=rows.length?Object.keys(rows[0]):[];
    return "<section><h2>"+escapeHTML(name)+" <small>"+rows.length+" rows</small></h2>"+(columns.length?"<div class=\"scroll\"><table><thead><tr>"+columns.map(c=>"<th>"+escapeHTML(c)+"</th>").join("")+"</tr></thead><tbody>"+rows.map(r=>"<tr>"+columns.map(c=>"<td>"+escapeHTML(r[c])+"</td>").join("")+"</tr>").join("")+"</tbody></table></div>":"<p>No rows in this selected output.</p>")+"</section>";
  }).join("");
  return '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>'+escapeHTML(result.kind)+'</title><style>body{font:15px system-ui,sans-serif;max-width:1440px;margin:32px auto;padding:0 24px;color:#202020;background:#fafafa}h1{font-size:26px}h2{font-size:19px;margin-top:32px}small{font-size:13px;font-weight:400}.scroll{overflow:auto;border:1px solid #bbb}table{border-collapse:collapse;background:white;min-width:100%}th,td{padding:8px 10px;border:1px solid #ddd;text-align:left;vertical-align:top;white-space:pre-wrap}th{background:#eee}code{overflow-wrap:anywhere}p{line-height:1.5}</style><h1>'+escapeHTML(result.kind)+'</h1><p>'+escapeHTML(result.source.title)+' · '+escapeHTML(result.source.publisher)+'</p><p>Selected source: '+escapeHTML(result.source.selection)+'<br>Original retrieval: '+escapeHTML(result.source.retrievedAt)+'</p><p>Review the retained source and individual exceptions. Import files contain the declared fields; an Odoo operator reviews the selected database and native import result. Payout comparisons describe the selected source totals and retain the actual payout status.</p><p>Preparation: <code>'+escapeHTML(result.preparationSha256)+'</code></p>'+tables+'</html>';
}
