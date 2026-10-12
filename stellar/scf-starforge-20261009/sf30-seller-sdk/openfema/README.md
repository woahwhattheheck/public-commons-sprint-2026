# OpenFEMA Public Assistance workspace

A complete local operator for acquiring FEMA Public Assistance records, building reviewable portfolios, publishing selected tables through Stellar Forge, and handing the complete workspace to another operator.

The application keeps original source responses, immutable source editions, successive portfolio versions, analyst decisions, native dataset packages, seller releases and received customer files in one private directory. It runs on the maintained Stellar Forge dataset, publisher and buyer engines. The interface uses a compact grayscale layout with seven work areas: Sources, Portfolios, Review, Changes, Publication, Customers and Handover.

## Start the operator

Use the installed Stellar Forge distribution with Node 24 and its normal runtime dependencies:

```sh
openfema-workspace --workspace /absolute/private/openfema
```

The workspace directory is created with mode 0700. Its parent must be an owned canonical directory. Open the session URL printed by the command. The URL fragment contains the local session capability; the page removes it from the address bar after retaining it for that browser session. The server listens on 127.0.0.1 and rejects foreign origins.

To continue existing publisher and customer work, select the original private runtime and buyer inbox:

```sh
openfema-workspace \
  --workspace /absolute/private/openfema \
  --inbox /absolute/private/original-buyer-inbox \
  --release-runtime /absolute/private/original-release-runtime.json
```

The source-tree equivalents are `node stellar/scf-starforge-20261009/sf30-seller-sdk/openfema/workspace.mjs` and `node stellar/scf-starforge-20261009/sf30-seller-sdk/openfema/cli.mjs`. The installed commands include their source dependencies and browser asset manifest.

Only one process writes a workspace at a time. Keep using its live UI, MCP endpoint or Applications session while it is open. Close that process before operating the same directory from a separate CLI process. The writer uses the kernel's original file lease, which is released when the owning process ends.

## 1. Acquire a complete source edition

In **Sources**, choose one or more disaster numbers, states or declaration dates. Selectors of different kinds combine; multiple values within one selector are alternatives. Date bounds are inclusive. State selections are normalized to uppercase. The application first acquires the designated declarations, derives their disaster cohort, and then acquires every applicant and obligated project for those disasters.

For example, this captures the complete DR 4724 cohort:

```sh
openfema capture \
  --workspace /absolute/private/openfema \
  --disasters 4724 \
  --label "DR 4724 Public Assistance"
```

The foreground capture command waits for the saved source operation. Its final response contains the source edition ID and source counts. The UI displays progress per source, original request URLs and returned pages. Pause and resume use the same capture identity and saved continuation.

The maintained HTTP acquisition reads all pages in stable source order, records original bytes, retains dataset metadata and field definitions, and checks the dataset refresh before and after acquisition. A change during capture restarts that dataset once from its original beginning. A provider retry deadline is saved with the operation and shown in the UI. Reopening the operator exposes interrupted acquisition for continuation.

A source edition covers three native datasets:

| Source | Version | Meaning | Identity |
|---|---:|---|---|
| DisasterDeclarationsSummaries | 2 | Disaster declarations and designated areas | disasterNumber plus placeCode |
| PublicAssistanceApplicants | 1 | Public Assistance applicant records | Source-instance UUID; joined to projects by disasterNumber plus applicantId |
| PublicAssistanceFundedProjectsDetails | 2 | Obligated project worksheets | gmProjectId |

Projects before obligation are outside the funded-project feed. The applicant UUID is an instance identifier; it can change on a full reload and is not a cross-dataset or longitudinal applicant key. A project can have multiple candidate applicant rows. Those candidates remain available for analyst selection.

Complete source packages can be received from another acquisition machine without fetching the same cohort again:

```sh
openfema receive-source \
  --workspace /absolute/private/openfema \
  --bundle /absolute/path/OpenFEMA_Original_Source_Bundle.json.gz
```

Use an exported OpenFEMA source bundle. The receiving path checks its full inventory and original identities, then preserves its edition ID. It accepts JSON or gzip JSON; the decoded package capacity is 256 MiB. Original source packages can be downloaded from Sources or Handover.

