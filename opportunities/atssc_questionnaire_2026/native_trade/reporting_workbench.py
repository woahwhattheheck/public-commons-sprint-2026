"""Versioned reporting views and disclosure-specific, frozen questionnaire analysis.

The workbench is an extension of the original Workspace.  It neither owns a
second database nor reads a public alternative as a numerical answer.
"""
from __future__ import annotations

import copy
import csv
import html
import io
import json
import re
from collections import defaultdict
from datetime import date
from decimal import Decimal, localcontext

from questionnaire_workspace import OperationError, csv_safe, decimal, disclosure_projection, encoded, identifier, now, table_rows


CHARTS = {"bar", "line", "none"}
STATISTICS = {"count", "percentage", "sum", "average", "minimum", "maximum", "ratio"}
FILTER_OPERATORS = {"equal", "not_equal", "less", "less_equal", "greater", "greater_equal", "contains", "in", "answered", "missing"}
NUMERIC = {"number", "integer"}


def install_schema(workspace):
    with workspace.connection() as db:
        db.executescript("""
        CREATE TABLE IF NOT EXISTS report_templates(
          id TEXT PRIMARY KEY,questionnaire_id TEXT NOT NULL,title TEXT NOT NULL,
          version INTEGER NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL,
          FOREIGN KEY(questionnaire_id) REFERENCES questionnaires(id));
        CREATE TABLE IF NOT EXISTS report_template_versions(
          template_id TEXT NOT NULL,version INTEGER NOT NULL,definition TEXT NOT NULL,
          created TEXT NOT NULL,PRIMARY KEY(template_id,version),
          FOREIGN KEY(template_id) REFERENCES report_templates(id));
        CREATE TABLE IF NOT EXISTS report_saved_views(
          id TEXT PRIMARY KEY,questionnaire_id TEXT NOT NULL,title TEXT NOT NULL,
          version INTEGER NOT NULL,created TEXT NOT NULL,updated TEXT NOT NULL,
          FOREIGN KEY(questionnaire_id) REFERENCES questionnaires(id));
        CREATE TABLE IF NOT EXISTS report_saved_view_versions(
          view_id TEXT NOT NULL,version INTEGER NOT NULL,definition TEXT NOT NULL,
          created TEXT NOT NULL,PRIMARY KEY(view_id,version),
          FOREIGN KEY(view_id) REFERENCES report_saved_views(id));
        """)
        db.commit()


def _text(value, label, maximum=10000, required=False):
    if not isinstance(value, str) or len(value) > maximum or re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", value):
        raise OperationError("REPORT_LAYOUT", f"Use readable {label} of at most {maximum} characters")
    if required and not value.strip():
        raise OperationError("REPORT_LAYOUT", f"Supply {label}")
    return value


def _definition(workspace, db, questionnaire_id):
    row = workspace._row(db, "questionnaires", questionnaire_id)
    result = db.execute("SELECT definition FROM definitions WHERE questionnaire_id=? AND version=?", (questionnaire_id, row["version"])).fetchone()
    return json.loads(result[0])


def _definition_disclosures(questions):
    """Use the original projector for source-only reference classification.

    Empty cells carry the declared table shape and physical source-row order.
    They are never statistical observations or saved answers.  Reusing one
    context per template keeps native dependencies and coordinate selection
    identical to the questionnaire's authoritative disclosure projection.
    """
    values = {}
    for key, question in questions.items():
        if question["kind"] != "table":
            values[key] = None
            continue
        binding = question.get("source")
        count = len(table_rows(binding)) if isinstance(binding, dict) else 1
        row = dict.fromkeys(column["id"] for column in question["columns"])
        values[key] = [row] * count
    return disclosure_projection({"questions": list(questions.values())}, values, final=False)["disclosures"]


def _reference(value, questions, projected=None):
    if isinstance(value, str):
        value = {"question_id": value}
    if not isinstance(value, dict) or value.get("question_id") not in questions:
        raise OperationError("REPORT_VARIABLE", "Choose a question from this definition")
    question = questions[value["question_id"]]
    column_id = value.get("column_id")
    field = question
    if question["kind"] == "table":
        field = next((x for x in question["columns"] if x["id"] == column_id), None)
        if field is None:
            raise OperationError("REPORT_VARIABLE", "Choose an original column for the table variable")
    elif column_id is not None:
        raise OperationError("REPORT_VARIABLE", "A scalar question has no table column")
    if projected is None:
        projected = _definition_disclosures(questions)
    protected = projected[question["id"]]["classification"] == "protected" or field.get("disclosure", question.get("disclosure", "protected")) == "protected"
    return {"question_id": question["id"], **({"column_id": column_id} if column_id else {}),
            "label": field["label"], "kind": field["kind"], "unit": field.get("unit"),
            "disclosure": "protected" if protected else "public"}

