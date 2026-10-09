"""Create one transparent offline demonstration from synthetic fixtures."""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import cv2
from .synthetic import make_scene
from .vision import inspect


def main() -> None:
    parser = argparse.ArgumentParser(description="Write a synthetic DrainGuard judge demo")
    parser.add_argument("--out", type=Path, default=Path("demo/artifacts"))
    args = parser.parse_args()
    output = args.out
    output.mkdir(parents=True, exist_ok=True)
    before, after, slots = make_scene()
    report, overlay = inspect(before, after, slots)
    report["fixture"] = "fully_synthetic_seed_20261009"
    report["opencv_runtime"] = cv2.__version__
    report["not_live_aws_or_real_road_evidence"] = True
    assert cv2.imwrite(str(output / "reference.png"), before)
    assert cv2.imwrite(str(output / "capture.png"), after)
    assert cv2.imwrite(str(output / "annotated.png"), overlay)
    (output / "report.json").write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    (output / "slots.json").write_text(json.dumps([{"id":s.slot_id,"x":s.x,"y":s.y,"width":s.width,"height":s.height} for s in slots], indent=2)+"\n", encoding="utf-8")
    print(json.dumps({"status": report["status"], "slots": {s["slot_id"]: s["classification"] for s in report["slots"]},
                     "runtime": cv2.__version__, "output": str(output)}, indent=2))

if __name__ == "__main__":
    main()
