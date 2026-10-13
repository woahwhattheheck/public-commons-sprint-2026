# Installation mapping reconciliation

## Purpose and location

Open the existing Operations case, its Installation Source Desk, and **Customer editions**. Compare two retained source revisions, choose the original files for the successor, and select **Reconcile individual mapping fields**.

This is part of the original Source Desk. It uses the existing working-copy journal, original file byte store, request recovery, saved draft history and native Prepare. The mounted pane is operations_installation_mapping_reconciliation.mjs; the native model is operations_installation_mapping_reconciliation.py.

## Operator workflow

1. Select the source draft and exact retained source revision. The target is the current saved revision of the open draft. Compare the complete editions. Optional source and target preparation IDs expose their complete original outputs.
2. Choose **Retain**, **Replace** or **Remove** for every source file. Replacement selects a precise file already in the target. New target files remain included.
3. Select **Reconcile individual mapping fields**, then **Compare complete mappings**. The comparison retains both complete mappings and shows every differing unit.
4. For each differing field, choose its source value, target value, a custom JSON value or explicit absence. An absent value and a present null value have different meanings. Source/target absence removes that field; custom null keeps it present.
5. Use the source/target bulk buttons only when that is the intended choice for every unresolved field. Already chosen fields and unfinished custom editor text remain intact. The complete preceding review is retained.
6. Preview the complete reconciled successor. Review the whole resulting mapping, all resulting file metadata, original file decisions, native findings and every expanded array's original-to-resulting position map.
7. Save the reconciled successor. The original mapping.apply request records one new editable draft revision, its complete mapping proof and the nested source-edition transition. The original target revision must still be current.
8. Open **Source mapping**, resolve relevant native findings and run the original **Prepare**. Receive the complete prepared package and attach through the existing workflow when the original case is selected for attachment.

File and field choices are resolved together. A mapping choice never silently substitutes a different original source file.

## Arrays and field types

Objects recurse only where both values are objects. A type change, addition or removal is a whole value. JSON pointers use RFC 6901 escapes: / becomes ~1 and ~ becomes ~0.

Arrays start as whole values. **Expand by original position** explicitly compares their original index positions. No record identity, matching key or reorder is inferred. Expand array ancestors before nested arrays. Collapsing an array also collapses its expanded descendants.

Changing expansion first retains the complete preceding review. A decision is reused only when its entire original comparison row is identical. Changed decision groups start unresolved. Earlier whole-array and per-position choices, their exact custom editor text and the full preview remain restorable.

Expanded removals compact after every original position is resolved. For example, removing original position 1 does not cause the decision for original position 2 to apply to another record. The complete native preview records the resulting index, or null for removal, for every original slot.

Custom values are complete JSON. Strings require quotes. Exact decimal amounts should be strings such as "1200.50"; custom numeric values must be safe integers. Custom arrays preserve the exact entered order. A whole mapping may be an object or explicit null. Removing the root mapping is invalid.

The editor retains incomplete or temporarily invalid custom text. It is parsed only when preparing the complete preview.

Original native JSON is retained as exact text alongside its display structure. The browser displays original number tokens, including large integers, 1.0, -0.0 and exponent forms, without converting them through JavaScript numbers. Complete native comparison, plan, receipt and draft text remain in the working copy. Custom choices still use safe integers or exact decimal text.

## Full working-copy recovery

The mapping review is nested in the original editionWork.mappingWork inside the existing full Source Desk working copy. That copy includes comparisons, all field decisions, exact editor text, array expansion, complete previews, earlier complete reviews, saved proof and table search/page position.

Use the existing **Download complete working copy**, local-copy selection, fork and restore controls to move or recover the whole session, including original bytes and pending requests. **Download complete mapping review** is a focused review export; use the complete working-copy download when transferring the whole editable session.

The **Earlier complete mapping reviews** table restores exact earlier choices and archives the current review first. A restored review can be inspected even after its source or target advances. Compare again before previewing against different current inputs; the old review remains available.

All comparison tables paginate for display. Search covers the complete retained row set. Downloads include every row and complete original values.

Saving adopts the reconciled mapping through the original Source Desk confirmation for unsaved source/Installation fields. The complete preceding working copy is parked first. If a request is interrupted, use original request recovery; its request ID, actor, plan and target revision remain unchanged. An accepted request is read back and adopted rather than sent as a newly identified save.

## HTTP surface

Both read operations use POST beneath:

    /api/operations/{caseId}/installation-sources/{draftId}

The existing Staff route, actor and named capabilities continue to apply.

The mounted browser uses the additive /mappings/compare-wire and /mappings/preview-wire routes with the same input bodies. Each returns stellar-forge.installation-mapping-wire.v1 with the original value, its exact canonicalJSON string and sha256 of that whole string. Existing object routes remain available to native callers. /mappings/draft-wire accepts {"revision":NUMBER_OR_NULL} and returns the exact original draft through the same envelope. Browser downloads and displays use original text, and native Prepare hashes the exact canonical selection text.

Command responses carry nativeMapping exact text metadata for mapping application, original selection saves and later responses with retained mapping history. This metadata covers the complete original response without changing its stored business receipt. Original request recovery returns the same exact native content.

### Compare

    /mappings/compare

Body:

    {
      "source": {"draftId": "retained-source", "revision": 1, "sha256": "..."},
      "target": {"draftId": "current-target", "revision": 3, "sha256": "..."},
      "expandedArrays": ["/cases"]
    }

