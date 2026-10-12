# Complete installed IATI receiving on one native foreground

This carrier executes the complete installed IATI workflow for two exact publisher inputs at public source commit `c5348b13834012b41c5b40573bc0c390c4226efc`. It keeps the original native admission, installer, source receiver, IATI operator and file-saving workflow. The first input is AidData's historical Nigeria AIMS research XML. The second is Transparency International's activity XML acquired on 12 October 2026.

## Inputs and immutable source

| Item | Bytes | SHA-256 |
| --- | ---: | --- |
| Complete compressed source intake | 1,482,218 | `810e97048e505e0ac593ab6b44267208b3a1a709a7934f20a7a2f2ff511d93b5` |
| Decoded source intake JSON | 7,317,457 | `5de2b6bd64974d82fd652b45bd0853907b35a9e605dccc12b54bb5bd44b2af7a` |
| Source manifest | 81,024 | `52bb99597fa66eecb4f1c19d9ea25209262dd0e41055406f8fd73a228be1575a` |
| AidData publisher XML | 309,331 | `4eddc914f4e5a60ca869f3d52046cb55fc7bb44cabb829d78b2f510fbff4ca9e` |
| Transparency International publisher XML | 131,359 | `5b31447719873d89c511a11b8da645d398b5ab7fb3c471d35c359f30118a429d` |
| Transparency International original metadata | 337 | `91b5096332978b21d6d7fd9842e454931fe9cea60ef18e5e9619194f6410ef14` |

The manifest selects all 277 original files, totaling 4,083,509 source bytes. The intake includes their complete bodies, exact Git blob identities, the complete source tree and signed commit text, plus both complete receiving inputs and their original attribution notices. Each source body is verified by Git blob, SHA-256 and length during materialization.

The text carrier `source-intake.json.gz.base64` is Git blob `72b72c9b57a255a3481fc01b10e33d9d9c96c048`: 1,976,293 bytes, SHA-256 `2709a8d5c1ce71c95e38e9ee043e54b3c2fecd656f5ba2babea795473c88179a`. Its decoded gzip is Git blob `6be65a54689cdac97e03efafe21c5157e296909c`. The complete original UTF-8 carrier was independently read back through the Git connector.

