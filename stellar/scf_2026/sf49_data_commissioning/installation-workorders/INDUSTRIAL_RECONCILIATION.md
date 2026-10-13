# Industrial reconciliation installation

This programme takes one customer's actual industrial source and comparison contract through the existing commissioning, customer data and Installation applications. It delivers an editable customer operation: retained source editions, reviewed interpretation, complete reconciliation, engineering decisions, full reports and independent receiving.

Select the maintained profile `industrial-reconciliation`. It uses the original dynamic workorder catalogue, source preparer, Workshare seed, Installation preview/save and whole-case importer. It does not require a separate catalogue, commercial planner, database engine or request journal.

The profile is useful for a selected Timescale deployment and for an already received local source/target pair. The commercial Workshare determines which source, customer, phases, reviews and correction allowance are included. Keep the complete original contract in the Installation. A reusable profile does not select a customer deployment, grant funding, payment network or production permission.

## 1. Select the complete original customer work

Begin with the existing operating case and its pinned plan. Receive the original commercial Workshare commissioning document and its matching complete case packet. Preserve their original bytes and every selected source file.

The original source reader binds the commercial case, plan digest, fee, currency, status, milestones, phases, dependency order and explicit production effort. The Installation adds task, source, receiving and actual deployment/payment selections around those original terms. Its phase checks retain the original acceptance wording.

Use the existing Installation if this commercial case already has one. A later source edition belongs in that Installation's original history. An unrelated customer uses its own commercial case.

Record these selections before commissioning:

| Selection | What the operator must supply |
| --- | --- |
| Customer task | The actual decision or recurring engineering work supported by the comparison. |
| Original Workshare | Complete original case packet, commissioning input, case ID, plan digest, every phase and numeric effort source. |
| Deployment | Actual merchant and independent customer deployment IDs from the existing operating case. |
| Source authority | The customer's source-use rights and permitted database/query/file population. Commercial implementation rights alone do not select a production dataset. |
| Two editions | The complete original baseline and observed source or customer editions, with their native identities and scope. |
| Interpretation | All source fields, native types, units, NULL/empty meaning, tag/event/time identity, value and quality mapping. |
| Comparison | Matching keys, complete nonoverlapping windows, literal maps and any explicit normalization/tolerance. |
| Receiving | Actual private host, customer workspace and named engineer who can reopen the full operation. |
| Commercial and native payment | Original implementation fee/milestones; separately, any actual acquisition unit, network, asset, recipient, exact atomic price, aggregate budget and authority. |
| Ongoing operation | Source owner, production approver, cadence, release and backup owner, correction/support scope and escalation. |

Unselected fields stay visible in the native preparation and preview findings. Saving a `PLANNED` Installation is useful before these selections are supplied. Keep all acceptance checks open until the original operator has the required actual observations.

## 2. Prepare original Workshare sources

The maintained source preparation accepts the complete original case packet and explicit numeric effort references. It verifies the same Workshare plan using the native SF47 reader and creates the two documents consumed by the original Installation receiver.

Installed entry:

```sh
starforge grant-installation-workorder profiles

starforge grant-installation-workorder sources \
  --selection /absolute/private/SOURCE_SELECTION.json \
  --source-root /absolute/private/original-customer-files \
  --out /absolute/private/prepared-installation-source \
  --python /absolute/path/to/python3
```

Equivalent maintained source entry:

```sh
node stellar/scf_2026/sf49_data_commissioning/installation-workorders/prepare.mjs sources \
  --selection /absolute/private/SOURCE_SELECTION.json \
  --source-root /absolute/private/original-customer-files \
  --out /absolute/private/prepared-installation-source \
  --python /absolute/path/to/python3
```

The input is `stellar-forge.installation-source-selection.v1`. Retain its exact `operationId`, `requestPrefix`, observation time, source URL and complete selected case list. Each case selects `profile: "industrial-reconciliation"`, its unchanged complete packet and canonical Workshare plan SHA-256.

