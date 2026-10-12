# Workshare commissioning, delivery allocation and cash

This receiving tool brings complete DealScout Workshare commissioning plans into an existing SF47 Operations case. It uses the retained phase graph and effort estimates from those plans, the existing daily allocation engine, and the original cash forecast. It exports the full calculation and complete editable operating case.

## What the source owns

The original Workshare plan supplies the customer and case identity, proposed fee, exact payment milestones and their conditions, quoted business-day window, start prerequisites, all phases, predecessor relationships, acceptance criteria and original phase effort estimates.

The original SF47 case supplies its immutable plan, operating records, source attachments, existing customer scenarios, package cost estimates, grant payment assumptions, opening-cash field and resource identities. Existing work and commercial rows remain in the same calculation.

Planning choices supply dated availability, the allocation priority, a proposed starting date for each new case, an explicit incremental cost rate and a collection-delay assumption. These choices describe scenarios. The original case continues to own accepted work, invoices, observed cash and customer status.

## Source-native calculation

1. Import the complete original Operations archive through its existing receiving implementation.
2. Attach the complete commissioning input, its matching original case packet and the explicit planning choices. Reconcile the phase-plan hash and each original case before intake.
3. Refresh the existing saved forecast against those source attachments without changing its inputs.
4. Expand the incoming commercial projects into their original phases. Keep the original grant and earlier customer tasks. Preserve every predecessor and each phase's minimum business-day duration.
5. Run the original `portfolio_schedule.plan_programme` once for each distinct capacity/priority alternative.
6. Collect the first work date and final phase finish for each incoming project. Open these dates through the original forecast date-input function.
7. Calculate the full dated cash forecast for the entered cost rates and collection delays. The kickoff milestone follows the allocated start; the accepted-handover milestone follows the final phase and its entered collection delay.
8. Retain timing findings where an earlier customer or grant collection still precedes its revised work dates. Those original collection inputs remain editable in the original forecast operator.
9. Save the selected representative forecasts through the existing versioned Operations command, export the complete case, cold-reopen it, and import it into a fresh receiving workspace.

The scheduler's day intervals, finish-to-start relationships, resource calendars and deterministic priorities remain the original implementation. A shared allocation is calculated once and reused across cash assumptions. The original forecast continues to calculate costs, quoted collections, conditional grants and opening-balance effects.

## Run the complete receiving operation

Use the maintained SF47 Python workspace and its original source scenario. Python's standard library is sufficient.

```bash
python3 workshare_intake.py \
  --engine-dir /absolute/sf47_budget_model/workspace \
  --scenario /absolute/sf10_current_candidate.json \
  --original-case /absolute/original-operations-case.zip \
  --forecast forecast-ORIGINAL_SAVED_ID \
  --commissioning /absolute/commissioning-inputs.json \
  --packet /absolute/complete-case-receiving.json \
  --choices /absolute/planning-choices.json \
  --output /absolute/workshare-receiving \
  --operation original-workshare-intake-operation \
  --actor "Receiving operator" \
  --source-url https://your-existing-source-reference.example/
```

The paths identify existing selected source and data. The output directory owns this receiving copy, its original command history and exports. A retained complete case can be imported into the existing operator through **Delivery and cash operations → Import complete case**.

### Planning choices

The choice object contains:

| Field | Meaning |
| --- | --- |
| `name`, `note` | Name and overall basis of the scenario set |
| `calendar` | Working weekdays, explicit holidays, additional working dates and calculation horizon |
| `resourceRoles.commercial` | Existing resource identity assigned to the incoming phase effort |
| `capacities` | Named alternatives with a complete weekly-hour entry for each original resource and an explanatory basis |
| `priorities` | `balanced`, `grant-first`, or `quoted-first` |
| `hourlyCostsUsd` | Explicit incremental delivery-cost assumptions for the incoming work |
| `costBasis` | Reason for those assumptions; original grant and prior customer cost inputs remain separate |
| `completionCollectionLagDays` | Calendar-day delays following the allocated accepted-handover point |
| `collectionBasis` | Original payment conditions and the meaning of the entered collection delay |
| `cases` | One row per incoming case, with its scenario start date, date basis and a rule for every original payment milestone |
| `saveSelections` | Exact calculated scenario identities to save as native editable forecasts |

Each case milestone retains its original label. Its anchor is `START` or `FINISH`, with an explicit `lagDays`. All original milestone amounts must still sum to the original fee.

## Complete outputs

**Workshare_Capacity_And_Cash_Review_20261012.zip** contains the complete input sources, original forecast and seed, each original allocation input and result, every dated cash preview, every editable forecast input, the comparison data, a readable HTML review and an exact member manifest.

**SCF_Operating_Case_With_SEC_Workshares_20261012.zip** is the native receiving carrier. It preserves the original planning history, operational records and sources, the full workshare review attachment and the saved selected forecasts.

**Workshare_Delivery_And_Cash_Review_20261012.html** is an industrial monochrome review with an allocation filter and a full capacity/cost/collection comparison table. It can be read directly and reopened offline.

**native-receiving-result.json** identifies the original sources, saved forecast editions, completed receiving and cold-reopen operations, and complete output files.

## Reopen the completed receiving operation

Run the same command again with the same operation, original forecast, actor, source URL, exact inputs and maintained Python source. The completed operation checks the recorded source identity, all four output hashes, and each saved forecast in both existing workspaces, then returns its original receipt. A changed or missing retained output is reported by its filename. Select a new operation and output directory for an intentional new source edition or planning scenario.

## Callable integration

`load_workshares(commissioning, receiving_packet)` reconciles complete native plans and their case packet.

`commercial_inputs(base, workshares, choices, rate, source_ids)` produces an original forecast input containing the whole existing portfolio plus the incoming quoted work.

`schedule_input(...)` translates the retained phase graph and entered resource choices into the existing scheduler contract.

`selected_inputs(...)` returns dates and original payment conditions to the existing forecast input.

`evaluate(...)` produces the complete source-native comparison archive. `save_forecast(...)` uses the existing Operations authority. The module adds no second database or scheduler.

The command can be called by an existing agent/MCP operator with the same source paths and complete input objects. Source intake and selected forecast saves belong to the same original Operations case.
