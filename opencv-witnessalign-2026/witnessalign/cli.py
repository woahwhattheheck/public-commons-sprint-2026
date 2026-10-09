"""Local human-review CLI; no camera, upload, credential or provider access."""
from __future__ import annotations

import argparse
import json
import os
import tempfile
from pathlib import Path

from .engine import analyze, EvidenceError, MAX_IMAGE_BYTES


def _bounded_image_bytes(path: Path) -> bytes:
    # The vision engine rejects >4 MB, so do not first load an unbounded file.
    if path.stat().st_size > MAX_IMAGE_BYTES:
        raise EvidenceError(f"{path.name}: image exceeds {MAX_IMAGE_BYTES} bytes")
    raw = path.read_bytes()
    if len(raw) > MAX_IMAGE_BYTES:  # File may have grown after stat().
        raise EvidenceError(f"{path.name}: image exceeds {MAX_IMAGE_BYTES} bytes")
    return raw


def _atomic_write(path: Path, data: bytes) -> None:
    # A partial write must not leave truncated evidence under its final name.
    fd, staged = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
        os.replace(staged, path)
    finally:
        if os.path.exists(staged):
            os.unlink(staged)


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description="Compare a golden reference with a candidate photo")
    p.add_argument("reference", type=Path)
    p.add_argument("candidate", type=Path)
    p.add_argument("--output", type=Path, default=Path("out"))
    a = p.parse_args(argv)
    try:
        outcome, overlay = analyze(_bounded_image_bytes(a.reference), _bounded_image_bytes(a.candidate))
        a.output.mkdir(parents=True, exist_ok=True)
        overlay_path = a.output / "review-overlay.png"
        if overlay is None:
            # Recapture has no image evidence. Remove any prior run's overlay
            # BEFORE publishing this audit; never pair stale imagery with it.
            overlay_path.unlink(missing_ok=True)
        else:
            _atomic_write(overlay_path, overlay)
        # Publish the current audit last; neither artifact is written in-place.
        _atomic_write(a.output / "audit.json", (json.dumps(outcome, indent=2) + "\n").encode("utf-8"))
        print(json.dumps({"decision": outcome["decision"], "candidate_regions": len(outcome["candidate_regions"]),
                          "output": str(a.output)}))
        return 0
    except (EvidenceError, OSError) as exc:
        p.exit(2, f"ERROR: {exc}\n")


if __name__ == "__main__":
    raise SystemExit(main())
