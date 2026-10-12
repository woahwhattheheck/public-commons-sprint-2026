# Research preservation transfers

This operator workflow turns a completed native research edition into a reviewed
BagIt transfer. It keeps the original provider pages, query, coverage and
checksums together with a clear selection of individual JSON metadata records.

The transfer includes the descriptive metadata layout documented for
Archivematica 1.18. Its file paths begin with `data/` inside a bag;
the metadata table is `data/metadata/metadata.csv`. The original
research/OAI intake module performs the source query, cursor, record and
manifest checks. This module adds review revisions, complete transfer packaging,
receiving, and comparisons between transfers.

## Browser workbench and repository destinations

The [research preservation workbench](WORKBENCH.md) provides the complete
browser workflow: source intake, record review, saved revision selection,
destination preparation, original transfer progress, native package downloads,
and portable application/workspace receiving.

```sh
python3 -B research/preservation/workbench.py serve \
  --workspace /absolute/preservation/project --port 8785
```

The workbench reuses this original source/review application. Each saved
destination receives a frozen copy of the selected published review, so a
later catalogue revision can advance independently.

| Destination | Native package and continuation |
| --- | --- |
| Archivematica | This guide: reviewed BagIt transfer with the original source closure |
| RODA | [Package and submission agreement](RODA.md), [REST upload and ingest continuation](RODA_REST.md) |
| Preservica | [OPEX producer and operator workflow](PRESERVICA.md), [deployed provider contract](PRESERVICA_PROVIDER_CONTRACT.md) |

The optional Node wrapper routes the same applications through
`cli.mjs workbench`, `cli.mjs roda`, `cli.mjs roda-client`,
`cli.mjs preservica` and `cli.mjs preservica-client`.
Existing preservation commands remain directly available through the wrapper.

## Start with an existing edition

Requirements: Linux or another Unix platform with `flock`,
Python 3.11 or newer, and the adjacent maintained
`research/oai/oai_feed.py`. The optional Node command wrapper
requires Node 18 or newer. The workflow uses Python's standard library and
performs no provider request.

From an installed source tree:

```sh
python3 -B research/preservation/preservation.py init \
  --source /absolute/native-research-export.zip \
  --prefix source-export \
  --workspace /absolute/preservation/project

python3 -B research/preservation/preservation.py show \
  --workspace /absolute/preservation/project
```

Use the actual export's prefix. Omit `--prefix` when selecting
the native export directory itself. A completed export contains the original
`manifest.json`, query, edition, coverage and all pages.

The source intake recognizes two explicit closures:

| Source | Retained and verified closure |
|---|---|
| Complete native research export | Every member declared by the original native manifest |
| Original `tjl.public-source-example.v1` ZIP | Every member declared by `EXAMPLE_MANIFEST.json`, the complete original ZIP, and every native query/edition/coverage/provider-page member |

For a complete export, initialization compares every declared length and
SHA-256 value. The public example also has an exact ZIP inventory check:
its declaration must contain the unchanged native manifest and the entire
query, edition, coverage and page/request/response closure. Its source profile
lists derived export members that the example intentionally omitted.
The original native manifest remains unchanged.

Both paths rerun the original research preparation on the retained native
source. An existing workspace with the same source, source profile and entered
contact settings reopens as the same project. A missing file in an ordinary
complete export is an error; the explicit example declaration defines the
only additional intake profile.

Optional `--organization` and `--contact`
values become the BagIt sender information. Enter the actual transferring
organization and contact. Leaving them empty omits those optional fields.

## Review the selection and descriptive fields

Initialization creates review revision 0 with all unique original work IDs
selected. The original duplicate-ID checks reject conflicting versions in one
source edition. Source omissions such as a missing author or publication
language remain visible in the receiving report.

Export the current review:

```sh
python3 -B research/preservation/preservation.py review-template \
  --workspace /absolute/preservation/project > review.json
```

The review has this shape:

```json
{
  "schema": "stellar-forge.research-preservation-review.v1",
  "sourceManifestSha256": "COPY_THE_ACTUAL_VALUE_FROM_REVIEW_TEMPLATE",
  "decisions": [
    {
      "identifier": "https://openalex.org/W_COPY_AN_ACTUAL_ID",
      "include": true,
      "fields": {
        "description": ["An explicitly authored local catalogue note."]
      },
      "reason": "Local descriptive note entered by the receiving operator."
    }
  ],
  "note": "Overall review context."
}
```

The identifiers and manifest digest in a saved review must come from the
original source. This illustrative object needs those actual values before it
can be saved.

