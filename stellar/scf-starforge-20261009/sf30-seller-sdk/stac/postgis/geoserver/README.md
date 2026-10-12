# GeoServer publication from an accepted PostGIS edition

This operator takes the original PostGIS intake receiving directory, publishes its selected stable views through an existing GeoServer workspace and datastore, and receives the resulting service as complete native WFS and WMS data. It keeps one durable operation across preparation, reviewed application, interruption, reconciliation, receiving, export and selective rollback.

The browser, attached command line and Node API share the same original publication writer. Database intake, edits, promotion, backup and restore remain in the maintained parent `stac/postgis/` controller. This component calls that controller's `verifyReceiving` with the actual datastore reader and `requireUnchangedRows: true`.

## Installed and source entry points

The complete distribution contribution installs:

| Entry | Purpose |
|---|---|
| `starforge geoserver` | Native operator, attached CLI and portable receiving commands |
| `@tokenjunkielabs/starforge-merchant/seller/stac/postgis/geoserver` | Complete Node publication, console and handover API |
| `…/geoserver/console-client` | Attach to an already running local operator |
| `…/geoserver/cli` | The original CLI function |

In a source checkout the equivalent CLI is:

```sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/stac/postgis/geoserver/cli.mjs help
```

Use the complete original PostGIS/WFS distribution with Node 22.16 or later, Python 3, and its selected `pg` / `pg-cursor` runtime. The Node command reuses the existing Python executable selected by `profile.python` or the environment's maintained runtime. It does not install dependencies or launch another database or GeoServer instance.

`distribution-contribution.json` is the exact source-owned installation declaration. The parent producer places it under `distribution/contributions/postgis-geoserver-publication.json` and runs the original distribution composer. `browser-assets.json` is also the server's actual route declaration, so the three served browser files travel with the command.

## Select the original service and reader

Create two private JSON files. Their exact bytes are retained with the operator and bound to every native verification.

The GeoServer profile identifies the existing context, workspace, datastore, database binding, REST administrator reference and service readers. For example:

```json
{
  "schema": "starforge.geoserver-profile.v1",
  "id": "customer-geoserver",
  "baseUrl": "https://maps.customer.example/geoserver",
  "workspace": "accepted",
  "datastore": "accepted_postgis",
  "database": {
    "profileId": "original-postgis-profile",
    "host": "postgis.customer.example",
    "port": 5432,
    "name": "customer_gis",
    "schema": "accepted",
    "role": "geoserver_reader",
    "primaryKeyMetadataTable": "accepted.gt_pk_metadata"
  },
  "administrator": {
    "scheme": "Basic",
    "authorizationEnv": "GEOSERVER_ADMIN_AUTHORIZATION"
  },
  "readers": [
    {
      "id": "customer-viewer",
      "roles": ["ROLE_VIEWER"],
      "authorization": {
        "scheme": "Basic",
        "authorizationEnv": "GEOSERVER_VIEWER_AUTHORIZATION"
      }
    }
  ]
}
```

Use actual names from the original receiving manifest and service. The view metadata table must be the original schema-qualified GeoTools table populated by the parent PostGIS controller. The datastore must expose primary keys and use the same observed read-only database login. Selected views retain `sf_id`, `sf_key`, `geom`, their ordered native columns, actual SRID and accepted row observations.

The reader file uses the existing PostgreSQL source declaration and credential resolver:

```json
{
  "schema": "stellar-forge.postgres-source.v1",
  "connection": {
    "host": "postgis.customer.example",
    "port": 5432,
    "database": "customer_gis",
    "user": "geoserver_reader",
    "passwordEnv": "POSTGIS_READER_PASSWORD",
    "tls": "verify-full"
  }
}
```

The existing `connectionEnv` form is also supported. The original resolver owns TLS, CA-file selection, environment references and password behavior. It accepts plaintext only for an explicitly selected loopback PostgreSQL connection. Queries in this source declaration are not a replacement for the original receipt verifier.

For GeoServer authentication:

| Scheme | Value of the selected environment variable |
|---|---|
| `Basic` | Complete `Basic BASE64(username:password)` header |
| `Bearer` | The original raw bearer token |
| `ApiKey` | The original raw API key |

Credential values are read from the host environment. Profile files contain references. The HTTPS path uses the original SF31 transport and its origin-bound authentication contract. An existing local HTTP GeoServer is selected explicitly with `baseUrl: "http://127.0.0.1:PORT/geoserver"` and `allowLoopback: true`. Any configured trusted proxy must belong to that exact service origin.

