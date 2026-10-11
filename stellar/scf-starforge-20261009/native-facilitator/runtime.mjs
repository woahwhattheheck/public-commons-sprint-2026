// MIT. Native x402 backend and in-process SF30 composition. SDK owns all payment logic.
import { isDeepStrictEqual } from 'node:util';
import { validateConfig, requireValue, FacilitatorError } from './config.mjs';
import { createRpcReadiness } from './readiness.mjs';
import { acquireSignerOwnership } from './ownership.mjs';
import { createSettlementSlots } from './settlement-slots.mjs';
import { validateAvailabilityDirectory } from '../sf30-seller-sdk/availability/store.mjs';

const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);

export async function createNativeFacilitator(input, { environment = process.env } = {}) {
  // Snapshot trusted config before loading an SDK or reading a key.
  const c = validateConfig(input);
  const readiness = createRpcReadiness(c);
  let ownership;
  try {
    ownership = await acquireSignerOwnership(c);
    if (c.operations.requireReady && !(await readiness.probe()).ready)
      throw new FacilitatorError('FACILITATOR_RPC_NOT_READY',503);
    return await createConfiguredNative(c,{environment,readiness,ownership});
  } catch (error) {
    await readiness.close(); await ownership?.release(); throw error;
  }
}

async function createConfiguredNative(c,{environment,readiness,ownership}) {
  const [{x402Facilitator}, {ExactStellarScheme}, stellar] = await Promise.all([
    import('@x402/core/facilitator'), import('@x402/stellar/exact/facilitator'), import('@x402/stellar'),
  ]);
  const loadSigner = record => {
    requireValue(typeof environment[record.secretEnv] === 'string' && environment[record.secretEnv].length > 0,
      'SIGNER_ENV_UNAVAILABLE');
    let signer;
    try { signer = stellar.createEd25519Signer(environment[record.secretEnv], c.network); }
    catch { throw new FacilitatorError('SIGNER_SECRET_INVALID'); }
    requireValue(signer.address === record.address, 'SIGNER_ACCOUNT_MISMATCH');
    return signer;
  };
  requireValue(c.payments.assets.every(stellar.validateStellarAssetAddress) &&
    c.payments.recipients.every(stellar.validateStellarDestinationAddress), 'STELLAR_ADDRESS_INVALID');
  const signers = c.signers.map(loadSigner);
  const feeBumpSigner = c.feeBumpSigner ? loadSigner(c.feeBumpSigner) : undefined;
  const slots = createSettlementSlots(c.signers.map(signer => signer.address),c.limits.maxSettleInFlight);
  const scheme = new ExactStellarScheme(signers, { rpcConfig:{url:c.rpcUrl}, areFeesSponsored:true,
    // Keep every configured signer in this single SDK safety set. Assign an
    // available source account to the whole admitted native call, across awaits.
    selectSigner:slots.selectSigner,
    // SDK checks the inner resource + inclusion fee. The optional outer fee bump
    // adds one further inclusion fee; reserve it inside the operator's total cap.
    maxTransactionFeeStroops:c.limits.maxTransactionFeeStroops -
      (feeBumpSigner ? c.limits.inclusionFeeStroops : 0),
    inclusionFeeStroops:c.limits.inclusionFeeStroops, ...(feeBumpSigner ? {feeBumpSigner} : {}) });
  const native = new x402Facilitator().register(c.network, scheme);
  let closing = false, verifying = 0, settling = 0;
  const active = new Set();
  const counters = { verifyCalls:0, settleCalls:0, verifyRefusals:0, settlementRefusals:0, nativeErrors:0 };

  function validatePayment(payload, requirements) {
    requireValue(object(payload) && payload.x402Version === 2 && object(payload.payload) &&
      object(requirements) && isDeepStrictEqual(payload.accepted, requirements), 'PAYMENT_ENVELOPE_MISMATCH');
    requireValue(requirements.scheme === 'exact' && requirements.network === c.network,
      'PAYMENT_NETWORK_OR_SCHEME_DENIED');
    requireValue(c.payments.assets.includes(requirements.asset) &&
      c.payments.recipients.includes(requirements.payTo), 'MERCHANT_TERMS_DENIED');
    requireValue(typeof requirements.amount === 'string' && /^[1-9][0-9]{0,38}$/.test(requirements.amount) &&
      BigInt(requirements.amount) <= BigInt(c.payments.maxAtomic), 'PAYMENT_AMOUNT_DENIED');
    requireValue(Number.isInteger(requirements.maxTimeoutSeconds) && requirements.maxTimeoutSeconds >= 1 &&
      requirements.maxTimeoutSeconds <= 86400 && requirements.extra?.areFeesSponsored === true &&
      c.payments.paymentFlows.includes(requirements.extra?.paymentFlow ?? 'authorization'), 'PAYMENT_PROFILE_DENIED');
  }
  async function call(kind, payload, requirements) {
    if (closing) throw new FacilitatorError('FACILITATOR_DRAINING', 503);
    // Never queue a payment or retry after a caller disconnect. Admission is immediate.
    if (kind === 'settle' ? !slots.hasCapacity() : verifying >= c.limits.maxVerifyInFlight)
      throw new FacilitatorError('FACILITATOR_BUSY', 503);
    validatePayment(payload, requirements);
    // Avoid a caller mutating terms while native verification awaits the RPC.
    const originalPayload = structuredClone(payload), originalRequirements = structuredClone(requirements);
    if (c.operations.requireReady) {
      if (!(await readiness.probe()).ready) throw new FacilitatorError('FACILITATOR_RPC_NOT_READY',503);
      // A probe may yield while the process drains or another call takes capacity.
      if (closing) throw new FacilitatorError('FACILITATOR_DRAINING',503);
      if (kind === 'settle' ? !slots.hasCapacity() : verifying >= c.limits.maxVerifyInFlight)
        throw new FacilitatorError('FACILITATOR_BUSY',503);
    }
    // No await between the final admission check and reserving its source account.
    const slot = kind === 'settle' ? slots.acquire() : null;
    kind === 'settle' ? settling++ : verifying++;
    counters[kind === 'settle' ? 'settleCalls' : 'verifyCalls']++;
    const invoke = () => native[kind](originalPayload, originalRequirements);
    const work = Promise.resolve().then(() => slot ? slots.run(slot,invoke) : invoke());
    active.add(work);
    try {
      const result = await work;
      if (kind === 'verify' && result.isValid === false) counters.verifyRefusals++;
      if (kind === 'settle' && result.success === false) counters.settlementRefusals++;
      return result; // Original SDK result, never manufacture success or receipts.
    } catch {
      counters.nativeErrors++;
      // Raw provider errors can contain signed transaction bytes or RPC credentials.
      throw new FacilitatorError(kind === 'settle' ? 'NATIVE_SETTLEMENT_ERROR_RECONCILE' : 'NATIVE_VERIFICATION_ERROR', 502);
    } finally {
      active.delete(work);
      kind === 'settle' ? settling-- : verifying--;
      if (slot) slots.release(slot);
      // A timed-out drain retains signer ownership until the accepted SDK work ends.
      if (closing && active.size === 0) { slots.close(); await ownership.release(); }
    }
  }
  const getSupported = async () => {
    const supported = structuredClone(native.getSupported());
    // Advisory operator policy alongside the original SDK kind. Native payment
    // requirements still select one extra.paymentFlow; the SDK owns settlement.
    for (const kind of supported.kinds) if (kind.x402Version === 2 &&
        kind.scheme === 'exact' && kind.network === c.network) {
      kind.extra = {...kind.extra, paymentFlows:[...c.payments.paymentFlows]};
    }
    return supported;
  };
  const status = () => ({ mode:'NATIVE_X402_FACILITATOR', network:c.network,
    state:closing ? 'DRAINING' : 'ACCEPTING', activeVerify:verifying, activeSettle:settling,
    paymentFlows:[...c.payments.paymentFlows],
    settlementConcurrency:c.limits.maxSettleInFlight,
    availableSettlementSlots:closing ? 0 : c.limits.maxSettleInFlight - settling,
    settlementAccounts:slots.status(),
    counters:{...counters},chainReadiness:readiness.status().state,
    readiness:readiness.status(),ownership:ownership.status() });
  const drain = async () => {
    closing = true;
    await readiness.close();
    let timer;
    try {
      const complete = Promise.allSettled([...active]).then(() => true);
      const deadline = new Promise(resolve => { timer = setTimeout(() => resolve(false), c.limits.drainGraceMs); });
      const drained = await Promise.race([complete, deadline]);
      if (drained) { slots.close(); await ownership.release(); }
      return {drained,...status()};
    } finally { clearTimeout(timer); }
  };
  const waitForIdle = async () => {
    requireValue(closing,'DRAIN_REQUIRED');
    await Promise.allSettled([...active]);
    slots.close();
    await ownership.release();
    return {drained:true,...status()};
  };
  return Object.freeze({ network:c.network, getSupported, verify:(p,r) => call('verify',p,r),
    settle:(p,r) => call('settle',p,r), status, drain,probeReadiness:readiness.probe,
    waitForIdle,drainGraceMs:c.limits.drainGraceMs });
}

