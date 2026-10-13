// MIT. Customer handovers retain original judgments and use the existing workspace writer.
const string={type:"string",minLength:1},hash={type:"string",pattern:"^[a-f0-9]{64}$"};
const list={type:"array",items:string,uniqueItems:true},integer={type:"integer",minimum:0};
const document={type:"object",additionalProperties:false,required:["schema","title","customer","periodStart","periodEnd","scope","recordedBy","assessmentIds","evaluationIds","comparisonIds","resultIds"],properties:{
 schema:{const:"commons.openlineage.customer-review-document.v1"},title:string,customer:string,periodStart:{type:"string",format:"date"},periodEnd:{type:"string",format:"date"},
 scope:string,narrative:{type:"string"},recordedBy:string,assessmentIds:list,evaluationIds:list,comparisonIds:list,resultIds:list,
 supersedes:{anyOf:[{type:"null"},{type:"object",additionalProperties:false,required:["id","contentSha256"],properties:{id:string,contentSha256:hash}}]}}};
const definitions=[
 ["customer-review.overview","Read lightweight original assessment, evaluation, comparison, result and saved customer-review choices.",{},[],false],
 ["customer-review.original","Read one complete selected original record under its exact checksum.",{kind:{enum:["assessment","evaluation","comparison","result"]},id:string,expectedSha256:hash},["kind","id","expectedSha256"],false],
 ["customer-review.preview","Preview the complete attributed customer handover and exact original source/decision histories at the current committed revision.",{document},["document"],false],
 ["customer-review.save","Save the exact complete customer review as an immutable edition through the original operation/CAS writer; no evaluator or decision is changed.",
  {operationId:string,expectedRevision:integer,document,expectedPreviewSha256:hash},["operationId","expectedRevision","document","expectedPreviewSha256"],true],
 ["customer-review.get","Read one complete immutable customer-review edition, including its frozen original judgments and source references.",{id:string},["id"],false],
 ["customer-review.report","Download a saved customer review as complete JSON, spreadsheet-safe CSV or printable HTML; later decisions cannot change it.",{id:string,format:{enum:["json","csv","html"]}},["id"],false]
];
export const customerReviewTools=definitions.map(([action,description,properties,required,write])=>({
 name:"lineage_"+action.replaceAll(".","_").replaceAll("-","_"),description,
 inputSchema:{type:"object",properties,required,additionalProperties:false},
 annotations:{readOnlyHint:!write,destructiveHint:false,idempotentHint:true,openWorldHint:false},action
}));
