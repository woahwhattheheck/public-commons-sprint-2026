# Coastal engineering delivery fit

## Useful handoff

The existing Coastal Source Operations application can carry a selected NOAA source study from capture through analyst review, explicit model-input columns, immutable files and original SF30 query/release controls. The receiving engineering team keeps the decision about station suitability, model headings, time/datum convention and use in its project.

This technical fit is anchored to Moffatt & Nichol's published [numerical-modeling practice](https://www.moffattnichol.com/solution/numerical-modeling) and its [partnership/proposal contact route](https://www.moffattnichol.com/contact). The public La Jolla reference station is regionally relevant to a San Diego coastal-data discussion. It has not been established as a boundary condition for [San Dieguito Lagoon](https://www.moffattnichol.com/project/san-dieguito-lagoon-restoration) or any named client project.

The prepared company offer and its original form operation remain with the designated sender. This source guide neither changes that offer nor records customer acceptance.

## Current delivery versus proposed project work

| Area | Available implementation | Evidence or project input still required |
| --- | --- | --- |
| Station/source choice | Explicit station ID, product, inclusive dates, units, time basis and datum; actual advertised station metadata. | The receiving engineer selects the project's stations and confirms suitability. |
| Historical acquisition | Serial studies up to five calendar years; bounded provider requests, retained failed/unavailable responses, pause/resume with original IDs. | Actual selected acquisition and its measured source coverage. |
| Source quality | Original value text, missing/null distinctions, q/f/sigma and observation/prediction separation. | Actual edition review, including datum/epoch evidence and measurement gaps. |
| Model-input exchange | Original JSON convention intake, explicit receiving-target comparison, exact input files, selected columns and decision notes; mapping revisions pinned to complete CSV/JSON/JSONL exports. | The model owner's real column convention, frequency and required inputs. |
| Source refresh | Distinct immutable editions; source/window/quality changes and ambiguous duplicate keys remain separate; complete streamed comparison. | A dated subsequent source edition and explicit analyst decision about using it. |
| Staff operation | Existing forms, retained draft versions, exact operation replay, source-file import, original query and same-origin reopen. | One complete actual operator receiving record on the selected runtime. |
| Native distribution | Existing SF30 query, original SF82 publisher, SF88/SF100 receiver and merchant MCP attachment. | Explicit release terms, actual configured runtime and any genuine buyer operation. |
| Engineering decisions | Source/evidence handoff and traceable analytical inputs. | Project-specific datum/time conversions, boundary-model decisions and design acceptance remain with the qualified project team. |

The source implementation is merged and source-reviewed. A source merge, syntax check or an authored receiving module does not establish that NOAA observations were captured or a customer received a dataset. Record that outcome only from `coops-operator-result.json` and its retained original artifacts after the existing receiver completes the connected operation.

## Selected project delivery

A practical project begins with the model owner supplying the selected stations, date range, receiving columns, expected temporal basis and intended use. The existing application then retains the original capture plan and provider responses, separates source-request completion from populated measurements, and produces a review packet with exact receipts and datum evidence.

After the actual review, staff save the agreed mapping and export complete files with the mapping, source edition and review attached. Subsequent source updates remain new editions. The comparison identifies actual value/quality changes and changes in the requested window; it does not silently adopt a correction.

The proposed study scope can include several stations and multiple years, but each station remains a distinct source profile/study. The native captured edition is bounded at 366 calendar days; six-minute data use shorter requests, and the full historical export streams selected child editions. A prepared SF30 dataset selects one immutable edition/table within its declared row and byte limits. Large project handoffs retain their original partitions instead of presenting an unbounded in-memory table.

### Acceptance artifacts

- Exact selected request plan, station identity and datum/epoch sources, including unavailable resources.
- Complete original response package with recorded source-observed times and hash/byte receipts.
- Actual populated, missing, duplicate/conflicting and out-of-window/quality counts, without invented completion.
- The responsible review decision tied to the exact edition/source packet.
- The selected model-input convention and its native revision.
- Complete receiving files, immutable export receipts and source correction comparison.
- Original dataset/query identity where selected.
- Staff save/replay, source-file receiving and reopen result in the same original workspace.

## Receiving path

[RECEIVING.md](RECEIVING.md) describes the one existing-page continuation and exact independent-review/restart callbacks. It requires the selected original Node/browser runtime and creates no parallel service. The default public reference is January 1–7, 2025 at NOAA 9410230 in metric/GMT/MLLW, followed by an explicitly declared two-year hourly source study.

The default is our reference selection, not a supplied Moffatt model, an engaged client study or a captured data fixture. A real project replaces those choices through explicit staff inputs and retains its actual source/receiving outcome.

Primary source contracts: [NOAA station 9410230](https://tidesandcurrents.noaa.gov/stationhome.html?id=9410230), [Data API](https://api.tidesandcurrents.noaa.gov/api/prod/), [quality/response fields](https://api.tidesandcurrents.noaa.gov/api/prod/responseHelp.html), [Metadata API](https://api.tidesandcurrents.noaa.gov/mdapi/prod/).
