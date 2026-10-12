"""Saved load-source editions, comparisons, reviewer decisions and complete delivery."""
from __future__ import annotations

import base64
import copy
from decimal import Decimal, ROUND_HALF_EVEN, localcontext
import io
from pathlib import Path
import zipfile

from .store import Conflict, digest, encoded, identifier, now
from .load_forecast_sources import (
    KEY_FIELDS, MAX_ROWS, STATUSES, SIGNALS, METRICS, SEASONS, UNITS,
    EXACT_PRECISION, RATIO_PRECISION,
    inspect_file, map_source, sheet_rows, cell_name, text, integer, decimal, number, strict_json,
)

KINDS = ("load_source", "load_plan", "load_review", "load_export", "load_received")
MODES = ("forecast_revision", "forecast_accuracy")
TABLES = ("comparison", "growth", "explanations", "issues")


def selected(row, selection):
    return (selection["first_year"] <= row["year"] <= selection["last_year"] and
            all(not selection[field] or row[field[:-1] if field != "geographies" else "geography"] in selection[field]
                for field in ("areas", "geographies", "metrics", "seasons")))


def series_key(row):
    return tuple(row[k] for k in KEY_FIELDS if k not in ("period_start", "period_end"))


def source_pin(record):
    p = record["payload"]
    return {"kind": record["kind"], "id": record["id"], "revision": record["revision"],
            "label": p["label"], "publisher": p["publisher"], "vintage": p["vintage"],
            "published": p["published"], "status": p["status"], "source_url": p["source_url"],
            "original": p["original"], "normalised": p.get("normalised"), "review": p.get("review")}


def compare_rows(plan, baseline, current, explanations):
    # Source bounds, unit powers and at most 100,000 observations fit exactly in this context.
    with localcontext() as context:
        context.prec = EXACT_PRECISION
        context.rounding = ROUND_HALF_EVEN
        context.Emax, context.Emin = 9999, -9999
        return _compare_rows(plan, baseline, current, explanations)


