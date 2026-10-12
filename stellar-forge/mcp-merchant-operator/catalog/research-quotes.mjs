// MIT. Complete customer quotation tools on the original Research attachment.
export const RESEARCH_QUOTE_PREFIX='merchant_research_quote_';
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const uuid={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$'};
const digest={type:'string',pattern:'^[a-f0-9]{64}$'};
const identifier={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'};
const dossier={type:'string',pattern:'^d_[a-f0-9-]{36}$'};
const revision={type:'integer',minimum:1,maximum:99999999};
const text=(maximum=20000)=>({type:'string',maxLength:maximum});
const object=(properties,required=Object.keys(properties))=>({type:'object',additionalProperties:false,properties,required});
const native={type:'object',additionalProperties:true};
const actor=object({id:identifier,name:{type:'string',minLength:1,maxLength:240}});
const workspace={workspace:alias},read={readOnly:true,idempotent:true},write={idempotent:true};
const price=object({profile:alias,version:uuid,costEdition:uuid},['profile','version']);
export const RESEARCH_QUOTE_CASE_ACTIONS=Object.freeze([
 'preview','save-draft','publish','receive','receive-pricing','compare','preview-implementation','adopt-implementation',
 'receiving-status','receiving-capture','receiving-inspect','receiving-attach','receiving-case','receiving-restore',
 'tariff-status','tariff-catalog','tariff-selection','tariff-capture','tariff-inspect','tariff-attach','tariff-case','tariff-restore',
]);
export const RESEARCH_QUOTE_PRICING_ACTIONS=Object.freeze([
 'state','preview','save','version','compare','planning-state','planning-preview','planning-save','planning-read',
 'economics-state','economics-preview','economics-save','economics-edition','economics-proposal','economics-apply',
 'repricing-source','repricing-preview','repricing-save','repricing-stage',
]);
export const RESEARCH_QUOTE_EXPORTS=Object.freeze({
 'quote-operation-file':{extension:'bin'},
 'quote-case-file':{extension:'bin'},
 'quote-tariff-file':{extension:'bin'},
});
export const RESEARCH_QUOTE_EXPORT_FIELDS=Object.freeze({
 quoteOperationId:uuid,quoteCaseId:uuid,
 quoteFileName:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$'},
 quoteInput:native,quoteInputSource:alias,quoteExpectedBytes:{type:'integer',minimum:0,maximum:268435456},
});
export function researchQuoteTools(tool){
 const command=(name,description,input)=>tool(RESEARCH_QUOTE_PREFIX+name,description+
  ' Supply exactly one inline input or host-declared quote-input source handle containing that complete original JSON body.',
  {...workspace,input,source:alias},['workspace'],write);
 return [
  tool(RESEARCH_QUOTE_PREFIX+'configuration',
   'Inspect this original Research host’s customer case store, saved pricing profiles and compiled merchant aliases before quoting or publishing.',
   workspace,['workspace'],read),
  tool(RESEARCH_QUOTE_PREFIX+'cases',
   'Page the original commercial case store. The native result contains cases, total and nextOffset. Preserve the exact case revision when opening a quote.',
   {...workspace,q:text(1000),status:text(160),dueOn:text(40),offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:200}},
   ['workspace'],read),
  tool(RESEARCH_QUOTE_PREFIX+'case',
   'Open the original full commercial case and published quotation history at the selected immutable native revision.',
   {...workspace,caseId:uuid,revision:digest},['workspace','caseId'],read),
  command('case_create',
   'Create the original SF74 customer case from a selected complete Research project and brief. Retain requestId and caseId for exact replay after later case work.',
   object({requestId:uuid,caseId:uuid,dossierId:dossier,revision,projectId:identifier,briefId:identifier,actor})),
  tool(RESEARCH_QUOTE_PREFIX+'case_action',
   'Operate the original full quotation, pricing receiving, implementation, commercial backup or tariff receiving workflow. Supply its original native scope, requestId, actor and expected revision unchanged; choose one inline input or declared quote-input source.',
   {...workspace,caseId:uuid,action:{type:'string',enum:RESEARCH_QUOTE_CASE_ACTIONS},input:native,source:alias},
   ['workspace','caseId','action'],write),
  tool(RESEARCH_QUOTE_PREFIX+'pricing',
   'Use the original declared SF97 pricing/planning/tariff model. State, preview and save share its actual captured observation; source versions and complete supplier-cost editions stay native. Choose one inline input or declared quote-input source.',
   {...workspace,profile:alias,action:{type:'string',enum:RESEARCH_QUOTE_PRICING_ACTIONS},input:native,source:alias},
   ['workspace','profile','action'],write),
  command('prepare',
   'Prepare a source-bound customer brief from one exact published quote and current Research brief. Retains full case/quote/project/brief source and compiled checkout terms. Read its reviewSha256 before applying.',
   object({requestId:uuid,caseId:uuid,caseRevision:digest,quoteId:uuid,quoteSha256:digest,
    dossierId:dossier,revision,projectId:identifier,briefId:identifier,merchant:alias,
    scope:object({component:{type:'string',enum:['IMPLEMENTATION','RECURRING','ROUTE_USAGE','KEEP']},
     unit:text(240),note:text(16000)}),reason:text(20000),actor})),
  command('response_prepare',
   'Prepare the actual native customer quotation response for the same applied Research brief. Preserves its original quote, observed time, source and contact identity.',
   object({requestId:uuid,bindingId:uuid,caseRevision:digest,responseId:uuid,revision,actor,by:actor})),
  command('apply',
   'Apply the exact reviewed brief or customer response using the original immutable operation ID and review SHA. A saved request reopens its first result after later work.',
   object({id:uuid,reviewSha256:digest})),
  command('publication_prepare',
   'Prepare the full frozen Research customer delivery for its original bound merchant. The native requested-work edition must use the applied quoted brief; the original Commerce review and complete archive remain the publisher.',
   object({requestId:uuid,bindingId:uuid,dossierId:dossier,revision,deliveryId:identifier,
    title:{type:'string',minLength:1,maxLength:240},summary:text(8000),usage:text(8000),
    sourceWorkspace:{anyOf:[{type:'null'},object({library:{type:'string',pattern:'^(?:original|received-[a-f0-9]{64})$'},actor:{type:'string',minLength:1,maxLength:200},requestId:{type:'string',pattern:'^[A-Za-z0-9._:-]{8,160}$'}})]}},
    ['requestId','bindingId','dossierId','revision','deliveryId','title','summary','usage'])),
  command('publication_enroll',
   'Enroll the exact reviewed customer publication through the original native SF101 merchant. Keep its original operation ID, checkout terms, order and archive for Buyer receiving.',
   object({id:uuid,reviewSha256:digest})),
  command('report_prepare',
   'Freeze actual original order, selected Buyer receiving and customer history for this quoted delivery. An optional native pricing version and matching supplier-cost edition retain all original report and archive files.',
   object({requestId:uuid,bindingId:uuid,publicationId:uuid,
    purchaseIds:{type:'array',items:uuid,maxItems:100,uniqueItems:true},revision,
    pricing:{anyOf:[{type:'null'},price]},actor})),
  tool(RESEARCH_QUOTE_PREFIX+'operations',
   'Page original CASE, BRIEF, RESPONSE, PUBLICATION and REALIZED operations. Preserve the returned listing snapshot across pages; open saved IDs for complete request, review and result.',
   {...workspace,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100},
    snapshot:digest,dossierId:dossier,kind:{type:'string',enum:['CASE','BRIEF','RESPONSE','PUBLICATION','REALIZED']}},
   ['workspace'],read),
  tool(RESEARCH_QUOTE_PREFIX+'operation',
   'Read one complete original customer quotation operation and its exact first retained request/review/result, including interrupted preparation or already completed work.',
   {...workspace,id:uuid},['workspace','id'],read),
  tool(RESEARCH_QUOTE_PREFIX+'files',
   'List every complete retained source and result file for the original quotation operation. Use quote-operation-file with its exact file name and SHA in merchant_research_export, then the existing retained file reader.',
   {...workspace,id:uuid},['workspace','id'],read),
  tool(RESEARCH_QUOTE_PREFIX+'file_info',
   'Inspect exact original operation, case or tariff download metadata. For CASE or TARIFF preserve its returned original case revision in the same native input before exporting the file.',
   {...workspace,kind:{type:'string',enum:['OPERATION','CASE','TARIFF']},id:uuid,
    fileName:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,179}$'},input:native,source:alias},
   ['workspace','kind','id'],read),
 ];
}
