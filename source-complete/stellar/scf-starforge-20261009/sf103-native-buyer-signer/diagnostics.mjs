// MIT. Bounded native SDK diagnostics; transaction and credential values are excluded.
export const NATIVE_SIGNING_DIAGNOSTIC_SCHEMA = 'stellar-forge.native-signing-diagnostic.v1';
const VERSION = '2.28.0';
const PHASES = new Set(['NOT_STARTED','PAYLOAD_CREATION','AUTHORIZATION_SIGNING',
  'TRANSACTION_SIGNING','PAYLOAD_VALIDATION','COMPLETE']);
const NAMES = new Set(['Error','TypeError','RangeError','SyntaxError','AggregateError','AbortError',
  'TimeoutError','FetchError','AxiosError','RpcError','ContractError','SimulationError',
  'SendTransactionError','NoSignatureNeededError']);
const TLS_CODES = new Set(['UNABLE_TO_VERIFY_LEAF_SIGNATURE','UNABLE_TO_GET_ISSUER_CERT',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY','DEPTH_ZERO_SELF_SIGNED_CERT','SELF_SIGNED_CERT_IN_CHAIN',
  'CERT_HAS_EXPIRED','CERT_NOT_YET_VALID','CERT_REVOKED','ERR_TLS_CERT_ALTNAME_INVALID',
  'ERR_TLS_HANDSHAKE_TIMEOUT','ERR_TLS_INVALID_PROTOCOL_METHOD','ERR_SSL_WRONG_VERSION_NUMBER',
  'ERR_SSL_TLSV1_ALERT_UNKNOWN_CA','ERR_SSL_SSLV3_ALERT_HANDSHAKE_FAILURE']);
const TIMEOUT_CODES = new Set(['ETIMEDOUT','ESOCKETTIMEDOUT','ECONNABORTED','UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','ERR_REQUEST_TIMEOUT']);
const NETWORK_CODES = new Set(['ECONNREFUSED','ECONNRESET','EPIPE','ENOTFOUND','EAI_AGAIN','ENETUNREACH',
  'EHOSTUNREACH','ERR_NETWORK','UND_ERR_SOCKET','UND_ERR_DESTROYED','UND_ERR_CLOSED']);
const OTHER_CODES = new Set(['ERR_BAD_REQUEST','ERR_BAD_RESPONSE','ERR_CANCELED','ABORT_ERR',
  'UND_ERR_RESPONSE_STATUS_CODE','UND_ERR_REQ_CONTENT_LENGTH_MISMATCH',
  'UND_ERR_RES_CONTENT_LENGTH_MISMATCH','ERR_INVALID_ARG_TYPE','ERR_INVALID_ARG_VALUE']);
