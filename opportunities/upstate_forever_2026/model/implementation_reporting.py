"""CSV and standalone HTML reports that retain original implementation records."""
from __future__ import annotations

import csv
import datetime as dt
import html
import io
import json

from .implementation_schema import (
    ImplementationError, canonical_bytes, validate_plan, summarize_plan,
)

TASK_FIELDS = (
    "id", "title", "candidate_id", "phase", "assignee", "status", "progress_pct",
    "duration_days", "start_not_before", "source_due_date", "briefing_entry", "depends_on", "start", "finish_exclusive",
    "last_work_date", "schedule_state", "overdue", "issue_codes",
    "budget_minor", "commitment_minor", "actual_minor", "notes", "evidence_refs",
)
BUDGET_FIELDS = (
    "id", "task_id", "kind", "label", "amount_minor", "amount_usd", "currency",
    "date", "reference",
)
VISIT_FIELDS = (
    "id", "site_id", "site_label", "monitoring_plan_id", "planned_date",
    "visited_at", "observer", "status", "overdue", "notes", "evidence_refs",
)
OBSERVATION_FIELDS = (
    "id", "activity_id", "visit_id", "site_id", "site_label", "sample_id",
    "collected_at", "parameter", "result_type", "value", "original_text",
    "unit", "basis", "fraction", "qualifier", "detection_limit",
    "quantitation_limit", "method", "method_context", "method_name", "qa_status", "notes", "custody_ref",
    "laboratory_source_id", "original_csv_sha256", "original_csv_record",
    "original_line_start", "original_line_end", "mapping_sha256", "import_operation_id",
)
SITE_FIELDS = ("id", "label", "latitude", "longitude", "coordinate_reference_system",
               "candidate_id", "source_ref")
MONITOR_FIELDS = (
    "id", "title", "objective", "site_ids", "parameters", "method_ref",
    "frequency", "notes",
)
ACTIVITY_FIELDS = (
    "id", "visit_id", "site_id", "kind", "sample_id", "collected_at",
    "method", "custody_ref", "notes",
)


def _amount(amount_minor: int) -> str:
    whole, cents = divmod(amount_minor, 100)
    return f"{whole}.{cents:02d}"


def _money(amount_minor: int) -> str:
    whole, cents = divmod(amount_minor, 100)
    return "$" + f"{whole:,}.{cents:02d}"


def _report_rows(document: dict, table: str, as_of: str | None = None):
    plan = validate_plan(document)
    summary = summarize_plan(plan, as_of)
    sites = {row["id"]: row for row in plan["sites"]}
    activities = {row["id"]: row for row in plan["activities"]}
    if table == "tasks":
        scheduled = {row["id"]: row for row in summary["schedule"]["tasks"]}
        rows = []
        for task in plan["tasks"]:
            row = dict(task, **{
                key: value for key, value in scheduled[task["id"]].items()
                if key not in ("id", "title", "status", "duration_days")
            })
            values = summary["budget_by_task"].get(task["id"], {})
            for kind in ("budget", "commitment", "actual"):
                row[kind + "_minor"] = values.get(kind, 0)
            rows.append(row)
        return TASK_FIELDS, rows
    if table == "budget":
        return BUDGET_FIELDS, [
            dict(line, amount_usd=_amount(line["amount_minor"]), currency=plan["currency"])
            for line in plan["budget_lines"]
        ]
    if table == "visits":
        return VISIT_FIELDS, [
            dict(visit, site_label=sites[visit["site_id"]]["label"],
                 overdue=visit["id"] in summary["overdue_visit_ids"])
            for visit in plan["visits"]
        ]
    if table == "observations":
        rows = []
        for observation in plan["observations"]:
            activity = activities[observation["activity_id"]]
            row = dict(observation)
            for key in ("visit_id", "site_id", "sample_id", "collected_at", "custody_ref"):
                row[key] = activity.get(key)
            row["site_label"] = sites[activity["site_id"]]["label"]
            source, _ = _field_source_context(observation)
            for exported, original in (
                    ("laboratory_source_id", "source_link_id"),
                    ("original_csv_sha256", "csv_sha256"),
                    ("original_csv_record", "record"),
                    ("original_line_start", "line_start"),
                    ("original_line_end", "line_end"),
                    ("mapping_sha256", "mapping_sha256"),
                    ("import_operation_id", "operation_id")):
                row[exported] = source.get(original)
            rows.append(row)
        return OBSERVATION_FIELDS, rows
    if table == "sites":
        return SITE_FIELDS, plan["sites"]
    if table == "monitoring_plans":
        return MONITOR_FIELDS, plan["monitoring_plans"]
    if table == "activities":
        return ACTIVITY_FIELDS, plan["activities"]
    raise ImplementationError(
        "Unknown report table. Choose tasks, budget, visits, observations, "
        "sites, monitoring_plans or activities."
    )


