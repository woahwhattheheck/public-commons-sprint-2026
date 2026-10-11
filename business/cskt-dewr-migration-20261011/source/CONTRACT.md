# CSKT DEWR original source contract

## Frozen capture

This is the October 11, 2026 public source capture for the CSKT Department of Engineering and Water Resources migration workspace. `corpus.json` is 2,527,294 bytes, SHA256 `5855e0db92f53e822109c2e7bdc396e76f355482f31d829f982c3fe6b34f4318`. Original HTTP response bytes, URLs, response status, content type, retrieval time, byte count and SHA256 are retained in the source indexes. The corpus adds an importable view; it does not replace those original responses.

The captured site is https://csktwatercompact.com/ and the native WordPress collection base is https://csktwatercompact.com/wp-json/wp/v2/. The complete observed corpus contains 33 pages, zero posts and 353 distinct media objects: 386 records in total. The media API reports 359 objects, but four descending full-object pages and four independent ascending ID-only pages both return the same 353 IDs. That six-object difference is recorded in capture coverage rather than filled with invented records.

The media inventory contains 130 PDFs, three DOCX files and two ZIP files; 166 JPEGs, 30 PNGs, four WebP images and one HEIC image; 14 QuickTime files and three MP4 files. These are separate source identities even when two selected downloads have identical bytes.

## Import schema and lineage

The schema identifier is `cskt.public-corpus.v1`. `pages`, `posts` and `media` contain the original WordPress JSON objects. Preserve every original `id`, `link`, `slug`, `parent`, `status`, `modified`, `modified_gmt`, rendered or raw title/content/excerpt field, media MIME type, source URL, caption, alt text and `media_details` value. The importer may derive a draft, route, document family or review decision, while the original object remains available unchanged.

`capture` retains collection coverage and the media count reconciliation. `sources` and the source indexes bind each native response to its URL and exact file. `publicHtml` records the 33 public HTML responses; `pageCompleteness` records their measured body comparison. `gis.items` contains the original ArcGIS item/data responses and their file references, while `gis.layers` retains the six native feature responses. `assets` binds selected source media IDs to the exact downloaded response URL, MIME type, file, byte count and hash.

All 33 public page responses returned HTTP 200 and contain the same useful body text as their original REST content. Thirty-two comparisons use the page's observed Elementor ID; the maintenance page uses the observed `#content` template. Optimole may move an embedded source URL to `data-opt-src` and leave `about:blank` in its display slot; the comparison preserves the actual semantic target. No additional builder body is needed: `pageContent` is deliberately empty. `page-completeness.json` retains the exact selectors and fragment/source hashes. The Jocko page (46) and Programs page (2015) therefore import their actual REST bodies directly.

An import is a new source capture, not permission to erase history. The operating store retains each original source version. A changed source requires a new staff draft bound to that source. An item absent from a later complete capture remains visible with its original bytes and an explicit absence review; staff can retain, revise, consolidate, archive or remove it through the normal review workflow. A later return of the source creates another reviewable state. Already reviewed releases continue to reference their frozen source and draft revisions.

## Selected native files

The selected downloads make the media path usable in the native destination workflow:

| WordPress media ID | Retained file | Bytes | SHA256 |
| --- | --- | ---: | --- |
| 2338 | `assets/2338.png` | 53,536 | `cb7fd7484640870030173bd63ff690ea590043a19da0babf3216616d56f8392b` |
| 2662 | `assets/2662.pdf` | 2,483,908 | `f65e8044d3b2da5e52036d1b8443440bbbaa440c0eb18009d6481d1cad3f665c` |
| 2722 | `assets/2722.pdf` | 653,776 | `5a8b45e5593fa9d861ecf33eae394cc5c05428167f9935f00ff1189607f1573a` |
| 2733 | `assets/2733.pdf` | 653,776 | `5a8b45e5593fa9d861ecf33eae394cc5c05428167f9935f00ff1189607f1573a` |
| 2820 | `DEWR_Website_RFP_Final.pdf` | 631,004 | `114afc69be5ecbf9083e29d8023160090a0ec7b2c8b7edf78428e7155fb206e5` |

The 2722 and 2733 downloads are byte-identical PDFs with distinct original IDs and URLs. Consolidation is a recorded staff decision; attachment byte deduplication must preserve both source references.

