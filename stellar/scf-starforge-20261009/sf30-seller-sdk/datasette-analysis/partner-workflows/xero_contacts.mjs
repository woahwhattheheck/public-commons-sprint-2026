/** Xero Accounting Contacts source adapter for the maintained partner workflow.
 * Pure source/review/normalization. Retains original HTTP bodies and explicit operator decisions.
 */
import {canonical,buildContacts} from "./preparation.mjs";
export const CAPTURE_SCHEMA="stellar-forge.xero-contacts-capture.v1";
export const DECISION_SCHEMA="stellar-forge.xero-contacts-decisions.v1";
const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const fail=(code,detail)=>{const e=new Error(code);e.code=code;e.detail=detail;throw e;};
const need=(ok,code,detail)=>{if(!ok)fail(code,detail);};
const obj=x=>x&&typeof x==="object"&&!Array.isArray(x);
const str=x=>typeof x==="string"&&x.trim().length>0;
const uuid=x=>typeof x==="string"&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(x);
const hash=(value,sha)=>{const h=sha(canonical(value));need(/^[a-f0-9]{64}$/.test(h),"SHA256_REQUIRED");return h;};
const date=x=>typeof x==="string"&&/(Z|[+-]\d\d:\d\d)$/.test(x)&&Number.isFinite(Date.parse(x));
export function contactsURL(page,pageSize){
  need(Number.isSafeInteger(page)&&page>0&&Number.isSafeInteger(pageSize)&&pageSize>=1&&pageSize<=1000,"PAGING_INVALID");
  return "https://api.xero.com/api.xro/2.0/Contacts?page="+page+"&pageSize="+pageSize+"&includeArchived=true&summaryOnly=false&order=ContactID%20ASC";
}
export function pageValue(entry,expectedPage,pageSize,sha){
  need(obj(entry)&&entry.page===expectedPage&&entry.url===contactsURL(expectedPage,pageSize)&&entry.status===200&&date(entry.receivedAt),"PAGE_DESCRIPTOR_INVALID",expectedPage);
  need(typeof entry.bodyText==="string"&&sha(entry.bodyText)===entry.sha256,"ORIGINAL_RESPONSE_CHANGED",expectedPage);
  let body;try{body=JSON.parse(entry.bodyText);}catch{fail("RESPONSE_JSON_INVALID",expectedPage);}
  need(obj(body)&&Array.isArray(body.Contacts)&&body.Status==="OK","CONTACTS_RESPONSE_INVALID",expectedPage);
  const p=body.pagination;
  need(obj(p)&&p.page===expectedPage&&p.pageSize===pageSize&&Number.isSafeInteger(p.pageCount)&&p.pageCount>=0&&Number.isSafeInteger(p.itemCount)&&p.itemCount>=0,"PAGINATION_METADATA_REQUIRED",expectedPage);
  need(p.pageCount===Math.ceil(p.itemCount/pageSize),"PAGINATION_COUNT_INCONSISTENT",expectedPage);
  const expected=p.itemCount===0?0:expectedPage<p.pageCount?pageSize:p.itemCount-(p.pageCount-1)*pageSize;
  need((p.itemCount===0&&expectedPage===1)||(expectedPage<=p.pageCount),"PAGE_OUTSIDE_DECLARED_RANGE",expectedPage);
  need(body.Contacts.length===expected,"PAGE_ROW_COUNT_CHANGED",expectedPage);
  need(!body.Warnings?.length,"XERO_RESPONSE_WARNINGS",body.Warnings);
  return body;
}
export function validateCapture(capture,sha,{complete=true}={}){
  need(obj(capture)&&capture.schema===CAPTURE_SCHEMA&&uuid(capture.tenantId)&&date(capture.startedAt),"CAPTURE_INVALID");
  need(Number.isSafeInteger(capture.pageSize)&&capture.pageSize>=1&&capture.pageSize<=1000&&Array.isArray(capture.pages),"CAPTURE_PAGING_INVALID");
  need(capture.selection==="all-contacts-including-archived"&&capture.order==="ContactID ASC"&&capture.summaryOnly===false,"CAPTURE_SELECTION_CHANGED");
  const contacts=[],seen=new Set();let expectedCount,expectedPages;
  for(let i=0;i<capture.pages.length;i++){
    const body=pageValue(capture.pages[i],i+1,capture.pageSize,sha),p=body.pagination;
    if(i===0){expectedCount=p.itemCount;expectedPages=Math.max(1,p.pageCount);}
    need(p.itemCount===expectedCount&&Math.max(1,p.pageCount)===expectedPages,"SOURCE_COUNT_CHANGED_RESTART_CAPTURE",i+1);
    for(const c of body.Contacts){
      need(obj(c)&&uuid(c.ContactID),"CONTACT_ID_REQUIRED",i+1);
      const id=c.ContactID.toLowerCase();need(!seen.has(id),"DUPLICATE_CONTACT_ID_RESTART_CAPTURE",id);seen.add(id);
      need(["ACTIVE","ARCHIVED","GDPRREQUEST"].includes(c.ContactStatus),"CONTACT_STATUS_UNKNOWN",id);
      need(!c.MergedToContactID||uuid(c.MergedToContactID),"MERGE_TARGET_INVALID",id);
      need(c.ContactPersons===undefined||Array.isArray(c.ContactPersons),"CONTACT_PERSONS_INVALID",id);
      need(c.ContactGroups===undefined||Array.isArray(c.ContactGroups),"CONTACT_GROUPS_INVALID",id);
      contacts.push(c);
    }
  }
  if(complete){
    need(capture.complete===true&&date(capture.completedAt)&&Date.parse(capture.completedAt)>=Date.parse(capture.startedAt),"CAPTURE_NOT_COMPLETE");
    need(capture.pages.length===expectedPages&&contacts.length===expectedCount,"CAPTURE_PAGES_INCOMPLETE");
  }else need(capture.pages.length<=(expectedPages??Infinity),"EXCESS_CAPTURE_PAGES");
  return {contacts,itemCount:expectedCount??0,pageCount:expectedPages??0,captureSha256:hash(capture,sha)};
}
function peopleOf(c,sha){
  const candidates=[];
  if(str(c.FirstName)||str(c.LastName)){
    const value={FirstName:c.FirstName??"",LastName:c.LastName??""};
    if(own(c,"EmailAddress"))value.EmailAddress=c.EmailAddress;
    candidates.push({role:"primary",value});
  }
  for(const value of c.ContactPersons||[]) {need(obj(value),"CONTACT_PERSON_INVALID",c.ContactID);candidates.push({role:"additional",value});}
  const counts=new Map();
  return candidates.map(({role,value})=>{
    // An occurrence is for reviewing duplicates only, never a durable person identity.
    const fingerprint=hash({role,FirstName:value.FirstName??"",LastName:value.LastName??"",EmailAddress:value.EmailAddress??"",IncludeInEmails:value.IncludeInEmails??null},sha);
    const occurrence=(counts.get(fingerprint)||0)+1;counts.set(fingerprint,occurrence);
    return {role,fingerprint,occurrence,value};
  });
}
export function reviewCapture(capture,sha){
  const v=validateCapture(capture,sha),contacts=[],people=[],memberships=[],decisions={};
  for(const c of v.contacts){
    const id=c.ContactID.toLowerCase(),excluded=c.ContactStatus!=="ACTIVE"||!!c.MergedToContactID;
    contacts.push({contact_id:id,name:c.Name??"",status:c.ContactStatus,merged_to:c.MergedToContactID??"",
      is_customer:c.IsCustomer??"",is_supplier:c.IsSupplier??"",additional_people:(c.ContactPersons||[]).length,
      has_attachments:c.HasAttachments===true,review:excluded?"RETAIN_ONLY_STATUS_OR_MERGE":"CHOOSE_COMPANY_PERSON_OR_EXCLUDE"});
    const ps=peopleOf(c,sha);
    for(const p of ps)people.push({contact_id:id,...p,native_person_id:null});
    for(const g of c.ContactGroups||[])memberships.push({contact_id:id,group_id:g.ContactGroupID??"",name:g.Name??"",status:g.Status??""});
    if(!excluded)decisions[id]={kind:null,reason:"",phoneType:"none",people:ps.map(p=>({fingerprint:p.fingerprint,occurrence:p.occurrence,action:null,sourceId:"",reason:""}))};
  }
  return {schema:"stellar-forge.xero-contacts-review.v1",captureSha256:v.captureSha256,tenantId:capture.tenantId,
    counts:{contacts:contacts.length,people:people.length,memberships:memberships.length},
    contacts,people,memberships,
    decisionsTemplate:{schema:DECISION_SCHEMA,captureSha256:v.captureSha256,namespace:"",targetScope:"",targetBaselineComplete:false,targetExisting:[],fields:["name","email","phone"],contacts:decisions}};
}
export function normalizeContacts(capture,decisions,sha){
  const v=validateCapture(capture,sha);
  need(obj(decisions)&&decisions.schema===DECISION_SCHEMA&&decisions.captureSha256===v.captureSha256,"DECISIONS_CAPTURE_CHANGED");
  need(obj(decisions.contacts)&&str(decisions.namespace)&&str(decisions.targetScope),"MAPPING_SCOPE_REQUIRED");
  need(decisions.targetBaselineComplete===true&&Array.isArray(decisions.targetExisting),"COMPLETE_TARGET_BASELINE_REQUIRED");
  const companies=[],people=[],selection=[],usedPersonIds=new Set(),seenDecisions=new Set();
  for(const c of v.contacts){
    const id=c.ContactID.toLowerCase(),base=capture.tenantId.toLowerCase()+"/"+id;
    if(c.ContactStatus!=="ACTIVE"||c.MergedToContactID){
      need(!own(decisions.contacts,id),"NONACTIVE_CONTACT_MUST_REMAIN_RETAIN_ONLY",id);
      selection.push({contactId:id,action:"RETAIN_ONLY",reason:c.MergedToContactID?"MERGED_TO:"+c.MergedToContactID:c.ContactStatus});continue;
    }
    const d=decisions.contacts[id];need(obj(d)&&["company","person","exclude"].includes(d.kind)&&str(d.reason),"CONTACT_DECISION_REQUIRED",id);seenDecisions.add(id);
    if(d.kind==="exclude"){selection.push({contactId:id,action:"EXCLUDE",reason:d.reason});continue;}
    need(str(c.Name),"CONTACT_NAME_REQUIRED",id);
    need(Array.isArray(d.people),"PERSON_DECISIONS_REQUIRED",id);
    need(["none","DEFAULT","DDI","MOBILE","FAX","OFFICE"].includes(d.phoneType),"PHONE_TYPE_DECISION_REQUIRED",id);
    const row={sourceId:base,name:c.Name};
    if(own(c,"EmailAddress")){need(typeof c.EmailAddress==="string","EMAIL_TYPE_INVALID",id);row.email=c.EmailAddress;}
    if(d.phoneType!=="none"){
      need(Array.isArray(c.Phones),"PHONE_COLLECTION_NOT_RETURNED",id);
      const chosen=c.Phones.filter(p=>p.PhoneType===d.phoneType);
      need(chosen.length===1,"SELECTED_PHONE_NOT_UNIQUE",id);
      const p=chosen[0];for(const k of ["PhoneCountryCode","PhoneAreaCode","PhoneNumber"])need(!own(p,k)||typeof p[k]==="string","PHONE_FIELD_INVALID",id);
      row.phone=[p.PhoneCountryCode,p.PhoneAreaCode,p.PhoneNumber].filter(x=>str(x)).join(" ");
    }
    if(own(d,"targetExternalId"))row.targetExternalId=d.targetExternalId;
    if(own(d,"clearFields")){need(Array.isArray(d.clearFields)&&d.clearFields.every(x=>["email","phone","parent"].includes(x)),"CLEAR_FIELDS_INVALID",id);row.clearFields=d.clearFields;}
    // No source company classification or hierarchy is inferred from Xero name, tax ID or groups.
    (d.kind==="company"?companies:people).push(row);
    const candidates=peopleOf(c,sha),byKey=new Map(d.people.map(p=>[p.fingerprint+":"+p.occurrence,p]));
    need(byKey.size===d.people.length&&byKey.size===candidates.length,"PERSON_DECISION_SET_CHANGED",id);
    for(const p of candidates){
      const key=p.fingerprint+":"+p.occurrence,pd=byKey.get(key);
      need(obj(pd)&&["include","exclude"].includes(pd.action)&&str(pd.reason),"PERSON_DECISION_REQUIRED",id+":"+key);
      if(pd.action==="exclude")continue;
      need(d.kind==="company","PERSON_PARENT_MUST_BE_SELECTED_COMPANY",id);
      need(str(pd.sourceId)&&/^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$/.test(pd.sourceId),"RETAINED_PERSON_KEY_REQUIRED",id);
      const pid=base+"/person/"+pd.sourceId;need(!usedPersonIds.has(pid),"PERSON_KEY_DUPLICATE",pid);usedPersonIds.add(pid);
      const name=[p.value.FirstName,p.value.LastName].filter(str).join(" ");need(str(name),"PERSON_NAME_REQUIRED",pid);
      const person={sourceId:pid,companySourceId:base,name};
      if(own(p.value,"EmailAddress")){need(typeof p.value.EmailAddress==="string","PERSON_EMAIL_TYPE_INVALID",pid);person.email=p.value.EmailAddress;}
      if(own(pd,"targetExternalId"))person.targetExternalId=pd.targetExternalId;
      if(own(pd,"clearFields")){need(Array.isArray(pd.clearFields)&&pd.clearFields.every(x=>x==="email"),"PERSON_CLEAR_FIELDS_INVALID",pid);person.clearFields=pd.clearFields;}
      people.push(person);
    }
    selection.push({contactId:id,action:d.kind.toUpperCase(),reason:d.reason});
  }
  need(Object.keys(decisions.contacts).every(id=>seenDecisions.has(id)),"STALE_OR_UNKNOWN_CONTACT_DECISION");
  const result={kind:"odoo-contact-import-preparation",complete:true,
    source:{publisher:"Xero Accounting API selected organisation "+capture.tenantId,title:"Complete selected Xero Contacts edition",
      url:"https://api.xero.com/api.xro/2.0/Contacts",selection:"Tenant "+capture.tenantId+"; all pages including archived; operator-reviewed contact identity decisions",retrievedAt:capture.completedAt},
    namespace:decisions.namespace,targetScope:decisions.targetScope,targetBaselineComplete:true,targetExisting:decisions.targetExisting,
    companies,people,fields:decisions.fields,
    xero:{schema:"stellar-forge.xero-contact-source-selection.v1",captureSha256:v.captureSha256,capture,decisions,selection,
      semantics:{contactGroups:"Retained source memberships; no company hierarchy or Odoo tags inferred.",contactPersons:"Operator-assigned stable local keys; Xero supplies no ContactPerson ID.",nonactive:"Retained for review; no target deletion, archive, reparenting or merge is inferred.",sourceCompleteness:"Complete observed paginated edition, not an atomic database snapshot. Reacquire and compare before selected cutover.",attachments:"HasAttachments and returned metadata retained. Binary attachments are outside this contact-master profile."}}};
  if(own(decisions,"targetAfter"))result.targetAfter=decisions.targetAfter;
  // Reuse every existing target baseline, owned-field, parent and explicit-clear rule.
  buildContacts(result,sha);
  return result;
}
export function compareCaptures(before,after,sha){
  const b=validateCapture(before,sha),a=validateCapture(after,sha);
  need(before.tenantId.toLowerCase()===after.tenantId.toLowerCase(),"TENANT_CHANGED");
  const bm=new Map(b.contacts.map(c=>[c.ContactID.toLowerCase(),c])),am=new Map(a.contacts.map(c=>[c.ContactID.toLowerCase(),c])),rows=[];
  for(const [id,c]of bm){const n=am.get(id);if(!n)rows.push({contactId:id,change:"NOT_RETURNED_REVIEW",before:c,after:null});else if(hash(c,sha)!==hash(n,sha))rows.push({contactId:id,change:"CHANGED",before:c,after:n});}
  for(const[id,c]of am)if(!bm.has(id))rows.push({contactId:id,change:"NEWLY_RETURNED",before:null,after:c});
  return {schema:"stellar-forge.xero-contacts-comparison.v1",tenantId:after.tenantId,beforeSha256:b.captureSha256,afterSha256:a.captureSha256,
    beforeCount:b.contacts.length,afterCount:a.contacts.length,changed:rows.length,rows};
}
