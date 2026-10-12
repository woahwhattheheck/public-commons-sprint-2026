// MIT. Complete recurring customer-update tools on the original Research attachment.
import {CUSTOMER_UPDATE_ACTIONS,CUSTOMER_UPDATE_SECTIONS}
  from '../../../stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/customer-updates/contracts.mjs';
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'},
  id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_.:-]{0,159}$'},
  dossierId={type:'string',pattern:'^d_[a-f0-9-]{36}$'},digest={type:'string',pattern:'^[a-f0-9]{64}$'},
  revision={type:'integer',minimum:1,maximum:99999999},offset={type:'integer',minimum:0},
  limit={type:'integer',minimum:1,maximum:100},read={readOnly:true,idempotent:true};
const selected={workspace:alias,dossierId};
const record={type:'object',properties:{path:{type:'string',minLength:2,maxLength:2048},sha256:digest,
  label:{type:'string',maxLength:240}},required:['path','sha256'],additionalProperties:false};
const selection={type:'object',properties:{intakeIds:{type:'array',items:id,minItems:1,maxItems:500,uniqueItems:true},
  records:{type:'array',items:record,maxItems:1000}},required:['intakeIds','records'],additionalProperties:false};
const workSections=['overview','changes','sources','records','intakes','editions','uncovered-plans'];
export const RESEARCH_CUSTOMER_UPDATE_PREFIX='merchant_research_customer_update';
export const RESEARCH_CUSTOMER_UPDATE_EXPORTS=Object.freeze({
  'customer-update-json':{extension:'json'},'customer-update-md':{extension:'md'},
  'customer-update-html':{extension:'html'},'customer-update-csv':{extension:'csv'},
  'customer-update-portable':{extension:'json'},'customer-update-portable-gzip':{extension:'json.gz'},
  'customer-update-work-json':{extension:'json'},
});
export const RESEARCH_CUSTOMER_UPDATE_EXPORT_FIELDS=Object.freeze({deliveryId:id,workId:id});
export function researchCustomerUpdateTools(tool){
  return [
    tool('merchant_research_customer_updates',
      'Read the original customer project, brief editions, agreed outputs, requested baseline/update/correction, source intakes, saved work, frozen deliveries or original operation history. Keep the returned dossier revision on every subsequent page. Native records lists exact original record JSON pointers and hashes for selecting eligibility, extraction, appraisal, publication and synthesis work.',
      {...selected,revision,projectId:id,cycleId:id,section:{type:'string',enum:CUSTOMER_UPDATE_SECTIONS},offset,limit,
        query:{type:'string',maxLength:1000}},['workspace','dossierId'],read),
    tool('merchant_research_customer_update_record',
      'Read one complete original native dossier record at its exact JSON pointer and SHA256. Preserve that same pointer/hash in the commissioned work selection; the customer update engine freezes the complete selected original record.',
      {...selected,revision,path:record.properties.path,sha256:digest,label:record.properties.label},
      ['workspace','dossierId','path','sha256'],read),
    tool('merchant_research_customer_update_preview',
      'Review an exact requested customer update against its selected original source intakes and full native research records. The first page returns source revision/fingerprint, agreed brief, baseline delivery, source changes and uncovered plans. Later pages retain revision and fingerprint. Copy those bindings into one full review-work action.',
      {...selected,revision,projectId:id,cycleId:id,requestEditionId:id,selection,fingerprint:digest,
        section:{type:'string',enum:workSections},offset,limit},
      ['workspace','dossierId','projectId','cycleId','requestEditionId','selection'],read),
    tool('merchant_research_customer_update_save',
      'Save one complete original customer action: initial/revised brief, actual customer agreement, separately requested baseline/update/correction, revised request, original source intake, exact work review, frozen four-format delivery, actual delivery response or project status. Retain requestId and the entire request before dispatch; repeat identical bytes after a lost reply. The original CUSTOMER_UPDATES.md and client.d.mts define every action body. A delivery freezes the existing work snapshot and remains reopenable with its full original dossier.',
      {...selected,requestId:{type:'string',pattern:'^[A-Za-z0-9_-]{8,100}$'},expectedRevision:revision,
        actor:{type:'object',properties:{id,name:{type:'string',minLength:1,maxLength:240}},
          required:['id','name'],additionalProperties:false},action:{type:'string',enum:CUSTOMER_UPDATE_ACTIONS},
        data:{anyOf:[{type:'object'}],description:'Complete original action data. Authored scope, review and correspondence remain explicit.'}},
      ['workspace','dossierId','requestId','expectedRevision','actor','action','data'],{idempotent:true}),
    tool('merchant_research_customer_update_work',
      'Reopen a saved complete customer work review after later evidence changes. Read its original source revision/fingerprint, baseline comparison, full selected native records and exact review. Export customer-update-work-json for the complete retained snapshot; the original file reader supports large files.',
      {...selected,revision,workId:id,section:{type:'string',enum:workSections},offset,limit},
      ['workspace','dossierId','workId'],read),
    tool('merchant_research_customer_update_source_plan',
      'Import a literal original Europe PMC saved query edition into a commissioned source-plan definition. The original query, typed parameters, source terms, workspace/query IDs and version SHA remain bound; this read does not start acquisition. Use Literature searches or the original Europe PMC tools for its existing source operation.',
      {workspace:alias,queryId:id,queryRevision:revision,questionId:id,planId:id,
        name:{type:'string',maxLength:240},constraints:{type:'string',maxLength:20000},
        library:{type:'string',pattern:'^(?:original|received-[a-f0-9]{64})$'}},
      ['workspace','queryId','queryRevision','questionId','planId'],read),
  ];
}
