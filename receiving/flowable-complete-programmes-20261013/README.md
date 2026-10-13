# Complete Flowable source and native receiving

This is the complete source transport for the existing operation `FLOWABLE-PROCESS-OPERATIONS-D76C-20261012`. It pins installed source commit `955a07334a483ac7c0d3f838a1758e4aee364c7d` and tree `71a4926d3e14963b4c35fd679e327853e74f63da`.

The source joins the original BPMN, DMN and CMMN engine course, the complete installed SDK/CLI/MCP/browser journey, the declarative BPMN 29-step and DMN 14-step programmes, and the actual source-authoring browser course. The original final export and cold receiving include all 15 core record kinds, exact programme source/basis/outcomes, and the later authoring programme saved for native review. There is one original engine/controller lifetime.

## Exact transport and current status

| Item | Identity |
| --- | --- |
| Envelope | `source-envelope.json`, 6865553 UTF-8 bytes |
| Envelope SHA-256 | `de2567f648788c7e86d1cda6250c38f0ae49fb9b6d24ac984fb2edf3173490ff` |
| Decoded packet | 21269173 bytes; `41f5b3e3fe106fa20c35d06a52ae335b8243e93122191e86a232b9f7a0890f1e` |
| Complete source | 1172 files; 11650679 original bytes |
| Original tree | 17,573 entries; all 1,714 Git tree objects verified |
| Selected release closure | 735 files; 10,583,467 bytes |
| Declaration inputs | All 439 contribution JSON files required by the pinned builder |
| Receiver | `stellar/scf-starforge-20261009/sf30-seller-sdk/flowable/receive-source-release.py` |
| Receiver SHA-256 | `6e398942d91d6c746d47978c90fe9408ff92d9fff9f1850dfa756aa1738b11d5` |

The complete envelope was independently read back. Every retained source member matches its original Git blob, mode, size and SHA-256 at the pinned commit. The maintained builder's source-selection and browser-context closure completed against these exact bytes; 558 module bodies were parsed with the original Acorn parser. This is source validation. No native engine completion, installed browser run or rendered-product acceptance is claimed by this publication.

The source transport intentionally includes declaration inputs beyond the selected release. The original builder reads every contribution to discover declarations for reachable browser servers. It selects the actual release itself; the transport does not enable unrelated contributions.

## Continue the existing owner operation

Use the already assigned Linux host and operation in Slack channel C0BTB4SUCP9, parent `1791730220.899469`. Before starting, reconcile any accepted session/job in that operation. Continue an already accepted job rather than launching another engine. An unstarted receiver can select this source edition. Preserve earlier receiving directories and journals; a directory already bound to a different packet must not be overwritten.

Use the existing Node 24 runtime, Java 17 or newer, Playwright/Chromium, Python 3 and Linux flock. The original host handles its declared vendor source/runtime acquisition and owners. Observe actual writable disk and memory on that host before Java acquisition. Do not use GitHub Actions or start another controller.

Check out this receiving directory or download both files from an immutable commit in the public source repository. Set `FLOWABLE_ROOT` to an absolute, private, operation-owned directory with enough real capacity. The following command verifies the complete envelope and packet, restores only the exact original receiver entrypoint, and replaces itself with that unchanged receiver. It uses `python3 -c` so shell heredoc temporary files are unnecessary.

