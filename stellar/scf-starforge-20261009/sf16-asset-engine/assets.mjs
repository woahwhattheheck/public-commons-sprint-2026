// MIT. SF-16: exact, fail-closed SEP-41 asset admission; no signing or RPC.
const CONTRACT = /^C[A-Z2-7]{55}$/;
const ACCOUNT = /^[GMC][A-Z2-7]{55}$/;
const MAX_I128 = (1n << 127n) - 1n;
const NETWORKS = new Set(['stellar:testnet','stellar:pubnet']);
const integral = v => typeof v === 'string' && /^(0|[1-9][0-9]{0,38})$/.test(v);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function check(condition, msg) { if(!condition) throw new TypeError(msg); }
const key = (network, asset) => `${network}|${asset}`;
const USDC_ADDRESSES = Object.freeze({
  'stellar:testnet': 'CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA',
  'stellar:pubnet': 'CCW67TSZV3SSS2HXMBQ5JFGCKJNXKZM7UQUWUZPUTHXSTZLEO7SJMI75',
});

/** Exact decimal-to-atomic conversion: never accepts IEEE-754 numbers, exponents or rounding. */
export function parseAtomic(decimal, decimals, { allowZero=false }={}) {
  check(typeof decimal === 'string' && /^(0|[1-9]\d*)(\.\d+)?$/.test(decimal), 'Decimal MUST be a canonical positive decimal string');
  check(Number.isInteger(decimals) && decimals >= 0 && decimals <= 18, 'Invalid token decimals');
  const [whole, fraction=''] = decimal.split('.');
  check(fraction.length <= decimals, 'Fractional precision exceeds token decimals');
  const units = BigInt(whole)*10n**BigInt(decimals) + BigInt((fraction+'0'.repeat(decimals)).slice(0,decimals) || '0');
  check(units <= MAX_I128 && (allowZero || units > 0n), 'Atomic amount is zero or exceeds signed i128');
  return units.toString();
}

/** Exact atomic-to-human conversion; return plain decimal strings, never JS Number. */
export function formatAtomic(amount, decimals) {
  check(integral(amount), 'Atomic amount MUST be a canonical integer string');
  check(Number.isInteger(decimals) && decimals >= 0 && decimals <= 18, 'Invalid token decimals');
  const v = BigInt(amount);
  check(v <= MAX_I128, 'Atomic amount exceeds signed i128');
  if(!decimals) return amount;
  const base = 10n**BigInt(decimals);
  const rest = (v%base).toString().padStart(decimals,'0').replace(/0+$/,'');
  return (v/base).toString() + (rest ? '.' + rest : '');
}

/**
 * Register only verified, operator-supplied token metadata from a trusted resolver.
 * Tokens outside the explicit allowlist NEVER fall back to any default.
 */
export class AssetRegistry {
  #entries = new Map();
  constructor(entries, { now=Date.now() }={}) {
    check(Array.isArray(entries) && entries.length > 0, 'Asset allowlist required');
    for(const a of entries) {
      check(object(a), 'Asset metadata must be an object');
      check(NETWORKS.has(a.network) && CONTRACT.test(a.asset), 'Invalid network or SEP-41 contract ID');
      check(Number.isInteger(a.decimals) && a.decimals>=0 && a.decimals<=18, 'Invalid decimals');
      check(typeof a.code === 'string' && /^[A-Z0-9]{1,12}$/.test(a.code), 'Invalid asset code');
      check(typeof a.source === 'string' && a.source.length>=12 && a.source.length<=512, 'Pin an authoritative metadata source');
      check(Number.isSafeInteger(a.verifiedAtMs) && a.verifiedAtMs<=now, 'Invalid metadata observation time');
      check(Number.isSafeInteger(a.expiresAtMs) && a.expiresAtMs>now && a.expiresAtMs>a.verifiedAtMs, 'Metadata stale or invalid');
      if(a.code==='USDC') check(a.decimals===7 && a.asset===USDC_ADDRESSES[a.network], 'Stellar USDC token contract/decimal mismatch');
      const k=key(a.network,a.asset);
      check(!this.#entries.has(k),'Duplicate allowlist contract');
      this.#entries.set(k, Object.freeze({...a}));
    }
    Object.freeze(this);
  }
  get(network,asset, now=Date.now()) {
    check(NETWORKS.has(network) && typeof asset==='string' && CONTRACT.test(asset),'Unknown Stellar network or asset format');
    const a=this.#entries.get(key(network,asset));
    check(a && now < a.expiresAtMs && now >= a.verifiedAtMs,'Asset not allowlisted or metadata stale');
    return a;
  }
}

/**
 * Only a caller-owned *trusted* on-chain resolver is acceptable for recipient
 * readiness; unverified x402 client-supplied booleans are never accepted here.
 * This does not execute transfers, grant trustlines, sign, or call an RPC.
 */
export async function validatePaymentTerms(req, registry, { verifyRecipient, now=Date.now() }={}) {
  check(object(req) && registry instanceof AssetRegistry,'Payment terms and trusted registry required');
  // Snapshot all caller-controlled payment terms before validation and before
  // awaiting a trusted recipient check. Never re-read mutable request fields.
  const terms=Object.freeze({scheme:req.scheme,network:req.network,asset:req.asset,amount:req.amount,payTo:req.payTo});
  check(terms.scheme === 'exact' && typeof terms.asset==='string', 'Unsupported scheme or asset');
  const a = registry.get(terms.network,terms.asset,now);
  check(typeof terms.amount==='string' && integral(terms.amount), 'Canonical atomic amount string required');
  const amount=BigInt(terms.amount);
  check(amount>0n && amount<=MAX_I128, 'Amount out of signed i128 range');
  check(typeof terms.payTo==='string' && ACCOUNT.test(terms.payTo),'Invalid Stellar recipient address format');
  check(typeof verifyRecipient==='function', 'Trusted recipient-state verifier required');
  // Resolver must assert expected chain/asset/recipient and freshly observed status.
  const result=await verifyRecipient(Object.freeze({network:a.network,asset:a.asset,payTo:terms.payTo}));
  check(object(result) && result.network===a.network && result.asset===a.asset && result.payTo===terms.payTo && result.ready === true, 'Recipient not verified for this asset/network');
  check(Number.isSafeInteger(result.observedAtMs) && result.observedAtMs <= now && now - result.observedAtMs<=60_000,'Recipient verification stale');
  return Object.freeze({network:a.network,asset:a.asset,scheme:'exact',payTo:terms.payTo,amount:terms.amount,decimalAmount:formatAtomic(terms.amount,a.decimals),metadataSource:a.source,verifiedRecipientAtMs:result.observedAtMs});
}

export const StellarUSDC = Object.freeze({
  testnet:USDC_ADDRESSES['stellar:testnet'],
  pubnet:USDC_ADDRESSES['stellar:pubnet'],
  decimals:7,
});
