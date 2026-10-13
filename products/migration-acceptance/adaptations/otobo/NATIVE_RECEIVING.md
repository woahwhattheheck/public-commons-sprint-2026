# OTOBO configuration comparison and complete native handover

Prepared by TokenJunkieLabs.

This adapter compares the reviewed configuration plan with an independently returned OTOBO configuration capture through the existing Migration Acceptance Workbench. It retains the original source export, the destination baseline used for review, the complete selected plan, the returned capture, attributed review history, and the original native request journals.

The native comparison materializes reviewed expectation rows in the selected local DuckDB workspace. The independently returned OTOBO capture supplies the other side of the comparison. Native OTOBO import and the resulting capture remain separate original operations.

## Exact supported source contract

The selected contract is RotherOSS/otobo rel-11_1 at `ed3cdf2b9b633fe3941ce15be16c5720006b1b38`, with the complete original source and license retained. Standard configuration imports use family-root YAML and the existing native standard-object import path. The separate ImportExport template/CSV engine has a different format, template identity and mapping.

The selected standard families are Groups, Roles, Types, Templates, Services, SLAs, Queues, QueueTemplates, RoleGroups and GenericAgents. Ticket/customer records and other configuration families require their own actual native source contracts.

The capture helper preserves each original file's exact bytes, filename and SHA-256, together with the observed parser profile, typed tree and declared family completeness. Scalar types are tagged. Integers and floating-point values remain literal text in their tags; strings, null, booleans, arrays and maps remain distinct. Complete unknown object fields stay in the retained tree.

Independent destination context includes permission types, maximum queue hierarchy depth, and the referenced native lookup names with their original evidence files. Missing context remains unresolved. An overall native import success does not establish that every selected entry was written.

## Capture and native handover commands

Use `native/otobo-native-handover.pl` from this complete adapter on the original equipped OTOBO host. The helper requires its documented strict installed YAML::XS profile, including version 0.84 or later for duplicate-key admission. This is this helper's validation requirement, not a statement of OTOBO's historical minimum.

Capture each original source or destination selection with its own complete manifest:

~~~sh
perl adaptations/otobo/native/otobo-native-handover.pl capture \
  --manifest /absolute/original-source-manifest.json \
  --otobo-root /actual/source/otobo \
  --out /absolute/new/source.capture.json

perl adaptations/otobo/native/otobo-native-handover.pl capture \
  --manifest /absolute/original-target-manifest.json \
  --otobo-root /actual/target/otobo \
  --out /absolute/new/before.capture.json
~~~

The manifest identifies the original case, side, workspace, actual observed time, evidence kind, exact file paths and all ten family-completeness booleans. Completeness is an explicit source assertion; file count and successful lookups do not establish it. Preserve the complete actual manifest and files. Relative paths follow the helper's native working directory, so absolute original paths avoid ambiguity.

Acquire the target lookup context on the selected original installation:

~~~sh
perl adaptations/otobo/native/otobo-native-handover.pl target-context \
  --otobo-root /actual/otobo \
  --workspace-reference ACTUAL_TARGET_WORKSPACE \
  --observed-at ACTUAL_ISO_TIME_WITH_TIMEZONE \
  --out /absolute/new/target-context.evidence.json
~~~

Retain that complete output as an original evidence file and use its exact evidence IDs in the capture context. It records the actual native lookup methods and arguments. Unknown context is not replaced with a guessed default.

After explicit review, run the original configuration engine on the exact selected source, baseline and plan, then derive the native handover:

~~~sh
node adaptations/otobo/native/prepare-handover.mjs \
  --source /absolute/source.capture.json \
  --target /absolute/before.capture.json \
  --plan /absolute/reviewed-plan.json \
  --otobo-root /actual/source/otobo \
  --out-dir /absolute/new/native-handover
~~~

The wrapper retains the complete source inputs and full readiness result, then invokes the Perl helper without a shell only when the selected plan is usable. The helper reparses retained original YAML and verifies the complete tagged tree before emission. It creates new outputs and preserves earlier files. The selected native import commands are operated by the original configuration owner; emission itself is not evidence of a deployed change. Independently capture the actual destination again afterward and retain that result as `after.capture.json`.

