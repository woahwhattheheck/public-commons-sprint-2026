# Research transfers for RODA

This application prepares a complete research collection for a RODA repository,
runs the repository's selected ingest job, follows its reports and archival
objects, and packages the original workspace with the complete operating source
for another operator.

The source is an existing, verified research BagIt ZIP made by the adjacent
[preservation workflow](README.md). Its complete original bytes, research pages,
request chain, review decisions and descriptive metadata remain intact.
The RODA submission adds an explicit submission agreement, a searchable record
review and an ingest layout compatible with RODA's BagIt parser.

## What the receiving repository gets

One research submission package becomes **one package-level AIP**. Selected
research records are individual files within that AIP. Their reviewed Dublin Core
metadata remains in separate JSON files and in the complete catalog.

RODA's BagIt conversion derives its package metadata from **bag-info.txt**.
The original Archivematica CSV is retained inside the original archive. A
repository that wants each research record to appear as an independent catalog
record can configure a mapping or select a separate per-record ingest workflow.
This package preserves the collection relationship explicitly.

| Preserved member | Purpose |
|---|---|
| data/source/original-research-transfer.zip | Complete byte-identical original BagIt research transfer |
| data/records/record-W…-original.json | Each selected original metadata record, checked against its original source digest |
| data/metadata/record-W…-reviewed.json | Every source record's original and reviewed descriptive fields, selection, reasons, provenance and separately retained described-work rights |
| data/metadata/source-member-index.json | Every original member's path, length, SHA-256 and location inside the retained archive, plus its standalone path when selected |
| data/metadata/submission-agreement.json | Exact operator-entered agreement bytes |
| data/metadata/research-catalog.json | Complete structured record review and reconciliation |
| data/metadata/research-catalog.csv | Spreadsheet review with protection for formula-like cell values |
| data/metadata/research-review.html | Searchable, self-contained operator review |
| data/metadata/transfer-profile.json | Package identity, original verification, agreement digest and source/selected/excluded counts |
| bagit.txt, bag-info.txt | BagIt 1.0 declaration, package identity, source and agreement references, counts and exact payload size |
| manifest-sha256.txt, tagmanifest-sha256.txt | One complete payload checksum inventory and checksums for its bag tags |

All outer payload **basenames are globally unique**. There is one payload
checksum manifest. This is a compatibility requirement derived from the exact
Commons-IP 2.12.1 implementation used by the inspected RODA source: its parser
copies each payload into its staging directory using the basename, and iterates
all payload manifests when creating representation files. Unique outer names
avoid overwrites; the single payload manifest avoids duplicate representation
entries. The complete original archive keeps its existing paths and both of its
original checksum algorithms unchanged.

Selection preserves the entire original source edition. An excluded record is
omitted as a standalone original JSON file and remains inside the original
archive. Its review decision stays visible in the catalog. The profile is for
bibliographic metadata and source evidence that the repository can preserve in
full. Described papers and their full text remain separately identified resources.

## Install the whole operating application

Requirements are Python 3.11 or newer and a Unix filesystem supporting flock.
The optional Node wrapper requires Node 18 or newer. The producer and client use
Python's standard library. Network access is required for repository operations.

Keep this installed layout:

~~~text
research/
  oai/oai_feed.py
  preservation/
    preservation.py
    roda.py
    roda_client.py
    cli.mjs
    README.md
    RODA.md
    RODA_REST.md
~~~

The neighboring OAI module verifies the original source pages, manifests,
query, record identity and saved review reconstruction. Exported receiving
snapshots include this complete source closure.

The Node entry point preserves every existing research-preservation command.
Prefix a RODA command with "roda":

~~~sh
node research/preservation/cli.mjs roda agreement-template
~~~

The examples below use Python directly.

## Prepare the collection and agreement

First use the existing research-preservation workflow to initialize and review
the edition. Build its complete ZIP at the selected saved review revision:

~~~sh
python3 -B research/preservation/preservation.py build \
  --workspace /absolute/research-preservation/project \
  --expected-revision 1 \
  --output /absolute/delivery/research-original.zip --zip
~~~

Use the actual revision returned by the original workspace. Revision changes
remain in the original preservation project; this RODA workspace freezes one
complete resulting transfer.

Generate the agreement template:

~~~sh
python3 -B research/preservation/roda.py agreement-template \
  > /absolute/operator/roda-agreement.json
~~~

Complete the entered values before preparation:

