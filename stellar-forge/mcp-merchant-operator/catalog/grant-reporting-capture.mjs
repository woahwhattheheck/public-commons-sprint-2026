// MIT. Complete Grant reporting captures through the original Merchant workspace.
const text = (maxLength = 12000) => ({type:'string', maxLength});
const nonempty = (maxLength = 300) => ({...text(maxLength), minLength:1});
const alias = {type:'string', pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const digest = {type:'string', pattern:'^[a-f0-9]{64}$'};
const stableId = {type:'string', pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'};
const requestId = {type:'string', pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'};
const nativeId = prefix => ({type:'string', pattern:'^' + prefix + '-[a-f0-9]{32}$'});
const version = {type:'integer', minimum:1, maximum:10000000};
const civilDate = {type:'string', pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'};
const utcTime = {type:'string', format:'date-time',
  pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\\.[0-9]{1,3})?Z$'};
const input = {
  type:'object', additionalProperties:false,
  properties:{hostInput:alias, snapshotId:nonempty(80), transferId:nonempty(80), sourceWorkspace:alias},
  oneOf:[{required:['hostInput']}, {required:['snapshotId']}, {required:['transferId']}],
  description:'One complete declared host file, retained snapshot or committed transfer. sourceWorkspace selects another host-declared workspace holding that original snapshot or transfer.',
};
const fields = {
  type:'object', additionalProperties:false,
  properties:{
    id:{...stableId, description:'Stable Operating plan identity for this complete preparation.'},
    savedAt:{...utcTime, description:'Original UTC plan creation time. Omit to select and retain it once with this request.'},
    title:nonempty(300), customer:text(1000), period:text(1000), owner:text(300), receiving:text(32000),
    startDate:{anyOf:[civilDate, {const:''}, {type:'null'}],
      description:'First reporting date. Omit, use null, or use an empty string for cumulative reporting.'},
    asOfDate:{...civilDate, description:'Last reporting date; the original builder checks a real date and ordered reporting period.'},
    receivingWorkspace:{...nonempty(4096),
      description:'Original absolute receiving-workspace path retained in the generated plan. Capture does not open or execute this destination.'},
    commandFinderUrl:{...nonempty(4096),
      description:'Original loopback HTTP Command finder URL with its explicit port, such as http://127.0.0.1:8846. The original builder validates this address.'},
  },
  required:['id','title','asOfDate','receivingWorkspace','commandFinderUrl'],
};
const table = {
  oneOf:[
    {type:'object', additionalProperties:false,
      properties:{key:stableId, origin:{const:'case-plan'}}, required:['key','origin']},
    {type:'object', additionalProperties:false,
      properties:{key:stableId, origin:{const:'case-source'}, sourceId:nativeId('source')},
      required:['key','origin','sourceId']},
    {type:'object', additionalProperties:false,
      properties:{key:stableId, origin:{const:'preceding-procedure'}}, required:['key','origin']},
  ],
};
const edition = {
  oneOf:[
    {type:'object', additionalProperties:false,
      properties:{kind:{const:'installation'}, id:nativeId('installation'), revision:version},
      required:['kind','id','revision']},
    {type:'object', additionalProperties:false,
      properties:{kind:{const:'task-outcome'}, id:nativeId('task-outcomes'), revision:version},
      required:['kind','id','revision']},
  ],
};
const stepLinks = {
  type:'array', maxItems:1000,
  items:{type:'object', additionalProperties:false,
    properties:{
      stepId:nonempty(128),
      sourceIds:{type:'array', uniqueItems:true, items:nativeId('source')},
      tableKeys:{type:'array', uniqueItems:true, items:stableId},
      editionKeys:{type:'array', uniqueItems:true, items:nonempty(200),
        description:'Exact kind:id:revision keys of the selected original native editions.'},
      note:text(12000),
    },
    required:['stepId','sourceIds','tableKeys','editionKeys','note'],
  },
};
const procedureSelection = {
  type:'object', additionalProperties:false,
  properties:{
    actor:nonempty(300), note:text(12000), selectedRevision:version,
    parentSourceId:{anyOf:[nativeId('source'), {type:'null'}]},
    sourceIds:{type:'array', uniqueItems:true, items:nativeId('source')},
    tables:{type:'array', items:table},
    editions:{type:'array', items:edition},
    stepLinks,
  },
  required:['actor'],
  description:'Existing grant-procedures prepare selection. Original case-plan, case-source and preceding-procedure tables retain their native readers; original local tables are selected through tableInputs.',
};
const tableInputs = {
  type:'array', maxItems:256,
  items:{type:'object', additionalProperties:false,
    properties:{key:stableId, input, expectedSha256:digest},
    required:['key','input','expectedSha256']},
  description:'Complete original local table projects from existing file references. Each key is distinct across these inputs and procedureSelection.tables. Requires procedureSelection.',
};
function tool(suffix, description, properties, required, rules = {}, readOnly = true) {
  return {
    name:'merchant_grant_' + suffix, description,
    annotations:{readOnlyHint:readOnly, destructiveHint:false, idempotentHint:true, openWorldHint:false},
    inputSchema:{type:'object', additionalProperties:false,
      properties:{workspace:alias, ...properties}, required:['workspace', ...required], ...rules},
  };
}
export const grantReportingCaptureTools = [
  tool('reporting_catalog',
    'Retain the complete toolkit catalog from the installed original Command finder loader. Return its existing snapshot ID, complete byte count and SHA-256 for reporting_capture.catalog. The host selects the installed metadata; this tool accepts no alternate checkout or executable path.',
    {}, []),
  tool('reporting_capture',
    'Capture the selected original managed Grant case and complete Source Tables/catalog files into the existing portable reporting preparation, canonical Operating plan and readable handovers. Retain one request ID: an identical repeat reopens the same capture and output snapshots; changed inputs conflict. Optional procedureSelection prepares the original complete case attachment. Capture reads the case without changing business records and may start only the host-authorized original managed service. Complete outputs use the existing snapshot and file-read tools.',
    {caseId:nativeId('operation'), expectedVersion:version, requestId, fields,
      sourceProject:input, expectedSourceProjectSha256:digest, catalog:input, expectedCatalogSha256:digest,
      procedureSelection, tableInputs},
    ['caseId','expectedVersion','requestId','fields','sourceProject','expectedSourceProjectSha256','catalog','expectedCatalogSha256'],
    {allOf:[{if:{required:['tableInputs']}, then:{required:['procedureSelection']}}]}, false),
  tool('reporting_capture_inspect',
    'Reopen the original retained reporting capture by request ID without opening the native case. Validate complete frozen members and recover their retained snapshots after a lost response. Return explicit preparation, incomplete-publication or complete-retention state and every available original output.',
    {requestId}, ['requestId']),
  tool('reporting_capture_list',
    'Page the original retained reporting request catalogue without opening a native case. Each row identifies its exact request, case version and plan identity; inspect that request to validate and retrieve complete outputs. Follow nextOffset until null.',
    {offset:{type:'integer', minimum:0, default:0},
      limit:{type:'integer', minimum:1, maximum:100, default:20}}, []),
];
