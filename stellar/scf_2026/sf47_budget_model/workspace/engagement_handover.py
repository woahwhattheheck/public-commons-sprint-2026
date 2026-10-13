"""Receive sourced contributor editions through the original Forecast/Portfolio.

This module prepares complete native inputs and checks the retained outputs of
their normal writers. It opens no database or separate allocation engine.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
import json
import uuid

from model import canonical, digest, now, short_id, text
import operations_domain as domain
import operations_engagements as engagements
import forecast as forecasts
import portfolio as portfolios
import portfolio_installations

ZERO = Decimal("0")
SCHEMA = engagements.SCHEMA + ".receiving"


class _NativeValidation:
    """Reuse successful native calculations only within one receiving operation.

    Every key contains the whole original argument values and the native function.
    A changed source, snapshot, input, report or pinned plan therefore runs the
    original validator again. Nothing is shared between requests or persisted.
    """

    def __init__(self):
        self._values = {}

    def call(self, function, *args):
        try:
            before = digest(args)
        except (TypeError, ValueError, OverflowError):
            # Preserve the original validator's behavior for non-JSON input.
            return function(*args)
        key = (function, before)
        if key in self._values:
            try:
                return deepcopy(self._values[key])
            except MemoryError:
                # A cache is optional; the original native function remains valid.
                pass
        value = function(*args)
        try:
            # Only a calculation that left its complete inputs unchanged can
            # supply a later identical call. Copies never expose cached state.
            if before == digest(args):
                self._values[key] = deepcopy(value)
        except (TypeError, ValueError, OverflowError, MemoryError):
            pass
        return value


def reference(value):
    return {"id": value["id"], "sha256": value["sha256"]}


def selected_agreements(context, book, selection, saved, *, _validation=None):
    engagements.check_current(context, book)
    if (selection.get("reviewId") != book["id"] or selection.get("reviewSha256") != book["sha256"]
            or selection.get("forecastId") != saved["id"]):
        engagements.fail("Keep the exact selected engagement edition and native forecast.",
                         "ENGAGEMENT_SELECTION_CHANGED", 409)
    if _validation is None:
        portfolios.check_source(context, saved)
    else:
        _validation.call(portfolios.check_source, context, saved)
    document = book["engagements"]["document"]
    if document["asOfDate"] != saved["inputs"]["asOfDate"]:
        engagements.fail("Use the same as-of date for the agreement's remaining amounts and the original forecast.")
    values = selection.get("agreementIds")
    if (not isinstance(values, list) or not values or any(not isinstance(v, str) for v in values)
            or len(values) != len(set(values))):
        engagements.fail("Select distinct recorded agreement IDs.")
    index = {row["id"]: row for row in document["agreements"]}
    if any(value not in index for value in values):
        engagements.fail("A selected agreement is absent from the original edition.")
    chosen = [index[value] for value in values]
    as_of = date.fromisoformat(document["asOfDate"])
    for row in chosen:
        if row["acceptance"]["status"] != "CONFIRMED":
            engagements.fail("Choose confirmed agreements for the committed-resource handover.")
        confirmed = datetime.fromisoformat(row["acceptance"]["at"].replace("Z", "+00:00")).astimezone(timezone.utc).date()
        if confirmed > as_of:
            engagements.fail("The original agreement confirmation follows this remaining-work as-of date.")
        if row["endDate"] <= document["asOfDate"] and any(Decimal(x["remainingHours"]) for x in row["allocations"]):
            engagements.fail("Record the current remaining-work period for the selected agreement before allocating its hours.")
    return chosen


def contributions(chosen):
    result = {}
    for agreement in chosen:
        for allocation in agreement["allocations"]:
            value = result.setdefault(allocation["costId"], {"hours": ZERO, "cost": ZERO, "agreements": []})
            value["hours"] += Decimal(allocation["remainingHours"])
            value["cost"] += Decimal(allocation["remainingCostUsd"])
            value["agreements"].append(agreement)
    if not result:
        engagements.fail("Allocate the selected confirmed contributors to at least one original grant package.")
    return result


def forecast_preview(context, book, saved, raw, *, _validation=None):
    raw = engagements.obj(deepcopy(raw), {"reviewId", "reviewSha256", "forecastId", "agreementIds",
        "remainders", "paymentModes", "name", "note"}, "Engagement forecast selection")
    chosen = selected_agreements(context, book, raw, saved, _validation=_validation)
    allocated = contributions(chosen)
    baseline = {row["id"]: row for row in saved["report"]["packages"]}
    if set(allocated) - set(baseline):
        engagements.fail("The selected allocation is absent from the original forecast packages.")
    remainder_index, remainder_rows = {}, []
    if "remainders" in raw:
        for row in engagements.rows(raw["remainders"], "Explicit unassigned package remainders", len(allocated)):
            engagements.obj(row, {"costId", "remainingHours", "remainingCostUsd", "note"}, "Package remainder")
            cost = row.get("costId")
            if cost not in allocated or cost in remainder_index:
                engagements.fail("Enter each affected package remainder exactly once.")
            remainder_index[cost] = {"costId": cost,
                "remainingHours": domain.quantity(row.get("remainingHours"), "Unassigned remaining hours", 4),
                "remainingCostUsd": domain.usd(row.get("remainingCostUsd"), "Unassigned remaining uninvoiced cost"),
                "note": text(row.get("note", ""), "Unassigned remainder basis", 1000)}
        if set(remainder_index) != set(allocated):
            engagements.fail("Explicit remainders must cover every affected original work package.")
    else:
        for cost, amount in allocated.items():
            old = baseline[cost]
            remainder_index[cost] = {"costId": cost,
                "remainingHours": forecasts.hours(max(ZERO, Decimal(old["remainingHours"]) - amount["hours"])),
                "remainingCostUsd": forecasts.money(max(ZERO, Decimal(old["remainingCostUsd"]) - amount["cost"])),
                "note": "Original remaining package estimate less selected confirmed allocations; a larger confirmed allocation increases the reviewed total."}
    modes = {}
    if "paymentModes" in raw:
        for row in engagements.rows(raw["paymentModes"], "Reviewed package payment modes", len(allocated)):
            engagements.obj(row, {"costId", "paymentMode", "note"}, "Package payment mode")
            cost = row.get("costId")
            if cost not in allocated or cost in modes:
                engagements.fail("Enter each affected package payment mode exactly once.")
            modes[cost] = {"costId": cost, "paymentMode": domain.enum(row.get("paymentMode"),
                ("original", "accrual", "completion"), "Original Forecast payment mode"),
                "note": text(row.get("note", ""), "Reviewed payment timing basis", 1000)}
        if set(modes) != set(allocated):
            engagements.fail("Explicit payment modes must cover every affected original package.")
    else:
        for cost, amount in allocated.items():
            values = {row["compensation"]["paymentMode"] for row in amount["agreements"]}
            if len(values) != 1:
                engagements.fail(cost + ": choose the reviewed native payment schedule for the combined package.")
            modes[cost] = {"costId": cost, "paymentMode": next(iter(values)),
                "note": "Common native payment mode from the selected original contributor agreements."}

    selection = {"reviewId": book["id"], "reviewSha256": book["sha256"], "forecastId": saved["id"],
        "agreementIds": list(raw["agreementIds"]),
        "remainders": [remainder_index[key] for key in sorted(allocated)],
        "paymentModes": [modes[key] for key in sorted(allocated)],
        "name": text(raw.get("name") or "Agreed delivery — " + book["engagements"]["document"]["name"],
                     "Received forecast name", 300, True),
        "note": text(raw.get("note", ""), "Contributor forecast basis", 4000)}
    inputs = deepcopy(saved["inputs"])
    inputs["name"] = selection["name"]
    inputs["note"] = text(inputs.get("note", "") + "\n\nContributor agreement edition " + book["id"] +
        ". " + selection["note"], "Complete forecast basis", 12000)
    overrides = {row["costId"]: deepcopy(row) for row in inputs["packageOverrides"]}
    projection = []
    first = (date.fromisoformat(inputs["asOfDate"]) + timedelta(days=1)).isoformat()
    for cost in sorted(allocated):
        amount, remainder, mode, old = allocated[cost], remainder_index[cost], modes[cost], baseline[cost]
        remaining_hours = amount["hours"] + Decimal(remainder["remainingHours"])
        remaining_cost = amount["cost"] + Decimal(remainder["remainingCostUsd"])
        starts = [max(first, row["startDate"]) for row in amount["agreements"]]
        ends = [max(first, row["endDate"]) for row in amount["agreements"]]
        if Decimal(remainder["remainingHours"]) or Decimal(remainder["remainingCostUsd"]):
            starts.append(old["startDate"])
            ends.append(old["endDate"])
        original = overrides.get(cost, {"costId": cost, "remainingCostUsd": None, "remainingHours": None,
            "startDate": None, "endDate": None, "paymentMode": "original", "directCashIds": [], "note": ""})
        original.update({"remainingHours": forecasts.hours(remaining_hours),
            "remainingCostUsd": forecasts.money(remaining_cost), "startDate": min(starts), "endDate": max(ends),
            "paymentMode": mode["paymentMode"],
            "note": text("Contributor agreement edition " + book["id"] + "; confirmed allocations " +
                forecasts.hours(amount["hours"]) + " hours / USD " + forecasts.money(amount["cost"]) +
                "; unassigned remainder " + remainder["remainingHours"] + " hours / USD " + remainder["remainingCostUsd"] +
                ". " + remainder["note"] + " " + mode["note"], "Package receiving basis", 4000)})
        overrides[cost] = original
        projection.append({"costId": cost, "engagementIds": [row["id"] for row in amount["agreements"]],
            "originalHours": old["remainingHours"], "originalCostUsd": old["remainingCostUsd"],
            "confirmedHours": forecasts.hours(amount["hours"]), "confirmedCostUsd": forecasts.money(amount["cost"]),
            "remainderHours": remainder["remainingHours"], "remainderCostUsd": remainder["remainingCostUsd"],
            "remainingHours": original["remainingHours"], "remainingCostUsd": original["remainingCostUsd"],
            "hoursDelta": forecasts.hours(remaining_hours - Decimal(old["remainingHours"])),
            "costDeltaUsd": forecasts.money(remaining_cost - Decimal(old["remainingCostUsd"])),
            "paymentMode": mode["paymentMode"], "directCashIds": deepcopy(original["directCashIds"]),
            "startDate": original["startDate"], "endDate": original["endDate"]})
    existing_order = [row["costId"] for row in inputs["packageOverrides"]]
    inputs["packageOverrides"] = [overrides[key] for key in existing_order] + [
        overrides[key] for key in sorted(set(overrides) - set(existing_order))]
    candidate = (forecasts.preview(context, inputs) if _validation is None else
                 _validation.call(forecasts.preview, context, inputs))
    return {"selection": selection, "inputs": candidate["inputs"], "forecast": candidate,
        "projection": {"packages": projection, "timingBasis": candidate["report"].get("paymentTimingBasis",
            "Each original package uses its selected native Forecast payment mode and retains its original direct payments.")},
        "source": {"book": reference(book), "baseForecast": reference(saved),
                   "bindingSha256": book["engagements"]["source"]["bindingSha256"],
                   "selectionSha256": digest(selection)}}


def resource(agreement, person, resource_id, calendar):
    # apply() has normalized this exact calendar against the original saved forecast.
    normalized = calendar
    start = date.fromisoformat(normalized["startDate"])
    end = start + timedelta(days=normalized["horizonDays"] - 1)
    overrides = {stamp: value for stamp, value in agreement["availability"]["hoursByDate"].items()
                 if start.isoformat() <= stamp <= end.isoformat()}
    for offset in range(normalized["horizonDays"]):
        stamp = (start + timedelta(days=offset)).isoformat()
        if stamp < agreement["startDate"] or stamp > agreement["endDate"]:
            overrides[stamp] = "0"
    return {"id": resource_id, "name": person["name"],
        "hoursByWeekday": deepcopy(agreement["availability"]["hoursByWeekday"]),
        "hoursByDate": dict(sorted(overrides.items())),
        "note": text("Confirmed " + agreement["role"] + ": " + agreement["startDate"] + " through " +
            agreement["endDate"] + ". " + agreement["availability"]["note"],
            "Received contributor availability", 12000)}


def portfolio_preview(context, book, saved, raw, *, _validation=None):
    raw = engagements.obj(deepcopy(raw), {"reviewId", "reviewSha256", "forecastId", "agreementIds",
        "resourceMap", "inputs", "name", "note"}, "Engagement portfolio selection")
    chosen = selected_agreements(context, book, raw, saved, _validation=_validation)
    allocated = contributions(chosen)
    mapping, resource_ids = {}, set()
    for row in engagements.rows(raw.get("resourceMap"), "Named resource mappings", len(chosen)):
        engagements.obj(row, {"engagementId", "resourceId"}, "Resource mapping")
        agreement_id = row.get("engagementId")
        if agreement_id not in {r["id"] for r in chosen} or agreement_id in mapping:
            engagements.fail("Map every selected agreement exactly once.")
        resource_id = short_id(row.get("resourceId"), "Original or new Portfolio resource ID")
        if resource_id in resource_ids:
            engagements.fail("Each named contributor needs a distinct resource in the shared allocation.")
        resource_ids.add(resource_id)
        mapping[agreement_id] = resource_id
    if set(mapping) != {row["id"] for row in chosen}:
        engagements.fail("Map every selected confirmed contributor to a Portfolio resource.")

    original_inputs = deepcopy(raw["inputs"]) if "inputs" in raw else portfolios.seed(context, saved)["inputs"]
    if not isinstance(original_inputs, dict):
        engagements.fail("Retain a complete original Portfolio input object.")
    inputs = deepcopy(original_inputs)
    inputs.update({"forecastId": saved["id"], "forecastSha256": saved["sha256"],
        "name": text(raw.get("name") or "Committed allocation — " + book["engagements"]["document"]["name"],
                     "Received allocation name", 300, True)})
    note = text(raw.get("note", ""), "Contributor allocation basis", 4000)
    inputs["note"] = text(inputs.get("note", "") + "\n\nContributor agreement edition " + book["id"] +
        ". " + note, "Complete allocation basis", 12000)
    people = {row["id"]: row for row in context["records"]["contributors"]}
    original_fields = {key: deepcopy(inputs.get(key)) for key in ("calendar", "resources", "tasks")}
    if not isinstance(original_fields["resources"], list) or not isinstance(original_fields["tasks"], list):
        engagements.fail("Retain the complete original resources and source-task array.")
    changes = []

    def apply(fields, alternative_id):
        calendar = portfolios.normalize_calendar(fields["calendar"], saved)
        old_resources = portfolios.normalize_resources(fields["resources"])
        lookup = {row["id"]: deepcopy(row) for row in old_resources}
        for agreement in chosen:
            rid = mapping[agreement["id"]]
            previous = lookup.get(rid)
            lookup[rid] = resource(agreement, people[agreement["contributorId"]], rid, calendar)
            changes.append({"alternativeId": alternative_id, "engagementId": agreement["id"],
                "contributorId": agreement["contributorId"], "resourceId": rid,
                "replacesExistingResource": previous is not None,
                "period": {"startDate": agreement["startDate"], "endDate": agreement["endDate"]},
                "beforeResourceSha256": digest(previous) if previous else None,
                "resourceSha256": digest(lookup[rid])})
        order = [row["id"] for row in old_resources]
        resources = [lookup[rid] for rid in order] + [lookup[rid] for rid in sorted(set(lookup) - set(order))]
        tasks = deepcopy(fields["tasks"])
        task_ids = [row.get("id") for row in tasks if isinstance(row, dict)]
        if len(task_ids) != len(tasks) or len(task_ids) != len(set(task_ids)):
            engagements.fail("Retain the original complete distinct task assignments.")
        task_map = {row["id"]: row for row in tasks}
        for cost, amount in allocated.items():
            task = task_map.get("package/" + cost)
            if task is None or not isinstance(task.get("effortHours"), dict):
                engagements.fail("The original grant-package task is unavailable in the selected full allocation.")
            effort = deepcopy(task["effortHours"])
            for rid in resource_ids:
                effort.pop(rid, None)
            for agreement in amount["agreements"]:
                value = next(row for row in agreement["allocations"] if row["costId"] == cost)
                effort[mapping[agreement["id"]]] = value["remainingHours"]
            task["effortHours"] = effort
        return {"calendar": calendar, "resources": resources, "tasks": tasks}

    updated = apply(original_fields, "base")
    inputs.update(updated)
    alternatives = original_inputs.get("alternatives", [])
    if not isinstance(alternatives, list):
        engagements.fail("Retain the complete original allocation alternatives.")
    updated_alternatives = []
    for alternative in alternatives:
        if not isinstance(alternative, dict):
            engagements.fail("Retain complete original allocation alternative objects.")
        changed = deepcopy(alternative)
        fields = {key: deepcopy(alternative.get(key, original_fields[key])) for key in original_fields}
        applied = apply(fields, alternative.get("id"))
        changed["resources"] = applied["resources"]
        changed["tasks"] = applied["tasks"]
        # The original calendar/Installation phase selections stay exactly authored.
        updated_alternatives.append(changed)
    inputs["alternatives"] = updated_alternatives
    candidate = (portfolios.preview(context, saved, inputs) if _validation is None else
                 _validation.call(portfolios.preview, context, saved, inputs))
    selection = {"reviewId": book["id"], "reviewSha256": book["sha256"], "forecastId": saved["id"],
        "agreementIds": list(raw["agreementIds"]),
        "resourceMap": [{"engagementId": row["id"], "resourceId": mapping[row["id"]]} for row in chosen],
        "inputs": original_inputs, "name": inputs["name"], "note": note}
    return {"selection": selection, "inputs": candidate["inputs"], "portfolio": candidate,
        "projection": {"resources": changes, "affectedPackageIds": sorted(allocated),
                       "comparison": deepcopy(candidate["report"]["comparison"])},
        "source": {"book": reference(book), "forecast": reference(saved),
                   "bindingSha256": book["engagements"]["source"]["bindingSha256"],
                   "selectionSha256": digest(selection)}}


def lookup_forecast(operations, context, forecast_id, *, _validation=None):
    value = operations._portfolio_forecast(context["program"]["id"], forecast_id)
    if _validation is None:
        forecasts.validate_saved(value, context["plan"])
    else:
        _validation.call(forecasts.validate_saved, value, context["plan"])
    return value


def preview_forecast(operations, context, selection):
    book = engagements.raw_review(operations, context["program"]["id"], selection.get("reviewId"))
    saved = lookup_forecast(operations, context, selection.get("forecastId"))
    return forecast_preview(context, book, saved, selection)


def preview_portfolio(operations, context, selection):
    book = engagements.raw_review(operations, context["program"]["id"], selection.get("reviewId"))
    saved = lookup_forecast(operations, context, selection.get("forecastId"))
    context = portfolio_installations.capture(operations, context, selection.get("inputs"))
    return portfolio_preview(context, book, saved, selection)


def validate_join(book, saved_forecast, saved_portfolio, base_forecast, data, pinned_plan=None,
                  *, _validation=None):
    validation = _validation if _validation is not None else _NativeValidation()
    validation.call(engagements.validate_review, book, pinned_plan)
    validation.call(forecasts.validate_saved, base_forecast, pinned_plan)
    validation.call(forecasts.validate_saved, saved_forecast, pinned_plan)
    validation.call(portfolios.validate_saved, saved_portfolio, pinned_plan)
    if (data.get("reviewId") != book["id"] or data.get("reviewSha256") != book["sha256"]
            or data.get("forecastId") != saved_forecast["id"] or data.get("portfolioId") != saved_portfolio["id"]):
        engagements.fail("Keep the complete original agreement, forecast and allocation selection.", "ENGAGEMENT_RECEIVING_CHANGED", 409)
    finance = forecast_preview(saved_forecast["snapshot"], book, base_forecast, data["forecastSelection"],
                               _validation=validation)
    allocation = portfolio_preview(saved_portfolio["snapshot"], book, saved_forecast, data["portfolioSelection"],
                                   _validation=validation)
    if (data["forecastSelection"] != finance["selection"] or data["portfolioSelection"] != allocation["selection"]
            or saved_forecast["inputs"] != finance["inputs"] or saved_forecast["report"] != finance["forecast"]["report"]
            or saved_portfolio["inputs"] != allocation["inputs"] or saved_portfolio["report"] != allocation["portfolio"]["report"]
            or saved_portfolio["baseForecastSnapshot"] != saved_forecast):
        engagements.fail("The saved native outputs differ from the complete reviewed contributor handover.",
                         "ENGAGEMENT_RECEIVING_CHANGED", 409)
    return finance, allocation


def receive(operations, context, data, actor, next_version, note):
    engagements.obj(data, {"reviewId", "reviewSha256", "forecastId", "portfolioId",
                           "forecastSelection", "portfolioSelection"}, "Complete contributor receiving")
    if not isinstance(data.get("forecastSelection"), dict) or not isinstance(data.get("portfolioSelection"), dict):
        engagements.fail("Retain both complete normalized native handover selections.")
    book = engagements.raw_review(operations, context["program"]["id"], data.get("reviewId"))
    engagements.check_current(context, book)
    validation = _NativeValidation()
    saved_forecast = lookup_forecast(operations, context, data.get("forecastId"), _validation=validation)
    base = lookup_forecast(operations, context, data["forecastSelection"].get("forecastId"), _validation=validation)
    raw = operations.db.execute("SELECT body_json FROM ops_portfolios WHERE program_id=? AND id=?",
                                (context["program"]["id"], data.get("portfolioId"))).fetchone()
    if not raw:
        engagements.fail("The original saved allocation is unavailable.", "PORTFOLIO_NOT_FOUND", 404)
    saved_portfolio = json.loads(raw[0])
    finance, allocation = validate_join(book, saved_forecast, saved_portfolio, base, data, context["plan"],
                                        _validation=validation)
    snapshot = operations._business(context)
    received = {"schema": SCHEMA, "engineVersion": engagements.ENGINE_VERSION,
        "book": reference(book), "baseForecast": reference(base), "forecast": reference(saved_forecast),
        "portfolio": reference(saved_portfolio), "forecastSelection": finance["selection"],
        "portfolioSelection": allocation["selection"],
        "financialProjection": finance["projection"], "allocationProjection": allocation["projection"],
        "allocationStatus": saved_portfolio["report"]["alternatives"][0]["status"],
        "readyAlternativeIds": [row["id"] for row in saved_portfolio["report"]["alternatives"] if row["status"] == "READY"]}
    review = {"id": "review-" + uuid.uuid4().hex, "version": next_version, "createdAt": now(),
        "actor": actor, "note": note, "purpose": engagements.RECEIVING_PURPOSE,
        "businessSha256": digest(snapshot), "snapshot": snapshot, "report": domain.report(**context),
        "engagementReceiving": received}
    review["sha256"] = digest(review)
    validate_receiving(review, {book["id"]: book}, [base, saved_forecast], [saved_portfolio], context["plan"],
                       _validation=validation)
    operations.db.execute("INSERT INTO ops_reviews VALUES(?,?,?)",
                          (context["program"]["id"], review["id"], canonical(review)))
    return {"before": None, "after": engagements.receiving_summary(review), "kind": "review",
            "recordId": review["id"], "reviewSha256": review["sha256"],
            "book": reference(book), "forecast": reference(saved_forecast), "portfolio": reference(saved_portfolio)}


def _validate_receiving(review, books, saved_forecasts, saved_portfolios, pinned_plan=None,
                        *, _validation=None):
    if not isinstance(review, dict) or review.get("purpose") != engagements.RECEIVING_PURPOSE:
        engagements.fail("Select a complete contributor receiving review.")
    engagements.ident(review.get("id"), "Original receiving review")
    domain.integer(review.get("version"), "Receiving save version", 2, 10000000)
    domain.timestamp(review.get("createdAt"), "Receiving save timestamp")
    text(review.get("actor"), "Receiving operator", 300, True)
    if (digest({key: value for key, value in review.items() if key != "sha256"}) != review.get("sha256")
            or digest(review["snapshot"]) != review.get("businessSha256")):
        engagements.fail("The complete contributor receiving review changed.", "ENGAGEMENT_RECEIVING_CHANGED", 409)
    value = review["engagementReceiving"]
    if value.get("schema") != SCHEMA or value.get("engineVersion") != engagements.ENGINE_VERSION:
        engagements.fail("Use the supported complete contributor receiving edition.")
    forecasts_by_id = {row["id"]: row for row in saved_forecasts}
    portfolios_by_id = {row["id"]: row for row in saved_portfolios}
    book = books.get(value["book"]["id"])
    base = forecasts_by_id.get(value["baseForecast"]["id"])
    forecast = forecasts_by_id.get(value["forecast"]["id"])
    portfolio = portfolios_by_id.get(value["portfolio"]["id"])
    if any(item is None for item in (book, base, forecast, portfolio)):
        engagements.fail("The complete case is missing an original receiving component.")
    for label, original in (("book", book), ("baseForecast", base), ("forecast", forecast), ("portfolio", portfolio)):
        if reference(original) != value[label] or original["version"] >= review["version"]:
            engagements.fail("An original receiving component differs from its retained selection.")
    finance, allocation = validate_join(book, forecast, portfolio, base, {
        "reviewId": book["id"], "reviewSha256": book["sha256"], "forecastId": forecast["id"],
        "portfolioId": portfolio["id"], "forecastSelection": value["forecastSelection"],
        "portfolioSelection": value["portfolioSelection"]}, pinned_plan, _validation=_validation)
    if finance["projection"] != value["financialProjection"] or allocation["projection"] != value["allocationProjection"]:
        engagements.fail("The contributor receiving projections differ from the original native outputs.")
    if (value.get("allocationStatus") != portfolio["report"]["alternatives"][0]["status"]
            or value.get("readyAlternativeIds") != [row["id"] for row in portfolio["report"]["alternatives"] if row["status"] == "READY"]):
        engagements.fail("The retained allocation outcome differs from the original native comparison.")
    return review


def validate_receiving(review, books, saved_forecasts, saved_portfolios, pinned_plan=None,
                       *, _validation=None):
    try:
        return _validate_receiving(review, books, saved_forecasts, saved_portfolios, pinned_plan,
                                   _validation=_validation)
    except (KeyError, TypeError, ValueError, AttributeError, ArithmeticError, IndexError) as error:
        from model import Problem
        if isinstance(error, Problem):
            raise
        engagements.fail("The complete contributor receiving record is unreadable: " + str(error))
