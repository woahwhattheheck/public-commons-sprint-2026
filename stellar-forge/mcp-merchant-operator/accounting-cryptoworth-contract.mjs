// MIT. Wire shapes for the existing Cryptoworth accountant workflow.
export const CRYPTOWORTH_TOOL_PREFIX='merchant_accounting_cryptoworth_';
export const CRYPTOWORTH_CLIENT_OPERATION_SCHEMA='stellar-forge.accounting-cryptoworth-operation.v1';
export const CRYPTOWORTH_FILE_SELECTORS=['profileId','captureId','returnId','rollbackId','scope'];
export const cryptoworthFileName={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$'};
const text={type:'string',maxLength:4000},alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
export const cryptoworthNativeId={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$'};
const nativeId=cryptoworthNativeId,sha={type:'string',pattern:'^[a-f0-9]{64}$'};
const nullableId={anyOf:[nativeId,{type:'null'}]},instant={type:'string',minLength:1,maxLength:80};
const object=(properties,required=[],additionalProperties=false)=>({type:'object',properties,required,additionalProperties});
const page={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:200}};
const filter={...page,status:{type:'string',maxLength:100},search:{type:'string',maxLength:500}};
const workspace={workspace:alias},bound={...workspace,workspaceId:sha};
const revision={type:'integer',minimum:1},who={id:nativeId,name:{type:'string',minLength:1,maxLength:240},actor:{type:'string',minLength:1,maxLength:1000},createdAt:instant};
const sourceFile=object({source:alias,name:{type:'string',minLength:1,maxLength:240},sha256:sha,bytes:{type:'integer',minimum:0,maximum:134217728}},['source','name']);
const roles=['date','cryptoId','type','amountOne','amountOneType','amountTwo','amountTwoType','transactionHash','connectionId','note','ledgerId','rowId'];
const columns=object(Object.fromEntries(roles.map(role=>[role,{type:'string',minLength:1,maxLength:1000}])));
const date=object({format:{type:'string',enum:['ISO_UTC','UTC_SECONDS','UTC_DATE','ZONE_SECONDS','ZONE_DATE']},timeZone:{type:'string',minLength:1,maxLength:100},precision:{type:'string',enum:['day','second','millisecond']}},['format','timeZone']);
const target=object({entityId:text,entityName:text,connectionId:text,connectionName:text,merchantAccount:text},['entityId','connectionId','merchantAccount']);
const profile={...who,previousProfileId:nullableId,file:sourceFile,delimiter:{type:'string',enum:[',',';','\t']},columns,
  constants:object({},[],true),target,date,assets:{type:'array',minItems:1,maxItems:500,items:object({
    network:{type:'string',enum:['stellar:testnet','stellar:pubnet']},assetDigest:sha,cryptoId:text,amountType:text,scale:{type:'integer',minimum:0,maximum:30}},
    ['network','assetDigest','cryptoId','amountType','scale'])}};
const plan={...who,profileId:nativeId,handoffId:nativeId,accountantRevisionId:{anyOf:[nativeId,{type:'string',enum:['initial']}]},previousPlanId:nullableId,
  decisions:{type:'array',maxItems:50000,items:object({movementId:sha,selectionId:{anyOf:[sha,{type:'null'}]},action:{type:'string',enum:['INCLUDE','EXCLUDE','ALREADY_IMPORTED']},reason:text,reference:text},['movementId','action'])},
  dateEvidence:{type:'array',maxItems:5000,items:object({movementId:sha,transferAt:instant,note:text,file:sourceFile},['movementId','transferAt','note','file'])}};
const nativeImport=object({id:text,entityId:text,connectionId:text,receivedAt:instant,reference:text,note:text},['id','entityId','connectionId','receivedAt','reference']);
const capture={...who,purpose:{type:'string',enum:['IMPORT_RETURN','BASELINE']},file:sourceFile,nativeImport,layout:object({
  kind:{type:'string',enum:['INPUT_FORMAT','MAPPED_EXPORT']},delimiter:{type:'string',enum:[',',';','\t']},columns,date,
  amountConvention:{type:'string',enum:['UNSIGNED','SEND_NEGATIVE']},amountTwoConvention:{type:'string',enum:['UNSIGNED','SEND_NEGATIVE']},groupSeparator:{type:'string',enum:['',',']}},['kind'])};
const returned={...who,captureId:nativeId,status:{type:'string',enum:['REVIEWED','BOOKED']},bookRef:text,
  accountCode:{anyOf:[text,{type:'null'}]},note:text,expectedParentId:nullableId};
export const CRYPTOWORTH_REQUEST_FIELDS={profile:Object.keys(profile),plan:Object.keys(plan),capture:Object.keys(capture),return:Object.keys(returned)};
const requests={profile,plan,capture,return:returned};
const required={profile:['name','actor','file','columns','constants','target','date','assets'],plan:['name','actor','profileId','handoffId','accountantRevisionId'],
  capture:['name','actor','purpose','file','nativeImport','layout'],return:['name','actor','captureId','status','expectedParentId']};
const readOnly={readOnly:true,idempotent:true};
export const cryptoworthDefinitions=[
  [CRYPTOWORTH_TOOL_PREFIX+'status','Read this original Cryptoworth owner, workspace ID and revision. Page saved mappings, receiving plans, original handoffs or complete import-unit rollbacks.',{...workspace,view:{type:'string',enum:['summary','profiles','plans','handoffs','rollbacks']},...page},['workspace'],readOnly],
  [CRYPTOWORTH_TOOL_PREFIX+'source','Page the selected frozen original handoff and native payment/refund source. Keep accountantRevisionId explicit; initial selects the unchanged first handoff.',{...workspace,handoffId:nativeId,accountantRevisionId:{anyOf:[nativeId,{type:'string',enum:['initial']}]},...filter},['workspace','handoffId','accountantRevisionId'],readOnly],
  [CRYPTOWORTH_TOOL_PREFIX+'template','Inspect the actual customer-supplied native template from one configured input alias. Returns exact filename, byte count and SHA256 for review.',{...workspace,file:sourceFile,delimiter:{type:'string',enum:[',',';','\t']}},['workspace','file'],readOnly],
  ...Object.keys(requests).flatMap(kind=>[
    [CRYPTOWORTH_TOOL_PREFIX+kind+'_preview','Review the original '+kind+' operation. File aliases are expanded using actual bytes and returned with exact hashes; keep the complete normalized request, workspace ID, revision and native preview hash.',
      {...workspace,...(['capture','return'].includes(kind)?{planId:nativeId}:{}),request:object(requests[kind],required[kind]),...(['plan','capture'].includes(kind)?filter:{})},
      ['workspace',...(['capture','return'].includes(kind)?['planId']:[]),'request'],{readOnly:true}],
    [CRYPTOWORTH_TOOL_PREFIX+kind+'_save','Save the exact reviewed original '+kind+' request. Preserve the native ID, timestamp, file hashes, workspace ID and preview hash. A retained native ID recovers the original outcome; no new payment or vendor import is initiated.',
      {...bound,...(['capture','return'].includes(kind)?{planId:nativeId}:{}),request:object({...requests[kind],revision,previewSha256:sha},[...required[kind],'id','createdAt','revision','previewSha256'])},
      ['workspace','workspaceId',...(['capture','return'].includes(kind)?['planId']:[]),'request'],{idempotent:true}]
  ]),
  [CRYPTOWORTH_TOOL_PREFIX+'profile','Read one exact retained mapping, source template identity and original files.',{...workspace,profileId:nativeId},['workspace','profileId'],readOnly],
  [CRYPTOWORTH_TOOL_PREFIX+'plan','Read one retained receiving plan or page its captures, returns, rollbacks, files, prior packet receipts, decisions or native date sources.',{...workspace,planId:nativeId,view:{type:'string',enum:['summary','captures','returns','rollbacks','files','receivedPackets','decisions','dateEvidence']},...page},['workspace','planId'],readOnly],
  [CRYPTOWORTH_TOOL_PREFIX+'rows','Page exact source/import rows or a selected native receiving comparison without changing their atomic amounts, signs or opaque native IDs.',{...workspace,planId:nativeId,captureId:nativeId,...filter},['workspace','planId'],readOnly],
  [CRYPTOWORTH_TOOL_PREFIX+'capture','Read one saved native receiving capture, its source bytes, comparison summary and import-unit rollbacks.',{...workspace,planId:nativeId,captureId:nativeId},['workspace','planId','captureId'],readOnly],
  [CRYPTOWORTH_TOOL_PREFIX+'return','Read the original staged, committed or superseded accountant return by native ID. PREPARED keeps the exact request available for continuation; COMMITTED and SUPERSEDED are terminal outcomes.',{...workspace,planId:nativeId,returnId:nativeId},['workspace','planId','returnId'],readOnly],
  [CRYPTOWORTH_TOOL_PREFIX+'rollback','Record an already completed rollback of the entire selected native import unit. This updates original receiving coverage; the operator supplies the real vendor completion time and reference.',
    {...bound,planId:nativeId,request:object({id:nativeId,captureId:nativeId,nativeImportId:text,completedAt:instant,actor:{...text,maxLength:1000},reason:text,reference:text,revision},['id','captureId','nativeImportId','completedAt','actor','reason','reference','revision'])},
    ['workspace','workspaceId','planId','request'],{idempotent:true}],
  [CRYPTOWORTH_TOOL_PREFIX+'rollback_record','Read one exact saved native import-unit rollback.',{...workspace,rollbackId:nativeId},['workspace','rollbackId'],readOnly],
  [CRYPTOWORTH_TOOL_PREFIX+'packet_inspect','Inspect a complete original receiving packet from a configured source alias. Rebuild its original template, source, native comparison, accountant returns and coverage before returning its exact two hashes.',{...workspace,file:sourceFile},['workspace','file'],readOnly],
  [CRYPTOWORTH_TOOL_PREFIX+'packet_receive','Receive the exact reviewed source packet in this original owner. Pin the input SHA256 and sealed packet SHA256. Existing native IDs retain their original history and source files.',
    {...bound,file:sourceFile,revision,actor:{...text,maxLength:1000},name:{...text,maxLength:240},expectedSha256:sha,expectedPacketSha256:sha},
    ['workspace','workspaceId','file','revision','actor','expectedSha256','expectedPacketSha256'],{idempotent:true}],
];

export function cryptoworthPreviewBinding(value){return {kind:value.kind,workspaceId:value.workspaceId,planId:value.planId??null,request:value.request,workspaceRevision:value.workspaceRevision,previewSha256:value.previewSha256,requestSha256:value.requestSha256};}
