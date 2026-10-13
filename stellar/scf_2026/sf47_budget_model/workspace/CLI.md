# SF47 planning: headless operation and receiving

The command-line operator opens the same private planning workspace as the browser. It uses the original `Workspace` methods for calculation, saved revisions, named plans, restoration and complete bundle imports. The original Decimal calculator remains `../budget.py`.

Use this interface to prepare a grant delivery plan on a Linux worker, revise the staffing and payment assumptions in a saved plan, retain the complete history for another operator, and reopen the result in the browser. The maintained Starforge distribution includes the original scenario, calculator, browser workspace and this operator under their repository paths.

## Installation delivery queue

Use `operations delivery-queue --case ID --as-of YYYY-MM-DD [--output FILE]` for the complete dated JSON view, and `operations delivery-queue-export --case ID --as-of YYYY-MM-DD --output FILE` for the full handover ZIP. Add `--workspace PATH` to the operations group. [Installation delivery queue](DELIVERY_QUEUE.md) provides complete commands, assignment editing and import/reopen instructions.

## Installation effort and support

Use `operations installation-effort-seed --case ID --installation ID --expected-revision N --expected-version N --as-of YYYY-MM-DD [--document FILE] [--output FILE]` to prepare the complete saved Installation review. Save the edited full document through the existing installation-preview/save commands. `installation-effort-selection --case ID --expected-version N --forecast ID --installation-selections FILE [--name TEXT] [--note TEXT] [--output FILE]` opens its reviewed remaining hours as a complete original Forecast input. [Installation effort and support](INSTALLATION_EFFORT.md) documents the full file-based operation and complete handover.

## Start from the installed release or original source

Python 3.10 or newer on Linux is required. The model uses the Python standard library, including SQLite and `fcntl`; the installed command uses the existing Node launcher to start Python. Select another Python executable with `SF47_PYTHON=/absolute/path/to/python3`. No shell command is evaluated by the launcher.

Installed release:

```sh
starforge grant-workspace --help
starforge grant-workspace init --workspace /absolute/private/scf-planning
starforge grant-workspace serve --workspace /absolute/private/scf-planning
```

Original source:

```sh
python3 stellar/scf_2026/sf47_budget_model/workspace/cli.py --help
python3 stellar/scf_2026/sf47_budget_model/workspace/cli.py init --workspace /absolute/private/scf-planning
python3 stellar/scf_2026/sf47_budget_model/workspace/cli.py serve --workspace /absolute/private/scf-planning
```

The browser `serve` command delegates to the existing server, including its private access file, local address checks, saved authentication key, signal handling and exclusive workspace lock. It prints the original local URL and access-file path. `--port` and `--access-file` are passed through. Close the browser server before running a headless command against that same workspace; a second owner receives `WORKSPACE_OPEN`. The lock is released when each headless operation finishes.

`init` creates the original canonical-source plan when the workspace is new. Import commands can also initialize a receiving workspace. Read and edit commands require an existing workspace and do not create a directory for a mistyped path. Existing plans remain available when another bundle is received. `--scenario PATH` selects the source used for initial creation; use `import-scenario` to add a different source to an already initialized workspace.

All paths in the examples are explicit operator-selected paths. Create an output directory before exporting. Outputs are private files published only after their complete bytes are ready. An existing output filename is preserved; choose a new filename for a later export. Each export response gives its absolute path, byte length and SHA-256.

## Find the plan and review its saved inputs

```sh
starforge grant-workspace list --workspace /absolute/private/scf-planning
starforge grant-workspace show --workspace /absolute/private/scf-planning --plan plan-EXACT_ID
starforge grant-workspace history --workspace /absolute/private/scf-planning --plan plan-EXACT_ID
```

Replace `plan-EXACT_ID` with the complete ID returned by `list`. Each plan read returns its current revision, selected revision, original source identity, saved content digest, planning inputs and computed report. `history` returns all saved revisions, notes, timestamps and content digests.

Read an earlier revision explicitly:

```sh
starforge grant-workspace show --workspace /absolute/private/scf-planning --plan plan-EXACT_ID --revision 2
```

Export the complete planning object for editing, or inspect the retained delivery acceptance plan:

```sh
starforge grant-workspace show --workspace /absolute/private/scf-planning --plan plan-EXACT_ID --revision 2 --part planning --output /absolute/working/planning-r2.json
starforge grant-workspace show --workspace /absolute/private/scf-planning --plan plan-EXACT_ID --revision 2 --part delivery --output /absolute/working/delivery-r2.json
```

The available `--part` values are `all`, `scenario`, `planning`, `report`, `delivery` and `source`. These return the original stored or computed objects. Ordinary JSON results go to stdout. `show`, `list`, `history` and `estimate` also accept `--output` for a new private JSON file.

## Estimate, then save the exact reviewed edit

Create a scenario patch JSON containing only the intended editable fields. A normal patch preserves the original source metadata and deployment acceptance plan. The accepted top-level fields are `scenario_name`, `award_request_usd`, `project_end_day`, `milestones` and `future_costs`. The original model validates each field and row.

When changing milestones or work packages, supply the complete intended list. The original model merges each listed row with its existing row by tranche or package ID; it replaces the list with those listed rows. Unlisted rows are removed. Source and acceptance metadata changes use the separate original-scenario import workflow.

The planning JSON is a complete planning object, as returned by `show --part planning`. It carries:

| Input | Meaning |
| --- | --- |
| `calendarStart` | Optional day-zero date for the saved plan |
| `capitalUsd`, `capitalNote` | Explicit working-capital assumption and its basis |
| `contributors` | Named capacity assumptions: `id`, `name`, `weeklyHours`, `note` |
| `assignments` | Package allocation: `costId`, `contributorId`, `hours` |
| `pricing` | Per-package `hours` or `fixed` pricing mode |
| `payments` | Per-package accrual, completion delay or exact installments |
| `deliveryNotes` | Tranche keys `1`, `2`, `3` with operating responsibilities |
| `notes` | Context for the plan and the assumptions being evaluated |

Payment `completion` entries use `lagDays`; `installments` entries use a complete `installments` array of `{ "day": INTEGER, "usd": "DECIMAL" }`. The original model requires the installments to total the complete package amount. Contributor allocations must refer to current package and contributor IDs and cannot exceed the package hours.

Estimate the edit at the exact reviewed revision:

```sh
starforge grant-workspace estimate --workspace /absolute/private/scf-planning --plan plan-EXACT_ID --expected-revision 2 --patch /absolute/working/scenario-patch.json --planning /absolute/working/planning-r2.json --output /absolute/working/estimate-r2.json
```

The result includes the original calculator output, day-by-day cash timing, staffing capacity, 14/30/60-day payment-lag comparisons and complete delivery plan. Review the result, then save those same input files:

```sh
starforge grant-workspace save --workspace /absolute/private/scf-planning --plan plan-EXACT_ID --expected-revision 2 --patch /absolute/working/scenario-patch.json --planning /absolute/working/planning-r2.json --note 'Reviewed staffing and contributor payment dates' --request-id scf-staffing-review-20261011
```

Omitting `--patch` preserves the saved scenario. Omitting `--planning` preserves the planning object from `--expected-revision`, including a later retry of the same request. Providing a planning file replaces the complete planning object. An explicit empty object asks the native model to apply its default empty planning settings.

Every saved change has a stable `--request-id`. Reuse that ID with the exact command inputs after a lost acknowledgment. The original transactional request ledger returns the original saved result. Reusing an ID for different inputs returns `REQUEST_CONFLICT`. An independently advanced plan returns `REVISION_CONFLICT`; read the current plan and review the new edit before choosing its expected revision. The original model does not append a new content revision when a saved edit is unchanged.

## Named alternatives and restoration

Clone the reviewed current plan to explore a separate staffing or delivery alternative:

```sh
starforge grant-workspace clone --workspace /absolute/private/scf-planning --plan plan-EXACT_ID --expected-revision 3 --name 'Contributor payment timing alternative' --request-id scf-payment-alternative-20261011
```

The native clone begins a new plan with its own ID and retains the original source identity. It does not copy the parent plan's revision history; use a complete bundle when the receiving operator needs that history.

Restore an earlier saved revision as a new current revision:

