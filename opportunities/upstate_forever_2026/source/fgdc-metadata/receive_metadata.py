#!/usr/bin/env python3
"""Validate retained delivery XML and its exact writer with the official XSD and DTD."""
from __future__ import annotations

import argparse
import ast
import hashlib
import importlib.util
import io
import json
import math
from pathlib import Path
import sys
from types import SimpleNamespace
import urllib.request
import xml.etree.ElementTree as ET

SCHEMA_URL = "https://www.fgdc.gov/schemas/metadata/"
DTD_PATH = "source/fgdc/fgdc-std-001-1998.dtd"
DTD_SHA256 = "778584c89cf0f61a382900cfab7fb7171ae99894b9b54702540ca28cb4267598"
SCHEMAS = ["fgdc-std-001-1998.xsd"] + [
    "fgdc-std-001-1998-sect%02d.xsd" % value for value in range(1, 11)]


def sha(body):
    return hashlib.sha256(body).hexdigest()


def receive_schema(directory):
    directory.mkdir(parents=True, exist_ok=True)
    for name in SCHEMAS:
        path = directory / name
        if path.exists():
            continue
        with urllib.request.urlopen(SCHEMA_URL + name, timeout=30) as response:
            body = response.read(1024 * 1024)
        root = ET.fromstring(body)
        if root.tag != "{http://www.w3.org/2001/XMLSchema}schema":
            raise ValueError("The official schema response is not an XSD: " + name)
        with path.open("xb") as stream:
            stream.write(body)


def definitions(source, names, namespace):
    tree = ast.parse(source)
    selected = [node for node in tree.body
                if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name in names]
    if {node.name for node in selected} != set(names):
        raise ValueError("The selected source does not contain the original writer functions")
    exec(compile(ast.Module(body=selected, type_ignores=[]), "<retained-production-functions>", "exec"),
         namespace)


