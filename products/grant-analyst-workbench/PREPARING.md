# Grant Analyst Workbench — private source and runtime preparation

This guide covers complete private source intake, independent primary and receiving application copies, actual local Python observation, complete source transfer and the join to the original analyst, Learning and commissioned-study workflows. The installed public product contains generic integration code. The original application, commissioned inputs, grant data, evidence and customer outputs remain in their authorized private custody.

Preparation does not operate a grant workspace, create a Learning cycle, answer a commissioned question, start a web server or repeat a completed native programme. Its actual Python children import the selected original modules and report their identities and action declarations. The installed receiving course in [RECEIVING.md](RECEIVING.md) uses the resulting exact applications with the original completed handover and retained operation.

## 1. Select the complete private original source

Supply the complete original source root with this layout:

~~~text
PRIVATE_SOURCE/
  application/
    analyst.py
    learning.py
    study.py
    public/
    ...every member of the original analyst.SOURCE_FILES declaration
  receive_commission.py
  commission-template.json
  COMMISSIONED_RECEIVING.md
~~~

The current private edition has 23 application members and three commissioned receiving members. The reusable preparer does not embed those private bodies, their customer identity or a fixed source digest. It validates the complete supplied authority, reads the original literal SOURCE_FILES declaration without executing it, and requires its exact application-prefixed member set plus the three commissioned receiving leaves. Retain every original source file, including original workflow drivers, guides, browser files and commissioned receiving instructions.

Use a private 0600 authority file outside the source and business data. Its exact schema is:

~~~json
{
  "schema": "stellar-forge.grant-analyst-workbench-source.v1",
  "files": [
    {"path": "application/analyst.py", "bytes": 123, "sha256": "ACTUAL_64_LOWERCASE_HEX_DIGEST"}
  ]
}
~~~

This is a shape example, not a usable complete authority. Supply every selected member with its literal path, byte count and SHA-256. The schema accepts only schema/files and exact path/bytes/sha256 rows. Duplicate or case-colliding paths, unsafe paths, symlinks, special files, missing files and undeclared ordinary members fail before import. The required core includes the three modules, all three views and their scripts, original workflow drivers and the commissioned receiving leaves. The complete source is bounded to 32 MiB, the authority metadata to 4 MiB and at most 25,000 members.

Retain the authority's exact literal bytes and SHA separately. Row order does not change the selected source map. If an incoming source transfer is received with an independently supplied authority, equality uses the complete path-to-byte/hash map while the independently supplied authority's literal bytes remain selected.

A native analyst operating handover contains source for its original application and the original business workspace. It does not by itself supply the three separately maintained commissioned receiving leaves. A larger outer customer package may contain a native operating handover as one member; do not feed that outer package to a reader expecting the native analyst handover schema. Select and retain the actual unchanged inner member from the measured archive inventory.

Keep private original sources and inputs in their existing authorized private Slack/Pages/file custody. Do not publish them to public repositories, public channels/artifacts, source chapters or customer-agent arguments. The complete public adapter package and private application transfer have distinct identities and destinations.

## 2. Local runtime and source paths

Select an actual Linux CPython 3.10 or later interpreter. The original application uses the standard library. No pip installation, external package download, copied virtual environment or interpreter download is performed.

The preparer measures the selected executable invocation and resolved binary bytes, Python version, implementation, architecture, platform, ABI and cache tag. It also retains identities for the relevant standard-library module files, including JSON, ZIP, Decimal, hashing, HTTP and file-lock support. The actual invocation is preserved, including an explicitly selected interpreter symlink; the resolved executable is measured independently.

Both private application copies are imported with isolated Python mode and bytecode writing disabled. PYTHONPATH, PYTHONHOME, PYTHONUSERBASE and PYTHONSTARTUP are removed from the preparation and import child environment. The selected application directory is added explicitly only after every source member has been validated.

