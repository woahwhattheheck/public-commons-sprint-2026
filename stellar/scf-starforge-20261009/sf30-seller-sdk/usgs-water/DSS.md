# USGS water editions: native HEC-DSS7 handover

This guide takes a retained USGS water edition through an explicit receiving mapping, a native HEC-DSS7 export, a full native readback, and receipt into another instance of the original Water project. It also covers a later corrected edition, so an analyst can compare the two deliveries without replacing the earlier source or file.

The starting point is an immutable edition already prepared by the USGS Water workbench. Its saved review, original capture, original value strings, quality fields and source pages remain the source of the delivery. The DSS file is a receiving representation produced from that edition. The mapping and the native readback travel with it.

## 1. What the operator receives

A complete handover includes the generated DSS7 file, its explicit mapping and preview, the native writer/readback result, and the original portable edition. The receiver uses the original Water project to reopen the edition and inspect the received export. They can then run native verification in their own selected runtime and open the same DSS file in their receiving application.

The workbench separates these decisions:

| Decision | Where it is recorded |
| --- | --- |
| Which original source and review are being delivered | Immutable edition and capture identity |
| Which series, observation window and quality class are selected | DSS mapping and preview |
| What a value, unit and timestamp mean in the receiving application | Mapping fields for units, measurement and time |
| Which explicit handling choices resolve source exceptions | Mapping choices and preview |
| Which native file was written and what was read back | Retained export and native result |
| Whether the receiving analyst accepts it for their intended use | The receiving team's own acceptance record |

A successful native readback establishes the file's representation against the selected plan. Scientific interpretation, modelling assumptions and any client approval remain decisions for the receiving analyst.

## 2. Runtime and starting project

Run the commands from the seller SDK directory containing the original usgs-water folder. Keep using the project's maintained Node runtime and dependencies. The DSS bridge additionally requires a selected Python environment with the official hecdss package at exactly version 0.1.33 and its installed dependencies. The bridge loads that package's native library; it does not download a library, change an environment or install another runtime during an export.

The supported packaged Linux x86_64 native library reports HEC-DSS core 7-JA-8. The runtime result records the actual Python, package, bridge and native library identities. Check those returned identities instead of inferring the running engine from a filename.

Set the project path to your existing private Water project:

~~~sh
cd stellar/scf-starforge-20261009/sf30-seller-sdk
WATER_PROJECT=/private/water-project
node usgs-water/cli.mjs editions --project "$WATER_PROJECT"
node usgs-water/cli.mjs editions --project "$WATER_PROJECT" --id october-water
~~~

The original source edition used by the supplied example is october-water. Use the edition ID returned by your own retained project when working with another dataset. An edition ID identifies the saved source; changing the mapping does not turn it into a new source edition.

Select the Python interpreter with USGS_HECDSS_PYTHON. If it is unset, the workbench uses python3 from the process environment. For a separately installed receiving environment, a conventional setup is:

~~~sh
python3 -m venv /private/hecdss-runtime
/private/hecdss-runtime/bin/python -m pip install 'hecdss==0.1.33'
export USGS_HECDSS_PYTHON=/private/hecdss-runtime/bin/python
node usgs-water/cli.mjs dss-runtime \
  --project "$WATER_PROJECT" \
  --out dss-runtime.json
~~~

If the selected environment already contains the required package and dependencies, set USGS_HECDSS_PYTHON to that existing interpreter and run the probe. The official 0.1.33 wheel SHA-256 is acbf8b5c94e84db6db57a29bf0a4dee449a5819a03ad4b801bee6534b2ae86b5. Retain the actual probe with the handover; the installation command by itself does not establish native-library compatibility.

Do not continue a write when the runtime report is not ready. Preserve the returned error and correct the selected environment. A missing library or wrong package version is resolved at the runtime boundary; it does not justify substituting another file format for DSS.

## 3. Inspect the original source before mapping

Read the source description from the immutable edition:

~~~sh
node usgs-water/cli.mjs dss-source \
  --project "$WATER_PROJECT" \
  --edition october-water \
  --out potomac-dss-source.json
~~~

