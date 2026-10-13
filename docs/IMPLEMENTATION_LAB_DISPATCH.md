# Prepare laboratory requests and compare returned results

Use **Implementation & fieldwork → Field records → Laboratory requests and returns** to prepare an explicit request from original saved sample activities. Each request is an immutable package bound to one plan revision. The plan’s original sample, collection, custody and source records remain the authority.

## Choose samples and requested analyses

1. Open the original plan and choose **Prepare or reopen laboratory request**.
2. Enter a nonblank request label. Add the laboratory, laboratory reference and instructions as appropriate.
3. Search the original sample list by sample/activity ID, site, collection timestamp or custody reference. Select individual samples, or use **Select all matching samples** after reviewing the matching count. The selection covers the matching set across every page.
4. Enter an explicit requested parameter. Unit, chemical basis, fraction and method are optional request restrictions. Add analysis notes where useful.
5. Choose **Add analysis to selected samples**. Each selected sample receives one explicit order for that analysis. Repeat for additional analyses or edit/remove individual order rows.

Only original activities whose kind is **sample** appear in the chooser. A source sample ID is displayed beside its native activity ID; those identities are retained separately. Missing collection timestamps or custody references remain visibly missing. No planned visit date fills an actual collection time.

When selected samples belong to an original monitoring campaign, its declared parameter strings are offered in **Optional original campaign parameter**. Choosing one fills the parameter field for review; it does not create an order until **Add analysis to selected samples** is used. This preserves the distinction between a campaign’s intended parameters and the actual requested laboratory work.

Optional unit, basis, fraction and method fields constrain the requested analysis and its return comparison. Leaving one blank means that the request does not specify that field; the request never invents a method or a detection limit. Each order row can be edited independently. Duplicate or inconsistent orders remain subject to the original model’s preview validation.

The sample list and order list show 50 rows at a time. Selection counts, submitted orders and saved packages cover the full set, including other pages.

## Retain original supporting files

Expand **Original files to include** and select actual local-file source links from the plan. The native producer verifies and retains their original bodies with the request package. A file label alone is not substituted for its contents. The package also records the original plan revision and sample relationships.

The separate original file-evidence panel remains responsible for capturing, previewing and returning files. Use its existing controls to attach a missing original file before preparing the request.

## Review and prepare the package

Choose **Review saved request**. If the current plan is a browser draft, the button reads **Save plan and review request** and uses the existing native revision queue first. Later browser edits remain in the draft; review continues only when the current plan matches the saved revision.

The review shows original sample, order and attachment counts plus all producer issues. An original sample must have its actual collection timestamp before package preparation; record the true source value in the plan and save that revision if it is missing. **Export full request review** retains the full reviewed rows, even when the interactive sample/order view is paged.

**Prepare retained request package** is enabled only for the exact saved revision, selection and preview operation. The original task queue retains its operation ID if the request needs to be retried. Preparation creates a separate immutable package; it does not create another plan revision or mark samples as shipped.

When the operation completes, the package appears under **Retained requests for this plan**. Its original revision and downloads remain available after reopening the plan. Use **Open original request** to inspect a previous edition. A different original selection or revision creates its own package.

## Use the returned laboratory file

The native package contains the original submission rows, manifest and return-template/mapping files. Download them from the retained package’s original file links. Fill the template from the laboratory’s actual returned values and result types, retaining its original order and sample identities.

Choose **Open laboratory CSV intake**, upload the returned original file, and load the package’s mapping JSON. The maintained laboratory intake still requires its explicit source preview and one-revision import. Review every reported conflict there. Numeric, censored, text and missing results remain distinct, and the importer retains the complete original CSV and source-row decisions.

Preparing the package and opening laboratory intake do not send messages or change an external laboratory system. The application provides the retained files for the original operator’s established submission process.

## Compare requested and returned analyses

Open the original retained package and choose **Compare with saved results**. If needed, save the current plan through the existing native queue first.

The comparison is bound to the original request and one exact saved plan revision. It identifies each requested analysis as **returned**, **missing** or **ambiguous**, preserving the matching and competing original observation IDs, returned result types and reported issues. The displayed requested unit, basis, fraction and method distinguish orders for the same parameter. An explicit original return order ID takes precedence where the retained source provides one; otherwise the producer uses exact original activity and parameter identities with the request’s optional restrictions.

A returned censored or text result is still a returned laboratory record. The status does not mean that a numeric value was observed, that quality criteria passed, or that a threshold was met. Review the original result type, qualifier, limits, method and QA through the existing results inspector and Observed water quality workflow.

