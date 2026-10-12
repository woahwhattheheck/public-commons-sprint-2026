# NetBox customer desk

The customer desk carries CSV intake, mapping, native review, import, correction and handover through the existing inventory migration operator. It uses the same prepared request, NetBox Script Job and transaction journal as the command line.

## Open the original workspace

Use Python 3.10 or later on the operator machine and the existing connection JSON described in the [inventory guide](../README.md). The native NetBox Script, token permissions and selected tenant remain the original deployment configuration.

From the product directory:

~~~bash
python3 workspace/server.py \
  --directory /private/customer-inventory \
  --config /private/netbox-connection.json \
  --port 0
~~~

The process prints its local URL. Open that exact URL, including its initial token fragment. The browser keeps the local session token for this operator; the NetBox API credential is resolved by the server from the original configured environment variable.

Reopen with the same private directory:

~~~bash
python3 workspace/server.py --directory /private/customer-inventory
~~~

The saved connection, project drafts, uploaded bytes, native editions and pending action identities stay attached to that directory. A new server process supplies a new local browser session token. Stop with Ctrl-C; shutdown waits for the current original native call to return and preserves its retained result.

The server binds only to 127.0.0.1. API calls require both the current Bearer token and X-Workspace-Token; mutations also require the exact local Origin. One workspace server holds the original file lock. The application does not enable cross-origin access.

Optional --temporary-root selects an existing private directory for temporary multipart uploads. The upload is copied to its immutable project location before the temporary spool is removed. --wait selects how long a saved native action follows its current Job before returning; the default is 30 seconds, with the original 0–600 second range.

## Intake and column mapping

Create a labelled project and select its actual permitted NetBox tenant. A null tenant means the draft has not selected a tenant yet; the original native preparation requires a positive tenant ID. Upload the original UTF-8 CSV files. The desk retains their names, exact bytes and SHA-256 identities, and presents the actual header names, row counts and samples.

A project holds up to 32 uploads and 64 MiB of original CSV data; one file is at most 32 MiB. The existing compiler limits a combined preparation to 5,000 mapped objects and an 8 MiB native request. Old drafts and selected source bytes remain available when the current mapping changes.

Add one or more source mappings using the original inventory kinds:

| Kind | Original relationships | Native catalogue selections |
| --- | --- | --- |
| sites | None | Tenant selected for the project |
| racks | Site by source key or native ID | Location |
| devices | Site and rack by source key or native ID | Device type, role, platform, location |
| route_targets | None | Tenant selected for the project |
| vrfs | Complete import/export route-target memberships | None |
| vlans | Optional Site by source key or native ID | VLAN group, IPAM role |
| prefixes | Optional VRF, VLAN and Site scope | IPAM role |
| interfaces | Device, optional VRF and untagged VLAN; complete tagged VLAN membership | Native IDs can be selected for each relationship |
| ip_addresses | Interface and optional VRF by source key or native ID | Legacy VRF mappings remain readable |
| cables | A/B Interfaces by source key or native ID | Cable bundle |

The browser obtains field names, types and required new-object fields directly from the original FIELDS, LINKS, MANY, CATALOG and REQUIRED_NEW definitions. It supports every original expression option: a CSV column or literal value, trimming, lowercasing, explicit blank handling and explicit value replacements. Relationship expressions retain their by:key or by:id choice. Exact decimal values, including rack positions, remain strings as required by the original compiler.

The catalogue picker performs the original account-scoped NativeApi.pages request. It displays actual native IDs and returned objects for tenants, device types, roles, platforms, locations, route targets, VRFs, VLANs/groups, IPAM roles, prefixes, sites, racks, devices, interfaces, IP addresses and cables/bundles. Search results are retained with their provider page receipts and observation time. A mapping uses the selected ID; the picker does not create a replacement catalogue or infer ambiguous names.

Save the complete mapping as a new project revision. An older browser revision receives a conflict and can reload the current project. The original save request ID remains attached to the retained revision when the reply is interrupted.

