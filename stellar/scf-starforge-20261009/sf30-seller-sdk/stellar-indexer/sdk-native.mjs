import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import {
  files, plain, own, need, integer, text, clone, digest, canonical, jsonBytes, now,
  encodeValue, decodeValue, displayValue, publicError, privateDirectory, descriptor,
} from './common.mjs';

export const SDK_PACKAGE = '@stellar-indexer/stellar-indexer-sdk';
export const SDK_VERSION = '0.0.13';
export const METHODS = [
  {
    "id": "base.fetchContractData",
    "name": "fetchContractData",
    "family": "base",
    "description": "Read native contract entries and parsed XDR values.",
    "kind": "native",
    "arguments": [
      "params"
    ],
    "pagination": {
      "argumentIndex": 0,
      "defaultLimit": 25,
      "maxLimit": 200,
      "startPage": 0
    },
    "resultShape": "array",
    "requiresOptions": []
  },
  {
    "id": "base.fetchAccount",
    "name": "fetchAccount",
    "family": "base",
    "description": "Read an original classic account.",
    "kind": "native",
    "arguments": [
      "id"
    ],
    "pagination": null,
    "resultShape": "object",
    "requiresOptions": []
  },
  {
    "id": "base.fetchAccountTrustLines",
    "name": "fetchAccountTrustLines",
    "family": "base",
    "description": "Read all native account trust lines.",
    "kind": "native",
    "arguments": [
      "id"
    ],
    "pagination": null,
    "resultShape": "array",
    "requiresOptions": []
  },
  {
    "id": "base.fetchAccountData",
    "name": "fetchAccountData",
    "family": "base",
    "description": "Read original account data entries.",
    "kind": "native",
    "arguments": [
      "id"
    ],
    "pagination": null,
    "resultShape": "array",
    "requiresOptions": []
  },
  {
    "id": "base.fetchClassicLiquidityPools",
    "name": "fetchClassicLiquidityPools",
    "family": "base",
    "description": "Page native classic liquidity pools.",
    "kind": "native",
    "arguments": [
      "params"
    ],
    "pagination": {
      "argumentIndex": 0,
      "defaultLimit": 25,
      "maxLimit": 200,
      "startPage": 0
    },
    "resultShape": "array",
    "requiresOptions": []
  },
  {
    "id": "base.fetchClassicLiquidityPoolById",
    "name": "fetchClassicLiquidityPoolById",
    "family": "base",
    "description": "Read a native classic liquidity pool.",
    "kind": "native",
    "arguments": [
      "id"
    ],
    "pagination": null,
    "resultShape": "object",
    "requiresOptions": []
  },
  {
    "id": "base.fetchAssets",
    "name": "fetchAssets",
    "family": "base",
    "description": "Read the provider's tracked assets.",
    "kind": "native",
    "arguments": [],
    "pagination": null,
    "resultShape": "array",
    "requiresOptions": []
  },
  {
    "id": "base.fetchNfts",
    "name": "fetchNfts",
    "family": "base",
    "description": "Read the provider's tracked NFT contracts.",
    "kind": "native",
    "arguments": [],
    "pagination": null,
    "resultShape": "array",
    "requiresOptions": []
  },
  {
    "id": "base.getAccountAssetsBalances",
    "name": "getAccountAssetsBalances",
    "family": "base",
    "description": "Read original account asset balances.",
    "kind": "native",
    "arguments": [
      "id"
    ],
    "pagination": null,
    "resultShape": "array",
    "requiresOptions": []
  },
  {
    "id": "base.getAccountNftsBalances",
    "name": "getAccountNftsBalances",
    "family": "base",
    "description": "Read original account NFT balances and owned IDs.",
    "kind": "native",
    "arguments": [
      "id"
    ],
    "pagination": null,
    "resultShape": "array",
    "requiresOptions": []
  },
  {
    "id": "stellardomains.instanceData",
    "name": "instanceData",
    "family": "stellardomains",
    "description": "Read the native registry instance.",
    "kind": "native",
    "arguments": [],
    "pagination": null,
    "resultShape": "object",
    "requiresOptions": [
      "registry and nfd must be explicit for testnet"
    ]
  },
  {
    "id": "stellardomains.getAllDomains",
    "name": "getAllDomains",
    "family": "stellardomains",
    "description": "Page domains with the original registry parser.",
    "kind": "native",
    "arguments": [
      "opts"
    ],
    "pagination": {
      "argumentIndex": 0,
      "defaultLimit": 25,
      "maxLimit": 200,
      "startPage": 0
    },
    "resultShape": "array",
    "requiresOptions": [
      "registry and nfd must be explicit for testnet"
    ]
  },
  {
    "id": "stellardomains.getAddressDomains",
    "name": "getAddressDomains",
    "family": "stellardomains",
    "description": "Page domains pointing to an address.",
    "kind": "native",
    "arguments": [
      "address",
      "opts"
    ],
    "pagination": {
      "argumentIndex": 1,
      "defaultLimit": 25,
      "maxLimit": 200,
      "startPage": 0
    },
    "resultShape": "array",
    "requiresOptions": [
      "registry and nfd must be explicit for testnet"
    ]
  },
  {
    "id": "stellardomains.getDomainsOwnedByAddress",
    "name": "getDomainsOwnedByAddress",
    "family": "stellardomains",
    "description": "Run the publisher's original two-request owner lookup; retain native join coverage.",
    "kind": "native",
    "arguments": [
      "address",
      "opts"
    ],
    "pagination": {
      "argumentIndex": 1,
      "defaultLimit": 25,
      "maxLimit": 200,
      "startPage": 0
    },
    "resultShape": "array",
    "requiresOptions": [
      "registry and nfd must be explicit for testnet"
    ]
  },
  {
    "id": "stellardomains.resolveOwnedDomains",
    "name": "resolveOwnedDomains",
    "family": "stellardomains",
    "description": "Resolve each native owner page through complete native registry joins and the original domain parser.",
    "kind": "composition",
    "arguments": [
      "address",
      "opts"
    ],
    "pagination": {
      "argumentIndex": 1,
      "defaultLimit": 25,
      "maxLimit": 200,
      "startPage": 0
    },
    "resultShape": "array",
    "requiresOptions": [
      "registry and nfd must be explicit for testnet"
    ]
  },
  {
    "id": "blend.fetchPoolsInfo",
    "name": "fetchPoolsInfo",
    "family": "blend",
    "description": "Read all native Blend V2 pool information.",
    "kind": "native",
    "arguments": [],
    "pagination": null,
    "resultShape": "record",
    "requiresOptions": []
  },
  {
    "id": "blend.fetchPoolInfo",
    "name": "fetchPoolInfo",
    "family": "blend",
    "description": "Read original Blend pool information.",
    "kind": "native",
    "arguments": [
      "id"
    ],
    "pagination": null,
    "resultShape": "object",
    "requiresOptions": []
  },
  {
    "id": "blend.fetchPoolAuctions",
    "name": "fetchPoolAuctions",
    "family": "blend",
    "description": "Page original pool auctions with native filters.",
    "kind": "native",
    "arguments": [
      "id",
      "opts"
    ],
    "pagination": {
      "argumentIndex": 1,
      "defaultLimit": 30,
      "maxLimit": 200,
      "startPage": 0
    },
    "resultShape": "array",
    "requiresOptions": []
  },
  {
    "id": "blend.fetchPoolEvents",
    "name": "fetchPoolEvents",
    "family": "blend",
    "description": "Page original pool contract events.",
    "kind": "native",
    "arguments": [
      "id",
      "opts"
    ],
    "pagination": {
      "argumentIndex": 1,
      "defaultLimit": 30,
      "maxLimit": 200,
      "startPage": 0
    },
    "resultShape": "array",
    "requiresOptions": []
  },
  {
    "id": "blend.fetchPoolAssetInfo",
    "name": "fetchPoolAssetInfo",
    "family": "blend",
    "description": "Read native pool asset configuration, data and emissions.",
    "kind": "native",
    "arguments": [
      "id",
      "asset"
    ],
    "pagination": null,
    "resultShape": "object",
    "requiresOptions": []
  },
  {
    "id": "blend.fetchPoolAssetHistoricalData",
    "name": "fetchPoolAssetHistoricalData",
    "family": "blend",
    "description": "Page every selected pool asset data update.",
    "kind": "native",
    "arguments": [
      "id",
      "asset",
      "opts"
    ],
    "pagination": {
      "argumentIndex": 2,
      "defaultLimit": 30,
      "maxLimit": 200,
      "startPage": 0
    },
    "resultShape": "array",
    "requiresOptions": []
  },
  {
    "id": "blend.fetchPoolAssetHistoricalEmissions",
    "name": "fetchPoolAssetHistoricalEmissions",
    "family": "blend",
    "description": "Page native pool asset emission history.",
    "kind": "native",
    "arguments": [
      "id",
      "asset",
      "opts"
    ],
    "pagination": {
      "argumentIndex": 2,
      "defaultLimit": 30,
      "maxLimit": 200,
      "startPage": 0
    },
    "resultShape": "array",
    "requiresOptions": []
  },
  {
    "id": "blend.fetchPoolUserPositions",
    "name": "fetchPoolUserPositions",
    "family": "blend",
    "description": "Read native user positions in a pool.",
    "kind": "native",
    "arguments": [
      "id",
      "user"
    ],
    "pagination": null,
    "resultShape": "object",
    "requiresOptions": []
  },
  {
    "id": "blend.fetchPoolUserPosition",
    "name": "fetchPoolUserPosition",
    "family": "blend",
    "description": "Read one original pool asset position.",
    "kind": "native",
    "arguments": [
      "id",
      "user",
      "asset"
    ],
    "pagination": null,
    "resultShape": "object",
    "requiresOptions": []
  },
  {
    "id": "blend.fetchPoolUserPositionHistorical",
    "name": "fetchPoolUserPositionHistorical",
    "family": "blend",
    "description": "Read the original most recent position updates, up to the API's native limit of 1000.",
    "kind": "native",
    "arguments": [
      "id",
      "user",
      "asset",
      "limit"
    ],
    "pagination": null,
    "resultShape": "array",
    "requiresOptions": []
  },
  {
    "id": "blend.fetchUserPositions",
    "name": "fetchUserPositions",
    "family": "blend",
    "description": "Read native user positions across Blend V2 pools.",
    "kind": "native",
    "arguments": [
      "user"
    ],
    "pagination": null,
    "resultShape": "array",
    "requiresOptions": []
  },
  {
    "id": "blend.fetchCometPoolHistory",
    "name": "fetchCometPoolHistory",
    "family": "blend",
    "description": "Page original Comet pool history in a pinned date interval.",
    "kind": "native",
    "arguments": [
      "params"
    ],
    "pagination": {
      "argumentIndex": 0,
      "defaultLimit": 8,
      "maxLimit": 200,
      "startPage": 0
    },
    "resultShape": "array",
    "requiresOptions": []
  },
  {
    "id": "axis-markets.queryOrders",
    "name": "queryOrders",
    "family": "axis-markets",
    "description": "Page native market orders with original owner and asset filters.",
    "kind": "native",
    "arguments": [
      "params"
    ],
    "pagination": {
      "argumentIndex": 0,
      "defaultLimit": 100,
      "maxLimit": 200,
      "startPage": 0
    },
    "resultShape": "array",
    "requiresOptions": []
  },
  {
    "id": "axis-markets.fetchOrder",
    "name": "fetchOrder",
    "family": "axis-markets",
    "description": "Read an original market order by its full integer ID.",
    "kind": "native",
    "arguments": [
      "id"
    ],
    "pagination": null,
    "resultShape": "object",
    "requiresOptions": []
  },
  {
    "id": "axis-markets.queryLastTrades",
    "name": "queryLastTrades",
    "family": "axis-markets",
    "description": "Page original market trades.",
    "kind": "native",
    "arguments": [
      "params"
    ],
    "pagination": {
      "argumentIndex": 0,
      "defaultLimit": 100,
      "maxLimit": 200,
      "startPage": 0
    },
    "resultShape": "array",
    "requiresOptions": []
  },
  {
    "id": "axis-markets.queryLastSwaps",
    "name": "queryLastSwaps",
    "family": "axis-markets",
    "description": "Page original market swaps.",
    "kind": "native",
    "arguments": [
      "params"
    ],
    "pagination": {
      "argumentIndex": 0,
      "defaultLimit": 100,
      "maxLimit": 200,
      "startPage": 0
    },
    "resultShape": "array",
    "requiresOptions": []
  },
  {
    "id": "axis-markets.fetchMarketDepth",
    "name": "fetchMarketDepth",
    "family": "axis-markets",
    "description": "Read original market depth with both bids and asks.",
    "kind": "native",
    "arguments": [
      "params"
    ],
    "pagination": null,
    "resultShape": "object",
    "requiresOptions": []
  },
  {
    "id": "reflector.fetchOraclesData",
    "name": "fetchOraclesData",
    "family": "reflector",
    "description": "Read the original provider oracle map.",
    "kind": "native",
    "arguments": [],
    "pagination": null,
    "resultShape": "record",
    "requiresOptions": []
  },
  {
    "id": "reflector.fetchHistoricalPrices",
    "name": "fetchHistoricalPrices",
    "family": "reflector",
    "description": "Page native oracle prices in a pinned date interval.",
    "kind": "native",
    "arguments": [
      "oracleId",
      "opts"
    ],
    "pagination": {
      "argumentIndex": 1,
      "defaultLimit": 8,
      "maxLimit": 200,
      "startPage": 0
    },
    "resultShape": "prices",
    "requiresOptions": []
  },
  {
    "id": "xbull-swap.fetchStrictSendRecordsByAddress",
    "name": "fetchStrictSendRecordsByAddress",
    "family": "xbull-swap",
    "description": "Page original xBull strict-send operations for an address.",
    "kind": "native",
    "arguments": [
      "address",
      "opts"
    ],
    "pagination": {
      "argumentIndex": 1,
      "defaultLimit": 30,
      "maxLimit": 200,
      "startPage": 0
    },
    "resultShape": "array",
    "requiresOptions": []
  }
];
const BY_ID = new Map(METHODS.map((method) => [method.id,method]));
const CLASS = {
  base:'StellarIndexerSdk', stellardomains:'StellarDomainsIndexerSdk', blend:'BlendIndexerSdk',
  'axis-markets':'AxisMarketsIndexerSdk', reflector:'ReflectorIndexerSdk', 'xbull-swap':'xBullSwapIndexerSdk',
};
const DEFAULT_REGISTRY = 'CC75Z72OCE667WVPQOROIWDAGBOXFNJ4VQONQEURL74EYIDLWA4F7FEN';
const DEFAULT_NFD = 'CADCRH6BW3MIZBBE7JOVKROR2GBEG64TJDT5Y3EX3OOIWRDZOOT5XUHD';
const OPTIONS = {
  base:[], stellardomains:['registry','nfd'], blend:['emitter','backstop','factory','cometPool','trackedPools'],
  'axis-markets':[], reflector:['oracles'], 'xbull-swap':['router'],
};
export function methodFor(id) {
  need(BY_ID.has(id),'UNKNOWN_METHOD','Select a method from the installed original SDK catalog.',{method:id});
  return BY_ID.get(id);
}
function nativeAddress(value,name,contract=false) {
  need(typeof value === 'string' && (contract?/^C[A-Z2-7]{55}$/:/^[CG][A-Z2-7]{55}$/).test(value),
    'INVALID_ADDRESS','Supply the complete native Stellar '+name+'.'); return value;
}
function inputArguments(method, input) {
  need(Array.isArray(input),'INVALID_ARGUMENT','SDK arguments must be an ordered array.');
  need(input.length<=method.arguments.length,'INVALID_ARGUMENT','Too many native SDK arguments.');
  const args=decodeValue(encodeValue(input));
  for(let index=0;index<method.arguments.length;index++) {
    const name=method.arguments[index],value=args[index];
    if(name==='params'||name==='opts') {
      if(value===undefined)args[index]={};
      else need(plain(value),'INVALID_ARGUMENT','Supply the original native '+name+' object.');
    } else if(name==='limit') {
      if(value!==undefined)integer(value,'limit',1,1000);
    } else if(method.id==='base.fetchClassicLiquidityPoolById') {
      need(typeof value==='string' && /^[a-fA-F0-9]{64}$/.test(value),'INVALID_ARGUMENT','Supply the native liquidity pool ID.');
    } else if(method.id==='axis-markets.fetchOrder') {
      need((typeof value==='string'&&/^[0-9]+$/.test(value))||typeof value==='bigint'||
        (Number.isSafeInteger(value)&&value>=0),'INVALID_ARGUMENT','Supply the complete original order ID.');
      need(BigInt(value)>=0n,'INVALID_ARGUMENT','Order ID must be nonnegative.');
    } else nativeAddress(value,name,['asset','oracleId'].includes(name)||(name==='id'&&method.family==='blend'));
  }
  if(method.id==='base.fetchContractData') {
    need(Array.isArray(args[0].contracts)&&args[0].contracts.length>=1&&args[0].contracts.length<=25,
      'INVALID_ARGUMENT','Choose one to 25 original contracts.');
    args[0].contracts.forEach(value=>nativeAddress(value,'contract',true));
    for(const key of ['key','val'])if(args[0][key]!==undefined)
      need(Array.isArray(args[0][key])&&args[0][key].length<=100,'INVALID_ARGUMENT','Native '+key+' filters accept at most 100 items.');
  }
  return args;
}
export function normalizeQuery(input, selectedConnection) {
  const method=methodFor(input.method),args=inputArguments(method,input.args??[]);
  need(plain(input.sdkOptions??{}),'INVALID_ARGUMENT','SDK constructor options must be an object.');
  const sdkOptions=clone(input.sdkOptions??{});
  need(Object.keys(sdkOptions).every(key=>OPTIONS[method.family].includes(key)),
    'INVALID_ARGUMENT','Use only original protocol constructor options; choose connection credentials through a private alias.');
  for(const [key,value] of Object.entries(sdkOptions)) {
    if(Array.isArray(value))value.forEach(item=>nativeAddress(item,key,true));else nativeAddress(value,key,true);
  }
  if(method.family==='stellardomains'&&selectedConnection.network==='stellar:testnet')
    need(sdkOptions.registry&&sdkOptions.nfd,'PROTOCOL_NETWORK_REQUIRED','Select the actual testnet registry and NFD contracts.');
  const provided=input.pagination??{};
  need(plain(provided)&&Object.keys(provided).every(key=>['mode','startPage','limit'].includes(key)),
    'INVALID_ARGUMENT','Pagination accepts mode, startPage and limit.');
  const mode=provided.mode??(method.pagination?'all':'once');
  need(['all','once'].includes(mode)&&(method.pagination||mode==='once'),
    'INVALID_ARGUMENT','This original SDK method has no page continuation.');
  let pagination={mode};
  if(method.pagination) {
    const opts=args[method.pagination.argumentIndex];
    pagination={mode,startPage:integer(provided.startPage??opts.page??0,'startPage'),
      limit:integer(provided.limit??opts.limit??method.pagination.defaultLimit,'limit',1,method.pagination.maxLimit)};
  }
  return {name:text(input.name,'query name',200),method:method.id,args:displayValue(args),nativeArgs:encodeValue(args),
    sdkOptions,connectionAlias:selectedConnection.alias,network:selectedConnection.network,pagination};
}
export function pinArguments(query, capturedAt) {
  const method=methodFor(query.method),args=decodeValue(query.nativeArgs);
  if(['blend.fetchCometPoolHistory','reflector.fetchHistoricalPrices'].includes(method.id)) {
    const opts=args[method.pagination.argumentIndex],end=Date.parse(capturedAt);
    opts.fromDate=opts.fromDate===undefined?new Date(end-7*86400000):new Date(opts.fromDate);
    opts.toDate=opts.toDate===undefined?new Date(end):new Date(opts.toDate);
    need(Number.isFinite(opts.fromDate.getTime())&&Number.isFinite(opts.toDate.getTime())&&opts.toDate>=opts.fromDate,
      'INVALID_INTERVAL','Choose a valid native history interval.');
  }
  return encodeValue(args);
}
function selectedArguments(capture,page) {
  const method=methodFor(capture.query.method),args=decodeValue(capture.frozenArgs);
  if(method.pagination)args[method.pagination.argumentIndex]={...args[method.pagination.argumentIndex],
    page,limit:capture.query.pagination.limit};
  return args;
}
const sensitiveHeader=(name)=>/^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api-key)$/i.test(name) ||
  /token|secret|password/i.test(name);
