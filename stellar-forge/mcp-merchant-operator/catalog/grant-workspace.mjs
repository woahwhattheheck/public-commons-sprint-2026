import {grantSourceCollectionTools} from './grant-source-collection.mjs';
import {grantInstallationSourceTools} from './grant-installation-sources.mjs';
// MIT. Original SF47 tool schemas without provider runtime imports.
import {grantCohortAdoptionTools} from './grant-cohort-adoption.mjs';
import {grantCohortDeliveryTools} from './grant-cohort-delivery.mjs';
import {grantPlanningSourceTools} from './grant-planning-sources.mjs';
import {grantReportingCaptureTools} from './grant-reporting-capture.mjs';
import {grantProcedureTools} from './grant-procedures.mjs';
import {GRANT_CASE_ACTIONS,GRANT_MAX_BUNDLE_BYTES,GRANT_TRANSFER_CHUNK_BYTES as CHUNK} from '../../../stellar/scf_2026/sf47_budget_model/workspace/agent-contracts.mjs';

const str = (maximum = 12000) => ({type:'string', maxLength:maximum});
const nonempty = (maximum = 300) => ({type:'string', minLength:1, maxLength:maximum});
const alias = {type:'string', pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};
const digest = {type:'string', pattern:'^[a-f0-9]{64}$'};
const integer = {type:'integer', minimum:1, maximum:10000000};
const id = prefix => ({type:'string', pattern:'^' + prefix + '-[a-f0-9]{32}$'});
const deliveryAgendaCases = {type:'array',items:id('operation'),minItems:1,uniqueItems:true};
const deliveryAgendaVersions = {
  type:'object',minProperties:1,
  propertyNames:{pattern:'^operation-[a-f0-9]{32}$'},
  additionalProperties:{type:'integer',minimum:1,maximum:10000000},
  description:'Exactly one original current version for every selected case; omit to read current versions.'
};
const object = {type:'object', additionalProperties:true};
const ws = {workspace:alias};
const requestIdentifier = {type:'string', pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'};
const originalRequest = {requestId:requestIdentifier, actor:nonempty(300), note:str(12000)};
const planSelection = {planId:id('plan'), expectedRevision:{type:'integer', minimum:1, maximum:1000000}};
const planComparisonRevision = {type:'integer',minimum:1,maximum:1000000};
const caseSelection = {caseId:id('operation'), expectedVersion:integer};
const installationReviewRef={type:'object',additionalProperties:false,properties:{id:id('review'),sha256:digest},required:['id','sha256']};
const inputRef = {type:'object', additionalProperties:false,
  properties:{hostInput:alias, snapshotId:{type:'string'}, transferId:{type:'string'}, sourceWorkspace:alias},
  oneOf:[{required:['hostInput']}, {required:['snapshotId']}, {required:['transferId']}]};
const originalInput = {input:inputRef, expectedInputSha256:digest};
const modelInput = {inputs:object, ...originalInput, inputPointer:str(4000)};
const statementCategories={enum:['GRANT','INVOICE','CUSTOMER','CAPITAL','REFUND','OTHER']};
const statementSource={type:'object',additionalProperties:false,
  properties:{filename:nonempty(240),contentBase64:{...nonempty(Math.floor((8*1024*1024+2)*4/3)+16),
    description:'Base64 of the complete original CSV, OFX / QFX or MT940 file, up to 8 MiB. Preserve the original bytes and declared encoding.'},
    sourceUrl:str(4000),observedAt:{type:'string',format:'date-time'}},
  required:['filename','contentBase64','observedAt']};
const mt940Options={type:'object',additionalProperties:false,
  properties:{
    profile:{enum:['TEXT_BODY','FIN_ENVELOPE']},
    encoding:{enum:['ASCII','UTF-8','ISO-8859-1']},
    debitCreditProfile:{enum:['CD_ONLY','CD_REVERSALS']},
    yearWindowStart:{type:'integer',minimum:1900,maximum:2000},
    dateBasis:{const:'VALUE_DATE'},
    currencyScales:{type:'object',minProperties:1,maxProperties:32,
      propertyNames:{pattern:'^[A-Z]{3}$'},additionalProperties:{type:'integer',minimum:0,maximum:6}}
  },required:['profile','encoding','debitCreditProfile','yearWindowStart','dateBasis','currencyScales']};
const ofxOptions={anyOf:[{type:'object',maxProperties:0},{type:'null'}]};
const nativeStatementOptions={anyOf:[mt940Options,...ofxOptions.anyOf]};
const nativeStatementRules=[
  {if:{properties:{sourceFormat:{const:'OFX'}},required:['sourceFormat']},
    then:{properties:{statementOptions:ofxOptions}}},
  {if:{properties:{sourceFormat:{const:'MT940'}},required:['sourceFormat']},
    then:{required:['statementOptions'],properties:{statementOptions:mt940Options}}}
];
const statementInspectionInput={type:'object',additionalProperties:false,
  description:'Inspect exact original OFX / QFX or MT940 bytes and return cash-eligible native account sections before choosing a stable account alias.',
  properties:{sourceFormat:{enum:['OFX','MT940'],description:'OFX also accepts an original QFX file.'},
    source:statementSource,statementOptions:nativeStatementOptions},
  required:['sourceFormat','source'],allOf:nativeStatementRules};
const statementInput={type:'object',additionalProperties:false,
  description:'Original statement bytes, selected format and account, exact cash classifications and row decisions. Money remains decimal text. OFX / QFX and MT940 use the native section ID returned by inspection.',
  properties:{
    sourceFormat:{enum:['CSV','OFX','MT940'],default:'CSV',description:'Use OFX for both OFX and QFX files. An omitted format preserves the original CSV workflow.'},
    source:statementSource,
    statementId:{...digest,description:'Exact native account/currency section ID returned by merchant_grant_statement_inspect.'},
    statementOptions:nativeStatementOptions,
    sourceReviewNote:str(4000),
    accountId:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$',
      description:'Stable nonsecret account key; reuse it for overlapping statements from this original account.'},
    accountLabel:str(300),currency:nonempty(40),
    format:{type:'object',additionalProperties:false,
      properties:{delimiter:{enum:[',',';','\t','|']},decimalMark:{enum:['.',',']},
        groupMark:{enum:['','.',',',' ','\u00a0',"'"]},
        dateFormat:{enum:['YYYY-MM-DD','MM/DD/YYYY','DD/MM/YYYY','YYYY/MM/DD']},
        amountMode:{enum:['SIGNED','DEBIT_CREDIT']},positiveDirection:{enum:['IN','OUT']}},
      required:['delimiter','decimalMark','groupMark','dateFormat','amountMode','positiveDirection']},
    columns:{type:'object',additionalProperties:false,
      description:'Exact original CSV headings, including heading whitespace. Native bank formats omit this mapping and use their original source fields.',
      properties:Object.fromEntries(['date','reference','description','amount','debit','credit','currency','usdValue'].map(key=>[key,str(300)])),
      required:['date','reference']},
    defaultCategory:statementCategories,openingBalance:str(100),closingBalance:str(100),valuationNote:str(4000),
    decisions:{type:'array',maxItems:5000,items:{type:'object',additionalProperties:false,
      properties:{rowNumber:{type:'integer',minimum:2,maximum:10000000,
        description:'CSV physical record-start line, or the selected native account movement rowNumber returned by preview. Source-line metadata remains separate.'},
        action:{enum:['IMPORT','EXCLUDE']},reason:str(4000),category:statementCategories,
        tranche:{anyOf:[{type:'integer',minimum:0,maximum:3},{type:'null'}]},
        allocations:{type:'array',maxItems:200,items:{type:'object',additionalProperties:false,
          properties:{invoiceId:id('invoice'),amountUsd:nonempty(100)},required:['invoiceId','amountUsd']}}},
      required:['rowNumber','action'],
      allOf:[{if:{properties:{action:{const:'EXCLUDE'}},required:['action']},then:{required:['reason'],properties:{reason:nonempty(4000)}}}]}}
  },required:['source','accountId','currency'],
  allOf:[
    {if:{properties:{sourceFormat:{enum:['OFX','MT940']}},required:['sourceFormat']},
      then:{required:['statementId'],not:{anyOf:[{required:['format']},{required:['columns']}]}},
      else:{required:['format','columns']}},
    ...nativeStatementRules
  ]};
