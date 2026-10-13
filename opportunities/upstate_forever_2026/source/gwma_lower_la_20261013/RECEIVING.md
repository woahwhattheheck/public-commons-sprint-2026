# Receive the original Lower Los Angeles River cohort

This directory is the complete public input for the maintained GWMA study operator. The selected source returned all **24 E. coli observations** at **Los Angeles River at Imperial Highway**, station `412LARAIH`, from March 12, 2024 through January 30, 2025. The observed method is `SM 9223 B` and the unit is `MPN/100 mL`. All 24 original result qualifiers are `=`; their MDL and RL are both `1`. The retained collection keeps all 81 publisher fields plus the original CKAN record ID.

## Original source and capture

The exact selection is RegionNumber `4`, StationCode `412LARAIH`, Analyte `E. coli`, and Project `Lower LA River Restoration Access Feb24-Jan25`. The opening page returned 24 records and total 24; the separate terminal request at offset 24 returned zero records and the same total. Original IDs are 340259 through 340282. Read `cohort.json` for the full selection, original response identities and representation rules. Every raw response has its original query URL and receipt in `raw/`; `source-manifest.json` binds the complete collection.

Original selected response: [California public API](https://publish.data.ca.gov/api/3/action/datastore_search?resource_id=15a63495-8d9f-4a49-b43a-3092ef3106b9&filters=%7B%22RegionNumber%22%3A%224%22%2C%22StationCode%22%3A%22412LARAIH%22%2C%22Analyte%22%3A%22E.%20coli%22%2C%22Project%22%3A%22Lower%20LA%20River%20Restoration%20Access%20Feb24-Jan25%22%7D&limit=40&offset=0&sort=_id%20asc).

The complete original response is 62,896 bytes, SHA-256 `8eab666fba345c5fca8a2c9eae0a88e8be23b582500baa7cd5d2d3d037344696`. The derived field-order CSV is 20,386 bytes, SHA-256 `73953246f971379960064b0205b0fc976e1830bb57fe12e618ff4cbfab7e6683`. Original strings and numeric token text are preserved. Empty CSV cells project JSON null; the original JSON retains that distinction. Publisher-derived substitution and geometric summaries remain separate columns.

## Complete operating course

Use the installed original application containing PR 3635, merge `207d61ffa33b81ce4fb2dc0033ec8ebdf22f3623`, or a later composed edition. From `opportunities/upstate_forever_2026`, choose one private case path and keep it on retry:

```bash
python3 -B receive_gwma_study.py \\
  --workspace /absolute/private/gwma-lower-la-20261013 \\
  --csv source/gwma_lower_la_20261013/safe-to-swim-cohort.csv \\
  --source-manifest source/gwma_lower_la_20261013/source-manifest.json \\
  --source-id cohort-csv \\
  --source-uri 'https://publish.data.ca.gov/api/3/action/datastore_search?resource_id=15a63495-8d9f-4a49-b43a-3092ef3106b9&filters=%7B%22RegionNumber%22%3A%224%22%2C%22StationCode%22%3A%22412LARAIH%22%2C%22Analyte%22%3A%22E.%20coli%22%2C%22Project%22%3A%22Lower%20LA%20River%20Restoration%20Access%20Feb24-Jan25%22%7D&limit=40&offset=0&sort=_id%20asc' \\
  --profile safe-to-swim-legacy-81-20261012 \\
  --reviewer 'GWMA original-source receiving' \\
  --study-title 'Lower Los Angeles River original-source receiving'
```

The course retains the complete registered source, checks every original row and cell, repeats the exact intake, saves an explicit review and successor, remaps the retained original, builds the exact observed-unit contract and source-linked workplan, then creates a complete analytical handover and cold-reopens a separate receiving copy. The named review exercise returns its selected row to pending scientific review; source values stay in their original records. A stopped copy resumes from its original operation-owned staging directory. The final receiving workspace is published after its records and original archive are verified.

A completed run writes `gwma-receiving-result.json` into the selected case. It contains actual study/mapping/batch/review/contract/plan/handover identities, source counts and archive details. Preserve the whole case and its `-reopened` sibling when delivering the result. The same study can then be opened in the original operator's **Pathogen study** view for further review, workplan editing and handover download.

## Scientific review

Publisher timestamps do not state a timezone. The source's repeated `SampleID` uses the station name; original CKAN IDs and retained row identities distinguish observations. The source project and station describe the Lower Los Angeles River, while formal study-watershed assignment remains an explicit reviewer decision. Source quality labels, laboratory information, batch/sample comments, original result values and detection limits are all retained for that review.

The analytical handover preserves observed concentrations and the selected method, matrix, fraction and unit. Study owners select exposure, dose-response, uncertainty and risk-model contracts through the existing workplan. The full current operator guide is [GWMA_STUDY.md](../../operator/GWMA_STUDY.md).
