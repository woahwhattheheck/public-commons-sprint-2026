# Staff Portal Workbench — private source and Python preparation

This command prepares a trusted, complete private staff-portal application for the installed Merchant adapter. The public integration contains generic hosting, client, preparation and receiving code. Original application source, commercial records, provenance and workspace data arrive through the existing private delivery and remain private.

Preparation verifies the exact source authority, materializes two independent source copies, and records the actual selected CPython executable and standard-library modules. It does not start a portal server, create or receive a customer workspace, run a publishing job, contact an external service, or alter an existing operating workspace. Preserve the existing company, native receiving and external publishing owners.

## 1. Inputs and the private boundary

| Input | Required authority | Result |
| --- | --- | --- |
| Existing complete source directory | Exact private source-manifest file and SHA256 | Two complete application copies and private authority |
| Original complete operating delivery ZIP | Trusted whole-archive SHA256; optional separate source authority | Source copies, unchanged operating delivery and actual original inspector observation |
| Exported private source-transfer ZIP | Trusted whole-archive SHA256; optional separate source authority | New local source copies and fresh actual local Python observation |

The external source authority has exactly this shape:

~~~json
{
  "schema": "stellar-forge.staff-portal-workbench-source.v1",
  "files": [
    {"path": "relative/original-file", "bytes": 123, "sha256": "64-lowercase-hex-digits"}
  ]
}
~~~

This example is a shape, not a usable partial authority. Declare the entire selected original application. Preparation hashes every file, rejects undeclared files and linked paths, and parses the verified original portal_delivery.py literal SOURCE_FILES and SOURCE_EDITION. The authority's exact file set must equal that original contract. A small execution dependency list is insufficient.

An existing owned 0755 donor source directory is read without mutation. Copied application directories are private 0700 with 0600 files. Keep the external authority outside both application copies and outside operating data directories. Incoming archives and authority files must be owned private ordinary files.

Keep these inputs in their existing authorized private Slack, Pages and file custody. Do not publish them to public repositories, public channels or artifacts, source chapters or customer-agent arguments. Preserve the original private customer source owner. Public setup names local declared aliases and private configuration paths.

A whole-archive digest selects trusted original code; hashing does not make unknown code trustworthy. This command takes the original trusted delivery already selected by its owner. Do not use it to investigate an unsolicited archive.

## 2. Interpreter and directories

Select an actual compatible **CPython 3.11 or later** executable by its absolute invocation path. A valid existing interpreter symlink is preserved as the invocation, while the physical executable identity is measured separately.

This preparation installs no pip packages and downloads no dependencies. It creates no virtual environment and substitutes no portal engine. The original application uses Python and its standard library. The receipt records executable SHA256/bytes, full version, implementation, platform, architecture, cache tag, ABI, SQLite version, and identities of the imported JSON, ZIP, SQLite, TLS, hashing, HTTP and URL modules.

Receiving inspects its own explicitly selected interpreter. The private transfer does not relocate an interpreter or claim that its source host's runtime identity was preserved. The originating observation is retained as private history; the receiving receipt binds the actual receiving executable.

Create the parents of the private preparation and private export destination first. Keep preparation outside the installed public source and separate from the donor. Keep exports outside preparation and public source.

Managed launch consumes actual returned fields:

~~~json
{
  "applicationDirectory": "/private/preparation/primary/application",
  "sourceManifestFile": "/private/preparation/.preparation/SOURCE.json",
  "sourceManifestSha256": "actual-full-sha256",
  "python": "/absolute/selected/python"
}
~~~

The second copy has its own receiving/application directory. Do not reconstruct paths from an archive name or substitute a donor path. The Staff Portal launch contract requires no runtimeReadyFile.

## 3. Prepare the trusted source folder

Invoke the complete installed generic adapter with its selected Node runtime:

~~~sh
node /absolute/installed/package/source/products/staff-portal-workbench/prepare.mjs prepare \
  --directory /absolute/private/staff-preparation \
  --python /absolute/selected/python \
  --source /absolute/private/original-application \
  --source-manifest /absolute/private/original-source.json \
  --source-manifest-sha256 ACTUAL_SOURCE_MANIFEST_SHA256
~~~

The private authority preserves the selected manifest's exact bytes. All original files are checked before copying, all complete copies are checked, and the final directory inventory must equal the original source contract.