The child imports learning.py, study.py and analyst.py as their original standalone module names. It preserves the original analyst module's references to those exact learning and study modules and checks the original PROGRAM path. It observes original initialize/mutation/export/receive/serve entry points and all twelve mutation names: import, codebook, review, cycle-create, cycle-action, cycle-review, study-create, study-questions, study-scope, study-evidence, study-answer and study-release. It does not call those mutations or initialize a workspace. Every imported private module is bound to the supplied byte/hash authority.

Keep these path selections distinct:

| Path | Purpose |
| --- | --- |
| Installed public product | Generic Merchant adapters, preparation, receiving and operating guides. |
| Original private source root | Entire authorized original application plus commissioned receiving source. |
| External authority | Private selected JSON outside original source and customer data. |
| Preparation root | Private 0700 directory outside installed source and original donor source. |
| Primary applicationDirectory | Returned whole source root; original modules are beneath its application/ directory. |
| Receiving applicationDirectory | A separate complete whole source root with its own application/ directory. |
| Business workspace | Original analyst data, requests, reports and Learning/study history, outside preparation/source. |
| Portable source output | Private complete source ZIP outside preparation and installed public source. |
| Native operating ZIP | Original workspace/report/application handover, received by the unchanged original reader. |

Create the preparation root's parent first. Use normalized absolute paths and owned ordinary files/directories. Original read-only donor source may have ordinary readable directory permissions; copied source directories and preparation metadata are private. Do not add a manifest, receipt or bootstrap file inside the selected source inventory.

## 3. Prepare the two complete local application copies

From a source checkout:

~~~sh
node products/grant-analyst-workbench/prepare.mjs prepare \
  --directory /srv/private/grant-preparation \
  --python /usr/bin/python3.12 \
  --source /srv/private/original-grant-source \
  --source-manifest /srv/private/intake/grant-source.json \
  --source-manifest-sha256 ACTUAL_AUTHORITY_SHA256
~~~

The installed command is starforge grant-analyst-workbench-prepare with the same arguments. The Python path is an example; use the actual selected CPython 3.10+ invocation.

Preparation records an immutable request containing the selected full source or incoming archive, optional independently supplied authority, actual runtime observation and helper identity. It verifies the whole source before copy and import, copies all members independently to both applications, then imports each complete copy with the actual selected Python. Full command argv, start/closed outcome, stdout and stderr identities and bytes remain in private package-imports records.

Successful PREPARED fields are:

| Field | Meaning |
| --- | --- |
| schema | stellar-forge.grant-analyst-preparation.v1 |
| state | READY |
| directory | The selected private preparation root. |
| resultPath | directory/.preparation/PREPARED.json |
| request | Exact path/bytes/sha256 of the retained immutable REQUEST.json. |
| source | manifestSha256, files and bytes of the full selected authority. |
| runtime | Actual local interpreter and standard-library observation. |
| origin | Original donor source selection or incoming complete source transfer identity. |
| packageImports | Full primary and receiving successful original module-import observations. |
| primary and receiving | Each has applicationDirectory, sourceManifestFile, sourceManifestSha256 and python. |

There is no runtimeReadyFile. Use the actual returned fields without inventing a different path. The complete private roots are directory/primary/source and directory/receiving/source. Each contains application/ plus the three commissioning leaves. Both bind the original authority at directory/.preparation/SOURCE.json, outside both source trees.

All import children must close before the successful result is published. A stable immutable candidate preserves the original completedAt and complete source/runtime/import selection across a lost final acknowledgement. The same request reopens the original candidate/result instead of replacing it with a new completion.

## 4. Inspect and resume the original preparation

~~~sh
node products/grant-analyst-workbench/prepare.mjs inspect \
  --directory /srv/private/grant-preparation \
  --python /usr/bin/python3.12
~~~

Inspection returns the preparation schema/state and result containing the full PREPARED object, plus verifiedAt. It remeasures the original helper, immutable request and actual Python selection; verifies every member in both source copies; and reopens the full original successful module-import observations and closed command logs. It does not launch another import child or business operation merely to inspect a completed preparation.

