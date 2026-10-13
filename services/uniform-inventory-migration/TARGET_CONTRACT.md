# Native target files and returned-ID reconciliation

This companion completes the migration workspace's native-file preparation and readback work. It uses an explicit contract supplied and approved by the selected platform's implementation owner. It preserves every original workspace, source file, field mapping, correction, contract document, crosswalk, generated file, and comparison result.

The prime chooses and executes the platform's real import operation. After that operation, the prime returns the complete native exports and the actual identifier crosswalk. The companion reverses those declared identifier changes in a separate derived comparison and keeps the returned native originals intact.

## Files and entry points

Keep these five complete files together: `engine.mjs`, `sha256.mjs`, `target-contract.mjs`, `target-cli.mjs`, and this `TARGET_CONTRACT.md`. The engine and SHA implementation are the existing migration product's originals. Node supplies the CLI's standard filesystem and cryptography modules; this companion installs no package and contacts no service.

The pure module exports `targetContractTemplate(workspace)`, `validateTargetContract(workspace, contract)`, `projectTarget(workspace, contract, crosswalks)`, and `compareReadback(workspace, contract, crosswalks)`. Each operation reads a complete original engine workspace. It leaves that workspace unchanged. Crosswalk objects passed directly to the pure module contain their full original CSV in `text`; the CLI receives the same original CSV through a manifest.

Use an absolute path for every top-level CLI input/output. Original contract evidence and crosswalk CSV paths are relative to their own JSON manifest, inside ordinary directories without symlinked members.

```sh
node /absolute/application/target-cli.mjs template \
  --workspace /absolute/case/original-workspace.json \
  --out /absolute/case/contract-draft

node /absolute/application/target-cli.mjs project \
  --workspace /absolute/case/original-workspace.json \
  --contract /absolute/case/approved-contract/target-contract.json \
  --crosswalks /absolute/case/approved-contract/crosswalks.json \
  --out /absolute/case/native-projection

node /absolute/application/target-cli.mjs compare \
  --workspace /absolute/case/returned-workspace.json \
  --contract /absolute/case/readback-contract/target-contract.json \
  --crosswalks /absolute/case/readback-contract/crosswalks.json \
  --out /absolute/case/native-readback
```

Omit `--crosswalks` when all identifiers are preserved and the contract's `crosswalks` array is empty. Select a different output directory for a new input revision. Repeating an interrupted invocation with its exact original inputs fills missing immutable members; an existing different request or output is preserved and the invocation fails.

## 1. Establish the actual platform contract

Obtain the current native import template, native export specification, supported relationship/key rules, enumeration values, field limits, encoding requirements, and the platform's actual load/validation procedure. Retain the complete originals, source/version information, and the responsible implementation owner's approval. A published operational ordering API does not establish a migration interface.

The generated template deliberately contains empty native columns and uncompleted approval fields. Supply the actual native specification. Template filenames and the eight known migration domains are starting labels; they are not an assertion of a platform's import schema.

The contract has schema `tjlabs.uniform-target-contract.v1` and these top-level fields:

| Field | Complete retained meaning |
| --- | --- |
| `id`, `edition` | The agreed contract and its selected edition. |
| `approval` | Actual `id`, `actor`, offset-bearing ISO `at`, and substantive `reason`. |
| `workspace` | Exact original `id`, `revision`, and SHA-256 of the complete engine `exportWorkspace` bytes. |
| `sourceEvidence` | Every selected native-specification original: `name`, SHA-256, source/page `locator`, and relative local `path`. The CLI opens and hashes the complete file. |
| `crosswalks` | Exact selected files: `id`, identifier `domain`, original CSV `sha256`, zero-based `sourceColumn` / `targetColumn`, and original `approvalId`. Use an explicit empty array when none apply. |
| `requiredDomains` | The complete agreed scope. Each domain appears exactly once in `domains`. |
| `domains` | Full ordered native column specification and source/returned-file bindings for each scoped domain. |

Available domains are locations, wearers, products, entitlements, stock, issues, returns, and assets. The scope decision determines which are included. In the full Nottinghamshire workshare all eight must be measured and reconciled unless the actual partner/source owner records a different complete scope.

Each domain binds `source: {sourceId, sourceSha256, mappingId}` to the current original source mapping. A readback contract also binds `target` with the same three fields. Bindings and the overall workspace digest must match the complete chosen snapshot. Importing a real returned export changes the original workspace revision; create a following readback contract that explicitly binds that new complete snapshot. Keep the earlier projection contract/output.

## 2. Declare every actual native column

A domain's `filename` is an ordinary flat CSV filename. Filenames are unique even on a case-insensitive recipient. Its ordered `columns` array contains all actual target headings, including repeated or blank headings when the real specification requires them.

