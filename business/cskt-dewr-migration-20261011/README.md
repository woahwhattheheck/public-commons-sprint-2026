# CSKT DEWR content and GIS migration workspace

A complete source-review and WordPress delivery product extending the original CSKT preflight. It connects the published WordPress inventory to named editorial revisions, document versions, original ArcGIS resources, immutable migration releases and native destination recovery.

The project is grounded in the [CSKT DEWR website RFP](https://csktwatercompact.com/wp-content/uploads/2026/10/DEWR_Website_RFP_Final.pdf) and the [original procurement page](https://csktwatercompact.com/documents-and-links/). The RFP permits a recommended CMS. This implementation retains WordPress and provides the content/GIS migration arm described in `commercial/WORKSHARE.md`.

## Product

- **Source intake:** complete original WordPress pages, posts and public media records, paginated provider totals, source identities, retained source versions and changed/absent-source review.
- **Staff review:** named administrator, reviewer and editor roles; side-by-side original content and draft; retain, revise, archive, remove and consolidate dispositions; version history and individual or batch review.
- **Documents:** original file and media identities, download metadata, version labels, shared document families, category search and editorial history.
- **GIS:** original published ArcGIS item and app records, source-page lineage, native map/layer information, published-resource selection and a reviewed text equivalent for each attached map.
- **Releases:** exact approved revisions, source capture identities, named reviewer decisions, destination paths and validated 301/410 routes.
- **WordPress delivery:** native destination preview, original target bindings, per-item journal, actual media transfer, apply/readback and rollback that preserves later staff edits. Native WordPress content controls let staff select document files and edit version details, map descriptions, notices and archive status.
- **Operations:** grayscale responsive UI, stable request recovery, operating export, native SQLite backup/restore and complete staff and destination guides.

The application runs on Node.js 24 or later and uses built-in HTTP, SQLite, cryptography and compression. Its `package.json` has no external application dependencies. The included destination plugin extends the selected WordPress CMS.

## Start

Prepare a private password file and source capture, then:

```bash
node cli.mjs user --database /private/dewr/workspace.sqlite --id migration-admin --name "Migration Administrator" --role admin --password-file /private/dewr/admin-password
node cli.mjs import --database /private/dewr/workspace.sqlite --actor migration-admin --input /private/dewr-source/corpus.json
node cli.mjs serve --database /private/dewr/workspace.sqlite --sources /private/dewr-source --host 127.0.0.1 --port 33219
```

Open the reported URL, sign in, review content and prepare the first release. [OPERATIONS.md](OPERATIONS.md) covers the complete source-to-destination workflow, production origin configuration, staff access, file versions, GIS review and recovery. [source/CONTRACT.md](source/CONTRACT.md) describes the repeatable capture and original response contracts. [destination/DEPLOYMENT.md](destination/DEPLOYMENT.md) covers the native WordPress installation and delivery commands.

## Original source basis

The October 11, 2026 public capture contains 33 WordPress pages, no posts and 353 unique public media objects. The media breakdown is 130 PDFs, three DOCX files, two ZIP files, 201 images and 17 videos. Both ascending ID-only and descending full-record pagination returned the same 353 IDs; the provider reports 359 in its header. The source catalog preserves both values and the complete observed records.

The original site references three accessible StoryMaps and a legacy MapSeries app whose native provider returns an error. The working source bundle includes the original app outcomes and actual Jocko WebMap/FeatureServer metadata so content review can use the existing resources and real project layers.

The maintained source package includes the capture implementation, contracts, URL/hash catalog and RFP requirement mapping. Run the capture into a private source directory for the full original page, GIS and media records. Keep that directory with the working database and the selected original asset files.

## Maintained source

| Path | Purpose |
| --- | --- |
| `cli.mjs`, `src/` | Authenticated service, original source/revision store, review and release operations, CLI and backup/restore. |
| `public/` | Responsive staff review, document, GIS, release and operating screens. |
| `destination/` | Native WordPress plugin, transport, media transfer, preview, apply, readback and rollback. |
| `source/` | Repeatable capture, native contracts, RFP mapping and original source lineage. |
| `commercial/` | Ten-day priced migration workshare, acceptance sequence and proposal. |
| `capture-source.py`, `assemble-source.py` | Original provider capture and verified corpus assembly. |
| `package-source.py` | Reproducible source delivery with an explicit file list and per-file hashes. |
| `preflight.mjs`, `observed-public-content.json`, `preflight-report.json` | Original seven-resource preflight preserved as the initial source history. |

The original preflight was introduced in PR 676 at commit `9e66ce5a090d0c2fb60d5af2730cfcea08562c6f`. The source lineage file identifies the exact original Git blobs used for this implementation. Current content review, release and delivery use the complete operating product above.

## Commercial delivery

The prepared workshare covers one WordPress source and destination, up to 40 source pages, 400 media/document records and four GIS app references, with two correction cycles, training and operating handover. The fixed implementation fee is $8,400 over ten business days, with a 30-day implementation warranty. The complete scope, acceptance and optional ongoing care appear in `commercial/`.

## Export the maintained delivery

Build the receiving team’s ZIP from this maintained directory:

```bash
python3 package-source.py --output /private/delivery/CSKT_DEWR_Migration_Workspace.zip --commit GIT_COMMIT_SHA
```

Replace `GIT_COMMIT_SHA` with the complete commit containing the selected source. The archive contains the application, WordPress plugin, capture tools and public source catalogs, staff and destination guides, priced workshare and proposal. Its `DELIVERY.json` records the selected source files and their SHA-256 values. Capture the original site into the private source directory described in `source/CONTRACT.md`, then import that corpus into the receiving workspace.
