# Publish an accepted field edition into the existing database project

This workflow takes a completed office acceptance from the maintained QField workflow, lets an operator bind and review its changes against the current PostGIS edition, and publishes an explicitly reviewed successor. It then refreshes the existing QGIS project and produces a complete receiving handover.

The field collection, return comparison and office synchronization remain the original [QGIS Field workflow](../qgis/FIELD_OPERATIONS.md). The database continues to use the original [PostGIS intake and publication controller](OPERATOR.md). A field acceptance is evidence for a proposed database change; it is not an instruction to overwrite a database row.

## What is retained

The importer reads the exact original accepted map, campaign, export round, returned bundle, review SQLite database, accepted and preceding office editions, source receipts, and committed field.accept request/result. It verifies that the native QgsOfflineEditing.synchronize result matched the reviewed features and produced the selected accepted edition. It retains these files without synchronizing the field return again.

Each original review change keeps its sequence, original JSON body, stable feature identity, before/after attributes and geometry, and issues. The change ID is derived from the original review-file SHA256 and sequence. Attachments remain original evidence; this workflow does not claim an upload or a database attachment API.

A saved database review binds every original change to a keep/apply decision, an attributed reason, the selected original source, current database revision and profile, actual role-visible target rows, complete attribute choices, and native type/CRS observations. Publication rechecks those bindings inside the original promotion transaction.

The new live edition preserves the original vector baseline and earlier live tables. Field changes are applied to the new live table. The existing stable views switch only when the same promotion transaction commits. Existing source identities and the _sf_source provenance column remain intact. New field features receive the database's existing operator identity defaults; the importer does not reuse a field feature ID as sf_id.

A repeated accepted change is identified by its original office workspace, accepted field edition, original acceptance request, and review change ID. Exporting that same acceptance again after an unrelated campaign change does not make its already-published changes new.

## Before beginning

Use an existing accepted PostGIS project and its reviewed profile. The original connection configuration is a separate private JSON file. Credentials are never part of the profile, programme, browser settings, or handover source.

The field workspace must already contain a completed accepted office map. An exported phone round, an unreviewed return, a synchronization in progress, or a failed native acceptance is not a publishable source.

The producer profile must already name the actual existing database schema, stable relations, mapped columns, geometry types and SRIDs, and existing roles. Apply choices require the selected role's actual SELECT plus UPDATE, INSERT or DELETE permissions. Original row-level policies remain active. A row visible under another role is not silently adopted.

For the full native continuation, retain the existing QGIS workspace and its old PostGIS receipt, installed QGIS Python, private profile directory, libpq service, authentication reference if used, and actual reader role. The preceding database map may be in the accepted field workspace or in a separate existing receiving workspace; both identities are explicit. No QGIS or database is installed by this continuation.

The Python source reader needs the complete maintained stac/qgis package beside stac/postgis. Source inspection itself is file-only. Native QGIS is required for the later project check, save, render and reopen.

## Operator workflow

Start the normal private operator:

~~~sh
node stac/postgis/cli.mjs serve \
  --connection /absolute/private/producer.json \
  --profile /absolute/original/profile.json \
  --workspace /absolute/original/postgis-workspace \
  --port 0
~~~

Use the returned loopback URL and its original session. The new **Field corrections** pane uses that same selected profile, workspace and durable operation journal.

### 1. Select the completed office acceptance

Enter the original office workspace path and read its accepted maps. The inventory shows the actual workspace/revision, campaign, round, return, accepted actor/time, original configuration and accepted edition SHA256.

Select the exact accepted map, enter your actor and retention reason, and retain it. This creates one field-import operation. It does not change database feature rows or switch the active edition.

The source panel exposes the original acceptance request, full source manifest, configuration and lineage. The retained source operation can be reopened from its ID or from **Operations → Open field workflow**. It remains available after the donor workspace moves because the import copied and verified its original file closure.

### 2. Decide every original change

The pane pages all original review changes. Select a row to inspect the original identity and before/after data.