Use actual complete draft references from the original edition comparison. The abbreviated identifiers above describe the shape only.

The result is stellar-forge.installation-mapping-comparison.v1 with complete sourceSelection, targetSelection, explicit expandedArrays, encountered array lengths/modes, every differing row and its complete native identity.

### Preview

    /mappings/preview

The body contains source, target, expandedArrays, complete decisions and the existing edition file decisions. Each differing pointer appears exactly once:

    {"pointer":"/customer/title","choice":"source","value":null}
    {"pointer":"/customer/hours","choice":"custom","value":40}
    {"pointer":"/customer/amount","choice":"custom","value":"4800.00"}
    {"pointer":"/customer/obsolete","choice":"absent","value":null}

For source, target and absent decisions, value must be null. Custom values carry their selected JSON value.

The result is stellar-forge.installation-mapping-plan.v1, including complete decisions, resolved selection, arrayChanges and full editionPlan. Save this entire native plan.

### Apply and replay

Use the original Source Desk request endpoint and request body with:

    "action": "mapping.apply",
    "data": {"planJSON": "EXACT_CANONICAL_NATIVE_PLAN_JSON"}

Native clients may continue using data.plan with the full original object. The mounted browser submits exact canonical data.planJSON so numeric values are preserved. Source mapping edits similarly use selection.save with data.selectionJSON carrying the whole original editor text; existing object callers remain supported.

The native writer reproduces the full preview, checks the target against the original current revision and applies the existing file decisions. It retains the full stellar-forge.installation-mapping-reconciliation.v1 receipt in draft.mappingReconciliations. The existing editionTransitions history also remains present.

## Native command surface

Use the installed workspace's existing operations CLI and its current workspace selection. These are subcommands of that existing launcher:

| Command | Inputs | Result |
| --- | --- | --- |
| source-mapping-compare | --case, --draft, --input, optional --output | Complete native comparison |
| source-mapping-preview | --case, --draft, --input, optional --output | Complete native mapping and edition plan |
| source-mapping-prepare | --case, --draft, --plan, --actor, --request-id, optional --note and --output | Original immutable mapping.apply operation |
| source-mapping-execute | --case, --draft, --operation-file, optional --output | Execute or recover that exact original operation |
| source-mapping-show | --case, --draft, optional --revision and --output | Complete saved draft and all retained mapping reconciliations |
| source-mapping-export | --case, --draft, --input, --format json/csv/html, optional --output | Native-bound complete mapping review report |
| source-mapping-course-prepare | --case, --draft, --plan, --request-prefix, --actor, optional --note, --attach-version and --output | Frozen mapping, native Prepare and optional original case attachment |
| source-mapping-course-run | --case, --draft, --course, --archive-output, optional --output | Resume the complete original receiving course and publish its complete native ZIP |

The mapping course schema is stellar-forge.installation-source-mapping-course.v1; its result is stellar-forge.installation-source-mapping-receiving.v1. These commands reuse the existing receiving helper and original Workspace owner. Course operation IDs are frozen before execution and reused across recovery.

Exports retain the full original comparison, complete original source/target values, decisions, resulting selection, all file choices/findings, original-to-resulting array positions and saved receipt when supplied. CSV includes the complete original report as well as its structured rows. HTML is an offline, plain industrial review document. Each output uses the existing private, create-only publication path.

Native limits are 8 MiB per selection, 12 MiB per complete plan, 20,000 differing rows, 128 nested levels, 100 saved reconciliations and 24 MiB of complete saved reconciliation history. A capacity error keeps the complete current input available; histories and plans are not truncated.

## Integration and actual commissioning

The original parent operations_installation_sources.mjs provides the existing hash, journal, request and download functions. Its apply/adoption paths recognize mapping.apply alongside edition.apply. The original edition pane owns file choices and mounts the mapping editor; no second application or store is created.

The managed source manifest must include both new mapping modules, the native CLI module and this guide, plus the changed original files. The existing agent/MCP source and capability catalog expose mapping compare/preview/apply through the original Source Desk owner.

Commission this addition on the existing original equipped workspace and case. Preserve its selected native runtime and operation; use the same full real source packet and prepared profile inputs already retained there.

Open the actual mounted product at a normal screen-share width and a narrow width. Suggested viewports are 1440x1000 and 390x844. Look at the screens and exercise these linked operator paths:

- Compare complete retained customer editions, resolve original file choices and reconcile realistic mapping fields.
- Inspect exact retained original numeric tokens including large integers, 1.0, -0.0 and exponent forms, then carry the complete result through native Prepare. Distinguish source absence, target absence, explicit null and custom text. Retain unfinished invalid text through full working-copy download and restore.
- Expand arrays and nested arrays, remove original positions, collapse and restore earlier complete decisions. Inspect every resulting position map.
- Search and page a comparison with more than one page; verify complete downloads retain all rows.
- Preview, park unfinished source fields, save, recover the same original request when interrupted, reopen saved history, and continue native Prepare through the original case.
- Open the complete JSON, CSV, HTML and native archive using normal receiving tools. Read the complete prepared customer result and source files.
- Reopen an earlier complete review after the target advances and inspect its retained choices before making an explicit new comparison.

Use the actual product screens and native receiving result to describe commissioning status. Source publication and source-level checks are recorded separately from these operator results. Follow the repository's current AGENTS.md for the outgoing visual and control review.
