# SF47 planning: headless operation and receiving

The command-line operator opens the same private planning workspace as the browser. It uses the original `Workspace` methods for calculation, saved revisions, named plans, restoration and complete bundle imports. The original Decimal calculator remains `../budget.py`.

Use this interface to prepare a grant delivery plan on a Linux worker, revise the staffing and payment assumptions in a saved plan, retain the complete history for another operator, and reopen the result in the browser. The maintained Starforge distribution includes the original scenario, calculator, browser workspace and this operator under their repository paths.

## Start from the installed release or original source

Python 3 on Linux is required. The model uses the Python standard library, including SQLite and `fcntl`; the installed command uses the existing Node launcher to start Python. Select another Python executable with `SF47_PYTHON=/absolute/path/to/python3`. No shell command is evaluated by the launcher.

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

This is the original browser-compatible bundle, generated by `Workspace.export`. It contains `workspace.json` with the full saved history and original scenario; current scenario and planning; original model and delivery-plan JSON; daily cash-flow, work-package and contributor CSVs; the original README; and the original file manifest.

Receive it with the original model:

```sh
starforge grant-workspace import-bundle --workspace /absolute/private/scf-receiving --file /absolute/delivery/scf-plan-r5.zip --name 'Received delivery plan' --request-id scf-receive-r5-20261011
starforge grant-workspace serve --workspace /absolute/private/scf-receiving
```

The receiving plan has a new ID. It retains the complete original revision sequence, saved timestamps, notes, content digests and source identity. The response contains its ID and saved contents, plus the exact received ZIP's SHA-256. The browser can open the same ZIP directly through its existing import control. The native import verifies bundle membership, file lengths and hashes, revision continuity and the original model inputs, and recomputes the reports through the same calculator.

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
