# Complete public operating example

The release includes the complete published SANDAG aggregate example, its extraction and model-building code, an authored Cognos-format specification, a native Power BI project, and five native RDL reports. It is a reproducible public-data implementation example. The source specification is authored for this example; it is not a production agency export.

## Open the operator

Install the dependencies in requirements.txt, then import the complete example:

```bash
python BI_OPERATOR.py --workspace ./public-workspace example --build
python BI_OPERATOR.py --workspace ./public-workspace serve
```

Open the private local address printed by the second command. The workspace retains original source bytes, mapped data, report ownership, plan revisions, native artifacts, comparisons, support cases and receiving jobs. The browser offers Inventory, Migration plans, Data & corrections, Output comparison, Report Server, Power BI capture, Rollout & rollback, Support desk, Handoff & recovery, and Activity & versions.

## Report Server comes first

The issued ARJIS procurement calls for on-premises Power BI Report Server before its later cloud transition. Open **Report Server** to import an original .rdl or a .pbix saved by Power BI Desktop optimized for the receiving Report Server. Large native files can stay on the original Windows machine: use the supplied runner's Register operation and import its small registration JSON.

The public example includes a full paginated report for each reviewed table:

| Native report | Complete source rows |
| --- | ---: |
| OffenseCells | 5,037 |
| Jurisdictions | 26 |
| Population | 42 |
| PublishedControls | 312 |
| Years | 3 |

Use **Build a native paginated family** with the reviewed plan. For the OffenseCells comparison projection, select the eleven source fields in report-server-comparison.json; other reports can keep every model column. CSV reports retain their selected source cells through the embedded XML data provider. SQL reports retain the reviewed physical query or table mapping, scalar parameters and Windows integrated security. Every report is checked against the pinned Microsoft RDL 2016 schema.

Prepare a receiving job with the actual receiving server, catalog path, report parameters and owner. Its ZIP contains the exact report or original external registration, original job.json, the Windows runner, and its operating guide. The native runner can inspect, capture the existing definition, publish, reconcile an interrupted response, export paginated CSV, restore the original report, and return the same operation's package. See tools/report-server/GUIDE.md for the complete native workflow.

Receive that original result ZIP in the operator. Intake checks the actual original job bytes, complete embedded file manifest, every captured CSV, and pre-existing capture identities before saving imported records. Source null tokens and the returned capture kind remain attached. Large original files omitted from the portable result retain their complete size/hash and stay in the receiving Windows work directory.

## Native Power BI project and cloud transition

examples/sandag/SANDAG_Public_Example.PowerBI.zip contains the complete five-table project, data, TMDL semantic model, PBIP/PBIR report definitions, native visuals, and opening/preparation scripts. It has five relationships, six measures, four pages and seven visuals. Its nineteen schema-bearing JSON documents are checked using the eighteen pinned Microsoft schemas bundled with the operator.

Open and refresh the project with the appropriate Power BI Desktop release. capture-query.dax and native-comparison.json define the complete 5,037-row native query comparison. For an existing published semantic model, **Power BI capture** keeps the original Execute Queries response and complete CSV. **Rollout & rollback** retains the original existing-item definitions and native long-running operation identities before changing a cloud target.

## Full-data correction and operating recovery

The complete local browser exercise on 11 October 2026 used every one of the 5,037 source offense cells and all eleven mapped fields. A working copy contained one deliberately altered count. The first comparison found that single difference. The operator corrected the exact retained row, then linked a new passing comparison to the original baseline and comparison.

The same exercise assigned the original source, recorded its actual local build usage, saved the reviewed plan, built the native project, imported a native RDL, built the complete five-report family, prepared the Windows receiving job, resolved its support case, and built both Report Server and native-project handoffs. The latter contained nineteen files, including the complete source and target CSVs and original/corrected comparison records.

An encrypted backup retained the complete twenty-four-file workspace. It restored into a new directory, renewed local browser access, and reopened the same business IDs and revisions, corrected comparison, support case, native receiving job and handoff. Desktop and 390-pixel browser operation completed with no console errors; all ten mobile views fit the viewport.

Those local exercises cover the actual operator, generated native file formats, full-row comparison and cold recovery. The receiving Windows operation records actual Report Builder/Report Server opening, rendering, server build and native outputs. The original coordinated Windows job is the place to append those results; the local preparation demonstration does not issue server requests.

## Preserve the source interpretation

SOURCE.json, counting-basis.json, footnotes.json and source_warnings.json retain the original public report interpretation. Group A counts and arrest-based Group B are distinct. The original population labels and combined 2023/2024 applicability are retained. Regional calculations use the Sheriff's total once, without adding its component jurisdictions again. Published summary controls remain independent of detailed source tables; differences between them remain visible.

The original public report and extraction provenance are linked in SOURCE.json. SOLICITATION_SCOPE.md records the separately reviewed current procurement scope and source references. Use actual customer exports and approved receiving access for the contracted report family.
