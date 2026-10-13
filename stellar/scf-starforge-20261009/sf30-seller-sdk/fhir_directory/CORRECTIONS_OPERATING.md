# Complete original Directory correction receiving

This native course operates the source correction workbench against the already completed Directory example. It receives the original complete workspace into a separate private directory, retains the original UUID, accepts two explicitly authored correction editions, reassesses their conformance, and receives the whole result into a second private workspace.

The source is authored and source reviewed. A completed native result is produced only after the original commands actually run. This guide does not describe an already observed correction run.

## Original input and scope

The operation is `SCF-DIRECTORY-CORRECTIONS-450E-20261013`. It uses the complete original Directory result `e0ec9ea89d3fde2bd896f802c22f20347e322bd6`, 103,569 UTF-8 bytes, SHA-256 `0b0e08808ae3c1c62c512271dd6269cee2219b792d63d720ef67b8411e775fe0`.

Its paired complete editable workspace is:

- Name: `Human_Services_Directory_Complete_Editable_Receiving.zip`
- Bytes: 28,828,941
- SHA-256: `c00ad722ed19986a513e113b3a69c82cfae2aa4bdcddc6b7056187a3b1578064`
- Workspace UUID: `2c51f522-4852-463b-bdc0-59389d7bae83`
- Original saved file: `libfile_6ab76eaf8bc88191bbbe003093f27e80` / `file_000000004734823096f2c817cdd29dda`

The complete original result supplies `connectedInputs.sourceImports`. The course selects the unique `original-csv` and `organization_full.json` entries by those keys, verifies the retained complete files against the actual source descriptors, and reads their existing native indexes. The exact original publisher references remain in the completed Directory input:

- [HSDS published CSV examples](https://github.com/openreferral/specification/tree/606a72cc3ddd80f890b6422bc7bd53392764775a/examples/csv)
- [HSDS published nested organization example](https://github.com/openreferral/specification/blob/606a72cc3ddd80f890b6422bc7bd53392764775a/examples/organization_full.json)

These are retained published examples and explicitly authored local successors. The course does not acquire a provider feed, update a publisher, reserve service capacity, send a referral, or assert a real customer accepted a correction.

## Run the complete native course

Use the complete maintained Directory source, including the correction engine, typed catalogue, shared Workspace/server/CLI/receiving integration, the original source/index modules, and the original conformance engine. The inherited `operate_operating_plans.py` remains an exact source dependency: its original receiving, file copying and native-record hashing helpers are reused.

Materialize the complete source and the two exact original input files before running. Keep the selected source files unchanged during the operation. The source identity is recorded in the native journey; a different source edition requires an explicit continuation decision, not silent replacement.

```sh
python -B /absolute/source/fhir_directory/operate_corrections.py \
  --receiving /absolute/input/Original_Directory_Receiving.json \
  --receiving-sha256 0b0e08808ae3c1c62c512271dd6269cee2219b792d63d720ef67b8411e775fe0 \
  --archive /absolute/input/Human_Services_Directory_Complete_Editable_Receiving.zip \
  --workspace /absolute/private/corrections/workspace \
  --out /absolute/private/corrections/native
```

Choose a distinct private correction workspace. The original archive receiver supplies its existing UUID and all original records. Do not point this course at another owner's active workspace. The course establishes `umask 077`, uses the maintained private directory and file writers, and records the exact absolute input and output locations.

The native course uses Python and the existing Directory implementation. The later operator/browser/Merchant client course also needs the existing Node, Playwright and Chromium runtimes. The whole programme should preserve the native outputs before discovering or launching the browser so a missing browser does not strand the completed native work.

## What the original course operates

### First accepted edition: complete CSV corrections

A frozen basis edition selects the complete original published CSV archive and nested JSON source. The first correction uses two ordered edits on the actual original `service` row, whose physical `description` and `name` columns are retained:

1. An explicit cell correction contains commas, quotation marks, a newline and non-ASCII text.
2. An explicit complete-row correction continues that reviewed description, adds an authored suffix to the name, and retains every other original physical cell. It does not assume a second service row exists.

Every edit carries the actual `sourceId`, `recordId`, `rowSha256`, `resourceSha256`, `memberSha256` and its authored reason. The complete prepared input is retained as an immutable correction plan. Preview and acceptance are separate native operations. The preview retains the derived complete source capture, native index, candidate edition, comparison, full ordered before/after history and complete review graph.

The course verifies that exact preview and acceptance replay return their original record IDs. It independently checks the resulting physical headers and cells, complete unchanged source members, and all untouched byte segments around changed row ranges. The original CSV delimiter, encoding and each selected row's line ending remain bound to the original parsing decisions.

### Second accepted edition: nested JSON correction

The second correction continues from the actual first accepted edition and its correction record. It selects an existing nested JSON row with an original parent and a complete byte-range ancestor. An explicit name update and optional description removal exercise the retained lexical JSON correction path.

The course reopens the derived row by its exact source member, table and pointer. It checks the selected new value and explicit absence, then compares every unedited subtree and scalar with the original lexical representation. Original numeric tokens are counted and retained in the evidence. Original values are not converted through a replacement JSON model.

The complete accepted CSV successor remains selected in this second edition. Neither the original published source nor the earlier accepted edition is overwritten.

### Actual conformance reassessment

Three complete assessments are run through the maintained source-native conformance engine: the original basis, the accepted CSV edition, and the accepted JSON successor. Each retains its plan, implementation identity, exact source selection, complete findings, coverage, foreign-key outcomes, original references, report and downloadable package.

Two complete comparisons retain the actual rule-outcome changes. The course does not require an artificial all-pass result. Published examples may contain original limitations, duplicated representations and unresolved relationships. All findings and unevaluated coverage stay available, and the comparison does not infer entity equivalence or publisher additions/deletions.

### Native transport and complete receiving

The course replays all eight original prepare/preview/apply/export requests through authenticated HTTP and the maintained CLI. Each must return its exact original immutable record ID. It reads every correction change through contiguous native and HTTP pages, downloads all declared correction files, verifies complete exported packet members and record graphs, and retains command stdout/stderr.

The full workspace export contains all original records, both complete accepted correction editions, derived source captures, source and comparison indexes, conformance records and files, original clinical/referral lineage, and the correction review histories.

A separate receiving workspace imports that exact complete archive. The original receiver validates the correction semantic replay and conformance graph. The course compares every portable record, reopens every source and index, closes the workspace, then reopens it again. Exact original prepare/preview/apply requests must reuse their earlier accepted results without adding records.

## Results and client contract

The successful native result is `OPERATED_DIRECTORY_CORRECTIONS.json`, schema `stellar-forge.directory-corrections-operated.v1`. The journal is `CORRECTIONS_JOURNEY.json`.

The result includes:

- `workspace`, `workspaceId`, `sourceRoot`, and the complete `workspacePacket` file descriptor.
- `originalDirectoryReceiving` and `originalDirectoryPacket`, preserving the actual completed input identities.
- `originalDirectoryRecordHashes`: a flat object whose keys are `kind/id` and whose values are SHA-256 strings over the original native `source.jbytes(record)`. Receiver-local `receives` rows are omitted.
- `recordIds`: the complete exported native registry's collection-to-ID arrays.
- `cases.csv` and `cases.json`, each with `editionId`, `planId`, `previewId`, `correctionId`, `comparisonId`, `candidateEditionId`, and `acceptedEditionId`.
- Complete case source pairs, actual ordered changes, original row references, preservation evidence, export record/file, conformance assessment and comparison identities.
- `connectedInputs.replay`: eight objects with exactly `key`, `action`, `input`, and `expectedRecordId`. Actions are `prepare`, `preview`, `apply`, and `export`; their inputs are the original complete requests.
- Original assessment IDs, actual HTTP/CLI receipts, all retained file descriptors and the full restoration/reopen verification.

The native complete editable archive is `Directory_Corrections_Complete_Editable_Workspace.zip`. Its bytes and SHA-256 come from the actual export and are never predeclared.

The companion `operate_correction_clients.mjs` consumes this actual native result and the same derived workspace. Its operation is `SCF-DIRECTORY-CORRECTION-CLIENTS-450E-20261013`; outputs are `OPERATED_DIRECTORY_CORRECTION_CLIENTS.json` and `CORRECTION_CLIENTS_JOURNEY.json`. Follow `CORRECTION_CLIENTS.md` for its full invocation. Its final `workspacePacket` is the independently received customer's actual export; `sourceWorkspacePacket` preserves the producer packet separately.

## Evidence and interruption

The course retains complete files under the selected native output directory:

- `Original_Directory_Receiving.json`, exact source identity inventory, and both complete original selected source files.
- `PREPARE_04-csv.json` and `PREPARE_07-json.json`, plus complete immutable native correction records and declared files.
- `PRESERVATION_04-csv.json` and `PRESERVATION_07-json.json`, containing original and derived rows, member descriptors, unaffected byte-segment hashes and unedited numeric tokens.
- Full correction exports, complete conformance and comparison files, HTTP receipts and exact CLI command streams.
- The exported complete registry, complete editable archive, journal and completed result.
- The independent received workspace with its actual archive receipt and all original records.

Each mutating step records the complete request and its hash before invoking the maintained native method. A completed step is reused from the same journey. Native content-addressed records and original archive receipts reconcile interrupted calls.

Resume with the same complete source, original absolute operation paths, input identities and current full workspace/journal boundary. Preserve a progressed correction workspace rather than recreating it from the older producer packet. The whole programme's boundary receiver must preserve directories, file modes, all source/input custody, the native workspace and complete client output.

Do not dispatch a second native owner while the first operation is active or uncertain. A failed admission before process creation is not an executed course. A saved native result is distinct from completed browser/customer receiving; retain the exact observed boundary and continue it.