The database login and GeoServer roles represent different authorities. The native verification connects as the datastore's actual read-only database role. Layer `read` and `write` rules name existing GeoServer service roles. The receiver uses every configured service reader and requires each one to have an explicitly selected read role. Workspace administration rules are retained as observations.

## Open the industrial operator

```sh
starforge geoserver serve \
  --workspace /absolute/private/geoserver-operator \
  --profile /absolute/private/geoserver-profile.json \
  --reader /absolute/private/postgis-reader.json \
  --port 0
```

The command prints the actual private loopback URL and `connectionFile`. Open that URL to use:

1. **Publication selection.** Read the actual workspace, datastore, native views, roles and styles; load the original PostGIS receiving directory; select up to 256 layers in one reviewed publication. Large native inventories are paged in the screen.
2. **Review and apply.** Inspect each exact before/after change, original request, accepted edition and review SHA. Apply or resume that saved review.
3. **Native receiving.** Receive capabilities, XSD, every original feature page and a WMS PNG for each enabled selected layer and configured reader. Saved maps load individually when requested.
4. **Portable operator.** Export or resume the same complete handover directory and optionally create its ZIP. The browser streams the actual ZIP through a native form download without materializing the entire archive in browser JavaScript.
5. **Selective restoration.** Prepare a separate rollback operation against the currently accepted original database receipt.

The browser stores a local draft of the current selection where storage is available. Prepared operations, provider responses, native captures, accepted review and export selection are retained by the native journal. Opening another browser page attaches to that same writer.

The server binds to `127.0.0.1`, verifies Host and Origin, uses a random private capability, sends no CORS permission, and serves the fixed source-owned asset manifest. Its connection file is private and identifies the actual instance, workspace and origin. The browser removes the capability fragment from its address after receiving it.

## Use the same running writer from the command line

With the browser open, attach through the original connection file:

```sh
starforge geoserver target \
  --connection /absolute/private/geoserver-operator/console-connection.json

starforge geoserver inspect \
  --connection /absolute/private/geoserver-operator/console-connection.json
```

The client checks the original instance, workspace and profile through `/api/launch`, then sends commands to that bound local origin. It does not open the publication journal a second time.

For a stopped console, replace `--connection FILE` with the original `--workspace DIR --profile FILE --reader FILE`. Native mode acquires the original kernel lease, completes the selected command and drains the same service and journal before returning.

### Prepare a complete selection

A request file names the accepted manifest and every selected layer:

```json
{
  "operationId": "customer-edition-1",
  "kind": "publish",
  "receivingDirectory": "/absolute/original/postgis-receiving",
  "manifestSha256": "THE_ACTUAL_64_CHARACTER_MANIFEST_SHA256",
  "expectedPublication": null,
  "layers": [
    {
      "layerId": "THE_ORIGINAL_LAYER_ID",
      "name": "customer_parcels",
      "title": "Customer parcels",
      "abstract": "Accepted parcel edition",
      "enabled": true,
      "advertised": true,
      "style": {
        "name": "polygon",
        "workspace": null
      },
      "access": {
        "read": ["ROLE_VIEWER"],
        "write": ["ROLE_ADMINISTRATOR"]
      },
      "map": {
        "bbox": ["24.7", "60.0", "25.3", "60.5"],
        "width": 800,
        "height": 600
      }
    }
  ]
}
```

The example placeholders are replaced by the actual original source IDs, SHA and existing roles. `workspace: null` selects a global style. Omitting `style.workspace` selects the chosen GeoServer workspace.

To publish a workspace SLD, provide `style.file`, its exact `style.sha256` and native `format` (`sld` or `se`) along with the selected workspace style name. The operator captures and inspects those source bytes before preparing the review. An existing referenced style is observed and compared; changing its bytes requires an explicitly selected source file.

Map bounds are exact numeric strings in `CRS:84` west/south/east/north order. Omit the map selection to use the actual advertised geographic bounds. An enabled layer without advertised nonempty bounds needs an explicit map extent. WFS receiving requests the original accepted native EPSG reference and retains every numeric lexeme and key.

```sh
starforge geoserver prepare --connection /absolute/private/geoserver-operator/console-connection.json \
  --request /absolute/private/publication-request.json
```

Preparation reads the complete original receipt and every member, verifies the actual current native database edition and read-only role, checks full role-visible row digests and GeoTools key metadata, and captures the current GeoServer resources. It passes exactly the selected original layer IDs to the maintained PostGIS verifier and binds the returned selected-layer observations. A datastore reader can therefore receive its authorized selected views from a larger accepted receipt without being required to read unrelated views. It produces the original `reviewSha256`.

