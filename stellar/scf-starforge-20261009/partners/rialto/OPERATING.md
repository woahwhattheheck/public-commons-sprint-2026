# Rialto customer receiving

This integration takes an original Rialto discovery catalogue through a concrete customer request, the merchant's actual payment challenge, and the existing Stellar Forge buyer's portable preparation. It includes a complete catalogue reader, saved-source comparison, grayscale request editor, private transport, and an operator workflow another machine can reopen.

## Runtime and installation

Use Node.js 22 or newer, the Linux `flock` utility (util-linux), and a complete installed checkout of `woahwhattheheck/public-commons-sprint-2026`. Place this directory at `stellar/scf-starforge-20261009/partners/rialto`. The four runtime modules use Node built-ins; they add no package installation or hosted workflow.

Set `RIALTO_HOME` to this directory and `COMMONS_CHECKOUT` to the complete checkout. Receiving directories and output files are private: directories mode 0700, files mode 0600. Use real absolute paths rather than symlink aliases. Put archives outside the directory being packaged.

```sh
RIALTO_HOME=/absolute/commons/stellar/scf-starforge-20261009/partners/rialto
COMMONS_CHECKOUT=/absolute/commons
RIALTO_WORK=/absolute/private/rialto
mkdir -m 700 "$RIALTO_WORK"
```

## 1. Receive all current discovery pages

```sh
node "$RIALTO_HOME/customer.mjs" capture \
  --plan "$RIALTO_HOME/plan.example.json" \
  --directory "$RIALTO_WORK/catalogue-001"
node "$RIALTO_HOME/customer.mjs" inspect \
  --directory "$RIALTO_WORK/catalogue-001"
```

The reader requests the original facilitator's `/supported`, the discovery server's `/federation/peers`, and every original offset page of `/discovery/resources` through its reported end. The plan defaults to Stellar testnet, scheme exact, and 100 rows per page. An optional type or payTo filter is retained as part of the scope. Every returned item, payment option, extension and source metadata field stays in the original row.

Each request retains its URL, method, timestamps, status, headers and complete response bytes. A failed page stays in `captures/`. Repeating the same capture directory resumes from retained successful responses and attempts the missing GET again. It does not silently refresh pages already retained; a fresh catalogue goes in a fresh directory. This makes the observation interval visible, including a long interruption.

The service exposes offset pagination without a snapshot token. The catalogue therefore records the first and last observation times, every reported total, repeated resource identities, and any changing total. `enumerationComplete` means the received page sequence reached the provider's reported end. Read the findings before relying on coverage during a changing catalogue.

Open `catalogue-001/report.html`. It contains the entire captured catalogue, searchable across original fields, resource type filtering, all payment alternatives, original-row inspection, and an editable customer request. It runs offline. Printing includes every filtered row, rather than just the current 50-row screen.

## 2. Describe one useful customer request

In the report, open the exact HTTP resource. Select its original payment option. Enter:

- the concrete resource URL, preserving the original HTTPS origin and path;
- the HTTP method from the actual API and its original Bazaar metadata;
- a stable customer intent ID;
- the customer task and the complete output that will make the request useful;
- the maximum atomic amount, as a decimal string in the selected asset's units;
- any ordinary request headers and exact UTF-8 body.

The cap initially reflects the selected catalogue amount. Enter a different cap explicitly if the customer permits it. Atomic units stay as exact strings; the interface does not convert a Stellar asset amount to dollars.

Download the selection, then receive it:

```sh
node "$RIALTO_HOME/customer.mjs" select \
  --source "$RIALTO_WORK/catalogue-001" \
  --selection /absolute/downloads/rialto-selected-request.json \
  --directory "$RIALTO_WORK/customer-001"
```

For binary bodies, add `--body-file /absolute/original-request.bin`. That file takes precedence over the browser's UTF-8 body. To supply original ordinary headers from a private JSON file, add `--headers-file /absolute/headers.json`. A deliberately present zero-byte body is supported through a file or `requestBodyUtf8: ""` in the selection JSON. GET and HEAD have no body.

The complete source catalogue is copied with the selected request. The selection keeps its exact catalogue hash, page, original row, original acceptance index, payment requirements, task, useful output, URL, method, stable intent, cap, headers and body bytes/hash. Drafts in the browser are scoped to catalogue hash and resource identity; the downloaded file is the portable form.

MCP rows remain readable with their exact tool name and all original fields. Rialto's existing MCP client owns that execution path. The CLI's customer preparation path accepts HTTP resources.

## 3. Retain the actual merchant challenge

```sh
node "$RIALTO_HOME/customer.mjs" challenge \
  --directory "$RIALTO_WORK/customer-001"
```

This durably records the exact attempted request before dispatch, then sends the selected unpaid request once and stores the complete response as `challenge.http.json`. Repeating this exact command returns the saved response. If a process ended after dispatch but before saving the response, it returns the original interrupted attempt; a new explicit capture ID is required for another request. Inspect its status and `payment-required` header. Use the actual merchant response to select the challenge's acceptance index; catalogue and challenge indices need not match.

A catalogue row may contain amount, asset and recipient without an authorization timeout. The receiving code obtains the timeout and complete terms from the merchant's actual v2 challenge. It checks that the selected scheme, network, asset and recipient still match, the challenge's advertised origin and path match the resource (the captured response remains bound to the exact requested query), and the amount stays within the saved cap.

If a network failure or changed service requires another request, first inspect the original response and any merchant side effects. A deliberate new attempt has its own name:

