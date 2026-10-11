// MIT — SF-43. Real Bazaar -> x402 v2 -> human policy -> official signer ->
// independent Stellar testnet RPC settlement evidence; designed for SF32's MCP
// tools/call handler to invoke directly. No hard-coded paid resource is required.
import { X402BuyerClient } from '../sf31-buyer-client/buyer.mjs';
import {bindDiscoveryQuote, reviewPaymentRequired} from '../../../stellar-forge/quote-commitment/quote-commitment.mjs';
import {decodeX402Header,checkStellarTestnetTransaction,createOfficialEventDecoder} from './verify.mjs';
import {nativeAnalysisActions,nativeAnalysisSchema} from '../../../stellar-forge/mcp-paid-agent/native-analysis-schema.mjs';

const REPORT=(reason,other={})=>({decision:'NOT_AUTHORIZED',reason,...other});
/**
 * Caller supplies the *actual* catalog's base URL, the real official x402
 * signer, and real one-use consent. Entry selection uses the exact Bazaar
 * listing URL/method/terms from source, not an agent-generated hallucination.
 */
export async function executeDiscoveredHttpPayment({
  catalogOrigin, search, targetResourceURL, targetMethod='GET',
  fetchImpl=fetch, rpcFetch=fetch, approve, sign, allowLocal=false,
  maxAtomic, quoteTtlMs=60000, trace=()=>{}
}={}) {
  if (typeof approve !== 'function' || typeof sign !== 'function')
    throw new TypeError('Explicit one-request consent and official canonical scheme signer required');
  if (typeof search !== 'string' || !search.trim() || typeof targetResourceURL !== 'string')
    throw new TypeError('Actual Bazaar search and selected listing URL required');
  if (typeof maxAtomic !== 'string' || !/^[1-9][0-9]*$/.test(maxAtomic))
    throw new TypeError('Positive explicit maximum in smallest token units required');
  const discoverer=new X402BuyerClient({fetchImpl,allowLocal});
  const catalog=await discoverer.discover({origin:catalogOrigin,query:search,
    filters:{type:'http',network:'stellar:testnet'},limit:100});
  const matches=catalog.resources.filter(row=>row.resource?.url===targetResourceURL &&
    row.extensions?.bazaar?.info?.input?.type==='http' &&
    row.extensions.bazaar.info.input.method===targetMethod);
  if(matches.length!==1)return REPORT('RESOURCE_OR_METHOD_NOT_UNIQUELY_DISCOVERED',
    {matchingRows:matches.length});
  const listing=matches[0];
  if(!Array.isArray(listing.accepts) || listing.accepts.length!==1)
    return REPORT('AMBIGUOUS_LISTING_PAYMENT_OPTIONS');
  const terms=listing.accepts[0];
  if(terms.scheme!=='exact'||terms.network!=='stellar:testnet'||
      typeof terms.amount!=='string' || !/^[1-9][0-9]*$/.test(terms.amount) ||
      BigInt(terms.amount)>BigInt(maxAtomic))
    return REPORT('PAYMENT_TERMS_OUTSIDE_TESTNET_POLICY');
  const quote=bindDiscoveryQuote({listing,acceptanceIndex:0,ttlMs:quoteTtlMs});
  trace({stage:'REAL_BAZAAR_DISCOVERY',source:catalog.source,
    quoteId:quote.quoteId,resource:quote.identity,terms:quote.terms});
  let challengeReview=null;
  const guardedFetch=async(input,init={})=>{
    const headers=new Headers(init.headers??{});
    const response=await fetchImpl(input,init);
    if(!headers.has('payment-signature') && response.status===402){
      const challenge=decodeX402Header(response.headers.get('payment-required'),'PAYMENT-REQUIRED');
      challengeReview=reviewPaymentRequired({quote,paymentRequired:challenge,
        invocation:{kind:'http',resourceURL:targetResourceURL,method:targetMethod}});
      if(!challengeReview.ok)throw new Error('DISCOVERY_TO_402_QUOTE_DRIFT:'+challengeReview.reason);
      trace({stage:'REAL_HTTP_402_VALIDATED',quoteId:quote.quoteId});
    }
    return response;
  };
  const buyer=new X402BuyerClient({fetchImpl:guardedFetch,allowLocal});
  let decision;
  try {
    const result=await buyer.call({url:targetResourceURL,method:targetMethod,
      expect:{scheme:'exact',network:quote.terms.network,asset:quote.terms.asset,
        payTo:quote.terms.payTo,maxAtomic},
      approve:async intent=>{
        if(!challengeReview?.ok || intent.amount!==quote.terms.amount ||
            intent.payTo!==quote.terms.payTo || intent.network!==quote.terms.network ||
            intent.asset!==quote.terms.asset) return false;
        return await approve({intent,quoteId:quote.quoteId,resource:quote.identity,
          exactTerms:structuredClone(quote.terms)})===true;
      },sign});
    if(result.status==='NO_PAYMENT_REQUIRED')return REPORT('RESOURCE_NOT_PAYMENT_PROTECTED');
    const receipt=result.receipt;
    if(!receipt || result.settlement!=='REPORTED_SUCCESS')
      return {decision:'PAID_CALL_OUTCOME_UNCONFIRMED',buyerStatus:result.status,
        receipt:receipt??null,quoteId:quote.quoteId};
    let decoder;
    try {decoder=await createOfficialEventDecoder();}
    catch {decoder=undefined;}
    const proof=await checkStellarTestnetTransaction({receipt,expected:quote.terms,
      fetchImpl:rpcFetch,decodeContractEvent:decoder});
    decision={decision:proof.status==='TOKEN_TRANSFER_MATCHED_TESTNET'?
      'ONCHAIN_SEP41_TRANSFER_MATCHED':'TRANSACTION_REQUIRES_FURTHER_PROOF',
      buyerStatus:result.status,quoteId:quote.quoteId,proof};
  } catch(error) { decision=REPORT('BUYER_CALL_FAILED',{detail:error.message}); }
  return decision;
}