## Network commissioning

Use the [complete network example](../examples/network-mapping.json) to map route targets, VRFs, VLANs, scoped prefixes, Interface VLAN membership, IP addresses and A/B cable endpoints through the same project.

For a complete membership such as tagged_vlans, choose a CSV column containing semicolon-separated source keys or native IDs. Fixed-value mode accepts the complete list and the native picker can add selected IDs. Conversion options retain a custom one-character separator or JSON-list value replacements. Blank → clear removes every membership; an unmapped field leaves it unchanged.

The native review's Network commissioning panel groups the original result into route targets, VRFs, VLANs, prefixes, interfaces, IP addresses, cables and native endpoint/path effects. It supports search and paging, opens actual native object URLs, and retains the source reference and full before/after state on every row. Addresses display the most specific selected prefix within their explicit VRF. The same IPv4 address in two VRFs remains two independent native objects.

Review Interface mode together with untagged/tagged VLAN fields: NetBox's native save may clear memberships when mode changes. Review cable endpoint/path effects together with the selected cable; these are read from the original native CableTermination, endpoint cache and CablePath records.

Create report or Build handover in Delivery to download network.html, network.csv and network.json alongside the inventory report and original result. The complete handover includes those files and all operator/network-report/desk source. A restored edition keeps the same network report and native receipt. A corrected draft carries the applied object IDs into the next edition for an explicit reassignment or rename.

## Preview and prepare

Preview runs the original compile_mapping function against the retained uploads. It shows compiler corrections, combined counts, and the first 100 mapped rows. The full source and request continue into the native preparation.

Preparation requires the exact displayed preview SHA and project revision. The backend compares the mapping, captured source manifest and complete request digest with that preview, then invokes the original prepare function. It verifies the resulting original workspace payload before publishing the edition for native actions.

Every prepared edition retains its own original operation ID and immutable input directory. Repeating the same preparation request reopens that edition. Changing source data creates a new draft revision and preparation while the earlier native history remains readable.

## Review, apply and recover

Choose a prepared edition and request a native review. The local HTTP response is 202 with a saved action ID. The browser polls the local saved action; the original operator owns provider requests and Job polling.

Read the actual native review, including before/after objects, generated components, catalogue dependencies and counts. Apply uses the exact completed native review digest shown for that edition. The backend checks that digest and the displayed native status before admitting the action. The original NetBox transaction performs its existing review and commit checks.

A local action reaching COMPLETE means that the original operator call returned. Its result may still be AWAITING_NATIVE_RESULT. Use Recover to read the same NetBox Job and transaction journal. The UI keeps local action state and actual native state visible separately.

When a reply or server process is interrupted:

1. Reopen the same project and edition.
2. Select its retained active action, using the saved request ID.
3. Continue that exact action. If the native current execution changed after admission, the controller invokes the original recover path and reports that actual execution reference.
4. If the original call was never dispatched, the existing operator performs the still-pending action. It preserves the original operation, request bytes, review digest and native serialization.
5. An invalid preflight proven to have created no new native execution finishes as FAILED with review_required. Reload the current edition and save a corrected action.
6. Use the original Retry current action only when its displayed native situation calls for an explicit retry. That remains the original operator policy and transaction journal.

A different body cannot reuse an existing action ID. The backend serializes native actions for one edition and retains an active-action reference for recovery from a fresh browser.

## Start a corrected draft

Select an original prepared or received edition and choose **Start a corrected draft**. The desk copies that edition's exact retained CSVs into the project upload registry and publishes a new editable project revision with its original mapping.

For an applied edition, the desk uses only committed applied.json resolved IDs to construct native match expressions for those same rows. A dry-run's temporary CREATE IDs never become update targets. The source keys and transformation rules remain attached to the original CSV values.

The operator can then correct fields, links or catalogue selections and create a new preparation. The earlier applied edition and its transaction receipt remain intact.

If an incoming mapping has an ambiguous original source path, the draft displays a source-selection warning and asks for the exact retained CSV. Missing or ambiguous native match identities also remain explicit corrections. Historical bytes are preserved throughout these choices.

