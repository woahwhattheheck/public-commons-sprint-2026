# Native OTOBO capture and emission
Prepared by TokenJunkieLabs.

## Purpose and authority
This helper retains original standard-object YAML, captures the installed functional YAML::XS interpretation, and emits explicitly reviewed original objects. It does not execute an OTOBO import, upgrade, schema change, service restart or account operation. A completed emission is a handover, not evidence of target acceptance. The existing OTOBO operator performs the original native import and then makes an independent target export for the existing Migration Acceptance comparison.

The source research is pinned to RotherOSS/otobo commit ed3cdf2b9b633fe3941ce15be16c5720006b1b38, whose RELEASE is 11.1.x. Current official 11.1 pages describe beta releases. Installed release/module identities are recorded per capture; the helper does not infer installed version from that research pin or from documentation examples.

## Run in the original installed Perl environment
Use the installed OTOBO Perl and its original module search path. Do not install or replace the server's YAML module merely to make this helper run. The strict capture requires YAML::XS 0.84 or later because duplicate-key rejection was added in that version; the older original OTOBO dependency minimum by itself does not satisfy this admission profile.

For example, adapt only actual paths:
```sh
PERL5LIB=/actual/otobo:/actual/otobo/Kernel/cpan-lib /actual/perl native/otobo-native-handover.pl capture --otobo-root /actual/otobo --manifest /actual/source-manifest.json --out /actual/new/source.capture.json
```
The caller owns the files and directory permissions. Original capture files can contain operational settings, agent names and mail templates; keep the whole private case under the existing access controls.

## Capture manifest
Use UTF-8 JSON. Declare all ten families explicitly, including unavailable ones. An empty native family export can support an explicitly complete empty collection. Merely omitting a file does not establish completeness.
```json
{
  "caseId": "your-original-case",
  "side": "source",
  "workspaceReference": "original installation and operator source",
  "observedAt": "2026-10-13T20:00:00Z",
  "evidenceKind": "provider-export",
  "completeness": {
    "Groups": true, "Roles": true, "Types": true, "Templates": true,
    "Services": true, "SLAs": true, "Queues": true,
    "QueueTemplates": true, "RoleGroups": true, "GenericAgents": false
  },
  "files": [
    {"id":"queues-export","path":"/actual/Export_Queues.yml","filename":"Export_Queues.yml","family":"Queues"}
  ],
  "evidenceFiles": [
    {"id":"native-target-context","path":"/actual/target-context.json","filename":"target-context.json","purpose":"Original target lookup and selected settings evidence"}
  ],
  "externalContext": {}
}
```
This abbreviated file list is a structural example, not evidence that the other nine collections were exported. The operator must reconcile every declared completeness value with the actual selected export scope before accepting a plan. Use evidenceKind authored-reference only for clearly labeled internal examples.

The ten roots are Groups, Roles, Types, Templates, Services, SLAs, Queues, QueueTemplates, RoleGroups and GenericAgents. Each YAML file must have exactly one matching family root. Names and map keys are kept exactly: no case folding, whitespace trimming, ID remapping or inferred renaming. Duplicate family/name across files is rejected.

## Native parser and strict admission
environment.parser records Perl/YAML::XS versions, loaded module hashes, native library hashes and the full applied profile. Installed RELEASE and original importer/family/lookup module hashes are retained separately. environment.observedDefaults records the globals observed at helper startup. These are not confused with the helper's stricter localized options.

The actual original OTOBO YAML wrapper uses classic functional YAML::XS::Load/Dump. Its default scalar-context Load can select the last document, and its default duplicate-key setting can accept overwrites. The helper instead admits exactly one document and enables ForbidDuplicateKeys. It disables blessed/code loading and code dumping, enables numeric-string quoting, chooses JSON::PP boolean objects and indent 2. Explicit tags, anchors, aliases and directives outside quoted/block scalar content are rejected before loading. This is a deliberately narrower admission profile, not a claim that native OTOBO rejects those originals. A rejected file stays unchanged on disk; no partial successful capture is written. Its complete original remains available to the original operator for a separately reviewed export.

