# Continue an original Gauge receiving operation

The maintained entrypoint is `python -B -m source_tools.receive_gauge_support`. It imports the retained daily-flow coverage, original NLDI gauge points and whole catchments, and the original regional HUC polygon source; builds the saved gauge-support edition; archives the complete Workspace; and independently reopens that same edition and original regional report.

## Original regional course

Continue the existing `source_tools/receive_watershed_edition.py` operation first, using the original complete-source manifest, Workspace and output directory. That receiver preserves the completed watershed report separately from its current-source analysis. Use its original report ID in the Gauge selection.

From the complete maintained application:

```sh
"$PYTHON" -B -m source_tools.receive_gauge_support \
  --workspace "$WORKSPACE" \
  --output "$OPERATION/gauge-receiving" \
  --report-id "$ORIGINAL_REGIONAL_REPORT_ID" \
  --huc-manifest "$ORIGINAL_HUC_SOURCE_MANIFEST" \
  --huc-source-id upstate-wbd-upstream-domain-20261012 \
  --huc-id-field huc12
```

Preserve any explicit `--reporting-huc12` and `--utility-selection` arguments in the original request. An existing imported HUC collection can instead be selected with `--huc-collection`. The original source manifests and complete source companions are retained through the native Workspace importer. Daily coverage and NLDI paths default to the maintained source family inside this application.

Read the actual edition ID from `receiving-gauge-support.json`, under `phases.support_build.edition_id`. Its current direct scientific report remains the separate maintained continuation:

```sh
"$PYTHON" -B -m model.gauge_report_context \
  --workspace "$WORKSPACE" --edition-id "$GAUGE_EDITION_ID"
"$PYTHON" -B -m model.gauge_report_context \
  --workspace "$WORKSPACE" --edition-id "$GAUGE_EDITION_ID" --inspect
```

The default original catchments are NLDI upstream **whole catchments** with `splitCatchment=false`; their support can extend below the gauge within the gauge's NHDPlusV2 catchment. The report preserves this interpretation, the original station coordinates and full source geometries.

An explicitly captured alternative catchment edition remains available through `--catchment-manifest` or `--catchment-collection`, `--catchment-source-id`, and the maintained `--support-kind` check. Preserve these original choices when continuing such an operation. The current model verifies the declared method against the original features; this recovery change does not reclassify whole and split catchments.

## Interruption and resume

Run the same command with the same Workspace, output directory and original selections. A nonblocking `.receiving.lock` prevents two receivers from mutating that operation concurrently. A different request is rejected before it can replace the retained operation.

A saved completed `support_build` is reopened and verified directly. Its selected source references, original regional report, station edition, build ID and summary must match the saved receiving state. The receiver continues its archive and reopening stages without rebuilding completed GIS results.

The Workspace ZIP is read through the maintained portable archive verifier. Every declared member is checked, and its SHA-256 is calculated from the same opened file. The archive must contain the selected gauge and station records and reports, their referenced source collections and original content-addressed bodies and companions, observation originals where selected, and the original regional report. A previously recorded archive path, byte count and SHA-256 cannot be silently replaced. The recorded application fingerprint describes the application inside that archive, including when the current application has since advanced.

If backup publication completed before the receiving checkpoint was written, the same existing ZIP is adopted after these checks. If the ZIP has a saved checkpoint but is missing or changed, the receiver preserves the original descriptor and reports the mismatch.

An existing reopened directory is checked against every original archive member before its selected gauge edition is accepted. This also recovers a completed restore whose receiving checkpoint was interrupted. The original project, regional report, station edition, build ID and summary must remain equal. The successful reopening records the archive SHA-256, archived application fingerprint and number of verified members.

The complete ZIP and reopened directory remain outside the original Workspace. A partially populated restore destination is preserved and reported; use the original retained archive and a deliberate new receiving destination for repair. The receiver never deletes another operation's files or overwrites an incompatible archive.
