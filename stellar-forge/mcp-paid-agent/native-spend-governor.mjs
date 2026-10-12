/** MIT. Native MCP purchases through the original durable SF36 spending ledger. */
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual as same} from 'node:util';
import {mcpJson, validateMcpInvocation, requireMcpChallenge} from './remote-mcp.mjs';
import {createNativeMcpOperator, createTerminalMcpApproval} from './native-mcp-operator.mjs';

const SCHEMA = 'stellar-forge.mcp-spending.v1';
const HELPER = fileURLToPath(new URL('./native-spend-governor.py', import.meta.url));
const KEYS = ['SF36_CONSENT_KEY_B64', 'SF36_AUDIT_KEY_B64', 'SF36_OPERATOR_KEY_B64'];
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const ID = /^[A-Za-z0-9._:-]{1,160}$/;
const HASH = /^[a-f0-9]{64}$/;
const digest = value => createHash('sha256').update(value).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(code, reason) {
  const error = Object.assign(new Error(code), {code});
  if (reason !== undefined) error.operatorReason = String(reason).slice(0,256);
  throw error;
}
function quoteId(value) {
  if (typeof value !== 'string' || !UUID.test(value)) fail('MCP_SPENDING_QUOTE_REQUIRED');
  return value;
}

/**
 * Bind the complete logical MCP operation. These body bytes describe the
 * approved invocation, not the SDK's JSON-RPC envelope or dynamic session ID.
 * The original native operator separately binds the actual signed MCP resource.
 */
export function mcpSpendingBinding(quote, {actor, service, payer} = {}) {
  quoteId(quote?.quoteId);
  if (!ID.test(actor ?? '') || !ID.test(service ?? '') ||
      typeof payer !== 'string' || !/^[GC][A-Z2-7]{55}$/.test(payer) ||
      quote.method !== 'tools/call') fail('MCP_SPENDING_BINDING_INVALID');
  const invocation = validateMcpInvocation(quote.invocation);
  if (quote.requestUrl !== invocation.endpoint) fail('MCP_SPENDING_ENDPOINT_MISMATCH');
  const accepted = quote.accepted;
  if (!plain(accepted) || accepted.scheme !== 'exact' ||
      !['stellar:testnet','stellar:pubnet'].includes(accepted.network) ||
      typeof accepted.amount !== 'string' || !/^[1-9][0-9]{0,18}$/.test(accepted.amount) ||
      BigInt(accepted.amount) > 9223372036854775807n ||
      !Number.isInteger(accepted.maxTimeoutSeconds) ||
      accepted.maxTimeoutSeconds < 1 || accepted.maxTimeoutSeconds > 86400)
    fail('MCP_SPENDING_TERMS_INVALID');
  const invocationJson = mcpJson({
    endpoint:invocation.endpoint, transport:invocation.transport,
    toolName:invocation.toolName, paymentResourceUrl:invocation.paymentResourceUrl,
    arguments:invocation.arguments, inputSchemaSha256:invocation.inputSchemaSha256,
  }, 128 * 1024);
  const acceptedJson = mcpJson(accepted, 128 * 1024);
  const request = {
    request_id:quote.quoteId, actor, service, network:accepted.network,
    asset:accepted.asset, scheme:accepted.scheme, max_amount:accepted.amount,
    resource:invocation.endpoint, pay_to:accepted.payTo,
    max_timeout_seconds:accepted.maxTimeoutSeconds, method:'POST',
    body_present:true, body_bytes:Buffer.byteLength(invocationJson),
    body_sha256:digest(invocationJson), accepted_terms_sha256:digest(acceptedJson),
  };
  return {quoteId:quote.quoteId, payer, invocationJson, acceptedJson, request};
}

