// MIT. Original tool metadata; provider runtimes load only when selected.


const PREFIX='merchant_accounting_customer_';

const uuid={type:'string',pattern:'^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$'};

const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};

const text=(max,min=0)=>({type:'string',minLength:min,maxLength:max});

const actor=text(1000,1);

const revision={type:'integer',minimum:1};

const hash={type:'string',pattern:'^[a-f0-9]{64}$'};

const nullableId={anyOf:[uuid,{type:'null'}]};

const stamp=text(80,1);

const requestId={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'};

const base={workspace:alias};

const change={...base,revision,actor};

const page={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:200}};

const selection={customerId:uuid,runId:uuid,usageId:nullableId,replacesId:nullableId,from:stamp,until:stamp};

const profile={reference:text(80,1),name:text(200,1),email:text(320),address:text(2000),note:text(2000)};

const readOnly={readOnly:true,idempotent:true};

const statementFileNames=Object.freeze(['statement.json','statement.csv','usage.csv','statement.html','manifest.json','status.json','preview.json']);

const statementDefinitions=[
 [PREFIX+'status','Read the original customer statement inventory. Select a paged customers, runs, usage or history view; summary returns counts and the original workspace revision.',
  {...base,view:{type:'string',enum:['summary','customers','runs','usage','history']},search:text(300),...page},['workspace'],readOnly],
 [PREFIX+'save','Create or edit the original customer profile. Editing requires its current id and expectedVersion; inspect the original reference after an uncertain reply.',
  {...change,...profile,id:uuid,expectedVersion:revision},['workspace','revision','actor','reference','name'],{}],
 [PREFIX+'bindings','Page the original order-to-customer assignments. Each row includes its original binding identity/version and history count.',
  {...base,customerId:uuid,search:text(300),...page},['workspace'],readOnly],
 [PREFIX+'order','Inspect one exact original order assignment and a page of its retained reassignment history.',
  {...base,orderRef:{type:'string',pattern:'^[A-Za-z0-9._:-]{1,80}$'},...page},['workspace','orderRef'],readOnly],
 [PREFIX+'assign','Assign original paid orders to a saved customer. Cross-customer reassignment requires reassign:true and its correction reason.',
  {...change,customerId:uuid,orders:{type:'array',minItems:1,maxItems:2000,items:{type:'object',properties:{orderRef:{type:'string',pattern:'^[A-Za-z0-9._:-]{1,80}$'},label:text(300)},required:['orderRef'],additionalProperties:false}},
   reassign:{type:'boolean'},reason:text(2000)},['workspace','revision','actor','customerId','orders'],{}],
 [PREFIX+'usage_source','Read and validate a host-declared original service/API usage capture. Retain its exact source SHA before importing.',
  {...base,source:alias},['workspace','source'],readOnly],
 [PREFIX+'usage_import','Import the reviewed host-declared usage source into the original workspace. The exact input SHA is required; native byte-identical imports retain the original identity.',
  {...change,source:alias,expectedSha256:hash,name:text(200,1)},['workspace','revision','actor','source','expectedSha256'],{idempotent:true}],
 [PREFIX+'statement_preview','Prepare the original statement or correction. Returns the native preview digest and a complete preview.json file selector for the existing chunk reader.',
  {...base,...selection,view:{type:'string',enum:['summary','items','excluded','assets','calls','adjustments']},orderRef:{type:'string',pattern:'^[A-Za-z0-9._:-]{1,80}$'},...page},['workspace','customerId','runId'],readOnly],
 [PREFIX+'statement_retain','Retain the exact reviewed original statement or correction. Keep requestId and previewSha256; changed reuse of that request identity is rejected by the native engine.',
  {...change,...selection,requestId,previewSha256:hash},['workspace','revision','actor','customerId','runId','requestId','previewSha256'],{idempotent:true}],
 [PREFIX+'statements','Page all retained, withdrawn or superseded original statements, optionally for one customer.',
  {...base,customerId:uuid,status:{type:'string',enum:['RETAINED','WITHDRAWN','SUPERSEDED']},...page},['workspace'],readOnly],
 [PREFIX+'statement_lookup','Find the original statement by its stable retention requestId, including its current status and immutable file identities.',
  {...base,requestId},['workspace','requestId'],readOnly],
 [PREFIX+'statement','Read one original statement, its source/totals, or a page of orders, calls, adjustments, exclusions, assets or lifecycle history. Full source uses the existing file reader.',
  {...base,statementId:uuid,view:{type:'string',enum:['summary','items','excluded','assets','calls','adjustments','history']},orderRef:{type:'string',pattern:'^[A-Za-z0-9._:-]{1,80}$'},...page},['workspace','statementId'],readOnly],
 [PREFIX+'statement_withdraw','Withdraw the current retained statement with the original actor and reason. Its five original artifacts remain downloadable; reconcile an uncertain reply from the retained withdrawal history.',
  {...change,statementId:uuid,reason:text(2000,1)},['workspace','revision','actor','statementId','reason'],{}]
];

export { statementDefinitions, statementFileNames, PREFIX, base, text, page, readOnly, change, profile, uuid, revision, alias, hash, selection, requestId, actor, nullableId, stamp };
