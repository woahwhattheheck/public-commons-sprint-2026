# HUD Section 8 Income Limits

This application turns an original published HUD Income Limits release into an inspectable locality selection, a reviewed native dataset publication, a versioned merchant, and an original buyer handover. It reuses the maintained public XLSX reader, SF30 source publisher and dataset controller, SF82 dataset release lifecycle, and SF88 buyer preparation.

The operator works in one private Linux workspace. The national workbook, area definitions, methodology, source index, original HTTP receipts, exact locality index, saved publication plans, CSV candidates, reviews, dataset versions, merchant configuration, and customer preparation remain recoverable in that workspace.

## Published source contract

The original HUD index is <https://www.huduser.gov/portal/datasets/il.html>. The FY2026 Section 8 release became effective **May 1, 2026**. Its published workbook and documents are:

- <https://www.huduser.gov/portal/datasets/il/il26/Section8-FY26.xlsx>
- <https://www.huduser.gov/portal/datasets/il/il26/area-definitions-FY26.pdf>
- <https://www.huduser.gov/portal/datasets/il/il26/IncomeLimitsMethodology-FY26.pdf>

HUD explains on that index that its published PDF/Excel limits take precedence when documentation-system calculations differ. The reader therefore retains the published cells. A change in median family income does not justify recalculating the published ELI, very low, or low income values.

**Program identity stays explicit.** Section 8 Income Limits, MTSP/LIHTC limits, and ESG limits are different releases. This adapter accepts the published Section 8 workbook layout. The operator records the fiscal year and its Section 8 effective date, reviewer, and source note during intake. It accepts another fiscal year only when the original workbook has the same reviewed field contract, including its matching median-year header.

### Exact geography

The published FY2026 workbook has 4,764 locality rows. Its original ten-character `fips` identifier remains text. `state` and `county` remain their two- and three-character original strings; the five-character county identifier is their concatenation.

A county may contain multiple published localities, towns, or HUD income-limit areas. County selection includes every matching original locality. It never deduplicates to one arbitrary row per county or adds published thresholds across areas.

The source index preserves:

| Original workbook fields | Meaning retained by this application |
|---|---|
| `fips` | Original ten-character HUD locality identifier |
| `stusps`, `state`, `state_name` | Original state abbreviation, FIPS text, and name |
| `county`, `County_Name` | Original county FIPS text and name |
| `county_town_name` | Published locality or town name |
| `hud_area_code`, `hud_area_name` | Original income-limit area identity |
| `metro` | Original numeric 0/1 classification |
| `median2026` | Published median family income for FY2026 |
| `ELI_1` through `ELI_8` | Published extremely low income limits by family size |
| `l50_1` through `l50_8` | Published very low income limits by family size |
| `l80_1` through `l80_8` | Published low income limits by family size |

The normalized dataset has one observation per locality, metric, and applicable family size. Median family income has `family_size: null`. Its original source cell has no family-size axis. The other three metrics use family sizes 1–8. An unrestricted locality produces 25 observations.

Each observation carries the fiscal year, effective date, program, state/county/locality and HUD area identity, published amount as an exact safe integer, original value token as text, original field name, worksheet name, row and cell coordinates, and workbook SHA-256. The public dataset key is `fiscal_year, locality_id, metric, family_size`; a retained-release identifier additionally distinguishes revisions within the same fiscal year.

### Selection rules

The source selection accepts `states`, `counties`, `localities`, `areas`, `metrics`, and `familySizes`. The API accepts arrays or the comma-separated strings used by the desk.

Within a geographic field, entries are alternatives. Different populated fields are intersected. Empty geographic fields include every locality that satisfies the other fields.

```json
{
  "counties": ["17143", "17179", "17203"],
  "metrics": [
    "median_family_income",
    "extremely_low_income",
    "very_low_income",
    "low_income"
  ],
  "familySizes": [1, 2, 3, 4, 5, 6, 7, 8]
}
```

Selection accepts exactly these metric identifiers:

- `median_family_income`
- `extremely_low_income`
- `very_low_income`
- `low_income`

All published observations remain locality-level annual USD values. A housing study can import them by exact source key and perform its own explicitly chosen study logic. This module supplies the public source context and original published observations.

## Runtime and maintained dependencies

Use Linux with Node 22.16+ and util-linux `flock`. Workbook intake also needs Python 3.10+. The existing public workbook reader uses the Python standard library; no additional Excel library is installed.