/** Privileged host adapter. Credentials travel only in the isolated child environment. */
export function createMcpSpendingClient({python, actor, service, policy, ledger,
  stateDirectory, environment = process.env, timeoutMs = 30000} = {}) {
  for (const path of [python, policy, ledger, stateDirectory])
    if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0'))
      throw new TypeError('Configure absolute Python, policy, ledger and spending state paths.');
  if (!ID.test(actor ?? '') || !ID.test(service ?? ''))
    throw new TypeError('Configure the existing operator actor and service IDs.');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 300000)
    throw new TypeError('Spending helper timeout must be 100..300000 milliseconds.');
  const env = {LANG:'C.UTF-8', LC_ALL:'C.UTF-8'};
  for (const name of KEYS) {
    const value = environment[name];
    if (typeof value !== 'string' || !value || value.length > 4096)
      throw new TypeError('Configure the existing SF36 operator keys on the buyer host.');
    env[name] = value;
  }
  const args = ['-I','-B','-u',HELPER,'--actor',actor,'--service',service,
    '--policy',policy,'--ledger',ledger,'--state-directory',stateDirectory];
  const pending = new Set();
  const shutdown = new AbortController();
  let closed = false;
  function call(input, {signal} = {}) {
    if (closed) fail('MCP_SPENDING_CLIENT_CLOSED');
    if (signal !== undefined && !(signal instanceof AbortSignal))
      throw new TypeError('signal must be an AbortSignal.');
    const id = quoteId(input.binding?.quoteId ?? input.quoteId);
    const raw = Buffer.from(JSON.stringify(input));
    if (raw.length > 512 * 1024) fail('MCP_SPENDING_INPUT_TOO_LARGE');
    const lifetime = AbortSignal.any([shutdown.signal, ...(signal ? [signal] : [])]);
    lifetime.throwIfAborted();
    const operation = new Promise((resolve, reject) => {
      let child, timer, killTimer, stopped, done = false, bytes = 0;
      const chunks = [];
      const failure = code => Object.assign(new Error(code), {
        code, quoteId:id, reservationState:'INSPECT_ORIGINAL_SF36_LEDGER',
      });
      const finish = (error, value) => {
        if (done) return;
        done = true; clearTimeout(timer); clearTimeout(killTimer);
        lifetime.removeEventListener('abort', abort);
        error ? reject(error) : resolve(value);
      };
      const stop = code => {
        if (done) return;
        stopped ??= failure(code);
        if (child && child.exitCode === null && child.signalCode === null) {
          child.kill('SIGTERM');
          killTimer ??= setTimeout(() => child.kill('SIGKILL'), 1000);
          killTimer.unref();
        }
      };
      const abort = () => stop('MCP_SPENDING_ABORTED');
      try {
        child = spawn(python,args,{env,shell:false,windowsHide:true,stdio:['pipe','pipe','ignore']});
      } catch { finish(failure('MCP_SPENDING_START_FAILED')); return; }
      child.once('error', () => finish(failure('MCP_SPENDING_START_FAILED')));
      child.stdout.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 1024 * 1024) { stop('MCP_SPENDING_RESULT_TOO_LARGE'); return; }
        chunks.push(chunk);
      });
      child.stdin.on('error', () => stop('MCP_SPENDING_INPUT_FAILED'));
      child.once('close', (code, childSignal) => {
        if (stopped) { finish(stopped); return; }
        let result;
        try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch { finish(failure('MCP_SPENDING_INVALID_RESULT')); return; }
        if (code !== 0 || childSignal || result?.outcome === 'ERROR') {
          const error = failure('MCP_SPENDING_REJECTED');
          if (typeof result?.reason === 'string') error.operatorReason = result.reason.slice(0,256);
          finish(error); return;
        }
        if (result?.schema !== SCHEMA || result.request_id !== id ||
            typeof result.outcome !== 'string' ||
            (result.request_sha256 !== undefined && !HASH.test(result.request_sha256))) {
          finish(failure('MCP_SPENDING_RESULT_MISMATCH')); return;
        }
        if (input.binding && result.request_sha256 !== digest(mcpJson(input.binding.request))) {
          finish(failure('MCP_SPENDING_REQUEST_MISMATCH')); return;
        }
        finish(null, result);
      });
      timer = setTimeout(() => stop('MCP_SPENDING_TIMEOUT'), timeoutMs);
      lifetime.addEventListener('abort', abort, {once:true});
      if (lifetime.aborted) abort();
      child.stdin.end(raw);
    });
    pending.add(operation);
    operation.then(() => pending.delete(operation), () => pending.delete(operation));
    return operation;
  }
  return Object.freeze({
    actor, service,
    estimate:(binding, options) => call({action:'estimate',binding},options),
    reserve:(binding, options) => call({action:'reserve',binding},options),
    status:(id, options) => call({action:'status',quoteId:quoteId(id)},options),
    finalize:(id, proof, options) => call({action:'finalize',quoteId:quoteId(id),proof},options),
    async close() {
      if (!closed) { closed = true; shutdown.abort(); }
      await Promise.allSettled([...pending]);
    },
  });
}

