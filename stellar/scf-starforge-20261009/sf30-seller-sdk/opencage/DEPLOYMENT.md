# Deploy and receive an OpenCage workbench

Use one coherent Starforge source release for the provider, merchant and customer. This guide connects the OpenCage plan to the host's outbound connection, the original merchant release and the buyer's retained result. The [workbench guide](README.md) contains the complete command and output reference.

## Select the source and installation

A cumulative archive contains the source and command map recorded when that archive was built. A later source PR has its own implementation and dependency identity. Use the package manifest and the selected source pin to decide which launch command is available.

The following are immutable October 11, 2026 source snapshots:

| Source selection | Contents relevant to this workbench | Receiving entry point |
| --- | --- | --- |
| Cumulative source `57835a18f005cf63b5e5e76e0538860806196cc9` | Original installed foundation: 1,272 source files, 52 components, 115 commands and 183 exports. | Its original packaged commands and SDK. |
| Cumulative source `f8db4d8cff51ace62bb7b25655131aaed78bdde8` | 54 components, 127 commands and 208 exports. Its distribution map predates the OpenCage command and exports. | Its [matching installed guide](../../distribution/README.md), interpreted against that archive's own manifest. |
| OpenCage source `250620d6b262d3a357549879934e17fcb1aac82e` | Complete 14-file workbench plus the exact original configured-egress dependency at `a8c524f35e8288bc6391d912733ff04bae39939f`. Its distribution map includes `opencage-workbench` and seven OpenCage exports. | The source CLI below, or a later cumulative archive that actually includes this source and its command map. |
| Native receiving installation for that OpenCage pin | 1,304 verified original/composed base files plus all 14 workbench files. The selected shared closure contains 319 files and retains its original manifest. | Direct invocation of `sf30-seller-sdk/opencage/cli.mjs` from the selected source root. |

Sources: [original cumulative map](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/f8db4d8cff51ace62bb7b25655131aaed78bdde8/stellar/scf-starforge-20261009/distribution/distribution.json), [complete OpenCage source](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/250620d6b262d3a357549879934e17fcb1aac82e/stellar/scf-starforge-20261009/sf30-seller-sdk/opencage), and [shared transport source](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/a8c524f35e8288bc6391d912733ff04bae39939f/stellar/scf-starforge-20261009/sf30-seller-sdk/UPSTREAM_TRANSPORT.md).

Install a supplied source archive using the maintained distribution workflow:

```sh
npm install --ignore-scripts --offline --omit=optional /absolute/selected-merchant.tgz
npx --no-install starforge doctor
npx --no-install starforge installation inspect ./node_modules/@tokenjunkielabs/starforge-merchant
```

Check the installed application export before selecting its packaged interface:

```sh
node --input-type=module -e "console.log(import.meta.resolve('@tokenjunkielabs/starforge-merchant/seller/opencage'))"
```

A package built with the OpenCage mapping resolves that entry and supplies `npx --no-install starforge opencage-workbench`. An older package reports an unavailable export. Select the archive that includes the workbench, or use the complete pinned source checkout with its original runtime dependencies.

The [original runtime installer](../../distribution/RUNTIME_INSTALL.md) prepares exact native and feature dependencies from the selected archive. Select the native payment libraries, operator support and the `schema` feature for this merchant. The original schema dependency is `re2js@2.8.6`; `starforge doctor --feature schema` checks its resolution. Keep the archive, dependency lock and source/runtime paths together through installation, upgrade and receiving. The [managed installation](../../sf46-release/MANAGED_PACKAGE.md) and [runtime transfer](../../distribution/RUNTIME_TRANSFER.md) guides carry the corresponding operating procedures.

The commands below run from `stellar/scf-starforge-20261009/` in that selected source. A complete packaged release exposes the same arguments after `starforge opencage-workbench`.

## Configure each network leg

| Connection | Configuration owner | Retained configuration |
| --- | --- | --- |
| Merchant host to OpenCage | OpenCage source plan and original SF30 upstream factory | Provider API origin and path, normalized query, API-key environment reference and optional `transport` profile. |
| Customer to merchant | Original seller terms, release and HTTPS host | Merchant public origin, product path and exact offered payment alternatives. |
| Buyer to merchant or a retained HTTPS result | Original SF31/SF88 buyer | Complete resource URL, request, expected terms, spending ceiling, response bounds and its own selected transport. |
| Operator to saved output | Original private workspace or exported customer delivery | Original response bytes, source/decision identity and complete output manifest. |

These are separate configurations because they control separate connections. The OpenCage proxy setting affects provider egress. A merchant's public origin identifies the service a buyer purchases. The buyer's own network profile belongs to its original buyer configuration.

For a host using an approved HTTP CONNECT proxy, add this field to the OpenCage plan before initializing the workspace:

```json
{
  "transport": {
    "mode": "environment-proxy",
    "proxyEnv": "MERCHANT_HTTPS_PROXY"
  }
}
```

