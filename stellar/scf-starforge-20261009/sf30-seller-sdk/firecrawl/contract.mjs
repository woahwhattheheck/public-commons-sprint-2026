// MIT. Firecrawl v2 product inputs and retained result projection.
import {isIP} from 'node:net';
import {createHash} from 'node:crypto';
export const PRODUCT_SCHEMA='stellar-forge.firecrawl-product.v1';
export const OPERATIONS=Object.freeze({
  'firecrawl-search':{path:'/research/search',handler:'firecrawlSearch',upstream:'/v2/search',kind:'search'},
  'firecrawl-search-content':{path:'/research/search-content',handler:'firecrawlSearchContent',upstream:'/v2/search',kind:'search-content'},
  'firecrawl-read':{path:'/research/read',handler:'firecrawlRead',upstream:'/v2/scrape',kind:'read'},
});
export const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&[Object.prototype,null].includes(Object.getPrototypeOf(v));
export const need=(condition,code)=>{if(!condition)throw Object.assign(new Error(code),{code});};
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export const encoded=v=>Buffer.from(JSON.stringify(v)+'\n');
const own=(v,k)=>Object.hasOwn(v,k);
const integer=(v,min,max,code)=>{need(Number.isSafeInteger(v)&&v>=min&&v<=max,code);return v;};
const text=(v,max,code)=>{need(typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v),code);return v;};
function shape(v,keys,code){need(plain(v)&&Object.keys(v).every(k=>keys.includes(k)),code);}
export function publicUrl(value){
  text(value,4096,'PUBLIC_URL_REQUIRED');
  let url;try{url=new URL(value);}catch{need(false,'PUBLIC_URL_REQUIRED');}
  const host=url.hostname.toLowerCase().replace(/\.$/,'');
  need(['http:','https:'].includes(url.protocol)&&!url.username&&!url.password&&!url.hash&&
    !url.port&&host.includes('.')&&!isIP(host.replace(/^\[|\]$/g,''))&&
    !['localhost','local','localdomain','internal','home.arpa'].some(x=>host===x||host.endsWith('.'+x)),
    'PUBLIC_URL_REQUIRED');
  return value;
}
function domains(value){
  need(Array.isArray(value)&&value.length>0&&value.length<=100,'DOMAIN_LIST_REQUIRED');
  const seen=new Set();
  for(const host of value){
    text(host,253,'DOMAIN_HOSTNAME_REQUIRED');
    need(host===host.toLowerCase()&&!seen.has(host)&&host.split('.').length>=2&&
      host.split('.').every(p=>/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(p)),'DOMAIN_HOSTNAME_REQUIRED');
    publicUrl('https://'+host);seen.add(host);
  }
  return [...value];
}
export function policy(input={}){
  shape(input,['maxResultsPerSource','maxSources','sourceTimeoutMs','maxResponseBytes','maxInFlight'],'PRODUCT_POLICY_INVALID');
  return Object.freeze({
    maxResultsPerSource:integer(input.maxResultsPerSource??10,1,100,'RESULT_LIMIT_INVALID'),
    maxSources:integer(input.maxSources??3,1,3,'SOURCE_LIMIT_INVALID'),
    sourceTimeoutMs:integer(input.sourceTimeoutMs??60000,1000,110000,'SOURCE_TIMEOUT_INVALID'),
    maxResponseBytes:integer(input.maxResponseBytes??1048576,1024,1048576,'RESPONSE_LIMIT_INVALID'),
    maxInFlight:integer(input.maxInFlight??4,1,256,'CAPACITY_INVALID'),
  });
}
/** Validate twice: original pre-payment admission, then verified handler.
 * No upstream browser actions, custom credentials or caller-chosen API origin.
 * The original query and explicit filters are preserved verbatim. */
