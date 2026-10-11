/**
 * SF97 Merchant Revenue Operations: joins the ORIGINAL SF30 seller config and
 * ORIGINAL SF30 operations export to merchant-entered commercial terms.
 * No payment collection, verification, signing, remote polling or CI.
 * Node 22+, standard library only, MIT.
 */
import { readFile, mkdir, open } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { normalizeSellerPaymentOptions } from '../sf30-seller-sdk/seller.mjs';
import { supportsSellerMethod } from '../sf30-seller-sdk/http-methods.mjs';
import { normalizeTrafficHistoryReport } from '../sf30-seller-sdk/operations/history.mjs';
import { run as runNativeReconciliation } from './native-reconcile.mjs';

const SCHEMA = 'stellar-forge.merchant-revenue-ops.v1';
const USDMICRO = 1_000_000n;
const MAX_INPUT = 2 * 1024 * 1024;
const MAX_HISTORY_INPUT = 64 * 1024 * 1024;
const HISTORY = 'stellar-forge.seller-usage-history.v1';
const USAGE = 'Usage: --config seller-service.json --terms owner-terms.json (--snapshot traffic.json | --history usage.json | --ops-url http://127.0.0.1:8424) --output NEW_DIRECTORY [--native-outbox ORIGINAL_OUTBOX_DIRECTORY]';
const keys = new Set(['--config','--terms','--snapshot','--history','--ops-url','--output','--native-outbox']);
const own = (obj,key) => Object.hasOwn(obj,key);
const digest = data => createHash('sha256').update(data).digest('hex');

