# Released Central source into the field workspace

This driver completes the original Central host's source receiving operation. It creates a private native project containing the released upstream form/submission fixtures, retains actual REST receipts and source bytes, then invokes the existing native field-workspace receiver through capture, review, dataset/report export, full archive and reopening.

The selected source is Central v2026.3.1, frontend7d6de621955c5bb6a68e098ca10c9cbb92285cdf and backendde0d2a07fd7c9ff698cbc312e550dd40ff058340. The fixture module identifies the precise original files/blobs and any documented form-version/submission metadata substitutions. The native server processes these original XML forms, repeats, version chains and named attachment bytes.

## Run after the existing host bootstrap

Keep DCE4's existing host configuration, deployment and operation. After its original bootstrap command has written connection.json and connection-secret.json, run:

~~~sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/odk/native/run-released-fixtures.py \
  --host-config /private/central-host.json \
  --work-directory /srv/central-cb57/receiving
~~~

Use the existing installed Node/StarForge source and dependencies. If its Node executable is not on PATH, pass --node with that actual executable. The complete current ODK source, SF30/SF82 dependencies and released-fixtures.mjs must be present; the launcher does not install another runtime or start another Central service.

The host's operation_id and this driver use SCF-ODK-CENTRAL-FIELD-WORKSPACE-CB57-20261012. --operation can select another explicitly retained host operation. --project accepts an explicitly selected existing native project; otherwise the first journal records one unique project name before its native create request.

The launcher reads only the existing host's private credential file and selects its exact authEnv. It sets NODE_EXTRA_CA_CERTS before starting Node. The process retains normal HTTPS certificate validation. No authorization value enters a command argument, source record, report or printed result.

## What the operation receives

The complete flow uses the released Central REST API:

1. Read /version.txt and the authenticated original user; require the selected frontend/backend commits.
2. Create or recover the original operation's native project.
3. Create the original published forms, then create and publish each explicitly retained later form version.
4. Submit the original XML, update the selected submission through its current deprecatedID, and upload the exact named fixture attachment bytes.
5. Read every resulting original version XML and uploaded attachment and compare its bytes to the retained input.
6. Save the exact receiving-request.json with actual native project/form IDs, selected tables, expected source counts and original connection reference.
7. Call receiveCentralWorkspace from the existing receive.mjs. It captures complete root/repeat pagination, original form generations, all submission versions and media; records the authored source review; exports the original datasets and reports; creates the complete archive; and reopens and compares the same saved source on the receiver.

The binary fixture payloads are labeled upstream fixture bytes, including their original filenames and content types. Their role is to exercise the native media lifecycle. Original source definitions and fixture provenance travel with the operation.

## Original records and recovery

The work directory contains:

| Path | Retained content |
| --- | --- |
| provider/fixture-operation.json | Original request/source hash, native project selection, each prepared request and accepted response, and stage progress. |
| provider/inputs/ | Exact uploaded XML, JSON and media request bodies by SHA-256. |
| provider/responses/ | Complete observed REST response bodies by SHA-256; receipts retain status, selected headers, path, time and request identity. |
| provider/receiving-request.json | Complete existing receive.mjs request using the returned native IDs. |
| workspace/ | Original Central field workspace and source graph. |
| receiving/ | Original receiving journal, full comparison result and saved export identities. |
| restored-workspace/ | The original full archive reopened by the existing receiver. |
| provider/result.json | Joined source/host/native-ID/receiving result. |

Rerun the exact same launcher and paths after an interruption. The original SF82 kernel lease serializes this one operation. The driver checks an existing native form or submission version before any resend; fixed form/version/instance identities use the provider's original uniqueness and version checks. Every response and request body is retained. A completed result returns its retained original identity.

Project creation has no provider idempotency key. If that one response is lost, recovery searches the exact journaled unique project name. It does not issue a second ambiguous create. The original native request/name and any observed response remain in the operation for reconciliation.

A later submission version does not authorize uploading a missing older attachment to the new current version. The driver checks the original current-version identity before a media upload and preserves the older version's actual source.

The provider fixture is created once; later retries resume the same existing field capture/review/export operation. A completed form, submission, review or archive is read back through its original saved identity.

## Existing host handover

The final request path is /srv/central-cb57/receiving/provider/receiving-request.json for the example invocation. The driver itself writes its exact SHA-256 after the real provider IDs exist. It then runs the receiver immediately and continues through the same workspace’s complete two-period commissioner.

