# Potomac: complete source and bulk receiving

Download [Potomac_Complete_Bulk_Receiving_20261012.zip](./Potomac_Complete_Bulk_Receiving_20261012.zip?raw=1), extract it, and use its complete `README.md` and `mapping/` inputs. The archive is 7,505,683 bytes, SHA-256 `d568a48271d9e80f1abf027f806d04731d0e57d06fc79e261933732d45bcef16`. [carrier.json](./carrier.json) lists all forty-eight members and the exact standalone input files. [result.json](./result.json) contains the original-source computation and all resulting native identities.

This packet contains the complete original Potomac source, both full editable baseline tables, the source-bound receiving decisions, native outputs, exact result summaries, and the configuration for the same complete browser receiving operation.

The published application is [Stellar Forge water-quality receiving](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/ac38372782d0d0884686aea3cf5d8c619882c6e4/stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality). Its `water-quality-decisions` command, Bulk decisions interface, planner and table codec own this workflow.

## What the original source produces

The original WQX3 capture contains one station, thirteen activities and 1,035 result records for USGS-01646580, Potomac River at Chain Bridge, from January through March 2025. It contains 1,112 limit records. The nineteen original capture members are included under `source/capture/`, with exact request/response bodies and their original manifest.

| Native receiving state | Original plan | Complete receiving plan |
| --- | ---: | ---: |
| Selected original results | 1,035 | 1,035 |
| Ready result rows | 571 | 1,035 |
| Result rows requiring review | 464 | 0 |
| Limits represented in a receiving field | 0 | 452 |
| Other typed limits retained in source and native comments | 1,112 | 660 |

The corrected native results TSV contains all 1,035 result rows and is 780,731 bytes. Its SHA-256 is `61c13bb7b3c62c264588a6327e9e54743fd3782db8bcdbbae0847d9476b2570a`. The existing-location mode retains the original station; its locations TSV is the original 96-byte header.

## Baseline: complete editable-table workflow

The complete published CSV and TSV codecs executed against the original saved plan. The CSV carries 1,035 explicit `RESULT_STATUS = Accepted` decisions. The TSV carries those same decisions plus the explicit `projectId` Keep reason. Each complete table was exported and parsed back to the exact normalized decision document.

| Member | Bytes | SHA-256 |
| --- | ---: | --- |
| `baseline/complete-editable.csv` | 15,904,629 | `a81f9b9a0d957a987a8c5e8602928f2acd801737c99d883559f48d3d77dea730` |
| `baseline/complete-editable.tsv` | 15,902,816 | `59e3391ec4bb0b9af98fd1001f01d3a1f8ed7e7e5802f0fa9cf8a57621eea8aa` |

Both documents compose through the original planner to plan `c17ec816a0436c72c054ca1dff32c7fa3d3d62731a23c2953af1b7ae75e2faa4`. Every native location, activity, result, identifier, measurement, limit, issue and readiness state remains identical to the original. Native results, locations and reference exports also compare byte for byte. The crosswalk records the explicit choices and new immutable plan identity.

The full execution metadata is in `baseline/functional-result.json`; the two exact normalized documents and all five native outputs are beside it.

## The complete receiving choices

The 464 affected rows form three disjoint groups:

| Original issue family | Rows | Explicit receiving choice |
| --- | ---: | --- |
| Blank result with `Not Detected` and reported `Censoring Level` | 452 | Copy the exact per-result threshold to `LAB_REPORTING_LEVEL` and its exact unit to `DETECTION_LIMIT_UNIT`. |
| pH unit label `standard units` exceeds the native twelve-character field | 11 | Use the literal receiving unit token `None`; preserve every original value and source label. |
| The sample-splitter label exceeds sixty characters and contains commas | 1 | Use `30 - Churn splitter; plastic; 8 L; cubitainer-type spigot`, retaining the complete original label and its before/after choice. |

