# Economic desk in the existing operator

The Economic desk is an additive operator entry for completed native scenario reports. It joins the authored decision companion to the current ECSA extension host. The existing Scenario decisions and Allocations panels retain their own responsibilities.

## Installed files

- install_economic_desk.py
- operator/economic_workbench.py
- operator/extensions/economic-desk.json
- operator/web/economic_desk.mjs
- operator/web/economic_request_store.mjs
- operator/web/economic_cost_worksheet.mjs
- operator/web/economic_desk.css
- operator/ECONOMIC_DESK.md
- operator/COST_WORKSHEETS.md

The existing model/decision_analysis.py, model/decision_cli.py and model/decision_desk.html are the delivered BC0B decision companion. The companion also includes its receiver and scientific/cost guides. This integration reads those installed source files directly.

## Receive into the current application

Receive the core decision companion and the current ECSA extension host into the actual cumulative application checkout, then extract this integration with the paths above. Run the installer with that checkout's original Python environment. The receiving example below uses the existing /opt/pyvenv/bin/python environment; substitute the actual application and source directories.

    /opt/pyvenv/bin/python -B install_economic_desk.py \
      --application /path/to/actual/cumulative-application \
      --source-root /path/to/received/economic-desk

The optional --dry-run returns the exact intended changes. The installer compiles the actual Python source in memory, prepares all source changes, uses the original shared extension-install lock, and checks every current replacement boundary. It installs only its own provider, browser assets, registration, guide and installer. The current shared host owns the authenticated file route. It can be rerun against the same edition.

For the complete cumulative application, use the current shared [application source](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/opportunities/upstate_forever_2026). It includes the integrated extension host and later composition. The original separate ECSA receiving bank remains available under operation ECSA-20261013-CURRENT-DECISIONS-HOST-DESIGNATIONS:
https://drive.google.com/file/d/15Hbqz3vXjiJAzp7ue7bhoka4BVgrByD6/view?usp=drivesdk

For separate-overlay receiving, run the selected complete source's actual install_extensions.py against the same cumulative application before this extension. The historical source edition recorded on 13 October 2026 at 00:46:21 UTC contained installer SHA256 6489167c5c2251dbdb9ad28fbcba6c38b3d5682286420e241840cce6ee9fd935 (19,222 bytes), registry SHA256 5cef14d2318e593ab9480f8bb9a784ab251e7506864882d91d04901c4070054b (24,854 bytes), and browser host SHA256 f3e288e2e7d5137fb617f814b841d8a62a605ae6c2ee62b8d6fe46c9dac6b0bf (16,710 bytes). It includes the typed retained-file routes used here, nested GIS member routes, task-label fallback, and the existing-app programme callback migration. That migration runs before adding the current host registration, so an older installed host upgrades with one host instance. Its workspace switch also preserves the original open-form guard before detaching the current desk. The shared host originated in public merged PR2641. Retain subsequent application changes by using current cumulative source for new receiving.

Use the operator's existing startup command and registered workspace/source arguments after the install. The current process loads registrations at startup. Its authenticated /api/extensions response then includes economic-desk and its navigation includes Economic desk. The source-native report remains in the original workspace/scenario-decisions/<report-id>/ directory.

## Operator journey

