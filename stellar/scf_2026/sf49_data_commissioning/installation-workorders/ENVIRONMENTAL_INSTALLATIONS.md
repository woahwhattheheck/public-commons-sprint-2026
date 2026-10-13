# Environmental workshares in the original Installation programme

Use the existing Grant Operations case and its original Installation desk to prepare and receive a complete environmental customer workshare. The installed profiles cover laboratory EDD reissues, legacy DTS8D workbooks, complete scientific water-quality studies and KiWIS commissioning. They use the maintained profile catalogue, original Workshare reader and existing source preparation and receiving programmes.

The original commercial packet supplies the customer, scope, milestones, schedule, correction terms and phase graph. The profile supplies the technical operating instructions. The complete original phase effort remains source-selected. Neither a profile nor a prepared Installation records an accepted engagement, a payment, a funded award, a completed import or a successful paid job.

## Choose the technical profile

| Installed profile | Complete useful operation | Original customer use |
|---|---|---|
| `laboratory-edd-reissue` | Complete current and baseline/reissue EDD, saved field and correspondence choices, native output families and verified result-folder receiving | McCampbell and Phoenix each keep their separate original case and plan |
| `geotech-dts8d` | Complete laboratory export, explicit legacy workbook choices, separately named XLSX reissue and actual customer DTS/Enviro Data receiving | Geotech's original project and selected source families |
| `water-quality-analysis` | Full original study graph, explicit compatible-unit choices, paired scientific analysis and independent analyst receiving | Waterborne's original study/window and selected source families |
| `kiwis-water-quality` | Exact original KiWIS responses, full counterpart, explicit station/parameter/time/quality review, edition comparison and all eight exports | KISTERS' original service/programme and one selected counterpart |

The catalogue is read from the selected installed source. Do not copy these IDs into a second hardcoded menu. `profiles.mjs`, `source-inputs.py`, `prepare.mjs`, `receive.mjs` and the Source Preparation Desk select the same original `ID.json` profile.

Two independent Workshares may use the same profile. The receiver binds each customer's complete case and plan and keeps its separate Installation and private programme location. Receiving McCampbell does not receive Phoenix.

## Keep complete original commercial and source documents

Retain each complete native Workshare receiving packet. It must have:

- The original `prepared_case.id`.
- The same original `workshare_input.source.case_id`.
- The entire `workshare_input.plan` with version `dealscout.workshare-plan.v1`.
- Every original phase, dependency, deliverable, owner and acceptance field.
- Complete commercial currency, amount, milestones, proposed/accepted status and schedule.
- The original full JSON documents from which every phase's hours and the complete effort total are selected.

The unchanged source preparer reads the canonical plan digest and exact whole files. It does not divide price by a rate, infer missing hours from a phase title, split a total evenly or manufacture an original case packet. If the selected packet already exists in an original case delivery, use that exact file and retain its original source reference and observation time.

Customer data and commercial delivery packages belong with their existing private operation. The public installed profiles contain reusable technical instructions and source references. Do not publish original private laboratory data, service access, customer correspondence or workspace backup as a profile example.

### Prepare the complete selection

Use schema `stellar-forge.installation-source-selection.v1` through the original Source Preparation Desk or the unchanged `source-inputs.py`. One selection may include the whole five-workshare cohort or an explicitly selected complete original case.

Each case declares its original case ID, installed profile, exact packet descriptor, canonical plan SHA-256, every phase's effort mapping, complete total and full supporting files. A file descriptor retains its relative source path, distinct receiving filename, full byte count and SHA-256, source URL, actual observed time and media type.

For a phase, `productionEffort` retains:

| Field | Meaning |
|---|---|
| `phaseId` | Exact original native phase identity |
| `hours` | Exact assigned effort as decimal text |
| `sourcePointer` | JSON Pointer to the original numeric value |
| `sourceFile` | Complete selected supporting filename, when the value is outside the plan |
| `unit` | The original `hours` or `minutes` unit |
| `basis` | Why that original value belongs to this complete phase |

A pointer without `sourceFile` begins at the selected plan's root. A pointer with it begins at the complete named file's root. The original helper checks that every phase appears once, every selected effort pointer is used once, all phase hours equal their original numeric sources and their sum equals the complete original total.

Keep existing accepted phase-ID amendments explicit and reversible. An amendment changes only the declared phase IDs and dependency references in a separately named packet; it preserves the full unmodified original packet. Do not change commercial content to satisfy intake.

### The five-workshare source selection

The original environmental commissioning operation is `SCF-ENVIRONMENTAL-INSTALLATIONS-9F77-20261013`. Its complete private source selection retains five independent customer case/plan identities, original commercial terms and explicit effort sources. Use the entire delivered selection and all its selected original files. Its source preparation is distinct from the original laboratories' paid worker jobs and the original scientific/native product programmes.

