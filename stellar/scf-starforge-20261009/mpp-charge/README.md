# Native Stellar MPP Charge

This module adds a native Machine Payments Protocol merchant and governed buyer to the maintained Starforge toolkit. The merchant emits the official SDK's Stellar charge challenge, settles an approved pull credential, and retains the paid response. The buyer captures the real challenge, obtains one reservation from the existing SF36 spending governor through the local operator terminal, signs once, retrieves the resource, and reconciles the transfer through the original SF86 Stellar observer.

The private operator workspace includes merchant configuration, editable routes, buyer terms and limits, purchase history, delivery recovery, independent reconciliation, and exact response downloads. It uses a plain monochrome industrial layout.

## Install the published runtime

Use Node 22.16 or later, Linux with flock, and Python 3.11 or later for the spending governor.

The exact published peer set is:

| Package | Version |
| --- | --- |
| @stellar/mpp | 0.7.1 |
| mppx | 0.6.29 |
| @stellar/stellar-sdk | 15.1.0 |

The released Stellar MPP package declares the older SDK peer range. Install this set in its own dependency directory. The existing x402 runtime uses Stellar SDK 16 and keeps its own selected dependencies.

From the repository root:

~~~sh
node stellar/scf-starforge-20261009/mpp-charge/cli.mjs runtime-template /private/mpp-dependencies
npm --prefix /private/mpp-dependencies ci --ignore-scripts --omit=dev --no-audit --no-fund
node stellar/scf-starforge-20261009/mpp-charge/cli.mjs init /private/mpp-workspace
~~~

The caller provides the existing private parent directory. The runtime template copies the exact manifest and lockfile into a new directory; npm ci installs that dependency graph. Workspace initialization creates its own private directory and preserves an existing workspace. The native loader checks all three installed versions before enabling a merchant or purchase.

The maintained package includes command **starforge mpp** and API export **@tokenjunkielabs/starforge-merchant/mpp**. Replace the source CLI path with `starforge mpp` for all commands below.

## Operate the workspace

~~~sh
node stellar/scf-starforge-20261009/mpp-charge/cli.mjs serve /private/mpp-workspace 8787
~~~

Open the private URL printed by the command. The session token stays in the URL fragment and browser session storage. The server listens only on 127.0.0.1 and checks the exact host, authorization token, and same origin on operator requests. The public merchant runs on a separate loopback listener behind the operator's HTTPS reverse proxy.

In **Merchant**, enter the public HTTPS origin, named HMAC secret, dependency directory, and payment routes. Start the listener after saving the configuration. In **Buyer**, enter the exact resource, merchant realm, network, token, recipient, payer, governor paths, and token/network-fee limits. Save a unique purchase ID, then use **Prepare configured purchase**.

Prepare makes one unpaid HTTP request and retains the actual native challenge. Execute presents its complete terms and current budget estimate in the terminal that launched the workspace. The operator types the exact displayed approval phrase. The private browser shows the operation while the terminal owns consent.

A new purchase ID represents a new spend decision. Existing IDs keep their original configuration and challenge even when the editor changes.

## Merchant configuration

A configuration file has this shape. Replace the illustrative address and host fields with the actual approved Stellar contract, recipient, and deployed HTTPS origin.

~~~json
{
  "title": "Research data",
  "publicOrigin": "https://api.example.com",
  "secretEnv": "MPP_SECRET_KEY",
  "dependencyRoot": "/private/mpp-dependencies",
  "lifetimeSeconds": 300,
  "routes": [
    {
      "id": "report",
      "method": "GET",
      "path": "/report",
      "description": "Latest reviewed research report",
      "payment": {
        "network": "stellar:testnet",
        "currency": "ACTUAL_STELLAR_TOKEN_CONTRACT",
        "recipient": "ACTUAL_MERCHANT_ACCOUNT",
        "amountAtomic": "100000",
        "decimals": 7
      },
      "resource": {
        "kind": "json-file",
        "path": "/private/reports/latest.json"
      }
    }
  ]
}
~~~

Load and operate it:

~~~sh
node stellar/scf-starforge-20261009/mpp-charge/cli.mjs profile /private/mpp-workspace merchant /private/merchant.json
node stellar/scf-starforge-20261009/mpp-charge/cli.mjs merchant /private/mpp-workspace 8788
~~~