Set `MERCHANT_HTTPS_PROXY` privately through the host's existing environment or secret configuration. Set the plan's API-key variable separately; the example uses `OPENCAGE_API_KEY`. The saved plan contains those variable names. Their values stay in the process environment.

Use Node 22.21+ within the 22.x series, Node 24.5+, or Node 25+ for this profile. The receiving installation above selected Node 24.19.0. The original profile compiler and Agent enforce the supported version and proxy URL shape. Only the selected variable reaches that Agent; unrelated ambient proxy and `NO_PROXY` settings do not override it. HTTPS hostname and certificate checks remain enabled. The selected proxy is trusted to route the original fixed HTTPS provider hostname. [Original transport contract](../UPSTREAM_TRANSPORT.md).

A plan without `transport` retains its original direct HTTPS behavior. An explicit `{"mode":"direct"}` makes that choice visible in the saved plan. The pure plan and package review validate references without constructing a provider connection; a missing or invalid runtime value is reported when source work is admitted.

## Prepare the operation and exact commercial terms

Create new editable input files:

```sh
node sf30-seller-sdk/opencage/cli.mjs examples --out /private/geocoding-inputs-v1
```

Review the two products, allowed query options and defaults in `plan.json`. Forward queries accept place or address text. Reverse queries use latitude,longitude. Bounds use longitude,latitude,longitude,latitude. The example requests `no_record=1` and retains the provider's native result semantics. [OpenCage API](https://opencagedata.com/api).

Edit `terms.json` to the merchant's intended HTTPS public origin, network, asset, recipient and integer atomic price. The generated example has visible demonstration asset/recipient markers. Keep provider account limits and cost separate from the merchant's offered price and the buyer's spending ceiling.

Initialize the source and terms as one private workspace, then open the operator:

```sh
node sf30-seller-sdk/opencage/cli.mjs init \
  --workspace /private/geocoding-work-v1 \
  --plan /private/geocoding-inputs-v1/plan.json \
  --terms /private/geocoding-inputs-v1/terms.json

node sf30-seller-sdk/opencage/cli.mjs serve \
  --workspace /private/geocoding-work-v1
```

Open the printed loopback URL in the receiving browser. The source view displays the selected profile and environment reference. Review the original query before capture and the original response before choosing a candidate. The saved request ID, response hash and decision revision travel into its delivery.

For a command-line operator, the corresponding source actions are:

```sh
node sf30-seller-sdk/opencage/cli.mjs capture \
  --workspace /private/geocoding-work-v1 --id customer-coordinate-01 \
  --product reverse --query '{"q":"51.952659,7.632473"}'

node sf30-seller-sdk/opencage/cli.mjs inspect \
  --workspace /private/geocoding-work-v1 --id customer-coordinate-01
```

