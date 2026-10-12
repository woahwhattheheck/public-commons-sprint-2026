// MIT. Coastal source contract; native measurements and tidal predictions stay separate.
export const WORKSPACE_SCHEMA='stellar-forge.coops-workspace.v1';
export const SOURCE_CONTRACT=Object.freeze({
 provider:'NOAA Center for Operational Oceanographic Products and Services (CO-OPS)',
 dataApi:'https://api.tidesandcurrents.noaa.gov/api/prod/datagetter',
 metadataApi:'https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi',
 documentation:'https://api.tidesandcurrents.noaa.gov/api/prod/',
 responseFields:'https://api.tidesandcurrents.noaa.gov/api/prod/responseHelp.html',
 metadataDocumentation:'https://api.tidesandcurrents.noaa.gov/mdapi/prod/',
 access:'Public NOAA source data. Each capture retains the exact original response bytes and observed transport metadata.',
 scope:'Water-level observations, verified hourly heights and separately selected tide predictions with station/datum metadata.',
 datum:'The entered datum is retained for every row. No datum conversion is performed. Station datums/epoch are separate original metadata.',
 time:'GMT, local standard time and local daylight/standard time are explicit request choices. Only GMT timestamps receive a UTC projection.',
 quality:'Keep original q and f. For preliminary water levels f[0] is the number of excluded samples; for verified water levels f[0] is an inferred-value flag.',
 coverage:'Request completion, observed rows and populated values are separate. No gaps are interpolated and no observation is upgraded to verified.',
 prediction:'Tide predictions are a separate provider product; they are not measurements or a site-specific hydraulic model.',
 safety:'The source handoff supports engineering review; it does not certify navigation, flooding or project design.'
});
export const PRODUCTS=Object.freeze({
 water_level:{label:'Six-minute water levels',kind:'observation',stepMinutes:6,maxDays:28},
 hourly_height:{label:'Verified hourly heights',kind:'observation',stepMinutes:60,maxDays:365},
 predictions:{label:'Tide predictions',kind:'prediction',stepMinutes:null,maxDays:28}
});
export const TABLES=[{id:'observations',label:'Water-level observations'},{id:'predictions',label:'Tide predictions'},{id:'metadata',label:'Station and datum evidence'},{id:'coverage',label:'Source coverage'}];
export const COLUMNS=['editionId','profileId','profileName','stationId','stationName','latitude','longitude','table','product','productKind','recordId','timestamp','timestampUtc','timeZone','datum','units','field','value','valueType','unit','sigma','quality','flags','flagMeaning','inferred','excludedSamples','eventType','metadataKind','metadataPath','detailsJson','sourcePageSha256','sourceRecord','sourceObservedAt','sourceUrl'];
export const ACTIONS={
 'station.save':['profileId','stationId','label','owner','note','active'],
 'station.archive':['profileId'],
 'capture.preview':['profileId','label','products','beginDate','endDate','units','timeZone','datum','predictionInterval'],
 'capture.start':['profileId','label','products','beginDate','endDate','units','timeZone','datum','predictionInterval'],
 'backfill.preview':['profileId','label','products','beginDate','endDate','units','timeZone','datum','predictionInterval'],
 'backfill.start':['profileId','label','products','beginDate','endDate','units','timeZone','datum','predictionInterval'],
 'backfill.resume':['backfillId'],'backfill.pause':['backfillId'],'backfill.export':['backfillId','table','format','mappingId'],
 'mapping.save':['mappingId','name','table','columns','note','mappingSource'],
 'capture.resume':['captureId'],'capture.pause':['captureId'],'capture.import':['profileId','label','bundle'],
 'edition.select':['editionId'],'edition.compare':['leftId','rightId','table'],
 'annotation.save':['editionId','subject','note','status'],
 'dataset.prepare':['editionId','table','name','beginDate','endDate','products','mappingId'],'dataset.query':['datasetId','query'],
 'release.prepare':['datasetId','origin','path','payment'],'release.inspect':['releaseId'],
 'release.activate':['releaseId','expectedGeneration'],'release.start':['releaseId','expectedGeneration'],'release.stop':['releaseId'],'release.rollback':['releaseId','expectedGeneration'],
 'buyer.inspect':['intentIds'],'buyer.receive':['intentIds'],
 'export.create':['editionId','table','format','mappingId'],
 "study.save":["studyId","expectedStudyRevision","expectedPreviewSha256","name","project","question","owner","table","mappingId","basisPolicy","members","note"],
 "study.review":["studyId","studyRevision","studySha256","expectedReviewId","status","actor","note","acknowledgedWarnings"],
 "study.export":["studyId","studyRevision","studySha256","reviewId"],
 "study.return.start":["releaseId","format","filename","bytes","note"],
 "study.return.chunk":["uploadId","offset","base64"],
 "study.return.finish":["uploadId"],
 "study.receive":["returnId","comparisonSha256","expectedDecisionId","status","actor","note"],
 'analysis.export':['observationsEditionId','predictionsEditionId','options','analyst']
};
export function workspaceSchema({workspaceId,inboxConfigured=false,userAgent}={}){
 return{schema:'stellar-forge.coops-workspace-schema.v1',workspaceId,title:'Coastal Source Operations',source:SOURCE_CONTRACT,
 products:Object.entries(PRODUCTS).map(([id,v])=>({id,...v})),tables:TABLES,columns:COLUMNS,actions:ACTIONS,
 units:['metric','english'],timeZones:['gmt','lst','lst_ldt'],datums:['MLLW','MHHW','MHW','MTL','MSL','MLW','NAVD','STND','IGLD','LWD','CRD'],
 predictionIntervals:['6','h','hilo'],annotationStatuses:['open','reviewed','follow_up'],
 exportFormats:['json','jsonl','csv','report','source-package'],inboxConfigured,userAgent,
 study:{schema:'stellar-forge.coops-coastal-study.v1',tables:['observations','predictions'],basisPolicies:['uniform_requests','mixed_native'],maxMembers:64,maxStations:5,maxYears:5,chunkBytes:1048576,maxReturnBytes:1073741824,reviewStatuses:['reviewed','follow_up'],receivingStatuses:['accepted','follow_up'],requiredColumns:['editionId','recordId','sourcePageSha256','sourceRecord','stationId','product','timestamp','timeZone','datum','units','unit','value','valueType','quality','flags'],description:'Reviewed ordered immutable source windows, complete mapped CSV/JSONL and source TAR, and exact returned-file comparison in the original workspace.'},
 analysis:{action:'analysis.export',schema:'stellar-forge.coops-retained-analysis.v1',products:['water_level','predictions'],timeZone:'gmt',predictionInterval:'6',
  quality:['all','verified','preliminary'],outputs:['workbook.html','workbook.json','analysis.json','paired.csv','episodes.csv','unplaced.csv','source/*','manifest.json','README.txt']},
 limits:{windowDays:366,backfillYears:5,rowPage:500,responseBytes:32*1024*1024,captureBytes:256*1024*1024,sourceImportBytes:64*1024*1024,sourceTasks:128,backfillParts:5,mappingFileBytes:64*1024,streamExportBytes:1024*1024*1024,datasetRows:250000,metadataRows:50000},
 defaults:{products:['water_level'],units:'metric',timeZone:'gmt',datum:'MLLW',predictionInterval:'6'},
 datasetMapping:{columnPattern:'^[A-Za-z][A-Za-z0-9_]{0,47}$',reservedColumns:['constructor','prototype','__proto__'],maximumFilterColumns:8,description:'A selected saved mapping revision is pinned to the native CSV/query and release package. Keep valueType whenever value is exposed; original source files and aliases remain in package provenance.'},
 mappingImport:{schema:'stellar-forge.coops-model-input-mapping-file.v1',description:'An explicitly selected original JSON convention, retained byte-for-byte with each saved mapping revision.'},
 sourceImport:{schema:'stellar-forge.coops-capture-package.v1',description:'An exact exported source edition with every original response and capture/query identity.'},
 paymentFields:['scheme','network','asset','amount','payTo','maxTimeoutSeconds'],
 bootstrap:{fragment:'private bearer token',header:'Authorization: Bearer TOKEN',storage:'sessionStorage'},
 revisionPolicy:'The original operation identity is reconciled before checking the current workspace revision.'};
}