/** Reuse the original SF30 seller and native server, with no intermediary HTTP service. */
export async function startSelfFacilitatedSeller({ facilitatorConfig, config, port = 0, handlers = {},
  environment = process.env, availabilityDirectory } = {}) {
  if (availabilityDirectory !== undefined) validateAvailabilityDirectory(availabilityDirectory);
  const policy = validateConfig(facilitatorConfig);
  const facilitator = await createNativeFacilitator(policy, {environment});
  let seller;
  try {
    const [{startSellerService}, {createNativeSellerServer}] = await Promise.all([
      import('../sf30-seller-sdk/serve.mjs'), import('../sf30-seller-sdk/native-factory.mjs'),
    ]);
    seller = await startSellerService({config,port,handlers,maxInFlight:policy.limits.maxSettleInFlight,
      drainGraceMs:facilitator.drainGraceMs, availabilityDirectory,
      nativeFactory:compiled => {
        // Refuse a service whose advertised quotes this backend cannot accept.
        for (const route of compiled.routes) for (const terms of route.offer.accepts) {
          requireValue(terms.scheme === 'exact' && terms.network === policy.network &&
            policy.payments.assets.includes(terms.asset) && policy.payments.recipients.includes(terms.payTo) &&
            /^[1-9][0-9]{0,38}$/.test(terms.amount) && BigInt(terms.amount) <= BigInt(policy.payments.maxAtomic),
            'SELLER_TERMS_OUTSIDE_FACILITATOR_POLICY');
          requireValue(policy.payments.paymentFlows.includes(terms.extra?.paymentFlow ?? 'authorization'),
            'SELLER_FLOW_OUTSIDE_FACILITATOR_POLICY');
        }
        return createNativeSellerServer(compiled,{facilitatorClient:facilitator});
      }});
  } catch (error) { await facilitator.drain(); throw error; }
  let closing;
  return {...seller, facilitator, close:() => closing ??= (async () => {
    // Seller must finish its accepted requests before the in-process facilitator drains.
    let sellerResult;
    try { sellerResult = {drained:true,...await seller.close()}; }
    catch { sellerResult = {drained:false,...seller.lifecycle.snapshot()}; }
    // A forced seller socket close does not cancel an already accepted SDK operation.
    const facilitatorResult = await facilitator.drain();
    return {drained:sellerResult.drained && facilitatorResult.drained,
      seller:sellerResult,facilitator:facilitatorResult};
  })()};
}

