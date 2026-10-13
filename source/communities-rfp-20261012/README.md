# Original RFP community and utility source

This edition retains all seventeen rows of Appendix F, Table 1 in Upstate Forever's October 2026 EC–SDC GIS Mapping & Modeling RFP. The table appears on PDF page 16 (printed appendix page 11). The complete source description is in `provenance.json` and in the retained manifest entry's `community_metadata`.

The original PDF used for transcription is 7,504,118 bytes, SHA-256 `a519d33190eefaef7ec082c19642fc6b8ef89329ad3c648a561699c7dd277e74`. Its document text supplied Table 1, and a complete page reading supplied surrounding utility and watershed context. An earlier publisher capture has its separate original identity in the provenance.

`rfp-table1.csv` preserves twelve-digit GEOIDs and HUC12s as text. Its SHA-256 is `377d4f860fb545215534070309b67e1d26135cdab1ee03a70c657107692b06e4`. HUC12 identifiers join the original retained WBD/source-method selection and the RFP's appendix map.

| Utility | Whole block groups | Population | Households | Households below poverty | Medians below RFP state reference |
| --- | ---: | ---: | ---: | ---: | ---: |
| Anderson Regional Joint Water System | 11 | 20,088 | 8,650 | 702 | 5 |
| Pioneer Rural Water District | 6 | 7,360 | 2,351 | 312 | 5 |
| Complete original table | 17 | 27,448 | 11,001 | 1,014 | 10 |

The utilities' approximate service populations (210,000 and 7,000) describe separate utility-wide populations and are recorded separately in the source metadata. RFP Table 1 uses a 72,350 USD state median household income reference.

Import `source-manifest.json` through the original Workspace source operation, then choose this entry in Communities. The application retains every original row and source note; blank source values remain unknown. For the full operator workflow, see the [Communities guide](../../model/COMMUNITIES.md).

## Interpret the four focus watersheds

These summaries use the exact whole-block-group membership printed in the RFP
table. They are reproducible from [rfp-table1.csv](rfp-table1.csv).

| RFP focus watershed | HUC12 | Whole block groups | Population | Households | Households below poverty | Household poverty share | Medians below source reference |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Upper Six and Twenty Creek | 030601010703 | 5 | 11,005 | 4,542 | 205 | 4.51% | 0 / 5 |
| Lower Six and Twenty Creek | 030601010704 | 6 | 9,083 | 4,108 | 497 | 12.10% | 5 / 6 |
| Choestoea Creek | 030601020502 | 4 | 5,108 | 1,677 | 269 | 16.04% | 4 / 4 |
| Lower Tugaloo River | 030601020507 | 2 | 2,252 | 674 | 43 | 6.38% | 1 / 2 |
| Complete original table | — | 17 | 27,448 | 11,001 | 1,014 | 9.22% | 10 / 17 |

Household poverty share is the sum of the printed households-below-poverty
counts divided by the sum of the printed household counts, multiplied by 100
and rounded to two decimals. The corresponding utility-context shares are
8.12% for ARJWS (702 / 8,650) and 13.27% for PRWD (312 / 2,351).
Every original row's printed poverty percentage matches its printed household
ratio after that rounding. The source's printed percentages remain retained.

The geography is the full original census block group. A block group assigned
to one of these HUC12s contributes its whole source population and households.
The values have not been clipped by watershed boundaries or converted into
counts of utility customers. In particular, PRWD's 7,360 residents in these six
whole block groups and the source's approximate 7,000 utility-service residents
describe different geographic quantities.

The income comparison is a count of block-group median household incomes
below the RFP's 72,350 USD reference. The source medians range from 35,347 to
135,677 USD across the complete table. They remain individual medians; the
application presents their range without creating a mean or a pooled median.
These fields support a discussion of the selected communities and recorded
intervention rationale. They do not assign eligibility, individual household
income, pollutant exposure or a conservation benefit to residents.

## Open the retained case for a walkthrough

Start with the delivered scientific Workspace and its original saved
Communities table, plan and report. The [Communities operator guide](../../model/COMMUNITIES.md)
describes the normal browser flow; the [receiving guide](../../operator/COMMUNITY_RECEIVING.md)
continues the same receiving operation and its retained application edition.

1. In **Communities**, open the original table and its source metadata. Compare
   the two utility-context selections, then the four watershed selections
   above. Keep the separate utility service-population cards visible when
   explaining the table's geographic coverage.
2. Open an existing **Intervention plan** and its retained revision. Inspect
   the selected utility, HUC12 and GEOIDs, the proposed work, rationale, owner,
   status and entered estimate. An unspecified estimate stays unspecified.
   The plan's original scientific context names the source/grid/run/delivery
   records selected for that plan.
3. Open the report from that exact plan in **Reports** and use **Preview full
   report**. The HTML, Markdown, JSON and CSV products carry the same plan and
   source table. The report's recorded file index determines the available
   downloads, including any retained edited intervention CSV.
4. Compare the downloaded original table to the source CSV identity below.
   Use the complete report JSON and plan JSON to retain the actual table,
   plan, report and revision identifiers. The restored Workspace keeps those
   saved entities available to the receiving operator.

For a read-only inventory from the same existing Workspace:

    python -m model.community_cli --workspace "$eco_workspace" overview

Use its actual saved identifiers with the same CLI's table, plan and report
commands. Reading these retained records reuses the original work. If the
receiving operation stopped at its reopened browser stage, the maintained
receiving command continues that operation's stored directories and application
edition as described in the receiving guide.

## Exact source identity

The [source manifest](source-manifest.json) is 4,974 bytes with SHA-256
`480bbf6896f66f51d65dc511dbb2010676b55b7bfb973950ebb0db85b3f6d4ac`.
Its retained table entry is `RFP_COMMUNITIES_2024_ACS`; its 1,601-byte CSV
has the original SHA-256 stated above. These identities let a recipient match
the source edition in an existing workspace or report before interpreting the
summary. [provenance.json](provenance.json) preserves the exact PDF capture and
the earlier publisher capture as separately identified sources.

An existing report's plan and geographic selection determine which source
groups it includes. The all-table and four-watershed summaries above provide
a reference for this complete original edition; each saved report retains its
own selected group IDs and denominator.