def _filters(value, questions, projected=None):
    if value is None:
        return []
    if not isinstance(value, list):
        raise OperationError("REPORT_FILTER", "Supply an ordered list of response filters")
    if value and projected is None:
        projected = _definition_disclosures(questions)
    result = []
    for item in value:
        if not isinstance(item, dict) or item.get("operator") not in FILTER_OPERATORS:
            raise OperationError("REPORT_FILTER", "Choose a supported filter operator")
        ref = _reference(item.get("variable"), questions, projected)
        operator = item["operator"]
        operand = item.get("value")
        if operator not in {"answered", "missing"}:
            operands = operand if operator == "in" else [operand]
            if not isinstance(operands, list) or not operands:
                raise OperationError("REPORT_FILTER", "Supply the filter value or a nonempty list for in")
            for entry in operands:
                if not isinstance(entry, (str, int, bool)) or isinstance(entry, str) and len(entry) > 10000:
                    raise OperationError("REPORT_FILTER", "Use finite scalar filter values")
                if ref["kind"] in NUMERIC:
                    decimal(entry)
            if ref["kind"] == "boolean":
                normalized = []
                for entry in operands:
                    if isinstance(entry, bool): normalized.append(entry)
                    elif isinstance(entry, str) and entry.casefold() in {"true", "false", "1", "0", "yes", "no"}: normalized.append(entry.casefold() in {"true", "1", "yes"})
                    else: raise OperationError("REPORT_FILTER", "Boolean filters use true or false")
                operand = normalized if operator == "in" else normalized[0]
            if ref["kind"] == "date":
                try: normalized = [date.fromisoformat(str(entry)).isoformat() for entry in operands]
                except ValueError: raise OperationError("REPORT_FILTER", "Date filters use YYYY-MM-DD") from None
                operand = normalized if operator == "in" else normalized[0]
            if operator == "contains" and ref["kind"] not in {"text", "choice"}:
                raise OperationError("REPORT_FILTER", "Contains applies to text or choice answers")
        result.append({"variable": ref, "operator": operator,
                       **({"value": copy.deepcopy(operand)} if operator not in {"answered", "missing"} else {})})
    return result


def _section(value, questions, projected=None):
    if not isinstance(value, dict):
        raise OperationError("REPORT_LAYOUT", "Each ordered report section needs its specifications")
    key = _text(value.get("id", identifier()), "section identifier", 200, True)
    if value.get("kind") == "text":
        return {"id": key, "kind": "text", "title": _text(value.get("title", ""), "section title", 500),
                "note": _text(value.get("note", ""), "descriptive text")}
    if projected is None:
        projected = _definition_disclosures(questions)
    ref = _reference({"question_id": value.get("question_id"), **({"column_id": value["column_id"]} if value.get("column_id") else {})}, questions, projected)
    chart = value.get("chart", "bar")
    statistics = value.get("statistics", ["count", "percentage", "sum", "average"] if ref["kind"] in NUMERIC else ["count", "percentage"])
    if chart not in CHARTS or not isinstance(statistics, list) or not statistics or len(statistics) != len(set(statistics)) or not set(statistics) <= STATISTICS:
        raise OperationError("REPORT_LAYOUT", "Choose bar, line or none and distinct supported statistics")
    if ref["kind"] not in NUMERIC and set(statistics) - {"count", "percentage"}:
        raise OperationError("REPORT_LAYOUT", "Numerical statistics require an original numeric variable")
    group_by = value.get("group_by", [])
    if not isinstance(group_by, list):
        raise OperationError("REPORT_VARIABLE", "Nesting uses an ordered list of original variables")
    groups = [_reference(x, questions, projected) for x in group_by]
    if len({(x["question_id"], x.get("column_id")) for x in groups}) != len(groups):
        raise OperationError("REPORT_VARIABLE", "Nested grouping variables must be distinct")
    year = _reference(value["year_field"], questions, projected) if value.get("year_field") else None
    ratio = None
    if value.get("ratio"):
        ratio = {"denominator": _reference(value["ratio"].get("denominator"), questions, projected)}
        if ref["kind"] not in NUMERIC or ratio["denominator"]["kind"] not in NUMERIC:
            raise OperationError("REPORT_VARIABLE", "A ratio needs two original numeric variables")
    if "ratio" in statistics and ratio is None:
        raise OperationError("REPORT_VARIABLE", "Choose the denominator for the ratio of matched sums")
    for variable in groups + ([year] if year else []) + ([ratio["denominator"]] if ratio else []):
        q = questions[variable["question_id"]]
        if q["kind"] == "table" and (questions[ref["question_id"]]["kind"] != "table" or q["id"] != ref["question_id"]):
            raise OperationError("REPORT_VARIABLE", "Table dimensions and ratios bind the same original answer row")
        if ratio and variable is ratio["denominator"] and questions[ref["question_id"]]["kind"] == "table" and q["kind"] != "table":
            raise OperationError("REPORT_VARIABLE", "Choose a denominator in the same table to preserve matched row units")
    result = {"id": key, "kind": "question", "question_id": ref["question_id"],
              **({"column_id": ref["column_id"]} if ref.get("column_id") else {}),
              "title": _text(value.get("title", ref["label"]), "view title", 10000, True),
              "note": _text(value.get("note", ""), "view note"), "chart": chart,
              "statistics": statistics, "variable": ref, "group_by": groups,
              "year_field": year, "ratio": ratio, "filters": _filters(value.get("filters"), questions, projected)}
    if value.get("saved_view_id"):
        if not isinstance(value.get("saved_view_version"), int) or value["saved_view_version"] < 1:
            raise OperationError("REPORT_LAYOUT", "Bind the original saved view version")
        result.update(saved_view_id=_text(value["saved_view_id"], "saved view identifier", 200, True), saved_view_version=value["saved_view_version"])
    return result


