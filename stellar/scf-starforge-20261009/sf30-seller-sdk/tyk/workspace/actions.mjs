// MIT. Pure contract shared by the customer UI, installed SDK and original MCP provider.
export const TYK_WORKSPACE_SCHEMA = 'stellar-forge.tyk-workspace.v1';
export const TYK_MAX_JSON_BYTES = 128 * 1024 * 1024;
const text = maximum => ({ type: 'string', maxLength: maximum });
const id = { type: 'string', pattern: '^[a-f0-9]{24}$' };
const sha = { type: 'string', pattern: '^[a-f0-9]{64}$' };
const uuid = { type: 'string', pattern: '^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$' };
const revision = { type: 'integer', minimum: 1 };
const kind = { enum: ['connection','capture','cohort','commissioning','rollout','delivery','receiving'] };
const reference = { type: 'object', properties: { sha256: sha, bytes: { type: 'integer', minimum: 0 },
  mediaType: text(200) }, required: ['sha256','bytes'], additionalProperties: false };
const paging = { offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1, maximum: 500 } };
const connection = { type: 'object', properties: { schema: {enum:['stellar-forge.tyk-connection.v1']}, id: text(128), label: text(300), kind: { enum: ['gateway','dashboard'] },
  baseUrl: text(4000), authEnv: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' } },
  required: ['id','label','kind','baseUrl','authEnv'], additionalProperties: false };
const selection = { type: 'object', properties: {
  operation: { enum: ['migrate','create','import','update','hotReload'] },
  mode: { enum: ['dryRun','stage','promote','direct'] }, apiIds: { type: 'array', items: text(1000), minItems: 1, uniqueItems: true },
  abortOnFailure: { type: 'boolean' }, overrideStaged: { type: 'boolean' },
  kind: { enum: ['classic','oas'] }, apiId: text(1000), definitionText: text(64*1024*1024),
  contentType: { enum: ['application/json','application/x-yaml'] }, query: { type: 'object' },
  scope: { enum: ['node','group'] }, block: { type: 'boolean' },
}, required: ['operation'], additionalProperties: false };
function action(title, description, write, properties, required = []) {
  return Object.freeze({ title, description, write,
    inputSchema: { type: 'object', properties: { ...(write ? { requestId: uuid } : {}), ...properties },
      required: [...(write ? ['requestId'] : []), ...required], additionalProperties: false } });
}
export const TYK_WORKSPACE_ACTIONS = Object.freeze({
  view: action('Workspace', 'Read saved targets, credential availability and complete record counts.', false, {}),
  listRecords: action('Saved records', 'Page every current saved record with the original list snapshot.', false,
    { kind, ...paging, snapshot: sha }),
  getRecord: action('Read saved record', 'Read an exact saved revision, its native request review and a portfolio page.', false,
    { kind,id,revision,...paging }, ['kind','id']),
  readDefinition: action('Original definition', 'Read the complete original definition and native capture metadata.', false,
    { captureId:id, apiId:text(1000), revision }, ['captureId','apiId']),
  readSource: action('Original source', 'Read a retained original JSON source by exact immutable reference.', false,
    { reference }, ['reference']),
  adaptDefinition: action('Prepare captured definition', 'Read a captured native definition in the exact Gateway or Dashboard Classic envelope required by the selected target.', false,
    {captureId:id,revision,apiId:text(1000),connectionId:id}, ['captureId','apiId','connectionId']),
  readReview: action('Native field review', 'Read the complete original definition sources and a page of lossless field changes for one saved rollout revision.', false,
    {id,revision,...paging}, ['id']),
  saveConnection: action('Save target', 'Save a Gateway or Dashboard target and its credential environment name.', true,
    { id,expectedRevision:{type:'integer',minimum:0},connection }, ['connection']),
  capture: action('Capture portfolio', 'Capture the complete native API inventory, every source definition and original response.', true,
    { connectionId:id,label:text(300) }, ['connectionId']),
  importCapture: action('Import portfolio capture', 'Retain and validate a complete original inventory capture JSON.', true,
    { connectionId:id,label:text(300),capture:{type:'object'} }, ['connectionId','capture']),
  createCohort: action('Save API cohort', 'Save an explicit API selection from one immutable portfolio capture.', true,
    { id,expectedRevision:{type:'integer',minimum:0},label:text(300),note:text(20000),
      captureId:id,captureRevision:revision,apiIds:{type:'array',items:text(1000),minItems:1,uniqueItems:true} },
    ['label','captureId','captureRevision','apiIds']),
  createCommissioning: action('Save cohort commissioning', 'Save a complete Dashboard cohort procedure with original native bindings and selected operational checks.', true,
    {cohortId:id,cohortRevision:revision,label:text(300),customer:text(300),operator:text(300),
      checkNames:{type:'array',items:text(200),minItems:1,uniqueItems:true},
      workshare:{type:'object',properties:{name:text(1000),mediaType:text(200),contentBase64:text(32*1024*1024),note:text(20000)},
        required:['name','mediaType','contentBase64'],additionalProperties:false},abortOnFailure:{type:'boolean'},overrideStaged:{type:'boolean'}},
    ['cohortId','cohortRevision','label','checkNames']),
  readCommissioning: action('Read cohort commissioning', 'Read complete original native progress, staged source identities, operating-plan history and review contexts.', false,
    {id,revision},['id']),
  prepareCommissioningStep: action('Prepare next cohort request', 'Prepare the selected native conversion, staging or promotion through the original rollout owner.',true,
    {id,expectedRevision:revision,stepId:{enum:['conversion','staging','promotion']}},['id','expectedRevision','stepId']),
  refreshCommissioning: action('Capture commissioning portfolio', 'Capture the complete current staged or promoted portfolio using the original native capture operation.',true,
    {id,expectedRevision:revision,phase:{enum:['staged','final']}},['id','expectedRevision','phase']),
  recordCommissioningReview: action('Record cohort acceptance', 'Retain an explicit original-source review and every selected API/check result with complete supporting files.',true,
    {id,expectedRevision:revision,stepId:{enum:['conversion-review','production-review']},contextSha256:sha,
      reviewer:text(300),note:text(20000),checks:{type:'array',items:{type:'object',properties:{apiId:text(1000),name:text(200),
        outcome:{enum:['passed','failed']},note:text(20000)},required:['apiId','name','outcome','note'],additionalProperties:false}},
      files:{type:'array',items:{type:'object',properties:{name:text(1000),mediaType:text(200),contentBase64:text(32*1024*1024),note:text(20000)},
        required:['name','mediaType','contentBase64'],additionalProperties:false}}},
    ['id','expectedRevision','stepId','contextSha256','reviewer','note']),
  prepareRollout: action('Prepare native request', 'Read the target preimage and retain the exact native request for review.', true,
    { connectionId:id,cohortId:id,cohortRevision:revision,label:text(300),note:text(20000),selection,
      sourceDefinition:{type:'object',properties:{captureId:id,revision,apiId:text(1000),sha256:sha},
        required:['captureId','revision','apiId','sha256'],additionalProperties:false} },
    ['connectionId','selection']),
  dispatchRollout: action('Execute reviewed request', 'Dispatch the saved native request once, retain its response and read back affected APIs.', true,
    { id,expectedRevision:revision,planSha256:sha }, ['id','expectedRevision','planSha256']),
  reconcileRollout: action('Refresh original request', 'Read back the original dispatched request using its retained response and exact target.', true,
    { id,expectedRevision:revision }, ['id']),
  exportWorkspace: action('Export complete handover', 'Stream every saved record revision, original source blob and native journal into a complete delivery.', true,
    { label:text(300) }),
  inspectDelivery: action('Inspect original handover', 'Inspect a complete local NDJSON handover and retain its original source bytes before receiving.', true,
    { path:text(4000),label:text(300) }, ['path']),
  adoptDelivery: action('Receive reviewed handover', 'Receive the exact inspected history and source closure; resume the same original receiving operation after interruption.', true,
    { id,expectedRevision:revision,manifestSha256:sha }, ['id','expectedRevision','manifestSha256']),
});
export const TYK_RECORD_STATES = Object.freeze([
  'IN_PROGRESS','COMPLETE','SAVED','CAPTURING','CAPTURED','PREPARING','PREPARED','DISPATCHED','READBACK',
  'CONFIRMED','ACCEPTED','PARTIAL','UNCHANGED','DIVERGED','ABSENT','UNKNOWN','STALE',
  'PREPARE_FAILED','INTERRUPTED','EXPORTED','INSPECTED','ADOPTING','ADOPTED',
]);
export function validateTykAction(method,args) {
  const contract = TYK_WORKSPACE_ACTIONS[method];
  const invalid = message => { throw Object.assign(new Error(message),{code:'TYK_ACTION_INPUT_INVALID',status:400}); };
  if (!contract || !args || typeof args !== 'object' || Array.isArray(args)) invalid('Select a declared workspace action.');
  const check = (value,schema,path) => {
    if (schema.enum && !schema.enum.includes(value)) invalid(path+' has an unsupported value.');
    if (schema.type === 'object') {
      if (!value || typeof value !== 'object' || Array.isArray(value)) invalid(path+' must be an object.');
      for (const key of schema.required ?? []) if (!Object.hasOwn(value,key)) invalid(path+'.'+key+' is required.');
      for (const [key,part] of Object.entries(value)) {
        if (schema.additionalProperties === false && !Object.hasOwn(schema.properties ?? {},key)) invalid(path+'.'+key+' is not declared.');
        if (schema.properties?.[key]) check(part,schema.properties[key],path+'.'+key);
      }
    } else if (schema.type === 'string') {
      if (typeof value !== 'string' || schema.maxLength !== undefined && value.length > schema.maxLength ||
        schema.pattern && !(new RegExp(schema.pattern)).test(value)) invalid(path+' must be valid text.');
    } else if (schema.type === 'integer') {
      if (!Number.isSafeInteger(value) || schema.minimum !== undefined && value < schema.minimum ||
        schema.maximum !== undefined && value > schema.maximum) invalid(path+' is outside its range.');
    } else if (schema.type === 'boolean' && typeof value !== 'boolean') invalid(path+' must be true or false.');
    else if (schema.type === 'array') {
      if (!Array.isArray(value) || schema.minItems !== undefined && value.length < schema.minItems ||
        schema.uniqueItems && new Set(value.map(item=>JSON.stringify(item))).size !== value.length) invalid(path+' must be a valid selection.');
      value.forEach((item,index)=>check(item,schema.items,path+'['+index+']'));
    }
  };
  check(args,contract.inputSchema,method);
  return contract;
}
