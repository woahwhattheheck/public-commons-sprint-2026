"""Read complete synthesis evidence and comparison through the existing receiving owner.

The original completed operation, browser journal and Workspace archive remain
unchanged. This source-bound continuation uses the original OperatorProcess and
browser driver, opening the original and independently restored Workspace.
"""
from __future__ import annotations
import hashlib
import json
import os
from pathlib import Path
from html.parser import HTMLParser
import tempfile
import uuid
from model.common import canonical, file_digest, read_json
from model.workspace import Workspace
from model.scientific_synthesis import inspect as inspect_synthesis
from scientific_synthesis_receiving import _extract, _name

SCHEMA = "upstate.scientific-synthesis-review-receiving/v1"
SOURCE_PATHS = (
    "AGENTS.md", "CURRENT_OWNER_DIRECTION.md",
    "operator/scientific_synthesis_review_receiving.py",
    "operator/scientific_synthesis_review_receiving.mjs",
    "operator/scientific_synthesis_receiving.py",
    "operator/scientific_synthesis_receiving.mjs",
    "operator/receiving.py", "operator/receiving.mjs",
    "operator/web/scientific_synthesis.mjs",
    "operator/web/scientific_synthesis_core.mjs",
    "operator/web/scientific_synthesis_evidence.mjs",
    "operator/web/scientific_synthesis_compare.mjs",
    "operator/web/scientific_synthesis_compare_core.mjs",
    "operator/web/scientific_synthesis_compare_report.mjs",
    "operator/web/scientific_synthesis_compare.css",
    "operator/web/scientific_source_reader.mjs",
    "operator/web/scientific_synthesis.css",
    "operator/web/source_report_editions.mjs",
    "operator/source_reports.py", "operator/extensions/source-reports.json",
    "model/scientific_synthesis.py", "model/scientific_synthesis_catalog.py",
    "operator/SCIENTIFIC_SYNTHESIS_REVIEW_RECEIVING.md",
    "operator/SCIENTIFIC_SYNTHESIS_EVIDENCE.md",
    "operator/SCIENTIFIC_SYNTHESIS_COMPARISON.md",
)


def _pin(path):
    path = Path(path)
    if not path.is_file() or path.is_symlink():
        raise ValueError("Open an original complete receiving file: " + str(path))
    return {"path": str(path.resolve()), "bytes": path.stat().st_size,
            "sha256": file_digest(path)}


def _same(path, descriptor):
    actual = _pin(path)
    if any(actual[key] != descriptor[key] for key in ("bytes", "sha256")):
        raise ValueError("The complete receiving file changed: " + str(path))
    return actual


def _retain(path, body):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, prefix=".synthesis-review-", delete=False) as output:
            temporary = Path(output.name)
            output.write(body)
            output.flush()
            os.fsync(output.fileno())
        try:
            os.link(temporary, path)
        except FileExistsError:
            if path.read_bytes() != body:
                raise ValueError("A retained source-bound review differs: " + str(path))
        fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(fd)
        finally:
            os.close(fd)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)
    return _pin(path)


def _artifacts(root, receipt):
    if receipt.get("schema") != SCHEMA or not receipt.get("complete"):
        raise ValueError("Complete the original readable evidence/comparison phase")
    for name, item in receipt["artifacts"].items():
        if (not name or Path(name).name != name or "/" in name or "\\" in name
                or name in (".", "..") or item["path"] != name):
            raise ValueError("Keep the whole review artifact in its original output")
        _same(root / name, item)


class _ComparisonHTML(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=False)
        self.active = False
        self.parts = []
        self.count = 0

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        if tag == "script" and attributes.get("id") == "scientific-synthesis-comparison-data":
            if attributes.get("type") != "application/json":
                raise ValueError("The literal comparison HTML has another source format")
            self.count += 1
            self.active = True

    def handle_endtag(self, tag):
        if tag == "script":
            self.active = False

    def handle_data(self, data):
        if self.active:
            self.parts.append(data)


