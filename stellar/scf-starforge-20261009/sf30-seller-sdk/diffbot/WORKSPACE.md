# Diffbot retained acquisition and workspace

This module connects a customer's existing Diffbot account to the original Starforge Python workspace. The acquisition client retains the original response in private transport custody and produces a separate credential-free capture. The operator places that capture in a saved source edition, then uses the original workspace to inspect, review, build, export and reopen it. Account observations, provider jobs, source revisions and customer deliveries keep their actual identities.

| File | Purpose |
| --- | --- |
| `acquisition.py` | Account observation, credit estimate, structured Extract, Bulk creation/status/full download, exact-name reconciliation, retained import/export and offline reopen. |
| `workbench.mjs` | Original Python workspace creation, inspection, operator serving, native CLI forwarding, complete customer handoff and create-only portable reopening. |
| `processor.py` / `application.py` | Original `inspect_dataset`, `build_dataset` and customer-only `customer_dataset` functions on retained `workspace.json` and captures. |
| `recurring/__init__.py` / `recurring/report.py` | Joined watchlist, change review, accepted customer projection and recurring report, when present in the installed source. |
| `recurring/recurring.mjs` / `recurring/recurring.css` | Pure browser consumer and its styles, composed by the parent operator. They have no separate store or acquisition worker. |

The acquisition client uses the Python standard library on a POSIX system. The workbench requires Node 22.13 or later with the original `node:sqlite` workspace implementation. The source root defaults to four directories above this original `sf30-seller-sdk/diffbot/` module, which is the repository root or maintained installed package's `source/` root. Use `--source-root` to select a different maintained Starforge **source root**, containing `stellar/scf-starforge-20261009/sf30-seller-sdk/python/workspace/model.mjs`. The installed `starforge diffbot-workspace` command calls this same module. Customer records belong in their own workspace, outside the installed package.

## 1. Select the source and account

Keep three locations separate:

- Private transport custody, mode `0700`: original bodies, private headers, account binding, operation journals and incomplete downloads.
- Prepared dataset directory: `workspace.json` and its safe `captures/<sha256>.json` or `.csv` files.
- Native operation directory: the original application snapshot and Python workspace created by the workbench.

The token comes from `DIFFBOT_TOKEN`, a selected `--token-env`, or an existing mode `0600` `--token-file`. It is never passed as a command argument. The client sends it through the official query parameter and retains private files with owner-only permissions. Use the actual customer account and its existing entitlement; the module does not create a subscription or change a plan.

Global acquisition options precede the command:

```bash
python3 acquisition.py \
  --store /private/diffbot-transport \
  --token-file /private/credentials/diffbot.token \
  account --id account-observation-001 --days 31
```

The selected view contains the actual returned `plan`, `planCredits`, `status`, `created` and documented `usage` metrics. The original account body remains private, including any token or child tokens. Account views are excluded from dataset capture export. A 31-day usage window is not automatically treated as a billing period or converted into an invented remaining-credit balance.

A completed ID returns its retained observation. Choose a new ID for a deliberate fresh account read. Put the reviewed URLs in a UTF-8 newline file or JSON array of URL strings. The estimate reads that selection without a provider request:

```bash
python3 acquisition.py estimate \
  --urls /private/selected-urls.json --use-proxy none

python3 acquisition.py --store /private/diffbot-transport estimate \
  --urls /private/selected-urls.json --use-proxy none \
  --account-operation account-observation-001
```

The estimate reports submitted entries, distinct URLs, assumed extractions and credits. Its dated rate assumption is one credit per extracted page, or two when `useProxy=default` selects Diffbot's datacenter proxy. It does not infer a dollar charge, invoice, remaining balance or purchase. Actual usage and repeated work remain separately observable. Refresh the account and relevant terms before agreeing a new customer run.

The current first-party rate table makes Bulk available on Plus and separately contracted accounts. A historical Startup minimum in the create-page description is not used as a current entitlement rule. The client does not silently enable proxies, scheduled repeats, notifications, restarts or deletion.