MPP_SECRET_KEY is an existing environment variable containing at least 32 bytes of secret material. The configuration stores its variable name. The service uses the official SDK's unsponsored pull flow. A buyer signs its own transaction and network fee. The public origin must resolve to the configured HTTPS reverse proxy.

Routes support GET or POST and three resource types:

| Resource | Configuration | Behavior |
| --- | --- | --- |
| JSON value | `{"kind":"json","value":{...}}` | Returns the configured JSON |
| JSON file | `{"kind":"json-file","path":"/absolute/report.json"}` | Reads a stable regular file after settlement |
| Application handler | `{"kind":"handler","export":"report"}` | Calls an export from the configured absolute handlersModule |

A handler receives the same stable operation ID on explicit recovery:

~~~js
export async function report({operationId, request, payment, signal}) {
  const input = request.method === 'POST' ? await request.json() : {};
  const result = await application.report({
    idempotencyKey: operationId,
    input,
    signal
  });
  return Response.json(result);
}
~~~

Use that operation ID for any application-side writes. A process can fail after the application finishes and before the response file is committed; explicit recovery may call that handler again with the original ID. Completed responses replay their retained bytes without calling the handler again, including after a price or route edit on the same public origin. Recovery loads the delivery's retained original merchant profile and shares the same operation lock across merchant instances.

The merchant exposes public `/_mpp/health`, `/_mpp/offers`, `/_mpp/contract` and `/_mpp/openapi.json` read endpoints. Offers contain prices and route descriptions. The configured resource bodies remain behind payment.

## Buyer configuration

~~~json
{
  "intentId": "research-report-001",
  "request": {
    "url": "https://api.example.com/report",
    "method": "GET"
  },
  "expect": {
    "realm": "api.example.com",
    "network": "stellar:testnet",
    "currency": "ACTUAL_STELLAR_TOKEN_CONTRACT",
    "recipient": "ACTUAL_MERCHANT_ACCOUNT",
    "maxAtomic": "100000",
    "decimals": 7,
    "maxFeeStroops": "100000"
  },
  "signer": {
    "payer": "ACTUAL_PAYER_ACCOUNT",
    "keyEnv": "STELLAR_BUYER_SECRET"
  },
  "operator": {
    "python": "/usr/bin/python3",
    "ledger": "/private/operator/spend.db",
    "policy": "/private/operator/policy.json",
    "actor": "operator",
    "service": "research"
  },
  "dependencyRoot": "/private/mpp-dependencies"
}
~~~

For POST, add the exact JSON value under request.json. The request method, full URL including query, body presence, byte length, and SHA-256 digest are retained with the original challenge. The buyer uses SF31's pinned public DNS/TLS transport and sends only the explicitly reviewed Payment credential. Redirects and implicit proxy discovery remain disabled.

A configured explicit CONNECT proxy uses the existing transport shape:

~~~json
{
  "transport": {
    "mode": "explicit-connect",
    "origin": "https://api.example.com",
    "proxyEnv": "APPROVED_CONNECT_PROXY"
  }
}
~~~

The host supplies STELLAR_BUYER_SECRET and the existing SF36_CONSENT_KEY_B64, SF36_AUDIT_KEY_B64, and SF36_OPERATOR_KEY_B64 values. Keep the existing governor ledger and policy together with their keys. This module opens the existing ledger and does not create a replacement budget.

The complete native MPP challenge and the fee limit are bound into the governor's accepted-terms digest. The governor's `scheme:"exact"` describes exact-amount accounting; the original MPP wire challenge stays intact.

~~~sh
node stellar/scf-starforge-20261009/mpp-charge/cli.mjs profile /private/mpp-workspace buyer /private/buyer.json
node stellar/scf-starforge-20261009/mpp-charge/cli.mjs prepare /private/mpp-workspace
node stellar/scf-starforge-20261009/mpp-charge/cli.mjs execute /private/mpp-workspace research-report-001
node stellar/scf-starforge-20261009/mpp-charge/cli.mjs inspect /private/mpp-workspace research-report-001
~~~

The token amount uses canonical integer base-unit strings throughout. The SDK receives an exact decimal string derived without floating point. Before any credential is sent, the buyer verifies the native signed transaction's payer, transaction hash, and maximum fee. This first native lane accepts unsponsored transaction credentials on the configured Stellar network.

## Recovery and accounting

