// MIT. One durable native provider capture and the original SF30 merchant package.
import { mkdir, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { compileHttpSellerOffer } from '../seller.mjs';
import { compileSellerRoutes } from '../resource-server.mjs';
import { compileSellerOpenApi } from '../developer-portal.mjs';
import { generateSellerClient } from '../developer/client-generator.mjs';
import { compileMarketPlan, productFor, bindMarketQuery, queryParameters, identifier,
  fields, text, CONTRACT, parameterDescription, parameterType, parameterExample,
  exampleQuery, object, fail, handlerName } from './config.mjs';
import { createTwelveDataSource, readMarketResponse } from './source.mjs';
import { privateDirectory, readBytes, readJson, writeJson, writeBytes, jsonBytes,
  digest, exists, syncDirectory, putOnce, readBundle, publishBundle } from './files.mjs';

const CAPTURE = 'stellar-forge.twelvedata-capture.v1';
export const PACKAGE = 'stellar-forge.twelvedata-merchant-package.v1';
const unavailable = () => { throw new Error('Offline configuration does not dispatch an application request'); };

export async function loadMarketPlan(file) {
  return compileMarketPlan(await readJson(resolve(file),262144));
}
export function compileMarketSeller(raw, terms) {
  const plan = compileMarketPlan(raw);
  fields(terms,['publicOrigin','payment','paymentOptions','products'],'merchant terms');
  const url = new URL(text(terms.publicOrigin,'public origin',2048));
  const local = false;
  if (url.protocol !== 'https:' || url.username || url.password || url.search ||
      url.hash || url.pathname !== '/') fail('MARKET_SELLER_ORIGIN_INVALID');
  const origin = url.origin;
  function payment(value) {
    if (!object(value)) fail('MARKET_PAYMENT_REQUIRED');
    const one = Object.hasOwn(value,'payment'), many = Object.hasOwn(value,'paymentOptions');
    if (one === many) fail('MARKET_PAYMENT_REQUIRED','Supply one payment or ordered paymentOptions');
    return one ? {payment:value.payment} : {paymentOptions:value.paymentOptions};
  }
  const overrides = terms.products ?? {};
  fields(overrides,plan.products.map(product=>product.id),'per-product terms');
  const requests = [];
  const routes = plan.products.map(product => {
    const sample = exampleQuery(product);
    requests.push({operationId:product.id,method:'GET',url:origin+product.path,
      inputs:{query:sample},providerQuery:bindMarketQuery(product,queryParameters(sample))});
    const offer = compileHttpSellerOffer({
      url:origin+product.path, method:'GET', serviceName:product.name,
      description:product.description, tags:['market-data','twelvedata'],
      ...payment(Object.hasOwn(overrides,product.id) ? overrides[product.id] : terms),
      queryParameters:product.inputs.map(name => ({
        name,type:parameterType(name),description:parameterDescription(name,product),
        required:!Object.hasOwn(product.defaults,name) &&
          (name === 'symbol' || name === 'interval' && product.endpoint === 'time_series'),
        example:parameterExample(name,product),
      })),
    },{allowLocalhost:local});
    const querySchema = offer.extensions.bazaar.schema.properties.input.properties.queryParams;
    offer.extensions.bazaar.schema.properties.input.description =
      'Twelve Data ' + product.endpoint + '. Fixed/default provider parameters: ' +
      JSON.stringify(product.defaults) + '. Native JSON response; maximum ' +
      product.maxRows + ' returned bars. Daily/weekly/monthly bars remain in exchange-local time.';
    if (querySchema) {
      if (querySchema.properties.symbol) querySchema.properties.symbol.enum = [...product.symbols];
      if (querySchema.properties.interval) querySchema.properties.interval.enum = [...product.intervals];
      for (const name of ['prepost','eod','previous_close'])
        if (querySchema.properties[name]) querySchema.properties[name].enum = ['true','false'];
      if (querySchema.properties.order) querySchema.properties.order.enum = ['asc','desc'];
      if (querySchema.properties.adjust) querySchema.properties.adjust.enum = ['all','splits','dividends','none'];
    }
    return {id:product.id,path:product.path,handler:handlerName(product.id),
      admit:handlerName(product.id,true),validateInput:true,offer};
  });
  const compiled = compileSellerRoutes(routes.map(route => ({
    id:route.id,offer:route.offer,handler:unavailable,admit:unavailable,
  })),{allowLocalhost:local});
  const seller = {schema:'stellar-forge.seller-service.v1',publicOrigin:origin,routes};
  const openapi = compileSellerOpenApi(compiled,{mode:'CHALLENGE_ONLY'});
  const client = generateSellerClient(jsonBytes(openapi));
  return {plan,seller,openapi,client,requests};
}
export function validateMarketSeller(seller,raw) {
  const plan = compileMarketPlan(raw);
  if (seller?.schema !== 'stellar-forge.seller-service.v1' ||
      !Array.isArray(seller.routes) || seller.routes.length !== plan.products.length)
    fail('MARKET_SELLER_BINDING_INVALID');
  const pending = new Map(plan.products.map(p=>[p.id,p]));
  for (const route of seller.routes) {
    const product = pending.get(route.id);
    if (!product || route.path !== product.path || route.handler !== handlerName(product.id) ||
        route.admit !== handlerName(product.id,true) || route.validateInput !== true ||
        route.offer?.extensions?.bazaar?.info?.input?.method !== 'GET')
      fail('MARKET_SELLER_BINDING_INVALID');
    pending.delete(route.id);
  }
  return plan;
}
export async function exportMarketSeller({plan,terms,directory}) {
  const compiled = compileMarketSeller(plan,terms);
  const planBytes=jsonBytes(compiled.plan),termsBytes=jsonBytes(terms);
  const identity=digest(jsonBytes({plan:digest(planBytes),terms:digest(termsBytes),contract:CONTRACT,
    service:digest(jsonBytes(compiled.seller)),openapi:digest(jsonBytes(compiled.openapi)),
    client:digest(compiled.client.javascript),declarations:digest(compiled.client.declarations)}));
  const run = [
    '# Twelve Data merchant package','',
    'This folder contains configuration and the original generated SF30 buyer client. Provider data and API keys are excluded.',
    'Use the complete Stellar Forge checkout or installed distribution containing sf30-seller-sdk/twelvedata/cli.mjs.',
    '',
    'node /PATH/TO/sf30-seller-sdk/twelvedata/cli.mjs serve --package '+'. --check',
    'node /PATH/TO/sf30-seller-sdk/twelvedata/cli.mjs serve --package '+'. --port 8423',
    '',
    'Supply the named API-key environment variable before serving. The check is offline and needs no key.',
    'A configured native merchant adds its original --facilitator URL; ordered payment options remain in service.json.',
    'Evaluation plans run the original challenge-only seller. Authorized service deployment uses the operator’s actual entitlement and configured terms.',
    'Keep the API-key account private. This package does not implement the separate Twelve Data multi-user OAuth server.',
    '',
    'buyer/README.md documents the ORIGINAL generated request/client API. Retain original Buyer intents and recover existing attempts before another execution.',
    'For typed returned bars/quotes/prices, import MarketDataDelivery from twelvedata/customer.mjs and call fromBuyerResult(result,{endpoint,query,usage}).',
    'Its export includes unchanged response.json, records.jsonl, CSV with null/absence metadata, native provenance and exact hashes.',
    '',
    'Operator data use: '+JSON.stringify(compiled.plan.usage),
    'A capture timestamp is an observation time; it does not change the native bar/quote timestamp or imply live coverage.',
    '',
  ].join('\n');
  return publishBundle(resolve(directory),PACKAGE,identity,[
    ['plan.json',planBytes],['merchant-terms.json',termsBytes],
    ['service.json',jsonBytes(compiled.seller)],['provider-contract.json',jsonBytes(CONTRACT)],
    ['buyer/seller-openapi.json',jsonBytes(compiled.openapi)],
    ['buyer/seller-client.mjs',compiled.client.javascript],
    ['buyer/seller-client.d.mts',compiled.client.declarations],
    ['buyer/package.json',compiled.client.packageJson],
    ['buyer/README.md',compiled.client.readme],['buyer/requests.json',jsonBytes(compiled.requests)],
    ['RUN.md',run],
  ],{planSha256:digest(planBytes),mode:'CHALLENGE_ONLY_PREPARATION',dataUse:compiled.plan.usage,contract:CONTRACT});
}
export async function readMarketSeller(directory) {
  const saved=await readBundle(directory,{schema:PACKAGE});
  const plan=JSON.parse(saved.files.get('plan.json')),seller=JSON.parse(saved.files.get('service.json'));
  validateMarketSeller(seller,plan); return {...saved,plan,seller};
}

export class MarketWorkspace {
  constructor(directory) { this.directory=resolve(directory); }
  async ready() {
    await privateDirectory(this.directory);
    await privateDirectory(join(this.directory,'captures')); return this;
  }
  captureDirectory(id) { return join(this.directory,'captures',identifier(id)); }
  /** Import an operator's retained HTTP response, without issuing or replaying a request. */
  async importResponse({id,plan:raw,productId,query,responseFile,sourceFile}) {
    await this.ready();
    const plan=compileMarketPlan(raw),product=productFor(plan,productId);
    const normalized=bindMarketQuery(product,queryParameters(query));
    const sourceBytes=await readBytes(resolve(sourceFile),65536);
    const source=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(sourceBytes));
    fields(source,['schema','request','response','startedAt','finishedAt','bodySha256','bodyBytes'],'HTTP observation');
    fields(source.request,['method','url'],'HTTP request');
    fields(source.response,['status','headers'],'HTTP response');
    if (source.schema!=='stellar-forge.twelvedata-http-observation.v1' ||
        source.request.method!=='GET' || !Number.isInteger(source.response.status) ||
        source.response.status<100 || source.response.status>599)
      fail('MARKET_HTTP_OBSERVATION_INVALID');
    const url=new URL(text(source.request.url,'original request URL',8192));
    if (url.origin!=='https://api.twelvedata.com' || url.pathname!=='/'+product.endpoint ||
        url.username || url.password || url.hash) fail('MARKET_HTTP_REQUEST_MISMATCH');
    const expected={...normalized,format:'JSON'},seen=new Set();
    for (const [name,value] of url.searchParams) {
      if (seen.has(name) || !Object.hasOwn(expected,name) || String(expected[name])!==value)
        fail('MARKET_HTTP_REQUEST_MISMATCH');
      seen.add(name);
    }
    if (seen.size!==Object.keys(expected).length) fail('MARKET_HTTP_REQUEST_MISMATCH');
    const time=value=>typeof value==='string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
      Number.isFinite(Date.parse(value));
    if (!time(source.startedAt) || !time(source.finishedAt) ||
        Date.parse(source.finishedAt)<Date.parse(source.startedAt))
      fail('MARKET_HTTP_OBSERVATION_TIME_INVALID');
    const bytes=await readBytes(resolve(responseFile),plan.maxResponseBytes);
    if (source.bodyBytes!==bytes.length || source.bodySha256!==digest(bytes))
      fail('MARKET_HTTP_RESPONSE_CHANGED');
    const allowed=new Set(['content-type','date','api-credits-used','api-credits-left',
      'api-credits-request','retry-after','cache-control']);
    if (!object(source.response.headers)) fail('MARKET_HTTP_HEADERS_INVALID');
    const headers={};
    for (const [name,value] of Object.entries(source.response.headers)) {
      const lower=name.toLowerCase();
      if (!allowed.has(lower) || Object.hasOwn(headers,lower) || typeof value!=='string' ||
          value.length>8192 || /[\r\n\0]/.test(value)) fail('MARKET_HTTP_HEADERS_INVALID');
      headers[lower]=value;
    }
    let parsed=null,validationError=null;
    if (source.response.status===200) {
      try { parsed=readMarketResponse(product.endpoint,normalized,bytes); }
      catch (error) { validationError=error.code??'MARKET_NATIVE_RESPONSE_INVALID'; }
    }
    const request={schema:'stellar-forge.twelvedata-capture-request.v1',captureId:identifier(id),
      plan,productId,query,providerQuery:normalized,contract:CONTRACT,
      importedObservationSha256:digest(sourceBytes)};
    const requestBytes=jsonBytes(request),requestSha256=digest(requestBytes);
    const observation={productId,endpoint:product.endpoint,providerUrl:url.origin+url.pathname,
      query:expected,startedAt:source.startedAt,finishedAt:source.finishedAt,status:source.response.status,
      semantics:parsed?.semantics??null,
      bodyOrigin:parsed?'TWELVE_DATA_NATIVE_JSON':'TWELVE_DATA_IMPORTED_ERROR_RESPONSE',
      acquisitionKind:'OPERATOR_IMPORTED_HTTP_RESPONSE',
      creditsUsed:headers['api-credits-used']??null,creditsLeft:headers['api-credits-left']??null,
      requestCredits:headers['api-credits-request']??null};
    const report={schema:'stellar-forge.twelvedata-capture-result.v1',
      state:parsed?'COMPLETE':'FAILED',requestSha256,observation,headers,validationError,
      responseSha256:digest(bytes),responseBytes:bytes.length,
      retainedUntil:new Date(Date.parse(source.finishedAt)+plan.usage.retentionSeconds*1000).toISOString()};
    const saved=await publishBundle(this.captureDirectory(id),CAPTURE,requestSha256,[
      ['request.json',requestBytes],['response.json',bytes],['capture.json',jsonBytes(report)],
      ['original-http-observation.json',sourceBytes],
    ]);
    return {...await this.inspect(id),reused:saved.reused};
  }
  async capture({id,plan:raw,productId,query,sourceOptions={}}) {
    await this.ready();
    const plan=compileMarketPlan(raw),product=productFor(plan,productId);
    const normalized=bindMarketQuery(product,queryParameters(query));
    const request={schema:'stellar-forge.twelvedata-capture-request.v1',captureId:identifier(id),
      plan,productId,query,providerQuery:normalized,contract:CONTRACT};
    const requestBytes=jsonBytes(request),requestSha256=digest(requestBytes);
    const directory=this.captureDirectory(id);
    await privateDirectory(directory);
    await putOnce(join(directory,'request.json'),requestBytes);
    if (await exists(join(directory,'manifest.json'))) {
      const saved=await this.inspect(id);
      if (saved.manifest.identity!==requestSha256) fail('MARKET_CAPTURE_IDENTITY_CHANGED');
      await writeJson(join(directory,'state.json'),{state:saved.report.state,requestSha256});
      return {...saved,reused:true};
    }
    if (await exists(join(directory,'state.json'))) {
      const prior=await readJson(join(directory,'state.json'));
      if (prior.state==='DISPATCHING') fail('MARKET_CAPTURE_OUTCOME_UNKNOWN',
        'This capture already dispatched. Inspect its retained files; a new explicit capture ID is a new provider request.');
    }
    const source=createTwelveDataSource(plan,sourceOptions);
    const startedAt=new Date().toISOString();
    // The create-only dispatch marker prevents concurrent callers/restarts from
    // silently creating a second provider call under one capture identity.
    await writeJson(join(directory,'state.json'),{state:'DISPATCHING',startedAt,requestSha256},{exclusive:true});
    let observed;
    try { observed=await source.capture(productId,query); }
    catch (error) {
      await writeJson(join(directory,'exception.json'),{state:'UNKNOWN',code:error.code??'MARKET_CAPTURE_EXCEPTION',
        at:new Date().toISOString()},{exclusive:true});
      throw error;
    } finally { source.close(); }
    const response=observed.response;
    const bytes=response.body instanceof Uint8Array ? Buffer.from(response.body) : jsonBytes(response.body);
    const observation=observed.observation??{productId,endpoint:product.endpoint,
      providerUrl:'https://api.twelvedata.com/'+product.endpoint,query:normalized,
      startedAt,finishedAt:new Date().toISOString(),status:response.status,
      bodyOrigin:'ORIGINAL_SF30_APPLICATION_ERROR',semantics:null};
    const state=response.status===200 && observation.bodyOrigin==='TWELVE_DATA_NATIVE_JSON' ? 'COMPLETE' : 'FAILED';
    const report={schema:'stellar-forge.twelvedata-capture-result.v1',state,requestSha256,
      observation,headers:response.headers??{},responseSha256:digest(bytes),responseBytes:bytes.length,
      retainedUntil:new Date(Date.parse(observation.finishedAt)+plan.usage.retentionSeconds*1000).toISOString()};
    const reportBytes=jsonBytes(report);
    await putOnce(join(directory,'response.json'),bytes);
    await putOnce(join(directory,'capture.json'),reportBytes);
    const manifest={schema:CAPTURE,identity:requestSha256,files:[
      {name:'request.json',bytes:requestBytes.length,sha256:requestSha256},
      {name:'response.json',bytes:bytes.length,sha256:digest(bytes)},
      {name:'capture.json',bytes:reportBytes.length,sha256:digest(reportBytes)},
    ]};
    await writeJson(join(directory,'manifest.json'),manifest,{exclusive:true});
    await writeJson(join(directory,'state.json'),{state,requestSha256});
    return {...await this.inspect(id),reused:false};
  }
  async inspect(id) {
    const directory=this.captureDirectory(id);
    if (!await exists(join(directory,'manifest.json'))) {
      return {directory,state:await exists(join(directory,'state.json')) ?
        await readJson(join(directory,'state.json')) : {state:'PREPARATION_INCOMPLETE'}};
    }
    const saved=await readBundle(directory,{schema:CAPTURE});
    const report=JSON.parse(saved.files.get('capture.json'));
    return {directory,manifest:saved.manifest,manifestSha256:saved.manifestSha256,report,
      retentionExpired:Date.now()>Date.parse(report.retainedUntil)};
  }
  async list() {
    await this.ready(); const captures=[];
    for (const entry of await readdir(join(this.directory,'captures'),{withFileTypes:true})) {
      if (!entry.isDirectory() || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(entry.name)) continue;
      const saved=await this.inspect(entry.name);
      captures.push({id:entry.name,state:saved.report?.state??saved.state?.state,
        productId:saved.report?.observation.productId??null,
        receivedAt:saved.report?.observation.finishedAt??null,
        records:saved.report?.observation.semantics?.returnedRows??null,
        retentionExpired:saved.retentionExpired??false});
    }
    return captures;
  }
}