Every original file selection includes its relative source path, chosen receiving basename, full byte count, SHA-256, source URL, original observation time and media type. The preparation reads regular files within the original source root, verifies their exact bytes and preserves them. It does not reconstruct the commercial packet from a summary.

### Effort comes from explicit original values

For each original phase, supply one `productionEffort` row with its exact `phaseId`, decimal-string `hours`, `sourcePointer`, `unit` and `basis`. When the numeric value is in a companion JSON file, also supply that file's selected `sourceFile` basename. Otherwise the pointer addresses the original Workshare plan.

The complete `effortTotal` uses the same explicit pointer contract. Every phase must be selected exactly once; its declared hours must equal the original value; phase hours must sum to the original complete production effort. A numeric field in an original commercial allocation JSON is suitable. A number inferred from prose or a rewritten phase estimate is not.

Partner review/decision time remains in the original partner responsibilities unless the commercial source explicitly assigns it to the supplier's production effort. Do not add it to a supplier total merely because the partner participates in the same project.

### Complete preparation outputs

The original preparer writes a private, create-only selection and all selected full source files, then:

| Output | Retained meaning |
| --- | --- |
| `SOURCE_SELECTION.json` | Exact original preparation input. |
| `Supplier_Workshare_Commissioning.json` | Complete original Workshare plans with every selected effort value and its source. |
| `Supplier_Complete_Receiving_Packets.json` | Complete original matching case packets. |
| `SUPPLIER_RECEIVING.json` | Full input for the existing Installation receiver, including every declared file and profile. |
| `SOURCE_PREPARATION.json` | Original native reader/profile identities, full source bindings and actual prepared result. |

The historic `Supplier_` filenames are the existing engine's output names for all installed profiles. Keep them unchanged. Source preparation creates no operating case, payment, acceptance observation or customer data edition.

Reopening identical preparation uses its retained input and files. A changed packet, effort selection or profile uses a distinct selected preparation directory; preserve the earlier output.

## 3. Open the original Installation

Use the existing **Customer installations** desk in the selected SF47 operating case. Select the original commissioning source and full packet, choose the commercial case from its native inventory, and prepare its Workshare seed.

The source-based CLI exposes the same original selection:

```sh
python3 stellar/scf_2026/sf47_budget_model/workspace/cli.py operations \
  --workspace /absolute/private/original-operations-workspace \
  installation-workshares \
  --case ORIGINAL_OPERATION_ID --expected-version ACTUAL_VERSION \
  --source ORIGINAL_COMMISSIONING_SOURCE_ID \
  --expected-source-sha256 ORIGINAL_COMMISSIONING_SHA256 \
  --packet-source ORIGINAL_PACKET_SOURCE_ID \
  --expected-packet-sha256 ORIGINAL_PACKET_SHA256 \
  --output /absolute/private/original-workshares.json
```

Use the returned complete inventory to select the original commercial case. Prepare its original native seed with `installation-workshare-seed`, the same case/version/source/hash fields and `--workshare-case ORIGINAL_COMMERCIAL_CASE_ID`. A new Installation uses `--expected-revision 0`; reopening an existing one supplies its original `--installation` and current revision.

Generate and edit the binding template:

```sh
starforge grant-installation-workorder template \
  --profile industrial-reconciliation \
  --seed /absolute/private/original-installation-seed.json \
  --out /absolute/private/installation-bindings

starforge grant-installation-workorder prepare \
  --profile industrial-reconciliation \
  --seed /absolute/private/original-installation-seed.json \
  --bindings /absolute/private/installation-bindings/bindings.json \
  --out /absolute/private/prepared-installation
```

The template binds the exact original case and plan edition. Supply actual selected source/authority, deployment, native payment and receiving values. Blank technical fields retain the maintained profile instructions; they do not provide evidence that the customer selection is complete.

Preparation retains `installation-input.json`, `installation-preview-input.json`, the full readable `WORKORDER.md` and `preparation.json`. Open the complete Installation input in the existing desk, choose **Preview**, review its full original Workshare and pending selections, then **Save** through the native original request.

