// MIT. Optional seller-declared Bazaar pricing hints for a read-only catalog.
// Never use these declarations as payment authorization or proof of actual settlement.
const MODELS = new Set(['per-call','per-token','per-second','per-byte','tiered','custom']);
const I128_MAX = (1n << 127n) - 1n;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const ascii = (value, max) => typeof value === 'string' && value.length > 0 &&
  value.length <= max && /^[\x20-\x7e]+$/.test(value);

function atomic(value) {
  if (typeof value !== 'string' || !/^[0-9]{1,39}$/.test(value)) return null;
  const parsed = BigInt(value);
  return parsed <= I128_MAX ? parsed : null;
}

/** Upstream x402 extension pricing is a proposed, not yet finalized, field. */
export function sanitizeBazaarPricing(value) {
  if (!object(value) || !MODELS.has(value.model)) return null;
  const result = { model: value.model };
  const unit = value.unit;
  if (object(unit) && typeof unit.amount === 'string' &&
      /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(unit.amount) &&
      unit.amount.length <= 40 && ascii(unit.per, 64)) {
    result.unit = { amount: unit.amount, per: unit.per };
  }
  if (atomic(value.typical) !== null) result.typical = value.typical;
  if (ascii(value.note, 256)) result.note = value.note;
  return result;
}

/** Parse a buyer's single-asset atomic-unit comparison, never a floating price. */
export function parseAtomicBudget(value) {
  const result = atomic(value);
  if (result === null) throw new RangeError('budgetAtomic must be an unsigned Stellar i128 atomic amount');
  return result;
}

/**
 * Describe ONE intact accepted payment option; never combine asset/network/payTo
 * or infer that a metered ceiling is the eventual debit.
 * `typical` is seller-declared, never a proven median or a spending authority.
 */
export function describePricingOption(option, pricing = null, budgetAtomic = null,
  { typicalUnambiguous = true } = {}) {
  const scheme = option?.scheme;
  const limit = atomic(option?.amount);
  const isFixed = scheme === 'exact';
  const isMetered = scheme === 'upto';
  const sellerTypical = typicalUnambiguous && isMetered && limit !== null &&
    atomic(pricing?.typical) !== null && atomic(pricing.typical) <= limit
    ? pricing.typical : null;
  const result = {
    network: option?.network ?? null,
    asset: option?.asset ?? null,
    payTo: option?.payTo ?? null,
    scheme: scheme ?? null,
    amountAtomic: typeof option?.amount === 'string' ? option.amount : null,
    amountMeaning: isFixed ? 'ADVERTISED_FIXED_PRICE' :
      isMetered ? 'MAXIMUM_AUTHORIZATION_NOT_SETTLED_PRICE' : 'UNKNOWN_SCHEME',
    pricingModel: pricing?.model ?? null,
    sellerClaimedTypicalAtomic: sellerTypical,
    observedSettledAmountAtomic: null,
    requiresFresh402AndBuyerApproval: true
  };
  if (budgetAtomic === null) return result;
  const budget = typeof budgetAtomic === 'bigint' ? budgetAtomic : parseAtomicBudget(budgetAtomic);
  if (limit === null || (!isFixed && !isMetered)) result.budgetAssessment = 'NOT_COMPARABLE';
  else if (isFixed) result.budgetAssessment = limit <= budget ?
    'ADVERTISED_PRICE_WITHIN_BUDGET' : 'ADVERTISED_PRICE_ABOVE_BUDGET';
  else if (limit <= budget) result.budgetAssessment = 'AUTHORIZATION_CEILING_WITHIN_BUDGET';
  else if (sellerTypical === null) result.budgetAssessment = 'CEILING_ABOVE_BUDGET_COST_UNKNOWN';
  else result.budgetAssessment = atomic(sellerTypical) <= budget ?
    'CEILING_ABOVE_BUDGET_SELLER_TYPICAL_WITHIN' :
    'CEILING_ABOVE_BUDGET_SELLER_TYPICAL_ABOVE';
  return result;
}

/** Nonmutating view over only the caller's same-option filtered accepts. */
export function describeCatalogPricing(entry, filters = {}, budgetAtomic = null) {
  const paymentKeys = ['network','asset','scheme','payTo'].filter(k =>
    Object.hasOwn(filters, k));
  const offers = (entry?.accepts ?? []).filter(option =>
    paymentKeys.every(key => option?.[key] === filters[key]));
  const distinctDenominations = new Set(offers.map(o => `${o?.network}\u0000${o?.asset}`));
  const pricing = sanitizeBazaarPricing(entry?.extensions?.bazaar?.pricing);
  return offers.map(option => describePricingOption(option, pricing, budgetAtomic, {
    typicalUnambiguous: distinctDenominations.size === 1
  }));
}
