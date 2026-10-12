#!/usr/bin/env python3
"""Prepare full original Comic Relief spreadsheets with the official 360Giving converter."""
from __future__ import annotations
import argparse
import datetime as dt
from decimal import Decimal
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

OPERATION = "scf-grant-portfolio-comic-relief-9b23-20261012"
FORMAT = "stellar-forge.comic-relief-inputs.v1"
FUND_SOURCES = (
    ("international-2015-2022", "a002400000WUhUuAAL",
     "comic-relief-international-2015-2022-original.xlsx",
     "https://docs.google.com/spreadsheets/d/1D9mrF9RZ-CzL09PKAnLFcv8vbaZmfO_LKcLwlNQaWN8/export?format=xlsx"),
    ("international-2022-2026", "a00P400000OMLeUIAX",
     "comic-relief-international-2022-2026-original.xlsx",
     "https://docs.google.com/spreadsheets/d/1mTGkno76vcgUx9SrYmZA41f495IsFbaw/export?format=xlsx"),
)
VERSIONS = {"flattentool": "0.28.0", "libcove": "0.31.0", "jsonref": "1.1.0", "openpyxl": "3.1.5", "jsonschema": "3.2.0"}
OFFICIAL = {
    "datagetter": {"repository": "ThreeSixtyGiving/datagetter", "path": "getter/get.py",
                  "gitBlob": "3d3356d32ce8e23cc12a7de53c96420d78678e42"},
    "converter": {"repository": "OpenDataServices/lib-cove", "ref": "v0.31.0",
                  "path": "libcove/lib/converters.py", "gitBlob": "df302d9d4b91c7d280db5ef701710693aaf0b94b"},
    "settings": {"repository": "ThreeSixtyGiving/dataquality",
                 "path": "lib360dataquality/cove/settings.py", "gitBlob": "7baf73e7d87c8146ea2b86724fdd30a58df90fca"},
    "flattentool": {"repository": "OpenDataServices/flatten-tool", "ref": "v0.28.0",
                    "path": "flattentool/__init__.py", "gitBlob": "e2930143c6f90f192b9defbaabad5746cf74a11b"},
}
COVERAGE = {
    "publisher": "Comic Relief", "organisationId": "GB-CHC-326568", "iatiPublisher": "cprojects",
    "givingPublisher": "360G-CR", "attribution": "Comic Relief, CC BY 4.0",
    "licence": "https://creativecommons.org/licenses/by/4.0/",
    "sourceUrl": "https://www.comicrelief.com/your-impact/transparency/",
    "iati": "Funding through programmes jointly funded with the UK Foreign, Commonwealth and Development Office.",
    "giving": "The two complete selected International 2015–2022 and 2022–2026 publisher editions.",
    "publisherGivingScope": "Comic Relief publishes UK and international funding committed since 1 January 2015.",
    "comparison": "A different coverage cohort is not evidence of an omitted grant, duplicate payment or inconsistent finance.",
}
COVE_CONFIG = {
    "root_list_path": "grants", "root_id": "", "convert_titles": True, "hashcomments": True,
    "flatten_tool": {"disable_local_refs": False, "remove_empty_schema_columns": True, "xml_comment": None},
}

def need(value, message):
    if not value:
        raise ValueError(message)

def bytes_at(path):
    path = Path(path)
    need(path.is_file() and not path.is_symlink(), "Use a regular retained file: " + str(path))
    need(path.stat().st_size <= 256 * 1024 * 1024, "Input exceeds the original profile limit")
    return path.read_bytes()

def sha(data):
    return hashlib.sha256(data).hexdigest()

def git_blob(data):
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\0" + data).hexdigest()

def info(path):
    path = Path(path)
    data = bytes_at(path)
    return {"path": str(path.resolve()), "name": path.name, "bytes": len(data), "sha256": sha(data)}

def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode("utf-8")

