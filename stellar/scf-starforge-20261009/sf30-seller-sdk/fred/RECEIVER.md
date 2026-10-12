# Run and reopen one economic-edition receiving operation

The receiver drives the delivered FRED application from complete original input through its saved review, native merchant, configured SF88 customer, two actual cursor pages, complete source and CSV deliveries, project export, and received-project reopen. Its browser phase opens the actual operator application in both original and received directories and downloads the retained files.

`starforge fred receiver` and `node cli.mjs receiver` call the same implementation. The source directory is `stellar/scf-starforge-20261009/sf30-seller-sdk/fred/`.

## Launch with the existing operator configuration

Use Node 24, Linux util-linux `flock`, the existing installed native Stellar Forge dependencies, and the equipped worker's existing browser installation. Copy [receiver-config.json](examples/receiver-config.json) into a private directory and replace its explicit template paths and endpoints with the original configured resources. The receiver settings and original buyer configuration must be private regular files (mode 0600).

The configuration consumes these actual operator inputs:

| Input | Existing resource used |
| --- | --- |
| `buyerConfig` | SF88 Node Buyer configuration, including its original absolute runtime/state directories and operator profile |
| `paymentFile` | The merchant's public native payment terms; alternatively provide the same object in `payment` |
| `origin` | Canonical public HTTPS merchant origin already routed by the ingress or configured original buyer transport |
| `merchantPort` | Fixed loopback port to which that existing transport routes this merchant |
| `facilitator` | The original configured native facilitator endpoint |
| `browser.module` | Existing Playwright module specifier or installed absolute module path |
| `browser.executablePath` | Existing Chromium executable |
| `id` | Stable receiving operation ID, reused for all continuations |

For an existing loopback HTTP facilitator, explicitly set `allowLocalFacilitator: true`. The maintained native factory validates the selected URL. The native Buyer retains its original operator, signer, request controls, approval process, and per-attempt runtime settings.

Run from the complete source checkout:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/fred/cli.mjs receiver \
  --project /absolute/private/FRED_RUN \
  --config /absolute/private/fred-receiver.json
```

The installed equivalent is:

```sh
starforge fred receiver --project /absolute/private/FRED_RUN \
  --config /absolute/private/fred-receiver.json
```

The original operator approves in the launch terminal. Progress records identify the current stage and retained checkpoint. The final JSON contains actual delivery files, native result records, original source/edition/snapshot identities, received-project directory, browser downloads, and screenshots.

The receiver has no overall journey timer. Its configured native Buyer keeps its existing attempt timeout, and the browser has a separate action timeout. Run a host supervisor with enough time for the original approvals and delivery, then use the same retained continuation if the host interrupts it.

## Complete original source is included

With `sources` omitted, the receiver imports the original complete [UNRATE table](sources/unrate-20261012.public-table.json). It contains 945 observations from 1948-01-01 through 2026-09-01, with the original missing marker at 2025-10-01. Its table text is 17,369 UTF-8 bytes with SHA-256 `185b90004b852d00bbeef97cbafaae553ec6f1c8513b5a07ad56ca00d7218588`. Publisher, units, adjustment, update time and original retrieval time remain in the source and edition.

Use `sources: ["/absolute/original/capture.json"]` for another retained public table, public-table set, or complete API capture. Multiple source paths combine their complete public tables into one reviewed economic edition. The [macro starter](sources/MACRO_STARTER.md) supplies the original UNRATE, CPIAUCSL and GDP wrappers: 2,219 rows in their original monthly and quarterly meanings.

The receiver derives its project selection from the actual complete capture. The source's date basis and collection window travel through the same published manifest and customer projection.

## Adopt an already prepared operation

The existing project is reopened in place. The receiver reuses the matching original capture and saved review. Supply `publicationId` to select an already published edition with its retained review and original terms. Set the original request IDs explicitly when the project already has multiple customer requests:

```json
{
  "publicationId": "THE_ORIGINAL_64_CHARACTER_PUBLICATION_ID",
  "intents": {
    "page1": "ORIGINAL_FIRST_PAGE_INTENT",
    "page2": "ORIGINAL_NEXT_PAGE_INTENT",
    "source": "ORIGINAL_CAPTURE_FILE_INTENT",
    "csv": "ORIGINAL_CSV_FILE_INTENT"
  }
}
```

Those are additional fields in the complete private receiver configuration. For a fresh operation, stable IDs derive from its receiving ID. The receiver automatically adopts unambiguous matching saved requests; when a single existing first-page request has another limit, an omitted `query` adopts that original query. An explicit `query` retains the selected original request semantics. The second page always uses the first delivered page's actual next cursor and metadata.

Each native request prepares the original FRED binding, then calls the maintained Buyer. An existing intent recovers its original attempt. A retained attempt without its final result remains at that same intent and operation directory; the checkpoint identifies the exact native result to continue. Complete delivery bytes and native records are retained before subsequent stages.

## Continue after interruption

Repeat the same launch command with the original project, receiving ID and settings. Completed source/review/publication/export stages return their retained result. Customer stages continue their original stable intents. The checkpoint binds the source, buyer configuration, buyer state directory, payment terms, query and explicit intent selection.

Inspect that operation without starting any phase:

```sh
starforge fred receiver --project /absolute/private/FRED_RUN \
  --id scf-fred-unrate-20261012 --phase status
```

When native delivery has completed, continue the browser phase directly:

```sh
starforge fred receiver --project /absolute/private/FRED_RUN \
  --config /absolute/private/fred-receiver.json --phase browser
```

Browser settings can be supplied or corrected in that same configuration independently of the original native operation identity. The browser continuation reopens saved requests in the original customer UI, downloads the original paid page, inspects source and saved merchant review in both workspaces, and exports their complete project bundles.

The actual browser artifacts and partial progress survive in `browser-current.json` and its referenced private attempt directory. A completed browser phase returns its retained result on the next invocation.

## Retained operation layout

Everything belongs to the same private project:

| Location under `receivers/RECEIVER_ID/` | Retained work |
| --- | --- |
| `receiver.json` | Stable operation plan, current phase, completed stages, native intent IDs and original output identities |
| `original-capture.json` | Complete validated original source capture |
| `merchant-session.json` | Exact original publication, snapshot, resource and owned loopback serving address |
| `deliveries/page-1.json`, `page-2.json` | Actual delivered dataset pages and their original cursor relationship |
| `deliveries/capture.json`, `observations.csv` | Actual complete customer source and CSV file deliveries |
| `deliveries/*-native-result.json` | Original SF88 result record for each selected request |
| `project-bundle.json` | Complete source, reviews and merchant plans with the original project identity |
| `received-project/` | Reconstructed original edition and project reopened from that bundle |
| `browser-current.json`, `browser-*/` | Actual browser phase progress, screenshots and original downloaded files |

The original Buyer journal stays in its existing configured state directory. The portable project reconstructs original source, review and publication identities; the receiving report points back to the original customer intents and delivered result files.

## Programmatic operation

`receiver.mjs` exports `runFredReceiver({directory, configFile, phase, signal, onProgress})` and `readFredReceiver({directory, id})`. It composes the existing application functions; ordinary project commands and the browser continue to operate the same retained project.