The response includes the edition source identity, the original analysis series keys, each provider time-series ID, station, parameter, statistic, unit, collection and method, observation counts, date range, approvals and value states. It also returns the supported intervals, irregular block choices and native runtime information.

Use the complete original analysis key for mapping. A station or parameter alone is not enough to distinguish every source series. The original key includes the provider time-series ID, location, parameter, statistic, unit, collection and method category.

For the retained Potomac example:

| Source field | Retained value |
| --- | --- |
| Location | USGS-01646500, Potomac River near Washington, DC, Little Falls Pump Station |
| Provider time-series ID | 2cf409b0d9694c01828f5d4ff14586a5 |
| Analysis series key | b7a377716469a26c1feda5df272733e9be92e336c9bd7f41b26f688befe9e0e7 |
| Collection / parameter / statistic | daily / 00060 / 00003 |
| Original unit | ft^3/s |
| Source dates | 2026-10-01 through 2026-10-07 |
| Returned observations | Seven, from the original four-page capture |
| Approval / qualifier | All Provisional; qualifier is null |

Those are properties of the retained example, not a statement that the currently published USGS values are unchanged. A subsequent acquisition belongs to a later capture and edition.

## 4. Map the Potomac daily series

Use examples/potomac-daily.dss-mapping.json as the complete usable mapping for this exact source. It uses schema starforge.usgs-dss-mapping.v1 and the original analysis series key above.

| Mapping choice | Example | Meaning |
| --- | --- | --- |
| kind | regular | One value for each selected calendar day |
| interval | 1Day | Preserve the daily source grid |
| path.a / path.b / path.c / path.f | POTOMAC / USGS-01646500 / FLOW / USGS-OCT2026 | Explicit receiving names; the native catalogue reports complete DSS paths |
| units | CFS | Receiving spelling of ft^3/s; the numbers are unchanged |
| dataType | PER-AVER | The original daily mean represents a period average |
| time.mode | calendar-day | Treat the source date as a calendar date |
| time.zone | America/New_York | Retain the selected site-local calendar convention |
| time.label | end-of-day | Label date D at the following local midnight |
| selection.quality / window | all / null | Include the complete selected source series, including its Provisional status |
| nativeNotes | approval | Carry the original approval status as a native note |
| acceptBinary64 | true | Explicitly accept the native numeric representation; retain original decimal strings in the source |

The empty choices object means that this example supplies no additional exception-resolution choices. The empty excludedSeries list means that no returned series has been silently omitted.

### Daily time is not a UTC observation instant

The current USGS daily schema defines time as the date represented by an observation. The daily-service documentation says date requests use the time zone in effect at the site. Current metadata for station 01646500 reports EST and daylight-saving observance. These sources support the example's America/New_York local calendar convention. The additional choice to label the daily period at its end is an explicit receiving choice recorded in the mapping's basis.

The bridge receives a naive local clock together with the retained time-zone label. It does not convert this date-only series to a UTC daily grid. The example therefore maps:

| Original represented date | Original value, ft^3/s | Native clock label | Native time-zone label |
| --- | ---: | --- | --- |
| 2026-10-01 | 2650 | 2026-10-02T00:00:00 | America/New_York |
| 2026-10-02 | 2230 | 2026-10-03T00:00:00 | America/New_York |
| 2026-10-03 | 2230 | 2026-10-04T00:00:00 | America/New_York |
| 2026-10-04 | 2100 | 2026-10-05T00:00:00 | America/New_York |
| 2026-10-05 | 1810 | 2026-10-06T00:00:00 | America/New_York |
| 2026-10-06 | 1700 | 2026-10-07T00:00:00 | America/New_York |
| 2026-10-07 | 1610 | 2026-10-08T00:00:00 | America/New_York |

The absence of a Z suffix is deliberate. These are local period labels. Appending Z would change their meaning.

### Units, quality and numeric precision

The mapping names CFS as the receiving spelling of the original ft^3/s. The exporter does not multiply values or convert this series to metric units. A receiving workflow that needs a different physical unit needs its own explicit, supported conversion before it can be described as such.

