# Preparing Catalogue Delivery Workbench

This command prepares the complete privately supplied Catalogue Delivery application for the installed Merchant adapters. It retains the original delivery, implementation and approval interfaces, all 34 native MCP tools, the approval bridge and backend operating source. It creates two independent private application copies and observes the actual local CPython runtime.

The public product contains generic integration and receiving code. The selected original application, its exact source authority, original operating packages, CKAN credentials, source editions and customer records remain in their existing authorized private Slack, Pages and file custody. Do not publish them to public repositories, public channels or artifacts, source chapters or customer-agent arguments. Preserve the original source and customer-operation owners.

Preparation finishes with a source/runtime result. It does not open a business workspace, start a web listener or worker, create a CKAN destination, run Docker, publish a dataset or exercise the customer's approval roles. Those effects stay in the original application and its already selected native receiving operation.

## 1. Select the complete private application

The supplied authority is an exact UTF-8 JSON file with this shape:

~~~json
{
  "schema": "stellar-forge.catalogue-delivery-workbench-source.v1",
  "files": [
    {"path": "__init__.py", "bytes": 123, "sha256": "actual_complete_file_sha256"}
  ]
}
~~~

The example illustrates a row, not a usable authority. For the current retained original edition, the authority declares all 38 members, with the real SHA-256 and complete byte count of every member. The reusable preparer accepts the whole explicitly selected authority and exact directory inventory; it does not embed this private edition’s count or digest as a source pin. Duplicate paths, case-colliding paths, symlinks, missing members, additional source files and partial files are rejected. The source selection includes the original Python application, both static asset directories, approval bridge, backend Docker/Compose scripts and all original guides. Total source capacity is 32 MiB.

Select the exact authority SHA-256 separately. The authority's literal bytes and row order are retained as supplied. When receiving a source transfer with an independently supplied authority, the receiver compares the full path-to-byte/hash maps without treating JSON row order as an application change; it still preserves the supplied authority bytes and their exact SHA.

The original implementation export deliberately includes only selected suffixes from its source tree. It therefore omits some backend files, including YAML, TOML, shell and Docker source. Do not treat that operating ZIP as the complete 38-file application. Supply the full original source folder plus its authority, or use the complete private source transfer produced by this preparation command.

The original implementation ZIP, delivery exports and full approval archives remain separate operating artifacts. Receive them through the original application readers and the complete [installed receiving course](RECEIVING.md). The preparation command does not rewrite their manifests, substitute a new CKAN backend or turn a completed local MCP result into a claim that a remote CKAN/approval programme has completed.

## 2. Local runtime and private paths

Use Linux with a real CPython 3.11 or later interpreter. The local application uses the Python standard library. Preparation observes the selected executable invocation, resolved executable bytes, Python version, implementation, platform, architecture, ABI, cache tag, SQLite version and the actual relevant standard-library module files. It does not install packages, copy a virtual environment or download an interpreter.

The command imports the exact original source in an isolated private package namespace on both application copies. This preserves the relative imports used by the approval interface. The import observation verifies all 34 original tool declarations and records every imported original module's complete byte/hash identity. It calls no Store constructor, web factory, operator worker or provider action. The full command, stdout, stderr and closed outcome are retained.

Keep these paths distinct:

| Selection | Meaning |
| --- | --- |
| Installed public product | The Merchant package containing these generic adapters and guides. |
| Original private source | The authorized full 38-file donor application. Read-only source may use ordinary owned directory modes. |
| Source authority | A private 0600 JSON file outside the source tree and business data. |
| Preparation directory | A private 0700 directory outside both the public package and donor source. |
| Primary application | The returned independent private source copy for the first managed host. |
| Receiving application | A second complete independent source copy for the receiving managed host. |
| Business workspaces | Original application data directories, distinct from all source and preparation paths. |
| Portable output | A private ZIP outside the preparation and installed public source directories. |

Create the selected preparation parent beforehand. Use normalized absolute paths. Every copied source directory is private and ordinary; symbolic links are not admitted into the source copies. The actual Python invocation path is retained, including a selected interpreter symlink, while its resolved executable identity is measured.

Environment keys PYTHONPATH, PYTHONHOME, PYTHONUSERBASE and PYTHONSTARTUP are removed from preparation and import child environments. The selected original module namespace is introduced explicitly after full source verification. Bytecode writing is disabled. Backend-specific packages such as CKAN, PostgreSQL bindings and the approval plugin remain the separately selected original backend runtime; their source is carried intact but is not imported or installed by this local preparation.

## 3. Prepare from a trusted full source folder

From a source checkout, use the full Node script. In the installed distribution, use `starforge catalogue-delivery-workbench-prepare` with the same arguments.

~~~sh
node products/catalogue-delivery-workbench/prepare.mjs prepare \
  --directory /srv/private/catalogue-preparation \
  --python /usr/bin/python3.12 \
  --source /srv/private/original-catalogue-application \
  --source-manifest /srv/private/intake/catalogue-source.json \
  --source-manifest-sha256 ACTUAL_AUTHORITY_SHA256
