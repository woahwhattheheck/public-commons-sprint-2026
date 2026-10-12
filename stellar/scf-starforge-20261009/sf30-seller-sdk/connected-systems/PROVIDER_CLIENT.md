# Connected Systems merchant, buyer and MCP integration

This guide connects a reviewed Connected Systems observation edition to the maintained Starforge merchant and customer workflow. Start with the operator and acquisition instructions in [README.md](README.md). The HTTP adapter, MCP tools and command line all operate on the same retained workspace.

## Choose the appropriate receiving output

| Output | Contents | Consumer |
| --- | --- | --- |
| Project packet | Exact source ZIP, reviewed mapping, native CSV/config and original build review | An independently created Connected Systems workspace reconstructs and verifies the original edition. |
| Native dataset directory | `data.csv`, `dataset.json`, `connected-systems-lineage.json` | The existing SF30 seller prepares a priced, versioned dataset route. |
| Merchant release | Those three files, original `seller.json`, and an immutable release manifest | The original seller service publishes and retains editions under its configured limits. |
| Original buyer session | A reviewed live offer, explicit limits, original approval/accounting and received pages | The existing SF88 customer workflow acquires a selected priced edition and produces its normal customer delivery. |

The project packet preserves the complete acquisition evidence. The merchant lineage identifies the endpoint, datastream, declared schema, mapping, coverage and native snapshot alongside the projected file hashes. Keep the complete project with the source owner so a later operator can inspect all raw observations, schema definitions, units and quality fields.

Source access and customer distribution must follow the actual retained source terms and the operator's agreement. A publicly readable endpoint does not by itself fill an unknown license field. Review the captured rights facts and the selected observation window before publishing a release.

## Prepare an original merchant release

Export a completed native build through the operator or command line:

```sh
python3 -B "$CSAPI/cli.py" --workspace "$WORKSPACE" export-dataset \
  --build "$BUILD_ID" --out "$DATASET_DIRECTORY"
```

Here `CSAPI` is the installed or repository `sf30-seller-sdk/connected-systems` directory; all workspace and output variables refer to the operator's chosen absolute paths. A dataset directory must retain all three original files. Preparing a release re-reads their full byte counts and SHA256 values, then loads `dataset.json` through the original SF30 engine and checks its native snapshot against the lineage.

Use the existing reviewed SF30 public payment terms file. Its allowed fields are `scheme`, `network`, `asset`, `amount`, `payTo` and `maxTimeoutSeconds`; the original seller compiler validates their actual values. The file carries public payment terms, not a signer secret. Choose the real canonical HTTPS origin and fixed application path that will serve the release.

```sh
node "$CSAPI/cli.mjs" merchant prepare \
  --dataset "$DATASET_DIRECTORY" \
  --payment "$PUBLIC_PAYMENT_TERMS" \
  --origin "$PUBLIC_HTTPS_ORIGIN" \
  --path /connected-systems \
  --out "$RELEASE_DIRECTORY"

node "$CSAPI/cli.mjs" merchant inspect --release "$RELEASE_DIRECTORY"
```

The release binds the original projected files, payment/query contract, source-series identity and snapshot. The source-series identity includes the endpoint, datastream ID, canonical observation-schema identity and reviewed mapping. A display title does not change that identity. A release retry accepts the exact same complete bytes and rejects a conflicting file at the selected destination.

The installed JavaScript exports are `./seller/connected-systems` for the seller bridge and `./buyer/connected-systems` for the customer bridge. Repository users may import `merchant.mjs` and `customer.mjs` directly.

## Run, publish and retain editions

The seller uses the original SF30 native factory, version store, admission, settlement and control service. Select its existing facilitator and deployment configuration through the maintained seller setup. The standard source-native inspection and project reconstruction need only Node's standard library; actually serving a paid route also requires the original installed SF30 payment dependency graph.

```sh
node "$CSAPI/cli.mjs" merchant serve \
  --release "$RELEASE_DIRECTORY" \
  --state "$SELLER_STATE" \
  --port 8426 \
  --retention-seconds 3600 \
  --max-versions 4 \
  --max-retained-bytes 268435456 \
  --max-cached-versions 2 \
  --max-resident-rows 1000000 \
  --max-in-flight 64 \
  --drain-grace-ms 60000
```

The defaults above are configurable operating limits, not provider retention promises. The public HTTPS origin must route to the actual running seller. The start result returns the service URL, original current snapshot and links to health, offers and documentation. The optional `--facilitator HTTPS_URL` selects the actual supported facilitator; `--allow-local-facilitator` is an explicit local deployment option. `--control-transport unix|loopback` selects the original private control transport.

A later acquisition produces a new source, reviewed build and release. Read the actual current snapshot and revision before publication:

