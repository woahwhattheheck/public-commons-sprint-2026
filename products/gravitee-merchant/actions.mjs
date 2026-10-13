// SPDX-License-Identifier: MIT
const string={type:'string'},uuid={type:'string',pattern:'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$'},id={type:'string',pattern:'^[a-f0-9]{24}$'},sha={type:'string',pattern:'^[a-f0-9]{64}$'},
  revision={type:'integer',minimum:1},object={type:'object'},bool={type:'boolean'},reference={type:'object',properties:{sha256:sha,bytes:{type:'integer',minimum:0}},required:['sha256','bytes'],additionalProperties:false};
const definitions={
  view:['Read the native workspace, configured target identities and current operating counts.',{},[],false],
  list:['Read every saved record page, including its nextOffset.',{kind:string,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:500}},[],false],
  get:['Read the complete original record revision and optional original journal.',{kind:string,id,revision,includeJournal:bool},['kind','id'],false],
  readObject:['Read the complete retained source or response object by its original hash and byte count.',{reference},['reference'],false],
  readSource:['Read all original source files, normalized contract, route inventory and behavior mappings.',{id,revision},['id'],false],
  readDraft:['Read the complete native draft, source mappings and current commissioning review hash.',{id,revision},['id'],false],
  readCapture:['Read the complete saved inventory, native API definitions and capture journal.',{id,revision},['id'],false],
  saveConnection:['Save an intended Management API target with environment-variable credentials and its selected source contract.',{requestId:uuid,connection:object},['requestId','connection'],true],
  importSource:['Import the complete original OpenAPI, Swagger, RAML or Gravitee bundle with all supporting files.',{requestId:uuid,entry:string,label:string,files:{type:'array',minItems:1,items:{type:'object',properties:{path:string,content:string,base64:string,mediaType:string,sha256:sha},required:['path'],additionalProperties:false}}},['requestId','entry','files'],true],
  saveDraft:['Save a complete native definition and every source behavior disposition as a retained revision.',{requestId:uuid,sourceId:id,sourceRevision:revision,id,expectedRevision:{type:'integer',minimum:0},mapping:object,draft:object},['requestId','sourceId'],true],
  capture:['Capture all inventory pages and the selected APIs, all plan statuses, documentation, members, metadata and events.',{requestId:uuid,connectionId:id,label:string,apiIds:{type:'array',items:string,uniqueItems:true}},['requestId','connectionId'],true],
  prepareOperation:['Prepare the exact native operation and its current target, including definition-import plan effects.',{requestId:uuid,connectionId:id,operationId:string,parameters:object,label:string},['requestId','connectionId','operationId'],true],
  refreshOperation:['Refresh the original unsent request against the current provider configuration.',{id},['id'],true],
  executeOperation:['Execute the original prepared request and retain its complete response before reporting the result.',{id,planSha256:sha},['id','planSha256'],true],
  reconcileOperation:['Read the original request result and current native API; match observable changes after an interrupted response.',{id,apiId:string,planId:string},['id'],true],
  commission:['Run the selected complete native draft through its explicit plan, review, publication, start and deployment steps.',{requestId:uuid,connectionId:id,draftId:id,draftRevision:revision,mappingSha256:sha,label:string,publishPlans:bool,publishAPI:bool,start:bool,deploy:bool,review:object,deploymentLabel:{type:'string',maxLength:32},probes:{type:'array',items:object}},['requestId','connectionId','draftId','mappingSha256'],true],
  probe:['Record an actual GET, HEAD or OPTIONS response from a configured gateway using declared credential variable names.',{requestId:uuid,connectionId:id,probe:object},['requestId','connectionId','probe'],true],
  addNote:['Save a substantive operating note alongside its source or native request.',{requestId:uuid,label:string,note:string,record:object},['requestId','note'],true],
  exportHandover:['Save a complete editable receiving package with original records, source files, responses and application source.',{requestId:uuid,label:string,includeSoftware:bool},['requestId'],true],
};
export const GRAVITEE_WORKSPACE_ACTIONS=Object.freeze(Object.fromEntries(Object.entries(definitions).map(([method,[description,properties,required,write]])=>[method,Object.freeze({
  description,write,inputSchema:{type:'object',properties,required,additionalProperties:false}
})])));
export function validateGraviteeAction(method,input){
  const definition=Object.hasOwn(GRAVITEE_WORKSPACE_ACTIONS,method)?GRAVITEE_WORKSPACE_ACTIONS[method]:null;
  if(!definition||input===null||typeof input!=='object'||Array.isArray(input))throw Object.assign(new TypeError('Unknown Gravitee workspace operation or invalid input.'),{code:'GRAVITEE_ACTION_INVALID'});
  const {properties,required}=definition.inputSchema;
  if(Object.keys(input).some(key=>!Object.hasOwn(properties,key))||required.some(key=>input[key]===undefined))
    throw Object.assign(new TypeError('Use the declared fields for '+method+'.'),{code:'GRAVITEE_ACTION_INPUT_INVALID'});
  for(const[key,value]of Object.entries(input)){
    if(value===undefined)continue;const rule=properties[key];
    const type=Array.isArray(value)?'array':value===null?'null':Number.isInteger(value)&&rule.type==='integer'?'integer':typeof value;
    if(rule.type&&type!==rule.type||rule.pattern&&(!new RegExp(rule.pattern).test(value))||rule.minimum!==undefined&&value<rule.minimum||rule.maximum!==undefined&&value>rule.maximum||rule.maxLength!==undefined&&value.length>rule.maxLength)
      throw Object.assign(new TypeError('Invalid '+key+' for '+method+'.'),{code:'GRAVITEE_ACTION_INPUT_INVALID'});
  }
  return definition;
}
