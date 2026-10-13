# Complete two-Gateway Tyk commissioning and receiving

This complete source edition combines the merged Gateway product (installed PR1654) and the maintained runtime command-loading correction (installed PR1678). Its immutable installed source is **`b8004ce3e455925a27dcb79770e14285689eb497`**, tree `2c8facd5a829f8243fe7c7da052a41e779839c19`. The matching Gateway implementation is public PR4253, merge `6bca80855373234ff92d73ddddd823e58c00792a`.

Continue **`TYK-API-MIGRATION-ROLLOUT-D76C-20261012`** through its existing native owner. This package is prepared source for that operation; it does not claim a native or rendered result.

## Complete source and source identity

`source-envelope.json` contains 1134 complete original files (11103897 source bytes), the full signed commit and the complete 18,481-entry Git tree. All 1,811 tree-object identities and every included Git blob identity were checked against the immutable source. It includes:

- The 685-file selected Tyk application and all 447 original contribution declarations consumed by the maintained builder.
- Both original native commissioning courses, the original source/release receiver, private two-Gateway host and exact Gateway/Redis acquisition contracts.
- Complete Applications, browser, CLI, SDK, MCP, source/history/delivery and receiving dependencies, plus current owner instructions.
- The current registered Tyk grant guide. Private partner/company source, credentials and customer records are not included.

| Complete artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| Envelope JSON | 6625664 | `ed150a7d8ac2a0ee2ce0ac748bbceacfd988f9475c8747675129d38969a7143f` |
| Decoded source packet | 18415813 | `52c2efa2af3359505bcd8270e402de0b5036e3bc5d53bfd127bdf181a8fd3a82` |
| Original gzip payload | 4969110 | `43bd851940906e78313756831d3bd957fd26a670dc4f37bb09041c0fd50dcac0` |

The original envelope Git blob is `ef1f82729447f9f33ce85b5ecd1f37112e4b9967` in the public source repository. Use a full checkout or the original Git blob reader; a contents preview can omit a file of this size.

## Continue the same native operation

Use the existing equipped Linux owner and its retained operation directory. Preserve the original ports, Gateway data, workspace UUID, completed requests, source/history and native receipts. Before starting, reconcile any already accepted PID/job for this operation. Do not launch a second engine or controller. Preserve the priority of the existing Eco native work and the October 13 14:00 UTC cutoff.

The original receiving course needs Python 3.12+, Node 24, Git and the original Playwright/Chromium runtime. The host acquires the exact original Tyk Gateway 5.15.1 publisher package and Redis 6.2.20 when no exact retained binary exists. It preserves the original package hashes and version results. Use the actual selected host paths; Node 22 is not a substitute for the declared Node 24 runtime.

Select a new private **source-edition** directory for this immutable commit. Keep the existing **native-operation** directory. A completed earlier source build remains bound to its own source packet; do not overwrite that binding.

This single command checks the complete envelope and packet, retains the unchanged original receiver with exact bytes, and delegates to it. Python receives its source directly, avoiding shell heredoc temporary files. Replace the illustrative paths with the original owner's actual paths:

