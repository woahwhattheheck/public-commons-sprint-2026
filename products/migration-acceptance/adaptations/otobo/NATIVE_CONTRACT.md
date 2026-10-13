# OTOBO configuration handover: exact native source contract
Prepared by TokenJunkieLabs. Source research, 2026-10-13. No live installation or customer export has been operated.
Repository RotherOSS/otobo; rel-11_1 pinned ed3cdf2b9b633fe3941ce15be16c5720006b1b38; RELEASE reads 11.1.x. Official current 11.1 is beta. Native GPL-3.0-or-later headers and complete LICENSE are retained.

## Two separate pipelines
The standard configuration Admin*ImportExport modules serialize UTF-8 YAML via Kernel::System::YAML (YAML::XS). Their files have ONE object-family root, for example {Queues:{queue-name:{Name:queue-name,...}}}. Admin::ImportExport::ImportStandardObject loads YAML and dispatches a family to its existing native method; --update selects overwrite. It runs as native UserID1. The browser import first stages the exact YAML under the original logged-in user, then selects entries.
The separate Kernel::System::ImportExport template engine takes TemplateID, Object/Format/mapping and CSV or JSON array data. CSV format requires UTF-8 and an explicit native separator enum; headers and mappings belong to the template, not a guessed global schema. Never pass standard-object YAML through that CSV engine.

## Standard families and authoritative behavior
| Root | Native module/functions | Identity/dependencies | Existing-object / relation semantics |
|---|---|---|---|
| Groups | Group.pm ExportGroups/ImportGroups | exact Name, Valid name | existing skipped unless overwrite; create/update via native Group |
| Roles | Group.pm ExportRoles/ImportRoles | exact Name, Valid name | existing skipped unless overwrite |
| Types | Type.pm ExportTypes/ImportTypes | exact Name, Valid name | existing skipped unless overwrite |
| Templates | StandardTemplate.pm ExportTemplates/ImportTemplates | exact Name, Valid; all native fields retained | existing skipped unless overwrite; this is response-template configuration, not generic CSV mapping templates |
| Services | Service.pm ExportServices/ImportServices | full Name, NameShort, Parent, Valid; :: parent names | parent must resolve; missing parent skipped. Native orders top-level before children. Existing skipped unless overwrite |
| SLAs | SLA.pm ExportSLAs/ImportSLAs | Name, Services[] resolved by name, Valid; retain all calendar/escalation fields | existing skipped unless overwrite; actual native relation behavior and target re-export verify completion |
| Queues | Queue.pm ExportQueues/ImportQueues | Name, Group, Valid, FollowUp; embedded Salutation, Signature, SystemAddress; :: hierarchy and target Ticket::Frontend::MaxQueueLevel | existing skipped unless overwrite. Nested named objects can be updated under the same overwrite flag. System addresses handled after new queues. Missing parent/too-deep queue can be skipped; native overall true is not row-level completion |
| QueueTemplates | Queue.pm ExportQueueTemplates/ImportQueueTemplates | {queue-name:[template-names]}; both endpoints must exist | adds Active=1 selected pairs. Does not remove absent target links; overwrite parameter does not make this a set replacement |
| RoleGroups | Group.pm ExportRoleGroups/ImportRoleGroups | {role:{permission:[group-names]}}; target System::Permission list | for each mentioned group, PermissionGroupRoleAdd REPLACES that pair’s permission set, rw dominates. Unmentioned groups untouched. ImportRoleGroups's overwrite skip is AFTER pair writes: --update=false does not protect existing permissions |
| GenericAgents | GenericAgent.pm ExportGenericAgents/ImportGenericAgents | Name and translated single NewLock/NewOwner/NewPriority/NewQueue/NewService/NewSLA/NewState/NewType; plural Locks/Owners/Priorities/Queues/Services/SLAs/States/Types | existing skipped unless overwrite. Missing referenced name rejects that job and sets aggregate failure, while other jobs may already import. Updates delete/re-add native job. Complete remaining job settings, schedules and actions preserved, never activated by this review product |

