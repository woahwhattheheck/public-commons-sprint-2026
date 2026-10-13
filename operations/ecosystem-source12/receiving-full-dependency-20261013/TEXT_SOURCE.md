# Complete source text companion

This is the full retained 570-file source package from application commit
`60d028318626c091a126ab8708f380021a7e257a`, encoded as ordinary UTF-8 JSON so connected source tools can retrieve it.

`application-source.text.json` contains the exact existing `application-source.json.gz` bytes in `content_base64`. It adds no application code, changes no source member, and does not replace the original binary. The underlying scope and receiver remain those in [README.md](README.md).

| Layer | Bytes | SHA-256 |
| --- | ---: | --- |
| Text companion | 4,224,973 | c20332ff03837e12eac7bc08800bf8b2992e74690572173399d22801b7797f5a |
| Gzip source map | 3,168,260 | bbd13bdbee5354d9dcd22b4d31f58e452ff49c6caef6386d840bbeda7763e358 |
| Complete decoded source map | 13,517,151 | 79c8e4cddb33e0ed371647dc96d36a07b8a21353e71299794d540fe734869cc2 |

The source map contains all 570 full member bodies with per-file byte counts, SHA-256 hashes, modes and Git blobs. Its 570 source bodies total 12,775,447 UTF-8 bytes. Later published Community context/receiving helpers are a separate maintained overlay; presence is determined by this map's actual file keys.

## Read through connected tools

Use an ordinary Git file/blob read of `application-source.text.json`. Parse the JSON, base64-decode `content_base64`, verify `gzip_bytes`/`gzip_sha256`, then gunzip and verify `decoded_bytes`/`decoded_sha256`. Parse that decoded UTF-8 JSON; the complete source is in `files` and member identities in `file_metadata`.

The text Git blob is `3fad1a55d0769ac1889f552585094a2a92d18f10`. The gzip Git blob is `42568994b9c86747c449c730b59b7160c9c8b03a`.

## Restore the gzip source map with Python 3

Run the following in a new receiving directory beside the downloaded text companion. It reuses only an identical existing output and otherwise atomically creates the gzip source map without replacing a different file.

```python
import base64, gzip, hashlib, json, os, tempfile
from pathlib import Path

source = Path("application-source.text.json")
target = Path("application-source.json.gz")
envelope = json.loads(source.read_text(encoding="utf-8"))
if envelope.get("schema") != "commons.artifact-base64/v1" or envelope.get("encoding") != "gzip+base64":
    raise ValueError("Unexpected source-companion format")
packed = base64.b64decode(envelope["content_base64"], validate=True)
def check(body, length, digest):
    if len(body) != length or hashlib.sha256(body).hexdigest() != digest:
        raise ValueError("Source-companion identity mismatch")
check(packed, envelope["gzip_bytes"], envelope["gzip_sha256"])
raw = gzip.decompress(packed)
check(raw, envelope["decoded_bytes"], envelope["decoded_sha256"])
decoded = json.loads(raw.decode("utf-8"))
if len(decoded["files"]) != envelope["files"]:
    raise ValueError("Source-member count mismatch")
def reuse():
    if not target.is_file() or target.read_bytes() != packed:
        raise FileExistsError("Refusing to replace a different existing gzip")
if target.exists():
    reuse()
else:
    descriptor, temporary = tempfile.mkstemp(prefix=".source-", dir=str(target.parent))
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(packed)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temporary, target)
        except FileExistsError:
            reuse()
    finally:
        os.unlink(temporary)
print(str(target), len(packed), hashlib.sha256(packed).hexdigest())
```

Then use the already supplied original receiver in a fresh destination:

```sh
python -B receive_application_source.py application-source.json.gz \
  --output /absolute/7e42-source-60d028 \
  --zip /absolute/7e42-source-60d028.zip
```

The receiver verifies all member identities and preserves current installed applications. Keep already successful native workspaces and processes intact; adopt any needed source through their existing assembler and retained preimages.
