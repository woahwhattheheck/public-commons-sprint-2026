# Import original source bundles

A source bundle brings a collection of original files, their source definitions,
and authored findings into one existing research question. One import saves the
retained edition, the source selections and all linked findings in one project
revision. Sources with the same DOI or URL join the existing source group while
their original file content remains attached to its own edition occurrence.

Use this for downloaded datasets with a README, a measured analysis with its
reproduction files, or a document collection accompanied by source notes.
The bundle carries the files themselves, so portable project export and reopen
keep the original material available.

## Import in the browser

1. Open an existing Research project and choose **Import source bundle**.
2. Select the question that should receive the sources.
3. Choose a saved bundle, or choose a source manifest and its original folder.
   In folder mode, only the relative filenames listed in the manifest are read.
4. Choose **Preview sources and findings**. Review the source titles, selections, source terms
   and authored findings. **Download bundle** preserves that prepared bundle.
5. Choose **Import into question**. The complete import is saved together.

If the project changes after preview, preview again to import against its current
revision. If the import response is interrupted, repeat the same saved bundle
for the same question. The receiver recognizes the exact saved bundle and returns
the current project without appending its edition or findings again.

Each imported source exposes its original files in source details. Text files can
be expanded in full; every file can be downloaded with its retained original
bytes. HTML and SVG source are displayed as text in the reader. Downloaded files
can be opened in their appropriate application.

## Write a manifest

The manifest is UTF-8 JSON. Paths are relative to the folder selected in the
browser or supplied to the local command. The file list is explicit: additional
files in the directory are not included.

~~~json
{
  "schema": "sf88-research-source-manifest-v1",
  "label": "Measured cooling: original observations and analysis",
  "sourceTerms": "Use the original publisher's license and attribution here.",
  "sourceReference": "https://example.org/dataset",
  "description": "Original measurements, definitions, and a reproducible analysis.",
  "sources": [
    {
      "key": "measurements",
      "title": "Publisher measurements and data dictionary",
      "url": "https://example.org/dataset",
      "summary": "Complete measurement table and publisher definitions.",
      "selected": true,
      "classification": "supports",
      "note": "Use the units, timestamps and quality flags defined by the publisher.",
      "files": [
        "originals/measurements.csv",
        "originals/README.txt"
      ]
    },
    {
      "key": "analysis",
      "title": "Analysis and reproduction source",
      "summary": "Complete analysis output, report and calculation source.",
      "selected": true,
      "classification": "supports",
      "files": [
        "analysis/results.json",
        "analysis/report.md",
        "analysis/calculate.py"
      ]
    }
  ],
  "findings": [
    {
      "key": "measured-opportunity",
      "title": "Operating-period comparison",
      "text": "Write the complete finding, its numerical basis, and interpretation.",
      "sourceKeys": ["measurements", "analysis"]
    }
  ]
}
~~~

Source keys and finding keys must each be unique. Each source names at least one
file; a file may support several source definitions. Every finding names one or
more existing source keys. Findings are linked to those imported source
occurrences when the bundle is received.

The required manifest fields are schema, label, sourceTerms and sources.
Findings may be omitted. Sources require key, title and files; supported optional
fields include url, doi, summary, authors, publishedAt, citation, references,
metadata, selected, classification and note. Selection defaults to true and
classification defaults to supports. The available classifications are supports,
contradicts, background and unreviewed.

Use an actual DOI only for the work identified by that DOI. A derived analysis
can cite its source dataset while retaining its own source key and identity.

## Build and inspect a bundle locally

From the complete source checkout:

~~~sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/cli.mjs \
  bundle-create \
  --manifest /private/source-manifest.json \
  --source-directory /private/original-source-folder \
  --out /private/measured-sources.json

node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/cli.mjs \
  bundle-preview --file /private/measured-sources.json
~~~

The builder retains the original manifest bytes, reads all named original files,
and records each file's byte length and SHA-256. It creates the output exclusively
so an existing saved bundle is preserved. Inspecting a bundle does not require a
Research store.

To receive into an existing local store:

~~~sh
node stellar/scf-starforge-20261009/sf88-operator-buyer-cli/research-dossiers/cli.mjs \
  import-bundle \
  --store /private/research-workspace \
  --id d_EXISTING_PROJECT_ID \
  --question q_EXISTING_QUESTION_ID \
  --file /private/measured-sources.json \
  --revision 12
~~~

