# Economic scenarios into implementation planning

Economic desk now carries one explicitly chosen whole scenario from a completed economic edition into the existing Implementation & fieldwork extension. The original scenario remains the source for proposed work, while the fieldwork plan owns assignments, dates, budgets, commitments, spending and field records.

## Operator workflow

1. Open **Economic desk** in the original workspace. Build a complete economic edition or choose a completed edition under **Saved inputs and completed editions**.
2. Choose **Plan implementation**. The saved edition opens with a selector for its actual complete alternatives.
3. Select one scenario. Review its native reporting zone, modeled annual avoided exports, common cell counts, original upfront and annual operating estimates, and source footprint. Negative avoided exports remain visible. The edition's budget and target assessment appears with its original reasons.
4. Choose **Continue to implementation planning**. The operator opens the existing Implementation & fieldwork desk with this original source choice.
5. Review the source in the destination desk and choose the destination plan using its existing workflow. An open edited plan remains available. Import the reviewed original scenario through the native queue, then assign work, methods, people, dates and field budgets within the plan.
6. Save the plan's native revision and use the existing field forms, cost ledgers and reporting flow. Native and offline implementation reports show the selected scenario's signed reductions, units, spatial comparison support and original estimate in readable tables, alongside the plan's actual work and financial ledgers. The original economic edition remains available in Economic desk.

A scenario without an implementation estimate remains a valid source choice. Its absent estimate stays absent. An alternative outside the edition's prepared budget or target criteria remains visible with the original reasons, so the operator can make an explicit planning choice.

## Scientific and financial meaning

Each source choice names one whole modeled scenario. Two alternatives are not combined into a predicted third outcome. The original reporting zone and model support remain attached to the source. Nitrogen and phosphorus retain kg/year; sediment retains tonnes/year.

The review displays the saved edition's quantities. The handoff does not recompute modeled outputs, annualization, eligibility or costs. Original cost inputs include their source reference, date and footprint. The modeled outcome footprint and the estimate's implementation footprint remain distinct.

Upfront and annual operating estimates remain source planning inputs. Annualized cost remains a comparison quantity expressed per year. Field budgets, commitments, actual spending, task durations and assignees are entered in the destination plan using its existing controls.

## Source contract

The browser opens the registered `implementation` extension by its `openEconomicScenario` controller method, passing:

```json
{
  "workspace_key": "<original workspace>",
  "edition_id": "<completed economic edition>",
  "run_id": "<one selected original alternative>",
  "report_id": "<native producer report>",
  "report_sha256": "<exact native source bytes>",
  "zone_id": "<original reporting zone>"
}
```

The controller retains the chosen source, navigates to Implementation & fieldwork, and consumes the handoff after its original initialization completes. The native provider resolves the completed edition from the original workspace and retains the original source through the existing immutable selection import and revisioned plan store. The client passes identifiers; the completed saved edition supplies the source document.

The browser verifies the saved edition's workspace, producer report, source hash, reporting zone, economic report identity and original cost inputs before opening the handoff. It requires an explicit single alternative. Async edition reads retain their request identity so a late response cannot replace a newer selected edition. Closing the edition or leaving its workspace invalidates a pending read.

## Receiving and integration

Use the current shared application and compose this Economic desk source with the current FIELD12 implementation source adapter, provider, browser controller hook and extension registration from this same handoff. The economic component adds `operator/web/economic_implementation.mjs` to its existing manifest and installer; its current worksheet module remains installed.

Install using the existing `install_economic_desk.py --application <actual application> --source-root <received source>` workflow. The shared extension host owns navigation and native actions. Reopen Economic desk and Implementation & fieldwork in that actual receiving application.

## Review status

The complete browser modules parse. Focused execution checked exact single-scenario binding, original costs and footprint, negative modeled changes, source/zone/workspace mismatch, duplicate alternatives, and explicit selection of an uncosted or ineligible alternative. The review uses an engineering contract fixture; native receiving uses the retained original workspace and its completed economic edition.

The completed source integration and actual receiving result are recorded in the existing Ecosystem Sciences project thread.
