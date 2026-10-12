# Central commissioning and reporting handover

The commissioning operator joins an existing ODK Central deployment to the original field-data workspace. It records the complete source/report agreement, verifies the actual private account, project and forms, installs two immutable reporting-period plans, and carries accepted original captures into readable reports, approved datasets and the full portable workspace.

The original Central Store, capture engine, review model, dataset exporter, report generator and archive remain authoritative. Commissioning adds records and retained source documents to that same Store. It does not create another data database, deploy a Central instance, accept fees or send a customer message.

## Open the complete operator

Use Node 24 and the complete composed ODK component, including its original dependencies. The original Store uses SQLite and a native process lease. Install this contribution alongside the original product.

An existing managed Central listener can mount commissioning on its current workspace. Its private opening path is `/commissioning/#token=THE_ORIGINAL_OPERATOR_TOKEN`. The same listener serves the original field workspace at `/`. Source review, row inspection, form/submission XML and media remain there.

For direct source use, close an independently running owner of this same database first, then start the single original listener:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/odk/commissioning/cli.mjs serve \
  --workspace /private/field-workspace \
  --connection /private/central-host/connection.json \
  --environment /private/central-host/connection-secret.json \
  --ready-file /private/commissioning-listener.json \
  --port 0
~~~

These paths are operator-selected private locations. Create their parent directories beforehand. `--ready-file` publishes a complete private descriptor exclusively; it never overwrites another descriptor. The descriptor contains the operator token and is removed only when its exact owner closes cleanly. After an ended process, inspect the old descriptor/owner before removing that stopped descriptor and reopening. The original native Store lease controls database ownership.

For local TLS, start Node with the original host's returned CA configured:

~~~sh
NODE_EXTRA_CA_CERTS=/private/central-host/tls/ca.pem \
node stellar/scf-starforge-20261009/sf30-seller-sdk/odk/commissioning/cli.mjs serve \
  --workspace /private/field-workspace \
  --connection /private/central-host/connection.json \
  --environment /private/central-host/connection-secret.json \
  --port 0
~~~

Keep TLS verification enabled. `NODE_EXTRA_CA_CERTS` must be present before Node starts.

The connection file may be the original `connection.json` or bootstrap output containing `connection`. Both preserve the actual native connection ID. Its fields are `id`, `name`, `url`, `authEnv` and `allowLoopback`. Use the actual host values, not a fabricated endpoint. The selected environment variable holds the **complete original Authorization header**. The optional private environment file loads only that alias and refuses to replace a different existing value. The authorization value is not written to commissioning records, source observations, reports or the archive.

### Borrow an existing listener

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/odk/commissioning/cli.mjs state \
  --operator-file /private/commissioning-listener.json
~~~

The descriptor's loopback origin, token and original workspace ID are checked before an action. A failed attachment does not start another owner. A direct command opens the selected original workspace, completes the operation and closes its lease. Capture commands wait by default. `--no-wait` is available only when borrowing an existing listener.

## 1. Record the actual host and source

The deployment owner supplies the full upstream Central service. The original host arm is under `central-host/`; its guide covers Docker Compose, PostgreSQL, Enketo/Redis, native secrets, images, startup, backup and create-only restore.

The host supports:

~~~sh
python3 central-host/central_host.py --config /private/central-host.json prepare
python3 central-host/central_host.py --config /private/central-host.json build
python3 central-host/central_host.py --config /private/central-host.json start
python3 central-host/central_host.py --config /private/central-host.json bootstrap
python3 central-host/central_host.py --config /private/central-host.json handover
~~~

Continue the existing selected host and original operation. Do not create an additional instance for commissioning.

Bootstrap returns `connection`, `service`, `private_environment_file` and `node_extra_ca_certs`. Handover returns the operation ID, pinned upstream source, actual URL/version/observation time, compose project, runtime/container state and original backup/restore references. Import the **handover JSON**, not the private environment file:

~~~sh
node commissioning/cli.mjs record-host \
  --operator-file /private/commissioning-listener.json \
  --host-handover /private/central-host/handover.json \
  --id RETAINED_HOST_RECEIPT_ID
~~~

The record pins the handover to the launch-selected connection and retains its complete bytes in the original source store. It is an observation at that time, not a promise that the service will remain running.

Choose **Read identity and projects**. This reads actual `/v1/users/current` and `/v1/projects` through the original source adapter. Select an accessible project and **Inspect selected project** to read its original forms. Every inspection retains its caller ID, full original raw responses, URL, timestamp, size and hash. Replaying a completed inspection makes no provider request. Explicitly request a new inspection for a new observation.