Use the actual project and question IDs and the revision returned by the current
project. The command returns project metadata. Add --projection full for the
resolved project, or --sha256 with the digest of the complete saved bundle to
require those exact bytes.

## Operate the original running workspace

The remote client uses the existing Research connection file and original
workspace directory. It does not create a second listener.

~~~sh
research-client bundle-preview \
  --connection-file /private/research-connection.json \
  --directory /private/research-workspace \
  --id d_EXISTING_PROJECT_ID \
  --question q_EXISTING_QUESTION_ID \
  --file /private/measured-sources.json

research-client import-bundle \
  --connection-file /private/research-connection.json \
  --directory /private/research-workspace \
  --id d_EXISTING_PROJECT_ID \
  --question q_EXISTING_QUESTION_ID \
  --file /private/measured-sources.json \
  --revision 12
~~~

The local command's remote subcommand accepts the same arguments when the
research-client launcher is not installed.

The SDK exposes previewSourceBundleBytes, previewSourceBundleFile,
receiveSourceBundleBytes and receiveSourceBundleFile on ResearchWorkspaceClient.
Byte methods use the raw UTF-8 bundle bytes. File methods use the original
host-file reader and may require the saved file's SHA-256. Receive methods take
the current expectedRevision and an optional expectedBundleSha256.

The original store exposes previewSourceBundle and receiveSourceBundle with
exactly one of rawBytes, rawText or bundle. Supplying rawBytes retains the
unchanged original file. Supplying a parsed bundle object serializes it as a new
bundle, giving that serialization its own identity.

The source-bundles module also exports createSourceBundleFromDirectory,
createSourceBundle, inspectSourceBundle, projectSourceBundle and
sourceBundleFileBytes. createSourceBundle accepts the original manifest bytes
and a Map from relative filenames to Uint8Array values, and returns the complete
bundle bytes with its preview.

## Merchant tools

The existing research-workspaces merchant provides:

| Tool | Purpose |
| --- | --- |
| merchant_research_source_bundle_preview | Inspect the declared source bundle for an existing project and question. |
| merchant_research_source_bundle_receive | Atomically receive it at the current revision or recover the identical saved import. |

Configure the input as an original host source handle:

~~~json
{
  "kind": "source-bundle",
  "file": "/private/measured-sources.json",
  "sha256": "SHA256_OF_THE_COMPLETE_BUNDLE"
}
~~~

Tool requests refer to the configured workspace and source aliases, project ID,
question ID and, when receiving, expected revision. Original file content stays
in the host file; the tool argument does not carry the bundle or its file bodies.
The receive operation uses the declared source digest as its expected bundle
digest unless the caller supplies an explicit matching expectation.

## HTTP contract

POST /api/dossiers/:id/source-bundles/preview accepts questionId and rawText.
It returns the current expectedRevision, bundle digest and length, source
selections, source terms, file counts and complete finding text. alreadyReceived
identifies an exact bundle already saved for that question.

POST /api/dossiers/:id/source-bundles/receive accepts questionId, rawText,
expectedRevision and optional expectedBundleSha256. Add ?projection=metadata
for project metadata; the default response is the resolved project.

Both routes use the original authenticated Research listener. A fresh import
uses the existing revision guard. If the exact bundle is already received for
the same question, retry returns the current saved project even when that
request's earlier revision is stale. Changed bytes identify a different bundle
and require the current revision. Receiving the same bundle into a different
question is also a distinct import.

## Format and capacity

The saved bundle schema is sf88-research-source-bundle-v1. It contains manifest,
an optional manifestOriginal file record, and files. Each file record contains
name, bytes, sha256, encoding and content, with an optional mediaType.
Supported content encodings are canonical base64 and exact UTF-8. The builder
uses base64 for every original file, preserving binary and text encodings.

The receiver verifies every named file's size and hash and requires the complete
declared file set. When manifestOriginal is present, its original bytes must parse
to the same manifest. Absolute paths and paths with parent traversal are rejected.
The directory builder also checks that each resolved file stays inside the chosen
source directory.

A bundle is limited to 64 MiB of raw JSON, with at most 48 MiB of decoded source
files. Base64 and metadata consume part of the JSON limit, so a large collection
may reach the bundle limit before reaching the decoded-file limit. A manifest is
limited to 1 MiB, and a bundle may contain up to 2,048 unique files and sources
and up to 1,000 findings. The existing 8 MiB project-state limit still applies to
the complete project's notes and findings.

The HTTP request allowance accounts for escaping the raw bundle inside its JSON
request. Other Research request limits retain their existing values.