def _template(value, definition, projected=None):
    if not isinstance(value, dict):
        raise OperationError("REPORT_LAYOUT", "Supply the complete report template")
    questions = {x["id"]: x for x in definition["questions"]}
    if projected is None:
        projected = _definition_disclosures(questions)
    selected = value.get("question_ids", list(questions))
    if not isinstance(selected, list) or not selected or any(not isinstance(x, str) for x in selected) or len(selected) != len(set(selected)) or not set(selected) <= set(questions):
        raise OperationError("REPORT_SELECTION", "Select distinct questions in this definition")
    sections = value.get("ordered_sections")
    if sections is None:
        sections = [{"id": "view-" + q["id"] + ("-" + c["id"] if c else ""), "question_id": q["id"], **({"column_id": c["id"]} if c else {})}
                    for q in definition["questions"] if q["id"] in selected
                    for c in (q["columns"] if q["kind"] == "table" else [None])]
    if not isinstance(sections, list) or not sections:
        raise OperationError("REPORT_LAYOUT", "Add an ordered question view or descriptive section")
    sections = [_section(x, questions, projected) for x in sections]
    if len({x["id"] for x in sections}) != len(sections):
        raise OperationError("REPORT_LAYOUT", "Each section needs a distinct identifier")
    filters = _filters(value.get("filters"), questions, projected)
    references = [x["variable"] for x in filters]
    for section in sections:
        if section["kind"] == "text":
            continue
        references += [section["variable"], *section["group_by"], *[x["variable"] for x in section["filters"]]]
        if section["year_field"]: references.append(section["year_field"])
        if section["ratio"]: references.append(section["ratio"]["denominator"])
    if any(x["question_id"] not in selected for x in references):
        raise OperationError("REPORT_SELECTION", "Include every filter, grouping, year and ratio question in the selected report")
    orientation = value.get("orientation", "portrait")
    density = value.get("density", "comfortable")
    columns = value.get("columns", 1)
    if orientation not in {"portrait", "landscape"} or density not in {"comfortable", "compact"} or type(columns) is not int or columns not in {1, 2}:
        raise OperationError("REPORT_LAYOUT", "Choose portrait/landscape, comfortable/compact and one/two columns")
    return {"schema": "atssc.report-layout.v1", "title": _text(value.get("title", definition.get("title", "Questionnaire report")), "report title", 500, True),
            "description": _text(value.get("description", ""), "report description"), "orientation": orientation,
            "density": density, "columns": columns, "include_response_details": value.get("include_response_details", False) is True,
            "question_ids": selected, "filters": filters, "ordered_sections": sections}


def _saved_row(db, kind, key, version=None):
    table = "report_templates" if kind == "template" else "report_saved_views"
    editions = "report_template_versions" if kind == "template" else "report_saved_view_versions"
    foreign = "template_id" if kind == "template" else "view_id"
    row = db.execute(f"SELECT * FROM {table} WHERE id=?", (key,)).fetchone()
    if row is None:
        raise OperationError("NOT_FOUND", f"Saved report {kind} was not found")
    retained_version = row["version"] if version is None else version
    item = db.execute(f"SELECT definition,created FROM {editions} WHERE {foreign}=? AND version=?", (key, retained_version)).fetchone()
    if item is None:
        raise OperationError("NOT_FOUND", f"Saved report {kind} version was not found")
    return {**dict(row), "current_version": row["version"], "version": retained_version, "version_created": item["created"], "definition": json.loads(item["definition"])}


def _view_bindings(db, template, questions, projected):
    for section in template["ordered_sections"]:
        if section.get("saved_view_id"):
            saved = _saved_row(db, "view", section["saved_view_id"], section["saved_view_version"])
            core = {k: v for k, v in section.items() if k not in {"id", "saved_view_id", "saved_view_version"}}
            # Compare authored specifications after resolving both copies
            # against this publication.  The immutable saved version itself
            # stays unchanged when native source metadata is now understood.
            original = {k: v for k, v in _section(saved["definition"], questions, projected).items() if k != "id"}
            if core != original:
                raise OperationError("REPORT_VIEW_BINDING", "The report section differs from its retained saved view; save the edit as a new view version")


