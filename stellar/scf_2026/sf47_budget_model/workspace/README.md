# SF47 delivery planning workspace

Run the actual SF47 funding calculator through a retained local planning workspace. The workspace opens the current Stellar Forge candidate, keeps its original source and deployment acceptance plan, and lets the operator work through staffing, payment timing, milestone scheduling, alternative scenarios and complete revision recovery.

The application uses the original [budget.py](../budget.py) for every accepted scenario. Its current source is [sf10_current_candidate.json](../sf10_current_candidate.json); the accompanying [calculator guide](../README.md) explains the native funding model and source assumptions.

## Start and reopen

Use Linux with Python 3.10 or newer and a current browser. The application uses Python's standard library, SQLite and a retained operating-system file lock. Its browser files are plain HTML, CSS and JavaScript.

From the repository root:

~~~sh
python3 stellar/scf_2026/sf47_budget_model/workspace/server.py \
  --workspace /absolute/private/scf-delivery-planning
~~~

The command prints a local URL and an absolute access-file path. Open that private HTML file and follow **Open the retained local workspace**. Its fragment carries the workspace key into the browser; the application removes the fragment from the address bar. The sign-in page also accepts the key from the private access file.

The server selects an available local port and binds to 127.0.0.1. To select a port:

~~~sh
python3 stellar/scf_2026/sf47_budget_model/workspace/server.py \
  --workspace /absolute/private/scf-delivery-planning \
  --port 8765
~~~

On first open, the server imports the actual current candidate. It creates the retained directory with:

- **planning.sqlite3** — plans, original source records, saved revisions, calculated reports and mutation receipts.
- **access.key** — the private local workspace key.
- **open-workspace.html** — the current local access link, regenerated for the selected port.
- **workspace.lock** — the file used for the live operating-system lease.
- SQLite journal files while the application is open.

Press Ctrl+C to close the server. It stops accepting requests, waits for its active handlers, closes SQLite and releases the operating-system lease. Repeating the same command opens the same plans and revisions. A second simultaneous server for the same directory returns **WORKSPACE_OPEN**; the existing server retains ownership. If a process exits unexpectedly, the kernel releases its lease and SQLite recovers its committed state on reopening.

For a different initial source, use `--scenario /absolute/path/scenario.json` with a new private workspace. An existing workspace keeps its retained plans. Import a new source through the application when continuing an established workspace.

## Use the actual current candidate

The checked-in current source contains six future work packages, 400 estimated hours, a $95 hourly planning rate and a $38,000 request over 150 project days. The full source also retains deployment, operating-record and receiving targets for three tranches.

Open **Copy saved plan** to create a named alternative before changing the source scenario. A copied plan starts a separate revision history while keeping the original source filename, source digest and full source body. The source candidate remains selectable in the workspace.

The seven sections form one connected workflow:

| Section | Operator work | Result |
|---|---|---|
| Overview | Review request, original funding schedule, conditional cash gap, day-zero calendar date and any entered working-capital input. | Current native calculation, daily chart and delay comparison. |
| Work packages | Edit future work, eligible category, tranche, dates, hours, rate or fixed amount, and measurable acceptance work. | Recalculated package cost with original row metadata retained. |
| Milestones | Edit submission days, review/payment delays, deliverables and measurable acceptance criteria. | The original calculator validates all ordered tranche and payment constraints. |
| Staffing | Add named contributors or planning roles, their weekly capacity and source notes; split package hours across contributors. | Allocated and unassigned hours, peak weekly equivalent and periods exceeding entered capacity. |
| Payment timing | Record accrual-based timing, full payment after package completion, or dated installments, with source notes. | A separate cash outflow schedule retaining every package's full amount. |
| Delivery plan | Review the complete original deployment targets, source record joins and proposed windows; add accountable owner and schedule notes. | The original operational scope remains attached to the planning revision. |
| Saved versions | Review prior inputs and reports, then restore a selected version as a new revision. | All intervening saved work stays available. |

Every calculated or saved scenario runs through the original Decimal calculator. It retains the original request cap, eligible future-cost rules, package-to-tranche constraints, inclusive accrual schedule and tranche shares. A validation error keeps the draft available for correction.

Editing an hourly amount derives cost as estimated hours multiplied by the hourly rate, rounded to cents by the original helper. Fixed-price mode keeps an explicitly entered amount. Use **Match request to package costs** in **Work packages** after a deliberate scope or price change, then calculate again; the original calculator requires the request and full future-cost total to agree.

### Save, review and restore