A credential rotation to another actor needs a new inspected source definition. Install checks the original authenticated identity and native connection. The browser cannot choose an arbitrary token or copy a credential value.

## 2. Agree the source and report definitions

Load the original source agreement or blank `commissioning/agreement.example.json`. The blank file has no invented project, forms, reporting dates, measure fields, owner or client records.

The guided editor covers owner, receiver, source forms, timezone, exact periods, review/media/late-edit meaning, approved output fields, measures and calendar. Additional original fields remain in the complete JSON and each saved revision.

| Decision | Required content |
|---|---|
| Original identity | Opportunity/reference, accountable project owner and technical receiver |
| Source | Authorized Central origin, one actual project ID and distinct inspected native form IDs |
| Periods | Two labels, UTC start and UTC exclusive end; optional explicit updated_since and native page size |
| Timezone | Business timezone explaining those UTC boundaries |
| Late edits | Interpretation of current available state and original retained versions |
| Review states | Explicit actual processing and the meaning of source review |
| Media | Expected/present/missing media and receiving/retention decision |
| Outputs | Every native form/table and explicitly approved field path |
| Measures | Native table/field, supported operation and explicit scalar equality filter when used |
| Calendar | Proposed/agreed kickoff, working calendar and original source references |

The original capture includes all source review states and current source state with available original form/submission versions. It does not reconstruct the server as of a historical period end. The editor requires that actual processing choice. Free-text business meaning is retained beside the explicit machine-readable `processing` fields.

Periods require actual ISO UTC timestamps, with `submitted_from` and `submitted_before_exclusive`. The native adapter validates them. Page size controls provider paging, not a total record cap. Overlap is retained only as explicitly selected; the operator does not silently deduplicate periods.

### Native tables, keys and measures

**Source-custody distinction:** the approved field list controls the CSV/dataset projection. The original native export also retains complete captured `rows.jsonl`, original response pages and metadata; the full workspace includes XML/media and other selected source fields. These complete packages are for the designated full-source receiver. They are not redacted public downloads. The saved `processing.portableSource` choice is `complete-selected-capture`; confirm that meaning before preparing delivery.

Each approved output names `form_id`, actual native `table`, optional readable `name` and explicit `fields`. **Show original fields** displays the capture's actual CSDL-derived paths/types, row keys and repeat parent key. Inspect actual rows and source generations in the original field workspace before acceptance.

The exporter preserves native row/repeat-parent keys. Commissioning requires those keys explicitly in the approved field list. It fails before export and names missing required paths. Select each table once, with at most 32 fields including keys.

Supported original indicator operations are `rows`, `nonempty`, `sum`, `mean`, `minimum`, `maximum`, `distinct` and `frequency`. Numeric types, missing/null states and decimal/Int64 arithmetic stay with the native report engine. An `equals` filter must name its field. `rows` without a field counts the entire original table.

Keep the full human measure definition in the agreement. Do not label an unimplemented cross-form algorithm as a computed measure. Cross-form identity rules are retained as context; comparisons use the original native row identity. Repeat IDs may change when repeat rows are reordered. Provider attachment endpoints do not preserve overwritten attachment history.

If actual paths differ from a preliminary agreement, save a new revision. A new commissioning version can reuse **the same two original plan IDs** when its source, forms, period scopes and original plan names remain exact. This lets an explicit field/measure correction reuse complete captures. Changed cohorts require new original plans/captures.

### Save and prepare

~~~sh
node commissioning/cli.mjs save-draft \
  --operator-file /private/commissioning-listener.json \
  --agreement /private/source-report-agreement.json \
  --id ORIGINAL_DRAFT_ID --request-id RETAINED_SAVE_UUID --expected-revision 0
~~~

Subsequent saves use the returned actual revision. The native transaction records the complete draft and request receipt together. Lost-response recovery reuses the same UUID and body. A stale expected revision conflicts instead of overwriting another save.

Prepare with an original JSON action:

~~~json
{
  "id": "RETAINED_COMMISSIONING_VERSION_ID",
  "draftId": "ORIGINAL_DRAFT_ID",
  "draftRevision": 1,
  "inspectionId": "ACTUAL_COMPLETED_INSPECTION_ID"
}
~~~

Run `node commissioning/cli.mjs prepare --operator-file /private/commissioning-listener.json --input /private/prepare.json`. The optional `existingPlanIds` array contains two distinct actual native IDs. Preparation freezes the whole draft/revision, source inspection and two plans.