The implementation reads the maintained `dataset-refresh/workbook/reader.py` through a fixed source URL. The HUD worker receives the original workbook on file descriptor 3, an exclusive JSONL output on descriptor 4, and the trusted original reader source on descriptor 5. The request contains the retained workbook hash/size and fiscal year. The worker uses the original `Workbook` class and exact source cells; it never supplies a new XML/Excel parser.

The authored dependency join used reader Git blob `226dd5862de8630735a57abb7c2493cf8df7bbe9`, SHA-256 `e4a18cbd7169566b61b2658baa62d33d8706dd0921941a62f10cc79c5a952cc5`, and the original SF82 `release-dataset.mjs` interface at source `3bd8231c7837ec578a2a404a0ce24085094092bc`. Distribution owners include those maintained files through their original source registrations.

The merchant path uses the existing selected SF30 runtime dependencies, including its original Stellar/x402 packages and validators. Reuse a complete installed source/runtime profile. Preserve the profile lockfile and source manifest when moving this workspace to another host.

## Start a workspace

From this component directory:

```bash
node cli.mjs init --workspace /srv/starforge/hud-operator
node cli.mjs serve --workspace /srv/starforge/hud-operator --port 8458
```

The server prints its actual loopback address with a session fragment. Open that address in the authorized browser. The desk moves the session key into browser session storage and removes the fragment from the displayed URL.

The HTTP server binds only `127.0.0.1`. Every API operation requires the original Bearer session and exact local Host/Origin checks. Source paths, version-store paths, and publisher paths are established by the host application rather than accepted from a browser request.

The desk has five areas:

1. **Published release:** acquire the four original official documents, or upload an existing complete original capture.
2. **Localities and values:** select the exact release and geographic/family dimensions, browse original localities and cells, and export public source observations.
3. **Review and publish:** save the selection into the original publisher, extract, inspect, review the displayed dataset target, and publish.
4. **Merchant and customer:** configure public payment terms, operate the original versioned seller, load its current offer, and prepare the original snapshot-pinned buyer configuration.
5. **Saved editions:** inspect native dataset versions, compare retained published source releases, and operate the shared SF82 seller release lifecycle.

A status refresh preserves unsaved source inputs. Publication plans retain their original source selection. Choosing another source release never silently rewrites those plans or published dataset versions.

## Acquire or import an original release

Create a small metadata JSON file:

```json
{
  "fiscalYear": 2026,
  "effectiveDate": "2026-05-01",
  "reviewer": "Source operator",
  "note": "Reviewed HUD FY2026 Section 8 index, workbook, area definitions and methodology."
}
```

For a direct public download:

```bash
node cli.mjs acquire --workspace /srv/starforge/hud-operator --metadata /srv/starforge/hud-metadata.json
```

Acquisition requests only the fixed official HUD HTTPS URLs for the selected fiscal year and index. It requires HTTP 200, keeps the final URL and original response metadata, streams within document limits, hashes the exact bytes, and checks document signatures before intake. Redirects are refused so an changed official destination is reviewed explicitly.

For an existing capture:

```bash
node cli.mjs import --workspace /srv/starforge/hud-operator --metadata /srv/starforge/hud-metadata.json --capture-dir /srv/incoming/hud-fy2026
```

The capture directory contains:

```text
Section8-FY26.xlsx
Section8-FY26.xlsx.capture.json
area-definitions-FY26.pdf
area-definitions-FY26.pdf.capture.json
IncomeLimitsMethodology-FY26.pdf
IncomeLimitsMethodology-FY26.pdf.capture.json
hud-income-limits-index.html
hud-income-limits-index.capture.json
```

The normalized retained index receipt is named `hud-income-limits-index.html.capture.json`. The browser accepts either index receipt name.

Each original capture receipt binds the fixed source URL, final URL, HTTP 200 status, retrieval time, bytes and SHA-256:

```json
{
  "url": "https://www.huduser.gov/portal/datasets/il/il26/Section8-FY26.xlsx",
  "final_url": "https://www.huduser.gov/portal/datasets/il/il26/Section8-FY26.xlsx",
  "retrieved_at": "2026-10-11T19:42:13.842808+00:00",
  "status": 200,
  "bytes": 771324,
  "sha256": "bbadf0a080112fc1492c7752692c041c6a4299aad0173873b732c3f892d9aee0"
}
```

The first complete release becomes the initial source selection. Later acquisitions join the retained release list and wait for explicit selection. Reimporting the same original document/receipt identities reuses that release. A fresh official capture can create a new retained observation even when published values remain unchanged; the source comparison shows the actual differences.

### Workbook review failures

