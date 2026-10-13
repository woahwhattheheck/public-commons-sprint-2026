# Chemistry analyst review

The existing Monitoring + Chemistry workbench now carries a separate, editable analyst review beside its completed calibration, sensitivity, uncertainty and monitoring-design records. The original scientific data, interval qualifiers, fit/holdout roles, parameter units, reports and embedded native project remain intact.

## Use the workbench

Open the completed HTML and select **Compound chemistry**. Choose an analysis, reach and measurement using the existing controls. The analyst panel adds record/note search, review-status filtering and the sensitivity-parameter selector. Use **Review** beside a record to inspect its full stored numerical and source record, enter a note, and mark it Open, Reviewed or Follow up. The reviewer field identifies the author of subsequently saved notes.

**Export visible data CSV** and **Export visible data JSON** retain full stored numbers and attach the selected review. CSV keeps arrays as JSON cells and protects source text from spreadsheet formula interpretation. The original table remains available underneath the analyst panel.

**Export review JSON** saves all review entries, including entries outside the current filters. **Import returned review** adds new entries and presents different existing notes side by side. Select Keep current or Use returned for each conflict. Import requires the same original study data. Resolve pending conflicts before combining another returned file. The current selections and notes survive an invalid import.

**Save working HTML** downloads the current review, saved view, original results, reports and all original embedded downloads in one offline file. Open that downloaded file to continue on another browser or receiving machine. Pending returned-review conflicts travel with this file. **Export review report** produces a readable HTML summary of the visible records, with full original numerical records and the complete saved review embedded.

Browser storage provides an additional convenience copy where permitted. A managed browser or embedded preview may disable it; the status message identifies this case and the working HTML/JSON exports remain the portable save route. If a newer local copy is detected during a save, current edits fork into a separate review instead of overwriting that copy. Export both copies and use the same returned-review merge.

## Produce the same page

The maintained `build_study_workbench.py` calls `review_workbench.augment` after composing the original map, data and downloads. Keep `chemistry_review.js` and `review_workbench.py` beside that publisher when installing the source.

For an already completed original workbench:

```sh
python review_workbench.py \
  --input /absolute/original/Ecosystem_Monitoring_Chemistry_Workbench.html \
  --output /absolute/delivery/Ecosystem_Chemistry_Analyst_Workbench.html
```

The output must be a new file. This consumes the completed source; it does not rerun or modify the saved native project. The two review files also suffice for this receiving-side command without replacing an installed application.

Review identity is bound to the exact retained `study-data` body, case, engine and project. The review is a portable analyst layer, not a replacement for native model inputs or scientific interpretation. Authored example reviews in a handover illustrate the exchange workflow and are separate from field observations or client feedback.
