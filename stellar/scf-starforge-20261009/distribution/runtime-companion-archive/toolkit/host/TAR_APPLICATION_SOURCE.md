# Complete TAR source receiving

The existing application archive command now accepts ordinary TAR and tar.gz source,
including GitHub codeload archives. It retains the exact original archive, uses
Python's standard `tarfile` and `gzip` readers, and runs the same mixed Python/JavaScript
source collectors and independent receiver. The selected application never runs.

## Use the original operation

Keep the complete downloaded archive, independently retained SHA-256, and actual
member root. Do not decompress/repack it or trim it to hide unsupported members.
Select a pinned provider source; a branch URL alone is not a source identity.

```sh
node host/application_archive_source.cjs collect \
  --archive /absolute/input/original.tar.gz \
  --archive-format tar.gz \
  --sha256 ORIGINAL_ARCHIVE_SHA256 \
  --member-root EXACT_TOP_LEVEL_SOURCE_DIRECTORY \
  --selection /absolute/input/application-selection.json \
  --directory /absolute/private/original-source-operation \
  --output /absolute/private/application-source.json.gz \
  --gzip \
  --python /absolute/installed/python3
```

The installed equivalent is `starforge runtime-companion-source collect` with the
same arguments. Use `--archive-format tar` for uncompressed TAR. Omitting the format
retains the original ZIP behavior. Archive compression and the optional `--gzip`
packet compression are separate; every original archive byte stays in the packet.

Use the same original mixed-source selection contract, complete entrypoints,
explicit resources and external dependency declarations from
[APPLICATION_SOURCE_CLOSURE.md](APPLICATION_SOURCE_CLOSURE.md).
The caller selects the existing Python and Node executables. Received code never
supplies trusted tool paths. The full source packet includes all trusted tool
bodies and exact hashes; a receiving owner must use that same complete edition.

```sh
node host/application_archive_source.cjs inspect \
  --input /absolute/private/application-source.json.gz \
  --directory /absolute/private/independent-receiving \
  --python /absolute/installed/python3

node host/application_archive_source.cjs receive \
  --input /absolute/private/application-source.json.gz \
  --directory /absolute/private/independent-receiving \
  --python /absolute/installed/python3
```

Reuse these exact directories and inputs after interruption. The original parser
owner retains attempts, exact executable arguments and its CLOSED receipt; a
forced or unconfirmed drain prevents another parser. The same existing immutable
filesystem receiver publishes original archive, members, exact intent and final
receipt. It preserves matching files, checks executable identity, rejects different
outputs, reconciles only its exact pending hard links and keeps unmatched residue.

## What is preserved and accepted

The TAR source packet uses `commons.application-archive-source.v2` with explicit
`archiveFormat` (`tar` or `tar.gz`). ZIP keeps its original v1 fields and synchronous
inspection API. Old byte-pinned packets continue to require their original complete
tool edition; this change does not rewrite historical packets or claim that one
edition can reproduce another's tool identity.

Python handles USTAR, ordinary GNU long names and POSIX PAX metadata. The receipt
retains each effective name, explicit materialized path, kind, permissions,
header/data offsets, raw header-name/prefix bytes, ownership/time metadata and
PAX fields. The complete untouched archive remains authoritative for every original
header and padding byte. Leading `./` and directory trailing slashes are mapped
explicitly; their original effective names remain recorded. An explicit root
directory is retained in the receipt. No member is silently dropped.

Only regular files and directories are supported. Symbolic/hard links, sparse
files, devices, FIFOs and other member kinds are rejected as a complete input.
Unsafe traversal, absolute names, repeated effective paths, case aliases,
file/directory collisions, control characters and Windows-reserved names are
rejected before materialization; there is no silent rename. Permissions in the
original archive remain retained; private received directories use 0700 and files
0600 or 0700 according to original executable identity. Ownership, timestamps and
privileged mode bits are not applied to the host.

The full compressed or uncompressed original is bounded to 128 MiB, the complete
expanded TAR including headers/padding to 128 MiB, and entries to 8,192. Two zero
end blocks and zero-only trailing padding are required. A hidden concatenated TAR,
truncated header/body, invalid gzip CRC or over-limit expansion is rejected. The
complete source packet and trusted parser result remain bounded to 256 MiB.
These are full-input limits, not permission to retain a partial archive.

## Existing Runtime Files and Companion

Use the unchanged installed `starforge runtime-companion-archive` commands or
[the original direct consumer](RUNTIME_COMPANION_ARCHIVE.md). Receive requires the
actual existing workspace directory/UUID and a separate private receiving directory.
The input must fit the original 16 MiB Files bound; the selected set retains its
original 1,024-file/64 MiB total limits. An oversized complete source remains usable
through host receiving; it is not split to bypass Runtime limits.

The synchronous `decodeBinding` and consumer `decodeInput` expose bounded TAR
metadata as `REQUIRES_ORIGINAL_TAR_PARSER`, never verified source. The complete
owned receiver rereads/parses the exact original TAR and checks every selected
source byte/mode and search observation before any upload. Review, prepare and
export cold-reopen the retained packet through that same original receiver,
retaining the original Python/Node paths and same operation. No application Save
or Start occurs. Companion editable copies retain their original behavior; the
full original packet preserves archive modes/headers alongside the set.

For an API caller that only needs an archive binding, use
`await inspectBindingAsync(packet,{directory,python,node,signal})`.
The original synchronous `inspectBinding(packet)` remains ZIP-only and explicitly
rejects TAR. Do not treat `decodeBinding` as independent archive validation.

## Actual opening and receiving

Source parsing/review is not a native archive or Runtime result. The existing
equipped receiver should use one genuine pinned tar.gz and a selection for its
actual source, then collect, receive, reopen, and compare the original archive
SHA, complete member inventory, selected source, original mode identity and
retained unknown/rejected input. Continue the same receiving directory after an
interruption. Use the original installed build/selection; no hosted Actions.

When the original Runtime/browser lifetime is available, receive this exact packet
into the existing UUID, inspect Files and the source set, download the original
packet and association, prepare/reopen the same working copy, preserve its edits,
export and independently reopen all complete files. The producing owner must
actually view the resulting screens and attachments before customer-ready claims.
Return complete native/visual output to the existing operation, not a new controller.

Bryce released his local in-app browser at 2026-10-13 16:29:39 UTC. Preserve saved
tabs/state and existing active ownership; the temporary earlier reservation quoted
in byte-preserved historical guides is not current.

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