```sh
python3 -c 'import base64,gzip,hashlib,json,os,pathlib,stat,sys,uuid
envelope_path=pathlib.Path(sys.argv[1])
destination=pathlib.Path(sys.argv[2]).absolute()
os.umask(0o077)
destination.mkdir(parents=True,mode=0o700,exist_ok=True)
info=destination.lstat()
assert stat.S_ISDIR(info.st_mode) and not destination.is_symlink() and destination.resolve()==destination and not info.st_mode&0o077
encoded=envelope_path.read_bytes()
assert len(encoded)==6625664 and hashlib.sha256(encoded).hexdigest()=="ed150a7d8ac2a0ee2ce0ac748bbceacfd988f9475c8747675129d38969a7143f"
envelope=json.loads(encoded)
assert envelope["schema"]=="commons.tyk-build-source-envelope.v1" and envelope["codec"]=="gzip+base64"
raw=gzip.decompress(base64.b64decode(envelope["payload_base64"],validate=True))
assert len(raw)==envelope["bytes"]==18415813
assert hashlib.sha256(raw).hexdigest()==envelope["sha256"]=="52c2efa2af3359505bcd8270e402de0b5036e3bc5d53bfd127bdf181a8fd3a82"
packet=json.loads(raw)
assert packet["schema"]=="commons.tyk-build-source.v1" and packet["source"]["commit"]=="b8004ce3e455925a27dcb79770e14285689eb497"
path="stellar/scf-starforge-20261009/sf30-seller-sdk/tyk/receive-source-release.py"
member=next(item for item in packet["files"] if item["path"]==path)
receiver=base64.b64decode(member["content"],validate=True)
assert len(receiver)==member["bytes"] and hashlib.sha256(receiver).hexdigest()==member["sha256"]
assert hashlib.sha1(b"blob "+str(len(receiver)).encode()+b"\0"+receiver).hexdigest()==member["gitBlob"]
def retain(name,data):
    target=destination/name
    if target.exists() or target.is_symlink():
        st=target.lstat()
        assert stat.S_ISREG(st.st_mode) and not target.is_symlink() and not st.st_mode&0o077 and target.read_bytes()==data
        return
    temporary=destination/(name+".pending-"+uuid.uuid4().hex)
    try:
        fd=os.open(temporary,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
        with os.fdopen(fd,"wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary,target,follow_symlinks=False)
        except FileExistsError:
            st=target.lstat()
            assert stat.S_ISREG(st.st_mode) and not target.is_symlink() and not st.st_mode&0o077 and target.read_bytes()==data
        parent=os.open(destination,os.O_RDONLY|os.O_DIRECTORY)
        try: os.fsync(parent)
        finally: os.close(parent)
    finally: temporary.unlink(missing_ok=True)
retain("source.json",raw)
retain("receive-source-release.py",receiver)
os.execv(sys.executable,[sys.executable,str(destination/"receive-source-release.py"),"--packet",str(destination/"source.json"),"--directory",str(destination/"source-receiving"),*sys.argv[3:]])' \
  /absolute/checkout/receiving/tyk-gateway-cohort-20261013/source-envelope.json \
  /absolute/private/tyk-source-b8004ce3 \
  --node /absolute/original/node24 \
  --native-directory /absolute/private/ORIGINAL_TYK_NATIVE_DIRECTORY \
  --native-cpus 2 \
  --playwright-module /absolute/original/playwright/index.mjs \
  --chromium /absolute/original/chromium
```

If the original Playwright module can locate its browser, `--chromium` may be omitted. The host uses the original browser acquisition path when necessary. Optional `--redis-server` selects an existing exact Redis 6.2.20 executable. Optional `--return-directory` copies the complete final receiving archive into an existing private handoff destination.

The original source receiver reconstructs all Git objects, builds the selected `tyk-merchant` product offline with the maintained builder, inspects the full installed archive and writes the full editable source ZIP and release receipt before invoking the same native host. The source envelope is not a replacement builder or native engine.

Omit `--native-directory` and all native-only flags only when deliberately receiving/building source before an equipped owner takes the same native operation. Such a result is source/release receiving, not native completion.

## Two original Gateway targets

The default Gateway-only course is complete without a licensed Dashboard. It uses **12 APIs, two isolated real Gateways, and 30 original OperatingPlan steps**. The original `gateway` configuration remains the staging target. The additive `gatewayProduction` target has a distinct saved connection, private administrator environment name, listen port, apps directory, configuration and PID path. Both instances share the exact pinned binary and original upstream, with Redis databases 0 and 1.

Use explicit **node reload** in this supplied host. Redis database numbers do not isolate its pub/sub channel, so a group reload is a separate intentional native deployment choice.

The host durably records the additive target selection and preserves complete earlier configuration/results and receiving archives. Existing native request UUIDs and completed steps remain with the same operation; a new target never causes an old request to be replayed. The host default is 12 APIs. The existing host entrypoint supports `--gateway-commissioning-apis` from 2 to 20 for an explicitly selected complete course; the source wrapper's default remains 12.

The course prepares/reviews/dispatches the original staging writes, reloads and observes actual active definitions, records complete operational checks and explicitly accepts native OpenAPI transformation where required. Production consumes those accepted full active definitions under their actual native API IDs, then performs its own original writes, explicit reload, active readback and checks. An acknowledged write remains distinct from active configuration confirmation.

Every staging and production probe retains the actual complete response bytes/hash. The host compares those identities with the original upstream log and binds the probe URLs to the two selected targets. Both Gateways, Redis, native journey and upstream request handlers must drain before successful receiving publication.

A later actual licensed Dashboard target can join through the same original `--dashboard-config` path, preserving every earlier Gateway request. Its full configuration, seed and installed version must be real. Never substitute an OSS Gateway for a licensed Dashboard migration result. Private partner desk and workshare source remain with their original private Slack/Pages custody.

## Exact final receiving artifacts

The new archive editions are `tyk-gateway-gateway-cohort-native-receiving.tar.gz` and, when the actual Dashboard course is included, `tyk-all-gateway-cohort-native-receiving.tar.gz`. Earlier single-target archive names and bytes remain retained.

The full archive includes original journey results, actual wide/narrow screenshots, all delivered files beneath `journey/downloads`, complete configuration-history source records and the exact native workspace histories. Credentials and private live runtime configuration files are excluded.

