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
