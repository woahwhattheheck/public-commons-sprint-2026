# Source definitions in the DuckDB workspace

Open a completed dataset in the original [DuckDB customer workspace](DUCKDB.md)
to keep its field definitions available throughout review, analysis and delivery.
A source that includes an original `semantics.json` carries its labels, data
types, null rules, source field names, URI templates, keys and interpretation
notes into each reviewed SQL edition. The same workflow accepts an older
delivery without a dictionary.

The common [dataset semantics guide](SEMANTICS.md) explains the original
dictionary and source identity. DuckDB retains that exact file in its existing
edition file store. The analytical edition, imported rows, SQL view revisions
and saved queries continue to use the existing DuckDB implementation.

## Review the meaning with the mapping

In **Source delivery**, open the unchanged native delivery report or finalized
SF100 scan. **Source definitions** shows the checked dictionary beside the
proposed SQL mapping. Each row identifies the published field, the SQL alias,
a readable title and its original complete definition. Open a definition to
see its original provider field, projected definition, encoding, null behavior,
URI properties and interpretation notes.

Review the SQL type and alias in **Column mapping**. Changing a mapping updates
the displayed source-to-SQL relationship and invalidates the previous import
review. Create a fresh review and import that reviewed mapping. The source
definition remains attached to the published field even when its SQL name
changes.

**Source key** shows the published key. **SQL key mapping** shows which selected
aliases cover it. The key coverage indicator describes that mapping; actual
uniqueness and null checks use the record keys selected in the original import
review. A dictionary key is not silently made a database constraint.

Open an imported edition to inspect the same definitions and use **Download
original dictionary**. The download returns the exact received JSON bytes,
including their original file hash. It reads the edition's retained files, so
it works after the original delivery directory has been archived or moved.

An observation URI template still names the published fields. The SQL mapping
provides the corresponding aliases; the dictionary bytes and its templates are
not rewritten for a local analytical table.

## Query and receive a result

Activate the selected edition through the existing revisioned SQL view, then
run a preview or saved query. **Imported source definitions** lists the imported
editions referenced by the query. **Open source** opens their complete mapped
definitions.

The native DuckDB parser resolves relation names inside the query's original
read transaction. A relation that cannot be associated with an imported edition
is recorded in `unmapped_relations`. A dynamic relation that the native parser
cannot resolve has `resolved: false`. This result does not substitute every
active view as the query's source.

A full query export includes the original Parquet and CSV files, the saved SQL
and view bindings, and the dictionaries for its referenced source editions:

```text
result.parquet
result.csv
manifest.json
source-meanings/<edition-id>.json
```

The existing export manifest's `source_meanings` identifies each edition,
its source manifest, semantic definition, source capture, SQL aliases and
dictionary file descriptor. Its `files` inventory includes each exact
dictionary file. The normal hash-checked download API and the operator's
**Files** list receive them with the rest of the result.

These are the definitions of the query's input editions. The saved SQL defines
result columns and calculations. For example, `count(*) AS observations`
does not inherit the unit of a source measurement. A receiving analyst can
inspect both the exact source meanings and the original calculation.

The existing retained export request continues to own retries. Reopen the
original export or use its saved request ID after an interrupted response;
the query's execution record keeps the definitions bound to that execution.

## Compare editions

Select two editions and use **Compare definitions** to inspect changes in
source definitions, capture identity, SQL mapping, primary key, observation
URI and virtual fields. The field comparison includes the complete before and
after definitions alongside the before and after SQL aliases, types and null
rules. This comparison also works when the editions have different SQL key
names.

Use **Compare rows** for the original keyed row comparison. Its response now
also includes the source-definition comparison. Compatible reviewed keys,
typed row comparison, preview limits and full change counts keep their existing
behavior.

A mapping change and a source-definition change are distinct. Importing the
same source twice with different SQL aliases changes the local mapping while
retaining the same source definition and capture identities.

## Python and command line

The existing `DuckDBWorkspace` exposes the checked retained dictionary:

```python
from stellar_forge_buyer import DuckDBWorkspace

with DuckDBWorkspace("/absolute/private/customer-warehouse") as workspace:
    context = workspace.semantics(edition_id)
    original_bytes = workspace.semantics_bytes(edition_id)

    # A legacy edition returns None for both calls.
    if context is not None:
        field_mapping = context["columns"]
        source_definition = context["document"]
        original_file = context["file"]

    comparison = workspace.compare_semantics(before_id, after_id)
    preview = workspace.query(
        "SELECT count(*) AS observations FROM svk_capacity",
        max_rows=20,
    )
    source_meanings = preview["source_meanings"]
```

`edition(edition_id)` also supplies a compact `semantics` descriptor and
the full `semantic_dictionary` when present. The compact descriptor is stored
with the edition; the original dictionary bytes remain in the existing
`sf_files` and `sf_file_chunks` store.

The existing executable and Python module accept:

```bash
stellar-forge-duckdb --workspace /absolute/private/customer-warehouse \
  semantics EDITION_ID

stellar-forge-duckdb --workspace /absolute/private/customer-warehouse \
  compare-meanings BEFORE_ID AFTER_ID
```

Use the original `source-files` command to recover the complete source
delivery, including its dictionary. Use `handoff` for a portable warehouse
with editions, views, saved queries and all embedded source files.

## Existing local HTTP service

The original loopback service retains its capability, workspace identity,
private files and current operator ownership. These read methods are additive:

| Method and route | Result |
| --- | --- |
| `GET /api/editions/ID` | Original edition with checked mapping and dictionary when present |
| `GET /api/editions/ID/semantics` | Mapped source context, or JSON `null` for an older edition |
| `GET /api/editions/ID/semantics-file` | Exact `semantics.json` download; 404 when absent |
| `POST /api/compare-meanings` | Definition and mapping comparison for `{before_id, after_id}` |
| `POST /api/query` | Original preview plus `source_meanings` |
| `POST /api/exports` | Original retained query export with source dictionary files |

The original `HEAD` behavior applies to dictionary reads. Requests use the
existing `X-DuckDB-Capability` header and may bind the exact warehouse using
`X-DuckDB-Workspace-ID`. Source report checks, native MCP registration,
retained request IDs and the regular ranged export reader are unchanged.

## Complete receiving workflow

Use the installed source that contains this guide and the declared DuckDB
dependency. Keep the original finalized report and delivery at their retained
private locations while importing.

1. Open the source in the original local HTTP operator. Review every published
   field and retain an explicit SQL mapping. For the Svenska kraftnät example,
   map `observation_id` to `observation_key` and select it as the record key.
2. Create the original import review and import its immutable edition. Confirm
   its row count and source identities, then read and download the original
   dictionary through the local operator.
3. Activate the edition, run a saved query and receive the complete CSV,
   Parquet, manifest and dictionary files through the normal export reader.
4. If comparing mappings, create a second explicit review of the same source
   with a different non-key alias. Compare the definitions and the original
   keyed rows; a local alias change retains the source meaning and capture.
5. Prepare the original edition-source handoff and portable warehouse. Reopen
   the portable warehouse with the same installed engine, inspect the retained
   dictionary and run the saved query against its original view.
6. Reopen the original workspace and retained export. The source identity,
   dictionary bytes and saved logical operations remain available.

The executable [receiving example](examples/duckdb_semantic_receiving.py) uses
the actual local HTTP routes, original finalized input, native DuckDB engine
and retained export IDs to complete this workflow. It writes a single receiving
record with its source identities and actual output locations.