def _save(workspace, params, kind):
    key = params.get(kind + "_id") or identifier()
    table = "report_templates" if kind == "template" else "report_saved_views"
    editions = "report_template_versions" if kind == "template" else "report_saved_view_versions"
    foreign = "template_id" if kind == "template" else "view_id"
    method = "save_report_template" if kind == "template" else "save_report_view"
    def action(db):
        questionnaire_id = params["questionnaire_id"]
        definition = _definition(workspace, db, questionnaire_id)
        questions = {q["id"]: q for q in definition["questions"]}
        projected = _definition_disclosures(questions)
        item = _template(params["template"], definition, projected) if kind == "template" else _section(params["view"], questions, projected)
        if kind == "view" and item["kind"] != "question":
            raise OperationError("REPORT_LAYOUT", "Save a complete question chart/table view")
        if kind == "view":
            item.pop("saved_view_id", None)
            item.pop("saved_view_version", None)
        if kind == "template": _view_bindings(db, item, questions, projected)
        old = db.execute(f"SELECT * FROM {table} WHERE id=?", (key,)).fetchone()
        expected = params.get("expected_version")
        if type(expected) is not int or expected != (old["version"] if old else 0):
            raise OperationError("VERSION_CONFLICT", "Save against the current reporting version", {"current_version": old["version"] if old else 0})
        if old and old["questionnaire_id"] != questionnaire_id:
            raise OperationError("REPORT_SELECTION", "A saved view/template stays bound to its original questionnaire")
        stamp = now()
        version = expected + 1
        if old:
            db.execute(f"UPDATE {table} SET title=?,version=?,updated=? WHERE id=?", (item["title"], version, stamp, key))
        else:
            db.execute(f"INSERT INTO {table} VALUES(?,?,?,?,?,?)", (key, questionnaire_id, item["title"], version, stamp, stamp))
        db.execute(f"INSERT INTO {editions} VALUES(?,?,?,?)", (key, version, encoded(item), stamp))
        return _saved_row(db, kind, key, version)
    return workspace._write(method, key, {"questionnaire_id": params["questionnaire_id"]}, action)


def save_report_template(workspace, params): return _save(workspace, params, "template")
def save_report_view(workspace, params): return _save(workspace, params, "view")


def get_report_template(workspace, params):
    with workspace.connection() as db:
        return _saved_row(db, "template", params["template_id"], params.get("version"))


def get_report_view(workspace, params):
    with workspace.connection() as db:
        return _saved_row(db, "view", params["view_id"], params.get("version"))


def list_reporting_library(workspace, params):
    with workspace.connection() as db:
        questionnaire_id = params["questionnaire_id"]
        definition = _definition(workspace, db, questionnaire_id)
        return {"questionnaire_id": questionnaire_id, "definition": definition,
                "templates": [dict(x) for x in db.execute("SELECT * FROM report_templates WHERE questionnaire_id=? ORDER BY updated DESC,id", (questionnaire_id,))],
                "views": [dict(x) for x in db.execute("SELECT * FROM report_saved_views WHERE questionnaire_id=? ORDER BY updated DESC,id", (questionnaire_id,))]}


def _value(response, ref, row=None):
    value = response["values"].get(ref["question_id"])
    if ref.get("column_id"):
        return None if row is None else row.get(ref["column_id"])
    return value


def _present(value): return value is not None and value != "" and value != []


def _condition(value, item, public=False, withheld=False):
    ref, operator = item["variable"], item["operator"]
    if public and (ref["disclosure"] == "protected" or withheld):
        return False
    if operator == "answered": return _present(value)
    if operator == "missing": return not _present(value)
    if not _present(value): return False
    numeric = ref["kind"] in NUMERIC
    left = decimal(value) if numeric else value
    right = item["value"]
    if operator == "in": return left in [decimal(x) if numeric else x for x in right]
    right = decimal(right) if numeric else right
    if operator == "equal": return left == right
    if operator == "not_equal": return left != right
    if operator == "contains": return str(right).casefold() in str(left).casefold()
    try:
        return {"less": lambda: left < right, "less_equal": lambda: left <= right,
                "greater": lambda: left > right, "greater_equal": lambda: left >= right}[operator]()
    except TypeError:
        return False


def _withheld(response, ref, row_index=None):
    """Read the original projection's classification beside its selected value."""
    choice = response.get("disclosures", {}).get(ref["question_id"], {})
    if ref["disclosure"] == "protected" or choice.get("classification") == "protected" or choice.get("derived_from_protected"):
        return True
    if not ref.get("column_id"):
        return False
    cells = choice.get("cells", [])
    rows = cells if row_index is None else cells[row_index:row_index + 1]
    return any(row.get(ref["column_id"], {}).get("classification") == "protected"
               or row.get(ref["column_id"], {}).get("derived_from_protected") for row in rows)


def _matches(response, filters, public=False):
    tables = defaultdict(list)
    for item in filters:
        ref = item["variable"]
        if ref.get("column_id"):
            tables[ref["question_id"]].append(item)
        elif not _condition(_value(response, ref), item, public, public and _withheld(response, ref)):
            return False
    for question_id, conditions in tables.items():
        rows = response["values"].get(question_id) or []
        if not any(all(_condition(row.get(x["variable"]["column_id"]), x, public, public and _withheld(response, x["variable"], index)) for x in conditions) for index, row in enumerate(rows)):
            return False
    return True


def _year(value, kind):
    if not _present(value): return None
    text = str(value)
    if kind == "date": text = text[:4]
    return text if re.fullmatch(r"[1-9][0-9]{3}", text) else None


