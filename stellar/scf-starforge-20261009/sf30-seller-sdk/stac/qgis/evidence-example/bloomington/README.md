# Bloomington retained public-source example

These three files retain the original acquired UTF-8 bytes used by the complete parcel-evidence receiving course.

| File | Bytes | SHA-256 |
| --- | ---: | --- |
| parcel.json | 2489 | 3c7b30af07053862a87ea4b1a1639364e8f983576b02a2febe7339b2b94adcbf |
| parcel-metadata.json | 16132 | c1cdce8b8834fbb83041553f6f7c67dcd0d5620a3f73141cf5384f3a91fbdf07 |
| flood-source-contract.json | 117356 | 555730fb7285ec5740d88b674583ff3be4dbbdc8c1b57f8b7964e44b3204d6f2 |
| flood-source-contract-superseded.json | 116698 | 309262f21b9920285301137c883388c8148f45301ebd8bab24648fe10435b867 |

The original IGIO service is https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_2025/FeatureServer/0 . Parcel state identifier `530533210083000005`, county parcel identifier `53-05-33-210-083.000-005` and original OBJECTID `17636` remain distinct. The selected original response contains one feature and `exceededTransferLimit=true`; its local end does not mean a complete parcel inventory. The original acquisition query is retained on the original source page and copied below unchanged:

https://gisdata.in.gov/server/rest/services/Hosted/Parcel_Boundaries_of_Indiana_2025/FeatureServer/0/query?where=1%3D1&geometry=-86.55%2C39.15%2C-86.50%2C39.19&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=objectid%2Cstate_parcel_id%2Cparcel_id%2Cnguid%2Cprop_add%2Cprop_city%2Cprop_state%2Ccounty_id%2Ccounty_fips%2Csource_featureid%2Csource_originator%2Cloaddate&returnGeometry=true&outSR=4326&orderByFields=objectid%20ASC&resultRecordCount=1&f=json

The selected corrected acquisition contract contains the complete six original metadata and attributes-only query response strings, their exact original public query URLs, native schemas, roles and individual capture references. Its source owner corrected a digest adapter's input type; every embedded original response remains byte-identical, and all six declared byte counts and SHA-256 values now match. `integrityCorrection` retains the superseded contract identity and reason. The unchanged earlier contract is included as `flood-source-contract-superseded.json`. The receiving course selects the corrected contract, measures every embedded body and retains declared and observed identities in `input-provenance.json`. The values in the table above bind these actual files.

The FEMA and Indiana DNR responses use the same original parcel polygon but distinct publisher feature/source identifiers and different authority roles. They requested `returnGeometry=false`; optional QGIS intersection and map observations use separately retained original geometry and completed native requests. Zone X, raw placeholder dates, nulls, sentinel values and full-feature shape area remain original source observations. Applicable jurisdiction, current complete ordinance, proposed work and professional review are explicit case questions.

Run the complete original backend, report, whole editable export and independent receive with:

```bash
python evidence-native-receiving.py --application-root /absolute/current/stac/qgis --directory /absolute/landsage-original-receiving --public-example --reviewer "Actual receiving operator"
```

`EVIDENCE_RECEIVING.md` covers explicit original input descriptors, optional real QGIS bindings, the same-operation continuation and actual rendered browser inspection. `PARCEL_EVIDENCE.md` describes ordinary operator use. All files travel with the maintained application's complete export source inventory.
