# Earth Search source, access and rights contract

This guide supports the original STAC product under `sf30-seller-sdk/stac/`. It records first-party requirements checked on 11 October 2026. The provider workspace owns the actual catalog, collection, query, item and asset captures. The merchant and receiving application consume those retained editions.

## Keep the selected catalog version

The current [Element 84 README](https://github.com/Element84/earth-search/blob/main/README.md) documents the public v1 API and a v2 beta. Use the exact endpoint, STAC version, extension URLs and collection identifiers returned by the selected catalog.

The [Sentinel-2 collection notes](https://github.com/Element84/earth-search/blob/main/docs/collections/sentinel-2-l2a.md) distinguish these products:

| API | Collection | Published meaning |
| --- | --- | --- |
| v1 | `sentinel-2-l2a` | Original JPEG 2000 and COG assets across processing baselines |
| v1 | `sentinel-2-c1-l2a` | Collection 1 COGs processed to baseline 5.0 or later |
| v2 beta | `sentinel-2-l2a` | Collection 1 data replacing v1 `sentinel-2-c1-l2a` |

The same item ID can exist under these different catalog/collection contexts. Version 2 advances STAC and several extensions, changes storage metadata, and removes some v1 asset/link fields. A receiving record therefore needs the original catalog URL and collection along with its item ID and captured item bytes.

## Access is a property of the selected asset

Element 84 describes public assets with HTTPS hrefs and requester-pays assets with S3 hrefs. Preserve the original asset href and its actual storage fields; a data license and a storage-access charge answer different questions.

[Storage extension v1.0.0](https://github.com/stac-extensions/storage/blob/v1.0.0/README.md) allows `storage:platform`, `storage:region`, `storage:requester_pays` and `storage:tier` in item properties and assets. Asset-specific values must remain attached to that asset. The extension defines a false default for requester-pays; retain the declared extension and the original metadata when interpreting that default.

[Storage extension v2.0.0](https://github.com/stac-extensions/storage) instead declares `storage:schemes` and associates assets/links through `storage:refs`. Each referenced scheme can declare `type`, `platform`, `region` and `requester_pays`. Read the version selected by the source. Preserve scheme references in a portable catalog.

[AWS Requester Pays documentation](https://docs.aws.amazon.com/AmazonS3/latest/userguide/RequesterPaysBuckets.html) requires authenticated requests and explicit acceptance of request/download charges. Anonymous access is unavailable for a requester-pays bucket. Credentials and the payer account belong to the operator's configured source connection. A public asset operation can use the actual public href; a requester-pays acquisition uses its selected official source connection and payer configuration.

### First-party dataset access map

This map supplies context for reviewing the actual item. The retained asset's href, metadata, version and successful response remain the operation's source record.

| Dataset/source | Registry access contract | Source |
| --- | --- | --- |
| Sentinel-2 Collection 1 COGs | `e84-earth-search-sentinel-data`, `us-west-2`; public COG distribution | [Sentinel-2 COG registry](https://registry.opendata.aws/sentinel-2-l2a-cogs/) |
| Sentinel-2 L1C | `sentinel-s2-l1c`, `eu-central-1`; requester-pays | [Sentinel-2 registry](https://registry.opendata.aws/sentinel-2/) |
| Sentinel-2 L2A source | `sentinel-s2-l2a`, `eu-central-1`; registry currently lists unsigned public access | [Sentinel-2 registry](https://registry.opendata.aws/sentinel-2/) |
| Sentinel-2 zipped source products | L1C/L2A zip buckets are requester-pays and declare three-day retention | [Sentinel-2 registry](https://registry.opendata.aws/sentinel-2/) |
| Sentinel-1 GRD | `sentinel-s1-l1c`, `eu-central-1`; registry lists unsigned public access | [Sentinel-1 registry](https://registry.opendata.aws/sentinel-1/) |
| Landsat Collection 2 | `usgs-landsat/collection02/`, `us-west-2`; requester-pays | [USGS Landsat registry](https://registry.opendata.aws/usgs-landsat/) |
| NAIP | Analytic, source and visualization products use requester-pays buckets; representations differ | [NAIP registry](https://registry.opendata.aws/naip/) |
| Copernicus GLO-30 Public / GLO-90 | `copernicus-dem-30m` and `copernicus-dem-90m`, `eu-central-1`; unsigned public access | [Copernicus DEM registry](https://registry.opendata.aws/copernicus-dem/) |

## Carry the rights into the acquired product

Retain the collection's complete `license` value and license links, source/provider attribution, the original item/asset metadata, and any asset-specific rights with the selected edition. Display these in review and include them in the offline receiving package.

### Sentinel imagery

The [European Commission Sentinel legal notice](https://sentinels.copernicus.eu/documents/247904/690755/Sentinel_Data_Legal_Notice) permits lawful reproduction, distribution, adaptation and combination and requires source acknowledgement when distributing or communicating the data. The notice supplies:

- Original data: **Copernicus Sentinel data [Year]**
- Adapted data: **Contains modified Copernicus Sentinel data [Year]**

Use the relevant source year and preserve the notice link. Keep a transformation record when producing derived imagery. [The current Copernicus Sentinel-2 page](https://dataspace.copernicus.eu/data-collections/copernicus-sentinel-missions/sentinel-2) expressly includes commercial users. The [Copernicus portal terms](https://dataspace.copernicus.eu/terms-and-conditions) separately discuss other website content; retain the actual data product and its license association.

### Landsat

The [USGS-managed registry](https://registry.opendata.aws/usgs-landsat/) allows Landsat data to be used and redistributed and requests a data-source statement. The receiving output should include its USGS source links, original item identity and retained source attribution. Requester-pays storage access remains a separate acquisition decision.

### NAIP

The [NAIP registry](https://registry.opendata.aws/naip/) labels the product “Public Domain with Attribution.” Carry that source label, its dataset citation and the original asset/product metadata. Its source GeoTIFF, analytic and visualization representations have different band/compression characteristics; a three-band visualization file is a different selected product from a four-band analytical source.

### Copernicus DEM

The [Copernicus DEM collection page](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM) publishes GLO-30/GLO-90 license and citation guidance. Preserve the relevant full source notice and its original/modified distinction in the selected collection's rights. The data is a digital surface model including vegetation and structures. Its sensing time, release, public tile availability and retained provider version should remain distinct in comparisons.

## Product behavior grounded in collection semantics

### Immutable editions for scenes that are reprocessed

The [Landsat collection notes](https://github.com/Element84/earth-search/blob/main/docs/collections/landsat-c2-l2.md) explain that Earth Search omits the processing date from its scene ID. Reprocessing can replace the associated data while retaining the scene ID; some older catalog records can contain unavailable asset links. An immutable acquired edition therefore retains the full original item, selected href, acquired bytes and content hash. Source refresh creates a new edition and can report changed assets under an existing scene identity.

The combined Landsat collection merges optical surface reflectance and thermal surface temperature. Some items have optical data only. Offer thermal actions from the original `instruments` and actual asset set.

### Keep numerical transformations explicit

Sentinel processing baselines can require a scale and offset. Element 84's collection notes direct consumers to the asset's `raster:bands` fields: a nonzero offset is applied after scaling for numerical use. An unchanged asset download keeps its source bytes. A derived calculation records the chosen bands, scale/offset and transformation separately.

### Separate acquisition time from product year

The [NAIP collection notes](https://github.com/Element84/earth-search/blob/main/docs/collections/naip.md) explain that delayed collection can make acquisition `datetime` differ from the nominal NAIP year. Use `naip:year` and `naip:state` for a year/state request and retain the source acquisition time independently.

### Preserve original geometry

Keep the original GeoJSON geometry, bounding box and projection metadata. A spatial selection, a scene footprint and a downloaded raster's native projection are different fields in the same receiving record. Element 84's documented catalog gaps include antimeridian scenes; completeness claims should describe the actual returned query pages.

## Customer receiving and merchant join

The complete customer handoff should contain:

1. The retained query and selected catalog/collection versions.
2. Original collection, item and selected asset metadata with source rights and access classification.
3. The operator's scene selection and notes, and the exact comparison between retained editions.
4. Each acquired file's original identity, content type, filename, complete length and content hash.
5. The original seller release and native customer acquisition/delivery association.
6. An offline catalog/GeoJSON index and an operator guide that open the same acquired files without another provider query.

Use original SF30 asset routes for a retained complete file within their documented capacity. For an object represented by native chunk delivery, preserve each actual range and the whole-object identity through the original SF88 acquisition and assembly. The merchant price is the configured delivery/service price; it does not change the upstream data license or the asset's underlying storage-access terms.

## Commercial fit

[FilmDrop](https://element84.com/filmdrop/) covers data ingest, archive, processing, analysis and distribution, including custom products and domain-specific interfaces. [Element 84's Geospatial Scaling Support](https://element84.com/solutions/geospatial-scaling-support/) includes implementation, technical training, documentation and customer ownership of deployed systems. A complementary workshare can supply the customer-facing selection-to-receiving application and a defined adaptation to an existing FilmDrop catalog, while Element 84 owns the broader platform architecture and client relationship.

The official general business route is **info@element84.com**, published on [Element 84's contact page](https://element84.com/who-we-are/contact-us/). The source registry additionally publishes **opendata@element84.com** for dataset contact. Use the business route for a commercial workshare and preserve one coordinated company conversation.
