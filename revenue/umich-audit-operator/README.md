# Audit workflow and receiving operator

This is a local application for carrying an audit from original records and risk planning through evidence review, management actions, scoped reporting, receiving, and recovery. It preserves the original sources, revisions, mappings, reviewed exports, returned files, and receiving decisions in one private workspace.

The included University of Michigan references describe the public audit process and retain the issuer's original 109-question catalog. They inform the supplied workflow. Receiving-system fields are selected through explicit, versioned target contracts.

## Start the application

Use POSIX Python 3.11 or later with the dependency in `requirements.txt`. The completed native demonstration used an existing environment with `cryptography 50.0.1`. The runtime has no database server, Node, npm, or hosted build dependency.

From this source directory:

~~~sh
python3 run.py serve --workspace /absolute/private/audit-workspace --port 0
~~~

The application binds to `127.0.0.1`. Open the printed URL in a browser on the same computer. The server identifies the private `operator.key` file; use that key to open the owner session. The ready output contains the file's location and server URL, never the key itself.

Optional controls:

~~~sh
python3 run.py serve \
  --workspace /absolute/private/audit-workspace \
  --port 0 \
  --ready-file /absolute/private/audit-ready.json \
  --open
~~~

`--port 0` chooses an available port. `--open` asks the local computer to open its browser. Stop the server with Ctrl-C and run the same command to reopen the same workspace.

If the chosen Python environment does not yet contain the dependency, create an isolated environment and install the declared requirement:

~~~sh
python3 -m venv .venv
. .venv/bin/activate
python -m pip install -r requirements.txt
~~~

Keep operational workspaces, recovery keys, and backup copies outside this source directory. The source ZIP and private operating workspace have different lifecycles.

## Access and working roles

The initial private key grants the workspace owner auditor access and permission to create or revoke access links. Each additional access link has a named role, explicit unit scope where required, and an expiry. Browser sessions last up to eight hours and remain subject to the grant's expiry and revocation.

A viewer's identity comes from its authenticated grant. Choosing a report audience does not change the user's access.

| Role | Records and reports available |
| --- | --- |
| Auditor | Complete audit records, retained originals, evidence, history, mappings, questionnaire responses, and receiving decisions. |
| Unit leadership | Detailed observations and actions for the selected unit scope. Low-priority observations remain available to that unit. |
| Executive | Reviewed High/Medium summaries, scope, objectives, balanced conclusions, and relevant successful-control results. |
| IT leadership | The summary projection for explicitly identified IT engagements, intersected with the grant's unit scope. |
| Medicine IT leadership | The same scoped projection, additionally requiring the explicit Michigan Medicine flag. |
| Board of Regents | A periodic summary projection. |
| FAIC | A periodic activity/follow-up summary projection. |
| Advisory recipients | Only the explicitly selected advisory memos and their selected recipient units, with minimal engagement references. |

An advisory memo has its own purpose, body, selected records, and recipient units. It does not confer access to every observation in the engagement.

Auditors perform edits, source imports, verification, native receiving, and recovery. Other roles can read and produce the outputs permitted by their existing scope. Original source files and raw evidence do not travel in their handoffs. Evidence with an unknown classification stays with auditors until its classification is reviewed.

## 1. Retain original sources

Upload the original file before mapping or correcting it. The workspace records its name, complete byte count, SHA-256, role, namespace, and available source locator. Later corrections are new sources or new record revisions; they do not replace the original bytes.

Structured imports accept:

- CSV with explicitly selected delimiter, encoding, and ordinal mappings;
- JSON arrays for a selected record family;
- JSON objects with a `rows_by_kind` mapping;
- JSONL with one complete row per line.

The source preview shows original headers and positions. Duplicate or blank headers remain separate columns. An ordinal identifies which occurrence is being mapped.

Use one stable source namespace for a given upstream system or retained source family. Preserve its original record ID. The application derives stable internal IDs from the record kind, source namespace, and original source ID; visible labels are not matching keys.

For evidence imports, `record_source_id` identifies the evidence record, while `source_id` identifies its retained file. The exact evidence hash disambiguates a file if an incoming source ID collides with a local one.

### Original public and issuer references

The source package includes:

- `reference/audit-domain-contract.json`: source-linked public process distinctions and the authored application contract;
- `reference/event-catalog.json`: all 109 original question IDs, question text, groups, and source pages;
- source acquisition and extraction tools with their existing attribution.

To join the retained original public bodies and event notice:

