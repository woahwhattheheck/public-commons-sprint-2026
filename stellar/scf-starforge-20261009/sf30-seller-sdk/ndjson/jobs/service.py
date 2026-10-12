"""MIT. Complete file-job handover through the original lossless NDJSON workspace."""
from __future__ import annotations
import argparse
import csv
import hashlib
import html
import json
import os
from pathlib import Path
import shutil
import sys
import zipfile

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
from application import Workspace, InputError, load_json, json_bytes, private_write, file_digest
from ndjson_source import JsonNumber, exact_json, _pairs, _constant, _validate_tree, MAX_RECORD
from workspace import regular

SCHEMA = "stellar-forge.ndjson-file-job-result.v1"
BUNDLE = "stellar-forge.ndjson-file-job-bundle.v1"
MAX_FILE = 32 * 1024 * 1024
MAX_OUTPUT = 64 * 1024 * 1024
MAX_EXPANDED = 512 * 1024 * 1024
csv.field_size_limit(4 * 1024 * 1024)


def copy_private(source: Path, destination: Path):
    with source.open("rb") as inp, os.fdopen(os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
        shutil.copyfileobj(inp, out, 1024 * 1024)
        out.flush()
        os.fsync(out.fileno())


def select_array(document, pointer):
    if not isinstance(pointer, str) or len(pointer) > 4096 or pointer and not pointer.startswith("/"):
        raise InputError("An array pointer must be an empty string or an absolute JSON Pointer")
    selected = document
    if pointer:
        for raw in pointer[1:].split("/"):
            if "~" in raw.replace("~0", "").replace("~1", ""):
                raise InputError("JSON Pointer escapes must be ~0 or ~1")
            token = raw.replace("~1", "/").replace("~0", "~")
            if isinstance(selected, dict) and token in selected:
                selected = selected[token]
            elif isinstance(selected, list) and token.isascii() and token.isdigit() and (token == "0" or not token.startswith("0")) and int(token) < len(selected):
                selected = selected[int(token)]
            else:
                raise InputError("The selected array pointer does not exist in this original package")
    if not isinstance(selected, list):
        raise InputError("The explicit package pointer must select an array")
    return selected


def normalized_source(path, format_name, pointer, destination):
    if format_name == "ndjson":
        if pointer:
            raise InputError("A JSON array pointer applies only to json-array source format")
        return path, {"format": "ndjson", "transformation": "original bytes"}
    if format_name != "json-array":
        raise InputError("Source format must be ndjson or json-array")
    regular(path, MAX_FILE)
    try:
        document = json.loads(path.read_bytes().decode("utf-8-sig"), parse_int=JsonNumber,
                              parse_float=JsonNumber, parse_constant=_constant, object_pairs_hook=_pairs)
        _validate_tree(document)
    except (UnicodeError, json.JSONDecodeError, RecursionError) as error:
        raise InputError("The package must contain complete UTF-8 JSON with valid Unicode") from error
    selected = select_array(document, pointer)
    total = 0
    with os.fdopen(os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as out:
        for ordinal, value in enumerate(selected, 1):
            if not isinstance(value, dict):
                raise InputError(f"Array item {ordinal}: expected an object")
            encoded = (exact_json(value) + "\n").encode("utf-8")
            total += len(encoded)
            if len(encoded) > MAX_RECORD:
                raise InputError(f"Array item {ordinal}: record exceeds 16 MiB")
            if total > MAX_FILE:
                raise InputError("Normalized JSON Lines exceed 32 MiB")
            out.write(encoded)
        out.flush()
        os.fsync(out.fileno())
    return destination, {"format": "json-array", "arrayPointer": pointer, "records": len(selected),
                         "transformation": "one original array object per JSON line; original numeric tokens retained",
                         "normalizedBytes": total, "normalizedSha256": file_digest(destination)}


def render_report(result, previews):
    esc = lambda value: html.escape(str(value), quote=True)
    links = ['<a href="result.json">Job details</a>', '<a href="manifest.json">All files</a>',
             '<a href="RECEIVING.md">Receiving instructions</a>']
    parts = ['<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
             '<title>' + esc(result["reportName"]) + '</title>',
             '<style>body{font:15px/1.5 Arial,sans-serif;color:#181818;background:#f7f7f7;margin:0}main{max-width:1280px;margin:auto;padding:32px}h1{font-size:27px;margin:0 0 8px}h2{font-size:19px;margin-top:32px}a{color:inherit;text-underline-offset:3px}nav{display:flex;gap:20px;flex-wrap:wrap;margin:20px 0}section{background:white;border:1px solid #ccc;padding:20px;margin:20px 0}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #ccc;text-align:left;vertical-align:top;padding:8px}th{background:#eee}code,pre{font:12px/1.5 monospace;overflow-wrap:anywhere}pre{white-space:pre-wrap}.scroll{overflow:auto}.meta{color:#555}.status{display:inline-block;border:1px solid #555;padding:3px 9px}li{margin:8px 0}</style><main>',
             '<h1>' + esc(result["reportName"]) + '</h1><p class="status">' + esc(result["status"].replace("_", " ")) + '</p>',
             '<p class="meta">Job ' + esc(result["jobId"]) + ' · Attempt ' + esc(result["attemptId"]) + '</p>',
             '<nav>' + " ".join(links) + '</nav>']
    if result["issues"]:
        parts.append('<section><h2>Items to review</h2><ul>')
        for item in result["issues"]:
            parts.append('<li><strong>' + esc(item["stage"]) + '</strong>: ' + esc(item["message"]) + '</li>')
        parts.append('</ul><p>Use the retained originals and mapping to prepare the corrected request.</p></section>')
    parts.append('<section><h2>Original inputs</h2><table><tr><th>Role</th><th>File</th><th>Bytes</th><th>SHA-256</th></tr>')
    for slot, item in result["sourceFiles"].items():
        parts.append('<tr><td>' + esc(slot) + '</td><td><a href="' + esc(item["file"]) + '">' +
                     esc(item["filename"]) + '</a></td><td>' + str(item["bytes"]) + '</td><td><code>' +
                     esc(item["sha256"]) + '</code></td></tr>')
    parts.append('</table></section>')
    for slot, edition in result["editions"].items():
        review = edition["build"]
        parts.append('<section><h2>' + esc(edition["label"]) + '</h2><p>' + str(review["rowCount"]) +
                     ' complete rows · ' + str(len(review["columns"])) + ' exposed columns</p><nav>' +
                     '<a href="' + esc(edition["datasetFile"]) + '">Full CSV</a>' +
                     '<a href="' + esc(edition["projectFile"]) + '">Portable project</a>' +
                     '<a href="' + esc(edition["queryFile"]) + '">Original query result</a></nav>' +
                     '<p class="meta">Build <code>' + esc(review["id"]) + '</code></p>')
        preview = previews.get(slot, [])
        if preview:
            parts.append('<p class="meta">Preview: ' + str(len(preview) - 1) + ' rows. The linked CSV contains every row.</p><div class="scroll"><table>')
            for number, row in enumerate(preview):
                tag = "th" if number == 0 else "td"
                parts.append('<tr>' + "".join('<' + tag + '>' + esc(value if len(value) <= 240 else value[:237] + "...") +
                                            '</' + tag + '>' for value in row) + '</tr>')
            parts.append('</table></div>')
        parts.append('</section>')
    comparison = result.get("comparison")
    if comparison:
        counts = comparison["summary"]["counts"]
        parts.append('<section><h2>Edition comparison</h2><table><tr>' +
                     "".join('<th>' + esc(name.title()) + '</th>' for name in counts) + '</tr><tr>' +
                     "".join('<td>' + str(value) + '</td>' for value in counts.values()) + '</tr></table>' +
                     '<p>Comparison uses the declared edition keys and exact projected cells.</p>' +
                     '<a href="comparison/changes.jsonl">Complete changes</a> · <a href="comparison/summary.json">Comparison details</a></section>')
    parts.append('</main></html>\n')
    return "".join(parts).encode("utf-8")


RECEIVING = """# Receive this complete dataset job

Open review.html for the result, original inputs, complete CSV files and any
correction details. The manifest.json names every file with its byte count and
SHA-256. The result.json records the original build and query identities.

Receive the complete downloaded ZIP with the installed Starforge command:

    starforge dataset-ndjson-job receive --file /absolute/dataset-project.zip --out /absolute/private/received --python /absolute/python3

The optional --sha256 argument binds the receive to the selected downloaded job
result. Repeat the same command after an interruption. It restores every file,
reconstructs each edition in received/customer-workspace, repeats the original
successful query and comparison, then closes and reopens the customer workspace.

Each editions/*/project.zip is the existing six-file NDJSON project format.
It contains the retained source, normalized mapping, complete CSV, dataset
configuration and original build review.

With the installed original Starforge CLI, create a private receiving workspace:

    starforge dataset-ndjson --workspace /absolute/private/customer-workspace init

Import the current edition, and the baseline when supplied:

    starforge dataset-ndjson --workspace /absolute/private/customer-workspace import --file editions/source/project.zip
    starforge dataset-ndjson --workspace /absolute/private/customer-workspace import --file editions/baseline/project.zip

The receiver reconstructs the complete source and mapping through the original
dataset engine and compares the exported dataset hashes and native snapshot.
Open the receiver with:

    starforge dataset-ndjson --workspace /absolute/private/customer-workspace serve

The workspace/ directory also retains the complete saved source workspace.
Its sources, mappings, both builds and comparison remain available after reopening.

For JSON-array inputs, originals/ retains the complete original JSON package.
The normalized/ directory contains the selected original array as JSON Lines.
Exact numeric tokens and nested objects survive this conversion. The result
records the explicit JSON Pointer and both file identities.

Amounts requiring exact decimal preservation should be mapped as strings;
original integers outside JavaScript's exact integer range also use strings.
A missing field and an explicit null remain distinct through the mapping's
state columns. Full object and array projections use the original JSON mode.

A REVIEW_REQUIRED package includes the original inputs and the precise stage
requiring attention. Correct the mapping, query or source selection and use the
existing job workflow to submit the corrected input. Keep baseline and current
editions from the same dataset when requesting an edition comparison.
"""


def run(request_path: Path, directory: Path):
    regular(request_path, 1024 * 1024)
    request = load_json(request_path.read_bytes())
    if not isinstance(request, dict) or request.get("schema") != "stellar-forge.ndjson-file-job.v1":
        raise InputError("Expected a retained NDJSON file-job request")
    directory.mkdir(mode=0o700, parents=False, exist_ok=False)
    for name in ["editions", "normalized", "comparison"]:
        (directory / name).mkdir(mode=0o700)
    user = request["input"]
    result = {"schema": SCHEMA, "reportName": user["reportName"], "jobId": request["jobId"],
              "attemptId": request["attemptId"], "status": "COMPLETE", "sourceFiles": {},
              "editions": {}, "comparison": None, "issues": []}
    files, previews = {}, {}
    for slot, item in request["files"].items():
        if slot not in {"source", "baseline", "mapping"}:
            raise InputError("Unexpected source slot")
        path = Path(item["path"])
        regular(path, 65536 if slot == "mapping" else MAX_FILE)
        if path.stat().st_size != item["descriptor"]["bytes"] or file_digest(path) != item["descriptor"]["sha256"]:
            raise InputError("Retained job input changed before dataset processing")
        suffix = ".json" if slot == "mapping" or user.get(slot + "Format", user.get("sourceFormat", "ndjson")) == "json-array" else ".ndjson"
        target = "originals/" + slot + suffix
        files[target] = path
        result["sourceFiles"][slot] = {**item["descriptor"], "file": target}
    if not {"source", "mapping"} <= set(result["sourceFiles"]):
        raise InputError("A complete job requires an original source and mapping")
    private_write(directory / "request.json", json_bytes({"schema": request["schema"],
                  "jobId": request["jobId"], "attemptId": request["attemptId"], "input": user,
                  "files": result["sourceFiles"]}))
    def issue(stage, error):
        result["issues"].append({"stage": stage, "message": str(error)})
        result["status"] = "REVIEW_REQUIRED"
    try:
        mapping = load_json(Path(request["files"]["mapping"]["path"]).read_bytes())
        with Workspace(directory / "workspace", create=True) as workspace:
            plan = workspace.save_plan(mapping)
            for slot in ["source", "baseline"]:
                if slot not in request["files"]:
                    continue
                label = user.get(slot + "Label") or ("Current edition" if slot == "source" else "Baseline edition")
                try:
                    original = Path(request["files"][slot]["path"])
                    format_name = user.get(slot + "Format", user.get("sourceFormat", "ndjson"))
                    pointer = user.get(slot + "ArrayPointer", user.get("sourceArrayPointer", ""))
                    normalized = directory / "normalized" / (slot + ".ndjson")
                    selected, transformation = normalized_source(original, format_name, pointer, normalized)
                    with selected.open("rb") as stream:
                        source = workspace.add_source(stream, label, selected.name)
                    build = workspace.build(source["id"], plan["id"])
                    destination = directory / "editions" / slot
                    workspace.export_dataset(build["id"], destination)
                    workspace.export_packet(build["id"], destination / "project.zip")
                    query_file = destination / "query.json"
                    try:
                        params = load_json(user.get("queryJson", '{"limit":"50"}'))
                        query = workspace.query(build["id"], params)
                        private_write(query_file, json_bytes(query))
                        if query["response"]["status"] != 200:
                            issue(slot + " query", "The original dataset engine rejected these query parameters; see the complete original query result.")
                    except InputError as error:
                        private_write(query_file, json_bytes({"error": str(error)}))
                        issue(slot + " query", error)
                    result["editions"][slot] = {"label": label, "source": source["id"], "transformation": transformation,
                        "build": build, "datasetFile": f"editions/{slot}/data.csv",
                        "projectFile": f"editions/{slot}/project.zip", "queryFile": f"editions/{slot}/query.json"}
                    with (destination / "data.csv").open(encoding="utf-8", newline="") as stream:
                        reader = csv.reader(stream)
                        previews[slot] = [row for _, row in zip(range(26), reader)]
                except InputError as error:
                    issue(slot + " edition", error)
            if {"source", "baseline"} <= set(result["editions"]):
                try:
                    comparison = workspace.compare(result["editions"]["baseline"]["build"]["id"],
                                                   result["editions"]["source"]["build"]["id"])
                    copy_private(workspace.comparison_file(comparison["id"]), directory / "comparison" / "changes.jsonl")
                    private_write(directory / "comparison" / "summary.json", json_bytes(comparison))
                    result["comparison"] = {"summary": comparison, "changesFile": "comparison/changes.jsonl"}
                except InputError as error:
                    issue("edition comparison", error)
            private_write(directory / "workspace-state.json", json_bytes(workspace.state()))
    except InputError as error:
        issue("mapping", error)
    private_write(directory / "result.json", json_bytes(result))
    private_write(directory / "RECEIVING.md", RECEIVING.encode("utf-8"))
    private_write(directory / "review.html", render_report(result, previews))
    for path in sorted(directory.rglob("*")):
        if path.is_file() and path.name != ".lock":
            files[path.relative_to(directory).as_posix()] = path
    inventory = {name: {"bytes": path.stat().st_size, "sha256": file_digest(path, MAX_EXPANDED)}
                 for name, path in sorted(files.items())}
    if sum(item["bytes"] for item in inventory.values()) > MAX_EXPANDED:
        raise InputError("The complete expanded delivery exceeds 512 MiB")
    manifest = {"schema": BUNDLE, "jobId": request["jobId"], "attemptId": request["attemptId"],
                "status": result["status"], "files": inventory}
    private_write(directory / "manifest.json", json_bytes(manifest))
    files["manifest.json"] = directory / "manifest.json"
    output = directory.parent / "result.zip"
    with os.fdopen(os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w+b") as target:
        with zipfile.ZipFile(target, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for name, path in sorted(files.items()):
                archive.write(path, name)
        target.flush()
        os.fsync(target.fileno())
    if output.stat().st_size > MAX_OUTPUT:
        raise InputError("The complete result archive exceeds the 64 MiB job-result limit")
    return {"schema": SCHEMA, "status": result["status"], "jobId": result["jobId"], "file": str(output),
            "bytes": output.stat().st_size, "sha256": file_digest(output),
            "editions": {key: value["build"]["rowCount"] for key, value in result["editions"].items()},
            "comparison": result["comparison"]["summary"]["counts"] if result["comparison"] else None,
            "issues": result["issues"], "files": len(files)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the original NDJSON workspace over a sealed file-job request")
    parser.add_argument("--request", required=True, type=Path)
    parser.add_argument("--directory", required=True, type=Path)
    args = parser.parse_args()
    try:
        print(json.dumps(run(args.request, args.directory), ensure_ascii=False), flush=True)
    except (InputError, OSError) as error:
        print(json.dumps({"error": str(error)}), file=sys.stderr, flush=True)
        raise SystemExit(1)
