# Socrata source and customer operation through merchant MCP

The merchant MCP can operate the same Socrata source workspace used by the local
browser, then continue through the original dataset publisher, release lifecycle
and customer acquisition. Source pages, mappings, capture IDs, dataset snapshots,
publisher drafts, release generations and buyer sessions remain in their original
stores.

The adapter owns one original operator object per declared workspace. Opening its
browser borrows that same object, including its lazy publisher. A capture started
in the browser can continue through MCP; closing the borrowed browser leaves the
agent's operator open.

## Connect the original workspace

Create a private connection JSON file and bind existing private workspace
directories. An empty source directory is supported for a first capture or a
portable-package restore. Each directory has one alias.

~~~json
{
  "schema": "stellar-forge.socrata-workspace-connection.v1",
  "workspaces": {
    "queens_housing": {
      "label": "Queens affordable housing production",
      "directory": "/srv/starforge/hpd",
      "domains": ["data.cityofnewyork.us"],
      "imports": {
        "original_capture": {
          "label": "Original complete HPD capture",
          "kind": "capture",
          "file": "/srv/starforge/source/hpd-capture.json"
        },
        "portable_workspace": {
          "label": "Complete source and edition history",
          "kind": "package",
          "file": "/srv/starforge/delivery/starforge-socrata.json.gz"
        }
      }
    }
  }
}
~~~

Remove an import entry if that original file is not present. A capture manifest
keeps its original page references; preserve those files beside their manifest.
The connection file uses mode 0600 and original workspace directories use 0700 on
Unix. Paths and provider credential environment-variable names are selected by
the host.

The original operator uses SOCRATA_APP_TOKEN when available. Set appTokenEnv on a
workspace to select another existing environment variable; an explicitly selected
empty variable is an opening error. Declare the provider domains that the
workspace may contact. Source configuration and capture continuation check that
selection before using the original provider transport.

Initialize the existing merchant MCP provider:

~~~sh
node stellar-forge/mcp-merchant-operator/serve.mjs \
  init-socrata-workspaces \
  --dir /srv/starforge/hpd-agent \
  --connection /srv/starforge/hpd-connection.json

node stellar-forge/mcp-merchant-operator/serve.mjs \
  serve --config /srv/starforge/hpd-agent/merchant-mcp.json \
  --token-env MERCHANT_MCP_TOKEN
~~~

The same command is available through the maintained merchant-mcp command alias.
For an existing merchant configuration, add socrataWorkspaceConnection pointing
to the private connection file. Its other source, accounting, receiving, release
and operator settings remain available.

## Capture and map actual source data

Call merchant_socrata_status to see declared aliases, imports and public merchant
profiles. Call merchant_socrata_open with workspace:"queens_housing"; retain the
returned instanceId. Opening an already opened alias selects that same instance.

Configure the actual HPD source:

~~~json
{
  "workspace": "queens_housing",
  "action": "configure",
  "source": {
    "domain": "data.cityofnewyork.us",
    "datasetId": "hg8x-zxpr",
    "protocol": "soda2.1",
    "where": "borough='Queens'",
    "order": "project_id,building_id,bbl",
    "pageSize": 1000
  }
}
~~~

Send this to merchant_socrata_source. Choose action:"inspect" to read the actual
metadata and selection count, or action:"search" with query/domain to search the
provider catalog. New captures add the original provider row ID as a stable
ordering tie-breaker.

Use merchant_socrata_capture with action:"start", then action:"advance" and
pages:1. Every accepted page is retained before the next request. Choose
action:"pause" or "resume" to continue that same capture. After an interrupted
tool response, read merchant_socrata_status and continue the retained capture.
Importing uses action:"import" and sourceImport:"original_capture", resolving
only the host-declared manifest.

The source workspace guide documents the complete native mapping schema:
[columns, null policies and edition comparison](../../stellar/scf-starforge-20261009/sf30-seller-sdk/socrata/README.md).
Pass that mapping as merchant_socrata_mapping's mapping object. Use
merchant_socrata_edition with action:"build", inspect its actual comparison and
snapshot, and use action:"activate" with an original editionId when choosing a
different retained edition.

HPD publishes building-in-project records. Preserve that scope when interpreting
the data. Identifier and calendar-date strings keep their exact original text;
select numeric conversion explicitly for fields that need it. Empty identity
columns select row-content multiset comparison. Complete non-null unique keys
enable keyed changes.

## Query, hand over and restore

merchant_socrata_query accepts the original native query object or query string.
For a mapping exposing the indicated capabilities, this selection reads
preservation projects with at least 20 counted units:

~~~json
{
  "workspace": "queens_housing",
  "query": {
    "where_reporting_construction_type": "Preservation",
    "gte_all_counted_units": "20",
    "sort": "-all_counted_units",
    "limit": "100",
    "fields": "project_id,building_id,bbl,project_name,all_counted_units,latitude_internal,project_start_date"
  }
}
~~~

Use the returned original cursor unchanged for the next page and retain the
other query parameters. The source operator saves the accepted query and native
continuation with that edition.

merchant_socrata_export creates the original portable workspace and its companion
CSV, native configuration, provenance, saved-query and merchant files. Its file
descriptors include complete byte counts and SHA-256 values.