~~~sh
python3 tools/materialize_reference.py \
  --reference /absolute/private/umich-reference \
  --contract reference/audit-domain-contract.json \
  --retained /absolute/existing/public-process-sources \
  --notice-directory /absolute/existing/event-notice
~~~

See [SOURCE_ACQUISITION.md](SOURCE_ACQUISITION.md) for current-public-edition comparison and the exact source-selection record.

## 2. Review a complete mapping and adopt the import

Save a mapping with its source namespace, record family, ordered fields, null handling, value maps, relationship keys, and target-contract reference. The transform set is explicit; mappings are data rather than executable code.

Prepare the complete import. Review all returned diagnostics and the counts for new, unchanged, and changed identities. The complete plan remains available even when a preview page displays only part of a large result.

A changed local identity requires an explicit choice:

- keep the local head; or
- accept the incoming record as the next local revision.

The choice is bound to the current revision and hash. If the record changes while an import is being reviewed, reopen the current import decision. Adoption validates the combined graph and commits the complete accepted record set atomically.

A correction workflow can retain the original invalid file, upload the corrected file, use the same reviewed mapping, and then adopt the corrected records. The failed preview and original source remain inspectable.

## 3. Plan and conduct the audit

The main record chain is:

**Engagement → audit area → sub-activity → observation → management action → follow-up review.**

Risk records can exist at the unit level before an engagement is assigned. Workpapers and evidence carry their actual engagement relationships. The editor checks linked record kinds and prevents a child record or supporting evidence from silently moving to another engagement.

Engagement records carry scope, objectives, program reference, planning dates, original stage wording, and the reviewed stage. The public process stages are reference workflow labels; an imported source's original stage remains available.

The optional risk calculation uses the disclosed application scale:

`inherent = likelihood × impact`

`residual = inherent × (1 − control effectiveness)`

That calculation is an operator planning method, not a claim that the issuer mandated this scoring model. Original upstream scores and method references remain separate.

Control results preserve the source symbol. An observation marker can link to several separately prioritized observations. A successful-control checkmark means no observation; it does not create a Low-priority finding.

## 4. Review revisions and verify actions

Saving a correction creates the next local revision. Original revisions remain available in history.

A review records the exact local revision, complete record hash, original source revision, decision, reviewer, and explanation. A subsequent edit requires review of the new revision. A previously approved workpaper does not carry approval automatically to changed content.

Management action records distinguish:

- the original issue date;
- a reference completion date;
- an explicit action-plan date and its recorded source;
- the unit's completion statement;
- the auditor's verification and its implementation evidence.

The reference calculation uses six calendar months for High and twelve for Medium, clamping to the end of a shorter destination month. An explicit action-plan completion date remains separate from the committee-age threshold. For example, an August 31, 2026 issue date produces a February 28, 2027 six-month reference date; an explicitly recorded April 15 action-plan date remains April 15.

The clamp rule is the application's disclosed calendar convention. The source process establishes the month intervals and distinguishes action plans, follow-up, and verification.

The auditor's verification action requires evidence linked to the same engagement and a written assessment. A unit statement alone does not mark an action verified. Low-priority items remain distinct from both High/Medium routine follow-up and unresolved classifications.

## 5. Prepare and freeze an audience release

Select the engagements, the authorized audience, and a release note. The application prepares a frozen projection and its reports. Review that selection before building the handoff.

Senior summaries use the reviewed `report_summary` fields. They do not substitute detailed observation or action-plan text when a summary is missing. The report also retains scope, objectives, balanced conclusions, and successful controls.

The report preview binds:

- the exact domain snapshot and selected source identities;
- audience and unit scope;
- included and omitted records with reasons;
- the review reference;
- every generated artifact's bytes and hash.

Changing records or original sources after the preview requires a new current release. Internal reports and receiving-plan storage do not themselves change the business-source selection.

Human reports are available as HTML and CSV. The portable ZIP includes a complete manifest, projected snapshot, and rendered report files. Auditor handoffs can include original source and evidence blobs and retained history. Other audiences receive the projected content and restricted-original hash references appropriate to their scope.

See [EXCHANGE.md](EXCHANGE.md) for the full interchange schema and native format contract.

## 6. Export and compare a selected native target

Upload the receiving system's reviewed target contract as a retained source. It specifies exact table filenames, record families, original matching IDs, ordered columns, encoding, delimiters, headers, null representation, relationships, and any explicit export/value maps.

Build the native export from the frozen reviewed selection. The downloaded package preserves the contract and the manifest alongside the exact target tables.

Retain every returned target table as a new original input, then compare the complete files. The comparison reports all missing, additional, and changed identities and every declared field difference. Corrected returns are new files and new comparison records.

