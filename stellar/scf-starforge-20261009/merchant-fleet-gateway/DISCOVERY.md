# Publish a fleet merchant into discovery

The managed fleet includes a discovery desk for each declared tenant. It joins the
original SF82 seller enrollment, SF60 signed catalogue and SF61 buyer explorer to
the same foreground fleet owner used for release changes and customer delivery.
Use the **Discovery** section in the fleet workspace, the `fleet-release`
foreground commands, or the authenticated merchant MCP provider.

The tenant keeps one seller identity and one catalogue as its release moves
between slots. Prices, payment choices, publications, withdrawals and history
come from the original retained release and signed journal. The fleet's current
routing guard spans enrollment creation and publication, so a reviewed release
cannot change under the signing operation.

## Begin with a serving merchant

Set up and start the existing fleet as described in [BOOTSTRAP.md](BOOTSTRAP.md)
and [RELEASE_OPERATOR.md](RELEASE_OPERATOR.md). Select a tenant and read its
discovery status. Status identifies the current slot, exact merchant instance,
release ID and digest, and gateway revision.

For a new tenant:

1. Enter the seller ID and review enrollment for the exact serving instance.
   The source URL defaults to the original merchant's HTTPS origin and
   `/_seller/offers`. An explicit source URL is checked by the original source
   reader.
2. Read the actual source, origin, recipients, networks and payment schemes in
   that review. Create enrollment with the returned review ID.
3. Download the original public seller enrollment when another original
   catalogue operator needs its public key and accepted source permissions.
4. Start discovery. The fleet opens the original tenant catalogue and its SF61
   buyer explorer. Status returns their current origins and the exact discovery
   instance ID.
5. Review publication against the serving release. The comparison includes each
   selected route and its actual original payment requirements. Apply that
   review, then read the committed catalogue and original resource history.
6. Open the buyer explorer or read a page through the discovery desk. Select the
   actual resource there and use its existing SF88 preparation controls.

Reviews are specific to one tenant, current merchant instance, immutable source,
gateway revision and original catalogue head. They expire after ten minutes and
are consumed once. A release or catalogue change requires a fresh comparison.

## Keep identity across deployment and rollback

Enrollment lives at `FLEET_DIRECTORY/discovery/TENANT`. Its original setup record
pins the release source used to enroll and the accepted seller permissions. The
fleet reopens that retained source from the tenant's declared slots. Preserve
the original private discovery directory and its retained source when moving or
backing up the fleet.

After a blue/green activation, the discovery desk uses the newly serving release
for the next publication comparison. The same seller key, catalogue and resource
history continue across that change. A price change uses the original catalogue
revision path. A rollback can be reviewed and published through the same desk.

Status and reviews show the enrolled permissions, the selected release's
requested permissions, and any additions. The original signing policy checks
publication against the enrollment. A changed recipient, origin, network or
scheme outside that enrollment must be resolved through the original
host-administered enrollment and policy workflow before that source can publish.

Stopping a release slot does not discard its retained source or its signed
history. Stopping discovery closes this owner's buyer explorer and catalogue;
starting it again reopens the retained identity. Closing the fleet drains its
accepted work, closes discovery services, and then closes its merchant children.

## Withdraw a route removed by a replacement

A newer release can omit a route that the older release published. Select the
older retained slot and release in the source view to inspect its original
routes, payment choices and current catalogue state. Review withdrawal with:

- The **currently serving** slot and merchant instance.
- The older route's **source slot and release ID**.
- The exact original route ID and a concrete withdrawal reason.

Apply the returned review ID. The original signer records withdrawal in the
same resource lifecycle. This works after the older slot stops; its retained
release source supplies the route identity. Read the resource's original
catalogue key in history to see its publications, price revisions and withdrawal
together.

## Recover an interrupted enrollment

The original setup writes its completion record last. An interruption can leave
private key or public configuration files at the tenant destination. Discovery
status inspects that destination and returns `INCOMPLETE` with a recovery
inspection ID, file names, types and sizes when the original catalogue and
workspace have not been initialized.

Review enrollment again with that exact inspection ID. The review includes both
the incomplete files to preserve and the source and permissions of the proposed
enrollment. Applying it checks the same files again, moves the entire incomplete
directory into `FLEET_DIRECTORY/discovery-recovery/`, syncs the directory
changes, and creates enrollment through the original setup routine. The result
and subsequent status identify the retained incomplete directory.

If another interruption occurs after preservation, status shows the retained
directory and the current canonical setup state. Continue from that actual
state. Complete setup records and initialized original catalogue or workspace
data remain with their original identity and are reopened or repaired through
the original owner. Public status exposes file descriptions and the inspection
identity; private signing bytes stay in the private setup files.

## Recover a lost response

Enrollment creation, start, stop and signed publication report the original
operation result. If the browser, CLI transport or MCP connection loses that
response, refresh status and the original catalogue history. Those reads show
the durable enrollment, owned instance and journal result.

For publication, compare the retained route and payment revision with the
reviewed change before creating another review. The discovery desk consumes a
review once and never automatically repeats a signing request after a response
loss. The catalogue's original transaction receipts remain the authority.

## Foreground CLI

Start the existing owner:

```sh
node stellar/scf-starforge-20261009/merchant-fleet-gateway/release-cli.mjs start \
  --plan /absolute/private/fleet-plan.json \
  --directory /absolute/private/fleet-owner
```

