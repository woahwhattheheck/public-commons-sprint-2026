# Recurring customer intelligence

This module turns the original retained Diffbot editions into an operated customer delivery: saved watch selection, original article/product change review, append-only decisions, selected delivery fields, and a self-contained report. The provider acquisition, Bulk job, raw-source store, scheduler and workspace remain the existing Diffbot/SF30 implementations.

## Parent integration

The public Python API is:

    from recurring import (
        build_recurring_report,
        render_recurring_html,
        validate_config_update,
    )

    next_config = validate_config_update(
        stored_workspace.get("recurring", {}), submitted_recurring
    )
    # Persist next_config at workspace.json.recurring inside the ORIGINAL
    # workspace revision/CAS transaction, alongside its existing source bindings.
    recurring_report = build_recurring_report(
        current_dataset_report, previous_dataset_report, next_config
    )
    customer_json = recurring_report["customer"]
    customer_html = render_recurring_html(recurring_report)

The input schema is tj.diffbot-dataset-report.v1, as produced by the original dataset engine. The report is pure and deterministic: it neither reads files nor modifies the input objects. It retains the exact current and previous input digests, edition identities, source digests, original comparison entries, coverage, record lineage and number tokens.

Call validate_config_update against the stored configuration within the existing save transaction, not only against a caller-supplied prior version. It rejects a removed, reordered or edited decision prefix. A later decision supersedes the effective decision for the same record and edition while preserving every earlier event. The original workspace must still enforce its own revision/CAS and authorization rules; this component is not a second store.

The browser API is:

    import {mountRecurring} from "./recurring/recurring.mjs";

    const view = mountRecurring(container, {
      report: currentRecurringReport,
      config: savedWorkspace.recurring,
      async onChange(nextConfig) {
        // Use the parent's existing revision-bound save and preview operations.
        const saved = await saveOriginalWorkspace({recurring: nextConfig});
        const preview = await previewOriginalWorkspace(saved.revision);
        return {
          report: preview.recurringReport,
          config: saved.workspace.recurring
        };
      }
    });

    // The original source/edition picker and workspace reopen call this:
    view.update({report: refreshedRecurringReport, config: savedRecurringConfig});
    // Unmount the component:
    view.destroy();

The save/preview function names above are illustrative joins to the parent's existing API, not additional network endpoints. The module itself makes no network calls, writes no storage, and creates no provider worker. onChange must resolve only after the parent save succeeds. It can return {report, config}, return a recurring report directly, or let the parent call update. If only the configuration is saved, customer export remains disabled until the matching parent-generated preview arrives. This prevents the new watchlist or decision state from being attached to an older report.

The report includes customer and customerHtml for this native browser workflow. HTML and JSON download use those exact server-derived projections. Reopening the original workspace restores its watchlist, decision history and delivery selection through the same callback/API.

## Saved configuration

    {
      "watchlist": [{
        "id": "customer-article-scope",
        "label": "Reviewed article scope",
        "enabled": true,
        "selectors": {
          "kinds": ["article"],
          "sourceUrls": [],
          "sourceIds": [],
          "recordIds": [],
          "text": ""
        }
      }],
      "decisions": [{
        "recordId": "opaque-original-record-identity",
        "editionId": "exact-current-edition",
        "decision": "accept",
        "reviewer": "Named reviewer",
        "at": "2026-10-11T22:00:00Z",
        "note": "Review rationale retained in the workspace."
      }],
      "delivery": {
        "title": "Customer intelligence review",
        "fields": ["title", "text", "date", "offerPrice", "availability"]
      }
    }

Each enabled watch is an OR alternative. Nonempty selectors inside one watch are combined with AND. Values in a selector are alternatives. Source URLs match the exact original record source URL or source.request.pageUrl; resolved URLs, titles and SKUs do not establish identity. Source IDs and record IDs remain opaque exact strings. Text is a case-insensitive substring search in the original field projection, without semantic inference.

An empty watchlist selects all retained observations. A nonempty list with every watch disabled selects none. Removing or changing a watch never deletes review history. The UI provides complete watch editing plus shortcuts to select an exact record or source.

A decision binds recordId to the current editionId. An accept decision from an earlier edition never approves a later acquisition. The current effective decision is the last stored event for that exact pair. Accept delivers the observation, ignore excludes it, and revisit retains a visible follow-up. The browser marks review notes as workspace-only; customer output contains the decision/reviewer/time and excludes those notes.

