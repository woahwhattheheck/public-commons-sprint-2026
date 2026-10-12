# Finage market workspace

A complete retained-source operator workflow for Finage quote, trade, aggregate and stream observations. The application uses the existing Python workspace for saved revisions, original preview execution, local draft recovery, file export and portable receiving.

## Open the original source

Use Node22.13+ and Python3.11+ with the maintained workspace source or installed distribution. No provider account is required to inspect already retained inputs.

Prepare an existing capture using the original acquisition client:

    python3 acquisition.py import --manifest RETAINED_MANIFEST.json --out CAPTURE_DIRECTORY
    python3 acquisition.py prepare --dir CAPTURE_DIRECTORY --out PREPARED_DIRECTORY

For an entitled REST or existing stream capture, select the exact account, plan and original scope described in CAPTURE.md. The client retains original HTTP bodies or WebSocket application payloads. It does not create a second application store.

Create and open the operator workspace:

    node workbench.mjs create --source-root REPOSITORY_ROOT --dir NEW_WORKBENCH_DIRECTORY --dataset PREPARED_DIRECTORY/workspace.json
    node workbench.mjs serve --source-root REPOSITORY_ROOT --dir NEW_WORKBENCH_DIRECTORY --port 8431

Open the complete private operator URL printed by serve. The original workspace server owns its authentication, same-origin API and lifecycle. The Finage interface is at /finage-market/. Stop the owned server with Ctrl-C and reopen the same workbench directory when continuing.

Without an explicit --plan, creation uses the existing development-only unconfigured declaration. Private previews need no signer, payment or provider request. Configure a production merchant separately through the original runtime workflow if that service is actually wanted.

Installed commands use the same entrypoints:

    starforge finage-acquire --help
    starforge finage-workspace create --dir NEW_WORKBENCH_DIRECTORY --dataset PREPARED_DIRECTORY/workspace.json
    starforge finage-workspace serve --dir NEW_WORKBENCH_DIRECTORY

## Complete operator workflow

1. **Sources:** inspect exact input identities, original request scope, capture metadata, coverage and provider provenance. Download the original files, or import the next complete prepared workspace and every referenced capture. Existing source editions and named decisions remain retained.
2. **Inspection:** run the selected saved edition. The processor reads every selected observation; choose records, sources, symbols, findings, changes or capture events and page through the complete result. Original number tokens use typed display cells so the browser does not round them.
3. **Comparison:** select the actual prior edition. Alignment requires exact scope and source-specific time interpretation. Duplicate symbol/kind keys are reported as ambiguous. Original field kinds and exact decimal differences remain visible. Stream connection intervals are not treated as aligned snapshot observations.
4. **Decisions:** enter the actual reviewer and reason, choose the original source and append time interpretations, exact symbol mappings or accept/exclude/revisit decisions. A new choice appends history. Exclude an original source, symbol or record; a finding itself records acceptance or a revisit.
5. **Customer columns:** choose the original canonical25-column mapping or define the customer's exact ordered labels and JSON pointers. All primary observations or only explicitly accepted observations may be selected; explicit exclusions remain counted. Inspect a real record before choosing pointers.
6. **Delivery:** save the draft, build the operator or customer report, download the retained files, then create the full source-bound customer handoff. The portable workspace contains the original saved history and outputs.
7. **History:** reopen earlier revisions/results, recover the same interrupted operation, merge independent local changes or restore an old source as a new revision. The prior local draft remains recoverable.

Local browser drafts use the maintained IndexedDB draft store. A pending mutation is retained before dispatch. Recovery checks its original operation identity or matching saved revision before retrying. Concurrent saved changes require a merge; they are not overwritten.

## Exact fields and interpretation

Raw symbol spelling is retained. A customer label changes only after a named source-bound mapping. Quote and trade collections stay separate; snapshot totalResults is compared with unique exact symbols across both collections.

