// MIT. Complete Public Assistance portfolio operating contract.
import {TABLE_COLUMNS,REVIEW_STATES,FIELD_MAP} from './domain.mjs';
import {DELIVERY_FIELDS,stagingMapping} from './delivery.mjs';
export const WORKSPACE_SCHEMA='stellar-forge.openfema-workspace.v1';
export const ACTIONS={
  'source.capture':['scope','label'],'source.resume':['captureId'],'source.pause':['captureId'],'source.import':['bundle'],
  'portfolio.create':['name','editionId','criteria'],'portfolio.revise':['portfolioId','editionId','criteria','expectedVersion'],
  'portfolio.select':['portfolioId','versionId'],'portfolio.compare':['beforeVersionId','afterVersionId'],
  'review.save':['portfolioId','versionId','annotation'],'review.accept':['portfolioId','versionId','note'],
  'dataset.prepare':['versionId','table','name'],'dataset.query':['datasetId','query'],
  'release.prepare':['datasetId','origin','path','payment'],'release.inspect':['releaseId'],
  'release.activate':['releaseId','expectedGeneration'],'release.start':['releaseId','expectedGeneration'],
  'release.stop':['releaseId'],'release.rollback':['releaseId','expectedGeneration'],
  'buyer.inspect':['intentIds'],'buyer.receive':['intentIds'],
  'delivery.mapping.save':['mapping','previousMappingId'],'delivery.mapping.review':['mappingId','expectedMappingSha256','reviewer','note'],
  'delivery.export':['mappingId','versionId','customerReconciliationId'],'delivery.reconcile':['deliveryId','customerFile'],
  'delivery.review.apply':['reconciliationId','versionId','rowNumbers','reviewer','note'],'delivery.compare':['beforeDeliveryId','afterDeliveryId'],
  'export.create':['versionId','table','format'],'source.export':['editionId'],'workspace.export':[]
};
export const ACTION_REQUEST_BYTE_LIMITS=Object.freeze({'source.import':256*1024*1024,'delivery.mapping.save':16*1024*1024,'delivery.reconcile':100*1024*1024});
export const actionRequestByteLimit=action=>Object.hasOwn(ACTION_REQUEST_BYTE_LIMITS,action)?ACTION_REQUEST_BYTE_LIMITS[action]:128*1024;
export const SOURCE_NOTES={
  declarations:'DisasterDeclarationsSummaries v2 describes designated areas. The natural declaration-area key is disasterNumber and placeCode; county 000 can designate an entire state.',
  applicants:'PublicAssistanceApplicants v1 is joined by disasterNumber and applicantId. Its UUID is an instance identifier and is not a cross-dataset key.',
  projects:'PublicAssistanceFundedProjectsDetails v2 uses gmProjectId as its primary key. It contains obligated project worksheets; projects still before obligation are outside this source.',
  amounts:'projectAmount estimates project cost excluding administrative costs; federalShareObligated is federal project funding available to the recipient; totalObligated includes recipient/subrecipient administrative amounts. mitigationAmount can include negative adjustments. Each measure is reported separately in exact USD cents.',
  attribution:'This product uses the FEMA OpenFEMA API. FEMA does not endorse this product. Original dataset metadata, versions, source requests and refresh observations accompany every portfolio.',
  finances:'The source is FAC-Trax/Grants Manager operational data. FEMA describes it as unsuitable for official federal financial reporting.',
  migration:'Current funded-project metadata explains that a system migration restored previously omitted records. Edition comparisons retain that source context.'
};
export function workspaceSchema({workspaceId,inboxConfigured,releaseRuntime,userAgent}={}){
  return {schema:'stellar-forge.openfema-workspace-schema.v1',workspaceId,userAgent,actions:ACTIONS,actionRequestByteLimits:ACTION_REQUEST_BYTE_LIMITS,sourceNotes:SOURCE_NOTES,
    tableColumns:TABLE_COLUMNS,fieldMap:FIELD_MAP,reviewStates:REVIEW_STATES,reviewPriorities:['low','normal','high'],
    sourceScope:{disasterNumbers:'Positive integer array',states:'Uppercase two-letter state codes',declarationDateFrom:'YYYY-MM-DD',declarationDateTo:'YYYY-MM-DD',pageSize:'1–10000, default 1000'},
    portfolioFields:['name','states','disasters','applicants','categories','counties','declarationFrom','declarationTo','minimumFederal','maximumFederal','includeUnjoined','note'],
    delivery:{fields:DELIVERY_FIELDS,stagingMapping:stagingMapping(),customerFileLimit:16*1024*1024,identity:'Exact disasterNumber and gmProjectId; customer-only and pre-obligation rows remain in the original customer file.',state:'Mappings, explicit reviews, deliveries, customer inputs and comparisons are retained in this same workspace.'},
    amountUnit:'USD',inboxConfigured:Boolean(inboxConfigured),releaseRuntime,
    operationPolicy:'A repeated operation ID reopens its original result. New actions require the displayed workspace revision.',
    sourceCompletion:'Every selected disaster is acquired across declarations, applicants and projects; the original source pages and continuation are saved throughout capture.'};
}
