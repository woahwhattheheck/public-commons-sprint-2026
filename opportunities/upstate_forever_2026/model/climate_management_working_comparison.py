"""Readable comparisons of exact saved Management drafts; no scientific calculation."""
from __future__ import annotations

from copy import deepcopy
import csv
import html
import io
from pathlib import Path
import zipfile

from . import climate_management_working as working
from .common import (atomic_bytes, canonical, describe_file, digest, file_digest, held,
                     identifier, read_json, relative_file, verify_file)

KIND = "climate-management-working-comparisons"
FILES = "climate-management-working-comparison-files"
SCHEMA = "upstate.climate-management-working-comparison/v1"
MEMBERS = ("comparison.json", "before-history.json", "after-history.json",
           "before-draft.json", "after-draft.json", "source-bindings.json",
           "changes.csv", "report.html", "README.txt")
MEDIA = {".json": "application/json", ".csv": "text/csv", ".html": "text/html",
         ".txt": "text/plain", ".zip": "application/zip"}
SCOPE = ("This compares authored, possibly unfinished design choices. It does not "
         "evaluate scientific validity, calculate a modeled benefit or dispatch a native run.")


def _selected(value):
    if not isinstance(value, dict) or set(value) != {"before_revision_id", "after_revision_id", "title"}:
        raise ValueError("Select both original saved revisions and a comparison title")
    for field in ("before_revision_id", "after_revision_id"):
        identifier(value[field])
    if not isinstance(value["title"], str) or not value["title"].strip():
        raise ValueError("Name the saved-design comparison")
    return deepcopy(value)


def _summary(record):
    return {name: deepcopy(record[name]) for name in
            ("id", "project_id", "series_id", "revision", "parent_id", "forked_from",
             "name", "author", "note", "created_at")}


def _rows(before, after):
    rows = []
    def add(group, field, left, right, left_present=True, right_present=True):
        state = ("added" if not left_present else "removed" if not right_present else
                 "unchanged" if canonical(left) == canonical(right) else "changed")
        rows.append({"group": group, "field": field, "before_present": left_present,
                     "after_present": right_present, "before": deepcopy(left),
                     "after": deepcopy(right), "change": state})
    def fields(group, label, left, right, names):
        for name in names:
            lp, rp = left is not None and name in left, right is not None and name in right
            add(group, label + " / " + name, left.get(name) if lp else None,
                right.get(name) if rp else None, lp, rp)
    for field in ("name", "author", "note"):
        add("Attribution", field, before[field], after[field])
    a, b = before["draft"]["selection"], after["draft"]["selection"]
    fields("Design", "Selection", a, b, ("title", "purpose", "reference_period_id", "difference_maps"))
    def ordered(group, left, right, key, field_names):
        lk, rk = [key(row) for row in left], [key(row) for row in right]
        unambiguous = all(value is not None for value in lk + rk) and len(set(lk)) == len(lk) and len(set(rk)) == len(rk)
        mode = "original identity" if unambiguous else "original position"
        add(group, "Complete original order", lk if unambiguous else list(range(1, len(left)+1)),
            rk if unambiguous else list(range(1, len(right)+1)))
        if unambiguous:
            la, rb = dict(zip(lk, left)), dict(zip(rk, right))
            keys = list(dict.fromkeys(lk + rk))
            for token in keys:
                fields(group, str(token), la.get(token), rb.get(token), field_names)
        else:
            for index in range(max(len(left), len(right))):
                fields(group, "Position " + str(index+1),
                       left[index] if index < len(left) else None,
                       right[index] if index < len(right) else None, field_names)
        return mode
    period_mode = ordered("Periods", a["periods"], b["periods"],
                          lambda row: row["id"] if row["id"].strip() else None,
                          ("id", "label", "reference", "treatment", "control"))
    def area_key(row):
        if not row["source_collection_id"].strip() or not row["source_id"].strip():
            return None
        return canonical([row["source_collection_id"], row["source_id"], row.get("layer", "")]).decode("utf-8")
    area_mode = ordered("Reporting areas", a["reporting_areas"], b["reporting_areas"], area_key,
                        ("source_collection_id", "source_id", "name", "layer", "where"))
    fields("Bound originals", "Bindings", before["bindings"], after["bindings"], ("studies", "sources"))
    return rows, {"periods": period_mode, "reporting_areas": area_mode}