1. Open Economic desk in the existing operator. Completed native reports are discovered from the selected registered workspace. The original producer's decision.json descriptor resolves and verifies its complete report.json; a directly retained full report is also supported.
2. Choose the native report and reporting zone. Search zones by title or original ID. The panel displays the baseline, full scenario count, modeled outputs, original zone area and pollutant-specific common-cell coverage. Nitrogen/phosphorus-only and sediment-only reports keep their actual selected outputs.
3. Enter the edition title and any actual budget or physical reduction targets. Blank criteria remain open. A target is always expressed in that pollutant's annual mass units.
4. Expand each scenario whose full implementation estimate is available. Enter its explicit upfront/annual amounts, horizon and real discount rate, source title/reference/date, and actual cost footprint. A cost can cover the entire scenario or a defined implementation in the selected reporting zone. The zone's area never automatically prorates that estimate. Assistance and payment schedules are funding contributions; retain those references in notes instead of entering them as implementation cost.
5. Calculate the preview. It calls the same authored decision analysis on this source's already integrated common masses and shows whole-scenario reductions, annualized costs, eligibility and Pareto status.
6. Save inputs to the workspace, or build the complete edition. The browser retains the complete original action, source-bound payload and operation ID before sending either write. Both use the existing task queue. If the response is uncertain, recover that same request; if a task ID is known, reopen that original task. Interrupted builds recover their completed export before creating the missing saved-edition record.
7. A completed build opens the actual standalone desk in the panel. Use its physical table, cost/benefit chart, scenario selection, notes, saved HTML, CSV/JSON exports and print controls. Open the full desk in another tab or download the complete original package through the operator's verified file transport.
8. Saved inputs and editions remain listed in the workspace. Reopen a draft or reuse an edition's original source-bound cost/budget selection. Unsaved form fields also persist in browser storage for that workspace.

Zone-scoped estimates retain their originating report and zone identity in the saved input. Changing the reporting zone retains their amounts and provenance but unchecks them for review. An unspecified retained estimate receives the same treatment; an explicitly whole-scenario estimate can carry across zones. Intentional re-enabling retains the prior zone in reviewed_from provenance. The backend also checks supplied scoped estimates against the chosen source report and zone.

A target for an output absent from the current report remains visible in a separate retained-target notice. Its clear control removes only that target when selected. The study header uses the actual native source/workspace title, including when an original example such as Gura is selected.

Every unchecked cost remains unknown. A complete physical decision edition works with no costs entered. Exact source exceptions are shown per retained source or saved item while the other records remain available.

## Recover an original save or build

**Save inputs to workspace** and **Build and open complete edition** keep the complete original request before submission: selected Workspace, original action, operation ID, report/hash/zone and full decision selection. The **Original Economic operation** panel follows that request separately from the editable input draft.

The complete request and browser draft are retained in IndexedDB, keyed by the original Workspace and operation. Local storage keeps only a compact pointer. Large source audits and cost worksheets therefore do not depend on the smaller local-storage quota. Recovery verifies the stored payload hash before joining or sending the original native request. If writing the compact pointer fails after the complete record is committed, reopening the same desk still finds its record through the original Workspace key.

An uncertain network response does not create a replacement operation. **Recover original request** resends the same retained payload and operation ID through the existing queue. Once a native task ID is known, **Check original task** reads it directly and verifies its Workspace, action, operation ID and complete payload. A partial task summary from the ordinary state feed never replaces that source-bound request.

The original pending request survives closing the desk, navigating elsewhere and reloading the browser. Inputs, report/zone selection, worksheet application and saved-input replacement remain fixed until its actual task outcome is known. The input draft stays retained. A restored older browser state with only a pending task ID uses that exact native task to recover its original payload; it does not invent a new operation or drop the task because it is absent from a shortened state list.

Use **Open original task** for the existing native task controls and logs. An interrupted task exposes **Resume original interrupted task**, which resumes that same task. A definitively failed or cancelled task can be downloaded and retained with **Retain failed request and return to inputs**. Unknown or active tasks cannot be retired as though they had failed.

A completed task is checked against its original full input before the pending request is cleared. The completion panel retains the exact original task and resulting saved input or edition:

- **Open completed edition** reopens the actual complete Economic comparison.
- **Reopen saved inputs** deliberately replaces the current form with that original saved input.
- **Open completed original task** exposes its verified native files and logs.
- **Refresh original completion** rechecks the same task and result.
- **Download original completion** retains its complete original request and resulting record identity.

