# Receive the original USGS seasonal-load files

The observation-source receiver accepts the original P13YSTHM ZIP and can receive selected original members from a supported publisher download. It retains the actual ZIP directory, exact member paths, source bytes and CSV structure before the existing scientific importer qualifies stations or aggregates seasonal estimates.

Run from the delivered Upper Savannah application root. The receiver uses the Python standard library and the existing model.common persistence helpers. Its original source capture is source/usgs-seasonal-loads-20261012/capture.json, containing the publisher's data_release3.zip identity: 1,897,877,062 bytes and MD5 2dc4d81994c4fcbf7d27728eb16fdaef. The selected release remains DOI 10.5066/P13YSTHM.

## Receive the existing source

If the original acquisition owner already has the complete ZIP, inspect that same file:

~~~sh
python3 -B -m source_tools.usgs_archive inspect \
  --capture source/usgs-seasonal-loads-20261012/capture.json \
  --archive /owned/original/data_release3.zip \
  --output /owned/upstate-usgs-members
~~~

The receiver checks the entire original ZIP against its published length and MD5 and retains its actual SHA256. It does not make a second source request.

For a supported original download, preserve the legitimate publisher-issued URL in a private local text file and inspect it:

~~~sh
python3 -B -m source_tools.usgs_archive inspect \
  --capture source/usgs-seasonal-loads-20261012/capture.json \
  --download-url-file /owned/private/usgs-download-url.txt \
  --output /owned/upstate-usgs-members
~~~

Omitting both source arguments selects the original ordinary download URI in the retained ScienceBase item. The official ScienceBase file-management guide describes a temporary Amazon S3 location for downloads larger than 1 GB. Continue the existing publisher download session to its Download File link and preserve that exact URL in the private local file used above.

The receiver now starts with **GET and Range: bytes=0-0**. S3 presigned URLs bind the HTTP method, so a URL issued for downloading can support GET while a HEAD request has a different signature. The probe must return HTTP 206, Content-Range exactly bytes 0-0/1897877062, an unencoded entity, a valid strong ETag and exactly one response byte. If Content-Length is present, it must be 1. The published total comes from Content-Range, not from that one-byte response length.

Every subsequent GET sends If-Match with the same strong ETag and requests an explicit byte interval. The response must be 206 with the exact Content-Range, unchanged final URL and ETag, original encoding and complete interval byte count. The existing streaming member extraction and four-block range cache continue from this snapshot. An ETag is an entity validator; the publisher's MD5 is checked separately when a complete original ZIP is supplied.

HTTP 200 means the endpoint returned an ordinary whole-body response to the range request. The receiver records its actual status and headers, marks range_unsupported, records body_bytes_read as 0, closes it, and selects verified_complete_archive as the next source mode. It does not launch a second full download. Continue the existing original capture, then supply that complete file with --archive. This also leaves a publisher landing page identifiable through its Content-Type and reported length instead of turning the page into a ZIP member.

The current temporary URL stays in the private local file. Portable receipts preserve its SHA-256, host, path hash, presence of a query, each observed redirect and the final response's public headers. The original public source URL remains in original-source-capture.json and archive-inventory.json. Renew the private URL through the same publisher session when it expires; its signed query and method must retain the publisher-issued values.

## Read the actual access result

access-receipts.jsonl is cumulative and flushed after every record. Its existing method, status, headers, interval and identity fields remain available. The GET successor adds event and outcome fields so a receiving worker can distinguish the next source action.

| Recorded event and outcome | Meaning and continuation |
|---|---|
| archive_range_bootstrap / accepted | One exact byte has established the published total and strong ETag; the receiver proceeds directly to the real ZIP directory. |
| archive_redirect / followed | The original GET was redirected to another HTTPS endpoint. Source and target URL hashes and public response headers identify that step. |
| archive_range_bootstrap or archive_member_range / range_unsupported | The actual status was 200. Continue the existing full capture and reopen the same original ZIP with --archive. No complete archive is recorded by the probe. |
| archive_http_error / http_error | The issued GET returned its recorded error status, including 403 for a refused or expired request and 412 for a failed entity precondition. Resume through the existing publisher session or original complete file. |
| archive_range_bootstrap or archive_member_range / rejected | The status, total, entity tag, encoding, final location or response length did not match the required archive interval. The received headers and byte count identify the failed condition. |
| archive_transport_error | The issued request failed before an accepted HTTP response. Completed original members and the cumulative contract remain available for the same operation's continuation. |

