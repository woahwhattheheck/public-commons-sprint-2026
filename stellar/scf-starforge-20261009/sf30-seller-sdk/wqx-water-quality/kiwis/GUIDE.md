# KiWIS monitoring and laboratory commissioning

This application adds complete monitoring-source commissioning to the original Water Quality workspace. It receives a selected KiWIS QueryServices programme, opens a complete WQX review, WQX scientific edition, Laboratory EDD result or original KiWIS WQM sample export, and lets an operator choose exact station, parameter and time correspondences. A saved review contains all original source records, every candidate, explicit time interpretations, quality dispositions and the reasons for the selected links.

The complete project bundle transfers both source families and the saved decisions. A receiving project uses the existing WQX and Laboratory readers, reproduces the review, and can export the same deliverables. Source providers and laboratory result archives remain the authority for their original values.

## Open the operator workspace

Use the installed Water Quality command:

~~~bash
water-quality serve --project /private/commissioning-project --port 0
~~~

The source equivalent is:

~~~bash
node stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/cli.mjs \
  serve --project /private/commissioning-project --port 0
~~~

Open the printed local address and select **KiWIS commissioning**. The original workspace retains its loopback address, request token and same-origin controls. KiWIS work is stored alongside the other original Water Quality operations in that project.

The managed Water Quality application includes the new source, model, workflow, export and browser modules in its source binding. The contribution installs the KiWIS command, browser asset, SDK exports and complete receiving programme.

## Acquire the complete monitoring programme

Select the actual QueryServices endpoint and datasource. Use the provider's original numeric time-series identifiers and either its complete history or explicit date windows with UTC offsets. A null datasource explicitly selects the provider default; a supplied datasource retains that exact service identifier. The programme stores the selected response timezone. It requests complete series metadata, original quality codes and release-state classes, then every selected time-series value response.

A selection file has this shape:

~~~json
{
  "endpoint": "https://your-provider.example/KiWIS/KiWIS",
  "datasource": "0",
  "timezone": "UTC",
  "series": [
    {
      "tsId": "123456",
      "from": "2026-01-01T00:00:00Z",
      "to": "2026-02-01T00:00:00Z",
      "chunkSeconds": 86400
    }
  ]
}
~~~

Replace the example endpoint, identifier and dates with the actual agreed programme. Optional **chunkSeconds** divides the entire selected window into consecutive requests. Choose it using the provider's documented point, credit and request limits. Adjacent requests retain their shared inclusive boundary, including both physical copies of a boundary row. The source model exposes duplicate timestamps so the operator can inspect them. It does not discard one copy or interpolate a replacement value.

Capture a selected programme from the command line:

~~~bash
water-quality-kiwis acquire --project /private/commissioning-project \
  --capture monitoring-edition-01 --selection selected-programme.json \
  --out monitoring-edition-01-kiwis.json
~~~

The alternative command prefix is **water-quality kiwis**. The KiWIS commands operate on the same original project.

Each completed request is saved before the next request begins. A provider error retains its status and retry information, and the completed responses remain available. Resume the same capture name with the same selection to continue its unfinished requests. A different selection receives a new capture name. **Stop capture**, SIGINT, SIGTERM and workspace shutdown cancel an active request without discarding its completed source responses.

The capture retains the complete response bytes, original request URL, query method, HTTP status, content type, retrieval time, byte count and content digest. Reading it verifies those bytes and binds each response to the selected programme. Numeric JSON tokens become their exact original strings, including long identifiers, exponent notation and trailing decimal digits. Values are requested without display precision rounding. Original scalar type sidecars distinguish a JSON number from a JSON string even when their displayed text is equal. Raw timestamps, null values, quality codes and all returned metadata remain available. A service can return numbers even when values-as-string is requested; its exact number tokens and original types are retained together.

## Import original provider responses

An existing source programme can be opened from its original responses without downloading it again. Supply a packet with **selection** and **responses**. The selection uses the same endpoint, datasource and timezone fields as acquisition. A complete-history series is represented by **{"tsId":"3112010","period":"complete"}**.

Each response retains its original **bytes**, **sha256** and **base64**. A successful HTTP acquisition also retains its actual **url**, **status**, request/retrieval details and content type. For a ZIP response, **archiveMember** selects the exact original JSON member. The importer validates the actual query against the selected endpoint, datasource, time series and period.