def _inspect_exports(root, receipt, originals):
    """Open every literal returned file and source member before completion."""
    root = Path(root)
    _artifacts(root, receipt)
    for name in receipt["artifacts"]:
        if name.endswith(".json"):
            read_json(root / name)
    package = read_json(root / "comparison.json")
    if package.get("schema") != "upstate.scientific-synthesis-comparison/v1":
        raise ValueError("Open the complete actual comparison package")
    encoded = package["source_text"].encode("utf-8")
    if len(encoded) != package["source_bytes"] or hashlib.sha256(encoded).hexdigest() != package["source_sha256"]:
        raise ValueError("The literal comparison changed its complete source")
    selected = json.loads(package["source_text"])
    for side, original in zip(("before", "after"), originals):
        actual = selected[side]
        if any(actual.get(key) != value for key, value in original.items()):
            raise ValueError("The literal comparison differs from its native authored edition")
        if read_json(root / ("offline-" + side + ".json")) != actual:
            raise ValueError("The standalone edition download lost original source/history")
    for name in ("reopened-comparison.json.json", "reopened-comparison.html.json", "offline-comparison.json"):
        if read_json(root / name) != package:
            raise ValueError("The complete reopened comparison differs")
    parser = _ComparisonHTML()
    parser.feed((root / "comparison.html").read_text(encoding="utf-8"))
    parser.close()
    if parser.count != 1 or json.loads("".join(parser.parts)) != package:
        raise ValueError("The literal readable HTML embeds another complete comparison")
    inspected, opened = {}, []
    for side, original in zip(("before", "after"), originals):
        response = receipt["phases"][side + "-source"]
        archive = root / (side + "-source.zip")
        _same(archive, response["download"])
        extracted = _extract(archive, root / "opened-attachments" / side, inspected)
        directory = Path(extracted.get("directory") or extracted["same_complete_archive"])
        manifest_path = directory.joinpath(*_name(response["manifest_member"]).parts)
        if file_digest(manifest_path) != response["original_manifest_sha256"]:
            raise ValueError("The literal archive changed its original source manifest")
        manifest = read_json(manifest_path)
        if (response["collection_id"] != original["collection_id"]
                or set(response["source_ids"]) != {entry["id"] for entry in manifest["entries"]}
                or original["source_id"] not in response["source_ids"]):
            raise ValueError("The complete extracted source roster differs")
        names = {response["manifest_member"]}
        for entry in manifest["entries"]:
            for declared in (entry, *entry.get("companions", [])):
                name = _name(declared["path"])
                member = directory.joinpath(*name.parts)
                pin = _pin(member)
                for key in ("bytes", "sha256"):
                    if key in declared and declared[key] != pin[key]:
                        raise ValueError("The literal declared source member changed: " + str(name))
                names.add(name.as_posix())
        actual_names = {row["path"] for row in (extracted.get("members") or inspected[extracted["sha256"]]["members"])}
        if actual_names != names:
            raise ValueError("The whole original source archive member roster differs")
        for name, key in (("synthesis-record.json", "record"), ("synthesis-history.json", "history"), ("source-catalog.json", "catalog")):
            if read_json(directory / name) != original[key]:
                raise ValueError("The extracted authored source differs from native receiving")
        opened.append({"side": side, "archive": _pin(archive), "extracted": extracted,
                       "original_manifest": _pin(manifest_path)})
    result = {"schema": "upstate.scientific-synthesis-review-opened/v1",
              "source_sha256": package["source_sha256"], "archives": opened,
              "artifacts": receipt["artifacts"],
              "producer_review": "Open all final images, HTML, JSON and extracted original study deliverables in the existing receiving applications."}
    _retain(root / "opened-attachments.json", canonical(result) + b"\n")
    return _pin(root / "opened-attachments.json")