Redirects preserve GET and are checked for HTTPS before being followed. Range failures record their actual response before the ordinary interrupted-operation record is appended. The receiver performs no automatic retries or alternate download acquisition.

## Inspect the real archive and select its files

archive-inventory.json contains every actual ZIP entry with its native path, compression, expanded/compressed sizes, CRC32, flags and header offset. archive-directory.bin retains the exact original directory and ending records. Unsafe, encrypted or duplicate member names remain visible in the inventory and cannot enter a selected receiving set.

Select actual members from that inventory. The existing USGS metadata identifies these useful groups:

| Source group | Purpose |
|---|---|
| dataDictionary.csv | Original filename/field definitions, units and code meanings |
| master_site_list | Actual water-quality station, flow-gauge, COMID and geographic catalog |
| fluxmaster/net_conus | Released seasonal nitrogen/phosphorus estimates and their estimator/source tables |
| wrtds/net_conus | Released seasonal fluxes, model-review results and original processing code |
| Original readmes and method/code companions | Seasonal calendar, load basis, fit/review interpretation and uncertainty |

These are groups to inspect in the actual directory. The original metadata has inconsistent Fluxmaster output-name spellings, so it cannot substitute for the observed member names. Preserve the real release paths and dictionary rows. The complete original numerical series and model-review tables should be selected together.

First save the actual dictionary, station-list and method companion paths as a JSON array in /owned/usgs-dictionary-members.json. The receive command reads every selected member in full:

~~~sh
python3 -B -m source_tools.usgs_archive receive \
  --capture source/usgs-seasonal-loads-20261012/capture.json \
  --download-url-file /owned/private/usgs-download-url.txt \
  --members /owned/usgs-dictionary-members.json \
  --maximum-expanded-bytes 536870912 \
  --output /owned/upstate-usgs-members
~~~

Use --archive instead when receiving an existing whole ZIP. Set --maximum-expanded-bytes from the actual selected inventory and available storage; exceeding it is an error, never a partial success or a row limit.

Once those original definitions identify the relevant numeric tables, place their exact native paths in a second JSON array, /owned/usgs-load-members.json, and run the same command with that --members path and the same --output. Include the full selected load series and its model-review companions. The new selection may include earlier members; retained files are verified and reused.

Each reviewed member set has its own immutable selections/<selection-id>.json and selection-results/<selection-id>.json. The directory retains one archive-inventory.json, one received-members.json journal and one original/ tree. Complete members are stored once even when selected by multiple batches. result.json and contract-source-files.json are cumulative views of completed selections; earlier immutable receiving-results/ and contract-manifests/ editions remain available. A partly received selection leaves the last complete contract usable while its recorded members await completion.

The original files appear below original/ with their complete release-relative paths. The receiver streams each file, verifies its native length and CRC, and records its SHA256. Every CSV receives an actual header/count/row-width survey. An undecodable original remains retained with an explicit unresolved survey so an analyst can select its documented encoding.

## Continue the maintained scientific workflow

contract-source-files.json contains ready file definitions—exact path, bytes, SHA256 and original-source URI—for the existing upstate.usgs-seasonal-loads-contract/v1 files mapping. Incorporate those definitions into the analyst's retained original contract; retain the reporting polygon and its companions there as well.

