"""Compare retained grant-plan revisions and carry their native source plans."""
from copy import deepcopy
from decimal import Decimal, InvalidOperation, localcontext
from hashlib import sha256
from html import escape
import io
import json
import re
from urllib.parse import parse_qs
import zipfile

from model import Problem, canonical, csv_bytes, digest

SCHEMA = "stellar-forge.sf47.plan-comparison.v1"
PLAN_ID = re.compile(r"plan-[a-f0-9]{32}")
DAILY_FIELDS = ("accruedUsd", "plannedOutflowUsd", "conditionalInflowUsd",
                "cashGapUsd", "gapAfterCapitalInputUsd", "accruedUnpaidUsd")
METRICS = (
    ("award", "Award request", "USD", ("report", "originalModel", "award_request_usd")),
    ("cost", "Total planned cost", "USD", ("report", "cash", "totalCostUsd")),
    ("hours", "Work-package hours", "hours", ("report", "capacity", "totalHours")),
    ("unassigned", "Unassigned hours", "hours", ("report", "capacity", "unassignedHours")),
    ("project-end", "Project end", "day", ("scenario", "project_end_day")),
    ("native-gap", "Native accrual prefunding gap", "USD", ("report", "originalModel", "peak_prefunding_gap_usd")),
    ("native-gap-day", "Native accrual peak day", "day", ("report", "originalModel", "peak_gap_day")),
    ("cash-gap", "Payment-timing peak cash gap", "USD", ("report", "cash", "peakCashGapUsd")),
    ("cash-gap-day", "Payment-timing peak day", "day", ("report", "cash", "peakCashGapDay")),
    ("capital", "Capital input", "USD", ("report", "cash", "capitalInputUsd")),
    ("remaining-gap", "Gap after capital input", "USD", ("report", "cash", "gapAfterCapitalInputUsd")),
    ("last-day", "Last modeled day", "day", ("report", "cash", "lastModeledDay")),
)
ABSENT = object()


def _revision(value, label):
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= 1000000:
        raise Problem(label + " must be an explicit saved revision from 1 to 1000000.", 422, "COMPARISON_SELECTION")
    return value


def _plan_id(value):
    if not isinstance(value, str) or PLAN_ID.fullmatch(value) is None:
        raise Problem("Select an original saved plan ID.", 422, "COMPARISON_SELECTION")
    return value


def _path(value, keys):
    for key in keys:
        if not isinstance(value, dict) or key not in value:
            return None
        value = value[key]
    return value


def _difference(before, after):
    if before is None or after is None or isinstance(before, bool) or isinstance(after, bool):
        return None
    try:
        with localcontext() as context:
            context.prec = 80
            left, right = Decimal(str(before)), Decimal(str(after))
            if not left.is_finite() or not right.is_finite():
                return None
            return format(right - left, "f")
    except (InvalidOperation, ValueError):
        return None


def _pointer(part):
    return str(part).replace("~", "~0").replace("/", "~1")


def _changes(before, after, path=""):
    """Exact JSON changes, including array order, unknown fields, and absent/null."""
    if before is ABSENT or after is ABSENT:
        return [{"path": path, "kind": "added" if before is ABSENT else "removed",
                 "beforePresent": before is not ABSENT, "afterPresent": after is not ABSENT,
                 "before": None if before is ABSENT else deepcopy(before),
                 "after": None if after is ABSENT else deepcopy(after)}]
    if type(before) is type(after) and isinstance(before, dict):
        result = []
        for key in sorted(set(before) | set(after)):
            result.extend(_changes(before.get(key, ABSENT), after.get(key, ABSENT), path + "/" + _pointer(key)))
        return result
    if type(before) is type(after) and isinstance(before, list):
        result = []
        for index in range(max(len(before), len(after))):
            result.extend(_changes(before[index] if index < len(before) else ABSENT,
                                   after[index] if index < len(after) else ABSENT, path + "/" + str(index)))
        return result
    if type(before) is type(after) and before == after:
        return []
    return [{"path": path, "kind": "changed", "beforePresent": True, "afterPresent": True,
             "before": deepcopy(before), "after": deepcopy(after)}]


