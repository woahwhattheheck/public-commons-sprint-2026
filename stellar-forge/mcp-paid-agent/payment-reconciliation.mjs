/** MIT. Read an original payment through the existing SF86 Stellar verifier. */
import {reconcilePaymentAttempt} from '../../stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/verify.mjs';
import {createOfficialEventDecoder, selectStellarEvidenceEndpoint} from
  '../../stellar/scf-starforge-20261009/sf43-agent-commerce/verify.mjs';
import {createPublicHttpsFetch} from '../../stellar/scf-starforge-20261009/sf31-buyer-client/public-transport.mjs';
import {validStrKey, networkProfile} from '../../stellar/scf-starforge-20261009/sf86-rpc-transfer-reconcile/terms.mjs';

const fail = code => { throw Object.assign(new Error(code), {code}); };

/** Host-owned payer and observation transport. No signer or approval is needed. */
export function createNativeMcpReconciler({payer, network, rpcUrl, fetchImpl, httpsProxyEnv,
  maxEventPages = 24} = {}) {
  if (!validStrKey(payer, 'G') && !validStrKey(payer, 'C')) fail('MCP_RECONCILE_TRUSTED_PAYER_REQUIRED');
  if (network !== undefined) networkProfile(network);
  if (fetchImpl !== undefined && typeof fetchImpl !== 'function') fail('MCP_RECONCILE_TRANSPORT_INVALID');
  if (httpsProxyEnv !== undefined && (typeof httpsProxyEnv !== 'string' ||
      !/^[A-Za-z_][A-Za-z0-9_]*$/.test(httpsProxyEnv))) fail('MCP_RECONCILE_PROXY_ENV_INVALID');
  if (!Number.isSafeInteger(maxEventPages) || maxEventPages < 1 || maxEventPages > 100)
    fail('MCP_RECONCILE_PAGE_LIMIT_INVALID');
  let decoder;
  return async ({quoteId, accepted, paymentResponse, transaction, signal}) => {
    signal?.throwIfAborted();
    if (network !== undefined && accepted?.network !== network) fail('MCP_RECONCILE_NETWORK_MISMATCH');
    const endpoint = selectStellarEvidenceEndpoint(accepted?.network, rpcUrl);
    let transport = fetchImpl;
    if (!transport) {
      const request = createPublicHttpsFetch({trustedProxy:httpsProxyEnv === undefined ? null :
        {mode:'explicit-connect', origin:new URL(endpoint).origin, proxyEnv:httpsProxyEnv}});
      transport = (url, options) => request(url, {...options, redirect:'manual'});
    }
    // The official decoder loads only if a successful transaction needs its
    // actual contract events checked. Failed lookups need no wallet runtime.
    const decodeContractEvent = async event => {
      decoder ??= createOfficialEventDecoder().catch(error => { decoder = undefined; throw error; });
      return (await decoder)(event);
    };
    return reconcilePaymentAttempt({intentId:quoteId, requirement:structuredClone(accepted),
      receipt:paymentResponse ? structuredClone(paymentResponse) : undefined, payer, transaction,
      rpcEndpoint:endpoint, fetchImpl:transport, decodeContractEvent, maxEventPages, signal});
  };
}
