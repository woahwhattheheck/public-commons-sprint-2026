// MIT. Complete original provider schemas with explicit source-backed implementation joins.
import {readFileSync} from 'node:fs';
import {invariant,sha256} from './source-json.mjs';
export const PROVIDER_SOURCES=Object.freeze({"escala":{"provider":"escala","original":"sources/escala-mock-openapi.yaml","openapi":"sources/escala-mock-openapi.json","projections":"sources/escala-projections.json","originalSha256":"e4b370b19eb1e0bb64378885d2f2c59d63b83270e9bace634b549db98693beb2","openapiSha256":"93c32967e21859ff929c02af40d9deda6b0283c3898107e4ad88828fc0e29a47","projectionsSha256":"8d9af7df4fe3c31161ee6e9c2fb10a0bfb541ec06f7110d32e8785d08629d6c7","repository":"escala-dev/collective-investment-api","commit":"ca9ae6256fdbf7786e20b4c2b2926ce179468944","executionSemantics":"published-mock"},"sdp":{"provider":"sdp","original":"sources/sdp-openapi.yaml","openapi":"sources/sdp-openapi.json","projections":"sources/sdp-projections.json","originalSha256":"0064671e3fefb0d3b9560181b3288379e6b35be0c9197ee2ca3fdb9a3a395738","openapiSha256":"1f760b5631a5561e812f7f442587fa8c25567bd5e092fc946b175c80b8f22b61","projectionsSha256":"e20f6d1adc8d5f7b0aca6afa12372df3b91c1de7830ce6f3a8a00e6844b91182","repository":"stellar/stellar-disbursement-platform-backend","commit":"14704274467d267b6c6679052d7251ef6050d118","executionSemantics":"configured-provider"}});
function sourceDocument(descriptor){
 const original=readFileSync(new URL('../'+descriptor.original,import.meta.url));
 const compiled=readFileSync(new URL('../'+descriptor.openapi,import.meta.url));
 const profile=readFileSync(new URL('../'+descriptor.projections,import.meta.url));
 invariant(sha256(original)===descriptor.originalSha256&&sha256(compiled)===descriptor.openapiSha256&&sha256(profile)===descriptor.projectionsSha256,'ORIGINAL_API_SOURCE_CHANGED');
 const spec=JSON.parse(compiled.toString('utf8')),selection=JSON.parse(profile.toString('utf8'));
 invariant(selection.originalSha256===descriptor.originalSha256&&selection.compiledSha256===descriptor.openapiSha256,'ORIGINAL_PROFILE_BINDING_CHANGED');
 return {spec,selection};
}
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
  if(selection?.bodyCorrection)op.requestBody=clone(selection.bodyCorrection);
  if(selection?.schemaCorrections)Object.assign(op.requestBody.content['application/json'].schema.properties,clone(selection.schemaCorrections));
  if(selection?.requiredBodyFields){op.requestBody.required=true;op.requestBody.content[Object.keys(op.requestBody.content)[0]].schema.required=selection.requiredBodyFields;}
  if(selection?.parameterCorrections){op.parameters=(op.parameters??[]).filter(p=>!selection.parameterCorrections.remove.includes(p.name));op.parameters.push(...clone(selection.parameterCorrections.add));}
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
    Object.assign(entry,{projections:clone(selection.projections??[]),
      mock:selection.mock===true,dispatchable:selection.dispatchable!==false,fileUpload:selection.fileUpload===true,
      paginationOptions:clone(selection.paginationOptions??null),
      readback:clone(selection.readback??null),sandboxOnly:selection.sandboxOnly===true,
      idempotency:clone(selection.idempotency??null),
      security:clone(op.security??spec.security??[]),
      authenticationRequired:provider==='sdp', authenticationSource:source,
      servers:clone(op.servers??item?.servers??spec.servers??[])});
  }
  invariant(!contracts.has(id),'DUPLICATE_NATIVE_ACTION',{id});
  entries.push(entry);contracts.set(id,{entry,operation:op,spec});
}

for(const [provider,source]of Object.entries(PROVIDER_SOURCES)){
 const {spec,selection}=sourceDocument(source);
 for(const [key,selected]of Object.entries(selection.actions)){
  const space=key.indexOf(' '),method=key.slice(0,space),path=key.slice(space+1);
  invariant(spec.paths[path]?.[method.toLowerCase()],'ORIGINAL_OPERATION_MISSING',{key});
  register({id:selected.id,provider,path,method,kind:selected.kind,pagination:selected.pagination,
    spec,selection:selected,source:{...source,originalOperation:key,originalOperationId:spec.paths[path][method.toLowerCase()].operationId??null}});
 }
}
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
