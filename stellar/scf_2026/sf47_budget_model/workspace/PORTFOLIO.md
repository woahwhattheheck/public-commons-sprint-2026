# Portfolio delivery allocation

This workspace plans the same remaining grant and quoted customer work that is already in a saved SF47 operating forecast. It allocates that work to entered resources and working dates, compares the resulting delivery dates and cash needs, and opens a selected alternative in the original Operating forecast editor.

The cash calculator remains the original `forecast.py` implementation. Resource hours determine dates. The original prices, obligations, recorded payments, receipt schedules and expense rules determine cash.

## Open the original work

Start the maintained SF47 workspace with its normal saved data directory and authenticated local URL. Open **Delivery and cash operations**, choose the original case, then **Portfolio allocation**. The original recording-operator field identifies each saved operation.

Choose a saved operating forecast and select **Create plan from this forecast**. The seed contains every remaining work package and selected customer implementation from that forecast. Each task keeps its source identity and original date window. Exact original grant contributor assignments are copied only when their total equals the source's remaining hours.

A later case source or record may make an older forecast stale. Use the original Operating forecast editor to save that forecast's unchanged or deliberately revised inputs against the current case, then seed from the resulting current saved forecast. The previous forecast and its source remain available.

The seeded working-week choices and horizon are displayed exactly as returned by the service. Daily resource availability starts blank. A blank daily value is unentered; an entered zero means unavailable. Grant assignments that no longer match remaining hours and unassigned customer work appear as incomplete inputs until the operator supplies the relevant allocation.

## Enter the base allocation

### Calendar and capacity

The calendar uses Monday=0 through Sunday=6 in JSON. Its start date, horizon, working weekdays, closed dates and additional working dates define the dates on which work can be allocated.

For each role or person, enter seven daily available-hour values. Dated overrides replace that resource's availability on the selected date. **Distribute a weekly total** is an explicit editing action: enter the total, inspect the selected working weekdays, then apply it. The editor divides the total over those weekdays using exact decimal arithmetic and gives the other weekdays an explicit zero. The resulting dated capacity and its explanatory note are editable.

The source's original weekly capacity remains visible as a reference. Choosing a weekday pattern or a larger roster is a new allocation assumption. The allocation results retain that exact input.

### Remaining tasks

Every task from the saved source forecast remains in the allocation. Enter its remaining hours by resource; the total must equal the original source hours. Accepted work and cash amounts continue to come from the original case and forecast.

Optional predecessors express delivery dependencies between those tasks. Release dates, due dates, minimum working duration and priority are explicit planning inputs. A minimum duration begins with the first actual allocated work, so time spent waiting for a busy resource does not satisfy that duration. The minimum cannot shorten the work required by the entered effort and capacity.

The operator can change resource assignments, dependencies and date assumptions while keeping the complete source task set. Work-scope or quoted-cost changes belong in a new original operating forecast.

## Compare complete alternatives

Select **Add alternative**, enter its name and reasoning, then enable the fields that differ from the base plan. An overridden calendar replaces the whole calendar. An overridden resource list replaces the whole list. An overridden task list replaces the whole task list. Fields without overrides follow the base plan.

The editor clones the current base field when its override is enabled. This makes the complete replacement visible and editable. Changes to the base after that point affect inherited fields, while the visible overridden copies remain explicit.

**Preview allocation and cash** computes the entered alternatives. It displays:

- The original saved forecast's entered finish, hours, funding need and weekly-equivalent overload count.
- Each alternative's state, feasible finish, late-task count, remaining hours and original cash comparison.
- Resource requested/allocated/available hours and utilization.
- Actual ready, first-work and finish dates, dependency and due-date outcomes.
- Chosen changes to the original task date windows.
- Paged daily resource capacity and task allocations.
- Complete source identities and downloadable calculation data.

`READY` means the entered work has been allocated within the horizon. `INCOMPLETE` retains missing capacity or effort findings. `HORIZON_EXCEEDED` retains the partial schedule and unscheduled work. Incomplete inputs can be saved for receiving and later editing.

### Read cash and collection timing together

The original forecast remains the sole cash calculation. Quoted collections, conditional grant receipts, invoice dates, amounts and original installment dates retain their entered values. The allocation changes package and customer work start/finish dates.

The existing completion-payment rule uses the later of the chosen finish and the original finish plus its entered lag; see **FORECAST.md**. Original accrual rules use the selected work window.

An allocation may therefore postpone work while a collection stays on its original date. Ready results include specific collection-timing findings where an original collection precedes allocated work or the revised completion. Read those findings beside the cash figures before choosing a delivery plan. **Collection timing to review** counts these findings; it does not change the original receipt dates.