The final source is [PR2029](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2029), merged at [c5348b13834012b41c5b40573bc0c390c4226efc](https://github.com/woahwhattheheck/public-commons-sprint-2026/commit/c5348b13834012b41c5b40573bc0c390c4226efc). This carrier preserves that selected pin.

## One invocation and its two complete operations

The foreground's native operation ID is `IATI-PUBLISHER-7108-20261012`. Its admitted child calls the original `iati/receiving/complete.mjs` sequentially:

1. AidData: `IATI-PUBLISHER-7108-20261012`, original `workspace` and `receiving` directories.
2. Transparency International: `IATI-PUBLISHER-7108-20261012-TI`, separate `workspace-ti` and `receiving-ti` directories.

Each call uses the original Git-object receiving and full distribution builder, prepares and installs the real zero-dependency operator profile, verifies its READY source and installation receipts, runs the publisher and reviewed portfolio workflow, exercises original HTTP/MCP/CLI and managed Applications, restores and reopens the complete customer work, and creates the full customer handover ZIP. Runtime outcomes and native parser totals are recorded by those original procedures.

The second input retains its complete official dataset metadata, source-provenance file and attribution notice through `publisherFiles`. AidData's dated ODC-By 1.0 documentation and its conflicting original machine-readable license field remain together in its own notice. The XML generation and acquisition dates remain separate for both publishers.

## Placement and existing dependencies

The shared intake directory is:

```text
/dev/shm/7108-iati-bootstrap-input/final-c534
```

The project materializes under `/dev/7108-iati-publisher-native` only inside the same foreground that runs the complete operation and preserves its results. This private mount may differ between command invocations. Keep that foreground alive through complete saving and shared return.

The selected existing dependencies are recorded in `launch-input.json`: primary Node 24.19.0, Python 3.12.14 with Expat 2.8.3, existing Chromium 155.0.8059.39 and primary Playwright. The original native host is `/workspace/scratch/dbc61db6310c/native-runtime-recovery-62c14ca9/host`. Its CLI SHA-256 is `014fbbec7f9a3827ba135b8072be0eb37293bf22429fbfc6cad73697f428c776`. The protected source-10f5 Git donor is reused read-only.

The original native resource declaration is 1,024 MiB for the whole operation, including memory-backed files, plus 128 MiB reserve; 384 MiB private growth; 6 MiB shared return growth; and 1 MiB disk reserve. These are declared estimates. The actual maintained allocator decides admission against current resources. The full source, installation, managed copies, workspaces, reports, complete archives, browser and return processing belong to this one lifecycle.

## Prepare the shared intake

Place the exact `foreground.py` and `launch-input.json` in the shared intake directory. Decode the text carrier to `source-intake.json.gz`, verify the compressed identity in the table, and preserve the original source carrier. Existing selected files must match exactly. Reconcile the original `/dev/shm/7108-iati-bootstrap-input/intake.lock` before replacing or completing an earlier input transfer.

For an extracted copy of this carrier, the following source-only preparation reads the local carrier and publishes the three selected inputs without replacing existing files:

```python
import base64, hashlib, importlib.util, json
from pathlib import Path

source = Path.cwd()
spec = importlib.util.spec_from_file_location("selected_iati_foreground", source / "foreground.py")
original = importlib.util.module_from_spec(spec)
spec.loader.exec_module(original)
config = json.loads((source / "launch-input.json").read_bytes())
original.verify(source / "foreground.py", config["launcher"])
root = original.directory("/dev/shm/7108-iati-bootstrap-input")
with original.lease(root / "intake.lock"):
    target = original.directory(root / "final-c534")
    compressed = base64.b64decode((source / "source-intake.json.gz.base64").read_bytes(), validate=False)
    assert len(compressed) == config["intake"]["bytes"]
    assert hashlib.sha256(compressed).hexdigest() == config["intake"]["sha256"]
    for name, data in (
        ("foreground.py", (source / "foreground.py").read_bytes()),
        ("launch-input.json", (source / "launch-input.json").read_bytes()),
        ("source-intake.json.gz", compressed),
    ):
        original.publish_bytes(target / name, data)

```

The maintained launcher independently verifies the complete compressed and decoded intake and its own selected source before it starts native work. A partial preparation is preserved and reconciled against the exact selected bytes.

Run the original selected foreground once:

```bash
/opt/codex/runtimes/codex-primary-runtime/dependencies/python/bin/python3 -B \
  /dev/shm/7108-iati-bootstrap-input/final-c534/foreground.py \
  /dev/shm/7108-iati-bootstrap-input/final-c534/launch-input.json
```

Retain the returned command session and consume its original output. The launcher uses the existing `swarm_cloud_job.py run` contract with the exact original operation ID and retained output selection.

## Complete file custody

The admitted child creates a full receiving-state archive with a complete per-file inventory and independent member-by-member byte verification. It retains the exact original source, both installed runtime/receiving workspaces, publisher and portfolio records, reports and completed customer work. File modes, original inode/device identities, link counts and timestamps are recorded. Each original hard-linked file is stored with its complete bytes. Live Unix sockets and other nonregular endpoints retain their original identity records under `special-identities/`; every regular file retains its complete bytes. The complete source inventory is checked again after capture. Original browser screenshots stay in private QA scratch.

The child saves the complete receiving-state archive first, then both complete customer ZIPs through the current original Library helper. The unchanged three helper bodies are selected by exact hash. Their complete prepare/finalize requests, return values, exceptions, stdout and stderr remain in the private original observation directory. A completed save must retain its actual file IDs and confirm local metadata application.

The helper exposes one `run({"uploads": [...]})` operation and no resume interface. The carrier invokes it once. An uncertain result keeps this same private namespace and every complete artifact alive. It emits `ORIGINAL_UPLOAD_RECONCILIATION` and copies exact observations into the shared return. A partial or invalid reconciliation also preserves the namespace.

The sole operator may provide `return/upload/reconciliation.json` after reading the actual original save outcome. It must identify the exact selection hash, observed evidence and the complete ordered original result. A confirmed save with a local metadata failure may supply the original metadata response for the existing `apply-xattrs` helper; the completed file identity is retained. A successful metadata-only repair receipt is reused. If a local metadata attempt fails, an explicit next positive `attempt` number retains that failure and permits the same selected file to finish its local metadata repair. The carrier never creates a replacement save from an uncertain outcome.

## Shared return and final review

The shared return contains:

- Both complete verified customer ZIPs: `aiddata-IATI_Customer_Handover.zip` and `transparency-international-IATI_Customer_Handover.zip`.
- `customer-result.json` with both complete original customer results and their durable file identities.
- `receiving-return.json` with exact state-archive and customer-archive identities.
- `upload/` with exact original call/result observations and the final saving receipt.
- `native-record.tar.gz` with the complete original native record and per-file inventory.
- `native-result.json` and final `result.json`.
- `qa/` with the selected actual desktop/mobile original and reopened portfolio views for both publishers.

The complete ZIPs and state archive are saved before the private namespace ends. The shared return is checked against the original 6 MiB growth declaration before copies, accounting for exact already-published files on retry. Archive and copy failures retain the same live namespace in their original local custody phase until saving can complete. If the original native terminal record has not been observed, the foreground preserves the namespace and reports `ORIGINAL_NATIVE_TERMINAL_PENDING`.

Inspect the actual customer result and original runtime receipts, read both complete delivered ZIPs, and review the returned desktop/mobile images before reporting the native customer outcome. The source intake's independently verified identities remain the basis for that receiving.
