# Installed Runtime Companion archive receiving

This source-owned capability makes the complete reviewed archive/source consumer available through the installed `starforge` catalogue. It keeps the original ZIP readers, adds Python standard-library TAR intake, and retains the mixed Python/JavaScript collectors, Acorn parser, receiving journals, Runtime Files, Companion file sets and working-copy preparation. It creates no application, workspace, native controller or replacement parser.

The two commands are registered by `contributions/runtime-companion-archive.json`:

| Command | Original operation |
| --- | --- |
| `starforge runtime-companion-source` | Collect an ordinary ZIP, TAR or tar.gz into the complete source packet; inspect or receive the same packet using the unchanged collectors. |
| `starforge runtime-companion-archive` | Receive into an existing Runtime, review its saved originals, prepare one retained working copy, or export complete original source for independent receiving. |

`starforge registrations --source runtime-companion-archive` displays the complete registration. `starforge registrations --command runtime-companion-archive` identifies its exact installed entrypoint. Both commands appear in ordinary `starforge --help`. The direct package exports `./runtime-workspace/companion-archive` and `./runtime-workspace/application-archive-source` expose the original CommonJS APIs; direct API consumers continue to supply explicit trusted Runtime source and existing workspace identities.

## Complete source and installation

The `toolkit/` directory contains the complete original 28-file source family plus three TAR source/guide members. Five original consumer/receiving bodies are advanced coherently; the mixed collectors, parser engine, strict ZIP codec, Runtime API and installed wrappers stay at their original source. `SOURCE_EDITION.json` lists all 31 complete current members and the exact original 28-file edition. Its historical ZIP identity describes that predecessor, not the current TAR toolkit.

The contribution declares the complete directory and every original toolkit member explicitly. This includes Python modules, CommonJS helpers, original examples, Acorn source and its MIT license, so source collection does not depend on inferring CommonJS or Python imports. The dedicated recipe also selects the maintained Runtime workspace and its existing `runtime-application-inputs` contribution. Its original browser declarations, import closure and runtime dependencies are resolved by the maintained builder.

From the complete trusted checkout, select an immutable published commit:

```sh
node stellar/scf-starforge-20261009/distribution/build.mjs \
  --repo /absolute/trusted/checkout \
  --ref ORIGINAL_COMMIT \
  --selection runtime-companion-archive \
  --out /absolute/private/companion-release \
  --offline
```

Use the resulting original package through its normal installation/receiving procedure. The original builder binds the selected recipe, contribution, source, browser and package manifests to that commit. If preparation was interrupted, use the same original output with the builder's `--resume` option. Do not mix source commits inside a retained build.

Use the Node version required by the installed release (the current Runtime uses Node 24 capabilities), an existing Python 3 executable, and the original supported POSIX host. The original Runtime kernel lease and parser owner handling remain required. No hosted CI is needed or authorized.

The installed consumer derives its trusted Runtime source from the adjacent `distribution/runtime-workspace` inside the same source installation. It refuses a `--runtime-source` override. The original direct toolkit command remains available for an operator intentionally selecting a different trusted source. Neither command reads executable authority from the incoming packet or receiving receipt.

## TAR and tar.gz source

The same `runtime-companion-source collect` command accepts `--archive-format tar` or `--archive-format tar.gz`, preserving the complete original bytes. Read [the full TAR source/receiving guide](toolkit/host/TAR_APPLICATION_SOURCE.md) for exact commands, standard-library parsing, format bounds, complete original member mapping and cold verification. `inspect` and `receive` read the explicit packet format. No wrapper or Runtime path changes are needed.

## 1. Retain the complete original source packet

If the complete original ZIP v1 or explicit TAR v2 archive-source packet is already retained, preserve its exact bytes and SHA-256 and proceed to receiving. Otherwise choose the original ZIP, its independently retained SHA-256, the actual source root inside that ZIP, and the complete mixed-source selection. The selection names the real Python/JavaScript entrypoints and explicit resources; it must not invent launch roots or application behavior.

```sh
starforge runtime-companion-source collect \
  --archive /absolute/input/original.zip \
  --sha256 ORIGINAL_ZIP_SHA256 \
  --member-root ORIGINAL_MEMBER_ROOT_OR_DOT \
  --selection /absolute/input/application-selection.json \
  --directory /absolute/private/original-source-operation \
  --output /absolute/private/application-source.json.gz \
  --gzip \
  --python /absolute/installed/python3
```

The unchanged collector retains the original ZIP bytes, member-root mapping, complete selected source, exact selection, parser source and findings. It does not import or run the selected application. An incomplete collector result remains incomplete; fix the actual selection/source issue within the original operation before complete receiving. The packet can be inspected with the original `inspect` command and received without Runtime with the original `receive` command; `runtime-companion-source --help` gives their full options.