def _summary(observations, numeric, respondent_count, ratio=False):
    available = [x["value"] for x in observations if _present(x["value"])]
    values = [decimal(x) for x in available] if numeric else []
    pairs = [(decimal(x["value"]), decimal(x["denominator"])) for x in observations
             if ratio and _present(x["value"]) and _present(x.get("denominator"))]
    numbers = values + [v for p in pairs for v in p]
    # Cover the whole exponent span, rather than only the largest coefficient:
    # 1E+100 + 1E-100 must retain both finite original contributions.
    precision = max(28, (max(x.adjusted() for x in numbers) - min(x.as_tuple().exponent for x in numbers) + 33) if numbers else 28) + len(str(max(1, len(observations))))
    with localcontext() as context:
        context.prec = precision
        total = sum(values, Decimal(0)) if values else None
        numerator = sum((x for x, _ in pairs), Decimal(0)) if pairs else None
        denominator = sum((x for _, x in pairs), Decimal(0)) if pairs else None
        formatted = lambda x: None if x is None else format(x, "f")
        return {"respondents": respondent_count, "observations": len(observations), "answered": len(available),
                "missing": len(observations) - len(available), "count": len(available),
                "percentage": formatted(Decimal(len(available)) * 100 / len(observations)) if observations else None,
                "sum": formatted(total), "average": formatted(total / len(values)) if values else None,
                "minimum": formatted(min(values)) if values else None, "maximum": formatted(max(values)) if values else None,
                "ratio": formatted(numerator / denominator) if denominator else None,
                "ratio_numerator_sum": formatted(numerator), "ratio_denominator_sum": formatted(denominator),
                "ratio_answered": len(pairs), "zero_denominator": bool(pairs and denominator == 0),
                "decimal_precision": precision, "rounding": context.rounding}


def _visible_specs(value, public, protected_filter_refs=()):
    result = copy.deepcopy(value)
    if not public: return result
    for item in result.get("filters", []):
        if item["variable"]["disclosure"] == "protected" or (item["variable"]["question_id"], item["variable"].get("column_id")) in protected_filter_refs:
            item.pop("value", None)
            item["literal_withheld"] = True
    return result


def _analysis(section, responses, global_filters, public, protected_filter_refs=()):
    if section["kind"] == "text": return copy.deepcopy(section)
    ref = section["variable"]
    filters = global_filters + section["filters"]
    eligible = [r for r in responses if _matches(r, section["filters"], public)]
    observations = []
    for response_index, response in enumerate(eligible):
        rows = response["values"].get(ref["question_id"]) if ref.get("column_id") else [None]
        row_filters = [x for x in filters if x["variable"].get("column_id") and x["variable"]["question_id"] == ref["question_id"]]
        for row_index, row in enumerate(rows or []):
            if any(not _condition(row.get(x["variable"]["column_id"]), x, public, public and _withheld(response, x["variable"], row_index)) for x in row_filters): continue
            observations.append({"value": _value(response, ref, row), "respondent": response_index,
                                 "dimensions": [_value(response, x, row) for x in section["group_by"]],
                                 "year": _year(_value(response, section["year_field"], row), section["year_field"]["kind"]) if section["year_field"] else None,
                                 "denominator": _value(response, section["ratio"]["denominator"], row) if section["ratio"] else None})
    numeric = ref["kind"] in NUMERIC
    result = {**_visible_specs(section, public, protected_filter_refs), "summary": _summary(observations, numeric, len(eligible), bool(section["ratio"])), "groups": [], "frequencies": [], "cross_tab": None}
    frequencies = defaultdict(int)
    for observation in observations:
        if _present(observation["value"]): frequencies[encoded(observation["value"])] += 1
    with localcontext() as context:
        context.prec = 40
        result["frequencies"] = [{"value": json.loads(key), "count": count, "percentage": format(Decimal(count) * 100 / len(observations), "f")} for key, count in sorted(frequencies.items())] if observations else []
    grouped = defaultdict(list)
    for observation in observations:
        if any(not _present(x) for x in observation["dimensions"]) or section["year_field"] and observation["year"] is None: continue
        if section["group_by"] or section["year_field"]:
            grouped[encoded([observation["dimensions"], observation["year"]])].append(observation)
    for key, values in sorted(grouped.items()):
        dimensions, year = json.loads(key)
        result["groups"].append({"dimensions": dimensions, "year": year,
                                 "summary": _summary(values, numeric, len({x["respondent"] for x in values}), bool(section["ratio"]))})
    if section["year_field"]:
        years = sorted({x["year"] for x in result["groups"]})
        by_dimensions = defaultdict(dict)
        for group in result["groups"]: by_dimensions[encoded(group["dimensions"])][group["year"]] = group["summary"]
        result["cross_tab"] = {"row_dimensions": copy.deepcopy(section["group_by"]), "year_variable": copy.deepcopy(section["year_field"]), "years": years,
                               "rows": [{"dimensions": json.loads(key), "label": " / ".join(str(x) for x in json.loads(key)) or "All selected answers",
                                         "cells": [{"year": year, "summary": grouped_years.get(year)} for year in years]} for key, grouped_years in sorted(by_dimensions.items())]}
    return result


