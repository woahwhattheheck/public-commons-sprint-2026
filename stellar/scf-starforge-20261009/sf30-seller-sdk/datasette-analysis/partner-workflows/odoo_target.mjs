/** Read-only Odoo JSON-2 target acquisition for the existing contact preparation. */
import {canonical} from "./preparation.mjs";
export const CAPTURE_SCHEMA="stellar-forge.odoo-target-capture.v1";
export const SOURCE_SCHEMA="stellar-forge.odoo-target-source.v1";
export const DOCUMENTATION=[
 "https://www.odoo.com/documentation/19.0/developer/reference/external_api.html",
 "https://www.odoo.com/documentation/19.0/developer/reference/backend/orm.html",
 "https://www.odoo.com/documentation/19.0/applications/essentials/export_import_data.html",
 "https://github.com/odoo/odoo/blob/19.0/odoo/addons/base/models/ir_model.py",
 "https://github.com/odoo/odoo/blob/19.0/odoo/addons/base/models/res_partner.py"
];
export const PARTNER_FIELDS=["id","name","email","phone","is_company","parent_id","company_id","active","write_date"];
export const ALIAS_FIELDS=["id","module","name","model","res_id","noupdate"];
const clone=value=>JSON.parse(JSON.stringify(value));
const object=value=>value!==null&&typeof value==="object"&&!Array.isArray(value);
const text=value=>typeof value==="string"&&value.trim().length>0;
const own=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
const fail=(code,detail)=>{const e=new Error(code);e.code=code;e.detail=detail;throw e;};
const need=(ok,code,detail)=>{if(!ok)fail(code,detail);};
const integer=value=>Number.isSafeInteger(value)&&value>0;
const sorted=value=>[...new Set(value)].sort((a,b)=>a-b);
const date=value=>typeof value==="string"&&/(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value));
const digest=(value,sha)=>{const result=sha(canonical(value));need(/^[a-f0-9]{64}$/.test(result),"SHA256_REQUIRED");return result;};
function external(value){need(typeof value==="string"&&value.indexOf(".")>0&&value.indexOf(".")<value.length-1,"EXTERNAL_ID_REQUIRED",value);return value;}
const importableAlias=value=>typeof value==="string"&&/^[A-Za-z0-9_][A-Za-z0-9_.-]*$/.test(value);
function externalParts(value){external(value);const at=value.indexOf(".");return[value.slice(0,at),value.slice(at+1)];}
export function selection(value){
 need(object(value),"TARGET_SELECTION_REQUIRED");
 const result=clone(value),allowed=["origin","database","expectedVersion","expectedUserId","allowedCompanyIds","namespace","externalIdModules",
  "explicitExternalIds","parentAliases","parentAliasPolicy","pageSize","operationId","title","publisher"];
 need(Object.keys(result).every(k=>allowed.includes(k)),"UNKNOWN_TARGET_SELECTION_FIELD");
 let url;try{url=new URL(result.origin);}catch{fail("ORIGINAL_HTTPS_ORIGIN_REQUIRED");}
 need(url.protocol==="https:"&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==="/",
  "ORIGINAL_HTTPS_ORIGIN_REQUIRED");
 result.origin=url.origin;
 need(text(result.database)&&result.database.length<=256&&!/[\u0000-\u001f\u007f]/.test(result.database),"ORIGINAL_DATABASE_REQUIRED");
 need(text(result.expectedVersion)&&result.expectedVersion.length<=80,"ORIGINAL_SERVER_VERSION_REQUIRED");
 need(integer(result.expectedUserId),"ORIGINAL_USER_ID_REQUIRED");
 need(Array.isArray(result.allowedCompanyIds)&&result.allowedCompanyIds.length>0&&
  result.allowedCompanyIds.every(integer)&&new Set(result.allowedCompanyIds).size===result.allowedCompanyIds.length,
  "EXPLICIT_ORDERED_COMPANY_SCOPE_REQUIRED");
 need(typeof result.namespace==="string"&&/^[a-z][a-z0-9_]{0,39}$/.test(result.namespace),"MIGRATION_NAMESPACE_INVALID");
 need(Array.isArray(result.externalIdModules)&&result.externalIdModules.includes(result.namespace)&&
  result.externalIdModules.every(v=>text(v)&&!v.includes("."))&&
  new Set(result.externalIdModules).size===result.externalIdModules.length,"EXTERNAL_ID_MODULE_SCOPE_REQUIRED");
 result.externalIdModules.sort();
 result.explicitExternalIds=result.explicitExternalIds??[];
 need(Array.isArray(result.explicitExternalIds),"EXPLICIT_EXTERNAL_IDS_ARRAY_REQUIRED");
 result.explicitExternalIds=[...new Set(result.explicitExternalIds.map(external))].sort();
 need(result.parentAliasPolicy==="lexical-existing","EXPLICIT_PARENT_ALIAS_POLICY_REQUIRED");
 result.parentAliases=result.parentAliases??{};
 need(object(result.parentAliases),"PARENT_ALIAS_OVERRIDES_REQUIRED");
 for(const [id,value] of Object.entries(result.parentAliases)){
  need(/^[1-9][0-9]*$/.test(id)&&integer(Number(id)),"PARENT_ID_REQUIRED",id);external(value);
 }
 result.pageSize=result.pageSize??200;
 need(Number.isInteger(result.pageSize)&&result.pageSize>=1&&result.pageSize<=1000,"PAGE_SIZE_RANGE");
 need(text(result.operationId)&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(result.operationId),"ORIGINAL_OPERATION_ID_REQUIRED");
 need(text(result.title)&&result.title.length<=300,"SOURCE_TITLE_REQUIRED");
 if(result.publisher!=null)need(text(result.publisher)&&result.publisher.length<=300,"SOURCE_PUBLISHER_INVALID");
 return result;
}
function scope(selection){
 const {origin,database,expectedVersion,expectedUserId,allowedCompanyIds,namespace,externalIdModules,explicitExternalIds,parentAliases,parentAliasPolicy}=selection;
 return {origin,database,expectedVersion,expectedUserId,allowedCompanyIds,namespace,externalIdModules,explicitExternalIds,parentAliases,parentAliasPolicy};
}
function emptyPass(number){return {number,version:null,identity:null,user:null,companies:null,partnerSchema:null,aliasSchema:null,receipts:[],
 selected:{upper:null,last:0,pages:[],resIds:[]},partners:{queue:[],visited:[],found:[],pages:[]},
 aliases:{groups:[],group:0,upper:null,last:0,pages:[]},summary:null};}