function object(x, name) {
  if (!x || typeof x !== 'object' || Array.isArray(x)) throw new TypeError(`${name} must be an object`);
  return x;
}
function exactUsd(value, name, optional = false) {
  if (value === null && optional) return null;
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value))
    throw new TypeError(`${name} must be a USD decimal string with <=6 places${optional ? ' or null' : ''}`);
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * USDMICRO + BigInt((fraction + '000000').slice(0, 6));
}
function usd(n) {
  if (n === null) return null;
  const minus = n < 0n, x = minus ? -n : n;
  const f = String(x % USDMICRO).padStart(6,'0').replace(/0+$/,'');
  return `${minus?'-':''}${x / USDMICRO}${f ? '.'+f : ''}`;
}
function count(x,name) {
  if (!Number.isSafeInteger(x) || x < 0) throw new TypeError(`${name} must be nonnegative safe integer`);
  return BigInt(x);
}
function percentage(a, b) { return b === 0n ? null : `${(a * 10000n / b / 100n)}.${String((a * 10000n / b) % 100n).padStart(2,'0')}`; }
function finiteNonnegative(x, name) {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < 0) throw new TypeError(`${name} must be finite >=0`);
}
function methodFor(route) {
  const method = route.definition?.method || route.offer?.extensions?.bazaar?.info?.input?.method || route.offer?.method || 'GET';
  return String(method).toUpperCase();
}
function priceMetadata(route) {
  if (own(route,'definition') === own(route,'offer'))
    throw new TypeError(`route ${route.id} needs exactly one definition or imported offer`);
  const input = own(route,'definition') ? object(route.definition, `route ${route.id}.definition`)
    : {paymentOptions: object(route.offer, `route ${route.id}.offer`).accepts};
  return normalizeSellerPaymentOptions(input).map(p=>({
    scheme:p.scheme,network:p.network,asset:p.asset,atomicAmount:p.amount,payTo:p.payTo,
    maxTimeoutSeconds:p.maxTimeoutSeconds,...(own(p,'extra')?{extra:p.extra}:{})
  }));
}
function legacyPayment(option) {
  const {scheme,network,asset,atomicAmount,payTo}=option;
  return {scheme,network,asset,atomicAmount,payTo};
}
function validRoute(route, name) {
  object(route,name);
  if (typeof route.id !== 'string' || !/^[A-Za-z0-9_-]{1,80}$/.test(route.id) ||
      typeof route.path !== 'string' || !route.path.startsWith('/')) throw new TypeError(`${name}: invalid route identity`);
  return route;
}
function validateSnapshot(snapshot, seller) {
  object(snapshot, 'snapshot');
  if (snapshot.schema !== 'stellar-forge.seller-traffic.v1' || !Array.isArray(snapshot.routes))
    throw new TypeError('Expected unmodified SF30 seller-traffic.v1 export');
  if (typeof snapshot.sessionId !== 'string' || !Number.isFinite(Date.parse(snapshot.startedAt)) ||
      !Number.isFinite(Date.parse(snapshot.capturedAt)) || snapshot.capturedAt < snapshot.startedAt)
    throw new TypeError('Snapshot needs valid session and times');
  if (!['CHALLENGE_ONLY','NATIVE_X402','UNKNOWN'].includes(snapshot.mode)) throw new TypeError('Invalid native seller mode');
  count(snapshot.observerErrors, 'snapshot.observerErrors');
  const seen = new Set();
  for (const raw of snapshot.routes) {
    const r = object(raw,'snapshot route');
    if (!['@unmatched','@method','@invalid'].includes(r.id)) validRoute(r,'snapshot route');
    else if (typeof r.path !== 'string' || r.method !== '-') throw new TypeError('Invalid native aggregate bucket');
    if (seen.has(r.id)) throw new TypeError(`Duplicate snapshot route ${r.id}`);
    seen.add(r.id);
    for (const field of ['started','completed','inFlight','success','challenge','clientError','serverError','other','disconnected','responses']) count(r[field],`${r.id}.${field}`);
    if (r.completed !== r.success+r.challenge+r.clientError+r.serverError+r.other+r.disconnected ||
        r.started !== r.completed+r.inFlight || r.responses !== r.completed-r.disconnected)
      throw new TypeError(`Invalid original traffic counter conservation on route ${r.id}`);
    if (r.latencyP95UpperBoundMs !== null && r.latencyP95UpperBoundMs !== '>15000') finiteNonnegative(r.latencyP95UpperBoundMs, `${r.id}.latencyP95UpperBoundMs`);
  }
  for (const r of seller.routes) {
    const observed = snapshot.routes.find(x=>x.id===r.id);
    if (!observed || observed.path !== r.path || observed.method !== methodFor(r))
      throw new TypeError(`Observed seller route ${r.id} missing or identity differs; use a same-configuration capture`);
  }
  for (const r of snapshot.routes) {
    if (!seller.routes.some(x=>x.id===r.id) && !['@unmatched','@method','@invalid'].includes(r.id))
      throw new TypeError(`Snapshot has unknown original route ${r.id}`);
  }
  return snapshot;
}
function sellerConfig(config) {
  object(config, 'seller config');
  if (config.schema !== 'stellar-forge.seller-service.v1' || !Array.isArray(config.routes) || !config.routes.length)
    throw new TypeError('Expected original seller-service.v1 config');
  const payments = new Map();
  for (const r of config.routes) {
    validRoute(r, 'seller route');
    if (payments.has(r.id)) throw new TypeError(`Duplicate seller route ${r.id}`);
    if (!supportsSellerMethod(methodFor(r))) throw new TypeError(`Unsupported seller method on ${r.id}`);
    payments.set(r.id,priceMetadata(r));
  }
  return payments;
}
function checkTerms(terms, seller, payments) {
  object(terms,'terms');
  if (terms.schema !== SCHEMA) throw new TypeError('Wrong merchant terms schema');
  if (typeof terms.merchantName !== 'string' || !terms.merchantName.trim() || terms.merchantName.length > 160)
    throw new TypeError('merchantName must be 1–160 chars');
  const fixed = exactUsd(terms.sharedMonthlyFixedUsd,'sharedMonthlyFixedUsd',true);
  const defined = object(terms.routes,'terms.routes');
  for (const sellerRoute of seller.routes) {
    const t = object(defined[sellerRoute.id], `terms.routes.${sellerRoute.id}`);
    exactUsd(t.unitPriceUsd, `${sellerRoute.id}.unitPriceUsd`);
    exactUsd(t.perFulfilledUsd, `${sellerRoute.id}.perFulfilledUsd`,true);
    exactUsd(t.perChallengeUsd, `${sellerRoute.id}.perChallengeUsd`,true);
    count(t.monthlyPaidTarget, `${sellerRoute.id}.monthlyPaidTarget`);
    const actual = payments.get(sellerRoute.id);
    if (own(t,'expectedPayment') === own(t,'expectedPayments'))
      throw new TypeError(`${sellerRoute.id} needs exactly one expectedPayment or expectedPayments`);
    if (own(t,'expectedPayments')) {
      if (!Array.isArray(t.expectedPayments) || !isDeepStrictEqual(t.expectedPayments,actual))
        throw new TypeError(`Payment terms drift on ${sellerRoute.id}: expectedPayments must match every complete option in seller order`);
    } else {
      if (actual.length!==1) throw new TypeError(`${sellerRoute.id} has multiple payment options; approve all with expectedPayments`);
      const expected = object(t.expectedPayment, `${sellerRoute.id}.expectedPayment`);
      for (const k of ['scheme','network','asset','atomicAmount','payTo']) {
        if (String(expected[k]) !== String(actual[0][k])) throw new TypeError(`Payment terms drift on ${sellerRoute.id}.${k}`);
      }
    }
    if (typeof t.priceBasis !== 'string' || t.priceBasis.length < 4 || t.priceBasis.length > 300)
      throw new TypeError(`${sellerRoute.id}.priceBasis is mandatory (quote or valuation context)`);
  }
  if (Object.keys(defined).length !== seller.routes.length) throw new TypeError('Each route must have exactly one owner commercial definition');
  return {fixed};
}

// The merchant workspace uses the same normalization and commercial validation
// as the CLI. Payment choices are always copied from the reviewed seller source.
export function merchantRoutes(seller) {
  const payments = sellerConfig(seller);
  return seller.routes.map(route => ({routeId:route.id, method:methodFor(route),
    path:route.path, paymentOptions:payments.get(route.id)}));
}

export function merchantTerms(seller, commercial) {
  object(commercial, 'commercial inputs');
  const inputs = object(commercial.routes, 'commercial routes');
  const payments = sellerConfig(seller);
  if (Object.keys(inputs).length !== seller.routes.length)
    throw new TypeError('Enter commercial inputs for every current seller route');
  const routes = Object.create(null);
  for (const route of seller.routes) {
    if (!own(inputs, route.id)) throw new TypeError(`Missing commercial inputs for ${route.id}`);
    const input = object(inputs[route.id], `commercial routes.${route.id}`);
    routes[route.id] = {expectedPayments:payments.get(route.id),
      priceBasis:input.priceBasis, unitPriceUsd:input.unitPriceUsd,
      perFulfilledUsd:input.perFulfilledUsd, perChallengeUsd:input.perChallengeUsd,
      monthlyPaidTarget:input.monthlyPaidTarget};
  }
  const terms = {schema:SCHEMA, merchantName:commercial.merchantName,
    sharedMonthlyFixedUsd:commercial.sharedMonthlyFixedUsd, routes};
  checkTerms(terms, seller, payments);
  return terms;
}