~~~

Replace the example paths and digest with the original selected inputs. The command verifies every member of the complete supplied authority before copying or importing private code. It then copies the complete source independently to the returned primary and receiving applications, verifies both complete inventories, observes the actual runtime and imports both private packages.

The stable request includes the selected source or incoming archive identity, source authority identity when supplied, exact runtime observation and preparation-helper identity. A retry must use this same request. It does not silently switch interpreter, source selection, request directory or helper version.

A successful result has schema `stellar-forge.catalogue-delivery-preparation.v1`, state `READY`, and these fields:

| Field | Contract |
| --- | --- |
| `directory` | The exact preparation directory. |
| `resultPath` | `directory/.preparation/PREPARED.json`. |
| `request` | Complete `{path,bytes,sha256}` descriptor of the immutable original REQUEST.json. |
| `source` | `{manifestSha256,files,bytes}` (38 files in the current original edition) for the whole selected private application. |
| `runtime` | Actual local CPython and standard-library observation. |
| `origin` | Original source-folder selection or incoming private transfer identity. |
| `packageImports` | Full primary and receiving import results, with their closed command/log identities. |
| `primary`, `receiving` | Each is `{applicationDirectory,sourceManifestFile,sourceManifestSha256,python}`. |

There is no runtimeReadyFile. Use the actual returned fields. Both applications share the immutable authority at `.preparation/SOURCE.json`; their complete application directories are separate. The authority remains outside both source copies.

The final PREPARED result is published from a stable, immutable candidate after all original import children have closed. If publication acknowledgement is lost, the same request reopens and verifies the exact candidate/result instead of manufacturing a new completion identity.

## 4. Inspect and resume the same preparation

~~~sh
node products/catalogue-delivery-workbench/prepare.mjs inspect \
  --directory /srv/private/catalogue-preparation \
  --python /usr/bin/python3.12
~~~

Inspection returns an envelope whose `result` is the complete PREPARED object. It verifies the helper and original request, remeasures the selected actual Python identity and all original source members in both applications, and checks the full retained successful import receipts and their module/tool selections. It does not create a new application operation or start a customer worker.

If preparation was interrupted before PREPARED publication, resume the original command with identical inputs and `--resume`. Completed copies and successful import observations are adopted through their full identities. Unknown or partial copy candidates are preserved under private metadata outside the source inventories. A repeated attempt does not truncate an admitted source file or erase the prior failed import command/logs.

~~~sh
node products/catalogue-delivery-workbench/prepare.mjs prepare \
  --directory /srv/private/catalogue-preparation \
  --python /usr/bin/python3.12 \
  --source /srv/private/original-catalogue-application \
  --source-manifest /srv/private/intake/catalogue-source.json \
  --source-manifest-sha256 ACTUAL_AUTHORITY_SHA256 \
  --resume
~~~

One kernel file lock owns the entire preparation action and is inherited by actual import children. Stop waits for the retained child to close before the preparation lease is released. SIGTERM/SIGINT are masked during process acquisition and restored only after the child is retained; the child restores normal signal handling before executing the exact selected interpreter. A busy lock means the original owner still owns that preparation.

Do not replace or delete the lock, change the request to force a retry, invent a successful import result, or remove original failed command outputs. A new source edition or interpreter is a new selected preparation, with the prior edition retained.

## 5. Export the complete private source and runtime observation

~~~sh
node products/catalogue-delivery-workbench/prepare.mjs export \
  --directory /srv/private/catalogue-preparation \
  --python /usr/bin/python3.12 \
  --output /srv/private/handovers/catalogue-source-runtime.zip
~~~

Export first inspects the original preparation. The private ZIP contains the exact complete 38-file application under `source/`, the exact selected `SOURCE.json`, full runtime and package-import observations under `runtime-observation.json`, and the complete transfer manifest `TRANSFER.json`.

The runtime observation includes both successful original import results and the complete command, stdout and stderr bytes with their identities. Paths inside these historical observations describe the original host; they are observations, not paths to adopt on the receiving host.

The ZIP uses a complete declared member set and checks every member before publication. The original target path and member selection are frozen in an export intent. A completed export is reopened and rehashed; a completed candidate is adopted. Interrupted candidates are retained separately, and the final output is never silently overwritten with a different selection.

The result has the same preparation schema, state `EXPORTED`, and `portable:{path,bytes,sha256}` plus `source`. Keep the actual portable descriptor with the complete file. It is a private source/runtime transfer, not a customer operating backup or the public Merchant distribution.

A complete delivery has distinct layers:

| Layer | Required material |
| --- | --- |
| Public installed integration | Exact Merchant archive, source manifest, runtime installation and these generic adapters/guides. |
| Private application/runtime | The full 38-file source-transfer ZIP and its exact SHA/bytes. |
| Original customer implementation | Its whole original implementation ZIP, original request/pending histories and applicable source/delivery files. |
| Original approval workflow | Complete approval archives and native results retained by the original approval receiving reader. |
| Equipped CKAN destination | Existing backend selection, actual host/service outputs, original journals and credential references in their authorized custody. |