For **Keep**, enter a reason. This means retaining the current database state while preserving the field change as evidence. Every original change needs a decision; leaving a page unseen does not imply approval. The explicit “keep remaining” control requires a reason and reads the complete source before saving those decisions.

For **Apply**, choose an actual configured target layer and role. Search reads the current stable view through that selected role and returns the original sf_key, exact attributes JSON, row hash, and total/paging metadata. The search is a literal case-insensitive substring over the retained key and displayed attributes, or an exact sf_id text match. It is not a new matching engine.

For a changed feature:

- Bind the original stable sf_key explicitly.
- Choose **current** or **field** for every changed original attribute.
- For each field choice, select the actual mapped destination column.
- Review the original field “before” value beside the actual database value. A discrepancy remains visible and requires the operator's decision.
- Retain or apply the geometry explicitly. An applied geometry needs the original field CRS and an explicit source SRID.

For an added feature, select the destination layer/insert role, map every destination column from an original accepted attribute, and choose the accepted geometry. The original database assigns its operator sf_id/sf_key. For deletion, select the precise existing key and delete-capable role. Two field changes cannot target the same current row in one review.

Native PostgreSQL casts determine the stored value. The review retains the exact input and returned stored text, including null. The original codecs preserve binary and exact JSON numeric representations. Native PostGIS checks the transformed geometry, dimensionality, type and validity against the frozen profile. No coordinate system is inferred from a filename or a visual resemblance.

An attachment change can be kept as evidence. It cannot be marked applied by inventing a file upload or target record.

### 3. Freeze the database review

Enter a review actor and reason, then preview the complete decision set. The preview reads actual current rows, types, CRS definitions, roles and the current edition. It exposes all findings and exact native before/after observations.

Commit the unchanged preview. The field-review operation stores the entire review and its SHA256. Editing the draft, changing the selected profile, or advancing the database invalidates an uncommitted preview. Previous committed reviews remain historical; they are not rewritten.

Stage the saved field review. The controller retains the active edition's original vector source in a new staged edition and links the exact field review to it.

### 4. Use the original publication review

The normal **Review** pane shows the staged successor, source/customer differences and linked field review. Resolve any ordinary source/customer conflicts through the existing keep-current/take-source decisions. The field plan remains separately explicit.

Publish the exact reviewed revision. The original promotion transaction:

1. Revalidates the full source/customer review and current revision.
2. Creates the successor live tables and applies the normal source/customer preservation decisions.
3. Rechecks the committed field plan against the actual preceding live rows.
4. Applies the selected field changes to those new live tables under each actual selected role.
5. Verifies affected row counts, stored values and native geometry.
6. Records the field review/source lineage and switches the existing stable views.

A changed target row, changed role/profile, missing source member or stale review stops publication. Earlier live editions are retained for the original rollback command. Rolling back selects the original retained edition; it does not erase the accepted field review or publication history.

### 5. Receive and reopen

Use the normal receiving and full database backup controls. The receiving package adds field-evidence.json and the complete retained field source for every field correction in that edition's history. Each item includes the original import, review and promotion requests/results.

A full database backup also retains all field-import packages referenced by original operation history, including imports not yet published. Restore copies those exact sources before importing the original metadata. A restored database profile is distinct from the historical source profile. Use **Recover committed operation** to inspect an old operation; do not replay its old profile-bound mutation against a new target.

For QGIS, use the original explicit successor review: update the current logical map layers to the newly accepted database receipt. The original engine preserves styles and unrelated layers. A keep decision retains the old receipt; if the stable view now serves a successor, its original preflight may correctly report that old selection as stale. Complete native receiving requires the selected map layers to have resolvable current bindings.

## CLI and JavaScript interfaces

The following commands use the same private connection, profile and workspace arguments as the normal controller. Each takes --request with a complete original JSON request.

