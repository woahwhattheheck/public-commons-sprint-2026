// SPDX-License-Identifier: MIT
// Complete customer packages over the original registered Collections listener.
const alias={type:'string',pattern:'^[A-Za-z][A-Za-z0-9_-]{0,63}$'};
const id={type:'string',pattern:'^[A-Za-z0-9._-]{1,100}$'};
const hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const range={byteOffset:{type:'integer',minimum:0},maxBytes:{type:'integer',minimum:1,maximum:65536}};
const page={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}};
const request={id,collectionId:{type:'string',minLength:1,maxLength:80},expectedManifestSha256:hash,
 title:{type:'string',minLength:1,maxLength:160},note:{type:'string',maxLength:10000},
 intentIds:{type:'array',minItems:1,maxItems:100,uniqueItems:true,items:{type:'string',pattern:'^[A-Za-z0-9._:-]{1,128}$'}},
 maxVerifyBytes:{type:'integer',minimum:0,maximum:1073741824},allowIncomplete:{type:'boolean'}};
// Two complete 64 KiB parts, including the MCP envelope, fit the original 256 KiB request budget.
export const nativeCollectionDeliveryUploadBatchChunks=2;
const chunk={offset:{type:'integer',minimum:0},base64:{type:'string',maxLength:87384},chunkSha256:hash};
const taskRequest={id,expectedTaskSha256:hash,title:request.title,note:request.note,intentIds:request.intentIds};
const spec=(required,properties,description)=>({required,properties,description});
export const nativeCollectionDeliveryOperations=Object.freeze({
 workspaces:spec([],page,'List original host-registered customer delivery senders and recipients.'),
 status:spec([],page,'Inspect this original listener and page its retained named deliveries.'),
 preview:spec(Object.keys(request),request,'Review selected original saved outputs against the host-approved complete source. Saves the exact returned preview. No purchase.'),
 prepare:spec([...Object.keys(request),'expectedPreviewSha256'],{...request,expectedPreviewSha256:hash},
  'Prepare the same named customer package from the saved preview and exact unchanged request. Reuse that ID and body after uncertainty.'),
 'task-inspect':spec(['expectedTaskSha256'],{expectedTaskSha256:hash,...page},'Inspect the original host-selected immutable InboxTask identity and page its verified response selection. No path, purchase or task creation.'),
 'task-preview':spec(Object.keys(taskRequest),taskRequest,'Review the selected complete original InboxTask outputs and host-approved source. Saves this exact preview.'),
 'task-prepare':spec([...Object.keys(taskRequest),'expectedPreviewSha256'],{...taskRequest,expectedPreviewSha256:hash},'Prepare the same original Task customer package from the retained request and preview. Preserve separate original and recovery observations.'),
 inspect:spec(['id'],{id},'Reopen the exact named original delivery, including a preparing intent.'),
 'manifest-file':spec(['id','expectedFileSha256'],{id,expectedFileSha256:hash,...range},'Read the small exact download manifest for the original full customer package.'),
 'result-file':spec(['id','expectedFileSha256'],{id,expectedFileSha256:hash,...range},
  'Read full sanitized original delivery result metadata by verified byte range, including after the original listener stops.'),
 'package-file':spec(['id','expectedFileSha256'],{id,expectedFileSha256:hash,...range},
  'Read every unchanged byte of the original complete customer package through the saved-file verifier.'),
 'upload-start':spec(['sha256','bytes','filename'],{sha256:hash,bytes:{type:'integer',minimum:1,maximum:4311744512},filename:{type:'string',minLength:1,maxLength:160}},
  'Retain the original package digest and length on the selected recipient. Identical request reuses the same upload.'),
 'upload-status':spec(['sha256'],{sha256:hash},'Read the contiguous original committed upload offset.'),
 'upload-chunk':spec(['sha256','offset','base64','chunkSha256'],{sha256:hash,offset:{type:'integer',minimum:0},
  base64:{type:'string',maxLength:87384},chunkSha256:hash},'Append one original bounded chunk. Exact committed chunk replay is read-only.'),
 'upload-chunks':spec(['sha256','chunks'],{sha256:hash,chunks:{type:'array',minItems:1,maxItems:nativeCollectionDeliveryUploadBatchChunks,
  items:{type:'object',additionalProperties:false,required:Object.keys(chunk),properties:chunk}}},
  'Append up to two contiguous original chunks within the existing request limit. Every committed replay must match its retained bytes.'),
 'upload-finish':spec(['sha256'],{sha256:hash},'Verify and seal the complete original package without receiving it.'),
 receive:spec(['sha256'],{sha256:hash},'Receive the same completed package into the original selected recipient. Reopen the same digest after uncertainty.'),
 'received-list':spec([],{...page,expectedHistorySha256:hash},'Page original saved recipient receipts, including incomplete/unavailable records. A continuation binds the same complete history snapshot.'),
 'received-package':spec(['sha256'],{sha256:hash},'Verify the complete original received package and all members; inspect its retained download manifest without the sender or original listener.'),
 'received-manifest-file':spec(['sha256','expectedFileSha256'],{sha256:hash,expectedFileSha256:hash,...range},'Read the exact retained manifest for one original received package.'),
 'received-package-file':spec(['sha256','expectedFileSha256'],{sha256:hash,expectedFileSha256:hash,...range},'Read every original byte of the selected received package by verified range.'),
 received:spec(['sha256'],{sha256:hash,...page},'Verify the received original members and page their full inventory.'),
 'received-file':spec(['sha256','path','expectedFileSha256'],{sha256:hash,path:{type:'string',minLength:1,maxLength:2048},expectedFileSha256:hash,...range},
  'Read a retained original response, review or full source member by exact original name and digest.')
});
export const nativeCollectionDeliveryActions=Object.freeze(['collection-delivery']);
export const nativeCollectionDeliverySchema=Object.freeze({
 properties:{deliveryWorkspace:alias,deliveryOperation:{enum:Object.keys(nativeCollectionDeliveryOperations)},deliveryRequest:{type:'object'}},
 anyOf:Object.entries(nativeCollectionDeliveryOperations).map(([operation,{required,properties,description}])=>({
  required:['action','deliveryOperation',...(operation==='workspaces'?[]:['deliveryWorkspace']),...(required.length?['deliveryRequest']:[])],
  properties:{action:{const:'collection-delivery'},deliveryOperation:{const:operation},
   deliveryRequest:{type:'object',additionalProperties:false,required,properties,description}}
 }))
});
