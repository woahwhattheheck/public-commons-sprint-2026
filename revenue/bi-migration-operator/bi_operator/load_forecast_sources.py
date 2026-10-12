"""Original load-forecast workbook intake and explicit, unit-aware mappings."""
from __future__ import annotations

import csv
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_EVEN, localcontext
import io
import json
from pathlib import Path
import re
import zipfile

from .store import digest, encoded, identifier

MAX_ROWS = 100000
MAX_CELLS = 2000000
MAX_BYTES = 64 * 1024 * 1024
DECIMAL_DIGITS = 60
DECIMAL_SCALE = 60
EXACT_PRECISION = 128
RATIO_PRECISION = 40
MAX_FORMATTED_DECIMAL = 2048
SIGNALS = ("forecast", "actual", "weather_normalized", "adjustment")
STATUSES = ("annual_forecast", "informational_update", "observed_data", "adjustment_detail", "reference")
METRICS = ("peak_demand", "energy")
SEASONS = ("summer", "winter", "annual", "monthly")
UNITS = {
    "kW": ("MW", Decimal("0.001")), "MW": ("MW", Decimal("1")), "GW": ("MW", Decimal("1000")),
    "kWh": ("MWh", Decimal("0.001")), "MWh": ("MWh", Decimal("1")),
    "GWh": ("MWh", Decimal("1000")), "TWh": ("MWh", Decimal("1000000")),
}
KEY_FIELDS = ("area", "geography", "metric", "season", "period_start", "period_end",
              "period_basis", "coincidence", "basis", "canonical_unit")
ROW_FIELDS = ("row_id", *KEY_FIELDS, "period_label", "signal", "value", "unit", "canonical_value",
              "source_geography", "sheet", "cell", "period_cell", "mapping_id")


def text(value, maximum=10000, required=False):
    value = "" if value is None else str(value).strip()
    if len(value) > maximum or any(ord(c) < 32 and c not in "\t\r\n" for c in value):
        raise ValueError("A source or review field is too long or contains control characters.")
    if required and not value:
        raise ValueError("Complete the required source or mapping field.")
    return value


def integer(value, low, high, label):
    if isinstance(value, bool) or not re.fullmatch(r"-?\d+", str(value)):
        raise ValueError(label + " must be a whole number.")
    value = int(value)
    if not low <= value <= high:
        raise ValueError(label + " is outside the supported range.")
    return value


def decimal(value, label="Value"):
    if isinstance(value, (bool, float)):
        raise ValueError(label + " must be exact decimal text or a JSON decimal number.")
    raw = str(value).strip().replace(",", "")
    if len(raw) > 100:
        raise ValueError(label + " is too long.")
    try:
        result = Decimal(raw)
    except (InvalidOperation, ValueError):
        raise ValueError(label + " must be a finite decimal number.") from None
    if not result.is_finite():
        raise ValueError(label + " must be finite.")
    parts = result.as_tuple()
    if (len(parts.digits) > DECIMAL_DIGITS or not -DECIMAL_SCALE <= parts.exponent <= 18 or
            result.copy_abs() > Decimal("1e18")):
        raise ValueError(label + " supports at most 60 coefficient digits, 60 fractional places and magnitude 1e18.")
    return result


def number(value):
    value = Decimal(value)
    if not value.is_finite():
        raise ValueError("A calculated load value is not finite.")
    if not value:
        return "0"
    # Bound the fixed-point allocation before formatting either source or computed values.
    parts = value.as_tuple()
    integer_places = max(value.adjusted() + 1, 1)
    fraction_places = max(-parts.exponent, 0)
    if integer_places + fraction_places + 2 > MAX_FORMATTED_DECIMAL:
        raise ValueError("The calculated decimal exceeds the supported report width.")
    return format(value, "f")


def strict_json(data):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError("Repeated JSON key: " + str(key))
            result[key] = value
        return result
    return json.loads(data, object_pairs_hook=pairs, parse_float=Decimal,
                      parse_constant=lambda value: (_ for _ in ()).throw(ValueError("Nonfinite JSON number.")))


def column_name(column):
    result = ""
    while column:
        column, part = divmod(column - 1, 26)
        result = chr(65 + part) + result
    return result


def cell_name(row, column):
    return column_name(column) + str(row)


def scalar(value):
    if isinstance(value, (date, datetime)):
        return value.isoformat()
    return value