Image 2338 demonstrates why native file identity matters. WordPress advertises an Optimole display URL, while its observed `media_details.file` identifies the actual original PNG at https://csktwatercompact.com/wp-content/uploads/2025/08/Crow-pump-2.png. The imported draft's `document.sourceUrl` uses the exact selected response URL whenever it adopts that response's hash and size. Its original WordPress object remains unchanged. The destination must fetch that same reviewed URL and compare actual MIME, byte count and hash. PDF preview metadata can advertise a PDF MIME type for a JPEG preview; it is not authority for the downloaded original.

Local redirects use observed same-origin page or attachment paths. For media, an observed safe `media_details.file` can establish its original `/wp-content/uploads/` path. An external CDN path is never turned into an invented local CSKT route.

## Native GIS contract

Seven ArcGIS item/data pairs are retained. Public StoryMaps are North Jocko `2255c33442fd4f349aef25cba515ed78`, Milltown Water Right `d8850066568c4e75a655b6a2381184a1`, and Jocko K `b26fd439e9354905af0704cc95caf484`. Their native graph includes WebMaps `284a8713238c4cc5b04e0edd1b2f99b0`, `1d0bc5fa148041b581b02bea30e91736`, and `fb9517c8438545738caf939596a2011d`.

The existing Water Rights MapSeries iframe refers to `660c29692f474761b1f581b036dc7ad7`. Its actual native item response is HTTP 200 containing ArcGIS error 400 / `CONT_0001` (item missing or inaccessible). Keep that outcome visible for a reviewed replacement or fallback. Do not present it as a working map.

The original North Jocko WebMap names six actual feature-service layers on `services8.arcgis.com/aILNkpfYf3yHpMOY/arcgis/rest/services/`: `Phase1/FeatureServer/0`, `Phase2/FeatureServer/2`, `Phase3/FeatureServer/3`, `Phase4/FeatureServer/4`, `Phase5/FeatureServer/5`, and `Phase6/FeatureServer/54`. Each original count query returned one feature. Layer metadata, count and full geometry responses are retained. The native geometry request uses `where=1=1`, `outFields=*`, `returnGeometry=true`, and `outSR=4326`; do not substitute fabricated geometries or infer new project completion dates from phase names.

A published embedded map needs its original public URL, descriptive title, a useful text fallback and an open-map link. Preserve item IDs and source graph references through preview, release and destination readback. Public access is governed by the source ArcGIS item's actual sharing state.

## Controlling procurement source

`DEWR_Website_RFP_Final.pdf` is the original 17-page RFP. `DEWR_Website_RFP_Final.txt`, `rfp-pages.json` and `requirements.json` provide its text, page mapping and implementation requirements. The official listing is https://csktwatercompact.com/documents-and-links/ and the original PDF is https://csktwatercompact.com/wp-content/uploads/2026/10/DEWR_Website_RFP_Final.pdf. The proposal deadline is October 29, 2026 at 4:30 PM MDT.

Section 5.1 asks for a recommended CMS and its rationale, licenses, maintenance and training; it does not prescribe a vendor. The work includes staff publishing roles and revisions, reviewed content migration and redirects, versioned documents, forms and notices, ArcGIS integration, analytics, independent staff operation and customer-owned accounts/source. Writing, remediation, new media production, extended support and ongoing service costs require explicit scope and pricing. `requirements.json` is the maintained section/page map used by the application and commercial workshare.

## Capture, assembly and preservation

The maintained `capture-source.py` retrieves authorized public responses into a new output directory and indexes their exact bytes. Run its `--help` for selected asset and continuation options. `assemble-source.py` performs no network access: it verifies the indexed original files and produces the native corpus, source links, completeness comparison and capture summary. A normal new capture uses `python3 capture-source.py --output /absolute/new-capture`, followed by `python3 assemble-source.py /absolute/new-capture`. Resume only the same captured directory through the capture tool's explicit `--resume` option.

Keep the frozen original capture intact. The private source bundle contains the RFP, all 33 HTML responses, original WordPress/ArcGIS responses, selected native files and source indexes. Public maintained code carries the capture/assembly tools and URL/hash/requirements/completeness metadata. Working databases, staff accounts and application code are separate from this original source bundle.
