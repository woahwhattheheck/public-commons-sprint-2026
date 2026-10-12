# Receive a captured NocoDB edition through the original merchant product

The portable [native consumer](receiving/native-consumer.mjs) carries one completed NocoDB v3 observation through the source authoring workspace, original dataset publisher, managed merchant releases, MCP operator and customer SDK download. It consumes the actual complete Sakila actor and film captures returned by the provider operation: 200 actors and 1,000 films.

This is a receiving operation for the existing product. The driver imports the maintained source modules and preserves their native workspace, request, review, release, snapshot and export identities. It can run on the same worker that acquired the data; there are no fixed cloud-container paths.

## Execution status and payment scope

The source can be delivered before the receiving worker executes it. A source hash or successful Node syntax check is preparation evidence. The native outcome is the private output directory's `result.json` and the original artifacts referenced by its completed checks.

This revision exercises the original development merchant's HTTP 402 challenge, exact amounts, snapshot-pinned SF88 configuration, and the generated customer's offline request. It does not invoke a signer or facilitator, submit a Stellar transaction, or claim a paid response. A real TESTNET purchase must additionally use the original SF82/SF88/SF43/Governor payment continuation, dedicated funded testnet accounts, the exact reviewed asset and recipient, and an actual settlement/delivery result. Keep its private keys in the receiving worker's private custody. A 402 response alone is not a completed purchase.

Both film publications use the same actual provider observation. The reviewed extraction order changes from ascending to descending on the selected unique public record identifier. This exercises original version, cursor and release behavior without representing a second provider capture.

## Prepare the selected source and runtime

Use Node 24.20 or the receiving worker's compatible Node 24 runtime with the product's existing dependencies, plus its existing Playwright and Chromium installation. The worker needs ordinary local filesystem writes and loopback listeners. The native source modules use the original SQLite workspace and dataset stores.

Select a complete, reviewed repository-shaped source closure containing these original directories:

| Relative directory | Original role |
| --- | --- |
| `stellar/scf-starforge-20261009/sf30-seller-sdk` | NocoDB declaration, complete capture reader, scalar projection, publisher adapter, source authoring and dataset service |
| `stellar/scf-starforge-20261009/sf82-seller-pilot` | Managed release store, merchant lifecycle, browser console and customer export |
| `stellar-forge/mcp-merchant-operator` | Publisher and merchant MCP tools, original buyer handoff and resumable customer-file readers |

Include all transitive project modules, static browser assets and the original dependency manifests in the selected source manifest. Its paths are canonical relative paths beneath `sourceRoot` and its SHA-256 values describe the actual selected bytes. The consumer checks every listed file before and after the operation and requires the directly executed source entries and source-authoring assets to appear. A partial list is not a complete source selection.

The original NocoDB adapter is introduced in PR1451, the provider intake in PR1473, and the source-authoring workspace and Applications hooks are later additive source. Select the actual composed source that includes those later files. Do not infer an installed archive contains them from an earlier version label.

The two capture-backed declarations must remain outside the public source tree. Reuse the provider operation's declaration files and complete capture directories, including its exact metadata, page and manifest bytes. Each declaration must have `connection.kind: "capture"` and the exact original capture manifest hash. The original reader verifies completeness, counts, source identity and field/order binding before a publisher is opened.

For each table choose the actual saved query name, its existing public projection aliases and an actual unique public record identifier. The driver preserves the full declared source field selection and scalar policy when it saves the first reviewed source version. The publisher plan chooses the public subset; source rows, field IDs and values are never fabricated. NocoDB JSON number text and nullable values pass through the original `projectedNocoDBValue` implementation.

## Private receiving input

Create a private input JSON file with this shape. The capitalized identity values below are placeholders to replace with the actual provider and source return; this example is not an executable fixture.

