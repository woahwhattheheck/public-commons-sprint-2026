# Hamburg charging-status operating review

This package contains the complete original source for two captures of one fixed SensorThings query and the resulting source-linked operating review. Open [the complete report](reports/window-1/index.html) for the timeline, original rows, source references, gaps, timestamp differences and edition comparison.

## Actual observed result

The selected point is Datastream **18571**, **Ladepunkt DE*HHM*E1011*02**, at Eduard-Rhein-Ufer 1. The fixed window starts **14 September 2026 00:00:00 UTC** and ends, exclusively, **12 October 2026 10:31:58 UTC**. Each actual capture traversed seven original pages and returned **660 unique observations**, with the reported count and complete continuation chain agreeing. The two captures retain **660 unchanged observation IDs**, with no additions, removals or changed records in this fixed window.

| Literal reported code | Observations |
| --- | ---: |
| AVAILABLE | 95 |
| CHARGING | 120 |
| FAULTED | 1 |
| FINISHING | 87 |
| PREPARING | 82 |
| SUSPENDEDEV | 125 |
| SUSPENDEDEVSE | 150 |

There are **640 adjacent observed code changes** and **19 adjacent pairs with the same code**. These compare observed points. They do not establish the exact time of a transition or any intermediate state.

One observation reports `FAULTED`: observation **1449254541**, at **17 September 2026 09:05:50.988 UTC**. The previous recorded observation is `AVAILABLE`, 58,636.389 seconds earlier; the next is `AVAILABLE`, 16.627 seconds later. **Fault duration is unknown.** The largest interval between adjacent observations is **93,364.665 seconds**, from 20 September 14:42:07.411 UTC to 21 September 16:38:12.076 UTC. That interval is a source observation gap, not a measured outage.

The first observation arrives 62,877.338 seconds after the requested start and the last precedes the exclusive end by 10,110.877 seconds. No start or end state is imputed. All 29 selected UTC calendar dates have observations, but this does not prove continuous state coverage.

The largest original `resultTime − phenomenonTime` difference is **52,733.471127 seconds** (observation **1447657537**). It compares the two published time fields; it is not a network-latency measurement.

## What changed between captures

All seven observation-page bodies are identical across the two captures. The opening metadata are also unchanged. The second closing Datastream response differs in `phenomenonTime` and `resultTime`: its last reported observation extends to 12 October **11:00:59.842 UTC**, beyond the selected window. Both exact versions are retained. The report exposes that metadata change separately from the unchanged fixed-window records. Neither a completed traversal nor matching records establishes an atomic provider snapshot.

## Source meaning and operator use

The actual observation type is `OM_CategoryObservation`. Results are literal strings and all three unit fields are null. The published status enumeration and the actual ObservedProperty/Sensor sources remain attached; the report does not convert category labels into numeric measurements or silently substitute another OCPP vocabulary.

An operator can use the complete timeline to locate points that need investigation, compare observed status patterns, identify long intervals requiring a source-quality check, inspect changed source metadata, and open the exact source row behind each finding. The ten CSV tables support an editable review workflow. Status duration, availability percentage and charging utilization remain uncalculated because no continuity or validity rule establishes them.

The Thing source reports `ownerThing=Stromnetz Hamburg` and `infoLastUpdate=2024-07-18T13:12:06.629729Z`. That is dated publisher metadata, not independent verification of a current operator or evidence of any customer engagement.

## Complete contents and source custody

- [manifest.json](manifest.json): all **29 original bodies and 29 complete acquisition receipts**, original order, both query scopes and current execution state.
- [report-recipe.json](report-recipe.json): exact source file identities and comparison settings.
- [calculation-receipt.json](calculation-receipt.json): executed source identities and complete result/table identities.
- [reports/window-1/status-report.json](reports/window-1/status-report.json) and [reports/window-2/status-report.json](reports/window-2/status-report.json): complete results, all source rows, pointers, adjacent pairs and interval boundaries.
- [reports/comparison.json](reports/comparison.json): complete actual second-edition comparison.
- Five complete CSV tables per capture: status history, observed adjacent pairs, daily observation counts, observation gaps and transition counts.

The three-record catalogue page and twelve-observation discovery page remain original source records. They are not described as a complete service catalogue or substituted for the complete 660-observation window.

The acquisition used the declared Notion attachment source URL and complete text-download operations. Exact literal UTF-8 text, original filenames, lengths and both raw tool responses are retained. Provider HTTP method, status, headers and request timestamps were not exposed by that route and remain unknown. The clock on each receipt records when the complete connector download returned.

## Execution and receiving state

The actual source calculation completed in **Functions V8 at 11:26:24 UTC on 12 October 2026**. It uses original exact-number and time semantics and the reusable `sensorthings/operational.mjs` source. Complete HTML generation also finished. Native Node execution, browser visual inspection, SensorThings workspace intake and merchant/buyer receiving remain separate unfinished operations until their actual receipts exist.

The existing source-preserving SensorThings engine, CLI/MCP, retained-file receiving and original source edition journal remain the intended native receiving path. The source report analysis IDs are not native workspace edition IDs. Reuse the same original operation and source bytes; do not fetch these responses again to reproduce this report.

## Reproduce and receive the complete product

[The complete native receiving guide](NATIVE_RECEIVING.md) provides both installed commands and the original operation IDs. `sensorthings-receive-hamburg` consumes the exact [native-recording.json](native-recording.json) through the existing source journal, receives both original editions, retains source review and prepares native datasets and full source archives. `sensorthings-report` reproduces both analyses, verifies their exact expected identities and exports all original bodies, receipts and complete report tables to a separate delivery directory. Completed reports reopen by verifying their saved file identities.

The complete recording is 2,965,230 bytes with SHA-256 `34fb0322092a51525e94beda0d6c3b21548b7261d65d80909b27eb6fa6a2d466`. These commands do not fetch replacement source data. The exact calculation source used for the already-completed V8 result is retained under [calculation-source/](calculation-source/), separately from the current installed reproduction command.

## Attribution and published metadata

Source attribution: **Freie und Hansestadt Hamburg, Behörde für Wirtschaft und Innovation**. The retained [publisher metadata edition](https://suche.transparenz.hamburg.de/dataset/elektro-ladestandorte-hamburg36), dated July 2024, identifies [Datenlizenz Deutschland – Namensnennung – Version 2.0](https://www.govdata.de/dl-de/by-2-0). That edition links to newer metadata; it is not represented here as independent verification of later licensing or operating-company changes. The original API bodies remain unchanged.