def _result(identity):
    before = identity["before"]["records"][-1]
    after = identity["after"]["records"][-1]
    rows, alignment = _rows(before, after)
    return {"schema": SCHEMA, "preview_id": digest(identity), "workspace_id": identity["workspace_id"],
            "selection": deepcopy(identity["selection"]), "title": identity["selection"]["title"],
            "scope": SCOPE, "before": _summary(before), "after": _summary(after),
            "same_revision": before["id"] == after["id"],
            "same_series": before["series_id"] == after["series_id"],
            "after_descends_from_before": before["id"] in [row["id"] for row in identity["after"]["records"][:-1]],
            "alignment": alignment, "rows": rows,
            "changed_fields": sum(row["change"] != "unchanged" for row in rows),
            "changed_design_fields": sum(row["change"] != "unchanged" and row["group"] in
                                         ("Design", "Periods", "Reporting areas") for row in rows)}


def preview(workspace, selection):
    selection = _selected(selection)
    before = working.export_package(workspace, selection["before_revision_id"])
    after = working.export_package(workspace, selection["after_revision_id"])
    identity = {"schema": SCHEMA, "version": 1, "workspace_id": workspace.project["id"],
                "selection": selection, "before": before, "after": after,
                "implementation_sha256": file_digest(Path(__file__))}
    return {"id": digest(identity), "identity": identity, **_result(identity)}


def catalogue(workspace):
    revisions = []
    for record in workspace._list(working.KIND):
        working._record(record)
        revisions.append(_summary(record))
    revisions.sort(key=lambda row: (row["created_at"], row["id"]), reverse=True)
    return {"workspace_id": workspace.project["id"], "revisions": revisions, "reports": list_reports(workspace)}


def _display(value, present=True):
    if not present:
        return "(absent)"
    if value == "":
        return "(blank text)"
    if isinstance(value, str):
        return value
    return canonical(value).decode("utf-8")


def _html(result):
    escape = lambda value: html.escape(str(value), quote=True)
    def table(rows):
        return "<div class='scroll'><table><thead><tr><th>Field</th><th>Before</th><th>After</th><th>Change</th></tr></thead><tbody>" + "".join(
            "<tr><th scope='row'>" + escape(row["field"]) + "</th><td><pre>" +
            escape(_display(row["before"], row["before_present"])) + "</pre></td><td><pre>" +
            escape(_display(row["after"], row["after_present"])) + "</pre></td><td>" +
            escape(row["change"]) + "</td></tr>" for row in rows) + "</tbody></table></div>"
    body = "<h1>" + escape(result["title"]) + "</h1><p>" + escape(SCOPE) + "</p>"
    body += "<p>" + str(result["changed_design_fields"]) + " changed design fields. All original values, including unchanged fields, are retained below.</p>"
    body += "<p>Period alignment: " + escape(result["alignment"]["periods"]) + ". Reporting-area alignment: " + escape(result["alignment"]["reporting_areas"]) + ".</p>"
    body += "<p>Identity alignment is used only when each side has unique nonblank keys. Otherwise rows are compared by original position; this makes no inferred feature or period lineage.</p>"
    for side in ("before", "after"):
        row = result[side]
        body += "<section><h2>" + side.capitalize() + " revision</h2><dl>" + "".join(
            "<dt>" + escape(key.replace("_", " ")) + "</dt><dd><pre>" + escape(_display(value)) + "</pre></dd>"
            for key, value in row.items()) + "</dl></section>"
    for group in ("Attribution", "Design", "Periods", "Reporting areas", "Bound originals"):
        body += "<section><h2>" + escape(group) + "</h2>" + table([row for row in result["rows"] if row["group"] == group]) + "</section>"
    body += "<section><h2>Original editable files</h2><ul>" + "".join(
        "<li><a download href='" + escape(name) + "'>" + escape(name) + "</a></li>"
        for name in MEMBERS if name != "report.html") + "</ul><p>The history JSON preserves exact immutable bindings. The editable selected Study additionally carries the original source bytes and complete dependency families.</p><p>CSV prefixes cells beginning with spreadsheet formula characters with an apostrophe. The original JSON retains literal values.</p></section>"
    return "<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>" + escape(result["title"]) + "</title><style>body{font:16px/1.5 system-ui,sans-serif;color:#172026;background:#fff;margin:0 auto;padding:24px;max-width:1200px}h1{font-size:2rem}section{margin:28px 0}table{border-collapse:collapse;width:100%;min-width:680px}th,td{border:1px solid #b9c1c6;padding:10px;vertical-align:top;text-align:left}th{background:#eef1f3}.scroll{overflow:auto}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;margin:0}dt{font-weight:700}dd{margin:0 0 8px}footer{border-top:1px solid #b9c1c6;padding-top:16px}@media(max-width:500px){body{padding:14px}h1{font-size:1.5rem}}@media print{.scroll{overflow:visible}table{min-width:0;font-size:9pt}tr{break-inside:avoid}}</style><main>" + body + "</main><footer>TokenJunkieLabs · original saved Management designs</footer></html>"