def continue_review(args, application, workspace, model, output, accepted,
                    process_class, run_command, atomic):
    """Called while the original native receiving lock is held."""
    application, output = Path(application).resolve(), Path(output).resolve()
    original_result = output / "operator-receiving-result.json"
    if read_json(original_result) != accepted or not accepted.get("complete"):
        raise ValueError("Continue the original complete native receiving result")
    source = output / "scientific-synthesis"
    progress = read_json(source / "synthesis-receiving.json")
    if not progress.get("complete"):
        raise ValueError("Complete the original two-edition synthesis receiving first")
    control_path = source / "authored-course-input.json"
    _same(control_path, progress["artifacts"]["authored-course-input.json"])
    control = read_json(control_path)
    if control["project_id"] != model["workspace_id"] or workspace.project["id"] != model["workspace_id"]:
        raise ValueError("The read-only continuation belongs to another original project")
    receiving = accepted["received"]
    if not Path(receiving["directory"]).exists():
        from model.portable import restore
        archive = accepted["workspace_archive"]
        _same(archive["path"], archive)
        restored = restore(archive["path"], receiving["directory"])
        if (restored["project"]["id"] != model["workspace_id"]
                or restored["archive_sha256"] != archive["sha256"]):
            raise ValueError("The independently restored Workspace identity changed")
    restored_workspace = Workspace(receiving["workspace"])
    # Validate native originals before opening either UI. Do not rewrite the
    # original native-reopened sidecar during this read-only continuation.
    originals = []
    for name in ("first", "second"):
        phase = progress["phases"][name]
        original = inspect_synthesis(workspace, phase["result"]["collection_id"])
        received = inspect_synthesis(restored_workspace, phase["result"]["collection_id"])
        if (original["record"] != received["record"] or original["history"] != received["history"]
                or original["record"]["operation_id"] != phase["request"]["payload"]["operation_id"]
                or original["record"]["revision_id"] != phase["received_revision_id"]):
            raise ValueError("Original and received authored editions differ")
        originals.append(original)
    bodies = {}
    for relative in SOURCE_PATHS:
        path = application / relative
        _pin(path)
        bodies[relative] = path.read_bytes()
    source_files = [{"path": name, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
                    for name, body in sorted(bodies.items())]
    selection = {"schema": SCHEMA, "operation_id": control["operation_id"],
                 "project_id": model["workspace_id"], "original_result": _pin(original_result),
                 "authored_input": _pin(control_path),
                 "collections": [row["collection_id"] for row in originals],
                 "revision_ids": [row["record"]["revision_id"] for row in originals],
                 "source_files": source_files}
    digest = hashlib.sha256(canonical(selection)).hexdigest()
    root = output / "synthesis-review-continuations" / digest
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    _retain(root / "selection.json", canonical(selection) + b"\n")
    _retain(root / "original-complete-result.json", original_result.read_bytes())
    _retain(root / "original-synthesis-receiving.json", (source / "synthesis-receiving.json").read_bytes())
    for name, body in bodies.items():
        _retain(root / "source" / name, body)
    review_control = {"schema": SCHEMA, "operation_id": control["operation_id"],
                      "project_id": model["workspace_id"], "selection_sha256": digest,
                      "collections": selection["collections"], "editions": originals,
                      "original_phases": {name: progress["phases"][name] for name in ("first", "second")}}
    _retain(root / "review-input.json", canonical(review_control) + b"\n")
    complete = root / "COMPLETE.json"
    if complete.exists():
        previous = read_json(complete)
        if previous["selection"] != selection:
            raise ValueError("The completed review has another source selection")
        for mode in ("original", "restored"):
            entry = previous["modes"][mode]
            _same(entry["receipt"]["path"], entry["receipt"])
            opened = _inspect_exports(root / mode, read_json(entry["receipt"]["path"]), originals)
            _same(opened["path"], entry["opened"])
        return previous
    attempts = root / "attempts" / str(uuid.uuid4())
    attempts.mkdir(parents=True, mode=0o700)
    result = {"schema": SCHEMA, "selection": selection, "complete": False, "modes": {}}
    private_control = root / "private/control.json"
    for mode, current_workspace in (("original", workspace), ("restored", restored_workspace)):
        browser_output = root / mode
        browser_output.mkdir(parents=True, exist_ok=True, mode=0o700)
        receipt_path = browser_output / "synthesis-review-receiving.json"
        if receipt_path.exists():
            prior = read_json(receipt_path)
            if prior.get("complete"):
                if prior["selection_sha256"] != digest or prior["mode"] != mode:
                    raise ValueError("The retained browser review names another source")
                opened = _inspect_exports(browser_output, prior, originals)
                result["modes"][mode] = {"receipt": _pin(receipt_path), "opened": opened, "reused": True}
                continue
        server = None
        try:
            # Current complete application, original model state; only one
            # original operator/browser is active at a time.
            server = process_class(application, current_workspace.root,
                                   root / ("private/" + mode + "-operator"),
                                   Path(args.scratch).resolve() / ("synthesis-review-" + digest[:16] + "-" + mode),
                                   attempts, mode, args.upload_limit_mib)
            if server.receipt["project"]["id"] != model["workspace_id"]:
                raise ValueError("The current operator opened another original project")
            atomic(private_control, {
                "mode": "synthesis-review", "operator_url": server.receipt["operator_url"],
                "workspace_key": server.receipt["workspace_key"], "model": model,
                "model_receiving_sha256": accepted["original_model_result"]["sha256"],
                "source_revision": args.source_revision,
                "output": str(browser_output),
                "progress": str(browser_output / "operator-browser-progress.json"),
                "node_modules": str(args.node_modules.resolve()),
                "chromium": str(args.chromium.resolve()),
                "include_intermediates": not args.omit_native_intermediates,
                "resume_failed_tasks": args.resume_failed_tasks,
                "task_timeout_seconds": args.task_timeout_seconds,
                "scientific_synthesis_review": {**review_control, "mode": mode},
            })
            run_command([str(args.node), str(application / "operator/receiving.mjs"), str(private_control)],
                        attempts, mode + "-review-browser")
            receipt = read_json(receipt_path)
            if receipt["selection_sha256"] != digest or receipt["mode"] != mode:
                raise ValueError("The actual browser review has another source")
            opened = _inspect_exports(browser_output, receipt, originals)
            result["modes"][mode] = {"receipt": _pin(receipt_path), "opened": opened, "reused": False}
            atomic(root / "progress.json", result)
        finally:
            if server is not None:
                server.close()
            private_control.unlink(missing_ok=True)
    # Native original histories remain exact after all read-only navigation.
    for current_workspace in (workspace, restored_workspace):
        for original in originals:
            current = inspect_synthesis(current_workspace, original["collection_id"])
            if current["record"] != original["record"] or current["history"] != original["history"]:
                raise ValueError("Read-only source review changed a native authored edition")
    if read_json(original_result) != accepted:
        raise ValueError("The original COMPLETE changed during read-only continuation")
    result["complete"] = True
    _retain(complete, canonical(result) + b"\n")
    return result
