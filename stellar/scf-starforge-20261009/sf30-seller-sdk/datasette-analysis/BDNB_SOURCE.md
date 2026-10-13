# BDNB source and comparison model

This module adds immutable building/address editions, territory selections, source-backed identity comparisons and explicit review history to the existing Datasette Analysis workspace.

## Original source and grain

The bundled dictionary records 46 fields in the five original core tables from the publisher's v0.7.11 documentation, retrieved 13 October 2026. Each table and field definition retains the actual publisher URL. The documentation's current edition was 2026-02.a. The selected source descriptor carries the actual imported edition and schema version independently. The bundled v0.7.11 dictionary is used only with that version. A different selected version requires the complete explicitly supplied dictionary, including its original source references and all five table definitions. Stable public URL query parameters remain intact in the original descriptor.

Import complete UTF-8 CSV files with their exact whole byte length and SHA256, explicit delimiter, null spellings, geometry encoding and original publisher/coverage metadata. The source descriptor is a complete JSON object described by bdnb_contract.json. Every original CSV header, field string, data row and original row order remains retained. Unknown columns stay as original text with a visible undeclared-column finding until their semantics are explicitly supplied.

The importer streams original files and projected JSONL through the original DatasetDatabase importer. It creates native immutable DatasetDatabase versions in the original datasets.sqlite3. It does not use the bounded report preview as an ingestion limit. Each native projected record must fit the existing 2 MiB native JSONL row boundary. Source files are currently bounded at 64 GiB each; disk requirements include exact retained originals and projections.

## Original bytes and portable custody

Every whole CSV is hash verified before projection. Its exact bytes are split into ordered segments of at most 16 MiB; batches are registered as standard complete Analysis ResponseDocuments. Segment metadata records the original whole byte count/hash, every offset, segment hash and original table descriptor. The original Analysis workspace archive already includes those registered original documents. A receiver reconstructs a whole CSV by ordering all segments by index/offset, streaming the referenced binary files, then requiring the declared whole byte count and SHA256. A partial set is never the original file.

The source and projection spool are local implementation files. Current customer data, immutable versions and source documents are owned by the original Analysis workspace. A portable workspace carries the complete source segments and database state. A completed same-ID import reopens the original immutable entity before accessing any earlier producer path.

## Exact types and geometry

Raw CSV values remain strings. The dictionary projection separately records type, raw value, interpreted value, state and unit. Exact integers and decimals use canonical decimal text. Null, missing column, empty string, zero and invalid tokens stay distinguishable. Decimal normalization avoids binary float and Decimal context rounding.

Geometry retains the complete original value and encoding. Supported coordinate readers are WKT, EWKB hexadecimal and geometry-only GeoJSON text. Original Lambert-93 / EPSG:2154 coordinates remain in place. A different explicit SRID is a review finding. A declared opaque geometry remains available as original source. Renderable coordinates use binary numbers for display while exact coordinate tokens and original bytes remain available for comparison. LineString and ring structure are validated; geometry validity here is structural and does not assert topology or survey accuracy. Generated building geometry is labeled from contient_fictive_geom_groupe.

All six link weights use address denominators: the numerator is the amount served by a building group and the denominator is the total served through that address. The application never renormalizes these as group allocation weights.

## Selections and edition changes

Territory selectors use explicit department, commune and group IDs. Nonempty dimensions intersect. The complete source edition remains retained; selections keep every associated link and selected address rather than choosing one representative address.

Comparisons bind exact before/after selections and explicitly selected passage-table editions. Chain mode requires an explicit ordered edition_path of actual millesime labels. Selected full intermediate editions provide the original group presence needed to carry unchanged IDs across a boundary; missing passage rows alone do not establish that continuity. Same-ID continuity, direct publisher correspondence and connected correspondence chains remain distinguishable. Every supporting passage row travels with the finding. Merges/splits retain all values and never create artificial pairwise equivalence. Missing crosswalk rows do not establish creation/deletion: unchanged identifiers are generally absent from the passage table. Source scope entry/exit is distinct from publisher creation/suppression evidence.

Native SQLite indexes support row lookups and streaming comparison. A connected correspondence component exceeding 10,000 identities/edges stops with an explicit capacity error; it does not publish a truncated result. All declared native row-size limits are checked before publication.

## Reviews and replay

The existing operator controller owns 32-hex request IDs, accepted asynchronous actions and same-request resume. The adapter retains its immutable action intent and engine identity in the same SQLite database. An entity ID can be replayed only with its exact original normalized request. Completed results are adopted before fresh validation.

Reviews bind a comparison row and exact evidence SHA. Each subsequent review identifies the current preceding review, preserving the entire recorded history. A changed source selection or comparison has new evidence and requires its own review. A recorded accepted finding represents the supplied operator's review rather than contractual customer signoff.

## Integration

Root UI invokes the six mutations and four read actions in bdnb_contract.json. Model dispatch runs mutations under the original Datasette mutex. Engineering's bdnb_products.py uses the same native Analysis queries, report/workbook jobs, complete query exports and workspace archives. Downloads use exact bdnb-prefixed named native file receipts. Full annexes remain separate from bounded report rendering.

The Ntico Kestra case study establishes public/API ingestion to AWS S3 and Docker/custom logic. The actual namespace, buckets, credential references and deployed plugin/version are supplied by the operator. Existing company and commercial ownership remain in the original case.

Read pages preserve complete records and may stop before the requested row count at an 8 MiB payload bound. Continue at the actual next_offset. Address attributes, group fields and the full address-link relation are separate comparison kinds. Sound merge/split/complex topology remains visible while grouped field values retain explicit unknown aggregate equivalence.
