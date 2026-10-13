# OSF Institutional Transition

This operator carries active OSF projects into the original DSpace Repository Workspace. It keeps the original project/component identities, contributor and access observations, linked storage, every selected file version, full metadata values, institutional targets, staff decisions, native execution results, and a complete editable receiving archive.

Open **OSF transition** from the existing Repository Workspace navigation. Both pages use the same SQLite workspace and original DSpace profiles, captures, plans, executions, request history and file store.

## Start and reopen

Use Node 24 or newer. From the complete repository source directory:

```sh
npm run bootstrap
node server.mjs --workspace /absolute/path/to/institutional-workspace --port 0
```

Open the printed local URL, then select **OSF transition**, or append `/osf`. The server binds to 127.0.0.1; use the institution's established authenticated access route when operating remotely. The source directory and retained workspace are separate. Reopening the same workspace retains its stable workspace ID and every original record.

The original bootstrap verifies and builds the included 4Science source and exact production dependency lock. It is needed for the native DSpace connection. Saved-source inspection, mapping, reconciliation, exports and receiving use Node's standard library and the existing SQLite store.

Create or select the destination profile in **Repository Workspace**. Use the exact DSpace REST URL and existing environment credential references. Capture the actual destination collection or item through that original page. OSF mappings select those full original captures and native UUIDs; a typed display label never becomes a destination identity.

Optional OSF credentials use an existing environment variable whose name starts with `OSF_`. Enter its name in the source form; values stay in the server process. OSF JSON API requests use that credential only for the production API origin. Original downloads follow their captured HTTPS links without forwarding credentials to other origins. When an institution's existing authenticated collector receives a file through its own authorized session, import the complete original source and bytes as described below.

## Choose continuing work

The Center for Open Science's transition notice says new projects and components stop on **November 16, 2026** and existing projects become read-only on **February 19, 2027**. Completed public projects can remain accessible on OSF. Decide which projects need continuing work and make a separate decision for every component; component privacy and ownership can differ from its parent. These dates and distinctions are recorded from the official material available on October 12, 2026.

Primary sources:

- [COS platform changes](https://www.cos.io/osf-changes)
- [OSF Projects transition](https://help.osf.io/article/727-osf-projects-transition)
- [Download and export content](https://help.osf.io/article/745-download-and-export-content)
- [Export wikis, metadata and logs](https://help.osf.io/article/746-download-individual-osf-wikis-metadata-and-logs)
- [Replicate project structure](https://help.osf.io/article/749-replicate-your-project-structure-in-other-repositories)
- [Redirect an OSF DOI or URL](https://help.osf.io/article/750-redirect-my-doi-or-url)

A project ZIP alone is not the full institutional transition. Source metadata, components, contributor roles, linked storage, wikis, activity and file-version history remain separately identifiable here. The official guide's example project ID is an example; it is not preloaded as an acquired institution or completed migration.

## 1. Receive the original source

### Native OSF capture

In **Source inventory**, enter the original project GUIDs and a source name. Choose whether to enumerate components, version history and full files. Optional selected file keys choose exact original versions after inspecting a complete metadata capture; keep the same root selection when taking a successor capture.

The collector follows the returned pagination and relationship URLs. Each original response keeps its body bytes, URL, role, project/file identity, retrieval observation, HTTP status and available headers. Failures remain source findings alongside received records. A final project/file metadata read identifies source changes during the capture.

The collector preserves a version resource's original `links.download` exactly, including a provider's `revision` selector. If a version has no such link but the parent file has an observed production WaterButler download endpoint, it uses that endpoint with the actual version ID in the documented singular `version` parameter. Provider and file path stay unchanged. The complete downloaded length and every available native hash are checked before saving the version with its original identity.

The official implementation and contracts are:

- [OSF FileVersionSerializer](https://github.com/CenterForOpenScience/osf.io/blob/develop/api/files/serializers.py)
- [OSF file version identifier](https://github.com/CenterForOpenScience/osf.io/blob/develop/osf/models/files.py)
- [WaterButler version/revision contract](https://waterbutler.readthedocs.io/en/latest/api.html#revision-version)
- [WaterButler OSF Storage download implementation](https://github.com/CenterForOpenScience/waterbutler/blob/develop/waterbutler/providers/osfstorage/provider.py)
- [OSF API schema](https://github.com/CenterForOpenScience/developer.osf.io/tree/master/swagger-spec)

The current original DSpace asset limit is 20 MiB per received file. An oversized or unavailable file retains its exact inventory entry and a visible receiving finding. A mapping can keep its source reference with a staff explanation; copying requires the complete supported original bytes.

### Complete original source import

Import an `osf-project-source/v1` JSON document. It contains:

| Field | Required original content |
|---|---|
| `roots` | Original project/component GUIDs selected for this capture |
| `documents[]` | Original JSON API responses and wiki bodies, each with role, node_id, URL, identity, status/provenance and full body bytes |
| `files[]` | Original node/provider/file/version IDs, source response identity, complete bytes, length and SHA256 |
| `findings[]` | Original collector observations that must remain visible |
| `collector`, timestamps | Actual collection configuration and timing, where available |

Each document uses `body_base64` or `body_text`; each file uses `content_b64`. A document's `id` is its original response identity. The supported roles include node, node-check, metadata, children, contributors, user, identifiers, addons, providers, files, file, file-check, versions, wiki-list, wiki-versions, wiki-content, logs, linked-nodes, registrations, preprints and license. `owner_id` identifies the original file for file/version responses.

The importer recomputes the inventory from these exact responses. It matches every supplied file to the original version record, checks declared sizes and available native digests, and preserves the original submitted source document. A summary, screenshot or list of filenames cannot replace these bytes.

A collector may instead write relative `body_file` and `content_file` paths beside its manifest. The CLI hydrates those files, checks their supplied digests/lengths and retains the exact original manifest. Paths must stay inside that manifest directory.

```sh
node scripts/osf_cli.mjs assemble-source --source /absolute/source/source-manifest.json --output /absolute/source/complete-source.json
node scripts/osf_cli.mjs import --workspace /absolute/path/to/institutional-workspace --source /absolute/source/complete-source.json --name "Original institutional OSF capture" --actor "Repository staff" --request /absolute/requests/source-import.json
```

The browser supports complete source JSON up to its 23 MiB selection threshold. The CLI uses the same importer without the HTTP JSON envelope.

Use the inventory selector to inspect every page of projects/components, files, versions, contributors, relationships, wikis, activity and exceptions. Original response and file downloads return complete saved bytes.

## 2. Save a destination mapping

**Destination mapping** starts from the actual source edition. Every component receives one decision:

- **CONTINUE**: continue work at an institutional target.
- **KEEP_OSF**: retain the OSF project with its original URL and a staff reason.
- **EXCLUDE**: exclude from this workshare with an explicit reason.

Continuing entries select a captured destination collection or item and a native mode:

| Mode | Original DSpace behavior |
|---|---|
| `CREATE_DRAFT` | Create an empty native workspace submission, then retain its actual item and submission identities |
| `CREATE_ARCHIVE` | Administrative immediate archival creation, selected explicitly for public material |
| `UPDATE_ITEM` | Use the exact original item UUID and capture already selected by staff |

Record intended access, rights/permission review and the reviewing staff member. A restricted source uses the institution's draft/access workflow. Metadata remains a field object whose values are full arrays of objects; language, authority, confidence, order and additional native properties survive editing. The full JSON editor supports fields beyond the visible convenience controls.

For every captured version in a continuing component, choose **COPY**, **REFERENCE** or **EXCLUDE**. COPY requires received original bytes. Reference and exclusion preserve the source version and a staff explanation. Linked providers and inherited storage are visible source records, rather than silently flattened into OSF Storage.

Save the complete mapping before review. Review is bound to the exact source and mapping SHA256. All observed source exceptions need explicit acknowledgement for an approval. A later mapping is a new immutable edition.

A successor mapping keeps the original adopted institutional target and accepted file lineage. It changes a carried creation decision to UPDATE_ITEM against that exact original target. Creating a deliberately different destination requires a new-destination explanation.

## 3. Operate the original DSpace phases

Use **Native operations** after approving the selected mapping.

1. **records** prepares the original create-draft/create-item operations that do not already have accepted targets.
2. Inspect the complete original plan, record its approval, and apply through the unchanged DSpace MCP bridge.
3. Open the original execution. If interrupted, recover that execution and inspect its actual native responses before continuing.
4. **Adopt** accepted steps into the OSF mapping. The adoption reads the existing execution; it does not send native writes.
5. Repeat for **metadata**, then **files**. Each metadata operation uses exact captured fields and full native value arrays; each file operation retains its original version identity, length and SHA256.

The original engine allows 100 native steps per plan. The transition retains the whole selected cohort and prepares the next batch of up to 100 unfinished steps. Its receipt includes `remaining_steps`. Apply and adopt that original batch before preparing the next batch under a new request ID. Repeated preparation while a batch remains unresolved reopens its original native plan. A successor mapping likewise points to an unresolved original creation/upload instead of duplicating it.

The original bridge rechecks the institution, principal and touched fields before writing. Changed staff data becomes a corrected-plan decision. Original request/subject IDs and returned source captures support lost-response recovery. A newly created draft is distinct from an archived item and remains subject to the institution's actual submission workflow.

No upload, create or external request should be repeated just because the browser response was lost. **Drafts & requests** exposes the original retained command and current native receipt. A CLI example for the same phase is:

```sh
node scripts/osf_cli.mjs prepare --workspace /absolute/path/to/institutional-workspace --input /absolute/inputs/prepare-records.json --actor "Repository staff" --request /absolute/requests/prepare-records.json
node scripts/osf_cli.mjs action --workspace /absolute/path/to/institutional-workspace --action review-plan --input /absolute/inputs/native-review.json --actor "Repository staff" --request /absolute/requests/native-review.json
node scripts/osf_cli.mjs action --workspace /absolute/path/to/institutional-workspace --action execute-plan --input /absolute/inputs/native-execution.json --actor "Repository staff" --request /absolute/requests/native-execution.json
node scripts/osf_cli.mjs adopt --workspace /absolute/path/to/institutional-workspace --input /absolute/inputs/adopt-original-execution.json --actor "Repository staff" --request /absolute/requests/adopt-original-execution.json
```

The complete preparation input is `{mapping_id,mapping_sha256,review_id,phase}`. Native review uses `{plan_id,decision,note}`; native execution uses `{plan_id}`; adoption uses `{native_plan_id,execution_id}`. The retained command adds actor, original operationId and current revision before dispatch.

## 4. Reconcile changing sources and staff edits

Take a successor source capture with the same original roots. In **Changed sources**, compare it to the chosen saved mapping. Each metadata comparison retains the original default, staff's current mapped value and incoming source value. Select the local value, incoming value or a complete custom array when both changed.

New components require complete new mapping entries. Missing components and original file versions require explicit decisions. File choices retain their exact version keys. Save the reconciled successor, review it, and continue through the same original target lineage. Prior mappings, decisions and captures remain inspectable.

Comparison input is `{mapping_id,mapping_sha256,incoming_source_id}`. Reconciliation uses `{comparison_id,comparison_sha256,name,choices,new_entries,file_choices}`. A custom field choice is `{side:"CUSTOM",value:[...]}`; removal of an absent component is recorded under its `node:GUID` key. The browser writes these complete structures.

## 5. Freeze and receive the full handover

**Receiving & cutover** offers two explicit states:

- **WORKING_HANDOVER** retains the complete selected project, mapping, review, original source bytes, current native history and requested drafts for continued institutional work.
- **CUTOVER_REVIEWED** also requires accepted targets, all selected native copies, mapped metadata, institution URLs, access review and receiving staff acceptance.

The frozen manifest retains its exact source and mapping SHA256, full component decisions, native UUIDs, original files, exclusions, references and destination table. Later workspace edits do not rewrite the frozen handover.

Download both the manifest and complete `.tar.gz` archive. The archive contains a selected original SQLite workspace, all referenced original blob bytes, the frozen handover and receiving instructions. It includes the full source/review/execution graph needed by this delivery and only drafts explicitly selected for inclusion. Install the matching complete operator source alongside it.

Receive into a **new empty workspace**:

```sh
node scripts/osf_cli.mjs preview --workspace /absolute/path/to/new-recipient-workspace --source /absolute/delivery/institutional-transition.tar.gz --output /absolute/requests/receive-preview.json
node scripts/osf_cli.mjs receive --workspace /absolute/path/to/new-recipient-workspace --source /absolute/delivery/institutional-transition.tar.gz --preview /absolute/requests/receive-preview.json --actor "Receiving repository staff" --request /absolute/requests/receive-original.json
node scripts/osf_cli.mjs state --workspace /absolute/path/to/new-recipient-workspace
```

The browser accepts the same full archive, displays its saved preview and applies that exact SHA256. Receiving checks member names, declared lengths and hashes, source/record identities, the original selected snapshot and native references. It recomputes source inventory from original response bytes. All imported records and the receiving marker commit in one SQLite transaction.

If interrupted before that transaction commits, resume the **same** original archive request. If the transaction committed but its reply was lost, its retained receiving marker supplies the original result. A destination containing different work stays intact. The recipient keeps its own workspace identity and receives the original record identities.

An original OSF administrator requests any DOI/URL redirect only after the actual institutional destination and access decision are accepted. The manifest retains the original and destination URLs so that administrator can follow the official redirect process.

## Drafts and original-request recovery

Browser form state uses the workspace's stable ID and a separate tab identity. The page stays inactive while its original saved head is loading, so early keystrokes or actions cannot be replaced by a late startup restore. If loading fails, Refresh resumes that same opening process. Every source, mapping, review, native plan, execution, comparison and handover selector is part of the retained form. Native execution resolutions are kept under their exact execution ID; choosing another execution opens its own resolution draft. Complete immutable draft checkpoints precede view/selection changes and submitted operations. Incomplete JSON text remains editable. Review notes, mapping-entry fields and handover decisions retain their original context. File selections are cleared when changing or restoring source context; original imported bytes live with their saved command.

Use **Save draft** to retain a complete form edition in the native workspace. Download a full draft or original request from history. Working drafts can accompany the selected institutional archive. A received draft is opened only after its original source records are available in the receiving workspace.

Every CLI mutation requires `--request`. Its complete request file is staged and synced before dispatch. Request, result and export files are staged completely in their original output directory, synchronized, and published through an exclusive final-file link. An interruption before publication leaves the final filename available for the same command; a published final file contains the complete original bytes. Repeating an identical publication reads those bytes back. A different existing file is preserved. Request and export directories should be private. After a lost response:

```sh
node scripts/osf_cli.mjs operation --workspace /absolute/path/to/institutional-workspace --id ORIGINAL_OPERATION_ID
node scripts/osf_cli.mjs resume --workspace /absolute/path/to/institutional-workspace --request /absolute/requests/original-command.json
```

When no original operation exists and only the workspace revision moved, `resume --rebase true` refreshes that revision while keeping source, mapping, review, archive and native target identities fixed. It cannot change an existing operation's original body.

## File/API reference

| Interface | Purpose |
|---|---|
| `scripts/osf_cli.mjs help` | All read, import, capture, mapping, native, receiving and original-resume commands |
| `GET /api/state` | Existing repository state plus stable workspace identity and OSF catalogs |
| `GET /api/records/{kind}/{id}` | Full retained record or paged source inventory; OSF record kinds start with `osf_` |
| `POST /api/actions/osf-*` | Same queued workspace dispatch and original operation ledger |
| `POST /api/downloads` | Complete saved JSON, original response/file, manifest or archive download |
| `POST /api/receiving/archive` | Complete streamed archive and durable original preview |
| `POST /api/actions/restore-file` | Apply the exact received archive through the original receiving operation |

Source inventories page at up to 100 records. Metadata and source import use the same full-body contract through CLI and HTTP. The browser serializes state-changing UI operations while preserving current forms and original requests. The server's existing queued workspace dispatch preserves local operation ordering.

## Source and license

This is an additive module of the original DSpace Repository Workspace. Native DSpace calls use [4Science/dspace-mcp at ee503ba97910f592867c897c1fa938f9e029d03c](https://github.com/4Science/dspace-mcp/tree/ee503ba97910f592867c897c1fa938f9e029d03c). The complete upstream source and AGPL license stay under `vendor/dspace-mcp`; original notices and operating guide remain included. Follow [NOTICE.md](NOTICE.md), [README.md](README.md) and [API.md](API.md) for the original engine.

The OSF help guides have their own published licensing. Individual project files, linked storage, contributor information and institutional destination rights are reviewed from their original source; an OSF platform notice does not replace those rights.
