"""Complete recipient packages for original selected-watershed comparisons.

Compose retained comparison files, a completed scientific report and the original
editable Study exporter. No model execution or scientific rendering occurs here.
"""
from __future__ import annotations

import hashlib
from html import escape
import os
from pathlib import Path
import tempfile
import zipfile

from .common import (atomic_bytes, atomic_json, describe_file, digest, file_digest,
                     held, identifier, read_json, relative_file, verify_file)
from . import observed_context, observed_landcover, scientific_report_editions
from . import study_transfer
from source_tools import deliver_observed_report

KIND = "observed-landcover-handovers"
SCHEMA = "upstate.observed-landcover-handover/v1"
EDITION = "2026-10-13.1"


def _directory(workspace, key):
    root = Path(workspace.root).resolve()
    directory = root / KIND / identifier(key)
    if not directory.resolve().is_relative_to(root):
        raise ValueError("Keep the recipient package inside its original Workspace")
    return directory


def _record(workspace, key):
    directory = _directory(workspace, key)
    value = read_json(directory / "handover.json")
    if (value.get("schema") != SCHEMA or value.get("id") != key
            or value.get("state") != "complete"
            or value.get("project_id") != workspace.project["id"]
            or digest(value.get("identity")) != key
            or any(value.get(name) != value["identity"].get(name)
                   for name in ("project_id", "comparison_id", "report_id", "study"))):
        raise ValueError("The recipient package identity changed")
    return value, directory


def _matches(comparison, report):
    return (report.get("state") == "complete" and comparison["source"] in
            observed_context.source_choices(report["render_identity"]["selection"]))


def catalog(workspace, comparison_id):
    """List only completed report editions containing this exact saved source."""
    comparison = observed_landcover.inspect(workspace, identifier(comparison_id))["edition"]
    reports = []
    directory = Path(workspace.root) / scientific_report_editions.KIND
    if directory.is_dir():
        for path in sorted(directory.glob("*/edition.json")):
            report, _ = scientific_report_editions.record(workspace, path.parent.name)
            if _matches(comparison, report):
                reports.append({name: report.get(name) for name in
                                ("id", "title", "source_count", "figure_count")})
    handovers = []
    directory = Path(workspace.root) / KIND
    if directory.is_dir():
        for path in sorted(directory.glob("*/handover.json")):
            value, _ = _record(workspace, path.parent.name)
            if value["comparison_id"] == comparison_id:
                handovers.append({name: value[name] for name in
                                  ("id", "state", "title", "comparison_id", "report_id", "files")})
    return {"comparison": {name: comparison[name] for name in ("id", "title", "huc12s")},
            "reports": reports, "handovers": handovers}


def inspect(workspace, key):
    value, directory = _record(workspace, identifier(key))
    for item in value["files"].values():
        verify_file(workspace.root, item)
    manifest = read_json(directory / "Package_Manifest.json")
    if (manifest.get("identity") != value["identity"]
            or manifest.get("members") != value["members"]
            or manifest.get("study") != value["study"]):
        raise ValueError("The recipient package no longer matches its source inventory")
    return value


def _copy(source, destination, expected):
    """Copy original bytes in bounded chunks and publish without replacement."""
    source, destination = Path(source), Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if (destination.stat().st_size != expected["bytes"]
                or file_digest(destination) != expected["sha256"]):
            raise ValueError("A retained recipient file differs: " + destination.name)
        return
    fd, pending_name = tempfile.mkstemp(prefix=".handover-copy-", dir=destination.parent)
    pending = Path(pending_name)
    try:
        count, checksum = 0, hashlib.sha256()
        with os.fdopen(fd, "wb") as target, source.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                target.write(chunk)
                count += len(chunk)
                checksum.update(chunk)
            target.flush()
            os.fsync(target.fileno())
        if count != expected["bytes"] or checksum.hexdigest() != expected["sha256"]:
            raise ValueError("Original recipient source changed: " + source.name)
        try:
            os.link(pending, destination)
        except FileExistsError:
            if (destination.stat().st_size != count or file_digest(destination) != checksum.hexdigest()):
                raise ValueError("A concurrent recipient file differs: " + destination.name)
    finally:
        pending.unlink(missing_ok=True)


