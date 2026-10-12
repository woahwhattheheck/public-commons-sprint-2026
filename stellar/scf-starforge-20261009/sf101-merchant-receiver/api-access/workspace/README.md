# API passes customer workspace

This workspace brings purchased API allowances, exact requests, retained responses and original purchase controls into one local customer application. The merchant's existing order and allowance remain authoritative. The workspace keeps the customer-side records needed to resume work, recover a response and export readable history.

Open it from **Applications → API-pass customer**, or use the installed `starforge api-pass-workspace` command. The interface uses the same `ApiAccessClient`, `ApiAccessPurchase`, Buyer and Inbox as the maintained command-line workflows.

## Configure and open

Use a current installed merchant toolkit containing the `api-pass-workspace` command. Its native Buyer runtime and any existing accounting workspace keep their original source and configuration.

Create a private customer directory and a separate configuration file:

~~~sh
mkdir -m 700 /srv/starforge/api-customer
starforge api-pass-workspace configure \
  --directory /srv/starforge/api-customer \
  --out /srv/starforge/api-customer-config.json \
  --claim-env SF101_CLAIM_TOKEN
starforge api-pass-workspace serve \
  --config /srv/starforge/api-customer-config.json
~~~

Open the private startup URL. The application listens on IPv4 loopback. Port zero selects an available port; `serve --port 43120` selects a specific local port. The startup link supplies the workspace access key. **Lock** removes the current browser access session while keeping saved customer records.

The claim environment name identifies a credential already supplied by the host. Set that environment value through the original host configuration or the private Applications environment file. The browser asks for its name when connecting a pass; the host supplies its value to the original client.

To enable original purchase preparation and recovery, configure the existing Buyer workspace and the intended native runtime explicitly:

~~~sh
starforge api-pass-workspace configure \
  --directory /srv/starforge/api-customer-purchases \
  --out /srv/starforge/api-customer-purchases-config.json \
  --runtime /srv/starforge/runtime/source/stellar/scf-starforge-20261009/sf88-operator-buyer-cli \
  --buyer-workspace /srv/starforge/original-buyer-workspace \
  --buyer-state /srv/starforge/original-buyer-state \
  --inbox /srv/starforge/original-purchase-inbox \
  --python /usr/bin/python3 \
  --claim-env SF101_CLAIM_TOKEN
~~~

Use the actual retained paths from the selected installation and Buyer configuration. The customer directory must differ from those native authority directories. Configuration creation is exclusive: it produces a complete, normalized selection and does not overwrite an existing configuration. Existing customer state checks that selection whenever it reopens.

## Open purchased access

Choose **Connect a pass** and enter:

| Field | Value |
| --- | --- |
| Pass name | A useful label for the customer workspace |
| Gateway | The original HTTPS gateway origin, or its local development loopback origin |
| Order reference | The original merchant order reference |
| Purchased plan hash | The SHA-256 retained for that order's purchased plan |
| Claim environment | One of the environment names allowed by this host's customer configuration |

Refresh the allowance. The original client authenticates the order, purchased plan and route contract, then returns purchased, consumed, reserved and remaining units. The route list includes the merchant's actual methods, paths and unit costs.

An existing pass can be renamed or archived from its workspace settings. Archiving keeps its requests, results and history and removes it from new task dispatch until it is made active again.

If the full original purchase directory is available, choose **Open saved purchase** instead. The workspace opens that existing `ApiAccessPurchase`, checks its metadata and original Buyer workspace, and retains its order, intent, handoff and native state. This also makes its original payment history and recovery controls available.

## Prepare and run exact requests

Select a purchased route and prepare a request. Supply a stable original request ID, an optional descriptive label, ordered query pairs and any required body. The selected plan supplies the route's method, path and unit cost.

The workspace saves the body bytes and their SHA-256 before queuing execution. Saving a request makes it reviewable in its own result page. **Send saved request** dispatches those retained inputs through the original client.