Return provider/programme-result.json, provider/result.json, receiving/result.json and receiving/commissioning/result.json to the original Central product thread with the host's existing handover.json. Keep the complete private provider journal, workspace and any original service backup in the authorized existing host storage. The source code and fixture provenance are suitable for the existing project repository; host credentials remain in their original private custody.

## Same-service two-period commissioning

The same command next invokes `native/receive-released-periods.mjs`. It reopens the completed original workspace and uses 14F5’s maintained commissioning engine. The original five-root capture, repeat tables, form/submission versions and media remain in that workspace.

The native simple table supplies three exact `__system.submissionDate` values. The first period selects roots `one` and `two`; its exclusive end is root `three`’s recorded submission time. The second begins at that same instant and ends at its next supported millisecond. The driver verifies the actual predicates and complete original page receipts before saving the agreement. It preserves provider timestamps without writing business dates into the source.

The original programme creates two immutable source plans, captures the two actual provider-filtered cohorts, records the authored source review, and calls `commissioning.deliver`. Both approved datasets include `__id`, `name`, `age` and `__system/submissionDate`, with the native value/state columns and full dictionaries. The original reports calculate 2 rows / mean 32 / total 64 and 1 row / mean 38 / total 38, and retain the complete period comparison.

The resulting full archive is restored into `restored-workspace-commissioned/`. Original source rows, histories, accepted reviews, commissioning definition and every output file are compared by their saved identity. The restored original commissioning operator recognizes that incoming handover as `RECEIVED_PORTABLE`.

| Additional path | Retained content |
| --- | --- |
| provider/period-receiving-request.json | Actual original workspace, connection, project and full capture IDs. |
| provider/programme-result.json | Complete fixture, full receiving and commissioned delivery result references. |
| receiving/commissioning/period-receiving.json | Exact period source, retained request IDs, review boundaries and continuation. |
| receiving/commissioning/native-period-boundary.json | Original row timestamps and provider page receipts used for both predicates. |
| receiving/commissioning/source-report-agreement.json | Complete saved source/report agreement. |
| receiving/commissioning/commissioning-delivery.json | The original complete commissioning delivery, including native dataset and report identities. |
| receiving/commissioning/warehouse-selections.json | Exact period/dataset/capture/table/review selection and fixed receiving request IDs for the original PostgreSQL consumer. |
| receiving/commissioning/result.json | Actual complete commissioned output and archive-reopen result. |

`warehouse-selections.json` is the native caller’s exact input selection. The maintained same-Store warehouse bridge creates its original approval documents from those selections; it retains the accepted CSV projection and all original export receipts. Its PostgreSQL connection remains the selected existing receiving profile. The receiving source does not infer a database or credentials from the Central deployment.

The full API and recovery behavior are in [RELEASED_PERIODS.md](RELEASED_PERIODS.md).

## Complete approved PostgreSQL receiving and customer handover

The original launcher also carries this same complete programme through the
approved-period warehouse receiver from PR2260, then assembles the actual
customer handover. Supply the existing receiving host's four warehouse
arguments together:

~~~sh
python3 stellar/scf-starforge-20261009/sf30-seller-sdk/odk/native/run-released-fixtures.py \
  --host-config /private/central-host.json \
  --work-directory /srv/central-cb57/receiving \
  --warehouse-profiles /private/central-warehouse-profiles.json \
  --warehouse-profile approved-periods \
  --warehouse-reviewer "Original receiving operator" \
  --warehouse-note "Receive the complete approved native columns with their original row keys."
~~~

The installed receiving entry forwards this same original command:

~~~sh
starforge odk-central-receive released \
  --host-config /private/central-host.json \
  --work-directory /srv/central-cb57/receiving \
  --warehouse-profiles /private/central-warehouse-profiles.json \
  --warehouse-profile approved-periods \
  --warehouse-reviewer "Original receiving operator" \
  --warehouse-note "Receive the complete approved native columns with their original row keys."
~~~

Use the host's actual canonical paths and original selected profile ID.
The profile is the existing private
**stellar-forge.central-warehouse-profiles.v1** document (or its direct profile
array). Its connectionEnv names the original PostgreSQL connection already
available to the receiving process. The complete original Python package and
its maintained postgres extra must be installed on that host. The native
warehouse status action binds the actual warehouse UUID and schema.

If the connection is held in a private JSON file, add:

~~~text
--warehouse-environment-file /private/central-warehouse-environment.json
~~~