def _zip(directory, destination, members):
    """Stream originals, including the ordinary editable Study ZIP."""
    fd, pending_name = tempfile.mkstemp(prefix=".recipient-zip-", suffix=".zip", dir=directory)
    os.close(fd)
    pending = Path(pending_name)
    try:
        with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_DEFLATED,
                             allowZip64=True) as archive:
            for name, item in sorted(members.items()):
                path = relative_file(directory, name)
                info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                # Original archives and PDFs already compress well; store those
                # byte-for-byte without a second expensive compression pass.
                info.compress_type = (zipfile.ZIP_STORED if path.suffix.lower() in (".zip", ".pdf")
                                      else zipfile.ZIP_DEFLATED)
                info.external_attr = 0o100600 << 16
                info.file_size = item["bytes"]
                count, checksum = 0, hashlib.sha256()
                with path.open("rb") as stream, archive.open(
                        info, "w", force_zip64=item["bytes"] >= zipfile.ZIP64_LIMIT) as target:
                    while chunk := stream.read(1024 * 1024):
                        count += len(chunk)
                        checksum.update(chunk)
                        target.write(chunk)
                if count != item["bytes"] or checksum.hexdigest() != item["sha256"]:
                    raise ValueError("A recipient member changed during packaging: " + name)
        with pending.open("rb") as stream:
            os.fsync(stream.fileno())
        if destination.exists():
            if (destination.stat().st_size != pending.stat().st_size
                    or file_digest(destination) != file_digest(pending)):
                raise ValueError("The original complete recipient ZIP differs")
        else:
            os.link(pending, destination)
    finally:
        pending.unlink(missing_ok=True)


def _instructions(value):
    hucs = ", ".join(value["huc12s"])
    return (
        "# " + value["title"] + "\n\n"
        "Extract the entire Recipient_Package.zip into one folder, then open START_HERE.html. "
        "Keep the extracted folders together so the original relative links work.\n\n"
        "## Read and inspect\n\n"
        "- Report/Watershed_Scientific_Report.pdf: the original completed scientific PDF.\n"
        "- Report/Watershed_Offline_Reader.html: the same report with complete original sources "
        "available offline through its download controls.\n"
        "- Comparison/report.html: the saved selected-watershed comparison; its original "
        "tables, figures and source documents are alongside it.\n"
        "- Comparison/selected-huc-landcover.zip: the unchanged original complete comparison archive.\n"
        "- Report/Original_Saved_Report.zip: the original native saved report archive, including "
        "its edition and operation identities.\n"
        "- Report/Watershed_Report_and_Sources.zip: the report reader's original report/source archive.\n"
        "- Editable_Study.zip: the original editable Study, selected from this exact completed "
        "scientific report and its complete source dependencies.\n\n"
        "## Reopen an editable Study\n\n"
        "In an existing Ecosystem Sciences operator, choose Restore an original workspace archive; "
        "select Editable_Study.zip in Original scientific workspace ZIP; choose Verify and restore "
        "original archive. Select the restored Workspace, open Studies, then the received Study "
        "and its selected watershed comparison. Open saved comparison retains its original source edition.\n\n"
        "For command-line receiving, use a qualified project Python runtime. From an installed "
        "application run:\n\n"
        "    /path/to/qualified/python -B model/cli.py restore /path/to/Editable_Study.zip /path/to/NEW_DIRECTORY\n\n"
        "NEW_DIRECTORY must not already exist. Then start the contained application:\n\n"
        "    /path/to/qualified/python -B /path/to/NEW_DIRECTORY/application/operator/server.py "
        "--workspace /path/to/NEW_DIRECTORY/workspace --operator-state "
        "/path/to/NEW_DIRECTORY/operator-state --port 0\n\n"
        "Open the local operator_url printed by that command. Keep its capability token private. "
        "The archive contains the captured application and original data; Python and its native "
        "dependencies must be available separately. For an interrupted restore, use the maintained "
        "operator restore action or model.portable.resume_restore with the exact archive SHA256 "
        "from Package_Manifest.json rather than manually overwriting a directory.\n\n"
        "## Exact retained selection\n\n"
        "Project: " + value["project_id"] + "\n\n"
        "Comparison: " + value["comparison_id"] + "\n\n"
        "Scientific report: " + value["report_id"] + "\n\n"
        "Editable Study: " + value["study"]["id"] + "\n\n"
        "Original HUC12s: " + hucs + "\n\n"
        "This report may also contain other explicitly selected scientific sources. "
        "Package_Manifest.json retains their exact ordered source identifiers. The comparison "
        "uses original annual categorical land-cover cells and paired-valid support. Its change "
        "areas are observations, not nutrient or sediment model predictions.\n"
    )


