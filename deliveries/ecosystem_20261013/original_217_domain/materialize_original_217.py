"""Restore the byte-identical original 217-watershed gzip from its retained carrier."""
from __future__ import annotations
import argparse
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path
import tempfile

TEXT_BYTES = 4977044
TEXT_SHA256 = "6611850144877557aa2b147d5e9f5e54c2090ee319fea3673c62abee5071b796"
GZIP_BYTES = 3732669
GZIP_SHA256 = "6f49c2f1dc10709d7957e38e92642a1de4cda44e67e4d70a8bc2ff51388e6af9"
JSON_BYTES = 11220042
JSON_SHA256 = "2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af"


def checked(body, count, expected, label):
    actual = hashlib.sha256(body).hexdigest()
    if len(body) != count or actual != expected:
        raise ValueError(f"{label} differs: {len(body)} bytes / SHA256 {actual}")
    return body


def materialize(carrier, destination):
    text = checked(Path(carrier).read_bytes(), TEXT_BYTES, TEXT_SHA256, "Original carrier")
    compressed = checked(
        base64.b64decode(b"".join(text.splitlines()), validate=True),
        GZIP_BYTES, GZIP_SHA256, "Original gzip")
    decoded = checked(gzip.decompress(compressed), JSON_BYTES, JSON_SHA256, "Original geometry")
    native = json.loads(decoded)
    features = native.get("features", [])
    reference = native.get("spatialReference", {})
    if (len(features) != 217 or reference.get("wkid") != 102100
            or reference.get("latestWkid") != 3857):
        raise ValueError("The original 217-feature native coordinate metadata differs")
    hucs = [row["attributes"]["huc12"] for row in features]
    ids = [row["attributes"]["objectid"] for row in features]
    if (len(set(hucs)) != 217 or len(set(ids)) != 217
            or any(not isinstance(huc, str) or len(huc) != 12 or not huc.isdigit()
                   for huc in hucs)):
        raise ValueError("The original native watershed identities differ")
    target = Path(destination).expanduser().absolute()
    target.parent.mkdir(parents=True, exist_ok=True)
    reused = False
    if target.exists() or target.is_symlink():
        if target.is_symlink() or not target.is_file():
            raise ValueError("The destination is not a regular retained file")
        checked(target.read_bytes(), GZIP_BYTES, GZIP_SHA256, "Existing original gzip")
        reused = True
    else:
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(prefix=".original-domain-", dir=target.parent,
                                             delete=False) as handle:
                temporary = Path(handle.name)
                handle.write(compressed)
                handle.flush()
                os.fsync(handle.fileno())
            try:
                os.link(temporary, target)
            except FileExistsError:
                if target.is_symlink() or not target.is_file():
                    raise ValueError("The destination changed during publication")
                checked(target.read_bytes(), GZIP_BYTES, GZIP_SHA256, "Existing original gzip")
                reused = True
        finally:
            if temporary is not None:
                temporary.unlink(missing_ok=True)
    return {
        "schema": "upstate.original-domain-materialization/v1",
        "path": str(target), "bytes": GZIP_BYTES, "sha256": GZIP_SHA256,
        "decoded_bytes": JSON_BYTES, "decoded_sha256": JSON_SHA256,
        "feature_count": 217, "native_id_field": "objectid", "huc_id_field": "huc12",
        "source_crs": "EPSG:3857", "original_spatial_reference": reference,
        "reused": reused, "geometry_transformations": [],
        "intake": "Import the adjacent sources.json through Workspace.import_sources; retain its returned collection ID.",
    }


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base64", type=Path, required=True)
    parser.add_argument("--output", type=Path,
                        default=Path(__file__).resolve().parent / "model-domain.esri.json.gz")
    args = parser.parse_args(argv)
    print(json.dumps(materialize(args.base64, args.output), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
