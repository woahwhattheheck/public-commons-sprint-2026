# Archivematica research receiving

This workflow takes the original reviewed research BagIt ZIP through an existing
Archivematica Dashboard and Storage Service deployment. The same saved operation
owns its source package, mounted transfer path, transfer and SIP identifiers,
ingest decisions, resulting AIP, optional DIP, original responses and receiving
report. It can be reopened after a process restart or transferred with the
complete application.

The supported provider profile is Dashboard **1.18.0** and Storage Service
**0.24.0**. The exact source revisions and endpoint behavior are recorded in
[the provider contract](ARCHIVEMATICA_PROVIDER_CONTRACT.md). The workbench uses
Python 3.11 or later and the standard library for this destination.

## Open the original research workspace

Start the [preservation workbench](WORKBENCH.md) from its installed application:

~~~sh
python3 -B research/preservation/workbench.py serve \
  --workspace /absolute/private/research-preservation --port 8785
~~~

The same application is available as **Research preservation** in the managed
Applications workspace. Select its installed source, original Python executable,
private environment file and preservation workspace. The native application
announces the actual local address after opening that workspace.

Use **Overview** to receive the complete native research edition, then **Records**
to review inclusion and Dublin Core fields. Save the review before preparing a
destination. A destination freezes the selected source manifest and saved review;
later work on the catalogue can continue without changing that destination.

## Prepare the deployment connection

Use the existing institution's Dashboard account, Storage Service account,
pipeline, storage locations and processing configuration. The client needs the
following actual deployment selections.

| Selection | How it is used |
| --- | --- |
| Dashboard base URL, username and API-key environment name | Transfer and ingest API requests |
| Existing Dashboard session-cookie and CSRF-token environment names | The Dashboard's returned MCP processing choices and their execution |
| Storage Service base URL, username and API-key environment name | Selected location, package, contents and receiving operations |
| Transfer-source location UUID and relative ZIP path | The exact source selected in the transfer-start request |
| Environment name for the mounted transfer-source root | The local path through which the application stages the original ZIP into that existing location |
| Existing processing configuration name | The selected processing XML is read before transfer creation |
| Pipeline UUID and AIP location UUID | The resulting storage package must belong to this pipeline and location |
| Optional or required DIP selection | The receiving operation records the separately selected DIP result |
| Backlog policy and, for arrangement, backlog location UUID | Continuation when the original transfer enters the backlog |

Configure the environment of the server process, or the managed application's
private environment file. Destination configuration stores the **variable names**.
The process resolves their values when operating the destination.

The transfer-source root must refer to the actual authorized mounted/shared
directory for the chosen Storage Service location. For example, a settings path
of `research/reviewed-edition.zip` is staged beneath that configured root. The
client publishes and verifies the byte-identical original ZIP at that selected
path before starting the transfer. An existing file at the same path must have
the same original bytes.

The Dashboard API key and browser session have different roles in this release.
The processing-choice interface is the Dashboard's existing session/CSRF flow.
Provide that session when the selected processing configuration exposes manual
choices. The original request journal stores credential references and request
identities; keep the environment file private to the original operator.

The connection also includes the pinned deployment versions, timeout, wait and
response/download limits. Its default per-command wait is 30 seconds. A command
that reaches this wait returns its saved progress; another **Continue transfer and
receiving** uses the same operation. The loopback option is for an explicitly
selected local receiving deployment.

## Save a complete destination

Open **Destinations**, choose **Archivematica**, and enter a useful operator label.
Keep the generated original operation ID for continuation. Select the saved
source review, then edit the package settings and repository configuration from
their complete templates.

The receiving settings contain:

- A transfer name, optional accession and access-system identifier.
- The existing transfer-source location UUID and exact relative `.zip` path.
- The existing processing configuration name, pipeline UUID and AIP location UUID.
- The DIP policy: `required`, `optional`, or `not-requested`.
- The backlog policy: `pause`, or `arrange` with the existing backlog location UUID.
- The entered AIP fixity-check choice and its `forceLocal` option.
- An operator note.