Submitting the same action with the exact most recently completed input reopens that retained result. It does not issue another task. Native Economic draft and edition identities remain governed by the existing backend, including its original source and implementation checks.

The request and completion controls are scoped to the original Workspace. A delayed response after a workspace switch cannot replace another workspace's draft. A build finishing after a page is closed is recovered through the original retained request or task when that workspace is reopened.

If persistent browser storage cannot retain the complete request, the error is visible and the request is kept in the open desk without being sent. Use **Download exact recovery file**, retain that JSON, then choose **Open original recovery file** and select it. The file includes the full draft, original request, Workspace and source hash. Opening it verifies those bytes and identity; a changed file, another Workspace or a different unresolved request is rejected. After it opens, **Recover original request** may continue that exact operation even if browser storage remains unavailable. This explicit file-backed path cannot submit a new or changed request under the old identity.

Keep the original recovery file until the native outcome is known. In file-backed mode, download the latest completion or exact recovery file before closing; reopening the earlier request safely rejoins its same original native task. **Download original request** is also available for inspection, while **Download exact recovery file** supplies the complete format accepted by the recovery picker. The picker accepts recovery JSON up to 128 MiB. A malformed retained state stays intact rather than being silently overwritten.

## Open a retained Economic edition from fieldwork

The existing host supports a source-preserving public opener:

    await host.openExtension("economic-desk", "openSavedEdition", {
      workspace_key: originalWorkspaceKey,
      edition_id: completedEconomicEditionId
    });

This controller method navigates to the original desk, waits for its actual mount/catalog, and opens the retained edition. It checks the Workspace before and after the asynchronous handoff. The current Economic input draft remains intact; an unresolved original Economic task must be recovered first.

In the saved field plan, **Costs → Review economic costs** reviews actual ledger allocations and explicit remaining/annual forecasts against one frozen Economic scenario. Its saved input and complete edition reopen through this same method. See [Review implementation costs](../docs/IMPLEMENTATION_COST_REVIEW.md) for the original ledger, forecast, evidence and complete-package workflow.

## Existing host bindings

The application-owned registration has schema upstate.operator-extension/v1 and id economic-desk.

| Surface | Binding |
| --- | --- |
| Browser factory | economic_desk.attachEconomicDesk |
| Navigation | economic-desk, after the current decisions entry |
| GET reads | /api/economic-desk/catalog, /source, /edition, /draft, /open |
| POST read | /api/economic-desk/preview |
| Queue writes | economic.draft.save, economic.edition.build |
| Added state | data.economic_editions, with editions/drafts/issues |
| Item kinds | economic-editions, economic-drafts |
| Task files | Existing _ticket and send_file transport |
| Typed file preview | backend.file_routes → preview(workspace_key, edition_id) → (ticket, authored policy) |
| Restore | Verify the extension's retained edition manifests and saved input identities |

The source/edition/draft read IDs are original 64-character content identities. No browser request supplies a host filesystem path.

Both queued writes accept:

    {
      "report_id": "<original producer report ID>",
      "report_sha256": "<exact full native report SHA256>",
      "zone_id": "<selected original zone ID>",
      "selection": { "...": "existing upstate.decision-selection/v1 fields" }
    }

The source read returns the actual comparison_id for each zone. The browser preserves it in selection. The backend checks the report identity, source bytes, zone and comparison before any economic analysis.

The native producer's entire completed cohort defines common spatial support. The extension retains each complete compatible land-cover scenario and its original unavailable-alternative reasons. It does not recombine isolated project reductions or dispatch another scientific run.

## Cross-desk join for S1 report owners

The existing ECSA host exposes this complete entry point:

    await host.openExtension("economic-desk", "openReport", {
      report_id: completedNativeSummary.id,
      zone_id: selectedNativeZone.id
    });

The report ID and zone ID come directly from the producer's actual saved summary/full report. The controller navigates to Economic desk, loads the retained native source and selects that zone. This optional button can be added by the owner of the native-report panel; the Economic desk navigation already supports discovery independently.

