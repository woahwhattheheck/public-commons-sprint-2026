# Turbolong operating data and period reports

This guide covers the complete data-to-report workflow in the Turbolong operations application. The catalogue and runtime preserve the original Dgetsylver/TurboLong source at commit `f017de605bb020bf3d7f4285aae4c654508e8d86`; the selected source has 276 files. Runtime installation and commissioning are described in the application and runtime guides.

## Select an operating period

Create the period before acquiring or importing its data. A period has a name, an explicit network, and `startsAt` / `endsAt` timestamps with UTC offsets. Bounds are half-open: an observation at the start belongs to the period; an observation exactly at the end belongs to the following period.

The original rate Worker records snapshots every 900 seconds. `expectedSnapshotIntervalSeconds` defaults to 900. Supply `expectedSurfaceIntervalSeconds`, `expectedHealthIntervalSeconds`, and the actual `surfaces` when evaluating continuity. The default operating health dimensions are `keeper`, `alerts`, `snapshots`, and `flows`. A later amendment creates a new period version; prior acquisitions, source records and analyses retain their original selection.

An example definition for a completed calendar month is:

```json
{
  "name": "September mainnet operations",
  "network": "mainnet",
  "startsAt": "2026-09-01T00:00:00Z",
  "endsAt": "2026-10-01T00:00:00Z",
  "expectedSnapshotIntervalSeconds": 900,
  "expectedSurfaceIntervalSeconds": 900,
  "expectedHealthIntervalSeconds": 900,
  "surfaces": [
    "application",
    "telemetry",
    "rpc"
  ],
  "healthDimensions": [
    "keeper",
    "alerts",
    "snapshots",
    "flows"
  ],
  "acceptance": {
    "executedMainnetHarvests": 50,
    "rateHistoryDays": 30,
    "consecutiveGreenDays": 14
  }
}
```

Set the cadences and surface IDs to the actual monitoring arrangement. The example declares a scope; it supplies no observations. Save deployed vault definitions with their actual strategy, pool, share-token, asset symbol and network. Declared pool/asset pairs become the required rate-history series, so an absent vault series remains visible.

## Acquire complete original material

| Source | Native operation | Scope carried into the report |
| --- | --- | --- |
| Rate Worker snapshots | `snapshots.list` | Original ID-descending pages and every row, with a retained `before` cursor chain. |
| Route Worker rows | `routes.list` | The latest available row window and a separately labeled all-time server aggregate. |
| Soroban events | `events.list` | Original ledger bounds, filters, retained provider cursor and original event identities. |
| Original transaction | `transaction.inspect` | RPC status and ledger context; Horizon fallback when applicable. |
| Original keeper logs | `keeper.history.import` or complete source import | Entire original JSON/JSONL bytes, per-line parse failures and original operation fields. |
| Live surface observations | `surfaces.inspect` | Actual time, endpoint identity, response, health result and measured duration. |
| Vault and share state | `vault.inspect`, `vault.shareInspect` | Original contract views, selected network and exact original execution. |
| Keeper inspection and operation | `keeper.rebalance.probe`, `keeper.rebalance.execute`, `keeper.harvest.quote`, `keeper.harvest.execute` | Original command selections, process custody, full logs, route rows, health observations and transaction references. |
| Original rate engines | `rates.project`, `rates.simulate` | Original Rust input, binary/source identity and full output. |
| Original route/deployment procedures | `routing.report`, `deployment.plan` | Original script/report output and its actual completed phase. |

Prepare an operation in its selected period and named connection, then run or collect it. `operation-collect` follows every provider page by default. Acquisition definitions group read-only queries and preserve each original query and cursor. Starting an acquisition schedules it; `serve` or `worker` carries the saved schedule. Pausing retains the cursor and source selection.

The snapshot endpoint supports at most 500 rows per page. A terminal original cursor completes the selected query's retained history. The route endpoint also caps its latest row window at 500 and has no pagination cursor. Its server aggregate is all-time. Import the original keeper log to extend route history for a longer period.