```sh
starforge geoserver apply --connection /absolute/private/geoserver-operator/console-connection.json \
  --operation customer-edition-1 --review-sha256 ACTUAL_REVIEW_SHA256
```

Application persists each exact native request before dispatch, retains the provider response, and reads the selected resource back. GeoServer's initial FeatureType POST and automatically created layer remain explicit intermediary states until the selected flags and style have been confirmed. Completion re-verifies the original database and advances the retained publication only after those steps.

### Refresh, interruption and reconciliation

A refresh has `kind: "refresh"`, the new accepted PostGIS manifest, and `expectedPublication` set to the current original publication ID. It uses the same stable source views and an explicit full selection. Preparation retains the current native difference before anything is applied.

After an interrupted request:

```sh
starforge geoserver inspect --connection /absolute/private/geoserver-operator/console-connection.json \
  --operation customer-edition-1

starforge geoserver reconcile --connection /absolute/private/geoserver-operator/console-connection.json \
  --operation customer-edition-1
```

Reconciliation observes every selected resource and retains its current state. It preserves the first confirmed applied full resource image, which remains the later deletion baseline. A subsequent edit to an unrelated field cannot become permission to delete that edited resource.

Resume using the same operation ID and exact retained review SHA. Repeat an interrupted preparation using its exact original request file. A retained `expectedPublication: null` stays the original first-publication expectation on replay. New bytes or a new predecessor use a new request and operation ID.

Provider Retry-After information is retained. A later explicit continuation can reuse that original operation after the provider's actual interval. The controller does not silently repeat an uncertain mutation.

For a running attached command:

```sh
starforge geoserver cancel --connection /absolute/private/geoserver-operator/console-connection.json \
  --operation customer-edition-1
```

SIGINT and SIGTERM remain installed through native cleanup. Native mode cancels and drains the actual database/source/WFS work, closes the service and releases its journal last. Attached mode requests cancellation of its original server operation and drains its own HTTP requests; the browser's existing service remains the owner of that operation's final cleanup. A failed close retains the same owner for retry.

### Receive the actual service

```sh
starforge geoserver receive --connection /absolute/private/geoserver-operator/console-connection.json \
  --operation customer-edition-1
```

For every declared reader the receiver retains:

- Original WFS 2.0 and WMS 1.3 capability request, complete bytes and parsed native observation.
- The original WFS DescribeFeatureType document and native field/type observation.
- Complete original GetFeature captures, ordered by native `sf_id`, using the maintained WFS/OGC capture engine. It verifies exact exposed fields, geometry type/dimension, stable FeatureId suffix, unique increasing IDs, complete row count and accepted reader visibility.
- The exact WMS PNG, requested CRS:84 extent, dimensions, style and original response.
- The actual disabled-layer response when a selected layer is disabled.

The original raw feature pages retain SQL numeric identifiers and JSON numbers without converting them through JavaScript floating-point serialization. Feature-sequence and key-sequence hashes describe the actual received WFS representation; the original database verifier independently owns the accepted database row digest.

The receiver checks all selected resources and the current accepted database again after the service capture. A stopped or interrupted receive reuses its original capabilities, documents and complete captures, then continues missing work. Failed original responses remain available in the receiving history.

## Export, reopen and adopt the full operator

```sh
starforge geoserver export --connection /absolute/private/geoserver-operator/console-connection.json \
  --operation customer-edition-1 \
  --out /absolute/private/customer-geoserver-handover \
  --archive /absolute/private/customer-geoserver-operator.zip
```

The export freezes one immutable selection before copying. It contains the exact original PostGIS receiving files, host configuration references, complete publication operations and review, retained public provider bodies, native capabilities/XSD/feature pages, maps, and an operator guide. The original raw datastore responses that may contain credential material remain in the source host's private object store; the delivered public datastore binding and response references remain in the journal.

A partially copied export resumes the same selection and target files. A previously completed target is inspected and reused only when its complete manifest and every member match. ZIP creation streams the exact manifest inventory with bounded buffers, fsyncs its complete bytes, publishes create-only, and verifies all original ZIP members before returning the actual archive SHA.

