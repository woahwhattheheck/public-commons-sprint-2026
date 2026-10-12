# GridFabric Plaid operations

This application retains original meter and device measurements, reviewed reporting mappings, Plaid callbacks, event history, opt decisions, management requests and device dispatch receipts in one private workspace. Its Node CLI, authenticated HTTP console and browser operate the same SQLite database and the same native workspace lease.

Plaid continues to own event and interval scheduling. Receiving a callback can record or queue an explicitly bound device intent. It does not invoke the management API or device adapter. A separate reviewed dispatch command sends one captured request after its original begin transaction commits.

The domain and public source contracts are in [DOMAIN_OPERATIONS.md](DOMAIN_OPERATIONS.md) and [contracts/SOURCES.md](contracts/SOURCES.md). They distinguish documented request/response fields from operator-supplied vendor schema bindings. The complete 31-day functional receiving uses explicitly labeled TokenJunkieLabs data; it is not a capture from Plaid, a VTN, or physical equipment.

## Native requirements and opening a workspace

Use Linux, Node **22.13 or newer** with its built-in `node:sqlite`, the existing Linux `flock` utility, and GNU `mv` supporting `--no-clobber --no-target-directory`. No npm package is required by the standalone application. The complete customer receiving command additionally uses GNU `tar`; optional browser receiving uses a caller-selected existing Playwright package and Chromium executable.

The original lease module remains at `../../merchant-fleet-gateway/state-lease.mjs`. Preserve the repository-relative source layout or install the declared Starforge selection. Keep workspace directories private to their operating account.

From a complete checkout:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/gridfabric-plaid/cli.mjs \
  --workspace /private/gridfabric-workspace init --label "Plaid operating workspace"

node stellar/scf-starforge-20261009/sf30-seller-sdk/gridfabric-plaid/cli.mjs \
  --workspace /private/gridfabric-workspace serve --port 0 \
  --connection-file /private/gridfabric-console.url
~~~

The connection file contains the original loopback URL and a private bearer fragment. Open that URL in the browser. The listener reports its actual origin, logical workspace ID and complete executing source identity. It accepts operator calls only through the private bearer and original Host/Origin gate. Do not publish the connection file or token.

The CLI owns the workspace. SIGTERM or SIGINT stops accepting requests, drains its original request/export/dispatch work, removes only its unchanged connection file, then releases the SQLite owner and native lease. A connection descriptor or old PID alone is not proof of a live owner. A later successful original CLI acquisition of the same workspace lease proves that the previous lease ended.

The same installed entry point is `starforge gridfabric-plaid`. Its source-owned contribution is `distribution/contributions/gridfabric-plaid.json`. See the source selection guide for a maintained build; running the standalone source does not imply that a package build or installed runtime has completed.

## Source intake and exact measurement meanings

Use **Source intake** to select a complete original CSV, JSON or evidence file. The application retains its exact UTF-8 bytes, SHA-256, original name and media type before recording a source import. Every parsed row keeps its original line/index and source identity.

CSV profile fields are original header names. JSON profile fields are row-relative JSON pointers; `rows_pointer` selects the complete array. Supply explicit device, channel, timestamp, unit, quality and value meanings:

~~~json
{
  "rows_pointer": "/rows",
  "fields": {
    "device_id": "/device",
    "channel": "/channel",
    "kind": "/kind",
    "start": "/start",
    "end": "/end",
    "value": "/value",
    "unit": "/unit",
    "data_quality": "/quality",
    "status": "/status"
  },
  "constants": {},
  "timestamp_format": "epoch_seconds",
  "value_semantics": {
    "energy": "interval_energy",
    "power": "interval_average_power",
    "status": "status"
  }
}
~~~

A single-kind profile may use a single `value_semantics` string and an explicit `constants.kind`. ISO timestamps require their original offset; the application does not infer a timezone, unit, duration or quality. Status measurements preserve the original object in `measurement_status`; the normalized row's `status` records its validation state.

