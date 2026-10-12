// MIT. Original collection and report package intake for GIS operations.
import { validateSource, validateReport, SOURCE_SCHEMA, REPORT_SCHEMA } from '../reporting/domain.mjs';
import { canonical, copy, digest, equal, fail, object, parseJson, text, instant, entityId, MAX_SOURCE_BYTES, MAX_ROWS } from './shared.mjs';
import { sourceGeometry } from './fields.mjs';
export const GIS_SOURCE_SCHEMA = 'commons.open311.gis-source.v1';
const REPORTING_PACKAGE = 'commons.open311.reporting-workspace.v1';
const coverage = source => ({sourceId:source.id,sha256:source.sha256,bytes:source.bytes,workspaceId:source.envelope.workspaceId,revision:source.envelope.revision,collectionId:source.envelope.collection.id,connection:copy(source.envelope.collection.connection),query:copy(source.envelope.collection.query),policy:copy(source.envelope.collection.policy),summary:copy(source.envelope.summary)});
function parseInput(originalText, reportId) {
  if(typeof originalText!=='string'||Buffer.byteLength(originalText)>MAX_SOURCE_BYTES)fail('SOURCE_SIZE','Import a complete source JSON file of at most 128 MiB.',413);
  const input=object(parseJson(originalText,'Source file'),'Source file');
  if(input.schema===SOURCE_SCHEMA){
    if(reportId)fail('INVALID_REPORT_SELECTION','A collection import does not use a report ID.');
    const source=validateSource(originalText);
    return {kind:'collection',name:source.envelope.collection.name,selectedReportId:null,reports:[],sources:[source],selected:source.envelope.requests.map(row=>({source,row,report:null})),coverage:[coverage(source)]};
  }
  if(input.schema!==REPORTING_PACKAGE)fail('UNSUPPORTED_SOURCE','Import a complete Open311 collection JSON or reporting workspace/report JSON package.');
  const {sha256,...body}=input;
  if(sha256!==digest(body)||!Array.isArray(input.records))fail('REPORT_PACKAGE_HASH_MISMATCH','The complete reporting package differs from its saved SHA-256.');
  const sources=new Map(),reports=new Map(),recordIds=new Set();
  for(const record of input.records){
    object(record,'Reporting record');
    const recordKey=record.kind+'/'+record.id;if(recordIds.has(recordKey))fail('DUPLICATE_REPORT_RECORD','The report package repeats a record.');recordIds.add(recordKey);
    if(record.kind==='source'){
      const source=validateSource(record.value?.originalText);
      if(source.id!==record.id||source.sha256!==record.value.sha256||!equal(source.envelope,record.value.envelope))fail('REPORT_SOURCE_MISMATCH','A report source differs from its complete original collection.');
      sources.set(record.id,source);
    }else if(record.kind==='report'){
      const report=validateReport(record.value);
      if(report.id!==record.id)fail('REPORT_ID_MISMATCH','A report record has a different identity.');
      reports.set(report.id,report);
    }
  }
  if(!reports.size)fail('NO_REPORTS','The reporting package contains no saved report.');
  const choices=[...reports.values()].map(report=>({id:report.id,name:report.definition?.name??report.id,rows:report.rows.length}));
  const selectedReportId=reportId??input.selectedReportId??(reports.size===1?[...reports.keys()][0]:null);
  if(!selectedReportId)return {kind:'report',name:'Reporting package',selectedReportId:null,reports:choices,sources:[],selected:[],coverage:[]};
  const report=reports.get(selectedReportId);if(!report)fail('REPORT_NOT_FOUND','The selected report is not in this complete file.',404,{reports:choices});
  if(!Array.isArray(report.sourceIds)||report.sourceIds.some(id=>!sources.has(id)))fail('INCOMPLETE_REPORT_SOURCE','The report package must include every original collection used by the selected report.');
  const selected=report.rows.map(reportRow=>{
    const source=sources.get(reportRow.sourceId);
    const observation=source?.envelope.observations.find(value=>value.key===reportRow.key);
    const version=observation?.versions.find(value=>value.sourceSha256===reportRow.sourceSha256);
    if(!source||!version||!equal(version.item.source,reportRow.source)||!version.occurrences.some(value=>value.captureId===reportRow.captureId))fail('REPORT_ROW_SOURCE_MISMATCH','A report row is not bound to an original captured request version.');
    const originalReview=source.envelope.requests.find(value=>value.key===reportRow.key)?.review??null;
    return {source,row:{...copy(version.item),captureId:reportRow.captureId,review:copy(originalReview)},report:reportRow,reportEdition:report};
  });
  return {kind:'report',name:report.definition?.name??report.id,selectedReportId,reports:choices,sources:report.sourceIds.map(id=>sources.get(id)),selected,coverage:report.sourceIds.map(id=>coverage(sources.get(id)))};
}
function normalizedRow(item, inputSourceId) {
  const {source,row,report,reportEdition}=item,c=source.envelope.collection;
  const capture=source.envelope.originals.find(value=>value.capture.id===row.captureId)?.capture;
  if(!capture)fail('SOURCE_CAPTURE_MISSING','The selected source row has no retained capture.');
  const sourceIdentity={baseUrl:c.connection.baseUrl,jurisdictionId:c.connection.jurisdictionId??'',serviceRequestId:row.serviceRequestId};
  const point=sourceGeometry(row.source),context=report?{
    reportId:reportEdition.id,reportSha256:reportEdition.sha256,profileId:reportEdition.profileId,
    definition:copy(reportEdition.definition),group:report.group??null,priority:report.priority??null,
    target:copy(report.target??null),issues:copy(report.issues??[]),
    commentary:reportEdition.commentary??'',requestComment:copy(reportEdition.requestComments?.[row.key]??null),
    reviewStatus:report.reviewStatus??null,assignee:report.assignee??null,reviewDueDate:report.reviewDueDate??null
  }:null;
  return {key:entityId('feature',sourceIdentity),sourceIdentity,sourceKey:row.key,sourceId:inputSourceId,
    originalSourceId:source.id,serviceRequestId:row.serviceRequestId,sourceSha256:row.sourceSha256,captureId:capture.id,
    collectionId:c.id,observedAt:capture.capturedAt,serviceCode:row.serviceCode??null,serviceName:row.serviceName??null,
    sourceStatus:row.status??null,sourceStatusNotes:typeof row.source.status_notes==='string'?row.source.status_notes:row.source.status_notes==null?'':canonical(row.source.status_notes),
    sourceClosedAt:report?.sourceClosedAt??null,description:row.description??null,address:row.address??null,
    agency:copy(row.agency??null),requestedAt:row.requestedAt??null,updatedAt:row.updatedAt??null,
    source:copy(row.source),sourceReview:copy(row.review??null),reportContext:context,
    geometryStatus:point.geometryStatus,originalGeometry:copy(point.geometry),geometry:copy(point.geometry)};
}
function counts(rows){return {rows:rows.length,located:rows.filter(r=>r.geometry!==null).length,unlocated:rows.filter(r=>r.geometry===null).length,invalidGeometry:rows.filter(r=>r.geometryStatus==='INVALID_COORDINATES').length};}
export function inspectSource(originalText,{reportId}={}){
  const parsed=parseInput(originalText,reportId),sha256=digest(originalText),id=entityId('gis-source',{sha256,reportId:parsed.selectedReportId});
  const rows=parsed.selected.map(item=>normalizedRow(item,id));
  if(rows.length>MAX_ROWS)fail('SOURCE_ROW_LIMIT','Use source selections with at most 100,000 selected requests.',413);
  return {kind:parsed.kind,name:parsed.name,sha256,bytes:Buffer.byteLength(originalText),reports:parsed.reports,selectedReportId:parsed.selectedReportId,summary:parsed.kind==='report'&&!parsed.selectedReportId?null:counts(rows)};
}
export function importSource(originalText,{reportId,name,importedAt}={}){
  const parsed=parseInput(originalText,reportId);
  if(parsed.kind==='report'&&!parsed.selectedReportId)fail('REPORT_SELECTION_REQUIRED','Choose one of the saved reports in this package.',400,{reports:parsed.reports});
  const sha256=digest(originalText),id=entityId('gis-source',{sha256,reportId:parsed.selectedReportId});
  const rows=parsed.selected.map(item=>normalizedRow(item,id));if(rows.length>MAX_ROWS)fail('SOURCE_ROW_LIMIT','Use source selections with at most 100,000 selected requests.',413);
  const connections=[...new Map(parsed.sources.map(source=>{const c=source.envelope.collection.connection;return [canonical([c.baseUrl,c.jurisdictionId??'']),{baseUrl:c.baseUrl,jurisdictionId:c.jurisdictionId??'',name:c.name??c.id,attribution:copy(c.attribution??{})}];})).values()];
  return {schema:GIS_SOURCE_SCHEMA,id,kind:parsed.kind,name:text(name??parsed.name,'Source name',200),sha256,bytes:Buffer.byteLength(originalText),
    reportId:parsed.selectedReportId,importedAt:instant(importedAt,'Import time'),originalText,rows,counts:counts(rows),connections,coverage:parsed.coverage};
}
export function sourceSummary(source){const {schema,originalText,rows,...summary}=source;return copy(summary);}
export function sourceVersions(source,key){
  const parsed=parseInput(source.originalText,source.reportId);
  const values=[];
  for(const original of parsed.sources){
    const c=original.envelope.collection;
    for(const observation of original.envelope.observations){
      const featureKey=entityId('feature',{baseUrl:c.connection.baseUrl,jurisdictionId:c.connection.jurisdictionId??'',serviceRequestId:observation.serviceRequestId});
      if(featureKey!==key)continue;
      for(const version of observation.versions)values.push({sourceId:source.id,originalSourceId:original.id,sourceSha256:version.sourceSha256,item:copy(version.item),occurrences:copy(version.occurrences)});
    }
  }
  return values;
}