Keep the Workshare's original `workorder`, `assignments`, `workshare`, phase checks and newer coordination/workflow fields. The profile changes the technical task/source/receiving instructions; it does not rewrite the original fee, payer, effort or phase acceptance.

If the original case or plan changed, obtain its new complete seed. The preparer rejects a stale binding. The receiver uses the actual current case version and native revision checks; do not replace those values with remembered ones.

## 4. Receive actual industrial source data

There are two supported intake routes. Choose the one that describes the original source in the agreement.

### Route A — original Timescale commissioning report

Open the selected original Timescale workspace with its actual PostgreSQL source configuration. The database owner supplies the meaningful tables/queries, time and source population, connection authority, refresh/job settings and permitted production actions.

Use the original commissioning desk to retain the actual source editions and observations. Run only the selected original plan/actions under that workspace's exclusive owner. For a contracted refresh, job or late-data change, retain the original before/after/later editions and actual result. A previously prepared demonstration or a report from another deployment does not supply customer commissioning evidence.

Export the complete immutable commissioning report from the original source. Preserve its exact bytes and filename, all declared original native source text, ordered columns/OIDs, raw text/NULL values, row counts, report/workspace/source IDs and history. The native Timescale intake reads this own format directly. It does not pass through an invented SF88/SF100 purchase or delivery record.

In the customer's existing DuckDB application, open **Timescale intake**. Select that original report file. Upload retains the complete file hash and original request identity. Read the complete report, choose each actual baseline/observed source, and preview its native values. The report's full source binding stays with the reviewed import.

The current producer table bound is 6,291,456 UTF-8 bytes, 512 columns and one million rows. A customer source beyond the actual supported bound requires an explicitly reviewed upstream scope or product change; a truncated preview is not a complete source. The comparison editor has its own 64-field and 32-window limits. Check the selected release's native validation before agreeing the actual population.

### Route B — original local-source/customer editions

For a selected local descriptor and CSV/TSV/JSON/Parquet resources, use the maintained Frictionless capture and publication workflow. Preserve the original descriptor, all resource bytes, licenses/source references, interpretation and complete reviewed candidate. The native local-dataset customer receiving continues the original publisher preview through every required cursor page into the genuine finalized SF100 store, then the original DuckDB review/import.

An already received original customer edition can be selected directly from that warehouse's complete catalogue. Keep its actual edition and source history. An arbitrary source/target CSV does not become an SF100 delivery by renaming a report.

The original customer warehouse may carry the complete finalized native delivery while the upstream descriptor/resources live in the separate source export. Include those original upstream files in the whole handover when this route requires them. Do not claim the warehouse alone contains upstream originals that the chosen source adapter did not embed.

### Review every field before import

For both routes, the field schedule covers every original field exactly once with a unique destination name and a reviewed native type. Preserve original raw text when a typed conversion is not lossless or its meaning remains unresolved.

Timescale intake preserves duplicate observations by requiring empty import keys. Use `keys: []`. Pairing keys are selected later in the reconciliation definition. The source import must not discard duplicates or reject them merely to force one-to-one comparison.

Record tag/event identity, timestamp representation/zone, value and quality meaning, units, NULL and empty text explicitly. A source column name does not establish its semantic role or timezone.

Review the complete native conversion before import. Verify the original review ID, manifest SHA, ordered columns, keys, complete row count and source binding against the imported immutable edition. Retain the whole successful original result before refreshing catalogues. A later catalogue-read error must not cause another import.

## 5. Review the complete baseline and observed pair

Open **Dataset reconciliation** in the original customer warehouse. Select both actual immutable editions from their full catalogue. Preserve their original order and identities.

Define:

- The exact canonical field names and all original source/target columns.
- Matching-key fields and compared-value fields, including quality where it matters.
- A reviewed literal value map when an exact source spelling must map to a canonical VARCHAR key/value.
- The window field, exact bound strings and complete nonoverlapping windows.
- An explicit normalization policy only where the original units/time representations require it.
- An explicit numeric comparison rule only for eligible compared values.