An older metadata file may have no HTTP receipt. Such a supplied file uses **origin.kind: "provided-original-file"**, its original filename, its actual request and retained query-plan/source provenance. Its URL and HTTP status remain absent. Original station and time-series catalogues can use a header-row array, including metadata for additional unselected series; the whole returned catalogue is preserved.

~~~bash
water-quality-kiwis import --project /private/commissioning-project \
  --capture monitoring-original-01 --packet complete-original-responses.json \
  --out monitoring-original-01-kiwis.json
~~~

The source intake also accepts that complete packet as **--capture-file** or in the operator's capture-file input. Imported and acquired sources use the same original capture directory and immutable operation names.

## Receive the source counterpart

Use **Receive original source pair** to select a complete KiWIS capture file or an already saved capture name. Choose one native counterpart:

| Counterpart | Required complete input | Receiving behavior |
| --- | --- | --- |
| WQX review | Original WQX review bundle | Reopens the original capture and review through the existing WQX project. |
| WQX scientific edition | Complete standardized/scientific bundle | Reopens its current and prior native source editions and saved scientific review. |
| Laboratory EDD result | Complete original result ZIP | Uses the existing Laboratory result reader and preserves its full original documents, tables and staff decisions. |
| KiWIS WQM samples | Original getWqmSampleValues response packet, retaining its full JSON or ZIP bytes | Keeps every physical sample row, every original column, replicate and censor fields, and original scalar types. |

The new correspondence view exposes original WQX result fields, every associated station and activity record, and every embedded or separately returned detection limit. It retains each physical result row even when the native identity and values repeat. Laboratory records keep the original table, row, cells, changes and receiving decisions.

A scientific counterpart's full bundle retains its reporting-unit analysis. Correspondence uses the original native result fields; its counterpart export labels and retains those original fields explicitly. The source scientific review remains independently reopenable from the complete bundle.

For a command-line intake:

~~~bash
water-quality-kiwis source --project /private/commissioning-project \
  --source paired-edition-01 --capture monitoring-edition-01 \
  --kind wqx-review --counterpart complete-wqx-review.json
~~~

Use **--capture-file** in place of **--capture** to receive a retained file. The Laboratory kind is **lab-edd-result**; provide its complete ZIP. For **kiwis-wqm**, provide the original response packet as JSON, including **archiveMember** for a ZIP. The original sample table remains complete, including parameters outside the selected correspondence. All source names and saved review names are immutable. A changed original receives a new edition name.

## Choose station, parameter and time correspondence

Open the source edition. The page shows its full series metadata, source catalogue and every original counterpart record. Select a monitoring series and then choose the counterpart's exact station and parameter field paths and their original values. The value inputs offer choices taken from the complete original record set.

A mapping states the relationship being commissioned. It may connect like parameters or intentionally associate a laboratory analyte with a monitoring covariate such as flow. Record that relationship in the mapping reason. A correspondence preserves both original values and units; it does not perform a scientific conversion or declare that different parameters are equivalent.

Select the complete native identity fields used to compare later counterpart editions. Use the provider's actual stable identity, including its organization or source identifiers where needed. Blank or repeated native keys remain unresolved or ambiguous in an edition comparison.

A WQM source may contain both **timestamp** and **sample_timestamp** with different offsets or instants. Both fields remain visible. Select the precise field that governs the agreed correspondence and explain that choice; a display label or station-wide offset does not replace the original value. WQM **value_sign**, detection/quantification limits, dilution, replicate markers, method, sample and laboratory identifiers remain in every original record.

There are two time representations:

- **One timestamp with UTC offset** selects an original timestamp field.
- **Separate date and time fields** selects both original fields and either one explicit programme offset or an original per-record offset field.

Dates use YYYY-MM-DD. Times use HH:MM or HH:MM:SS, with exact millisecond precision where present. An offset is Z or a signed HH:MM value. Local abbreviations and daylight-saving changes require the actual per-record offset or an individual staff time interpretation. The operator can open any original record and bind such an interpretation to the exact original field and row. The original field is retained.

