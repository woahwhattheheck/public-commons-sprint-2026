# Commissioning an imagery service and its receiving operation

An imagery customer needs a useful geographic selection, the files required by its GIS task, a clear right to use them, and a way to obtain the next agreed edition. This design carries that job through the maintained STAC, eoAPI, Prescient, merchant and buyer products. It joins the [SF49 source-service commissioning designs](README.md) and the customer's existing private workorder.

The deliverable is a working service on the chosen merchant host, the selected imagery in the buyer's actual consumer, and another operator who can maintain the installation. The source and downstream application determine the implementation. A public catalog, a customer deployment behind OIDC, and a Prescient SDK connection use their corresponding original source and identity owners.

## Define the customer's useful operation

Start with the decision the buyer will make. An infrastructure analyst might need the latest usable acquisition covering a defined corridor; a project team might need a reproducible imagery pack for a planning review. Select the actual area, dates, collection, asset roles and receiving application before choosing a payment amount.

| Workorder decision | Record with the selected customer operation |
| --- | --- |
| Useful output | The map, image selection, analysis input or recurring review the receiving person will use; the application's supported file format and coordinate system. |
| Source | Exact catalog endpoint, original collection IDs, source version and the source operator; choose upstream or the customer's deployed catalog explicitly. |
| Selection | Bounding box or GeoJSON geometry, acquisition window, any supported cloud predicate, page budget and required coverage. Name intended scene/asset pairs after reviewing their original descriptors. |
| Rights | Each collection's license and attribution, the customer's access basis, retention period, redistribution permission, and any requester-pays choice. |
| Service | Public merchant origin and path, network, asset, recipient, integer request amount, facilitator and the operator responsible for changing these terms. |
| Buyer | Existing buyer host/profile, approved wallet, complete selection, per-request and total spending limits, and the person responsible for the receiving result. |
| Maintenance | Source refresh cadence, expected data delay, acceptable operational interruption, off-host retention and the receiving maintainer. |
| Commercial work | The agreed implementation scope, price, acceptance, invoice events and ongoing support arrangement in the original private case. |

The original public reference retained two complete 15-scene Austin editions and the selected 29,731-byte source image. The adjacent [query example](imagery-query.example.json) uses the maintained Austin/September search contract. It is an editable source request; a later capture keeps its own actual response, completeness and result count. The source operation is retained with the [STAC/Cirrus receiving work](https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791775911834199?thread_ts=1791761556.094779).

Keep the source's acquisition time, original geometry, projection, raster scale/offset/nodata, collection license and asset roles with the files. A catalog comparison shows changes to retained scene metadata. A land-cover, radiometric or other scientific comparison belongs to the selected processing workflow and its actual inputs.

## Choose the host and source arrangement

The complete operator joins the analyst's scenes and assets, deployment policy, customer delivery review and commissioning in one authenticated local browser. The [onboarding guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/a8672f147f919e7f4de1b92c43c26a9a75342d95/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/eoapi/ONBOARDING.md) describes the maintained commands and SDK. Use the installed source containing that complete product and its dependencies; record the deployed release in the existing workorder.

From an installed source root, the original CLI can be selected once:

~~~sh
STARFORGE_SOURCE=/srv/starforge/source
STAC_CLI="$STARFORGE_SOURCE/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/cli.mjs"

node "$STAC_CLI" eoapi-init \
  --workspace /srv/imagery/operator \
  --endpoint https://catalog.example.invalid/stac \
  --title "Customer imagery"

node "$STAC_CLI" eoapi-serve \
  --workspace /srv/imagery/operator \
  --port 0
~~~

Replace the example endpoint and paths with the selected deployment. Open the complete local URL returned by the host. The existing browser session and CSRF contract govern changes. For a custom retained policy workspace or delivery root, supply the same `--policy-workspace` and `--output-directory` values on every eoAPI command for that installation.

The original Applications manager can open the corresponding managed STAC/eoAPI/Prescient host. Save and reopen the selected original workspace and source configuration. Direct CLI operation remains available with the same files. A standalone command that takes the source host's lifetime lock runs after that owned host is stopped.

### Public or OIDC catalog

