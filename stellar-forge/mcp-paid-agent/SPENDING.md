# Aggregate spending for native MCP purchases

The governed native operator connects remote paid MCP calls to the original SF36
SQLite budget ledger. The same five limits apply across concurrent buyers using
that ledger: one payment, lifetime total, UTC day, actor per UTC day, and service
per UTC day. Existing HTTP purchases and MCP purchases can share the original
ledger and policy.

The integration keeps the original SF103 Stellar signer, official MCP transport,
SF32 quote history and SF86 transaction observer. Install the pinned dependencies
from [REMOTE_MCP.md](REMOTE_MCP.md), with Node 22.13+ and Python 3.10+.

## Configure the existing buyer host

Keep the existing payer secret and the three original SF36 keys in the trusted
operator environment:

- The variable named by `signerSecretEnv`, normally `STELLAR_PAYER_SECRET`.
- `SF36_CONSENT_KEY_B64`, `SF36_AUDIT_KEY_B64`, `SF36_OPERATOR_KEY_B64`.

Reuse the original ledger and its keys. The host configuration contains public
payment terms, environment variable names and absolute private paths. Put the
configuration file in a directory owned by the operator with mode `0700`; make
the file mode `0600`. Replace every `YOUR_*` value below with the existing host
value:

~~~json
{
  "schema": "stellar-forge.mcp-spending-host.v1",
  "payer": "YOUR_EXISTING_PUBLIC_PAYER",
  "signerSecretEnv": "STELLAR_PAYER_SECRET",
  "rpcUrl": "https://soroban-testnet.stellar.org",
  "limits": {
    "network": "stellar:testnet",
    "asset": "YOUR_EXISTING_TOKEN_CONTRACT",
    "payTo": "YOUR_EXISTING_MERCHANT_ACCOUNT",
    "maxAtomic": "50000",
    "maxTimeoutSeconds": 60
  },
  "spending": {
    "python": "/usr/bin/python3",
    "actor": "buyer-agent",
    "service": "merchant-mcp-tools",
    "policy": "/absolute/private/original-policy.json",
    "ledger": "/absolute/private/original-governor.sqlite",
    "stateDirectory": "/absolute/private/mcp-spending",
    "timeoutMs": 30000
  }
}
~~~

The policy is the existing `stellar-spend-governor/v1` document with an `assets`
array. Each asset selects its Stellar network and token contract and supplies
canonical base unit strings for `max_single`, `max_total`, `max_per_utc_day`,
`max_per_actor_utc_day` and `max_per_service_utc_day`. Preserve the limits selected
by the operator. The actor and service identify which existing daily budgets
this buyer consumes.

The optional `reconciliationRpcUrl` and `reconciliationHttpsProxyEnv` select the
original observer's maintained Stellar endpoint and trusted host proxy setting.
The proxy field is an environment variable name. Public mainnet uses
`stellar:pubnet` and its original catalog endpoint.

Create the launcher module from the private configuration:

~~~sh
node stellar-forge/mcp-paid-agent/native-spend-workspace.mjs setup \
  /absolute/private/mcp-spending-config.json \
  /absolute/private/mcp-spending-operator.mjs
~~~

Setup creates the new private module with exclusive creation and durable writes.
An existing module is preserved. The generated module imports this installed
source location; regenerate it under a new filename when moving the installation.
Setup reads public configuration and creates no wallet, ledger reservation or
network request.

Use the original [HTTP or stdio workspace launcher](STDIO.md):

~~~sh
export MCP_OPERATOR_MODULE=/absolute/private/mcp-spending-operator.mjs
export MCP_STATE_DIR=/absolute/private/mcp-state
export BAZAAR_DISCOVERY_URL=https://YOUR_MERCHANT_HOST
export PAID_RESOURCE_ORIGINS=https://YOUR_MERCHANT_HOST
export MCP_PROVIDER_TIMEOUT_MS=120000
node stellar-forge/mcp-paid-agent/stdio.mjs
~~~

The HTTP launcher also uses its original `MCP_ACCESS_TOKEN`. Keep the quote store
under `MCP_STATE_DIR`, the spending binding directory, and the original SF36
ledger together through restarts and backup. The spending helper pins its actor,
service, policy path and ledger path. Once it has initialized that ledger, a
missing ledger produces an explicit error instead of resetting the budget.