Use the packet's actual complete SHA-256 for the next step. The consumer accepts exact JSON or gzip bytes. Original limits still apply: a retained input file must fit Runtime Files' 16 MiB limit; the Companion source set must fit 1,024 files, 4,096 directories, 16 MiB per member and 64 MiB total. Oversized or unsupported complete inputs are rejected before uploads. This capability does not divide a source edition to evade limits.

## 2. Receive into the existing Runtime

Select the actual original workspace directory and UUID from its existing owner. Do not initialize a substitute workspace, infer its UUID from an incoming file, or receive into an unrelated customer workspace.

```sh
starforge runtime-companion-archive receive \
  --input /absolute/private/application-source.json.gz \
  --sha256 ORIGINAL_PACKET_SHA256 \
  --directory /absolute/private/companion-receiving \
  --workspace /absolute/existing/runtime-workspace \
  --workspace-id ORIGINAL_WORKSPACE_UUID \
  --name "Original application source" \
  --python /absolute/installed/python3
```

The original readonly Runtime open checks the existing UUID before uploading. The consumer then reuses the original archive/source receiving operation, uploads the complete original packet to **Files**, retains the selected complete source through **Companion file sets**, and uploads the full association record. It downloads and hashes every saved member and both original Files inputs, closes the original Runtime model, reopens it, and repeats the saved identity checks before publishing its complete result.

The same private receiving directory owns the immutable input intention, original parser attempts, receiving lock, source mapping and final result. Retry the exact command with the same inputs, workspace UUID and directory. Existing complete uploads and chunks are reused. An uncertain or forced parser shutdown remains `DRAIN_UNCONFIRMED`; the exact original owner must be reconciled before another parser can start. The installed wrappers preserve that lifecycle and forward cancellation to the original command.

## 3. Review and prepare the retained working copy

```sh
starforge runtime-companion-archive review \
  --directory /absolute/private/companion-receiving \
  --workspace /absolute/existing/runtime-workspace \
  --workspace-id ORIGINAL_WORKSPACE_UUID
```

Open the existing Runtime browser. In **Files**, locate and download the original packet and its association by their actual saved upload IDs. In **Applications → Companion file sets**, find the original name/set ID and inspect its complete source manifest. The association binds the exact input, original ZIP, selected members, set manifest and originating workspace; the original packet retains executable modes. Companion itself does not promise preservation of executable modes.

For an existing application path setting, choose its actual application kind and field from the current original Applications catalogue. Retain one UUID for this preparation and reuse it after an uncertain response:

```sh
starforge runtime-companion-archive prepare \
  --directory /absolute/private/companion-receiving \
  --workspace /absolute/existing/runtime-workspace \
  --workspace-id ORIGINAL_WORKSPACE_UUID \
  --request-id ORIGINAL_PREPARATION_UUID \
  --kind ORIGINAL_APPLICATION_KIND \
  --field ORIGINAL_PATH_SETTING
```

Use `--member ORIGINAL_MEMBER_PATH` only when that original setting selects a file instead of the complete source directory. The command saves its exact preparation choice, then invokes the original `applicationInputSetPrepare`. Reopening an already prepared working copy preserves its current edits.

In the application setting choose **Use saved file → Retained working sets → Use current working set**, then operate the original **Review application**. Application Save and Start remain separate original operator actions. These receiving commands neither perform nor claim them.

## 4. Export and reopen independently

```sh
starforge runtime-companion-archive export \
  --directory /absolute/private/companion-receiving \
  --workspace /absolute/existing/runtime-workspace \
  --workspace-id ORIGINAL_WORKSPACE_UUID \
  --output /absolute/private/independent-source-export
```

The independent output contains the complete original packet, complete association, original Companion source-set ZIP and its exact receipt. The archive is independently reopened against the original set ID, manifest and origin workspace. Repeating export to the same exact output reconciles matching originals; it never overwrites a different export.

An independent receiving owner uses the exported original packet with this same installed command, a separate private receiving directory and their actual existing workspace/UUID. Preserve the original set name if reproducing its content identity. The original exported association keeps its original workspace attribution. The new receiver records its own actual workspace association without rewriting that earlier record.

## Current opening and owner custody

The installed command/source publication has undergone focused source and original-contract review. A packaged native build, filesystem receiving, Runtime/browser interaction and rendered outgoing attachments are **not established by that source review**. Continue the existing receiving owner's operation with this whole selected edition. Return actual build, receiving/reopening results and complete viewable images to the original thread; do not create another native controller or duplicate a live writer.

Bryce explicitly released his local in-app browser at **2026-10-13 16:29:39 UTC**, in the original coordination message <https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791908979290839>. Preserve existing tabs and saved state. This current release supersedes the temporary 16:00 reservation quoted inside the byte-preserved historical toolkit guides. It does not waive the complete rendered-product instruction below or authorize taking a browser already owned by another active operation.