export function prepareInput(operation,input,p=policy()){
  need(own(OPERATIONS,operation),'FIRECRAWL_OPERATION_UNKNOWN');
  let body;
  if(operation==='firecrawl-read'){
    shape(input,['url'],'READ_INPUT_INVALID');
    body={url:publicUrl(input.url),formats:['markdown','links'],onlyMainContent:true,timeout:p.sourceTimeoutMs};
  }else{
    shape(input,['query','limit','sources','includeDomains','excludeDomains','location','country','tbs','highlights'],'SEARCH_INPUT_INVALID');
    body={query:text(input.query,500,'QUERY_REQUIRED_MAX_500'),
      limit:integer(input.limit??3,1,p.maxResultsPerSource,'RESULT_LIMIT_INVALID')};
    const sources=input.sources??['web'];
    need(Array.isArray(sources)&&sources.length>0&&sources.length<=p.maxSources&&
      new Set(sources).size===sources.length&&sources.every(s=>['web','news','images'].includes(s)),'SOURCES_INVALID');
    body.sources=[...sources];body.domainTools=false;body.timeout=p.sourceTimeoutMs;
    need(!(own(input,'includeDomains')&&own(input,'excludeDomains')),'DOMAIN_FILTERS_MUTUALLY_EXCLUSIVE');
    for(const name of ['includeDomains','excludeDomains'])if(own(input,name))body[name]=domains(input[name]);
    for(const name of ['location','tbs'])if(own(input,name))body[name]=text(input[name],500,'SEARCH_FILTER_INVALID');
    if(own(input,'country')){need(typeof input.country==='string'&&/^[A-Za-z]{2}$/.test(input.country),'COUNTRY_INVALID');body.country=input.country;}
    if(own(input,'highlights')){need(typeof input.highlights==='boolean','HIGHLIGHTS_INVALID');body.highlights=input.highlights;}
    if(operation==='firecrawl-search-content')body.scrapeOptions={formats:['markdown','links'],onlyMainContent:true};
  }
  return body;
}
export function requestInput(operation,input,p=policy()){
  prepareInput(operation,input,p);
  return structuredClone(input);
}
export function requestContext(operation,context,p){
  const definition=OPERATIONS[operation];
  need(context?.method==='POST'&&context.url instanceof URL&&context.url.pathname===definition.path&&
    !context.url.search&&context.bodyPresent!==false&&
    (context.bodyType===undefined||context.bodyType==='json')&&!context.multipart,'FIRECRAWL_REQUEST_INVALID');
  const body=prepareInput(operation,context.body,p);
  return {...context,body,rawBody:Buffer.from(JSON.stringify(body)),bodyPresent:true,bodyType:'json',multipart:null};
}
export function resultView(operation,payload){
  need(plain(payload)&&payload.success===true&&plain(payload.data),'FIRECRAWL_RESPONSE_INVALID');
  const groups={web:[],news:[],images:[]};
  if(operation==='firecrawl-read'){
    groups.web=[{...payload.data,url:payload.data.metadata?.sourceURL??payload.data.metadata?.url??null}];
  }else{
    for(const key of Object.keys(groups)){
      const values=payload.data[key]??[];
      need(Array.isArray(values)&&values.length<=100&&values.every(plain),'FIRECRAWL_RESULT_GROUP_INVALID');
      groups[key]=values;
    }
  }
  const rows=[];
  for(const [group,values] of Object.entries(groups)){
    for(let index=0;index<values.length;index++){
      const original=values[index],url=typeof original.url==='string'?original.url:
        typeof original.metadata?.sourceURL==='string'?original.metadata.sourceURL:null;
      rows.push({
        id:sha(encoded([operation,group,index,url,original.imageUrl??null])),
        group,index,url,title:typeof original.title==='string'?original.title:original.metadata?.title??'Untitled result',
        description:original.description??original.snippet??original.metadata?.description??'',
        date:original.date??null,imageUrl:original.imageUrl??null,
        hasContent:typeof original.markdown==='string'||typeof original.html==='string'||typeof original.rawHtml==='string',
        contentSha256:sha(encoded({markdown:original.markdown??null,html:original.html??null,rawHtml:original.rawHtml??null})),
        original,
      });
    }
  }
  return {rows,counts:Object.fromEntries(Object.entries(groups).map(([k,v])=>[k,v.length])),
    warning:payload.warning??null,providerRequestId:payload.id??null,creditsUsed:payload.creditsUsed??null,
    additionalDataKeys:Object.keys(payload.data).filter(k=>!Object.hasOwn(groups,k))};
}
export function responseSchema(operation){
  const data=operation==='firecrawl-read'?{type:'object'}:{type:'object',
    properties:Object.fromEntries(['web','news','images'].map(k=>[k,{type:'array',maxItems:100,items:{type:'object'}}]))};
  return {type:'object',properties:{success:{type:'boolean',const:true},data},required:['success','data']};
}
