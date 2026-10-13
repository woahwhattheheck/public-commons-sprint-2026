#!/usr/bin/env python3
"""Receive native-currency planning through the original SF47 Workspace.

This caller consumes a private, source-bound configuration and a complete original
case. It does not contact customers, record business cash or alter the source case.
Run prepare, the companion browser flow, then verify in a fresh Python process.
"""
from __future__ import annotations

import argparse
import base64
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal, ROUND_HALF_UP
import fcntl
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import sqlite3
import sys
import tempfile
import zipfile

SCHEMA = "stellar-forge.sf47-currency-receiving.v1"


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def git_blob(raw):
    return hashlib.sha1(b"blob " + str(len(raw)).encode() + b"\0" + raw).hexdigest()


def require(value, message):
    if not value:
        raise RuntimeError(message)


def json_read(path):
    return json.loads(Path(path).read_bytes())


def atomic_bytes(path, raw):
    """Publish a complete immutable artifact; never replace an earlier result."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        require(path.is_file() and path.read_bytes() == raw, "Retained artifact differs: " + str(path))
        return raw
    fd, name = tempfile.mkstemp(prefix="." + path.name + ".", suffix=".part", dir=path.parent)
    temp = Path(name)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        try:
            os.link(temp, path)
        except FileExistsError:
            require(path.read_bytes() == raw, "A concurrent artifact differs: " + str(path))
        directory_fd = os.open(path.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
        return raw
    finally:
        temp.unlink(missing_ok=True)


def atomic_json(path, value):
    atomic_bytes(path, (canonical(value) + "\n").encode())
    return value


def once_json(path, function):
    return json_read(path) if Path(path).is_file() else atomic_json(path, function())


def once_bytes(path, function):
    return Path(path).read_bytes() if Path(path).is_file() else atomic_bytes(path, function())


def file_identity(path):
    path = Path(path)
    raw = path.read_bytes()
    return {"path": str(path.resolve()), "bytes": len(raw), "sha256": sha(raw)}


def retained_input(out, key, descriptor):
    require(isinstance(descriptor, dict), "Original input descriptor is required: " + key)
    expected = descriptor["sha256"]
    filename = descriptor["filename"]
    require(isinstance(filename, str) and filename and Path(filename).name == filename
            and filename not in (".", "..") and "/" not in filename and "\\" not in filename,
            "Use one plain retained input filename: " + key)
    target = out / "inputs" / filename
    raw = target.read_bytes() if target.is_file() else Path(descriptor["path"]).read_bytes()
    require(sha(raw) == expected and len(raw) == descriptor["bytes"], "Original input changed: " + key)
    if descriptor.get("gitBlob"):
        require(git_blob(raw) == descriptor["gitBlob"], "Original Git source changed: " + key)
    atomic_bytes(target, raw)
    return raw, target


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def original_snapshot(value):
    return {key: item for key, item in value.items() if key != "current"}


class Receiving:
    def __init__(self, config, out):
        self.config, self.out = config, out
        self.operation = config["operationId"]
        self.actor = config["actor"]
        self.source_root = Path(config["sourceRoot"]).resolve()
        require(self.source_root.is_dir(), "The complete original source root is unavailable.")
        require(out != self.source_root and not out.is_relative_to(self.source_root), "Keep receiving state outside product source.")
        repository = Path(config["repositoryRoot"]).resolve()
        require(self.source_root.is_relative_to(repository), "The workspace source must belong to the selected repository.")
        source_pins = config.get("sourcePins")
        require(isinstance(source_pins, list) and source_pins, "Retain the complete selected native source inventory.")
        inventory = []
        seen_paths = set()
        for item in source_pins:
            relative = Path(item["path"])
            require(not relative.is_absolute() and ".." not in relative.parts and item["path"] not in seen_paths,
                    "Use distinct repository-relative product source paths.")
            seen_paths.add(item["path"])
            path = (repository / relative).resolve()
            require(path.is_relative_to(repository), "The product source escapes its selected repository.")
            raw = path.read_bytes()
            require(len(raw) == item["bytes"] and git_blob(raw) == item["gitBlob"], "Product Git source differs: " + item["path"])
            if item.get("sha256"):
                require(sha(raw) == item["sha256"], "Product source hash differs: " + item["path"])
            inventory.append({"path": item["path"], "bytes": len(raw), "gitBlob": git_blob(raw), "sha256": sha(raw)})
        atomic_json(out / "SOURCE_INVENTORY.json", {"sourceCommit": config["sourceCommit"], "files": inventory})
        sys.path.insert(0, str(self.source_root))
        import model
        import operations
        import forecast
        import portfolio
        import forecast_currency
        self.model, self.operations = model, operations
        self.forecast, self.portfolio, self.currency = forecast, portfolio, forecast_currency
        self.workspace, self.ops = None, None
        self.workspace_root = out / "workspace"
        self.seed_source = self.source_root.parent / config.get("scenarioFile", "sf10_current_candidate.json")
        self.inputs = {}
        for key, item in config["inputs"].items():
            raw, path = retained_input(out, key, item)
            self.inputs[key] = {"raw": raw, "path": path, "descriptor": item}

    def open(self):
        require(self.workspace is None, "Receiving already owns its native workspace.")
        self.workspace = self.model.Workspace(self.workspace_root, self.seed_source)
        self.ops = self.operations.Operations(self.workspace)

    def close(self):
        if self.workspace is not None:
            self.workspace.close()
            self.workspace, self.ops = None, None

    def reopen(self):
        self.close()
        self.open()

    def command(self, key, case_id, action, data, replay_after_reopen=False):
        directory = self.out / "commands"
        request = directory / (key + ".request.json")
        reply = directory / (key + ".result.json")
        if reply.is_file():
            body, result = json_read(request), json_read(reply)
            require(body["action"] == action and body["data"] == data, "Retained command intent differs: " + key)
            replay = self.ops.command(case_id, body)
            require(replay == result, "Original command readback differs: " + key)
            return result
        if request.is_file():
            body = json_read(request)
            require(body["action"] == action and body["data"] == data, "Pending command intent differs: " + key)
        else:
            body = {"expectedVersion": self.ops.read(case_id)["program"]["version"],
                    "actor": self.actor, "requestId": self.operation + "-" + key,
                    "note": "Isolated original-case currency receiving: " + key,
                    "action": action, "data": data}
            atomic_json(request, body)
        result = self.ops.command(case_id, body)
        # The original transaction committed before its result is durably published.
        # Reopen the original store and recover this same exact request.
        if replay_after_reopen:
            self.reopen()
        repeated = self.ops.command(case_id, body)
        require(repeated == result, "Same-request native replay differs: " + key)
        atomic_json(reply, result)
        return result

    def save_forecast(self, key, case_id, inputs, replay_after_reopen=False):
        candidate = once_json(self.out / "previews" / (key + ".json"),
            lambda: self.ops.preview_forecast(case_id, {
                "expectedVersion": self.ops.read(case_id)["program"]["version"], "inputs": inputs}))
        require(candidate["inputs"] == self.forecast.normalize(self.ops._context(case_id), inputs),
                "Retained forecast input differs: " + key)
        result = self.command(key, case_id, "forecast.save",
            {"inputs": candidate["inputs"], "expectedPreviewSha256": candidate["previewSha256"]},
            replay_after_reopen)
        value = original_snapshot(self.ops.forecast(case_id, result["recordId"]))
        self.forecast.validate_saved(value)
        atomic_json(self.out / "saved" / (key + ".json"), value)
        return value

    def save_portfolio(self, key, case_id, forecast):
        def prepare_inputs():
            seed = self.ops.seed_portfolio(case_id, {
                "expectedVersion": self.ops.read(case_id)["program"]["version"], "forecastId": forecast["id"]})
            inputs = seed["inputs"]
            inputs["name"] = self.config["name"] + " / " + key
            inputs["resources"] = [deepcopy(self.config["allocationResource"])]
            inputs["calendar"] = {"startDate": forecast["report"]["firstForecastDate"],
                                  "horizonDays": self.config.get("allocationHorizonDays", 730),
                                  "weekdays": [0, 1, 2, 3, 4], "holidays": [], "extraWorkingDates": []}
            index = {row["id"]: row for row in seed["sourceTasks"]}
            resource_id = inputs["resources"][0]["id"]
            for task in inputs["tasks"]:
                source = index[task["id"]]
                task["effortHours"] = {resource_id: source["remainingHours"]}
                task["dependsOn"] = []
                if "timing" in source:
                    task["releaseDate"] = source["timing"]["reviewedReleaseDate"] or inputs["calendar"]["startDate"]
                else:
                    task["releaseDate"] = source["startDate"] or inputs["calendar"]["startDate"]
                task["priority"] = 10 if source["sourceId"] == self.config["commercial"]["id"] else 100
                task["note"] = "Explicit receiving allocation assumption; no staff booking, client acceptance or observed payment is created."
            inputs["note"] = "The original amounts and sources remain unchanged. Entered team capacity and release assumptions are a separate planning comparison."
            return inputs
        inputs = once_json(self.out / "inputs" / (key + ".json"), prepare_inputs)
        candidate = once_json(self.out / "previews" / (key + ".json"),
            lambda: self.ops.preview_portfolio(case_id, {
                "expectedVersion": self.ops.read(case_id)["program"]["version"], "inputs": inputs}))
        require(candidate["report"]["alternatives"][0]["status"] == "READY",
                "Original allocation did not finish; inspect its retained findings.")
        result = self.command(key, case_id, "portfolio.save",
            {"inputs": candidate["inputs"], "expectedPreviewSha256": candidate["previewSha256"]})
        value = original_snapshot(self.ops.portfolio(case_id, result["recordId"]))
        self.portfolio.validate_saved(value)
        atomic_json(self.out / "saved" / (key + ".json"), value)
        raw = once_bytes(self.out / "exports" / (key + ".zip"), lambda: self.ops.export_portfolio(case_id, value["id"]))
        verify_zip(raw)
        return value

    def attach(self, case_id, key):
        item = self.inputs[key]
        descriptor = item["descriptor"]
        result = self.command("source-" + key, case_id, "source.add", {
            "filename": descriptor["filename"], "mediaType": descriptor["mediaType"],
            "kind": "other", "sourceUrl": descriptor["sourceUrl"],
            "observedAt": descriptor["observedAt"],
            "contentBase64": base64.b64encode(item["raw"]).decode()})
        metadata, raw = self.ops.source(case_id, result["recordId"])
        require(raw == item["raw"] and metadata["sha256"] == descriptor["sha256"],
                "Attached original source readback differs: " + key)
        return result["recordId"]


def verify_zip(raw):
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        names = archive.namelist()
        require(len(names) == len(set(names)), "Export repeats a member.")
        manifest = json.loads(archive.read("MANIFEST.json"))
        rows = manifest["files"]
        require({row["path"] for row in rows} == set(names) - {"MANIFEST.json"}, "Export manifest is incomplete.")
        for row in rows:
            member = archive.read(row["path"])
            require(len(member) == row["bytes"] and sha(member) == row["sha256"], "Export member differs: " + row["path"])
        return {"bytes": len(raw), "sha256": sha(raw), "members": len(names)}


def check_legacy(ctx, document):
    old_forecast = load_module("sf47_original_forecast_receiving", ctx.inputs["originalForecast"]["path"])
    old_portfolio = load_module("sf47_original_portfolio_receiving", ctx.inputs["originalPortfolio"]["path"])
    old_portfolio.forecasts = old_forecast
    facts = {"forecasts": [], "portfolios": []}
    for value in document["forecasts"]:
        require("fxRates" not in value["inputs"] and "currencyValuation" not in value["report"],
                "The supplied baseline is not the selected legacy case.")
        before = canonical(value)
        old_forecast.validate_saved(value, document["plan"])
        ctx.forecast.validate_saved(value, document["plan"])
        old_export, new_export = old_forecast.export(value), ctx.forecast.export(value)
        require(old_export == new_export, "Legacy forecast export changed: " + value["id"])
        require(canonical(value) == before, "Legacy forecast source was mutated.")
        facts["forecasts"].append({"id": value["id"], "sha256": value["sha256"],
                                  "previewSha256": value["previewSha256"], "export": verify_zip(new_export)})
    for value in document["portfolios"]:
        before = canonical(value)
        old_portfolio.validate_saved(value, document["plan"])
        ctx.portfolio.validate_saved(value, document["plan"])
        old_export, new_export = old_portfolio.export(value), ctx.portfolio.export(value)
        require(old_export == new_export, "Legacy portfolio export changed: " + value["id"])
        require(canonical(value) == before, "Legacy portfolio source was mutated.")
        facts["portfolios"].append({"id": value["id"], "sha256": value["sha256"],
                                   "previewSha256": value["previewSha256"], "export": verify_zip(new_export)})
    return facts


def roll_forward(inputs, as_of):
    result, changes = deepcopy(inputs), []
    original_as_of = result["asOfDate"]
    delta = (date.fromisoformat(as_of) - date.fromisoformat(original_as_of)).days
    require(delta >= 0, "Receiving may not move the original as-of date backwards.")
    result["asOfDate"] = as_of
    if delta:
        def shift(row, field, path):
            if row.get(field):
                old = row[field]
                row[field] = (date.fromisoformat(old) + timedelta(days=delta)).isoformat()
                changes.append({"path": path + "." + field, "before": old, "after": row[field]})
        for group, fields in (("packageOverrides", ("startDate", "endDate")),
                              ("invoiceOverrides", ("dueDate",)), ("grantReceipts", ("date",))):
            for index, row in enumerate(result[group]):
                for field in fields:
                    shift(row, field, group + "/" + str(index))
        for index, row in enumerate(result["commercial"]):
            for field in ("startDate", "endDate"):
                shift(row, field, "commercial/" + str(index))
            for ordinal, receipt in enumerate(row["receipts"]):
                shift(receipt, "date", "commercial/" + str(index) + "/receipts/" + str(ordinal))
        # Original reviewed event triggers stay fixed; only this new forecast's
        # explicitly entered future work and cash dates are shifted.
    return result, {"originalAsOfDate": original_as_of, "asOfDate": as_of,
                    "changes": changes, "originalReviewedEventTriggersPreserved": True,
                    "basis": "Explicit receiving scenario roll-forward; original saved forecasts and actual record dates are unchanged."}


def native_credit_checks(ctx, rate):
    """Controlled helper calculations, never business cash or invoice records."""
    currency = ctx.currency
    rate = deepcopy(rate)
    rate["id"] = "controlled-native-credit-rate"
    source = {"price": {"amount": "1000", "currency": rate["quoteCurrency"] if rate["baseCurrency"] == "USD" else rate["baseCurrency"], "fxRateId": rate["id"]},
              "deliveryCost": {"amount": "100", "currency": "USD", "fxRateId": None},
              "priceCredits": [], "costCredits": []}
    row = {"id": "controlled-receiving-only", "nativePricing": source,
           "cashIds": ["controlled-cash"], "invoiceIds": [], "directCashIds": [],
           "receipts": [{"id": "first", "label": "Controlled first", "amountNative": "300", "date": None},
                        {"id": "second", "label": "Controlled second", "amountNative": "400", "date": None},
                        {"id": "third", "label": "Controlled third", "amountNative": "300", "date": None}]}
    cash = {"controlled-cash": {"usdValue": "17.00"}}
    before_cash = canonical(cash)
    unknown, _, amount = currency.materialize(row, {rate["id"]: rate}, cash, {})
    require(amount is None and all(x["remainingUsd"] is None for x in unknown["receipts"]),
            "Missing native cash credit became a guessed USD balance.")
    require(unknown["currencyValuation"]["unallocatedObservedUsd"] == "17.00",
            "Missing-credit observed USD source was not retained.")
    row["nativePricing"]["priceCredits"] = [{"cashId": "controlled-cash", "amount": "300",
                                             "note": "Controlled receiving credit, outside the business case."}]
    complete, _, amount = currency.materialize(row, {rate["id"]: rate}, cash, {})
    require(canonical(cash) == before_cash, "Valuation modified recorded USD cash.")
    require(sum(Decimal(r["amountUsd"]) for r in complete["receipts"]) == Decimal(complete["priceUsd"]),
            "Cumulative quoted milestones do not conserve the total.")
    require(sum(Decimal(r["remainingUsd"]) for r in complete["receipts"]) == Decimal(amount),
            "Cumulative remaining milestones do not conserve the total.")
    for receipt in complete["receipts"]:
        require(Decimal(receipt["amountUsd"]) == Decimal(receipt["valuedNativeCreditUsd"])
                + Decimal(receipt["remainingUsd"]) + Decimal(receipt["settlementRoundingUsd"]),
                "Quote/credit/remaining rounding does not reconcile.")
    cost_case = deepcopy(row)
    cost_case["nativePricing"]["deliveryCost"] = {"amount": "1600", "currency": source["price"]["currency"], "fxRateId": rate["id"]}
    cost_case["invoiceIds"], cost_case["directCashIds"] = ["controlled-invoice"], ["controlled-direct"]
    cash["controlled-direct"] = {"usdValue": "10.00"}
    invoices = {"controlled-invoice": {"state": "REVIEWED", "totalUsd": "40.00"}}
    missing_cost, remaining_cost, _ = currency.materialize(cost_case, {rate["id"]: rate}, cash, invoices)
    require(remaining_cost is None and missing_cost["totalDeliveryCostUsd"] is None,
            "Missing native cost credit became a guessed remaining estimate.")
    cost_case["nativePricing"]["costCredits"] = [
        {"kind": "INVOICE", "id": "controlled-invoice", "amount": "700", "note": "Controlled original invoice allocation."},
        {"kind": "DIRECT_CASH", "id": "controlled-direct", "amount": "160", "note": "Controlled direct-expense allocation."}]
    cost_before = canonical({"cash": cash, "invoices": invoices})
    valued_cost, remaining_cost, _ = currency.materialize(cost_case, {rate["id"]: rate}, cash, invoices)
    require(canonical({"cash": cash, "invoices": invoices}) == cost_before, "Native cost valuation rewrote recorded USD amounts.")
    require(Decimal(valued_cost["totalDeliveryCostUsd"]) == Decimal("50.00") + Decimal(remaining_cost),
            "Effective native cost does not reconcile actual USD plus valued remaining estimate.")
    return {"state": "PASS", "purpose": "Controlled original helper calculations only; these IDs and records are never inserted into the business case.",
            "missingPriceCredit": unknown, "valuedPriceCredit": complete,
            "missingCostCredit": missing_cost, "valuedCostCredit": valued_cost,
            "recordedUsdUnchanged": True, "cumulativeMilestonesConserved": True}


def prepare(ctx):
    config, out = ctx.config, ctx.out
    document, _ = ctx.operations.Operations._unpack(ctx.inputs["case"]["raw"])
    expected = config["originalCase"]
    require(document["program"]["id"] == expected["programId"] and document["plan"]["id"] == expected["planId"],
            "The selected original case or plan differs.")
    require(document["program"]["version"] == expected["version"], "The original case version differs.")
    require(len(document["forecasts"]) == expected["forecasts"] and len(document["portfolios"]) == expected["portfolios"],
            "The complete original forecast/portfolio cohort differs.")
    legacy = once_json(out / "LEGACY_COMPATIBILITY.json", lambda: check_legacy(ctx, document))
    economics = json.loads(ctx.inputs["economics"]["raw"])
    quoted = config["commercial"]
    require(economics["schema"] == "tjl.workshare-underwriting.v1", "Use the original complete underwriting object.")
    require(Decimal(str(economics["fee"])) == Decimal(quoted["nativePricing"]["price"]["amount"])
            and economics["currency"] == quoted["nativePricing"]["price"]["currency"],
            "The native commercial price differs from its retained underwriting source.")
    cost_case = next((row for row in economics["costCases"] if Decimal(str(row["hours"])) == Decimal(quoted["remainingHours"])), None)
    require(cost_case and Decimal(str(cost_case["costUSD"])) == Decimal(quoted["nativePricing"]["deliveryCost"]["amount"])
            and quoted["nativePricing"]["deliveryCost"]["currency"] == "USD",
            "The chosen native cost/hours case differs from original underwriting.")
    require([(x["id"], Decimal(str(x["amount"]))) for x in economics["milestones"]] ==
            [(x["id"], Decimal(x["amountNative"])) for x in quoted["receipts"]],
            "Original milestone identities or native amounts differ.")
    require(all(x["date"] is None for x in quoted["receipts"]) and quoted["startDate"] is None and quoted["endDate"] is None
            and quoted["timing"]["reviewedReleaseDate"] is None and quoted["stage"] == "QUOTED",
            "Receiving cannot invent business dates, an agreement or a start.")
    require(not quoted["cashIds"] and not quoted["invoiceIds"] and not quoted["directCashIds"],
            "The business source has no recorded payment or invoiced cost assignment.")
    ctx.open()
    try:
        imported = once_json(out / "IMPORT_RECEIPT.json", lambda: ctx.ops.import_bundle(
            ctx.inputs["case"]["raw"], config["name"], ctx.operation + "-import", ctx.actor))
        repeated = ctx.ops.import_bundle(ctx.inputs["case"]["raw"], config["name"], ctx.operation + "-import", ctx.actor)
        require(repeated == imported, "Original import request did not recover exactly.")
        case_id = imported["id"]
        original_records = deepcopy(document["records"])
        require(ctx.ops.read(case_id)["records"] == original_records, "Original record collections differ after import.")
        ids = {key: ctx.attach(case_id, key) for key in ("economics", "terms", "exchange")}
        baseline = next((row for row in document["forecasts"] if row["id"] == config["baselineForecastId"]), None)
        require(baseline is not None, "Select one exact forecast from the original exported case.")
        raw, rolled = roll_forward(baseline["inputs"], config["asOfDate"])
        atomic_json(out / "INPUT_ROLL_FORWARD.json", rolled)
        require(all(row["id"] != quoted["id"] for row in raw["commercial"]), "The source already has this native commercial identity.")
        project = deepcopy(quoted)
        project["sourceIds"] = [ids["economics"], ids["terms"]]
        raw["name"] = config["name"] + " / native amount awaiting explicit FX"
        raw["commercial"].append(project)
        raw.setdefault("fxRates", [])
        raw["note"] = (raw["note"] + "\n" + config["scenarioNote"]).strip()
        unvalued = ctx.save_forecast("unvalued-forecast", case_id, raw, replay_after_reopen=True)
        coverage = unvalued["report"]["currencyValuation"]
        require(not coverage["complete"] and quoted["id"] in coverage["unresolvedProjectIds"],
                "Unselected price FX became a complete scope valuation.")
        selected = next(row for row in unvalued["report"]["commercial"] if row["id"] == quoted["id"])
        require(selected["priceUsd"] is None and selected["remainingUninvoicedCostUsd"] == ctx.forecast.money(quoted["nativePricing"]["deliveryCost"]["amount"]),
                "Unvalued quote or original USD delivery cost was changed.")
        require(sum(Decimal(x["amountNative"]) for x in selected["receipts"]) == Decimal(selected["nativePricing"]["price"]["amount"]),
                "Original native milestone total was changed.")
        missing_portfolio = ctx.save_portfolio("unvalued-portfolio", case_id, unvalued)
        require(all(row["financialComparisonEligible"] is False and row["frontier"] is None
                    and row["fundingNeedDeltaUsd"] is None for row in missing_portfolio["report"]["comparison"]),
                "Incomplete scope entered a financial frontier or funding delta.")
        # A deliberately dated planning preview verifies null complete cash metrics.
        # This validation-only candidate is not saved as a business forecast.
        diagnostic = deepcopy(raw)
        target = next(row for row in diagnostic["commercial"] if row["id"] == quoted["id"])
        target["receipts"][0]["date"] = unvalued["report"]["firstForecastDate"]
        diagnostic["name"] = config["name"] + " / validation-only unvalued dated receipt"
        diagnostic["note"] += "\nControlled validation preview only; the original customer collection date remains unset."
        preview = once_json(out / "VALIDATION_ONLY_DATED_FX_PREVIEW.json", lambda: ctx.ops.preview_forecast(case_id,
            {"expectedVersion": ctx.ops.read(case_id)["program"]["version"], "inputs": diagnostic}))
        require(not preview["report"]["currencyValuation"]["datedCashComplete"], "Missing dated FX was treated as complete.")
        for key in ("additionalCashNeededUsd", "gapAfterOpeningCashUsd", "peakNeedDate", "endDeltaUsd", "endBalanceUsd"):
            require(preview["report"]["scenarios"]["commercial"][key] is None, "Unvalued dated cash has a full metric: " + key)
        require(preview["report"]["scenarios"]["commercial"]["valuedPortion"]["additionalCashNeededUsd"] is not None,
                "Known cash portion was lost.")
        rates = deepcopy(config["rates"])
        for rate in rates:
            rate["sourceIds"] = [ids[config["rateSources"][rate["id"]]]]
        require(not {x["id"] for x in raw["fxRates"]}.intersection(x["id"] for x in rates), "Retained rate identity collides.")
        priced_inputs = deepcopy(raw)
        priced_inputs["fxRates"].extend(rates)
        priced_inputs["name"] = config["name"] + " / source-qualified native valuation"
        project = next(row for row in priced_inputs["commercial"] if row["id"] == quoted["id"])
        project["nativePricing"]["price"]["fxRateId"] = config["selectedRateId"]
        priced = ctx.save_forecast("priced-forecast", case_id, priced_inputs)
        priced_row = next(row for row in priced["report"]["commercial"] if row["id"] == quoted["id"])
        require(priced["report"]["currencyValuation"]["complete"], "The selected original reference did not complete valuation.")
        require(sum(Decimal(row["amountUsd"]) for row in priced_row["receipts"]) == Decimal(priced_row["priceUsd"]),
                "Native milestone conversion does not conserve the total quote.")
        require(priced_row["nativePricing"]["price"]["amount"] == selected["nativePricing"]["price"]["amount"],
                "FX selection changed the original quote.")
        require(all(row["date"] is None for row in priced_row["receipts"]) and priced_row["startDate"] is None,
                "Selecting FX invented business dates.")
        priced_portfolio = ctx.save_portfolio("priced-portfolio", case_id, priced)
        require(all(row["financialComparisonEligible"] for row in priced_portfolio["report"]["comparison"]),
                "Complete selected valuation cannot enter its original financial comparison.")
        selection = once_json(out / "PORTFOLIO_SELECTION.json", lambda: ctx.ops.select_portfolio(case_id, {
            "expectedVersion": ctx.ops.read(case_id)["program"]["version"], "portfolioId": priced_portfolio["id"], "alternativeId": "base"}))
        require(selection["inputs"]["fxRates"] == priced["inputs"]["fxRates"], "Date selection lost the original rates.")
        selected_project = next(row for row in selection["inputs"]["commercial"] if row["id"] == quoted["id"])
        require(selected_project["nativePricing"] == priced_row["nativePricing"]
                and all(x["date"] is None for x in selected_project["receipts"]), "Date selection rewrote pricing or customer collection dates.")
        selected_inputs = deepcopy(selection["inputs"])
        selected_inputs["name"] = config["name"] + " / explicit allocation sensitivity"
        selected_inputs["note"] += "\nEntered release and team capacity are a separate receiving sensitivity. They do not record an accepted customer start, staffed commitment or collection date."
        selected_forecast = ctx.save_forecast("selected-forecast", case_id, selected_inputs)
        # Invalid same-ID reuse must reject before another native record is written.
        body = json_read(out / "commands" / "selected-forecast.request.json")
        invalid = deepcopy(body)
        invalid["note"] += " changed intent"
        try:
            ctx.ops.command(case_id, invalid)
        except ctx.model.Problem as exc:
            require(exc.code == "REQUEST_CONFLICT" and exc.status == 409, "Changed request failed for another reason.")
        else:
            raise RuntimeError("Changed request identity was accepted.")
        atomic_json(out / "NATIVE_CREDIT_CALCULATIONS.json", native_credit_checks(ctx, next(r for r in rates if r["id"] == config["selectedRateId"])))
        for key, value in (("unvalued-forecast", unvalued), ("priced-forecast", priced), ("selected-forecast", selected_forecast)):
            exported = once_bytes(out / "exports" / (key + ".zip"), lambda value=value: ctx.ops.export_forecast(case_id, value["id"]))
            proof = verify_zip(exported)
            with zipfile.ZipFile(io.BytesIO(exported)) as archive:
                require("currency-valuation.json" in archive.namelist() and "native-record-credits.csv" in archive.namelist(),
                        "Forecast export lacks its full original currency members.")
            atomic_json(out / "exports" / (key + ".receipt.json"), proof)
        for item in document["forecasts"]:
            require(original_snapshot(ctx.ops.forecast(case_id, item["id"])) == item, "An original forecast changed during native receiving.")
        for item in document["portfolios"]:
            require(original_snapshot(ctx.ops.portfolio(case_id, item["id"])) == item, "An original portfolio changed during native receiving.")
        require(ctx.ops.read(case_id)["records"] == original_records, "Currency planning changed original business records.")
        exported = once_bytes(out / "exports" / "Native_Currency_Case_before_Browser.zip", lambda: ctx.ops.export(case_id))
        export_proof = verify_zip(exported)
        native = {"unvaluedForecastId": unvalued["id"], "pricedForecastId": priced["id"],
                  "unvaluedPortfolioId": missing_portfolio["id"], "pricedPortfolioId": priced_portfolio["id"],
                  "selectedForecastId": selected_forecast["id"]}
        current = ctx.ops.read(case_id)
        ready = {"schema": SCHEMA, "state": "READY_FOR_BROWSER", "operationId": ctx.operation,
                 "sourceRoot": str(ctx.source_root), "workspaceRoot": str(ctx.workspace_root),
                 "database": str(ctx.workspace_root / "planning.sqlite3"),
                 "caseId": case_id, "planId": current["program"]["planId"], "version": current["program"]["version"],
                 "inputCase": expected | {key: ctx.inputs["case"]["descriptor"][key] for key in ("bytes", "sha256")},
                 "legacy": legacy, "native": native, "baselineForecastId": baseline["id"], "beforeBrowserExport": export_proof,
                 "browserInput": {"nativeProjectId": quoted["id"], "rates": rates, "sourceIds": ids,
                    "priceCredits": [], "costCredits": [], "cashIds": [], "invoiceIds": [], "directCashIds": [],
                    "expected": {"quoteNative": priced_row["nativePricing"]["price"],
                        "deliveryCostNative": priced_row["nativePricing"]["deliveryCost"], "priceUsd": priced_row["priceUsd"],
                        "receiptUsd": [x["amountUsd"] for x in priced_row["receipts"]],
                        "remainingUninvoicedCostUsd": priced_row["remainingUninvoicedCostUsd"],
                        "businessMilestoneDates": [None for _ in priced_row["receipts"]],
                        "unvaluedScopeComplete": False, "unvaluedDatedCashComplete": coverage["datedCashComplete"],
                        "unvaluedPortfolioComparisonEligible": False, "pricedPortfolioComparisonEligible": True},
                    "controlledCreditArtifact": str(out / "NATIVE_CREDIT_CALCULATIONS.json"),
                    "creditExamplePolicy": "Synthetic helper examples are outside the business case; do not attribute their cash or invoices to this quote."},
                 "preparedPid": os.getpid(), "originalRecordsUnchanged": True}
    finally:
        ctx.close()
    atomic_json(out / "NATIVE_READY.json", ready)
    return ready


def verify(ctx, browser_path):
    out = ctx.out
    ready = json_read(out / "NATIVE_READY.json")
    require(ready["operationId"] == ctx.operation and ready["state"] == "READY_FOR_BROWSER", "Use the original prepared operation.")
    require(ready["preparedPid"] != os.getpid(), "Final receiving must reopen from a fresh Python process.")
    browser = json_read(browser_path)
    require(browser["state"] == "PASS" and browser["caseId"] == ready["caseId"]
            and browser["nativeReadySha256"] == sha((out / "NATIVE_READY.json").read_bytes()),
            "The actual browser result does not bind the original ready case.")
    document, _ = ctx.operations.Operations._unpack(ctx.inputs["case"]["raw"])
    ctx.open()
    try:
        case_id = ready["caseId"]
        current = ctx.ops.read(case_id)
        require(current["records"] == document["records"], "A planning edit changed original business records.")
        for row in document["forecasts"]:
            require(original_snapshot(ctx.ops.forecast(case_id, row["id"])) == row, "Browser changed a legacy forecast.")
        for row in document["portfolios"]:
            require(original_snapshot(ctx.ops.portfolio(case_id, row["id"])) == row, "Browser changed a legacy portfolio.")
        forecasts = [original_snapshot(ctx.ops.forecast(case_id, row["id"])) for row in ctx.ops.list_forecasts(case_id)]
        portfolios = [original_snapshot(ctx.ops.portfolio(case_id, row["id"])) for row in ctx.ops.list_portfolios(case_id)]
        for row in forecasts:
            ctx.forecast.validate_saved(row)
        for row in portfolios:
            ctx.portfolio.validate_saved(row)
        export_name = "Native_Currency_Complete_Case_v" + str(current["program"]["version"]) + ".zip"
        raw = once_bytes(out / "exports" / export_name, lambda: ctx.ops.export(case_id))
        final_document, _ = ctx.operations.Operations._unpack(raw)
        native_export = verify_zip(raw)
        require({row["id"]: row for row in final_document["forecasts"]} == {row["id"]: row for row in forecasts}
                and {row["id"]: row for row in final_document["portfolios"]} == {row["id"]: row for row in portfolios},
                "Complete native export lost a saved forecast or allocation.")
    finally:
        ctx.close()
    # Receive through the original full importer into a separate fresh store.
    restored_root = out / "fresh-received-workspace"
    restored = ctx.model.Workspace(restored_root, ctx.seed_source)
    try:
        ops = ctx.operations.Operations(restored)
        receipt_path = out / "FINAL_IMPORT_RECEIPT.json"
        imported = once_json(receipt_path, lambda: ops.import_bundle(raw, ctx.config["name"] + " / full receiving",
                                         ctx.operation + "-final-import", ctx.actor))
        replay = ops.import_bundle(raw, ctx.config["name"] + " / full receiving", ctx.operation + "-final-import", ctx.actor)
        require(replay == imported, "Complete native import did not replay exactly.")
        received = ops.read(imported["id"])
        require(received["records"] == current["records"] and received["sources"] == current["sources"],
                "Full receiving changed original records or source descriptors.")
        for row in forecasts:
            require(original_snapshot(ops.forecast(imported["id"], row["id"])) == row, "Full receiving changed a saved forecast.")
        for row in portfolios:
            require(original_snapshot(ops.portfolio(imported["id"], row["id"])) == row, "Full receiving changed a saved portfolio.")
        for source in received["sources"]:
            metadata, member = ops.source(imported["id"], source["id"])
            require(len(member) == metadata["bytes"] and sha(member) == metadata["sha256"], "Full receiving lost original source bytes.")
        replay_proof = {"requestId": ctx.operation + "-final-import", "result": imported, "sameIdExact": True}
    finally:
        restored.close()
    reopened = ctx.model.Workspace(restored_root, ctx.seed_source)
    try:
        opened = ctx.operations.Operations(reopened)
        require(opened.read(imported["id"])["records"] == current["records"], "Fresh received store did not reopen.")
    finally:
        reopened.close()
    artifacts = []
    for directory in (out / "inputs", out / "commands", out / "previews", out / "saved", out / "exports"):
        artifacts.extend(file_identity(path) for path in sorted(directory.rglob("*")) if path.is_file() and not path.name.endswith(".part"))
    for artifact_name in ("LEGACY_COMPATIBILITY.json", "INPUT_ROLL_FORWARD.json", "IMPORT_RECEIPT.json",
                 "PORTFOLIO_SELECTION.json", "VALIDATION_ONLY_DATED_FX_PREVIEW.json", "NATIVE_CREDIT_CALCULATIONS.json",
                 "NATIVE_READY.json", "FINAL_IMPORT_RECEIPT.json", "SOURCE_INVENTORY.json", "CONFIG.json"):
        artifacts.append(file_identity(out / artifact_name))
    artifacts.append(file_identity(browser_path))
    artifacts.extend([file_identity(ctx.workspace_root / "planning.sqlite3"), file_identity(restored_root / "planning.sqlite3")])
    result = {"schema": SCHEMA, "state": "PASS", "operationId": ctx.operation,
              "sourceCommit": ctx.config.get("sourceCommit"), "originalCase": ready["inputCase"],
              "preparedCaseId": ready["caseId"], "receivedCaseId": imported["id"],
              "legacy": ready["legacy"], "native": ready["native"], "browser": browser,
              "completeExport": native_export | {"path": str(out / "exports" / export_name)},
              "fullImportReplay": replay_proof, "finalVersion": current["program"]["version"],
              "forecasts": len(forecasts), "portfolios": len(portfolios), "originalSources": len(document["sources"]),
              "retainedSources": len(current["sources"]), "originalRecordsUnchanged": True,
              "preparedPid": ready["preparedPid"], "receivingPid": os.getpid(),
              "phases": ["original-case-and-source-identity", "legacy-full-calculation-and-export",
                         "native-quote-with-unresolved-FX", "original-request-replay-after-store-reopen",
                         "operational-allocation-with-financial-exclusion", "explicit-source-qualified-FX",
                         "cumulative-milestone-conservation", "native-credit-helper-reconciliation",
                         "portfolio-dates-retain-native-pricing", "actual-browser-source-edit-and-export",
                         "complete-case-export", "fresh-process-full-import-replay-and-reopen"],
              "artifacts": artifacts}
    atomic_json(out / "RESULT.json", result)
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--phase", choices=("prepare", "verify"), required=True)
    parser.add_argument("--browser-result")
    args = parser.parse_args()
    config = json_read(args.config)
    require(config.get("schema") == SCHEMA, "Use the complete currency receiving configuration.")
    out = Path(args.output).resolve()
    out.mkdir(parents=True, exist_ok=True)
    with (out / "receiving.lock").open("a+b") as held:
        fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
        atomic_json(out / "CONFIG.json", config)
        ctx = None
        try:
            ctx = Receiving(config, out)
            if args.phase == "prepare":
                result = json_read(out / "NATIVE_READY.json") if (out / "NATIVE_READY.json").is_file() else prepare(ctx)
            else:
                require(args.browser_result, "The original browser result is required for complete receiving.")
                result = json_read(out / "RESULT.json") if (out / "RESULT.json").is_file() else verify(ctx, Path(args.browser_result).resolve())
            print(canonical(result), flush=True)
        except BaseException as exc:
            if ctx is not None:
                ctx.close()
            failure = {"schema": SCHEMA, "state": "FAILED", "operationId": config.get("operationId"),
                       "phase": args.phase, "type": type(exc).__name__, "message": str(exc),
                       "pid": os.getpid(), "at": datetime.now(timezone.utc).isoformat()}
            try:
                atomic_json(out / ("FAILED-" + str(os.getpid()) + "-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%f") + ".json"), failure)
            except OSError:
                pass
            print(canonical(failure), file=sys.stderr, flush=True)
            raise


if __name__ == "__main__":
    main()