def _csv(result):
    def cell(value):
        value = str(value)
        return "'" + value if value.lstrip().startswith(("=", "+", "-", "@")) else value
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    writer.writerow(["group", "field", "change", "before_present", "before", "after_present", "after"])
    for row in result["rows"]:
        writer.writerow([cell(row["group"]), cell(row["field"]), row["change"], row["before_present"],
                         cell(_display(row["before"], row["before_present"])), row["after_present"],
                         cell(_display(row["after"], row["after_present"]))])
    return stream.getvalue()


def build(workspace, selection, expected_id):
    identifier(expected_id)
    with held(workspace.root / ".workspace.lock"), held(workspace.root / ".climate-management-working-comparisons.lock"):
        selection = _selected(selection)
        for record in workspace._list(KIND):
            if record.get("preview_id") == expected_id:
                if record.get("identity", {}).get("selection") != selection:
                    raise ValueError("This original comparison request names different saved revisions")
                return get_report(workspace, record["id"], verify=True)
        prepared = preview(workspace, selection)
        if prepared["id"] != expected_id:
            raise ValueError("The selected original revisions or comparison implementation changed; preview again")
        identity = prepared["identity"]
        result = {key: value for key, value in prepared.items() if key not in {"id", "identity"}}
        directory = workspace.root / FILES / expected_id
        values = {
            "comparison.json": canonical(result) + b"\n",
            "before-history.json": canonical(identity["before"]) + b"\n",
            "after-history.json": canonical(identity["after"]) + b"\n",
            "before-draft.json": canonical(identity["before"]["records"][-1]["draft"]) + b"\n",
            "after-draft.json": canonical(identity["after"]["records"][-1]["draft"]) + b"\n",
            "source-bindings.json": canonical({side: identity[side]["records"][-1]["bindings"] for side in ("before", "after")}) + b"\n",
            "changes.csv": _csv(result).encode("utf-8"),
            "report.html": _html(result).encode("utf-8"),
            "README.txt": (SCOPE + "\n\nOpen report.html for the full readable comparison. JSON retains literal unfinished controls and complete original histories. The ZIP is a readable handover; use the editable Study or full Workspace to carry actual source files. CSV formula-like text is apostrophe-prefixed. Native runs and scientific reports are unchanged.\n\nTokenJunkieLabs\n").encode("utf-8"),
        }
        for name, value in values.items():
            atomic_bytes(directory / name, value, immutable=True)
        manifest = {"schema": "upstate.climate-management-working-comparison-files/v1",
                    "preview_id": expected_id, "members": [
                        describe_file(directory, directory / name, media_type=MEDIA[Path(name).suffix]) for name in MEMBERS]}
        atomic_bytes(directory / "MANIFEST.json", canonical(manifest) + b"\n", immutable=True)
        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for name in (*MEMBERS, "MANIFEST.json"):
                info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, (directory / name).read_bytes())
        atomic_bytes(directory / "working-design-comparison.zip", buffer.getvalue(), immutable=True)
        files = {name: describe_file(workspace.root, directory / name, media_type=MEDIA[Path(name).suffix])
                 for name in (*MEMBERS, "MANIFEST.json", "working-design-comparison.zip")}
        record = workspace._save(KIND, {"workspace_id": workspace.project["id"], "preview_id": expected_id,
                                        "identity": identity, "result": result, "files": files})
        return get_report(workspace, record["id"], verify=True)