Each decision may set `include`, replace named descriptive
field arrays, and record the entered reason. The ordinary Dublin Core field
names are used without the `dc.` prefix. An exclusion or
descriptive correction requires its reason. The original OpenAlex identifier
always remains in the resulting identifiers. Title must remain populated.

Payload `rights`, `type`, and
`format` have a fixed meaning: these are CC0
`application/json` metadata datasets. Reported rights or
type for the described article remain separately retained as
`sourceResourceRights` and `sourceWorkType`.
The source record itself remains unchanged.

**Selection is not redaction.** Setting `include:false`
omits that record's standalone JSON object and descriptive CSV row. The complete
original edition, including that record, remains inside submission
documentation so the receiving institution can reproduce the selection and
verify the source. Use this profile for editions that the institution is
entitled to preserve in full.

Save the review using the revision returned by `show`:

```sh
python3 -B research/preservation/preservation.py review-save \
  --workspace /absolute/preservation/project \
  --input review.json --expected-revision 0
```

A save produces a new immutable review member and atomically updates the current
pointer under the original workspace lock. Repeating the same normalized review
reopens its saved revision. A different review at a stale expected revision
returns `STALE_REVISION`; reload the current review and compose
the intended changes before saving it.

If a process stops after writing the immutable review but before updating the
pointer, repeating the original input and expected revision reuses that
matching member. Original source files and earlier review members stay intact.

## Build the complete transfer

Use the saved revision explicitly:

```sh
python3 -B research/preservation/preservation.py build \
  --workspace /absolute/preservation/project \
  --expected-revision 1 \
  --output /absolute/delivery/research-transfer.zip --zip
```

Omit `--zip` to publish an unzipped bag directory.
Building into an existing output first verifies that output. Matching source,
review and profile reopen it; a different transfer is a conflict.

The versioned BagIt identifier is derived from the source manifest, the complete
immutable review-revision record, frozen sender fields and profile. A separate
Bag-Group-Identifier joins transfers from the same original source edition.
Returning from review A to B and back to A creates a new transfer identity while
preserving the original collection relationship. The metadata table has repeated Dublin Core columns for repeated
values. It uses literal UTF-8 source values, which preserves the receiving
metadata semantics. The separate human spreadsheet review protects formula-like
cell starts; it is an operator worksheet, separate from the Archivematica
import CSV.

### Transfer members

| Member | Purpose |
|---|---|
| `bagit.txt` | BagIt 1.0 declaration and UTF-8 encoding |
| `bag-info.txt` | Transfer identity, date, optional sender, exact payload octets and file count |
| `manifest-sha256.txt`, `manifest-sha512.txt` | Complete payload checksum inventories |
| `tagmanifest-sha256.txt`, `tagmanifest-sha512.txt` | Checksums for both payload manifests and the other tag files |
| `data/records/W….json` | Selected original metadata objects, canonicalized with the original mapper and checked against original record digests |
| `data/metadata/metadata.csv` | File-level descriptive metadata using the documented bag paths |
| `data/metadata/review.html` | Searchable receiving report with source, selection and entered review context |
| `data/metadata/submissionDocumentation/native-export/` | The selected complete native closure and its unchanged original manifest |
| `…/source-example.zip` | The complete, byte-identical original example carrier when its explicit profile is selected |
| `…/profile.json` | Transfer identity, source profile, original example hashes and declared derived omissions |
| `…/source-binding.json` | Original edition, query, page and request identities |
| `…/review.json` | Saved review revision, content and digest |
| `…/mapping.json` | Original descriptive values, reviewed values, source and decisions per work |
| `…/reconciliation.json` | Selected/excluded identifiers and complete count reconciliation |
| `…/records-review.csv` | Human spreadsheet review |

Payload originals are metadata records. Downloaded paper full text is a
different acquisition and rights workflow.

## Receive and reopen

Run both full transfer checks and native source reconstruction:

```sh
python3 -B research/preservation/preservation.py verify \
  --source /absolute/delivery/research-transfer.zip

python3 -B research/preservation/preservation.py receive \
  --source /absolute/delivery/research-transfer.zip \
  --output /absolute/receiving/research-transfer

python3 -B research/preservation/preservation.py verify \
  --source /absolute/receiving/research-transfer
```

The verifier checks both payload manifests, both tag manifests, exact inventories
and the Payload-Oxum. For the source-only example it independently opens the
retained original carrier, verifies its whole inventory and checksums, and
rederives the same source profile before accepting the transfer identity. It also verifies the original research pages and request
chain, reconstructs the review mapping, and compares the actual metadata CSV,
human report, selected raw records and reconciliation. The receiver publishes
its complete verified directory atomically. Repeating a receive adopts the same
verified output.