Timestamps that cannot be represented exactly by the supported millisecond comparison remain visible without candidate matches. The reader does not round submillisecond instants into a false equality or normalize an invalid calendar date.

Select an explicit nonnegative correspondence window in seconds. Candidate selection uses only the configured station, parameter, interpreted time and original quality disposition. Every observation within that window remains visible. Duplicate source timestamps can therefore create several candidates.

## Review original quality and choose links

The quality catalogue belongs to its original service and datasource. A provider code, a series name containing “edited,” and scientific approval have different meanings. The interface shows the original definitions alongside the selected series.

An operator can retain a code in candidates or exclude it from correspondence with a reason. Both choices retain the underlying observations in the complete source and observation export. An unrecognized or uncertain code does not become an approval.

Each counterpart record has one of these states:

| State | Meaning |
| --- | --- |
| UNRESOLVED | No explicit link or separation choice has been saved. |
| LINKED | The selected exact observation is a current candidate. |
| SEPARATE | The operator explicitly keeps the record separate and records why. |
| REVIEW_REQUIRED | An earlier selected link falls outside a changed mapping, time interpretation or quality disposition. Its original selection and reason remain visible. |

Search examines the full original counterpart fields. The table displays 40 records per page. Its status filter can show unresolved, linked, separate, changed selections or records with multiple candidates.

Use the per-record control to choose an observation, keep a record separate, or return it to unresolved. A reason accompanies every explicit choice. The batch **Select unique candidates in filtered records** affects only records with exactly one candidate and uses the entered batch reason. The separate batch control applies the explicitly selected separation to the entire filtered set. Multiple candidates remain an operator decision.

Changing a mapping or quality choice never silently replaces an earlier observation. The affected record enters REVIEW_REQUIRED. Its prior choice remains in the saved decision document until the operator changes it.

## Save, compare and transfer editions

Save a review with a new name and title. Saving binds the complete source pair, normalized decision document, candidate set and counts. Download the editable decision JSON to retain or revise the whole choice set. Reopening those decisions verifies the original source binding.

To preview and save from the command line:

~~~bash
water-quality-kiwis preview --project /private/commissioning-project \
  --source paired-edition-01 --decisions decisions.json --out preview.json

water-quality-kiwis save --project /private/commissioning-project \
  --source paired-edition-01 --review commissioning-review-01 \
  --title "Monitoring and laboratory commissioning" \
  --decisions decisions.json --preview preview.json --out saved-review.json
~~~

The save command requires the complete unchanged preview and its decision document.

Open the current saved review, select the earlier saved review and choose **Compare editions** to compare their actual decisions. The workspace shows both complete count sets, the count changes, status transitions, and added, removed or changed mappings, time choices, quality decisions and correspondences. Search and filter the complete record comparison; every row opens its earlier and current candidates, original time selections and explicit decision. The downloaded comparison retains both whole decision documents, every physical review record and the saved-review/source identities.

When both reviews use the identical source edition, their original physical row identifiers pair exactly, including separate replicates. Across different source editions, the original source matcher supplies only its unique physical matches; ambiguous or unpaired rows remain individually available. The complete before/after coverage is reported. A source-carry proposal is separate from the actual saved decision difference.

For a new source edition or an unsaved draft, select the earlier saved review and choose **Compare editions**. The comparison includes every original observation, every physical counterpart row, every mapped native identity, and a disposition for each earlier profile, time interpretation, quality decision and correspondence choice. It reports added, removed, changed, unchanged and ambiguous groups. Duplicate native keys and duplicate source timestamps remain explicit.

The comparison preserves the whole earlier decision document. It proposes reuse only for unambiguous, unchanged source rows and provider metadata. Extending a requested date window is recorded separately from changes to the provider's actual series metadata. Changed original scalar types or Laboratory cell/date interpretations remain part of the comparison. Changed quality or release catalogues require renewed quality-dependent correspondence decisions. Proposed choices are applied by the operator and saved as a new review. A comparison is downloaded in full, including the original and proposed decisions.

~~~bash
water-quality-kiwis compare --project /private/commissioning-project \
  --source paired-edition-02 --previous-review commissioning-review-01 \
  --out complete-edition-comparison.json
~~~

Compare the decisions of two saved reviews directly:

~~~bash
water-quality-kiwis compare --project /private/commissioning-project \
  --review commissioning-review-02 --previous-review commissioning-review-01 \
  --out complete-saved-review-comparison.json
~~~

An optional **--source** with **--review** must name that review's exact original source. Opening or editing a different source or draft clears a displayed comparison. Save the edited draft under its own review name to compare its completed decisions.

## Complete deliverables

Each saved review has eight exports:

| Export | Complete contents |
| --- | --- |
| bundle | Both complete original source families, the saved review and its decisions. |
| review | Complete saved review, candidates, source bindings and counts. |
| decisions | Editable field mappings, time interpretations, quality choices and correspondence reasons. |
| observations | Every original KiWIS observation, including duplicates, nulls, quality codes and request pointers. |
| counterparts | Every native result record with all original fields and its original source/review details. |
| correspondences | Every counterpart, its state, all candidates, source-time choices and selected decision. |
| series | Selected programme windows, complete metadata and quality/coverage counts. |
| report | Standalone neutral HTML report containing the complete correspondence and decision record. |

CSV cells carry complete JSON where a native record contains nested fields. The report escapes original field content. All exports are derived from the same reproduced saved review.

~~~bash
water-quality-kiwis export --project /private/commissioning-project \
  --review commissioning-review-01 --format bundle \
  --out complete-commissioning.json

water-quality-kiwis receive --project /private/independent-receiving \
  --bundle complete-commissioning.json --out received-review.json
~~~

The receiver uses the original native readers and recomputes the complete review. All eight exports remain identical after independent receiving and a cold reopen.

## Run the complete configured receiving programme

The included **receiving.mjs** executes a selected source programme, saves each configured review, produces every export, compares chosen editions, opens the actual operator interface, transfers the complete bundles to an independent project and reopens that project after shutdown.

Its example configuration is **receiving.example.json**. Replace its file paths, actual source selections, counterpart, native mapping and explicit reasons. It can use an already retained original KiWIS capture or perform the full selected acquisition. It can also import a complete retained response packet and the original WQM sample export.

The browser configuration requires the actual installed Playwright module and Chromium executable. For a review with **previousReviewId**, the programme compares both saved reviews after saving all selected editions, then opens that same decision comparison in the author and independent receiving workspaces. Both review names therefore remain available even if the current edition appears first in the configuration. A review marked **browser: true** opens on desktop and mobile, exposes the full original record, optionally saves a new operator edition, and downloads all eight outputs through the original local workspace. The independent receiving project is then opened in the same interface.

~~~bash
node stellar/scf-starforge-20261009/sf30-seller-sdk/wqx-water-quality/kiwis/receiving.mjs \
  --programme complete-receiving-programme.json
~~~

The resulting directory contains the exact programme, complete retained monitoring source, complete source projection, all review exports, any complete edition comparisons, operator screenshots, full receiving details and COMPLETE.json. Reopening an already completed programme validates its selected input and saved output identities. Completed operator phases retain their exact saved-review bindings, downloads and screenshots. Resuming the original programme reuses those completed phases. Atomic publication protects an output filename from a partial write. Each source capture and saved review retains its original operation name.

The result identifies the complete source programme, saved reviews, browser downloads and independently received editions, so a second operator can reopen the precise work delivered.

## Source contracts

This implementation uses the documented KISTERS QueryServices methods, original WQX and Laboratory readers, and the existing private project/filesystem primitives.

Primary protocol references:

- [KISTERS KiWQM product](https://www.kisters.net/kiwqm/)
- [KISTERS environmental data management](https://www.kisters.net/product/environmental-data-management/)
- [KISTERS water time-series KiWIS store documentation](https://kisterswatertime-series.readthedocs.io/en/latest/stores/kiwis_store.html)
- [SEPA time-series API documentation](https://timeseriesdoc.sepa.org.uk/api-documentation/)
- [SEPA actual QueryServices request information](https://timeseries.sepa.org.uk/KiWIS/KiWIS?datasource=0&request=getrequestinfo&service=kisters&type=queryServices)

SEPA's documented point and anonymous-credit limits belong to that service. Inspect the selected provider's actual limits before setting the programme partitions. Completed source requests remain reusable after an interruption.