def _start(value):
    e = lambda item: escape(str(item), quote=True)
    hucs = "".join("<li><code>" + e(item) + "</code></li>" for item in value["huc12s"])
    sources = "".join("<tr><td><code>" + e(item["source_collection_id"]) + "</code></td>"
                      "<td><code>" + e(item["source_id"]) + "</code></td></tr>"
                      for item in value["ordered_report_sources"])
    return """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>""" + e(value["title"]) + """ — recipient package</title><style>
*{box-sizing:border-box}body{margin:0;background:#f5f5f4;color:#191919;font:17px/1.55 system-ui,sans-serif}
main{max-width:1100px;margin:0 auto;padding:32px 24px}header{border-bottom:2px solid #242424;padding-bottom:20px}
h1{font-size:clamp(1.7rem,4vw,2.5rem);line-height:1.16}h2{margin-top:1.8em;font-size:1.35rem}h3{font-size:1.1rem}
a{color:#17364d;text-underline-offset:3px}a:focus,summary:focus,.scroll:focus{outline:3px solid #333;outline-offset:3px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px}.card{background:white;border:1px solid #aaa;padding:18px}
.card a{display:block;font-weight:650;margin-bottom:8px}.note{border-left:4px solid #666;padding:8px 16px;background:#ececeb}
code{overflow-wrap:anywhere}pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#eee;padding:16px;font-size:.87rem}
.scroll{overflow-x:auto}table{border-collapse:collapse;width:100%;min-width:560px}th,td{border-bottom:1px solid #bbb;text-align:left;padding:9px;vertical-align:top}
small{font-size:.9rem}ul.hucs{display:flex;gap:8px 24px;flex-wrap:wrap;padding-left:24px}
@media(max-width:520px){main{padding:20px 16px}.card{padding:16px}}
@media print{body{background:white;font-size:10pt}main{padding:0;max-width:none}.grid{display:block}.card{break-inside:avoid;margin-bottom:10px}
.scroll{overflow:visible}table{min-width:0;table-layout:fixed}thead{display:table-header-group}a{color:inherit}details{display:block}}
</style></head><body><main><header><p>ECOSYSTEM SCIENCES · RETAINED ORIGINAL STUDY</p><h1>""" + e(value["title"]) + """</h1>
<p>Read the completed report, inspect its original watershed data, or reopen the editable scientific Study.</p></header>
<p class="note">Extract the complete package before opening this page. Keep all folders together.
This package preserves an existing completed scientific report and original selected comparison.</p>
<div class="grid">
<section class="card"><h2>Read the report</h2><a href="Report/Watershed_Scientific_Report.pdf">Open original scientific PDF</a>
<a href="Report/Watershed_Offline_Reader.html">Open offline report and source downloads</a>
<p>The original report retains its ordered sources, figures and interpretation.</p></section>
<section class="card"><h2>Inspect the comparison</h2><a href="Comparison/report.html">Open selected watershed comparison</a>
<a href="Comparison/huc-summary.csv" download>Download watershed summary CSV</a>
<a href="Comparison/huc-classes.csv" download>Download original class inventories CSV</a>
<a href="Comparison/huc-transitions.csv" download>Download complete directional transitions CSV</a>
<p>All tables, figures and original source documents remain together in the Comparison folder.</p></section>
<section class="card"><h2>Continue the work</h2><a href="Editable_Study.zip" download>Download original editable Study</a>
<a href="#reopen">Reopen in the scientific application</a><p>This archive contains the selected report,
its complete source dependencies and the captured application.</p></section></div>
<h2>Original selected watersheds</h2><ul class="hucs">""" + hucs + """</ul>
<p>The comparison uses annual categorical land-cover cells and paired-valid support. Its observed change
areas do not represent nutrient or sediment model predictions. Other report sections retain their own
source scope and methods.</p>
<h2 id="reopen">Reopen the editable Study</h2>
<ol><li>In an existing operator, choose <strong>Restore an original workspace archive</strong>.</li>
<li>Select <strong>Editable_Study.zip</strong> in <strong>Original scientific workspace ZIP</strong>
and choose <strong>Verify and restore original archive</strong>.</li>
<li>Select the restored Workspace, open <strong>Studies</strong>, then the received Study and
its selected watershed comparison. Choose <strong>Open saved comparison</strong>.</li></ol>
<p>The archive preserves the original project and source identities. A qualified Python runtime and
native dependencies are needed to run the captured application.</p>
<details><summary>Command-line receiving and retained identities</summary><pre>""" + e(_instructions(value)) + """</pre></details>
<h2>Complete archives and original sources</h2><ul>
<li><a href="Comparison/selected-huc-landcover.zip" download>Original complete comparison ZIP</a></li>
<li><a href="Report/Original_Saved_Report.zip" download>Original saved scientific edition ZIP, including edition and operation records</a></li>
<li><a href="Report/Watershed_Report_and_Sources.zip" download>Offline report's complete original report and sources ZIP</a></li>
<li><a href="Package_Manifest.json" download>Complete file inventory and exact retained identities</a></li>
<li><a href="README.md">Plain-text receiving instructions</a></li></ul>
<h3>Ordered report source identities</h3><div class="scroll" tabindex="0" role="region" aria-label="Original report source identifiers; scroll horizontally">
<table><thead><tr><th>Source collection</th><th>Source</th></tr></thead><tbody>""" + sources + """</tbody></table></div>
<p><small>Project <code>""" + e(value["project_id"]) + """</code><br>Comparison <code>""" + e(value["comparison_id"]) + """</code><br>
Scientific report <code>""" + e(value["report_id"]) + """</code><br>Editable Study <code>""" + e(value["study"]["id"]) + """</code></small></p>
</main></body></html>
"""