Use the actual dictionary and original processing code to complete the existing contract's station columns, coordinates, quarter calendar, load basis, estimators, quality selections and catchment identities. The received filenames do not choose scientific definitions. The maintained [USGS contract compiler](USGS_CONTRACT.md) consumes these exact received files and the retained metadata2.xml, creates the actual field/review bindings, and writes the same upstate.usgs-seasonal-loads-contract/v1 input used below. Its companion source/usgs-seasonal-loads-20261012/contract-recipe.json identifies the original member roles; bind the observed directory paths and source dictionary fields before compiling the numerical tables.

Then run the original importer:

~~~sh
python3 -B -m source_tools.usgs_loads inventory \
  --contract /owned/upstate-usgs-contract.json \
  --original-root /owned/upstate-usgs-members/original \
  --output /owned/usgs-table-inventory.json

python3 -B -m source_tools.usgs_loads qualify \
  --contract /owned/upstate-usgs-contract.json \
  --original-root /owned/upstate-usgs-members/original \
  --output /owned/usgs-station-qualification.json

python3 -B -m source_tools.usgs_loads prepare \
  --contract /owned/upstate-usgs-contract.json \
  --original-root /owned/upstate-usgs-members/original \
  --output /owned/upstate-observed-loads
~~~

The original preparer retains complete selected quarterly records, forms admitted annual N/P records using their source-defined calendar and units, retrieves each selected original upstream basin, and produces annual-loads.csv, observation-metadata.json, catchments.geojson and source-manifest.json. Those existing files enter the same Workspace source and observation comparison. Original station/flow-gauge identities, periods, model-review context and quarter uncertainties travel through that workflow.

## Resume and deliver

Repeat the same command in the same output directory to finish an interrupted selection. The original archive directory and each recorded selection remain immutable; a new reviewed JSON member set adds a selection under that same archive identity. Completed files are verified and reused, and a file whose publication stopped after its last byte is recovered from its retained receipt. An unfinished member restarts its own extraction from the original ZIP; earlier complete members stay in place. The receiver retains one process lock and performs no automatic provider retry loop.

A renewed temporary URL may be supplied through the same private URL file if it selects the same original entity and directory. A changed ETag requires a fresh receiving directory. The source URL file is not copied into the portable source output.

Deliver the entire receiving directory, including result.json, contract-source-files.json, their immutable editions, selections and completed selection results, the original capture, exact directory, member records and complete original/ subtree. The contract manifest names the exact immutable receiving result, so it remains internally consistent if a process stops between publishing the two latest-view filenames. Keep the ongoing selection with the original UPSTATE-ORIGINAL-SOURCES-DBC61 operation and return the station catalog to scf_engineering early. The existing application's portable export already includes source_tools, so the receiver and this guide ship with the maintained operator.

Publisher references:
- Original release: https://doi.org/10.5066/P13YSTHM
- Actual item: https://www.sciencebase.gov/catalog/item/6675b4dbd34e6f159fd10baf
- Source meaning: https://water.usgs.gov/catalog/datasets/8a7d3140-2272-433c-9359-30840125cd7c/
- Official downloading and large-file workflow: https://www.usgs.gov/sciencebase-instructions-and-documentation/file-management

Protocol references:
- AWS presigned URL method and lifetime: https://docs.aws.amazon.com/AmazonS3/latest/userguide/using-presigned-url.html
- AWS Signature Version 4 canonical GET example and signed headers: https://docs.aws.amazon.com/AmazonS3/latest/developerguide/sigv4-query-string-auth.html
- HTTP Range and Content-Range semantics: https://www.rfc-editor.org/rfc/rfc9110.html#section-14
- HTTP entity tags and strong comparison: https://www.rfc-editor.org/rfc/rfc9110.html#section-8.8.3

This successor changes the receiving method and its response reporting. The original P13YSTHM capture, local-file checksum verification, ZIP directory and CRC checks, cumulative member editions, source contract, station qualification and annual observation importer keep their existing interfaces. Existing HTTP inventories remain reusable when their original entity and directory match. The source files can replace source_tools/usgs_archive.py and source_tools/USGS_ARCHIVE.md in the current cumulative application; retain its maintained model.common implementation and the current source owners' other files.
