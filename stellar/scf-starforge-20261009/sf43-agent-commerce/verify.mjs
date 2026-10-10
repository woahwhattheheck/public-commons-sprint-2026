// MIT — SF-43. Independently inspect a real Stellar TESTNET x402 receipt.
// Read-only RPC calls; neither this module nor its caller may infer a paid sale
// from HTTP status 200 or a seller-generated PAYMENT-RESPONSE header alone.
const RPC = 'https://soroban-testnet.stellar.org';
const HASH = /^[0-9a-f]{64}$/;
const AMOUNT = /^[1-9][0-9]*$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const failure = (code, more = {}) => ({ status: 'NOT_VERIFIED', reason: code, ...more });

export function decodeX402Header(raw, name='PAYMENT-RESPONSE') {
  if (typeof raw !== 'string' || !raw || raw.length > 32768 || !BASE64.test(raw) || raw.length % 4)
    throw new TypeError(`${name}: invalid base64`);
  const decoded = Buffer.from(raw,'base64');
  if (decoded.toString('base64') !== raw) throw new TypeError(`${name}: noncanonical base64`);
  const value = JSON.parse(decoded.toString('utf8'));
  if (!plain(value)) throw new TypeError(`${name}: expected JSON object`);
  return value;
}

export function parseExactTestnetTerms(challenge, maxAtomic) {
  if (!plain(challenge) || challenge.x402Version !== 2 || !Array.isArray(challenge.accepts))
    throw new TypeError('PaymentRequired x402Version 2 required');
  if (!AMOUNT.test(String(maxAtomic)) || challenge.accepts.length !== 1)
    throw new TypeError('Explicit positive maximum and unambiguous one-offer quote required');
  const term = challenge.accepts[0];
  if (!plain(term) || term.scheme !== 'exact' || term.network !== 'stellar:testnet' ||
      typeof term.asset !== 'string' || !/^C[A-Z2-7]{55}$/.test(term.asset) ||
      typeof term.payTo !== 'string' || !/^G[A-Z2-7]{55}$/.test(term.payTo) ||
      typeof term.amount !== 'string' || !AMOUNT.test(term.amount))
    throw new TypeError('Unexpected Stellar testnet scheme, recipient, asset contract or atomic amount');
  if (BigInt(term.amount) > BigInt(maxAtomic)) throw new RangeError('Quoted atomic amount exceeds approved maximum');
  return structuredClone(term);
}