UUIDs use their complete hyphenated form. The processing configuration name uses
1–16 letters, numbers or underscores. A required DIP needs its location UUID;
`not-requested` uses a null location. An arrangement policy needs the existing
backlog location UUID; `pause` uses null.

Click **Prepare saved destination**. Preparation verifies and retains:

| Prepared member | Contents |
| --- | --- |
| `source/bag.zip` | The unchanged original BagIt ZIP |
| `settings.json` | The complete normalized receiving settings |
| `records.json` | The unchanged record-mapping array from the verified bag |
| `report.html` | The saved record review and receiving selections |
| `manifest.json` | Original ZIP identity, every BagIt member, payload inventory, source/review identity, selected provider profile, record counts and complete prepared-file inventory |

The package ID is derived from the original ZIP, original bag identity,
complete member/payload inventory, provider profile and receiving settings.
Reopening the same package adopts that identity. An existing package prepared
from different source bytes or different receiving settings is a conflict.

The original mapping records retain every inclusion decision, reviewed Dublin
Core value, original payload path and source record identity. A record excluded
from the standalone transfer payload remains in the preserved full source
edition and review history, as described in the original preservation guide.

## Continue transfer and ingest

Click **Continue transfer and receiving** to operate the original saved plan.
The client stages the selected ZIP, verifies the named processing configuration
and deployment selections, starts the original transfer, and retains the actual
returned identifiers and responses.

The Dashboard package API starts a `zipped bag` transfer with automatic approval
disabled. The client binds the returned transfer to the actual unapproved
transfer before carrying out the original approval action. Processing then
continues against that transfer and its SIP. The saved operation owns these
identifiers through future runs.

**Check repository progress** reads the current transfer, ingest, storage and
returned choice observations. **Continue transfer and receiving** also performs
the requested download/extraction and entered fixity actions required for complete
receiving. This distinction matters for storage configurations where a retrieval
starts an asynchronous storage task.

The application shows the latest saved state, original transfer/SIP/AIP/DIP
identifiers and receiving counts when available. A transient provider error
retains the original request and current state. Follow an actual returned retry
time before another continuation.

### Choose an observed processing option

When the Dashboard presents a processing choice, the destination shows its
original unit and job and a selector containing the options actually returned
for that job.

Choose the option, enter the reason, and click **Apply selected ingest choice**.
The request includes that exact string choice ID, original unit UUID, job UUID
and observation digest. A newer job observation requires a choice from that
new observation. Draft entries stay attached to their original observation
while the browser reads progress.

The application uses the existing Dashboard session and CSRF token for this
action. It retains the original action request, response and the subsequent
observation in the same operation.

### Continue a transfer in the backlog

A transfer can enter the backlog after transfer processing. That state retains
its transfer and stored-package identities separately from an ingested AIP.

For a saved `arrange` policy, the destination displays the observed original
backlog transfer and source. Enter a single selected arrangement name as
`/arrange/research-edition/`, record the reason and choose
**Arrange original backlog transfer**. The client binds the choice to the retained
backlog observation and continues the original planned SIP.

A saved `pause` policy leaves the original backlog transfer available for the
institution's arrangement workflow. The receiving history continues to identify
that original transfer. Choose the arrangement policy during destination
preparation when this operator is intended to perform the arrangement.

## What the AIP comparison checks

Archivematica restructures BagIt payload, metadata and logs during ingest.
The receiving client follows the released transformation and the resulting
METS/PREMIS file relationships.

For each included research record it joins the original record identity and
payload path to the transfer and AIP metadata. It reads the actual METS `FLocat`,
File UUID, PREMIS original name, size and digest, then compares the extracted
original file bytes with the original prepared inventory. It also compares the
reviewed Dublin Core fields through the metadata association for that same file.

