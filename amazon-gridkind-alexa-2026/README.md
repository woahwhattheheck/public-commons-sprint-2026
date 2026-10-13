# GridKind household scheduling workspace

GridKind turns a household's flexible loads and 24-hour price assumptions into a feasible schedule. It keeps named household inputs, seven-day schedules, original daily plans, tariff comparisons, approvals, and labeled simulated receipts in one retained workspace.

The original joint optimizer respects each load's duration and deadline, 22:00–07:00 quiet hours, and the shared circuit cap. The original agent proposes a schedule, accepts approval for its exact plan ID, and executes the simulated schedule with an idempotent receipt. The household workspace makes those decisions available across server restarts and portable handoffs.

## Run the application

Use Node.js 24; the complete browser workflow was exercised with Node 24.19.0 and Chromium 153. Runtime packages are built into Node.

```bash
cd amazon-gridkind-alexa-2026
node server.mjs
```

Open http://127.0.0.1:4181. The default saved workspace is `~/.local/share/gridkind`.

To select a workspace explicitly:

```bash
node server.mjs --workspace /absolute/path/to/gridkind-households --port 4181
```

The same directory and browser cookie reopen the same households. `GRIDKIND_WORKSPACE`, `PORT`, and `HOST` are also supported. Keep the default loopback host for a personal local workspace. An explicitly selected non-loopback host exposes a shared HTTP service and should be operated within the intended trusted environment.

## Complete household workflow

1. Name the household and choose **New from current inputs**. The current editor becomes its first saved input revision.
2. Choose loads, allowed hours, duration, quiet-hour constraints, circuit cap, and hypothetical prices. The simple editor retains the three original example loads and tariff bands. **Edit hourly rates and custom loads** exposes all 24 prices and up to five named loads with ordinary editable controls.
3. Give the input revision a useful name and choose **Save inputs**, or choose **Plan this scenario** to save and plan it together. An infeasible input keeps the existing household available and reports the original optimizer's reason.
4. Review earliest feasible cost, optimized cost, start times, and the hourly profile. **Approve this exact schedule** binds the original proposal ID. **Execute simulation** records the original simulated commands and receipt.
5. Use **What if the tariff changed?** to compare retaining the current starts with replanning the same loads under another tariff. The completed original analyzer report is saved in household history.
6. Choose **Use this tariff for a new plan**, or open an older comparison in history and select its alternative. This restores that comparison's loads and constraints with the selected prices, then starts the original fresh-plan and approval flow.
7. Open any saved record to inspect its input windows, plan, decisions, tariff report, and exact JSON. **Use these saved inputs** restores an earlier revision for fresh planning.
8. Download a household backup. In another browser or on another machine, preview that file and choose **Restore as a new household**. The restored household retains every saved record and its original identity and digest.

Opening another household or restoring a saved record first retains a valid edited draft. A draft with incomplete values remains in the editor so its fields can be corrected. **Reopen saved inputs** returns the editor to the current saved scenario. A stale tab cannot apply its previous household's approval to the newly selected household; its draft stays available to create a separate household.

## Plan the whole week

Choose **Plan a week** to open seven independently editable days from the selected household. Set each day's 24 prices, circuit cap, and flexible loads; copy a routine to weekdays or the weekend; and mark rest days. **Plan and save this week** uses the original optimizer for each enabled day and retains the complete result in household history.

Feasible days remain usable when another date needs attention. The result explains the affected day and labels which days contribute to the cost and energy totals. Open a saved planned day directly in the original daily workspace to plan, approve, and simulate it. CSV and tentative local-time calendar downloads carry the saved schedule, while the normal household backup carries its entire history.

The [complete weekly operator guide](WEEK_PLANNING.md) covers the routine editor, per-day repair, saved revisions, daily continuation, export formats, and model boundaries.

## Review a week with another person

Select a saved household week and create an independent review request. Download the exact request and offline reviewer HTML; the reviewer edits a local copy and returns a complete response. In the original household, preview it against the current saved week and explicitly resolve conflicting name/day choices. Applying the return preserves the original request, returned notes, owner selections and a newly planned normal week in the existing history.

The review does not approve or execute a daily schedule. A resulting day continues through the original fresh proposal → exact approval → labeled simulation. Full household backups retain the linked review history and restore as a separate household in another browser.

The [complete review and receiving guide](WEEK_REVIEW.md) covers offline operation, source and identity limits, owner reconciliation, interrupted returns and full independent reopening. The new review workflow's actual native/browser receiving is reported separately from the accepted original daily/week journeys.

## What survives reopening

The SQLite workspace retains named households, input revisions, original proposal views, dated weekly schedules, tariff comparisons, approvals, simulated receipts, and their record relationships. Each record includes the original scenario and source hashes for the optimizer, agent, analyzer, and weekly planner used to produce it.

