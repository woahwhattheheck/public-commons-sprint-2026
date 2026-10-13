# Sourced cost ranges for completed Economic editions

Copyright © 2026 TokenJunkie Labs. MIT License. Preserve the existing project, scientific-source and third-party attribution notices.

This extension completes a saved-edition workflow: choose an actual Economic edition, retain its physical results and cost assumptions, author sourced amount bounds, compare all three cases, save the original request, and reopen the full result in a received Workspace. It uses the existing Economic decision engine and original operator queue. It does not submit a new scientific run.

## Interpretation

Lower, reference and upper are explicit joint cost scenarios. They are not probability distributions, confidence intervals, forecasts of realized returns, or independently attainable engineering alternatives. All lower amounts are evaluated together; all upper amounts are evaluated together. The reference case preserves the saved edition's original costs.

The physical packet, source support, spatial scope, metric units, target rules, budget, currency, planning horizon and discount rate remain those of the selected immutable edition. Cost per modeled benefit remains subject to the original denominator and support limitations. Missing physical benefits and uncosted alternatives remain visible; they are not converted to zero.

The original dated lifecycle result is retained separately. This calculation does not rerun lifecycle timing or replace its ledger. A change to dates, unit quantities, unit rates, physical outputs, support, targets or currency belongs in the existing authoring workflow and produces another Economic edition.

### Aggregate amounts and retained components

Aggregate mode accepts capital and annual operating amount bounds. Component mode is available only when the original retained quantity worksheet can be reconstructed exactly, including unit conversion and cent rounding, and the reconstructed totals equal the original saved capital/annual amounts.

Each original component's quantity, rate, classification and complete source row remain retained. Bounds change the component amount, not its quantity or unit rate. The editor displays the reason when component reconstruction is unavailable; aggregate mode remains available.

Use nonnegative ordinary decimal strings for lower and upper amounts. The original reference cannot be changed. Lower must not exceed reference; upper must not be below it. Record the actual bound source title, original URI, ISO calendar source date and applicability note. Do not invent coefficients or substitute an unrelated location, project scale or scope. Equal bounds may retain the original amount without asserting additional uncertainty.

## Install into the existing application

Use the complete current Eco application containing the Economic desk, Economic comparison and typed retained-file extension host. The addon is a normal registered extension, with a complete application component fragment. It does not replace the shared server, extension registry, decision engine or another owner's desk.

From the selected complete public source:

```sh
python install_economic_cost_ranges.py \
  --application /absolute/current-application \
  --source-root /absolute/selected-source/opportunities/upstate_forever_2026 \
  --dry-run

python install_economic_cost_ranges.py \
  --application /absolute/current-application \
  --source-root /absolute/selected-source/opportunities/upstate_forever_2026
```

The installer holds the original extension-install lock, checks complete source, preserves unknown differing maintained files, and registers the new manifest last. An exact replay is accepted. If upgrading an already installed different edition, reconcile its full source and supply an explicit path-to-current-SHA256 JSON map through --expected-current. This permits only those reviewed existing bytes; it is not a force overwrite.

The only shared code join adds economic.cost-ranges.build to the original Economic request-store allowlist. The installer applies that literal join to the receiving current file, retaining other additions. The current model/decision_analysis.py remains in place and its exact executed bytes are included in each saved result. Do not update an application while its original worker is executing; coordinate the existing owner and reuse its normal restart boundary.

## Operate the full workflow

1. Open the original protected Eco operator and select the intended Workspace. Open **Sourced cost ranges**.
2. Select a completed Economic edition. Inspect the original physical quantities, support, footprint, saved capital/annual amounts and component availability.
3. Enter a title and explanation. For each selected scenario choose aggregate totals or the available retained components. Enter actual sourced lower and upper amount bounds. Reference values remain locked.
4. **Download editable definition** preserves the complete definition, including exact edition ID/SHA and every original component row. An authored definition file can be opened only against that exact retained source.
5. **Save complete working file** preserves unfinished text, source, selected scenario, receipts and any original pending request. It is separate from the strict scientific definition. Independent browser copies retain their own identities.
6. **Preview complete cost ranges** runs the original decision calculation on the retained physical packet. Read the named cases, affordability, unresolved outcomes and complete safe report. Editing any input invalidates the preview.
7. **Save complete sourced comparison** retains the exact request before dispatch to the original queue. The preview hash binds original source bytes, authored definition, current calculation source and report outputs.
8. Open the saved comparison and its complete report. Download the result/source files and full package. Original Economic editions remain intact and independently navigable.
9. For another analysis, explicitly reuse the saved definition in a new editable copy. It does not modify the original result or its request.

