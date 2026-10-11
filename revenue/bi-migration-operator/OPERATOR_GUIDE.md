# Operating the BI migration and support workspace

## 1. Establish the report family

Import actual Cognos exports in **Inventory**. Batch import accepts report XML, Framework Manager XML, data module JSON and dashboard JSON. Each source retains its original bytes and parsed query structure. Assign its owner, wave, priority and business use.

Open **Details** to obtain the workspace source ID. Usage import joins on that ID. Map the input CSV headers to source_id, runs and period. Unmatched usage rows remain attached to the import.

For each report family, retain the report parameters, date range, source snapshot, output columns, refresh behavior, access requirements and receiving owner.

## 2. Review and bind the model

Choose **Plan migration**. Review the original findings and record implementation decisions. Examine prompts, filters, joins, set operations, aggregate behavior and calculations.

| Binding | Input | Native result |
|---|---|---|
| Imported CSV | Exact imported dataset and explicit null token when used | Complete local CSV, typed Power Query and portable DataRoot |
| SQL Server table/view | Server, database, schema and physical object | Native Sql.Database access |
| SQL Server query | Server, database, reviewed SQL and named parameters | Native query preserving the reviewed text and parameters |
| Power Query | Full reviewed M expression | Literal-preserving native M in the partition |

Cognos logical query names remain source structure. Enter physical connections explicitly.

Expand **Native model and calculations** to edit names/types, DAX measures, relationships, pages and visual bindings. Save a revision before building. Missing references, duplicate fields, unknown properties and incomplete bindings are rejected.

**Save & build native Power BI project** records the exact source digest and plan revision. Previous builds remain available when the plan changes.

## 3. Open, refresh and retain actual outputs

Extract the native project into its final directory. Run prepare_project.py or OPEN_POWER_BI.ps1. Open the PBIP in Desktop, configure source credentials, refresh and exercise each page under the agreed report scope.

For a published model, **Power BI capture** accepts native workspace/model IDs and a token environment variable name. Return one result table. Apply filters and parameter values in the DAX query; the separate parameters field records the run context.

The capture saves the original Microsoft response, complete CSV with explicit null markers, query, parameters, scope, timestamp and optional artifact reference. Native errors, additional result tables, nonscalar cells and null-marker collisions are reported. Zero-row captures require exact output column names because the endpoint may return no schema for an empty result.

Use deterministic partitions with retained parameters when a report exceeds the native endpoint's row/value/response limits.

For the public example, capture-query.dax projects all 5,037 offense cells and their original identity. Compare to expected-native-rows.csv in data.zip with native-comparison.json. Query report aggregates separately using the actual reviewed measures and filters.

## 4. Compare and correct complete outputs

Import the original and target CSVs in **Data & corrections**, including scope, source URL and any explicit null token.

In **Output comparison**, choose the baseline and target, map fields and select unique baseline key columns. A typical mapping is:

    {
      "keys": ["source_record_id"],
      "null_token": "\\N",
      "fields": [
        {"left": "source_record_id", "right": "[source_record_id]", "type": "text"},
        {"left": "value", "right": "[value]", "type": "number", "absolute": "0", "relative": "0"}
      ]
    }

Map all required acceptance fields. An empty mapping compares every same-named baseline field as text. Without keys, the comparator preserves complete row multiplicities. Numeric tolerances require unique keys.

The result counts all missing rows, extra rows, different cells and duplicate keys. It retains the first 500 detailed examples and the complete source/target files; the display limit does not limit the comparison.

To correct an input, find its exact data row. Search scans every row and preserves original row numbers. Select a cell, enter the expected original value and reviewed replacement, and explain the correction. The original remains intact; a linked dataset contains the correction.

Open the original comparison, choose the corrected target and select the linked correction option. The baseline digest stays the same. A changed baseline belongs in a separate comparison.

The public example preserves publisher discrepancies and source exceptions. Keep any deliberate operator-workflow exercises identified as copies.

## 5. Deploy and resume the original Fabric operation

Prepare production SQL/M bindings and existing service connections. Enter the existing workspace, model and report IDs. The rollout proceeds through four stages:

1. Capture the current semantic model definition.
2. Capture the current report definition.
3. Update the semantic model from the selected artifact.
4. Update the report and bind it to that model.

Each advance persists intent before a provider write. Microsoft operation IDs and retry information remain attached to the rollout. Continue the original operation after the provider's indicated interval.

After an uncertain response, use **Inspect native state**. The service retrieves the definition and compares it with the intended definition. Attach an original Microsoft operation ID when available. Transient polling errors preserve that ID.

After inspection establishes the outcome, a reviewed retry can be requested on the same rollout, with its reason in history. Reconcile active or unresolved writes before rollback.

**Prepare original-definition rollback** creates a linked recovery workflow from the predeployment definitions. It supports completed deployments and settled partial failures. Reopening preserves definitions and provider IDs.

The operator updates existing-item definitions. Manage tenant roles, licenses, source credentials, gateways, refresh schedules and role membership in their native Microsoft settings.

## 6. Support and handoff

Keep the report family's support cases in the same workspace. Record the owner, service, severity, due time, actual impact, reproduction and resolution. Attach the source and artifact concerned.

In **Handoff & recovery**, select the exact artifact, relevant comparisons and cases, and receiving-owner instructions. The ZIP includes:

- Original source and reviewed plan.
- Complete native Power BI project and bound local CSVs.
- Selected original/target outputs and comparisons.
- Selected support cases and a complete file manifest.

Previous handoff ZIPs are not recursively embedded. The receiving team can open the project and inspect scope, decisions and output differences without the original operator process.

## 7. Back up and reopen

Use a passphrase of at least 12 characters in the interface, or run:

    python BI_OPERATOR.py --workspace ./bi-workspace backup ./workspace.bi-backup

The command prompts for the passphrase. The backup contains a consistent SQLite checkpoint and all referenced immutable objects. AES-256-GCM authenticates the archive; PBKDF2 derives the key. The passphrase is not saved.

Stop the host, then restore into a new destination:

    python BI_OPERATOR.py restore ./workspace.bi-backup ./restored-workspace
    python BI_OPERATOR.py --workspace ./restored-workspace serve

Restore authenticates the archive, checks paths and the complete database/object closure, and publishes a new directory without replacing an existing one. Business IDs, history and provider operation IDs remain. Browser access rotates; use the new URL.

Backup exports sit outside the immutable object set, so backups do not recursively embed previous backups.

## 8. Structured actions and concurrency

Every mutation carries a stable operation ID. Replaying a completed request returns its original result. A different payload cannot reuse that ID. Revision checks prevent stale edits from replacing newer work.

The CLI accepts the same actions:

    python BI_OPERATOR.py --workspace ./bi-workspace action source.import request.json
    python BI_OPERATOR.py --workspace ./bi-workspace state

Each request is a JSON object. File imports use filename and complete base64 bytes. Business actions use exact record IDs/revisions. The action contract is defined in bi_operator/service.py and native deployment actions in bi_operator/providers.py.

Use **Activity & versions** after a lost browser response. **Retry original request** reuses its operation. A host shutdown drains accepted work before closing the database. One process owns each workspace; separate workspaces run independently.
