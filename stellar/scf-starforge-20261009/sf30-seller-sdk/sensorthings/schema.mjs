// MIT. Pure source-owned SensorThings metadata. No native runtime imports.
import {MAX_RETAINED_CHUNK_BYTES} from '../../../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';
export const WORKSPACE_SCHEMA='stellar-forge.sensorthings-workspace.v1';
export const EDITION_SCHEMA='stellar-forge.sensorthings-edition.v1';
export const SOURCE_CONTRACT=Object.freeze({
  protocol:'OGC SensorThings API Part 1: Sensing 1.1',
  specification:'https://docs.ogc.org/is/18-088/18-088.html',
  edition:'OGC 18-088, 2021-08-04',
  operations:'Read-only HTTP GET; advertised service, entities and opaque continuation links.',
  paging:'A completed traversal covers the selected query. It is not an atomic provider snapshot.',
  observations:'Original phenomenonTime, resultTime, validTime, result, resultQuality and parameters remain separate.',
  meaning:'Datastream units and observed-property definitions are retained with their original observation type. Quality is not inferred.',
  scope:'No tasking, provider mutation, automatic unit conversion, interpolation or uptime calculation.'
});
export const ENTITIES=Object.freeze(['Things','Locations','HistoricalLocations','Datastreams','Sensors','ObservedProperties','Observations','FeaturesOfInterest','MultiDatastreams']);
export const ACTIONS=Object.freeze({
  'source.add':['label','serviceUrl','authorizationEnv','allowLoopback','license','requestTimeoutMs','maxPageBytes'],
  'catalog.capture':['sourceId','kind','query','previousCatalogId'],
  'plan.create':['sourceId','label','streams','observationQuery','includeHistoricalLocations','maxRequests','maxBytes'],
  'capture.start':['planId','budget'],
  'capture.resume':['captureId','budget','retryFailed'],
  'capture.pause':['captureId'],
  'capture.seal':['captureId','allowPartial','reason'],
  'edition.review':['editionId','decision','actor','note','acknowledgeIssues'],
  'edition.compare':['leftId','rightId'],
  'edition.export':['editionId'],
  'edition.import':['filename','expectedSha256','expectedBytes'],
  'dataset.prepare':['editionId','name','table'],
  'dataset.query':['datasetId','query'],
  'release.prepare':['datasetId','origin','path','payment'],
  'release.activate':['releaseId','expectedGeneration'],
  'release.rollback':['releaseId','expectedGeneration'],
  'release.start':['releaseId','expectedGeneration'],
  'release.stop':['releaseId'],
  'buyer.inspect':['intentIds'],
  'buyer.receive':['intentIds'],
  'publisher.buyer.review':['datasetId','snapshot','query'],
  'publisher.buyer.prepare':['datasetId','review','intentId','acceptIndex','offerSha256'],
  'publisher.buyer.session':['datasetId','buyerId','maxPages','maxTotalAtomic','maxRows','maxPageBytes'],
  'publisher.buyer.run':['datasetId','id','retryUnpaid','expectedAttemptSha256'],
  'publisher.buyer.recover':['datasetId','id'],
  'publisher.buyer.account':['datasetId','id'],
  'publisher.buyer.export':['datasetId','id']
});
export function workspaceSchema(workspaceId){
  return {schema:'stellar-forge.sensorthings-schema.v1',workspaceSchema:WORKSPACE_SCHEMA,workspaceId,
    sourceContract:SOURCE_CONTRACT,actions:ACTIONS,tables:['observations','components','entities'],
    operation:'Use one stable operationId and the displayed expectedRevision. Reopen the same operation after a lost reply.',
    limits:{maxPageBytes:16*1024*1024,maxNativeDatasetBytes:256*1024*1024,maxNativeRows:250000,maxFileChunkBytes:MAX_RETAINED_CHUNK_BYTES,defaultFileChunkBytes:65536}};
}

export const CONNECTION_SCHEMA='stellar-forge.sensorthings-workspace-connection.v1';
export const STARTUP_SCHEMA='stellar-forge.sensorthings-workspace-startup.v1';
