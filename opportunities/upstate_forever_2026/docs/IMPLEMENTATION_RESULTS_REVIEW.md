# Review original field and laboratory results

The **Field records** view supports reviewing a full plan of field and laboratory observations through one consistent set of filters and exports. It works in the original native planner and in the complete portable offline workbench.

## Review a saved revision or browser draft

Open **Implementation & fieldwork**, choose the original plan and then **Field records**. **Original observations** identifies the full count, the matching count, the current page and the matching numeric, censored, text and missing counts. The collection-time count describes records without an actual activity collection timestamp.

Use the search box for original result/activity/sample IDs, result text, parameter, method, QA, qualifier, unit, site, source label or notes. Press Enter or leave the search box to apply it. Search is case-insensitive; multiple space-separated search terms must all occur in the record’s displayed scientific or relationship fields.

Select a site, parameter, result type, QA status, source or unit independently. Facet counts describe the complete current plan. A previously selected filter remains visible if later edits leave it with no records; **Clear result filters** restores the full set. These are review controls, not changes to source records.

The **Original collection dates** section uses the original local calendar date stored in the sample/activity timestamp. An active date range excludes records with no collection timestamp. Sorting by collection time uses the actual timestamp instant, with missing timestamps last. No visit date or planned date fills a missing sample time.

Choose original plan order, parameter/unit order, site order or collection-time order. Page sizes are 25, 50, 100 or 200. Every change recalculates matching counts and clamps the current page to the remaining records. Filters and page preferences are retained with this browser’s plan draft; they do not modify the native plan document.

## Inspect original records and edit the existing result

Each row keeps the original observation ID. **Edit** opens the maintained observation form for that exact record. Saving a draft edit preserves its laboratory source metadata, and the original native revision history remains available.

**Inspect original record** shows:

- Current observation fields, including numeric value, original text, unit, basis, fraction, qualifier, limits, method, QA and notes.
- The complete original CSV row in original header order, its data-record number, physical line span, source hash and field-mapping selections when a laboratory binding exists.
- The original site, visit, sample/activity, linked implementation task and original monitoring campaign, including collection time, custody, field-form details and associated evidence references.
- The exact laboratory import marker and retained CSV/audit source links.

Current edited values and original source cells appear separately. The source binding is not rewritten to match an edit. When the original evidence panel is installed, its **Preview original file** and **Download original file** controls open the referenced original files through that panel’s native or offline vault. Other native installations offer existing verified file tickets when available. **Export this original record** retains the complete inspected relationship as JSON.

## Export every match

**Export all matching CSV** exports the entire matching set, across every page, using the existing observation CSV serializer. It includes all canonical observation columns and every original additive field, including the laboratory source record, original row and mapping metadata. Original result IDs are retained. Spreadsheet formula-like strings use the maintained CSV safety treatment; numeric values remain numeric.

**Export matching records and sources** produces a contextual JSON selection containing all matching observations, their original activities/visits/sites/tasks and monitoring campaigns, referenced original source, laboratory and evidence links and import markers. It records the current filters, full/matching counts and whether the source is a browser draft, saved native revision or portable plan. It is a review selection; use **Export JSON** in the main toolbar for the complete revision-aware plan return.

The matching CSV follows the selected review order. The contextual JSON keeps original plan order and includes each related record once. Neither export is limited to the displayed page.

## Continue into scientific review and reporting

Use the existing **Review saved field observations** and **Register saved field observations** flow when a saved revision is ready for the scientific workspace. **Open observed data** opens the original observation edition in **Observed water quality**, with its original scientific views. The planner’s review filters do not change that registered source edition or its scientific grouping.

Use **Handover** for the original implementation report or native report package. The report retains the full selected plan revision. Filtering this results table does not silently trim the report or change the original plan’s source coverage.

## Source composition

The additive helper is `operator/web/implementation_results.mjs`. The current planner imports its review, source inspection and matching-export functions. It reuses the maintained core CSV serializer and the existing record editor; it introduces no alternate plan store.

`build_implementation_offline.py` includes the helper before the planner and binds its imports to the same original core module. The complete installer and extension manifest include the helper, and the supplied standalone HTML is regenerated from those exact sources. Preserve later evidence, campaign, transfer and native-report additions when composing the controller or builder.