```json
{
  "schema": "stellar-forge.nocodb-native-receiving-input.v1",
  "operationId": "nocodb-provider-receiving",
  "consumerSha256": "ACTUAL_64_HEX_HASH_OF_EXECUTED_DRIVER",
  "sourceRoot": "/srv/nocodb-receiving/source",
  "sourceManifest": {
    "file": "/srv/nocodb-receiving/private/selected-source.json",
    "sha256": "ACTUAL_64_HEX_HASH_OF_SOURCE_MANIFEST"
  },
  "sourceRefs": {
    "adapter": "535d1b7f3ed3b953f2f6b556b1362ca3356eacbd",
    "providerIntake": "02900c998e10bf48a6cdfa79608b4e2b4b3b8288",
    "composedSource": "ACTUAL_COMPOSED_SOURCE_COMMIT"
  },
  "outputDirectory": "/srv/nocodb-receiving/private/receiving",
  "browser": {
    "module": "/srv/browser/node_modules/playwright/index.mjs",
    "executable": "/srv/browser/chromium/chrome"
  },
  "sources": [
    {
      "id": "film",
      "primary": true,
      "sourceFile": "/srv/nocodb-receiving/private/film/source.json",
      "sourceSha256": "ACTUAL_FILM_DECLARATION_SHA256",
      "captureSha256": "ACTUAL_FILM_CAPTURE_MANIFEST_SHA256",
      "query": "ACTUAL_FILM_QUERY",
      "publicColumns": ["ACTUAL_FILM_ID_ALIAS", "ACTUAL_TITLE_ALIAS"],
      "orderColumn": "ACTUAL_FILM_ID_ALIAS",
      "expectedRows": 1000
    },
    {
      "id": "actor",
      "sourceFile": "/srv/nocodb-receiving/private/actor/source.json",
      "sourceSha256": "ACTUAL_ACTOR_DECLARATION_SHA256",
      "captureSha256": "ACTUAL_ACTOR_CAPTURE_MANIFEST_SHA256",
      "query": "ACTUAL_ACTOR_QUERY",
      "publicColumns": ["ACTUAL_ACTOR_ID_ALIAS", "ACTUAL_NAME_ALIAS"],
      "orderColumn": "ACTUAL_ACTOR_ID_ALIAS",
      "expectedRows": 200
    }
  ],
  "merchant": {
    "origin": "https://nocodb-receiving.example",
    "path": "/catalog/films",
    "payment": {
      "scheme": "exact",
      "network": "stellar:testnet",
      "asset": "ACTUAL_REVIEWED_TESTNET_ASSET",
      "payTo": "ACTUAL_REVIEWED_TESTNET_RECIPIENT",
      "amount": "10000",
      "maxTimeoutSeconds": 60
    },
    "nextAmount": "12000"
  }
}
```

The source manifest has this structure:

```json
{
  "files": [
    {
      "path": "stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/declaration.mjs",
      "sha256": "ACTUAL_FILE_SHA256"
    }
  ]
}
```

That one entry illustrates the format; supply the complete selected closure. `consumerSha256` is the SHA-256 of the exact driver file passed to Node, including its final newline. `sourceManifest.sha256` is the SHA-256 of the manifest's actual bytes. `sourceSha256` hashes the original capture-backed declaration; `captureSha256` hashes its original capture manifest.

The public merchant origin is the reviewed canonical HTTPS origin. The driver binds the actual local merchant to a retained loopback port and uses that listener for operator/customer requests. The path is fixed, with no query string or fragment. The two atomic amounts must be distinct decimal integer strings. Public terms can be shared; private input paths, raw captures, browser tokens and worker credentials stay with the receiving operation.

The output directory must be separate from the selected source tree. On first execution it must not exist; the driver creates it with mode 0700 and its files with mode 0600. A subsequent invocation accepts only the same private directory and the exact input-byte hash retained in its original intent.

## Execute on the provider worker

Use the existing provider operation ID and its same worker. Preserve its returned captures and make the source and runtime selections explicit in the input. Do not acquire the tables again to run the receiving stage.

```sh
node --check /srv/nocodb-receiving/source/stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/receiving/native-consumer.mjs
node /srv/nocodb-receiving/source/stellar/scf-starforge-20261009/sf30-seller-sdk/nocodb/receiving/native-consumer.mjs --input /srv/nocodb-receiving/private/receiving-input.json
```

Retain stdout and the process exit code in that same operation. The driver prints completed `NOCODB` checkpoints and writes the detailed native references to `progress.json`. `result.json` becomes `PASS` only when the composed sequence and cleanup complete.

## What the operation performs

