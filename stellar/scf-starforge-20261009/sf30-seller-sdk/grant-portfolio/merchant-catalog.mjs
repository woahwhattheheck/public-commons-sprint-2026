// MIT. Agent operations over the original portfolio model and retained file transport.
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const sha={type:'string',pattern:'^[0-9a-f]{64}$'};
const uuid={type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'};
const operation={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'};
const integer={type:'integer',minimum:0};
const positive={type:'integer',minimum:1};
const page={offset:integer,limit:{type:'integer',minimum:1,maximum:250}};
const selected={workspace:alias}, portfolio={...selected,portfolioId:uuid,revision:positive};
const read={readOnly:true,idempotent:true}, retained={idempotent:true};
const text={type:'string'};
const object=(properties,required)=>({type:'object',properties,required,additionalProperties:false});
const ref=object({sourceId:sha,entityKey:sha,sha256:sha},['sourceId','entityKey','sha256']);
const decision={oneOf:[
  object({id:uuid,type:{const:'link'},left:ref,right:ref,relation:{enum:['same-organization','grant-activity','duplicate']},
    disposition:{enum:['confirmed','rejected','ambiguous']},rationale:text},['type','left','right','relation','disposition','rationale']),
  object({id:uuid,type:{const:'record'},record:ref,disposition:{enum:['unmatched','coverage-only','duplicate']},
    related:ref,rationale:text},['type','record','disposition','rationale']),
]};
const payload={oneOf:[
  object({object:sha,standard:{enum:['iati','360giving']},label:text,
    coverage:object({statement:text,sourceUrl:text,observedAt:text,license:text},['statement','sourceUrl','observedAt','license']),
    selection:{type:'object'}},['object','standard','label','coverage']),
  object({id:uuid,expectedPortfolioRevision:positive,name:text,notes:text,sources:{type:'array',items:sha,minItems:1,maxItems:64},
    sourceReplacements:{type:'array',items:object({before:sha,after:sha},['before','after'])},
    review:object({status:{enum:['draft','reviewed','needs-correction']},reviewer:text,note:text},['status','reviewer','note'])},
    ['name','notes','sources','review']),
  object({portfolioId:uuid,expectedPortfolioRevision:positive,reviewer:text,decisions:{type:'array',items:decision}},
    ['portfolioId','expectedPortfolioRevision','reviewer','decisions']),
  object({object:sha},['object']),
]};
export function grantPortfolioTools(tool) {
  return [
    tool('merchant_grant_portfolio_workspaces','List configured original grant-portfolio consoles, their saved workspace IDs and declared native packet handles.',{},[],read),
    tool('merchant_grant_portfolio_schema','Read the original model schema, action payloads and review decision contracts before editing a portfolio.',selected,['workspace'],read),
    tool('merchant_grant_portfolio_state','Read the original workspace identity and page its complete source, portfolio or retained-request inventory. Continue using the returned snapshot.',{...selected,kind:{type:'string',enum:['sources','portfolios','requests']},...page,expectedSnapshot:sha},['workspace'],read),
    tool('merchant_grant_portfolio_source','Inspect a received native source edition and its original publisher coverage and source lineage.',{...selected,sourceId:sha},['workspace','sourceId'],read),
    tool('merchant_grant_portfolio_open','Open one saved portfolio revision before reading or reviewing its original rows.',portfolio,['workspace','portfolioId','revision'],read),
    tool('merchant_grant_portfolio_rows','Page a complete original entities, financial, links, decisions, candidates, changes or sources table, pinned to its saved revision and snapshot.',{...portfolio,table:{type:'string',enum:['entities','financial','links','decisions','candidates','changes','sources']},...page,search:{type:'string',maxLength:2000},status:{type:'string',maxLength:2000},standard:{type:'string',enum:['iati','360giving']},entityKey:sha,expectedSnapshot:sha},['workspace','portfolioId','revision','table'],read),
    tool('merchant_grant_portfolio_detail','Read the complete original entity and financial source detail for an exact saved revision.',{...portfolio,sourceId:sha,entityKey:sha},['workspace','portfolioId','revision','sourceId','entityKey'],read),
    tool('merchant_grant_portfolio_action','Run the original source.receive, portfolio.save, review.save or portfolio.receive action with its complete native payload. Save operationId and expected revisions first. A repeated identical ID opens that retained request; RUNNING is read through the request tool. Decision and financial fields retain their native values.',{...selected,operationId:operation,action:{type:'string',enum:['source.receive','portfolio.save','review.save','portfolio.receive']},payload,expectedRevision:integer},['workspace','operationId','action','payload'],retained),
    tool('merchant_grant_portfolio_request','Read the original RUNNING, COMPLETED or FAILED action after a lost reply without starting another operation.',{...selected,operationId:operation},['workspace','operationId'],read),
    tool('merchant_grant_portfolio_resume','Explicitly resume the original retained action using its existing operation ID and saved input.',{...selected,operationId:operation},['workspace','operationId'],retained),
    tool('merchant_grant_portfolio_upload','Upload a complete host-declared native packet handle, or a previously retained portfolio export, into this original workspace object store. The returned exact object SHA is selected by source.receive or portfolio.receive.',{...selected,file:alias,exportId:sha},['workspace'],retained),
    tool('merchant_grant_portfolio_export','Create the original complete portfolio ZIP with a retained action ID, then retain its immutable manifest and file for resumable receiving. If the native request is RUNNING, read it and repeat this identical export selection when complete.',{...portfolio,operationId:operation,expectedRevision:integer},['workspace','portfolioId','revision','operationId'],retained),
    tool('merchant_grant_portfolio_exports','Page complete immutable portfolio exports retained by this merchant. The files remain readable after the borrowed console closes.',{...page,workspace:alias,expectedSnapshot:sha},[],read),
    tool('merchant_grant_portfolio_manifest','Inspect one original retained portfolio receiving manifest and its complete byte/hash descriptor.',{exportId:sha},['exportId'],read),
    tool('merchant_grant_portfolio_file','Read an exact manifest or original portfolio ZIP chunk. Keep its manifest SHA, file SHA and returned original read ID while advancing offsets.',{exportId:sha,file:{type:'string',enum:['grant-portfolio-manifest.json','portfolio.zip']},expectedManifestSha256:sha,expectedSha256:sha,readId:uuid,offset:integer,limit:{type:'integer',minimum:1,maximum:196608}},['exportId','file','expectedManifestSha256','expectedSha256','offset','limit'],read),
    tool('merchant_grant_portfolio_file_release','Release this retained file read while preserving the original exported bytes and downloadable prefix.',{exportId:sha,readId:uuid},['exportId','readId'],retained),
  ];
}
