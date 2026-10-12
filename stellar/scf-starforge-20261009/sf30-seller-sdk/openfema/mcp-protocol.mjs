// MIT. Source-owned OpenFEMA tool metadata; catalog import opens no workspace.
import { MAX_RETAINED_CHUNK_BYTES } from '../../../../stellar-forge/mcp-merchant-operator/retained-file-contracts.mjs';

export const OPENFEMA_TABLES = Object.freeze(['projects','applicants','disasters','declarations','categories','issues']);
export const OPENFEMA_FILE_KINDS = Object.freeze(['source','portfolio','export','receipt']);
export const OPENFEMA_OPERATION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/;
const ALIAS=/^[a-z0-9][a-z0-9_-]{0,63}$/, SHA=/^[a-f0-9]{64}$/;
const UUID=/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const SHORT=/^[a-f0-9]{24}$/, PORTFOLIO=/^portfolio-[a-f0-9]{24}$/;
const DATASET=/^dataset-[a-f0-9]{24}$/, RELEASE=/^openfema-[a-f0-9]{24}$/;
const FILE=/^[A-Za-z0-9][A-Za-z0-9._-]{0,239}$/;
const fail=(message)=>Object.assign(new Error(message),{code:'INVALID_PARAMS'});
const plain=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const text=(maxLength=200,minLength=0)=>({type:'string',minLength,maxLength});
const matching=pattern=>({type:'string',pattern:pattern.source});
const integer=(minimum=0,maximum=Number.MAX_SAFE_INTEGER)=>({type:'integer',minimum,maximum});
const choice=values=>({type:'string',enum:values});
const object=(properties,required=[])=>({type:'object',properties,required,additionalProperties:false});
const array=(items,maxItems,minItems=0)=>({type:'array',items,minItems,maxItems});
const bool={type:'boolean'}, digest=matching(SHA), id=matching(SHORT), portfolio=matching(PORTFOLIO);
const table=choice(OPENFEMA_TABLES), dataset=matching(DATASET), release=matching(RELEASE);
const exactAmount={type:'string',maxLength:200,description:'Original decimal USD text; no binary floating-point conversion.'};
const sourceScope=object({
  disasterNumbers:array({anyOf:[integer(1,99999),{type:'string',pattern:'^[0-9]{1,5}$'}]},20000),
  states:array({type:'string',pattern:'^[A-Za-z]{2}$'},100),
  declarationDateFrom:text(10),declarationDateTo:text(10),pageSize:integer(1,10000)
});
const criteriaFields={
  name:text(160,1),states:array({type:'string',pattern:'^[A-Z]{2}$'},60),
  disasters:array({type:'string',pattern:'^[1-9][0-9]{0,7}$'},5000),
  applicants:array(text(120,1),5000),categories:array(text(30,1),50),counties:array(text(200,1),5000),
  declarationFrom:text(10),declarationTo:text(10),minimumFederal:exactAmount,maximumFederal:exactAmount,
  includeUnjoined:bool,note:text(12000)
};
const annotation=object({
  subject:text(300,1),note:text(12000),status:choice(['open','reviewed','follow_up','resolved']),
  disposition:choice(['include','exclude']),priority:choice(['low','normal','high']),owner:text(200),dueDate:text(10)
},['subject']);
const payment=object({
  scheme:choice(['exact']),network:choice(['stellar:testnet','stellar:pubnet']),
  asset:text(100,1),amount:matching(/^[1-9][0-9]*$/),payTo:text(100,1),maxTimeoutSeconds:integer(1,86400)
},['scheme','network','asset','amount','payTo','maxTimeoutSeconds']);
const intentIds=array(text(160,1),10000,1);
const actions=[
 ['source.capture','Acquire the complete selected declaration/applicant/project cohort and retain each original response and continuation.',{scope:sourceScope,label:text(200)},['scope'],{openWorld:true}],
 ['source.resume','Resume the original retained capture and accepted response checkpoints.',{captureId:id},['captureId'],{openWorld:true}],
 ['source.pause','Pause the same capture while keeping complete originals and unfinished progress.',{captureId:id},['captureId']],
 ['source.import','Import the exact host-declared source bundle; all original bytes and receipt identities are checked by the native capture engine.',{sourcePackage:matching(ALIAS)},['sourcePackage']],
 ['portfolio.create','Create a named portfolio from one immutable source edition with explicit exact-value criteria.',{name:text(160,1),editionId:digest,criteria:object(criteriaFields)},['editionId','criteria']],
 ['portfolio.revise','Save a new portfolio/source revision while retaining the original current-version binding.',{portfolioId:portfolio,editionId:digest,criteria:object(criteriaFields,['name']),expectedVersion:digest},['portfolioId','editionId','criteria','expectedVersion']],
 ['portfolio.select','Select a retained portfolio and one of its immutable versions.',{portfolioId:portfolio,versionId:digest},['portfolioId']],
 ['portfolio.compare','Save complete added, removed and changed source records, exact amount deltas and scope qualifications.',{beforeVersionId:digest,afterVersionId:digest},['beforeVersionId','afterVersionId']],
 ['review.save','Record the analyst decision on an actual source subject and create its immutable portfolio revision.',{portfolioId:portfolio,versionId:digest,annotation},['portfolioId','versionId','annotation']],
 ['review.accept','Retain the operator note against the selected immutable portfolio version.',{portfolioId:portfolio,versionId:digest,note:text(12000,1)},['portfolioId','versionId','note']],
 ['dataset.prepare','Create the original SF30 dataset from a retained portfolio table, including full source provenance.',{versionId:digest,table,name:text(128,1)},['versionId']],
 ['dataset.query','Query the existing native dataset using its own exact query contract.',{datasetId:dataset,query:text(8192)},['datasetId']],
 ['release.prepare','Prepare the native SF82 publication with the supplied existing payment terms.',{datasetId:dataset,origin:text(4096,1),path:text(2048,1),payment},['datasetId','origin','payment']],
 ['release.inspect','Inspect the original native release and its current generation.',{releaseId:release},['releaseId']],
 ['release.activate','Activate the original prepared release at its exact expected generation.',{releaseId:release,expectedGeneration:integer()},['releaseId','expectedGeneration'],{openWorld:true}],
 ['release.start','Start the selected native release using its original generation and configured runtime.',{releaseId:release,expectedGeneration:integer()},['releaseId','expectedGeneration'],{openWorld:true}],
 ['release.stop','Stop the original running release without deleting source or release history.',{releaseId:release},['releaseId']],
 ['release.rollback','Restore the preceding native release generation and retain the original publication history.',{releaseId:release,expectedGeneration:integer()},['releaseId','expectedGeneration'],{openWorld:true}],
 ['buyer.inspect','Inspect the selected completed native buyer intents in the configured original inbox.',{intentIds},['intentIds']],
 ['buyer.receive','Receive those original completed buyer intents through the existing native customer engine.',{intentIds},['intentIds']],
 ['export.create','Freeze complete portfolio JSON, table CSV or the native HTML report for exact-file receiving.',{versionId:digest,table,format:choice(['json','csv','html'])},['versionId']],
 ['source.export','Freeze the complete source bundle with every original metadata/field/page response.',{editionId:digest},['editionId']],
 ['workspace.export','Freeze the complete native portable workspace after any running capture is paused.',{},[]]
];
export const openFemaActionNames=new Map(actions.map(row=>['merchant_openfema_'+row[0].replaceAll('.','_'),row]));
const scope={workspace:matching(ALIAS)}, readOnly={readOnly:true,idempotent:true};
const selection={kind:choice(OPENFEMA_FILE_KINDS),id:text(100,1),file:matching(FILE)};
const archiveCollections=['editions','portfolios','versions','reviews','acceptances','comparisons','datasets','releases','receipts','exports','captures'];
export function openFemaWorkspaceTools(tool){
  return [
    tool('merchant_openfema_workspaces','List configured OpenFEMA workspace aliases, original UUIDs and available retained reads.',{},[],readOnly),
    tool('merchant_openfema_schema','Read the original source contract, action fields, table columns and configured native runtime.',scope,['workspace'],readOnly),
    tool('merchant_openfema_view','Read the original portfolio workspace, current revision and retained source/review/publication/receiving state.',scope,['workspace'],readOnly),
    tool('merchant_openfema_operation','Read the original operation state and complete retained result without redispatching an action.',{...scope,operationId:matching(OPENFEMA_OPERATION_PATTERN)},['workspace','operationId'],readOnly),
    tool('merchant_openfema_archive','Page an original workspace collection with one revision binding; continue with the returned expectedRevision.',{...scope,collection:choice(archiveCollections),offset:integer(),limit:integer(1,500),expectedRevision:integer(),portfolioId:portfolio},['workspace','collection'],readOnly),
    tool('merchant_openfema_edition','Read a complete original source-edition manifest, including exact retained response identities.',{...scope,editionId:digest},['workspace','editionId'],readOnly),
    tool('merchant_openfema_version','Read the immutable portfolio-version identity and summary. Its complete JSON is available through files.',{...scope,versionId:digest},['workspace','versionId'],readOnly),
    tool('merchant_openfema_rows','Page one immutable portfolio table. Preserve exact decimal strings, source IDs, missing/null distinctions and returned nextOffset.',{...scope,versionId:digest,table,search:text(500),sort:text(100),direction:choice(['asc','desc']),offset:integer(),limit:integer(1,1000)},['workspace','versionId','table'],readOnly),
    tool('merchant_openfema_detail','Read one complete original portfolio row, analytical fields, original source and review. Pass its exact returned ID, including composite IDs.',{...scope,versionId:digest,table,id:text(2048,1)},['workspace','versionId','table','id'],readOnly),
    tool('merchant_openfema_files','List exact original source, portfolio JSON, retained export or native customer files and their stable selectors.',{...scope,kind:selection.kind,id:selection.id},['workspace','kind','id'],readOnly),
    tool('merchant_openfema_file_read','Read a SHA-verified original file in bounded base64 chunks. Retain selector, readId, expectedSha256 and nextOffset across continuation.',{...scope,...selection,readId:matching(UUID),expectedSha256:digest,offset:integer(),limit:integer(1,MAX_RETAINED_CHUNK_BYTES)},['workspace','kind','id'],readOnly),
    tool('merchant_openfema_file_release','Close this temporary retained read while keeping all original workspace and completed customer files.',{...scope,readId:matching(UUID)},['workspace','readId'],{idempotent:true}),
    ...actions.map(([action,description,properties,required,annotations={}])=>
      tool('merchant_openfema_'+action.replaceAll('.','_'),description+
        ' Use the current revision and retain the exact original operationId and payload. After an interrupted reply, read operation then repeat that same request; the native journal checks identity before revision.',
        {...scope,operationId:matching(OPENFEMA_OPERATION_PATTERN),expectedRevision:integer(),...properties},
        ['workspace','operationId','expectedRevision',...required],{idempotent:true,...annotations}))
  ];
}
export const openFemaToolDefinitions=new Map(openFemaWorkspaceTools((name,description,properties,required)=>({name,description,properties,required})).map(v=>[v.name,v]));
export function validateOpenFemaToolField(value,schema,path='value'){
  if(schema.anyOf){
    for(const variant of schema.anyOf){try{validateOpenFemaToolField(value,variant,path);return;}catch(error){if(error.code!=='INVALID_PARAMS')throw error;}}
    throw fail(path+' does not match any declared representation.');
  }
  if(schema.type==='object'){
    if(!plain(value)||schema.additionalProperties===false&&Object.keys(value).some(k=>!Object.hasOwn(schema.properties??{},k))||
      (schema.required??[]).some(k=>!Object.hasOwn(value,k)))throw fail(path+' requires its declared object fields.');
    for(const [key,item]of Object.entries(value)){const field=schema.properties?.[key];if(field)validateOpenFemaToolField(item,field,path+'.'+key);}
  }else if(schema.type==='array'){
    if(!Array.isArray(value)||value.length<(schema.minItems??0)||value.length>(schema.maxItems??Infinity))throw fail(path+' has an invalid item count.');
    if(schema.uniqueItems&&new Set(value.map(x=>JSON.stringify(x))).size!==value.length)throw fail(path+' requires distinct items.');
    for(const item of value)validateOpenFemaToolField(item,schema.items,path+'[]');
  }else if(schema.type==='boolean'){if(typeof value!=='boolean')throw fail(path+' must be a boolean.');}
  else if(schema.type==='integer'){
    if(!Number.isSafeInteger(value)||value<(schema.minimum??Number.MIN_SAFE_INTEGER)||value>(schema.maximum??Number.MAX_SAFE_INTEGER))
      throw fail(path+' must be an integer in the declared range.');
  }else if(schema.type==='string'){
    if(typeof value!=='string'||value.length<(schema.minLength??0)||value.length>(schema.maxLength??Infinity)||
      schema.enum&&!schema.enum.includes(value)||schema.pattern&&!new RegExp(schema.pattern).test(value))throw fail(path+' does not match the declared text field.');
  }
}