def _csv_cell(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        value = canonical_bytes(value).decode("utf-8")
    if type(value) is bool:
        return "true" if value else "false"
    if isinstance(value, str):
        # Protect spreadsheet opening; plan.json always retains the exact original text.
        if value.lstrip().startswith(("=", "+", "-", "@", "\t", "\r")):
            return "'" + value
        return value
    return value


def report_csv(document: dict, table: str = "tasks", as_of: str | None = None) -> str:
    fields, rows = _report_rows(document, table, as_of)
    output = io.StringIO(newline="")
    writer = csv.writer(output, lineterminator="\r\n")
    writer.writerow(list(fields) + ["extra_json"])
    for row in rows:
        extra = {key: value for key, value in row.items() if key not in fields}
        writer.writerow([_csv_cell(row.get(key)) for key in fields] + [
            _csv_cell(extra) if extra else ""
        ])
    return output.getvalue()


def _text(value) -> str:
    if value is None:
        return "—"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    if type(value) is bool:
        return "Yes" if value else "No"
    return str(value)


def _group(rows) -> str:
    """Readable labelled values without changing original values or source units."""
    return "\n".join(
        str(label) + ": " + _text(value)
        for label, value in rows
        if value is not None and value != "" and value != []
    )


def _table(headers, rows) -> str:
    header = "<tr>" + "".join("<th scope=\"col\">" + html.escape(str(item)) + "</th>"
                              for item in headers) + "</tr>"
    rows = list(rows)
    if not rows:
        body = "<tr><td colspan=\"" + str(len(headers)) + "\">No records entered.</td></tr>"
    else:
        body = "".join("<tr>" + "".join(
            "<td>" + html.escape(_text(value)) + "</td>" for value in row
        ) + "</tr>" for row in rows)
    return "<div class=\"table-scroll\"><table><thead>" + header + "</thead><tbody>" + body + "</tbody></table></div>"


def _details(label, value) -> str:
    return ("<details><summary>" + html.escape(label) + "</summary><pre>" +
            html.escape(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False)) +
            "</pre></details>")



def _field_source_context(row):
    """Read retained original metadata without replacing the native definition."""
    source = row.get("lab_source")
    source = source if isinstance(source, dict) else {}
    original = source.get("original_row")
    original = original if isinstance(original, dict) else {}
    return source, original


