// MIT. SF-37: x402 v2 Stellar upto wire-profile negotiation and preflight.
// No cryptographic verification, Soroban execution, signing, billing or finality.
// Source: x402 Foundation open proposals #3134 (stateless) and #3098 (dual).
const MAX_I128 = (1n << 127n) - 1n;
const NETWORKS = new Set(['stellar:testnet','stellar:pubnet']);
const knownProfile = new Set(['stateless','contract']);
const plain = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const nonblank = (v, name) => {
  if (typeof v !== 'string' || !v.trim() || v.length > 2048) throw new TypeError(name + ': expected nonempty string');
  return v;
};
const integer = (v, name, {min=0,max=Number.MAX_SAFE_INTEGER}={}) => {
  if (!Number.isSafeInteger(v) || v < min || v > max) throw new TypeError(name + ': unsafe integer');
  return v;
};
const MAX_I128_DECIMAL_DIGITS = MAX_I128.toString().length;
export function atomicAmount(value, {allowZero=false}={}) {
  if (typeof value !== 'string') throw new TypeError('AMOUNT_NOT_CANONICAL_ATOMIC_STRING');
  // Reject overlength x402 decimals before regex scanning or arbitrary-precision parsing.
  if (value.length > MAX_I128_DECIMAL_DIGITS) throw new RangeError('AMOUNT_OUTSIDE_SIGNED_I128');
  if (!/^(0|[1-9][0-9]*)$/.test(value))
    throw new TypeError('AMOUNT_NOT_CANONICAL_ATOMIC_STRING');
  const n=BigInt(value);
  if (n > MAX_I128 || (!allowZero && n===0n)) throw new RangeError('AMOUNT_OUTSIDE_SIGNED_I128');
  return n;
}
function terms(entry, stage) {
  if (!plain(entry) || entry.scheme !== 'upto' || !NETWORKS.has(entry.network))
    throw new TypeError(stage+': expected x402 upto Stellar CAIP-2 terms');
  for(const k of ['asset','payTo']) nonblank(entry[k],stage+'.'+k);
  const amount=atomicAmount(entry.amount,{allowZero:stage==='settle'});
  integer(entry.maxTimeoutSeconds,stage+'.maxTimeoutSeconds',{min:1,max:86400});
  if(!plain(entry.extra) || typeof entry.extra.areFeesSponsored !== 'boolean' ||
     typeof entry.extra.settlementContract !== 'string' || !entry.extra.settlementContract.trim())
    throw new TypeError(stage+': missing explicit fee sponsorship and settlement contract');
  return amount;
}
function trustedRecord(registry, network, profile) {
  // Only first-party, trusted operator network/profile pins; never follow a payer's
  // self-reported extra.settlementContract. A mismatched address is a hard refusal.
  const hit=registry?.[network]?.[profile];
  if(!plain(hit) || typeof hit.settlementContract !== 'string' || !hit.settlementContract)
    throw new TypeError('UNCONFIGURED_TRUSTED_'+profile.toUpperCase()+'_CONTRACT');
  return hit;
}
export function resolveUptoProfile(extra, {allowSingleStatelessLegacy=false,supportedProfiles=['stateless']}={}) {
  if(!plain(extra)) throw new TypeError('MISSING_SCHEME_EXTRA');
  const advertised=extra.uptoProfile;
  // #3134 predates extra.uptoProfile, #3098 requires explicit discriminator
  // when profiles coexist. Legacy alias may NEVER infer the stateful profile.
  const profile = advertised===undefined && allowSingleStatelessLegacy &&
    supportedProfiles.length===1 && supportedProfiles[0]==='stateless'
    ? 'stateless' : advertised;
  if(!knownProfile.has(profile)) throw new TypeError('EXPLICIT_KNOWN_UPTO_PROFILE_REQUIRED');
  if(!supportedProfiles.includes(profile)) throw new TypeError('UPTO_PROFILE_NOT_SUPPORTED');
  return {profile,source:advertised===undefined?'3134_stateless_legacy':'3098_explicit'};
}
const keyFields=['scheme','network','asset','payTo','maxTimeoutSeconds'];
function equivalent(a,b){for(const k of keyFields) if(a[k]!==b[k])throw new TypeError('OFFER_TERMS_DRIFT:'+k);}
function contractMatches(t,baseline){
  if(t.extra?.settlementContract !== baseline.settlementContract)throw new TypeError('SETTLEMENT_CONTRACT_NOT_TRUSTED');
  if(t.extra?.areFeesSponsored !== true)throw new TypeError('FEE_SPONSORSHIP_REQUIRED');
}
function checkStatelessPayload(p,amount) {
  // Structural inspection is NOT XDR parsing or signature validation.
  for (const f of ['from','payTo','asset','salt']) nonblank(p[f],'payload.'+f);
  if (p.asset!==amount.asset || p.payTo!==amount.payTo) throw new TypeError('UNSIGNED_PAYLOAD_FIELD_DRIFT');
  if (atomicAmount(p.maxAmount)!==atomicAmount(amount.amount)) throw new TypeError('MAX_AMOUNT_DRIFT');
  integer(p.validAfter,'payload.validAfter'); integer(p.deadline,'payload.deadline');
  if(p.deadline<=p.validAfter)throw new TypeError('INVALID_UNIX_TIME_WINDOW');
  integer(p.expirationLedger,'payload.expirationLedger',{min:1});
  if(typeof p.autoRevoke!=='boolean')throw new TypeError('AUTO_REVOKE_NOT_BOOLEAN');
  if(!Array.isArray(p.authEntries) || p.authEntries.length!==1 || typeof p.authEntries[0]!=='string' ||
    !p.authEntries[0].trim())throw new TypeError('ONE_AUTH_ENTRY_REQUIRED');
  return {credentialMode:'AUTH_ENTRY_XDR_UNVERIFIED',window:'unix_seconds_plus_ledger_sequence',autoRevoke:p.autoRevoke};
}
function checkContractPayload(p,amount) {
  // Advisory authorization mirror MUST be re-derived from transaction XDR in
  // the actual facilitator; this function NEVER marks it as authenticated.
  nonblank(p.transaction,'payload.transaction');
  if(!plain(p.authorization))throw new TypeError('ADVISORY_AUTHORIZATION_REQUIRED');
  const a=p.authorization;
  for(const f of ['from','to','asset','nonce','facilitator']) nonblank(a[f],'payload.authorization.'+f);
  if(a.to!==amount.payTo || a.asset!==amount.asset) throw new TypeError('ADVISORY_AUTHORIZATION_TERMS_DRIFT');
  if(atomicAmount(a.maxAmount)!==atomicAmount(amount.amount))throw new TypeError('ADVISORY_MAX_DRIFT');
  integer(a.validAfterLedger,'validAfterLedger');integer(a.deadlineLedger,'deadlineLedger',{min:1});
  if(a.deadlineLedger<=a.validAfterLedger)throw new TypeError('INVALID_LEDGER_WINDOW');
  return {credentialMode:'TRANSACTION_XDR_UNVERIFIED',window:'ledger_sequence',autoRevoke:null,facilitator:a.facilitator};
}
/**
 * Structural *handoff* preflight, not payment verification.
 * Only trusted code may populate registry from authenticated actual deployments;
 * the buyer's own extra fields NEVER bootstrap trust.
 */