## Complete editions and active HTML

Retained drafts live at workspace/economic-drafts/<id>.json. Complete economic editions live at workspace/economic-editions/<id>/, with the existing complete decision export plus edition.json. The edition identity binds source report/zone/selection and the authored economic backend/viewer source.

The authored manifest registers the shared host's typed retained-file surface:

    "file_routes": [{
      "path": "/api/file/economic-desk/{workspace_key}/{edition_id}",
      "handler": "preview",
      "args": ["route.workspace_key", "route.edition_id"],
      "response": "ticket_policy_pair"
    }]

The provider returns the original ticket and authored content-security policy. The ECSA host uses the original authorized(file=True), existing HttpOnly download cookie and send_file implementation. The registered provider checks retained descriptors and the source/report selection, then grants executable hashes only for scripts equal to the currently installed authored model/decision_desk.html. The desk runs in an isolated sandbox with its needed save/download/print capabilities. Connections, objects and form submission remain disabled. Other retained HTML files keep their existing transport and policy.

A different older viewer remains available as its original complete downloadable edition. The route does not authorize arbitrary scripts found in result HTML.

The original workspace receiving/backup flow carries these additive installed sources and retained records. The standalone decision package itself remains portable and opens without this operator.

## Receiving source and product demonstration

Read source provenance for the current base server and app from:
https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/f4cb7c70a92f2db6a469ddffcca10f69ef5bdf4d/opportunities/upstate_forever_2026/source/operator-original-source-20261012.json

That original carrier contains server.py SHA256 6d2f5e84f8abab017c514f26f0bb36227439d1e3ca0f1dac5f92afc9a588d559 and app.mjs SHA256 64f388796a56a47f3eb9a6fa4512f36e6330d515db92bbc676519bc84c7962ed. The shared host joins come from the merged ECSA source above.

On the receiving host, open the actual operator workspace and exercise the journey above against a completed original native result. Retain the resulting edition ID and operator screenshots. The delivered model/decision_receive.py can then execute the complete saved-desk choose/filter/export/notes/save/reopen/print journey against that actual edition:

    /opt/pyvenv/bin/python -B model/decision_receive.py \
      --edition /path/to/actual-workspace/economic-editions/ACTUAL_ID

This reuses the already installed browser and completed model outcomes. The receiver writes actual screenshots, PDF, exports and timed journey records under that edition's receiving directory.

## One-command operator receiving

Run operator/economic_receive.py directly from the complete application checkout after the original operator is running. The feature installer retains its own provider, browser modules, registration and operating guides. This additional receiving command uses the installed Playwright Python package, an existing Chromium/Chrome executable, and the delivered model/decision_receive.py.

If the original operator is not already running, start its existing server from that same checkout against the retained native workspace. Keep this process running in its terminal; its first output is the original ready JSON used by the receiving command in a second session:

    /opt/pyvenv/bin/python -B operator/server.py \
      --workspace /path/to/retained/native-workspace \
      --operator-state /path/to/economic-operator-state \
      --port 0 > /path/to/original-operator-ready.json

Choose the workspace containing the completed original scenario-decisions report. The server's own start_server uses its available local port and returns the actual project, workspace key and authenticated operator URL.

    /opt/pyvenv/bin/python -B operator/economic_receive.py \
      --operator-url-file /path/to/original-operator-ready.json \
      --output /path/to/operator-receiving

The URL file accepts the original server's JSON receipt (operator_url or url) or its printed URL text, including the original token fragment. Alternatively put that already-issued URL in UPSTATE_OPERATOR_URL and omit --operator-url-file; --operator-url-env selects another existing variable. The command keeps authentication values out of its records and command line. --application selects the existing complete checkout if the script is invoked from another directory.