def workbook(data):
    """Read cached OOXML values; original decimal text and formula-cache failures survive."""
    if len(data) > MAX_BYTES:
        raise ValueError("One original workbook may contain at most 64 MiB.")
    from xml.etree import ElementTree as ET
    import posixpath
    namespace = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    relationships = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
    try:
        package = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile:
        raise ValueError("Select the complete original XLSX workbook.") from None
    members = package.infolist()
    if len(members) > 10000 or sum(m.file_size for m in members) > 256 * 1024 * 1024:
        package.close()
        raise ValueError("This workbook exceeds the supported expanded size.")
    if len({m.filename for m in members}) != len(members) or any(m.flag_bits & 1 for m in members):
        package.close()
        raise ValueError("The workbook contains ambiguous or encrypted members.")
    def xml(name):
        raw = package.read(name)
        if b"<!DOCTYPE" in raw.upper() or b"<!ENTITY" in raw.upper():
            raise ValueError("XML source declarations with entities are not supported.")
        return ET.fromstring(raw)
    try:
        root = xml("xl/workbook.xml")
        links = {r.attrib["Id"]: r.attrib["Target"] for r in xml("xl/_rels/workbook.xml.rels")
                 if r.attrib.get("TargetMode") != "External"}
        shared = []
        if "xl/sharedStrings.xml" in package.namelist():
            for item in xml("xl/sharedStrings.xml").findall(namespace + "si"):
                shared.append("".join((part.text or "") for part in
                    [*item.findall(namespace + "t"), *item.findall(namespace + "r/" + namespace + "t")]))
        class Sheet:
            def __init__(self, element):
                self.title = element.attrib["name"]
                target = links[element.attrib[relationships + "id"]]
                self.path = target.lstrip("/") if target.startswith("/") else posixpath.normpath("xl/" + target)
                if not self.path.startswith("xl/") or ".." in self.path.split("/"):
                    raise ValueError("The workbook sheet relationship is invalid.")
                self.raw = xml(self.path)
                self.cells = None
                positions = [parse_cell(c.attrib["r"]) for c in self.raw.iter(namespace + "c") if "r" in c.attrib]
                self.max_row = max((row for row, col in positions), default=0)
                self.max_column = max((col for row, col in positions), default=0)
            def values(self):
                if self.cells is not None:
                    return self.cells
                values = {}
                for c in self.raw.iter(namespace + "c"):
                    if "r" not in c.attrib:
                        continue
                    coordinate = parse_cell(c.attrib["r"])
                    if coordinate in values:
                        raise ValueError("The workbook repeats one cell coordinate.")
                    v, kind = c.find(namespace + "v"), c.attrib.get("t", "n")
                    if kind == "inlineStr":
                        item = c.find(namespace + "is")
                        value = "" if item is None else "".join((part.text or "") for part in
                            [*item.findall(namespace + "t"), *item.findall(namespace + "r/" + namespace + "t")])
                    elif c.find(namespace + "f") is not None and (v is None or v.text is None):
                        value = "#NO_CACHED_FORMULA_RESULT"
                    elif v is None:
                        value = None
                    elif kind == "s":
                        index = integer(v.text, 0, len(shared) - 1, "Shared string index")
                        value = shared[index]
                    elif kind == "b":
                        value = v.text == "1"
                    else:
                        value = v.text
                    values[coordinate] = value
                    if len(values) > MAX_CELLS:
                        raise ValueError("The selected workbook sheet exceeds two million populated cells.")
                self.cells = values
                return values
            def iter_rows(self, min_row, max_row, max_col, values_only=True):
                values = self.values()
                for row in range(min_row, max_row + 1):
                    yield tuple(values.get((row, col)) for col in range(1, max_col + 1))
        def parse_cell(label):
            match = re.fullmatch(r"([A-Z]{1,3})([1-9]\d*)", label)
            if not match:
                raise ValueError("The workbook contains an invalid cell coordinate.")
            col = 0
            for character in match[1]:
                col = col * 26 + ord(character) - 64
            return integer(match[2], 1, 1048576, "Cell row"), integer(col, 1, 16384, "Cell column")
        class Book:
            def __init__(self):
                self.worksheets = [Sheet(element) for element in root.findall(namespace + "sheets/" + namespace + "sheet")]
                if len({s.title for s in self.worksheets}) != len(self.worksheets):
                    raise ValueError("The workbook repeats one sheet name.")
            def __getitem__(self, name):
                return next(s for s in self.worksheets if s.title == name)
            def close(self):
                package.close()
        return Book()
    except Exception:
        package.close()
        raise