export function inspectUptoPhase({paymentRequired,paymentPayload,verifyRequirements,settleRequirements,
  registry,supportedProfiles=['stateless'],allowSingleStatelessLegacy=false}) {
  if(paymentRequired?.x402Version!==2 || paymentPayload?.x402Version!==2 ||
      !Array.isArray(paymentRequired.accepts) || !plain(paymentPayload.accepted))
    throw new TypeError('X402_V2_ENVELOPE_REQUIRED');
  const accepted=paymentPayload.accepted;
  const {profile,source}=resolveUptoProfile(accepted.extra,{supportedProfiles,allowSingleStatelessLegacy});
  if(accepted.extra.uptoProfile !== verifyRequirements?.extra?.uptoProfile ||
     accepted.extra.uptoProfile !== settleRequirements?.extra?.uptoProfile)
    throw new TypeError('PROFILE_CHANGED_BETWEEN_PHASES');
  const permittedAmount=terms(accepted,'accepted');
  const offered=paymentRequired.accepts.find(row=>{
    try {return row?.extra?.uptoProfile===accepted.extra?.uptoProfile &&
      row.network===accepted.network && row.scheme==='upto' && row.asset===accepted.asset &&
      row.payTo===accepted.payTo && row.amount===accepted.amount &&
      row.extra?.settlementContract===accepted.extra?.settlementContract;}catch{return false;}
  });
  if(!offered)throw new TypeError('ACCEPTED_NOT_IN_ORIGINAL_OFFER');
  terms(offered,'offer');
  const verify=terms(verifyRequirements,'verify');
  const actual=terms(settleRequirements,'settle');
  const pinned=trustedRecord(registry,accepted.network,profile);
  for(const t of [offered,verifyRequirements,settleRequirements]) {
    equivalent(t,accepted);
    contractMatches(t,pinned);
    if(t.extra.uptoProfile!==accepted.extra.uptoProfile)throw new TypeError('PROFILE_CHANGED_BETWEEN_PHASES');
  }
  contractMatches(accepted,pinned);
  if(verify!==permittedAmount)throw new TypeError('VERIFY_MUST_USE_SIGNED_MAX');
  if(actual>permittedAmount)throw new RangeError('ACTUAL_OVER_SIGNED_CEILING');
  const p=paymentPayload.payload;
  if(!plain(p))throw new TypeError('MISSING_SCHEME_PAYLOAD');
  const structural=profile==='stateless'?checkStatelessPayload(p,accepted):checkContractPayload(p,accepted);
  if(profile==='contract' && pinned.facilitator !== structural.facilitator)
    throw new TypeError('ADVISORY_FACILITATOR_NOT_TRUSTED');
  return {
    phase:'PREFLIGHT_ONLY',profile,source,network:accepted.network,
    maximum:permittedAmount.toString(),actual:actual.toString(),
    chargeIsZero:actual===0n,feeSponsored:true,
    contractSelection:'TRUSTED_REGISTRY_MATCH',
    ...structural,
    signatureVerified:false,authorizationEntryParsed:false,sorobanSimulationRan:false,
    paymentSettled:false,transactionHash:null,
    next:'HAND_TO_REAL_FACILITATOR_FOR_XDR_PARSE_ENFORCING_SIM_AND_LEDGER_PROOF'
  };
}