Use --workspace-key, --report-id and --zone-id to choose particular retained results. Without them, the command uses the operator's primary workspace and an available comparison report with a compatible alternative and shared-support zone. Baseline-only reference totals remain separate from this scenario journey. Optional --selection accepts that zone's existing decision-selection/v1 JSON, including original cost source details and footprint provenance. Each supplied cost carries its whole_scenario, reporting_zone or source-bound retained scope. The command saves the complete original input through the existing queue, opens that saved input with the browser control, then continues the same preview and edition journey. It also retains the original selection file bytes in the receiving package. With no supplied selection, all costs remain unchecked and the command produces the original physical comparison. --run-id chooses the demonstrated alternative. --browser-executable points at an already-installed browser when needed.

The command drives the original browser controls for report and zone selection, quantitative preview, saved inputs, reopening those inputs, and queued edition construction. It opens the authenticated embedded desk, chooses an actual modeled scenario, saves working HTML from that embedded desk, reopens it and produces its PDF. It then downloads the original complete package through the operator, checks its retained descriptors and members, and invokes the existing offline choose/filter/export/notes/save/reopen/print receiver.

Each invocation creates a timestamped directory under --output. operator-journey.json retains the real task, source report, zone and edition identifiers, actual timings, browser messages and failures. The directory also contains screenshots, PDFs, saved HTML, the verified complete decision package, its full offline receiving run and the source of this command. economic-operator-receiving-package.zip carries that complete receiving result. Existing original queue tasks and native model outputs are reused; this command does not dispatch model runs or install browser dependencies. --task-timeout-seconds controls how long to watch the original queue; its task remains available in the operator if that watch expires.


## Bulk reviewed cost worksheets

Use **Download cost worksheet CSV** or **Download cost worksheet JSON** to prepare sourced implementation estimates for the original report's alternatives. **Review completed worksheet** previews all changes before **Apply reviewed worksheet** updates the current inputs. The original worksheet and estimate provenance travel through saved inputs, complete editions and the client-report economic package. The [complete worksheet workflow](COST_WORKSHEETS.md) documents fields, exact report/zone binding, spreadsheet editing, subset imports and receiving.


## Continue a chosen scenario into fieldwork

In a completed edition, choose **Plan implementation**, explicitly select one original whole scenario, review its modeled outcomes and source costs, and continue to the existing Implementation & fieldwork desk. Choose the destination plan there; its native source intake preserves the economic edition and its original reporting zone. Assignments, schedules and field budgets use the existing plan controls. See [Economic scenarios into implementation planning](ECONOMIC_IMPLEMENTATION.md) for the complete source and receiving workflow.


### Continue into implementation planning and its report

Add `--implementation` to the same `operator/economic_receive.py` command to continue the original completed Economic edition through **Plan implementation**. The receiver explicitly selects the original scenario, uses **Create a new plan for this scenario**, follows the original native plan-create and source-import tasks, and reopens the resulting saved revision. It checks the retained edition, native report, zone, signed outputs and original cost footprint against that selected source.

The continuation exports the complete portable plan JSON and creates the native implementation report through the existing queue. It downloads every original report member against its manifest, opens the readable scenario report, and retains its screenshot and PDF alongside the original economic package. The final journey result includes the actual plan ID, revision, source binding and task IDs. Native planning and reporting use the already completed model results; work assignments, budgets and field observations remain available for the operator to enter in the new plan.

## Inspect the actual received product

The current application repository instructions require the producing worker to open and operate the exact outgoing client-facing product on the receiving host before calling it ready. Use the existing Economic receiving course with the actual retained native scenario and Workspace. View its rendered desktop and narrow layouts, operate the core controls and relevant empty/loading/error states, then download and reopen the actual outputs. Inspect the returned screenshots and pages, repair concrete visible faults, and retain the actual source, task and result identities with that same receiving course. Source-runtime checks or a receipt alone do not establish that the delivered product was viewed.
