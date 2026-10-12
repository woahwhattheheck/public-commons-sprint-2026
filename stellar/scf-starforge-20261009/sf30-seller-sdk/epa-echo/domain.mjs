// MIT. Lossless EPA source projections, retained edition comparisons and complete exports.
import {parseExactJSON} from '../stellar-expert/exact-json.mjs';
import {stable,jsonBytes} from '../stellar-expert/store.mjs';
import {csvBytes} from '../stellar-expert/domain.mjs';
import {hashBytes,fault,decodeSource} from './provider.mjs';
import {COLUMNS,SOURCE_CONTRACT,SOURCE_PACKAGE_SCHEMA} from './schema.mjs';

const own=(o,k)=>o!==null&&typeof o==='object'&&Object.hasOwn(o,k);
const object=o=>o!==null&&typeof o==='object'&&!Array.isArray(o);
const list=o=>Array.isArray(o)?o:[];
const string=v=>v===undefined?'':v===null?'null':typeof v==='object'?JSON.stringify(v):String(v);
const optional=v=>v===undefined||v===null?'':string(v);
const valueType=v=>v===null?'null':Array.isArray(v)?'array':typeof v;
const at=(o,keys)=>{for(const k of keys)if(own(o,k))return o[k];return undefined;};
const pointer=k=>String(k).replaceAll('~','~0').replaceAll('/','~1');
const MAX_ROWS=250000;
const cache=new WeakMap();

