import {ReconciliationError, requireTruth, object} from './terms.mjs';
export async function rpc(method, params, endpoint, fetchImpl, {signal}={}) {
  let response;
  try {
    response=await fetchImpl(endpoint, {method:'POST',redirect:'error',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:'sf86-'+method,method,params}),
      signal: signal ? AbortSignal.any([signal,AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000)});
  } catch { throw new ReconciliationError(signal?.aborted?'RECONCILIATION_CANCELLED':'RPC_TRANSPORT_FAILED'); }
  requireTruth(response.ok, 'RPC_HTTP_FAILED');
  let text;
  try { text=await response.text(); } catch { throw new ReconciliationError(signal?.aborted?'RECONCILIATION_CANCELLED':'RPC_BODY_FAILED'); }
  requireTruth(text.length <= 4_000_000, 'RPC_RESPONSE_TOO_LARGE');
  let message;
  try { message=JSON.parse(text); } catch { throw new ReconciliationError('RPC_RESPONSE_NOT_JSON'); }
  requireTruth(object(message) && !message.error && object(message.result), 'RPC_RESULT_INVALID');
  return message.result;
}