## 2. Build and review the portfolio

In **Portfolios**, choose the retained source edition, name the portfolio and set its criteria. Criteria support disaster, state, applicant, damage category, county, declaration date and federal-obligation bounds. Amount bounds are decimal USD values. Each saved revision produces an immutable portfolio version; prior versions remain selectable.

The tables are:

- **Disasters:** disaster activity, distinct applicants, included/excluded projects and the four financial measures.
- **Applicants:** original candidate records, chosen applicant identity, associated activity and review.
- **Projects:** original project identity and fields, exact amounts, source links and review disposition.
- **Damage categories:** grouped project activity and the same separate amount measures.
- **Declarations:** original designated areas and declaration attributes.
- **Issues:** missing or ambiguous joins, conflicting identities, malformed source amounts and stale analyst choices.

Table search and sorting operate over the complete saved table. The visible page can contain up to 1000 records; exports include all retained rows. Source declarations and applicants remain present even when their selected project activity is zero, making empty activity distinguishable from absent source records.

In **Review**, inspect the original detail before recording a decision. Set status, priority, owner, due date and disposition; add a note that explains the decision. For ambiguous applicant joins, select the intended original applicant row and save a note. A later source edition that no longer contains that choice exposes it for review. Project dispositions inherit applicable applicant and disaster decisions. Each review is retained in a new version; acceptance adds the selected version and acceptance note to the saved history.

The source measures remain separate:

| Measure | Interpretation |
|---|---|
| Project cost | projectAmount; estimated project cost excluding administrative costs |
| Federal obligations | federalShareObligated; federal funding available for the approved worksheet |
| Total obligations | totalObligated; includes recipient/subrecipient administrative amounts |
| Mitigation | mitigationAmount; mitigation amounts can contain negative adjustments |

Money is parsed as exact USD cents with integer arithmetic, including negative adjustments. Missing values and conflicting identities have their own counts. A conflicting primary-key record is excluded from financial totals while its alternatives remain inspectable. The four measures are never added together. Source numeric lexemes are retained during acquisition so a large identifier or precise amount does not pass through IEEE 754 rounding.

FEMA describes these as operational FAC-Trax/Grants Manager records and distinguishes them from official federal financial reporting. Its current project metadata also describes restored records following a system migration. Both context and original refresh observations travel with the edition.

## 3. Compare changes

Use **Changes** to compare two saved versions. Project comparison uses gmProjectId and preserves before/after values, including missing versus null. Hash and refresh timestamps do not become substantive project changes on their own.

The result records additions, removals, changed project fields, amount differences and source-scope compatibility. Changing only a display label, note or page size does not create a different acquisition scope. Review scope changes before interpreting additions and removals. The downloadable comparison includes the complete result even when the screen shows a shorter preview.

## 4. Publish a retained table

In **Publication**, select a portfolio version and table, then prepare a dataset. The application creates the original SF30 CSV/config package and includes its full portfolio, source edition, metadata, dictionaries and original page bytes as provenance companions.

Inspect and query that dataset before preparing a release. Dataset money columns are strings carrying exact decimal values; filters and sorts are declared by the maintained dataset handler. The supported publication capacity is one million rows and 256 MiB of CSV per dataset. Query defaults are 50 rows and the maximum query page is 250 rows.

Prepare a release using the intended public origin, route path and actual SF30 payment terms. The required payment object uses scheme `exact`, network `stellar:testnet` or `stellar:pubnet`, the selected asset, positive integer amount string, payTo destination and maxTimeoutSeconds. Use the merchant's original configured terms and private runtime.

Preparation stages a native dataset release. Inspect it, select the current release generation, and activate/start it through the same operator. Stop and rollback use the original SF82 controls and retain their generation history. Payment, facilitator behavior, dataset serving and seller recovery are handled by those maintained engines.

## 5. Receive customer work

In **Customers**, use the original configured buyer inbox. Inspect the selected existing intent IDs, then receive them through the native SF88/SF100 path. The receiving result includes the original five-file customer delivery and its hashes. Once retained in this workspace, those files remain downloadable offline.