const ALL_CODES = new Set([...TLS_CODES,...TIMEOUT_CODES,...NETWORK_CODES,...OTHER_CODES]);
const CATEGORIES = new Set(['TLS','TIMEOUT','NETWORK','HTTP','SDK']);
const REASONS = new Set(['INPUT_PARAMETERS_INVALID','SPONSORSHIP_REQUIRED',
  'SIMULATION_RESULT_MISSING','SIMULATION_RESTORE_REQUIRED','SIMULATION_FAILED',
  'EXPECTED_SIGNER_MISMATCH','AUTHORIZATION_SIGNATURES_MISSING',
  'CLIENT_NOT_REGISTERED','PAYMENT_FLOW_UNSUPPORTED','PAYMENT_POLICY_REJECTED',
  'PAYMENT_CREATION_ABORTED','SPEND_ASSET_NOT_ALLOWED','SPEND_ATOMIC_CAP_EXCEEDED',
  'SPEND_USD_CAP_EXCEEDED','SDK_ENVELOPE_MISMATCH','SDK_SELECTION_MISMATCH']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const read = (value, key) => { try { return value?.[key]; } catch { return undefined; } };
const count = value => Number.isSafeInteger(value) && value >= 0;
const status = value => Number.isInteger(value) && value >= 100 && value <= 599 ? value : undefined;

/**
 * The original x402 2.28.0 client throws plain Error for these branches.
 * Classify only its fixed prefixes; discard all interpolated error text.
 * Pinned upstream blobs: Stellar scheme 93a9e6bc1851c243dedb2ef24e0bc4524de30e00,
 * shared c6215729d11a86aed3b029f8dc5565b8bc2e3e1a,
 * core client 30b534b0966c7e3999c28b0e66d9bc4bdf233c34.
 * These observations never change spend controls, retry or release decisions.
 */
function reasonFor(error) {
  const code=read(error,'code');
  if(code==='NATIVE_SDK_ENVELOPE_MISMATCH')return 'SDK_ENVELOPE_MISMATCH';
  if(code==='NATIVE_SDK_SELECTION_MISMATCH')return 'SDK_SELECTION_MISMATCH';
  const message=read(error,'message');
  if(typeof message!=='string')return undefined;
  // Large RPC messages are never copied into a retained diagnostic.
  const prefix=message.slice(0,256);
  if(prefix.startsWith('Invalid input parameters for creating Stellar payment, cause: '))
    return 'INPUT_PARAMETERS_INVALID';
  if(message==='Exact scheme requires areFeesSponsored to be true')return 'SPONSORSHIP_REQUIRED';
  if(message==='Simulation result is undefined')return 'SIMULATION_RESULT_MISSING';
  if(prefix.startsWith('Stellar simulation result has type "RESTORE" with restorePreamble: '))
    return 'SIMULATION_RESTORE_REQUIRED';
  if(message==='Stellar simulation failed' || prefix.startsWith('Stellar simulation failed with error message: '))
    return 'SIMULATION_FAILED';
  if(prefix.startsWith('Expected to sign with ['))return 'EXPECTED_SIGNER_MISMATCH';
  if(prefix.startsWith('unexpected signer(s) required: ['))return 'AUTHORIZATION_SIGNATURES_MISSING';
  if(prefix.startsWith('No client registered for x402 version: ') ||
    prefix.startsWith('No client registered for scheme: ') ||
    prefix.startsWith('No network/scheme registered for x402 version: '))return 'CLIENT_NOT_REGISTERED';
  if(prefix.startsWith('No payment requirements with a recognized paymentFlow for x402 version: '))
    return 'PAYMENT_FLOW_UNSUPPORTED';
  if(prefix.startsWith('All payment requirements were filtered out by policies for x402 version: '))
    return 'PAYMENT_POLICY_REJECTED';
  if(prefix.startsWith('Payment creation aborted: '))return 'PAYMENT_CREATION_ABORTED';
  if(prefix.startsWith('All payment requirements were rejected by spendControls: only default assets '))
    return 'SPEND_ASSET_NOT_ALLOWED';
  if(prefix.startsWith('All payment requirements were rejected by spendControls.allowedAssets maxAmountPerPayment. '))
    return 'SPEND_ATOMIC_CAP_EXCEEDED';
  if(prefix.startsWith('All payment requirements were rejected by spendControls.maxAmountPerPayment ('))
    return 'SPEND_USD_CAP_EXCEEDED';
  return undefined;
}

function record(error) {
  const name=read(error,'name');
  const out = {name:NAMES.has(name) ? name : 'OtherError'};
  const code = read(error,'code');
  if (ALL_CODES.has(code)) out.code = code;
  const reason=reasonFor(error);
  if(reason!==undefined)out.reason=reason;
  const http = status(read(error,'status')) ?? status(read(error,'statusCode')) ??
    status(read(read(error,'response'),'status'));
  if (http !== undefined) out.httpStatus = http;
  return out;
}

/** Keep error identities and fixed SDK reasons only. Raw messages, stacks and bodies are discarded. */
export function nativeFailureFacts(error) {
  const pending=[error], seen=new Set(), facts=[], identities=new Set();
  let visited=0;
  while(pending.length && visited<16) {
    const item=pending.shift();
    if(item===null || (typeof item!=='object' && typeof item!=='function') || seen.has(item))continue;
    seen.add(item);visited++;
    const fact=record(item), key=JSON.stringify(fact);
    if(!identities.has(key)){identities.add(key);facts.push(fact);}
    const cause=read(item,'cause');
    if(cause!==undefined)pending.push(cause);
    const nested=read(item,'errors');
    if(Array.isArray(nested))for(const child of nested.slice(0,16))pending.push(child);
  }
  if(!facts.length)facts.push({name:'OtherError'});
  const codes=facts.map(item=>item.code);
  const category=codes.some(code=>TLS_CODES.has(code))?'TLS':
    codes.some(code=>TIMEOUT_CODES.has(code)) || facts.some(item=>item.name==='TimeoutError')?'TIMEOUT':
    codes.some(code=>NETWORK_CODES.has(code))?'NETWORK':
    facts.some(item=>item.httpStatus>=400)?'HTTP':'SDK';
  return Object.freeze({category,facts:Object.freeze(facts.map(item=>Object.freeze(item))),
    truncated:pending.length>0});
}

function counters(value) {
  if(!object(value))return undefined;
  const entered=read(value,'entered'),returned=read(value,'returned'),failed=read(value,'failed');
  if(![entered,returned,failed].every(count) || returned+failed>entered)return undefined;
  return Object.freeze({entered,returned,failed});
}

/** Validate a diagnostic crossing the existing SF103 / SF88 / retained-wire boundary. */
export function readNativeSigningDiagnostic(value) {
  try {
    if(!object(value))return undefined;
    const schema=read(value,'schema'),engine=read(value,'engine'),sdkVersion=read(value,'sdkVersion'),
      state=read(value,'status'),phase=read(value,'phase'),payloadReturned=read(value,'payloadReturned');
    if(schema!==NATIVE_SIGNING_DIAGNOSTIC_SCHEMA || engine!=='ORIGINAL_X402_STELLAR' ||
      sdkVersion!==VERSION || !['NOT_STARTED','RUNNING','FAILED','COMPLETE'].includes(state) ||
      !PHASES.has(phase) || typeof payloadReturned!=='boolean')return undefined;
    const authorization=counters(read(value,'authorization')),transaction=counters(read(value,'transaction'));
    if(!authorization || !transaction)return undefined;
    const output={schema:NATIVE_SIGNING_DIAGNOSTIC_SCHEMA,engine:'ORIGINAL_X402_STELLAR',
      sdkVersion:VERSION,status:state,phase,authorization,transaction,payloadReturned};
    const failure=read(value,'failure');
    if(failure!==undefined) {
      if(!object(failure))return undefined;
      const category=read(failure,'category'),rawFacts=read(failure,'facts'),truncated=read(failure,'truncated');
      if(!CATEGORIES.has(category) || !Array.isArray(rawFacts) ||
        rawFacts.length<1 || rawFacts.length>16 || typeof truncated!=='boolean')return undefined;
      const facts=[];
      for(let i=0;i<rawFacts.length;i++) {
        const item=read(rawFacts,i);
        if(!object(item))return undefined;
        const name=read(item,'name'),code=read(item,'code'),httpStatus=read(item,'httpStatus'),
          reason=read(item,'reason');
        if((!NAMES.has(name) && name!=='OtherError') ||
          (code!==undefined && !ALL_CODES.has(code)) ||
          (httpStatus!==undefined && status(httpStatus)===undefined) ||
          (reason!==undefined && !REASONS.has(reason)))return undefined;
        facts.push(Object.freeze({name,...(code!==undefined?{code}:{}),
          ...(httpStatus!==undefined?{httpStatus}:{}),...(reason!==undefined?{reason}:{})}));
      }
      output.failure=Object.freeze({category,facts:Object.freeze(facts),truncated});
    }
    return Object.freeze(output);
  } catch { return undefined; }
}

/**
 * Observes only actual calls to the original signer. These counts never authorize
 * retry, release or settlement; the original reservation and chain reader own those decisions.
 */
export function createNativeSigningTracker() {
  const value={schema:NATIVE_SIGNING_DIAGNOSTIC_SCHEMA,engine:'ORIGINAL_X402_STELLAR',
    sdkVersion:VERSION,status:'NOT_STARTED',phase:'NOT_STARTED',
    authorization:{entered:0,returned:0,failed:0},transaction:{entered:0,returned:0,failed:0},
    payloadReturned:false};
  const snapshot=()=>readNativeSigningDiagnostic(value);
  return Object.freeze({
    snapshot,
    start(){value.status='RUNNING';value.phase='PAYLOAD_CREATION';},
    returned(){value.payloadReturned=true;value.phase='PAYLOAD_VALIDATION';},
    complete(){value.status='COMPLETE';value.phase='COMPLETE';return snapshot();},
    failed(error){
      value.status='FAILED';
      if(value.payloadReturned)value.phase='PAYLOAD_VALIDATION';
      else if(!['AUTHORIZATION_SIGNING','TRANSACTION_SIGNING'].includes(value.phase))
        value.phase='PAYLOAD_CREATION';
      value.failure=nativeFailureFacts(error);
      return snapshot();
    },
    wrap(kind,invoke) {
      if(!['authorization','transaction'].includes(kind) || typeof invoke!=='function')
        throw new TypeError('NATIVE_SIGNER_DIAGNOSTIC_WRAPPER_INVALID');
      const phase=kind==='authorization'?'AUTHORIZATION_SIGNING':'TRANSACTION_SIGNING';
      return async (...args)=>{
        const entry=value[kind];
        entry.entered++;value.phase=phase;
        try {
          const result=await invoke(...args);
          entry.returned++;value.phase='PAYLOAD_CREATION';
          return result;
        } catch(error) {
          entry.failed++;value.phase=phase;
          throw error;
        }
      };
    },
  });
}