The original approval status remains attached to the retained observations. Selecting all includes Provisional data; it does not promote those records to Approved. A null qualifier remains null. The supplied example writes the approval text into native notes but does not assign an invented numerical quality category.

DSS native values use binary64. Original source strings remain in the portable edition, and the mapping requires the operator to acknowledge the receiving representation. The native bridge checks the actual values, missing mask and returned data. A successful numerical write is not a reason to discard the original strings, approvals or qualifiers.

## 5. Preview and commit one exact plan

Create a preview before writing:

~~~sh
node usgs-water/cli.mjs dss-preview \
  --project "$WATER_PROJECT" \
  --edition october-water \
  --mapping usgs-water/examples/potomac-daily.dss-mapping.json \
  --out potomac-dss-preview.json
~~~

Read the returned planSha256, mapping, source identity, series previews, totals and comparison information. Check the complete returned series set, selected row count, first and last native labels, units, data type, quality choice and all exceptions. An operator should be able to explain each selected or excluded series and every transformation represented by the plan.

The preview is also where the operator resolves source conditions such as conflicting versions, unsupported values or an invalid regular grid. Use the actual returned issue and the supported mapping fields. Preserve an unresolved source row or choose a different supported receiving plan rather than silently filling a gap, resampling an irregular record or choosing a conflicting version by array order.

Set the exact hash that was reviewed, then write under a stable export ID:

~~~sh
PLAN_SHA=PASTE_EXACT_planSha256_FROM_THE_PREVIEW
node usgs-water/cli.mjs dss-export \
  --project "$WATER_PROJECT" \
  --edition october-water \
  --mapping usgs-water/examples/potomac-daily.dss-mapping.json \
  --id potomac-daily-20261001-07 \
  --plan-sha "$PLAN_SHA" \
  --out potomac-dss-export.json
~~~

Use a stable ID for this one export. Reopening that ID with the same exact plan returns the retained export. An ID collision with different data is refused. If you change a mapping, source edition or previous-export comparison, obtain and review a new preview hash.

Original CLI output paths are exclusive: an existing --out file is preserved. Choose a new output filename when saving another response. Do not interpret a refusal to replace an output JSON file as a reason to run another native write under a new export ID.

A READY export response includes the export ID, export hash, retained files and native result. Its files are stored under project/dss-exports/EXPORT; --out saves the response JSON, not the DSS file itself. The native bridge's successful write result is VERIFIED. These are two levels of the same operation: the workbench retained the accepted export, and the native writer/readback matched its requested representation.

## 6. What native verification checks

The bridge calls the official HecDss, RegularTimeSeries and IrregularTimeSeries APIs. After writing it closes the writer, reopens the DSS file and compares the requested and returned records. The comparison covers every supplied clock, value, missing position, time-zone label, unit, data type, optional quality word, optional note and catalogue entry. It then hashes the closed file.

The native result retains the request path, length and SHA-256; the DSS path, length, SHA-256 and file version; actual package and library identities; and the series-level readback. These are useful receiving information because they connect the selected plan to a specific native file.

Recheck a retained export with:

~~~sh
node usgs-water/cli.mjs dss-verify \
  --project "$WATER_PROJECT" \
  --id potomac-daily-20261001-07 \
  --out potomac-dss-reverify.json
~~~

The official binding opens a DSS file through a read/write interface. Verification therefore uses an exact-byte private temporary copy and checks that the original retained DSS is unchanged. A receiving verification does not rewrite the accepted original.

The bridge returns READY for a successful runtime probe, VERIFIED for a successful write or verification, MISMATCH for a completed comparison that differs, and ERROR for an operation failure. Their process exits are 0, 0, 3 and 2 respectively. Keep a failed attempt's returned information; correct its cause and use the workbench's supported continuation. A partially produced file is not a READY export.

## 7. Continuous observations

Continuous source timestamps already identify instants through their explicit offsets. The mapping uses time.mode utc-instant, zone UTC and a basis stating that the original offsets are normalized to UTC. The native bridge receives naive whole-second UTC clocks with the UTC label. The original offset strings remain in the source edition.

Choose the receiving form from the actual source spacing:

| Source and receiving need | Mapping |
| --- | --- |
| Preserve unevenly spaced continuous observations | kind irregular, a returned supported block such as Ir-Month |
| Use a genuinely uniform continuous interval | kind regular, a returned supported minute-or-longer interval |
| Preserve daily statistical dates | calendar-day mapping described above |

For instantaneous observations the measurement meaning and data type must state that interpretation, commonly INST-VAL where supported. Do not reuse PER-AVER just because the series represents flow. The statistic and source meaning determine the receiving interpretation.

A regular mapping must have a complete supported grid. The bridge refuses nonuniform grids and invalid local clocks. An irregular mapping retains actual samples; it does not average them into intervals or make them time-weighted. The preview must show the chosen series, selected timestamps and any source exceptions before export.

Optional native quality is one signed 32-bit word per value. Optional native notes are limited to 39 UTF-8 bytes per value. Leave quality words absent unless the receiving team has an explicit mapping. Long source descriptions and full provenance belong in the retained source and handover even when a compact native note is used.

## 8. A corrected or later edition

Acquire later USGS data through the original workbench owner and create its own capture, saved review and immutable edition. Keep the earlier edition and DSS export. USGS Provisional values may be revised; a last_modified change alone does not establish that the measured value changed.

Use the earlier export as the comparison input:

~~~sh
node usgs-water/cli.mjs dss-preview \
  --project "$WATER_PROJECT" \
  --edition october-water-corrected \
  --mapping corrected-dss-mapping.json \
  --previous potomac-daily-20261001-07 \
  --out corrected-dss-preview.json
~~~

The preview returns previous-export information and comparison alongside the new source and mapping. Review changes in observations, quality, selected windows, series membership and receiving semantics. A change in mapping is a change in receiving meaning even if the underlying numeric values happen to be equal.

After review, export with a new ID, the new exact plan hash and the same previous-export selection used by the preview. The new export writes a fresh DSS file. It does not patch the earlier file in place or overwrite its catalogue. Both complete files can be reopened, compared and delivered with their own original editions.

If a receiver has the old edition, send the new complete handover and the explicit comparison. Do not send only changed rows and assume that the receiver can reconstruct every prior source, path and quality decision.

## 9. Package and receive the complete delivery

List the retained DSS exports and package the selected complete export:

~~~sh
node usgs-water/cli.mjs dss-exports --project "$WATER_PROJECT"
node usgs-water/cli.mjs dss-handover \
  --project "$WATER_PROJECT" \
  --id potomac-daily-20261001-07 \
  --out potomac-dss-handover.zip
~~~

The handover output path must be new. Keep the completed archive and the source/export identities returned by the operation. The retained native files are under the original project's dss-exports/EXPORT directory; use the handover command to include the required original edition and metadata together.

On the receiving installation, select its Python runtime and receive the archive into the intended original Water project:

~~~sh
RECEIVING_PROJECT=/private/received-water-project
export USGS_HECDSS_PYTHON=/private/hecdss-runtime/bin/python
node usgs-water/cli.mjs dss-receive \
  --project "$RECEIVING_PROJECT" \
  --file potomac-dss-handover.zip \
  --out received-dss.json
node usgs-water/cli.mjs editions \
  --project "$RECEIVING_PROJECT" \
  --id october-water
node usgs-water/cli.mjs dss-verify \
  --project "$RECEIVING_PROJECT" \
  --id potomac-daily-20261001-07 \
  --out received-dss-verification.json
~~~

Use the original edition and export IDs from the delivered package when receiving a different case.

The portable handover carries the full DSS export together with the original portable edition. It preserves the original edition ID and export ID when received into a Water project. A different payload colliding with an existing ID is refused; an operator should inspect the conflicting retained delivery rather than rename it invisibly.

The receiving operator should:

1. Retain the received archive and its expected hash from the actual delivery.
2. Receive it through the original Water project, preserving its source and export IDs.
3. Open the received edition and DSS source summary.
4. Read the saved mapping, selected-plan identity and native result.
5. Run dss-verify with the receiving runtime.
6. Open the same received DSS file in the intended analyst application.
7. Record the receiving environment, catalogue paths, sample clock/value comparisons and the acceptance decision.

