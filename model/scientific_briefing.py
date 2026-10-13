"""Present an exact saved scientific report and retain its complete offline edition."""
from __future__ import annotations
import copy
import base64
import hashlib
import json
import os
from pathlib import Path
import tempfile
import zipfile
from .common import (atomic_bytes, atomic_json, describe_file, digest, held,
                     identifier, read_json, relative_file, verify_file)
from . import client_briefing

SCHEMA = "upstate.scientific-briefing-report/v1"
RECORD = "upstate.scientific-briefing-edition/v1"
EDITION = "2026-10-13-ordered-scientific-briefing-1"
KIND = "scientific-report-briefings"
FILES = {"model": "scientific-briefing-model.json",
         "html": "scientific-briefing.html", "index": "scientific-briefing-index.json"}


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True,
                      separators=(",", ":"), allow_nan=False)


def _sha(body):
    return hashlib.sha256(body).hexdigest()


def _directory(workspace, kind, key):
    key = identifier(key)
    root = workspace.root.resolve()
    directory = root / kind / key
    if directory.is_symlink() or not directory.resolve().is_relative_to(root):
        raise ValueError("Keep the saved briefing in its original Workspace")
    return directory


def original(workspace, edition_id):
    """Open the original saved report through its existing edition contract."""
    from . import observed_context
    directory = _directory(workspace, "scientific-report-editions", edition_id)
    record = read_json(directory / "edition.json")
    identity = record.get("render_identity")
    if (record.get("schema") != "upstate.scientific-report-edition/v1"
            or record.get("id") != edition_id
            or record.get("project_id") != workspace.project["id"]
            or digest(identity) != edition_id):
        raise ValueError("The saved scientific report identity changed")
    result = read_json(directory / "operation.json")
    if (result.get("state") != "complete"
            or result.get("operation_id") != "observed-report-" + edition_id[:20]
            or any(result.get(name) != value for name, value in identity.items())
            or result.get("files") != record.get("files")
            or read_json(directory / "selection.json") != identity):
        raise ValueError("The completed scientific report differs from its saved selection")
    if observed_context.bind(workspace, identity["selection"]) != identity["binding"]:
        raise ValueError("The report's original scientific sources changed")
    files = dict(record["files"])
    for role, name in (("operation", "operation.json"), ("edition", "edition.json")):
        if role in files:
            raise ValueError("The original report uses a reserved edition role")
        files[role] = describe_file(directory, directory / name)
    for item in files.values():
        verify_file(directory, item)
    if "report_data" not in files or "report_html" not in files:
        raise ValueError("Prepare the complete scientific report before presenting it")
    return record, directory, files


def _sections(data):
    """Keep every original block in order and its original report anchor."""
    sections = []
    for number, source in enumerate(data["sections"]):
        if not isinstance(source, dict) or not isinstance(source.get("blocks"), list):
            raise ValueError("Retain the complete original scientific section blocks")
        heading = str(source["heading"])
        blocks = source["blocks"] or [""]
        for block_number, block in enumerate(blocks):
            row = {"id": "section-" + str(number) + "-block-" + str(block_number),
                   "title": heading, "original_anchor": "section-" + str(number),
                   "original_section": number, "original_block": block_number,
                   "paragraphs": [], "tables": [], "assets": [], "figures": [],
                   "core": True}
            if isinstance(block, dict):
                kind = block.get("kind")
                if kind == "table":
                    if (not isinstance(block.get("columns"), list) or not block["columns"]
                            or not isinstance(block.get("rows"), list)
                            or any(not isinstance(values, list) or len(values) != len(block["columns"])
                                   for values in block["rows"])):
                        raise ValueError("Keep every original scientific table column and row")
                    row["tables"] = [{**copy.deepcopy(block), "scientific_cells": True}]
                elif kind == "links":
                    row["assets"] = [{"path": item["path"], "title": item["title"]}
                                     for item in block["items"]]
                    if any(client_briefing._path(item["path"]) is None for item in row["assets"]):
                        raise ValueError("Scientific report assets must stay in the complete delivery")
                elif kind == "figure":
                    row["figures"] = [copy.deepcopy(block)]
                elif kind == "link":
                    row["scientific_paragraphs"] = [copy.deepcopy(block)]
                else:
                    raise ValueError("The original scientific block kind is unsupported")
            else:
                row["scientific_paragraphs"] = [copy.deepcopy(block)]
            sections.append(row)
    source_rows = []
    for item in data.get("source_records", []):
        source_rows.append([item.get("title", item.get("id", "")), item.get("id", ""),
                            item.get("source_id", ""), item.get("vintage", ""),
                            item.get("uri", ""), item.get("sha256", "")])
    sections.append({"id": "original-source-editions", "title": "Original source editions",
                     "original_anchor": "section-" + str(len(data["sections"])),
                     "paragraphs": [], "tables": [{"columns": [
                         "Source", "Role", "Retained document", "Edition", "Original reference", "SHA256"],
                         "rows": source_rows, "scientific_cells": True}],
                     "assets": [], "figures": [], "core": True})
    return sections