Event requests preserve the initial ledger window while continuation requests use the provider cursor. The native facade follows the original RPC rule that cursor requests omit the start/end ledger fields. Use the provider's actual retained ledger range when selecting older history.

Each native attempt produces one analytical source containing its complete parsed outcome. Its original request, response or artifact bytes, hashes, runtime selection and execution identity are retained alongside it. Multiple HTTP observations belonging to one native attempt remain separate retained observations; they do not multiply the same interpreted row in the period totals.

Full source imports keep the original file and its digest. JSONL errors remain attached to their original line numbers. Formatted native stdout remains original material even when it does not represent structured period rows.

## Preserve exact keeper and rate semantics

Rebalance vault selections require `symbol` and `strategyId`. Harvest vault selections also require the original `underlyingClassic` value (a string or null) and `underlyingSoroban`; `swapVia` is optional. Executing a harvest requires the actual vault selection. The original quote defaults are quote-only entries.

The original harvest execution can split a pass across Broker and Soroswap settlements. Reports retain both route rows and both transaction hashes, and correlate them only through an original harvest/claim identifier, the retained single-pass native execution and strategy, or an explicit recorded correction. Settlement transactions and grouped harvests therefore have separate totals. Each group counted toward the mainnet harvest target needs the original applicable quotes and verified settlement outcomes.

Original amounts remain decimal integer strings. The analysis sums token amounts with integer arithmetic. Original rates and utilization values retain their source units. `rates.project` runs the original Rust `rate_calc` binary. The seven `rateConfig` values (`rBase`, `rOne`, `rTwo`, `rThree`, `utilOpt`, `irMod`, `backstopFP`) are Rust i64 values. `supplyEps` and `borrowEps` are u64 values. Supply safe JavaScript integers or canonical decimal strings for these fields; the native runtime emits the selected integer tokens exactly to original serde_json input. Amounts and price fields defined as f64 remain finite numbers.

`rates.simulate` runs the original Rust mainnet loop analysis and its original Stellar CLI reads. The deployment plan runs the original `DRY_RUN=1` path, which prepares the first WASM-install phase and exits. The complete source and original procedure remain available for subsequent selected phases.

## Track incidents and corrective work

Record an incident with its period version, severity, actual start and resolution times, notes, and relevant source IDs. The complete incident history is retained. If an imported historical record lacks explicit opening or resolution time, the analysis uses its actual recorded history event and labels that time basis.

Corrections can describe operating work linked to incidents or native operations, or select an explicit data action. Operating work remains visible without requiring a data-row target. Data actions are `exclude`, `include`, `annotate`, `link-harvest`, and `replace-source`; select an exact source, source list, row identity or original record key and give the reason.

| Recorded status | Effect on selected data |
| --- | --- |
| `PROPOSED`, `IN_PROGRESS`, `AWAITING_OUTCOME` | Retained as pending work. |
| `REJECTED` | Retained with its history and rejection state. |
| `IMPLEMENTED`, `VERIFIED` | Apply the selected data action to the exact source occurrences. |
| Implemented operating work without a data action | Retained as operating work, with its incident/operation links. |

The direct analysis API also accepts `APPLIED`; a legacy explicit data action without a status remains an applied action. The workspace gives newly recorded corrections the explicit default `PROPOSED`.

A correction never deletes original bytes. Excluding one conflicting occurrence preserves an independently retained valid occurrence. Replacing a source requires the complete replacement source in the selected edition. Historical conflict findings retain their identity and the resolving correction IDs, while the current active issue count reflects the corrected selection.

## Build and inspect the complete report

Create an analysis from the selected period version, vault versions, source IDs, incidents and corrections. A frozen source edition includes raw source identities and parsed content identities, so changing an interpretation changes the edition identity even when raw bytes are unchanged. An interrupted build resumes its original selection and analysis engine.

The analysis provides rate series and daily gaps; route decisions and original quotes; exact amounts and per-transaction outcomes; original keeper actions and error rows; events; incidents and corrections; cursor-chain coverage; and prepared read-only follow-up operations for unresolved transaction references or missing snapshot continuations.

