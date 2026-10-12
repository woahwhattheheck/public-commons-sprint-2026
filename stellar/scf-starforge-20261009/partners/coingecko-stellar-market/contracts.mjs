// MIT. Separate documented endpoint contracts; original Bazaar sources stay intact.
import {need, plain, text, enumValue, integer, origin, prefix, clone} from './common.mjs';
const field=(name,label,type='string',more={})=>({name,label,type,required:false,...more});
const boolean=(name,label)=>field(name,label,'boolean');
const address=field('address','Token address','string',{required:true,description:'Original contract address on the selected data network'});
const network=field('network','Data network','string',{required:true,default:'eth',description:'CoinGecko network ID; independent from the payment network'});
const include=field('include','Included entities','string',{description:'Comma-separated base_token,quote_token,dex'});
const page=field('page','Page','integer',{min:1,max:100000,default:1,description:'Each requested page is a separate response and purchase'});
const poolFlags=[include,page,boolean('include_gt_community_data','Include community data')];
export const CONTRACTS=Object.freeze([
 {id:'simple-price',name:'Coin prices',description:'Coin prices by native IDs, names or symbols',pathTemplate:'/simple/price',
  docsUrl:'https://docs.coingecko.com/reference/simple-price',pathFields:[],
  queryFields:[field('vs_currencies','Quote currencies','string',{required:true,default:'usd'}),field('ids','Coin IDs'),field('names','Coin names'),field('symbols','Symbols'),
    field('include_tokens','Symbol matches','enum',{enum:['top','all']}),boolean('include_market_cap','Include market cap'),
    boolean('include_24hr_vol','Include 24-hour volume'),boolean('include_24hr_change','Include 24-hour change'),
    boolean('include_last_updated_at','Include source timestamp'),field('precision','Price precision','enum',{enum:['full',...Array.from({length:19},(_,i)=>String(i))],default:'full'})],
  example:{path:{},query:{ids:'bitcoin,ethereum',vs_currencies:'usd',include_last_updated_at:true,precision:'full'}},
  notes:['Native lookup priority is ids, then names, then symbols.','include_tokens=all requires an effective symbols lookup with at most 50 symbols.','The documented maximum is 515 IDs. Missing and null observations are not zero.']},
 {id:'token-prices',name:'Onchain token prices',description:'Token prices and optional metrics for original addresses',pathTemplate:'/onchain/simple/networks/{network}/token_price/{addresses}',
  docsUrl:'https://docs.coingecko.com/reference/onchain-simple-price',pathFields:[network,field('addresses','Token addresses','string',{required:true,description:'Comma-separated original contract addresses; up to100'})],
  queryFields:[boolean('include_market_cap','Include market cap'),boolean('mcap_fdv_fallback','Allow FDV fallback'),
    boolean('include_24hr_vol','Include 24-hour volume'),boolean('include_24hr_price_change','Include 24-hour price change'),
    boolean('include_total_reserve_in_usd','Include token reserves'),boolean('include_inactive_source','Include inactive source')],
  example:{path:{network:'eth',addresses:'0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'},query:{include_market_cap:true,include_24hr_vol:true}},
  notes:['Missing addresses are omitted by the provider.','An unavailable market cap can be null. With FDV fallback enabled, the returned metric may be FDV; it is labelled accordingly.','Token reserves describe the requested token across pools, not full pool liquidity.']},
 {id:'search-pools',name:'Search pools',description:'Search original pool and token identities',pathTemplate:'/onchain/search/pools',
  docsUrl:'https://docs.coingecko.com/reference/search-pools',pathFields:[],
  queryFields:[field('query','Search query','string',{required:true}),field('network','Data network filter'),...poolFlags],
  example:{path:{},query:{query:'WETH',network:'eth',include:'base_token,quote_token,dex',page:1}},
  notes:['Included entities join by their native type and ID.','Each selected page is retained separately.']},
 {id:'trending-pools',name:'Trending pools',description:'Native trending pools for one data network and window',pathTemplate:'/onchain/networks/{network}/trending_pools',
  docsUrl:'https://docs.coingecko.com/reference/trending-pools-network',pathFields:[network],
  queryFields:[...poolFlags,field('duration','Trending window','enum',{enum:['5m','1h','6h','24h'],default:'24h'})],
  example:{path:{network:'base'},query:{duration:'24h',include:'base_token,quote_token,dex',page:1}},
  notes:['The retained vendor schema can contain type:enum without values. This separate contract uses the documented duration values.']},
 {id:'token-data',name:'Token details',description:'Original token details, relationships and optional pool composition',pathTemplate:'/onchain/networks/{network}/tokens/{address}',
  docsUrl:'https://docs.coingecko.com/reference/token-data-contract-address',pathFields:[network,address],
  queryFields:[field('include','Included entities','enum',{enum:['top_pools']}),boolean('include_composition','Include pool composition'),boolean('include_inactive_source','Include inactive source')],
  example:{path:{network:'eth',address:'0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'},query:{include:'top_pools',include_composition:true}},
  notes:['include_composition requires include=top_pools.','Retain requested-token reserves separately from returned pool reserves.']}
]);
export const contractFor=id=>{const c=CONTRACTS.find(x=>x.id===id);need(c,'UNKNOWN_ENDPOINT','Select one of the five documented endpoint families');return c};
function normalizeFields(input,definitions,label) {
  need(plain(input),'INVALID_INPUT',label+' must be an object');
  const byName=new Map(definitions.map(f=>[f.name,f])),result={};
  for(const [key,value] of Object.entries(input)) {
    const f=byName.get(key);need(f,'UNKNOWN_PARAMETER','Unknown '+label+' parameter '+key);
    if(value===undefined||value===null||value==='')continue;
    if(f.type==='boolean')need(typeof value==='boolean','INVALID_PARAMETER',key+' must be true or false');
    else if(f.type==='integer')integer(value,key,f.min??0,f.max??Number.MAX_SAFE_INTEGER);
    else {text(value,key,65536);if(f.enum)enumValue(value,f.enum,key)}
    result[key]=value;
  }
  for(const f of definitions)if(f.required&&result[f.name]===undefined) {
    if(f.default!==undefined)result[f.name]=f.default;else need(false,'REQUIRED_PARAMETER',f.name+' is required');
  }
  return result;
}
const csv=x=>String(x??'').split(',').map(v=>v.trim()).filter(Boolean);
const safeSegment=value=>typeof value==='string'&&value.length<=256&&/^[A-Za-z0-9._:-]+$/.test(value)&&value!=='.'&&value!=='..';
export function normalizeRequest(input,config={}) {
  need(plain(input),'INVALID_REQUEST','Request must be an object');
  need(input.enabled===undefined||typeof input.enabled==='boolean','INVALID_ENABLED','Enabled must be true or false');
  const contract=contractFor(input.endpoint),path=normalizeFields(input.path??{},contract.pathFields,'path'),query=normalizeFields(input.query??{},contract.queryFields,'query');
  if(path.network!==undefined)need(/^[A-Za-z0-9_-]{1,128}$/.test(path.network),'INVALID_NETWORK','Use the original CoinGecko network ID');
  if(query.network!==undefined)need(/^[A-Za-z0-9_-]{1,128}$/.test(query.network),'INVALID_NETWORK');
  for(const name of ['address','addresses'])if(path[name]!==undefined) {
    const addresses=name==='addresses'?csv(path[name]):[path[name]];
    need(addresses.length>0&&addresses.length<=(name==='addresses'?100:1)&&addresses.every(safeSegment),'INVALID_ADDRESS','Use one to100 original token addresses');
    if(name==='addresses')path[name]=addresses.join(',');
  }
  let effectiveSelector=null;
  if(contract.id==='simple-price') {
    effectiveSelector=['ids','names','symbols'].find(key=>csv(query[key]).length)??null;
    need(effectiveSelector,'COIN_SELECTOR_REQUIRED','Enter coin IDs, names or symbols');
    if(query.ids!==undefined)need(csv(query.ids).length<=515,'TOO_MANY_COIN_IDS','The documented maximum is515 IDs per request');
    if(query.include_tokens==='all')need(effectiveSelector==='symbols'&&csv(query.symbols).length<=50,'SYMBOL_MATCH_LIMIT','All token matches require a symbols lookup with at most50 symbols');
  }
  if(query.include!==undefined&&['search-pools','trending-pools'].includes(contract.id))
    need(csv(query.include).every(v=>['base_token','quote_token','dex'].includes(v)),'INVALID_INCLUDE','Select native included entity types');
  if(contract.id==='token-data'&&query.include_composition===true)need(query.include==='top_pools','COMPOSITION_REQUIRES_TOP_POOLS','Pool composition requires include=top_pools');
  const relative=contract.pathTemplate.replace(/\{([^}]+)\}/g,(_,name)=>encodeURIComponent(path[name]).replace(/%2C/gi,','));
  const make=(host,base)=>{if(!host)return null;const u=new URL(prefix(base)+relative,origin(host,{allowLocal:config.allowLocal===true}));for(const[k,v]of Object.entries(query))u.searchParams.set(k,String(v));return u.href};
  const urls={vendor:make('https://pro-api.coingecko.com','/api/v3/x402'),merchant:make(config.merchantOrigin??'',config.merchantPrefix??'/api/v3/stellar')};
  const notices=urls.merchant&&urls.merchant.length>2048?[{code:'ORIGINAL_SF30_REQUEST_TARGET_LIMIT',message:'This merchant request exceeds the original SF30 limit of 2,048 URL characters. Preserve the vendor request and create explicit shorter merchant requests.'}]:[];
  return {name:text(input.name??contract.name,'request name',240),endpoint:contract.id,path,query,notices,
    notes:text(input.notes??'','notes',10000,{empty:true}),enabled:input.enabled!==false,effectiveSelector,
    urls};
}
export function nativeQuery(context) {
  const query={};for(const [key,value] of Object.entries(context.query??{})) {
    need(!Array.isArray(value),'REPEATED_PARAMETER','Repeated query parameter '+key+' is not supported');query[key]=value;
  }
  return query;
}
export function requestFromContext(endpoint,context) {
  const contract=contractFor(endpoint),query=nativeQuery(context);
  for(const field of contract.queryFields)if(query[field.name]!==undefined) {
    if(field.type==='boolean'){need(['true','false'].includes(query[field.name]),'INVALID_PARAMETER',field.name+' must be true or false');query[field.name]=query[field.name]==='true'}
    if(field.type==='integer'){need(/^[0-9]+$/.test(query[field.name]),'INVALID_PARAMETER');query[field.name]=Number(query[field.name])}
  }
  return normalizeRequest({name:contract.name,endpoint,path:context.pathParams??{},query});
}
export function contractSchema(fields) {
  const properties={},required=[];
  for(const f of fields) {
    const type=f.type==='enum'?'string':f.type;
    properties[f.name]={type,description:f.description??f.label,
      ...(f.enum?{enum:f.enum}:{}),...(f.min===undefined?{}:{minimum:f.min}),...(f.max===undefined?{}:{maximum:f.max})};
    if(type==='string')properties[f.name].maxLength=65536;
    if(f.required)required.push(f.name);
  }
  return {type:'object',properties,required,additionalProperties:false};
}
export const endpointExamples=()=>CONTRACTS.map(c=>({name:c.name,endpoint:c.id,...clone(c.example),enabled:true,notes:''}));
