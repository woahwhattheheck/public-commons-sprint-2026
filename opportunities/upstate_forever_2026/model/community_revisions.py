"""Compare retained Community plan revisions and keep a portable original-source handover."""
from __future__ import annotations

from copy import deepcopy
import csv
from decimal import Decimal, InvalidOperation
import hashlib
from html import escape
import io
import json
from pathlib import Path, PurePosixPath
import zipfile

from . import communities
from .common import (
    atomic_bytes, canonical, describe_file, digest, held, identifier, verify_file,
)

KIND = "community-plan-comparisons"
SCHEMA = "upstate.community-plan-comparison/v1"
FORMAT_VERSION = 1
SCOPE = (
    "Community figures describe the selected whole original block groups. "
    "Scientific context changes identify saved native selections and outputs. "
    "They do not allocate whole-run model results to communities or interventions."
)


def _json(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)


def _changes(left, right, prefix=""):
    """Preserve missing versus null and array order in exact saved values."""
    result = []
    for key in sorted(set(left) | set(right)):
        present_left, present_right = key in left, key in right
        a, b = left.get(key), right.get(key)
        field = prefix + key
        if present_left and present_right and isinstance(a, dict) and isinstance(b, dict):
            result.extend(_changes(a, b, field + "."))
        elif present_left != present_right or a != b:
            result.append({"field": field, "before_present": present_left,
                           "after_present": present_right, "before": deepcopy(a),
                           "after": deepcopy(b)})
    return result


def _index(rows):
    result = {}
    for position, row in enumerate(rows, 1):
        key = row.get("id")
        if not isinstance(key, str) or not key or key in result:
            raise ValueError("Original interventions must have unique nonempty identities")
        result[key] = (position, row)
    return result


def _amount(value):
    if value is None:
        return None
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError) as error:
        raise ValueError("An original intervention estimate is not a decimal USD amount") from error
    if not number.is_finite() or number < 0 or number != number.quantize(Decimal("0.01")):
        raise ValueError("An original intervention estimate is not a finite two-place USD amount")
    return number


def _money(value):
    return None if value is None else format(value, ".2f")


def _costs(plan):
    if plan.get("cost_summary", {}).get("currency") != "USD":
        raise ValueError("Select original Community plans with their native USD estimate basis")
    known, missing = [], []
    for row in plan["interventions"]:
        amount = _amount(row.get("cost_estimate_usd"))
        (missing if amount is None else known).append(row["id"] if amount is None else amount)
    return {"currency": "USD", "known_subtotal": _money(sum(known, Decimal(0))),
            "known_count": len(known), "missing_ids": missing,
            "complete": not missing, "intervention_count": len(plan["interventions"])}


def _plan_summary(plan):
    return {"id": plan["id"], "title": plan["title"],
            "revision_number": plan["revision_number"], "previous_plan_id": plan.get("previous_plan_id"),
            "table_id": plan["table_id"], "selection": deepcopy(plan["selection"]),
            "context_snapshot_sha256": plan["context"]["snapshot_sha256"]}


def _lineage(workspace, before_id, after_id):
    before_id, after_id = identifier(before_id), identifier(after_id)
    if before_id == after_id:
        raise ValueError("Select two different saved plan revisions")
    current = communities.get_plan(workspace, after_id)
    table_id = current["table_id"]
    reverse, seen = [], set()
    while True:
        if current["id"] in seen:
            raise ValueError("The original plan revision lineage repeats")
        seen.add(current["id"])
        if current["table_id"] != table_id:
            raise ValueError("A comparison must retain one original Community table edition")
        reverse.append(current)
        if current["id"] == before_id:
            break
        previous_id = current.get("previous_plan_id")
        if not previous_id:
            raise ValueError("The earlier plan must be an ancestor of the later selected revision")
        previous = communities.get_plan(workspace, previous_id)
        if current["revision_number"] != previous["revision_number"] + 1:
            raise ValueError("The original plan revision numbers do not follow their retained lineage")
        current = previous
    return list(reversed(reverse))