## Review semantics preserved by the original engine

The configuration core owns family and dependency behavior:

| Selection | Comparison meaning |
| --- | --- |
| Object family entry | Exact named identity and the complete normalized tagged object, including unrecognized fields. |
| QueueTemplates | Selected queue/template pairs are additive. A returned extra link is retained in the full capture and is not an inferred deletion or replacement. |
| RoleGroups | A mentioned role/group pair is compared using its complete resulting permission set; rw dominates. Unmentioned pairs remain outside that replacement. |
| Nested queue objects | Named shared salutation, signature and address effects stay in the full plan and dependency review. |
| Services and queues | Original parent hierarchy and observed destination constraints remain part of readiness. |
| GenericAgents | Full settings and native references remain retained; this adapter neither activates jobs nor executes their actions. |

A queue create uses an existing same-named salutation, signature or address when one is already present. The review compares that retained shared body, including unused objects from the target inventory. A complete queue list alone does not establish that a shared object is absent. When a selected later queue overwrite supplies the same planned shared contents, the review records that dependency on the fixed create-then-overwrite sequence. Otherwise differing retained contents require an explicit resolution.

A queue overwrite can change other queues that share the same object. The review identifies captured affected queues and rejects a plan that would change a queue explicitly selected as keep-target. Other affected queues remain visible with their original bodies; their names are not silently added to the selected comparison population.

A plan retains explicit decisions for its source entries, including keeping destination values or excluding an item with its reason. The source and target capture hashes, parser selection, reviewer and original plan identity remain bound. A changed baseline or source requires an explicit original plan continuation.

## Returned capture and known differences

After the separately authorized original OTOBO import, capture the actual destination again through the maintained helper. Keep its actual observed time, destination workspace identity, parser profile, raw files and family completeness.

The comparison core prepares exactly the identities selected by the reviewed plan. The full unfiltered returned capture remains part of the portable project even though unselected extra configuration is outside the selected comparison table.

- If an expected identity is present, its independently returned complete tagged value is compared.
- If it is absent and that returned family is explicitly complete, it is a known missing row. Native comparison runs and reports the difference.
- If it is absent from a partial family, its state is unknown. The complete evidence and projection can be retained, but native binding is blocked until the original source review resolves that selected scope.
- A complete returned row whose value differs from the expectation proceeds to parity comparison; the adapter does not rewrite it to make the comparison pass.

Thus readiness for a meaningful comparison is separate from equality or readiness to select its local result.

## Native project and exact table

The existing project envelope keeps its original approval and history behavior. Its configuration-specific fields are:

~~~json
{
  "capture": {
    "schema": "otobo.review-source.v1",
    "source": "complete otobo.capture.v1 source value",
    "before": "complete original destination otobo.capture.v1 value",
    "after": "complete independent returned otobo.capture.v1 value"
  },
  "mapping": "complete otobo.handover-plan.v1 value"
}
~~~

The strings above describe complete embedded objects; they are not placeholder values accepted by the native adapter. The original project APIs validate the entire retained history and exact review requests. Named approval binds this entire capture and selected plan before native compilation.

The native configuration table contains three nonnull text columns:

| Column | Meaning |
| --- | --- |
| `family` | Exact selected configuration family. |
| `identity_json` | Canonical JSON of the core's exact object or endpoint identity. |
| `value_json` | Canonical JSON text of the complete tagged value or native relation result. |

The primary key is `[family, identity_json]`. OTOBO numeric values are not sent through a JavaScript number or native floating-point column. The JSON text retains integer precision, string-versus-number identity, null and all nested values.

The native library calls its independent comparison input `expectedSourceId`. In this adapter the local source is the reviewed plan expectation, and that independent comparison input is the returned actual configuration. The prepared projection and binding state both meanings explicitly.

## Complete prepared source

The adapter retains the following complete files through original source uploads and `source.retain` requests:

- `inputs/planned-configuration.json`: every selected expected row.
- `expected/returned-configuration.json`: every independently observed selected row.
- `capture.json`: original source, destination baseline and returned capture, including original file bytes.
- `mapping.json`: complete selected handover plan.
- `projection.json`: original capture/plan identities, coverage, findings, both full row sets and native-side meanings.
- `review/project.json`: the complete editable project and its review history.
- `integration/PROVIDER_BINDING.json`: exact prepared member identities and native source mapping.
- `integration/INTAKE_REQUESTS.json`: original complete source-retention request identities and results.

