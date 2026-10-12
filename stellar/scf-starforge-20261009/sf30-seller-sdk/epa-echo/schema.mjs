// MIT. EPA ECHO original facility, programme, date and reporting-period contract.
export const WORKSPACE_SCHEMA='stellar-forge.epa-echo-workspace.v1';
export const SOURCE_PACKAGE_SCHEMA='stellar-forge.epa-echo-source-package.v1';
export const SOURCE_CONTRACT=Object.freeze({
 provider:'U.S. Environmental Protection Agency ECHO',
 baseUrl:'https://echodata.epa.gov/echo',
 documentation:'https://echo.epa.gov/tools/web-services',
 dataDocumentation:'https://echo.epa.gov/resources/echo-data/about-the-data',
 downloads:'https://echo.epa.gov/tools/data-downloads',
 license:'https://edg.epa.gov/EPA_Data_License.html',
 metadataPath:'/echo_rest_services.metadata',
 facilitySearchPath:'/echo_rest_services.get_facilities',
 facilityPagePath:'/echo_rest_services.get_qid',
 facilityReportPath:'/dfr_rest_services.get_dfr',
 referenceSpecificationVersion:'2019.10.15',
 referenceSpecificationSha256:'c2f2b1c851e7dbe4407452b5942287f3c9c03c7d97be63deacd3136674e831d9',
 specificationMeaning:'The complete specification was obtained from the source linked by EPA during this delivery. Each acquisition also retains its actual source response and observed transport fields.',
 facilityIdentity:'The original FRS RegistryID identifies a selected facility. Programme SourceID values remain separate; contextual MapData neighbours do not become selected portfolio facilities.',
 sourceDates:'SystemExtractDates, CurrentAsOf, programme reporting periods and actual retrieval times retain their separate source meanings.',
 quarterMeaning:'Each QtrN value is paired only with its own section Header QtrNStart/QtrNEnd. Programme histories may end in different quarters.',
 completeness:'A portfolio edition states which exact requested facility reports completed. Search completion is based on QueryRows and the complete unique FRS result set, with the original provider Message retained.',
 comparisons:'Edition comparisons describe changes in the captured source reports and reporting periods. Staff review notes remain separately attributed working records.',
 numbers:'The original exact JSON parser preserves every numeric token as text. Original strings, empty strings, nulls and source formatting remain distinguishable.',
 dateNormalization:'Separate ISO columns normalize only valid Gregorian date-only source values. Original date strings remain unchanged; each programme retains its own period.',
 queryLifetime:'The documented query identifiers last approximately 30 minutes. A retained search resumes the same QID; an expired query remains attached to its original operation.',
 access:'Public query-only EPA source endpoints with complete original response retention.'
});
const SOURCE_COLUMNS=['sourcePageSha256','sourceObservedAt','sourceUrl'];
export const COLUMNS={
 facilities:['facilityId','facilityName','street','city','state','zip','county','latitude','longitude','permitCount','programmes','sourceMessage',...SOURCE_COLUMNS],
 permits:['facilityId','facilityName','statute','epaSystem','sourceId','facilityStatus','universe','areas','expirationDate','expirationDateIso','latitude','longitude','datum','naics','sic','sourcePath','recordJson',...SOURCE_COLUMNS],
 compliance:['facilityId','statute','sourceId','currentSNC','description','currentAsOf','currentAsOfIso','quartersInNoncompliance','periodStart','periodEnd','periodStartIso','periodEndIso','systemExtractDate','systemExtractDateIso','sourcePath','recordJson',...SOURCE_COLUMNS],
 quarters:['facilityId','statute','sourceId','section','periodIndex','periodStart','periodEnd','periodStartIso','periodEndIso','field','value','valueType','recordId','sourcePath','recordJson',...SOURCE_COLUMNS],
 inspections:['facilityId','statute','epaSystem','sourceId','section','date','dateIso','type','agency','description','recordId','periodStart','periodEnd','periodStartIso','periodEndIso','sourcePath','recordJson',...SOURCE_COLUMNS],
 enforcement:['facilityId','statute','epaSystem','sourceId','section','date','dateIso','type','agency','caseNumber','penalty','description','recordId','periodStart','periodEnd','periodStartIso','periodEndIso','sourcePath','recordJson',...SOURCE_COLUMNS],
 metadata:['facilityId','section','epaSystem','field','value','valueType','sourcePath',...SOURCE_COLUMNS],
 'source-fields':['facilityId','statute','sourceId','section','sourcePath','field','value','valueType',...SOURCE_COLUMNS]
};
export const TABLES=[
 {id:'facilities',label:'Facilities',description:'One original selected FRS facility per report.'},
 {id:'permits',label:'Programme and permit records',description:'Every original Results.Permits row, including its source system and identifier.'},
 {id:'compliance',label:'Current programme summaries',description:'The original compliance summary and its own programme period.'},
 {id:'quarters',label:'Quarterly reporting',description:'Original QtrN fields and their explicitly supplied section date headers.'},
 {id:'inspections',label:'Inspections',description:'Original compliance-history inspection records.'},
 {id:'enforcement',label:'Actions and notices',description:'Original formal-action and notice records with source reporting periods.'},
 {id:'metadata',label:'Dates and source metadata',description:'Original system extract dates and programme/header metadata.'},
 {id:'source-fields',label:'All source fields',description:'Every original report leaf, including contextual sections and unmapped fields.'}
].map(t=>({...t,columns:COLUMNS[t.id]}));
export const SEARCH_FIELDS=[
 {id:'p_fn',label:'Facility name',type:'text',maxLength:300},
 {id:'p_st',label:'State or territory',type:'text',maxLength:200,placeholder:'DC'},
 {id:'p_ct',label:'City',type:'text',maxLength:200},
 {id:'p_zip',label:'ZIP code',type:'text',maxLength:100},
 {id:'p_ncs',label:'NAICS code',type:'text',maxLength:100,placeholder:'221320'},
 {id:'p_fips',label:'County FIPS code',type:'text',maxLength:100},
 {id:'p_reg',label:'EPA region',type:'text',maxLength:30},
 {id:'responseset',label:'Rows per source page',type:'integer',minimum:1,maximum:1000,default:100}
];
export const REVIEW_STATUSES=['open','reviewed','follow_up','resolved'];
export const ACTIONS={
  "portfolio.save": [
    "portfolioId",
    "label",
    "facilityIds",
    "customer",
    "owner",
    "note",
    "active"
  ],
  "portfolio.archive": [
    "portfolioId"
  ],
  "facility.search": [
    "label",
    "query"
  ],
  "capture.start": [
    "portfolioId",
    "label"
  ],
  "capture.resume": [
    "captureId"
  ],
  "capture.pause": [
    "captureId"
  ],
  "capture.import": [
    "portfolioId",
    "label",
    "bundle"
  ],
  "edition.select": [
    "editionId"
  ],
  "edition.compare": [
    "leftId",
    "rightId",
    "table"
  ],
  "review.save": [
    "reviewId",
    "portfolioId",
    "editionId",
    "facilityId",
    "subject",
    "note",
    "status",
    "owner",
    "dueDate"
  ],
  "dataset.prepare": [
    "editionId",
    "table",
    "name"
  ],
  "dataset.query": [
    "datasetId",
    "query"
  ],
  "release.prepare": [
    "datasetId",
    "origin",
    "path",
    "payment"
  ],
  "release.inspect": [
    "releaseId"
  ],
  "release.activate": [
    "releaseId",
    "expectedGeneration"
  ],
  "release.start": [
    "releaseId",
    "expectedGeneration"
  ],
  "release.stop": [
    "releaseId"
  ],
  "release.rollback": [
    "releaseId",
    "expectedGeneration"
  ],
  "buyer.inspect": [
    "intentIds"
  ],
  "buyer.receive": [
    "intentIds"
  ],
  "export.create": [
    "editionId",
    "table",
    "format"
  ],
  "workspace.export": [],
  "workspace.receive": [
    "bundle"
  ]
};
export function workspaceSchema({workspaceId,inboxConfigured=false,userAgent}={}){
 return {schema:'stellar-forge.epa-echo-workspace-schema.v1',workspaceSchema:WORKSPACE_SCHEMA,workspaceId,
  title:'EPA ECHO Facility Portfolios',source:SOURCE_CONTRACT,tables:TABLES,columns:COLUMNS,actions:ACTIONS,
  searchFields:SEARCH_FIELDS,reviewStatuses:REVIEW_STATUSES,exportFormats:['json','csv','report','source-package'],
  sourceImport:{schema:SOURCE_PACKAGE_SCHEMA,description:'The complete retained source package for the portfolio’s ordered FRS selection.'},
  workspaceImport:{schema:'stellar-forge.epa-echo-workspace-package.v1',description:'Open every retained analytical record, source, dataset and customer file from an exported workspace.'},
  defaults:{table:'facilities',responseset:100},inboxConfigured,userAgent,
  captureLimits:{facilityCount:1000,responseBytes:32*1024*1024,captureBytes:256*1024*1024},
  rowLimits:{datasetRows:250000,tableExportRows:250000,comparisonRowsPerEdition:250000},
  fileLimits:{retainedObjectBytes:256*1024*1024,portableDecodedBytes:256*1024*1024,serializedImportBytes:256*1024*1024},
  paymentFields:['scheme','network','asset','amount','payTo','maxTimeoutSeconds'],
  bootstrap:{fragment:'bearer token',header:'Authorization: Bearer TOKEN',storage:'sessionStorage'},
  revisionPolicy:'Reuse the exact saved operation before checking the current workspace revision. New actions require the current revision.'};
}
