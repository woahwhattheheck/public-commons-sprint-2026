# Schema change review and staff resolution

This workflow compares two named OpenLineage editions, keeps the exact schema observations behind each change, follows declared field relationships, and records staff decisions through complete application receiving.

## Operate the workspace

Import the original producer event files in **Sources**. Preserve the original filename and source reference, including the original gzip file when supplied. Save an edition before the change and a second edition after importing the next original producer files.

Open **Schema changes**, select the two editions, and choose **Compare schemas**. The table shows the dataset, complete nested field path, observed change, effective decision, and assigned owner. Search operates over the complete change records. The decision filter and selected-change controls support a group review.

Choose a field or dataset row to inspect:

- Before and after values, including whether a property was actually present.
- The last original schema event in each edition, its JSON pointer, and the downloadable original source.
- Declared downstream fields, related runs, original lineage edges, and producer transformations in both editions.
- Current and earlier staff decisions, supporting evidence, and complete decision history.

A declaration for a field that has disappeared from the reported schema remains visible. Its node records that the field is absent from the reported schema. Repeated names retain each original field record and source position; the interface reports ambiguous groups and still compares other uniquely identified fields. A nested path and a literal dotted field name can share a lineage field string; the reported ambiguity remains attached to the original declared relationships.

## Record a decision

Select one or more changes and choose **Review selected**, or open a change and choose **Review this change**. Supply the reviewer name and reason. The reviewer name is the staff label recorded with the decision.

| Decision | Recorded work |
| --- | --- |
| Observed | The operator has inspected the selected change and recorded a reason. |
| Needs work | An owner and follow-up action are required. |
| Accepted | The operator records why the selected change is accepted. |
| Resolved | A completed resolution is required. |

Evidence selections point to complete existing source files, original events, and attached results. The record retains the selected original event locations. Later imports containing the same event can add source locations without rewriting evidence in an earlier decision.

**Update decision** retains the review ID, original edition pair, selected changes and all previous versions. To review a different selection, create a separate review. When several reviews cover one change, the most recently saved review supplies its effective decision; every review remains inspectable.

A review form keeps the workspace revision at which it opened. A refresh behind the form cannot silently replace a peer's subsequent decision. On a revision conflict, the complete typed request is retained and the form closes to expose the existing saved-request controls. Review the current workspace, then explicitly apply the retained request to the reviewed revision. That action creates the original application's linked replacement request.

When a save response is interrupted, use **Recover saved request**. The browser retains the original operation ID, full selected changes and input in its existing IndexedDB journal. Reopening the page at the same workspace address retains the pending request. The original workspace writer returns the previously saved result before checking the old revision, so recovery does not create another review.

## Interpret observed schema changes

Field identity is represented as a JSON array of field names, with original array indexes retained for individual records. Empty producer field names remain empty strings. Types, descriptions, custom properties and field order are compared as reported.

| Observation | Comparison behavior |
| --- | --- |
| Both editions report field arrays | Compare additions, removals, declared type values, metadata, order and nested structure. |
| A schema first becomes available | Report the observation and its complete reported field records. |
| A producer withdraws the schema facet | Report facet withdrawal and preserve its original deletion observation. |
| A field array is absent | Report the missing field-array observation. |
| Repeated names or malformed field records | Retain original records and positions, report ambiguity or changed invalid records, and compare uniquely identified fields. |

The source adapter remains the authority for accepted event projection. The schema workflow reads existing projected datasets and explicit or column lineage edges. It preserves original facet producer and schema URL metadata. The retained upstream full-event fixture contains a legacy custom schema URL; its reported fields remain labelled with that original source context.

Declared field-to-field edges retain exact producer field strings and original event provenance. Entity dependencies with no target field remain separate records. Paths are traced over the finite declared graph in each edition, with cycles retained and visited nodes accounted for. This workflow does not classify producer-specific type compatibility or infer renames.

Official facet references:

- https://openlineage.io/spec/facets/1-1-1/SchemaDatasetFacet.json
- https://openlineage.io/docs/spec/facets/dataset-facets/schema/

## API and SDK

The four actions are available through the existing authenticated HTTP action endpoint, native MCP catalogue and configured Merchant workspace aliases.

| Action | Input |
| --- | --- |
| schema.compare | from, to: two named saved edition IDs. |
| schema.impact | from, to, comparisonId, changeId. |
| schema.review.save | Original mutation ID/revision, exact comparison and change selection, reviewer, decision, reason, and optional assignment, resolution and evidence. |
| schema.report | from, to, optional format: json, csv, or html. |

Node SDK example:

    const compared = await client.compareSchemas(beforeEditionId, afterEditionId);
    const change = compared.changes[0];
    const impact = await client.schemaImpact({
      from: beforeEditionId,
      to: afterEditionId,
      comparisonId: compared.comparisonId,
      changeId: change.id
    });
    const request = {
      operationId: originalSavedOperationId,
      expectedRevision: compared.revision,
      from: beforeEditionId,
      to: afterEditionId,
      comparisonId: compared.comparisonId,
      changeIds: [change.id],
      reviewer: "Data operations",
      decision: "needs-work",
      reason: "The downstream reference needs its source owner's review.",
      owner: "Reporting team",
      action: "Inspect the selected downstream field against its original source.",
      evidence: [{ kind: "source", id: originalSourceId }]
    };
    const saved = await client.saveSchemaReview(request);