// Calendar validation is independent of the host timezone and Date rollover.
// Original literals remain visible even when no valid Gregorian date can be produced.
export function isoDate(value) {
  if(typeof value!=='string')return '';
  let year,month,day,m=/^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if(m)[,year,month,day]=m.map(Number);
  else {m=/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);if(!m)return '';month=Number(m[1]);day=Number(m[2]);year=Number(m[3]);}
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  if(year<1||year>9999||month<1||month>12||day<1||day>days[month-1])return '';
  return String(year).padStart(4,'0')+'-'+String(month).padStart(2,'0')+'-'+String(day).padStart(2,'0');
}
function provenance(page) {
  return {sourcePageSha256:page.sha256,sourceObservedAt:page.sourceObservedAt??page.finishedAt??'',
    sourceUrl:page.url??''};
}
function row(table,values,page) {
  const out=Object.fromEntries(COLUMNS[table].map(k=>[k,'']));
  for(const [k,v]of Object.entries(values))if(own(out,k))out[k]=optional(v);
  return Object.assign(out,provenance(page));
}
function identity(node,parent={}) {
  const next={...parent};
  if(object(node)){
    if(own(node,'Statute'))next.statute=optional(node.Statute);
    else if(own(node,'StatuteCode'))next.statute=optional(node.StatuteCode);
    if(own(node,'EPASystem'))next.epaSystem=optional(node.EPASystem);
    const source=at(node,['SourceID','SourceId','sourceId']);
    if(source!==undefined)next.sourceId=optional(source);
  }
  return next;
}
function originalRecordId(record) {
  return optional(at(record,['CompMonitorID','NPDESViolationId','ViolationActivityID','InspectionID','InspectionId','ActivityID','ActivityId','ActionID','ActionId',
    'EnforcementActionID','CaseID','CaseId','CaseNumber','CaseNum','ViolationID','ViolationId','EnfIdentifier','EventID','EventId']));
}
function *leaves(exact,typed,path,context={},segments=[]) {
  const next=identity(exact,context);
  if(exact===null||typeof exact!=='object'||Object.keys(exact).length===0){
    yield {value:string(exact),valueType:valueType(typed),sourcePath:path,field:segments.at(-1)??'',
      context:next,segments,exact,typed};
    return;
  }
  for(const k of Object.keys(exact))yield *leaves(exact[k],typed?.[k],path+'/'+pointer(k),next,[...segments,k]);
}
function scalar(record,keys){return optional(at(record,keys));}
function ownPeriod(section,statute,sourceId) {
  const candidates=list(section?.ProgramDates).filter(d=>{
    const sid=at(d,['SourceID','SourceId']);
    if(sid!==undefined&&optional(sid)!==sourceId)return false;
    return own(d,'Program')?statute!==''&&optional(d.Program)===statute:
      own(d,'Statute')?statute!==''&&optional(d.Statute)===statute:
      sid!==undefined&&sourceId!=='';
  });
  const values=candidates.map(d=>({
    periodStart:scalar(d,['StartDate','StartDate3Yr','PeriodStart']),
    periodEnd:scalar(d,['EndDate','PeriodEnd'])
  }));
  const unique=new Map(values.map(v=>[stable(v),v]));
  const value=unique.size===1?[...unique.values()][0]:{periodStart:'',periodEnd:''};
  return {...value,periodStartIso:isoDate(value.periodStart),periodEndIso:isoDate(value.periodEnd)};
}
function dateFields(start,end){
  return {periodStart:optional(start),periodEnd:optional(end),
    periodStartIso:isoDate(start),periodEndIso:isoDate(end)};
}
function quarterHeaders(section) {
  const records=[];
  function visit(node,context={}){
    if(!object(node)&&!Array.isArray(node))return;
    const next=identity(node,context);
    if(object(node)&&Object.keys(node).some(k=>/^Qtr[1-9]\d*(?:Start|End)$/i.test(k)))
      records.push({node,context:next});
    // Header nesting is original provider structure, not a search across other sections.
    for(const [k,v]of Object.entries(node)){
      if(k==='Header'||k==='Headers'||Array.isArray(node))visit(v,next);
    }
  }
  visit(section);
  return records;
}
function quarterPeriod(headers,index,context) {
  const names=[['Qtr'+index+'Start','Qtr'+index+'End']];
  let matching=headers.filter(h=>
    (!h.context.sourceId||h.context.sourceId===context.sourceId)&&
    (!h.context.statute||h.context.statute===context.statute));
  const specific=matching.filter(h=>h.context.sourceId&&h.context.sourceId===context.sourceId);
  if(specific.length)matching=specific;
  const values=matching.map(h=>{
    const keys=Object.keys(h.node),start=keys.find(k=>k.toLowerCase()===names[0][0].toLowerCase()),
      end=keys.find(k=>k.toLowerCase()===names[0][1].toLowerCase());
    return dateFields(start===undefined?undefined:h.node[start],end===undefined?undefined:h.node[end]);
  }).filter(v=>v.periodStart!==''||v.periodEnd!=='');
  const unique=new Map(values.map(v=>[stable(v),v]));
  return unique.size===1?[...unique.values()][0]:dateFields(undefined,undefined);
}
function sourceDates(report,statute,sourceId) {
  const permits=list(report.Permits).filter(p=>optional(p.SourceID)===sourceId&&optional(p.Statute)===statute);
  const systems=[...new Set(permits.map(p=>optional(p.EPASystem)).filter(Boolean))];
  const dates=list(report.SystemExtractDates?.Dates).filter(d=>systems.includes(optional(d.EPASystem)));
  const unique=[...new Set(dates.map(d=>optional(d.SystemExtractDate)))];
  return unique.length===1?{systemExtractDate:unique[0],systemExtractDateIso:isoDate(unique[0])}:
    {systemExtractDate:'',systemExtractDateIso:''};
}
function selectedIds(edition) {
  const ids=edition?.selection?.facilityIds;
  if(!Array.isArray(ids)||ids.some(id=>typeof id!=='string'||!/^\d{12}$/.test(id))||new Set(ids).size!==ids.length)
    throw fault('ECHO_EDITION_SELECTION','Use a retained edition with ordered distinct native FRS identifiers.',409);
  return ids;
}
async function loadEdition(store,edition) {
  const ids=selectedIds(edition),pages=list(edition.pages);
  const cacheKey=stable({id:edition.id,ids,pages:pages.map(p=>[p.kind,p.facilityId,p.sha256,p.bytes,p.sourceObservedAt,p.url])});
  let records=cache.get(store);if(!records){records=new Map();cache.set(store,records);}
  if(records.has(cacheKey))return records.get(cacheKey);
  const pending=(async()=>{
    const reports=new Map(),search=new Map(),ancillary=[];
    for(const page of pages){
      if(page.kind==='facility-report'&&!ids.includes(page.facilityId))continue;
      const bytes=await store.object(page.sha256);
      if(page.bytes!==undefined&&bytes.length!==page.bytes)
        throw fault('ECHO_SOURCE_CHANGED','A retained response differs from its recorded byte count.',409);
      const decoded=decodeSource(bytes,page.kind,{facilityId:page.facilityId});
      const data=decoded.data,typed=decoded.typed;
      if(page.kind==='facility-report'){
        const report=data?.Results,typedReport=typed?.Results;
        if(!object(report)||optional(report.RegistryID)!==page.facilityId||reports.has(page.facilityId))
          throw fault('ECHO_REPORT_IDENTITY','Select one complete original report for each retained native FRS identifier.',409);
        reports.set(page.facilityId,{facilityId:page.facilityId,report,typed:typedReport,page,duplicates:list(decoded.duplicates)});
      }else if(page.kind==='search'){
        for(const facility of list(data?.Results?.Facilities)){
          const id=optional(facility.RegistryID);
          if(ids.includes(id)&&!search.has(id))search.set(id,facility);
        }
      }else if(page.kind==='source-metadata'||page.kind==='service-contract')ancillary.push({data,typed,page});
    }
    return {ids,reports,search,ancillary};
  })();
  records.set(cacheKey,pending);
  if(records.size>4)records.delete(records.keys().next().value);
  try{return await pending;}catch(error){records.delete(cacheKey);throw error;}
}
function facilityRow(item,search) {
  const r=item.report,frs=list(r.Permits).find(p=>p.EPASystem==='FRS'&&optional(p.SourceID)===item.facilityId);
  const q=search.get(item.facilityId),p=frs??{};
  const choose=(record,key,fallback)=>own(record,key)?record[key]:fallback;
  return row('facilities',{facilityId:item.facilityId,
    facilityName:choose(p,'FacilityName',q?.FacName),
    street:choose(p,'FacilityStreet',q?.FacStreet),city:choose(p,'FacilityCity',q?.FacCity),
    state:choose(p,'FacilityState',q?.FacState),zip:choose(p,'FacilityZip',q?.FacZip),
    county:choose(p,'FacilityCountyName',q?.FacCounty),
    latitude:choose(r.SpatialMetadata,'Latitude83',p.Latitude),
    longitude:choose(r.SpatialMetadata,'Longitude83',p.Longitude),
    permitCount:String(list(r.Permits).length),
    programmes:[...new Set(list(r.Permits).map(p=>optional(p.Statute)).filter(Boolean))].join(', '),
    sourceMessage:r.Message},item.page);
}
function *permitRows(item,search) {
  const name=facilityRow(item,search).facilityName;
  for(const [i,p]of list(item.report.Permits).entries()){
    yield row('permits',{facilityId:item.facilityId,facilityName:p.FacilityName??name,
      statute:p.Statute,epaSystem:p.EPASystem,sourceId:p.SourceID,facilityStatus:p.FacilityStatus,
      universe:p.Universe,areas:p.Areas,expirationDate:p.ExpDate,expirationDateIso:isoDate(p.ExpDate),
      latitude:p.Latitude,longitude:p.Longitude,datum:p.HdatumDesc,naics:p.NAICS,sic:p.SIC,
      sourcePath:'/Results/Permits/'+i,recordJson:JSON.stringify(p)},item.page);
  }
}
function *complianceRows(item) {
  const section=item.report.ComplianceSummary;
  for(const [i,r]of list(section?.Source).entries()){
    const context=identity(r),statute=context.statute??'',sourceId=context.sourceId??'';
    yield row('compliance',{facilityId:item.facilityId,statute,sourceId,currentSNC:r.CurrentSNC,
      description:r.Description,currentAsOf:r.CurrentAsOf,currentAsOfIso:isoDate(r.CurrentAsOf),
      quartersInNoncompliance:r.QtrsInNC,...ownPeriod(section,statute,sourceId),
      ...sourceDates(item.report,statute,sourceId),sourcePath:'/Results/ComplianceSummary/Source/'+i,
      recordJson:JSON.stringify(r)},item.page);
  }
}
function *quarterRows(item,selectedSection) {
  for(const [sectionName,section]of Object.entries(item.report)){
    if(selectedSection&&sectionName!==selectedSection||!object(section))continue;
    const headers=quarterHeaders(section);
    function *walk(node,typed,path,context={},currentRecord=null,currentField=''){
      const next=identity(node,context);
      if(node===null||typeof node!=='object'||Object.keys(node).length===0){
        const m=/^Qtr([1-9]\d*)/i.exec(currentField);
        if(!m)return;
        const period=quarterPeriod(headers,m[1],next),record=currentRecord??{};
        yield row('quarters',{facilityId:item.facilityId,statute:next.statute??'',sourceId:next.sourceId??'',
          section:sectionName,periodIndex:m[1],...period,field:currentField,
          value:string(node),valueType:valueType(typed),recordId:originalRecordId(record),
          sourcePath:path,recordJson:JSON.stringify(record)},item.page);
        return;
      }
      const record=object(node)?node:currentRecord;
      for(const [key,value]of Object.entries(node)){
        if(key==='Header'||key==='Headers'||key==='ProgramDates'||/^Qtr[1-9]\d*(?:Start|End)$/i.test(key))continue;
        const field=/^Qtr[1-9]\d*/i.test(key)?key:currentField?(currentField+'.'+key):'';
        yield *walk(value,typed?.[key],path+'/'+pointer(key),next,record,field);
      }
    }
    yield *walk(section,item.typed?.[sectionName],'/Results/'+pointer(sectionName));
  }
}
function *inspectionRows(item) {
  const section=item.report.ComplianceHistory;
  for(const [i,r]of list(section?.Inspection).entries()){
    const context=identity(r),statute=context.statute??'',sourceId=context.sourceId??'';
    const date=at(r,['Date','InspectionDate','ActivityDate','DateOfInspection','StartDate']);
    yield row('inspections',{facilityId:item.facilityId,statute,epaSystem:context.epaSystem??'',sourceId,
      section:'ComplianceHistory',date,dateIso:isoDate(date),
      type:at(r,['Type','InspectionType','ActivityType','InspectionTypeDesc']),
      agency:at(r,['Agency','LeadAgency','AgencyType','AgencyName']),
      description:at(r,['Finding','Description','InspectionDescription','InspectionTypeDesc','Comments']),
      recordId:originalRecordId(r),...ownPeriod(section,statute,sourceId),
      sourcePath:'/Results/ComplianceHistory/Inspection/'+i,recordJson:JSON.stringify(r)},item.page);
  }
}
function *enforcementRows(item,selectedSection) {
  for(const sectionName of ['Notices','FormalActions','ICISFormalActions','CaseFormalActions']){
    if(selectedSection&&sectionName!==selectedSection)continue;
    const section=item.report[sectionName],collection=sectionName==='Notices'?'Notice':'Action';
    for(const [i,r]of list(section?.[collection]).entries()){
      const context=identity(r),statute=context.statute??'',sourceId=context.sourceId??'';
      const date=at(r,['Date','ActionDate','ActivityDate','NoticeDate','EnforcementDate','IssueDate','SettlementDate','DateIssued']);
      yield row('enforcement',{facilityId:item.facilityId,statute,epaSystem:context.epaSystem??'',sourceId,
        section:sectionName,date,dateIso:isoDate(date),
        type:at(r,['Type','ActionType','EnforcementActionType','ActivityType','NoticeType','CaseType']),
        agency:at(r,['Agency','LeadAgency','AgencyType','AgencyName']),
        caseNumber:at(r,['CaseNumber','CaseNum','CaseID','EnforcementIdentifier']),
        penalty:at(r,['Penalty','PenaltyAmount','TotalPenalty','TotalPenalties','FederalPenalty','FedPenalty']),
        description:at(r,['Description','ActionDescription','ActivityName','CaseName','Name','Comments']),
        recordId:originalRecordId(r),...ownPeriod(section,statute,sourceId),
        sourcePath:'/Results/'+sectionName+'/'+collection+'/'+i,recordJson:JSON.stringify(r)},item.page);
    }
  }
}
function *metadataRows(item,selectedSection) {
  for(const [sectionName,section]of Object.entries(item.report)){
    if(selectedSection&&sectionName!==selectedSection)continue;
    const typed=item.typed?.[sectionName],base='/Results/'+pointer(sectionName);
    if(sectionName==='SystemExtractDates'){
      for(const leaf of leaves(section,typed,base))
        yield row('metadata',{facilityId:item.facilityId,section:sectionName,epaSystem:leaf.context.epaSystem??'',
          field:leaf.field,value:leaf.value,valueType:leaf.valueType,sourcePath:leaf.sourcePath},item.page);
      continue;
    }
    if(!object(section))continue;
    for(const [key,value]of Object.entries(section)){
      if(!['ProgramDates','Header','Headers'].includes(key)&&!/^Qtr[1-9]\d*(?:Start|End)$/i.test(key))continue;
      for(const leaf of leaves(value,typed?.[key],base+'/'+pointer(key),{},[key]))
        yield row('metadata',{facilityId:item.facilityId,section:sectionName,epaSystem:leaf.context.epaSystem??'',
          field:leaf.field,value:leaf.value,valueType:leaf.valueType,sourcePath:leaf.sourcePath},item.page);
    }
  }
}
function duplicateContext(report,path) {
  const parts=path.split('/').slice(1).map(k=>k.replaceAll('~1','/').replaceAll('~0','~'));
  let node={Results:report},context={};
  for(const part of parts.slice(0,-1)){node=node?.[part];context=identity(node,context);}
  return {context,parts};
}
function *sourceFieldRows(item,selectedSection) {
  for(const [sectionName,section]of Object.entries(item.report)){
    if(selectedSection&&sectionName!==selectedSection)continue;
    for(const leaf of leaves(section,item.typed?.[sectionName],'/Results/'+pointer(sectionName),{},[sectionName])){
      yield row('source-fields',{facilityId:item.facilityId,statute:leaf.context.statute??'',
        sourceId:leaf.context.sourceId??'',section:sectionName,sourcePath:leaf.sourcePath,field:leaf.field,
        value:leaf.value,valueType:leaf.valueType},item.page);
    }
  }
  // EPA repeats some identical empty members. Each original later occurrence
  // remains an additional row with the same JSON pointer, rather than disappearing.
  for(const duplicate of item.duplicates??[]){
    if(typeof duplicate.path!=='string'||!duplicate.path.startsWith('/Results/'))continue;
    const {context,parts}=duplicateContext(item.report,duplicate.path),sectionName=parts[1];
    if(selectedSection&&selectedSection!==sectionName)continue;
    for(const leaf of leaves(duplicate.value,duplicate.typed,duplicate.path,context,parts.slice(1)))
      yield row('source-fields',{facilityId:item.facilityId,statute:leaf.context.statute??'',
        sourceId:leaf.context.sourceId??'',section:sectionName,sourcePath:leaf.sourcePath,field:leaf.field,
        value:leaf.value,valueType:leaf.valueType},item.page);
  }
}
function *projectRows(loaded,table,{facilityId,section}={}) {
  for(const id of loaded.ids){
    if(facilityId&&id!==facilityId)continue;
    const item=loaded.reports.get(id);if(!item)continue;
    if(table==='facilities')yield facilityRow(item,loaded.search);
    else if(table==='permits')yield *permitRows(item,loaded.search);
    else if(table==='compliance')yield *complianceRows(item);
    else if(table==='quarters')yield *quarterRows(item,section);
    else if(table==='inspections')yield *inspectionRows(item);
    else if(table==='enforcement')yield *enforcementRows(item,section);
    else if(table==='metadata')yield *metadataRows(item,section);
    else if(table==='source-fields')yield *sourceFieldRows(item,section);
  }
  if(table==='metadata'&&!facilityId){
    for(const source of loaded.ancillary){
      const name=source.page.kind==='service-contract'?'ServiceContract':'ServiceMetadata';
      if(section&&section!==name)continue;
      for(const leaf of leaves(source.data,source.typed,'')){
        yield row('metadata',{facilityId:'',section:name,epaSystem:'',field:leaf.field,
          value:leaf.value,valueType:leaf.valueType,sourcePath:leaf.sourcePath},source.page);
      }
    }
  }
}
export async function editionRows(store,edition,{table='facilities',facilityId,section,offset=0,limit=500}={}) {
  if(!own(COLUMNS,table))throw fault('ECHO_TABLE','Choose one of the retained EPA tables.');
  if(!Number.isSafeInteger(offset)||offset<0||!Number.isSafeInteger(limit)||limit<1||limit>MAX_ROWS)
    throw fault('ECHO_ROWS_RANGE','Choose a nonnegative row offset and a limit between 1 and 250000.');
  const loaded=await loadEdition(store,edition);
  if(facilityId!==undefined&&(!loaded.ids.includes(facilityId)))
    throw fault('ECHO_FACILITY_SELECTION','Select an original facility from this edition.',404);
  if(section!==undefined&&(typeof section!=='string'||section.length>200))
    throw fault('ECHO_SECTION','Use a retained original report section name.');
  let total=0;const rows=[];
  for(const r of projectRows(loaded,table,{facilityId,section})){
    if(total>=offset&&rows.length<limit)rows.push(r);total++;
  }
  return {schema:'stellar-forge.epa-echo-rows.v1',editionId:edition.id,table,
    facilityId:facilityId??null,section:section??null,columns:[...COLUMNS[table]],rows,total,offset,limit,
    complete:offset===0&&rows.length===total,nextOffset:offset+rows.length<total?offset+rows.length:null};
}
function summaryFor(loaded,item) {
  const facility=facilityRow(item,loaded.search),tableCounts={};
  for(const table of Object.keys(COLUMNS)){
    let n=0;for(const unused of projectRows(loaded,table,{facilityId:item.facilityId}))n++;
    tableCounts[table]=n;
  }
  const compliance=list(item.report.ComplianceSummary?.Source);
  return {facilityId:item.facilityId,facilityName:facility.facilityName,captured:true,facility,
    permitCount:list(item.report.Permits).length,programmes:[...new Set(list(item.report.Permits).map(p=>optional(p.Statute)).filter(Boolean))],
    sourceMessage:optional(item.report.Message),complianceSources:compliance,
    reportedCurrentSNC:compliance.filter(r=>r.CurrentSNC==='Yes').length,
    systemExtractDates:item.report.SystemExtractDates??null,
    programmePeriods:item.report.ComplianceSummary?.ProgramDates??[],
    sourceDuplicates:(item.duplicates??[]).map(({path,occurrence,previousStart,previousEnd,start,end})=>({path,occurrence,previousStart,previousEnd,start,end})),
    sections:Object.keys(item.report).map(name=>({name,type:valueType(item.typed?.[name]),
      entries:Array.isArray(item.report[name])?item.report[name].length:object(item.report[name])?Object.keys(item.report[name]).length:null})),
    tableCounts,...provenance(item.page)};
}
export async function summarizeEdition(store,edition) {
  const loaded=await loadEdition(store,edition),facilitySummaries=loaded.ids.map(id=>{
    const item=loaded.reports.get(id);return item?summaryFor(loaded,item):{facilityId:id,captured:false};
  });
  const tableCounts={};
  for(const table of Object.keys(COLUMNS)){let n=0;for(const unused of projectRows(loaded,table))n++;tableCounts[table]=n;}
  const observed=list(edition.pages).map(p=>p.sourceObservedAt).filter(v=>typeof v==='string'&&v);
  const summary={facilityCount:loaded.reports.size,selectedFacilityCount:loaded.ids.length,
    missingFacilityIds:loaded.ids.filter(id=>!loaded.reports.has(id)),reportCoverageComplete:loaded.reports.size===loaded.ids.length,
    responseCount:list(edition.pages).length,tableCounts,permitCount:tableCounts.permits,
    duplicateMemberOccurrences:facilitySummaries.reduce((n,f)=>n+(f.sourceDuplicates?.length??0),0),
    programmes:[...new Set(facilitySummaries.flatMap(s=>s.programmes??[]))],
    sourceObservedAt:observed,sourcePackageSha256:edition.sourcePackageSha256??null,
    sourceMetadata:edition.sourceMetadata??null,
    observationMeaning:'Source-reported indicators retain their own statutes, identifiers, reporting periods and extract dates. They do not replace the underlying agency record or a facility-specific determination.'};
  return {summary,facilitySummaries};
}
export async function facilityReport(store,edition,facilityId) {
  const loaded=await loadEdition(store,edition),item=loaded.reports.get(facilityId);
  if(!item)throw fault('ECHO_FACILITY_SELECTION','Choose a complete retained report in this edition.',404);
  return {summary:summaryFor(loaded,item),report:item.report,page:item.page};
}
const nonsemantic=new Set(['sourcePageSha256','sourceObservedAt','sourceUrl','sourcePath','recordJson']);
const shapePath=p=>String(p??'').replace(/\/\d+(?=\/|$)/g,'/[]');
function comparisonKey(r,table) {
  if(table==='facilities')return [r.facilityId];
  if(table==='permits')return [r.facilityId,r.statute,r.epaSystem,r.sourceId];
  if(table==='compliance')return [r.facilityId,r.statute,r.sourceId,r.periodStart,r.periodEnd];
  if(table==='quarters')return [r.facilityId,r.statute,r.sourceId,r.section,
    r.periodStart||r.periodIndex,r.periodEnd,r.field.replace(/^Qtr[1-9]\d*/i,'Qtr'),r.recordId,(r.recordId?shapePath(r.sourcePath):String(r.sourcePath??'')).replace(/Qtr[1-9]\d*/ig,'Qtr')];
  if(table==='inspections')return [r.facilityId,r.statute,r.epaSystem,r.sourceId,r.section,r.recordId||r.date,r.type];
  if(table==='enforcement')return [r.facilityId,r.statute,r.epaSystem,r.sourceId,r.section,r.recordId||r.caseNumber||r.date,r.type];
  return [r.facilityId,r.statute??'',r.sourceId??'',r.section,String(r.sourcePath??''),r.field];
}
function semanticRow(r,columns,table) {
  const out=Object.fromEntries(columns.filter(k=>!nonsemantic.has(k)).map(k=>[k,r[k]]));
  if(table==='quarters'&&(r.periodStart||r.periodEnd)){
    delete out.periodIndex;out.field=out.field.replace(/^Qtr[1-9]\d*/i,'Qtr');
  }
  return out;
}
export async function compareEditions(store,left,right,table='facilities') {
  if(stable(selectedIds(left))!==stable(selectedIds(right)))
    throw fault('ECHO_COMPARISON_SELECTION','Compare the same ordered native FRS cohort.',409);
  const a=await editionRows(store,left,{table,limit:MAX_ROWS}),b=await editionRows(store,right,{table,limit:MAX_ROWS});
  if(a.total>MAX_ROWS||b.total>MAX_ROWS)throw fault('ECHO_COMPARISON_CAPACITY','This complete table exceeds the retained comparison capacity.',413);
  const grouped=rows=>{
    const map=new Map();
    for(const r of rows){const key=stable(comparisonKey(r,table));if(!map.has(key))map.set(key,[]);map.get(key).push(r);}
    return map;
  };
  const before=grouped(a.rows),after=grouped(b.rows),added=[],removed=[],changed=[];let unchanged=0,ambiguousGroups=0;
  const semantic=r=>semanticRow(r,a.columns,table);
  for(const key of [...new Set([...before.keys(),...after.keys()])].sort()){
    const old=[...(before.get(key)??[])],next=[...(after.get(key)??[])],leftover=[];
    for(const r of next){
      const signature=stable(semantic(r)),index=old.findIndex(o=>stable(semantic(o))===signature);
      if(index>=0){old.splice(index,1);unchanged++;}else leftover.push(r);
    }
    const id=hashBytes(Buffer.from(key));
    if(old.length===1&&leftover.length===1){
      const x=semantic(old[0]),y=semantic(leftover[0]),fields=Object.keys(x).filter(k=>x[k]!==y[k]);
      changed.push({id,identity:JSON.parse(key),before:old[0],after:leftover[0],
        changes:fields.map(field=>({field,before:x[field],after:y[field]}))});
    }else {
      if(old.length&&leftover.length)ambiguousGroups++;
      for(const [i,r]of old.entries())removed.push({id:id+':before:'+i,identity:JSON.parse(key),row:r});
      for(const [i,r]of leftover.entries())added.push({id:id+':after:'+i,identity:JSON.parse(key),row:r});
    }
  }
  return {schema:'stellar-forge.epa-echo-comparison.v1',leftId:left.id,rightId:right.id,table,selection:left.selection,
    coverage:{leftReports:list(left.pages).filter(p=>p.kind==='facility-report').length,
      rightReports:list(right.pages).filter(p=>p.kind==='facility-report').length,
      meaning:'A difference is between these retained source editions. Source-field and metadata comparisons use original JSON-pointer positions. Quarter records without an original record identifier keep their original array position and absolute reporting period. Repeated identified records are compared as multisets; ambiguous remaining duplicates are separate removals and additions.'},
    counts:{added:added.length,removed:removed.length,changed:changed.length,unchanged,ambiguousGroups},added,removed,changed};
}
const html=v=>optional(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function sourcePackage(store,edition) {
  if(edition.sourcePackageSha256){
    const original=await store.object(edition.sourcePackageSha256);
    const parsed=parseExactJSON(new TextDecoder('utf-8',{fatal:true}).decode(original));
    if(parsed.schema!==SOURCE_PACKAGE_SCHEMA||stable(parsed.selection?.facilityIds)!==stable(selectedIds(edition)))
      throw fault('ECHO_SOURCE_PACKAGE_IDENTITY','The original source package belongs to another retained selection.',409);
    return original;
  }
  const responses=[];
  for(const page of list(edition.pages)){
    const bytes=await store.object(page.sha256);
    const response={kind:page.kind,url:page.url,bodyBase64:bytes.toString('base64'),sha256:page.sha256,
      bytes:bytes.length,receipt:page};
    if(page.facilityId)response.facilityId=page.facilityId;
    responses.push(response);
  }
  return jsonBytes({schema:SOURCE_PACKAGE_SCHEMA,label:edition.label,selection:edition.selection,
    sourceMetadata:edition.sourceMetadata??{},responses});
}
export async function exportEdition(store,edition,reviews,table='facilities',format='json') {
  if(format==='source-package')return {bytes:await sourcePackage(store,edition),
    type:'application/json; charset=utf-8',extension:'json',
    note:'Complete original source selection. Operator reviews remain separate workspace records.'};
  const projection=await editionRows(store,edition,{table,limit:MAX_ROWS});
  if(projection.total>MAX_ROWS)throw fault('ECHO_EXPORT_CAPACITY','The complete selected table exceeds the export capacity.',413);
  const selectedReviews=list(reviews).filter(r=>r.editionId===edition.id||!r.editionId&&r.portfolioId===edition.portfolio?.id);
  const summary=await summarizeEdition(store,edition);
  if(format==='json')return {bytes:jsonBytes({schema:'stellar-forge.epa-echo-table-export.v1',
    source:SOURCE_CONTRACT,edition,summary:summary.summary,facilitySummaries:summary.facilitySummaries,
    table,columns:projection.columns,rows:projection.rows,reviews:selectedReviews}),
    type:'application/json; charset=utf-8',extension:'json'};
  if(format==='csv')return {bytes:csvBytes(projection.columns,projection.rows,{spreadsheet:true}),
    type:'text/csv; charset=utf-8',extension:'csv',
    note:'Complete selected table. Formula-leading spreadsheet cells receive an apostrophe; original source and JSON values remain exact. Operator reviews remain separate.'};
  if(format!=='report')throw fault('ECHO_EXPORT_FORMAT','Choose JSON, CSV, report or source-package.');
  const doc='<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">'+
    '<title>'+html(edition.label)+' — EPA facility review</title><style>body{font:14px system-ui;color:#171717;background:#fff;margin:28px;line-height:1.5}h1{font-size:24px}h2{font-size:18px;margin-top:28px}table{border-collapse:collapse;width:100%;font-size:12px}th,td{border:1px solid #bbb;padding:6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}pre{white-space:pre-wrap;overflow-wrap:anywhere}.scroll{overflow:auto}small{color:#444}@media print{body{margin:0}thead{display:table-header-group}tr{break-inside:avoid}}</style>'+
    '<h1>'+html(edition.label)+'</h1><p>Retained EPA ECHO edition '+html(edition.id)+'</p><p>'+html(summary.summary.observationMeaning)+'</p>'+
    '<h2>Selection, source dates and coverage</h2><pre>'+html(JSON.stringify({selection:edition.selection,summary:summary.summary,facilities:summary.facilitySummaries},null,2))+'</pre>'+
    '<h2>Operator reviews</h2>'+selectedReviews.map(r=>'<section><h3>'+html(r.subject)+' · '+html(r.status)+'</h3><p>'+html(r.note)+'</p><p>'+html(r.owner)+' · '+html(r.updatedAt??r.createdAt)+'</p></section>').join('')+
    '<h2>Complete '+html(table)+' table · '+projection.total+' rows</h2><div class="scroll"><table><thead><tr>'+
    projection.columns.map(k=>'<th>'+html(k)+'</th>').join('')+'</tr></thead><tbody>'+
    projection.rows.map(r=>'<tr>'+projection.columns.map(k=>'<td>'+html(r[k])+'</td>').join('')+'</tr>').join('')+
    '</tbody></table></div><h2>Original response custody</h2><pre>'+html(JSON.stringify(edition.pages,null,2))+'</pre>'+
    '<h2>Source contract</h2><pre>'+html(JSON.stringify(SOURCE_CONTRACT,null,2))+'</pre></html>';
  return {bytes:Buffer.from(doc),type:'text/html; charset=utf-8',extension:'html'};
}