Sources: [Account API](https://www.diffbot.com/docs/account), [credits](https://www.diffbot.com/docs/credits), [rate limits](https://www.diffbot.com/docs/rate-limits), [Bulk overview](https://www.diffbot.com/docs/bulk/).

## 2. Acquire structured Extract data

Supported APIs are `analyze`, `article`, `product`, `image`, `video`, `discussion`, `event`, `list` and `job`. The client uses the original structured JSON response, without inheriting the separate SDK's Markdown/LLM default.

```bash
python3 acquisition.py \
  --store /private/diffbot-transport \
  --token-file /private/credentials/diffbot.token \
  extract --id selected-page-001 --api article \
  --url 'https://customer-selected.example/article' \
  --fields 'meta,querystring' --timeout-ms 30000 --use-proxy none
```

Replace the example URL with an actual selected source. The HTTP timeout is separately controlled by global `--http-timeout`, default 45 seconds; the provider fetch timeout defaults to 30,000 milliseconds. Source URLs with embedded user credentials or credential query parameters are rejected as portable input.

A successful operation returns original and projection hashes/byte counts, capture time, actual HTTP status and object count. Provider error bodies are retained too. Authorization errors, rate limits and other provider errors do not start an automatic retry loop. A returned `Retry-After` is exposed for an explicit later operation.

Export the capture into the prepared dataset directory:

```bash
python3 acquisition.py --store /private/diffbot-transport \
  export --id selected-page-001 --out /private/prepared-diffbot
```

This writes the safe capture under `captures/<sha256>.json` and a `selected-page-001.source.json` descriptor for an edition's `sources` list. The exported source identifies a derivative; its nested envelope retains the original body's actual hash, size and capture method.

### Exact numbers and credential removal

JSON numbers are parsed as lexical tokens and written back as JSON numbers with their original digits, decimal places, sign and exponent. A large Bulk identifier never passes through floating-point conversion. The processor exposes numeric leaves as exact text alongside `numberTokens`, so customer mapping distinguishes a provider number from a textual field.

Credential keys, credential-capable headers, credential URL parameters and discovered credential values are removed from the portable projection, with redaction records. A Bulk URL-report projection contains a CSV string; CSV numeric cells stay strings. The full original response remains in private custody.

The projection shape is:

```json
{
  "schema": "tj.diffbot-safe-capture.v1",
  "format": "diffbot-extract-json",
  "capture": {
    "id": "LOCAL_OPERATION_ID",
    "capturedAt": "ORIGINAL_OBSERVED_TIME",
    "sourceKind": "live-api",
    "original": {
      "sha256": "ORIGINAL_SHA256",
      "bytes": 123,
      "wireBytes": true
    },
    "httpStatus": 200
  },
  "request": {"pageUrl": "ORIGINAL_SOURCE_URL", "api": "article"},
  "payload": {},
  "redactions": []
}
```

This is a shape illustration. The client fills `payload` from the actual safe provider data, including failures and unsupported classifications. It does not replace actual output with the empty illustration.

Source contracts: [Extract](https://www.diffbot.com/docs/extract/), [Analyze](https://www.diffbot.com/docs/extract/analyze), [Article](https://www.diffbot.com/docs/extract/article), [Product](https://www.diffbot.com/docs/extract/product).

## 3. Operate a Bulk job

Bulk creation sends documented form-encoded `name`, space-delimited `urls` and `apiUrl`. A job name can refer to an existing collection and add URLs; it is not an idempotency key.

```bash
python3 acquisition.py \
  --store /private/diffbot-transport \
  --token-file /private/credentials/diffbot.token \
  bulk-create --id customer-bulk-create-001 \
  --name customer_news_20261011 \
  --urls /private/selected-urls.json \
  --api article --fields 'meta,querystring' --use-proxy none
```

The client performs one fresh exact-name status observation before a new POST. It submits only after the documented no-collection response establishes absence. If the name exists, `NOT_SUBMITTED` includes the retained observation. Continue the existing job through status and download, or deliberately choose a different name. A local lookup cannot make the provider's name check and creation globally atomic; use one coordinated customer sender for a name.

```bash
python3 acquisition.py \
  --store /private/diffbot-transport \
  --token-file /private/credentials/diffbot.token \
  bulk-status --id customer-bulk-status-001 --name customer_news_20261011

python3 acquisition.py \
  --store /private/diffbot-transport \
  --token-file /private/credentials/diffbot.token \
  bulk-download --id customer-bulk-data-001 --name customer_news_20261011

python3 acquisition.py \
  --store /private/diffbot-transport \
  --token-file /private/credentials/diffbot.token \
  bulk-download --id customer-bulk-urls-001 \
  --name customer_news_20261011 --url-report
```

The JSON download omits `num`, which would request only a newest subset. It preserves the complete currently available array. While a job is processing, this is a snapshot of available output; retain the separate status observation and its time. The CSV URL report diagnoses individual URLs and does not replace extraction output.

Status `9` denotes completion without a scheduled repeat. Other statuses, counters, collection name and actual endpoint remain visible. The status operation never includes mutating `pause`, `restart` or `delete` flags. The documented restart operation erases earlier processed data; it is not used for recovery.

The provider documents deletion of inactive completed jobs within ten days. Retain the original status, full data and URL diagnostics promptly. Local reopen remains available after a provider collection expires.

### Recover an uncertain creation

The journal is fsynced before dispatch. If the process exits after that point without a complete result, repeating the same operation ID does not POST again.

```bash
python3 acquisition.py --store /private/diffbot-transport \
  reopen --id customer-bulk-create-001

python3 acquisition.py \
  --store /private/diffbot-transport \
  --token-file /private/credentials/diffbot.token \
  reconcile --id customer-bulk-reconcile-001 \
  --create-operation customer-bulk-create-001
```

Reconciliation reads the original name under the same account binding and compares the observed endpoint. It distinguishes matching job, different endpoint, absence and incomplete lookup. A name lookup alone does not prove who submitted every URL; the report states that limitation. It never resets or repeats creation. A found job remains usable through normal status, full data and URL-report downloads.

Sources: [create](https://www.diffbot.com/docs/bulk/create), [manage](https://www.diffbot.com/docs/bulk/manage), [complete data retrieval](https://www.diffbot.com/docs/bulk/retrieve).

## 4. Reopen or import retained source

A completed operation reopens without network access or a token:

```bash
python3 acquisition.py --store /private/diffbot-transport \
  reopen --id selected-page-001
```

Reopen compares the stored original and projection hashes. A complete body renamed into place immediately before a crash can recover missing metadata and projection. If projection recovery needs the account's original redaction context, supply the same token privately. This never performs another request.

An incomplete `response.body.part` stays incomplete. It is not promoted or concatenated with a later download. The Bulk API does not document an immutable byte-range resume contract here. An explicit new download ID makes a fresh observation; the interrupted operation retains its original prefix and state.

For a previously acquired original response, import the exact file and its real metadata:

```bash
python3 acquisition.py --store /private/diffbot-transport \
  import --id original-public-result \
  --file /private/original-result.json \
  --format diffbot-extract-json \
  --captured-at ACTUAL_ORIGINAL_CAPTURE_TIME \
  --source-kind live-public-testdrive-ui-result \
  --request /private/original-request.json
```

Set `--wire-bytes` only for actual HTTP response body bytes. A public Testdrive result copied from the UI remains `wireBytes=false`. An import does not manufacture a request, account or provider run ID.

The response limit defaults to 64 MiB, configurable up to 1 GiB through global `--max-bytes`. An over-limit response remains an incomplete original prefix with an explicit state, never a silently complete dataset. Native source and output limits are separate.

## 5. Create the original workspace

The prepared `tj.diffbot-workspace.v1` manifest contains:

- `title`, `selectedEdition` and `editions`.
- Each edition's local ID, label, actual capture time, selected scope, source descriptors and optional `compareToEdition`.
- `reviews`, the original `recurring` watchlist/decisions/delivery configuration, and the chosen `export` mode and column pointers.

Every descriptor's `path`, `sha256` and `bytes` must match its file. Scope records actual URLs, API, fields, format and options. Comparable source scopes support temporal comparison. “Not seen” does not establish deletion.

```bash
node workbench.mjs create \
  --source-root /absolute/starforge/source \
  --dir /private/diffbot-work \
  --dataset /private/prepared-diffbot/workspace.json

node workbench.mjs status \
  --source-root /absolute/starforge/source --dir /private/diffbot-work

node workbench.mjs inspect \
  --source-root /absolute/starforge/source --dir /private/diffbot-work
```

Create copies exact manifest/capture bytes, `processor.py`, `application.py`, the generated original merchant declaration, and the optional complete recurring Python closure. It does not copy the acquisition journal, token file, account response, private HTTP headers or an entire source tree.

The workbench checks original hashes and portable credential fields. Inspection does not rewrite numbers: original capture bytes enter the native revision unchanged. The initial marker binds the complete source snapshot. Repeating create with the same retained operation resumes it; different input cannot overwrite that marker.

Native limits remain 512 files, 32 MiB total and the original per-file limits. Each function's serialized result is capped at 1,048,576 bytes, including embedded customer files and reports. Select a complete customer partition that fits. Records are never silently clipped.

The default declaration is marked `LOCAL_PREVIEW_UNCONFIGURED` and carries a placeholder origin/payment tuple. It supports local retained-source processing without a signer, payment or provider call. Deployment uses an explicit `--plan PLAN.json` with `label`, `publicOrigin` and the original `payment` tuple, followed by original merchant release review. The full `label` remains the native workspace title. The optional `serviceName` must contain 1–32 printable ASCII characters under the original seller contract; when omitted in an explicit plan, the label must satisfy that rule. The default preview plan supplies `Diffbot retained dataset` as its short service name and retains the complete source title as the label. The placeholder is not a configured offer.

## 6. Inspect, review and build through native APIs

Use the actual revision returned by status or the operator. The wrapper preserves the original CLI's `--workspace` argument order:

```bash
node workbench.mjs workspace \
  --source-root /absolute/starforge/source --dir /private/diffbot-work \
  -- preview --revision ACTUAL_HEAD --function inspect_dataset \
  --input /private/diffbot-work/preview-input.json \
  --operation dataset-inspect-001 --out /private/dataset-inspect-001.json

node workbench.mjs workspace \
  --source-root /absolute/starforge/source --dir /private/diffbot-work \
  -- preview --revision ACTUAL_HEAD --function build_dataset \
  --input /private/diffbot-work/preview-input.json \
  --operation dataset-build-001 --out /private/dataset-build-001.json
```

The generated preview input is `{}` and uses the saved selected edition. An `editionId` input selects another retained edition. The native preview ID, revision, state, output bytes and digest remain authoritative. Pending or failed previews are not completed deliveries.

Start the original editor:

```bash
node workbench.mjs serve \
  --source-root /absolute/starforge/source \
  --dir /private/diffbot-work --port 8431
```

Or compose the specific operator bundle:

```bash
node workbench.mjs serve \
  --source-root /absolute/starforge/source \
  --dir /private/diffbot-work --port 8431 \
  --operator-assets /private/diffbot-operator/operator-assets.json
```

The optional manifest contains `operatorPath` and `assets:[{path,file,type}]`. File paths are relative to the manifest and stay within that bundle. A directory can also supply `index.html`, `browser.mjs` and `style.css`. The original `recurring/recurring.mjs` and `recurring/recurring.css` pair may sit beneath that directory or beside `web/`, as in the installed source. Both are served at `/diffbot-dataset/recurring/`; the stylesheet route is `/diffbot-dataset/recurring/recurring.css`, so the main stylesheet can import `./recurring/recurring.css`. Keep the module and its external stylesheet together. This convention serves the operator at `/diffbot-dataset/` and preserves the original CSP.

The original server owns authentication, origin checks, CSP, source save, preview, release history and portable export, and retains its native editor route. Its operator-asset caps are 2 MiB per file and 8 MiB combined. There is no second API or workspace.

For recurring reviews, the parent saves configuration into the original source revision, previews it, and returns the matching report/configuration pair. A prior edition's decision does not silently approve a newer edition. The joined recurring guide describes the exact watchlist selectors and decisions.

### Publish the original customer function

The normal saved operator declaration contains `inspect_dataset`, `build_dataset` and `customer_dataset`. The first two return complete internal inspection/build material for the operator. `customer_dataset` returns `tj.diffbot-customer-delivery.v1` with only the six customer files and the recurring pair when joined. Customer review mappings permit `/review/decision`; internal note objects are excluded.

The original native compiler uses `merchant.json`'s `functions` list for both private previews and published routes. Keep the normal declaration in the operator revision. For a customer release, save a derived revision whose `functions` contains only the unchanged `customer_dataset` definition at `/diffbot-dataset/customer`, keeping the same application and capture bytes. Stage that exact saved revision ID through the original release controls, review and activate its one-function customer product, then restore the operator revision as the editable head. The published release remains bound to the immutable customer revision while the original editor continues private inspection and builds. This uses the existing revision, stage and restore operations; it does not introduce another engine or a second source store.

Use the actual deployment's explicit original payment/account configuration before publishing. The default local-preview declaration remains unconfigured. A private preview is not a configured paid offer or a provider-account transaction.

## 7. Deliver customer files and retain the operator workspace

A ready completed `build_dataset` produces original files for two audiences. Handoff creates separate `customer/` and `operator/` directories, with an independent manifest in each. The root manifest identifies the combined handoff as operator material.

| Directory and file | Use |
| --- | --- |
| `customer/customer.ndjson` | Selected mapped record projection. |
| `customer/customer.csv` | Agreed mapped columns with safe CSV cells. |
| `customer/customer.html` | Escaped self-contained customer view. |
| `customer/source-index.json` | Sources, scope, provenance and original digests. |
| `customer/number-tokens.json` | Exact numeric tokens and field pointers. |
| `customer/DELIVERY.md` | Original explanation for the selected output. |
| `customer/recurring-report.json` / `customer/recurring-report.html` | The paired accepted watchlist projections when the recurring module is joined; internal recurring notes stay in the operator report. |
| `operator/review-decisions.json` | Complete edition-bound operator decisions and internal review notes. |
| `operator/dataset-report.json` | Complete dataset, coverage, identity, comparison, findings and internal recurring review. |
| `operator/preview-result.json` | Exact original completed native result, including all output bodies. |
| `operator/workspace.python-workspace.json` | Full editable original source, captures, history and retained outputs for the authorized operator. |

```bash
node workbench.mjs handoff \
  --source-root /absolute/starforge/source --dir /private/diffbot-work \
  --preview ACTUAL_COMPLETED_BUILD_PREVIEW_ID --out /private/diffbot-handoff

node workbench.mjs reopen \
  --source-root /absolute/starforge/source --dir /private/diffbot-reopened \
  --bundle /private/diffbot-handoff/operator/workspace.python-workspace.json

node workbench.mjs status \
  --source-root /absolute/starforge/source --dir /private/diffbot-reopened
```

Handoff reads the original completed preview and checks its function, schema, readiness and every original file's size and SHA-256. It preserves output bytes exactly. The customer directory contains the six customer files plus the complete recurring pair when present; it contains no full preview, review-decisions file, dataset report or portable workspace. Deliver this directory to the agreed report audience. Deliver the separate operator directory only to the people authorized to receive source captures, full history and internal notes.

The customer manifest lists only customer files. The operator manifest lists only operator files, and the combined manifest records each path and audience. A complete operator handoff remains available without putting internal material in a customer bundle. Recurring outputs are accepted only as a complete pair.

The operation marker binds workspace, selected preview, preview digest and this directory layout. On interruption, identical files are reused and differing files are not replaced. Once an original portable export is retained, recovery preserves those exact first bytes instead of generating a later archive in their place.

Portable reopen uses original create-only `importWorkspace`. It restores source revisions, previews, release/customer metadata and outputs without reacquiring a source or executing Python. A separately named original export is available:

```bash
node workbench.mjs export \
  --source-root /absolute/starforge/source --dir /private/diffbot-work \
  --out /private/diffbot-original.python-workspace.json
```

The export target is create-only and its full contents are operator material. Retain app, source and handoff under the agreed data and content rights. API tokens and private account/transport custody are excluded from the native source package.

## Source adoption completed for this implementation

The actual public news result captured at `2026-10-11T22:32:37.590Z` is 18,252 UTF-8 bytes, SHA-256 `e4d8f2a711bbb51673cd66147c383104d6a94563fe7a5f930daa3b475f3a82b2`, preserving article `article|3|-618081119`. That same source passed retained import, same-ID reuse, safe export and offline reopen. Its method remains UI text with `originalWireBytes=false`.

The focused API compatibility check retains the documented Bulk integer `6526070754824580571` after removing the token field. Decimal and exponent lexemes remain exact. These are source/serialization checks; the joined source owner records the actual native application and customer journey separately.