def _field_science_sections(rows):
    """Describe exact saved result cohorts; compute no concentration estimates."""
    if not rows:
        return ("<section><h2>Sampling and analytical support</h2>"
                "<p>No observations are entered in this plan revision. Its sites "
                "and visits remain operational records, not measured results.</p></section>")
    cohorts, sources = {}, {}
    definition_fields = ("site_id", "parameter", "unit", "basis", "fraction",
                         "method", "method_context", "method_name")
    original_fields = ("ProjectIdentifier", "ActivityTypeCode", "ActivityMediaName",
                       "ResultAnalyticalMethod/MethodIdentifierContext",
                       "ResultAnalyticalMethod/MethodName")
    for row in rows:
        source, original = _field_source_context(row)
        definition = {key: row.get(key) for key in definition_fields}
        retained = {key: original.get(key) for key in original_fields}
        source_identity = {key: source.get(key) for key in
                           ("source_link_id", "csv_sha256", "mapping_sha256")}
        key = canonical_bytes([definition, retained, source_identity])
        if key not in cohorts:
            cohorts[key] = {"definition": definition, "retained": retained,
                            "source": source_identity, "rows": []}
        cohorts[key]["rows"].append(row)
        source_key = canonical_bytes(source_identity)
        if source_key not in sources:
            sources[source_key] = {"identity": source_identity, "rows": []}
        sources[source_key]["rows"].append(row)

    def members(items, key):
        return {row[key] for row in items if row.get(key) is not None and row.get(key) != ""}

    def counts(items, key):
        values = {}
        for row in items:
            value = row.get(key)
            if value is None or value == "":
                continue
            encoded = canonical_bytes(value)
            if encoded not in values:
                values[encoded] = [value, 0]
            values[encoded][1] += 1
        return "; ".join(_text(value) + " (" + str(count) + " rows)"
                         for value, count in values.values()) or "Not recorded"

    def period(items):
        stamps = list(members(items, "collected_at"))
        # Schema-validated native timestamps include an explicit offset.
        stamps.sort(key=lambda value: (dt.datetime.fromisoformat(value.replace("Z", "+00:00")), value))
        dated = sum(bool(row.get("collected_at")) for row in items)
        return _group((("First collection", stamps[0] if stamps else "Not recorded"),
                       ("Last collection", stamps[-1] if stamps else "Not recorded"),
                       ("Distinct original timestamps", len(stamps)),
                       ("Rows without collection time", len(items) - dated)))

    cohort_blocks = []
    for number, cohort in enumerate(cohorts.values(), 1):
        items = cohort["rows"]
        first, definition, retained = items[0], cohort["definition"], cohort["retained"]
        types = {kind: sum(row["result_type"] == kind for row in items)
                 for kind in ("numeric", "censored", "text", "missing")}
        label = _group((("Cohort", number), ("Site", first["site_label"]),
                        ("Parameter", definition["parameter"])))
        cohort_blocks.append("<h3>" + html.escape(label.replace("\n", " · ")) + "</h3>")
        cohort_blocks.append(_table(
            ("Source and analytical definition", "Retained sampling", "Original results and limits"), [(
            _group((("Site ID", definition["site_id"]),
                    ("Source project", retained["ProjectIdentifier"]),
                    ("Source activity type", retained["ActivityTypeCode"]),
                    ("Source medium", retained["ActivityMediaName"]),
                    ("Unit", definition["unit"]), ("Basis", definition["basis"]),
                    ("Fraction", definition["fraction"]),
                    ("Method", definition["method"]),
                    ("Method context", definition["method_context"]),
                    ("Method name", definition["method_name"]),
                    ("Original CSV method context", retained[
                        "ResultAnalyticalMethod/MethodIdentifierContext"]),
                    ("Original CSV method name", retained[
                        "ResultAnalyticalMethod/MethodName"]),
                    ("Source link", cohort["source"]["source_link_id"] or "No laboratory CSV binding"))),
            _group((("Distinct native activities", len(members(items, "activity_id"))),
                    ("Distinct visits", len(members(items, "visit_id"))),
                    ("Distinct sample IDs", len(members(items, "sample_id"))))) +
                    "\n" + period(items),
            _group((("Result rows", len(items)), ("Numeric", types["numeric"]),
                    ("Censored", types["censored"]), ("Text", types["text"]),
                    ("Missing", types["missing"]), ("Qualifiers", counts(items, "qualifier")),
                    ("Detection limits in cohort unit", counts(items, "detection_limit")),
                    ("Quantitation limits in cohort unit", counts(items, "quantitation_limit")),
                    ("QA status", counts(items, "qa_status")))),
        )]))
    parts = [
        '<section class="scientific-context"><h2>Sampling and analytical support</h2><p>'
        "Each cohort keeps one exact site, parameter, unit, basis, fraction, method "
        "definition, original source context and CSV/mapping identity. Blank fields "
        "remain unrecorded. Method codes from different authorities are not pooled. "
        "Native fields and explicitly labelled original CSV fields remain distinct.</p>",
        "<p>Counts describe this saved plan revision. A result row is not an "
        "independent visit: several activities or analytes can share one visit. "
        "Activities and visits can recur in different cohorts, so their cohort "
        "counts must not be added to obtain a plan-wide sampling count. The first "
        "and last collection times show observed support, not continuous coverage. "
        "The report's As of date is an operational date, not a sampling endpoint.</p>",
        "".join(cohort_blocks),
        "<p>Censored results retain null numeric values and their declared "
        "qualifiers/limits. This section reports neither substituted concentrations "
        "nor pooled means, trends, annual loads or threshold findings. Limits "
        "retain their native observation unit; the unchanged CSV and its selected "
        "column audit retain the original reported and limit-unit fields.</p>",
        "<h3>Original result source editions</h3>",
    ]
    source_rows = []
    for entry in sources.values():
        identity, items = entry["identity"], entry["rows"]
        original_records, operations = set(), set()
        for row in items:
            source, _ = _field_source_context(row)
            if source.get("record") is not None:
                original_records.add(canonical_bytes(source["record"]))
            if source.get("operation_id"):
                operations.add(source["operation_id"])
        source_rows.append((
            identity["source_link_id"] or "No laboratory CSV binding",
            identity["csv_sha256"] or "Not recorded",
            identity["mapping_sha256"] or "Not recorded",
            _group((("Retained result rows", len(items)),
                    ("Distinct original CSV records", len(original_records)),
                    ("Native activities", len(members(items, "activity_id"))),
                    ("Visits", len(members(items, "visit_id"))))),
            "\n".join(sorted(operations)) or "Not recorded",
        ))
    parts.append(_table(("Source link", "Original CSV SHA256", "Selected mapping SHA256",
                         "Retained support", "Original import operations"), source_rows))
    parts.append("</section>")
    return "".join(parts)