Delivery fields are exact top-level provider field names. An explicitly empty fields array delivers identity/provenance with no source fields. Missing fields remain missing; the renderer labels them Not provided instead of coercing them to null, zero, an empty string, a currency or availability status.

## Comparison and coverage

The original engine's changes collection is authoritative for added, changed, notSeen and unchanged classification. The consumer preserves each original entry and exposes unresolved/conflicting classification findings. It does not regenerate identities from a title, source URL, SKU, productId or content hash.

A supplied previous report joins only when its edition.id equals current.changes.baseEditionId. Otherwise its objects are not joined, and both the mismatch and the independent coverage are visible. The original comparableScope flag remains explicit. Descriptive exact field differences preserve absence versus null, array positions, typed values and numeric lexemes; a difference does not make mismatched acquisition scopes comparable.

Not-seen observations are reviewed against the CURRENT edition because the review concerns that acquisition's absence. Their retained values and source, if available, remain labelled with the PREVIOUS observed edition. Accepting such an observation includes that explicit qualification in customer output. It never establishes deletion.

Current and previous coverage retain the original state, selected URLs, successful URLs, failures and not-seen URLs separately. Every customer report contains this evidence and the original input digests, including reports with zero accepted observations. Missing coverage and unavailable bases remain visible rather than silently becoming complete coverage.

## Source and data boundaries

Pass only the safe core consumer projection. Provider tokens, account credentials, childTokens, credential-bearing Bulk download URLs, raw private response envelopes and transport headers belong to the existing private acquisition/source custody. This component has no reason to receive them.

Records preserve the original article/product kind and provider/local identity basis. Exact decimal lexemes stay strings. The module does not parse a price as a floating-point number, invent a currency, equate an omitted availability value with out of stock, or collapse distinct source objects.

The HTML renderer escapes all provider strings, including fields.html. It embeds no scripts or remote images, uses a restrictive content-security policy and permits only HTTP(S) links without embedded user credentials. The browser uses DOM text nodes for provider content and for its customer preview. Host CSS comes from recurring/recurring.css; it creates no inline style, frame or executable provider HTML. Original images, HTML, tags, nested specifications and money objects remain inspectable as retained values.

Customer delivery is an explicit projection of accepted selected records. It retains current and previous source/provenance, selected field differences and exact original number evidence. Operator decision notes and unrelated source records are excluded. The retained source digest identifies the exact stored source representation. sourceKind, originalWireBytes, the provider request, acquisition provenance and any safe-capture original/redaction relation remain explicit; a displayed official testdrive result is not called raw HTTP bytes. The original fieldSha256 is retained separately from selectedFieldsSha256, which identifies the selected customer fields.

## Complete operator sequence

1. In the ORIGINAL Diffbot acquisition workspace, select the exact current edition and its retained comparison base. Review the original source/job outcome and coverage.
2. Open recurring review. Save one or more exact source/record/kind watches, or keep the empty default selection for all observations.
3. Select an article or product. Inspect current and previous original fields, exact changes, source digests, capture time and Bulk job identity. Keep partial coverage and not-seen semantics visible.
4. Append an accept, ignore or revisit decision with a named reviewer and a workspace note. A changed decision is another append, never an edit of history.
5. Save the customer title and exact field selection. Await the original saved-preview response, inspect the customer preview, and download its reviewed JSON and self-contained HTML.
6. Close and reopen the ORIGINAL workspace. The parent loads the same configuration and retained source editions and calls update. The same inputs produce the same customer digest and reviewed output.
7. When the original acquisition engine supplies a new edition, preserve the earlier history and repeat the current-edition review. No decision, coverage guarantee or deletion inference automatically carries forward.

## Source contract

Original provider source and formats are documented by Diffbot:
- https://github.com/diffbot/diffbot-python/tree/3e09ab422da189edd890ee11bf7c08a34a0ffedd
- https://www.diffbot.com/docs/extract/
- https://www.diffbot.com/docs/extract/analyze
- https://www.diffbot.com/docs/bulk/

Those provider contracts are consumed by the original acquisition/dataset engine. This arm consumes its retained edition reports and does not issue additional paid requests or new Bulk jobs.


## Complete original workspace front door

The integrated web/index.html, web/browser.mjs and web/style.css operate the existing PythonWorkspace through workbench.mjs. Serve these assets at /diffbot-dataset/ along with recurring/recurring.mjs and recurring/recurring.css. The module uses the original /local-draft-store.mjs for its retained local draft and pending operation. It creates no parallel database or provider client.