For example, the original analysis application accepts JSON input in its purchased route:

~~~json
{"values":[2,4,6,8],"window":2}
~~~

Choose the content type and complete body required by the actual purchased route. The request ID is the merchant's idempotency identity. Keep it when resuming that request; use a new ID for a genuinely new request.

The request page shows the latest task, original response status, byte count and digest. **Preview response** displays up to 64 KiB of readable UTF-8. **Download exact response** reads the retained file, checks its full byte count and SHA-256, and downloads the complete response. Binary responses use the same exact download.

Local request bodies support up to 1 MiB. Retained response reads support up to 4 MiB. These are customer-workspace limits; the purchased merchant route also applies its own contract.

## Recover an existing response

Use **Recover original result** when a response did not reach this browser or the previous customer process stopped. It asks the original merchant for the result associated with the same request ID and saves the returned response through the original client.

The merchant-history view lists existing requests with cursor pagination. **Open recovery** adopts a selected original request into this workspace. Its original order, route, request digest and response metadata are retained. A request adopted without its original input bytes opens as a recovery request; its result remains downloadable after recovery.

For a locally prepared request, **Replay same saved request** retains its request ID and complete saved inputs. The merchant resolves that same identity under its original request lifecycle. Refresh the allowance and request history to see the resulting original state.

The original API application, customer statement and purchased-pass workflows can therefore reopen the same response across customer processes without changing the order or making a second purchase.

## Prepare and complete an original purchase

**New purchase** takes the merchant's complete checkout handoff, a customer label, the original intent ID, gateway origin and configured claim environment. The saved handoff bytes become part of the customer record.

The purchase controls follow the maintained Buyer sequence:

1. **Prepare original purchase** opens or creates the original purchase directory and Inbox intent.
2. **Review original purchase** retains the complete native review and its digest.
3. Inspect that review and the original merchant/payment terms.
4. **Run reviewed purchase** executes the retained review through the original Buyer.
5. Respond to the original approval request through the selected browser broker or its existing terminal.
6. **Reopen original purchase** and **Reconcile purchase** continue the original operation when its local or accounting state needs reconciliation.
7. Refresh the allowance and use the purchased routes.

Purchase operations share a serialized native dispatch slot. Existing queued or running purchase work stays visible while it completes. A saved review is bound to the selected purchase and is checked again when executed.

### Original approval channel

The CLI supports `--approval-mode auto`, `browser` and `terminal`.

| Selection | Behavior |
| --- | --- |
| `auto` | Probe the bridge from the configured original Buyer runtime using that workspace's original operator selection. Use its browser broker when supported; otherwise retain its terminal channel. |
| `browser` | Require that selected runtime's browser capability and open its maintained broker before constructing Buyer. |
| `terminal` | Use the original controlling terminal for payment approval. |

An explicitly selected `--approval-module` is checked as a real source file. Applications retains its digest in the saved launch review. Inherited broker credentials are removed before only the selected broker's environment is attached.

The managed Applications entry keeps its existing PTY available, including when `auto` selects a legacy terminal runtime. Browser mode presents the original approval panel inside the customer workspace. The approval decision remains tied to the original intent, approval ID and request digest.

## Recover a paid attempt with lost local output

An existing purchase may have transferred its selected payment while its local output is absent. Open that same saved purchase and use **Recover a paid attempt with lost local output**.

Load the complete original approved-request JSON and choose **Inspect original paid attempt**. The original Inbox checks the retained attempt, request, configuration and accounting workspace. The customer view preserves that inspection under its own review ID.

Enter the exact original transaction hash and choose **Recover selected original payment**. The selected transaction is bound to that reviewed request, attempt and configuration before the shared finalizer reads original chain facts and reconciles the existing reservation.

**Authenticate saved recovery** reads the already retained recovery. **Export payment proof** exports the original sealed proof through the Inbox and checks its actual bytes before offering its download. **Export buyer history** produces the maintained buyer report for the same original purchase.