async function callRpc(method, params, fetchImpl, endpoint) {
  if (endpoint !== RPC && !/^http:\/\/127\.0\.0\.1:[0-9]+\/$/.test(endpoint))
    throw new TypeError('Only the official read-only Stellar testnet RPC or explicit loopback for focused tests');
  const response = await fetchImpl(endpoint, {
    method:'POST', headers:{'content-type':'application/json'}, redirect:'error',
    body:JSON.stringify({jsonrpc:'2.0',id:'sf43-'+method,method,params}),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error('TESTNET_RPC_HTTP_'+response.status);
  const body = await response.json();
  if (!plain(body) || body.error || !plain(body.result)) throw new Error('TESTNET_RPC_INVALID_'+method);
  return body.result;
}

/**
 * The actual RPC getTransaction is authoritative for tx inclusion/finality, NOT
 * a proof of a specific SEP-41 transfer amount. Token transfer proof is separately
 * derived from actual RPC contract events decoded with Stellar SDK.
 */
export async function checkStellarTestnetTransaction({ receipt, expected, fetchImpl = fetch,
  rpcEndpoint=RPC, decodeContractEvent, maxEventPages = 12 } = {}) {
  if (!plain(receipt) || !plain(expected) || receipt.network !== 'stellar:testnet' ||
      expected.network !== 'stellar:testnet' || receipt.success !== true ||
      typeof receipt.transaction !== 'string' || !HASH.test(receipt.transaction))
    return failure('RECEIPT_NETWORK_SUCCESS_OR_HASH_INVALID');
  if (typeof expected.asset !== 'string' || !/^C[A-Z2-7]{55}$/.test(expected.asset) ||
      typeof expected.payTo !== 'string' || !/^G[A-Z2-7]{55}$/.test(expected.payTo) ||
      typeof expected.amount !== 'string' || !AMOUNT.test(expected.amount))
    return failure('TERMS_INVALID');
  let tx;
  try { tx=await callRpc('getTransaction',{hash:receipt.transaction},fetchImpl,rpcEndpoint); }
  catch (error) { return failure('RPC_TRANSACTION_LOOKUP_FAILED',{detail:error.message}); }
  if (tx.status !== 'SUCCESS' || tx.txHash !== receipt.transaction ||
      !Number.isSafeInteger(tx.ledger) || tx.ledger <= 0) {
    return failure(tx.status === 'NOT_FOUND' ? 'RPC_TRANSACTION_NOT_FOUND' : 'RPC_TRANSACTION_NOT_SUCCESS',
      {reportedStatus:tx.status??null});
  }
  const inclusion={ network:'stellar:testnet', transaction:tx.txHash, ledger:tx.ledger,
    proof:'INDEPENDENT_STELLAR_RPC_GET_TRANSACTION_SUCCESS' };
  if (typeof decodeContractEvent !== 'function')
    return {status:'TX_INCLUDED_TRANSFER_UNVERIFIED',...inclusion,reason:'NO_SOROBAN_EVENT_DECODER'};
  let page='', pages=0, sawTargetTx=false;
  try {
    while (pages++ < maxEventPages) {
      const result = await callRpc('getEvents',{
        startLedger:tx.ledger, filters:[{type:'contract',contractIds:[expected.asset]}],
        pagination:{limit:200,...(page?{cursor:page}:{})},
      },fetchImpl,rpcEndpoint);
      const events=Array.isArray(result.events)?result.events:[];
      for(const event of events) {
        if (event.txHash !== receipt.transaction || event.contractId !== expected.asset) continue;
        sawTargetTx=true;
        // Only the canonical Stellar SDK decoder, not a text search over XDR, can
        // derive the exact transfer event's source/recipient/atomic value.
        const decoded=await decodeContractEvent(event);
        if (decoded?.name === 'transfer' && decoded.to === expected.payTo &&
            String(decoded.amount) === expected.amount) {
          return {status:'TOKEN_TRANSFER_MATCHED_TESTNET',...inclusion,
            contractId:expected.asset,recipient:expected.payTo,amountAtomic:expected.amount,
            eventId:event.id??null,proof:'RPC_TX_AND_SEP41_TRANSFER_EVENT_MATCH'};
        }
      }
      const next=result.cursor ?? result.pagination?.cursor ?? null;
      if (!next || next === page) break;
      page=next;
    }
  } catch(error) {
    return {status:'TX_INCLUDED_TRANSFER_UNVERIFIED',...inclusion,
      reason:'TOKEN_EVENTS_UNAVAILABLE',detail:error.message};
  }
  return {status:'TX_INCLUDED_TRANSFER_UNVERIFIED',...inclusion,
    reason:sawTargetTx?'NO_MATCHING_SEP41_TRANSFER':'TOKEN_TRANSFER_NOT_INDEXED'};
}

/** Parse official Stellar SDK scValToNative transfer data. Legacy SEP-41
 * carries scalar i128; modern SEP-41/SAC carries {amount:i128,to_muxed_id?:...}.
 * A muxed destination is not proven to match a base-G-address-only payTo.
 */
export function parseSep41TransferAmount(native) {
  let raw=native;
  if (native instanceof Map) {
    if (!native.has('amount') || [...native.keys()].some(k=>!['amount','to_muxed_id'].includes(k)) || native.get('to_muxed_id') != null) return null;
    raw=native.get('amount');
  } else if (native !== null && typeof native === 'object') {
    if (Array.isArray(native) || !Object.hasOwn(native,'amount') ||
      Object.keys(native).some(k=>!['amount','to_muxed_id'].includes(k)) ||
      native.to_muxed_id != null) return null;
    raw=native.amount;
  }
  if (typeof raw==='bigint') return raw>0n?raw.toString():null;
  if (typeof raw==='string') return /^[1-9][0-9]*$/.test(raw)?raw:null;
  if (typeof raw==='number') return Number.isSafeInteger(raw)&&raw>0?String(raw):null;
  return null;
}

/** Prefer actual @stellar/stellar-sdk provided by @x402/stellar installation. */
export async function createOfficialEventDecoder() {
  const sdk=await import('@stellar/stellar-sdk');
  const decode=value=>sdk.scValToNative(sdk.xdr.ScVal.fromXDR(value,'base64'));
  return async event=>{
    if (!Array.isArray(event.topic) || event.topic.length < 3 || !event.value) return null;
    const [name,from,to]=event.topic.slice(0,3).map(decode);
    if (typeof name !== 'string' || name !== 'transfer') return null;
    const amount=parseSep41TransferAmount(decode(event.value));
    if (amount===null) return null;
    return {name,from:String(from),to:String(to),amount};
  };
}
