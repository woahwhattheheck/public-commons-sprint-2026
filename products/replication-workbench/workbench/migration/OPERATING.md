# Airbyte to Sling migration engine

The migration engine imports an existing Airbyte connection, compiles a separate Sling target, compares complete typed data, and prepares reversible downstream changes. The workspace and command-line application use the same engine and the same immutable plan edition.

The engine uses Node.js built-ins and the workspace's retained original Linux filesystem lease. Run the complete workspace on Linux with Node.js and flock available. The real replication uses the selected original Sling executable and its named connections. The workspace retains the selected executable, original source files, native command result, complete exports, comparison and downstream editions together.

## Run the application

Run the command from the complete workshare component:

~~~sh
node migration/cli.mjs help
node migration/cli.mjs connections --input connection.json --output selected-connections.json
node migration/cli.mjs compile --input connection.json --options bindings.json --output migrations
~~~

Compilation writes a directory named by the exact plan ID, containing plan.json, review.json, input-selection.json, comparison-queries.json and, when the selected configuration is ready, replication.yaml. The directory retains the exact connection/options file identities. The native document is JSON, which is accepted directly by the original Sling YAML reader; string identifiers are therefore always explicitly quoted.

The native command in the selected plan is:

~~~sh
sling run -r replication.yaml
~~~

The workspace runs that command with the selected original executable, named connections, private writable target, original input copies and complete stdout/stderr. The connection names in the document refer to the selected Sling environment. Credentials remain in those existing connections.

A successful compilation exits 0. A retained plan or comparison that needs a specific adaptation exits 2 and gives the actual issues. Invalid input, a failed file operation or an unexpected application error exits 1 with a structured message.

## Import formats and connection selection

Supported inputs are the current public connection API response, the legacy configuration API connection response, an Airbyte configured protocol catalogue, a Terraform connection resource, terraform show -json output with recursive child modules, and raw Terraform state with indexed resources.

Public API stream settings are under configurations.streams. Legacy configured streams retain both stream and config. A configured protocol catalogue retains stream plus sync_mode, destination_sync_mode, cursor_field and primary_key. The importer reads the declared format and preserves the original mode rather than treating all three shapes as interchangeable.

Terraform state can contain several connections and unrelated credential-bearing resources. List the candidate connections first, then select one exact connectionSelector. The normalized plan retains the selected connection's digest and its source/destination IDs; it does not copy unrelated state. Mapper parameters remain in the original imported document; the plan retains their type, field names and digest.

Camel-case and snake-case aliases are supported. Conflicting simultaneous aliases produce a precise error. Stream identity is the JSON encoding of its namespace/name pair, such as the two-element array ["public","orders"]. An absent or empty namespace is represented consistently as an empty string. Duplicate stream identities or connection selectors are rejected.

When the public API export omits discovery metadata, pass discoveryCatalogue in the bindings. The original discovered schema, default cursor, source-defined cursor and source-defined primary key are then joined by the exact stream identity. A source-defined cursor takes precedence over a configured cursor according to the original Airbyte protocol.

## Semantic mode mapping

| Original source / destination behavior | Automatic native mode | Retained detail |
| --- | --- | --- |
| full_refresh / overwrite | full-refresh | Separate target replacement |
| full_refresh / append | snapshot | Full repeated loads, including native ingestion metadata |
| incremental / append | incremental | update_key, with no primary-key upsert |
| incremental / append_dedup | incremental | update_key and every original primary-key component |

The current public API and Terraform provider expose nine combined mode names. All nine are decoded to their original source/destination pair. full_refresh_overwrite_deduped, full_refresh_update, full_refresh_soft_delete, incremental_update and incremental_soft_delete require a selected native adaptation because a four-case translation does not establish those semantics.

An explicit nativeStreamOverrides entry contains a reason and its original native stream configuration. It can select full-refresh, snapshot, incremental, truncate, backfill, definition-only or change-capture. It can supply the documented selection, SQL, keys, columns, transforms, source options, target options and change-capture options. The workspace still owns connections, target object and operation execution.

File movement, destination data activation, configured mappers and declared log-based CDC also require an explicit native adaptation. The original settings remain visible in the review so that the implementation can preserve their actual behavior.

### Keys and cursors

