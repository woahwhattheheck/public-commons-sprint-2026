# Unstructured document commerce

Prepare a document-processing merchant, export its customer SDK, buy through the original Stellar commerce operator, and receive the saved result in the research workspace. The two commands in this directory connect the existing SF30 seller, SF66 commerce session and SF88 document buyer. A document keeps its original purchase intent, exact multipart request and saved response throughout the workflow.

## Deployment and processor contract

This integration targets the **self-hosted Unstructured Partition API**. The retained manifest identifies API revision `448352104eefd2e5b8fa2dc32282fc1cd3db31ae`, core version `0.22.18` at `d29909504c7a19a13c19721f6907ac2fef0bb5ca`, and inference version `1.6.11`. Its provider operation is `POST /general/v0/general`, with one multipart `files` field and JSON elements in the response. Run the selected upstream deployment and supply its origin to the merchant.

Unstructured's current documentation identifies the managed Partition Endpoint as legacy and recommends Pipelines local-file jobs for managed production work. That is a separate deployment and API choice. The source retained here is the self-hosted contract, including its supported parameters and defaults. The compiled manifest travels with the buyer result so the receiving operator can see which processor and profile were selected.

Source references:

- [Pinned Partition API source](https://github.com/Unstructured-IO/unstructured-api/tree/448352104eefd2e5b8fa2dc32282fc1cd3db31ae).
- [Pinned Unstructured core](https://github.com/Unstructured-IO/unstructured/tree/d29909504c7a19a13c19721f6907ac2fef0bb5ca).
- [Official direct POST operation](https://docs.unstructured.io/api-reference/legacy-api/partition/post-requests) and [Partition Endpoint parameters](https://docs.unstructured.io/api-reference/legacy-api/partition/api-parameters).
- [Compiled merchant contract](../../sf30-seller-sdk/unstructured-partition.mjs) and [retained request/response contract](../../sf88-operator-buyer-cli/node/unstructured/contract.mjs).

## Configure the merchant

Use the runtime and signing configuration already installed for the native commerce operator. Keep the operator's Python executable, facilitator configuration and original signing source. The bundled SF66 setup uses Stellar testnet. Each selected offer in one setup must use the same network, asset and recipient, and its complete payment option must declare authorization flow.

[examples/partition.json](examples/partition.json) defines two starting profiles:

| Profile | Processing choice | Intended input |
| --- | --- | --- |
| `quick-text` | `fast`, table inference disabled | Documents with an existing text layer |
| `layout` | `hi_res`, English language selection and table inference enabled | Documents requiring the configured layout/OCR deployment |

These are configuration templates. Replace every `REPLACE_…` value and every `.invalid` origin with the actual deployment, public merchant account, asset contract and atomic price before preparation. Replace the absolute example paths in the commerce template as well. The price placeholders deliberately fail validation until configured.

The merchant `publicOrigin` must be an HTTPS origin. `upstream.origin` is the Partition API origin; the compiler supplies the fixed operation path. `apiKeyEnv` names the provider-key environment variable when the upstream requires that header. Omit the field for an upstream that does not use it. Keep the value of the key in the existing secure process environment.

Each profile has a stable ID, title, description, fixed parameters, explicit `paymentOptions` and document/response size limits. Preparation fills the declared defaults and records the resulting parameter digest. The request admission schema checks those same parameters and the document envelope before the provider operation. Configure another profile when its processing options or commercial terms change, and retain the earlier merchant directory for earlier purchases.

The default document ceiling is 8 MiB; the maximum configurable document ceiling is 16 MiB minus 65,536 bytes of multipart allowance. The full request ceiling is 16 MiB and each JSON response is at most 1 MiB. The default upstream/handler/request deadlines are 110/115/180 seconds, respectively. Set limits appropriate to the chosen deployment and document types; a workload that exceeds them needs an explicit supported profile and corresponding native limits.

Create a private parent directory, copy the templates and edit the copies:

```bash
STARFORGE_SOURCE=/absolute/source/stellar/scf-starforge-20261009
PARTITION_PRIVATE=/absolute/private/unstructured
install -d -m 700 "$PARTITION_PRIVATE"
cp "$STARFORGE_SOURCE/partners/unstructured/examples/partition.json" "$PARTITION_PRIVATE/partition.json"
cp "$STARFORGE_SOURCE/partners/unstructured/examples/commerce.json" "$PARTITION_PRIVATE/document-commerce.json"
chmod 600 "$PARTITION_PRIVATE/partition.json" "$PARTITION_PRIVATE/document-commerce.json"
```

All paths passed to these commands must be absolute. Private initialization directories must resolve to their real path, be owned by the current operator and have mode `0700`; retained configuration files use `0600`.

## Prepare the merchant and customer SDK

After configuring the templates, run:

```bash
node "$STARFORGE_SOURCE/partners/unstructured/merchant.mjs" prepare \
  --config "$PARTITION_PRIVATE/partition.json" \
  --directory "$PARTITION_PRIVATE/merchant" \
  --python /absolute/path/to/python3

node "$STARFORGE_SOURCE/partners/unstructured/merchant.mjs" inspect \
  --directory "$PARTITION_PRIVATE/merchant"
```

Use `--allow-loopback-upstream` only when the selected upstream is deliberately hosted on the local machine. Preparation compiles and retains the original seller declarations and customer contract. The native commerce start command later owns service startup and provider transport.

| Retained file | Purpose |
| --- | --- |
| `configuration.json` | Exact original merchant input |
| `seller.json` | Original SF30 routes and complete payment offers |
| `upstreams.json` | Fixed provider operation, environment references and transport limits |
| `partition-manifest.json` | Processor source, profiles, parameters and original payment options |
| `seller-openapi.json` | Native payment-aware public customer contract |
| `client/` | Original generated JavaScript module, TypeScript declarations, source OpenAPI, package README and completion receipt |

Open `client/README.md` for the generated customer's actual API and argument shapes. The `inspect` result also returns the generated module path and its original exporter status command. The exporter publishes complete files under their final names and publishes its completion receipt after all five original payloads have been retained.

## Prepare the original buyer session

Edit [examples/commerce.json](examples/commerce.json) to point to the prepared merchant, the existing native facilitator configuration and the buyer's signing source. `operator.secretEnv` names the original buyer-secret environment variable; deployments using the native signer provider can supply `operator.signerProvider` instead. Keep the signing material in the original operator configuration and process environment.

Set `operator.totalAtomic` and `operator.dailyAtomic` to the buyer's explicit spending limits. Each document supplies its chosen profile, original absolute file path, filename, media type, stable `intentId`, selected `acceptIndex` and maximum atomic amount. The maximum must cover the chosen complete payment option. Use a new stable intent only when the operator intends another purchase.

```bash
node "$STARFORGE_SOURCE/partners/unstructured/commerce.mjs" prepare \
  --config "$PARTITION_PRIVATE/document-commerce.json" \
  --directory "$PARTITION_PRIVATE/document-session"

node "$STARFORGE_SOURCE/partners/unstructured/commerce.mjs" inspect \
  --directory "$PARTITION_PRIVATE/document-session"
```

The preparation retains one multipart body per document, including the exact uploaded bytes and the original generated boundary. `request-reviews.json` records the file, request and parameter identities, selected terms and ceiling. `commerce-setup.json` feeds those same bodies into the original SF66 constructor. `document-source.json` points to the actual resulting `commerce/session/inbox` and the configured research workspace ID.

The completed result returns executable argument arrays for the original operator, browser console and research receiver. Use those returned paths when a session lives outside the example directory.

## Run, review and recover the purchase

Start the original operator in a terminal:

```bash
node "$STARFORGE_SOURCE/sf66-demo-launcher/commerce-cli.mjs" start \
  --directory "$PARTITION_PRIVATE/document-session/commerce/session"
```

At `commerce>`, run `readiness`, `review ORIGINAL_INTENT`, and `signer ORIGINAL_INTENT` to inspect the configured service, document request, selected payment terms and signing source. `execute ORIGINAL_INTENT` invokes the original payment approval flow. Review that exact purchase in the native terminal.

The same operator exposes `status`, `recover ORIGINAL_INTENT` and `retrieve ORIGINAL_INTENT`. Recover and retrieve use the retained intent and native outcome. After a terminal or browser disconnect, reopen this original session and inspect its current state before continuing. The saved body and response remain in the original inbox.

The browser operator can be opened with the returned `commands.console` argument array. Both interfaces use the same commerce session. Keep one owning commerce process for that session.

## Receive and use the document

Open the research workspace with the returned command, or:

```bash
node "$STARFORGE_SOURCE/sf88-operator-buyer-cli/research-dossiers/server.mjs" \
  --dir "$PARTITION_PRIVATE/document-session/research-dossiers" \
  --document-source "$PARTITION_PRIVATE/document-session/document-source.json" \
  --port 8846
```

The server prints its private local URL and configured document workspace identity. The receiver reads the saved result from the same original buyer inbox. It presents the original document, profile, request and native outcome alongside the extracted elements, page references and available table content.

Follow [Receive Unstructured documents in the research workspace](../../sf88-operator-buyer-cli/research-dossiers/UNSTRUCTURED.md) for the full document review, receiving decision, notes/findings, retained editions and portable dossier workflow. A portable dossier retains its received document edition and research content so it can be reopened independently of the originating buyer account.

## Resume preparation and retain the workspace

`resume` is an explicit continuation of the same preparation:

```bash
node "$STARFORGE_SOURCE/partners/unstructured/merchant.mjs" resume \
  --config "$PARTITION_PRIVATE/partition.json" \
  --directory "$PARTITION_PRIVATE/merchant" \
  --python /absolute/path/to/python3

node "$STARFORGE_SOURCE/partners/unstructured/commerce.mjs" resume \
  --config "$PARTITION_PRIVATE/document-commerce.json" \
  --directory "$PARTITION_PRIVATE/document-session"
```

Supply the same original configuration, paths and loopback choice. The initialization lease prevents simultaneous constructors; recovery compares retained inputs before adding missing files. An interrupted customer export completes from the original generator and retains the original export identity. Changed inputs require their own deliberate preparation.

Once preparation has completed, `inspect` uses the retained files and original native session. The merchant inspection verifies its compiled artifacts and customer export even when its original input file is absent. Commerce inspection verifies its retained request files, exact selected profile/payment option and actual inbox binding without reopening the original source documents.

Use the existing [SF66 commerce recovery workflow](../../sf66-demo-launcher/COMMERCE_RECOVERY.md) for encrypted backup, source-absent verification and restoration of the running commerce workspace. Stop and drain the owning commerce process before its CLI backup review and capture. Keep the merchant preparation, document preparation and research dossier under the intended private workspace and include them in the operator's selected recovery scope.

## Installed entrypoints

This source release exports `@tokenjunkielabs/starforge-merchant/partners/unstructured`, `/partners/unstructured/commerce`, `/seller/unstructured-partition`, `/buyer/unstructured`, and `/buyer/research-dossiers/unstructured-workspace`. Its CLI aliases are `starforge unstructured-merchant`, `starforge unstructured-commerce`, and the existing `starforge research-workspace`. The source commands above show the exact module paths for installations using the retained source tree.
