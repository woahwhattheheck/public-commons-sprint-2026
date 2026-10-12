#!/usr/bin/env python3
"""Prepare original Worklogs and invoice files for the existing ERP reconciliation app.

Python 3.11+, standard library only. Inputs stay local. The customer selects the
actual sheet/header/columns, time unit, billing period, rate and rounding policy.
"""
from __future__ import annotations
import argparse, calendar, csv, hashlib, io, json, os, posixpath, re, shutil, sys, zipfile
from datetime import date, datetime, timedelta
from decimal import Decimal, InvalidOperation, ROUND_HALF_EVEN, ROUND_HALF_UP, localcontext
from pathlib import Path
from xml.etree import ElementTree as ET
from zoneinfo import ZoneInfo

VERSION = "worklogs-invoice-preparation.v1"
MAX_BYTES, MAX_EXPANDED, MAX_ROWS, MAX_COLS = 32 * 1024**2, 64 * 1024**2, 200000, 1024
NS = {"s": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
KEYS = ["customer", "currency", "period", "line"]
INVOICE_FIELDS = KEYS + ["seconds", "net_amount"]
COVERAGE_FIELDS = ["worklog_id", "customer", "currency", "period", "line", "billable", "seconds"]

def require(condition, message):
    if not condition:
        raise ValueError(message)

def raw_file(path):
    path = Path(path)
    require(path.is_file() and not path.is_symlink(), "Input must be an original regular file.")
    require(path.stat().st_size <= MAX_BYTES, "Input exceeds the complete-file limit of 32 MiB.")
    data = path.read_bytes()
    require(len(data) <= MAX_BYTES, "Input changed beyond the complete-file limit.")
    return data

def digest(data):
    return hashlib.sha256(data).hexdigest()

def decimal(value, label):
    value = str(value).strip()
    require(re.fullmatch(r"[+-]?\d+(?:\.\d+)?", value) is not None, f"{label}: use an exact decimal without thousands separators.")
    require(len(value) <= 40, f"{label}: decimal is too long.")
    try:
        result = Decimal(value)
    except InvalidOperation:
        raise ValueError(f"{label}: invalid decimal.")
    require(result.is_finite(), f"{label}: finite decimal required.")
    return result

def column_index(reference):
    letters = re.match(r"[A-Za-z]+", reference or "")
    require(letters, "XLSX cell has no column reference.")
    result = 0
    for letter in letters[0].upper():
        result = result * 26 + ord(letter) - 64
    require(1 <= result <= MAX_COLS, "XLSX column exceeds the complete-table limit.")
    return result - 1

def xml(data):
    require(b"<!DOCTYPE" not in data and b"<!ENTITY" not in data, "XLSX XML declarations are unsupported.")
    return ET.fromstring(data)

def workbook_tables(data, selected_sheet=None, preview=False):
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        entries = archive.infolist()
        require(sum(x.file_size for x in entries) <= MAX_EXPANDED, "Expanded XLSX exceeds 64 MiB.")
        names = [x.filename for x in entries]
        require(len(set(names)) == len(names), "XLSX has duplicate archive entries.")
        workbook = xml(archive.read("xl/workbook.xml"))
        relations = xml(archive.read("xl/_rels/workbook.xml.rels"))
        targets = {}
        for item in relations:
            if item.attrib.get("TargetMode") == "External":
                continue
            target = item.attrib["Target"]
            path = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
            require(path.startswith("xl/") and ".." not in path.split("/"), "Invalid workbook relationship.")
            targets[item.attrib["Id"]] = path
        sheets = workbook.findall("s:sheets/s:sheet", NS)
        require(sheets, "Workbook has no worksheets.")
        sheet_names = [x.attrib["name"] for x in sheets]
        if selected_sheet is None:
            require(len(sheets) == 1 or preview, "Choose the actual worksheet by name.")
        chosen = next((x for x in sheets if x.attrib["name"] == selected_sheet), None) if selected_sheet else sheets[0]
        require(chosen is not None, "Selected worksheet does not exist.")
        shared = []
        if "xl/sharedStrings.xml" in names:
            for item in xml(archive.read("xl/sharedStrings.xml")).findall("s:si", NS):
                shared.append("".join(x.text or "" for x in item.findall(".//s:t", NS)))
        target = targets.get(chosen.attrib.get(REL))
        require(target in names, "Selected worksheet relationship is missing.")
        rows, formulas = [], set()
        for item in xml(archive.read(target)).findall("s:sheetData/s:row", NS):
            row_number = int(item.attrib.get("r", len(rows) + 1))
            require(1 <= row_number <= MAX_ROWS + 100, "Worksheet row exceeds the complete-table limit.")
            cells = {}
            for cell in item.findall("s:c", NS):
                index = column_index(cell.attrib.get("r"))
                require(index not in cells, "XLSX repeats a cell position.")
                kind = cell.attrib.get("t")
                value = cell.find("s:v", NS)
                value = value.text or "" if value is not None else ""
                if kind == "s":
                    require(value.isdigit() and int(value) < len(shared), "Invalid XLSX shared string.")
                    value = shared[int(value)]
                elif kind == "inlineStr":
                    value = "".join(x.text or "" for x in cell.findall(".//s:t", NS))
                elif kind == "e":
                    raise ValueError(f"Worksheet row {row_number}: cached cell error.")
                if cell.find("s:f", NS) is not None:
                    formulas.add((row_number, index))
                cells[index] = value
            width = max(cells, default=-1) + 1
            rows.append((row_number, [cells.get(index, "") for index in range(width)]))
            require(len(rows) <= MAX_ROWS, "Worksheet exceeds 200,000 complete rows.")
        properties = workbook.find("s:workbookPr", NS)
        return rows, {"format": "xlsx", "sheet": chosen.attrib["name"], "sheets": sheet_names,
                      "date1904": properties is not None and properties.attrib.get("date1904") in ("1", "true")}, formulas

def read_table(data, filename, settings, preview=False):
    if filename.lower().endswith(".xlsx"):
        rows, meta, formulas = workbook_tables(data, settings.get("sheet"), preview)
    else:
        require(filename.lower().endswith(".csv"), "Use the original CSV or XLSX export.")
        delimiter = settings.get("delimiter", ",")
        require(isinstance(delimiter, str) and len(delimiter) == 1 and delimiter not in "\r\n", "Select one CSV delimiter.")
        text = data.decode("utf-8-sig", errors="strict")
        rows = [(n, row) for n, row in enumerate(csv.reader(io.StringIO(text, newline=""), delimiter=delimiter, strict=True), 1)]
        require(len(rows) <= MAX_ROWS, "CSV exceeds 200,000 complete records.")
        require(all(len(row) <= MAX_COLS for _, row in rows), "CSV exceeds 1,024 columns.")
        meta, formulas = {"format": "csv", "delimiter": delimiter, "date1904": False}, set()
    if preview:
        return {"metadata": meta, "records": len(rows), "first_rows": [{"row": n, "values": row} for n, row in rows[:8]]}
    header_number = settings.get("header_row", 1)
    require(isinstance(header_number, int) and header_number > 0, "Select a positive header row.")
    selected = next((row for n, row in rows if n == header_number), None)
    require(selected is not None, "Selected header row does not exist.")
    headers = [str(x).strip() for x in selected]
    require(headers and all(headers) and len(headers) == len(set(headers)), "Selected header must contain unique nonempty column names.")
    records = []
    for row_number, values in rows:
        if row_number <= header_number or not any(str(v).strip() for v in values):
            continue
        require(len(values) <= len(headers), f"Row {row_number}: data extends beyond the selected header.")
        values = values + [""] * (len(headers) - len(values))
        require(settings.get("accept_cached_formulas") is True or not any((row_number, i) in formulas for i in range(len(values))),
                f"Row {row_number}: formula found; explicitly review cached-formula use or supply a values-only export.")
        records.append((row_number, dict(zip(headers, values))))
    meta.update({"header_row": header_number, "headers": headers, "records": len(records),
                 "formula_cells": len(formulas), "cached_formulas_accepted": settings.get("accept_cached_formulas") is True})
    return records, meta

def get(row, settings, logical, label, required=True):
    selection = settings.get("columns", {}).get(logical)
    require(isinstance(selection, str) and selection in row, f"{label}: select the original column for {logical}.")
    result = str(row[selection]).strip()
    require(result or not required, f"{label}: {logical} is empty.")
    return result

def duration(value, unit, label):
    if unit in ("hh:mm", "hh:mm:ss"):
        pattern = r"(\d+):([0-5]\d)" if unit == "hh:mm" else r"(\d+):([0-5]\d):([0-5]\d)"
        match = re.fullmatch(pattern, str(value).strip())
        require(match is not None, f"{label}: expected {unit}.")
        result = int(match[1]) * 3600 + int(match[2]) * 60 + (int(match[3]) if unit == "hh:mm:ss" else 0)
    else:
        require(unit in ("seconds", "minutes", "hours", "excel-days"), f"{label}: explicit duration unit required.")
        factor = {"seconds": 1, "minutes": 60, "hours": 3600, "excel-days": 86400}[unit]
        amount = decimal(value, label) * factor
        require(amount == amount.to_integral_value(), f"{label}: time must resolve to whole seconds; select the correct original unit.")
        result = int(amount)
    require(0 <= result <= 1000000000, f"{label}: nonnegative duration within the declared input bound required.")
    return result

def local_date(value, settings, metadata, label):
    encoding = settings.get("date_encoding", "iso-date")
    if encoding == "excel-date":
        serial = decimal(value, label)
        require(serial == serial.to_integral_value(), f"{label}: use a date-only Excel serial or export an ISO timestamp.")
        day = int(serial)
        require(day >= 0 and (metadata["date1904"] or day != 60), f"{label}: invalid Excel date.")
        epoch = date(1904, 1, 1) if metadata["date1904"] else date(1899, 12, 31)
        return epoch + timedelta(days=day - (1 if not metadata["date1904"] and day > 60 else 0))
    if encoding == "iso-timestamp":
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        require(parsed.tzinfo is not None, f"{label}: timestamp needs its original UTC offset.")
        return parsed.astimezone(ZoneInfo(settings["timezone"])).date()
    require(encoding == "iso-date" and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value), f"{label}: ISO date required.")
    return date.fromisoformat(value)