const statementModelInput={...modelInput,inputs:statementInput};
const statementInspectionModelInput={...modelInput,inputs:statementInspectionInput};
// Delivery risks reuse the original case review, source and command history.
const riskId = {type:'string',pattern:'^[a-z][a-z0-9-]{1,99}$'};
const riskDate = {type:'string',pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'};
const nullableRiskDate = {anyOf:[riskDate,{type:'null'}]};
const riskOwner = {anyOf:[nonempty(12000),{type:'null'}],
  description:'Original case contributor ID, or null when explicitly unassigned.'};
const riskEvidence = {
  sourceIds:{type:'array',items:id('source'),uniqueItems:true},
  sourceNote:str(12000),
  sourceBasis:{enum:['ATTACHED_SOURCE','OPERATOR_ENTRY'],
    description:'Native engine recomputes this field from actual attached source references.'}
};
const riskReviewRef = {type:'object',additionalProperties:false,
  properties:{reviewId:id('review'),reviewSha256:digest},required:['reviewId','reviewSha256']};
const riskAction = {type:'object',additionalProperties:false,properties:{
  id:riskId,title:nonempty(500),description:str(12000),ownerId:riskOwner,ownerNote:str(4000),
  status:{enum:['PLANNED','IN_PROGRESS','DONE','CANCELLED']},
  dueOn:nullableRiskDate,completedOn:nullableRiskDate,progress:str(12000),...riskEvidence
},required:['id','title','description','ownerId','ownerNote','status','dueOn','completedOn','progress','sourceIds','sourceNote']};
const riskRecord = {type:'object',additionalProperties:false,properties:{
  id:riskId,kind:{enum:['RISK','ISSUE']},title:nonempty(500),description:str(12000),
  category:{enum:['DELIVERY','STAFFING','CUSTOMER','FUNDING','TECHNICAL','SECURITY','EXTERNAL','OTHER']},
  identifiedOn:riskDate,ownerId:riskOwner,ownerNote:str(4000),
  status:{enum:['OPEN','MONITORING','MITIGATING','RESOLVED','CLOSED']},
  likelihood:{enum:['UNASSESSED','UNLIKELY','POSSIBLE','LIKELY','NOT_APPLICABLE']},
  impact:{enum:['UNASSESSED','MINOR','MODERATE','MAJOR']},
  priority:{enum:['UNASSESSED','LOW','MEDIUM','HIGH']},
  assessmentNote:str(12000),trigger:str(12000),nextReviewOn:nullableRiskDate,
  costIds:{type:'array',items:nonempty(300),uniqueItems:true},...riskEvidence,
  review:{type:'object',additionalProperties:false,
    properties:{on:nullableRiskDate,by:str(300),note:str(12000)},required:['on','by','note']},
  resolution:{type:'object',additionalProperties:false,
    properties:{on:nullableRiskDate,note:str(12000)},required:['on','note']},
  actions:{type:'array',maxItems:100,items:riskAction}
},required:['id','kind','title','description','category','identifiedOn','ownerId','ownerNote','status',
  'likelihood','impact','priority','assessmentNote','trigger','nextReviewOn','costIds','sourceIds','sourceNote',
  'review','resolution','actions'],
allOf:[{if:{properties:{kind:{const:'ISSUE'}},required:['kind']},
  then:{properties:{likelihood:{const:'NOT_APPLICABLE'}}},
  else:{properties:{likelihood:{enum:['UNASSESSED','UNLIKELY','POSSIBLE','LIKELY']}}}}]};
const riskDocument = {type:'object',additionalProperties:false,properties:{
  schema:{const:'stellar-forge.sf47-delivery-risks.v1'},name:nonempty(300),asOfDate:riskDate,note:str(12000),
  supersedes:{anyOf:[{type:'null'},riskReviewRef]},
  risks:{type:'array',maxItems:200,items:riskRecord,
    description:'Complete register with stable risk and action IDs, including resolved and closed entries.'}
},required:['schema','name','asOfDate','note','supersedes','risks']};
const riskSaveCommand = {type:'object',additionalProperties:false,properties:{
  expectedVersion:integer,...originalRequest,note:nonempty(12000),action:{const:'risk-register.save'},
  data:{type:'object',additionalProperties:false,
    properties:{document:riskDocument,expectedPreviewSha256:digest},
    required:['document','expectedPreviewSha256']}
},required:['expectedVersion','requestId','actor','note','action','data']};

// Contributor Engagements reuse the original reviews, retained sources and allocators.
const engagementId = {type:'string', pattern:'^[a-z][a-z0-9-]{1,99}$'};
const engagementDate = {type:'string', pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'};
const engagementHours = {type:'string', description:'Exact nonnegative native hours as decimal text, at most four decimal places.'};
const engagementUsd = {type:'string', description:'Exact nonnegative USD amount as decimal text, at most two decimal places.'};
const engagementEvidence = {sourceIds:{type:'array', items:id('source'), uniqueItems:true}, sourceNote:str(12000)};
const engagementPaymentMode = {enum:['original','accrual','completion']};
const engagementReviewRef = {reviewId:id('review'), reviewSha256:digest};
const engagementAllocation = {type:'object', additionalProperties:false,
  properties:{costId:engagementId, remainingHours:engagementHours, remainingCostUsd:engagementUsd, note:str(12000)},
  required:['costId','remainingHours','remainingCostUsd','note']};
const engagementPayment = {type:'object', additionalProperties:false,
  properties:{costId:engagementId, paymentMode:engagementPaymentMode, note:str(12000)},
  required:['costId','paymentMode','note']};
const engagementAgreement = {type:'object', additionalProperties:false, properties:{
  id:engagementId, contributorId:{...nonempty(12000),description:'Original retained contributor ID; the native case lookup remains authoritative for imported IDs.'}, role:nonempty(12000), scope:str(12000),
  startDate:engagementDate, endDate:engagementDate, ...engagementEvidence,
  availability:{type:'object', additionalProperties:false, properties:{
    hoursByWeekday:{type:'array', minItems:7, maxItems:7, items:{anyOf:[engagementHours,{type:'null'}]},
      description:'Monday through Sunday. null is unentered; zero is explicitly unavailable.'},
    hoursByDate:{type:'object', additionalProperties:engagementHours, description:'YYYY-MM-DD native civil date overrides.'},
    note:str(12000), ...engagementEvidence},
    required:['hoursByWeekday','hoursByDate','note','sourceIds','sourceNote']},
  compensation:{type:'object', additionalProperties:false, properties:{
    basis:{enum:['HOURLY','FIXED','IN_KIND','UNSPECIFIED']},
    rateUsd:{type:['string','null'], description:'Exact original hourly USD rate as decimal text, at most four decimal places.'},
    totalUsd:{anyOf:[engagementUsd,{type:'null'}]}, paymentTerms:str(12000),
    paymentMode:engagementPaymentMode, note:str(12000), ...engagementEvidence},
    required:['basis','rateUsd','totalUsd','paymentTerms','paymentMode','note','sourceIds','sourceNote']},
  acceptance:{type:'object', additionalProperties:false, properties:{
    status:{enum:['PROPOSED','CONFIRMED','DECLINED','WITHDRAWN']}, by:str(12000),
    at:{type:['string','null'], description:'Actual original ISO acceptance timestamp; CONFIRMED also requires the named accepting person.'},
    note:str(12000), ...engagementEvidence},
    required:['status','by','at','note','sourceIds','sourceNote'],
    allOf:[{if:{properties:{status:{const:'CONFIRMED'}}},then:{properties:{by:nonempty(12000),at:nonempty(200)}}}]},
  allocations:{type:'array', items:engagementAllocation, description:'Explicit remaining package assignments. An empty array is valid.'}
}, required:['id','contributorId','role','scope','startDate','endDate','availability','compensation',
  'acceptance','allocations','sourceIds','sourceNote']};
const engagementDocument = {type:'object', additionalProperties:false, properties:{
  schema:{const:'stellar-forge.sf47-contributor-engagements.v1'}, name:nonempty(12000),
  asOfDate:engagementDate, agreements:{type:'array', items:engagementAgreement}, note:str(12000),
  supersedes:{anyOf:[{type:'null'},{type:'object',additionalProperties:false,
    properties:engagementReviewRef,required:['reviewId','reviewSha256']}]}
}, required:['schema','name','asOfDate','agreements','note','supersedes']};
const engagementForecastSelection = {type:'object', additionalProperties:false, properties:{
  ...engagementReviewRef, forecastId:id('forecast'), agreementIds:{type:'array',items:engagementId,uniqueItems:true},
  remainders:{type:'array',items:engagementAllocation,
    description:'When present, covers every affected package. Omission uses the complete native derived remainders.'},
  paymentModes:{type:'array',items:engagementPayment,
    description:'When present, covers every affected package. Differing agreement modes require an explicit reviewed package choice.'},
  name:nonempty(12000),note:str(12000)
}, required:['reviewId','reviewSha256','forecastId','agreementIds','name','note']};
const engagementPortfolioSelection = {type:'object', additionalProperties:false, properties:{
  ...engagementReviewRef, forecastId:id('forecast'), agreementIds:{type:'array',items:engagementId,uniqueItems:true},
  resourceMap:{type:'array',items:{type:'object',additionalProperties:false,
    properties:{engagementId,resourceId:engagementId},required:['engagementId','resourceId']},
    description:'Cover each selected contributor once, retaining selected original resources or distinct new resource IDs.'},
  inputs:{...object,description:'Complete native Portfolio draft with all explicit alternatives, Installation selections and phase plans.'},
  name:nonempty(12000),note:str(12000)
}, required:['reviewId','reviewSha256','forecastId','agreementIds','resourceMap','name','note']};
const engagementReceivingData = {type:'object', additionalProperties:false, properties:{
  ...engagementReviewRef,forecastId:id('forecast'),portfolioId:id('portfolio'),
  forecastSelection:engagementForecastSelection,portfolioSelection:engagementPortfolioSelection
}, required:['reviewId','reviewSha256','forecastId','portfolioId','forecastSelection','portfolioSelection']};
const currencyCode = {type:'string', pattern:'^[A-Z]{3}$'};
const nativeMoney = {type:'object', additionalProperties:false,
  properties:{
    amount:{...nonempty(80), description:'Exact original decimal amount as text; up to eight native decimals, two for USD.'},
    currency:currencyCode,
    fxRateId:{type:['string','null'], description:'A retained rate directly relating this currency to USD. A missing foreign rate retains the original amount as unvalued.'}
  }, required:['amount','currency']};
const nativePriceCredit = {type:'object', additionalProperties:false,
  properties:{cashId:id('cash'), amount:nonempty(80), note:nonempty(4000)},
  required:['cashId','amount','note']};
const nativeCostCredit = {type:'object', additionalProperties:false,
  properties:{kind:{enum:['INVOICE','DIRECT_CASH']}, id:nonempty(100), amount:nonempty(80), note:nonempty(4000)},
  required:['kind','id','amount','note']};
const nativePricing = {type:'object', additionalProperties:false,
  properties:{price:nativeMoney, deliveryCost:nativeMoney,
    priceCredits:{type:'array', items:nativePriceCredit, maxItems:200},
    costCredits:{type:'array', items:nativeCostCredit, maxItems:200}},
  required:['price','deliveryCost']};
const retainedFxRate = {type:'object', additionalProperties:false,
  properties:{id:nonempty(100), baseCurrency:currencyCode, quoteCurrency:currencyCode,
    rate:{...nonempty(80), description:'Exact positive decimal quote units per one base unit. Exactly one side must be USD.'},
    observationDate:{type:'string', pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'},
    publicationDate:{type:['string','null'], pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'},
    basis:{enum:['REFERENCE_OBSERVATION','PLANNING_ASSUMPTION']},
    rounding:{enum:['HALF_UP','HALF_EVEN']},
    sourceUrl:str(4000), sourceIds:{type:'array', items:id('source'), uniqueItems:true, maxItems:200},
    sourceReference:str(4000), note:str(4000)},
  required:['id','baseCurrency','quoteCurrency','rate','observationDate','basis','rounding']};
const intakeFormat = {type:'object',additionalProperties:false,properties:{
  encoding:{enum:['utf-8-sig','utf-16','cp1252']},delimiter:{enum:[',','\t',';','|']},
  headerRow:{type:'integer',minimum:0,maximum:5001},dateFormat:{enum:['ISO','DAY_FIRST','MONTH_FIRST']},
  decimalSeparator:{enum:['.',',']},groupSeparator:{enum:['',',','.',' ']}
}};
const intakeDocument = {...object,description:'Complete source format, positional field mappings, exact contributor/package choices, source row corrections and native record decisions. Use the document returned by work_intake or work_intake_preview. The source bytes remain the original case attachment.',
  properties:{format:intakeFormat,mapping:object,sourceSystem:str(300),
    contributors:{type:'array',maxItems:5000,items:{type:'object',additionalProperties:false,
      properties:{sourceValue:nonempty(12000),contributorId:id('contributor')},required:['sourceValue','contributorId']}},
    costs:{type:'array',maxItems:5000,items:{type:'object',additionalProperties:false,
      properties:{sourceValue:nonempty(12000),costId:nonempty(100)},required:['sourceValue','costId']}},
    rowEdits:{type:'array',maxItems:5000,items:object},
    recordDecisions:{type:'array',maxItems:5000,items:{type:'object',additionalProperties:false,properties:{
      key:nonempty(100),action:{enum:['CREATE','REUSE','SKIP']},recordId:str(100),reason:nonempty(4000)},
      required:['key','action','recordId','reason']}}}};
const intakeModelInput = {...modelInput,inputs:intakeDocument};
const forecastReceiptInput = {...object, properties:{amountNative:nonempty(80)}};
const forecastCommercialInput = {...object, properties:{nativePricing,
  receipts:{type:'array', items:forecastReceiptInput, maxItems:30}}};
const forecastInput = {...object,
  description:'Complete original forecast input. Native-priced rows retain nativePricing and amountNative milestones; legacy USD rows keep their original fields. Missing foreign valuation stays explicit.',
  properties:{fxRates:{type:'array', items:retainedFxRate, maxItems:100},
    commercial:{type:'array', items:forecastCommercialInput, maxItems:50}}};
const forecastModelInput = {...modelInput, inputs:forecastInput};
const createCase = {planId:id('plan'), selectedRevision:integer, expectedContentSha256:digest,
  name:nonempty(300), mode:{enum:['OPERATIONS', 'WALKTHROUGH']}, calendarStart:{type:['string','null']},
  actor:nonempty(300), requestId:requestIdentifier};
const supportDate = {type:'string', pattern:'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'};
const installationSelection = {installationId:{anyOf:[id('installation'),{type:'null'}]},
  expectedRevision:{type:'integer',minimum:0,maximum:500}};
const workshareSources = {sourceId:id('source'),expectedSourceSha256:digest,
  packetSourceId:{anyOf:[id('source'),{type:'null'}]},
  expectedPacketSha256:{anyOf:[digest,{type:'null'}]}};
const installationRevision = {type:'integer',minimum:1,maximum:500};
const customerUseInstallationRefs={type:'array',maxItems:100,items:{type:'object',additionalProperties:false,
  properties:{id:id('installation'),revision:installationRevision,sha256:digest},required:['id','revision']}};
const customerUsePattern={type:'object',additionalProperties:false,properties:{
  id:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$'},
  taskIds:{type:'array',items:nonempty(120),uniqueItems:true,maxItems:80},
  buyerDeploymentIds:{type:'array',items:id('deployment'),uniqueItems:true,maxItems:20},
  weekdays:{type:'array',items:{type:'integer',minimum:0,maximum:6},uniqueItems:true,maxItems:7},
  includeDates:{type:'array',items:supportDate,uniqueItems:true,maxItems:366},
  excludeDates:{type:'array',items:supportDate,uniqueItems:true,maxItems:366},
  mode:{enum:['PURCHASE','ALLOWANCE_USE','REOPEN','FREE_USE']},
  fundingByBuyer:{type:'object',additionalProperties:{type:'array',items:nonempty(120),uniqueItems:true,maxItems:100}},
  replacePattern:{type:'boolean'}},required:['id','taskIds','buyerDeploymentIds']};
const customerUseExpansionInput={...modelInput,inputs:{type:'object',additionalProperties:false,
  properties:{document:object,pattern:customerUsePattern},required:['document','pattern']}};
const cohortReviewIds = {type:'array',items:id('review'),uniqueItems:true,maxItems:20};
const implementationReviewIds = {type:'array',items:id('review'),uniqueItems:true,maxItems:20};
const implementationCutoff = {type:'string',pattern:'^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$'};
const supportDeployment = {type:'object', additionalProperties:false,
  properties:{name:nonempty(500), operator:nonempty(500), operatorId:{anyOf:[str(500),{type:'null'}]},
    role:{enum:['MERCHANT','BUYER','BOTH']},
    participantClass:{enum:['TEAM_OPERATED','INDEPENDENT_OPERATOR','CUSTOMER']},
    environment:{enum:['LOCAL','TESTNET','MAINNET','OTHER']},
    state:{enum:['PLANNED','INSTALLED','OPERATING','HANDED_OVER','RETIRED']},
    costIds:{type:'array', items:nonempty(200), uniqueItems:true, maxItems:200},
    tranche:{anyOf:[{type:'integer',minimum:1,maximum:3},{type:'null'},{const:''}]},
    endpoint:str(4000), releaseRef:str(4000), caseRef:str(4000), acceptedBy:str(300),
    acceptedAt:{anyOf:[supportDate,{const:''},{type:'null'}]}, sourceNote:str(12000)},
  required:['name','operator'],
  allOf:[{if:{properties:{state:{const:'HANDED_OVER'}},required:['state']},
    then:{required:['acceptedBy','acceptedAt'],properties:{acceptedBy:nonempty(300),acceptedAt:supportDate}}}]};
const emptyDeployment = {anyOf:[{type:'null'},{type:'object',maxProperties:0}]};
const supportSelection = {allOf:[{
  if:{properties:{deploymentId:id('deployment')},required:['deploymentId']},
  then:{properties:{deployment:emptyDeployment}},
  else:{required:['deployment'],properties:{deployment:supportDeployment}}
}]};
const buyerDeployment = {...supportDeployment,
  properties:{...supportDeployment.properties, role:{enum:['BUYER','BOTH']}},
  required:['name','operator','role']};
const buyerSelection = {allOf:[{
  if:{properties:{deploymentId:id('deployment')},required:['deploymentId']},
  then:{properties:{deployment:emptyDeployment}},
  else:{required:['deployment'],properties:{deployment:buyerDeployment}}
}]};
const buyerJobs = {type:'array',minItems:1,maxItems:100,uniqueItems:true,
  items:{type:'object',additionalProperties:false,
    properties:{jobId:digest,purchaseId:{anyOf:[id('purchase'),{type:'null'}]}},
    required:['jobId','purchaseId']}};
const commercialIdentifier = {type:'string', pattern:'^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$'};

const expenseBillingSelection={caseId:id('operation'),chargeId:id('expense-billing')};
const expenseBillingFields={
  requestId:requestIdentifier,actor:nonempty(300),expectedVersion:integer,
  previousId:{anyOf:[id('expense-billing'),{type:'null'}]},mode:{enum:['NEW','DRAFT_EDIT','CREDIT','VOID','REPLACE']},
  endpointId:nonempty(200),customerId:nonempty(100),
  currency:{type:'object',additionalProperties:false,properties:{code:{type:'string',pattern:'^[A-Z]{3}$'},scale:{type:'integer',minimum:0,maximum:6}},required:['code','scale']},
  sourceIds:{type:'array',items:id('source'),minItems:1,uniqueItems:true},
  authorization:nonempty(12000),authorizedOn:supportDate,creditReviewNote:nonempty(6000),reason:nonempty(3000),
  issueDate:supportDate,dueDate:supportDate,effectiveDate:supportDate,resolution:{enum:['CREDIT','VOID']},
  purchaseOrder:str(300),note:str(6000),expectedPreviewSha256:digest,
  lines:{type:'array',minItems:1,maxItems:200,items:{type:'object',additionalProperties:false,
    properties:{attributionId:id('expense-attribution'),expectedContentSha256:digest,costId:nonempty(300),
      nativeAmount:{type:'string',pattern:'^(?:0|[1-9][0-9]{0,99})$'},amountBasis:{enum:['REVIEWED_USD','AGREED_AMOUNT']},
      amount:nonempty(100),description:nonempty(3000)},
    required:['attributionId','expectedContentSha256','costId','nativeAmount','amountBasis','amount','description']}}
};
const expenseBillingRequired=['workspace','caseId','requestId','actor','expectedVersion','mode','sourceIds','authorization','authorizedOn','creditReviewNote','reason','lines'];
const expenseBillingRules={allOf:[
  {if:{properties:{mode:{const:'NEW'}},required:['mode']},then:{required:['endpointId','customerId','currency'],properties:{previousId:{type:'null'}}},
   else:{required:['previousId'],properties:{previousId:id('expense-billing')}}}
]};


const hourlyAuthorityIdentifier={type:'string',pattern:'^hourly-authority-[a-f0-9]{32}-r[1-9][0-9]*$'};
const exactHours={type:'string',pattern:'^(?:0|[1-9][0-9]{0,19})(?:\\.[0-9]{1,4})?$'};
const workBillingSelection={caseId:id('operation'),chargeId:id('work-billing')};
const hourlyAuthorityTerms={type:'object',additionalProperties:false,properties:{
  title:nonempty(300),authorization:nonempty(12000),authorizedOn:supportDate,
  sourceIds:{type:'array',items:id('source'),minItems:1,uniqueItems:true},
  endpointId:nonempty(200),customerId:nonempty(100),
  currency:{type:'object',additionalProperties:false,properties:{code:{type:'string',pattern:'^[A-Z]{3}$'},scale:{type:'integer',minimum:0,maximum:6}},required:['code','scale']},
  periodStart:supportDate,periodEnd:supportDate,rounding:{enum:['EXACT','HALF_UP']},
  hoursCap:{anyOf:[exactHours,{type:'null'}]},amountCap:{anyOf:[nonempty(100),{type:'null'}]},
  rates:{type:'array',minItems:1,maxItems:200,items:{type:'object',additionalProperties:false,properties:{
    id:requestIdentifier,label:nonempty(300),contributorIds:{type:'array',items:nonempty(300),minItems:1,uniqueItems:true},
    costIds:{type:'array',items:nonempty(300),minItems:1,uniqueItems:true},hourlyRate:nonempty(100)},
    required:['id','label','contributorIds','costIds','hourlyRate']}}
},required:['title','authorization','authorizedOn','sourceIds','endpointId','customerId','currency','periodStart','periodEnd','rates','rounding','hoursCap','amountCap']};
const workBillingFields={
  requestId:requestIdentifier,actor:nonempty(300),expectedVersion:integer,
  previousId:{anyOf:[id('work-billing'),{type:'null'}]},mode:{enum:['NEW','DRAFT_EDIT','CREDIT','VOID','REPLACE']},
  authorityId:hourlyAuthorityIdentifier,expectedAuthoritySha256:digest,reason:nonempty(3000),
  issueDate:supportDate,dueDate:supportDate,effectiveDate:supportDate,resolution:{enum:['CREDIT','VOID']},
  purchaseOrder:str(300),note:str(6000),expectedPreviewSha256:digest,
  lines:{type:'array',minItems:1,maxItems:200,items:{type:'object',additionalProperties:false,properties:{
    workId:id('work'),expectedWorkSha256:digest,rateId:requestIdentifier,hours:exactHours,description:nonempty(3000)},
    required:['workId','expectedWorkSha256','rateId','hours','description']}}
};
const workBillingRequired=['workspace','caseId','requestId','actor','expectedVersion','mode','authorityId','expectedAuthoritySha256','reason','lines'];
const workBillingRules={allOf:[
  {if:{properties:{mode:{const:'NEW'}},required:['mode']},then:{properties:{previousId:{type:'null'}}},
   else:{required:['previousId'],properties:{previousId:id('work-billing')}}}
]};

const commercialChangeSelection = {caseId:id('operation'),billingId:commercialIdentifier,milestoneId:commercialIdentifier};
const commercialChangeFields = {expectedVersion:{type:'integer',minimum:0},previousChangeId:{anyOf:[commercialIdentifier,{type:'null'}]},
  actor:nonempty(300),sourceIds:{type:'array',items:id('source'),minItems:1,uniqueItems:true},
  mode:{enum:['DRAFT_EDIT','CREDIT','VOID','REPLACE']},resolution:{enum:['VOID','CREDIT']},
  targetAmount:nonempty(100),issueDate:supportDate,dueDate:supportDate,effectiveDate:supportDate,authorizedOn:supportDate,
  description:nonempty(3000),reason:nonempty(3000),authorization:nonempty(12000),purchaseOrder:str(300),note:str(6000)};
const commercialChangeRequired=['workspace','caseId','billingId','milestoneId','expectedVersion','actor','sourceIds','mode','targetAmount','effectiveDate','authorizedOn','reason','authorization'];
const commercialSourceSelection = {
  installationId:id('installation'), installationRevision,
  expectedInstallationSha256:digest, currencyScale:{type:'integer',minimum:0,maximum:6},
};
const commercialSourceRequired = ['workspace','caseId','expectedVersion','installationId',
  'installationRevision','expectedInstallationSha256','currencyScale'];
const commercialMilestoneMapping = {type:'object',additionalProperties:false,
  properties:{milestoneId:commercialIdentifier,issueDate:supportDate,dueDate:supportDate,
    billingBasis:{enum:['PHASE_ACCEPTANCE','COMMERCIAL_AUTHORIZATION']},
    requiredCheckIds:{type:'array',items:nonempty(300),uniqueItems:true},
    authorizationSourceIds:{type:'array',items:id('source'),uniqueItems:true},
    authorizationNote:str(6000)},
  required:['milestoneId','issueDate','dueDate','billingBasis'],
  allOf:[
    {if:{properties:{billingBasis:{const:'PHASE_ACCEPTANCE'}},required:['billingBasis']},
      then:{required:['requiredCheckIds'],properties:{requiredCheckIds:{minItems:1}}}},
    {if:{properties:{billingBasis:{const:'COMMERCIAL_AUTHORIZATION'}},required:['billingBasis']},
      then:{required:['authorizationSourceIds','authorizationNote'],
        properties:{authorizationSourceIds:{minItems:1},authorizationNote:{minLength:1}}}},
  ]};

const settlementRecordId = prefix => ({type:'string',maxLength:100,pattern:'^'+prefix+'-[a-z0-9-]*$'});
const settlementReferences = prefix => ({type:'array',items:settlementRecordId(prefix),uniqueItems:true,maxItems:200});
const settlementUnitProperties = {
  currency:nonempty(40),decimals:{type:'integer',minimum:0,maximum:12},
  unitSourceIds:settlementReferences('source'),unitNote:nonempty(4000)
};
const settlementUnits = {type:'object',additionalProperties:false,properties:settlementUnitProperties,
  required:['currency','decimals','unitSourceIds','unitNote']};
const settlementCash = {type:'object',additionalProperties:false,properties:{
  ...settlementUnitProperties,date:supportDate,usdValue:{anyOf:[nonempty(80),{type:'null'}]},
  valuationSourceIds:settlementReferences('source'),valuationNote:str(4000),
  category:{enum:['INVOICE','CUSTOMER','REFUND','OTHER']},
  tranche:{anyOf:[{type:'integer',minimum:0,maximum:3},{type:'null'}]},
  allocations:{type:'array',items:{type:'object',additionalProperties:false,
    properties:{invoiceId:settlementRecordId('invoice'),amountUsd:nonempty(80)},required:['invoiceId','amountUsd']}}
},required:['date','currency','decimals','unitSourceIds','unitNote']};
const settlementSelections = {type:'array',maxItems:5000,items:{
  type:'object',additionalProperties:false,properties:{
    rowId:nonempty(300),decision:{enum:['RECORD_CASH','LINK_CASH','OBSERVE','OMIT']},reason:nonempty(4000),
    cashId:{anyOf:[settlementRecordId('cash'),{type:'null'}]},cash:{anyOf:[settlementCash,settlementUnits]},
    deploymentIds:settlementReferences('deployment'),workIds:settlementReferences('work')
  },required:['rowId','decision','reason','deploymentIds','workIds'],
  allOf:[
    {if:{properties:{decision:{const:'RECORD_CASH'}},required:['decision']},
      then:{required:['cash'],properties:{cash:settlementCash}}},
    {if:{properties:{decision:{const:'LINK_CASH'}},required:['decision']},
      then:{required:['cashId','cash'],properties:{cashId:settlementRecordId('cash'),cash:settlementUnits}}}
  ]
}};
const settlementCorrection = {reviewId:id('settlement'),rowId:nonempty(300),
  expectedCashId:{anyOf:[settlementRecordId('cash'),{type:'null'}]},decision:{enum:['CORRECT_CASH','LINK_CASH','VOID_CASH','RELINK']},
  reason:nonempty(4000),cashId:settlementRecordId('cash'),cash:{anyOf:[settlementCash,settlementUnits]},deploymentIds:settlementReferences('deployment'),workIds:settlementReferences('work')};
const settlementCorrectionRequired = ['reviewId','rowId','expectedCashId','decision','reason'];
const settlementCorrectionRules = {allOf:[
  {if:{properties:{decision:{const:'CORRECT_CASH'}},required:['decision']},then:{required:['cash'],properties:{cash:settlementCash},not:{required:['cashId']}}},
  {if:{properties:{decision:{const:'LINK_CASH'}},required:['decision']},then:{required:['cashId','cash'],properties:{cash:settlementUnits}}},
  {if:{properties:{decision:{enum:['VOID_CASH','RELINK']}},required:['decision']},then:{not:{anyOf:[{required:['cash']},{required:['cashId']}]}}}
]};
const settlementPreviewRules = {allOf:[
  {if:{required:['name']},then:{required:['selections']}},
  {if:{required:['selections']},then:{required:['name']}}
]};

function tool(suffix, description, properties = {}, required = [], readOnly = false, rules = {}) {
  return {name:'merchant_grant_' + suffix, description,
    annotations:{readOnlyHint:readOnly, destructiveHint:false, idempotentHint:true, openWorldHint:false},
    inputSchema:{type:'object', properties, required, additionalProperties:false, ...rules}};
}
export const grantWorkspaceTools = [
  ...grantInstallationSourceTools,
  ...grantSourceCollectionTools,
  tool('workspaces', 'List host-declared SF47 workspaces and original source selections without opening SQLite or starting a process.', {}, [], true),
  tool('open', 'Attach to the original verified Grant application; if the host allows it and the original service is closed, explicitly launch the same original managed server. Original workspace locking remains authoritative.',
    {...ws, expectedSelectionSha256:digest}, ['workspace']),
  tool('inspect', 'Inspect the actual original managed grant listener and this client ownership.', ws, ['workspace'], true),
  tool('close', 'Drain this client and close only its owned original grant server. A borrowed Applications server keeps its original owner.',
    {...ws, expectedInstanceId:nonempty(64)}, ['workspace','expectedInstanceId']),
  tool('browser', 'Return the original private browser access URL and verified launch for the same SF47 service.', ws, ['workspace'], true),
  tool('plans', 'Read all original saved plan summaries; complete response bytes and named arrays are retained.', ws, ['workspace'], true),
  tool('plan', 'Read the current or selected immutable original plan revision, complete scenario, staffing and cash report.',
    {...ws, planId:id('plan'), revision:integer}, ['workspace','planId'], true),
  tool('plan_history', 'Read the original saved revision history for a selected plan.',
    {...ws, planId:id('plan')}, ['workspace','planId'], true),
  tool('plan_comparison', 'Compare two explicit retained grant plan revisions, including a named alternative. Returns complete input and report changes, work-package/payment/milestone/staffing/delivery scope, exact decimal funding and capacity deltas, full daily cash rows and both source snapshots. The returned comparison SHA selects the full receiving package and CSV/HTML exports.',
    {...ws,planId:id('plan'),fromRevision:planComparisonRevision,toRevision:planComparisonRevision,toPlanId:id('plan'),expectedComparisonSha256:digest},
    ['workspace','planId','fromRevision','toRevision'],true),
  tool('plan_estimate', 'Preview the original SF47 planning engine using its current revision and supplied original scenario/planning changes. This saves no revision.',
    {...ws, ...planSelection, scenarioPatch:object, planning:object}, ['workspace','planId','expectedRevision'], true),
  tool('plan_save', 'Save an original plan revision with its reviewed current revision, note and stable request ID.',
    {...ws, ...planSelection, scenarioPatch:object, planning:object, note:nonempty(12000), requestId:requestIdentifier},
    ['workspace','planId','expectedRevision','note','requestId']),
  tool('plan_restore', 'Create the original saved-plan restoration revision; preserve history and reject a changed current revision.',
    {...ws, ...planSelection, selectedRevision:integer, note:nonempty(12000), requestId:requestIdentifier},
    ['workspace','planId','expectedRevision','selectedRevision','note','requestId']),
  tool('plan_clone', 'Clone the selected original current plan under a supplied name with native request replay.',
    {...ws, ...planSelection, name:nonempty(300), requestId:requestIdentifier},
    ['workspace','planId','expectedRevision','name','requestId']),
  tool('plan_import', 'Import one complete original scenario or planning ZIP from a host input, verified transfer or retained snapshot. note, planning and filename apply only to kind scenario; a plan ZIP retains those original fields.',
    {...ws, ...originalInput, kind:{enum:['scenario','plan']}, name:nonempty(300), requestId:requestIdentifier,
      note:str(12000), planning:object, filename:nonempty(240)},
    ['workspace','input','expectedInputSha256','kind','name','requestId']),
  ...grantPlanningSourceTools,
  ...grantReportingCaptureTools,
  ...grantProcedureTools,
  tool('cases', 'Read original operating case summaries, optionally for a selected saved plan.',
    {...ws, planId:id('plan')}, ['workspace'], true),
  tool('case', 'Read the entire original operating case, pinned plan, eight record collections, source metadata, reviews, forecasts and portfolios.',
    {...ws, caseId:id('operation')}, ['workspace','caseId'], true),
  tool('operating_workflows', 'Read the complete six-family saved operating workflow index at one original case version: statement originals, account reconciliation editions, funding editions, award terms, cohort delivery and grant procedures. Each entry retains its original summary and exact selection. The complete response uses the existing retained snapshot and paging tools.',
    {...ws, caseId:id('operation'), expectedVersion:integer}, ['workspace','caseId','expectedVersion'], true),
  tool('case_report', 'Read original delivery, invoice allocation, native asset and grant receipt reporting without reinterpretation.',
    {...ws, caseId:id('operation')}, ['workspace','caseId'], true),
  tool('amendments', 'Read the original selected case baseline, complete saved plan revision choices and immutable amendment summaries.',
    {...ws, caseId:id('operation')}, ['workspace','caseId'], true),
  tool('amendment', 'Open the exact retained amendment edition, its full selected-plan comparison, operator review, application and original history.',
    {...ws, caseId:id('operation'), amendmentId:id('amendment'), revision:{type:'integer',minimum:1,maximum:300}},
    ['workspace','caseId','amendmentId'], true),
  tool('amendment_preview', 'Compare an exact saved native planning revision with this case, including full changed fields, original record bindings, invoice/work/cash exposure and payment-derived clocks. Inline inputs or the original verified input reference remain selected explicitly.',
    {...ws, ...caseSelection, ...modelInput}, ['workspace','caseId','expectedVersion'], true),
  tool('amendment_calendar_export', 'Export the complete native before and selected delivery calendars in ICS, CSV and JSON, their readable comparison, original amendment preview and full operating case. Supply the exact draft or saved-edition export selection through inputs or an original verified input reference.',
    {...ws, caseId:id('operation'), ...modelInput}, ['workspace','caseId'], true),
  tool('case_history', 'Read the original event page with its native after-version and nextAfter cursor. Continue each native page explicitly.',
    {...ws, caseId:id('operation'), after:{type:'integer', minimum:0, maximum:10000000},
      limit:{type:'integer', minimum:1, maximum:200}}, ['workspace','caseId'], true),
  tool('case_create', 'Create an original OPERATIONS or WALKTHROUGH case from the exact reviewed immutable plan revision and content SHA256.',
    {...ws, ...createCase}, ['workspace','planId','selectedRevision','expectedContentSha256','name','mode','actor','requestId']),
  tool('case_command', 'Record or transition original contributor, work, invoice, cash, award, deployment, purchase, outcome, review or plan-amendment decisions. Amendment save/review/apply retain the exact selected baseline, original work and cash identities, operator decision and full history. Native action validation, state, version and same-ID replay remain authoritative.',
    {...ws, ...caseSelection, ...originalRequest, action:{enum:GRANT_CASE_ACTIONS}, data:object},
    ['workspace','caseId','expectedVersion','requestId','actor','action','data']),
  tool('statement_inspect', 'Inspect complete original OFX / QFX or MT940 bytes against the current case version. Return native account/currency sections, original dated balances, pending observations and source findings. Retain the exact section ID and format options for preview. Complete results use the original snapshot and row readers.',
    {...ws,...caseSelection,...statementInspectionModelInput},['workspace','caseId','expectedVersion'],true),
  tool('statement_preview', 'Review original CSV, OFX / QFX or MT940 against the selected case. Keep the exact original bytes, account/currency selection, native options or CSV mapping and source-row decisions. Reconcile original balances, payment identities and supplier invoice allocations; complete results use the snapshot and row readers.',
    {...ws,...caseSelection,...statementModelInput},['workspace','caseId','expectedVersion'],true),
  tool('statement_receive', 'Receive the exact reviewed CSV, OFX / QFX or MT940 through the original case transaction: retain source bytes, full native parser report and complete review, reconcile existing payment identities and add selected new cash observations. Preserve the reviewed preview SHA, selected account/options and original request ID for recovery.',
    {...ws,...caseSelection,...statementModelInput,...originalRequest,expectedPreviewSha256:digest},
    ['workspace','caseId','expectedVersion','requestId','actor','expectedPreviewSha256']),
  tool('case_import', 'Receive the complete original operating-case ZIP, including every source, review, forecast and portfolio, into the named original workspace.',
    {...ws, ...originalInput, name:nonempty(300), requestId:requestIdentifier, actor:nonempty(300)},
    ['workspace','input','expectedInputSha256','name','requestId','actor']),
  tool('intake', 'Adopt a complete original source-intake packet through the existing SF47 intake authority, preserving source purchase and deployment identity.',
    {...ws, ...originalInput, ...Object.fromEntries(Object.entries(createCase).filter(([key]) => key !== 'mode'))},
    ['workspace','input','expectedInputSha256','planId','selectedRevision','expectedContentSha256','name','actor','requestId']),
  tool('cost_funding', 'Read every original Work row and supplier invoice line, exact current source identities and the one funding book history. Funding assignments are separate from work acceptance, cost, cash and issuer decisions.',
    {...ws,caseId:id('operation')},['workspace','caseId'],true),
  tool('funding_edition', 'Open the complete original funding edition, all source revisions, exact period report and later source differences. Omit revision only to select the current saved head.',
    {...ws,caseId:id('operation'),revision:integer},['workspace','caseId'],true),
  tool('funding_request', 'Read the original funding-save request fingerprint, complete committed result and source/event join without a mutation.',
    {...ws,caseId:id('operation'),requestId:requestIdentifier},['workspace','caseId','requestId'],true),
  tool('funding_seed', 'Prepare complete editable funding inputs from current or selected historical edition. Keeps all assignments and selects the current head as successor base; no cost or grant decision is inferred.',
    {...ws,...caseSelection,revision:integer},['workspace','caseId','expectedVersion'],true),
  tool('funding_preview', 'Calculate exact invoice-cent and work-hour splits, genuine unassigned remainders, source-condition observations and full opening/period/closing balances. Complete inputs are inline or an original retained file.',
    {...ws,...caseSelection,...modelInput},['workspace','caseId','expectedVersion'],true),
  tool('funding_save', 'Save a complete reviewed funding successor through the original case transaction. The existing MCP owner retains the complete request and native response; a surviving accepted response cannot replay into an older restored journal. Keeps all original costs, payments and acceptance records.',
    {...ws,...caseSelection,...modelInput,...originalRequest,expectedPreviewSha256:digest,acceptedResult:object},
    ['workspace','caseId','expectedVersion','requestId','actor','note','expectedPreviewSha256']),
  tool('task_outcomes', 'List complete customer task comparisons and their current saved editions in the original case.',
    {...ws,caseId:id('operation')},['workspace','caseId'],true),
  tool('task_outcome', 'Read the complete original task comparison, both method inputs, exact calculation, source selection and full revision history.',
    {...ws,caseId:id('operation'),comparisonId:id('task-outcomes'),revision:integer},['workspace','caseId','comparisonId'],true),
  tool('task_outcomes_seed', 'Prepare complete editable customer task comparison inputs at /inputs. Keeps the existing case and installation identities.',
    {...ws,...caseSelection},['workspace','caseId','expectedVersion'],true),
  tool('task_outcomes_preview', 'Review complete prior and installed methods, active person-time, whole-operation elapsed time, one-currency cost and explicit scope comparability. Inputs are inline or selected from one complete retained file.',
    {...ws,...caseSelection,...modelInput},['workspace','caseId','expectedVersion'],true),
  tool('task_outcomes_save', 'Save a reviewed complete task comparison edition through the original case transaction. Retains all source selections and prior revisions; recover the same original request after an interrupted response.',
    {...ws,...caseSelection,...modelInput,...originalRequest,expectedPreviewSha256:digest},
    ['workspace','caseId','expectedVersion','requestId','actor','expectedPreviewSha256']),
  tool('work_intakes', 'List saved recorded-work and supplier-invoice source intakes in the original case, including current draft/applied editions.',
    {...ws,caseId:id('operation')},['workspace','caseId'],true),
  tool('work_intake', 'Read an original intake, positional source rows, complete mapping, edition history and applied native record links.',
    {...ws,caseId:id('operation'),intakeId:id('intake'),revision:integer},['workspace','caseId','intakeId'],true),
  tool('work_intake_upload', 'Open a work or invoice intake from an exact existing case source. Use source_attach for original file bytes. Reopening the same source and kind returns its existing intake.',
    {...ws,...caseSelection,...originalRequest,sourceId:id('source'),name:nonempty(300),kind:{enum:['WORK','INVOICES']},format:intakeFormat},
    ['workspace','caseId','expectedVersion','requestId','actor','sourceId','name','kind']),
  tool('work_intake_preview', 'Preview every original source row, grouped invoice, exact native amount and duplicate decision against the reviewed case. Inputs may select a complete edited document inline or from an original input/snapshot; omission uses the saved edition.',
    {...ws,...caseSelection,intakeId:id('intake'),revision:integer,...intakeModelInput},
    ['workspace','caseId','expectedVersion','intakeId'],true),
  tool('work_intake_save', 'Retain a full intake mapping edition, row corrections and record decisions in the original case. Supply the current case version, intake edition and original request ID; omission of inputs keeps the saved mapping.',
    {...ws,...caseSelection,...originalRequest,intakeId:id('intake'),expectedRevision:integer,...intakeModelInput,expectedPreviewSha256:digest},
    ['workspace','caseId','expectedVersion','requestId','actor','intakeId','expectedRevision']),
  tool('work_intake_apply', 'Apply the complete reviewed work/invoice intake in one original transaction. The exact preview SHA, case version, intake edition and request ID preserve all native created/matched records and original source links.',
    {...ws,...caseSelection,...originalRequest,intakeId:id('intake'),expectedRevision:integer,...intakeModelInput,expectedPreviewSha256:digest},
    ['workspace','caseId','expectedVersion','requestId','actor','intakeId','expectedRevision','expectedPreviewSha256']),
  tool('risks', 'Read the complete original Delivery risks register and immutable edition history, newest first, against the current case source.',
    {...ws,caseId:id('operation')},['workspace','caseId'],true),
  tool('risk_register', 'Open one saved Delivery risks edition with its complete document, source, report and current source comparison.',
    {...ws,caseId:id('operation'),reviewId:id('review')},['workspace','caseId','reviewId'],true),
  tool('risk_comparison', 'Read two complete immutable Delivery risk editions by their original review IDs and SHA256 identities. Retains every risk, mitigation, dated report change, linked source context, both full original reviews and the authoritative native comparison digest. Current case identity is separate, including after receiving. This read changes no draft or register.',
    {...ws,caseId:id('operation'),beforeReviewId:id('review'),beforeReviewSha256:digest,afterReviewId:id('review'),afterReviewSha256:digest},
    ['workspace','caseId','beforeReviewId','beforeReviewSha256','afterReviewId','afterReviewSha256'],true),
  tool('risk_history', 'Read one stable risk or issue across every saved register edition, including its retained mitigation actions and reviews.',
    {...ws,caseId:id('operation'),riskId},['workspace','caseId','riskId'],true),
  tool('risk_seed', 'Prepare an editable Delivery risks register from the actual case contributors, packages and sources. An optional reviewId selects the original edition; a successor retains all previous stable risk and action IDs.',
    {...ws,...caseSelection,reviewId:id('review')},['workspace','caseId','expectedVersion'],true),
  tool('risk_preview', 'Preview the complete operator-authored risk register, ownership, mitigation actions, review dates, attached sources and native findings. Dates and assessments come from the recorded document. Supply inputs inline or one complete input reference; inputPointer /document selects a seed or preview document.',
    {...ws,...caseSelection,...modelInput,inputs:riskDocument},['workspace','caseId','expectedVersion'],true),
  tool('risk_save', 'Save the complete reviewed Delivery risks edition through original risk-register.save. Retain the current case version, exact document, preview SHA256, stable original request ID, operator and nonempty review note. The native command preserves immutable history and exact-request recovery.',
    {...ws,...caseSelection,...modelInput,inputs:riskDocument,...originalRequest,note:nonempty(12000),expectedPreviewSha256:digest},
    ['workspace','caseId','expectedVersion','requestId','actor','note','expectedPreviewSha256']),
  tool('risk_request', 'Look up the original saved risk-register.save request without writing. Supply the whole original command as inputs or an exact retained input reference, including its original reviewed version, request ID, actor, note, action, complete document and preview digest. A found result must match this complete original command; preserve it after an interrupted connection.',
    {...ws,caseId:id('operation'),...modelInput,inputs:riskSaveCommand},['workspace','caseId'],true),
  tool('engagements', 'Read every original Contributor Engagements edition and its retained receiving summaries. Full source documents and response bytes remain available through the original native snapshots.',
    {...ws,caseId:id('operation')}, ['workspace','caseId'], true),
  tool('engagement', 'Reopen one complete immutable Contributor Engagements review, its source, report, current source comparison and prior Forecast/Portfolio receiving records.',
    {...ws,caseId:id('operation'),reviewId:id('review')}, ['workspace','caseId','reviewId'], true),
  tool('engagement_seed', 'Create an editable native agreement document from actual case contributors, packages and sources, optionally superseding one saved edition. This neither confirms an agreement nor writes the case.',
    {...ws,...caseSelection,reviewId:id('review')}, ['workspace','caseId','expectedVersion'], true),
  tool('engagement_preview', 'Preview the complete sourced agreement book through its native engine. Retain real roles, dates, availability, rates, terms, allocations and acceptance evidence. Supply inputs inline or one verified file/snapshot/transfer reference; inputPointer /document selects the original seed document.',
    {...ws,...caseSelection,...modelInput,inputs:engagementDocument}, ['workspace','caseId','expectedVersion'], true),
  tool('engagement_prepare', 'Freeze the exact reviewed agreement document with original engagement.prepare. Requires a nonempty recorded note, current case version, preview SHA256 and stable request ID. Confirmed acceptance must already be supported by its actual person, timestamp and evidence.',
    {...ws,...caseSelection,...modelInput,inputs:engagementDocument,...originalRequest,note:nonempty(12000),expectedPreviewSha256:digest},
    ['workspace','caseId','expectedVersion','requestId','actor','note','expectedPreviewSha256']),
  tool('engagement_forecast', 'Preview the native Forecast handover from CONFIRMED agreements and the exact review SHA. Book and base Forecast dates must match. Retain normalized remainders and payment-mode choices, then save returned /inputs with original forecast_save.',
    {...ws,...caseSelection,...modelInput,inputs:engagementForecastSelection}, ['workspace','caseId','expectedVersion'], true),
  tool('engagement_portfolio', 'Preview the native Portfolio handover using the newly saved Forecast, selected agreements and complete resource map. Full draft and alternatives retain original Installation phases. Native findings remain visible; save returned /inputs with original portfolio_save.',
    {...ws,...caseSelection,...modelInput,inputs:engagementPortfolioSelection}, ['workspace','caseId','expectedVersion'], true),
  tool('engagement_receiving', 'Record the validated original engagement-to-Forecast-to-Portfolio join once. Inputs retain exact book SHA, saved Forecast/Portfolio IDs and both complete normalized selections. Requires current case version, stable request ID and nonempty note. Exploratory alternatives retain their actual readiness findings.',
    {...ws,...caseSelection,...modelInput,inputs:engagementReceivingData,...originalRequest,note:nonempty(12000)},
    ['workspace','caseId','expectedVersion','requestId','actor','note']),
  tool('forecasts', 'Read all original immutable forecast summaries for a case.',
    {...ws, caseId:id('operation')}, ['workspace','caseId'], true),
  tool('forecast', 'Reopen the complete saved forecast, source snapshot and current source-change comparison.',
    {...ws, caseId:id('operation'), forecastId:id('forecast')}, ['workspace','caseId','forecastId'], true),
  tool('forecast_preview', 'Run the complete original remaining-work/cash forecast, including native quoted currencies, explicit sourced FX, native payment/cost credits and valuation coverage. Supply original inputs inline or a verified reference with inputPointer.',
    {...ws, ...caseSelection, ...forecastModelInput}, ['workspace','caseId','expectedVersion'], true),
  tool('forecast_save', 'Save the complete reviewed forecast, retaining original currencies, rates, credits, timing and source snapshot under its original case version, preview SHA256 and request ID.',
    {...ws, ...caseSelection, ...forecastModelInput, ...originalRequest, expectedPreviewSha256:digest},
    ['workspace','caseId','expectedVersion','requestId','actor','expectedPreviewSha256']),
  tool('portfolios', 'Read all original immutable resource and delivery portfolio summaries for a case.',
    {...ws, caseId:id('operation')}, ['workspace','caseId'], true),
  tool('portfolio', 'Reopen a complete saved allocation, its original forecast and source, all alternatives and dated results, and current source-change comparison.',
    {...ws, caseId:id('operation'), portfolioId:id('portfolio')}, ['workspace','caseId','portfolioId'], true),
  tool('portfolio_seed', 'Create the native editable allocation input from a selected current saved forecast. Optionally choose exact saved Installation editions for commercial tasks. Pass a complete current draft to retain its resource and alternative inputs while seeding phases. Retain all original tasks and remaining hours; acceptance never supplies remaining effort. Draft inputs may be inline or a verified reference with inputPointer.',
    {...ws, ...caseSelection, forecastId:id('forecast'), ...modelInput,
      installationSelections:{type:'array', maxItems:100, items:{type:'object', additionalProperties:false,
        properties:{taskId:nonempty(150), installationId:id('installation'),
          installationRevision, installationSha256:digest},
        required:['taskId','installationId','installationRevision','installationSha256']}}},
    ['workspace','caseId','expectedVersion','forecastId'], true),
  tool('portfolio_preview', 'Preview complete resource/date alternatives and original forecast cash outcomes. Installation plans retain every original phase and dependency, explicit remaining effort by resource, and a reviewed commercial delivery boundary. An alternative replaces the complete installationPlans field when supplied. Support still consumes capacity. Retain native currencies and rates; operational readiness stays separate from complete financial comparison. Supply original inputs or a verified reference with inputPointer.',
    {...ws, ...caseSelection, ...modelInput}, ['workspace','caseId','expectedVersion'], true),
  tool('portfolio_save', 'Save the exact reviewed native allocation and its complete source snapshot with original case version, preview SHA256 and request replay.',
    {...ws, ...caseSelection, ...modelInput, ...originalRequest, expectedPreviewSha256:digest},
    ['workspace','caseId','expectedVersion','requestId','actor','expectedPreviewSha256']),
  tool('portfolio_selection', 'Select a ready saved alternative into the original forecast input without saving another forecast. Preserve source identity and original collection rules; use the returned /inputs object in forecast preview/save.',
    {...ws, ...caseSelection, portfolioId:id('portfolio'), alternativeId:requestIdentifier},
    ['workspace','caseId','expectedVersion','portfolioId','alternativeId'], true),
  tool('review', 'Read the complete original retained business review and its source snapshot.',
    {...ws, caseId:id('operation'), reviewId:id('review')}, ['workspace','caseId','reviewId'], true),
  tool('ledger_intake', 'Read the native bulk ledger intake contract, downloadable CSV/TSV headers and every recorded original intake for a case.',
    {...ws,caseId:id('operation')},['workspace','caseId'],true),
  tool('ledger_intake_original', 'Reopen every original file and mapping from a retained bulk ledger intake, with the native rows and records created by that request.',
    {...ws,caseId:id('operation'),sourceId:id('source')},['workspace','caseId','sourceId'],true),
  tool('ledger_intake_inspect', 'Inspect one complete original CSV, TSV, JSON table or supporting file. Supply its native file object through inputs or a verified reference and optional inputPointer.',
    {...ws,caseId:id('operation'),...modelInput},['workspace','caseId'],true),
  tool('ledger_intake_preview', 'Preview a complete source-file intake against the current case: contributors, work, grouped supplier invoices and observed cash allocations. Supply the native document through inputs or a verified original JSON reference; each table keeps its exact original bytes.',
    {...ws,...caseSelection,...modelInput},['workspace','caseId'],true),
  tool('ledger_intake_apply', 'Record the complete reviewed ledger intake and original files atomically through the native record commands. Use the exact preview, case version and request ID; replay the unchanged request after an interrupted response.',
    {...ws,...caseSelection,...modelInput,...originalRequest,expectedPreviewSha256:digest},
    ['workspace','caseId','expectedVersion','expectedPreviewSha256','actor','requestId']),
  tool('account_reconciliation', 'Open original retained statement sources, all saved account reconciliation editions and the current native cash comparison. Select reconciliationId and optional revision to reopen an exact saved edition and its complete retained decisions.',
    {...ws,caseId:id('operation'),reconciliationId:id('reconciliation'),revision:integer,expectedVersion:integer},
    ['workspace','caseId'],true),
  tool('account_reconciliation_statement_inputs', 'Return the complete original Statements input with exact CSV bytes, mapping, balances and decisions for its original statement writer.',
    {...ws,caseId:id('operation'),sourceId:id('source')},['workspace','caseId','sourceId'],true),
  tool('account_reconciliation_preview', 'Preview a complete original statement period, whole-record cash matches, row exclusions and explicit outstanding items. Inputs contain expectedVersion, reconciliationId, expectedRevision, state and document. The original source anchors the closing comparison.',
    {...ws,caseId:id('operation'),expectedVersion:integer,...modelInput},['workspace','caseId'],true),
  tool('account_reconciliation_apply', 'Save the complete reviewed reconciliation as an immutable DRAFT or CLOSED edition in the original case transaction. Retain its exact reviewed preview, case version, current edition, recording operator and original request ID. Use a verified downloaded desk with inputPointer /pending/body to resume an interrupted original save.',
    {...ws,caseId:id('operation'),expectedVersion:integer,...modelInput,expectedPreviewSha256:digest,actor:nonempty(300),requestId:requestIdentifier},
    ['workspace','caseId']),
  tool('cash_account', 'Open the complete original cash account for selected dates, network, currency and asset: exact quantities, USD valuation basis, payment and refund allocations, native invoices and sources, correction history, completion clocks and full current forecast continuation inputs.',
    {...ws,caseId:id('operation'),startDate:supportDate,endDate:supportDate,network:str(200),currency:str(40),asset:str(500),expectedVersion:integer},
    ['workspace','caseId','endDate'],true),
  tool('cash_correction_preview', 'Review a complete original cash correction and its dated financial, invoice, package, asset, statement, completion and saved forecast effects. Supply the native input object with originalCashId, replacement, reason, expectedVersion, optional selection and original attachments through inputs or a verified reference. A top-level expectedVersion must match the retained input.',
    {...ws,caseId:id('operation'),expectedVersion:integer,...modelInput},['workspace','caseId'],true),
  tool('cash_correction_apply', 'Apply the reviewed correction through the original source.add, cash.void and cash.record commands in one transaction. Retain the exact original request ID, operator, case version and preview hash. Supply the complete native body through inputs or a verified file/reference; use inputPointer /pending/body to resume a downloaded cash desk. Optional top-level pins must match any retained values.',
    {...ws,caseId:id('operation'),expectedVersion:integer,...modelInput,expectedPreviewSha256:digest,actor:nonempty(300),requestId:nonempty(160)},
    ['workspace','caseId']),
  tool('supplier_account', 'Open the complete original contributor or supplier account at selected dates: original work and invoice links, invoice review states, payment/refund allocations across suppliers, source documents, opening/period/closing balances and aging. Keep complete account exports with the original case.',
    {...ws,caseId:id('operation'),contributorId:id('person'),startDate:supportDate,endDate:supportDate,expectedVersion:integer},
    ['workspace','caseId','endDate'],true),
  tool('performance', 'Read the selected business period and pinned budget: opening, period and closing cash/invoice positions, contributor and package performance, exact asset quantities, invoice aging and original source rows.',
    {...ws,caseId:id('operation'),startDate:supportDate,endDate:supportDate,expectedVersion:{type:'integer',minimum:1,maximum:10000000}},
    ['workspace','caseId','endDate'],true),
  tool('delivery_queue', 'Read the complete Installation delivery queue from current saved editions: assignees, due dates, priorities, prerequisites and recorded acceptance. The calendar date classifies the current work.',
    {...ws,caseId:id('operation'),asOfDate:supportDate},
    ['workspace','caseId'],true),
  tool('installations', 'Read the latest saved customer installation editions from the original Operations case, with configuration decisions and original acceptance counts.',
    {...ws,caseId:id('operation')},['workspace','caseId'],true),
  tool('installation', 'Reopen one complete original customer installation edition: task, source, terms, receiving application, funded assignment, selected original records, report and changes.',
    {...ws,caseId:id('operation'),installationId:id('installation'),revision:installationRevision},
    ['workspace','caseId','installationId'],true),
  tool('installation_history', 'Page original immutable installation editions using the returned nextBefore cursor. Preserve the same original installation identity.',
    {...ws,caseId:id('operation'),installationId:id('installation'),before:installationRevision,
      limit:{type:'integer',minimum:1,maximum:100}},['workspace','caseId','installationId'],true),
  tool('installation_returns', 'List every retained Installation receiving report and explicit owner review in the original Operations case. Reopen a full report with merchant_grant_review.',
    {...ws,caseId:id('operation')},['workspace','caseId'],true),
  tool('installation_return_seed', 'Start a complete receiving report against one exact original saved Installation. Every original check starts OPEN; retain the full source edition and enter actual named observations.',
    {...ws,...caseSelection,installationId:id('installation'),revision:installationRevision,sha256:digest},
    ['workspace','caseId','expectedVersion','installationId','revision','sha256'],true),
  tool('installation_return_preview', 'Preview every original receiving check and its complete source/record references. The native result identifies changed source/configuration without relabeling earlier observations. Inputs may be inline or one complete retained original input.',
    {...ws,...caseSelection,...modelInput},['workspace','caseId','expectedVersion'],true),
  tool('installation_return', 'Freeze the exact reviewed receiving report under the existing case request journal. Retain the original request, named operator, note and full preview SHA; this records observations and preserves every source file.',
    {...ws,...caseSelection,...modelInput,...originalRequest,expectedPreviewSha256:digest},
    ['workspace','caseId','expectedVersion','requestId','actor','note','expectedPreviewSha256']),
  tool('installation_return_review_seed', 'Reopen an exact owner review retained in this same case, including its original returned evidence after cold receiving. Compare staged/current plan and records; new choices start KEEP. Existing original decisions and saved Installation editions are returned separately.',
    {...ws,...caseSelection,retainedReview:installationReviewRef},['workspace','caseId','expectedVersion','retainedReview'],true),
  tool('installation_return_review_preview', 'Compare an imported complete receiving case with the owner current Installation. Inputs explicitly KEEP or APPLY every returned check; changed criteria or acceptance basis require fresh receiving. Work and purchases remain original evidence.',
    {...ws,...caseSelection,...modelInput},['workspace','caseId','expectedVersion'],true),
  tool('installation_return_stage', 'Retain the exact owner review and full original evidence files, returning a complete proposed Installation document at /document. Pass that document and returnReview {id:recordId,sha256:reviewSha256} to the original installation_preview and installation_save. The selected staged review must still match the current plan, sources and original Installation edition.',
    {...ws,...caseSelection,...modelInput,...originalRequest,expectedPreviewSha256:digest},
    ['workspace','caseId','expectedVersion','requestId','actor','note','expectedPreviewSha256']),
  tool('customer_use_calendar', 'Read complete saved Installation customer-use calendars, their pinned proposal rules, dated useful requests, separately planned direct/prepaid settlements and linked original receipt states. Supply exact editions to reopen historical choices. Planned counts do not qualify as actual cohort results.',
    {...ws,...caseSelection,installationRefs:customerUseInstallationRefs,asOfDate:supportDate},
    ['workspace','caseId','expectedVersion'],true),
  tool('customer_use_calendar_expand', 'Expand explicitly selected task/buyer weekdays and date exceptions into a complete editable Installation. inputs contains document and pattern; the whole returned document remains at /document. Review and save through the original Installation commands. No native request or purchase is created.',
    {...ws,...caseSelection,...customerUseExpansionInput},['workspace','caseId','expectedVersion'],true),
  tool('customer_use_calendar_cohort', 'Prepare the original Cohort input from an exact saved customer-use window and linked native receipts. Preserve original purchase identities and source files. Transfer/output/order and coverage decisions remain unreviewed; use the returned /inputs in original cohort_preview/prepare.',
    {...ws,...caseSelection,installationRefs:customerUseInstallationRefs,groupId:nonempty(100),asOfAt:{type:'string',format:'date-time'}},
    ['workspace','caseId','expectedVersion','groupId'],true),
  tool('installation_seed', 'Open a complete customer installation document with the pinned plan original work packages and measurable criteria. The document is at /document in the original response.',
    {...ws,...caseSelection},['workspace','caseId','expectedVersion'],true),
  tool('installation_workshares', 'Read complete original commercial Workshares from an attached commissioning source and optional matching receiving packet. Preserve original case identity, complete plan, commercial currency/status, milestone amounts, phase count and effort.',
    {...ws,...caseSelection,...workshareSources},
    ['workspace','caseId','expectedVersion','sourceId','expectedSourceSha256'],true),
  tool('installation_workshare_seed', 'Receive one original commercial Workshare into a complete editable native Installation document at /document. Keep complete attached sources, phase criteria and the original commercial currency/status. To refresh a current draft, supply its whole document as inputs or one retained input. Changed original phases reopen their acceptance steps; deployment, native payment and receiving choices remain editable. Save through installation_preview and installation_save.',
    {...ws,...caseSelection,...workshareSources,...installationSelection,...modelInput,workshareCaseId:nonempty(500)},
    ['workspace','caseId','expectedVersion','sourceId','expectedSourceSha256','workshareCaseId','installationId','expectedRevision'],true),
  tool('installation_workflows', 'Read the complete original recurring-work source ZIP attached to this case. Inspect the exact customer profile, series/cycles, recorded native runs and selected complete customer files before preparing the Installation.',
    {...ws,...caseSelection,sourceId:id('source'),expectedSourceSha256:digest},
    ['workspace','caseId','expectedVersion','sourceId','expectedSourceSha256'],true),
  tool('installation_workflow_seed', 'Receive selected original customer periods into a complete editable Installation at /document. Retain earlier periods and complete source files. Changed native work reopens its acceptance step; record the actual receiving operator observation before the original preview/save. Current complete draft input is optional.',
    {...ws,...caseSelection,...installationSelection,...modelInput,sourceId:id('source'),expectedSourceSha256:digest,
      cycleIds:{type:'array',items:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'},minItems:1,maxItems:100,uniqueItems:true}},
    ['workspace','caseId','expectedVersion','sourceId','expectedSourceSha256','cycleIds','installationId','expectedRevision'],true),
  tool('installation_effort_seed', 'Prepare complete original Installation effort and support inputs from the selected source, current native Work inventory and saved case-local phase allocations. Supply an optional complete edited document inline or through the existing verified input reference. The returned /document continues through the original installation_preview and installation_save.',
    {...ws,...caseSelection,installationId:id('installation'),expectedRevision:installationRevision,...modelInput,asOfDate:supportDate},
    ['workspace','caseId','expectedVersion','installationId','expectedRevision','asOfDate'],true),
  tool('installation_effort_selection', 'Open a complete native Forecast draft from the exact current saved Installation effort editions and their reviewed phase remainders. Keep matching original commercial task and source identities. Original cash, price and cost inputs remain in the complete /inputs object for the normal Forecast preview/save, followed by original Portfolio seed.',
    {...ws,...caseSelection,forecastId:id('forecast'),name:nonempty(300),note:str(12000),
      installationSelections:{type:'array',minItems:1,maxItems:100,items:{type:'object',additionalProperties:false,
        properties:{taskId:nonempty(150),installationId:id('installation'),installationRevision,installationSha256:digest},
        required:['taskId','installationId','installationRevision','installationSha256']}}},
    ['workspace','caseId','expectedVersion','forecastId','installationSelections'],true),
  tool('installation_preview', 'Review the complete selected customer installation against the original case version and current saved edition. Supply the document as inputs or one exact retained input with inputPointer /document from the seed.',
    {...ws,...caseSelection,...installationSelection,...modelInput,returnReview:installationReviewRef},
    ['workspace','caseId','expectedVersion','installationId','expectedRevision'],true),
  tool('installation_save', 'Append the exact reviewed customer installation edition in the original case journal. Retain the original request ID, operator, save reason, case version, installation selection and reviewed preview SHA.',
    {...ws,...caseSelection,...installationSelection,...modelInput,...originalRequest,expectedPreviewSha256:digest,returnReview:installationReviewRef},
    ['workspace','caseId','expectedVersion','installationId','expectedRevision','requestId','actor','note','expectedPreviewSha256']),

  tool('work_billing_catalog','Read accepted original CUSTOMER Work, exact hour reservations, hourly authority editions and retained charge history. Reservations coordinate case copies within this Operations workspace; independent installations require full-history reconciliation.',
    {...ws,caseId:id('operation')},['workspace','caseId'],true),
  tool('work_billing_authority','Read one immutable original customer hourly authority, full source bytes, scoped rates, period, caps and complete source context.',
    {...ws,caseId:id('operation'),authorityId:hourlyAuthorityIdentifier},['workspace','caseId','authorityId'],true),
  tool('work_billing_authority_save','Retain or revise explicit customer hourly authority with original sources, rate scopes, rounding and whole-authority caps. Work acceptance alone is not customer authority. Retry this exact complete body and original request ID after response loss.',
    {...ws,caseId:id('operation'),requestId:requestIdentifier,actor:nonempty(300),expectedVersion:integer,
      previousId:{anyOf:[hourlyAuthorityIdentifier,{type:'null'}]},expectedAuthoritySha256:digest,terms:hourlyAuthorityTerms},
    ['workspace','caseId','requestId','actor','expectedVersion','terms'],false,
    {allOf:[{if:{required:['previousId'],properties:{previousId:hourlyAuthorityIdentifier}},then:{required:['expectedAuthoritySha256']}}]}),
  tool('work_billing','Read one complete hourly customer charge, its accepted original Work, authority and native command/response history.',
    {...ws,...workBillingSelection},['workspace','caseId','chargeId'],true),
  tool('work_billing_preview','Review exact Work hours and declared customer rates against original case and native invoice state. Preserve decimal strings, authority SHA, requestId and complete body for prepare; no financial effect is made.',
    {...ws,caseId:id('operation'),...workBillingFields},workBillingRequired,true,workBillingRules),
  tool('work_billing_prepare','Retain the reviewed hourly customer charge and complete source evidence. Preparation creates no native invoice. Reuse the same body and requestId if the response is lost.',
    {...ws,caseId:id('operation'),...workBillingFields},[...workBillingRequired,'expectedPreviewSha256'],false,workBillingRules),
  tool('work_billing_apply','Apply or recover this original hourly draft, credit, void or replacement plan. Reuse chargeId, actor and proposal SHA; immutable native requests remain authoritative. Do not replace an uncertain command with a new charge.',
    {...ws,...workBillingSelection,actor:nonempty(300),expectedProposalSha256:digest},
    ['workspace','caseId','chargeId','actor','expectedProposalSha256']),
  tool('work_billing_cancel','Cancel an unused reviewed hourly preparation with its original request and reason. Pending or acknowledged native commands must be recovered instead.',
    {...ws,...workBillingSelection,requestId:requestIdentifier,actor:nonempty(300),expectedProposalSha256:digest,reason:nonempty(6000)},
    ['workspace','caseId','chargeId','requestId','actor','expectedProposalSha256','reason']),
  tool('work_billing_preview_issue','Read the exact hourly invoice issue review and native credit decision. An unresolved or acknowledged issue retains its original review; this action does not issue an invoice.',
    {...ws,...workBillingSelection},['workspace','caseId','chargeId'],true),
  tool('work_billing_issue','Issue or recover the same reviewed hourly invoice using the original actor, issue-preview SHA and credit decision. Native receipts, allocations, payments and invoice numbering remain authoritative.',
    {...ws,...workBillingSelection,actor:nonempty(300),expectedIssuePreviewSha256:digest,creditDecisionId:nonempty(100)},
    ['workspace','caseId','chargeId','actor','expectedIssuePreviewSha256']),
  tool('work_billing_refresh','Read linked hourly invoices, credits, payments and allocations without changing the retained proposal or making a financial command.',
    {...ws,...workBillingSelection},['workspace','caseId','chargeId'],true),
  tool('expense_billing_catalog','Read reviewed original CUSTOMER expense portions, exact native-unit reservations, retained buyer credits and source-backed customer charge histories. This reads existing original case data; it creates no accounting effect.',
    {...ws,caseId:id('operation')},['workspace','caseId'],true),
  tool('expense_billing','Read one complete retained expense charge: reviewed attribution editions, original authority bytes, customer terms, and immutable native command/response history.',
    {...ws,...expenseBillingSelection},['workspace','caseId','chargeId'],true),
  tool('expense_billing_preview','Review original expense portions and customer-authorized billing or correction against current case and native invoice state. Keep decimal and native-unit strings unchanged. Preview retains no financial effect; preserve this exact requestId/body for prepare.',
    {...ws,caseId:id('operation'),...expenseBillingFields},expenseBillingRequired,true,expenseBillingRules),
  tool('expense_billing_prepare','Retain the exact reviewed expense billing proposal and full original sources after preview. This preparation creates no native invoice or cash entry. On response loss reuse this complete body and original requestId.',
    {...ws,caseId:id('operation'),...expenseBillingFields},[...expenseBillingRequired,'expectedPreviewSha256'],false,expenseBillingRules),
  tool('expense_billing_apply','Apply or recover the same retained native expense draft, credit or void plan. Preserve chargeId, actor and proposal SHA. Each effect keeps its original immutable native request; a lost response must not create another preparation.',
    {...ws,...expenseBillingSelection,actor:nonempty(300),expectedProposalSha256:digest},
    ['workspace','caseId','chargeId','actor','expectedProposalSha256']),
  tool('expense_billing_cancel','Cancel the unused reviewed expense preparation with its original request and reason. Pending or acknowledged native accounting commands remain in their original recovery.',
    {...ws,...expenseBillingSelection,requestId:requestIdentifier,actor:nonempty(300),expectedProposalSha256:digest,reason:nonempty(6000)},
    ['workspace','caseId','chargeId','requestId','actor','expectedProposalSha256','reason']),
  tool('expense_billing_preview_issue','Read the exact retained expense invoice issue review, terms hash and native credit-control decision. Pending or acknowledged issue reopens its original review; this action issues no invoice.',
    {...ws,...expenseBillingSelection},['workspace','caseId','chargeId'],true),
  tool('expense_billing_issue','Issue or recover the original reviewed expense invoice. Reuse the same charge, original actor, issue preview and credit decision on every retry. Native numbering, invoice, payment and allocation records remain authoritative.',
    {...ws,...expenseBillingSelection,actor:nonempty(300),expectedIssuePreviewSha256:digest,creditDecisionId:nonempty(100)},
    ['workspace','caseId','chargeId','actor','expectedIssuePreviewSha256']),
  tool('expense_billing_refresh','Read current linked original and replacement invoices, credits, payments and allocations without changing the retained expense proposal or making a financial command.',
    {...ws,...expenseBillingSelection},['workspace','caseId','chargeId'],true),
  tool('commercial_changes', 'Read the complete original milestone-change history summaries. Open commercial_change for its immutable customer authorization, native requests and current state.',
    {...ws,...commercialChangeSelection},['workspace','caseId','billingId','milestoneId'],true),
  tool('commercial_change', 'Open one complete source-backed milestone correction, original authorization files and native command journal.',
    {...ws,caseId:id('operation'),changeId:commercialIdentifier},['workspace','caseId','changeId'],true),
  tool('commercial_change_preview', 'Review a customer-authorized draft edit, credit, void or replacement against the exact native invoice and original milestone. Read the full effects and previewSha256; the original account retains payment and allocation authority.',
    {...ws,...commercialChangeSelection,...commercialChangeFields},commercialChangeRequired,true),
  tool('commercial_change_prepare', 'Retain the exact reviewed customer amendment and native action plan. Preserve original authorization files, the full original invoice snapshot and the previous change identity. This preparation creates no native financial transaction.',
    {...ws,...commercialChangeSelection,...commercialChangeFields,requestId:requestIdentifier,expectedPreviewSha256:digest},[...commercialChangeRequired,'requestId','expectedPreviewSha256']),
  tool('commercial_change_apply', 'Apply or recover the same reviewed native credit/void/draft commands. Reuse this change ID and proposal hash; each accounting effect has an immutable original request. Replacement issue remains a separate reviewed action.',
    {...ws,caseId:id('operation'),changeId:commercialIdentifier,actor:nonempty(300),expectedProposalSha256:digest},
    ['workspace','caseId','changeId','actor','expectedProposalSha256']),
  tool('commercial_change_cancel', 'Cancel an unused preparation while preserving its complete source and history. A pending or acknowledged accounting effect remains in its original recovery.',
    {...ws,caseId:id('operation'),changeId:commercialIdentifier,actor:nonempty(300),expectedProposalSha256:digest,requestId:requestIdentifier,reason:nonempty(6000)},
    ['workspace','caseId','changeId','actor','expectedProposalSha256','requestId','reason']),
  tool('commercial_change_preview_issue', 'Review the exact corrected native draft, original milestone prerequisites and current native credit review. An existing issue request reopens its original review.',
    {...ws,caseId:id('operation'),changeId:commercialIdentifier},['workspace','caseId','changeId'],true),
  tool('commercial_change_issue', 'Issue or recover the original reviewed corrected invoice. Preserve the retained issue preview and request; native credit control, numbering and financial records stay authoritative.',
    {...ws,caseId:id('operation'),changeId:commercialIdentifier,actor:nonempty(300),expectedIssuePreviewSha256:digest,expectedProposalSha256:digest,creditDecisionId:commercialIdentifier},
    ['workspace','caseId','changeId','actor','expectedIssuePreviewSha256']),
  tool('commercial_change_refresh', 'Read all linked original and replacement invoices, credits, payments and allocation observations without changing the reviewed amendment.',
    {...ws,caseId:id('operation'),changeId:commercialIdentifier},['workspace','caseId','changeId'],true),
  tool('commercial_connections', 'Read the configured original receivables endpoints and their retained workspace/source identities.',
    {...ws}, ['workspace'], true),
  tool('commercial_connection_configure', 'Connect an existing local customer receivables API and retain its verified native identity. Reuse the original request ID when recovering a response. Updating a saved endpoint keeps the same accounting workspace and source identity.',
    {...ws,id:commercialIdentifier,label:nonempty(160),baseUrl:nonempty(2000),actor:nonempty(1000),requestId:requestIdentifier},
    ['workspace','id','label','baseUrl','actor','requestId']),
  tool('commercial_customers', 'Read saved customers, issuer and current native accounting revision from one configured receivables endpoint.',
    {...ws,endpointId:commercialIdentifier}, ['workspace','endpointId'], true),
  tool('commercial_list', 'Read compact saved billing summaries with original currency, amount and native draft/issued/pending counts. Open commercial for the complete preparation and retained source.',
    {...ws,caseId:id('operation')}, ['workspace','caseId'], true),
  tool('commercial', 'Read one complete retained commercial billing record, source milestone selection and native invoice observations.',
    {...ws,caseId:id('operation'),billingId:commercialIdentifier}, ['workspace','caseId','billingId'], true),
  tool('commercial_schedule', 'Read the exact source-bound commercial schedule from a selected saved Installation edition. Preserve every original milestone amount, currency precision, source identity and phase check. Review scheduleSha256 before preparation.',
    {...ws,...caseSelection,...commercialSourceSelection}, commercialSourceRequired, true),
  tool('commercial_prepare', 'Save the complete reviewed milestone schedule against one verified native accounting customer. Map every original milestone once with invoice dates and explicit phase checks or retained commercial authorization. The server retains each original obligation and recoverable request. Correct an unbilled selection with a new preparation request before any native command is retained; previous selections remain visible as superseded.',
    {...ws,...caseSelection,...commercialSourceSelection,...originalRequest,expectedScheduleSha256:digest,
      endpointId:commercialIdentifier,customerId:{type:'string',pattern:'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'},
      milestones:{type:'array',items:commercialMilestoneMapping,minItems:1,maxItems:250},
      purchaseOrder:str(300),note:str(6000)},
    [...commercialSourceRequired,'requestId','actor','expectedScheduleSha256','endpointId','customerId','milestones']),
  tool('commercial_draft', 'Create or recover the selected original milestone invoice draft through the native receivables API. Its exact currency, amount, payer and terms come from the saved preparation. The server reuses the retained native request for the original obligation.',
    {...ws,caseId:id('operation'),billingId:commercialIdentifier,milestoneId:commercialIdentifier,actor:nonempty(300)},
    ['workspace','caseId','billingId','milestoneId','actor']),
  tool('commercial_preview', 'Review the current native invoice and original billing prerequisites. Read eligibility, the complete native document and issuePreviewSha256 before explicit issue; a retained issue intent reopens its original review.',
    {...ws,caseId:id('operation'),billingId:commercialIdentifier,milestoneId:commercialIdentifier},
    ['workspace','caseId','billingId','milestoneId'], true),
  tool('commercial_issue', 'Issue or recover the exact reviewed milestone invoice using issuePreviewSha256. The original receivables workspace assigns its number and financial state; the retained original command survives an interrupted reply.',
    {...ws,caseId:id('operation'),billingId:commercialIdentifier,milestoneId:commercialIdentifier,
      actor:nonempty(300),expectedIssuePreviewSha256:digest},
    ['workspace','caseId','billingId','milestoneId','actor','expectedIssuePreviewSha256']),
  tool('commercial_refresh', 'Refresh retained invoice, payment, allocation and credit observations from the original accounting workspace, then read the complete updated billing record.',
    {...ws,caseId:id('operation'),billingId:commercialIdentifier}, ['workspace','caseId','billingId']),
  ...grantCohortAdoptionTools,
  ...grantCohortDeliveryTools,
  tool('cohort_seed', 'Open the original case proposal, actual purchase and deployment inventory, and explicit review inputs for tranche 2 or 3. This creates no purchase, participant, award or saved evaluation.',
    {...ws,...caseSelection,tranche:{type:'integer',minimum:2,maximum:3}},['workspace','caseId','expectedVersion','tranche'],true),
  tool('cohort_preview', 'Evaluate the explicitly selected original cohort as of its retained cutoff. Preserve exact purchase windows, historical denominators, accountable operators, transaction proof, recovery timing and source findings. Inputs may be inline or selected from one retained original input.',
    {...ws,...caseSelection,...modelInput},['workspace','caseId','expectedVersion'],true),
  tool('cohort_prepare', 'Freeze the exact reviewed cohort, its original observation history, sources and unmet findings in the existing case journal. Preserve the original request ID, current case version and preview SHA. This does not record issuer acceptance or submit a form.',
    {...ws,...caseSelection,...modelInput,...originalRequest,expectedPreviewSha256:digest},
    ['workspace','caseId','expectedVersion','requestId','actor','expectedPreviewSha256']),
  tool('implementation_source', 'Read one retained original SF74 implementation source through the maintained producer at the explicit cutoff. Preserve complete tasks, technical and customer decisions, measurements, original files and source identities. This creates no review or acceptance.',
    {...ws,...caseSelection,sourceId:id('source'),asOfAt:implementationCutoff},
    ['workspace','caseId','expectedVersion','sourceId'],true),
  tool('implementation_preview', 'Preview an explicit implementation evidence selection and its links to original work, deployments, purchases, outcomes and exact installation editions. The original producer determines observation meaning; unresolved and negative findings remain visible. Inputs may be inline or selected from one retained original input.',
    {...ws,...caseSelection,...modelInput},['workspace','caseId','expectedVersion'],true),
  tool('implementation_prepare', 'Freeze the reviewed implementation observations, complete original source and explicit case links under the same case transaction. Preserve the original request ID and preview SHA. Technical acceptance, customer acceptance and issuer acceptance stay separate recorded facts.',
    {...ws,...caseSelection,...modelInput,...originalRequest,expectedPreviewSha256:digest},
    ['workspace','caseId','expectedVersion','requestId','actor','expectedPreviewSha256']),
  tool('completion', 'Read payment-based 90-calendar-day completion clocks, original and confirmed deadlines, current recorded form outcomes, and complete original deliverable assignments. The selected calendar date does not reconstruct historical issuer decisions.',
    {...ws,caseId:id('operation'),asOfDate:supportDate},['workspace','caseId'],true),
  tool('delivery_agenda', 'Read one complete delivery agenda over explicitly selected existing cases in this original workspace. Every row retains its own case identity, mode, version and native calendar source. asOfDate evaluates current retained records. A supplied expectedVersions map must cover exactly the selected cases; one changed case rejects the complete selection. Export all selected rows through merchant_grant_export with kind delivery-agenda and the returned complete selection.',
    {...ws,caseIds:deliveryAgendaCases,asOfDate:supportDate,expectedVersions:deliveryAgendaVersions},
    ['workspace','caseIds'],true),
  tool('delivery_calendar', 'Read the complete dated grant agenda, original payment-derived completion deadlines, issuer-confirmed extensions, saved deliverables and submitted forms. Native dates keep their original meaning; asOfDate evaluates current retained records. Export the same case as ICS, CSV or JSON through merchant_grant_export.',
    {...ws,caseId:id('operation'),asOfDate:supportDate,expectedVersion:{type:'integer',minimum:1,maximum:10000000}},
    ['workspace','caseId'],true),
  tool('completion_seed', 'Open the original complete deliverable assignment input for tranche 1, 2 or 3 against the current case. Retain every original work package, its award dates and linked saved assignments.',
    {...ws,...caseSelection,tranche:{type:'integer',minimum:1,maximum:3}},['workspace','caseId','expectedVersion','tranche'],true),
  tool('completion_save', 'Save the complete original tranche assignments through the case transaction. Supply inputs inline or one exact retained input object; inputPointer can select /inputs from the original seed. Preserve the original request ID after an interrupted response.',
    {...ws,...caseSelection,...modelInput,...originalRequest},['workspace','caseId','expectedVersion','requestId','actor']),
  tool('completion_preview', 'Preview a completion form from one original received payment, the actual completed assignments and a selected calendar date. Retain its complete source and preview SHA before preparing.',
    {...ws,...caseSelection,receiptId:id('cash'),asOfDate:supportDate,summary:str(20000),cohortReviewIds,implementationReviewIds},
    ['workspace','caseId','expectedVersion','receiptId','summary'],true),
  tool('completion_prepare', 'Freeze the reviewed completion form and complete original business source using the current case version and exact preview SHA. This prepares files in the grant case.',
    {...ws,...caseSelection,...originalRequest,receiptId:id('cash'),asOfDate:supportDate,summary:str(20000),expectedPreviewSha256:digest,cohortReviewIds,implementationReviewIds},
    ['workspace','caseId','expectedVersion','requestId','actor','receiptId','asOfDate','summary','expectedPreviewSha256']),
  tool('completion_extension', 'Record an issuer-confirmed later completion deadline against the original received payment, retaining the original 90-day deadline and confirmation source. confirmationNote is the native confirmation note; note records the case operation.',
    {...ws,...caseSelection,...originalRequest,receiptId:id('cash'),confirmedOn:supportDate,deadlineOn:supportDate,
      reference:nonempty(4000),sourceIds:{type:'array',items:id('source'),uniqueItems:true,maxItems:200},confirmationNote:str(12000)},
    ['workspace','caseId','expectedVersion','requestId','actor','receiptId','confirmedOn','deadlineOn','reference']),
  tool('completion_submit', 'Record the actual original completion-form receipt against its frozen preparation and business SHA. Retain the submission date, reference and sources, with the deadline applicable on that date.',
    {...ws,...caseSelection,...originalRequest,reviewId:id('review'),expectedReviewSha256:digest,
      submittedOn:supportDate,formReference:nonempty(4000),sourceIds:{type:'array',items:id('source'),uniqueItems:true,maxItems:200},sourceNote:str(12000)},
    ['workspace','caseId','expectedVersion','requestId','actor','reviewId','expectedReviewSha256','submittedOn','formReference']),
  tool('completion_decision', 'Retain the issuer outcome on the original submitted completion form, with its actual decision date and source reference. Prior form receipts, preparations and case events remain in the same case.',
    {...ws,...caseSelection,...originalRequest,outcomeId:id('outcome'),state:{enum:['ACCEPTED','CHANGES_REQUESTED','WITHDRAWN']},
      date:supportDate,sourceIds:{type:'array',items:id('source'),uniqueItems:true,maxItems:200},sourceNote:nonempty(12000)},
    ['workspace','caseId','expectedVersion','requestId','actor','outcomeId','state','date','sourceNote']),
  tool('settlements', 'List the original merchant settlement reviews and immutable correction editions retained in this Operations case.',
    {...ws,caseId:id('operation')},['workspace','caseId'],true),
  tool('settlement', 'Reopen a complete original settlement review, every original source row, effective reviewed attribution, current immutable cash records and correction history.',
    {...ws,caseId:id('operation'),reviewId:id('settlement')},['workspace','caseId','reviewId'],true),
  tool('settlement_preview', 'Inspect an original merchant accounting or period-close archive and its retained transfer proofs. Add both name and selections to review complete cash effects, exact native units, valuation, existing-cash links and delivery attribution. Retain the full selected preview hash for receiving.',
    {...ws,...caseSelection,...originalInput,filename:nonempty(240),name:nonempty(300),selections:settlementSelections},
    ['workspace','caseId','expectedVersion','input','expectedInputSha256','filename'],true,settlementPreviewRules),
  tool('settlement_receive', 'Save the complete reviewed settlement attribution in the original case transaction. Preserve the exact archive, selected rows, unit and valuation sources, cash identity, current case version, reviewed preview hash and original request. The original source and every correction travel in the complete case export.',
    {...ws,...caseSelection,...originalInput,...originalRequest,filename:nonempty(240),name:nonempty(300),
      selections:settlementSelections,expectedPreviewSha256:digest},
    ['workspace','caseId','expectedVersion','input','expectedInputSha256','filename','name','selections','expectedPreviewSha256','requestId','actor']),
  tool('settlement_correction_preview', 'Review a correction against the selected saved original row and expected cash identity. Link an existing replacement cash record across source editions, void-and-replace or void the current observation, or update work/deployment attribution. The original transfer and cash history remain readable.',
    {...ws,...caseSelection,...settlementCorrection},['workspace','caseId','expectedVersion',...settlementCorrectionRequired],true,settlementCorrectionRules),
  tool('settlement_correct', 'Apply the exact reviewed original settlement correction in one case transaction. Keep the previous immutable review and cash record, the original request ID and the preview hash for this complete correction.',
    {...ws,...caseSelection,...originalRequest,...settlementCorrection,expectedPreviewSha256:digest},
    ['workspace','caseId','expectedVersion',...settlementCorrectionRequired,'expectedPreviewSha256','requestId','actor'],false,settlementCorrectionRules),
  tool('support_preview', 'Review the complete original SF74 support handoff against the current case without saving. Keep its exact filename and whole-file SHA; the native result retains source/reader identities, full report and HTML, deployments and previewSha256.',
    {...ws, ...caseSelection, ...originalInput, filename:nonempty(240)},
    ['workspace','caseId','expectedVersion','input','expectedInputSha256','filename'], true),
  tool('support_receive', 'Receive the exact reviewed support file and rendered report through the original case transaction. Choose one existing deploymentId without replacement fields, or a new deployment. Preserve filename, reviewed preview SHA, current version and request ID for recovery.',
    {...ws, ...caseSelection, ...originalInput, ...originalRequest, filename:nonempty(240),
      expectedPreviewSha256:digest, deploymentId:{anyOf:[id('deployment'),{type:'null'}]},
      deployment:{anyOf:[supportDeployment,...emptyDeployment.anyOf]}},
    ['workspace','caseId','expectedVersion','input','expectedInputSha256','filename',
      'expectedPreviewSha256','requestId','actor'], false, supportSelection),
  tool('buyer_preview', 'Review original SF88 Inbox handoff or Node accounting-export bytes against the current Operations case. Retain exact source/reader identity, original jobs, native outcome/output coverage, current deployment/purchase matches and preview SHA. Unpaid Node observations have purchase:null and no embedded response body. This invokes only the original saved-source reader.',
    {...ws, ...caseSelection, ...originalInput, filename:nonempty(240)},
    ['workspace','caseId','expectedVersion','input','expectedInputSha256','filename'], true),
  tool('buyer_receive', 'Receive explicitly selected original buyer source through the existing case transaction. Match the original deployment and any purchase; use null purchaseId for an unpaid Node observation or a new original paid purchase. Unpaid observations add no purchase or financial count. Preserve exact source bytes, filename, preview SHA, current version, participant attribution and request ID. Complete case export retains original source editions, native reviews and source bindings.',
    {...ws, ...caseSelection, ...originalInput, ...originalRequest, filename:nonempty(240),
      expectedPreviewSha256:digest, deploymentId:{anyOf:[id('deployment'),{type:'null'}]},
      deployment:{anyOf:[buyerDeployment,...emptyDeployment.anyOf]}, selections:buyerJobs},
    ['workspace','caseId','expectedVersion','input','expectedInputSha256','filename',
      'expectedPreviewSha256','requestId','actor','selections'], false, buyerSelection),
  tool('source_attach', 'Attach exact original bytes through source.add, retaining filename, MIME, URL, observation date and native content hash.',
    {...ws, ...caseSelection, ...originalInput, ...originalRequest, filename:nonempty(240), kind:nonempty(80),
      mediaType:nonempty(200), sourceUrl:str(2000), observedAt:str(100)},
    ['workspace','caseId','expectedVersion','input','expectedInputSha256','requestId','actor','filename','kind','mediaType']),
  tool('export', 'Work-billing exports select caseId and chargeId and retain the complete original case, hourly authorities, Work source bodies, native command history and linked accounting observations. Expense-billing exports select caseId and chargeId and retain the complete original case, reviewed expense source bytes, native command history and linked current accounting observations. Delivery risk-comparison exports require caseId, beforeReviewId, beforeReviewSha256, afterReviewId, afterReviewSha256 and expectedComparisonSha256 from the complete native read. risk-comparison is the full case ZIP and additionally requires current expectedVersion. risk-comparison-json/report/risks/actions/context return complete comparison JSON, HTML or CSV and reject expectedVersion. The original native comparison digest is authoritative. Delivery risk-register exports select caseId and reviewId, retaining the complete original case, all saved register editions, selected JSON, CSV and offline HTML. Plan ZIPs accept an exact saved revision; omission selects the current original plan. Cost-funding exports select caseId, revision, expectedVersion and expectedReportSha256; they include the full period report, every allocation and remainder, source/assignment changes, original native case and all funding history. Task-outcomes exports retain the complete operating case, all comparison revisions, offline HTML and complete effort/cost CSVs; select caseId, comparisonId, revision and current expectedVersion. For plan-comparison and its report/changes/impact/daily variants, select planId, fromRevision, toRevision, optional toPlanId and the returned expectedComparisonSha256. Retain the complete original plan, case, forecast, portfolio, cohort, implementation review and its exact original file, Contributor Engagements review with complete case and source handover, completion preparation, selected installation handover, complete returned receiving case selected by reviewId, complete dated delivery queue, grant delivery calendar, the full explicitly selected multi-case delivery agenda and saved customer-use calendar in ICS/CSV/JSON, commercial customer account, selected budget performance report, complete supplier account, complete dated cash account with correction sources and whole case, full account reconciliation with saved original editions and native case, original settlement review and its source archive, source, scenario or dated CSV export for verified byte paging and host download.',
    {...ws, kind:{enum:['plan','plan-comparison','plan-comparison-report','plan-comparison-changes','plan-comparison-impact','plan-comparison-daily','case','forecast','portfolio','source','scenario','daily-csv','costs-csv','completion','cohort','installation','installation-return','implementation','implementation-original','delivery-queue','settlement','delivery-calendar','delivery-agenda','customer-use-calendar','performance','supplier-account','cash-account','account-reconciliation','commercial','commercial-change','expense-billing','work-billing','engagement','task-outcomes','cost-funding','risk-register','risk-comparison','risk-comparison-json','risk-comparison-report','risk-comparison-risks','risk-comparison-actions','risk-comparison-context']},
      planId:id('plan'), caseId:id('operation'), forecastId:id('forecast'), portfolioId:id('portfolio'), sourceId:id('source'), reviewId:{anyOf:[id('review'),id('settlement')]},
      beforeReviewId:id('review'),beforeReviewSha256:digest,afterReviewId:id('review'),afterReviewSha256:digest,
      fromRevision:planComparisonRevision,toRevision:planComparisonRevision,toPlanId:id('plan'),expectedComparisonSha256:digest,
      installationId:id('installation'),comparisonId:id('task-outcomes'),billingId:commercialIdentifier,changeId:commercialIdentifier,chargeId:{anyOf:[id('expense-billing'),id('work-billing')]},revision:planComparisonRevision,sha256:digest,asOfDate:supportDate,
      installationRefs:customerUseInstallationRefs,caseIds:deliveryAgendaCases,expectedVersions:deliveryAgendaVersions,
      format:{enum:['ics','csv','json'],description:'Grant delivery calendar and multi-case delivery agenda default to ICS; customer-use calendar defaults to JSON.'},
      reconciliationId:id('reconciliation'),contributorId:id('person'),network:str(200),currency:str(40),asset:str(500),startDate:supportDate,endDate:supportDate,expectedVersion:{type:'integer',minimum:1,maximum:10000000},expectedReportSha256:digest},
    ['workspace','kind'], true, {allOf:[
      {if:{properties:{kind:{const:'expense-billing'}},required:['kind']},then:{required:['caseId','chargeId'],properties:{chargeId:id('expense-billing')}}},
      {if:{properties:{kind:{const:'work-billing'}},required:['kind']},then:{required:['caseId','chargeId'],properties:{chargeId:id('work-billing')}}},
      {if:{properties:{kind:{enum:["risk-comparison","risk-comparison-json","risk-comparison-report","risk-comparison-risks","risk-comparison-actions","risk-comparison-context"]}},required:['kind']},
       then:{required:['caseId','beforeReviewId','beforeReviewSha256','afterReviewId','afterReviewSha256','expectedComparisonSha256']}},
      {if:{properties:{kind:{const:'risk-comparison'}},required:['kind']},then:{required:['expectedVersion']}},
      {if:{properties:{kind:{enum:["risk-comparison-json","risk-comparison-report","risk-comparison-risks","risk-comparison-actions","risk-comparison-context"]}},required:['kind']},
       then:{not:{required:['expectedVersion']}}}
    ]}),
  tool('snapshot', 'Inspect an exact retained JSON snapshot or one original JSON pointer. Large values remain available through rows and the complete file.',
    {...ws, snapshotId:{type:'string'}, expectedSha256:digest, pointer:str(4000)},
    ['workspace','snapshotId','expectedSha256'], true),
  tool('rows', 'Read original array rows from an immutable snapshot and JSON pointer. The response includes exact counts and explicit nextOffset; an oversized row points to its complete file instead of disappearing.',
    {...ws, snapshotId:{type:'string'}, expectedSha256:digest, pointer:str(4000),
      offset:{type:'integer', minimum:0}, limit:{type:'integer', minimum:1, maximum:200}},
    ['workspace','snapshotId','expectedSha256','pointer'], true),
  tool('file_read', 'Read exact original retained bytes in base64 chunks through the shared RetainedFileReads implementation. Repeat the same snapshot and SHA for every continuation.',
    {...ws, snapshotId:{type:'string'}, expectedSha256:digest, readId:nonempty(64),
      offset:{type:'integer', minimum:0}, limit:{type:'integer', minimum:1, maximum:CHUNK}},
    ['workspace','snapshotId','expectedSha256'], true),
  tool('file_release', 'Release only the selected grant file-reader snapshot; the complete retained original file remains available.',
    {...ws, snapshotId:{type:'string'}, readId:nonempty(64)}, ['workspace','snapshotId','readId'], true),
  tool('inputs', 'List declared host input aliases, or inspect exact current file size and SHA256 for one alias.',
    {...ws, input:alias}, ['workspace'], true),
  tool('receive_begin', 'Declare one exact input file and stable transfer request ID. Bytes arrive in fixed 65,536-byte parts and remain separate from original business records until explicit native import.',
    {...ws, requestId:nonempty(180), filename:nonempty(240), bytes:{type:'integer',minimum:0,maximum:GRANT_MAX_BUNDLE_BYTES},
      sha256:digest, mediaType:nonempty(200)}, ['workspace','requestId','filename','bytes','sha256']),
  tool('receive_chunk', 'Retain the exact next or repeated original input part. A conflicting part is rejected; completed files support identical part replay.',
    {...ws, transferId:{type:'string'}, offset:{type:'integer',minimum:0}, data:{type:'string',maxLength:Math.ceil(CHUNK / 3) * 4}},
    ['workspace','transferId','offset','data']),
  tool('receive_status', 'Read complete/missing input offsets from the original retained transfer without making a new import.',
    {...ws, transferId:{type:'string'}}, ['workspace','transferId'], true),
  tool('receive_commit', 'Verify every declared original input byte and whole-file SHA256 before making the input available to native import. Same transfer commit reopens the identical result.',
    {...ws, transferId:{type:'string'}}, ['workspace','transferId']),
];

