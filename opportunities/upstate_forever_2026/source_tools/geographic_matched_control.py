"""Bind the geographic headwaters producer to bounded regional control matching."""
from __future__ import annotations
import argparse
import json
import os
from pathlib import Path

from source_tools.regional_matched_control import prepare, _identity, _check, _implementation_snapshot

def prepare_control(nlcd_path, restoration_path, corridor_path, reporting_mask_path,
                    precipitation_path, destination, *, seed, progress=None,
                    matching_method="greedy", max_working_bytes=1024 * 1024 * 1024):
    """Return a complete original-source control mask and exact class/rainfall summary.

    restoration_path is the actual restored NLCD, not a binary treatment mask.
    Only literal mask value 1 selects a cell; nodata never selects support.
    The seed identifies the producer recipe; this matcher itself is deterministic.
    """
    import hashlib
    import numpy as np
    import rasterio
    from rasterio.windows import Window
    from model.common import atomic_json, digest, held
    if type(seed) is not int:
        raise ValueError("Retain the producer's actual integer seed")
    originals = {
        "NLCD": Path(nlcd_path).resolve(strict=True),
        "RESTORED_NLCD": Path(restoration_path).resolve(strict=True),
        "RESTORATION_MASK": Path(corridor_path).resolve(strict=True),
        "REPORTING_MASK": Path(reporting_mask_path).resolve(strict=True),
        "PRECIPITATION": Path(precipitation_path).resolve(strict=True),
    }
    source_entries = {role: {"path": str(path), **_identity(path)} for role, path in originals.items()}
    implementation = _implementation_snapshot()
    code = implementation["geographic_matched_control.py"]
    implementation_identity = {name: {"bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
                               for name, body in implementation.items()}
    request = {"schema": "upstate.geographic-matched-control-request/v1",
               "sources": source_entries, "seed": seed,
               "matching_method": matching_method, "max_working_bytes": max_working_bytes,
               "adapter_sha256": hashlib.sha256(code).hexdigest(),
               "retained_implementation": implementation_identity,
               "domain_definition": "Every valid original baseline NLCD cell; checked against all input roles by the matcher"}
    root = Path(destination).resolve() / ("geographic-control-" + digest(request))
    if any(root == path or root in path.parents for path in originals.values()):
        raise ValueError("Control output must not contain an original input")
    root.mkdir(parents=True, exist_ok=True)
    with held(root / ".adapter.lock", blocking=False):
        atomic_json(root / "request.json", request, immutable=True)
        domain_path, receipt_path = root / "model-domain-mask.tif", root / "domain-mask.json"
        if receipt_path.exists():
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
            if receipt["request"] != request:
                raise ValueError("Retained domain mask uses another producer request")
            _check(domain_path, receipt["file"])
        else:
            pending = root / "model-domain-mask.pending.tif"
            with rasterio.open(originals["NLCD"]) as source:
                profile = dict(driver="GTiff", width=source.width, height=source.height,
                               count=1, dtype="uint8", crs=source.crs, transform=source.transform,
                               nodata=255, tiled=True, blockxsize=256, blockysize=256,
                               compress="deflate", BIGTIFF="IF_SAFER")
                with rasterio.open(pending, "w", **profile) as target:
                    for row in range(0, source.height, 256):
                        for col in range(0, source.width, 256):
                            window = Window(col, row, min(256, source.width-col), min(256, source.height-row))
                            block = source.read(1, window=window, masked=True)
                            active = (~np.ma.getmaskarray(block)) & np.isfinite(block.data)
                            target.write(np.where(active, 1, 255).astype("uint8"), 1, window=window)
                    target.update_tags(role="MODEL_DOMAIN_MASK",
                                       source_sha256=source_entries["NLCD"]["sha256"],
                                       selection="Original baseline NLCD valid pixels; no inferred buffer")
            _check(originals["NLCD"], source_entries["NLCD"])
            os.replace(pending, domain_path)
            atomic_json(receipt_path, {"request": request, "file": _identity(domain_path)}, immutable=True)
        configuration = {
            "schema": "upstate.regional-matched-control-input/v1",
            "sources": {**source_entries, "MODEL_DOMAIN_MASK": {"path": str(domain_path), **_identity(domain_path)}},
            "from_codes": [81, 82], "to_code": 41, "window_size": 256,
            "matching_method": matching_method, "max_working_bytes": max_working_bytes,
            "source_binding": {"producer": "model.geographic_headwaters", "seed": seed,
                               "request_sha256": digest(request),
                               "restoration": "Actual baseline81/82 to restored41, inside reporting value1",
                               "exclusion": "Whole corridor and every actual restored cell"},
            "title": "Original geographic headwaters: simulated regional matched control",
        }
        result = prepare(configuration, root, root / "matched", progress=progress,
                         _retained_code=implementation)
        result_root = Path(result["directory"])
        summary = result["summary"]
        output = result_root / "control-mask.tif"
        mask = {"path": str(output), **_identity(output), "selected_value": 1, "nodata": 255,
                "kind": "raster", "units": "mask"}
        reply = {
            "schema": "upstate.geographic-matched-control/v1",
            "mask": mask, "control_mask": mask, "path": str(output), "mask_path": str(output),
            "changed_cells": summary["changed_cells"], "hectares": summary["changed_area_ha"],
            "changed_hectares": summary["changed_area_ha"],
            "class_counts": {str(item["from_code"]): item["control_cells"] for item in summary["by_original_class"]},
            "matching_method": summary["method"],
            "rainfall_by_class": summary["by_original_class"],
            "overlap_with_restoration_corridor_cells": 0,
            "source_manifest": result["source_manifest"], "source_id": result["source_id"],
            "preparation_path": str(result_root / "control-prepared.json"),
            "summary_path": str(result_root / "matching-summary.json"),
            "pairs_path": str(result_root / "matched-pairs.csv"),
            "preparation": result, "state": "prepared",
        }
        # The original request and adapter are retained beside the full matcher bank.
        adapter_path = root / "geographic_matched_control.py"
        if adapter_path.exists() and adapter_path.read_bytes() != code:
            raise ValueError("Original retained producer adapter changed")
        if not adapter_path.exists():
            pending = adapter_path.with_suffix(".pending")
            with pending.open("wb") as stream:
                stream.write(code)
                stream.flush()
                os.fsync(stream.fileno())
            os.replace(pending, adapter_path)
        atomic_json(root / "prepared.json", reply, immutable=True)
        return reply


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("nlcd", "restoration", "corridor", "reporting-mask", "precipitation", "destination"):
        parser.add_argument("--" + name, type=Path, required=True)
    parser.add_argument("--seed", type=int, required=True)
    parser.add_argument("--matching-method", choices=("greedy", "exact_monge"), default="greedy")
    parser.add_argument("--max-working-bytes", type=int, default=1024 * 1024 * 1024)
    args = parser.parse_args(argv)
    result = prepare_control(args.nlcd, args.restoration, args.corridor, args.reporting_mask,
                             args.precipitation, args.destination, seed=args.seed,
                             matching_method=args.matching_method, max_working_bytes=args.max_working_bytes,
                             progress=lambda value: print(json.dumps(value, allow_nan=False), flush=True))
    print(json.dumps(result, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
