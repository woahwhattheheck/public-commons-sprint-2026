# Portfolio delivery allocation

This workspace plans the same remaining grant and quoted customer work that is already in a saved SF47 operating forecast. It allocates that work to entered resources and working dates, compares the resulting delivery dates and cash needs, and opens a selected alternative in the original Operating forecast editor.

The cash calculator remains the original `forecast.py` implementation. Resource hours determine dates. The original prices, obligations, recorded payments, receipt schedules and expense rules determine cash.

## Open the original work

Start the maintained SF47 workspace with its normal saved data directory and authenticated local URL. Open **Delivery and cash operations**, choose the original case, then **Portfolio**. The original recording-operator field identifies each saved operation.

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

## Start from reviewed remaining effort

A saved Installation effort review can prepare a complete Forecast draft using its explicitly reviewed phase remainders. Select the exact current Installation editions and matching original commercial tasks through `installationEffortSelection`, then review and save the returned Forecast input through the existing Forecast workflow. Continue that saved Forecast and the retained phase/source selections in Portfolio. Original cash observations, cost inputs and collection dates stay attached to the full Forecast. [Installation effort and support](INSTALLATION_EFFORT.md) provides the complete operating flow.

## Allocate saved installation phases

In **Portfolio**, select the original saved forecast, then **Use installation phases**. The source chooser reads current Installation editions prepared from an original Workshare. It shows the edition, customer and quote, original phase owners, dependencies, and delivery and support terms. Choose an edition for the matching commercial task. The task ID, Installation ID, edition number and edition digest stay together in the allocation.

A candidate with an unavailable source retains its identity and the service's specific source result. Reopen the original installation and its retained attachments to recover that source, then choose the complete edition. The candidate list also identifies matching task IDs so similarly named customer projects remain distinguishable.

Selecting phases preserves the complete existing draft when that draft is supplied. The seed attaches or refreshes base `installationPlans` and preserves every explicitly authored alternative override, including `[]`. The original grant and commercial task list remains present. A selected commercial task receives a base phase-plan entry containing every original phase; the parent task continues to supply its release, due date, priority and dependencies.

### Enter the remaining phase work

Enter each phase's remaining hours and assign those hours to the available resources. Use exact decimal strings in JSON. A blank value is unentered; an explicit zero means no remaining work for that phase or resource.

When the commercial task's remaining hours equal the complete original quoted hours, the seed copies the original per-phase effort and any stated integer business-day durations. If that total has changed, phase remaining hours start blank and the minimum durations start at zero for an explicit new allocation. An omitted original duration remains omitted in the source terms. Review the seeded values against the work that remains.

The original quoted phase hours, check observations and owners remain visible as source information. An accepted check does not supply a remaining-hour value. The phase remainders must total the commercial task's original remaining hours, and each phase's resource assignments must total that phase's remainder. Installation coordination dates are shown with the source; they do not automatically set phase due dates.

Keep every original phase ID and dependency. Enter any reviewed phase dates, priorities and minimum working durations with their reason. A phase priority of `null` inherits the parent task's priority; an entered integer is explicit, including `100`. New phase plans seed priority to `null`. The bound parent task's minimum working duration must be zero; its original aggregate resource-effort map remains retained but phase assignments drive the allocation.

The allocator applies phase work to the same resources and dates as all other grant and customer tasks. Support phases use that capacity too. The calendar, dated availability, predecessor constraints and original source-hour total remain part of the complete comparison.

### Review the delivery boundary

Select the phases that define commercial delivery and enter the reason in the delivery-boundary note. The selected phases and their ancestors establish the commercial work window used by the original Forecast. Every phase stays in the allocation, including support after delivery.

For a plan whose source distinguishes handover from later support, review that distinction directly. A delivery boundary at handover can leave support continuing afterward; support still competes for the same available resources. Do not extend the commercial completion date merely by treating later support as an implicit delivery requirement.

A ready phase allocation requires an explicit delivery boundary and note. Preview shows the resulting phase and delivery dates alongside the complete source terms. Original event prerequisites and promised business-day deadlines still govern commercial delivery. An entered planning release does not change an original deposit, acceptance or other prerequisite into a recorded event.

A new saved Installation edition is an explicit source selection. Reopen the current edition before previewing or saving a successor allocation. Selecting a newer observation or coordination edition preserves the entered base phase draft when the original plan digest and effort are unchanged. A revised original plan or effort starts a complete base phase preparation for that source; review the remaining work and boundary again. An alternative with its own phase-plan override keeps that complete override and requires an explicit source refresh of its own.

