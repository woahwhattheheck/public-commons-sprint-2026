// SPDX-License-Identifier: MIT
// The maintained SF43 tool's operations over one registered SF88 collection host.
const alias={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,63}$'};
const id={type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$'};
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const hexId={type:'string',pattern:'^[a-f0-9]{32}$'};
const requestId={type:'string',pattern:'^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'};
const intent={type:'string',minLength:1,maxLength:128};
const intents={type:'array',minItems:1,maxItems:500,uniqueItems:true,items:intent};
const page={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}};
const range={byteOffset:{type:'integer',minimum:0},maxBytes:{type:'integer',minimum:1,maximum:65536}};
const pin={id,expectedManifestSha256:hash};
const spec=(required,properties,description)=>({required,properties,description});
export const nativeCollectionOperations=Object.freeze({
  workspaces:spec([],page,'List the host-registered original collection services.'),
  sources:spec([],page,'List approved original request-file aliases and their exact retained hashes.'),
  buyers:spec([],page,'List the host-selected original buyer workspace aliases.'),
  collections:spec([],page,'Page the original collection list and exact grouped spending totals.'),
  preview:spec(['sources'],{sources:{type:'array',minItems:1,maxItems:500,uniqueItems:true,items:alias},...page},
    'Review the selected host-registered original request files. Saves the original preview for paging; does not queue or execute.'),
  review:spec(['reviewId','expectedPreviewSha256'],{reviewId:hexId,expectedPreviewSha256:hash,...page},
    'Page the same retained original preview. The native browser review remains valid for 15 minutes.'),
  create:spec(['id','name','reviewId','expectedPreviewSha256'],{
    id,name:{type:'string',minLength:1,maxLength:160},reviewId:hexId,expectedPreviewSha256:hash},
    'Create the reviewed collection under its stable ID. A repeated completed request returns that original collection.'),
  inspect:spec(['id'],{id,...page,runOffset:{type:'integer',minimum:0},runLimit:{type:'integer',minimum:1,maximum:100}},
    'Read original request, queue, saved-output and run history. Every total is an exact atomic-unit string.'),
  enqueue:spec(['id','expectedManifestSha256'],pin,
    'Enqueue or adopt the exact original intents. The original controller reconciles interrupted preparation.'),
  cancel:spec(['id','expectedManifestSha256','intentIds'],{...pin,intentIds:intents},
    'Cancel the selected original queued intents through the existing inbox.'),
  recover:spec(['id','expectedManifestSha256','intentIds'],{...pin,intentIds:intents},
    'Recover the selected original queue outcomes. It retains the original payment and delivery identities.'),
  run:spec(['id','expectedManifestSha256','intentIds','requestId'],{
    ...pin,intentIds:intents,requestId,workspace:alias,
    workspaceByIntent:{type:'object',maxProperties:500,additionalProperties:alias}},
    'Start the same native browser-run operation using selected host-owned buyer aliases. Keep requestId after a lost reply. The existing browser panel provides each original payment approval.'),
  'run-status':spec([],{requestId},
    'Read the exact original run by requestId, or the current/latest run when omitted.'),
  pause:spec(['requestId'],{requestId},
    'Request pause of the original owned run and revoke pending approvals. Follow run-status until its native drain completes.'),
  approval:spec(['requestId','intentId'],{requestId,intentId:intent},
    'Read the active original approval and exact review. The operator uses the already-open native browser panel.'),
  export:spec(['id','expectedManifestSha256','exportId'],{...pin,exportId:hexId},
    'Retain the complete original five-file collection export. Reuse exportId after an interrupted reply; a new ID captures a later outcome.'),
  'export-status':spec(['id','expectedManifestSha256','exportId'],{...pin,exportId:hexId},
    'Inspect the complete original retained export and exact file hashes, including after the browser stops.'),
  'export-file':spec(['id','expectedManifestSha256','exportId','filename','expectedFileSha256'],{
    ...pin,exportId:hexId,filename:{enum:['collection.json','results.json','requests.csv','review.html','manifest.json']},
    expectedFileSha256:hash,...range},
    'Read verified ranges from the retained original export, including after the collection browser stops. Reassemble exact base64 bytes and verify the complete SHA256.'),
  'response-file':spec(['id','expectedManifestSha256','intentId','expectedResponseSha256'],{
    ...pin,intentId:intent,expectedResponseSha256:hash,...range},
    'Read the exact saved customer response selected from its original collection/inbox outcome. Uses the maintained native file verifier and never calls the merchant again.')
});
export const nativeCollectionActions=Object.freeze(['collections']);
export const nativeCollectionsSchema=Object.freeze({
  properties:{
    collectionWorkspace:{...alias,description:'Existing host-registered collection alias. Paths, listener tokens, signer configuration and approval decisions are host-owned.'},
    collectionOperation:{type:'string',enum:Object.keys(nativeCollectionOperations)},
    collectionRequest:{type:'object',description:'Original operation fields. Preserve collection, request, export and source-review identities across interruption.'}
  },
  anyOf:Object.entries(nativeCollectionOperations).map(([operation,{required,properties,description}])=>({
    required:['action','collectionOperation',...(operation==='workspaces'?[]:['collectionWorkspace']),
      ...(required.length?['collectionRequest']:[])],
    properties:{action:{const:'collections'},collectionOperation:{const:operation},
      collectionRequest:{type:'object',additionalProperties:false,required,properties,description}}
  }))
});