| CLI action | Intake method | Purpose |
|---|---|---|
| field-inspect | inspectField | Read accepted maps from the original office directory |
| field-import | importField | Retain one exact accepted source |
| field-source | readField | Page the retained original changes and context |
| field-targets | fieldTargets | Read current target rows under the selected role |
| field-preview | previewField | Build the full native current-state review |
| field-review | saveFieldReview | Commit the exact unchanged field review |
| field-stage | stageField | Stage the saved plan through the original producer |

~~~js
const intake = await openPostgisIntake({
  connection, profile, directory: "/absolute/original/postgis-workspace", python
});
try {
  const maps = await intake.inspectField({
    workspaceDirectory: "/absolute/original/office-workspace"
  });
  // Select the actual map returned above. Retain its exact IDs and edition SHA.
  const imported = await intake.importField({
    operationId, workspaceDirectory, workspaceId, fieldProjectId,
    fieldEditionSha256, actor, note
  });
  const page = await intake.readField({
    sourceOperationId: imported.operationId, offset: 0, limit: 100
  });
} finally {
  await intake.close();
}
~~~

An import request is:

~~~json
{
  "operationId": "ONE_RETAINED_IMPORT_ID",
  "workspaceDirectory": "/absolute/original/office-workspace",
  "workspaceId": "ACTUAL_ORIGINAL_WORKSPACE_ID",
  "fieldProjectId": "ACTUAL_ACCEPTED_FIELD_MAP_ID",
  "fieldEditionSha256": "EXACT_ACCEPTED_EDITION_SHA256",
  "actor": "ATTRIBUTED_OPERATOR",
  "note": "WHY_THIS_ORIGINAL_ACCEPTANCE_IS_BEING_RETAINED"
}
~~~

A preview request has sourceOperationId, expectedRevision, actor, note and bindings. The same body plus operationId and the returned reviewSha256 is passed to saveFieldReview. Each binding is one of:

~~~json
{
  "changeId": "EXACT_ORIGINAL_CHANGE_SHA256",
  "disposition": "keep",
  "note": "EXPLICIT_REASON_FOR_RETAINING_CURRENT_DATABASE_STATE"
}
~~~

~~~json
{
  "changeId": "EXACT_ORIGINAL_CHANGE_SHA256",
  "disposition": "apply",
  "note": "EXPLICIT_REASON_FOR_THE_TARGET_MAPPING_AND_CHANGE",
  "target": {
    "layerId": "EXISTING_PROFILE_LAYER",
    "rowKey": "EXACT_CURRENT_SF_KEY",
    "role": "EXISTING_APPROVED_ROLE",
    "sourceSrid": 0
  },
  "fields": [
    {
      "sourceName": "ORIGINAL_CHANGED_ATTRIBUTE",
      "choice": "field",
      "targetName": "EXISTING_MAPPED_COLUMN"
    },
    {
      "sourceName": "ANOTHER_ORIGINAL_CHANGED_ATTRIBUTE",
      "choice": "current"
    }
  ],
  "geometry": "current"
}
~~~

These are configuration templates, not observations or ready-to-submit requests. Replace all placeholder IDs/fields and the zero SRID using the actual retained source and native target profile. Omit sourceSrid when geometry remains current. Use geometry="field" with an actual positive source SRID when applying a geometry. For an added feature, omit rowKey and supply every required target column mapping; its native identity is assigned at publication. For deletion, use an empty fields list and geometry="current".

Target read requests use layerId, role, offset, limit and optional search. Offsets start at zero; page sizes are 1–500. readField has the same paging range. The browser uses the returned total and preserves every original source row.

## Complete native receiving programme

The [programme template](field-publication.example.json) is deliberately incomplete. It contains no invented field acceptance, target connection, live database result or QGIS workspace.

Run the complete configured programme with the released installation:

~~~sh
node stac/postgis/field-publication.mjs \
  --input /absolute/private/original-field-publication.json
~~~

The exported JavaScript function is runFieldPublication(input, {signal, processSignals, progress}). Embedding hosts should pass their AbortSignal and processSignals=false so the original parent lifetime owns signals.

### Continue a publication already made through the operator

