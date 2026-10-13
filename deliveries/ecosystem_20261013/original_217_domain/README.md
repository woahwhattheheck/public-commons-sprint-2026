# Original 217-watershed domain

This source is the retained original Upper Savannah model-domain response, carried losslessly as Base64 of its original gzip. It contains all 217 original watershed features. The native coordinate reference is Esri 102100 / latest WKID 3857.

`Original217_Gzip_Base64.txt` preserves the existing wrapped text exactly. Decode its Base64, verify the gzip identity, then decompress the original response. No geometry or source attributes are transformed.

| Representation | Bytes | SHA-256 |
| --- | ---: | --- |
| Wrapped Base64 text | 4,977,044 | `6611850144877557aa2b147d5e9f5e54c2090ee319fea3673c62abee5071b796` |
| Original gzip | 3,732,669 | `6f49c2f1dc10709d7957e38e92642a1de4cda44e67e4d70a8bc2ff51388e6af9` |
| Decoded original JSON | 11,220,042 | `2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af` |

The Base64 text contains 4,976,892 encoding characters and 152 newline bytes. Normal Base64 decoding ignores that line wrapping. The connected Git blob is `5aa01038d5269fe898cfb2db0cf40b0023c0c382` in `woahwhattheheck/public-commons-sprint-2026`; connected Git file retrieval provides the complete text when a receiving runtime cannot resolve its ordinary download host.

## Retained provenance

The original decoded response, gzip and Base64 carrier remain separately retained under their existing file identities. The originating complete domain archive is `dbc61-upstate-model-domain-20261012.zip`, 8,800,689 bytes, SHA-256 `1fc35e5d0986e42d93922527d46e38bc5132653db75863934349dbbfaa352c04`.

The original operated source was `upstate-wbd-upstream-domain-20261012`, collection `e11ef0eedfd65f245d5761a76cc0051be7d66b3d49b6e5dfe0a4fa6502f7b023`. A receiving workspace should retain an existing matching collection. A separately supplied transport intake manifest can bind these identical original bytes when a new intake is required; the native importer returns that intake's actual collection identity.

This carrier continues the existing assessment receiving operation4731. Keep the receiving workspace's actual project identity, original input editions and native task journal with its preparation and completed outputs. Current owner direction remains `opportunities/upstate_forever_2026/CURRENT_OWNER_DIRECTION.md`, version2026-10-13.3.

## Materialize and receive

Keep all files in this directory together. Run the supplied decoder with the original encoded file:

```sh
python materialize_original_217.py --base64 Original217_Gzip_Base64.txt --output model-domain.esri.json.gz
```

The decoder verifies all three complete byte sequences and their SHA-256 values, then writes the original gzip once or reuses an identical existing file. Its JSON output names the actual saved path and all 217 original watershed identities. It uses Python's standard library.

The adjacent `sources.json` is a current transport intake manifest. Its companion `source-provenance.json` retains the original archive, original operated source identity, original field definitions and this exact encoded carrier. Where a matching original domain collection is already imported, continue using it. Otherwise add this manifest to the existing assessment preparation command as a fifth repeated argument:

```sh
--manifest INTAKE/sources.json
```

`INTAKE` is the directory containing these five files and the materialized original gzip. Keep the existing four assessment `--manifest` arguments as well. The native preparation imports every supplied manifest before selecting its original model domain and records the actual returned collection IDs. An explicit existing `Workspace.import_sources` import of this same manifest is also supported.

If an earlier preparation already saved an immutable selection with only the original four manifests, choose a fresh preparation output directory for this five-manifest invocation. Keep the same actual receiving Workspace, project identity and operation4731. The original four assessment source bodies and the current admitted scientific calculation files remain identical.

## Start a separate source-assessment Workspace

The assessment preparation accepts an existing native Workspace. If this receiving host is starting the source-assessment course without an earlier project restore, initialize a fresh Workspace through the original API before running preparation. Set `ECO_APP` to the isolated application, `ECO_PYTHON` to its scientific Python executable and `ASSESSMENT_WORKSPACE` to a separate new source-assessment directory:

```sh
PYTHONPATH="$ECO_APP" "$ECO_PYTHON" - "$ASSESSMENT_WORKSPACE" <<'PY'
import json
import sys
from model.workspace import Workspace
workspace = Workspace(sys.argv[1], create=True, title="Upper Savannah source assessment")
print(json.dumps({"workspace": str(workspace.root), "project_id": workspace.project["id"]}, indent=2))
PY
```

Retain that actual generated project ID and use the same path as `--workspace` in the existing preparation command. Keep the separate receiving Workspace and preparation output outside the application and this source Workspace. The preparation imports the unchanged original source bodies through the five manifests, builds the three station studies and four assessment contexts, and independently receives them. This source-assessment course needs no NDR/SDR rerun or historical 246 MB Workspace restore. An already admitted native model or annual-map task continues in its own physical Workspace.