Each scalar is represented as kind, textual value and yamlToken; arrays/maps recursively retain children. Integer and floating values are text in JSON, so JavaScript cannot round an unsafe original integer. yamlToken is the actual native scalar re-emission, not a claimed original lexical span. Raw original YAML is retained independently, exactly, in body_base64 with bytes/SHA256. The emitter reparses those bytes and selects native Perl values; it never reconstructs native numbers from the browser's JSON.

## Target context evidence
Optional read-only lookup capture:
```sh
PERL5LIB=/actual/otobo:/actual/otobo/Kernel/cpan-lib /actual/perl native/otobo-native-handover.pl target-context --otobo-root /actual/otobo --workspace-reference "actual target installation" --observed-at 2026-10-13T20:00:00Z --out /actual/new/target-context.json
```
This calls the installed original methods: ValidList; GetFollowUpOptionList(Valid=>0); LockList(UserID=>1); PriorityList(Valid=>0); StateList(UserID=>1,Valid=>0); UserList(Type=>'Short',Valid=>0,NoOutOfOffice=>1). The final flag prevents out-of-office display text from altering the actual login names. It additionally reads all SalutationList/SignatureList/SystemAddressList records with Valid=>0 and each corresponding Get(ID), plus QueueList(Valid=>0). Full original Get results remain tagged in the evidence. externalContext.sharedObjects carries the export-shaped Salutation, Signature and SystemAddress trees: ValidID becomes Valid through the original ValidLookup; ID/CreateTime/ChangeTime are removed; SystemAddress QueueID becomes Queue through the complete queue list. This follows the actual Queue.ExportQueues transformation. Unused shared objects are included, so a queue create cannot incorrectly assume its same-name content will replace existing target content. An empty native list has the same return shape as a failed query, so this strict helper rejects it rather than asserting complete absence. Independently evidenced empty cases remain explicit operator declarations.

It reads only System::Permission and Ticket::Frontend::MaxQueueLevel from native configuration. It records each exact method, argument map, ID→name return, timestamps and native environment. Normal OTOBO lookup caches may be populated; no configuration writer is called.

Place the whole result under evidenceFiles id native-target-context and copy its externalContext into the capture manifest. ExternalContext carries:
- lookupSets[name]: values and evidenceFileIds;
- permissionTypes: values and evidenceFileIds;
- maxQueueLevel: integer value and evidenceFileIds;
- sharedObjects.Salutation/Signature/SystemAddress: complete, evidenceFileIds and exact named export-shaped tagged entries.

Other original package/lookup evidence may be captured as additional complete files. A package-list command which suppresses invisible packages is not a claim of complete installed inventory. Manually supplied declarations remain operator evidence, not fabricated native reads. Calendar, signing-key, package and service-specific assumptions may remain unresolved in the review engine.

Capture source and target independently. A provider-export capture requires --otobo-root for actual installed RELEASE/source hashes. Keep source and target workspaceReference, observedAt, native evidence and original files distinct.

## Plan and native emission
The original review engine produces otobo.handover-plan.v1. Its identity binds caseId, both capture IDs, expectedParser (the exact source parser object), reviewer, reviewedAt, all decisions and importOrder. Complete capture identities already bind both environments; the plan does not duplicate them. Every source object must have a decision, including keep-target and exclude. An override is only a path to an original source scalar and a path to an independently captured target scalar with a reason. No arbitrary browser value is emitted.

Use the source's recorded native Perl environment and the maintained JS core. The recommended entry point evaluates the complete original plan before emission:
```sh
PERL5LIB=/actual/otobo:/actual/otobo/Kernel/cpan-lib node native/prepare-handover.mjs --perl /actual/perl --otobo-root /actual/otobo --source /actual/source.capture.json --target /actual/target.capture.json --plan /actual/reviewed.plan.json --out-dir /actual/new/handover
```

The wrapper runs the actual evaluateConfigurationPlan from the original core, requires ready plus the exact full importOrder, and retains review.json and byte-for-byte copies of the three original JSON inputs. A blocked review remains downloadable in that fresh directory and does not invoke the native emitter. An accepted review spawns the Perl helper with an argument array and no shell. It retains the native process outcome, verifies original capture/plan IDs in the emission receipt and writes handover.json. Native output files are under emission/. No OTOBO import is invoked.

