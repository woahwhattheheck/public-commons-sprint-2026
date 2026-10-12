# Portfolio archive and reporting

This component extends the original PortfolioWorkspace and migration desk with a complete reporting cohort: selected project editions, a native field review, exact-grain measures, relational CSV and SQLite tables, a portable source archive, Power Query and SQL setup, and source-preserving receiving.

The same desk retains the original project files, companion captures, edits, target calls and source reviews. Open **Portfolio archive** in that running desk. The command-line operations below use its existing action IDs and recovery history.

## Select the original projects

Intake project files through the original Source section or existing intake action. MPXJ remains the native reader. For already-retired Project Online systems, use the customer's retained files and enterprise exports. An archive operation reads saved editions; it does not extract a retired service.

Choose one immutable edition per business project. Give it a stable project key and a readable label. A cohort can contain 1–500 distinct editions; the same edition cannot be counted twice as different projects. Use a separate cohort for another reporting date or alternative selection. The original source remains available alongside every following edition.

For each companion file, select its label, role, format, encoding, delimiter and JSON pointer before intake. The stored profile records those decisions. The Source page shows actual captured rows and column keys. A companion mapping names its exact capture, source identity column, native family and original target field. Key, UID and GUID matching remains confined to that original project edition. All mapped before and after values go through the original source review. Distinct captures of the same bytes use their full capture selector.

## Review fields and measures

Read the actual native field definitions for the selected editions. Standard available fields are used when columns are omitted. Explicit column selection supports up to96 fields per family; the full fields and field_definitions tables retain every captured field and definition regardless of that selection.

Choose one aggregation grain:

- **Project properties:** use the original singular project row.
- **Leaf tasks:** use native task rows after excluding summary rows and rows that are parents of another original task.
- **Assignments:** use original assignment rows, with their native task and resource links.

Each measure names an actual native field and its intended kind. Currency fields require the money kind; WORK, DURATION and DELAY require work; NUMERIC, INTEGER and SHORT allow number. Rates, percentages and resource units retain their complete original values in the fields table and do not become money or additive work through a numeric encoding. Conflicting native definitions across selected editions appear in the review.

Totals use Decimal on the original numeric text, with precision expanded for the complete sum. Native currency codes keep separate groups. When a source lacks a code, an operator can declare a three-letter currency with a concrete source note; otherwise that project's amounts remain in their own unspecified-currency group. Native duration units are preserved without an assumed hours-per-day conversion. Elapsed true, false and unspecified remain distinct. Missing, unsupported and excluded rows are reported with the complete per-row contribution records.

Save the cohort, review its complete projection, then publish that exact review with an operator name and delivery decision. An edited cohort requires a following review. The publication retains the original review digest, selected editions, source model identities, table row hashes and reporting approval.

## Native period reporting

The same cohort can include original MPXJ assignment work, cost and material values for explicit local reporting periods. Enable **Include native period reporting**, read the selected field definitions and choose periods/series before saving. The original native runtime calculates the exact selected edition; complete raw spans, effective calendars, dated resource rates, values/nulls and grouped totals travel with the archive. Portable receiving verifies that saved calculation and every projected row without a JVM.

[TIMEPHASED.md](TIMEPHASED.md) explains the full native period selection, assignment grain, units/currency/material grouping, table joins, exact SQL and original receiving continuation. Existing scalar metrics retain their selected grain and complete contribution tables.

## The delivered archive

The complete ZIP includes:

- Original selected editions, their source and parent editions, original reviews and native readback comparisons.
- Every referenced native project file and companion file, the exact captured models and complete JsonWriter output.
- Original MsPlanner capture pages, expanded collection continuations, combined native reader responses and probe objects when a selected edition came through the native target reader.
- CSV tables, a SQLite reporting database, an HTML report and a complete data dictionary.
- Power Query M, an Azure SQL table script and operating instructions.
- A manifest naming the exact byte count, SHA-256 and role of every member, with the original cohort review and approval.

The complete selected closure is included. Each source object remains named by its existing SHA identity. Original request records, broader company case records and unrelated projects are not pulled into the reporting cohort.

The table families are projects, tasks, resources, assignments, dependencies, calendars, fields, field_definitions, relationships, native_collections, sources, findings, companion_sources, companion_columns, companion_rows, companion_cells, companion_links, measure_totals and measure_contributions.

Entity IDs combine the original edition, family and source key. Relationships resolve native IDs within that edition only. Ambiguous or missing identities remain explicit rows and findings. Calendar relations use captured ProjectCalendar references or actual CALENDAR_UNIQUE_ID fields; calendar definitions and native detail collections remain complete. Companion records retain original line/record positions, column keys, exact JSON numeric text, and their mapping to original native entities.

## Inspect and query a publication

The Archive tab pages through a selected completed publication, supports text filtering and opens each complete row. Downloads contain all rows. The query preview returns up to250 rows; the full query export streams every result into an immutable CSV.

