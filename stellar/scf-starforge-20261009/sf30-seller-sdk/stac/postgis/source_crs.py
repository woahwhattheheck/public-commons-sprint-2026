"""Check the operator's CRS mapping using the original vector native engine."""
from __future__ import annotations
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from vector.driver import capabilities, crs, same_crs

def main():
    request = json.load(sys.stdin)
    observed = []
    for layer in request["layers"]:
        source, target = layer["sourceWkt"], layer["targetWkt"]
        if not source or not target:
            raise ValueError("POSTGIS_REGISTERED_SRID_REQUIRED")
        original = layer.get("originalWkt")
        source_crs, target_crs = crs(source), crs(target)
        if not layer["assign"]:
            if not original:
                raise ValueError("POSTGIS_EXPLICIT_CRS_ASSIGNMENT_REQUIRED")
            if not same_crs(original, source):
                raise ValueError("POSTGIS_ORIGINAL_CRS_MAPPING_CONFLICT")
        observed.append({
            "layerId": layer["layerId"],
            "sourceWkt": source_crs.to_wkt(),
            "targetWkt": target_crs.to_wkt(),
            "originalWkt": original,
            "action": "assign-and-transform" if layer["assign"] and not same_crs(source, target)
                else "assign" if layer["assign"]
                else "transform" if not same_crs(source, target) else "preserve",
            "coordinateOrder": "x,y",
        })
    print(json.dumps({"schema": "starforge.postgis-crs-observation.v1",
                      "engine": capabilities(), "layers": observed}, sort_keys=True))

if __name__ == "__main__":
    main()