The domain projection requires the exact 35-column Section 8 layout, a matching `medianYYYY` header, visible worksheet rows and columns, no merged data cells, original text identifiers, unique ten-character localities, and finite exact integer amount tokens. A formula, changed header, incomplete cell, hidden selection, or changed geography identity produces a cell/layout error before a release is finalized. The original bytes remain the source of the decision; the operator can inspect the official workbook and update the adapter when HUD publishes a new contract.

A complete national intake creates an immutable `localities.jsonl` index with original row and field values plus a projection manifest. Extraction reads that retained index rather than reparsing the workbook for every query.

## Publish the exact selection

The desk saves a plan with all source context columns and the original publisher’s explicit extraction limits. The default maximum is 250,000 observations and 128 MiB, with an explicit original row/metric/family ordering. The original CSV loader validates the generated dataset schema and query contract.

For direct operation:

```bash
node cli.mjs status --workspace /srv/starforge/hud-operator
node cli.mjs select --workspace /srv/starforge/hud-operator --input /srv/starforge/hud-selection.json
node cli.mjs plan --workspace /srv/starforge/hud-operator
node cli.mjs extract --workspace /srv/starforge/hud-operator --plan 1
node cli.mjs inspect --workspace /srv/starforge/hud-operator --run RUN_UUID --query 'limit=20'
```

The selection file binds the current workspace revision:

```json
{
  "expectedRevision": 1,
  "releaseId": "EXACT_RELEASE_ID_FROM_STATUS",
  "selection": {
    "counties": ["17143", "17179", "17203"],
    "familySizes": [1, 2, 3, 4, 5, 6, 7, 8]
  }
}
```

Use the actual release ID and revision returned by the retained workspace. Stale revision writes return `HUD_REVIEW_CHANGED`.

A saved publication plan contains the complete original source declaration, copied release documents/receipts/index, explicit selection, original dataset schema and extraction limits. The plan’s original `sourceHash`, `runtimeSourceHash`, query hash and digest remain bound by `openSourceDatasetPublisher`.

Extraction goes through its native `startExtraction` operation and original candidate CSV/config writer. It completes the entire selected observation set or records a failed/cancelled/interrupted run. It does not publish a truncated selection.

The review binds either a new dataset target or the original running target’s exact expected snapshot and revision. Publication delegates to the original version store and control channel. Keep the reviewer and review note concrete: fiscal year, geographic/family selection, original source cells and intended dataset target.

To initialize through the CLI, prepare:

```json
{
  "id": "ACTUAL_RUN_UUID",
  "initialize": true,
  "reviewer": "Publication operator",
  "note": "Reviewed the selected FY2026 published locality values and their original cells."
}
```

```bash
node cli.mjs review --workspace /srv/starforge/hud-operator --input /srv/starforge/hud-review.json
```

Then use the exact resulting review ID:

```json
{
  "id": "ACTUAL_RUN_UUID",
  "reviewId": "ACTUAL_REVIEW_UUID"
}
```

```bash
node cli.mjs publish --workspace /srv/starforge/hud-operator --input /srv/starforge/hud-publish.json
```

For a refresh, the original seller must be running so its private controller supplies the displayed snapshot/revision. The live desk performs that sequence without closing the workspace. Existing snapshot pins and native cursors keep their original selection.

## Native merchant and customer delivery

Configure the merchant using the original dataset compiler. The desk accepts only public payment terms: scheme, network, asset, amount string, pay-to address and timeout. The actual route includes the original optional `snapshot` query parameter. Amounts remain strings throughout.

The generated resource has the canonical public HTTPS origin/path chosen by the operator; the actual seller listens on its configured loopback port. Attach the existing ingress deployment to that listener as part of the host deployment.

For a direct original seller:

```bash
node cli.mjs serve --workspace /srv/starforge/hud-operator --port 8458 --start-merchant --facilitator https://FACILITATOR_ORIGIN
```

The configured native facilitator uses the original `HTTPFacilitatorClient` and `createNativeSellerServer`. An explicitly allowed local facilitator can be used for an owned local native runtime. The desk displays the actual seller mode returned by that engine.

Customer preparation first reads the actual seller’s health/offers, validates the exact snapshot-selectable dataset resource, and reviews its current payment alternatives. It then calls the original buyer preparation with a unique intent ID and the displayed offer digest.

The returned `hud` context binds:

- original fiscal year and effective date;
- retained release and selection identifiers;
- workbook hash and complete observation count;
- exact native dataset snapshot;
- source-key, value, cell and geography mapping for the receiver.

The downloaded original SF88 configuration continues through the maintained buyer workspace/acquisition/delivery workflow. Every page uses its original snapshot and query/cursor contract. The HUD source application does not introduce another payment ledger or page engine.