The producing owner must open this exact selected release, operate catalogue/help, receive a real selected packet into the actual existing workspace, inspect Files and Companion at desktop/screenshare and narrow widths, open the complete manifest, prepare/reopen the original working copy and verify its edits remain, download both original Files inputs, export and reopen the full source ZIP and original packet. Observe the actual loading, empty and visible unsupported-input error states exposed by that workflow. Open every applicable outgoing attachment in its normal recipient view; inspect the actual screenshots personally. Return source/receiving findings separately from actual rendered findings.

Original source and receiving custody:
- Original archive/source product: <https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/4588>.
- Complete consumer: <https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/4612>.
- Original Runtime Companion operation: <https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791908908346609?thread_ts=1791843214.761669>.
- Installed integration ownership: <https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791909553272019?thread_ts=1791730220.899469>.

## Complete current repository owner instruction

The following original owner instruction is copied from the installed repository's complete `AGENTS.md` at `a21b71414113a1e9dc3e14335f166a85ef8a0950`. Preserve all other current repository/operation rules as well.

# Repository delivery instructions

Use the current README and the existing product's build/receiving guide. Coordinate through the original implementation and receiving owners, preserve concurrent source, and carry work through its authorized delivery.

## Rendered product inspection — owner instruction, 2026-10-13

This applies to every current, future, resumed and delegated worker, across providers and local or cloud runtimes. Bryce's standing rule is: “that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it”.

Before presenting a client/prospect-facing application, website, dashboard, demo, report, presentation, export or any attachment, the producing peer must open/run/render the exact outgoing version, LOOK at it and normally use it as the recipient would. View the actual screenshots you capture. Inspect the actual presentation/screenshare width and relevant narrow/mobile width, important user controls, populated/empty/loading/error states, downloads and reopened exports. Open the usable contents of ZIPs/projects and every applicable report/PDF page. Source review, schemas, HTTP 200, DOM counts, tests, checklists and another worker's approval cannot substitute for observing and using the actual product.

Fix broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Use plain industrial software design: readable tables, clear hierarchy, consistent typography and spacing, restrained controls, useful labels and responsive layouts. Preserve real workflows, source data and computations. Inspection must lead directly to repairs and continued delivery; it must not replace implementation/integration or become repeated checking. Keep validation focused on the actual remaining risk. Do not run broad test sweeps, repeat accepted checks, build a verification product or create review bureaucracy or an approval queue.

For video and audio, Bryce directs: “also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them”. Use available high-quality generative voice/TTS and useful generative media, with natural professional delivery. Actually watch/listen to the final outgoing export, including pacing, pronunciation, timing and audio alignment. Preserve existing spending, voice and attribution controls.

Include this complete instruction in delegated assignments and the active owner-controlled provider/project/cloud policy, boot, build and receiving guidance those workers actually read. Reuse already updated copies and return exact updated paths/version in the original policy thread with the next substantive result. Delivery of source does not establish that every runtime loaded it. Preserve all other owner controls and original operation identities; leave historical records and third-party/vendor policies intact. This instruction creates no restarts, watchers, credential gate or new release permission and does not revive owner-stopped work. When a runtime is unavailable, join the existing equipped receiver with the complete exact version and opening steps, review its actual rendered result, and continue independent implementation while it runs.

Owner instruction and coordinated propagation: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791881496221999
Canonical attachment/media clarification: https://tokenjunkielabs.slack.com/archives/C0BU51F1PL3/p1791885532614949

## GitHub Actions zero spend — existing owner instruction

Keep GitHub Actions disabled in this repository's provider settings and preserve the disabled source policy in [.github/hosted-ci-policy.json](.github/hosted-ci-policy.json). Every workflow job must retain the established literal-false condition, including manual dispatch and reusable jobs. Preserve its original condition inside the wrapper, and preserve the complete steps, commands, source and delivery artifacts.

Run focused product work in the existing cloud Linux or original local receiving operation. A public repository, available free minutes, cloud admission failure or a missing green check does not authorize enabling or dispatching hosted Actions. Do not set `HOSTED_CI=on`, add scheduled hosted runs or choose a paid runner. Keep source-native receiving moving with its original owner and saved operation.

Before publishing workflow changes, use the maintained Commons `tools/hosted_ci_gate.py --zero-spend REPO_ROOT` and `--check REPO_ROOT` source operation where that existing runtime is available. Its canonical wrapper is `${{ (false) && (ORIGINAL_CONDITION) }}`; the original condition is retained for native continuation. Provider disablement, the whole-account spending budget and dated billing remain separate controls; preserve current artifacts and their original custody.

This carries Bryce's existing zero-spend instruction from [Commons RULES, CI and spend](https://github.com/woahwhattheheck/commons/blob/main/RULES.md#4-ci-and-spend) into this repository's consumed entry guidance. Original cost coordination: https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791755765336589 .