## Handover and continued receiving

Report and Handover call the original operator functions. The selected-edition handover contains:

- Exact native request, mapping, source manifest and CSV inputs.
- Completed review, applied receipt, journal source and native attempt history when present.
- Original readable HTML, result JSON and resolved-object CSV.
- The original migration/prepare/operator source plus the customer desk backend, browser assets and this guide.

The ZIP uses the maintained per-member manifest and verified byte hashes. It carries the selected native edition; unrelated project drafts remain in their original private workspace.

On another operator machine, start this desk with the existing authorised NetBox connection, create a project and upload the original handover through **Receive handover**. The existing restore function validates and materializes the same operation and result. The received archive remains retained. Repeating the receive reopens the current received edition and preserves native recovery or review work performed since its first restore.

For a source-absent command-line receiving environment, the archive's operator-source directory includes the complete desk source. Restore with the original command described in the parent guide, then run operator-source/workspace/server.py with an existing private connection. Select the same handover in the desk to attach its native edition to a project. Credentials are supplied by that operator's original configuration and environment.

Choose Report or Handover again after additional native results arrive to export the current selected edition. The fixed download routes expose the original CSV, request, mapping, result, report, resolved IDs and ZIP.

## Local API

All JSON successes include ok:true. Errors include ok:false and error:{code,message,details?}. Every request ID is 8–128 characters using letters, digits, underscore, dot, colon or hyphen, beginning with a letter or digit. Project/upload/edition IDs are generated by the backend.

| Method and route | Original operation |
| --- | --- |
| GET /api/state | Safe connection, original mapping schema and saved projects |
| POST /api/projects | Create with request_id, label and optional tenant_id |
| GET /api/projects/:project | Current draft, retained uploads and chronological native editions |
| POST /api/projects/:project/uploads | Multipart request_id, expected_revision and one file |
| POST /api/projects/:project/mapping | Full original mapping plus expected_revision, label, tenant_id and source_notes |
| POST /api/projects/:project/preview | Original compiler preview for expected_revision |
| POST /api/projects/:project/prepare | Freeze expected_revision and preview_sha256 |
| GET /api/catalogue?kind=... | Actual original native catalogue pages |
| GET /api/projects/:project/uploads/:upload | CSV rows with offset and limit |
| GET /api/projects/:project/uploads/:upload/download | Exact retained CSV |
| GET /api/projects/:project/editions/:edition | Original result/corrections and local action history |
| POST /api/projects/:project/editions/:edition/actions | Native review, apply, recover, retry-current, report or handover |
| GET /api/actions/:request | Saved action and current original edition |
| POST /api/actions/:request/resume | Continue with that same request_id |
| POST /api/projects/:project/editions/:edition/draft | New editable revision from exact retained inputs and committed IDs |
| POST /api/projects/:project/restore | Multipart original handover with request_id and expected_revision |
| GET /api/projects/:project/editions/:edition/download/:name | Fixed selected-edition original output |

A native action body contains request_id, action and expected_status_sha256. Apply also contains review_digest. Review optionally contains refresh:true. The body is retained before execution; an identical repeated POST returns that saved action. The active action ID is included in the edition so another browser can find the existing continuation.

Download names are handover.zip, report.html, result.json, resolved.csv, request.json and mapping.json.

## Embedding the same operator in a receiving journey

The server module exposes:

~~~python
start_desk(
    directory,
    config=None,
    port=0,
    web_root=None,
    temporary_root=None,
    wait_seconds=30,
)
~~~

The returned object has url, token, desk, actions and close(). The caller uses the actual local URL and token for its browser and closes the same server after the original native action completes. The helper starts no substitute NetBox service or migration engine.

The maintained [native receiving operation](../native/README.md) owns the actual NetBox 4.7.2, PostgreSQL, Redis and Script Job setup. Customer-desk browser continuation should use that same original operation and retained fixture inputs.
