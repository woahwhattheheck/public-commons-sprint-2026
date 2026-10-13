// MIT. Original Grant procedure save and complete receiving through Merchant.
const text = (maxLength = 12000) => ({type:'string', maxLength});
const nonempty = (maxLength = 300) => ({...text(maxLength), minLength:1});
const alias = {type:'string', pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const digest = {type:'string', pattern:'^[a-f0-9]{64}$'};
const requestId = {type:'string', pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'};
const nativeId = prefix => ({type:'string', pattern:'^' + prefix + '-[a-f0-9]{32}$'});
const version = {type:'integer', minimum:1, maximum:10000000};
const operation = {enum:['save','export','receive']};
const input = {
  type:'object', additionalProperties:false,
  properties:{hostInput:alias, snapshotId:nonempty(80), transferId:nonempty(80), sourceWorkspace:alias},
  oneOf:[{required:['hostInput']}, {required:['snapshotId']}, {required:['transferId']}],
  description:'One complete original declared file, retained snapshot or committed transfer. sourceWorkspace selects its original host-declared workspace.',
};
const selectedFile = {
  type:'object', additionalProperties:false,
  properties:{input, expectedInputSha256:digest},
  required:['input','expectedInputSha256'],
};
const delivery = {
  type:'object', additionalProperties:false,
  properties:{
    manifest:{...selectedFile, description:'Complete original DELIVERY.json with its exact complete hash.'},
    files:{
      type:'array', minItems:1, maxItems:100,
      items:{
        type:'object', additionalProperties:false,
        properties:{
          name:{type:'string', pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$'},
          input, expectedInputSha256:digest,
        },
        required:['name','input','expectedInputSha256'],
      },
      description:'Every original member named by DELIVERY.json, preserving its exact name and complete bytes. The native receiver validates all members, original case archive and procedure.',
    },
  },
  required:['manifest','files'],
  description:'Complete original native procedure delivery. procedure_export returns this selection ready for another declared receiving workspace.',
};
function tool(suffix, description, properties, required, readOnly = false) {
  return {
    name:'merchant_grant_procedure_' + suffix, description,
    annotations:{readOnlyHint:readOnly, destructiveHint:false, idempotentHint:true, openWorldHint:false},
    inputSchema:{type:'object', additionalProperties:false,
      properties:{workspace:alias, ...properties}, required:['workspace', ...required]},
  };
}
export const grantProcedureTools = [
  tool('save',
    'Save the complete reviewed Grant procedure through the original native preflight, source writer and exact-byte reopening. Case, version, actor, note and edition stay inside the selected original document. Retain this request ID and input hash; inspect a lost response and use resume:true for the same dispatched request. Actual accepted native returns remain visible even when later local retention or verification fails.',
    {requestId,input,expectedInputSha256:digest,resume:{type:'boolean',default:false}},
    ['requestId','input','expectedInputSha256']),
  tool('export',
    'Publish the complete original native procedure delivery, including its saved source, Operating plan, readable handovers, verification and whole case ZIP. Pin the reviewed current case version. The retained request returns every member snapshot and a ready-to-use delivery selection; repeating it reopens the original frozen directory.',
    {requestId,caseId:nativeId('operation'),sourceId:nativeId('source'),expectedVersion:version},
    ['requestId','caseId','sourceId','expectedVersion']),
  tool('receive',
    'Receive every original frozen delivery member through the existing native Grant case importer, then independently reopen the selected procedure and verify its original archive and source lineage. Retain the same request ID, full delivery selection, receiving name and actor. Inspect a lost response; resume:true continues that same original dispatched import.',
    {requestId,delivery,name:nonempty(300),actor:nonempty(300),resume:{type:'boolean',default:false}},
    ['requestId','delivery','name','actor']),
  tool('open',
    'Reopen a saved native Grant procedure by its original case and source identity. Verify its selected sources through the original reader and retain the complete procedure, current case and verification as original file snapshots.',
    {caseId:nativeId('operation'),sourceId:nativeId('source')},['caseId','sourceId']),
  tool('inspect',
    'Inspect one retained original procedure save, export or receive request without opening or mutating a native case. Reopen its original intent, dispatch, positive return, completion and complete retained outputs. Recover file publication while preserving accepted native results and the original resume identity.',
    {operation,requestId},['operation','requestId'],true),
  tool('list',
    'Page retained original procedure operations for one declared workspace. Select an operation and request ID, then inspect it for complete originals and exact recovery. Follow nextOffset until null.',
    {operation,offset:{type:'integer',minimum:0,default:0},limit:{type:'integer',minimum:1,maximum:100,default:20}},[],true),
];