Reloading a page in the same live server session keeps its active proposal. Opening a saved household, restarting the server, restoring inputs, or importing a backup starts with the saved scenario and a fresh active approval flow. Historical approvals and receipts remain readable in the decision history. The next proposal receives a new revision and plan ID. Household and live-session identity also scope server-issued proposal IDs, so identical inputs in two households cannot exchange approval IDs.

A backup uses `gridkind-household/v1`, ordered records, a SHA-256 digest for each record, and a digest over the household payload. Restore checks the complete payload, record identities, order, parent references, input shape, and digests before a single database transaction creates the new household. Those hashes check content integrity; imported historical results remain supplied data. Applying an imported scenario runs the installed original optimizer before its new approval.

Household ownership follows the random HttpOnly, SameSite=Strict browser cookie. Download a backup before clearing browser data or moving machines. For a complete server migration, stop the process and copy the chosen workspace directory; use the same browser cookie or restore a household backup in the new browser.

## Original portable scenario sharing

**Share a simple scenario** preserves the original preview/apply format from PR890: the three example load identities, the three fixed tariff bands, and an optional illustrative cost summary. This compact 40 KB input file is useful for sharing an example. The full household backup supports custom loads, individual hourly rates, and complete decision history.

Applying a simple scenario uses the original cancellation operation before filling the editor. The next schedule follows the original propose → approve → simulated-execute sequence.

## Original optimizer and accepted simulations

`engine.mjs` and `robustness/compare.mjs` remain the original implementations. The optimizer enumerates jointly feasible whole-hour placements for 1–5 tasks, preserves the earliest feasible baseline, and selects the minimum-cost schedule with its original tie handling. The accepted flat-tariff symmetry bound stops equivalent alternatives once the admissible lower bound is achieved.

The original Muse OPT3-02 retained panel had 41 exact output/error matches; its later 7,500-case continuation is retained in the original simulation channel. This workspace consumes those accepted results and source instead of duplicating the optimizer study. The supplied `robustness/sample.json` preserves the original three-load scenario and tariff alternatives.

In the real browser walkthrough, those exact original inputs produced a modeled earliest-feasible cost of $4.4540 and an optimized cost of $2.0360. Repricing at the supplied flat $0.22/kWh alternative produced $2.6840 for both the retained and freshly optimized schedules. These numbers describe the entered hypothetical scenario.

## Storage and HTTP integration

`workspace.mjs` owns the SQLite household store. Mutations use an immediate transaction and a workspace revision check. The server forks the original in-memory agent, saves the resulting household record, and only then replaces the live agent. A failed database write therefore leaves the previous live agent available.

The existing `GET /api/state`, `POST /api/action`, and `POST /api/robustness` remain the native routes. State adds a `workspace` field. The browser includes its `revision`, `generation`, and `householdId` with each mutation. The comparison response additionally identifies the saved record and updated workspace metadata.

Household routes:

| Route | Purpose |
| --- | --- |
| `GET /api/workspace/history` | Paged saved-record summaries for an owned household |
| `GET /api/workspace/record` | Exact saved record and digest |
| `GET /api/workspace/export` | Complete household backup |
| `POST /api/workspace` | Create, select, rename, save, restore, adopt tariff, preview import, or import |
| `POST /api/week` | Plan and retain a week, or restore one of its planned days |
| `GET /api/week/export` | Download the saved weekly schedule as CSV or calendar |

The service retains strict same-origin static assets and mutation checks. All imported names and historical results are rendered as text. The workspace directory is created with private permissions; the database uses mode 0600. Local APIs continue to use the original application controls.

## Operator walkthrough and competition handoff

The [official Amazon developer hackathon rules](https://amazonappdev2026.devpost.com/rules) allow the alternate simulated Alexa+ experience. The current deadline is **October 23, 2026, noon PDT / 19:00 UTC**. The entrant supplies a public video under three minutes and the required source, product description, feedback, and submission fields. The original entrant and media owner remain the delivery route.

Use the complete household journey for the actual product recording: enter inputs, inspect a plan, compare a tariff, select it for a fresh plan, approve and simulate, then reopen its saved history. The original `DEVPOST_SUBMISSION_FEEDBACK_20261010.md` retains the entrant's competition-field guidance. The included MIT license applies to this source.

The rendered workflow covers original inputs, retained comparisons, explicit approval and idempotent simulation, five custom loads, a stopped-and-restarted SQLite server, exact record recovery, a separate-browser backup restore, a changed backup rejected before mutation, concurrent-tab handling, and desktop/390px layout.


## Use this household through MCP

The original local application now exposes a household-bound MCP2025-11-25 Streamable HTTP connection. Open **Assistant connection** in the daily page to name a connection and download its private client configuration. The assistant can read retained history, propose daily/weekly work, continue the original weekly review and export complete artifacts. Human approval remains in the original browser; simulated execution requires that exact approved plan. Full original request/result receipts survive response loss and restart, and remain historical when a household is received. See [MCP.md](MCP.md) for the complete connection, file client, recovery, revoke and receive/reopen workflow. No real device or external service is changed.
