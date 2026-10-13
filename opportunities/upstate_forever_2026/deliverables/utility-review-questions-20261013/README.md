# Upper Savannah: editable utility review questions

These six analyst questions extend the existing REVIEW13 watershed desk and native implementation workflow. Open the saved project in the actual original review desk. Its source edition is `4b2efdbd79bce5f9327f7c2a94e46d41bd6a975dcd10c2739b66f284c394365e`; the existing source/data/geometry and all completed model histories remain with their original editions.

The initial view is the deduplicated 36-HUC utility upstream union, equal weights and top five. The active record is Lower Tugaloo River. All six queued questions are editable. The native bridge turns this ONE selected saved project into one six-candidate, six-task plan and attaches its exact original JSON.

## Decisions worth showing

| Retained quantity | Lower Tugaloo, 030601020507 | Choestoea, 030601020502 |
| --- | ---: | ---: |
| Classified area, ha | 24,155.55 | 9,940.68 |
| Forest gross loss, ha | 180.09 | 97.38 |
| Forest gross gain, ha | 179.28 | 36.99 |
| Forest net change, ha | −0.81 | −60.39 |
| Developed-group gross gain, ha | 64.44 | 24.39 |
| Wetland-group gross loss, ha | 3.42 | 1.08 |

Source: unchanged217-profile CSV, SHA256 `9e999756fb01b84a4d88784dae5030e0658d5eef922e771825c5a40a6b925d62`, retained under sources/. The underlying class transitions retain the 2023 and2025 AnnualNLCD editions. Net forest change can conceal substantial spatial turnover: Lower Tugaloo has almost equal gross loss and gain. The actual location and class pathway of each change therefore matter to the next source/map review.

### Pioneer focus: scale changes the question

Select Pioneer focus, top K=1. In absolute hectares, Lower Tugaloo ranks first for all66 declared weight choices. Switch to hectares per1,000 classified hectares: equal weights put Choestoea first, with scores59.413580 and59.259259 respectively. Across the66 normalized weight choices, Choestoea is first for31 and Lower Tugaloo for35. Showing both the small equal-weight gap and the editable weights is more useful than presenting either ordering as fixed.

These counts enumerate all three nonnegative weights summing to ten in ten-percentage-point steps. They describe the declared preference grid. The analyst selects the actual criteria and follows the original source/map evidence.

### ARJWS upstream: area normalization exposes a different shortlist

Select ARJWS upstream, top K=2. The full original upstream group has four HUCs.

| Original HUC12 | Absolute equal-weight rank | Normalized equal-weight rank | Absolute top-two choices | Normalized top-two choices |
| --- | ---: | ---: | ---: | ---: |
| 030601010704, Lower Six and Twenty | 1 | 1 | 60/66 | 48/66 |
| 030601010701, Upper Three and Twenty | 2 | 3 | 51/66 | 31/66 |
| 030601010702, Lower Three and Twenty | 3 | 4 | 15/66 | 8/66 |
| 030601010703, Upper Six and Twenty | 4 | 2 | 6/66 | 45/66 |

The full217-reference midranks remain fixed while the view changes. The score's reference population and the selected four-member comparison therefore remain inspectable. K=2 gives this small view a selective shortlist.

### Keep the upstream and reporting geographies visible

Shoal Creek and Eastanollee Creek are original Georgia members of Pioneer's32-HUC upstream closure. Shoal remains in Pioneer's top five for all66 choices on both quantity bases. Eastanollee does so for66/66 absolute and64/66 normalized choices. Their queued questions concern contributing upstream context. Show the actual South Carolina reporting intersection separately, and retain the four RFP focus anchors and original utility protection polygons in their own selections.

The four RFP anchors have no local observed-flow gauges in this retained inventory. Their original assessment context is RS-24163/ECOLI, RL-01020/PH, SV-790/BIO and SV-234/PCB. The saved notes retain those source constituents while the native model case displays annual nitrogen/phosphorus kg and sediment tonnes reaching streams. Use the actual modeled comparison on its paired valid support for the selected scenario question.

## Files and original computation

- Upper_Savannah_Review_Project.json: one source-bound saved project, six substantive editable questions.
- utility-preference-comparison.csv: all148 rows from eight selected scope/basis views, including original quantities, ranks and all66-weight-choice summaries.
- sources/watershed-profiles.csv: unchanged original217-profile table.
- sources/scopes.json: explicit original4/32/36-HUC selections, full217 reference, source identities and declared comparison settings.
- sources/review_core.mjs: unchanged7,184B REVIEW13 preference engine.
- sources/profiles_core.mjs: unchanged original profile parser/producer.
- replay.mjs: reads these originals, restores the saved project through the existing engine and reconstructs the complete148-row comparison.
- MANIFEST.json: exact file inventory.
- CURRENT_OWNER_DIRECTION.md: complete maintained owner instruction.

Run `node replay.mjs ACTUAL_NEW_OUTPUT_DIRECTORY` with ordinary Node. This uses the original preference model over actual source tables. The native NDR/SDR operation remains with its current runtime.

Original review source: https://api.github.com/repos/woahwhattheheck/public-commons-sprint-2026/git/blobs/1cb5ffb88bf21cd464d337d399daeeb08c24cc2f
Native review bridge source: https://api.github.com/repos/woahwhattheheck/public-commons-sprint-2026/git/blobs/fcba0193566041639ff811e4b9e220664fae2a85
Original utility calculation source: https://api.github.com/repos/woahwhattheheck/public-commons-sprint-2026/git/blobs/2bc66e9502b88874cd079478bed2b3b92d8e8dd1

## Receive into the existing useful workflow

Keep this question package OUTSIDE the already-retained56-member desk directory. Its original native-sources.json and complete source collection stay unchanged. Load Upper_Savannah_Review_Project.json in the existing desk, inspect each question, change the scope/basis/weights, export its queue and reopen the saved project.

Use the current authored bridge from REVIEW13's same accepted native operation:

```sh
python source_tools/watershed_review/receive_review.py \
 --application ACTUAL_CURRENT_APPLICATION \
 --workspace ACTUAL_ORIGINAL_WORKSPACE \
 --delivery ACTUAL_EXISTING_56_MEMBER_REVIEW_DIRECTORY \
 --review-project ACTUAL_QUESTION_PACKAGE/Upper_Savannah_Review_Project.json \
 --title "Upper Savannah utility review: original changes and scenario questions" \
 --output ACTUAL_NEW_RECEIVING_DIRECTORY
```

This intake creates ordinary editable desktop-review tasks from the selected saved questions. Repeating the exact saved JSON reopens the same original plan and preserves edits. Use one canonical plan for this package.

REVIEW13's completed receiving project is dc92b8b9-6eda-4362-b12d-3cf2ef6c9007. The separate9BCB map/station project b9d5d257-c6bb-4f07-b975-8e8c63705db3 can receive the same desk additively through its own original Workspace. Preserve each host's actual current project and source identity.

The producing native peer opens and LOOKS at this exact saved project in the populated desk at presentation and390px widths, reads every question, operates the relevant controls, views the new six-task native report, opens the CSV and saved-project attachment, exports and cold-reopens the resulting complete editable package. Fix affected presentation/operation defects in that same maintained source. Carry CURRENT_OWNER_DIRECTION.md2026-10-13.3 through this handoff and preserve the14:00UTC cutoff.