def _attach_analysis(editions, layout):
    selected = set(layout["question_ids"])
    for edition_name, report in editions.items():
        public = edition_name == "public"
        original = report["accepted_responses"]
        filters = layout["filters"] + [item for section in layout["ordered_sections"] for item in section.get("filters", [])]
        protected_filter_refs = {
            (item["variable"]["question_id"], item["variable"].get("column_id"))
            for item in filters
            if public and any(_withheld(response, item["variable"]) for response in original)
        }
        responses = [copy.deepcopy(x) for x in original if _matches(x, layout["filters"], public)]
        for index, response in enumerate(responses, 1):
            for name in ("values", "disclosures", "public_values", "public_alternatives"):
                if name in response: response[name] = {k: v for k, v in response[name].items() if k in selected}
            if public: response["response_number"] = index
        report["accepted_responses"] = responses
        safe_layout = _visible_specs(layout, public, protected_filter_refs)
        safe_layout["ordered_sections"] = [_visible_specs(x, public, protected_filter_refs) for x in layout["ordered_sections"]]
        report["report_layout"] = safe_layout
        sections = [_analysis(x, responses, layout["filters"], public, protected_filter_refs) for x in layout["ordered_sections"]]
        report["report_views"] = {"schema": "atssc.report-views.v1", "edition": edition_name,
                                  "selection_count": len(responses), "accepted_population_count": len(original),
                                  "filters": safe_layout["filters"], "sections": sections}
        totals = {}
        for question in report["questions"]:
            if question["kind"] not in NUMERIC: continue
            observations = [{"value": r["values"].get(question["id"])} for r in responses]
            summary = _summary(observations, True, len(responses))
            totals[question["id"]] = {"answered": summary["answered"], "sum": summary["sum"], "mean": summary["average"],
                                      "minimum": summary["minimum"], "maximum": summary["maximum"], "unit": question.get("unit")}
        report["numeric_totals"] = totals
    return editions


def _compose(workspace, db, params, report_id):
    publication, definition = workspace._definition(db, params["publication_id"])
    saved = _saved_row(db, "template", params["template_id"], params.get("template_version")) if params.get("template_id") else None
    if saved and saved["questionnaire_id"] != publication["questionnaire_id"]:
        raise OperationError("REPORT_SELECTION", "Choose a template from the publication's original questionnaire")
    questions = {q["id"]: q for q in definition["questions"]}
    projected = _definition_disclosures(questions)
    layout = _template(saved["definition"] if saved else params.get("template", {}), definition, projected)
    _view_bindings(db, layout, questions, projected)
    if saved: layout.update(template_id=saved["id"], template_version=saved["version"])
    editions = workspace.compose_report(db, {"publication_id": publication["id"], "question_ids": layout["question_ids"],
                                             **({"respondent_ids": params["respondent_ids"]} if params.get("respondent_ids") is not None else {})}, report_id)
    return _attach_analysis(editions, layout)


def preview_summary_report(workspace, params):
    with workspace.connection() as db:
        db.execute("BEGIN")
        editions = _compose(workspace, db, params, "preview")
        return {"edition": editions, "frozen": False}


def create_summary_report(workspace, params):
    key = identifier()
    def action(db):
        editions = _compose(workspace, db, params, key)
        created = editions["protected"]["created"]
        db.execute("INSERT INTO reports VALUES(?,?,?,?,0,NULL)", (key, params["publication_id"], encoded(editions), created))
        return {"report_id": key, "released": False, "frozen": True,
                "accepted_respondents": len(editions["protected"]["accepted_responses"]),
                "public_respondents": len(editions["public"]["accepted_responses"]), "edition": editions}
    return workspace._write("create_summary_report", key, {"publication_id": params["publication_id"], "template_id": params.get("template_id")}, action)


OPERATIONS = {"save_report_template": save_report_template, "get_report_template": get_report_template,
              "save_report_view": save_report_view, "get_report_view": get_report_view,
              "list_reporting_library": list_reporting_library,
              "preview_summary_report": preview_summary_report, "create_summary_report": create_summary_report}


METRIC_LABELS = {"count": "Answered count", "percentage": "Answered %", "sum": "Sum", "average": "Average",
                 "minimum": "Minimum", "maximum": "Maximum", "ratio": "Ratio of matched sums"}


def summary_csv(payload):
    """Export the same immutable statistics and selections shown in the workbench."""
    output = io.StringIO(newline="")
    writer = csv.writer(output)
    writer.writerow(["section", "title", "note", "question", "column", "dimensions", "year", "metric", "value"])
    for section in payload["report_views"]["sections"]:
        prefix = [section["id"], section["title"], section.get("note", ""), section.get("question_id", ""), section.get("column_id", "")]
        if section["kind"] == "text":
            writer.writerow([csv_safe(x) for x in prefix + ["", "", "description", section.get("note", "")]])
            continue
        entries = [{"dimensions": [], "year": None, "summary": section["summary"]}] + section["groups"]
        for entry in entries:
            for metric in section["statistics"]:
                writer.writerow([csv_safe(x) for x in prefix + [encoded(entry["dimensions"]), entry["year"] or "", metric, entry["summary"].get(metric)]])
        for frequency in section["frequencies"]:
            for metric in ("count", "percentage"):
                writer.writerow([csv_safe(x) for x in prefix + [encoded([frequency["value"]]), "", "frequency_" + metric, frequency[metric]]])
    return output.getvalue().encode("utf-8")


def _escape(value): return html.escape("" if value is None else str(value), quote=True)


def _html_table(headers, rows):
    return "<div class='scroll'><table><thead><tr>" + "".join("<th>" + _escape(x) + "</th>" for x in headers) + "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + _escape("—" if x is None else x) + "</td>" for x in row) + "</tr>" for row in rows) + "</tbody></table></div>"