Use the [deployment policy editor and compiler](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/a8672f147f919e7f4de1b92c43c26a9a75342d95/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/eoapi/POLICY.md) for the actual source version, ordered routes, identity configuration and collection rights. The upstream's captured conformance declarations determine whether the selected record filters are supported. The review shows the exact compiled settings and stale environment settings to remove when applying a replacement.

For a public catalog, select the compiler's explicit public identity mode. The received package includes the public factory for its recorded Auth Proxy source version. For OIDC, select the customer's actual discovery URL, audience and ordered route rules. The original Auth Proxy factory and approved configuration are deployed together.

The [source-runtime example](imagery-source-runtime.example.json) uses the actual eoAPI host schema and named environment references for its operator and reader principals. Replace the example origin and reference names, keep the file private, and select it explicitly:

~~~sh
chmod 600 /srv/imagery/private/source-runtime.json

node "$STAC_CLI" eoapi-serve \
  --workspace /srv/imagery/operator \
  --source-config /srv/imagery/private/source-runtime.json \
  --port 0
~~~

Use the original OAuth connection reference when that connection owns the credential. The source owner resolves the current identity at dispatch. An actual rejected bearer is reconciled by that original connection; source continuation keeps the same retained operation. An additional asset origin receives only its own reviewed source binding.

### Prescient catalog and S3 imagery

Use the [Prescient operator guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/a8672f147f919e7f4de1b92c43c26a9a75342d95/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/prescient/OPERATOR.md), its [profile](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/a8672f147f919e7f4de1b92c43c26a9a75342d95/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/prescient/profile.example.json) and [deployment configuration](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/a8672f147f919e7f4de1b92c43c26a9a75342d95/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/prescient/deployment.example.json). Configure the customer's exact endpoint, collections, identity mode, opaque local binding and approved S3 bucket/key prefix/region. Set the asset ceiling and retention/portable-delivery choice from the actual rights.

Approve the saved profile, connect through the original SDK, then use the same scene and file workflow. The native worker retains its SDK/session and partial file operation. Its completed receiving prefix, ETag/version, full asset hash and final delivery association survive restart. The completed SDK receiving operation already exercised interruption after a 16,384-byte prefix and after final rename using the original 29,731-byte Austin asset; its [native SDK receiving record](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8DNUARL6) carries that source operation.

The receiving host selects its own binding. The customer handover carries the approved portable profile and selected permitted data; the source host's private SDK environment and identity session remain with that host.

## Approve the source and the files the buyer needs

Import a complete approved policy package or author/review/approve it in Deployment configuration. Use the responsible operator's actual name:

~~~sh
node "$STAC_CLI" eoapi-policy-import \
  --workspace /srv/imagery/operator \
  --input /srv/imagery/approved-policy/package.json
~~~

**For a newly initialized source workspace**, first discover its actual catalog and collections. Review that saved source before its first scene capture:

~~~sh
node "$STAC_CLI" eoapi-source-discover \
  --workspace /srv/imagery/operator \
  --source-config /srv/imagery/private/source-runtime.json \
  --target upstream \
  --operation-id customer-catalog-discovery

node "$STAC_CLI" eoapi-source-review \
  --workspace /srv/imagery/operator \
  --target upstream \
  --reviewer "Receiving operator"
~~~

**For an already retained complete edition**, review that edition's original captured catalog, then associate it with the exact saved source review:

~~~sh
node "$STAC_CLI" eoapi-source-review \
  --workspace /srv/imagery/operator \
  --edition ORIGINAL_EDITION_ID \
  --target upstream \
  --reviewer "Receiving operator"

node "$STAC_CLI" eoapi-bind \
  --workspace /srv/imagery/operator \
  --source-review RETURNED_SOURCE_REVIEW_ID \
  --edition ORIGINAL_EDITION_ID \
  --operation-id customer-source-association
~~~

The endpoint, catalog, collections, licenses and policy must agree. Select `--target deployment` on discovery and review when the actual selected endpoint is the approved customer deployment. Use the returned ready source-review and edition identities from this installation. A retained handover can supply the original complete editions through the existing analyst import.

For a new selection, edit the actual-schema [query input](imagery-query.example.json), then run:

~~~sh
node "$STAC_CLI" eoapi-capture \
  --workspace /srv/imagery/operator \
  --source-config /srv/imagery/private/source-runtime.json \
  --source-review RETURNED_SOURCE_REVIEW_ID \
  --input /srv/imagery/private/query.json \
  --operation-id customer-scene-capture

node "$STAC_CLI" eoapi-operation \
  --workspace /srv/imagery/operator \
  --operation-id customer-scene-capture
~~~

The source adapter follows the actual next-page request. A page budget can produce a partial capture; completion means the provider traversal ended. Continue that original operation using `eoapi-resume --operation-id customer-scene-capture`, with the same source configuration and workspace. A new agreed query takes a distinct operation.

In Scenes & assets, select the intended scenes and exact asset keys. Inspect their original rights, storage, MIME and size information. Acquire the selected files with the reviewed byte ceiling:

~~~sh
node "$STAC_CLI" eoapi-assets \
  --workspace /srv/imagery/operator \
  --source-config /srv/imagery/private/source-runtime.json \
  --edition RETURNED_EDITION_ID \
  --max-bytes 67108864 \
  --operation-id customer-selected-files

node "$STAC_CLI" eoapi-delivery-review \
  --workspace /srv/imagery/operator \
  --edition RETURNED_EDITION_ID \
  --reviewer "Receiving operator" \
  --operation-id customer-delivery-review

node "$STAC_CLI" eoapi-delivery-approve \
  --workspace /srv/imagery/operator \
  --review RETURNED_DELIVERY_REVIEW_ID \
  --reviewer "Receiving operator"
~~~

The 64 MiB example ceiling is a configuration choice for this command; use the customer's reviewed file sizes. The maintained asset path supports files up to 2 GiB. A full raster may need a larger limit than a preview. S3 or requester-pays access uses the corresponding configured native owner.

The saved delivery review exports a complete immutable edition and pins its declared members and selected assets. Approval binds that exact export. A later analyst selection or source capture can be reviewed separately while the approved customer edition remains available.

## Publish the resource and receive the original purchase

The [native merchant/customer guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/a8672f147f919e7f4de1b92c43c26a9a75342d95/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/MERCHANT.md) defines the payment, source, selection and recovery contract. Supply the merchant's agreed payment JSON with `scheme`, `network`, `asset`, `amount`, `payTo` and `maxTimeoutSeconds`. The merchant chooses the commercial value of the service and its actual request price.

~~~sh
node "$STAC_CLI" eoapi-merchant-stage \
  --workspace /srv/imagery/operator \
  --delivery-approval RETURNED_DELIVERY_APPROVAL_ID \
  --operation-id customer-merchant \
  --origin https://merchant.example.invalid \
  --path /stac \
  --payment /srv/imagery/private/payment.json

node "$STAC_CLI" merchant-serve \
  --directory RETURNED_MERCHANT_DIRECTORY \
  --port 8423 \
  --facilitator https://facilitator.example.invalid
~~~

Use the returned staged directory. Its native merchant plan pins the original approved edition, routes and payment selection. Another edition or changed public terms is a separate reviewed merchant package.

The three resource routes serve the scene dataset, exact edition manifest, and declared file bytes. One useful imagery delivery can require multiple approved page/file requests. Its commercial price model and the buyer's cap therefore need to describe those actual request units.

The buyer's maximum reserves one request for the edition manifest, the selected maximum dataset pages, one request per selected file of at most 1 MiB, and `ceil(fileBytes / chunkBytes)` for each larger file. The original customer planner sums those units exactly and enforces the buyer's declared aggregate cap. Use each actual member's size, the reviewed chunk size and payment amount; source-page preferences do not establish the buyer's maximum.

Copy [the original Buyer configuration template](imagery-buyer-config.example.json) to the private buyer host and select its existing runtime, state and operator profile. Prepare `files.json` from the approved edition's actual manifest-relative paths. Include the source metadata required by the handover and every selected asset approved for this delivery. The original customer includes its complete item document and validates each declared path.

~~~sh
node "$STAC_CLI" customer-create \
  --directory /srv/imagery/private/customer \
  --merchant RETURNED_MERCHANT_DIRECTORY \
  --id customer-approved-imagery \
  --buyer-config /srv/imagery/private/buyer.json \
  --query /srv/imagery/private/buyer-query.json \
  --files /srv/imagery/private/files.json \
  --max-pages REVIEWED_DATASET_PAGE_CEILING \
  --max-total-atomic REVIEWED_INTEGER_TOTAL \
  --chunk-bytes 1048576

