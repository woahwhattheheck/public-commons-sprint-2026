# Georgia legal reach and assessment geography review

This complete source family joins all 30 original Savannah designated-use records in the retained Georgia water-quality rule with the 295 original publisher GIS assessment features. Open **briefing.html** for the complete review. It includes full reach descriptions, every explicit exact-name candidate, reviewed source relationships, original attributes, filtering, CSV downloads and print.

## What the completed source comparison provides

The executed derivation produces 111 legal/source candidate pairs involving 72 distinct assessment features. Thirty-seven pairs were reviewed against both original descriptions; each resolves to one exact original service-kind/FID/ReachID and a retained geometry response. Those reviewed pairs support 23 legal records. Three have corresponding endpoint text. Four legal records have no exact named assessment candidate in this complete publisher selection.

Use **geometry-selection.json** to locate the existing agency geometries for the 37 reviewed pairs. It is a source-review selection: every row retains its relationship, original endpoint qualification, service URL, response filename, native EPSG:3857 and original Z/M declarations. The existing assessment geography receiver owns the eleven completed response bodies and the exact 217-HUC intersection. This family consumes that operation's original identifiers; it does not start another acquisition.

The two reviewed Little Beaverdam intervals publish Fishing, while the retained legal record declares Drinking Water. Their original fields remain intact for source review. Matching names or uses do not establish a change to the law.

### Specific decisions this resolves

- **Chattooga River:** separate the state-line–West-Fork interval from the West-Fork–Tugaloo interval; both retain their original wild/scenic components, and only the latter declares Recreation in the corresponding legal record.
- **Sweetwater Creek:** the stream endpoint descriptions correspond, while legal inclusion of Usry Lake remains a separate component.
- **Savannah River below Clarks Hill Dam:** two assessment intervals form a named chain to Horse Creek. The legal inclusions of Stevens Creek Reservoir and Augusta Canal remain separate geographic supports.
- **Liberty Lake:** the publisher explicitly names Federal Lake as previously Liberty Lake. The lake polygon and A.H. Stephens group-camp beach retain distinct identities.
- **Russell:** Richard B. Russell Lake is the named Savannah reservoir component. The separate Habersham Russell Lake is not substituted.
- **Broad River:** retain Comer Carlton Road versus South Fork/Mill Branch endpoint differences and SR 281 versus Wildcat Bridge Road wording.
- **Beaverdam and Grove:** preserve county and boundary differences; an exact shared name does not merge distinct waters.

The source family covers the publisher's **whole Savannah basin**, including downstream reaches. Neither the 30 legal descriptions nor the 295 source features is presented as automatically lying inside the 217-HUC study.

## Original files and editions

The original-legal directory contains byte-identical retained legal register, indexed PDF text extraction and selection definition from source commit 82d0cbcbef03aff2681ccf0ef689a78289518d82. The full register also preserves the separately scoped statewide trout clauses. This derivation selects only records whose original classification role is designated-use and basin is SAVANNAH RIVER BASIN.

The retained legal edition references the EPD-published rule effective for Clean Water Act purposes on 31 August 2022. It preserves the original reach wording, compound designated uses, PDF page and extracted line identifiers. Extracted line numbers are source-extraction positions, not statutory line numbers.

The original-assessment directory contains the complete original stream and lake attribute responses and ID inventories from the published Georgia 2024 family, merge dc560ddc9f44a307b9d402d158fe0b336ae6d338. Its public acquisition descriptor preserves exact original query URLs and body hashes. The original GIS notes are kept as returned, including their field-length limits. The existing producer's separately cited full-document context is preserved as its own companion.

The geometry-source-index.json public acquisition index derives from the retained original geometry receiving manifest. It preserves the eleven original query URLs, response filenames, response byte counts and requested FIDs. It does not invent content hashes for bodies held by the existing native source operation. Attribute-body hashes and the hash of the original receiving metadata are explicit.

## Review definitions and identity

The review-definitions.json file enumerates exact candidate names for every legal record and reviewed source pairs. Each reviewed pair pins the original source kind, integer FID and expected ReachID. The builder fails if a reviewed pair moves to a different original row.

The source identity is the complete ArcGIS service/layer plus FID and ReachID. Stream FID 65 and lake FID 65 are different features. Names are never used as unique keys.

| Relationship | Meaning |
| --- | --- |
| endpoint_text_correspondence | The two original descriptions use corresponding named endpoints; stated wording differences remain visible. |
| publisher_explicit_alias | The source itself declares the alternative waterbody name. |
| named_waterbody_component | A named lake or beach supplies one geographic component of the legal description. |
| partial_boundary_chain | A source interval supplies part of a stated chain or interval. |
| boundary_review | Matching waterbody/use or one endpoint leaves a material boundary question. |
| uses_difference_review | Original assessment Uses omit a component of the legal record; both remain unchanged. |
| exact_name_candidate | A deliberately enumerated exact name is a review candidate, without a reviewed relationship. |

No class automatically assigns the legal designation to an entire original assessment geometry. The register and every selection keep legal_geometry_assignment false. The maintained GIS receiver can show the original geometry and original legal text together, while the exact source boundary remains reviewable.

The assessment row's Assessment, Category, Cause, Notes, Uses, Size and SizeUnit remain original. Use-component comparisons use the original legal parser's components and the assessment publisher's comma-delimited Uses. Additional Fishing is retained, not removed to manufacture equality. Mixed assessment categories describe the original assessment row, not every legal use separately. No observed concentration or monitoring event is derived from a listing field.

## Rebuild from the originals

From this directory:

    node rebuild.mjs --check

This hashes all input files, reconstructs all source relationships and compares each existing generated output byte for byte. No network or GIS environment is needed.

To retain the same derivation in a new output directory:

    node rebuild.mjs --output /actual/new/ga-designation-source-review

The writer publishes complete UTF-8 outputs through a same-directory temporary file, fsync and immutable link. Existing identical output is reused; differing output is rejected. The pure build-relationships.mjs module can also be called from the maintained application.

The source derivation was executed against all original records in the available JavaScript runtime. Native geographic intersection and actual browser pixels belong to the existing source and browser operations.

## Maintained application integration

Import the application-root ga_designation_assessment_relationships.sources.json through the original Workspace source import. It contains a Scientific Reports OBSERVED_CONTEXT document, the complete relationship register, both usable CSVs and the exact geometry selection. Every original source and builder is retained as a companion with explicit byte counts and SHA-256.

The additive component fragment preserves the full family in the maintained water_source_review catalogue. The original SC/NC/GA classified-water registry and Georgia assessment geography source remain their existing separate sources.

The Scientific Reports document contains the complete thirty-reach interpretation table and principal source distinctions. For full original-field inspection, open the standalone briefing or register. Search filters the displayed legal records; the legal-row CSV follows that selection. The all-pairs CSV and complete JSON downloads always retain their named complete scopes. Printing uses the visible legal records and retains full descriptions and relationship qualifications.

## Primary sources

- Georgia water-quality standard: https://epd.georgia.gov/document/document/georgia-water-quality-standardsaug-2022pdf/download
- EPD assessment publication: https://epd.georgia.gov/water-quality-georgia
- Stream/beach service: https://services1.arcgis.com/p0dLjwtOaJHU8zq2/arcgis/rest/services/GA_2024_305b303d_StreamsBeaches_xmlalt/FeatureServer/0
- Lake/sound service: https://services1.arcgis.com/p0dLjwtOaJHU8zq2/arcgis/rest/services/GA_2024_305(b)303(d)_Lakes_and_Sounds/FeatureServer/0
