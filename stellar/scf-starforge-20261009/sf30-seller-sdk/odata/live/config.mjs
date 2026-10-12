// MIT. Original SF61 offers and SF30 supplier binding for the shared OData model.
import { upstreamCredentialReferences,compileUpstreamBindings } from '../../upstream.mjs';
import { importOpenApi } from '../../../sf61-openapi-seller-import/importer.mjs';
import { createSellerServiceConfig } from '../../../sf61-openapi-seller-import/service-config.mjs';
import { canonical,getEntitySet } from '../source.mjs';
import { underlyingType } from '../schema.mjs';
import { validatePlan,sourceTarget,digest,PLAN_SCHEMA } from './contract.mjs';
export const json = value => JSON.stringify(value,null,2)+'\n';
export function connectionBinding(plan,catalog,operation) {
  const target=sourceTarget(catalog,operation);
  return {origin:target.url.origin,path:target.url.pathname,method:'GET',query:target.mapping,responseMode:'bytes',
    requestHeaders:['prefer'],responseHeaders:['content-type','etag','last-modified'],
    headerEnv:{...plan.headerEnv,accept:'SF_ODATA_DATA_ACCEPT','odata-maxversion':'SF_ODATA_MAXVERSION'},
    ...(plan.oauth2?{oauth2:plan.oauth2}:{}),timeoutMs:plan.limits.timeoutMs,
    maxResponseBytes:plan.limits.maxResponseBytes,maxInFlight:plan.limits.maxInFlight};
}
export const runtimeEnvironment = (env=process.env) => ({...env,
  SF_ODATA_DATA_ACCEPT:'application/json;odata.metadata=minimal;IEEE754Compatible=true',SF_ODATA_MAXVERSION:'4.01'});