Read a file with merchant_socrata_file:

~~~json
{
  "workspace": "queens_housing",
  "kind": "source-export",
  "id": "EXPORTED_NATIVE_ID",
  "filename": "starforge-socrata.json.gz",
  "offset": 0,
  "limit": 196608
}
~~~

Use the actual export ID returned by the operator. The first chunk returns the
verified file hash, readId, base64 bytes and nextOffset. Continue with that readId,
expectedSha256 and nextOffset until nextOffset is null. The shared retained-file
reader loads the original file once and uses its verified snapshot for later
chunks. An expired read can resume by original file identity, expected hash and
byte offset. merchant_socrata_file_release releases an unfinished read.

Copy the complete portable package to a receiving host and declare it as a
kind:"package" import for an empty original source directory. Open that workspace
and call merchant_socrata_restore with its sourceImport alias. The original
importer verifies retained pages, mapping, native CSV and saved snapshot. The same
query and edition are available after reopening.

## Continue into the original publisher and buyer

The connection can also declare:

| Field | Host configuration |
| --- | --- |
| merchants | Named profiles with label, origin, path and the original public payment object |
| runtime | Original release port, facilitator and optional explicit allowLocalFacilitator |
| buyerWorkspaces | Named existing SF88 operator directories with their original identity, signer, policy and ledger |

A merchant profile's payment contains scheme, network, asset, amount, payTo and
maxTimeoutSeconds. Use its actual supported commercial terms. The original seller
compiler validates them when merchant_socrata_merchant selects that profile.

Configure a merchant for the selected edition and export it. In
merchant_socrata_publisher, use action:"publisher.prepare" and
payload:{"exportId":"ORIGINAL_EXPORT_ID"}. The adapter resolves that exact immutable
export from the source workspace and calls the original publisher.

The publisher accepts the same actions and reviewed native IDs as the
[full publishing workflow](../../stellar/scf-starforge-20261009/sf30-seller-sdk/socrata/PUBLISHING.md),
with three host-binding translations:

| Original action | MCP payload |
| --- | --- |
| publisher.prepare | exportId from this original source workspace |
| publisher.release.stage | draftId, id and optional label; runtime comes from the host connection |
| publisher.buyer.session | buyerId, buyerWorkspace alias, maxPages, maxTotalAtomic, optional maxRows/maxPageBytes |

All other action payloads use the original publisher schema. In sequence, prepare
the retained draft, stage its release, activate its reviewed generation and start
the original seller. Review the actual buyer offer and prepare a distinct buyer
intent using its advertised payment option. Select the existing buyer workspace
and acquisition limits, then run that original dataset session.

The original SF88 policy, reservations ledger, signer and recorded page attempts
control the acquisition. Recover or account the same session after interruption.
Export a completed session through the original SF88/SF100 delivery operation.

If an original attempt stopped before signature, the session report can expose
unpaidContinuation with its page index, intentId and attemptSha256. To continue
that page explicitly, choose publisher.buyer.run with the same id,
retryUnpaid:true and expectedAttemptSha256 copied from that report. The original
buyer checks the exact retained attempt and absence of any matching ledger row
under its approval lease, preserves the failed attempt in immutable history, and
then uses its normal consent, reservation and signing flow. Completed pages stay
in the same acquisition. retryUnpaid defaults to false; publisher.buyer.recover
continues to inspect the original attempt evidence.

merchant_socrata_file also reads draft-csv, draft-review, buyer-config,
session-manifest, session-csv, session-jsonl and session-review using each original
record's UUID. The completed CSV, JSONL and HTML review are read from the original
data room and checked against its delivery manifest. Their first chunk returns the
verified hash; subsequent chunks use the same retained reader.

## Use the shared industrial browser

Call merchant_socrata_browser with action:"open" and the selected workspace. Open
the returned private local session URL on that host. Browser and agent operate the
same source and publisher objects. The browser's Source, Capture, Mapping,
Queries, Merchant, Export and Publisher sections display the original records.

action:"close" closes only the borrowed browser. merchant_socrata_close requires
the current instanceId and drains the browser and original operator. Reopening
uses the original workspace, drafts, release selection and customer sessions.
An independently running source CLI already owns its lease; use that session or
close it before opening the same directory in MCP.

## Tool inventory

| Tool | Original operation |
| --- | --- |
| merchant_socrata_status | Declared aliases and paged original source/customer state |
| merchant_socrata_open / close | Original operator and process ownership |
| merchant_socrata_source | Provider configuration, metadata and catalog |
| merchant_socrata_capture | Actual page capture, pause/resume and declared import |
| merchant_socrata_mapping / edition | Native typed mapping and retained edition selection |
| merchant_socrata_query | Original native dataset query and cursor |
| merchant_socrata_merchant | Original seller configuration from a host profile |
| merchant_socrata_export / restore | Complete original source package and recovery |
| merchant_socrata_file / file_release | Complete original files through the shared retained reader |
| merchant_socrata_publisher | Original publication, release and acquisition lifecycle |
| merchant_socrata_browser | Borrowed browser over the same operator |

Status returns each source history's offset, limit, total and nextOffset.
Captures, editions and exports retain their original order and IDs. Active
capture counts remain visible without repeating every raw page descriptor.
