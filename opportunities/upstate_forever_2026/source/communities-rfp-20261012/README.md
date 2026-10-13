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

Import `source-manifest.json` through the original Workspace source operation, then choose this entry in Communities. The application retains every original row and source note; blank source values remain unknown. For the full operator workflow, see `model/COMMUNITIES.md`.
