// MIT. Pure analysis metadata for the original SensorThings action/schema surface.
export const ANALYSIS_SCHEMA='stellar-forge.sensorthings-analysis-version.v1';
// OGC SensorThings 1.1, Table 12: these declared result families are numeric.
export const NUMERIC_OBSERVATION_TYPES=Object.freeze([
  'http://www.opengis.net/def/observationType/OGC-OM/2.0/OM_Measurement',
  'http://www.opengis.net/def/observationType/OGC-OM/2.0/OM_CountObservation'
]);
export const ANALYSIS_LIMITS=Object.freeze({streams:20,rows:250000,annotations:1000,versions:2000,pageRows:500});
export const ANALYSIS_ACTIONS=Object.freeze({
  'analysis.python.prepare':['editionId','exportId','actor'],
  'analysis.create':['title','editionId','selection','actor','note'],
  'analysis.revise':['projectId','baseVersionId','title','editionId','selection','actor','reason'],
  'analysis.annotate':['projectId','baseVersionId','annotation','actor','reason'],
  'analysis.compare':['projectId','baseVersionId','rightEditionId','actor','note'],
  'analysis.viewer.import':['filename','expectedSha256','expectedBytes','actor'],
  'analysis.evidence.import':['projectId','baseVersionId','filename','expectedSha256','expectedBytes','title','actor','note'],
  'analysis.publish':['projectId','baseVersionId','title','actor','note','comparisonIds','evidenceIds'],
  'analysis.receipt.import':['publicationId','filename','expectedSha256','expectedBytes','actor','note'],
  'analysis.export':['projectId','actor','note'],
  'analysis.import':['filename','expectedSha256','expectedBytes','actor','note']
});
export const ANALYSIS_MEANING=Object.freeze({
  observations:'Selected original occurrences, including duplicates, missing values and unplaced source times.',
  time:'An instant remains an event. Only an explicit original interval has duration. A selected window does not establish continuous coverage.',
  categories:'Literal category results have separate event/interval lanes. They are never encoded as numeric values.',
  numeric:'Numeric diagrams accept original JSON numbers only from declared OGC OM_Measurement or OM_CountObservation streams, with explicit instantaneous phenomenonTime. Count values must be integral. Exact decimal lexemes remain in source/CSV; finite browser rendering is separate and nonzero underflow is excluded.',
  nativeViewer:'Helgoland v2.2.3 uses browser-parsed IDs and direct ID URLs. IDs that cannot round-trip through that client are unavailable in its projection; exact originals remain in the analyst tables and source files. Its expanded view uses the first original Thing Location and does not establish observation location.',
  comparison:'Observed differences between retained editions. No provider insertion/deletion, atomic snapshot, uptime or quality approval is inferred.',
  geometry:'Original retained Location/FeatureOfInterest geometry; a Thing location is not automatically an observation location.',
  authority:'An annotation is attributed operator interpretation, separate from the unchanged provider record.'
});

export const ANALYSIS_READS=Object.freeze({
  overview:'/api/analysis',
  project:'/api/analysis/projects/<projectId>',
  version:'/api/analysis/versions/<versionId>',
  summary:'/api/analysis/versions/<versionId>/summary',
  rows:'/api/analysis/versions/<versionId>/rows?offset=0&limit=100',
  comparison:'/api/analysis/comparisons/<comparisonId>',
  publication:'/api/analysis/publications/<publicationId>',
  inbox:'/api/analysis/inbox',
  pythonSource:'/api/analysis/python-sources/<sourceId>',
  sourceCatalog:'/api/analysis/editions/<editionId>/streams',
  sta:'/api/analysis/sta/<versionId>/<map|numeric>/',
  files:'Original /api/files selection {kind:"analysis",id:<publication/export/evidence/viewer/prepared-source ID>,file:<listed name>}'
});
