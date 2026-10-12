#!/usr/bin/env python3
"""Build and receive complete Comic Relief inputs through the original IATI/360Giving workspaces."""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile

OPERATION = "scf-grant-portfolio-comic-relief-9b23-20261012"
SCHEMA = "stellar-forge.comic-relief-native-inputs.v1"
ENGINE_LEAVES = {
    "iati/iati_workspace.py": "3efaded28463c0ec23d34de09401b6ec146164ec",
    "ndjson/360giving/publisher.py": "822efca45b456ed3589699b3350b9890c83ca3a4",
    "ndjson/360giving/operator/publisher_workspace.py": "e6e1113e553680058501a1208911f5396e1ff9cf",
}

def need(value, message):
    if not value:
        raise ValueError(message)

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode()

def read(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))

def identity(path):
    path = Path(path)
    need(path.is_file() and not path.is_symlink(), "Use the original regular input file: " + str(path))
    h = hashlib.sha256()
    with path.open("rb") as inp:
        for block in iter(lambda: inp.read(1048576), b""):
            h.update(block)
    return {"path": str(path.resolve()), "bytes": path.stat().st_size, "sha256": h.hexdigest()}

def publish(path, data):
    path = Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    if path.exists():
        need(path.read_bytes() == data, "Existing complete native output differs: " + str(path))
        return
    fd, temporary = tempfile.mkstemp(prefix=".completed-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as out:
            out.write(data); out.flush(); os.fsync(out.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            need(path.read_bytes() == data, "Concurrent complete native output differs")
    finally:
        Path(temporary).unlink(missing_ok=True)

def copy_original(source, target):
    source, target = Path(source), Path(target)
    expected = identity(source)
    if target.exists():
        actual = identity(target)
        need(actual["sha256"] == expected["sha256"] and actual["bytes"] == expected["bytes"], "The completed handoff bytes changed")
        return actual
    fd, pending = tempfile.mkstemp(prefix=".handoff-", dir=target.parent)
    try:
        with source.open("rb") as inp, os.fdopen(fd, "wb") as out:
            shutil.copyfileobj(inp, out, 1048576)
            out.flush(); os.fsync(out.fileno())
        need(identity(pending)["sha256"] == expected["sha256"], "The original handoff changed while receiving")
        try:
            os.link(pending, target)
        except FileExistsError:
            need(identity(target)["sha256"] == expected["sha256"], "A concurrent handoff differs")
    finally:
        Path(pending).unlink(missing_ok=True)
    return identity(target)

def original_classes(sdk):
    for path, blob in ENGINE_LEAVES.items():
        data = (sdk / path).read_bytes()
        actual = hashlib.sha1(b"blob " + str(len(data)).encode() + b"\0" + data).hexdigest()
        need(actual == blob, "Select the reviewed original native engine leaf: " + path)
    sys.path.insert(0, str(sdk / "xml"))
    sys.path.insert(0, str(sdk / "iati"))
    from iati_workspace import IatiWorkspace
    spec = importlib.util.spec_from_file_location(
        "comic_relief_original_giving_workspace", sdk / "ndjson/360giving/operator/publisher_workspace.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return IatiWorkspace, module.PublisherWorkspace

def original_action(workspace, request_id, action, value):
    workspace.admit(request_id, action, value)
    record = workspace.execute(request_id)
    need(record["status"] == "complete", "Continue the saved original native request")
    return record["result"]

def full_query(query, expected_rows):
    params = {"limit": "25"}
    fields, rows, seen = None, [], set()
    while True:
        result = query(params)
        need(result["response"]["status"] == 200, "The original native query did not return its complete page")
        body = result["response"]["body"]
        if fields is None:
            fields = body["fields"]
        need(body["fields"] == fields, "The original native query fields changed during pagination")
        rows.extend(body["rows"])
        cursor = body["page"].get("nextCursor")
        if not cursor:
            break
        need(cursor not in seen, "The original native query repeated its cursor")
        seen.add(cursor)
        params = {"limit": "25", "cursor": cursor}
    need(len(rows) == expected_rows, "The complete native query differs from the saved build")
    return {"fields": fields, "rows": rows, "rowCount": len(rows)}

def run(args):
    sdk = Path(args.sdk).resolve(strict=True)
    prepared_path = Path(args.prepared).resolve(strict=True)
    prepared = read(prepared_path)
    need(prepared["schema"] == "stellar-forge.comic-relief-inputs.v1" and prepared["operationId"] == OPERATION,
         "Select this original Comic Relief preparation")
    root = Path(args.output).resolve()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    binding = {"schema": SCHEMA, "operationId": OPERATION, "preparedSha256": identity(prepared_path)["sha256"],
               "engineLeaves": ENGINE_LEAVES}
    publish(root / "native-input-binding.json", encoded(binding))
    output = root / "native-inputs.json"
    if output.exists():
        result = read(output)
        need(result["binding"] == binding, "The native inputs belong to another original preparation")
        for entry in result["sources"]:
            expected = entry["handoff"]
            actual = identity(expected["path"])
            need(actual["bytes"] == expected["bytes"] and actual["sha256"] == expected["sha256"], "The completed native handoff changed")
        print(json.dumps(result, ensure_ascii=False))
        return
    IatiWorkspace, PublisherWorkspace = original_classes(sdk)
    need(os.environ.get("SF30_XML_NODE") or shutil.which("node"), "Use the installed original Node engine")
    sources = prepared["sources"]
    iati_source = next(source for source in sources if source["kind"] == "iati")
    giving_sources = [source for source in sources if source["kind"] == "360giving"]
    need(len(giving_sources) == 2 and len(sources) == 3, "Retain both complete international funds and the IATI source")
    for source in sources:
        for role in ("source", "registry", "capture", "transport"):
            if role in source:
                actual, expected = identity(source[role]["path"]), source[role]
                need(actual["sha256"] == expected["sha256"] and actual["bytes"] == expected["bytes"], "Prepared original input changed")
    results = []
    native_path = root / "iati-workspace"
    with IatiWorkspace(native_path, create=not native_path.exists()) as workspace:
        with Path(iati_source["source"]["path"]).open("rb") as stream:
            original = workspace.add_source(stream, iati_source["label"], Path(iati_source["source"]["path"]).name)
        need(original["id"] == iati_source["source"]["sha256"], "The original IATI source ID differs")
        profile = workspace.profile(original["id"])
        publish(root / "iati-source-profile.json", encoded(profile))
        portfolio = workspace.save_portfolio({
            "requestId":"comic-relief-original-iati-portfolio-20261012",
            "name":"Comic Relief jointly FCDO-funded programmes",
            "notes":json.dumps({"coverage":prepared["coverage"],"sourceUrl":iati_source["sourceUrl"],
                                "sourceSha256":original["id"],"originalXmlInventory":iati_source["inventory"]},ensure_ascii=False),
            "sources":[original["id"]], "selection":{},
            "review":{"status":"draft","reviewer":"","note":"The full original publisher source is selected. Cross-standard organisation and activity links are reviewed in the grant portfolio."}})
        handoff = root / "comic-relief-iati-complete.zip"
        workspace.export_portfolio(portfolio["id"], handoff, portfolio["revision"])
        for edition in portfolio["editions"]:
            for collection in ("activities","transactions","budgets"):
                build = edition[collection]
                page = full_query(lambda query, build_id=build["id"]:workspace.query(build_id,query), build["rowCount"])
                publish(root / ("iati-"+collection+"-native-rows.json"), encoded(page))
        results.append({"kind":"iati","key":iati_source["key"],"sourceId":original["id"],
                        "portfolioId":portfolio["id"],"revision":portfolio["revision"],
                        "report":portfolio["report"],"handoff":identity(handoff),"workspace":str(native_path)})
    received_path = root / "iati-received"
    with IatiWorkspace(received_path, create=not received_path.exists()) as received:
        reconstructed = received.receive_portfolio(handoff)
        need(reconstructed["portfolio"]["id"] == results[-1]["portfolioId"], "IATI receiving selected another portfolio")
        publish(root / "iati-receiving.json", encoded(reconstructed))
    with IatiWorkspace(received_path) as received:
        reopened = received.portfolio(results[-1]["portfolioId"],results[-1]["revision"])
        need(reopened["report"] == results[-1]["report"], "The original IATI report changed after cold reopening")
    giving_path = root / "360giving-workspace"
    with PublisherWorkspace(giving_path, create=not giving_path.exists()) as workspace:
        for source in giving_sources:
            request_prefix = source["key"]
            uploaded = {}
            for role in ("source","registry","capture","transport"):
                with Path(source[role]["path"]).open("rb") as stream:
                    uploaded[role] = workspace.upload(stream)["id"]
            edition = original_action(workspace,request_prefix+"-intake","intake",
                {"dataset":source["key"],"label":source["label"],"sourceUrl":source["sourceUrl"],**uploaded})
            review = workspace.review(edition["id"])
            # Retain the complete original review and template. No suggested correction
            # or item-level conclusion is silently accepted in source preparation.
            directory = root / source["key"]
            directory.mkdir(mode=0o700,exist_ok=True)
            copy_original(giving_path / "editions" / edition["id"] / "publisher/report.json", directory / "original-review.json")
            copy_original(giving_path / "editions" / edition["id"] / "publisher/decisions-template.json", directory / "decisions-template.json")
            need(edition["nativeInputReady"], "Inspect the retained complete original schema findings for " + source["key"])
            build = original_action(workspace,request_prefix+"-build","build",{"edition":edition["id"]})
            rows = full_query(lambda query:workspace.query(source["key"],build["build"]["id"],query),build["build"]["rowCount"])
            publish(directory / "native-rows.json",encoded(rows))
            export_id = request_prefix+"-export"
            original_action(workspace,export_id,"export",{"edition":edition["id"]})
            handoff_path = giving_path / "deliveries" / export_id / "360giving-complete-handoff.zip"
            handoff = copy_original(handoff_path, root / (source["key"]+"-complete.zip"))
            results.append({"kind":"360giving","key":source["key"],"registryId":source["registryId"],
                "sourceSha256":edition["sourceSha256"],"editionId":edition["id"],
                "builds":{"original":build["build"]["id"]},"grantCount":edition["grantCount"],
                "handoff":handoff,"workspace":str(giving_path),"sourceRequest":export_id})
    receiving_path = root / "360giving-received"
    with PublisherWorkspace(receiving_path,create=not receiving_path.exists()) as received:
        for source in results:
            if source["kind"] != "360giving":
                continue
            with Path(source["handoff"]["path"]).open("rb") as stream:
                archive = received.upload(stream)
            result = original_action(received,source["key"]+"-receive","receive",{"object":archive["id"]})
            need(result["editionId"] == source["editionId"] and result["archiveSha256"] == source["handoff"]["sha256"],
                 "360Giving receiving selected another complete edition")
            publish(root / (source["key"]+"-receiving.json"), encoded(result))
    with PublisherWorkspace(receiving_path) as received:
        for source in results:
            if source["kind"] != "360giving":
                continue
            review = received.review(source["editionId"])
            need(review["edition"]["sourceSha256"] == source["sourceSha256"], "The original publisher source changed on cold reopening")
            rows = full_query(lambda query:received.query(source["key"],source["builds"]["original"],query),source["grantCount"])
            saved = read(root / source["key"] / "native-rows.json")
            need(rows == saved, "Complete cold-received native rows differ from the original edition")
    result = {"schema":SCHEMA,"binding":binding,"operationId":OPERATION,
              "coverage":prepared["coverage"],"sources":results,"nativeReceiving":"complete",
              "received":{"iati":str(received_path),"360giving":str(receiving_path)}}
    publish(output,encoded(result))
    print(json.dumps(result,ensure_ascii=False))

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk",required=True)
    parser.add_argument("--prepared",required=True)
    parser.add_argument("--output",required=True)
    args = parser.parse_args()
    run(args)

if __name__ == "__main__":
    main()
