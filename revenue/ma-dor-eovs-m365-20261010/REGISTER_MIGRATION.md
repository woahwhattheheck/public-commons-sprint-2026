# Register migration workbench

## Complete supplied populations in the existing workspace

The register extension adds explicit person, case, episode, relationship, placement or financial register interpretations to the maintained Migration Workbench. Names and fields are operator choices. It retains the original uploaded bytes, every original source occurrence, complete mapping and all result editions in the same SQLite workspace. It uses the original source import, operation journal, kernel lease, browser server, export generator and portable application.

The existing case/document, grant, financial reporting, source, reconciliation and correction features remain callable. Use the whole current application. The public module and guide are generic; private customer records and commercial correspondence belong in their original private workspaces and cases.

## Source and projection

First import the complete supplied CSV or JSONL through original source.import. Select the original source_inventory or target_inventory role, source scope, identity namespace, capture timestamp, capture kind, declared coverage and scan mode. A CSV import still needs the original canonical column map, for example source_id to the actual original key column. This map satisfies original inventory intake; the new projection reads every complete raw original CSV cell or JSON property.

For register.dataset.create select source_id, a stable flat register name, exact source or target system label, side, explicit field definitions and ordered key_fields. Every identity component is exact text, so "001" differs from "1". Scope and namespace are retained independently of those values. No person linkage, identifier stripping or clinical mapping is inferred.

Each field definition has selector, type and optional required. selector is exactly {column:"original heading"} for CSV or {pointer:"/original/path"} for JSONL. type is text, decimal, date, datetime, boolean or json. required defaults false. Explicit value_maps replace only an exact original string with an operator-selected string or boolean and retain both values.

Text remains exact. Boolean requires an actual boolean or an explicit value map. ISO dates are calendar-validated; datetime requires an explicit offset and normalizes to UTC while retaining the original. Fractional precision beyond six decimal places is accepted only when every additional digit is zero; otherwise the projection is invalid/UNKNOWN, preserving the full supplied lexeme for explicit review. Decimal accepts an exact finite decimal token, up to 1000 coefficient digits and exponent magnitude 1000, preserving sign and avoiding binary floating-point arithmetic. Internal normalized expansions and accumulated sums use a separate exact canonical-decimal parser, so a valid original exponent is not rejected merely because its expanded representation exceeds the original coefficient bound. Decimal totals retain every signed value and perform no currency conversion, rounding or implicit scale change. Structured JSON uses recursive type tags, so an original object cannot impersonate a numeric token.

Missing, null, blank and invalid fields remain distinct. Preview and saved projected rows include complete values, presence, raw typed originals, conversions, issues and source references. Duplicate logical keys retain all occurrences. A corrected interpretation selects parent_dataset_id and creates another immutable dataset. Original source and earlier mappings stay accessible.

## Plans, relationships and independent rehearsals

A plan selects complete source_dataset_ids from one scope and namespace, one exact destination system per register, cutoff_at and max_snapshot_age_seconds. The latter defaults to zero. Each register must have consistent complete canonical field/type/required definitions and ordered identity fields across selected projections.

checks explicitly selects mapped nonidentity fields. When omitted for a register, all mapped nonidentity fields are compared. Both nulls or equal blanks can match only for optional fields; absent or invalid evidence remains unresolved. Different empty strings remain different, even though both are blank. Original typed values stay available.

references select id, register, ordered fields, to_register, complete ordered to_fields, required and cardinality. Each original referring row supplies one scalar text composite identity. A relationship table can represent many explicit edges through its own stable keys. Both one and many retain the declared cardinality, but duplicate referenced logical identities remain ambiguous; this option cannot waive duplicate identities or infer people. Optional references can be absent. A partially supplied composite identity stays unresolved.

The source plan checks the supplied relationships and source evidence. A rehearsal independently selects target_dataset_ids whose register definitions, scope and namespace match the plan and whose system labels equal its declared destinations. Loader success is not a target inventory.

Source captures must be at or before cutoff within the selected age. Target captures must be at or after cutoff. A conclusive missing/unexpected occurrence or relationship requires a usable logical identity, supported referring evidence and independently declared complete/full inventory. Invalid keys, unresolved projection, mismatching row counts, partial/incremental evidence and stale captures remain UNKNOWN for absence claims. Known observed field differences stay visible as their own findings.

Every planned register has an intrinsic kind:control finding with details.type:population, even when both selections contain zero rows and no optional financial controls are configured. Its structurally distinct key ["register_population"] and full dataset/capture/coverage evidence remain visible in plans, rehearsals, comparisons, reports and cutover review. Complete empty source and target populations can match; an omitted, partial, stale or otherwise unresolved population stays UNKNOWN.