Every column has `header`, boolean `required`, and a `value` declaration. Optional native limits are `maxCharacters` (Unicode code points), `maxBytes` (UTF-8), and exact `allowedValues`.

Value declarations are:

- `{from:"field", field:"wearer_id", representation:"raw"}`: the explicitly mapped original field, preserving its literal text. Choose `"canonical"` explicitly for the existing engine's canonical value; its quantity canonicalization is exact decimal text without rounding.
- `{from:"column", column:5}`: one exact zero-based original column. This preserves duplicate headings by position.
- `{from:"constant", value:"...", decision:{id,actor,at,reason}}`: a reviewed native constant. It remains identified as a declared constant in every affected output cell.

A value may also name `crosswalkId`, `direction:"source-to-target"|"target-to-source"`, and `allowBlank`. A canonical identifier field must use its actual identifier-domain crosswalk: for example, an issue's wearer reference uses the wearers crosswalk. Reference changes are never inferred from a similar string.

An exact enumeration translation uses `values:[{from:"original",to:"native"}]` and an attributed `decision`. The original value must occur in the explicit translation. No default substitution is applied. These transformations affect the generated native files; readback reverses only explicitly selected identifier crosswalks. Other actual value differences remain visible in the original comparison and require the real platform/source owner's interpretation. The adapter does not infer unit conversion, money rules, entitlement renewal, workflow approval or lifecycle semantics.

Every original column outside the native output appears in `excludedOriginalColumns.columns` with its numeric `column`, exact `heading`, and attributed `decision`. This classification does not delete the original field or automatically waive a readback difference. The full original workspace and original cell values travel with the package.

## 3. Keep complete native identifier crosswalks

The CLI crosswalk manifest is a JSON array. Each entry selects one original CSV using `path`, plus `id`, `domain`, `filename`, `sha256`, zero-based `sourceColumn` / `targetColumn`, and `approval:{id,actor,at,reason}`. Retain any additional source or load-operation metadata in the same entry.

The CSV may contain other columns; all of them are retained. Each selected source ID and native ID must be nonempty and appear once. Original IDs remain opaque strings, so leading zeroes and Unicode are preserved. Every source ID must belong to the selected original identifier domain. Missing, duplicate, many-to-one or otherwise ambiguous mappings require a different explicitly engineered contract; this companion refuses to guess.

When a target generates IDs during import, run preparation for the identifier-preserving or vendor-provided load keys first. Receive the actual generated-ID export/crosswalk after the prime's native operation. Use that real crosswalk for the dependent-file projection and/or complete returned-ID comparison. Preserve every dependency stage's original contract and workspace snapshot. The software does not invent a crosswalk in anticipation of the target.

Each domain's `readbackKeys` declares the exact returned canonical identifier fields to reverse:

```json
{
  "field": "wearer_id",
  "crosswalkId": "actual-wearer-crosswalk-id",
  "allowBlank": false
}
```

Use an explicit empty list when identifiers remain unchanged. `allowBlank:true` is permitted for optional identifier fields only. The required identifier and relationship rules remain those of the original engine.

## 4. Inspect the complete native projection

The CLI first retains the whole original input cohort and the exact five-file application revision. A successful projection writes eight native CSVs for an eight-domain scope under `load/`, plus `projection.json` and the complete originals.

The report preserves each original row ID, record number and all original cells. Each output cell retains its source field/column or declared constant, original literal, transformation steps, original crosswalk record, and resulting value. It checks original source errors, all required target values, UTF-8/character limits, exact allowed values and complete crosswalk coverage.

If any scoped source or target-contract finding remains, status is `needs-review`, `readyForPrimeLoad` is false, and the full diagnostic projection remains available. No partial set of native load CSVs is emitted. Correct the actual original input or contract as a following edition, keeping the earlier result intact.

A `prepared` result means all declared file-preparation checks succeeded. The prime uses its actual native importer, retains its complete load report and accepted/rejected records, and records the real operation identity. Obtain the target's full post-load exports rather than judging successful import from prepared CSV alone.

## 5. Reconcile actual returned native files

Import every returned complete file into the original migration workspace as the target role and explicitly map its actual native fields. Save and export that complete following workspace. Keep the target's original keys, literal values, headings, all extra columns and exact original CSV bytes.

The readback companion copies effective source/target rows into a separate derived workspace. It reverses only the declared native key columns and preserves full original-to-derived row ancestry. Conflicting translations for a shared mapped column, missing returned files/mappings or missing crosswalk records produce a retained `needs-review` result.

