# Implementation and field monitoring

This desk turns the existing saved conservation portfolio or community intervention plan into assigned work, a cost ledger and actual field records. It belongs to the same Upper Savannah Workspace and operator. Original sources, native run bindings, candidate footprints and portfolio summaries stay attached to the selected source.

## Install and open

The cumulative package contains the original native modules, the implementation extension descriptor, the browser core/forms/controller, CSS, method catalog, offline builder and guides. The receiving application uses the shared extension host from original source f293e68f7f490346280419ae447748ef95ec76a3.

From the received project source, build the portable edition, then install this desk with the supplied installer:

    python -B build_implementation_offline.py --application /absolute/received/upstate_forever_2026
    python -B install_implementation.py --application /absolute/current/upstate_forever_2026 --source-root /absolute/received/upstate_forever_2026

The installer preserves the current application, existing source owners, worker queue, authentication and download tickets. It composes the authored extension into the shared registry. Open Implementation & fieldwork in the operator. The separate operator/web/implementation_workbench.html is a self-contained field companion; download and open it directly in a browser.

## Complete operating journey

1. Create a plan, enter its start date and choose working weekdays and holidays. A target date is optional.
2. Save the native plan. In Source selections, import an original saved conservation portfolio or community intervention plan. The native importer reads the retained original selection and its complete source context. Specific selected IDs are optional; source identifiers remain unchanged.
3. Add a method workflow for a selected candidate. Available methods are priority-land protection and stewardship, riparian buffer establishment, livestock access management, stormwater work and targeted source-water investigation. The full 34 task templates carry dependencies and named responsibilities. Enter local durations and assignments; zero days creates a milestone.
4. Record budget, commitment and actual-cost entries independently. Each row can reference an implementation task and its actual quote, invoice or funding record. Amounts are stored in integer USD cents.
5. Add monitoring sites and the questions, methods, parameters and timing that each monitoring plan will address. WGS84 coordinates can be retained with the original site reference.
6. Schedule a visit. Use its printable field sheet, or open the portable workbench and import the complete plan JSON before going offline.
7. During field return, record the original visit, actual observation time and sample/activity identifiers. Use one of eight structured field forms, or enter individual activities/results. Each structured form preserves its exact template and answer set on the activity; quantity results retain measured values and units. Samples, inspections, measurements and photographs retain their original IDs.
8. Enter laboratory results as numeric, censored, text or missing. Preserve the original result text, unit, chemical basis, fraction, qualifier, detection/quantitation limits and method. A censored result has a null numeric value and its original reported condition.
9. Export the full JSON, print-ready HTML and any of nine complete CSV tables. Return the field JSON to the native plan. Its originating revision is retained for reconciliation. Identical retries use the same operation identity; a stale conflicting document is preserved as a separate conflict record.
10. Create the native report package after saving its selected revision. It uses the same authenticated task queue, selected report date, original source bank and download tickets.

## Browser behavior

The desk owns its form listeners and follows the extension host's mount/update/detach lifecycle. Background state refreshes do not remount an active form. Workspace changes detach the old controller, preserving its browser draft under that workspace key. Native operations retain an operation ID and original request before submission; an uncertain response can retry the same operation. The desk waits for the original queue task's result and reopens its saved revision.

Browser edits made after a queued snapshot stay separate from that completed native revision. Export preserves those edits. Reopen native saves a separate copy of a dirty browser draft before showing the current native source. JSON imports likewise preserve a displaced dirty local copy.

The portable edition contains all JavaScript, styles and method definitions in one HTML file. It opens without a server or network calls. Its local browser draft and complete JSON export serve distinct purposes: export carries the work to another browser or the original native Workspace.

## Interpretation

A whole candidate's area, the reporting-area intersection, and the selected portfolio union have different extents. Native conservation imports preserve each source's fields and their original scope. A community plan's reporting-area physical totals remain attached to that reporting area. They are not assigned to each intervention.

Original model outputs remain source records. Task progress, installed work, costs, visits and observations are dated operational records. Completing a task does not modify an original modeled benefit. Field measurements retain the source's unit, fraction, basis and method for later scientific interpretation.

The cost view reports budget, commitments and actual costs separately. Budget less actual is a simple ledger difference. Commitment and actual rows are not automatically reconciled into a remaining contractual obligation.

The planning calendar uses ISO weekdays. A task starts on the next allowed working date after its predecessors and its own start constraint. Durations consume working days; the exclusive finish boundary is the next working date after the last consumed day. Unknown predecessor duration leaves successor dates open. Cancelled dependencies are shown for the operator to review.

## Authored interface

Browser factory: attachImplementationWorkbench(host), with mount(node,state), update(state), detach() and dispatch(). Required host capabilities are getState, api, endpoint and refresh; showTask and toast are optional.

Native reads and writes use the supplied implementation descriptor and operator adapter. Scientific source import uses the original communities/conservation modules. The offline builder transforms only the authored ES module imports/exports and preserves the exact installed catalog.

## Existing focused check

One browser-core workflow has executed in V8: a Friday start with a Monday holiday produced the expected dependent Tuesday/Wednesday work; exact-cent costs remained exact; a complete visit/sample/result chain retained a censored result through JSON, CSV and HTML. This is a software exercise; the shipped plan begins with empty operational records.

The complete receiving run should use an actual retained source selection in the maintained native Workspace, save an edit, export, reopen the same revision, and open the portable edition in the equipped browser. Continue in the existing ECD1/ASTRA-ECO12 receiving operation.