The reporting-field choice follows the [USGS interpretation of censoring levels](https://water.usgs.gov/owq/OFR_99-193/data.html): the field carries the reported censoring threshold. The source's method-specific limits remain available for statistical interpretation. All 452 censored observations retain `Not Detected` and a blank measured result.

The [EPA August 2025 guidance](https://www.epa.gov/system/files/documents/2025-09/wqxdetectionlimitsbestpracticesguide_final.pdf) gives a pH example with the literal unit `None`. The receiving label changes eleven pH rows without scaling their values.

The exact field constraints come from the original [import-column contract](https://github.com/open-environment/open-waters/blob/e2cd705ed68b322808b46225b90ae86fc71a7e70/OpenWaters/OpenWaters/App_Docs/ImportColumnsConfig.xml), [paste importer](https://github.com/open-environment/open-waters/blob/e2cd705ed68b322808b46225b90ae86fc71a7e70/OpenWaters/OpenWaters/App_Pages/Secure/WQXImport.aspx.cs), [header mapping](https://github.com/open-environment/open-waters/blob/e2cd705ed68b322808b46225b90ae86fc71a7e70/OpenWaters/OpenWaters/App_Logic/BusinessLogicLayer/Utils.cs) and [validation implementation](https://github.com/open-environment/open-waters/blob/e2cd705ed68b322808b46225b90ae86fc71a7e70/OpenWaters/OpenWaters/App_Logic/DataAccessLayer/db_WQX.cs).

| Original limit type | Records | Representation |
| --- | ---: | --- |
| Censoring Level | 452 | Exact reporting threshold in the native field, with original typed record retained |
| Lower Reporting Limit | 69 | Original typed source and native comment |
| Detection limit by DQCALC | 97 | Original typed source and native comment |
| Reporting limit by DQCALC | 430 | Original typed source and native comment |
| Detection limit by blank data | 46 | Original typed source and native comment |
| Long Term Method Detection Level | 18 | Original typed source and native comment |

Of the censored rows, 427 also have an accompanying method-specific limit and 25 have the censoring limit alone. Thirty-five censoring values differ from the accompanying nominal limit. Their exact pairs appear in `mapping/nominal-threshold-differences.json`.

The complete mapping document contains four Set choices: reporting-threshold mapping, pH unit translation, one categorical override, and receiving notes. It also retains six explicit Keep decisions, covering the other five limit types and project identity. `mapping/row-choices.json` records every affected source row, exact changed field, retained limit and source pointer.

All 1,112 original limit objects retain the same identifier, type, value, unit, comment, origin and source. Their canonical projection hashes to `cf511de2b91b9bd243d6db2e29f0d8ef40f973662bfcbc291572f5f072c0204e`. All original result identities and original location/activity objects match exactly.

## Apply through the existing receiving project

Use the original received Potomac project from the whole Open Waters receiving operation. The original source plan is `potomac-quarter-open-waters-01` with SHA `4f9b1f612d1f9cb5bf3c90720d67cc37b5bd8fcd0c51476e669a340cde514610`. Its scientific review is `ba122f919127c23f701dcbf9cb88314fee46cdace3fd881b971a23b959489631`; its original capture is `cbb29504ab01598cddb21bde33c918ca92075aad7f53fdac4fb07581371d29d7`.

Select a source-pinned distribution containing release `ac38372782d0d0884686aea3cf5d8c619882c6e4`. The installed command is `starforge water-quality-decisions`; source checkouts can use `node review-sheet/cli.mjs` with the same arguments.

Set `WQX_PROJECT` to the canonical original project directory, `WQX_PACKET` to this extracted packet, and `WQX_RUN` to the receiving operation's private output directory. Then use the original preview and save commands:

```bash
starforge water-quality-decisions preview \
  --project "$WQX_PROJECT" \
  --document "$WQX_PACKET/mapping/decisions.json" \
  --new-plan potomac-complete-receiving-plan-01 \
  --out "$WQX_RUN/mapping-preview.json"

starforge water-quality-decisions save \
  --project "$WQX_PROJECT" \
  --document "$WQX_PACKET/mapping/decisions.json" \
  --new-plan potomac-complete-receiving-plan-01 \
  --review potomac-complete-receiving-review-01 \
  --expected-preview 371b35854b68354dad2db096034dd9db9f6859941f3109939b5990c6959fc096 \
  --out "$WQX_RUN/mapping-review.json"

starforge water-quality-decisions export \
  --project "$WQX_PROJECT" \
  --review potomac-complete-receiving-review-01 \
  --format bundle \
  --out "$WQX_RUN/potomac-complete-receiving-bundle.json"
```

The complete published preview function produced the expected preview SHA above. Its resulting plan is `potomac-complete-receiving-plan-01`, SHA `893c32bd0b9729cc3504244670ecd05c34c51ddf1e44887296c7ea2cb0788e21`. The original save rechecks the complete source and preview, preserves immutable names, and resumes the same PREPARED or COMPLETE operation when reopened. Reuse retained preview/output files when continuing an existing receiving run.

## Continue the same complete browser operation

`receiving/potomac-complete-receiving.browser.json` preserves operation `SCF-WQX-BULK-RECEIVING-9F77-20261012-01` and binds the corrected source plan. Its current executable source, original review and capture are pinned. Rebind its canonical project/output/browser paths to the accepting host's existing source and runtime. Use the unchanged maintained driver:

```bash
node --expose-gc review-sheet/browser-receiving.mjs \
  --config /absolute/potomac-complete-receiving.browser.json
```

The configuration runs all 1,035 same-value status choices, the full CSV/TSV import/export, explicit project Keep reason, native preview and immutable save, eleven complete downloads, source cold reopen, full bundle receive into an independent project, eleven matching received downloads, and receiver cold reopen. It retains desktop/mobile viewport screenshots and its original resumable operation state.

The corrected source was also composed through the original workflow before this handoff. Its final metadata document is `e4ca190ce3b24bc2b3ee4be90824228a4d84693cc66a7bb82ec68b71de1f44a6`, preview `994424e6f2381fd8d518b24e4f9985e719d50e15314a26698dfa6036f67819d8`, and resulting native plan `5f6f2564d8098c0391d2ecd486a4124f96c09fe2f501fc5592dbbba70d8b5da4`. Every native row, field, limit, reference and readiness value remains identical to the corrected source.

## Packet contents and verification

`manifest.json` lists every member's exact bytes and SHA-256. The packet carries the complete tables and native outputs, full mapping preview and decisions, original source review/plan, and all nineteen original capture members. `mapping/functional-result.json` and `baseline/functional-result.json` identify the actual original-source computations, code pins and resulting identities.

The computations executed the published original domain, CSV/TSV and workflow functions against the recovered original bytes. The original saved review and plan identities were reproduced exactly before changes, including the original 5,562,523-byte crosswalk. The same receiving owner is carrying the full private-project and browser continuation with this corrected input edition.