def get_report(workspace, report_id, verify=True):
    key = identifier(report_id)
    record = workspace._get(KIND, key)
    if (set(record) != {"id", "schema", "workspace_id", "preview_id", "identity", "result", "files"}
            or record["schema"] != "upstate." + KIND + "/v1"
            or digest({k: v for k, v in record.items() if k != "id"}) != key
            or record["workspace_id"] != workspace.project["id"]):
        raise ValueError("The saved working-design comparison changed its immutable identity")
    identity = record["identity"]
    if (identity.get("schema") != SCHEMA or identity.get("version") != 1
            or digest(identity) != record["preview_id"] or identity.get("workspace_id") != workspace.project["id"]):
        raise ValueError("The original compared revisions or comparison identity changed")
    selected = _selected(identity["selection"])
    for side in ("before", "after"):
        if identity[side] != working.export_package(workspace, selected[side + "_revision_id"]):
            raise ValueError("A comparison lost its exact original working history")
    result = record["result"]
    if (result.get("preview_id") != record["preview_id"] or result.get("selection") != selected
            or result.get("workspace_id") != workspace.project["id"]):
        raise ValueError("The readable result lost its original selection")
    if set(record["files"]) != set((*MEMBERS, "MANIFEST.json", "working-design-comparison.zip")):
        raise ValueError("Retain every complete working comparison file")
    prefix = FILES + "/" + record["preview_id"] + "/"
    for name, item in record["files"].items():
        if item.get("path") != prefix + name or item.get("media_type") != MEDIA[Path(name).suffix]:
            raise ValueError("A working comparison file changed its original scope")
        path = relative_file(workspace.root, item["path"])
        if path.stat().st_size != item["bytes"]:
            raise ValueError("A working comparison file changed its original size")
        if verify:
            verify_file(workspace.root, item)
    if verify:
        if read_json(workspace.root / record["files"]["comparison.json"]["path"]) != result:
            raise ValueError("The original comparison JSON differs from its retained result")
        for side in ("before", "after"):
            if read_json(workspace.root / record["files"][side+"-history.json"]["path"]) != identity[side]:
                raise ValueError("The original history download differs from its captured revision")
    return deepcopy(record)


def list_reports(workspace):
    result = []
    for record in workspace._list(KIND):
        if digest({k: v for k, v in record.items() if k != "id"}) != identifier(record["id"]):
            raise ValueError("A retained draft-comparison identity changed")
        result.append({"id": record["id"], "title": record["result"]["title"],
                       "before_revision_id": record["identity"]["selection"]["before_revision_id"],
                       "after_revision_id": record["identity"]["selection"]["after_revision_id"]})
    return result


def verify_all(workspace):
    rows = list_reports(workspace)
    for row in rows:
        get_report(workspace, row["id"], verify=True)
    return {"comparisons": len(rows), "ids": [row["id"] for row in rows]}
