# Material catalog source inputs

These inputs support the material catalog edition, mapping, approval and native search workflow.

## SAP SHINE material editions

The two CSV files derive from SAP’s published SHINE demonstration data in [SAP-samples/hana-shine-xsa](https://github.com/SAP-samples/hana-shine-xsa). SPS11 uses commit [c8ef4bef](https://github.com/SAP-samples/hana-shine-xsa/tree/c8ef4bef064bc4b22e777e01ad5e469d070652f8), and SPS12 uses [db85d866](https://github.com/SAP-samples/hana-shine-xsa/tree/db85d866c2189d124184a3e0cc8802bd1f177f36). Both original product files are `db/src/data/loads/products.csv`.

Each edition contains all 106 original products. Every original product column stays a string. `NAME` and `DESCRIPTION` append the exact original English text selected by `NAMEID`/`DESCID` and `TEXTID` with `ISOLANGUAGE=en`. The shared text source is Git blob `01e0fea866d8b7d15477ffcea15614a980988a56`. Output is UTF-8 CSV with LF and standard quoting. Original source byte identities and the complete join are recorded in SOURCE-INDEX.json.

The actual release change updates all 106 `SUPPLIER.PARTNERID` strings. Material IDs and the other product fields remain the same. Use the two editions to review that complete source change. The mapping file preserves the literal column name containing a period and keeps quantity, weight and dimension units separate. SAP’s original unit dictionaries use client plus internal-unit keys; product rows contain no client column. Select the source tenant and dictionary client explicitly when applying those dictionaries.

SAP copyright: Copyright (c) 2017–2020 SAP SE or an SAP affiliate company. SAP publishes this source under Apache-2.0; see LICENSE-SAP-SHINE.txt and the original repository README.

## Wayfair catalog and relevance cohort

[WANDS](https://github.com/wayfair/WANDS/tree/3b74dcf4ba29ab8ff3e6a50b5b09fc627cb882b5) contains 42,994 original Wayfair products, 480 queries and 233,448 human relevance judgments. The unchanged `dataset/query.csv` is included here as `wands-query.tsv`. The original notebook reads all three dataset files using tab delimiters. The actual query IDs are noncontiguous and include `0` through `487`; iterate the supplied rows.

`mapping-wands.json` maps the original identifier, product name, description, category and source attributes. The published product fields determine the mapping. Source URLs, exact byte sizes and Git blob identities for the full product and label files are in SOURCE-INDEX.json. The native cohort runner consumes the full retained product artifact and evaluates all original query rows and judgments.

WANDS is published under MIT, copyright (c) 2021 ecir2022; see LICENSE-WANDS.txt. Cite: Yan Chen, Shujian Liu, Zheng Liu, Weiyi Sun, Linas Baltrunas and Benjamin Schroeder, “WANDS: Dataset for Product Search Relevance Assessment,” ECIR 2022.