The immutable request at .preparation/REQUEST.json binds the donor or archive, source authority, actual Python observation and preparation helper. Resume an interrupted operation with the same directory, inputs and --resume:

~~~sh
node /absolute/installed/package/source/products/staff-portal-workbench/prepare.mjs prepare \
  --directory /absolute/private/staff-preparation \
  --python /absolute/selected/python \
  --source /absolute/private/original-application \
  --source-manifest /absolute/private/original-source.json \
  --source-manifest-sha256 ACTUAL_SOURCE_MANIFEST_SHA256 \
  --resume
~~~

Completed preparation reopens its same result. It does not replace a source edition or select another interpreter under the old request. Staged complete files are fsynced, every directory is synchronized, then the complete tree is renamed into place. Interrupted copies are checked and reused; a partial tree is never READY. Incomplete copy candidates are kept under private metadata, outside both source inventories. Their target selection and complete observed identities are preserved under the same preparation lease, so a killed copy cannot leave an undeclared temporary file inside the admitted source tree.

## 4. Receive the original operating delivery

~~~sh
node /absolute/installed/package/source/products/staff-portal-workbench/prepare.mjs receive \
  --directory /absolute/private/staff-preparation \
  --python /absolute/selected/python \
  --archive /absolute/private/incoming/staff-portal-delivery.zip \
  --archive-sha256 ACTUAL_WHOLE_ARCHIVE_SHA256
~~~

The helper checks the complete trusted container identity before source admission. It verifies ordinary members, safe literal names, case-folded duplicates, encryption flags, declared source/workspace/handover closure, all complete byte counts and hashes, and original capacity.

The original schema remains tjlabs.staff-portal-delivery/v1. Its complete ZIP includes source/, workspace.zip, HANDOVER.html and manifest.json. Preparation preserves this entire original operating delivery privately; it does not remove the workspace or report and label a reduced package complete.

After source bytes and the original literal source contract are verified, the selected interpreter imports that trusted application and calls its actual portal_delivery.inspect. Full stdout, stderr, closed process receipt and exact returned manifest are retained. This is the original read-only inspector. It does not call portal_delivery.receive, adopt a workspace, start a listener or invoke an external publisher.

An independent retained source authority may additionally constrain intake:

~~~sh
  --source-manifest /absolute/private/selected-source.json \
  --source-manifest-sha256 ACTUAL_SOURCE_MANIFEST_SHA256
~~~

It must describe the same exact source. Otherwise the trusted whole-archive digest selects the complete original archive and the private authority is derived from its declared source rows.

Pass the retained exact operating delivery to the original native receiving course when it reaches workspace adoption. That later action keeps its own original request, actor and source-workspace identity.

## 5. Inspect and use the result

~~~sh
node /absolute/installed/package/source/products/staff-portal-workbench/prepare.mjs inspect \
  --directory /absolute/private/staff-preparation \
  --python /absolute/selected/python
~~~

Prepare and receive return the full PREPARED result directly. Inspect returns it inside an envelope:

~~~json
{
  "schema": "stellar-forge.staff-portal-preparation.v1",
  "state": "READY",
  "result": {
    "schema": "stellar-forge.staff-portal-preparation.v1",
    "state": "READY",
    "directory": "/absolute/private/staff-preparation",
    "resultPath": "/absolute/private/staff-preparation/.preparation/PREPARED.json",
    "request": {"path": "...", "bytes": 0, "sha256": "..."},
    "source": {"manifestSha256": "...", "files": 0, "bytes": 0},
    "primary": {
      "applicationDirectory": "...",
      "sourceManifestFile": "...",
      "sourceManifestSha256": "...",
      "python": "..."
    },
    "receiving": {
      "applicationDirectory": "...",
      "sourceManifestFile": "...",
      "sourceManifestSha256": "...",
      "python": "..."
    },
    "runtime": {},
    "origin": {},
    "originalDelivery": null,
    "originalInspection": null,
    "completedAt": "..."
  },
  "verifiedAt": "..."
}
~~~

Zeros and ellipses are placeholders. Use the actual complete returned identities and paths. Inspection remeasures the selected Python/standard-library files, request/helper identity, both source copies, private authority, retained operating delivery and original inspection receipt/logs. A JSON READY label alone is not accepted.

The managed host separately calls inspectOriginalSource and verifies complete source again in its Python bridge before importing the private implementation.

