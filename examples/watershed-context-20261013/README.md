# Upper Savannah programme example

## Start with the regional picture

The completed 13 October 2026 regional run covers **217 watersheds across seven HUC8 regions**, with **4,659,072.10 acres** of published whole-watershed area. It gives the project team one regional view of watershed names, state portions, NRCS source-water priorities and selected South Carolina water classifications.

Use this example to prepare a watershed shortlist, review the reason for each selection and carry that selection into the original source-water and model-comparison workflow. The [regional report](watershed-report.md) is the readable starting point. The [complete context](watershed-context.json) retains every watershed and its original source records.

### Regional coverage

| HUC8 | Model watersheds | NRCS priority watersheds | Selected SC class records | Watersheds with those class records |
| --- | ---: | ---: | ---: | ---: |
| 03060101 | 36 | 1 | 782 | 8 |
| 03060102 | 32 | 2 | 1,002 | 7 |
| 03060103 | 57 | 4 | 102 | 4 |
| 03060104 | 43 | 7 | 0 | 0 |
| 03060105 | 18 | 1 | 0 | 0 |
| 03060106 | 8 | 0 | 0 | 0 |
| 03060107 | 23 | 0 | 0 | 0 |
| **Total** | **217** | **15** | **1,886** | **19** |

The selected classification inventory contains **1,040 ORW**, **247 TN** and **599 TPGT** records. The source query covers all 217 model HUC12 identifiers for ORW, ONRW, TN, TPGT and TPT; 198 queried watersheds return zero records for those selected classes. The application retains the source's South Carolina jurisdiction separately, including the 101 model watersheds whose retained state records lie outside South Carolina.

This makes two useful starting selections available: NRCS priority watersheds and watersheds carrying selected South Carolina classification records. Keep the reason for a selection alongside its source edition, then evaluate the relevant source-water geometry and model outcomes.

### State context

State rows describe each state's portion of a watershed. A watershed crossing a state line appears in more than one state row.

| State | Watersheds with a state portion | Published state area, acres | Priority state rows | Priority state area, acres |
| --- | ---: | ---: | ---: | ---: |
| Georgia | 115 | 2,435,508.93 | 13 | 350,585.70 |
| North Carolina | 9 | 109,734.82 | 0 | 0 |
| South Carolina | 116 | 2,113,830.32 | 5 | 116,976.38 |
| **Total state rows** | **240** | **4,659,074.07** | **18** | **467,562.07** |

Twenty-two watersheds span multiple states. Their 240 state rows sum to 1.97 acres more than the distinct whole-watershed total; both original published measures are retained. The 15 priority watersheds cover 467,561.88 whole-watershed acres. Priority state area counts only the designated state portions.

Acreage is displayed to two decimals; the CSV and JSON files retain original precision.

The [state CSV](watershed-states.csv) preserves the machine-readable values. Use the whole-watershed and state-portion columns for their corresponding geographic selections.

## Worked selection: Lower Tugaloo River

The saved selection is **Lower Tugaloo River, HUC12 030601020507**:

| Selection property | Retained result |
| --- | --- |
| Whole-watershed area | 59,689.69 acres |
| State portions | Georgia and South Carolina |
| Combined published state-portion area | 59,689.71 acres |
| NRCS FY26 status | High Priority Area in both retained state rows |
| Source system and concern | Ground; Water Quality |

Open [the selected-watershed JSON](selected-watersheds.json) to inspect both original state rows, or use [the selection CSV](selected-watersheds.csv) for a working table. Retain HUC12 identifiers as text when opening a CSV.

This is a useful programme selection because the same watershed can be inspected as a regional priority, as two state portions and as an original source-water network location. Its NRCS Ground / Water Quality designation supplies programme context. The original receiving-water analysis supplies the modeled sediment and nutrient quantities for the chosen geographic support and scenarios.

## Use the current application

From the Upper Savannah application directory, import the current regional edition into the existing Workspace:

```bash
python -m model.cli --workspace /absolute/path/to/existing-workspace \
  source-import source/water_context/sources-20261013.json
```

In **Regional watersheds**, choose the imported full-domain source edition and build a report. Review a watershed's state records, source classification coverage and native network context. Select the watersheds needed for the programme and export the selection; the current CSV uses the native model's complete state and network columns.

Continue in the existing source-water workflow with the project-specific geographic selection and completed baseline/alternative runs. In **Decision context**, combine the saved receiving-water analysis with the imported context and classified-water crosswalk. The resulting report preserves paired physical changes, contextual designations and original source editions, and can be linked to a compatible map delivery. See [the decision-context guide](../../DECISION_CONTEXT.md).

## Continue with the retained native network

These seven example files preserve the completed regional run, whose network status is `not_supplied`. The current source edition additionally includes the original USGS Savannah HUC12/ToHUC attributes: 303 distinct records, covering all 217 model watersheds. The operator loads that exact companion as `native-network.json` when building a new report.

The same calculation can be run directly with the retained canonical topology:

```bash
python model/watershed_context_cli.py \
  --source-context source/water_context/20261013/full-domain-water-context.json \
  --classification-coverage source/water_context/20261013/scdes-domain217-source-coverage.json \
  --network source/receptor-topology/20261013/usgs-wbd-savannah-original-topology-20261013.json \
  --select-huc12 030601020507 \
  --output-dir outputs/watershed-context-with-topology
```

The added network input produces its own context identity. Its exports include distinct known upstream model watersheds, upstream source areas and priorities, downstream paths and domain exits. Upstream context excludes the focal watershed. The [topology source guide](../../source/receptor-topology/20261013/README.md) describes the retained native links and utility-focus selections.

## Files in this example

| File | Use |
| --- | --- |
| [watershed-report.md](watershed-report.md) | Read the regional, state and priority narrative. |
| [watershed-context.json](watershed-context.json) | Inspect the full source-bound report and all original HUC12 rows. |
| [watershed-hucs.csv](watershed-hucs.csv) | Work with the complete watershed table. |
| [watershed-huc8s.csv](watershed-huc8s.csv) | Compare the seven regional groups. |
| [watershed-states.csv](watershed-states.csv) | Review state portions and priority-state totals. |
| [selected-watersheds.json](selected-watersheds.json) | Inspect the saved Lower Tugaloo selection and original source rows. |
| [selected-watersheds.csv](selected-watersheds.csv) | Use the saved selection as a working table. |

The source editions and original query companions accompany the [regional source guide](../../source/water_context/20261013/README.md). The [watershed model guide](../../model/WATERSHED_CONTEXT.md) defines field meanings, source coverage and the seven export formats.