function portableHeaders(headers) {
  return [...new Headers(headers)].filter(([name])=>!sensitiveHeader(name)).sort(([a],[b])=>a.localeCompare(b));
}
function responseArrayCount(exchange) {
  return exchange?.response?.jsonShape==='array'?exchange.response.rowCount:null;
}
async function recordingFetchFactory({directory,connection,signal}) {
  await privateDirectory(directory);
  const exchanges=[];
  const nativeFetch=globalThis.fetch.bind(globalThis);
  const captureFetch=async(input,options={})=>{
    const index=exchanges.length,prefix='exchange-'+String(index+1).padStart(6,'0');
    const deadline=AbortSignal.timeout(connection.requestTimeoutMs??120000);
    const request=new Request(input,{...options,signal:AbortSignal.any([deadline,...(signal?[signal]:[]),
      ...(options.signal?[options.signal]:[])])});
    const target=new URL(request.url),base=new URL(connection.apiUrl);
    need(target.origin===base.origin&&target.pathname.startsWith(base.pathname.replace(/\/$/,'')+'/'),
      'SDK_ENDPOINT_CHANGED','The native SDK selected an endpoint outside its selected provider.');
    need(['GET','POST'].includes(request.method),'SDK_METHOD_CHANGED','The source-selected indexer methods only read data.');
    const body=Buffer.from(await request.clone().arrayBuffer());
    const requestBody=await files.writeNew(directory,prefix+'.request.body',body);
    requestBody.contentType=request.headers.get('content-type')??'application/octet-stream';
    const record={schema:'stellar-forge.stellar-indexer.exchange.v1',id:randomUUID(),index,
      request:{url:request.url,method:request.method,headers:portableHeaders(request.headers),
        privateHeaderNames:[...request.headers.keys()].filter(sensitiveHeader).sort(),body:requestBody},
      startedAt:now(),response:null,error:null};
    exchanges.push(record);
    await files.writeNew(directory,prefix+'.request.json',jsonBytes(record));
    let handle,response,reader,readError;
    const partial=prefix+'.response.partial';
    try {
      response=await nativeFetch(request);
      record.response={url:response.url,status:response.status,statusText:response.statusText,
        headers:portableHeaders(response.headers),redirected:response.redirected,bodyEncoding:'fetch-decoded',
        complete:false,body:null};
      await files.writeNew(directory,prefix+'.response-headers.json',jsonBytes(record.response));
      handle=await fs.open(await files.filePath(directory,partial,true),'wx',0o600);
      reader=response.body?.getReader();
      if(reader)while(true) {
        const next=await reader.read();if(next.done)break;
        await handle.writeFile(Buffer.from(next.value));
      }
      await handle.sync();await handle.close();handle=null;
      const original=await fs.readFile(await files.filePath(directory,partial));
      record.response.body=await descriptor(directory,partial,response.headers.get('content-type')??'application/octet-stream');
      record.response.complete=true;
      try {
        const data=JSON.parse(original.toString('utf8'));
        record.response.jsonShape=Array.isArray(data)?'array':data===null?'null':typeof data;
        record.response.rowCount=Array.isArray(data)?data.length:null;
      }catch{record.response.jsonShape='non-json';record.response.rowCount=null;}
      record.finishedAt=now();
      await files.writeNew(directory,prefix+'.exchange.json',jsonBytes(record));
      const revived=new Response([204,205,304].includes(response.status)?null:original,
        {status:response.status,statusText:response.statusText,headers:response.headers});
      Object.defineProperty(revived,'url',{value:response.url});
      Object.defineProperty(revived,'redirected',{value:response.redirected});
      return revived;
    }catch(error) {
      readError=error;
      if(handle){await handle.sync().catch(()=>{});await handle.close();handle=null;}
      if(record.response) {
        try{record.response.body=await descriptor(directory,partial);}catch(problem){if(problem.code!=='ENOENT')throw problem;}
      }
      record.error=publicError(error,[connection.consumerToken]);record.finishedAt=now();
      await files.writeNew(directory,prefix+'.exchange.json',jsonBytes(record));throw error;
    }finally{
      if(reader&&readError)await reader.cancel(readError).catch(()=>{});
      reader?.releaseLock();if(handle)await handle.close();
    }
  };
  return {fetch:captureFetch,exchanges};
}
async function nativeClass(runtime,family,captureFetch) {
  const subpath=family==='base'?'.':'./protocols/'+family;
  const entry=runtime.entrypoints?.[subpath]??(subpath==='.'?runtime.entrypoint:null);
  need(typeof entry==='string','SDK_RUNTIME_ENTRYPOINT','The complete retained runtime must expose its original SDK module.',{subpath});
  const original=await import(pathToFileURL(entry).href),Parent=original[CLASS[family]];
  need(typeof Parent==='function','SDK_RUNTIME_CLASS','The retained runtime does not export its original SDK class.',{subpath});
  return class CapturedNativeSDK extends Parent {
    get api(){return super.api.fetchPolyfill(captureFetch);}
  };
}
function clientOptions(query,connection) {
  return {...query.sdkOptions,consumerToken:connection.consumerToken,apiUrl:connection.apiUrl,
    network:connection.network==='stellar:pubnet'?'Public Global Stellar Network ; September 2015':'Test SDF Network ; September 2015',
    skipWASM:false};
}
async function resolveOwnedDomains(Client,options,address,opts,recorder) {
  const native=new Client(options),ownerRows=await native.fetchContractData({
    contracts:[options.nfd??DEFAULT_NFD],key:[{vec:[{symbol:'Owner'}]}],val:[{address}],limit:opts.limit,page:opts.page,
  });
  const ids=[...new Set(ownerRows.map(row=>{
    need(Array.isArray(row.key)&&row.key.length>=2&&Number.isSafeInteger(row.key[1])&&row.key[1]>=0&&row.key[1]<=4294967295,
      'NATIVE_OWNER_KEY','The original NFD owner entry has an unsupported token identifier.');
    return row.key[1];
  }))];
  const output=[],joins=[];
  for(let start=0;start<ids.length;start+=100) {
    const selectedIds=ids.slice(start,start+100),allowed=new Set(selectedIds);
    const filters=selectedIds.map(id=>({map:[{key:{symbol:'token_id'},val:{u32:id}}]}));
    class SelectedRegistrySDK extends Client {
      fetchContractData(params){return super.fetchContractData({...params,val:filters});}
    }
    const registry=new SelectedRegistrySDK(options);
    let previous=null;
    for(let page=0;;page++) {
      const firstExchange=recorder.exchanges.length;
      const domains=await registry.getAllDomains({page,limit:200});
      const raw=recorder.exchanges[firstExchange],rowCount=responseArrayCount(raw);
      need(rowCount!==null,'NATIVE_PAGING_SHAPE','The original registry did not return a contract-data array.');
      const identity=raw.response.body.sha256;
      joins.push({ownerIds:selectedIds,page,sourceCount:rowCount,domainCount:domains.length,exchange:firstExchange});
      for(const domain of domains) {
        need(allowed.has(domain.token_id),'NATIVE_OWNER_SCOPE','The native registry returned a token outside the selected owner keys.',{tokenId:domain.token_id});
        output.push(domain);
      }
      if(rowCount===0)break;
      need(identity!==previous,'NATIVE_PAGING_REPEATED','The provider repeated a complete registry page without advancing.',{page});
      previous=identity;
    }
  }
  return {value:output,coverage:{kind:'complete-native-owner-join',ownerRows:ownerRows.length,ownerIds:ids,
    domainRows:output.length,unresolvedOwnerIds:ids.filter(id=>!output.some(row=>row.token_id===id)),joins}};
}
function rowIdentity(value,position,method,recordKey) {
  if(recordKey!==null)return recordKey;
  for(const key of ['id','node','contract_data_id'])if(value&&value[key]!==undefined)
    return key+':'+canonical(encodeValue(value[key]));
  if(method.id==='blend.fetchUserPositions'&&value?.pool!==undefined)
    return 'pool:'+String(value.pool);
  if(method.id==='blend.fetchPoolAuctions'&&value?.user!==undefined&&value?.auct_type!==undefined&&value?.data?.block!==undefined)
    return 'auction:'+canonical(encodeValue({user:value.user,type:value.auct_type,block:value.data.block}));
  if(value?.tx_hash!==undefined) {
    const sequence=value.index??value.sequence;
    return 'transaction:'+String(value.tx_hash)+(sequence===undefined?'':':'+String(sequence));
  }
  if(value?.contract!==undefined)return 'contract:'+String(value.contract);
  if(method.resultShape==='object')return 'object:'+method.id;
  if(value?.timestamp!==undefined&&(
      method.id==='reflector.fetchHistoricalPrices'||method.id==='blend.fetchPoolAssetHistoricalData'||
      method.id==='blend.fetchPoolAssetHistoricalEmissions'||method.id==='blend.fetchPoolUserPositionHistorical'||
      method.id==='blend.fetchCometPoolHistory')) {
    return 'history:'+canonical(encodeValue({timestamp:value.timestamp,
      ...(value.ledger===undefined?{}:{ledger:value.ledger}),...(value.type===undefined?{}:{type:value.type})}));
  }
  return 'value:'+digest(canonical(encodeValue(value)));
}
function nativeRows(value,method) {
  if(method.resultShape==='array') {
    need(Array.isArray(value),'SDK_RESULT_SHAPE','The original method did not return its native array.');
    return value.map(item=>({item,recordKey:null}));
  }
  if(method.resultShape==='record') {
    need(plain(value),'SDK_RESULT_SHAPE','The original method did not return its native record map.');
    return Object.entries(value).map(([recordKey,item])=>({item,recordKey}));
  }
  if(method.resultShape==='prices') {
    need(Array.isArray(value?.prices),'SDK_RESULT_SHAPE','The original oracle result does not contain native price batches.');
    return value.prices.map(item=>({item,recordKey:null}));
  }
  return [{item:value,recordKey:null}];
}
export async function invokeNativePage({runtime,capture,page,connection,directory,signal}) {
  const method=methodFor(capture.query.method),args=selectedArguments(capture,page);
  const recorder=await recordingFetchFactory({directory,connection,signal});
  const Client=await nativeClass(runtime,method.family,recorder.fetch),options=clientOptions(capture.query,connection);
  const startedAt=now();
  await files.writeNew(directory,'invocation.json',jsonBytes({schema:'stellar-forge.stellar-indexer.invocation.v1',
    method:method.id,kind:method.kind,page,args:encodeValue(args),sdkOptions:capture.query.sdkOptions,
    network:connection.network,apiUrl:connection.apiUrl,runtimeId:runtime.id,startedAt}));
  try {
    let value,coverage={kind:'native-sdk',method:method.id};
    if(method.id==='stellardomains.resolveOwnedDomains') {
      const resolved=await resolveOwnedDomains(Client,options,args[0],args[1],recorder);
      value=resolved.value;coverage=resolved.coverage;
    }else {
      const client=new Client(options);
      need(typeof client[method.name]==='function','SDK_RUNTIME_METHOD','The original SDK method is missing.');
      value=await client[method.name](...args);
    }
    const first=recorder.exchanges[0];
    let rows=nativeRows(value,method),sourceCount=rows.length;
    if(method.pagination) {
      if(method.resultShape==='prices')sourceCount=value.prices.length;
      else {
        const originalCount=responseArrayCount(first);
        need(originalCount!==null,'NATIVE_PAGING_SHAPE','The first original source request did not return its native paged array.');
        sourceCount=originalCount;
      }
    }
    if(method.id==='stellardomains.getDomainsOwnedByAddress') {
      coverage={kind:'publisher-owner-join',ownerSourceRows:sourceCount,nativeDomainRows:rows.length,
        nativeJoinPage:page,primarySourceExhausted:sourceCount===0,
        semantics:'Original SDK applies the owner page to its registry join. Full ownership resolution is available through stellardomains.resolveOwnedDomains.'};
      if(sourceCount===0)rows=[];
    }
    const projected=rows.map(({item,recordKey},index)=>{
      const encoded=encodeValue(item);
      return {key:rowIdentity(item,index,method,recordKey),sha256:digest(canonical(encoded)),
        value:encoded,display:displayValue(item),recordKey};
    });
    const result={schema:'stellar-forge.stellar-indexer.native-page.v1',method:method.id,kind:method.kind,
      page,startedAt,finishedAt:now(),runtimeId:runtime.id,args:encodeValue(args),value:encodeValue(value),
      sourceCount,rowCount:projected.length,sourceExhausted:Boolean(method.pagination&&sourceCount===0),
      primarySourceSha256:first?.response?.body?.sha256??null,coverage,rows:projected,exchanges:recorder.exchanges};
    await files.writeNew(directory,'result.json',jsonBytes(result));
    return result;
  }catch(error) {
    await files.writeNew(directory,'failure.json',jsonBytes({schema:'stellar-forge.stellar-indexer.native-failure.v1',
      method:method.id,page,startedAt,finishedAt:now(),runtimeId:runtime.id,
      error:publicError(error,[connection.consumerToken]),exchanges:recorder.exchanges}));
    throw error;
  }
}
