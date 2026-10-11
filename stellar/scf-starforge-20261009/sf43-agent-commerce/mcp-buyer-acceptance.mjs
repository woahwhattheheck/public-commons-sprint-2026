// MIT — SF-43. Real Bazaar -> x402 v2 -> human policy -> official signer ->
// independent Stellar testnet RPC settlement evidence; designed for SF32's MCP
// tools/call handler to invoke directly. No hard-coded paid resource is required.
import { X402BuyerClient } from '../sf31-buyer-client/buyer.mjs';
import {bindDiscoveryQuote, reviewPaymentRequired} from '../../../stellar-forge/quote-commitment/quote-commitment.mjs';
import {decodeX402Header,checkStellarTestnetTransaction,createOfficialEventDecoder} from './verify.mjs';

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
  description:'Use an independently approved native Stellar buyer for a discovered HTTP API. With the native SF88 workspace, supply a stable intentId and prepare or execute the exact request; status, history, cancel, recover and read use its original durable inbox and saved output. The legacy callback retains its original search/request interface. A tool call cannot replace terminal approval.',
  inputSchema:{type:'object',additionalProperties:false,
    properties:{
      action:{type:'string',enum:['prepare','execute','status','history','cancel','recover','read'],description:'Native workspace action; omitted means execute. Non-native operator callbacks may support only the original execute arguments.'},
      intentId:{type:'string',pattern:'^[A-Za-z0-9._:-]{1,128}$',description:'Required by the native workspace. Keep this same ID to inspect or recover an existing operation.'},
      search:{type:'string',minLength:1,maxLength:256},targetResourceURL:{type:'string'},
      targetMethod:{type:'string',enum:['GET','POST','HEAD','PUT','PATCH','DELETE']},
      maxAtomic:{type:'string',pattern:'^[1-9][0-9]*$'},
      acceptIndex:{type:'integer',minimum:0,description:'Optional exact original option index when the selected listing has several compatible alternatives.'},
      body:{type:'string',maxLength:1048576,description:'Explicit UTF-8 request body for the operator-configured non-GET/HEAD route; no file path or signer settings are accepted.'},
      byteOffset:{type:'integer',minimum:0},maxBytes:{type:'integer',minimum:1,maximum:65536},
      limit:{type:'integer',minimum:1,maximum:100},cursor:{type:'string'}
    },
    anyOf:[
      {required:['search','targetResourceURL','maxAtomic'],properties:{action:{enum:['prepare','execute']}}},
      {required:['action','intentId'],properties:{action:{enum:['execute','status','cancel','recover','read']}}},
      {required:['action'],properties:{action:{const:'history'}}}
    ]}
});
