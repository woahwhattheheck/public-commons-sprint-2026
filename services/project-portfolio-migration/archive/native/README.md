# Original native archive receiving

This is a following phase of the existing equipped portfolio receiving operation. It uses the actual project editions retained by that operation, the same complete PortfolioWorkspace and the existing migration desk. Its input is saved native MPXJ output; it does not acquire another project or submit a target operation.

## Select the completed source

Keep the parent operation's original workspace, operation ID, current complete product source and native result files. Read the actual edition IDs returned by that operation. Select distinct original projects for a portfolio cohort. An alternative corrected edition of a project belongs in a separate comparison cohort.

The receiving function derives labels and available COST, ACTUAL_COST and WORK measures from the actual captured project model and field definitions. Unsupported fields are omitted from that example profile. Complete native fields and definitions still enter the relational delivery.

Use the original MPXJ runtime if it is already injected into the parent process. This archive phase reads retained models and needs no additional native file conversion. Its original authenticated desk obtains a fresh local token at each reopen.

## Join the same original operation

From the complete product root:

    python3 archive/native/receive.py \
      --workspace /private/original-portfolio-workspace \
      --edition <actual-first-native-edition-sha256> \
      --edition <actual-second-native-edition-sha256> \
      --output /private/original-native-output/archive \
      --operation-id <same-original-native-receiving-operation> \
      --node /path/to/node \
      --playwright /path/to/playwright/index.mjs \
      --chromium /path/to/chrome-headless-shell

One original edition is sufficient for a single-project handover. The output directory must be outside the original workspace. The receiver creates its own received-workspace inside that output and retains all source and receiving artifacts there.

An already running Python receiver can call the same phase directly:

    from archive.native.receive import receive_archive

    result = receive_archive(
        original_workspace,
        actual_edition_ids,
        original_output / "archive",
        operation_id=original_operation_id,
        node=node_path,
        playwright=playwright_module_path,
        chromium=chromium_path,
        native=original_portfolio.native,
    )

The module imports operator/native/receive.py and reuses its running_desk, browser_receive, artifact verification and browser lifetime. The original operator/native/browser.mjs hands the archive phases to archive/native/browser.mjs after establishing the same workspace identity and saved action state. It does not start a second server or browser inside that handoff.

On Linux, the original browser's temporary files stay in one process-private /dev directory. The source, workspace, operation record, downloads, screenshots and final receipts must be in a durable selected directory. Keep one receiver attached to this original phase.

## The complete journey

The first phase creates a cohort through the actual Archive UI, selects the actual retained editions, saves the selected profile and deliberately loses the completed save reply. The existing action history rejoins that same request. It then reviews and publishes the complete cohort, reads native task rows, runs a read-only SQL query, exports every result and downloads the complete archive, SQLite database, HTML report, data dictionary, Power Query, Azure SQL script and operating guide.

The following fresh workspace uploads that exact archive, inspects all original members and receives it through the actual UI. This phase loses one completed receive reply and rejoins its original request. Publication, archive, review and source edition identities are compared with the first workspace.

The receiver then moves only its owned intake filename to a retained sibling. All original source objects remain in the received stores. The same completed receiving request must return its original result without the intake filename. Every selected complete native model is compared with the original workspace. The desk finally reopens again, reads its saved cohort, inspects the native rows and reruns the reporting query without source uploads.

Desktop and mobile captures use widths 1440 and 390. Screenshots and downloaded files are retained atomically and verified against their saved hashes. If a carrier ends before the deliberate lost-reply marker can be saved, the original helper records the actual carrier-recovery outcome while continuing the same action.

## Resume and consume

Rerun the exact command with the same workspace, selected editions, output and operation ID. Completed phase results verify and reuse the original artifacts. Pending action IDs remain in the original browser and workspace histories. When an original action is retained as FAILED and its concrete cause has been repaired, --resume-failed asks the existing action API to continue that same request.

The final result is output/result.json. Its schema is portfolio.archive-native-receiving-result.v1 and state is COMPLETE. It contains:

- The original operation, selected native editions, labels and exact metric profile.
- Original, received and reopened phase results.
- Exact cohort, publication, review and archive identities.
- The original save, review, publish, query-export, inspect and receive request IDs.
- The source-absent same-request replay.
- Complete file paths, byte counts and SHA-256 values for every returned artifact.

operation.json pins the selected source and original operation. selected-profile.json records the actual native metric choices. source-selection.json and its retained history identify the source used at each continuation. The original, received and reopened subdirectories retain their browser action checkpoints, storage state, downloaded delivery files and screenshots.

Use these outputs for the existing customer's handover and the same parent operation's result. The commercial case and target execution history remain in their original workflows.

## Following native timephased reporting phase

Use the actual edition returned for the original upstream
junit/data/timephased-budget-baseline.mpp fixture. The parent operation already
owns its native intake and runtime. Preserve its exact edition/workspace and
original receiving operation ID.

Add --native-timephased to this same archive receiving command and choose an
owned following output directory such as original-native-output/archive-timephased.
The flag selects explicit weekly intervals from the actual retained raw span
bounds, rounded outward to complete equal-width weeks, and supported native WORK/CURRENCY/material field definitions. A saved
explicit selection may instead be supplied with --timephased-profile profile.json.
The two flags are mutually exclusive.

    python3 archive/native/receive.py \
      --workspace /private/original-portfolio-workspace \
      --edition <actual-timephased-fixture-edition-sha256> \
      --output /private/original-native-output/archive-timephased \
      --operation-id <same-original-native-receiving-operation> \
      --native-timephased \
      --node /path/to/node \
      --playwright /path/to/playwright/index.mjs \
      --chromium /path/to/chrome-headless-shell

An already equipped original Python receiver calls receive_archive with its same
arguments plus timephased=True, or timephased=<complete selected profile dict>.
Pass native=original_portfolio.native so the original runtime is reused.

This phase enters periods and named series through the actual Archive controls.
Its first native review retains full original calculation records and requires
no native calculation errors for the selected fixture. The browser verifies
complete assignment facts/period totals, runs and exports the full totals query,
downloads the complete source/reporting ZIP and retains desktop/phone views.

The following receive/reopen phases inject RetainedCalculationOnly, whose native
lookup, lock and ensure methods fail if invoked. Successful receiving therefore
demonstrates source/calculation/table verification without a second native
calculation. The original selected models, complete JSONL objects, archive and
query rows remain unchanged. Source-absent same-request receiving is preserved.

Keep the same operation/output/edition/profile arguments for a continuation.
selected-profile.json pins the actual generated periods and fields. Existing
completed source and browser phase receipts are verified and reused. The
result's profile.timephased and original publication identify this following
reporting delivery; native receipt and customer screens must come from the
same accepted original operation.

The receiving result retains both assignment effective calendars and the actual
project baseline calendar, with the selected native basis named per series/fact.
Native duration overlap and endpoint/first-match cost accrual are preserved.
The selected profile must satisfy the original pro-rata COST-resource fixed-grid
admission when that actual source path is present; a rejected range is corrected
through the original cohort/profile review before any JNI period invocation.