## Review and execute one original quote

1. Discover and preview the original remote MCP tool. The quote contains its
   endpoint, transport, tool name, explicit arguments, schema digest, original
   payment resource and complete selected payment option.
2. Open **Spending ledger** in the buyer console, or call
   `bazaar_spending_status` with the quote ID. A new quote shows each available
   budget in base units. This capacity reading makes no reservation.
3. Request approval. The trusted terminal shows the same complete invocation
   and payment terms plus the current aggregate estimate. Type
   `APPROVE <quoteId>` to authorize that exact call.
4. The official SDK sends the original unsigned invocation. A free result
   finishes without a spending reservation.
5. A matching live payment challenge causes an atomic original SF36 reservation
   immediately before the original native signer runs. Concurrent buyers are
   admitted against the same audited SQLite ledger. Only a fresh `RESERVED`
   result authorizes signing.
6. The original broker dispatches at most one paid invocation. Its complete
   result and payment reference remain in the existing quote/result stores.

The terminal review and the atomic reservation are separate: another buyer may
consume capacity between them. The reservation rechecks all five limits before
signing. An exceeded limit leaves the quote's native payment unsigned.

A business application can keep its existing approval interaction:

~~~js
import {openMcpSpendingHost} from './native-spend-workspace.mjs';

const operator = await openMcpSpendingHost('/absolute/private/config.json', {
  approveQuote: async quote => existingApprovalUI.review(quote),
});
export const {approve, signPayment, spendingStatus, reconcilePayment, close} = operator;
~~~

For hosts that already construct the original SDK and signer, use
`createGovernedNativeMcpOperator({ ...nativeOptions, spending, approveQuote })`
from `native-spend-governor.mjs`. The installed package exports it at
`@tokenjunkielabs/starforge-merchant/buyer/mcp/governed-native-operator`.
`approveQuote` must return exactly `true` to approve.

## Restart, cancellation and finality

The helper retains the complete bound operation before modifying the original
ledger. A second process or replacement operator encountering that reservation
gets `IDEMPOTENT_EXISTING`; it cannot use that response to sign again. A timeout,
shutdown or lost helper response requires inspection of the original reservation.
Cancellation keeps any existing reservation charged.

`bazaar_spending_status` reads the original reservation and the same complete
request digest. The browser console exposes this operation and a JSON download.
A trusted host can inspect a known quote without starting a wallet or loading
the signing SDK:

~~~sh
node stellar-forge/mcp-paid-agent/native-spend-workspace.mjs status \
  /absolute/private/mcp-spending-config.json \
  ORIGINAL_QUOTE_UUID
~~~

Use the existing **Payment transaction** panel or `bazaar_reconcile_payment`
to inspect the original transaction reference. The governed adapter passes that
observation through original SF86 and then uses SF36's maintained
`verified_facts` and `reconcile` functions to finalize the reservation. The
endpoint, network passphrase, payer, payee, token, exact amount, quote ID,
transaction and one matching transfer must agree.

The immutable verified facts provide the finality digest. A later observation
of the same transfer returns `IDEMPOTENT_FINALIZED` even when the RPC's latest
ledger or response hash has changed. Original SF36 prevents assigning that
network receipt to a different quote. Unmatched or unavailable transfers keep
their reservations. If chain inspection succeeds while local finalization
fails, the quote retains the chain observation and shows
`FINALIZATION_REQUIRED`; the original recovery action can finish accounting.

## Boundaries inherited from the original components

The original SF36 policy accepts public HTTPS DNS endpoints and integer base
unit amounts up to `9223372036854775807`. Native MCP transport can support other
endpoints and larger amounts; this governed entrypoint follows the original
ledger's limits.

The budget request uses `POST` and the HTTPS endpoint as its endpoint identity.
Its body digest binds the complete canonical **logical MCP invocation**:
endpoint, transport, tool name, payment resource, arguments and input schema
digest. These bytes describe the approved operation. The official SDK owns the
dynamic JSON-RPC envelope and session framing. The original SF103 signer
independently binds the actual MCP resource and argument bytes.

JSON documents are hashed as their original JavaScript UTF-8 bytes before the
Python helper parses them, preserving Unicode and JSON number formatting.
Ledger amounts stay decimal strings throughout the buyer console and host APIs.