Unsafe paths, duplicate ZIP members, symlinks, inconsistent source identities
and mismatched checksums are rejected before a receiving directory is published.
The initial profile allows up to 64 MiB per source member and 2 GiB per transfer.

For independent BagIt validation, the Library of Congress implementation
supports the same bag directory:

```sh
python3 -m pip install "bagit==1.9.0"
python3 -c "import bagit; bagit.Bag('/absolute/receiving/research-transfer').validate(processes=1)"
```

Use an existing institution-managed environment when that package is already
installed. This repository's native example exercise records the exact upstream
implementation and its observed result.

### In the receiving Archivematica installation

1. Select the bag as an unzipped or zipped BagIt transfer.
2. Keep `data/metadata/metadata.csv` and submission
   documentation in the original bag layout. Editing them after bagging changes
   the payload checksums; save a new review and rebuild for a revised transfer.
3. Choose the institution's normal processing configuration. Confirm the
   expected metadata on selected objects in the transfer/SIP review.
4. Retain the resulting transfer, SIP, AIP and storage identifiers with the bag
   ID, source manifest digest and review digest. That installation owns the
   preservation processing and storage outcomes.
5. Record the operator's validation, ingest and access checks in the institution's
   receiving system.

The public example runner covers creation, both manifests, the upstream BagIt
validator, review, reopen and transfer comparison. It writes its actual result
to receiving-result.json when the complete receiving journey finishes. The institution-specific
processing configuration, its preservation services and final AIP storage are
the receiving implementation workshare.

## Compare editions or reviews

```sh
python3 -B research/preservation/preservation.py compare \
  --previous /absolute/delivery/prior-transfer.zip \
  --current /absolute/delivery/current-transfer.zip > transfer-comparison.json
```

Comparison distinguishes source additions, source absence, changed original
records, selection changes, descriptive changes and review changes. Original
identifiers join the two transfers. A work that disappears from a later source
query is reported as source-absent; the receiving institution decides the
retention or access action for its existing preserved object.

A later provider edition should initialize its own source-bound workspace.
A later review of the same edition stays in that edition's existing workspace.

## Reproduce the public example

The adjacent OAI example includes the exact public 169-work source edition:

```sh
python3 -c "import base64,pathlib; p=pathlib.Path('research/oai/example/OpenAlex_CIIM_Source_Example_20261012.zip.b64.txt'); p.with_name(p.name.removesuffix('.b64.txt')).write_bytes(base64.b64decode(p.read_text()))"
python3 -B research/preservation/preservation.py init \
  --source research/oai/example/OpenAlex_CIIM_Source_Example_20261012.zip \
  --prefix source-export --workspace /absolute/public-example
python3 -B research/preservation/preservation.py build \
  --workspace /absolute/public-example --expected-revision 0 \
  --output /absolute/public-example-transfer.zip --zip
```

The decoded source example is 145,901 bytes, SHA-256
`948c5c85a3ec88cf26ab9bae2ebcda284ea429dfa3c8240ac2565e30b278f77b`.
It contains the original two provider pages and 169 unique work IDs from the
retained public Directory of Open Access Journals research query. Its explicit
example declaration names all 14 members plus the declaration itself. The
10 native source members include the unchanged full manifest; 27 derived
entries listed by that manifest lie outside this source-only example. The
transfer retains the whole original example ZIP and records every omitted
derived entry in its source profile. Its identity binds the original archive,
the profile, the saved review revision and entered sender information. The metadata
license is CC0. The accompanying example journey creates a baseline transfer,
records an explicitly authored descriptive note and selection, builds the
reviewed transfer, reopens it and compares the two. It then restores the original selection as a
new immutable revision and verifies that the collection identity stays stable
while the versioned transfer identity changes. A damaged transfer is rejected
before publication.

With the original BagIt 1.9.0 validator available:

```sh
python3 -B research/preservation/examples/run_public_example.py \
  --source research/oai/example/OpenAlex_CIIM_Source_Example_20261012.zip \
  --prefix source-export --out /absolute/preservation-native-receiving
```

The resulting `receiving-result.json` contains the exact product and upstream
validator hashes, source profile, original page binding, all three transfer
receipts, replay/reopen results and damaged-transfer rejection.

## Source and contract references