node "$STAC_CLI" customer-run \
  --directory /srv/imagery/private/customer \
  --buyer-config /srv/imagery/private/buyer.json

node "$STAC_CLI" customer-deliver \
  --directory /srv/imagery/private/customer \
  --buyer-config /srv/imagery/private/buyer.json \
  --out /srv/imagery/customer-delivery
~~~

The buyer query contains the original string-valued dataset parameters; `{}` selects the default full projection. A custom projection retains `item_key`, which joins each received row to its complete original Feature. The scene selection, byte transfers and financial outcomes remain with the original Buyer, Dataset and Object operations.

After an interrupted purchase, inspect and recover the original customer directory with `customer-inspect` and `customer-recover`, then explicitly continue `customer-run` using that same buyer state. The final delivery manifest is written after its complete files. Repeating delivery reopens that completed receiving result or continues its saved copy.

## Deliver something the GIS user can open

Use the complete directory produced by `customer-deliver` as the eoAPI handover input:

~~~sh
node "$STAC_CLI" eoapi-delivery-export \
  --workspace /srv/imagery/operator \
  --delivery-approval RETURNED_DELIVERY_APPROVAL_ID \
  --directory /srv/imagery/customer-delivery \
  --out /srv/imagery/handover

node "$STAC_CLI" eoapi-delivery-open \
  --directory /srv/imagery/handover \
  --expected-manifest-sha256 RETURNED_HANDOVER_MANIFEST_SHA256
~~~

The receiving exporter verifies that the customer's actual acquired edition and files match the approved delivery. The resulting package contains the original received data, scene explorer, local STAC catalog, GeoJSON, source/rights inventory, exact policy package and delivery/source approvals.

| Retained output | What the receiving operator opens |
| --- | --- |
| Analyst workspace or STAC handover | Catalog captures, complete editions, analyst decisions, comparisons and original selected source files. |
| Approved standalone edition | The reviewed manifest, scene projection, complete Features, source captures and declared assets supplied to merchant staging. |
| Customer delivery | The original acquired dataset/files, selection and native acquisition/delivery reports; opens through `StacDelivery.open` or `customer-open`. |
| eoAPI portable handover | The completed customer delivery plus GIS explorer/catalog and its approved source, policy and delivery associations. |
| Commissioning package | The selected plan, actual catalog/access responses and independently reopenable operating observations. |

These formats each have a defined reader and ownership. Select the completed customer delivery at the export step; its native binding and acquisition reports establish how those exact files reached the buyer.

Transfer the complete produced handover and its returned manifest hash to the receiving host. Open the offline scene explorer and the agreed files in the customer's actual GIS application. Check the useful AOI/scene selection, footprint, source time, attribution and the asset role the task requires. A second operator imports the same policy through the original policy receiver and can reopen the selected delivered edition.