```sh
node "$CSAPI/cli.mjs" merchant status --state "$SELLER_STATE"

node "$CSAPI/cli.mjs" merchant publish \
  --release "$NEXT_RELEASE_DIRECTORY" --state "$SELLER_STATE" \
  --expect "$CURRENT_SNAPSHOT" --expect-revision "$CURRENT_REVISION"
```

Both expected values are taken from the original seller status. A changed current edition causes a conflict rather than overwriting an intervening publication. A new release must retain the same source-series and advertised seller contract. Changing its endpoint, datastream, schema, mapping or payment contract is a separately reviewed service choice.

Rollback selects an actually retained snapshot using the same current-value guard:

```sh
node "$CSAPI/cli.mjs" merchant activate \
  --state "$SELLER_STATE" --snapshot "$RETAINED_SNAPSHOT" \
  --expect "$CURRENT_SNAPSHOT" --expect-revision "$CURRENT_REVISION"

node "$CSAPI/cli.mjs" merchant collect --state "$SELLER_STATE"
```

The original version store owns collection and active-reader retention. Keep cursor and snapshot together when reading subsequent pages. Publishing a new current version does not make an old cursor a request for that new version.

## Customer review and acquisition

The customer first reads the actual live offer for the selected release and first-page query. Query values are strings. The bridge supplies the selected snapshot, so do not pass an arbitrary `snapshot` or `cursor` in the first-page query.

```sh
node "$CSAPI/cli.mjs" buyer offer \
  --release "$RELEASE_DIRECTORY" --seller "$RUNNING_SELLER_URL" \
  --query '{"limit":"100"}'
```

Inspect the returned original payment alternatives, query, edition identity and offer SHA256. Prepare the same intent using the exact selected alternative index and offer hash:

```sh
node "$CSAPI/cli.mjs" buyer prepare \
  --release "$RELEASE_DIRECTORY" --seller "$RUNNING_SELLER_URL" \
  --query '{"limit":"100"}' \
  --intent "$BUYER_INTENT" --accept-index "$ACCEPT_INDEX" \
  --offer-sha "$REVIEWED_OFFER_SHA256" --out "$PRIVATE_BUYER_CONFIG"
```

Preparation reads the live offer again, checks the original offer hash, and produces the existing SF88 draft. It does not create an account, signer or approval. Its immutable output is either newly saved or recovered byte-for-byte at the same destination.

The commands `buyer init`, `status`, `run`, `recover`, `export`, `deliver`, `accounting` and `finalize` delegate directly to the maintained [SF88 dataset CLI](../../sf88-operator-buyer-cli/dataset-cli.mjs). Use that command's current help for its complete setup and approval options. Initialize one original session with the actual configured operator account and explicit page, row, byte and total-amount limits. Each page follows the original quote review, approval, reservation and native buyer operation. An interrupted attempt is reconciled through that same session's `recover` command.

Customer acquisition through this path and project-packet receiving are distinct operations. Importing a project packet reconstructs a previously delivered source edition locally. A paid buyer reads a live seller and retains its actual financial and page-delivery results. A source-code release or prepared offer is not evidence that a payment or sale occurred.

## Connect the maintained operator to MCP

Start the actual operator with a private startup file:

```sh
python3 -B "$CSAPI/cli.py" --workspace "$WORKSPACE" serve \
  --host 127.0.0.1 --port 0 --connection-file "$PRIVATE_STARTUP_FILE"
```

The startup file contains the live loopback URL and private capability, the exact workspace path, instance ID and state `LISTENING`. Keep it under its original user's private directory. The MCP client reads it, authenticates to `GET /api/launch`, and checks the same workspace and instance before each call. The public-facing MCP result contains the operator identity and outcome, not the capability value.

Create a private connection configuration with the exact source and packet aliases needed by this merchant. Replace every uppercase path and hash placeholder below with the actual retained value:

```json
{
  "schema": "stellar-forge.connected-systems-workspace-connection.v1",
  "workspaces": {
    "environmental": {
      "label": "Environmental observation operator",
      "workspace": "/ABSOLUTE/PRIVATE/WORKSPACE",
      "connectionFile": "/ABSOLUTE/PRIVATE/STARTUP.json",
      "timeoutMs": 180000,
      "maxResponseBytes": 67108864,
      "inputs": {
        "reviewed": {
          "path": "/ABSOLUTE/RETAINED/source.connected-systems.zip",
          "kind": "source",
          "label": "Reviewed complete source window",
          "sha256": "ACTUAL_64_HEX_SHA256"
        },
        "customer": {
          "path": "/ABSOLUTE/RETAINED/customer-project.zip",
          "kind": "packet",
          "label": "Original customer receiving packet",
          "sha256": "ACTUAL_64_HEX_SHA256"
        }
      }
    }
  }
}
```

Choose one to thirty-two workspace aliases. Aliases are lowercase letters, digits, underscores or hyphens, start with a letter or digit, and contain at most sixty-four characters. Each workspace selects exactly one of `connectionFile` or `connectionEnv`; the latter names a host environment variable containing the complete original startup JSON. Neither field is a provider credential. Remote provider authentication is separately declared in the saved acquisition connection as an environment-variable name and is read only by its owning HTTP process.

