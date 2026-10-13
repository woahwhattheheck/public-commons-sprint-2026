// MIT. Original workspace operations for complete recipient review returns.
const string={type:"string",minLength:1}, optional={type:"string"}, integer={type:"integer",minimum:0};
const hash={type:"string",pattern:"^[a-f0-9]{64}$"}, mutation={operationId:string,expectedRevision:integer,expectedPreviewSha256:hash};
const recipient={type:"object",properties:{name:string,organisation:optional,reference:optional},required:["name"],additionalProperties:false};
const preparation={reviewId:string,recipient,instructions:optional,requestedBy:string};
const returned={requestId:string,originalText:{type:"string",minLength:1,maxLength:8000000}};
const definitions=[
 ["review-return.overview","Read original saved review choices, immutable recipient requests and complete returned-response history.",{},[],false],
 ["review-return.operation.get","Read one original operation receipt, or its absence at the current committed revision.",{operationId:string,expectedRevision:integer},["operationId","expectedRevision"],false],
 ["review-return.request.preview","Open the complete saved customer review, selected recipient, instructions and exact source-bound item list before saving.",preparation,["reviewId","recipient","requestedBy"],false],
 ["review-return.request.save","Save exactly the reviewed immutable recipient request through the original workspace revision and operation journal.",
  {...preparation,...mutation},["reviewId","recipient","requestedBy","operationId","expectedRevision","expectedPreviewSha256"],true],
 ["review-return.response.preview","Read the complete returned JSON, verify every original source item and display attributed responses before adoption.",returned,["requestId","originalText"],false],
 ["review-return.response.save","Retain exactly the reviewed complete return, its original text and explicit receiving operator note without altering source observations or decisions.",
  {...returned,...mutation,receivedBy:string,operatorNote:optional},["requestId","originalText","receivedBy","operationId","expectedRevision","expectedPreviewSha256"],true],
 ["review-return.get","Open one complete saved recipient request and all of its immutable returned responses.",{requestId:string},["requestId"],false],
 ["review-return.report","Download the complete editable recipient review or complete JSON/printable returned-response history.",
  {requestId:string,format:{enum:["editable","json","html"]}},["requestId"],false]
];
export const reviewReturnTools=definitions.map(([action,description,properties,required,write])=>({
 name:"lineage_"+action.replaceAll(".","_").replaceAll("-","_"),description,
 inputSchema:{type:"object",properties,required,additionalProperties:false},
 annotations:{readOnlyHint:!write,destructiveHint:false,idempotentHint:true,openWorldHint:false},action
}));