Source documentation and BagIt tag material have distinct destinations.
Receiving checks the actual stored original files and their relevant metadata
associations. The original BagIt member paths remain available in the prepared
manifest and unchanged ZIP for reproducible comparison.

A verified result binds the original operation/package and the observed provider
identifiers to the complete saved receiving data. It adds the HTML report and
receiving JSON to **Delivery**. A selected DIP is tracked as its own storage
package and policy outcome.

The released implementation details are in
[ARCHIVEMATICA_PROVIDER_CONTRACT.md](ARCHIVEMATICA_PROVIDER_CONTRACT.md).
The complete native receiving runner uses the original research input and the
same source/operation implementation to exercise this whole journey.

## Recover a request whose response was interrupted

Open the original saved destination. **Original request identifiers and progress**
shows the retained request and current state.

For a saved start/action whose response needs to be associated with its original
request, open **Reconcile an original request**. Choose the transfer-start or
action-response template and fill it with the saved request digest and the actual
original returned status/body. An action response also identifies its saved
action key. Include the recovery note, then click **Reconcile original operation**.

Reconciliation binds the original response to its existing dispatched request.
A normal progress check uses the existing provider identifiers. Neither workflow
needs a replacement operation ID.

If preparation stopped after the destination selection was saved, use
**Continue original preparation**. It reads the same saved source revision,
settings and configuration and adopts the matching original prepared package.

## Deliver and reopen the complete workspace

Choose **Delivery → Export complete workspace**. The delivery contains the
application source and guides, original research source, every retained review,
all destination selections, prepared packages, request/response history and
receiving results. Earlier complete exports remain listed by identity while the
new export carries the current complete state.

Receive with an installed original workbench:

~~~sh
python3 -B research/preservation/workbench.py receive \
  --source Research_Preservation_Complete.zip --output received

python3 -B received/application/research/preservation/workbench.py serve \
  --workspace received/workspace --port 8785
~~~

The receiver verifies the complete archive inventory before publishing the
received workspace. An archive containing an Archivematica destination must
include its complete producer, client and both guides. Reopening the same
received archive preserves subsequent work in that workspace and the original
destination's operation history.

The Archivematica package also has a standalone portable route:

~~~sh
python3 -B research/preservation/archivematica.py export \
  --workspace /absolute/archivematica-prepared --out Archivematica_Complete.zip

python3 -B research/preservation/archivematica.py receive \
  --source Archivematica_Complete.zip --out archivematica-received

python3 -B archivematica-received/application/research/preservation/archivematica.py show \
  --workspace archivematica-received/workspace
~~~

That route contains the complete original prepared package, all saved client
operations, the Archivematica/preservation source, original OAI dependency and
both provider guides. Its receiving stage is bound to the exact original archive
and can resume after an interrupted extraction.

## Command-line preparation

The standalone producer accepts the same verified original ZIP used by the
workbench:

~~~sh
python3 -B research/preservation/archivematica.py settings-template > settings.json

python3 -B research/preservation/archivematica.py prepare \
  --bag /absolute/reviewed-bagit.zip --settings settings.json \
  --out /absolute/archivematica-prepared

python3 -B research/preservation/archivematica.py verify \
  --workspace /absolute/archivematica-prepared
~~~

Enter the actual selected deployment UUIDs in `settings.json` before preparing.
The client contract describes its configuration, saved plan, continuation and
decision commands. The optional Node wrapper routes the same source through
`cli.mjs archivematica` and `cli.mjs archivematica-client`.

## Primary references

- [Archivematica Dashboard 1.18 API reference](https://archivematica.org/fr/docs/archivematica-1.18/dev-manual/api/api-reference-archivematica/)
- [Pinned Dashboard release source](https://github.com/artefactual/archivematica/tree/243867858da329bb27ac9d5cf1747b3389d39149)
- [Pinned Storage Service release source](https://github.com/artefactual/archivematica-storage-service/tree/0c3129d6f549e1223a119c07f0d3f9f972b9c890)
- [Original research preservation source and BagIt layout](README.md)