export function createCapture(config,sha,createdAt){
 const selected=selection(config);need(date(createdAt),"ACTUAL_TIME_REQUIRED");
 return {schema:CAPTURE_SCHEMA,operationId:selected.operationId,selection:selected,selectionSha256:digest(selected,sha),
  targetScope:"odoo:"+digest(scope(selected),sha),createdAt,updatedAt:createdAt,status:"acquiring",
  phase:"version",currentPass:1,passes:[emptyPass(1)],result:null};
}
export function validateCapture(state,sha){
 need(object(state)&&state.schema===CAPTURE_SCHEMA,"TARGET_CAPTURE_STATE_REQUIRED");
 const s=selection(state.selection);
 need(state.operationId===s.operationId&&state.selectionSha256===digest(s,sha)&&
  state.targetScope==="odoo:"+digest(scope(s),sha),"TARGET_SELECTION_CHANGED");
 need(["acquiring","complete"].includes(state.status)&&Number.isSafeInteger(state.currentPass)&&state.currentPass>0&&
  Array.isArray(state.passes)&&state.passes.length===state.currentPass,"TARGET_CAPTURE_STATE_INVALID");
 return state;
}
function context(s){return {allowed_company_ids:s.allowedCompanyIds,active_test:false};}
function selectedDomain(s){
 const alternatives=[["module","in",s.externalIdModules],...s.explicitExternalIds.map(value=>{
  const [module,name]=externalParts(value);return ["&",["module","=",module],["name","=",name]];
 })];
 const tokens=[...Array(Math.max(0,alternatives.length-1)).fill("|"),...alternatives.flatMap(a=>a[0]==="&"?a:[a])];
 return [["model","=","res.partner"],...tokens];
}
function aliasDomain(ids){return [["model","=","res.partner"],["res_id","in",ids]];}
function request(state,phase,model,method,body,sha){
 const value={phase,pass:state.currentPass,model,method,httpMethod:phase==="version"?"GET":"POST",
  endpoint:state.selection.origin+(phase==="version"?"/web/version":"/json/2/"+model+"/"+method),
  database:state.selection.database,body,selectionSha256:state.selectionSha256};
 return {...value,id:digest(value,sha)};
}
export function nextRequest(state,sha){
 validateCapture(state,sha);need(state.status==="acquiring"&&state.phase!=="summarize","NEXT_TARGET_REQUEST_UNAVAILABLE");
 const p=state.passes.at(-1),s=state.selection,c=context(s);let model,method="search_read",body;
 switch(state.phase){
 case "version":model=null;method=null;body={};break;
 case "identify":model="res.users";method="context_get";body={};break;
 case "user":model="res.users";body={domain:[["id","=",s.expectedUserId]],fields:["id","login","active","company_id","company_ids"],limit:1,context:c};break;
 case "companies":model="res.company";body={domain:[["id","in",s.allowedCompanyIds]],fields:["id","name"],order:"id asc",limit:s.allowedCompanyIds.length,context:c};break;
 case "partner-schema":model="res.partner";method="fields_get";body={allfields:PARTNER_FIELDS,attributes:["type","relation","readonly","string"],context:c};break;
 case "alias-schema":model="ir.model.data";method="fields_get";body={allfields:ALIAS_FIELDS,attributes:["type","relation","readonly","string"],context:c};break;
 case "selected-anchor":model="ir.model.data";body={domain:selectedDomain(s),fields:["id"],order:"id desc",limit:1,context:c};break;
 case "selected-pages":model="ir.model.data";body={domain:[...selectedDomain(s),["id",">",p.selected.last],["id","<=",p.selected.upper]],fields:ALIAS_FIELDS,order:"id asc",limit:s.pageSize,context:c};break;
 case "partners":model="res.partner";body={domain:[["id","in",p.partners.queue.slice(0,s.pageSize)]],fields:PARTNER_FIELDS,order:"id asc",limit:s.pageSize,context:c};break;
 case "aliases-anchor":model="ir.model.data";body={domain:aliasDomain(p.aliases.groups[p.aliases.group]),fields:["id"],order:"id desc",limit:1,context:c};break;
 case "aliases-pages":model="ir.model.data";body={domain:[...aliasDomain(p.aliases.groups[p.aliases.group]),["id",">",p.aliases.last],["id","<=",p.aliases.upper]],fields:ALIAS_FIELDS,order:"id asc",limit:s.pageSize,context:c};break;
 default:fail("TARGET_PHASE_INVALID",state.phase);
 }
 return request(state,state.phase,model,method,body,sha);
}
export function checkResponse(request,envelope){
 need(object(envelope)&&envelope.status===200,"ODOO_HTTP_RESPONSE_REQUIRED",{status:envelope?.status,phase:request.phase});
 const body=envelope.body;
 need(body!==null&&typeof body==="object"&&!object(body.error),"ODOO_JSON2_RESPONSE_ERROR",
  object(body)?{name:body.name??body.error?.name,message:body.message??body.error?.message}:null);
 if(["version","identify","partner-schema","alias-schema"].includes(request.phase))need(object(body),"ODOO_OBJECT_RESPONSE_REQUIRED",request.phase);
 else need(Array.isArray(body),"ODOO_ARRAY_RESPONSE_REQUIRED",request.phase);
 return body;
}
function m2o(value,label){
 if(value===false||value===null)return null;
 need(Array.isArray(value)&&value.length===2&&integer(value[0])&&typeof value[1]==="string","ODOO_MANY2ONE_SHAPE",label);
 return value[0];
}
function rows(value,fields){
 need(Array.isArray(value),"ODOO_ROWS_REQUIRED");const seen=new Set();
 for(const r of value){need(object(r)&&fields.every(k=>own(r,k))&&integer(r.id)&&!seen.has(r.id),"ODOO_RECORD_FIELDS_OR_ID",r?.id);seen.add(r.id);}
 return value;
}
function alias(row){
 rows([row],ALIAS_FIELDS);need(row.model==="res.partner"&&integer(row.res_id)&&typeof row.module==="string"&&
  typeof row.name==="string"&&typeof row.noupdate==="boolean","ODOO_EXTERNAL_ID_RECORD",row.id);
 external(row.module+"."+row.name);return row;
}
function partner(row){
 rows([row],PARTNER_FIELDS);
 for(const name of ["name","email","phone"])need(row[name]===false||row[name]===null||typeof row[name]==="string","ODOO_CONTACT_FIELD",name);
 need(typeof row.is_company==="boolean"&&typeof row.active==="boolean"&&
  (row.write_date===false||typeof row.write_date==="string"),"ODOO_CONTACT_RECORD",row.id);
 m2o(row.parent_id,"parent_id");m2o(row.company_id,"company_id");return row;
}
function validateSchema(body,expected){
 for(const [name,type,relation] of expected){
  need(object(body[name])&&body[name].type===type&&(!relation||body[name].relation===relation),
   "ODOO_TARGET_SCHEMA_CHANGED",{field:name,expected:type,actual:body[name]});
 }
}
function finishSelected(state,p){
 p.partners.queue=sorted(p.selected.resIds);
 state.phase=p.partners.queue.length?"partners":"summarize";
}
function finishPartners(state,p){
 const ids=sorted(p.partners.found);
 for(let i=0;i<ids.length;i+=state.selection.pageSize)p.aliases.groups.push(ids.slice(i,i+state.selection.pageSize));
 state.phase=p.aliases.groups.length?"aliases-anchor":"summarize";
}
function finishAliasGroup(state,p){
 p.aliases.group++;p.aliases.upper=null;p.aliases.last=0;
 state.phase=p.aliases.group<p.aliases.groups.length?"aliases-anchor":"summarize";
}
export function acceptResponse(original,pending,envelope,receipt,sha,receivedAt){
 validateCapture(original,sha);need(canonical(pending)===canonical(nextRequest(original,sha)),"ORIGINAL_TARGET_REQUEST_CHANGED");
 need(receipt&&typeof receipt.path==="string"&&Number.isSafeInteger(receipt.bytes)&&/^[a-f0-9]{64}$/.test(receipt.sha256)&&date(receivedAt),
  "ORIGINAL_TARGET_RECEIPT_REQUIRED");
 const body=checkResponse(pending,envelope),state=clone(original),p=state.passes.at(-1),s=state.selection;
 p.receipts.push({...receipt,phase:pending.phase});state.updatedAt=receivedAt;
 switch(pending.phase){
 case "version":
  need(body.version===s.expectedVersion&&Array.isArray(body.version_info)&&Number.isInteger(body.version_info[0])&&body.version_info[0]>=19,
   "ODOO_ORIGINAL_SERVER_VERSION_CHANGED",{expected:s.expectedVersion,actual:body.version});
  p.version=clone(body);state.phase="identify";break;
 case "identify":
  need(body.uid===s.expectedUserId,"ODOO_AUTHENTICATED_USER_CHANGED",{expected:s.expectedUserId,actual:body.uid});
  p.identity=clone(body);state.phase="user";break;
 case "user":
  rows(body,["id","login","active","company_id","company_ids"]);
  need(body.length===1&&body[0].id===s.expectedUserId&&body[0].active===true&&typeof body[0].login==="string"&&
   Array.isArray(body[0].company_ids)&&s.allowedCompanyIds.every(id=>body[0].company_ids.includes(id)),
   "ODOO_ORIGINAL_USER_COMPANY_BINDING");
  m2o(body[0].company_id,"user.company_id");p.user=clone(body[0]);state.phase="companies";break;
 case "companies":
  rows(body,["id","name"]);
  need(canonical(sorted(body.map(r=>r.id)))===canonical(sorted(s.allowedCompanyIds))&&body.every(r=>typeof r.name==="string"),
   "ODOO_SELECTED_COMPANIES_NOT_VISIBLE");
  p.companies=clone(body);state.phase="partner-schema";break;
 case "partner-schema":
  validateSchema(body,[["id","integer"],["name","char"],["email","char"],["phone","char"],["is_company","boolean"],
   ["parent_id","many2one","res.partner"],["company_id","many2one","res.company"],["active","boolean"],["write_date","datetime"]]);
  p.partnerSchema=clone(body);state.phase="alias-schema";break;
 case "alias-schema":
  validateSchema(body,[["id","integer"],["module","char"],["name","char"],["model","char"],["res_id","many2one_reference"],["noupdate","boolean"]]);
  p.aliasSchema=clone(body);state.phase="selected-anchor";break;
 case "selected-anchor":
  rows(body,["id"]);need(body.length<=1,"ODOO_ANCHOR_RESPONSE_LENGTH");
  p.selected.upper=body[0]?.id??0;
  if(p.selected.upper===0)finishSelected(state,p);else state.phase="selected-pages";break;
 case "selected-pages":
  rows(body,ALIAS_FIELDS);need(body.length<=s.pageSize,"ODOO_PAGE_LIMIT_CHANGED");
  for(const row of body){
   alias(row);need(row.id>p.selected.last&&row.id<=p.selected.upper,"ODOO_SELECTED_ID_BOUND");
   need(s.externalIdModules.includes(row.module)||s.explicitExternalIds.includes(row.module+"."+row.name),"ODOO_SELECTED_DOMAIN_CHANGED");
   p.selected.last=row.id;p.selected.resIds.push(row.res_id);
  }
  p.selected.pages.push(clone(receipt));
  if(body.length===0||p.selected.last===p.selected.upper)finishSelected(state,p);break;
 case "partners":{
  rows(body,PARTNER_FIELDS);const requested=p.partners.queue.splice(0,s.pageSize),seen=new Set(p.partners.visited);
  for(const id of requested){need(!seen.has(id),"ODOO_PARTNER_REPEATED");p.partners.visited.push(id);seen.add(id);}
  for(const row of body){partner(row);need(requested.includes(row.id),"ODOO_PARTNER_DOMAIN_CHANGED");
   p.partners.found.push(row.id);
   const parent=m2o(row.parent_id,"parent_id");
   if(parent&&!seen.has(parent)&&!p.partners.queue.includes(parent))p.partners.queue.push(parent);
  }
  p.partners.pages.push(clone(receipt));
  if(!p.partners.queue.length)finishPartners(state,p);break;
 }
 case "aliases-anchor":
  rows(body,["id"]);need(body.length<=1,"ODOO_ANCHOR_RESPONSE_LENGTH");
  p.aliases.upper=body[0]?.id??0;
  if(p.aliases.upper===0)finishAliasGroup(state,p);else state.phase="aliases-pages";break;
 case "aliases-pages":
  rows(body,ALIAS_FIELDS);need(body.length<=s.pageSize,"ODOO_PAGE_LIMIT_CHANGED");
  for(const row of body){
   alias(row);need(row.id>p.aliases.last&&row.id<=p.aliases.upper&&p.aliases.groups[p.aliases.group].includes(row.res_id),"ODOO_PARENT_ALIAS_DOMAIN_CHANGED");
   p.aliases.last=row.id;
  }
  p.aliases.pages.push(clone(receipt));
  if(body.length===0||p.aliases.last===p.aliases.upper)finishAliasGroup(state,p);break;
 }
 return state;
}
async function collect(refs,read){
 const result=[];for(const ref of refs){const body=await read(ref);need(Array.isArray(body),"RETAINED_ODOO_ROWS_REQUIRED");result.push(...body);}return result;
}
export async function summarizePass(original,read,sha,completedAt){
 validateCapture(original,sha);need(original.phase==="summarize"&&date(completedAt),"COMPLETE_TARGET_PASS_REQUIRED");
 const state=clone(original),p=state.passes.at(-1),s=state.selection;
 const selected=await collect(p.selected.pages,read),partners=await collect(p.partners.pages,read),allAliases=await collect(p.aliases.pages,read);
 const issues=[],unrepresentableAliases=[],byId=new Map(),byAlias=new Map(),aliasesByPartner=new Map();
 for(const row of partners){partner(row);need(!byId.has(row.id),"REPEATED_TARGET_PARTNER");byId.set(row.id,row);}
 for(const row of allAliases){
  alias(row);const value=row.module+"."+row.name;
  if(!importableAlias(value))unrepresentableAliases.push({externalId:value,partnerId:row.res_id,aliasId:row.id,code:"ORIGINAL_PREPARER_EXTERNAL_ID_FORMAT"});
  if(byAlias.has(value)&&byAlias.get(value).res_id!==row.res_id)issues.push({code:"TARGET_ALIAS_COLLISION",externalId:value});
  byAlias.set(value,row);
  if(!aliasesByPartner.has(row.res_id))aliasesByPartner.set(row.res_id,[]);
  aliasesByPartner.get(row.res_id).push(value);
 }
 for(const row of selected){
  alias(row);const value=row.module+"."+row.name;
  if(!importableAlias(value))issues.push({code:"SELECTED_ALIAS_REQUIRES_MAPPING_REVIEW",externalId:value,partnerId:row.res_id});
  if(!byId.has(row.res_id))issues.push({code:"SELECTED_PARTNER_NOT_VISIBLE",externalId:value,partnerId:row.res_id});
  if(!byAlias.has(value)||canonical(byAlias.get(value))!==canonical(row))issues.push({code:"SELECTED_ALIAS_CHANGED_DURING_PASS",externalId:value});
 }
 for(const value of s.explicitExternalIds)if(!selected.some(row=>row.module+"."+row.name===value))
  issues.push({code:"EXPLICIT_TARGET_ID_NOT_OBSERVED",externalId:value});
 for(const [id,value] of Object.entries(s.parentAliases))if(!byAlias.has(value)||byAlias.get(value).res_id!==Number(id))
  issues.push({code:"PARENT_ALIAS_OVERRIDE_NOT_OBSERVED",partnerId:Number(id),externalId:value});
 const projected=[];
 for(const row of partners){
  const retainedAliases=[...new Set(aliasesByPartner.get(row.id)||[])].sort(),ids=retainedAliases.filter(importableAlias),parent=m2o(row.parent_id,"parent_id");
  const company=m2o(row.company_id,"company_id");
  if(company&&!s.allowedCompanyIds.includes(company))issues.push({code:"PARTNER_OUTSIDE_SELECTED_COMPANY",partnerId:row.id,companyId:company});
  let parentExternalId="";
  if(parent){
   const candidates=[...new Set(aliasesByPartner.get(parent)||[])].filter(importableAlias).sort();
   if(!byId.has(parent))issues.push({code:"PARENT_PARTNER_NOT_VISIBLE",partnerId:row.id,parentId:parent});
   else if(!candidates.length)issues.push({code:"PARENT_WITHOUT_EXISTING_EXTERNAL_ID",partnerId:row.id,parentId:parent});
   else {
    parentExternalId=s.parentAliases[String(parent)]??candidates[0];
    if(!importableAlias(parentExternalId)){issues.push({code:"PARENT_ALIAS_REQUIRES_MAPPING_REVIEW",partnerId:row.id,parentId:parent,externalId:parentExternalId});parentExternalId="";}
   }
  }
  for(const externalId of ids)projected.push({externalId,kind:row.is_company?"company":"person",parentExternalId,
   name:typeof row.name==="string"?row.name:"",email:typeof row.email==="string"?row.email:"",
   phone:typeof row.phone==="string"?row.phone:"",partnerId:row.id,parentPartnerId:parent,companyId:company,
   active:row.active,writeDate:row.write_date,aliases:retainedAliases});
 }
 projected.sort((a,b)=>a.externalId.localeCompare(b.externalId,"en"));
 selected.sort((a,b)=>a.id-b.id);partners.sort((a,b)=>a.id-b.id);allAliases.sort((a,b)=>a.id-b.id);
 issues.sort((a,b)=>canonical(a).localeCompare(canonical(b),"en"));
 const observed={version:p.version,identity:p.identity,user:p.user,companies:p.companies,partnerSchema:p.partnerSchema,aliasSchema:p.aliasSchema,
  selectedAliases:selected,partners,allAliases,unrepresentableAliases,rows:projected,issues};
 const fingerprint=digest(observed,sha),prior=state.passes.length>1?state.passes.at(-2).summary:null;
 const summary={pass:p.number,completedAt,fingerprint,selectedAliases:selected.length,partners:partners.length,
  aliases:allAliases.length,unrepresentableAliases:unrepresentableAliases.length,projectedRows:projected.length,issues:issues.length,agreesWithPrevious:prior?.fingerprint===fingerprint};
 p.summary=summary;
 const targetSource={schema:SOURCE_SCHEMA,complete:true,targetScope:state.targetScope,namespace:s.namespace,
  targetBaselineComplete:issues.length===0,rows:projected,issues,observed,
  source:{url:s.origin+"/json/2/res.partner/search_read",publisher:s.publisher??"Original selected Odoo database",
   title:s.title,selection:canonical(scope(s)),retrievedAt:completedAt,
   capture:{operationId:s.operationId,selectionSha256:state.selectionSha256,fingerprint,
    observedPasses:summary.agreesWithPrevious?[p.number-1,p.number]:[p.number],
    consistency:"Two repeated complete read-only observations; separate provider transactions."}},
  documentation:DOCUMENTATION};
 state.updatedAt=completedAt;
 if(summary.agreesWithPrevious){
  state.status="complete";state.phase="complete";state.result={fingerprint,pass:p.number,targetScope:state.targetScope,
   targetBaselineComplete:issues.length===0,projectedRows:projected.length,partners:partners.length,issues:issues.length,completedAt};
 }else{state.currentPass++;state.passes.push(emptyPass(state.currentPass));state.phase="version";}
 return {state,summary,targetSource};
}
export function composePreparation(contactInput,target,sha){
 need(object(contactInput)&&contactInput.kind==="odoo-contact-import-preparation"&&
  Array.isArray(contactInput.companies)&&Array.isArray(contactInput.people),"ORIGINAL_CONTACT_INPUT_REQUIRED");
 need(target?.schema===SOURCE_SCHEMA&&target.complete===true&&contactInput.namespace===target.namespace,"TARGET_NAMESPACE_CHANGED");
 const requested=[...contactInput.companies,...contactInput.people].filter(r=>typeof r.targetExternalId==="string"&&r.targetExternalId.trim()).map(r=>r.targetExternalId);
 const selected=JSON.parse(target.source.selection);
 for(const id of requested){
  const [module]=externalParts(id);
  need(selected.externalIdModules.includes(module)||selected.explicitExternalIds.includes(id),"MAPPED_ID_OUTSIDE_CAPTURE_SCOPE",id);
 }
 const result=clone(contactInput),byExternal=new Map(target.rows.map(r=>[r.externalId,r])),byPartner=new Map(),preparationIssues=[];
 for(const [kind,sourceRows] of [["company",contactInput.companies],["person",contactInput.people]])for(const row of sourceRows){
  const externalId=text(row.targetExternalId)?row.targetExternalId:contactInput.namespace+"."+kind+"_"+sha(String(row.sourceId??""));
  const actual=byExternal.get(externalId);if(!actual)continue;
  if(!byPartner.has(actual.partnerId))byPartner.set(actual.partnerId,[]);
  byPartner.get(actual.partnerId).push({kind,sourceId:row.sourceId??null,externalId});
 }
 for(const [partnerId,records] of byPartner)if(records.length>1)
  preparationIssues.push({code:"MULTIPLE_SOURCE_RECORDS_TARGET_SAME_PARTNER",partnerId,records});
 need(!own(result,"targetAfter"),"USE_RECONCILE_FOR_ORIGINAL_TARGET_RESULT");
 result.targetExisting=clone(target.rows);result.targetBaselineComplete=target.targetBaselineComplete&&preparationIssues.length===0;result.targetScope=target.targetScope;
 result.source={...result.source,targetCapture:clone(target.source),targetCaptureIssues:clone(target.issues),targetPreparationIssues:preparationIssues,
  originalContactInput:{sha256:digest(contactInput,sha),content:clone(contactInput)}};
 return result;
}
export function composeReconciliation(originalInput,target,nativeResult,sha){
 need(object(originalInput)&&originalInput.kind==="odoo-contact-import-preparation"&&
  Array.isArray(originalInput.targetExisting)&&typeof originalInput.targetScope==="string"&&
  originalInput.source?.targetCapture,"ORIGINAL_PREPARED_TARGET_BASELINE_REQUIRED");
 need(target?.schema===SOURCE_SCHEMA&&target.complete===true&&target.targetBaselineComplete===true&&
  target.targetScope===originalInput.targetScope,"COMPLETE_SAME_SCOPE_TARGET_RESULT_REQUIRED");
 need(object(nativeResult)&&Object.keys(nativeResult).length>0,"ORIGINAL_NATIVE_IMPORT_RESULT_REQUIRED");
 const result=clone(originalInput);
 result.targetAfter={complete:true,receivedAt:target.source.retrievedAt,scope:target.targetScope,rows:clone(target.rows),
  source:{url:target.source.url,description:target.source.title,capture:clone(target.source)},
  nativeResult:clone(nativeResult),nativeResultSha256:digest(nativeResult,sha)};
 return result;
}