Airbyte primary keys are arrays of field paths. Two one-component paths identify a composite key; one two-component path identifies one nested field. The engine preserves that distinction. A nested path needs one explicit fieldColumns binding, using its JSON Pointer spelling, to an actual native source column. It is never silently flattened into a different composite key.

A missing incremental cursor is an actionable adaptation. An existing source-defined log position is not guessed to be a timestamp. For append_dedup, every selected original primary-key component must be resolved. Field selection is checked against the keys and cursor.

Sling derives the next incremental read from the target's maximum update_key. Equal-timestamp updates, late data and backdated changes therefore need the selected replay or lookback behavior. A custom incremental SQL body must contain the original Sling incremental placeholder. The full reference programme retains the baseline, source change, second native execution and complete target comparison so that an unsuitable cursor becomes visible in data.

## Bind source and target objects explicitly

Required bindings are sourceConnection and targetConnection. SQL dialects are selectable from postgres, sqlite, mysql, sqlserver, snowflake, bigquery and duckdb. Identifiers are quoted for the selected dialect.

streamBindings selects sourceRelation, previousRelation and parallelRelation as arrays of exact identifier components. Names containing periods remain single identifiers when provided as a single component. Explicit bindings avoid assuming that a source namespace is the actual destination namespace.

The importer retains the original namespace definition, custom format, destination prefix and legacy alias. A custom namespace format expands the original SOURCE_NAMESPACE variable and reports any unresolved variable. A separate parallel namespace or explicit parallel relation must be selected. Colliding destination relations are reported across all selected streams.

A relation matching the previous target requires targetDistinctFromPrevious to be explicitly true, indicating that the named target connection is a different destination. Source/target connection names never imply that distinction by themselves.

Selected streams appear in selectedStreams; every configured stream left outside this migration appears in preservedStreams with its reason. The original schedule, status, connection IDs and operation IDs remain in the plan for the actual scheduler/connection cutover.

## Complete typed observations

The observation document has schema slingdata.migration-observations.v1, the exact planId, one phase (baseline, incremental or rollback), and exactly one record for each selected stream.

Each stream record contains streamId, left, right and native. Each side retains the complete native column list, every row, and its original export source. A source identifies kind, path, SHA-256 and recordedAt; rowCount and complete:true are supported and checked against the supplied data. The native record identifies commandId, exitCode, startedAt and completedAt.

Rows are arrays aligned with the observed columns. Every value is typed:

| Cell type | Retained representation |
| --- | --- |
| null | An explicit null cell with no value |
| text | Exact string, including empty strings and whitespace |
| integer | Exact integer string |
| decimal | Exact decimal string, including exponent notation |
| boolean | The string true or false |
| date | Valid Gregorian YYYY-MM-DD |
| timestamp | Complete timestamp with its original offset or absence of offset |
| binary | Canonical padded Base64 |
| float64 | The original eight IEEE-754 bytes as 16 big-endian hexadecimal digits |

JSON numbers are not accepted as typed values. This preserves large integer and decimal precision. Integer signs/leading zeroes and numerically equivalent decimal spellings are normalized exactly without conversion through JavaScript Number. NULL and an empty string remain different. Floating-point bytes preserve signed zero and the actual retained representation.

Default timestamp comparison preserves the original lexical representation. An explicit timestamp cellTypes binding compares offset-bearing values by their exact second and fractional text while retaining the distinction between an absolute instant and a timestamp with no zone. It does not assume the local machine's time zone. Date, integer, decimal and boolean conversions likewise require explicit column bindings and exact compatible source values. A float64 is not silently rounded into a decimal.

columnMaps.left and columnMaps.right map canonical business-column names to exact observed names. They also control the generated comparison SQL. businessColumns can explicitly select the intended business schema. Otherwise, the complete observed union is compared after only the declared metadata exclusions.

The default Airbyte metadata exclusions are listed in the plan, and snapshot mode adds the native ingestion timestamp to the right-side exclusions. Any additional native column requires an updated selected plan or a declared metadata decision. A business field cannot also be treated as excluded metadata.

Run the comparison:

~~~sh
node migration/cli.mjs compare --plan migrations/PLAN_ID/plan.json --observations complete-observations.json --output comparison.json
~~~