### Compare a different staffing or phase plan

An alternative can override the complete `installationPlans` array, just as it can override the complete resource or task array. Each phase-bound plan included in that replacement retains all its original phases. An explicit empty array, `[]`, uses the original aggregate tasks for that alternative; enter their complete aggregate resource effort. A resource-list change may require a matching complete phase-plan override so every resource ID and phase-hour total stays valid.

An omitted phase-plan override follows the base plan. An authored override remains its own complete input when the base later changes, including when a source edition is reselected. To prepare or refresh one named alternative, apply its complete inherited calendar, resources, tasks and phase plans to a temporary base with `alternatives: []`, run the seed with that alternative's reviewed edition selections, then retain the returned `installationPlans` as its explicit override. Keep all its other settings and the other alternatives. The [SDK example](AGENT.md#prepare-one-explicit-phase-alternative) shows that complete operation.

Preview the whole alternative to see both the commercial delivery window and the capacity consumed by support.

## Compare complete alternatives

Select **Add alternative**, enter its name and reasoning, then enable the fields that differ from the base plan. An overridden calendar replaces the whole calendar. An overridden resource list replaces the whole list. An overridden task list replaces the whole task list. An overridden installation-plan list replaces that whole list; each included phase plan retains every original phase, while an explicit empty list uses the aggregate tasks. Fields without overrides follow the base plan.

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

Cash needed before an opening balance, and the gap after an entered balance, remain distinct. An unentered opening balance stays unentered. USD reporting amounts come from the original forecast. A quote may also retain an explicit native price and delivery-cost currency. Missing valuation remains unresolved; the native amounts and observed USD cash stay visible.

## Save, reopen and select

Preview the current inputs, enter the recording operator, and select **Save reviewed allocation**. The original command saves the normalized input, its reviewed preview identity, the source forecast snapshot, the complete dated results and the original save event.

If a response is interrupted, the exact request remains in the browser. **Retry the same save request** uses the same request ID, expected version and input and receives the original saved result when it already exists. A reported original validation or stale-source rejection retains the draft and rejected request; **Keep draft and prepare a new request** is the explicit path to re-preview against current case state. Transport or rate uncertainty keeps the original request pending.

Use **Saved allocations** to reopen an immutable result. **Edit a new allocation from this saved input** starts another editable draft. The saved result remains its original source-bound calculation.

For a saved ready alternative, select **Open dated cash forecast draft**. The original portfolio selection endpoint returns a new original forecast input with the chosen package and customer work dates. The existing Operating forecast editor opens those inputs without saving them. Review the collection dates and other cash assumptions, preview, then save through its original normal flow.

Draft inputs and unresolved save requests are retained per original case in the current browser session. Download the complete input JSON before moving to another browser or device. An earlier unreadable browser record remains downloadable for reconciliation with the original saved case history.

## Complete receiving and exports

**Download complete saved portfolio** produces the source-bound result archive, including the complete portfolio JSON, original forecast snapshot, input, report, dated cash and allocation CSVs. The original operations **Export complete case** includes saved portfolios and their original forecasts, plan, source attachments and event history.

Import the complete original operations archive through its existing receiving interface to reopen the whole case. The standalone portfolio archive is the calculation and source handoff; the full operations archive is the native workspace receiving carrier. Saved portfolio validation checks its exact original forecast and its save event. Phase-bound allocations also retain the selected Installation editions and exact original phase source with the saved calculation. The complete case carries those saved editions and attachments through the existing receiver.

The current source adds no separate database. `operations.py` owns the original `ops_portfolios` table and case save/import transaction.

### Receive the complete phase source and results

A saved phase Portfolio adds these members to its original calculation ZIP:

| Member | Retained content |
| --- | --- |
| `installations/source.json` | Selected Installation source identity, full retained phase-source snapshot and original candidate metadata. |
| `alternatives/{alternativeId}/installation-plans.json` | Every selected plan's source edition, delivery boundary, phase allocation and calculated dates. |
| `alternatives/{alternativeId}/installation-phases.csv` | Every phase's original and scheduled task IDs, quoted and remaining effort, source owner, check observation, delivery scope, dates and resource assignments. |

The complete `portfolio.json` retains editable `inputs.installationPlans`. Result `report.alternatives[].installationPlans` rows are calculated projections; reopen the saved `inputs` when editing a successor.