An unfinished preparation requires the same original command and --resume. Keep all selected paths, source hashes, helper and runtime identity unchanged:

~~~sh
node products/grant-analyst-workbench/prepare.mjs prepare \
  --directory /srv/private/grant-preparation \
  --python /usr/bin/python3.12 \
  --source /srv/private/original-grant-source \
  --source-manifest /srv/private/intake/grant-source.json \
  --source-manifest-sha256 ACTUAL_AUTHORITY_SHA256 \
  --resume
~~~

The original successful copies and import receipts are reused after complete verification. Partial copy candidates stay under private metadata outside immutable source inventories. Source publication uses complete verified candidates, synchronized files and parent directories. A failed original import retains its full command and output before another explicit continuation; no successful import is invented from an absent result.

A single kernel file lock owns preparation and is inherited by the actual import child. SIGTERM/SIGINT are blocked while the OS child is acquired and assigned to its retained owner, then restored; the child restores normal handling before executing the selected interpreter. Stop closes the real child and waits before releasing the lease. The Node wrapper waits for the actual close event, including spawn and stream errors.

Do not delete or replace a busy lock, erase a failed attempt, change original request bytes to force an operation or reuse one preparation root for a different source/runtime. A changed selected edition belongs to a new explicit preparation while the earlier one remains intact.

## 5. Export the complete private source transfer

~~~sh
node products/grant-analyst-workbench/prepare.mjs export \
  --directory /srv/private/grant-preparation \
  --python /usr/bin/python3.12 \
  --output /srv/private/handovers/grant-source-runtime.zip
~~~

Export inspects the complete existing preparation first. Its ZIP contains every exact private authority member under source/, the unchanged literal SOURCE.json, runtime-observation.json and TRANSFER.json. The observation retains both actual original imports, complete command/log contents and their identities. Historical source-host paths remain historical observations; the receiver does not adopt them as its own paths.

The transfer manifest declares the exact complete member set and every member's bytes/SHA. Extra payload, omissions, duplicate paths and altered source are rejected. The selected output path and manifest are saved as an immutable intent. A completed existing ZIP is fully reopened and verified. A complete candidate is reused; an interrupted candidate is retained separately. The final export never silently overwrites a different selected archive.

The export result uses the preparation schema, state EXPORTED, source summary and portable:{path,bytes,sha256}. Retain the complete ZIP alongside that descriptor. The portable source capacity is 48 MiB, including all source and observations; this is separate from the original application's larger operating-handover capacity.

A complete installed delivery preserves each layer:

| Layer | Complete material |
| --- | --- |
| Public Merchant integration | Exact installed distribution archive, manifest, installation and generic adapters. |
| Private original source | All selected application and commissioned receiving source plus literal external authority. |
| Source/runtime transfer | Complete source ZIP, manifest and source-host import/runtime observations. |
| Original analyst operating handover | Unchanged native ZIP, workspace requests/history, source and rendered reports. |
| Completed Learning result | Actual completed outcome and its exact selected native handover, retained within any original outer package. |
| Commissioned study | Actual selected intake/evidence/reviewer, original operation and completed result when available. |
| Receiving continuation | Actual local prepared copies, received workspace, installed tool/browser results and onward full exports. |

A pending study does not invalidate an already completed Learning handover. Preserve each original operation and its actual status; do not rerun completed work to manufacture a combined status.

## 6. Receive the complete source on another host

~~~sh
node products/grant-analyst-workbench/prepare.mjs receive \
  --directory /srv/private/received-grant-preparation \
  --python /usr/bin/python3.12 \
  --archive /srv/private/incoming/grant-source-runtime.zip \
  --archive-sha256 ACTUAL_COMPLETE_ARCHIVE_SHA256
~~~

The incoming file is private and outside the new preparation directory. The complete selected archive digest is checked before admitting source. The receiver verifies safe ordinary ZIP members, exact declared closure, literal source authority and all byte/hash identities, then the complete preserved runtime/import observation. No archive member executes during this initial admission.