// Adapter shape is deliberately not a second MCP server implementation. SF32
// owns streamable HTTP initialize/tools/list/tools/call JSON-RPC and consent state.
export const mcpAgentCommerceTool = Object.freeze({
  name:'sf43_discover_review_and_pay',
  description:'Use an independently approved native Stellar buyer for a discovered HTTP API. Native SF88 supports ordinary requests, complete object-* acquisition from an operator-registered S3 description, and dataset-* acquisition from an original SF30 dataset description. Dataset customers select an exact snapshot/query and whole-query limits, run/recover original per-page purchases, deliver through SF100, read typed rows or exact files, and inspect/finalize original accounting. The analysis action uses a host-registered original analytical workspace to import completed data, review editions, run SQL, publish reports and reopen verified exports. All purchase types share the original operator approval gate and ledger. Legacy callbacks retain their original interface; a tool call cannot replace approval.',
  inputSchema:{type:'object',additionalProperties:false,
    properties:{
      action:{type:'string',enum:['prepare','execute','status','history','cancel','recover','read',
        'object-sources','object-list','object-prepare','object-history','object-status','object-run',
        'object-cancel','object-recover','object-assemble','object-read','object-accounting','object-finalize',
        'dataset-sources','dataset-describe','dataset-prepare','dataset-history','dataset-status','dataset-run',
        'dataset-cancel','dataset-recover','dataset-deliver','dataset-rows','dataset-read','dataset-accounting','dataset-finalize',
        ...nativeAnalysisActions],
        description:'Native workspace action; omitted means execute. object-* and dataset-* use operator-registered original descriptions and native acquisition sessions. Non-native callbacks may support only the original execute arguments.'},
      intentId:{type:'string',pattern:'^[A-Za-z0-9._:-]{1,128}$',description:'Required by the native workspace. Keep this same ID to inspect or recover an existing operation.'},
      search:{type:'string',minLength:1,maxLength:256},targetResourceURL:{type:'string'},
      targetMethod:{type:'string',enum:['GET','POST','HEAD','PUT','PATCH','DELETE']},
      maxAtomic:{type:'string',pattern:'^[1-9][0-9]*$'},
      acceptIndex:{type:'integer',minimum:0,description:'Optional exact original option index when the selected listing has several compatible alternatives.'},
      body:{type:'string',maxLength:1048576,description:'Explicit UTF-8 request body for the operator-configured non-GET/HEAD route; no file path or signer settings are accepted.'},
      byteOffset:{type:'integer',minimum:0},maxBytes:{type:'integer',minimum:1,maximum:65536},
      limit:{type:'integer',minimum:1,maximum:100},cursor:{type:'string'},
      sourceId:{type:'string',pattern:'^[a-f0-9]{64}$',description:'Exact registered descriptor ID returned by object-sources or dataset-sources. Tool arguments cannot import a local file.'},
      objectId:{type:'string',pattern:'^[A-Za-z0-9_-]{1,64}$',description:'Original merchant object ID from object-list.'},
      acquisitionId:{type:'string',pattern:'^[A-Za-z0-9._:-]{1,128}$',description:'Stable complete acquisition identity. Reuse it for run, recovery, accounting and file reads.'},
      chunkBytes:{type:'integer',minimum:1,maximum:1048576,description:'Optional native descriptor-bounded chunk length. Whole products keep their exact fixed length.'},
      maxTotalAtomic:{type:'string',pattern:'^[1-9][0-9]*$',description:'Explicit maximum for the complete object or dataset query. The original per-request cap and configured cumulative ledger still apply.'},
      offset:{type:'integer',minimum:0,description:'Zero-based list/status/accounting offset, or row offset for dataset-rows.'},
      query:{type:'object',additionalProperties:{type:'string',maxLength:8192},maxProperties:32,
        description:'Original dataset query parameters as strings: fields, limit, where_COLUMN, gt/gte/lt/lte_COLUMN and sort. Only descriptor-enabled typed capabilities are accepted. The registered snapshot is pinned; initial cursors are not accepted.'},
      maxPages:{type:'integer',minimum:1,maximum:4096},
      maxRows:{type:'integer',minimum:1,maximum:1000000},
      maxPageBytes:{type:'integer',minimum:1024,maximum:2097152},
      filename:{type:'string',enum:['dataset.jsonl','dataset.csv','review.html','manifest.json'],
        description:'Exact original SF100 delivered file for dataset-read; return its bytes without reformatting.'},
      ...nativeAnalysisSchema.properties
    },
    anyOf:[
      {required:['search','targetResourceURL','maxAtomic'],properties:{action:{enum:['prepare','execute']}}},
      {required:['action','intentId'],properties:{action:{enum:['execute','status','cancel','recover','read']}}},
      {required:['action'],properties:{action:{enum:['history','object-history','object-sources','dataset-history','dataset-sources']}}},
      {required:['action','sourceId'],properties:{action:{const:'object-list'}}},
      {required:['action','sourceId','objectId','acquisitionId','maxTotalAtomic'],properties:{action:{const:'object-prepare'}}},
      {required:['action','acquisitionId'],properties:{action:{enum:['object-status','object-run','object-cancel',
        'object-recover','object-assemble','object-read','object-accounting','object-finalize']}}},
      {required:['action','sourceId'],properties:{action:{const:'dataset-describe'}}},
      {required:['action','sourceId','acquisitionId','query','maxPages','maxTotalAtomic','maxRows','maxPageBytes'],
        properties:{action:{const:'dataset-prepare'}}},
      {required:['action','acquisitionId'],properties:{action:{enum:['dataset-status','dataset-run','dataset-cancel',
        'dataset-recover','dataset-deliver','dataset-rows','dataset-accounting','dataset-finalize']}}},
      {required:['action','acquisitionId','filename'],properties:{action:{const:'dataset-read'}}},
      ...nativeAnalysisSchema.anyOf
    ]}
});