```sh
starforge geoserver inspect-handover \
  --directory /absolute/private/customer-geoserver-handover \
  --manifest-sha256 ACTUAL_HANDOVER_SHA256

starforge geoserver adopt \
  --directory /absolute/private/customer-geoserver-handover \
  --out /absolute/private/adopted-geoserver-operator \
  --manifest-sha256 ACTUAL_HANDOVER_SHA256
```

Inspection checks complete member custody, original operation/request/review identities, exact host binding, original PostGIS receipt, and native WFS document and complete capture records. Adoption requires an empty private target or its own retained same-source adoption marker. It holds the original kernel lease and resumes exact partial copies.

Open the adopted operator with the returned `profileFile` and `readerFile`. Supply the original environment references on that host and the actual selected CA file when the original reader declares one. The adopted profile identifies the same database and GeoServer service. Applying a retained operation verifies their current state; changing service identity creates a different configured operator.

The portable ZIP is a complete copy of the manifest inventory. Extract it with a normal archive reader into a private directory, then use the same `inspect-handover` and `adopt` commands.

## Selective rollback

The original publication retains the complete applied field scopes and its first confirmed native postimages. Reconcile it before preparing restoration:

```json
{
  "operationId": "rollback-customer-edition-1",
  "publicationId": "customer-edition-1",
  "receivingDirectory": "/absolute/original/current-postgis-receiving",
  "manifestSha256": "THE_ACTUAL_CURRENT_ACCEPTED_MANIFEST_SHA256",
  "expectedPublication": "customer-edition-1"
}
```

```sh
starforge geoserver rollback-prepare \
  --connection /absolute/private/geoserver-operator/console-connection.json \
  --request /absolute/private/rollback-request.json
```

Review and apply that new operation using its own exact SHA. Existing resources restore only recorded fields after checking the current selected scope. A resource created by this operation is removed only if its full current image still matches that first owned image. Later edits remain conflicts, and deletion uses nonrecursive native REST operations. Selected ACL rows are restored individually, preserving unrelated rules.

If the original feature definition needs an earlier database relation or SRID, use the original PostGIS controller to complete its database restoration first and provide that current accepted receipt. GeoServer service rollback does not rewrite the database.

## Node API and local protocol

```js
import {
  openGeoServerOperator,
  openGeoServerConsoleClient,
  inspectGeoServerReceiving
} from '@tokenjunkielabs/starforge-merchant/seller/stac/postgis/geoserver';

const client = await openGeoServerConsoleClient({
  connectionFile: '/absolute/private/geoserver-operator/console-connection.json'
});
try {
  const current = await client.inspect('customer-edition-1');
  const received = await client.run('receive', {operationId: current.state.id});
  console.log(received.state.state);
} finally {
  await client.close();
}
```

`openGeoServerOperator` composes the actual host connection resolver and native PostGIS verifier. `openGeoServerPublisher` exposes the same controller for an existing host that already owns that original verifier and exact host configuration bytes. The full signatures and returned state are in `index.d.mts`.

| Native operation | Local console route |
|---|---|
| Instance/profile binding | `GET /api/launch` |
| Current publication and operations | `GET /api/state` |
| Exact request/review/state | `GET /api/operation?id=…` |
| Current service target | `GET /api/target` |
| Original receiving selection | `POST /api/source` |
| Prepare/apply/reconcile/rollback/receive/export | `POST /api/action` |
| Original asynchronous job | `GET /api/job?id=…` |
| Cancel current original operation | `POST /api/cancel` |
| Saved native PNG | `GET /api/map` |
| Complete retained ZIP | `GET /api/archive` or authenticated native `POST /download` |

JSON API routes require the original private Bearer capability. Mutations accept only the declared action fields. A command's operation ID and review retain its durable identity; a console job ID identifies its current HTTP lifetime. No REST layer or second SQLite database replaces the original journal.

## Native contract references

This implementation composes the original PostGIS receiving verifier, WFS source capture and OGC exact JSON engine with the published GeoServer contracts:

- [Feature type REST operations and recalculation](https://docs.geoserver.org/main/en/user/rest/api/featuretypes.html)
- [Layer REST operations](https://docs.geoserver.org/main/en/user/rest/api/layers.html)
- [Native style bytes, raw uploads and scoped deletion](https://docs.geoserver.org/main/en/user/rest/api/styles.html)
- [Layer security and workspace administration semantics](https://docs.geoserver.org/main/en/user/security/layer.html)
- [Database primary-key metadata](https://docs.geoserver.org/main/en/user/data/database/primarykey.html)
- [PostGIS datastore configuration](https://docs.geoserver.org/main/en/user/data/database/postgis.html)