```sh
node "$RIALTO_HOME/customer.mjs" challenge \
  --directory "$RIALTO_WORK/customer-001" \
  --capture-id merchant-retry-01
```

Each name retains one response. Use the same `--capture-id` when preparing that response. POST, PUT, PATCH and DELETE requests are never automatically retried. If the intended URL, body, selected recipient or asset changes, create a new request selection and new customer intent as appropriate.

## 4. Prepare with the original Stellar Forge buyer

Read the actual `PAYMENT-REQUIRED` JSON and choose its exact acceptance index. For example, when the reviewed original option is index 0:

```sh
node "$RIALTO_HOME/customer.mjs" prepare \
  --directory "$RIALTO_WORK/customer-001" \
  --checkout "$COMMONS_CHECKOUT" \
  --accept 0
```

This calls the existing SF88 `--prepare`, `--review`, and `--export-operation` commands. It preserves the complete merchant challenge as the original native saved-discovery listing, including all payment alternatives and unknown extension fields. The original buyer chooses and validates the exact acceptance index.

The native directory contains:

| File | Purpose |
|---|---|
| `payment-required.json` | Original decoded challenge bytes |
| `offers.json` | Native original-listing envelope containing that full challenge |
| `request.headers.json` | Exact ordinary request headers |
| `request.body` | Exact body, when present |
| `review.json` | Original SF88 preparation with its source and body bindings |
| `buyer-operation.json` | Original portable operation, with complete discovery and body bytes |
| `native-command-*.json` | Original command arguments, status and output |
| `preparation.json` | Source, challenge, configuration and handoff identity |

A restart resumes existing matching native artifacts. A changed preparation is not written over the original operation. The original installed buyer remains responsible for account authorization, signing, settlement, operation recovery, response custody and its budget policy.

## 5. Transfer and reopen the complete receiving edition

```sh
node "$RIALTO_HOME/customer.mjs" pack \
  --directory "$RIALTO_WORK/customer-001" \
  --out "$RIALTO_WORK/customer-001.receiving.json"
node "$RIALTO_HOME/customer.mjs" receive \
  --file "$RIALTO_WORK/customer-001.receiving.json" \
  --directory "$RIALTO_WORK/customer-001-received"
```

The packet carries every ordinary file with exact length, SHA-256 and complete base64 bytes. Receiving validates paths and bytes, stages the whole directory, then promotes it to a new destination. Keep the packet private: requests can include private customer data even though the initial catalogue is public.

Open the received `source/report.html` to review its original source. Original native configurations contain historical absolute paths. Reconstruct local paths through the existing native handoff importer:

```sh
node "$COMMONS_CHECKOUT/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs" \
  --import-operation \
  --file "$RIALTO_WORK/customer-001-received/native/buyer-operation.json" \
  --dir "$RIALTO_WORK/customer-001-native-received" \
  --accept 0
```

Use the same reviewed original challenge option, or explicitly review a different option in the original importer. Review the new local configuration and choose its new response destination:

```sh
node "$COMMONS_CHECKOUT/stellar/scf-starforge-20261009/sf88-operator-buyer-cli/cli.mjs" \
  --review \
  --config "$RIALTO_WORK/customer-001-native-received/review.json" \
  --response-out "$RIALTO_WORK/customer-001-native-received/customer-result"
```

The original import reconstructs local paths and leaves the new response destination for this receiving operator. Continue with the original buyer's `--review`, `--init-workspace`, `--review-workspace` and recovery commands in its README. Existing actor, service and payer bindings belong to that native workspace. Reopen the same workspace to resume an existing operation.

## 6. Refresh and compare catalogue editions

Capture into a new directory, then compare:

```sh
node "$RIALTO_HOME/customer.mjs" capture \
  --plan "$RIALTO_HOME/plan.example.json" \
  --directory "$RIALTO_WORK/catalogue-002"
node "$RIALTO_HOME/customer.mjs" compare \
  --before "$RIALTO_WORK/catalogue-001" \
  --after "$RIALTO_WORK/catalogue-002" \
  --out "$RIALTO_WORK/catalogue-change-001-002.json"
```

Comparison retains full before/after rows, uses the original resource-plus-tool identity, preserves duplicate occurrences, and reports added, removed, changed and unchanged entries. It exposes whether scope changed; a different network, filter or original source plan should be interpreted as a different scope.

## Operational limits and source ownership

A response capture has a 30-second deadline and a 32MiB limit. Original request bodies are limited to 16MiB, matching the native handoff path. Receiving packets are limited to 1GiB decoded files. An over-limit or failed response remains an explicit failed request record. Redirects are retained for review; capture does not follow them.

The Linux kernel serializes each directory's writer through `flock`; the lock remains with the original native child if its parent is interrupted and releases when the last writer closes its descriptor. Packaging and source-copy snapshots use that same lock, so they acquire a completed receiving edition before copying it. If another writer is active, the command reports that state and preserves its operation.

Only ordinary request headers enter this path. The original SF88 reserved-field contract keeps authentication, payment headers, HTTP framing and merchant ticket assembly with their original owners. The capture and native preparation retain those responsibilities.

Source contracts and exact reviewed commits are in `SOURCE_CONTRACT.md`. `WORKSHARE.md` turns this implementation into a concrete merchant onboarding offer. Native acceptance should retain one complete original catalogue, one actual selected customer request and challenge, original buyer preparation, a transferred operation, and the reopened original receiving workspace.