The original source receiver selects **`complete-gateway-cohort-history-export-and-cold-receiving`** and returns its final `laterDownload`, second export and later receiving reference. It hashes the actual NDJSON file under the original downloads directory and the complete host archive. It does not select an earlier pre-commissioning export. The final cold receiver must reopen the actual complete OperatingPlan/history, accepted source and all original native records.

Preserve `source-release-result.json`, `native-receiving-gateway.json` or `native-receiving-all.json`, the original host `delivery.json`, selected release/receipt, full source ZIP/manifest, final native NDJSON and complete receiving archive. Reopen the usable contents and continue using the original IDs.

## Open and inspect the actual product

Use the exact saved product URL and private browser-token flow returned by the original host. Read the included `products/tyk-merchant/GATEWAY_COMMISSIONING.md`, `COMMISSIONING.md`, `OPERATING.md`, `RECEIVING.md` and native receiving guides.

In the actual Gateway commissioning browser, open the complete intake, save/reopen the original local source, inspect the selected full request and transformation review, operate the original explicit write/reload/review controls, download complete source/review/history, and cold-reopen the final receiving workspace. Inspect desktop/screenshare and narrow/mobile widths, populated/empty/loading/error states and every outgoing attachment. The native course captures real screenshot artifacts; the producing owner must personally view them and operate the actual result before calling customer-facing output ready. Return those exact images and files to D76C's producing owner for review and repair, together with the actual source commit, original PID/job and complete result.

Current source receiving and implementation coordination:
https://tokenjunkielabs.slack.com/archives/C0BTB4SUCP9/p1791730220899469
Original Tyk project:
https://tokenjunkielabs.slack.com/archives/C0BTTA66TK3/p1791809170267079

## Actual source validation and current execution state

The exact current maintained builder source-selection/browser-context logic completed with the original parser: **685 selected files, 553 parsed modules, 9,838,065 selected bytes**. The complete packet also includes every original donor declaration it read and the native-only entrypoints and receiving helper. All current source/member/tree/commit identities are verified. The maintained runtime CLI loading correction removes 34 unrelated native modules from the Tyk selection while preserving the CKAN product's original declared receiver.

The local Python check attempt returned `409 environment_offline` before process creation. No new Tyk native PID, native completion or visually inspected browser result is claimed by this package. The existing equipped operation owns those actual next steps. Preserve the distinction between complete source, an accepted native job, a successful native result and a product personally opened and used.

## Existing source and spending controls

Publish source only to existing public repositories. Do not create, push or update a private GitHub repository. Private company/customer material remains in its existing authorized private Slack/Pages or recipient custody. This source packet contains public product code only.

Keep GitHub Actions disabled in provider settings and preserve the existing literal-false source job conditions. Use the original Linux receiving owner for focused native work; no hosted workflow or paid runner is authorized by a missing local runtime. Account budgets, repository disablement and dated billed usage remain separate controls. The original E465 personal-budget operator retains that task; do not create another setter.

## Complete current rendered-product and attachment owner instruction

The following is the actual current public repository `AGENTS.md`, Git `46be323017be913780d0d2850b7658861744508d`, retained with this receiving guide. The source packet separately preserves its installed repository's exact `AGENTS.md`, `CLAUDE.md` and `GEMINI.md` at the pinned commit.

# Owner-directed rendered-product inspection

Source: direct owner instruction of October 13, 2026. Repository copy version: `2026-10-13.1`.
Scope: owner-controlled work across providers, local and cloud runtimes, and current and future workers. Existing owner controls remain in force.

Before calling a client/prospect-facing app, website, dashboard, demo, report, presentation or export ready, the producing worker must open/run/render the exact outgoing version, LOOK at the rendered screen or its real screenshots, and operate the important user controls. Check the actual screenshare width and narrow/mobile width where relevant, populated/empty/loading/error states, downloads/exports and reopening. Capturing screenshots without viewing them is insufficient. Fix ugly, broken, unstyled, cramped, clipped, overflowing or unreadable output within the authorized work before presenting it. Code review, DOM counts, HTTP200, unit checks or another worker's approval do not replace seeing the actual product.

The Ecosystem product requires plain industrial design: readable tables, clear hierarchy, consistent typography/spacing, restrained controls, useful labels and responsive layouts. Keep the real workflows/data/computation. Reviews must lead directly to repairs and must not replace implementation/integration or become endless rechecking. The existing focused-validation policy remains; do not run broad suites or build a verification product.

