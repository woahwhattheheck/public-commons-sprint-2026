# Selected station study to scientific report

The saved Station geography study now opens its original inventories directly in **Assessment context**. This preserves the exact study selection through assessment interpretation and the existing scientific report composer.

## Continue from the native report

1. In **Source reports**, open the retained native assessment report.
2. Select the stations in its native station explorer and choose **Export selected native JSON**.
3. In **Station geography**, use **Use selected native report stations** to choose that report and file, then **Build selected study**.
4. Open the completed saved study and choose **Use saved study in assessment context**.

The handoff uses the whole saved study. Its inventories and source rows are loaded from the retained geography edition, even if the station map currently shows a narrower search or filter.

For the retained utility-union example, the study starts with the original 24 stations and 32 assessment records. The two-station example RS-21014 and SV-809 starts with four original records.

## Prepare assessment interpretation

The Assessment context desk opens with the exact saved study, every retained assessment inventory containing rows, its native watershed source and the original field bindings. It shows the number of selected inventories and records.

Review **Association used for context** before building. The maintained default uses the assessment publisher's watershed assignment. The alternative uses the station's mapped membership in the retained original watershed geometry. The saved context preserves the comparison between these relationships and the original publisher fields.

Original publication status, assessment edition, cause, use, support and source references remain attached to each record. The selected inventory preserves all 28 original CSV fields and adds the publisher status, edition title and exact normalized-record locator from the retained original source. Its saved geography keeps the normalized source body and its current portable member path alongside the derived CSV position. The selected inventory includes every original assessment record for the chosen station cohort; the desk's assessment filters can then make an explicit source-record selection.

Choose **Prepare geographic context** to save the calculation in the existing queue. The resulting saved context has the original assessment table, mapped watershed associations, source references and complete editable package. Existing parcel associations remain available for a compatible retained parcel study.

## Prepare and reopen the scientific report

On the saved assessment context, choose **Use saved assessment context in report**. When the original report-source operation completes, choose **Open scientific report**.

The existing scientific composer lets you:

- Set the report title and add other saved scientific studies.
- Arrange the studies with **Earlier** and **Later**.
- Use **Preview selected sources** to review the chosen original editions.
- Choose **Prepare PDF, HTML and data**.
- Reopen the result through **Saved scientific reports**.
- Choose **Prepare complete report ZIP** or **Back up Workspace with this report**.

The assessment producer retains the exact saved context and original geography package. The source-bound native review, selected original inventory and original point/watershed sources travel inside that existing source closure.

**Open Maps and delivery** remains available when preparing a report together with retained model runs and map settings.

## Matching observed measurements

The existing **Open matching observations** control in Station geography remains available for the current visible station cohort. It opens **Published studies** with those exact station IDs and the saved geographic selection.

Assessment records and observed measurements have distinct source identities and scopes. Use the retained reports and scientific studies associated with each original observation edition when adding measured evidence to the report. The assessment context course preserves the original regulatory records and geographic relationships.

## Application contract

`attachAssessmentContext(host)` now returns:

```javascript
openForGeography({
  workspace_key: "the current Workspace",
  geography_id: "the exact saved geography edition ID"
})
```


The handoff reads the existing assessment **catalog** and **options** routes. It validates the saved study ID in both responses before replacing the preparation form. It does not start a calculation automatically.

The destination selects the actual retained inventories and watershed reference supplied by the existing backend. Requests are isolated by Workspace and view generation; a later saved-context navigation cancels an earlier geography opening. The existing original task queue owns assessment calculation, report-source preparation, report publication and reopening.

Current shared paths are:

- `operator/web/station_geography.mjs`: one saved-study action and the existing host's `openDesk` handoff.
- `operator/web/assessment_context.mjs`: the new entrypoint and stale-request guards.
- `operator/extensions/assessment-context.json`: maintained extension version.
- `operator/SELECTED_STUDY_TO_REPORT.md`: this complete workflow.

Preserve concurrent native WBD, matching-observation navigation, assessment producer and scientific composer work when composing these shared files.

## Native receiving course

Use the existing original receiving Workspace and its imported native report, original point sources and retained watershed geometry.

Open the prepared utility-union selection, build its 24-station study and use the new saved-study handoff. Check that the Assessment context form starts from that exact saved geography and its 32 original records. Choose the intended relationship basis, build the context, prepare the existing report source and open the scientific composer.

Prepare the complete scientific report ZIP and reopen it through the maintained report receiver or restored Workspace. Inspect the source-bound selected inventory, raw native selection and original geography package from the reopened report. Keep this continuation in the same native receiving operation.