The low-level command is native/otobo-native-handover.pl emit --source SOURCE --target TARGET --plan PLAN --out-dir NEWDIR [--otobo-root ROOT]. It validates native identities and typed emission but intentionally does not duplicate the JS dependency/permission calculator. Do not bypass the wrapper's complete readiness review for an operator handover.
The destination must not exist. Full source and target capture JSON, full plan, emitted family files, emission.json and README are retained. A later write failure preserves the partial directory for inspection; use a new path for a new attempt. The helper does not erase partial work or silently overwrite any existing output.

Before writing it verifies capture hashes, every raw file's byte count/SHA, exact native reparsed tagged trees, all decisions, complete target coverage for create/absence and action/target-presence consistency. It then dumps selected native objects through the installed YAML::XS profile and reloads them to verify the typed result.

The frozen plan.importOrder contains {family,name,sourceFileId,action} once for each selected import decision. Native family phases are Groups, Roles, Types, Templates, Services, SLAs, Queues, QueueTemplates, RoleGroups, GenericAgents. Services are emitted as single-object files in reviewed parent-first order, because native ImportServices does not provide a general topological ordering. Queues remain one bulk per action, all creates before all overwrites, preserving the native writer's delayed system-address handling. An existing object's overwrite must be explicitly reviewed; mixed action groups never obtain implicit blanket overwrite authorization.

emission.json provides ordered commandArgv arrays for the original bin/otobo.Console.pl Admin::ImportExport::ImportStandardObject command. The YAML path is its positional argument; --update appears only for reviewed overwrite groups. The helper records those commands and never runs them.

### Native behavior that remains explicit
- RoleGroups uses replace-pair-permissions. Mentioned role/group pairs replace their permission set; the original general overwrite option does not make those writes safe to ignore. rw dominates the fine-grained permissions.
- QueueTemplates uses add-links. Absent links are not removed.
- GenericAgents requires explicit schedule/action review. Preserve all original fields, including deletion/module/action settings; selecting a file does not activate a job.
- StandardTemplateAdd does not persist a non-null PreSelectedTicketStateID. Such a create is blocked rather than represented as a successful state-preserving import. An existing template may use an explicit captured-target scalar reference override in a reviewed overwrite.
- Top-level Name remains the original identity. Services also retain the exact identity derived from Parent and NameShort. A separately reviewed embedded Name or ID scalar may be copied only from an actual retained target scalar.
- Target completeness and cross-family dependencies remain substantive review criteria; the original importer can skip individual records or partially apply preceding records even when its aggregate return is unsuccessful.

## Reconciliation and actual operating evidence
After the original operator executes approved native commands, retain the actual console results and independently export the target again. Run capture with side target against those new raw exports. The existing Migration Acceptance adapter compares the original plan's expected objects and relations to that independent result, preserving full source/before/after evidence, changes, unknown coverage and history. The emitter's own files or a simulated re-export must never be mislabeled as an observed target export.

Use the provided internal commissioning course to exercise complete file handling without importing a customer installation. It is authored-reference evidence only. This source was developed/reviewed without an equipped Perl/OTOBO runtime in this seat; native compilation, actual YAML::XS execution and real target export/reconciliation remain the same original operator's receiving work.

## Actual producer inspection
Follow the maintained current owner instructions: the producing peer must open/run/render and LOOK at the exact outgoing application on desktop and narrow widths, exercise the important controls, and inspect every attachment/extracted member before calling it ready for the customer. Source execution, hash checks, a queued request or third-party screenshot capture alone do not meet that requirement. Keep the existing native receiving operation and its original owner; do not start a duplicate browser or capture controller.

## Run the retained internal native-format course

```sh
/actual/perl native/commission-native.pl --examples /actual/adaptation/examples --out-dir /actual/new/native-format-course --node /actual/node
```

The course consumes the same complete source/before/after/matchingAfter reference and plan already included with the original review engine. It restores every raw YAML/evidence file, makes fresh native captures, binds the same decisions/import order to those captures and the actual parser, runs the original JS readiness wrapper before emitting the reviewed native files, and saves the full outcome plus a separate scalar-format source/projection. The supplied after captures stay explicitly authored-reference; the course does not invent an independently observed target. No native imports execute. Native execution of this course is pending an equipped original receiver; this document does not claim it ran in the authoring seat.