A full green operating day requires every declared cadence slot for every declared surface and health dimension, the required rate-snapshot series, and no overlapping high-severity incident. Point observations establish their recorded times. The report separately shows available sampled history, complete daily history, coverage gaps, and the longest consecutive green run.

Acceptance rows use the selected targets and retain their original source references: grouped mainnet harvests, available rate-history days and a consecutive operating watch. Each row exposes the contributing counts and scope. All-time route aggregates remain separately labeled.

Rendering produces a deterministic 13-member report:

| Member | Contents |
| --- | --- |
| `report.html` | Monochrome human-readable report, rate plots with gaps, operating tables and source context. |
| `period-analysis.json` | Complete selected analysis, records, original material, coverage, findings and operation plans. |
| `original-records.csv` | Every distinct record, inclusion decision, original row, all occurrences and annotations. |
| `source-index.csv` | Complete selected source identities and original capture context. |
| `rate-snapshots.csv` | Retained rate observations with original fields and units. |
| `rate-history-daily.csv` | Per-series daily observations and coverage. |
| `harvest-routing.csv` | Route decisions, quotes, amounts, settlement and correlation context. |
| `keeper-operations.csv` | Original keeper actions and outcomes. |
| `operating-watch.csv` | Daily surface, health-dimension, snapshot and incident coverage. |
| `transactions.csv` | Original resolved transaction records and retained network/provider context. |
| `incidents-and-corrections.json` | Full incidents, correction outcomes and retained finding history. |
| `next-operations.json` | Prepared read-only transaction and snapshot follow-up selections. |
| `report-members.json` | Hashes and byte sizes of the other report members. |

The workspace's separate `report.json` records edition metadata. Exports carry the complete report and the selected application/runtime/workspace material. Independent receiving preserves original identities and pauses inherited acquisition schedules and unfinished native operations until the receiving operator selects their continuation.

## CLI workflow

The CLI prints selected request IDs before dispatch and retains every complete request. Reuse the original request ID and body when recovering an uncertain operation. The browser exposes the same workspace methods.

```sh
stellar-turbolong-operations period-save --workspace /private/turbolong --file /private/period.json
stellar-turbolong-operations vault-save --workspace /private/turbolong --file /private/vault.json
stellar-turbolong-operations acquisition-save --workspace /private/turbolong --connections-file /private/turbolong-connections.json --file /private/acquisition.json
stellar-turbolong-operations acquisition-run --workspace /private/turbolong --connections-file /private/turbolong-connections.json --acquisition-id "$ACQUISITION_ID" --request-id "$REQUEST_ID"
stellar-turbolong-operations source-import --workspace /private/turbolong --period-id "$PERIOD_ID" --kind keeper.harvest --name harvest.jsonl --file /private/keeper/harvest.jsonl
stellar-turbolong-operations analysis-create --workspace /private/turbolong --period-id "$PERIOD_ID" --name "Operating period"
stellar-turbolong-operations report-create --workspace /private/turbolong --analysis-id "$ANALYSIS_ID" --name "Period report"
stellar-turbolong-operations report-file --workspace /private/turbolong --report-id "$REPORT_ID" --filename report.html --output /private/turbolong-report.html
stellar-turbolong-operations workspace-export --workspace /private/turbolong --connections-file /private/turbolong-connections.json --destination /private/turbolong-delivery
```

Use the actual IDs returned by each original selection. Private connection files carry runtime paths, history roots, execution directories, original private bindings and the selected RPC/telemetry endpoints.

## Source references

- [Original retained Turbolong source](https://github.com/Dgetsylver/TurboLong/tree/f017de605bb020bf3d7f4285aae4c654508e8d86): Worker routes, keeper scripts, contract views, original Rust rate engines, and T1/T2/T3/runbook material.
- [Published SCF project](https://communityfund.stellar.org/submissions/rec3XPXsjkWBdR107): original milestone scope.
- [Stellar getEvents](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getEvents): original cursor and ledger-bound API contract.
- [Stellar getTransaction](https://developers.stellar.org/docs/data/apis/rpc/api-reference/methods/getTransaction): original transaction status and retention context.