The pages cover the complete operator journey:

- Overview identifies the current saved edition, scope, original capture count, coverage and original comparison.
- Sources & acquisition keeps the exact URL/extractor/field/options selection, original source times, capture descriptors, safe-wrapper provenance, original Bulk job metadata and explicit CSV outcome mapping. Raw UTF-8 captures are hashed before they enter the draft and are never parsed and reformatted for storage. An inspection-only parser preserves numeric token text and rejects duplicate keys before credential checks. Import the acquisition client's original *.source.json descriptor and matching captures/<sha>.json together.
- Acquisition preparation downloads the exact selected URL array, reviewed scope and commands for the existing account/estimate/extract/Bulk/reconcile/export client. It retains only the credential environment variable name. A command plan is neither a provider run nor an account-credit observation.
- Dataset review shows original article/product/list fields, exact numeric pointers, source lineage, actual change classifications and append-only named decisions. Version resolution uses the exact retained sourceId and sourceIndex plus reviewer, reason and time. A resolution does not silently accept its chosen variant.
- Customer columns maps named output columns to original supported JSON pointers; the source's numeric-token sidecar remains available. Base export mode is all non-ignored/non-conflicted rows or accepted rows. Recurring delivery separately applies its saved watch selection and accepted-only projection.
- Recurring delivery saves through the original revision transaction, starts one retained native build and awaits its exact matching output. A partial save/preview failure retains the original operation; no duplicate worker or falsely completed delivery is produced.
- Files & handover checks every original native result and file body against its recorded SHA256 and byte length. Customer projections and full operator notes/history are separately labelled. The complete original workspace export reopens through the existing workbench import command.
- History opens prior saved revisions read-only, restores them as a new native revision, retains a previous local draft and merges disjoint edits against the current saved head. Concurrent decisions for the same record and edition require an explicit merge.

The operator keeps original reviewed source bindings stable. New captured inputs belong to a new edition; a previously reviewed edition's scope, source references and capture time cannot be silently replaced by a normal draft save. The new-edition control copies the reviewed scope and begins with no fabricated captures. Its actual original files and times are then imported. Historical restore remains the original explicit restore operation, preserving all saved history.

### Existing native API join

The front door uses the established token/origin policy and these original routes:

| Operation | Original API |
|---|---|
| Current state | GET /api/state |
| Saved source file | GET /api/file?revision=ID&path=workspace.json |
| Exact revision | GET /api/revision?id=ID |
| Save current draft | POST /api/revisions with expectedHead, baseRevision, note and exact UTF-8 files |
| Start original engine | POST /api/preview with revisionId, function inspect_dataset/build_dataset, input editionId and retained operationId |
| Read/recover original preview | GET /api/preview?id=ID |
| Verify full result | GET /api/preview-output?id=ID |
| Cancel original preview | POST /api/preview/cancel with original id |
| Restore source | POST /api/restore with expectedHead and selected revisionId |
| Full portable workspace | GET /api/export |

Expected-head save/restore requests and the exact operation identity are written to the original pending store before dispatch. After an uncertain response the recovery path matches the exact saved revision note, source file hashes or preview operationId before reusing the same request. A conflict preserves the local draft rather than replacing a newer source.

The editable core shapes are original: export.columns is a name-to-JSON-pointer object, not an invented array. A resolution contains recordId, editionId, sourceId, sourceIndex, reviewer, reason and at. Relative numberTokens pointers such as /offerPriceDetails/amount bind to fields; a mapped column uses /fields/offerPriceDetails/amount. The original changes arrays retain added/notSeen/unchanged references and changed {id,before,after,changedFields} entries. No browser projection invents a source comparison.

### Display and delivery

The industrial interface uses neutral external CSS and plain controls, including a narrow-screen layout. Source HTML, nested specifications and image metadata are inert text; the customer preview uses the same source-bound JSON projection. Only the standalone downloadable customer HTML embeds its own stylesheet and its script-free restrictive policy.

readOnly:true may be passed to mountRecurring for a historical source. update accepts a new readOnly value along with the report/config pair. Parent saves can partially complete before a preview is interrupted; the module therefore describes the retained outcome accurately and leaves recovery to the existing workspace.

The parent should copy __init__.py/report.py into the original native revision and serve the browser module/stylesheet through the existing asset manifest. Complete operator reports can be larger than customer projections; the original native output and source limits remain authoritative. Do not trim captured records or silently replace a complete result with a sample to fit a preview.
