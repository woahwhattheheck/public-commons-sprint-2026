# GTFS Schedule merchant workspace

The GTFS workspace carries one complete original transit feed through source review, dated schedule editions, comparison, publication and whole-workspace receiving. Its browser, command line and merchant MCP provider use the same saved model and the original SF30 Frictionless dataset publisher. Managed Applications starts that original command and retains its actual workspace UUID and listener.

## Operator workflow

1. Create or reopen a private workspace with `gtfs init --workspace /absolute/private/gtfs` and `gtfs serve --workspace /absolute/private/gtfs --port 0`, or choose **GTFS Schedule merchant** in Applications.
2. Upload the complete original ZIP. The workspace retains every member, including tables and extensions you do not select for sale. Read the table counts, original member hashes, agency timezones and feed information. Source/license/attribution fields retain the values you supply.
3. Select complete original tables and, when the feed supports a fixed-stop schedule, actual inclusive service dates and optional agency/route IDs. Original table resources remain complete; filters affect the derived schedule resources. The route search pages the complete original routes table.
4. Save an immutable edition. Preview any resource, with original physical strings and row numbers. Compare two editions by their exact saved hashes; the retained change stream contains every keyed addition/removal/change. Tables without usable declared unique keys are reported separately.
5. Record an operator decision if useful, then select the exact edition for publication. Selection changes the source for subsequent plans. Previously saved plans retain their original complete capture and can still be inspected or recovered.
6. Use the original publisher panel beneath the GTFS source controls: review a plan, extract the retained source, inspect the complete candidate and record the native publication review. Initialize a new dataset or publish against the actual current snapshot/revision. The same native publisher records the resulting version.
7. Prepare a complete SF82 release from an actually published run and explicit payment/origin settings. Stage that retained package in the host's configured original release store. The existing release operator owns activation, comparison, rollback and running the seller.
8. Export the whole workspace and receive it into a new private directory. Reopen the original publisher and continue the same feeds, editions, plans, reviews, decisions, schedules and dataset versions.

The interface uses plain tables, black/gray controls and the original publisher's plan/candidate panels. Large lists and source rows expose page totals and continuation offsets. A pending original source operation has its own recovery action.

## Exact source and service-time behavior

The generic ZIP, table, calendar, exception and trip-instance functions are the maintained original `transit_workshare.py` engine through `instances`, retained as `engine.py`. Original engine source: Commons blob `2926b9bfd280e93ee93c6f6229343c1f6e01aafb`, merged in PR34021 / `691f84390f9ea8adc121e89ccb01d981a3cc830e`. The merchant adds its source/capture and absolute-time layer above those functions.