```bash
FLOWABLE_ROOT=/absolute/owned/flowable-complete-955a073
python3 -c '
import base64, gzip, hashlib, json, os, pathlib, stat, sys
os.umask(0o077)
envelope_path = pathlib.Path(sys.argv[1]).absolute()
root = pathlib.Path(sys.argv[2]).absolute()
root.mkdir(mode=0o700, parents=True, exist_ok=True)
info = root.lstat()
if root.is_symlink() or root.resolve() != root or not stat.S_ISDIR(info.st_mode) or info.st_mode & 0o077:
    raise SystemExit("Use a canonical private operation-owned directory")
encoded = envelope_path.read_bytes()
if len(encoded) != 6865553 or hashlib.sha256(encoded).hexdigest() != "de2567f648788c7e86d1cda6250c38f0ae49fb9b6d24ac984fb2edf3173490ff":
    raise SystemExit("Envelope identity differs")
envelope = json.loads(encoded)
if envelope["schema"] != "commons.compressed-source-envelope.v1" or envelope["codec"] != "gzip+base64":
    raise SystemExit("Original transport format differs")
packet_bytes = gzip.decompress(base64.b64decode(envelope["payload_base64"], validate=True))
if len(packet_bytes) != 21269173 or hashlib.sha256(packet_bytes).hexdigest() != "41f5b3e3fe106fa20c35d06a52ae335b8243e93122191e86a232b9f7a0890f1e":
    raise SystemExit("Complete packet identity differs")
packet = json.loads(packet_bytes)
if packet["operation"] != "FLOWABLE-PROCESS-OPERATIONS-D76C-20261012" or packet["source"]["commit"] != "955a07334a483ac7c0d3f838a1758e4aee364c7d":
    raise SystemExit("Original operation/source differs")
entry = next(item for item in packet["files"] if item["path"] == "stellar/scf-starforge-20261009/sf30-seller-sdk/flowable/receive-source-release.py")
receiver_bytes = base64.b64decode(entry["content"], validate=True)
if len(receiver_bytes) != 25090 or hashlib.sha256(receiver_bytes).hexdigest() != "6e398942d91d6c746d47978c90fe9408ff92d9fff9f1850dfa756aa1738b11d5":
    raise SystemExit("Original receiver identity differs")
def retain(path, content):
    try:
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    except FileExistsError:
        info = path.lstat()
        if not stat.S_ISREG(info.st_mode) or path.is_symlink() or info.st_mode & 0o077 or path.read_bytes() != content:
            raise SystemExit("Preserve original receiving file: " + str(path))
        return
    with os.fdopen(fd, "wb") as stream:
        stream.write(content)
        stream.flush()
        os.fsync(stream.fileno())
    fd = os.open(root, os.O_RDONLY | os.O_DIRECTORY)
    try:
        os.fsync(fd)
    finally:
        os.close(fd)
packet_path = root / "complete-source-packet.json"
receiver_path = root / "receive-source-release.py"
retain(packet_path, packet_bytes)
retain(receiver_path, receiver_bytes)
print(json.dumps({"operation": packet["operation"], "sourceCommit": packet["source"]["commit"], "phase": "ORIGINAL_SOURCE_RECEIVER"}), flush=True)
os.execv(sys.executable, [sys.executable, str(receiver_path), "--packet", str(packet_path), "--directory", str(root / "source-receiving"), "--native-directory", str(root / "native"), "--native-cpus", "2"])
' "$PWD/receiving/flowable-complete-programmes-20261013/source-envelope.json" "$FLOWABLE_ROOT"
```

The original receiver verifies all source members and native Git metadata, uses the maintained Git receiver, builds `flowable-merchant` offline, inspects the installed release, prepares/installs/reopens the original runtime to READY, and runs the original Flowable host and full journey. Its retained preparation recovery preserves the original installer and resumes dependency installation where structurally complete. The kernel lease and saved operation/request journals remain authoritative.

After source materialization, read the pinned `NATIVE_RECEIVING.md`, `products/flowable-merchant/OPERATING.md`, `AUTHORING.md`, and the actual owner instruction files before operating the product. The complete current rendered/all-attachments policy below is also copied verbatim into the consumed native receiving guide.

## Actual product return

The installed journey operates the real source-authoring controls at 1440×1000 and 390×844. It loads process/case/decision examples, builds complete previews, edits actual DMN source, observes and repairs catalogue mismatch, downloads complete source/drafts/programmes, reopens file and IndexedDB editions, and saves one selected programme through the original captured UUID. An uncertain save resumes that exact input/request instead of repeating the click.

The native DMN 14-step course uses the original source/domain verifier before dispatch and after every confirmed/recovered operation. The final export follows the complete BPMN, DMN and CMMN course plus authoring intake. Receiving compares the exact source/basis/outcomes and later programme record; it must return the final `installed.completeWorkspace`, not an earlier process-only export.

Return the original source/build/runtime receipts, native result and logs, complete installed release, complete source archive, final NDJSON and receiving references, and all real wide/narrow screenshots/downloads. Route the actual rendered images and files to the producing worker for viewing and normal use. The report deliberately keeps `REQUIRES_PRODUCING_OWNER_INSPECTION` until that happens. Preserve a failure with its original log/request; never label a source-only check or unviewed screenshot as customer-ready.

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

