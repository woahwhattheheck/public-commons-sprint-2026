import {readFileSync} from 'node:fs';
import {invariant,sha256} from './source-json.mjs';
const specBytes=readFileSync(new URL('../sources/paycashless-openapi.json',import.meta.url));
const profile=JSON.parse(readFileSync(new URL('../sources/paycashless-projections.json',import.meta.url),'utf8'));
const ORIGINAL_SHA='32a8f2c29ec63dde0b76002460e1c66b5950267c51677f6d507b7185a10e9592';
invariant(specBytes.length===82733&&sha256(specBytes)===ORIGINAL_SHA,'PAYCASHLESS_COMPLETE_API_SOURCE_CHANGED');
invariant(profile.schema==='paycashless.original-operation-projections.v1'&&profile.originalSha256===ORIGINAL_SHA,'PAYCASHLESS_PROJECTION_SOURCE_CHANGED');
const paycashless=JSON.parse(specBytes.toString('utf8'));
export const PAYCASHLESS_SOURCE=Object.freeze({url:'https://api.paycashless.com/openapi.json',version:paycashless.info.version,
 original:'sources/paycashless-openapi.json',openapi:'sources/paycashless-openapi.json',originalSha256:ORIGINAL_SHA,openapiSha256:ORIGINAL_SHA,
 projectionsSha256:sha256(readFileSync(new URL('../sources/paycashless-projections.json',import.meta.url))),
 authenticationSource:'https://docs.paycashless.com/api-reference/authentication.md',signingSource:'https://docs.paycashless.com/api-signature.md',sourceReceipts:'sources/provider-source-receipts.json'});
const clone=value=>JSON.parse(JSON.stringify(value));
export function resolveReference(spec,value,seen=new Set()) {
  if(!value?.$ref)return value;
  invariant(typeof value.$ref==='string'&&value.$ref.startsWith('#/'),'EXTERNAL_SCHEMA_REFERENCE_UNSUPPORTED');
  invariant(!seen.has(value.$ref),'SCHEMA_REFERENCE_CYCLE',{ref:value.$ref});
  const next=value.$ref.slice(2).split('/').map(x=>x.replaceAll('~1','/').replaceAll('~0','~')).reduce((v,k)=>v?.[k],spec);
  invariant(next,'SCHEMA_REFERENCE_MISSING',{ref:value.$ref});
  return resolveReference(spec,next,new Set([...seen,value.$ref]));
}
const entries=[], contracts=new Map();
function requestComponents(spec,roots) {
 const output={},seen=new Set();
 function visit(value){
  if(!value||typeof value!=='object')return;
  if(value.$ref&&value.$ref.startsWith('#/components/')){
   if(seen.has(value.$ref))return;seen.add(value.$ref);
   const parts=value.$ref.slice(2).split('/').map(x=>x.replaceAll('~1','/').replaceAll('~0','~'));
   const original=parts.reduce((v,key)=>v?.[key],spec);
   invariant(original!==undefined,'SCHEMA_REFERENCE_MISSING',{ref:value.$ref});
   let target=output;for(const key of parts.slice(1,-1))target=target[key]??={};
   target[parts.at(-1)]=original;visit(original);
  }
  for(const child of Object.values(value))visit(child);
 }
 roots.forEach(visit);return output;
}
function register({id,provider,path,method,kind,pagination=null,spec,source,operation,selection=null}) {
  const item=resolveReference(spec,spec.paths[path]);
  const op=clone(operation ?? item?.[method.toLowerCase()]);
  invariant(op,'ORIGINAL_OPERATION_MISSING',{id,path,method});
  const parameters=[...(item?.parameters??[]),...(op.parameters??[])].map(p=>clone(resolveReference(spec,p)));
  const byKey=new Map(parameters.map(p=>[p.in+':'+p.name,p]));
  op.parameters=[...byKey.values()];
  if(op.requestBody)op.requestBody=clone(resolveReference(spec,op.requestBody));
  let responseFormat='text';
  for(const [status,raw] of Object.entries(op.responses??{}))if(/^2\d\d$/.test(status)){
    const response=resolveReference(spec,raw);
    if(response.content?.['application/json'])responseFormat='json';
    else if(response.content?.['text/csv'])responseFormat='csv';
  }
  const entry={id,action:id,label:op.summary??id,provider,method:method.toUpperCase(),path,
    mutation:!['GET','HEAD'].includes(method.toUpperCase()),resourceKind:kind,responseFormat,pagination,
    inputSchema:{parameters:op.parameters,requestBody:op.requestBody??null,components:requestComponents(spec,[op.parameters,op.requestBody])},source};
  if(selection){
    Object.assign(entry,{projection:clone(selection.projection??null),
      paginationOptions:clone(selection.paginationOptions??null),
      readback:clone(selection.readback??null),sandboxOnly:selection.sandboxOnly===true,
      idempotency:clone(selection.idempotency??null),
      security:clone(op.security??spec.security??[]),
      authenticationRequired:true, authenticationSource:PAYCASHLESS_SOURCE.authenticationSource,
      servers:clone(op.servers??item?.servers??spec.servers??[])});
  }
  invariant(!contracts.has(id),'DUPLICATE_NATIVE_ACTION',{id});
  entries.push(entry);contracts.set(id,{entry,operation:op,spec});
}
const methodNames=new Set(['get','post','put','patch','delete','head','options','trace']);
const originalKeys=new Set();
for(const [path,rawItem]of Object.entries(paycashless.paths)){
 const item=resolveReference(paycashless,rawItem);
 for(const [method,operation]of Object.entries(item)){
  if(!methodNames.has(method))continue;
  const key=method.toUpperCase()+' '+path;
  originalKeys.add(key);
  const selected=profile.actions[key];
  invariant(selected&&typeof selected==='object'&&
   typeof selected.id==='string'&&selected.id.startsWith('paycashless.')&&
   typeof selected.kind==='string'&&selected.kind.startsWith('paycashless-')&&
   Object.hasOwn(selected,'projection')&&Object.hasOwn(selected,'pagination'),
   'PAYCASHLESS_ORIGINAL_OPERATION_SELECTION_REQUIRED',{key});
  register({id:selected.id,provider:'paycashless',path,method,kind:selected.kind,
   pagination:selected.pagination,spec:paycashless,operation,selection:selected,
   source:{...PAYCASHLESS_SOURCE,originalOperationId:operation.operationId??null,originalOperation:key}});
 }
}
invariant(Object.keys(profile.actions).every(key=>originalKeys.has(key)),
 'PAYCASHLESS_OPERATION_NOT_IN_ORIGINAL_SOURCE');
