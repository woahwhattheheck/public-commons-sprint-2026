// MIT. Multi-job policy commissioning uses the original action dispatcher.
const text = (maxLength = 8000) => ({type:"string",minLength:1,maxLength});
const nullable = value => ({anyOf:[value,{type:"null"}]});
const seconds = nullable({type:"integer",minimum:1,maximum:315360000});
const policy = {type:"object",additionalProperties:false,required:["id","title","jobKey","effectiveFrom"],properties:{
 id:nullable(text(240)),title:text(400),jobKey:text(4000),owner:{type:"string",maxLength:400},runbook:{type:"string",maxLength:4000},
 enabled:{type:"boolean"},effectiveFrom:text(100),maxCompletionAgeSeconds:seconds,maxDurationSeconds:seconds,
 failureWindowSeconds:{type:"integer",minimum:1,maximum:315360000},monitorFailures:{type:"boolean"}
}};
export const policyRolloutPlanSchema = {type:"object",additionalProperties:false,required:["schema","title","reason","rows"],properties:{
 schema:{const:"commons.openlineage.service-policy-plan.v1"},title:text(400),reason:text(8000),
 rows:{type:"array",minItems:1,maxItems:200,items:{type:"object",additionalProperties:false,required:["rowId","expectedVersion","policy"],properties:{
 rowId:{type:"string",pattern:"^[A-Za-z0-9_.:-]{1,120}$"},expectedVersion:nullable({type:"integer",minimum:1}),policy}}}
}};
const checksum={type:"string",pattern:"^[0-9a-f]{64}$"};
const definitions=[
 ["read","Read complete observed jobs, original policy versions and immutable rollout history.",{},[]],
 ["preview","Preview every policy change against exact selected job and policy versions, with the original event/source selection.",{plan:policyRolloutPlanSchema},["plan"]],
 ["apply","Apply the exact reviewed plan atomically through the original workspace journal. Retain this whole request and operation ID after an uncertain response.",{operationId:text(400),expectedRevision:{type:"integer",minimum:0},plan:policyRolloutPlanSchema,expectedPreviewSha256:checksum},["operationId","expectedRevision","plan","expectedPreviewSha256"]],
 ["get","Read one complete immutable rollout, original preview, original before/after policies and source selection.",{id:checksum},["id"]],
 ["report","Download one complete saved rollout as JSON, spreadsheet-safe CSV or printable HTML.",{id:checksum,format:{enum:["json","csv","html"]}},["id","format"]]
];
export const policyRolloutTools=definitions.map(([name,description,properties,required])=>({
 name:"lineage_service_policy_rollout_"+name,action:"service-policy-rollout."+name,description,
 inputSchema:{type:"object",properties,required,additionalProperties:false},
 annotations:{readOnlyHint:name!=="apply",destructiveHint:false,idempotentHint:true,openWorldHint:false}
}));