For a Prescient handover, review/export/open the same completed customer directory in the Prescient panel. The [operator guide](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/a8672f147f919e7f4de1b92c43c26a9a75342d95/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/prescient/OPERATOR.md#5-receive-on-another-host) supplies its additional profile/receiving manifest and local binding import.

## Commission access, refresh and maintenance

The customer installation includes a practical change and recovery operation. Use [Deployment commissioning](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/a8672f147f919e7f4de1b92c43c26a9a75342d95/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/eoapi/commissioning/COMMISSIONING.md) with the approved source or deployment target. Its saved plan contains the exact public request and expected status, collection visibility, source conformance or selected file validator.

The [plan example](imagery-commissioning-plan.example.json) uses the existing plan schema for an OIDC deployment with a public root, denied anonymous search and an approved reader search. Replace its approval ID, target URLs, collection, source window and expected responses with the chosen policy. The host's source-runtime example exposes the matching `customerReader` principal. Review the full plan in the original panel before running it.

For public-source commissioning, use anonymous cases and that source's actual expected responses. A complete retained anonymous capture can be attached to its exact matching case. The original owner performs an authenticated case through its configured connection. Each case records the response it obtained; a completed plan carries the separate observed result of each case.

| Operating event | Customer-maintained continuation |
| --- | --- |
| Same source edition, interrupted scene capture | Resume the saved capture and its original next request. |
| Same selected file, interrupted transfer | Continue the original asset operation and retained receiving state. |
| Lost browser response | Retry the retained exact action/operation from the existing workspace. |
| Changed source or query | Acquire/review a new edition, compare coverage and metadata, and retain the previous customer's output. |
| Changed access policy or source rights | Save and review the new policy, apply its complete replacement settings, commission the selected allowed/denied cases and retain prior delivered associations. |
| Changed merchant terms | Stage the new reviewed merchant package; the original customer's source, terms and acquired output stay in its existing operation. |
| Receiving-host move | Transfer the complete delivery/commissioning packages; restore private operating state separately and select the receiving host's own credential bindings. |

Agree the recurring useful output with the buyer. Record how many actual selections become completed consumer tasks, what source/storage/transfer effort they require, and the operator time needed to maintain them. The existing commercial case records implementation payment events and support effort. The original buyer records retain the corresponding data-service requests and financial outcomes.

## Apply the existing SCF work packages

This imagery design is an implementation choice within the existing two-merchant/two-buyer cohort and six packages. Use the canonical 400 prospective hours, $38,000 request and 150-day award-relative schedule.

| Existing package | Imagery installation work and receiving outcome |
| --- | --- |
| T1 merchant resource integration | Configure the actual catalog/identity, rights, useful source selection, approved merchant route and buyer GIS import. Deliver the customer's chosen usable imagery. |
| T1 merchant authority handover | Complete the actual source/terms change, transfer the selected policy and source history, and have another operator maintain that service. |
| T2 provider and ledger deployment | Operate the same useful selection through the two selected facilitators and original buyer ledgers; retain complete consumer tasks alongside their page/file requests. |
| T2 deployed threat response | Diagnose and complete the original unfinished source, identity or paid-file operation on the customer hosts, preserving its financial and receiving state. |
| T3 mainnet merchant rollout | Configure the selected production asset/accounts and service supervision; run the agreed recurring buyer task with controlled release and rollback. |
| T3 production recovery and handover | Finish off-host retention, receiving-host restoration, key rotation and the receiving team's support operation. |

The existing Element 84, Development Seed and Sparkgeo workshares each describe a $4,800 implementation over ten business days after agreed inputs, for one catalog and up to two collections, with 50% at start and 50% on delivery. The [existing commercial cases in the canonical application](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C86PRE5NF) retain the offer, contact and acceptance state. Size the selected deployment from the actual source access, data volumes and receiving application; assign prospective grant work and a separately purchased commercial implementation to their actual agreement once.

## Demonstrate the complete customer operation

Use the selected real installation and its retained source:

1. Open the customer's useful area/period and original selected scene/file. Show the source identity and the receiving use.
2. Open the approved policy and source association; show the explicit asset selection and immutable delivery review.
3. Open the original merchant/customer selection, actual request cap and completed acquired output.
4. Open that same portable delivery in the buyer's GIS workflow and inspect its retained source/rights.
5. Reopen it on the receiving host, then show the agreed source/terms change or continuation from the original operating history.

The [application insertion](IMAGERY_APPLICATION_TEXT.md) gives the manuscript editors the useful buyer outcome and remaining customer-host work. The complete source contract is in [STAC](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/a8672f147f919e7f4de1b92c43c26a9a75342d95/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/README.md), [eoAPI onboarding](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/a8672f147f919e7f4de1b92c43c26a9a75342d95/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/eoapi/ONBOARDING.md), [the original merchant/customer](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/a8672f147f919e7f4de1b92c43c26a9a75342d95/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/MERCHANT.md), [deployment policy](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/a8672f147f919e7f4de1b92c43c26a9a75342d95/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/eoapi/POLICY.md), [commissioning](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/a8672f147f919e7f4de1b92c43c26a9a75342d95/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/eoapi/commissioning/COMMISSIONING.md) and [Prescient](https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/a8672f147f919e7f4de1b92c43c26a9a75342d95/stellar/scf-starforge-20261009/sf30-seller-sdk/stac/prescient/OPERATOR.md), selected at merge `a8672f147f919e7f4de1b92c43c26a9a75342d95`.
