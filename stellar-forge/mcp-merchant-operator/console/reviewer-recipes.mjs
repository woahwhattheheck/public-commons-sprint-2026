// MIT. Complete original reviewer recipes using the maintained saved-workflow schema.
import {sealWorkflowRecipe} from './workflow-recipes.mjs';
import {fail} from './records.mjs';
const prefix='merchant_grant_reviewer_';
const placeholder='00000000-0000-4000-8000-000000000000';
const hash='0'.repeat(64);
const input=(pointer,label,type,description)=>({pointer,label,type,required:true,description});
const binding=(target,pointer)=>({target,from:'inputs',pointer});
const earlier=(target,stepId,pointer)=>({target,from:'step',stepId,pointer});
export function buildReviewerCustomerRecipe({definitions,mode='deliver'}={}){
  if(!['deliver','receive'].includes(mode))throw fail('CONSOLE_REVIEWER_RECIPE','Choose the complete delivery or receiving recipe.',400);
  const get=name=>{
    const definition=definitions.get(prefix+name);
    if(!definition)throw fail('CONSOLE_REVIEWER_RECIPE','This host does not advertise '+prefix+name+'.',400);
    return JSON.parse(JSON.stringify(definition));
  };
  const steps=[];
  function step(id,name,action,args,bindings=[],expect=[],pauseAfter=false){
    steps.push({id,name,tool:prefix+action,definition:get(action),arguments:args,bindings,expect,pauseAfter});
  }
  const retained=[{pointer:'/retention/state',equals:'COMPLETE'}];
  const inputs=[
    input('/destinationWorkspace','Receiving workspace','string','An independently configured original workbench alias.'),
    input('/title','Receiving title','string','The name retained with the original receiving review.'),
    input('/actions','Original action IDs','object','Keep UUIDs for review, receive, receivingOpen and receivingClose throughout this run; delivery also uses sourceOpen and sourceExport.')
  ];
  if(mode==='deliver'){
    inputs.unshift(
      input('/sourceWorkspace','Source workspace','string','The original workbench holding the received purchase.'),
      input('/selectionId','Received selection','string','The original received selection UUID.'),
      input('/selectionRevision','Received revision','integer','Its current inspected native selection revision.'),
      input('/quoteId','Saved quote','string','The exact original quote whose complete result will be retained.')
    );
    step('source-open','Connect original source','workbench_open',{workspace:'source'},
      [binding('/workspace','/sourceWorkspace')]);
    step('source-selection','Inspect original received packet','selection',{workspace:'source',selectionId:placeholder},
      [binding('/workspace','/sourceWorkspace'),binding('/selectionId','/selectionId')],retained,true);
    step('source-buyer','Open original saved Buyer','buyer_open',{workspace:'source',selectionId:placeholder,expectedRevision:2,requestId:placeholder},
      [binding('/workspace','/sourceWorkspace'),binding('/selectionId','/selectionId'),binding('/expectedRevision','/selectionRevision'),binding('/requestId','/actions/sourceOpen')],
      [...retained,{pointer:'/value/buyer/active',equals:true}]);
    step('source-history','Read original purchase history','buyer_read',{workspace:'source',tool:'bazaar_history',arguments:{}},
      [binding('/workspace','/sourceWorkspace')],retained);
    step('source-result','Retain complete saved result','buyer_result',{workspace:'source',quoteId:'original-quote'},
      [binding('/workspace','/sourceWorkspace'),binding('/quoteId','/quoteId')],retained,true);
    step('source-export','Close Buyer and export original packet','export',
      {workspace:'source',selectionId:placeholder,expectedRevision:2,requestId:placeholder},
      [binding('/workspace','/sourceWorkspace'),binding('/selectionId','/selectionId'),binding('/expectedRevision','/selectionRevision'),binding('/requestId','/actions/sourceExport')],
      [...retained,{pointer:'/kind',equals:'reviewer-packet'}]);
    step('source-manifest','Inspect complete receiving manifest','manifest',{workspace:'source',exportId:hash},
      [binding('/workspace','/sourceWorkspace'),earlier('/exportId','source-export','/exportId')],
      [{pointer:'/state',equals:'MANIFEST_RETAINED'}],true);
  }else{
    inputs.unshift(
      input('/sourceWorkspace','Packet source workspace','string','The configured workbench alias retaining the reviewed export.'),
      input('/exportId','Original packet export','string','The exact reviewer-packet export ID.'),
      input('/expectedManifestSha256','Original manifest','string','The complete manifest SHA-256 shown by the original source.')
    );
  }
  step('receiver-open','Connect receiving workbench','workbench_open',{workspace:'receiver'},
    [binding('/workspace','/destinationWorkspace')]);
  step('receiver-review','Review the same original exported packet','review_export',
    {workspace:'receiver',sourceWorkspace:'source',exportId:hash,expectedManifestSha256:hash,title:'Original receiving',requestId:placeholder},
    [binding('/workspace','/destinationWorkspace'),binding('/sourceWorkspace','/sourceWorkspace'),
      ...(mode==='deliver'?[earlier('/exportId','source-export','/exportId'),earlier('/expectedManifestSha256','source-export','/manifestSha256')]:
        [binding('/exportId','/exportId'),binding('/expectedManifestSha256','/expectedManifestSha256')]),
      binding('/title','/title'),binding('/requestId','/actions/review')],retained,true);
  step('receiver-receive','Receive original stores and results','receive',
    {workspace:'receiver',selectionId:placeholder,expectedRevision:1,requestId:placeholder},
    [binding('/workspace','/destinationWorkspace'),binding('/selectionId','/actions/review'),binding('/requestId','/actions/receive')],retained);
  step('receiver-buyer','Open received original Buyer','buyer_open',
    {workspace:'receiver',selectionId:placeholder,expectedRevision:2,requestId:placeholder},
    [binding('/workspace','/destinationWorkspace'),binding('/selectionId','/actions/review'),binding('/requestId','/actions/receivingOpen')],
    [...retained,{pointer:'/value/buyer/active',equals:true}]);
  step('receiver-history','Inspect received purchase history','buyer_read',
    {workspace:'receiver',tool:'bazaar_history',arguments:{}},[binding('/workspace','/destinationWorkspace')],retained,true);
  step('receiver-close','Drain receiving Buyer and retain workspace','buyer_close',
    {workspace:'receiver',requestId:placeholder},
    [binding('/workspace','/destinationWorkspace'),binding('/requestId','/actions/receivingClose')],retained);
  return sealWorkflowRecipe({
    schema:'stellar-forge.merchant-workflow-recipe.v1',source:null,
    name:mode==='deliver'?'Original reviewer customer delivery':'Receive an original reviewer packet',
    description:'Use the configured original reviewer workbenches and their saved purchase. Pauses expose source review, complete result, closed export and receiving history. Keep each original action UUID after a lost response. Customer file receiving uses the returned manifest in the same Console; the original packet can also be downloaded for another independently configured host. This recipe makes no purchase and connects no signer.',
    inputs,steps
  });
}