def _svg_chart(section):
    if not section["summary"]["answered"]: return ""
    metric = next((x for x in section["statistics"] if x in {"sum", "average", "ratio", "count", "percentage"}), "count")
    if section["groups"]:
        points = [{"label": " / ".join(str(x) for x in group["dimensions"] + ([group["year"]] if group["year"] else [])) or "Selected answers",
                   "value": group["summary"].get(metric)} for group in section["groups"]]
    elif section["variable"]["kind"] in NUMERIC:
        points = [{"label": "Selected answers", "value": section["summary"].get(metric)}]
    else:
        metric = "count"
        points = [{"label": str(x["value"]), "value": x["count"]} for x in section["frequencies"]]
    def label_lines(value, width=32):
        words = re.findall(r"\S+", value)
        lines, current = [], ""
        for word in words:
            while len(word) > width:
                if current: lines.append(current); current = ""
                lines.append(word[:width]); word = word[width:]
            if current and len(current) + len(word) + 1 > width:
                lines.append(current); current = ""
            current = (current + " " + word).strip()
        if current: lines.append(current)
        return lines or [""]
    cross = section.get("cross_tab")
    if section["chart"] == "line" and cross:
        categories = cross["years"]
        series = [{"label": row["label"], "points": [{"label": year, "value": cell["summary"].get(metric) if cell["summary"] else None}
                    for year, cell in zip(categories, row["cells"])]} for row in cross["rows"]]
    else:
        categories = [x["label"] for x in points]
        series = [{"label": section["title"], "points": points}]
    available = [decimal(x["value"]) for item in series for x in item["points"] if x["value"] is not None]
    if not available: return ""
    largest = max(abs(x) for x in available) or Decimal(1)
    plotted = [x for x in points if x["value"] is not None]
    bar_lines = [label_lines(x["label"]) for x in plotted]
    bar_heights = [max(43, len(lines) * 14 + 12) for lines in bar_lines]
    legend_heights = [len(label_lines(x["label"], 90)) * 14 + 8 for x in series]
    height = 285 + sum(legend_heights) if section["chart"] == "line" else 55 + sum(bar_heights)
    parts = [f"<div class='scroll'><svg xmlns='http://www.w3.org/2000/svg' role='img' aria-label='{_escape(section['title'])}' viewBox='0 0 780 {height}'><title>{_escape(section['title'])}</title>"]
    if section["chart"] == "line":
        parts.append("<line x1='65' x2='750' y1='130' y2='130' stroke='#888'/>")
        patterns = ["", "6 3", "2 3", "8 3 2 3"]
        legend_y = 280
        for series_index, item in enumerate(series):
            pattern = patterns[series_index % len(patterns)]
            marker = series_index % 3
            segments, segment = [], []
            for index, point in enumerate(item["points"]):
                if point["value"] is None:
                    if segment: segments.append(segment); segment = []
                    continue
                x = 65 + (index * 665 / (len(categories) - 1) if len(categories) > 1 else 0)
                y = 130 - float(decimal(point["value"]) / largest) * 90
                segment.append((x, y))
                tooltip = _escape(item["label"] + " / " + point["label"] + ": " + str(point["value"]))
                if marker == 0: parts.append(f"<circle cx='{x:.3f}' cy='{y:.3f}' r='4' fill='#444'><title>{tooltip}</title></circle>")
                elif marker == 1: parts.append(f"<rect x='{x-4:.3f}' y='{y-4:.3f}' width='8' height='8' fill='#444'><title>{tooltip}</title></rect>")
                else: parts.append(f"<path d='M{x:.3f},{y-5:.3f} l5,10 h-10 z' fill='#444'><title>{tooltip}</title></path>")
            if segment: segments.append(segment)
            for segment in segments:
                if len(segment) > 1:
                    parts.append("<polyline fill='none' stroke='#444' stroke-width='2' stroke-dasharray='" + pattern + "' points='" + " ".join(f"{x:.3f},{y:.3f}" for x, y in segment) + "'/>")
            parts.append(f"<line x1='65' x2='95' y1='{legend_y-4}' y2='{legend_y-4}' stroke='#444' stroke-width='2' stroke-dasharray='{pattern}'/>")
            for line_index, line in enumerate(label_lines(item["label"], 90)):
                parts.append(f"<text x='105' y='{legend_y+line_index*14}' font-size='11'>{_escape(line)}</text>")
            legend_y += legend_heights[series_index]
        for index, category in enumerate(categories):
            x = 65 + (index * 665 / (len(categories) - 1) if len(categories) > 1 else 0)
            anchor = "start" if index == 0 else "end" if index == len(categories)-1 else "middle"
            parts.append(f"<text x='{x:.3f}' y='235' text-anchor='{anchor}' font-size='11'>{_escape(category)}</text>")
        parts.append("<text x='65' y='257' font-size='11'>Missing or withheld observations leave gaps.</text>")
    else:
        parts.append(f"<line x1='400' x2='400' y1='25' y2='{height-25}' stroke='#888'/>")
        y = 35
        for point, lines, row_height in zip(plotted, bar_lines, bar_heights):
            number = decimal(point["value"])
            width = float(abs(number) / largest) * 205
            x = 400 - width if number < 0 else 400
            for line_index, line in enumerate(lines): parts.append(f"<text x='8' y='{y+15+line_index*14}' font-size='12'>{_escape(line)}</text>")
            parts.append(f"<rect x='{x:.3f}' y='{y}' width='{width:.3f}' height='23' fill='#777'><title>{_escape(point['label'])}: {_escape(point['value'])}</title></rect><text x='625' y='{y+15}' font-size='12'>{_escape(point['value'])}</text>")
            y += row_height
    return "".join(parts) + "</svg></div>"