The supplied Practice contract demonstrates the format. It is not a vendor ABI or a receiving-system acceptance claim. A live implementation uses that receiver's actual documented import/export contract and its returned results.

## 7. Receive, replay, and resolve a handoff

Upload the exact original handoff and prepare its receiving plan. The application verifies every ZIP member, manifest identity, original-source byte count and hash, graph relationship, and audience projection before producing an adoption plan.

The same accepted ZIP hash replays as the same receiving operation. It does not import another copy of the records.

When versions conflict, compare the complete current and incoming records and record a reason. Keeping the local version preserves the received original bundle. Accepting the incoming version creates the next local revision with explicit receiving lineage and retains the earlier local history.

A partial incoming projection cannot replace a fuller local record. A matching projection can later be expanded to its exact full original while retaining the previous projected variant.

Source IDs and source metadata are preserved. Identical source content whose only difference is a local capture timestamp is reused. Genuine source-content or provenance conflicts support an explicit retained variant; evidence retrieval binds its file identity to the exact SHA-256.

## 8. Work the original issuer questionnaire

The questionnaire view retains all 109 original IDs and their source pages. Enter responses against the actual question ID and catalog hash. Record an owner, status, applicability explanation, and linked evidence as needed.

The export carries all original questions, including unanswered items, together with the current recorded responses, evidence IDs, and owner references. The exact original catalog is included. Producing this export does not submit a response to an issuer or send it to another organization.

## 9. Back up and restore the complete workspace

Create an encrypted backup using a recovery passphrase. The backup includes a native SQLite snapshot and every retained original object, including internal receiving plans, comparisons, reports, and source evidence.

Previously generated backup downloads are not embedded recursively into a new backup. Keep existing backup files separately if they are still needed. The restored workspace retains their historical artifact records; their download bodies require their separately retained copies.

Restore to a new private directory:

~~~sh
python3 run.py restore /absolute/retained/Audit-backup.cab \
  --destination /absolute/new/private/audit-restored
~~~

The command prompts for the passphrase. An existing owned `0600` passphrase file can be supplied with `--passphrase-file` when appropriate.

Restoration checks the encryption envelope, every file identity, the native SQLite database, and the original workspace identity before installing the new directory. It does not overwrite an existing workspace.

Authentication is renewed in the restored workspace. Open it with its new private owner key and create any required access links again. Original data IDs, revisions, source identities, reviewed outputs, and receiving history are retained.

## Reproduce the complete demonstration

~~~sh
python3 -B examples/OPERATOR_PRACTICE.py /absolute/new/private/audit-practice \
  --original-file /absolute/retained/1442341-event.pdf
~~~

This runs the same whole application service workflow with marked Practice records and the bundled original issuer references. The optional original file is read as existing bytes; the driver does not retrieve it or contact an issuer.

The private operation directory contains original requests, checkpoints, artifacts, and the final result. Reuse that same directory to continue its retained operation. A completed run returns its retained result. It does not launch a browser or send mail.

For the portable interchange alone:

~~~sh
python3 -B examples/EXCHANGE_PRACTICE.py
~~~

[DEMONSTRATION.md](DEMONSTRATION.md) records the actual completed native operator outcome and its source distinctions.

## Create a source release

~~~sh
python3 build_release.py \
  --source-root . \
  --output /absolute/new/Audit_Workflow_Operator.zip \
  --source-reference exact-source-commit-or-release-label

python3 build_release.py --verify /absolute/new/Audit_Workflow_Operator.zip
~~~

The builder includes a fixed list of application, interface, reference, documentation, license, and example source files. It excludes private workspaces, account keys, operating journals, captures, backups, temporary files, and unrelated directory contents. Every included source has a complete byte count, SHA-256, and Git-blob identity in `SOURCE_MANIFEST.json`.

The source reference is a publisher-supplied label. The manifest identifies the actual source bytes; a published Git comparison establishes their relationship to that repository commit. Identical source bytes and label produce the same archive in the same Python/zlib runtime.

## Source and license

This product retains the repository's existing MIT license and source attribution.

The public process references are [Steps of the Process](https://audits.umich.edu/the-audit-process/steps-of-the-process/), [Reporting and Follow-Up](https://audits.umich.edu/the-audit-process/reporting-follow-up/), and the [original sample report](https://audits.umich.edu/uploads/reports-and-advisories-sample-report-9-2024.pdf). The bundled source contract distinguishes original publisher wording from application choices. The sample report's illustrative rows remain template examples.