def _field_forms(activities) -> str:
    parts = []
    for activity in activities:
        if "form_response" not in activity:
            continue
        response = activity["form_response"]
        parts.append("<h3>Recorded form · " + html.escape(activity["id"]) + "</h3>")
        if isinstance(response, dict):
            template = response.get("template")
            template = template if isinstance(template, dict) else {}
            answers = response.get("answers")
            answers = answers if isinstance(answers, dict) else {}
            fields = template.get("fields", [])
            fields = fields if isinstance(fields, list) else []
            labels = {field["key"]: field.get("label", field["key"])
                      for field in fields if isinstance(field, dict)
                      and isinstance(field.get("key"), str)}
            parts.append("<p>" + html.escape(_text(template.get("label", template.get("id")))) +
                         " · Recorded at " + html.escape(_text(response.get("recorded_at"))) + "</p>")
            keys = list(dict.fromkeys([key for key in labels if key in answers] + list(answers)))
            rows = []
            for key in keys:
                answer = answers[key]
                structured = isinstance(answer, dict)
                rows.append((
                    key, labels.get(key, key),
                    answer.get("original_text", answer) if structured else answer,
                    answer.get("value") if structured else None,
                    answer.get("unit") if structured else None,
                ))
            parts.append(_table(("Field key", "Field", "Original response", "Numeric value", "Unit"), rows))
        parts.append(_details("Complete recorded form and template", response))
    return "".join(parts)