MCP and Applications clients use the same native actions and workspace identity. A large retained output can be received through the maintained byte-range download path, resumed after interruption and reopened offline. See [MCP.md](MCP.md) and [MANAGED.md](MANAGED.md) for the complete 35-tool contract, host-declared workspace/source aliases, typed client, launcher and customer download flow.

## 6. Export and hand over the complete workspace

**Handover** offers three useful delivery forms:

- **Standalone HTML report:** all six complete tables, all analyst notes, criteria, interpretation and source/version identities. It is printable and has no network or JavaScript dependency.
- **Portfolio JSON or spreadsheet CSV:** complete machine data or an analyst spreadsheet. Spreadsheet exports neutralize leading formula characters; native machine CSV preserves the exact field values.
- **Complete workspace ZIP:** every retained source object, source edition, portfolio version, decision, dataset, publisher, release package, operation and received customer file.

Pause active source capture before making a complete backup:

```sh
openfema backup \
  --workspace /absolute/private/openfema \
  --out /absolute/private/OpenFEMA_Complete_Workspace.zip

openfema inspect-backup \
  --archive /absolute/private/OpenFEMA_Complete_Workspace.zip

openfema restore \
  --archive /absolute/private/OpenFEMA_Complete_Workspace.zip \
  --workspace /absolute/private/openfema-restored
```

Backup writes a new output file. The archive includes a manifest with each original path, byte length and SHA256. Receiving verifies the full inventory before installing it into a distinct private directory. It preserves the original workspace UUID.

At a new location, receiving adopts each original dataset publisher through its maintained recovery API and stages corresponding native releases with the new absolute dataset binding. Original source, query contract, payment terms, runtime, prior release bytes and release selection history remain intact. Open **Publication**, choose the corresponding restored release and activate it when ready. Receiving itself leaves publication selection unchanged.

If receiving is interrupted, repeat the same restore command with the exact archive and directory. It resumes the original publisher adoptions and deterministic release identities, then commits the resulting workspace index once. A completed repeat returns the retained receiving result. The archive capacity is 1 GiB, using ordinary ZIP entries; individual retained files have a 256 MiB limit.

The live complete-workspace download is cached for its current workspace revision. It has byte length, content SHA256, ETag and byte-range support. A state change produces a new archive; a previously saved report or source export remains immutable.

## Automation and CLI

All UI actions are available through the native action interface:

```json
{
  "action": "portfolio.compare",
  "payload": {
    "beforeVersionId": "COPY_THE_RETAINED_VERSION_ID",
    "afterVersionId": "COPY_THE_RETAINED_VERSION_ID"
  },
  "operationId": "my-original-comparison",
  "expectedRevision": 12
}
```

Copy IDs and the displayed revision from your workspace. Submit a saved request with:

```sh
openfema action \
  --workspace /absolute/private/openfema \
  --request /absolute/private/request.json
```

The original operation ID returns its prior result on a repeated request. An interrupted operation resumes from its retained request and context. Changed inputs require a new operation. Read the current action contract with `openfema schema`, retained state with `openfema view`, or an existing operation with `openfema operation --operation-id ORIGINAL_ID`; each command also takes `--workspace`.

Source capture is asynchronous through the action/UI interface. The dedicated capture command waits for completion; `action --wait` also waits for active captures. A closed process does not keep fetching in the background.

## Source references and implementation

- [FEMA OpenFEMA datasets](https://www.fema.gov/about/openfema/data-sets)
- [Funded-project dataset metadata](https://www.fema.gov/api/open/v1/OpenFemaDataSets?$filter=name%20eq%20%27PublicAssistanceFundedProjectsDetails%27)
- [FEMA API samples and source terms](https://github.com/FEMA/openfema-samples)
- [Current retained field contract](SOURCE_CONTRACT.md)

`capture.mjs` owns acquisition and source receiving. `domain.mjs` owns exact financial aggregation, joins, reviews and comparisons. `core.mjs` owns saved operations and portfolio versions. `dataset.mjs` composes native publication and buyer delivery. `exports.mjs` and `relocation.mjs` compose complete workspace receiving with the maintained native publisher. The browser and CLI use the same core.

This product uses the FEMA OpenFEMA API. FEMA does not endorse this product.
