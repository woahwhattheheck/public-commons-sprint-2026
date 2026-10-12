# DBnomics economic workspace

A complete economic source and analyst workspace on Stellar Forge's maintained source-dataset publisher. It connects current provider discovery, exact time-series capture, retained source editions, observation notes, economic reports, reviewed customer datasets, native merchant releases and original Buyer receiving.

The console uses the existing local publisher application. It adds an economic workbench with five views: **Sources**, **Observations**, **Analysis and notes**, **Compare editions**, and **Customer edition**. The original candidate review, version publication, merchant offer and Buyer configuration remain available in the same application.

## Start the complete included operation

Linux, Node 24 LTS and util-linux `flock` are required. Use the maintained repository dependency installation or installed merchant package. From the SCF source root:

```sh
node sf30-seller-sdk/dbnomics/cli.mjs receive \
  --workspace /absolute/private/dbnomics-insee \
  --input /absolute/source/sf30-seller-sdk/dbnomics/examples/insee-ipc.receiving.json
```

The receiving command adopts the complete two original INSEE responses, saves source-bound analyst notes, creates four complete reports in JSON/CSV/HTML, extracts and reviews the original native customer dataset, publishes that exact snapshot, exports the complete source/notes/report handover, imports it in a receiving project and reopens the original publication. Its saved result names the actual IDs, hashes, files and outcome. Repeating the same command continues its original child operations.

The included originals contain **36 annual observations and 432 monthly observations** for INSEE's France/all-households index **including imputed rents**, base 2015, through 2025. The provider dataset update is 2026-01-29; actual original retrieval was 2026-10-12. Full source names, attributes, dataset metadata and receipts are included. [SOURCE.md](./SOURCE.md) identifies the original URLs, byte hashes and license sources.

The configuration's four reports are original levels, annual one-year change, monthly twelve-month change and monthly values rebased to January 2015 = 100. Original values and calculated values have separate fields. The two growth calculations preserve their different observation frequencies.

Open the same project:

```sh
node sf30-seller-sdk/dbnomics/cli.mjs serve \
  --workspace /absolute/private/dbnomics-insee --port 8459
```

Use the printed loopback URL. The process holds the original publisher's workspace lock; stop that process before opening the same project from another CLI. Private retained directories use mode 0700 and retained files use 0600. Public source examples are copied into those private stores with exact bytes.

## Discover and acquire another original source

The provider panel supports providers, provider metadata, datasets, a selected dataset, full-text search and series discovery with exact dimension filters. Each result shows the original query, page and receipt. Select actual `provider/dataset/series` IDs from the results.

```json
{
  "kind": "series",
  "provider": "INSEE",
  "dataset": "IPC-2015",
  "query": "including imputed rents",
  "limit": 20,
  "offset": 0
}
```

Save a discovery request and run `discover --input DISCOVERY.json`. The acquisition input is:

```json
{
  "id": "my-original-economic-acquisition",
  "selection": {
    "title": "Reviewed economic source",
    "seriesIds": ["PROVIDER/DATASET/EXACT_SERIES"]
  },
  "timeoutMs": 45000
}
```

Run `acquire --workspace PROJECT --input ACQUISITION.json`. Each selected series uses a focused v22 request with `observations=1&align_periods=0`. All original observations, missing values, period strings, numeric tokens, provider attributes and source metadata are retained. A provider's documented :latest` dataset redirect is recorded together with its actual resolved dataset identity.

A refresh creates another retained edition:

```json
{"id":"my-original-refresh","captureId":"EXACT_RETAINED_CAPTURE_SHA","timeoutMs":45000}
```

Use `refresh` with this file. The prior capture remains available for full revision comparison. Provider Retry-After is retained as an absolute time. The original operation ID and input remain the continuation authority after a returned failure or interrupted response.

## Work with the retained edition

Observation pages come from the saved full capture. They support series selection and text search. Facets count all retained rows. Original NA/null states, source attributes and unsupported period/frequency combinations stay visible.

Notes can apply to an entire edition or an exact observation. The browser keeps dirty drafts and uses an expected note revision to save. A concurrent update requires reloading and reviewing that revision. A frozen report carries its selected note revision and complete analyst notes.

Analysis supports:

| Method | Calculation |
| --- | --- |
| Level | Original value, with original missing state |
| Difference | Current minus the original value at the exact calendar-period lag |
| Percent change | 100 × (current / exact-lag original value − 1) |
| Index 100 | 100 × current / explicitly selected original base-period value |

A lag counts periods within each series' frequency. Missing periods are not skipped. Unsupported calendar semantics, missing bases and zero denominators produce an explicit unavailable calculation. Derived arithmetic uses IEEE-754 numbers; original numeric lexemes remain separately retained and published as lossless text. Source-to-source decimal revisions use the maintained exact decimal difference function.