def csv_bytes(fields, rows):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\n", extrasaction="ignore")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")

def prepare(worklogs_path, invoices_path, contract_path, destination):
    source, target, contract_raw = raw_file(worklogs_path), raw_file(invoices_path), raw_file(contract_path)
    contract = json.loads(contract_raw)
    require(contract.get("version") == 1, "contract.version must be 1.")
    period, currency = contract.get("period"), contract.get("currency")
    require(isinstance(period, str) and re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", period), "Choose one calendar month as YYYY-MM.")
    date.fromisoformat(period + "-01")
    require(isinstance(currency, str) and re.fullmatch(r"[A-Z]{3}", currency), "Choose one three-letter currency per run.")
    scale = contract.get("currency_scale", 2)
    require(isinstance(scale, int) and 0 <= scale <= 4, "Currency scale must be 0–4.")
    rounding = contract.get("rounding")
    require(rounding in ("HALF_UP", "HALF_EVEN"), "Select the customer's HALF_UP or HALF_EVEN rounding policy.")
    rounding_mode = ROUND_HALF_UP if rounding == "HALF_UP" else ROUND_HALF_EVEN
    grain = contract.get("round_at")
    require(grain in ("invoice_line", "worklog"), "Select whether money is rounded at each worklog or aggregated invoice line.")
    require(isinstance(contract.get("owner"), str) and contract["owner"].strip(), "Name the billing-rule owner.")
    source_settings, target_settings = contract["worklogs"], contract["invoices"]
    source_rows, source_metadata = read_table(source, str(worklogs_path), source_settings)
    target_rows, target_metadata = read_table(target, str(invoices_path), target_settings)
    yes, no = source_settings.get("billable_values", []), source_settings.get("nonbillable_values", [])
    require(yes and no and set(yes).isdisjoint(no), "Choose distinct original billable and nonbillable values.")
    require(all(isinstance(x, str) for x in yes + no), "Billability values must be exact strings.")
    rates = {}
    for item in contract.get("rates", []):
        key = (str(item["customer"]).strip(), str(item["line"]).strip())
        require(all(key) and key not in rates, "Rates need unique customer and line pairs.")
        rate = decimal(item["hourly_rate"], "Hourly rate")
        require(rate >= 0, "Hourly rates must be nonnegative.")
        rates[key] = rate
    require(rates, "Supply the customer-approved rate table.")
    quantum = Decimal(1).scaleb(-scale)
    used, expected, lineage, coverage, nonbillable = set(), {}, [], [], []
    for record_number, row in source_rows:
        label = f"Worklog row {record_number}"
        item = {name: get(row, source_settings, name, label) for name in ["customer", "line", "date", "duration", "billable"]}
        identity = source_settings.get("identity", "worklog_id")
        require(identity in ("worklog_id", "source_row"), "Choose worklog_id or source_row identity.")
        item["worklog_id"] = get(row, source_settings, "worklog_id", label) if identity == "worklog_id" else f"source-{digest(source)[:24]}-row-{record_number}"
        require(item["worklog_id"] not in used, f"{label}: duplicate worklog identity; review the actual export grain.")
        used.add(item["worklog_id"])
        day = local_date(item["date"], source_settings, source_metadata, label)
        require(day.strftime("%Y-%m") == period, f"{label}: date is outside the selected complete period.")
        seconds = duration(item["duration"], source_settings.get("duration_unit"), label)
        require(item["billable"] in yes + no, f"{label}: unknown billability value.")
        billable = item["billable"] in yes
        normalized = {"worklog_id": item["worklog_id"], "customer": item["customer"], "currency": currency,
                      "period": period, "line": item["line"], "billable": "true" if billable else "false", "seconds": str(seconds)}
        coverage.append(normalized)
        lineage.append({**normalized, "source_row": record_number, "local_date": day.isoformat(), "original_billability": item["billable"]})
        if not billable:
            nonbillable.append(normalized)
            continue
        key = (item["customer"], currency, period, item["line"])
        rate_key = (item["customer"], item["line"])
        require(rate_key in rates, f"{label}: no approved rate for this customer and invoice line.")
        current = expected.setdefault(key, {"seconds": 0, "worklogs": 0, "row_rounded": Decimal(0), "rate": rates[rate_key]})
        current["seconds"] += seconds
        current["worklogs"] += 1
        current["row_rounded"] += (rates[rate_key] * Decimal(seconds) / Decimal(3600)).quantize(quantum, rounding=rounding_mode)
    expected_rows = []
    for key, values in sorted(expected.items()):
        amount = values["row_rounded"] if grain == "worklog" else (values["rate"] * Decimal(values["seconds"]) / Decimal(3600)).quantize(quantum, rounding=rounding_mode)
        expected_rows.append({**dict(zip(KEYS, key)), "seconds": str(values["seconds"]), "net_amount": f"{amount:.{scale}f}"})
    actual_rows = []
    for record_number, row in target_rows:
        label = f"Invoice row {record_number}"
        item = {name: get(row, target_settings, name, label) for name in KEYS + ["duration", "net_amount"]}
        require(item["currency"] == currency, f"{label}: invoice currency differs from this run.")
        require(item["period"] == period, f"{label}: invoice period differs from this run.")
        seconds = duration(item["duration"], target_settings.get("duration_unit"), label)
        amount = decimal(item["net_amount"], label)
        require(amount == amount.quantize(quantum), f"{label}: net amount exceeds the currency scale.")
        actual_rows.append({**{k: item[k] for k in KEYS}, "seconds": str(seconds), "net_amount": f"{amount:.{scale}f}"})
    spec = {"version": 1, "dataset": f"worklogs-invoices-{period}-{currency}", "keys": KEYS,
            "amounts": [{"name": "seconds", "scale": 0, "tolerance": "0"}, {"name": "net_amount", "scale": scale, "tolerance": "0" if not scale else "0." + "0" * scale}],
            "attributes": [], "group_by": ["customer", "currency", "period"],
            "source_columns": {k: k for k in INVOICE_FIELDS}, "target_columns": {k: k for k in INVOICE_FIELDS},
            "workspace": {"preparation": VERSION, "contract_sha256": digest(contract_raw), "source_sha256": digest(source),
                          "invoice_sha256": digest(target), "billing_owner": contract["owner"], "period": period,
                          "currency": currency, "rounding": rounding, "round_at": grain}}
    profile = json.loads(Path(__file__).with_name("workspace-profile.json").read_text())
    profile["cohorts"][0]["amounts"] = spec["amounts"]
    payloads = {"expected-invoice-lines.csv": csv_bytes(INVOICE_FIELDS, expected_rows),
                "actual-invoice-lines.csv": csv_bytes(INVOICE_FIELDS, actual_rows),
                "worklog-coverage.csv": csv_bytes(COVERAGE_FIELDS, coverage),
                "nonbillable-time.csv": csv_bytes(COVERAGE_FIELDS, nonbillable),
                "worklog-lineage.csv": csv_bytes(COVERAGE_FIELDS + ["source_row", "local_date", "original_billability"], lineage),
                "spec.json": (json.dumps(spec, indent=2) + "\n").encode(),
                "workspace-profile.json": (json.dumps(profile, indent=2) + "\n").encode(),
                "contract.json": contract_raw,
                "original-worklogs" + Path(worklogs_path).suffix.lower(): source,
                "original-invoices" + Path(invoices_path).suffix.lower(): target,
                "prepare.py": Path(__file__).read_bytes()}
    manifest = {"schema": VERSION, "period": period, "currency": currency, "billing_owner": contract["owner"],
                "input_metadata": {"worklogs": {**source_metadata, "identity": source_settings.get("identity", "worklog_id"), "cross_edition_identity": source_settings.get("identity", "worklog_id") == "worklog_id"}, "invoices": target_metadata},
                "counts": {"worklogs": len(coverage), "billable_worklogs": len(coverage) - len(nonbillable),
                           "nonbillable_worklogs": len(nonbillable), "expected_invoice_lines": len(expected_rows),
                           "actual_invoice_lines": len(actual_rows)},
                "billing": {"currency_scale": scale, "rounding": rounding, "round_at": grain,
                            "billable_seconds": str(sum(int(r["seconds"]) for r in expected_rows)),
                            "expected_net_amount": f"{sum((Decimal(r['net_amount']) for r in expected_rows), Decimal(0)):.{scale}f}"},
                "files": [{"path": name, "bytes": len(data), "sha256": digest(data)} for name, data in payloads.items()]}
    output = Path(destination).resolve()
    output.mkdir(mode=0o700)
    try:
        for name, data in payloads.items():
            with open(output / name, "xb") as stream:
                os.chmod(output / name, 0o600)
                stream.write(data)
        encoded = (json.dumps(manifest, indent=2) + "\n").encode()
        with open(output / "preparation.json", "xb") as stream:
            os.chmod(output / "preparation.json", 0o600)
            stream.write(encoded)
    except BaseException:
        shutil.rmtree(output)
        raise
    return {"directory": str(output), "manifest_sha256": digest(encoded), **manifest["counts"],
            "billable_seconds": manifest["billing"]["billable_seconds"], "expected_net_amount": manifest["billing"]["expected_net_amount"]}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    inspect = commands.add_parser("inspect", help="Read actual sheet names and first rows before selecting the mapping.")
    inspect.add_argument("input")
    inspect.add_argument("--sheet")
    inspect.add_argument("--delimiter", default=",")
    prepare_parser = commands.add_parser("prepare", help="Retain complete inputs and prepare the original comparison bundle.")
    for name in ("worklogs", "invoices", "contract", "output"):
        prepare_parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    try:
        with localcontext() as context:
            context.prec = 80
            if args.command == "inspect":
                result = read_table(raw_file(args.input), args.input, {"sheet": args.sheet, "delimiter": args.delimiter}, True)
            else:
                result = prepare(args.worklogs, args.invoices, args.contract, args.output)
        print(json.dumps(result, indent=2))
    except (ValueError, KeyError, OSError, ET.ParseError, zipfile.BadZipFile, InvalidOperation) as error:
        print(json.dumps({"error": type(error).__name__, "message": str(error)}), file=sys.stderr)
        return 1
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
