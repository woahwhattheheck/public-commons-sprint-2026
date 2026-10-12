// MIT. Operator-owned two-network x402 facilitator gateway, no signing secrets here.
import { makeFrontdoor } from './frontdoor.mjs';
const address = process.env.SF58_LISTEN_ADDRESS || '127.0.0.1';
const port = Number(process.env.SF58_PORT || '8788');
const isLocal = ['127.0.0.1', '::1', 'localhost'].includes(address);
const inboundToken = process.env.SF58_ACCESS_TOKEN || null;
if (!Number.isSafeInteger(port) || port < 1 || port > 65535) throw new Error('SF58_PORT must be 1..65535');
if (!isLocal && !inboundToken) throw new Error('Refusing publicly bound gateway without SF58_ACCESS_TOKEN');
const server = makeFrontdoor({
  upstreams: {
    'stellar:testnet': {origin: process.env.SF58_TESTNET_ORIGIN, bearer: process.env.SF58_TESTNET_BEARER || null},
    'stellar:pubnet': {origin: process.env.SF58_PUBNET_ORIGIN, bearer: process.env.SF58_PUBNET_BEARER || null}
  },
  inboundToken,
  bodyTimeoutMs: Number(process.env.SF58_BODY_TIMEOUT_MS || '8000'),
  timeoutMs: Number(process.env.SF58_UPSTREAM_TIMEOUT_MS || '12000'),
  // Local self-hosted backend sockets only. Never allows arbitrary external HTTP.
  allowLoopbackHttp: true
});
server.listen(port, address, () => {
  process.stdout.write(`SF58 local edge listening at ${address}:${port}; networks stellar:testnet and stellar:pubnet configured\n`);
});