def _paired(before, after):
    result = []
    for key in list(after) + [key for key in before if key not in after]:
        left, right = before.get(key, ABSENT), after.get(key, ABSENT)
        changes = _changes(left, right)
        result.append({"id": str(key), "state": "added" if left is ABSENT else "removed" if right is ABSENT
                       else "changed" if changes else "unchanged",
                       "before": None if left is ABSENT else left, "after": None if right is ABSENT else right,
                       "changes": changes})
    return result


def _packages(snapshot):
    planning = snapshot["planning"]
    result = {}
    for row in snapshot["scenario"].get("future_costs", []):
        key = row["id"]
        result[key] = {"workPackage": row,
                       "pricing": planning.get("pricing", {}).get(key),
                       "payment": planning.get("payments", {}).get(key),
                       "assignments": [item for item in planning.get("assignments", []) if item.get("costId") == key]}
    return result


def _milestones(snapshot):
    payouts = snapshot["report"].get("originalModel", {}).get("payouts", [])
    notes = snapshot["planning"].get("deliveryNotes", {})
    return {str(row["tranche"]): {"milestone": row, "deliveryNote": notes.get(str(row["tranche"])),
                                "retainedPayouts": [item for item in payouts if item.get("tranche") == row["tranche"]]}
            for row in snapshot["scenario"].get("milestones", [])}


def _contributors(snapshot):
    planning = snapshot["planning"]
    capacity = snapshot["report"].get("capacity", {}).get("contributors", [])
    return {row["id"]: {"contributor": row,
                       "assignments": [item for item in planning.get("assignments", []) if item.get("contributorId") == row["id"]],
                       "retainedCapacity": next((item for item in capacity if item.get("id") == row["id"]), None)}
            for row in planning.get("contributors", [])}


def _identity(snapshot):
    return {key: deepcopy(snapshot[key]) for key in
            ("id", "name", "revision", "savedAt", "note", "contentSha256", "source")} | {
                "reportSha256": digest(snapshot["report"]),
                "calculatorSha256": snapshot["report"].get("calculatorSha256")}


def _snapshot(workspace, plan_id, revision):
    snapshot = deepcopy(workspace._read(plan_id, revision))
    snapshot.pop("currentRevision", None)
    return snapshot


def _build(before, after):
    changes = []
    for area in ("scenario", "planning", "report"):
        changes.extend({"area": area, **row} for row in _changes(before[area], after[area], "/" + area))
    metrics = []
    for key, label, unit, path in METRICS:
        left, right = _path(before, path), _path(after, path)
        metrics.append({"id": key, "label": label, "unit": unit, "before": left, "after": right,
                        "delta": _difference(left, right), "path": "/" + "/".join(path)})
    for key, label, field in (("overloaded-contributors", "Contributors with overloaded days", "contributors"),
                              ("overloaded-days", "Contributor days above capacity", "days")):
        values = []
        for side in (before, after):
            rows = side["report"].get("capacity", {}).get("contributors", [])
            values.append(sum(1 if field == "contributors" else row.get("overloadedDays", 0)
                              for row in rows if row.get("overloadedDays", 0) > 0))
        metrics.append({"id": key, "label": label, "unit": field, "before": values[0], "after": values[1],
                        "delta": _difference(*values), "path": "/report/capacity/contributors"})
    daily_maps = [{row["day"]: row for row in side["report"].get("cash", {}).get("days", [])}
                  for side in (before, after)]
    days = []
    for day in sorted(set(daily_maps[0]) | set(daily_maps[1])):
        left, right = daily_maps[0].get(day), daily_maps[1].get(day)
        days.append({"day": day, "before": left, "after": right,
                     "delta": {key: _difference(left.get(key) if left else None, right.get(key) if right else None)
                               for key in DAILY_FIELDS}})
    groups = {
        "workPackages": _paired(_packages(before), _packages(after)),
        "milestones": _paired(_milestones(before), _milestones(after)),
        "contributors": _paired(_contributors(before), _contributors(after)),
        "delivery": _paired({"delivery": {"acceptancePlan": before["scenario"].get("deployment_acceptance_plan"),
                                         "deliveryNotes": before["planning"].get("deliveryNotes", {}),
                                         "retainedDeliveryPlan": before["report"].get("deliveryPlan")}},
                            {"delivery": {"acceptancePlan": after["scenario"].get("deployment_acceptance_plan"),
                                         "deliveryNotes": after["planning"].get("deliveryNotes", {}),
                                         "retainedDeliveryPlan": after["report"].get("deliveryPlan")}}),
    }
    result = {
        "schema": SCHEMA,
        "before": _identity(before), "after": _identity(after),
        "basis": {
            "delta": "after - before",
            "reportBasis": "Original reports retained with the selected saved revisions.",
            "dailyBasis": "Rows align by project day. Both original calendar dates are retained. Missing modeled days remain absent.",
            "sameOriginalSource": before["source"]["sha256"] == after["source"]["sha256"],
            "sameCalculator": before["report"].get("calculatorSha256") == after["report"].get("calculatorSha256"),
            "sameInputs": before["contentSha256"] == after["contentSha256"],
        },
        "summary": {
            "inputChanges": sum(row["area"] != "report" for row in changes),
            "reportChanges": sum(row["area"] == "report" for row in changes),
            "groups": {key: {state: sum(row["state"] == state for row in rows)
                             for state in ("added", "removed", "changed", "unchanged")}
                       for key, rows in groups.items()},
            "modeledDaysBefore": len(daily_maps[0]), "modeledDaysAfter": len(daily_maps[1]),
        },
        "metrics": metrics, "groups": groups, "changes": changes, "days": days,
        "snapshots": {"before": before, "after": after},
    }
    return {**result, "comparisonSha256": digest(result)}