```sh
starforge grant-workspace restore --workspace /absolute/private/scf-planning --plan plan-EXACT_ID --expected-revision 4 --revision 2 --note 'Restore the reviewed delivery baseline' --request-id scf-restore-baseline-20261011
```

The original revisions remain available. The native model appends the restored scenario and planning, recomputes their report, and records the selected old revision in the new revision's note.

## Import a distinct original scenario

```sh
starforge grant-workspace import-scenario --workspace /absolute/private/scf-planning --file /absolute/source/scenario.json --name 'Delivery plan from agreed source' --note 'Imported the agreed scenario and assumptions' --request-id scf-source-import-20261011 --source-url https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/stellar/scf_2026/sf47_budget_model
```

The same exact UTF-8 source bytes are parsed and hashed; the original filename, SHA-256 and specified source URL remain with the plan. `--planning` can supply complete planning settings during import. The source scenario passes the original calculator and workspace validation. Normal revisions preserve that original source separately from later planning changes.

## Deliver one complete plan

```sh
starforge grant-workspace export --workspace /absolute/private/scf-planning --plan plan-EXACT_ID --expected-revision 5 --output /absolute/delivery/scf-plan-r5.zip
```

This is the original browser-compatible bundle, generated by `Workspace.export`. Its eleven members contain `workspace.json` with the full saved history and original scenario; `original-source.json` with the exact originally imported bytes; current scenario and planning; original model and delivery-plan JSON; daily cash-flow, work-package and contributor CSVs; the original README; and the original file manifest. The manifest identifies the ten payload files by their exact lengths and hashes.

Receive it with the original model:

```sh
starforge grant-workspace import-bundle --workspace /absolute/private/scf-receiving --file /absolute/delivery/scf-plan-r5.zip --name 'Received delivery plan' --request-id scf-receive-r5-20261011
starforge grant-workspace serve --workspace /absolute/private/scf-receiving
```

To finish a delivery for an earlier saved edition after later work has been saved, select that original revision explicitly:

```sh
starforge grant-workspace export --workspace /absolute/private/scf-planning --plan plan-EXACT_ID --revision 5 --output /absolute/delivery/scf-original-plan-r5.zip
```

Choose either `--expected-revision` or `--revision`. The first requires the current plan to match the reviewed revision. The second exports the named saved revision and every original revision through it, even when the source workspace has later saved work. Both use the same eleven-file bundle and original exporter. The active plan, later revisions and saved requests remain available in the source workspace. The export response reports the selected revision and the source workspace's current revision.

The receiving plan has a new ID. It retains the complete exported revision sequence, saved timestamps, notes, historical reports, content digests and exact source bytes. The response contains its ID and saved contents, plus the exact received ZIP's SHA-256. The browser can open the same ZIP directly through its existing import control. The native import verifies bundle membership, file lengths and hashes, revision continuity, original source identity and the original model inputs. It validates each historical scenario through the current calculator while retaining that revision's original report and saved timestamp. Subsequent changes use the current original calculator.

## Transfer every saved plan and resume an interrupted receiving operation

```sh
starforge grant-workspace export-all --workspace /absolute/private/scf-planning --output /absolute/delivery/scf-planning-complete.zip
starforge grant-workspace import-all --workspace /absolute/private/scf-receiving --file /absolute/delivery/scf-planning-complete.zip --request-id scf-full-receiving-20261011
```

The collection is a ZIP envelope containing `COLLECTION.json` and one **unchanged original complete plan ZIP** per saved plan. The manifest records each original plan ID, name, revision, source, content digest and bundle bytes/hash. This is a transport grouping of the native bundles. Each receiving plan still passes through the original `import_bundle` method.

The workspace stays under the original exclusive lock while the export captures its saved plans. A receiving operation validates the complete collection envelope before opening the destination, binds the supplied request ID to those exact input bytes in `cli-imports`, and gives every native plan import a stable request ID. If the process stops partway through receiving, repeat the same command with the same file and request ID. Already committed native imports return their original results; remaining plans continue. A different collection with the same request ID is rejected before additional imports.