Fill publication.importOperationId, reviewOperationId, stageOperationId and promoteOperationId from the actual **Operations** history. Optionally pin publication.reviewSha256 to the field review SHA. This mode recovers those four committed original records read-only, checks their exact dependency chain and selected accepted source, and continues receiving. It never submits a replacement import, review, stage or promotion.

Use this mode after operating the UI. The programme does not assume that a missing local phase file means an already-committed business action should be repeated.

### Execute a reviewed source programme

For an explicitly approved new publication, omit publication and supply:

- expectedRevision and expectedEditionId from the actual current database project.
- bindings containing every original field change decision.
- promotionDecisions containing the ordinary source/customer choices, or an explicit empty list when there are no conflicts.

The programme previews and commits those exact field decisions, stages the original baseline and executes the original publication review. Every mutation receives one retained request ID before dispatch. The original request file, source, actor, review and result are preserved.

The complete configuration includes:

| Setting | Required meaning |
|---|---|
| connectionFile | Existing private producer connection JSON; permission mode must exclude group/other access |
| profileFile | Actual reviewed original PostGIS profile |
| workspaceDirectory | Existing original producer workspace |
| outputDirectory | New or same original output directory |
| deliveryReceivingDirectory | Separate new or same complete handover receiving directory |
| python | Actual Python capable of reading the maintained QGIS field source and packaging files |
| source | Exact original office directory, workspace ID, accepted map ID and edition SHA |
| actor, note | Attributed receiving/publication operator and purpose |
| qgis | Actual installed QGIS runtime, original workspace/profile/service, successor decisions and independent receiving destination |

The qgis object requires python, profileDirectory, workspaceDirectory, workspaceId, expectedRevision, leftSourceId, layerIds, decisions, note, title, connection and receivingDirectory. prefixPath and projectCrs are optional. layerIds are receipt layer IDs; each decisions[].layerId is the existing logical QGIS map layer ID. These are different identifiers. The original review requires every current layer associated with leftSourceId to have an explicit keep/update/remove choice.

qgis.connection uses only the maintained schema/profileId/service/authConfigId/role/sslMode/allowEditing fields. allowEditing is false. The profile must already have its local authentication configuration. No password or database URL is passed into the QGIS handoff. The private profile must be outside the original office/producer workspace and every output, receiving or restore root; reverse overlaps are rejected as well. In particular, do not put a profile under outputDirectory/qgis. The parent and native child check this boundary before the profile can be used or any QGIS output packaged.

Optional reader supplies an existing private reader connection file and actual role for an additional native whole-row verification. Optional restore supplies a distinct empty target database profile, private connection file and receiving workspace for an actual original database restore/readback. These flags are reported as performed only when their native operations complete.

Optional browser supplies the existing Playwright module and Chromium executable. It opens the actual field source and committed publication recovery screens, saves screenshots, and verifies that the database operation count and revision did not change. It does not invent another browser request or source population.

### Native sequence and evidence

The programme places the exact publication snapshot into each original export request. Receiving and full backup validate its edition, revision and complete layer/row/role observations under the core table lock before their first capture. The programme also verifies the actual receiving and backup metadata after readback. If later customer edits have changed them, it retains the original continuation and asks for an explicit current-state review rather than claiming those rows were the originally approved result.

The original QGIS child receives the exact new database manifest, checks complete role-visible data, imports the source into the existing workspace, calls its original review_successor, saves/reopens the native project, refreshes the actual layers, renders the map, exports the complete original workspace, receives that ZIP into a separate destination, and reopens/renders it there. The original events, requests, old maps and accepted field source remain preserved.

A final complete handover ZIP contains:

- The accepted database receiving manifest, original vector source and full cited field evidence.
- The complete database backup with original operation and field-source history.
- The exact QGIS handoff, native result, observations, map images and complete project ZIP.
- Original phase requests/results, original operation records, optional reader/restore/browser observations, and this guide.
- A frozen delivery manifest listing the exact byte count and SHA256 of every included file.