def publish(path, data):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.exists():
        need(bytes_at(path) == data, "An original completed output differs: " + str(path))
        return
    fd, pending = tempfile.mkstemp(prefix=".original-complete-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data)
            out.flush()
            os.fsync(out.fileno())
        try:
            os.link(pending, path)
        except FileExistsError:
            need(bytes_at(path) == data, "A concurrent original output differs: " + str(path))
        if os.name == "posix":
            directory = os.open(path.parent, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
            try:
                os.fsync(directory)
            finally:
                os.close(directory)
    finally:
        Path(pending).unlink(missing_ok=True)

def read_json(path):
    return json.loads(bytes_at(path).decode("utf-8-sig"))

def read_package(path):
    def pairs(items):
        out = {}
        for key, value in items:
            need(key not in out, "Duplicate JSON member: " + key)
            out[key] = value
        return out
    def reject(value):
        raise ValueError("Non-finite JSON value: " + value)
    value = json.loads(bytes_at(path).decode("utf-8-sig"), parse_float=Decimal,
                       parse_int=Decimal, object_pairs_hook=pairs, parse_constant=reject)
    need(isinstance(value, dict) and isinstance(value.get("grants"), list), "The complete converted package must contain grants")
    return value

def source_schema_records(root):
    root = Path(root)
    index = read_json(root / "schema-sources.json")
    output = []
    for row in index["schemas"]:
        path = root / row["file"]
        data = bytes_at(path)
        need(git_blob(data) == row["gitBlob"], "Original official schema changed: " + row["file"])
        output.append({**row, "bytes": len(data), "sha256": sha(data)})
    return output

def convert_one(args):
    import jsonref
    import flattentool
    from libcove.config import LibCoveConfig
    from libcove.lib import converters
    versions = {name: importlib.metadata.version(name) for name in VERSIONS}
    need(versions == VERSIONS, "Use the selected official converter versions: " + json.dumps(VERSIONS))
    need(git_blob(bytes_at(converters.__file__)) == OFFICIAL["converter"]["gitBlob"],
         "The installed official converter source differs from the selected edition")
    need(git_blob(bytes_at(flattentool.__file__)) == OFFICIAL["flattentool"]["gitBlob"],
         "The installed official flattentool source differs from the selected edition")
    schema_root = Path(args.schemas).resolve(strict=True)
    schema_records = source_schema_records(schema_root)
    documents = {}
    for row in schema_records:
        document = read_json(schema_root / row["file"])
        for url in [row["url"], document.get("$id"), *row.get("aliases", [])]:
            if url:
                documents[url] = document
    def loader(uri, **_):
        need(uri in documents, "The original schema closure has no retained reference: " + uri)
        return documents[uri]
    def resolve(role):
        row = next(row for row in schema_records if row["role"] == role)
        # Pass resolved original documents through the converter's supported schema argument.
        # No schema bytes or reference targets are changed.
        return jsonref.loads(bytes_at(schema_root / row["file"]).decode("utf-8"),
                             loader=loader, base_uri=row["url"])
    original = Path(args.file).resolve(strict=True)
    target = Path(args.output).resolve()
    original_info = info(original)
    binding = {"originalSha256": original_info["sha256"], "versions": versions,
               "schemas": schema_records, "settings": COVE_CONFIG, "official": OFFICIAL}
    identity = sha(json_bytes(binding))
    target.mkdir(mode=0o700, parents=True, exist_ok=True)
    closure = target / "conversion.json"
    if closure.exists():
        result = read_json(closure)
        need(result["identity"] == identity, "This conversion belongs to another source or converter")
        for item in result["files"]:
            need(info(target / item["name"])["sha256"] == item["sha256"], "A complete conversion output changed")
        print(json.dumps(result, ensure_ascii=False))
        return
    cfg = LibCoveConfig()
    cfg.config.update(COVE_CONFIG)
    # Use a fresh original conversion directory so an interrupted library cache
    # cannot substitute a partial JSON or cell-source map on resume.
    with tempfile.TemporaryDirectory(prefix=".conversion-", dir=target) as pending:
        context = converters.convert_spreadsheet(
            pending, "null", str(original), "xlsx", cfg,
            resolve("current-grant"), resolve("package"), replace=True)
        package = read_package(context["converted_path"])
        need(not package.get("extensions"), "This publisher edition declares extensions; retain and resolve their original schema closure before conversion")
        payloads = {
            "package.json": bytes_at(context["converted_path"]),
            "cell_source_map.json": bytes_at(Path(pending) / "cell_source_map.json"),
            "heading_source_map.json": bytes_at(Path(pending) / "heading_source_map.json"),
            "conversion-warnings.json": json_bytes(context.get("conversion_warning_messages", [])),
        }
        for name, data in payloads.items():
            publish(target / name, data)
    # The full original transport travels with each completed native publisher edition.
    result = {"schema": FORMAT + ".conversion", "identity": identity, "binding": binding,
              "grantCount": len(package["grants"]),
              "files": [{"name": name, "bytes": len(data), "sha256": sha(data)} for name, data in sorted(payloads.items())]}
    publish(closure, json_bytes(result))
    print(json.dumps(result, ensure_ascii=False))

def semantic(value):
    if isinstance(value, Decimal):
        return ("number", value)
    if value is None or isinstance(value, (bool, str)):
        return (type(value).__name__, value)
    if isinstance(value, list):
        return ("array", tuple(semantic(item) for item in value))
    if isinstance(value, dict):
        return ("object", tuple((key, semantic(value[key])) for key in sorted(value)))
    raise TypeError(type(value).__name__)

def reported(value):
    if isinstance(value, Decimal):
        return {"type": "number", "value": str(value)}
    if isinstance(value, list):
        return [reported(item) for item in value]
    if isinstance(value, dict):
        return {key: reported(item) for key, item in value.items()}
    return value

def semantic_comparison(before_file, after_file):
    before, after = read_package(before_file), read_package(after_file)
    def index(package):
        values = {}
        for ordinal, grant in enumerate(package["grants"]):
            need(isinstance(grant, dict) and isinstance(grant.get("id"), str) and grant["id"], "Complete grant ID is required for edition comparison")
            need(grant["id"] not in values, "The original edition has a duplicate grant ID: " + grant["id"])
            values[grant["id"]] = (ordinal, grant)
        return values
    left, right = index(before), index(after)
    changes = []
    def compare(a, b, path, ident):
        if semantic(a) == semantic(b):
            return
        if isinstance(a, dict) and isinstance(b, dict):
            for key in sorted(set(a) | set(b)):
                pointer = path + "/" + key.replace("~", "~0").replace("/", "~1")
                if key not in a:
                    changes.append({"id": ident, "path": pointer, "kind": "added-field", "after": reported(b[key])})
                elif key not in b:
                    changes.append({"id": ident, "path": pointer, "kind": "removed-field", "before": reported(a[key])})
                else:
                    compare(a[key], b[key], pointer, ident)
        else:
            changes.append({"id": ident, "path": path, "kind": "changed", "before": reported(a), "after": reported(b)})
    for ident in sorted(set(left) | set(right)):
        if ident not in left:
            changes.append({"id": ident, "kind": "added-grant", "after": reported(right[ident][1])})
        elif ident not in right:
            changes.append({"id": ident, "kind": "removed-grant", "before": reported(left[ident][1])})
        else:
            compare(left[ident][1], right[ident][1], "", ident)
    return {"schema": FORMAT + ".semantic-comparison", "before": info(before_file), "after": info(after_file),
            "beforeGrants": len(left), "afterGrants": len(right), "sameGrantValues": not changes,
            "orderChanged": [grant["id"] for grant in before["grants"]] != [grant["id"] for grant in after["grants"]],
            "packageMetadataEqual": semantic({k:v for k,v in before.items() if k!="grants"}) == semantic({k:v for k,v in after.items() if k!="grants"}),
            "changes": changes, "comparisonMeaning": "Object key order and decimal spelling are ignored for value comparison; original JSON and XLSX bytes remain unchanged and separately identified."}

def prepare(args):
    inputs = Path(args.inputs).resolve(strict=True)
    sdk = Path(args.sdk).resolve(strict=True)
    output = Path(args.output).resolve()
    output.mkdir(mode=0o700, parents=True, exist_ok=True)
    native_schemas = sdk / "ndjson/360giving/schemas"
    originals = read_json(inputs / "original-file-identities.json")
    need(originals["operationId"] == OPERATION, "Select this operation's retained complete originals")
    for item in originals["files"]:
        actual = info(inputs / item["name"])
        need(actual["bytes"] == item["bytes"] and actual["sha256"] == item["sha256"], "Original retained file changed: " + item["name"])
    origin_info = {item["name"]: item for item in originals["files"]}
    common = {"coverage": COVERAGE, "originalRegistry": info(inputs / "360giving-original-registry-20261012.json"),
              "publisherMetadata": info(inputs / "comic-relief-360giving-original-publisher-metadata.json")}
    publisher_metadata = read_json(inputs / "comic-relief-360giving-original-publisher-metadata.json")
    selected_registry = originals["registry"]["selected"]
    # The maintained publisher uses PYTHONPATH for its jsonschema 4.x closure.
    # The official converter retains its separate jsonschema 3.2.0 environment.
    converter_env = dict(os.environ)
    converter_env.pop("PYTHONPATH", None)
    converter_env["PYTHONNOUSERSITE"] = "1"
    result = {"schema": FORMAT, "operationId": OPERATION, "coverage": COVERAGE,
              "originalsManifest": info(inputs / "original-file-identities.json"), "sources": [], "metadata": common}
    for key, registry_id, filename, source_url in FUND_SOURCES:
        target = output / key
        command = [args.converter_python, "-B", str(Path(__file__).resolve()), "convert-one",
                   "--file", str(inputs / filename), "--schemas", str(native_schemas), "--output", str(target)]
        subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=sys.stderr, env=converter_env)
        conversion = read_json(target / "conversion.json")
        registry = inputs / (registry_id + "-registry.json")
        original_record = read_json(registry)
        retained_registry = [item for item in selected_registry if item["id"] == registry_id]
        need(len(retained_registry) == 1, "Select the one retained registry record")
        actual_registry = info(registry)
        need(all(actual_registry[field] == retained_registry[0][field] for field in ("bytes", "sha256")),
             "The complete selected registry record changed")
        locator = retained_registry[0].get("locatorPath", retained_registry[0].get("jsonPath", []))
        need(any(str(original_record.get(name,"")) == registry_id for name in ("id","identifier","name"))
             or (locator and locator[-1] == registry_id), "Selected original registry identity differs")
        metadata = [item for item in publisher_metadata["files"] if item["id"] == registry_id]
        need(len(metadata) == 1, "Select one original publisher metadata record")
        capture = {
            "schema": FORMAT + ".capture", "operationId": OPERATION, "sourceUrl": source_url,
            "registryId": registry_id, "original": {k:v for k,v in origin_info[filename].items() if k not in {"path", "reference"}},
            "registry": {k:v for k,v in info(registry).items() if k != "path"},
            "publisherMetadata": metadata[0], "coverage": COVERAGE,
            "conversion": conversion, "converted": {k:v for k,v in info(target / "package.json").items() if k != "path"},
        }
        publish(target / "capture.json", json_bytes(capture))
        source = {"kind":"360giving", "key":"comic-relief-"+key, "label":"Comic Relief International "+key.rsplit("-",2)[-2]+"–"+key.rsplit("-",1)[-1],
                  "registryId":registry_id, "sourceUrl":source_url, "source":info(target/"package.json"),
                  "registry":info(registry), "capture":info(target/"capture.json"),
                  "transport":info(inputs/filename), "conversion":info(target/"conversion.json"),
                  "grantCount":conversion["grantCount"]}
        result["sources"].append(source)
    xml = inputs / "comic-relief-cprojects-grants-original.xml"
    result["sources"].insert(0, {"kind":"iati", "key":"comic-relief-cprojects", "label":"Comic Relief jointly FCDO-funded programmes",
        "sourceUrl":"https://assets.ctfassets.net/zsfivwzfgl3t/3skHdjqaAyEIqNxBpQu9Jo/a659e1990757d50174979ab49959e739/unflattened_202408.xml",
        "source":info(xml), "inventory":originals["iati"], "coverage":COVERAGE["iati"]})
    if args.historical_2015:
        historical = Path(args.historical_2015).resolve(strict=True)
        comparison_dir = output / "historical-2015-publisher-capture"
        subprocess.run([args.converter_python,"-B",str(Path(__file__).resolve()),"convert-one",
                        "--file",str(historical),"--schemas",str(native_schemas),"--output",str(comparison_dir)],
                       check=True, stdout=subprocess.PIPE, stderr=sys.stderr)
        comparison = semantic_comparison(comparison_dir/"package.json", output/"international-2015-2022/package.json")
        comparison["originalBefore"] = info(historical)
        comparison["originalAfter"] = info(inputs/FUND_SOURCES[0][2])
        publish(output/"2015-semantic-comparison.json",json_bytes(comparison))
        result["historicalComparison"] = info(output/"2015-semantic-comparison.json")
    publish(output / "prepared-inputs.json", json_bytes(result))
    print(json.dumps(result, ensure_ascii=False))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="action", required=True)
    one = commands.add_parser("convert-one")
    one.add_argument("--file", required=True)
    one.add_argument("--schemas", required=True)
    one.add_argument("--output", required=True)
    operation = commands.add_parser("prepare")
    operation.add_argument("--sdk", required=True)
    operation.add_argument("--inputs", required=True)
    operation.add_argument("--output", required=True)
    operation.add_argument("--converter-python", required=True)
    operation.add_argument("--historical-2015")
    args = parser.parse_args()
    if args.action == "convert-one":
        convert_one(args)
    else:
        prepare(args)

if __name__ == "__main__":
    main()