| Retained state | Available operation |
| --- | --- |
| Review ready | Execute after exact terminal approval |
| Reservation written before process interruption | Inspect the original governor row and continue the same purchase |
| Signed credential saved | Resume sends those exact saved credential and request bytes |
| Response saved | Download or export its retained bytes and hash |
| Transfer observation pending | Reconcile the original transaction independently |
| Merchant payment settled, resource failed | Recover delivery using the retained payment |
| Merchant broadcast or response interrupted | Recover the original native claim and transaction, then deliver |
| Merchant response complete | Replay its retained response |

~~~sh
node stellar/scf-starforge-20261009/mpp-charge/cli.mjs resume /private/mpp-workspace research-report-001
node stellar/scf-starforge-20261009/mpp-charge/cli.mjs finalize /private/mpp-workspace research-report-001
node stellar/scf-starforge-20261009/mpp-charge/cli.mjs recover-delivery /private/mpp-workspace DELIVERY_ID
node stellar/scf-starforge-20261009/mpp-charge/cli.mjs export /private/mpp-workspace purchases research-report-001 /private/output/report.json
~~~

Export creates a new private file in an existing private directory. The response retains its original HTTP status separately from its payment receipt and finality report. Read that status when deciding whether the requested application result is ready.

The merchant's native store implements linearizable update under a process-lifetime flock lease and uses atomic, fsynced record replacement. A per-call async context places the delivery ID inside each native challenge/hash claim at the same atomic update. Recovery requires both claims to belong to the selected delivery and requires the original SF86 observer to match the exact network, token, payer, recipient, amount, and transaction before issuing its recovered receipt.

Independent buyer finality reuses the original SF86 transfer parser and SF36 verified-facts checker, then invokes the original governor reconciliation. Its canonical receipt identity is network/transaction, preserving transaction reuse protection across existing payment rails. Timeouts and failed application responses preserve the original reservation while observation continues.

A workspace has one owner process. Use its browser interface while it is running; stop it before operating that same directory through a separate CLI process. Give independent merchants and buyer workers their own private workspace directories.

## API

~~~js
import {
  openWorkspace, createMerchant, preparePurchase, executePurchase,
  finalizePurchase, serveWorkspace, exportResponse
} from '@tokenjunkielabs/starforge-merchant/mpp';
~~~

The library accepts a private workspace and explicit configuration. loadNative resolves the isolated published dependency directory. It keeps global fetch, module resolution, and unrelated process credentials unchanged.

## Customer delivery

The **Customer handoff** tab publishes the selected merchant contract, OpenAPI 3.1 document and a complete Node/TypeScript/Python customer package. CLI export and interrupted receiving use `customer-export`, `customer-receive`, `customer-inspect` and `customer-resume`. Generated customers invoke this original governed buyer, retain exact requests and reopen the same signed purchase after interruption.

See [Native MPP customer delivery](customer/README.md) for installation, public endpoints, complete examples, original-contract recovery and the maintained `@tokenjunkielabs/starforge-merchant/mpp/customer` API.

## Original sources

- [Stellar MPP charge guide](https://developers.stellar.org/docs/build/agentic-payments/mpp/charge-guide)
- [Official Stellar MPP SDK](https://github.com/stellar/stellar-mpp-sdk)
- [Published @stellar/mpp 0.7.1](https://www.npmjs.com/package/@stellar/mpp/v/0.7.1)
- [mppx 0.6.29 server scope handling](https://github.com/wevm/mppx/blob/ef851e34fd32a46c2873fbea3de2318b66605f5d/src/server/Mppx.ts)
- [mppx 0.6.29 receipt API](https://github.com/wevm/mppx/blob/ef851e34fd32a46c2873fbea3de2318b66605f5d/src/Receipt.ts)

The published Stellar package integrity captured during integration is sha512-L0bwohQU4jKgm3yBFxvrhcYuroRITnUMGmr4N+aJY6q2GYY1bnhenFeTU5Bi0sxXP/5PIRA4ulRHPtqeZ8oTpA==.

Retained merchant profiles preserve their configured route values and file paths. For unfinished historical deliveries backed by `json-file` or `handlersModule`, keep versioned external files at those paths until recovery completes. Operator recovery and export use the saved profile even after the active merchant profile changes.

## Customer receiving and purchasing

The private console includes a **Customer workbench** for receiving merchant contracts and customer packages, configuring the payer and spending limits, preparing exact offer requests, operating the original approval and recovery flow, and downloading purchased resources. See the [workbench guide](./customer/workbench-guide.md) for its console, CLI and typed API interfaces.