Inspect **Every source row** and **Every source issue** from the saved source. The device/channel picker retains the native composite scope internally. All-records paging exposes the full collection, including records outside the recent panels. A source with issues remains `NEEDS_CORRECTION` and cannot be activated in a report mapping.

A correction is a new import with `corrects_source_id` referencing the original source. Both original files and rows remain retained. A mapping explicitly places correction source IDs ahead of lower-priority original IDs so sparse corrections can leave all other original measurements intact.

## Instances, vendor bindings and report mappings

Use **Instances** to register the exact instance identity and configured management root URL. Header and basic credentials are environment-variable references. The application reads their current values only in its native host when authenticating a callback or sending an explicit captured dispatch. Credentials are not stored in domain records, exports or browser forms.

The instance records its original schema evidence, reviewer, device identities and target categories. Vendor-specific event wrappers require explicit reviewed JSON-pointer bindings. An unknown event schema is retained as `UNPROJECTED_SCHEMA`; it is not silently interpreted using guessed fields.

**Report mappings** contains the complete original input JSON, a readable retained edition and a separate activation control. Each entry identifies:

| Field | Meaning |
|---|---|
| `r_id`, `report_specifier_id` | Exact original registration identities. |
| `source_ids` | Explicit precedence, highest first. |
| `device_id`, `channel` | Exact source selection. |
| `kind`, `unit` | Energy, power or status and its explicit native unit. |
| `time_basis`, `period_seconds` | Original interval or sample interpretation. |
| `aggregation` | Energy sum, interval power average, sample or status. |
| `decimal_places` | Explicit output precision. |
| `allow_resample` and quality fields | Reviewed resampling permission and quality attribution. |

Supply the full original `registration_response`, not just a list of names. The native engine checks mapping entries against the report registration. Activation requires ready sources and an identified reviewer. Status/sample mappings use the explicit instant basis.

**Reports** uses the original `startTimet`, `endTimet`, `granularityInSeconds`, `rIds` and optional `reportSpecifierId`. Read all output rows and download the full response. Incomplete source coverage or incompatible interval semantics produce retained issues rather than invented measurements. Prepared successful reports are cached under their exact instance, mapping and query; portable export retains the complete original meta table containing that cache.

## Plaid callbacks, events and reviewed continuation

The browser lists the actual routes from the retained public contract:

`/callbacks/<instance-id>/<documented-endpoint>`

Callback credentials come from that instance's environment references. Header names are matched case-insensitively. Only the explicitly declared OnHeartbeat endpoint accepts an empty body. Nonempty callbacks must carry the original matching message type and instance header.

Each incoming body is retained in full. The database separates the logical callback from each actual delivery and stores the exact original response bytes, HTTP status, processing status and projection. A successful duplicate receives its original response; a new mapping does not silently regrade or replace that response.

**Events and controls** provides reviewed opt decisions, original distribution reconciliation, explicit history projection and explicit continuation of an eligible retained interval. The domain:

- Preserves every original revision, nullable/missing revision and conflicting observation.
- Resolves target categories through the reviewed instance/device bindings.
- Applies the latest applicable device-specific or whole-event opt decision.
- Leaves interval timing and callback arrival to Plaid.
- Queues native END only from the original completion callback.
- Keeps historical projection separate from dispatch history and preserves original callback responses.

`project_event_history` reprojects retained original callbacks under reviewed current bindings without sending historical device actions. `resume_event_callback` requires the exact original callback/event/current interval identity plus reviewer and retained source evidence. It cannot resume an obsolete interval. The domain rechecks current opt permission and interval identity again before a queued device intent can begin dispatch.

## Management and device dispatch

In **Management**, select an original published request example or supply the full original parameters, instance and reviewer. Preparation captures the request body, source identities and configured endpoint. Inspect that retained request before selecting **Send management request** or **Send device request**.

The host and original engine preserve this boundary:

1. A fresh begin action and host dispatch journal commit in the same SQLite transaction.
2. Only this invocation's fresh `replayed:false` begin can reach the network.
3. The host resolves the captured header environment references and performs one POST outside the callback/domain transaction.
4. Exact status, headers and complete response body are retained before the original finish action is applied.
5. A repeated original request UUID returns or finishes its saved receipt. It never automatically resends a captured, SENDING or UNKNOWN attempt.

A successful HTTP response can still contain an original VTN rejection. The retained published HTTP200/statusOK/452 example is historical evidence of that distinction; it is not a successful native provider run.

When outcome is uncertain, inspect the original attempt and receipt. `recover_dispatches` records all currently SENDING native attempts as UNKNOWN with the named reviewer and reason. It makes no network call. A reviewed management/device disposition binds the same original operation and source evidence, recording `complete`, `not_applied` or `still_unknown`. These outcomes do not create a new send authorization.

### Browser recovery

The browser saves each UUID, input and expected revision before its POST. **Saved actions** reads that exact original request. It permits same-UUID local continuation only after the native owner proves nonacceptance at the original revision, or when an original dispatch receipt is already retained and can be finished without another send.

A pending dispatch remains the root record while a permitted reconciliation receives its own saved child UUID/body/revision and exact original operation/attempt binding. Other mutations remain blocked. The browser can receive a genuine UNKNOWN or RECONCILED domain outcome even when the historical host journal still says DISPATCHING; its history retains both records and does not claim that the host completed.

## Complete export, restore and advanced receivers

**Export and receiving** produces the native `.jsonl.gz` portable artifact. Version2 contains every original logical table, host file record, dispatch journal, internal meta record and complete immutable UTF-8 file. File bytes are chunked, with exact offsets, counts, UTF-8 validation and whole-file SHA-256. The reader also accepts the original version1 format.

Exports bind one request UUID and workspace revision. Their PUBLISHING journal preserves the original snapshot and archive identity. A retry receives that exact archive or continues the saved original snapshot.

Restore verifies the complete archive, logical record digest and every original file into a private sibling stage. It writes and syncs the completed receipt before native no-clobber publication of the destination. A repeated upload of the same archive and destination returns that original receipt. If the restored workspace has since advanced, read-only restore status reports `RESTORED_AND_ADVANCED` and its actual current revision; it does not reset that workspace. An unrelated existing destination remains rejected.

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/gridfabric-plaid/cli.mjs \
  --workspace /private/gridfabric-workspace export \
  --request-id ORIGINAL_UUID --expected-revision ORIGINAL_REVISION \
  --out /private/GridFabric_Original.jsonl.gz

node stellar/scf-starforge-20261009/sf30-seller-sdk/gridfabric-plaid/cli.mjs \
  inspect-portable --file /private/GridFabric_Original.jsonl.gz --expected-sha ORIGINAL_SHA256

node stellar/scf-starforge-20261009/sf30-seller-sdk/gridfabric-plaid/cli.mjs \
  --workspace /private/new-gridfabric-workspace restore \
  --file /private/GridFabric_Original.jsonl.gz --expected-sha ORIGINAL_SHA256
~~~

Restoring preserves logical workspace, source, mapping, report, event and attempt identities. A new listener gets a fresh private token. Earlier export metadata may be retained as history; only complete original archive bytes are downloadable.

Native upload/action allowance defaults to256MiB and portable receiving to4GiB. They are explicit CLI options. File verification and portable file reconstruction use bounded chunks; the domain's source parser still loads the requested original text to interpret its full measurements. Choose host memory for the actual source portfolio.

## Full native receiving

[The complete receiving guide](../../../../operations/scf-gridfabric-plaid-receiving-20261012/README.md) defines the one-owner native operation, exact input manifest, resumable request journal, optional read-only browser, all-file download, cold SQLite comparison and re-export. The actual generator emits the full 31-day, eight-device, power/energy/status portfolio and explicitly sparse corrections. It preserves public examples separately and performs no management/device request.

Source review, an original in-memory domain exercise, native application receiving, a provider operation and an installed Starforge runtime are distinct observations. The saved native report records only phases that actually completed.