Keep NULL, empty text, an unmapped literal and a missing original observation distinct. Literal maps do not imply whitespace trimming, case folding, numeric rounding or a default mapping.

Without normalization, the two native SQL types of a mapped field must match. Every omitted source field remains visible in the original source and review. The mapped comparison scope must be sufficient for the agreed customer task; omission is a selected scope decision.

Matching keys stay exact. Duplicate keys remain complete multiset groups. The engine does not pair duplicate rows by arbitrary order, and it does not describe a blocked ambiguous counterpart as an absent source record.

Choose **Review mapping** after the complete definition is entered. Review original source scope, ordered field types, meanings, omitted fields, mappings, windows and every policy. Save only that native-reviewed definition. Editing any of these choices invalidates the earlier review.

## 6. Normalize units and time explicitly

Open **Unit and time normalization** for a selected mapped field when needed. The rule is retained in the full definition, native review, pair revision, run and report.

### Exact numeric scale and offset

For an eligible compared value, select the original unit, nonzero scale and offset for each side, one canonical unit, and an exact canonical SQL type: BIGINT, HUGEINT or DECIMAL(p,s) within the native precision limit.

The operation is:

```text
canonical value = original value * selected scale + selected offset
```

Coefficients are literal decimal strings. Conversion uses exact rational arithmetic and must fit the selected target type exactly. It does not round, saturate or silently produce a DOUBLE. A native DOUBLE input retains its actual binary value, which may not be an exact decimal despite a short decimal display.

Keep every original value beside its canonical result. Overflow, unsupported precision, invalid source text and other failed conversions remain traceable and quarantined. Numeric normalization applies to compared values; it does not make an approximate matching key.

### Reviewed UTC timestamps

A timestamp rule can apply to a matching key or a compared value. Select the original representation for each side: supported native date/time, explicit source text or epoch unit. Supply its actual timezone basis. Naive date/time input requires the chosen fixed offset; offset-aware input must retain the embedded offset according to the native contract.

The canonical type is TIMESTAMPTZ at exact microsecond precision. The engine does not assume the machine's timezone, infer a daylight-saving region from a label or discard a nonzero submicrosecond remainder.

A reviewed UTC key may make different original timestamp spellings represent the same instant. Inspect the resulting full duplicate groups. If timezone or precision cannot be resolved, keep the conversion failure visible.

### Review both complete previews

After selecting a normalization policy, use the existing **Preview conversions** controls for each side and field. Follow every native page needed for the complete selected population; filters describe only their selected subset.

Inspect original SQL type/value, exact arithmetic, canonical type/value, state and reason. Conversion counts are field-value counts. They do not replace the full source row accounting. Save the pair only after the actual source meaning and the complete failure population have been reviewed.

A window uses the reviewed canonical type. UTC-normalized window bounds are explicit TIMESTAMPTZ strings; a numeric window uses exact canonical numeric bounds. An unnormalized VARCHAR window remains lexical. Record that lexical basis only when string order is the intended contract.

## 7. Select numeric tolerances without losing differences

Open **Comparison rule** for an eligible numeric compared-value field. Matching keys and timestamps do not accept a numeric tolerance.

Retain exact nonnegative decimal strings for the absolute and relative allowance, a nonblank comparison unit and the source/acceptance basis. The relative allowance is at most 1. If numeric normalization is selected, the comparison unit must equal its canonical unit.

The maintained symmetric rule is:

```text
signed difference = target - source
absolute difference = abs(target - source)
relative scale = max(abs(source), abs(target))
permitted difference = absolute allowance + relative allowance * relative scale
within tolerance = absolute difference <= permitted difference
```

Absolute and relative allowances add. A zero or opposite-sign value still uses the original exact arithmetic. Preserve the signed and absolute difference, both original values, canonical numeric representations, scale and allowance in the complete result.