Keep the complete request for recovery. An existing operation ID with different input is rejected. A review update supplies the saved review ID and keeps the original edition/change selection. Its next mutation uses a new operation ID and the operator's reviewed revision.

The records.read action accepts schemaComparisons and schemaReviews at an exact workspace revision, with the existing offset/nextOffset contract. Those histories belong to the complete workspace; omit the edition filter. The metadata response includes both retained collection counts.

The Node client exposes compareSchemas, schemaImpact, saveSchemaReview and schemaReport, with TypeScript declarations. Managed MCP treats schema.review.save as a mutation, retaining its original uncertain-operation context and normal connection pinning.

## CLI

    node cli.mjs schema-compare --workspace /path/to/workspace --from BEFORE_ID --to AFTER_ID
    node cli.mjs schema-impact --workspace /path/to/workspace --input impact-selection.json
    node cli.mjs schema-review --workspace /path/to/workspace --input original-review-request.json
    node cli.mjs schema-report --workspace /path/to/workspace --from BEFORE_ID --to AFTER_ID --format html --out schema-review.html

The generic action command also supports all four operations against either a local workspace or the existing HTTP service. Output files use the original CLI's create-new behavior.

## Deliver and receive

The HTML report is printable and includes all decisions, history and original comparison details. The CSV report uses the existing spreadsheet-safe encoder and carries full structured change/impact and review records. The JSON report includes the complete schema comparison, effective decisions, all reviews and the declared impact of every change.

Complete workspace exports use application source edition **3**. They include schema comparisons, staff review history, original event/source/result bytes, the editable schema application modules, and the full receiving programme. Source reconstruction precedes complete comparison/history/evidence validation on receive.

The receiver retains the exact original version-1 and version-2 application inventories. Existing version-2 gzip originals continue through their original decoded source verification. Saved schema decisions travel with complete version-3 and version-4 application editions. Version 4 also carries service-level policies, assessments and incident history while retaining both original version-3 source inventories. An export can explicitly omit application source through the existing data-only API option; normal staff delivery includes the editable application.

The combined Python, Java, Merchant and schema release uses one application inventory maintained by the existing product owner. APPLICATION_FILES is the executable inventory; source packets can include additional application-provider or delivery files.

## Complete operating programme

Run the maintained whole application programme with the installed Node and Playwright/Chromium runtime:

    node SCHEMA_RECEIVING.mjs /absolute/path/schema-operations-input.json

The input is a private JSON file:

    {
      "schema": "commons.openlineage.schema-operations-input.v1",
      "operationId": "OPENLINEAGE-SCHEMA-OPERATIONS-B3909-20261012",
      "outputDirectory": "/absolute/path/original-schema-operations",
      "title": "Original OpenLineage schema operations",
      "browser": {
        "modulePath": "/absolute/path/to/installed/playwright/index.mjs",
        "executablePath": "/absolute/path/to/installed/chromium"
      }
    }

With this input, the programme reads the two untouched original upstream example files, verifies them against fixtures.json, and operates their actual schema observations. To use a retained producer workset, include complete original file selections:

    {
      "beforeSources": [
        {
          "path": "/absolute/path/original-before.json",
          "name": "original-before.json",
          "sourceUrl": "https://source-owner.example/original-before",
          "sha256": "EXACT_ORIGINAL_FILE_SHA256",
          "contentEncoding": "identity"
        }
      ],
      "afterSources": [
        {
          "path": "/absolute/path/original-after.json.gz",
          "name": "original-after.json.gz",
          "sourceUrl": "https://source-owner.example/original-after",
          "sha256": "EXACT_ORIGINAL_GZIP_SHA256",
          "contentEncoding": "gzip"
        }
      ]
    }

These selections extend the full input above. The programme preserves every supplied original byte, saves two editions, inspects the comparison and all declared impacts, and attaches a complete original reference. It then operates the browser staff workflow: an interrupted committed response, page reopen and exact request recovery; a peer decision and a background refresh behind an open form; retained revision conflict and explicit reviewed application; staff resolution and all three report downloads.

It exports the complete workspace, receives it into a separate directory, starts the included application, compares the complete restored review and source state, and re-exports the original editable application. Optional legacyPackages supplies paths to actual retained earlier archives for receiving alongside the current work. Preserve those original archive bytes.

The original output directory retains its operation input, exact request bodies, workspace identity, chosen local port, persistent browser profile, operating record, reports, screenshot and complete application export. Reuse the same input and directory to recover the original operation. The programme stops and closes its owned application and browser processes on error, preserving original state for continuation.

Save the complete output directory from its native lifetime. A private /dev directory is available only to the originating execution. The application export and original operating record must reach the agreed durable destination before that carrier closes.
