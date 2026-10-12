# Native catalogue receiving in the STAC application

The catalogue operator runs inside the existing authenticated STAC host and its existing Applications card. It uses an original completed StacDelivery, complete collection metadata and GeoNetwork's native STAC-to-ISO transform. Source collection IDs and the exact native UUID mapping remain visible in the saved source review.

## Open the existing application

Initialize or receive the original STAC workspace using its existing commands. Then select a private catalogue directory:

~~~sh
starforge stac serve \
  --workspace /absolute/imagery-workspace \
  --catalogue-workspace /absolute/catalogue-workspace
~~~

The same command supports --catalogue-config /absolute/private-catalogue.json. Its optional configuration is the original controller configuration: title, handoverDirectory, and sourcePublication with an existing private directory and baseUrl. The source publication location must already be served by an operator-controlled service. This command creates no public source listener.

In Applications, open the existing **Satellite imagery and processing** card. Add **Catalogue receiving workspace** and, if needed, **Private catalogue host configuration**. Review and save that same card, then Start/Open it. The managed review binds the installed source, original STAC workspace, selected catalogue directory, existing catalogue workspace ID and selected configuration bytes. Startup checks the actual private session and catalogue identity before returning STAC_READY. Stop uses the existing application process lifecycle.

A new catalogue directory may be selected when its private parent already exists. An existing directory must retain its original identity. The catalogue shares the host's session cookie and CSRF protection; opening or switching the browser tab does not dispatch native work.

## Complete receiving workflow

1. In **Catalogue receiving → Installation**, select the actual GeoNetwork installation context, portal, language and optional expected version. Enter environment-variable names for the existing username/password or cookie/CSRF bindings. Save the reviewed connection, then read native identity and capabilities. Credential values are never form fields.
2. In **Collection source**, inspect the original customer delivery directory. Select the entire collection set for this harvester and receive it. The source retains the original delivery identity, complete collection metadata, original links and native record IDs. If a relative link needs context, supply its actual original document URL in the reviewed collection URL map.
3. Download the complete content-addressed JSON. Serve those exact bytes from an existing publication location, or explicitly publish through the configured sourcePublication directory. The resulting source URL contains the document SHA256 and is checked from the actual catalogue operator. Native pagination is disabled.
4. In **Harvest plan**, choose the native owner/group, import validation and explicit sharing. Review every collection removed from the previously verified complete source. Save the plan, then run that selected plan. GeoNetwork creates collection-level series records through its installed native transform.
5. In **Operations**, follow the saved native status. A completed local HTTP job can still leave the native operation RUNNING, PARTIAL or RECONCILE. Continue the original saved operation after reviewing its retained steps. The controller reads native history/ownership/counters and does not repeat an uncertain native mutation.
6. In **Record review**, inspect current metadata, approved/draft hashes, sharing, validation, workflow and native publication options. Open the actual saved XML. Validation selects the approved or draft version explicitly. Submission and approval bind the selected draft when present; sharing/publication bind approved metadata and its current sharing hash. Each action preserves its exact input and native processing outcome.
7. In **Handover**, export to a new private directory. The full bundle contains original delivery bytes, collection sources, plans, operation files and native archives. Receive that bundle into a new private catalogue directory. The current host retains its original binding; review the received directory in the same Applications card before starting it.

A full MEF archive is distinct from external STAC links. Native archive validation checks the selected records, metadata and attachment inventory. Importing metadata elsewhere does not recreate an original native harvester relationship or workflow history; the retained recovery state describes the actual outcome.

## CLI receiving and continuation

Every command below uses the same original STAC and catalogue workspaces. Set their explicit absolute paths on each invocation.

~~~sh
starforge stac catalogue-state \
  --workspace /absolute/imagery-workspace \
  --catalogue-workspace /absolute/catalogue-workspace

starforge stac catalogue-delivery \
  --workspace /absolute/imagery-workspace \
  --catalogue-workspace /absolute/catalogue-workspace \
  --delivery /absolute/completed-stac-delivery

starforge stac catalogue-action \
  --workspace /absolute/imagery-workspace \
  --catalogue-workspace /absolute/catalogue-workspace \
  --action harvest --input /absolute/reviewed-harvest.json \
  --operation-id catalogue-ORIGINAL-OPERATION
~~~

The reviewed-harvest.json body is {"planSha256":"THE_SAVED_PLAN_SHA256"}. Preserve its actual selected hash and original operation ID. Reissuing that same public controller request reconciles the saved native operation. An HTTP timeout is not permission to replace the ID.

Available catalogue-action values map directly to the maintained controller:

| Action | Input fields |
|---|---|
| configure | connection, optional expectedRevision |
| connect | Empty object |
| receive | deliveryDirectory, collectionIds, optional sourceUrls/sourceTitle |
| review | sourceSha256, plan |
| publish-source | sourceSha256 |
| harvest | planSha256, optional pollMs/maxPollMs |
| inspect-records | Optional uuids |
| record-action | uuid, action, payload, expectedMetadataSha256, optional expectedSharingSha256 |
| export-handover | outputDirectory |
| receive-handover | sourceDirectory, directory |

The input JSON omits operationId; supply it explicitly through --operation-id. The returned result includes that ID. Keep credential values only in the selected host's environment.

catalogue-source --source SHA256 returns the complete saved source review. catalogue-document --document SHA256 --out FILE saves the exact full collection JSON. catalogue-file --path SAVED_RELATIVE_PATH --out FILE streams an original verified operation XML/MEF/JSON file. Outputs are created without replacement unless --overwrite is explicitly selected.

## Reopen and lifecycle

The native workspace stores operations and immutable public request envelopes. The browser retains a request ID before dispatch and reuses the controller's original envelope after reopening on another local port. Native active work uses the existing server job; an explicit continuation re-enters the same durable controller operation.

Closing the STAC host aborts its owned catalogue network exchanges before draining native work. An interrupted mutation remains DISPATCHING/UNKNOWN for later native reconciliation. Verified file streams close their owned descriptors on response termination or server shutdown. Switching tabs disposes no native operation.

The installed browser manifest includes the same catalogue view and stylesheet. It preserves all existing STAC, eoAPI, Prescient and processing leaves. No separate application card, controller, database, worker or paid acquisition is created for this integration.