def compare(workspace, selection):
    if not isinstance(selection, dict):
        raise ValueError("Select an earlier plan and a later revision")
    lineage = _lineage(workspace, selection.get("before_plan_id"), selection.get("after_plan_id"))
    before, after = lineage[0], lineage[-1]
    table = communities.get_table(workspace, before["table_id"])
    for plan in (before, after):
        if plan["source"] != table["source"]:
            raise ValueError("A selected plan no longer matches its original Community source")
        communities.verify_plan_context(workspace, plan)
    return compare_saved(workspace.project["id"], lineage, table)


def compare_saved(project_id, lineage, table):
    """Reconstruct changes from complete original saved records, including a handover."""
    if len(lineage) < 2:
        raise ValueError("A comparison needs an original plan and a later retained revision")
    before, after = lineage[0], lineage[-1]
    seen = set()
    for index, plan in enumerate(lineage):
        if plan["id"] in seen or plan["table_id"] != table["id"] or plan["source"] != table["source"]:
            raise ValueError("The original saved records do not share one Community source lineage")
        seen.add(plan["id"])
        if index and (plan.get("previous_plan_id") != lineage[index - 1]["id"]
                      or plan["revision_number"] != lineage[index - 1]["revision_number"] + 1):
            raise ValueError("The original saved revision chain is incomplete")
    left, right = _index(before["interventions"]), _index(after["interventions"])
    before_order, after_order = list(left), list(right)
    shared = set(left) & set(right)
    rows = []
    for key in before_order + [key for key in after_order if key not in left]:
        previous, revised = left.get(key), right.get(key)
        original = previous[1] if previous else None
        current = revised[1] if revised else None
        changed = _changes(original or {}, current or {}) if previous and revised else []
        status = ("added" if previous is None else "removed" if revised is None
                  else "changed" if changed else "unchanged")
        a = _amount(original.get("cost_estimate_usd")) if original else None
        b = _amount(current.get("cost_estimate_usd")) if current else None
        rows.append({"id": key, "status": status,
                     "before_position": previous[0] if previous else None,
                     "after_position": revised[0] if revised else None,
                     "position_changed": bool(previous and revised and previous[0] != revised[0]),
                     "before": deepcopy(original), "after": deepcopy(current), "changes": changed,
                     "shared_known_cost_delta_usd": _money(b - a)
                     if previous and revised and a is not None and b is not None else None})
    costs_before, costs_after = _costs(before), _costs(after)
    subtotal_delta = Decimal(costs_after["known_subtotal"]) - Decimal(costs_before["known_subtotal"])
    complete_costs = costs_before["complete"] and costs_after["complete"]
    geography_before = [row["geoid"] for row in before["selected_groups"]]
    geography_after = [row["geoid"] for row in after["selected_groups"]]
    properties = ("title", "purpose", "notes")
    source_properties = ("source", "metadata")
    context_fields = sorted((set(before["context"]) | set(after["context"])) - {"snapshots", "snapshot_sha256"})
    context_changes = _changes({key: before["context"][key] for key in context_fields if key in before["context"]},
                               {key: after["context"][key] for key in context_fields if key in after["context"]})
    snapshots_before = before["context"].get("snapshots", {})
    snapshots_after = after["context"].get("snapshots", {})
    snapshot_families = []
    for family in sorted(set(snapshots_before) | set(snapshots_after)):
        a, b = snapshots_before.get(family), snapshots_after.get(family)
        if (family in snapshots_before) != (family in snapshots_after) or a != b:
            snapshot_families.append({"family": family,
                                     "before_present": family in snapshots_before,
                                     "after_present": family in snapshots_after,
                                     "before_sha256": digest(a) if family in snapshots_before else None,
                                     "after_sha256": digest(b) if family in snapshots_after else None,
                                     "before": deepcopy(a), "after": deepcopy(b)})
    counts = {name: sum(row["status"] == name for row in rows)
              for name in ("added", "removed", "changed", "unchanged")}
    counts["position_changed"] = sum(row["position_changed"] for row in rows)
    return {
        "schema": SCHEMA, "format_version": FORMAT_VERSION, "project_id": project_id,
        "before_plan": _plan_summary(before), "after_plan": _plan_summary(after),
        "lineage": [_plan_summary(plan) for plan in lineage],
        "table_id": table["id"], "source": deepcopy(table["source"]),
        "plan_changes": _changes({key: before[key] for key in properties},
                                 {key: after[key] for key in properties}),
        "source_changes": _changes({key: before[key] for key in source_properties},
                                   {key: after[key] for key in source_properties}),
        "selection_changes": _changes(before["selection"], after["selection"]),
        "geography": {"before_geoids": geography_before, "after_geoids": geography_after,
                      "added_geoids": [key for key in geography_after if key not in set(geography_before)],
                      "removed_geoids": [key for key in geography_before if key not in set(geography_after)],
                      "before_summary": deepcopy(before["summaries"]),
                      "after_summary": deepcopy(after["summaries"]),
                      "basis": "Selected whole original block groups; no spatial allocation of model outputs"},
        "interventions": rows, "counts": counts,
        "ordering": {"before_ids": before_order, "after_ids": after_order,
                     "changed": before_order != after_order,
                     "shared_relative_order_changed":
                         [key for key in before_order if key in shared] != [key for key in after_order if key in shared]},
        "costs": {"currency": "USD", "before": costs_before, "after": costs_after,
                  "known_subtotal_delta": _money(subtotal_delta),
                  "total_estimate_delta": _money(subtotal_delta) if complete_costs else None,
                  "basis": "Complete planning estimates" if complete_costs else
                           "Partial known-estimate subtotals; missing estimates remain unknown"},
        "scientific_context": {"before_snapshot_sha256": before["context"]["snapshot_sha256"],
                               "after_snapshot_sha256": after["context"]["snapshot_sha256"],
                               "selection_changes": context_changes,
                               "changed_snapshot_families": snapshot_families,
                               "scope": SCOPE},
    }