The installation remains separately versioned. The delivery manifest records the released caller/helper/UI identities; the full maintained SDK is required for database operations. The complete QGIS export carries its native project application/receiving files through the existing packager. Native binaries, database passwords and private authentication material are not bundled by this workflow.

### Interruption and resume

Retain the same complete programme JSON, original paths, selected release and operation ID. Rerun the exact command after the original process has stopped.

The caller holds a real session advisory lock for its whole lifetime in the configured original database. Each producer phase also uses the original core's request hash, committed operation and transaction/CAS rules. The original QGIS child owns its existing workspace/operation lock.

A lost response is resolved through the original committed operation. A missing committed export remains unavailable; the caller does not capture a later replacement snapshot under that old ID. If a mutation exists but its original local phase intent has disappeared, the new-programme path stops. Use the explicit publication-adoption mode with the reviewed original operation IDs; do not infer the original request from a current preview.

Original receiving observations and phase results are durable before the next phase begins. SIGINT/SIGTERM stops progression, drains the in-flight native work, closes database/browser resources, and waits for the original QGIS process. A child that does not stop after TERM receives an owned process-group KILL after ten seconds. A successful completion record is written after cleanup.

If the original QGIS project archive was published before the final receiving result, continuation verifies that archive and its frozen snapshot, recovers the exact original phase requests/results and native observations, then reopens the received frozen project. It does not reapply the old selection to a later office state. All frozen original events and committed requests must still be retained. The final result keeps the exported revision/history and reports the currently observed office revision separately in currentOriginalWorkspace. An already recorded archive that is missing remains unavailable.

Completed replay verifies the original receiving, backup, QGIS result, complete project ZIP, images, observations, handover archive and receiving copy. It returns the saved result without claiming another native publication or new QGIS measurement. Continued edits in an independently reopened business workspace do not alter the frozen incoming handover files.

## Inspect and receive the complete handover

Use the helper from the installed reviewed release:

~~~sh
python3 stac/postgis/field_delivery.py inspect \
  --archive /absolute/Starforge_Field_Successor_Complete_Handover.zip

python3 stac/postgis/field_delivery.py receive \
  --archive /absolute/Starforge_Field_Successor_Complete_Handover.zip \
  --destination /absolute/new/received-field-handover
~~~

It verifies every ZIP member, declared size, CRC/SHA256, portable path and manifest binding before completion. It creates only the selected original receiving files, resumes matching original files after interruption, and rejects a different original archive at the same receiving destination. It does not execute incoming code, contact a database, synchronize field data, or start QGIS.

The resulting receipt explicitly states databaseRestored=false and qgisExecuted=false. To use the received database backup, configure the actual destination through the original restore-backup command:

~~~sh
node stac/postgis/cli.mjs restore-backup \
  --connection /absolute/private/destination.json \
  --profile /absolute/reviewed/destination-profile.json \
  --workspace /absolute/new/destination-producer-workspace \
  --request /absolute/private/original-restore-request.json
~~~

The restore request uses one original operationId, the received database-backup directory and its exact postgis-backup.json SHA256. The original restore engine validates destination schema/roles and retains historical request identities.

Use the received qgis/Starforge_PostGIS_QGIS_Complete_Project.zip with the maintained QGIS receiving workflow. Configure that recipient's actual local service/authentication profile before native reopen. The original receipt still points to its accepted database identity; a different database/profile requires explicit receiving and successor review.

## Source and operating boundary

This is a continuation of actual accepted field data and existing publisher/customer work. It does not fabricate a field observation, issuer correction notice, native permission result, customer row, database tenant, or completed delivery. The original field acceptance, this attributed publication decision, any later authorized customer edit, and the final receiver's observation remain distinct records.

The new source does not launch a cloud job or build a parallel QGIS/PostGIS engine. The original project/native execution owner supplies the real accepted field workspace and equipped database/QGIS host. Until that configured whole journey has actually run, source parsing, source review and successful package construction are software evidence only; they are not a claim of native field/database commissioning.
