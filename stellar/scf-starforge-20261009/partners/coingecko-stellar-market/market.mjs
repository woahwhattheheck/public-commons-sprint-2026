// MIT. Source-bound market rows and exact-decimal comparison; no float conversion.
import {plain,sha,need} from './common.mjs';
import {parseExactJSON,pointer,decimal,decimalDifference} from './exact-json.mjs';

const addressKey=value=>typeof value==='string'&&/^0x[0-9a-fA-F]{40}$/.test(value)?value.toLowerCase():value;
const label=value=>value.replace(/_/g,' ').replace(/\b(usd|fdv|id|api)\b/gi,x=>x.toUpperCase());
function networkOf(item,requested) {
  const address=item?.attributes?.address,id=item?.id;
  if(typeof address==='string'&&typeof id==='string'&&id.endsWith('_'+address))return id.slice(0,-address.length-1);
  return requested??null;
}
function fieldType(key,value,number) {
  if(value===null)return 'null';
  if(typeof value==='boolean')return 'boolean';
  if(/(?:last_updated_at|last_trade_timestamp|timestamp)$/.test(key))return 'timestamp';
  if(typeof value==='string'&&decimal(value)&&(/price|market_cap|fdv|volume|reserve|liquidity|balance|percentage|supply/.test(key)||number))
    return /(?:buys|sells|buyers|sellers|decimals|community_sus_report)$/.test(key)?'integer':'decimal';
  return typeof value;
}
function flatten(object,sourcePointer,numbers,base='') {
  const fields=[];
  function visit(value,key,path) {
    if(value!==null&&typeof value==='object') {
      const entries=Object.entries(value);
      if(!entries.length)fields.push({key,label:label(key.replace(/\./g,' / ')),value:Array.isArray(value)?'[]':'{}',type:'json',sourcePointer:path});
      for(const [name,child] of entries)visit(child,key?key+'.'+name:name,pointer(path,name));
    } else fields.push({key,label:label(key.replace(/\./g,' / ')),value,
      type:fieldType(key,value,Object.hasOwn(numbers,path)),sourcePointer:path});
  }
  for(const [name,value] of Object.entries(object??{}))visit(value,base?base+'.'+name:name,pointer(sourcePointer,name));
  return fields;
}
function identityKey(kind,identity) {
  return JSON.stringify([kind,identity.network??null,
    identity.address?addressKey(identity.address):identity.coinId??identity.providerId??identity.symbol??null,
    identity.providerType??null]);
}
function relationships(item,included) {
  const result=[];
  for(const [name,rel] of Object.entries(item.relationships??{})) {
    const values=Array.isArray(rel?.data)?rel.data:rel?.data?[rel.data]:[];
    for(const value of values) {
      const key=JSON.stringify([value.type,value.id]),matches=included.get(key)??[];
      result.push({name,type:value.type,id:value.id,resolved:matches.length===1,
        ...(matches.length>1?{ambiguity:'DUPLICATE_INCLUDED_IDENTITY'}:{})});
    }
  }
  return result;
}
export function analyzeMarketResponse(bytes,request,captureId) {
  const parsed=parseExactJSON(bytes),body=parsed.value,rows=[],notices=[],sourceTimes=[],missing=[];
  const requestedNetwork=request.path?.network??request.query?.network??null;
  const included=Array.isArray(body?.included)?body.included:[],byIdentity=new Map();
  included.forEach((item,index)=>{
    const key=JSON.stringify([item?.type,item?.id]),entries=byIdentity.get(key)??[];
    entries.push({item,index});byIdentity.set(key,entries);
  });
  const usedKeys=new Set();
  function add({kind,identity,name,fields,sourcePointer,relations=[],localNotices=[]}) {
    let key=JSON.stringify([request.reference??request.requestReference??request.id??request.requestId,request.endpoint,identityKey(kind,identity)]);
    if(usedKeys.has(key)){localNotices.push({code:'DUPLICATE_SOURCE_IDENTITY',message:'Repeated native identity is kept as a separate original row'});key+='@'+sourcePointer}
    usedKeys.add(key);
    const row={id:sha(Buffer.from(captureId+'\n'+key)).slice(0,40),key,kind,identity,name:String(name??identity.providerId??identity.coinId??identity.address??''),
      fields,relations,sourceCaptureId:captureId,sourcePointer,notices:localNotices};
    rows.push(row);
    for(const field of fields)if(field.type==='timestamp')sourceTimes.push({rowId:row.id,key:field.key,value:field.value,sourcePointer:field.sourcePointer});
    return row;
  }
  function entity(item,sourcePointer,kindOverride) {
    need(plain(item)&&typeof item.id==='string'&&typeof item.type==='string'&&plain(item.attributes),'INVALID_PROVIDER_ROW','Expected the original JSON:API identity and attributes');
    const network=networkOf(item,requestedNetwork),identity={providerId:item.id,providerType:item.type,
      ...(network?{network}:{}),...(typeof item.attributes.address==='string'?{address:item.attributes.address}:{}),
      ...(typeof item.attributes.coingecko_coin_id==='string'?{coinId:item.attributes.coingecko_coin_id}:{})};
    const localNotices=[];
    if(network&&requestedNetwork&&network!==requestedNetwork)localNotices.push({code:'SOURCE_NETWORK_DIFFERS_FROM_REQUEST',
      message:'Original entity network '+network+' differs from requested '+requestedNetwork+'; both identities are retained'});
    return add({kind:kindOverride??(item.type==='pool'?'pool':item.type==='token'?'token':'included'),identity,
      name:item.attributes.name??item.id,fields:[...flatten(item.attributes,pointer(sourcePointer,'attributes'),parsed.numbers),
        ...flatten(item.relationships??{},pointer(sourcePointer,'relationships'),parsed.numbers,'relationships')].map(field=>({
          ...field,label:field.key==='total_reserve_in_usd'?'Requested-token reserves across pools (USD)':
            field.key==='reserve_in_usd'&&item.type==='pool'?'Pool reserves (USD)':field.label})),
      sourcePointer,relations:relationships(item,byIdentity),localNotices});
  }
  if(request.endpoint==='simple-price') {
    need(plain(body)&&!Object.hasOwn(body,'error'),'INVALID_COIN_RESPONSE','Expected the original coin-price object');
    const returned=[];
    for(const [key,value] of Object.entries(body)) {
      const items=Array.isArray(value)?value:[value];
      for(let index=0;index<items.length;index++) {
        const item=items[index];need(plain(item),'INVALID_COIN_ROW');
        const sourcePointer=Array.isArray(value)?pointer(pointer('',key),index):pointer('',key);
        const coinId=typeof item.id==='string'?item.id:request.effectiveSelector==='ids'?key:undefined;
        const identity={providerId:key,...(coinId?{coinId}:{}),
          ...(request.effectiveSelector==='symbols'?{symbol:key}:{})};
        returned.push(coinId??key);
        add({kind:'coin',identity,name:item.name??coinId??key,fields:flatten(item,sourcePointer,parsed.numbers),sourcePointer});
      }
    }
    if(request.effectiveSelector==='ids')for(const selected of String(request.query?.ids??'').split(',').map(x=>x.trim()).filter(Boolean))
      if(!returned.includes(selected))missing.push({kind:'coin',coinId:selected,status:'OMITTED_BY_PROVIDER'});
  } else if(request.endpoint==='token-prices') {
    const attributes=body?.data?.attributes;need(plain(attributes)&&plain(attributes.token_prices),'INVALID_TOKEN_PRICE_RESPONSE');
    const prices=attributes.token_prices,returned=new Set();
    for(const [address,value] of Object.entries(prices)) {
      returned.add(addressKey(address));const fields=[];
      for(const [metric,values] of Object.entries(attributes))if(plain(values)&&Object.hasOwn(values,address)) {
        const sourcePointer=pointer(pointer('/data/attributes',metric),address);
        fields.push({key:metric,label:metric==='market_cap_usd'&&request.query?.mcap_fdv_fallback===true?
          'Market cap / FDV fallback permitted (USD)':metric==='total_reserve_in_usd'?'Requested-token reserves across pools (USD)':label(metric),value:values[address],type:fieldType(metric,values[address],Object.hasOwn(parsed.numbers,sourcePointer)),sourcePointer});
      }
      const localNotices=request.query?.mcap_fdv_fallback===true?
        [{code:'FDV_FALLBACK_PERMITTED',message:'The original request permits FDV fallback; the response does not identify which valuation was selected'}]:[];
      add({kind:'token',identity:{network:requestedNetwork,address,providerType:'token'},name:address,fields,
        sourcePointer:pointer('/data/attributes/token_prices',address),localNotices});
    }
    for(const address of String(request.path?.addresses??'').split(',').filter(Boolean))
      if(!returned.has(addressKey(address)))missing.push({kind:'token',network:requestedNetwork,address,status:'OMITTED_BY_PROVIDER'});
  } else if(['search-pools','trending-pools'].includes(request.endpoint)) {
    need(Array.isArray(body?.data),'INVALID_POOL_RESPONSE','Expected the original pool data array');
    body.data.forEach((item,index)=>entity(item,pointer('/data',index)));
  } else if(request.endpoint==='token-data') {
    need(plain(body?.data),'INVALID_TOKEN_RESPONSE');entity(body.data,'/data');
  } else need(false,'UNKNOWN_ENDPOINT');
  included.forEach((item,index)=>entity(item,pointer('/included',index),'included'));
  for(const key of parsed.duplicates)notices.push({code:'DUPLICATE_JSON_KEY',sourcePointer:key,message:'The original JSON contains a repeated object key; exact source bytes are retained'});
  const kinds={};for(const row of rows)kinds[row.kind]=(kinds[row.kind]??0)+1;
  return {rows,analysis:{rowCount:rows.length,kinds,missing,sourceTimes},notices};
}
function rowFields(row) {return new Map((row?.fields??[]).map(f=>[f.key,f]))}
export function compareMarketRows(beforeRows,afterRows,comparisonId) {
  const before=new Map(beforeRows.map(r=>[r.key,r])),after=new Map(afterRows.map(r=>[r.key,r]));
  need(before.size===beforeRows.length&&after.size===afterRows.length,'AMBIGUOUS_SNAPSHOT_ROWS','Snapshot contains the same tracked source identity more than once');
  const result=[],summary={new:0,resolved:0,changed:0,unchanged:0,lexicalChanges:0};
  for(const key of [...new Set([...before.keys(),...after.keys()])].sort()) {
    const a=before.get(key),b=after.get(key),aFields=rowFields(a),bFields=rowFields(b),fields=[];
    let changed=false,lexical=0;
    for(const fieldKey of [...new Set([...aFields.keys(),...bFields.keys()])].sort()) {
      const av=aFields.get(fieldKey),bv=bFields.get(fieldKey),presentA=!!av,presentB=!!bv;
      const numeric=av&&bv&&['decimal','integer','timestamp'].includes(av.type)&&['decimal','integer','timestamp'].includes(bv.type);
      const delta=numeric?decimalDifference(av.value,bv.value):null;
      const equal=presentA&&presentB&&(delta!==null?delta==='0':JSON.stringify(av.value)===JSON.stringify(bv.value));
      const change=!presentA?'added':!presentB?'removed':equal?'same':'changed';
      const wireChanged=presentA&&presentB&&JSON.stringify(av.value)!==JSON.stringify(bv.value);
      if(change!=='same')changed=true;if(wireChanged&&equal)lexical++;
      fields.push({key:fieldKey,label:bv?.label??av?.label,before:av?.value??null,after:bv?.value??null,
        beforePresent:presentA,afterPresent:presentB,change,wireChanged,
        ...(delta===null?{}:{decimalDelta:delta}),beforeSourcePointer:av?.sourcePointer??null,afterSourcePointer:bv?.sourcePointer??null});
    }
    const status=!a?'new':!b?'resolved':changed?'changed':'unchanged';summary[status]++;summary.lexicalChanges+=lexical;
    result.push({id:sha(Buffer.from(comparisonId+'\n'+key)).slice(0,40),key,kind:(b??a).kind,identity:(b??a).identity,name:(b??a).name,status,
      baselineRow:a??null,currentRow:b??null,fields});
  }
  return {rows:result,summary};
}
