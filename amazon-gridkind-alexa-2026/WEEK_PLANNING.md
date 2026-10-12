# Plan a household week

Open **Plan a week** from GridKind's daily workspace, or visit /week on the same local server. The weekly planner opens the currently selected household and its saved inputs.

## Set a useful routine

1. Name the week and choose its first calendar date. The planner always covers that date and the following six dates; the start need not be Monday.
2. Select a day. Its editor exposes the original 24 hourly prices, shared circuit cap, and one to five flexible loads. Every load retains its own duration, earliest start, finish-by time, and quiet-hour setting.
3. Build the normal workday pattern, then choose **Weekdays**. Copying follows the actual weekdays in the seven dated slots, so a Wednesday start still selects Monday through Friday correctly. The copy includes prices, loads, circuit cap, and the rest-day setting.
4. Select a weekend day and change its routine. **Weekend** copies the selected pattern to Saturday and Sunday. **All seven days** applies one pattern throughout.
5. Clear **Schedule flexible loads this day** for a rest day. Its inputs remain available when reenabled.
6. Choose **Plan and save this week**. Every enabled day goes through the maintained daily optimizer with that day's exact input. The complete result becomes one record in the household's existing history.

A draft stays in the current browser tab's session storage. Saving retains it in the server's household history. Opening a saved result displays that result while the draft stays available above it; **Use this saved week as the draft** explicitly replaces the draft. The result's export controls always use the saved version.

If another tab changes the selected household, the weekly editor retains its original draft and shows that the active household changed. **Start from saved household inputs** explicitly opens the now-active household. A stale request cannot silently save the prior draft into a newly selected household.

## Resolve a day that needs attention

A correctly shaped input can still have no feasible schedule. The weekly result keeps the optimizer's reason beside that date, while other dates retain their completed schedules.

For example, a quiet-hour-sensitive two-hour load with its entire window between 22:00 and 24:00 has no eligible start. Two fixed one-hour loads that each need 2 kW at 18:00 cannot share a 3 kW circuit. Widen the affected window, move a load, or change the relevant entered constraint.

Choose **Edit this saved day** to reopen the saved week at that day, make the change, and save a new weekly revision. The earlier result stays in history. Totals explicitly count planned days and exclude infeasible days; rest days contribute no flexible-load energy or cost.

## Read the result

Each planned day shows the earliest jointly feasible cost, the optimized cost, the selected circuit cap, and every load's start, finish, energy, and cost.

Weekly totals add the retained daily values at four decimal places. They cover the entered flexible loads only. They do not estimate fixed household consumption, standing charges, taxes, export compensation, or real utility bills. Calendar dates organize independent daily models; they do not obtain tariff data.

The model preserves the existing constraints:

| Input | Meaning |
| --- | --- |
| 24 hourly prices | Hypothetical USD per kWh, from 0 to 10 for each hour |
| One to five loads per enabled day | Named continuous tasks with safe stable identities |
| Duration | One to six whole hours |
| Window | Whole-hour starts and finishes within the same 00:00–24:00 day |
| Quiet setting | Eligible hours stay outside 22:00–07:00 |
| Circuit cap | Maximum simultaneous entered flexible-load power |
| Rest day | Retained inputs with no scheduled flexible loads |

A load ending at 24:00 finishes at the following date's midnight. The solver does not move an unfinished load from one day's problem into another day's problem.

## Continue in the original daily flow

Below a planned day's saved schedule, choose **Continue … in daily workspace**. The server reads that retained day's inputs, stores a linked input-restoration record, and opens a fresh original daily agent for those inputs. The browser returns to the daily workspace.

Choose **Plan this scenario**, inspect the daily result, then approve its exact proposal and execute the simulation. The day adoption starts this original flow again. The weekly source retains the prior daily plan, approval, and simulated receipt in household history.

Merely saving or inspecting a week leaves the currently active daily proposal available. This lets a household explore next week's routine while retaining the current day's decision.

## Share the schedule and household

**Download schedule CSV** writes one row per planned flexible load, plus an explicit row for each rest or infeasible day. Columns contain the date, status, load name, local start and finish, kW, kWh, load cost, daily baseline, daily optimized cost, and planning note. Daily cost columns repeat on the load rows so each row remains intelligible; sum those daily values once per date when aggregating in a spreadsheet. Four-decimal monetary values stay in the file.

**Download calendar** writes an RFC 5545 .ics file containing tentative, transparent events for successfully planned loads. It includes no alarms or scheduling invitations. Events use floating local clock times: importing into a calendar keeps the entered clock hours rather than converting them from an assumed timezone. Import into the calendar/timezone in which you intend to follow the plan. The saved record, day, and load form stable event identifiers; applications may still duplicate events if the same file is imported repeatedly. See the [RFC 5545 DATE-TIME definition](https://www.rfc-editor.org/rfc/rfc5545#section-3.3.5).

Household **Backup and recovery** in the daily workspace carries the whole week, its exact daily inputs and results, and every linked daily decision in the existing household file. The current application previews the number of saved weeks alongside daily plans and tariff comparisons. Restore in another browser retains the original record identities and calendar event identifiers. Run the current complete application on the receiving computer so it understands weekly records.

## Implementation

The weekly.mjs module calls plan from the unchanged engine.mjs once for each enabled day. It assembles the dated report and its export formats. The week-ui.js module reuses the original createExactInputs editor. The workspace.mjs module retains a week record in the existing database and accepts it through the existing household backup route.

| Route | Operation |
| --- | --- |
| GET /week | Weekly planner page |
| POST /api/week, action plan | Plan seven input days and retain the whole result |
| POST /api/week, action adopt-day | Restore one saved planned day's inputs into the original daily agent |
| GET /api/week/export?recordId=…&format=csv | Download the saved schedule as CSV |
| GET /api/week/export?recordId=…&format=ics | Download its local-time calendar |

The export routes accept an optional owned householdId, matching the existing history routes. Mutations use the existing household, generation, and workspace revision context. Day adoption changes the live agent only after its database transaction commits. Saved and imported week records retain the original daily results; their admission checks read that data without rerunning or replacing it.

A weekly report uses gridkind-week/v1 and contains input (name, first date, seven enabled/scenario pairs), seven dated days, aggregate totals, and the model description. Each planned day retains the full original gridkind-sim-v1 result. The record is included in the existing gridkind-household/v1 backup.