## 6. Export and independently reproduce private source

~~~sh
node /absolute/installed/package/source/products/staff-portal-workbench/prepare.mjs export \
  --directory /absolute/private/staff-preparation \
  --python /absolute/selected/python \
  --output /absolute/private/transfers/staff-source-transfer.zip
~~~

EXPORTED returns portable path, full byte count and SHA256 plus the source summary. Retain all of them.

| Member | Meaning |
| --- | --- |
| source/ with every selected original file | Complete editable application, including its private original provenance/commercial records |
| SOURCE.json | Exact external private authority |
| runtime-observation.json | Originating actual interpreter observation as history |
| original-delivery.zip, when admitted | Exact full source/workspace/handover delivery |
| TRANSFER.json | Complete member inventory and identities |

The private transfer schema is stellar-forge.staff-portal-source-transfer.v1. It is a source-installation container, not a replacement workspace/archive engine. Source rows must equal SOURCE.json; receiving requires the exact declared member set and rejects extra payload.

Export retains its destination and complete inventory before writing. It checks source files before and after full streaming. Existing complete output is validated and reused. A complete candidate surviving interruption is reused; an incomplete candidate is preserved before rebuilding the same selection. Final output is private and fsynced before publication.

Receive with the actual independent host's compatible interpreter:

~~~sh
node /absolute/receiving-installed/package/source/products/staff-portal-workbench/prepare.mjs receive \
  --directory /absolute/private/staff-receiving-preparation \
  --python /absolute/receiving/python \
  --archive /absolute/private/incoming/staff-source-transfer.zip \
  --archive-sha256 ACTUAL_EXPORTED_SHA256
~~~

The resulting paths, authority and Python observation belong to that receiving host. No live endpoint, session cookie, CSRF value, agent connection, writer or native worker is relocated.

The complete installed Merchant distribution, private source transfer and native customer operating delivery are separate artifacts. Recreate private host configuration with returned paths. Do not imply one container supplies all three independent authorities.

## 7. Programmatic ABI and lifetime

The four exported functions are:

~~~js
prepareStaffPortalRuntime({
  directory, python, source,
  'source-manifest': sourceManifestFile,
  'source-manifest-sha256': sourceManifestSha256,
  resume: true
});
receiveStaffPortalRuntime({
  directory, python, archive,
  'archive-sha256': archiveSha256,
  resume: true
});
inspectStaffPortalPreparation({directory, python});
exportStaffPortalRuntime({directory, python, output});
~~~

Each returns the full helper result. An optional signal is an AbortSignal. Inherited PYTHONPATH, PYTHONHOME, PYTHONUSERBASE and PYTHONSTARTUP are cleared. Isolated Python mode and the exact invocation are retained.

One nonblocking kernel flock owns the preparation root. The actual original inspection child inherits it. Its log streams and closed observation are saved before the helper releases ownership. The Node wrapper waits for actual child close, including spawn error and explicit stop, before ending. Exit-code fields alone are not closure.

A busy result means the original owner remains authoritative. Continue that original operation; do not switch directories to bypass ownership. Source changes require a newly selected installation or the existing source-adoption workflow. An interruption does not authorize replacing an archive, resetting a workspace, editing older history or reissuing a publishing effect.

## 8. Native receiving and actual product use

The installed receiving course owns workspace intake, important controls, exact request replay, full native references, complete operating export and independent reopen. Preparation supplies only actual source/runtime paths and identities.

The producing operator must open the exact outgoing product and usable archive contents, see the actual desktop/mobile screens, operate important controls, inspect reports and downloads, and reopen exports. A preparation receipt does not establish a native run, browser journey or usable customer result.

When the existing host is unavailable, retain the exact source and complete opening instructions with the already selected equipped receiver. Continue independent engineering. Do not enable hosted Actions, invent a browser result, or duplicate the original native controller.

## 9. Current owner rendered-product instruction

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
Canonical attachment/media clarification: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949


## 10. Delivery and communication

Keep the complete private journal, exact authority, both source trees, original operating delivery, closed inspection logs and exported digest with the existing private operation. Only the newly authored generic adapter belongs in public source.

Preserve original commercial terms, authors, requests, accepted outcomes and native identities. Internal engineering is not authority for a customer message. Any positive human relationship stays with its original sender and current Bryce approval requirements for each message and attachment. This preparation sends no communication.
