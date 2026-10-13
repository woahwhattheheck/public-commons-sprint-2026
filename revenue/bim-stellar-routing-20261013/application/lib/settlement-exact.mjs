/** Exact monetary and execution-quality arithmetic for the BIM source consumer. */
const MAX_INTEGER_DIGITS = 160;
const MAX_SCALE = 38;
function fail(code, message) { const error = new Error(message); error.code = code; throw error; }
function text(value, label, maximum = 500) {
  if (typeof value !== 'string' || !value.length || value.length > maximum || /[\u0000-\u001f]/u.test(value)) fail('INVALID_IDENTITY', label + ' must be a nonempty bounded string.');
  return value;
}
export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') { if (!Number.isSafeInteger(value)) fail('INVALID_NUMBER', 'Retain monetary/precision-sensitive values as strings.'); return String(value); }
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  if (typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}';
  fail('INVALID_JSON', 'A source projection must contain complete JSON values.');
}
export function exactInteger(value, label = 'Amount', signed = true) {
  if (typeof value !== 'string' || value.length > MAX_INTEGER_DIGITS + 1 || !(signed ? /^-?(?:0|[1-9][0-9]*)$/u : /^(?:0|[1-9][0-9]*)$/u).test(value) || value === '-0') fail('INVALID_AMOUNT', label + ' must be a canonical integer string.');
  return BigInt(value);
}
export function assetIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_ASSET', 'An exact asset identity is required.');
  const chain = text(value.chain, 'Asset chain', 100), network = text(value.network, 'Asset network', 500);
  if (!['NATIVE', 'ISSUED', 'TOKEN'].includes(value.kind)) fail('INVALID_ASSET', 'Select the original native, issued or token identity.');
  if (!Number.isSafeInteger(value.decimals) || value.decimals < 0 || value.decimals > MAX_SCALE) fail('INVALID_ASSET', 'Original asset decimals must be between 0 and 38.');
  const asset = {chain, network, kind:value.kind, decimals:value.decimals};
  if (value.kind === 'ISSUED') { asset.code = text(value.code, 'Issued asset code', 100); asset.issuer = text(value.issuer, 'Asset issuer', 500); }
  if (value.kind === 'TOKEN') asset.address = text(value.address, 'Token address', 500);
  if (value.kind === 'NATIVE') asset.nativeId = text(value.nativeId, 'Native asset identifier', 100);
  return asset;
}
export function assetKey(value) { return canonicalJson(assetIdentity(value)); }
export function decimalToAtomic(value, decimals, label = 'Amount') {
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > MAX_SCALE) fail('INVALID_PRECISION', 'Original asset decimals are required.');
  if (typeof value !== 'string' || value.length > MAX_INTEGER_DIGITS + MAX_SCALE + 2 || !/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value)) fail('INVALID_AMOUNT', label + ' must be the exact original decimal string.');
  const negative = value.startsWith('-'), unsigned = negative ? value.slice(1) : value, parts = unsigned.split('.');
  if (parts[0].length > MAX_INTEGER_DIGITS || (parts[1] || '').length > decimals) fail('EXCESS_PRECISION', label + ' exceeds the selected exact asset precision.');
  const atomic = BigInt(parts[0] + (parts[1] || '').padEnd(decimals, '0'));
  return (negative && atomic !== 0n ? -atomic : atomic).toString();
}
export function atomicToDecimal(value, decimals) {
  const number = exactInteger(value);
  if (!Number.isSafeInteger(decimals) || decimals < 0 || decimals > MAX_SCALE) fail('INVALID_PRECISION', 'Original asset decimals are required.');
  const negative = number < 0n, absolute = (negative ? -number : number).toString();
  if (!decimals) return (negative ? '-' : '') + absolute;
  const padded = absolute.padStart(decimals + 1, '0');
  return (negative ? '-' : '') + padded.slice(0, -decimals) + '.' + padded.slice(-decimals);
}
export function amount(value, {nonnegative = false} = {}) {
  if (!value || typeof value !== 'object') fail('INVALID_AMOUNT', 'An amount with original asset identity is required.');
  const asset = assetIdentity(value.asset), atomic = exactInteger(value.atomic, 'Atomic amount', !nonnegative);
  return {asset, atomic:atomic.toString()};
}
export function signedDifference(before, after) {
  const a = amount(before), b = amount(after);
  if (assetKey(a.asset) !== assetKey(b.asset)) fail('ASSET_MISMATCH', 'Different networks, identities or decimals cannot be compared.');
  return {asset:a.asset, atomic:(BigInt(b.atomic) - BigInt(a.atomic)).toString()};
}
export function rationalBasisPoints(numerator, denominator, places = 4) {
  const n = exactInteger(numerator), d = exactInteger(denominator, 'Ratio denominator', false);
  if (d === 0n) return {numerator:n.toString(), denominator:'0', basisPoints:null, rounding:'UNDEFINED_ZERO_BASIS'};
  if (!Number.isSafeInteger(places) || places < 0 || places > 12) fail('INVALID_PRECISION', 'Basis point display precision is invalid.');
  const scaled = n * 10000n * (10n ** BigInt(places));
  const negative = scaled < 0n, absolute = negative ? -scaled : scaled;
  let quotient = absolute / d;
  if ((absolute % d) * 2n >= d) quotient += 1n;
  const rounded = (negative ? -quotient : quotient).toString();
  return {numerator:n.toString(), denominator:d.toString(), basisPoints:atomicToDecimal(rounded, places), rounding:'HALF_AWAY_FROM_ZERO'};
}
export function aggregateAmounts(rows, choose = row => row) {
  const groups = new Map();
  for (const row of rows) {
    const value = amount(choose(row)), key = assetKey(value.asset), prior = groups.get(key);
    if (prior) { prior.atomic += BigInt(value.atomic); prior.count++; }
    else groups.set(key, {asset:value.asset, atomic:BigInt(value.atomic), count:1});
  }
  return [...groups.values()].sort((a,b) => assetKey(a.asset).localeCompare(assetKey(b.asset))).map(row => ({...row, atomic:row.atomic.toString(), decimal:atomicToDecimal(row.atomic.toString(),row.asset.decimals)}));
}
export function executionQuality(quote, execution) {
  const reasons = [];
  const notComparable = () => ({status:'NOT_COMPARABLE', reasons, quoteId:quote?.id || null, executionId:execution?.id || null});
  if (!quote || !execution) { reasons.push('ORIGINAL_SELECTED_QUOTE_OR_EXECUTION_MISSING'); return notComparable(); }
  if (execution.state !== 'CONFIRMED_SUCCESS') { reasons.push('EXECUTION_NOT_CONFIRMED_SUCCESS'); return notComparable(); }
  if (quote.id !== execution.selectedQuoteId) { reasons.push('ORIGINAL_QUOTE_BINDING_MISMATCH'); return notComparable(); }
  if (!['EXACT_INPUT','EXACT_OUTPUT'].includes(quote.mode)) { reasons.push('UNSUPPORTED_ORIGINAL_QUOTE_MODE'); return notComparable(); }
  if (!quote.input || !quote.output || !execution.input || !execution.output) { reasons.push('COMPLETE_ORIGINAL_AMOUNTS_MISSING'); return notComparable(); }
  const qi=amount(quote.input,{nonnegative:true}), qo=amount(quote.output,{nonnegative:true}), ei=amount(execution.input,{nonnegative:true}), eo=amount(execution.output,{nonnegative:true});
  if (assetKey(qi.asset)!==assetKey(ei.asset) || assetKey(qo.asset)!==assetKey(eo.asset)) { reasons.push('ORIGINAL_ASSET_OR_PRECISION_MISMATCH'); return notComparable(); }
  if (quote.mode==='EXACT_INPUT' && qi.atomic!==ei.atomic) { reasons.push('EXECUTED_INPUT_DIFFERS_FROM_QUOTED_INPUT'); return notComparable(); }
  if (quote.mode==='EXACT_OUTPUT' && qo.atomic!==eo.atomic) { reasons.push('EXECUTED_OUTPUT_DIFFERS_FROM_EXACT_QUOTED_OUTPUT'); return notComparable(); }
  const expected=quote.mode==='EXACT_INPUT'?qo:qi, actual=quote.mode==='EXACT_INPUT'?eo:ei;
  const delta=BigInt(actual.atomic)-BigInt(expected.atomic), favorable=quote.mode==='EXACT_INPUT'?delta:-delta;
  let limit=null;
  if(quote.mode==='EXACT_INPUT' && quote.minimumOutput) {
    const minimum=amount(quote.minimumOutput,{nonnegative:true});
    if(assetKey(minimum.asset)!==assetKey(eo.asset)) { reasons.push('MINIMUM_OUTPUT_ASSET_MISMATCH'); return notComparable(); }
    limit={kind:'MINIMUM_OUTPUT',amount:minimum,met:BigInt(eo.atomic)>=BigInt(minimum.atomic)};
  }
  if(quote.mode==='EXACT_OUTPUT' && quote.maximumInput) {
    const maximum=amount(quote.maximumInput,{nonnegative:true});
    if(assetKey(maximum.asset)!==assetKey(ei.asset)) { reasons.push('MAXIMUM_INPUT_ASSET_MISMATCH'); return notComparable(); }
    limit={kind:'MAXIMUM_INPUT',amount:maximum,met:BigInt(ei.atomic)<=BigInt(maximum.atomic)};
  }
  return {status:'COMPARABLE',reasons:[],quoteId:quote.id,executionId:execution.id,mode:quote.mode,asset:expected.asset,expectedAtomic:expected.atomic,expectedDecimal:atomicToDecimal(expected.atomic,expected.asset.decimals),actualAtomic:actual.atomic,actualDecimal:atomicToDecimal(actual.atomic,actual.asset.decimals),actualMinusExpectedAtomic:delta.toString(),favorableAtomic:favorable.toString(),favorableDecimal:atomicToDecimal(favorable.toString(),expected.asset.decimals),quality:rationalBasisPoints(favorable.toString(),expected.atomic),limit};
}
export function reconciliation({opening, closing, movements, coverage}) {
  const originalOpening=opening?amount(opening):null, originalClosing=closing?amount(closing):null;
  const groups=aggregateAmounts(movements || []);
  const reasons=[];
  if (!originalOpening) reasons.push('OPENING_BALANCE_MISSING');
  if (!originalClosing) reasons.push('CLOSING_BALANCE_MISSING');
  if (!coverage || coverage.status!=='COMPLETE_FOR_DECLARED_RANGE') reasons.push('MOVEMENT_RANGE_INCOMPLETE');
  if (originalOpening && originalClosing && assetKey(originalOpening.asset)!==assetKey(originalClosing.asset)) reasons.push('BALANCE_ASSET_MISMATCH');
  if (originalOpening && groups.some(row=>assetKey(row.asset)!==assetKey(originalOpening.asset))) reasons.push('MOVEMENT_ASSET_MISMATCH');
  if (reasons.length) return {status:'UNRECONCILED',reasons,opening:originalOpening,closing:originalClosing,knownMovementTotals:groups,derivedClosing:null,difference:null};
  const movement=groups.reduce((sum,row)=>sum+BigInt(row.atomic),0n);
  const derived=BigInt(originalOpening.atomic)+movement, difference=BigInt(originalClosing.atomic)-derived;
  return {status:difference===0n?'RECONCILED':'DIFFERENCE',reasons:[],opening:originalOpening,closing:originalClosing,knownMovementTotals:groups,derivedClosing:{asset:originalOpening.asset,atomic:derived.toString()},difference:{asset:originalOpening.asset,atomic:difference.toString()}};
}