All relational columns use SQLite TEXT and CSV text. This preserves precision, original ISO dates, local times, native units, leading zeros, identifiers and complete JSON. The SQL interface allows read-only SELECT/WITH expressions over the declared tables. It disables writes and extension loading. Use decimal_sum for exact decimal totals, with explicit grouping by currency, unit and elapsed status:

    SELECT currency, units, elapsed, decimal_sum(total_text) AS exact_total
    FROM measure_totals
    WHERE metric = ?
    GROUP BY currency, units, elapsed
    ORDER BY currency, units, elapsed

Bind a text parameter such as ["current_cost"]. Do not combine rows from alternative grains or cumulative source fields without an explicit business decision. The contribution table provides the exact selected rows.

Power Query reads the original UTF-8 CSV using QuoteStyle.Csv, requires its complete expected header list and keeps columns as text. Select the unpacked archive folder, then choose the desired table from the generated query result. Apply business-specific currency/date conversions in the consuming model after reviewing their source definitions. The Azure SQL script defines the same text columns; run it in a selected existing database and load the original CSVs through the customer's approved import process.

## Existing CLI

Use the product root and its operator directory on PYTHONPATH, as for the original migration desk:

    PYTHONPATH=/path/to/project-portfolio-migration:/path/to/project-portfolio-migration/operator \
      python3 -m portfolio_target.cli --workspace /private/customer-workspace state

List source fields or saved cohorts:

    python3 -m portfolio_target.cli --workspace /private/customer-workspace \
      archive-fields <edition-sha256> [<another-edition-sha256>]
    python3 -m portfolio_target.cli --workspace /private/customer-workspace cohort
    python3 -m portfolio_target.cli --workspace /private/customer-workspace cohort <cohort-id>

The existing action command owns every mutation:

    python3 -m portfolio_target.cli --workspace /private/customer-workspace \
      action archive_save --request-id <retained-64hex-id> --arguments-file cohort.json

A cohort definition contains name, description, members and profile. Example members:

    {
      "name": "Completed customer projects",
      "description": "Preserve the selected closing editions for reporting",
      "members": [
        {
          "project_key": "customer-project-a",
          "label": "Customer Project A",
          "edition_id": "<actual-original-edition-sha256>",
          "currency": {"code": "GBP", "note": "Code confirmed from the retained project accounting export"}
        }
      ],
      "profile": {
        "metrics": {
          "grain": "leaf_tasks",
          "measures": [
            {"name": "current_cost", "field": "COST", "kind": "money"},
            {"name": "planned_work", "field": "WORK", "kind": "work"}
          ]
        }
      }
    }

Use actual fields shown by archive-fields. Omit currency when the native source supplies the code. Editing a cohort also passes cohort_id and its exact expected_revision.

Next action arguments are:

| Original action | Exact selected arguments |
| --- | --- |
| archive_review | cohort_id, expected_revision |
| archive_publish | cohort_id, expected_revision, review_sha256, reviewer, note |
| archive_query_export | cohort_id, publication_id, sql, parameters |
| archive_inspect | source returned by the original upload |
| archive_receive | source, manifest_sha256 from inspection, reviewer, note |

Read the same saved action with request <request-id>; resume it with request <request-id> --resume. A lost reply never needs a new action ID. The operation stores complete arguments and original results, and the cohort index includes the same request's immutable mutation receipt.

Read a table or query from a selected publication:

    python3 -m portfolio_target.cli --workspace /private/customer-workspace \
      archive-table <cohort-id> <publication-id> measure_totals --limit 50
    python3 -m portfolio_target.cli --workspace /private/customer-workspace \
      archive-query <cohort-id> <publication-id> --sql-file query.sql --parameters-file parameters.json

Copy any artifact using its actual returned SHA:

    python3 -m portfolio_target.cli --workspace /private/customer-workspace \
      artifact <sha256> --output /delivery/portfolio-archive.zip

## Receive and reopen

Upload a complete reporting ZIP through the Archive page or the original CLI's archive input:

    python3 -m portfolio_target.cli --workspace /private/received-workspace \
      upload /delivery/portfolio-archive.zip --archive

Use that exact upload result in archive_inspect, read the complete inspection, then pass its manifest_sha256 to archive_receive with the receiving operator and note. This admits archives up to8GiB and validates at most8GiB of complete uncompressed members. Individual project-file intake retains its original limit. Large CLI transfers and original object hashing use bounded chunks.

Receiving validates every member before original object adoption, rejects path/member aliases, restores the exact native records and objects, verifies SQLite integrity/schema/row hashes, then recalculates the reporting projection from the restored native editions. The same archive's byte identities and the same request remain stable through interruption. Source objects use their original store IDs; cohort publication, incoming review and receiving decision remain distinct retained records.

The new cohort opens in the same Archive tab. Original models and source files can be inspected without the initial upload paths or remote target credentials. Already completed receiving returns the original receipt before touching removed intake files. The broader original portable-workspace export remains available for a full operator workspace handover.

## Native receiving continuation

native/receive.py and native/browser.mjs extend the original equipped portfolio receiving operation with the reporting workflow. They consume actual editions from that operation, preserve deterministic original action IDs and checkpoints, exercise the full CSV/SQLite/query/package/source-absent receive path, and use the same authenticated browser and original action API. Keep the parent operation's selected MPXJ runtime, source fixtures and provider custody.
