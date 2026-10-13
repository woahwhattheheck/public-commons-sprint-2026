# Forms migration workbench

TokenJunkieLabs (TJLabs)

## The complete operating course

This workbench retains an explicitly selected source and returned target, compares the complete declared CSV populations through the maintained migration calculator, checks original attachment bytes and parent records, and packages the entire project with its selected executable source. The local workspace opens every retained asset and finding. The original migration inspector supplies full record, mapping, source and dimension-total views.

A project has six distinct asset classes: definitions, settings and dependencies, responses, uploaded files, workflow and review history, and downstream integration results. Select include, exclude or defer for each class and record the actual scope and supported route. The software preserves these decisions alongside all supplied originals. It does not turn a copied definition or a response export into an assertion that all six classes migrated.

The ordinary workflow is:

1. Retain complete authorized exports, files and original request/result material. The adjacent capture program supports documented read-only routes and authorized local originals.
2. Write an explicit intake with exact file identities, the complete CSV source manifest, field/key interpretation, asset-class bindings, selected whole-file comparisons and exact attachment parent links.
3. Run the native workbench into a new immutable project.
4. Open its private workspace, inspect the complete results and original files, and follow the linked migration inspector for full field/key reconciliation.
5. Save a complete revised intake when source meaning, scope or returned data changes. Run it as a new edition while retaining the earlier one.
6. Pack the complete project, independently receive it, and rerun using the executable workbench and original retained bytes inside that received package.

The selected field mapping is a vendor-neutral preparation and reconciliation contract. Where a platform has a supported historical import or vendor migration service, its owner executes that route and returns the actual staging export and receipts for comparison. The program performs no vendor write, workflow replay, production cutover or external notification.

## Runtime and complete source

The calculator and localhost server use Python 3.11 or newer and its standard library, including SQLite. The optional browser receiving helper uses the receiver's already installed Node, Playwright module and Chromium binary. No dependency installation or hosted CI is part of the operating course.

Keep all 26 selected application and guide files together. The complete application inventory is declared in forms_workbench.py and recorded in every result. It includes the unchanged maintained discovery engine, original migration calculator/server/inspector, all API guides, this workbench, the read-only collector and both complete receiving helpers. The source pack includes the original MIT license and TJLabs attribution.

The program binds the exact selected application bytes into each project. Reopening a case with its server or packing it requires that same complete source. A corrected application receives its own new project edition; it must not silently replace the calculation or rendering source in an existing immutable project.

## Capture the actual originals

Read FORMS_CAPTURE.md before selecting a vendor export. The public FormAssembly API documents form definitions, response export, connector/theme reads and a two-step attachment ZIP retrieval. The response ZIP endpoint can return a relative uploads/get_zip path, which is then read from the same selected tenant. A ZIP filename is not an attachment-to-response mapping.

The public reference does not define the full response JSON shape or a general historical-response import contract. The collector retains the whole original CSV, JSON or XML response. It does not guess an undocumented JSON record envelope, flatten repeated structures, fabricate a tenant or invoke a historical import.

Pagination selection must name the actual source range. CSV row counts do not establish API response counts: repeated sections can produce additional CSV rows. Current export files can also omit values from earlier revisions of a field. Preserve explicit source/revision coverage, the selected response IDs or reviewed page inventory, and the original captured result of every requested page. A complete set of acquired files remains distinct from complete historical coverage.

For workflow history, in-flight work, settings dependencies and downstream effects, include the actual supported exports and receipts. The documented FormAssembly public API FAQ says that API does not pull Workflow data. The ordinary workflow CSV has its own window, truncation and file-body limits; an operator can include an alternative supported full export without changing the workbench's source contract. Preserve all original bodies and their provenance.

Official vendor references:

- https://github.com/FormAssembly/formassembly-api
- https://help.formassembly.com/help/340336-export-troubleshooting
- https://help.formassembly.com/help/workflow-response-export
- https://help.formassembly.com/help/form-transfer-tool

