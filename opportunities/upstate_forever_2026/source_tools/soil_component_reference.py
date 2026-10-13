"""Continue the actual retained SC007 native interpretation with full soil rows.

This source is an interpretation reference, with 34 original MUKEYs and all 49
original source members. It contains no polygon support and is never relabelled
as a regional geometry capture.
"""
from __future__ import annotations
import argparse
import csv
from decimal import Decimal
import gzip
import hashlib
import io
import json
from pathlib import Path, PurePosixPath
import stat
import zipfile

from model.common import (atomic_json, canonical, digest, file_digest, held,
                          read_json, verify_file)
from source_tools import soil_components as components, soil_region
from source_tools.soil_sources import (Sda, SERVICE, K_FACTOR, _choice_coefficients,
                                       table)

ORIGINAL = {
    "method.json": {"bytes": 8697,
        "sha256": "64a83d04ba9a6486c7e79724efaf81456e4ffe599cccc8f77664e90a7ae9561f"},
    "source-capture.zip": {"bytes": 118202,
        "sha256": "8988e539b70ef3fd8877591114a739b0f05b61c3fccc1d16a493230ccb312152"},
    "native-whole-soil.csv": {"bytes": 1494,
        "sha256": "195c0bc00b8fa53fbb3ce754e2e06321161c33145ecfab3e334097c10b8084b3"}}
SOURCE_ID = "sda-whole-soil-sc007-20261012-109629"


def verify_reference(reference_file):
    """Read the selected actual original; preserve raw ZIP and every member."""
    main = Path(reference_file).resolve(strict=True)
    root = main.parent
    if main.name != "native-whole-soil.csv":
        raise ValueError("Select the original native-whole-soil.csv interpretation reference")
    for name, expected in ORIGINAL.items():
        verify_file(root, {"path": name, **expected})
    method = read_json(root / "method.json")
    archive = method["source_archive"]
    if archive != {"path": "source-capture.zip", **ORIGINAL["source-capture.zip"]}:
        raise ValueError("Original method identifies another retained archive")
    if (method["native_attribute"].get("column") != "kwfact" or
            method["native_attribute"].get("table") != "chorizon" or
            method["parameters"].get("AggregationMethod") != "Dominant Condition" or
            method["parameters"].get("HorizonAggregationMethod") != "Surface Layer"):
        raise ValueError("Preserve the actual original whole-soil surface interpretation")
    inventory = {}
    for item in method["source_members"]:
        name = item["path"]
        path = PurePosixPath(name)
        if (name in inventory or path.is_absolute() or str(path) != name or
                any(p in ("..", ".") for p in path.parts) or "\\" in name):
            raise ValueError("Original soil ZIP member identity is ambiguous")
        inventory[name] = item
    members = {}
    with zipfile.ZipFile(root / archive["path"], "r") as zipped:
        if len(zipped.infolist()) != len(inventory) or set(zipped.namelist()) != set(inventory):
            raise ValueError("Retain all original soil archive members exactly once")
        for item in zipped.infolist():
            declared = inventory[item.filename]
            mode = item.external_attr >> 16
            if item.is_dir() or stat.S_ISLNK(mode) or item.file_size != declared["bytes"]:
                raise ValueError("Original soil ZIP member type or length changed")
            body = zipped.read(item)
            if hashlib.sha256(body).hexdigest() != declared["sha256"]:
                raise ValueError("Original soil ZIP member changed: " + item.filename)
            members[item.filename] = body
    rating = json.loads(members["calculation/native-rating-000000.json"])
    if (rating["aoiid"] != method["aoiid"] or
            rating["interpresultid"] != method["interpretation_id"] or
            rating["parameters"] != method["parameters"]):
        raise ValueError("Original native calculation identity changed")
    for name in ("ratings", "legend"):
        prefix = "calculation/original/mapunit-batch-000000/" + name + "/"
        receipt = json.loads(members[prefix + "0001.capture.json"])
        wire = gzip.decompress(members[prefix + "0001.body.gz"])
        if (receipt["status"] != 200 or len(wire) != receipt["bytes"] or
                hashlib.sha256(wire).hexdigest() != receipt["sha256"] or
                table(wire) != rating[name]):
            raise ValueError("Native calculation differs from its original successful " + name)
    coefficients = _choice_coefficients(rating["ratings"], rating["legend"],
                                        rating["aoiid"], rating["interpresultid"])
    if coefficients != rating["coefficients"]:
        raise ValueError("Recorded coefficients differ from original native rating/legend")
    baseline = {}
    for row in coefficients:
        key = components._key(row["MapUnitKey"])
        if key in baseline:
            raise ValueError("Original native interpretation repeats a mapunit")
        baseline[key] = row["value"]
    rows = list(csv.DictReader(io.StringIO(main.read_text(encoding="utf-8"), newline="")))
    if (len(rows) != len(baseline) or len(rows) != method["mapunits"] or
            len({r["MapUnitKey"] for r in rows}) != len(rows)):
        raise ValueError("Original CSV and native mapunit selection differ")
    for row in rows:
        key = components._key(row["MapUnitKey"])
        coefficient = components._decimal(baseline[key])
        if (str(row["AoiID"]) != str(method["aoiid"]) or
                str(row["AoiSoilThematicMapID"]) != str(method["interpretation_id"]) or
                components._decimal(row["K_native"]) != coefficient or
                components._decimal(row["K_SI"]) !=
                    (coefficient * K_FACTOR if coefficient is not None else None)):
            raise ValueError("Original CSV changes the selected native coefficient or conversion")
    surveys = table(members["initial/regional-survey-catalog-form.body"])
    selected_surveys = [r for r in surveys if r["areasymbol"] == method["areasymbol"]]
    if len(selected_surveys) != 1:
        raise ValueError("Retain the actual original SC007 survey catalogue")
    return {
        "schema": "upstate.soil-interpretation-reference/v1", "source_id": SOURCE_ID,
        "main": main.name, "method_sha256": file_digest(root / "method.json"),
        "archive_sha256": archive["sha256"], "original_aoiid": method["original_aoiid"],
        "aoiid": method["aoiid"], "interpretation_id": method["interpretation_id"],
        "mapunit_keys": sorted(baseline, key=int), "baseline": baseline,
        "surveys": selected_surveys, "parameters": method["parameters"],
        "source_members": method["source_members"],
        "files": [{"path": name, **expected} for name, expected in ORIGINAL.items()]}


