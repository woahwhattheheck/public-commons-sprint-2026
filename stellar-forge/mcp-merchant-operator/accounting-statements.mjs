// MIT. Customer statements through the original accounting host and native statement engine.
import {CustomerStatementWorkspace,MAX_USAGE_BYTES} from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/customer-statements/store.mjs';
import {normalizeUsage,sha,json,need} from '../../stellar/scf-starforge-20261009/merchant-settlement-accounting/customer-statements/core.mjs';

const PREFIX='merchant_accounting_customer_';
const uuid={type:'string',pattern:'^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$'};
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const text=(max,min=0)=>({type:'string',minLength:min,maxLength:max});
const actor=text(1000,1),revision={type:'integer',minimum:1},hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const nullableId={anyOf:[uuid,{type:'null'}]},stamp=text(80,1),requestId={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'};
const base={workspace:alias},change={...base,revision,actor};
const page={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:200}};
const selection={customerId:uuid,runId:uuid,usageId:nullableId,replacesId:nullableId,from:stamp,until:stamp};
const profile={reference:text(80,1),name:text(200,1),email:text(320),address:text(2000),note:text(2000)};
const readOnly={readOnly:true,idempotent:true};
export const statementFileNames=Object.freeze(['statement.json','statement.csv','usage.csv','statement.html','manifest.json','status.json','preview.json']);
export const statementFileSelectors=Object.freeze(['statementId','customerId','usageId','replacesId','from','until']);
export const statementDefinitions=[
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
const clone=value=>structuredClone(value);
const own=(value,keys)=>Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
const SELECTION=['customerId','runId','usageId','replacesId','from','until'];
function paginate(items,args={},kind){
  const offset=Number(args.offset??0),limit=Number(args.limit??100);
  need(Number.isSafeInteger(offset)&&offset>=0&&Number.isSafeInteger(limit)&&limit>=1&&limit<=200,
    'CUSTOMER_STATEMENT_PAGE','Use a nonnegative offset and a page of at most 200 rows.');
  const rows=items.slice(offset,offset+limit);
  return {kind,items:clone(rows),total:items.length,offset,limit,nextOffset:offset+rows.length<items.length?offset+rows.length:null};
}
function nativePage(result,kind,brief=value=>value){
  return {...result,items:result.items.map(brief),kind,nextOffset:result.offset+result.items.length<result.total?result.offset+result.items.length:null};
}
const bindingBrief=({history=[],...row})=>({...row,historyCount:history.length});
const statementBrief=({history=[],...row})=>({...row,historyCount:history.length});
const itemBrief=({adjustments=[],service,...item})=>({...item,adjustmentCount:adjustments.length,
  service:service?{...Object.fromEntries(Object.entries(service).filter(([key])=>key!=='calls')),callCount:service.calls?.length??0}:null});
function stateBrief(state){
  return {schema:state.schema,revision:state.revision,customerCount:state.customers.length,
    usageImportCount:state.usageImportCount,statementCount:state.statementCount,bindingCount:state.bindingCount,completedRunCount:state.runs.length};
}
function documentBrief(document){
  const {items=[],excluded=[],totals={},...header}=document,{byAsset=[],...total}=totals;
  return {...header,totals:{...total,assetCount:byAsset.length},counts:{items:items.length,excluded:excluded.length,assets:byAsset.length}};
}
function documentPage(document,args){
  const view=args.view??'summary';if(view==='summary')return {};
  let rows;
  if(view==='items')rows=document.items.map(itemBrief);
  else if(view==='excluded')rows=document.excluded;
  else if(view==='assets')rows=document.totals.byAsset;
  else{
    need(['calls','adjustments'].includes(view)&&typeof args.orderRef==='string','CUSTOMER_STATEMENT_VIEW','Select an original order for its calls or adjustments.');
    const original=document.items.find(item=>item.orderRef===args.orderRef);
    need(original,'CUSTOMER_STATEMENT_ORDER','This statement contains no selected original order.',404);
    rows=view==='calls'?original.service?.calls??[]:original.adjustments??[];
  }
  return {page:paginate(rows,args,view)};
}
function mappedResult(result){
  const {state,document,statement,...rest}=result;
  return {...rest,...(state?{revision:state.revision,customerStatementState:stateBrief(state)}:{}),
    ...(statement?{statement:statementBrief(statement)}:{}),...(document?{document:documentBrief(document)}:{})};
}

/** Reuse the original accounting lease and customer statement state. */
export class MerchantCustomerStatements{
  constructor(workspace,{readSource}={}){
    need(typeof readSource==='function','CUSTOMER_STATEMENT_SOURCE','Provide the original host-alias source reader.');
    this.workspace=workspace;this.native=new CustomerStatementWorkspace(workspace);this.readSource=readSource;
  }
  async init(){await this.native.init();return this;}
  async source(alias){
    const bytes=Buffer.from(await this.readSource(alias,MAX_USAGE_BYTES));
    need(bytes.length>0&&bytes.length<=MAX_USAGE_BYTES,'SERVICE_USAGE_SIZE','Use an original usage capture up to 24 MB.');
    let content,document;
    try{content=new TextDecoder('utf-8',{fatal:true}).decode(bytes);document=JSON.parse(content);}
    catch{need(false,'INVALID_STATEMENT_JSON','The declared usage source must contain valid UTF-8 JSON.');}
    // A preserved leading UTF-8 BOM is not part of native JSON. Accepted files remain exact.
    need(Buffer.from(content).equals(bytes),'INVALID_STATEMENT_JSON','The declared usage source must be exact UTF-8 JSON without a BOM.');
    const usage=normalizeUsage(document);
    return {bytes,content,summary:{source:alias,sha256:sha(bytes),bytes:bytes.length,sourceSchema:usage.sourceSchema,
      sourceCreatedAt:usage.createdAt,sourceRevision:usage.revision,orderCount:usage.orders.length}};
  }
  async prepared(args){
    const preview=await this.native.preview(own(args,SELECTION)),bytes=Buffer.from(json(preview));
    need(bytes.length<=128_000_000,'STATEMENT_EXPORT_LIMIT','The complete native preview exceeds the supported statement export size.');
    return {preview,bytes};
  }
  async previewResult(args){
    const {preview,bytes}=await this.prepared(args);
    return {intent:preview.intent,previewSha256:preview.previewSha256,revision:preview.revision,
      draft:documentBrief(preview.draft),...documentPage(preview.draft,args),
      previewFile:{kind:'customer-statement-preview',file:'preview.json',...preview.intent,sha256:sha(bytes),bytes:bytes.length}};
  }
  async lookup(requestId){
    return this.workspace.serial(async()=>{
      const row=this.native.data().statements.find(item=>item.requestId===requestId);
      return row?{found:true,...mappedResult(await this.native._detail(row.id))}:
        {found:false,requestId,revision:this.workspace.state.revision};
    });
  }
  async detail(args){
    const result=await this.native.detail(args.statementId);
    return {...mappedResult(result),...(args.view==='history'?{page:paginate(result.statement.history,args,'history')}:
      documentPage(result.document,args))};
  }
  async file(args){
    if(args.kind==='customer-statement-preview'){
      need(args.file==='preview.json','STATEMENT_FILE_NOT_FOUND','Choose the complete original preview.json.',404);
      const {preview,bytes}=await this.prepared(args);
      return {bytes,name:'customer-statement-preview-'+preview.previewSha256+'.json',type:'application/json; charset=utf-8'};
    }
    need(args.kind==='customer-statement'&&statementFileNames.includes(args.file)&&args.file!=='preview.json',
      'STATEMENT_FILE_NOT_FOUND','Choose the original retained statement file.',404);
    return this.native.file(args.statementId,args.file);
  }
  async call(operation,args){
    need(operation.startsWith(PREFIX),'CUSTOMER_STATEMENT_OPERATION','Choose an original customer statement operation.');
    const {workspace,...value}=args;
    switch(operation.slice(PREFIX.length)){
      case 'status':{
        const state=await this.native.state(),view=value.view??'summary',result={customerStatementState:stateBrief(state),revision:state.revision};
        if(view==='summary')return result;
        let rows=({customers:state.customers,runs:state.runs,usage:state.usageImports,history:state.history})[view];
        need(rows,'CUSTOMER_STATEMENT_VIEW','Choose summary, customers, runs, usage or history.');
        if(value.search){const query=value.search.toLowerCase();rows=rows.filter(row=>JSON.stringify(row).toLowerCase().includes(query));}
        return {...result,page:paginate(rows,value,view),...(view==='history'?{historyScope:'ORIGINAL_LATEST_80'}:{})};
      }
      case 'save':return mappedResult(await this.native.saveCustomer(value));
      case 'bindings':return nativePage(await this.native.listBindings(value),'bindings',bindingBrief);
      case 'order':return this.workspace.serial(async()=>{
        const binding=this.native.data().bindings.find(row=>row.orderRef===value.orderRef);
        need(binding,'CUSTOMER_ORDER_NOT_FOUND','This exact original order has no customer assignment.',404);
        return {binding:bindingBrief(clone(binding)),page:paginate(binding.history,value,'history'),revision:this.workspace.state.revision};
      });
      case 'assign':return mappedResult(await this.native.assign(value));
      case 'usage_source':return (await this.source(value.source)).summary;
      case 'usage_import':{
        const source=await this.source(value.source);
        need(source.summary.sha256===value.expectedSha256,'CUSTOMER_USAGE_SOURCE_CHANGED','The declared usage capture changed after review. Review its current original bytes.',409);
        return mappedResult(await this.native.importUsage({revision:value.revision,actor:value.actor,name:value.name??value.source,content:source.content}));
      }
      case 'statement_preview':return this.previewResult(value);
      case 'statement_retain':return mappedResult(await this.native.retain(value));
      case 'statements':return nativePage(await this.native.listStatements(value),'statements',statementBrief);
      case 'statement_lookup':return this.lookup(value.requestId);
      case 'statement':return this.detail(value);
      case 'statement_withdraw':return mappedResult(await this.native.withdraw(value.statementId,value));
      default:need(false,'CUSTOMER_STATEMENT_OPERATION','This original customer statement operation was not found.',404);
    }
  }
}
