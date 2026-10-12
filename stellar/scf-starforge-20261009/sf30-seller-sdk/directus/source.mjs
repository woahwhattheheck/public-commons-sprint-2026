// MIT. Exact Directus collection captures and reviewed SF30 editions.
import {SEMANTICS_SCHEMA,MAX_SOURCE_BYTES,hash,canonical,fault,object,text,safeInputJSON,
  parseNativeJSON,nativeJSON,nativePlain,canonicalNative,responseData,nativeCount,buildDirectusSemantics} from './semantics.mjs';
export {MAX_SOURCE_BYTES,hash,canonical,fault,object} from './semantics.mjs';
export const SOURCE_SCHEMA='directus-source-capture/v1';
export const PROJECTION_SCHEMA='stellar-forge.directus-projection.v1';
export const DIRECTUS_UPSTREAM='4f77933bf9551cac6b289576078783e189b8f4e3';
const HAS=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const HASH=/^[a-f0-9]{64}$/;
export function directusBase(value){
  let url;try{url=new URL(text(value,'Directus base URL'));}catch{throw fault('DIRECTUS_URL','Use the original HTTP(S) Directus base URL.');}
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)
    throw fault('DIRECTUS_URL','Use an HTTP(S) Directus base URL without credentials, query or fragment.');
  if(!url.pathname.endsWith('/'))url.pathname+='/';
  return url.href;
}
export function collectionName(value){
  text(value,'Collection name',200);
  if(value.startsWith('directus_')||/[\/\\?#]/.test(value)||value==='.'||value==='..')
    throw fault('DIRECTUS_COLLECTION','Select an original user collection through its native items endpoint.');
  return value;
}
function words(value,label){
  const list=typeof value==='string'?value.split(','):value;
  if(!Array.isArray(list)||!list.length||list.length>256||list.some(v=>typeof v!=='string'||!v.length||v.includes(',')||/[\u0000-\u001f]/.test(v))||new Set(list).size!==list.length)
    throw fault('DIRECTUS_QUERY',label+' must contain unique native names.');
  return [...list];
}
export function normalizeDirectusQuery(input={},primaryKey){
  if(!object(input))throw fault('DIRECTUS_QUERY','The selected Directus query must be an object.');
  const allowed=new Set(['fields','sort','filter','search','deep']);
  for(const key of Object.keys(input))if(!allowed.has(key))
    throw fault('DIRECTUS_QUERY','Collection capture uses original fields/sort/filter/search/deep; it owns count and complete pagination. Unsupported query: '+key);
  const query={};
  const fields=words(input.fields??['*'],'fields');
  if(!fields.includes('*')&&!fields.includes(primaryKey))fields.push(primaryKey);
  query.fields=fields;
  const sort=words(input.sort??[primaryKey],'sort');
  if(!sort.some(v=>v.replace(/^-/,'')===primaryKey))sort.push(primaryKey);
  query.sort=sort;
  for(const key of ['filter','deep'])if(HAS(input,key)){
    if(!object(input[key]))throw fault('DIRECTUS_QUERY',key+' must be original structured JSON.');
    safeInputJSON(input[key]);query[key]=input[key];
  }
  if(HAS(input,'search'))query.search=text(input.search,'Search',8192);
  return query;
}
export function directusItemsURL(base,collection,query,limit,offset){
  const url=new URL('items/'+encodeURIComponent(collectionName(collection)),directusBase(base));
  for(const [key,value]of Object.entries(query))
    url.searchParams.set(key,Array.isArray(value)?value.join(','):object(value)?safeInputJSON(value):String(value));
  url.searchParams.set('limit',String(limit));url.searchParams.set('offset',String(offset));
  url.searchParams.set('meta','filter_count,total_count');return url.href;
}
function exactResponse(request,base){
  if(!object(request)||typeof request.id!=='string'||!request.id||request.method!=='GET'||request.status!==200)
    throw fault('DIRECTUS_SOURCE_REQUEST','A complete source requires successful original GET responses with stable IDs.');
  let url;try{url=new URL(request.url);}catch{throw fault('DIRECTUS_SOURCE_URL','Invalid retained request URL.');}
  const root=new URL(base);
  if(url.origin!==root.origin||!url.pathname.startsWith(root.pathname)||url.username||url.password||url.hash||
    [...url.searchParams.keys()].some(k=>/token|password|secret/i.test(k)))
    throw fault('DIRECTUS_SOURCE_URL','Every source response must belong to the selected Directus service without credential query parameters.');
  if(typeof request.body_text!=='string'||!Number.isSafeInteger(request.body_bytes)||!HASH.test(request.body_sha256??''))
    throw fault('DIRECTUS_SOURCE_BODY','Retain complete original UTF-8 response bytes and their digest.');
  const bytes=Buffer.from(request.body_text);
  if(bytes.length!==request.body_bytes||hash(bytes)!==request.body_sha256)
    throw fault('DIRECTUS_SOURCE_DIGEST','A native response differs from its recorded bytes.');
  const node=parseNativeJSON(request.body_text);
  return {request,node,data:responseData(node)};
}
function rawSchema(collection,fields,relations){
  return {collection:canonicalNative(collection),fields:canonicalNative(fields),relations:canonicalNative(relations)};
}
function fieldSchema(collection,fields,relations,name){
  if(collection.type!=='object'||fields.type!=='array'||relations.type!=='array')
    throw fault('DIRECTUS_SOURCE_SCHEMA','Retain the actual collection, fields and relations responses.');
  const c=nativePlain(collection),f=fields.value.map(nativePlain),r=relations.value.map(nativePlain);
  if(c.collection!==name||!f.length||f.some(v=>!object(v)||v.collection!==name||typeof v.field!=='string'||!v.field))
    throw fault('DIRECTUS_SOURCE_SCHEMA','The native field definitions do not identify the selected collection.');
  if(new Set(f.map(v=>v.field)).size!==f.length)throw fault('DIRECTUS_SOURCE_SCHEMA','Native field definitions are duplicated.');
  const primary=f.filter(v=>v.schema?.is_primary_key===true);
  if(primary.length!==1)throw fault('DIRECTUS_PRIMARY_KEY','A collection capture requires the caller-visible original primary-key field.');
  return {collection:c,fields:f,relations:r,primaryKey:primary[0].field,singleton:c.meta?.singleton===true};
}
function principal(node){
  const p=nativePlain(node);
  if(node.type!=='object'||typeof p.id!=='string'||!p.id)
    throw fault('DIRECTUS_PRINCIPAL','Retain the authenticated /users/me user identity.');
  return p;
}
function reference(r){
  return {id:r.id,kind:r.kind??null,method:r.method,url:r.url,status:r.status,
    received_at:r.received_at??null,body_finished_at:r.body_finished_at??null,
    body_bytes:r.body_bytes,body_sha256:r.body_sha256,content_type:r.content_type??null};
}

/** The inspector derives completeness from exact two-pass responses, never a declared complete flag. */
export function inspectDirectusSource(input){
  const bytes=Buffer.isBuffer(input)?input:Buffer.from(input);
  if(!bytes.length||bytes.length>MAX_SOURCE_BYTES)throw fault('DIRECTUS_SOURCE_SIZE','Select a complete Directus capture up to 256 MiB.');
  let document;
  try{const original=new TextDecoder('utf-8',{fatal:true}).decode(bytes);parseNativeJSON(original);document=JSON.parse(original);}
  catch{throw fault('DIRECTUS_SOURCE_JSON','The source capture must contain complete UTF-8 JSON.');}
  if(!object(document)||document.schema!==SOURCE_SCHEMA||!Array.isArray(document.requests)||!document.requests.length||document.requests.length>100000)
    throw fault('DIRECTUS_SOURCE_FORMAT','Select the original directus-source-capture/v1 export.');
  const base=directusBase(document.base_url),collection=collectionName(document.scope?.collection);
  const responses=new Map();
  for(const r of document.requests){
    if(responses.has(r?.id))throw fault('DIRECTUS_SOURCE_REQUEST','Original request IDs must be unique.');
    responses.set(r?.id,exactResponse(r,base));
  }
  const exact=(id,relative)=>{
    const r=responses.get(id);
    if(!r||r.request.url!==new URL(relative,base).href)throw fault('DIRECTUS_SOURCE_BINDING','Missing or mismatched native source response: '+id);
    return r.data;
  };
  const principalURL='users/me?fields=id%2Crole%2Cstatus';
  const serverBefore=exact('server-before','server/info'),serverAfter=exact('server-after','server/info');
  if(serverBefore.type!=='object'||serverAfter.type!=='object'||serverBefore.value.version?.value!=='12.5.0'||serverAfter.value.version?.value!=='12.5.0')
    throw fault('DIRECTUS_SERVER_VERSION','A complete source must retain both actual Directus 12.5.0 server observations.',409);
  const observedServer=nativePlain(serverBefore);
  const p=principal(exact('principal-before',principalURL));
  const endPrincipal=principal(exact('principal-after',principalURL));
  if(canonical(p)!==canonical(endPrincipal))throw fault('DIRECTUS_PRINCIPAL_CHANGED','The authenticated user changed during source capture.',409);
  const collectionURL='collections/'+encodeURIComponent(collection),fieldsURL='fields/'+encodeURIComponent(collection),relationsURL='relations/'+encodeURIComponent(collection);
  const before={collection:exact('collection-before',collectionURL),fields:exact('fields-before',fieldsURL),relations:exact('relations-before',relationsURL)};
  const after={collection:exact('collection-after',collectionURL),fields:exact('fields-after',fieldsURL),relations:exact('relations-after',relationsURL)};
  const schemaRaw=rawSchema(before.collection,before.fields,before.relations);
  if(canonical(schemaRaw)!==canonical(rawSchema(after.collection,after.fields,after.relations)))
    throw fault('DIRECTUS_SCHEMA_CHANGED','The native collection, field or relation definition changed during capture.',409);
  const schema=fieldSchema(before.collection,before.fields,before.relations,collection),pk=schema.primaryKey;
  const query=normalizeDirectusQuery(document.scope?.selected_query??document.scope?.query??{},pk);
  if(canonical(query)!==canonical(document.scope?.query)||document.scope.primary_key!==pk)
    throw fault('DIRECTUS_QUERY_BINDING','The selected query and native primary key differ from the retained source.');
  const limit=document.scope.page_size;
  if(!Number.isSafeInteger(limit)||limit<1||limit>10000)throw fault('DIRECTUS_PAGE_SIZE','Use a page size from 1 to 10000.');
  const passes=document.pagination?.passes;
  if(!Array.isArray(passes)||passes.length!==2||passes.some(v=>!Array.isArray(v)||!v.length))
    throw fault('DIRECTUS_PAGINATION','Retain both complete original item passes.');
  const consumed=new Set();
  function pass(ids){
    let offset=0,total=null,ended=false;const items=[],seen=new Set(),pages=[];
    for(const id of ids){
      const saved=responses.get(id);
      if(!saved||consumed.has(id)||ended)throw fault('DIRECTUS_PAGINATION','A source page is missing, reused or follows the terminal page.');
      consumed.add(id);
      if(saved.request.url!==directusItemsURL(base,collection,query,limit,offset))
        throw fault('DIRECTUS_PAGINATION','An original page does not match its exact query, offset and requested limit.');
      const root=saved.node;
      if(root.value.meta?.type!=='object')throw fault('DIRECTUS_COUNT','Each page must retain native permission-scoped filter_count.');
      const n=nativeCount(root.value.meta.value.filter_count,'filter_count');
      if(total===null)total=n;
      if(total!==n)throw fault('DIRECTUS_COUNT_CHANGED','The permission-scoped result count changed during pagination.',409);
      const d=saved.data;
      const page=schema.singleton?(d.type==='null'?[]:d.type==='object'?[d]:null):d.type==='array'?d.value:null;
      if(!page)throw fault('DIRECTUS_ITEMS','Native item data differs from its collection/singleton shape.');
      if(page.length>limit||schema.singleton&&page.length>1)throw fault('DIRECTUS_PAGINATION','The native page exceeds its requested result window.');
      for(const item of page){
        if(item.type!=='object'||!item.value[pk]||!['string','number'].includes(item.value[pk].type))
          throw fault('DIRECTUS_ITEM_KEY','Every native row must retain its original scalar primary key.');
        const key=canonicalNative(item.value[pk]);
        if(seen.has(key))throw fault('DIRECTUS_DUPLICATE_ITEM','The same item key appeared more than once in pagination.',409);
        seen.add(key);
        items.push({key,object_sha256:hash(canonicalNative(item)),object_json:nativeJSON(item),object:nativePlain(item),
          fields:Object.keys(item.value),values:Object.fromEntries(Object.entries(item.value).map(([field,v])=>[field,{
            state:v.type==='null'?'null':'value',kind:v.type,json:nativeJSON(v)}])),
          origins:[reference(saved.request)]});
      }
      pages.push({request_id:id,offset,requested_limit:limit,returned:page.length,filter_count:n});
      offset+=page.length;
      if(offset>total)throw fault('DIRECTUS_COUNT_CHANGED','Returned rows exceed the native filtered count.',409);
      ended=schema.singleton||page.length===0;
    }
    if(!ended||offset!==total)throw fault('DIRECTUS_PAGINATION_INCOMPLETE','Continue the original pages through a native empty terminator and the exact filtered count.');
    return {items,pages,total};
  }
  const first=pass(passes[0]),second=pass(passes[1]);
  if(first.total!==second.total||canonical(first.items.map(v=>[v.key,v.object_sha256]))!==canonical(second.items.map(v=>[v.key,v.object_sha256])))
    throw fault('DIRECTUS_ITEMS_CHANGED','Two complete original item passes differ; continue with a fresh source capture.',409);
  for(let i=0;i<first.items.length;i++)first.items[i].origins.push(...second.items[i].origins);
  const digest=hash(bytes),nativeSchema={collection:schema.collection,fields:schema.fields,relations:schema.relations};
  return {schema:'stellar-forge.directus-source.v1',id:'source-'+digest,sha256:digest,bytes:bytes.length,
    name:typeof document.name==='string'?document.name:'Directus '+collection,base_url:base,recorded_at:document.recorded_at??null,
    source:{provider:'directus',protocolVersion:'12.5',upstreamCommit:DIRECTUS_UPSTREAM,
      body_kind:'original-authenticated-http-json',consistency:'two-matched-complete-reads'},
    principal:p,server:{version:observedServer.version,queryLimit:observedServer.queryLimit??null,license:observedServer.license??null},native_schema:nativeSchema,schema_sha256:hash(canonical(schemaRaw)),
    scope:{collection,primary_key:pk,singleton:schema.singleton,selected_query:document.scope.selected_query??{},
      query,complete:true,observed_items:first.total,observed_pages:[first.pages,second.pages],
      consistency:'two-matched-complete-reads',snapshot_isolation:false},
    items:first.items,item_count:first.total,requests:document.requests.map(reference)};
}
const csvCell=value=>'"'+String(value).replaceAll('"','""')+'"';
export function encodeCsv(fields,rows){
  return Buffer.from([fields.map(csvCell).join(','),...rows.map(row=>fields.map(key=>csvCell(row[key])).join(','))].join('\n')+'\n');
}
export function projectDirectusSources(sources,input){
  if(!object(input)||input.mode!=='collection')throw fault('DIRECTUS_MODE','Choose the collection row form.');
  const name=text(input.name,'Dataset name',128);
  if(!Array.isArray(input.selection)||input.selection.length!==1||!object(input.selection[0]))
    throw fault('DIRECTUS_SELECTION','Select one exact retained collection capture per edition.');
  const choice=input.selection[0],source=sources.find(v=>v.id===choice.sourceId);
  if(!source||source.schema!=='stellar-forge.directus-source.v1'||source.scope.complete!==true)
    throw fault('DIRECTUS_SOURCE_MISSING','Select a complete original Directus source.');
  if(choice.collection!==source.scope.collection||choice.sourceSha256!==source.sha256)
    throw fault('DIRECTUS_SOURCE_CHANGED','Select the exact source digest and collection.',409);
  if(!Array.isArray(input.metadataFields)||!input.metadataFields.length||input.metadataFields.length>32||
      input.metadataFields.some(v=>typeof v!=='string'||!v)||new Set(input.metadataFields).size!==input.metadataFields.length)
    throw fault('DIRECTUS_FIELDS','Select 1–32 unique original top-level fields.');
  const fields=[...input.metadataFields];
  const declared=new Set(source.native_schema.fields.map(v=>v.field));
  if(fields.some(v=>!declared.has(v)))throw fault('DIRECTUS_FIELD_MISSING','A selected field has no native definition.');
  if(!object(input.rights))throw fault('DIRECTUS_RIGHTS','Retain attribution and the intended distribution basis.');
  let reference=null;
  if(input.rights.reference){try{const u=new URL(input.rights.reference);if(!['http:','https:'].includes(u.protocol)||u.username||u.password)throw new Error();reference=u.href;}catch{throw fault('DIRECTUS_RIGHTS','Use an HTTP(S) attribution reference without credentials.');}}
  const rights={attribution:text(input.rights.attribution,'Attribution',16000),basis:text(input.rights.basis,'Distribution basis',16000),reference};
  const {semantics,pairs}=buildDirectusSemantics(source,fields),rows=[],records=[];
  for(const item of source.items){
    const row={};
    for(const pair of pairs){
      const value=item.values[pair.field],state=value?.state??'missing';
      row[pair.value]=state==='value'?value.json:'';
      row[pair.state]=state;
    }
    rows.push(row);records.push({key:canonical([source.scope.collection,item.key]),row,
      source_id:source.id,source_sha256:source.sha256,source_url:source.base_url+'items/'+encodeURIComponent(source.scope.collection),
      item_sha256:item.object_sha256});
  }
  const names=pairs.flatMap(v=>[v.value,v.state]),csv=encodeCsv(names,rows);
  if(csv.length>MAX_SOURCE_BYTES||rows.length>1000000)throw fault('DIRECTUS_DATASET_LIMIT','The selected collection exceeds original SF30 dataset limits.');
  const columns=Object.fromEntries(names.map(n=>[n,{type:'string',nullable:false}]));
  const filters=pairs.slice(0,8).map(v=>v.value),sorts=pairs.slice(0,8).map(v=>v.value);
  const config={schema:'stellar-forge.csv-dataset.v1',file:'data.csv',name,columns,filters,sorts,ranges:[],
    maxBytes:Math.max(csv.length,1),maxRows:Math.max(rows.length,1),maxCellChars:1024*1024,
    defaultLimit:20,maxLimit:100,maxPageBytes:900*1024,semantics};
  return {schema:PROJECTION_SCHEMA,name,mode:'collection',
    selection:[{sourceId:source.id,sourceSha256:source.sha256,collection:source.scope.collection}],
    metadataFields:fields,rights,columns:names,rows,records,source_ids:[source.id],
    item_count:source.item_count,row_count:rows.length,csv,config};
}
export function compareDirectusEditions(before,after){
  if(before.mode!=='collection'||after.mode!=='collection')throw fault('DIRECTUS_COMPARE_MODE','Compare collection editions.');
  if(before.selection?.[0]?.collection!==after.selection?.[0]?.collection)throw fault('DIRECTUS_COMPARE_COLLECTION','Compare editions of the same original collection.');
  const left=new Map(before.records.map(v=>[v.key,v])),right=new Map(after.records.map(v=>[v.key,v])),changes=[],source_changes=[];
  for(const [key,row]of left){
    const next=right.get(key);
    if(!next)changes.push({key,kind:'removed',before:row.row,after:null});
    else{
      if(row.source_sha256!==next.source_sha256)source_changes.push({key,before:row.source_sha256,after:next.source_sha256});
      if(canonical(row.row)!==canonical(next.row))changes.push({key,kind:'changed',before:row.row,after:next.row,
        fields:[...new Set([...Object.keys(row.row),...Object.keys(next.row)])].filter(k=>row.row[k]!==next.row[k])});
    }
  }
  for(const [key,row]of right)if(!left.has(key))changes.push({key,kind:'added',before:null,after:row.row});
  return {schema:'stellar-forge.directus-comparison.v1',before_id:before.id,after_id:after.id,
    before_sha256:before.sha256,after_sha256:after.sha256,mode:'collection',
    counts:{added:changes.filter(v=>v.kind==='added').length,removed:changes.filter(v=>v.kind==='removed').length,
      changed:changes.filter(v=>v.kind==='changed').length,provenance_changed:source_changes.length,
      unchanged:left.size-changes.filter(v=>v.kind!=='added').length},
    metadata_fields_before:before.metadataFields,metadata_fields_after:after.metadataFields,
    rights_before:before.rights,rights_after:after.rights,source_changes,changes};
}