### Complete public source packet

The source panel and `source-packet` command export the four original HUD documents and their four original HTTP capture receipts in `stellar-forge.hud-public-source-packet.v1`. Each document and capture keeps its exact bytes and hash. The receiver verifies the packet and runs the original workbook reader again, preserving the release identity when the same parser is used.

```bash
node cli.mjs source-packet --workspace /srv/starforge/hud-operator --out /srv/delivery/hud-source-packet.json
node cli.mjs init --workspace /srv/starforge/hud-receiver
node cli.mjs import-packet --workspace /srv/starforge/hud-receiver --input /srv/delivery/hud-source-packet.json
```

The packet contains public source documents, their capture receipts and the release review. It can seed another customer workspace or an existing source-custody receiver. Customer selection and publication remain deliberate operations in that workspace.

### Receiver exports

**Public selection export** contains original retained release metadata, selection, all selected observations and cell references:

```bash
node cli.mjs export --workspace /srv/starforge/hud-operator --out /srv/delivery/hud-public-selection.json
```

**Publication handover** reads the exact source copied into a retained publisher plan and checks it against its candidate and snapshot:

```bash
node cli.mjs publication-handoff --workspace /srv/starforge/hud-operator --run RUN_UUID --out /srv/delivery/hud-publication-handoff.json
```

The receiver joins `fiscal_year, locality_id, metric, family_size`, reads `published_income_usd`, and retains `source_value`, `source_sheet`, `source_cell`, workbook hash and HUD area identity. County-level study teams keep every matching original locality before applying their own explicit area selection. These public source exports can be adapted to an existing private study importer without copying that private study’s models or decisions into this application.

## Shared SF82 deployment and lifecycle

The Saved editions panel stages the original native dataset package through the maintained SF82 implementation.

The prepared directory contains exactly:

| File | Original binding |
|---|---|
| `dataset.csv` | Exact retained publisher candidate bytes |
| `dataset.json` | Native dataset configuration referring to adjacent `dataset.csv` |
| `seller.json` | Original generated snapshot-selectable seller configuration |
| `source.json` | HUD release, original document identities, selection, candidate and receiver context |
| `binding.json` | Original version-store directory, contract hash, baseline snapshot and source hash |

The binding schema is `stellar-forge.dataset-release-binding.v1`. Its exact keys are `datasetDirectory`, `contractSha256`, `baselineSnapshot` and `sourceSha256`. The contract hash is computed by the shared `datasetContractSha256(native.describe())` helper, which removes the row count and snapshot before hashing the stable contract.

The adapter calls the original `prepareDatasetRelease` and then:

```js
stageRelease(root, {
  id,
  label,
  datasetPackage: absolutePreparedDirectory,
  runtime: { port, facilitator }
});
```

Preparation writes a temporary `.prepare-...` directory and validates all five files before an atomic rename. A retry consumes the complete original publisher candidate; the final package name is exposed only after preparation succeeds. Staging preserves the five files and their original hashes. Activation and rollback require the displayed expected release generation. Start invokes the original managed child via `runActiveRelease`; drain and close use its existing lifecycle. The shared dataset launcher opens the same private version store and retains its admission, snapshot response and controller behavior.

The desk can use either its direct original seller or its managed release seller. The selected owner holds the one native version-store writer. Stop and drain that owner before starting the other.

**Source selection, dataset activation, and seller-release selection are separate deliberate operations.** Changing the input release prepares future plans. Activating a retained dataset chooses its published data snapshot. Activating an SF82 seller release chooses the compiled merchant/runtime configuration. A seller release’s baseline snapshot identifies its prepared source; the original version controller owns the currently active data edition.

After staging and selecting a release, reopen it with:

```bash
node cli.mjs serve --workspace /srv/starforge/hud-operator --port 8458 --start-release
```

The release retains its own approved runtime facilitator settings. The existing SF82 operator can also operate the saved `seller-releases` directory.

## Release comparison

Comparison joins exact locality/metric/family keys across two retained releases for the selected geography. It separates added, removed, changed and unchanged observations.

A change record includes both original observation/cell contexts and the exact changed fields. Value changes and HUD area/name changes are explicit. Row movement alone is not a changed income value. The two source manifests retain their own workbook hashes, worksheet coordinates, fiscal years and effective dates.

```bash
node cli.mjs compare --workspace /srv/starforge/hud-operator --input /srv/starforge/hud-comparison.json --out /srv/delivery/hud-comparison.json
```

