// MIT. Exact price decisions over the original merchant source and compilers.
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { merchantRoutes } from '../analyze.mjs';
import { validateSellerServiceConfig } from '../../sf30-seller-sdk/serve.mjs';
import { compileSellerRoutes } from '../../sf30-seller-sdk/resource-server.mjs';
import { compileHttpSellerOffer } from '../../sf30-seller-sdk/seller.mjs';
import { compileAssetRouteOffer } from '../../sf30-seller-sdk/response-asset.mjs';
import { importOpenApi } from '../../sf61-openapi-seller-import/importer.mjs';
import { createSellerServiceConfig } from '../../sf61-openapi-seller-import/service-config.mjs';
import { prepareMerchant } from '../../sf61-openapi-seller-import/workspace/model.mjs';

export const REPRICING_REVIEW_SCHEMA = 'stellar-forge.merchant-repricing-review.v1';
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => structuredClone(value);
const canonical = value => JSON.stringify(value, (_, item) => plain(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const fingerprint = value => createHash('sha256').update(canonical(value)).digest('hex');
const same = (left, right) => canonical(left) === canonical(right);
const failure = (code, message, status = 422) => Object.assign(new TypeError(message), {code, status});

function requireObject(value, code, message) {
  if (!plain(value)) throw failure(code, message);
  return value;
}

function amount(value, name) {
  if (typeof value !== 'string' || !/^[1-9][0-9]*$/.test(value))
    throw failure('EXACT_ATOMIC_AMOUNT_REQUIRED', `${name} must be a positive integer decimal string.`);
  // The original seller compiler below supplies its authoritative i128 bound.
  if (value.length > 39)
    throw failure('EXACT_ATOMIC_AMOUNT_REQUIRED', `${name} exceeds the original atomic amount range.`);
  return value;
}

/** Locate the original objects; never normalize the source being exported. */
function rawPayments(route) {
  if (own(route, 'offer')) return route.offer.accepts;
  return own(route.definition, 'paymentOptions')
    ? route.definition.paymentOptions : [route.definition.payment];
}

/** The normal service preflight, without opening files or starting a listener. */
function validateSeller(seller) {
  validateSellerServiceConfig(seller);
  const routes = merchantRoutes(seller);
  // Local-only definitions receive the same loopback URL form used at native
  // startup. It is used solely by the original compiler and is never exported.
  const origin = seller.publicOrigin ? new URL(seller.publicOrigin).origin : 'http://127.0.0.1:8423';
  const neverInvoke = () => { throw new Error('Price review does not invoke application code.'); };
  const compiled = compileSellerRoutes(seller.routes.map(route => ({
    id:route.id, maxRequestBytes:route.maxRequestBytes,
    ...(own(route, 'admit') ? {admit:neverInvoke} : {}),
    ...(own(route, 'responseAsset')
      ? {offer:compileAssetRouteOffer(route, origin, compileHttpSellerOffer, !seller.publicOrigin)}
      : own(route, 'offer') ? {offer:route.offer}
        : {definition:{...route.definition, url:origin + route.path}}),
    handler:neverInvoke,
  })), {allowLocalhost:!seller.publicOrigin});
  for (const route of compiled.routes) {
    const source = routes.find(item => item.routeId === route.id);
    if (!source || source.path !== route.path || source.method !== route.method)
      throw failure('SELLER_ROUTE_CHANGED', 'The original seller compiler and saved route identity differ.');
  }
  return routes;
}

/**
 * Produce one complete review from explicit atomic decisions. All untouched
 * source fields and option order remain in the exported seller configuration.
 * File-byte hashes, saved report/version and current-source checks belong to the
 * existing pricing workspace that persists this pure result.
 */
export function createRepricingReview({seller, edits} = {}) {
  requireObject(seller, 'SELLER_REQUIRED', 'Use the original saved seller configuration.');
  const beforeSeller = clone(seller), beforeRoutes = validateSeller(beforeSeller);
  if (!Array.isArray(edits) || !edits.length || edits.length > beforeRoutes.reduce((sum, route) => sum + route.paymentOptions.length, 0))
    throw failure('PRICE_EDITS_REQUIRED', 'Choose one or more original payment options to change.');

  const selected = new Map(), routeIndex = new Map(beforeRoutes.map((route, index) => [route.routeId, index]));
  for (const edit of edits) {
    requireObject(edit, 'INVALID_PRICE_EDIT', 'Each price edit must identify its original route and payment option.');
    if (Object.keys(edit).some(key => !['routeId','paymentIndex','expectedAmount','amount'].includes(key)) ||
        typeof edit.routeId !== 'string' || !routeIndex.has(edit.routeId) ||
        !Number.isSafeInteger(edit.paymentIndex) || edit.paymentIndex < 0)
      throw failure('INVALID_PRICE_EDIT', 'Use a current route ID, zero-based payment option and exact amounts.');
    const route = beforeRoutes[routeIndex.get(edit.routeId)], option = route.paymentOptions[edit.paymentIndex];
    if (!option) throw failure('PAYMENT_OPTION_CHANGED', 'The selected original payment option is unavailable.', 409);
    const expectedAmount = amount(edit.expectedAmount, 'Original amount'), nextAmount = amount(edit.amount, 'New amount');
    if (expectedAmount !== option.atomicAmount)
      throw failure('PAYMENT_AMOUNT_CHANGED', `The saved amount for ${edit.routeId}, option ${edit.paymentIndex + 1}, differs from this edit.`, 409);
    const key = JSON.stringify([edit.routeId, edit.paymentIndex]);
    if (selected.has(key)) throw failure('DUPLICATE_PRICE_EDIT', 'A payment option can appear only once in a price decision.');
    selected.set(key, {routeId:edit.routeId, paymentIndex:edit.paymentIndex, expectedAmount, amount:nextAmount});
  }

  const proposedSeller = clone(beforeSeller), normalizedEdits = [];
  // Walk source order, not request order, for stable review identities.
  for (const route of proposedSeller.routes) {
    for (let paymentIndex = 0; paymentIndex < rawPayments(route).length; paymentIndex++) {
      const edit = selected.get(JSON.stringify([route.id, paymentIndex]));
      if (!edit || edit.amount === edit.expectedAmount) continue;
      rawPayments(route)[paymentIndex].amount = edit.amount;
      normalizedEdits.push(edit);
    }
  }
  if (!normalizedEdits.length) throw failure('PRICE_UNCHANGED', 'Enter at least one amount different from its saved price.');

  const afterRoutes = validateSeller(proposedSeller), changes = [];
  const restored = clone(proposedSeller);
  for (const edit of normalizedEdits) {
    const index = routeIndex.get(edit.routeId), before = beforeRoutes[index].paymentOptions[edit.paymentIndex];
    const after = afterRoutes[index].paymentOptions[edit.paymentIndex];
    const unchangedPayment = {...after, atomicAmount:before.atomicAmount};
    if (!isDeepStrictEqual(before, unchangedPayment))
      throw failure('PAYMENT_IDENTITY_CHANGED', 'Repricing must preserve the complete original payment identity.');
    rawPayments(restored.routes[index])[edit.paymentIndex].amount = edit.expectedAmount;
    const delta = BigInt(edit.amount) - BigInt(edit.expectedAmount);
    changes.push({routeId:edit.routeId, method:beforeRoutes[index].method, path:beforeRoutes[index].path,
      paymentIndex:edit.paymentIndex, before:clone(before), after:clone(after),
      deltaAtomic:delta.toString(), direction:delta > 0n ? 'INCREASE' : 'DECREASE'});
  }
  if (!isDeepStrictEqual(restored, beforeSeller))
    throw failure('SELLER_SOURCE_CHANGED', 'The proposed seller differs outside the selected atomic amounts.');

  return {schema:REPRICING_REVIEW_SCHEMA,
    sellerCanonicalSha256:fingerprint(beforeSeller), proposedSellerCanonicalSha256:fingerprint(proposedSeller),
    edits:normalizedEdits, changes,
    routes:beforeRoutes.map((route, index) => ({routeId:route.routeId, method:route.method, path:route.path,
      before:clone(route.paymentOptions), after:clone(afterRoutes[index].paymentOptions)})),
    changedRoutes:new Set(normalizedEdits.map(edit => edit.routeId)).size,
    changedPaymentOptions:normalizedEdits.length,
    seller:beforeSeller, proposedSeller};
}

/** Rebuild retained decisions through the original compiler before source use. */
export function validateRepricingReview(review) {
  if (!plain(review) || review.schema !== REPRICING_REVIEW_SCHEMA)
    throw failure('REPRICING_REVIEW_REQUIRED', 'Use a retained original repricing review.');
  const rebuilt = createRepricingReview({seller:review.seller, edits:review.edits});
  for (const field of ['sellerCanonicalSha256','proposedSellerCanonicalSha256','edits','changes','routes',
    'changedRoutes','changedPaymentOptions','proposedSeller']) {
    if (!same(review[field], rebuilt[field]))
      throw failure('REPRICING_REVIEW_CHANGED', 'The retained price decision differs from its original seller and selected edits.', 409);
  }
  return rebuilt;
}

function sourceMatches(service, expected, code) {
  if (!isDeepStrictEqual(service, expected))
    throw failure(code, 'The original source inputs do not compile to this exact saved seller configuration. Use its original inputs or export the complete reviewed seller configuration.', 409);
}

/**
 * Prepare unchanged OpenAPI/binding inputs plus repriced original selections.
 * The caller retains exact input bytes and uses the original SF61/SF82 stage
 * commands. No compiled manifest or immutable release is rewritten here.
 */
export function prepareOpenApiRepricing({spec, selections, bindings, review} = {}) {
  const decision = validateRepricingReview(review);
  const originalSpec = clone(spec), originalSelections = clone(selections), originalBindings = clone(bindings);
  const imported = importOpenApi(originalSpec, originalSelections);
  const before = createSellerServiceConfig(imported, originalBindings);
  sourceMatches(before, decision.seller, 'OPENAPI_SOURCE_MISMATCH');
  const proposedSelections = clone(originalSelections), sourceChanges = [];
  const routeIndex = new Map(before.routes.map((route, index) => [route.id, index]));
  for (const edit of decision.edits) {
    const selectionIndex = routeIndex.get(edit.routeId), selection = proposedSelections[selectionIndex];
    if (!selection || selection.accepts?.[edit.paymentIndex]?.amount !== edit.expectedAmount)
      throw failure('OPENAPI_PAYMENT_MISMATCH', 'The original OpenAPI payment selection has changed.', 409);
    selection.accepts[edit.paymentIndex].amount = edit.amount;
    sourceChanges.push({...edit, selectionIndex, method:imported.offers[selectionIndex].method,
      path:imported.offers[selectionIndex].path});
  }
  const proposedImported = importOpenApi(originalSpec, proposedSelections);
  const service = createSellerServiceConfig(proposedImported, originalBindings);
  sourceMatches(service, decision.proposedSeller, 'OPENAPI_REPRICE_MISMATCH');
  return {schema:'stellar-forge.merchant-repricing-openapi.v1',
    source:{kind:'OPENAPI_SELECTIONS', specCanonicalSha256:fingerprint(originalSpec),
      bindingsCanonicalSha256:fingerprint(originalBindings),
      selectionsCanonicalSha256:fingerprint(originalSelections),
      proposedSelectionsCanonicalSha256:fingerprint(proposedSelections)},
    changes:sourceChanges, spec:originalSpec, selections:proposedSelections, bindings:originalBindings,
    imported:proposedImported, service};
}

/**
 * Keep the original API workspace's plan as the editable source. Its original
 * prepareMerchant/savePackage path continues to own auth references, source
 * documents, request contracts, upstreams and release packages.
 */
export function prepareMerchantPlanRepricing({specText, plan, review} = {}) {
  const decision = validateRepricingReview(review), originalPlan = clone(plan);
  const before = prepareMerchant(specText, originalPlan);
  sourceMatches(before.service, decision.seller, 'MERCHANT_PLAN_SOURCE_MISMATCH');
  const proposedPlan = clone(originalPlan), changes = [];
  const routeIndex = new Map(before.service.routes.map((route, index) => [route.id, index]));
  for (const edit of decision.edits) {
    const operationIndex = routeIndex.get(edit.routeId), operation = proposedPlan.operations[operationIndex];
    if (edit.paymentIndex !== 0 || operation?.amountAtomic !== edit.expectedAmount)
      throw failure('MERCHANT_PLAN_PAYMENT_MISMATCH', 'The original merchant plan does not contain this exact selected amount.', 409);
    operation.amountAtomic = edit.amount;
    changes.push({...edit, operationIndex, method:before.imported.offers[operationIndex].method,
      path:before.imported.offers[operationIndex].path});
  }
  const prepared = prepareMerchant(specText, proposedPlan);
  sourceMatches(prepared.service, decision.proposedSeller, 'MERCHANT_PLAN_REPRICE_MISMATCH');
  for (const field of ['facade','bindings','upstreams','transformations']) {
    if (!isDeepStrictEqual(prepared[field], before[field]))
      throw failure('MERCHANT_PLAN_BINDINGS_CHANGED', 'Repricing changed an original API or upstream binding.');
  }
  return {schema:'stellar-forge.merchant-repricing-api-plan.v1',
    source:{kind:'API_MERCHANT_PLAN', originalSourceSha256:createHash('sha256').update(specText).digest('hex'),
      planCanonicalSha256:fingerprint(originalPlan), proposedPlanCanonicalSha256:fingerprint(proposedPlan)},
    changes, plan:proposedPlan, prepared};
}
