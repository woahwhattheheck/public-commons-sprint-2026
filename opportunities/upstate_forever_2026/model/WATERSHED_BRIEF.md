# Saved watershed planning brief

The existing watershed selection export can include a readable HTML and Markdown briefing alongside its retained JSON and CSV. Both views use the original selected-watersheds/v1 object and preserve each selected HUC12, its original state portions and NRCS status, legal source-class codes and query coverage, known original drainage connections, and source links.

## Existing operator integration

Import BRIEF_FORMAT and write_selection_brief from model.watershed_brief in the current watershed provider. Add brief_format: BRIEF_FORMAT to the existing export identity alongside its current csv_format and csv_columns. After the provider creates its source-bound selection object, call write_selection_brief(target, selection), then merge the returned filename-to-descriptor mapping into the existing result.files. The existing export reader and download tickets expose both files automatically.

Retain the current selection's report_id, report_sha256, export_id, source_fingerprint and source_inputs. The brief shows those identities when available. Keep the current saved-selection/history behavior and the shared model-column CSV writer.

Add model/watershed_brief.py to operator/install_watershed_context.py FILES so the same installed provider can import it. The standalone HTML uses semantic headings, column and row table headers, captions, source links and neutral print styling.

## Actual four-RFP-watershed selection

From the current application root, use the original retained watershed-context.json and the existing receiving output directory:

    python -B -m model.watershed_brief \
      --report /actual/workspace/watershed-context/REPORT_ID/watershed-context.json \
      --huc12 030601010703 \
      --huc12 030601010704 \
      --huc12 030601020502 \
      --huc12 030601020507 \
      --output-dir /actual/receiving/watershed-rfp-focus

These are Upper Six And Twenty Creek, Lower Six And Twenty Creek, Choestoea Creek and Lower Tugaloo River. The original model's selected_watershed_export supplies the selected rows and quantities. The briefing renderer formats that retained result.

A previously saved selection uses:

    python -B -m model.watershed_brief \
      --selection /actual/workspace/watershed-context-exports/EXPORT_ID/selected-watersheds.json \
      --output-dir /actual/receiving/watershed-selection

The JSON written to stdout contains the original input-file SHA256, context identity, selected HUC12s, retained summary and both output file descriptors. The HTML's print stylesheet supports the current installed browser/PDF export path.

## Quantity interpretation

Whole-watershed area counts each HUC12 once. Original NRCS state portions and their statuses remain separate records, including cross-state watersheds. The briefing retains the model's interpretation of rounding and vintage differences.

Selected-class records use the source publisher's HUC12 attributes and the original complete-query coverage. Original ToHUC upstream quantities apply separately to each focal watershed; shared ancestors are visible in each watershed's own context. The native model's geometry, role and source-method explanations remain in the brief.

## Module API

- render_selection_brief(selection) returns Markdown.
- render_selection_html(selection) returns a complete accessible HTML document.
- write_selection_brief(directory, selection) writes watershed-selection-brief.md and watershed-selection-brief.html and returns the existing operator's relative filename/file-descriptor mapping.