The complete recovery implementation and native API/Dataset receiving are maintained in [Lost output recovery](../../../sf88-operator-buyer-cli/LOST_OUTPUT_RECOVERY.md). The customer workspace is an interface to those original operations.

## Saved actions, stopping and reopening

The browser retains each workspace’s purchase, connection, request and recovery drafts in IndexedDB. Displayed purchase intents, request IDs, query parameters, text and selected file bytes survive a page reload. **Start a separate purchase intent** and **Start another request ID** create new identities while keeping the prepared inputs available for review. Recovery transaction drafts belong to the exact displayed inspection.

Browser actions retain their complete request and operation ID in IndexedDB before dispatch. **Saved actions** shows their state and supports retrying the same saved action after a connection interruption. A confirmed result remains confirmed if a later refresh fails.

A state-changing action rejected because the workspace changed can be reviewed and explicitly rebased. Completed backend mutations return their retained result when the same operation ID is retried. Reusing that ID with different input is rejected.

Purchase execution and payment recovery send the review or inspection that was displayed. The original model checks that selection again before acting. Saved-request page links retain the current page, and a late page response cannot replace a newly selected pass.

The host keeps a private state lease, serialized state writes, request bodies, results, reviews and task history. On a process restart, previously queued or running tasks become interrupted work for explicit continuation. Their original merchant request IDs and native purchase records remain available.

**Stop** requests cancellation for an active task. Use its current original request or purchase state to choose recovery after interruption. Stopping the complete application drains its active work and releases its own workspace lease. Open the same configuration again to see the same passes and customer records.

## Applications lifecycle

Select a READY installation containing this complete workspace. In **Applications**, choose **API-pass customer**.

| Setting | Selection |
| --- | --- |
| Customer workspace configuration | The existing private configuration file |
| Private customer workspace | The same directory recorded in that configuration |
| Purchase approval channel | `auto`, `browser` or `terminal` |
| Selected original approval broker | Optional explicit broker module from the original native runtime |
| Terminal Python executable | Existing executable for the maintained PTY; defaults to `/usr/bin/python3` |
| Local port | Zero or the requested loopback port |
| Private environment JSON | Optional existing private host environment file |

Review and save the application, complete its original release adoption when required, then review and start it. The existing Applications worker retains the launch and shows **Open** after it authenticates the actual customer server.

The launch adapter keeps the configuration and prior workspace state, plus all eight product source files. It checks those files in the selected installation and its adopted execution copy. It then binds the actual descendant CLI process, private launch record, loopback listener and authenticated workspace session. The retained launch keeps both source locations.

Use the original Applications **Stop** and reopen lifecycle. A subsequent start reviews the then-current customer state while retaining the same saved application, configuration and data directory. The application resource key prevents two managed runs from opening the same customer workspace concurrently.

The server and distribution builder consume the same five-route `browser-assets.json`. The ordinary customer HTML, JavaScript and stylesheet, plus the selected original approval panel and stylesheet, remain mapped to their maintained source files.

## Programmatic use

The installed package exports the customer model, configuration, server and configured CLI lifecycle:

~~~js
import {serveConfiguredWorkspace} from
  '@tokenjunkielabs/starforge-merchant/merchant/api-pass-workspace/cli';

const app = await serveConfiguredWorkspace({
  configFile: '/srv/starforge/api-customer-config.json',
  approvalMode: 'auto',
  port: 0,
});

// Retain app.launchFile privately and use the original model or local browser.
try {
  const state = await app.model.snapshot();
  // Select existing profile/request identities from this returned state.
} finally {
  await app.close();
}
~~~

The public model exposes pass connection, original purchase attachment, exact request preparation, queued execution and recovery, original merchant history, verified response reads and customer-history export. Its mutation methods take an operation ID and expected workspace revision, matching the browser's durable action contract.

Customer-history JSON, original buyer HTML and exact response/proof downloads provide the handoff files. The private customer directory and its original native authority paths provide the complete operational reopening state.
