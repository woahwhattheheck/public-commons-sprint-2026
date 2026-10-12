# AidData Nigeria AIMS: source and attribution

The prepared IATI demonstration uses AidData’s historical Nigeria AIMS research data. The dated 2016 release documentation explicitly licenses the database under **Open Data Commons Attribution (ODC-By) v1.0**. Retain this notice and [the license](https://opendatacommons.org/licenses/by/1-0/) with the publisher file, derived editions, portfolio packet and report. The exact machine-readable source and documentary identities are in [aiddata-nigeria.json](aiddata-nigeria.json).

## Selected publisher file

Use the [original IATI 2.03 XML](https://raw.githubusercontent.com/AidData-WM/public_datasets/afaf88bc316560b575ed7778901ae2a999a69f1d/iati/iati_2.03_NigeriaAIMS_GeocodedResearchRelease.xml) at AidData-WM/public_datasets commit `afaf88bc316560b575ed7778901ae2a999a69f1d`:

| Identity | Exact value |
| --- | --- |
| File | `iati/iati_2.03_NigeriaAIMS_GeocodedResearchRelease.xml` |
| Git blob | `fd904aaef21437d81d57c5334cc421a1b300568b` |
| Bytes | 309,331 |
| SHA256 | `4eddc914f4e5a60ca869f3d52046cb55fc7bb44cabb829d78b2f510fbff4ca9e` |
| XML generated timestamp | `2016-04-18T13:57:29` |
| Reporting organisation | AidData, `US-501c3-522318905` |

The XML identifies its IATI standard and generation date but does not declare a Level1 dataset-release version. Keep that distinction in receiving inputs. Obtain all operational counts and financial groups from the original parser and selected editions. Preserve the source’s reported decimals, currency dimensions and dates. This is a historical research-data demonstration.

## Notice to include in a handover

Contains data from AidData’s Nigeria AIMS Geocoded Research Release (2016), made available under the Open Data Commons Attribution License (ODC-By) v1.0. The selected IATI 2.03 XML was generated on 18 April 2016; its original bytes and immutable source identity are retained beside the derived portfolio, editions and report.

**Release citation supplied by AidData’s dated 2016 README:**

> AidData. 2016. NigeriaAIMS_GeocodedResearchRelease_Level1_v1.3.1 geocoded dataset. Williamsburg, VA and Washington, DC: AidData. Accessed on 2026-10-12. http://aiddata.org/research-datasets.

Original publisher file: [immutable XML](https://raw.githubusercontent.com/AidData-WM/public_datasets/afaf88bc316560b575ed7778901ae2a999a69f1d/iati/iati_2.03_NigeriaAIMS_GeocodedResearchRelease.xml). Database license: [ODC-By v1.0](https://opendatacommons.org/licenses/by/1-0/). Changes: retain the original XML unchanged; the accompanying workspace records identify the native projections, portfolio selections, reviews, comparisons and report produced from it.

## Documentary basis

The [original v1.3.1 release archive](https://github.com/AidData-WM/public_datasets/blob/afaf88bc316560b575ed7778901ae2a999a69f1d/geocoded/NigeriaAIMS_GeocodedResearchRelease_Level1_v1.3.1.zip) contains `NigeriaAIMS_GeocodedResearchRelease_Level1_v1.3.1/README.pdf`. Its first page is dated 18 April 2016. Pages 9–18 reproduce the ODC-By terms; §3.1 on page 12 includes commercial database use, and §§4.2–4.3 on page 14 specify preservation of the license/notices and the public-output attribution. Include the license link in relevant data documentation and keep original notices. The original software has its own software license.

The archive is 1,028,216 bytes, SHA256 `9d284b946ea400eade62477642dd32bf79ccb7c7b1d220acd0aed4847954df43`, Git blob `1a285a82da9dfb890451dde6b1af0925900ac14a`. The README is 34,390 bytes, SHA256 `e9df0ce1aedf384b34f35735ee256fe34aae0dda4a8153ead01da4fc311f9d63`. These identify the release notice associated with the 2016 source family; the independently published 2.03 XML keeps its own identity above.

## Retained source discrepancies

The [current AidData landing page](https://www.aiddata.org/data/nigeria-aims-geocoded-research-release-level-1-v1-3-1), observed on 12 October 2026, labels Version 1.3.2 with the 2016 publication date and earlier coverage totals. The currently linked v1.3.2 archive instead has a README dated 31 August 2017 and different subset totals. Preserve both observations rather than applying either release’s headline totals to the selected XML. The later archive and README hashes are retained in the JSON notice.

Both release datapackages also contain a conflicting `Licenses Id: odc-pddl`. Their `Licenses Name`, version, URL and complete README license explicitly identify ODC-By 1.0. This handover preserves the original machine field and follows the accompanying Attribution notice and terms; it does not describe the data as a public-domain dedication.

## Original credits

The release credits AidData and support through a University of Maryland sub-award under Air Force Office of Scientific Research grant FA9550-14-1-0353, funded by the U.S. Department of Defense’s Minerva Initiative. Retain the original source and its credits with a distributed research-data handover.