def _build(workspace, edition_id):
    record, directory, originals = original(workspace, edition_id)
    body = verify_file(directory, originals["report_data"]).read_bytes()
    data = json.loads(body)
    if (not isinstance(data.get("sections"), list)
            or data.get("binding", {}).get("observed_context") != record["render_identity"]["binding"]
            or data.get("binding", {}).get("selection") != record["render_identity"]["selection"]):
        raise ValueError("The saved report data differs from its original ordered source selection")
    identity = {"edition": EDITION, "source_edition_id": edition_id,
                "project_id": workspace.project["id"], "report_data": originals["report_data"],
                "renderer_sha256": _sha(Path(client_briefing.__file__).read_bytes()),
                "adapter_sha256": _sha(Path(__file__).read_bytes())}
    key = digest(identity)
    source = {"edition_id": edition_id, "briefing_id": key, "project_id": workspace.project["id"],
              "report_data": originals["report_data"],
              "canonical_sha256": _sha(_json(data).encode("utf-8")),
              "ordered_sources": copy.deepcopy(record["sources"])}
    report = {"schema": SCHEMA, "report_edition": EDITION, "title": record["title"],
              "report_kind_label": "Saved scientific report",
              "delivery_mode": "scientific_report", "source_report": source,
              "original_report": data, "sections": _sections(data), "maps": [],
              "source_scope": [
                  {"label": "Original studies", "value": record["source_count"]},
                  {"label": "Original report sections", "value": record["section_count"]},
                  {"label": "Original scientific figures", "value": record["figure_count"]}]}
    # Each image retains its original SVG and numeric specification. Local links
    # are resolved against the exact existing member inventory, including data.
    members = {item["path"]: item for item in originals.values()}
    for section in report["sections"]:
        for asset in section.get("assets", []):
            if asset["path"] not in members:
                raise ValueError("A scientific report asset is absent from its saved edition")
        for figure in section.get("figures", []):
            item = members.get(figure.get("path"))
            if (item is None or not str(figure["path"]).endswith(".svg")
                    or client_briefing._path(figure["path"]) is None
                    or any(item[field] != figure.get(field) for field in ("bytes", "sha256"))
                    or not isinstance(figure.get("spec"), dict)
                    or any(not isinstance(figure.get(field), str) or not figure[field].strip()
                           for field in ("alt", "caption"))):
                raise ValueError("Keep the scientific figure with its original SVG and numeric specification")
    return key, identity, report, record, directory, originals


