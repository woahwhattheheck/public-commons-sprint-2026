// MIT. Source-preserving routing, date policy, message rendering and reviewed handover.
import { copy,canonical,equal,fail,object,text,seal,verifySeal,entityId,MAX_PACKAGE_BYTES } from '../gis/shared.mjs';
import { has,choice,STAGES,SEMANTIC_FIELDS,RESIDENT_WORDING_FIELDS,customValue,permissionDeclarations,profileImplications } from './profile.mjs';
import { pointerValue,sourceRows,originalValue,sourceSummary } from './source.mjs';
import { calculateDueDate } from './calendar.mjs';
export const PREVIEW_SCHEMA='commons.open311.service-preview.v1';
export const RELEASE_SCHEMA='commons.open311.service-release.v1';
const missing=value=>value===undefined||value===null||value==='';
const display=value=>value===null||value===undefined?'':typeof value==='string'?value:typeof value==='object'?canonical(value):String(value);
function issue(issues,code,message,field=null,severity='error',details=null){issues.push({code,message,field,severity,...(details!==null?{details:copy(details)}:{})});}
function mapSource(sourceProfile,row,issues){
  const source={},observations={};
  for(const field of SEMANTIC_FIELDS){
    const mapping=sourceProfile.mapping[field];
    if(!mapping){observations[field]={found:false,basis:'UNMAPPED'};continue;}
    const selected=has(mapping,'literal')?{found:true,value:copy(mapping.literal)}:pointerValue(row,mapping.pointer);
    observations[field]={found:selected.found,basis:has(mapping,'literal')?'DECLARED_LITERAL':'ORIGINAL_POINTER',mapping:copy(mapping)};
    if(selected.found)source[field]=copy(selected.value);
  }
  if(!row||typeof row!=='object'||Array.isArray(row))issue(issues,'ORIGINAL_ROW_OBJECT_REQUIRED','A request mapping needs an original row object.','source');
  if(missing(source.requestId)||typeof source.requestId==='string'&&!source.requestId.trim()||!['string','number'].includes(typeof source.requestId))issue(issues,'REQUEST_ID_UNRESOLVED','Map an exact original request identifier.','requestId');
  for(const field of ['serviceCode','category','serviceName','status'])if(has(source,field)&&source[field]!==null&&!['string','number','boolean'].includes(typeof source[field]))issue(issues,'SEMANTIC_SCALAR_REQUIRED','The selected '+field+' must be an original scalar value.',field);
  return {source,observations};
}
function customFields(category,row,issues){
  const values={};
  for(const field of category?.customFields??[]){
    let selected=field.sourcePointer!==undefined?pointerValue(row,field.sourcePointer):{found:false,value:null},basis=selected.found?'ORIGINAL_POINTER':'UNMAPPED';
    if(!selected.found&&has(field,'defaultValue')){selected={found:true,value:copy(field.defaultValue)};basis='DECLARED_DEFAULT';}
    const checked=customValue(field,selected.found?selected.value:undefined);
    values[field.id]={field:copy(field),found:selected.found,basis,value:selected.found?copy(selected.value):null};
    if(!checked.valid)issue(issues,'CUSTOM_FIELD_UNRESOLVED',checked.message,'custom:'+field.id);
  }
  return values;
}
function routing(category,definition,sourceProfile,source,observations,custom,override,issues){
  const evaluations=[],matched=[];
  for(const route of definition.routes){
    if(!route.active||route.categoryIds.length&&!route.categoryIds.includes(category?.id)||route.sourceProfileIds.length&&!route.sourceProfileIds.includes(sourceProfile.id))continue;
    const conditions=route.selectors.map(selector=>{
      const field=selector.field,selected=field.startsWith('custom:')?custom[field.slice(7)]:{found:observations[field]?.found??false,value:has(source,field)?source[field]:null,basis:observations[field]?.basis??'UNMAPPED'};
      const found=selected?.found===true,actual=found?selected.value:null;
      const match=found&&(selector.operator==='equals'?equal(actual,selector.value):selector.values.some(value=>equal(actual,value)));
      return {...copy(selector),found,actual:copy(actual),basis:selected?.basis??'UNMAPPED',matched:match};
    });
    const applies=conditions.every(condition=>condition.matched);
    evaluations.push({routeId:route.id,matched:applies,conditions});if(applies)matched.push(route);
  }
  const explicitDepartment=override&&has(override,'departmentId'),explicitOwner=override&&has(override,'ownerStaffId');
  let departmentId=category?.departmentId??null,ownerStaffId=category?.ownerStaffId??null,collaboratorStaffIds=[],basis='CATEGORY_DEFAULT',unresolvedConflict=false;
  if(matched.length===1){departmentId=matched[0].departmentId??departmentId;ownerStaffId=matched[0].ownerStaffId??ownerStaffId;collaboratorStaffIds=copy(matched[0].collaboratorStaffIds);basis='PROPOSED_ROUTE';}
  else if(matched.length>1){
    if(explicitDepartment&&explicitOwner){basis='OPERATOR_OVERRIDE';issue(issues,'ROUTE_CONFLICT_RESOLVED','The operator selected department and owner after reviewing every matching route.','routing','info',{routeIds:matched.map(r=>r.id)});}
    else{unresolvedConflict=true;departmentId=null;ownerStaffId=null;basis='MULTIPLE_ROUTES';issue(issues,'MULTIPLE_MATCHING_ROUTES','More than one route matches. Select the intended department and owner explicitly.','routing','error',{routeIds:matched.map(r=>r.id)});}
  }
  const unevaluated=evaluations.filter(e=>e.conditions.some(c=>!c.found)&&e.conditions.every(c=>!c.found||c.matched));
  if(unevaluated.length){
    const details={routeIds:unevaluated.map(e=>e.routeId),matchedRouteIds:matched.map(r=>r.id)};
    if(explicitDepartment&&explicitOwner)issue(issues,'ROUTE_CONDITION_RESOLVED','The operator selected department and owner while retaining each unevaluated competing route.','routing','info',details);
    else{unresolvedConflict=true;departmentId=null;ownerStaffId=null;basis='UNEVALUATED_ROUTE';issue(issues,'ROUTE_CONDITION_UNRESOLVED','A potentially applicable route has an unmapped original condition. Review its mapping or explicitly select department and owner before adopting a route.','routing','error',details);}
  }
  if(explicitDepartment){departmentId=override.departmentId;basis='OPERATOR_OVERRIDE';}
  if(explicitOwner){ownerStaffId=override.ownerStaffId;basis='OPERATOR_OVERRIDE';}
  if(!departmentId)issue(issues,'UNASSIGNED_DEPARTMENT','Choose the responsible department.','departmentId');
  else if(!definition.departments.some(d=>d.id===departmentId&&d.active))issue(issues,'INACTIVE_DEPARTMENT','The proposed responsible department is inactive.','departmentId');
  if(!ownerStaffId)issue(issues,'UNASSIGNED_OWNER','Choose the responsible staff member.','ownerStaffId');
  else{
    const member=definition.staff.find(s=>s.id===ownerStaffId);
    if(!member?.active)issue(issues,'INACTIVE_OWNER','The proposed responsible staff member is inactive.','ownerStaffId');
    else if(departmentId&&!member.departmentIds.includes(departmentId))issue(issues,'OWNER_DEPARTMENT_MISMATCH','The proposed owner is not assigned to the selected department.','ownerStaffId');
  }
  for(const collaborator of collaboratorStaffIds)if(!definition.staff.some(s=>s.id===collaborator&&s.active))issue(issues,'INACTIVE_COLLABORATOR','A selected route collaborator is inactive.','collaboratorStaffIds','error',{staffId:collaborator});
  return {departmentId,ownerStaffId,collaboratorStaffIds,routeIds:matched.map(r=>r.id),basis,evaluations,unresolvedConflict,permissionDeclarations:ownerStaffId?permissionDeclarations(definition,ownerStaffId):[],templateIds:[...new Set([...(category?.templateIds??[]),...matched.flatMap(r=>r.templateIds)])]};
}
function visibility(category,sourceProfile,source,observations,override,issues){
  let value=category?.publicMapDefault??null,basis=category?'PROPOSED_CATEGORY_DEFAULT':'UNRESOLVED_CATEGORY',original=has(source,'publicMapOverride')?copy(source.publicMapOverride):null;
  if(original!==null&&original!==undefined){
    const mapping=sourceProfile.publicMapOverrideMapping?.values.find(v=>equal(v.sourceValue,original));
    if(!mapping){
      const resolved=override&&has(override,'publicMap');
      issue(issues,'VISIBILITY_VALUE_UNMAPPED',resolved?'The operator selected visibility while retaining the unmapped original per-request value.':'The original per-request visibility value has no explicit selected meaning.','publicMapOverride',resolved?'info':'error',resolved?{publicMap:override.publicMap,reason:override.reason}:null);
    }
    else if(mapping.publicMap!=='default'){value=mapping.publicMap;basis='ORIGINAL_REQUEST_OVERRIDE';}
    else basis='ORIGINAL_REQUEST_DEFAULT';
  }
  if(override&&has(override,'publicMap')){value=override.publicMap;basis='OPERATOR_OVERRIDE';}
  return {value,basis,originalValue:original,originalMapping:copy(sourceProfile.publicMapOverrideMapping),inputBasis:observations.publicMapOverride?.basis??'UNMAPPED'};
}
function dateFor(source,resolutionDays,agency,issues){
  try{return calculateDueDate(source.createdAt??null,resolutionDays,agency);}
  catch(error){issue(issues,error.code??'DUE_DATE_UNRESOLVED',error.message,'createdAt');return {date:null,timeZone:agency.timeZone,calendar:copy(agency.calendar),sourceCreatedAt:source.createdAt??null,createdLocalDate:null};}
}
function localDate(value,agency){if(missing(value))return null;try{return calculateDueDate(value,0,agency).createdLocalDate;}catch{return null;}}
function renderTemplate(template,context){
  const {definition,source,category,routing,due,issues}=context;
  const owner=definition.staff.find(s=>s.id===routing.ownerStaffId),department=definition.departments.find(d=>d.id===routing.departmentId);
  const values={
    agency_name:definition.agency.name,issue_number:source.issueNumber??null,case_number:source.caseNumber??null,
    service_category:category?.name??null,department_name:department?.name??null,assignee_name:owner?.name??null,
    request_created_date:due.createdLocalDate,request_updated_date:localDate(source.updatedAt,definition.agency),due_date:due.date,
    source_status:source.status??null,source_status_notes:source.statusNotes??null,location:source.address??null,
    work_order_ids:source.workOrderIds??null,completion_note:source.completionNote??null,progress_summary:source.progressSummary??null,magic_link:source.magicLink??null
  };
  const unresolved=new Map(),used=new Set(),bindings={};
  function tokenValue(token){
    used.add(token);let value=values[token],basis='SELECTED_SOURCE_OR_CONFIGURATION';
    if(template.audience==='resident'&&RESIDENT_WORDING_FIELDS.includes(token)){
      value=template.residentWording?.[token];basis='EXPLICIT_RESIDENT_WORDING';
      if(missing(value))unresolved.set(token,'Enter explicit resident wording for the selected owner or internal progress value.');
    }
    if(token==='magic_link'&&!missing(value)){
      try{const u=new URL(String(value));if(typeof value!=='string'||u.protocol!=='https:'||u.username||u.password)throw Error();}catch{unresolved.set(token,'Map an explicit permitted HTTPS citizen link.');}
    }
    if(missing(value))unresolved.set(token,unresolved.get(token)??'The selected placeholder has no mapped or configured value.');
    if(value!==null&&value!==undefined&&typeof value==='object'&&token!=='work_order_ids')unresolved.set(token,'The selected placeholder must resolve to plain text or a scalar.');
    bindings[token]={basis,value:missing(value)?null:copy(value)};
    return unresolved.has(token)?'{{'+token+'}}':Array.isArray(value)?value.map(display).join(', '):display(value);
  }
  const render=input=>input.replace(/\{\{([^{}]+)\}\}/g,(_,token)=>tokenValue(token)),subject=render(template.subject),body=render(template.body);
  for(const [token,message] of unresolved)issue(issues,'MESSAGE_TOKEN_UNRESOLVED',message,'template:'+template.id+':'+token,'error');
  const recipient=template.audience==='resident'?source.residentEmail??null:owner?.contact||null;
  return {id:template.id,name:template.name,audience:template.audience,stage:template.stage,subject,body,locale:template.locale,recipient:copy(recipient),state:unresolved.size?'unresolved':'rendered',unresolved:[...unresolved].map(([token,message])=>({token,message})),bindings,documentedNativeTokens:[...used].filter(t=>['issue_number','case_number'].includes(t)),deliveryState:'PREVIEW'};
}
function normalizedOverrides(input,definition,rows){
  if(input===undefined)return [];
  if(!Array.isArray(input)||input.length>rows.length)fail('INVALID_OVERRIDES','Choose explicit overrides for original rows.');
  const keys=new Set(rows.map(r=>r.key)),seen=new Set();
  return input.map(raw=>{
    object(raw,'Original-row override');const value={sourceKey:text(raw.sourceKey,'Original source key',200),reason:text(raw.reason,'Override reason',100000)};
    if(!keys.has(value.sourceKey)||seen.has(value.sourceKey))fail('OVERRIDE_SOURCE_KEY','Each override must select a distinct row from this exact original source.',400,{sourceKey:value.sourceKey});seen.add(value.sourceKey);
    const allowed=['sourceKey','reason','categoryId','departmentId','ownerStaffId','publicMap','stage'];for(const key of Object.keys(raw))if(!allowed.includes(key))fail('UNKNOWN_OVERRIDE_FIELD','Use a declared per-request override field.',400,{key});
    for(const [key,kind] of [['categoryId','categories'],['departmentId','departments'],['ownerStaffId','staff']])if(has(raw,key)){
      if(raw[key]!==null&&!definition[kind].some(item=>item.id===raw[key]))fail('UNKNOWN_OVERRIDE_REFERENCE','The override must select a saved profile reference.',400,{key,value:raw[key]});
      value[key]=raw[key];
    }
    if(has(raw,'publicMap'))value.publicMap=choice(raw.publicMap,['show','hide'],'Operator public-map setting');
    if(has(raw,'stage'))value.stage=choice(raw.stage,STAGES,'Operator message stage');
    if(Object.keys(value).length===2)fail('EMPTY_OVERRIDE','Select at least one changed category, responsibility, stage or visibility setting.');
    return value;
  });
}
export function createPreview(input,{id,createdAt},{profile,source,baseline=null}){
  const definition=profile.definition,selectedProfileId=text(input.mapping?.sourceProfileId,'Source-profile selection',200),sourceProfile=definition.sourceProfiles.find(s=>s.id===selectedProfileId);
  if(!sourceProfile)fail('SOURCE_PROFILE_NOT_FOUND','Choose a source profile from this exact configuration.');
  if(sourceProfile.rowsPointer!==source.selection.rowsPointer)fail('SOURCE_SELECTION_MISMATCH','The retained source array and selected profile row pointer must match exactly.',400,{saved:source.selection.rowsPointer,configured:sourceProfile.rowsPointer});
  const original=originalValue(source.originalText),knownSchemas={follow_through_dispatch_v1:'commons.open311.follow-through-dispatch.v1',field_destination_update_v1:'commons.open311.field-destination-update.v1'};
  if(knownSchemas[sourceProfile.kind])verifySeal(original,knownSchemas[sourceProfile.kind]);
  const originals=sourceRows(source),overrides=normalizedOverrides(input.overrides,definition,originals),overrideMap=new Map(overrides.map(v=>[v.sourceKey,v]));
  const items=originals.map(row=>{
    const issues=[],mapped=mapSource(sourceProfile,row.value,issues),values=mapped.source,observations=mapped.observations,override=overrideMap.get(row.key)??null;
    const matched=definition.categories.filter(category=>category.active&&category.sourceSelectors.some(selector=>selector.sourceProfileId===sourceProfile.id&&observations[selector.field]?.found&&equal(values[selector.field],selector.value)));
    let category=matched.length===1?matched[0]:null,categoryConflict=matched.length>1,categoryBasis=matched.length===1?'ORIGINAL_CATEGORY_SELECTOR':matched.length>1?'MULTIPLE_CATEGORIES':'UNMATCHED';
    if(override&&has(override,'categoryId')){category=definition.categories.find(c=>c.id===override.categoryId)??null;categoryConflict=false;categoryBasis='OPERATOR_OVERRIDE';}
    if(category&&!category.active)issue(issues,'INACTIVE_CATEGORY','The selected category is inactive.','categoryId');
    if(categoryConflict)issue(issues,'MULTIPLE_MATCHING_CATEGORIES','More than one active category matches this exact original value. Select the intended category.','categoryId','error',{categoryIds:matched.map(c=>c.id)});
    else if(!category)issue(issues,'CATEGORY_UNMATCHED','The original request has no resolved category. Select an exact source mapping or explicit override.','categoryId');
    const fields=customFields(category,row.value,issues);
    let route={departmentId:null,ownerStaffId:null,collaboratorStaffIds:[],routeIds:[],basis:'UNRESOLVED_CATEGORY',evaluations:[],unresolvedConflict:false,permissionDeclarations:[],templateIds:[]};
    if(category)route=routing(category,definition,sourceProfile,values,observations,fields,override,issues);
    const nativeStatus=sourceProfile.statusMappings.find(m=>observations.status?.found&&equal(m.sourceValue,values.status)),stage=override?.stage??nativeStatus?.stage??null;
    if(!stage)issue(issues,'STATUS_MEANING_UNMAPPED','Map the exact original status to an explicit message stage.','status');
    const due=dateFor(values,category?.resolutionDays??null,definition.agency,issues);
    if(category?.locationRequired){
      const address=typeof values.address==='string'&&values.address.trim(),coordinates=typeof values.latitude==='number'&&typeof values.longitude==='number'&&Number.isFinite(values.latitude)&&Number.isFinite(values.longitude)&&Math.abs(values.latitude)<=90&&Math.abs(values.longitude)<=180;
      if(!address&&!coordinates)issue(issues,'LOCATION_REQUIRED','This category needs an original mapped address or valid numeric coordinates.','address');
    }
    const publicMap=visibility(category,sourceProfile,values,observations,override,issues),selectedTemplates=definition.templates.filter(t=>route.templateIds.includes(t.id)),templates=selectedTemplates.filter(t=>t.active&&t.stage===stage).map(t=>renderTemplate(t,{definition,source:values,category,routing:route,due,issues}));
    const state=categoryConflict||route.unresolvedConflict?'conflict':!category?'unmatched':issues.some(i=>i.severity==='error')?'invalid':'ready';
    return {id:entityId('preview-row',{previewId:id,sourceKey:row.key}),sourceKey:row.key,sourceIndex:row.index,sourcePointer:row.pointer,serviceRequestId:missing(values.requestId)?null:display(values.requestId),source:copy(values),mappingObservations:observations,category:category?{id:category.id,name:category.name,active:category.active}:null,categoryBasis,matchedCategoryIds:matched.map(c=>c.id),customFields:fields,routing:route,due,publicMap,stage,stageBasis:override?.stage?'OPERATOR_OVERRIDE':nativeStatus?'ORIGINAL_STATUS_MAPPING':'UNMAPPED',completionMeaning:nativeStatus?.completionMeaning??null,templates,templateSelection:selectedTemplates.map(t=>({id:t.id,active:t.active,stage:t.stage,applicable:t.active&&t.stage===stage})),override:copy(override),issues,state};
  });
  const counts={ready:0,unmatched:0,conflict:0,invalid:0};for(const item of items)counts[item.state]++;
  const diagnostics={unassigned:items.filter(r=>!r.routing.ownerStaffId||!r.routing.departmentId).length,unresolvedDates:items.filter(r=>r.issues.some(i=>i.field==='createdAt')).length,unresolvedMessageTokens:items.reduce((n,r)=>n+r.templates.reduce((m,t)=>m+t.unresolved.length,0),0),visibilityIssues:items.filter(r=>r.issues.some(i=>i.field==='publicMapOverride')).length};
  const implicationBaseline=baseline?{profile:baseline.profile,declaredBy:baseline.declaredBy,note:baseline.note}:null;
  const preview=seal({schema:PREVIEW_SCHEMA,id,name:text(input.name,'Preview name',1000),profileId:profile.id,profileVersionId:profile.versionId,profileSha256:profile.sha256,sourceId:source.id,sourceSha256:source.sha256,originalFile:copy(source.originalFile),sourceProfileId:sourceProfile.id,createdAt,rowCount:items.length,counts,diagnostics,mapping:copy(input.mapping),overrides,baseline:baseline?{profileId:baseline.profile.id,profileVersionId:baseline.profile.versionId,profileSha256:baseline.profile.sha256,declaredBy:baseline.declaredBy,note:baseline.note}:null,implications:profileImplications(profile,implicationBaseline),items});
  if(Buffer.byteLength(canonical(preview))>MAX_PACKAGE_BYTES)fail('PREVIEW_SIZE','The complete retained routing preview exceeds 256 MiB.',413);
  return preview;
}
export const previewSummary=p=>({schema:p.schema,id:p.id,name:p.name,profileId:p.profileId,profileVersionId:p.profileVersionId,sourceId:p.sourceId,sourceSha256:p.sourceSha256,sourceProfileId:p.sourceProfileId,createdAt:p.createdAt,rowCount:p.rowCount,counts:copy(p.counts),diagnostics:copy(p.diagnostics),sha256:p.sha256});
export function createRelease(input,{id,createdAt},{profile,preview,source,baseline=null}){
  const definition=profile.definition,reviewer=text(input.reviewer,'Handover reviewer',300),note=text(input.note??'','Handover note',100000,{empty:true});
  const applyOrder=[
    {stage:1,name:'Agency calendar and departments',definitions:{agency:copy(definition.agency),departments:copy(definition.departments)}},
    {stage:2,name:'Permission migration and staff membership',definitions:{roles:copy(definition.roles),groups:copy(definition.groups),staff:copy(definition.staff)},implications:copy(preview.implications.filter(i=>/PERMISSION|ASSOCIATED|BASELINE/.test(i.code)))},
    {stage:3,name:'Categories, intake fields and public visibility',definitions:copy([...definition.categories].sort((a,b)=>Number(b.isOther)-Number(a.isOther)||a.displayOrder-b.displayOrder||a.id.localeCompare(b.id)))},
    {stage:4,name:'Original source adapters and responsibility routing',definitions:{sourceProfiles:copy(definition.sourceProfiles),routes:copy(definition.routes)},implications:copy(preview.implications.filter(i=>i.code==='PROVIDER_NEUTRAL_ROUTE_EXTENSION'))},
    {stage:5,name:'Stage messages and receiving-system tokens',definitions:copy(definition.templates),implications:copy(preview.implications.filter(i=>i.code==='MESSAGE_TOKEN_BINDING'))},
    {stage:6,name:'Named rollout, training and acceptance',definitions:copy(definition.rollout)}
  ];
  const release=seal({schema:RELEASE_SCHEMA,id,name:text(input.name,'Handover name',1000),createdAt,reviewer,note,state:'PREPARED_FOR_APPLICATION',profileId:profile.id,profileVersionId:profile.versionId,profileSha256:profile.sha256,previewId:preview.id,previewSha256:preview.sha256,sourceId:source.id,sourceSha256:source.sha256,counts:copy(preview.counts),implications:copy(preview.implications),applyOrder,profile:copy(profile),preview:copy(preview),source:copy(source),baseline:baseline?copy(baseline):null,remaining:preview.items.filter(item=>item.state!=='ready').map(item=>({sourceKey:item.sourceKey,serviceRequestId:item.serviceRequestId,state:item.state,issues:copy(item.issues)}))});
  if(Buffer.byteLength(canonical(release))>MAX_PACKAGE_BYTES)fail('RELEASE_SIZE','The complete editable implementation handover exceeds 256 MiB.',413);
  return release;
}
export const releaseSummary=r=>({schema:r.schema,id:r.id,name:r.name,createdAt:r.createdAt,reviewer:r.reviewer,note:r.note,state:r.state,profileId:r.profileId,profileVersionId:r.profileVersionId,previewId:r.previewId,sourceId:r.sourceId,counts:copy(r.counts),sha256:r.sha256});