def capture_reference(reference_file, output, *, vintage, batch_size=100, resume=False):
    original = Path(reference_file).resolve(strict=True)
    reference = verify_reference(original)
    if not isinstance(vintage, str) or not vintage.strip():
        raise ValueError("Name the actual new component/horizon source edition")
    if type(batch_size) is not int or not 1 <= batch_size <= 1000:
        raise ValueError("Choose 1 to 1000 original mapunits per request")
    root = Path(output).resolve()
    if root == original.parent or original.parent in root.parents or root in original.parent.parents:
        raise ValueError("Use a distinct output beside the original interpretation source")
    root.mkdir(parents=True, exist_ok=True)
    keys = reference["mapunit_keys"]
    plan = {"schema": "upstate.soil-component-capture-plan/v1",
            "source_kind": "interpretation_reference", "reference": reference,
            "mapunit_keys": keys, "vintage": vintage, "batch_size": batch_size,
            "source": SERVICE, "source_tables": list(components.TABLE_KEYS),
            "references": components.REFERENCES}
    with held(root / "capture.lock", blocking=False):
        atomic_json(root / "plan.json", plan, immutable=True)
        if (root / "capture.json").exists():
            return components.verify_capture(root)[0]
        client = Sda(root, resume=resume)
        metadata, merged, before, after = components._capture_tables(
            client, keys, batch_size, root, plan)
        for old in reference["surveys"]:
            current = before.get(old["areasymbol"])
            if current is None or any(str(current.get(k)) != str(old.get(k))
                                      for k in ("areasymbol", "saverest")):
                raise ValueError("New source tables differ from the original SC007 survey edition")
        if set(before) != {r["areasymbol"] for r in reference["surveys"]}:
            raise ValueError("Original selected mapunits resolve to a different survey")
        tables = {name: [rows[k] for k in sorted(rows)] for name, rows in merged.items()}
        components.relations(tables)
        atomic_json(root / "tables.json", tables, immutable=True)
        atomic_json(root / "native-baseline.json", reference["baseline"], immutable=True)
        atomic_json(root / "survey-binding.json",
                    {"original_interpretation": reference["surveys"],
                     "before": before, "after": after}, immutable=True)
        for member in reference["files"]:
            soil_region._copy(verify_file(original.parent, member),
                              root / "reference" / member["path"], member)
        if (original.parent / "source-manifest.json").is_file():
            soil_region._copy(original.parent / "source-manifest.json",
                              root / "reference" / "source-manifest.json")
        record = {"schema": components.SCHEMA, "state": "complete",
            "plan_sha256": digest(plan), "source_id": "usda-soil-components-" + digest(plan)[:16],
            "regional_capture": None, "reference_capture": "reference",
            "reference_filename": original.name,
            "native_baseline": "native-baseline.json",
            "native_baseline_sha256": digest(reference["baseline"]),
            "tables": "tables.json", "tables_sha256": digest(tables),
            "attribute_metadata": "attribute-metadata.json",
            "attribute_metadata_sha256": digest(metadata),
            "rows": {name: len(rows) for name, rows in tables.items()},
            "files": soil_region._members(root, {"capture.json"})}
        atomic_json(root / "capture.json", record, immutable=True)
        return record


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--reference", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--vintage", required=True)
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args(argv)
    result = capture_reference(args.reference, args.output, vintage=args.vintage,
                               batch_size=args.batch_size, resume=args.resume)
    print(json.dumps(result, ensure_ascii=False, sort_keys=True))


if __name__ == "__main__":
    main()