def build(workspace, comparison_id, report_id, *, investigation_snapshot=None):
    comparison_id, report_id = identifier(comparison_id), identifier(report_id)
    comparison = observed_landcover.inspect(workspace, comparison_id)["edition"]
    report, report_directory, _ = scientific_report_editions.inspect(workspace, report_id)
    if not _matches(comparison, report):
        raise ValueError("Choose a completed scientific report containing this exact saved comparison source")
    # Freeze the actual original Study first. Its identity includes the
    # captured application, all selected sources and investigation history.
    # The configured snapshot adapter has prepare(plan) and a capture call;
    # the original exporter owns both under the original Workspace guard.
    exported_report = scientific_report_editions.export(workspace, report_id)
    selection = study_transfer.normalise({
        "title": comparison["title"] + " — editable scientific report",
        "roots": [{"kind": scientific_report_editions.KIND, "id": report_id}],
        "include_related_results": False})
    base = Path(workspace.root) / KIND
    base.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".capture-", dir=base) as temporary_name:
        captured_study = Path(temporary_name) / "Editable_Study.zip"
        study = study_transfer.export_study(
            workspace, captured_study, selection,
            investigation_snapshot=investigation_snapshot)
        identity = {"edition": EDITION, "implementation_sha256": file_digest(Path(__file__)),
                    "packager_sha256": file_digest(Path(deliver_observed_report.__file__)),
                    "project_id": workspace.project["id"], "comparison_id": comparison_id,
                    "report_id": report_id, "comparison_source": comparison["source"],
                    "study": {name: study[name] for name in ("id", "bytes", "sha256")}}
        key = digest(identity)
        directory = _directory(workspace, key)
        directory.mkdir(parents=True, exist_ok=True)
        with held(directory / ".handover.lock"):
            if (directory / "handover.json").is_file():
                return inspect(workspace, key)
            report_path = verify_file(Path(exported_report["directory"]), exported_report["file"])
            report_output = directory / "Report"
            report_output.mkdir(exist_ok=True)
            _copy(report_path, report_output / "Original_Saved_Report.zip", exported_report["file"])
            deliver_observed_report.package(report_directory, report_output, "Watershed")
            for name, item in comparison["files"].items():
                original = verify_file(workspace.root, item)
                target = directory / "Comparison" / name
                if (Path(name).is_absolute() or ".." in Path(name).parts
                        or not target.resolve().is_relative_to(directory.resolve())):
                    raise ValueError("Keep every original comparison member inside its package folder")
                _copy(original, target, item)
            _copy(captured_study, directory / "Editable_Study.zip", study)
            value = {"schema": SCHEMA, "id": key, "state": "complete",
                     "identity": identity, "project_id": workspace.project["id"],
                     "title": comparison["title"], "comparison_id": comparison_id,
                     "report_id": report_id, "huc12s": comparison["huc12s"],
                     "ordered_report_sources": observed_context.source_choices(report["render_identity"]["selection"]),
                     "study": {name: study[name] for name in ("id", "bytes", "sha256")}}
            # Include every original dynamic comparison/report file, including
            # source custody and implementation companions added by later editions.
            members = {}
            for path in sorted(directory.rglob("*")):
                if path.is_file() and not any(part.startswith(".") for part in path.relative_to(directory).parts):
                    name = path.relative_to(directory).as_posix()
                    if name not in ("handover.json", "Package_Manifest.json", "Recipient_Package.zip", "START_HERE.html", "README.md"):
                        members[name] = describe_file(directory, path)
            atomic_bytes(directory / "README.md", _instructions(value).encode("utf-8"), immutable=True)
            atomic_bytes(directory / "START_HERE.html", _start(value).encode("utf-8"), immutable=True)
            for name in ("README.md", "START_HERE.html"):
                members[name] = describe_file(directory, directory / name)
            manifest = {**value, "members": members}
            atomic_json(directory / "Package_Manifest.json", manifest, immutable=True)
            archive_members = {**members, "Package_Manifest.json":
                               describe_file(directory, directory / "Package_Manifest.json")}
            _zip(directory, directory / "Recipient_Package.zip", archive_members)
            value["members"] = members
            value["files"] = {name: describe_file(workspace.root, directory / name)
                              for name in (*archive_members, "Recipient_Package.zip")}
            atomic_json(directory / "handover.json", value, immutable=True)
            return inspect(workspace, key)