def _compare_rows(plan, baseline, current, explanations):
    left = {r["key"]: r for r in baseline if r["signal"] == plan["baseline_signal"] and selected(r, plan["selection"])}
    right = {r["key"]: r for r in current if r["signal"] == plan["current_signal"] and selected(r, plan["selection"])}
    if not left or not right:
        raise ValueError("Each selected edition must contain observations for the chosen signal and scope.")
    rows, issues, by_key = [], [], {}
    for key in sorted(set(left) | set(right), key=lambda k: (
            (left.get(k) or right[k])["area"], (left.get(k) or right[k])["geography"],
            (left.get(k) or right[k])["metric"], (left.get(k) or right[k])["season"],
            (left.get(k) or right[k])["period_start"], (left.get(k) or right[k])["period_end"], k)):
        a, b = left.get(key), right.get(key)
        base = a or b
        av = Decimal(a["canonical_value"]) if a else None
        bv = Decimal(b["canonical_value"]) if b else None
        difference = bv - av if av is not None and bv is not None else None
        with localcontext() as context:
            context.prec = RATIO_PRECISION
            change = difference / av.copy_abs() * 100 if av not in (None, 0) and difference is not None else None
        row = {"key": key, **{k: base[k] for k in KEY_FIELDS}, "year": base["year"],
               "period_label": base["period_label"],
               "state": "MATCHED" if a and b else "BASELINE_ONLY" if a else "CURRENT_ONLY",
               "baseline": a, "current": b,
               "baseline_value": number(av) if av is not None else None,
               "current_value": number(bv) if bv is not None else None,
               "difference": number(difference) if difference is not None else None,
               "change_percent": number(change) if change is not None else None,
               "explained_change": "0", "unexplained_change": number(difference) if difference is not None else None}
        rows.append(row)
        by_key[key] = row
    missing_left = sum(row["state"] == "CURRENT_ONLY" for row in rows)
    missing_right = sum(row["state"] == "BASELINE_ONLY" for row in rows)
    if missing_left or missing_right:
        issues.append({"id": "coverage", "title": "Different source coverage",
            "detail": "Unmatched observations remain in the report. Original geography, basis, coincidence, season and period interpretation must match for a comparison.",
            "baseline_only": missing_right, "current_only": missing_left})
    if not any(row["state"] == "MATCHED" for row in rows):
        raise ValueError("There are no compatible observations. Review geography aliases, basis, season, period interpretation and source units.")
    explained, used = [], set()
    for link, source, observation in explanations:
        target = by_key.get(link["target_key"])
        if not target or target["state"] != "MATCHED":
            raise ValueError("Every explanation must select one matched comparison observation.")
        identity = (source["id"], source["revision"], observation["row_id"])
        if identity in used:
            raise ValueError("The same original adjustment cell can explain only one selected change.")
        used.add(identity)
        if observation["canonical_unit"] != target["canonical_unit"]:
            raise ValueError("An explanation must use the same power or energy dimension as its comparison.")
        for field in ("area", "geography", "metric", "season", "period_start", "period_end", "period_basis", "coincidence"):
            if observation[field] != target[field]:
                raise ValueError("An adjustment must identify the same geography, metric, season, year and coincidence as its target.")
        amount = Decimal(observation["canonical_value"]) * link["direction"]
        target["explained_change"] = number(Decimal(target["explained_change"]) + amount)
        target["unexplained_change"] = number(Decimal(target["difference"]) - Decimal(target["explained_change"]))
        explained.append({"target_key": target["key"], "source": source_pin(source),
            "observation": observation, "direction": link["direction"],
            "signed_amount": number(amount), "reason": link["reason"]})
    groups = {}
    for row in rows:
        if row["state"] == "MATCHED":
            groups.setdefault(series_key(row), []).append(row)
    growth = []
    for key, values in sorted(groups.items()):
        values.sort(key=lambda r: (r["period_start"], r["period_end"]))
        first, last = values[0], values[-1]
        if first["period_basis"] == "calendar_month":
            months = lambda r: int(r["period_label"][:4]) * 12 + int(r["period_label"][5:7])
            period_count, periods_per_year = months(last) - months(first), 12
        else:
            period_count, periods_per_year = last["year"] - first["year"], 1
        expected_periods = period_count + 1
        with localcontext() as context:
            context.prec = RATIO_PRECISION
            intervals = Decimal(period_count) / periods_per_year
        item = {k: first[k] for k in KEY_FIELDS if k not in ("period_start", "period_end")}
        item.update({"first_period": first["period_label"], "last_period": last["period_label"],
                     "interval_years": number(intervals), "matched_observations": len(values),
                     "missing_periods_between_endpoints": max(0, expected_periods - len(values))})
        for side in ("baseline", "current"):
            a, b = Decimal(first[side + "_value"]), Decimal(last[side + "_value"])
            item[side + "_first"] = number(a)
            item[side + "_last"] = number(b)
            item[side + "_growth"] = number(b - a)
            with localcontext() as context:
                context.prec = RATIO_PRECISION
                # Form the year exponent from the exact integer period count, avoiding a rounded 1/12 reciprocal.
                cagr = ((b / a) ** (Decimal(periods_per_year) / period_count) - 1) * 100 \
                    if a > 0 and b >= 0 and period_count > 0 else None
                item[side + "_cagr_percent"] = number(cagr) if cagr is not None else None
        denominator = sum(Decimal(r["current_value"]).copy_abs() for r in values)
        numerator = sum(Decimal(r["difference"]).copy_abs() for r in values)
        with localcontext() as context:
            context.prec = RATIO_PRECISION
            item["accuracy_wape"] = number(numerator / denominator) \
                if plan["mode"] == "forecast_accuracy" and denominator else None
        growth.append(item)
    summary = {"baseline_observations": len(left), "current_observations": len(right),
        "matched": sum(r["state"] == "MATCHED" for r in rows), "baseline_only": missing_right,
        "current_only": missing_left, "changed": sum(r["difference"] not in (None, "0") for r in rows),
        "series": len(growth), "explanations": len(explained)}
    return {"comparison": rows, "growth": growth, "explanations": explained,
            "issues": issues, "summary": summary}


