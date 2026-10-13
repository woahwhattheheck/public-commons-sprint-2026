// MIT. Explicit single-agency profile definitions and deployment planning.
import { canonical,copy,equal,fail,object,text,seal,uniqueStrings } from '../gis/shared.mjs';
import { validateCalendar,calculateDueDate } from './calendar.mjs';
export const PROFILE_SCHEMA='commons.open311.service-profile.v1';
export const SEMANTIC_FIELDS=['requestId','serviceCode','category','serviceName','title','description','createdAt','updatedAt','closedAt','status','statusNotes','address','latitude','longitude','residentEmail','trackingUrl','publicMapOverride','issueNumber','caseNumber','workOrderIds','completionNote','progressSummary','magicLink'];
export const STAGES=['received','assigned','in_progress','resolved','closed_other'];
export const TEMPLATE_TOKENS=['agency_name','issue_number','case_number','service_category','department_name','assignee_name','request_created_date','request_updated_date','due_date','source_status','source_status_notes','location','work_order_ids','completion_note','progress_summary','magic_link'];
export const RESIDENT_WORDING_FIELDS=['assignee_name','completion_note','progress_summary'];
export const SOURCE_KINDS=['open311_georeport_v2','follow_through_dispatch_v1','field_destination_update_v1','mapped_records'];
export const has=(value,key)=>Object.prototype.hasOwnProperty.call(value,key);
export function choice(value,values,label){if(!values.includes(value))fail('INVALID_CHOICE',label+' must be one of '+values.join(', ')+'.');return value;}
export function scalar(value,label){if(value!==null&&!['string','number','boolean'].includes(typeof value)||typeof value==='number'&&!Number.isFinite(value))fail('JSON_SCALAR_REQUIRED',label+' must be an exact JSON string, finite number, boolean or null.');return copy(value);}
export function pointer(value,label='JSON pointer'){text(value,label,4096,{empty:true});if(value!==''&&!value.startsWith('/')||/~(?![01])/u.test(value))fail('INVALID_JSON_POINTER',label+' must be an RFC 6901 JSON pointer.');return value;}
const optionalText=(value,label,max=100000)=>text(value??'',label,max,{empty:true});
const ref=(value,label)=>value===undefined||value===null||value===''?null:text(value,label,200);
const boolean=(value,label,defaultValue=false)=>{if(value===undefined)return defaultValue;if(typeof value!=='boolean')fail('BOOLEAN_REQUIRED',label+' must be a boolean.');return value;};
const array=(value,label,max=10000)=>{if(value===undefined)return [];if(!Array.isArray(value)||value.length>max)fail('INVALID_LIST',label+' must be an array of at most '+max+' entries.');return value;};
const strings=(value,label)=>uniqueStrings(value??[],label,{max:10000}).map(v=>text(v,label,200));
function records(value,label,transform){
  const seen=new Set();
  return array(value,label).map((raw,index)=>{object(raw,label+' entry');const id=text(raw.id,label+' reference',200);if(seen.has(id))fail('DUPLICATE_REFERENCE',label+' reference is repeated.',400,{id});seen.add(id);return transform({...copy(raw),id},index);});
}
function permissions(raw){
  const p=object(raw??{},'CRM permission declaration'),result={...copy(p),crmEnabled:boolean(p.crmEnabled,'CRM enabled'),crmProductAdmin:boolean(p.crmProductAdmin,'CRM Product Admin'),crmAccess:choice(p.crmAccess??'none',['none','read_only','basic','overwrite'],'CRM access')};
  if(!result.crmEnabled&&(result.crmProductAdmin||result.crmAccess!=='none'))fail('CRM_PERMISSION_DEPENDENCY','CRM Product Admin and access require CRM enabled.');
  return result;
}
function validateTemplate(raw){
  const value={...raw,name:text(raw.name,'Template name',1000),audience:choice(raw.audience,['staff','resident'],'Message audience'),stage:choice(raw.stage,STAGES,'Message stage'),subject:text(raw.subject,'Message subject',2000),body:text(raw.body,'Message body',100000),locale:optionalText(raw.locale,'Message language',100),active:boolean(raw.active,'Template active',true)};
  const tokens=new Set();
  for(const input of [value.subject,value.body]){
    for(const match of input.matchAll(/\{\{([^{}]+)\}\}/g)){if(!TEMPLATE_TOKENS.includes(match[1]))fail('UNKNOWN_TEMPLATE_TOKEN','Use a declared message placeholder.',400,{token:match[1]});tokens.add(match[1]);}
    if(input.replace(/\{\{[^{}]+\}\}/g,'').includes('{{')||input.replace(/\{\{[^{}]+\}\}/g,'').includes('}}'))fail('INVALID_TEMPLATE_TOKEN','Complete each selected {{placeholder}} without expressions.');
  }
  if(raw.residentWording!==undefined){
    object(raw.residentWording,'Explicit resident wording');value.residentWording={};
    for(const [key,wording] of Object.entries(raw.residentWording)){if(!RESIDENT_WORDING_FIELDS.includes(key))fail('UNKNOWN_RESIDENT_WORDING','Resident wording is selected by its exact supported token.',400,{key});value.residentWording[key]=text(wording,'Resident '+key+' wording',100000,{empty:true});}
  }
  return value;
}
export function customValue(field,value){
  if(value===undefined||value===null||value===''||field.kind==='multi_select'&&Array.isArray(value)&&value.length===0)return {valid:!field.required,missing:true,message:field.required?'The required category field has no selected original value or default.':null};
  let valid=false;
  if(field.kind==='text')valid=typeof value==='string';
  else if(field.kind==='number')valid=typeof value==='number'&&Number.isFinite(value);
  else if(field.kind==='boolean')valid=typeof value==='boolean';
  else if(field.kind==='date'){try{valid=typeof value==='string'&&calculateDueDate(value+'T00:00:00Z',0,{timeZone:'UTC',calendar:{kind:'calendar_days',weekdays:[],holidays:[]}}).date===value;}catch{valid=false;}}
  else if(field.kind==='single_select')valid=typeof value==='string'&&field.options.some(o=>o.value===value);
  else if(field.kind==='multi_select')valid=Array.isArray(value)&&value.every(v=>typeof v==='string'&&field.options.some(o=>o.value===v))&&new Set(value).size===value.length;
  return {valid,missing:false,message:valid?null:'The selected value does not match the declared '+field.kind+' category field.'};
}
function customField(raw){
  const value={...raw,label:text(raw.label,'Category field label',1000),kind:choice(raw.kind,['text','number','boolean','date','single_select','multi_select'],'Category field type'),scope:choice(raw.scope,['submission','location'],'Category field scope'),required:boolean(raw.required,'Category field required'),helpText:optionalText(raw.helpText,'Category field instructions'),options:array(raw.options,'Category field choices').map(o=>{object(o,'Category field choice');return {...copy(o),value:text(o.value,'Exact choice value',2000,{empty:true}),label:text(o.label,'Choice label',1000)};})};
  if(new Set(value.options.map(o=>o.value)).size!==value.options.length)fail('DUPLICATE_CHOICE','Category field choices must use distinct exact string values.');
  if(!['single_select','multi_select'].includes(value.kind)&&value.options.length)fail('FIELD_CHOICES_NOT_APPLICABLE','Only select fields have choice options.');
  if(['single_select','multi_select'].includes(value.kind)&&!value.options.length)fail('FIELD_CHOICES_REQUIRED','A select field needs its exact choices.');
  if(raw.sourcePointer!==undefined&&raw.sourcePointer!=='')value.sourcePointer=pointer(raw.sourcePointer,'Category field source pointer');else delete value.sourcePointer;
  if(has(raw,'defaultValue')){canonical(raw.defaultValue);const check=customValue({...value,required:false},raw.defaultValue);if(!check.valid)fail('INVALID_FIELD_DEFAULT',check.message);value.defaultValue=copy(raw.defaultValue);}
  return value;
}
function sourceProfile(raw){
  const mapping=object(raw.mapping??{},'Source field mapping'),mapped={};
  for(const [key,m] of Object.entries(mapping)){
    if(!SEMANTIC_FIELDS.includes(key))fail('UNKNOWN_SEMANTIC_FIELD','Select a declared semantic field.',400,{key});
    object(m,'Mapping '+key);const keys=Object.keys(m);
    if(keys.length!==1||keys[0]!=='pointer'&&keys[0]!=='literal')fail('INVALID_FIELD_MAPPING','Each field mapping has exactly one pointer or literal.',400,{key});
    mapped[key]=has(m,'pointer')?{pointer:pointer(m.pointer,'Mapping '+key+' pointer')}:{literal:copy(m.literal)};
  }
  const statuses=array(raw.statusMappings,'Original status meanings').map(m=>{object(m,'Status mapping');return {...copy(m),sourceValue:scalar(m.sourceValue,'Exact original status'),stage:choice(m.stage,STAGES,'Mapped stage'),completionMeaning:text(m.completionMeaning,'Original status meaning',100000)};});
  if(new Set(statuses.map(m=>canonical(m.sourceValue))).size!==statuses.length)fail('DUPLICATE_STATUS_MAPPING','Each exact original status has one explicit meaning.');
  let visibility=null;
  if(raw.publicMapOverrideMapping!==undefined&&raw.publicMapOverrideMapping!==null){
    object(raw.publicMapOverrideMapping,'Original public map mapping');
    if(!mapped.publicMapOverride)fail('VISIBILITY_INPUT_REQUIRED','Map the original publicMapOverride field before defining its values.');
    const values=array(raw.publicMapOverrideMapping.values,'Public-map values').map(v=>{object(v,'Public-map value');return {sourceValue:scalar(v.sourceValue,'Exact map visibility value'),publicMap:choice(v.publicMap,['show','hide','default'],'Mapped public visibility')};});
    if(new Set(values.map(v=>canonical(v.sourceValue))).size!==values.length)fail('DUPLICATE_VISIBILITY_MAPPING','Each exact original visibility value can be mapped once.');
    visibility={...copy(raw.publicMapOverrideMapping),values};
  }
  return {...raw,name:text(raw.name,'Source profile name',1000),kind:choice(raw.kind,SOURCE_KINDS,'Source profile format'),rowsPointer:pointer(raw.rowsPointer??'','Original row-array pointer'),mapping:mapped,statusMappings:statuses,publicMapOverrideMapping:visibility,note:optionalText(raw.note,'Source mapping note')};
}
export function validateProfileDefinition(supplied){
  object(supplied,'Complete service profile');const raw=copy(supplied),agency=object(raw.agency,'Agency');
  const calendar=validateCalendar(agency),value={...raw,name:text(raw.name,'Configuration name',1000),agency:{...copy(agency),id:text(agency.id,'Agency reference',200),name:text(agency.name,'Agency name',1000),...calendar},note:optionalText(raw.note,'Configuration note')};
  value.departments=records(raw.departments,'Department',r=>({...r,name:text(r.name,'Department name',1000),active:boolean(r.active,'Department active',true)}));
  for(const kind of ['roles','groups'])value[kind]=records(raw[kind],kind,r=>({...r,name:text(r.name,'Permission declaration name',1000),description:optionalText(r.description,'Permission declaration description'),active:boolean(r.active,'Permission declaration active',true),permissions:permissions(r.permissions),...(r.sourceLabel!==undefined?{sourceLabel:optionalText(r.sourceLabel,'Original permission label',1000)}:{}),...(r.sourceReference!==undefined?{sourceReference:optionalText(r.sourceReference,'Original permission reference',4096)}:{})}));
  value.staff=records(raw.staff,'Staff',r=>({...r,name:text(r.name,'Staff name',1000),departmentIds:strings(r.departmentIds,'Staff department references'),roleId:text(r.roleId,'Exactly one staff role reference',200),groupIds:strings(r.groupIds,'Staff group references'),contact:optionalText(r.contact,'Staff contact',4000),active:boolean(r.active,'Staff active',true)}));
  value.templates=records(raw.templates,'Template',validateTemplate);
  value.sourceProfiles=records(raw.sourceProfiles,'Source profile',sourceProfile);
  value.categories=records(raw.categories,'Category',(r,index)=>{
    const selectors=array(r.sourceSelectors,'Original category selectors').map(s=>{object(s,'Category selector');return {sourceProfileId:text(s.sourceProfileId,'Category source-profile reference',200),field:choice(s.field,['serviceCode','category','serviceName'],'Category source field'),value:scalar(s.value,'Exact original category value')};});
    if(new Set(selectors.map(canonical)).size!==selectors.length)fail('DUPLICATE_CATEGORY_SELECTOR','A category repeats the same exact selector.');
    const keywords=strings(r.keywords,'Category keywords');if(keywords.length>10||keywords.some(k=>/\s/u.test(k)))fail('INVALID_CATEGORY_KEYWORDS','Use up to 10 distinct single-word category keywords.');
    const displayOrder=r.displayOrder??index;if(!Number.isSafeInteger(displayOrder)||displayOrder<0)fail('INVALID_CATEGORY_ORDER','Category display order is a nonnegative integer.');
    const resolutionDays=r.resolutionDays??null;if(resolutionDays!==null&&(!Number.isSafeInteger(resolutionDays)||resolutionDays<0))fail('INVALID_RESOLUTION_DAYS','Resolution days are a nonnegative integer or null.');
    const result={...r,name:text(r.name,'Category name',1000),description:optionalText(r.description,'Category description'),sourceSelectors:selectors,active:boolean(r.active,'Category active',true),isOther:boolean(r.isOther,'Other category'),displayOrder,includeLocation:boolean(r.includeLocation,'Include location'),locationRequired:boolean(r.locationRequired,'Location required'),departmentId:ref(r.departmentId,'Category department'),ownerStaffId:ref(r.ownerStaffId,'Category owner'),keywords,resolutionDays,publicMapDefault:choice(r.publicMapDefault??'hide',['show','hide'],'Category public-map default'),customFields:records(r.customFields,'Category field',customField),templateIds:strings(r.templateIds,'Category template references')};
    if(result.locationRequired&&!result.includeLocation)fail('LOCATION_DEPENDENCY','A category requiring location must include location.');
    return result;
  });
  if(value.categories.filter(c=>c.isOther).length>1)fail('OTHER_CATEGORY_REPEATED','An agency may declare one Other category.');
  const other=value.categories.find(c=>c.isOther);if(other&&value.categories.some(c=>!c.isOther&&c.displayOrder<other.displayOrder))fail('OTHER_CATEGORY_ORDER','Keep the Other category first in display order.');
  value.routes=records(raw.routes,'Route',r=>({...r,name:text(r.name,'Route name',1000),active:boolean(r.active,'Route active',true),categoryIds:strings(r.categoryIds,'Route categories'),sourceProfileIds:strings(r.sourceProfileIds,'Route source profiles'),selectors:array(r.selectors,'Route conditions').map(s=>{object(s,'Route condition');const field=text(s.field,'Route semantic field',300);if(!SEMANTIC_FIELDS.includes(field)&&!/^custom:.+/u.test(field))fail('UNKNOWN_ROUTE_FIELD','Use a semantic field or custom:<categoryFieldId>.');const operator=choice(s.operator,['equals','in'],'Route comparison');return operator==='equals'?{field,operator,value:scalar(s.value,'Exact route comparison')}:{field,operator,values:array(s.values,'Exact route comparisons').map(v=>scalar(v,'Exact route comparison'))};}),departmentId:ref(r.departmentId,'Route department'),ownerStaffId:ref(r.ownerStaffId,'Route owner'),collaboratorStaffIds:strings(r.collaboratorStaffIds,'Route collaborators'),templateIds:strings(r.templateIds,'Route template references'),note:optionalText(r.note,'Route instructions')}));
  value.rollout=records(raw.rollout,'Rollout phase',r=>({...r,name:text(r.name,'Rollout phase name',1000),audience:choice(r.audience,['staff','commissioners','resident'],'Rollout audience'),categoryIds:strings(r.categoryIds,'Rollout categories'),departmentIds:strings(r.departmentIds,'Rollout departments'),ownerStaffId:ref(r.ownerStaffId,'Rollout owner'),trainingItems:array(r.trainingItems,'Training items').map(s=>text(s,'Training item',10000)),entryCriteria:array(r.entryCriteria,'Entry criteria').map(s=>text(s,'Entry criterion',10000)),exitCriteria:array(r.exitCriteria,'Exit criteria').map(s=>text(s,'Exit criterion',10000)),note:optionalText(r.note,'Rollout notes')}));
  const ids=Object.fromEntries(['departments','roles','groups','staff','templates','sourceProfiles','categories'].map(kind=>[kind,new Set(value[kind].map(v=>v.id))]));
  const requireRef=(kind,id,label)=>{if(id!==null&&!ids[kind].has(id))fail('UNKNOWN_PROFILE_REFERENCE',label+' does not name a saved '+kind+' declaration.',400,{id});};
  const requireRefs=(kind,entries,label)=>entries.forEach(id=>requireRef(kind,id,label));
  for(const staff of value.staff){requireRef('roles',staff.roleId,'Staff role');requireRefs('groups',staff.groupIds,'Staff group');requireRefs('departments',staff.departmentIds,'Staff department');}
  for(const c of value.categories){requireRef('departments',c.departmentId,'Category department');requireRef('staff',c.ownerStaffId,'Category owner');requireRefs('templates',c.templateIds,'Category template');for(const s of c.sourceSelectors)requireRef('sourceProfiles',s.sourceProfileId,'Category source profile');}
  for(const r of value.routes){requireRefs('categories',r.categoryIds,'Route category');requireRefs('sourceProfiles',r.sourceProfileIds,'Route source profile');requireRef('departments',r.departmentId,'Route department');requireRef('staff',r.ownerStaffId,'Route owner');requireRefs('staff',r.collaboratorStaffIds,'Route collaborator');requireRefs('templates',r.templateIds,'Route template');for(const s of r.selectors)if(s.field.startsWith('custom:')){const applicable=value.categories.filter(c=>!r.categoryIds.length||r.categoryIds.includes(c.id));if(!applicable.some(c=>c.customFields.some(f=>f.id===s.field.slice(7))))fail('UNKNOWN_CUSTOM_ROUTE_FIELD','A custom route field must name a field in an eligible category.',400,{field:s.field});}}
  for(const p of value.rollout){requireRefs('categories',p.categoryIds,'Rollout category');requireRefs('departments',p.departmentIds,'Rollout department');requireRef('staff',p.ownerStaffId,'Rollout owner');}
  return value;
}
export function createProfile(input,{id,versionId,createdAt},previous=null){
  const definition=validateProfileDefinition(input.definition);
  return seal({schema:PROFILE_SCHEMA,id,versionId,previousVersionId:previous?.versionId??null,createdAt,definition});
}
export const profileSummary=p=>({id:p.id,versionId:p.versionId,previousVersionId:p.previousVersionId,name:p.definition.name,createdAt:p.createdAt,sha256:p.sha256});
export function permissionDeclarations(definition,staffId){
  const staff=definition.staff.find(s=>s.id===staffId);if(!staff)return [];
  return [{kind:'role',...definition.roles.find(r=>r.id===staff.roleId)},...staff.groupIds.map(id=>({kind:'group',...definition.groups.find(g=>g.id===id)}))].map(r=>({kind:r.kind,id:r.id,name:r.name,active:r.active,permissions:copy(r.permissions)}));
}
export function profileImplications(profile,baseline=null){
  const d=profile.definition,implications=[];
  if(!baseline)implications.push({code:'DEPLOYED_BASELINE_UNSELECTED',state:'input_required',message:'Select the deployed profile and memberships when applying permission changes. The complete target draft remains editable.',affectedIds:[]});
  for(const member of d.staff){
    const grants=permissionDeclarations(d,member.id),active=grants.filter(g=>g.active);
    if(new Set(active.map(g=>canonical(g.permissions))).size>1)implications.push({code:'PERMISSION_PRECEDENCE_UNSPECIFIED',state:'review',message:'These role and group declarations differ; the published guides do not establish their effective precedence.',staffId:member.id,grants});
    if(member.active&&grants.some(g=>!g.active))implications.push({code:'INACTIVE_PERMISSION_MEMBERSHIP',state:'review',message:'An active staff member references an inactive role or group.',staffId:member.id,grants});
  }
  if(baseline){
    for(const kind of ['roles','groups']){
      const previous=baseline.profile.definition;
      for(const old of previous[kind]){
        const current=d[kind].find(v=>v.id===old.id),assigned=previous.staff.filter(s=>kind==='roles'?s.roleId===old.id:s.groupIds.includes(old.id)).map(s=>s.id);
        if(assigned.length&&(!current||!equal(old.permissions,current.permissions))){
          implications.push({code:current?'ASSOCIATED_PERMISSIONS_CHANGE':'ASSOCIATED_DECLARATION_REMOVED',state:'reviewed_migration_required',kind:kind==='roles'?'role':'group',id:old.id,assignedStaffIds:assigned,oldPermissions:copy(old.permissions),newPermissions:current?copy(current.permissions):null,baseline:{profileId:baseline.profile.id,profileVersionId:baseline.profile.versionId,declaredBy:baseline.declaredBy,note:baseline.note},options:[{method:'replacement_reassignment',steps:['Create the reviewed replacement permission declaration.','Reassign the listed users and preserve their intended memberships.','Review the receiving tenant access before retiring the original declaration.']},{method:'detach_edit_reattach',steps:['Schedule the reviewed user detachment.','Edit permissions while the declaration has no associated users.','Reattach the original users and review their intended access.']}],message:'The vendor association rule controls live application order; it does not prevent internal draft editing.'});
        }
      }
    }
  }
  for(const route of d.routes){
    const compatible=route.selectors.every(s=>s.operator==='equals'&&(s.field==='category'||s.field.startsWith('custom:')&&d.categories.filter(c=>!route.categoryIds.length||route.categoryIds.includes(c.id)).some(c=>c.customFields.some(f=>f.id===s.field.slice(7)&&f.scope==='location'))));
    if(!compatible)implications.push({code:'PROVIDER_NEUTRAL_ROUTE_EXTENSION',state:'adapter_required',routeId:route.id,message:'This explicit neutral route needs a corresponding receiving-system adapter. Documented Comcate Assignment Rules use Equals on category or custom location fields.',selectors:copy(route.selectors)});
  }
  implications.push({code:'MESSAGE_TOKEN_BINDING',state:'mapping_required',documentedNativeTokens:['issue_number','case_number'],handoverTokens:TEMPLATE_TOKENS.filter(t=>!['issue_number','case_number'].includes(t)),message:'Bind handover-rendered values explicitly in the receiving template system.'});
  return implications;
}