Keep these layers together in the authorized final handover without merging their different identities or claiming one layer contains another.

## 6. Receive the private application on another host

~~~sh
node products/catalogue-delivery-workbench/prepare.mjs receive \
  --directory /srv/private/received-catalogue-preparation \
  --python /usr/bin/python3.12 \
  --archive /srv/private/incoming/catalogue-source-runtime.zip \
  --archive-sha256 ACTUAL_COMPLETE_ARCHIVE_SHA256
~~~

The archive must be private and outside the receiving preparation. Before extraction, the receiver validates the exact archive digest, safe ordinary members, complete declared closure, literal source authority, every source byte/hash and full runtime-observation member. It rejects extra payload, duplicate members, path traversal, symlinks, encrypted members and omitted backend source.

The receiver preserves the original runtime observation, creates two new independent local application copies, measures the receiver's actual Python runtime and imports both selected packages locally. It does not copy or relocate a virtual environment, and it never substitutes source-host absolute paths for the receiving paths.

You may additionally supply `--source-manifest` and `--source-manifest-sha256` when the receiving operator has independently selected the exact external authority. Both arguments are required together. Complete source map equality is order independent; the selected authority literal bytes remain authoritative. Retain the resulting local PREPARED, request, import observations and source-transfer identity alongside the sender's original result.

Receiving can use a different valid CPython 3.11+ installation because this product has no external local-host dependencies. That local runtime is explicitly observed and bound to the new receiving preparation; it is not falsely described as the sender's binary. Resume within either host must keep that host's original selected invocation and identity.

## 7. Join managed Applications and the original operating course

Use the returned primary application fields for the original managed host and the returned receiving fields for the independent receiving host. Keep private source authority, connection files, token environment references, business data and log directories outside the public package.

The managed launch selects the original private package, one shared original Store and its original worker. All delivery, implementation and approval views operate that same original state. The installed tools use the original native MCP Operator and retain full response/file histories. Starting the public adapter must not create an alternate CKAN target or replay an already accepted publication.

The complete installed receiving course is documented in [RECEIVING.md](RECEIVING.md). It adopts the existing original destination programme and completed operating artifacts, then continues the managed Applications, original tool, browser, full-export and cold-reopen work. A local prepared/imported package does not establish that a Docker backend was accepted, a 144/546-row destination update was sent, or an approval action completed.

For a current customer conversation, preserve the original sender and case. After any positive human contact, each individual outgoing message and its attachments require Bryce's explicit approval for that exact send; an earlier approval does not authorize a later message. Internal implementation and source delivery continue without adding a new customer-contact controller.

## 8. Programmatic interface

The Node module exports:

~~~js
import {
  prepareCatalogueDeliveryRuntime,
  receiveCatalogueDeliveryRuntime,
  inspectCatalogueDeliveryPreparation,
  exportCatalogueDeliveryRuntime
} from './prepare.mjs';

const result = await prepareCatalogueDeliveryRuntime({
  directory: '/srv/private/catalogue-preparation',
  python: '/usr/bin/python3.12',
  source: '/srv/private/original-catalogue-application',
  'source-manifest': '/srv/private/intake/catalogue-source.json',
  'source-manifest-sha256': selectedAuthoritySha,
  resume: false,
  signal
});

const checked = await inspectCatalogueDeliveryPreparation({
  directory: result.directory,
  python: result.primary.python
});
const samePreparedResult = checked.result;
~~~

Options retain the exact CLI spellings, including hyphenated keys. `receiveCatalogueDeliveryRuntime` takes `archive` and `'archive-sha256'`; `exportCatalogueDeliveryRuntime` takes `output`. All functions accept an optional AbortSignal. The wrapper does not return until the actual Python child's close event, including spawn or stream failure. It preserves the original selected absolute interpreter invocation.

Use the private PREPARED descriptor paths directly. Do not reconstruct a guessed application path, embed original customer inputs into tool arguments, or treat the stdout of a failed child as a successful preparation.

## 9. Actual rendering and attachment inspection

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
Canonical attachment/media clarification: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949


## 10. Evidence and completion language

A source review or saved code carrier means the implementation is prepared. A real successful PREPARED means this exact local source/runtime intake and both package imports completed. A successful source export means the complete selected private source/runtime archive was published and verified. The original operating and installed receiving programmes have their own native outcomes.

Retain those distinctions in handover notes. When the original host is unavailable, join its existing equipped owner with the exact package, source-selection inputs and opening steps. Keep the same operation identity and continue independent implementation while it runs. Do not create a second native programme, rerun accepted provider effects, enable hosted GitHub Actions, or present the application or any outgoing attachment as ready before observing the actual rendered result.