The official [GTFS Schedule reference](https://gtfs.org/documentation/schedule/reference/) defines the source fields. Calendar-date exceptions take precedence over weekly service. Service times can exceed 24 hours while retaining their original service date. Absolute times use local service-day noon in the original agency timezone, convert that noon to UTC, subtract 12 elapsed hours, then add the original event seconds and the exact instance shift. This preserves the GTFS service-day behavior across daylight-saving transitions.

| Resource | Retained meaning |
| --- | --- |
| Original `*.txt` tables | Complete source table, original column names and physical values; original ZIP bytes remain unchanged. |
| `Derived_ScheduledTrips` | Exact original service date/trip/start instance, route/agency, source seconds, time shift and absolute start/end instants. |
| `Derived_ScheduledCalls` | The same instance plus original stop ID/sequence, source record and physical source times, exact shifted arrival/departure and UTC instants. |
| `Derived_FrequencyWindows` | Original headway windows for non-exact frequency service; these are not converted into scheduled departures. |

`exact_times=1` expands start-inclusive/end-exclusive departures. Other headway windows remain separate. Missing optional source values remain literal blanks; an omitted single-agency ID resolves through the original engine's explicit single-agency default, shown in inspection. Derived resources keep the original resolved engine identities. No missing stop times, license terms, ridership, token conversions or demand estimates are inferred.

### Input and publication limits

The original ZIP is at most 16 MiB and expands to at most 128 MiB. ZIP members must be unique ordinary files at its root. Original strings must be valid UTF-8 CSV with complete rows. All members remain retained even when a table cannot be selected for publication.

Each original or derived publication resource uses the original Frictionless publisher ceiling of 1,000,000 rows and 64 columns. A selection has at most 64 resources, including the three schedule resources, and at most 367 inclusive service dates. Derived row counts are checked before instance expansion. Select a smaller date/route range when a complete schedule resource exceeds the native limit. The original publisher still validates its byte, cell, type, order and extraction limits on the reviewed plan.

Inspection's convenience route/agency/feed-info catalogs declare their returned and total counts. The complete original table reader supports pagination and search. The entire ZIP and unselected source tables remain in the edition capture. Unknown composite-key uniqueness is reported by the complete comparison, without inventing a row identity.

## Selection and original request contracts

Every saved GTFS action uses `{requestId, expectedRevision, payload}`. Request IDs are lowercase UUIDs; `expectedRevision` is the current root revision shown by status. Repeating the same request checks its original payload identity before the current revision, so a successful save with a lost response returns its original result. Reusing an ID with different input fails.

An edition request contains `payload: {feedId, recipe}`. A complete recipe example is:

```json
{
  "schema": "stellar-forge.gtfs-selection.v1",
  "title": "Reviewed service week",
  "feedSha256": "<displayed complete original ZIP SHA-256>",
  "startDate": "2026-10-12",
  "endDate": "2026-10-18",
  "agencyIds": [],
  "routeIds": [],
  "tables": [
    "agency.txt",
    "routes.txt",
    "trips.txt",
    "stops.txt",
    "stop_times.txt",
    "calendar.txt",
    "calendar_dates.txt",
    "frequencies.txt"
  ],
  "includeSchedule": true,
  "authority": {
    "sourceUrl": "https://original-publisher.example/feed.zip",
    "licenseUrl": "",
    "licenseName": "",
    "attribution": "Original publisher, as recorded in the selected feed",
    "retrievedAt": "2026-10-12T00:00:00Z"
  },
  "note": "Actual selected service dates and original source values"
}
```

Select table names actually present and publishable in the inspected ZIP; do not copy an absent example table. The hash, source URL, attribution, retrieved time and rights fields above are operator inputs, not prefilled claims. For a table-only edition set `includeSchedule:false`, with empty service dates, agency IDs and route IDs.

| Saved action | `payload` |
| --- | --- |
| Edition | `{feedId, recipe}` |
| Comparison | `{beforeId, afterId, beforeSha256, afterSha256}` using exact saved edition JSON hashes |
| Decision | `{subject:{kind:'edition'|'comparison',id,sha256}, verdict:'accept'|'reject'|'defer', reviewer, note}` |
| Selection | `{editionId, editionSha256}` |
| Release preparation | `{runId, payment, origin, path?}` |
| Release stage | `{releaseId, releaseSha256, id, label?, runtime?}` |

Feed import binds title, original filename, SHA-256 and byte count to the same complete ZIP read. The root journal retains the exact input before source processing. `recover` continues that saved input; if interruption occurred before the ZIP finished retention, upload the same complete ZIP with the original request UUID. Invalid inputs receive a failed original receipt; an operation with retained effects or a recoverable native interruption stays pending for that same continuation.

## Command line

The installed distribution exports the `gtfs` command. A checkout can run `node stellar/scf-starforge-20261009/sf30-seller-sdk/gtfs/cli.mjs ...`.

```sh
gtfs inspect-feed --archive /absolute/original.zip
gtfs init --workspace /absolute/private/transit --title 'Transit data'
gtfs import --workspace /absolute/private/transit --archive /absolute/original.zip --sha256 ORIGINAL_HASH --request REQUEST_UUID --revision 0 --title 'Original feed'
gtfs edition --workspace /absolute/private/transit --input /absolute/private/edition-request.json
gtfs select --workspace /absolute/private/transit --input /absolute/private/select-request.json
gtfs template --workspace /absolute/private/transit --query Derived_ScheduledCalls --out /absolute/private/plan.json
gtfs publisher --workspace /absolute/private/transit --operation plan_save --input /absolute/private/plan-save.json
gtfs extract --workspace /absolute/private/transit --plan PLAN_NUMBER --plan-sha256 PLAN_DIGEST --run RUN_UUID
gtfs publisher --workspace /absolute/private/transit --operation inspect --input /absolute/private/run-inspect.json
gtfs publisher --workspace /absolute/private/transit --operation review --input /absolute/private/review.json
gtfs publisher --workspace /absolute/private/transit --operation publish --input /absolute/private/publish.json
```

`plan-save.json` is `{ "plan": <the reviewed template object> }`. Native inspect input is `{runId, query?}`. Native review input is `{runId, candidateDigest, reviewer, note, initialize:true}` for the original absent target, or the native expected snapshot/revision for refresh. Native publish input is `{runId, reviewId}`. Those schemas and semantics are the original merchant publisher's [tool catalog](../../../../stellar-forge/mcp-merchant-operator/catalog/publisher.mjs).

`publisher --operation` also exposes the native source/status/target, buyer offer/preparation/read, recovery and schedule read/save/enable/pause operations. `extract`, `schedule-run` and `schedule-continue` await their actual native completion before the one-shot CLI closes. One-shot reads do not start a saved timer. `serve` and MCP resume the existing enabled schedule while they own the workspace.

## Fleet and SDK

The source-owned registration declares `gtfs-workspaces` in the original merchant-provider registry. Inspect it with `merchant-providers inspect gtfs-workspaces`. The metadata enumerates the complete GTFS tools and reused original publisher tools without opening any workspace.

Create a private host connection file:

```json
{
  "schema": "stellar-forge.gtfs-workspace-connection.v1",
  "workspaces": {
    "transit": {
      "directory": "/absolute/private/transit",
      "workspaceId": "<original workspace UUID from gtfs status>",
      "label": "Transit Schedule",
      "inputs": {
        "original": {
          "file": "/absolute/original.zip",
          "label": "Original publisher ZIP"
        }
      },
      "exportsDirectory": "/absolute/private/transit-archives",
      "releaseStore": "/absolute/private/merchant/releases"
    }
  }
}
```

Initialize through `gtfs init-merchant --directory /absolute/private/operator --connection /absolute/private/gtfs-connection.json`, or the existing `merchant-providers init gtfs-workspaces --options /absolute/private/setup.json` with `{directory,connection,releaseStore?,name?}`. The initializer creates the original merchant MCP configuration and SF82 release store when one was not supplied. The optional workspace-level `releaseStore` is the original destination for GTFS release-stage operations; declare that same store explicitly when staging is needed.

`merchant_gtfs_open` owns one original GTFS model and serves its same browser. Use `merchant_gtfs_inputs` before import, with its exact file bytes/hash. Save and recover source requests with the same IDs/revision. `merchant_gtfs_publisher_*` borrows the workspace's original publisher and scheduler through `MerchantPublisher.callBorrowed`; it creates no second plan store, version database or timer. The source's ordinary browser and MCP calls can operate the same instance. A separately launched Application/CLI owns its own native lease and must stop before another process opens that directory.

`merchant_gtfs_manifest` returns paginated complete file identities. Preserve `manifestSha256`, `sourceSha256` and all file records. `merchant_gtfs_file_read` accepts the artifact kind/ID, exact relative filename and expected SHA-256; each response includes the original read ID, file bytes/hash, offset, base64 data and next offset. Continue that same identity, or after expiry resume the exact same file/hash at its retained offset. The existing native reader streams immutable files up to 8 GiB, with bounded chunks and owned descriptor closure.

Public SDK exports are `@tokenjunkielabs/starforge-merchant/seller/gtfs`, `/seller/gtfs/workspace`, `/seller/gtfs/browser`, `/seller/gtfs/merchant` and `/seller/gtfs/catalog`. The original publisher, release and file-reader modules retain their existing exports.

## Managed Applications

Choose **GTFS Schedule merchant**, select the private workspace and current complete installed runtime, then use the ordinary Review, Save, Connect, Review Start and Start controls. A new workspace's UUID is assigned from the one retained managed operation, carried in `--expected-workspace-id`, and reused across an interrupted first start. Existing workspaces keep their original UUID and revision.

The CLI emits one `stellar-forge.gtfs-workspace-launch.v1` record containing `GTFS_WORKSPACE_READY`, canonical directory, workspace UUID, PID and actual private URL. The provider verifies the original listener's `/api/gtfs/identity` against those fields before the normal Applications owner retains its URL. Stop/drain closes that original browser, scheduler, publisher and root lease. Reopen reads the same saved source and publication history.

## Complete archive and receiving

```sh
gtfs export --workspace /absolute/private/transit --request EXPORT_UUID --revision CURRENT_REVISION
gtfs inspect-archive --archive /absolute/private/transit.exports/EXPORT_UUID.tar.gz --sha256 ARCHIVE_HASH
gtfs receive --archive /absolute/private/transit.exports/EXPORT_UUID.tar.gz --sha256 ARCHIVE_HASH --output /absolute/private/transit-received --workspace-id ORIGINAL_WORKSPACE_UUID
gtfs serve --workspace /absolute/private/transit-received --expected-workspace-id ORIGINAL_WORKSPACE_UUID --port 0
```

The export request and output live outside the workspace. The archive therefore retains a completed source state with `pending:null`, rather than capturing its own incomplete export journal. The same export UUID binds the exact source root revision and `workspace.json` SHA-256. An already-created archive is inspected and matched to that original request before a lost reply is recovered.

Export closes the idle original scheduler and excludes simultaneous root/publication writes. The Python archive reader takes the exact original `dataset/writer.lease` kernel lock and checks its inode; a busy writer or unquiescent SQLite journal is reported through the existing operation. All ordinary retained files and empty directories are hashed into the full archive manifest. Native live listeners/locks are omitted with an explicit runtime-exclusions receipt. The compressed archive ceiling is 8 GiB, matching the maintained retained-file reader.

Receive verifies the whole archive and every manifest member in private staging before Linux create-only atomic promotion. It preserves the root UUID/revision/bytes, all original plans, source captures, review/decision records, release packages, SQLite histories/schedules and dataset versions. Only the original publisher settings' runtime `sourceFile` and `targetDirectory` paths are relocated to the receiving root; the exact original settings and relocation receipt remain under `.gtfs-receive/ARCHIVE_SHA/`.

Repeating the same receive against its exact original destination returns the saved receiving receipt and current root revision/hash. Later operator work at that destination is preserved. A different archive cannot replace it. Whole archives also support a new valid workspace before its first source selection.

## Native receiving source

The maintained original feed owner identifies the first NW Connector input at 826,295 bytes, SHA-256 `68807e2b9f3b6238b214694fe7787dcb6a28ddcce45600034864c5e59bb4e985`, from [the original Trillium URL](https://oregon-gtfs.trilliumtransit.com/gtfs_data/tillamookcounty-or-us/tillamookcounty-or-us.zip). Its 24 retained members describe feed `22_57_253`, published September 30, 2026, with service dates September 30–November 1 and an empty original `feed_license` field. The owner's original October 12–18 expansion is 651 scheduled instances and 9,022 stop calls, with no calendar-exception or frequency rows in that edition. Preserve its exact original bytes for that receiving case; a newly retrieved feed is a separate source edition.

The whole native receiving operation uses those original expected counts, saves and compares real date selections, publishes through the original plan/candidate/review/version workflow, prepares the original seller release, downloads retained files, exports/inspects/receives the complete workspace and reopens the original publisher. Its actual result and immutable source commit belong to the original GTFS coordination thread. The same receiving command retains the actual operation result with that immutable source commit.

## Source layout

`engine.py` holds the original generic functions. `source.py` retains/compiles/compares original feed editions through the Frictionless package capture. `source.mjs` uses the maintained bounded Python-process bridge. `workspace.mjs` owns the saved source journal and borrows original publisher, scheduler, release and file-reader implementations. `server.mjs` and `public/` extend the original publisher browser. `archive.py` transfers the complete original workspace. CLI, merchant metadata/runtime and Applications provider all call those same modules.
