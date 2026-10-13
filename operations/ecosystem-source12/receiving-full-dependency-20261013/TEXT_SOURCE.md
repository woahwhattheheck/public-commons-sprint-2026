# Complete source text companion

This is the full retained 570-file source package from application commit
`60d028318626c091a126ab8708f380021a7e257a`, encoded as ordinary UTF-8 JSON so connected source tools can retrieve it.

`application-source.text.json` contains the exact existing `application-source.json.gz` bytes in `content_base64`. It adds no application code, changes no source member, and does not replace the original binary. The underlying scope and receiver remain those in [README.md](README.md).

| Layer | Bytes | SHA-256 |
| --- | ---: | --- |
| Text companion | 5,075,365 | e0b0a6bf0640eb42dd2b2f9b3f475d9fc6bbca436d64c9b1596d4a39b3bed79b |
| Original gzip | 3,806,053 | b64241f89b4284e1156095fdd51b870d4e12b574daf1734e93e8e17f828decf2 |
| Complete decoded source map | 13,485,181 | 1827cecd39b28a11298ee085449ed884f3337f13cc33dcedd621fc54cf1db300 |

The source map retains all 570 full member bodies and their original per-file byte counts, SHA-256 hashes, modes and Git blobs. Its 570 source bodies total 12,776,062 UTF-8 bytes. Later published Community context/receiving helpers are a separate maintained overlay; presence is determined by this map's actual file keys.

## Read through connected tools

Use an ordinary Git file/blob read of `application-source.text.json`. Parse the JSON, base64-decode `content_base64`, verify `gzip_bytes`/`gzip_sha256`, then gunzip and verify `decoded_bytes`/`decoded_sha256`. Parse that decoded UTF-8 JSON; the original complete source is in `files` and member identities in `file_metadata`.

The text Git blob is `29db1ea6ff92e7397707d13d28fdf2753443d7f1`. The unchanged gzip Git blob is `2701164b9551244d0b9416be29d825fc2c308a79`.

## Restore the original gzip with Python 3

Run the following in a new receiving directory beside the downloaded text companion. It reuses only an identical existing output and otherwise atomically creates the original gzip without replacing a different file.

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