def _economic_candidates(plan) -> str:
    """Present the retained economic source without deriving new quantities or budgets."""
    links = {row["id"]: row for row in plan["source_links"]}
    parts = []
    for candidate in plan["candidates"]:
        source = candidate.get("source")
        if not isinstance(source, dict):
            continue
        link = links.get(source.get("source_link_id"), {})
        snapshot = link.get("snapshot")
        if not isinstance(snapshot, dict) or snapshot.get("schema") != "upstate.implementation-economic-source/v1":
            continue
        row = source.get("row_snapshot")
        binding = snapshot.get("binding")
        if not isinstance(row, dict) or not isinstance(binding, dict) or row.get("run_id") != binding.get("run_id"):
            continue
        record = lambda value: value if isinstance(value, dict) else {}
        native = record(snapshot.get("native_source"))
        zone = record(native.get("zone"))
        parts.append("<section><h3>" + html.escape(candidate["label"]) + "</h3>")
        parts.append("<p>One complete modeled scenario, retained from its original economic edition. "
                     "Positive avoided export means a reduction; negative values mean an increase. "
                     "Each pollutant keeps its own units and spatial comparison support.</p>")
        parts.append(_table(("Source field", "Retained value"), [
            ("Economic edition", binding.get("edition_id")),
            ("Native report", binding.get("report_id")),
            ("Native report SHA-256", binding.get("report_sha256")),
            ("Selected scenario run", row.get("run_id")),
            ("Baseline run", row.get("baseline_run_id")),
            ("Reporting zone", zone.get("title") or binding.get("zone_id")),
            ("Reporting zone ID", binding.get("zone_id")),
            ("Reporting area (ha)", row.get("reporting_area_ha")),
        ]))
        parts.append("<p>The reporting area describes the selected source zone. "
                     "It does not assign an intervention footprint or allocate costs by area.</p>")
        physical, support_rows = [], []
        for benefit in candidate.get("modeled_benefits", []):
            if not isinstance(benefit, dict) or benefit.get("quantity") != "avoided_export":
                continue
            output = record(benefit.get("output"))
            support = record(output.get("support"))
            label = benefit.get("label") or benefit.get("metric")
            physical.append((label, benefit.get("units") or output.get("units"),
                             output.get("baseline"), output.get("alternative"),
                             output.get("reduction"), output.get("reduction_percent")))
            support_rows.append((label, support.get("status"), support.get("area_ha"),
                                 support.get("valid_cells"), support.get("detail")))
        parts.append(_table(("Quantity", "Unit", "Baseline export", "Scenario export",
                             "Avoided export", "Avoided export (%)"), physical))
        parts.append("<p>A dash means the original quantity is unavailable; percentages "
                     "with a zero baseline remain undefined. Support marked paired uses "
                     "the original common finite cells. Other support states retain their source qualification.</p>")
        parts.append(_table(("Quantity", "Support status", "Shared area (ha)",
                             "Shared valid cells", "Source qualification"), support_rows))
        original = row.get("original_cost")
        summary = record(row.get("source_cost_summary"))
        parts.append("<h4>Retained source estimate</h4>")
        if not isinstance(original, dict):
            parts.append("<p>No implementation estimate is retained for this scenario.</p>")
        else:
            currency = summary.get("currency") or original.get("currency")
            rate = original.get("discount_rate")
            rate_percent = rate * 100 if type(rate) in (int, float) else None
            parts.append(_table(("Cost assumption", "Retained value", "Unit"), [
                ("Capital", original.get("capital"), currency),
                ("Annual operating", original.get("annual_operating"), _text(currency) + "/year"),
                ("Analysis horizon", original.get("horizon_years"), "years"),
                ("Real discount rate", rate_percent, "%"),
                ("Present value", summary.get("present_value"), currency),
                ("Annualized cost", summary.get("annualized"), _text(currency) + "/year"),
            ]))
            scope = record(original.get("scope"))
            scope_labels = {"whole_scenario": "Whole scenario", "reporting_zone": "Specified reporting zone",
                            "retained": "Retained source footprint; review original scope"}
            origin = record(original.get("source"))
            parts.append(_table(("Estimate provenance", "Retained value"), [
                ("Footprint", scope_labels.get(scope.get("kind"), "Footprint not specified")),
                ("Footprint zone", scope.get("zone_id")),
                ("Footprint report", scope.get("producer_report_id")),
                ("Source", origin.get("title")), ("Reference", origin.get("uri")),
                ("As of", origin.get("as_of")), ("Note", original.get("note")),
                ("Scope note", original.get("scope_note")),
            ]))
            parts.append(_details("Complete original estimate, footprint and review metadata", original))
        parts.append("<p>This estimate is source context. The implementation budget, "
                     "commitments and actual costs remain the separately entered ledger.</p></section>")
    if not parts:
        return ""
    return "<section><h2>Selected economic scenarios</h2>" + "".join(parts) + "</section>"