Record, reference and control items preserve all original occurrences or complete immutable population selections. Status labels are MATCH, DIFFERENT, UNKNOWN, AMBIGUOUS, MISSING and UNEXPECTED. Read the actual per-check reasons and evidence together with the overall label.

## Exact signed controls

controls select id, register, decimal measure_fields, nonempty text unit_fields and optional scalar group_fields. Select actual currency/unit fields and meaningful account or period groups from the supplied source contract. Separate measures and distinct units are never silently combined.

The engine streams complete groups from the same SQLite projected rows. Each control retains explicit source/target dataset IDs, group fields and values, row counts, unresolved-row counts, exact observed signed sums and a digest of every complete projected row in deterministic dataset/ordinal order. The immutable dataset readers and exports retain the full constituent rows. A control does not duplicate a large complete register into one table cell.

Complete population comparison is withheld if any selected row has invalid identity, duplicate key, unresolved projection/capture, missing measure or unit/group, or if declared complete/full coverage is unavailable. Rows with unavailable unit/group fields remain in their original null bucket. Their rule-wide unallocated_group_row_counts independently block conclusive comparisons in every known group on that side: a value without a currency cannot certify the GBP subtotal merely by being excluded from it. The observed sums remain labeled observed_sums so operators can inspect supplied values without treating an incomplete subtotal as a certified population total. Each exact measure and the population count have their own check.

## Correction, comparison and cutover review

An immutable successor plan or rehearsal retains its selected predecessor. register.rehearsal.compare requires the same scope, namespace and complete canonical definitions; its complete paged result carries both item bodies and both policies. Entering or leaving a selected result is not a deletion instruction. Changes to source evidence, cutoff, relationships or controls remain explicit.

A review selects one exact rehearsal item, a disposition, full reason and optional original evidence rows. A successor must follow the current unsuperseded review tip. rework, waiting_evidence, accepted_variance and withdrawn remain distinct immutable decisions. A withdrawn acceptance cannot waive a subsequent approval.

A cutover selects the complete rehearsal IDs, hold/ready_for_review/approved, reason, acceptance_owner and current accepted_review_ids. Approval requires every original nonmatching item to have a selected current accepted variance; every such reason and complete original finding is retained. This is an attributed local review. Supplier migration execution and actual customer acceptance use their original contracts and authority.

New reviews and cutovers validate actual current tips while the existing workspace mutex is held through immutable publication. If a previous request already published its exact entity, original same-request recovery adopts it before checking later history. Otherwise an interrupted request cannot publish an approval based on a superseded historical tip.

## Requests, history, pages and full delivery

Use the original /api/operations {operation,payload} and /api/read. Mutations carry operation_id, expected_revision and actor. Exact successful replay precedes current revision checking and returns its original completion revision. Refresh current state before the next new mutation. Resume interrupted operations through original operation.resume with the original handler and payload.

A source-dependent interrupted operation pins this module plus the original source parser, case-value helpers and Store bodies before retaining rows. Complete prefixes are compared byte-for-byte on recovery. Partial rows cannot be read as a completed dataset or result because readers first require its immutable entity.

register.schema advertises the current complete API. register.list, register.dataset.rows, plan.items, rehearsal.items and rehearsal.compare use explicit offset/limit, maximum 500, and return total. Source drilldown uses original row.get and source.get. Complete exports go through the existing locked workspace.iter_export generator and migration_reports.iter_register_export as register.dataset, register.plan, register.rehearsal, register.review and register.cutover, with ndjson or csv. Reports include full descriptors and complete result rows, not only the visible page.

The existing portable pipeline preserves the original SQLite, every source object, full reports, requests and selected application roster. Its new roster must include migration_registers.py, public/migration-registers.js and this guide. Earlier complete editions keep their exact original profile and roster; they are not relabeled as a new application. Re-receiving an identical earlier archive preserves later legitimate customer history.

## Commissioning inputs

An actual customer programme supplies the original private case, exports, fields/identity rules, independent target returns, explicit system labels, time/cutoff evidence, coverage declarations, signed money/unit/period conventions, relationship rules, real reviewer attribution and target execution/acceptance contracts. Public procurement and supplier descriptions inform the operating profile; they do not supply a tenant schema, credentials, actual customer rows or an executable loader contract.

A software example, if run, is labeled as an authored example. Actual receiving must select complete real original inputs, perform the reviewed source-to-target programme, retain two source/target editions where required, reopen reports and portable customer returns, and save its full actual result before claiming completion.