Use the original edition's source viewer for the original value strings, approvals, qualifiers and page provenance. Use the DSS catalogue and native result for the file representation. Together they explain what was received and how it was produced.

### Analyst receiving record

A useful receiving record is specific enough that another analyst can repeat the decision:

| Field | Record |
| --- | --- |
| Source | Original edition ID, capture hash, station/series and source dates |
| Plan | Mapping identity, exact plan hash and previous export where applicable |
| File | Export ID, DSS file SHA-256 and complete native catalogue paths |
| Interpretation | Units, data type, calendar or UTC basis and period labeling |
| Native receiving | Runtime identity and returned verification result |
| Analyst application | Actual application/version and the file that was opened |
| Spot checks | First/last dates and representative values, including missing/quality cases where present |
| Decision | Named analyst, date, accepted purpose and any remaining exceptions |

Do not replace the actual receiving record with the author's earlier development result. The development example is useful for learning the workflow; acceptance belongs to the receiving environment and agreed use.

## 10. Recovery and troubleshooting

| Observation | Continue from |
| --- | --- |
| A CLI --out path already exists | Read that response or select a new response filename; keep the stable native export ID |
| The selected Python runtime is missing or wrong | Correct the selected environment and repeat the runtime probe |
| A plan hash is stale | Read the changed source/mapping, make a new preview and review it |
| An export ID already exists with the same plan | Reopen the retained export |
| An export ID exists with different data | Inspect both identities; preserve the original and select an intentional new export ID |
| A native write failed | Read the retained attempt and fix the stated runtime/data issue before the supported continuation |
| Native readback reports MISMATCH | Keep the original file and detailed comparison; it is not an accepted export |
| A regular grid is invalid | Resolve the actual source/mapping issue or select the supported irregular representation |
| A daily series appears shifted by a day | Inspect original represented dates, end-of-day labels and retained local zone before changing any data |
| The receiving project has an ID collision | Compare the existing and incoming retained identities; do not silently overwrite either |
| A later USGS value or quality state changed | Prepare a later edition and compare/export it under its own identity |

The original portable edition and the retained DSS handover are the recovery boundary for the delivered case. Preserve both. A DSS file alone can contain the numeric receiving representation while omitting the original provider page bodies, exact decimal strings and review context.

## 11. Sources and implementation references

Primary sources were checked on 2026-10-12. The mapping's time basis retains the relevant URLs and exact station-metadata capture identity.

- [USGS current daily collection schema](https://api.waterdata.usgs.gov/ogcapi/v1/collections/daily/schema?f=html): represented dates, original string values, statistics, approval/qualifier fields and last-modified meaning.
- [USGS daily-service details](https://waterservices.usgs.gov/docs/dv-service/daily-values-service-details/): date-only daily requests and the site's applicable time zone. Retained HTML retrieved 2026-10-12T00:16:59Z, 68,422 bytes, SHA-256 71860302664b46d44173832b15484778f9489522995a55c551de0c132273b88a.
- [USGS station 01646500](https://waterdata.usgs.gov/monitoring-location/USGS-01646500/) and [expanded station RDB](https://waterservices.usgs.gov/nwis/site/?format=rdb&sites=01646500&siteOutput=expanded): station identity, EST and daylight-saving observance. Retained RDB retrieved 2026-10-12T00:05:02Z, 3,210 bytes, SHA-256 509453de95bbc75b657a98ed3416b5545b0d2c8a39714a4e834288f51ea64341.
- [Official hecdss Python package, version 0.1.33](https://pypi.org/project/hecdss/0.1.33/): selected native binding package. The delivered bridge and accompanying license files retain the implemented runtime contract.
- Original project source: PROVIDER.md, provider.mjs, analysis.mjs, project.mjs and cli.mjs in this directory.
- DSS implementation: the delivered DSS source, runtime bridge and exact result schemas used by these commands.

The seven-row example uses the original retained four-page USGS capture bundled with this project. Preparing a handover from that capture requires no repeat provider acquisition, wallet operation or paid request.