Keep **exact equality**, **within tolerance**, **difference**, **NULL treatment** and **not comparable** distinct. An explicit rule's NULL policy is part of the reviewed contract. A missing/non-numeric/nonfinite or failed-normalization input does not become zero. Read its actual native field state and conversion reason.

The profile does not set a tolerance for the customer. The customer/source engineer must select one from the actual value type, units and acceptance contract. Changing a tolerance requires a new reviewed pair revision and remains visible in later report comparison.

## 8. Operate the complete reconciliation

Run the saved original pair revision. Retain its original request ID and result before derived reads. The native run materializes the selected source observations once and keeps the complete rows, groups, field differences and conversions.

Review the following together:

| View | Meaning and required review |
| --- | --- |
| Full row accounting | Both sides' complete input totals balance to included, quarantined and excluded rows. Matched/unmatched accounting also remains explicit. |
| Key groups | Complete key multiplicity and actual group category. Duplicates remain multiset groups; unique-pair arithmetic is not applied to an arbitrary duplicate. |
| Original rows | Every original observation with source/edition/row provenance, mapping/window selection, status and raw values. |
| Field differences | Complete eligible singleton comparisons, original values, canonical values when normalized, exact signed/absolute difference, allowance, rule and native state. |
| Normalizations | Every normalized field of every original observation, including converted, NULL and failed values and their reasons. |
| Outside-window and quarantined rows | Retained full populations with actual exclusion/failure reason. They are not silently discarded. |
| Decisions | Actual engineer disposition, owner, reason, source reference and retained sequence. |

A filtered grid is a view of the original run. It does not change its complete result. Page through the original native response and use the complete export for review of the full population.

Use group, field and conversion inspection to open the original row. For a normalized field, the displayed original source text remains original; exact differences describe the selected canonical values. The complete result preserves both.

Do not infer that a source migration is correct solely because all eligible unique pairs are within tolerance. Review complete accounting, duplicate/unresolved groups, quality interpretation, coverage and excluded windows as part of the actual acceptance.

## 9. Record decisions and complete reports

An engineer decision is a retained annotation on the original finding. Record the actual operator, rationale, source reference and disposition. A decision does not alter the source dataset, run values or production database.

Create the complete report from the selected run. It freezes:

- Original immutable source editions and pair revision.
- Full mapping review, normalization and numeric comparison policies.
- Complete summary and decision sequence.
- Saved native query identities, revisions and exact parameter text.
- Complete groups/rows/decisions, field differences when present and normalizations when present.
- An optional original baseline run for full finding changes.

A later report comparison checks the ordered canonical key contract and exposes source, mapping, window, canonical-schema and normalization-policy changes. It also compares actual canonical value multiplicities, so changed values remain visible even when a category and row count are unchanged.

A finding absent from a later selected scope is reported as absence. Calling it corrected requires the matching source scope and actual supporting evidence.

Saved query execution and export use the original ordered `expected_views`, retained query revision and literal `parameters_text`. Keep decimal parameters as exact strings with explicit SQL casts when required. Do not reconstruct exact numeric parameters through browser numbers.

## 10. Export and independently reopen the customer operation

Choose the original complete report export. Keep its retained request and every declared file. Query directories may each contain their own `manifest.json` or `result.parquet`; preserve the full relative paths.

The complete package includes the frozen report and native query/export/source bindings, all declared complete result files, the checkpointed warehouse and receiving instructions. A normalized report carries the full normalizations query/export; a run with comparison rules or normalization carries complete field differences.

Use the original typed client for a large package so all files and saved range checkpoints travel together. The browser still exposes the whole manifest and individual original downloads.

Inspect and receive the complete package through the maintained receiver:

```sh
python3 -m stellar_forge_buyer.reconciliation.package inspect \
  --directory /absolute/private/received-package \
  --manifest-sha256 ORIGINAL_COMPLETE_MANIFEST_SHA256

python3 -m stellar_forge_buyer.reconciliation.package receive \
  --directory /absolute/private/received-package \
  --destination /absolute/private/reopened-project \
  --manifest-sha256 ORIGINAL_COMPLETE_MANIFEST_SHA256 \
  --workspace-id ORIGINAL_CUSTOMER_WORKSPACE_ID
```

