/** MIT. Bind SF32's approved MCP quote to the original SF103 Stellar signer. */
import { isDeepStrictEqual as same } from 'node:util';
import { open } from 'node:fs/promises';
import { createReadStream, createWriteStream, constants } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { createNativeBuyerSigner, loadNativeSdk } from
  '../../stellar/scf-starforge-20261009/sf103-native-buyer-signer/adapter.mjs';
import { validateMcpInvocation, requireMcpChallenge } from './remote-mcp.mjs';

const fail = code => { throw Object.assign(new Error(code), {code}); };
const atomic = value => typeof value === 'string' && /^[1-9][0-9]{0,38}$/.test(value) &&
  BigInt(value) <= 170141183460469231731687303715884105727n;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
let terminalBusy = false;

/** Optional local operator UI. It reads the controlling terminal, never MCP/stdin. */
export function createTerminalMcpApproval() {
  return async quote => {
    if (terminalBusy) fail('MCP_OPERATOR_TERMINAL_BUSY');
    terminalBusy = true;
    let terminal, input, output, lines;
    try {
      quote.signal?.throwIfAborted();
      terminal = await open('/dev/tty', constants.O_RDWR | (constants.O_NOCTTY ?? 0));
      if (!(await terminal.stat()).isCharacterDevice()) fail('MCP_OPERATOR_TERMINAL_REQUIRED');
      input = createReadStream('/dev/tty', {fd:terminal.fd, autoClose:false});
      output = createWriteStream('/dev/tty', {fd:terminal.fd, autoClose:false});
      lines = createInterface({input, output, terminal:true});
      output.write('\nRemote paid MCP request\n' + JSON.stringify({quoteId:quote.quoteId,
        endpoint:quote.requestUrl, invocation:quote.invocation, payment:quote.accepted,
        limits:quote.limits}, null, 2) + '\n');
      const answer = await lines.question(`Type APPROVE ${quote.quoteId} to authorize this exact call: `,
        quote.signal ? {signal:quote.signal} : {});
      return answer === `APPROVE ${quote.quoteId}`;
    } finally {
      lines?.close(); input?.destroy(); output?.destroy();
      await terminal?.close().catch(() => {}); terminalBusy = false;
    }
  };
}

/**
 * All constructor inputs belong to trusted host code. approveQuote receives the
 * complete invocation and must independently authorize/reserve its spend. This
 * adapter does not replace an operator's aggregate budget or reconciliation.
 */
