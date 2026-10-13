# Complete Eighteenmile original scientific source transfer

This is the complete 212-file source family already published in PR3402 (782b091d2769c09d77426cd697dabad29cc9665d), with its component declaration adopted in PR3436 (1aaebf63bf7cd0bcdb52493553cc14e8c0daa187). It contains the original EPA responses, original science/routing cohort, historical and load/volume analyses, both complete offline explorers, scientific recipe/figures and exact report importer. Scientific source and calculated results are unchanged.

The ordinary UTF-8 JSON file is 7918177 bytes; SHA256 6eeabdf5d081f45668b77762bedf31abbd7dfbd1b12944e0fc5e602b1d85ff88. It contains one standard gzip/base64 source packet. Uncompressed source-bank JSON: 75349253 bytes, SHA256 25a70cbab50de2f2ef477ae6685b592afc6f4c9c5f9ab293758502315cb3fca0. Compressed bytes: 5938323, SHA256 c79919876395eb9977d414edb6bb78cef63633a5288e5f754b14311ebcc458af. The 212 original members total 56479426 bytes. Every member carries its original path, size and SHA256. The report importer remains 5585 bytes / 15ff09c97a097fa04032ef73dc3f8946e4ccb498d378dd1504ba2a66bf8df8cb.

## Receive into a separate source directory

Save the complete ordinary Git file as a local JSON file through the existing native text receiver. Materialize into a fresh source directory; keep the cumulative application separately. This preserves current model, renderer and operator modules.

The following standard-library command verifies the entire carrier and every original member before exposing the finished source directory. The destination must not already exist.

```bash
python -B - /absolute/received/eighteenmile-point-source-complete-212-20261013.json /absolute/owned/point-source-originals <<'PY'
import base64, gzip, hashlib, json, os, pathlib, sys, tempfile
incoming = pathlib.Path(sys.argv[1]).read_bytes()
if len(incoming) != 7918177 or hashlib.sha256(incoming).hexdigest() != "6eeabdf5d081f45668b77762bedf31abbd7dfbd1b12944e0fc5e602b1d85ff88":
    raise ValueError("Complete original transfer identity does not match")
packet = json.loads(incoming)
if packet["schema"] != "upstate.application-source-part/v1" or (packet["part"], packet["parts"]) != (1, 1):
    raise ValueError("Choose the complete original single-packet transfer")
compressed = base64.b64decode(packet["data"], validate=True)
if len(compressed) != packet["compressed_bytes"] or hashlib.sha256(compressed).hexdigest() != packet["compressed_sha256"]:
    raise ValueError("Original compressed source identity does not match")
raw = gzip.decompress(compressed)
if len(raw) != packet["payload_bytes"] or hashlib.sha256(raw).hexdigest() != packet["payload_sha256"]:
    raise ValueError("Original complete source identity does not match")
bank = json.loads(raw)
if bank["schema"] != "commons.source-bank/v1" or len(bank["files"]) != 212:
    raise ValueError("Choose the full original 212-file source")
destination = pathlib.Path(sys.argv[2]).resolve()
if destination.exists():
    raise FileExistsError(destination)
destination.parent.mkdir(parents=True, exist_ok=True)
names, total = set(), 0
with tempfile.TemporaryDirectory(prefix="eighteenmile-source-", dir=destination.parent) as staging:
    root = pathlib.Path(staging) / "source"
    root.mkdir()
    for member in bank["files"]:
        name = member["path"]
        relative = pathlib.PurePosixPath(name)
        if relative.is_absolute() or ".." in relative.parts or str(relative) != name or name in names:
            raise ValueError("Original source member path is invalid or duplicated")
        names.add(name)
        body = base64.b64decode(member["content_base64"], validate=True)
        if len(body) != member["bytes"] or hashlib.sha256(body).hexdigest() != member["sha256"]:
            raise ValueError("Original source member identity does not match: " + name)
        target = root.joinpath(*relative.parts)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
        total += len(body)
    if total != 56479426:
        raise ValueError("Original complete source byte total does not match")
    root.rename(destination)
print(json.dumps({"source_root": str(destination), "files": len(names), "source_bytes": total,
                  "manifest": str(destination / "point_source_scientific.sources.json")}))
PY
```

## Run the existing native scientific report course

Use the maintained application and its actual interpreter. The manifest may be in the separate received source directory; the original Workspace importer retains its complete source closure.

```bash
ACTUAL_PYTHON -B ACTUAL_APPLICATION/source/observed-report-20261013/render.py \
  --app-root ACTUAL_APPLICATION \
  --workspace OWNED_HISTORY_ROOT/workspace --create-workspace \
  --manifest RECEIVED_SOURCE_ROOT/point_source_scientific.sources.json \
  --output OWNED_HISTORY_ROOT/rendered \
  --archive OWNED_HISTORY_ROOT/scientific-report.zip \
  --receive-directory OWNED_HISTORY_ROOT/received
```

The existing renderer imports the single typed scientific source, uses the original report/figure engine, exports the actual project and reopens it. Keep the application outside OWNED_HISTORY_ROOT, and keep archive/receive paths outside the captured application and Workspace. This is the existing source-only historical course; the original regional utility project and simulated-input model case retain their own identities.

The scientific manifest retains 187 total original members, seven sections and two line figures with 21 original coordinates. Full source context includes both EPA annual-estimation selector responses, original reporting-feature and species distinctions, exact monthly coverage, the five-year phosphorus baseline and the matched January–August comparison. Full inputs and replay modules remain in this same transfer.