The analysis chart labels its actual row coverage. JSON, CSV and HTML downloads contain the full saved report, regardless of the visible page. CSV preserves original values, source and base observation identities, derived values, notes, and capture/response hashes. HTML includes every saved report row, methodology, original receipts, source terms and analyst notes.

## Review and publish the customer dataset

Save a query against the current source hash. The selection includes exact capture, series, date bounds, missing-value policy, source reuse review and optional calculation.

The workbench prepares a native plan with all original lossless columns. Original values, dimensions and attributes use text columns; the missing flag uses the original Boolean encoding. The original dataset handler owns filtering, sorting, pagination and snapshot selection.

The browser's **Create original candidate** action records the plan under a stable operation ID and starts one retained extraction UUID. Open the resulting native run in the existing publisher interface to inspect the real rows, record review against the actual target and publish.

The CLI offers the same sequence:

```sh
node sf30-seller-sdk/dbnomics/cli.mjs template --workspace PROJECT --query QUERY --out PLAN.json
node sf30-seller-sdk/dbnomics/cli.mjs save-plan --workspace PROJECT --input PLAN_OPERATION.json
node sf30-seller-sdk/dbnomics/cli.mjs extract --workspace PROJECT --input EXTRACTION_OPERATION.json
node sf30-seller-sdk/dbnomics/cli.mjs publisher-help
```

`PLAN_OPERATION.json` contains `{id,plan}`; the plan is the complete reviewed template. `EXTRACTION_OPERATION.json` contains `{id:<one UUID>,planId:<saved integer>}`. The original publisher commands provide inspect, review, publish, recover and Buyer handoff. Review or publication uncertainty is reconciled against that same run and actual version store.

## Merchant and customer receiving

[RECEIVING.md](./RECEIVING.md) documents the full source handover, release configuration and native Buyer continuation. `release-prepare` exports the published candidate, original provider bytes, full capture, query review, source terms and receiving guide through the original SF82 source-files contract. `release-stage`, `release-activate`, `release-run` and rollback use the maintained release store and process lifecycle.

When the configured merchant is running, the original publisher reads its actual offer for the retained snapshot and prepares the original SF88 Buyer configuration. Use the original Buyer intent, payer account, facilitator and authorization flow. The complete `receive` command performs the included source, analysis, publication and editable receiving operation. Optional `release` settings prepare and stage the original merchant from its existing public terms. Adding `customer` continues the actual SF82 merchant, all original SF88 Dataset pages, SF36 accounting and SF100 receiving in one retained operation. Every delivered typed observation is compared with the reviewed source and the completed delivery is reopened.

## Local client and MCP

`client.mjs` exposes a local HTTP client; `client.d.ts` provides its domain types. It requires the printed loopback origin:

```js
import {createDbnomicsClient} from './sf30-seller-sdk/dbnomics/client.mjs';
const workbench = createDbnomicsClient({origin:'http://127.0.0.1:8459'});
const status = await workbench.status();
const capture = status.captures[0];
const rows = await workbench.observations(capture.captureId, {offset:0,limit:100});
```

`mcp --origin http://127.0.0.1:8459` serves the same local project over standard newline-delimited MCP stdio. Its tools cover discovery, capture/refresh, original byte retrieval, source comparisons, notes/reports, native publication, release and Buyer preparation. Retain the original operation ID when a call loses its response; `dbnomics_operation` reads the saved result. Cancelling a waiting MCP request does not create another operation.

## Source and limits

Official contracts and exact included receipts are in [SOURCE.md](./SOURCE.md). The selected source is bounded by 100 exact series, one million observations and the documented file capacities. Discovery is paginated independently. Choose smaller complete source groups when provider responses exceed the selected capacity.

DBnomics' aggregate database terms and each original provider's terms remain part of every capture/report/customer source package. Review the original provider's current reuse terms for the intended customer delivery. The implementation workshare covers acquisition, source revision handling, analyst workflows, publication and receiving.


## Python Analysis and editable economic workbooks

The **Python Analysis and editable workbooks** section prepares an exact saved
capture, selected complete reports and notes revision for the original
Analysis workspace. The installed Python workflow builds a full economic
briefing, typed JSONL/CSV/SQLite exports, workbook and editable archive. Returned
Records workbooks are compared and reviewed through native DatasetChanges;
plain analyst notes can be appended with the original economic notes revision
check.

Use the complete [Analysis and workbook guide](ANALYSIS.md) and the original
`sf88-operator-buyer-cli/python/examples/dbnomics_economic_workbook.py`.
The typed client exposes `analysisSource` and `analysisSourceFile`; the same
operations are available in the CLI and direct MCP tools.