The report compares every row and its multiplicity, independent of order. It retains missing/additional row counts, complete multiset digests, null-key counts, duplicate-key groups, cursor values, native schema differences, original source identities and the original command result. Examples are limited for readability; counts and comparison still include all rows.

The schemas retain exact declared types and known domain properties. Type aliases within the same type family are visible as differences. Cross-family conversion needs the explicit cellTypes binding; known narrowing of nullability, precision, scale or maximum length remains an error.

readyForCutover is true only when the exact selected plan is ready, every selected stream is present, complete business data agrees, schema comparison is compatible, primary-key upsert constraints hold, and the native command completed successfully. The report also exposes equal separately so that a data result remains understandable when another part needs work.

The plan and comparison identify their complete contents with deterministic hashes. A changed document must become a new edition; editing a ready flag while retaining its previous digest is detected.

## Review and change downstream consumers

Inventory selected complete UTF-8 files before choosing edits. The inventory identifies exact Airbyte metadata and old-relation occurrences, with source digests and line/column locations. It reports literal references; the operator selects the intended replacement and its reason.

The consumer file input is a JSON object mapping relative paths to complete file contents. Edits are an array of path, find, replace, expectedOccurrences and reason. The engine checks exact occurrence counts in the selected edition, applies the edits in order, and retains the complete before and after contents.

~~~sh
node migration/cli.mjs inventory --plan plan.json --files consumers.json --output inventory.json
node migration/cli.mjs downstream --plan plan.json --comparison comparison.json --files consumers.json --edits edits.json --output changes.json
node migration/cli.mjs apply --changes changes.json --root consumer-directory
node migration/cli.mjs restore --changes changes.json --root consumer-directory
~~~

A change plan can be drafted before the comparison. Its readyForApply field becomes true when it is bound to the successful exact comparison. The workspace's connection-binding switch is a separate operation and does not require irrelevant text edits.

All plans for one consumer root share the original kernel lifetime lease; per-plan journals remain separate. The lease ends when its helper process exits. Applying a plan checks every current file against its retained edition before writing. Each replacement is written to a temporary file, flushed, checked again and atomically renamed. The full change plan and operation journal remain under the selected consumer directory. A partial operation restores the files it changed when their selected editions still match; a concurrent edit is preserved and identified for the next selected plan. An interrupted original operation can resume from the retained before/after states under the same consumer-root lease.

The apply/restore API also accepts an optional operationId, and the CLI accepts --operation-id. Repeating the same completed operation returns its original saved result. An unfinished original operation resumes from its exact file states while retaining its earlier attempt journal.

Rollback restores the original consumer files, original routing and selected schedule through the workspace. Both original and parallel data targets remain available. Restoring routing does not attempt to reverse changes in an external source database.

## Original implementation sources

SOURCE_REFERENCES.json records the original Airbyte SDK, protocol and configuration-mapping source identities and the selected original Sling source. The automatic four-case mapping follows Sling's migration guide; the other current Airbyte modes come from the original Airbyte models and mapper.

The original Sling CSV inputs used by the workspace programme have different final columns. The receiving workflow retains both complete original inputs and explicitly selects the evolved source schema and cursor; the importer does not invent a replacement field to make them appear identical.

For large external databases, the selected native export process must provide complete exports from the same source observation boundary. The engine compares the supplied full rows in memory, with memory proportional to their distinct exact row values. It never substitutes a row-count sample for the complete business comparison.

## Receiving an existing completed consumer operation

Pass the original `operationId` when recovering an acknowledgement. A completed journal is immutable: the engine returns its original completion with `replayed: true` and a separate `current` observation. That observation includes `observedAt`, `selectedEdition` (`after` for apply, `before` for restore), `matchesSelected`, and every selected file's expected/current SHA-256, byte size and state. A missing, unreadable, invalid UTF-8 or changed current file makes `matchesSelected` false. Recovery observes those files under the original consumer lease without replaying edits or rewriting the previous completion.

Fresh completions also return this current observation with `replayed: false`. A workspace that captures files after this call must compare the bytes it actually captured with every selected before/after SHA-256. Preserve a mismatch as current consumer drift and retain the original completed result separately; do not label later files as that operation's output. This second comparison matters because an independent editor can change a file after the engine releases its lease.
