# Source explorer selections in the native watershed workspace

The original Upper Savannah explorer can now carry a reviewed utility or watershed selection directly into a saved native report. It preserves the original geographic source text and the discussion text entered in that view. The receiving report supplies its own source context, observed data, coverage and complete export packet.

## Use the original explorer

Open the utility source study at https://chatgpt.com/space/page_e620a8f6b9b48191a6be00b524713167 or the identical application file `source/utility-source-context/20261013/source-explorer.html`.

Choose ARJWS or PRWD. The original source inventory retains 303 USGS records, the 217-unit model domain, ARJWS's four contributing HUC12s and PRWD's 32. The existing phone layout keeps the complete selected utility name visible.

Under **Continue this selection in the native workspace**, choose one of:

| Choice | Membership carried into the native report |
| --- | --- |
| Entire selected utility planning area | The complete original utility upstream selection, independently of the current table filters |
| Watersheds matching the current filters | The actual visible domain or utility records after the state and text filters |
| Only the focused watershed | The selected original record within that visible view |

The counter shows the exact number of records that will travel. A zero-result filtered view must be cleared or replaced with the full utility choice before export.

Review the discussion fields, then use **Download native source review**. This writes `upper-savannah-source-review.json`. Existing Markdown notes and original data downloads remain available. An unchanged prepared prompt is labelled as such in the native report. Changed text is labelled **Edited in source explorer**; this records the text's editing status, without assigning authorship or acceptance.

## Open the same source selection natively

1. Open the intended project and **Regional watersheds**.
2. Open or build its original 217-watershed report with the complete native HUC12 / ToHUC network.
3. Under **Continue a source explorer review**, choose the downloaded JSON.
4. Inspect its exact membership and discussion text, then use **Save reviewed selection and reports**.
5. Open the completed task or saved selection. Use its readable HTML brief, source briefing or **utility-watershed-packet.zip**.

The original export action receives the reviewed selection and validates it before writing. The backend checks the exact source-edition bytes, native utility profile, full domain membership and every original downstream link. It independently reconstructs the requested whole-utility, filtered or focused membership. A changed source or different regional network therefore cannot silently reuse the review.

A complete utility selection uses the existing original-observation binding and can continue into **Prepare utility monitoring**. A filtered or single-HUC selection remains a regional source selection with that exact geographic scope; it does not acquire the full utility's microbial observations by implication. The reviewed discussion travels inside the source report and its briefing; the established meeting-notes workflow remains the place for subsequent recorded decisions and fieldwork actions.

## What the saved packet contains

The existing export directory retains:

- `selected-watersheds.json` and CSV, with the native parent-report identity and selection;
- the readable Markdown and HTML planning brief, including the reviewed source section;
- the existing source briefing and its report binding;
- `source-explorer-review.json`, the exact received JSON text;
- `source-explorer-review-bound.json`, the independently bound review, original source identities, selected area and labelled text;
- three original files under `source-review-originals/`: utility focus profile, full 303-record USGS topology and the 217 domain IDs;
- the existing native source and observation files appropriate to the selected scope;
- a complete offline ZIP with those original relative member paths.

The original review-byte digest and receiver version enter the saved export identity. Another selection or changed discussion produces its own export; an identical replay reopens the existing result. Existing exports without a review retain their original identity rules.

The review section labels its source areas **USGS whole-HUC area**. Existing regional report areas remain the original **NRCS** fields and state portions. Published intake-protection polygons, whole-HUC planning footprints, South Carolina source jurisdiction and model reporting masks retain distinct meanings.

## Source and implementation contracts

The packet schema is `upstate.watershed-source-review/v1`. The original source bank is SHA-256 `24db44e3b3896bafadbba3f50eacd5a852913baf201fd828123626a9fc45655d`. Its three immutable geographic members are verified against the exact published edition:

| Member | SHA-256 |
| --- | --- |
| utility-focus-profile.json | 93abaaf736c66a7ca971ca931da2a3d81d939ecdeb830c7892267153c4413da7 |
| usgs-wbd-savannah-original-topology-20261013.json | 2e57f86d1725526f00f16870b1b03d9168b41ea94de6d0016b20dfe15e89bcac |
| domain-huc12s.json | ec0cb3d05a0ede9da1b9238b7c7bff2fa495d94e5a6a0451890b54233edfbd52 |

The source is the [USGS WBD subwatershed service](https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6). The original utility profile cites the [issuer RFP and appendix](https://www.upstateforever.org/files/files/20261002_FINAL_EC-SDC%20Mapping%20RFP%20APPENDIX%20COMBINED.pdf), including PDF pages 6, 12, 14 and 16.

`source_tools/watershed_source_review.mjs` implements the standalone explorer's exact selection serialization. The self-contained HTML embeds the same function body. `model/watershed_source_review.py` verifies and binds the received JSON, labels discussion text and supplies brief sections. The existing `watershed.context.export` action accepts optional `source_review_text`; no new execution service or duplicate receiver is introduced. The ordinary registered Regional watersheds controller provides the chooser and existing task/report navigation.

The native installer includes the receiver, guide and self-contained explorer. Browser reads use a workspace/epoch/request guard so a late file read cannot replace another project's review. Actual original source exercises in V8 reproduce ARJWS4, PRWD32 and the domain's nine NC records; a zero-result selection is rejected before download.