The original JSON number token is distinct from a JSON string. In complete NDJSON, /raw/p preserves a numeric original price as a number with the same token, whereas /fields/p/text explicitly selects a string. CSV uses the same exact text. Null and empty string remain separate kinds in NDJSON.

Event times retain raw value, JSON kind, chosen unit, exact Unix nanoseconds where representable and UTC interpretation. The provider's timestampUnitDeclared stays separate. Zero is still zero; capture UTC never replaces an event timestamp. Omitted aggregate limits default to the documented100, with maximum50000. A response reaching its selected limit may be capped; no next cursor or complete requested window is invented.

WebSocket envelope ordinals are local capture order. Original text payload bytes are Base64 decoded and verified before JSON interpretation. Connection-start/end, reconnect and other local events remain inspectable. Binary and credential-redacted derivatives remain distinct from decoded original text observations. Published model structures are inspected as reference observations and never become captured account feed data.

Price basis is explicitly native or derived quote midpoint. Source provenance is retained as published; the application makes no exchange-tape, executable-price, tradability or service-guarantee claim.

## Full customer files

Compact native previews fit the original1MiB output limit and do not pretend to contain a complete large mapped dataset. A complete file export reads the same saved source and streams every selected primary record.

After a completed build_market preview:

    node workbench.mjs handoff --source-root REPOSITORY_ROOT --dir WORKBENCH_DIRECTORY --preview BUILD_PREVIEW_ID --out NEW_DELIVERY_DIRECTORY --audience customer

This reconstructs that exact preview's immutable source revision, runs the full processor export and verifies the file inventory. Reopening the same completed handoff checks its original identities without another preview or provider request. Use --audience operator when the recipient should also receive private operator material and the complete original portable workspace.

For a standalone saved source directory:

    python3 processor.py export --workspace workspace.json --edition-id EXACT_EDITION_ID --out NEW_DELIVERY_DIRECTORY --audience customer

The customer folder contains:
- mapped-records.csv and mapped-records.ndjson — every selected primary record in original source order;
- market-summary.json and market-summary.html — processed counts, findings, comparison and coverage;
- source-index.json — original source and capture metadata identities;
- output-columns.json — exact customer labels/pointers and kind conventions;
- DELIVERY.md — the selected scope and receiving guidance.

The manifest records every file's size/SHA256, original edition/workspace identity, complete processed count, customer/excluded counts, source coverage and review readiness. Customer files exclude private reviewer identities and notes. Operator audience adds complete findings/symbols/changes/events files, private review decisions and source report.

Review readiness describes saved review and an explicit mapping. It does not change the original body/window coverage or prevent an explicitly chosen export. Reference observations stay out of primary customer rows.

## Portable handover and reopening

    node workbench.mjs export --source-root REPOSITORY_ROOT --dir WORKBENCH_DIRECTORY --out NEW_WORKSPACE.json
    node workbench.mjs import --source-root REPOSITORY_ROOT --dir NEW_RECEIVING_DIRECTORY --bundle NEW_WORKSPACE.json
    node workbench.mjs serve --source-root REPOSITORY_ROOT --dir NEW_RECEIVING_DIRECTORY

The original native portable includes saved application/capture files, every revision, retained previews and the existing release history. Source execution is not replayed by import. The original interpreter/runtime choice remains explicit on a different host.

Use the complementary exact-kind warehouse to stage complete customer deliveries, verify original CSV/NDJSON and metadata, perform a named expected-head selection/rollback, query exact cells, export complete or filtered selections, and backup/reopen. A new capture is a new delivery; it does not erase the previous customer selection.

## Integration

Public functions are inspect_market, build_market and customer_market. Their exact schemas, journals, normalized record and complete delivery contract are in CORE_CONTRACT.md. Acquisition formats and interruption recovery are in CAPTURE.md. The original source file limit is8MiB, revision limit32MiB, preview output1MiB and preview timeout120seconds. Choose complete actual partitions when a source exceeds the native limits; never truncate a source or label a prefix complete.