1. Edit a draft across any of the seven sections.
2. Choose **Calculate draft** to refresh the native cost, funding, cash and capacity reports.
3. Enter a meaningful revision note and choose **Save revision**.
4. Use **Reopen saved** to discard a draft and load the current retained version.
5. In **Saved versions**, select **Review** to inspect a specific saved version.
6. Choose **Restore as a new revision**, enter the reason, and continue from the newly appended version.

Changing a draft marks its earlier calculations as stale. Saving performs calculation and validation again. An unchanged save returns the current revision rather than adding a duplicate.

Every write carries the revision the operator reviewed. A newer concurrent revision causes **REVISION_CONFLICT**, so the operator can reopen and reconcile it. Writes also carry an idempotent request ID: the same ID and same operation return the original committed result, including after a lost response; a reused ID with different input returns **REQUEST_CONFLICT**. Copying a plan participates in that same receipt transaction.

## Read cash and staffing accurately

### Original accrual and entered payment timing

The original calculator measures future cost evenly across each package's inclusive start-to-end day span. The workspace preserves this result as **Original accrual gap**.

The payment-timing section separately describes when the complete amount would leave the business:

- **Accrual** follows the native cost accrual curve.
- **Completion** places the entire package amount on its end day plus the entered payment delay.
- **Installments** places each entered amount on its specified day. The installments must add exactly to the package amount.

The daily report displays cumulative accrued cost, planned cash outflow, conditional grant inflow, the resulting cash gap and accrued but unpaid cost. Its horizon extends through the last modeled tranche payment or entered package payment, up to the supported planning limit of day 500. Moving a payment changes timing and retains its full cost.

A working-capital input is optional. When entered, the report displays the gap remaining after that amount and preserves its source note. A blank input stays blank. Add a day-zero date when calendar dates are useful; the same integer day schedule remains the calculation basis.

### Compare review and payment delays

The overview applies 14-, 30- and 60-day review/payment delay to all three milestones through the original calculator. It displays both the original accrual gap and the separately entered cash gap. A **Use ... days** action applies that delay to the draft.

For the checked-in current candidate, using the default accrual payment timing:

| Review/payment delay | Hypothetical tranche payment days | Native peak gap | Peak day |
|---|---|---:|---:|
| 14 days | 0, 44, 104, 164 | $15,200.00 | 150 |
| 30 days | 0, 60, 120, 180 | $18,746.67 | 119 |
| 60 days | 0, 90, 150, 210 | $26,346.67 | 149 |

These values come from the actual candidate and original calculator. Saved alternatives retain their own cost and timing inputs. Source basis text, quote status and application metadata survive normal edits; current computed totals are shown separately.

### Contributor capacity

A contributor can represent an identified person or an explicitly named planning role. Record the source or scheduling assumption in its note. Enter available hours per week, then assign a portion of each package's estimated hours.

The workspace distributes assigned hours evenly across the package's inclusive **calendar-day** span and multiplies each day's load by seven to show a weekly equivalent. It identifies over-capacity days and remaining unassigned hours. This follows the native package calendar; use the note to record working-week constraints or negotiated availability that the operator still needs to incorporate.

Removing a contributor also removes its assignments. Removing a work package removes its pricing and payment entries and its staffing assignments. The complete source deployment plan remains attached; a notice identifies any removed package still referenced by that source plan so the intended scope change can be reconciled.

## Export, exchange and recover complete plans

**Export complete workspace** downloads one complete ZIP for the selected saved plan. It contains:

| File | Contents |
|---|---|
| workspace.json | Original source identity and parsed body, all saved revisions, notes, timestamps, calculated reports and content digests. |
| original-source.json | The exact imported source file bytes, preserving formatting and its advertised original SHA-256 digest. |
| scenario.json | The latest saved scenario, directly usable by the original calculator. |
| planning.json | Contributor allocation, entered payment timing, calendar/capital inputs and operator notes. |
| original-model.json | The original calculator result for the selected saved revision. |
| delivery-plan.json | The complete retained deployment acceptance plan. |
| daily-cash-flow.csv | Every modeled day and all cash/accrual fields. |
| work-packages.csv | Every saved work package, dates, hours/rates, amount and acceptance work. |
| contributors.csv | All contributor capacity and overload summaries. |
| README.txt | Receiving instructions and source identity. |
| MANIFEST.json | Exact file byte counts and SHA-256 digests for the ten payload files. |

The ZIP contains the saved revision. An unsaved draft remains visible and is called out after download. The overview also offers standalone scenario JSON and daily CSV downloads.

Choose **Import scenario or workspace** and select the complete ZIP to reopen it as a separate named plan. Import validates the exact member set, manifest byte counts and SHA-256 digests, consecutive revision numbers and revision content digests. It verifies original-source.json against the retained source digest and parsed source object, validates every scenario through the current native calculator, and retains each historical report and saved timestamp. This makes the original historical review available beside subsequent current revisions.