Use the existing initializer from an ES module to create the normal merchant host configuration:

```js
import { initializeConnectedSystemsMerchant } from './mcp-setup.mjs';

const configured = await initializeConnectedSystemsMerchant({
  directory: '/ABSOLUTE/PRIVATE/MERCHANT',
  connection: '/ABSOLUTE/PRIVATE/csapi-connections.json',
  name: 'Environmental observation delivery'
});
console.log(configured);
```

It creates or reopens the existing merchant configuration, original release store and customer export directory. A retry uses the exact same directory, connection file and name; a conflicting configuration is retained and reported. The configuration refers to `connectedSystemsWorkspaceConnection`. The registered merchant provider supplies the `connectedSystemsWorkspaces` family to the existing [merchant operator](../../../../stellar-forge/mcp-merchant-operator/README.md).

The distribution contribution registers `connected-systems-workspaces` and the `connected-systems` application. There is no second workspace implementation or parallel daemon. Starting a managed application invokes this module's same Python operator and the original distribution runtime. Disconnecting the MCP client drains only its borrowed requests and file readers; the application remains with its original owner.

## Complete MCP workflow

| Task | Maintained tools |
| --- | --- |
| Select the configured operator | `merchant_csapi_workspaces`, `status`, `inputs`, `input_inspect` |
| Review and retain provider discovery | `connection_save`, `connection`, `browse`, `document` |
| Save or resume an observation window | `query_save`, `query`, `acquire`, `operation` |
| Inspect source and declared meaning | `source`, `source_files`, `source_rows` |
| Review the native projection | `mapping_propose`, `mapping_save`, `mapping` |
| Build and query an edition | `build`, `build_read`, `native_query` |
| Compare retained editions | `compare`, `changes` |
| Receive an original source or project | `import` with the selected input alias and full expected SHA256 |
| Read full retained files | `file_read`, `file_release` |
| Browse all retained activity | `records` for one of the eight collections |
| End a borrowed connection | `disconnect` |

Except for the first fully spelled tool, every short name in the table also has the prefix `merchant_csapi_`. Discovery and acquisition use explicit stable operation IDs. Reuse the same ID, ordered parameters, selected query and label after an uncertain response. A different request under an old ID is rejected.

For large histories, use `records` with collection, offset and limit. The first page returns a complete view SHA256; use it as `expectedViewSha256` on later pages. A changed view returns a conflict and the new identity. Start a deliberate new view at offset zero rather than mixing pages from different histories.

The file reader supports exact provider response documents, source members, complete comparison JSONL, project ZIPs and merchant dataset ZIPs. Select a retained ID and, for a source file, its exact inventory member name. Continue through the returned read ID, offsets, byte count and full SHA256. The reader is the existing retained-file implementation and closes independently of the retained source. A SHA mismatch or incomplete transfer remains an error.

## Practical acceptance and recovery

A complete customer integration verifies the selected endpoint and observation schema, explicit source rights and coverage, every original page, original native values and cursors, exact project export, independent reconstruction, and customer reopen. The maintained [native receiving entrypoint](delivery/native-receive.py) performs that original source/build/export/receiver journey. The [browser owner](delivery/browser-owner.py) continues its same closed workspace through the visible operator and a separate customer receiver, with the exact coverage policy retained as an input.

Keep provider HTTP receipts and actual error bodies. A 429 or 503 can carry a persisted retry deadline; honor that deadline on the same operation. A returned document may explain a 4xx or 5xx without producing an accepted observation source. A request lost after transmission is reconciled through `operation`, not assumed absent.

Keep the complete original workspace, source packets, mappings, release directories, seller state and customer sessions under their declared retention policy. The operator does not silently delete earlier acquisitions or normalize away conflicting observation IDs. Changes to schema, coverage choice, unit handling or quality interpretation belong in a new reviewed mapping or source selection.

## Publisher example and scope

The [committed OGC reference recipe](delivery/publisher-example.py) supplies an explicitly labeled, single-resource product demonstration through the same source, native dataset and customer receiving interfaces. It does not establish a live sensor feed or authorize a paid deployment. Its retained license and original source values travel with the reference project. A merchant integration must still select its actual customer endpoint, permitted observation window and commercial terms.

For a single observation URL, the saved query includes `observationResource: "single"`; collection queries omit that field. The same source coverage and original mapping enter the lineage, merchant release identity, dataset export and project packet. Do not describe exhausted single-resource coverage as a complete provider collection.

When the selected schema is a static publisher file or a complete supplied URL, use `schemaUrlPolicy: "exact"`. The default format-parameter behavior stays unchanged for live schema endpoints. The chosen policy remains part of the reviewed query and capture selection; a changed policy requires an explicit new query and preserves the prior acquisition history.
