# Original OECD source edition

Operation: **SCF-OECD-LEADING-INDICATORS-20261012**.

All 15 files in [sources/bundle.json](sources/bundle.json) are unchanged native public HTTPS responses. Their original acquisition URLs, byte counts, SHA-256 values and attachment/readback receipts are retained in that manifest. Native public-attachment readback does not expose the original HTTP response headers; the manifest records the actual transport facts supplied by that source route.

| Source | Exact identity / scope |
| --- | --- |
| Generic SDMX data | Seven countries; original monthly CLI response beginning with requested period 2024-01; 231 observations; 68,398 bytes |
| Dataflow | OECD.SDD.STES / DSD_STES@DF_CLI / 4.1 |
| Data structure | OECD.SDD.STES / DSD_STES / 4.1 |
| Country code list | OECD / CL_AREA / 1.1; original isPartial=true; CAN, DEU, FRA, GBR, ITA, JPN, USA |
| Unit code list | OECD / CL_UNIT_MEASURE / 1.0; original isPartial=true; IX |
| Activity code list | OECD / CL_ACTIVITY_ISIC4 / 1.0; original isPartial=true; _Z |
| Remaining nine code lists | Complete original referenced CL_FREQ, CL_MEASURE, CL_ADJUSTMENT, CL_TRANSFORMATION, CL_TIME_HORIZ, CL_METHODOLOGY, CL_OBS_STATUS, CL_UNIT_MULT, CL_DECIMALS responses |

The original data Header is **IREF018322** with Prepared **2026-10-12T13:29:38**. That source field has no timezone; it is preserved as written. It names **StructureUsage** dataflow **DSD_STES@DF_CLI version 4.1**. The separately retained dataflow’s Structure element identifies the corresponding **DSD_STES version 4.1**. The data request used the provider’s then-current dataflow and the returned header supplies the actual retained version.

The official item endpoint accepts the provider’s plus-separated item selection for these original responses. The original full lists are much larger; the selected partial code lists preserve precisely the country/unit/activity items needed by this source. The unchanged XML retains isPartial and its multilingual names, descriptions and annotations. The application validates every selected source code against the retained referenced list.

## Primary documentation

- [OECD SDMX API guide](https://www.oecd.org/en/data/insights/data-explainers/2024/09/api.html): paired data/structure acquisition, dataflow versions, selection keys and native output formats.
- [OECD CLI definition](https://www.oecd.org/en/data/indicators/composite-leading-indicator-cli.html): amplitude-adjusted index and long-term average 100.
- [OECD CLI methodology and revisions](https://www.oecd.org/en/data/insights/data-explainers/2024/04/composite-leading-indicators-frequently-asked-questions.html): qualitative turning-point interpretation, comparable reference forms and native revisions.
- [SDMX REST structural resource specification](https://github.com/sdmx-twg/sdmx-rest/blob/master/doc/structures.md): native item selection and partial structural responses.
- [OECD Terms and Conditions](https://www.oecd.org/en/about/terms-conditions.html): original provider terms. Report attribution distinguishes original data from this application’s selection, index-point calculations and presentation.

The original methodology description also remains inside the dataflow XML. Its link and prose are source metadata; the application uses the current official indicator/FAQ pages for its short report explanation. It preserves original observations and their acquisition scope when comparing later source revisions.