That file must contain only the profile's exact connectionEnv key and its
complete original connection value. The launcher loads it into its owned
child environment before Node starts. Keep the file private. Configuration
arguments and progress output contain paths, profile references and native
operation IDs; credential values stay on the host.

The default invocation without the warehouse arguments remains the complete
released-provider and two-period receiving programme described above.

### One retained native programme

The launcher runs these existing owners in order:

1. The original released Central creator and whole source receiver complete
   forms, published versions, original XML/media, capture, review, datasets,
   reports and the original independent archive reopen.
2. The original commissioner completes both native reporting periods, accepted
   reviews, approved datasets, source reports and its independent archive
   reopen. It writes the complete warehouse-selections.json.
3. The original approved-period warehouse receiver consumes that exact
   selection, including every original approval/review/import/report request ID.
   It receives the full approved CSVs and dictionaries into the original
   PostgreSQL warehouse, creates the full period report, receives the final
   complete Central archive, restores it into warehouse-reopened and reads
   the same editions and complete reports from that received workspace.
4. After the receiver closes its listeners, the launcher joins those actual
   results and packages the complete handover. It checks the original operation,
   workspace, capture, dataset, delivery, profile and request identities
   across the whole programme.

The warehouse implementation and full mapping/recovery contract are in
[warehouse/RECEIVING.md](../warehouse/RECEIVING.md). Its original private output
and independently reopened paths are:

~~~text
<work-directory>/warehouse-receiving/
<work-directory>/warehouse-reopened/
~~~

The full provider and commissioning directories keep the original paths
documented above. Each native module retains its own original request and
operation journal. Repeating the same full command recovers those existing
operations. A failed stage returns its native exit code before a later stage
can start. Termination closes only the launcher's current owned process group.

The existing direct warehouse receiving entry remains available for continuing
only that original saved selection. It uses warehouse-selections.json and the
same profile, output, restored directory and reviewer/note.

### Complete delivery files

The final product is:

~~~text
<work-directory>/customer-handover/Central_Complete_Reporting_Handover.zip
~~~

The same directory contains handover.json, READ_ME.md and result.json.
The result gives the complete ZIP byte count, SHA-256, member count, original
workspace and delivery IDs, dataset/report counts and actual listener closure.

| ZIP member | Complete original content |
| --- | --- |
| READ_ME.md | Native result, report and archive reopening instructions |
| handover.json | Joined source/commissioning/warehouse identities and complete member hashes |
| native/programme-result.json | Original released-provider and both-period result |
| native/fixture-result.json | Native Central project, forms, versions and source identity |
| native/source-receiving-result.json | Complete original capture, review, source coverage and receiving |
| native/commissioning-result.json | Both actual reporting periods, source reports and portable delivery |
| native/source-report-agreement.json | Full original source/report agreement |
| native/native-period-boundary.json | Actual retained submission timestamps and selected cohort boundary |
| native/commissioning-delivery.json | Complete commissioned dataset and report delivery |
| native/warehouse-selections.json | Original approved datasets, accepted capture/review pairs and SQL request IDs |
| warehouse/result.json | Original SQL editions, complete report receipts, archive restore and reopen result |
| warehouse/downloads/dataset-…/ | Full approved CSV, source descriptor, semantics, schema and saved approval |
| warehouse/downloads/reports/…zip | Complete original period report and both original/typed editions |
| warehouse/received-reports/…zip | Same complete report received after independent restore |
| warehouse/central-workspace.tar.gz | Final complete Central workspace, including original source and all commissioned/warehouse records |
| warehouse/original-warehouse-state.json | Original warehouse state retained before backup |
| warehouse/received-warehouse-state.json | Same warehouse state after relocation and native receiving |

The archive includes the final full workspace once. All prior complete result
documents are preserved; their original producing archives remain in the
private work directory.

Packaging streams the exact original files and compares their full receipts.
Already-compressed workspace/report archives are stored without another
compression pass. A complete existing ZIP is reused only after all its member
names, full bytes and SHA-256 values match. An interrupted partial ZIP is
removed by its active owner; a different completed handover is preserved.
The handover's completion time comes from the original completed warehouse
result, so repeating a completed command preserves the same delivery.

Keep the complete customer archive in the original private delivery route.
The Central host configuration, Authorization header, PostgreSQL connection
value, host recovery passphrase and native service recovery snapshots remain
with the existing host operator. The original request/response directories
remain available for continuing the provider and SQL operations.