| Field | Entered value |
|---|---|
| agreementId | The producer and repository's agreement or transfer reference |
| repository.name | Receiving repository name |
| repository.baseUrl | Actual RODA installation base URL, including its context path if present |
| producer.name, producer.contact | Transferring organization and responsible contact |
| collection.title | Human collection title used as the bag's description |
| collection.parentAipId | Existing selected parent AIP, or an empty string when the job selects no parent |
| collection.description | Collection context |
| scope.contentDescription | Content actually being transferred |
| scope.completeOriginalEdition | true, matching the complete original edition retained by this profile |
| scope.metadataLicense | Original research metadata's CC0 URL |
| notes | Entered transfer and repository context |

The entered document is retained exactly, including formatting and additional
JSON fields. Its digest binds the prepared transfer to that agreement. The
template is an input document; institutional approval or signatures are supplied
through the repository's own process.

Prepare the RODA workspace:

~~~sh
python3 -B research/preservation/roda.py prepare \
  --source /absolute/delivery/research-original.zip \
  --agreement /absolute/operator/roda-agreement.json \
  --workspace /absolute/roda/research-transfer
~~~

The command copies the original ZIP with a streaming digest, reopens its complete
research source and review, derives the entire record catalog and source index,
builds the compatible outer SIP and verifies the resulting workspace before
publishing its directory. Repeating the same inputs reopens that workspace.
A changed original archive or changed agreement belongs in a new workspace.

Preparation writes:

| Workspace file | Role |
|---|---|
| original.zip | Original transfer, also retained unchanged inside the outer SIP |
| transfer.zip | Complete RODA BagIt submission |
| agreement.json | Exact entered agreement |
| handoff.json | Original and outer hashes, repository and parent selection, counts, full verification and stable handoff ID |
| catalog.json, catalog.csv, review.html | Complete local record review |
| source-members.json | Full retained original member/path/hash index |
| MANIFEST.json | Hash and length of every immutable prepared file |
| workspace.lock | Shared producer/client lock |
| remote/ | Repository operating state and original request/response journal, created by repository operations |

Open **review.html** directly in a browser. It is a plain industrial table with
search, selection filtering and expandable full source/rights/review fields.
No web service is required to inspect it.

## Reopen and compare the preserved source

~~~sh
python3 -B research/preservation/roda.py show \
  --workspace /absolute/roda/research-transfer

python3 -B research/preservation/roda.py verify-transfer \
  --source /absolute/roda/research-transfer/transfer.zip
~~~

"show" and "verify" both perform full local reconstruction: the prepared manifest,
original BagIt/source/review verification, regenerated catalog, exact original
archive bytes inside the outer SIP, all outer payload and tag checksums, and the
complete handoff binding.

"verify-transfer" also works on a standalone SIP after delivery. It extracts the
retained original archive into a temporary receiving directory, verifies the
original research workflow and compares the entire expected outer package.
Allow enough temporary disk space for the original archive. The source workflow
allows 64 MiB per original member and 2 GiB for its whole original transfer;
the RODA outer package permits an additional 512 MiB of derived metadata.

Compare two prepared transfers:

~~~sh
python3 -B research/preservation/roda.py compare \
  --previous /absolute/roda/review-one \
  --current /absolute/roda/review-two
~~~

The comparison reuses the original research comparator and also reports whether
the entered repository, agreement bytes and outer transfer bytes match. It keeps
source changes distinct from review changes.

## Configure and operate the receiving repository

The complete REST contract, configuration fields and recovery behavior are in
[RODA_REST.md](RODA_REST.md). The repository operator supplies its existing ingest
plugin and parameters as a job template. The client retains that exact
selection, including configuration affecting validation, classification,
permissions and ingest behavior.

Keep the client configuration and credentials outside the prepared workspace.
Use the configuration's named environment variable for the bearer token or basic
authentication password. The journal retains environment variable names and
normalized nonsecret configuration.

Start with the selected repository account and job template:

~~~sh
python3 -B research/preservation/roda.py remote plan \
  --workspace /absolute/roda/research-transfer \
  --config /absolute/operator/roda-client.json \
  --job-template /absolute/operator/roda-ingest-job.json
~~~

The plan binds the entered repository, configured account, original handoff,
transfer and selected job template. Repository operations verify the actual
authenticated account before proceeding. If the agreement names a parent AIP,
the job must name the same parent and use its force-parent parameter.

Run the whole selected repository workflow:

~~~sh
python3 -B research/preservation/roda.py remote run \
  --workspace /absolute/roda/research-transfer \
  --config /absolute/operator/roda-client.json \
  --poll-seconds 1800
~~~

The client uploads the actual transfer bytes to the repository staging area,
reopens the staged object, downloads it to verify its complete digest, creates
the selected ingest job, and follows the original job, model reports and AIP
outcomes. The poll duration controls how long this invocation follows the
existing job. Repository work continues independently of the client process.