- [Archivematica 1.18: importing metadata](https://www.archivematica.org/en/docs/archivematica-1.18/user-manual/transfer/import-metadata/),
  especially the BagIt metadata paths and repeated Dublin Core columns.
- [Archivematica 1.18: BagIt transfers](https://www.archivematica.org/en/docs/archivematica-1.18/user-manual/transfer/bags/).
- [RFC 8493: BagIt 1.0](https://datatracker.ietf.org/doc/html/rfc8493),
  sections 2.1–2.4 and complete/valid bag semantics.
- [Library of Congress BagIt Python](https://github.com/LibraryOfCongress/bagit-python),
  [release 1.9.0](https://pypi.org/project/bagit/1.9.0/),
  original release source commit
  `861ddacb339d5b92659f0187a402f501d841abbe`.
- [OpenAlex metadata license](https://docs.openalex.org/download-all-data/openalex-snapshot).
- The adjacent original OAI operator guide documents native query/cursor binding
  and the distinction between metadata and described-resource rights.

## Operate the same reviewed collection in RODA

The [RODA workflow](RODA.md) builds a compatible outer submission package around
this complete original transfer, preserving its original bytes and source paths.
It adds the entered submission agreement, a complete record catalog, repository
upload and ingest operations, original job/report/AIP reconciliation, and whole
application/workspace export and receiving. Use `roda.py` directly or prefix
commands with `roda` through this directory's existing Node wrapper.

## Continue the same reviewed collection in LIBNOVA

The [LIBNOVA workflow](LIBNOVA.md) prepares the complete reviewed BagIt as
an original destination package. Its explicit Dublin Core mapping selects
existing metadata descriptor codes and types. The native client sends the
original objects to the selected existing S3 endpoint, observes their
repository file IDs and metadata, and runs the selected existing Function
once. Final receiving compares the original bytes and mapped metadata,
retains that Function's job and returned assets, and writes the complete
evidence and operator report.

The [browser workbench](WORKBENCH.md#libnova) uses that
same producer and client. Choose a saved review, enter the LIBNOVA mapping
and deployment settings, then prepare a named destination. The original
review, BagIt, configuration and operation ID remain together. Its saved
progress is readable while the client works; a later observation or original
job reconciliation continues that same destination. The final report,
evidence and full editable workspace are available from **Delivery**.

The initial profile supports up to 1,000 included bibliographic records and
1 GiB of original source/export material. The complete native research
example remains the unchanged 169-record CC0 edition described above.
Repository-specific acceptance uses the chosen deployment's existing
container, storage, metadata schema, Function and authorized S3 credentials.

Install the declared dependency in the selected existing Python 3.11 or
later environment before a LIBNOVA S3 operation:

```sh
python3 -m pip install -r research/preservation/libnova-requirements.txt
```

The Workbench, offline package preparation, RODA and Preservica imports
remain available without importing boto3. Only the LIBNOVA receiving path
loads that dependency.

The existing Node wrapper routes the complete producer/client commands:

```sh
node research/preservation/cli.mjs libnova mapping-template
node research/preservation/cli.mjs libnova-client configuration-template

node research/preservation/cli.mjs libnova prepare \
  --bag /absolute/reviewed-transfer.zip \
  --mapping /absolute/libnova-mapping.json \
  --out /absolute/libnova-prepared

node research/preservation/cli.mjs libnova-client plan \
  --workspace /absolute/libnova-prepared \
  --configuration /absolute/libnova-configuration.json \
  --operation-id original-research-transfer

node research/preservation/cli.mjs libnova-client show \
  --workspace /absolute/libnova-prepared \
  --operation-id original-research-transfer
```

Save complete mapping and configuration files from the installed templates
and the agreed deployment's real IDs. Configuration files contain names of
environment variables for secrets. `plan` and `show` make no provider
request; `run` executes the entered original operation. `refresh` performs
read-only provider observation. If an original Function response is lost,
`reconcile` accepts the retained response or its original job ID and verifies
that job's Function, container and folder binding. It never dispatches a
replacement Function. After reconciliation, `refresh` continues final
content and metadata readback.

Use [LIBNOVA_PROVIDER_CONTRACT.md](LIBNOVA_PROVIDER_CONTRACT.md) for the
source-pinned provider behavior, configuration fields, exact evidence
templates and receiving limitations. A complete Workbench export includes
the LIBNOVA producer/client, both guides, dependency declaration, frozen
source, original operation and retained results. The installed **Research
preservation** application keeps the original workspace and the same managed
Python/source checks when opening a LIBNOVA destination.
