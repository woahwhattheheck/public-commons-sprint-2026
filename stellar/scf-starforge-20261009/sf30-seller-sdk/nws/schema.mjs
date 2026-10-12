// MIT. National Weather Service site operations, original source contract.
export const WORKSPACE_SCHEMA='stellar-forge.nws-workspace.v1';
export const SOURCE_CONTRACT=Object.freeze({
  provider:'National Weather Service',baseUrl:'https://api.weather.gov',
  documentation:'https://www.weather.gov/documentation/services-web-api',
  alertsDocumentation:'https://www.weather.gov/documentation/services-web-alerts',
  specification:'https://api.weather.gov/openapi.json',
  sourceRepository:'https://github.com/weather-gov/api',
  sourceCommit:'694ed0f5526336e58d513a8b8a2b313d7896bbf7',
  specificationBlob:'5ce3a5b94c6df769a55433498e615ec16093e37d',
  referenceSpecificationVersion:'1.9.0',
  referenceSpecificationMeaning:'Pinned first-party contract. Every capture retains the actual current provider fields and returned resource URLs.',
  access:'Public government data; no source usage fee. An identifying User-Agent is required.',
  pointMapping:'Forecast office and grid cells are resolved from the current point response for every capture.',
  timeMeaning:'Forecast valid times, observation times, alert issue/expiry times and retrieval times are separate fields.',
  observations:'Measurements may be null and quality controlled after reporting. Missing values retain their source null and quality metadata.',
  gridMeaning:'Original grid intervals and provider unit codes are retained without interpolation.',
  alerts:'Historical API alerts cover the provider’s recent seven-day collection. Active alerts and historical alerts remain separate tables.',
  sourceMeaning:'Original response bodies, resource URLs, observed response metadata and capture coverage travel with the data.'
});
export const PRODUCTS=['forecast','hourly','grid','observations','alerts'];
export const TABLES=[
  {id:'forecast',label:'Forecast periods'},
  {id:'hourly',label:'Hourly forecast'},
  {id:'grid',label:'Grid intervals'},
  {id:'observations',label:'Observation history'},
  {id:'latest',label:'Most recent captured observation'},
  {id:'active-alerts',label:'Active alerts'},
  {id:'alerts',label:'Alert history'},
  {id:'stations',label:'Observation stations'}
];
export const COLUMNS=[
  'siteId','siteName','latitude','longitude','table','recordId','validTime','validFrom','validUntil',
  'validFromUtc','validUntilUtc','field','value','valueType','unitCode','qualityControl','label','description','status',
  'severity','urgency','certainty','stationId','geometryJson','detailsJson',
  'sourcePageSha256','sourceRecord','sourceObservedAt','sourceUrl'
];
export const ACTIONS={
  'site.save':['siteId','label','latitude','longitude','stationId','owner','note','active'],
  'site.archive':['siteId'],
  'capture.start':['siteId','label','products','observationStart','observationEnd','units'],
  'capture.resume':['captureId'],
  'capture.pause':['captureId'],
  'capture.station':['captureId','stationId'],
  'capture.import':['siteId','label','bundle'],
  'edition.select':['editionId'],
  'edition.compare':['leftId','rightId','table'],
  'annotation.save':['editionId','subject','note','status'],
  'dataset.prepare':['editionId','table','name'],
  'dataset.query':['datasetId','query'],
  'release.prepare':['datasetId','origin','path','payment'],
  'release.inspect':['releaseId'],
  'release.activate':['releaseId','expectedGeneration'],
  'release.start':['releaseId','expectedGeneration'],
  'release.stop':['releaseId'],
  'release.rollback':['releaseId','expectedGeneration'],
  'buyer.inspect':['intentIds'],
  'buyer.receive':['intentIds'],
  'export.create':['editionId','table','format']
};
export function workspaceSchema({workspaceId,inboxConfigured=false,userAgent}={}){
  return {schema:'stellar-forge.nws-workspace-schema.v1',workspaceId,source:SOURCE_CONTRACT,
    title:'Site Weather Operations',products:PRODUCTS,tables:TABLES,columns:COLUMNS,actions:ACTIONS,
    annotationStatuses:['open','reviewed','follow_up'],exportFormats:['json','csv','report','source-package'],
    units:['us','si'],inboxConfigured,userAgent,
    defaults:{products:PRODUCTS,units:'us',observationHours:24,stationSelection:'First station in the actual provider catalog; an operator may select another listed station.'},
    captureLimits:{responseBytes:32*1024*1024,captureBytes:256*1024*1024,pages:2000},
    rowLimits:{datasetRows:250000,tableExportRows:250000,comparisonRowsPerEdition:250000},
    fileLimits:{retainedObjectBytes:256*1024*1024},
    sourceImport:{schema:'stellar-forge.nws-capture-package.v1',description:'Import a complete retained NWS source capture. Original source times and transport metadata remain attached.'},
    paymentFields:['scheme','network','asset','amount','payTo','maxTimeoutSeconds'],
    bootstrap:{fragment:'bearer token',header:'Authorization: Bearer TOKEN',storage:'sessionStorage'},
    revisionPolicy:'Reuse a saved operation before checking the current workspace revision. New actions require the current revision.'};
}