The API README was read from official Git blob 45c1369e687e0e9f73ec919accb3a521379b8316. Product entitlement, export permissions and a particular tenant's current behavior belong to that actual selected environment.

## Describe the complete intake

FORMS_INTAKE_API.json documents the full input. The root schema is tjlabs.forms-workbench.intake.v1. Give the edition, label, actual data class and original interpretation reference. The allowed data classes are DEMONSTRATION and AUTHORIZED_CUSTOMER_EXPORT. A demonstration is explicitly invented and stays separate from customer observations.

### Six selected asset classes

The classes object must contain definitions, settings, responses, uploads, workflow and downstream. Each has disposition include, exclude or defer and a nonempty reference explaining the selected scope and supported route. Additional metadata such as supported_route, reviewer, decision_reference and source_revision is preserved.

A deferred or excluded class remains visible in the result and complete archive. Its originals are still retained when supplied. Changing a disposition does not delete prior files, waive a required outcome or record a human acceptance.

### Whole original inventory

Each assets entry has a unique portable id, asset_class, side (source, target or shared), availability, original filename, media_type and provenance.

For a PRESENT original, path is a relative path under the selected input root, and bytes plus lowercase SHA256 must identify its complete exact body. The program streams that body to its retained location and verifies the count and digest. Paths cannot escape the selected root or traverse symbolic links. Binary files, empty files, quoted multiline CSV, Unicode and opaque original vendor formats remain byte-exact.

MISSING or REDACTED availability identifies a declared body that cannot be retained completely. Such an entry has no path. If a redacted file itself was acquired, retain that actual file as PRESENT and set content_state to REDACTED. The body and its meaning are different facts.

content_state is COMPLETE, PARTIAL, REDACTED or UNASSESSED; the default is UNASSESSED. It records the original owner's source coverage assessment. A full downloaded file may still be a partial export. This value must not be upgraded merely because the file digest matches.

The program records actual_bytes, actual_sha256, retained_path and table_ids for every asset. Original filenames stay in metadata. Controlled retained paths avoid collisions between different files with the same original name.

### Complete CSV comparison

discovery_manifest is the unchanged commons.discovery.cohort-manifest.v1 structure, including every selected CSV table, original columns, types, null rules, keys, foreign keys and ownership. Its edition and data class must match the outer intake. table_assets binds every table ID to exactly one PRESENT original CSV asset. The workbench rewrites only the retained file paths when preparing the original engine input.

migration_selection is the unchanged tjlabs.migration-reconciliation.selection.v1 structure. It names source and target keys, explicit one-to-one crosswalks where needed, complete field meanings, null handling, exact numeric transforms, tolerances and comparison dimensions. pair_classes assigns every pair to one of the six asset classes. The source and target tables must bind to originals of that same class and their respective source/target sides. Each selected asset is tracked individually: an unrelated comparison elsewhere in the class cannot cover it.

All rows in each named CSV participate. An operator must explicitly model repeated sections and parent identifiers in that source schema. The software does not turn repeated lines into independent responses, fill omitted parent values, deduplicate records, infer a timezone or collapse blank and null according to an unstated rule. The original migration guide explains duplicate, invalid, unkeyed, unmatched and crosswalk classifications.

Every numeric comparison uses the maintained exact rational engine. Full row and dimension-total populations remain in JSONL/CSV and disk-backed indexes, with a paged browser. Aggregate agreement does not replace record-level comparison.

### Whole-file comparisons

file_comparisons names an id, asset_class, source_asset, target_asset and reference for each explicitly selected byte-equivalence comparison. The original source and target declarations must belong to that class and their respective sides.

A MATCHED whole-file finding means equal complete bytes and SHA256. DIFFERENCE means the selected files differ. It does not interpret XML behavior, equate rewritten identifiers or decide that a changed definition is acceptable. For structured equivalence, supply an explicit supported CSV projection and original mapping while retaining the opaque original as well.