export async function createNativeMcpOperator({ payer, signer, rpcUrl, limits,
  approveQuote = () => false, sdk } = {}) {
  if (typeof payer !== 'string' || !/^[GC][A-Z2-7]{55}$/.test(payer) || !plain(signer) ||
      signer.address !== payer || typeof signer.signAuthEntry !== 'function' ||
      typeof approveQuote !== 'function' || !plain(limits)) fail('MCP_NATIVE_OPERATOR_INVALID');
  const fixed = structuredClone(limits);
  if (Object.keys(fixed).some(key => !['network','asset','payTo','maxAtomic','maxTimeoutSeconds'].includes(key)) ||
      !['stellar:testnet', 'stellar:pubnet'].includes(fixed.network) ||
      ![fixed.asset, fixed.payTo].every(value => typeof value === 'string' && value.length > 0) ||
      !atomic(fixed.maxAtomic) || !Number.isInteger(fixed.maxTimeoutSeconds) ||
      fixed.maxTimeoutSeconds < 1 || fixed.maxTimeoutSeconds > 86400) fail('MCP_NATIVE_LIMITS_INVALID');
  sdk ??= await loadNativeSdk();
  const approved = new Map();
  let closed = false;
  function binding(quote) {
    if (closed) fail('MCP_NATIVE_OPERATOR_CLOSED');
    if (typeof quote?.quoteId !== 'string' || !/^[a-f0-9-]{36}$/.test(quote.quoteId) ||
        quote.method !== 'tools/call') fail('MCP_NATIVE_QUOTE_REQUIRED');
    const invocation = structuredClone(validateMcpInvocation(quote.invocation));
    const accepted = structuredClone(quote.accepted);
    if (quote.requestUrl !== invocation.endpoint || accepted?.scheme !== 'exact' ||
        accepted.network !== fixed.network || accepted.asset !== fixed.asset || accepted.payTo !== fixed.payTo ||
        !atomic(accepted.amount) || BigInt(accepted.amount) > BigInt(fixed.maxAtomic) ||
        !Number.isInteger(accepted.maxTimeoutSeconds) || accepted.maxTimeoutSeconds < 1 ||
        accepted.maxTimeoutSeconds > fixed.maxTimeoutSeconds || accepted.extra?.areFeesSponsored !== true ||
        (accepted.extra?.paymentFlow ?? 'authorization') !== 'authorization') fail('MCP_NATIVE_QUOTE_OUTSIDE_LIMITS');
    const intent = {
      intentId:quote.quoteId, url:invocation.paymentResourceUrl, method:'tools/call',
      scheme:accepted.scheme, network:accepted.network, amount:accepted.amount, asset:accepted.asset,
      payTo:accepted.payTo, maxAtomic:fixed.maxAtomic, maxTimeoutSeconds:accepted.maxTimeoutSeconds,
      acceptedTerms:accepted, bodyPresent:true, bodyBytes:invocation.argumentsBytes,
      bodySha256:invocation.argumentsSha256,
    };
    const expected = {payer, operation:{intentId:intent.intentId, url:intent.url, method:intent.method,
      expect:{scheme:'exact', network:fixed.network, asset:fixed.asset, payTo:fixed.payTo,
        maxAtomic:fixed.maxAtomic, maxTimeoutSeconds:fixed.maxTimeoutSeconds}},
      body:{present:true, bytes:intent.bodyBytes, sha256:intent.bodySha256}};
    return {invocation, accepted, intent, expected};
  }
  return Object.freeze({
    readiness:Object.freeze({provider:'ORIGINAL_X402_STELLAR', payer, network:fixed.network,
      asset:fixed.asset, payTo:fixed.payTo, maxAtomic:fixed.maxAtomic, sdkVersions:sdk.versions}),
    async approve(quote) {
      quote?.signal?.throwIfAborted();
      const checked = binding(quote);
      if (approved.has(quote.quoteId)) fail('MCP_NATIVE_APPROVAL_ALREADY_USED');
      if (approved.size >= 10000) fail('MCP_NATIVE_OPERATOR_CAPACITY');
      const permission = await approveQuote(Object.freeze({quoteId:quote.quoteId, requestUrl:quote.requestUrl,
        invocation:structuredClone(checked.invocation), accepted:structuredClone(checked.accepted),
        nativeIntent:structuredClone(checked.intent), limits:structuredClone(fixed), signal:quote.signal}));
      quote?.signal?.throwIfAborted();
      if (closed) fail('MCP_NATIVE_OPERATOR_CLOSED');
      if (permission !== true) return false;
      approved.set(quote.quoteId, {...checked, attempted:false});
      return true;
    },
    async signPayment(input) {
      input?.signal?.throwIfAborted();
      const checked = binding(input);
      const prior = approved.get(input.quoteId);
      if (!prior || prior.attempted || !same(prior.invocation, checked.invocation) ||
          !same(prior.accepted, checked.accepted) || !same(prior.intent, checked.intent))
        fail('MCP_NATIVE_APPROVAL_MISMATCH');
      requireMcpChallenge(input.paymentRequired, checked.invocation, checked.accepted);
      if (!same(input.resource, input.paymentRequired.resource)) fail('MCP_NATIVE_RESOURCE_MISMATCH');
      prior.attempted = true;
      const native = await createNativeBuyerSigner({signer, expected:prior.expected, rpcUrl, sdk});
      input?.signal?.throwIfAborted();
      const payload = await native.sign({intent:prior.intent, challenge:input.paymentRequired, accepted:prior.accepted});
      input?.signal?.throwIfAborted();
      return payload;
    },
    close() { closed = true; approved.clear(); },
  });
}