def _cell(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list, bool)):
        value = _json(value)
    else:
        value = str(value)
    # Preserve the exact value in JSON while making editable CSV safe to open.
    if value.lstrip().startswith(("=", "+", "@")) or (
            value.lstrip().startswith("-") and not _is_number(value.strip())):
        return "'" + value
    return value


def _is_number(value):
    try:
        return Decimal(value).is_finite()
    except InvalidOperation:
        return False


def _csv(columns, rows):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: _cell(row.get(key)) for key in columns})
    return stream.getvalue()


def _display(value, present=True):
    if not present:
        return "Absent"
    if value is None:
        return "Unknown / unspecified"
    if value == "":
        return "Empty text"
    return _json(value) if isinstance(value, (dict, list, bool)) else str(value)


def _table(headings, rows):
    return '<div class="table-scroll"><table><thead><tr>' + "".join(
        "<th>" + escape(str(value)) + "</th>" for value in headings) + "</tr></thead><tbody>" + "".join(
        "<tr>" + "".join("<td>" + escape(str(value)) + "</td>" for value in row) + "</tr>"
        for row in rows) + "</tbody></table></div>"


def _render(comparison, title):
    changes = []
    for row in comparison["interventions"]:
        for item in row["changes"]:
            changes.append({"intervention_id": row["id"], "field": item["field"], **item})
    header = comparison["before_plan"], comparison["after_plan"]
    cost = comparison["costs"]
    summary = [
        ["Earlier plan", header[0]["title"], header[0]["id"]],
        ["Later revision", header[1]["title"], header[1]["id"]],
        ["Original Community table", comparison["table_id"], comparison["source"].get("sha256", "")],
    ]
    sections = [
        ("Saved plan editions", ["Selection", "Title / value", "Original ID / SHA256"], summary),
        ("Intervention revisions", ["Original ID", "Change", "Earlier position", "Later position", "Earlier title", "Later title"],
         [[row["id"], row["status"], row["before_position"] or "", row["after_position"] or "",
           (row["before"] or {}).get("title", ""), (row["after"] or {}).get("title", "")]
          for row in comparison["interventions"]]),
        ("Field changes", ["Original intervention", "Field", "Earlier value", "Later value"],
         [[row["intervention_id"], row["field"], _display(row["before"], row["before_present"]),
           _display(row["after"], row["after_present"])] for row in changes]),
        ("Planning estimates", ["Measure", "Earlier USD", "Later USD", "Change USD"],
         [["Known-estimate subtotal", cost["before"]["known_subtotal"], cost["after"]["known_subtotal"], cost["known_subtotal_delta"]],
          ["Complete total estimate", cost["before"]["known_subtotal"] if cost["before"]["complete"] else "Unknown",
           cost["after"]["known_subtotal"] if cost["after"]["complete"] else "Unknown",
           cost["total_estimate_delta"] if cost["total_estimate_delta"] is not None else "Unknown"],
          ["Unestimated intervention IDs", ", ".join(cost["before"]["missing_ids"]) or "None",
           ", ".join(cost["after"]["missing_ids"]) or "None", ""]]),
        ("Plan title, purpose and notes", ["Field", "Earlier value", "Later value"],
         [[row["field"], _display(row["before"], row["before_present"]),
           _display(row["after"], row["after_present"])] for row in comparison["plan_changes"]]),
        ("Original source and metadata", ["Field", "Earlier value", "Later value"],
         [[row["field"], _display(row["before"], row["before_present"]),
           _display(row["after"], row["after_present"])] for row in comparison["source_changes"]]),
        ("Original intervention order", ["Edition", "Original IDs in saved order"],
         [["Earlier", ", ".join(comparison["ordering"]["before_ids"])],
          ["Later", ", ".join(comparison["ordering"]["after_ids"])] ]),
        ("Community selection", ["Field", "Earlier value", "Later value"],
         [[row["field"], _display(row["before"], row["before_present"]),
           _display(row["after"], row["after_present"])] for row in comparison["selection_changes"]]),
        ("Original block-group membership", ["Change", "Original GEOID"],
         [["Added", key] for key in comparison["geography"]["added_geoids"]] +
         [["Removed", key] for key in comparison["geography"]["removed_geoids"]]),
        ("Saved scientific selections", ["Field", "Earlier value", "Later value"],
         [[row["field"], _display(row["before"], row["before_present"]),
           _display(row["after"], row["after_present"])] for row in comparison["scientific_context"]["selection_changes"]]),
        ("Changed native context snapshots", ["Original family", "Earlier SHA256", "Later SHA256"],
         [[row["family"], row["before_sha256"] or "Absent", row["after_sha256"] or "Absent"]
          for row in comparison["scientific_context"]["changed_snapshot_families"]]),
    ]
    sections.append(("Complete added and removed interventions", ["Change", "Original intervention", "Full retained row"],
                     [[row["status"], row["id"], _json(row["after"] if row["status"] == "added" else row["before"])]
                      for row in comparison["interventions"] if row["status"] in {"added", "removed"}]))
    body = "".join("<section><h2>" + escape(name) + "</h2>" +
                   (_table(headings, rows) if rows else "<p>No changes in this section.</p>") + "</section>"
                   for name, headings, rows in sections)
    html = ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            "<title>" + escape(title) + "</title><style>"
            "body{font:15px/1.5 system-ui,sans-serif;color:#202020;background:#fff;max-width:1180px;margin:32px auto;padding:0 24px}"
            "h1{font-size:26px}h2{font-size:19px;margin-top:32px}table{width:100%;border-collapse:collapse;font-size:13px}"
            "td,th{border:1px solid #aaa;padding:8px;text-align:left;vertical-align:top;overflow-wrap:anywhere;white-space:pre-wrap}"
            "th{background:#f1f1f1}.table-scroll{overflow:auto}a{color:inherit}section{break-inside:avoid}"
            "@media print{body{max-width:none;margin:0;padding:0}section{break-inside:auto}}</style>"
            "<header><h1>" + escape(title) + "</h1><p>" + escape(SCOPE) + "</p><p>" + escape(cost["basis"]) +
            '.</p><p><a href="comparison.json">Complete comparison JSON</a> · '
            '<a href="intervention-changes.csv">Field changes CSV</a> · '
            '<a href="COMPARISON.json">Original file inventory</a></p></header>' + body + "</html>\n")
    markdown = ["# " + title, "", SCOPE, "", cost["basis"] + ".", ""]
    for name, headings, rows in sections:
        markdown.extend(["## " + name, ""])
        if not rows:
            markdown.extend(["No changes in this section.", ""])
            continue
        def md(value):
            return str(value).replace("|", "\\|").replace("\r", "").replace("\n", "<br>")
        markdown.append("| " + " | ".join(map(md, headings)) + " |")
        markdown.append("| " + " | ".join("---" for _ in headings) + " |")
        markdown.extend("| " + " | ".join(map(md, row)) + " |" for row in rows)
        markdown.append("")
    intervention_rows = []
    for row in comparison["interventions"]:
        item = {key: row[key] for key in ("id", "status", "before_position", "after_position", "position_changed",
                                         "shared_known_cost_delta_usd")}
        item.update({"before": row["before"], "after": row["after"]})
        intervention_rows.append(item)
    return {
        "START.html": html,
        "comparison.md": "\n".join(markdown) + "\n",
        "comparison.json": json.dumps(comparison, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False) + "\n",
        "intervention-changes.csv": _csv(
            ["intervention_id", "field", "before_present", "after_present", "before", "after"], changes),
        "interventions.csv": _csv(
            ["id", "status", "before_position", "after_position", "position_changed",
             "shared_known_cost_delta_usd", "before", "after"], intervention_rows),
        "plan-changes.csv": _csv(["field", "before_present", "after_present", "before", "after"],
                                 comparison["plan_changes"]),
        "selection-changes.csv": _csv(["field", "before_present", "after_present", "before", "after"],
                                      comparison["selection_changes"]),
        "scientific-selection-changes.csv": _csv(["field", "before_present", "after_present", "before", "after"],
                                                 comparison["scientific_context"]["selection_changes"]),
    }


