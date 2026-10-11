"""Package the compiled runtime without the offline simulator imports."""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
import zipfile

from warmstart import _read_bank


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--bank", type=Path, default=Path(__file__).with_name("warmstart_bank.npz"))
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    bank = _read_bank(args.bank)
    members = {
        "submission.py": source / "submission_corpus096.py",
        "warmstart.py": source / "warmstart.py",
        "warmstart_bank.npz": args.bank,
        "requirements.txt": source / "requirements.txt",
        "THIRD_PARTY_LICENSE.txt": source / "official" / "LICENSE",
    }
    payloads = {name: path.read_bytes() for name, path in members.items()}
    args.output.parent.mkdir(parents=True, exist_ok=True)
    # Exclusive creation protects an existing frozen candidate archive.
    with args.output.open("xb") as stream:
        try:
            with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED,
                                 compresslevel=9) as archive:
                for name, content in payloads.items():
                    info = zipfile.ZipInfo(name, date_time=(2026, 10, 11, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o100644 << 16
                    archive.writestr(info, content)
        except Exception:
            args.output.unlink(missing_ok=True)
            raise
    print(json.dumps({
        "archive": str(args.output), "bytes": args.output.stat().st_size,
        "sha256": hashlib.sha256(args.output.read_bytes()).hexdigest(),
        "source_dataset_sha256": bank["metadata"]["source"]["sha256"],
        "members": {name: {"bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}
                    for name, content in payloads.items()},
    }, indent=2))


if __name__ == "__main__":
    main()
