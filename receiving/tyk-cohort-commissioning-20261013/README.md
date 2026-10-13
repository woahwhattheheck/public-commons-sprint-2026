# Complete Tyk cohort commissioning source

This is the complete original source for installed PR1581, commit `bfc97ef63f9f7c9d2402f47ec83e3c7994b432e1`. Its matching public implementation is PR4059. The 27-file implementation includes the working cohort UI, durable original request recovery, typed SDK, MCP tools, complete workshare attachment, seven-step native programme and receiving guides.

## Open this exact version

`source-envelope.json` carries all 1116 original files, 10821726 source bytes and the complete original Git tree/commit. It contains the 675-file selected application, all 440 original contribution declarations needed by the maintained builder, the original native journey and source receiver, and current owner instructions. The original builder remains the package authority.

Decoded packet: 17882077 bytes, SHA-256 `cbb2eda721bc5ec12f01f38e91f0bd5ad923d026f9937655bddd29c2dfdd026c`.
Original tree: `85ac1ce70f86c670a4e88c9f0319eb4e224f2c3a`.
The full 17,672-entry tree and all 1,726 Git tree object identities were checked against the immutable source.

Use the full checkout or original Git blob reader for this envelope; the GitHub contents preview may omit bodies over 1 MiB. Original envelope blob: `21f0769f78b94d0a7bf330a1b5475338e7eeb52c`.

The following command uses Python's standard library to open the complete original envelope and retain its packet and original receiver. Supply an existing private parent directory. An existing output must contain the identical bytes.

```sh
python3 - /absolute/checkout/receiving/tyk-cohort-commissioning-20261013/source-envelope.json /absolute/private/tyk-source-edition <<'PY'
import base64, gzip, hashlib, json, os, pathlib, stat, sys
envelope_path = pathlib.Path(sys.argv[1])
destination = pathlib.Path(sys.argv[2]).absolute()
os.umask(0o077)
destination.mkdir(parents=True, mode=0o700, exist_ok=True)
assert destination.resolve() == destination and not destination.is_symlink()
assert stat.S_ISDIR(destination.stat().st_mode) and not destination.stat().st_mode & 0o077
envelope = json.loads(envelope_path.read_bytes())
assert envelope["schema"] == "commons.tyk-build-source-envelope.v1" and envelope["codec"] == "gzip+base64"
original = gzip.decompress(base64.b64decode(envelope["payload_base64"], validate=True))
assert len(original) == envelope["bytes"] == 17882077
assert hashlib.sha256(original).hexdigest() == envelope["sha256"] == "cbb2eda721bc5ec12f01f38e91f0bd5ad923d026f9937655bddd29c2dfdd026c"
packet = json.loads(original)
assert packet["source"]["commit"] == "bfc97ef63f9f7c9d2402f47ec83e3c7994b432e1"
path = "stellar/scf-starforge-20261009/sf30-seller-sdk/tyk/receive-source-release.py"
member = next(item for item in packet["files"] if item["path"] == path)
receiver = base64.b64decode(member["content"], validate=True)
assert len(receiver) == member["bytes"] and hashlib.sha256(receiver).hexdigest() == member["sha256"]
for name, data in (("source.json", original), ("receive-source-release.py", receiver)):
    target = destination / name
    if target.exists() or target.is_symlink():
        assert target.is_file() and not target.is_symlink() and target.read_bytes() == data
    else:
        with target.open("xb") as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
print(str(destination / "source.json"))
print(str(destination / "receive-source-release.py"))
PY
```

Build and receive the selected product with the original maintained command:

```sh
python3 /absolute/private/tyk-source-edition/receive-source-release.py \
  --packet /absolute/private/tyk-source-edition/source.json \
  --directory /absolute/private/tyk-source-edition/receiving \
  --node /absolute/original/node
```

The receiver reconstructs the exact original Git source, builds the `tyk-merchant` selection offline, inspects the complete release, and produces the selected package, full editable source ZIP and source manifest. A source edition gets its own immutable build directory; existing native workspace/operation identities stay with the original native operator.

## Continue the existing native operation

The same command accepts `--native-directory`, `--redis-server`, `--playwright-module`, `--chromium`, `--dashboard-config` and `--return-directory` for the existing equipped receiving operation. Use that operation's saved directories, native configuration and credential environment. The native host preserves its original Gateway, ports, data, source input, completed phases and request identities.

The complete Dashboard addition requires its actual licensed Dashboard connection and installed version, original Classic seed, original upstream, and `dashboard.publicBaseUrl` for its connected Gateway. Default `commissioningApiCount` is 12 (2–20 supported). Optional `probeHeaderEnv` maps actual header names to existing credential environment names. Select an upstream with a stable complete response for the native route comparison. These details belong in the private original configuration.

The native journey retains all complete Classic/conversion/staged/final sources, executes the selected original cohort, records actual route responses, uses explicit production acceptance, exports the full workspace and cold-reopens it. It carries the complete operating history and original MCP file-result bytes. The browser course opens the actual saved record, operates source/review/handover controls and downloads complete original files at desktop and narrow widths.

After the native result returns, open the exact resulting screenshots and all delivered attachments, operate the important controls, and fix any visible defects. Preserve the actual result, original operation and request IDs when continuing. The producing owner joins the existing receiver's result and views it personally.

## Partner source integration

The generic original `createCommissioning.workshare` input accepts `{name,mediaType,contentBase64,note?}`. Its complete bytes remain attached to the original OperatingPlan and exact cohort/configuration/check selection. `readCommissioning.workshare` exposes the full source, original raw byte SHA-256 and that binding.

The separately maintained CloudAPPi, Enable U and AXPE profiles, source documents and private adapter remain in private Commons/customer custody with E258. Their original compiler and installed-client CLI consume this same generic product. Use the original Tyk coordination parent for composition:
https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791809170267079

## Current verification

All 54 complete merged file readbacks match the 27 reviewed files. The original action/catalogue has 22 actions and 28 MCP tools. Original OperatingPlan composition retained a 12-API/24-check course, all 46,885 review bytes, complete workshare bytes including a BOM, and binary attachments. Missing checks or native converted source are rejected; a changed staged edition invalidates its earlier acceptance.

The exact maintained builder's source-selection and browser-context logic was evaluated with retained source and the original parser: 675 selected files, 545 parsed modules, and 9,647,506 selected source bytes. The complete packet also carries every declaration read by that logic and the receiving-only tools. Native package execution and rendered receiving are performed by the original command above.

## Current owner operating instructions

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