Persist this instruction in the active owner-controlled instruction surfaces actually read by the relevant workers: global/project AGENTS/CLAUDE/GEMINI/rules, provider-specific boot instructions, source mirrors, cloud repository copies and current build/receiving guides. Include this instruction in every delegated child assignment, including assignments to another provider or runtime. Maintainers update their own consumed files and return exact paths, source/version and readback. A coordination acknowledgment alone is not propagation. Do not alter historical evidence or third-party/vendor policies. No forced restarts, new watchers or revival of owner-stopped work.

Inspect the actual completed scientific screens, reports, source pages and downloadable HTML in the real operator. Prior empty-Workspace screenshots are not completed-workspace acceptance. Preserve current engineering owners; other coordinators receive propagation rather than duplicate implementation. Continue native source/runtime/archive joins rather than diverting everyone to cosmetic review. This instruction does not extend or restart the Ecosystem sprint: the existing cutoff is October 13, 2026 at 10:00 a.m. America/Kentucky/Louisville, 14:00 UTC.

Source assembly and standalone application handoffs retain the application-level instruction copies with their current guides. This file records an owner-requested product delivery requirement; it does not change provider safeguards, repository access controls, or existing authorization boundaries.


<!-- bryce-rendered-product-inspection:begin -->
## Standing lab rule: inspect the rendered product before presenting it

Bryce's direct owner instruction, October 13, 2026. This applies to every current and future lab peer, provider, model, harness, local session, cloud session, and delegated or child worker.

Before calling a client/prospect-facing app, site, dashboard, demo, report, presentation, or export ready, or putting it before a client/prospect, the responsible producing peer MUST open/run/render the exact outgoing version and visually LOOK at the actual result. Inspect at the actual screenshare/presentation width and at narrow/mobile widths where relevant. Operate critical controls; inspect applicable loaded, empty, loading, and error states; exercise downloads/exports and reopen the delivered files. Capture real screenshots or rendered page images and actually VIEW them. Capturing without viewing does not satisfy this rule.

This includes ALL attachments. Literally observe the actual thing the way a user or recipient would see and use it: open and view downloaded HTML, every relevant PDF/report page, slides, spreadsheets, maps, images, video/audio, archives and project attachments in their normal recipient-facing viewer or application; play audiovisual media and inspect the usable contents of archives/projects. Metadata, schemas, source text, and a browser link do not substitute for opening the attachment and using the delivered result normally.

Fix ugly, cramped, broken, unstyled, clipped, overflowing, or unreadable results within the authorized task before presenting them. Favor simple industrial/plain presentation, consistent spacing and typography, readable tables, and working controls. Do not add decorative template slop. Source review, unit tests, HTTP 200, DOM counts, a reviewer/model approval, or an evidence form do not substitute for looking at and operating the real outgoing product.

This is focused internal product validation, never permission to build or submit a proof, test, or verification product, run broad suites, or repeatedly recheck an unchanged accepted version. Building and integrating the actual deliverable remains the main work; do not substitute endless reviews for delivery. Retain an exact-version visual receipt in the handoff: source/head or artifact hash, URL/file, viewport sizes, screenshots actually viewed, controls/states/export files exercised, fixes, and any precise unresolved gap. A changed outgoing version needs inspection of the affected result.

Bryce explicitly clarified: "that includes all attachments and this does not become review theatre or test theatre you need to literally observe the actual thing the way a user would see and use it". A checklist, screenshot folder, receipt, passing test, or parallel review bureaucracy is not the requirement or a substitute for actual observation and normal use. Perform focused fixes and keep shipping the main work; create no review or approval gate.

Bryce also instructed: "also add that if u make a video use voice gen tts not robot voices, use generative stuff we have models, use them". For video/media narration, use available high-quality generative voice/TTS and applicable generative visual/media capabilities when helpful, with natural professional delivery instead of robotic default voices. Actually play/listen/watch the final exported attachment and inspect clarity, pronunciation, pacing, timing, and audio alignment. Reviewing a text script does not substitute for experiencing the final video/audio. This adds no paid-service purchase or real-person voice-cloning authorization; preserve lab attribution and third-party copyright/license controls.

Pass this rule to child/delegated workers and persist it in owner-controlled provider/project/cloud instruction copies. Record delivery and readback coverage; never claim every running session loaded it without evidence. This rule creates no hooks, watchers, restarts, approval queue, credential restrictions, or new publication authority. Preserve all existing owner rules, including no llama.cpp, no private GitHub repositories or Actions, focused validation, attribution, incident communication, personal meeting approval, contact holds, demo pauses, bounty restrictions, and owner cutoffs.

Canonical local policy: `C:/Users/lucys/.commons/rendered-product-inspection-policy.md` and `.json`. Portable repository copy: `docs/policies/rendered-product-inspection-policy.md` and `.json` when present. Only Bryce can change this standing rule.
<!-- bryce-rendered-product-inspection:end -->
