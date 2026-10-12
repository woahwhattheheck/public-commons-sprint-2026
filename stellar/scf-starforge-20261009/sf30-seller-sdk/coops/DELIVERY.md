# Coastal engineering delivery fit

## Useful handoff

The existing Coastal Source Operations application carries retained NOAA editions through analyst review, explicit model-input columns, immutable files and original SF30 query/release controls. Its project-study workflow composes ordered windows from several station profiles into one reviewed delivery, then retains and compares a returned model-input file. The receiving engineering team keeps the decision about station suitability, model headings, time/datum convention and use in its project.

This technical fit is anchored to Moffatt & Nichol's published [numerical-modeling practice](https://www.moffattnichol.com/solution/numerical-modeling) and its [partnership/proposal contact route](https://www.moffattnichol.com/contact). The public La Jolla reference station is regionally relevant to a San Diego coastal-data discussion. It has not been established as a boundary condition for [San Dieguito Lagoon](https://www.moffattnichol.com/project/san-dieguito-lagoon-restoration) or any named client project.

The prepared company offer and its original form operation remain with the designated sender. This source guide neither changes that offer nor records customer acceptance.

## Current delivery versus proposed project work

| Area | Available implementation | Evidence or project input still required |
| --- | --- | --- |
| Station/source choice | Explicit station ID, product, inclusive dates, units, time basis and datum; actual advertised station metadata. | The receiving engineer selects the project's stations and confirms suitability. |
| Historical acquisition | Serial studies up to five calendar years; bounded provider requests, retained failed/unavailable responses, pause/resume with original IDs. | Actual selected acquisition and its measured source coverage. |
| Source quality | Original value text, missing/null distinctions, q/f/sigma and observation/prediction separation. | Actual edition review, including datum/epoch evidence and measurement gaps. |
| Model-input exchange | Original JSON convention intake, explicit receiving-target comparison, exact input files, selected columns and decision notes; mapping revisions and original files pinned to complete CSV/JSON/JSONL exports and selected native dataset/query/release packages. | The model owner's real column convention, frequency and required inputs. |
| Reviewed project study | Ordered immutable edition windows, exact mapping/source identities, overlap checks, explicit native basis and revision-bound review. Observations and predictions remain distinct tables. | Actual selected stations/windows, the responsible review and any project-specific datum transformation. |
| Returned model-input file | Complete original CSV/JSONL retention, resumable chunk intake, full keyed comparison and an explicit receiving decision. Ambiguous identities and unresolved comparisons remain visible. | The model owner's actual returned file and reasoned acceptance or follow-up. The unchanged internal reference return proves only file handling after the native run completes. |
| Source refresh | Distinct immutable editions and study revisions; source/window/quality changes and ambiguous duplicate keys remain separate. Earlier reviewed releases remain pinned. | A dated subsequent source edition and explicit analyst decision about using it. |
| Staff operation | Existing forms, retained draft versions, exact operation replay, source-file import, original query and same-origin reopen. | One complete actual operator receiving record on the selected runtime. |
| Native distribution | An explicitly selected complete reviewed study CSV or single-edition snapshot enters the existing SF30 query, original SF82 publisher, SF88/SF100 receiver and merchant MCP attachment, with exact mapping/source/review provenance. | Explicit release terms, actual configured runtime and any genuine buyer operation. |
| Engineering decisions | Source/evidence handoff and traceable analytical inputs. | Project-specific datum/time conversions, boundary-model decisions and design acceptance remain with the qualified project team. |

The source implementation is merged and source-reviewed. A source merge, syntax check or an authored receiving module does not establish that NOAA observations were captured or a customer received a dataset. Record that outcome only from `coops-operator-result.json` and its retained original artifacts after the existing receiver completes the connected operation.

## Selected project delivery

A practical project begins with the model owner supplying the selected stations, date range, receiving columns, expected temporal basis and intended use. The existing application then retains the original capture plan and provider responses, separates source-request completion from populated measurements, and produces a review packet with exact receipts and datum evidence.

After the actual review, staff save the agreed mapping and export complete files with the mapping, source edition and review attached. Subsequent source updates remain new editions. The comparison identifies actual value/quality changes and changes in the requested window; it does not silently adopt a correction.

The project study selects up to five station profiles and 64 ordered immutable windows over its bounded five-year period. Each station retains its own request, source, time and datum identity. The same tidal datum name at two stations does not establish a common physical vertical surface. Mixed request bases require an explicit study choice and retained warning acknowledgements; the application performs no coordinate, time or vertical-datum conversion.

A native captured edition is bounded at 366 calendar days; six-minute data use shorter provider requests, and the historical export streams selected child editions. Study CSV/JSONL and the complete original-source archive are streamed from those retained editions. Native SF30 dataset controls accept either one immutable edition/table or the exact complete CSV of an explicitly selected reviewed study release. Both retain the 250,000-row / 256 MiB native limits. A larger project delivery requires an expressly narrower, reviewed release before query preparation; historical rows are never silently truncated. Later working studies and review decisions do not change the old query or its recorded review.

### Acceptance artifacts

- Exact selected request plan, station identity and datum/epoch sources, including unavailable resources.
- Complete original response package with recorded source-observed times and hash/byte receipts.
- Actual populated, missing, duplicate/conflicting and out-of-window/quality counts, without invented completion.
- The responsible review decision tied to the exact edition/source packet.
- The selected model-input convention, its exact original JSON and native revision.
- The complete study selection, station-specific basis warnings and actual revision-bound review.
- Complete receiving files, immutable release/return receipts and full comparison, including ambiguous or unresolved rows.
- The receiving decision and its exact comparison hash; later preparation preserves that earlier release and review.
- Original dataset/query identity where selected, with its exact mapping revision, acquired mapping-file hash and retained receiving headings. A study dataset additionally carries the exact released CSV, study revision, recorded review, original delivery manifest and complete native source/configuration downloads. Later conventions, studies and review decisions remain separate.
- Staff save/replay, source-file receiving and reopen result in the same original workspace.

## Receiving path

[RECEIVING.md](RECEIVING.md) describes the one existing-page continuation and exact independent-review/restart callbacks. [STUDIES.md](STUDIES.md) adds the connected project-study review, source archive, original returned-file comparison and later-revision/reopen path. The selected original Node/browser runtime runs one console and persistent browser; the exported journey itself creates no parallel service.

The supplied [complete receiving selection](examples/coastal-receiving-selection.json) uses January 1–7, 2025 at NOAA 9410230 in metric/GMT/MLLW, plus an explicitly declared two-year hourly source window. Its study composes those actual retained child editions when acquired. It does not claim that five stations have been captured. An independent source decision and a separate exact study-packet decision are supplied during that same operation. The internal returned file is the unchanged original released JSONL, clearly separated from any future client model output.

The default is our reference selection, not a supplied Moffatt model, an engaged client study or a captured data fixture. A real project replaces those choices through explicit staff inputs and retains its actual source/receiving outcome.

Primary source contracts: [NOAA station 9410230](https://tidesandcurrents.noaa.gov/stationhome.html?id=9410230), [Data API](https://api.tidesandcurrents.noaa.gov/api/prod/), [quality/response fields](https://api.tidesandcurrents.noaa.gov/api/prod/responseHelp.html), [Metadata API](https://api.tidesandcurrents.noaa.gov/mdapi/prod/).
