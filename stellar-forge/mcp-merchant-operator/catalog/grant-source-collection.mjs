// MIT. Complete original Source Collection agent lifecycle.
const str=(max=12000)=>({type:'string',maxLength:max});
const text=(max=300)=>({...str(max),minLength:1});
const sha={type:'string',pattern:'^[a-f0-9]{64}$'};
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const collectionId={type:'string',pattern:'^collection-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'};
const sequence={type:'integer',minimum:0,maximum:9007199254740990};
const input={type:'object',additionalProperties:false,properties:{hostInput:alias,snapshotId:text(100),
  transferId:text(100),sourceWorkspace:alias},oneOf:[{required:['hostInput']},{required:['snapshotId']},{required:['transferId']}]};
const base={workspace:alias,collectionId,actor:text(300),note:str(12000)};
const required=['workspace','collectionId','actor'];
const version={...base,expectedSequence:sequence};
const mutation=[...required,'expectedSequence'];
function tool(name,description,properties,needed,readOnly=false){
  return {name:'merchant_grant_source_collection_'+name,description,
    annotations:{readOnlyHint:readOnly,destructiveHint:false,idempotentHint:false,openWorldHint:false},
    inputSchema:{type:'object',additionalProperties:false,properties,required:needed}};
}
export const grantSourceCollectionTools=[
  tool('create','Start a complete original Source Desk working copy from the current native case and source draft. Choose one stable collection UUID and retain it. No native source mutation occurs.',
    {...base,caseId:{type:'string',pattern:'^operation-[a-f0-9]{32}$'},draftId:{type:'string',pattern:'^source-desk-[a-f0-9]{32}$'},
      name:text(1000),staffContext:{type:['object','null'],additionalProperties:true}},[...required,'caseId','draftId']),
  tool('import','Receive the complete original browser working-copy JSON into immutable private checkpoints. Configured host input and original snapshots support the full512 MiB copy; completed transfers preserve their original32 MiB bound.',
    {...base,input,expectedInputSha256:sha},[...required,'input','expectedInputSha256']),
  tool('inspect','Read the complete original collection inventory, current review, copy sequence and pending request status. Original bytes remain in the complete retained working copy.',
    base,required,true),
  tool('start','Start another collection using the original browser action, retaining the previous complete working copy and all native request history.',
    {...version,title:text(300),sourceUrl:str(12000),observedAt:str(300)},mutation),
  tool('stage','Stage whole original SHA-bound files through the original collection engine. Each source is at most8 MiB and the staged collection at most64 MiB; aliases resolve once and exact bytes remain in the durable copy.',
    {...version,files:{type:'array',minItems:1,maxItems:1024,items:{type:'object',additionalProperties:false,
      properties:{input,expectedInputSha256:sha,name:text(240),type:text(200),lastModified:{type:'integer',minimum:-9007199254740991,maximum:9007199254740991}},
      required:['input','expectedInputSha256','name','type']}}},[...mutation,'files']),
  tool('edit','Edit the original collection title/defaults or exact row receiving metadata. The original engine validates fields and invalidates the prior review.',
    {...version,rowId:text(160),field:text(100),value:{type:['string','boolean']}},[...mutation,'field','value']),
  tool('use_existing','Explicitly link the exact IDENTICAL source row from the current native review. Rechecks original revision, fileID, filename, size and SHA; no automatic duplicate resolution.',
    {...version,rowId:text(160),selection:{type:'object',additionalProperties:false,
      properties:{revision:{type:'integer',minimum:1,maximum:10000},fileId:{type:'string',pattern:'^input-[a-f0-9]{64}$'},
        sha256:sha,bytes:{type:'integer',minimum:1,maximum:8388608},filename:text(240)},
      required:['revision','fileId','sha256','bytes','filename']}},[...mutation,'rowId','selection']),
  tool('clear_existing','Clear one original explicit existing-file link and require a new collection review.',
    {...version,rowId:text(160)},[...mutation,'rowId']),
  tool('review','Refresh the same native source head and retain its complete original collection review signature.',
    version,mutation),
  tool('receive','Receive the complete reviewed collection through original file.add commands. Every exact request+row is saved before POST; every original receipt is saved before the next file. Resume this same copy after uncertainty.',
    {...version,expectedSignature:sha},[...mutation,'expectedSignature']),
  tool('reconcile','Read pending original request identities. Set retry:true only to execute the same original unrecorded bytes; recorded receipts are reused without another write.',
    {...version,retry:{type:'boolean'}},mutation),
  tool('retire_rejected','Reconcile and retire a definitively rejected original collection request. Unknown outcomes remain pending and recoverable.',
    version,mutation),
  tool('refresh','Refresh the original current draft while retaining every complete working editor and request.',
    version,mutation),
  tool('pause','Ask this host’s active original collection receive loop to stop after its current request. The original complete-copy checkpoint retains the pause.',
    base,required),
  tool('history','Read every immutable complete-copy sequence and original checkpoint SHA.',
    base,required,true),
  tool('export','Retain a complete browser-importable working copy at the current or selected original sequence. Use the existing SHA-bound retained file reader for every byte.',
    {...base,sequence},required,true),
];