def _member(value):
    if not isinstance(value, str) or "\\" in value:
        raise ValueError("Original source members need relative portable paths")
    path = PurePosixPath(value)
    if path.is_absolute() or not path.parts or ".." in path.parts:
        raise ValueError("Original source member leaves its retained directory")
    return path.as_posix()


def build(workspace, selection):
    comparison = compare(workspace, selection)
    title = communities.text(selection.get("title") or
        comparison["after_plan"]["title"] + " — revision comparison", "Comparison title", required=True, maximum=300)
    retained_selection = {"schema": SCHEMA + "/selection", "format_version": FORMAT_VERSION,
                          "before_plan_id": comparison["before_plan"]["id"],
                          "after_plan_id": comparison["after_plan"]["id"], "title": title}
    report_ids = selection.get("report_ids", [])
    if not isinstance(report_ids, list) or len(report_ids) != len(set(report_ids)):
        raise ValueError("Select each retained Community report once")
    reports = []
    for report_id in report_ids:
        report = workspace._get(communities.REPORT_KIND, identifier(report_id))
        if report.get("plan_id") not in {retained_selection["before_plan_id"], retained_selection["after_plan_id"]}:
            raise ValueError("Attach reports from the two selected original plan editions")
        if report.get("table_id") != comparison["table_id"]:
            raise ValueError("An attached report belongs to another Community source table")
        reports.append(report)
    retained_selection["report_ids"] = [row["id"] for row in reports]
    key = digest(retained_selection)
    directory = workspace.root / KIND / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".comparison.lock"):
        files = {}
        def emit(name, body):
            name = _member(name)
            if isinstance(body, str):
                body = body.encode("utf-8")
            path = directory.joinpath(*PurePosixPath(name).parts)
            path.parent.mkdir(parents=True, exist_ok=True)
            atomic_bytes(path, body, immutable=True)
            files[name] = describe_file(workspace.root, path, title=name)
        for name, body in _render(comparison, title).items():
            emit(name, body)
        lineage = _lineage(workspace, retained_selection["before_plan_id"], retained_selection["after_plan_id"])
        for plan in lineage:
            emit("plans/" + plan["id"] + ".json",
                 (workspace.root / communities.PLAN_KIND / (plan["id"] + ".json")).read_bytes())
            imported = plan.get("intervention_import")
            if imported:
                source = imported["source"]
                body = source["text"].encode("utf-8")
                if len(body) != source["bytes"] or hashlib.sha256(body).hexdigest() != source["sha256"]:
                    raise ValueError("A retained received intervention CSV changed")
                emit("received-csv/" + plan["id"] + "/" + _member(source["filename"]), body)
            regional = plan["context"]["snapshots"].get("watershed_context")
            if regional:
                emit("regional/" + identifier(regional["report_id"]) + ".json",
                     verify_file(workspace.root, regional["report_file"]).read_bytes())
        table = communities.get_table(workspace, comparison["table_id"])
        emit("tables/" + table["id"] + ".json",
             (workspace.root / communities.TABLE_KIND / (table["id"] + ".json")).read_bytes())
        original, entry = workspace.source_file(table["source"]["collection_id"], table["source"]["source_id"])
        member = _member(entry["body"].get("view_path", entry["body"]["filename"]))
        root = original
        for _ in PurePosixPath(member).parts:
            root = root.parent
        for item in [entry["body"], *entry.get("companions", [])]:
            name = _member(item.get("view_path", item["filename"]))
            path = root.joinpath(*PurePosixPath(name).parts).resolve()
            if not path.is_relative_to(root.resolve()) or not path.is_file():
                raise ValueError("An original Community source companion leaves its retained view")
            body = path.read_bytes()
            if len(body) != item["bytes"] or hashlib.sha256(body).hexdigest() != item["sha256"]:
                raise ValueError("An original Community source member changed")
            emit("source/" + name, body)
        for report in reports:
            emit("reports/" + report["id"] + "/record.json",
                 (workspace.root / communities.REPORT_KIND / (report["id"] + ".json")).read_bytes())
            for name, item in report.get("files", {}).items():
                emit("reports/" + report["id"] + "/" + _member(name),
                     verify_file(workspace.root, item).read_bytes())
        inventory = {"schema": SCHEMA + "/files", "selection": retained_selection,
                     "project_id": workspace.project["id"], "files": deepcopy(files),
                     "comparison_sha256": digest(comparison)}
        emit("COMPARISON.json", canonical(inventory) + b"\n")
        archive_path = directory / "community-revision-comparison.zip"
        expected_members = set(files)
        if not archive_path.exists():
            temporary = directory / ".community-revision-comparison.zip.tmp"
            with zipfile.ZipFile(temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
                for name in sorted(files):
                    path = verify_file(workspace.root, files[name])
                    info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
                    info.compress_type = zipfile.ZIP_DEFLATED
                    info.external_attr = 0o100644 << 16
                    with path.open("rb") as source, archive.open(info, "w") as target:
                        for block in iter(lambda: source.read(1024 * 1024), b""):
                            target.write(block)
            temporary.replace(archive_path)
        with zipfile.ZipFile(archive_path) as archive:
            if set(archive.namelist()) != expected_members or len(archive.namelist()) != len(expected_members):
                raise ValueError("The retained revision handover has a different original file inventory")
            for name, item in files.items():
                checksum, size = hashlib.sha256(), 0
                with archive.open(name) as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b""):
                        size += len(block)
                        checksum.update(block)
                if size != item["bytes"] or checksum.hexdigest() != item["sha256"]:
                    raise ValueError("The retained revision handover changed: " + name)
        files[archive_path.name] = describe_file(workspace.root, archive_path,
                                                title="Complete Community revision handover")
        return workspace._save(KIND, {"title": title, "format_version": FORMAT_VERSION,
            "selection_id": key, "selection": retained_selection, "comparison": comparison,
            "comparison_sha256": digest(comparison), "files": files})


