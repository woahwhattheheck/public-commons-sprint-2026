# CMS California hospital source-edition review

Open `comparison-review.html` in a browser to inspect the complete May-archive and August-publication editions. The standalone file contains both source editions, every retained original value and the editable change-review controls. It works without a server. Export the complete comparison or reviewed decisions through its ordinary controls and reopen them independently.

## Actual source editions

| Edition | California records | Original fields | Source meaning |
|---|---:|---:|---|
| Hospital archive dated May 13, 2026 | 378 | 38 | The publisher says the data was unpublished on the listed archive date because updated data replaced it. A publication date is not supplied. |
| CMS API edition released August 13, 2026 | 377 | 38 | Retained publisher metadata reports release August 13 and modification July 22, 2026. |

The prior input is the entire unchanged national Hospital_General_Information.csv: 5,432 records, 1,453,884 bytes, SHA-256 `83c98b2e8687580e0482b13e1e9acd5813534be243e5ccd9f55556a869595d40`. The explicit request selects California after parsing all original rows. It maps every one of the 38 published headers to its known field, including City/Town and County/Parish, while retaining the complete original CSV. Identifiers and cell values remain literal strings.

The archive URL is:
https://data.cms.gov/provider-data/sites/default/files/dataset-archives/theme/hospitals/hospitals_2026-05-13.zip

Its selected original readme.txt is 426 bytes, SHA-256 `729913b5bccde42b3c7fe62a1a6acce41b9b3c25d6697d73b9fdc250f25686ab`. The request binds date attribution to that exact member. Its HOSPITAL_Data_Dictionary.pdf is also retained unchanged. The archive date is stored separately with the meaning “Unpublished and replaced with updated data”; the prior publication and data-modification dates remain null. Capture date is October 13, 2026.

## Complete comparison

The complete original inputs produce **371 unchanged facilities, six changed facilities, one removed source record and no added records**. There are 18 change items: 17 field changes and the complete removed row.

| Facility ID | Retained source change |
|---|---|
| 050125 | Regional Medical Center of San Jose is absent from the later source edition. |
| 050289 | AHMC Seton Medical Center ownership changes from Voluntary non-profit - Church to Proprietary. |
| 050334 | Facility name changes from SALINAS VALLEY MEMORIAL HOSPITAL to SALINAS VALLEY HEALTH MEDICAL CENTER. |
| 050407 | Chinese Hospital telephone changes from (415) 982-2400 to (415) 677-2480. |
| 051338 | Coalinga Regional Medical Center has 11 changed measure-count or footnote cells. |
| 054123 | St Joseph's Behavioral Health Center ownership changes from Voluntary non-profit - Private to Proprietary. |
| 054160 | River Vista Behavioral Health has an address capitalization change and a telephone change. |

These are differences between the retained publications. The interface shows the exact before/after cells, original source mappings and complete original rows. It keeps empty cells distinct from missing fields. The comparison uses every field and record; it does not infer hospital operating status or clinical effects from a changed source cell.

Original prior release: `cms-ca-8d65ee4d345377dd49afd38ff712f28702336d2750f0a76b977d990b04fc5870`.
Original current release: `cms-ca-8d621b64ae245acb9f970dbc24e9447f18fb5d1c2710640d538dd6afebe29872`.
Comparison: `cms-diff-e34af7ed05901f66399d9b28ffb363910e00946ad125f6d910f33700bcfc9d4f`.

## Included files

- `Hospital_General_Information.csv`: complete unchanged original national CSV.
- `readme.txt` and `HOSPITAL_Data_Dictionary.pdf`: complete unchanged bundled publisher documentation.
- `may-source-request.json`: explicit original-header mapping, scope and source/date attribution.
- `may-complete-source.json`: complete original May source transfer for the maintained reviewer’s existing prior-edition upload control or native receive command.
- `comparison.json` and `all-changes.csv`: every retained source change.
- `comparison-complete.json`: both complete source transfers, full comparison and initially unreviewed decisions.
- `comparison-review.html`: standalone reviewer, all original source downloads, exact before/after fields and review export/import.

## Reproduce and receive

The maintained current `review-desk.html` can receive `may-complete-source.json` through its ordinary prior-source upload. It reconstructs the prior edition from its complete national CSV and opens the same full comparison against its retained August source. The whole original ZIP course remains available separately through the publisher-archive controls.

From the maintained tool directory, using new output paths:

~~~bash
node release.mjs ingest-csv examples/may-2026-to-august-2026/Hospital_General_Information.csv examples/may-2026-to-august-2026/may-source-request.json /owned/may-release
node release.mjs verify /owned/may-release
node release.mjs render-comparison examples/may-2026-to-august-2026/comparison-complete.json /owned/reopened-comparison.html
~~~

The retained complete comparison reconstructs both editions from their exact originals before rendering. The maintained `receive_browser.mjs` course operates the actual publisher ZIP intake, explicit mapper, source-date controls, full downloads and cold reopen with the host’s existing browser. See `RECEIVE_BROWSER.md` for original archive identities and actual desktop/390px recipient inspection.