function observedAmounts(stats, quote, fulfill, challenge) {
  const started=count(stats.started,'started'), completed=count(stats.completed,'completed');
  const success=count(stats.success,'success'), challenges=count(stats.challenge,'challenge');
  const errors=count(stats.serverError,'serverError')+count(stats.disconnected,'disconnected');
  const modeledNominal=quote===null?null:quote*success;
  const costObserved=fulfill===null||challenge===null?null:fulfill*success+challenge*challenges;
  return {started,completed,success,challenges,errors,modeledNominal,costObserved,
    possibleContribution:modeledNominal===null||costObserved===null?null:modeledNominal-costObserved};
}
function noRetainedObservations() {
  return {started:0,completed:0,responses:0,success:0,challenge:0,clientError:0,
    serverError:0,other:0,disconnected:0,latencyP95UpperBoundMs:null};
}
function historyRouteBinding(row, seller) {
  if (row.id.startsWith('@')) return 'AGGREGATE_BUCKET';
  const current=seller.routes.find(route=>route.id===row.id);
  if (!current) return 'REMOVED_ROUTE';
  return current.path===row.path&&methodFor(current)===row.method?'CURRENT_ROUTE':'HISTORICAL_ROUTE_VARIANT';
}
function periodReview(history, seller, terms) {
  const describe=row=>({routeKey:row.routeKey,routeId:row.id,method:row.method,path:row.path,
    binding:historyRouteBinding(row,seller),actualAttempts:String(row.started),
    actualCompleted:String(row.completed),actual2xx:String(row.success),actual402:String(row.challenge),
    actual5xx:String(row.serverError),actualDisconnected:String(row.disconnected),
    latencyP95UpperBoundMs:row.latencyP95UpperBoundMs});
  const variants=history.routes.map(describe);
  const days=history.days.map(entry=>{
    let nominal=0n,cost=0n,unknown=false,unpriced2xx=0n;
    const routes=entry.routes.map(raw=>{
      const row=describe(raw),term=row.binding==='CURRENT_ROUTE'?terms.routes[raw.id]:null;
      const quote=term?exactUsd(term.unitPriceUsd,raw.id+'.unitPriceUsd'):null;
      const fulfill=term?exactUsd(term.perFulfilledUsd,raw.id+'.perFulfilledUsd',true):null;
      const challenge=term?exactUsd(term.perChallengeUsd,raw.id+'.perChallengeUsd',true):null;
      const amounts=observedAmounts(raw,quote,fulfill,challenge);
      if (term) {
        nominal+=amounts.modeledNominal;
        if (amounts.costObserved===null) unknown=true; else cost+=amounts.costObserved;
      } else unpriced2xx+=amounts.success;
      return {...row,quoteUsd:usd(quote),modeledNominal2xxValueUsd:usd(amounts.modeledNominal),
        modeledObservedVariableCostUsd:usd(amounts.costObserved),
        modeledObservedContributionUsd:usd(amounts.possibleContribution)};
    });
    return {day:entry.day,sessions:entry.sessions,actualAttempts:String(entry.totals.started),
      actualCompleted:String(entry.totals.completed),actual2xx:String(entry.totals.success),
      actual402:String(entry.totals.challenge),actual5xx:String(entry.totals.serverError),
      actualDisconnected:String(entry.totals.disconnected),
      latencyP95UpperBoundMs:entry.totals.latencyP95UpperBoundMs,
      currentRouteNominal2xxValueUsd:usd(nominal),
      currentRouteModeledVariableCostUsd:unknown?null:usd(cost),unpricedHttp2xx:String(unpriced2xx),routes};
  });
  return {quoteScope:'CURRENT_MERCHANT_TERMS_APPLIED_TO_MATCHING_RETAINED_ROUTE_VARIANTS',
    monthlyTargetsAppliedOnce:true,startsAndCompletionsHaveIndependentUtcDates:true,
    absentDaysHaveNoSavedObservations:true,variants,days};
}
function observationContext(snapshot,seller) {
  if (snapshot?.schema!==HISTORY) {
    validateSnapshot(snapshot,seller);
    return {history:null,routes:seller.routes,observedRoutes:snapshot.routes,mode:snapshot.mode,
      sessionId:snapshot.sessionId,from:snapshot.startedAt,until:snapshot.capturedAt,
      observerErrors:snapshot.observerErrors};
  }
  const history=normalizeTrafficHistoryReport(snapshot);
  const modes=history.modes,mode=modes.length>1?'MIXED':modes[0]??'UNKNOWN';
  const lower=Date.parse((history.range.effectiveFrom??history.range.from)+'T00:00:00.000Z');
  const upper=Date.parse((history.range.effectiveTo??history.range.to)+'T00:00:00.000Z')+86400000-1;
  const windows=history.sessions.map(session=>({from:Math.max(lower,Date.parse(session.startedAt)),
    until:Math.min(upper,Date.parse(session.capturedAt))})).filter(row=>row.from<=row.until);
  const from=new Date(windows.length?Math.min(...windows.map(row=>row.from)):lower).toISOString();
  const until=new Date(windows.length?Math.max(...windows.map(row=>row.until)):lower).toISOString();
  const observerErrors=history.sessions.reduce((sum,session)=>{
    const next=sum+session.observerErrors;count(next,'matching session observer errors');return next;
  },0);
  return {history,routes:seller.routes.filter(route=>history.range.routeId===null||route.id===history.range.routeId),
    observedRoutes:history.routes,mode,sessionId:null,from,until,observerErrors};
}