The input provides `before`, `after`, and an optional explicit `selection`. The full output preserves every matched change; the desk shows the first changes and downloads the complete comparison.

## Reopening and recovery

The HUD desk and original publisher use separate existing kernel-owned workspace leases. A closed or exited process releases those kernel leases. The application records atomic workspace revisions and immutable release directories; the original publisher owns its SQLite run/review history and native candidate recovery.

If a process exits after a complete release directory was renamed but before its desk entry was saved, reopening adopts that hash-verified release into the retained list. It preserves the prior source selection. An unfinished `.import-...` directory remains identifiable in the desk and can be explicitly discarded before another intake.

The original publisher converts an interrupted extraction to its retained interrupted state. Use its `recover` operation to adopt a complete candidate when available. Publication uncertainty is reconciled against the original target snapshot and stored CSV identity before another publication.

The desk never deletes a retained source release, publication plan or dataset version during ordinary refresh. Use the existing host backup for the complete private workspace and the installed runtime/source profile. Restore private file permissions and canonical absolute paths, or use the original host’s supported workspace migration process before reopening version-store bindings.

All CLI `--out` files are create-only. Live UI/HTTP mutations require the displayed source/release/target version identities as appropriate. External source changes are checked again by the native publisher before producing or publishing a candidate.

### Operational limits

- Four original source documents and original receipts are required for complete intake.
- Workbook input is limited to 16 MiB; the maintained reader also enforces its original expanded/cell/worksheet limits.
- The normalized locality index is limited to 64 MiB.
- Up to 512 complete source releases can be retained in one HUD workspace.
- Locality browsing uses pages of at most 100 localities; its cell values stay source-bound.
- Extraction uses the original row, byte, row-size, deadline and order limits.
- Public long-form exports can be large for national selections. Use exact geographic selection when the receiver needs a regional study.
- Python runs only for workbook intake. Retained locality review, plan selection, native publication and buyer operations reuse the saved index.

## Source organization and interfaces

| File | Role |
|---|---|
| `contract.mjs` | Exact published fields, types, family/geographic selection and source descriptor |
| `hud-reader.py` | HUD domain checks over the original maintained Workbook reader |
| `release.mjs` | Official capture retention, reader bridge, source verification and comparison |
| `driver.mjs` | Adapter to original `openSourceDatasetPublisher` |
| `application.mjs` | Same-workspace source selection, original publisher and merchant composition |
| `delivery.mjs` | Source-bound publication and original buyer handover |
| `sf82.mjs` | Prepared native dataset package and shared managed release lifecycle |
| `server.mjs` | Authenticated local operator HTTP surface |
| `index.html`, `style.css`, `browser.mjs` | Industrial operator workflow |
| `cli.mjs` | Direct and foreground command-line operation |

The source-query inspection exposes a plain `serviceQuery` descriptor alongside the original `columns`, `columnTypes` and `parameters`. The shared source renderer can display the HUD protocol, fiscal year, effective date, workbook/selection identities and original columns without another renderer or query engine.

## One complete native source operation

`native-journey.mjs` is a single maintained operator example over the original eight public FY2026 capture files. It keeps the workspace and every completed phase on disk. Run it once through the host's existing accepted compute operation:

```bash
node --max-old-space-size=192 native-journey.mjs --capture-dir /srv/captures/hud-fy2026 --workspace /srv/native/hud-workspace --output /srv/native/hud-results --python python3
```

It reads the national workbook with the original parser, publishes 75 original observations for Peoria/Tazewell/Woodford, publishes a second 50-observation selection through the same version store, retains the first snapshot/cursor, prepares the original SF88 configuration, delivers complete original private-controller pages through SF100, stages and runs both shared SF82 releases, rolls back, receives the eight-file public source packet in another workspace, and reopens the original desk and publication handover. The local example uses the existing challenge-only seller mode and original public fixture payment tuple. Dataset pages are explicitly recorded as authenticated operator previews.

The result directory receives `progress.json` after every phase and `native-result.json` after full completion. A failed operation retains its active phase, source, publication history, candidate, version state and error; continue that same workspace through the original application APIs and operator commands. The script rejects existing workspace/result directories so an accidental second dispatch cannot overwrite a retained operation.

The operation requires Node 24+, Python 3.10+, `flock`, the original SF30/SF82/SF88/SF100 source closure, and the installed maintained runtime dependencies. It creates no browser process, installs no packages and uses no GitHub Actions. The public FY2026 workbook expected by this operation is 771,324 bytes with SHA256 `bbadf0a080112fc1492c7752692c041c6a4299aad0173873b732c3f892d9aee0`.

