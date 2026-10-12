// SPDX-License-Identifier: MIT
// Pure metadata; source/warehouse engines remain lazy original owners.
import {MAX_RETAINED_CHUNK_BYTES} from '../retained-file-contracts.mjs';
import {nativeDuckDBOperations} from '../../mcp-paid-agent/native-duckdb-schema.mjs';
const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'},uuid={type:'string',pattern:'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$'},hash={type:'string',pattern:'^[a-f0-9]{64}$'};
const text={type:'string'},scope={workspace:alias,workspaceId:uuid},request={requestId:uuid},delivery={deliveryId:uuid};
const page={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100}};
const chunk={expectedSha256:hash,offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES},readId:uuid};
const read={readOnly:true,idempotent:true},write={idempotent:true,openWorld:true};
export function localDatasetWorkspaceTools(tool){
 const scoped=(name,description,properties={},required=[],annotations=read)=>tool('merchant_local_dataset_'+name,description,{...scope,...properties},['workspace','workspaceId',...required],annotations);
 return[
  tool('merchant_local_dataset_status','List declared original local-data/customer bindings without opening them, or page the retained original delivery history.',{...scope,...page},[],read),
  tool('merchant_local_dataset_open','Open the configured original Frictionless publisher and borrow its single scheduler for the complete local-data customer workflow. Returns persistent delivery workspace and distinct customer IDs.',{workspace:alias},['workspace'],write),
  scoped('close','Drain this exact borrowed listener, model and file readers. The original merchant publisher and independently owned Python customer remain with their existing owners.',{instanceId:uuid,publisherInstanceId:uuid},['instanceId','publisherInstanceId'],{destructive:true}),
  scoped('record','Read the original delivery scope, accepted page count, source/manifest identities, customer edition and complete declared export history.',delivery,['deliveryId']),
  scoped('prepare','Retain a reviewed local operator delivery for the selected original candidate/query. This is not a purchase or signed payment.',{...request,runId:uuid,reviewId:uuid,candidateDigest:hash,query:{type:'string',maxLength:65536},reviewer:{type:'string',minLength:1,maxLength:240},note:{type:'string',maxLength:4096}},['requestId','runId','reviewId','candidateDigest','query','reviewer','note'],write),
  scoped('continue','Receive every original cursor page through SF100, retain complete upstream source bytes and register the unchanged finalized scan with the existing customer. Inspect the same request after interruption.',{...request,...delivery},['requestId','deliveryId'],write),
  scoped('cancel','Pause only this original active local page-delivery request. Its accepted native prefix stays available for explicit same-request continuation.',{...request,operationId:uuid},['requestId','operationId'],write),
  scoped('request','Inspect a retained request or explicitly resume its exact saved input. Loading or inspecting never replays a mutation.',{action:{enum:['inspect','resume']},...request},['action','requestId'],write),
  scoped('customer','Use the existing DuckDB service for complete source/mapping review, immutable import, view CAS, saved SQL, reports and explicit exports. Native operation-specific fields are unchanged; queries/exports bind every current ordered view. All mutations use a local request UUID.',{action:{enum:['read','write']},...request,...delivery,operation:{enum:Object.keys(nativeDuckDBOperations).filter(x=>x!=='workspaces')},arguments:{type:'object',description:'The exact original native-duckdb operation fields; parameters_text is preserved literally.'}},['action','deliveryId','operation','arguments'],write),
  scoped('package','Create a complete original upstream/SF100/customer package from explicitly selected completed native exports, or inspect its retained request. The whole warehouse must be the original source-handoff export.',{action:{enum:['create','inspect']},...request,...delivery,warehouseExportId:text,exports:{type:'array',maxItems:1024,uniqueItems:true,items:text}},['action','requestId'],write),
  scoped('file','Read an exact declared source/SF100 file through the maintained immutable descriptor reader. Resume with its original digest and offset.',{...delivery,file:text,...chunk},['deliveryId','file','expectedSha256']),
  scoped('file_release','Release this original local file read.',{readId:uuid},['readId'],write),
  scoped('package_manifest','Inspect the complete original package-download manifest. All files remain available through the original retained-file reader.',{exportId:uuid},['exportId']),
  scoped('package_file','Read a declared package file or its small download manifest, bound to both original manifest and file digests.',{exportId:uuid,file:text,expectedManifestSha256:hash,...chunk},['exportId','file','expectedManifestSha256','expectedSha256']),
  scoped('package_file_release','Release the selected package read without closing its publisher or customer.',{exportId:uuid,readId:uuid},['exportId','readId'],write),
  scoped('browser','Open/reuse or close the browser listener over this SAME publisher, scheduler and local delivery model. The embedded customer link uses its original independently owned service.',{action:{enum:['open','close']},port:{type:'integer',minimum:0,maximum:65535}},['action'],write),
 ];
}