def report_binding(report, report_model_bytes=None):
    """Bind presentation notes to the complete original scientific report data."""
    source, data = report.get("source_report"), report.get("original_report")
    if (report.get("schema") != SCHEMA or report.get("delivery_mode") != "scientific_report"
            or not isinstance(source, dict) or not isinstance(data, dict)
            or not isinstance(report.get("sections"), list) or report.get("maps") != []
            or source.get("canonical_sha256") != _sha(_json(data).encode("utf-8"))):
        raise ValueError("Retain the complete original scientific briefing model")
    for field in ("edition_id", "briefing_id"):
        value = source.get(field)
        if not isinstance(value, str) or len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
            raise ValueError("The scientific briefing needs its exact saved edition identity")
    if report_model_bytes is None:
        body, method = _json(report).encode("utf-8"), "sha256-canonical-json-utf8"
    else:
        if (not isinstance(report_model_bytes, bytes)
                or _json(json.loads(report_model_bytes)) != _json(report)):
            raise ValueError("The original scientific briefing model bytes differ")
        body, method = report_model_bytes, "sha256-original-report-model-bytes"
    return {"schema": client_briefing.EDITION, "report_sha256": _sha(body),
            "report_digest_method": method, "report_edition": report["report_edition"],
            "report_kind": "scientific_report", "source_report": source,
            "delivery_id": source["briefing_id"], "baseline_run_id": None,
            "alternative_run_ids": [], "title": report["title"],
            "delivery_mode": "scientific_report", "grid_id": None, "profile_id": None}


def preview(workspace, edition_id):
    key, identity, report, source, directory, originals = _build(workspace, edition_id)
    slides, _ = client_briefing._slides(report)
    return {"schema": "upstate.scientific-briefing-preview/v1", "id": key,
            "source_edition_id": edition_id, "title": report["title"],
            "source_count": source["source_count"], "section_count": source["section_count"],
            "figure_count": source["figure_count"], "page_count": len(slides),
            "original_file_count": len(originals),
            "existing": (_directory(workspace, KIND, key) / "briefing.json").is_file()}


def create(workspace, edition_id, *, expected_id):
    key, identity, report, source, original_root, originals = _build(workspace, edition_id)
    if key != expected_id:
        raise ValueError("Preview the exact saved scientific report before preparing its briefing")
    directory = _directory(workspace, KIND, key)
    with held(workspace.root / ".workspace.lock"), held(directory / ".briefing.lock"):
        if (directory / "briefing.json").is_file():
            saved, _ = inspect(workspace, key)
            return saved
        model_body = (_json(report) + "\n").encode("utf-8")
        figure_images = {figure["path"]: "data:image/svg+xml;base64," + base64.b64encode(
            verify_file(original_root, next(item for item in originals.values()
                if item["path"] == figure["path"])).read_bytes()).decode("ascii")
            for section in report["sections"] for figure in section.get("figures", [])}
        document, index = client_briefing.render(
            report, report_href=originals["report_html"]["path"],
            model_href=FILES["model"], report_model_bytes=model_body, figure_images=figure_images)
        bodies = {"model": model_body, "html": document.encode("utf-8"),
                  "index": (_json(index) + "\n").encode("utf-8")}
        if set(FILES.values()) & {row["path"] for row in originals.values()}:
            raise ValueError("An original report uses a reserved briefing filename")
        files = {}
        for role, body in bodies.items():
            atomic_bytes(directory / FILES[role], body, immutable=True)
            files[role] = describe_file(directory, directory / FILES[role])
        saved = {"schema": RECORD, "id": key, "state": "complete",
                 "identity": identity, "project_id": workspace.project["id"],
                 "source_edition_id": edition_id, "title": source["title"],
                 "source_count": source["source_count"], "section_count": source["section_count"],
                 "figure_count": source["figure_count"], "page_count": len(index["slides"]),
                 "files": files, "original_files": originals}
        atomic_json(directory / "briefing.json", saved, immutable=True)
    inspect(workspace, key)
    return saved