Unavailable bodies receive an explicit finding. A filename or successful HTTP status never substitutes for the original bytes.

### Attachments and actual parent records

Each attachment entry has a unique entry_id and an explicitly reviewed logical_id used to pair its source and target. Supply side, asset_id (or null for a declared missing body), availability, canonical form_key, response_key, field_key, ordinal, filename, media_type and reference.

The parent object names an actual table, one-based data record ordinal, key_columns and exact raw key_values. The table must belong to an original on the same side as the attachment. Its expected asset_class defaults to responses; another class requires an explicit parent.asset_class and parent.reference explaining that relationship. Source and returned-target parent records cannot substitute for one another. The header is not data record 1; a quoted multiline CSV field stays inside one data record. The program reads those original raw key fields through the maintained SQLite record representation. A missing record, malformed link or unequal raw key becomes a parent finding. Original normalization does not conceal a wrong raw parent link.

Canonical form/response/field keys and ordinal are owner-supplied mapping decisions. The program compares them exactly between source and target. It does not derive a canonical identity from an attachment filename, ZIP directory, field caption or coincidental equal bytes.

attachment_comparison explicitly selects whether filename and media_type must also match and supplies its interpretation reference. Complete byte count, digest and canonical parent relationship are always compared. A source or target with multiple entries for the same logical_id remains ambiguous. Every original member of that ambiguous group receives a finding and the full group counts.

A selected upload original without any declared parent link leaves the uploads class unexamined. Complete bytes alone cannot close an attachment relationship.

## Run a new edition

Choose a new output directory outside the source and input directories:

    python forms_workbench.py run \
      --intake /absolute/private/intake.json \
      --input-root /absolute/private/originals \
      --output /absolute/private/forms-edition-a

The calculation retains the exact original intake; all present original bodies; prepared source manifest and comparison selection; the entire maintained migration case; complete asset, attachment and finding exports; disk indexes; the result and workspace HTML; and a complete delivery inventory.

Its project_identity is the SHA256 of the original intake bytes. Input and application identities make the calculation reproducible. The original intake is retained exactly, including decision metadata. intake.receiving.json is a complete equivalent selection with present asset paths rewritten to the project's retained originals.

The program requires a new directory. Retain each earlier edition and its archive. A correction changes the selected source or interpretation and creates a distinct immutable project. Original unsuccessful runs and stdout/stderr remain under the receiving owner's operation log.

Inspect source coverage separately from comparison outcomes. Class scope_state MATCHED means that declared source and target originals are present, declared complete, and every selected original participates in an explicit field, whole-file or attachment comparison. Each uncovered original has its own asset_coverage finding. It does not mean those comparisons all match. Each class also shows its actual field/key status counts and whole-file/attachment findings. Neither state constitutes vendor execution or human acceptance.

## Open the local workspace

Pack the complete project before opening it when a downloadable whole archive is required:

    python forms_workbench.py pack \
      --project /absolute/private/forms-edition-a \
      --output /absolute/private/Forms_Edition_A.zip

    python forms_server.py \
      --project /absolute/private/forms-edition-a \
      --archive /absolute/private/Forms_Edition_A.zip \
      --receipt /absolute/private/forms-server-a.json \
      --port 0

The receipt must be a new private file outside the immutable project. The server verifies the complete project, selected application and every archive member before listening. It binds only to 127.0.0.1 and provides an unpredictable private token URL.

Open workspace_url from the real receipt. The original migration inspector is at origin, one directory above workspace/. All original record, total, source and complete comparison downloads remain available. The outer workspace adds six-class selection coverage, full original inventory, exact attachment records, whole-file findings and complete project downloads.

Keep the token-bearing URL and receipt private. The server accepts its exact Host and same-origin requests and exposes only read operations. Original files download as inert binary attachments so vendor-supplied HTML or XML cannot execute inside the inspector. The launching operator owns the server process and stops that process locally.