/** Keep the original signer, transport and reconciliation while budgeting each signed call. */
export async function createGovernedNativeMcpOperator({spending,
  approveQuote = createTerminalMcpApproval(), ...nativeOptions} = {}) {
  if (!plain(spending) || typeof approveQuote !== 'function')
    throw new TypeError('Configure the existing SF36 spending host and an operator approval callback.');
  const client = createMcpSpendingClient(spending);
  const approvals = new Map();
  let closed = false, closing;
  const bind = quote => mcpSpendingBinding(quote, {...spending,payer:nativeOptions.payer});
  let native;
  try {
    native = await createNativeMcpOperator({...nativeOptions, approveQuote:async quote => {
      const entry = approvals.get(quote.quoteId);
      const binding = bind({...quote,method:'tools/call'});
      if (!entry || !same(entry.binding,binding)) fail('MCP_SPENDING_APPROVAL_MISMATCH');
      const report = await client.estimate(binding,{signal:quote.signal});
      if (report.estimate?.approved !== true)
        fail('MCP_SPENDING_BUDGET_EXCEEDED',report.estimate?.denied_by?.join(','));
      const permission = await approveQuote(Object.freeze({...quote,
        limits:{...structuredClone(quote.limits),aggregate:structuredClone(report.estimate)}}));
      quote.signal?.throwIfAborted();
      return permission === true;
    }});
  } catch (error) { await client.close(); throw error; }

  return Object.freeze({
    readiness:Object.freeze({...native.readiness,aggregateSpending:{
      provider:'ORIGINAL_SF36',actor:client.actor,service:client.service,
      reservationPoint:'LIVE_CHALLENGE_BEFORE_NATIVE_SIGNING',
    }}),
    async approve(quote) {
      if (closed) fail('MCP_SPENDING_OPERATOR_CLOSED');
      const binding = bind(quote);
      if (approvals.has(quote.quoteId)) fail('MCP_SPENDING_APPROVAL_ALREADY_USED');
      const entry = {binding,state:'APPROVAL_PENDING'};
      approvals.set(quote.quoteId,entry);
      try {
        const permission = await native.approve(quote);
        if (closed) fail('MCP_SPENDING_OPERATOR_CLOSED');
        if (permission !== true) { approvals.delete(quote.quoteId); return false; }
        entry.state = 'APPROVED'; return true;
      } catch (error) {
        if (entry.state === 'APPROVAL_PENDING') approvals.delete(quote.quoteId);
        throw error;
      }
    },
    async signPayment(input) {
      if (closed) fail('MCP_SPENDING_OPERATOR_CLOSED');
      input?.signal?.throwIfAborted();
      const binding = bind(input);
      const entry = approvals.get(input.quoteId);
      if (!entry || entry.state !== 'APPROVED' || !same(entry.binding,binding))
        fail('MCP_SPENDING_APPROVAL_MISMATCH');
      requireMcpChallenge(input.paymentRequired,input.invocation,input.accepted);
      if (!same(input.resource,input.paymentRequired.resource)) fail('MCP_SPENDING_RESOURCE_MISMATCH');
      // Consume local approval before yielding. SQLite controls concurrent
      // processes, including a replacement operator after a lost response.
      entry.state = 'RESERVING';
      const reservation = await client.reserve(binding,{signal:input.signal});
      entry.reservation = reservation;
      if (reservation.outcome !== 'RESERVED') {
        entry.state = 'EXISTING_RESERVATION';
        fail('MCP_SPENDING_EXISTING_RESERVATION');
      }
      entry.state = 'RESERVED';
      input.signal?.throwIfAborted();
      try {
        const payload = await native.signPayment(input);
        entry.state = 'SIGNED';
        return payload;
      } catch (error) {
        if (error && typeof error === 'object' && Object.isExtensible(error))
          error.operatorReservation = reservation;
        throw error;
      }
    },
    async spendingStatus(id, options = {}) {
      let result = await client.status(id,options);
      if (result.outcome === 'NOT_RESERVED' && options.quote?.invocation) {
        if (options.quote.quoteId !== id) fail('MCP_SPENDING_QUOTE_MISMATCH');
        const previewBinding = bind(options.quote);
        const preview = await client.estimate(previewBinding,{signal:options.signal});
        result = {...result,request_sha256:preview.request_sha256,
          estimate:preview.estimate,binding:previewBinding};
      }
      const {binding,...status} = result;
      if (!binding) return status;
      if (binding.payer !== nativeOptions.payer) fail('MCP_SPENDING_PAYER_MISMATCH');
      const invocation = JSON.parse(binding.invocationJson);
      return {...status,operation:{endpoint:invocation.endpoint,toolName:invocation.toolName,
        paymentResourceUrl:invocation.paymentResourceUrl,transport:invocation.transport,
        invocationSha256:binding.request.body_sha256}};
    },
    async reconcilePayment(input) {
      if (closed) fail('MCP_SPENDING_OPERATOR_CLOSED');
      const retained = await client.status(input?.quoteId,{signal:input?.signal});
      if (retained.binding) {
        if (retained.binding.payer !== nativeOptions.payer ||
            !same(JSON.parse(retained.binding.acceptedJson),input.accepted))
          fail('MCP_SPENDING_RECONCILIATION_MISMATCH');
      }
      const observation = await native.reconcilePayment(input);
      if (retained.outcome === 'NOT_RESERVED')
        return {...observation,spending:{schema:SCHEMA,outcome:'NOT_RESERVED',request_id:input.quoteId}};
      if (!retained.binding) fail('MCP_SPENDING_ORIGINAL_BINDING_REQUIRED');
      if (observation.outcome !== 'TRANSFER_MATCHED')
        return {...observation,spending:{schema:SCHEMA,outcome:'RESERVATION_RETAINED',
          request_id:input.quoteId,request_sha256:retained.request_sha256,
          reservation:retained.reservation}};
      try {
        const {binding:privateBinding,...spendingResult} = await client.finalize(
          input.quoteId,observation,{signal:input.signal});
        return {...observation,spending:spendingResult};
      } catch (error) {
        // Keep the original chain observation useful if local ledger I/O fails.
        // The retained reservation remains authoritative until finalization succeeds.
        return {...observation,spending:{schema:SCHEMA,outcome:'FINALIZATION_REQUIRED',
          request_id:input.quoteId,request_sha256:retained.request_sha256,
          error:error?.code ?? 'MCP_SPENDING_FINALIZATION_FAILED',
          reservation:retained.reservation}};
      }
    },
    close() {
      if (closing) return closing;
      closed = true; native.close(); approvals.clear();
      closing = client.close(); return closing;
    },
  });
}
