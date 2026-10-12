// MIT. Original tool metadata; provider runtimes load only when selected.
import { MAX_RETAINED_CHUNK_BYTES } from '../retained-file-contracts.mjs';

const HASH=/^[a-f0-9]{64}$/;

const alias={type:'string',pattern:'^[a-z0-9][a-z0-9_-]{0,63}$'};

const hash={type:'string',pattern:HASH.source};

const nativeId={type:'string',pattern:'^[a-z]+-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$'};

const short={type:'string',minLength:1,maxLength:160};

const base={workspace:alias};

const version={...base,expectedVersion:hash};

const paged={offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:100},expectedVersion:hash};

const read={readOnly:true,idempotent:true};

const write={readOnly:false,idempotent:false};

const live={...write,openWorld:true};

const sourceKind={type:'string',enum:['profile','handoff','receiving']};

const definitions=[
 ['merchant_cocart_workspaces','List the host-declared original CoCart workspaces, input aliases and native SDK selection.',base,[],read],
 ['merchant_cocart_state','Read the original saved workspace, selected cart and paged history. Later pages require the same workspace revision.',
  {...base,...paged,view:{type:'string',enum:['summary','carts','events','catalogs','catalog','cart','operations','snapshots','checkouts']},cartId:nativeId,catalogId:nativeId},['workspace'],read],
 ['merchant_cocart_source','Inspect and validate the complete original merchant profile, Woo handoff or receiving export before selecting it.',
  {...base,kind:sourceKind,input:alias},['workspace','kind'],read],
 ['merchant_cocart_create','Create this declared empty workspace from the exact reviewed original merchant profile and its host-selected receiving transport.',
  {...base,expectedSourceSha256:hash},['workspace','expectedSourceSha256'],write],
 ['merchant_cocart_receive','Receive a complete original export into this declared destination, or reopen its same prior receiving operation.',
  {...base,input:alias,expectedSourceSha256:hash},['workspace','input','expectedSourceSha256'],{...write,idempotent:true}],
 ['merchant_cocart_catalog','Read an actual native product page through the original SDK and retain its original response and pagination.',
  {...version,search:{type:'string',maxLength:200},page:{type:'integer',minimum:1,maximum:10000},perPage:{type:'integer',minimum:1,maximum:100}},['workspace','expectedVersion'],live],
 ['merchant_cocart_cart_create','Create or attach one actual native guest cart. Retain the returned original cart identity before continuing.',
  {...version,label:short,cartKey:{type:'string',pattern:'^[A-Za-z0-9_-]{1,128}$'}},['workspace','label','expectedVersion'],live],
 ['merchant_cocart_cart_refresh','Read the same original guest cart through the original SDK and retain a native snapshot.',
  {...version,cartId:nativeId},['workspace','cartId','expectedVersion'],live],
 ['merchant_cocart_cart_prepare','Prepare a specific original cart mutation against a fresh native snapshot; preserve requestId for recovery.',
  {...version,cartId:nativeId,action:{type:'string',enum:['add','quantity','remove','restore','calculate','clear']},requestId:{type:'string',pattern:'^[A-Za-z0-9_.:-]{1,160}$'},productId:{type:'string',pattern:'^[1-9][0-9]{0,17}$'},itemKey:{type:'string',minLength:1,maxLength:160},quantity:{type:'integer',minimum:0,maximum:100000}},['workspace','cartId','action','requestId','expectedVersion'],{...live,idempotent:true}],
 ['merchant_cocart_cart_apply','Apply the selected original prepared operation. A repeated completed operation returns its retained outcome.',
  {...version,cartId:nativeId,operationId:nativeId},['workspace','cartId','operationId','expectedVersion'],{...live,idempotent:true}],
 ['merchant_cocart_cart_reconcile','Observe the original cart after an interrupted operation and record the selected disposition with its native reason.',
  {...version,cartId:nativeId,operationId:nativeId,decision:{type:'string',enum:['inspect','accept_current','confirmed_not_applied']},reason:{type:'string',maxLength:2000}},['workspace','cartId','operationId','decision','expectedVersion'],live],
 ['merchant_cocart_checkout_prepare','Read the native cart and prepare explicit replacement or merged Woo checkout, retaining its admission decision and exact URL.',
  {...version,cartId:nativeId,mode:{type:'string',enum:['replace','merge']}},['workspace','cartId','mode','expectedVersion'],live],
 ['merchant_cocart_woo_attach','Attach an exact host-declared original Woo buyer handoff to the cart checkout that produced its order.',
  {...version,cartId:nativeId,previewId:nativeId,input:alias,expectedSourceSha256:hash},['workspace','cartId','previewId','input','expectedSourceSha256','expectedVersion'],write],
 ['merchant_cocart_transport_rebind','Rebind an existing local receiving workspace to the transport selected in its private host connection.',
  version,['workspace','expectedVersion'],write],
 ['merchant_cocart_export','Export the complete original workspace and reachable objects under a stable exportId. Reopening the same export retains its exact bytes.',
  {...version,exportId:alias},['workspace','exportId','expectedVersion'],{...write,idempotent:true}],
 ['merchant_cocart_export_status','Validate and inspect an existing complete customer export and its exact original file.',
  {...base,exportId:alias},['workspace','exportId'],read],
 ['merchant_cocart_file','Retrieve the complete original export file in verified chunks; continue with its readId, hash and nextOffset.',
  {...base,exportId:alias,file:{type:'string',enum:['manifest.json','CoCart_Receiving_Workspace.json']},expectedManifestSha256:hash,expectedSha256:hash,readId:{type:'string',pattern:'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$'},offset:{type:'integer',minimum:0},limit:{type:'integer',minimum:1,maximum:MAX_RETAINED_CHUNK_BYTES}},['workspace','exportId','file','expectedManifestSha256'],read],
 ['merchant_cocart_file_release','Release this provider-owned temporary file read after receiving the original bytes.',
  {...base,readId:{type:'string',pattern:'^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$'}},['workspace','readId'],read]
];

const cocartWorkspaceTools=tool=>definitions.map(parts=>tool(...parts));

export { cocartWorkspaceTools, definitions, base, read, paged, nativeId, sourceKind, alias, hash, write, version, live, short, HASH };