### Revised selections

The workspace can retain a complete local draft based on intake.receiving.json and its original project identity. Edit selected class decisions or the full explicit intake, retain a named revision, and download the new complete intake. Draft editing changes browser-local preparation; it does not modify the immutable project or execute a platform migration.

Use the downloaded intake with input-root pointing to the original or received project that owns its retained paths, and select a new output directory. When adding new original files, choose a complete authorized input directory containing those originals and update exact paths and identities.

A previous source edition's saved draft must not be silently applied to a different project. Export the complete draft and carry an explicit revision decision when moving between editions.

## Complete exports, archive and independent reopening

assets.jsonl, attachments.jsonl and findings.jsonl preserve every complete original record as structured data. Their CSV companions are formula-safe spreadsheet views; formula-leading cells are escaped and structured values are represented as JSON strings. Use JSONL and retained originals when exact raw text is required.

The maintained migration case retains its own complete row and dimension-total JSONL/CSV, original CSV snapshots and indexed result. A browser page is a view of that complete population. Current-page exports, where offered by the original inspector, remain explicitly labelled subsets.

A whole Forms_Project ZIP contains the entire outer project, all source and target originals, complete interpretation and comparison results, every selected application file and its full manifest. Member paths, file types, byte counts and SHA256 values are checked on independent receive. Whole-file operations stream binary bodies.

    python forms_workbench.py receive \
      --archive /absolute/private/Forms_Edition_A.zip \
      --output /absolute/private/received-forms-a

The default expanded archive limit is 20 GiB; the receiving operator can select a different positive limit with --max-bytes. This is an explicit resource limit, not a sample or row cap. Archives are received into a new directory. Directory entries, symbolic links, duplicate members, traversal, changed bodies and an incomplete selected program are rejected.

Run the actually received program against its actually received originals:

    python /absolute/private/received-forms-a/workbench/forms_workbench.py run \
      --intake /absolute/private/received-forms-a/intake.receiving.json \
      --input-root /absolute/private/received-forms-a \
      --output /absolute/private/cold-forms-a

The receiving intake intentionally uses retained paths, so its byte identity and newly calculated project identity may differ from the initial intake. Compare exact original asset hashes and complete semantic comparison/finding values. A changed path is not a changed customer value.

Use the received selected source to pack and open the newly calculated case. Retain the first original archive and all prior results. The complete receiving course documents this full sequence.

## Native, browser and actual visual receiving

Read FORMS_RECEIVING.md and run receiving_forms.py using the full selected source. The authored examples cover complete six-class source and returned target selections, repeated/multiline data, missing or altered attachment bytes, wrong parent links, ambiguous logical attachments, whole-file differences and preserved correction editions.

The receiving helper executes the actual maintained calculators, verifies every full exported population and archive, independently receives the complete program, and reruns it against the retained originals. It starts the actual selected server and retains its real receipt for the browser helper.

Use receiving_forms_browser.mjs with that real receipt and the actual existing Node, Playwright and Chromium paths. Operate the complete workspace and original inspector; open original files; exercise filters, paging, detail and draft revision/import/export; download full files and the complete archive; reopen the downloaded material; and capture desktop and narrow output.

The operator must actually open and look at all produced images and every applicable PDF page, use the outgoing interfaces, and reopen the complete delivered attachments and exports. Preserve the actual viewed artifacts and concrete corrections in the original receiving operation. A captured filename, source review or DOM assertion is not a viewed product.

## Attribution and source ownership

Retain TokenJunkieLabs (TJLabs) attribution and the original MIT license. The reusable public application and invented examples contain no customer exports, counterpart correspondence, credentials or private commercial terms.

The original prospect owner retains its qualification and source-acquisition work. The actual customer/prime retains source meaning, platform access, supported mutation routes, acceptance and production authority. The receiving owner retains the real operation directory and any existing process. Continue the same actual run when recovering an interruption, retaining prior artifacts and decisions.