def csv_rows(data):
    try:
        reader = csv.reader(io.StringIO(data.decode("utf-8-sig"), newline=""))
        rows = []
        count = 0
        for row in reader:
            rows.append(row)
            count += len(row)
            if len(rows) > MAX_ROWS + 100 or count > MAX_CELLS:
                raise ValueError("This CSV exceeds the supported source table size.")
        return rows
    except UnicodeDecodeError:
        raise ValueError("Export the source CSV as UTF-8.") from None


def inspect_file(data, filename):
    if len(data) > MAX_BYTES:
        raise ValueError("One original source may contain at most 64 MiB.")
    suffix = Path(filename).suffix.lower()
    if suffix == ".xlsx":
        book = workbook(data)
        try:
            sheets = [{"name": sheet.title, "rows": sheet.max_row, "columns": sheet.max_column}
                      for sheet in book.worksheets]
            if len(sheets) > 300:
                raise ValueError("Choose a workbook with at most 300 sheets.")
            return {"format": "xlsx", "sheets": sheets}
        finally:
            book.close()
    if suffix in (".csv", ".tsv"):
        if suffix == ".tsv":
            raise ValueError("Save the source as comma-separated UTF-8 CSV or XLSX.")
        rows = csv_rows(data)
        return {"format": "csv", "sheets": [{"name": "CSV", "rows": len(rows),
                "columns": max(map(len, rows), default=0)}]}
    if suffix == ".json":
        value = strict_json(data.decode("utf-8-sig"))
        if not isinstance(value, dict) or value.get("schema") != "commons.load-forecast-source.v1":
            raise ValueError("Select a load-forecast source packet, an XLSX workbook, CSV, or a reference PDF.")
        if not isinstance(value.get("rows"), list) or len(value["rows"]) > MAX_ROWS:
            raise ValueError("A source packet requires at most 100,000 rows.")
        return {"format": "packet", "sheets": [], "rows": len(value["rows"])}
    if suffix == ".pdf" and data.startswith(b"%PDF-"):
        return {"format": "reference", "sheets": []}
    raise ValueError("Select the original XLSX, UTF-8 CSV, source JSON packet, or reference PDF.")


def sheet_rows(data, inspection, sheet, first=1, last=None, last_column=None):
    listed = next((s for s in inspection["sheets"] if s["name"] == sheet), None)
    if not listed:
        raise ValueError("Select an actual sheet in the retained original file.")
    rows, columns = listed["rows"] or 0, listed["columns"] or 0
    first = integer(first, 1, max(rows, 1), "First row")
    last = integer(last if last is not None else rows, first, max(rows, 1), "Last row")
    last_column = integer(last_column if last_column is not None else columns, 1, 16384, "Last column")
    if (last - first + 1) * last_column > MAX_CELLS:
        raise ValueError("Select a smaller source range; at most two million cells can be mapped together.")
    if inspection["format"] == "csv":
        return [row[:last_column] + [None] * max(0, last_column - len(row))
                for row in csv_rows(data)[first - 1:last]]
    book = workbook(data)
    try:
        return [[scalar(value) for value in row] for row in
                book[sheet].iter_rows(min_row=first, max_row=last, max_col=last_column, values_only=True)]
    finally:
        book.close()