Use the actual result's returned working-copy path. Retain the received original package and warehouse; operate the separately received editable copy. Do not replace or repair the preserved original database with a later working copy.

Open the received customer workspace through the same installed product. Confirm the original customer UUID, editions, pair revisions, runs, normalizations, numeric rules, decisions, report digests, saved query revisions and complete file sets. Carry any required upstream descriptor/resource archive beside it.

The receiving engineer then performs the agreed useful operator task on that reopened workspace: open the selected pair, inspect full rows and exceptions, open its exact report, and make a deliberate next draft or report according to the retained change process. This is the editable customer handover, not merely a copied ZIP.

## 11. CLI, MCP and typed client

The complete source and request shapes are in the maintained product guides linked below. The following commands operate the existing customer warehouse:

```sh
python3 -m stellar_forge_buyer.duckdb_cli \
  --workspace /absolute/private/customer-workspace reconcile status

python3 -m stellar_forge_buyer.duckdb_cli \
  --workspace /absolute/private/customer-workspace reconcile review \
  --definition /absolute/private/complete-definition.json

python3 -m stellar_forge_buyer.duckdb_cli \
  --workspace /absolute/private/customer-workspace reconcile save-pair \
  --request-file /absolute/private/original-save-pair.json

python3 -m stellar_forge_buyer.duckdb_cli \
  --workspace /absolute/private/customer-workspace reconcile run \
  --request-file /absolute/private/original-run.json
```

The CLI request files carry their original workspace, request and revision identities. MCP mutation bodies omit the CLI/HTTP `workspace_id`: the original adapter supplies its registered, pinned customer identity. Keep the original request/revision/definition/digest fields. Export/continuation bodies differ from pair/decision/report bodies; use their actual maintained schemas.

Reconciliation uses the original `sf43_discover_review_and_pay` tool with `action: "duckdb"`, the registered `duckdbWorkspace` alias, `duckdbOperation` and its full `duckdbRequest`. The installed typed module is `./buyer/duckdb/reconciliation` and opens through `openDuckDBReconciliationClient({client, workspace, expectedWorkspaceId})`.

The existing DuckDB MCP adapter exposes `reconcile-review`, `reconcile-normalization-preview`, `reconcile-save-pair`, `reconcile-execute`, `reconcile-groups`, `reconcile-rows`, `reconcile-row`, `reconcile-fields`, `reconcile-normalizations`, `reconcile-decide`, `reconcile-save-report` and `reconcile-export`, with their existing original request/status/file operations. Use the registered customer alias and pinned customer workspace. Opening another endpoint does not change the expected workspace binding.

The typed client has `normalizationPreview(definition, {side, column_name, offset, limit})`, `fields(runId, {group_id, column_name, state, offset, limit})` and `normalizations(runId, {side, column_name, state, group_id, offset, limit})`. Follow each native returned `next_offset`; these are original full result pages. Returned numeric values and arithmetic are exact strings.

The browser, CLI and MCP paths share the same original model and requests. Choose the actual operator surface needed by the customer; do not create separate mutable versions of the same operation for each surface.

## 12. Receive the complete Installation programme

After preparation, the existing whole receiver attaches every exact source file to the selected original operating case, resolves its current native version, obtains the original Workshare seed, previews and saves the Installation, exports the complete case and imports it into a distinct receiving workspace.

```sh
node stellar/scf_2026/sf49_data_commissioning/installation-workorders/receive.mjs \
  --operations-cli /absolute/selected-source/stellar/scf_2026/sf47_budget_model/workspace/cli.py \
  --workspace /absolute/private/original-operations-workspace \
  --case ORIGINAL_OPERATION_ID \
  --plan ORIGINAL_PLAN_ID \
  --inputs /absolute/private/prepared-installation-source/SUPPLIER_RECEIVING.json \
  --source-root /absolute/private/prepared-installation-source \
  --out /absolute/private/industrial-installation-receiving \
  --receiving-workspace /absolute/private/independent-operations-workspace \
  --actor ACTUAL_INSTALLATION_OPERATOR \
  --receiving-actor ACTUAL_RECEIVING_ENGINEER \
  --python /absolute/path/to/python3
```