The cohort's commercial effort is separate from the SCF prospective grant plan. Preserve the pinned native grant plan, its six packages, future-hour budget and funding assignments. Enter actual work once against its selected commercial or grant assignment through the existing Operations workflow. A proposed customer scope is not a cash receipt or a funded grant expense.

## Prepare through the installed Source Preparation Desk

Open the existing authorized Grant Operations case, choose **Installations**, then **Prepare original source workshares**.

1. Create or reopen the original environmental source preparation. Keep its original draft and request IDs.
2. Retain every complete original receiving packet and supporting effort document. Review receiving filenames and provenance.
3. Inspect each entire packet. Select the appropriate installed profile and map every original phase and complete effort total.
4. Save the whole selection. Preserve saved revisions and any earlier edited mapping.
5. Choose **Prepare complete native package**. The request pins the current native helper and every selected profile's full hash.
6. Download the complete source/preparation ZIP and each required output, verifying full bytes and hashes.
7. Choose **Attach complete cohort to this case**. The original desk preflights the entire source count and size and attaches it in one native transaction.
8. For each original Workshare, open its maintained binding template and select actual deployments, source authority, receiving host/operator and approved payment/task budget.
9. Review the native Installation preview, then **Open complete Installation draft**. Save through the original Installation editor, preserving any earlier draft.

The source desk keeps original Staff case permissions, actor/request/revision controls, SQLite owner and pending-request recovery. It is the normal guided operator for this programme.

If a whole cohort exceeds the current case's source capacity, preserve the full prepared package and let the original case owner select the appropriate complete operation. Do not truncate files or attach a partial arbitrary prefix. Current limits and recovery commands are in `../../sf47_budget_model/workspace/INSTALLATION_SOURCE_DESK.md`.

## Terminal source preparation

Run the maintained original helper from the selected installed source. This command prepares source files only:

```sh
python3 stellar/scf_2026/sf49_data_commissioning/installation-workorders/source-inputs.py \
  --selection /absolute/original/environmental/SOURCE_SELECTION.json \
  --source-root /absolute/original/environmental/files \
  --out /absolute/private/environmental-prepared
```

Use the same complete selection, source root and private output on continuation. The native helper holds its original preparation lock, checks the frozen full request and publishes complete files atomically. A prior identical completed file is reused; a different retained file is preserved and rejected.

The complete output is:

| Output | What it retains |
|---|---|
| `SOURCE_SELECTION.json` | Complete original source and phase-effort selection |
| Original selected files | Every complete packet and supporting document |
| Selected amendment files, if any | Separately named reversible phase-ID amendments |
| `Supplier_Workshare_Commissioning.json` | All selected original plans and explicit effort bindings |
| `Supplier_Complete_Receiving_Packets.json` | Entire native receiving packets |
| `SUPPLIER_RECEIVING.json` | Whole original Installation receiver input |
| `SOURCE_PREPARATION.json` | Helper/profile identities, all cases and output receipts |

Read the actual `SOURCE_PREPARATION.json`, compare all original case and plan identities, phase counts, hours and terms, and retain every output. A successful preparation is `PREPARED_SOURCE`; it is not native Installation acceptance.

## Native whole-case receiving

Coordinate with the original operating-case writer before running the maintained receiver. Its target is the existing canonical workspace, case and pinned plan. A receiver must not compete with an already open managed workspace or another admitted case writer.

The complete source-owner programme retains the original ce7/884 case. Use its actual current workspace and version when accepted by that owner; do not restore an old export over a newer live case.

```sh
node stellar/scf_2026/sf49_data_commissioning/installation-workorders/receive.mjs \
  --operations-cli /absolute/installed/stellar/scf_2026/sf47_budget_model/workspace/cli.py \
  --workspace /absolute/original/operations-workspace \
  --case operation-ce7a44c92e754424bbe9e7547a0d98c9 \
  --plan plan-884f92ceac834ec588b3271011f1e0e1 \
  --inputs /absolute/private/environmental-prepared/SUPPLIER_RECEIVING.json \
  --source-root /absolute/private/environmental-prepared \
  --out /absolute/private/environmental-receiving \
  --receiving-workspace /absolute/independent/receiving-workspace \
  --actor "Actual original recording operator" \
  --receiving-actor "Actual independent receiving operator" \
  --python /absolute/python3
```

Replace only host paths and actual actor selections with the original accepted values. Keep the original request prefix and retained receiving directory. The receiver:

- Verifies every complete selected file and retains it before native attachment.
- Reads the current original case and confirms its pinned plan.
- Uses the original `installation-workshare-seed` and complete profile/bindings.
- Preserves original commercial phases, funding assignments and native acceptance checks.
- Saves the complete reviewed Installation through the existing native preview/save API.
- Reuses an already equivalent saved Installation and retains current original native edits.
- Exports the whole operating case, imports it into the independent workspace and reopens each exact selected Installation revision.
- Verifies saved document and original Workshare identities before publishing `RECEIVED.json`.

The complete native archive and `RECEIVED.json` belong together. Preserve all five saved Installation identities, each current source binding and every explicit outstanding selection. If the existing case already has multiple Installations for a selected Workshare, reconcile that original ambiguity in the desk rather than guess which one to overwrite.

The browser/HTTP Source Desk course is the existing `installation-source-desk-receiving.py` described in its guide. Pass the same complete environmental selection to that course under the original writer's chosen receiving lifetime. Do not run a second case writer merely to exercise the new profiles.

## Actual operating selections remain explicit

The profile cannot choose a merchant, customer deployment, payment recipient, source authority or receiving operator from an offer. Bind actual values in the original case:

- The accountable merchant and independent customer deployments.
- Complete authorized source edition or approved live connection.
- Approved network, asset, recipient, atomic unit price and whole task budget.
- Named reviewer and independent receiving operator, actual host and installed source release.
- Original correction/start conditions, source and runtime responsibilities.

The implementation fee and its milestones remain original commercial terms. The price of a useful `laboratoryReview` or `waterQualityReview` job is an independently selected operating price. Neither a fixed workshare quote nor a profile example sets a payment authority.

## Carry each full product through customer use

### Laboratory EDD and reissue

Keep full source, current decisions, optional baseline, baseline decisions and correspondences under the original five-slot job contract. Each selected upload must reach its original sealed state before execution. Preserve the same job and input descriptors through Stop and recovery.

Review every physical source row and native sample/test/batch/result relationship. Duplicate or ambiguous identities remain explicit. Keep result lexemes, units, qualifiers and independent method/reporting limits. Current and baseline field choices remain independent.

The maintained `readLabResult` verifies both original source inputs, the complete expected native member set, all conversion/source metadata and the entire review/comparison binding. The original CLI/SDK folder receiver retains the result ZIP and every verified member with its manifest, final receipt and relative-link entry page. Cold reopen that same complete folder before the client's actual EDP/import.

### Legacy DTS8D workbook

Retain the exact original XLS, physical cells/rows, formula tokens/caches, original types/formats and 1900/1904 epoch. Select formula/error literal values explicitly where required by the native renderer. A derived `.xls.xlsx` file has a separate name and exact original-source conversion metadata; it never replaces the original XLS.

Use the actual customer's provided DTS/client format and importer. Published DTS documentation and the software's generated format fixture do not prove a particular customer's installed template or accepted import.

### Paired scientific study

Retain every original measurement and independently reported limit. Save complete source-bound unit decisions. The original converter standardizes only supported compatible dimensions; a limit-only record does not acquire an invented measurement and an optical unit does not become mass concentration.

Keep original-unit and standardized analyses, complete compatible groups, period/edition comparisons and every underlying row. The scientific paid mode remains the existing `waterQualityReview` function. Its whole source, saved decisions, actual result and independent receiving are separate from source-only profile preparation.

### KiWIS commissioning

Retain the exact raw responses, ZIP members, original URLs and request receipts. Keep full metadata/catalogue rows and explicit coverage for selected series with empty responses. Preserve original numeric/string/null types.

Review the exact station/parameter/time/quality choices and all counterpart physical rows. `timestamp` and `sample_timestamp` may represent different instants; select the intended matching field and retain both unchanged. Preserve duplicates, unmatched rows and every correspondence reason.

Export all eight native products: bundle, review, decisions, observations, counterparts, correspondences, series and report. Receive and cold reopen the complete bundle. The existing paid commissioning mode binds exact review ID, saved SHA, review SHA and sealed original source; a successful job result must verify every returned export against the original saved review.

## Evidence and operating state

Keep four distinct outcomes in the original case:

| Outcome | Actual evidence |
|---|---|
| Source prepared | Full native source-preparation receipt and every complete output |
| Installation received | Original native save/export/import/reopen result and exact saved revisions |
| Product operated | Actual full selected source/job/browser/CLI result, original inputs and complete outputs |
| Customer accepted | The customer's actual acceptance tied to the original scope and delivery |

A generated workbook fixture verifies its stated format/path behavior. A public model delivery verifies its stated complete supplied rows. A prepared profile verifies neither a completed paid job nor an accepted customer import. Preserve these distinctions in the application narrative, forecast, milestones and customer handover.

Use the original operator's Stop, request recovery and source/version reconciliation throughout. No alternate laboratory parser, scientific engine, payment system, business store or grant case is introduced by these profiles.