def period(value, basis, single_year="end"):
    label = text(value, 100, True)
    if re.fullmatch(r"\d{4}\.0", label):
        label = label[:-2]
    if basis == "calendar_year":
        year = integer(label, 1900, 2200, "Calendar year")
        return label, str(year), str(year), year
    if basis == "summer_year":
        year = integer(label, 1900, 2200, "Summer year")
        return label, str(year), str(year), year
    if basis in ("winter_year", "delivery_year"):
        match = re.fullmatch(r"(\d{4})\s*[/–-]\s*(\d{2}|\d{4})", label)
        if match:
            start = int(match[1])
            end = int(match[2])
            if end < 100:
                end += (start // 100) * 100
                if end < start:
                    end += 100
            if end != start + 1 or not 1900 <= start < end <= 2200:
                raise ValueError("A winter or delivery span must identify consecutive years.")
        else:
            year = integer(label, 1900, 2200, "Period year")
            if single_year not in ("start", "end"):
                raise ValueError("Say whether a single winter or delivery label names its start or end year.")
            start, end = (year, year + 1) if single_year == "start" else (year - 1, year)
        # Preserve the labeled year span; an original seasonal label does not imply calendar-month boundaries.
        return label, str(start), str(end), end
    if basis == "calendar_month":
        if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", label):
            raise ValueError("Use YYYY-MM for a monthly source label.")
        from calendar import monthrange
        year, month = map(int, label.split("-"))
        integer(year, 1900, 2200, "Month year")
        return label, f"{label}-01", f"{label}-{monthrange(year, month)[1]}", year
    raise ValueError("Choose calendar year, summer year, winter year, delivery year or calendar month.")


def normalise(raw):
    result = {key: text(raw.get(key), 200 if key not in ("basis", "source_ref") else 3000, True)
              for key in ("area", "geography", "metric", "season", "period_basis", "signal", "unit", "coincidence", "basis")}
    if result["metric"] not in METRICS or result["season"] not in SEASONS or result["signal"] not in SIGNALS:
        raise ValueError("Select a supported load metric, season and source signal.")
    if result["unit"] not in UNITS:
        raise ValueError("Select an explicit power unit (kW/MW/GW) or energy unit (kWh/MWh/GWh/TWh).")
    canonical, factor = UNITS[result["unit"]]
    if (result["metric"] == "peak_demand") != (canonical == "MW"):
        raise ValueError("Peak demand uses power units and energy uses energy units.")
    if result["coincidence"] not in ("coincident", "noncoincident", "not_applicable"):
        raise ValueError("Select coincident, noncoincident, or not applicable explicitly.")
    if result["metric"] == "energy" and result["coincidence"] != "not_applicable":
        raise ValueError("Energy totals do not have a peak-coincidence classification.")
    if result["metric"] == "peak_demand" and result["coincidence"] == "not_applicable":
        raise ValueError("State whether each peak is coincident or noncoincident.")
    if result["season"] == "winter" and result["period_basis"] not in ("winter_year", "delivery_year"):
        raise ValueError("Winter peak labels require an explicit winter or delivery-year interpretation.")
    if result["season"] == "summer" and result["period_basis"] not in ("summer_year", "delivery_year"):
        raise ValueError("Summer peaks require an explicit summer or delivery-year interpretation.")
    if result["season"] == "monthly" and result["period_basis"] != "calendar_month":
        raise ValueError("Monthly values require a calendar-month label.")
    if result["season"] == "annual" and result["period_basis"] not in ("calendar_year", "delivery_year"):
        raise ValueError("Annual values require a calendar or delivery-year label.")
    label, start, end, year = period(raw.get("period"), result["period_basis"], raw.get("single_year", "end"))
    amount = decimal(raw.get("value"))
    if amount < 0 and result["signal"] != "adjustment":
        raise ValueError("Published loads must be nonnegative; signed changes use the adjustment signal.")
    with localcontext() as context:
        context.prec = EXACT_PRECISION
        context.rounding = ROUND_HALF_EVEN
        context.Emax, context.Emin = 9999, -9999
        normalized = amount * factor
    result.update({"period_label": label, "period_start": start, "period_end": end, "year": year,
        "value": number(amount), "canonical_unit": canonical, "canonical_value": number(normalized),
        "source_geography": text(raw.get("source_geography", raw["geography"]), 300, True),
        "sheet": text(raw.get("sheet", "packet"), 300, True), "cell": text(raw.get("cell"), 200, True),
        "period_cell": text(raw.get("period_cell", ""), 200), "mapping_id": identifier(raw.get("mapping_id", "packet")),
        "source_ref": text(raw.get("source_ref", ""), 3000)})
    result["key"] = digest(encoded([result[k] for k in KEY_FIELDS]).encode())
    result["row_id"] = digest(encoded([result["sheet"], result["cell"], result["mapping_id"],
                                     result["key"], result["signal"]]).encode())[:24]
    return result


def map_source(data, inspection, mappings):
    if inspection["format"] == "packet":
        packet = strict_json(data.decode("utf-8-sig"))
        rows = [normalise({**r, "cell": r.get("cell", f"row:{i}")})
                for i, r in enumerate(packet["rows"], 1)]
        mapping_records, missing = [], []
    else:
        if not isinstance(mappings, list) or not 1 <= len(mappings) <= 200:
            raise ValueError("Add one or more explicit source table mappings.")
        rows, missing, mapping_records = [], [], []
        mapping_ids = set()
        for mapping in mappings:
            if not isinstance(mapping, dict):
                raise ValueError("A table mapping must be an object.")
            mid = identifier(mapping.get("id"))
            if mid in mapping_ids:
                raise ValueError("Each mapped table needs a distinct ID.")
            mapping_ids.add(mid)
            sheet = text(mapping.get("sheet"), 300, True)
            layout = mapping.get("layout", "wide")
            if layout not in ("wide", "long"):
                raise ValueError("Choose wide years across columns or one observation per row.")
            first = integer(mapping.get("first_row"), 1, 1048576, "First data row")
            last = integer(mapping.get("last_row"), first, 1048576, "Last data row")
            geo_col = integer(mapping.get("geography_column", 0), 0, 16384, "Geography column")
            aliases = mapping.get("aliases", {})
            if not isinstance(aliases, dict) or len(aliases) > 10000:
                raise ValueError("Geography aliases must be an explicit source-label to reviewed-label mapping.")
            defaults = mapping.get("defaults", {})
            if not isinstance(defaults, dict):
                raise ValueError("Complete the table's source definitions.")
            if not geo_col and not text(defaults.get("geography")):
                raise ValueError("Select a geography column or enter this table's one geography.")
            if layout == "wide":
                period_row = integer(mapping.get("period_row"), 1, 1048576, "Period heading row")
                first_col = integer(mapping.get("first_column"), 1, 16384, "First value column")
                last_col = integer(mapping.get("last_column"), first_col, 16384, "Last value column")
                lo, hi, end_col = min(first, period_row), max(last, period_row), max(last_col, geo_col)
                values = sheet_rows(data, inspection, sheet, lo, hi, end_col)
                at = lambda row, col: values[row - lo][col - 1]
                candidates = ((row, col, at(period_row, col), cell_name(period_row, col), at(row, col))
                              for row in range(first, last + 1) for col in range(first_col, last_col + 1))
            else:
                period_col = integer(mapping.get("period_column"), 1, 16384, "Period column")
                value_col = integer(mapping.get("value_column"), 1, 16384, "Value column")
                lo, hi, end_col = first, last, max(period_col, value_col, geo_col)
                values = sheet_rows(data, inspection, sheet, lo, hi, end_col)
                at = lambda row, col: values[row - lo][col - 1]
                candidates = ((row, value_col, at(row, period_col), cell_name(row, period_col), at(row, value_col))
                              for row in range(first, last + 1))
            blanks = [str(v) for v in mapping.get("missing_values", ["", "-", "–", "N/A", "NA"])]
            for row, col, label, period_cell, value in candidates:
                original_geo = text(at(row, geo_col) if geo_col else defaults.get("geography"), 300)
                if value is None or str(value).strip() in blanks:
                    missing.append({"mapping_id": mid, "sheet": sheet, "cell": cell_name(row, col),
                                    "period_label": str(label or ""), "source_geography": original_geo})
                    continue
                if not original_geo:
                    raise ValueError(f"{sheet}!{cell_name(row, col)} has a value but no selected geography label.")
                raw = {**defaults, "geography": aliases.get(original_geo, original_geo),
                       "source_geography": original_geo, "period": label, "value": value,
                       "sheet": sheet, "cell": cell_name(row, col), "period_cell": period_cell, "mapping_id": mid}
                try:
                    rows.append(normalise(raw))
                except ValueError as error:
                    raise ValueError(f"{sheet}!{cell_name(row, col)}: {error}") from None
                if len(rows) > MAX_ROWS:
                    raise ValueError("A source edition may contain at most 100,000 mapped observations.")
            mapping_records.append(mapping)
    if not rows:
        raise ValueError("No numeric observations were mapped. Review the original selected range.")
    seen = set()
    for row in rows:
        identity = (row["key"], row["signal"])
        if identity in seen:
            raise ValueError("Two mapped cells have the same geography, period, metric and signal. Select the intended original table or distinguish its basis.")
        seen.add(identity)
    return {"schema": "commons.load-forecast-normalised.v1", "rows": rows, "mappings": mapping_records,
            "missing_cells": missing, "row_count": len(rows),
            "canonical_units": sorted({row["canonical_unit"] for row in rows}),
            "signals": sorted({row["signal"] for row in rows})}