export function analyze(seller, snapshot, terms, provenance = {}) {
  const payments=sellerConfig(seller);
  const observation=observationContext(snapshot,seller),history=observation.history;
  const {fixed}=checkTerms(terms,seller,payments);
  const rows=[];
  let targetGross=0n, targetVariable=0n, nominalGross=0n;
  let targetComplete=true, nominalComplete=true;
  for (const route of observation.routes) {
    const retained=observation.observedRoutes.find(r=>r.id===route.id&&r.path===route.path&&r.method===methodFor(route));
    const stats=retained??noRetainedObservations(), term=terms.routes[route.id];
    const quote=exactUsd(term.unitPriceUsd,route.id+'.unitPriceUsd');
    const fulfill=exactUsd(term.perFulfilledUsd,route.id+'.perFulfilledUsd',true);
    const challenge=exactUsd(term.perChallengeUsd,route.id+'.perChallengeUsd',true);
    const target=count(term.monthlyPaidTarget,route.id+'.monthlyPaidTarget');
    const {started,completed,success,challenges,errors,modeledNominal,costObserved,possibleContribution}=
      observedAmounts(stats,quote,fulfill,challenge);
    const modeledTarget=quote*target;
    const variableTarget=fulfill===null ? null : fulfill*target;
    const contribution=variableTarget===null ? null : modeledTarget-variableTarget;
    targetGross+=modeledTarget;nominalGross+=modeledNominal;
    if (contribution===null) targetComplete=false; else targetVariable+=variableTarget;
    if (possibleContribution===null) nominalComplete=false;
    const flags=[];
    if (observation.mode==='CHALLENGE_ONLY' && success>0n) flags.push('Challenge-only observation has 2xx: review route/outcome scope');
    if (history&&!retained) flags.push('No saved observations for this current route variant in the selected retained period');
    if (errors>0n) flags.push(`${errors} observed 5xx/disconnect outcomes; investigate reliability before estimating retention`);
    if (challenges>0n && success===0n) flags.push('Payment challenges observed without any 2xx service completion');
    if (stats.latencyP95UpperBoundMs === '>15000') flags.push('P95 latency above 15 seconds histogram cap');
    const paymentOptions=payments.get(route.id);
    rows.push({routeId:route.id,method:methodFor(route),path:route.path,
      payment:paymentOptions.length===1?legacyPayment(paymentOptions[0]):null,paymentOptions,
      paymentBinding:own(term,'expectedPayments')?'EXACT_OPTIONS':'LEGACY_SINGLE_OPTION',
      commercialScope:'ALL_CONFIGURED_PAYMENT_OPTIONS',httpPaymentOptionAttribution:null,
      ...(history?{usageBinding:retained?'CURRENT_ROUTE':'NO_RETAINED_OBSERVATIONS',
        usageRouteKey:retained?.routeKey??null}:{}),
      quoteUsd:usd(quote),priceBasis:term.priceBasis,paidTargetMonth:String(target),
      variablePerFulfilledUsd:usd(fulfill),perChallengeUsd:usd(challenge),
      actualAttempts:String(started),actualCompleted:String(completed),actual2xx:String(success),actual402:String(challenges),
      actual5xx:String(stats.serverError),actualDisconnected:String(stats.disconnected),
      httpSuccessPct:percentage(success,completed), latencyP95UpperBoundMs:stats.latencyP95UpperBoundMs,
      modeledNominal2xxValueUsd:usd(modeledNominal),
      modeledObservedVariableCostUsd:usd(costObserved),modeledObservedContributionUsd:usd(possibleContribution),
      plannedMonthlyTargetGrossUsd:usd(modeledTarget),plannedMonthlyTargetVariableCostUsd:usd(variableTarget),
      plannedMonthlyTargetContributionBeforeFixedUsd:usd(contribution),flags});
  }
  const unknown = rows.filter(r=>r.plannedMonthlyTargetVariableCostUsd===null || r.modeledObservedVariableCostUsd===null).map(r=>r.routeId);
  const fullSellerScope=!history||history.range.routeId===null;
  const plannedAfterFixed=targetComplete && fixed!==null && fullSellerScope ? targetGross-targetVariable-fixed : null;
  const routeIssues=rows.flatMap(r=>r.flags.map(flag=>({routeId:r.routeId,flag})));
  if (observation.observerErrors>0) routeIssues.unshift({routeId:'*',flag:`${observation.observerErrors} native observer errors${history?' across the complete matching session checkpoints':''}; counts may be incomplete`});
  const mismatches=observation.observedRoutes.filter(r=>r.id.startsWith('@')).filter(r=>r.started>0).map(r=>({routeId:r.id,attempts:r.started}));
  if (mismatches.length) routeIssues.push({routeId:'*',flag:`${mismatches.map(x=>`${x.routeId}=${x.attempts}`).join(', ')} original unmatched/method/invalid attempts excluded from product forecast`});
  const period=history?periodReview(history,seller,terms):null;
  if (history) {
    const changed=period.variants.filter(row=>['REMOVED_ROUTE','HISTORICAL_ROUTE_VARIANT'].includes(row.binding));
    if (changed.length) routeIssues.push({routeId:'*',flag:`${changed.length} historical route variant(s) remain visible without applying current prices or targets to them`});
    const interrupted=history.sessions.filter(session=>session.state==='INTERRUPTED');
    if (interrupted.length) routeIssues.push({routeId:'*',flag:`${interrupted.length} interrupted session(s): observations after their last saved checkpoint are unavailable`});
    if (history.range.truncatedByRetention) routeIssues.push({routeId:'*',flag:'Selected period begins before retained history; the report uses only the actual retained days'});
    if (!history.coverageFormat&&history.sessions.length) routeIssues.push({routeId:'*',flag:'Legacy history export lacks session day/route membership; native matching uses retained days and saved session intervals, with ambiguous route variants left unassigned'});
    if (!history.storage.healthy) routeIssues.push({routeId:'*',flag:'Original history storage reports an incomplete or unhealthy checkpoint state; inspect retained session and storage details'});
    if (!history.days.length) routeIssues.push({routeId:'*',flag:'No saved observations in the selected retained period; no demand or native event coverage is inferred'});
  }
  return {
    schema:SCHEMA,merchantName:terms.merchantName,sessionId:observation.sessionId,
    originalSellerMode:observation.mode,observedFrom:observation.from,observedUntil:observation.until,
    ...(history?{observationKind:'DURABLE_HISTORY',sessionIds:history.sessions.map(session=>session.sessionId),
      usageHistory:history,periodReview:period,observerErrorScope:'COMPLETE_MATCHING_SESSION_CHECKPOINTS'}:{}),
    sourceSha256:provenance,generatedAt:new Date().toISOString(),observerErrors:observation.observerErrors,
    overview:{routeCount:rows.length,paymentOptionCount:rows.reduce((n,r)=>n+r.paymentOptions.length,0),
      plannedMonthlyTargetGrossUsd:usd(targetGross),
      plannedMonthlyTargetVariableCostsUsd:targetComplete?usd(targetVariable):null,
      sharedMonthlyFixedUsd:usd(fixed),plannedMonthlyTargetContributionAfterFixedUsd:usd(plannedAfterFixed),
      ...(history?{monthlyTargetScope:history.range.routeId===null?'CURRENT_SELLER':'SELECTED_CURRENT_ROUTE',
        sharedFixedCostApplied:fullSellerScope}:{}),
      modeledNominal2xxResponseValueUsd:usd(nominalGross),unknownCostRoutes:unknown,
      observedHttpCompletionIsPaymentEvidence:false},
    routes:rows,issues:routeIssues,
    accounting:'HTTP attempts/2xx/402 are NOT buyer counts, signed payment proofs or revenue. All quote USD, unit costs, and monthly target demand are merchant supplied. 2xx valuation is an IF-all-fulfilled-at-quoted-price counterfactual, never booked receipts. Actual realized payments require external independently checked settlement and customer records.'
  };
}
function escaped(x) {return String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function periodHtml(report) {
  const history=report.usageHistory,review=report.periodReview;
  if (!history||!review) return '';
  const daily=review.days.map(day=>'<tr><th scope="row">'+escaped(day.day)+'</th><td>'+day.sessions+
    '</td><td>'+escaped(day.actualAttempts)+'</td><td>'+escaped(day.actualCompleted)+
    '</td><td>'+escaped(day.actual402)+'</td><td>'+escaped(day.actual2xx)+
    '</td><td>'+escaped(day.actual5xx)+'</td><td>'+escaped(day.actualDisconnected)+
    '</td><td>'+escaped(day.latencyP95UpperBoundMs??'None')+'</td><td>'+escaped(day.currentRouteNominal2xxValueUsd)+
    '</td><td>'+escaped(day.currentRouteModeledVariableCostUsd??'Unknown')+'</td></tr>').join('');
  const variants=review.variants.map(row=>'<tr><th scope="row">'+escaped(row.routeId)+
    '<small>'+escaped(row.method)+' '+escaped(row.path)+'</small></th><td>'+escaped(row.binding)+
    '</td><td>'+escaped(row.actualAttempts)+'</td><td>'+escaped(row.actualCompleted)+
    '</td><td>'+escaped(row.actual402)+'</td><td>'+escaped(row.actual2xx)+
    '</td><td>'+escaped(row.actual5xx)+'</td><td>'+escaped(row.actualDisconnected)+'</td></tr>').join('');
  const sessions=history.sessions.map(session=>'<tr><th scope="row"><code>'+escaped(session.sessionId)+
    '</code><small>'+escaped(session.mode)+'</small></th><td>'+escaped(session.state)+
    '</td><td>'+escaped(session.startedAt)+'<small>through '+escaped(session.capturedAt)+
    '</small></td><td>'+escaped(session.savedAt)+'</td><td>'+session.matchingDays+
    '</td><td>'+session.outstandingAtCheckpoint+'</td><td>'+session.observerErrors+
    '</td><td>'+(session.retainedDays?'Session/day/route':'Legacy session/day')+'</td></tr>').join('');
  const detail=review.days.map(day=>'<details><summary>'+escaped(day.day)+' · '+day.routes.length+
    ' saved route variant(s)</summary><div class="scroll"><table><thead><tr><th>Route / variant</th><th>Scope</th><th>Starts</th><th>Completions</th><th>402</th><th>2xx</th><th>Nominal USD</th><th>Modeled cost USD</th></tr></thead><tbody>'+
    day.routes.map(row=>'<tr><th scope="row">'+escaped(row.routeId)+'<small>'+escaped(row.method)+' '+escaped(row.path)+
      '</small></th><td>'+escaped(row.binding)+'</td><td>'+escaped(row.actualAttempts)+
      '</td><td>'+escaped(row.actualCompleted)+'</td><td>'+escaped(row.actual402)+
      '</td><td>'+escaped(row.actual2xx)+'</td><td>'+escaped(row.modeledNominal2xxValueUsd??'Unpriced')+
      '</td><td>'+escaped(row.modeledObservedVariableCostUsd??'Unknown')+'</td></tr>').join('')+
    '</tbody></table></div></details>').join('');
  return '<section class="panel"><h2>Retained UTC period</h2><p>'+escaped(history.range.from)+' through '+
    escaped(history.range.to)+' · '+history.days.length+' observed day(s) · '+history.sessions.length+
    ' retained session(s)'+(history.range.routeId?' · Selected route '+escaped(history.range.routeId):'')+
    '.</p><p class="muted">Starts and finishes use their own original UTC event dates. A day may have more completions than starts. Days absent from the export have no saved observations; session gaps are not filled with zero traffic or assigned native events. Current merchant quotes apply only to the matching route variants, and monthly targets are counted once.</p>'+
    (report.overview.sharedFixedCostApplied===false?'<p class="muted">The route filter does not allocate the merchant-wide fixed cost. Contribution after fixed costs remains unknown for this selection.</p>':'')+
    '<div class="scroll"><table><thead><tr><th>UTC day</th><th>Sessions</th><th>Starts</th><th>Completions</th><th>402</th><th>2xx</th><th>5xx</th><th>D/C</th><th>P95 ms bound</th><th>Current-route nominal USD</th><th>Current-route modeled cost USD</th></tr></thead><tbody>'+
    (daily||'<tr><td colspan="11">No retained observations in this selection.</td></tr>')+
    '</tbody></table></div>'+detail+'</section><section class="panel"><h2>Retained route variants</h2><p class="muted">Changed methods or paths and removed routes remain separate. Their original counters are preserved without applying the current product quote.</p><div class="scroll"><table><thead><tr><th>Route / method / path</th><th>Current configuration match</th><th>Starts</th><th>Completions</th><th>402</th><th>2xx</th><th>5xx</th><th>D/C</th></tr></thead><tbody>'+
    (variants||'<tr><td colspan="8">No retained route variants.</td></tr>')+
    '</tbody></table></div></section><section class="panel"><h2>Saved sessions and checkpoint coverage</h2><p class="muted">Observer errors and outstanding requests describe each complete saved session checkpoint. They cannot be allocated to an individual selected day. An interrupted process may have completed later work that was not saved.</p><div class="scroll"><table><thead><tr><th>Original session / mode</th><th>State</th><th>Observed interval</th><th>Last save</th><th>Selected days</th><th>Outstanding</th><th>Observer errors</th><th>Coverage</th></tr></thead><tbody>'+
    (sessions||'<tr><td colspan="8">No retained sessions.</td></tr>')+'</tbody></table></div></section>';
}
export function html(report) {
  const rs=report.routes.map(r=>`<tr><th scope="row"><b>${escaped(r.routeId)}</b><small>${escaped(r.method)} ${escaped(r.path)} · ${r.paymentOptions.length} payment option(s)</small></th><td>${escaped(r.actualAttempts)}</td><td>${escaped(r.actual402)}</td><td>${escaped(r.actual2xx)}</td><td>${escaped(r.actual5xx)}</td><td>${escaped(r.actualDisconnected)}</td><td>${escaped(r.quoteUsd)}</td><td>${escaped(r.plannedMonthlyTargetGrossUsd)}</td><td>${escaped(r.plannedMonthlyTargetContributionBeforeFixedUsd??'Unknown')}</td></tr>`).join('');
  const optionRows=report.routes.flatMap(r=>r.paymentOptions.map((p,i)=>`<tr><th scope="row">${escaped(r.routeId)}<small>Option ${i+1} · ${escaped(r.paymentBinding)}</small></th><td>${escaped(p.network)}<small>${escaped(p.scheme)} · ${escaped(p.maxTimeoutSeconds)} seconds</small></td><td>${escaped(p.atomicAmount)}</td><td class="identity"><code>${escaped(digest(p.asset))}</code></td><td class="identity"><code>${escaped(digest(p.payTo))}</code></td><td>${own(p,'extra')?'Preserved in JSON':'None'}</td></tr>`)).join('');
  const issues=report.issues.length ? report.issues.map(i=>`<li><strong>${escaped(i.routeId)}</strong> ${escaped(i.flag)}</li>`).join('') : '<li>No counters requiring attention in this capture.</li>';
  const pre=report.overview;
  const observationLabel=report.usageHistory?
    'Retained period '+report.usageHistory.range.from+' through '+report.usageHistory.range.to+' · '+report.sessionIds.length+' sessions':
    'Session '+report.sessionId;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Merchant Revenue Operations | ${escaped(report.merchantName)}</title><style>
:root{font-family:ui-sans-serif,system-ui,-apple-system,'Segoe UI',sans-serif;color:#1c232a;background:#f2f4f5;font-size:15px}*{box-sizing:border-box}body{margin:0}main{max-width:1280px;margin:auto;padding:32px 24px 80px}header{border-bottom:2px solid #2b333b;padding-bottom:22px;display:flex;gap:12px;justify-content:space-between;align-items:end;flex-wrap:wrap}h1{font-size:1.8rem;letter-spacing:-.04em;margin:7px 0}h2{font-size:1.1rem;margin:0 0 15px}p,li{line-height:1.5}.eyebrow{font-size:.7rem;font-weight:750;letter-spacing:.14em;text-transform:uppercase;color:#48555e}.muted,small{color:#59666f}.sub{max-width:75ch;font-size:.9rem}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:24px 0}.card,.panel{background:white;border:1px solid #d2d8dd;padding:22px;border-radius:4px}.card strong{font-size:1.5rem;display:block;margin:10px 0 6px;word-break:break-word}.card p{font-size:.82rem;margin:0;color:#54616a}.panel{margin-top:16px}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;white-space:nowrap}th,td{font-size:.83rem;padding:13px 12px;border-bottom:1px solid #d9dee2;text-align:right}thead th{color:#52606a;font-size:.71rem;text-transform:uppercase;letter-spacing:.04em}th:first-child,td:first-child{text-align:left}tbody th{font-weight:500}tbody small{display:block;font-size:.72rem;margin-top:5px}tbody tr:nth-child(even){background:#f7f8f9}.scroll{overflow-x:auto}ul{padding-left:1.2em}.footer{margin-top:25px;border-top:1px solid #cbd4d8;padding-top:16px;color:#48565f;font-size:.79rem}.tag{padding:6px 10px;font-size:.73rem;border:1px solid #b9c3ca;border-radius:3px;font-weight:650}code{font-size:.8em;word-break:break-all}.identity{white-space:normal;min-width:180px;max-width:230px;text-align:left}@media(max-width:680px){main{padding:20px 14px 40px}.cards{grid-template-columns:1fr}.card{padding:17px}h1{font-size:1.45rem}}
@media print{body{background:white}main{padding:0}.card,.panel{break-inside:avoid}.scroll{overflow:visible}thead{display:table-header-group}}
</style></head><body><main><header><div><div class="eyebrow">SF97 / Merchant Revenue Operations / Source-bound operator report</div><h1>${escaped(report.merchantName)}</h1><div class="muted">${escaped(observationLabel)} · ${escaped(report.originalSellerMode)} · ${escaped(report.observedFrom)} to ${escaped(report.observedUntil)}</div></div><div class="tag">Private local report</div></header><p class="sub">Route-level commercial review from the original SF30 seller traffic counters and seller payment terms, joined to merchant-entered USD valuations and costs. This is not an invoice or a transaction ledger.</p><section class="cards"><article class="card"><span class="eyebrow">Target monthly gross</span><strong>$${escaped(pre.plannedMonthlyTargetGrossUsd)}</strong><p>Merchant targets × owner-valued USD per route, not observed receipts.</p></article><article class="card"><span class="eyebrow">Target contribution</span><strong>${pre.plannedMonthlyTargetContributionAfterFixedUsd===null?'Unknown':'$'+escaped(pre.plannedMonthlyTargetContributionAfterFixedUsd)}</strong><p>After entered variable costs and shared fixed cost; incomplete inputs stay unknown.</p></article><article class="card"><span class="eyebrow">Observed 2xx nominal value</span><strong>$${escaped(pre.modeledNominal2xxResponseValueUsd)}</strong><p>Only if every observed 2xx were billed at today's owner-entered quote; NOT revenue.</p></article></section><section class="panel"><h2>Native seller routes × merchant economics</h2><div class="scroll"><table><thead><tr><th>Route</th><th>Requests</th><th>402</th><th>2xx</th><th>5xx</th><th>D/C</th><th>Quote USD</th><th>Target gross USD</th><th>Target contribution USD*</th></tr></thead><tbody>${rs}</tbody></table></div><p class="muted" style="font-size:.8rem">*Before shared monthly fixed cost. Unmatched/method/invalid request buckets are excluded from product demand. 402 responses are payment challenges, not purchases.</p></section><section class="panel"><h2>Approved payment options</h2><p class="muted">One merchant-entered USD quote, cost schedule and monthly volume target applies to every approved alternative on its route. HTTP counters do not identify a selected option. Full asset, recipient and extra metadata remain in the private report.json.</p><div class="scroll"><table><thead><tr><th>Route / option</th><th>Network / timeout</th><th>Atomic amount</th><th>Asset SHA-256</th><th>Recipient SHA-256</th><th>Extra metadata</th></tr></thead><tbody>${optionRows}</tbody></table></div></section>${periodHtml(report)}<section class="panel"><h2>Operator review queue</h2><ul>${issues}</ul></section><section class="panel"><h2>Accounting boundary and next commercial decision</h2><p>${escaped(report.accounting)}</p><p>Pair this worksheet with independently checked settlement records and actual cost quotes before making an invoice or a customer revenue claim. Use SF87 when comparing x402 to MPP rail economics; this report does not reimplement that calculator.</p></section><footer class="footer">Seller SHA256 <code>${escaped(report.sourceSha256.seller??'')}</code> · Native operations export SHA256 <code>${escaped(report.sourceSha256.history??report.sourceSha256.snapshot??'')}</code> · Owner terms SHA256 <code>${escaped(report.sourceSha256.terms??'')}</code><br>Generated ${escaped(report.generatedAt)} · SF97 standalone local output · No network writes, wallets, hosted CI or payments.</footer></main></body></html>`;
}
export async function readJson(path, label, maximum) {
  const bytes=await readFile(path);
  if (bytes.length > (maximum??MAX_HISTORY_INPUT)) throw new RangeError(`${label} exceeds ${(maximum??MAX_HISTORY_INPUT)/(1024*1024)}MiB maximum`);
  const value=JSON.parse(bytes.toString('utf8'));
  const limit=maximum??(value.schema===HISTORY?MAX_HISTORY_INPUT:MAX_INPUT);
  if(bytes.length>limit)throw new RangeError(`${label} exceeds ${limit/(1024*1024)}MiB maximum`);
  return {value,hash:digest(bytes),bytes};
}
function args(argv) {
  const o={};
  for (let i=0;i<argv.length;i+=2) {
    if (!keys.has(argv[i]) || !argv[i+1] || own(o,argv[i])) throw new TypeError(USAGE);
    o[argv[i]]=argv[i+1];
  }
  if (!o['--config']||!o['--terms']||!o['--output']||['--snapshot','--history','--ops-url'].filter(key=>o[key]).length!==1)
    throw new TypeError('Specify seller config, owner terms, output and exactly one original observation source');
  return o;
}
export async function liveSnapshot(url) {
  const target=new URL(url);
  const history=['/api/history','/history.json'].includes(target.pathname);
  const query=[...target.searchParams.keys()];
  if (target.protocol!=='http:' || !['127.0.0.1','localhost'].includes(target.hostname) || target.username || target.password || target.hash || !target.port ||
      (!history&&!['/api/snapshot','/export.json'].includes(target.pathname)) ||
      (history?(query.length>3||new Set(query).size!==query.length||query.some(key=>!['from','to','routeId'].includes(key))):target.search))
    throw new TypeError('Live source must be an original loopback operator snapshot or history JSON endpoint with its original date/route selection');
  const maximum=history?MAX_HISTORY_INPUT:MAX_INPUT;
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),4000);
  try {
    const res=await fetch(target,{redirect:'error',signal:controller.signal,headers:{accept:'application/json'}});
    if (!res.ok) throw new Error(`Original operator snapshot HTTP ${res.status}`);
    const len=Number(res.headers.get('content-length'));
    if (Number.isFinite(len) && len>maximum) throw new RangeError('Original observation export too large');
    const reader=res.body.getReader(),chunks=[];let size=0;
    try {
      while (true) {
        const {done,value}=await reader.read();if(done)break;
        size+=value.byteLength;
        if(size>maximum)throw new RangeError('Original observation export too large');
        chunks.push(Buffer.from(value));
      }
    } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
    const buffer=Buffer.concat(chunks),value=JSON.parse(buffer.toString('utf8'));
    if(history&&value.schema!==HISTORY)throw new TypeError('Original history endpoint returned a different observation schema');
    return {value,hash:digest(buffer),bytes:buffer};
  } finally {clearTimeout(timeout);}
}
export async function createReport(argv) {
  const a=args(argv);
  const [seller,terms,snapshot]=await Promise.all([
    readJson(a['--config'],'seller config'),readJson(a['--terms'],'merchant terms'),
    a['--snapshot']||a['--history']?readJson(a['--snapshot']??a['--history'],'observation'):
      liveSnapshot(a['--ops-url'].replace(/\/$/,'')+(new URL(a['--ops-url']).pathname==='/'?'/api/snapshot':''))
  ]);
  if(a['--history']&&snapshot.value.schema!==HISTORY)throw new TypeError('--history requires an original usage history export');
  const report=analyze(seller.value,snapshot.value,terms.value,{seller:seller.hash,terms:terms.hash,snapshot:snapshot.hash,
    ...(snapshot.value.schema===HISTORY?{history:snapshot.hash}:{})});
  const reportJson=JSON.stringify(report,null,2)+'\n';
  if(Buffer.byteLength(reportJson)>MAX_HISTORY_INPUT)throw new RangeError('Period report exceeds 64MiB; select fewer original history days or one route');
  const out=resolve(a['--output']);
  await mkdir(out,{recursive:false,mode:0o700});
  for (const [name,contents] of [['report.json',reportJson],['review.html',html(report)]]) {
    const handle=await open(join(out,name),'wx',0o600);
    try {await handle.writeFile(contents,'utf8');} finally {await handle.close();}
  }
  // When the actual native SDK SF98 journal exists, join it to THIS actual original
  // observer session. Retain existing SF97 CLI/output intact without this opt-in.
  let native = null;
  if (a['--native-outbox']) {
    native = await runNativeReconciliation({
      reportPath: join(out, 'report.json'),
      outboxDir: resolve(a['--native-outbox']),
      outDir: join(out, 'native-settlement')
    });
  }
  return {status:'REPORT_CREATED',directory:out,
    files:['report.json','review.html',...(native?['native-settlement/']:[])],
    session:report.sessionId,routes:report.routes.length,issues:report.issues.length,
    ...(report.usageHistory?{observation:'DURABLE_HISTORY',sessions:report.sessionIds.length,
      days:report.usageHistory.days.length,range:report.usageHistory.range}:{}),
    mode:report.originalSellerMode,
    native: native ? {matchedNativeEvents:native.matchedNativeEvents,
      originalEvents:native.originalEvents,issues:native.issues,paymentOptions:native.paymentOptions,
      exactRecipientEvents:native.exactRecipientEvents,
      legacyUniqueRecipientEvents:native.legacyUniqueRecipientEvents,
      ambiguousLegacyEvents:native.ambiguousLegacyEvents} : null};
}
export async function main(argv=process.argv.slice(2)) {
  if (argv.length===1 && ['--help','-h'].includes(argv[0])) {
    process.stdout.write(USAGE+'\n');
    return {status:'HELP'};
  }
  const result = await createReport(argv);
  process.stdout.write(JSON.stringify(result)+'\n');
  return result;
}
if (process.argv[1] && import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(e=>{console.error('SF97:',e.message);process.exitCode=1;});
}