def assemble_review(plan_record, sources, source_rows):
    """One calculation path serves preparation and complete package receiving."""
    plan = plan_record["payload"]
    ref_key = lambda r: encoded({k: r[k] for k in ("kind", "id", "revision")})
    records = {ref_key(r): r for r in sources}
    left, right = records[encoded(plan["baseline"])], records[encoded(plan["current"])]
    explanation_rows = []
    for link in plan["explanations"]:
        source = records[encoded(link["source"])]
        row = next(r for r in source_rows[ref_key(source)] if r["row_id"] == link["source_row_id"])
        explanation_rows.append((link, source, row))
    result = compare_rows(plan, source_rows[ref_key(left)], source_rows[ref_key(right)], explanation_rows)
    if left["payload"]["status"] != right["payload"]["status"]:
        result["issues"].append({"id": "source-status", "title": "Different publication roles",
            "detail": left["payload"]["status"] + " is being compared with " + right["payload"]["status"] +
                      ". Retain these original roles in the interpretation."})
    for source in sources:
        if source["payload"].get("missing_cells"):
            result["issues"].append({"id": "missing-" + source["id"], "title": "Missing original cells",
                "detail": source["payload"]["label"] + ": " + str(source["payload"]["missing_cells"]) +
                          " selected cells contain the explicitly configured missing markers."})
    return {"schema": "commons.load-forecast-review.v1", "plan": plan_record, "sources": sources, **result,
        "interpretation": {
            "difference": "Current minus baseline in the displayed canonical power or energy unit.",
            "percentage": "Difference divided by the absolute baseline; undefined for a zero baseline. Ratios and CAGR use 40 significant decimal digits with half-even rounding.",
            "growth": "Endpoint compound annual growth uses the actual elapsed year or month interval. Missing intermediate periods remain visible.",
            "aggregation": "Geographic peaks and overlapping planning areas are kept separate; this review computes no total across areas.",
            "periods": "Season and delivery-year spans retain their source labels; year spans do not imply unstated month boundaries.",
            "explanations": "Linked original adjustment cells explain a reported difference; they never change either published forecast.",
            "accuracy": "Accuracy WAPE is computed only for the explicitly selected forecast-accuracy mode, separately for each compatible series.",
        }}