The returned `plans` array maps each `originalId` to its receiving `id`, with source, revision, content digest and original bundle hash. The destination's existing plans remain available. A fresh destination also has the original initial canonical plan created by `Workspace`; imported plans receive their own IDs and original names. The operation record is retained under the private workspace so the exact transport can be identified after interruption.

The original per-plan import limit is 32 MiB compressed and expanded. A collection accepts up to 128 MiB and 10,000 plans. Each member remains subject to the original per-plan validation. Use individual complete plan exports when a collection exceeds the collection size. Imported bundles are read directly in memory; archive paths are never extracted into the filesystem.

After receiving, use `history` and `show` with a returned receiving ID, then start `serve` against the same destination. The source, contributor/payment assumptions, prior revisions and delivery plan are available through the original browser.

## Output and recovery contract

Successful commands emit one JSON value; `serve` emits the original server's startup result and keeps serving. Errors emit a JSON object on stderr with `ok: false` and `error.code`, `error.message` and, for domain errors, `error.status`. Argument mistakes use standard CLI usage output. Exit code `0` means completion, `2` means a rejected or unsuccessful local/domain operation, `130` means interruption, and launcher exit `127` means Python could not start.

| Result | Operating action |
| --- | --- |
| `WORKSPACE_OPEN` | Close the current browser/headless owner, then resume the same operation |
| `WORKSPACE_NOT_FOUND` | Use the intended existing path or initialize a new workspace explicitly |
| `REVISION_CONFLICT` | Read the current saved plan and review its next edit |
| `REQUEST_CONFLICT` | Keep the original request for exact recovery; use a new ID for a genuinely new operation |
| `OUTPUT_EXISTS` | Preserve the existing deliverable and select a new output filename |
| `INVALID_COLLECTION` | Use the complete retained collection whose hash was delivered |
| `durabilityWarning` | Complete published bytes were read back; inspect the indicated directory-sync failure while retaining the returned exact file |

The launcher supports `--help` without initializing a workspace. All commands also expose command-specific `--help`. For source operation, `python3 workspace/cli.py` provides the same contract without the Node wrapper.

## Canonical planning basis

The current source is the original [SF47 budget model](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/stellar/scf_2026/sf47_budget_model). Its current candidate retains the original remaining-work and deployment acceptance inputs. Local contributors, hours, rates, capital and payment dates are saved operator assumptions, and grant inflows use the selected scenario's conditional timing. The command-line operator preserves those distinctions in the same computed report and complete handover.

The earlier source integration [PR1167](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/1167) bound the deployment acceptance plan to the current scenario. Follow the current saved source digest and the workspace owner's current source release when comparing a received plan. The CLI calls the original model for every calculation and keeps the original imported scenario alongside subsequent edits.

## Original-currency forecast inputs

The existing forecast preview/save commands accept complete original-currency inputs through `--inputs`. See [Original currencies in operating forecasts](CURRENCY.md) and the [complete input example](examples/native-currency-forecast.json) for native prices and costs, retained rates, original payment credits, event timing and the conditional currency exports. Keep the whole normalized input from preview when saving or passing a selected Portfolio alternative back to Forecast.

## Operating forecasts

The original `operations` command includes `forecast-preview`, `forecast-save`, `forecasts`, `forecast-show` and `forecast-export`. Use the same case ID, explicit expected version and stable request ID. Saving additionally requires the exact reviewed preview SHA-256 and complete input JSON. Full examples and source/receiving semantics are in [FORECAST.md](FORECAST.md). The ordinary case `export` and `import` commands carry all immutable saved forecasts with the original source and work/payment records.

## Portfolio with installation phases

Use the original Portfolio commands to allocate saved Installation phases alongside all other grant and customer work. The installed release and original source both call the same case owner. Close the managed browser service before opening that same workspace with the headless CLI.

In the commands below, `$CASE_ID`, `$CASE_VERSION` and `$FORECAST_ID` are the actual values from the current case and its selected saved Forecast. Create the private output directory first. The [Portfolio guide](PORTFOLIO.md) describes phase effort, original terms, the commercial delivery boundary and support capacity.

Read the current case and seed its saved Forecast:

```sh
starforge grant-workspace operations --workspace /absolute/private/scf-planning \
  show --case "$CASE_ID" --output /absolute/private/output/case-current.json
starforge grant-workspace operations --workspace /absolute/private/scf-planning \
  portfolio-seed --case "$CASE_ID" --forecast "$FORECAST_ID" \
  --expected-version "$CASE_VERSION" --output /absolute/private/output/portfolio-seed.json
```

Review the complete `installationCandidates` and `sourceTasks` arrays in that seed. Write the selected exact editions as one JSON array. Every item contains `taskId`, `installationId`, `installationRevision` and `installationSha256`. Use the returned original IDs, edition numbers and digests.

Extract the complete seed's `inputs` object for editing. This retains all original arrays and decimal strings:

```sh
python3 - /absolute/private/output/portfolio-seed.json /absolute/private/output/portfolio-base-inputs.json <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf-8") as source:
    retained = json.load(source)
with open(sys.argv[2], "x", encoding="utf-8") as target:
    json.dump(retained["inputs"], target, ensure_ascii=False, indent=2)
    target.write("\n")
PY
```

Seed the selected phase source while preserving that complete draft:

```sh
starforge grant-workspace operations --workspace /absolute/private/scf-planning \
  portfolio-seed --case "$CASE_ID" --forecast "$FORECAST_ID" \
  --expected-version "$CASE_VERSION" \
  --installation-selections /absolute/private/output/installation-selections.json \
  --inputs /absolute/private/output/portfolio-base-inputs.json \
  --output /absolute/private/output/portfolio-phase-seed.json
```

Both new flags are optional. `--installation-selections` reads a complete JSON array; `--inputs` reads a complete existing Portfolio draft object. Reuse the same extraction command with the phase-seed filename and a new draft filename, then edit that full `inputs` object. Passing an entire seed/preview wrapper as `--inputs` does not select its inner input.

Enter resource availability and phase remaining hours, retain each original phase and dependency, and enter the delivery boundary and its note. Every phase effort map must total its remaining hours; phase remainders must total the original commercial task's remainder. Set the bound parent minimum working duration to zero. Phase `priority: null` inherits the aggregate task priority; an entered integer, including `100`, is explicit. Newly seeded phase priorities are null.

The seed attaches or refreshes base phase plans and preserves every explicit alternative override, including `installationPlans: []`. Omission inherits the base array; an explicit empty array uses the original aggregate tasks and requires their complete resource effort. To refresh one alternative, compose its complete inherited fields as temporary base `inputs` with `alternatives: []`, run `portfolio-seed` with its reviewed selections, and retain only the returned `installationPlans` as that alternative's complete override in the original draft. Keep the other settings and alternatives. The [SDK example](AGENT.md#prepare-one-explicit-phase-alternative) shows the same full-input transformation.

Preview and retain the reviewed input:

```sh
starforge grant-workspace operations --workspace /absolute/private/scf-planning \
  portfolio-preview --case "$CASE_ID" --expected-version "$CASE_VERSION" \
  --inputs /absolute/private/output/portfolio-reviewed-inputs.json \
  --output /absolute/private/output/portfolio-preview.json
starforge grant-workspace operations --workspace /absolute/private/scf-planning \
  portfolio-save --case "$CASE_ID" --expected-version "$CASE_VERSION" \
  --inputs /absolute/private/output/portfolio-reviewed-inputs.json \
  --expected-preview-sha256 "$PORTFOLIO_PREVIEW_SHA256" \
  --actor "$ACTOR" --request-id "$PORTFOLIO_REQUEST_ID" \
  --note "$PORTFOLIO_REVIEW_NOTE" --output /absolute/private/output/portfolio-save.json
```

Set the preview digest from the exact retained preview. Keep that complete input file, every save argument and the stable request ID before dispatch. A save receipt's `recordId` is the new saved Portfolio ID, and `version` is the new case version. After an interrupted response, repeat the identical save command and input with the same request ID. A definite original source/version conflict requires a refreshed review and a new request.

Reopen the result with `portfolio-show --case "$CASE_ID" --portfolio "$PORTFOLIO_ID"`. Select a saved `READY` alternative using the freshly read case version:

```sh
starforge grant-workspace operations --workspace /absolute/private/scf-planning \
  portfolio-selection --case "$CASE_ID" --portfolio "$PORTFOLIO_ID" \
  --alternative "$ALTERNATIVE_ID" --expected-version "$CURRENT_CASE_VERSION" \
  --output /absolute/private/output/portfolio-selected-forecast.json
```

Extract that result's complete `inputs` with the same JSON extraction procedure. Pass the extracted file to `forecast-preview` and then `forecast-save` with the current version, exact preview SHA, actor and a separate retained Forecast request ID. Review original collections, currencies, rates and event conditions before saving. Selection itself leaves the original saved Forecast available.

Export the complete calculation and receiving case:

```sh
starforge grant-workspace operations --workspace /absolute/private/scf-planning \
  portfolio-export --case "$CASE_ID" --portfolio "$PORTFOLIO_ID" \
  --output /absolute/private/output/installation-portfolio.zip
starforge grant-workspace operations --workspace /absolute/private/scf-planning \
  export --case "$CASE_ID" --expected-version "$LATEST_CASE_VERSION" \
  --output /absolute/private/output/installation-portfolio-case.zip
starforge grant-workspace operations --workspace /absolute/private/receiving-workspace \
  import --file /absolute/private/output/installation-portfolio-case.zip \
  --name "Received installation allocation" --actor "$ACTOR" \
  --request-id "$RECEIVING_REQUEST_ID"
```

Use the received case ID to list and reopen its saved Portfolios. Keep the complete original case ZIP and receiving request for exact import replay. The calculation ZIP contains the full reviewed source and results; the whole case ZIP restores the saved Installation editions, attachments, original events and Forecasts through the existing receiver.

## Cohort acceptance and its original tranche join

Use `operations cohort-seed`, `cohort-preview`, `cohort-prepare` and `cohort-export` against the same retained case. Put `--workspace` after `operations` and before the selected action. The seed/preview need the exact current case version; preparation also needs the original actor/request ID, complete reviewed `--inputs` object and exact `--expected-preview-sha256`. An unchanged retry reuses the same request and source.

The complete walkthrough and commands are in [OPERATIONS-COHORT.md](OPERATIONS-COHORT.md). `completion-preview` and `completion-prepare` accept optional `cohortReviewIds` inside their existing `--data` JSON. Native preparation checks the original review's tranche, cutoff, targets and measurement currentness and includes its original sources in the same completion ZIP. Omitting the field preserves the existing behavior. Ordinary case export/import retains all cohort reviews and their original history; it does not create replacement purchases.

## Customer installation commissioning and receiving

The existing `operations` command now includes `installations`, `installation-seed`, `installation-preview`, `installation-save`, `installation-show`, `installation-history` and `installation-export`. They operate the original workspace and case. Seed returns the complete editable `document`; save takes the reviewed document file and appends one immutable installation edition in the same original request transaction.

For example, read the current heads and reopen an exact saved edition:

~~~sh
python3 workspace/cli.py operations --workspace /absolute/private/workspace \
  installations --case operation-ORIGINAL

python3 workspace/cli.py operations --workspace /absolute/private/workspace \
  installation-show --case operation-ORIGINAL \
  --installation installation-ORIGINAL --revision 1

python3 workspace/cli.py operations --workspace /absolute/private/workspace \
  installation-export --case operation-ORIGINAL \
  --installation installation-ORIGINAL --revision 1 \
  --output /absolute/private/output/complete-installation.zip
~~~

The complete handover is received by the original `operations import` command, which returns the selected installation alongside the new case identity. Continue with that exact saved edition, its original acceptance input and source closure. Reopen original request IDs after uncertain saves or imports. The complete commissioning input, preview/save options and receiving example are in [INSTALLATIONS.md](INSTALLATIONS.md).

## Original implementation evidence

The original `operations` command includes `implementation-source`, `implementation-preview`, `implementation-prepare`, `implementation-export` and `implementation-original`. [The complete guide](IMPLEMENTATION_EVIDENCE.md#native-cli-and-http-interfaces) gives exact arguments, source/record selection, preview/hash binding and the same-request recovery path. These commands read the maintained SF74 producer and use the original operating-case journal, source store and complete bundle importer.