Unchanged observations already present at the original request revision remain separately identified as pre-existing records. They are excluded from new-return counts. The comparison also lists results for the selected original sample activities that fall outside the requested order set. It does not discard those records, invent missing values or merge ambiguous returns.

The interactive return table shows 50 rows at a time. **Export complete reconciliation** includes every requested order, match, issue and unrequested observation ID across all pages. **Export package metadata** retains the original package identity separately.

## Carry the original request and returns into a scientific report

Open the retained request, then choose **Review scientific report source**. This uses one exact saved field-plan revision. If there are browser edits, **Save and review report source** uses the existing native queue first and preserves any later changes separately.

The review retains the original request revision, compared plan revision, matching and competing results, unrequested and pre-existing records, source result types, original sample context and source files. A request with zero returned results is valid: its report records the requested analyses and missing returns without creating measurements.

To preserve an existing report, expand **Preserve an existing report selection**. **Use registered field report revision …** explicitly selects the latest original field-report source for this plan. Alternatively, choose the complete original delivery-selection JSON from a saved report. Its existing sections, figures, scientific context and selected model/geography settings remain part of the new selection. The chosen selection is displayed for review. Changing or clearing it invalidates the source preview.

Choose **Register report source** to retain that exact source edition through the original task queue. This creates a scientific source document; it does not change a plan revision or an observation dataset.

**Open retained report source** opens the original Sources viewer with its complete source document and companion files. **Prepare client report** opens the maintained report form with that retained selection. Finish an already-open report or field editor before opening another; existing draft controls are preserved.

The source edition remains tied to its original request and compared revision after later field edits. **Export report-source review** and **Export report-source metadata** retain the respective full bindings. Native download links expose the verified original package, current plan/revision, reconciliation JSON and complete request/result/context tables. The readable report tables may show an initial portion of a large table; the full retained CSV/JSON companions carry every record.

For source methods, composition and exact API details, see **IMPLEMENTATION_DISPATCH_REPORT.md**. The native model is `model/implementation_dispatch_report.py`; its source-registration action is `implementation.lab.dispatch-report`. It uses the existing OBSERVED_CONTEXT collector, including the caller's original preceding report selection where chosen.

## Revision, draft and retry behavior

- Request controls are cached with the original plan’s browser draft. Switching plans restores that plan’s own controls; creating a new plan or opening another JSON document clears the previous active request state.
- A reviewed request is invalidated when its editable selection changes. A different plan revision requires a new review.
- Preparation completes against the originally reviewed revision even if later browser edits exist. Those later edits remain in the browser draft.
- A task interrupted or retried uses the same retained native operation. The package receipt must match the original plan ID, revision, digest and preview operation before the interface accepts it.
- A read-only comparison uses the requested saved revision. Opening another package or changing the request clears the previous displayed comparison.
- Offline field editing remains available through the complete portable workbench. Return its complete plan JSON to the original native workspace before preparing native laboratory packages.

## Source integration

The additive UI helper is `operator/web/implementation_dispatch.mjs`, loaded only when the native laboratory-request controls are opened. The current workbench retains the original plan queue, history, draft, laboratory-intake, observation-registration and results-review flows.

The extension descriptor exposes the original provider’s routes:

| Operation | Native route |
| --- | --- |
| Review request | POST `/api/implementation/dispatch-preview` |
| Retained packages | GET `/api/implementation/dispatches` |
| Open package | GET `/api/implementation/dispatch-detail` |
| Compare returns | POST `/api/implementation/dispatch-reconcile` |
| Prepare through retained task queue | `implementation.lab.dispatch` / POST `/api/implementation/dispatch` |
| Review scientific report source | POST `/api/implementation/dispatch-report-preview` |
| Register retained report source | `implementation.lab.dispatch-report` / POST `/api/implementation/dispatch-report` |

The model is `model/implementation_lab_dispatch.py`. Preview and reconciliation read an explicit saved revision and return its actual digest. Preparation requires that preview’s digest and operation ID. The provider owns workspace access and original download tickets.

The existing **Sample quality control** action is available in native **Field records**. It opens the independently maintained QC editor on the exact saved revision; a later browser draft stays intact. Closing, changing plans or rendering another workbench view preserves the QC editor’s own revision-specific selection and pending-operation record. Its additive model/provider/descriptor/helper must be received with the current complete application. Outcomes remains in its original tab.

The supplied standalone HTML is regenerated from the current complete planner, preserving native-only dynamic capabilities without invoking them in offline mode. Preserve other owners’ Outcomes, explicit QC, campaign, evidence and current source-catalogue integrations when composing the shared controller.