## 3. Install, receive and review original source

**Install or resume these original plans** retains preparation before original API calls. The same commissioning ID reuses the actual connection and each matching plan after interruption. A changed body cannot reuse an immutable ID.

The period cards show original plans and captures. **Receive this original period** invokes the original capture engine with a retained request ID. **Resume original capture** continues that same cursor/ID/source. Browser refresh never starts a capture.

The original product retains complete root/repeat pages, schema, available form/submission generations and expected/present/missing media. Click **Open original source review** for rows, XML/media and quality findings. Commissioning does not accept source automatically.

For handover choose one COMPLETE capture per plan with its **current accepted original review**. Content hash, plan ID, exact scope and review ID are pinned.

## 4. Complete native reports and portable delivery

The handover action uses original dataset/report/archive methods to produce:

- An original dataset for every approved table in both periods: approved CSV projection, full original rows/source JSONL, schema/semantics and native receipts.
- A readable report per period: HTML, editable Markdown and JSON. The second compares the first selected native capture using the original comparator.
- Full native frequency/row-comparison files where needed; the report does not replace complete data.
- The full agreement JSON and readable handover with owners, source, plans, reviews, output IDs, calendar and recovery.
- Original `central-workspace.tar.gz` containing the full database, every referenced source/media/observation body and native output files.

Each output keeps its original ID and file hashes. An interrupted handover validates completed `source.json`/`report.json` against its pinned selection and reuses them. It does not regenerate under a newer review.

If a review changes before an unfinished output, the original handover identifies the superseded review. Earlier outputs remain. Create a new handover request for the newly accepted pair; it can reuse those complete captures.

Handover documents are committed before the original snapshot. A restored snapshot can therefore contain READY_FOR_ARCHIVE plus the actual original `receivedArchive` identity. The operator exposes this received portable state; it does not invent the producer's later archive-result row or automatically recapture on reopen.

## Exact recovery

| Situation | Continuation |
|---|---|
| Draft response lost | Repeat the retained UUID and complete original body |
| POST succeeded, refresh failed | The known response/request stay retained; refresh or recover the same request |
| Another tab saved | Load/review its actual revision before replacing it |
| Partial source inspection | Same inspection ID reuses already-retained responses |
| Interrupted plan install | Same commissioning ID reconciles original connection/plans |
| Paused/failed capture | Resume the original capture ID |
| Uncertain storage write | Close/reopen the same original owner, then repeat its retained request |
| Interrupted native output/archive | Resume the same handover ID and capture/review pair |
| Changed report meaning | New complete agreement revision; reuse plans only when the native selection is exact |
| Recipient reopen | Original complete archive, exact hash, new independent target |

Browser mutations disable selection controls during the request. Full request bodies/IDs remain in that browser session for exact recovery; an earlier response does not clear a later selection.

### Portable restore

~~~sh
node commissioning/cli.mjs restore \
  --archive /private/received/central-workspace.tar.gz \
  --expected-sha256 ACTUAL_COMPLETE_ARCHIVE_SHA256 \
  --workspace /private/independent-received-workspace
~~~

This calls the original create-only restorer, retaining full member/database/source/file identities. All commissioning record kinds/resources survive. A live source credential is needed only for another authorized provider operation; retained definitions/captures/outputs remain available. Do not automatically give a recipient the producer's credential alias.

Upstream Central service recovery is a separate original `central-host` operation. A field-workspace archive does not replace PostgreSQL/Enketo/secret custody.

## A ten-working-day handover

Kickoff is `proposed` or `agreed`. Proposed dates can be retained while access, definitions and capacity are being arranged. An agreed kickoff requires the start date and original agreement/input-readiness references. An optional capacity reference links actual staffing agreement; this tool does not allocate staff.

The finish follows the saved weekdays/excluded dates. A computed calendar is not customer acceptance.

| Working days | Complete outcome |
|---|---|
| 1–2 | Source authority, host/receiver, native forms, definitions and boundaries |
| 3–5 | First actual period, native source review and approved output |
| 6–8 | Second period, explicit correction and retained edition comparison |
| 9–10 | Complete reports, portable receiving, operator training and recovery handover |

Company dates, prices, terms and relationship messages remain in the existing private case and sole owner route.

## Integration and actual receiving

`commissioning/INTEGRATION.md` documents the trusted Store/server ABI, one managed listener, native return shapes and the original receiving-operation join.

Source completion, source parse, upstream deployment, actual capture, browser review and recipient receiving are separate results. Describe a running system from the original operation's actual observed output, not this source package alone.