## Preservation and comparison requirements
1. Keep every incoming original file byte-for-byte with filename, source edition, bytes and SHA; don't normalize the only copy. Bind parsed review to that exact original.
2. Use a maintained safe YAML parser with explicit bounds and duplicate-key / ambiguous multi-document rejection for this product. Native Load returns only the LAST YAML document; silently merging multiple documents would misrepresent native behavior. Never interpret tags as executable objects. Preserve scalar distinctions and complete unknown fields in the original.
3. Require one recognized family root; exact name keys and inner Name identity must agree for object families. Relation keys are named endpoints; preserve Unicode/case and literal :: hierarchy.
4. Capture source and target separately, with explicit completeness per family. An absent row in a partial target export is unknown, not proof that it does not exist. No absence-driven deletion.
5. Preserve independent operator decisions (create / explicitly overwrite / keep target / exclude with reason), complete before/current/proposed field view, dependency resolution against selected imports plus captured target, named histories and source hashes.
6. RoleGroups requires a warning/review of the FULL resulting role–group permission set. QueueTemplates is additive. Do not infer the same merge semantics across families.
7. Embedded salutations/signatures/addresses shared by multiple queues need conflict review by exact nested Name; selecting overwrite of one queue can affect shared objects. Retain original fields and target nested copies.
8. MaxQueueLevel, System::Permission, valid/follow-up names and external GenericAgent user/lock/priority/state names need original target evidence or an unresolved state. Never invent defaults as observed configuration.
9. Create source-compatible handover files for operator use of existing native imports. Keep native import receipts/logs distinct from an independently re-exported actual target. A success exit/status does not prove every selected object was written.
10. Reconcile actual target exports using the existing Migration Acceptance source/project/intake core. Surface differences and unresolved skipped dependencies, not a fabricated successful migration.
11. Ticket/customer data, ACLs, processes, DynamicFields, notification configs and arbitrary .opm execution are separate native contracts. Retain supplied originals as evidence; do not silently claim support from the ten-family contract above.
12. Full package inventory command is Admin::Package::List --show-deployment-info. Its output is text; it skips PackageIsVisible=false. It therefore is not by itself proof of a complete installed inventory. Package XML and deployment/custodian evidence may be required; preserve commands/output, do not parse guessed JSON.

## Useful existing components
The maintained Migration Acceptance project, history, native intake and reconciliation modules supply the original complete source/expected/actual comparison. The configuration adaptation adds native YAML capture, reviewed emission and independent returned-configuration preparation; the existing OTOBO operator performs the actual import.

## Source navigation
Native standard command: https://github.com/RotherOSS/otobo/blob/ed3cdf2b9b633fe3941ce15be16c5720006b1b38/Kernel/System/Console/Command/Admin/ImportExport/ImportStandardObject.pm
Queue source: https://github.com/RotherOSS/otobo/blob/ed3cdf2b9b633fe3941ce15be16c5720006b1b38/Kernel/System/Queue.pm
Group and permission replacement: https://github.com/RotherOSS/otobo/blob/ed3cdf2b9b633fe3941ce15be16c5720006b1b38/Kernel/System/Group.pm
YAML behavior: https://github.com/RotherOSS/otobo/blob/ed3cdf2b9b633fe3941ce15be16c5720006b1b38/Kernel/System/YAML.pm
GenericAgent source: https://github.com/RotherOSS/otobo/blob/ed3cdf2b9b633fe3941ce15be16c5720006b1b38/Kernel/System/GenericAgent.pm
Package list: https://github.com/RotherOSS/otobo/blob/ed3cdf2b9b633fe3941ce15be16c5720006b1b38/Kernel/System/Console/Command/Admin/Package/List.pm
The packet contains complete unmodified source and original upstream fixtures, with Git blob and SHA-256 identities. Upstream fixtures are examples/tests, not an actual customer's installation.


## Native helper and current complete capture boundary
The generic native toolkit is native/otobo-native-handover.pl, native/prepare-handover.mjs, native/commission-native.pl and native/NATIVE_HELPER.md. The installed native parser performs both decoding and emission; the browser does not recreate typed native values from ordinary JSON. The Node entry point invokes the original evaluateConfigurationPlan and requires ready before no-shell emission. There is no native import writer in this toolkit.

The target-context collector reads the original Valid/FollowUp/Owner/Lock/Priority/State maps plus complete Salutation/Signature/SystemAddress and Queue names. It retains original Get values and exact export-shaped shared objects so unused same-name target objects cannot be mistaken for absent data. The native shared transform follows Queue.ExportQueues: ValidID to Valid, strip ID/CreateTime/ChangeTime; SystemAddress QueueID to Queue. The collector records a timestamped read sequence, not an atomic database snapshot.

The original source baseline's actual YAML dependencies differ: cpanfile.snapshot selects 0.89; cpanfile.docker.snapshot selects v0.910.0. Installed capture records actual versions and source/module hashes. The strict helper requires duplicate-key-capable YAML::XS >=0.84, single document, no explicit tags/anchors/aliases, disabled code/blessed loading and a localized JSON::PP boolean representation. These admission choices are separate from the observed original wrapper defaults. Rejected originals are not rewritten.

Reference outputs are authored-reference examples, not real customer exports or proof of native import. Current native Perl/OTOBO execution and actual producer visual/attachment inspection remain pending in the same original receiving operation.