| Result field | Meaning |
| --- | --- |
| `deliveryPhaseClosure` | Selected delivery-boundary phases and all their predecessors. |
| `deliveryStartDate` / `deliveryFinishDate` | The commercial window returned to the original Forecast when the alternative is ready. |
| `allWorkFinishDate` | Completion of every phase, including support after the commercial boundary. |
| `phases[].scheduleTaskId` | The phase's exact task ID in the complete original daily schedule. |
| `phases[].deliveryScope` | Whether that phase belongs to the reviewed delivery closure. |
| `phases[].minimumBusinessDays` | The retained result's minimum duration; the editable input field is `minBusinessDays`. |

The full operations-case archive carries the matching historical Installation editions and their exact original attachments through native receiving. A historical saved calculation reopens with its original source and reviewed results. Selecting newer sources creates an editable successor in the same original case workflow.

## Runtime and source joins

The maintained workspace serves:

| Entry | Purpose |
| --- | --- |
| `portfolio.py` | Source normalization, seed, alternatives, original cash join, saved validation and export |
| `portfolio_installations.py` | Exact saved Installation selection, complete phase input, delivery boundary and shared-resource projection |
| `portfolio_schedule.py` | Pure deterministic resource/day allocation |
| `portfolio.mjs`, `portfolio.css` | Complete editor, retained save, result comparison and original forecast selection |
| `portfolio_installation_plans.mjs` | Original Installation choices, complete phase editor, delivery-boundary review and phase results |
| `operations.py` | Original authenticated case transaction, saved records and complete import/export |
| `operations_http.py` | Original HTTP routes and static asset entries |
| `operations_cli.py` | Original CLI seed, preview, save, show, export and selection |
| `forecast.mjs`, `forecast_currency.mjs` | Original cash/native-currency editor and exact native-amount formatter, with an explicit initial-input handoff |
| `forecast_currency.py` | Original explicit rate and native cash-credit valuation used by the forecast |
| `operations.mjs` | Original operator tab and selection integration |

The browser uses these original authenticated case endpoints:

```text
POST /api/operations/{case}/portfolio-seed
     {expectedVersion, forecastId, installationSelections?, inputs?}
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

The optional seed `installationSelections` array contains `{taskId, installationId, installationRevision, installationSha256}` for each explicitly selected edition. Optional `inputs` is the complete current Portfolio draft. The seed returns the complete editable input together with the selected source metadata and available edition choices. The adjacent [typed client declaration](agent-client.d.mts) describes these inputs and native results.

A phase plan retains `taskId`, the three Installation edition fields, `deliveryPhaseIds`, `deliveryBoundaryNote`, `phases` and `note`. Each phase retains `phaseId`, explicit `remainingHours`, `effortHours`, original `dependsOn`, `releaseDate`, `dueDate`, `minBusinessDays`, `priority` and `note`. Dates are civil `YYYY-MM-DD` values or null; effort values are decimal strings or null. Phase priority is `null` to inherit the parent or an explicit integer. The seed updates base phase plans while retaining complete explicit alternative overrides. The original native service validates the complete source and allocation.

The seed and preview are calculations. `portfolio.save` remains the sole Portfolio writer. Its receipt returns the case `id`, new case `version`, `action`, `kind` and saved `recordId`. Reopen that record for its native `sha256` and `previewSha256`. The outer SDK response `sha256` identifies the exact HTTP bytes.

Use the [complete CLI workflow](CLI.md#portfolio-with-installation-phases) or [SDK and agent workflow](AGENT.md#portfolio-allocation-and-original-cash-handoff) to seed, preserve the reviewed request, save, select dates into the original Forecast and export the whole case. Both managed source selectors include `portfolio_installations.py`, so install the complete release before reopening a phase-bound saved allocation on another host.

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

## Original event-dependent commercial work

An original Forecast can retain a quoted project whose work begins after a deposit or another recorded prerequisite. Its `timing` object carries the start condition, quoted delivery window in business days and original milestone collection conditions. The quote's complete cost and hours remain in its source totals while the work and receipts can be undated.

Portfolio takes that whole selected source task. Its seed preserves the original condition, exact remaining effort and receipt terms, leaving the release and due dates empty. Save the entered allocation and assignments while the release is unresolved; its result identifies the exact task and condition that need a date.

Once the original triggering events are ready, select the reviewed release date. Portfolio retains that original trigger as `timing.reviewedReleaseDate` in the selected forecast. A later seed uses this retained trigger, even when the previous allocation's first-work day is later. Clearing the task release reuses a retained trigger; if no reviewed trigger exists, the release remains a required decision. A later task release may defer work but cannot reset the original deadline; an earlier release is returned as `ORIGINAL_EVENT_RELEASE`. The relative delivery deadline uses the existing programme calendar, including its closed and extra working dates. The first working date on or after release is day one. A source release earlier than the future forecast window retains its original deadline, so delayed work remains visibly late.

The derived deadline appears in the native schedule and `eventDeadlines` result, with the source condition, release date, quoted business-day count and exact contract due date. An earlier manually entered due date is retained. A later one is returned as `ORIGINAL_EVENT_DEADLINE`; a calendar too short to locate the original deadline is returned as `EVENT_DEADLINE_OUTSIDE_HORIZON`. Availability and predecessor constraints can still produce a late finish, which the existing native allocator reports.

The quoted delivery window sets the promised deadline. The separate **Minimum working duration** field continues to describe the remaining task's minimum effort duration. Review both against the actual remaining scope.

Select a ready alternative through the original Forecast handoff to enter its chosen work window. Original milestone receipt dates remain their entered values, and the relative collection conditions stay attached to their original IDs. Undated customer collections remain outside the cash curve until those dates are known.

The operating analysis displays the retained event conditions and the source forecast's undated cost, hours and collection amounts. A complete Portfolio ZIP adds `event-dependent-work.json` for these source tasks. The full operations case remains the portable source for reopening all original quotes, attachments, forecasts and allocations. Previously saved dated forecasts and portfolios retain their complete original calculations and identities.


## Native-currency quotes and explicit valuation

A selected customer project can preserve its quoted price, delivery cost and milestone amounts in their original currencies. Portfolio receives those terms from one immutable saved Forecast. The rate source and cash-credit decisions remain part of that Forecast; availability, dependencies and work dates remain Portfolio inputs.

Start by reviewing the original **Operating forecast**:

1. Retain the native price and delivery cost, including each currency. Price and cost may use different currencies.
2. Select an explicit exchange-rate row for each amount that needs conversion to USD. The rate states its direction, observation date, publication date when available, source URL/reference, supporting source IDs, basis, rounding rule and operator note.
3. Link any already recorded customer cash or delivery costs to their native-credit allocations. A USD bank/cash amount does not establish how much of a foreign-currency invoice or quote it settles.
4. Preview the original forecast. Its coverage reports the selected scope and the dated cash separately. A missing rate or required native credit remains an editable unresolved input.
5. Save the reviewed forecast, select it in Portfolio and create the allocation. Every original selected work task remains present even if its financial valuation is unresolved.

The **Original currency terms** panel in a task shows its original quote and cost, selected rate identities and remaining cost valuation. The result's **Native currency and selected valuation** section includes the original amounts, quoted and effective delivery costs, milestone amounts, explicit native cash credits, unresolved record IDs and complete selected rate sources.

Native amounts are displayed from their exact decimal strings. They are not relabelled as USD and do not pass through JavaScript floating-point conversion for display. USD reporting values are calculated by the original Forecast valuation engine.

### Direction, source and settlement

A rate is always **1 base currency = rate × quote currency**, with exactly one side USD. For example, a ZAR-per-USD quotation converts ZAR to USD by division. A selected USD-per-ZAR quotation converts by multiplication. Portfolio preserves the selected direction rather than guessing it from an exchange-rate number.

A reference observation and an entered planning assumption remain separately labelled. Observation date, publication date, age in days and source identity are displayed with the selected rate. A later public rate does not silently replace a saved source. Changing that evidence requires a reviewed successor Forecast and, if its allocation is needed, a new Portfolio based on that successor.

Actual cash records remain at their observed USD amounts. Native price credits identify the original customer-cash ID and the native amount allocated. Native cost credits identify an original invoice or direct-cash record and its allocated native amount. Missing native allocations remain visible even when the reference exchange rate is available.

A native milestone's USD valuation, applied native credit, remaining native balance and settlement-rounding fields are distinct. The original Forecast owns cumulative milestone rounding and credit reconciliation. Portfolio does not independently round a quote into a second set of milestone totals or infer a settlement rate from a public reference.

### Operational readiness and financial comparison

The original **READY**, **INCOMPLETE** and **HORIZON_EXCEEDED** states continue to describe the work allocation. An alternative can be operationally ready while its currency valuation is incomplete.

The financial comparison additionally requires:

- Complete valuation of the selected commercial scope.
- Complete valuation of dated cash.
- A complete original baseline when reporting a funding-need delta against that baseline.

A ready alternative with unresolved financial valuation remains selectable through **Open dated cash forecast draft**. The date handoff preserves the original native pricing, rate array, credit allocations, milestone IDs, receipt dates and event-dependent terms. The operator can then complete the missing financial input in the original Forecast editor, preview and save normally.

An unresolved alternative has financialComparisonEligible=false, frontier=null and fundingNeedDeltaUsd=null. It neither dominates another alternative nor appears on the financial frontier. Fully valued alternatives may be compared with each other; if the original baseline is unvalued, their baseline funding deltas remain null. The complete result explains each exclusion.

The **Known portion of dated cash** is explicitly separate. It contains only priced/allocated cash events and does not establish the full funding requirement. The paged dated-cash table shows complete and known-only USD changes and balances side by side. An unresolved complete metric is labelled **Unvalued** rather than displayed as zero.

An undated price or cost remains part of the selected source scope. Entering work dates can change dated-cash coverage without changing the original amount. Portfolio continues to check that date allocation leaves the original Forecast's scope totals unchanged. Event release dates and the original promised delivery clock retain the existing rules described above.

### Retained result fields

Currency fields are conditional. When the original Forecast contains neither nativePricing nor fxRates, the legacy Portfolio input, report calculation and saved identity keep their previous shape and values. No empty currency object or extra comparison flag is inserted into a legacy saved report.

For a currency-enabled source:

| Result location | Retained meaning |
| --- | --- |
| sourceTasks[].nativePricing | Complete original native price, cost and explicit credit inputs for a selected native quote |
| sourceTasks[].nativeReceipts | Original milestone identity, native amount and its source Forecast valuation |
| baseline.currencyValuation | Complete original scope/dates/rate coverage |
| alternatives[].summary.currencyValuation | Complete coverage after that alternative's selected work dates |
| summary.scopeValuationComplete | Whether selected scope amounts are valued |
| summary.datedCashValuationComplete | Whether the dated cash projection is valued |
| summary.valuedPortion | Original known-only commercial cash metrics |
| comparison[].financialComparisonEligible | Whether that operationally ready alternative may participate in financial comparison |
| comparison[].financialComparisonReason | Explanation of readiness, missing valuation or unavailable baseline delta |
| report.financialComparison | Eligible/excluded alternative IDs, baseline eligibility and the comparison basis |

The complete original pricing/rate records stay in the Forecast snapshot and each calculated alternative. Compact comparison rows retain scalar coverage and known-only figures without repeating the entire source evidence again.

### Complete currency export and receiving

The existing saved Portfolio ZIP adds these members for a currency-enabled source:

| Member | Contents |
| --- | --- |
| currency/original-native-source.json | Original saved Forecast identity, complete rate array and commercial input rows |
| currency/valuation.json | Original coverage, comparison eligibility and every calculated alternative's coverage |
| currency/native-commercial.csv | Native price/cost, currency, selected rates, credits, remaining valuation and unresolved IDs |
| currency/native-receipts.csv | Complete original milestones, native credits/balances, USD valuation and original rounding fields |
| currency/selected-rates.csv | Rate direction/value, dates, basis, source reference/IDs/hash, age and note |

The complete portfolio.json remains the source-bound record. Each alternative's selected-forecast-inputs.json includes the original native pricing and rate inputs. Currency-enabled dated-cash CSVs add knownCommercialDeltaUsd and knownCommercialBalanceUsd; unresolved complete fields remain empty CSV cells, not numeric zero. Comparison CSVs retain explicit eligibility and its reason.

The full original operations-case export still supplies the native reopening carrier, including source attachments, saved Forecasts, Portfolios and their original events. Receive that whole case through the existing import interface. Validation recalculates the saved Portfolio against its retained source and valuation rather than current external rates.

To review the complete new mode, use the original native-currency case with a missing rate, create and save an operationally ready allocation, and inspect its explicit financial exclusion. Then save a reviewed Forecast successor with the selected source rate and any required native credits, create its allocation, compare the eligible alternatives and select a date plan. Export the complete Portfolio and case, reopen the original database and receive the whole case into a fresh workspace. Preserve each stage's original request IDs and source identities. This is the receiving procedure; execution evidence belongs to the accompanying actual native run.


## Complete named working copies

The original Portfolio desk now retains named, durable working copies and immutable checkpoints, with the exact input/result selection, unfinished resource and phase controls, complete source attachments and original interrupted save request. See [Portfolio working copies](PORTFOLIO_WORKING_COPIES.md) for the complete operator workflow, recovery and existing native receiving course. The original allocation calculation, saved record identities and exports remain authoritative.