The actual receiving programme in ECONOMIC_COST_RANGES_RECEIVING.md operates this complete path on an authored definition and an existing protected operator. It owns one browser context; the existing native server remains with its original owner.

## Interruption and complete working recovery

The UI writes the complete original request to the existing IndexedDB recovery store before sending. If browser storage is unavailable, download the exact working file, then explicitly open that same saved file. Only an identical frozen workspace/action/operation/payload and original browser instance enables file-backed dispatch. A different request cannot replace a pending one.

After a lost response, continue the retained original request. The native request route verifies the original queue's workspace, action, payload digest and optional operation alias. JavaScript does not reproduce Python's numeric JSON hashing. A native queue may lawfully attach the exact request to an earlier accepted task; both originating and accepted operation IDs remain retained.

Imported completion or failure observations are not authority. The UI re-reads the original native task before resume or retirement. Absence does not prove the earlier request cannot still complete. A currently verified interrupted task can resume through the original queue. Only a verified failed or cancelled task can be explicitly retired into another editable copy; its complete prior request remains in history.

The source, definition and pending payload remain frozen while a request is active. Workspace or signed-in-operator changes do not redirect a late result. Opening another source preserves the current full working copy; reopening an editable file creates an independent copy. Closing and reopening the browser uses the same operator origin and original Workspace. Retain the downloaded working file if browser storage cannot be relied on.

## Native CLI

The CLI invokes the same EconomicCostRanges service on the actual existing Workspace. Keep its request and observation files outside that Workspace and separate from each other.

```sh
python operator/economic_cost_ranges_cli.py --workspace /absolute/workspace \
  --action catalog --output /absolute/case/catalog.json

python operator/economic_cost_ranges_cli.py --workspace /absolute/workspace \
  --action source --id ORIGINAL_ECONOMIC_EDITION_ID \
  --output /absolute/case/source.json

python operator/economic_cost_ranges_cli.py --workspace /absolute/workspace \
  --action preview --definition /absolute/case/definition.json \
  --output /absolute/case/preview.json

python operator/economic_cost_ranges_cli.py --workspace /absolute/workspace \
  --action build --definition /absolute/case/definition.json \
  --operation ECO-COST-RANGES-B43A-20261013 \
  --request /absolute/case/original-request.json \
  --output /absolute/case/saved.json
```

Author definition.json from the returned source.definition object. Keep source identity and original references exact. Reuse the same request file and operation for continuation. An existing request is verified before reuse and is never silently rewritten. Different output JSON observations need distinct paths; existing exact observations are retained.

## Complete saved files and receiving

The saved directory economic-cost-ranges/<ID> contains immutable intent, record and full output. Its complete ZIP contains:

- index.html: standalone readable report with explicit case interpretation and original source links.
- result.json: every complete decision case, source identity, definition, physical comparison and retained original lifecycle.
- definition.json: editable explicit bounds and source attributions.
- scenarios.csv: all scenario/case/metric rows.
- original-edition.json, original-report.json, physical-input.json: exact original source bytes.
- original-economic-package.zip: the entire existing Economic edition.
- manifest.json: complete member bytes/hashes and selected producer source.
- application/: the complete authored addon, original decision engine, quantity-reference source and original recovery helper selected at calculation time.

The whole Workspace backup/restore uses the existing original portable mechanism and extension verification. No second receiving database or replacement workspace format is introduced. The addon component fragment carries full source into the existing complete application export.

The native/browser course verifies actual browser downloads against saved native descriptors and bytes, opens the HTML and readable sources at desktop and 390-pixel widths, then repeats result/attachment reading in the restored original Workspace. Source review or JavaScript parsing alone is not evidence of those native/visual outcomes. Record the actual owner, original operation, output artifacts and observed result when that receiving phase completes.

## Exact extension interface

Factory attachEconomicCostRanges(host) uses the original extension host's getState, api, endpoint and refresh. View ID is economic-cost-ranges. GET routes under /api/economic-cost-ranges are catalog, source, detail and request; POST preview accepts {definition}. The only mutation action is economic.cost-ranges.build with {definition,expected_preview_sha256}, submitted through the original /api/actions queue.

The source route returns the exact edition/report/physical packet plus the default definition. The request route validates original task files and aliases in Python and returns its actual native request SHA. The retained-file route serves only published record members under the original typed ticket policy.

Source tool paths: source_tools/economic_cost_ranges_original_course.py and source_tools/economic_cost_ranges_browser.mjs. Receiving instructions are in operator/ECONOMIC_COST_RANGES_RECEIVING.md. All retain the same existing Economic operator and original authored source; no external customer communication is performed by this workflow.
