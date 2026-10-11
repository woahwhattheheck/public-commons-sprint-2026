# Valyu research workspace

A complete customer research application on the maintained Stellar Forge merchant and buyer.

The merchant exposes one searchable resource, `POST /research/search`. Its generated SF30 client carries the exact resource and payment selection into the original SF88 buyer. The customer workspace saves questions, receives the delivered response, adds selections and notes, freezes editions, compares deliveries, and exports JSON, Markdown, CSV or a standalone HTML report. A resumed operation reads the same original buyer record.

The operator interface uses the local browser: saved queries, the exact normalized request, native purchase review, result recovery, research notes, edition import/export and comparisons. It is deliberately a plain industrial interface.

## Install and select the maintained runtime

Use Linux, Node 24 or later, Python 3.11 or later, npm, and the `flock` command. Node 24 supplies the customer store's built-in SQLite. The native installation selects the original x402 and Stellar SDK dependencies; this application adds no package dependency.

Use the supplied original Starforge merchant archive and its complete SHA-256. The archive must include the Valyu commands and the canonical-runtime corrections from [PR1339](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1339), merged at `026d039e0e25aacf1b2f05d20404b2f1f202970b`, or a later source containing those changes. Keep the runtime installation separate from customer state.

The following examples use new directories under an existing, private, real absolute parent. Replace the example paths and archive digest with the supplied values.

~~~sh
umask 077
mkdir /absolute/private/valyu-toolkit
cd /absolute/private/valyu-toolkit
npm install --ignore-scripts --offline --omit=optional /absolute/private/original-merchant.tgz

npx --no-install starforge runtime-install prepare \
  --dir /absolute/private/valyu-runtime \
  --archive /absolute/private/original-merchant.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --operator
npx --no-install starforge runtime-install install \
  --dir /absolute/private/valyu-runtime
npx --no-install starforge runtime-install run \
  --dir /absolute/private/valyu-runtime -- source
~~~

The bootstrap command uses the supplied local archive. Runtime dependency installation uses npm's configured registry and cache. A populated cache can be selected with the installer's documented `--offline --cache` options. An interrupted installation resumes in the same runtime directory with `runtime-install resume`.

Keep this shell in the toolkit directory and define these command prefixes for the selected installation:

~~~sh
export VALYU_INSTALL=/absolute/private/valyu-runtime
valyu_research() {
  npx --no-install starforge runtime-install run --dir "$VALYU_INSTALL" -- valyu-research "$@"
}
valyu_merchant() {
  npx --no-install starforge runtime-install run --dir "$VALYU_INSTALL" -- valyu-merchant "$@"
}
valyu_buyer() {
  npx --no-install starforge runtime-install run --dir "$VALYU_INSTALL" -- buyer "$@"
}
valyu_research --help
valyu_merchant --help
~~~

The installer dispatches the selected archive's original commands with its dependency tree. The source identity is returned by `source`. For host deployment, use the same installation's returned `sourceRoot` and `dependencyRoot`. Installation, upgrade, lock recovery, and exact archive restoration are covered in [RUNTIME_INSTALL.md](../../distribution/RUNTIME_INSTALL.md).

### Existing source checkouts and overlays

A complete checkout with its original native dependencies can use:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/valyu/merchant-cli.mjs --help
node stellar/scf-starforge-20261009/sf30-seller-sdk/valyu/run.mjs --help
~~~

For an established source overlay, set `VALYU_RUNTIME_ROOT` to the real absolute `stellar/scf-starforge-20261009` directory containing both the original seller and buyer. Keep that complete source selection with its matching dependency loader. The installed distribution resolves colocated components automatically. Workspace and recovery launchers resolve the original buyer entrypoint to its canonical path, including when an overlay reaches it through a parent-directory alias.

The commands below use the three installed-runtime prefixes above. In a checkout, replace `valyu_research` with the absolute `node .../valyu/run.mjs` entrypoint, `valyu_merchant` with `node .../valyu/merchant-cli.mjs`, and `valyu_buyer` with `node .../sf88-operator-buyer-cli/cli.mjs`.