export function prepareProduct(input,catalog,options={}) {
  catalog=structuredClone(catalog);
  const plan=validatePlan(input,catalog,options);
  const upstreams={schema:'stellar-forge.seller-upstreams.v1',bindings:Object.fromEntries(plan.operations.map(row=>[row.id,connectionBinding(plan,catalog,row)]))};
  const references=upstreamCredentialReferences(upstreams);
  compileUpstreamBindings(upstreams,{allowLoopback:options.allowLoopback===true,
    env:runtimeEnvironment(Object.fromEntries(references.map(name=>[name,'offline-declaration-value'])))});
  const spec={openapi:'3.1.0',info:{title:plan.title,version:'1.0.0',description:'Live OData reads with explicit Stellar payment terms per provider page.'},
    servers:[{url:plan.publicOrigin+'/'}],paths:{}};
  const selections=[],bindings=[];
  for (const operation of plan.operations) {
    const initial={type:'object',additionalProperties:false,properties:{
      select:{type:'array',minItems:1,maxItems:operation.fields.length,uniqueItems:true,items:{enum:operation.fields}},
      filters:{type:'array',maxItems:operation.filterFields.length?16:0,items:{type:'object',additionalProperties:false,
        required:['field','op','value'],properties:{field:{type:'string',...(operation.filterFields.length?{enum:operation.filterFields}:{})},op:{enum:['eq','ne','gt','ge','lt','le','contains','startswith','endswith']},value:{}}}},
      filterMode:{enum:['and','or']},orderBy:{type:'array',maxItems:8,items:{type:'object',additionalProperties:false,required:['field'],
        properties:{field:{enum:operation.orderFields},direction:{enum:['asc','desc']}}}},
      top:{type:'integer',minimum:1,maximum:operation.maxTotalRows},count:{type:'boolean'},
      pageSize:{type:'integer',minimum:1,maximum:operation.maxPageRows}}};
    if(operation.sourceFilters!==undefined){
      initial.properties.filters.const=operation.sourceFilters;
      initial.properties.filterMode.enum=[operation.sourceFilterMode??'and'];
    }
    const request={type:'object',properties:{...initial.properties,cursor:{type:'string',minLength:1,maxLength:32768}},oneOf:[initial,{type:'object',additionalProperties:false,required:['cursor'],properties:{cursor:{type:'string',minLength:1,maxLength:32768}}}]};
    spec.paths[operation.path]={post:{operationId:operation.id,summary:operation.entitySet+' live selected rows',
      description:'Each successful provider page has the listed price. pageSize is a preference; the supplier may return up to '+operation.maxPageRows+
        ' rows. top limits the complete query. Exact Decimal/Int64 values remain strings. Submit only the returned cursor for a subsequent paid page.'+
        (operation.sourceFilters!==undefined?' The retained source filters and their Boolean mode are fixed for this merchant product.':''),
      requestBody:{required:true,content:{'application/json':{schema:request,example:{pageSize:Math.min(100,operation.maxPageRows)}}}},
      responses:{'200':{description:'Selected scalar fields, exact count, cumulative rows, and signed merchant continuation.',content:{'application/json':{schema:{type:'object'}}}},
        '422':{description:'Request exceeds merchant query policy or its continuation has expired.'},
        '502':{description:'Supplier response does not satisfy the selected source contract.'}}}};
    selections.push({method:'POST',path:operation.path,serviceName:('OData / '+operation.id).slice(0,32),
      accepts:[{scheme:'exact',...plan.payment,amount:operation.amountAtomic}]});
    bindings.push({method:'POST',path:operation.path,id:operation.id,handler:'read_'+operation.id,admit:'admit_'+operation.id,validateInput:false});
  }
  const imported=importOpenApi(spec,selections),service=createSellerServiceConfig(imported,bindings);
  return {plan,catalog,upstreams,spec,selections,bindings,imported,service,offers:{resources:imported.offers.map(row=>row.seller)},
    sourceBinding:digest(canonical({plan,metadataSha256:catalog.receipts.metadata.sha256,serviceSha256:catalog.receipts.service.sha256}))};
}
export function templatePlan(catalog,{publicOrigin='https://merchant.example',entitySet}={}) {
  const entity=entitySet?getEntitySet(catalog,entitySet):catalog.entitySets.find(set=>set.keyFields.length),supported=new Set(['Edm.String','Edm.Boolean','Edm.Byte','Edm.SByte','Edm.Int16','Edm.Int32',
    'Edm.Int64','Edm.Decimal','Edm.Single','Edm.Double','Edm.Guid','Edm.Date','Edm.DateTimeOffset','Edm.TimeOfDay','Edm.Duration','Edm.Binary']);
  if (!entity) throw new TypeError('Select an advertised entity set with declared keys');
  const selected=entity.fields.filter(field=>!field.collection&&supported.has(underlyingType(catalog,field.type))).slice(0,32).map(field=>field.path);
  for (const key of entity.keyFields) if (!selected.includes(key)) selected.unshift(key);
  return {schema:PLAN_SCHEMA,title:'OData live merchant',publicOrigin,serviceRoot:catalog.serviceUrl,metadataSha256:catalog.receipts.metadata.sha256,
    payment:{network:'stellar:testnet',asset:'REPLACE_WITH_STELLAR_ASSET_CONTRACT',payTo:'REPLACE_WITH_MERCHANT_RECIPIENT',maxTimeoutSeconds:60},
    operations:[{id:entity.name.replace(/[^A-Za-z0-9_]/g,'_').slice(0,63),path:'/odata/'+entity.name.replace(/[^A-Za-z0-9_-]/g,'_'),
      entitySet:entity.container+'/'+entity.name,fields:selected,filterFields:selected.filter(name=>entity.fields.find(field=>field.path===name).type!=='Edm.Binary'),
      orderFields:selected.filter(name=>entity.fields.find(field=>field.path===name).type!=='Edm.Binary'),maxPageRows:1000,maxTotalRows:100000,amountAtomic:'10000'}]};
}