| Stage | Actual original behavior and retained identity |
| --- | --- |
| Capture receiving | Checks both declaration hashes, original capture manifests, source bindings and all 1,200 original rows before opening a native workspace |
| Source authoring | Imports each complete capture, displays its original field selection, previews every row, records the real browser request UUID, saves one reviewed version and reopens the same version receipt |
| Publisher adoption | Opens the author's original publisher directory and target, then closes the authoring owner before the original direct or MCP publisher takes its lease |
| Actor publication | Creates one reviewed native plan, extracts and publishes all 200 projected actor rows, and compares the full native result |
| Film edition A | Creates reviewed plans for both output orders, publishes A, checks the complete 1,000-row result, prepares the original five-file deployment package and starts release A |
| Original buyer handoff | Reads the real 402 offer and retains the exact original SF88 handoff/configuration pinned to edition A |
| Film edition B | Extracts through the original MCP publisher with one request UUID, verifies its same-request replay, reviews against the current target and publishes B |
| Publication recovery | Deliberately withholds only the returned native publication response, then uses the original publisher recovery method to reconcile the already-written edition |
| Managed deployment | Prepares/stages B, inspects the original release difference, selects B while A runs, restarts the same merchant port and checks the changed amount |
| Snapshot continuity | Uses A's original cursor after B is active and compares every returned A value; separately verifies the complete current B rows |
| Customer receiving | Generates one original customer export in the browser, deliberately drops its HTTP reply, uses the original Inspect action, downloads all six files and verifies their original manifest hashes |
| Customer request | Imports the downloaded original client, builds its snapshot-pinned request offline, checks the native per-file HTTP range and retains the complete archive |
| Rollback and reopen | Stops B, selects A, reopens the original MCP owner, starts A against the same current dataset, and checks the expected old price with the current B snapshot |
| File continuation | Closes the owning MCP instance, reopens it, then continues the same exported client bytes using the original export ID, manifest hash, file hash and byte offset |
| Final custody | Rechecks all selected source and capture identities, writes the native outcome, and closes every service owned by the receiving process |

The controlled reply losses occur after actual original operations have completed. Their original response bytes are retained privately. The result records that these were deliberate receiving checks; it does not label them as provider outages.

The full row comparison uses the original projection implementation to derive expected values and compares those against the original published dataset pages. It verifies complete delivery, chosen order and retained snapshot identity. It does not claim an independent implementation of the provider's numeric conversion.

## Continue after an interrupted receiving process

Use the same exact input file and output directory. Do not start a second consumer while its original process or native owner is still alive. The existing provider/native operation should inspect its original process and service state before resuming.

The driver retains native request IDs, browser mutation arguments, plan IDs/digests, source versions, deployment references and customer export identity in `intent.json` before dependent work. The original authoring and publisher stores own completion and request recovery. In particular:

- A saved source import or version request is replayed with the same original UUID and parameters.
- A saved plan is recovered from native history by its operation-specific title and source binding before another save is considered.
- An extraction keeps its original UUID. Recovery inspects a complete native candidate; it does not silently re-read the provider.
- An uncertain publication is reconciled against the original target before another command is considered.
- A customer export is inspected by its original ID. A completed export is received without another generation.
- A completed `PASS` result with the same input hash returns immediately without repeating the native operation.

An unresolved original native state is preserved and reported through the actual error and native store. Resolve it using the product's original APIs. Do not delete the publisher database, change source hashes, substitute a fabricated result, or create a new operation ID to disguise the previous outcome.

The receiving input is immutable after execution begins. If source needs a correction before the first native dispatch, retain the previous source selection and update the one still-undispatched operation's declared input through its supported host mechanism. After dispatch, preserve the executed source and its result before coordinating a continuation.

## Return the useful result

Return the following to the original provider/product thread:

- Executed source commit, consumer SHA-256, source-manifest SHA-256 and Node version.
- Both actual capture manifest hashes, original declaration hashes and complete row counts.
- Native source version, publisher plan/run/review/publication IDs, snapshot identities and the original deployment/release digests.
- Original SF88 handoff/configuration identity, with the payment scope stated accurately.
- Original customer export ID, six file hashes, archive hash/size and actual browser screenshots.
- `result.json`, stdout/exit code, and any precise native error with its original request identity.

Keep the complete private output with the receiving operation so another owner can reopen it. Share only the selected public projection and public source through the approved publisher/repository flow. The source declaration, capture metadata, raw table data and tokens are not public repository fixtures.

## Original implementation references

- [Source adapter](README.md) and [provider intake](PROVIDER_INPUT.md)
- [Source authoring](WORKSPACE.md) and [managed deployment](DEPLOYMENT.md)
- [Original NocoDB publisher entry](publisher/model.mjs)
- [SF82 merchant release store](../../sf82-seller-pilot/README.md)
- [MCP publisher operations](../../../../stellar-forge/mcp-merchant-operator/PUBLISHERS.md)

Read the actual selected source alongside these guides when applying a later compatible product version. Runtime source hashes, rather than a guessed release label, identify the operation that executed.
