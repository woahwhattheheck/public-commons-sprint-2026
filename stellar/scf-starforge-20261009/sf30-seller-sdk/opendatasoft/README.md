# Huwise / Opendatasoft data workspace

A complete source, research, merchant and customer workflow for Huwise Explore API v2.1 portals, built on the maintained Stellar Forge dataset publisher, seller release and buyer.

Start from a public or authorized portal. Browse its catalog and schema, preview an ODSQL query, retain the complete original export, review rows and facets, save notes, compare refreshes, and hand over JSON, CSV, GeoJSON or an offline HTML report. Select the fields for a data product, review its native dataset candidate, publish it, and export a working merchant package. The same package supplies the original seller release and customer offer.

The browser is a plain grayscale operator application. It uses the same persisted project and commands as the CLI.

## Install and open a project

Use Linux, Node 24 or later, Python 3.11 or later, npm and flock with the original Starforge distribution. This provider adds no package dependency. Start from the supplied merchant archive containing the opendatasoft command and its complete archive SHA-256.

Keep the installation and the project in separate directories under an existing private absolute parent:

~~~sh
umask 077
mkdir /absolute/private/ods-toolkit
cd /absolute/private/ods-toolkit
npm install --ignore-scripts --offline --omit=optional /absolute/private/original-merchant.tgz

npx --no-install starforge runtime-install prepare \
  --dir /absolute/private/ods-runtime \
  --archive /absolute/private/original-merchant.tgz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --native --operator
npx --no-install starforge runtime-install install \
  --dir /absolute/private/ods-runtime

export ODS_INSTALL=/absolute/private/ods-runtime
ods() {
  npx --no-install starforge runtime-install run --dir "$ODS_INSTALL" -- opendatasoft "$@"
}
ods --help
ods init --project /absolute/private/ods-project \
  --origin https://public.opendatasoft.com
ods serve --project /absolute/private/ods-project --port 0
~~~

Open the local URL printed by serve. The project stays on the chosen portal. For an authorized private portal, add an environment-variable name with --auth-token-env during init and supply its value through the existing server credential setup. The server sends that credential in the provider's Authorization header.

The original [runtime installer](../../distribution/RUNTIME_INSTALL.md) supports the configured npm registry/cache, offline dependency installation and same-directory resume. In a complete source checkout with its matching native dependencies, use the absolute Node entrypoint:

~~~sh
node stellar/scf-starforge-20261009/sf30-seller-sdk/opendatasoft/cli.mjs --help
~~~

The distribution also accepts huwise as an alias. Both names operate the same project.

[WORKSPACE.md](workspace/WORKSPACE.md) gives the complete browser journey. [MERCHANT.md](MERCHANT.md) explains source selection, the native publisher, merchant deployment, customer configuration and receiving.

## Catalog, schema and complete capture

A saved project exposes the current portal catalog:

~~~sh
ods search --project /absolute/private/ods-project
ods dataset --project /absolute/private/ods-project \
  --dataset open-data-sources
~~~

Pass a JSON query object to search or records with --input. Explore queries retain the provider's own names: where, select, group_by, order_by, refine, exclude, limit, offset, lang and timezone, as appropriate for the selected endpoint. Catalog search and record preview expose their actual page information.

The records command is an interactive preview. Complete source acquisition uses the native JSON export endpoint. A source selection for the public example is:

~~~json
{
  "datasetId": "open-data-sources",
  "lang": "en",
  "timezone": "UTC"
}
~~~

Save it privately as selection.json, then run:

~~~sh
ods capture --project /absolute/private/ods-project \
  --input /absolute/private/selection.json
ods status --project /absolute/private/ods-project
~~~

The completed operation returns its edition ID and retained source identity. The capture preserves the dataset metadata before and after the full export, original response bytes, fields, provider counts, request URLs, response hashes, rights and available source clocks. A filtered source selection also retains the provider count queries needed to describe that selection. No record preview page is substituted for a complete export.

Source captures preserve all original fields. ODSQL computed columns and aggregates are available in records previews; field projection for a merchant is reviewed against the retained original edition.

For standalone acquisition, use capture-source with a selection that also includes catalogOrigin and a new private output directory. For a completed provider operation, use import-responses with the original saved responses and their original request metadata. That importer retains the acquired bytes. The exact input contract and 0700 directory / 0600 file requirements are in [MERCHANT.md](MERCHANT.md).

An interrupted capture resumes under its same edition ID. A fresh capture creates a new edition for comparison. Adjustable capture limits can be supplied in a limits JSON object to resume, or through --limits for standalone capture/import commands; source completeness is evaluated independently of those transport settings.

## Review the retained edition

The CLI and browser read the same original rows:

~~~sh
ods edition --project /absolute/private/ods-project --id EDITION_ID
ods rows --project /absolute/private/ods-project \
  --id EDITION_ID --offset 0 --limit 100
ods facets --project /absolute/private/ods-project \
  --id EDITION_ID --field country --limit 50
ods facets --project /absolute/private/ods-project \
  --id EDITION_ID --field thematic --mode members --limit 50
~~~

Value facets count each original value. Member facets expand the actual array members. Every result carries the total, displayed range and continuation or completeness information.

Notes bind to the edition's actual manifest SHA-256 and current notes revision. A notes file contains:

~~~json
{
  "expectedCaptureSha256": "ACTUAL_CAPTURE_SHA256",
  "expectedRevision": 0,
  "text": "Purpose, scope and analyst observations for this edition.",
  "rowNotes": [
    {
      "rowIndex": 0,
      "text": "A note about the original row at this position."
    }
  ]
}
~~~

Use the actual current revision shown by edition, and the original zero-based row index:

~~~sh
ods notes --project /absolute/private/ods-project \
  --id EDITION_ID --input /absolute/private/notes.json
ods compare --project /absolute/private/ods-project \
  --before FIRST_EDITION_ID --after REFRESH_EDITION_ID --key url
~~~

Comparison requires a complete, non-null, unique key within both selected editions. It reports added, removed, changed and unchanged rows and any field change. The source's declared identity fields and observed uniqueness are available with the captured metadata.

Export the retained research in the format the recipient needs:

~~~sh
ods export-edition --project /absolute/private/ods-project \
  --id EDITION_ID --format json --out /absolute/private/edition.json
ods export-edition --project /absolute/private/ods-project \
  --id EDITION_ID --format csv --out /absolute/private/edition.csv
ods export-edition --project /absolute/private/ods-project \
  --id EDITION_ID --format geojson --geometry-field location \
  --out /absolute/private/edition.geojson
ods export-edition --project /absolute/private/ods-project \
  --id EDITION_ID --format html --out /absolute/private/edition.html
~~~

Each CLI export creates a new file. JSON and the offline HTML report retain the source context and notes. GeoJSON retains accompanying source context and reports geometry conversion outcomes. CSV encodes original cell values as JSON text so nulls, empty strings, arrays and objects remain distinguishable; the other formats carry the complete accompanying metadata.

## Publish and operate the merchant

Select explicit column aliases, source fields, scalar types, nullability and any JSON/text encoding. The native publisher extracts that reviewed projection, exposes the candidate for query inspection, and binds review to its candidate digest.

The command sequence is:

~~~sh
ods select --project /absolute/private/ods-project \
  --id EDITION_ID --input /absolute/private/source-selection.json
ods prepare --project /absolute/private/ods-project \
  --id SOURCE_ID --input /absolute/private/dataset-policy.json
ods inspect --project /absolute/private/ods-project --id PUBLICATION_ID
ods review --project /absolute/private/ods-project \
  --id PUBLICATION_ID --input /absolute/private/review.json
ods publish --project /absolute/private/ods-project \
  --id PUBLICATION_ID --review-id REVIEW_ID
ods export --project /absolute/private/ods-project \
  --id PUBLICATION_ID --input /absolute/private/merchant.json
ods stage --project /absolute/private/ods-project \
  --id EXPORT_ID --input /absolute/private/release.json
~~~

The merchant input binds the reviewed candidate to the intended HTTPS resource and actual selected payment terms. The release input carries the retained merchant-package digest and original runtime options. [MERCHANT.md](MERCHANT.md) supplies each complete JSON input and the original release activation/start commands.

The package includes the selected dataset, retained source metadata, OpenAPI, route bindings and native handlers. The original SF82 release store copies the package before staging. Its generated client and original SF88 preparation use the selected offer and dataset snapshot.

The published dataset uses the original dataset query language. For example, a configured country filter is where_country=United%20States, while the upstream Explore service uses its own ODSQL where expression. Read the generated offer's advertised parameters when preparing a customer request.

Load the actual running seller offer and prepare the chosen request:

~~~sh
ods offer --project /absolute/private/ods-project \
  --id EXPORT_ID --input /absolute/private/offer.json
ods buyer --project /absolute/private/ods-project \
  --id EXPORT_ID --input /absolute/private/buyer.json
~~~

The resulting file is an original SF88 buyer configuration. Continue through the same installed runtime's buyer commands and existing operator, spending policy and receiving workspace. Buyer preparation binds the chosen payment alternative, advertised offer digest, resource, snapshot, query and intent ID. Use the original page continuation for a multipage result.

## Receiving and recovery

A colleague can import a complete capture into a project on the same portal using import --capture /absolute/private/capture/capture.json. The capture directory contains the manifest and every referenced original response. The receiving project retains its own copy and recognizes an already imported identical capture.

Research reports are portable files with the selected source context and saved observations. The offline HTML report opens directly in a browser. A deployed merchant receives the complete exported merchant directory and stages it through the same original release store. An already prepared customer request continues in its existing SF88 operator workspace.

Project state is persisted after each operation. status and edition recover the retained selection; resume continues an interrupted source capture; recover reconciles an existing publication before another publish is attempted. Existing seller releases and customer purchases use their maintained release and buyer recovery commands.

## First operated source

The initial application was operated on the actual public Open Data Inception dataset, UID da_t0o52c, acquired on 11 October 2026. That complete export contained 3,763 rows and 18 fields, with unique nonempty URL identities. Opening and closing metadata matched. The full export SHA-256 was 7e12a21454318b3df990f9bc1d7fad3457bcef4acd31e3bd38507a90ad961d7e.

The provider declared Public domain and supplied the attribution Made with Natural Earth. The original field values remain intact: latitude and longitude are text in this dataset, thematic contains arrays despite its text field declaration, and has_issue contains source-supplied text and nulls. The native published projection therefore explicitly declares JSON encoding for location and thematic and retains the remaining fields as their original text.

Use the metadata and values returned by each new capture for its own count, identity, field types and source conditions.

## Source and public module entrypoints

Official contracts:

- [Huwise Explore API v2.1 reference](https://help.opendatasoft.com/apis/ods-explore-v2/)
- [Public portal OpenAPI](https://public.opendatasoft.com/api/explore/v2.1/swagger.json)
- [Original dataset metadata](https://public.opendatasoft.com/api/explore/v2.1/catalog/datasets/open-data-sources)

The distribution exposes ./seller/opendatasoft, /capture, /declaration, /workspace, /workspace/model, /publisher and /publisher/release. The complete workbench API is openOpendatasoftWorkbench; the local browser entry is startOpendatasoftServer. They delegate publication, release and buyer work to the maintained original modules.