def render_summary_html(payload):
    """A printable static edition; charts and every table use its frozen values."""
    layout, views = payload["report_layout"], payload["report_views"]
    orientation = layout["orientation"]
    parts = ["<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>" + _escape(layout["title"]) + "</title><style>"
             "*{box-sizing:border-box}body{font:14px Arial,sans-serif;color:#222;background:#fff;max-width:1150px;margin:28px auto;padding:0 18px}h1{font-size:24px}h2{font-size:18px}p,h1,h2,td,th{overflow-wrap:anywhere}p{white-space:pre-wrap}.section{border-top:1px solid #bbb;margin-top:22px;padding-top:12px;break-inside:auto}.scroll{max-width:100%;overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:8px;border:1px solid #aaa;text-align:left;vertical-align:top}th{background:#eee}svg{width:100%;min-width:540px;height:auto}.muted{font-size:12px;color:#555}.sections.columns2{columns:2;column-gap:25px}.compact td,.compact th{padding:5px}.metadata{border-bottom:1px solid #bbb;padding-bottom:12px}@media(max-width:750px){.sections.columns2{columns:1}body{margin:15px auto}}@media print{body{max-width:none;margin:0;padding:0}.scroll{overflow:visible}svg{min-width:0}table{font-size:10px}thead{display:table-header-group}tr{break-inside:avoid}.section{break-inside:auto}}@page{size:A4 " + orientation + ";margin:16mm}</style><h1>" + _escape(layout["title"]) + "</h1><p class='metadata'>" + _escape(views["edition"].capitalize()) + " frozen summary · " + _escape(payload["created"]) + "<br>" + str(views["selection_count"]) + " selected responses from " + str(views["accepted_population_count"]) + " accepted revisions.</p>"]
    if layout["description"]: parts.append("<p>" + _escape(layout["description"]) + "</p>")
    parts.append(f"<div class='sections columns{layout['columns']} {layout['density']}'>")
    for section in views["sections"]:
        parts.append("<section class='section'><h2>" + _escape(section["title"]) + "</h2>")
        if section.get("note"): parts.append("<p>" + _escape(section["note"]) + "</p>")
        if section["kind"] == "text":
            parts.append("</section>")
            continue
        statistics = section["statistics"]
        parts.append(_html_table([METRIC_LABELS[x] for x in statistics], [[section["summary"].get(x) for x in statistics]]))
        parts.append("<p class='muted'>" + str(section["summary"]["answered"]) + " visible answers; " + str(section["summary"]["missing"]) + " missing or withheld values; " + str(section["summary"]["observations"]) + " original observations.</p>")
        if section["ratio"]:
            parts.append("<p class='muted'>Ratio uses " + str(section["summary"]["ratio_answered"]) + " observations with both values: " + _escape(section["summary"]["ratio_numerator_sum"]) + " / " + _escape(section["summary"]["ratio_denominator_sum"]) + ".</p>")
        if section["chart"] != "none": parts.append(_svg_chart(section))
        if section["cross_tab"]:
            cross = section["cross_tab"]
            headers = [x["label"] for x in cross["row_dimensions"]] + [year + " " + METRIC_LABELS[metric] for year in cross["years"] for metric in statistics]
            rows = [row["dimensions"] + [cell["summary"].get(metric) if cell["summary"] else None for cell in row["cells"] for metric in statistics] for row in cross["rows"]]
            parts.append(_html_table(headers, rows))
        elif section["groups"]:
            parts.append(_html_table([x["label"] for x in section["group_by"]] + [METRIC_LABELS[x] for x in statistics], [row["dimensions"] + [row["summary"].get(metric) for metric in statistics] for row in section["groups"]]))
        elif section["frequencies"] and section["variable"]["kind"] not in NUMERIC:
            parts.append(_html_table(["Visible answer", "Count", "% of observations"], [[x["value"], x["count"], x["percentage"]] for x in section["frequencies"]]))
        parts.append("</section>")
    parts.append("</div>")
    if layout["include_response_details"]:
        questions = payload["questions"]
        for index, response in enumerate(payload["accepted_responses"], 1):
            heading = response.get("name") if views["edition"] == "protected" else "Response " + str(index)
            rows = []
            for question in questions:
                key = question["id"]
                alternatives = [response.get("public_alternatives", {}).get(key)]
                for row_index, cells in enumerate(response.get("disclosures", {}).get(key, {}).get("cells", []), 1):
                    for column, choice in cells.items():
                        if choice.get("public_alternative"): alternatives.append("Row " + str(row_index) + ", " + column + ": " + choice["public_alternative"])
                rows.append([question["label"], encoded(response["values"].get(key)), "\n".join(x for x in alternatives if x)])
            parts.append("<section class='section'><h2>" + _escape(heading or "Response " + str(index)) + "</h2>" + _html_table(["Question", "Selected answer", "Public alternative text"], rows) + "</section>")
    return ("".join(parts) + "</html>\n").encode("utf-8")