Within that foreground session, use IDs returned by the actual status and
review responses. These command forms describe the whole discovery lifecycle:

| Command | Result |
| --- | --- |
| `discovery TENANT` | Current serving binding, enrollment, catalogue, permissions and recovery state |
| `discovery-review-enrollment TENANT SLOT INSTANCE_ID SELLER_ID [SOURCE_URL]` | Exact new enrollment review |
| `discovery-review-recovery TENANT SLOT INSTANCE_ID SELLER_ID INSPECTION_ID [SOURCE_URL]` | Reviewed preservation of an incomplete setup and enrollment |
| `discovery-enroll TENANT REVIEW_ID` | Original enrollment creation |
| `discovery-enrollment TENANT` | Original public enrollment document |
| `discovery-start TENANT` | Original catalogue and buyer explorer startup or reopen |
| `discovery-stop TENANT INSTANCE_ID` | Close the exact owned discovery instance |
| `discovery-source TENANT SLOT RELEASE_ID` | Retained source, exact payments and catalogue comparison |
| `discovery-review TENANT SLOT INSTANCE_ID` | Current serving release publication review |
| `discovery-review-withdrawal TENANT SLOT INSTANCE_ID SOURCE_SLOT SOURCE_RELEASE ROUTE_ID REASON` | Original retained route withdrawal review |
| `discovery-apply TENANT REVIEW_ID` | Original signed publication or withdrawal |
| `discovery-history TENANT CATALOG_KEY` | Original signed resource lifecycle |
| `discovery-consume TENANT [JSON_PAGE_OPTIONS]` | Actual native discovery page |

A withdrawal reason and catalogue key consume the remaining text on the line.
Use a JSON-quoted string when exact leading or trailing whitespace matters.
Discovery page options are one complete JSON object; it cannot replace the
selected tenant.

```text
discovery-consume analytics {"view":"list","limit":25,"offset":0}
discovery-consume analytics {"view":"search","query":"transfers","limit":10}
```

## Browser and authenticated MCP

The managed workspace uses its existing session, host and origin checks for the
discovery controls. Enrollment and publication require an explicit reviewed
apply action. Tenant drafts stay with their tenant; a changed source or gateway
revision invalidates its pending review.

The existing MCP fleet configuration and trusted transport expose these tools:

| Tool | Purpose |
| --- | --- |
| `merchant_fleet_discovery_status` | Read current tenant state |
| `merchant_fleet_discovery_enrollment_review` | Review enrollment, including inspected incomplete recovery |
| `merchant_fleet_discovery_enroll` | Apply the exact enrollment review |
| `merchant_fleet_discovery_enrollment` | Read the original public enrollment |
| `merchant_fleet_discovery_start` | Start or reopen catalogue and buyer explorer |
| `merchant_fleet_discovery_stop` | Stop the exact owned discovery instance |
| `merchant_fleet_discovery_source` | Inspect an original retained release |
| `merchant_fleet_discovery_review` | Review publication or an older route's withdrawal |
| `merchant_fleet_discovery_apply` | Apply the original signed change |
| `merchant_fleet_discovery_history` | Read the original resource lifecycle |
| `merchant_fleet_discovery_consume` | Read a page through the original buyer explorer |

All tools require `tenant`. Enrollment review also takes `slot`,
`instanceId` and `sellerId`, with optional `sourceURL` and
`expectedIncompleteId`. Publication review takes `slot`, `instanceId`
and `action` (`publish` or `withdraw`). An older withdrawal adds
`sourceSlot`, `sourceReleaseId`, `routeId` and `reason`. Apply calls take
the original returned `reviewId`. Stop uses the discovery instance ID from
discovery status, which is separate from the merchant instance.

## Native discovery pages and buyer preparation

The desk's consumer reads the tenant's actual original catalogue through its
owned SF61 explorer. `view=list` uses `limit` and `offset`;
`view=search` requires `query` and can pass the original opaque `cursor`.
Both retain the original filter names: `network`, `type`, `scheme`,
`payTo` and `extensions`.

The response includes the original page under `page`, together with the current
discovery origin and buyer explorer URL. SF61 preserves the page's native
resources, pagination, source URL and observation time. Use the explorer's
existing page export and review preparation to pass those exact resource and
payment choices to SF88.

The fleet consumes only the owned tenant source. Requests supply page options,
while the original owner selects the catalogue origin, private stores and
signing paths.

## Workspace API

The managed workspace serves these routes under `/api/releases/discovery`.
They return the original discovery result directly:

| Method and suffix | Input |
| --- | --- |
| `GET /` | `tenant` query |
| `GET /enrollment` | `tenant` query |
| `GET /source` | `tenant`, `slot`, `releaseId` queries |
| `GET /history` | `tenant`, `catalogKey` queries |
| `GET /consume` | `tenant` and native page queries |
| `POST /enrollment/review` | Enrollment review fields |
| `POST /enrollment/create` | `tenant`, `reviewId` |
| `POST /start` | `tenant` |
| `POST /stop` | `tenant`, discovery `instanceId` |
| `POST /review` | Publication or withdrawal review fields |
| `POST /apply` | `tenant`, `reviewId` |

The status route is exactly `/api/releases/discovery?tenant=...`, without a
trailing slash. The existing workspace request-size limit, private session
header, host checks and shutdown behavior apply.