class LoadForecast:
    def __init__(self, service):
        self.service, self.store = service, service.store
        self.actions = {
            "load.source.upload": self.source_upload, "load.source.map": self.source_map,
            "load.source.accept": self.source_accept, "load.source.revise": self.source_revise,
            "load.source.describe": self.source_describe,
            "load.plan.save": self.plan_save, "load.review.prepare": self.review_prepare,
            "load.review.decide": self.review_decide, "load.review.finalize": self.review_finalize,
            "load.review.reopen": self.review_reopen, "load.review.export": self.review_export,
            "load.delivery.receive": self.delivery_receive, "load.delivery.adopt": self.delivery_adopt,
        }

    def ref(self, record):
        return self.service.reference(record)

    def record(self, kind, reference):
        if not isinstance(reference, dict) or reference.get("kind", kind) != kind:
            raise ValueError("Select an exact retained " + kind + " revision.")
        return self.store.get(kind, reference["id"], integer(reference["revision"], 1, 1000000000, "Revision"))

    def write(self, kind, payload, request=None):
        request = request or {}
        return self.service.write(kind, payload, request.get("id"), request.get("expected", 0))

    def json_blob(self, value, name):
        return self.store.blob((encoded(value) + "\n").encode(), name, "application/json")

    def source_upload(self, request):
        try:
            data = base64.b64decode(request["base64"], validate=True)
        except (ValueError, KeyError):
            raise ValueError("Select a complete original source file.") from None
        filename = Path(text(request.get("filename"), 300, True)).name
        if filename in (".", ".."):
            raise ValueError("Choose an ordinary source filename.")
        inspection = inspect_file(data, filename)
        status = text(request.get("status"), 100, True)
        if status not in STATUSES or (inspection["format"] == "reference" and status != "reference"):
            raise ValueError("Classify the original as annual forecast, informational update, observed data, adjustment detail, or reference.")
        from datetime import date
        published = date.fromisoformat(text(request.get("published"), 10, True)).isoformat()
        parent = self.record("load_source", request["parent"]) if request.get("parent") else None
        original = self.store.blob(data, filename,
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" if filename.endswith(".xlsx") else
            "application/pdf" if filename.endswith(".pdf") else "application/json" if filename.endswith(".json") else "text/csv")
        payload = {"label": text(request.get("label", filename), 300, True), "state": "UPLOADED",
            "publisher": text(request.get("publisher"), 300, True), "source_url": text(request.get("source_url"), 3000, True),
            "vintage": text(request.get("vintage"), 300, True), "published": published, "status": status,
            "original": original, "inspection": inspection, "parent": self.ref(parent) if parent else None,
            "change_note": text(request.get("change_note")), "created": now()}
        if parent and not payload["change_note"]:
            raise ValueError("Describe the replacement source edition.")
        return self.write("load_source", payload)

    def source_describe(self, request):
        source = self.store.get("load_source", request["id"])
        p = source["payload"]
        if p["state"] not in ("UPLOADED", "MAPPED"):
            raise ValueError("Create a revised source edition before changing accepted metadata.")
        from datetime import date
        status = text(request.get("status"), 100, True)
        if status not in STATUSES or (p["inspection"]["format"] == "reference" and status != "reference"):
            raise ValueError("Choose the source's actual publication role.")
        values = {field: text(request.get(field), 3000 if field == "source_url" else 300, True)
                  for field in ("label", "publisher", "vintage", "source_url")}
        values.update({"status": status, "published": date.fromisoformat(text(request.get("published"), 10, True)).isoformat()})
        return self.write("load_source", {**p, **values}, request)

    def source_map(self, request):
        record = self.store.get("load_source", request["id"])
        payload = record["payload"]
        if payload["state"] not in ("UPLOADED", "MAPPED") or payload["inspection"]["format"] == "reference":
            raise ValueError("Revise an accepted source before changing its mapping.")
        parsed = map_source(self.store.bytes(payload["original"]["digest"]), payload["inspection"], request.get("mappings", []))
        return self.write("load_source", {**payload, "state": "MAPPED",
            "normalised": self.json_blob(parsed, "load-normalised.json"),
            "row_count": len(parsed["rows"]), "missing_cells": len(parsed["missing_cells"]),
            "mappings": parsed["mappings"], "signals": parsed["signals"],
            "canonical_units": parsed["canonical_units"],
            "dimensions": {plural: sorted(set(row[field] for row in parsed["rows"]))
                for plural, field in (("areas", "area"), ("geographies", "geography"),
                                      ("metrics", "metric"), ("seasons", "season"))}}, request)

    def source_accept(self, request):
        record = self.store.get("load_source", request["id"])
        p = record["payload"]
        if p["state"] != "MAPPED" and not (p["state"] == "UPLOADED" and p["inspection"]["format"] == "reference"):
            raise ValueError("Map this original source before accepting its values.")
        if p.get("missing_cells") and request.get("acknowledge_missing") is not True:
            raise ValueError("Review the selected blank or missing original cells.")
        return self.write("load_source", {**p, "state": "ACCEPTED", "review": {
            "actor": self.service.actor, "note": text(request.get("note"), 20000, True),
            "original_sha256": p["original"]["digest"],
            "normalised_sha256": p.get("normalised", {}).get("digest"), "at": now()}}, request)

    def source_revise(self, request):
        source = self.record("load_source", request.get("source"))
        p = copy.deepcopy(source["payload"])
        for key in ("review", "_operation_id"):
            p.pop(key, None)
        p.update({"parent": self.ref(source), "state": "MAPPED" if p.get("normalised") else "UPLOADED",
                  "change_note": text(request.get("note"), 20000, True), "created": now()})
        return self.write("load_source", p)

    def accepted(self, reference, table=True):
        record = self.record("load_source", reference)
        if record["payload"]["state"] != "ACCEPTED":
            raise ValueError("Accept each exact original source edition before preparing a review.")
        if table and not record["payload"].get("normalised"):
            raise ValueError("Choose a mapped source for quantitative analysis.")
        return record

    def observations(self, record):
        return strict_json(self.store.bytes(record["payload"]["normalised"]["digest"]))["rows"]

    def plan_save(self, request):
        raw = request.get("plan", {})
        left, right = self.accepted(raw.get("baseline")), self.accepted(raw.get("current"))
        mode = raw.get("mode", "forecast_revision")
        baseline_signal, current_signal = raw.get("baseline_signal", "forecast"), raw.get("current_signal", "forecast")
        if mode not in MODES or baseline_signal != "forecast" or current_signal not in (
                ("forecast",) if mode == "forecast_revision" else ("actual", "weather_normalized")):
            raise ValueError("Compare forecast vintages, or compare a forecast with explicitly selected actual/normalized observations.")
        if self.ref(left) == self.ref(right) and baseline_signal == current_signal:
            raise ValueError("Select different source editions for the forecast-vintage comparison.")
        selection = raw.get("selection", {})
        if not isinstance(selection, dict):
            raise ValueError("Choose the review scope.")
        filters = {}
        for field in ("areas", "geographies", "metrics", "seasons"):
            values = selection.get(field, [])
            if not isinstance(values, list) or len(values) > 10000:
                raise ValueError("Scope selections must be lists.")
            filters[field] = sorted(set(text(v, 300, True) for v in values))
        filters["first_year"] = integer(selection.get("first_year", 1900), 1900, 2200, "First year")
        filters["last_year"] = integer(selection.get("last_year", 2200), filters["first_year"], 2200, "Last year")
        documents = [self.ref(self.accepted(r, table=False)) for r in raw.get("documents", [])]
        links = []
        for link in raw.get("explanations", []):
            source = self.accepted(link.get("source"))
            observation = next((r for r in self.observations(source) if r["row_id"] == link.get("source_row_id")), None)
            if not observation or observation["signal"] != "adjustment":
                raise ValueError("Select an actual mapped adjustment cell as the explanation.")
            direction = integer(link.get("direction"), -1, 1, "Explanation direction")
            if not direction:
                raise ValueError("An explanation direction is plus one or minus one.")
            target = text(link.get("target_key"), 64, True)
            if len(target) != 64:
                raise ValueError("Select an exact comparison observation.")
            links.append({"target_key": target, "source": self.ref(source), "source_row_id": observation["row_id"],
                "direction": direction, "reason": text(link.get("reason"), 20000, True)})
        payload = {"label": text(raw.get("label"), 300, True), "baseline": self.ref(left), "current": self.ref(right),
            "mode": mode, "baseline_signal": baseline_signal, "current_signal": current_signal,
            "selection": filters, "documents": documents, "explanations": links,
            "purpose": text(raw.get("purpose"), 20000, True), "assumptions": text(raw.get("assumptions"), 40000, True),
            "client": text(raw.get("client"), 500), "prepared_for": text(raw.get("prepared_for"), 500),
            "received_from": self.ref(self.record("load_received", raw["received_from"])) if raw.get("received_from") else None}
        compare_rows(payload, self.observations(left), self.observations(right), self.explanations(payload))
        return self.write("load_plan", payload, request)

    def explanations(self, plan):
        output = []
        for link in plan["explanations"]:
            source = self.accepted(link["source"])
            row = next(r for r in self.observations(source) if r["row_id"] == link["source_row_id"])
            output.append((link, source, row))
        return output

    def review_prepare(self, request):
        plan_record = self.record("load_plan", request.get("plan"))
        plan = plan_record["payload"]
        sources = {}
        for reference in [plan["baseline"], plan["current"], *[l["source"] for l in plan["explanations"]], *plan["documents"]]:
            source = self.accepted(reference, table=reference not in plan["documents"])
            sources[encoded(self.ref(source))] = source
        observations = {key: self.observations(source) for key, source in sources.items() if source["payload"].get("normalised")}
        snapshot = assemble_review(plan_record, list(sources.values()), observations)
        report = self.json_blob(snapshot, "load-prepared-review.json")
        return self.write("load_review", {"label": plan["label"], "state": "PREPARED",
            "plan": self.ref(plan_record), "report": report, "summary": snapshot["summary"],
            "issues": snapshot["issues"], "prepared": now()})

    def review_decide(self, request):
        record = self.store.get("load_review", request["id"])
        p = record["payload"]
        if p["state"] not in ("PREPARED", "REVIEWED"):
            raise ValueError("Reopen this finalized edition before changing its review.")
        snapshot = strict_json(self.store.bytes(p["report"]["digest"]))
        acknowledged = request.get("acknowledged", [])
        required = {item["id"] for item in snapshot["issues"]}
        if not isinstance(acknowledged, list) or set(acknowledged) != required:
            raise ValueError("Review the listed coverage and source-definition differences.")
        rows = {r["key"] for r in snapshot["comparison"]}
        decisions, seen = [], set()
        for decision in request.get("decisions", []):
            key = decision.get("key")
            if key not in rows or key in seen or decision.get("decision") not in ("reviewed", "follow_up", "excluded"):
                raise ValueError("Each row decision must select one actual comparison observation.")
            seen.add(key)
            decisions.append({"key": key, "decision": decision["decision"],
                              "note": text(decision.get("note"), 20000, True)})
        review = {"actor": self.service.actor, "note": text(request.get("note"), 40000, True),
            "report_digest": p["report"]["digest"], "acknowledged": sorted(required),
            "decisions": decisions, "at": now()}
        return self.write("load_review", {**p, "state": "REVIEWED", "review": review}, request)

    def review_finalize(self, request):
        record = self.store.get("load_review", request["id"])
        p = record["payload"]
        if p["state"] != "REVIEWED" or p["review"]["report_digest"] != p["report"]["digest"]:
            raise ValueError("Review this exact prepared edition before finalizing.")
        if request.get("expected_report_digest") != p["report"]["digest"]:
            raise Conflict("The prepared report changed; load its current review.")
        return self.write("load_review", {**p, "state": "FINALIZED", "finalized": now()}, request)

    def review_reopen(self, request):
        record = self.store.get("load_review", request["id"])
        if record["payload"]["state"] != "FINALIZED":
            raise ValueError("Select a finalized review to reopen.")
        p = {**record["payload"], "state": "PREPARED", "prior_finalized": self.ref(record),
             "reopen_note": text(request.get("note"), 20000, True)}
        p.pop("review", None)
        p.pop("finalized", None)
        return self.write("load_review", p, request)

    def review_export(self, request):
        from .load_forecast_export import export_review
        record = self.record("load_review", request.get("review"))
        if record["payload"]["state"] != "FINALIZED":
            raise ValueError("Finalize the selected exact review before exporting.")
        files, summary = export_review(self.store, record)
        manifest = {"schema": "commons.load-forecast-export.v1", "review": self.ref(record),
            "report_sha256": record["payload"]["report"]["digest"], "files": [
                {"name": name, "bytes": len(data), "sha256": digest(data)} for name, data in sorted(files.items())]}
        files["manifest.json"] = (encoded(manifest) + "\n").encode()
        from .load_forecast_receive import validate_delivery_members
        validate_delivery_members([(name, len(content)) for name, content in files.items()])
        from .service import package_files
        package = self.store.blob(package_files(files), "Load_Forecast_Review_Complete.zip", "application/zip")
        return self.write("load_export", {"label": record["payload"]["label"] + " — finalized r" + str(record["revision"]),
            "review": self.ref(record), "package": package, "manifest": self.json_blob(manifest, "load-export-manifest.json"),
            "workbook": self.store.blob(files["Load_Forecast_Review.xlsx"], "Load_Forecast_Review.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
            "analyst_report": self.store.blob(files["Load_Forecast_Review.html"], "Load_Forecast_Review.html", "text/html"),
            "summary": summary, "files": len(files)})

    def delivery_receive(self, request):
        from .load_forecast_receive import inspect_delivery
        try:
            data = base64.b64decode(request["base64"], validate=True)
        except (ValueError, KeyError):
            raise ValueError("Choose a complete load-forecast review export.") from None
        inspected, files = inspect_delivery(data)
        package = self.store.blob(data, "Load_Forecast_Review_Complete.zip", "application/zip")
        retained = {}
        for name, content in files.items():
            retained[name] = self.store.blob(content, Path(name).name)
        return self.write("load_received", {"label": inspected["review"]["payload"]["label"],
            "state": "RECEIVED", "package": package, "manifest": inspected["manifest"],
            "review": inspected["review"], "report": retained["report.json"],
            "retained": retained, "received": now(), "origin_package_sha256": package["digest"]})

    def delivery_adopt(self, request):
        from .load_forecast_receive import adopt_delivery
        record = self.record("load_received", request.get("received"))
        return adopt_delivery(self, record, request)

    def preview(self, request):
        kind = request.get("kind")
        if kind not in KINDS:
            raise ValueError("Choose a load-forecast source, review or received package.")
        record = self.store.get(kind, request["id"], request.get("revision"))
        p = record["payload"]
        offset = integer(request.get("offset", 0), 0, MAX_ROWS, "Row offset")
        limit = integer(request.get("limit", 50), 1, 500, "Page size")
        table = request.get("table", "overview")
        if kind == "load_source":
            if table == "sheet":
                sheet = request.get("sheet", next((s["name"] for s in p["inspection"]["sheets"]), ""))
                info = next((s for s in p["inspection"]["sheets"] if s["name"] == sheet), None)
                if not info:
                    raise ValueError("Select an original sheet.")
                column_offset = integer(request.get("column_offset", 0), 0, 16383, "Column offset")
                last = min(info["rows"], offset + limit)
                end_col = min(info["columns"], column_offset + 20)
                if offset >= info["rows"] or column_offset >= info["columns"]:
                    rows = []
                else:
                    rows = sheet_rows(self.store.bytes(p["original"]["digest"]), p["inspection"], sheet,
                                      offset + 1, last, end_col)
                    rows = [{"row": offset + i + 1, "cells": row[column_offset:end_col]} for i, row in enumerate(rows)]
                return {"record": self.ref(record), "sheet": sheet, "rows": rows, "total": info["rows"],
                    "columns": [cell_name(1, c)[:-1] for c in range(column_offset + 1, end_col + 1)],
                    "column_offset": column_offset, "total_columns": info["columns"],
                    "offset": offset, "next_offset": last if last < info["rows"] else None}
            if not p.get("normalised"):
                return {"record": self.ref(record), "rows": [], "total": 0, "next_offset": None}
            parsed = strict_json(self.store.bytes(p["normalised"]["digest"]))
            rows = parsed["missing_cells"] if table == "missing" else parsed["rows"]
        elif kind in ("load_review", "load_received"):
            report = strict_json(self.store.bytes(p["report"]["digest"]))
            if table == "overview":
                return {**{k: v for k, v in report.items() if k not in TABLES},
                        "record": self.ref(record), "issues": report["issues"],
                        "sources": [source_pin(s) for s in report["sources"]]}
            if table not in TABLES:
                raise ValueError("Select comparison, growth, explanations or issues.")
            rows = report[table]
        else:
            raise ValueError("This record has no paged source table.")
        if request.get("search"):
            needle = text(request["search"], 300).casefold()
            rows = [row for row in rows if needle in encoded(row).casefold()]
        return {"record": self.ref(record), "table": table, "rows": rows[offset:offset + limit],
            "total": len(rows), "offset": offset, "next_offset": offset + limit if offset + limit < len(rows) else None}