[MERCHANT.md](MERCHANT.md) supplies the merchant configuration, native payment terms, facilitator startup and source-delivery profiles. [RESEARCH-EDITIONS.md](RESEARCH-EDITIONS.md) describes content types, citations, usage, comparison and report formats.

## 1. Connect the provider account and start the merchant

Sign into the intended account at [Valyu](https://platform.valyu.ai/) and obtain its API key from the dashboard, following the [official quickstart](https://docs.valyu.ai/quickstart). The quickstart offers an account trial without a card; use the actual plan, available balance and source access shown for this account. Retain the key in the merchant's existing credential setup under the configured environment name, normally `VALYU_API_KEY`.

Create the merchant input from [MERCHANT.md](MERCHANT.md) using the actual public HTTPS origin, verified asset, receiving account, native route fee and provider policy. Compile and inspect it:

~~~sh
valyu_merchant compile \
  --input /absolute/private/merchant-input.json \
  --out /absolute/private/seller-service.json
valyu_merchant inspect \
  --config /absolute/private/seller-service.json
~~~

A preview starts the original seller in `CHALLENGE_ONLY` mode and exposes the payment offer, OpenAPI and generated client. Live execution uses the same compiled configuration, the server-held Valyu credential and the operator's actual native facilitator:

~~~sh
valyu_merchant serve \
  --config /absolute/private/seller-service.json \
  --facilitator https://facilitator.example.com \
  --history-dir /absolute/private/valyu-traffic \
  --availability-dir /absolute/private/valyu-availability
~~~

Publish the original seller through the configured HTTPS origin and keep its operations listener private. The startup record identifies its local listeners and endpoints. A preview's challenge is useful for setup; paid execution needs the live facilitator-backed mode.

Save the exact generated client and the same public provider policy for the customer. This example reads the compiled configuration, downloads the original client from its configured public origin, and creates two new private files:

~~~sh
node --input-type=module - \
  /absolute/private/seller-service.json \
  /absolute/private/seller-client.mjs \
  /absolute/private/provider.json <<'NODE'
import { readFile, writeFile } from 'node:fs/promises';
const [configPath, clientPath, providerPath] = process.argv.slice(2);
const config = JSON.parse(await readFile(configPath, 'utf8'));
const response = await fetch(new URL('/_seller/client/seller-client.mjs', config.publicOrigin));
if (!response.ok) throw new Error('Generated client download failed: HTTP ' + response.status);
await writeFile(clientPath, Buffer.from(await response.arrayBuffer()), { flag: 'wx', mode: 0o600 });
await writeFile(providerPath, JSON.stringify(config.provider, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
NODE
~~~

For separate merchant and customer hosts, transfer those two files through the existing private delivery channel. The initializer retains the original client and binds its SHA-256. The provider file contains public policy and a credential environment reference; the credential value stays on the merchant.

The request's `max_price` is a Valyu CPM ceiling. The buyer's `maxAtomic` is its separate total payment ceiling in atomic asset units. The delivered `totalDeductionDollars` is the actual returned provider charge. Keep these units separate when choosing the two caps.

Use the intended first query through this workflow. If the provider request has already been completed by the account operator, receive that original observation through section 5.

## 2. Initialize the original buyer and private customer workspace

Choose one permanent state root. For a complete recoverable workspace, its original SF88 operator directory must be inside that root:

| Path | Purpose |
| --- | --- |
| `/absolute/private/valyu-customer/operator` | Original signer configuration, budget journal and operator state |
| `/absolute/private/valyu-customer/settings.json` | Customer settings produced by initialization |
| Customer-managed children of the same root | Saved queries, captured deliveries, generated client and original buyer operation files |

An existing original operator already inside this root can be adopted directly with the final `init` command below. For first setup, use a real source request and the chosen merchant's actual payment terms to initialize the original operator.

Save this draft as `/absolute/private/question.json`:

~~~json
{
  "title": "Stellar storage documentation",
  "input": {
    "query": "Stellar smart contract storage documentation",
    "search_type": "web",
    "max_num_results": 2,
    "included_sources": ["developers.stellar.org"],
    "url_only": true,
    "max_price": 2,
    "response_length": 200
  }
}
~~~

Create the state root and the original request body from that draft. The body is the input object itself:

~~~sh
mkdir /absolute/private/valyu-customer
node --input-type=module - \
  /absolute/private/question.json \
  /absolute/private/valyu-customer/operator-source.body <<'NODE'
import { readFile, writeFile } from 'node:fs/promises';
const [draftPath, bodyPath] = process.argv.slice(2);
const draft = JSON.parse(await readFile(draftPath, 'utf8'));
await writeFile(bodyPath, JSON.stringify(draft.input), { flag: 'wx', mode: 0o600 });
NODE
~~~

Save the following reviewed setup configuration as `/absolute/private/valyu-customer/operator-source.json`. Replace the origin, asset, recipient, cap and timeout with the actual selected offer. This example selects testnet; an existing mainnet operator follows the original [mainnet setup](../../sf88-operator-buyer-cli/MAINNET.md).

~~~json
{
  "operation": {
    "intentId": "valyu-operator-setup",
    "url": "https://research.example.com/research/search",
    "method": "POST",
    "headers": { "content-type": "application/json" },
    "bodyFile": "/absolute/private/valyu-customer/operator-source.body",
    "expect": {
      "scheme": "exact",
      "network": "stellar:testnet",
      "asset": "ACTUAL_SELECTED_ASSET",
      "payTo": "ACTUAL_MERCHANT_RECIPIENT",
      "maxAtomic": "ATOMIC_CAP",
      "maxTimeoutSeconds": 60,
      "paymentFlow": "authorization"
    }
  }
}
~~~

Initialize the new original operator with the existing payer's public address:

~~~sh
valyu_buyer --init-workspace \
  --config /absolute/private/valyu-customer/operator-source.json \
  --dir /absolute/private/valyu-customer/operator \
  --actor owner-operator --service valyu-research \
  --payer ACTUAL_EXISTING_TESTNET_PUBLIC_ADDRESS \
  --python /usr/bin/python3 --secret-env STELLAR_SECRET
valyu_buyer --review-workspace \
  --dir /absolute/private/valyu-customer/operator
valyu_buyer --diagnose-workspace \
  --dir /absolute/private/valyu-customer/operator
~~~

The operator retains its original budget journal and credential references. Supply the existing payer credential through the selected environment name at execution, or use the original initializer's `--signer-provider` option for the existing trusted wallet module. Default total and daily budgets equal the setup cap; choose explicit `--total-atomic` and `--daily-atomic` values when approving a larger workspace budget. The [original operator guide](../../sf88-operator-buyer-cli/README.md) covers those settings and controlling-terminal requirements.

Adopt that operator and the retained seller client into the research workspace:

~~~sh
valyu_research init \
  --state-root /absolute/private/valyu-customer \
  --seller-client /absolute/private/seller-client.mjs \
  --operator-directory /absolute/private/valyu-customer/operator \
  --provider-config /absolute/private/provider.json
valyu_research serve \
  --settings /absolute/private/valyu-customer/settings.json
~~~

Open the returned local URL including its access fragment. The desk binds to loopback and uses a session token. Settings, response captures and buyer records use private files and local SQLite. In another shell, select the same installed runtime prefixes before using the CLI.

The initializer can alternatively accept an existing `--operator-profile` with native `operator`, `signerModule`, `trustedPayer`, `bodyCaptureTimeoutMs`, `buyerTransport` and `requestTimeoutMs` fields. Adopting the complete in-root original operator is the path used by this guide for composed encrypted recovery. A receiving workspace can also initialize with only the state root and provider configuration, then import permitted editions or original observations.

## 3. Save the question and review its exact purchase

Save the draft from section 2, then use the returned query ID and its current revision:

```sh
valyu_research request --settings /absolute/private/valyu-customer/settings.json --input /absolute/private/question.json
valyu_research query --settings /absolute/private/valyu-customer/settings.json --id QUERY_ID
valyu_research prepare --settings /absolute/private/valyu-customer/settings.json --id QUERY_ID --revision 1 --max-atomic ATOMIC_CAP --accept 0
valyu_research review --settings /absolute/private/valyu-customer/settings.json --id QUERY_ID
valyu_research execute --settings /absolute/private/valyu-customer/settings.json --id QUERY_ID
```

Replace `QUERY_ID`, the revision and `ATOMIC_CAP` with the saved query's returned values and the chosen cap for the original merchant terms. The browser presents the same saved request, option index, cap and native review. Run `execute` from the original operator terminal with its configured signer access. The original buyer owns approval, payment and response capture.

In the browser, choose **Custom character count** to enter a positive integer `response_length`; the example uses 200 characters per result. Choosing Short, Medium, Large or Max instead saves that named provider value. Reopening the question preserves the numeric count or named selection. The displayed response-length control is authoritative; place other admitted provider fields in the additional-options JSON.

Preparation records its intent before creating the native operation. Once prepared, a query's request is immutable. Duplicate a query to make a new request or edition. If preparation was interrupted in `PREPARING`, resume `prepare` for the same query and original cap/accept index. Once the original operation exists, inspect and collect that saved intent:

```sh
valyu_research inspect --settings /absolute/private/valyu-customer/settings.json --id QUERY_ID
valyu_research collect --settings /absolute/private/valyu-customer/settings.json --id QUERY_ID
```

`collect` consumes the original saved result. It does not submit a new provider request or payment.

## 4. Build and export research editions

Use the browser to select results, write notes and tags, then freeze the selection. Each edition contains the saved request, exact delivered response bytes and hashes, provider usage, source agreement information and the selected annotation revision. Its immutable manifest can be reopened in the same or another configured workspace.

CLI annotation input:

```json
{
  "captureId": "CAPTURE_ID",
  "rowId": "ROW_ID",
  "expectedRevision": 0,
  "selected": true,
  "note": "The research question and follow-up decision.",
  "tags": ["storage"]
}
```

```sh
valyu_research annotation --settings /absolute/private/valyu-customer/settings.json --input /absolute/private/annotation.json
valyu_research query --settings /absolute/private/valyu-customer/settings.json --id QUERY_ID
valyu_research freeze --settings /absolute/private/valyu-customer/settings.json --capture CAPTURE_ID --selection-sha CURRENT_SELECTION_SHA256
valyu_research editions --settings /absolute/private/valyu-customer/settings.json
valyu_research export --settings /absolute/private/valyu-customer/settings.json --edition EDITION_ID --format html --out /absolute/private/research.html
valyu_research export --settings /absolute/private/valyu-customer/settings.json --edition EDITION_ID --format json --out /absolute/private/research.json
valyu_research import-edition --settings /absolute/private/valyu-customer/settings.json --input /absolute/private/research.json
valyu_research compare --settings /absolute/private/valyu-customer/settings.json --left EARLIER_EDITION_ID --right LATER_EDITION_ID
```

The freeze operation checks the current selection hash. An edition import verifies the exact response bytes, request, source delivery, original provenance and annotation shape before recording it. Identical edition IDs and contents reopen idempotently; a conflicting ID cannot overwrite an existing edition. Output paths must be new files inside an existing private directory.

## 5. Receive an existing provider observation

The importer can receive an already completed original provider request without executing another. Supply the original request bytes, original response bytes, and a private provenance record with:

- `url`: `https://api.valyu.ai/v1/search`;
- actual `status` of 200 or 206 and ISO `capturedAt`;
- `requestSha256`: SHA-256 of the exact request file;
- `sha256`: SHA-256 of the exact response file.

```sh
valyu_research import-observation \
  --settings /absolute/private/valyu-customer/settings.json \
  --id UNPURCHASED_QUERY_ID \
  --response /absolute/private/provider-response.json \
  --request /absolute/private/provider-request.json \
  --provenance /absolute/private/provider-observation.json
```

Use a saved query still in `DRAFT`, with no prepared native intent. Keep a separately prepared purchase attached to its original operation. The request file is the actual provider JSON object, rather than the draft's title/input wrapper. The saved query must match that original request under the configured request defaults. At first observation capture, the query binds the exact original provider request and its compact JSON hash, preserving any fields that were omitted in the actual API call. The importer projects raw results through the configured delivery profile before retaining them, or validates an already projected delivery against the same trusted profile. It keeps separate hashes for the upstream response and the delivered projection. The actual provenance status must equal the delivered envelope's provider HTTP status, including 206. Native purchases and external provider observations keep distinct provenance. After import, the returned capture can be annotated, frozen and exported through section 4.

## 6. Recover the complete workspace

The existing SF88 recovery engine handles encryption, verification and canonical restore. Close the desk, select the complete original operator/state root, and use the archive's existing passphrase environment:

```sh
valyu_research backup-review --settings /absolute/private/valyu-customer/settings.json
valyu_research backup --settings /absolute/private/valyu-customer/settings.json --out /absolute/private/valyu-archive --quiesced --pass-env SF88_BACKUP_PASSPHRASE
valyu_research verify --bundle /absolute/private/valyu-archive --record-sha ARCHIVE_RECORD_SHA256 --pass-env SF88_BACKUP_PASSPHRASE
valyu_research restore --bundle /absolute/private/valyu-archive --record-sha ARCHIVE_RECORD_SHA256 --pass-env SF88_BACKUP_PASSPHRASE
```

Retain the returned archive record SHA-256 separately and use it for both verification and restoration. Verification is read-only. Restore recreates the original canonical paths, so those destinations must be available: after verification, retain an existing stopped state root under a different private path before restoring into its original location. Keep the same runtime selection available at its recorded paths. The original [recovery guide](../../sf88-operator-buyer-cli/RECOVERY.md) documents destination checks and passphrase handling.

After restore, serve the restored settings file and inspect or collect the same saved query. Its request, intent, caps, annotations and response hashes remain attached to that original operation. Research state, original buyer operation files, settings, generated client and native operator remain in one selected recovery unit.

## Application and dossier integration

```js
import { ValyuWorkspace } from './workspace.mjs';
import { ValyuStore } from './store.mjs';
import { exportResearchEdition } from './research.mjs';

// The existing workspace supplies its normalized provider configuration.
const workspace = await ValyuWorkspace.open(settings);
const page = workspace.store.listEditions({ offset: 0, limit: 30 });
const edition = workspace.store.editionView(page.editions[0].id);
const original = workspace.store.edition(edition.id).manifest;
const report = exportResearchEdition(original, 'html');
// Write report.bytes using the caller's existing durable output path.
workspace.close();

// A dossier may consume the same private store directly.
const store = await ValyuStore.open(researchDirectory, { provider });
const retained = store.editionView(editionId);
store.close();
```

`editionView` returns `id`, `sha256`, `title`, `createdAt`, `query`, response provenance, `retentionMode`, `validUntil`, `agreementReference`, rows, summaries and annotations. Annotations are keyed by `row.id`.

Each row carries `occurrenceId`, original position, content disposition, normalized source fields, citations and a typed original `raw` result when supplied by a durable source agreement. A withheld occurrence has its opaque handle and no publisher fields. A dossier can retain its own questions and analyst findings against those stable handles. The same-source row union and export interface are documented in RESEARCH-EDITIONS.md.

## Source delivery

The merchant applies the source profile before returning bytes to SF88. The default `references-only` profile retains the customer's request, transaction/usage values, upstream hash and opaque occurrence handles. Explicit durable source agreements may add the full permitted original result. Timed or request-only provider content remains outside frozen editions and archives.

A delivery profile is trusted server configuration, and the customer configuration must agree with it when receiving licensed sources. Named web/news sources additionally use explicit returned-URL scope. Original result types, 200/206 status, source warning counts and actual provider deduction are preserved by the delivery adapter.

This product is the implementation, deployment and research workflow. Provider source access uses the customer's selected source agreement. Current official technical and delivery references are linked in MERCHANT.md and RESEARCH-EDITIONS.md.

## Files

- `config.mjs`, `adapter.mjs`, `delivery.mjs`, `application.mjs`, `merchant-cli.mjs`: native merchant and provider integration.
- `workspace.mjs`, `store.mjs`: original buyer orchestration and saved customer research.
- `research.mjs`: source analysis, comparison and four report formats.
- `server.mjs`, `static/`: private operator interface.
- `run.mjs`: customer CLI, observations and original recovery.
- `runtime.mjs`, `files.mjs`: maintained runtime resolution and original private-file helpers.

`VALYU_RUNTIME_ROOT` selects the existing `stellar/scf-starforge-20261009` root when running in an established native source overlay. The installed distribution resolves the colocated original components automatically.