Cash needed before an opening balance, and the gap after an entered balance, remain distinct. An unentered opening balance stays unentered. All amounts are the original USD-valued forecast amounts.

## Save, reopen and select

Preview the current inputs, enter the recording operator, and select **Save reviewed allocation**. The original command saves the normalized input, its reviewed preview identity, the source forecast snapshot, the complete dated results and the original save event.

If a response is interrupted, the exact request remains in the browser. **Retry the same save request** uses the same request ID, expected version and input and receives the original saved result when it already exists. A reported original validation or stale-source rejection retains the draft and rejected request; **Keep draft and prepare a new request** is the explicit path to re-preview against current case state. Transport or rate uncertainty keeps the original request pending.

Use **Saved allocations** to reopen an immutable result. **Edit a new allocation from this saved input** starts another editable draft. The saved result remains its original source-bound calculation.

For a saved ready alternative, select **Open dated cash forecast draft**. The original portfolio selection endpoint returns a new original forecast input with the chosen package and customer work dates. The existing Operating forecast editor opens those inputs without saving them. Review the collection dates and other cash assumptions, preview, then save through its original normal flow.

Draft inputs and unresolved save requests are retained per original case in the current browser session. Download the complete input JSON before moving to another browser or device. An earlier unreadable browser record remains downloadable for reconciliation with the original saved case history.

## Complete receiving and exports

**Download complete saved portfolio** produces the source-bound result archive, including the complete portfolio JSON, original forecast snapshot, input, report, dated cash and allocation CSVs. The original operations **Export complete case** includes saved portfolios and their original forecasts, plan, source attachments and event history.

Import the complete original operations archive through its existing receiving interface to reopen the whole case. The standalone portfolio archive is the calculation and source handoff; the full operations archive is the native workspace receiving carrier. Saved portfolio validation checks its exact original forecast and its save event.

The current source adds no separate database. `operations.py` owns the original `ops_portfolios` table and case save/import transaction.

## Runtime and source joins

The maintained workspace serves:

| Entry | Purpose |
| --- | --- |
| `portfolio.py` | Source normalization, seed, alternatives, original cash join, saved validation and export |
| `portfolio_schedule.py` | Pure deterministic resource/day allocation |
| `portfolio.mjs`, `portfolio.css` | Complete editor, retained save, result comparison and original forecast selection |
| `operations.py` | Original authenticated case transaction, saved records and complete import/export |
| `operations_http.py` | Original HTTP routes and static asset entries |
| `operations_cli.py` | Original CLI seed, preview, save, show, export and selection |
| `forecast.mjs` | Original cash editor, with an explicit initial-input handoff |
| `operations.mjs` | Original operator tab and selection integration |

The browser uses these original authenticated case endpoints:

```text
POST /api/operations/{case}/portfolio-seed
     {expectedVersion, forecastId}
POST /api/operations/{case}/portfolio-preview
     {expectedVersion, inputs}
POST /api/operations/{case}/command
     {expectedVersion, actor, note, requestId,
      action:"portfolio.save",
      data:{inputs, expectedPreviewSha256}}
GET  /api/operations/{case}/portfolios
GET  /api/operations/{case}/portfolios/{portfolioId}
GET  /api/operations/{case}/portfolios/{portfolioId}/export.zip
POST /api/operations/{case}/portfolio-selection
     {expectedVersion, portfolioId, alternativeId}
```

The base alternative's ID is `base`. Named alternatives have stable IDs. JSON uses decimal strings for effort and availability; the editor preserves up to eight decimal places. Source hashes and expected versions are passed to the original backend, which remains authoritative for validation and saved identities.

### Native receiving example

The original received case used nine remaining tasks:400 grant hours and144 conditional customer hours. The retained comparison deliberately assigned all customer effort to engineering, kept the grant's original role assignments, and compared the following capacity assumptions:

| Entered allocation | Calculated finish | Late tasks |
| --- | --- | ---: |
| Original18 engineering /8 operations hours spread over seven days |2027-04-17|8|
| Same weekly hours, Monday–Friday |2027-04-15|8|
| Same capacity with grant-priority ordering |2027-04-17|4|
|36 engineering /8 operations hours, Monday–Friday |2027-02-26|1|

These are the saved example's explicit assumptions and outputs. The example's original remaining cash outflow is USD51,680 and eventual change is USD7,520 in all four alternatives; changes in dated funding need follow the original expense and collection rules. The higher-capacity option still has one six-day deadline exception.

The native receiving journey previewed all four alternatives, saved and replayed the same request, selected dates into the original cash forecast, saved that forecast, exported the complete portfolio and operations case, cold-reopened the workspace, imported the whole original case and selected the retained alternative again. It preserved original record, source, price, cost and receipt values. The receiving example and current source references accompany the shared product handoff.
