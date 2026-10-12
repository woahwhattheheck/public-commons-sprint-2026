// MIT. Saved customer procedures over the original gRPC workspace and export store.
import {sealWorkflowRecipe} from './workflow-recipes.mjs';
import {fail} from './records.mjs';
const prefix='merchant_grpc_';
const uuid='00000000-0000-4000-8000-000000000000';
const sha='0'.repeat(64);
const input=(pointer,label,type,description)=>({pointer,label,type,required:true,description});
const binding=(target,pointer)=>({target,from:'inputs',pointer});
const earlier=(target,stepId,pointer)=>({target,from:'step',stepId,pointer});
const workspace=binding('/workspace','/workspace');
export function buildGrpcCustomerRecipe({definitions,mode='customer'}={}){
  if(!['customer','upgrade','health','attempt'].includes(mode))
    throw fail('CONSOLE_GRPC_RECIPE','Choose customer, upgrade, health or retained call delivery.',400);
  const steps=[],inputs=[input('/workspace','Original gRPC workspace','string','The configured original workspace retaining this selection.')];
  function step(id,name,action,args,bindings=[],pauseAfter=false,expect=[]){
    const definition=definitions.get(prefix+action);
    if(!definition)throw fail('CONSOLE_GRPC_RECIPE','This host does not advertise '+prefix+action+'.',400);
    steps.push({id,name,tool:prefix+action,definition:JSON.parse(JSON.stringify(definition)),
      arguments:args,bindings,expect,pauseAfter});
  }
  function manifest(id,exportStep,name){
    step(id,name,'export_manifest',{exportId:sha},[earlier('/exportId',exportStep,'/exportId')],true,
      [{pointer:'/state',equals:'MANIFEST_RETAINED'}]);
  }
  const status=id=>step(id,'Inspect current workspace selection','status',{workspace:'grpc'},[workspace]);
  status('workspace-before');
  if(mode==='customer'){
    inputs.push(input('/preparation','Retained merchant preparation','string','The original preparation UUID whose complete generated client will be delivered.'));
    step('customer-export','Retain all seven generated customer files','export',
      {workspace:'grpc',kind:'customer',preparation:uuid},[workspace,binding('/preparation','/preparation')]);
    manifest('customer-manifest','customer-export','Review the complete generated client for receiving');
    const revision=earlier('/revision','customer-export','/original/revision');
    step('revision-summary','Inspect the preparation’s exact source revision','revision',
      {workspace:'grpc',revision:sha,section:'summary'},[workspace,revision]);
    step('revision-source','Read the original connection and source metadata','revision',
      {workspace:'grpc',revision:sha,section:'source'},[workspace,revision]);
    step('revision-plan','Read the original merchant plan','revision',
      {workspace:'grpc',revision:sha,section:'plan'},[workspace,revision]);
    step('revision-export','Retain the complete captured protobuf closure and plan','export',
      {workspace:'grpc',kind:'revision',revision:sha},[workspace,revision]);
    manifest('revision-manifest','revision-export','Review the complete source revision for receiving');
  }else if(mode==='upgrade'){
    inputs.push(input('/operationId','Original contract review','string','The UUID of the existing immutable contract-upgrade review.'),
      input('/expectedReviewSha256','Reviewed contract comparison','string','The exact review SHA-256 selected before starting this procedure.'));
    const operation=binding('/operationId','/operationId');
    for(const section of ['summary','plan','source','full','adoption'])
      step('upgrade-'+section,({summary:'Inspect the reviewed contract change',plan:'Read the complete candidate plan',
        source:'Read original and candidate source',full:'Inspect the complete upgrade review',adoption:'Read its original adoption history'})[section],
      'upgrade_open',{workspace:'grpc',operationId:uuid,section},[workspace,operation],section==='full');
    step('upgrade-export','Retain the reviewed comparison and all original source files','upgrade_export',
      {workspace:'grpc',operationId:uuid,expectedReviewSha256:sha},
      [workspace,operation,binding('/expectedReviewSha256','/expectedReviewSha256')]);
    manifest('upgrade-manifest','upgrade-export','Review the complete four-file upgrade delivery');
  }else if(mode==='health'){
    inputs.push(input('/operationId','Original health observation','string','The UUID of the existing Check, List or Watch observation.'),
      input('/throughSequence','Last selected event','integer','The event page throughSequence that freezes this exact saved history.'),
      input('/expectedSnapshot','Selected event history','string','The event-page snapshot SHA-256, including the zero-event snapshot. Use the events page rather than the List services page.'));
    const operation=binding('/operationId','/operationId'),
      frozen=[workspace,operation,binding('/throughSequence','/throughSequence'),binding('/expectedSnapshot','/expectedSnapshot')];
    step('health-summary','Inspect the original observation','health_read',
      {workspace:'grpc',operationId:uuid,section:'summary'},[workspace,operation]);
    step('health-events','Review the selected frozen event prefix','health_read',
      {workspace:'grpc',operationId:uuid,section:'events',afterSequence:0,limit:250,throughSequence:0,expectedSnapshot:sha},frozen,true);
    step('health-export','Retain the complete selected service-health history','health_export',
      {workspace:'grpc',operationId:uuid,throughSequence:0,expectedSnapshot:sha},frozen);
    manifest('health-manifest','health-export','Review the complete health snapshot for receiving');
    step('health-current','Read current state of the same original observation','health_read',
      {workspace:'grpc',operationId:uuid,section:'summary'},[workspace,operation]);
  }else{
    inputs.push(input('/operationId','Original retained call','string','The UUID of the existing unary or streaming call. Its original request and received output remain authoritative.'));
    const operation=binding('/operationId','/operationId');
    step('attempt-read','Recover the saved original call outcome','attempt',
      {workspace:'grpc',operationId:uuid},[workspace,operation],true);
    step('attempt-export','Retain original attempt metadata and its complete stream when present','export',
      {workspace:'grpc',kind:'attempt',operationId:uuid},[workspace,operation]);
    manifest('attempt-manifest','attempt-export','Review every original attempt file for receiving');
  }
  status('workspace-after');
  return sealWorkflowRecipe({schema:'stellar-forge.merchant-workflow-recipe.v1',source:null,
    name:({customer:'gRPC customer and source delivery',upgrade:'gRPC contract-upgrade delivery',
      health:'gRPC service-health delivery',attempt:'gRPC retained-call delivery'})[mode],
    description:'Continue the original configured gRPC workspace and its existing immutable selection. At each manifest pause, use Customer files to receive the full verified export and download its archive with the original nested client paths. The saved workflow retains all inputs, original tool definitions and returns. Large source values point to complete retained files; paged previews retain their snapshot. Keep this workflow and the native operation IDs when returning after an interruption.',
    inputs,steps});
}