It then makes two independent local copies and performs the same actual isolated imports using the receiver's selected Python. The full private source remains unchanged. No virtual environment is relocated and no old absolute source-host paths replace returned local paths.

You may additionally provide both --source-manifest and --source-manifest-sha256 when an independently selected authority exists. The source maps must match completely. The selected supplied authority's literal bytes and SHA are preserved even when its rows use another order.

A receiving host may select another valid CPython 3.10+ installation. Its local interpreter and import observations are measured and retained as new receiving facts, alongside the original source-host observations. Within a given preparation, resume must retain that host's original selected Python identity.

## 7. Managed host and original operating handover

Use primary's returned whole applicationDirectory, sourceManifestFile, sourceManifestSha256 and python for the primary managed launch; use receiving's fields for its independent host. The managed bridge imports the original application/ modules and operates the original native workspace and mutation semantics. Its separate operator writer ownership must not replace or interfere with the original per-mutation grant workspace lock.

Receiving an operating handover belongs to the unchanged original analyst reader and installed receiving course. Preparation's receive command accepts its complete source transfer schema, not an arbitrary customer outer ZIP. Inspect the retained outer package's actual inventory, extract the verified native inner handover without changing its bytes and preserve both outer and inner identities. Do not infer the actual selected inner path from a workflow driver's intended filename.

The installed course can use a completed Learning donor immediately while retaining a commissioned-study branch as optional until its original operation completes. Preserve the commissioned request, reviewer, source selection and evidence already held by that owner. No placeholder evidence, invented answers or second study run is part of source preparation.

The source has standalone imports, not a package __init__.py requirement. Pass the returned whole root unchanged; the bridge owns the application/ module binding. Keep customer data, connection secrets, source authority, outputs and private process logs outside installed public source.

## 8. Programmatic interface

~~~js
import {
  prepareGrantAnalystRuntime,
  receiveGrantAnalystRuntime,
  inspectGrantAnalystPreparation,
  exportGrantAnalystRuntime
} from './prepare.mjs';

const result = await prepareGrantAnalystRuntime({
  directory: '/srv/private/grant-preparation',
  python: '/usr/bin/python3.12',
  source: '/srv/private/original-grant-source',
  'source-manifest': '/srv/private/intake/grant-source.json',
  'source-manifest-sha256': selectedAuthoritySha,
  resume: false,
  signal
});
const observed = await inspectGrantAnalystPreparation({
  directory: result.directory,
  python: result.primary.python
});
const prepared = observed.result;

const transfer = await exportGrantAnalystRuntime({
  directory: prepared.directory,
  python: prepared.primary.python,
  output: '/srv/private/handovers/grant-source-runtime.zip'
});
~~~

Programmatic options use the exact hyphenated CLI names. receiveGrantAnalystRuntime uses archive and 'archive-sha256', optionally the authority pair. Every wrapper accepts an AbortSignal and retains actual child ownership through close. parseArguments and main are also exported for the installed command.

Use returned descriptors directly. A failed child, a saved source Page, a parsed JS body or a review receipt is not a successful PREPARED or a completed native customer programme.

## 9. Render and attachment inspection

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
Canonical attachment/media clarification: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949


## 10. Communication and completed delivery

After any positive human contact, each individual outgoing message and its attachments require Bryce's explicit approval for that exact send. Approval of an earlier message does not approve a later one. Preserve the original company/case/sender and existing private custody. Internal implementation, source assembly and original equipped-owner coordination continue within their existing authorization.

Record source review, actual preparation, original operating completion, installed receiving and rendered inspection as distinct facts. When a runtime is unavailable, send the exact complete version and opening course to the existing equipped owner, keep the same operation, and continue independent implementation. Do not enable hosted GitHub Actions, launch a duplicate native programme or present an unobserved attachment as a finished customer result.

Retain the full source/authority, PREPARED, request, module import commands and logs, complete source-transfer ZIP, actual native donor outcome and handover, local receiving outputs and final onward archive. The receiver should be able to reopen the original result and the independently operated receiving edition from their complete files.