def _briefing_followup(plan):
    history = plan.get("briefing_imports", [])
    if not history:
        return ""
    rows = []
    for task in plan["tasks"]:
        source = task.get("briefing_entry", {})
        if not source:
            continue
        context = source.get("source_context", {})
        binding = context.get("report_binding", {})
        slide = context.get("slide", {})
        rows.append((
            _group((("Work", task["title"]), ("Task ID", task["id"]))),
            _group((("Owner", task["assignee"]), ("Status", task["status"]))),
            task.get("source_due_date"),
            _group((("Entry kind", source.get("kind")), ("Report", binding.get("title")),
                    ("Page", slide.get("title")), ("Page ID", slide.get("id")))),
            binding.get("report_sha256"), source.get("source_link_id")))
    return ("<section><h2>Report review follow-up</h2><p>"
            "These tasks retain their original meeting entry and report page. "
            "Source due dates are deadlines recorded in the notes; they do not set "
            "working durations or move the scientific report's dates. Current task "
            "owners and status include subsequent working-plan edits.</p>" +
            _table(("Work", "Current owner and status", "Source due date",
                    "Original report context", "Original report SHA256", "Original notes source"),
                   rows) +
            _details("Received meetings, preserved local differences and original source identities",
                     history) + "</section>")

def render_report_html(document: dict, as_of: str | None = None) -> str:
    plan = validate_plan(document)
    summary = summarize_plan(plan, as_of)
    task_rows = _report_rows(plan, "tasks", summary["as_of"])[1]
    visit_rows = _report_rows(plan, "visits", summary["as_of"])[1]
    observation_rows = _report_rows(plan, "observations", summary["as_of"])[1]
    escape = html.escape
    sections = []
    sections.append("<section><h2>Delivery schedule</h2><p>Project workdays: " +
                    escape(", ".join(str(day) for day in plan["working_days"])) +
                    " (ISO Monday = 1). Holidays: " +
                    escape(", ".join(plan["holidays"]) or "None entered") +
                    ". Start dates include the first working day. Finish boundaries "
                    "are exclusive and move to the next project workday. "
                    "Unknown durations retain unknown finishes.</p>")
    sections.append(_table(
        ("Task and phase", "Assignee", "Status and progress", "Working dates",
         "Duration and predecessors", "Schedule"),
        ((_group((("Task", row["title"]), ("ID", row["id"]), ("Phase", row["phase"]))),
          row["assignee"],
          _group((("Status", row["status"]), ("Progress (%)", row["progress_pct"]))),
          _group((("Start", row["start"]), ("Last work date", row["last_work_date"]),
                  ("Finish boundary (exclusive)", row["finish_exclusive"]))),
          _group((("Duration (workdays)", row["duration_days"]),
                  ("Predecessors", row["depends_on"]))),
          _group((("State", row["schedule_state"]), ("Overdue", row["overdue"]))))
         for row in task_rows),
    ))
    sections.append(_table(
        ("Task ID", "Schedule issue", "Explanation"),
        ((row["task_id"], row["code"], row["message"])
         for row in summary["schedule"]["issues"]),
    ))
    sections.append(_details("Task notes, evidence and original fields", plan["tasks"]))
    sections.append("</section><section><h2>Costs entered by the operator</h2>")
    sections.append(_table(
        ("Budget", "Commitments", "Actual costs"),
        [(_money(summary["budget_minor"]), _money(summary["commitment_minor"]),
          _money(summary["actual_minor"]))],
    ))
    sections.append("<p>These are separate ledger totals in USD. Commitments and "
                    "actual costs are not added to the budget or to each other.</p>")
    sections.append(_table(
        ("Ledger item", "Task ID", "Kind", "Amount (USD)", "Date", "Reference"),
        ((_group((("Label", row["label"]), ("Line ID", row["id"]))),
          row.get("task_id"), row["kind"], _money(row["amount_minor"]),
          row.get("date"), row.get("reference")) for row in plan["budget_lines"]),
    ))
    sections.append("</section><section><h2>Sites and monitoring plans</h2>")
    sections.append(_table(
        ("Site ID", "Label", "Latitude", "Longitude", "Declared CRS", "Candidate ID", "Source ID"),
        ((row["id"], row["label"], row.get("latitude"), row.get("longitude"),
          row.get("coordinate_reference_system"), row.get("candidate_id"), row.get("source_ref"))
         for row in plan["sites"]),
    ))
    sections.append(_table(
        ("Monitoring plan", "Objective", "Site IDs", "Parameters", "Method", "Frequency"),
        ((_group((("Title", row["title"]), ("ID", row["id"]))), row["objective"],
          row["site_ids"], row["parameters"], row.get("method_ref"), row.get("frequency"))
         for row in plan["monitoring_plans"]),
    ))
    sections.append(_details("Monitoring notes and original fields", plan["monitoring_plans"]))
    completed = summary["visit_counts"]["complete"]
    active = completed + summary["visit_counts"]["planned"]
    completion = summary["visit_completion_pct"]
    sections.append("</section><section><h2>Field visits and activities</h2><p>" +
                    escape(f"{completed} of {active} active visits complete") +
                    ("." if completion is None else escape(f" ({completion:.1f}%).")) +
                    " Overdue visits: " + str(len(summary["overdue_visit_ids"])) +
                    ". Cancelled visits remain in the register.</p>")
    sections.append(_table(
        ("Visit and site", "Dates", "Observer", "Status", "Notes", "Evidence"),
        ((_group((("Visit", row["id"]), ("Site", row["site_label"]),
                  ("Monitoring plan", row.get("monitoring_plan_id")))),
          _group((("Planned date", row.get("planned_date")),
                  ("Visited at", row.get("visited_at")))),
          row["observer"],
          _group((("Status", row["status"]), ("Overdue", row["overdue"]))),
          row["notes"], row["evidence_refs"]) for row in visit_rows),
    ))
    sections.append(_table(
        ("Activity and sample", "Collection and site", "Method", "Custody and work",
         "Notes", "Evidence"),
        ((_group((("Activity", row["id"]), ("Kind", row["kind"]),
                  ("Sample", row.get("sample_id")))),
          _group((("Collected at", row.get("collected_at")), ("Visit", row["visit_id"]),
                  ("Site", row["site_id"]))),
          row.get("method"),
          _group((("Custody reference", row.get("custody_ref")),
                  ("Task", row.get("implementation_task_id")))),
          row["notes"], row.get("evidence_refs", [])) for row in plan["activities"]),
    ))
    sections.append(_field_forms(plan["activities"]))
    sections.append(_details("Activities, form answers and original fields", plan["activities"]))
    sections.append("</section>")
    sections.append(_field_science_sections(observation_rows))
    sections.append("<section><h2>Original observations</h2><p>"
                    "Every row retains its parameter, result form, reported text, "
                    "unit, basis, fraction, qualifier and limits. Censored results "
                    "retain a null numeric value. Observations are not summed across "
                    "pollutants, converted to loads, or merged with modeled benefits.</p>")
    sections.append(_table(
        ("Result and sample", "Parameter and definition", "Original result",
         "Type and original limits", "Quality and source", "Notes"),
        ((_group((("Result", row["id"]), ("Site", row["site_label"]),
                  ("Sample", row.get("sample_id")), ("Activity", row["activity_id"]),
                  ("Visit", row["visit_id"]), ("Collected at", row.get("collected_at")))),
          _group((("Parameter", row["parameter"]), ("Basis", row.get("basis")),
                  ("Fraction", row.get("fraction")), ("Method", row.get("method")),
                  ("Method context", row.get("method_context")),
                  ("Method name", row.get("method_name")))),
          _group((("Original text", row["original_text"]), ("Numeric value", row["value"]),
                  ("Unit", row["unit"]))),
          _group((("Type", row["result_type"]), ("Qualifier", row.get("qualifier")),
                  ("Detection limit (original unit)", row.get("detection_limit")),
                  ("Quantitation limit (original unit)", row.get("quantitation_limit")))),
          _group((("QA status", row.get("qa_status")),
                  ("Original CSV source", row.get("laboratory_source_id")),
                  ("Original record", row.get("original_csv_record")),
                  ("Original line start", row.get("original_line_start")),
                  ("Original line end", row.get("original_line_end")))),
          row["notes"]) for row in observation_rows),
    ))
    sections.append(_details("Observation provenance and original fields", plan["observations"]))
    sections.append("</section>")
    sections.append(_economic_candidates(plan))
    sections.append(_briefing_followup(plan))
    sections.append("<section><h2>Frozen source selections</h2>")
    for candidate in plan["candidates"]:
        sections.append(_details(
            candidate["label"] + " [" + candidate["id"] + "]",
            candidate,
        ))
    if not plan["candidates"]:
        sections.append("<p>No source selections entered.</p>")
    sections.append(_table(
        ("Source ID", "Kind", "Label", "Reference"),
        ((row["id"], row["kind"], row["label"], row.get("reference"))
         for row in plan["source_links"]),
    ))
    sections.append("</section><section><h2>Portable record</h2><p>"
                    "The accompanying plan.json retains all original fields and "
                    "forward-compatible metadata. CSV text beginning with a spreadsheet "
                    "formula character receives a protective leading apostrophe; "
                    "the JSON original remains unchanged.</p></section>")
    title = escape(plan["title"])
    meta = escape(
        f"Plan {plan['id']} · Revision {plan['revision']} · As of {summary['as_of']}"
    )
    target = escape(plan.get("target_date") or "Not entered")
    finish = escape(summary["schedule"]["critical_finish_exclusive"] or "Needs duration information")
    return (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        "<title>" + title + " — implementation report</title><style>"
        "body{font:14px/1.5 system-ui,sans-serif;color:#202020;background:#fff;"
        "max-width:1500px;margin:0 auto;padding:32px}"
        "h1{font-size:28px;margin:0 0 8px}h2{font-size:20px;margin-top:28px}"
        ".scientific-context table{min-width:720px}.scientific-context h3{font-size:16px;margin-bottom:6px}"
        "header{border-bottom:2px solid #333;padding-bottom:20px}"
        ".meta,footer{color:#555}.table-scroll{overflow-x:auto;margin:12px 0}"
        "table{width:100%;border-collapse:collapse;font-size:12px}"
        "th,td{padding:8px;border:1px solid #ccc;text-align:left;vertical-align:top;"
        "white-space:pre-wrap;overflow-wrap:anywhere}th{background:#eee}"
        "details{border:1px solid #ccc;padding:10px;margin:10px 0}"
        "summary{font-weight:600;cursor:pointer}pre{white-space:pre-wrap;overflow-wrap:anywhere}"
        "section{break-inside:auto}footer{border-top:1px solid #aaa;margin-top:28px;padding-top:12px}"
        "@media print{body{padding:0;font-size:10px}table{font-size:10px;table-layout:fixed}"
        ".table-scroll{overflow:visible}.scientific-context table{min-width:0}"
        "details{break-inside:avoid}summary{display:block}"
        "thead{display:table-header-group}tr{break-inside:avoid}h2{break-after:avoid}@page{margin:12mm}}"
        "</style></head><body><header><h1>" + title + "</h1><p class=\"meta\">" +
        meta + "</p><p>" + escape(plan["description"]) +
        "</p><p>Start: " + escape(plan["start_date"]) + " · Target: " + target +
        " · Scheduled finish boundary: " + finish + "</p></header>" +
        "".join(sections) +
        "<footer>Implementation planning and field monitoring record. "
        "Dates use the selected project calendar; actual field records and costs "
        "are entered by the operator.</footer></body></html>"
    )