function simple({id,path,kind,parameters=[],pagination=null,method='get',body=null,source}){
 const operation={summary:id,parameters,responses:{200:{content:{'application/json':{schema:{}}}}}};
 if(body)operation.requestBody={required:true,content:{'application/json':{schema:body}}};
 register({id,provider:id.split('.')[0],path,kind,method,pagination,spec:{paths:{[path]:{[method]:operation}}},source});
}
const parameter=(name,location,schema,required=false)=>({name,in:location,schema,required});
const horizonSource={repository:'stellar/js-stellar-sdk',tag:'v17.0.1',
 commit:'74ac883871396138e1882a3ca4bcec7e4ace76b5',original:'sources/horizon-original.json'};
const idSchemas={accountId:{type:'string',pattern:'^(?:G[A-Z2-7]{55}|M[A-Z2-7]{68})$'},
 transactionHash:{type:'string',pattern:'^[0-9a-fA-F]{64}$'},
 operationId:{type:'string',pattern:'^[1-9][0-9]*$'},ledger:{type:'string',pattern:'^[1-9][0-9]*$'}};
simple({id:'horizon.network.get',path:'/',kind:'horizon-network',source:horizonSource});
for(const [id,path,key]of [['account','accounts','accountId'],['transaction','transactions','transactionHash'],['operation','operations','operationId'],['ledger','ledgers','ledger']])
 simple({id:'horizon.'+id+'.get',path:'/'+path+'/{'+key+'}',kind:'horizon-'+id,
 parameters:[parameter(key,'path',idSchemas[key],true)],source:horizonSource});
for(const list of ['payments','operations','transactions'])for(const scope of ['all','account','ledger',...(list==='transactions'?[]:['transaction'])]){
 const key={account:'accountId',transaction:'transactionHash',ledger:'ledger'}[scope];
 const prefix={account:'accounts',transaction:'transactions',ledger:'ledgers'}[scope];
 const path=(scope==='all'?'':'/'+prefix+'/{'+key+'}')+'/'+list;
 const parameters=[...(key?[parameter(key,'path',idSchemas[key],true)]:[]),
 parameter('limit','query',{type:'integer',minimum:1,maximum:200}),
 parameter('cursor','query',{type:'string',pattern:'^(?:[0-9]+|now)$'}),
 parameter('order','query',{type:'string',enum:['asc','desc']}),
 parameter('include_failed','query',{type:'boolean'}),
 ...(list==='transactions'?[]:[parameter('join','query',{type:'string',enum:['transactions']})])];
 simple({id:'horizon.'+list+'.'+scope,path,kind:list==='transactions'?'horizon-transaction':'horizon-operation',
 parameters,pagination:'horizon',source:horizonSource});
}
function freeze(value,seen=new WeakSet()){
 if(!value||typeof value!=='object'||seen.has(value))return value;
 seen.add(value);for(const child of Object.values(value))freeze(child,seen);return Object.freeze(value);
}
for(const value of contracts.values())freeze(value);
export const NATIVE_ACTIONS=freeze(entries);
export function actionContract(action){const value=contracts.get(action);invariant(value,'UNKNOWN_NATIVE_ACTION',{action});return value;}