def inspect(workspace, key):
    directory = _directory(workspace, KIND, key)
    record = read_json(directory / "briefing.json")
    if (record.get("schema") != RECORD or record.get("id") != key
            or record.get("state") != "complete"
            or record.get("project_id") != workspace.project["id"]
            or digest(record.get("identity")) != key):
        raise ValueError("The saved scientific briefing identity changed")
    source, original_root, originals = original(workspace, record["source_edition_id"])
    if originals != record["original_files"]:
        raise ValueError("The briefing differs from the original saved report files")
    for item in record["files"].values():
        verify_file(directory, item)
    body = verify_file(directory, record["files"]["model"]).read_bytes()
    report = json.loads(body)
    binding = report_binding(report, body)
    original_body = verify_file(original_root, originals["report_data"]).read_bytes()
    if (report["source_report"]["edition_id"] != record["source_edition_id"]
            or report["source_report"]["briefing_id"] != key
            or report["source_report"]["report_data"] != originals["report_data"]
            or _json(json.loads(original_body)) != _json(report["original_report"])
            or read_json(directory / record["files"]["index"]["path"]).get("binding") != binding):
        raise ValueError("The briefing model and original scientific report differ")
    return record, directory


def members(workspace, key):
    record, directory = inspect(workspace, key)
    original_root = _directory(workspace, "scientific-report-editions", record["source_edition_id"])
    result = {}
    for root, files in ((original_root, record["original_files"]), (directory, record["files"])):
        for descriptor in files.values():
            name = descriptor["path"]
            if name in result and any(result[name][field] != descriptor[field] for field in ("bytes", "sha256")):
                raise ValueError("Original report and briefing files conflict at a retained path")
            result[name] = {**descriptor, "source": str(verify_file(root, descriptor))}
    receipt = describe_file(directory, directory / "briefing.json")
    if receipt["path"] in result:
        raise ValueError("The original report uses a reserved briefing record filename")
    result[receipt["path"]] = {**receipt, "source": str(directory / receipt["path"])}
    return record, directory, result


def export(workspace, key):
    """Stream every original report member and all briefing files into one ZIP."""
    record, directory, files = members(workspace, key)
    archive, receipt = directory / "scientific-briefing.zip", directory / "archive.json"
    inventory = {name: {field: row[field] for field in ("bytes", "sha256")}
                 for name, row in sorted(files.items())}
    with held(workspace.root / ".workspace.lock"), held(directory / ".archive.lock"):
        if receipt.exists():
            saved = read_json(receipt)
            if saved.get("members") != inventory:
                raise ValueError("The briefing archive belongs to another original edition")
            verify_file(directory, saved["file"])
        else:
            fd, temporary_name = tempfile.mkstemp(prefix=".scientific-briefing-", suffix=".zip", dir=directory)
            os.close(fd)
            temporary = Path(temporary_name)
            try:
                with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, allowZip64=True) as output:
                    for name, row in sorted(files.items()):
                        path = Path(row["source"])
                        if path.is_symlink():
                            raise ValueError("Use ordinary original report files")
                        entry = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                        entry.compress_type, entry.external_attr = zipfile.ZIP_DEFLATED, 0o100600 << 16
                        entry.file_size = row["bytes"]
                        count, checksum = 0, hashlib.sha256()
                        with path.open("rb") as source, output.open(
                                entry, "w", force_zip64=row["bytes"] >= zipfile.ZIP64_LIMIT) as target:
                            before = os.fstat(source.fileno())
                            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                                count += len(chunk); checksum.update(chunk); target.write(chunk)
                            after = os.fstat(source.fileno())
                        if (count != row["bytes"] or checksum.hexdigest() != row["sha256"]
                                or any(getattr(before, field) != getattr(after, field) for field in
                                       ("st_dev", "st_ino", "st_size", "st_mtime_ns", "st_ctime_ns"))):
                            raise ValueError("An original report member changed: " + name)
                with temporary.open("rb") as completed:
                    os.fsync(completed.fileno())
                os.replace(temporary, archive)
                if os.name != "nt":
                    descriptor = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
                    try:
                        os.fsync(descriptor)
                    finally:
                        os.close(descriptor)
                atomic_json(receipt, {"members": inventory,
                                     "file": describe_file(directory, archive)}, immutable=True)
            finally:
                temporary.unlink(missing_ok=True)
        saved = read_json(receipt)
    return {**record, "archive": saved["file"]}


def notes_sources(workspace, key):
    record, directory = inspect(workspace, key)
    return {"report": verify_file(directory, record["files"]["model"]),
            "index": verify_file(directory, record["files"]["index"])}
