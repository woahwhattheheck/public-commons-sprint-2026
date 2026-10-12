// MIT. Explicit saved USD quotes into the original atomic repricing workflow.
import { merchantRoutes, merchantTerms } from '../analyze.mjs';

export const QUOTE_PRICE_SCHEMA = 'stellar-forge.merchant-quote-prices.v1';
const MICRO = 1_000_000n;
const DISPLAY = 1_000_000_000_000n;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = (code,message,status=422) => Object.assign(new TypeError(message),{code,status});
const fields = ['routeId','paymentIndex','expectedAmount','atomicUnits','usd','basis'];

function atomic(value,label) {
  if (typeof value !== 'string' || !/^[1-9][0-9]{0,38}$/.test(value))
    throw fail('QUOTE_ATOMIC_UNITS_REQUIRED',label+' must be a positive integer string of at most 39 digits.');
  return BigInt(value);
}
function microUsd(value,label) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]*)(\.[0-9]{1,6})?$/.test(value))
    throw fail('QUOTE_USD_REQUIRED',label+' must be a USD decimal string with at most six places.');
  const [whole,fraction=''] = value.split('.');
  return BigInt(whole)*MICRO+BigInt(fraction.padEnd(6,'0'));
}
function decimal(value,places) {
  const scale=10n**BigInt(places), fraction=String(value%scale).padStart(places,'0').replace(/0+$/,'');
  return String(value/scale)+(fraction?'.'+fraction:'');
}
const ceil = (numerator,denominator) => (numerator+denominator-1n)/denominator;
function gcd(left,right) {
  while (right) [left,right]=[right,left%right];
  return left;
}
// USD values retain their exact fraction. Display bounds are twelve-place
// decimal strings; neither bound replaces the fraction in saved decisions.
function usdFraction(numerator,denominator) {
  const factor=gcd(numerator,denominator), scaled=numerator*DISPLAY;
  return {numerator:String(numerator/factor),denominator:String(denominator/factor),
    floorUsd:decimal(scaled/denominator,12),ceilingUsd:decimal(ceil(scaled,denominator),12)};
}

/**
 * commercial is the original saved review's complete commercial input object.
 * Each selected option receives its own explicit operator valuation:
 * atomicUnits of that option's asset are valued at usd, with a recorded basis.
 * The native repricing compiler remains responsible for offer validation and
 * its authoritative amount bounds before these edits can be previewed or saved.
 */
export function createQuotePriceEdits({seller,commercial,quoteValuations}={}) {
  const routes=merchantRoutes(seller), terms=merchantTerms(seller,commercial);
  const optionCount=routes.reduce((sum,route)=>sum+route.paymentOptions.length,0);
  if (!Array.isArray(quoteValuations) || !quoteValuations.length || quoteValuations.length>optionCount)
    throw fail('QUOTE_VALUATIONS_REQUIRED','Select one or more original payment options and enter their explicit valuations.');
  const byRoute=new Map(routes.map(route=>[route.routeId,route])), selected=new Map();
  for (const input of quoteValuations) {
    if (!plain(input) || Object.keys(input).some(key=>!fields.includes(key)) ||
        typeof input.routeId !== 'string' || !byRoute.has(input.routeId) ||
        !Number.isSafeInteger(input.paymentIndex) || input.paymentIndex<0)
      throw fail('QUOTE_PAYMENT_OPTION_REQUIRED','Each valuation must identify one original route and ordered payment option.');
    const route=byRoute.get(input.routeId), option=route.paymentOptions[input.paymentIndex];
    if (!option) throw fail('QUOTE_PAYMENT_OPTION_CHANGED','The selected payment option is unavailable.',409);
    atomic(input.expectedAmount,'Expected current amount');
    if (input.expectedAmount !== option.atomicAmount)
      throw fail('QUOTE_PAYMENT_AMOUNT_CHANGED','The saved atomic amount differs for '+input.routeId+', choice '+(input.paymentIndex+1)+'.',409);
    const units=atomic(input.atomicUnits,'Valued atomic units');
    if (typeof input.usd !== 'string' || input.usd.length>64)
      throw fail('QUOTE_VALUATION_REQUIRED','Enter the USD value of those atomic units as a decimal string of at most 64 characters.');
    const value=microUsd(input.usd,'Valuation USD');
    if (value===0n) throw fail('QUOTE_VALUATION_REQUIRED','The entered valuation must be greater than zero.');
    if (typeof input.basis !== 'string' || input.basis.trim().length<4 || input.basis.trim().length>300)
      throw fail('QUOTE_VALUATION_BASIS_REQUIRED','Record the valuation source or assumption in 4-300 characters.');
    const key=JSON.stringify([input.routeId,input.paymentIndex]);
    if (selected.has(key)) throw fail('QUOTE_VALUATION_DUPLICATE','A payment option can have only one valuation in a price decision.');
    selected.set(key,{input:{routeId:input.routeId,paymentIndex:input.paymentIndex,
      expectedAmount:input.expectedAmount,atomicUnits:String(units),usd:decimal(value,6),basis:input.basis.trim()},units,value});
  }
  const valuations=[],rows=[],edits=[];
  for (const route of routes) for (let paymentIndex=0;paymentIndex<route.paymentOptions.length;paymentIndex++) {
    const selection=selected.get(JSON.stringify([route.routeId,paymentIndex]));
    if (!selection) continue;
    const {input,units,value}=selection, option=route.paymentOptions[paymentIndex], term=terms.routes[route.routeId];
    const quote=microUsd(term.unitPriceUsd,'Saved service quote');
    if (quote===0n)
      throw fail('QUOTE_PAID_PRICE_REQUIRED','A paid atomic price requires a positive saved USD quote for '+route.routeId+'.');
    const requested=quote*units, proposed=ceil(requested,value);
    const amount=String(proposed);
    if (amount.length>39)
      throw fail('QUOTE_AMOUNT_OUT_OF_RANGE','The calculated price for '+route.routeId+' exceeds the original atomic amount range.');
    const denominator=units*MICRO;
    valuations.push(input);
    edits.push({routeId:route.routeId,paymentIndex,expectedAmount:option.atomicAmount,amount});
    rows.push({routeId:route.routeId,method:route.method,path:route.path,paymentIndex,
      network:option.network,asset:option.asset,payTo:option.payTo,
      expectedAmount:option.atomicAmount,amount,changed:amount!==option.atomicAmount,
      quoteUsd:decimal(quote,6),quoteBasis:term.priceBasis,
      valuation:{atomicUnits:input.atomicUnits,usd:input.usd,basis:input.basis},
      valuedAmountUsd:usdFraction(proposed*value,denominator),
      roundingExcessUsd:usdFraction(proposed*value-requested,denominator),
      atomicUnitUsd:usdFraction(value,denominator)});
  }
  return {schema:QUOTE_PRICE_SCHEMA,rounding:'UP_TO_ATOMIC_UNIT',quoteValuations:valuations,rows,edits};
}
