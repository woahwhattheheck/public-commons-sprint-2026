// MIT. OpenAlex metadata products compiled through the original SF30 seller.
import {readFile,lstat} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {compileHttpSellerOffer} from '../seller.mjs';
import {compileSellerRoutes} from '../resource-server.mjs';
import {compileSellerOpenApi} from '../developer-portal.mjs';

export const SCHEMA='stellar-forge.openalex-merchant.v1';
export const ORIGIN='https://api.openalex.org';
export const DOCUMENTATION='https://help.openalex.org/api/';
export const ENTITIES=Object.freeze({works:'W',authors:'A',sources:'S',institutions:'I',topics:'T',publishers:'P',funders:'F',awards:'G'});
export const SEARCH_PARAMETERS=Object.freeze(['search','search.exact','search.title','search.title.exact','search.title_and_abstract','search.title_and_abstract.exact','search.title_abstract_keywords','search.title_abstract_keywords.exact']);
export const LIST_PARAMETERS=Object.freeze(['filter',...SEARCH_PARAMETERS,'sort','group_by','select','cursor','page','per_page','corpus']);
export const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const json=v=>JSON.stringify(v,null,2)+'\n';
export const sha256=v=>createHash('sha256').update(v).digest('hex');
export function fail(message,status=400,code='OPENALEX_INPUT_INVALID'){throw Object.assign(new Error(message),{status,code});}
export function fields(v,allowed,label){if(!object(v)||Object.keys(v).some(k=>!allowed.includes(k)))fail('Invalid '+label+' fields.');}
export function text(v,label,max=160){if(typeof v!=='string'||!v.trim()||v.length>max||/[\x00-\x1f\x7f]/.test(v))fail('Invalid '+label+'.');return v;}
export function integer(v,min,max,label){if(!Number.isSafeInteger(v)||v<min||v>max)fail('Invalid '+label+'.');return v;}
export function entityId(entity,value){
  text(value,'OpenAlex entity ID',100);
  const id=value.replace(/^https:\/\/openalex\.org\//,'');
  if(!new RegExp('^'+ENTITIES[entity]+'[1-9][0-9]{0,19}$').test(id))fail('Choose a '+entity+' OpenAlex ID.');
  return id;
}
export function validateQuery(entity,input,{kind='list',requireFilter=false}={}){
  if(!Object.hasOwn(ENTITIES,entity))fail('Choose a supported OpenAlex entity.');
  fields(input,kind==='entity'?['id','select']:LIST_PARAMETERS,'OpenAlex request');
  const query={};
  for(const [key,value] of Object.entries(input)){
    if(value===undefined||value===null||value==='')continue;
    if(['per_page','page'].includes(key)){
      const s=String(value);if(!/^[1-9]\d*$/.test(s))fail('Use an integer '+key+'.');
      query[key]=String(integer(Number(s),1,key==='per_page'?100:10000,key));
    }else query[key]=text(value,key,key==='id'?100:key==='cursor'?3000:3500);
  }
  if(query.select){
    const selectedFields=query.select.split(',');
    if(selectedFields.some(k=>!/^[a-z][a-z0-9_]*$/.test(k)))fail('select accepts comma-separated top-level field names.');
    if(!selectedFields.includes('id'))fail('Include id in select so each received record retains its OpenAlex identity.');
  }
  if(kind==='entity'){
    const id=entityId(entity,query.id);delete query.id;return {query,id,estimatedCredits:0};
  }
  if(query.cursor&&query.page)fail('Choose cursor paging or numbered paging.');
  const size=Number(query.per_page??25),page=Number(query.page??1);
  if(!query.cursor&&size*page>10000)fail('Use cursor paging beyond 10,000 results.');
  if(query.group_by&&query.page)fail('Grouped results use cursor paging.');
  if(query.group_by&&query.select)fail('select is unavailable with group_by.');
  if(query.corpus&&!['core','all'].includes(query.corpus))fail('Choose the core or all corpus.');
  if(requireFilter&&!query.filter&&!SEARCH_PARAMETERS.some(k=>query[k]))fail('Choose a research filter or search before requesting this product.');
  if(entity!=='works'&&SEARCH_PARAMETERS.some(k=>k!=='search'&&query[k]))fail('Scoped search parameters apply to works.');
  const searched=SEARCH_PARAMETERS.some(k=>query[k])||/(?:^|,)[^,:]*\.search(?:\.exact)?:/.test(query.filter??'');
  return {query,id:null,estimatedCredits:searched?10:1};
}
export function requestFor(compiled,id,input){
  const product=compiled.products.find(p=>p.id===id);
  if(!product)fail('Choose a configured research product.');
  const selected=validateQuery(product.entity,input,{kind:product.kind,requireFilter:product.requireFilter});
  const path='/'+product.entity+(selected.id?'/'+selected.id:'');
  const url=new URL(path,ORIGIN);
  for(const [k,v] of Object.entries(selected.query))url.searchParams.set(k,v);
  if(Buffer.byteLength(url.href)>4094)fail('The OpenAlex request exceeds its 4,094-byte URL limit. Split large OR queries and union their retained IDs.');
  return {product,request:{...(selected.id?{id:selected.id}:{}),...selected.query},query:selected.query,path,sourceUrl:url.href,estimatedCredits:selected.estimatedCredits};
}
export function compileOpenAlexMerchant(input){
  fields(input,['schema','title','publicOrigin','provider','budget','timeoutMs','maxResponseBytes','products'],'merchant');
  if(input.schema!==SCHEMA)fail('Expected '+SCHEMA+'.');
  const config=structuredClone(input);text(config.title,'title',100);
  let origin;try{origin=new URL(config.publicOrigin);}catch{fail('Use the public HTTPS merchant origin.');}
  if(origin.protocol!=='https:'||origin.origin!==config.publicOrigin||origin.username||origin.password)fail('Use an HTTPS origin without a path.');
  fields(config.provider,['account','apiKeyEnv'],'provider');
  if(!/^[A-Za-z0-9_-]{1,80}$/.test(config.provider.account??''))fail('Set a stable provider account label for its shared budget.');
  if(config.provider.apiKeyEnv!==undefined&&!/^[A-Za-z_][A-Za-z0-9_]{0,127}$/.test(config.provider.apiKeyEnv))fail('Use an environment variable name for the server API key.');
  fields(config.budget,['creditsPerDay','requestsPerSecond'],'budget');
  integer(config.budget.creditsPerDay,1,100000000,'daily credit limit');
  integer(config.budget.requestsPerSecond,1,100,'requests per second');
  config.timeoutMs=integer(config.timeoutMs??30000,1000,120000,'source timeout');
  config.maxResponseBytes=integer(config.maxResponseBytes??16777216,1024,16777216,'response byte limit');
  if(!Array.isArray(config.products)||!config.products.length||config.products.length>32)fail('Configure 1–32 research products.');
  const ids=new Set(),paths=new Set(),products=[],routes=[];
  for(const p of config.products){
    fields(p,['id','path','entity','kind','requireFilter','description','paymentOptions','example'],'product');
    if(!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(p.id??'')||ids.has(p.id)||
       !/^\/[A-Za-z0-9_/-]+$/.test(p.path??'')||p.path.includes('//')||p.path.startsWith('/_seller/')||paths.has(p.path))fail('Products require unique IDs and fixed paths.');
    if(!Object.hasOwn(ENTITIES,p.entity)||!['list','entity'].includes(p.kind)||typeof p.requireFilter!=='boolean')fail('Choose an entity, request kind and explicit filter requirement.');
    ids.add(p.id);paths.add(p.path);text(p.description,'product description',512);
    const parameters=(p.kind==='entity'?['id','select']:LIST_PARAMETERS).map(name=>({
      name,type:'string',required:name==='id',description:name==='id'?'The OpenAlex ID of the selected entity':
        name==='cursor'?'Exact meta.next_cursor from the previous response; start with *':
        name==='per_page'?'Records per page, from 1 to 100':name==='filter'?'OpenAlex attribute:value filters; use entity IDs for relationships':name,
      example:p.example?.[name]===undefined?'':String(p.example[name])
    }));
    const offer=compileHttpSellerOffer({url:config.publicOrigin+p.path,method:'GET',description:p.description,
      serviceName:'OpenAlex research metadata',tags:['research','openalex'],paymentOptions:p.paymentOptions,queryParameters:parameters,mimeType:'application/json'});
    const schema=offer.extensions.bazaar.schema.properties.input.properties.queryParams;
    for(const param of parameters){
      schema.properties[param.name].maxLength=param.name==='id'?100:3500;
      if(p.example?.[param.name]===undefined)delete offer.extensions.bazaar.info.input.queryParams[param.name];
    }
    const product={...p,offer,upstreamPath:'/'+p.entity+(p.kind==='entity'?'/:entityId':'')};
    products.push(product);routes.push({id:p.id,path:p.path,offer,validateInput:true,handler:p.id,admit:p.id+'Admission'});
  }
  const service={schema:'stellar-forge.seller-service.v1',publicOrigin:config.publicOrigin,
    handlerTimeoutMs:Math.min(120000,config.timeoutMs+1000),maxResponseBytes:config.maxResponseBytes,routes};
  const compiled={config,products,service,inputSha256:sha256(json(config))};
  for(const p of products)requestFor(compiled,p.id,p.example);
  compileSellerRoutes(routes.map(({id,offer})=>({id,offer,handler:async()=>({status:503,body:null})})));
  return compiled;
}
export function merchantOpenApi(compiled,mode='CHALLENGE_ONLY'){
  return compileSellerOpenApi(compileSellerRoutes(compiled.service.routes.map(({id,offer})=>({id,offer,handler:async()=>({status:503,body:null})}))),{mode});
}
export function merchantReview(compiled){
  return {schema:'stellar-forge.openalex-review.v1',title:compiled.config.title,inputSha256:compiled.inputSha256,
    publicOrigin:compiled.config.publicOrigin,provider:{origin:ORIGIN,...compiled.config.provider},budget:compiled.config.budget,
    documentation:DOCUMENTATION,metadataLicense:'CC0',creditUsd:0.0001,
    products:compiled.products.map(({id,path,entity,kind,description,requireFilter,example,offer})=>({id,path,entity,kind,description,requireFilter,example,paymentOptions:offer.accepts})),
    paging:{perPageMaximum:100,basicResultLimit:10000,cursorStart:'*',cursorResponseField:'meta.next_cursor'},
    pricing:{asOf:'2026-10-11',source:'https://help.openalex.org/access/example-costs/',listFilterCredits:1,searchCredits:10,singletonCredits:0},
    licenseScope:'OpenAlex metadata. Linked articles, repositories and PDFs retain their own licenses.'};
}
export async function readOpenAlexMerchant(file){
  const path=resolve(file),s=await lstat(path);
  if(!s.isFile()||s.isSymbolicLink()||s.size>1048576)fail('Use a regular merchant JSON file up to 1 MiB.');
  return compileOpenAlexMerchant(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(await readFile(path))));
}
