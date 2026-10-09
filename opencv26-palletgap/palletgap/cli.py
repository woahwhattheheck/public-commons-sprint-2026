"""Local, offline visual audit CLI. No hardware control and no external telemetry."""
from __future__ import annotations
import argparse
import json
from pathlib import Path

import cv2
from .vision import mark_reference, orchestrate, read_image


def main() -> int:
    parser = argparse.ArgumentParser(prog="palletgap")
    parser.add_argument("--reference", required=True)
    parser.add_argument("--frame", required=True)
    parser.add_argument("--confirmation")
    parser.add_argument("--camera", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    settings = json.loads(Path(args.camera).read_text(encoding="utf-8"))
    reference = read_image(args.reference)
    initial = read_image(args.frame)
    followup = read_image(args.confirmation) if args.confirmation else None
    decision = orchestrate(reference, initial, settings["aisle_polygon"], followup)
    # Only output reference with drawn bounding boxes, not the input camera images.
    (out / "decision.json").write_text(json.dumps(decision, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    overlay = mark_reference(reference, settings["aisle_polygon"], decision)
    cv2.imwrite(str(out / "annotation.png"), overlay)
    print(json.dumps({"decision": decision["decision"], "next_action": decision["next_action"], "receipt": str(out / "decision.json")}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