The existing engine then performs the actual reconciliation: duplicates, relationships, exact quantities/units, issue-return totals, lifecycle fields, and complete unmapped-column comparison by heading occurrence. Canonical field names may differ between native and source headings because their explicit mappings identify them. Unmapped fields remain visible. Native-only defaults or other approved non-ID transformations can therefore remain genuine differences requiring attributable acceptance; the companion does not erase them.

Inspect `readback.json`, the full derived CSVs and `derived/workspace.json`. A `reconciled` / `technicalReady:true` result records the declared comparison outcome. Retain prime/source-owner acceptance of the actual operational load, workflows, permissions, stock usability and residual decisions with the existing acceptance records.

## 6. Deliver and independently replay the complete bundle

Each completed directory includes:

- `request.json`: exact complete input identities, native-contract originals and executing application revision.
- `inputs/`: untouched original portable workspace JSON, original contract JSON, original crosswalk selection JSON/CSV and complete native-specification source files.
- `application/`: all five complete source files required to repeat the operation.
- `original/`: full parsed workspace/contract and complete crosswalks beside the results.
- `projection.json` and, when valid, every native `load/*.csv`; or `readback.json` plus the complete derived comparison.
- `MANIFEST.json`: every complete member's byte length and SHA-256. It is published only after all members are durable.

Copy the entire completed directory as one unit. The recipient opens the original report and native CSVs, verifies the complete manifest, then runs the delivered CLI explicitly:

```sh
node /absolute/received/application/target-cli.mjs replay \
  --bundle /absolute/received \
  --out /absolute/independent-replay
```

Replay reads all original evidence and crosswalk files from the bundle, so the originating machine's paths are unnecessary. It verifies every manifest member, the original request, and all five executing application files, then regenerates the complete operation and requires exact equality with every original output and the full manifest. It creates a complete independent directory, preserving the original case. It executes the chosen installed/delivered application only; it does not execute a received script during validation.

The original relative paths remain in untouched input JSON and the complete record of its first selection. Replay resolves the already-retained members through that same saved request. For a new human-edited source/contract edition, use the original template/project/compare path and explicitly select the actual original files again.

If a process is interrupted, use the same command/input/output directory. Existing complete members must match before continuation. Writes use create-only atomic publication, complete-byte equality on a raced original name, and file/directory fsync. Incomplete candidates never replace an earlier complete member. A final manifest is created last. An operation with changed inputs uses a new directory. There is no second remote job or implicit re-import.

## Scope, sizes and data handling

The inherited engine supports complete UTF-8 CSV files up to32MiB,100,000 data records,512 columns, and1,000,000 characters per cell; portable workspace JSON is limited to128MiB. A native-contract JSON or crosswalk manifest is limited to4MiB. Each complete binary native-specification source may be up to32MiB. The CLI's complete originals/application/results directory is limited to512MiB. Measure the actual population before agreeing an implementation scope; preserve complete relation-safe partitions when a separately agreed extension is required.

Original personnel, asset or buyer records stay in the authorized customer case. Generic source may be public, but application packaging does not authorize publication of inputs. No credentials, target URLs or browser tokens are required by this offline companion.

CSV bytes preserve original and native literal values, including cells that a spreadsheet may interpret as formulas. Inspect raw CSV/text with a suitable viewer and follow the recipient's approved spreadsheet import procedure. The companion does not silently prefix or change native import cells.

## Operator and recipient viewing

Operate the existing migration application with these actual original and returned workspaces on desktop and a390px narrow viewport. Open its empty/populated/loading/error states, full mapping/correction/recovery controls, report, downloads and reopened workspace. For this CLI companion, directly open the complete generated CSVs, both reports, original specification attachments, crosswalks and the independently replayed output. Inspect full values and complete documents, including the duplicate-heading fields and original IDs.

The producer must actually see and use the delivered screens and attachments in the recipient's form. Captures, code inspection, DOM/HTTP checks or another agent's approval do not substitute for looking. Repair concrete clipping, unreadable content, broken controls or wrong downloaded/reopened values in the original product. Keep the industrial visual style. If a delivered attachment is PDF, inspect its actual rendered pages; watch video/listen to audio in full and inspect pronunciation, pacing, alignment and captions where relevant.

The existing original browser/recipient receiver remains the single business-course owner. This companion's original software operating example exercises file transformations and exact receiving; it does not create a second customer case or substitute example identifiers for actual native data.

## Integration ownership

The existing migration engine, browser workspace, shared continuation, commercial sender and native receiving owner retain their original operations. This additive module/CLI/guide can be adopted beside their current exact source. The complete original eight-domain software example is suitable for one native file/receiving commissioning pass. Actual platform headers, sources, crosswalks and acceptance remain the prime's complete selected inputs.


<!-- bryce-rendered-product-inspection:begin -->
## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
<!-- bryce-rendered-product-inspection:end -->