Use the actual returned hash, current revision and reviewed candidate index with `select`, then `export`. The [decision and delivery commands](README.md#retained-requests-and-decisions) show those exact arguments. Export returns the retained delivery directory containing the original JSON, licenses, candidate projections, selected output and manifest.

A successful provider response can contain zero candidates. Confidence describes spatial precision. Provider-published test keys return their documented fixed example location, with a special empty-result query; customer source and query review should preserve that context. Returned license fields accompany the exported result. [API semantics](https://opencagedata.com/api) · [Provider terms](https://opencagedata.com/terms).

## Review and operate the merchant release

Prepare a package from the saved plan and selected terms:

```sh
node sf30-seller-sdk/opencage/cli.mjs package \
  --workspace /private/geocoding-work-v1

node sf30-seller-sdk/opencage/cli.mjs package-inspect \
  --package /absolute/prepared-package-directory
```

The package includes the original OpenAPI, offers, route bindings, seller configuration and source binding. Its generated SDK keeps the original `sdk/seller-client.mjs` and `sdk/seller-client.d.mts` entry names declared by `sdk/package.json`.

Stage the returned package identity and review the original release diff:

```sh
node sf30-seller-sdk/opencage/cli.mjs stage \
  --workspace /private/geocoding-work-v1 --package-id PREPARED_PACKAGE_ID \
  --release geocoding-v1

node sf30-seller-sdk/opencage/cli.mjs release-diff \
  --workspace /private/geocoding-work-v1 --after geocoding-v1

node sf30-seller-sdk/opencage/cli.mjs release-status \
  --workspace /private/geocoding-work-v1
```

Use the observed generation with `activate`, then the resulting selected generation with `start`. The original seller emits its actual unpaid challenge and continues payment through the configured native service. The operator's running release and selected release remain visible separately. Its foreground owner drains the seller and source on shutdown.

For the public deployment, use the merchant's existing HTTPS host and the reviewed public origin. The private loopback operator is the administration surface. The [existing host workflow](../../sf99-merchant-deploy/README.md) carries routing, environment placement and operating handover.

Changes follow their original source or release identity:

| Change | Receiving action |
| --- | --- |
| Price or merchant public origin | Prepare another package from explicit terms, stage it, inspect the original diff and activate/restart the reviewed generation. Earlier packages and customer results remain retained. |
| Proxy variable name, proxy mode or native source options | Prepare a new source plan and workspace. The changed selection becomes part of that source identity. Reopen the earlier workspace for its original captures. |
| Value of the same proxy or API-key variable | Rotate it through the existing private host environment and restart the owned processes. The new process resolves the current value; the previous source drains before close. |
| Customer candidate decision | Save against the original response hash and expected decision revision, then export a new retained delivery. |
| Earlier release needed | Use the original `rollback --generation` operation, inspect the selected/running state, and start the intended saved generation. |

## Continue the original customer result

The buyer uses the original SF88 initialization, policy, ledger, signer and review. Its accepted operation binds the complete merchant URL and exact terms. When a host needs the original explicit CONNECT buyer profile, configure that through the buyer's own interface; its `explicit-connect` schema differs from the provider's `environment-proxy` schema.

The original Node sequence is `Buyer.fromConfig()` → `operation.review()` → `operation.execute({review})` → retained result. After a restart, `buyer.operation(intentId).recover()` reopens that operation. The workbench consumes this original saved result.

For `consume-buyer` or `adopt-buyer`, `--buyer-config` is the original **Buyer client configuration**, including its `runtimeDirectory` and existing `stateDirectory`. The original purchase's `operator.json` is the configuration previously passed to `Buyer.fromConfig()`. Keep the client state directory associated with the actual intent.

```sh
node sf30-seller-sdk/opencage/cli.mjs adopt-buyer \
  --workspace /private/geocoding-work-v1 \
  --buyer-config /private/original-buyer-client.json \
  --intent ORIGINAL_INTENT_ID --id delivered-coordinate-01 \
  --product reverse --package-id ACTUAL_MERCHANT_PACKAGE_ID
```

Select the package whose origin and terms correspond to that buyer request. Adoption preserves that package identity and terms alongside the initial workspace reference and original buyer request/result. Review and export the adopted capture through the same decision interface.

A completed public provider result may also be retrieved from its own immutable HTTPS resource. The original buyer response-file configuration pins the actual URL, SHA-256, byte count and returned base content type. `GeocodeDelivery.fromOperation()` joins that retained resource to its actual product path and query. The resource's retrieval identity remains alongside its provider result.

The customer can reopen the complete exported directory:

```sh
node sf30-seller-sdk/opencage/cli.mjs read \
  --delivery /absolute/retained-customer-delivery

node sf30-seller-sdk/opencage/cli.mjs serve \
  --delivery /absolute/retained-customer-delivery
```

The installed source and runtime dependencies are still required to run the application. Completed workspace imports and customer deliveries reopen without provider credentials or a new provider connection.

## Resolve an interrupted source or receiving step

Inspect the same request ID first. Its original capture carries application status, provider status, request identity and original bytes.

- A missing host transport configuration produces `GEOCODE_TRANSPORT_CONFIGURATION_UNAVAILABLE`. Correct the selected host environment before the intended source continuation.
- `UPSTREAM_UNAVAILABLE` with no native provider status records a connection outcome. Inspect that host's selected route and source binding.
- Provider 401/403 concern the provider account or access. Provider 402 is quota exhaustion and maps through the original upstream application behavior; the merchant's own 402 remains its purchase challenge.
- Provider 429/503 retain their original retry information. Use the provider's account state and the saved result when deciding the next operation.
- A lost process after dispatch retains the attempted request. The original native HTTP observation and exact response bytes can complete its matching `import-response` operation. Preserve the observation's `requestSha256` when reconciling that prior attempt.
- A completed export reopens from its own manifest and decision revision. Later source edits, credential rotation and later candidate decisions leave that saved edition available.

The browser import transfers the response as bytes; the CLI reads the original file. Preserve those bytes, including a UTF-8 byte-order mark when present, instead of parsing and reserializing the response.

## Source and receiving record for this integration

The native direct-host operation completed on October 11 at 23:02:54 UTC with application `UPSTREAM_UNAVAILABLE`, provider status absent, and the exact 38-byte application response SHA-256 `926460c756f35da08b6805d6f2abd8ed32b10bcbbe02fa9b91af4d658526dbd5`. That retained outcome led to the configured source integration above.

The explicit-profile installation selected the complete original shared transport and retained source manifests. Its original foreground receiving operation, `scf-opencage-profile-workshare-a39c-20261011`, continues through the maintained disk/memory scheduler. Its source, provider, merchant, buyer and customer outcomes are attached to the [same product handoff](https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791762521148609?thread_ts=1791730288.879869). The installed cumulative package records retain their own source pins and completed outcomes.
