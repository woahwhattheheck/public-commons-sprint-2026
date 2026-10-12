// MIT. Native settled-payment composition of the original SF25, SF54 and SF60 modules.
import { createHash } from 'node:crypto';
import { validateConfig } from './config.mjs';
import { createNativeCatalogCommitQueue } from './catalog-queue.mjs';
import { PaymentAutoCatalog } from '../../../stellar-forge/payment-auto-catalog/auto-catalog.mjs';
import { DurableCatalogTransaction } from '../sf60-durable-catalog-transaction/journal.mjs';
import { BazaarSettlementSidechannel, encodeCatalogSidechannel } from '../sf54-cataloging-sidechannel/sidechannel.mjs';

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hasBazaar = payload => plain(payload?.extensions) && Object.hasOwn(payload.extensions,'bazaar');
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (plain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key,canonical(value[key])]));
  return value;
}
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const errorCode = error => /^[A-Z][A-Z0-9_]{0,95}$/.test(error?.message ?? '')
  ? error.message : 'CATALOG_UNAVAILABLE';
const empty = () => ({headerName:'EXTENSION-RESPONSES',headerValue:null,extensionResponses:{},bazaar:null});
function rejected(paymentPayload,reason) {
  const catalogDecision = {decision:'reject',reason};
  return {...encodeCatalogSidechannel({paymentPayload,catalogDecision}),catalogDecision};
}

/**
 * Only the owning native runtime calls process() after the original SDK settles.
 * No HTTP caller can inject a "settled" flag or a catalog authority.
 * Each configured network owns its original SF60 journal for the process lifetime.
 */
export async function openNativeSettlementCatalog(input) {
  const config = validateConfig(input);
  if (!config.catalog) return null;
  const journal = await DurableCatalogTransaction.open(config.catalog.directory);
  const merchants = new Map(config.catalog.merchants.map(row => [row.origin+'|'+row.payTo,row]));
  const nativeParams = params => {
    const query = new URLSearchParams(params);
    const networks = query.getAll('network');
    if (networks.length > 1 || networks.length === 1 && networks[0] !== config.network)
      throw new RangeError('Discovery network must match this native facilitator');
    query.set('network',config.network);
    return query;
  };
  const queue = createNativeCatalogCommitQueue(journal);
  const counters = {accepted:0,replayed:0,rejected:0};
  let pending = 0, closing = null, closed = false;
  let lastError = null;
  let retained = {resources:journal.size,version:journal.version,operations:journal.count,head:journal.head};
  const refresh = () => {
    retained = {resources:journal.size,version:journal.version,operations:journal.count,head:journal.head};
    return retained;
  };
  const status = () => {
    let state = closed ? 'CLOSED' : closing ? 'CLOSING' : 'READY';
    if (!closed) try { refresh(); } catch { state = 'UNAVAILABLE'; }
    return {enabled:true,state,pending,...retained,counters:{...counters},batch:queue.status(),lastError};
  };
  const record = async (paymentPayload,requirements,result) => {
    if (result?.success !== true || !hasBazaar(paymentPayload)) return empty();
    if (closing) return rejected(paymentPayload,'CATALOG_CLOSING');
    // Capture the caller's successful operation before yielding to the queue.
    // The original SDK result itself remains owned and returned by the runtime.
    try {
      paymentPayload = structuredClone(paymentPayload);
      requirements = structuredClone(requirements);
      result = structuredClone(result);
    } catch {return rejected(paymentPayload,'CATALOG_INPUT_UNSERIALIZABLE');}
    pending++;
    // Prepare through the original SF25/SF54 path, then share the original
    // guarded SF60 publication with other pending metadata operations.
    const job = queue.enqueue(batch => {
      try {
        if (result.network !== config.network || !/^[a-f0-9]{64}$/.test(result.transaction ?? ''))
          return rejected(paymentPayload,'SETTLEMENT_RECEIPT_INVALID');
        let origin;
        try { origin = new URL(paymentPayload.resource?.url).origin; }
        catch { return rejected(paymentPayload,'RESOURCE_URL_INVALID'); }
        const merchant = merchants.get(origin+'|'+requirements.payTo);
        if (!merchant) return rejected(paymentPayload,'MERCHANT_CATALOG_AUTHORITY_UNCONFIGURED');
        const transaction = result.transaction;
        // This is a reference to the original transaction, not a second RPC or
        // a new operation. The journal retains its canonical local receipt.
        const receiptURL = 'https://stellar.expert/explorer/' +
          (config.network === 'stellar:testnet' ? 'testnet' : 'public') + '/tx/' + transaction;
        const receipt = {
          schema:'stellar-forge.native-catalog-receipt.v1',
          operationId:config.network+':'+transaction,
          settlement:{success:true,network:result.network,transaction,
            ...(typeof result.payer === 'string' ? {payer:result.payer} : {})},
          resource:structuredClone(paymentPayload.resource),
          accepted:structuredClone(paymentPayload.accepted),
          bazaar:structuredClone(paymentPayload.extensions.bazaar),
        };
        const receiptSha256 = digest(receipt);
        const previous = batch.lookupProvenance({authority:'settlement_hook',sourceURL:receiptURL});
        const sequence = previous?.candidate.sequence ?? batch.nextSellerSequence(merchant.sellerId);
        const settlement = {status:'settled',...merchant,network:config.network,scheme:requirements.scheme,
          asset:requirements.asset,amount:requirements.amount,receiptURL,receiptSha256,
          observedAt:previous?.provenance.observedAt ?? new Date().toISOString()};
        const adapter = {
          ingest({candidate,authority,provenance}) {
            return batch.ingest(candidate,authority,{...provenance,settlementReceipt:receipt});
          },
          list:params => journal.list(nativeParams(params)),
          search:params => journal.search(nativeParams(params)),
          get size() {return journal.size;},
          get version() {return journal.version;},
        };
        const original = new BazaarSettlementSidechannel({catalog:new PaymentAutoCatalog(adapter)});
        return original.processSettledAsync({paymentPayload,settlement,sequence}).then(outcome => {
          refresh();
          return outcome;
        });
      } catch (error) {
        // Settlement already succeeded. A catalog failure may reject metadata,
        // but must never replace the SDK result with a retryable payment error.
        lastError = errorCode(error);
        return rejected(paymentPayload,lastError);
      }
    });
    try {
      const outcome = await job;
      if (outcome.catalogDecision?.decision === 'accepted') {counters.accepted++;lastError=null;}
      else if (outcome.catalogDecision?.reason === 'EXACT_REPLAY') counters.replayed++;
      else {counters.rejected++;lastError=outcome.catalogDecision?.reason ?? 'CATALOGING_REJECTED';}
      return outcome;
    } catch (error) {
      lastError = errorCode(error);
      counters.rejected++;
      return rejected(paymentPayload,lastError);
    } finally {pending--;}
  };
  return Object.freeze({
    process:record,
    list:params => journal.list(nativeParams(params)),
    search:params => journal.search(nativeParams(params)),
    status,
    close:() => closing ??= (async () => {
      await queue.close();
      try {refresh();} catch {}
      await journal.close();
      closed = true;
    })(),
  });
}