The installed equivalent is `starforge grant-installation-receive` with those same options.

Use the existing programme owner's actual current workspace and plan. Preserve its selected source release and all other customer Installations. If receiving a previously exported programme instead, import its complete original archive through the maintained importer and retain the returned programme identity and lineage before continuing.

The receiver's `RECEIVED.json` records actual original/receiving cases, Installation IDs/revisions/hashes, complete export and pending selections. Preserve all complete returned export contents. The receiving process does not transform a planned Installation into an accepted customer deployment.

## 13. Interruption and change handling

Inspect the original request before any continuation. A completed original result remains the result even if a subsequent catalogue refresh failed. Retain its IDs and exact input; resume the existing operation through its supported route.

For Timescale upload, keep the original report file and SHA. An incomplete retained request can continue only with its exact original bytes and original request identity. A completed retained upload can serve its authenticated original report bytes for receiving.

For pair/run/decision/report work, the existing UI retains complete request bodies before dispatch. Explicit continuation uses the same original ID and body. A GET or page reload does not replay a write. Original export recovery uses the export journal and its own exact destination/request binding.

For native Installation receiving, identical source files are reused by their native hash/media binding. Current case conflicts are resolved through the original version/revision checks. Existing customer Installations keep their original editable document and operated checks. A new source selection or intentional profile/binding change gets a distinct preparation/receiving selection while retaining the earlier history.

Keep uncertain source, payment or dispatch outcomes visibly uncertain until the original owner reconciles them. Do not overwrite partial source files, invent a successful receipt or issue another paid acquisition to compensate for a lost response.

## 14. Continuing ownership and acceptance

Hand over the actual selected deployment and release, source/configuration references, permitted queries/resources, two-edition scope, units/time/quality interpretation, original requests and all complete packages.

Name the source/database owner, production change approver, merchant/acquisition operator, customer analyst and receiving/support engineer. Record:

- Source cadence and the actual trigger for the next useful comparison.
- Who reviews schema, population, normalization and tolerance changes.
- Approved refresh/job/late-data actions and how their original results are retained.
- Backup, restore, retention and access renewal for both source and customer workspaces.
- Monitoring, rollback, escalation and the agreed correction/support period.
- Vendor/infrastructure licenses, operational responsibilities and separately scoped future deployments.

Complete the original phase checks with real operator observations and source references. Preserve the customer's commercial state separately: a prepared or saved workorder is not a signed agreement, invoice, payment or accepted production result.

## Maintained source and operator references

The profile's `sourceFiles` lists the exact original guide identities used for this programme. Full current source entry points:

- [Timescale original workspace and commissioning](../../../scf-starforge-20261009/sf30-seller-sdk/postgres/timescale/README.md).
- [Timescale source intake and full receiving](../../../scf-starforge-20261009/sf88-operator-buyer-cli/python/stellar_forge_buyer/timescale_intake/OPERATING.md).
- [Paired reconciliation, normalization, tolerances and portable handover](../../../scf-starforge-20261009/sf88-operator-buyer-cli/python/stellar_forge_buyer/reconciliation/OPERATING.md).
- [Frictionless source workspace](../../../../stellar-forge/mcp-merchant-operator/FRICTIONLESS_WORKSPACE.md).
- [Data commissioning programme](../README.md).
- [Original Installation preparation and receiving](README.md).
- [Complete customer programme ownership and operation](CUSTOMER_PROGRAMMES.md).

Select actual release/source identities from the installed programme before customer commissioning. The instructions remain reusable; the customer's source bytes, commercial terms, production authority and observed native outcome always come from its own original operation.
