# IATI publisher finance workspace

This operator turns complete IATI 2.03 activity XML into retained activity, transaction and budget datasets, saved portfolio revisions, source comparisons, review reports and a complete receiving workspace.

It uses the existing XML source parser, retained Workspace, original SF30 immutable dataset engine, private operator server, Merchant Source Workspaces and installed Applications lifecycle. The IATI-specific code supplies domain projection and portfolio decisions to those components.

## Operator workflow

1. Retain the publisher's complete XML file. Source identity is the SHA-256 of its exact bytes.
2. Review the source profile: activity and financial record counts, reporting organisations, currencies, financial groups, identity findings, language and sector associations.
3. Save a portfolio selecting its complete source editions and optional activity, currency, transaction-type, budget-type and date criteria. All three native datasets are built from the same selection definition.
4. Read the full records and finance report. Record the named review on a new portfolio revision.
5. Retain a later publisher edition and update the portfolio using its current revision. Compare the earlier and later revisions; inspect the original full field changes and source coverage.
6. Export a complete report, a native dataset for merchant publication, or a complete portfolio handover. The recipient imports the complete portfolio packet, reopens its revision history and reconstructs the original datasets and full reports.

See [OPERATIONS.md](OPERATIONS.md) for browser, installed application, CLI, MCP and managed lifecycle commands, and [DOMAIN.md](DOMAIN.md) for financial interpretation and source references.

## Source-owned components

| Component | Responsibility |
| --- | --- |
| iati_source.py | IATI associations, exact decimal fields, documented defaults, identities, projections and full-source inventory |
| iati_workspace.py | Saved portfolios, request replay, revision checks, finance reports, comparisons and complete receiving |
| server.py and public/ | Original private server with the IATI operator interface |
| cli.py and cli.mjs | Python operator commands and installed Node entry point |
| managed.py | Managed application startup and process identity |
| client.mjs and client.d.mts | Operator API client and its public types |
| distribution/runtime-workspace/providers/iati.mjs | Installed Applications contribution through the existing provider lifecycle |
| distribution/contributions/iati.json | Installed source and runtime contribution |

The base workspace keeps sources, mappings, builds and comparisons in its existing SQLite database. IATI adds portfolio revision, request identity and portfolio-comparison tables to that same database. It creates no alternative query engine or parallel application controller.

## Python API

Open IatiWorkspace(root, create=True) for a new private workspace or omit create to reopen it. Close the workspace before another operator acquires it.

The inherited add_source, save_plan, build, query, compare, comparison_page, export_dataset and export_packet methods retain their native contracts. import_packet accepts both an original complete dataset packet and a complete IATI portfolio packet.

IATI-specific methods are presets(), profile(source_id), portfolios(), portfolio(id, revision=None), history(id), save_portfolio(request), report(id, revision=None), compare_portfolio(request), write_report(id, output, revision=None), export_portfolio(id, output, revision=None) and receive_portfolio(path).

A portfolio request contains requestId, name, sources and optional notes, selection and review. A revision edit also includes id and expectedRevision. Reusing an identical requestId returns its original revision even after subsequent edits. Reusing it with different input fails.

Selection uses exact activityIds, currencies, transactionTypes, budgetTypes, dateFrom and dateTo. Empty arrays mean no filter. Activity context remains available when financial filters are applied. Transaction dates and budget overlap have separate meanings described in DOMAIN.md.

The optional review is an object with status (draft, reviewed or needs-correction), reviewer and note. A named reviewer is required for the two reviewed dispositions. A new source/selection edit starts as draft unless its request explicitly supplies the review.

## Complete handover

A portfolio packet includes every revision through the selected revision, the request identities associated with those revisions, all saved portfolio comparisons, every distinct original native dataset packet referenced by that history, and the complete selected report.

Each nested native packet retains the original XML source, mapping, CSV, dataset definition and native review. The outer manifest names and hashes every member. Receiving verifies the whole archive, reconstructs each original native dataset and comparison, regenerates every report file, and then publishes the complete portfolio history in one SQLite transaction. An interrupted preparation can be retried through the same packet and request identities.

The report contains printable grayscale HTML, structured JSON, complete activity/transaction/budget CSVs with source IDs, all review findings in JSONL, comparison summaries and every full native field-change file. Browser pagination does not reduce exported records.

Native dataset exports produce data.csv, dataset.json and iati-lineage.json for the existing SF30 dataset/merchant publication workflow. The complete portfolio packet separately carries the publisher source and review history needed for customer receiving.

## Runtime and capacities

The source engine requires Python with Expat 2.6 or later and the original Node SF30 dataset engine. It accepts self-contained XML and rejects DTD/entity/external-resolution input through the shared parser. Source and native CSV limits follow the existing engine: 256 MiB per source, one million projected rows at most, and at most 1 MiB per projected cell. The default edition is 250,000 rows and 64 MiB. A single activity has the existing 16 MiB working-text capacity.

A portfolio can select up to 32 complete sources and one million distinct activity IDs. Complete handover capacity is 4 GiB expanded, with a 64 MiB capacity for each JSON metadata member, including the full revision history. Exceeding a declared capacity produces an explicit failure; exporters do not cut off records or silently shorten history.