Choosing a scenario JSON instead creates a new plan with one initial revision, the exact selected source bytes and their SHA-256 digest. Source metadata, full deployment acceptance work and cost-row metadata travel with that scenario.

Imports are limited to 32 MiB compressed and expanded. CSV exports protect spreadsheet cells beginning with formula characters. Store complete plan bundles with the team's controlled grant-working documents; the bundle includes entered staffing, payment and source notes.

### Retain the whole local workspace

For all plans together, close the server and copy the private workspace directory as a unit. Keep **planning.sqlite3**, any remaining SQLite journal files and **access.key**. Reopening that directory reconstructs the local access link and retains all plans and operation receipts.

For a per-plan receiving handoff, use the complete ZIP and the application's import control. To adopt a reviewed scenario into the application work, export **scenario.json** and run the original calculator:

~~~sh
python3 stellar/scf_2026/sf47_budget_model/budget.py \
  /absolute/path/sf47-scenario.json
~~~

The original calculator guide documents its output options. Put reviewed application changes through the existing canonical SCF owner workflow with the exported source and revision note.

## Native API and integration

All `/api/` routes require `Authorization: Bearer <private workspace key>`. The host and optional browser Origin must match the actual local origin. The server emits a strict local Content Security Policy and serves a fixed set of application assets.

| Method and route | Operation |
|---|---|
| GET /api/access | Current access, application version and original source URL. |
| GET /api/plans | Retained plan IDs, names and current revisions. |
| GET /api/plans/{id} | Current scenario, planning inputs, source identity and calculated report. |
| GET /api/plans/{id}/history | All retained revision metadata. |
| GET /api/plans/{id}/revision/{n} | Exact selected saved revision. |
| POST /api/plans/{id}/estimate | Validate and calculate draft inputs. |
| POST /api/plans/{id}/save | Append an idempotent version after the expected-revision check. |
| POST /api/plans/{id}/restore | Append a selected prior version as a new current revision. |
| POST /api/plans/{id}/clone | Create an idempotent copy of the reviewed saved plan. |
| GET /api/plans/{id}/export.zip | Complete plan/revision bundle. |
| GET /api/plans/{id}/scenario.json | Original-calculator-compatible current scenario. |
| GET /api/plans/{id}/daily.csv | Full current daily cash table. |
| GET /api/plans/{id}/costs.csv | Full current cost table. |
| POST /api/import-scenario | Import original JSON bytes or supplied JSON text as a new source plan. |
| POST /api/import-bundle?name=... | Import a complete ZIP with an X-Request-ID header. |

Estimate and save use the same draft shape:

~~~json
{
  "expectedRevision": 1,
  "scenarioPatch": {
    "scenario_name": "Reviewed delivery alternative"
  },
  "planning": {
    "calendarStart": null,
    "capitalUsd": null,
    "capitalNote": "",
    "contributors": [],
    "assignments": [],
    "pricing": {},
    "payments": {},
    "deliveryNotes": {},
    "notes": ""
  }
}
~~~

Send the complete planning object from the read response when retaining existing planning inputs. A save adds **note** and **requestId**. A restore sends **expectedRevision**, **selectedRevision**, **note** and **requestId**. A clone sends **expectedRevision**, **name** and **requestId**.

A source import sends name, filename, note, requestId and exactly one of sourceBase64 (the exact source-file bytes) or sourceText (the exact supplied UTF-8 text). Both retain the bytes and verify them against the parsed source and source digest.

Normal scenario edits accept scenario name, requested amount, project end day, milestone fields and future-cost fields. They merge cost and milestone rows by stable ID/tranche, preserving the complete source metadata and deployment plan. Import is the workflow for adopting a different source document.

Python callers can import `Workspace` from `model.py` or use `create_server(workspace_path, source_path=None, port=0, access_file=None)` from `server.py`. A direct embedded server owner must stop `serve_forever`, call `server_close()` to drain its handlers, then call `server.workspace.close()` to release SQLite and the lease. The command-line entrypoint already performs this order.

## Source layout

- **model.py** — original-calculator composition, source-preserving edits, Decimal cash/capacity reports, transactional revisions, receipts and complete bundle handling.
- **server.py** — local access, HTTP routes, private startup files and orderly shutdown.
- **index.html**, **app.mjs**, **style.css** — responsive seven-section operator workspace with keyboard controls, drafts, charts, source detail, import/export and saved-version review.
- **README.md** — startup, planning, receiving, recovery and native API instructions.

Use the saved plan's source digest, revision number, change note and complete exported source when coordinating the next staffing, milestone or application decision.