def writer_examples(application, output, validator):
    # These controlled metadata descriptors are validator inputs, not model results.
    helper_path = application / "model/fgdc_metadata.py"
    spec = importlib.util.spec_from_file_location("_retained_fgdc_metadata", helper_path)
    helper = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(helper)
    versions_source = (application / "model/native_versions.py").read_text(encoding="utf-8")
    version_namespace = {}
    definitions(versions_source, ("_text", "version_label"), version_namespace)
    delivery_source = (application / "model/delivery.py").read_text(encoding="utf-8")
    namespace = {
        "math": math, "json": json, "ET": ET, "Path": Path,
        "fgdc_metadata": helper,
        "native_versions": SimpleNamespace(version_label=version_namespace["version_label"]),
        "now": lambda: "2026-10-13T08:00:00+00:00",
        "atomic_bytes": lambda path, body: Path(path).write_bytes(body),
    }
    definitions(delivery_source, ("_grid_measurements", "_fgdc"), namespace)
    output.mkdir(parents=True, exist_ok=False)
    contact = {"organization": "Retained metadata exercise", "email": "metadata@example.invalid"}
    complete_contact = {"name": "Metadata fixture", "organization": "Retained metadata exercise",
                        "address": {"type": "mailing", "lines": ["Example address"],
                                    "city": "Example city", "state": "SC", "postal_code": "00000"},
                        "phone": "Example telephone", "email": "metadata@example.invalid"}
    sources = [
        {"id": "LULC", "title": "Controlled annual source", "vintage": "Annual class edition 2025",
         "uri": "https://example.invalid/source", "sha256": "a" * 64,
         "source_metadata": {"kind": "raster", "originators": ["Original source organization"],
                             "publisher": "Original publisher", "publication_date": "2026-02-03",
                             "observation_period": {"start": "2025-01-01", "end": "2025-12-31"}}},
        {"id": "LS_FACTOR", "title": "Controlled derived LS factor", "vintage": "InVEST 3.20.0; DEM edition 2022",
         "uri": "https://example.invalid/model-guide", "sha256": "b" * 64,
         "derivation": "Original native terrain calculation"},
        {"id": "REFERENCE", "title": "Controlled source with explicit content day", "vintage": "original edition",
         "uri": "urn:retained:reference", "sha256": "c" * 64,
         "source_metadata": {"originator": "Retained source origin", "publication_date": "2024-02",
                             "content_date": "2023-06-07", "source_media": "digital data"}},
    ]
    original_sources = json.dumps(sources, sort_keys=True)
    selected = {"title": "FGDC writer standards exercise", "baseline_run_id": "d" * 64,
                "contact": contact}
    model = {"model": "ndr", "comparison_version": "3.20.0",
             "basis": "completed_stage_runtime", "requested_version": "3.19.0",
             "stage_completed_at": "2026-10-10T14:25:26+00:00"}
    native = {"path": "native-execution.json", "sha256": "e" * 64, "bytes": 1}
    rows = []
    for epsg, bounds in ((26917, [400000, 3800000, 400600, 3800600]),
                         (5070, [1200000, 1500000, 1200600, 1500600]),
                         (32717, [400000, 8000000, 400600, 8000600]),
                         (3857, [-9100000, 4100000, -9099400, 4100600])):
        grid = {"id": "f" * 64, "grid": {"crs": "EPSG:" + str(epsg),
                "transform": [30, 0, bounds[0], 0, -30, bounds[3]],
                "bounds": bounds, "width": 20, "height": 20}}
        for kind in ("baseline", "scenario_difference", "priority"):
            name = str(epsg) + "-" + kind
            path = output / (name + ".xml")
            item = {"path": name + ".tif", "sha256": "1" * 64, "bytes": 1,
                    "native_units": "kg/ha/year", "units": "kg/year", "pixel_area_ha": 0.09,
                    "valid_cells": 400, "sum": 12.0, "sum_units": "kg/year"}
            unit = "dimensionless (0-1)" if kind == "priority" else "kg/year"
            dataset = None if kind == "baseline" else {
                "id": name, "kind": kind, "source_raster": "retained/" + name + ".tif",
                "file": {"path": "gis/datasets/" + name + ".tif", **{k: item[k] for k in ("sha256", "bytes")}},
                "source_file": item, "grid_id": grid["id"], "profile_id": "2" * 64,
                "native_execution": native, "comparison_id": "3" * 64,
                "runs": [{"id": selected["baseline_run_id"], "native_models": {"ndr": model}}],
                "grid": {"nodata": -9999}, "signed": kind == "scenario_difference",
                "support": "Original reporting pixels with retained valid support.",
                "derivation": {"method": kind, "normalization": "original selected method"},
            }
            namespace["_fgdc"](path, name, item, unit=unit, grid=grid, sources=sources,
                               selection=selected, profile={"id": "2" * 64},
                               contact=contact if kind != "scenario_difference" else complete_contact,
                               native_model=model, native_execution=native, dataset=dataset)
            tree = validator(path)
            value = lambda route: tree.findtext(route)
            assert value("dataqual/lineage/srcinfo/srccite/citeinfo/pubdate") == "20260203"
            assert value("dataqual/lineage/srcinfo/srctime/timeinfo/rngdates/begdate") == "20250101"
            assert value("dataqual/lineage/srcinfo[2]/srccite/citeinfo/pubdate") == "Unknown"
            assert value("dataqual/lineage/srcinfo[2]/srctime/timeinfo/sngdate/caldate") == "Unknown"
            assert value("dataqual/lineage/srcinfo[3]/srccite/citeinfo/pubdate") == "202402"
            assert value("dataqual/lineage/srcinfo[3]/srctime/timeinfo/sngdate/caldate") == "20230607"
            assert value("distinfo/stdorder/fees") == "Unknown"
            assert value("metainfo/metd") == "20261013"
            steps = tree.findall("dataqual/lineage/procstep")
            if kind == "baseline":
                assert [node.findtext("procdate") for node in steps] == ["20261010", "Unknown", "20261013"]
                assert value("distinfo/stdorder/digform/digtopt/onlinopt/computer/networka/networkr") == name + ".tif"
            else:
                assert [node.findtext("procdate") for node in steps] == ["Unknown", "20261013"]
                assert "Per-hectare rates converted" not in steps[0].findtext("procdesc")
                assert value("distinfo/stdorder/digform/digtopt/onlinopt/computer/networka/networkr") == "../../" + dataset["file"]["path"]
            if epsg in (26917, 32717):
                assert value("spref/horizsys/planar/gridsys/utm/utmzone") == ("-17" if epsg == 32717 else "17")
            elif epsg == 5070:
                assert [x.tag for x in tree.find("spref/horizsys/planar/mapproj/albers")] == [
                    "stdparll", "stdparll", "longcm", "latprjo", "feast", "fnorth"]
            else:
                assert value("spref/horizsys/planar/gridsys/othergrd")
            if kind == "scenario_difference":
                assert value("metainfo/metc/cntinfo/cntperp/cntper") == complete_contact["name"]
                assert value("distinfo/distrib/cntinfo/cntaddr/postal") == "00000"
            else:
                assert value("metainfo/metc/cntinfo/cntorgp/cntorg") == contact["organization"]
                assert value("metainfo/metc/cntinfo/cntvoice") == "Unknown"
            rows.append({"path": str(path), "sha256": sha(path.read_bytes()), "bytes": path.stat().st_size,
                         "kind": kind, "crs": grid["grid"]["crs"]})
    assert json.dumps(sources, sort_keys=True) == original_sources
    for raw, expected in (("version 3.20.0", "Unknown"), ("2025-02-30", "Unknown"),
                          ("2024-02-29", "20240229"), ("2024", "2024")):
        assert helper.calendar_date(raw) == expected
    return {"fixture": "controlled metadata only; no physical simulation or scientific output",
            "writer_source_sha256": sha(delivery_source.encode()),
            "helper_source_sha256": sha(helper_path.read_bytes()), "xml": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path, required=True)
    parser.add_argument("--schema-directory", type=Path, required=True)
    parser.add_argument("--download-schema", action="store_true")
    parser.add_argument("--exercise-output", type=Path)
    parser.add_argument("--delivery-directory", type=Path)
    parser.add_argument("--receipt", type=Path, required=True)
    args = parser.parse_args()
    if not args.exercise_output and not args.delivery_directory:
        parser.error("Choose the writer exercise and/or one original delivery directory")
    if args.download_schema:
        receive_schema(args.schema_directory)
    # Bind both an offline and a freshly downloaded family to the retained
    # original federal source capture; a different schema is not this receipt.
    expected_schemas = [
        {
            "name": "fgdc-std-001-1998.xsd",
            "bytes": 4752,
            "sha256": "222e77b9be8796539816f7a818edae01e55ab5657c5599005732c40be6b9e57b"
        },
        {
            "name": "fgdc-std-001-1998-sect01.xsd",
            "bytes": 9878,
            "sha256": "8b7e31c62de8415a7c657883187f6a73b7167960eaa24d108335d00226ad4454"
        },
        {
            "name": "fgdc-std-001-1998-sect02.xsd",
            "bytes": 7751,
            "sha256": "64e83b7ffc1f424b879ba7a7eb803746b14c44ca663a6f367b3893bbcea11d0e"
        },
        {
            "name": "fgdc-std-001-1998-sect03.xsd",
            "bytes": 5135,
            "sha256": "4826e84227807af5f71572591fd5613b0ae880bdf1f87e793b2072a2c0abd4d1"
        },
        {
            "name": "fgdc-std-001-1998-sect04.xsd",
            "bytes": 24168,
            "sha256": "98099256985727348638e2214b20ccf1fde1589056de303b8b4170dacc1076d9"
        },
        {
            "name": "fgdc-std-001-1998-sect05.xsd",
            "bytes": 6327,
            "sha256": "61f0213fe9a22eab69bb93e3224db5fe7cd395f41636efcdb6f27b9984aef458"
        },
        {
            "name": "fgdc-std-001-1998-sect06.xsd",
            "bytes": 9012,
            "sha256": "74276a3faefe03a489a24ce013541c829f0d3f99ad0b4de505ad2572e813f289"
        },
        {
            "name": "fgdc-std-001-1998-sect07.xsd",
            "bytes": 3275,
            "sha256": "e5b7f41ab1de3dcae3e63ead8aa665229e9cf1e6e451f5c211856e992c5ebbc9"
        },
        {
            "name": "fgdc-std-001-1998-sect08.xsd",
            "bytes": 3387,
            "sha256": "131df7dfb4621ede15b4bcb936897506b09a79c3f34877c6f03d52612fb3f5f3"
        },
        {
            "name": "fgdc-std-001-1998-sect09.xsd",
            "bytes": 2857,
            "sha256": "c6462e61fc86feff0bf8e688ad1fe59d7fb475366948010bcfcb5fc4bee91938"
        },
        {
            "name": "fgdc-std-001-1998-sect10.xsd",
            "bytes": 3700,
            "sha256": "ea6f813f809b4beced357c7c8f3ca65388d5e9e832c6bd5423b2152e97a5a781"
        }
    ]
    schema_records = []
    for record in expected_schemas:
        body = (args.schema_directory / record["name"]).read_bytes()
        if len(body) != record["bytes"] or sha(body) != record["sha256"]:
            raise ValueError("The selected official FGDC schema identity differs: " + record["name"])
        schema_records.append({"path": record["name"], "bytes": len(body), "sha256": sha(body)})
    from lxml import etree
    schema_path = args.schema_directory / SCHEMAS[0]
    parser = etree.XMLParser(no_network=True, load_dtd=False, resolve_entities=False)
    schema = etree.XMLSchema(etree.parse(str(schema_path), parser))
    dtd_body = (args.application / DTD_PATH).read_bytes()
    if sha(dtd_body) != DTD_SHA256:
        raise ValueError("Use the exact original federal FGDC DTD")
    dtd = etree.DTD(io.BytesIO(dtd_body))
    def validate(path):
        tree = etree.parse(str(path), parser)
        schema.assertValid(tree)
        dtd.assertValid(tree)
        return ET.fromstring(path.read_bytes())
    receipt = {"schema": "upstate.fgdc-metadata-receiving/v1", "state": "passed",
               "official_schema_url": SCHEMA_URL,
               "official_dtd": {"path": DTD_PATH, "bytes": len(dtd_body), "sha256": sha(dtd_body)},
               "schemas": schema_records}
    if args.exercise_output:
        receipt["writer_exercise"] = writer_examples(args.application, args.exercise_output, validate)
    if args.delivery_directory:
        directory = args.delivery_directory.resolve(strict=True)
        state = json.loads((directory / "delivery-state.json").read_text())
        checked = []
        for key, member in state["files"].items():
            if not member["path"].endswith(".xml"):
                continue
            path = (directory / member["path"]).resolve(strict=True)
            if not path.is_relative_to(directory):
                raise ValueError("The retained XML escapes its original delivery")
            body = path.read_bytes()
            if len(body) != member["bytes"] or sha(body) != member["sha256"]:
                raise ValueError("Retained metadata bytes changed: " + key)
            tree = validate(path)
            links = tree.findall("distinfo/stdorder/digform/digtopt/onlinopt/computer/networka/networkr")
            for link in links:
                target = (path.parent / link.text).resolve(strict=True)
                if not target.is_relative_to(directory):
                    raise ValueError("The XML dataset link escapes its retained delivery")
            checked.append({"key": key, **member})
        if not checked:
            raise ValueError("The selected original delivery has no retained XML metadata")
        receipt["delivery"] = {"id": state["id"], "xml": checked}
    args.receipt.parent.mkdir(parents=True, exist_ok=True)
    with args.receipt.open("x", encoding="utf-8") as stream:
        json.dump(receipt, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(json.dumps(receipt, ensure_ascii=False))


if __name__ == "__main__":
    main()