def compare(workspace, plan_id, from_revision, to_revision, to_plan_id=None, expected_sha256=None):
    plan_id = _plan_id(plan_id)
    to_plan_id = _plan_id(to_plan_id if to_plan_id is not None else plan_id)
    from_revision = _revision(from_revision, "Before revision")
    to_revision = _revision(to_revision, "After revision")
    with workspace.mutex:
        result = _build(_snapshot(workspace, plan_id, from_revision),
                        _snapshot(workspace, to_plan_id, to_revision))
    if expected_sha256 is not None:
        if not isinstance(expected_sha256, str) or re.fullmatch(r"[a-f0-9]{64}", expected_sha256) is None:
            raise Problem("Comparison SHA-256 must contain 64 lowercase hexadecimal characters.", 422, "COMPARISON_SELECTION")
        if result["comparisonSha256"] != expected_sha256:
            raise Problem("The comparison differs from the selected report. Read the saved revision pair again.", 409, "COMPARISON_CHANGED")
    return result


def _json(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def changes_csv(report):
    headers = ["area", "path", "kind", "beforePresent", "afterPresent", "beforeJson", "afterJson"]
    return csv_bytes(headers, [{**row, "beforeJson": canonical(row["before"]) if row["beforePresent"] else "",
                               "afterJson": canonical(row["after"]) if row["afterPresent"] else ""}
                              for row in report["changes"]])


def impact_csv(report):
    return csv_bytes(["id", "label", "unit", "before", "after", "delta", "path"], report["metrics"])


def daily_csv(report):
    headers = ["day", "beforePresent", "afterPresent", "beforeDate", "afterDate"]
    headers += [side + "_" + key for key in DAILY_FIELDS for side in ("before", "after", "delta")]
    records = []
    for row in report["days"]:
        record = {"day": row["day"], "beforePresent": row["before"] is not None, "afterPresent": row["after"] is not None,
                  "beforeDate": (row["before"] or {}).get("date"), "afterDate": (row["after"] or {}).get("date")}
        for key in DAILY_FIELDS:
            for side in ("before", "after", "delta"):
                record[side + "_" + key] = (row[side] or {}).get(key)
        records.append(record)
    return csv_bytes(headers, records)


def render_html(report):
    def text(value):
        return escape("—" if value is None else str(value), quote=True)

    def table(headers, rows):
        return "<div class='scroll'><table><thead><tr>" + "".join("<th>" + text(item) + "</th>" for item in headers) + \
               "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + item + "</td>" for item in row) + "</tr>" for row in rows) + \
               "</tbody></table></div>"

    def original(value, present=True):
        if not present:
            return "<span class='muted'>Absent</span>"
        return "<details><summary>Complete value</summary><pre>" + escape(_json(value).decode()) + "</pre></details>"

    parts = ["<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width, initial-scale=1'>",
             "<title>Saved plan comparison</title><style>body{font:15px system-ui,sans-serif;margin:2rem auto;padding:0 1rem;max-width:1200px;color:#202428;background:#fff}h1,h2{font-weight:600}h2{margin-top:2rem}.scroll{overflow:auto}table{border-collapse:collapse;width:100%;font-size:14px}th,td{padding:.6rem;border:1px solid #d5d8da;text-align:left;vertical-align:top}th{background:#f1f2f3}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px ui-monospace,monospace;max-width:60rem}.muted{color:#596168}code{overflow-wrap:anywhere}@media print{body{max-width:none;margin:0}.scroll{overflow:visible}details{break-inside:avoid}}</style><body>",
             "<h1>Saved plan comparison</h1>",
             "<p>Changes read from two explicitly selected saved revisions. Monetary and capacity deltas use the original retained reports.</p>",
             "<p>Comparison SHA-256: <code>" + text(report["comparisonSha256"]) + "</code></p>",
             "<h2>Selected source</h2>",
             table(["Side", "Plan", "Revision", "Saved", "Note", "Input SHA-256", "Report SHA-256", "Original source SHA-256", "Calculator SHA-256"],
                   [[text(side), text(report[side]["name"]), text(report[side]["revision"]), text(report[side]["savedAt"]),
                     text(report[side]["note"]), text(report[side]["contentSha256"]), text(report[side]["reportSha256"]),
                     text(report[side]["source"]["sha256"]), text(report[side]["calculatorSha256"])] for side in ("before", "after")]),
             "<p>" + text(report["basis"]["reportBasis"]) + " Deltas are after minus before; an absent or unset value has no numeric delta.</p>",
             "<p>Same original source: " + text(report["basis"]["sameOriginalSource"]) +
             ". Same calculator: " + text(report["basis"]["sameCalculator"]) + ".</p>",
             "<h2>Funding and capacity impact</h2>",
             table(["Measure", "Unit", "Before", "After", "Change"],
                   [[text(row[key]) for key in ("label", "unit", "before", "after", "delta")] for row in report["metrics"]])]
    labels = {"workPackages": "Work packages and payments", "milestones": "Milestones and retained payouts",
              "contributors": "Contributors and retained capacity", "delivery": "Delivery scope"}
    for key, rows in report["groups"].items():
        parts += ["<h2>" + labels[key] + "</h2>",
                  table(["ID", "Change", "Before", "After"],
                        [[text(row["id"]), text(row["state"]), original(row["before"], row["state"] != "added"),
                          original(row["after"], row["state"] != "removed")] for row in rows])]
    parts += ["<h2>All saved JSON field changes</h2>",
              "<p>Paths use JSON Pointer. Array positions preserve original ordering. Added and removed values retain their complete content.</p>",
              table(["Area", "Path", "Change", "Before", "After"],
                    [[text(row["area"]), text(row["path"]), text(row["kind"]), original(row["before"], row["beforePresent"]),
                      original(row["after"], row["afterPresent"])] for row in report["changes"]]),
              "<h2>Daily retained cash comparison</h2><p>" + text(report["basis"]["dailyBasis"]) + "</p>",
              table(["Day", "Before date", "After date", "Before cash gap (USD)", "After cash gap (USD)", "Change (USD)",
                     "Complete before day", "Complete after day"],
                    [[text(row["day"]), text((row["before"] or {}).get("date")), text((row["after"] or {}).get("date")),
                      text((row["before"] or {}).get("cashGapUsd")), text((row["after"] or {}).get("cashGapUsd")),
                      text(row["delta"]["cashGapUsd"]), original(row["before"], row["before"] is not None),
                      original(row["after"], row["after"] is not None)] for row in report["days"]]),
              "<h2>Complete selected snapshots</h2>", original(report["snapshots"]), "</body></html>"]
    return "\n".join(parts).encode("utf-8")


def export_bundle(workspace, plan_id, from_revision, to_revision, to_plan_id=None, expected_sha256=None):
    with workspace.mutex:
        report = compare(workspace, plan_id, from_revision, to_revision, to_plan_id, expected_sha256)
        files = {
            "comparison.json": _json(report), "report.html": render_html(report),
            "changes.csv": changes_csv(report), "impact.csv": impact_csv(report), "daily.csv": daily_csv(report),
            "before.json": _json(report["snapshots"]["before"]), "after.json": _json(report["snapshots"]["after"]),
        }
        plans = {}
        for side in ("before", "after"):
            selected = report[side]
            name = "plans/" + selected["id"] + ".zip"
            if name not in files:
                files[name] = workspace.export(selected["id"])
            plans[side] = {"path": name, "originalPlanId": selected["id"], "selectedRevision": selected["revision"],
                           "selectedContentSha256": selected["contentSha256"]}
        files["CONTENTS.json"] = _json({"schema": SCHEMA + ".package", "comparisonSha256": report["comparisonSha256"],
                                      "nativePlans": plans})
        files["README.txt"] = (
            "Saved grant plan comparison\n\n"
            "Open report.html for the full readable comparison. comparison.json retains every selected input and report.\n"
            "changes.csv contains every changed JSON value, impact.csv contains exact decimal deltas, and daily.csv contains all modeled days.\n\n"
            "Continue the original plans:\n"
            "1. Extract this ZIP. CONTENTS.json identifies each selected plan ZIP and revision.\n"
            "2. In the Grant workspace, import each unique ZIP under plans/ through Import planning scenario or workspace.\n"
            "   Each is the original native export, including its original source and complete retained revision history at export.\n"
            "   Import allocates a new local plan ID. Use the IDs returned by import; revision numbers remain available.\n"
            "3. Open Compare saved plans, select the imported plans and the revision numbers in CONTENTS.json.\n"
            "   Source input/report hashes allow the imported selections to be matched to this comparison.\n\n"
            "comparisonSha256 identifies the retained comparison content. Native plan ZIPs also carry their own original manifests.\n"
            "The top-level MANIFEST.json gives byte sizes and SHA-256 values for every other member.\n"
        ).encode("utf-8")
        files["MANIFEST.json"] = _json({"schema": SCHEMA + ".manifest", "comparisonSha256": report["comparisonSha256"],
                                      "files": [{"path": name, "bytes": len(raw), "sha256": sha256(raw).hexdigest()}
                                                for name, raw in sorted(files.items())]})
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, raw in sorted(files.items()):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            archive.writestr(info, raw)
    return stream.getvalue()


def read_http(handler, parsed):
    match = re.fullmatch(r"/api/plans/(plan-[a-f0-9]{32})/comparison(?:/(export\.zip|report\.html|changes\.csv|impact\.csv|daily\.csv))?", parsed.path)
    if match is None:
        return False
    values = parse_qs(parsed.query, keep_blank_values=True)
    allowed = {"fromRevision", "toRevision", "toPlanId", "expectedComparisonSha256"}
    if set(values) - allowed or any(len(value) != 1 for value in values.values()):
        raise Problem("Comparison requires one value per supported selection parameter.", 422, "COMPARISON_SELECTION")
    revisions = []
    for key in ("fromRevision", "toRevision"):
        raw = values.get(key, [""])[0]
        if re.fullmatch(r"[0-9]{1,7}", raw) is None:
            raise Problem(key + " must identify an explicit saved revision.", 422, "COMPARISON_SELECTION")
        revisions.append(int(raw))
    plan_id, action = match.groups()
    args = (handler.server.workspace, plan_id, *revisions, values.get("toPlanId", [None])[0],
            values.get("expectedComparisonSha256", [None])[0])
    if action == "export.zip":
        handler.send(200, export_bundle(*args), "application/zip", "sf47-plan-comparison.zip")
        return True
    report = compare(*args)
    formats = {"report.html": (render_html, "text/html; charset=utf-8"),
               "changes.csv": (changes_csv, "text/csv; charset=utf-8"),
               "impact.csv": (impact_csv, "text/csv; charset=utf-8"),
               "daily.csv": (daily_csv, "text/csv; charset=utf-8")}
    if action in formats:
        render, mime = formats[action]
        handler.send(200, render(report), mime, "sf47-comparison-" + action)
    else:
        handler.send(200, report)
    return True