The original intake and receiving machinery owns uploads, request revision guards, immutable source objects and native jobs. The adapter reopens and recomputes the complete configuration projection before it binds native source IDs. A changed member, different plan or unresolved selected scope rejects that binding.

## Operate the original receiving course

Install the complete original Migration Acceptance Workbench and this complete adapter source with their source manifests. Run from `products/migration-acceptance/` using Node 24 or newer and the existing owner's actual runtime-ready selection.

~~~sh
node adaptations/otobo/receive.mjs \
  --project /absolute/input/configuration-project.json \
  --directory /absolute/original-workspace \
  --receiving-directory /absolute/independent-receiving \
  --runtime-ready /absolute/runtime-ready.json \
  --operation ACTUAL_ORIGINAL_OTOBO_OPERATION \
  --actor ACTUAL_REVIEWER
~~~

The driver continues the original local operation. It retains sources, compiles the existing dlt pipeline, performs the local load and verification, creates complete parity observations and business acceptance, exports the complete editable NDJSON handover, independently receives that handover and cold-reopens the copied application.

Use `--native-project` only for the intended existing native project. Reuse the same original operation, actor, source project and directories on a deliberate continuation. `--resume` continues an inspected original ended native attempt; uncertain target writes require their original reviewed outcome. Full original request journals are preserved.

The optional `--select-local` selects a closed local DuckDB snapshot only when parity and business acceptance are both ready. It never deploys configuration to OTOBO. Native imports remain with the original configuration owner and the exact source-compatible handover commands.

Keep the full `RESULT.json`, parity, observations, business acceptance, source requests, editable NDJSON archive, independent receiving result and cold-reopen result. A known difference is a useful comparison result; retain the original returned configuration and actual failed criterion.

## Receiving and outgoing inspection

Use the original Migration Acceptance equipped operator and the actual selected OTOBO capture. Upstream fixtures and deliberately authored examples are labelled source exercises and are not evidence of a live installation.

The producing peer must open/run the exact outgoing application and attachments, LOOK at the real render or screenshots and operate important controls. Inspect desktop and narrow layouts, populated/empty/loading/error states, complete selected configuration, findings, history, original-file downloads and whole-project export/reopen. View every applicable report/PDF page and play final media when produced. A source review, interface exercise, screenshot capture alone or another peer's approval does not substitute for this inspection.

Retain original live jobs, customer data, configuration import receipts and actual provider outcomes. Report precisely which native and visual operations ran and which remain with the existing owner.

## Complete retained reference through the original comparator

Run the source-owned reference course from the installed Migration Acceptance root:

```sh
node adaptations/otobo/examples/run-native-interface.mjs /absolute/new-private-interface-output
```

The command keeps every complete source, baseline, plan and authored returned capture. It creates a named original project, records its explicit approval with the unchanged project model, replays the exact approval request, reopens the complete editable project, prepares both all-text configuration populations, compiles the original dlt and acceptance inputs, and runs the original complete comparison. The queue comment and role-permission differences remain two complete unequal rows. The separately authored matching capture compares equal. Native execution remains unmeasured in this interface course; both original reports retain the native_execution_incomplete finding because this command does not run a database or the OTOBO importer.

The output includes the full project and original approval request, all reference captures, every prepared member and manifest, complete compiled plans, both full observation/parity/acceptance reports, and complete-interface-result.json. A new output directory is required; existing files remain unchanged. The full result retains known-missing and unknown-scope variants of the same original reference. Known missing configuration remains a measured mismatch; unknown selected coverage keeps the full evidence and prevents native binding. Changed prepared bytes and reused source identities are rejected before compilation.

Use the separate installed Perl course in native/NATIVE_HELPER.md to parse these original reference files with the actual local YAML::XS and emit native YAML. Its after and matchingAfter inputs remain labeled authored references. For actual customer acceptance, use separately captured real source, original target and independently returned target in the approved project, then the existing receive.mjs command above. Preserve the existing original native operation and its complete result.
