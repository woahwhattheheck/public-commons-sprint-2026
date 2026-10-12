# Complete original GeoServer customer receiving

This is the executable GeoServer continuation for the original PostGIS customer journey. It consumes the current accepted database receipt and the assigned administrator, datastore reader and service reader profiles, operates one original publication workspace, and leaves a complete portable operator plus its actual native WFS/WMS data.

The installed command is:

```sh
starforge geoserver-native-receiving /absolute/geoserver-handoff.json
```

The same source entry is:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/stac/postgis/geoserver/native-receiving.mjs /absolute/geoserver-handoff.json
```

The parent database journey invokes this child after exporting the selected current receipt. Its existing process owner forwards SIGINT/SIGTERM and waits for this child's actual close. It reads OUTPUT/geoserver-native-result.json only after a successful child exit, binds the original child and parent operation IDs, and retains the full output directory with the original native job.

## Select the existing host and original input

Use native-receiving.example.json as the field layout. Every replacement value comes from the original job or observed service. Keep these inputs on the same selected host:

| Input | Original authority |
|---|---|
| sourceHead | Complete source commit already selected and verified by the native job |
| request.receivingDirectory and manifestSha256 | The parent's completed current postgis-receiving.json and full receiving directory |
| profileFile and readerFile | The assigned GeoServer profile and original PostgreSQL source configuration |
| expectedProfileSha256 and expectedReaderSha256 | Exact SHA-256 of those two private files |
| request.layers | Accepted layer IDs, selected service names/styles/roles and actual receiving extent |
| request.expectedPublication | Current recorded publication ID, or explicit null for its first publication |
| browser | Existing original Playwright module and actual selected Chrome executable |

The workspaceDirectory and output directory are separate private canonical directories. The output is also separate from the source receipt and both private configuration files. The complete frozen handoff is claimed through the original PostGIS create-only request helper and remains unchanged across recovery.

The GeoServer profile's database connection must match the actual datastore's host, port, database and read-only role. That same role receives all selected views through the original native PostGIS verifier. GeoServer ACL roles and the PostgreSQL login are distinct inputs. Supply existing administrator and service authorization through their declared environment references.

The native PostGIS verifier must still observe the exact accepted edition and revision, selected current views and ordered typed columns, reader privileges, full role-visible row digests/counts, and original GeoTools primary-key metadata. The child passes the selected layer IDs through that original verifier and retains its complete observations.

For an existing publication, select kind refresh and its original expectedPublication. The direct first-publication case uses kind publish and expectedPublication null. Keep the complete request's source, styles and original absolute paths available across a resumed run.

GeoServer operation IDs use its existing letters, digits, dot, underscore and hyphen syntax, up to 128 characters. Give the child, publication, rollback and refresh stable explicit IDs. The parentOperationId field separately carries the original database journey's identity, including its colon separators.

## Actual receiving sequence

The child uses the maintained installed CLI, attached to the same original loopback writer throughout service work:

1. Load the original receipt and inspect the actual assigned service.
2. Prepare the native publication and retain its exact review and review SHA.
3. Apply that reviewed operation. After an interrupted native mutation, reconcile its actual resource observations before continuing.
4. Receive WFS and WMS capabilities for every configured service reader, each selected schema and complete feature stream, and the actual PNG for every enabled layer. Disabled layers retain their native disabled response.
5. Export the complete original operator directory and create its full ZIP through the original Python archive implementation.
6. Close the original console and reopen the same operator. Read the same retained request, review, operation state and publication identity through the original CLI.
7. When the existing browser is selected, open the industrial console, read the retained review and current history, display every saved native WMS image, and receive the original ZIP through the browser's actual download flow.
8. Close the original writer, independently adopt each complete exported operator, and inspect its original operation through the same native CLI with the adopted profile references.

All service actions use the maintained publisher, journal, REST transport and WFS/OGC receiving modules. The same native database verifier remains the accepted data authority.

## Explicit scoped rollback and refresh

The optional cycle field selects two additional stable original operation IDs. After the first complete publication export, the child uses the original prepareRollback and apply paths to restore only that publication's owned resource changes. Its current accepted database receipt stays explicit. The rollback export retains the full before/after history and native operation.

The child then prepares a refresh using the same original selected receipt and layers, expecting the recorded rollback as its current publication. The final refreshed service receives its complete WFS/WMS data and independent export again. The service ends at that final retained publication.

If the first native operation observed that all requested resource values were already present, its journal contains no owned mutation to reverse. The result records NO_OWNED_CHANGES and refreshes from that same original publication. Existing unowned resources remain governed by the original publisher's field-scoped contract.

A conflicting later service edit is surfaced by the original reconciliation and rollback checks. The same request and observations stay in the original journal for continuation. For a rollback involving a different accepted database edition, the parent completes its actual database rollback and exports its current receipt first, then invokes the normal GeoServer rollback flow with that exact receipt. This child's optional cycle operates within its one retained current receipt.

## Retained outputs and recovery

The complete output contains:

| Path | Content |
|---|---|
| request.json | Full frozen original handoff |
| configuration.json | Original private file paths, exact hashes and selected source commit |
| requests/ and reviews/ | Exact publication/rollback/refresh requests and native reviews |
| operations/ | Complete original CLI operation results |
| exports/publication/ | Full first native service/operator receiving package |
| exports/rollback/ and exports/refresh/ | Explicit cycle packages when selected and applicable |
| archives/ | Exact complete ZIPs for the selected packages |
| opens/ and reopened-operation.json | Actual original console instances and reopened native state |
| browser/operator.png | Actual industrial console with retained review/history and native maps |
| browser/operator.zip | Actual browser download of the final retained ZIP |
| adopted/ | Independently adopted original operators |
| phases/ | Original phase completions bound to the complete handoff |
| geoserver-native-result.json | Final complete result after original service/browser drain |
| failure.json | Latest actual interrupted attempt while original recovery state remains retained |

Completed phase selection and original output bytes are reused. Export recovery reopens and verifies the full native manifest, every selected source member, the original request/review and complete ZIP bytes. Adoption recovery uses the original same-target adopter, then reads the same original operation. A completed result reopens its retained file inventory and full exported packages before returning.

The output lease stays held through original browser, server and recovery-owner drain and final result publication. Failed close operations retain the same owners and retry with pacing. Both OS signal handlers remain installed until cleanup completes; interrupted commands return the original 130/143 outcome. The underlying Linux lease descriptor follows its original one-shot close semantics.

A cancelled or interrupted run resumes using exactly the same handoff file, output, original operator and operation IDs. Its existing published effects, completed WFS source pages, full archives and original adoption remain available.

## Programmatic parent join

```js
import { runGeoServerNativeReceiving } from
  '@tokenjunkielabs/starforge-merchant/seller/stac/postgis/geoserver/native-receiving';

const result = await runGeoServerNativeReceiving(originalHandoff, {
  environment: process.env,
  signal: originalParentSignal,
  progress: event => retainOriginalProgress(event)
});
// result.schema === 'starforge.geoserver-native-result.v1'
// result.state === 'complete'
```

The supplied signal reaches the original console/publisher and native receiving. The parent keeps its original source selection, accepted database epoch and native job admission. The direct command enables sustained OS signal handling; programmatic callers default to their provided parent signal.

Node 22.16 or later, the complete original PostGIS/WFS source/runtime, the selected Python archive runtime and existing GeoServer service are required. The native job provides the original pg/pg-cursor dependencies and any selected browser installation. Private profile files carry credential references; the original environment supplies their current values.