def inspect(workspace, key):
    record = workspace._get(KIND, identifier(key))
    current = compare(workspace, record["selection"])
    if current != record["comparison"] or digest(current) != record["comparison_sha256"]:
        raise ValueError("The saved comparison differs from its original plan revisions")
    for item in record["files"].values():
        verify_file(workspace.root, item)
    return record


def catalog(workspace):
    return [{"id": row["id"], "title": row["title"], "selection": row["selection"],
             "before_plan": row["comparison"]["before_plan"],
             "after_plan": row["comparison"]["after_plan"],
             "counts": row["comparison"]["counts"], "costs": row["comparison"]["costs"]}
            for row in workspace._list(KIND)]


def inspect_archive(path):
    """Reopen the handover independently from its exact archived original plans."""
    with zipfile.ZipFile(path) as archive:
        names = archive.namelist()
        if len(names) != len(set(names)):
            raise ValueError("The revision handover repeats an original file member")
        for name in names:
            _member(name)
        inventory = json.loads(archive.read("COMPARISON.json").decode("utf-8"))
        if inventory.get("schema") != SCHEMA + "/files":
            raise ValueError("Choose a complete Community revision handover")
        files = inventory.get("files")
        if not isinstance(files, dict) or set(names) != set(files) | {"COMPARISON.json"}:
            raise ValueError("The revision handover file inventory is incomplete")
        for name, item in files.items():
            checksum, size = hashlib.sha256(), 0
            with archive.open(name) as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    size += len(block)
                    checksum.update(block)
            if size != item["bytes"] or checksum.hexdigest() != item["sha256"]:
                raise ValueError("The revision handover changed an original file: " + name)
        comparison = json.loads(archive.read("comparison.json").decode("utf-8"))
        def original(kind, key):
            key = identifier(key)
            value = json.loads(archive.read(kind + "/" + key + ".json").decode("utf-8"))
            if digest(value) != key:
                raise ValueError("A handed-over original saved record changed")
            return {**value, "id": key}
        lineage = [original("plans", row["id"]) for row in comparison["lineage"]]
        table = original("tables", comparison["table_id"])
        reconstructed = compare_saved(inventory["project_id"], lineage, table)
        if reconstructed != comparison or digest(reconstructed) != inventory["comparison_sha256"]:
            raise ValueError("The handover differs from its original saved plan revisions")
        source_body = table["source"]["original"]
        source_member = "source/" + _member(source_body.get("view_path", source_body["filename"]))
        retained_source = files.get(source_member, {})
        if (retained_source.get("bytes") != source_body["bytes"]
                or retained_source.get("sha256") != source_body["sha256"]
                or source_body["sha256"] != table["source"]["sha256"]):
            raise ValueError("The handover changed the original Community source binding")
        for plan in lineage:
            imported = plan.get("intervention_import")
            if imported:
                original_csv = imported["source"]
                member = "received-csv/" + plan["id"] + "/" + _member(original_csv["filename"])
                body = archive.read(member)
                if (body != original_csv["text"].encode("utf-8")
                        or len(body) != original_csv["bytes"]
                        or hashlib.sha256(body).hexdigest() != original_csv["sha256"]):
                    raise ValueError("The handover changed an original received intervention CSV")
            regional = plan["context"]["snapshots"].get("watershed_context")
            if regional:
                member = "regional/" + identifier(regional["report_id"]) + ".json"
                if any(files.get(member, {}).get(key) != regional["report_file"][key] for key in ("bytes", "sha256")):
                    raise ValueError("The handover changed an original regional context report")
        selection = inventory["selection"]
        for report_id in selection.get("report_ids", []):
            report_id = identifier(report_id)
            report = json.loads(archive.read("reports/" + report_id + "/record.json").decode("utf-8"))
            if (digest(report) != report_id or report.get("table_id") != table["id"]
                    or report.get("plan_id") not in {lineage[0]["id"], lineage[-1]["id"]}):
                raise ValueError("The handover changed an attached original report binding")
            for name, expected in report["files"].items():
                member = "reports/" + report_id + "/" + _member(name)
                if any(files.get(member, {}).get(key) != expected[key] for key in ("bytes", "sha256")):
                    raise ValueError("The handover changed an attached report member")
        if (selection.get("before_plan_id") != lineage[0]["id"]
                or selection.get("after_plan_id") != lineage[-1]["id"]):
            raise ValueError("The handover selection differs from its original revision chain")
        return {"schema": SCHEMA + "/receiving", "comparison": reconstructed,
                "selection": selection, "files": len(files), "original_plans": len(lineage),
                "identity": "MATCH"}