For operator-separated stages, use "remote upload", "remote submit" and
"remote reconcile" with the same workspace and configuration. These are the same
operations used by "run"; they share the saved source and repository identities.

RODA creates a fresh job UUID on every job-creation request. The client journals
the request before dispatch and reconciles uncertain results by the saved unique
name and exact selected sources. A lost response is continued from the original
workspace instead of creating another ingest job.

Inspect local saved state without a repository request:

~~~sh
python3 -B research/preservation/roda.py remote status \
  --workspace /absolute/roda/research-transfer
~~~

Reconcile the existing job and all reports:

~~~sh
python3 -B research/preservation/roda.py remote reconcile \
  --workspace /absolute/roda/research-transfer \
  --config /absolute/operator/roda-client.json \
  --poll-seconds 1800 --interval-seconds 5
~~~

The original journal makes process interruption and response loss visible.
When a repository operator already knows an existing staging UUID or job ID,
"reconcile --transfer-uuid … --job-id …" verifies and adopts those selected
original objects instead of creating replacements.

A terminal job state and an accepted archival object are different facts.
For example, RODA can create an AIP and subsequently report a failed
well-formedness event; the existing AIP must still be reconciled. Scheduled and
pending-approval service states retain their actual meaning. The client includes
the complete model report outcomes and current AIP states in its operating
result.

## Deliver the whole application and saved operation

Export after the desired local or repository receiving stage:

~~~sh
python3 -B research/preservation/roda.py export \
  --workspace /absolute/roda/research-transfer \
  --output /absolute/delivery/roda-research-receiving.zip
~~~

The snapshot contains all immutable prepared files, the complete current
repository journal, and all eight installed source and guide files. Export holds
the same workspace lock used by the client, hashes every member and publishes
the complete ZIP under a create-only name. Use a new output filename after the
repository operation progresses or the installed application changes.

Receive it with an existing trusted copy of this producer:

~~~sh
python3 -B research/preservation/roda.py receive \
  --source /absolute/delivery/roda-research-receiving.zip \
  --output /absolute/received/research-transfer
~~~

Receiving verifies the complete manifest and source/data inventory, rejects
unsafe paths and nonregular members, reconstructs the original handoff and
publishes a new receiving directory. It verifies the package with the already
installed producer. Subsequent operator commands can use the included application.

The returned directory contains **application/** and **workspace/**. The original
handoff, transfer, remote request journal and actual repository IDs remain the
same. Repeating "receive" against an unchanged received directory verifies and
reopens it. After further repository work, use "show" on the live workspace and
export its new state to a new snapshot.

Use the included application for subsequent operations:

~~~sh
python3 -B /absolute/received/research-transfer/application/research/preservation/roda.py show \
  --workspace /absolute/received/research-transfer/workspace
~~~

Provide the receiving host's external configuration and credentials to continue
"remote reconcile". The base URL, actor and job selection remain bound to the
original operation. Running the same command on another host continues that
operation and its existing ingest submission.

## Source references

The compatibility profile and client contract use these first-party sources:

- [RODA pre-ingest and submission agreements](https://www.roda-community.org/documentation/Pre_Ingest.html)
- [RODA source revision 668f61b2d7d3154cb6cc3220ff83cbbd7e206822](https://github.com/keeps/roda/tree/668f61b2d7d3154cb6cc3220ff83cbbd7e206822)
- [RODA's declared Commons-IP dependency](https://github.com/keeps/roda/blob/668f61b2d7d3154cb6cc3220ff83cbbd7e206822/pom.xml)
- [Commons-IP 2.12.1 BagitSIP parser](https://github.com/keeps/commons-ip/blob/a30e410a9148252fa9240900697883dd042abf46/src/main/java/org/roda_project/commons_ip/model/impl/bagit/BagitSIP.java)
- [Commons-IP 2.12.1 BagitUtils](https://github.com/keeps/commons-ip/blob/a30e410a9148252fa9240900697883dd042abf46/src/main/java/org/roda_project/commons_ip/model/impl/bagit/BagitUtils.java)
- [Commons-IP 2.12.1 release](https://github.com/keeps/commons-ip/releases/tag/2.12.1)

The inspected RODA source declares Commons-IP 2.12.1. Its BagitSIP.java blob is
a01ebae9e4d7205fed6918991d3738303a615803; BagitUtils.java is
0d336b857eff49c3088068ef9188ad81d37905b2. The published CLI release provides the
same implementation for an independent receiving exercise on a prepared SIP.
